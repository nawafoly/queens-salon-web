// CORE D1 ONLY — weekly-rest and Saudi public-holiday work compliance runtime.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LABOR_POLICY_VERSION,
} from '../../../src/helpers/hr/saLaborPolicy.js';
import { listAttendance } from './attendance.js';
import { resolveEmployeeShift } from './shift-control.js';

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}

function recordType(row) {
  return cleanText(
    row?.record_type ||
      row?.recordType ||
      row?.type
  ).toLowerCase();
}

function recordTime(row) {
  return cleanText(
    row?.recorded_at ||
      row?.recordedAt ||
      row?.server_time ||
      row?.serverTime
  );
}

function recordDate(row) {
  return cleanText(
    row?.date_key ||
      row?.dateKey ||
      row?.date
  );
}

export function attendanceWorkedMinutes(rows = [], dateValue = '') {
  const date = cleanText(dateValue);
  const relevant = (Array.isArray(rows) ? rows : [])
    .filter((row) => !date || recordDate(row) === date)
    .map((row) => ({
      row,
      type: recordType(row),
      time: recordTime(row),
      ms: Date.parse(recordTime(row)),
    }))
    .filter(
      (item) =>
        ['check_in', 'check_out'].includes(item.type) &&
        Number.isFinite(item.ms)
    )
    .sort((left, right) => left.ms - right.ms);

  if (!relevant.length) {
    return {
      hasAttendance: false,
      complete: false,
      workedMinutes: 0,
      firstCheckInId: null,
      lastCheckOutId: null,
      firstCheckInAt: null,
      lastCheckOutAt: null,
      recordIds: [],
      intervals: [],
    };
  }

  const recordIds = relevant
    .map((item) => cleanText(item.row?.id))
    .filter(Boolean);
  const intervals = [];
  let openCheckIn = null;
  let unmatched = false;

  for (const item of relevant) {
    if (item.type === 'check_in') {
      if (openCheckIn) unmatched = true;
      openCheckIn = item;
      continue;
    }

    if (!openCheckIn || item.ms <= openCheckIn.ms) {
      unmatched = true;
      continue;
    }

    intervals.push({
      checkInId: cleanText(openCheckIn.row?.id) || null,
      checkOutId: cleanText(item.row?.id) || null,
      checkInAt: openCheckIn.time,
      checkOutAt: item.time,
      minutes: Math.max(
        0,
        Math.round((item.ms - openCheckIn.ms) / 60000)
      ),
    });
    openCheckIn = null;
  }

  if (openCheckIn) unmatched = true;

  const first = intervals[0] || null;
  const last = intervals[intervals.length - 1] || null;
  const workedMinutes = intervals.reduce(
    (sum, interval) => sum + interval.minutes,
    0
  );

  return {
    hasAttendance: true,
    complete: intervals.length > 0 && !unmatched,
    workedMinutes,
    firstCheckInId:
      first?.checkInId ||
      cleanText(
        relevant.find((item) => item.type === 'check_in')?.row?.id
      ) ||
      null,
    lastCheckOutId:
      last?.checkOutId ||
      cleanText(
        [...relevant]
          .reverse()
          .find((item) => item.type === 'check_out')?.row?.id
      ) ||
      null,
    firstCheckInAt:
      first?.checkInAt ||
      relevant.find((item) => item.type === 'check_in')?.time ||
      null,
    lastCheckOutAt:
      last?.checkOutAt ||
      [...relevant]
        .reverse()
        .find((item) => item.type === 'check_out')?.time ||
      null,
    recordIds,
    intervals,
  };
}

export function isExplicitWeeklyRestShift(shift) {
  const source = cleanText(shift?.source).toLowerCase();
  const exceptionType = cleanText(
    shift?.exception_type ||
      shift?.exceptionType
  ).toLowerCase();

  if (
    source === 'exception' &&
    exceptionType === 'off'
  ) {
    // A generic one-off day off is not automatically the statutory weekly
    // rest. The existing temporary-weekly-off workflow marks replacement
    // weekly-rest dates explicitly in the exception note. Notes are legacy
    // user-visible audit text, so marker matching must be case-insensitive.
    return cleanText(shift?.note)
      .toLowerCase()
      .startsWith('[temp_weekly_off:');
  }

  if (source === 'weekly_schedule') {
    const active = shift?.active;
    return !(
      active === true ||
      active === 1 ||
      active === '1' ||
      active === 'true'
    );
  }

  // "none" is schedule-unavailable evidence, not proof of weekly rest.
  return false;
}

function shiftSourceId(shift) {
  return (
    cleanText(
      shift?.id ||
        shift?.source_id ||
        shift?.sourceId ||
        shift?.assignment_id ||
        shift?.assignmentId
    ) || null
  );
}

function shiftSnapshot(shift) {
  if (!shift || typeof shift !== 'object') return {};
  return {
    source: shift.source || null,
    id: shiftSourceId(shift),
    exceptionType:
      shift.exception_type ||
      shift.exceptionType ||
      null,
    active: shift.active ?? null,
    weekday: shift.weekday ?? null,
    shiftTemplateId:
      shift.shift_template_id ||
      shift.shiftTemplateId ||
      null,
    startTime:
      shift.template_start_time ||
      shift.start_time ||
      shift.startTime ||
      null,
    endTime:
      shift.template_end_time ||
      shift.end_time ||
      shift.endTime ||
      null,
  };
}

export async function reconcileWeeklyRestDate(
  db,
  salonId,
  employeeIdValue,
  dateValue,
  actor = {},
  externalAttendanceDb = null
) {
  const employeeId = requiredId(
    employeeIdValue,
    'employeeId'
  );
  const restDate = validDate(
    dateValue,
    'restDate'
  );

  const shift = await resolveEmployeeShift(
    db,
    salonId,
    employeeId,
    restDate
  );

  if (!isExplicitWeeklyRestShift(shift)) {
    return {
      employeeId,
      restDate,
      weeklyRest: false,
      event: null,
    };
  }

  const attendanceRows = await listAttendance(
    db,
    salonId,
    {
      employeeId,
      date: restDate,
    },
    externalAttendanceDb
  );
  const attendance = attendanceWorkedMinutes(
    attendanceRows,
    restDate
  );

  if (!attendance.hasAttendance) {
    return {
      employeeId,
      restDate,
      weeklyRest: true,
      worked: false,
      event: null,
    };
  }

  const now = nowIso();
  const id = generatedId('weekly_rest_event');
  const scheduleId = shiftSourceId(shift);
  const details = {
    attendanceComplete: attendance.complete,
    overtimeDetermination:
      'separate_daily_weekly_overtime_rule_required',
    weeklyRestRestoration:
      'requires_24_consecutive_hour_review',
  };

  await dbRun(
    db,
    `INSERT INTO employee_weekly_rest_events (
       id,
       salon_id,
       employee_id,
       rest_date,
       schedule_source_type,
       schedule_source_id,
       schedule_snapshot_json,
       attendance_source_type,
       attendance_source_id,
       attendance_evidence_json,
       worked_minutes,
       overtime_minutes,
       restoration_status,
       substitute_rest_minutes,
       substitute_rest_source_id,
       policy_version,
       status,
       details_json,
       created_by_uid,
       created_at,
       updated_at
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       0, 'pending_review', 0, NULL, ?,
       'open', ?, ?, ?, ?
     )
     ON CONFLICT(salon_id, employee_id, rest_date)
     DO UPDATE SET
       schedule_source_type = excluded.schedule_source_type,
       schedule_source_id = excluded.schedule_source_id,
       schedule_snapshot_json = excluded.schedule_snapshot_json,
       attendance_source_type = excluded.attendance_source_type,
       attendance_source_id = excluded.attendance_source_id,
       attendance_evidence_json = excluded.attendance_evidence_json,
       worked_minutes = excluded.worked_minutes,
       overtime_minutes = 0,
       restoration_status = CASE
         WHEN employee_weekly_rest_events.restoration_status = 'fulfilled'
           THEN 'fulfilled'
         WHEN employee_weekly_rest_events.restoration_status = 'scheduled'
           THEN 'scheduled'
         WHEN employee_weekly_rest_events.restoration_status = 'owed'
           THEN 'owed'
         ELSE 'pending_review'
       END,
       policy_version = excluded.policy_version,
       details_json = excluded.details_json,
       updated_at = excluded.updated_at`,
    [
      id,
      salonId,
      employeeId,
      restDate,
      cleanText(shift?.source) ||
        'weekly_schedule',
      scheduleId,
      JSON.stringify(shiftSnapshot(shift)),
      'attendance_records',
      attendance.firstCheckInId ||
        attendance.lastCheckOutId,
      JSON.stringify(attendance),
      attendance.workedMinutes,
      SA_LABOR_POLICY_VERSION,
      JSON.stringify(details),
      actorField(actor, 'uid'),
      now,
      now,
    ]
  );

  const event = await dbFirst(
    db,
    `SELECT *
       FROM employee_weekly_rest_events
      WHERE salon_id = ?
        AND employee_id = ?
        AND rest_date = ?
      LIMIT 1`,
    [salonId, employeeId, restDate]
  );

  return {
    employeeId,
    restDate,
    weeklyRest: true,
    worked: true,
    attendance,
    event,
  };
}

function fixedHolidayDefinitions(year) {
  return [
    {
      id: `sa_holiday_${year}_founding_day`,
      code: 'founding_day',
      date: `${year}-02-22`,
      nameAr: 'يوم التأسيس',
      nameEn: 'Founding Day',
    },
    {
      id: `sa_holiday_${year}_national_day`,
      code: 'national_day',
      date: `${year}-09-23`,
      nameAr: 'اليوم الوطني',
      nameEn: 'Saudi National Day',
    },
  ];
}

export async function ensureFixedSaudiPublicHolidays(
  db,
  yearValue
) {
  const year = Number(yearValue);
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200
  ) {
    throw new AppError(
      400,
      'core_public_holiday:invalid_year'
    );
  }

  const now = nowIso();
  for (const holiday of fixedHolidayDefinitions(year)) {
    await dbRun(
      db,
      `INSERT INTO sa_public_holiday_calendar (
         id,
         holiday_code,
         holiday_date,
         holiday_name_ar,
         holiday_name_en,
         source_type,
         source_reference,
         calendar_year,
         verified_at,
         status,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
       ON CONFLICT(holiday_date, holiday_code)
       DO UPDATE SET
         holiday_name_ar = excluded.holiday_name_ar,
         holiday_name_en = excluded.holiday_name_en,
         source_type = excluded.source_type,
         source_reference = excluded.source_reference,
         calendar_year = excluded.calendar_year,
         verified_at = excluded.verified_at,
         status = 'verified',
         updated_at = excluded.updated_at`,
      [
        holiday.id,
        holiday.code,
        holiday.date,
        holiday.nameAr,
        holiday.nameEn,
        'statutory_fixed_date',
        'Saudi Labor implementing regulations',
        year,
        now,
        now,
        now,
      ]
    );
  }

  return dbAll(
    db,
    `SELECT *
       FROM sa_public_holiday_calendar
      WHERE calendar_year = ?
        AND status = 'verified'
      ORDER BY holiday_date ASC`,
    [year]
  );
}

export async function upsertVerifiedSaudiPublicHoliday(
  db,
  data = {},
  actor = {}
) {
  const holidayCode = cleanText(
    data.holidayCode ||
      data.holiday_code
  ).toLowerCase();
  if (
    ![
      'eid_al_fitr',
      'eid_al_adha',
      'national_day',
      'founding_day',
    ].includes(holidayCode)
  ) {
    throw new AppError(
      400,
      'core_public_holiday:invalid_code'
    );
  }

  const holidayDate = validDate(
    data.holidayDate ||
      data.holiday_date,
    'holidayDate'
  );
  const sourceType = cleanText(
    data.sourceType ||
      data.source_type
  );
  const sourceReference = cleanText(
    data.sourceReference ||
      data.source_reference
  );
  if (!sourceType || !sourceReference) {
    throw new AppError(
      400,
      'core_public_holiday:verification_source_required'
    );
  }

  const names = {
    eid_al_fitr: ['عيد الفطر', 'Eid al-Fitr'],
    eid_al_adha: ['عيد الأضحى', 'Eid al-Adha'],
    national_day: ['اليوم الوطني', 'Saudi National Day'],
    founding_day: ['يوم التأسيس', 'Founding Day'],
  };
  const [nameAr, nameEn] = names[holidayCode];
  const year = Number(holidayDate.slice(0, 4));
  const now = nowIso();
  const id = requiredId(
    data.id ||
      `sa_holiday_${holidayCode}_${holidayDate}`,
    'id'
  );

  await dbRun(
    db,
    `INSERT INTO sa_public_holiday_calendar (
       id,
       holiday_code,
       holiday_date,
       holiday_name_ar,
       holiday_name_en,
       source_type,
       source_reference,
       calendar_year,
       verified_at,
       status,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
     ON CONFLICT(holiday_date, holiday_code)
     DO UPDATE SET
       holiday_name_ar = excluded.holiday_name_ar,
       holiday_name_en = excluded.holiday_name_en,
       source_type = excluded.source_type,
       source_reference = excluded.source_reference,
       calendar_year = excluded.calendar_year,
       verified_at = excluded.verified_at,
       status = 'verified',
       updated_at = excluded.updated_at`,
    [
      id,
      holidayCode,
      holidayDate,
      nameAr,
      nameEn,
      sourceType,
      sourceReference,
      year,
      now,
      now,
      now,
    ]
  );

  return dbFirst(
    db,
    `SELECT *
       FROM sa_public_holiday_calendar
      WHERE holiday_date = ?
        AND holiday_code = ?
      LIMIT 1`,
    [holidayDate, holidayCode]
  );
}

async function verifiedHolidayForDate(db, date) {
  return dbFirst(
    db,
    `SELECT *
       FROM sa_public_holiday_calendar
      WHERE holiday_date = ?
        AND status = 'verified'
      ORDER BY holiday_code ASC
      LIMIT 1`,
    [date]
  );
}

export async function createPublicHolidayWorkAssignment(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(
    data.employeeId ||
      data.employee_id,
    'employeeId'
  );
  const holidayDate = validDate(
    data.holidayDate ||
      data.holiday_date,
    'holidayDate'
  );
  const reason = cleanText(data.reason);
  if (!reason || reason.length > 1500) {
    throw new AppError(
      400,
      'core_public_holiday:assignment_reason_required'
    );
  }

  const holiday = await verifiedHolidayForDate(
    db,
    holidayDate
  );
  if (!holiday) {
    throw new AppError(
      409,
      'core_public_holiday:verified_calendar_entry_required'
    );
  }

  const existing = await dbFirst(
    db,
    `SELECT *
       FROM employee_public_holiday_work_assignments
      WHERE salon_id = ?
        AND employee_id = ?
        AND holiday_calendar_id = ?
        AND status = 'assigned'
      LIMIT 1`,
    [
      salonId,
      employeeId,
      holiday.id,
    ]
  );
  if (existing) {
    return {
      ...existing,
      idempotent: true,
    };
  }

  const now = nowIso();
  const id = requiredId(
    data.id ||
      generatedId('holiday_work_assignment'),
    'id'
  );

  await dbRun(
    db,
    `INSERT INTO employee_public_holiday_work_assignments (
       id,
       salon_id,
       employee_id,
       holiday_calendar_id,
       holiday_date,
       holiday_code,
       reason,
       note,
       status,
       assigned_by_uid,
       assigned_by_email,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'assigned', ?, ?, ?, ?)`,
    [
      id,
      salonId,
      employeeId,
      holiday.id,
      holiday.holiday_date,
      holiday.holiday_code,
      reason,
      optionalText(data.note) || null,
      actorField(actor, 'uid'),
      actorField(actor, 'email'),
      now,
      now,
    ]
  );

  return dbFirst(
    db,
    `SELECT *
       FROM employee_public_holiday_work_assignments
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );
}

export async function reconcilePublicHolidayWorkDate(
  db,
  salonId,
  employeeIdValue,
  dateValue,
  actor = {},
  externalAttendanceDb = null
) {
  const employeeId = requiredId(
    employeeIdValue,
    'employeeId'
  );
  const holidayDate = validDate(
    dateValue,
    'holidayDate'
  );
  const holiday = await verifiedHolidayForDate(
    db,
    holidayDate
  );

  if (!holiday) {
    return {
      employeeId,
      holidayDate,
      publicHoliday: false,
      event: null,
    };
  }

  const attendanceRows = await listAttendance(
    db,
    salonId,
    {
      employeeId,
      date: holidayDate,
    },
    externalAttendanceDb
  );
  const attendance = attendanceWorkedMinutes(
    attendanceRows,
    holidayDate
  );

  if (!attendance.hasAttendance) {
    return {
      employeeId,
      holidayDate,
      publicHoliday: true,
      worked: false,
      holiday,
      event: null,
    };
  }

  const assignment = await dbFirst(
    db,
    `SELECT *
       FROM employee_public_holiday_work_assignments
      WHERE salon_id = ?
        AND employee_id = ?
        AND holiday_calendar_id = ?
        AND status = 'assigned'
      LIMIT 1`,
    [
      salonId,
      employeeId,
      holiday.id,
    ]
  );

  const now = nowIso();
  const id = generatedId('public_holiday_work_event');
  const details = {
    attendanceComplete: attendance.complete,
    assignmentMissing: !assignment,
    statutoryOvertime:
      attendance.complete
        ? 'all_worked_minutes'
        : 'pending_complete_attendance',
  };

  await dbRun(
    db,
    `INSERT INTO employee_public_holiday_work_events (
       id,
       salon_id,
       employee_id,
       holiday_calendar_id,
       holiday_date,
       holiday_code,
       assignment_source_type,
       assignment_source_id,
       assignment_reason,
       attendance_source_type,
       attendance_source_id,
       attendance_evidence_json,
       worked_minutes,
       overtime_minutes,
       compensation_mode,
       employee_consent_at,
       employee_consent_reference,
       comp_time_ledger_entry_id,
       policy_version,
       status,
       details_json,
       created_by_uid,
       created_at,
       updated_at
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       'cash_overtime', NULL, NULL, NULL, ?, 'open', ?, ?, ?, ?
     )
     ON CONFLICT(salon_id, employee_id, holiday_calendar_id)
     DO UPDATE SET
       assignment_source_type = excluded.assignment_source_type,
       assignment_source_id = excluded.assignment_source_id,
       assignment_reason = excluded.assignment_reason,
       attendance_source_type = excluded.attendance_source_type,
       attendance_source_id = excluded.attendance_source_id,
       attendance_evidence_json = excluded.attendance_evidence_json,
       worked_minutes = excluded.worked_minutes,
       overtime_minutes = excluded.overtime_minutes,
       policy_version = excluded.policy_version,
       details_json = excluded.details_json,
       updated_at = excluded.updated_at`,
    [
      id,
      salonId,
      employeeId,
      holiday.id,
      holiday.holiday_date,
      holiday.holiday_code,
      assignment
        ? 'public_holiday_work_assignment'
        : null,
      assignment?.id || null,
      assignment?.reason || null,
      'attendance_records',
      attendance.firstCheckInId ||
        attendance.lastCheckOutId,
      JSON.stringify(attendance),
      attendance.workedMinutes,
      attendance.complete
        ? attendance.workedMinutes
        : 0,
      SA_LABOR_POLICY_VERSION,
      JSON.stringify(details),
      actorField(actor, 'uid'),
      now,
      now,
    ]
  );

  const event = await dbFirst(
    db,
    `SELECT *
       FROM employee_public_holiday_work_events
      WHERE salon_id = ?
        AND employee_id = ?
        AND holiday_calendar_id = ?
      LIMIT 1`,
    [
      salonId,
      employeeId,
      holiday.id,
    ]
  );

  return {
    employeeId,
    holidayDate,
    publicHoliday: true,
    worked: true,
    holiday,
    assignment,
    attendance,
    event,
  };
}
