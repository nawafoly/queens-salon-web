import malikatLogo from "../../assets/images/ssunnamed.png";
import { expensesText, type DashboardLanguage } from "../dashboardExpensesLanguage";
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
  language?: DashboardLanguage;
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
function generatedBy(value: string | null | undefined, language: DashboardLanguage) {
  return String(value || "").trim() || expensesText(language, "النظام");
}

function reportPeriod(from: string | null | undefined, to: string | null | undefined, language: DashboardLanguage) {
  if (language === "ar") return exportV2FormatPeriod(from, to);
  const formatDate = (value: string) => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric" }).format(date);
  };
  const normalizedFrom = String(from || "").trim();
  const normalizedTo = String(to || "").trim();
  if (normalizedFrom && normalizedTo) return `${formatDate(normalizedFrom)} — ${formatDate(normalizedTo)}`;
  if (normalizedFrom) return `${expensesText(language, "من")} ${formatDate(normalizedFrom)}`;
  if (normalizedTo) return `${expensesText(language, "إلى")} ${formatDate(normalizedTo)}`;
  return expensesText(language, "كل الفترات");
}

export function buildExpensesReportData(input: ExpensesReportInput): ExportV2Report<ExpenseReportRow> {
  const language = input.language ?? "ar";
  const t = (text: string) => expensesText(language, text);
  const sourceRows = Array.isArray(input.rows) ? input.rows : [];
  const rows: ExpenseReportRow[] = sourceRows.map((row) => ({
    date: String(row.date || "").trim(),
    type: exportV2SafeText(row.type, t("تشغيلي")),
    category: exportV2SafeText(row.category, t("أخرى")),
    title: exportV2SafeText(row.title, "—"),
    employeeName: exportV2SafeText(row.employeeName, "—"),
    paymentMethod: exportV2SafeText(row.paymentMethod, t("غير محدد")),
    amount: moneyValue(row.amount),
    source: exportV2SafeText(row.source, t("تشغيل")),
    addedBy: exportV2SafeText(row.addedBy, t("الإدارة")),
    payrollCycle: exportV2SafeText(row.payrollCycle, "—"),
    note: exportV2SafeText(row.note, "—"),
  }));
  const hasEmployeeData = sourceRows.some((row) => exportV2IsMeaningfulText(row.employeeName));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const salaryTotal = rows.filter((row) => row.type.includes("راتب") || row.type.toLowerCase().includes("salary")).reduce((sum, row) => sum + row.amount, 0);
  const overtimeTotal = rows.filter((row) => row.type.includes("أوفر") || row.type.toLowerCase().includes("overtime")).reduce((sum, row) => sum + row.amount, 0);
  const operationalTotal = Math.max(0, total - salaryTotal - overtimeTotal);
  const withoutNotes = rows.filter((row) => row.note === "—").length;

  return {
    slug: "expenses",
    reportCode: "FIN-EXPENSES",
    title: t("تقرير المصروفات"),
    subtitle: t("المصروفات التشغيلية والرواتب المطابقة للفلاتر الحالية"),
    summarySheetName: t("ملخص المصروفات"),
    detailsSheetName: t("تفاصيل المصروفات"),
    period: reportPeriod(input.filters?.fromDate, input.filters?.toDate, language),
    dateRange: { from: input.filters?.fromDate, to: input.filters?.toDate },
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: generatedBy(input.generatedBy, language),
    branding: {
      salonName: language === "en" ? "MALIKAT" : "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },
    filters: [
      { label: t("وضع العرض"), value: exportV2SafeText(input.filters?.mode, t("حسب الفترة")) },
      { label: t("التصنيف"), value: exportV2SafeText(input.filters?.category, t("الكل")) },
      { label: t("طريقة الدفع"), value: exportV2SafeText(input.filters?.paymentMethod, t("الكل")) },
    ],
    summary: [
      { label: t("عدد المصروفات"), value: rows.length, type: "number", tone: "dark" },
      { label: t("إجمالي المصروفات"), value: total, type: "currency", tone: "danger" },
      { label: t("الرواتب"), value: salaryTotal, type: "currency", tone: "gold" },
      { label: t("الأوفر تايم"), value: overtimeTotal, type: "currency", tone: "gold" },
      { label: t("التشغيلية"), value: operationalTotal, type: "currency", tone: "neutral" },
      { label: t("بدون ملاحظات"), value: withoutNotes, type: "number", tone: withoutNotes ? "danger" : "success" },
    ],
    columns: [
      { key: "date", header: t("التاريخ"), type: "date", width: 14, align: "center" },
      { key: "type", header: t("النوع"), type: "status", width: 13, align: "center" },
      { key: "category", header: t("التصنيف"), width: 17 },
      { key: "title", header: t("الوصف"), width: 28 },
      ...(hasEmployeeData ? [{ key: "employeeName" as const, header: t("الموظفة"), width: 18 }] : []),
      { key: "paymentMethod", header: t("طريقة الدفع"), width: 15, align: "center" },
      { key: "amount", header: t("المبلغ"), type: "currency", width: 16, align: "center" },
      { key: "source", header: t("المصدر"), width: 16, align: "center" },
      { key: "addedBy", header: t("أضيف بواسطة"), width: 18 },
      { key: "payrollCycle", header: t("دورة الرواتب"), width: 16, align: "center" },
      { key: "note", header: t("ملاحظات"), width: 30, hideInPdf: true },
    ],
    rows,
    totals: { amount: total },
    emptyMessage: t("لا توجد مصروفات مطابقة للفلاتر الحالية."),
    notes: language === "en"
      ? [
          "The report uses the filtered results visible at export time.",
          "The data includes manual expenses plus salary and overtime rows calculated automatically for the selected period.",
        ]
      : [
          "يعتمد التقرير على النتائج المفلترة الظاهرة وقت التصدير.",
          "تتضمن البيانات المصروفات اليدوية وصفوف الرواتب والأوفر تايم المحسوبة تلقائيًا ضمن الفترة.",
        ],
    pdfOrientation: "landscape",
  };
}

export function exportExpensesReportPdf(input: ExpensesReportInput) { return exportReportToPdfV2(buildExpensesReportData(input)); }
export function exportExpensesReportExcel(input: ExpensesReportInput) { exportReportToExcelV2(buildExpensesReportData(input)); }
