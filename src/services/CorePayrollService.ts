import { CoreHrService } from "./CoreHrService";
import type {
  CoreAttendanceRecord,
  CoreHrEmployee,
  CoreHrSchedule,
  CorePayrollEntry,
  CorePayrollPeriod,
} from "../types/hrCoreApi";
import {
  calculateAttendanceDisciplineDay,
  summarizeAttendanceDisciplineMonth,
  type AttendanceDisciplineDaySummary,
} from "../helpers/hr/attendanceDiscipline";
import {
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
  approvedAt?: string | null;
  paidAt?: string | null;
  auditLog?: Array<Record<string, unknown>>;
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

export function payrollMonthBounds(year: number, month: number) {
  const start = `${year}-${pad(month)}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`;
  return { payrollMonth: payrollMonthKey(year, month), monthStart: start, monthEnd: end };
}

function dateKeysInMonth(year: number, month: number) {
  const endDate = new Date(Date.UTC(year, month, 0));
  const count = endDate.getUTCDate();
  return Array.from({ length: count }, (_, index) => `${year}-${pad(month)}-${pad(index + 1)}`);
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

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function boolValue(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function isPayrollSetupMissingKey(value: string): value is PayrollSetupMissingKey {
  return ["employeeId", "baseSalary", "workDays", "monthlyHours", "overtimeMultiplier"].includes(value);
}

function asMonthlyHoursSource(value: string): PayrollMonthlyHoursSource | null {
  return ["configured_monthly_hours", "configured_daily_hours", "saved_snapshot", "missing"].includes(value)
    ? (value as PayrollMonthlyHoursSource)
    : null;
}

function employmentOf(employee: CoreHrEmployee) {
  return (employee.employment || {}) as Record<string, unknown>;
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
    const sampleDate = dateKeysInMonth(year, month).find((date) => jsDateFromKey(date).getUTCDay() === Number(schedule.weekday));
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

function scheduleForDate(employee: CoreHrEmployee, dateKey: string) {
  const weekday = jsDateFromKey(dateKey).getUTCDay();
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
  return {
    enabled: true,
    start: text(employment.shift_start_time ?? employment.shiftStartTime) || DEFAULT_SHIFT_START,
    end: text(employment.shift_end_time ?? employment.shiftEndTime) || DEFAULT_SHIFT_END,
  };
}

function groupAttendance(records: CoreAttendanceRecord[]) {
  const map = new Map<string, CoreAttendanceRecord[]>();
  for (const record of records) {
    const key = `${record.employeeId}:${record.dateKey}`;
    const list = map.get(key) || [];
    list.push(record);
    map.set(key, list);
  }
  return map;
}

function attendanceSummaryForEmployee(input: {
  employee: CoreHrEmployee;
  records: CoreAttendanceRecord[];
  year: number;
  month: number;
}) {
  const days: AttendanceDisciplineDaySummary[] = [];
  const dates = dateKeysInMonth(input.year, input.month);
  const recordsByDate = new Map<string, CoreAttendanceRecord[]>();
  for (const record of input.records) {
    if (!record.dateKey.startsWith(payrollMonthKey(input.year, input.month))) continue;
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
        checkInAt: firstCheckIn?.recordedAt,
        checkOutAt: lastCheckOut?.recordedAt,
        isAbsent: schedule.enabled && !records.length,
      })
    );
  }

  return {
    days,
    summary: summarizeAttendanceDisciplineMonth(days) as PayrollAttendanceSummarySnapshot,
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
    overtimeEnabled: input.existing?.overtimeEnabled || false,
    overtimeMultiplier: input.existing?.overtimeMultiplier || employeeOvertimeMultiplier(input.employee),
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
  const attendanceSummary = readJson<PayrollAttendanceSummarySnapshot>(
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
  );
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
  const { payrollMonth } = payrollMonthBounds(input.year, input.month);
  const [employees, attendance] = await Promise.all([
    CoreHrService.listEmployees({ status: "active" }),
    CoreHrService.listAttendance(),
  ]);
  const existingMap = new Map(
    (input.currentEntries || [])
      .filter((entry) => entry.payrollMonth === payrollMonth)
      .map((entry) => [entry.employeeId, entry])
  );
  const attendanceByEmployeeDate = groupAttendance(
    attendance.filter((record) => record.dateKey.startsWith(payrollMonth))
  );

  const generated = employees
    .filter((employee) => !input.employeeId || employee.id === input.employeeId)
    .map((employee) => {
      const employeeRecords = Array.from(attendanceByEmployeeDate.entries())
        .filter(([key]) => key.startsWith(`${employee.id}:`))
        .flatMap(([, records]) => records);
      const attendanceSnapshot = attendanceSummaryForEmployee({
        employee,
        records: employeeRecords,
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
