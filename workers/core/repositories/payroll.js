// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { calculateGosi } from '../../../src/helpers/hr/gosiPolicy.js';
import { listAttendance } from './attendance.js';
import { listLeaves } from './leaves.js';
import { listAbsences } from './absences.js';
import { resolveEmployeeShiftsBatch } from './shift-control.js';
import { payrollAttendanceReadiness } from '../../../src/helpers/hr/payrollReadiness.js';
import {
  payrollCarryoverDelta,
  PAYROLL_CARRYOVER_SOURCE_TYPE,
} from '../../../src/helpers/hr/payrollCarryoverPolicy.js';
import { withoutPayrollObligationDeductionItems } from '../../../src/helpers/hr/payrollObligationPolicy.js';
import {
  applyTargetBonusToPayrollData,
  approveEmployeeTargetSummary,
} from './employee-targets.js';
import {
  assertPayrollObligationSnapshotCurrent,
  canonicalizePayrollObligationDeductions,
  listPayrollObligationDeductions,
  payrollObligationPaidStatements,
} from './payroll-obligations.js';

const PAYROLL_DAY_MS = 24 * 60 * 60 * 1000;
const PAYROLL_RIYADH_ZONE = 'Asia/Riyadh';

function payrollPad(value) {
  return String(value).padStart(2, '0');
}

function payrollDateFromKey(value) {
  const [year, month, day] = cleanText(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function payrollDateKey(date) {
  return `${date.getUTCFullYear()}-${payrollPad(date.getUTCMonth() + 1)}-${payrollPad(date.getUTCDate())}`;
}

function payrollMonthBoundsCanonical(payrollMonth) {
  const match = /^(\d{4})-(\d{2})$/.exec(cleanText(payrollMonth));
  if (!match) throw new AppError(400, 'core_payroll:invalid_month');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const monthStart = `${year}-${payrollPad(month)}-01`;
  const monthEnd = payrollDateKey(new Date(Date.UTC(year, month, 0, 12)));
  return { payrollMonth: `${year}-${payrollPad(month)}`, monthStart, monthEnd };
}

function payrollRiyadhTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PAYROLL_RIYADH_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function payrollCompletedThrough(bounds) {
  const today = payrollRiyadhTodayKey();
  if (bounds.monthEnd < today) return bounds.monthEnd;
  const previous = new Date(payrollDateFromKey(today).getTime() - PAYROLL_DAY_MS);
  const previousKey = payrollDateKey(previous);
  return previousKey > bounds.monthEnd ? bounds.monthEnd : previousKey;
}

function payrollDateKeys(start, end) {
  if (!start || !end || start > end) return [];
  const rows = [];
  for (let cursor = payrollDateFromKey(start); cursor.getTime() <= payrollDateFromKey(end).getTime(); cursor = new Date(cursor.getTime() + PAYROLL_DAY_MS)) {
    rows.push(payrollDateKey(cursor));
  }
  return rows;
}

function payrollTimeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(cleanText(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function payrollHoursBetween(start, end) {
  const startMinutes = payrollTimeMinutes(start);
  let endMinutes = payrollTimeMinutes(end);
  if (startMinutes == null || endMinutes == null) return 0;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return Math.max(0, Math.round(((endMinutes - startMinutes) / 60) * 100) / 100);
}

const PAYROLL_RIYADH_DATE_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: PAYROLL_RIYADH_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function payrollTimestampOffsetMinutes(value, dateKey) {
  const date = new Date(cleanText(value));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = PAYROLL_RIYADH_DATE_TIME.formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  const eventKey = `${read('year')}-${read('month')}-${read('day')}`;
  const base = payrollDateFromKey(dateKey).getTime();
  const event = payrollDateFromKey(eventKey).getTime();
  const hour = Number(read('hour'));
  const minute = Number(read('minute'));
  if (!Number.isFinite(base) || !Number.isFinite(event) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return Math.round((event - base) / PAYROLL_DAY_MS) * 24 * 60 + hour * 60 + minute;
}

function payrollRoundHours(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function payrollRoundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function payrollAbsenceUnit(type) {
  const normalized = cleanText(type).toLowerCase();
  if (normalized === 'half_day') return 0.5;
  if (normalized === 'full_day') return 1;
  return 0;
}

function payrollLeaveIsPartial(row) {
  return cleanText(row?.duration_kind).toLowerCase() === 'partial';
}

function payrollLeaveIsUnpaid(row) {
  return cleanText(row?.leave_type).toLowerCase() === 'unpaid';
}

function payrollLeaveCoversDate(row, dateKey) {
  return cleanText(row?.status).toLowerCase() === 'approved' &&
    cleanText(row?.start_date) <= dateKey && cleanText(row?.end_date) >= dateKey;
}

function payrollShiftSchedule(row) {
  if (!row) return { enabled: false, start: null, end: null, lateGraceMinutes: 0, earlyLeaveGraceMinutes: 0 };
  const source = cleanText(row.source).toLowerCase();
  const exceptionType = cleanText(row.exception_type ?? row.exceptionType).toLowerCase();
  const active = row.active;
  if (source === 'none' || exceptionType === 'off' || active === 0 || active === '0' || active === false) {
    return { enabled: false, start: null, end: null, lateGraceMinutes: 0, earlyLeaveGraceMinutes: 0 };
  }
  const start = cleanText(row.template_start_time ?? row.start_time ?? row.templateStartTime ?? row.startTime);
  const end = cleanText(row.template_end_time ?? row.end_time ?? row.templateEndTime ?? row.endTime);
  if (!start || !end) return { enabled: false, start: null, end: null, lateGraceMinutes: 0, earlyLeaveGraceMinutes: 0 };
  return {
    enabled: true,
    start,
    end,
    lateGraceMinutes: Math.max(0, Number(row.late_grace_minutes ?? row.lateGraceMinutes ?? 0) || 0),
    earlyLeaveGraceMinutes: Math.max(0, Number(row.early_leave_grace_minutes ?? row.earlyLeaveGraceMinutes ?? 0) || 0),
  };
}

function payrollPermissionMinutesForDate(rows, dateKey) {
  let paid = 0;
  let unpaid = 0;
  for (const row of rows || []) {
    if (cleanText(row.date_key) !== dateKey) continue;
    const status = cleanText(row.status).toLowerCase();
    if (!['approved', 'out', 'returned'].includes(status)) continue;
    const start = cleanText(row.actual_exit_time || row.requested_exit_time);
    const end = cleanText(row.actual_return_time || row.expected_return_time);
    const hours = payrollHoursBetween(start, end);
    if (hours <= 0) continue;
    const minutes = Math.round(hours * 60);
    if (cleanText(row.financial_effect).toLowerCase() === 'unpaid') unpaid += minutes;
    else paid += minutes;
  }
  return { paid, unpaid };
}

async function canonicalEmployment(db, salonId, employeeId) {
  const employment = await dbFirst(
    db,
    `SELECT e.*, p.name AS employee_name, p.status AS profile_status
       FROM employee_employment e
       JOIN employee_profiles p ON p.salon_id=e.salon_id AND p.id=e.employee_id
      WHERE e.salon_id=? AND e.employee_id=?
      LIMIT 1`,
    [salonId, employeeId]
  );
  if (!employment || cleanText(employment.profile_status).toLowerCase() !== 'active' || cleanText(employment.employment_status).toLowerCase() !== 'active') {
    throw new AppError(409, 'core_payroll:employee_not_active');
  }
  if (Number(employment.base_salary_halalas || 0) <= 0) {
    throw new AppError(409, 'core_payroll:employee_not_payroll_eligible');
  }
  return employment;
}

function canonicalGosiFromEmployment(employment, payrollMonth) {
  const category = cleanText(employment.social_insurance_category).toLowerCase();
  if (!category) throw new AppError(409, 'core_payroll:gosi_classification_required');
  if (category === 'gcc') throw new AppError(409, 'core_payroll:gosi_gcc_extension_policy_required');
  if (!['saudi_existing', 'saudi_new', 'non_saudi'].includes(category)) {
    throw new AppError(409, 'core_payroll:gosi_classification_required');
  }
  const payrollDate = `${payrollMonth}-28`;
  const effectiveFrom = cleanText(employment.social_insurance_effective_from);
  if (!effectiveFrom) {
    throw new AppError(409, 'core_payroll:gosi_effective_date_required');
  }
  if (effectiveFrom > payrollDate) {
    throw new AppError(409, 'core_payroll:gosi_not_effective_for_payroll_period');
  }
  try {
    return calculateGosi({
      insuranceCategory: category,
      payrollDate,
      basicSalaryHalalas: payrollRoundMoney(employment.base_salary_halalas),
      housingAllowanceHalalas: payrollRoundMoney(employment.housing_allowance_halalas),
      transportationAllowanceHalalas: payrollRoundMoney(employment.transportation_allowance_halalas),
      otherAllowancesHalalas: payrollRoundMoney(employment.other_allowances_halalas),
      wageMode: cleanText(employment.gosi_wage_mode).toLowerCase() === 'override' ? 'override' : 'derived',
      contributoryWageOverrideHalalas: payrollRoundMoney(employment.gosi_contributory_wage_override_halalas),
      overrideReason: optionalText(employment.gosi_contributory_wage_override_reason) || null,
    });
  } catch (error) {
    throw new AppError(409, cleanText(error?.message) || 'core_payroll:gosi_calculation_failed');
  }
}

async function buildCanonicalAttendanceSummary(db, salonId, employeeId, payrollMonth, employment, options = {}) {
  const bounds = payrollMonthBoundsCanonical(payrollMonth);
  const completedThrough = payrollCompletedThrough(bounds);
  const attendanceMode = cleanText(employment.attendance_payroll_mode).toLowerCase() === 'exempt' ? 'exempt' : 'required';
  const [attendanceRows, leaveRows, absenceRows, permissionRows, shiftBatch] = await Promise.all([
    listAttendance(db, salonId, { employeeId }, options.externalAttendanceDb || null),
    listLeaves(db, salonId, { employeeId, status: 'approved' }),
    listAbsences(db, salonId, { employeeId }),
    dbAll(db, `SELECT * FROM employee_permission_requests WHERE salon_id=? AND employee_id=? AND date_key BETWEEN ? AND ? ORDER BY date_key, created_at`, [salonId, employeeId, bounds.monthStart, bounds.monthEnd]).catch(() => []),
    resolveEmployeeShiftsBatch(db, salonId, { employeeIds: [employeeId], dateFrom: bounds.monthStart, dateTo: bounds.monthEnd }),
  ]);

  const periodAttendance = (attendanceRows || []).filter((row) => cleanText(row.date_key) >= bounds.monthStart && cleanText(row.date_key) <= bounds.monthEnd);
  const punchRecordCount = periodAttendance.filter((row) => ['check_in', 'check_out'].includes(cleanText(row.record_type).toLowerCase())).length;
  const paidFullDayLeaveDates = new Set();
  let approvedLeaveDays = 0;
  let approvedAbsenceDays = 0;
  for (const leave of leaveRows || []) {
    if (payrollLeaveIsPartial(leave)) continue;
    const from = cleanText(leave.start_date) < bounds.monthStart ? bounds.monthStart : cleanText(leave.start_date);
    const to = cleanText(leave.end_date) > bounds.monthEnd ? bounds.monthEnd : cleanText(leave.end_date);
    if (!from || !to || from > to) continue;
    for (const dateKey of payrollDateKeys(from, to)) {
      if (payrollLeaveIsUnpaid(leave)) approvedAbsenceDays += 1;
      else {
        approvedLeaveDays += 1;
        paidFullDayLeaveDates.add(dateKey);
      }
    }
  }
  for (const absence of absenceRows || []) {
    const dateKey = cleanText(absence.date_key);
    if (dateKey < bounds.monthStart || dateKey > bounds.monthEnd) continue;
    approvedAbsenceDays += payrollAbsenceUnit(absence.absence_type);
  }
  approvedLeaveDays = payrollRoundHours(approvedLeaveDays);
  approvedAbsenceDays = payrollRoundHours(approvedAbsenceDays);

  if (attendanceMode === 'exempt') {
    return {
      summary: {
        totalScheduledHours: 0,
        totalActualWorkedHours: 0,
        totalLateHours: 0,
        totalEarlyLeaveHours: 0,
        totalCompensatedLateHours: 0,
        totalRawMissingHours: 0,
        totalPermissionRequestedHours: 0,
        totalPermissionCoveredHours: 0,
        totalMissingHours: 0,
        totalExtraHours: 0,
        attendanceDays: 0,
        absentDays: 0,
        incompleteDays: 0,
        approvedLeaveDays,
        approvedAbsenceDays,
        absenceDeductionOverlapHours: 0,
        attendanceRecordCount: punchRecordCount,
        attendanceLinkStatus: 'exempt',
        attendancePayrollMode: 'exempt',
        attendancePayrollExemptionReason: optionalText(employment.attendance_payroll_exemption_reason) || null,
        attendanceDeductionEligible: false,
        attendanceDeductionNote: optionalText(employment.attendance_payroll_exemption_reason)
          ? `معفى من البصمة للراتب: ${cleanText(employment.attendance_payroll_exemption_reason)}`
          : 'معفى من البصمة للراتب.',
        attendanceNotes: ['Canonical Core attendance exemption applied.'],
      },
      dailyScheduledHours: 0,
    };
  }

  const shiftsByDate = new Map((shiftBatch?.rows || []).map((row) => [cleanText(row.date), row]));
  const recordsByDate = new Map();
  for (const row of periodAttendance) {
    const dateKey = cleanText(row.date_key);
    const list = recordsByDate.get(dateKey) || [];
    list.push(row);
    recordsByDate.set(dateKey, list);
  }
  let totalScheduledMinutes = 0;
  let totalActualMinutes = 0;
  let totalLateMinutes = 0;
  let totalEarlyMinutes = 0;
  let totalMissingMinutes = 0;
  let totalExtraMinutes = 0;
  let totalPermissionRequestedMinutes = 0;
  let totalPermissionCoveredMinutes = 0;
  let absenceDeductionOverlapHours = 0;
  let attendanceDays = 0;
  let absentDays = 0;
  let incompleteDays = 0;
  const scheduleHours = [];

  if (completedThrough >= bounds.monthStart) {
    for (const dateKey of payrollDateKeys(bounds.monthStart, completedThrough)) {
      const schedule = payrollShiftSchedule(shiftsByDate.get(dateKey));
      if (!schedule.enabled) continue;
      const scheduledHours = payrollHoursBetween(schedule.start, schedule.end);
      if (scheduledHours <= 0) continue;
      const scheduledMinutes = Math.round(scheduledHours * 60);
      scheduleHours.push(scheduledHours);
      totalScheduledMinutes += scheduledMinutes;

      if (paidFullDayLeaveDates.has(dateKey)) continue;

      const fullUnpaidLeave = (leaveRows || []).some((row) => payrollLeaveCoversDate(row, dateKey) && payrollLeaveIsUnpaid(row) && !payrollLeaveIsPartial(row));
      const recordedAbsenceUnit = (absenceRows || [])
        .filter((row) => cleanText(row.date_key) === dateKey)
        .reduce((total, row) => Math.max(total, payrollAbsenceUnit(row.absence_type)), 0);
      const absenceUnit = Math.max(fullUnpaidLeave ? 1 : 0, recordedAbsenceUnit);
      if (absenceUnit > 0) absenceDeductionOverlapHours += scheduledHours * absenceUnit;

      const records = (recordsByDate.get(dateKey) || [])
        .filter((row) => ['check_in', 'check_out'].includes(cleanText(row.record_type).toLowerCase()))
        .sort((a, b) => cleanText(a.recorded_at).localeCompare(cleanText(b.recorded_at)));
      const firstIn = records.find((row) => cleanText(row.record_type).toLowerCase() === 'check_in');
      const lastOut = [...records].reverse().find((row) => cleanText(row.record_type).toLowerCase() === 'check_out');
      if (!firstIn && !lastOut) {
        absentDays += 1;
        const permission = payrollPermissionMinutesForDate(permissionRows, dateKey);
        totalPermissionRequestedMinutes += permission.paid + permission.unpaid;
        const partialPaidMinutes = (leaveRows || []).filter((row) => payrollLeaveCoversDate(row, dateKey) && payrollLeaveIsPartial(row) && !payrollLeaveIsUnpaid(row))
          .reduce((sum, row) => sum + Math.round(payrollHoursBetween(row.partial_start_time, row.partial_end_time) * 60), 0);
        const cover = Math.min(scheduledMinutes, permission.paid + partialPaidMinutes);
        totalPermissionCoveredMinutes += cover;
        totalMissingMinutes += Math.max(0, scheduledMinutes - cover);
        continue;
      }
      if (!firstIn || !lastOut) {
        incompleteDays += 1;
        continue;
      }
      attendanceDays += 1;
      const checkIn = payrollTimestampOffsetMinutes(firstIn.recorded_at, dateKey);
      let checkOut = payrollTimestampOffsetMinutes(lastOut.recorded_at, dateKey);
      const scheduleStart = payrollTimeMinutes(schedule.start);
      let scheduleEnd = payrollTimeMinutes(schedule.end);
      if (checkIn == null || checkOut == null || scheduleStart == null || scheduleEnd == null) {
        incompleteDays += 1;
        continue;
      }
      if (scheduleEnd <= scheduleStart) scheduleEnd += 24 * 60;
      if (checkOut < checkIn) checkOut += 24 * 60;
      const workedMinutes = Math.max(0, checkOut - checkIn);
      totalActualMinutes += workedMinutes;
      const lateMinutes = Math.max(0, checkIn - scheduleStart - Math.round(schedule.lateGraceMinutes));
      const earlyMinutes = Math.max(0, scheduleEnd - checkOut - Math.round(schedule.earlyLeaveGraceMinutes));
      totalLateMinutes += lateMinutes;
      totalEarlyMinutes += earlyMinutes;
      const rawMissing = Math.max(0, scheduledMinutes - workedMinutes);
      const permission = payrollPermissionMinutesForDate(permissionRows, dateKey);
      totalPermissionRequestedMinutes += permission.paid + permission.unpaid;
      const partialPaidMinutes = (leaveRows || []).filter((row) => payrollLeaveCoversDate(row, dateKey) && payrollLeaveIsPartial(row) && !payrollLeaveIsUnpaid(row))
        .reduce((sum, row) => sum + Math.round(payrollHoursBetween(row.partial_start_time, row.partial_end_time) * 60), 0);
      const partialUnpaidMinutes = (leaveRows || []).filter((row) => payrollLeaveCoversDate(row, dateKey) && payrollLeaveIsPartial(row) && payrollLeaveIsUnpaid(row))
        .reduce((sum, row) => sum + Math.round(payrollHoursBetween(row.partial_start_time, row.partial_end_time) * 60), 0);
      if (partialUnpaidMinutes > 0) absenceDeductionOverlapHours += Math.min(scheduledHours, partialUnpaidMinutes / 60);
      const covered = Math.min(rawMissing, permission.paid + partialPaidMinutes);
      totalPermissionCoveredMinutes += covered;
      totalMissingMinutes += Math.max(0, rawMissing - covered);
      totalExtraMinutes += Math.max(0, workedMinutes - scheduledMinutes);
    }
  }

  const dailyScheduledHours = scheduleHours.length
    ? payrollRoundHours(scheduleHours.reduce((sum, value) => sum + value, 0) / scheduleHours.length)
    : payrollRoundHours(employment.daily_scheduled_hours);
  const deductionEligible = punchRecordCount > 0;
  return {
    summary: {
      totalScheduledHours: payrollRoundHours(totalScheduledMinutes / 60),
      totalActualWorkedHours: payrollRoundHours(totalActualMinutes / 60),
      totalLateHours: payrollRoundHours(totalLateMinutes / 60),
      totalEarlyLeaveHours: payrollRoundHours(totalEarlyMinutes / 60),
      totalCompensatedLateHours: 0,
      totalRawMissingHours: payrollRoundHours(totalMissingMinutes / 60),
      totalPermissionRequestedHours: payrollRoundHours(totalPermissionRequestedMinutes / 60),
      totalPermissionCoveredHours: payrollRoundHours(totalPermissionCoveredMinutes / 60),
      totalMissingHours: deductionEligible ? payrollRoundHours(totalMissingMinutes / 60) : 0,
      totalExtraHours: payrollRoundHours(totalExtraMinutes / 60),
      attendanceDays,
      absentDays,
      incompleteDays,
      approvedLeaveDays,
      approvedAbsenceDays,
      absenceDeductionOverlapHours: payrollRoundHours(absenceDeductionOverlapHours),
      attendanceRecordCount: punchRecordCount,
      attendanceLinkStatus: deductionEligible ? 'confirmed' : 'unlinked',
      attendancePayrollMode: 'required',
      attendancePayrollExemptionReason: null,
      attendanceDeductionEligible: deductionEligible,
      attendanceDeductionNote: deductionEligible ? null : 'لم يتم تطبيق خصم ساعات تلقائي لأن سجلات الحضور غير مرتبطة أو غير متاحة.',
      attendanceNotes: ['Canonical Core D1 attendance summary.'],
    },
    dailyScheduledHours,
  };
}

async function buildCanonicalPayrollAuthority(db, salonId, employeeId, payrollMonth, data = {}, options = {}) {
  const employment = await canonicalEmployment(db, salonId, employeeId);
  const attendance = await buildCanonicalAttendanceSummary(db, salonId, employeeId, payrollMonth, employment, options);
  const summary = attendance.summary;
  const baseSalaryHalalas = payrollRoundMoney(employment.base_salary_halalas);
  const allowancesHalalas = payrollRoundMoney(employment.housing_allowance_halalas) + payrollRoundMoney(employment.transportation_allowance_halalas) + payrollRoundMoney(employment.other_allowances_halalas);
  const workDays = Math.max(0, Number(employment.expected_work_days || 0) || 0);
  const configuredMonthlyHours = summary.attendancePayrollMode === 'exempt' ? 0 : Math.max(0, Number(employment.expected_work_hours || 0) || 0);
  const dailyScheduledHours = summary.attendancePayrollMode === 'exempt' ? 0 : (attendance.dailyScheduledHours || Math.max(0, Number(employment.daily_scheduled_hours || 0) || 0));
  const monthlyHours = configuredMonthlyHours > 0 ? configuredMonthlyHours : (workDays > 0 && dailyScheduledHours > 0 ? Math.round(workDays * dailyScheduledHours * 100) / 100 : 0);
  const dailyRateHalalas = workDays > 0 ? Math.round(baseSalaryHalalas / workDays) : 0;
  const hourlyRateHalalas = summary.attendancePayrollMode === 'exempt' ? 0 : (monthlyHours > 0 ? Math.round(baseSalaryHalalas / monthlyHours) : (dailyScheduledHours > 0 ? Math.round(dailyRateHalalas / dailyScheduledHours) : 0));
  const setupMissing = [];
  if (!employeeId) setupMissing.push('employeeId');
  if (baseSalaryHalalas <= 0) setupMissing.push('baseSalary');
  if (workDays <= 0) setupMissing.push('workDays');
  if (summary.attendancePayrollMode !== 'exempt' && monthlyHours <= 0) setupMissing.push('monthlyHours');
  const payrollSetupComplete = setupMissing.length === 0;
  const absenceDeductionHalalas = payrollSetupComplete ? Math.round(Number(summary.approvedAbsenceDays || 0) * dailyRateHalalas) : 0;
  const absenceCoveredMissingHours = Math.min(Number(summary.totalMissingHours || 0), Number(summary.absenceDeductionOverlapHours || 0));
  const attendanceMissingHours = Math.max(0, Number(summary.totalMissingHours || 0) - absenceCoveredMissingHours);
  const missingHoursDeductionHalalas = summary.attendanceDeductionEligible && payrollSetupComplete ? Math.round(attendanceMissingHours * hourlyRateHalalas) : 0;
  const overtimeEnabled = activeFlag(employment.overtime_enabled);
  const overtimeMultiplier = Math.max(0, Number(employment.overtime_multiplier || 1.5) || 1.5);
  const detectedExtraHours = Math.max(0, Number(summary.totalExtraHours || 0) || 0);
  const financialOvertimeHours = overtimeEnabled && payrollSetupComplete ? detectedExtraHours : 0;
  const overtimeValueHalalas = Math.round(financialOvertimeHours * hourlyRateHalalas * overtimeMultiplier);
  const gosiSnapshot = canonicalGosiFromEmployment(employment, payrollMonth);
  const insuranceDeductionHalalas = payrollRoundMoney(gosiSnapshot?.employee?.deductionHalalas);
  const employerGosiContributionHalalas = payrollRoundMoney(gosiSnapshot?.employer?.contributionHalalas);
  return {
    employment,
    summary,
    baseSalaryHalalas,
    allowancesHalalas,
    workDays,
    monthlyHours,
    dailyScheduledHours,
    dailyRateHalalas,
    hourlyRateHalalas,
    absenceDeductionHalalas,
    missingHoursDeductionHalalas,
    detectedExtraHours,
    overtimeEnabled,
    financialOvertimeHours,
    overtimeMultiplier,
    overtimeValueHalalas,
    gosiSnapshot,
    insuranceDeductionHalalas,
    employerGosiContributionHalalas,
    payrollSetupComplete,
    payrollSetupMissing: setupMissing,
    monthlyHoursSource: summary.attendancePayrollMode === 'exempt' ? 'not_required_attendance_exempt' : configuredMonthlyHours > 0 ? 'configured_monthly_hours' : dailyScheduledHours > 0 ? 'configured_daily_hours' : 'missing',
  };
}

function intMoney(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error('invalid_money');
    error.code = 'core_payroll:invalid_money';
    throw error;
  }
  return Math.round(number);
}

function numberValue(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function activeFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function targetSchemaUnavailable(error) {
  const message = cleanText(error?.message).toLowerCase();
  return message.includes('no such table') || message.includes('unhandled fake d1');
}

function jsonText(value, fallback) {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {}
  }
  return JSON.stringify(value === undefined ? fallback : value);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(cleanText(value) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function deductionItemsTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const amount = Number(item?.amountHalalas ?? item?.amount_halalas ?? item?.amount ?? 0);
    return sum + (Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0);
  }, 0);
}

function cleanStatus(value) {
  const status = cleanText(value || 'draft');
  if (['draft', 'reviewed', 'approved', 'paid'].includes(status)) return status;
  throw new AppError(400, 'core_payroll:invalid_status');
}

function lockedStatus(status) {
  return ['approved', 'paid'].includes(cleanText(status));
}

function appendAudit(row, action, actor = {}) {
  const entries = parseJsonArray(row?.audit_log_json);
  entries.push({
    action,
    byUid: optionalText(actor.uid) || null,
    byEmail: optionalText(actor.email) || null,
    at: nowIso(),
  });
  return JSON.stringify(entries);
}

function appendAuditEntry(row, entry = {}) {
  const entries = parseJsonArray(row?.audit_log_json);
  entries.push({
    ...entry,
    byUid: optionalText(entry.byUid ?? entry.by_uid) || null,
    byEmail: optionalText(entry.byEmail ?? entry.by_email) || null,
    at: optionalText(entry.at) || nowIso(),
  });
  return JSON.stringify(entries);
}

function payrollSetupMissing(row = {}, attendancePayrollMode = 'required') {
  const missing = [];
  const scheduleSnapshot = parseJsonObject(row.schedule_snapshot_json);
  const scheduleMissing = Array.isArray(scheduleSnapshot.payrollSetupMissing)
    ? scheduleSnapshot.payrollSetupMissing.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const dailyScheduledHours = numberValue(
    scheduleSnapshot.dailyScheduledHours ?? scheduleSnapshot.daily_scheduled_hours,
    0
  );
  const attendanceExempt = attendancePayrollMode === 'exempt';

  if (!cleanText(row.employee_id)) missing.push('employeeId');
  if (numberValue(row.base_salary_halalas, 0) <= 0) missing.push('baseSalary');
  if (numberValue(row.work_days, 0) <= 0) missing.push('workDays');
  if (
    !attendanceExempt &&
    numberValue(row.monthly_hours, 0) <= 0 &&
    dailyScheduledHours <= 0
  ) {
    missing.push('monthlyHours');
  }

  for (const key of scheduleMissing) {
    if (key === 'overtimeMultiplier') continue;
    if (attendanceExempt && key === 'monthlyHours') continue;
    if (!missing.includes(key)) missing.push(key);
  }
  return missing;
}

function assertPayrollSetupComplete(row, attendancePayrollMode = 'required') {
  const missing = payrollSetupMissing(row, attendancePayrollMode);
  if (missing.length) {
    throw new AppError(409, 'core_payroll:setup_incomplete');
  }
}

async function assertPayrollApprovalReady(
  db,
  salonId,
  row,
  options = {}
) {
  const snapshot = parseJsonObject(
    row?.attendance_summary_json
  );
  const snapshotMode =
    cleanText(
      snapshot.attendancePayrollMode ??
        snapshot.attendance_payroll_mode
    ).toLowerCase() === 'exempt'
      ? 'exempt'
      : 'required';
  let effectiveMode = snapshotMode;

  if (options.validateCanonicalPolicy !== false) {
    const employment = await dbFirst(
      db,
      `SELECT attendance_payroll_mode,
              attendance_payroll_exemption_reason,
              employment_status,
              base_salary_halalas,
              social_insurance_category,
              social_insurance_effective_from
         FROM employee_employment
        WHERE salon_id = ?
          AND employee_id = ?
        LIMIT 1`,
      [salonId, row.employee_id]
    );

    if (
      !employment ||
      cleanText(employment.employment_status).toLowerCase() !== 'active'
    ) {
      throw new AppError(409, 'core_payroll:employee_not_active');
    }

    const canonicalBaseSalaryHalalas = intMoney(
      employment.base_salary_halalas
    );
    if (canonicalBaseSalaryHalalas <= 0) {
      throw new AppError(409, 'core_payroll:employee_not_payroll_eligible');
    }

    const canonicalMode =
      cleanText(
        employment?.attendance_payroll_mode
      ).toLowerCase() === 'exempt'
        ? 'exempt'
        : 'required';

    if (canonicalMode !== snapshotMode) {
      throw new AppError(
        409,
        'core_payroll:attendance_policy_mismatch'
      );
    }

    const canonicalInsuranceCategory = cleanText(
      employment?.social_insurance_category
    ).toLowerCase();
    const canonicalInsuranceEffectiveFrom = cleanText(
      employment?.social_insurance_effective_from
    );
    const payrollPolicyDate = /^\d{4}-\d{2}$/.test(cleanText(row.payroll_month))
      ? `${cleanText(row.payroll_month)}-28`
      : '';

    if (!canonicalInsuranceCategory) {
      throw new AppError(
        409,
        'core_payroll:gosi_classification_required'
      );
    }
    if (canonicalInsuranceCategory === 'gcc') {
      throw new AppError(
        409,
        'core_payroll:gosi_gcc_extension_policy_required'
      );
    }
    if (!canonicalInsuranceEffectiveFrom) {
      throw new AppError(
        409,
        'core_payroll:gosi_effective_date_required'
      );
    }
    if (
      payrollPolicyDate &&
      canonicalInsuranceEffectiveFrom > payrollPolicyDate
    ) {
      throw new AppError(
        409,
        'core_payroll:gosi_not_effective_for_payroll_period'
      );
    }

    const gosiSnapshot = parseJsonObject(row?.gosi_snapshot_json);
    if (!cleanText(gosiSnapshot.policyVersion)) {
      throw new AppError(409, 'core_payroll:gosi_snapshot_required');
    }
    if (
      cleanText(gosiSnapshot.insuranceCategory).toLowerCase() !==
      canonicalInsuranceCategory
    ) {
      throw new AppError(409, 'core_payroll:gosi_policy_mismatch');
    }
    const snapshotEmployee =
      gosiSnapshot.employee &&
      typeof gosiSnapshot.employee === 'object' &&
      !Array.isArray(gosiSnapshot.employee)
        ? gosiSnapshot.employee
        : {};
    const snapshotEmployer =
      gosiSnapshot.employer &&
      typeof gosiSnapshot.employer === 'object' &&
      !Array.isArray(gosiSnapshot.employer)
        ? gosiSnapshot.employer
        : {};
    if (
      intMoney(row.insurance_deduction_halalas) !==
      intMoney(snapshotEmployee.deductionHalalas)
    ) {
      throw new AppError(409, 'core_payroll:gosi_employee_deduction_mismatch');
    }
    if (
      intMoney(row.employer_gosi_contribution_halalas) !==
      intMoney(snapshotEmployer.contributionHalalas)
    ) {
      throw new AppError(409, 'core_payroll:gosi_employer_contribution_mismatch');
    }

    effectiveMode = canonicalMode;
    if (canonicalMode === 'exempt') {
      snapshot.attendancePayrollExemptionReason =
        optionalText(
          employment?.attendance_payroll_exemption_reason
        ) || null;
      snapshot.attendanceLinkStatus = 'exempt';
      snapshot.attendanceDeductionEligible = false;
    }
  }

  assertPayrollSetupComplete(row, effectiveMode);

  const attendanceReadiness =
    payrollAttendanceReadiness(snapshot);

  if (!attendanceReadiness.ready) {
    throw new AppError(
      409,
      `core_payroll:${attendanceReadiness.code}`
    );
  }
}

export async function listPayrollPeriods(db, salonId) {
  return dbAll(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? ORDER BY payroll_month DESC LIMIT 120', [salonId]);
}

export async function upsertPayrollPeriod(db, salonId, data, actor = {}) {
  const payrollMonth = cleanText(data.payrollMonth || data.payroll_month);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    const error = new Error('invalid_payroll_month');
    error.code = 'core_payroll:invalid_month';
    throw error;
  }
  const now = nowIso();
  const monthStart = validDate(data.monthStart || data.month_start || `${payrollMonth}-01`, 'monthStart');
  const monthEnd = validDate(data.monthEnd || data.month_end, 'monthEnd');
  const existing = await dbFirst(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? AND payroll_month = ? LIMIT 1', [salonId, payrollMonth]);
  const row = {
    id: existing?.id || requiredId(data.id || generatedId('payroll_period')),
    salon_id: salonId,
    payroll_month: payrollMonth,
    month_start: monthStart,
    month_end: monthEnd,
    status: cleanText(data.status || existing?.status || 'open'),
    created_by_uid: existing?.created_by_uid || optionalText(actor.uid) || null,
    closed_by_uid: data.closedByUid === undefined ? existing?.closed_by_uid || null : optionalText(data.closedByUid) || null,
    closed_at: data.closedAt === undefined ? existing?.closed_at || null : optionalText(data.closedAt) || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await dbRun(db, `INSERT INTO payroll_periods
    (id, salon_id, payroll_month, month_start, month_end, status, created_by_uid, closed_by_uid, closed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(salon_id, payroll_month) DO UPDATE SET
      month_start = excluded.month_start, month_end = excluded.month_end, status = excluded.status,
      closed_by_uid = excluded.closed_by_uid, closed_at = excluded.closed_at, updated_at = excluded.updated_at`, Object.values(row));
  return dbFirst(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? AND payroll_month = ? LIMIT 1', [salonId, payrollMonth]);
}

export async function listPayrollEntries(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? ORDER BY payroll_month DESC, employee_id LIMIT 2000', [salonId]);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const status = cleanText(query.status);
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (payrollMonth) rows = rows.filter((row) => row.payroll_month === payrollMonth);
  if (status) rows = rows.filter((row) => cleanText(row.status || 'draft') === status);
  return rows;
}

export async function getPayrollEntry(db, salonId, id) {
  const entryId = requiredId(id, 'payrollEntryId');
  const row = await dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, entryId]);
  if (!row) throw new AppError(404, 'core_payroll:not_found');
  return row;
}

export async function listPayrollAdvanceDeductions(db, salonId, query = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const rows = await dbAll(
    db,
    `SELECT sa.employee_id, sai.payroll_month,
            COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sai.status IN ('scheduled', 'deducted')
      GROUP BY sa.employee_id, sai.payroll_month
      ORDER BY sai.payroll_month, sa.employee_id`,
    [salonId]
  );
  return rows.filter((row) =>
    (!employeeId || cleanText(row.employee_id) === employeeId) &&
    (!payrollMonth || cleanText(row.payroll_month) === payrollMonth)
  );
}


function carryoverSchemaUnavailable(error) {
  const message = cleanText(error?.message).toLowerCase();
  return message.includes('no such table') || message.includes('unhandled fake d1');
}

function validPayrollMonthKey(value, field = 'payrollMonth') {
  const payrollMonth = cleanText(value);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    throw new AppError(400, `core_payroll:invalid_${field}`);
  }
  return payrollMonth;
}

function carryoverSignedAmount(row) {
  const amount = Math.max(0, Number(row?.amount_halalas || 0));
  return cleanText(row?.direction) === 'addition' ? amount : -amount;
}

function carryoverSourceIds(row) {
  return [...new Set([
    ...parseJsonArray(row?.additions_json),
    ...parseJsonArray(row?.deductions_json),
  ]
    .filter((item) => cleanText(item?.sourceType ?? item?.source_type) === PAYROLL_CARRYOVER_SOURCE_TYPE)
    .map((item) => cleanText(item?.sourceId ?? item?.source_id))
    .filter(Boolean))];
}

async function latestPayrollApprovalSnapshot(db, salonId, payrollEntryId) {
  try {
    return await dbFirst(
      db,
      `SELECT *
         FROM payroll_approval_snapshots
        WHERE salon_id = ?
          AND payroll_entry_id = ?
        ORDER BY approval_version DESC
        LIMIT 1`,
      [salonId, payrollEntryId]
    );
  } catch (error) {
    if (carryoverSchemaUnavailable(error)) return null;
    throw error;
  }
}

async function nextApprovalSnapshotVersion(db, salonId, payrollEntryId) {
  const row = await dbFirst(
    db,
    `SELECT COALESCE(MAX(approval_version), 0) AS version
       FROM payroll_approval_snapshots
      WHERE salon_id = ?
        AND payroll_entry_id = ?`,
    [salonId, payrollEntryId]
  );
  return Math.max(0, Number(row?.version || 0)) + 1;
}

async function buildApprovalSnapshotStatement(db, salonId, entry, actor = {}, approvedAt = nowIso()) {
  const approvalVersion = await nextApprovalSnapshotVersion(db, salonId, entry.id);
  const snapshotId = generatedId('payroll_approval_snapshot');
  const approvedNetHalalas = Math.max(0, Number(entry.net_salary_halalas ?? entry.final_salary_halalas ?? 0));
  const baseSalaryHalalas = Math.max(0, Number(entry.base_salary_halalas || 0));
  const grossSalaryHalalas = Math.max(0, Number(entry.gross_salary_halalas || 0));
  const totalAdditionsHalalas = Math.max(0, grossSalaryHalalas - baseSalaryHalalas);
  const totalDeductionsHalalas = Math.max(0, Number(entry.total_deductions_halalas || 0));
  return {
    id: snapshotId,
    sql: `INSERT INTO payroll_approval_snapshots
      (id, salon_id, payroll_entry_id, employee_id, payroll_month, approval_version,
       approved_at, approved_by_uid, approved_net_halalas, base_salary_halalas,
       total_additions_halalas, total_deductions_halalas, attendance_summary_json,
       gosi_snapshot_json, employer_gosi_contribution_halalas,
       entry_snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      snapshotId,
      salonId,
      entry.id,
      entry.employee_id,
      entry.payroll_month,
      approvalVersion,
      approvedAt,
      optionalText(actor.uid) || null,
      approvedNetHalalas,
      baseSalaryHalalas,
      totalAdditionsHalalas,
      totalDeductionsHalalas,
      entry.attendance_summary_json || null,
      entry.gosi_snapshot_json || null,
      Math.max(0, Number(entry.employer_gosi_contribution_halalas || 0)),
      JSON.stringify(entry),
      approvedAt,
    ],
  };
}

async function ensureApprovalSnapshotExists(db, salonId, entry, actor = {}) {
  const existingSnapshot = await latestPayrollApprovalSnapshot(db, salonId, entry.id);
  if (existingSnapshot) return existingSnapshot;
  const approvedAt = optionalText(entry.approved_at) || nowIso();
  const statement = await buildApprovalSnapshotStatement(db, salonId, entry, actor, approvedAt);
  await dbRun(db, statement.sql, statement.params);
  return latestPayrollApprovalSnapshot(db, salonId, entry.id);
}

export async function listPayrollCarryoverAdjustments(db, salonId, query = {}) {
  let rows;
  try {
    rows = await dbAll(
      db,
      `SELECT *
         FROM payroll_carryover_adjustments
        WHERE salon_id = ?
        ORDER BY target_payroll_month DESC, employee_id, created_at`,
      [salonId]
    );
  } catch (error) {
    if (carryoverSchemaUnavailable(error)) return [];
    throw error;
  }
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const targetPayrollMonth = cleanText(query.targetPayrollMonth || query.target_payroll_month);
  const sourcePayrollMonth = cleanText(query.sourcePayrollMonth || query.source_payroll_month);
  const status = cleanText(query.status);
  return rows.filter((row) =>
    (!employeeId || cleanText(row.employee_id) === employeeId) &&
    (!targetPayrollMonth || cleanText(row.target_payroll_month) === targetPayrollMonth) &&
    (!sourcePayrollMonth || cleanText(row.source_payroll_month) === sourcePayrollMonth) &&
    (!status || status === 'active'
      ? ['pending', 'applied'].includes(cleanText(row.status))
      : cleanText(row.status) === status)
  );
}

async function canonicalRecalculatedNetForLockedEntry(db, salonId, sourceEntry, options = {}) {
  const sourceAttendance = parseJsonObject(sourceEntry.attendance_summary_json);
  const employment = await canonicalEmployment(db, salonId, sourceEntry.employee_id);
  const employmentForPeriod = {
    ...employment,
    attendance_payroll_mode:
      cleanText(sourceAttendance.attendancePayrollMode ?? sourceAttendance.attendance_payroll_mode).toLowerCase() === 'exempt'
        ? 'exempt'
        : 'required',
    attendance_payroll_exemption_reason:
      optionalText(sourceAttendance.attendancePayrollExemptionReason ?? sourceAttendance.attendance_payroll_exemption_reason) ||
      optionalText(employment.attendance_payroll_exemption_reason) || null,
  };
  const attendance = await buildCanonicalAttendanceSummary(
    db,
    salonId,
    sourceEntry.employee_id,
    sourceEntry.payroll_month,
    employmentForPeriod,
    options
  );
  const summary = attendance.summary;
  const dailyRateHalalas = intMoney(sourceEntry.daily_rate_halalas);
  const hourlyRateHalalas = intMoney(sourceEntry.hourly_rate_halalas);
  const absenceDeductionHalalas = payrollRoundMoney(
    Number(summary.approvedAbsenceDays || 0) * dailyRateHalalas
  );
  const missingHours = Math.max(
    0,
    payrollRoundHours(
      Number(summary.totalMissingHours || 0) - Number(summary.absenceDeductionOverlapHours || 0)
    )
  );
  const missingHoursDeductionHalalas = payrollRoundMoney(missingHours * hourlyRateHalalas);
  const detectedExtraHours = Math.max(0, payrollRoundHours(summary.totalExtraHours || 0));
  const overtimeEnabled = activeFlag(sourceEntry.overtime_enabled) === 1;
  const overtimeMultiplier = Math.max(0, numberValue(sourceEntry.overtime_multiplier, 1.5));
  const financialOvertimeHours = overtimeEnabled ? detectedExtraHours : 0;
  const overtimeValueHalalas = payrollRoundMoney(
    financialOvertimeHours * hourlyRateHalalas * overtimeMultiplier
  );
  const grossSalaryHalalas =
    intMoney(sourceEntry.base_salary_halalas) +
    intMoney(sourceEntry.allowances_halalas) +
    intMoney(sourceEntry.manual_additions_halalas) +
    overtimeValueHalalas;
  const totalDeductionsHalalas =
    absenceDeductionHalalas +
    missingHoursDeductionHalalas +
    intMoney(sourceEntry.insurance_deduction_halalas) +
    intMoney(sourceEntry.manual_deductions_halalas) +
    intMoney(sourceEntry.advances_halalas) +
    intMoney(sourceEntry.other_deductions_halalas);
  return {
    netSalaryHalalas: Math.max(0, grossSalaryHalalas - totalDeductionsHalalas),
    attendanceSummary: summary,
    absenceDeductionHalalas,
    missingHoursDeductionHalalas,
    overtimeValueHalalas,
  };
}

async function reconcilePayrollCarryover(db, salonId, data, actor = {}, options = {}) {
  const sourcePayrollEntryId = requiredId(
    data.sourcePayrollEntryId || data.source_payroll_entry_id,
    'sourcePayrollEntryId'
  );
  const targetPayrollMonth = validPayrollMonthKey(
    data.targetPayrollMonth || data.target_payroll_month,
    'target_month'
  );
  const sourceEntry = await getPayrollEntry(db, salonId, sourcePayrollEntryId);
  if (!['approved', 'paid'].includes(cleanText(sourceEntry.status))) {
    throw new AppError(409, 'core_payroll:carryover_source_not_approved');
  }
  const canonicalRecalculation = await canonicalRecalculatedNetForLockedEntry(
    db,
    salonId,
    sourceEntry,
    options
  );
  const recalculatedNetHalalas = canonicalRecalculation.netSalaryHalalas;
  if (targetPayrollMonth <= cleanText(sourceEntry.payroll_month)) {
    throw new AppError(400, 'core_payroll:carryover_target_must_be_future');
  }

  const snapshot = await ensureApprovalSnapshotExists(db, salonId, sourceEntry, actor);
  if (!snapshot) throw new AppError(409, 'core_payroll:approval_snapshot_missing');

  const desired = payrollCarryoverDelta(
    snapshot.approved_net_halalas,
    recalculatedNetHalalas
  );
  const rows = await dbAll(
    db,
    `SELECT *
       FROM payroll_carryover_adjustments
      WHERE salon_id = ?
        AND source_snapshot_id = ?
        AND status <> 'void'
      ORDER BY created_at`,
    [salonId, snapshot.id]
  );
  const appliedSigned = rows
    .filter((row) => cleanText(row.status) === 'applied')
    .reduce((total, row) => total + carryoverSignedAmount(row), 0);
  const pending = rows.find(
    (row) => cleanText(row.status) === 'pending' && cleanText(row.target_payroll_month) === targetPayrollMonth
  );
  const residualSigned = desired.signedDeltaHalalas - appliedSigned;
  const now = nowIso();
  const sourceDate = optionalText(data.sourceDate || data.source_date) || null;
  const reason = optionalText(data.reason) ||
    `تسوية فرق مسيرة ${sourceEntry.payroll_month} بعد إعادة الاحتساب النهائي للحضور والإجازات والخصومات.`;

  if (residualSigned === 0) {
    if (pending) {
      await dbRun(
        db,
        `UPDATE payroll_carryover_adjustments
            SET status = 'void', amount_halalas = 0,
                recalculated_net_halalas = ?, reason = ?, source_date = ?, updated_at = ?
          WHERE salon_id = ? AND id = ? AND status = 'pending'`,
        [recalculatedNetHalalas, reason, sourceDate, now, salonId, pending.id]
      );
    }
    return {
      sourcePayrollEntryId,
      sourcePayrollMonth: sourceEntry.payroll_month,
      targetPayrollMonth,
      employeeId: sourceEntry.employee_id,
      approvedNetHalalas: desired.approvedNetHalalas,
      recalculatedNetHalalas: desired.recalculatedNetHalalas,
      desiredSignedDeltaHalalas: desired.signedDeltaHalalas,
      appliedSignedHalalas: appliedSigned,
      residualSignedHalalas: 0,
      adjustment: null,
    };
  }

  const direction = residualSigned > 0 ? 'addition' : 'deduction';
  const amountHalalas = Math.abs(residualSigned);
  let adjustmentId = pending?.id || generatedId('payroll_carryover');
  if (pending) {
    await dbRun(
      db,
      `UPDATE payroll_carryover_adjustments
          SET direction = ?, amount_halalas = ?, approved_net_halalas = ?,
              recalculated_net_halalas = ?, reason = ?, source_date = ?, updated_at = ?
        WHERE salon_id = ? AND id = ? AND status = 'pending'`,
      [
        direction,
        amountHalalas,
        desired.approvedNetHalalas,
        recalculatedNetHalalas,
        reason,
        sourceDate,
        now,
        salonId,
        pending.id,
      ]
    );
  } else {
    await dbRun(
      db,
      `INSERT INTO payroll_carryover_adjustments
        (id, salon_id, employee_id, source_payroll_month, target_payroll_month,
         source_payroll_entry_id, source_snapshot_id, direction, amount_halalas,
         approved_net_halalas, recalculated_net_halalas, reason, source_date,
         status, target_payroll_entry_id, applied_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
      [
        adjustmentId,
        salonId,
        sourceEntry.employee_id,
        sourceEntry.payroll_month,
        targetPayrollMonth,
        sourceEntry.id,
        snapshot.id,
        direction,
        amountHalalas,
        desired.approvedNetHalalas,
        recalculatedNetHalalas,
        reason,
        sourceDate,
        now,
        now,
      ]
    );
  }

  const adjustment = await dbFirst(
    db,
    `SELECT * FROM payroll_carryover_adjustments WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, adjustmentId]
  );
  return {
    sourcePayrollEntryId,
    sourcePayrollMonth: sourceEntry.payroll_month,
    targetPayrollMonth,
    employeeId: sourceEntry.employee_id,
    approvedNetHalalas: desired.approvedNetHalalas,
    recalculatedNetHalalas: desired.recalculatedNetHalalas,
    desiredSignedDeltaHalalas: desired.signedDeltaHalalas,
    appliedSignedHalalas: appliedSigned,
    residualSignedHalalas: residualSigned,
    adjustment,
  };
}

export async function reconcilePayrollCarryoversBatch(db, salonId, data = {}, actor = {}, options = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 200) throw new AppError(400, 'core_payroll:carryover_batch_too_large');
  const results = [];
  for (const item of items) {
    results.push(await reconcilePayrollCarryover(db, salonId, item, actor, options));
  }
  return { results };
}

const PAYROLL_ENTRY_MUTATION_COLUMNS = [
  'id',
  'salon_id',
  'period_id',
  'employee_id',
  'payroll_month',
  'employee_name',
  'job_title',
  'base_salary_halalas',
  'allowances_halalas',
  'work_days',
  'monthly_hours',
  'daily_rate_halalas',
  'hourly_rate_halalas',
  'absence_days',
  'absence_deduction_halalas',
  'expected_work_hours',
  'actual_worked_hours',
  'missing_hours',
  'overtime_hours',
  'attendance_summary_json',
  'detected_extra_hours',
  'overtime_enabled',
  'financial_overtime_hours',
  'overtime_multiplier',
  'overtime_value_halalas',
  'overtime_bonus_halalas',
  'delay_deduction_halalas',
  'insurance_deduction_halalas',
  'gosi_insurance_category',
  'gosi_policy_version',
  'gosi_contributory_wage_halalas',
  'employer_gosi_contribution_halalas',
  'gosi_snapshot_json',
  'gosi_calculated_at',
  'other_deductions_halalas',
  'missing_hours_deduction_halalas',
  'additions_json',
  'manual_additions_halalas',
  'manual_deductions_halalas',
  'advances_halalas',
  'total_deductions_halalas',
  'gross_salary_halalas',
  'final_salary_halalas',
  'net_salary_halalas',
  'schedule_snapshot_json',
  'absence_entries_json',
  'deductions_json',
  'mudad_file_id',
  'status',
  'approved_at',
  'approved_by_uid',
  'paid_at',
  'paid_by_uid',
  'notes',
  'audit_log_json',
  'created_by_uid',
  'created_by_email',
  'created_at',
  'updated_at',
];

export function buildPayrollEntryMutationStatement(row) {
  return {
    sql: `INSERT INTO payroll_entries
      (id, salon_id, period_id, employee_id, payroll_month, employee_name, job_title,
       base_salary_halalas, allowances_halalas, work_days, monthly_hours, daily_rate_halalas,
       hourly_rate_halalas, absence_days, absence_deduction_halalas, expected_work_hours,
       actual_worked_hours, missing_hours, overtime_hours, attendance_summary_json,
       detected_extra_hours, overtime_enabled, financial_overtime_hours, overtime_multiplier,
       overtime_value_halalas, overtime_bonus_halalas, delay_deduction_halalas,
       insurance_deduction_halalas, gosi_insurance_category, gosi_policy_version,
       gosi_contributory_wage_halalas, employer_gosi_contribution_halalas, gosi_snapshot_json,
       gosi_calculated_at, other_deductions_halalas, missing_hours_deduction_halalas,
       additions_json, manual_additions_halalas, manual_deductions_halalas, advances_halalas,
       total_deductions_halalas, gross_salary_halalas, final_salary_halalas, net_salary_halalas,
       schedule_snapshot_json, absence_entries_json, deductions_json, mudad_file_id, status,
       approved_at, approved_by_uid, paid_at, paid_by_uid, notes, audit_log_json,
       created_by_uid, created_by_email, created_at, updated_at)
      VALUES (${PAYROLL_ENTRY_MUTATION_COLUMNS.map(() => '?').join(', ')})
      ON CONFLICT(salon_id, employee_id, payroll_month) DO UPDATE SET
        period_id = excluded.period_id, employee_name = excluded.employee_name, job_title = excluded.job_title,
        base_salary_halalas = excluded.base_salary_halalas,
        allowances_halalas = excluded.allowances_halalas, work_days = excluded.work_days,
        monthly_hours = excluded.monthly_hours, daily_rate_halalas = excluded.daily_rate_halalas,
        hourly_rate_halalas = excluded.hourly_rate_halalas, absence_days = excluded.absence_days,
        absence_deduction_halalas = excluded.absence_deduction_halalas,
        expected_work_hours = excluded.expected_work_hours, actual_worked_hours = excluded.actual_worked_hours,
        missing_hours = excluded.missing_hours, overtime_hours = excluded.overtime_hours,
        attendance_summary_json = excluded.attendance_summary_json,
        detected_extra_hours = excluded.detected_extra_hours, overtime_enabled = excluded.overtime_enabled,
        financial_overtime_hours = excluded.financial_overtime_hours,
        overtime_multiplier = excluded.overtime_multiplier,
        overtime_value_halalas = excluded.overtime_value_halalas,
        overtime_bonus_halalas = excluded.overtime_bonus_halalas,
        delay_deduction_halalas = excluded.delay_deduction_halalas,
        insurance_deduction_halalas = excluded.insurance_deduction_halalas,
        gosi_insurance_category = excluded.gosi_insurance_category,
        gosi_policy_version = excluded.gosi_policy_version,
        gosi_contributory_wage_halalas = excluded.gosi_contributory_wage_halalas,
        employer_gosi_contribution_halalas = excluded.employer_gosi_contribution_halalas,
        gosi_snapshot_json = excluded.gosi_snapshot_json,
        gosi_calculated_at = excluded.gosi_calculated_at,
        other_deductions_halalas = excluded.other_deductions_halalas,
        missing_hours_deduction_halalas = excluded.missing_hours_deduction_halalas,
        additions_json = excluded.additions_json,
        manual_additions_halalas = excluded.manual_additions_halalas,
        manual_deductions_halalas = excluded.manual_deductions_halalas,
        advances_halalas = excluded.advances_halalas,
        total_deductions_halalas = excluded.total_deductions_halalas,
        gross_salary_halalas = excluded.gross_salary_halalas, final_salary_halalas = excluded.final_salary_halalas,
        net_salary_halalas = excluded.net_salary_halalas,
        schedule_snapshot_json = excluded.schedule_snapshot_json,
        absence_entries_json = excluded.absence_entries_json, deductions_json = excluded.deductions_json,
        mudad_file_id = excluded.mudad_file_id, status = excluded.status,
        approved_at = excluded.approved_at, approved_by_uid = excluded.approved_by_uid,
        paid_at = excluded.paid_at, paid_by_uid = excluded.paid_by_uid, notes = excluded.notes,
        audit_log_json = excluded.audit_log_json, updated_at = excluded.updated_at`,
    params: PAYROLL_ENTRY_MUTATION_COLUMNS.map((column) => row[column]),
  };
}

export async function upsertPayrollEntry(db, salonId, data, actor = {}, options = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const payrollMonth = cleanText(data.payrollMonth || data.payroll_month);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    const error = new Error('invalid_payroll_month');
    error.code = 'core_payroll:invalid_month';
    throw error;
  }
  const existing = await dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1', [salonId, employeeId, payrollMonth]);
  if (existing && lockedStatus(existing.status) && data.allowLockedUpdate !== true) {
    throw new AppError(409, 'core_payroll:locked_entry');
  }
  const now = nowIso();
  const status = cleanStatus(data.status || existing?.status || 'draft');
  let targetBonus = null;
  if (!['approved', 'paid'].includes(cleanText(existing?.status || '')) && data.skipTargetBonus !== true) {
    try {
      targetBonus = await applyTargetBonusToPayrollData(db, salonId, {
        ...data,
        employeeId,
        payrollMonth,
      }, actor);
      data = {
        ...data,
        additions: targetBonus.additions,
        manualAdditionsHalalas: targetBonus.manualAdditionsHalalas,
        grossSalaryHalalas: targetBonus.grossSalaryHalalas,
        finalSalaryHalalas: targetBonus.finalSalaryHalalas,
        netSalaryHalalas: targetBonus.netSalaryHalalas,
      };
    } catch (error) {
      if (!targetSchemaUnavailable(error)) throw error;
    }
  }
  const submittedDeductions = Array.isArray(data.deductions)
    ? data.deductions
    : Array.isArray(data.salaryDeductions)
      ? data.salaryDeductions
      : parseJsonArray(data.deductions_json);
  if (submittedDeductions.some((item) => cleanText(item?.kind) === 'advance')) {
    throw new AppError(400, 'core_payroll:manual_advance_not_allowed');
  }

  const obligationCanonical = options.previewOnly === true
    ? (() => null)()
    : await canonicalizePayrollObligationDeductions(
        db,
        salonId,
        {
          ...data,
          employeeId,
          payrollMonth,
          deductions: submittedDeductions,
        },
        actor
      );
  const previewObligationDeductions = options.previewOnly === true
    ? await listPayrollObligationDeductions(db, salonId, { employeeId, payrollMonth })
    : [];
  const canonicalDeductions = options.previewOnly === true
    ? [
        ...withoutPayrollObligationDeductionItems(submittedDeductions),
        ...previewObligationDeductions,
      ]
    : obligationCanonical.deductions;
  const canonicalManualDeductionsHalalas = deductionItemsTotal(canonicalDeductions);

  const hasInternalCanonicalAdvance = Object.prototype.hasOwnProperty.call(
    options,
    'internalCanonicalAdvanceHalalas'
  );
  if (hasInternalCanonicalAdvance && options.previewOnly !== true) {
    throw new AppError(
      500,
      'core_payroll:internal_advance_override_requires_preview'
    );
  }

  let canonicalAdvanceHalalas = 0;
  if (hasInternalCanonicalAdvance) {
    const internalAdvance = Number(options.internalCanonicalAdvanceHalalas);
    if (!Number.isSafeInteger(internalAdvance) || internalAdvance < 0) {
      throw new AppError(
        500,
        'core_payroll:invalid_internal_advance_override'
      );
    }
    canonicalAdvanceHalalas = internalAdvance;
  } else {
    const canonicalAdvanceRows = await listPayrollAdvanceDeductions(
      db,
      salonId,
      { employeeId, payrollMonth }
    );
    canonicalAdvanceHalalas = Math.max(
      0,
      Number(canonicalAdvanceRows[0]?.amount_halalas || 0)
    );
  }
  const authority = await buildCanonicalPayrollAuthority(
    db,
    salonId,
    employeeId,
    payrollMonth,
    data,
    options
  );
  const submittedAdditions = Array.isArray(data.additions)
    ? data.additions
    : parseJsonArray(data.additions_json);
  const canonicalManualAdditionsHalalas = deductionItemsTotal(submittedAdditions);
  const canonicalGrossSalaryHalalas =
    authority.baseSalaryHalalas +
    authority.allowancesHalalas +
    canonicalManualAdditionsHalalas +
    authority.overtimeValueHalalas;
  const canonicalLegacyOtherDeductionsHalalas = 0;
  const canonicalTotalDeductionsHalalas =
    authority.absenceDeductionHalalas +
    authority.missingHoursDeductionHalalas +
    authority.insuranceDeductionHalalas +
    canonicalManualDeductionsHalalas +
    canonicalAdvanceHalalas;
  const canonicalNetSalaryHalalas = Math.max(
    0,
    canonicalGrossSalaryHalalas - canonicalTotalDeductionsHalalas
  );
  data = {
    ...data,
    employeeName: cleanText(authority.employment.employee_name) || data.employeeName || data.employee_name,
    jobTitle: cleanText(authority.employment.job_title || authority.employment.title) || data.jobTitle || data.job_title,
    baseSalaryHalalas: authority.baseSalaryHalalas,
    allowancesHalalas: authority.allowancesHalalas,
    workDays: authority.workDays,
    monthlyHours: authority.monthlyHours,
    dailyRateHalalas: authority.dailyRateHalalas,
    hourlyRateHalalas: authority.hourlyRateHalalas,
    absenceDays: Number(authority.summary.approvedAbsenceDays || 0),
    absenceDeductionHalalas: authority.absenceDeductionHalalas,
    expectedWorkHours: Number(authority.summary.totalScheduledHours || 0),
    actualWorkedHours: Number(authority.summary.totalActualWorkedHours || 0),
    missingHours: Number(authority.summary.totalMissingHours || 0),
    overtimeHours: authority.financialOvertimeHours,
    attendanceSummary: authority.summary,
    detectedExtraHours: authority.detectedExtraHours,
    overtimeEnabled: Boolean(authority.overtimeEnabled),
    financialOvertimeHours: authority.financialOvertimeHours,
    overtimeMultiplier: authority.overtimeMultiplier,
    overtimeValueHalalas: authority.overtimeValueHalalas,
    overtimeBonusHalalas: authority.overtimeValueHalalas,
    delayDeductionHalalas: 0,
    insuranceDeductionHalalas: authority.insuranceDeductionHalalas,
    gosiInsuranceCategory: authority.gosiSnapshot?.insuranceCategory || null,
    gosiPolicyVersion: authority.gosiSnapshot?.policyVersion || null,
    gosiContributoryWageHalalas: authority.gosiSnapshot?.contributoryWage?.appliedHalalas || 0,
    employerGosiContributionHalalas: authority.employerGosiContributionHalalas,
    gosiSnapshot: authority.gosiSnapshot,
    gosiCalculatedAt: now,
    deductions: canonicalDeductions,
    otherDeductionsHalalas: canonicalLegacyOtherDeductionsHalalas,
    manualAdditionsHalalas: canonicalManualAdditionsHalalas,
    manualDeductionsHalalas: canonicalManualDeductionsHalalas,
    advancesHalalas: canonicalAdvanceHalalas,
    missingHoursDeductionHalalas: authority.missingHoursDeductionHalalas,
    totalDeductionsHalalas: canonicalTotalDeductionsHalalas,
    grossSalaryHalalas: canonicalGrossSalaryHalalas,
    netSalaryHalalas: canonicalNetSalaryHalalas,
    finalSalaryHalalas: canonicalNetSalaryHalalas,
    scheduleSnapshot: {
      workDays: authority.workDays,
      monthlyHours: authority.monthlyHours,
      dailyScheduledHours: authority.dailyScheduledHours,
      payrollSetupComplete: authority.payrollSetupComplete,
      payrollSetupMissing: authority.payrollSetupMissing,
      monthlyHoursSource: authority.monthlyHoursSource,
      attendancePayrollMode: authority.summary.attendancePayrollMode || 'required',
      attendancePayrollExemptionReason: authority.summary.attendancePayrollExemptionReason || null,
    },
  };

  const overtimeEnabled = activeFlag(data.overtimeEnabled);
  const auditLog = existing?.audit_log_json || jsonText([{ action: 'created', byUid: optionalText(actor.uid) || null, at: now }], []);
  const row = {
    id: existing?.id || requiredId(data.id || generatedId('payroll')),
    salon_id: salonId,
    period_id: optionalText(data.periodId || data.period_id) || null,
    employee_id: employeeId,
    payroll_month: payrollMonth,
    employee_name: optionalText(data.employeeName || data.employee_name) || existing?.employee_name || null,
    job_title: optionalText(data.jobTitle || data.job_title) || existing?.job_title || null,
    base_salary_halalas: intMoney(data.baseSalaryHalalas ?? data.base_salary_halalas),
    allowances_halalas: intMoney(data.allowancesHalalas ?? data.allowances_halalas),
    work_days: optionalNumber(data.workDays ?? data.work_days),
    monthly_hours: optionalNumber(data.monthlyHours ?? data.monthly_hours),
    daily_rate_halalas: intMoney(data.dailyRateHalalas ?? data.daily_rate_halalas),
    hourly_rate_halalas: intMoney(data.hourlyRateHalalas ?? data.hourly_rate_halalas),
    absence_days: Number(data.absenceDays ?? data.absence_days ?? 0) || 0,
    absence_deduction_halalas: intMoney(data.absenceDeductionHalalas ?? data.absence_deduction_halalas),
    expected_work_hours: data.expectedWorkHours ?? data.expected_work_hours ?? null,
    actual_worked_hours: data.actualWorkedHours ?? data.actual_worked_hours ?? null,
    missing_hours: data.missingHours ?? data.missing_hours ?? null,
    overtime_hours: data.overtimeHours ?? data.overtime_hours ?? null,
    attendance_summary_json: jsonText(data.attendanceSummary ?? data.attendance_summary, null),
    detected_extra_hours: numberValue(data.detectedExtraHours ?? data.detected_extra_hours, 0),
    overtime_enabled: overtimeEnabled,
    financial_overtime_hours: numberValue(data.financialOvertimeHours ?? data.financial_overtime_hours, 0),
    overtime_multiplier: numberValue(data.overtimeMultiplier ?? data.overtime_multiplier, 1.5),
    overtime_value_halalas: intMoney(data.overtimeValueHalalas ?? data.overtime_value_halalas),
    overtime_bonus_halalas: intMoney(data.overtimeBonusHalalas ?? data.overtime_bonus_halalas),
    delay_deduction_halalas: intMoney(data.delayDeductionHalalas ?? data.delay_deduction_halalas),
    insurance_deduction_halalas: intMoney(data.insuranceDeductionHalalas ?? data.insurance_deduction_halalas),
    gosi_insurance_category: optionalText(
      data.gosiInsuranceCategory ?? data.gosi_insurance_category
    ) || null,
    gosi_policy_version: optionalText(
      data.gosiPolicyVersion ?? data.gosi_policy_version
    ) || null,
    gosi_contributory_wage_halalas: intMoney(
      data.gosiContributoryWageHalalas ??
        data.gosi_contributory_wage_halalas
    ),
    employer_gosi_contribution_halalas: intMoney(
      data.employerGosiContributionHalalas ??
        data.employer_gosi_contribution_halalas
    ),
    gosi_snapshot_json:
      data.gosiSnapshot || data.gosi_snapshot
        ? JSON.stringify(data.gosiSnapshot ?? data.gosi_snapshot)
        : null,
    gosi_calculated_at: optionalText(
      data.gosiCalculatedAt ?? data.gosi_calculated_at
    ) || (data.gosiSnapshot || data.gosi_snapshot ? now : null),
    other_deductions_halalas: intMoney(data.otherDeductionsHalalas ?? data.other_deductions_halalas),
    missing_hours_deduction_halalas: intMoney(data.missingHoursDeductionHalalas ?? data.missing_hours_deduction_halalas),
    additions_json: jsonText(data.additions ?? data.additions_json, []),
    manual_additions_halalas: intMoney(data.manualAdditionsHalalas ?? data.manual_additions_halalas),
    manual_deductions_halalas: intMoney(data.manualDeductionsHalalas ?? data.manual_deductions_halalas),
    advances_halalas: intMoney(data.advancesHalalas ?? data.advances_halalas),
    total_deductions_halalas: intMoney(data.totalDeductionsHalalas ?? data.total_deductions_halalas),
    gross_salary_halalas: intMoney(data.grossSalaryHalalas ?? data.gross_salary_halalas),
    final_salary_halalas: intMoney(data.finalSalaryHalalas ?? data.final_salary_halalas),
    net_salary_halalas: intMoney(data.netSalaryHalalas ?? data.net_salary_halalas ?? data.finalSalaryHalalas ?? data.final_salary_halalas),
    schedule_snapshot_json: JSON.stringify(data.scheduleSnapshot ?? data.schedule_snapshot ?? null),
    absence_entries_json: JSON.stringify(data.absenceEntries ?? data.absence_entries ?? []),
    deductions_json: JSON.stringify(data.deductions ?? data.salaryDeductions ?? []),
    mudad_file_id: optionalText(data.mudadFileId || data.mudad_file_id) || null,
    status,
    approved_at: data.approvedAt === undefined ? existing?.approved_at || null : optionalText(data.approvedAt) || null,
    approved_by_uid: data.approvedByUid === undefined ? existing?.approved_by_uid || null : optionalText(data.approvedByUid) || null,
    paid_at: data.paidAt === undefined ? existing?.paid_at || null : optionalText(data.paidAt) || null,
    paid_by_uid: data.paidByUid === undefined ? existing?.paid_by_uid || null : optionalText(data.paidByUid) || null,
    notes: optionalText(data.notes) || existing?.notes || null,
    audit_log_json: data.auditLog ? jsonText(data.auditLog, []) : auditLog,
    created_by_uid: existing?.created_by_uid || optionalText(actor.uid) || null,
    created_by_email: existing?.created_by_email || optionalText(actor.email) || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (['approved', 'paid'].includes(status)) {
    await assertPayrollApprovalReady(
      db,
      salonId,
      row,
      {
        validateCanonicalPolicy: true,
      }
    );
  }
  if (options.previewOnly === true) {
    return { ...row, preview: true };
  }

  const payrollMutation = buildPayrollEntryMutationStatement(row);
  await dbRun(db, payrollMutation.sql, payrollMutation.params);
  const saved = await dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1', [salonId, employeeId, payrollMonth]);
  if (saved?.id) {
    await dbRun(
      db,
      `UPDATE salary_advance_installments
          SET payroll_entry_id = ?, updated_at = ?
        WHERE salon_id = ?
          AND payroll_month = ?
          AND status = 'scheduled'
          AND advance_id IN (
            SELECT id
              FROM salary_advances
             WHERE salon_id = ?
               AND employee_id = ?
          )`,
      [saved.id, nowIso(), salonId, payrollMonth, salonId, employeeId]
    );
  }

  if (targetBonus?.targetSummary?.id && saved?.id) {
    await dbRun(
      db,
      `UPDATE employee_target_period_summaries
          SET payroll_entry_id = ?, status = CASE WHEN status = 'open' THEN 'posted_to_payroll' ELSE status END,
              updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [saved.id, nowIso(), salonId, targetBonus.targetSummary.id]
    ).catch((error) => {
      if (!targetSchemaUnavailable(error)) throw error;
    });
  }
  return saved;
}

export async function previewPayrollEntry(db, salonId, data, actor = {}, options = {}) {
  return upsertPayrollEntry(db, salonId, {
    ...data,
    skipTargetBonus: true,
  }, actor, {
    ...options,
    previewOnly: true,
  });
}

export async function updatePayrollEntryAdjustments(db, salonId, id, data, actor = {}, options = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (lockedStatus(existing.status)) throw new AppError(409, 'core_payroll:locked_entry');
  return upsertPayrollEntry(db, salonId, {
    ...data,
    id: existing.id,
    employeeId: existing.employee_id,
    payrollMonth: existing.payroll_month,
    periodId: existing.period_id,
    status: existing.status || 'draft',
    auditLog: parseJsonArray(existing.audit_log_json).concat({
      action: 'adjusted',
      byUid: optionalText(actor.uid) || null,
      byEmail: optionalText(actor.email) || null,
      at: nowIso(),
    }),
  }, actor, options);
}

export async function togglePayrollOvertime(db, salonId, id, data, actor = {}, options = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (lockedStatus(existing.status)) throw new AppError(409, 'core_payroll:locked_entry');
  // Overtime eligibility and multiplier are canonical employee-employment policy.
  // A payroll-entry toggle would create a second source of truth, so the legacy
  // endpoint fails closed instead of pretending a browser flag is authoritative.
  throw new AppError(409, 'core_payroll:overtime_policy_managed_on_employment');
}

export async function approvePayrollEntry(db, salonId, id, actor = {}, options = {}) {
  let existing = await getPayrollEntry(db, salonId, id);
  if (cleanText(existing.status) === 'paid') throw new AppError(409, 'core_payroll:already_paid');
  if (cleanText(existing.status) === 'approved') return existing;

  // Approval is a hard authority boundary: refresh every derived financial and
  // attendance field from canonical Core D1 immediately before locking. Browser
  // snapshots are never sufficient evidence for approval.
  existing = await upsertPayrollEntry(db, salonId, {
    ...existing,
    id: existing.id,
    employeeId: existing.employee_id,
    employeeName: existing.employee_name,
    payrollMonth: existing.payroll_month,
    periodId: existing.period_id,
    status: existing.status || 'draft',
    additions: parseJsonArray(existing.additions_json),
    deductions: parseJsonArray(existing.deductions_json),
    notes: existing.notes,
    auditLog: parseJsonArray(existing.audit_log_json).concat({
      action: 'canonical_recalculation_before_approval',
      byUid: optionalText(actor.uid) || null,
      byEmail: optionalText(actor.email) || null,
      at: nowIso(),
    }),
  }, actor, options);

  await assertPayrollApprovalReady(
    db,
    salonId,
    existing,
    {
      validateCanonicalPolicy: true,
    }
  );
  await assertPayrollObligationSnapshotCurrent(db, salonId, existing);
  const now = nowIso();
  try {
    await approveEmployeeTargetSummary(db, salonId, {
      employeeId: existing.employee_id,
      payrollMonth: existing.payroll_month,
      periodId: existing.period_id,
    }, actor, existing.id);
  } catch (error) {
    if (!targetSchemaUnavailable(error)) throw error;
  }

  const snapshotStatement = await buildApprovalSnapshotStatement(db, salonId, existing, actor, now);
  const statements = [
    { sql: snapshotStatement.sql, params: snapshotStatement.params },
    {
      sql: `UPDATE payroll_entries
         SET status = 'approved', approved_at = COALESCE(approved_at, ?),
             approved_by_uid = COALESCE(approved_by_uid, ?), audit_log_json = ?, updated_at = ?
       WHERE salon_id = ? AND id = ?`,
      params: [now, optionalText(actor.uid) || null, appendAudit(existing, 'approved', actor), now, salonId, existing.id],
    },
  ];

  for (const carryoverId of carryoverSourceIds(existing)) {
    statements.push({
      sql: `UPDATE payroll_carryover_adjustments
               SET status = 'applied', target_payroll_entry_id = ?, applied_at = ?, updated_at = ?
             WHERE salon_id = ?
               AND id = ?
               AND target_payroll_month = ?
               AND status = 'pending'`,
      params: [existing.id, now, now, salonId, carryoverId, existing.payroll_month],
    });
  }

  await dbBatch(db, statements);
  return getPayrollEntry(db, salonId, existing.id);
}

export async function reopenPayrollEntry(db, salonId, id, data = {}, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  const currentStatus = cleanText(existing.status || 'draft');
  if (currentStatus === 'paid') throw new AppError(409, 'core_payroll:paid_reopen_not_allowed');
  if (currentStatus !== 'approved') throw new AppError(409, 'core_payroll:not_approved');

  const nextStatus = cleanStatus(data.status || data.nextStatus || data.next_status || 'draft');
  if (!['draft', 'reviewed'].includes(nextStatus)) {
    throw new AppError(400, 'core_payroll:invalid_reopen_status');
  }

  const now = nowIso();
  const reason = optionalText(data.reason) || 'recalculate_approved_payroll';
  await dbRun(
    db,
    `UPDATE payroll_entries
       SET status = ?, approved_at = NULL, approved_by_uid = NULL,
           audit_log_json = ?, updated_at = ?
     WHERE salon_id = ? AND id = ?`,
    [
      nextStatus,
      appendAuditEntry(existing, {
        action: 'reopened',
        byUid: optionalText(actor.uid) || null,
        byEmail: optionalText(actor.email) || null,
        at: now,
        reason,
        previousStatus: currentStatus,
        previousApprovedAt: existing.approved_at || null,
        previousApprovedByUid: existing.approved_by_uid || null,
      }),
      now,
      salonId,
      existing.id,
    ]
  );
  return getPayrollEntry(db, salonId, existing.id);
}

export async function markPayrollEntryPaid(db, salonId, id, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (cleanText(existing.status) === 'paid') return existing;
  if (cleanText(existing.status) !== 'approved') throw new AppError(409, 'core_payroll:not_approved');
  await assertPayrollApprovalReady(
    db,
    salonId,
    existing,
    {
      validateCanonicalPolicy: false,
    }
  );
  await ensureApprovalSnapshotExists(db, salonId, existing, actor);
  const now = nowIso();
  const installments = await dbAll(
    db,
    `SELECT sai.advance_id, COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sa.employee_id = ?
        AND sai.payroll_month = ?
        AND sai.status = 'scheduled'
      GROUP BY sai.advance_id`,
    [salonId, existing.employee_id, existing.payroll_month]
  );
  const scheduledAdvanceHalalas = installments.reduce(
    (total, installment) => total + Math.max(0, Number(installment.amount_halalas || 0)),
    0
  );
  if (scheduledAdvanceHalalas !== Math.max(0, Number(existing.advances_halalas || 0))) {
    throw new AppError(409, 'core_payroll:advance_deduction_mismatch');
  }

  const obligationStatements = await payrollObligationPaidStatements(
    db,
    salonId,
    existing,
    now
  );

  const statements = [
    {
      sql: `UPDATE payroll_entries
               SET status = 'paid',
                   approved_at = COALESCE(approved_at, ?),
                   approved_by_uid = COALESCE(approved_by_uid, ?),
                   paid_at = COALESCE(paid_at, ?),
                   paid_by_uid = COALESCE(paid_by_uid, ?),
                   audit_log_json = ?,
                   updated_at = ?
             WHERE salon_id = ?
               AND id = ?
               AND status = 'approved'`,
      params: [
        now,
        optionalText(actor.uid) || null,
        now,
        optionalText(actor.uid) || null,
        appendAudit(existing, 'paid', actor),
        now,
        salonId,
        existing.id,
      ],
    },
  ];

  for (const installment of installments) {
    const amount = Math.max(0, Number(installment.amount_halalas || 0));
    statements.push(
      {
        sql: `UPDATE salary_advances
                 SET paid_halalas = MIN(approved_halalas, paid_halalas + ?),
                     remaining_halalas = MAX(0, remaining_halalas - ?),
                     payment_status = CASE
                       WHEN remaining_halalas <= ? THEN 'repaid'
                       ELSE 'partially_repaid'
                     END,
                     updated_at = ?
               WHERE salon_id = ?
                 AND id = ?
                 AND EXISTS (
                   SELECT 1
                     FROM salary_advance_installments
                    WHERE salon_id = ?
                      AND advance_id = ?
                      AND payroll_month = ?
                      AND status = 'scheduled'
                 )`,
        params: [
          amount,
          amount,
          amount,
          now,
          salonId,
          installment.advance_id,
          salonId,
          installment.advance_id,
          existing.payroll_month,
        ],
      },
      {
        sql: `UPDATE salary_advance_installments
                 SET status = 'deducted',
                     payroll_entry_id = ?,
                     deducted_at = ?,
                     updated_at = ?
               WHERE salon_id = ?
                 AND advance_id = ?
                 AND payroll_month = ?
                 AND status = 'scheduled'`,
        params: [
          existing.id,
          now,
          now,
          salonId,
          installment.advance_id,
          existing.payroll_month,
        ],
      }
    );
  }

  statements.push(...obligationStatements);
  await dbBatch(db, statements);
  return getPayrollEntry(db, salonId, existing.id);
}
