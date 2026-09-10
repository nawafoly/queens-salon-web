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
import { getBooking, listBookings } from './bookings.js';
import { getSetting } from './settings.js';

const SELF_STATUS_TRANSITIONS = new Map([
  ['pending', new Set(['confirmed', 'cancelled'])],
  ['confirmed', new Set(['completed', 'cancelled'])],
]);

function projectOwnBooking(row, employeeId) {
  const ownEmployeeId = cleanText(employeeId);
  const topLevelAssigned = cleanText(row?.staff_id) === ownEmployeeId;
  const items = (Array.isArray(row?.items) ? row.items : [])
    .filter((item) => {
      const itemStaffId = cleanText(item?.staff_id);
      return itemStaffId === ownEmployeeId || (topLevelAssigned && !itemStaffId);
    })
    .map((item) => ({
      id: item.id,
      booking_id: item.booking_id,
      salon_id: item.salon_id,
      service_id: item.service_id,
      service_name_snapshot: item.service_name_snapshot,
      staff_id: item.staff_id,
      staff_name: item.staff_name,
      booking_date: item.booking_date,
      start_time: item.start_time,
      end_time: item.end_time,
      duration_minutes: item.duration_minutes,
      created_at: item.created_at,
    }));

  return {
    id: row.id,
    public_id: row.public_id,
    salon_id: row.salon_id,
    client_id: row.client_id,
    client_name: row.client_name,
    client_phone: row.client_phone,
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    booking_date: row.booking_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    source: row.source,
    staff_ack: Number(row.staff_ack) === 1 ? 1 : 0,
    staff_ack_at: row.staff_ack_at || null,
    staff_ack_by_uid: row.staff_ack_by_uid || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cancelled_at: row.cancelled_at || null,
    completed_at: row.completed_at || null,
    items,
  };
}

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

async function projectedBookingById(db, salonId, bookingId, employeeId) {
  await assignedBooking(db, salonId, bookingId, employeeId);
  return projectOwnBooking(await getBooking(db, salonId, bookingId), employeeId);
}

export async function listOwnStaffBookings(db, salonId, employeeId, query = {}) {
  const ownEmployeeId = requiredId(employeeId, 'employeeId');
  const rows = await listBookings(db, salonId, {
    ...query,
    staffId: ownEmployeeId,
  });
  return rows.map((row) => projectOwnBooking(row, ownEmployeeId));
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
  if (Number(before.staff_ack) === 1) {
    return projectedBookingById(db, salonId, before.id, employeeId);
  }

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

  const after = await projectedBookingById(db, salonId, before.id, employeeId);
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

  const after = await projectedBookingById(db, salonId, before.id, employeeId);
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
