// CORE D1 ONLY — booking availability must follow the operational HR truth.

import { cleanText, dbAll, dbFirst } from '../d1.js';
import { resolveEmployeeShift } from './shift-control.js';

const INACTIVE_EMPLOYMENT_STATUSES = new Set([
  'inactive',
  'disabled',
  'suspended',
  'archived',
  'deleted',
  'terminated',
  'resigned',
  'ended',
  'stopped',
  'blocked',
]);

function safeFakeRows(db, table) {
  if (!db?.__fakeD1 || typeof db.rows !== 'function') return [];
  try {
    return db.rows(table);
  } catch {
    return [];
  }
}

function staffIsActiveForBooking(staff) {
  const statuses = [
    staff?.employment_status,
    staff?.hr_profile_status,
    staff?.hr_employment_status,
    staff?.hr_account_status,
  ].map((status) => cleanText(status || 'active').toLowerCase());
  return Number(staff?.active) === 1 && statuses.every((status) => !INACTIVE_EMPLOYMENT_STATUSES.has(status));
}

function legacyLeaveActive(staff, date) {
  const start = cleanText(staff?.leave_start_date);
  const end = cleanText(staff?.leave_end_date);
  if (!start && !end) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

async function approvedLeavesForDate(db, salonId, employeeId, date) {
  if (db?.__fakeD1) {
    return safeFakeRows(db, 'employee_leaves').filter((row) =>
      row.salon_id === salonId &&
      cleanText(row.employee_id) === employeeId &&
      cleanText(row.status).toLowerCase() === 'approved' &&
      cleanText(row.start_date) <= date &&
      cleanText(row.end_date) >= date
    );
  }

  return dbAll(
    db,
    `SELECT * FROM employee_leaves
      WHERE salon_id = ? AND employee_id = ? AND LOWER(status) = 'approved'
        AND start_date <= ? AND end_date >= ?
      ORDER BY start_date DESC`,
    [salonId, employeeId, date, date]
  );
}

async function absenceForDate(db, salonId, employeeId, date) {
  if (db?.__fakeD1) {
    return safeFakeRows(db, 'employee_absences').find((row) =>
      row.salon_id === salonId &&
      cleanText(row.employee_id) === employeeId &&
      cleanText(row.date_key) === date
    ) || null;
  }

  return dbFirst(
    db,
    `SELECT * FROM employee_absences
      WHERE salon_id = ? AND employee_id = ? AND date_key = ?
      ORDER BY created_at DESC LIMIT 1`,
    [salonId, employeeId, date]
  );
}

function resolvedShiftWindow(shift) {
  const start = cleanText(
    shift?.start_time || shift?.startTime || shift?.template_start_time || shift?.templateStartTime
  );
  const end = cleanText(
    shift?.end_time || shift?.endTime || shift?.template_end_time || shift?.templateEndTime
  );
  return { start, end };
}

function timeInsideRange(time, start, end) {
  const value = cleanText(time);
  if (!value || !start || !end) return false;
  return value >= start && value <= end;
}

function isPartialLeave(row) {
  return cleanText(row?.duration_kind).toLowerCase() === 'partial' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanText(row?.partial_start_time)) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanText(row?.partial_end_time));
}

function rangesOverlap(startA, endA, startB, endB) {
  return Boolean(startA && endA && startB && endB && startA < endB && endA > startB);
}

function partialLeaveRanges(leaves) {
  return leaves
    .filter(isPartialLeave)
    .map((row) => ({
      startTime: cleanText(row.partial_start_time),
      endTime: cleanText(row.partial_end_time),
      source: 'employee_leaves',
      reason: 'partial_leave',
      leaveId: cleanText(row.id),
      leaveType: cleanText(row.leave_type),
    }));
}

function legacyScheduleAvailability(staff, date, startTime = '', endTime = '') {
  const schedules = Array.isArray(staff?.schedules) ? staff.schedules : [];
  if (!schedules.length || !date) return { available: true, window: null };
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const daySchedules = schedules.filter(
    (schedule) => Number(schedule.weekday) === weekday && Number(schedule.active) === 1
  );
  if (!daySchedules.length) return { available: false, window: null };
  if (!startTime && !endTime) {
    const first = daySchedules[0];
    return { available: true, window: first };
  }
  if (!startTime || !endTime) return { available: false, window: null };
  const matched = daySchedules.find((schedule) =>
    timeInsideRange(startTime, cleanText(schedule.start_time), cleanText(schedule.end_time)) &&
    timeInsideRange(endTime, cleanText(schedule.start_time), cleanText(schedule.end_time))
  );
  return { available: Boolean(matched), window: matched || null };
}

export async function resolveStaffBookingDay(db, salonId, staff, dateValue, startTime = '', endTime = '') {
  const employeeId = cleanText(staff?.id);
  const date = cleanText(dateValue);
  if (!employeeId || !date || !staffIsActiveForBooking(staff)) {
    return { available: false, reason: 'inactive', source: 'staff', blockedRanges: [] };
  }

  // Compatibility mirror for older full-day approved leave flows.
  if (legacyLeaveActive(staff, date)) {
    return { available: false, reason: 'approved_leave', source: 'legacy_leave', blockedRanges: [] };
  }

  const leaves = await approvedLeavesForDate(db, salonId, employeeId, date);
  const fullLeave = leaves.find((row) => !isPartialLeave(row));
  if (fullLeave) {
    return {
      available: false,
      reason: 'approved_leave',
      source: 'employee_leaves',
      leaveType: cleanText(fullLeave.leave_type),
      leaveId: cleanText(fullLeave.id),
      blockedRanges: [],
    };
  }

  const blockedRanges = partialLeaveRanges(leaves);
  if (
    startTime &&
    endTime &&
    blockedRanges.some((range) => rangesOverlap(startTime, endTime, range.startTime, range.endTime))
  ) {
    return {
      available: false,
      reason: 'partial_leave',
      source: 'employee_leaves',
      blockedRanges,
    };
  }

  // A recorded full-day absence means the employee must not receive a customer booking for that date.
  const absence = await absenceForDate(db, salonId, employeeId, date);
  if (absence) {
    return {
      available: false,
      reason: 'absence',
      source: 'employee_absences',
      absenceType: cleanText(absence.absence_type),
      absenceId: cleanText(absence.id),
      blockedRanges,
    };
  }

  // HR schedule is authoritative when a dated schedule/exception/assignment exists.
  const shift = await resolveEmployeeShift(db, salonId, employeeId, date).catch(() => null);
  if (shift && cleanText(shift.source) !== 'none') {
    const exceptionType = cleanText(shift.exception_type || shift.exceptionType).toLowerCase();
    if (exceptionType === 'off' || exceptionType === 'rest' || Number(shift.active) === 0) {
      return {
        available: false,
        reason: exceptionType === 'rest' ? 'rest' : 'weekly_or_schedule_off',
        source: cleanText(shift.source) || 'hr_schedule',
        shift,
        blockedRanges,
      };
    }

    const { start, end } = resolvedShiftWindow(shift);
    if (!start || !end) {
      return {
        available: false,
        reason: 'no_working_window',
        source: cleanText(shift.source),
        shift,
        blockedRanges,
      };
    }
    if (startTime || endTime) {
      if (!startTime || !endTime || !timeInsideRange(startTime, start, end) || !timeInsideRange(endTime, start, end)) {
        return {
          available: false,
          reason: 'outside_shift',
          source: cleanText(shift.source),
          startTime: start,
          endTime: end,
          shift,
          blockedRanges,
        };
      }
    }
    return {
      available: true,
      reason: '',
      source: cleanText(shift.source),
      startTime: start,
      endTime: end,
      shift,
      blockedRanges,
    };
  }

  // Migration compatibility only: use legacy staff_schedules if no HR-dated truth exists.
  const legacy = legacyScheduleAvailability(staff, date, startTime, endTime);
  if (!legacy.available) {
    return {
      available: false,
      reason: 'legacy_schedule_off',
      source: 'staff_schedules',
      blockedRanges,
    };
  }

  return {
    available: true,
    reason: '',
    source: legacy.window ? 'staff_schedules' : 'fallback',
    startTime: cleanText(legacy.window?.start_time),
    endTime: cleanText(legacy.window?.end_time),
    blockedRanges,
  };
}

export async function staffCanPerformService(db, salonId, staffIdValue, serviceIdValue) {
  const staffId = cleanText(staffIdValue);
  const serviceId = cleanText(serviceIdValue);
  if (!staffId || !serviceId) return false;

  if (db?.__fakeD1) {
    return safeFakeRows(db, 'staff_services').some((row) =>
      row.salon_id === salonId &&
      cleanText(row.staff_id) === staffId &&
      cleanText(row.service_id) === serviceId &&
      Number(row.active) === 1
    );
  }

  const row = await dbFirst(
    db,
    `SELECT staff_id FROM staff_services
      WHERE salon_id = ? AND staff_id = ? AND service_id = ? AND active = 1
      LIMIT 1`,
    [salonId, staffId, serviceId]
  );
  return Boolean(row);
}
