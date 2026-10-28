// CORE D1 ONLY. Audited correction of a specific service's historical staff
// attribution. This must never write to payments, income or invoices.
import { changes, cleanText, dbBatch, dbFirst, nowIso, requiredId } from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertWhenPreviousUpdateChanged } from './audit.js';

export async function correctCompletedBookingItemStaff(db, salonId, bookingIdValue, data = {}, actor = {}) {
  const bookingId = requiredId(bookingIdValue, 'bookingId');
  const itemId = requiredId(data.bookingItemId, 'bookingItemId');
  const requestedStaffId = cleanText(data.staffId);
  const nextStaffId = requiredId(data.staffId, 'staffId');
  // requiredId decodes legacy percent-escaped IDs. Never silently redirect
  // a human historical correction to a different physical staff record.
  if (requestedStaffId !== nextStaffId) {
    throw new AppError(409, 'core_booking_item:noncanonical_staff_identity_requires_review');
  }
  const reason = cleanText(data.reason);
  const expectedStaffId = data.expectedStaffId == null ? '' : cleanText(data.expectedStaffId);

  if (!Object.hasOwn(data, 'expectedStaffId')) {
    throw new AppError(400, 'core_booking_item:expected_staff_required');
  }
  if (reason.length < 10 || reason.length > 1000) {
    throw new AppError(400, 'core_booking_item:correction_reason_required');
  }
  if (!cleanText(actor.uid) || !cleanText(actor.userId)) {
    throw new AppError(403, 'core_booking_item:authenticated_actor_required');
  }

  const booking = await dbFirst(db,
    'SELECT id, public_id, booking_date, status, deleted_at, completed_at FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, bookingId]);
  if (!booking || booking.deleted_at) throw new AppError(404, 'core_booking:not_found');
  if (cleanText(booking.status).toLowerCase() !== 'completed') {
    throw new AppError(409, 'core_booking_item:completed_booking_required');
  }

  const item = await dbFirst(db,
    'SELECT id, booking_id, staff_id, service_id, service_name_snapshot, booking_date FROM booking_items WHERE salon_id = ? AND booking_id = ? AND id = ? LIMIT 1',
    [salonId, bookingId, itemId]);
  if (!item) throw new AppError(404, 'core_booking_item:not_found');

  const previousStaffId = cleanText(item.staff_id);
  if (previousStaffId === nextStaffId) return { bookingId, bookingItemId: itemId, staffId: nextStaffId, unchanged: true };
  if (previousStaffId !== expectedStaffId) {
    throw new AppError(409, 'core_booking_item:concurrent_staff_change');
  }

  const target = await dbFirst(db,
    'SELECT id, name FROM staff WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, nextStaffId]);
  if (!target) throw new AppError(404, 'core_booking_item:target_staff_not_found');

  const workDate = cleanText(item.booking_date) || cleanText(booking.booking_date);
  const employment = await dbFirst(db,
    'SELECT start_date, end_date FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1',
    [salonId, nextStaffId]);
  // No invented historical eligibility: require the canonical HR employment
  // period to include the date when this service was actually delivered.
  if (!employment || !cleanText(employment.start_date) || workDate < cleanText(employment.start_date) ||
      (cleanText(employment.end_date) && workDate > cleanText(employment.end_date))) {
    throw new AppError(409, 'core_booking_item:target_not_employed_on_service_date');
  }

  // Historical specialist attribution can change an already closed day's
  // specialist KPI/read models even when the money ledger stays immutable.
  const closedDay = await dbFirst(db,
    'SELECT id FROM day_audit_closings WHERE salon_id = ? AND audit_date = ? LIMIT 1',
    [salonId, workDate]);
  if (closedDay) throw new AppError(409, 'core_booking_item:closed_financial_day_requires_review');

  const payrollMonth = workDate.slice(0, 7);
  const lockedPayroll = await dbFirst(db,
    `SELECT id FROM payroll_entries
      WHERE salon_id = ? AND payroll_month = ?
        AND employee_id IN (?, ?)
        AND LOWER(COALESCE(status, 'draft')) IN ('approved', 'paid')
      LIMIT 1`,
    [salonId, payrollMonth, previousStaffId, nextStaffId]);
  if (lockedPayroll) {
    throw new AppError(409, 'core_booking_item:approved_payroll_requires_review');
  }

  const now = nowIso();
  const update = {
    sql: `UPDATE booking_items
         SET staff_id = ?
         WHERE salon_id = ? AND booking_id = ? AND id = ?
           AND COALESCE(staff_id, '') = ?
           AND NOT EXISTS (SELECT 1 FROM day_audit_closings
             WHERE salon_id = ? AND audit_date = ?)
           AND EXISTS (SELECT 1 FROM bookings
              WHERE salon_id = ? AND id = ? AND deleted_at IS NULL
              AND LOWER(status) = 'completed')`,
    params: [nextStaffId, salonId, bookingId, itemId, expectedStaffId, salonId, workDate, salonId, bookingId],
  };
  const audit = auditInsertWhenPreviousUpdateChanged(salonId, {
    action: 'booking_item_staff_attribution_corrected',
    entityType: 'booking_item',
    entityId: itemId,
    description: reason,
    source: 'core-booking-attribution',
    before: { bookingId, itemId, staffId: previousStaffId, serviceId: item.service_id, serviceName: item.service_name_snapshot, serviceDate: workDate },
    after: { bookingId, itemId, staffId: nextStaffId, staffName: target.name, serviceDate: workDate },
    meta: { reason, parentBookingStatus: 'completed', financialLedgerChanged: false },
  }, actor).statement;
  const result = await dbBatch(db, [update, audit]);
  if (!changes(result[0])) throw new AppError(409, 'core_booking_item:concurrent_staff_change');
  return { bookingId, bookingItemId: itemId, staffId: nextStaffId, staffName: target.name, unchanged: false, correctedAt: now };
}
