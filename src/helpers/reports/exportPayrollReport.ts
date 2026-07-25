import type { PayrollEntryView } from "../../services/CorePayrollService.ts";
import {
  ATTENDANCE_UNCONFIRMED_REPORT_NOTE,
  type PayrollSetupMissingKey,
} from "../hr/payrollCalculations.ts";
import {
  currentGeneratedAt,
  exportHtmlDocumentToPdf,
  exportReportToExcel,
  exportReportToPdf,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonthPeriod,
  formatPeriod,
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
  payrollPeriod: string;
  setupStatus: string;
  attendanceStatus: string;
  baseSalary: string | number;
  workDays: string | number;
  monthlyHours: string;
  attendanceDays: number;
  absentDays: number;
  incompleteDays: number;
  scheduledHours: string;
  actualWorkedHours: string;
  lateHours: string;
  earlyLeaveHours: string;
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
  periodStartDate?: string;
  periodEndDate?: string;
  payDate?: string;
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
  { key: "payrollPeriod", header: "فترة الاحتساب", width: 24 },
  { key: "setupStatus", header: "حالة إعداد الراتب", width: 18 },
  { key: "attendanceStatus", header: "حالة ربط الحضور", width: 18 },
  { key: "baseSalary", header: "الراتب الأساسي", width: 16 },
  { key: "workDays", header: "أيام العمل", width: 12 },
  { key: "monthlyHours", header: "ساعات الفترة", width: 13 },
  { key: "attendanceDays", header: "أيام الحضور", width: 12 },
  { key: "absentDays", header: "أيام الغياب", width: 12 },
  { key: "incompleteDays", header: "أيام البصمة الناقصة", width: 18 },
  { key: "scheduledHours", header: "الساعات المطلوبة", width: 16 },
  { key: "actualWorkedHours", header: "الساعات الفعلية", width: 14 },
  { key: "lateHours", header: "ساعات التأخير", width: 14 },
  { key: "earlyLeaveHours", header: "ساعات الانصراف المبكر", width: 20 },
  { key: "missingHours", header: "نقص الساعات", width: 13 },
  { key: "missingDeduction", header: "خصم الحضور", width: 14 },
  { key: "additions", header: "الإضافات", width: 14 },
  { key: "deductions", header: "الخصومات", width: 14 },
  { key: "netSalary", header: "صافي الراتب", width: 15 },
  { key: "salaryStatus", header: "حالة الراتب", width: 13 },
  { key: "notes", header: "ملاحظات", width: 24 },
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
  const notes = [entry.notes || "", ...(entry.attendanceSummary.attendanceNotes || [])];
  if (!entry.payrollSetupComplete) {
    notes.push(`غير مكتمل: ${setupMissingLabels(entry).join("، ")}`);
  }
  if (entry.attendanceSummary.attendanceDeductionEligible === false) {
    notes.push(entry.attendanceSummary.attendanceDeductionNote || ATTENDANCE_UNCONFIRMED_REPORT_NOTE);
  }
  return notes.map((item) => String(item || "").trim()).filter(Boolean).join(" | ");
}

function missingDeductionValue(entry: PayrollEntryView) {
  if (!entry.payrollSetupComplete) return "غير مكتمل";
  if (entry.attendanceSummary.attendanceDeductionEligible === false) return "لم يطبق";
  return halalasToRiyalsNumber(entry.missingHoursDeductionHalalas);
}

function attendanceStatusLabel(entry: PayrollEntryView) {
  const status = entry.attendanceSummary.attendanceLinkStatus;
  if (status === "confirmed") {
    return entry.attendanceSummary.incompleteDays > 0 ? "مؤكد - توجد بصمة ناقصة" : "مؤكد";
  }
  if (status === "not_ready") return "غير جاهز";
  return "غير مربوط";
}

function buildPayrollRows(entries: PayrollEntryView[], filters: PayrollReportFilters): PayrollReportRow[] {
  const payrollPeriod =
    filters.periodStartDate && filters.periodEndDate
      ? `${filters.periodStartDate} إلى ${filters.periodEndDate}`
      : formatMonthPeriod(filters.year, filters.month);
  return entries.map((entry) => ({
    employeeName: safeText(entry.employeeName),
    payrollPeriod,
    setupStatus: entry.payrollSetupComplete ? "مكتمل" : "غير مكتمل",
    attendanceStatus: attendanceStatusLabel(entry),
    baseSalary: baseSalaryValue(entry),
    workDays: workDaysValue(entry),
    monthlyHours: entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "غير مكتمل",
    attendanceDays: entry.attendanceSummary.attendanceDays,
    absentDays: entry.attendanceSummary.absentDays,
    incompleteDays: entry.attendanceSummary.incompleteDays,
    scheduledHours: hoursValue(entry.attendanceSummary.totalScheduledHours),
    actualWorkedHours: hoursValue(entry.attendanceSummary.totalActualWorkedHours),
    lateHours: hoursValue(entry.attendanceSummary.totalLateHours),
    earlyLeaveHours: hoursValue(entry.attendanceSummary.totalEarlyLeaveHours),
    dailyRate: riyalsOrIncomplete(entry, entry.dailyRateHalalas),
    hourlyRate: riyalsOrIncomplete(entry, entry.hourlyRateHalalas),
    missingHours: hoursValue(entry.attendanceSummary.totalMissingHours),
    missingDeduction: missingDeductionValue(entry),
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

function payrollCycleText(filters: PayrollReportFilters) {
  if (filters.periodStartDate && filters.periodEndDate) {
    return `${formatMonthPeriod(filters.year, filters.month)} | فترة الاحتساب: ${formatPeriod(filters.periodStartDate, filters.periodEndDate)}`;
  }
  return formatMonthPeriod(filters.year, filters.month);
}

function payrollPeriodLine(filters: PayrollReportFilters, employee: string, status: string, includeIncomplete: boolean) {
  const scope = includeIncomplete ? "يشمل غير المكتمل للمراجعة الداخلية" : "الموظفات ذات إعداد راتب مكتمل";
  const payDate = filters.payDate ? ` | تاريخ الصرف المتوقع: ${formatDate(filters.payDate)}` : "";
  return `${payrollCycleText(filters)}${payDate} - ${employee} - ${status} - ${scope}`;
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
    ...(filters.periodStartDate && filters.periodEndDate
      ? [{ label: "فترة الاحتساب", value: formatPeriod(filters.periodStartDate, filters.periodEndDate) }]
      : []),
    ...(filters.payDate ? [{ label: "تاريخ الصرف المتوقع", value: formatDate(filters.payDate) }] : []),
    { label: options?.includeIncomplete ? "عدد الموظفات" : "عدد الموظفات المصدّرة", value: exportedCount },
    ...(options?.includeIncomplete ? [] : [{ label: "عدد المستبعدات من التصدير", value: excludedCount }]),
    {
      label: "نطاق التصدير",
      value: options?.includeIncomplete
        ? "يشمل غير المكتمل للمراجعة الداخلية"
        : "الموظفات ذات إعداد راتب مكتمل",
    },
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
  const employee = safeText(input.filters.employeeName, "كل الموظفات");
  const status = safeText(input.filters.statusLabel, "كل الحالات");
  const includeIncomplete = Boolean(input.includeIncomplete);
  const periodLine = payrollPeriodLine(input.filters, employee, status, includeIncomplete);
  const exportedEntries = includeIncomplete ? input.entries : input.entries.filter(isPayrollExportEligible);
  const generatedExcludedRows = includeIncomplete ? [] : input.entries.filter((entry) => !isPayrollExportEligible(entry)).map(excludedRowFor);
  const excludedRows = includeIncomplete ? [] : input.excludedRows ?? generatedExcludedRows;
  const rows = buildPayrollRows(exportedEntries, input.filters);
  const noEligibleRows = !includeIncomplete && rows.length === 0;
  return {
    title: includeIncomplete ? "مسيرة الرواتب الشهرية - مراجعة داخلية" : "مسيرة الرواتب الشهرية - الموظفات ذات الراتب",
    period: periodLine,
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    salonName: input.salonName,
    summarySheetName: "ملخص الرواتب",
    summary: payrollSummary(exportedEntries, input.filters, {
      includeIncomplete,
      originalCount: input.originalCount ?? input.entries.length,
      excludedRows,
    }),
    table: {
      name: "تفاصيل الرواتب",
      columns: PAYROLL_COLUMNS,
      rows,
      emptyMessage: noEligibleRows
        ? "لا توجد موظفات بإعداد راتب مكتمل قابلة للتصدير لهذه الفترة."
        : "لا توجد بيانات مطابقة للفلاتر الحالية.",
    },
    extraTables: !includeIncomplete && excludedRows.length
      ? [
          {
            name: "المستبعدون",
            columns: EXCLUDED_PAYROLL_COLUMNS,
            rows: excludedRows,
            hideInPdf: true,
          },
        ]
      : undefined,
    notes: noEligibleRows
      ? ["لا توجد موظفات بإعداد راتب مكتمل قابلة للتصدير لهذه الفترة."]
      : includeIncomplete && input.entries.some((entry) => !entry.payrollSetupComplete)
        ? ["يشمل هذا التقرير سجلات غير مكتملة للمراجعة الداخلية فقط."]
        : ["يشمل هذا التقرير الموظفات ذات إعداد راتب مكتمل وراتب أساسي محدد فقط، وفترة الاحتساب المعتمدة هي من يوم 21 إلى يوم 20."],
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
    { item: "ساعات الفترة", value: entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "غير مكتمل" },
    { item: "حالة ربط الحضور", value: attendanceStatusLabel(entry) },
    { item: "أيام الحضور", value: entry.attendanceSummary.attendanceDays },
    { item: "أيام الغياب", value: entry.attendanceSummary.absentDays },
    { item: "أيام البصمة الناقصة", value: entry.attendanceSummary.incompleteDays },
    { item: "الساعات الفعلية", value: formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours) },
    { item: "راتب اليوم", value: payslipValue(entry, entry.dailyRateHalalas) },
    { item: "راتب الساعة", value: payslipValue(entry, entry.hourlyRateHalalas) },
    { item: "التأخير", value: formatAttendanceHours(entry.attendanceSummary.totalLateHours) },
    { item: "الانصراف المبكر", value: formatAttendanceHours(entry.attendanceSummary.totalEarlyLeaveHours || 0) },
    { item: "نقص الساعات", value: formatAttendanceHours(entry.attendanceSummary.totalMissingHours) },
    { item: "خصم الحضور", value: missingDeductionValue(entry) },
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

function escapePayslipHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function payslipStatusNotice(entry: PayrollEntryView) {
  return entry.status === "approved" || entry.status === "paid"
    ? "معتمد/مدفوع حسب حالة السجل"
    : "مسودة غير معتمدة";
}

function payslipMoneyValue(entry: PayrollEntryView, value: unknown) {
  return entry.payrollSetupComplete ? formatCurrency(halalasToRiyalsNumber(value)) : "غير مكتمل";
}

function payslipAttendanceDeduction(entry: PayrollEntryView) {
  if (!entry.payrollSetupComplete) return "غير مكتمل";
  if (entry.attendanceSummary.attendanceDeductionEligible === false) return "لم يطبق";
  return formatCurrency(halalasToRiyalsNumber(entry.missingHoursDeductionHalalas));
}

function payslipMetric(label: string, value: unknown, tone = "") {
  return `<div class="payslip-metric ${tone}"><span>${escapePayslipHtml(label)}</span><strong>${escapePayslipHtml(value)}</strong></div>`;
}

function payslipField(label: string, value: unknown) {
  return `<div class="payslip-field"><span>${escapePayslipHtml(label)}</span><strong>${escapePayslipHtml(value)}</strong></div>`;
}

function payslipSection(title: string, rows: Array<[string, unknown]>) {
  return `
    <section class="payslip-section">
      <h2>${escapePayslipHtml(title)}</h2>
      <div class="payslip-fields">
        ${rows.map(([label, value]) => payslipField(label, value)).join("")}
      </div>
    </section>
  `;
}

export function createPayrollPayslipPdfDocument(input: Parameters<typeof buildPayrollPayslipData>[0]) {
  const entry = input.entry;
  const salonName = input.salonName || "Queens Salon";
  const generatedAt = input.generatedAt || currentGeneratedAt();
  const generatedBy = normalizeGeneratedBy(input.generatedBy);
  const notes = [
    setupNotes(entry),
    ...(!entry.payrollSetupComplete ? ["لا يمكن اعتبار هذا كشف راتب نهائي لأن إعداد الراتب غير مكتمل."] : []),
  ].map((item) => String(item || "").trim()).filter(Boolean);
  const attendanceNotes = (entry.attendanceSummary.attendanceNotes || []).map((item) => String(item || "").trim()).filter(Boolean);
  const title = "كشف راتب موظفة";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapePayslipHtml(title)} - ${escapePayslipHtml(entry.employeeName)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      direction: rtl;
      color: #202635;
      background: #fff;
      font-family: Tahoma, Arial, "Segoe UI", sans-serif;
      font-size: 10.5px;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .payslip-page {
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
    }
    .payslip-header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: start;
      padding: 10px 12px;
      border: 1px solid #ead8df;
      border-radius: 8px;
      background: #fff7fa;
    }
    .payslip-brand {
      color: #8f294f;
      font-size: 17px;
      font-weight: 900;
      line-height: 1.2;
    }
    h1 {
      margin: 4px 0 0;
      color: #202635;
      font-size: 19px;
      line-height: 1.25;
    }
    .payslip-net {
      min-width: 48mm;
      padding: 8px 10px;
      border-radius: 8px;
      background: #8f294f;
      color: #fff;
      text-align: center;
    }
    .payslip-net span,
    .payslip-metric span,
    .payslip-field span {
      display: block;
      font-size: 9px;
      font-weight: 800;
      color: #6d7586;
    }
    .payslip-net span { color: #ffe7f0; }
    .payslip-net strong {
      display: block;
      margin-top: 3px;
      font-size: 18px;
      line-height: 1.25;
    }
    .payslip-meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin: 8px 0;
    }
    .payslip-metric,
    .payslip-field {
      min-width: 0;
      padding: 6px 7px;
      border: 1px solid #e3e7ee;
      border-radius: 7px;
      background: #f8f9fb;
      overflow-wrap: anywhere;
    }
    .payslip-metric strong,
    .payslip-field strong {
      display: block;
      margin-top: 2px;
      color: #202635;
      font-size: 10.5px;
      font-weight: 900;
    }
    .payslip-metric.is-money {
      border-color: #ead8df;
      background: #fff9fb;
    }
    .payslip-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .payslip-section {
      break-inside: avoid;
      page-break-inside: avoid;
      padding: 8px;
      border: 1px solid #e3e7ee;
      border-radius: 8px;
      background: #fff;
    }
    .payslip-section h2 {
      margin: 0 0 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #edf0f5;
      color: #8f294f;
      font-size: 12px;
      line-height: 1.3;
    }
    .payslip-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .payslip-wide {
      grid-column: 1 / -1;
    }
    .payslip-final {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
      padding: 8px;
      border-radius: 8px;
      background: #202635;
      color: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .payslip-final .payslip-field {
      border-color: rgba(255,255,255,.18);
      background: rgba(255,255,255,.08);
    }
    .payslip-final span { color: #d8dde8; }
    .payslip-final strong { color: #fff; font-size: 12px; }
    .payslip-notes,
    .payslip-signatures {
      margin-top: 8px;
      padding: 8px;
      border: 1px solid #e3e7ee;
      border-radius: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .payslip-notes h2,
    .payslip-signatures h2 {
      margin: 0 0 6px;
      color: #8f294f;
      font-size: 12px;
    }
    .payslip-notes ul {
      margin: 0;
      padding: 0 16px 0 0;
    }
    .payslip-notes li { margin: 2px 0; }
    .payslip-signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .payslip-signature {
      height: 22mm;
      padding-top: 12mm;
      border-bottom: 1px solid #9aa3b5;
      color: #6d7586;
      text-align: center;
      font-weight: 800;
    }
    .payslip-footer {
      margin-top: 6px;
      color: #7a8291;
      font-size: 9px;
      text-align: center;
    }
    @media print {
      body { width: auto; }
      .payslip-page { max-width: none; }
    }
  </style>
</head>
<body>
  <main class="payslip-page">
    <header class="payslip-header">
      <div>
        <div class="payslip-brand">${escapePayslipHtml(salonName)}</div>
        <h1>${escapePayslipHtml(title)}</h1>
      </div>
      <div class="payslip-net">
        <span>صافي الراتب</span>
        <strong>${escapePayslipHtml(payslipMoneyValue(entry, entry.netSalaryHalalas))}</strong>
      </div>
    </header>

    <section class="payslip-meta" aria-label="بيانات الكشف">
      ${payslipMetric("الشهر/السنة", entry.payrollMonth)}
      ${payslipMetric("تاريخ التصدير", formatDateTime(generatedAt))}
      ${payslipMetric("حالة الراتب", statusLabel(entry.status))}
      ${payslipMetric("المصدر", generatedBy)}
    </section>

    <section class="payslip-meta" aria-label="بيانات الموظفة">
      ${payslipMetric("اسم الموظفة", safeText(entry.employeeName))}
      ${payslipMetric("رقم الموظفة", safeText(entry.employeeId))}
      ${payslipMetric("المسمى/الدور", entry.jobTitle || "غير متوفر")}
      ${payslipMetric("حالة الاعتماد", payslipStatusNotice(entry))}
    </section>

    <div class="payslip-grid">
      ${payslipSection("إعدادات الراتب", [
        ["الراتب الأساسي", entry.baseSalaryHalalas > 0 ? payslipMoneyValue(entry, entry.baseSalaryHalalas) : "غير مكتمل"],
        ["أيام العمل", workDaysValue(entry)],
        ["ساعات الفترة", entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "غير مكتمل"],
        ["ساعات اليوم", entry.dailyScheduledHours > 0 ? formatAttendanceHours(entry.dailyScheduledHours) : "غير محدد"],
        ["راتب اليوم", payslipMoneyValue(entry, entry.dailyRateHalalas)],
        ["راتب الساعة", payslipMoneyValue(entry, entry.hourlyRateHalalas)],
      ])}
      ${payslipSection("ملخص الحضور", [
        ["أيام الحضور", entry.attendanceSummary.attendanceDays],
        ["أيام الغياب", entry.attendanceSummary.absentDays],
        ["أيام البصمة الناقصة", entry.attendanceSummary.incompleteDays],
        ["ساعات الفترة", formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)],
        ["الساعات الفعلية", formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)],
        ["نقص الساعات", formatAttendanceHours(entry.attendanceSummary.totalMissingHours)],
        ["حالة ربط الحضور", attendanceStatusLabel(entry)],
        ["خصم الحضور", payslipAttendanceDeduction(entry)],
        ["ملاحظات الحضور", attendanceNotes.join(" | ") || "لا توجد"],
      ])}
      ${payslipSection("الاستحقاقات", [
        ["الراتب الأساسي", entry.baseSalaryHalalas > 0 ? payslipMoneyValue(entry, entry.baseSalaryHalalas) : "غير مكتمل"],
        ["البدلات", payslipMoneyValue(entry, entry.allowancesHalalas)],
        ["الإضافات", payslipMoneyValue(entry, entry.manualAdditionsHalalas)],
        ["الساعات الزائدة", formatAttendanceHours(entry.detectedExtraHours)],
        ["الأوفر تايم", entry.overtimeEnabled ? "مفعل" : "غير مفعل"],
        ["قيمة الأوفر تايم", payslipMoneyValue(entry, entry.overtimeValueHalalas)],
      ])}
      ${payslipSection("الخصومات", [
        ["خصم الحضور", payslipAttendanceDeduction(entry)],
        ["السلف", payslipMoneyValue(entry, entry.advancesHalalas)],
        ["الخصومات اليدوية", payslipMoneyValue(entry, entry.manualDeductionsHalalas)],
        ["إجمالي الخصومات", payslipMoneyValue(entry, entry.totalDeductionsHalalas)],
      ])}
    </div>

    <section class="payslip-final" aria-label="الصافي النهائي">
      ${payslipField("إجمالي الراتب", payslipMoneyValue(entry, entry.grossSalaryHalalas))}
      ${payslipField("إجمالي الإضافات", payslipMoneyValue(entry, entry.totalAdditionsHalalas))}
      ${payslipField("إجمالي الخصومات", payslipMoneyValue(entry, entry.totalDeductionsHalalas))}
      ${payslipField("صافي الراتب", payslipMoneyValue(entry, entry.netSalaryHalalas))}
    </section>

    <section class="payslip-notes">
      <h2>ملاحظات</h2>
      ${
        notes.length || attendanceNotes.length
          ? `<ul>${[...notes, ...attendanceNotes].map((note) => `<li>${escapePayslipHtml(note)}</li>`).join("")}</ul>`
          : `<p>لا توجد ملاحظات.</p>`
      }
    </section>

    <section class="payslip-signatures">
      <h2>التوقيعات</h2>
      <div class="payslip-signature-grid">
        <div class="payslip-signature">توقيع الإدارة</div>
        <div class="payslip-signature">توقيع الموظفة</div>
      </div>
    </section>

    <p class="payslip-footer">تم إنشاء كشف الراتب من بيانات النظام الحالية.</p>
  </main>
  <script>
    window.addEventListener("load", () => {
      window.focus();
      window.setTimeout(() => window.print(), 200);
    });
  </script>
</body>
</html>`;
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
  exportHtmlDocumentToPdf(createPayrollPayslipPdfDocument(input), "employee-payslip.pdf");
}
