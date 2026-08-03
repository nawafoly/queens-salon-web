import malikatLogo from "../../assets/images/ssunnamed.png";
import {
  exportReportToExcelV2,
  exportReportToPdfV2,
  exportV2FormatPeriod,
  exportV2IsMeaningfulText,
  exportV2SafeText,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";

export type ExpenseReportRowInput = {
  date?: string | null;
  type?: string | null;
  category?: string | null;
  title?: string | null;
  employeeName?: string | null;
  paymentMethod?: string | null;
  amount?: number | null;
  source?: string | null;
  addedBy?: string | null;
  payrollCycle?: string | null;
  note?: string | null;
};

export type ExpensesReportInput = {
  rows: ExpenseReportRowInput[];
  filters?: { fromDate?: string | null; toDate?: string | null; category?: string | null; paymentMethod?: string | null; mode?: string | null };
  generatedAt?: string;
  generatedBy?: string | null;
};

type ExpenseReportRow = Record<string, ExportV2Value> & {
  date: string; type: string; category: string; title: string; employeeName: string;
  paymentMethod: string; amount: number; source: string; addedBy: string; payrollCycle: string; note: string;
};

function moneyValue(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function generatedBy(value?: string | null) { return String(value || "").trim() || "النظام"; }

export function buildExpensesReportData(input: ExpensesReportInput): ExportV2Report<ExpenseReportRow> {
  const sourceRows = Array.isArray(input.rows) ? input.rows : [];
  const rows: ExpenseReportRow[] = sourceRows.map((row) => ({
    date: String(row.date || "").trim(),
    type: exportV2SafeText(row.type, "تشغيلي"),
    category: exportV2SafeText(row.category, "أخرى"),
    title: exportV2SafeText(row.title, "—"),
    employeeName: exportV2SafeText(row.employeeName, "—"),
    paymentMethod: exportV2SafeText(row.paymentMethod, "غير محدد"),
    amount: moneyValue(row.amount),
    source: exportV2SafeText(row.source, "تشغيل"),
    addedBy: exportV2SafeText(row.addedBy, "الإدارة"),
    payrollCycle: exportV2SafeText(row.payrollCycle, "—"),
    note: exportV2SafeText(row.note, "—"),
  }));
  const hasEmployeeData = sourceRows.some((row) => exportV2IsMeaningfulText(row.employeeName));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const salaryTotal = rows.filter((row) => row.type.includes("راتب")).reduce((sum, row) => sum + row.amount, 0);
  const overtimeTotal = rows.filter((row) => row.type.includes("أوفر")).reduce((sum, row) => sum + row.amount, 0);
  const operationalTotal = Math.max(0, total - salaryTotal - overtimeTotal);
  const withoutNotes = rows.filter((row) => row.note === "—").length;

  return {
    slug: "expenses", reportCode: "FIN-EXPENSES", title: "تقرير المصروفات",
    subtitle: "المصروفات التشغيلية والرواتب المطابقة للفلاتر الحالية",
    summarySheetName: "ملخص المصروفات", detailsSheetName: "تفاصيل المصروفات",
    period: exportV2FormatPeriod(input.filters?.fromDate, input.filters?.toDate),
    dateRange: { from: input.filters?.fromDate, to: input.filters?.toDate },
    generatedAt: input.generatedAt || new Date().toISOString(), generatedBy: generatedBy(input.generatedBy),
    branding: { salonName: "مَلِكات", brandName: "Malikat Salon", logoUrl: malikatLogo },
    filters: [
      { label: "وضع العرض", value: exportV2SafeText(input.filters?.mode, "حسب الفترة") },
      { label: "التصنيف", value: exportV2SafeText(input.filters?.category, "الكل") },
      { label: "طريقة الدفع", value: exportV2SafeText(input.filters?.paymentMethod, "الكل") },
    ],
    summary: [
      { label: "عدد المصروفات", value: rows.length, type: "number", tone: "dark" },
      { label: "إجمالي المصروفات", value: total, type: "currency", tone: "danger" },
      { label: "الرواتب", value: salaryTotal, type: "currency", tone: "gold" },
      { label: "الأوفر تايم", value: overtimeTotal, type: "currency", tone: "gold" },
      { label: "التشغيلية", value: operationalTotal, type: "currency", tone: "neutral" },
      { label: "بدون ملاحظات", value: withoutNotes, type: "number", tone: withoutNotes ? "danger" : "success" },
    ],
    columns: [
      { key: "date", header: "التاريخ", type: "date", width: 14, align: "center" },
      { key: "type", header: "النوع", type: "status", width: 13, align: "center" },
      { key: "category", header: "التصنيف", width: 17 },
      { key: "title", header: "الوصف", width: 28 },
      ...(hasEmployeeData ? [{ key: "employeeName" as const, header: "الموظفة", width: 18 }] : []),
      { key: "paymentMethod", header: "طريقة الدفع", width: 15, align: "center" },
      { key: "amount", header: "المبلغ", type: "currency", width: 16, align: "center" },
      { key: "source", header: "المصدر", width: 16, align: "center" },
      { key: "addedBy", header: "أضيف بواسطة", width: 18 },
      { key: "payrollCycle", header: "دورة الرواتب", width: 16, align: "center" },
      { key: "note", header: "ملاحظات", width: 30, hideInPdf: true },
    ],
    rows, totals: { amount: total }, emptyMessage: "لا توجد مصروفات مطابقة للفلاتر الحالية.",
    notes: [
      "يعتمد التقرير على النتائج المفلترة الظاهرة وقت التصدير.",
      "تتضمن البيانات المصروفات اليدوية وصفوف الرواتب والأوفر تايم المحسوبة تلقائيًا ضمن الفترة.",
    ], pdfOrientation: "landscape",
  };
}

export function exportExpensesReportPdf(input: ExpensesReportInput) { return exportReportToPdfV2(buildExpensesReportData(input)); }
export function exportExpensesReportExcel(input: ExpensesReportInput) { exportReportToExcelV2(buildExpensesReportData(input)); }
