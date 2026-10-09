import malikatLogo from "../../assets/images/ssunnamed.png";
import {
  calculatePayrollAccrualView,
  payrollEntryCarryoverNetHalalas,
  type PayrollEntryView,
} from "../../services/CorePayrollService";
import { formatAttendanceHours } from "../hr/attendanceDiscipline";
import {
  isPayrollCarryoverItem,
  nextPayrollMonth,
} from "../hr/payrollCarryoverPolicy.js";
import {
  payrollAttendanceObligationDeductionTotal,
  payrollObligationDeductionTotal,
  payrollOtherObligationDeductionTotal,
} from "../hr/payrollObligationPolicy.js";
import {
  exportV2FormatPeriod,
  exportV2SafeText,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";
import { exportPayrollExecutivePdf } from "../../services/exports-v2/payroll-executive-pdf";
import { exportPayrollExecutiveExcel, exportPayrollMobileExcel } from "../../services/exports-v2/payroll-executive-excel";
import { exportPayrollPayslipExecutivePdf } from "../../services/exports-v2/payroll-payslip-pdf";
import {
  exportPayrollPayslipExecutiveExcel,
  exportPayrollPayslipMobileExcel,
} from "../../services/exports-v2/payroll-payslip-excel";

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
  isForecast?: boolean;
  filters: PayrollReportV2Filters;
};

export type PayrollPayslipV2Input = {
  entry: PayrollEntryView;
  isForecast?: boolean;
  sourceCarryovers?: NonNullable<PayrollEntryView["carryoverAdjustments"]>;
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
  contractualAllowances: number;
  attendanceDays: number;
  absentDays: number;
  incompleteDays: number;
  scheduledHours: string;
  actualWorkedHours: string;
  missingHours: string;
  absenceDeduction: number;
  missingHoursDeduction: number;
  deferredAttendanceDeduction: number;
  deferredAttendanceTargetMonth: string;
  overtimeStatus: string;
  overtimeValue: number;
  additions: number;
  leaveCompensation: number;
  deductions: number;
  employeeGosiRate: string;
  insuranceDeduction: number;
  employerGosiRate: string;
  employerGosiContribution: number;
  carriedAttendanceDeduction: number;
  otherScheduledDeductions: number;
  advanceDeductions: number;
  manualDeductions: number;
  unclassifiedDeductions: number;
  previousPeriodAdjustment: number;
  expectedNet: number;
  status: string;
  notes: string;
};

type PayrollAttendanceExportSnapshot = PayrollEntryView["attendanceSummary"] & {
  attendanceDeferredMissingHoursDeductionHalalas?: number | null;
  attendanceDeductionDeferral?: {
    targetPayrollMonth?: string | null;
    amountHalalas?: number | null;
    status?: string | null;
  } | null;
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

const LTR_MARK = "\u200E";
const EXEMPTION_NOTE_PREFIXES = [
  "سبب الإعفاء:",
  "سبب الإعفاء من البصمة:",
  "معفى من البصمة للراتب:",
];

function uniqueCleanTexts(values: unknown[]) {
  return [
    ...new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    ),
  ];
}

function payrollPeriodDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : text;
}

function isolateLtr(value: string) {
  return value ? `${LTR_MARK}${value}${LTR_MARK}` : value;
}

function halalasToRiyals(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) / 100 : 0;
}

function gosiRateLabel(value: unknown) {
  const bps = Number(value);
  return Number.isFinite(bps) && bps >= 0
    ? `${Math.round(bps) / 100}%`
    : "غير محسوبة";
}

function isLeaveCompensationAddition(item: PayrollEntryView["additions"][number] | undefined) {
  if (!item) return false;
  const type = String(item.type || item.sourceType || "").trim().toLowerCase();
  const label = String(item.label || "").trim();
  const reason = String(item.reason || "").trim();
  return (
    type === "exceptional_financial_payment" ||
    type === "employee_financial_payment" ||
    label.includes("تعويض مالي بدل إجازة") ||
    label.includes("تعويض رصيد الإجازات") ||
    reason.includes("تعويض مالي بدل إجازة") ||
    reason.includes("تعويض رصيد الإجازات")
  );
}

export function payrollLeaveCompensationHalalas(entry: PayrollEntryView) {
  return (entry.additions || [])
    .filter((item) => isLeaveCompensationAddition(item))
    .reduce((sum, item) => sum + Math.max(0, Number(item.amountHalalas || 0)), 0);
}

function payrollCarryoverAdditionHalalas(entry: PayrollEntryView) {
  return (entry.additions || [])
    .filter(isPayrollCarryoverItem)
    .reduce((sum, item) => sum + Math.max(0, Number(item.amountHalalas || 0)), 0);
}

function payrollCarryoverDeductionHalalas(entry: PayrollEntryView) {
  return (entry.deductions || [])
    .filter(isPayrollCarryoverItem)
    .reduce((sum, item) => sum + Math.max(0, Number(item.amountHalalas || 0)), 0);
}

export function payrollOrdinaryAdditionsHalalas(entry: PayrollEntryView) {
  // "الإضافات والمكافآت" must never include contractual allowances,
  // overtime, leave compensation, or carryover adjustments.
  return payrollOrdinaryManualAdditionsHalalas(entry);
}

function isContractualAllowanceAddition(
  item: PayrollEntryView["additions"][number] | undefined
) {
  if (!item) return false;

  const haystack = [
    item.kind,
    item.type,
    item.sourceType,
    item.label,
    item.reason,
    item.note,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(" ");

  return (
    haystack.includes("housing allowance") ||
    haystack.includes("transport allowance") ||
    haystack.includes("transportation allowance") ||
    haystack.includes("بدل السكن") ||
    haystack.includes("بدل مواصلات") ||
    haystack.includes("بدل المواصلات") ||
    haystack.includes("بدل نقل")
  );
}

function payrollOrdinaryManualAdditionsHalalas(entry: PayrollEntryView) {
  /*
   * الإضافات والمكافآت تُشتق من بنود additions الفعلية فقط.
   * لا نعتمد manualAdditionsHalalas لأنه aggregate محفوظ وقد يحتوي
   * على بيانات تاريخية مختلطة.
   *
   * السكن والمواصلات مصدرهما allowancesHalalas ولا يدخلان هنا.
   */
  return (entry.additions || [])
    .filter((item) => !isLeaveCompensationAddition(item))
    .filter((item) => !isPayrollCarryoverItem(item))
    .filter((item) => !isContractualAllowanceAddition(item))
    .reduce(
      (sum, item) =>
        sum + Math.max(0, Number(item.amountHalalas || 0)),
      0
    );
}

export function payrollOrdinaryDeductionsHalalas(entry: PayrollEntryView) {
  return Math.max(0, Number(entry.totalDeductionsHalalas || 0) - payrollCarryoverDeductionHalalas(entry));
}

function payrollOrdinaryManualDeductionsHalalas(entry: PayrollEntryView) {
  return Math.max(
    0,
    Number(entry.manualDeductionsHalalas || 0) -
      payrollCarryoverDeductionHalalas(entry) -
      payrollObligationDeductionTotal(entry.deductions || [])
  );
}

function payrollUnclassifiedDeductionsHalalas(entry: PayrollEntryView) {
  const obligationDeductionsHalalas = payrollObligationDeductionTotal(entry.deductions || []);
  const manualDeductionsHalalas = payrollOrdinaryManualDeductionsHalalas(entry);
  const explainedHalalas =
    Math.max(0, Number(entry.absenceDeductionHalalas || 0)) +
    Math.max(0, Number(entry.missingHoursDeductionHalalas || 0)) +
    Math.max(0, Number(entry.insuranceDeductionHalalas || 0)) +
    Math.max(0, Number(entry.advancesHalalas || 0)) +
    obligationDeductionsHalalas +
    manualDeductionsHalalas;
  return Math.max(0, payrollOrdinaryDeductionsHalalas(entry) - explainedHalalas);
}

function statusLabel(value: unknown) {
  const key = String(value || "").trim();
  return STATUS_LABELS[key] || exportV2SafeText(key, "غير محدد");
}

function attendanceStatus(entry: PayrollEntryView, isForecast = false) {
  if (isForecast) return "لم تبدأ الفترة";

  if (
    entry.attendanceSummary.attendancePayrollMode === "exempt" ||
    entry.attendanceSummary.attendanceLinkStatus === "exempt"
  ) {
    return "معفى من البصمة";
  }

  const status = entry.attendanceSummary.attendanceLinkStatus;
  if (status === "confirmed") {
    return entry.attendanceSummary.incompleteDays > 0 ? "مؤكد - سجل حضور غير مكتمل" : "مؤكد";
  }
  if (status === "not_ready") return "غير جاهز";
  return "غير مربوط";
}
function setupStatus(entry: PayrollEntryView) {
  if (entry.payrollSetupComplete) return "مكتمل";
  const missing = Array.isArray(entry.payrollSetupMissing)
    ? uniqueCleanTexts(entry.payrollSetupMissing).join("، ")
    : "";
  return missing ? `غير مكتمل: ${missing}` : "غير مكتمل";
}

function rowNotes(entry: PayrollEntryView) {
  const attendanceSummary = entry.attendanceSummary;
  const isExempt =
    attendanceSummary.attendancePayrollMode === "exempt" ||
    attendanceSummary.attendanceLinkStatus === "exempt";
  let notes = uniqueCleanTexts([
    entry.notes,
    ...(attendanceSummary.attendanceNotes || []),
  ]);

  if (isExempt) {
    let exemptionReason = String(attendanceSummary.attendancePayrollExemptionReason || "").trim();
    if (!exemptionReason) {
      for (const note of notes) {
        const prefix = EXEMPTION_NOTE_PREFIXES.find((candidate) => note.startsWith(candidate));
        if (prefix) {
          exemptionReason = note.slice(prefix.length).trim();
          if (exemptionReason) break;
        }
      }
    }

    notes = notes.filter((note) => {
      if (note === exemptionReason) return false;
      return !EXEMPTION_NOTE_PREFIXES.some((prefix) => note.startsWith(prefix));
    });
    notes.push(exemptionReason ? `سبب الإعفاء: ${exemptionReason}` : "معفى من البصمة للراتب.");
  } else if (attendanceSummary.attendanceDeductionEligible === false) {
    notes.push(
      attendanceSummary.attendanceDeductionNote ||
        "لم يطبق خصم الحضور لأن ربط البصمات غير مكتمل أو غير مؤكد."
    );
  }

  return uniqueCleanTexts(notes).join(" | ") || "—";
}

function periodLabel(filters: PayrollReportV2Filters) {
  if (filters.periodStartDate || filters.periodEndDate) {
    return exportV2FormatPeriod(filters.periodStartDate, filters.periodEndDate);
  }
  return `${String(filters.month).padStart(2, "0")}/${filters.year}`;
}

function excelPeriodLabel(filters: PayrollReportV2Filters) {
  const from = payrollPeriodDate(filters.periodStartDate);
  const to = payrollPeriodDate(filters.periodEndDate);
  if (from && to) return `${isolateLtr(from)} — ${isolateLtr(to)}`;
  if (from) return `من ${isolateLtr(from)}`;
  if (to) return `إلى ${isolateLtr(to)}`;
  return isolateLtr(`${filters.year}/${String(filters.month).padStart(2, "0")}`);
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
    const leaveCompensationHalalas = payrollLeaveCompensationHalalas(entry);
    const attendanceSnapshot =
      entry.attendanceSummary as PayrollAttendanceExportSnapshot;
    const attendanceDeferral =
      attendanceSnapshot.attendanceDeductionDeferral || null;
    const deferredAttendanceDeductionHalalas = Math.max(
      0,
      Number(
        attendanceSnapshot.attendanceDeferredMissingHoursDeductionHalalas ??
          attendanceDeferral?.amountHalalas ??
          0
      ) || 0
    );
    return {
      employeeName: exportV2SafeText(entry.employeeName, "موظفة غير محددة"),
      jobTitle: exportV2SafeText(entry.jobTitle, "غير محدد"),
      setupStatus: setupStatus(entry),
      attendanceStatus: attendanceStatus(entry, Boolean(input.isForecast)),
      baseSalary: halalasToRiyals(entry.baseSalaryHalalas),
      contractualAllowances: halalasToRiyals(entry.allowancesHalalas),
      attendanceDays: Number(entry.attendanceSummary.attendanceDays || 0),
      absentDays: Number(entry.attendanceSummary.absentDays || 0),
      incompleteDays: Number(entry.attendanceSummary.incompleteDays || 0),
      scheduledHours: formatAttendanceHours(entry.attendanceSummary.totalScheduledHours),
      actualWorkedHours: formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours),
      missingHours: formatAttendanceHours(entry.attendanceSummary.totalMissingHours),
      absenceDeduction: halalasToRiyals(entry.absenceDeductionHalalas),
      missingHoursDeduction: halalasToRiyals(entry.missingHoursDeductionHalalas),
      deferredAttendanceDeduction: halalasToRiyals(
        deferredAttendanceDeductionHalalas
      ),
      deferredAttendanceTargetMonth:
        deferredAttendanceDeductionHalalas > 0
          ? exportV2SafeText(
              attendanceDeferral?.targetPayrollMonth,
              "غير محدد"
            )
          : "—",
      overtimeStatus: entry.overtimeEnabled ? "محتسب" : "غير محتسب",
      overtimeValue: halalasToRiyals(entry.overtimeValueHalalas),
      additions: halalasToRiyals(payrollOrdinaryAdditionsHalalas(entry)),
      leaveCompensation: halalasToRiyals(leaveCompensationHalalas),
      deductions: halalasToRiyals(payrollOrdinaryDeductionsHalalas(entry)),
      employeeGosiRate: gosiRateLabel(
        entry.gosiSnapshot?.employee?.totalRateBps
      ),
      insuranceDeduction: halalasToRiyals(entry.insuranceDeductionHalalas),
      employerGosiRate: gosiRateLabel(
        entry.gosiSnapshot?.employer?.totalRateBps
      ),
      employerGosiContribution: halalasToRiyals(entry.employerGosiContributionHalalas),
      carriedAttendanceDeduction: halalasToRiyals(
        payrollAttendanceObligationDeductionTotal(entry.deductions || [])
      ),
      otherScheduledDeductions: halalasToRiyals(
        payrollOtherObligationDeductionTotal(entry.deductions || [])
      ),
      advanceDeductions: halalasToRiyals(entry.advancesHalalas),
      manualDeductions: halalasToRiyals(payrollOrdinaryManualDeductionsHalalas(entry)),
      unclassifiedDeductions: halalasToRiyals(payrollUnclassifiedDeductionsHalalas(entry)),
      previousPeriodAdjustment: halalasToRiyals(payrollEntryCarryoverNetHalalas(entry)),
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
      acc.contractualAllowances += halalasToRiyals(entry.allowancesHalalas);
      acc.overtimeValue += halalasToRiyals(entry.overtimeValueHalalas);
      acc.additions += halalasToRiyals(payrollOrdinaryAdditionsHalalas(entry));
      acc.leaveCompensation += halalasToRiyals(payrollLeaveCompensationHalalas(entry));
      acc.deductions += halalasToRiyals(payrollOrdinaryDeductionsHalalas(entry));
      acc.previousPeriodAdjustment += halalasToRiyals(payrollEntryCarryoverNetHalalas(entry));
      acc.expectedNet += halalasToRiyals(accrual.expectedNetHalalas);
      return acc;
    },
    {
      baseSalary: 0,
      contractualAllowances: 0,
      overtimeValue: 0,
      additions: 0,
      leaveCompensation: 0,
      deductions: 0,
      previousPeriodAdjustment: 0,
      expectedNet: 0,
    }
  );

  const approvedCount = entries.filter((entry) => entry.status === "approved").length;
  const paidCount = entries.filter((entry) => entry.status === "paid").length;
  const allLocked = entries.length > 0 && entries.every((entry) => entry.status === "approved" || entry.status === "paid");
  const netExportLabel = allLocked ? "الصافي المعتمد للصرف" : "الصافي المتوقع للصرف";
  const excludedRows = Array.isArray(input.excludedRows) ? input.excludedRows : [];
  const reviewGroups = excludedRows.reduce(
    (acc, row) => {
      const reason = String(row.reason || "").trim();
      if (reason.includes("الراتب") || reason.includes("إعداد")) acc.payrollSetup.push(row.employeeName);
      else if (reason.includes("حضور") || reason.includes("بصمة")) acc.attendance.push(row.employeeName);
      else acc.other.push(row.employeeName);
      return acc;
    },
    { payrollSetup: [] as string[], attendance: [] as string[], other: [] as string[] }
  );
  const compactReviewNotes = [
    reviewGroups.payrollSetup.length
      ? `تحتاج استكمال إعداد الراتب: ${uniqueCleanTexts(reviewGroups.payrollSetup).join("، ")}.`
      : "",
    reviewGroups.attendance.length
      ? `تحتاج مراجعة الحضور قبل الاعتماد: ${uniqueCleanTexts(reviewGroups.attendance).join("، ")}.`
      : "",
    reviewGroups.other.length
      ? `تحتاج مراجعة إدارية: ${uniqueCleanTexts(reviewGroups.other).join("، ")}.`
      : "",
  ].filter(Boolean);
  const reviewTableRows = excludedRows.map((row) => ({
    employeeName: exportV2SafeText(row.employeeName, "موظفة غير محددة"),
    readiness: "مستبعد من التصدير الرسمي",
    reason: exportV2SafeText(row.reason, "يحتاج مراجعة"),
  }));

  return {
    slug: "payroll",
    reportCode: "HR-PAYROLL",
    title: input.isForecast
      ? "تقرير مسيرة الرواتب التقديري"
      : "تقرير مسيرة الرواتب",
    subtitle: input.isForecast
      ? "معاينة مستقبلية غير معتمدة؛ تعتمد القيم النهائية بعد بدء الفترة واحتساب الحضور."
      : "ملخص تنفيذي واضح للمسيرة الشهرية؛ تفاصيل الحضور التشغيلية الكاملة متاحة في Excel وكشف الموظفة.",
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
        value: input.isForecast
          ? "معاينة مستقبلية تقديرية — غير معتمدة"
          : input.includeIncomplete
            ? "يشمل السجلات غير المكتملة"
            : "السجلات المكتملة فقط",
      },
    ],
    summary: [
      { label: "إجمالي الرواتب الأساسية", value: totals.baseSalary, type: "currency", tone: "gold" },
      { label: "إجمالي البدلات التعاقدية", value: totals.contractualAllowances, type: "currency", tone: "neutral" },
      { label: "إجمالي الإضافات والمكافآت", value: totals.additions, type: "currency", tone: "success" },
      { label: "إجمالي الأوفر تايم", value: totals.overtimeValue, type: "currency", tone: totals.overtimeValue > 0 ? "success" : "neutral" },
      { label: "تعويض رصيد الإجازات", value: totals.leaveCompensation, type: "currency", tone: totals.leaveCompensation > 0 ? "gold" : "neutral" },
      { label: "إجمالي الخصومات", value: totals.deductions, type: "currency", tone: "danger" },
      { label: "تسويات فترات سابقة", value: totals.previousPeriodAdjustment, type: "currency", tone: totals.previousPeriodAdjustment < 0 ? "danger" : totals.previousPeriodAdjustment > 0 ? "success" : "neutral" },
      { label: netExportLabel, value: totals.expectedNet, type: "currency", tone: "dark" },
      { label: "السجلات المصدرة", value: rows.length, type: "number", tone: "dark" },
      { label: "إعدادات مكتملة", value: completeEntries.length, type: "number", tone: "success" },
      {
        label: "تحتاج مراجعة قبل الإقفال",
        value: excludedRows.length,
        type: "number",
        tone: excludedRows.length ? "danger" : "success",
      },
    ],
    columns: [
      { key: "employeeName", header: "الموظفة", width: 22 },
      { key: "jobTitle", header: "المسمى الوظيفي", width: 18 },
      { key: "setupStatus", header: "إعداد الراتب", width: 23 },
      { key: "attendanceStatus", header: "ربط الحضور", width: 17, align: "center" },
      { key: "baseSalary", header: "الراتب الأساسي", type: "currency", width: 16, align: "center" },
      { key: "contractualAllowances", header: "البدلات التعاقدية", type: "currency", width: 17, align: "center" },
      { key: "attendanceDays", header: "الحضور", type: "number", width: 11, align: "center", hideInPdf: true },
      { key: "absentDays", header: "الغياب", type: "number", width: 11, align: "center", hideInPdf: true },
      { key: "incompleteDays", header: "أيام غير مكتملة", type: "number", width: 13, align: "center", hideInPdf: true },
      { key: "scheduledHours", header: "الساعات المطلوبة", width: 16, align: "center", hideInPdf: true },
      { key: "actualWorkedHours", header: "الساعات الفعلية", width: 16, align: "center", hideInPdf: true },
      { key: "missingHours", header: "نقص الساعات", width: 14, align: "center", hideInPdf: true },
      { key: "absenceDeduction", header: "خصم الغياب", type: "currency", width: 14, align: "center", hideInPdf: true },
      { key: "missingHoursDeduction", header: "خصم نقص الساعات", type: "currency", width: 17, align: "center", hideInPdf: true },
      { key: "deferredAttendanceDeduction", header: "خصم حضور مؤجل (لا يخصم هذه الفترة)", type: "currency", width: 23, align: "center", hideInPdf: true },
      { key: "deferredAttendanceTargetMonth", header: "ترحيل خصم الحضور إلى", width: 18, align: "center", hideInPdf: true },
      { key: "overtimeStatus", header: "الأوفر تايم", type: "status", width: 14, align: "center", hideInPdf: true },
      { key: "overtimeValue", header: "قيمة الأوفر تايم", type: "currency", width: 17, align: "center", hideInPdf: true },
      { key: "additions", header: "الإضافات والمكافآت", type: "currency", width: 19, align: "center" },
      { key: "leaveCompensation", header: "تعويض رصيد الإجازات", type: "currency", width: 19, align: "center" },
      { key: "employeeGosiRate", header: "نسبة خصم الموظفة GOSI", width: 17, align: "center" },
      { key: "insuranceDeduction", header: "خصم GOSI للموظفة", type: "currency", width: 17, align: "center" },
      { key: "employerGosiRate", header: "نسبة مساهمة المنشأة GOSI", width: 19, align: "center" },
      { key: "employerGosiContribution", header: "مساهمة المنشأة GOSI", type: "currency", width: 19, align: "center" },
      { key: "carriedAttendanceDeduction", header: "خصم حضور (لم يخصم في الفترة السابقة)", type: "currency", width: 21, align: "center" },
      { key: "otherScheduledDeductions", header: "استقطاعات مجدولة أخرى", type: "currency", width: 20, align: "center" },
      { key: "advanceDeductions", header: "أقساط السلف", type: "currency", width: 16, align: "center" },
      { key: "manualDeductions", header: "خصومات يدوية أخرى", type: "currency", width: 18, align: "center" },
      { key: "unclassifiedDeductions", header: "خصومات أخرى غير مصنفة", type: "currency", width: 19, align: "center" },
      { key: "deductions", header: "إجمالي الخصومات قبل التسويات", type: "currency", width: 20, align: "center" },
      { key: "previousPeriodAdjustment", header: "تسوية فترات سابقة", type: "currency", width: 17, align: "center" },
      { key: "expectedNet", header: netExportLabel, type: "currency", width: 18, align: "center" },
      { key: "status", header: "الحالة", type: "status", width: 14, align: "center" },
      { key: "notes", header: "ملاحظات", width: 34, hideInPdf: true },
    ],
    rows,
    totals: {
      baseSalary: totals.baseSalary,
      contractualAllowances: totals.contractualAllowances,
      overtimeValue: totals.overtimeValue,
      additions: totals.additions,
      leaveCompensation: totals.leaveCompensation,
      deductions: totals.deductions,
      previousPeriodAdjustment: totals.previousPeriodAdjustment,
      expectedNet: totals.expectedNet,
    },
    extraTables: reviewTableRows.length
      ? [
          {
            name: "مراجعات قبل الإقفال",
            sheetName: "مراجعة قبل الإقفال",
            columns: [
              { key: "employeeName", header: "الموظفة", width: 22 },
              { key: "readiness", header: "الجاهزية", type: "status", width: 24, align: "center" },
              { key: "reason", header: "سبب الاستبعاد / الإجراء المطلوب", width: 46 },
            ],
            rows: reviewTableRows,
            emptyMessage: "لا توجد سجلات تحتاج مراجعة قبل الإقفال.",
          },
        ]
      : [],
    emptyMessage: "لا توجد رواتب مطابقة للفلاتر الحالية.",
    notes: [
      "البدلات التعاقدية مستقلة عن الإضافات والمكافآت وعن الأوفر تايم، ولا يجوز جمعها تحت بند واحد.",
      "نسبة GOSI للموظفة ونسبة مساهمة المنشأة تعرضان كلٌ على حدة؛ غير السعودي قد تكون نسبة الموظف 0% بينما تتحمل المنشأة أخطار المهنة حسب السياسة الفعالة.",
      "التقرير التنفيذي يعرض السجلات الجاهزة للتصدير الرسمي فقط، بينما تبقى تفاصيل الحضور التشغيلية كاملة في Excel.",
      "عند اعتماد المسيرة يصبح صافي الصرف Snapshot ثابتًا ولا يعاد فتح الشهر السابق ماليًا.",
      "أي فرق يظهر بعد الاعتماد عند الإقفال النهائي للفترة يُرحّل تلقائيًا كتسوية موثقة في أول مسيرة لاحقة، إضافة أو خصم، دون ازدواجية.",
      ...compactReviewNotes,
    ],
    pdfOrientation: "landscape",
  };
}

export function exportPayrollReportPdfV2(input: PayrollReportV2Input) {
  return exportPayrollExecutivePdf(buildPayrollReportDataV2(input));
}

export function exportPayrollReportExcelV2(input: PayrollReportV2Input) {
  const report = buildPayrollReportDataV2(input);
  return exportPayrollExecutiveExcel({
    ...report,
    period: excelPeriodLabel(input.filters),
  });
}

export function exportPayrollReportMobileExcelV2(input: PayrollReportV2Input) {
  const report = buildPayrollReportDataV2(input);
  return exportPayrollMobileExcel({
    ...report,
    period: excelPeriodLabel(input.filters),
  });
}

export function buildPayrollPayslipDataV2(
  input: PayrollPayslipV2Input
): ExportV2Report<PayslipExportRow> {
  const entry = input.entry;
  const accrual = calculatePayrollAccrualView(entry);
  const isLocked =
    entry.status === "approved" ||
    entry.status === "paid";

  const absenceDeductionHalalas =
    Math.max(
      0,
      Number(entry.absenceDeductionHalalas || 0)
    );

  const missingHoursDeductionHalalas =
    input.isForecast ||
    entry.attendanceSummary.attendanceDeductionEligible === false
      ? 0
      : Math.max(
          0,
          Number(entry.missingHoursDeductionHalalas || 0)
        );

  const insuranceDeductionHalalas =
    Math.max(
      0,
      Number(entry.insuranceDeductionHalalas || 0)
    );

  const advanceDeductionsHalalas =
    Math.max(
      0,
      Number(entry.advancesHalalas || 0)
    );

  const carriedAttendanceDeductionHalalas =
    payrollAttendanceObligationDeductionTotal(
      entry.deductions || []
    );

  const otherScheduledDeductionsHalalas =
    payrollOtherObligationDeductionTotal(
      entry.deductions || []
    );

  const manualDeductionsHalalas =
    payrollOrdinaryManualDeductionsHalalas(entry);

  const unclassifiedDeductionsHalalas =
    payrollUnclassifiedDeductionsHalalas(entry);

  const countedDeductionsHalalas =
    payrollOrdinaryDeductionsHalalas(entry);

  /*
   * The persisted payroll total is canonical. Individual source rows can
   * still describe amounts that were valid before a partial deferral.
   * Their excess over the canonical current-period total is disclosure-only
   * deferred deduction, not another deduction in the current payroll.
   */
  const displayedDeductionComponentsHalalas =
    absenceDeductionHalalas +
    missingHoursDeductionHalalas +
    insuranceDeductionHalalas +
    advanceDeductionsHalalas +
    carriedAttendanceDeductionHalalas +
    otherScheduledDeductionsHalalas +
    manualDeductionsHalalas +
    unclassifiedDeductionsHalalas;

  const deferredDeductionHalalas =
    Math.max(
      0,
      displayedDeductionComponentsHalalas -
        countedDeductionsHalalas
    );

  const deductionsBeforeDeferralHalalas =
    countedDeductionsHalalas +
    deferredDeductionHalalas;

  const finiteHalalas = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.round(parsed)
      : null;
  };

  const lateApprovalAudit =
    [...(entry.auditLog || [])]
      .reverse()
      .find(
        (event) =>
          String(event.action || "").trim() ===
          "late_approval_recorded"
      );

  const sourceCarryover =
    [...(input.sourceCarryovers || [])]
      .filter(
        (row) =>
          row.sourcePayrollEntryId === entry.id &&
          row.sourcePayrollMonth === entry.payrollMonth &&
          row.status !== "void"
      )
      .sort((a, b) =>
        String(
          b.updatedAt ||
            b.createdAt ||
            ""
        ).localeCompare(
          String(
            a.updatedAt ||
              a.createdAt ||
              ""
          )
        )
      )[0];

  const historicalApprovedNetHalalas =
    finiteHalalas(
      sourceCarryover?.approvedNetHalalas
    ) ??
    finiteHalalas(
      lateApprovalAudit?.approvedNetHalalas
    ) ??
    (
      isLocked
        ? Math.max(
            0,
            Number(
              accrual.expectedNetHalalas || 0
            )
          )
        : null
    );

  const derivedCanonicalNetHalalas =
    Math.max(
      0,
      Number(entry.grossSalaryHalalas || 0) +
        Number(
          entry.manualAdditionsHalalas || 0
        ) +
        Number(
          entry.overtimeValueHalalas || 0
        ) -
        Number(
          entry.totalDeductionsHalalas || 0
        )
    );

  const canonicalNetHalalas =
    finiteHalalas(
      sourceCarryover?.recalculatedNetHalalas
    ) ??
    finiteHalalas(
      lateApprovalAudit
        ?.systemCalculatedNetHalalasAtRecording
    ) ??
    derivedCanonicalNetHalalas;

  const carryoverAmountHalalas =
    Math.max(
      0,
      Number(
        sourceCarryover?.amountHalalas || 0
      )
    );

  const settlementDifferenceHalalas =
    sourceCarryover
      ? sourceCarryover.direction === "deduction"
        ? -carryoverAmountHalalas
        : carryoverAmountHalalas
      : isLocked &&
          historicalApprovedNetHalalas != null
        ? canonicalNetHalalas -
          historicalApprovedNetHalalas
        : 0;

  const settlementTargetMonth =
    String(
      sourceCarryover?.targetPayrollMonth ||
        ""
    ).trim() ||
    nextPayrollMonth(entry.payrollMonth) ||
    "الفترة التالية";

  const leaveCompensationHalalas =
    payrollLeaveCompensationHalalas(entry);

  const previousPeriodAdjustmentHalalas =
    payrollEntryCarryoverNetHalalas(entry);

  const rows: PayslipExportRow[] = [
    {
      item: "الراتب الأساسي",
      value: halalasToRiyals(
        entry.baseSalaryHalalas
      ),
      note: "",
    },
    {
      item: "البدلات التعاقدية",
      value: halalasToRiyals(
        entry.allowancesHalalas
      ),
      note:
        "بدلات العقد الثابتة؛ لا تعد مكافآت أو إضافات.",
    },
    {
      item: "الإضافات والمكافآت",
      value: halalasToRiyals(
        payrollOrdinaryManualAdditionsHalalas(
          entry
        )
      ),
      note:
        "لا يشمل تعويض رصيد الإجازات.",
    },
    {
      item: "تعويض رصيد الإجازات",
      value: halalasToRiyals(
        leaveCompensationHalalas
      ),
      note:
        leaveCompensationHalalas > 0
          ? "تعويض مالي مستقل عن المكافآت والإضافات، مرتبط بطلب التعويض المعتمد."
          : "لا يوجد",
    },
    {
      item: "الأوفر تايم",
      value: halalasToRiyals(
        entry.overtimeValueHalalas
      ),
      note:
        entry.overtimeEnabled
          ? "محتسب"
          : "غير محتسب",
    },
    {
      item: "خصم الغياب",
      value: halalasToRiyals(
        absenceDeductionHalalas
      ),
      note: "",
    },
    {
      item:
        "خصم نقص الساعات / التأخير / الخروج المبكر",
      value: halalasToRiyals(
        missingHoursDeductionHalalas
      ),
      note: input.isForecast
        ? "فترة مستقبلية؛ لم يبدأ احتساب الحضور بعد."
        : entry.attendanceSummary
              .attendanceDeductionEligible === false
          ? entry.attendanceSummary
                .attendancePayrollMode === "exempt"
            ? "معفى من الحضور والانصراف"
            : "لم يطبق"
          : "",
    },
    {
      item:
        "خصم التأمينات الاجتماعية (GOSI)",
      value: halalasToRiyals(
        insuranceDeductionHalalas
      ),
      note: entry.gosiSnapshot
        ? `السياسة: ${entry.gosiSnapshot.policyVersion}`
        : "لا يوجد Snapshot تأمينات محفوظ",
    },
    {
      item: "السلف",
      value: halalasToRiyals(
        advanceDeductionsHalalas
      ),
      note: "",
    },
    {
      item:
        "خصم حضور (لم يخصم في الفترة السابقة)",
      value: halalasToRiyals(
        carriedAttendanceDeductionHalalas
      ),
      note:
        "خصم حضور مستحق في هذه الفترة لأنه لم يخصم في الفترة السابقة.",
    },
    {
      item: "استقطاعات مجدولة أخرى",
      value: halalasToRiyals(
        otherScheduledDeductionsHalalas
      ),
      note:
        "استقطاعات مجدولة لا تشمل خصم الحضور المرحّل.",
    },
    {
      item:
        "الخصومات اليدوية والجزاءات الأخرى",
      value: halalasToRiyals(
        manualDeductionsHalalas
      ),
      note:
        "لا تشمل GOSI أو الالتزامات المجدولة أو تسويات الفترات السابقة.",
    },
    {
      item: "خصومات أخرى غير مصنفة",
      value: halalasToRiyals(
        unclassifiedDeductionsHalalas
      ),
      note:
        unclassifiedDeductionsHalalas > 0
          ? "فرق خصومات قائم داخل المسيرة ويحتاج تصنيفًا واضحًا."
          : "لا توجد",
    },
    {
      item:
        "إجمالي الخصومات المستحقة قبل التأجيل",
      value: halalasToRiyals(
        deductionsBeforeDeferralHalalas
      ),
      note:
        deferredDeductionHalalas > 0
          ? "يشمل المبلغ الذي تقرر تأجيل خصمه إلى فترة لاحقة."
          : "لا توجد خصومات مؤجلة.",
    },
    {
      item: "خصومات مؤجلة لفترة لاحقة",
      value: halalasToRiyals(
        deferredDeductionHalalas
      ),
      note:
        deferredDeductionHalalas > 0
          ? `لا تدخل في خصومات هذه الفترة؛ تم ترحيلها إلى ${settlementTargetMonth}.`
          : "لا يوجد",
    },
    {
      item: "تسويات فترات سابقة",
      value: halalasToRiyals(
        previousPeriodAdjustmentHalalas
      ),
      note:
        previousPeriodAdjustmentHalalas === 0
          ? "لا توجد"
          : "تسوية موثقة من مسيرة سابقة؛ الموجب إضافة والسالب خصم.",
    },
    {
      item:
        "إجمالي الخصومات المحتسبة لهذه الفترة",
      value: halalasToRiyals(
        countedDeductionsHalalas
      ),
      note:
        deferredDeductionHalalas > 0
          ? "هذا هو المبلغ الذي دخل فعليًا في حساب صافي هذه الفترة بعد استبعاد الخصومات المؤجلة."
          : "إجمالي الخصومات الفعلي في هذه الفترة.",
    },
    {
      item: "مساهمة المنشأة في GOSI",
      value: halalasToRiyals(
        entry.employerGosiContributionHalalas
      ),
      note:
        "تكلفة على المنشأة ولا تخصم من صافي الموظفة.",
    },
    ...(
      isLocked
        ? [
            {
              item:
                "الصافي النظامي بعد إعادة الاحتساب",
              value: halalasToRiyals(
                canonicalNetHalalas
              ),
              note:
                "القيمة الحالية المحسوبة Canonically داخل Core بعد جميع التصحيحات.",
            },
            {
              item:
                "فرق التسوية للفترة التالية",
              value: halalasToRiyals(
                settlementDifferenceHalalas
              ),
              note:
                settlementDifferenceHalalas > 0
                  ? `إضافة مستحقة للموظفة تُرحّل إلى ${settlementTargetMonth}.`
                  : settlementDifferenceHalalas < 0
                    ? `خصم تسوية يُرحّل إلى ${settlementTargetMonth}.`
                    : "لا يوجد فرق بين الاعتماد التاريخي والحساب النظامي الحالي.",
            },
            {
              item:
                "الصافي المعتمد تاريخيًا للصرف",
              value: halalasToRiyals(
                historicalApprovedNetHalalas
              ),
              note:
                "المبلغ المثبت فعليًا عند الاعتماد التاريخي؛ لا يعاد تغيير الشهر المعتمد بسبب تصحيحات لاحقة.",
            },
          ]
        : [
            {
              item:
                "الصافي المتوقع نهاية الفترة",
              value: halalasToRiyals(
                accrual.expectedNetHalalas
              ),
              note:
                "قيمة متوقعة حتى اعتماد المسيرة.",
            },
          ]
    ),
  ];

  const periodFrom =
    input.payrollBounds?.monthStart;

  const periodTo =
    input.payrollBounds?.monthEnd;

  const approvalOrPayDate =
    isLocked
      ? entry.approvedAt || "غير محدد"
      : input.payrollBounds?.payDate ||
        "غير محدد";

  const reconciliationTone: "danger" | "success" | "neutral" =
    settlementDifferenceHalalas < 0
      ? "danger"
      : settlementDifferenceHalalas > 0
        ? "success"
        : "neutral";

  return {
    slug:
      `payroll-payslip-${entry.employeeId}`,

    reportCode: "HR-PAYSLIP",

    title: input.isForecast
      ? "كشف راتب تقديري"
      : "كشف راتب موظفة",

    subtitle:
      `${exportV2SafeText(
        entry.employeeName
      )} — ${exportV2SafeText(
        entry.jobTitle,
        "موظفة"
      )}`,

    summarySheetName:
      "ملخص كشف الراتب",

    detailsSheetName:
      "بنود كشف الراتب",

    period: exportV2FormatPeriod(
      periodFrom,
      periodTo
    ),

    dateRange: {
      from: periodFrom,
      to: periodTo,
    },

    generatedAt:
      new Date().toISOString(),

    generatedBy:
      generatedBy(),

    branding: {
      salonName: "مَلِكات",
      brandName: "Malikat Salon",
      logoUrl: malikatLogo,
    },

    filters: [
      {
        label: "الشهر",
        value: entry.payrollMonth,
      },
      {
        label: "حالة الراتب",
        value: statusLabel(entry.status),
      },
      {
        label: isLocked
          ? "تاريخ الاعتماد الفعلي"
          : "تاريخ الصرف المتوقع",
        value: approvalOrPayDate,
      },
    ],

    summary: [
      {
        label: "الموظفة",
        value: entry.employeeName,
        tone: "dark",
      },
      {
        label: "الراتب الأساسي",
        value: halalasToRiyals(
          entry.baseSalaryHalalas
        ),
        type: "currency",
        tone: "gold",
      },
      {
        label:
          "البدلات التعاقدية",
        value: halalasToRiyals(
          entry.allowancesHalalas
        ),
        type: "currency",
        tone: "neutral",
      },
      {
        label:
          "الإضافات والمكافآت",
        value: halalasToRiyals(
          payrollOrdinaryAdditionsHalalas(
            entry
          )
        ),
        type: "currency",
        tone: "success",
      },
      {
        label: "الأوفر تايم",
        value: halalasToRiyals(
          entry.overtimeValueHalalas
        ),
        type: "currency",
        tone:
          entry.overtimeValueHalalas > 0
            ? "success"
            : "neutral",
      },
      {
        label:
          "تعويض رصيد الإجازات",
        value: halalasToRiyals(
          leaveCompensationHalalas
        ),
        type: "currency",
        tone:
          leaveCompensationHalalas > 0
            ? "gold"
            : "neutral",
      },
      {
        label:
          "إجمالي الخصومات المحتسبة لهذه الفترة",
        value: halalasToRiyals(
          countedDeductionsHalalas
        ),
        type: "currency",
        tone: "danger",
      },
      {
        label:
          "خصومات مؤجلة لفترة لاحقة",
        value: halalasToRiyals(
          deferredDeductionHalalas
        ),
        type: "currency",
        tone:
          deferredDeductionHalalas > 0
            ? "gold"
            : "neutral",
      },
      {
        label:
          "خصم GOSI للموظفة",
        value: halalasToRiyals(
          insuranceDeductionHalalas
        ),
        type: "currency",
        tone:
          insuranceDeductionHalalas > 0
            ? "danger"
            : "neutral",
      },
      {
        label:
          "مساهمة المنشأة GOSI",
        value: halalasToRiyals(
          entry.employerGosiContributionHalalas
        ),
        type: "currency",
        tone:
          entry.employerGosiContributionHalalas >
          0
            ? "gold"
            : "neutral",
      },
      ...(
        isLocked
          ? [
              {
                label:
                  "الصافي المعتمد تاريخيًا للصرف",
                value: halalasToRiyals(
                  historicalApprovedNetHalalas
                ),
                type: "currency" as const,
                tone: "dark" as const,
              },
              {
                label:
                  "الصافي النظامي بعد إعادة الاحتساب",
                value: halalasToRiyals(
                  canonicalNetHalalas
                ),
                type: "currency" as const,
                tone: "success" as const,
              },
              {
                label:
                  "فرق التسوية للفترة التالية",
                value: halalasToRiyals(
                  settlementDifferenceHalalas
                ),
                type: "currency" as const,
                tone: reconciliationTone,
              },
            ]
          : [
              {
                label:
                  "الصافي المتوقع للصرف",
                value: halalasToRiyals(
                  accrual.expectedNetHalalas
                ),
                type: "currency" as const,
                tone: "dark" as const,
              },
            ]
      ),
    ],

    columns: [
      {
        key: "item",
        header: "البند",
        width: 30,
      },
      {
        key: "value",
        header: "القيمة",
        type: "currency",
        width: 20,
        align: "center",
      },
      {
        key: "note",
        header: "ملاحظة",
        width: 42,
      },
    ],

    rows,

    totals: {},

    emptyMessage:
      "لا توجد بنود في كشف الراتب.",

    notes: [
      `الحضور: ${entry.attendanceSummary.attendanceDays} يوم، الغياب: ${entry.attendanceSummary.absentDays} يوم، البصمات الناقصة: ${entry.attendanceSummary.incompleteDays} يوم.`,

      `الساعات المطلوبة: ${formatAttendanceHours(
        entry.attendanceSummary
          .totalScheduledHours
      )}، الساعات الفعلية: ${formatAttendanceHours(
        entry.attendanceSummary
          .totalActualWorkedHours
      )}.`,

      deferredDeductionHalalas > 0
        ? `تم تأجيل ${halalasToRiyals(
            deferredDeductionHalalas
          ).toFixed(2)} ر.س من خصومات ${entry.payrollMonth} إلى ${settlementTargetMonth}، لذلك لا تدخل في إجمالي خصومات الفترة الحالية.`
        : "",

      isLocked &&
      settlementDifferenceHalalas !== 0
        ? `الصافي المعتمد تاريخيًا ${halalasToRiyals(
            historicalApprovedNetHalalas
          ).toFixed(2)} ر.س، بينما الصافي النظامي بعد إعادة الاحتساب ${halalasToRiyals(
            canonicalNetHalalas
          ).toFixed(2)} ر.س؛ فرق التسوية ${halalasToRiyals(
            settlementDifferenceHalalas
          ).toFixed(2)} ر.س يُرحّل إلى ${settlementTargetMonth}.`
        : "",

      rowNotes(entry),
    ].filter(
      (note) =>
        note &&
        note !== "—"
    ),

    pdfOrientation: "portrait",
  };
}

export function exportPayrollPayslipPdfV2(input: PayrollPayslipV2Input) {
  return exportPayrollPayslipExecutivePdf(buildPayrollPayslipDataV2(input));
}

export function exportPayrollPayslipExcelV2(input: PayrollPayslipV2Input) {
  return exportPayrollPayslipExecutiveExcel(buildPayrollPayslipDataV2(input));
}

export function exportPayrollPayslipMobileExcelV2(input: PayrollPayslipV2Input) {
  return exportPayrollPayslipMobileExcel(buildPayrollPayslipDataV2(input));
}
