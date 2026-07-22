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
  totalCompensatedLateHours: number;
  totalMissingHours: number;
  totalExtraHours: number;
  attendanceDays: number;
  absentDays: number;
  incompleteDays: number;
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
  missingHoursDeductionHalalas: number;
  grossSalaryHalalas: number;
  totalAdditionsHalalas: number;
  totalDeductionsHalalas: number;
  netSalaryHalalas: number;
  finalSalaryHalalas: number;
  status: PayrollStatus;
  notes?: string | null;
};

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

function positive(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function roundHalalas(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
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

export function calculatePayrollSnapshot(input: PayrollCalculationInput): PayrollSnapshot {
  const baseSalaryHalalas = money(input.baseSalaryHalalas);
  const allowancesHalalas = money(input.allowancesHalalas);
  const workDays = positive(input.workDays, 1);
  const monthlyHours = hours(input.monthlyHours);
  const dailyScheduledHours = positive(
    input.dailyScheduledHours,
    monthlyHours > 0 ? monthlyHours / workDays : 0
  );
  const dailyRateHalalas = roundHalalas(baseSalaryHalalas / workDays);
  const hourlyRateHalalas =
    monthlyHours > 0
      ? roundHalalas(baseSalaryHalalas / monthlyHours)
      : dailyScheduledHours > 0
        ? roundHalalas(dailyRateHalalas / dailyScheduledHours)
        : 0;

  const attendanceSummary: PayrollAttendanceSummarySnapshot = {
    totalScheduledHours: hours(input.attendanceSummary.totalScheduledHours),
    totalActualWorkedHours: hours(input.attendanceSummary.totalActualWorkedHours),
    totalLateHours: hours(input.attendanceSummary.totalLateHours),
    totalCompensatedLateHours: hours(input.attendanceSummary.totalCompensatedLateHours),
    totalMissingHours: hours(input.attendanceSummary.totalMissingHours),
    totalExtraHours: hours(input.attendanceSummary.totalExtraHours),
    attendanceDays: Math.max(0, Math.round(Number(input.attendanceSummary.attendanceDays || 0))),
    absentDays: Math.max(0, Math.round(Number(input.attendanceSummary.absentDays || 0))),
    incompleteDays: Math.max(0, Math.round(Number(input.attendanceSummary.incompleteDays || 0))),
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

  const missingHoursDeductionHalalas = roundHalalas(
    attendanceSummary.totalMissingHours * hourlyRateHalalas
  );
  const detectedExtraHours = attendanceSummary.totalExtraHours;
  const overtimeEnabled = input.overtimeEnabled === true;
  const financialOvertimeHours = overtimeEnabled ? detectedExtraHours : 0;
  const overtimeMultiplier = positive(input.overtimeMultiplier, 1.5);
  const overtimeValueHalalas = roundHalalas(
    financialOvertimeHours * hourlyRateHalalas * overtimeMultiplier
  );

  const totalAdditionsHalalas =
    allowancesHalalas + manualAdditionsHalalas + overtimeValueHalalas;
  const grossSalaryHalalas = baseSalaryHalalas + totalAdditionsHalalas;
  const totalDeductionsHalalas =
    missingHoursDeductionHalalas + manualDeductionsHalalas;
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
    missingHoursDeductionHalalas,
    grossSalaryHalalas,
    totalAdditionsHalalas,
    totalDeductionsHalalas,
    netSalaryHalalas,
    finalSalaryHalalas: netSalaryHalalas,
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
