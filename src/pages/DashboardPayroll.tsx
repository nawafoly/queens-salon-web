import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiDownload,
  FiEdit3,
  FiEye,
  FiFileText,
  FiPlus,
  FiRefreshCw,
  FiSave,
  FiShield,
  FiSliders,
  FiTarget,
  FiUnlock,
  FiX,
} from "react-icons/fi";
import {
  DashboardDatePickerV2,
  DashboardSelectV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreHrService } from "../services/CoreHrService";
import PayrollComplianceWorkspace from "./payroll/PayrollComplianceWorkspace";
import {
  approvePayrollEntry,
  calculatePayrollAccrualView,
  ensurePayrollPeriod,
  generatePayrollEntries,
  isEmployeePayrollEligible,
  loadPayrollMonth,
  markPayrollEntryPaid,
  reversePayrollEntryPayment,
  payrollMonthBounds,
  payrollAccrualPeriodStatus,
  payrollEntryCarryoverNetHalalas,
  reconcilePreviousPayrollCarryovers,
  recordLatePayrollApproval,
  reopenPayrollEntry,
  savePayrollDrafts,
  updatePayrollEntryAdjustments,
  previewPayrollEntrySnapshot,
  type PayrollEntryView,
} from "../services/CorePayrollService";
import type {
  CoreHrEmployee,
  CorePayrollCarryoverAdjustment,
  CorePayrollHistoricalSettlement,
} from "../types/hrCoreApi";
import {
  assertManualPayrollItem,
  formatPayrollMoney,
  isPayrollSnapshotLocked,
  riyalsToHalalas,
  type PayrollManualItem,
  type PayrollManualItemKind,
  type PayrollSetupMissingKey,
  type PayrollStatus,
} from "../helpers/hr/payrollCalculations";
import { payrollActionVisibility } from "../helpers/hr/payrollActions";
import { formatAttendanceHours } from "../helpers/hr/attendanceDiscipline";
import {
  payrollApprovalReadiness,
  payrollAttendanceReadiness,
} from "../helpers/hr/payrollReadiness.js";
import { isPayrollCarryoverItem } from "../helpers/hr/payrollCarryoverPolicy.js";
import {
  payrollAttendanceObligationDeductionTotal,
  payrollObligationDeductionTotal,
  payrollOtherObligationDeductionTotal,
} from "../helpers/hr/payrollObligationPolicy.js";
import {
  payrollExportExclusionReason,
} from "../helpers/reports/exportPayrollReport";
import {
  exportPayrollPayslipExcelV2,
  exportPayrollPayslipMobileExcelV2,
  exportPayrollPayslipPdfV2,
  exportPayrollReportExcelV2,
  exportPayrollReportMobileExcelV2,
  exportPayrollReportPdfV2,
  payrollLeaveCompensationHalalas,
  payrollOrdinaryAdditionsHalalas,
} from "../helpers/reports/exportPayrollReportV2";

type AdjustmentMode = "addition" | "deduction";

type AdjustmentDraft = {
  mode: AdjustmentMode;
  entry: PayrollEntryView;
  kind: PayrollManualItemKind;
  amount: string;
  reason: string;
  note: string;
};

type AttendanceDeferralDraft = {
  entry: PayrollEntryView;
  targetPayrollMonth: string;
  reason: string;
  note: string;
};

type PayrollApprovalConfirmationDraft = {
  entry: PayrollEntryView;
  expectedNetHalalas: number;
};

type ReopenPayrollDraft = {
  entry: PayrollEntryView;
  reason: string;
};

type PayrollLateApprovalDraft = {
  employeeId: string;
  approvalDate: string;
  approvedAmountRiyals: string;
  reason: string;
};

type PayrollPaymentControlDraft = {
  mode: "pay-batch" | "unpay-batch" | "unpay-one";
  entry: PayrollEntryView | null;
  reason: string;
};

type PayrollHistoricalSettlementDraft = {
  entry: PayrollEntryView;
  direction: "addition" | "deduction";
  amountRiyals: string;
  settlementMethod: "cash" | "bank_transfer" | "other";
  settlementDate: string;
  reason: string;
  reference: string;
  note: string;
};

type PayrollHistoricalSettlementVoidDraft = {
  settlement: CorePayrollHistoricalSettlement;
  reason: string;
};

type PayrollAttendanceDeferralSnapshot = PayrollEntryView["attendanceSummary"] & {
  attendanceDeferredMissingHoursDeductionHalalas?: number | null;
  attendanceDeductionDeferral?: {
    targetPayrollMonth?: string | null;
    amountHalalas?: number | null;
    status?: string | null;
  } | null;
};

const UNDEFINED_VALUE_LABEL = "غير محدد";

const STATUS_LABELS: Record<string, string> = {
  all: "كل الحالات",
  draft: "مسودة",
  reviewed: "تمت المراجعة",
  approved: "معتمد",
  paid: "مدفوع",
};

const PAYROLL_MONTH_OPTIONS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
].map((label, index) => ({ value: String(index + 1), label }));

const SETUP_MISSING_LABELS: Record<PayrollSetupMissingKey, string> = {
  employeeId: "معرف الموظفة غير محدد",
  baseSalary: "الراتب الأساسي غير محدد",
  workDays: "أيام العمل غير محددة",
  monthlyHours: "ساعات الفترة غير محددة",
  overtimeMultiplier: "معامل الأوفر تايم غير محدد",
};

const ADDITION_KINDS: Array<{ value: PayrollManualItemKind; label: string }> = [
  { value: "bonus", label: "مكافأة" },
  { value: "allowance", label: "بدل" },
  { value: "commission", label: "عمولة" },
  { value: "manual_addition", label: "إضافة يدوية" },
];

const DEDUCTION_KINDS: Array<{ value: PayrollManualItemKind; label: string }> = [
  { value: "penalty", label: "جزاء" },
  { value: "manual_deduction", label: "خصم يدوي" },
  { value: "other_deduction", label: "استقطاع آخر" },
];

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function riyadhTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function shiftDateKey(dateKey: string, days: number) {
  const [dateYear, dateMonth, dateDay] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(dateYear, dateMonth - 1, dateDay + days));
  return date.toISOString().slice(0, 10);
}


function replaceEntry(list: PayrollEntryView[], next: PayrollEntryView) {
  const key = `${next.employeeId}:${next.payrollMonth}`;
  const replaced = list.map((entry) =>
    `${entry.employeeId}:${entry.payrollMonth}` === key ? next : entry
  );
  if (replaced.some((entry) => `${entry.employeeId}:${entry.payrollMonth}` === key)) {
    return replaced;
  }
  return [...list, next];
}

function statusClass(status: string) {
  if (status === "paid") return "is-paid";
  if (status === "approved") return "is-approved";
  return "is-draft";
}

function itemKindLabel(kind: string) {
  return [...ADDITION_KINDS, ...DEDUCTION_KINDS].find((item) => item.value === kind)?.label || kind;
}

function payrollItemLabel(item: PayrollManualItem) {
  const type = String(item.type || item.sourceType || "").toLowerCase();
  const label = String(item.label || "");
  if (type === "exceptional_financial_payment" || type === "employee_financial_payment" || label.includes("تعويض مالي بدل إجازة")) {
    return "تعويض رصيد الإجازات";
  }
  return itemKindLabel(item.kind);
}

function carryoverDeductionHalalas(entry: PayrollEntryView) {
  return (entry.deductions || [])
    .filter(isPayrollCarryoverItem)
    .reduce((sum, item) => sum + Math.max(0, Number(item.amountHalalas || 0)), 0);
}

function ordinaryManualDeductionsHalalas(entry: PayrollEntryView) {
  return Math.max(
    0,
    Number(entry.manualDeductionsHalalas || 0) -
      carryoverDeductionHalalas(entry) -
      payrollObligationDeductionTotal(entry.deductions || [])
  );
}

function setupMissingLabels(entry: PayrollEntryView) {
  return entry.payrollSetupMissing.map((key) => SETUP_MISSING_LABELS[key] || key);
}

function setupMissing(entry: PayrollEntryView, key: PayrollSetupMissingKey) {
  return entry.payrollSetupMissing.includes(key);
}

function formatBaseSalary(entry: PayrollEntryView) {
  return setupMissing(entry, "baseSalary")
    ? "بيانات الراتب غير مكتملة"
    : formatPayrollMoney(entry.baseSalaryHalalas);
}

function formatSetupMoney(entry: PayrollEntryView, value: unknown) {
  return entry.payrollSetupComplete ? formatPayrollMoney(value) : UNDEFINED_VALUE_LABEL;
}

function formatMonthlyHours(entry: PayrollEntryView) {
  if (entry.attendanceSummary.attendancePayrollMode === "exempt") {
    return "غير مطلوبة — معفى من الحضور";
  }
  return entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "ساعات الفترة غير محددة";
}

function employeePayrollPath(entry: PayrollEntryView) {
  return `/dashboard/employees/${encodeURIComponent(entry.employeeId)}/payroll#payroll-settings`;
}

function employeeTargetPath(entry: PayrollEntryView) {
  return `/dashboard/employee-targets?employee=${encodeURIComponent(entry.employeeId)}&payrollMonth=${encodeURIComponent(entry.payrollMonth)}`;
}

function attendanceDeductionBlocked(entry: PayrollEntryView) {
  return entry.attendanceSummary.attendanceDeductionEligible === false;
}

function attendanceDeductionMessage(entry: PayrollEntryView) {
  if (
    entry.attendanceSummary.attendancePayrollMode ===
    "exempt"
  ) {
    const reason =
      entry.attendanceSummary
        .attendancePayrollExemptionReason || "";
    return reason
      ? `معفى من البصمة للراتب: ${reason}`
      : "معفى من البصمة للراتب.";
  }
  return entry.attendanceSummary.attendanceDeductionNote || "لم يتم تطبيق خصم الحضور لأن ربط البصمات غير مكتمل أو غير مؤكد.";
}

function attendancePayrollExempt(entry: PayrollEntryView) {
  return (
    entry.attendanceSummary.attendancePayrollMode === "exempt" ||
    entry.attendanceSummary.attendanceLinkStatus === "exempt"
  );
}

function attendanceLinkLabel(entry: PayrollEntryView) {
  if (attendancePayrollExempt(entry)) return "معفى من البصمة";

  const status = entry.attendanceSummary.attendanceLinkStatus;
  if (status === "confirmed") {
    return entry.attendanceSummary.incompleteDays > 0 ? "مؤكد - بصمة ناقصة" : "مؤكد";
  }
  if (status === "not_ready") return "غير جاهز";
  return "غير مربوط";
}
function formatAttendanceDeduction(entry: PayrollEntryView) {
  if (attendancePayrollExempt(entry)) return "معفى من الحضور والانصراف";
  if (!entry.payrollSetupComplete) return UNDEFINED_VALUE_LABEL;
  if (attendanceDeductionBlocked(entry)) return "لم يطبق";
  return formatPayrollMoney(entry.missingHoursDeductionHalalas);
}

function attendanceDeferralSnapshot(entry: PayrollEntryView) {
  return entry.attendanceSummary as PayrollAttendanceDeferralSnapshot;
}

function attendanceDeferredAmountHalalas(entry: PayrollEntryView) {
  const snapshot = attendanceDeferralSnapshot(entry);
  return Math.max(
    0,
    Number(
      snapshot.attendanceDeferredMissingHoursDeductionHalalas ??
        snapshot.attendanceDeductionDeferral?.amountHalalas ??
        0
    ) || 0
  );
}

function attendanceDeferralTargetMonth(entry: PayrollEntryView) {
  return String(attendanceDeferralSnapshot(entry).attendanceDeductionDeferral?.targetPayrollMonth || "").trim();
}

function payrollUnclassifiedDeductionsHalalas(entry: PayrollEntryView) {
  const obligationHalalas = payrollObligationDeductionTotal(entry.deductions || []);
  const manualHalalas = ordinaryManualDeductionsHalalas(entry);
  const ordinaryDeductionsHalalas = Math.max(
    0,
    Number(entry.totalDeductionsHalalas || 0) - carryoverDeductionHalalas(entry)
  );
  const explainedHalalas =
    Math.max(0, Number(entry.absenceDeductionHalalas || 0)) +
    Math.max(0, Number(entry.missingHoursDeductionHalalas || 0)) +
    Math.max(0, Number(entry.insuranceDeductionHalalas || 0)) +
    Math.max(0, Number(entry.advancesHalalas || 0)) +
    obligationHalalas +
    manualHalalas;
  return Math.max(0, ordinaryDeductionsHalalas - explainedHalalas);
}

function shiftPayrollMonth(monthKey: string, offset = 1) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function futurePayrollMonthOptions(monthKey: string, count = 12) {
  return Array.from({ length: count }, (_, index) => {
    const value = shiftPayrollMonth(monthKey, index + 1);
    return { value, label: value };
  });
}

function formatPreviousPeriodAdjustment(entry: PayrollEntryView) {
  const signed = payrollEntryCarryoverNetHalalas(entry);
  if (!signed) return "لا يوجد";
  return signed > 0
    ? `إضافة ${formatPayrollMoney(signed)}`
    : `خصم ${formatPayrollMoney(Math.abs(signed))}`;
}

function hasManualAdjustments(entry: PayrollEntryView) {
  return entry.additions.length > 0 || entry.deductions.length > 0;
}

function payrollOfficialExclusionReason(entry: PayrollEntryView) {
  const exportReason = payrollExportExclusionReason(entry);
  if (exportReason) return exportReason;

  const readiness = payrollApprovalReadiness(
    entry as unknown as Record<string, unknown>
  );
  return readiness.ready ? "" : readiness.message;
}

function isPayrollOfficialExportEligible(entry: PayrollEntryView) {
  return !payrollOfficialExclusionReason(entry);
}

function payrollActionErrorMessage(error: unknown, fallback: string) {
  const message = String((error as any)?.code || (error as any)?.message || error || "");
  if (message === "payroll_setup_incomplete") {
    return "لا يمكن اعتماد الراتب قبل إكمال بيانات الراتب.";
  }
  if (message === "payroll_not_approved") {
    return "لا يمكن تسجيل الراتب كمدفوع قبل اعتماده.";
  }
  if (message === "core_payroll:setup_incomplete") {
    return "لا يمكن اعتماد الراتب قبل إكمال بيانات الراتب.";
  }
  if (message === "core_payroll:not_approved") {
    return "لا يمكن تسجيل الراتب كمدفوع قبل اعتماده.";
  }
  if (message === "payroll_attendance_unconfirmed" || message === "core_payroll:payroll_attendance_unconfirmed") {
    return "لا يمكن اعتماد الراتب قبل تأكيد ربط الحضور بالموظفة.";
  }
  if (message === "payroll_attendance_incomplete" || message === "core_payroll:payroll_attendance_incomplete") {
    return "لا يمكن اعتماد الراتب قبل مراجعة البصمات الناقصة.";
  }
  if (message === "payroll_attendance_exemption_reason_required" || message === "core_payroll:payroll_attendance_exemption_reason_required") {
    return "سبب الإعفاء من البصمة مطلوب قبل اعتماد الراتب.";
  }
  if (message === "core_payroll:attendance_policy_mismatch") {
    return "سياسة الحضور في مسودة الراتب لا تطابق سياسة الموظف الحالية. أعد حساب المسيرة.";
  }
  if (message === "payroll_gosi_unconfigured" || message === "core_payroll:gosi_classification_required" || message === "core_payroll:gosi_snapshot_required") {
    return "إعداد التأمينات غير مكتمل لهذه الفترة. أكمل تصنيف GOSI وتاريخ السريان ثم أعد حساب المسيرة.";
  }
  if (message === "core_payroll:gosi_not_effective_for_payroll_period") {
    return "تصنيف GOSI الحالي غير ساري على فترة هذا المسير. راجع تاريخ السريان قبل الاعتماد.";
  }
  if (message === "core_payroll:gosi_gcc_extension_policy_required") {
    return "الموظفة مصنفة خليجية، وسياسة مد الحماية الخليجية غير مفعلة بعد. لا يمكن الاعتماد حتى استكمالها.";
  }
  if (message === "core_payroll:gosi_policy_mismatch") {
    return "Snapshot التأمينات في المسودة لا يطابق تصنيف GOSI الحالي. أعد حساب المسيرة.";
  }
  if (message === "core_payroll:gosi_employee_deduction_mismatch" || message === "core_payroll:gosi_employer_contribution_mismatch") {
    return "قيم GOSI في المسودة لا تطابق Snapshot التأمينات. أعد حساب المسيرة قبل الاعتماد.";
  }
  if (message === "core_payroll:obligation_snapshot_stale") {
    return "جدول الخصومات والالتزامات تغير بعد حساب المسودة. أعد حساب المسيرة قبل الاعتماد.";
  }
  if (message === "core_payroll:attendance_deferral_snapshot_stale") {
    return "تغيّر خصم الحضور بعد إنشاء التأجيل السابق. ألغِ التأجيل القديم ثم أعد إنشاءه بالمبلغ الحالي.";
  }
  if (message === "core_payroll:attendance_deferral_target_must_be_future") {
    return "شهر التحصيل يجب أن يكون بعد شهر الخصم الأصلي.";
  }
  if (message === "core_payroll:attendance_deferral_source_payroll_locked") {
    return "لا يمكن تأجيل خصم حضور من مسير معتمد أو مدفوع.";
  }
  if (message === "core_payroll:attendance_deferral_target_payroll_locked") {
    return "شهر التحصيل المختار مقفل بمسير معتمد أو مدفوع. اختر شهرًا آخر.";
  }
  if (message === "core_payroll:attendance_deferral_period_locked") {
    return "فترة المصدر أو شهر التحصيل مقفلة ولا تقبل التأجيل.";
  }
  if (message === "core_payroll:attendance_deduction_not_present") {
    return "لا يوجد خصم حضور حالي قابل للتأجيل لهذه الموظفة.";
  }
  if (message === "core_payroll:deduction_reason_required") {
    return "سبب التأجيل مطلوب.";
  }
  if (message === "core_payroll:advance_deduction_mismatch") {
    return "أقساط السلف المجدولة لا تطابق خصم المسيرة الحالي. أعد الحساب قبل تسجيل الدفع.";
  }
  if (message === "core_payroll:employee_not_active") {
    return "لا يمكن اعتماد مسير لموظفة غير نشطة حاليًا.";
  }
  if (message === "core_payroll:employee_not_payroll_eligible") {
    return "الموظفة غير مؤهلة لمسير راتب حالي لأنها لا تملك راتبًا أساسيًا موجبًا.";
  }
  if (message === "payroll_late_approval_entry_must_be_saved") {
    return "احفظ مسودة راتب الموظفة أولًا قبل تسجيل اعتماد متأخر.";
  }
  if (message === "core_payroll:already_approved") {
    return "هذه المسيرة معتمدة بالفعل ولا تحتاج تسجيل اعتماد متأخر.";
  }
  if (message === "core_payroll:late_approval_date_outside_period") {
    return "تاريخ الاعتماد الفعلي يجب أن يكون داخل شهر المسيرة نفسها.";
  }
  if (message === "core_payroll:late_approval_date_must_be_past") {
    return "الاعتماد المتأخر يقبل تاريخًا سابقًا فقط. لاعتماد اليوم استخدم زر اعتماد العادي.";
  }
  if (message === "core_payroll:late_approval_amount_invalid") {
    return "المبلغ المعتمد فعليًا غير صالح.";
  }
  if (message === "core_payroll:late_approval_reason_required") {
    return "سبب التسجيل المتأخر مطلوب.";
  }
  if (message === "core_payroll:late_approval_invalid_status") {
    return "حالة هذه المسيرة لا تسمح بتسجيل اعتماد متأخر.";
  }
  if (
    message === "payroll_payment_reversal_reason_required" ||
    message === "core_payroll:payment_reversal_reason_required"
  ) {
    return "سبب إلغاء تسجيل الدفع مطلوب.";
  }
  if (message === "payroll_not_paid" || message === "core_payroll:not_paid") {
    return "لا يمكن إلغاء تسجيل الدفع لأن الراتب غير مسجل كمدفوع.";
  }
  if (message === "payroll_payment_reversal_entry_must_be_saved") {
    return "لا يمكن إلغاء تسجيل الدفع لسجل غير محفوظ.";
  }
  if (message === "core_payroll:payment_concurrent_mutation") {
    return "تغيّرت حالة الراتب أثناء تسجيل الدفع. حدّث الصفحة وتحقق من حالة المسيرة.";
  }
  if (message === "core_payroll:payment_advance_settlement_incomplete") {
    return "لم تكتمل تسوية أقساط السلفة مع تسجيل الدفع. لم يتم اعتماد الحالة كعملية مكتملة.";
  }
  if (message === "core_payroll:payment_reversal_concurrent_mutation") {
    return "تغيّرت حالة الراتب أثناء إلغاء الدفع. حدّث الصفحة وتحقق من حالة المسيرة.";
  }
  if (message === "core_payroll:payment_reversal_advance_incomplete") {
    return "لم تكتمل إعادة أقساط السلفة بعد إلغاء الدفع.";
  }
  if (message === "core_payroll:payment_reversal_obligation_incomplete") {
    return "لم تكتمل إعادة التزامات الراتب بعد إلغاء الدفع.";
  }
  if (message === "core_payroll:approval_concurrent_mutation") {
    return "تغيّرت حالة المسيرة أثناء الاعتماد. حدّث الصفحة وتحقق من الحالة الحالية.";
  }
  if (message === "core_payroll:payment_reversal_obligation_cancelled") {
    return "لا يمكن عكس الدفع لأن أحد التزامات الراتب المرتبطة أُلغي بعد الدفع.";
  }
  if (message === "payroll_paid_reopen_not_allowed" || message === "core_payroll:paid_reopen_not_allowed") {
    return "لا يمكن إعادة فتح راتب مدفوع. يحتاج ذلك مسار إلغاء دفع منفصل.";
  }
  if (message === "payroll_reopen_reason_required") {
    return "سبب إعادة فتح الراتب مطلوب.";
  }
  if (message === "core_payroll:reopen_has_applied_downstream_carryover") {
    return "لا يمكن إعادة فتح هذه المسيرة لأن فرقًا منها تم تطبيقه بالفعل في مسيرة لاحقة. يجب معالجة المسيرة اللاحقة أولًا.";
  }
  if (message === "core_payroll:reopen_concurrent_mutation") {
    return "تغيّرت حالة المسيرة أثناء إعادة الفتح. حدّث الصفحة وحاول مرة أخرى.";
  }
  if (message === "core_payroll:no_historical_settlement_outstanding") {
    return "لا يوجد فرق مالي متبقٍ على هذه الفترة المقفلة.";
  }
  if (message === "core_payroll:historical_settlement_exceeds_outstanding") {
    return "مبلغ التسوية أكبر من الفرق المالي المتبقي.";
  }
  if (message === "core_payroll:historical_settlement_direction_mismatch") {
    return "اتجاه التسوية لا يطابق الفرق المالي الحالي.";
  }
  if (message === "core_payroll:historical_settlement_reason_required") {
    return "سبب التسوية اللاحقة مطلوب.";
  }
  if (message === "core_payroll:historical_settlement_void_reason_required") {
    return "سبب إلغاء التسوية مطلوب.";
  }
  if (message === "core_payroll:historical_settlement_date_future") {
    return "تاريخ التسوية لا يمكن أن يكون في المستقبل.";
  }
  return String((error as any)?.message || fallback);
}

export default function DashboardPayroll() {
  const { hasPermission, role } = usePermissions();
  const canManage = hasPermission("payroll.manage");
  const canRecordLateApproval =
    canManage &&
    ["owner", "admin", "hr"].includes(
      String(role || "").trim().toLowerCase()
    );
  const initial = currentYearMonth();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employees, setEmployees] = useState<CoreHrEmployee[]>([]);
  const [entries, setEntries] = useState<PayrollEntryView[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<PayrollEntryView | null>(null);
  const [adjustment, setAdjustment] = useState<AdjustmentDraft | null>(null);
  const [attendanceDeferral, setAttendanceDeferral] = useState<AttendanceDeferralDraft | null>(null);
  const [approvalConfirmation, setApprovalConfirmation] =
    useState<PayrollApprovalConfirmationDraft | null>(null);
  const [lateApproval, setLateApproval] =
    useState<PayrollLateApprovalDraft | null>(null);
  const [reopenDraft, setReopenDraft] = useState<ReopenPayrollDraft | null>(null);
  const [paymentControl, setPaymentControl] =
    useState<PayrollPaymentControlDraft | null>(null);
  const [sourceCarryovers, setSourceCarryovers] =
    useState<CorePayrollCarryoverAdjustment[]>([]);
  const [historicalSettlements, setHistoricalSettlements] =
    useState<CorePayrollHistoricalSettlement[]>([]);
  const [historicalSettlementDraft, setHistoricalSettlementDraft] =
    useState<PayrollHistoricalSettlementDraft | null>(null);
  const [historicalSettlementVoidDraft, setHistoricalSettlementVoidDraft] =
    useState<PayrollHistoricalSettlementVoidDraft | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    entry: PayrollEntryView;
    top: number;
    left: number;
    placement: "above" | "below";
  } | null>(null);
  const [includeIncompleteExport, setIncludeIncompleteExport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loadGenerationRef = useRef(0);

  const payrollBounds = payrollMonthBounds(year, month);
  const payrollMonth = payrollBounds.payrollMonth;

  const currentPeriod = currentYearMonth();
  const currentPayrollMonth =
    String(currentPeriod.year) +
    "-" +
    String(currentPeriod.month).padStart(2, "0");

  const isFuturePayrollPeriod = payrollMonth > currentPayrollMonth;

  const refreshHistoricalSettlementState = async (
    entry: PayrollEntryView | null
  ) => {
    if (
      !entry?.id ||
      !["approved", "paid"].includes(String(entry.status || ""))
    ) {
      setSourceCarryovers([]);
      setHistoricalSettlements([]);
      return;
    }

    const [settlements, carryovers] = await Promise.all([
      CoreHrService.listPayrollHistoricalSettlements({
        sourcePayrollEntryId: entry.id,
      }),
      CoreHrService.listPayrollCarryovers({
        employeeId: entry.employeeId,
        sourcePayrollMonth: entry.payrollMonth,
      }),
    ]);

    setHistoricalSettlements(
      settlements.filter(
        (row) => row.sourcePayrollEntryId === entry.id
      )
    );
    setSourceCarryovers(
      carryovers.filter(
        (row) => row.sourcePayrollEntryId === entry.id
      )
    );
  };

  const futureExportExclusionReason = (entry: PayrollEntryView) => {
    if (!entry.payrollSetupComplete) {
      return "إعداد الراتب غير مكتمل.";
    }

    const gosi = entry.gosiSnapshot as any;
    if (!gosi?.policyVersion || !gosi?.insuranceCategory) {
      return "إعداد GOSI غير مكتمل أو غير ساري على الفترة.";
    }

    return "";
  };

  const selectedPeriodExportExclusionReason = (entry: PayrollEntryView) =>
    isFuturePayrollPeriod
      ? futureExportExclusionReason(entry)
      : payrollOfficialExclusionReason(entry);

  const isSelectedPeriodExportEligible = (entry: PayrollEntryView) =>
    !selectedPeriodExportExclusionReason(entry);

  const openPayrollActionMenu = (event: any, entry: PayrollEntryView) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 260;
    const estimatedHeight = 360;
    const gap = 8;
    const edge = 12;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: "above" | "below" =
      spaceBelow >= estimatedHeight + gap || spaceBelow >= spaceAbove
        ? "below"
        : "above";

    const top = placement === "below" ? rect.bottom + gap : rect.top - gap;

    const left = Math.max(
      edge,
      Math.min(
        rect.right - width,
        window.innerWidth - width - edge
      )
    );

    setActionMenu({ entry, top, left, placement });
  };

  const load = async () => {
    const generation = ++loadGenerationRef.current;
    const requestedYear = year;
    const requestedMonth = month;
    const requestIsCurrent = () => generation === loadGenerationRef.current;

    setLoading(true);
    setError("");
    try {
      const [employeeRows, payroll] = await Promise.all([
        CoreHrService.listEmployees({ status: "active" }),
        loadPayrollMonth({ year: requestedYear, month: requestedMonth }),
      ]);
      const eligibleEmployeeRows = employeeRows.filter(isEmployeePayrollEligible);
      const excludedEmployeeCount = employeeRows.length - eligibleEmployeeRows.length;
      const previewEntries = await generatePayrollEntries({
        year: requestedYear,
        month: requestedMonth,
        currentEntries: payroll.entries,
      });
      if (!requestIsCurrent()) return;
      const savedCount = previewEntries.filter((entry) => entry.saved).length;
      const previewCount = previewEntries.length - savedCount;

      setEmployees(eligibleEmployeeRows);
      setEntries(previewEntries);
      setMessage(
        previewEntries.length
          ? `تم تحميل ${previewEntries.length} سجل مسير: ${savedCount} محفوظ و${previewCount} معاينة محسوبة دون حفظ.${excludedEmployeeCount ? ` تم استبعاد ${excludedEmployeeCount} حساب/موظف نشط بلا راتب أساسي من إنشاء المسير.` : ""}`
          : excludedEmployeeCount
            ? `لا توجد موظفات مؤهلات لمسير هذا الشهر. تم استبعاد ${excludedEmployeeCount} حساب/موظف نشط بلا راتب أساسي.`
            : "لا توجد موظفات نشطات مطابقة لهذا الشهر."
      );
    } catch (loadError: any) {
      if (!requestIsCurrent()) return;
      setError(String(loadError?.message || "تعذر تحميل إدارة الرواتب."));
    } finally {
      if (requestIsCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [year, month]);

  useEffect(() => {
    let cancelled = false;

    if (
      !selectedEntry?.id ||
      !["approved", "paid"].includes(String(selectedEntry.status || ""))
    ) {
      setSourceCarryovers([]);
      setHistoricalSettlements([]);
      return () => {
        cancelled = true;
      };
    }

    Promise.all([
      CoreHrService.listPayrollHistoricalSettlements({
        sourcePayrollEntryId: selectedEntry.id,
      }),
      CoreHrService.listPayrollCarryovers({
        employeeId: selectedEntry.employeeId,
        sourcePayrollMonth: selectedEntry.payrollMonth,
      }),
    ])
      .then(([settlements, carryovers]) => {
        if (cancelled) return;
        setHistoricalSettlements(
          settlements.filter(
            (row) => row.sourcePayrollEntryId === selectedEntry.id
          )
        );
        setSourceCarryovers(
          carryovers.filter(
            (row) => row.sourcePayrollEntryId === selectedEntry.id
          )
        );
      })
      .catch((settlementError: any) => {
        if (cancelled) return;
        setError(
          String(
            settlementError?.message ||
              "تعذر تحميل تسويات الفترة المقفلة."
          )
        );
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntry?.id, selectedEntry?.status]);

  const visibleEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (entry.payrollMonth !== payrollMonth) return false;
        if (employeeFilter !== "all" && entry.employeeId !== employeeFilter) return false;
        if (statusFilter !== "all" && entry.status !== statusFilter) return false;
        return true;
      }),
    [employeeFilter, entries, payrollMonth, statusFilter]
  );

  const lateApprovalCandidates = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.payrollMonth === payrollMonth &&
          !["approved", "paid"].includes(entry.status)
      ),
    [entries, payrollMonth]
  );

  const selectedLateApprovalEntry = lateApproval
    ? lateApprovalCandidates.find(
        (entry) => entry.employeeId === lateApproval.employeeId
      ) || null
    : null;

  const lateApprovalMaxDate = (() => {
    const yesterday = shiftDateKey(riyadhTodayDateKey(), -1);
    return payrollBounds.monthEnd < yesterday
      ? payrollBounds.monthEnd
      : yesterday;
  })();

  const approvedPaymentEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.payrollMonth === payrollMonth &&
          entry.status === "approved"
      ),
    [entries, payrollMonth]
  );

  const paidPaymentEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.payrollMonth === payrollMonth &&
          entry.status === "paid"
      ),
    [entries, payrollMonth]
  );

  const paymentControlTargets = paymentControl
    ? paymentControl.mode === "pay-batch"
      ? approvedPaymentEntries
      : paymentControl.mode === "unpay-batch"
        ? paidPaymentEntries
        : paymentControl.entry
          ? [paymentControl.entry]
          : []
    : [];

  const paymentControlTotalHalalas = paymentControlTargets.reduce(
    (total, entry) => total + Math.max(0, Number(entry.netSalaryHalalas || 0)),
    0
  );

  const summary = useMemo(() => {
    return visibleEntries.reduce(
      (acc, entry) => {
        const attendanceReadiness = payrollAttendanceReadiness(entry.attendanceSummary);
        const approvalReadiness = payrollApprovalReadiness(
          entry as unknown as Record<string, unknown>
        );
        const exportEligible = isSelectedPeriodExportEligible(entry);

        acc.count += 1;
        if (entry.saved) acc.saved += 1;
        else acc.preview += 1;
        if (attendancePayrollExempt(entry)) acc.exempt += 1;
        if (exportEligible) acc.exportReady += 1;

        if (entry.payrollSetupComplete) {
          acc.complete += 1;
          acc.base += entry.baseSalaryHalalas;
          acc.allowances += entry.allowancesHalalas;
          acc.additions += payrollOrdinaryAdditionsHalalas(entry);
          acc.overtime += entry.overtimeValueHalalas;
          acc.leaveCompensation += payrollLeaveCompensationHalalas(entry);
          acc.deductions += entry.totalDeductionsHalalas;
          acc.net += entry.netSalaryHalalas;
          acc.earned += calculatePayrollAccrualView(entry).earnedToDateHalalas;
          if (isFuturePayrollPeriod) {
            if (!exportEligible && entry.payrollSetupComplete) {
              acc.gosiReview += 1;
            }
          } else if (!attendanceReadiness.ready) {
            acc.attendanceReview += 1;
          } else if (!approvalReadiness.ready && approvalReadiness.stage === "gosi") {
            acc.gosiReview += 1;
          }
        } else {
          acc.incomplete += 1;
        }
        if (entry.status === "draft") acc.drafts += 1;
        if (entry.status === "approved") acc.approved += 1;
        if (entry.status === "paid") acc.paid += 1;
        return acc;
      },
      {
        count: 0,
        complete: 0,
        incomplete: 0,
        exportReady: 0,
        attendanceReview: 0,
        gosiReview: 0,
        exempt: 0,
        saved: 0,
        preview: 0,
        base: 0,
        allowances: 0,
        additions: 0,
        overtime: 0,
        leaveCompensation: 0,
        deductions: 0,
        net: 0,
        earned: 0,
        drafts: 0,
        approved: 0,
        paid: 0,
      }
    );
  }, [visibleEntries, isFuturePayrollPeriod]);

  const selectedEmployeeName =
    employeeFilter === "all"
      ? "كل الموظفات"
      : employees.find((employee) => employee.id === employeeFilter)?.name || employeeFilter;
  const selectedStatusLabel = STATUS_LABELS[statusFilter] || statusFilter;
  const officialExportableCount = visibleEntries.filter(
    isPayrollOfficialExportEligible
  ).length;

  const periodExportableCount = visibleEntries.filter(
    isSelectedPeriodExportEligible
  ).length;

  const exportableEntries = includeIncompleteExport
    ? visibleEntries
    : visibleEntries.filter(isSelectedPeriodExportEligible);

  const exportableCount = exportableEntries.length;

  const payrollCycleLabel =
    "فترة الاحتساب: " +
    payrollBounds.monthStart +
    " إلى " +
    payrollBounds.monthEnd +
    " · الصرف المتوقع: " +
    payrollBounds.payDate;

  const payrollPeriodStatus = payrollAccrualPeriodStatus(payrollMonth);

  const payrollPartialLabel = isFuturePayrollPeriod
    ? "فترة مستقبلية — معاينة تقديرية غير معتمدة"
    : payrollPeriodStatus.isPartial
      ? "مسيرة جزئية محسوبة حتى " +
        (payrollPeriodStatus.completedThroughDate || "لم تبدأ الفترة")
      : "مسيرة مكتملة / نهائية";

  const payrollReportInput = () => {
    const exportedEntries = exportableEntries;
    const excludedRows = includeIncompleteExport
      ? []
      : visibleEntries
          .filter((entry) => !isSelectedPeriodExportEligible(entry))
          .map((entry) => ({
            employeeName: entry.employeeName || entry.employeeId || "غير متوفر",
            reason:
              selectedPeriodExportExclusionReason(entry) ||
              "غير قابل للتصدير",
          }));

    return {
      entries: exportedEntries,
      includeIncomplete: includeIncompleteExport,
      isForecast: isFuturePayrollPeriod,
      originalCount: visibleEntries.length,
      excludedRows,
      filters: {
        year,
        month,
        employeeName: selectedEmployeeName,
        statusLabel: selectedStatusLabel,
        periodStartDate: payrollBounds.monthStart,
        periodEndDate: payrollBounds.monthEnd,
        payDate: payrollBounds.payDate,
      },
    };
  };

  const handleExportPayrollPdf = () => {
    exportPayrollReportPdfV2(payrollReportInput());
  };

  const handleExportPayrollExcel = () => {
    exportPayrollReportExcelV2(payrollReportInput());
  };

  const handleExportPayrollMobileExcel = () => {
    exportPayrollReportMobileExcelV2(payrollReportInput());
  };

  const handleGenerate = async (recalculate = false) => {
    if (!canManage) return;
    setBusy(recalculate ? "recalculate" : "generate");
    setError("");
    try {
      const carryoverSync = await reconcilePreviousPayrollCarryovers({
        year,
        month,
        employeeId: employeeFilter === "all" ? undefined : employeeFilter,
      });
      const period = await ensurePayrollPeriod(year, month);
      const generated = await generatePayrollEntries({
        year,
        month,
        employeeId: employeeFilter === "all" ? undefined : employeeFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        currentEntries: entries,
      });
      const withPeriod = generated.map((entry) => ({ ...entry, periodId: entry.periodId || period.id }));
      setEntries((current) => {
        let next = current.filter(
          (entry) =>
            entry.payrollMonth !== payrollMonth ||
            !withPeriod.some((draft) => draft.employeeId === entry.employeeId)
        );
        next = [...next, ...withPeriod];
        return next;
      });
      const carryoverCount = Array.isArray(carryoverSync.results)
        ? carryoverSync.results.filter((row: any) => Number(row?.residualSignedHalalas || 0) !== 0).length
        : 0;
      setMessage(
        (recalculate
          ? `تمت إعادة الحساب للفترة ${period.monthStart} إلى ${period.monthEnd}.`
          : `تم توليد مسيرة الشهر للفترة ${period.monthStart} إلى ${period.monthEnd} كمسودات جاهزة للحفظ.`) +
          (carryoverCount ? ` تمت مزامنة ${carryoverCount} تسوية من الفترة السابقة.` : "")
      );
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر توليد مسيرة الرواتب."));
    } finally {
      setBusy("");
    }
  };

  const handleSaveDrafts = async () => {
    if (!canManage) return;
    setBusy("save");
    setError("");
    try {
      const period = await ensurePayrollPeriod(year, month);
      const prepared = visibleEntries.map((entry) => ({ ...entry, periodId: entry.periodId || period.id }));
      const saved = await savePayrollDrafts(prepared);
      setEntries((current) => saved.reduce(replaceEntry, current));
      setMessage(`تم حفظ ${saved.length} مسودة في نظام الرواتب.`);
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر حفظ مسودات الرواتب."));
    } finally {
      setBusy("");
    }
  };

  const openBatchPaymentControl = (
    mode: "pay-batch" | "unpay-batch"
  ) => {
    const targets =
      mode === "pay-batch" ? approvedPaymentEntries : paidPaymentEntries;

    if (!targets.length) {
      setError(
        mode === "pay-batch"
          ? "لا توجد رواتب معتمدة جاهزة لتسجيل الدفع."
          : "لا توجد رواتب مسجلة كمدفوعة لإلغاء تسجيلها."
      );
      return;
    }

    setError("");
    setPaymentControl({
      mode,
      entry: null,
      reason: "",
    });
  };

  const openSinglePaymentReversal = (entry: PayrollEntryView) => {
    setError("");
    setPaymentControl({
      mode: "unpay-one",
      entry,
      reason: "",
    });
  };

  const submitPaymentControl = async () => {
    if (!paymentControl || !canManage || !paymentControlTargets.length) {
      return;
    }

    const reversing = paymentControl.mode !== "pay-batch";
    const reason = paymentControl.reason.trim();

    if (reversing && !reason) {
      setError("سبب إلغاء تسجيل الدفع مطلوب.");
      return;
    }

    setBusy(
      paymentControl.mode === "pay-batch"
        ? "pay-batch"
        : paymentControl.mode === "unpay-batch"
          ? "unpay-batch"
          : `unpay:${paymentControl.entry?.employeeId || "entry"}`
    );
    setError("");

    let nextEntries = entries;
    let successCount = 0;
    const failures: string[] = [];

    for (const target of paymentControlTargets) {
      try {
        const saved = reversing
          ? await reversePayrollEntryPayment(target, reason)
          : await markPayrollEntryPaid(target);
        nextEntries = replaceEntry(nextEntries, saved);
        successCount += 1;
      } catch (actionError: any) {
        failures.push(
          `${target.employeeName || target.employeeId}: ${payrollActionErrorMessage(
            actionError,
            reversing
              ? "تعذر إلغاء تسجيل الدفع."
              : "تعذر تسجيل الدفع."
          )}`
        );
      }
    }

    setEntries(nextEntries);
    setPaymentControl(null);

    if (successCount > 0) {
      setMessage(
        reversing
          ? `تم إلغاء تسجيل الدفع عن ${successCount} مسير.`
          : `تم تسجيل ${successCount} مسير كمدفوع.`
      );
    }

    if (failures.length) {
      setError(
        `تم تنفيذ ${successCount} من ${paymentControlTargets.length}. تعذر: ${failures.join(
          " | "
        )}`
      );
    }

    setBusy("");
  };

  const openLateApproval = () => {
    if (!canRecordLateApproval) return;

    const preferred =
      employeeFilter !== "all"
        ? lateApprovalCandidates.find(
            (entry) => entry.employeeId === employeeFilter
          )
        : lateApprovalCandidates[0];

    if (!preferred) {
      setError(
        "لا توجد مسيرة غير معتمدة لهذه الفترة."
      );
      return;
    }

    setError("");
    setLateApproval({
      employeeId: preferred.employeeId,
      approvalDate: "",
      approvedAmountRiyals: (
        Number(preferred.netSalaryHalalas || 0) / 100
      ).toFixed(2),
      reason: "تم اعتماد المسيرة سابقًا ولم يتم تسجيلها في النظام.",
    });
  };

  const submitLateApproval = async () => {
    if (!lateApproval || !selectedLateApprovalEntry || !canRecordLateApproval) {
      return;
    }

    if (!lateApproval.approvalDate) {
      setError("اختر تاريخ الاعتماد الفعلي.");
      return;
    }

    const amountRiyals = Number(lateApproval.approvedAmountRiyals);
    if (!Number.isFinite(amountRiyals) || amountRiyals < 0) {
      setError("أدخل المبلغ الذي تم اعتماده فعليًا.");
      return;
    }

    const reason = lateApproval.reason.trim();
    if (!reason) {
      setError("سبب التسجيل المتأخر مطلوب.");
      return;
    }

    setBusy(`late-approve:${selectedLateApprovalEntry.employeeId}`);
    setError("");
    try {
      let approvalEntry = selectedLateApprovalEntry;

      if (!approvalEntry.saved) {
        const period = await ensurePayrollPeriod(year, month);
        const persisted = await savePayrollDrafts([
          {
            ...approvalEntry,
            periodId: approvalEntry.periodId || period.id,
          },
        ]);
        approvalEntry = persisted[0] || approvalEntry;
        if (!approvalEntry.saved || !approvalEntry.id) {
          throw new Error("payroll_late_approval_entry_must_be_saved");
        }
        setEntries((current) => replaceEntry(current, approvalEntry));
      }

      const saved = await recordLatePayrollApproval(
        approvalEntry,
        {
          approvalDate: lateApproval.approvalDate,
          approvedNetHalalas: Math.round(amountRiyals * 100),
          reason,
        }
      );
      setEntries((current) => replaceEntry(current, saved));
      setSelectedEntry((current) =>
        current?.employeeId === saved.employeeId ? saved : current
      );
      setLateApproval(null);
      setMessage(
        `تم تسجيل اعتماد ${saved.employeeName} بأثر فعلي بتاريخ ${lateApproval.approvalDate}. وقت تسجيل العملية الحالي محفوظ في سجل التدقيق.`
      );
    } catch (actionError: any) {
      setError(
        payrollActionErrorMessage(
          actionError,
          "تعذر تسجيل الاعتماد المتأخر."
        )
      );
    } finally {
      setBusy("");
    }
  };

  const handleRecalculateEntry = async (entry: PayrollEntryView) => {
    if (!canManage || isPayrollSnapshotLocked(entry.status)) return;
    setBusy(`recalc:${entry.employeeId}`);
    try {
      const generated = await generatePayrollEntries({
        year,
        month,
        employeeId: entry.employeeId,
        currentEntries: entries,
      });
      const recalculated = generated[0] || entry;
      const saved = recalculated.id
        ? (await savePayrollDrafts([{ ...recalculated, periodId: recalculated.periodId || entry.periodId }]))[0] || recalculated
        : recalculated;
      const next = saved;
      setEntries((current) => replaceEntry(current, next));
      setSelectedEntry((current) => (current?.employeeId === next.employeeId ? next : current));
      setMessage("تمت إعادة حساب السجل.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذرت إعادة حساب السجل."));
    } finally {
      setBusy("");
    }
  };

  const openAdjustment = (entry: PayrollEntryView, mode: AdjustmentMode) => {
    setAdjustment({
      mode,
      entry,
      kind: mode === "addition" ? "bonus" : "manual_deduction",
      amount: "",
      reason: "",
      note: "",
    });
  };

  const submitAdjustment = async () => {
    if (!adjustment || !canManage || isPayrollSnapshotLocked(adjustment.entry.status)) return;
    const item: PayrollManualItem = {
      id: `manual_${Date.now()}`,
      direction: adjustment.mode,
      kind: adjustment.kind,
      amountHalalas: riyalsToHalalas(adjustment.amount),
      reason: adjustment.reason.trim(),
      note: adjustment.note.trim() || undefined,
      addedBy: "الإدارة",
      addedAt: new Date().toISOString(),
    };
    try {
      assertManualPayrollItem(item);
      const next = {
        ...adjustment.entry,
        additions: adjustment.mode === "addition" ? [...adjustment.entry.additions, item] : adjustment.entry.additions,
        deductions: adjustment.mode === "deduction" ? [...adjustment.entry.deductions, item] : adjustment.entry.deductions,
      };
      setBusy("adjustment");
      const saved = next.id
        ? await updatePayrollEntryAdjustments(next)
        : await previewPayrollEntrySnapshot(next);
      setEntries((current) => replaceEntry(current, saved));
      setSelectedEntry((current) => (current?.employeeId === saved.employeeId ? saved : current));
      setAdjustment(null);
      setMessage("تمت إضافة البند اليدوي.");
    } catch (actionError: any) {
      setError(
        actionError?.message === "manual_payroll_item_reason_required"
          ? "سبب الإضافة أو الخصم مطلوب."
          : actionError?.message === "manual_payroll_item_amount_required"
            ? "المبلغ مطلوب ويجب أن يكون أكبر من صفر."
            : String(actionError?.message || "تعذر حفظ البند اليدوي.")
      );
    } finally {
      setBusy("");
    }
  };

  const openAttendanceDeferral = (entry: PayrollEntryView) => {
    if (
      !canManage ||
      isPayrollSnapshotLocked(entry.status) ||
      Number(entry.missingHoursDeductionHalalas || 0) <= 0
    ) {
      return;
    }
    setAttendanceDeferral({
      entry,
      targetPayrollMonth: shiftPayrollMonth(entry.payrollMonth, 1),
      reason: "",
      note: "",
    });
  };

  const submitAttendanceDeferral = async () => {
    if (!attendanceDeferral || !canManage || isPayrollSnapshotLocked(attendanceDeferral.entry.status)) return;
    const reason = attendanceDeferral.reason.trim();
    if (!reason) {
      setError("سبب التأجيل مطلوب.");
      return;
    }
    if (attendanceDeferral.targetPayrollMonth <= attendanceDeferral.entry.payrollMonth) {
      setError("شهر التحصيل يجب أن يكون بعد شهر الخصم الأصلي.");
      return;
    }

    setBusy("attendance-deferral");
    setError("");
    try {
      await CoreHrService.deferAttendanceDeduction({
        employeeId: attendanceDeferral.entry.employeeId,
        originalPayrollMonth: attendanceDeferral.entry.payrollMonth,
        targetPayrollMonth: attendanceDeferral.targetPayrollMonth,
        reason,
        note: attendanceDeferral.note.trim() || undefined,
      });

      const [entryYear, entryMonth] = attendanceDeferral.entry.payrollMonth.split("-").map(Number);
      const generated = await generatePayrollEntries({
        year: entryYear,
        month: entryMonth,
        employeeId: attendanceDeferral.entry.employeeId,
        currentEntries: entries,
      });
      const recalculated = generated[0] || attendanceDeferral.entry;
      const next = recalculated.id
        ? (await savePayrollDrafts([{ ...recalculated, periodId: recalculated.periodId || attendanceDeferral.entry.periodId }]))[0] || recalculated
        : recalculated;
      setEntries((current) => replaceEntry(current, next));
      setSelectedEntry((current) => (current?.employeeId === next.employeeId ? next : current));
      const targetMonth = attendanceDeferral.targetPayrollMonth;
      setAttendanceDeferral(null);
      setMessage(`تم تأجيل خصم الحضور إلى ${targetMonth} مع حفظ سبب القرار وسجل الالتزام.`);
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "تعذر تأجيل خصم الحضور."));
    } finally {
      setBusy("");
    }
  };

  const handleApprove = async (entry: PayrollEntryView) => {
    if (!canManage || entry.status === "paid") return;
    const approvalReadiness = payrollApprovalReadiness(
      entry as unknown as Record<string, unknown>
    );
    if (!approvalReadiness.ready) {
      setError(approvalReadiness.message);
      return;
    }

    setBusy(`approve:${entry.employeeId}`);
    try {
      await reconcilePreviousPayrollCarryovers({
        year,
        month,
        employeeId: entry.employeeId,
      });
      const regenerated = await generatePayrollEntries({
        year,
        month,
        employeeId: entry.employeeId,
        currentEntries: entries,
      });
      const approvalEntry = regenerated[0] || entry;
      const payrollMoney = calculatePayrollAccrualView(approvalEntry);
      if (payrollMoney.isPartial) {
        setApprovalConfirmation({
          entry: approvalEntry,
          expectedNetHalalas: payrollMoney.expectedNetHalalas,
        });
        return;
      }
      const saved = await approvePayrollEntry(approvalEntry);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("تم اعتماد الراتب.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "تعذر اعتماد الراتب."));
    } finally {
      setBusy("");
    }
  };

  const submitApprovalConfirmation = async () => {
    if (!approvalConfirmation || !canManage) return;
    const entry = approvalConfirmation.entry;
    setBusy(`approve:${entry.employeeId}`);
    setError("");
    try {
      const saved = await approvePayrollEntry(entry);
      setEntries((current) => replaceEntry(current, saved));
      setSelectedEntry((current) =>
        current?.employeeId === saved.employeeId ? saved : current
      );
      setApprovalConfirmation(null);
      setMessage("تم اعتماد الراتب.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "تعذر اعتماد الراتب."));
    } finally {
      setBusy("");
    }
  };

  const handlePaid = async (entry: PayrollEntryView) => {
    if (!canManage) return;
    if (!entry.payrollSetupComplete) {
      setError("لا يمكن تسجيل الراتب كمدفوع قبل إكمال بيانات الراتب.");
      return;
    }
    const attendanceReadiness = payrollAttendanceReadiness(
      entry.attendanceSummary
    );
    if (!attendanceReadiness.ready) {
      setError(attendanceReadiness.message);
      return;
    }
    if (entry.status !== "approved") {
      setError("لا يمكن تسجيل الراتب كمدفوع قبل اعتماده.");
      return;
    }
    setBusy(`paid:${entry.employeeId}`);
    try {
      const saved = await markPayrollEntryPaid(entry);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("تم تسجيل الراتب كمدفوع.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "تعذر تسجيل الدفع."));
    } finally {
      setBusy("");
    }
  };

  const openHistoricalSettlement = (entry: PayrollEntryView) => {
    if (!canManage || !entry.id) return;

    const pending = sourceCarryovers.find(
      (row) => row.status === "pending"
    );
    if (!pending) {
      setError(
        "لا يوجد فرق مالي معلّق لهذه الفترة. التعديلات غير المالية لا تنشئ مبالغ للترحيل."
      );
      return;
    }

    setError("");
    setHistoricalSettlementDraft({
      entry,
      direction: pending.direction,
      amountRiyals: (
        Math.max(0, Number(pending.amountHalalas || 0)) / 100
      ).toFixed(2),
      settlementMethod: "bank_transfer",
      settlementDate: riyadhTodayDateKey(),
      reason: pending.reason || "تسوية مباشرة لفرق فترة مقفلة.",
      reference: "",
      note: "",
    });
  };

  const submitHistoricalSettlement = async () => {
    if (!historicalSettlementDraft || !canManage) return;
    const amountRiyals = Number(
      historicalSettlementDraft.amountRiyals
    );
    if (!Number.isFinite(amountRiyals) || amountRiyals <= 0) {
      setError("مبلغ التسوية يجب أن يكون أكبر من صفر.");
      return;
    }
    if (!historicalSettlementDraft.reason.trim()) {
      setError("سبب التسوية اللاحقة مطلوب.");
      return;
    }

    setBusy("historical-settlement");
    setError("");
    try {
      await CoreHrService.recordPayrollHistoricalSettlement({
        sourcePayrollEntryId:
          historicalSettlementDraft.entry.id!,
        direction: historicalSettlementDraft.direction,
        amountHalalas: Math.round(amountRiyals * 100),
        settlementMethod:
          historicalSettlementDraft.settlementMethod,
        settlementDate:
          historicalSettlementDraft.settlementDate,
        reason: historicalSettlementDraft.reason.trim(),
        reference:
          historicalSettlementDraft.reference.trim() || null,
        note: historicalSettlementDraft.note.trim() || null,
      });

      await refreshHistoricalSettlementState(
        historicalSettlementDraft.entry
      );
      setHistoricalSettlementDraft(null);
      setMessage(
        "تم تسجيل التسوية على الفترة الأصلية بدون تغيير الراتب المقفل، وتم تحديث أي مبلغ متبقٍ للترحيل."
      );
    } catch (actionError: any) {
      setError(
        payrollActionErrorMessage(
          actionError,
          "تعذر تسجيل التسوية اللاحقة."
        )
      );
    } finally {
      setBusy("");
    }
  };

  const submitHistoricalSettlementVoid = async () => {
    if (!historicalSettlementVoidDraft || !canManage) return;
    const reason =
      historicalSettlementVoidDraft.reason.trim();
    if (!reason) {
      setError("سبب إلغاء التسوية مطلوب.");
      return;
    }

    setBusy("historical-settlement-void");
    setError("");
    try {
      await CoreHrService.voidPayrollHistoricalSettlement(
        historicalSettlementVoidDraft.settlement.id,
        reason
      );
      await refreshHistoricalSettlementState(selectedEntry);
      setHistoricalSettlementVoidDraft(null);
      setMessage(
        "تم إلغاء تسجيل التسوية وإعادة احتساب الفرق المتبقي للترحيل."
      );
    } catch (actionError: any) {
      setError(
        payrollActionErrorMessage(
          actionError,
          "تعذر إلغاء التسوية."
        )
      );
    } finally {
      setBusy("");
    }
  };

  const handleReopen = (entry: PayrollEntryView) => {
    const visibility = payrollActionVisibility({
      status: entry.status,
      payrollSetupComplete: entry.payrollSetupComplete,
      canManage,
      role,
    });
    if (!visibility.canReopen) return;
    setReopenDraft({
      entry,
      reason: "إعادة احتساب الحضور بعد تحديث سياسة الغياب",
    });
  };

  const submitReopen = async () => {
    if (!reopenDraft) return;
    const reason = reopenDraft.reason.trim();
    if (!reason) {
      setError("سبب إعادة فتح الراتب مطلوب.");
      return;
    }

    const entry = reopenDraft.entry;
    setBusy(`reopen:${entry.employeeId}`);
    setError("");
    try {
      const saved = await reopenPayrollEntry(entry, {
        reason,
        status: "draft",
      });
      setEntries((current) => replaceEntry(current, saved));
      setSelectedEntry((current) =>
        current?.employeeId === saved.employeeId ? saved : current
      );
      setReopenDraft(null);
      setMessage(
        "تمت إعادة فتح الراتب. يمكنك الآن إعادة الحساب ثم الاعتماد من جديد."
      );
    } catch (actionError: any) {
      setError(
        payrollActionErrorMessage(actionError, "تعذرت إعادة فتح الراتب.")
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="dsv2-page dsv2-payroll-page payroll-page" dir="rtl">
      <header className="dsv2-page-head payroll-page-head">
        <div className="payroll-page-heading">
          <span className="dsv2-badge dsv2-badge--gold">نظام الرواتب</span>
          <h1 className="dsv2-page-title">إدارة الرواتب</h1>
          <p className="dsv2-page-subtitle">إنشاء ومراجعة واعتماد مسيرات الرواتب الشهرية للموظفات.</p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          تحديث البيانات
        </button>
      </header>

      <section className="dsv2-card dsv2-card--padded payroll-control-panel">
        <div className="payroll-filter-grid">
          <label className="dsv2-field">
            <span className="dsv2-field__label">الشهر</span>
            <DashboardSelectV2
              value={String(month)}
              options={PAYROLL_MONTH_OPTIONS}
              onChange={(value) => setMonth(Number(value))}
            />
          </label>
          <label className="dsv2-field">
            <span className="dsv2-field__label">السنة</span>
            <DashboardNumberInputV2
              className="dsv2-input"
              min="2020"
              max="2100"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
          <label className="dsv2-field">
            <span className="dsv2-field__label">الموظفة</span>
            <DashboardSelectV2
              value={employeeFilter}
              options={[
                { value: "all", label: "كل الموظفات" },
                ...employees.map((employee) => ({
                  value: employee.id,
                  label: employee.name || employee.id,
                })),
              ]}
              onChange={setEmployeeFilter}
            />
          </label>
          <label className="dsv2-field">
            <span className="dsv2-field__label">حالة الراتب</span>
            <DashboardSelectV2
              value={statusFilter}
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={setStatusFilter}
            />
          </label>
        </div>

        <div className="payroll-actions-bar">
          <div className="payroll-actions-group payroll-actions-group--workflow">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => void handleGenerate(false)}
              disabled={!canManage || Boolean(busy)}
            >
              <FiSliders /> تحديث المعاينة
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => void handleGenerate(true)}
              disabled={!canManage || Boolean(busy)}
            >
              <FiRefreshCw /> إعادة الحساب
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={() => void handleSaveDrafts()}
              disabled={!canManage || Boolean(busy)}
            >
              <FiSave /> حفظ المسودات
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={openLateApproval}
              disabled={
                !canRecordLateApproval ||
                Boolean(busy) ||
                isFuturePayrollPeriod
              }
              title="لتوثيق اعتماد تم فعليًا في تاريخ سابق ولم يُسجل وقتها"
            >
              <FiClock /> تسجيل اعتماد متأخر
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => openBatchPaymentControl("pay-batch")}
              disabled={
                !canManage ||
                Boolean(busy) ||
                approvedPaymentEntries.length === 0
              }
              title="يسجل كل الرواتب المعتمدة في المسيرة كمدفوعة"
            >
              <FiDollarSign /> تسجيل دفع المسيرة
            </button>

            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => openBatchPaymentControl("unpay-batch")}
              disabled={
                !canManage ||
                Boolean(busy) ||
                paidPaymentEntries.length === 0
              }
              title="يرجع الرواتب المسجلة كمدفوعة إلى حالة معتمد مع عكس آثار الدفع"
            >
              <FiUnlock /> إلغاء تسجيل دفع المسيرة
            </button>
          </div>

          <div className="payroll-actions-group payroll-actions-group--exports">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={handleExportPayrollPdf}
              disabled={loading}
            >
              <FiFileText /> PDF
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={handleExportPayrollExcel}
              disabled={loading}
            >
              <FiDownload /> Excel
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={handleExportPayrollMobileExcel}
              disabled={loading}
              title="نسخة Excel رأسية ومضبوطة للعرض على الجوال"
            >
              <FiDownload /> Excel جوال
            </button>
          </div>

          <div className="payroll-export-meta">
            <span className="dsv2-badge dsv2-badge--success">
              {isFuturePayrollPeriod
                ? "معاينة مستقبلية: قابل للتصدير " +
                  periodExportableCount +
                  " من " +
                  visibleEntries.length +
                  " — غير معتمدة"
                : includeIncompleteExport
                  ? "مراجعة داخلية: سيتم تصدير " +
                    exportableCount +
                    " · الجاهز رسميًا " +
                    officialExportableCount
                  : "جاهز للتصدير الرسمي " +
                    officialExportableCount +
                    " من " +
                    visibleEntries.length}
            </span>
            <label className="payroll-export-option">
              <input
                type="checkbox"
                checked={includeIncompleteExport}
                onChange={(event) => setIncludeIncompleteExport(event.target.checked)}
              />
              <span>تضمين غير الجاهز للمراجعة الداخلية</span>
            </label>
          </div>
        </div>
      </section>

      <div className="payroll-period-banner">
        <FiClock />
        <span>{payrollCycleLabel}</span>
        <strong>{payrollPartialLabel}</strong>
      </div>

      <PayrollComplianceWorkspace
        employees={employees}
        payrollMonth={payrollMonth}
        canManage={canManage}
      />

      {error ? <div className="payroll-alert is-error">{error}</div> : null}
      {message ? <div className="payroll-alert"><FiCheckCircle />{message}</div> : null}
      {!canManage ? <div className="payroll-alert is-readonly">وضع قراءة فقط: يمكنك مراجعة الرواتب دون تعديلها.</div> : null}

      <section className="payroll-readiness-overview" aria-label="حالة جاهزية الرواتب">
        <div className="payroll-overview-head">
          <div>
            <span className="payroll-overview-eyebrow">جاهزية المسيرة</span>
            <h2>صورة واضحة قبل الاعتماد والتصدير</h2>
          </div>
          <div className="payroll-overview-source">
            <span>{summary.saved} محفوظ</span>
            <span>{summary.preview} معاينة غير محفوظة</span>
          </div>
        </div>
        <div className="payroll-readiness-grid">
          <article className="payroll-readiness-card is-total">
            <span>الموظفون بالمسير</span>
            <strong>{summary.count}</strong>
            <small>المؤهلون حاليًا مع حفظ السجلات التاريخية المقفلة</small>
          </article>
          <article className="payroll-readiness-card is-ready">
            <span>
              {isFuturePayrollPeriod ? "جاهزون للمعاينة" : "جاهزون للتصدير"}
            </span>
            <strong>{summary.exportReady}</strong>
            <small>
              {isFuturePayrollPeriod
                ? "إعداد الراتب وGOSI جاهزان؛ الحضور يبدأ مع الفترة"
                : "الراتب والحضور وGOSI جاهزة"}
            </small>
          </article>
          <article className="payroll-readiness-card is-setup">
            <span>يحتاج إعداد راتب</span>
            <strong>{summary.incomplete}</strong>
            <small>حقول مالية أساسية ناقصة</small>
          </article>
          <article className="payroll-readiness-card is-attendance">
            <span>يحتاج مراجعة حضور</span>
            <strong>{summary.attendanceReview}</strong>
            <small>الإعداد المالي مكتمل لكن الحضور غير جاهز</small>
          </article>
          <article className="payroll-readiness-card is-setup">
            <span>يحتاج إعداد GOSI</span>
            <strong>{summary.gosiReview}</strong>
            <small>الراتب والحضور جاهزان لكن التأمينات غير مكتملة للفترة</small>
          </article>
          <article className="payroll-readiness-card is-exempt">
            <span>معفون من البصمة</span>
            <strong>{summary.exempt}</strong>
            <small>راتب شهري مستقل عن الحضور والانصراف</small>
          </article>
        </div>
      </section>

      <section className="dsv2-card payroll-financial-summary">
        <div className="payroll-financial-head">
          <div>
            <span className="payroll-overview-eyebrow">الملخص المالي</span>
            <h2>أرقام الفترة الحالية</h2>
          </div>
          <span className="dsv2-badge">{payrollMonth}</span>
        </div>
        <div className="payroll-financial-grid">
          <div className="payroll-financial-item"><span>إجمالي الرواتب الأساسية</span><strong>{formatPayrollMoney(summary.base)}</strong></div>
          <div className="payroll-financial-item"><span>البدلات التعاقدية</span><strong>{formatPayrollMoney(summary.allowances)}</strong></div>
          <div className="payroll-financial-item is-positive"><span>الإضافات والمكافآت</span><strong>{formatPayrollMoney(summary.additions)}</strong></div>
          <div className="payroll-financial-item is-positive"><span>الأوفر تايم</span><strong>{formatPayrollMoney(summary.overtime)}</strong></div>
          <div className="payroll-financial-item"><span>تعويض رصيد الإجازات</span><strong>{formatPayrollMoney(summary.leaveCompensation)}</strong></div>
          <div className="payroll-financial-item is-negative"><span>الخصومات</span><strong>{formatPayrollMoney(summary.deductions)}</strong></div>
          <div className="payroll-financial-item is-accrued"><span>المستحق حتى اليوم</span><strong>{formatPayrollMoney(summary.earned)}</strong></div>
          <div className="payroll-financial-item is-net"><span>الصافي المتوقع</span><strong>{formatPayrollMoney(summary.net)}</strong></div>
        </div>
        <div className="payroll-status-strip" aria-label="حالات المسيرات">
          <span>المسودات <strong>{summary.drafts}</strong></span>
          <span>المعتمدة <strong>{summary.approved}</strong></span>
          <span>المدفوعة <strong>{summary.paid}</strong></span>
        </div>
      </section>

      {summary.incomplete > 0 || summary.gosiReview > 0 ? (
        <div className="payroll-alert is-warning payroll-setup-warning" role="status">
          <FiAlertTriangle />
          <div>
            <strong>يوجد موظفون يحتاجون استكمال إعداد الراتب أو GOSI قبل الاعتماد أو التصدير الرسمي.</strong>
            <small>سبب النقص ظاهر داخل كل صف. الموظف المعفى من الحضور لا يحتاج ساعات شهر أو ساعات يومية.</small>
          </div>
        </div>
      ) : null}

      <section className="dsv2-table-card payroll-table-section">
        <header className="payroll-table-section__head">
          <div>
            <span className="payroll-overview-eyebrow">تفاصيل الموظفين</span>
            <h2 className="dsv2-section-title">مسيرات الموظفات</h2>
            <p className="dsv2-section-caption">تظهر المسيرات للموظفين المؤهلين حاليًا، وتبقى السجلات المعتمدة/المدفوعة التاريخية ظاهرة حتى بعد إيقاف الموظف. السجل غير المحفوظ يظهر كمعاينة آمنة حتى تضغط حفظ المسودات.</p>
          </div>
          <div className="payroll-table-counts">
            <span className="dsv2-badge">{visibleEntries.length} سجل</span>
            <span className="dsv2-badge dsv2-badge--success">
              {summary.exportReady}{" "}
              {isFuturePayrollPeriod ? "جاهز للمعاينة" : "جاهز للتصدير"}
            </span>
          </div>
        </header>
        <div className="dsv2-table-scroll payroll-table-wrap">
          <table className="dsv2-table payroll-table">
          <thead>
            <tr>
              <th>الموظفة</th>
              <th>الجاهزية</th>
              <th>إعداد الراتب</th>
              <th>الراتب الأساسي</th>
              <th>البدلات التعاقدية</th>
              <th>الإضافات والمكافآت</th>
              <th>الأوفر تايم</th>
              <th>تعويض رصيد الإجازات</th>
              <th>الخصومات</th>
              <th>المستحق / المتوقع</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const actions = payrollActionVisibility({
                status: entry.status,
                payrollSetupComplete: entry.payrollSetupComplete,
                canManage,
                role,
              });
              const missingLabels = setupMissingLabels(entry);
              const approvalReadiness = payrollApprovalReadiness(
                entry as unknown as Record<string, unknown>
              );
              const exportEligible = isSelectedPeriodExportEligible(entry);
              const attendanceReadiness = payrollAttendanceReadiness(entry.attendanceSummary);
              const payrollExempt = attendancePayrollExempt(entry);
              const setupBlocked = !entry.payrollSetupComplete;
              const attendanceReview =
                !isFuturePayrollPeriod &&
                entry.payrollSetupComplete &&
                !attendanceReadiness.ready;
              const gosiReview =
                entry.payrollSetupComplete &&
                (isFuturePayrollPeriod
                  ? !isSelectedPeriodExportEligible(entry)
                  : attendanceReadiness.ready &&
                    !approvalReadiness.ready &&
                    approvalReadiness.stage === "gosi");
              const exclusionReason = exportEligible
                ? ""
                : selectedPeriodExportExclusionReason(entry);
              const manualAdjustments = hasManualAdjustments(entry);
              const payrollMoney = calculatePayrollAccrualView(entry);
              const attendanceObligationDeductionHalalas =
                payrollAttendanceObligationDeductionTotal(entry.deductions || []);
              const otherObligationDeductionHalalas =
                payrollOtherObligationDeductionTotal(entry.deductions || []);
              const manualDeductionHalalas = ordinaryManualDeductionsHalalas(entry);
              const unclassifiedDeductionHalalas = payrollUnclassifiedDeductionsHalalas(entry);
              const deferredAttendanceHalalas = attendanceDeferredAmountHalalas(entry);
              const deferredAttendanceTarget = attendanceDeferralTargetMonth(entry);
              const rowState =
                isFuturePayrollPeriod && exportEligible
                  ? "is-future"
                  : exportEligible
                    ? "is-ready"
                    : setupBlocked
                  ? "is-setup-blocked"
                  : attendanceReview
                    ? "is-attendance-review"
                    : "is-blocked";
              return (
                <tr className={`payroll-row ${rowState}`} key={`${entry.employeeId}:${entry.payrollMonth}`}>
                  <td className="payroll-employee-cell">
                    <strong>{entry.employeeName}</strong>
                    <small>{entry.jobTitle || entry.employeeId}</small>
                    <div className="payroll-row-badges">
                      <span className={`payroll-mini-badge ${entry.saved ? "is-saved" : "is-preview"}`}>
                        {entry.saved ? "محفوظ" : "معاينة غير محفوظة"}
                      </span>
                      {manualAdjustments ? <span className="payroll-mini-badge is-manual">بنود يدوية</span> : null}
                    </div>
                  </td>
                  <td className="payroll-readiness-cell">
                    <span
                      className={
                        "payroll-readiness-badge " +
                        (isFuturePayrollPeriod && exportEligible
                          ? "is-future"
                          : exportEligible
                            ? "is-ready"
                            : setupBlocked || gosiReview
                              ? "is-setup"
                              : "is-attendance")
                      }
                    >
                      {isFuturePayrollPeriod && exportEligible
                        ? "معاينة مستقبلية"
                        : exportEligible
                          ? "جاهز للتصدير"
                          : setupBlocked
                            ? "يحتاج إعداد راتب"
                            : gosiReview
                              ? "يحتاج إعداد GOSI"
                              : "يحتاج مراجعة حضور"}
                    </span>
                    {payrollExempt ? <span className="payroll-mini-badge is-exempt">معفى من البصمة</span> : null}
                    {isFuturePayrollPeriod && exportEligible ? (
                      <small className="payroll-readiness-reason">
                        الحضور لم يبدأ بعد؛ الكشف تقديري حتى بدء الفترة.
                      </small>
                    ) : null}
                    {attendanceReview ? (
                      <small className="payroll-readiness-reason">{attendanceReadiness.message || attendanceLinkLabel(entry)}</small>
                    ) : null}
                    {(setupBlocked || gosiReview) && exclusionReason ? (
                      <small className="payroll-readiness-reason">{exclusionReason}</small>
                    ) : null}
                  </td>
                  <td className="payroll-setup-cell">
                    <span className={`payroll-setup-badge ${entry.payrollSetupComplete ? "is-complete" : "is-incomplete"}`}>
                      {entry.payrollSetupComplete ? "مكتمل" : "غير مكتمل"}
                    </span>
                    {!entry.payrollSetupComplete ? <small>{missingLabels.join("، ")}</small> : null}
                  </td>
                  <td className="payroll-money-cell">
                    <strong>{formatBaseSalary(entry)}</strong>
                    {!entry.payrollSetupComplete ? (
                      <small><a href={employeePayrollPath(entry)}>إعداد الراتب</a></small>
                    ) : null}
                  </td>
                  <td className="payroll-money-cell">{formatPayrollMoney(entry.allowancesHalalas)}</td>
                  <td className="payroll-money-cell is-positive">{formatPayrollMoney(payrollOrdinaryAdditionsHalalas(entry))}</td>
                  <td className="payroll-money-cell is-positive">{formatPayrollMoney(entry.overtimeValueHalalas)}</td>
                  <td className="payroll-money-cell">{formatPayrollMoney(payrollLeaveCompensationHalalas(entry))}</td>
                  <td className="payroll-money-cell is-negative">
                    <strong>{formatPayrollMoney(entry.totalDeductionsHalalas)}</strong>
                    <small>غياب {formatPayrollMoney(entry.absenceDeductionHalalas)}</small>
                    <small>نقص ساعات {formatPayrollMoney(entry.missingHoursDeductionHalalas)}</small>
                    {Number(entry.insuranceDeductionHalalas || 0) > 0 ? <small>GOSI {formatPayrollMoney(entry.insuranceDeductionHalalas)}</small> : null}
                    {Number(entry.advancesHalalas || 0) > 0 ? <small>سلف {formatPayrollMoney(entry.advancesHalalas)}</small> : null}
                    {attendanceObligationDeductionHalalas > 0 ? (
                      <small>خصم حضور (لم يخصم في الفترة السابقة) {formatPayrollMoney(attendanceObligationDeductionHalalas)}</small>
                    ) : null}
                    {otherObligationDeductionHalalas > 0 ? (
                      <small>استقطاع مجدول {formatPayrollMoney(otherObligationDeductionHalalas)}</small>
                    ) : null}
                    {manualDeductionHalalas > 0 ? <small>يدوي {formatPayrollMoney(manualDeductionHalalas)}</small> : null}
                    {unclassifiedDeductionHalalas > 0 ? <small>أخرى {formatPayrollMoney(unclassifiedDeductionHalalas)}</small> : null}
                    {deferredAttendanceHalalas > 0 ? (
                      <small>خصم حضور مؤجل (لا يخصم هذه الفترة) {formatPayrollMoney(deferredAttendanceHalalas)} · إلى {deferredAttendanceTarget || "شهر لاحق"}</small>
                    ) : null}
                  </td>
                  <td className="payroll-net-cell">
                    <strong>{formatSetupMoney(entry, payrollMoney.earnedToDateHalalas)}</strong>
                    {entry.payrollSetupComplete && approvalReadiness.stage === "gosi" ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>إعداد GOSI غير جاهز لهذه الفترة.</strong>
              <small>{approvalReadiness.message}</small>
            </div>
          </div>
        ) : null}

        {entry.payrollSetupComplete && payrollMoney.isPartial ? (
                      <>
                        <small>المتوقع {formatPayrollMoney(payrollMoney.expectedNetHalalas)}</small>
                        <small>حتى {payrollMoney.completedThroughDate || "لم تبدأ الفترة"}</small>
                      </>
                    ) : null}
                  </td>
                  <td><span className={`payroll-status ${statusClass(entry.status)}`}>{STATUS_LABELS[entry.status] || entry.status}</span></td>
                  <td>
                    <button
                      type="button"
                      className="payroll-actions-trigger"
                      onClick={(event) => openPayrollActionMenu(event, entry)}
                    >
                      الإجراءات
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
          {loading ? <p className="payroll-empty">جاري تحميل الموظفين وحساب معاينة المسيرة...</p> : null}
          {!loading && !visibleEntries.length ? (
            <p className="payroll-empty">لا توجد موظفات نشطات مطابقة للفلاتر الحالية.</p>
          ) : null}
        </div>
      </section>

      {actionMenu
        ? createPortal(
            <div
              className="dashboard-v2 payroll-actions-layer"
              dir="rtl"
              onMouseDown={() => setActionMenu(null)}
            >
              <div
                className="payroll-actions-popover"
                role="menu"
                style={{
                  top: actionMenu.top,
                  left: actionMenu.left,
                  transform:
                    actionMenu.placement === "above"
                      ? "translateY(-100%)"
                      : undefined,
                  transformOrigin:
                    actionMenu.placement === "above"
                      ? "bottom right"
                      : "top right",
                }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {(() => {
                  const entry = actionMenu.entry;
                  const actions = payrollActionVisibility({
                    status: entry.status,
                    payrollSetupComplete: entry.payrollSetupComplete,
                    canManage,
                    role,
                  });

                  const deferredAttendanceHalalas =
                    attendanceDeferredAmountHalalas(entry);

                  const deferredAttendanceTarget =
                    attendanceDeferralTargetMonth(entry);

                  const approvalReadiness = payrollApprovalReadiness(
                    entry as unknown as Record<string, unknown>
                  );

                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenu(null);
                          setSelectedEntry(entry);
                        }}
                      >
                        <FiEye /> عرض التفاصيل
                      </button>

                      <button
                        type="button"
                        disabled={!actions.canRecalculate}
                        onClick={() => {
                          setActionMenu(null);
                          void handleRecalculateEntry(entry);
                        }}
                      >
                        إعادة الحساب
                      </button>

                      <button
                        type="button"
                        disabled={!actions.canEditAdjustments}
                        onClick={() => {
                          setActionMenu(null);
                          openAdjustment(entry, "deduction");
                        }}
                      >
                        إضافة خصم
                      </button>

                      <button
                        type="button"
                        disabled={!actions.canEditAdjustments}
                        onClick={() => {
                          setActionMenu(null);
                          openAdjustment(entry, "addition");
                        }}
                      >
                        إضافة استحقاق
                      </button>

                      {deferredAttendanceHalalas > 0 ? (
                        <span className="payroll-action-help">
                          <small>
                            خصم حضور مؤجل (لا يخصم هذه الفترة) — التحصيل في{" "}
                            {deferredAttendanceTarget || "شهر لاحق"}
                          </small>
                          <a
                            className="payroll-action-link"
                            href={employeePayrollPath(entry)}
                            onClick={() => setActionMenu(null)}
                          >
                            إدارة الالتزام
                          </a>
                        </span>
                      ) : Number(entry.missingHoursDeductionHalalas || 0) > 0 &&
                        !isPayrollSnapshotLocked(entry.status) ? (
                        <button
                          type="button"
                          disabled={
                            !actions.canEditAdjustments ||
                            busy === "attendance-deferral"
                          }
                          onClick={() => {
                            setActionMenu(null);
                            openAttendanceDeferral(entry);
                          }}
                        >
                          تأجيل خصم الحضور
                        </button>
                      ) : null}

                      {actions.showApprove ? (
                        <button
                          type="button"
                          disabled={
                            !actions.canApprove ||
                            !approvalReadiness.ready
                          }
                          onClick={() => {
                            setActionMenu(null);
                            void handleApprove(entry);
                          }}
                        >
                          اعتماد
                        </button>
                      ) : null}

                      {actions.showMarkPaid ? (
                        <button
                          type="button"
                          disabled={!actions.canMarkPaid}
                          onClick={() => {
                            setActionMenu(null);
                            void handlePaid(entry);
                          }}
                        >
                          تسجيل كمدفوع
                        </button>
                      ) : null}

                      {actions.showReopen ? (
                        <button
                          type="button"
                          disabled={!actions.canReopen}
                          onClick={() => {
                            setActionMenu(null);
                            handleReopen(entry);
                          }}
                        >
                          <FiUnlock /> إعادة فتح الراتب
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>,
            document.body
          )
        : null}

      {selectedEntry ? (
        <PayrollDetailsModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onAdd={(mode) => openAdjustment(selectedEntry, mode)}
          canManage={canManage}
          sourceCarryovers={sourceCarryovers}
          historicalSettlements={historicalSettlements}
          onRecordHistoricalSettlement={() =>
            openHistoricalSettlement(selectedEntry)
          }
          onVoidHistoricalSettlement={(settlement) =>
            setHistoricalSettlementVoidDraft({
              settlement,
              reason: "",
            })
          }
          onExportPayslipPdf={() => {
            const exclusionReason =
              selectedPeriodExportExclusionReason(selectedEntry);
            if (exclusionReason) {
              setError(
                (isFuturePayrollPeriod
                  ? "تعذر تصدير الكشف التقديري: "
                  : "تعذر تصدير كشف الراتب الرسمي: ") +
                  exclusionReason
              );
              return;
            }
            exportPayrollPayslipPdfV2({
              entry: selectedEntry,
              payrollBounds,
              isForecast: isFuturePayrollPeriod,
            });
          }}
          onExportPayslipExcel={() => {
            const exclusionReason =
              selectedPeriodExportExclusionReason(selectedEntry);
            if (exclusionReason) {
              setError(
                (isFuturePayrollPeriod
                  ? "تعذر تصدير الكشف التقديري: "
                  : "تعذر تصدير كشف الراتب الرسمي: ") +
                  exclusionReason
              );
              return;
            }
            exportPayrollPayslipExcelV2({
              entry: selectedEntry,
              payrollBounds,
              isForecast: isFuturePayrollPeriod,
            });
          }}
          onExportPayslipMobileExcel={() => {
            const exclusionReason =
              selectedPeriodExportExclusionReason(selectedEntry);
            if (exclusionReason) {
              setError(
                (isFuturePayrollPeriod
                  ? "تعذر تصدير الكشف التقديري: "
                  : "تعذر تصدير كشف الراتب الرسمي: ") +
                  exclusionReason
              );
              return;
            }
            exportPayrollPayslipMobileExcelV2({
              entry: selectedEntry,
              payrollBounds,
              isForecast: isFuturePayrollPeriod,
            });
          }}
          payrollBounds={payrollBounds}
        />
      ) : null}

      {historicalSettlementDraft ? createPortal(
        <div
          className="dashboard-v2 payroll-modal-backdrop"
          role="presentation"
          onMouseDown={() => setHistoricalSettlementDraft(null)}
        >
          <aside
            className="payroll-modal payroll-adjustment-modal dsv2-workflow-reference"
            role="dialog"
            aria-modal="true"
            aria-label="تسجيل تسوية لاحقة"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>تسوية بعد إقفال الفترة</span>
                <h2>{historicalSettlementDraft.entry.employeeName}</h2>
                <p>
                  الراتب الأصلي لن يتغير. سيتم فقط توثيق الدفع/التحصيل
                  وتخفيض الفرق المعلّق.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoricalSettlementDraft(null)}
                aria-label="إغلاق"
              >
                <FiX />
              </button>
            </header>

            <label>
              <span>نوع التسوية</span>
              <input
                readOnly
                value={
                  historicalSettlementDraft.direction === "addition"
                    ? "دفع فرق للموظفة"
                    : "تحصيل فرق من الموظفة"
                }
              />
            </label>

            <label>
              <span>المبلغ</span>
              <DashboardNumberInputV2
                min="0.01"
                step="0.01"
                value={historicalSettlementDraft.amountRiyals}
                onChange={(event) =>
                  setHistoricalSettlementDraft({
                    ...historicalSettlementDraft,
                    amountRiyals: event.target.value,
                  })
                }
              />
            </label>

            <label>
              <span>طريقة التسوية</span>
              <DashboardSelectV2
                value={historicalSettlementDraft.settlementMethod}
                options={[
                  { value: "bank_transfer", label: "تحويل بنكي" },
                  { value: "cash", label: "نقدًا" },
                  { value: "other", label: "طريقة أخرى" },
                ]}
                onChange={(value) =>
                  setHistoricalSettlementDraft({
                    ...historicalSettlementDraft,
                    settlementMethod:
                      value as PayrollHistoricalSettlementDraft["settlementMethod"],
                  })
                }
              />
            </label>

            <label>
              <span>تاريخ الدفع/التحصيل</span>
              <DashboardDatePickerV2
                value={historicalSettlementDraft.settlementDate}
                max={riyadhTodayDateKey()}
                onChange={(value) =>
                  setHistoricalSettlementDraft({
                    ...historicalSettlementDraft,
                    settlementDate: value,
                  })
                }
                clearable={false}
              />
            </label>

            <label>
              <span>السبب</span>
              <textarea
                value={historicalSettlementDraft.reason}
                onChange={(event) =>
                  setHistoricalSettlementDraft({
                    ...historicalSettlementDraft,
                    reason: event.target.value,
                  })
                }
              />
            </label>

            <label>
              <span>مرجع التحويل / السند</span>
              <input
                value={historicalSettlementDraft.reference}
                onChange={(event) =>
                  setHistoricalSettlementDraft({
                    ...historicalSettlementDraft,
                    reference: event.target.value,
                  })
                }
              />
            </label>

            <label>
              <span>ملاحظة اختيارية</span>
              <textarea
                value={historicalSettlementDraft.note}
                onChange={(event) =>
                  setHistoricalSettlementDraft({
                    ...historicalSettlementDraft,
                    note: event.target.value,
                  })
                }
              />
            </label>

            <footer>
              <button
                type="button"
                onClick={() => setHistoricalSettlementDraft(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy === "historical-settlement"}
                onClick={() => void submitHistoricalSettlement()}
              >
                تسجيل التسوية
              </button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {historicalSettlementVoidDraft ? createPortal(
        <div
          className="dashboard-v2 payroll-modal-backdrop"
          role="presentation"
          onMouseDown={() => setHistoricalSettlementVoidDraft(null)}
        >
          <aside
            className="payroll-modal payroll-adjustment-modal dsv2-workflow-reference"
            role="dialog"
            aria-modal="true"
            aria-label="إلغاء تسوية لاحقة"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>تصحيح سجل التسوية</span>
                <h2>إلغاء التسوية</h2>
              </div>
              <button
                type="button"
                onClick={() => setHistoricalSettlementVoidDraft(null)}
                aria-label="إغلاق"
              >
                <FiX />
              </button>
            </header>
            <label>
              <span>سبب الإلغاء</span>
              <textarea
                value={historicalSettlementVoidDraft.reason}
                onChange={(event) =>
                  setHistoricalSettlementVoidDraft({
                    ...historicalSettlementVoidDraft,
                    reason: event.target.value,
                  })
                }
              />
            </label>
            <footer>
              <button
                type="button"
                onClick={() => setHistoricalSettlementVoidDraft(null)}
              >
                رجوع
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy === "historical-settlement-void"}
                onClick={() => void submitHistoricalSettlementVoid()}
              >
                تأكيد الإلغاء
              </button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {paymentControl ? createPortal(
        <div
          className="dashboard-v2 payroll-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPaymentControl(null)}
        >
          <aside
            className="payroll-modal payroll-payment-control-modal dsv2-workflow-reference"
            role="dialog"
            aria-modal="true"
            aria-label="إدارة تسجيل الدفع"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>
                  {paymentControl.mode === "pay-batch"
                    ? "تأكيد تنفيذ الدفع"
                    : "تصحيح تسجيل الدفع"}
                </span>
                <h2>
                  {paymentControl.mode === "pay-batch"
                    ? "تسجيل دفع المسيرة"
                    : paymentControl.mode === "unpay-batch"
                      ? "إلغاء تسجيل دفع المسيرة"
                      : `إلغاء تسجيل دفع ${paymentControl.entry?.employeeName || ""}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPaymentControl(null)}
                aria-label="إغلاق"
              >
                <FiX />
              </button>
            </header>

            <div
              className={
                "payroll-payment-control-summary " +
                (paymentControl.mode === "pay-batch"
                  ? "is-pay"
                  : "is-reversal")
              }
            >
              {paymentControl.mode === "pay-batch" ? (
                <FiDollarSign />
              ) : (
                <FiUnlock />
              )}
              <div>
                <strong>
                  {paymentControlTargets.length}{" "}
                  {paymentControlTargets.length === 1 ? "مسير" : "مسيرات"}
                </strong>
                <span>
                  الإجمالي:{" "}
                  {formatPayrollMoney(paymentControlTotalHalalas)}
                </span>
              </div>
            </div>

            {paymentControl.mode === "pay-batch" ? (
              <div className="payroll-payment-control-note">
                <FiAlertTriangle />
                <p>
                  استخدم هذا الإجراء بعد تنفيذ التحويلات فعليًا. تصدير ملف
                  الرواتب وحده لا يعني أن الرواتب دُفعت.
                </p>
              </div>
            ) : (
              <>
                <div className="payroll-payment-control-note is-warning">
                  <FiAlertTriangle />
                  <p>
                    هذا الإجراء لتصحيح تسجيل تم بالخطأ فقط. إذا وصلت الأموال
                    فعليًا للموظفة ثم تم استردادها، فلا تستخدم إلغاء التسجيل
                    كبديل عن حركة استرداد مالية.
                  </p>
                </div>

                <label className="payroll-payment-control-reason">
                  <span>سبب إلغاء تسجيل الدفع</span>
                  <textarea
                    rows={3}
                    value={paymentControl.reason}
                    onChange={(event) =>
                      setPaymentControl({
                        ...paymentControl,
                        reason: event.target.value,
                      })
                    }
                    placeholder="مثال: تم تسجيل الدفع بالخطأ قبل تنفيذ التحويل البنكي"
                  />
                </label>
              </>
            )}

            <footer>
              <button
                type="button"
                onClick={() => setPaymentControl(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={
                  Boolean(busy) ||
                  paymentControlTargets.length === 0 ||
                  (paymentControl.mode !== "pay-batch" &&
                    !paymentControl.reason.trim())
                }
                onClick={() => void submitPaymentControl()}
              >
                {paymentControl.mode === "pay-batch"
                  ? "تأكيد تسجيل الدفع"
                  : "تأكيد إلغاء تسجيل الدفع"}
              </button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {lateApproval ? createPortal(
        <div
          className="dashboard-v2 payroll-modal-backdrop"
          role="presentation"
          onMouseDown={() => setLateApproval(null)}
        >
          <aside
            className="payroll-modal payroll-late-approval-modal dsv2-workflow-reference"
            role="dialog"
            aria-modal="true"
            aria-label="تسجيل اعتماد متأخر"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>توثيق عملية حدثت سابقًا</span>
                <h2>تسجيل اعتماد متأخر</h2>
                <p>سجّل تاريخ ومبلغ الاعتماد الذي تم فعليًا ولم يُوثق وقتها.</p>
              </div>
              <button
                type="button"
                className="payroll-late-approval-close"
                onClick={() => setLateApproval(null)}
                aria-label="إغلاق"
              >
                <FiX />
              </button>
            </header>

            <div className="payroll-late-approval-note is-warning">
              <FiAlertTriangle />
              <div>
                <strong>لن نعيد حساب الماضي من بيانات اليوم.</strong>
                <small>
                  المبلغ الذي تدخله هو المبلغ الذي تم اعتماده فعليًا، وهو
                  مرجع التسوية اللاحقة.
                </small>
              </div>
            </div>

            <div className="payroll-late-approval-fields">
              <label>
                <span>الموظفة</span>
                <DashboardSelectV2
                  value={lateApproval.employeeId}
                  options={lateApprovalCandidates.map((entry) => ({
                    value: entry.employeeId,
                    label: entry.employeeName || entry.employeeId,
                  }))}
                  onChange={(employeeId) => {
                    const nextEntry = lateApprovalCandidates.find(
                      (entry) => entry.employeeId === employeeId
                    );
                    setLateApproval({
                      ...lateApproval,
                      employeeId,
                      approvedAmountRiyals: (
                        Number(nextEntry?.netSalaryHalalas || 0) / 100
                      ).toFixed(2),
                    });
                  }}
                />
              </label>

              <label>
                <span>مسيرة الراتب</span>
                <input
                  className="dsv2-input"
                  readOnly
                  dir="ltr"
                  value={payrollMonth}
                />
              </label>

              <label>
                <span>تاريخ الاعتماد الفعلي</span>
                <DashboardDatePickerV2
                  value={lateApproval.approvalDate}
                  min={payrollBounds.monthStart}
                  max={lateApprovalMaxDate}
                  clearable={false}
                  placeholder="اختر التاريخ"
                  onChange={(approvalDate) =>
                    setLateApproval({ ...lateApproval, approvalDate })
                  }
                />
              </label>

              <label>
                <span>المبلغ المعتمد فعليًا</span>
                <div className="payroll-late-approval-amount-wrap">
                  <DashboardNumberInputV2
                    className="dsv2-input payroll-late-approval-amount"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={lateApproval.approvedAmountRiyals}
                    onChange={(event) =>
                      setLateApproval({
                        ...lateApproval,
                        approvedAmountRiyals: event.target.value,
                      })
                    }
                    placeholder="3610.00"
                  />
                  <span className="payroll-late-approval-currency">SAR</span>
                </div>
                {selectedLateApprovalEntry ? (
                  <small>
                    تم تعبئة المبلغ تلقائيًا من حساب النظام. عدله فقط إذا كان
                    المبلغ الذي تم اعتماده فعليًا وقتها مختلفًا.
                  </small>
                ) : null}
              </label>

              <label className="payroll-late-approval-reason">
                <span>سبب التسجيل المتأخر</span>
                <textarea
                  className="dsv2-textarea"
                  rows={2}
                  value={lateApproval.reason}
                  onChange={(event) =>
                    setLateApproval({
                      ...lateApproval,
                      reason: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="payroll-late-approval-audit">
              <FiClock />
              <div>
                <strong>
                  تاريخ الاعتماد الفعلي:{" "}
                  {lateApproval.approvalDate || "لم يُحدد"}
                </strong>
                <small>
                  تاريخ إدخال السجل في النظام يبقى وقت اليوم الحقيقي لأغراض
                  التدقيق.
                </small>
              </div>
            </div>

            <footer>
              <button type="button" onClick={() => setLateApproval(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={
                  busy.startsWith("late-approve:") ||
                  !selectedLateApprovalEntry ||
                  !lateApproval.approvalDate ||
                  lateApproval.approvedAmountRiyals === "" ||
                  !lateApproval.reason.trim()
                }
                onClick={() => void submitLateApproval()}
              >
                تسجيل الاعتماد المتأخر
              </button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {approvalConfirmation ? createPortal(
        <div
          className="dashboard-v2 payroll-modal-backdrop"
          role="presentation"
          onMouseDown={() => setApprovalConfirmation(null)}
        >
          <aside
            className="payroll-modal payroll-adjustment-modal dsv2-workflow-reference"
            role="dialog"
            aria-modal="true"
            aria-label="تأكيد اعتماد الراتب الجزئي"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>تأكيد الاعتماد</span>
                <h2>{approvalConfirmation.entry.employeeName}</h2>
              </div>
              <button type="button" onClick={() => setApprovalConfirmation(null)} aria-label="إغلاق">
                <FiX />
              </button>
            </header>

            <div className="payroll-alert is-warning">
              <FiAlertTriangle />
              <div>
                <strong>
                  سيتم اعتماد راتب {approvalConfirmation.entry.payrollMonth} الكامل المتوقع،
                  وليس راتب الأيام المنقضية فقط.
                </strong>
                <small>
                  راتب الشهر الكامل المتوقع للاعتماد:{" "}
                  {formatPayrollMoney(approvalConfirmation.expectedNetHalalas)}
                </small>
                <small>
                  المستحق المكتسب حتى{" "}
                  {calculatePayrollAccrualView(approvalConfirmation.entry)
                    .completedThroughDate || "آخر يوم مكتمل"}:{" "}
                  {formatPayrollMoney(
                    calculatePayrollAccrualView(approvalConfirmation.entry)
                      .earnedToDateHalalas
                  )}{" "}
                  — للمراجعة فقط
                </small>
              </div>
            </div>

            <p>
              تاريخ الاعتماد المبكر لا يغيّر فترة الراتب: الاعتماد يخص راتب
              الشهر كاملًا. أي فرق يظهر لاحقًا خلال بقية الشهر، مثل الغياب أو
              نقص الساعات أو الإجازة بدون راتب، سيُرحّل تلقائيًا كتسوية إلى
              أول مسيرة لاحقة قبل اعتمادها.
            </p>

            <footer>
              <button type="button" onClick={() => setApprovalConfirmation(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy.startsWith("approve:")}
                onClick={() => void submitApprovalConfirmation()}
              >
                تأكيد الاعتماد
              </button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {reopenDraft ? createPortal(
        <div
          className="dashboard-v2 payroll-modal-backdrop"
          role="presentation"
          onMouseDown={() => setReopenDraft(null)}
        >
          <aside
            className="payroll-modal payroll-adjustment-modal dsv2-workflow-reference"
            role="dialog"
            aria-modal="true"
            aria-label="إعادة فتح الراتب"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>إعادة فتح الراتب</span>
                <h2>{reopenDraft.entry.employeeName}</h2>
              </div>
              <button type="button" onClick={() => setReopenDraft(null)} aria-label="إغلاق">
                <FiX />
              </button>
            </header>

            <div className="payroll-alert is-warning">
              <FiAlertTriangle />
              <div>
                <strong>سيعود الراتب المعتمد إلى مسودة قابلة لإعادة الحساب.</strong>
                <small>لن يتم تعديل الراتب تلقائيًا حتى تنفيذ إعادة الحساب.</small>
              </div>
            </div>

            <label>
              <span>سبب إعادة الفتح</span>
              <textarea
                rows={3}
                value={reopenDraft.reason}
                onChange={(event) =>
                  setReopenDraft({
                    ...reopenDraft,
                    reason: event.target.value,
                  })
                }
              />
            </label>

            <footer>
              <button type="button" onClick={() => setReopenDraft(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy.startsWith("reopen:")}
                onClick={() => void submitReopen()}
              >
                تأكيد إعادة الفتح
              </button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {attendanceDeferral ? createPortal(
        <div className="dashboard-v2 payroll-modal-backdrop" role="presentation" onMouseDown={() => setAttendanceDeferral(null)}>
          <aside className="payroll-modal payroll-adjustment-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>تأجيل خصم الحضور</span>
                <h2>{attendanceDeferral.entry.employeeName}</h2>
              </div>
              <button type="button" onClick={() => setAttendanceDeferral(null)}><FiX /></button>
            </header>
            <label>
              <span>خصم الحضور الحالي</span>
              <input readOnly value={(Number(attendanceDeferral.entry.missingHoursDeductionHalalas || 0) / 100).toFixed(2)} />
            </label>
            <label>
              <span>شهر الخصم الأصلي</span>
              <input readOnly value={attendanceDeferral.entry.payrollMonth} />
            </label>
            <label>
              <span>شهر التحصيل الجديد</span>
              <DashboardSelectV2
                value={attendanceDeferral.targetPayrollMonth}
                options={futurePayrollMonthOptions(
                  attendanceDeferral.entry.payrollMonth
                )}
                onChange={(value) =>
                  setAttendanceDeferral({
                    ...attendanceDeferral,
                    targetPayrollMonth: value,
                  })
                }
              />
            </label>
            <label>
              <span>سبب التأجيل</span>
              <input
                value={attendanceDeferral.reason}
                onChange={(event) => setAttendanceDeferral({ ...attendanceDeferral, reason: event.target.value })}
                placeholder="مثال: ظرف الموظفة — بموافقة الإدارة"
              />
            </label>
            <label>
              <span>ملاحظة اختيارية</span>
              <textarea value={attendanceDeferral.note} onChange={(event) => setAttendanceDeferral({ ...attendanceDeferral, note: event.target.value })} />
            </label>
            <footer>
              <button type="button" onClick={() => setAttendanceDeferral(null)}>إلغاء</button>
              <button type="button" className="is-primary" disabled={busy === "attendance-deferral"} onClick={() => void submitAttendanceDeferral()}>تأكيد التأجيل</button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}

      {adjustment ? createPortal(
        <div className="dashboard-v2 payroll-modal-backdrop" role="presentation" onMouseDown={() => setAdjustment(null)}>
          <aside className="payroll-modal payroll-adjustment-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>{adjustment.mode === "addition" ? "إضافة استحقاق" : "إضافة خصم"}</span>
                <h2>{adjustment.entry.employeeName}</h2>
              </div>
              <button type="button" onClick={() => setAdjustment(null)}><FiX /></button>
            </header>
            <label>
              <span>النوع</span>
              <DashboardSelectV2
                value={adjustment.kind}
                options={adjustment.mode === "addition" ? ADDITION_KINDS : DEDUCTION_KINDS}
                onChange={(value) =>
                  setAdjustment({ ...adjustment, kind: value as PayrollManualItemKind })
                }
              />
            </label>
            <label>
              <span>المبلغ</span>
              <DashboardNumberInputV2 min="0" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} />
            </label>
            <label>
              <span>السبب</span>
              <input value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} />
            </label>
            <label>
              <span>ملاحظة اختيارية</span>
              <textarea value={adjustment.note} onChange={(event) => setAdjustment({ ...adjustment, note: event.target.value })} />
            </label>
            <footer>
              <button type="button" onClick={() => setAdjustment(null)}>إلغاء</button>
              <button type="button" className="is-primary" disabled={busy === "adjustment"} onClick={() => void submitAdjustment()}>حفظ البند</button>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}
    </section>
  );
}

function PayrollDetailsModal({
  entry,
  onClose,
  onAdd,
  canManage,
  sourceCarryovers,
  historicalSettlements,
  onRecordHistoricalSettlement,
  onVoidHistoricalSettlement,
  onExportPayslipPdf,
  onExportPayslipExcel,
  onExportPayslipMobileExcel,
  payrollBounds,
}: {
  entry: PayrollEntryView;
  onClose: () => void;
  onAdd: (mode: AdjustmentMode) => void;
  canManage: boolean;
  sourceCarryovers: CorePayrollCarryoverAdjustment[];
  historicalSettlements: CorePayrollHistoricalSettlement[];
  onRecordHistoricalSettlement: () => void;
  onVoidHistoricalSettlement: (
    settlement: CorePayrollHistoricalSettlement
  ) => void;
  onExportPayslipPdf: () => void;
  onExportPayslipExcel: () => void;
  onExportPayslipMobileExcel: () => void;
  payrollBounds: { monthStart: string; monthEnd: string; payDate: string; payrollMonth: string };
}) {
  const missingLabels = setupMissingLabels(entry);
  const payrollMoney = calculatePayrollAccrualView(entry);
  const approvalReadiness = payrollApprovalReadiness(
    entry as unknown as Record<string, unknown>
  );
  const deferredAttendanceHalalas = attendanceDeferredAmountHalalas(entry);
  const deferredAttendanceTarget = attendanceDeferralTargetMonth(entry);
  const carriedAttendanceDeductionHalalas =
    payrollAttendanceObligationDeductionTotal(entry.deductions || []);
  const otherScheduledDeductionHalalas =
    payrollOtherObligationDeductionTotal(entry.deductions || []);
  const unclassifiedDeductionHalalas = payrollUnclassifiedDeductionsHalalas(entry);
  return createPortal(
    <div className="dashboard-v2 payroll-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="payroll-modal payroll-detail-modal dsv2-workflow-reference dsv2-workflow-reference--wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{entry.payrollMonth}</span>
            <h2>{entry.employeeName}</h2>
            <p>{entry.jobTitle || "موظفة"} · {STATUS_LABELS[entry.status] || entry.status}</p>
          </div>
          <div className="payroll-modal-actions">
            <a className="payroll-action-link" href={employeeTargetPath(entry)}><FiTarget />تارقت الموظفة</a>
            <button type="button" onClick={onExportPayslipPdf}><FiFileText /> تصدير كشف راتب PDF</button>
            <button type="button" onClick={onExportPayslipExcel}><FiDownload /> تصدير كشف راتب Excel</button>
            <button type="button" onClick={onExportPayslipMobileExcel}><FiDownload /> تصدير كشف راتب Excel جوال</button>
            <button type="button" onClick={onClose} aria-label="إغلاق"><FiX /></button>
          </div>
        </header>

        {!entry.payrollSetupComplete ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>لا يمكن اعتماد هذا الراتب لأن بيانات الراتب غير مكتملة.</strong>
              <small>{missingLabels.join("، ")}</small>
            </div>
          </div>
        ) : null}

        {entry.payrollSetupComplete && payrollMoney.isPartial ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>هذه مسيرة جزئية وليست راتبًا نهائيًا.</strong>
              <small>
                محسوبة حتى {payrollMoney.completedThroughDate || "لم تبدأ الفترة"} من فترة {payrollBounds.monthStart} إلى {payrollBounds.monthEnd}.
              </small>
            </div>
          </div>
        ) : null}

        {attendanceDeductionBlocked(entry) ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>{attendanceDeductionMessage(entry)}</strong>
              <small>نقص الساعات ظاهر للمراجعة فقط ولن يتحول إلى خصم مالي تلقائي.</small>
            </div>
          </div>
        ) : null}

        <div className="payroll-detail-grid">
          <section>
            <h3>إعدادات الراتب</h3>
            <dl>
              <div><dt>حالة الإعداد</dt><dd>{entry.payrollSetupComplete ? "مكتمل" : "غير مكتمل"}</dd></div>
              <div><dt>الراتب الأساسي</dt><dd>{formatBaseSalary(entry)}</dd></div>
              <div><dt>عدد أيام العمل</dt><dd>{setupMissing(entry, "workDays") ? UNDEFINED_VALUE_LABEL : entry.workDays}</dd></div>
              <div><dt>ساعات الفترة</dt><dd>{formatMonthlyHours(entry)}</dd></div>
              <div><dt>ساعات اليوم المعتمدة</dt><dd>{attendancePayrollExempt(entry) ? "غير مطلوبة — معفى من الحضور" : entry.dailyScheduledHours > 0 ? formatAttendanceHours(entry.dailyScheduledHours) : UNDEFINED_VALUE_LABEL}</dd></div>
              <div><dt>راتب اليوم</dt><dd>{formatSetupMoney(entry, entry.dailyRateHalalas)}</dd></div>
              <div><dt>راتب الساعة</dt><dd>{formatSetupMoney(entry, entry.hourlyRateHalalas)}</dd></div>
              <div><dt>معامل الأوفر تايم</dt><dd>{entry.overtimeMultiplier}</dd></div>
              <div><dt>مصدر الساعات</dt><dd>{entry.monthlyHoursSource === "not_required_attendance_exempt" ? "غير مطلوبة — معفى من الحضور" : entry.monthlyHoursSource === "configured_monthly_hours" ? "ساعات شهر محددة" : entry.monthlyHoursSource === "configured_daily_hours" ? "دوام يومي معتمد" : entry.monthlyHoursSource === "saved_snapshot" ? "Snapshot محفوظ" : "غير محدد"}</dd></div>
            </dl>
            {!entry.payrollSetupComplete ? (
              <a className="payroll-action-link payroll-action-link--inline" href={employeePayrollPath(entry)}><FiEdit3 />فتح ملف الموظفة</a>
            ) : null}
          </section>

          <section>
            <h3>ملخص الحضور</h3>
            <dl>
              <div><dt>أيام الحضور</dt><dd>{entry.attendanceSummary.attendanceDays}</dd></div>
              <div><dt>حالة ربط الحضور</dt><dd>{attendanceLinkLabel(entry)}</dd></div>
              <div><dt>عدد البصمات المرتبطة</dt><dd>{entry.attendanceSummary.attendanceRecordCount || 0}</dd></div>
              <div><dt>أيام الغياب</dt><dd>{entry.attendanceSummary.absentDays}</dd></div>
              <div><dt>أيام الإجازة المعتمدة</dt><dd>{entry.attendanceSummary.approvedLeaveDays || 0}</dd></div>
              <div><dt>أيام الغياب/الاستثناء المعتمد</dt><dd>{entry.attendanceSummary.approvedAbsenceDays || 0}</dd></div>
              <div><dt>إجمالي ساعات الدوام المطلوبة</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)}</dd></div>
              <div><dt>إجمالي ساعات العمل الفعلية</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)}</dd></div>
              <div><dt>إجمالي التأخير الفعلي</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalLateHours)}</dd></div>
              <div><dt>إجمالي الانصراف المبكر</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalEarlyLeaveHours || 0)}</dd></div>
              <div><dt>إجمالي التعويض بعد الدوام</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalCompensatedLateHours)}</dd></div>
              <div><dt>إجمالي نقص الساعات</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalMissingHours)}</dd></div>
              <div><dt>أيام ناقصة البصمة</dt><dd>{entry.attendanceSummary.incompleteDays}</dd></div>
              <div><dt>إجمالي الساعات الزائدة المكتشفة</dt><dd>{formatAttendanceHours(entry.detectedExtraHours)}</dd></div>
            </dl>
          </section>

          {(entry.attendanceSummary.attendanceNotes || []).length ? (
            <section>
              <h3>ملاحظات الحضور</h3>
              <div className="payroll-attendance-note-list">
                {entry.attendanceSummary.attendanceNotes!.map((note, index) => (
                  <span key={`${note}:${index}`}>{note}</span>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3>الاستحقاقات</h3>
            <dl>
              <div><dt>الراتب الأساسي</dt><dd>{formatBaseSalary(entry)}</dd></div>
              <div><dt>البدلات</dt><dd>{formatPayrollMoney(entry.allowancesHalalas)}</dd></div>
              <div><dt>المكافآت والإضافات</dt><dd>{formatPayrollMoney(Math.max(0, entry.manualAdditionsHalalas - payrollLeaveCompensationHalalas(entry)))}</dd></div>
              <div><dt>تعويض رصيد الإجازات</dt><dd>{formatPayrollMoney(payrollLeaveCompensationHalalas(entry))}</dd></div>
              <div><dt>الساعات الزائدة المكتشفة</dt><dd>{formatAttendanceHours(entry.detectedExtraHours)}</dd></div>
              <div><dt>احتساب الأوفر تايم</dt><dd>{entry.overtimeEnabled ? "مفعل" : "غير مفعل"}</dd></div>
              <div><dt>قيمة الأوفر تايم</dt><dd>{formatSetupMoney(entry, entry.overtimeValueHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("addition")}><FiPlus />إضافة استحقاق</button>
          </section>

          <section>
            <h3>الخصومات</h3>
            <dl>
              <div><dt>خصم الغياب</dt><dd>{formatPayrollMoney(entry.absenceDeductionHalalas)}</dd></div>
              <div><dt>خصم حضور هذه الفترة (نقص ساعات / تأخير / خروج مبكر)</dt><dd>{formatAttendanceDeduction(entry)}</dd></div>
              {deferredAttendanceHalalas > 0 ? (
                <div><dt>خصم حضور مؤجل (لا يخصم هذه الفترة)</dt><dd>{formatPayrollMoney(deferredAttendanceHalalas)} · التحصيل في {deferredAttendanceTarget || "شهر لاحق"}</dd></div>
              ) : null}
              <div><dt>خصم التأمينات الاجتماعية (GOSI)</dt><dd>{formatPayrollMoney(entry.insuranceDeductionHalalas)}</dd></div>
              {carriedAttendanceDeductionHalalas > 0 ? (
                <div>
                  <dt>خصم حضور (لم يخصم في الفترة السابقة)</dt>
                  <dd>{formatPayrollMoney(carriedAttendanceDeductionHalalas)}</dd>
                </div>
              ) : null}
              <div>
                <dt>استقطاعات مجدولة أخرى</dt>
                <dd>{formatPayrollMoney(otherScheduledDeductionHalalas)}</dd>
              </div>
              <div><dt>تسويات فترات سابقة</dt><dd>{formatPreviousPeriodAdjustment(entry)}</dd></div>
              <div><dt>السلف</dt><dd>{formatPayrollMoney(entry.advancesHalalas)}</dd></div>
              <div><dt>خصومات يدوية وجزاءات أخرى</dt><dd>{formatPayrollMoney(ordinaryManualDeductionsHalalas(entry))}</dd></div>
              {unclassifiedDeductionHalalas > 0 ? (
                <div><dt>خصومات أخرى غير مصنفة</dt><dd>{formatPayrollMoney(unclassifiedDeductionHalalas)}</dd></div>
              ) : null}
              <div><dt>إجمالي الخصومات</dt><dd>{formatSetupMoney(entry, entry.totalDeductionsHalalas)}</dd></div>
              <div><dt>مساهمة المنشأة في GOSI</dt><dd>{formatPayrollMoney(entry.employerGosiContributionHalalas)} <small>تكلفة على المنشأة ولا تخصم من صافي الموظفة.</small></dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("deduction")}><FiPlus />إضافة خصم</button>
          </section>
        </div>

        <section className="payroll-net-panel">
          <div><span>إجمالي الراتب</span><strong>{formatSetupMoney(entry, entry.grossSalaryHalalas)}</strong></div>
          <div><span>البدلات التعاقدية</span><strong>{formatPayrollMoney(entry.allowancesHalalas)}</strong></div>
          <div><span>الإضافات والمكافآت</span><strong>{formatPayrollMoney(payrollOrdinaryAdditionsHalalas(entry))}</strong></div>
          <div><span>الأوفر تايم</span><strong>{formatPayrollMoney(entry.overtimeValueHalalas)}</strong></div>
          <div><span>تعويض رصيد الإجازات</span><strong>{formatPayrollMoney(payrollLeaveCompensationHalalas(entry))}</strong></div>
          <div><span>إجمالي الخصومات</span><strong>{formatSetupMoney(entry, entry.totalDeductionsHalalas)}</strong></div>
          <div className="is-net">
            <span>{payrollMoney.isPartial ? "المستحق حتى اليوم" : "صافي الراتب النهائي"}</span>
            <strong>{formatSetupMoney(entry, payrollMoney.earnedToDateHalalas)}</strong>
          </div>
          {payrollMoney.isPartial ? (
            <div>
              <span>الصافي المتوقع نهاية الفترة</span>
              <strong>{formatSetupMoney(entry, payrollMoney.expectedNetHalalas)}</strong>
            </div>
          ) : null}
        </section>

        {["approved", "paid"].includes(entry.status) ? (
          <section className="payroll-adjustment-list">
            <h3>تسويات بعد إقفال هذه الفترة</h3>

            {sourceCarryovers.some((row) => row.status === "pending") ? (
              sourceCarryovers
                .filter((row) => row.status === "pending")
                .map((row) => (
                  <article key={row.id}>
                    <strong>
                      {row.direction === "addition"
                        ? "فرق مستحق للموظفة"
                        : "فرق مستحق على الموظفة"}
                    </strong>
                    <span>{formatPayrollMoney(row.amountHalalas)}</span>
                    <small>
                      سيترحل إلى {row.targetPayrollMonth} إذا لم تتم تسويته مباشرة.
                    </small>
                  </article>
                ))
            ) : (
              <p>لا يوجد فرق مالي معلّق للترحيل من هذه الفترة.</p>
            )}

            {historicalSettlements.length ? (
              historicalSettlements.map((settlement) => (
                <article key={settlement.id}>
                  <strong>
                    {settlement.direction === "addition"
                      ? "تم دفع فرق للموظفة"
                      : "تم تحصيل فرق من الموظفة"}
                    {settlement.status === "void" ? " — ملغاة" : ""}
                  </strong>
                  <span>
                    {formatPayrollMoney(settlement.amountHalalas)}
                  </span>
                  <small>
                    {settlement.settlementDate} · {settlement.reason}
                    {settlement.reference
                      ? ` · مرجع: ${settlement.reference}`
                      : ""}
                  </small>
                  {canManage && settlement.status === "recorded" ? (
                    <button
                      type="button"
                      onClick={() =>
                        onVoidHistoricalSettlement(settlement)
                      }
                    >
                      إلغاء تسجيل التسوية
                    </button>
                  ) : null}
                </article>
              ))
            ) : null}

            {canManage &&
            sourceCarryovers.some((row) => row.status === "pending") ? (
              <button
                type="button"
                onClick={onRecordHistoricalSettlement}
              >
                <FiDollarSign /> تسجيل دفع/تحصيل الفرق مباشرة
              </button>
            ) : null}

            <small>
              الراتب المعتمد أو المدفوع نفسه يبقى كما هو. هذه السجلات
              توثق فقط الفروقات التي ظهرت بعد الإقفال.
            </small>
          </section>
        ) : null}

        <section className="payroll-adjustment-list">
          <h3>البنود اليدوية</h3>
          {[...entry.additions, ...entry.deductions].length ? (
            [...entry.additions, ...entry.deductions].map((item) => (
              <article key={item.id}>
                <strong>{payrollItemLabel(item)}</strong>
                <span>{formatPayrollMoney(item.amountHalalas)}</span>
                <small>{item.reason}{item.note ? ` · ${item.note}` : ""}</small>
              </article>
            ))
          ) : (
            <p>لا توجد بنود يدوية.</p>
          )}
        </section>


      </aside>
    </div>,
    document.body
  );
}
