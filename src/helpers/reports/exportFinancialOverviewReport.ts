import malikatLogo from "../../assets/images/ssunnamed.png";
import {
  exportReportToExcelV2,
  exportReportToPdfV2,
  exportV2FormatPeriod,
  exportV2SafeText,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";

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

type FinancialMovementRow = Record<string, ExportV2Value> & {
  movementType: string;
  date: string;
  reference: string;
  classification: string;
  responsible: string;
  description: string;
  amount: number;
  status: string;
};

function moneyValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function normalizePeriodLabel(value?: string | null): string {
  const label = String(value || "").trim().toLowerCase();
  if (label === "day") return "اليوم";
  if (label === "week") return "هذا الأسبوع";
  if (label === "month") return "هذا الشهر";
  if (label === "year") return "هذه السنة";
  if (label === "custom") return "فترة مخصصة";
  return exportV2SafeText(value, "الفترة الحالية");
}

function normalizeStatusLabel(value?: string | null): string {
  const status = String(value || "").trim().toLowerCase();
  if (!status || status === "all") return "الكل";
  if (status === "active") return "نشط";
  if (status === "refunded") return "مسترجع";
  if (status === "voided") return "ملغي";
  return String(value || "").trim();
}

function expenseDescription(row: FinancialOverviewExpenseRowInput): string {
  const title = exportV2SafeText(row.title, "مصروف");
  const note = String(row.note || "").trim();
  if (!note || note === "-" || note === "—" || note === title) return title;
  return `${title} — ${note}`;
}

export function buildFinancialOverviewReportData(
  input: FinancialOverviewReportInput
): ExportV2Report<FinancialMovementRow> {
  const revenueRows = Array.isArray(input.revenueRows) ? input.revenueRows : [];
  const expenseRows = Array.isArray(input.expenseRows) ? input.expenseRows : [];
  const trendRows = Array.isArray(input.trendRows) ? input.trendRows : [];

  const totalRevenue = revenueRows.reduce(
    (sum, row) => sum + moneyValue(row.amount),
    0
  );
  const totalExpenses = expenseRows.reduce(
    (sum, row) => sum + Math.abs(moneyValue(row.amount)),
    0
  );
  const net = totalRevenue - totalExpenses;

  const movements: FinancialMovementRow[] = [
    ...revenueRows.map((row): FinancialMovementRow => ({
      movementType: "إيراد",
      date: String(row.date || "").trim(),
      reference: exportV2SafeText(row.mkRef, "بدون مرجع"),
      classification: exportV2SafeText(row.source, "دخل آخر"),
      responsible: exportV2SafeText(row.employeeName, "غير محددة"),
      description: exportV2SafeText(row.note, "حركة إيراد"),
      amount: moneyValue(row.amount),
      status: exportV2SafeText(row.statusLabel, "نشط"),
    })),
    ...expenseRows.map((row): FinancialMovementRow => ({
      movementType: "مصروف",
      date: String(row.date || "").trim(),
      reference: exportV2SafeText(row.category, "أخرى"),
      classification: exportV2SafeText(row.category, "أخرى"),
      responsible: exportV2SafeText(row.addedBy, "الإدارة"),
      description: expenseDescription(row),
      amount: -Math.abs(moneyValue(row.amount)),
      status: "مصروف",
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const strongestTrend = trendRows.reduce<FinancialOverviewTrendRowInput | null>(
    (best, row) => {
      const total = Math.abs(moneyValue(row.returns)) + Math.abs(moneyValue(row.investments));
      if (!best) return row;
      const bestTotal =
        Math.abs(moneyValue(best.returns)) + Math.abs(moneyValue(best.investments));
      return total > bestTotal ? row : best;
    },
    null
  );

  const payrollCycleTotal = moneyValue(input.payrollCycle?.total);
  const payrollSalary = moneyValue(input.payrollCycle?.salary);
  const payrollOvertime = moneyValue(input.payrollCycle?.overtime);
  const payrollOther = moneyValue(input.payrollCycle?.other);

  return {
    slug: "financial-overview",
    reportCode: "FIN-OVERVIEW",
    title: "التقرير المالي العام",
    subtitle: "ملخص مالي موحد مع الحركات المطابقة للفلاتر الحالية",
    summarySheetName: "الملخص المالي",
    detailsSheetName: "الحركات المالية",
    period: exportV2FormatPeriod(
      input.filters?.fromDate,
      input.filters?.toDate
    ),
    dateRange: {
      from: input.filters?.fromDate,
      to: input.filters?.toDate,
    },
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: exportV2SafeText(input.generatedBy, "لوحة التقارير العامة"),
    branding: {
      salonName: "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },
    filters: [
      {
        label: "نوع الفترة",
        value: normalizePeriodLabel(input.filters?.periodLabel),
      },
      {
        label: "طريقة الدفع",
        value: exportV2SafeText(input.filters?.incomeMethod, "الكل"),
      },
      {
        label: "مصدر الإيراد",
        value: exportV2SafeText(input.filters?.incomeSource, "الكل"),
      },
      {
        label: "حالة الإيراد",
        value: normalizeStatusLabel(input.filters?.incomeStatus),
      },
      {
        label: "دورة الرواتب",
        value: exportV2SafeText(input.payrollCycle?.cycleKey, "غير محددة"),
      },
      {
        label: "فترة دورة الرواتب",
        value: `${exportV2SafeText(input.payrollCycle?.fromDate, "—")} إلى ${exportV2SafeText(
          input.payrollCycle?.toDate,
          "—"
        )}`,
      },
    ],
    summary: [
      {
        label: "إجمالي الإيرادات",
        value: totalRevenue,
        type: "currency",
        tone: "success",
      },
      {
        label: "إجمالي المصروفات",
        value: totalExpenses,
        type: "currency",
        tone: "danger",
      },
      {
        label: "صافي الربح / الخسارة",
        value: net,
        type: "currency",
        tone: net >= 0 ? "gold" : "danger",
      },
      {
        label: "عدد حركات الإيراد",
        value: revenueRows.length,
        type: "number",
        tone: "dark",
      },
      {
        label: "عدد المصروفات",
        value: expenseRows.length,
        type: "number",
        tone: "dark",
      },
      {
        label: "رواتب الدورة",
        value: payrollSalary,
        type: "currency",
        tone: "neutral",
      },
      {
        label: "أوفر تايم الدورة",
        value: payrollOvertime,
        type: "currency",
        tone: payrollOvertime > 0 ? "gold" : "neutral",
      },
      {
        label: "إجمالي مصروفات الدورة",
        value: payrollCycleTotal || payrollSalary + payrollOvertime + payrollOther,
        type: "currency",
        tone: "danger",
      },
    ],
    columns: [
      {
        key: "movementType",
        header: "نوع الحركة",
        type: "status",
        width: 13,
        align: "center",
      },
      {
        key: "date",
        header: "التاريخ",
        type: "date",
        width: 14,
        align: "center",
      },
      {
        key: "reference",
        header: "المرجع",
        width: 18,
        align: "center",
      },
      {
        key: "classification",
        header: "المصدر / التصنيف",
        width: 18,
      },
      {
        key: "responsible",
        header: "الموظفة / من أضافه",
        width: 21,
      },
      {
        key: "description",
        header: "الوصف والملاحظات",
        width: 34,
      },
      {
        key: "amount",
        header: "الأثر المالي",
        type: "currency",
        width: 16,
        align: "center",
      },
      {
        key: "status",
        header: "الحالة",
        type: "status",
        width: 14,
        align: "center",
      },
    ],
    rows: movements,
    totals: {
      amount: net,
    },
    emptyMessage: "لا توجد حركات مالية مطابقة للفلاتر الحالية.",
    notes: [
      "تظهر الإيرادات بقيم موجبة والمصروفات بقيم سالبة داخل ورقة الحركات المالية، ويطابق الإجمالي صافي الربح أو الخسارة.",
      "يشمل ملخص التقرير دورة الرواتب الحالية والرواتب والأوفر تايم والمصروفات الأخرى المحتسبة داخل الدورة.",
      strongestTrend
        ? `أعلى فترة حركة في الرسم الحالي: ${exportV2SafeText(
            strongestTrend.label,
            "—"
          )}، بإيرادات ${moneyValue(strongestTrend.returns).toLocaleString(
            "en-US"
          )} ر.س ومصروفات ${moneyValue(
            strongestTrend.investments
          ).toLocaleString("en-US")} ر.س.`
        : "لا تتوفر بيانات اتجاه إضافية للفترة الحالية.",
      "يعتمد التقرير على النتائج والفلاتر الظاهرة وقت التصدير، وليس على السجلات المستبعدة بالفلاتر.",
    ],
    pdfOrientation: "landscape",
  };
}

export function exportFinancialOverviewReportPdf(
  input: FinancialOverviewReportInput
) {
  return exportReportToPdfV2(buildFinancialOverviewReportData(input));
}

export function exportFinancialOverviewReportExcel(
  input: FinancialOverviewReportInput
) {
  exportReportToExcelV2(buildFinancialOverviewReportData(input));
}
