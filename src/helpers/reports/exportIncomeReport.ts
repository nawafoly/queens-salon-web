import malikatLogo from "../../assets/images/ssunnamed.png";
import { incomeText, type DashboardLanguage } from "../dashboardIncomeLanguage";
import {
  exportReportToExcelV2,
  exportReportToPdfV2,
  exportV2FormatPeriod,
  exportV2IsMeaningfulText,
  exportV2ResolveEmployeeName,
  exportV2ResolveFinancialStatus,
  exportV2SafeText,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";

export type IncomeReportRowInput = {
  date?: string | null;
  invoiceRef?: string | null;
  clientName?: string | null;
  services?: string | null;
  employeeName?: string | null;
  paymentMethod?: string | null;
  source?: string | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  remainingAmount?: number | null;
  status?: string | null;
  note?: string | null;
};

export type IncomeReportInput = {
  language?: DashboardLanguage;
  rows: IncomeReportRowInput[];
  filters?: {
    fromDate?: string | null;
    toDate?: string | null;
    method?: string | null;
    source?: string | null;
  };
  summary?: {
    totalRevenue?: number;
    cashRevenue?: number;
    cardRevenue?: number;
    transferRevenue?: number;
    otherRevenue?: number;
    refundTotal?: number;
    remainingTotal?: number;
  };
  generatedAt?: string;
  generatedBy?: string | null;
};

type IncomeReportRow = Record<string, ExportV2Value> & {
  date: string;
  invoiceRef: string;
  clientName: string;
  services: string;
  employeeName: string;
  paymentMethod: string;
  source: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  note: string;
};

function moneyValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function methodKey(label?: string | null) {
  const value = String(label || "").trim().toLowerCase();
  if (value === "cash" || value.includes("كاش") || value.includes("نقد")) return "cash";
  if (value === "card" || value.includes("شبكة") || value.includes("مدى") || value.includes("بطاق")) return "card";
  if (value === "transfer" || value.includes("تحويل")) return "transfer";
  return "other";
}

function compactReference(value: unknown, language: DashboardLanguage) {
  const emptyReference = incomeText(language, "بدون حجز");
  const text = exportV2SafeText(value, emptyReference);
  if (text.length <= 24 || /^MK-\d+$/i.test(text) || text === emptyReference) return text;
  return `${text.slice(0, 10)}…${text.slice(-8)}`;
}

function noteWithFullReference(note: unknown, fullReference: string, compactedReference: string, language: DashboardLanguage) {
  const cleanNote = exportV2SafeText(note, "—");
  if (fullReference === compactedReference) return cleanNote;
  const referenceNote = `${incomeText(language, "المرجع الكامل")}: ${fullReference}`;
  return cleanNote === "—" ? referenceNote : `${cleanNote} | ${referenceNote}`;
}

function generatedBy(value: string | null | undefined, language: DashboardLanguage) {
  return String(value || "").trim() || incomeText(language, "النظام");
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
  if (normalizedFrom) return `${incomeText(language, "من")} ${formatDate(normalizedFrom)}`;
  if (normalizedTo) return `${incomeText(language, "إلى")} ${formatDate(normalizedTo)}`;
  return incomeText(language, "كل الفترات");
}

export function buildIncomeReportData(input: IncomeReportInput): ExportV2Report<IncomeReportRow> {
  const language = input.language ?? "ar";
  const t = (text: string) => incomeText(language, text);
  const sourceRows = Array.isArray(input.rows) ? input.rows : [];
  const normalizedRows: IncomeReportRow[] = sourceRows.map((row) => {
    const paidAmount = moneyValue(row.paidAmount ?? row.totalAmount);
    const rawTotal = moneyValue(row.totalAmount ?? row.paidAmount);
    const rawStatus = String(row.status || "");
    const isRefund =
      paidAmount < 0 ||
      rawStatus.includes("استرجاع") ||
      rawStatus.includes("مسترجع");
    const totalAmount = isRefund ? rawTotal : Math.max(rawTotal, paidAmount);
    const remainingAmount = isRefund ? 0 : moneyValue(Math.max(0, totalAmount - paidAmount));
    const fullReference = exportV2SafeText(row.invoiceRef, t("بدون حجز"));
    const invoiceRef = compactReference(fullReference, language);
    const financialStatus = exportV2ResolveFinancialStatus({
      totalAmount,
      paidAmount,
      remainingAmount,
      isRefund,
      rawStatus,
    });

    return {
      date: String(row.date || "").trim(),
      invoiceRef,
      clientName: exportV2SafeText(row.clientName, t("عميلة غير محددة")),
      services: exportV2SafeText(row.services, t("غير محدد")),
      employeeName: exportV2ResolveEmployeeName(row.employeeName),
      paymentMethod: exportV2SafeText(row.paymentMethod, t("غير محدد")),
      source: exportV2SafeText(row.source, t("غير محدد")),
      totalAmount,
      paidAmount,
      remainingAmount,
      status: t(financialStatus.label),
      note: noteWithFullReference(row.note, fullReference, invoiceRef, language),
    };
  });

  const hasEmployeeData = sourceRows.some((row) =>
    exportV2IsMeaningfulText(row.employeeName)
  );

  const totalRevenue = input.summary?.totalRevenue ?? normalizedRows.reduce((sum, row) => sum + row.paidAmount, 0);
  const cashRevenue = input.summary?.cashRevenue ?? normalizedRows
    .filter((row) => methodKey(row.paymentMethod) === "cash")
    .reduce((sum, row) => sum + row.paidAmount, 0);
  const cardRevenue = input.summary?.cardRevenue ?? normalizedRows
    .filter((row) => methodKey(row.paymentMethod) === "card")
    .reduce((sum, row) => sum + row.paidAmount, 0);
  const transferRevenue = input.summary?.transferRevenue ?? normalizedRows
    .filter((row) => methodKey(row.paymentMethod) === "transfer")
    .reduce((sum, row) => sum + row.paidAmount, 0);
  const otherRevenue = input.summary?.otherRevenue ?? normalizedRows
    .filter((row) => methodKey(row.paymentMethod) === "other")
    .reduce((sum, row) => sum + row.paidAmount, 0);
  const refundTotal = input.summary?.refundTotal ?? Math.abs(
    normalizedRows
      .filter((row) => row.paidAmount < 0 || row.status.includes("استرجاع") || row.status.toLowerCase().includes("refund"))
      .reduce((sum, row) => sum + row.paidAmount, 0)
  );
  const remainingTotal = normalizedRows.reduce((sum, row) => sum + row.remainingAmount, 0);
  const totalBooked = normalizedRows.reduce((sum, row) => sum + row.totalAmount, 0);

  return {
    slug: "income",
    reportCode: "FIN-INCOME",
    title: t("تقرير الإيرادات"),
    subtitle: t("حركات الإيرادات والمدفوعات المطابقة للفلاتر الحالية"),
    summarySheetName: t("ملخص الإيرادات"),
    detailsSheetName: t("تفاصيل الإيرادات"),
    period: reportPeriod(input.filters?.fromDate, input.filters?.toDate, language),
    dateRange: {
      from: input.filters?.fromDate,
      to: input.filters?.toDate,
    },
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: generatedBy(input.generatedBy, language),
    branding: {
      salonName: language === "en" ? "MALIKAT" : "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },
    filters: [
      { label: t("طريقة الدفع"), value: exportV2SafeText(input.filters?.method, t("الكل")) },
      { label: t("المصدر / البحث"), value: exportV2SafeText(input.filters?.source, t("الكل")) },
    ],
    summary: [
      { label: t("عدد حركات الإيراد"), value: normalizedRows.length, type: "number", tone: "dark" },
      { label: t("إجمالي الإيرادات"), value: moneyValue(totalRevenue), type: "currency", tone: "gold" },
      { label: t("إيرادات الكاش"), value: moneyValue(cashRevenue), type: "currency", tone: "success" },
      { label: t("إيرادات الشبكة"), value: moneyValue(cardRevenue), type: "currency", tone: "success" },
      { label: t("التحويلات"), value: moneyValue(transferRevenue), type: "currency", tone: "success" },
      { label: t("دخل آخر"), value: moneyValue(otherRevenue), type: "currency", tone: "neutral" },
      { label: t("إجمالي الاسترجاع"), value: moneyValue(refundTotal), type: "currency", tone: "danger" },
      { label: t("المتبقي"), value: moneyValue(remainingTotal), type: "currency", tone: remainingTotal > 0 ? "gold" : "success" },
    ],
    columns: [
      { key: "date", header: t("التاريخ"), type: "date", width: 14, align: "center" },
      { key: "invoiceRef", header: t("رقم الحجز / الفاتورة"), width: 21, align: "center" },
      { key: "clientName", header: t("العميلة"), width: 20 },
      { key: "services", header: t("الخدمات"), width: 25 },
      ...(hasEmployeeData
        ? [{ key: "employeeName" as const, header: t("الموظفة"), width: 18 }]
        : []),
      { key: "paymentMethod", header: t("طريقة الدفع"), width: 15, align: "center" },
      { key: "source", header: t("المصدر"), width: 16, align: "center" },
      { key: "totalAmount", header: t("الإجمالي"), type: "currency", width: 15, align: "center" },
      { key: "paidAmount", header: t("المدفوع"), type: "currency", width: 15, align: "center" },
      { key: "remainingAmount", header: t("المتبقي"), type: "currency", width: 15, align: "center" },
      { key: "status", header: t("الحالة"), type: "status", width: 14, align: "center" },
      { key: "note", header: t("ملاحظات"), width: 30, hideInPdf: true },
    ],
    rows: normalizedRows,
    totals: {
      totalAmount: moneyValue(totalBooked),
      paidAmount: moneyValue(totalRevenue),
      remainingAmount: moneyValue(remainingTotal),
    },
    emptyMessage: t("لا توجد إيرادات مطابقة للفلاتر الحالية."),
    notes: language === "en"
      ? [
          "The report uses the filtered results visible at export time, not records hidden by filters.",
          "Refunds appear as negative transactions, while the refund summary shows their absolute value for review.",
          "The Excel file contains summary and detail sheets with frozen headers, column filters and a totals row.",
        ]
      : [
          "يعتمد التقرير على النتائج المفلترة الظاهرة وقت التصدير، وليس على جميع السجلات المخفية بالفلاتر.",
          "الاسترجاعات تظهر كحركات سالبة، بينما يعرض ملخص الاسترجاع قيمتها المطلقة للمراجعة.",
          "ملف Excel يحتوي ورقة ملخص وورقة تفاصيل بتنسيق RTL، مع تجميد العناوين وفلترة الأعمدة وصف إجماليات.",
        ],
    pdfOrientation: "landscape",
  };
}

export function exportIncomeReportPdf(input: IncomeReportInput) {
  return exportReportToPdfV2(buildIncomeReportData(input));
}

export function exportIncomeReportExcel(input: IncomeReportInput) {
  exportReportToExcelV2(buildIncomeReportData(input));
}

