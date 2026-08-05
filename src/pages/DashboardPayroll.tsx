import { useEffect, useMemo, useState } from "react";
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
import { DashboardSelectV2 } from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import { CoreHrService } from "../services/CoreHrService";
import {
  approvePayrollEntry,
  calculatePayrollAccrualView,
  ensurePayrollPeriod,
  generatePayrollEntries,
  loadPayrollMonth,
  markPayrollEntryPaid,
  payrollMonthBounds,
  payrollAccrualPeriodStatus,
  rebuildPayrollEntryFromEmployeeSettings,
  reopenPayrollEntry,
  savePayrollDrafts,
  togglePayrollOvertime,
  updatePayrollEntryAdjustments,
  type PayrollEntryView,
} from "../services/CorePayrollService";
import type { CoreHrEmployee } from "../types/hrCoreApi";
import {
  assertManualPayrollItem,
  calculatePayrollSnapshot,
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
  isPayrollExportEligible,
  payrollExportExclusionReason,
} from "../helpers/reports/exportPayrollReport";
import {
  exportPayrollPayslipPdfV2,
  exportPayrollReportExcelV2,
  exportPayrollReportPdfV2,
} from "../helpers/reports/exportPayrollReportV2";
import "../styles/dashboard-v2/pages/payroll.css";

type AdjustmentMode = "addition" | "deduction";

type AdjustmentDraft = {
  mode: AdjustmentMode;
  entry: PayrollEntryView;
  kind: PayrollManualItemKind;
  amount: string;
  reason: string;
  note: string;
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
  { value: "advance", label: "سلفة" },
  { value: "penalty", label: "جزاء" },
  { value: "manual_deduction", label: "خصم يدوي" },
  { value: "other_deduction", label: "استقطاع آخر" },
];

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
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

function rebuildEntry(entry: PayrollEntryView, patch: Partial<PayrollEntryView> = {}) {
  const merged = { ...entry, ...patch };
  const snapshot = calculatePayrollSnapshot({
    employeeId: merged.employeeId,
    employeeName: merged.employeeName,
    jobTitle: merged.jobTitle,
    payrollMonth: merged.payrollMonth,
    baseSalaryHalalas: merged.baseSalaryHalalas,
    allowancesHalalas: merged.allowancesHalalas,
    workDays: merged.workDays,
    monthlyHours: merged.monthlyHours,
    dailyScheduledHours: merged.dailyScheduledHours,
    attendanceSummary: merged.attendanceSummary,
    additions: merged.additions,
    deductions: merged.deductions,
    overtimeEnabled: merged.overtimeEnabled,
    overtimeMultiplier: merged.overtimeMultiplier,
    status: merged.status as PayrollStatus,
    notes: merged.notes,
  });
  return {
    ...merged,
    ...snapshot,
    id: entry.id,
    periodId: entry.periodId,
    saved: entry.saved,
    approvedAt: entry.approvedAt,
    paidAt: entry.paidAt,
    auditLog: entry.auditLog,
  };
}

function statusClass(status: string) {
  if (status === "paid") return "is-paid";
  if (status === "approved") return "is-approved";
  return "is-draft";
}

function itemKindLabel(kind: string) {
  return [...ADDITION_KINDS, ...DEDUCTION_KINDS].find((item) => item.value === kind)?.label || kind;
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
  return entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "ساعات الفترة غير محددة";
}

function employeePayrollPath(entry: PayrollEntryView) {
  return `/admin/employees/${encodeURIComponent(entry.employeeId)}/payroll#payroll-settings`;
}

function employeeTargetPath(entry: PayrollEntryView) {
  return `/dashboard/employee-targets?employee=${encodeURIComponent(entry.employeeId)}&payrollMonth=${encodeURIComponent(entry.payrollMonth)}`;
}

function attendanceDeductionBlocked(entry: PayrollEntryView) {
  return entry.attendanceSummary.attendanceDeductionEligible === false;
}

function attendanceDeductionMessage(entry: PayrollEntryView) {
  return entry.attendanceSummary.attendanceDeductionNote || "لم يتم تطبيق خصم الحضور لأن ربط البصمات غير مكتمل أو غير مؤكد.";
}

function attendanceLinkLabel(entry: PayrollEntryView) {
  const status = entry.attendanceSummary.attendanceLinkStatus;
  if (status === "confirmed") {
    return entry.attendanceSummary.incompleteDays > 0 ? "مؤكد - بصمة ناقصة" : "مؤكد";
  }
  if (status === "not_ready") return "غير جاهز";
  return "غير مربوط";
}

function attendanceCarryoverDeductions(entry: PayrollEntryView) {
  return entry.deductions.filter((item) =>
    String(item.id || "").startsWith("attendance_penalty_carryover") ||
    String(item.note || "").includes("attendance_penalty_carryover")
  );
}

function attendanceCarryoverDeductionAmount(entry: PayrollEntryView) {
  return attendanceCarryoverDeductions(entry).reduce((total, item) => total + Number(item.amountHalalas || 0), 0);
}

function formatAttendanceDeduction(entry: PayrollEntryView) {
  if (!entry.payrollSetupComplete) return UNDEFINED_VALUE_LABEL;
  if (attendanceDeductionBlocked(entry)) return "لم يطبق";
  return "مؤجل للشهر القادم";
}

function formatPreviousAttendanceDeduction(entry: PayrollEntryView) {
  const amount = attendanceCarryoverDeductionAmount(entry);
  return amount > 0 ? formatPayrollMoney(amount) : "لا يوجد";
}

function hasManualAdjustments(entry: PayrollEntryView) {
  return entry.additions.length > 0 || entry.deductions.length > 0;
}

function payrollActionErrorMessage(error: unknown, fallback: string) {
  const message = String((error as any)?.message || error || "");
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
  if (message === "payroll_paid_reopen_not_allowed" || message === "core_payroll:paid_reopen_not_allowed") {
    return "لا يمكن إعادة فتح راتب مدفوع. يحتاج ذلك مسار إلغاء دفع منفصل.";
  }
  if (message === "payroll_reopen_reason_required") {
    return "سبب إعادة فتح الراتب مطلوب.";
  }
  return String((error as any)?.message || fallback);
}

export default function DashboardPayroll() {
  const { hasPermission, role } = usePermissions();
  const canManage = hasPermission("payroll.manage");
  const initial = currentYearMonth();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employees, setEmployees] = useState<CoreHrEmployee[]>([]);
  const [entries, setEntries] = useState<PayrollEntryView[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<PayrollEntryView | null>(null);
  const [adjustment, setAdjustment] = useState<AdjustmentDraft | null>(null);
  const [includeIncompleteExport, setIncludeIncompleteExport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const payrollBounds = payrollMonthBounds(year, month);
  const payrollMonth = payrollBounds.payrollMonth;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeRows, payroll] = await Promise.all([
        CoreHrService.listEmployees({ status: "active" }),
        loadPayrollMonth({
          year,
          month,
          employeeId: employeeFilter === "all" ? undefined : employeeFilter,
          status: statusFilter === "all" ? undefined : statusFilter,
        }),
      ]);
      const employeesById = new Map(employeeRows.map((employee) => [employee.id, employee]));
      const hydratedEntries = payroll.entries.map((entry) => {
        const employee = employeesById.get(entry.employeeId);
        return employee
          ? rebuildPayrollEntryFromEmployeeSettings({ entry, employee, year, month })
          : entry;
      });
      setEmployees(employeeRows);
      setEntries(hydratedEntries);
      setMessage(hydratedEntries.length ? "تم تحميل مسيرات الرواتب المحفوظة." : "لا توجد مسيرات محفوظة لهذا الشهر بعد.");
    } catch (loadError: any) {
      setError(String(loadError?.message || "تعذر تحميل إدارة الرواتب."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [year, month, employeeFilter, statusFilter]);

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

  const summary = useMemo(() => {
    return visibleEntries.reduce(
      (acc, entry) => {
        acc.count += 1;
        if (entry.payrollSetupComplete) {
          acc.complete += 1;
          acc.base += entry.baseSalaryHalalas;
          acc.additions += entry.totalAdditionsHalalas;
          acc.deductions += entry.totalDeductionsHalalas;
          acc.net += entry.netSalaryHalalas;
          acc.earned += calculatePayrollAccrualView(entry).earnedToDateHalalas;
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
        base: 0,
        additions: 0,
        deductions: 0,
        net: 0,
        earned: 0,
        drafts: 0,
        approved: 0,
        paid: 0,
      }
    );
  }, [visibleEntries]);

  const selectedEmployeeName =
    employeeFilter === "all"
      ? "كل الموظفات"
      : employees.find((employee) => employee.id === employeeFilter)?.name || employeeFilter;
  const selectedStatusLabel = STATUS_LABELS[statusFilter] || statusFilter;
  const exportableEntries = includeIncompleteExport
    ? visibleEntries
    : visibleEntries.filter(isPayrollExportEligible);
  const exportableCount = exportableEntries.length;
  const payrollCycleLabel = `فترة الاحتساب: ${payrollBounds.monthStart} إلى ${payrollBounds.monthEnd} · الصرف المتوقع: ${payrollBounds.payDate}`;
  const payrollPeriodStatus = payrollAccrualPeriodStatus(payrollMonth);
  const payrollPartialLabel = payrollPeriodStatus.isPartial
    ? "مسيرة جزئية محسوبة حتى " + (payrollPeriodStatus.completedThroughDate || "لم تبدأ الفترة")
    : "مسيرة مكتملة / نهائية";

  const payrollReportInput = () => {
    const exportedEntries = exportableEntries;
    const excludedRows = includeIncompleteExport
      ? []
      : visibleEntries
          .filter((entry) => !isPayrollExportEligible(entry))
          .map((entry) => ({
            employeeName: entry.employeeName || entry.employeeId || "غير متوفر",
            reason: payrollExportExclusionReason(entry) || "غير قابل للتصدير",
          }));

    return {
      entries: exportedEntries,
      includeIncomplete: includeIncompleteExport,
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

  const handleGenerate = async (recalculate = false) => {
    if (!canManage) return;
    setBusy(recalculate ? "recalculate" : "generate");
    setError("");
    try {
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
      setMessage(
        recalculate
          ? `تمت إعادة الحساب للفترة ${period.monthStart} إلى ${period.monthEnd}.`
          : `تم توليد مسيرة الشهر للفترة ${period.monthStart} إلى ${period.monthEnd} كمسودات جاهزة للحفظ.`
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

  const handleToggleOvertime = async (entry: PayrollEntryView, checked: boolean) => {
    if (!canManage || isPayrollSnapshotLocked(entry.status)) return;
    if (checked && !entry.payrollSetupComplete) {
      setError("لا يمكن احتساب الأوفر تايم قبل إكمال بيانات الراتب.");
      return;
    }
    if (checked && entry.detectedExtraHours <= 0) {
      setError("لا توجد ساعات زائدة مكتشفة لهذا السجل.");
      return;
    }
    const next = rebuildEntry(entry, { overtimeEnabled: checked });
    setEntries((current) => replaceEntry(current, next));
    if (!entry.id) return;
    setBusy(`ot:${entry.id}`);
    try {
      const saved = await togglePayrollOvertime(next);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("تم حفظ خيار احتساب الساعات الإضافية لهذا السجل.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر تحديث خيار الساعات الإضافية."));
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
      const next = rebuildEntry(adjustment.entry, {
        additions: adjustment.mode === "addition" ? [...adjustment.entry.additions, item] : adjustment.entry.additions,
        deductions: adjustment.mode === "deduction" ? [...adjustment.entry.deductions, item] : adjustment.entry.deductions,
      });
      setBusy("adjustment");
      const saved = next.id ? await updatePayrollEntryAdjustments(next) : next;
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

  const handleApprove = async (entry: PayrollEntryView) => {
    if (!canManage || entry.status === "paid") return;
    if (!entry.payrollSetupComplete) {
      setError("لا يمكن اعتماد الراتب قبل إكمال بيانات الراتب.");
      return;
    }
    const payrollMoney = calculatePayrollAccrualView(entry);
    if (payrollMoney.isPartial) {
      const confirmed = window.confirm(
        "هذه مسيرة جزئية محسوبة حتى " +
          (payrollMoney.completedThroughDate || "لم تبدأ الفترة") +
          "\n\nالمستحق حتى اليوم: " +
          formatPayrollMoney(payrollMoney.earnedToDateHalalas) +
          "\nالصافي المتوقع نهاية الفترة: " +
          formatPayrollMoney(payrollMoney.expectedNetHalalas) +
          "\n\nهل تريد اعتمادها رغم أنها قبل نهاية الفترة؟"
      );
      if (!confirmed) return;
    }
    setBusy(`approve:${entry.employeeId}`);
    try {
      const saved = await approvePayrollEntry(entry);
      setEntries((current) => replaceEntry(current, saved));
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

  const handleReopen = async (entry: PayrollEntryView) => {
    const visibility = payrollActionVisibility({
      status: entry.status,
      payrollSetupComplete: entry.payrollSetupComplete,
      canManage,
      role,
    });
    if (!visibility.canReopen) return;
    const confirmed = window.confirm(
      "سيتم إعادة فتح الراتب المعتمد وتحويله إلى مسودة حتى يمكن إعادة الحساب. لن يتم تعديل الراتب تلقائيًا حتى تضغط إعادة الحساب بعد الفتح. هل تريد المتابعة؟"
    );
    if (!confirmed) return;
    const reason = window.prompt("اكتب سبب إعادة فتح الراتب", "إعادة احتساب الحضور بعد تحديث سياسة الغياب");
    if (!reason?.trim()) {
      setError("سبب إعادة فتح الراتب مطلوب.");
      return;
    }
    setBusy(`reopen:${entry.employeeId}`);
    try {
      const saved = await reopenPayrollEntry(entry, { reason: reason.trim(), status: "draft" });
      setEntries((current) => replaceEntry(current, saved));
      setSelectedEntry((current) => (current?.employeeId === saved.employeeId ? saved : current));
      setMessage("تمت إعادة فتح الراتب. يمكنك الآن إعادة الحساب ثم الاعتماد من جديد.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "تعذرت إعادة فتح الراتب."));
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
            <input
              className="dsv2-input"
              type="number"
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
              <FiSliders /> توليد المسيرة
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
          </div>

          <div className="payroll-export-meta">
            <span className="dsv2-badge dsv2-badge--success">
              سيُصدّر {exportableCount} من {visibleEntries.length}
            </span>
            <label className="payroll-export-option">
              <input
                type="checkbox"
                checked={includeIncompleteExport}
                onChange={(event) => setIncludeIncompleteExport(event.target.checked)}
              />
              <span>تضمين غير المكتمل</span>
            </label>
          </div>
        </div>
      </section>

      <div className="payroll-period-banner">
        <FiClock />
        <span>{payrollCycleLabel}</span>
        <strong>{payrollPartialLabel}</strong>
      </div>

      {error ? <div className="payroll-alert is-error">{error}</div> : null}
      {message ? <div className="payroll-alert"><FiCheckCircle />{message}</div> : null}
      {!canManage ? <div className="payroll-alert is-readonly">وضع قراءة فقط: يمكنك مراجعة الرواتب دون تعديلها.</div> : null}

      <section className="dsv2-grid dsv2-grid--metrics payroll-primary-metrics" aria-label="المؤشرات الرئيسية">
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <p className="dsv2-metric-card__label">عدد الموظفات</p>
          <strong className="dsv2-metric-card__value">{summary.count}</strong>
          <p className="dsv2-metric-card__meta">المسيرات المطابقة للفلاتر الحالية</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <p className="dsv2-metric-card__label">المستحق حتى اليوم</p>
          <strong className="dsv2-metric-card__value">{formatPayrollMoney(summary.earned)}</strong>
          <p className="dsv2-metric-card__meta">القيمة الفعلية المحسوبة حتى تاريخ اليوم</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <p className="dsv2-metric-card__label">الصافي المتوقع</p>
          <strong className="dsv2-metric-card__value">{formatPayrollMoney(summary.net)}</strong>
          <p className="dsv2-metric-card__meta">الصافي المتوقع عند اكتمال فترة الاحتساب</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--danger">
          <p className="dsv2-metric-card__label">إعدادات غير مكتملة</p>
          <strong className="dsv2-metric-card__value">{summary.incomplete}</strong>
          <p className="dsv2-metric-card__meta">تحتاج إلى استكمال بيانات الراتب</p>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded payroll-secondary-summary">
        <div className="dsv2-section-head">
          <div>
            <h2 className="dsv2-section-title">ملخص المسيرة</h2>
            <p className="dsv2-section-caption">تفاصيل مالية وتشغيلية إضافية للفترة المحددة.</p>
          </div>
          <span className="dsv2-badge">{payrollMonth}</span>
        </div>
        <div className="payroll-secondary-grid">
          <div className="dsv2-stat-row"><span>إعدادات مكتملة</span><strong>{summary.complete}</strong></div>
          <div className="dsv2-stat-row"><span>إجمالي الرواتب</span><strong>{formatPayrollMoney(summary.base)}</strong></div>
          <div className="dsv2-stat-row"><span>الإضافات</span><strong>{formatPayrollMoney(summary.additions)}</strong></div>
          <div className="dsv2-stat-row"><span>الخصومات</span><strong>{formatPayrollMoney(summary.deductions)}</strong></div>
          <div className="dsv2-stat-row"><span>المسودات</span><strong>{summary.drafts}</strong></div>
          <div className="dsv2-stat-row"><span>المعتمدة</span><strong>{summary.approved}</strong></div>
          <div className="dsv2-stat-row"><span>المدفوعة</span><strong>{summary.paid}</strong></div>
        </div>
      </section>

      {summary.incomplete > 0 ? (
        <div className="payroll-alert is-warning payroll-setup-warning" role="status">
          <FiAlertTriangle />
          <div>
            <strong>لن يتم احتساب الراتب حتى يتم إكمال إعدادات الراتب من ملف الموظفة.</strong>
            <small>الحقول المطلوبة: الراتب الأساسي، أيام العمل، وساعات الشهر.</small>
          </div>
        </div>
      ) : null}

      <section className="dsv2-table-card payroll-table-section">
        <header className="payroll-table-section__head">
          <div>
            <h2 className="dsv2-section-title">مسيرات الموظفات</h2>
            <p className="dsv2-section-caption">التفاصيل الموسعة للحضور والأوفر تايم متاحة من زر عرض.</p>
          </div>
          <span className="dsv2-badge">{visibleEntries.length} سجل</span>
        </header>
        <div className="dsv2-table-scroll payroll-table-wrap">
          <table className="dsv2-table payroll-table">
          <thead>
            <tr>
              <th>الموظفة</th>
              <th>حالة إعداد الراتب</th>
              <th>الراتب الأساسي</th>
              <th>ملخص الحضور</th>
              <th>الساعات الزائدة</th>
              <th>احتساب الأوفر تايم</th>
              <th>الإضافات</th>
              <th>الخصومات</th>
              <th>المستحق / المتوقع</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const locked = isPayrollSnapshotLocked(entry.status);
              const actions = payrollActionVisibility({
                status: entry.status,
                payrollSetupComplete: entry.payrollSetupComplete,
                canManage,
                role,
              });
              const canToggleOvertime =
                canManage &&
                !locked &&
                entry.payrollSetupComplete &&
                entry.detectedExtraHours > 0;
              const missingLabels = setupMissingLabels(entry);
              const exportEligible = isPayrollExportEligible(entry);
              const attendanceBlocked = attendanceDeductionBlocked(entry);
              const manualAdjustments = hasManualAdjustments(entry);
              const payrollMoney = calculatePayrollAccrualView(entry);
              return (
                <tr key={`${entry.employeeId}:${entry.payrollMonth}`}>
                  <td className="payroll-employee-cell">
                    <strong>{entry.employeeName}</strong>
                    <small>{entry.jobTitle || entry.employeeId}</small>
                    <div className="payroll-row-badges">
                      <span className={`payroll-mini-badge ${exportEligible ? "is-exported" : "is-excluded"}`}>
                        {exportEligible ? "داخل التصدير الرسمي" : "مستبعد من التصدير"}
                      </span>
                      {attendanceBlocked ? (
                        <span className="payroll-mini-badge is-attendance-warning">الحضور غير مربوط</span>
                      ) : null}
                      {attendanceCarryoverDeductionAmount(entry) > 0 ? (
                        <span className="payroll-mini-badge is-attendance-warning">خصم حضور مرحّل</span>
                      ) : null}
                      {manualAdjustments ? (
                        <span className="payroll-mini-badge is-manual">بنود يدوية</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="payroll-setup-cell">
                    <span className={`payroll-setup-badge ${entry.payrollSetupComplete ? "is-complete" : "is-incomplete"}`}>
                      {entry.payrollSetupComplete ? "مكتمل" : "غير مكتمل"}
                    </span>
                    {!entry.payrollSetupComplete ? (
                      <small>{missingLabels.join("، ")}</small>
                    ) : null}
                  </td>
                  <td>
                    <strong>{formatBaseSalary(entry)}</strong>
                    {!entry.payrollSetupComplete ? (
                      <small>
                        <a href={employeePayrollPath(entry)}>إعداد الراتب</a>
                      </small>
                    ) : null}
                  </td>
                  <td className="payroll-attendance-cell">
                    <span className={`payroll-mini-badge ${attendanceBlocked ? "is-attendance-warning" : "is-exported"}`}>
                      {attendanceLinkLabel(entry)}
                    </span>
                    <div className="payroll-attendance-metrics">
                      <span>حضور {entry.attendanceSummary.attendanceDays}</span>
                      <span>غياب {entry.attendanceSummary.absentDays}</span>
                      <span>ناقصة {entry.attendanceSummary.incompleteDays}</span>
                      <span>مطلوب {formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)}</span>
                      <span>فعلي {formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)}</span>
                      <span>تأخير {formatAttendanceHours(entry.attendanceSummary.totalLateHours)}</span>
                      <span>انصراف {formatAttendanceHours(entry.attendanceSummary.totalEarlyLeaveHours || 0)}</span>
                      <span>نقص {formatAttendanceHours(entry.attendanceSummary.totalMissingHours)}</span>
                    </div>
                    <small className="payroll-attendance-note">تقرير هذا الشهر فقط؛ الخصم يرحل لمسير الشهر القادم.</small>
                  </td>
                  <td>{formatAttendanceHours(entry.detectedExtraHours)}</td>
                  <td>
                    <label className="payroll-switch">
                      <input
                        type="checkbox"
                        checked={entry.overtimeEnabled}
                        disabled={!canToggleOvertime}
                        onChange={(event) => void handleToggleOvertime(entry, event.target.checked)}
                      />
                      <span />
                    </label>
                    <small>{entry.overtimeEnabled ? "محتسب" : "غير محتسب"}</small>
                  </td>
                  <td>{formatPayrollMoney(entry.totalAdditionsHalalas)}</td>
                  <td>
                    <strong>{formatPayrollMoney(entry.totalDeductionsHalalas)}</strong>
                    <small className="payroll-attendance-note">خصم حضور هذا الشهر: مؤجل</small>
                    {attendanceCarryoverDeductionAmount(entry) > 0 ? (
                      <small className="payroll-attendance-note">خصم حضور مرحّل: {formatPayrollMoney(attendanceCarryoverDeductionAmount(entry))}</small>
                    ) : null}
                  </td>
                  <td className="payroll-net-cell">
                    <strong>{formatSetupMoney(entry, payrollMoney.earnedToDateHalalas)}</strong>
                    {entry.payrollSetupComplete && payrollMoney.isPartial ? (
                      <>
                        <small>المتوقع نهاية الفترة: {formatPayrollMoney(payrollMoney.expectedNetHalalas)}</small>
                        <small>حتى {payrollMoney.completedThroughDate || "لم تبدأ الفترة"}</small>
                      </>
                    ) : null}
                  </td>
                  <td><span className={`payroll-status ${statusClass(entry.status)}`}>{STATUS_LABELS[entry.status] || entry.status}</span></td>
                  <td>
                    <details className="payroll-actions-menu">
                      <summary>الإجراءات</summary>
                      <div className="payroll-row-actions">
                        <button type="button" onClick={() => setSelectedEntry(entry)}><FiEye />عرض التفاصيل</button>
                        <button type="button" disabled={!actions.canRecalculate} onClick={() => void handleRecalculateEntry(entry)}>إعادة الحساب</button>
                        <button type="button" disabled={!actions.canEditAdjustments} onClick={() => openAdjustment(entry, "deduction")}>إضافة خصم</button>
                        <button type="button" disabled={!actions.canEditAdjustments} onClick={() => openAdjustment(entry, "addition")}>إضافة استحقاق</button>
                        {!entry.payrollSetupComplete ? (
                          <span className="payroll-action-help">
                            <a className="payroll-action-link" href={employeePayrollPath(entry)}><FiEdit3 />فتح ملف الموظفة</a>
                            <small>استكمال الراتب الأساسي وأيام وساعات العمل</small>
                          </span>
                        ) : null}
                        {actions.showApprove ? (
                          <button type="button" disabled={!actions.canApprove} onClick={() => void handleApprove(entry)}>اعتماد</button>
                        ) : null}
                        {actions.showMarkPaid ? (
                          <button type="button" disabled={!actions.canMarkPaid} onClick={() => void handlePaid(entry)}>تسجيل كمدفوع</button>
                        ) : null}
                        {actions.showReopen ? (
                          <button type="button" disabled={!actions.canReopen || busy === `reopen:${entry.employeeId}`} onClick={() => void handleReopen(entry)}><FiUnlock />إعادة فتح الراتب</button>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
          {!loading && !visibleEntries.length ? (
            <p className="payroll-empty">لا توجد رواتب مطابقة. استخدم زر توليد المسيرة لإنشاء مسودات.</p>
          ) : null}
        </div>
      </section>

      {selectedEntry ? (
        <PayrollDetailsModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onAdd={(mode) => openAdjustment(selectedEntry, mode)}
          onExportPayslip={() => exportPayrollPayslipPdfV2({ entry: selectedEntry, payrollBounds })}
          payrollBounds={payrollBounds}
        />
      ) : null}

      {adjustment ? (
        <div className="payroll-modal-backdrop" role="presentation" onMouseDown={() => setAdjustment(null)}>
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
              <input type="number" min="0" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} />
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
        </div>
      ) : null}
    </section>
  );
}

function PayrollDetailsModal({
  entry,
  onClose,
  onAdd,
  onExportPayslip,
  payrollBounds,
}: {
  entry: PayrollEntryView;
  onClose: () => void;
  onAdd: (mode: AdjustmentMode) => void;
  onExportPayslip: () => void;
  payrollBounds: { monthStart: string; monthEnd: string; payDate: string; payrollMonth: string };
}) {
  const missingLabels = setupMissingLabels(entry);
  const payrollMoney = calculatePayrollAccrualView(entry);
  return (
    <div className="payroll-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="payroll-modal payroll-detail-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{entry.payrollMonth}</span>
            <h2>{entry.employeeName}</h2>
            <p>{entry.jobTitle || "موظفة"} · {STATUS_LABELS[entry.status] || entry.status}</p>
          </div>
          <div className="payroll-modal-actions">
            <a className="payroll-action-link" href={employeeTargetPath(entry)}><FiTarget />تارقت الموظفة</a>
            <button type="button" onClick={onExportPayslip}><FiFileText /> تصدير كشف راتب PDF</button>
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
              <div><dt>ساعات اليوم المعتمدة</dt><dd>{entry.dailyScheduledHours > 0 ? formatAttendanceHours(entry.dailyScheduledHours) : UNDEFINED_VALUE_LABEL}</dd></div>
              <div><dt>راتب اليوم</dt><dd>{formatSetupMoney(entry, entry.dailyRateHalalas)}</dd></div>
              <div><dt>راتب الساعة</dt><dd>{formatSetupMoney(entry, entry.hourlyRateHalalas)}</dd></div>
              <div><dt>معامل الأوفر تايم</dt><dd>{entry.overtimeMultiplier}</dd></div>
              <div><dt>مصدر الساعات</dt><dd>{entry.monthlyHoursSource === "configured_monthly_hours" ? "ساعات شهر محددة" : entry.monthlyHoursSource === "configured_daily_hours" ? "دوام يومي معتمد" : entry.monthlyHoursSource === "saved_snapshot" ? "Snapshot محفوظ" : "غير محدد"}</dd></div>
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
              <div><dt>المكافآت والإضافات</dt><dd>{formatPayrollMoney(entry.manualAdditionsHalalas)}</dd></div>
              <div><dt>الساعات الزائدة المكتشفة</dt><dd>{formatAttendanceHours(entry.detectedExtraHours)}</dd></div>
              <div><dt>احتساب الأوفر تايم</dt><dd>{entry.overtimeEnabled ? "مفعل" : "غير مفعل"}</dd></div>
              <div><dt>قيمة الأوفر تايم</dt><dd>{formatSetupMoney(entry, entry.overtimeValueHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("addition")}><FiPlus />إضافة استحقاق</button>
          </section>

          <section>
            <h3>الخصومات</h3>
            <dl>
              <div><dt>خصم حضور هذا الشهر</dt><dd>{formatAttendanceDeduction(entry)}</dd></div>
              <div><dt>خصم حضور الشهر السابق</dt><dd>{formatPreviousAttendanceDeduction(entry)}</dd></div>
              <div><dt>السلف</dt><dd>{formatPayrollMoney(entry.advancesHalalas)}</dd></div>
              <div><dt>خصومات يدوية وجزاءات</dt><dd>{formatPayrollMoney(entry.manualDeductionsHalalas)}</dd></div>
              <div><dt>إجمالي الخصومات</dt><dd>{formatSetupMoney(entry, entry.totalDeductionsHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("deduction")}><FiPlus />إضافة خصم</button>
          </section>
        </div>

        <section className="payroll-net-panel">
          <div><span>إجمالي الراتب</span><strong>{formatSetupMoney(entry, entry.grossSalaryHalalas)}</strong></div>
          <div><span>إجمالي الإضافات</span><strong>{formatPayrollMoney(entry.totalAdditionsHalalas)}</strong></div>
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

        <section className="payroll-adjustment-list">
          <h3>البنود اليدوية</h3>
          {[...entry.additions, ...entry.deductions].length ? (
            [...entry.additions, ...entry.deductions].map((item) => (
              <article key={item.id}>
                <strong>{itemKindLabel(item.kind)}</strong>
                <span>{formatPayrollMoney(item.amountHalalas)}</span>
                <small>{item.reason}{item.note ? ` · ${item.note}` : ""}</small>
              </article>
            ))
          ) : (
            <p>لا توجد بنود يدوية.</p>
          )}
        </section>

        <section className="payroll-audit-list">
          <h3>سجل مختصر</h3>
          {(entry.auditLog || []).length ? (
            entry.auditLog!.map((item, index) => (
              <span key={`${item.action || "event"}:${index}`}>{String(item.action || "event")} · {String(item.at || "")}</span>
            ))
          ) : (
            <span>تم الإنشاء كمسودة</span>
          )}
        </section>
      </aside>
    </div>
  );
}
