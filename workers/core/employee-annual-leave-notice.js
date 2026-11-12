// Employee self-service annual leave notice period. Internal operational policy,
// not a general Saudi statutory notice period and not an HR-admin restriction.
// All calculations use Saudi civil dates, not UTC date boundaries.
import { AppError } from './errors.js';

const NOTICE_DAYS = 3;

export function riyadhCivilDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function civilDayNumber(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new AppError(400, 'core_employee_request:invalid_leave_start_date');
  const [, year, month, day] = match.map(Number);
  const millis = Date.UTC(year, month - 1, day);
  const result = new Date(millis).toISOString().slice(0, 10);
  if (result !== value) throw new AppError(400, 'core_employee_request:invalid_leave_start_date');
  return Math.floor(millis / 86400000);
}

export function minimumEmployeeAnnualLeaveDate(now = new Date()) {
  const min = new Date((civilDayNumber(riyadhCivilDate(now)) + NOTICE_DAYS) * 86400000);
  return min.toISOString().slice(0, 10);
}

export function assertEmployeeAnnualLeaveNotice(leaveType, startDate, now = new Date()) {
  if (String(leaveType || '').toLowerCase() !== 'annual') return;
  if (civilDayNumber(startDate) < civilDayNumber(riyadhCivilDate(now)) + NOTICE_DAYS) {
    throw new AppError(
      409,
      'core_employee_request:annual_leave_three_day_notice',
      'Employee annual leave must be requested at least three Saudi calendar days before its start.'
    );
  }
}
