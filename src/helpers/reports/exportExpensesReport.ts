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
  filters?: {
    fromDate?: string | null;
    toDate?: string | null;
    category?: string | null;
    paymentMethod?: string | null;
    mode?: string | null;
  };
  generatedAt?: string;
  generatedBy?: string | null;
};

type ExpenseReportRow = {
  date: string;
  type: string;
  category: string;
  title: string;
  employeeName: string;
  paymentMethod: string;
  amount: string;
  source: string;
  addedBy: string;
  payrollCycle: string;
  note: string;
};

type GroupRow = {
  category: string;
  count: number;
  totalAmount: string;
};

function moneyValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function groupByCategory(rows: ExpenseReportRowInput[]): GroupRow[] {
  const map = new Map<string, { count: number; total: number }>();
  rows.forEach((row) => {
    const key = safeText(row.category || row.source, "أخرى");
    const current = map.get(key) || { count: 0, total: 0 };
    current.count += 1;
    current.total += moneyValue(row.amount);
    map.set(key, current);
  });
  return Array.from(map.entries())
    .map(([category, value]) => ({ category, count: value.count, totalAmount: formatCurrency(value.total) }))
    .sort((a, b) => String(b.totalAmount).localeCompare(String(a.totalAmount)));
}

export function buildExpensesReportData(input: ExpensesReportInput): ExportReport<ExpenseReportRow> {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const total = rows.reduce((sum, row) => sum + moneyValue(row.amount), 0);
  const salaryTotal = rows
    .filter((row) => String(row.type || row.source || "").includes("راتب"))
    .reduce((sum, row) => sum + moneyValue(row.amount), 0);
  const overtimeTotal = rows
    .filter((row) => String(row.type || row.source || "").includes("أوفر"))
    .reduce((sum, row) => sum + moneyValue(row.amount), 0);
  const operationalTotal = Math.max(0, total - salaryTotal - overtimeTotal);
  const withoutNotes = rows.filter((row) => !String(row.note || "").trim()).length;

  return {
    title: "تقرير المصروفات",
    period: formatPeriod(input.filters?.fromDate, input.filters?.toDate),
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    summarySheetName: "ملخص المصروفات",
    summary: [
      { label: "عدد المصروفات", value: rows.length },
      { label: "إجمالي المصروفات", value: total },
      { label: "رواتب", value: salaryTotal },
      { label: "أوفر تايم", value: overtimeTotal },
      { label: "مصروفات تشغيلية", value: operationalTotal },
      { label: "بدون ملاحظات", value: withoutNotes },
      { label: "وضع العرض", value: safeText(input.filters?.mode, "حسب الفترة") },
      { label: "فلتر التصنيف", value: safeText(input.filters?.category, "الكل") },
      { label: "فلتر طريقة الدفع", value: safeText(input.filters?.paymentMethod, "الكل") },
    ],
    table: {
      name: "تفاصيل المصروفات",
      emptyMessage: "لا توجد مصروفات مطابقة للفلاتر الحالية.",
      columns: [
        { key: "date", header: "التاريخ", width: 14 },
        { key: "type", header: "النوع", width: 12 },
        { key: "category", header: "التصنيف", width: 16 },
        { key: "title", header: "الوصف", width: 28 },
        { key: "employeeName", header: "الموظفة", width: 18 },
        { key: "paymentMethod", header: "طريقة الدفع", width: 14 },
        { key: "amount", header: "المبلغ", width: 14 },
        { key: "source", header: "المصدر", width: 16 },
        { key: "addedBy", header: "أضيف بواسطة", width: 18 },
        { key: "payrollCycle", header: "دورة الرواتب", width: 16 },
        { key: "note", header: "ملاحظات", width: 30 },
      ],
      rows: rows.map((row) => ({
        date: formatDate(row.date || ""),
        type: safeText(row.type, "تشغيلي"),
        category: safeText(row.category, "أخرى"),
        title: safeText(row.title, "—"),
        employeeName: safeText(row.employeeName, "—"),
        paymentMethod: safeText(row.paymentMethod, "غير محدد"),
        amount: formatCurrency(row.amount ?? 0),
        source: safeText(row.source, "تشغيل"),
        addedBy: safeText(row.addedBy, "الإدارة"),
        payrollCycle: safeText(row.payrollCycle, "—"),
        note: safeText(row.note, "—"),
      })),
    },
    extraTables: [
      {
        name: "المصروفات حسب التصنيف",
        emptyMessage: "لا توجد بيانات تصنيف.",
        columns: [
          { key: "category", header: "التصنيف", width: 22 },
          { key: "count", header: "عدد السجلات", width: 14 },
          { key: "totalAmount", header: "الإجمالي", width: 18 },
        ],
        rows: groupByCategory(rows),
      },
    ],
    notes: [
      "يتضمن التقرير المصروفات اليدوية وأي مصروفات رواتب/أوفر تايم محسوبة تلقائيًا ضمن الفترة المعروضة.",
      "إذا لم يظهر مصدر مصروف معين، فمصدر البيانات غير متوفر في الصفحة الحالية وليس رقمًا مخترعًا.",
    ],
  };
}

export function exportExpensesReportPdf(input: ExpensesReportInput) {
  exportReportToPdf(buildExpensesReportData(input), "expenses-report.pdf");
}

export function exportExpensesReportExcel(input: ExpensesReportInput) {
  exportReportToExcel(buildExpensesReportData(input), "expenses-report.xlsx");
}

