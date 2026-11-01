// CORE D1 ONLY: Confirmed booking service-item staff changes are operational.
// Never reuse the historical completed-booking correction workflow or edit money.
import { changes, cleanText, dbAll, dbBatch, dbFirst, nowIso, requiredId } from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertWhenPreviousUpdateChanged } from './audit.js';
import { assertStaffRangeAvailable, occupiedSlotTimes } from './bookings.js';
import { staffCanPerformService } from './booking-staff-policy.js';
import { getStaff, staffIsActive } from './staff.js';

async function context(db, salonId, bookingIdValue, itemIdValue) {
  const bookingId = requiredId(bookingIdValue, 'bookingId');
  const itemId = requiredId(itemIdValue, 'bookingItemId');
  const booking = await dbFirst(db,
    'SELECT id, booking_date, status, deleted_at, staff_id, buffer_min FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, bookingId]);
  if (!booking || booking.deleted_at) throw new AppError(404, 'core_booking:not_found');
  if (cleanText(booking.status).toLowerCase() !== 'confirmed') {
    throw new AppError(409, 'core_booking_item:confirmed_booking_required');
  }
  const item = await dbFirst(db,
    'SELECT id, staff_id, service_id, service_name_snapshot, booking_date, start_time, end_time FROM booking_items WHERE salon_id = ? AND booking_id = ? AND id = ? LIMIT 1',
    [salonId, bookingId, itemId]);
  if (!item) throw new AppError(404, 'core_booking_item:not_found');
  const serviceDate = cleanText(item.booking_date) || cleanText(booking.booking_date);
  return { bookingId, itemId, booking, item, serviceDate };
}

async function assertEmployment(db, salonId, staffId, serviceDate) {
  const row = await dbFirst(db,
    'SELECT start_date, end_date FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1',
    [salonId, staffId]);
  if (!row || !cleanText(row.start_date) || row.start_date > serviceDate ||
      (cleanText(row.end_date) && row.end_date < serviceDate)) {
    throw new AppError(409, 'core_booking_item:target_not_employed_on_service_date');
  }
}

async function assertFinancialSafety(db, salonId, bookingId, serviceDate, oldStaffId, newStaffId) {
  const closed = await dbFirst(db,
    'SELECT id FROM day_audit_closings WHERE salon_id = ? AND audit_date = ? LIMIT 1',
    [salonId, serviceDate]);
  if (closed) throw new AppError(409, 'core_booking_item:closed_financial_day_requires_review');
  const ledger = await dbFirst(db,
    'SELECT id FROM employee_target_ledger WHERE salon_id = ? AND booking_id = ? LIMIT 1',
    [salonId, bookingId]);
  if (ledger) throw new AppError(409, 'core_booking_item:target_ledger_reconciliation_required');
  const locked = await dbFirst(db,
    `SELECT id FROM payroll_entries WHERE salon_id = ? AND payroll_month = ?
      AND employee_id IN (?, ?) AND LOWER(COALESCE(status,'draft')) IN ('approved','paid') LIMIT 1`,
    [salonId, serviceDate.slice(0, 7), oldStaffId, newStaffId]);
  if (locked) throw new AppError(409, 'core_booking_item:approved_payroll_requires_review');
}

// Candidate preview: employment and active service qualification are mandatory.
// Live staff schedule and conflicting bookings are checked here and again on POST.
export async function listConfirmedBookingItemStaffCandidates(db, salonId, bookingId, itemId) {
  const state = await context(db, salonId, bookingId, itemId);
  const { serviceDate, booking, item } = state;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !item.start_time || !item.end_time) {
    throw new AppError(409, 'core_booking_item:service_schedule_requires_review');
  }
  const rows = await dbAll(db,
    `SELECT DISTINCT s.id, s.name
       FROM staff s
       JOIN staff_services ss ON ss.salon_id = s.salon_id AND ss.staff_id = s.id
       JOIN employee_employment e ON e.salon_id = s.salon_id AND e.employee_id = s.id
      WHERE s.salon_id = ? AND s.active = 1 AND ss.active = 1 AND ss.service_id = ?
        AND e.start_date IS NOT NULL AND TRIM(e.start_date) <> '' AND e.start_date <= ?
        AND (e.end_date IS NULL OR TRIM(e.end_date) = '' OR e.end_date >= ?)
      ORDER BY s.name, s.id`,
    [salonId, item.service_id, serviceDate, serviceDate]);
  const candidates = [];
  let excludedLegacyIdentityCount = 0;
  for (const row of rows) {
    const id = cleanText(row.id);
    if (!id || !cleanText(row.name)) continue;
    try {
      if (requiredId(id, 'staffId') !== id) { excludedLegacyIdentityCount += 1; continue; }
    } catch { excludedLegacyIdentityCount += 1; continue; }
    try {
      await assertStaffRangeAvailable(db, salonId, id, serviceDate, item.start_time,
        item.end_time, state.bookingId);
      // Lock collisions against other items in this booking are also excluded.
      const overlap = await dbFirst(db,
        `SELECT 1 AS conflict FROM booking_items bi
           WHERE bi.salon_id = ? AND bi.booking_id = ? AND bi.id <> ?
             AND bi.staff_id = ? AND bi.booking_date = ?
             AND bi.start_time < ? AND bi.end_time > ? LIMIT 1`,
        [salonId, state.bookingId, state.itemId, id, serviceDate, item.end_time, item.start_time]);
      if (!overlap) candidates.push({ id, name: row.name });
    } catch (error) {
      if (['core_booking:staff_unavailable','core_booking:staff_inactive','core_booking:staff_slot_conflict'].includes(error?.code)) continue;
      throw error;
    }
  }
  return { serviceDate, candidates, excludedLegacyIdentityCount };
}

export async function changeConfirmedBookingItemStaff(db, salonId, bookingIdValue, data = {}, actor = {}) {
  const itemId = requiredId(data.bookingItemId, 'bookingItemId');
  const rawTarget = cleanText(data.staffId);
  const newStaffId = requiredId(rawTarget, 'staffId');
  if (newStaffId !== rawTarget) throw new AppError(409, 'core_booking_item:noncanonical_staff_identity_requires_review');
  if (!Object.hasOwn(data, 'expectedStaffId')) throw new AppError(400, 'core_booking_item:expected_staff_required');
  const oldExpected = cleanText(data.expectedStaffId);
  const reason = cleanText(data.reason);
  if (reason.length < 10 || reason.length > 1000) throw new AppError(400, 'core_booking_item:change_reason_required');
  if (!cleanText(actor.uid) || !cleanText(actor.userId)) throw new AppError(403, 'core_booking_item:authenticated_actor_required');

  const { bookingId, booking, item, serviceDate } = await context(db, salonId, bookingIdValue, itemId);
  const oldStaffId = cleanText(item.staff_id);
  if (oldExpected !== oldStaffId) throw new AppError(409, 'core_booking_item:concurrent_staff_change');
  if (oldStaffId === newStaffId) return { bookingId, bookingItemId: itemId, staffId: newStaffId, unchanged: true };
  // An unassigned or inconsistent legacy booking requires its own repair path.
  if (!oldStaffId || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !item.start_time || !item.end_time) {
    throw new AppError(409, 'core_booking_item:service_schedule_requires_review');
  }
  const target = await getStaff(db, salonId, newStaffId);
  if (!staffIsActive(target)) throw new AppError(409, 'core_booking:staff_inactive');
  await assertEmployment(db, salonId, newStaffId, serviceDate);
  if (!(await staffCanPerformService(db, salonId, newStaffId, item.service_id))) {
    throw new AppError(409, 'core_booking:staff_service_not_assigned');
  }
  const bufferMin = Math.max(0, Math.min(240, Number(booking.buffer_min || 0)));
  const slots = occupiedSlotTimes(item.start_time, item.end_time, 5, bufferMin);
  if (!slots.length) throw new AppError(409, 'core_booking_item:slot_integrity_requires_review');
  const existingLocks = await dbAll(db,
    'SELECT staff_id, booking_date, slot_time FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ? AND booking_item_id = ? ORDER BY slot_time',
    [salonId, bookingId, itemId]);
  if (existingLocks.length !== slots.length || existingLocks.some((row, i) =>
    cleanText(row.staff_id) !== oldStaffId || cleanText(row.booking_date) !== serviceDate || row.slot_time !== slots[i])) {
    throw new AppError(409, 'core_booking_item:slot_integrity_requires_review');
  }
  await assertStaffRangeAvailable(db, salonId, newStaffId, serviceDate, item.start_time,
    item.end_time, bookingId);
  await assertFinancialSafety(db, salonId, bookingId, serviceDate, oldStaffId, newStaffId);

  const audit = auditInsertWhenPreviousUpdateChanged(salonId, {
    action: 'booking_item_staff_operational_changed',
    entityType: 'booking_item',
    entityId: itemId,
    source: 'core-booking-attribution',
    description: reason,
    before: { bookingId, itemId, staffId: oldStaffId, serviceDate, serviceId: item.service_id },
    after: { bookingId, itemId, staffId: newStaffId, staffName: target.name, serviceDate },
    meta: { reason, parentBookingStatus: 'confirmed', financialLedgerChanged: false },
  }, actor);
  const slotMarks = slots.map(() => '?').join(',');
  const lockArgs = [salonId, bookingId, itemId, oldStaffId, serviceDate];
  // The lock transfer, item CAS and audit run in ONE D1 transaction. The
  // unique staff/date/slot key rejects races with simultaneous reservations.
  const statements = [
    {
      sql: `UPDATE booking_slot_locks SET staff_id = ?
        WHERE salon_id = ? AND booking_id = ? AND booking_item_id = ?
          AND staff_id = ? AND booking_date = ? AND slot_time IN (${slotMarks})
          AND (SELECT COUNT(*) FROM booking_slot_locks
                WHERE salon_id = ? AND booking_id = ? AND booking_item_id = ?) = ?
          AND EXISTS (SELECT 1 FROM bookings
                WHERE salon_id = ? AND id = ? AND deleted_at IS NULL AND LOWER(status) = 'confirmed')
          AND EXISTS (SELECT 1 FROM booking_items
                WHERE salon_id = ? AND booking_id = ? AND id = ? AND staff_id = ?
                  AND booking_date = ? AND start_time = ? AND end_time = ?)
          AND NOT EXISTS (SELECT 1 FROM day_audit_closings WHERE salon_id = ? AND audit_date = ?)
          AND NOT EXISTS (SELECT 1 FROM employee_target_ledger WHERE salon_id = ? AND booking_id = ?)
          AND NOT EXISTS (SELECT 1 FROM payroll_entries WHERE salon_id = ?
            AND payroll_month = ? AND employee_id IN (?, ?)
            AND LOWER(COALESCE(status,'draft')) IN ('approved','paid'))`,
      params: [newStaffId, ...lockArgs, ...slots, salonId, bookingId, itemId, slots.length,
        salonId, bookingId, salonId, bookingId, itemId, oldStaffId, serviceDate, item.start_time, item.end_time,
        salonId, serviceDate, salonId, bookingId, salonId, serviceDate.slice(0,7), oldStaffId, newStaffId],
    },
    {
      sql: `UPDATE booking_items SET staff_id = ?
        WHERE salon_id = ? AND booking_id = ? AND id = ? AND COALESCE(staff_id,'') = ?
          AND booking_date = ? AND start_time = ? AND end_time = ?
          AND EXISTS (SELECT 1 FROM bookings WHERE salon_id = ? AND id = ?
                      AND deleted_at IS NULL AND LOWER(status) = 'confirmed')
          AND (SELECT COUNT(*) FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ?
               AND booking_item_id = ? AND staff_id = ? AND booking_date = ?) = ?
          AND (SELECT COUNT(*) FROM booking_slot_locks WHERE salon_id = ? AND booking_id = ?
               AND booking_item_id = ?) = ?`,
      params: [newStaffId, salonId, bookingId, itemId, oldStaffId,
        serviceDate, item.start_time, item.end_time, salonId, bookingId,
        salonId, bookingId, itemId, newStaffId, serviceDate, slots.length,
        salonId, bookingId, itemId, slots.length],
    },
    audit.statement,
    {
      sql: `UPDATE bookings SET
          staff_id = (SELECT CASE WHEN COUNT(DISTINCT staff_id) = 1
                     THEN MAX(staff_id) ELSE NULL END FROM booking_items
                     WHERE salon_id = ? AND booking_id = ?),
          updated_at = ?
        WHERE salon_id = ? AND id = ? AND LOWER(status) = 'confirmed'
          AND EXISTS (SELECT 1 FROM audit_logs WHERE salon_id = ? AND id = ?)`,
      params: [salonId, bookingId, nowIso(), salonId, bookingId, salonId, audit.row.id],
    }
  ];
  let result;
  try {
    result = await dbBatch(db, statements);
  } catch (error) {
    const message = cleanText(error?.message).toUpperCase();
    if (message.includes('BOOKING_SLOT_LOCKS') &&
        (message.includes('UNIQUE') || message.includes('PRIMARY KEY'))) {
      throw new AppError(409, 'core_booking:staff_slot_conflict');
    }
    throw error;
  }
  if (changes(result[0]) !== slots.length || changes(result[1]) !== 1) {
    throw new AppError(409, 'core_booking_item:concurrent_staff_change');
  }
  return { bookingId, bookingItemId: itemId, staffId: newStaffId, staffName: target.name,
    unchanged: false };
}
