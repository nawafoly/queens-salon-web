
export function payrollMonthBounds(year: number, month: number) {
  const normalizedMonth = Math.max(1, Math.min(12, Math.trunc(Number(month) || 1)));
  const payYear = Math.trunc(Number(year) || new Date().getFullYear());

  const currentMonth = String(normalizedMonth).padStart(2, "0");
  const previousMonthDate = new Date(Date.UTC(payYear, normalizedMonth - 2, 1));
  const previousYear = previousMonthDate.getUTCFullYear();
  const previousMonth = String(previousMonthDate.getUTCMonth() + 1).padStart(2, "0");

  const periodStart = `${previousYear}-${previousMonth}-21`;
  const periodEnd = `${payYear}-${currentMonth}-20`;
  const payrollMonth = `${payYear}-${currentMonth}`;
  const payDate = `${payYear}-${currentMonth}-28`;

  return {
    payrollMonth,
    monthStart: periodStart,
    monthEnd: periodEnd,
    periodStart,
    periodEnd,
    payDate,
    payoutDate: payDate,
  };
}
export type PayrollStatus = "draft" | "reviewed" | "approved" | "paid";

export type PayrollManualItemKind =
  | "bonus"
  | "allowance"
  | "commission"
  | "manual_addition"
  | "advance"
  | "penalty"
  | "manual_deduction"
  | "other_deduction";

export type PayrollManualItem = {
  id: string;
  direction: "addition" | "deduction";
  kind: PayrollManualItemKind;
  amountHalalas: number;
  reason: string;
  note?: string;
  addedBy?: string;
  addedAt: string;
};

export type PayrollAttendanceSummarySnapshot = {
  totalScheduledHours: number;
  totalActualWorkedHours: number;
  totalLateHours: number;
  totalEarlyLeaveHours?: number;
  totalCompensatedLateHours: number;
  totalRawMissingHours?: number;
  totalPermissionRequestedHours?: number;
  totalPermissionCoveredHours?: number;
  totalMissingHours: number;
  totalExtraHours: number;
  attendanceDays: number;
  absentDays: number;
  incompleteDays: number;
  approvedLeaveDays?: number;
  approvedAbsenceDays?: number;
  attendanceRecordCount?: number;
  attendanceLinkStatus?: "confirmed" | "unlinked" | "not_ready";
  attendanceDeductionEligible?: boolean;
  attendanceDeductionNote?: string | null;
  attendanceNotes?: string[];
};

export type PayrollSetupMissingKey =
  | "employeeId"
  | "baseSalary"
  | "workDays"
  | "monthlyHours"
  | "overtimeMultiplier";

export type PayrollMonthlyHoursSource =
  | "configured_monthly_hours"
  | "configured_daily_hours"
  | "saved_snapshot"
  | "missing";

export type PayrollSetupSnapshot = {
  complete: boolean;
  missing: PayrollSetupMissingKey[];
  monthlyHoursSource: PayrollMonthlyHoursSource;
};

export type PayrollCalculationInput = {
  employeeId: string;
  employeeName: string;
  jobTitle?: string | null;
  payrollMonth: string;
  baseSalaryHalalas: number;
  allowancesHalalas?: number;
  workDays: number;
  monthlyHours?: number | null;
  dailyScheduledHours?: number | null;
  attendanceSummary: PayrollAttendanceSummarySnapshot;
  additions?: PayrollManualItem[];
  deductions?: PayrollManualItem[];
  overtimeEnabled?: boolean;
  overtimeMultiplier?: number;
  monthlyHoursSource?: PayrollMonthlyHoursSource | null;
  status?: PayrollStatus;
  notes?: string | null;
};

export type PayrollSnapshot = {
  employeeId: string;
  employeeName: string;
  jobTitle?: string | null;
  payrollMonth: string;
  baseSalaryHalalas: number;
  allowancesHalalas: number;
  workDays: number;
  monthlyHours: number;
  dailyScheduledHours: number;
  dailyRateHalalas: number;
  hourlyRateHalalas: number;
  attendanceSummary: PayrollAttendanceSummarySnapshot;
  detectedExtraHours: number;
  overtimeEnabled: boolean;
  financialOvertimeHours: number;
  overtimeMultiplier: number;
  overtimeValueHalalas: number;
  additions: PayrollManualItem[];
  deductions: PayrollManualItem[];
  manualAdditionsHalalas: number;
  manualDeductionsHalalas: number;
  advancesHalalas: number;
  absenceDeductionHalalas: number;
  missingHoursDeductionHalalas: number;
  grossSalaryHalalas: number;
  totalAdditionsHalalas: number;
  totalDeductionsHalalas: number;
  netSalaryHalalas: number;
  finalSalaryHalalas: number;
  payrollSetupComplete: boolean;
  payrollSetupMissing: PayrollSetupMissingKey[];
  monthlyHoursSource: PayrollMonthlyHoursSource;
  status: PayrollStatus;
  notes?: string | null;
};

export const ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE =
  "لم يتم تطبيق خصم الحضور لأن ربط البصمات غير مكتمل أو غير مؤكد.";

export const ATTENDANCE_UNCONFIRMED_REPORT_NOTE =
  "الحضور غير مربوط/غير مؤكد، لم يتم تطبيق خصم حضور تلقائي.";

function money(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function hours(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function days(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function positive(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function roundHalalas(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function clampHours(value: number, max: number) {
  if (!Number.isFinite(max) || max <= 0) return value;
  return Math.min(value, Math.round(max * 100) / 100);
}

export function isPayrollSnapshotLocked(status?: string | null) {
  return status === "approved" || status === "paid";
}

export function assertManualPayrollItem(item: Pick<PayrollManualItem, "amountHalalas" | "reason">) {
  if (money(item.amountHalalas) <= 0) {
    throw new Error("manual_payroll_item_amount_required");
  }
  if (!String(item.reason || "").trim()) {
    throw new Error("manual_payroll_item_reason_required");
  }
}

export function evaluatePayrollSetup(input: {
  employeeId?: string | null;
  baseSalaryHalalas?: unknown;
  workDays?: unknown;
  monthlyHours?: unknown;
  dailyScheduledHours?: unknown;
  overtimeMultiplier?: unknown;
  monthlyHoursSource?: PayrollMonthlyHoursSource | null;
}): PayrollSetupSnapshot {
  const missing: PayrollSetupMissingKey[] = [];
  const employeeId = String(input.employeeId || "").trim();
  const baseSalaryHalalas = money(input.baseSalaryHalalas);
  const workDays = hours(input.workDays);
  const monthlyHours = hours(input.monthlyHours);
  const dailyScheduledHours = hours(input.dailyScheduledHours);

  if (!employeeId) missing.push("employeeId");
  if (baseSalaryHalalas <= 0) missing.push("baseSalary");
  if (workDays <= 0) missing.push("workDays");
  if (monthlyHours <= 0 && dailyScheduledHours <= 0) missing.push("monthlyHours");

  const configuredSource =
    input.monthlyHoursSource && input.monthlyHoursSource !== "missing"
      ? input.monthlyHoursSource
      : null;
  const monthlyHoursSource: PayrollMonthlyHoursSource =
    monthlyHours > 0
      ? configuredSource || "configured_monthly_hours"
      : dailyScheduledHours > 0
        ? "configured_daily_hours"
        : "missing";

  return {
    complete: missing.length === 0,
    missing,
    monthlyHoursSource,
  };
}

export function calculatePayrollSnapshot(input: PayrollCalculationInput): PayrollSnapshot {
  const baseSalaryHalalas = money(input.baseSalaryHalalas);
  const allowancesHalalas = money(input.allowancesHalalas);
  const workDays = hours(input.workDays);
  const configuredMonthlyHours = hours(input.monthlyHours);
  const explicitDailyScheduledHours = hours(input.dailyScheduledHours);
  const dailyScheduledHours =
    explicitDailyScheduledHours > 0
      ? explicitDailyScheduledHours
      : configuredMonthlyHours > 0 && workDays > 0
        ? Math.round((configuredMonthlyHours / workDays) * 100) / 100
        : 0;
  const monthlyHours =
    configuredMonthlyHours > 0
      ? configuredMonthlyHours
      : workDays > 0 && dailyScheduledHours > 0
        ? Math.round(workDays * dailyScheduledHours * 100) / 100
        : 0;
  const payrollSetup = evaluatePayrollSetup({
    employeeId: input.employeeId,
    baseSalaryHalalas,
    workDays,
    monthlyHours: configuredMonthlyHours,
    dailyScheduledHours: explicitDailyScheduledHours,
    overtimeMultiplier: input.overtimeMultiplier,
    monthlyHoursSource: input.monthlyHoursSource,
  });
  const dailyRateHalalas = workDays > 0 ? roundHalalas(baseSalaryHalalas / workDays) : 0;
  const hourlyRateHalalas =
    monthlyHours > 0
      ? roundHalalas(baseSalaryHalalas / monthlyHours)
      : dailyScheduledHours > 0
        ? roundHalalas(dailyRateHalalas / dailyScheduledHours)
        : 0;

  const rawAttendanceMissingHours = hours(input.attendanceSummary.totalMissingHours);
  const maxDeductiblePeriodHours =
    monthlyHours > 0
      ? monthlyHours
      : hours(input.attendanceSummary.totalScheduledHours);
  const attendanceDeductionEligible = input.attendanceSummary.attendanceDeductionEligible !== false;
  const attendanceDeductionNote =
    input.attendanceSummary.attendanceDeductionNote ||
    (attendanceDeductionEligible ? null : ATTENDANCE_DEDUCTION_NOT_APPLIED_NOTE);

  const attendanceSummary: PayrollAttendanceSummarySnapshot = {
    totalScheduledHours: hours(input.attendanceSummary.totalScheduledHours),
    totalActualWorkedHours: hours(input.attendanceSummary.totalActualWorkedHours),
    totalLateHours: hours(input.attendanceSummary.totalLateHours),
    totalEarlyLeaveHours: hours(input.attendanceSummary.totalEarlyLeaveHours),
    totalCompensatedLateHours: hours(input.attendanceSummary.totalCompensatedLateHours),
    totalMissingHours: clampHours(rawAttendanceMissingHours, maxDeductiblePeriodHours),
    totalExtraHours: hours(input.attendanceSummary.totalExtraHours),
    attendanceDays: Math.max(0, Math.round(Number(input.attendanceSummary.attendanceDays || 0))),
    absentDays: days(input.attendanceSummary.absentDays),
    incompleteDays: Math.max(0, Math.round(Number(input.attendanceSummary.incompleteDays || 0))),
    approvedLeaveDays: days(input.attendanceSummary.approvedLeaveDays),
    approvedAbsenceDays: days(input.attendanceSummary.approvedAbsenceDays),
    attendanceRecordCount: Math.max(0, Math.round(Number(input.attendanceSummary.attendanceRecordCount || 0))),
    attendanceLinkStatus:
      input.attendanceSummary.attendanceLinkStatus ||
      (attendanceDeductionEligible ? "confirmed" : "unlinked"),
    attendanceDeductionEligible,
    attendanceDeductionNote,
    attendanceNotes: Array.isArray(input.attendanceSummary.attendanceNotes)
      ? input.attendanceSummary.attendanceNotes.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
  };

  const additions = (input.additions || []).map((item) => ({
    ...item,
    amountHalalas: money(item.amountHalalas),
    reason: String(item.reason || "").trim(),
  }));
  const deductions = (input.deductions || []).map((item) => ({
    ...item,
    amountHalalas: money(item.amountHalalas),
    reason: String(item.reason || "").trim(),
  }));

  const manualAdditionsHalalas = additions.reduce(
    (total, item) => total + money(item.amountHalalas),
    0
  );
  const manualDeductionsHalalas = deductions.reduce(
    (total, item) => total + money(item.amountHalalas),
    0
  );
  const advancesHalalas = deductions
    .filter((item) => item.kind === "advance")
    .reduce((total, item) => total + money(item.amountHalalas), 0);

  const missingHoursDeductionHalalas =
    attendanceDeductionEligible
      ? roundHalalas(attendanceSummary.totalMissingHours * hourlyRateHalalas)
      : 0;
  const absenceDeductionHalalas =
    payrollSetup.complete && dailyRateHalalas > 0
      ? roundHalalas((attendanceSummary.approvedAbsenceDays || 0) * dailyRateHalalas)
      : 0;
  const detectedExtraHours = attendanceSummary.totalExtraHours;
  const overtimeEnabled =
    input.overtimeEnabled === true &&
    payrollSetup.complete &&
    detectedExtraHours > 0 &&
    hourlyRateHalalas > 0;
  const financialOvertimeHours = overtimeEnabled ? detectedExtraHours : 0;
  const overtimeMultiplier = positive(input.overtimeMultiplier, 1.5);
  const overtimeValueHalalas = roundHalalas(
    financialOvertimeHours * hourlyRateHalalas * overtimeMultiplier
  );

  const totalAdditionsHalalas =
    allowancesHalalas + manualAdditionsHalalas + overtimeValueHalalas;
  const grossSalaryHalalas = baseSalaryHalalas + totalAdditionsHalalas;
  const totalDeductionsHalalas =
    absenceDeductionHalalas + missingHoursDeductionHalalas + manualDeductionsHalalas;
  const netSalaryHalalas = Math.max(0, grossSalaryHalalas - totalDeductionsHalalas);

  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    jobTitle: input.jobTitle || null,
    payrollMonth: input.payrollMonth,
    baseSalaryHalalas,
    allowancesHalalas,
    workDays,
    monthlyHours,
    dailyScheduledHours,
    dailyRateHalalas,
    hourlyRateHalalas,
    attendanceSummary,
    detectedExtraHours,
    overtimeEnabled,
    financialOvertimeHours,
    overtimeMultiplier,
    overtimeValueHalalas,
    additions,
    deductions,
    manualAdditionsHalalas,
    manualDeductionsHalalas,
    advancesHalalas,
    absenceDeductionHalalas,
    missingHoursDeductionHalalas,
    grossSalaryHalalas,
    totalAdditionsHalalas,
    totalDeductionsHalalas,
    netSalaryHalalas,
    finalSalaryHalalas: netSalaryHalalas,
    payrollSetupComplete: payrollSetup.complete,
    payrollSetupMissing: payrollSetup.missing,
    monthlyHoursSource: payrollSetup.monthlyHoursSource,
    status: input.status || "draft",
    notes: input.notes || null,
  };
}

export function preserveLockedPayrollSnapshot<T extends { status?: string | null }>(
  existing: T | null | undefined,
  nextSnapshot: T
) {
  return existing && isPayrollSnapshotLocked(existing.status) ? existing : nextSnapshot;
}

export function halalasToRiyals(value: unknown) {
  return money(value) / 100;
}

export function riyalsToHalalas(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100);
}

export function formatPayrollMoney(value: unknown) {
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 2,
  }).format(halalasToRiyals(value));
}

