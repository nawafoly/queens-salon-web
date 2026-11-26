import {
  cleanText,
  dbFirst,
  dbAll,
  dbBatch,
  nowIso,
  generatedId,
  requiredId,
  validDate,
  validTime
} from '../d1.js';

import { AppError } from '../errors.js';
import { listAttendance } from './attendance.js';

import {
  resolveEmployeeShift
} from './shift-control.js';

import {
  isExplicitWeeklyRestShift
} from './rest-holiday-compliance.js';

function conflict(code) {
  throw new AppError(
    409,
    `core_weekly_rest_rescheduling:${code}`
  );
}

function strictDate(value, field) {
  const date = validDate(value, field);

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new AppError(
      400,
      'core_weekly_rest_rescheduling:invalid_calendar_date'
    );
  }

  return date;
}

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const REQUIRED_REST_MINUTES = 1440;

function offsetDate(date, days) {
  return new Date(
    Date.parse(`${date}T00:00:00.000Z`) +
    days * DAY_MS
  ).toISOString().slice(0, 10);
}

function scheduleWeekStart(date) {
  const day = new Date(
    `${date}T00:00:00.000Z`
  ).getUTCDay();

  return offsetDate(date, -day);
}

function clockMinutes(value) {
  const time = cleanText(value);

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    conflict('rest_window_schedule_unknown');
  }

  const [hours, minutes] = time.split(':').map(Number);

  return hours * 60 + minutes;
}

function shiftInterval(date, shift) {
  if (
    !shift ||
    shift.operational === false ||
    shift.source === 'none'
  ) {
    conflict('rest_window_schedule_unknown');
  }

  if (
    shift.exception_type === 'off' ||
    (
      shift.source === 'weekly_schedule' &&
      Number(shift.active) === 0
    )
  ) {
    return null;
  }

  const start = clockMinutes(
    shift.start_time || shift.template_start_time
  );

  const end = clockMinutes(
    shift.end_time || shift.template_end_time
  );

  if (start === end) {
    conflict('rest_window_schedule_unknown');
  }

  const midnight = Date.parse(
    `${date}T00:00:00.000Z`
  );

  const overnight =
    end < start ||
    Number(shift.crosses_midnight) === 1;

  return {
    start: midnight + start * MINUTE_MS,
    end: midnight +
      (end + (overnight ? 1440 : 0)) * MINUTE_MS
  };
}

async function assertReplacementRestWindow(
  db,
  salonId,
  employeeId,
  originalDate,
  replacementDate,
  startTime,
  endTime
) {
  if (
    scheduleWeekStart(originalDate) !==
    scheduleWeekStart(replacementDate)
  ) {
    conflict('replacement_rest_outside_schedule_week');
  }

  const previousDate = offsetDate(replacementDate, -1);
  const nextDate = offsetDate(replacementDate, 1);

  const midnight = Date.parse(
    `${replacementDate}T00:00:00.000Z`
  );

  const nextMidnight = midnight + DAY_MS;

  async function effectiveShift(date) {
    if (date === originalDate) {
      return {
        source: 'exception',
        exception_type: 'custom',
        enabled: 1,
        start_time: startTime,
        end_time: endTime,
        crosses_midnight: 0
      };
    }

    return resolveEmployeeShift(
      db,
      salonId,
      employeeId,
      date
    );
  }

  const previous = shiftInterval(
    previousDate,
    await effectiveShift(previousDate)
  );

  const next = shiftInterval(
    nextDate,
    await effectiveShift(nextDate)
  );

  const restStart = previous?.end ??
    midnight - DAY_MS;

  const restEnd = next?.start ??
    nextMidnight + DAY_MS;

  if (
    restStart >= restEnd ||
    restStart >= nextMidnight ||
    restEnd <= midnight
  ) {
    conflict('replacement_rest_window_insufficient');
  }

  const uninterruptedMinutes =
    Math.floor((restEnd - restStart) / MINUTE_MS);

  if (
    uninterruptedMinutes <
    REQUIRED_REST_MINUTES
  ) {
    conflict('replacement_rest_window_insufficient');
  }

  return {
    previousDate,
    nextDate,
    scheduledRestMinutes: uninterruptedMinutes
  };
}

function requiredReason(value) {
  const reason = cleanText(value);

  if (!reason || reason.length > 1500) {
    throw new AppError(
      400,
      'core_weekly_rest_rescheduling:reason_required'
    );
  }

  return reason;
}

async function findOperation(db, salonId, id) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_weekly_rest_rescheduling
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );
}

function assertReplay(row, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (cleanText(row[field]) !== cleanText(value)) {
      conflict('operation_conflict');
    }
  }

  if (row.status !== 'active') {
    conflict('operation_cancelled');
  }
}

function workingShift(shift) {
  if (
    !shift ||
    shift.operational === false ||
    shift.source === 'none' ||
    shift.source === 'weekly_rest_work_assignment' ||
    shift.exception_type === 'off' ||
    Number(shift.active) === 0 ||
    isExplicitWeeklyRestShift(shift)
  ) {
    return false;
  }

  const start = cleanText(
    shift.template_start_time || shift.start_time
  );

  const end = cleanText(
    shift.template_end_time || shift.end_time
  );

  return Boolean(start && end && start !== end);
}

async function assertDateAvailable(
  db,
  salonId,
  employeeId,
  date,
  originalExceptionId = null
) {
  const exception = await dbFirst(
    db,
    `SELECT id
       FROM hr_schedule_exceptions
      WHERE salon_id = ?
        AND employee_id = ?
        AND status IN ('approved', 'active')
        AND date_from <= ?
        AND date_to >= ?
        AND (? IS NULL OR id <> ?)
      LIMIT 1`,
    [
      salonId,
      employeeId,
      date,
      date,
      originalExceptionId,
      originalExceptionId
    ]
  );

  if (exception) {
    conflict('schedule_exception_conflict');
  }

  const assignment = await dbFirst(
    db,
    `SELECT id
       FROM employee_weekly_rest_work_assignments
      WHERE salon_id = ?
        AND employee_id = ?
        AND rest_date = ?
        AND status IN ('assigned', 'completed')
      LIMIT 1`,
    [salonId, employeeId, date]
  );

  if (assignment) {
    conflict('weekly_rest_assignment_conflict');
  }

  const event = await dbFirst(
    db,
    `SELECT id
       FROM employee_weekly_rest_events
      WHERE salon_id = ?
        AND employee_id = ?
        AND rest_date = ?
      LIMIT 1`,
    [salonId, employeeId, date]
  );

  if (event) {
    conflict('weekly_rest_event_review_required');
  }

  const leave = await dbFirst(
    db,
    `SELECT id
       FROM employee_leaves
      WHERE salon_id = ?
        AND employee_id = ?
        AND status IN ('approved', 'pending')
        AND start_date <= ?
        AND end_date >= ?
      LIMIT 1`,
    [salonId, employeeId, date, date]
  );

  if (leave) {
    conflict('leave_conflict');
  }

  const lock = await dbFirst(
    db,
    `SELECT 1 AS locked
       FROM employee_attendance_policy_locked_ranges
      WHERE salon_id = ?
        AND (employee_id IS NULL OR employee_id = ?)
        AND date_from <= ?
        AND date_to >= ?
      UNION ALL
     SELECT 1 AS locked
       FROM payroll_periods
      WHERE salon_id = ?
        AND status IN ('closed','approved','paid','locked')
        AND month_start <= ?
        AND month_end >= ?
      LIMIT 1`,
    [salonId, employeeId, date, date, salonId, date, date]
  );

  if (lock) {
    conflict('payroll_period_locked');
  }
}

function exceptionStatement(row) {
  return {
    sql: `INSERT INTO hr_schedule_exceptions (
      id, salon_id, employee_id,
      date_from, date_to, exception_type,
      shift_template_id, enabled,
      start_time, end_time, note, status,
      approved_by_uid, created_by_uid,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

    params: [
      row.id,
      row.salon_id,
      row.employee_id,
      row.date_from,
      row.date_to,
      row.exception_type,
      null,
      row.enabled,
      row.start_time,
      row.end_time,
      row.note,
      'approved',
      row.created_by_uid,
      row.created_by_uid,
      row.created_at,
      row.created_at
    ]
  };
}

function auditStatement(row, reason) {
  return {
    sql: `INSERT INTO hr_shift_audit_log (
      id, salon_id, actor_uid,
      action, entity_type, entity_id,
      before_json, after_json, reason, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`,

    params: [
      generatedId('shift_audit'),
      row.salon_id,
      row.created_by_uid,
      'create',
      'schedule_exception',
      row.id,
      null,
      JSON.stringify(row),
      reason,
      row.created_at
    ]
  };
}

export async function createWeeklyRestRescheduling(
  db,
  salonId,
  data = {},
  actor = {},
  externalAttendanceDb = null
) {
  const id = requiredId(data.id, 'id');

  const employeeId = requiredId(
    data.employeeId,
    'employeeId'
  );

  const originalDate = strictDate(
    data.originalRestDate,
    'originalRestDate'
  );

  const replacementDate = strictDate(
    data.replacementRestDate,
    'replacementRestDate'
  );

  const startTime = validTime(
    data.startTime,
    'startTime'
  );

  const endTime = validTime(
    data.endTime,
    'endTime'
  );

  const reason = requiredReason(data.reason);

  const actorUid = cleanText(actor.uid);

  if (!actorUid) {
    throw new AppError(
      403,
      'core_weekly_rest_rescheduling:actor_required'
    );
  }

  if (originalDate === replacementDate) {
    conflict('identical_dates');
  }

  if (startTime >= endTime) {
    throw new AppError(
      400,
      'core_weekly_rest_rescheduling:invalid_work_window'
    );
  }

  const expected = {
    employee_id: employeeId,
    original_rest_date: originalDate,
    replacement_rest_date: replacementDate,
    work_start_time: startTime,
    work_end_time: endTime,
    reason,
    created_by_uid: actorUid
  };

  const existing = await findOperation(
    db,
    salonId,
    id
  );

  if (existing) {
    assertReplay(existing, expected);

    return {
      operation: existing,
      idempotent: true
    };
  }

  const employee = await dbFirst(
    db,
    `SELECT p.id
       FROM employee_profiles p
       JOIN employee_employment e
         ON e.salon_id = p.salon_id
        AND e.employee_id = p.id
      WHERE p.salon_id = ?
        AND p.id = ?
        AND p.status = 'active'
        AND e.employment_status = 'active'
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!employee) {
    conflict('employee_not_active');
  }

  const originalShift = await resolveEmployeeShift(
    db,
    salonId,
    employeeId,
    originalDate
  );

  const replacementShift = await resolveEmployeeShift(
    db,
    salonId,
    employeeId,
    replacementDate
  );

  if (
    originalShift.operational === false ||
    originalShift.source === 'weekly_rest_work_assignment' ||
    !isExplicitWeeklyRestShift(originalShift)
  ) {
    conflict('original_date_not_weekly_rest');
  }

  if (!workingShift(replacementShift)) {
    conflict('replacement_date_not_working_day');
  }

  let originalExceptionId = null;

  if (originalShift.source === 'exception') {
    if (
      originalShift.exception_type !== 'off' ||
      originalShift.date_from !== originalDate ||
      originalShift.date_to !== originalDate ||
      !cleanText(originalShift.note)
        .toLowerCase()
        .startsWith('[temp_weekly_off:')
    ) {
      conflict('schedule_exception_conflict');
    }

    originalExceptionId = requiredId(
      originalShift.id,
      'originalRestExceptionId'
    );
  }

  await assertDateAvailable(
    db,
    salonId,
    employeeId,
    originalDate,
    originalExceptionId
  );

  await assertDateAvailable(
    db,
    salonId,
    employeeId,
    replacementDate
  );

  await assertReplacementRestWindow(
    db,
    salonId,
    employeeId,
    originalDate,
    replacementDate,
    startTime,
    endTime
  );

  if (!externalAttendanceDb) {
    throw new AppError(
      503,
      'core_weekly_rest_rescheduling:attendance_unavailable'
    );
  }

  let replacementAttendance;

  try {
    replacementAttendance = await listAttendance(
      db,
      salonId,
      {
        employeeId,
        date: replacementDate
      },
      externalAttendanceDb
    );
  } catch {
    throw new AppError(
      503,
      'core_weekly_rest_rescheduling:attendance_unavailable'
    );
  }

  const replacementPunches = replacementAttendance.filter(
    row => ['check_in', 'check_out'].includes(
      cleanText(row.record_type || row.type)
    )
  );

  if (replacementPunches.length > 0) {
    conflict('replacement_date_has_attendance');
  }

  const now = nowIso();

  const workExceptionId = generatedId(
    'rest_reschedule_work'
  );

  const restExceptionId = generatedId(
    'rest_reschedule_off'
  );

  const shared = {
    salon_id: salonId,
    employee_id: employeeId,
    created_by_uid: actorUid,
    created_at: now,
    updated_at: now,
    status: 'approved'
  };

  const workException = {
    ...shared,
    id: workExceptionId,
    date_from: originalDate,
    date_to: originalDate,
    exception_type: 'custom',
    enabled: 1,
    start_time: startTime,
    end_time: endTime,
    note: reason
  };

  const restException = {
    ...shared,
    id: restExceptionId,
    date_from: replacementDate,
    date_to: replacementDate,
    exception_type: 'off',
    enabled: 0,
    start_time: null,
    end_time: null,
    note: `[temp_weekly_off:${id}] ${reason}`
  };

  try {
    await dbBatch(db, [
      {
        sql: `INSERT INTO employee_weekly_rest_rescheduling (
          id, salon_id, employee_id,
          original_rest_date, replacement_rest_date,
          work_start_time, work_end_time,
          original_rest_snapshot_json,
          replacement_work_snapshot_json,
          original_rest_exception_id,
          work_exception_id, rest_exception_id,
          reason, status, created_by_uid,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

        params: [
          id,
          salonId,
          employeeId,
          originalDate,
          replacementDate,
          startTime,
          endTime,
          JSON.stringify(originalShift),
          JSON.stringify(replacementShift),
          originalExceptionId,
          workExceptionId,
          restExceptionId,
          reason,
          'active',
          actorUid,
          now,
          now
        ]
      },

      exceptionStatement(workException),

      exceptionStatement(restException),

      auditStatement(workException, reason),

      auditStatement(restException, reason)
    ]);
  } catch (error) {
    const raced = await findOperation(
      db,
      salonId,
      id
    );

    if (raced) {
      assertReplay(raced, expected);

      return {
        operation: raced,
        idempotent: true
      };
    }

    if (
      String(error?.message || error).includes(
        'weekly_rest_rescheduling_overlap'
      )
    ) {
      conflict('operation_overlap');
    }

    const message = String(error?.message || error);

    const databaseConflicts = [
      [
        'weekly_rest_rescheduling_finance_pending',
        'finance_pending'
      ],
      [
        'weekly_rest_rescheduling_payroll_locked',
        'payroll_period_locked'
      ],
      [
        'weekly_rest_rescheduling_assignment_conflict',
        'weekly_rest_assignment_conflict'
      ],
      [
        'weekly_rest_rescheduling_schedule_conflict',
        'schedule_exception_conflict'
      ],
      [
        'weekly_rest_rescheduling_leave_conflict',
        'leave_conflict'
      ],
      [
        'weekly_rest_rescheduling_replacement_attendance',
        'replacement_date_has_attendance'
      ],
      [
        'weekly_rest_rescheduling_event_conflict',
        'weekly_rest_event_review_required'
      ]
    ];

    for (const [marker, code] of databaseConflicts) {
      if (message.includes(marker)) {
        conflict(code);
      }
    }

    throw error;
  }

  const operation = await findOperation(
    db,
    salonId,
    id
  );

  if (!operation) {
    throw new Error(
      'weekly_rest_rescheduling:missing_committed_operation'
    );
  }

  return {
    operation,
    idempotent: false
  };
}

export async function cancelWeeklyRestRescheduling(
  db,
  salonId,
  idValue,
  data = {},
  actor = {},
  externalAttendanceDb = null
) {
  const id = requiredId(idValue, 'id');
  const employeeId = requiredId(
    data.employeeId,
    'employeeId'
  );

  const reason = requiredReason(data.reason);
  const actorUid = cleanText(actor.uid);

  if (!actorUid) {
    throw new AppError(
      403,
      'core_weekly_rest_rescheduling:actor_required'
    );
  }

  const existing = await findOperation(
    db,
    salonId,
    id
  );

  if (
    !existing ||
    existing.employee_id !== employeeId
  ) {
    throw new AppError(
      404,
      'core_weekly_rest_rescheduling:operation_not_found'
    );
  }

  function cancelledReplay(row) {
    if (
      row.status !== 'cancelled' ||
      row.cancelled_by_uid !== actorUid ||
      row.cancellation_reason !== reason
    ) {
      conflict('cancellation_operation_conflict');
    }

    return {
      operation: row,
      idempotent: true
    };
  }

  if (existing.status === 'cancelled') {
    return cancelledReplay(existing);
  }

  if (!externalAttendanceDb) {
    throw new AppError(
      503,
      'core_weekly_rest_rescheduling:attendance_unavailable'
    );
  }

  // Preserve existing punches. Cancellation does not waive
  // the employee's statutory weekly-rest entitlement.

  try {
    await listAttendance(
      db,
      salonId,
      {
        employeeId,
        date: existing.original_rest_date
      },
      externalAttendanceDb
    );

    await listAttendance(
      db,
      salonId,
      {
        employeeId,
        date: existing.replacement_rest_date
      },
      externalAttendanceDb
    );
  } catch {
    throw new AppError(
      503,
      'core_weekly_rest_rescheduling:attendance_unavailable'
    );
  }

  const now = nowIso();

  let result;

  try {
    result = await db.prepare(`
      UPDATE employee_weekly_rest_rescheduling
         SET status = 'cancelled',
             cancelled_by_uid = ?,
             cancellation_reason = ?,
             cancelled_at = ?,
             updated_at = ?
       WHERE salon_id = ?
         AND employee_id = ?
         AND id = ?
         AND status = 'active'
    `).bind(
      actorUid,
      reason,
      now,
      now,
      salonId,
      employeeId,
      id
    ).run();
  } catch (error) {
    const current = await findOperation(
      db,
      salonId,
      id
    );

    if (current?.status === 'cancelled') {
      return cancelledReplay(current);
    }

    const message = String(
      error?.message || error
    );

    const conflicts = [
      [
        'weekly_rest_rescheduling_payroll_locked',
        'payroll_period_locked'
      ],
      [
        'weekly_rest_rescheduling_finance_pending',
        'finance_pending'
      ],
      [
        'weekly_rest_rescheduling_event_conflict',
        'weekly_rest_event_review_required'
      ],
      [
        'weekly_rest_rescheduling_invalid_exception_evidence',
        'invalid_exception_evidence'
      ],
      [
        'weekly_rest_rescheduling_restore_incomplete',
        'restore_incomplete'
      ]
    ];

    for (const [marker, code] of conflicts) {
      if (message.includes(marker)) {
        conflict(code);
      }
    }

    throw error;
  }

  const operation = await findOperation(
    db,
    salonId,
    id
  );

  if (
    !operation ||
    operation.status !== 'cancelled'
  ) {
    conflict('restore_incomplete');
  }

  if (
    Number(result?.meta?.changes ?? 0) !== 1
  ) {
    return cancelledReplay(operation);
  }

  return {
    operation,
    idempotent: false
  };
}

export async function listWeeklyRestRescheduling(
  db,
  salonId,
  query = {}
) {
  const employeeId = requiredId(
    query.employeeId,
    'employeeId'
  );

  const status = cleanText(query.status);

  if (
    status &&
    !['active', 'cancelled'].includes(status)
  ) {
    throw new AppError(
      400,
      'core_weekly_rest_rescheduling:invalid_status'
    );
  }

  const params = [salonId, employeeId];

  const conditions = [
    'r.salon_id = ?',
    'r.employee_id = ?'
  ];

  if (status) {
    conditions.push('r.status = ?');
    params.push(status);
  }

  const from = cleanText(query.from);
  const to = cleanText(query.to);

  if (Boolean(from) !== Boolean(to)) {
    throw new AppError(
      400,
      'core_weekly_rest_rescheduling:invalid_date_range'
    );
  }

  if (from && to) {
    const validDate = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }

      const parsed = new Date(
        `${value}T00:00:00.000Z`
      );

      return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value;
    };

    if (
      !validDate(from) ||
      !validDate(to) ||
      from > to
    ) {
      throw new AppError(
        400,
        'core_weekly_rest_rescheduling:invalid_date_range'
      );
    }

    const days =
      (
        Date.parse(to) -
        Date.parse(from)
      ) / 86400000 + 1;

    if (days > 366) {
      throw new AppError(
        400,
        'core_weekly_rest_rescheduling:date_range_too_large'
      );
    }

    conditions.push(`
      (
        r.original_rest_date BETWEEN ? AND ?
        OR
        r.replacement_rest_date BETWEEN ? AND ?
      )
    `);

    params.push(from, to, from, to);
  }

  return dbAll(
    db,
    `SELECT
        r.*,
        (
          SELECT COUNT(*)
          FROM hr_payroll_operations op
          WHERE op.salon_id = r.salon_id
            AND op.employee_id = r.employee_id
            AND json_extract(
              op.response_json,
              '$.sourceType'
            ) = 'weekly_rest_rescheduling'
            AND json_extract(
              op.response_json,
              '$.sourceId'
            ) = r.id
        ) AS finance_operation_count,
        (
          SELECT COUNT(*)
          FROM hr_payroll_operations op
          WHERE op.salon_id = r.salon_id
            AND op.employee_id = r.employee_id
            AND json_extract(
              op.response_json,
              '$.sourceType'
            ) = 'weekly_rest_rescheduling'
            AND json_extract(
              op.response_json,
              '$.sourceId'
            ) = r.id
            AND op.status = 'completed'
        ) AS finance_completed_count,
        (
          SELECT COUNT(*)
          FROM hr_payroll_operations op
          WHERE op.salon_id = r.salon_id
            AND op.employee_id = r.employee_id
            AND json_extract(
              op.response_json,
              '$.sourceType'
            ) = 'weekly_rest_rescheduling'
            AND json_extract(
              op.response_json,
              '$.sourceId'
            ) = r.id
            AND op.status = 'needs_attention'
        ) AS finance_review_count,
        CASE
          WHEN r.status = 'cancelled' THEN 1
          ELSE 0
        END AS rest_review_checked,
        e.id AS rest_review_event_id,
        e.restoration_status AS rest_review_status,
        e.status AS rest_review_event_status,
        e.worked_minutes AS rest_review_worked_minutes,
        e.substitute_rest_minutes AS rest_review_substitute_minutes
      FROM employee_weekly_rest_rescheduling r
      LEFT JOIN employee_weekly_rest_events e
        ON r.status = 'cancelled'
       AND e.salon_id = r.salon_id
       AND e.employee_id = r.employee_id
       AND e.rest_date = r.original_rest_date
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        r.original_rest_date DESC,
        r.created_at DESC,
        r.id DESC`,
    params
  );
}

export async function getWeeklyRestReschedulingState(
  db,
  salonId,
  employeeId,
  operationId
) {
  const row = await findOperation(
    db,
    salonId,
    operationId
  );

  if (
    !row ||
    row.employee_id !== employeeId
  ) {
    throw new AppError(
      404,
      'core_weekly_rest_rescheduling:operation_not_found'
    );
  }

  const jobs = await dbAll(
    db,
    `SELECT
        id,
        status,
        work_date,
        json_extract(
          response_json,
          '$.action'
        ) AS action
       FROM hr_payroll_operations
      WHERE salon_id = ?
        AND employee_id = ?
        AND json_extract(
          response_json,
          '$.sourceType'
        ) = 'weekly_rest_rescheduling'
        AND json_extract(
          response_json,
          '$.sourceId'
        ) = ?
      ORDER BY work_date, id`,
    [salonId, employeeId, operationId]
  );

  const expectedActions =
    row.status === 'cancelled'
      ? ['create', 'cancel']
      : ['create'];

  const expectedDates = [
    row.original_rest_date,
    row.replacement_rest_date
  ];

  const expectedCount =
    expectedActions.length * expectedDates.length;

  const evidenceComplete =
    jobs.length === expectedCount &&
    expectedActions.every(action =>
      expectedDates.every(date =>
        jobs.filter(job =>
          job.action === action &&
          job.work_date === date
        ).length === 1
      )
    );

  const financeCompleted =
    evidenceComplete &&
    jobs.every(job =>
      job.status === 'completed'
    );

  const needsAttention =
    !evidenceComplete ||
    jobs.some(job =>
      job.status === 'needs_attention'
    );

  const restReview =
    row.status === 'cancelled'
      ? await dbFirst(
          db,
          `SELECT
              id,
              restoration_status,
              status,
              worked_minutes,
              substitute_rest_minutes
             FROM employee_weekly_rest_events
            WHERE salon_id = ?
              AND employee_id = ?
              AND rest_date = ?
            LIMIT 1`,
          [
            salonId,
            employeeId,
            row.original_rest_date
          ]
        )
      : null;

  return {
    operation: {
      ...row,
      rest_review_checked: row.status === 'cancelled' ? 1 : 0,
      rest_review_event_id: restReview?.id ?? null,
      rest_review_status: restReview?.restoration_status ?? null,
      rest_review_event_status: restReview?.status ?? null,
      rest_review_worked_minutes: restReview?.worked_minutes ?? null,
      rest_review_substitute_minutes: restReview?.substitute_rest_minutes ?? null
    },
    operationStateFresh: true,
    reconciliation: {
      status: needsAttention
        ? 'needs_attention'
        : financeCompleted
          ? 'completed'
          : 'recovery_pending',
      financeCompleted,
      operationCount: jobs.length,
      completedCount: jobs.filter(
        job => job.status === 'completed'
      ).length
    }
  };
}
