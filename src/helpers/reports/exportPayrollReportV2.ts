import malikatLogo from "../../assets/images/ssunnamed.png";
import {
  calculatePayrollAccrualView,
  type PayrollEntryView,
} from "../../services/CorePayrollService";
import { formatAttendanceHours } from "../hr/attendanceDiscipline";
import {
  exportReportToExcelV2,
  exportReportToPdfV2,
  exportV2FormatPeriod,
  exportV2SafeText,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";

export type PayrollReportV2Filters = {
  year: number;
  month: number;
  employeeName?: string;
  statusLabel?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  payDate?: string;
};

export type PayrollReportV2Input = {
  entries: PayrollEntryView[];
  includeIncomplete?: boolean;
  originalCount?: number;
  excludedRows?: Array<{ employeeName: string; reason: string }>;
  filters: PayrollReportV2Filters;
};

export type PayrollPayslipV2Input = {
  entry: PayrollEntryView;
  payrollBounds?: {
    monthStart?: string;
    monthEnd?: string;
    payDate?: string;
    payrollMonth?: string;
  };
};

type PayrollExportRow = Record<string, ExportV2Value> & {
  employeeName: string;
  jobTitle: string;
  setupStatus: string;
  attendanceStatus: string;
  baseSalary: number;
  attendanceDays: number;
  absentDays: number;
  incompleteDays: number;
  scheduledHours: string;
  actualWorkedHours: string;
  missingHours: string;
  overtimeStatus: string;
  overtimeValue: number;
  additions: number;
  deductions: number;
  earnedToDate: number;
  expectedNet: number;
  status: string;
  notes: string;
};

type PayslipExportRow = Record<string, ExportV2Value> & {
  item: string;
  value: string | number;
  note: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  reviewed: "تمت المراجعة",
  approved: "معتمد",
  paid: "مدفوع",
};

function halalasToRiyals(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) / 100 : 0;
}

function statusLabel(value: unknown) {
  const key = String(value || "").trim();
  return STATUS_LABELS[key] || exportV2SafeText(key, "غير محدد");
}

function attendanceStatus(entry: PayrollEntryView) {
  const status = entry.attendanceSummary.attendanceLinkStatus;
  if (status === "confirmed") {
    return entry.attendanceSummary.incompleteDays > 0 ? "مؤكد - بصمة ناقصة" : "مؤكد";
  }
  if (status === "not_ready") return "غير جاهز";
  return "غير مربوط";
}

function setupStatus(entry: PayrollEntryView) {
  if (entry.payrollSetupComplete) return "مكتمل";
  const missing = Array.isArray(entry.payrollSetupMissing)
    ? entry.payrollSetupMissing.join("، ")
    : "";
  return missing ? `غير مكتمل: ${missing}` : "غير مكتمل";
}

function rowNotes(entry: PayrollEntryView) {
  const notes = [
    String(entry.notes || "").trim(),
    ...(entry.attendanceSummary.attendanceNotes || []).map((note) => String(note || "").trim()),
  ].filter(Boolean);
  if (entry.attendanceSummary.attendanceDeductionEligible === false) {
    notes.push(
      entry.attendanceSummary.attendanceDeductionNote ||
        "لم يطبق خصم الحضور لأن ربط البصمات غير مكتمل أو غير مؤكد."
    );
  }
  return notes.join(" | ") || "—";
}

function periodLabel(filters: PayrollReportV2Filters) {
  if (filters.periodStartDate || filters.periodEndDate) {
    return exportV2FormatPeriod(filters.periodStartDate, filters.periodEndDate);
  }
  return `${String(filters.month).padStart(2, "0")}/${filters.year}`;
}

function generatedBy() {
  return "إدارة الرواتب";
}

export function buildPayrollReportDataV2(
  input: PayrollReportV2Input
): ExportV2Report<PayrollExportRow> {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const rows: PayrollExportRow[] = entries.map((entry) => {
    const accrual = calculatePayrollAccrualView(entry);
    return {
      employeeName: exportV2SafeText(entry.employeeName, "موظفة غير محددة"),
      jobTitle: exportV2SafeText(entry.jobTitle, "غير محدد"),
      setupStatus: setupStatus(entry),
      attendanceStatus: attendanceStatus(entry),
      baseSalary: halalasToRiyals(entry.baseSalaryHalalas),
      attendanceDays: Number(entry.attendanceSummary.attendanceDays || 0),
      absentDays: Number(entry.attendanceSummary.absentDays || 0),
      incompleteDays: Number(entry.attendanceSummary.incompleteDays || 0),
      scheduledHours: formatAttendanceHours(entry.attendanceSummary.totalScheduledHours),
      actualWorkedHours: formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours),
      missingHours: formatAttendanceHours(entry.attendanceSummary.totalMissingHours),
      overtimeStatus: entry.overtimeEnabled ? "محتسب" : "غير محتسب",
      overtimeValue: halalasToRiyals(entry.overtimeValueHalalas),
      additions: halalasToRiyals(entry.totalAdditionsHalalas),
      deductions: halalasToRiyals(entry.totalDeductionsHalalas),
      earnedToDate: halalasToRiyals(accrual.earnedToDateHalalas),
      expectedNet: halalasToRiyals(accrual.expectedNetHalalas),
      status: statusLabel(entry.status),
      notes: rowNotes(entry),
    };
  });

  const completeEntries = entries.filter((entry) => entry.payrollSetupComplete);
  const totals = completeEntries.reduce(
    (acc, entry) => {
      const accrual = calculatePayrollAccrualView(entry);
      acc.baseSalary += halalasToRiyals(entry.baseSalaryHalalas);
      acc.overtimeValue += halalasToRiyals(entry.overtimeValueHalalas);
      acc.additions += halalasToRiyals(entry.totalAdditionsHalalas);
      acc.deductions += halalasToRiyals(entry.totalDeductionsHalalas);
      acc.earnedToDate += halalasToRiyals(accrual.earnedToDateHalalas);
      acc.expectedNet += halalasToRiyals(accrual.expectedNetHalalas);
      return acc;
    },
    {
      baseSalary: 0,
      overtimeValue: 0,
      additions: 0,
      deductions: 0,
      earnedToDate: 0,
      expectedNet: 0,
    }
  );

  const approvedCount = entries.filter((entry) => entry.status === "approved").length;
  const paidCount = entries.filter((entry) => entry.status === "paid").length;
  const excludedRows = Array.isArray(input.excludedRows) ? input.excludedRows : [];
  const excludedNotes = excludedRows.slice(0, 20).map(
    (row) => `مستبعد من التصدير: ${row.employeeName} — ${row.reason}`
  );

  return {
    slug: "payroll",
    reportCode: "HR-PAYROLL",
    title: "تقرير مسيرة الرواتب",
    subtitle: "المسيرة الشهرية وفق الفلاتر الحالية وحالة إعداد كل موظفة",
    summarySheetName: "ملخص الرواتب",
    detailsSheetName: "تفاصيل الرواتب",
    period: periodLabel(input.filters),
    dateRange: {
      from: input.filters.periodStartDate,
      to: input.filters.periodEndDate,
    },
    generatedAt: new Date().toISOString(),
    generatedBy: generatedBy(),
    branding: {
      salonName: "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },
    filters: [
      { label: "الموظفة", value: exportV2SafeText(input.filters.employeeName, "كل الموظفات") },
      { label: "حالة الراتب", value: exportV2SafeText(input.filters.statusLabel, "كل الحالات") },
      { label: "تاريخ الصرف المتوقع", value: exportV2SafeText(input.filters.payDate, "غير محدد") },
      {
        label: "نطاق التصدير",
        value: input.includeIncomplete ? "يشمل السجلات غير المكتملة" : "السجلات المكتملة فقط",
      },
    ],
    summary: [
      { label: "عدد السجلات المصدرة", value: rows.length, type: "number", tone: "dark" },
      { label: "إعدادات مكتملة", value: completeEntries.length, type: "number", tone: "success" },
      {
        label: "إعدادات غير مكتملة",
        value: Math.max(0, entries.length - completeEntries.length),
        type: "number",
        tone: entries.length === completeEntries.length ? "success" : "danger",
      },
      { label: "إجمالي الرواتب الأساسية", value: totals.baseSalary, type: "currency", tone: "gold" },
      { label: "إجمالي الإضافات", value: totals.additions, type: "currency", tone: "success" },
      { label: "إجمالي الخصومات", value: totals.deductions, type: "currency", tone: "danger" },
      { label: "المستحق حتى اليوم", value: totals.earnedToDate, type: "currency", tone: "gold" },
      { label: "الصافي المتوقع", value: totals.expectedNet, type: "currency", tone: "dark" },
      { label: "معتمد", value: approvedCount, type: "number", tone: "success" },
      { label: "مدفوع", value: paidCount, type: "number", tone: "success" },
    ],
    columns: [
      { key: "employeeName", header: "الموظفة", width: 22 },
      { key: "jobTitle", header: "المسمى الوظيفي", width: 18 },
      { key: "setupStatus", header: "إعداد الراتب", width: 23 },
      { key: "attendanceStatus", header: "ربط الحضور", width: 17, align: "center" },
      { key: "baseSalary", header: "الراتب الأساسي", type: "currency", width: 16, align: "center" },
      { key: "attendanceDays", header: "الحضور", type: "number", width: 11, align: "center" },
      { key: "absentDays", header: "الغياب", type: "number", width: 11, align: "center" },
      { key: "incompleteDays", header: "بصمة ناقصة", type: "number", width: 13, align: "center" },
      { key: "scheduledHours", header: "الساعات المطلوبة", width: 16, align: "center" },
      { key: "actualWorkedHours", header: "الساعات الفعلية", width: 16, align: "center" },
      { key: "missingHours", header: "نقص الساعات", width: 14, align: "center" },
      { key: "overtimeStatus", header: "الأوفر تايم", type: "status", width: 14, align: "center" },
      { key: "overtimeValue", header: "قيمة الأوفر تايم", type: "currency", width: 17, align: "center" },
      { key: "additions", header: "الإضافات", type: "currency", width: 14, align: "center" },
      { key: "deductions", header: "الخصومات", type: "currency", width: 14, align: "center" },
      { key: "earnedToDate", header: "المستحق حتى اليوم", type: "currency", width: 18, align: "center" },
      { key: "expectedNet", header: "الصافي المتوقع", type: "currency", width: 18, align: "center" },
      { key: "status", header: "الحالة", type: "status", width: 14, align: "center" },
      { key: "notes", header: "ملاحظات", width: 34, hideInPdf: true },
    ],
    rows,
    totals: {
      baseSalary: totals.baseSalary,
      overtimeValue: totals.overtimeValue,
      additions: totals.additions,
      deductions: totals.deductions,
      earnedToDate: totals.earnedToDate,
      expectedNet: totals.expectedNet,
    },
    emptyMessage: "لا توجد رواتب مطابقة للفلاتر الحالية.",
    notes: [
      "تُبنى نتائج التصدير من السجلات الظاهرة بعد تطبيق فلاتر الشهر والموظفة والحالة.",
      "السجلات غير المكتملة تُستبعد افتراضيًا من التصدير الرسمي، ويمكن تضمينها للمراجعة الداخلية.",
      "القيم المالية معروضة بالريال السعودي، بينما تحفظ داخليًا بالهللات.",
      ...excludedNotes,
      ...(excludedRows.length > 20
        ? [`يوجد ${excludedRows.length - 20} سجلًا مستبعدًا إضافيًا لم يُذكر في الملاحظات.`]
        : []),
    ],
    pdfOrientation: "landscape",
  };
}

export function exportPayrollReportPdfV2(input: PayrollReportV2Input) {
  return exportReportToPdfV2(buildPayrollReportDataV2(input));
}

export function exportPayrollReportExcelV2(input: PayrollReportV2Input) {
  return exportReportToExcelV2(buildPayrollReportDataV2(input));
}

export function buildPayrollPayslipDataV2(
  input: PayrollPayslipV2Input
): ExportV2Report<PayslipExportRow> {
  const entry = input.entry;
  const accrual = calculatePayrollAccrualView(entry);
  const rows: PayslipExportRow[] = [
    { item: "الراتب الأساسي", value: halalasToRiyals(entry.baseSalaryHalalas), note: "" },
    { item: "البدلات", value: halalasToRiyals(entry.allowancesHalalas), note: "" },
    { item: "الإضافات اليدوية", value: halalasToRiyals(entry.manualAdditionsHalalas), note: "" },
    {
      item: "الأوفر تايم",
      value: halalasToRiyals(entry.overtimeValueHalalas),
      note: entry.overtimeEnabled ? "محتسب" : "غير محتسب",
    },
    { item: "إجمالي الإضافات", value: halalasToRiyals(entry.totalAdditionsHalalas), note: "" },
    {
      item: "خصم الحضور",
      value: entry.attendanceSummary.attendanceDeductionEligible === false
        ? 0
        : halalasToRiyals(entry.missingHoursDeductionHalalas),
      note: entry.attendanceSummary.attendanceDeductionEligible === false ? "لم يطبق" : "",
    },
    { item: "السلف", value: halalasToRiyals(entry.advancesHalalas), note: "" },
    { item: "الخصومات اليدوية", value: halalasToRiyals(entry.manualDeductionsHalalas), note: "" },
    { item: "إجمالي الخصومات", value: halalasToRiyals(entry.totalDeductionsHalalas), note: "" },
    {
      item: accrual.isPartial ? "المستحق حتى اليوم" : "صافي الراتب النهائي",
      value: halalasToRiyals(accrual.earnedToDateHalalas),
      note: accrual.isPartial
        ? `محسوب حتى ${accrual.completedThroughDate || "لم تبدأ الفترة"}`
        : "",
    },
    {
      item: "الصافي المتوقع نهاية الفترة",
      value: halalasToRiyals(accrual.expectedNetHalalas),
      note: "",
    },
  ];

  const periodFrom = input.payrollBounds?.monthStart;
  const periodTo = input.payrollBounds?.monthEnd;

  return {
    slug: `payroll-payslip-${entry.employeeId}`,
    reportCode: "HR-PAYSLIP",
    title: "كشف راتب موظفة",
    subtitle: `${exportV2SafeText(entry.employeeName)} — ${exportV2SafeText(entry.jobTitle, "موظفة")}`,
    summarySheetName: "ملخص كشف الراتب",
    detailsSheetName: "بنود كشف الراتب",
    period: exportV2FormatPeriod(periodFrom, periodTo),
    dateRange: { from: periodFrom, to: periodTo },
    generatedAt: new Date().toISOString(),
    generatedBy: generatedBy(),
    branding: {
      salonName: "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },
    filters: [
      { label: "الشهر", value: entry.payrollMonth },
      { label: "حالة الراتب", value: statusLabel(entry.status) },
      { label: "تاريخ الصرف المتوقع", value: input.payrollBounds?.payDate || "غير محدد" },
    ],
    summary: [
      { label: "الموظفة", value: entry.employeeName, tone: "dark" },
      { label: "الراتب الأساسي", value: halalasToRiyals(entry.baseSalaryHalalas), type: "currency", tone: "gold" },
      { label: "إجمالي الإضافات", value: halalasToRiyals(entry.totalAdditionsHalalas), type: "currency", tone: "success" },
      { label: "إجمالي الخصومات", value: halalasToRiyals(entry.totalDeductionsHalalas), type: "currency", tone: "danger" },
      { label: "المستحق", value: halalasToRiyals(accrual.earnedToDateHalalas), type: "currency", tone: "gold" },
      { label: "الصافي المتوقع", value: halalasToRiyals(accrual.expectedNetHalalas), type: "currency", tone: "dark" },
    ],
    columns: [
      { key: "item", header: "البند", width: 28 },
      { key: "value", header: "القيمة", type: "currency", width: 20, align: "center" },
      { key: "note", header: "ملاحظة", width: 34 },
    ],
    rows,
    totals: {},
    emptyMessage: "لا توجد بنود في كشف الراتب.",
    notes: [
      `الحضور: ${entry.attendanceSummary.attendanceDays} يوم، الغياب: ${entry.attendanceSummary.absentDays} يوم، البصمات الناقصة: ${entry.attendanceSummary.incompleteDays} يوم.`,
      `الساعات المطلوبة: ${formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)}، الساعات الفعلية: ${formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)}.`,
      rowNotes(entry),
    ].filter((note) => note && note !== "—"),
    pdfOrientation: "portrait",
  };
}

export function exportPayrollPayslipPdfV2(input: PayrollPayslipV2Input) {
  return exportReportToPdfV2(buildPayrollPayslipDataV2(input));
}
