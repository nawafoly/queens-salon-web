// CORE D1 ONLY — do not add Firestore fallback.

import {
  addMinutes,
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
import { getStaff, staffIsActive } from './staff.js';

function normalizeItems(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) throw new Error("booking_items_required");
  return items;
}

async function assertNoStaffConflict(db, salonId, staffId, bookingDate, startTime, excludeBookingId = "") {
  if (!staffId) return;
  const existing = await dbFirst(
    db,
    `SELECT id FROM bookings
      WHERE salon_id = ? AND staff_id = ? AND booking_date = ? AND start_time = ?
        AND status NOT IN ('cancelled') AND id != ?
      LIMIT 1`,
    [salonId, staffId, bookingDate, startTime, excludeBookingId]
  );
  if (existing) {
    const error = new Error("booking_conflict");
    error.code = "core_booking:staff_slot_conflict";
    throw error;
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
    if (staffId && cleanText(row.staff_id) !== staffId) return false;
    if (status && cleanText(row.status) !== status) return false;
    if (!search) return true;
    return [
      row.id,
      row.public_id,
      row.client_id,
      row.client_name,
      row.client_phone,
      row.staff_name,
      ...(row.items || []).map((item) => item.service_name_snapshot),
    ].some((value) =>
      cleanText(value).toLowerCase().includes(search)
    );
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
      "SELECT * FROM booking_items WHERE booking_id = ? ORDER BY created_at, id",
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
  const clientId = requiredId(data.clientId || data.client_id, "clientId");
  const bookingDate = validDate(data.bookingDate || data.booking_date || data.date, "bookingDate");
  const startTime = validTime(data.startTime || data.start_time || data.time, "startTime");
  const staffId = optionalText(data.staffId || data.staff_id) || null;
  const now = nowIso();
  await getClient(db, salonId, clientId);
  if (staffId) {
    const staff = await getStaff(db, salonId, staffId);
    if (!staffIsActive(staff)) {
      const error = new Error("staff_inactive");
      error.code = "core_booking:staff_inactive";
      throw error;
    }
  }
  await assertNoStaffConflict(db, salonId, staffId, bookingDate, startTime);

  const itemInputs = normalizeItems(data);
  const rows = [];
  let subtotal = 0;
  let duration = 0;
  for (const item of itemInputs) {
    const service = await getService(db, salonId, item.serviceId || item.service_id);
    if (!serviceIsActive(service)) {
      const error = new Error("service_inactive");
      error.code = "core_booking:service_inactive";
      throw error;
    }
    const quantity = integer(item.quantity, "quantity", { min: 1, max: 20, fallback: 1 });
    const unit = integer(item.unitPriceHalalas ?? item.unit_price_halalas ?? service.price_halalas, "unitPriceHalalas", { min: 0, max: 10_000_000 });
    const total = unit * quantity;
    subtotal += total;
    duration += Number(service.duration_minutes || 0) * quantity;
    rows.push({
      id: requiredId(item.id || generatedId("booking_item")),
      service_id: service.id,
      service_name_snapshot: service.name,
      staff_id: optionalText(item.staffId || item.staff_id) || staffId,
      quantity,
      unit_price_halalas: unit,
      total_halalas: total,
      package_covered: item.packageCovered ? 1 : 0,
      client_package_id: optionalText(item.clientPackageId || item.client_package_id) || null,
      duration_minutes: Number(service.duration_minutes || 0) * quantity,
    });
  }
  const discount = integer(data.discountHalalas ?? data.discount_halalas, "discountHalalas", { min: 0, max: subtotal, fallback: 0 });
  const total = Math.max(0, subtotal - discount);
  const bookingId = requiredId(data.id || generatedId("booking"));
  const publicId = optionalText(data.publicId || data.public_id) || bookingId;
  const invoiceId = data.createInvoice === false ? "" : requiredId(data.invoiceId || generatedId("invoice"));
  const invoiceNumber = optionalText(data.invoiceNumber || data.invoice_number) || invoiceId || null;
  const endTime = optionalText(data.endTime || data.end_time) || addMinutes(startTime, duration);
  const statements = [
    {
      sql: `INSERT INTO bookings
        (id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes,
         subtotal_halalas, discount_halalas, total_halalas, payment_status, package_sessions_used,
         created_by_uid, created_at, updated_at, cancelled_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, NULL, NULL)`,
      params: [
        bookingId,
        publicId,
        salonId,
        clientId,
        staffId,
        bookingDate,
        startTime,
        endTime,
        cleanText(data.status || "booked"),
        optionalText(data.source) || "dashboard",
        optionalText(data.notes) || null,
        subtotal,
        discount,
        total,
        integer(data.packageSessionsUsed ?? data.package_sessions_used, "packageSessionsUsed", { min: 0, max: 100, fallback: 0 }),
        actorUid || null,
        now,
        now,
      ],
    },
    ...rows.map((row) => ({
      sql: `INSERT INTO booking_items
        (id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity,
         unit_price_halalas, total_halalas, package_covered, client_package_id, duration_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    })),
  ];
  if (invoiceId) {
    statements.push({
      sql: `INSERT INTO invoices
        (id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas,
         total_halalas, paid_halalas, status, issued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?, ?, ?)`,
      params: [invoiceId, salonId, bookingId, clientId, invoiceNumber, subtotal, discount, total, now, now, now],
    });
  }
  try {
    await dbBatch(db, statements);
  } catch (error) {
    if (cleanText(error?.message).includes("UNIQUE")) {
      const conflict = new Error("booking_conflict");
      conflict.code = "core_booking:staff_slot_conflict";
      throw conflict;
    }
    throw error;
  }
  return getBooking(db, salonId, bookingId);
}

export async function patchBooking(db, salonId, id, data) {
  return updateById(db, "bookings", salonId, requiredId(id), {
    status: data.status === undefined ? undefined : cleanText(data.status),
    notes: data.notes === undefined ? undefined : (optionalText(data.notes) || null),
    payment_status: data.paymentStatus === undefined && data.payment_status === undefined ? undefined : cleanText(data.paymentStatus || data.payment_status),
  });
}

export async function completeBooking(db, salonId, id) {
  const now = nowIso();
  const result = await dbRun(db, "UPDATE bookings SET status = 'completed', completed_at = ?, updated_at = ? WHERE salon_id = ? AND id = ?", [
    now,
    now,
    salonId,
    requiredId(id),
  ]);
  if (!Number(result?.meta?.changes ?? result?.changes ?? 0)) rowNotFound("booking");
  return getBooking(db, salonId, id);
}

export async function cancelBooking(db, salonId, id, reason = "") {
  const now = nowIso();
  const result = await dbRun(db, "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, notes = COALESCE(?, notes), updated_at = ? WHERE salon_id = ? AND id = ?", [
    now,
    optionalText(reason) || null,
    now,
    salonId,
    requiredId(id),
  ]);
  if (!Number(result?.meta?.changes ?? result?.changes ?? 0)) rowNotFound("booking");
  return getBooking(db, salonId, id);
}
