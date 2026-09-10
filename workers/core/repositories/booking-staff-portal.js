// CORE D1 ONLY — employee booking self-service authority.

import {
  changes,
  cleanText,
  dbFirst,
  dbRun,
  nowIso,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { recordAudit } from './audit.js';
import { getBooking } from './bookings.js';
import { getSetting } from './settings.js';

const SELF_STATUS_TRANSITIONS = new Map([
  ['pending', new Set(['confirmed', 'cancelled'])],
  ['confirmed', new Set(['completed', 'cancelled'])],
]);

async function assignedBooking(db, salonId, bookingId, employeeId) {
  const id = requiredId(bookingId, 'bookingId');
  const staffId = requiredId(employeeId, 'employeeId');
  const row = await dbFirst(
    db,
    `SELECT b.*
       FROM bookings b
      WHERE b.salon_id = ?
        AND b.id = ?
        AND b.deleted_at IS NULL
        AND (
          b.staff_id = ?
          OR EXISTS (
            SELECT 1
              FROM booking_items bi
             WHERE bi.salon_id = b.salon_id
               AND bi.booking_id = b.id
               AND bi.staff_id = ?
          )
        )
      LIMIT 1`,
    [salonId, id, staffId, staffId]
  );
  if (!row) throw new AppError(404, 'core_booking:not_found');
  return row;
}

async function assertStaffStatusChangeEnabled(db, salonId) {
  const setting = await getSetting(db, salonId, 'app');
  if (setting?.value?.policies?.allowStaffChangeStatus === true) return;
  throw new AppError(
    403,
    'core_booking:staff_status_change_disabled',
    'Staff booking status changes are disabled by salon policy.'
  );
}

export async function acknowledgeOwnBooking(
  db,
  salonId,
  bookingId,
  employeeId,
  actor = {}
) {
  const before = await assignedBooking(db, salonId, bookingId, employeeId);
  if (Number(before.staff_ack) === 1) return getBooking(db, salonId, before.id);

  const now = nowIso();
  const result = await dbRun(
    db,
    `UPDATE bookings
        SET staff_ack = 1,
            staff_ack_at = ?,
            staff_ack_by_uid = ?,
            updated_at = ?
      WHERE salon_id = ?
        AND id = ?
        AND staff_ack = 0`,
    [now, cleanText(actor.uid) || null, now, salonId, before.id]
  );

  if (changes(result) !== 1) {
    const current = await assignedBooking(db, salonId, before.id, employeeId);
    if (Number(current.staff_ack) !== 1) {
      throw new AppError(409, 'core_booking:staff_ack_conflict');
    }
  }

  const after = await getBooking(db, salonId, before.id);
  await recordAudit(
    db,
    salonId,
    {
      action: 'booking_staff_acknowledged',
      entityType: 'booking',
      entityId: before.id,
      description: 'Booking receipt acknowledged by the assigned employee.',
      before: {
        staffAck: Number(before.staff_ack) === 1,
        staffAckAt: before.staff_ack_at || null,
        staffAckByUid: before.staff_ack_by_uid || null,
      },
      after: {
        staffAck: true,
        staffAckAt: after.staff_ack_at || now,
        staffAckByUid: after.staff_ack_by_uid || cleanText(actor.uid) || null,
      },
      meta: { employeeId },
    },
    actor
  );
  return after;
}

export async function updateOwnBookingStatus(
  db,
  salonId,
  bookingId,
  employeeId,
  statusValue,
  actor = {}
) {
  await assertStaffStatusChangeEnabled(db, salonId);
  const before = await assignedBooking(db, salonId, bookingId, employeeId);
  const fromStatus = cleanText(before.status || 'pending').toLowerCase();
  const toStatus = cleanText(statusValue).toLowerCase();
  const allowed = SELF_STATUS_TRANSITIONS.get(fromStatus);
  if (!allowed?.has(toStatus)) {
    throw new AppError(
      409,
      'core_booking:invalid_staff_status_transition',
      'The requested staff booking status transition is not allowed.'
    );
  }

  const now = nowIso();
  const completedAt = toStatus === 'completed' ? now : null;
  const cancelledAt = toStatus === 'cancelled' ? now : null;
  const result = await dbRun(
    db,
    `UPDATE bookings
        SET status = ?,
            completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
            cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
            updated_at = ?
      WHERE salon_id = ?
        AND id = ?
        AND LOWER(status) = ?`,
    [
      toStatus,
      toStatus,
      completedAt,
      toStatus,
      cancelledAt,
      now,
      salonId,
      before.id,
      fromStatus,
    ]
  );
  if (changes(result) !== 1) {
    throw new AppError(409, 'core_booking:status_changed');
  }

  const after = await getBooking(db, salonId, before.id);
  await recordAudit(
    db,
    salonId,
    {
      action: 'booking_staff_status_updated',
      entityType: 'booking',
      entityId: before.id,
      description: 'Booking status changed by the assigned employee portal.',
      before: { status: fromStatus },
      after: { status: toStatus },
      meta: { employeeId },
    },
    actor
  );
  return after;
}
