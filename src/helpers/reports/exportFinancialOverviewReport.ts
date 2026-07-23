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
  type ReportCellValue,
} from "./common.ts";

export type FinancialOverviewRevenueRowInput = {
  date?: string | null;
  time?: string | null;
  source?: string | null;
  mkRef?: string | null;
  employeeName?: string | null;
  note?: string | null;
  amount?: number | null;
  statusLabel?: string | null;
};

export type FinancialOverviewExpenseRowInput = {
  date?: string | null;
  category?: string | null;
  title?: string | null;
  amount?: number | null;
  addedBy?: string | null;
  note?: string | null;
};

export type FinancialOverviewTrendRowInput = {
  label?: string | null;
  returns?: number | null;
  investments?: number | null;
};

export type FinancialOverviewReportInput = {
  revenueRows: FinancialOverviewRevenueRowInput[];
  expenseRows: FinancialOverviewExpenseRowInput[];
  trendRows?: FinancialOverviewTrendRowInput[];
  filters?: {
    fromDate?: string | null;
    toDate?: string | null;
    periodLabel?: string | null;
    incomeMethod?: string | null;
    incomeSource?: string | null;
    incomeStatus?: string | null;
  };
  payrollCycle?: {
    cycleKey?: string | null;
    fromDate?: string | null;
    toDate?: string | null;
    salary?: number | null;
    overtime?: number | null;
    other?: number | null;
    total?: number | null;
  };
  generatedAt?: string;
  generatedBy?: string | null;
};

type OverviewRow = {
  metric: string;
  value: string;
  note: string;
};

type RevenueRow = Record<string, ReportCellValue> & {
  date: string;
  source: string;
  mkRef: string;
  employeeName: string;
  note: string;
  amount: string;
  statusLabel: string;
};

type ExpenseRow = Record<string, ReportCellValue> & {
  date: string;
  category: string;
  title: string;
  amount: string;
  addedBy: string;
  note: string;
};

type TrendRow = Record<string, ReportCellValue> & {
  label: string;
  revenue: string;
  expenses: string;
  net: string;
};

function moneyValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function buildFinancialOverviewReportData(
  input: FinancialOverviewReportInput
): ExportReport<OverviewRow> {
  const revenueRows = Array.isArray(input.revenueRows) ? input.revenueRows : [];
  const expenseRows = Array.isArray(input.expenseRows) ? input.expenseRows : [];
  const revenue = revenueRows.reduce((sum, row) => sum + moneyValue(row.amount), 0);
  const expenses = expenseRows.reduce((sum, row) => sum + moneyValue(row.amount), 0);
  const net = revenue - expenses;

  return {
    title: "التقرير المالي العام",
    period: formatPeriod(input.filters?.fromDate, input.filters?.toDate),
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    summarySheetName: "ملخص التقرير",
    summary: [
      { label: "إجمالي الإيرادات", value: revenue },
      { label: "إجمالي المصروفات", value: expenses },
      { label: "صافي الربح / الخسارة", value: net },
      { label: "عدد حركات الإيراد", value: revenueRows.length },
      { label: "عدد المصروفات", value: expenseRows.length },
      { label: "دورة الرواتب", value: safeText(input.payrollCycle?.cycleKey, "غير محددة") },
      { label: "رواتب الدورة", value: input.payrollCycle?.salary ?? 0 },
      { label: "أوفر تايم الدورة", value: input.payrollCycle?.overtime ?? 0 },
      { label: "مصروفات أخرى في الدورة", value: input.payrollCycle?.other ?? 0 },
    ],
    table: {
      name: "ملخص المؤشرات",
      columns: [
        { key: "metric", header: "المؤشر", width: 26 },
        { key: "value", header: "القيمة", width: 20 },
        { key: "note", header: "ملاحظة", width: 42 },
      ],
      rows: [
        { metric: "إجمالي الإيرادات", value: formatCurrency(revenue), note: "من حركات الإيرادات والمدفوعات المسجلة" },
        { metric: "إجمالي المصروفات", value: formatCurrency(expenses), note: "من المصروفات اليدوية والرواتب التلقائية" },
        { metric: "صافي الربح / الخسارة", value: formatCurrency(net), note: net >= 0 ? "صافي موجب" : "صافي سالب" },
        {
          metric: "فترة دورة الرواتب",
          value: `${safeText(input.payrollCycle?.fromDate, "—")} إلى ${safeText(input.payrollCycle?.toDate, "—")}`,
          note: "تعرض للربط المحاسبي فقط وليست بديلًا عن تقرير الرواتب التفصيلي",
        },
      ],
    },
    extraTables: [
      {
        name: "تفاصيل الإيرادات",
        emptyMessage: "لا توجد إيرادات داخل الفترة.",
        columns: [
          { key: "date", header: "التاريخ/الوقت", width: 18 },
          { key: "source", header: "المصدر", width: 14 },
          { key: "mkRef", header: "رقم الحجز", width: 16 },
          { key: "employeeName", header: "الموظفة", width: 18 },
          { key: "note", header: "الملاحظة", width: 30 },
          { key: "amount", header: "المبلغ", width: 14 },
          { key: "statusLabel", header: "الحالة", width: 14 },
        ],
        rows: revenueRows.map((row): RevenueRow => ({
          date: `${formatDate(row.date || "")} ${safeText(row.time, "")}`.trim(),
          source: safeText(row.source, "غير محدد"),
          mkRef: safeText(row.mkRef, "—"),
          employeeName: safeText(row.employeeName, "—"),
          note: safeText(row.note, "—"),
          amount: formatCurrency(row.amount ?? 0),
          statusLabel: safeText(row.statusLabel, "نشط"),
        })),
      },
      {
        name: "تفاصيل المصروفات",
        emptyMessage: "لا توجد مصروفات داخل الفترة.",
        columns: [
          { key: "date", header: "التاريخ", width: 14 },
          { key: "category", header: "التصنيف", width: 16 },
          { key: "title", header: "الوصف", width: 30 },
          { key: "amount", header: "المبلغ", width: 14 },
          { key: "addedBy", header: "من أضافه", width: 18 },
          { key: "note", header: "ملاحظات", width: 28 },
        ],
        rows: expenseRows.map((row): ExpenseRow => ({
          date: formatDate(row.date || ""),
          category: safeText(row.category, "أخرى"),
          title: safeText(row.title, "—"),
          amount: formatCurrency(row.amount ?? 0),
          addedBy: safeText(row.addedBy, "الإدارة"),
          note: safeText(row.note, "—"),
        })),
      },
      {
        name: "اتجاه الإيرادات والمصروفات",
        emptyMessage: "لا توجد بيانات اتجاه.",
        columns: [
          { key: "label", header: "الفترة", width: 14 },
          { key: "revenue", header: "الإيرادات", width: 16 },
          { key: "expenses", header: "المصروفات", width: 16 },
          { key: "net", header: "الصافي", width: 16 },
        ],
        rows: (input.trendRows || []).map((row): TrendRow => {
          const revenueValue = moneyValue(row.returns);
          const expenseValue = moneyValue(row.investments);
          return {
            label: safeText(row.label, "—"),
            revenue: formatCurrency(revenueValue),
            expenses: formatCurrency(expenseValue),
            net: formatCurrency(revenueValue - expenseValue),
          };
        }),
      },
    ],
    notes: [
      "هذا التقرير يلخص اللوحة المالية الحالية ولا يستبدل تقارير الرواتب أو الإيرادات أو المصروفات التفصيلية.",
      "تعتمد الإيرادات على حركات الدخل الفعلية، وتعتمد المصروفات على سجلات المصروفات مع الرواتب التلقائية المتاحة في الصفحة.",
    ],
  };
}

export function exportFinancialOverviewReportPdf(input: FinancialOverviewReportInput) {
  exportReportToPdf(buildFinancialOverviewReportData(input), "financial-overview-report.pdf");
}

export function exportFinancialOverviewReportExcel(input: FinancialOverviewReportInput) {
  exportReportToExcel(buildFinancialOverviewReportData(input), "financial-overview-report.xlsx");
}

