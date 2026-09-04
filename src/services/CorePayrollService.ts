import type {
  CoreAbsence,
  CoreAttendanceRecord,
  CoreHrEmployee,
  CoreLeave,
  CoreResolvedShift,
  CorePayrollEntry,
  CorePayrollPeriod,
  CorePayrollCarryoverAdjustment,
} from "../types/hrCoreApi.ts";
import {
  payrollCarryoverNetHalalas,
  previousPayrollMonth,
} from "../helpers/hr/payrollCarryoverPolicy.js";
import {
  payrollApprovalReadiness,
  payrollAttendanceReadiness,
} from "../helpers/hr/payrollReadiness.js";
import type { GosiSnapshot } from "../helpers/hr/gosiPolicy.js";
import {
  ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE,
  evaluatePayrollSetup,
  isPayrollSnapshotLocked,
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
  carryoverAdjustments?: CorePayrollCarryoverAdjustment[];
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

function payrollCalendarProgressRatio(
  payrollMonth: string,
  completedThroughDate: string | null
) {
  if (!completedThroughDate) return 0;
  const [year, month] = String(payrollMonth || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0;
  const bounds = payrollMonthBounds(year, month);
  if (completedThroughDate < bounds.monthStart) return 0;
  const cappedDate =
    completedThroughDate > bounds.monthEnd
      ? bounds.monthEnd
      : completedThroughDate;
  const totalDays = dateKeysInRange(bounds.monthStart, bounds.monthEnd).length;
  const completedDays = dateKeysInRange(bounds.monthStart, cappedDate).length;
  return totalDays > 0
    ? Math.min(1, Math.max(0, completedDays / totalDays))
    : 0;
}

export function calculatePayrollAccrualView(entry: PayrollEntryView): PayrollAccrualView {
  const period = payrollAccrualPeriodStatus(entry.payrollMonth);
  const isPartial = period.isPartial;
  const attendancePayrollMode =
    entry.attendanceSummary?.attendancePayrollMode === "exempt"
      ? "exempt"
      : "required";
  const monthlyHours = positiveNumber(entry.monthlyHours);
  const scheduledHours = positiveNumber(entry.attendanceSummary?.totalScheduledHours);
  const progressRatio = isPartial
    ? attendancePayrollMode === "exempt"
      ? payrollCalendarProgressRatio(
          entry.payrollMonth,
          period.completedThroughDate
        )
      : monthlyHours > 0
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
  return [
    "configured_monthly_hours",
    "configured_daily_hours",
    "saved_snapshot",
    "not_required_attendance_exempt",
    "missing",
  ].includes(value)
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
  const mode =
    summary.attendancePayrollMode === "exempt"
      ? "exempt"
      : "required";
  const exemptionReason =
    mode === "exempt"
      ? text(summary.attendancePayrollExemptionReason)
      : "";

  if (mode === "exempt") {
    return {
      ...summary,
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
      absenceDeductionOverlapHours: 0,
      attendancePayrollMode: "exempt" as const,
      attendancePayrollExemptionReason:
        exemptionReason || null,
      attendanceRecordCount: recordCount,
      attendanceLinkStatus: "exempt" as const,
      attendanceDeductionEligible: false,
      attendanceDeductionNote:
        exemptionReason
          ? `معفى من البصمة للراتب: ${exemptionReason}`
          : "معفى من البصمة للراتب.",
    };
  }
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

export function isEmployeePayrollEligible(employee: CoreHrEmployee) {
  const employment = employmentOf(employee);
  const profileStatus = text(employee.status).toLowerCase();
  const employmentStatus = text(
    employment.employment_status ?? employment.employmentStatus
  ).toLowerCase();

  if (profileStatus && profileStatus !== "active") return false;
  if (employmentStatus && employmentStatus !== "active") return false;

  return employeeBaseSalary(employee) > 0;
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
  const auditLog = readJson<Array<Record<string, unknown>>>(row.auditLogJson, []);
  const lateApprovalAudit = [...auditLog]
    .reverse()
    .find((event) => text(event.action) === "late_approval_recorded");
  const lateApprovedNetHalalas =
    lateApprovalAudit &&
    ["approved", "paid"].includes(status) &&
    Number.isFinite(Number(lateApprovalAudit.approvedNetHalalas))
      ? Math.max(0, Number(lateApprovalAudit.approvedNetHalalas))
      : null;
  const additions = readJson<PayrollManualItem[]>(row.additionsJson, []);
  const rawDeductions = readJson<PayrollManualItem[]>(row.deductionsJson, []);
  const legacyCarryoverHalalas = legacyAttendancePenaltyCarryoverAmount(rawDeductions);
  const deductions = withoutLegacyAttendancePenaltyCarryovers(rawDeductions);
  const baseSalaryHalalas = numberValue(row.baseSalaryHalalas);
  const workDays = numberValue(row.workDays, 0);
  const attendanceExempt =
    attendanceSummary.attendancePayrollMode === "exempt";
  const monthlyHours = attendanceExempt
    ? 0
    : numberValue(row.monthlyHours, 0);
  const dailyScheduledHours = attendanceExempt ? 0 : scheduleDailyHours;
  const setup = evaluatePayrollSetup({
    employeeId: row.employeeId,
    baseSalaryHalalas,
    workDays,
    monthlyHours,
    dailyScheduledHours,
    overtimeMultiplier: row.overtimeMultiplier,
    monthlyHoursSource: attendanceExempt
      ? "not_required_attendance_exempt"
      : scheduleMonthlyHoursSource || "saved_snapshot",
    attendancePayrollMode: attendanceSummary.attendancePayrollMode,
  });
  const savedSetupMissing = (scheduleSetupMissing || []).filter(
    (key) => !(attendanceExempt && key === "monthlyHours")
  );
  const payrollSetupMissing = Array.from(
    new Set([...savedSetupMissing, ...setup.missing])
  );
  const payrollSetupComplete = attendanceExempt
    ? payrollSetupMissing.length === 0
    : scheduleSetupComplete === null
      ? payrollSetupMissing.length === 0
      : scheduleSetupComplete;
  const detectedExtraHours = attendanceExempt
    ? 0
    : numberValue(row.detectedExtraHours);
  const overtimeEnabled = !attendanceExempt && payrollSetupComplete && detectedExtraHours > 0
    ? boolValue(row.overtimeEnabled)
    : false;
  const financialOvertimeHours = overtimeEnabled ? numberValue(row.financialOvertimeHours) : 0;
  const overtimeValueHalalas = overtimeEnabled
    ? numberValue(row.overtimeValueHalalas ?? row.overtimeBonusHalalas)
    : 0;
  const gosiSnapshot = readJson<GosiSnapshot | null>(
    row.gosiSnapshotJson,
    null
  );

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
    laborPolicyVersion:
      text(
        row.laborPolicyVersion ??
          scheduleSnapshot?.laborPolicyVersion
      ),
    fixedActualWageHalalas:
      numberValue(
        row.fixedActualWageHalalas ??
          scheduleSnapshot?.fixedActualWageHalalas,
        baseSalaryHalalas +
          numberValue(row.allowancesHalalas)
      ),
    overtimeActualHourlyHalalas:
      numberValue(
        row.overtimeActualHourlyHalalas
      ),
    overtimeBasicHourlyHalalas:
      numberValue(
        row.overtimeBasicHourlyHalalas
      ),
    workDays,
    monthlyHours,
    dailyScheduledHours,
    dailyRateHalalas: numberValue(row.dailyRateHalalas),
    hourlyRateHalalas: attendanceExempt ? 0 : numberValue(row.hourlyRateHalalas),
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
    insuranceDeductionHalalas: numberValue(
      row.insuranceDeductionHalalas ??
        gosiSnapshot?.employee?.deductionHalalas
    ),
    employerGosiContributionHalalas: numberValue(
      row.employerGosiContributionHalalas ??
        gosiSnapshot?.employer?.contributionHalalas
    ),
    gosiSnapshot,
    absenceDeductionHalalas: numberValue(row.absenceDeductionHalalas),
    missingHoursDeductionHalalas: numberValue(row.missingHoursDeductionHalalas),
    grossSalaryHalalas: numberValue(row.grossSalaryHalalas),
    totalAdditionsHalalas:
      numberValue(row.allowancesHalalas) +
      numberValue(row.manualAdditionsHalalas) +
      overtimeValueHalalas,
    totalDeductionsHalalas: Math.max(0, numberValue(row.totalDeductionsHalalas) - legacyCarryoverHalalas),
    netSalaryHalalas:
      lateApprovedNetHalalas ??
      (numberValue(row.netSalaryHalalas ?? row.finalSalaryHalalas) +
        legacyCarryoverHalalas),
    finalSalaryHalalas:
      lateApprovedNetHalalas ??
      (numberValue(row.finalSalaryHalalas) + legacyCarryoverHalalas),
    payrollSetupComplete,
    payrollSetupMissing,
    monthlyHoursSource: setup.monthlyHoursSource,
    status,
    notes: text(row.notes) || null,
    approvedAt: text(row.approvedAt) || null,
    approvedByUid: text(row.approvedByUid) || null,
    paidAt: text(row.paidAt) || null,
    paidByUid: text(row.paidByUid) || null,
    auditLog,
  };
}

export function payrollEntryPayload(entry: PayrollEntryView) {
  // Only mutable/manual payroll inputs cross the browser -> Core boundary.
  // Salary, attendance, overtime, GOSI, gross, deductions and net are derived
  // canonically by the Core worker from D1 and are intentionally not submitted.
  return {
    id: entry.id,
    periodId: entry.periodId,
    employeeId: entry.employeeId,
    payrollMonth: entry.payrollMonth,
    additions: entry.additions,
    deductions: withoutLegacyAttendancePenaltyCarryovers(entry.deductions),
    status: entry.status,
    notes: entry.notes || null,
  };
}

export async function previewPayrollEntrySnapshot(entry: PayrollEntryView) {
  const CoreHrService = await coreHrService();
  const row = await CoreHrService.previewPayrollEntry(payrollEntryPayload(entry));
  const preview = normalizePayrollEntry(row);
  return {
    ...preview,
    id: entry.id,
    periodId: entry.periodId || preview.periodId,
    saved: Boolean(entry.saved),
  } as PayrollEntryView;
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
  reconcileLockedEntries?: boolean;
}) {
  const monthKeys = Array.from(
    new Set(
      (Array.isArray(input.monthKeys) ? input.monthKeys : [])
        .map((value) => text(value))
        .filter((value) => /^\d{4}-\d{2}$/.test(value))
    )
  ).sort((left, right) => left.localeCompare(right));
  if (!monthKeys.length) return [];

  // Locked-period reconciliation is performed by the Core carryover endpoint.
  // The browser must never recalculate an approved/paid financial snapshot.
  if (input.reconcileLockedEntries) {
    return (input.currentEntries || [])
      .filter((entry) => monthKeys.includes(entry.payrollMonth))
      .filter((entry) => !input.employeeId || entry.employeeId === input.employeeId)
      .filter((entry) => !input.status || entry.status === input.status)
      .sort((left, right) => left.payrollMonth.localeCompare(right.payrollMonth) || left.employeeName.localeCompare(right.employeeName, "ar"));
  }

  const CoreHrService = await coreHrService();
  const [employees, savedRows] = await Promise.all([
    CoreHrService.listEmployees({ status: "active" }),
    input.currentEntries ? Promise.resolve(null) : CoreHrService.listPayrollEntries(),
  ]);
  const currentEntries = input.currentEntries
    ? input.currentEntries
    : (Array.isArray(savedRows) ? savedRows : []).map(normalizePayrollEntry);
  const existingMap = new Map(
    currentEntries.map((entry) => [`${entry.payrollMonth}|${entry.employeeId}`, entry])
  );
  const payrollEmployees = employees.filter((employee) => {
    if (input.employeeId && employee.id !== input.employeeId) return false;
    return isEmployeePayrollEligible(employee);
  });

  const rows: PayrollEntryView[] = [];
  for (const payrollMonth of monthKeys) {
    for (const employee of payrollEmployees) {
      const existing = existingMap.get(`${payrollMonth}|${employee.id}`);
      if (existing && isPayrollSnapshotLocked(existing.status)) {
        if (!input.status || existing.status === input.status) rows.push(existing);
        continue;
      }
      const previewRow = await CoreHrService.previewPayrollEntry({
        id: existing?.id,
        periodId: existing?.periodId,
        employeeId: employee.id,
        payrollMonth,
        status: existing?.status || "draft",
        additions: existing?.additions || [],
        deductions: existing?.deductions || [],
        notes: existing?.notes || null,
      });
      const preview = normalizePayrollEntry(previewRow);
      const normalized: PayrollEntryView = {
        ...preview,
        id: existing?.id,
        periodId: existing?.periodId || preview.periodId,
        saved: Boolean(existing?.saved),
        approvedAt: existing?.approvedAt || null,
        approvedByUid: existing?.approvedByUid || null,
        paidAt: existing?.paidAt || null,
        paidByUid: existing?.paidByUid || null,
        auditLog: existing?.auditLog || [],
      };
      if (!input.status || normalized.status === input.status) rows.push(normalized);
    }
  }

  return rows.sort((left, right) => {
    const monthCompare = left.payrollMonth.localeCompare(right.payrollMonth);
    if (monthCompare !== 0) return monthCompare;
    return left.employeeName.localeCompare(right.employeeName, "ar");
  });
}


export async function reconcilePreviousPayrollCarryovers(input: {
  year: number;
  month: number;
  employeeId?: string;
}) {
  const target = payrollMonthBounds(input.year, input.month);
  const sourcePayrollMonth = previousPayrollMonth(target.payrollMonth);
  if (!sourcePayrollMonth) {
    return { sourcePayrollMonth: "", targetPayrollMonth: target.payrollMonth, results: [] };
  }

  const sourceYear = Number(sourcePayrollMonth.slice(0, 4));
  const sourceMonth = Number(sourcePayrollMonth.slice(5, 7));
  const sourceBounds = payrollMonthBounds(sourceYear, sourceMonth);
  const today = todayRiyadhDateKey();
  if (sourceBounds.monthEnd >= today) {
    return {
      sourcePayrollMonth,
      targetPayrollMonth: target.payrollMonth,
      deferred: true,
      reason: "source_period_not_closed",
      results: [],
    };
  }

  const CoreHrService = await coreHrService();
  const sourceRows = await CoreHrService.listPayrollEntries({
    payrollMonth: sourcePayrollMonth,
    employeeId: input.employeeId,
  });
  const lockedSourceEntries = sourceRows
    .map(normalizePayrollEntry)
    .filter((entry) => ["approved", "paid"].includes(entry.status));
  if (!lockedSourceEntries.length) {
    return { sourcePayrollMonth, targetPayrollMonth: target.payrollMonth, results: [] };
  }

  const items = lockedSourceEntries.flatMap((sourceEntry) => {
    if (!sourceEntry.id) return [];
    return [{
      sourcePayrollEntryId: sourceEntry.id,
      sourceDate: sourceBounds.monthEnd,
      reason: `تسوية فرق مسيرة ${sourcePayrollMonth} بعد إقفال الفترة وإعادة احتساب الحضور والإجازات والخصومات النهائية داخل Core.`,
    }];
  });
  if (!items.length) {
    return { sourcePayrollMonth, targetPayrollMonth: target.payrollMonth, results: [] };
  }
  const reconciled = await CoreHrService.reconcilePayrollCarryoversBatch({ items });
  const results = reconciled.results || [];
  const targetPayrollMonths = Array.from(new Set(
    results
      .map((row) => text(row.targetPayrollMonth))
      .filter((value) => /^\d{4}-\d{2}$/.test(value))
  ));
  return {
    sourcePayrollMonth,
    targetPayrollMonth:
      targetPayrollMonths.length === 1
        ? targetPayrollMonths[0]
        : "",
    targetPayrollMonths,
    results,
  };
}

export function payrollEntryCarryoverNetHalalas(entry: PayrollEntryView) {
  return payrollCarryoverNetHalalas(entry.additions || [], entry.deductions || []);
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

  const attendanceReadiness = payrollAttendanceReadiness(
    entry.attendanceSummary
  );

  if (!attendanceReadiness.ready) {
    throw new Error(attendanceReadiness.code);
  }
}

export function assertPayrollEntryApprovalReady(entry: PayrollEntryView) {
  const readiness = payrollApprovalReadiness(entry as unknown as Record<string, unknown>);
  if (!readiness.ready) {
    throw new Error(readiness.code);
  }
}

export async function updatePayrollEntryAdjustments(entry: PayrollEntryView) {
  if (!entry.id) return savePayrollEntrySnapshot(entry);
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(
    await CoreHrService.updatePayrollEntryAdjustments(entry.id, payrollEntryPayload(entry))
  );
}

export async function approvePayrollEntry(entry: PayrollEntryView) {
  assertPayrollEntryApprovalReady(entry);
  const saved = await savePayrollEntrySnapshot(entry);
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(await CoreHrService.approvePayrollEntry(saved.id!));
}

export async function recordLatePayrollApproval(
  entry: PayrollEntryView,
  input: {
    approvalDate: string;
    approvedNetHalalas: number;
    reason: string;
  }
) {
  if (!entry.id || !entry.saved) {
    throw new Error("payroll_late_approval_entry_must_be_saved");
  }
  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(
    await CoreHrService.recordLatePayrollApproval(entry.id, input)
  );
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

export async function reversePayrollEntryPayment(
  entry: PayrollEntryView,
  reason: string
) {
  if (!entry.id || !entry.saved) {
    throw new Error("payroll_payment_reversal_entry_must_be_saved");
  }
  if (entry.status !== "paid") {
    throw new Error("payroll_not_paid");
  }
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) {
    throw new Error("payroll_payment_reversal_reason_required");
  }

  const CoreHrService = await coreHrService();
  return normalizePayrollEntry(
    await CoreHrService.reversePayrollEntryPayment(entry.id, {
      reason: normalizedReason,
    })
  );
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
