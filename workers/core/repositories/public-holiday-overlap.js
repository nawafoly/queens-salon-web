// CORE D1 ONLY — Saudi public-holiday overlap runtime.
// Public holidays never consume annual entitlement. When a verified holiday
// lands inside annual leave, the operational end date extends until the same
// number of annual-entitlement days has actually been consumed.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { creditCompTime } from './comp-time.js';
import {
  ensureFixedSaudiPublicHolidays,
  isExplicitWeeklyRestShift,
} from './rest-holiday-compliance.js';
import { resolveEmployeeShift } from './shift-control.js';
import { WEEKLY_REST_MINUTES } from './weekly-rest-entitlements.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateMs(dateKey) {
  return Date.parse(`${validDate(dateKey, 'date')}T12:00:00.000Z`);
}

function addDays(dateKey, days) {
  const date = new Date(dateMs(dateKey));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function rangeDays(startDate, endDate) {
  return Math.round((dateMs(endDate) - dateMs(startDate)) / DAY_MS) + 1;
}

async function ensureFixedCalendarYears(db, startDate, endDate) {
  const startYear = Number(validDate(startDate, 'startDate').slice(0, 4));
  const endYear = Number(validDate(endDate, 'endDate').slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    await ensureFixedSaudiPublicHolidays(db, year);
  }
}

async function verifiedHolidayRows(db, startDate, endDate) {
  await ensureFixedCalendarYears(db, startDate, endDate);
  return dbAll(
    db,
    `SELECT id, holiday_code, holiday_date, holiday_name_ar, holiday_name_en,
            source_type, source_reference, verified_at
       FROM sa_public_holiday_calendar
      WHERE status = 'verified'
        AND holiday_date BETWEEN ? AND ?
      ORDER BY holiday_date, holiday_code, id`,
    [startDate, endDate]
  );
}

function holidayDates(rows) {
  return new Set((rows || []).map((row) => cleanText(row.holiday_date)).filter(Boolean));
}

export async function annualLeavePublicHolidayExtension(
  db,
  salonId,
  leave
) {
  if (cleanText(leave?.leave_type).toLowerCase() !== 'annual') {
    throw new AppError(409, 'core_public_holiday:annual_leave_required');
  }
  if (cleanText(leave?.status).toLowerCase() !== 'pending') {
    throw new AppError(409, 'core_public_holiday:pending_annual_leave_required');
  }

  const startDate = validDate(leave.start_date, 'startDate');
  const existingOriginalEnd = cleanText(leave.annual_original_end_date);
  const originalEndDate = validDate(existingOriginalEnd || leave.end_date, 'endDate');
  const durationKind = cleanText(leave.duration_kind || 'full_day').toLowerCase();
  const entitlementDays = Number(leave.days_count || 0);

  if (durationKind === 'partial') {
    const rows = await verifiedHolidayRows(db, startDate, startDate);
    if (rows.length) {
      throw new AppError(409, 'core_annual_leave:partial_leave_on_public_holiday_not_allowed');
    }
    return {
      leave,
      originalEndDate,
      effectiveEndDate: originalEndDate,
      overlapDays: 0,
      holidays: [],
      idempotent: true,
    };
  }

  if (!Number.isInteger(entitlementDays) || entitlementDays <= 0) {
    throw new AppError(409, 'core_annual_leave:full_day_entitlement_days_required');
  }
  if (rangeDays(startDate, originalEndDate) !== entitlementDays) {
    throw new AppError(409, 'core_annual_leave:requested_range_days_mismatch');
  }

  // Saudi statutory public holidays are a small bounded set per year. The
  // buffer covers every possible extension without depending on a daily query.
  const yearSpan = Math.max(1, Math.ceil(entitlementDays / 365));
  const horizon = addDays(originalEndDate, yearSpan * 16 + 16);
  const rows = await verifiedHolidayRows(db, startDate, horizon);
  const dates = holidayDates(rows);

  let consumedAnnualDays = 0;
  let cursor = startDate;
  let guard = 0;
  while (consumedAnnualDays < entitlementDays) {
    if (!dates.has(cursor)) consumedAnnualDays += 1;
    if (consumedAnnualDays >= entitlementDays) break;
    cursor = addDays(cursor, 1);
    guard += 1;
    if (guard > entitlementDays + yearSpan * 20 + 40) {
      throw new AppError(409, 'core_annual_leave:public_holiday_extension_guard');
    }
  }

  const effectiveEndDate = cursor;
  const overlappingRows = rows.filter(
    (row) => row.holiday_date >= startDate && row.holiday_date <= effectiveEndDate
  );
  const overlapDays = holidayDates(overlappingRows).size;
  const evidence = overlappingRows.map((row) => ({
    id: row.id,
    code: row.holiday_code,
    date: row.holiday_date,
    nameAr: row.holiday_name_ar || null,
    sourceType: row.source_type || null,
    sourceReference: row.source_reference || null,
    verifiedAt: row.verified_at || null,
  }));

  const alreadyPrepared =
    cleanText(leave.annual_original_end_date) === originalEndDate &&
    cleanText(leave.end_date) === effectiveEndDate &&
    Number(leave.public_holiday_overlap_days || 0) === overlapDays;

  if (!alreadyPrepared) {
    await dbRun(
      db,
      `UPDATE employee_leaves
          SET annual_original_end_date = ?,
              end_date = ?,
              public_holiday_overlap_days = ?,
              public_holiday_overlap_json = ?,
              updated_at = ?
        WHERE salon_id = ? AND id = ? AND status = 'pending' AND leave_type = 'annual'`,
      [
        originalEndDate,
        effectiveEndDate,
        overlapDays,
        JSON.stringify(evidence),
        new Date().toISOString(),
        salonId,
        leave.id,
      ]
    );
  }

  const prepared = await dbFirst(
    db,
    'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, leave.id]
  );

  return {
    leave: prepared || leave,
    originalEndDate,
    effectiveEndDate,
    overlapDays,
    holidays: evidence,
    idempotent: alreadyPrepared,
  };
}

export async function reconcilePublicHolidayWeeklyRestOverlap(
  db,
  salonId,
  employeeId,
  dateValue,
  actor = {}
) {
  const date = validDate(dateValue, 'date');
  const rows = await verifiedHolidayRows(db, date, date);
  if (!rows.length) {
    return {
      employeeId,
      date,
      publicHoliday: false,
      weeklyRest: false,
      entitlement: null,
    };
  }

  const shift = await resolveEmployeeShift(db, salonId, employeeId, date);
  if (!isExplicitWeeklyRestShift(shift)) {
    return {
      employeeId,
      date,
      publicHoliday: true,
      weeklyRest: false,
      holidays: rows,
      entitlement: null,
    };
  }

  // One calendar date creates one replacement-rest entitlement even if more
  // than one official holiday code shares that date. This also enforces the
  // Eid + National/Founding no-double-compensation rule at the day level.
  const credit = await creditCompTime(
    db,
    salonId,
    {
      employeeId,
      entitlementType: 'public_holiday_overlap_due',
      minutes: WEEKLY_REST_MINUTES,
      sourceMinutes: WEEKLY_REST_MINUTES,
      sourceDate: date,
      sourceType: 'public_holiday_weekly_rest_overlap',
      sourceId: `${employeeId}:${date}`,
      note: `تعويض تداخل الراحة الأسبوعية مع إجازة رسمية: ${rows.map((row) => row.holiday_code).join(', ')}`,
    },
    actor
  );

  return {
    employeeId,
    date,
    publicHoliday: true,
    weeklyRest: true,
    holidays: rows,
    entitlement: credit,
  };
}
