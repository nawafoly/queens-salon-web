import type {
  CoreAbsence,
  CoreAttendanceRecord,
  CoreHrEmployee,
  CoreLeave,
  CoreResolvedShift,
  CorePayrollEntry,
  CorePayrollPeriod,
} from "../types/hrCoreApi.ts";
import {
  permissionIntervalsFromAttendanceRecords,
} from "../helpers/hr/permissionAttendance.ts";
import {
  filterPaidPermissionIntervals,
  fullDayPaidLeaveDates,
  mergePayrollDayUnits,
  payrollAbsenceDayUnits,
  payrollIntervalHours,
  payrollLeaveDayUnits,
  totalPayrollDayUnits,
  unpaidPartialLeaveIntervalsForDate,
} from "../helpers/hr/payrollLeaveAbsencePolicy.ts";
import {
  calculateAttendanceDisciplineDay,
  summarizeAttendanceDisciplineMonth,
  type AttendanceDisciplineDaySummary,
} from "../helpers/hr/attendanceDiscipline.ts";
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
} from "../helpers/hr/payrollCalculations.ts";

const DEFAULT_SHIFT_START = "10:00";
const DEFAULT_SHIFT_END = "22:00";
const DAY_MS = 24 * 60 * 60 * 1000;

async function coreHrService() {
  return (await import("./CoreHrService.ts")).CoreHrService;
}

export type PayrollEntryView = PayrollSnapshot & {
  id?: string;
  periodId?: string | null;
  saved: boolean;
  absenceEntries?: PayrollAbsenceEntry[];
  approvedAt?: string | null;
  approvedByUid?: string | null;
  paidAt?: string | null;
  paidByUid?: string | null;
  auditLog?: Array<Record<string, unknown>>;
};

export type PayrollAccrualView = {
  payrollMonth: string;
  completedThroughDate: string | null;
  isPartial: boolean;
  progressRatio: number;
  accruedGrossHalalas: number;
  earnedToDateHalalas: number;
  expectedNetHalalas: number;
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

const PAYROLL_CYCLE_START_DAY = 1;
const PAYROLL_PAY_DAY = 28;

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function todayRiyadhDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function completedPayrollThroughDate(bounds: { monthStart: string; monthEnd: string }) {
  const today = todayRiyadhDateKey();
  if (bounds.monthEnd < today) return bounds.monthEnd;
  return dateKeyFromUtcDate(addUtcDays(jsDateFromKey(today), -1));
}
function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function payrollMonthBounds(year: number, month: number) {
  const cycleStartDate = new Date(Date.UTC(year, month - 1, PAYROLL_CYCLE_START_DAY));
  const cycleEndDate = new Date(Date.UTC(year, month, 0));
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

function timeFromMinutes(value: number) {
  const minutes = ((Math.round(value) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function endTimeFromDailyHours(start?: string | null, dailyScheduledHours = 0) {
  const startMinutes = parseTimeMinutes(start);
  if (startMinutes == null || dailyScheduledHours <= 0) return null;
  return timeFromMinutes(startMinutes + dailyScheduledHours * 60);
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

function isLegacyAttendancePenaltyCarryover(item: PayrollManualItem | Record<string, unknown>) {
  return (
    String((item as any).id || "").startsWith("attendance_penalty_carryover") ||
    String((item as any).note || "").includes("attendance_penalty_carryover") ||
    String((item as any).reason || "").includes("attendance_penalty_carryover")
  );
}

function legacyAttendancePenaltyCarryoverAmount(items: Array<PayrollManualItem | Record<string, unknown>>) {
  return items
    .filter(isLegacyAttendancePenaltyCarryover)
    .reduce((total, item) => total + numberValue((item as any).amountHalalas), 0);
}

function withoutLegacyAttendancePenaltyCarryovers<T extends PayrollManualItem | Record<string, unknown>>(items: T[]) {
  return items.filter((item) => !isLegacyAttendancePenaltyCarryover(item));
}

function policyMinutes(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(24 * 60, Math.round(number)) : 0;
}

function firstPolicyMinutes(
  parts: Array<Record<string, unknown> | null | undefined>,
  camelKey: string,
  snakeKey: string
) {
  for (const source of parts) {
    if (!source) continue;
    for (const raw of [(source as any)[camelKey], (source as any)[snakeKey]]) {
      if (raw !== null && raw !== undefined && raw !== "") return policyMinutes(raw);
    }
  }
  return 0;
}

type PayrollDaySchedule = {
  enabled: boolean;
  start: string | null;
  end: string | null;
  source?: string;
  lateGraceMinutes?: number;
  earlyLeaveGraceMinutes?: number;
};

function payrollScheduleFromResolvedShift(
  shift: CoreResolvedShift | null | undefined
): PayrollDaySchedule {
  if (!shift) {
    return {
      enabled: false,
      start: null,
      end: null,
      source: "canonical_missing",
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
    };
  }

  const source = text(shift.source).toLowerCase();
  const exceptionType = text(
    shift.exceptionType ?? shift.exception_type
  ).toLowerCase();

  const active = shift.active;

  if (
    source === "none" ||
    exceptionType === "off" ||
    active === false ||
    active === 0 ||
    active === "0"
  ) {
    return {
      enabled: false,
      start: null,
      end: null,
      source: "canonical_" + (source || "off"),
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
    };
  }

  const start = text(
    shift.templateStartTime ??
      shift.template_start_time ??
      shift.startTime ??
      shift.start_time
  );

  const end = text(
    shift.templateEndTime ??
      shift.template_end_time ??
      shift.endTime ??
      shift.end_time
  );

  if (!start || !end) {
    return {
      enabled: false,
      start: null,
      end: null,
      source: "canonical_invalid",
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
    };
  }

  return {
    enabled: true,
    start,
    end,
    source: "canonical_" + (source || "resolved"),
    lateGraceMinutes: policyMinutes(
      shift.lateGraceMinutes ??
        shift.late_grace_minutes
    ),
    earlyLeaveGraceMinutes: 0,
  };
}

export function payrollAccrualPeriodStatus(payrollMonth: string) {
  const [year, month] = String(payrollMonth || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { completedThroughDate: null, isPartial: false };
  }
  const bounds = payrollMonthBounds(year, month);
  const rawCompletedThrough = completedPayrollThroughDate(bounds);
  const completedThroughDate =
    rawCompletedThrough >= bounds.monthStart ? rawCompletedThrough : null;
  return {
    completedThroughDate,
    isPartial: Boolean(completedThroughDate && completedThroughDate < bounds.monthEnd),
  };
}

export function calculatePayrollAccrualView(entry: PayrollEntryView): PayrollAccrualView {
  const period = payrollAccrualPeriodStatus(entry.payrollMonth);
  const isPartial = period.isPartial;
  const monthlyHours = positiveNumber(entry.monthlyHours);
  const scheduledHours = positiveNumber(entry.attendanceSummary?.totalScheduledHours);
  const progressRatio = isPartial
    ? monthlyHours > 0
      ? Math.min(1, Math.max(0, scheduledHours / monthlyHours))
      : 0
    : 1;

  const baseAndAllowancesHalalas =
    numberValue(entry.baseSalaryHalalas) + numberValue(entry.allowancesHalalas);
  const accruedGrossHalalas = isPartial
    ? Math.round(baseAndAllowancesHalalas * progressRatio)
    : numberValue(entry.grossSalaryHalalas);

  const variableAdditionsHalalas =
    numberValue(entry.manualAdditionsHalalas) + numberValue(entry.overtimeValueHalalas);
  const earnedToDateHalalas = entry.payrollSetupComplete
    ? isPartial
      ? Math.max(
          0,
          Math.round(
            accruedGrossHalalas +
              variableAdditionsHalalas -
              numberValue(entry.totalDeductionsHalalas)
          )
        )
      : numberValue(entry.netSalaryHalalas)
    : 0;

  return {
    payrollMonth: entry.payrollMonth,
    completedThroughDate: period.completedThroughDate,
    isPartial,
    progressRatio: Math.round(progressRatio * 10000) / 10000,
    accruedGrossHalalas,
    earnedToDateHalalas,
    expectedNetHalalas: numberValue(entry.netSalaryHalalas),
  };
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

function dateSetForApprovedLeaves(
  leaves: CoreLeave[],
  employee: CoreHrEmployee,
  startDate: string,
  endDate: string,
  kind: "paid" | "unpaid" | "all" = "all"
) {
  const dates = new Set<string>();
  for (const leave of leaves) {
    if (text(leave.status).toLowerCase() !== "approved") continue;
    if (!leaveMatchesEmployee(leave, employee)) continue;
    const leaveType = text(leave.leaveType).toLowerCase();
    const isUnpaid = leaveType === "unpaid";
    if (kind === "paid" && isUnpaid) continue;
    if (kind === "unpaid" && !isUnpaid) continue;
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
    absenceDeductionOverlapHours: 0,
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

function attendanceMetadata(
  recordCount: number,
  linkStatus: "confirmed" | "unlinked" | "not_ready" = recordCount > 0 ? "confirmed" : "unlinked",
  note = ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE
) {
  if (linkStatus === "confirmed") {
    return {
      attendanceRecordCount: recordCount,
      attendanceLinkStatus: "confirmed" as const,
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
    };
  }
  return {
    attendanceRecordCount: 0,
    attendanceLinkStatus: linkStatus,
    attendanceDeductionEligible: false,
    attendanceDeductionNote: note,
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

function explicitDailyScheduledHoursForMonth(
  employee: CoreHrEmployee,
  year: number,
  month: number,
  resolvedShifts?: CoreResolvedShift[]
) {
  const employment = employmentOf(employee);

  const configuredDailyHours = positiveNumber(
    employment.daily_scheduled_hours ??
      employment.dailyScheduledHours ??
      employment.expected_daily_hours ??
      employment.expectedDailyHours
  );

  if (!Array.isArray(resolvedShifts)) {
    return configuredDailyHours;
  }

  const bounds = payrollMonthBounds(year, month);

  const canonicalHours = resolvedShifts
    .filter(
      (shift) =>
        shift.date >= bounds.monthStart &&
        shift.date <= bounds.monthEnd
    )
    .map(payrollScheduleFromResolvedShift)
    .filter(
      (schedule): schedule is PayrollDaySchedule & {
        start: string;
        end: string;
      } =>
        Boolean(
          schedule.enabled &&
            schedule.start &&
            schedule.end
        )
    )
    .map((schedule) =>
      hoursBetween(schedule.start, schedule.end)
    )
    .filter((hours) => hours > 0);

  if (!canonicalHours.length) return 0;

  const total = canonicalHours.reduce(
    (sum, hours) => sum + hours,
    0
  );

  return Math.round(
    (total / canonicalHours.length) * 100
  ) / 100;
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

export function buildPayrollAttendanceSummaryForEmployee(input: {
  employee: CoreHrEmployee;
  records: CoreAttendanceRecord[];
  leaves?: CoreLeave[];
  absences?: CoreAbsence[];
  year: number;
  month: number;
  resolvedShifts?: CoreResolvedShift[];
}) {
  const days: AttendanceDisciplineDaySummary[] = [];
  const bounds = payrollMonthBounds(input.year, input.month);
  const completedThroughDate = completedPayrollThroughDate(bounds);
  const dates =
    bounds.monthStart <= completedThroughDate
      ? dateKeysInRange(bounds.monthStart, completedThroughDate)
      : [];
  const recordsByDate = new Map<string, CoreAttendanceRecord[]>();
  const periodRecords = input.records.filter(
    (record) =>
      isDateKeyInRange(record.dateKey, bounds.monthStart, bounds.monthEnd) &&
      attendanceRecordMatchesEmployee(record, input.employee)
  );
  const employeeLeaves = (input.leaves || []).filter(
    (leave) => text(leave.status).toLowerCase() === "approved" && leaveMatchesEmployee(leave, input.employee)
  );
  const employeeAbsences = (input.absences || []).filter(
    (absence) => absenceMatchesEmployee(absence, input.employee)
  );
  const approvedLeaveDates = fullDayPaidLeaveDates(
    employeeLeaves,
    bounds.monthStart,
    bounds.monthEnd
  );
  const paidLeaveUnits = payrollLeaveDayUnits(
    employeeLeaves,
    bounds.monthStart,
    bounds.monthEnd,
    "paid"
  );
  const unpaidLeaveUnits = payrollLeaveDayUnits(
    employeeLeaves,
    bounds.monthStart,
    bounds.monthEnd,
    "unpaid"
  );
  const recordedAbsenceUnits = payrollAbsenceDayUnits(
    employeeAbsences,
    bounds.monthStart,
    bounds.monthEnd
  );
  const deductibleAbsenceUnits = mergePayrollDayUnits(recordedAbsenceUnits, unpaidLeaveUnits);
  const paidLeaveDays = totalPayrollDayUnits(paidLeaveUnits);
  const identity = resolvePayrollAttendanceIdentity(input.employee);
  const dailyScheduledHours = explicitDailyScheduledHoursForMonth(
    input.employee,
    input.year,
    input.month,
    input.resolvedShifts
  );
  const payrollSetup = evaluatePayrollSetup({
    employeeId: input.employee.id,
    baseSalaryHalalas: employeeBaseSalary(input.employee),
    workDays: employeeWorkDays(input.employee),
    monthlyHours: employeeMonthlyHours(input.employee),
    dailyScheduledHours,
  });
  const hasCoreEmployeeIdentity = Boolean(identity.employeeId);

  if (!hasCoreEmployeeIdentity || !payrollSetup.complete) {
    return {
      days,
      summary: {
        ...emptyAttendanceSummary(
          "not_ready",
          hasCoreEmployeeIdentity
            ? ["إعداد الراتب غير مكتمل؛ لم يتم احتساب خصم حضور تلقائي."]
            : ["لا توجد هوية موظفة معروفة في Core لربط سجلات البصمة."]
        ),
        approvedLeaveDays: paidLeaveDays,
        approvedAbsenceDays: totalPayrollDayUnits(deductibleAbsenceUnits),
      },
    };
  }

  for (const record of periodRecords) {
    const list = recordsByDate.get(record.dateKey) || [];
    list.push(record);
    recordsByDate.set(record.dateKey, list);
  }

  const eligibleUnpaidLeaveUnits = new Map<string, number>();
  const eligibleRecordedAbsenceUnits = new Map<string, number>();
  const eligibleDeductibleAbsenceUnits = new Map<string, number>();
  let absenceDeductionOverlapHours = 0;

  const canonicalShiftByDate = new Map(
    (input.resolvedShifts || []).map((shift) => [
      shift.date,
      shift,
    ])
  );

  for (const date of dates) {
    const schedule =
      payrollScheduleFromResolvedShift(
        canonicalShiftByDate.get(date)
      );
    const records = [...(recordsByDate.get(date) || [])].sort(
      (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
    );
    const punchRecords = records.filter((record) =>
      record.recordType === "check_in" || record.recordType === "check_out"
    );
    const rawPermissionIntervals = permissionIntervalsFromAttendanceRecords(records, date);
    const permissionIntervals = filterPaidPermissionIntervals(
      rawPermissionIntervals,
      employeeLeaves,
      date
    );

    if (schedule.enabled) {
      const unpaidUnit = unpaidLeaveUnits.get(date) || 0;
      const absenceUnit = recordedAbsenceUnits.get(date) || 0;
      const deductibleUnit = deductibleAbsenceUnits.get(date) || 0;
      if (unpaidUnit > 0) eligibleUnpaidLeaveUnits.set(date, unpaidUnit);
      if (absenceUnit > 0) eligibleRecordedAbsenceUnits.set(date, absenceUnit);
      if (deductibleUnit > 0) eligibleDeductibleAbsenceUnits.set(date, deductibleUnit);

      if (deductibleUnit > 0) {
        const scheduledHours = hoursBetween(schedule.start, schedule.end);
        const unpaidPartialIntervals = unpaidPartialLeaveIntervalsForDate(employeeLeaves, date);
        const unpaidPartialHours = unpaidPartialIntervals.reduce(
          (sum, interval) => sum + payrollIntervalHours(interval.startTime, interval.endTime),
          0
        );
        const recordedOverlapHours = Math.min(scheduledHours, scheduledHours * absenceUnit);
        const unpaidOverlapHours = unpaidPartialIntervals.length
          ? Math.min(scheduledHours, unpaidPartialHours)
          : Math.min(scheduledHours, scheduledHours * unpaidUnit);
        absenceDeductionOverlapHours += Math.max(recordedOverlapHours, unpaidOverlapHours);
      }
    }

    if (!schedule.enabled && !punchRecords.length && !permissionIntervals.length) continue;
    const firstCheckIn = punchRecords.find((record) => record.recordType === "check_in");
    const lastCheckOut = [...punchRecords].reverse().find((record) => record.recordType === "check_out");
    days.push(
      calculateAttendanceDisciplineDay({
        date,
        scheduledStart: schedule.start,
        scheduledEnd: schedule.end,
        lateGraceMinutes: schedule.lateGraceMinutes,
        earlyLeaveGraceMinutes: schedule.earlyLeaveGraceMinutes,
        isScheduledWorkDay: schedule.enabled,
        isApprovedLeave: approvedLeaveDates.has(date),
        checkInAt: firstCheckIn?.recordedAt,
        checkOutAt: lastCheckOut?.recordedAt,
        permissionIntervals,
        isAbsent:
          schedule.enabled &&
          !punchRecords.length &&
          !approvedLeaveDates.has(date),
      })
    );
  }

  const disciplineSummary = summarizeAttendanceDisciplineMonth(days) as PayrollAttendanceSummarySnapshot;
  const permissionCoveredHours = Number(disciplineSummary.totalPermissionCoveredHours || 0);
  const permissionRequestedHours = Number(disciplineSummary.totalPermissionRequestedHours || 0);
  const punchRecordCount = periodRecords.filter(
    (record) => record.recordType === "check_in" || record.recordType === "check_out"
  ).length;
  const unpaidLeaveDays = totalPayrollDayUnits(eligibleUnpaidLeaveUnits);
  const recordedAbsenceDays = totalPayrollDayUnits(eligibleRecordedAbsenceUnits);
  const deductibleAbsenceDays = totalPayrollDayUnits(eligibleDeductibleAbsenceUnits);

  return {
    days,
    summary: {
      ...disciplineSummary,
      approvedLeaveDays: paidLeaveDays,
      approvedAbsenceDays: deductibleAbsenceDays,
      absenceDeductionOverlapHours: Math.round(absenceDeductionOverlapHours * 100) / 100,
      attendanceNotes: [
        ...(paidLeaveDays ? [`${paidLeaveDays} يوم/أيام إجازة مدفوعة معتمدة لم تدخل في خصم الحضور.`] : []),
        ...(unpaidLeaveDays ? [`${unpaidLeaveDays} يوم/أيام إجازة بدون راتب تم احتسابها ضمن الخصم اليومي.`] : []),
        ...(recordedAbsenceDays ? [`${recordedAbsenceDays} يوم/أيام غياب مسجلة دخلت ضمن الخصم اليومي.`] : []),
        ...(days.some((day) => day.status === "incomplete") ? ["توجد أيام ببصمة خروج ناقصة؛ لم تخصم كيوم كامل تلقائيا."] : []),
        ...(permissionRequestedHours > 0
          ? [`الاستئذانات والإجازات الجزئية المدفوعة المعتمدة: ${permissionRequestedHours} ساعة، والمحتسب لتغطية نقص الدوام: ${permissionCoveredHours} ساعة.`]
          : []),
      ],
      ...attendanceMetadata(
        punchRecordCount,
        punchRecordCount > 0 ? "confirmed" : "unlinked"
      ),
    },
  };
}

function snapshotFromEmployee(input: {
  employee: CoreHrEmployee;
  attendanceSummary: PayrollAttendanceSummarySnapshot;
  year: number;
  month: number;
  existing?: PayrollEntryView;
  advancesHalalas?: number;
  resolvedShifts?: CoreResolvedShift[];
  preserveExistingSchedule?: boolean;
}) {
  const workDays = employeeWorkDays(input.employee);
  const monthlyHours = employeeMonthlyHours(input.employee);
  const preserveExistingSchedule =
    input.preserveExistingSchedule &&
    Boolean(input.existing);

  const dailyScheduledHours = preserveExistingSchedule
    ? Math.max(
        0,
        numberValue(input.existing?.dailyScheduledHours)
      )
    : explicitDailyScheduledHoursForMonth(
    input.employee,
    input.year,
    input.month,
    input.resolvedShifts
  );

  const monthlyHoursSource: PayrollMonthlyHoursSource =
    preserveExistingSchedule &&
    input.existing?.monthlyHoursSource
      ? input.existing.monthlyHoursSource
      : monthlyHours > 0
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
    advancesHalalas:
      input.advancesHalalas ?? input.existing?.advancesHalalas ?? 0,
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
    approvedByUid: input.existing?.approvedByUid,
    paidAt: input.existing?.paidAt,
    paidByUid: input.existing?.paidByUid,
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
    preserveExistingSchedule: true,
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
  const rawDeductions = readJson<PayrollManualItem[]>(row.deductionsJson, []);
  const legacyCarryoverHalalas = legacyAttendancePenaltyCarryoverAmount(rawDeductions);
  const deductions = withoutLegacyAttendancePenaltyCarryovers(rawDeductions);
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
    manualDeductionsHalalas: Math.max(0, numberValue(row.manualDeductionsHalalas) - legacyCarryoverHalalas),
    advancesHalalas: numberValue(row.advancesHalalas),
    absenceDeductionHalalas: numberValue(row.absenceDeductionHalalas),
    missingHoursDeductionHalalas: numberValue(row.missingHoursDeductionHalalas),
    grossSalaryHalalas: numberValue(row.grossSalaryHalalas),
    totalAdditionsHalalas:
      numberValue(row.allowancesHalalas) +
      numberValue(row.manualAdditionsHalalas) +
      overtimeValueHalalas,
    totalDeductionsHalalas: Math.max(0, numberValue(row.totalDeductionsHalalas) - legacyCarryoverHalalas),
    netSalaryHalalas: numberValue(row.netSalaryHalalas ?? row.finalSalaryHalalas) + legacyCarryoverHalalas,
    finalSalaryHalalas: numberValue(row.finalSalaryHalalas) + legacyCarryoverHalalas,
    payrollSetupComplete,
    payrollSetupMissing,
    monthlyHoursSource: setup.monthlyHoursSource,
    status,
    notes: text(row.notes) || null,
    approvedAt: text(row.approvedAt) || null,
    approvedByUid: text(row.approvedByUid) || null,
    paidAt: text(row.paidAt) || null,
    paidByUid: text(row.paidByUid) || null,
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
    absenceDeductionHalalas: entry.absenceDeductionHalalas,
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
    deductions: withoutLegacyAttendancePenaltyCarryovers(entry.deductions),
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
  const CoreHrService = await coreHrService();
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

export async function generatePayrollEntriesForMonths(input: {
  monthKeys: string[];
  employeeId?: string;
  status?: string;
  currentEntries?: PayrollEntryView[];
}) {
  const monthKeys = Array.from(
    new Set(
      (Array.isArray(input.monthKeys) ? input.monthKeys : [])
        .map((value) => text(value))
        .filter((value) => /^\d{4}-\d{2}$/.test(value))
    )
  ).sort((left, right) => left.localeCompare(right));
  if (!monthKeys.length) return [];

  const monthKeySet = new Set(monthKeys);
  const CoreHrService = await coreHrService();
  const [
    employees,
    attendance,
    leaves,
    absences,
    savedEntries,
    advanceDeductions,
  ] = await Promise.all([
    CoreHrService.listEmployees({ status: "active" }),
    CoreHrService.listAttendance(),
    CoreHrService.listLeaves({ status: "approved" }),
    CoreHrService.listAbsences(),
    input.currentEntries ? Promise.resolve(null) : CoreHrService.listPayrollEntries(),
    CoreHrService.listPayrollAdvanceDeductions({
      employeeId: input.employeeId,
    }),
  ]);

  const currentEntries = input.currentEntries
    ? input.currentEntries
    : (Array.isArray(savedEntries) ? savedEntries : []).map(normalizePayrollEntry);
  const existingMap = new Map(
    currentEntries
      .filter((entry) => monthKeySet.has(entry.payrollMonth))
      .map((entry) => [`${entry.payrollMonth}|${entry.employeeId}`, entry])
  );
  const advanceDeductionMap = new Map(
    advanceDeductions
      .filter((row) => monthKeySet.has(row.payrollMonth))
      .map((row) => [
        `${row.payrollMonth}|${row.employeeId}`,
        numberValue(row.amountHalalas),
      ])
  );

  const payrollEmployees = employees.filter(
    (employee) =>
      !input.employeeId ||
      employee.id === input.employeeId
  );

  if (!payrollEmployees.length) {
    return [];
  }

  const resolvedShiftsByMonth = new Map<
    string,
    CoreResolvedShift[]
  >();

  await Promise.all(
    monthKeys.map(async (payrollMonth) => {
      const year = Number(payrollMonth.slice(0, 4));
      const month = Number(payrollMonth.slice(5, 7));
      const bounds = payrollMonthBounds(year, month);

      const resolved =
        await CoreHrService.resolveEmployeeShiftsRange({
          employeeIds:
            payrollEmployees.map(
              (employee) =>
                employee.id
            ),
          dateFrom: bounds.monthStart,
          dateTo: bounds.monthEnd,
        });

      resolvedShiftsByMonth.set(
        payrollMonth,
        resolved.rows
      );
    })
  );

  return monthKeys.flatMap((payrollMonth) => {
    const year = Number(payrollMonth.slice(0, 4));
    const month = Number(payrollMonth.slice(5, 7));
    const bounds = payrollMonthBounds(year, month);
    const periodAttendanceRecords = attendance.filter((record) =>
      isDateKeyInRange(record.dateKey, bounds.monthStart, bounds.monthEnd)
    );

    return payrollEmployees.map((employee) => {
        const employeeWithCoreShifts = employee;

        const employeeResolvedShifts = (
          resolvedShiftsByMonth.get(payrollMonth) || []
        ).filter(
          (row) =>
            text(
              row.employeeId ??
                row.employee_id
            ) === employee.id
        );

        const employeeRecords = periodAttendanceRecords.filter((record) =>
          attendanceRecordMatchesEmployee(record, employeeWithCoreShifts)
        );
        const attendanceSnapshot = buildPayrollAttendanceSummaryForEmployee({
          employee: employeeWithCoreShifts,
          records: employeeRecords,
          leaves,
          absences,
          year,
          month,
          resolvedShifts: employeeResolvedShifts,
        });

        return snapshotFromEmployee({
          employee: employeeWithCoreShifts,
          attendanceSummary: attendanceSnapshot.summary,
          year,
          month,
          existing: existingMap.get(`${payrollMonth}|${employee.id}`),
          advancesHalalas: numberValue(
            advanceDeductionMap.get(`${payrollMonth}|${employee.id}`)
          ),
          resolvedShifts: employeeResolvedShifts,
        });
      })
      .filter((entry) => !input.status || entry.status === input.status);
  });
}

export async function generatePayrollEntries(input: {
  year: number;
  month: number;
  employeeId?: string;
  status?: string;
  currentEntries?: PayrollEntryView[];
}) {
  const { payrollMonth } = payrollMonthBounds(input.year, input.month);
  return generatePayrollEntriesForMonths({
    monthKeys: [payrollMonth],
    employeeId: input.employeeId,
    status: input.status,
    currentEntries: input.currentEntries,
  });
}

export async function ensurePayrollPeriod(year: number, month: number) {
  const bounds = payrollMonthBounds(year, month);
  const CoreHrService = await coreHrService();
  return CoreHrService.savePayrollPeriod({
    payrollMonth: bounds.payrollMonth,
    monthStart: bounds.monthStart,
    monthEnd: bounds.monthEnd,
    status: "open",
  });
}

export async function savePayrollEntrySnapshot(entry: PayrollEntryView) {
  const CoreHrService = await coreHrService();
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
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(
    await CoreHrService.updatePayrollEntryAdjustments(entry.id, payrollEntryPayload(entry))
  );
}

export async function togglePayrollOvertime(entry: PayrollEntryView) {
  assertPayrollEntryReady(entry);
  if (entry.detectedExtraHours <= 0) return entry;
  if (!entry.id) return savePayrollEntrySnapshot(entry);
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(
    await CoreHrService.togglePayrollOvertime(entry.id, payrollEntryPayload(entry))
  );
}

export async function approvePayrollEntry(entry: PayrollEntryView) {
  assertPayrollEntryReady(entry);
  const saved = entry.id ? entry : await savePayrollEntrySnapshot(entry);
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(await CoreHrService.approvePayrollEntry(saved.id!));
}

export async function markPayrollEntryPaid(entry: PayrollEntryView) {
  assertPayrollEntryReady(entry);
  if (entry.status !== "approved") {
    throw new Error("payroll_not_approved");
  }
  const saved = entry.id ? entry : await savePayrollEntrySnapshot(entry);
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(await CoreHrService.markPayrollEntryPaid(saved.id!));
}

export async function reopenPayrollEntry(
  entry: PayrollEntryView,
  input: { reason: string; status?: "draft" | "reviewed" }
) {
  if (!entry.id) throw new Error("payroll_entry_not_saved");
  if (entry.status === "paid") throw new Error("payroll_paid_reopen_not_allowed");
  if (entry.status !== "approved") throw new Error("payroll_not_approved");
  const reason = text(input.reason);
  if (!reason) throw new Error("payroll_reopen_reason_required");
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(
    await CoreHrService.reopenPayrollEntry(entry.id, {
      reason,
      status: input.status || "draft",
    })
  );
}



