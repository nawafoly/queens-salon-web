import { CoreHrService } from "./CoreHrService";
import type {
  CoreAbsence,
  CoreAttendanceRecord,
  CoreHrEmployee,
  CoreHrSchedule,
  CoreLeave,
  CorePayrollEntry,
  CorePayrollPeriod,
} from "../types/hrCoreApi";
import {
  calculateAttendanceDisciplineDay,
  summarizeAttendanceDisciplineMonth,
  type AttendanceDisciplineDaySummary,
} from "../helpers/hr/attendanceDiscipline";
import {
  ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE,
  calculatePayrollSnapshot,
  evaluatePayrollSetup,
  isPayrollSnapshotLocked,
  preserveLockedPayrollSnapshot,
  type PayrollAttendanceSummarySnapshot,
  type PayrollMonthlyHoursSource,
  type PayrollSetupMissingKey,
  type PayrollManualItem,
  type PayrollSnapshot,
  type PayrollStatus,
} from "../helpers/hr/payrollCalculations";

const DEFAULT_SHIFT_START = "10:00";
const DEFAULT_SHIFT_END = "22:00";
const DAY_MS = 24 * 60 * 60 * 1000;

export type PayrollEntryView = PayrollSnapshot & {
  id?: string;
  periodId?: string | null;
  saved: boolean;
  absenceEntries?: PayrollAbsenceEntry[];
  approvedAt?: string | null;
  paidAt?: string | null;
  auditLog?: Array<Record<string, unknown>>;
};

export type PayrollAbsenceEntry = {
  id: string;
  dateKey: string;
  absenceType: string;
  days: number;
  note?: string | null;
};

export type PayrollMonthLoadResult = {
  period: CorePayrollPeriod | null;
  entries: PayrollEntryView[];
  generatedAt: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function payrollMonthKey(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

const PAYROLL_CYCLE_START_DAY = 21;
const PAYROLL_CYCLE_END_DAY = 20;
const PAYROLL_PAY_DAY = 28;

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function payrollMonthBounds(year: number, month: number) {
  const cycleStartDate = new Date(Date.UTC(year, month - 2, PAYROLL_CYCLE_START_DAY));
  const cycleEndDate = new Date(Date.UTC(year, month - 1, PAYROLL_CYCLE_END_DAY));
  const safePayDay = Math.min(PAYROLL_PAY_DAY, daysInUtcMonth(year, month));
  const payDate = new Date(Date.UTC(year, month - 1, safePayDay));
  return {
    payrollMonth: payrollMonthKey(year, month),
    monthStart: dateKeyFromUtcDate(cycleStartDate),
    monthEnd: dateKeyFromUtcDate(cycleEndDate),
    payDate: dateKeyFromUtcDate(payDate),
  };
}

function dateKeysInRange(startDateKey: string, endDateKey: string) {
  const dates: string[] = [];
  let cursor = jsDateFromKey(startDateKey);
  const end = jsDateFromKey(endDateKey);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(dateKeyFromUtcDate(cursor));
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

function dateKeysInPayrollCycle(year: number, month: number) {
  const bounds = payrollMonthBounds(year, month);
  return dateKeysInRange(bounds.monthStart, bounds.monthEnd);
}

function isDateKeyInRange(dateKey: string, startDateKey: string, endDateKey: string) {
  return dateKey >= startDateKey && dateKey <= endDateKey;
}

function jsDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function parseTimeMinutes(value?: string | null) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function hoursBetween(start?: string | null, end?: string | null) {
  const startMinutes = parseTimeMinutes(start);
  let endMinutes = parseTimeMinutes(end);
  if (startMinutes == null || endMinutes == null) return 0;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return Math.max(0, Math.round(((endMinutes - startMinutes) / 60) * 100) / 100);
}

function readJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown) {
  return String(value || "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function dayValue(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function boolValue(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function isPayrollSetupMissingKey(value: string): value is PayrollSetupMissingKey {
  return ["employeeId", "baseSalary", "workDays", "monthlyHours"].includes(value);
}

function asMonthlyHoursSource(value: string): PayrollMonthlyHoursSource | null {
  return ["configured_monthly_hours", "configured_daily_hours", "saved_snapshot", "missing"].includes(value)
    ? (value as PayrollMonthlyHoursSource)
    : null;
}

function employmentOf(employee: CoreHrEmployee) {
  return (employee.employment || {}) as Record<string, unknown>;
}

function uniqueTextKeys(values: unknown[]) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const WEEKDAY_KEY_BY_UTC_DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weeklyOffDays(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return new Set(
    readStringList(
      employment.weekly_off_days_json ??
        employment.weeklyOffDaysJson ??
        employment.weekly_off_days ??
        employment.weeklyOffDays
    ).map((item) => item.toLowerCase())
  );
}

export function resolvePayrollAttendanceIdentity(employee: CoreHrEmployee | Record<string, unknown>) {
  const raw = employee as CoreHrEmployee & Record<string, unknown>;
  const employment =
    raw.employment && typeof raw.employment === "object"
      ? (raw.employment as Record<string, unknown>)
      : {};
  const keys = uniqueTextKeys([
    raw.id,
    raw.employeeId,
    raw.firebaseUid,
    raw.uid,
    raw.authUid,
    raw.linkedStaffId,
    employment.employee_id,
    employment.employeeId,
    employment.firebase_uid,
    employment.firebaseUid,
    employment.uid,
    employment.authUid,
    employment.linkedStaffId,
    employment.employee_code,
    employment.employeeCode,
    employment.fingerprint_number,
    employment.fingerprintNumber,
  ]);
  return {
    keys,
    employeeId: text(raw.id || raw.employeeId || employment.employee_id || employment.employeeId) || null,
    firebaseUid: text(raw.firebaseUid || raw.uid || raw.authUid || employment.firebase_uid || employment.firebaseUid) || null,
    linkedStaffId: text(raw.linkedStaffId || employment.linkedStaffId) || null,
  };
}

function employeeAttendanceKeys(employee: CoreHrEmployee) {
  return resolvePayrollAttendanceIdentity(employee).keys;
}

function attendanceRecordKeys(record: CoreAttendanceRecord | Record<string, unknown>) {
  const raw = record as CoreAttendanceRecord & Record<string, unknown>;
  return uniqueTextKeys([
    raw.employeeId,
    raw.employeeUid,
    raw.firebaseUid,
    raw.uid,
    raw.employeeDocId,
    raw.employee_id,
    raw.employee_uid,
    raw.firebase_uid,
    raw.employee_doc_id,
  ]);
}

export function doesAttendanceRecordBelongToEmployee(
  record: CoreAttendanceRecord | Record<string, unknown>,
  employee: CoreHrEmployee | Record<string, unknown>
) {
  const employeeKeys = new Set(resolvePayrollAttendanceIdentity(employee).keys);
  return attendanceRecordKeys(record).some((key) => employeeKeys.has(key));
}

function leaveMatchesEmployee(leave: CoreLeave, employee: CoreHrEmployee) {
  return doesAttendanceRecordBelongToEmployee(
    {
      employeeId: leave.employeeId,
      employeeUid: leave.employeeUid,
    },
    employee
  );
}

function absenceMatchesEmployee(absence: CoreAbsence, employee: CoreHrEmployee) {
  return doesAttendanceRecordBelongToEmployee(
    {
      employeeId: absence.employeeId,
      employeeUid: absence.employeeUid,
    },
    employee
  );
}

function dateSetForApprovedLeaves(leaves: CoreLeave[], employee: CoreHrEmployee, startDate: string, endDate: string) {
  const dates = new Set<string>();
  for (const leave of leaves) {
    if (text(leave.status).toLowerCase() !== "approved") continue;
    if (!leaveMatchesEmployee(leave, employee)) continue;
    const from = leave.startDate > startDate ? leave.startDate : startDate;
    const to = leave.endDate < endDate ? leave.endDate : endDate;
    if (!from || !to || from > to) continue;
    dateKeysInRange(from, to).forEach((date) => dates.add(date));
  }
  return dates;
}

function dateSetForAbsences(absences: CoreAbsence[], employee: CoreHrEmployee, startDate: string, endDate: string) {
  const dates = new Set<string>();
  for (const absence of absences) {
    if (!absenceMatchesEmployee(absence, employee)) continue;
    const date = text(absence.dateKey);
    if (date && date >= startDate && date <= endDate) dates.add(date);
  }
  return dates;
}

function emptyAttendanceSummary(
  status: "unlinked" | "not_ready",
  notes: string[] = [ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE]
): PayrollAttendanceSummarySnapshot {
  return {
    totalScheduledHours: 0,
    totalActualWorkedHours: 0,
    totalLateHours: 0,
    totalEarlyLeaveHours: 0,
    totalCompensatedLateHours: 0,
    totalMissingHours: 0,
    totalExtraHours: 0,
    attendanceDays: 0,
    absentDays: 0,
    incompleteDays: 0,
    approvedLeaveDays: 0,
    approvedAbsenceDays: 0,
    attendanceRecordCount: 0,
    attendanceLinkStatus: status,
    attendanceDeductionEligible: false,
    attendanceDeductionNote: ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE,
    attendanceNotes: notes,
  };
}

/*
function employeeAttendanceKeys(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return uniqueTextKeys([
    employee.id,
    employee.firebaseUid,
    employment.employee_id,
    employment.employeeId,
    employment.firebase_uid,
    employment.firebaseUid,
    employment.employee_code,
    employment.employeeCode,
    employment.fingerprint_number,
    employment.fingerprintNumber,
  ]);
}

function attendanceRecordKeys(record: CoreAttendanceRecord) {
  return uniqueTextKeys([record.employeeId, record.employeeUid]);
}

function attendanceRecordMatchesEmployee(record: CoreAttendanceRecord, employee: CoreHrEmployee) {
  const employeeKeys = new Set(employeeAttendanceKeys(employee));
  return attendanceRecordKeys(record).some((key) => employeeKeys.has(key));
}
*/

function attendanceRecordMatchesEmployee(record: CoreAttendanceRecord, employee: CoreHrEmployee) {
  return doesAttendanceRecordBelongToEmployee(record, employee);
}

function attendanceMetadata(recordCount: number) {
  if (recordCount > 0) {
    return {
      attendanceRecordCount: recordCount,
      attendanceLinkStatus: "confirmed" as const,
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
    };
  }
  return {
    attendanceRecordCount: 0,
    attendanceLinkStatus: "unlinked" as const,
    attendanceDeductionEligible: false,
    attendanceDeductionNote: ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE,
  };
}

function normalizeAttendanceSummaryMetadata(summary: PayrollAttendanceSummarySnapshot) {
  const recordCount = Math.max(0, Math.round(Number(summary.attendanceRecordCount || 0)));
  if (typeof summary.attendanceDeductionEligible === "boolean") {
    return {
      ...summary,
      attendanceRecordCount: recordCount,
      attendanceLinkStatus:
        summary.attendanceLinkStatus || (summary.attendanceDeductionEligible ? "confirmed" : "unlinked"),
      attendanceDeductionNote:
        summary.attendanceDeductionEligible === false
          ? summary.attendanceDeductionNote || ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE
          : summary.attendanceDeductionNote || null,
    };
  }

  const looksUnlinked =
    recordCount === 0 &&
    numberValue(summary.totalActualWorkedHours) <= 0 &&
    numberValue(summary.attendanceDays) <= 0 &&
    numberValue(summary.totalMissingHours) > 0;
  return {
    ...summary,
    attendanceRecordCount: recordCount,
    attendanceLinkStatus: looksUnlinked ? ("not_ready" as const) : ("confirmed" as const),
    attendanceDeductionEligible: !looksUnlinked,
    attendanceDeductionNote: looksUnlinked ? ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE : summary.attendanceDeductionNote || null,
  };
}

function employeeBaseSalary(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return positiveNumber(employment.base_salary_halalas ?? employment.baseSalaryHalalas);
}

function employeeAllowances(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return (
    numberValue(employment.housing_allowance_halalas ?? employment.housingAllowanceHalalas) +
    numberValue(employment.transportation_allowance_halalas ?? employment.transportationAllowanceHalalas) +
    numberValue(employment.other_allowances_halalas ?? employment.otherAllowancesHalalas)
  );
}

function employeeJobTitle(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return text(employment.job_title ?? employment.jobTitle ?? employment.title) || null;
}

function employeeWorkDays(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return positiveNumber(employment.expected_work_days ?? employment.expectedWorkDays);
}

function employeeMonthlyHours(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return positiveNumber(employment.expected_work_hours ?? employment.expectedWorkHours);
}

function explicitDailyScheduledHoursForMonth(employee: CoreHrEmployee, year: number, month: number) {
  const employment = employmentOf(employee);
  const configuredDailyHours = positiveNumber(
    employment.daily_scheduled_hours ??
      employment.dailyScheduledHours ??
      employment.expected_daily_hours ??
      employment.expectedDailyHours
  );
  if (configuredDailyHours > 0) return configuredDailyHours;

  const explicitSchedules = (employee.schedules || []).filter((schedule) => {
    if (schedule.active === false || Number((schedule as any).active) === 0) return false;
    const sampleDate = dateKeysInPayrollCycle(year, month).find((date) => jsDateFromKey(date).getUTCDay() === Number(schedule.weekday));
    if (!sampleDate) return false;
    if (schedule.effectiveFrom && schedule.effectiveFrom > sampleDate) return false;
    if (schedule.effectiveTo && schedule.effectiveTo < sampleDate) return false;
    return true;
  });
  if (explicitSchedules.length) {
    const total = explicitSchedules.reduce(
      (sum, schedule) => sum + hoursBetween(schedule.startTime, schedule.endTime),
      0
    );
    return Math.round((total / explicitSchedules.length) * 100) / 100;
  }

  const shiftStart = text(employment.shift_start_time ?? employment.shiftStartTime);
  const shiftEnd = text(employment.shift_end_time ?? employment.shiftEndTime);
  if (shiftStart && shiftEnd) return hoursBetween(shiftStart, shiftEnd);
  return 0;
}

function employeeOvertimeMultiplier(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return positiveNumber(employment.overtime_multiplier ?? employment.overtimeMultiplier) || 1.5;
}

function employeePayrollOvertimeEnabled(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  return boolValue(
    employment.overtime_enabled ??
      employment.overtimeEnabled ??
      employment.payroll_overtime_enabled ??
      employment.payrollOvertimeEnabled
  );
}

function scheduleForDate(employee: CoreHrEmployee, dateKey: string) {
  const weekday = jsDateFromKey(dateKey).getUTCDay();
  const offDays = weeklyOffDays(employee);
  const schedules = (employee.schedules || []).filter((schedule) => {
    if (schedule.active === false || Number((schedule as any).active) === 0) return false;
    if (Number(schedule.weekday) !== weekday) return false;
    if (schedule.effectiveFrom && schedule.effectiveFrom > dateKey) return false;
    if (schedule.effectiveTo && schedule.effectiveTo < dateKey) return false;
    return true;
  });

  if ((employee.schedules || []).length > 0) {
    const schedule = schedules[0];
    return schedule
      ? {
          enabled: true,
          start: schedule.startTime || DEFAULT_SHIFT_START,
          end: schedule.endTime || DEFAULT_SHIFT_END,
        }
      : { enabled: false, start: null, end: null };
  }

  const employment = employmentOf(employee);
  if (offDays.has(WEEKDAY_KEY_BY_UTC_DAY[weekday]) || offDays.has(String(weekday))) {
    return { enabled: false, start: null, end: null };
  }
  return {
    enabled: true,
    start: text(employment.shift_start_time ?? employment.shiftStartTime) || DEFAULT_SHIFT_START,
    end: text(employment.shift_end_time ?? employment.shiftEndTime) || DEFAULT_SHIFT_END,
  };
}

export function buildPayrollAttendanceSummaryForEmployee(input: {
  employee: CoreHrEmployee;
  records: CoreAttendanceRecord[];
  leaves?: CoreLeave[];
  absences?: CoreAbsence[];
  year: number;
  month: number;
}) {
  const days: AttendanceDisciplineDaySummary[] = [];
  const bounds = payrollMonthBounds(input.year, input.month);
  const dates = dateKeysInPayrollCycle(input.year, input.month);
  const recordsByDate = new Map<string, CoreAttendanceRecord[]>();
  const periodRecords = input.records.filter((record) =>
    isDateKeyInRange(record.dateKey, bounds.monthStart, bounds.monthEnd)
  );
  const approvedLeaveDates = dateSetForApprovedLeaves(
    input.leaves || [],
    input.employee,
    bounds.monthStart,
    bounds.monthEnd
  );
  const approvedAbsenceDates = dateSetForAbsences(
    input.absences || [],
    input.employee,
    bounds.monthStart,
    bounds.monthEnd
  );
  if (!periodRecords.length) {
    const identity = resolvePayrollAttendanceIdentity(input.employee);
    return {
      days,
      summary: {
        ...emptyAttendanceSummary(
        identity.keys.length ? "not_ready" : "unlinked",
        identity.keys.length
          ? ["لا توجد بصمات مطابقة داخل فترة الراتب، لذلك لم يتم احتساب غياب أو خصم حضور تلقائي."]
          : ["لا توجد مفاتيح كافية لربط الموظفة بسجلات البصمة."]
        ),
        approvedLeaveDays: approvedLeaveDates.size,
        approvedAbsenceDays: approvedAbsenceDates.size,
      },
    };
  }

  for (const record of periodRecords) {
    const list = recordsByDate.get(record.dateKey) || [];
    list.push(record);
    recordsByDate.set(record.dateKey, list);
  }

  for (const date of dates) {
    const schedule = scheduleForDate(input.employee, date);
    const records = [...(recordsByDate.get(date) || [])].sort(
      (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
    );
    if (!schedule.enabled && !records.length) continue;
    const firstCheckIn = records.find((record) => record.recordType === "check_in");
    const lastCheckOut = [...records].reverse().find((record) => record.recordType === "check_out");
    days.push(
      calculateAttendanceDisciplineDay({
        date,
        scheduledStart: schedule.start,
        scheduledEnd: schedule.end,
        isScheduledWorkDay: schedule.enabled,
        isApprovedLeave: approvedLeaveDates.has(date) || approvedAbsenceDates.has(date),
        checkInAt: firstCheckIn?.recordedAt,
        checkOutAt: lastCheckOut?.recordedAt,
        isAbsent:
          schedule.enabled &&
          !records.length &&
          !approvedLeaveDates.has(date) &&
          !approvedAbsenceDates.has(date),
      })
    );
  }

  return {
    days,
    summary: {
      ...(summarizeAttendanceDisciplineMonth(days) as PayrollAttendanceSummarySnapshot),
      approvedLeaveDays: approvedLeaveDates.size,
      approvedAbsenceDays: approvedAbsenceDates.size,
      attendanceNotes: [
        ...(approvedLeaveDates.size ? [`${approvedLeaveDates.size} أيام إجازة معتمدة لم تدخل في خصم الحضور.`] : []),
        ...(approvedAbsenceDates.size ? [`${approvedAbsenceDates.size} أيام غياب/استثناء معتمد لم تدخل في خصم الحضور.`] : []),
        ...(days.some((day) => day.status === "incomplete") ? ["توجد أيام ببصمة خروج ناقصة؛ لم تخصم كيوم كامل تلقائيا."] : []),
      ],
      ...attendanceMetadata(periodRecords.length),
    },
  };
}

function snapshotFromEmployee(input: {
  employee: CoreHrEmployee;
  attendanceSummary: PayrollAttendanceSummarySnapshot;
  year: number;
  month: number;
  existing?: PayrollEntryView;
}) {
  const workDays = employeeWorkDays(input.employee);
  const monthlyHours = employeeMonthlyHours(input.employee);
  const dailyScheduledHours = explicitDailyScheduledHoursForMonth(
    input.employee,
    input.year,
    input.month
  );
  const monthlyHoursSource: PayrollMonthlyHoursSource =
    monthlyHours > 0
      ? "configured_monthly_hours"
      : dailyScheduledHours > 0
        ? "configured_daily_hours"
        : "missing";
  const next = calculatePayrollSnapshot({
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    jobTitle: employeeJobTitle(input.employee),
    payrollMonth: payrollMonthKey(input.year, input.month),
    baseSalaryHalalas: employeeBaseSalary(input.employee),
    allowancesHalalas: employeeAllowances(input.employee),
    workDays,
    monthlyHours,
    dailyScheduledHours,
    attendanceSummary: input.attendanceSummary,
    additions: input.existing?.additions || [],
    deductions: input.existing?.deductions || [],
    overtimeEnabled: employeePayrollOvertimeEnabled(input.employee),
    overtimeMultiplier: employeeOvertimeMultiplier(input.employee),
    monthlyHoursSource,
    status: (input.existing?.status as PayrollStatus | undefined) || "draft",
    notes: input.existing?.notes || null,
  });
  return preserveLockedPayrollSnapshot(input.existing, {
    ...next,
    id: input.existing?.id,
    periodId: input.existing?.periodId,
    saved: Boolean(input.existing?.saved),
    approvedAt: input.existing?.approvedAt,
    paidAt: input.existing?.paidAt,
    auditLog: input.existing?.auditLog || [],
  }) as PayrollEntryView;
}

export function rebuildPayrollEntryFromEmployeeSettings(input: {
  entry: PayrollEntryView;
  employee: CoreHrEmployee;
  year: number;
  month: number;
}) {
  return snapshotFromEmployee({
    employee: input.employee,
    attendanceSummary: input.entry.attendanceSummary,
    year: input.year,
    month: input.month,
    existing: input.entry,
  });
}

export function normalizePayrollEntry(row: CorePayrollEntry): PayrollEntryView {
  const scheduleSnapshot = readJson<Record<string, unknown> | null>(
    row.scheduleSnapshotJson,
    null
  );
  const scheduleSetupMissing = Array.isArray(scheduleSnapshot?.payrollSetupMissing)
    ? scheduleSnapshot.payrollSetupMissing
        .map((item) => text(item))
        .filter(isPayrollSetupMissingKey)
    : null;
  const scheduleSetupComplete =
    typeof scheduleSnapshot?.payrollSetupComplete === "boolean"
      ? scheduleSnapshot.payrollSetupComplete
      : null;
  const scheduleDailyHours = numberValue(
    scheduleSnapshot?.dailyScheduledHours ?? scheduleSnapshot?.daily_scheduled_hours
  );
  const scheduleMonthlyHoursSource = asMonthlyHoursSource(text(scheduleSnapshot?.monthlyHoursSource));
  const attendanceSummary = normalizeAttendanceSummaryMetadata(readJson<PayrollAttendanceSummarySnapshot>(
    row.attendanceSummaryJson,
    {
      totalScheduledHours: numberValue(row.expectedWorkHours),
      totalActualWorkedHours: numberValue(row.actualWorkedHours),
      totalLateHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: numberValue(row.missingHours),
      totalExtraHours: numberValue(row.detectedExtraHours ?? row.overtimeHours),
      attendanceDays: 0,
      absentDays: numberValue(row.absenceDays),
      incompleteDays: 0,
    }
  ));
  const status = (text(row.status) || "draft") as PayrollStatus;
  const additions = readJson<PayrollManualItem[]>(row.additionsJson, []);
  const deductions = readJson<PayrollManualItem[]>(row.deductionsJson, []);
  const baseSalaryHalalas = numberValue(row.baseSalaryHalalas);
  const workDays = numberValue(row.workDays, 0);
  const monthlyHours = numberValue(row.monthlyHours, 0);
  const dailyScheduledHours = scheduleDailyHours;
  const setup = evaluatePayrollSetup({
    employeeId: row.employeeId,
    baseSalaryHalalas,
    workDays,
    monthlyHours,
    dailyScheduledHours,
    overtimeMultiplier: row.overtimeMultiplier,
    monthlyHoursSource: scheduleMonthlyHoursSource || "saved_snapshot",
  });
  const payrollSetupMissing = scheduleSetupMissing || setup.missing;
  const payrollSetupComplete =
    scheduleSetupComplete === null ? payrollSetupMissing.length === 0 : scheduleSetupComplete;
  const detectedExtraHours = numberValue(row.detectedExtraHours);
  const overtimeEnabled = payrollSetupComplete && detectedExtraHours > 0
    ? boolValue(row.overtimeEnabled)
    : false;
  const financialOvertimeHours = overtimeEnabled ? numberValue(row.financialOvertimeHours) : 0;
  const overtimeValueHalalas = overtimeEnabled
    ? numberValue(row.overtimeValueHalalas ?? row.overtimeBonusHalalas)
    : 0;

  return {
    id: row.id,
    periodId: text(row.periodId) || null,
    saved: true,
    employeeId: row.employeeId,
    employeeName: text(row.employeeName) || row.employeeId,
    jobTitle: text(row.jobTitle) || null,
    payrollMonth: row.payrollMonth,
    baseSalaryHalalas,
    allowancesHalalas: numberValue(row.allowancesHalalas),
    workDays,
    monthlyHours,
    dailyScheduledHours,
    dailyRateHalalas: numberValue(row.dailyRateHalalas),
    hourlyRateHalalas: numberValue(row.hourlyRateHalalas),
    attendanceSummary,
    detectedExtraHours,
    overtimeEnabled,
    financialOvertimeHours,
    overtimeMultiplier: numberValue(row.overtimeMultiplier, 1.5),
    overtimeValueHalalas,
    additions,
    deductions,
    manualAdditionsHalalas: numberValue(row.manualAdditionsHalalas),
    manualDeductionsHalalas: numberValue(row.manualDeductionsHalalas),
    advancesHalalas: numberValue(row.advancesHalalas),
    missingHoursDeductionHalalas: numberValue(row.missingHoursDeductionHalalas),
    grossSalaryHalalas: numberValue(row.grossSalaryHalalas),
    totalAdditionsHalalas:
      numberValue(row.allowancesHalalas) +
      numberValue(row.manualAdditionsHalalas) +
      overtimeValueHalalas,
    totalDeductionsHalalas: numberValue(row.totalDeductionsHalalas),
    netSalaryHalalas: numberValue(row.netSalaryHalalas ?? row.finalSalaryHalalas),
    finalSalaryHalalas: numberValue(row.finalSalaryHalalas),
    payrollSetupComplete,
    payrollSetupMissing,
    monthlyHoursSource: setup.monthlyHoursSource,
    status,
    notes: text(row.notes) || null,
    approvedAt: text(row.approvedAt) || null,
    paidAt: text(row.paidAt) || null,
    auditLog: readJson<Array<Record<string, unknown>>>(row.auditLogJson, []),
  };
}

export function payrollEntryPayload(entry: PayrollEntryView) {
  return {
    id: entry.id,
    periodId: entry.periodId,
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    jobTitle: entry.jobTitle,
    payrollMonth: entry.payrollMonth,
    baseSalaryHalalas: entry.baseSalaryHalalas,
    allowancesHalalas: entry.allowancesHalalas,
    workDays: entry.workDays,
    monthlyHours: entry.monthlyHours,
    dailyRateHalalas: entry.dailyRateHalalas,
    hourlyRateHalalas: entry.hourlyRateHalalas,
    absenceDays: entry.attendanceSummary.absentDays,
    absenceDeductionHalalas: 0,
    expectedWorkHours: entry.attendanceSummary.totalScheduledHours,
    actualWorkedHours: entry.attendanceSummary.totalActualWorkedHours,
    missingHours: entry.attendanceSummary.totalMissingHours,
    overtimeHours: entry.financialOvertimeHours,
    attendanceSummary: entry.attendanceSummary,
    detectedExtraHours: entry.detectedExtraHours,
    overtimeEnabled: entry.overtimeEnabled,
    financialOvertimeHours: entry.financialOvertimeHours,
    overtimeMultiplier: entry.overtimeMultiplier,
    overtimeValueHalalas: entry.overtimeValueHalalas,
    overtimeBonusHalalas: entry.overtimeValueHalalas,
    delayDeductionHalalas: 0,
    insuranceDeductionHalalas: 0,
    otherDeductionsHalalas: entry.manualDeductionsHalalas,
    missingHoursDeductionHalalas: entry.missingHoursDeductionHalalas,
    additions: entry.additions,
    deductions: entry.deductions,
    manualAdditionsHalalas: entry.manualAdditionsHalalas,
    manualDeductionsHalalas: entry.manualDeductionsHalalas,
    advancesHalalas: entry.advancesHalalas,
    totalDeductionsHalalas: entry.totalDeductionsHalalas,
    grossSalaryHalalas: entry.grossSalaryHalalas,
    finalSalaryHalalas: entry.finalSalaryHalalas,
    netSalaryHalalas: entry.netSalaryHalalas,
    scheduleSnapshot: {
      workDays: entry.workDays,
      monthlyHours: entry.monthlyHours,
      dailyScheduledHours: entry.dailyScheduledHours,
      payrollSetupComplete: entry.payrollSetupComplete,
      payrollSetupMissing: entry.payrollSetupMissing,
      monthlyHoursSource: entry.monthlyHoursSource,
    },
    status: entry.status,
    notes: entry.notes || null,
  };
}

export async function loadPayrollMonth(input: {
  year: number;
  month: number;
  employeeId?: string;
  status?: string;
}): Promise<PayrollMonthLoadResult> {
  const { payrollMonth } = payrollMonthBounds(input.year, input.month);
  const [periods, rows] = await Promise.all([
    CoreHrService.listPayrollPeriods(),
    CoreHrService.listPayrollEntries({
      payrollMonth,
      employeeId: input.employeeId || undefined,
      status: input.status || undefined,
    }),
  ]);
  return {
    period: periods.find((period) => period.payrollMonth === payrollMonth) || null,
    entries: rows.map(normalizePayrollEntry),
    generatedAt: new Date().toISOString(),
  };
}

export async function generatePayrollEntries(input: {
  year: number;
  month: number;
  employeeId?: string;
  status?: string;
  currentEntries?: PayrollEntryView[];
}) {
  const bounds = payrollMonthBounds(input.year, input.month);
  const { payrollMonth } = bounds;
  const [employees, attendance, leaves, absences] = await Promise.all([
    CoreHrService.listEmployees({ status: "active" }),
    CoreHrService.listAttendance(),
    CoreHrService.listLeaves({ status: "approved" }),
    CoreHrService.listAbsences(),
  ]);
  const existingMap = new Map(
    (input.currentEntries || [])
      .filter((entry) => entry.payrollMonth === payrollMonth)
      .map((entry) => [entry.employeeId, entry])
  );
  const periodAttendanceRecords = attendance.filter((record) =>
    isDateKeyInRange(record.dateKey, bounds.monthStart, bounds.monthEnd)
  );

  const generated = employees
    .filter((employee) => !input.employeeId || employee.id === input.employeeId)
    .map((employee) => {
      const employeeRecords = periodAttendanceRecords.filter((record) =>
        attendanceRecordMatchesEmployee(record, employee)
      );
      const attendanceSnapshot = buildPayrollAttendanceSummaryForEmployee({
        employee,
        records: employeeRecords,
        leaves,
        absences,
        year: input.year,
        month: input.month,
      });
      return snapshotFromEmployee({
        employee,
        attendanceSummary: attendanceSnapshot.summary,
        year: input.year,
        month: input.month,
        existing: existingMap.get(employee.id),
      });
    })
    .filter((entry) => !input.status || entry.status === input.status);

  return generated;
}

export async function ensurePayrollPeriod(year: number, month: number) {
  const bounds = payrollMonthBounds(year, month);
  return CoreHrService.savePayrollPeriod({
    payrollMonth: bounds.payrollMonth,
    monthStart: bounds.monthStart,
    monthEnd: bounds.monthEnd,
    status: "open",
  });
}

export async function savePayrollEntrySnapshot(entry: PayrollEntryView) {
  const saved = normalizePayrollEntry(
    await CoreHrService.savePayrollEntry(payrollEntryPayload(entry))
  );
  return saved;
}

export async function savePayrollDrafts(entries: PayrollEntryView[]) {
  const writable = entries.filter((entry) => !isPayrollSnapshotLocked(entry.status));
  const saved: PayrollEntryView[] = [];
  for (const entry of writable) {
    saved.push(await savePayrollEntrySnapshot(entry));
  }
  return saved;
}

export function assertPayrollEntryReady(entry: PayrollEntryView) {
  if (!entry.payrollSetupComplete) {
    throw new Error("payroll_setup_incomplete");
  }
}

export async function updatePayrollEntryAdjustments(entry: PayrollEntryView) {
  if (!entry.id) return savePayrollEntrySnapshot(entry);
  return normalizePayrollEntry(
    await CoreHrService.updatePayrollEntryAdjustments(entry.id, payrollEntryPayload(entry))
  );
}

export async function togglePayrollOvertime(entry: PayrollEntryView) {
  assertPayrollEntryReady(entry);
  if (entry.detectedExtraHours <= 0) return entry;
  if (!entry.id) return savePayrollEntrySnapshot(entry);
  return normalizePayrollEntry(
    await CoreHrService.togglePayrollOvertime(entry.id, payrollEntryPayload(entry))
  );
}

export async function approvePayrollEntry(entry: PayrollEntryView) {
  assertPayrollEntryReady(entry);
  const saved = entry.id ? entry : await savePayrollEntrySnapshot(entry);
  return normalizePayrollEntry(await CoreHrService.approvePayrollEntry(saved.id!));
}

export async function markPayrollEntryPaid(entry: PayrollEntryView) {
  assertPayrollEntryReady(entry);
  if (entry.status !== "approved") {
    throw new Error("payroll_not_approved");
  }
  const saved = entry.id ? entry : await savePayrollEntrySnapshot(entry);
  return normalizePayrollEntry(await CoreHrService.markPayrollEntryPaid(saved.id!));
}
