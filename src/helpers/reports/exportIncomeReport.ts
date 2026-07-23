import {
  currentGeneratedAt,
  exportReportToExcel,
  exportReportToPdf,
  formatCurrency,
  formatDate,
  formatPeriod,
  normalizeGeneratedBy,
  safeText,
  type ExportReport,
} from "./common.ts";

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

type IncomeReportRow = {
  date: string;
  invoiceRef: string;
  clientName: string;
  services: string;
  employeeName: string;
  paymentMethod: string;
  source: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: string;
  note: string;
};

function moneyValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function methodKey(label?: string | null) {
  const s = String(label || "").trim().toLowerCase();
  if (s === "cash" || s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s === "card" || s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق")) return "card";
  if (s === "transfer" || s.includes("تحويل")) return "transfer";
  return "other";
}

export function buildIncomeReportData(input: IncomeReportInput): ExportReport<IncomeReportRow> {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const totalRevenue = input.summary?.totalRevenue ?? rows.reduce((sum, row) => sum + moneyValue(row.paidAmount ?? row.totalAmount), 0);
  const cashRevenue = input.summary?.cashRevenue ?? rows.filter((row) => methodKey(row.paymentMethod) === "cash").reduce((sum, row) => sum + moneyValue(row.paidAmount ?? row.totalAmount), 0);
  const cardRevenue = input.summary?.cardRevenue ?? rows.filter((row) => methodKey(row.paymentMethod) === "card").reduce((sum, row) => sum + moneyValue(row.paidAmount ?? row.totalAmount), 0);
  const transferRevenue = input.summary?.transferRevenue ?? rows.filter((row) => methodKey(row.paymentMethod) === "transfer").reduce((sum, row) => sum + moneyValue(row.paidAmount ?? row.totalAmount), 0);
  const otherRevenue = input.summary?.otherRevenue ?? rows.filter((row) => methodKey(row.paymentMethod) === "other").reduce((sum, row) => sum + moneyValue(row.paidAmount ?? row.totalAmount), 0);
  const refundTotal = input.summary?.refundTotal ?? Math.abs(rows.filter((row) => moneyValue(row.paidAmount ?? row.totalAmount) < 0).reduce((sum, row) => sum + moneyValue(row.paidAmount ?? row.totalAmount), 0));
  const remainingTotal = input.summary?.remainingTotal ?? rows.reduce((sum, row) => sum + moneyValue(row.remainingAmount), 0);

  return {
    title: "تقرير الإيرادات",
    period: formatPeriod(input.filters?.fromDate, input.filters?.toDate),
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    summarySheetName: "ملخص الإيرادات",
    summary: [
      { label: "عدد حركات الإيراد", value: rows.length },
      { label: "إجمالي الإيرادات", value: totalRevenue },
      { label: "كاش", value: cashRevenue },
      { label: "شبكة", value: cardRevenue },
      { label: "تحويل", value: transferRevenue },
      { label: "دخل آخر", value: otherRevenue },
      { label: "إجمالي الاسترجاع", value: refundTotal },
      { label: "المتبقي", value: remainingTotal },
      { label: "فلتر طريقة الدفع", value: safeText(input.filters?.method, "الكل") },
      { label: "فلتر المصدر", value: safeText(input.filters?.source, "الكل") },
    ],
    table: {
      name: "تفاصيل الإيرادات",
      emptyMessage: "لا توجد إيرادات مطابقة للفلاتر الحالية.",
      columns: [
        { key: "date", header: "التاريخ", width: 14 },
        { key: "invoiceRef", header: "رقم الحجز/الفاتورة", width: 20 },
        { key: "clientName", header: "العميلة", width: 20 },
        { key: "services", header: "الخدمات", width: 22 },
        { key: "employeeName", header: "الموظفة", width: 18 },
        { key: "paymentMethod", header: "طريقة الدفع", width: 14 },
        { key: "source", header: "المصدر", width: 14 },
        { key: "totalAmount", header: "الإجمالي", width: 14 },
        { key: "paidAmount", header: "المدفوع", width: 14 },
        { key: "remainingAmount", header: "المتبقي", width: 14 },
        { key: "status", header: "الحالة", width: 14 },
        { key: "note", header: "ملاحظات", width: 30 },
      ],
      rows: rows.map((row) => ({
        date: formatDate(row.date || ""),
        invoiceRef: safeText(row.invoiceRef, "بدون حجز"),
        clientName: safeText(row.clientName, "عميلة غير محددة"),
        services: safeText(row.services, "غير محدد"),
        employeeName: safeText(row.employeeName, "غير محددة"),
        paymentMethod: safeText(row.paymentMethod, "غير محدد"),
        source: safeText(row.source, "غير محدد"),
        totalAmount: formatCurrency(row.totalAmount ?? row.paidAmount ?? 0),
        paidAmount: formatCurrency(row.paidAmount ?? row.totalAmount ?? 0),
        remainingAmount: formatCurrency(row.remainingAmount ?? 0),
        status: safeText(row.status, "نشط"),
        note: safeText(row.note, "—"),
      })),
    },
    notes: [
      "يعتمد التقرير على حركات الإيرادات والمدفوعات المسجلة فعليًا، ولا يحسب الحجوزات الملغية كإيراد إلا إذا وُجدت حركة مالية مستقلة لها.",
      "الأرقام المعروضة في PDF مختصرة وقابلة للطباعة، والتفاصيل الكاملة موجودة في Excel.",
    ],
  };
}

export function exportIncomeReportPdf(input: IncomeReportInput) {
  exportReportToPdf(buildIncomeReportData(input), "income-report.pdf");
}

export function exportIncomeReportExcel(input: IncomeReportInput) {
  exportReportToExcel(buildIncomeReportData(input), "income-report.xlsx");
}

