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
  optionalText,
  requiredId,
  rowNotFound,
  updateById,
  validDate,
  validTime,
} from '../d1.js';
import { getClient } from './clients.js';
import { getService, serviceIsActive } from './services.js';
import {
  getStaff,
  staffIsActive,
  staffIsAvailableForDate,
} from './staff.js';

const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "rejected"]);
const LOCK_GRANULARITY_MIN = 5;

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
  if (!staffIsAvailableForDate(staff, bookingDate, startTime, endTime)) {
    const error = new Error("staff_unavailable");
    error.code = "core_booking:staff_unavailable";
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
  const rows = date
    ? await dbAll(
        db,
        "SELECT * FROM bookings WHERE salon_id = ? AND booking_date = ? ORDER BY start_time LIMIT 500",
        [salonId, date]
      )
    : await dbAll(
        db,
        "SELECT * FROM bookings WHERE salon_id = ? ORDER BY booking_date DESC, start_time DESC LIMIT 500",
        [salonId]
      );

  const enriched = await Promise.all(
    rows.map((row) => getBooking(db, salonId, row.id))
  );
  const search = cleanText(query.search || query.q).toLowerCase();
  const clientId = cleanText(query.clientId || query.client_id);
  const staffId = cleanText(query.staffId || query.staff_id);
  const status = cleanText(query.status);

  return enriched.filter((row) => {
    if (clientId && cleanText(row.client_id) !== clientId) return false;
    if (
      staffId &&
      cleanText(row.staff_id) !== staffId &&
      !(row.items || []).some((item) => cleanText(item.staff_id) === staffId)
    ) {
      return false;
    }
    if (status && cleanText(row.status) !== status) return false;
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

export async function getBooking(db, salonId, id) {
  const booking = await dbFirst(
    db,
    "SELECT * FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1",
    [salonId, requiredId(id)]
  );
  if (!booking) rowNotFound("booking");

  const [items, client, staff] = await Promise.all([
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
  ]);

  return {
    ...booking,
    client_name: client?.name || null,
    client_phone: client?.phone_normalized || null,
    staff_name: staff?.name || null,
    items,
  };
}

export async function createBooking(db, salonId, data, actorUid = "") {
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
    const service = await getService(
      db,
      salonId,
      item.serviceId || item.service_id
    );
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
    const unit = integer(
      item.unitPriceHalalas ??
        item.unit_price_halalas ??
        service.price_halalas,
      "unitPriceHalalas",
      { min: 0, max: 10_000_000 }
    );
    const total = unit * quantity;
    const durationMinutes = Math.max(
      1,
      Number(service.duration_minutes || 0) * quantity
    );
    const bookingDate = validDate(
      item.bookingDate || item.booking_date || item.date || cursorDate,
      `items[${index}].bookingDate`
    );
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
      service_name_snapshot: service.name,
      staff_id: staffId,
      quantity,
      unit_price_halalas: unit,
      total_halalas: total,
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

  const discount = integer(
    data.discountHalalas ?? data.discount_halalas,
    "discountHalalas",
    { min: 0, max: subtotal, fallback: 0 }
  );
  const total = Math.max(0, subtotal - discount);
  const bookingId = requiredId(requestedBookingId || generatedId("booking"));
  const publicId = optionalText(data.publicId || data.public_id) || bookingId;
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

  const statements = [
    {
      sql: `INSERT INTO bookings
        (id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes,
         subtotal_halalas, discount_halalas, total_halalas, payment_status, package_sessions_used,
         created_by_uid, created_at, updated_at, cancelled_at, completed_at, slot_step_min, buffer_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      params: [
        bookingId,
        publicId,
        salonId,
        clientId,
        resolvedParentStaffId,
        firstRow.booking_date,
        firstRow.start_time,
        parentEnd,
        cleanText(data.status || "booked"),
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
      ],
    },
    ...rows.map((row) => ({
      sql: `INSERT INTO booking_items
        (id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity,
         unit_price_halalas, total_halalas, package_covered, client_package_id, duration_minutes, created_at,
         booking_date, start_time, end_time, cart_item_id, package_reservation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id,
        bookingId,
        salonId,
        row.service_id,
        row.service_name_snapshot,
        row.staff_id,
        row.quantity,
        row.unit_price_halalas,
        row.total_halalas,
        row.package_covered,
        row.client_package_id,
        row.duration_minutes,
        now,
        row.booking_date,
        row.start_time,
        row.end_time,
        row.cart_item_id,
        row.package_reservation_id,
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
         total_halalas, paid_halalas, status, issued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?, ?, ?)`,
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
      ],
    });
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

export async function patchBooking(db, salonId, id, data) {
  if (cleanText(data.status).toLowerCase() === "cancelled") {
    return cancelBooking(db, salonId, id, data.reason || data.notes || "");
  }
  return updateById(db, "bookings", salonId, requiredId(id), {
    status:
      data.status === undefined ? undefined : cleanText(data.status),
    notes:
      data.notes === undefined
        ? undefined
        : optionalText(data.notes) || null,
    payment_status:
      data.paymentStatus === undefined && data.payment_status === undefined
        ? undefined
        : cleanText(data.paymentStatus || data.payment_status),
  });
}

export async function completeBooking(db, salonId, id) {
  const now = nowIso();
  const result = await dbRun(
    db,
    "UPDATE bookings SET status = 'completed', completed_at = ?, updated_at = ? WHERE salon_id = ? AND id = ?",
    [now, now, salonId, requiredId(id)]
  );
  if (!changes(result)) rowNotFound("booking");
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
  return getBooking(db, salonId, bookingId);
}
