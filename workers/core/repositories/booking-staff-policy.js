// CORE D1 ONLY — booking availability must follow the operational HR truth.

import { cleanText, dbFirst } from '../d1.js';
import { resolveEmployeeShift } from './shift-control.js';
import { staffIsActive, staffIsAvailableForDate } from './staff.js';

function safeFakeRows(db, table) {
  if (!db?.__fakeD1 || typeof db.rows !== 'function') return [];
  try {
    return db.rows(table);
  } catch {
    return [];
  }
}

function legacyLeaveActive(staff, date) {
  const start = cleanText(staff?.leave_start_date);
  const end = cleanText(staff?.leave_end_date);
  if (!start && !end) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

async function approvedLeaveForDate(db, salonId, employeeId, date) {
  if (db?.__fakeD1) {
    return safeFakeRows(db, 'employee_leaves').find((row) =>
      row.salon_id === salonId &&
      cleanText(row.employee_id) === employeeId &&
      cleanText(row.status).toLowerCase() === 'approved' &&
      cleanText(row.start_date) <= date &&
      cleanText(row.end_date) >= date
    ) || null;
  }

  return dbFirst(
    db,
    `SELECT * FROM employee_leaves
      WHERE salon_id = ? AND employee_id = ? AND LOWER(status) = 'approved'
        AND start_date <= ? AND end_date >= ?
      ORDER BY start_date DESC LIMIT 1`,
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

export async function resolveStaffBookingDay(db, salonId, staff, dateValue, startTime = '', endTime = '') {
  const employeeId = cleanText(staff?.id);
  const date = cleanText(dateValue);
  if (!employeeId || !date || !staffIsActive(staff)) {
    return { available: false, reason: 'inactive', source: 'staff' };
  }

  // Compatibility mirror for older approved leave flows.
  if (legacyLeaveActive(staff, date)) {
    return { available: false, reason: 'approved_leave', source: 'legacy_leave' };
  }

  const leave = await approvedLeaveForDate(db, salonId, employeeId, date);
  if (leave) {
    return {
      available: false,
      reason: 'approved_leave',
      source: 'employee_leaves',
      leaveType: cleanText(leave.leave_type),
      leaveId: cleanText(leave.id),
    };
  }

  // A recorded absence means the employee must not receive a customer booking for that date.
  const absence = await absenceForDate(db, salonId, employeeId, date);
  if (absence) {
    return {
      available: false,
      reason: 'absence',
      source: 'employee_absences',
      absenceType: cleanText(absence.absence_type),
      absenceId: cleanText(absence.id),
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
      };
    }

    const { start, end } = resolvedShiftWindow(shift);
    if (!start || !end) {
      return { available: false, reason: 'no_working_window', source: cleanText(shift.source), shift };
    }
    if (startTime || endTime) {
      if (!startTime || !endTime || !timeInsideRange(startTime, start, end) || !timeInsideRange(endTime, start, end)) {
        return { available: false, reason: 'outside_shift', source: cleanText(shift.source), startTime: start, endTime: end, shift };
      }
    }
    return { available: true, reason: '', source: cleanText(shift.source), startTime: start, endTime: end, shift };
  }

  // Migration compatibility only: use legacy staff_schedules if no HR-dated truth exists.
  const legacyAvailable = staffIsAvailableForDate(staff, date, startTime, endTime);
  if (!legacyAvailable) {
    return { available: false, reason: 'legacy_schedule_off', source: 'staff_schedules' };
  }

  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const legacyWindow = (Array.isArray(staff?.schedules) ? staff.schedules : []).find((row) =>
    Number(row.weekday) === weekday && Number(row.active) === 1
  );
  return {
    available: true,
    reason: '',
    source: legacyWindow ? 'staff_schedules' : 'fallback',
    startTime: cleanText(legacyWindow?.start_time),
    endTime: cleanText(legacyWindow?.end_time),
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
