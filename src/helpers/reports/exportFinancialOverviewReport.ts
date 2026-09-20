import malikatLogo from "../../assets/images/ssunnamed.png";
import { reportsText, type DashboardLanguage } from "../dashboardReportsLanguage";
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
  language?: DashboardLanguage;
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

function normalizePeriodLabel(value: string | null | undefined, language: DashboardLanguage): string {
  const label = String(value || "").trim().toLowerCase();
  if (label === "day") return reportsText(language, "اليوم");
  if (label === "week") return reportsText(language, "هذا الأسبوع");
  if (label === "month") return reportsText(language, "هذا الشهر");
  if (label === "year") return reportsText(language, "هذه السنة");
  if (label === "custom") return reportsText(language, "فترة مخصصة");
  return exportV2SafeText(value, reportsText(language, "الفترة الحالية"));
}

function normalizeStatusLabel(value: string | null | undefined, language: DashboardLanguage): string {
  const status = String(value || "").trim().toLowerCase();
  if (!status || status === "all") return reportsText(language, "الكل");
  if (status === "active") return reportsText(language, "نشط");
  if (status === "refunded") return reportsText(language, "مسترجع");
  if (status === "voided") return reportsText(language, "ملغي");
  return String(value || "").trim();
}

function expenseDescription(row: FinancialOverviewExpenseRowInput, language: DashboardLanguage): string {
  const title = exportV2SafeText(row.title, reportsText(language, "مصروف"));
  const note = String(row.note || "").trim();
  if (!note || note === "-" || note === "—" || note === title) return title;
  return `${title} — ${note}`;
}

export function buildFinancialOverviewReportData(
  input: FinancialOverviewReportInput
): ExportV2Report<FinancialMovementRow> {
  const language = input.language ?? "ar";
  const t = (text: string) => reportsText(language, text);
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
      movementType: t("إيراد"),
      date: String(row.date || "").trim(),
      reference: exportV2SafeText(row.mkRef, t("بدون مرجع")),
      classification: exportV2SafeText(row.source, t("دخل آخر")),
      responsible: exportV2SafeText(row.employeeName, t("غير محددة")),
      description: exportV2SafeText(row.note, t("حركة إيراد")),
      amount: moneyValue(row.amount),
      status: exportV2SafeText(row.statusLabel, t("نشط")),
    })),
    ...expenseRows.map((row): FinancialMovementRow => ({
      movementType: t("مصروف"),
      date: String(row.date || "").trim(),
      reference: exportV2SafeText(row.category, t("أخرى")),
      classification: exportV2SafeText(row.category, t("أخرى")),
      responsible: exportV2SafeText(row.addedBy, t("الإدارة")),
      description: expenseDescription(row, language),
      amount: -Math.abs(moneyValue(row.amount)),
      status: t("مصروف"),
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
    title: t("التقرير المالي العام"),
    subtitle: t("ملخص مالي موحد مع الحركات المطابقة للفلاتر الحالية"),
    summarySheetName: t("الملخص المالي"),
    detailsSheetName: t("الحركات المالية"),
    period: language === "ar"
      ? exportV2FormatPeriod(input.filters?.fromDate, input.filters?.toDate)
      : [
          input.filters?.fromDate ? `${t("من")} ${input.filters.fromDate}` : "",
          input.filters?.toDate ? `${t("إلى")} ${input.filters.toDate}` : "",
        ].filter(Boolean).join(" — ") || t("الفترة الحالية"),
    dateRange: {
      from: input.filters?.fromDate,
      to: input.filters?.toDate,
    },
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: exportV2SafeText(input.generatedBy, t("لوحة التقارير العامة")),
    branding: {
      salonName: language === "en" ? "MALIKAT" : "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },
    filters: [
      {
        label: t("نوع الفترة"),
        value: normalizePeriodLabel(input.filters?.periodLabel, language),
      },
      {
        label: t("طريقة الدفع"),
        value: exportV2SafeText(input.filters?.incomeMethod, t("الكل")),
      },
      {
        label: t("مصدر الإيراد"),
        value: exportV2SafeText(input.filters?.incomeSource, t("الكل")),
      },
      {
        label: t("حالة الإيراد"),
        value: normalizeStatusLabel(input.filters?.incomeStatus, language),
      },
      {
        label: t("دورة الرواتب"),
        value: exportV2SafeText(input.payrollCycle?.cycleKey, t("غير محددة")),
      },
      {
        label: t("فترة دورة الرواتب"),
        value: `${exportV2SafeText(input.payrollCycle?.fromDate, "—")} ${t("إلى")} ${exportV2SafeText(
          input.payrollCycle?.toDate,
          "—"
        )}`,
      },
    ],
    summary: [
      {
        label: t("إجمالي الإيرادات"),
        value: totalRevenue,
        type: "currency",
        tone: "success",
      },
      {
        label: t("إجمالي المصروفات"),
        value: totalExpenses,
        type: "currency",
        tone: "danger",
      },
      {
        label: t("صافي الربح / الخسارة"),
        value: net,
        type: "currency",
        tone: net >= 0 ? "gold" : "danger",
      },
      {
        label: t("عدد حركات الإيراد"),
        value: revenueRows.length,
        type: "number",
        tone: "dark",
      },
      {
        label: t("عدد المصروفات"),
        value: expenseRows.length,
        type: "number",
        tone: "dark",
      },
      {
        label: t("رواتب الدورة"),
        value: payrollSalary,
        type: "currency",
        tone: "neutral",
      },
      {
        label: t("أوفر تايم الدورة"),
        value: payrollOvertime,
        type: "currency",
        tone: payrollOvertime > 0 ? "gold" : "neutral",
      },
      {
        label: t("إجمالي مصروفات الدورة"),
        value: payrollCycleTotal || payrollSalary + payrollOvertime + payrollOther,
        type: "currency",
        tone: "danger",
      },
    ],
    columns: [
      {
        key: "movementType",
        header: t("نوع الحركة"),
        type: "status",
        width: 13,
        align: "center",
      },
      {
        key: "date",
        header: t("التاريخ"),
        type: "date",
        width: 14,
        align: "center",
      },
      {
        key: "reference",
        header: t("المرجع"),
        width: 18,
        align: "center",
      },
      {
        key: "classification",
        header: t("المصدر / التصنيف"),
        width: 18,
      },
      {
        key: "responsible",
        header: t("الموظفة / من أضافه"),
        width: 21,
      },
      {
        key: "description",
        header: t("الوصف والملاحظات"),
        width: 34,
      },
      {
        key: "amount",
        header: t("الأثر المالي"),
        type: "currency",
        width: 16,
        align: "center",
      },
      {
        key: "status",
        header: t("الحالة"),
        type: "status",
        width: 14,
        align: "center",
      },
    ],
    rows: movements,
    totals: {
      amount: net,
    },
    emptyMessage: t("لا توجد حركات مالية مطابقة للفلاتر الحالية."),
    notes: language === "en"
      ? [
          "Income appears as positive values and expenses as negative values in the financial movements sheet; the total equals net profit or loss.",
          "The report summary includes the current payroll cycle, salaries, overtime and other expenses calculated within the cycle.",
          strongestTrend
            ? `Highest activity period in the current chart: ${exportV2SafeText(strongestTrend.label, "—")}, with income ${moneyValue(strongestTrend.returns).toLocaleString("en-US")} SAR and expenses ${moneyValue(strongestTrend.investments).toLocaleString("en-US")} SAR.`
            : t("لا تتوفر بيانات اتجاه إضافية للفترة الحالية."),
          t("يعتمد التقرير على النتائج والفلاتر الظاهرة وقت التصدير، وليس على السجلات المستبعدة بالفلاتر."),
        ]
      : [
          "تظهر الإيرادات بقيم موجبة والمصروفات بقيم سالبة داخل ورقة الحركات المالية، ويطابق الإجمالي صافي الربح أو الخسارة.",
          "يشمل ملخص التقرير دورة الرواتب الحالية والرواتب والأوفر تايم والمصروفات الأخرى المحتسبة داخل الدورة.",
          strongestTrend
            ? `أعلى فترة حركة في الرسم الحالي: ${exportV2SafeText(strongestTrend.label, "—")}، بإيرادات ${moneyValue(strongestTrend.returns).toLocaleString("en-US")} ر.س ومصروفات ${moneyValue(strongestTrend.investments).toLocaleString("en-US")} ر.س.`
            : t("لا تتوفر بيانات اتجاه إضافية للفترة الحالية."),
          t("يعتمد التقرير على النتائج والفلاتر الظاهرة وقت التصدير، وليس على السجلات المستبعدة بالفلاتر."),
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
