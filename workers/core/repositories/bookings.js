// CORE D1 ONLY — do not add Firestore fallback.

import {
  addMinutes,
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
  normalizePhone,
  optionalText,
  placeholders,
  requiredId,
  requiredText,
  rowNotFound,
  updateById,
  validDate,
  validTime,
} from '../d1.js';
import { getClient } from './clients.js';
import { AppError } from '../errors.js';
import { auditInsertStatement, recordAudit } from './audit.js';
import { getService, resolveBookingService, serviceIsActive } from './services.js';
import {
  getStaff,
  staffIsActive,
} from './staff.js';
import {
  resolveStaffBookingDay,
  staffCanPerformService,
} from './booking-staff-policy.js';
import { resolveBookingDiscount } from './discount-application.js';
import { safeRefreshTargetsForBooking } from './employee-targets.js';
import { reconcileCashbackForBooking } from './cashback.js';

const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "rejected"]);
const LOCK_GRANULARITY_MIN = 5;
const BOOKING_REFERENCE_BASE = 10422;
const PRICE_ADJUSTMENT_REASONS = new Set([
  'catalog_pending_update',
  'management_approved',
  'special_price',
  'other',
]);

function bookingDiscountSource(data = {}) {
  const raw =
    data.discountSnapshot ??
    data.discount_snapshot ??
    data.discount_snapshot_json;
  if (!raw) return '';
  if (typeof raw === 'object') return cleanText(raw.source).toLowerCase();
  try {
    const parsed = JSON.parse(String(raw));
    return cleanText(parsed?.source).toLowerCase();
  } catch {
    return '';
  }
}

function normalizeItems(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    const error = new Error("booking_items_required");
    error.code = "core_booking:items_required";
    throw error;
  }
  return items;
}

function timeToMinutes(value) {
  const [hours, minutes] = validTime(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.floor(value)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function compareDateTime(leftDate, leftTime, rightDate, rightTime) {
  return `${leftDate}T${leftTime}`.localeCompare(`${rightDate}T${rightTime}`);
}

function salonTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function assertBookingDateAllowed(bookingDate, allowPastDates) {
  if (allowPastDates || bookingDate >= salonTodayISO()) return;
  throw new AppError(
    400,
    "core_booking:past_date_not_allowed",
    "Past booking dates are only allowed through the authenticated internal booking route"
  );
}

function parseBookingReferenceNumber(value) {
  const match = cleanText(value).toUpperCase().match(/^MK-(\d+)$/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function allocateBookingPublicId(db, salonId) {
  if (db.__fakeD1) {
    if (!db.__bookingReferenceCounters) db.__bookingReferenceCounters = new Map();
    const existingMax = db.rows("bookings").reduce(
      (max, row) => row.salon_id === salonId
        ? Math.max(max, parseBookingReferenceNumber(row.public_id))
        : max,
      BOOKING_REFERENCE_BASE
    );
    const current = Math.max(
      BOOKING_REFERENCE_BASE,
      Number(db.__bookingReferenceCounters.get(salonId) || 0),
      existingMax
    );
    const next = current + 1;
    db.__bookingReferenceCounters.set(salonId, next);
    return `MK-${next}`;
  }

  const row = await dbFirst(
    db,
    `INSERT INTO booking_counters (salon_id, last_number, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(salon_id) DO UPDATE SET
       last_number = booking_counters.last_number + 1,
       updated_at = excluded.updated_at
     RETURNING last_number`,
    [salonId, BOOKING_REFERENCE_BASE + 1, nowIso()]
  );
  const number = Number(row?.last_number || 0);
  if (!Number.isSafeInteger(number) || number <= BOOKING_REFERENCE_BASE) {
    throw new AppError(500, "core_booking:reference_allocation_failed");
  }
  return `MK-${number}`;
}

function occupiedSlotTimes(startTime, endTime, slotStepMin, bufferMin) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end <= start) {
    const error = new Error("booking_invalid_range");
    error.code = "core_booking:invalid_time_range";
    throw error;
  }
  const until = Math.min(24 * 60, end + Math.max(0, bufferMin));
  const slots = [];
  for (let minute = start; minute < until; minute += slotStepMin) {
    slots.push(minutesToTime(minute));
  }
  return slots;
}

function conflictError() {
  const error = new Error("booking_conflict");
  error.code = "core_booking:staff_slot_conflict";
  return error;
}

export function findClientItemOverlap(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  for (let index = 0; index < items.length; index += 1) {
    const left = items[index] || {};
    const leftDate = cleanText(left.booking_date || left.bookingDate);
    const leftStart = cleanText(left.start_time || left.startTime);
    const leftEnd = cleanText(left.end_time || left.endTime);
    if (!leftDate || !leftStart || !leftEnd) continue;

    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      const right = items[otherIndex] || {};
      const rightDate = cleanText(right.booking_date || right.bookingDate);
      const rightStart = cleanText(right.start_time || right.startTime);
      const rightEnd = cleanText(right.end_time || right.endTime);
      if (!rightDate || !rightStart || !rightEnd || rightDate !== leftDate) continue;
      if (leftStart < rightEnd && rightStart < leftEnd) return { left, right };
    }
  }
  return null;
}

function clientScheduleConflict(details = {}) {
  return new AppError(
    409,
    "core_booking:client_schedule_conflict",
    "A client cannot receive overlapping services",
    details
  );
}

export function assertNoClientItemOverlap(rows = []) {
  const conflict = findClientItemOverlap(rows);
  if (!conflict) return;
  throw clientScheduleConflict({
    leftItemId: cleanText(conflict.left?.id),
    rightItemId: cleanText(conflict.right?.id),
    bookingDate: cleanText(conflict.left?.booking_date || conflict.left?.bookingDate),
  });
}

export async function existingClientRangeConflict(
  db,
  salonId,
  clientId,
  bookingDate,
  startTime,
  endTime,
  excludeBookingId = ""
) {
  if (!clientId) return null;

  if (db.__fakeD1 && typeof db.rows === "function") {
    const bookings = db.rows("bookings");
    const items = db.rows("booking_items");
    for (const item of items) {
      const booking = bookings.find(
        (row) => row.id === item.booking_id && row.salon_id === salonId && row.client_id === clientId
      );
      if (!booking || booking.id === excludeBookingId) continue;
      if (CANCELLED_STATUSES.has(cleanText(booking.status).toLowerCase())) continue;
      const itemDate = cleanText(item.booking_date || booking.booking_date);
      const itemStart = cleanText(item.start_time || booking.start_time);
      const itemEnd = cleanText(item.end_time || booking.end_time);
      if (itemDate === bookingDate && itemStart < endTime && itemEnd > startTime) return { id: booking.id };
    }
    return null;
  }

  return dbFirst(
    db,
    `SELECT b.id
       FROM booking_items bi
       INNER JOIN bookings b ON b.id = bi.booking_id AND b.salon_id = bi.salon_id
      WHERE bi.salon_id = ?
        AND b.client_id = ?
        AND COALESCE(bi.booking_date, b.booking_date) = ?
        AND LOWER(b.status) NOT IN ('cancelled', 'canceled', 'rejected')
        AND b.id != ?
        AND COALESCE(bi.start_time, b.start_time) < ?
        AND COALESCE(bi.end_time, b.end_time) > ?
      LIMIT 1`,
    [salonId, clientId, bookingDate, excludeBookingId, endTime, startTime]
  );
}

async function existingRangeConflict(
  db,
  salonId,
  staffId,
  bookingDate,
  startTime,
  endTime,
  excludeBookingId = ""
) {
  if (!staffId) return null;

  if (db.__fakeD1 && typeof db.rows === "function") {
    const bookings = db.rows("bookings");
    const items = db.rows("booking_items");
    for (const item of items) {
      const booking = bookings.find(
        (row) => row.id === item.booking_id && row.salon_id === salonId
      );
      if (!booking || booking.id === excludeBookingId) continue;
      if (CANCELLED_STATUSES.has(cleanText(booking.status).toLowerCase())) continue;
      const itemStaffId = cleanText(item.staff_id || booking.staff_id);
      const itemDate = cleanText(item.booking_date || booking.booking_date);
      const itemStart = cleanText(item.start_time || booking.start_time);
      const itemEnd = cleanText(item.end_time || booking.end_time);
      if (
        itemStaffId === staffId &&
        itemDate === bookingDate &&
        itemStart < endTime &&
        itemEnd > startTime
      ) {
        return { id: booking.id };
      }
    }
    return null;
  }

  return dbFirst(
    db,
    `SELECT b.id
       FROM booking_items bi
       INNER JOIN bookings b ON b.id = bi.booking_id AND b.salon_id = bi.salon_id
      WHERE bi.salon_id = ?
        AND COALESCE(bi.staff_id, b.staff_id) = ?
        AND COALESCE(bi.booking_date, b.booking_date) = ?
        AND LOWER(b.status) NOT IN ('cancelled', 'canceled', 'rejected')
        AND b.id != ?
        AND COALESCE(bi.start_time, b.start_time) < ?
        AND COALESCE(bi.end_time, b.end_time) > ?
      LIMIT 1`,
    [salonId, staffId, bookingDate, excludeBookingId, endTime, startTime]
  );
}

async function assertStaffRangeAvailable(
  db,
  salonId,
  staffId,
  bookingDate,
  startTime,
  endTime,
  excludeBookingId = ""
) {
  if (!staffId) return;
  const staff = await getStaff(db, salonId, staffId);
  if (!staffIsActive(staff)) {
    const error = new Error("staff_inactive");
    error.code = "core_booking:staff_inactive";
    throw error;
  }
  const bookingDay = await resolveStaffBookingDay(
    db,
    salonId,
    staff,
    bookingDate,
    startTime,
    endTime
  );
  if (!bookingDay.available) {
    const error = new Error("staff_unavailable");
    error.code = "core_booking:staff_unavailable";
    error.reason = bookingDay.reason || "unavailable";
    throw error;
  }
  if (
    await existingRangeConflict(
      db,
      salonId,
      staffId,
      bookingDate,
      startTime,
      endTime,
      excludeBookingId
    )
  ) {
    throw conflictError();
  }
}

export async function listBookings(db, salonId, query = {}) {
  const date = cleanText(query.date || query.bookingDate);
  const staffId = cleanText(query.staffId || query.staff_id);
  const clientId = cleanText(query.clientId || query.client_id);
  const status = cleanText(query.status);

  const where = [
    "b.salon_id = ?",
    "b.deleted_at IS NULL",
  ];
  const params = [salonId];

  if (date) {
    where.push("b.booking_date = ?");
    params.push(date);
  }

  if (staffId) {
    where.push(`(
      b.staff_id = ?
      OR EXISTS (
        SELECT 1
          FROM booking_items assigned_item
         WHERE assigned_item.salon_id = b.salon_id
           AND assigned_item.booking_id = b.id
           AND assigned_item.staff_id = ?
      )
    )`);
    params.push(staffId, staffId);
  }

  if (clientId) {
    where.push("b.client_id = ?");
    params.push(clientId);
  }

  if (status) {
    where.push("b.status = ?");
    params.push(status);
  }

  const rows = await dbAll(
    db,
    `SELECT b.*
       FROM bookings b
      WHERE ${where.join(" AND ")}
      ORDER BY ${
        date
          ? "b.start_time"
          : "b.booking_date DESC, b.start_time DESC"
      }
      LIMIT 500`,
    params
  );

  if (!rows.length) return [];

  // Hydrate only rows referenced by this page. Reading whole tenant tables here caused
  // D1 row-read amplification as client and invoice history grew.
  const chunk = (values) => {
    const groups = [];
    for (let index = 0; index < values.length; index += 80) {
      groups.push(values.slice(index, index + 80));
    }
    return groups;
  };

  const bookingIds = rows.map((row) => cleanText(row.id)).filter(Boolean);
  const clientIds = [...new Set(rows.map((row) => cleanText(row.client_id)).filter(Boolean))];
  const staffIds = [...new Set(rows.map((row) => cleanText(row.staff_id)).filter(Boolean))];
  const bookingIdChunks = chunk(bookingIds);
  const clientIdChunks = chunk(clientIds);
  const staffIdChunks = chunk(staffIds);

  const [
    clientGroups,
    staffGroups,
    invoiceGroups,
    itemGroups,
  ] = await Promise.all([
    Promise.all(
      clientIdChunks.map((ids) =>
        dbAll(
          db,
          `SELECT * FROM clients WHERE salon_id = ? AND id IN (${placeholders(ids.length)})`,
          [salonId, ...ids]
        )
      )
    ),
    Promise.all(
      staffIdChunks.map((ids) =>
        dbAll(
          db,
          `SELECT * FROM staff WHERE salon_id = ? AND id IN (${placeholders(ids.length)})`,
          [salonId, ...ids]
        )
      )
    ),
    Promise.all(
      bookingIdChunks.map((ids) =>
        dbAll(
          db,
          `SELECT * FROM invoices WHERE salon_id = ? AND booking_id IN (${placeholders(ids.length)}) ORDER BY issued_at DESC, created_at DESC, id DESC`,
          [salonId, ...ids]
        )
      )
    ),
    Promise.all(
      bookingIdChunks.map((ids) =>
        dbAll(
          db,
          `SELECT * FROM booking_items WHERE salon_id = ? AND booking_id IN (${placeholders(ids.length)}) ORDER BY COALESCE(booking_date, ''), COALESCE(start_time, ''), created_at, id`,
          [salonId, ...ids]
        )
      )
    ),
  ]);

  const clients = clientGroups.flat();
  const staffRows = staffGroups.flat();
  const invoices = invoiceGroups.flat();

  const clientsById = new Map(clients.map((row) => [cleanText(row.id), row]));
  const staffById = new Map(staffRows.map((row) => [cleanText(row.id), row]));

  const itemsByBookingId = new Map();
  for (const item of itemGroups.flat()) {
    const bookingId = cleanText(item.booking_id);
    if (!itemsByBookingId.has(bookingId)) itemsByBookingId.set(bookingId, []);
    itemsByBookingId.get(bookingId).push(item);
  }

  const invoiceByBookingId = new Map();
  for (const invoice of invoices) {
    const bookingId = cleanText(invoice.booking_id);
    if (bookingId && !invoiceByBookingId.has(bookingId)) {
      invoiceByBookingId.set(bookingId, invoice);
    }
  }

  const enriched = rows.map((row) => {
    const client = clientsById.get(cleanText(row.client_id));
    const staff = staffById.get(cleanText(row.staff_id));
    const invoice = invoiceByBookingId.get(cleanText(row.id));

    return {
      ...row,
      client_name: client?.name || null,
      client_phone: client?.phone_normalized || null,
      staff_name: staff?.name || null,
      invoice_id: invoice?.id || null,
      invoice_number: invoice?.invoice_number || null,
      paid_halalas: Number(invoice?.paid_halalas || 0),
      items: itemsByBookingId.get(cleanText(row.id)) || [],
    };
  });

  const search = cleanText(query.search || query.q).toLowerCase();

  return enriched.filter((row) => {
    if (
      staffId &&
      cleanText(row.staff_id) !== staffId &&
      !(row.items || []).some((item) => cleanText(item.staff_id) === staffId)
    ) {
      return false;
    }

    if (!search) return true;

    return [
      row.id,
      row.public_id,
      row.client_id,
      row.client_name,
      row.client_phone,
      row.staff_name,
      ...(row.items || []).flatMap((item) => [
        item.service_name_snapshot,
        item.staff_id,
        item.booking_date,
        item.start_time,
      ]),
    ].some((value) => cleanText(value).toLowerCase().includes(search));
  });
}

export async function getPublicBookingTrack(db, salonId, publicId) {
  const code = cleanText(publicId).toUpperCase();
  if (!/^MK-\d{3,}$/.test(code)) throw new AppError(400, "core_booking:invalid_public_id");
  const row = await dbFirst(
    db,
    "SELECT id FROM bookings WHERE salon_id = ? AND public_id = ? AND deleted_at IS NULL LIMIT 1",
    [salonId, code]
  );
  if (!row) throw new AppError(404, "core_booking:not_found");
  const booking = await getBooking(db, salonId, row.id);
  const publicItems = await dbAll(
    db,
    `SELECT bi.id, bi.service_id, bi.service_name_snapshot, bi.staff_id,
            bst.name AS staff_name,
            bi.booking_date, bi.start_time, bi.end_time, bi.duration_minutes,
            s.section_id, ss.name AS section_name, s.category_id, sc.name AS category_name
       FROM booking_items bi
       LEFT JOIN services s
         ON s.salon_id = ? AND s.id = bi.service_id
       LEFT JOIN service_sections ss
         ON ss.salon_id = ? AND ss.id = s.section_id
       LEFT JOIN service_categories sc
         ON sc.salon_id = ? AND sc.id = s.category_id
       LEFT JOIN staff bst
         ON bst.salon_id = ? AND bst.id = bi.staff_id
      WHERE bi.booking_id = ?
      ORDER BY COALESCE(bi.booking_date, ''), COALESCE(bi.start_time, ''), bi.created_at, bi.id`,
    [salonId, salonId, salonId, salonId, booking.id]
  );
  return {
    id: booking.id,
    public_id: booking.public_id,
    status: booking.status,
    booking_date: booking.booking_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    staff_id: booking.staff_id,
    staff_name: booking.staff_name,
    updated_at: booking.updated_at,
    items: publicItems.map((item) => ({
      id: item.id,
      service_id: item.service_id,
      service_name_snapshot: item.service_name_snapshot,
      section_id: item.section_id,
      section_name: item.section_name,
      category_id: item.category_id,
      category_name: item.category_name,
      staff_id: item.staff_id,
      staff_name: item.staff_name,
      booking_date: item.booking_date,
      start_time: item.start_time,
      end_time: item.end_time,
      duration_minutes: item.duration_minutes,
    })),
  };
}

export async function getBooking(db, salonId, id) {
  const booking = await dbFirst(
    db,
    "SELECT * FROM bookings WHERE salon_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1",
    [salonId, requiredId(id)]
  );
  if (!booking) rowNotFound("booking");

  const [items, client, staff, invoice] = await Promise.all([
    dbAll(
      db,
      "SELECT * FROM booking_items WHERE booking_id = ? ORDER BY COALESCE(booking_date, ''), COALESCE(start_time, ''), created_at, id",
      [booking.id]
    ),
    dbFirst(
      db,
      "SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1",
      [salonId, booking.client_id]
    ),
    booking.staff_id
      ? dbFirst(
          db,
          "SELECT * FROM staff WHERE salon_id = ? AND id = ? LIMIT 1",
          [salonId, booking.staff_id]
        )
      : null,
    dbFirst(
      db,
      "SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ? ORDER BY issued_at DESC LIMIT 1",
      [salonId, booking.id]
    ),
  ]);

  return {
    ...booking,
    client_name: client?.name || null,
    client_phone: client?.phone_normalized || null,
    staff_name: staff?.name || null,
    invoice_id: invoice?.id || null,
    invoice_number: invoice?.invoice_number || null,
    paid_halalas: Number(invoice?.paid_halalas || 0),
    items,
  };
}

export async function createBooking(db, salonId, data, actor = "", options = {}) {
  const actorUid = typeof actor === "string" ? actor : actor?.uid || "";
  const requestedBookingId = optionalText(data.id);
  if (requestedBookingId) {
    const existing = await dbFirst(
      db,
      "SELECT * FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1",
      [salonId, requiredId(requestedBookingId)]
    );
    if (existing) return getBooking(db, salonId, requestedBookingId);
  }

  const clientId = requiredId(data.clientId || data.client_id, "clientId");
  const parentDate = validDate(
    data.bookingDate || data.booking_date || data.date,
    "bookingDate"
  );
  const allowPastDates = options?.allowPastDates === true;
  assertBookingDateAllowed(parentDate, allowPastDates);
  const parentStart = validTime(
    data.startTime || data.start_time || data.time,
    "startTime"
  );
  const parentStaffId = optionalText(data.staffId || data.staff_id) || null;
  const slotStepMin = integer(
    data.slotStepMin ?? data.slot_step_min,
    "slotStepMin",
    { min: 5, max: 120, fallback: 10 }
  );
  const bufferMin = integer(
    data.bufferMin ?? data.buffer_min,
    "bufferMin",
    { min: 0, max: 240, fallback: 0 }
  );
  const now = nowIso();
  await getClient(db, salonId, clientId);

  const itemInputs = normalizeItems(data);
  const rows = [];
  const lockRows = [];
  const localLocks = new Set();
  let subtotal = 0;
  let cursorDate = parentDate;
  let cursorTime = parentStart;

  for (let index = 0; index < itemInputs.length; index += 1) {
    const item = itemInputs[index];
    const service = await resolveBookingService(db, salonId, {
      serviceId: item.serviceId || item.service_id,
      serviceName:
        item.serviceName ||
        item.service_name ||
        item.serviceNameSnapshot ||
        item.service_name_snapshot,
    });
    if (!serviceIsActive(service)) {
      const error = new Error("service_inactive");
      error.code = "core_booking:service_inactive";
      throw error;
    }

    const quantity = integer(item.quantity, "quantity", {
      min: 1,
      max: 20,
      fallback: 1,
    });
    const catalogUnit = integer(
      service.price_halalas,
      "catalogUnitPriceHalalas",
      { min: 0, max: 10_000_000 }
    );
    const unit = integer(
      item.unitPriceHalalas ??
        item.unit_price_halalas ??
        catalogUnit,
      "unitPriceHalalas",
      { min: 0, max: 10_000_000 }
    );
    const priceAdjusted = unit !== catalogUnit;
    const priceAdjustmentReason = priceAdjusted
      ? cleanText(
          item.priceAdjustmentReason ??
            item.price_adjustment_reason
        ).toLowerCase()
      : "";
    const priceAdjustmentNote = priceAdjusted
      ? optionalText(
          item.priceAdjustmentNote ??
            item.price_adjustment_note
        ) || null
      : null;

    if (priceAdjusted && options?.allowPriceAdjustment !== true) {
      throw new AppError(
        403,
        "core_booking:price_adjustment_forbidden",
        "Booking item price adjustment requires bookings.price.adjust"
      );
    }
    if (
      priceAdjusted &&
      !PRICE_ADJUSTMENT_REASONS.has(priceAdjustmentReason)
    ) {
      throw new AppError(
        400,
        "core_booking:price_adjustment_reason_required"
      );
    }

    const total = unit * quantity;
    const durationMinutes = Math.max(
      1,
      Number(service.duration_minutes || 0) * quantity
    );
    const bookingDate = validDate(
      item.bookingDate || item.booking_date || item.date || cursorDate,
      `items[${index}].bookingDate`
    );
    assertBookingDateAllowed(bookingDate, allowPastDates);
    const startTime = validTime(
      item.startTime || item.start_time || item.time ||
        (bookingDate === cursorDate ? cursorTime : parentStart),
      `items[${index}].startTime`
    );
    const endTime = validTime(
      item.endTime || item.end_time || addMinutes(startTime, durationMinutes),
      `items[${index}].endTime`
    );
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      const error = new Error("booking_invalid_range");
      error.code = "core_booking:invalid_time_range";
      throw error;
    }
    if (timeToMinutes(startTime) % slotStepMin !== 0) {
      const error = new Error("booking_invalid_slot_alignment");
      error.code = "core_booking:invalid_slot_alignment";
      throw error;
    }
    const staffId = optionalText(item.staffId || item.staff_id) || parentStaffId;
    if (staffId && !(await staffCanPerformService(db, salonId, staffId, service.id))) {
      const error = new Error("staff_service_not_assigned");
      error.code = "core_booking:staff_service_not_assigned";
      throw error;
    }
    await assertStaffRangeAvailable(
      db,
      salonId,
      staffId,
      bookingDate,
      startTime,
      addMinutes(endTime, bufferMin)
    );

    const itemId = requiredId(item.id || generatedId("booking_item"));
    const cartItemId = optionalText(
      item.cartItemId || item.cart_item_id
    ) || `item_${index}`;
    // Slot locks always use a fixed five-minute granularity. The UI slot step
    // remains configurable, but lock precision must not vary per request or two
    // concurrent bookings using different slot steps could overlap without
    // sharing a unique lock key.
    const slots = staffId
      ? occupiedSlotTimes(startTime, endTime, LOCK_GRANULARITY_MIN, bufferMin)
      : [];

    for (const slotTime of slots) {
      const lockKey = `${staffId}\u0000${bookingDate}\u0000${slotTime}`;
      if (localLocks.has(lockKey)) throw conflictError();
      localLocks.add(lockKey);
      lockRows.push({
        salon_id: salonId,
        staff_id: staffId,
        booking_date: bookingDate,
        slot_time: slotTime,
        booking_item_id: itemId,
      });
    }

    subtotal += total;
    rows.push({
      id: itemId,
      service_id: service.id,
      category_id: service.category_id || null,
      service_name_snapshot: service.name,
      staff_id: staffId,
      quantity,
      catalog_unit_price_halalas: catalogUnit,
      unit_price_halalas: unit,
      total_halalas: total,
      price_adjustment_reason: priceAdjusted ? priceAdjustmentReason : null,
      price_adjustment_note: priceAdjustmentNote,
      price_adjusted_by_uid: priceAdjusted ? actorUid || null : null,
      price_adjusted_at: priceAdjusted ? now : null,
      package_covered: item.packageCovered ? 1 : 0,
      client_package_id:
        optionalText(item.clientPackageId || item.client_package_id) || null,
      duration_minutes: durationMinutes,
      booking_date: bookingDate,
      start_time: startTime,
      end_time: endTime,
      cart_item_id: cartItemId,
      package_reservation_id:
        optionalText(
          item.packageReservationId || item.package_reservation_id
        ) || null,
    });

    cursorDate = bookingDate;
    cursorTime = endTime;
  }

  // One client cannot be in two services at the same time, regardless of staff.
  assertNoClientItemOverlap(rows);
  for (const row of rows) {
    const existingClientConflict = await existingClientRangeConflict(
      db,
      salonId,
      clientId,
      row.booking_date,
      row.start_time,
      row.end_time,
      requestedBookingId || ""
    );
    if (existingClientConflict) {
      throw clientScheduleConflict({
        conflictingBookingId: cleanText(existingClientConflict.id),
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
      });
    }
  }

  if (
    bookingDiscountSource(data) === "manual" &&
    options?.allowManualDiscount !== true
  ) {
    throw new AppError(
      403,
      "core_booking:manual_discount_forbidden",
      "Manual booking discount requires bookings.discount.apply"
    );
  }

  const discountApplication = await resolveBookingDiscount(
    db,
    salonId,
    clientId,
    data.source || data.channel || "dashboard",
    rows,
    data,
    actor
  );
  const discount = discountApplication.discountHalalas;
  const total = discountApplication.totalHalalas;
  const bookingId = requiredId(requestedBookingId || generatedId("booking"));
  // Core D1 is the authority for human-readable booking numbers. Frontend
  // values are intentionally ignored so concurrent requests cannot reuse or
  // forge a sequence number.
  const publicId = await allocateBookingPublicId(db, salonId);
  const invoiceId =
    data.createInvoice === false
      ? ""
      : requiredId(data.invoiceId || generatedId("invoice"));
  const invoiceNumber =
    optionalText(data.invoiceNumber || data.invoice_number) || invoiceId || null;
  const orderedRows = [...rows].sort((left, right) =>
    compareDateTime(
      left.booking_date,
      left.start_time,
      right.booking_date,
      right.start_time
    )
  );
  const firstRow = orderedRows[0];
  const firstDayEnd = orderedRows
    .filter((row) => row.booking_date === firstRow.booking_date)
    .reduce(
      (latest, row) => (row.end_time > latest ? row.end_time : latest),
      firstRow.end_time
    );
  const parentEnd =
    optionalText(data.endTime || data.end_time) || firstDayEnd;
  const resolvedParentStaffId =
    parentStaffId ||
    (new Set(rows.map((row) => row.staff_id).filter(Boolean)).size === 1
      ? rows.find((row) => row.staff_id)?.staff_id || null
      : null);

  const bookingStatus = cleanText(data.status || "booked");
  const statements = [
    {
      sql: `INSERT INTO bookings
        (id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes,
         subtotal_halalas, discount_halalas, total_halalas, payment_status, package_sessions_used,
         created_by_uid, created_at, updated_at, cancelled_at, completed_at, slot_step_min, buffer_min,
         discount_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      params: [
        bookingId,
        publicId,
        salonId,
        clientId,
        resolvedParentStaffId,
        firstRow.booking_date,
        firstRow.start_time,
        parentEnd,
        bookingStatus,
        optionalText(data.source) || "dashboard",
        optionalText(data.notes) || null,
        subtotal,
        discount,
        total,
        integer(
          data.packageSessionsUsed ?? data.package_sessions_used,
          "packageSessionsUsed",
          { min: 0, max: 100, fallback: 0 }
        ),
        actorUid || null,
        now,
        now,
        slotStepMin,
        bufferMin,
        discountApplication.discountSnapshotJson,
      ],
    },
    ...rows.map((row) => ({
      sql: `INSERT INTO booking_items
        (id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity,
         catalog_unit_price_halalas, unit_price_halalas, total_halalas,
         price_adjustment_reason, price_adjustment_note, price_adjusted_by_uid, price_adjusted_at,
         package_covered, client_package_id, duration_minutes, created_at,
         booking_date, start_time, end_time, cart_item_id, package_reservation_id, discount_halalas, final_total_halalas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id,
        bookingId,
        salonId,
        row.service_id,
        row.service_name_snapshot,
        row.staff_id,
        row.quantity,
        row.catalog_unit_price_halalas,
        row.unit_price_halalas,
        row.total_halalas,
        row.price_adjustment_reason,
        row.price_adjustment_note,
        row.price_adjusted_by_uid,
        row.price_adjusted_at,
        row.package_covered,
        row.client_package_id,
        row.duration_minutes,
        now,
        row.booking_date,
        row.start_time,
        row.end_time,
        row.cart_item_id,
        row.package_reservation_id,
        discountApplication.allocationsByCartItem.get(row.cart_item_id)?.discountAmountHalalas || 0,
        discountApplication.allocationsByCartItem.get(row.cart_item_id)?.finalAmountHalalas ?? row.total_halalas,
      ],
    })),
    ...lockRows.map((row) => ({
      sql: `INSERT INTO booking_slot_locks
        (salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.salon_id,
        row.staff_id,
        row.booking_date,
        row.slot_time,
        bookingId,
        row.booking_item_id,
        now,
      ],
    })),
  ];

  if (invoiceId) {
    statements.push({
      sql: `INSERT INTO invoices
        (id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas,
         total_halalas, paid_halalas, status, issued_at, created_at, updated_at, discount_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?, ?, ?, ?)`,
      params: [
        invoiceId,
        salonId,
        bookingId,
        clientId,
        invoiceNumber,
        subtotal,
        discount,
        total,
        now,
        now,
        now,
        discountApplication.discountSnapshotJson,
      ],
    });
  }

  if (discountApplication.discountId) {
    statements.push({
      sql: "UPDATE discounts SET used_count = used_count + 1, updated_at = ? WHERE salon_id = ? AND id = ?",
      params: [now, salonId, discountApplication.discountId],
    });
  }

  statements.push(auditInsertStatement(salonId, {
    action: "booking_created",
    entityType: "booking",
    entityId: bookingId,
    description: "Core booking created",
    source: "core-booking",
    after: {
      id: bookingId,
      publicId,
      clientId,
      invoiceId: invoiceId || null,
      status: bookingStatus,
      paymentStatus: "unpaid",
      bookingDate: firstRow.booking_date,
      startTime: firstRow.start_time,
      backdated: firstRow.booking_date < salonTodayISO(),
      subtotalHalalas: subtotal,
      discountHalalas: discount,
      totalHalalas: total,
      itemCount: rows.length,
    },
  }, actor).statement);

  for (const row of rows) {
    if (row.unit_price_halalas === row.catalog_unit_price_halalas) continue;
    statements.push(auditInsertStatement(salonId, {
      action: "booking_price_adjusted",
      entityType: "booking_item",
      entityId: row.id,
      description: "Internal booking item price adjusted from catalog price",
      source: "core-booking",
      after: {
        bookingId,
        bookingItemId: row.id,
        serviceId: row.service_id,
        catalogUnitPriceHalalas: row.catalog_unit_price_halalas,
        bookingUnitPriceHalalas: row.unit_price_halalas,
        adjustmentDeltaHalalas:
          row.unit_price_halalas - row.catalog_unit_price_halalas,
        reason: row.price_adjustment_reason,
        note: row.price_adjustment_note,
        adjustedByUid: row.price_adjusted_by_uid,
        adjustedAt: row.price_adjusted_at,
      },
    }, actor).statement);
  }

  for (const action of discountApplication.auditActions || []) {
    statements.push(auditInsertStatement(salonId, {
      action,
      entityType: "booking",
      entityId: bookingId,
      description: "Booking discount verified and applied by Core D1",
      source: "core-booking",
      after: {
        bookingId,
        discountHalalas: discount,
        totalHalalas: total,
      },
      meta: {
        discountSnapshotJson: discountApplication.discountSnapshotJson,
      },
    }, actor).statement);
  }

  try {
    await dbBatch(db, statements);
  } catch (error) {
    if (cleanText(error?.message).toUpperCase().includes("UNIQUE")) {
      if (requestedBookingId) {
        const existing = await dbFirst(
          db,
          "SELECT * FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1",
          [salonId, bookingId]
        );
        if (existing) return getBooking(db, salonId, bookingId);
      }
      throw conflictError();
    }
    throw error;
  }
  return getBooking(db, salonId, bookingId);
}


export async function rescheduleBooking(db, salonId, idValue, data) {
  const bookingId = requiredId(idValue);
  const booking = await getBooking(db, salonId, bookingId);
  const currentStatus = cleanText(booking.status).toLowerCase();
  if (CANCELLED_STATUSES.has(currentStatus) || currentStatus === "completed") {
    throw new AppError(409, "core_booking:reschedule_status_blocked");
  }

  const slotStepMin = integer(
    data.slotStepMin ?? data.slot_step_min ?? booking.slot_step_min,
    "slotStepMin",
    { min: 5, max: 120, fallback: 10 }
  );
  const bufferMin = integer(
    data.bufferMin ?? data.buffer_min ?? booking.buffer_min,
    "bufferMin",
    { min: 0, max: 240, fallback: 0 }
  );
  const requestedItems = Array.isArray(data.items) ? data.items : [];
  const requestedById = new Map(
    requestedItems
      .filter((item) => item && (item.id || item.bookingItemId || item.booking_item_id))
      .map((item) => [cleanText(item.id || item.bookingItemId || item.booking_item_id), item])
  );
  const defaultDate = optionalText(data.bookingDate || data.booking_date || data.date);
  const defaultStart = optionalText(data.startTime || data.start_time || data.time);
  const defaultStaff = data.staffId === null || data.staff_id === null
    ? null
    : optionalText(data.staffId || data.staff_id);

  const nextItems = [];
  const lockRows = [];
  const localLocks = new Set();
  let cursorDate = defaultDate || booking.booking_date;
  let cursorTime = defaultStart || booking.start_time;

  for (let index = 0; index < booking.items.length; index += 1) {
    const current = booking.items[index];
    const patch = requestedById.get(current.id) || requestedItems[index] || {};
    const service = await getService(db, salonId, patch.serviceId || patch.service_id || current.service_id);
    if (!serviceIsActive(service)) {
      throw new AppError(409, "core_booking:service_inactive");
    }
    const quantity = integer(patch.quantity ?? current.quantity, "quantity", { min: 1, max: 20, fallback: 1 });
    const durationMinutes = integer(
      patch.durationMinutes ?? patch.duration_minutes ?? current.duration_minutes ?? Number(service.duration_minutes || 0) * quantity,
      "durationMinutes",
      { min: 1, max: 24 * 60 }
    );
    const bookingDate = validDate(
      patch.bookingDate || patch.booking_date || patch.date || (index === 0 ? defaultDate : "") || current.booking_date || cursorDate,
      `items[${index}].bookingDate`
    );
    const startTime = validTime(
      patch.startTime || patch.start_time || patch.time || (index === 0 ? defaultStart : "") ||
        (defaultStart && bookingDate === cursorDate ? cursorTime : "") || current.start_time,
      `items[${index}].startTime`
    );
    const endTime = validTime(
      patch.endTime || patch.end_time || addMinutes(startTime, durationMinutes),
      `items[${index}].endTime`
    );
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new AppError(400, "core_booking:invalid_time_range");
    }
    if (timeToMinutes(startTime) % slotStepMin !== 0) {
      throw new AppError(400, "core_booking:invalid_slot_alignment");
    }
    const staffId = patch.staffId === null || patch.staff_id === null
      ? null
      : optionalText(patch.staffId || patch.staff_id) || defaultStaff || current.staff_id || booking.staff_id || null;
    if (staffId && !(await staffCanPerformService(db, salonId, staffId, service.id))) {
      throw new AppError(409, "core_booking:staff_service_not_assigned");
    }
    await assertStaffRangeAvailable(
      db,
      salonId,
      staffId,
      bookingDate,
      startTime,
      addMinutes(endTime, bufferMin),
      bookingId
    );

    if (staffId) {
      for (const slotTime of occupiedSlotTimes(startTime, endTime, LOCK_GRANULARITY_MIN, bufferMin)) {
        const lockKey = `${staffId}\u0000${bookingDate}\u0000${slotTime}`;
        if (localLocks.has(lockKey)) throw conflictError();
        localLocks.add(lockKey);
        lockRows.push({
          salon_id: salonId,
          staff_id: staffId,
          booking_date: bookingDate,
          slot_time: slotTime,
          booking_id: bookingId,
          booking_item_id: current.id,
          created_at: nowIso(),
        });
      }
    }

    nextItems.push({
      id: current.id,
      service_id: service.id,
      service_name_snapshot: service.name,
      staff_id: staffId,
      quantity,
      duration_minutes: durationMinutes,
      booking_date: bookingDate,
      start_time: startTime,
      end_time: endTime,
    });
    cursorDate = bookingDate;
    cursorTime = endTime;
  }

  const ordered = [...nextItems].sort((left, right) =>
    compareDateTime(left.booking_date, left.start_time, right.booking_date, right.start_time)
  );
  const first = ordered[0];
  const parentEnd = ordered
    .filter((item) => item.booking_date === first.booking_date)
    .reduce((latest, item) => item.end_time > latest ? item.end_time : latest, first.end_time);
  const parentStaffId = new Set(nextItems.map((item) => item.staff_id).filter(Boolean)).size === 1
    ? nextItems.find((item) => item.staff_id)?.staff_id || null
    : null;
  const now = nowIso();
  const statements = [
    { sql: "DELETE FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ?", params: [salonId, bookingId] },
    ...nextItems.map((item) => ({
      sql: `UPDATE booking_items
               SET service_id = ?, service_name_snapshot = ?, staff_id = ?, quantity = ?, duration_minutes = ?,
                   booking_date = ?, start_time = ?, end_time = ?
             WHERE salon_id = ? AND booking_id = ? AND id = ?`,
      params: [item.service_id, item.service_name_snapshot, item.staff_id, item.quantity, item.duration_minutes,
        item.booking_date, item.start_time, item.end_time, salonId, bookingId, item.id],
    })),
    {
      sql: `UPDATE bookings
               SET staff_id = ?, booking_date = ?, start_time = ?, end_time = ?, slot_step_min = ?, buffer_min = ?,
                   notes = COALESCE(?, notes), updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [parentStaffId, first.booking_date, first.start_time, parentEnd, slotStepMin, bufferMin,
        optionalText(data.notes) || null, now, salonId, bookingId],
    },
    ...lockRows.map((row) => ({
      sql: `INSERT INTO booking_slot_locks
        (salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [row.salon_id, row.staff_id, row.booking_date, row.slot_time, row.booking_id, row.booking_item_id, row.created_at],
    })),
  ];
  try {
    await dbBatch(db, statements);
  } catch (error) {
    if (cleanText(error?.message).toUpperCase().includes("UNIQUE")) throw conflictError();
    throw error;
  }
  return getBooking(db, salonId, bookingId);
}

function bookingPaymentStatus(totalHalalas, paidHalalas) {
  if (paidHalalas <= 0) return "unpaid";
  if (paidHalalas >= totalHalalas) return "paid";
  return "partial";
}

function normalizeEditPaymentRows(data, paidHalalas) {
  if (paidHalalas <= 0) return [];
  const supported = new Set(["cash", "card", "transfer", "other"]);
  const rawBreakdown =
    data.paymentBreakdown && typeof data.paymentBreakdown === "object"
      ? data.paymentBreakdown
      : data.payment_breakdown && typeof data.payment_breakdown === "object"
        ? data.payment_breakdown
        : null;

  if (rawBreakdown) {
    const rows = Object.entries(rawBreakdown)
      .map(([method, amount]) => ({
        method: cleanText(method).toLowerCase(),
        amountHalalas: Math.max(0, Math.round(Number(amount || 0) * 100)),
      }))
      .filter((row) => supported.has(row.method) && row.amountHalalas > 0);
    const total = rows.reduce((sum, row) => sum + row.amountHalalas, 0);
    if (rows.length && total !== paidHalalas) {
      throw new AppError(400, "core_booking:payment_breakdown_mismatch");
    }
    if (rows.length) return rows;
  }

  const requestedMethod = cleanText(data.paymentMethod || data.payment_method).toLowerCase();
  const method = supported.has(requestedMethod) ? requestedMethod : "cash";
  return [{ method, amountHalalas: paidHalalas }];
}

export async function patchBooking(db, salonId, id, data, actor = {}) {
  if (cleanText(data.status).toLowerCase() === "cancelled") {
    return cancelBooking(db, salonId, id, data.reason || data.notes || "");
  }

  const bookingId = requiredId(id);
  const before = await getBooking(db, salonId, bookingId);
  const hasOperationalEdit = [
    data.bookingDate,
    data.booking_date,
    data.date,
    data.startTime,
    data.start_time,
    data.time,
    data.endTime,
    data.end_time,
    data.staffId,
    data.staff_id,
    data.serviceId,
    data.service_id,
    data.durationMinutes,
    data.duration_minutes,
    data.clientName,
    data.client_name,
    data.clientPhone,
    data.client_phone,
    data.totalHalalas,
    data.total_halalas,
    data.paidHalalas,
    data.paid_halalas,
    data.paymentMethod,
    data.payment_method,
    data.paymentBreakdown,
    data.payment_breakdown,
    data.reconcilePayment,
  ].some((value) => value !== undefined);

  if (!hasOperationalEdit) {
    return updateById(db, "bookings", salonId, bookingId, {
      status:
        data.status === undefined ? undefined : cleanText(data.status),
      notes:
        data.notes === undefined
          ? undefined
          : optionalText(data.notes) || null,
      admin_notes:
        data.adminNotes === undefined && data.admin_notes === undefined
          ? undefined
          : optionalText(data.adminNotes ?? data.admin_notes) || null,
      payment_status:
        data.paymentStatus === undefined && data.payment_status === undefined
          ? undefined
          : cleanText(data.paymentStatus || data.payment_status),
      subtotal_halalas:
        data.subtotalHalalas === undefined && data.subtotal_halalas === undefined
          ? undefined
          : integer(data.subtotalHalalas ?? data.subtotal_halalas, "subtotalHalalas", { min: 0, max: 100_000_000 }),
      discount_halalas:
        data.discountHalalas === undefined && data.discount_halalas === undefined
          ? undefined
          : integer(data.discountHalalas ?? data.discount_halalas, "discountHalalas", { min: 0, max: 100_000_000 }),
      total_halalas:
        data.totalHalalas === undefined && data.total_halalas === undefined
          ? undefined
          : integer(data.totalHalalas ?? data.total_halalas, "totalHalalas", { min: 0, max: 100_000_000 }),
    });
  }

  const currentItem = before.items?.[0];
  if (!currentItem) throw new AppError(409, "core_booking:item_missing");

  const serviceId = requiredId(
    data.serviceId || data.service_id || currentItem.service_id,
    "serviceId"
  );
  const service = await getService(db, salonId, serviceId);
  if (!serviceIsActive(service)) {
    throw new AppError(409, "core_booking:service_inactive");
  }

  const bookingDate = validDate(
    data.bookingDate || data.booking_date || data.date || before.booking_date,
    "bookingDate"
  );
  const startTime = validTime(
    data.startTime || data.start_time || data.time || before.start_time,
    "startTime"
  );
  const durationMinutes = integer(
    data.durationMinutes ??
      data.duration_minutes ??
      currentItem.duration_minutes ??
      service.duration_minutes,
    "durationMinutes",
    { min: 1, max: 24 * 60 }
  );
  const endTime = validTime(
    data.endTime || data.end_time || addMinutes(startTime, durationMinutes),
    "endTime"
  );
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    throw new AppError(400, "core_booking:invalid_time_range");
  }

  const staffId =
    data.staffId === null || data.staff_id === null
      ? null
      : optionalText(data.staffId || data.staff_id) ||
        currentItem.staff_id ||
        before.staff_id ||
        null;
  const currentStatus = cleanText(before.status).toLowerCase();
  const shouldHoldSlots =
    !CANCELLED_STATUSES.has(currentStatus) && currentStatus !== "completed";
  const slotStepMin = integer(
    data.slotStepMin ?? data.slot_step_min ?? before.slot_step_min,
    "slotStepMin",
    { min: 5, max: 120, fallback: 10 }
  );
  const bufferMin = integer(
    data.bufferMin ?? data.buffer_min ?? before.buffer_min,
    "bufferMin",
    { min: 0, max: 240, fallback: 0 }
  );

  if (shouldHoldSlots) {
    if (timeToMinutes(startTime) % slotStepMin !== 0) {
      throw new AppError(400, "core_booking:invalid_slot_alignment");
    }
    if (staffId && !(await staffCanPerformService(db, salonId, staffId, service.id))) {
      throw new AppError(409, "core_booking:staff_service_not_assigned");
    }
    await assertStaffRangeAvailable(
      db,
      salonId,
      staffId,
      bookingDate,
      startTime,
      addMinutes(endTime, bufferMin),
      bookingId
    );
  }

  const requestedTotal =
    data.totalHalalas === undefined && data.total_halalas === undefined
      ? Number(before.total_halalas || 0)
      : integer(data.totalHalalas ?? data.total_halalas, "totalHalalas", {
          min: 0,
          max: 100_000_000,
        });
  const discountHalalas = Number(before.discount_halalas || 0);
  const subtotalHalalas = Math.max(requestedTotal, requestedTotal + discountHalalas);
  const invoice = await dbFirst(
    db,
    "SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ? ORDER BY issued_at DESC LIMIT 1",
    [salonId, bookingId]
  );
  const shouldReconcilePayment =
    data.reconcilePayment === true ||
    data.paidHalalas !== undefined ||
    data.paid_halalas !== undefined ||
    data.paymentMethod !== undefined ||
    data.payment_method !== undefined ||
    data.paymentBreakdown !== undefined ||
    data.payment_breakdown !== undefined;
  const paidHalalas = shouldReconcilePayment
    ? integer(data.paidHalalas ?? data.paid_halalas ?? 0, "paidHalalas", {
        min: 0,
        max: requestedTotal,
      })
    : Number(invoice?.paid_halalas || before.paid_halalas || 0);
  const paymentStatus = bookingPaymentStatus(requestedTotal, paidHalalas);
  const clientName =
    data.clientName === undefined && data.client_name === undefined
      ? undefined
      : cleanText(data.clientName || data.client_name);
  const rawClientPhone =
    data.clientPhone === undefined && data.client_phone === undefined
      ? undefined
      : cleanText(data.clientPhone || data.client_phone);
  const clientPhone =
    rawClientPhone === undefined
      ? undefined
      : rawClientPhone
        ? normalizePhone(rawClientPhone)
        : null;
  if (rawClientPhone && !clientPhone) {
    throw new AppError(400, "core_booking:invalid_client_phone");
  }

  const now = nowIso();
  const statements = [
    {
      sql: "DELETE FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ?",
      params: [salonId, bookingId],
    },
    {
      sql: `UPDATE booking_items
               SET service_id = ?, service_name_snapshot = ?, staff_id = ?, duration_minutes = ?,
                   booking_date = ?, start_time = ?, end_time = ?, unit_price_halalas = ?,
                   total_halalas = ?, final_total_halalas = ?
             WHERE salon_id = ? AND booking_id = ? AND id = ?`,
      params: [
        service.id,
        service.name,
        staffId,
        durationMinutes,
        bookingDate,
        startTime,
        endTime,
        subtotalHalalas,
        subtotalHalalas,
        requestedTotal,
        salonId,
        bookingId,
        currentItem.id,
      ],
    },
    {
      sql: `UPDATE bookings
               SET staff_id = ?, booking_date = ?, start_time = ?, end_time = ?,
                   notes = ?, admin_notes = ?, subtotal_halalas = ?, total_halalas = ?, payment_status = ?,
                   slot_step_min = ?, buffer_min = ?, updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [
        staffId,
        bookingDate,
        startTime,
        endTime,
        data.notes === undefined ? before.notes || null : optionalText(data.notes) || null,
        data.adminNotes === undefined && data.admin_notes === undefined
          ? before.admin_notes || null
          : optionalText(data.adminNotes ?? data.admin_notes) || null,
        subtotalHalalas,
        requestedTotal,
        paymentStatus,
        slotStepMin,
        bufferMin,
        now,
        salonId,
        bookingId,
      ],
    },
  ];

  if (clientName !== undefined || clientPhone !== undefined) {
    statements.push({
      sql: `UPDATE clients
               SET name = ?, phone_normalized = ?, updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [
        clientName || before.client_name || "عميلة",
        clientPhone === undefined ? before.client_phone || null : clientPhone,
        now,
        salonId,
        before.client_id,
      ],
    });
  }

  if (invoice) {
    statements.push({
      sql: `UPDATE invoices
               SET subtotal_halalas = ?, discount_halalas = ?, total_halalas = ?,
                   paid_halalas = ?, status = ?, updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [
        subtotalHalalas,
        discountHalalas,
        requestedTotal,
        paidHalalas,
        paymentStatus,
        now,
        salonId,
        invoice.id,
      ],
    });
  }

  if (shouldReconcilePayment) {
    statements.push(
      {
        sql: "DELETE FROM income_entries WHERE salon_id = ? AND booking_id = ? AND payment_id IS NOT NULL",
        params: [salonId, bookingId],
      },
      {
        sql: "DELETE FROM payments WHERE salon_id = ? AND booking_id = ?",
        params: [salonId, bookingId],
      }
    );

    const paymentRows = normalizeEditPaymentRows(data, paidHalalas);
    for (const row of paymentRows) {
      const paymentId = generatedId("payment");
      const incomeId = generatedId("income");
      statements.push(
        {
          sql: `INSERT INTO payments
            (id, salon_id, invoice_id, booking_id, client_id, method, amount_halalas, status,
             provider, provider_reference, idempotency_key, paid_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            paymentId,
            salonId,
            invoice?.id || null,
            bookingId,
            before.client_id,
            row.method,
            row.amountHalalas,
            "paid",
            "dashboard_edit",
            null,
            null,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO income_entries
            (id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description,
             method, payment_breakdown_json, source, note, occurred_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?, ?, 'booking', ?, ?, ?)`,
          params: [
            incomeId,
            salonId,
            bookingId,
            invoice?.id || null,
            paymentId,
            row.amountHalalas,
            `Payment ${row.method}`,
            row.method,
            JSON.stringify({ [row.method]: row.amountHalalas / 100 }),
            `booking_edit_payment:${row.method}`,
            now,
            now,
          ],
        }
      );
    }
  }

  if (shouldHoldSlots && staffId) {
    for (const slotTime of occupiedSlotTimes(
      startTime,
      endTime,
      LOCK_GRANULARITY_MIN,
      bufferMin
    )) {
      statements.push({
        sql: `INSERT INTO booking_slot_locks
          (salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          salonId,
          staffId,
          bookingDate,
          slotTime,
          bookingId,
          currentItem.id,
          now,
        ],
      });
    }
  }

  statements.push(
    auditInsertStatement(
      salonId,
      {
        action: "details_updated",
        entityType: "booking",
        entityId: bookingId,
        description: "Booking details updated from dashboard",
        source: "dashboard",
        before,
        after: {
          clientName: clientName ?? before.client_name,
          clientPhone: clientPhone === undefined ? before.client_phone : clientPhone,
          staffId,
          bookingDate,
          startTime,
          endTime,
          serviceId: service.id,
          serviceName: service.name,
          durationMinutes,
          subtotalHalalas,
          discountHalalas,
          totalHalalas: requestedTotal,
          paidHalalas,
          paymentStatus,
        },
      },
      actor
    ).statement
  );

  try {
    await dbBatch(db, statements);
  } catch (error) {
    if (cleanText(error?.message).toUpperCase().includes("UNIQUE")) {
      throw conflictError();
    }
    throw error;
  }

  await safeRefreshTargetsForBooking(db, salonId, bookingId);
  await reconcileCashbackForBooking(db, salonId, bookingId, actor?.uid || "");
  return getBooking(db, salonId, bookingId);
}


export async function completeBooking(db, salonId, id, actor = {}) {
  const now = nowIso();
  const result = await dbRun(
    db,
    "UPDATE bookings SET status = 'completed', completed_at = ?, updated_at = ? WHERE salon_id = ? AND id = ?",
    [now, now, salonId, requiredId(id)]
  );
  if (!changes(result)) rowNotFound("booking");
  await safeRefreshTargetsForBooking(db, salonId, id);
  await reconcileCashbackForBooking(db, salonId, id, actor?.uid || "");
  return getBooking(db, salonId, id);
}

export async function cancelBooking(db, salonId, id, reason = "") {
  const bookingId = requiredId(id);
  const now = nowIso();
  const results = await dbBatch(db, [
    {
      sql: `UPDATE bookings
               SET status = 'cancelled', cancelled_at = ?, notes = COALESCE(?, notes), updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [
        now,
        optionalText(reason) || null,
        now,
        salonId,
        bookingId,
      ],
    },
    {
      sql: "DELETE FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ?",
      params: [salonId, bookingId],
    },
  ]);
  if (!changes(results[0])) rowNotFound("booking");
  await safeRefreshTargetsForBooking(db, salonId, bookingId);
  return getBooking(db, salonId, bookingId);
}


export async function deleteBooking(db, salonId, id, actor = {}) {
  const bookingId = requiredId(id);
  const booking = await getBooking(db, salonId, bookingId);
  const now = nowIso();
  const actorUid = typeof actor === "string" ? actor : cleanText(actor?.uid);

  const results = await dbBatch(db, [
    {
      sql: `UPDATE bookings
               SET status = 'cancelled',
                   cancelled_at = COALESCE(cancelled_at, ?),
                   deleted_at = ?,
                   deleted_by_uid = ?,
                   delete_reason = ?,
                   updated_at = ?
             WHERE salon_id = ? AND id = ? AND deleted_at IS NULL`,
      params: [
        now,
        now,
        actorUid || null,
        "dashboard_delete",
        now,
        salonId,
        bookingId,
      ],
    },
    {
      sql: "DELETE FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ?",
      params: [salonId, bookingId],
    },
  ]);

  if (!changes(results[0])) rowNotFound("booking");

  await recordAudit(
    db,
    salonId,
    {
      action: "booking_deleted",
      entityType: "booking",
      entityId: bookingId,
      description:
        "Booking removed from dashboard while financial records were preserved",
      before: booking,
      after: {
        id: bookingId,
        status: "cancelled",
        deletedAt: now,
        financialRecordsPreserved: true,
      },
      source: "dashboard",
    },
    actor
  );

  return {
    id: bookingId,
    deleted: true,
    mode: "soft",
    financialRecordsPreserved: true,
  };
}


/** Public slim readout: start times only (no client PII) for ChatBot day slots. */
export async function listTakenBookingTimes(db, salonId, query = {}) {
  const date = requiredText(query.date || query.bookingDate || query.booking_date, 'date', 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'core_validation:invalid_text', 'date must be YYYY-MM-DD');
  }
  const rows = await dbAll(
    db,
    `SELECT DISTINCT b.start_time AS start_time
       FROM bookings b
      WHERE b.salon_id = ?
        AND b.booking_date = ?
        AND b.deleted_at IS NULL
        AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'refunded')
        AND TRIM(COALESCE(b.start_time, '')) <> ''
      ORDER BY b.start_time`,
    [salonId, date]
  );
  return {
    date,
    times: rows.map((row) => cleanText(row.start_time)).filter(Boolean),
  };
}
