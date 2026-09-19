// CORE D1 ONLY — employee booking self-service authority.

import {
  changes,
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  nowIso,
  placeholders,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { recordAudit } from './audit.js';
import { getBooking, listBookings } from './bookings.js';
import { getSetting } from './settings.js';

const SELF_STATUS_TRANSITIONS = new Map([
  ['pending', new Set(['confirmed', 'cancelled'])],
  ['booked', new Set(['completed', 'cancelled'])],
  ['confirmed', new Set(['completed', 'cancelled'])],
]);

const SALON_TZ = 'Asia/Riyadh';

function salonClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const read = (type) =>
    parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`,
  };
}

async function assertBookingCompletionReady(
  db,
  salonId,
  booking,
  employeeId
) {
  const rows = await dbAll(
    db,
    `SELECT
       bi.id AS booking_item_id,
       COALESCE(bi.booking_date, b.booking_date) AS booking_date,
       COALESCE(bi.start_time, b.start_time) AS start_time,
       CASE
         WHEN EXISTS (
           SELECT 1
             FROM service_consumption_recipes r
             JOIN service_consumption_recipe_lines rl
               ON rl.salon_id = r.salon_id
              AND rl.recipe_id = r.id
            WHERE r.salon_id = bi.salon_id
              AND r.service_id = bi.service_id
              AND r.is_active = 1
         )
         THEN 1
         ELSE 0
       END AS requires_material_confirmation,
       CASE
         WHEN EXISTS (
           SELECT 1
             FROM service_consumptions sc
            WHERE sc.salon_id = bi.salon_id
              AND sc.booking_item_id = bi.id
              AND sc.status = 'confirmed'
         )
         THEN 1
         ELSE 0
       END AS materials_confirmed
     FROM booking_items bi
     JOIN bookings b
       ON b.salon_id = bi.salon_id
      AND b.id = bi.booking_id
     WHERE bi.salon_id = ?
       AND bi.booking_id = ?
     ORDER BY
       COALESCE(bi.booking_date, b.booking_date),
       COALESCE(bi.start_time, b.start_time),
       bi.created_at,
       bi.id`,
    [salonId, booking.id]
  );

  if (!rows.length) {
    throw new AppError(
      409,
      'core_booking:completion_items_missing',
      'Booking cannot be completed because it has no service items.'
    );
  }

  const clock = salonClock();
  const notStarted = rows.filter((row) => {
    const date = cleanText(row.booking_date);
    const time = cleanText(row.start_time);
    if (!date) return true;
    if (date > clock.date) return true;
    if (date < clock.date) return false;
    return !time || time > clock.time;
  });

  if (notStarted.length) {
    throw new AppError(
      409,
      'core_booking:service_not_started',
      'Booking cannot be completed before all assigned services have started.',
      {
        employeeId,
        bookingItemIds: notStarted.map((row) => row.booking_item_id),
      }
    );
  }

  const missingMaterials = rows.filter(
    (row) =>
      Number(row.requires_material_confirmation) === 1 &&
      Number(row.materials_confirmed) !== 1
  );

  if (missingMaterials.length) {
    throw new AppError(
      409,
      'core_booking:materials_confirmation_required',
      'Confirm the actual materials used before completing this booking.',
      {
        employeeId,
        bookingItemIds: missingMaterials.map(
          (row) => row.booking_item_id
        ),
      }
    );
  }
}

function projectOwnBooking(row, employeeId, acknowledgement = null) {
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
    staff_ack: acknowledgement ? 1 : 0,
    staff_ack_at: acknowledgement?.acknowledged_at || null,
    staff_ack_by_uid: acknowledgement?.acknowledged_by_uid || null,
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

async function acknowledgementForEmployee(db, salonId, bookingId, employeeId) {
  return dbFirst(
    db,
    `SELECT acknowledged_at, acknowledged_by_uid
       FROM booking_staff_acknowledgements
      WHERE salon_id = ? AND booking_id = ? AND employee_id = ?
      LIMIT 1`,
    [salonId, bookingId, employeeId]
  );
}

async function assertBookingAcknowledged(
  db,
  salonId,
  bookingId,
  employeeId
) {
  const acknowledgement = await acknowledgementForEmployee(
    db,
    salonId,
    bookingId,
    employeeId
  );
  if (acknowledgement) return acknowledgement;

  throw new AppError(
    409,
    'core_booking:staff_acknowledgement_required',
    'Receive the booking before changing its execution status.'
  );
}

async function projectedBookingById(db, salonId, bookingId, employeeId) {
  await assignedBooking(db, salonId, bookingId, employeeId);
  const [booking, acknowledgement] = await Promise.all([
    getBooking(db, salonId, bookingId),
    acknowledgementForEmployee(db, salonId, bookingId, employeeId),
  ]);
  return projectOwnBooking(booking, employeeId, acknowledgement);
}

export async function listOwnStaffBookings(db, salonId, employeeId, query = {}) {
  const ownEmployeeId = requiredId(employeeId, 'employeeId');
  const rows = await listBookings(db, salonId, {
    ...query,
    staffId: ownEmployeeId,
  });
  if (!rows.length) return [];

  const bookingIds = [...new Set(rows.map((row) => cleanText(row.id)).filter(Boolean))];
  const acknowledgements = await dbAll(
    db,
    `SELECT booking_id, acknowledged_at, acknowledged_by_uid
       FROM booking_staff_acknowledgements
      WHERE salon_id = ?
        AND employee_id = ?
        AND booking_id IN (${placeholders(bookingIds.length)})`,
    [salonId, ownEmployeeId, ...bookingIds]
  );
  const acknowledgementByBookingId = new Map(
    acknowledgements.map((row) => [cleanText(row.booking_id), row])
  );

  return rows.map((row) =>
    projectOwnBooking(
      row,
      ownEmployeeId,
      acknowledgementByBookingId.get(cleanText(row.id)) || null
    )
  );
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

async function assertExclusiveStatusControl(db, salonId, booking, employeeId) {
  const ownEmployeeId = cleanText(employeeId);
  const topLevelStaffId = cleanText(booking?.staff_id);
  const items = await dbAll(
    db,
    `SELECT staff_id
       FROM booking_items
      WHERE salon_id = ? AND booking_id = ?`,
    [salonId, booking.id]
  );
  const itemStaffIds = items.map((item) => cleanText(item.staff_id));

  const topLevelOwned = topLevelStaffId === ownEmployeeId;
  const hasForeignAssignedItem = itemStaffIds.some(
    (staffId) => staffId && staffId !== ownEmployeeId
  );
  const allItemsExplicitlyOwned =
    itemStaffIds.length > 0 && itemStaffIds.every((staffId) => staffId === ownEmployeeId);

  if ((topLevelOwned && !hasForeignAssignedItem) || (!topLevelStaffId && allItemsExplicitlyOwned)) {
    return;
  }

  throw new AppError(
    409,
    'core_booking:staff_status_requires_exclusive_assignment',
    'A staff member cannot change the whole booking status when another staff member is assigned.'
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
  const existing = await acknowledgementForEmployee(
    db,
    salonId,
    before.id,
    employeeId
  );
  if (existing) {
    return projectedBookingById(db, salonId, before.id, employeeId);
  }

  const now = nowIso();
  const result = await dbRun(
    db,
    `INSERT OR IGNORE INTO booking_staff_acknowledgements
      (salon_id, booking_id, employee_id, acknowledged_at, acknowledged_by_uid)
     VALUES (?, ?, ?, ?, ?)`,
    [salonId, before.id, employeeId, now, cleanText(actor.uid) || null]
  );

  const acknowledgement = await acknowledgementForEmployee(
    db,
    salonId,
    before.id,
    employeeId
  );
  if (!acknowledgement) {
    throw new AppError(409, 'core_booking:staff_ack_conflict');
  }

  const after = await projectedBookingById(db, salonId, before.id, employeeId);
  if (changes(result) === 1) {
    await recordAudit(
      db,
      salonId,
      {
        action: 'booking_staff_acknowledged',
        entityType: 'booking',
        entityId: before.id,
        description: 'Booking receipt acknowledged by the assigned employee.',
        before: { staffAck: false },
        after: {
          staffAck: true,
          staffAckAt: acknowledgement.acknowledged_at,
          staffAckByUid: acknowledgement.acknowledged_by_uid || null,
        },
        meta: { employeeId },
      },
      actor
    );
  }
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
  await assertExclusiveStatusControl(db, salonId, before, employeeId);

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

  if (toStatus === 'confirmed' || toStatus === 'completed') {
    await assertBookingAcknowledged(
      db,
      salonId,
      before.id,
      employeeId
    );
  }

  if (toStatus === 'completed') {
    await assertBookingCompletionReady(
      db,
      salonId,
      before,
      employeeId
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
      description: 'Booking status changed by the exclusively assigned employee portal.',
      before: { status: fromStatus },
      after: { status: toStatus },
      meta: { employeeId },
    },
    actor
  );
  return after;
}
