// CORE D1 ONLY — verified Saudi Eid period calendar and holiday-work entrypoints.

import {
  cleanText,
  dbFirst,
  dbRun,
  nowIso,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  createPublicHolidayWorkAssignment,
  ensureFixedSaudiPublicHolidays,
  reconcilePublicHolidayWorkDate,
  reconcileWeeklyRestDate,
} from './rest-holiday-compliance.js';

const EID_CODES = new Set(['eid_al_fitr', 'eid_al_adha']);

function addIsoDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function saudiEidHolidayDates(codeValue, startDateValue) {
  const holidayCode = cleanText(codeValue).toLowerCase();
  if (!EID_CODES.has(holidayCode)) {
    throw new AppError(400, 'core_public_holiday:eid_code_required');
  }
  const startDate = validDate(startDateValue, 'holidayStartDate');
  return Array.from({ length: 4 }, (_, index) => addIsoDays(startDate, index));
}

export async function verifySaudiEidHolidayPeriod(db, data = {}) {
  const holidayCode = cleanText(
    data.holidayCode || data.holiday_code
  ).toLowerCase();
  const startDate = validDate(
    data.holidayStartDate || data.holiday_start_date || data.holidayDate || data.holiday_date,
    'holidayStartDate'
  );
  const sourceType = cleanText(data.sourceType || data.source_type);
  const sourceReference = cleanText(data.sourceReference || data.source_reference);
  if (!sourceType || !sourceReference) {
    throw new AppError(400, 'core_public_holiday:verification_source_required');
  }

  const dates = saudiEidHolidayDates(holidayCode, startDate);
  const names = holidayCode === 'eid_al_fitr'
    ? ['عيد الفطر', 'Eid al-Fitr']
    : ['عيد الأضحى', 'Eid al-Adha'];
  const now = nowIso();
  const entries = [];

  for (let index = 0; index < dates.length; index += 1) {
    const holidayDate = dates[index];
    const id = `sa_holiday_${holidayCode}_${startDate}_day_${index + 1}`;
    await dbRun(
      db,
      `INSERT INTO sa_public_holiday_calendar (
         id, holiday_code, holiday_date, holiday_name_ar, holiday_name_en,
         source_type, source_reference, calendar_year, verified_at, status,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
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
        names[0],
        names[1],
        sourceType,
        sourceReference,
        Number(holidayDate.slice(0, 4)),
        now,
        now,
        now,
      ]
    );
    entries.push(await dbFirst(
      db,
      `SELECT * FROM sa_public_holiday_calendar
        WHERE holiday_date = ? AND holiday_code = ? LIMIT 1`,
      [holidayDate, holidayCode]
    ));
  }

  return {
    holidayCode,
    startDate,
    dayCount: 4,
    entries,
  };
}

export {
  createPublicHolidayWorkAssignment,
  ensureFixedSaudiPublicHolidays,
  reconcilePublicHolidayWorkDate,
  reconcileWeeklyRestDate,
};
