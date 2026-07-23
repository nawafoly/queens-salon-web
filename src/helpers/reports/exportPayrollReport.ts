import type { PayrollEntryView } from "../../services/CorePayrollService.ts";
import type { PayrollSetupMissingKey } from "../hr/payrollCalculations.ts";
import {
  currentGeneratedAt,
  exportReportToExcel,
  exportReportToPdf,
  formatCurrency,
  formatDateTime,
  formatMonthPeriod,
  halalasToRiyalsNumber,
  normalizeGeneratedBy,
  safeText,
  type ExportReport,
  type ReportColumn,
  type ReportSummaryItem,
} from "./common.ts";
import { formatAttendanceHours } from "../hr/attendanceDiscipline.ts";

type PayrollReportRow = {
  employeeName: string;
  setupStatus: string;
  baseSalary: string | number;
  workDays: string | number;
  monthlyHours: string;
  dailyRate: string | number;
  hourlyRate: string | number;
  missingHours: string;
  missingDeduction: string | number;
  detectedExtraHours: string;
  overtimeFinancialStatus: string;
  overtimeValue: string | number;
  additions: string | number;
  deductions: string | number;
  netSalary: string | number;
  salaryStatus: string;
  approvedAt: string;
  paidAt: string;
  notes: string;
};

type PayrollExcludedRow = {
  employeeName: string;
  reason: string;
};

type PayslipRow = {
  item: string;
  value: string | number;
};

export type PayrollReportFilters = {
  year: number;
  month: number;
  employeeName?: string;
  statusLabel?: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  reviewed: "تمت المراجعة",
  approved: "معتمد",
  paid: "مدفوع",
};

const MISSING_LABELS: Record<PayrollSetupMissingKey, string> = {
  employeeId: "معرف الموظفة غير محدد",
  baseSalary: "الراتب الأساسي غير محدد",
  workDays: "أيام العمل غير محددة",
  monthlyHours: "ساعات الشهر غير محددة",
  overtimeMultiplier: "معامل الأوفر تايم غير محدد",
};

const PAYROLL_COLUMNS: ReportColumn<PayrollReportRow>[] = [
  { key: "employeeName", header: "الموظفة", width: 24 },
  { key: "setupStatus", header: "حالة إعداد الراتب", width: 20 },
  { key: "baseSalary", header: "الراتب الأساسي", width: 18 },
  { key: "workDays", header: "أيام العمل", width: 13 },
  { key: "monthlyHours", header: "ساعات الشهر", width: 14 },
  { key: "dailyRate", header: "راتب اليوم", width: 16 },
  { key: "hourlyRate", header: "راتب الساعة", width: 16 },
  { key: "missingHours", header: "نقص الساعات", width: 15 },
  { key: "missingDeduction", header: "قيمة خصم النقص", width: 18 },
  { key: "detectedExtraHours", header: "الساعات الزائدة المكتشفة", width: 20 },
  { key: "overtimeFinancialStatus", header: "الأوفر تايم المالي", width: 18 },
  { key: "overtimeValue", header: "قيمة الأوفر تايم", width: 18 },
  { key: "additions", header: "الإضافات", width: 16 },
  { key: "deductions", header: "الخصومات", width: 16 },
  { key: "netSalary", header: "صافي الراتب", width: 18 },
  { key: "salaryStatus", header: "حالة الراتب", width: 16 },
  { key: "approvedAt", header: "تاريخ الاعتماد", width: 20 },
  { key: "paidAt", header: "تاريخ الدفع", width: 20 },
  { key: "notes", header: "ملاحظات", width: 28 },
];

const EXCLUDED_PAYROLL_COLUMNS: ReportColumn<PayrollExcludedRow>[] = [
  { key: "employeeName", header: "الموظفة", width: 28 },
  { key: "reason", header: "سبب الاستبعاد", width: 44 },
];

function statusLabel(status?: string | null) {
  return STATUS_LABELS[String(status || "")] || safeText(status, "غير متوفر");
}

function setupMissingLabels(entry: Pick<PayrollEntryView, "payrollSetupMissing">) {
  return entry.payrollSetupMissing.map((key) => MISSING_LABELS[key] || key);
}

export function payrollExportExclusionReason(entry: PayrollEntryView) {
  const reasons: string[] = [];
  if (!entry.payrollSetupComplete) {
    const missing = setupMissingLabels(entry);
    reasons.push(missing.length ? `إعداد الراتب غير مكتمل: ${missing.join("، ")}` : "إعداد الراتب غير مكتمل");
  }
  if (!(entry.baseSalaryHalalas > 0)) {
    reasons.push("الراتب الأساسي غير محدد");
  }
  if (!Number.isFinite(Number(entry.netSalaryHalalas)) || Number(entry.netSalaryHalalas) <= 0) {
    reasons.push("صافي الراتب غير قابل للصرف");
  }
  return reasons.join("، ");
}

export function isPayrollExportEligible(entry: PayrollEntryView) {
  return !payrollExportExclusionReason(entry);
}

function riyalsOrIncomplete(entry: PayrollEntryView, value: unknown) {
  return entry.payrollSetupComplete ? halalasToRiyalsNumber(value) : "غير مكتمل";
}

function baseSalaryValue(entry: PayrollEntryView) {
  if (entry.baseSalaryHalalas > 0) return halalasToRiyalsNumber(entry.baseSalaryHalalas);
  return "غير مكتمل";
}

function workDaysValue(entry: PayrollEntryView) {
  return entry.workDays > 0 ? entry.workDays : "غير مكتمل";
}

function hoursValue(value: unknown, fallback = "غير متوفر") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return formatAttendanceHours(number);
}

function setupNotes(entry: PayrollEntryView) {
  const notes = [entry.notes || ""];
  if (!entry.payrollSetupComplete) {
    notes.push(`غير مكتمل: ${setupMissingLabels(entry).join("، ")}`);
  }
  return notes.map((item) => String(item || "").trim()).filter(Boolean).join(" | ");
}

function buildPayrollRows(entries: PayrollEntryView[]): PayrollReportRow[] {
  return entries.map((entry) => ({
    employeeName: safeText(entry.employeeName),
    setupStatus: entry.payrollSetupComplete ? "مكتمل" : "غير مكتمل",
    baseSalary: baseSalaryValue(entry),
    workDays: workDaysValue(entry),
    monthlyHours: entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "غير مكتمل",
    dailyRate: riyalsOrIncomplete(entry, entry.dailyRateHalalas),
    hourlyRate: riyalsOrIncomplete(entry, entry.hourlyRateHalalas),
    missingHours: hoursValue(entry.attendanceSummary.totalMissingHours),
    missingDeduction: riyalsOrIncomplete(entry, entry.missingHoursDeductionHalalas),
    detectedExtraHours: hoursValue(entry.detectedExtraHours),
    overtimeFinancialStatus: entry.overtimeEnabled ? "مفعل" : "غير مفعل",
    overtimeValue: riyalsOrIncomplete(entry, entry.overtimeValueHalalas),
    additions: entry.payrollSetupComplete ? halalasToRiyalsNumber(entry.totalAdditionsHalalas) : "غير مكتمل",
    deductions: riyalsOrIncomplete(entry, entry.totalDeductionsHalalas),
    netSalary: riyalsOrIncomplete(entry, entry.netSalaryHalalas),
    salaryStatus: statusLabel(entry.status),
    approvedAt: formatDateTime(entry.approvedAt),
    paidAt: formatDateTime(entry.paidAt),
    notes: setupNotes(entry),
  }));
}

function payrollSummary(
  entries: PayrollEntryView[],
  filters: PayrollReportFilters,
  options?: { includeIncomplete?: boolean; originalCount?: number; excludedRows?: PayrollExcludedRow[] }
): ReportSummaryItem[] {
  const completeEntries = entries.filter((entry) => entry.payrollSetupComplete);
  const exportedCount = entries.length;
  const originalCount = options?.originalCount ?? entries.length;
  const excludedCount = options?.excludedRows?.length ?? Math.max(0, originalCount - exportedCount);
  return [
    { label: "الشهر/السنة", value: formatMonthPeriod(filters.year, filters.month) },
    { label: options?.includeIncomplete ? "عدد الموظفات" : "عدد الموظفات المصدّرة", value: exportedCount },
    ...(options?.includeIncomplete
      ? []
      : [
          { label: "عدد المستبعدات من التصدير", value: excludedCount },
          { label: "نطاق التصدير", value: "الموظفات النشطات ذات إعداد راتب مكتمل وصافي راتب قابل للصرف" },
        ]),
    { label: "عدد المكتمل", value: completeEntries.length },
    { label: "عدد غير المكتمل", value: entries.length - completeEntries.length },
    { label: "عدد المعتمد", value: entries.filter((entry) => entry.status === "approved").length },
    { label: "عدد المدفوع", value: entries.filter((entry) => entry.status === "paid").length },
    {
      label: "إجمالي الرواتب الأساسية",
      value: halalasToRiyalsNumber(completeEntries.reduce((sum, entry) => sum + entry.baseSalaryHalalas, 0)),
    },
    {
      label: "إجمالي الإضافات",
      value: halalasToRiyalsNumber(completeEntries.reduce((sum, entry) => sum + entry.totalAdditionsHalalas, 0)),
    },
    {
      label: "إجمالي الخصومات",
      value: halalasToRiyalsNumber(completeEntries.reduce((sum, entry) => sum + entry.totalDeductionsHalalas, 0)),
    },
    {
      label: "إجمالي صافي الرواتب",
      value: halalasToRiyalsNumber(completeEntries.reduce((sum, entry) => sum + entry.netSalaryHalalas, 0)),
    },
  ];
}

function excludedRowFor(entry: PayrollEntryView): PayrollExcludedRow {
  return {
    employeeName: entry.employeeName || entry.employeeId || "غير متوفر",
    reason: payrollExportExclusionReason(entry) || "غير قابل للتصدير",
  };
}

function noEligiblePayrollRow(): PayrollReportRow {
  return {
    employeeName: "لا توجد رواتب مكتملة قابلة للتصدير لهذه الفترة.",
    setupStatus: "غير متوفر",
    baseSalary: "غير متوفر",
    workDays: "غير متوفر",
    monthlyHours: "غير متوفر",
    dailyRate: "غير متوفر",
    hourlyRate: "غير متوفر",
    missingHours: "غير متوفر",
    missingDeduction: "غير متوفر",
    detectedExtraHours: "غير متوفر",
    overtimeFinancialStatus: "غير متوفر",
    overtimeValue: "غير متوفر",
    additions: "غير متوفر",
    deductions: "غير متوفر",
    netSalary: "غير متوفر",
    salaryStatus: "غير متوفر",
    approvedAt: "غير متوفر",
    paidAt: "غير متوفر",
    notes: "لا توجد رواتب مكتملة قابلة للتصدير لهذه الفترة.",
  };
}

export function buildPayrollReportData(input: {
  entries: PayrollEntryView[];
  filters: PayrollReportFilters;
  includeIncomplete?: boolean;
  originalCount?: number;
  excludedRows?: PayrollExcludedRow[];
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
}): ExportReport<PayrollReportRow> {
  const monthPeriod = formatMonthPeriod(input.filters.year, input.filters.month);
  const employee = safeText(input.filters.employeeName, "كل الموظفات");
  const status = safeText(input.filters.statusLabel, "كل الحالات");
  const includeIncomplete = Boolean(input.includeIncomplete);
  const exportedEntries = includeIncomplete ? input.entries : input.entries.filter(isPayrollExportEligible);
  const generatedExcludedRows = includeIncomplete ? [] : input.entries.filter((entry) => !isPayrollExportEligible(entry)).map(excludedRowFor);
  const excludedRows = includeIncomplete ? [] : input.excludedRows ?? generatedExcludedRows;
  const rows = buildPayrollRows(exportedEntries);
  const noEligibleRows = !includeIncomplete && rows.length === 0;
  return {
    title: includeIncomplete ? "تقرير الرواتب الشهري" : "تقرير الرواتب الشهرية - المستحقات الفعلية",
    period: includeIncomplete
      ? `${monthPeriod} - ${employee} - ${status} - يشمل السجلات غير المكتملة`
      : `${monthPeriod} - ${employee} - ${status} - المستحقات الفعلية`,
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    salonName: input.salonName,
    summary: payrollSummary(exportedEntries, input.filters, {
      includeIncomplete,
      originalCount: input.originalCount ?? input.entries.length,
      excludedRows,
    }),
    table: {
      name: "البيانات التفصيلية",
      columns: PAYROLL_COLUMNS,
      rows: rows.length ? rows : noEligibleRows ? [noEligiblePayrollRow()] : rows,
    },
    extraTables: !includeIncomplete && excludedRows.length
      ? [
          {
            name: "السجلات المستبعدة",
            columns: EXCLUDED_PAYROLL_COLUMNS,
            rows: excludedRows,
          },
        ]
      : undefined,
    notes: noEligibleRows
      ? ["لا توجد رواتب مكتملة قابلة للتصدير لهذه الفترة."]
      : includeIncomplete && input.entries.some((entry) => !entry.payrollSetupComplete)
        ? ["يشمل هذا التقرير سجلات غير مكتملة ولا يتم تصدير صافي الراتب كراتب معتمد."]
        : ["يشمل هذا التقرير الموظفات ذات إعداد راتب مكتمل وصافي راتب قابل للصرف فقط."],
  };
}

function payslipValue(entry: PayrollEntryView, value: unknown) {
  return entry.payrollSetupComplete ? formatCurrency(halalasToRiyalsNumber(value)) : "غير مكتمل";
}

function payslipRows(entry: PayrollEntryView): PayslipRow[] {
  const draftNotice = entry.status === "approved" || entry.status === "paid" ? "" : "مسودة غير معتمدة";
  const rows: PayslipRow[] = [
    { item: "اسم الموظفة", value: safeText(entry.employeeName) },
    { item: "رقم الموظفة", value: safeText(entry.employeeId) },
    { item: "الشهر/السنة", value: entry.payrollMonth },
    { item: "حالة الراتب", value: statusLabel(entry.status) },
    { item: "ملاحظة الاعتماد", value: draftNotice || "معتمد/مدفوع حسب حالة السجل" },
    { item: "الراتب الأساسي", value: entry.baseSalaryHalalas > 0 ? formatCurrency(halalasToRiyalsNumber(entry.baseSalaryHalalas)) : "غير مكتمل" },
    { item: "أيام العمل", value: workDaysValue(entry) },
    { item: "ساعات الشهر", value: entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "غير مكتمل" },
    { item: "راتب اليوم", value: payslipValue(entry, entry.dailyRateHalalas) },
    { item: "راتب الساعة", value: payslipValue(entry, entry.hourlyRateHalalas) },
    { item: "التأخير", value: formatAttendanceHours(entry.attendanceSummary.totalLateHours) },
    { item: "نقص الساعات", value: formatAttendanceHours(entry.attendanceSummary.totalMissingHours) },
    { item: "الساعات الزائدة", value: formatAttendanceHours(entry.detectedExtraHours) },
    { item: "الإضافات", value: payslipValue(entry, entry.totalAdditionsHalalas) },
    { item: "الخصومات", value: payslipValue(entry, entry.totalDeductionsHalalas) },
    { item: "الأوفر تايم", value: entry.overtimeEnabled ? "مفعل" : "غير مفعل" },
    { item: "قيمة الأوفر تايم", value: payslipValue(entry, entry.overtimeValueHalalas) },
    { item: "صافي الراتب", value: payslipValue(entry, entry.netSalaryHalalas) },
    { item: "ملاحظات", value: setupNotes(entry) || "غير متوفر" },
    { item: "توقيع الإدارة", value: "" },
    { item: "توقيع الموظفة", value: "" },
  ];
  return rows;
}

export function buildPayrollPayslipData(input: {
  entry: PayrollEntryView;
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
}): ExportReport<PayslipRow> {
  const entry = input.entry;
  const draftNotice = entry.status === "approved" || entry.status === "paid" ? "" : "مسودة غير معتمدة";
  return {
    title: "كشف راتب موظفة",
    period: entry.payrollMonth,
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    salonName: input.salonName,
    summary: [
      { label: "الموظفة", value: safeText(entry.employeeName) },
      { label: "الشهر/السنة", value: entry.payrollMonth },
      { label: "حالة الراتب", value: statusLabel(entry.status) },
      { label: "صافي الراتب", value: entry.payrollSetupComplete ? halalasToRiyalsNumber(entry.netSalaryHalalas) : "غير مكتمل" },
      { label: "ملاحظة", value: draftNotice || "كشف مبني على snapshot الراتب الحالي" },
    ],
    table: {
      name: "تفاصيل كشف الراتب",
      columns: [
        { key: "item", header: "البند", width: 32 },
        { key: "value", header: "القيمة", width: 36 },
      ],
      rows: payslipRows(entry),
    },
    notes: [
      ...(draftNotice ? [draftNotice] : []),
      ...(!entry.payrollSetupComplete ? ["لا يمكن اعتبار هذا كشف راتب نهائي لأن إعداد الراتب غير مكتمل."] : []),
    ],
  };
}

export function exportPayrollReportPdf(input: Parameters<typeof buildPayrollReportData>[0]) {
  exportReportToPdf(buildPayrollReportData(input), "monthly-payroll-report.pdf");
}

export function exportPayrollReportExcel(input: Parameters<typeof buildPayrollReportData>[0]) {
  exportReportToExcel(buildPayrollReportData(input), "monthly-payroll-report.xlsx");
}

export function exportPayrollPayslipPdf(input: Parameters<typeof buildPayrollPayslipData>[0]) {
  exportReportToPdf(buildPayrollPayslipData(input), "employee-payslip.pdf");
}
