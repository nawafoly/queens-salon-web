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
  FiUnlock,
  FiX,
} from "react-icons/fi";
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
  exportPayrollPayslipPdf,
  exportPayrollReportExcel,
  exportPayrollReportPdf,
  isPayrollExportEligible,
  payrollExportExclusionReason,
} from "../helpers/reports/exportPayrollReport";
import "../styles/DashboardPayroll.css";

type AdjustmentMode = "addition" | "deduction";

type AdjustmentDraft = {
  mode: AdjustmentMode;
  entry: PayrollEntryView;
  kind: PayrollManualItemKind;
  amount: string;
  reason: string;
  note: string;
};

const UNDEFINED_VALUE_LABEL = "ط؛ظٹط± ظ…ط­ط¯ط¯";

const STATUS_LABELS: Record<string, string> = {
  all: "ظƒظ„ ط§ظ„ط­ط§ظ„ط§طھ",
  draft: "ظ…ط³ظˆط¯ط©",
  reviewed: "طھظ…طھ ط§ظ„ظ…ط±ط§ط¬ط¹ط©",
  approved: "ظ…ط¹طھظ…ط¯",
  paid: "ظ…ط¯ظپظˆط¹",
};

const SETUP_MISSING_LABELS: Record<PayrollSetupMissingKey, string> = {
  employeeId: "ظ…ط¹ط±ظپ ط§ظ„ظ…ظˆط¸ظپط© ط؛ظٹط± ظ…ط­ط¯ط¯",
  baseSalary: "ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹ ط؛ظٹط± ظ…ط­ط¯ط¯",
  workDays: "ط£ظٹط§ظ… ط§ظ„ط¹ظ…ظ„ ط؛ظٹط± ظ…ط­ط¯ط¯ط©",
  monthlyHours: "ط³ط§ط¹ط§طھ ط§ظ„ظپطھط±ط© ط؛ظٹط± ظ…ط­ط¯ط¯ط©",
  overtimeMultiplier: "ظ…ط¹ط§ظ…ظ„ ط§ظ„ط£ظˆظپط± طھط§ظٹظ… ط؛ظٹط± ظ…ط­ط¯ط¯",
};

const ADDITION_KINDS: Array<{ value: PayrollManualItemKind; label: string }> = [
  { value: "bonus", label: "ظ…ظƒط§ظپط£ط©" },
  { value: "allowance", label: "ط¨ط¯ظ„" },
  { value: "commission", label: "ط¹ظ…ظˆظ„ط©" },
  { value: "manual_addition", label: "ط¥ط¶ط§ظپط© ظٹط¯ظˆظٹط©" },
];

const DEDUCTION_KINDS: Array<{ value: PayrollManualItemKind; label: string }> = [
  { value: "advance", label: "ط³ظ„ظپط©" },
  { value: "penalty", label: "ط¬ط²ط§ط،" },
  { value: "manual_deduction", label: "ط®طµظ… ظٹط¯ظˆظٹ" },
  { value: "other_deduction", label: "ط§ط³طھظ‚ط·ط§ط¹ ط¢ط®ط±" },
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
    ? "ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨ ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©"
    : formatPayrollMoney(entry.baseSalaryHalalas);
}

function formatSetupMoney(entry: PayrollEntryView, value: unknown) {
  return entry.payrollSetupComplete ? formatPayrollMoney(value) : UNDEFINED_VALUE_LABEL;
}

function formatMonthlyHours(entry: PayrollEntryView) {
  return entry.monthlyHours > 0 ? formatAttendanceHours(entry.monthlyHours) : "ط³ط§ط¹ط§طھ ط§ظ„ظپطھط±ط© ط؛ظٹط± ظ…ط­ط¯ط¯ط©";
}

function employeePayrollPath(entry: PayrollEntryView) {
  return `/admin/employees/${encodeURIComponent(entry.employeeId)}/payroll#payroll-settings`;
}

function attendanceDeductionBlocked(entry: PayrollEntryView) {
  return entry.attendanceSummary.attendanceDeductionEligible === false;
}

function attendanceDeductionMessage(entry: PayrollEntryView) {
  return entry.attendanceSummary.attendanceDeductionNote || "ظ„ظ… ظٹطھظ… طھط·ط¨ظٹظ‚ ط®طµظ… ط§ظ„ط­ط¶ظˆط± ظ„ط£ظ† ط±ط¨ط· ط§ظ„ط¨طµظ…ط§طھ ط؛ظٹط± ظ…ظƒطھظ…ظ„ ط£ظˆ ط؛ظٹط± ظ…ط¤ظƒط¯.";
}

function attendanceLinkLabel(entry: PayrollEntryView) {
  const status = entry.attendanceSummary.attendanceLinkStatus;
  if (status === "confirmed") {
    return entry.attendanceSummary.incompleteDays > 0 ? "ظ…ط¤ظƒط¯ - ط¨طµظ…ط© ظ†ط§ظ‚طµط©" : "ظ…ط¤ظƒط¯";
  }
  if (status === "not_ready") return "ط؛ظٹط± ط¬ط§ظ‡ط²";
  return "ط؛ظٹط± ظ…ط±ط¨ظˆط·";
}

function formatAttendanceDeduction(entry: PayrollEntryView) {
  if (!entry.payrollSetupComplete) return UNDEFINED_VALUE_LABEL;
  return attendanceDeductionBlocked(entry)
    ? "ظ„ظ… ظٹط·ط¨ظ‚"
    : formatPayrollMoney(entry.missingHoursDeductionHalalas);
}

function hasManualAdjustments(entry: PayrollEntryView) {
  return entry.additions.length > 0 || entry.deductions.length > 0;
}

function payrollActionErrorMessage(error: unknown, fallback: string) {
  const message = String((error as any)?.message || error || "");
  if (message === "payroll_setup_incomplete") {
    return "ظ„ط§ ظٹظ…ظƒظ† ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ط§طھط¨ ظ‚ط¨ظ„ ط¥ظƒظ…ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨.";
  }
  if (message === "payroll_not_approved") {
    return "ظ„ط§ ظٹظ…ظƒظ† طھط³ط¬ظٹظ„ ط§ظ„ط±ط§طھط¨ ظƒظ…ط¯ظپظˆط¹ ظ‚ط¨ظ„ ط§ط¹طھظ…ط§ط¯ظ‡.";
  }
  if (message === "core_payroll:setup_incomplete") {
    return "ظ„ط§ ظٹظ…ظƒظ† ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ط§طھط¨ ظ‚ط¨ظ„ ط¥ظƒظ…ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨.";
  }
  if (message === "core_payroll:not_approved") {
    return "ظ„ط§ ظٹظ…ظƒظ† طھط³ط¬ظٹظ„ ط§ظ„ط±ط§طھط¨ ظƒظ…ط¯ظپظˆط¹ ظ‚ط¨ظ„ ط§ط¹طھظ…ط§ط¯ظ‡.";
  }
  if (message === "payroll_paid_reopen_not_allowed" || message === "core_payroll:paid_reopen_not_allowed") {
    return "ظ„ط§ ظٹظ…ظƒظ† ط¥ط¹ط§ط¯ط© ظپطھط­ ط±ط§طھط¨ ظ…ط¯ظپظˆط¹. ظٹط­طھط§ط¬ ط°ظ„ظƒ ظ…ط³ط§ط± ط¥ظ„ط؛ط§ط، ط¯ظپط¹ ظ…ظ†ظپطµظ„.";
  }
  if (message === "payroll_reopen_reason_required") {
    return "ط³ط¨ط¨ ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨ ظ…ط·ظ„ظˆط¨.";
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
      setMessage(hydratedEntries.length ? "طھظ… طھط­ظ…ظٹظ„ ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨ ط§ظ„ظ…ط­ظپظˆط¸ط©." : "ظ„ط§ طھظˆط¬ط¯ ظ…ط³ظٹط±ط§طھ ظ…ط­ظپظˆط¸ط© ظ„ظ‡ط°ط§ ط§ظ„ط´ظ‡ط± ط¨ط¹ط¯.");
    } catch (loadError: any) {
      setError(String(loadError?.message || "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط¥ط¯ط§ط±ط© ط§ظ„ط±ظˆط§طھط¨."));
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
      ? "ظƒظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ"
      : employees.find((employee) => employee.id === employeeFilter)?.name || employeeFilter;
  const selectedStatusLabel = STATUS_LABELS[statusFilter] || statusFilter;
  const exportableEntries = includeIncompleteExport
    ? visibleEntries
    : visibleEntries.filter(isPayrollExportEligible);
  const exportableCount = exportableEntries.length;
  const payrollCycleLabel = `ظپطھط±ط© ط§ظ„ط§ط­طھط³ط§ط¨: ${payrollBounds.monthStart} ط¥ظ„ظ‰ ${payrollBounds.monthEnd} آ· ط§ظ„طµط±ظپ ط§ظ„ظ…طھظˆظ‚ط¹: ${payrollBounds.payDate}`;
  const payrollPeriodStatus = payrollAccrualPeriodStatus(payrollMonth);
  const payrollPartialLabel = payrollPeriodStatus.isPartial
    ? "ظ…ط³ظٹط±ط© ط¬ط²ط¦ظٹط© ظ…ط­ط³ظˆط¨ط© ط­طھظ‰ " + (payrollPeriodStatus.completedThroughDate || "ظ„ظ… طھط¨ط¯ط£ ط§ظ„ظپطھط±ط©")
    : "ظ…ط³ظٹط±ط© ظ…ظƒطھظ…ظ„ط© / ظ†ظ‡ط§ط¦ظٹط©";

  const payrollReportInput = () => {
    const exportedEntries = exportableEntries;
    const excludedRows = includeIncompleteExport
      ? []
      : visibleEntries
          .filter((entry) => !isPayrollExportEligible(entry))
          .map((entry) => ({
            employeeName: entry.employeeName || entry.employeeId || "ط؛ظٹط± ظ…طھظˆظپط±",
            reason: payrollExportExclusionReason(entry) || "ط؛ظٹط± ظ‚ط§ط¨ظ„ ظ„ظ„طھطµط¯ظٹط±",
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
    exportPayrollReportPdf(payrollReportInput());
  };

  const handleExportPayrollExcel = () => {
    exportPayrollReportExcel(payrollReportInput());
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
          ? `طھظ…طھ ط¥ط¹ط§ط¯ط© ط§ظ„ط­ط³ط§ط¨ ظ„ظ„ظپطھط±ط© ${period.monthStart} ط¥ظ„ظ‰ ${period.monthEnd}.`
          : `طھظ… طھظˆظ„ظٹط¯ ظ…ط³ظٹط±ط© ط§ظ„ط´ظ‡ط± ظ„ظ„ظپطھط±ط© ${period.monthStart} ط¥ظ„ظ‰ ${period.monthEnd} ظƒظ…ط³ظˆط¯ط§طھ ط¬ط§ظ‡ط²ط© ظ„ظ„ط­ظپط¸.`
      );
    } catch (actionError: any) {
      setError(String(actionError?.message || "طھط¹ط°ط± طھظˆظ„ظٹط¯ ظ…ط³ظٹط±ط© ط§ظ„ط±ظˆط§طھط¨."));
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
      setMessage(`طھظ… ط­ظپط¸ ${saved.length} ظ…ط³ظˆط¯ط© ظپظٹ ظ†ط¸ط§ظ… ط§ظ„ط±ظˆط§طھط¨.`);
    } catch (actionError: any) {
      setError(String(actionError?.message || "طھط¹ط°ط± ط­ظپط¸ ظ…ط³ظˆط¯ط§طھ ط§ظ„ط±ظˆط§طھط¨."));
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
      setMessage("طھظ…طھ ط¥ط¹ط§ط¯ط© ط­ط³ط§ط¨ ط§ظ„ط³ط¬ظ„.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "طھط¹ط°ط±طھ ط¥ط¹ط§ط¯ط© ط­ط³ط§ط¨ ط§ظ„ط³ط¬ظ„."));
    } finally {
      setBusy("");
    }
  };

  const handleToggleOvertime = async (entry: PayrollEntryView, checked: boolean) => {
    if (!canManage || isPayrollSnapshotLocked(entry.status)) return;
    if (checked && !entry.payrollSetupComplete) {
      setError("ظ„ط§ ظٹظ…ظƒظ† ط§ط­طھط³ط§ط¨ ط§ظ„ط£ظˆظپط± طھط§ظٹظ… ظ‚ط¨ظ„ ط¥ظƒظ…ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨.");
      return;
    }
    if (checked && entry.detectedExtraHours <= 0) {
      setError("ظ„ط§ طھظˆط¬ط¯ ط³ط§ط¹ط§طھ ط²ط§ط¦ط¯ط© ظ…ظƒطھط´ظپط© ظ„ظ‡ط°ط§ ط§ظ„ط³ط¬ظ„.");
      return;
    }
    const next = rebuildEntry(entry, { overtimeEnabled: checked });
    setEntries((current) => replaceEntry(current, next));
    if (!entry.id) return;
    setBusy(`ot:${entry.id}`);
    try {
      const saved = await togglePayrollOvertime(next);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("طھظ… ط­ظپط¸ ط®ظٹط§ط± ط§ط­طھط³ط§ط¨ ط§ظ„ط³ط§ط¹ط§طھ ط§ظ„ط¥ط¶ط§ظپظٹط© ظ„ظ‡ط°ط§ ط§ظ„ط³ط¬ظ„.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "طھط¹ط°ط± طھط­ط¯ظٹط« ط®ظٹط§ط± ط§ظ„ط³ط§ط¹ط§طھ ط§ظ„ط¥ط¶ط§ظپظٹط©."));
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
      addedBy: "ط§ظ„ط¥ط¯ط§ط±ط©",
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
      setMessage("طھظ…طھ ط¥ط¶ط§ظپط© ط§ظ„ط¨ظ†ط¯ ط§ظ„ظٹط¯ظˆظٹ.");
    } catch (actionError: any) {
      setError(
        actionError?.message === "manual_payroll_item_reason_required"
          ? "ط³ط¨ط¨ ط§ظ„ط¥ط¶ط§ظپط© ط£ظˆ ط§ظ„ط®طµظ… ظ…ط·ظ„ظˆط¨."
          : actionError?.message === "manual_payroll_item_amount_required"
            ? "ط§ظ„ظ…ط¨ظ„ط؛ ظ…ط·ظ„ظˆط¨ ظˆظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ط£ظƒط¨ط± ظ…ظ† طµظپط±."
            : String(actionError?.message || "طھط¹ط°ط± ط­ظپط¸ ط§ظ„ط¨ظ†ط¯ ط§ظ„ظٹط¯ظˆظٹ.")
      );
    } finally {
      setBusy("");
    }
  };

  const handleApprove = async (entry: PayrollEntryView) => {
    if (!canManage || entry.status === "paid") return;
    if (!entry.payrollSetupComplete) {
      setError("ظ„ط§ ظٹظ…ظƒظ† ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ط§طھط¨ ظ‚ط¨ظ„ ط¥ظƒظ…ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨.");
      return;
    }
    const payrollMoney = calculatePayrollAccrualView(entry);
    if (payrollMoney.isPartial) {
      const confirmed = window.confirm(
        "ظ‡ط°ظ‡ ظ…ط³ظٹط±ط© ط¬ط²ط¦ظٹط© ظ…ط­ط³ظˆط¨ط© ط­طھظ‰ " +
          (payrollMoney.completedThroughDate || "ظ„ظ… طھط¨ط¯ط£ ط§ظ„ظپطھط±ط©") +
          "\n\nط§ظ„ظ…ط³طھط­ظ‚ ط­طھظ‰ ط§ظ„ظٹظˆظ…: " +
          formatPayrollMoney(payrollMoney.earnedToDateHalalas) +
          "\nط§ظ„طµط§ظپظٹ ط§ظ„ظ…طھظˆظ‚ط¹ ظ†ظ‡ط§ظٹط© ط§ظ„ظپطھط±ط©: " +
          formatPayrollMoney(payrollMoney.expectedNetHalalas) +
          "\n\nظ‡ظ„ طھط±ظٹط¯ ط§ط¹طھظ…ط§ط¯ظ‡ط§ ط±ط؛ظ… ط£ظ†ظ‡ط§ ظ‚ط¨ظ„ ظ†ظ‡ط§ظٹط© ط§ظ„ظپطھط±ط©طں"
      );
      if (!confirmed) return;
    }
    setBusy(`approve:${entry.employeeId}`);
    try {
      const saved = await approvePayrollEntry(entry);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("طھظ… ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ط§طھط¨.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "طھط¹ط°ط± ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ط§طھط¨."));
    } finally {
      setBusy("");
    }
  };

  const handlePaid = async (entry: PayrollEntryView) => {
    if (!canManage) return;
    if (!entry.payrollSetupComplete) {
      setError("ظ„ط§ ظٹظ…ظƒظ† طھط³ط¬ظٹظ„ ط§ظ„ط±ط§طھط¨ ظƒظ…ط¯ظپظˆط¹ ظ‚ط¨ظ„ ط¥ظƒظ…ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨.");
      return;
    }
    if (entry.status !== "approved") {
      setError("ظ„ط§ ظٹظ…ظƒظ† طھط³ط¬ظٹظ„ ط§ظ„ط±ط§طھط¨ ظƒظ…ط¯ظپظˆط¹ ظ‚ط¨ظ„ ط§ط¹طھظ…ط§ط¯ظ‡.");
      return;
    }
    setBusy(`paid:${entry.employeeId}`);
    try {
      const saved = await markPayrollEntryPaid(entry);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط±ط§طھط¨ ظƒظ…ط¯ظپظˆط¹.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "طھط¹ط°ط± طھط³ط¬ظٹظ„ ط§ظ„ط¯ظپط¹."));
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
      "ط³ظٹطھظ… ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨ ط§ظ„ظ…ط¹طھظ…ط¯ ظˆطھط­ظˆظٹظ„ظ‡ ط¥ظ„ظ‰ ظ…ط³ظˆط¯ط© ط­طھظ‰ ظٹظ…ظƒظ† ط¥ط¹ط§ط¯ط© ط§ظ„ط­ط³ط§ط¨. ظ„ظ† ظٹطھظ… طھط¹ط¯ظٹظ„ ط§ظ„ط±ط§طھط¨ طھظ„ظ‚ط§ط¦ظٹظ‹ط§ ط­طھظ‰ طھط¶ط؛ط· ط¥ط¹ط§ط¯ط© ط§ظ„ط­ط³ط§ط¨ ط¨ط¹ط¯ ط§ظ„ظپطھط­. ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط©طں"
    );
    if (!confirmed) return;
    const reason = window.prompt("ط§ظƒطھط¨ ط³ط¨ط¨ ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨", "ط¥ط¹ط§ط¯ط© ط§ط­طھط³ط§ط¨ ط§ظ„ط­ط¶ظˆط± ط¨ط¹ط¯ طھط­ط¯ظٹط« ط³ظٹط§ط³ط© ط§ظ„ط؛ظٹط§ط¨");
    if (!reason?.trim()) {
      setError("ط³ط¨ط¨ ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨ ظ…ط·ظ„ظˆط¨.");
      return;
    }
    setBusy(`reopen:${entry.employeeId}`);
    try {
      const saved = await reopenPayrollEntry(entry, { reason: reason.trim(), status: "draft" });
      setEntries((current) => replaceEntry(current, saved));
      setSelectedEntry((current) => (current?.employeeId === saved.employeeId ? saved : current));
      setMessage("طھظ…طھ ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨. ظٹظ…ظƒظ†ظƒ ط§ظ„ط¢ظ† ط¥ط¹ط§ط¯ط© ط§ظ„ط­ط³ط§ط¨ ط«ظ… ط§ظ„ط§ط¹طھظ…ط§ط¯ ظ…ظ† ط¬ط¯ظٹط¯.");
    } catch (actionError: any) {
      setError(payrollActionErrorMessage(actionError, "طھط¹ط°ط±طھ ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="payroll-page" dir="rtl">
      <header className="payroll-hero">
        <div>
          <span>ظ†ط¸ط§ظ… ط§ظ„ط±ظˆط§طھط¨</span>
          <h1>ط¥ط¯ط§ط±ط© ط§ظ„ط±ظˆط§طھط¨</h1>
          <p>ط¥ظ†ط´ط§ط، ظˆظ…ط±ط§ط¬ط¹ط© ظˆط§ط¹طھظ…ط§ط¯ ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨ ط§ظ„ط´ظ‡ط±ظٹط© ظ„ظ„ظ…ظˆط¸ظپط§طھ.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          طھط­ط¯ظٹط«
        </button>
      </header>

      <div className="payroll-toolbar">
        <label>
          <span>ط§ظ„ط´ظ‡ط±</span>
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>ط§ظ„ط³ظ†ط©</span>
          <input type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} />
        </label>
        <label>
          <span>ط§ظ„ظ…ظˆط¸ظپط©</span>
          <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
            <option value="all">ظƒظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>ط­ط§ظ„ط© ط§ظ„ط±ط§طھط¨</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="payroll-toolbar__actions">
          <button type="button" onClick={() => void handleGenerate(false)} disabled={!canManage || Boolean(busy)}>
            <FiSliders /> طھظˆظ„ظٹط¯ ظ…ط³ظٹط±ط© ط§ظ„ط´ظ‡ط±
          </button>
          <button type="button" onClick={() => void handleGenerate(true)} disabled={!canManage || Boolean(busy)}>
            <FiRefreshCw /> ط¥ط¹ط§ط¯ط© ط­ط³ط§ط¨
          </button>
          <button type="button" className="is-primary" onClick={() => void handleSaveDrafts()} disabled={!canManage || Boolean(busy)}>
            <FiSave /> ط­ظپط¸ ط§ظ„ظ…ط³ظˆط¯ط§طھ
          </button>
          <button type="button" onClick={handleExportPayrollPdf} disabled={loading}>
            <FiFileText /> طھطµط¯ظٹط± ظ…ط³ظٹط±ط© ط§ظ„ط´ظ‡ط± PDF
          </button>
          <button type="button" onClick={handleExportPayrollExcel} disabled={loading}>
            <FiDownload /> طھطµط¯ظٹط± ظ…ط³ظٹط±ط© ط§ظ„ط´ظ‡ط± Excel
          </button>
          <span className="payroll-export-count">ط³ظٹطµط¯ظ‘ط± {exportableCount} ظ…ظ† {visibleEntries.length}</span>
          <label className="payroll-export-option">
            <input
              type="checkbox"
              checked={includeIncompleteExport}
              onChange={(event) => setIncludeIncompleteExport(event.target.checked)}
            />
            <span>طھط¶ظ…ظٹظ† ط؛ظٹط± ط§ظ„ظ…ظƒطھظ…ظ„ ظپظٹ ط§ظ„طھطµط¯ظٹط±</span>
          </label>
        </div>
      </div>

      <div className="payroll-period-banner">
        <FiClock />
        <span>{payrollCycleLabel}</span>
        <strong>{payrollPartialLabel}</strong>
      </div>

      {error ? <div className="payroll-alert is-error">{error}</div> : null}
      {message ? <div className="payroll-alert"><FiCheckCircle />{message}</div> : null}
      {!canManage ? <div className="payroll-alert is-readonly">ظˆط¶ط¹ ظ‚ط±ط§ط،ط© ظپظ‚ط·: ظٹظ…ظƒظ†ظƒ ظ…ط±ط§ط¬ط¹ط© ط§ظ„ط±ظˆط§طھط¨ ط¯ظˆظ† طھط¹ط¯ظٹظ„ظ‡ط§.</div> : null}

      <div className="payroll-summary-grid">
        <article><span><FiShield /></span><small>ط¹ط¯ط¯ ط§ظ„ظ…ظˆط¸ظپط§طھ</small><strong>{summary.count}</strong></article>
        <article><span><FiCheckCircle /></span><small>ط¥ط¹ط¯ط§ط¯ط§طھ ظ…ظƒطھظ…ظ„ط©</small><strong>{summary.complete}</strong></article>
        <article><span><FiAlertTriangle /></span><small>ط¥ط¹ط¯ط§ط¯ط§طھ ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©</small><strong>{summary.incomplete}</strong></article>
        <article><span><FiDollarSign /></span><small>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط±ظˆط§طھط¨ ط§ظ„ظ…ظƒطھظ…ظ„ط©</small><strong>{formatPayrollMoney(summary.base)}</strong></article>
        <article><span><FiPlus /></span><small>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ط¶ط§ظپط§طھ</small><strong>{formatPayrollMoney(summary.additions)}</strong></article>
        <article><span><FiX /></span><small>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط®طµظˆظ…ط§طھ</small><strong>{formatPayrollMoney(summary.deductions)}</strong></article>
        <article><span><FiDollarSign /></span><small>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³طھط­ظ‚ ط­طھظ‰ ط§ظ„ظٹظˆظ…</small><strong>{formatPayrollMoney(summary.earned)}</strong></article>
        <article><span><FiDollarSign /></span><small>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طµط§ظپظٹ ط§ظ„ظ…طھظˆظ‚ط¹</small><strong>{formatPayrollMoney(summary.net)}</strong></article>
        <article><span><FiClock /></span><small>ط¹ط¯ط¯ ط§ظ„ظ…ط³ظˆط¯ط§طھ</small><strong>{summary.drafts}</strong></article>
        <article><span><FiCheckCircle /></span><small>ط¹ط¯ط¯ ط§ظ„ط±ظˆط§طھط¨ ط§ظ„ظ…ط¹طھظ…ط¯ط©</small><strong>{summary.approved}</strong></article>
        <article><span><FiDollarSign /></span><small>ط¹ط¯ط¯ ط§ظ„ط±ظˆط§طھط¨ ط§ظ„ظ…ط¯ظپظˆط¹ط©</small><strong>{summary.paid}</strong></article>
      </div>

      {summary.incomplete > 0 ? (
        <div className="payroll-alert is-warning payroll-setup-warning" role="status">
          <FiAlertTriangle />
          <div>
            <strong>ظ„ظ† ظٹطھظ… ط§ط­طھط³ط§ط¨ ط§ظ„ط±ط§طھط¨ ط­طھظ‰ ظٹطھظ… ط¥ظƒظ…ط§ظ„ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط±ط§طھط¨ ظ…ظ† ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط©.</strong>
            <small>ط§ظ„ط­ظ‚ظˆظ„ ط§ظ„ظ…ط·ظ„ظˆط¨ط©: ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹطŒ ط£ظٹط§ظ… ط§ظ„ط¹ظ…ظ„طŒ ظˆط³ط§ط¹ط§طھ ط§ظ„ط´ظ‡ط±.</small>
          </div>
        </div>
      ) : null}

      <div className="payroll-table-wrap">
        <table className="payroll-table">
          <thead>
            <tr>
              <th>ط§ظ„ظ…ظˆط¸ظپط©</th>
              <th>ط­ط§ظ„ط© ط¥ط¹ط¯ط§ط¯ ط§ظ„ط±ط§طھط¨</th>
              <th>ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹ</th>
              <th>ظ…ظ„ط®طµ ط§ظ„ط­ط¶ظˆط±</th>
              <th>ط§ظ„ط³ط§ط¹ط§طھ ط§ظ„ط²ط§ط¦ط¯ط©</th>
              <th>ط§ط­طھط³ط§ط¨ ط§ظ„ط£ظˆظپط± طھط§ظٹظ…</th>
              <th>ط§ظ„ط¥ط¶ط§ظپط§طھ</th>
              <th>ط§ظ„ط®طµظˆظ…ط§طھ</th>
              <th>ط§ظ„ظ…ط³طھط­ظ‚ / ط§ظ„ظ…طھظˆظ‚ط¹</th>
              <th>ط§ظ„ط­ط§ظ„ط©</th>
              <th>ط§ظ„ط¥ط¬ط±ط§ط،ط§طھ</th>
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
                        {exportEligible ? "ط¯ط§ط®ظ„ ط§ظ„طھطµط¯ظٹط± ط§ظ„ط±ط³ظ…ظٹ" : "ظ…ط³طھط¨ط¹ط¯ ظ…ظ† ط§ظ„طھطµط¯ظٹط±"}
                      </span>
                      {attendanceBlocked ? (
                        <span className="payroll-mini-badge is-attendance-warning">ط§ظ„ط­ط¶ظˆط± ط؛ظٹط± ظ…ط±ط¨ظˆط·</span>
                      ) : null}
                      {manualAdjustments ? (
                        <span className="payroll-mini-badge is-manual">ط¨ظ†ظˆط¯ ظٹط¯ظˆظٹط©</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="payroll-setup-cell">
                    <span className={`payroll-setup-badge ${entry.payrollSetupComplete ? "is-complete" : "is-incomplete"}`}>
                      {entry.payrollSetupComplete ? "ظ…ظƒطھظ…ظ„" : "ط؛ظٹط± ظ…ظƒطھظ…ظ„"}
                    </span>
                    {!entry.payrollSetupComplete ? (
                      <small>{missingLabels.join("طŒ ")}</small>
                    ) : null}
                  </td>
                  <td>
                    <strong>{formatBaseSalary(entry)}</strong>
                    {!entry.payrollSetupComplete ? (
                      <small>
                        <a href={employeePayrollPath(entry)}>ط¥ط¹ط¯ط§ط¯ ط§ظ„ط±ط§طھط¨</a>
                      </small>
                    ) : null}
                  </td>
                  <td className="payroll-attendance-cell">
                    <span className={`payroll-mini-badge ${attendanceBlocked ? "is-attendance-warning" : "is-exported"}`}>
                      {attendanceLinkLabel(entry)}
                    </span>
                    <div className="payroll-attendance-metrics">
                      <span>ط­ط¶ظˆط± {entry.attendanceSummary.attendanceDays}</span>
                      <span>ط؛ظٹط§ط¨ {entry.attendanceSummary.absentDays}</span>
                      <span>ظ†ط§ظ‚طµط© {entry.attendanceSummary.incompleteDays}</span>
                      <span>ظ…ط·ظ„ظˆط¨ {formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)}</span>
                      <span>ظپط¹ظ„ظٹ {formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)}</span>
                      <span>طھط£ط®ظٹط± {formatAttendanceHours(entry.attendanceSummary.totalLateHours)}</span>
                      <span>ط§ظ†طµط±ط§ظپ {formatAttendanceHours(entry.attendanceSummary.totalEarlyLeaveHours || 0)}</span>
                      <span>ظ†ظ‚طµ {formatAttendanceHours(entry.attendanceSummary.totalMissingHours)}</span>
                    </div>
                    {attendanceBlocked ? <small className="payroll-attendance-note">ظ…ط¹ظ„ظˆظ…ط© ظپظ‚ط·طŒ ط¨ط¯ظˆظ† ط®طµظ… طھظ„ظ‚ط§ط¦ظٹ</small> : null}
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
                    <small>{entry.overtimeEnabled ? "ظ…ط­طھط³ط¨" : "ط؛ظٹط± ظ…ط­طھط³ط¨"}</small>
                  </td>
                  <td>{formatPayrollMoney(entry.totalAdditionsHalalas)}</td>
                  <td>
                    <strong>{formatPayrollMoney(entry.totalDeductionsHalalas)}</strong>
                    {attendanceBlocked ? <small className="payroll-attendance-note">ط®طµظ… ط§ظ„ط­ط¶ظˆط±: ظ„ظ… ظٹط·ط¨ظ‚</small> : null}
                  </td>
                  <td className="payroll-net-cell">
                    <strong>{formatSetupMoney(entry, payrollMoney.earnedToDateHalalas)}</strong>
                    {entry.payrollSetupComplete && payrollMoney.isPartial ? (
                      <>
                        <small>ط§ظ„ظ…طھظˆظ‚ط¹ ظ†ظ‡ط§ظٹط© ط§ظ„ظپطھط±ط©: {formatPayrollMoney(payrollMoney.expectedNetHalalas)}</small>
                        <small>ط­طھظ‰ {payrollMoney.completedThroughDate || "ظ„ظ… طھط¨ط¯ط£ ط§ظ„ظپطھط±ط©"}</small>
                      </>
                    ) : null}
                  </td>
                  <td><span className={`payroll-status ${statusClass(entry.status)}`}>{STATUS_LABELS[entry.status] || entry.status}</span></td>
                  <td>
                    <div className="payroll-row-actions">
                      <button type="button" onClick={() => setSelectedEntry(entry)}><FiEye />ط¹ط±ط¶</button>
                      <button type="button" disabled={!actions.canRecalculate} onClick={() => void handleRecalculateEntry(entry)}>ط¥ط¹ط§ط¯ط© ط§ظ„ط­ط³ط§ط¨</button>
                      <button type="button" disabled={!actions.canEditAdjustments} onClick={() => openAdjustment(entry, "deduction")}>ط¥ط¶ط§ظپط© ط®طµظ…</button>
                      <button type="button" disabled={!actions.canEditAdjustments} onClick={() => openAdjustment(entry, "addition")}>ط¥ط¶ط§ظپط© ط¥ط¶ط§ظپط©</button>
                      {!entry.payrollSetupComplete ? (
                        <span className="payroll-action-help">
                          <a className="payroll-action-link" href={employeePayrollPath(entry)}><FiEdit3 />ظپطھط­ ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط©</a>
                          <small>ظ„ط¥ظƒظ…ط§ظ„ ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹطŒ ط£ظٹط§ظ… ط§ظ„ط¹ظ…ظ„طŒ ظˆط³ط§ط¹ط§طھ ط§ظ„ط´ظ‡ط±</small>
                        </span>
                      ) : null}
                      {actions.showApprove ? (
                        <button type="button" disabled={!actions.canApprove} onClick={() => void handleApprove(entry)}>ط§ط¹طھظ…ط§ط¯</button>
                      ) : null}
                      {actions.showMarkPaid ? (
                        <button type="button" disabled={!actions.canMarkPaid} onClick={() => void handlePaid(entry)}>طھط³ط¬ظٹظ„ ظƒظ…ط¯ظپظˆط¹</button>
                      ) : null}
                      {actions.showReopen ? (
                        <button type="button" disabled={!actions.canReopen || busy === `reopen:${entry.employeeId}`} onClick={() => void handleReopen(entry)}><FiUnlock />ط¥ط¹ط§ط¯ط© ظپطھط­ ط§ظ„ط±ط§طھط¨</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !visibleEntries.length ? <p className="payroll-empty">ظ„ط§ طھظˆط¬ط¯ ط±ظˆط§طھط¨ ظ…ط·ط§ط¨ظ‚ط©. ط§ط³طھط®ط¯ظ… ط²ط± طھظˆظ„ظٹط¯ ظ…ط³ظٹط±ط© ط§ظ„ط´ظ‡ط± ظ„ط¥ظ†ط´ط§ط، ظ…ط³ظˆط¯ط§طھ.</p> : null}
      </div>

      {selectedEntry ? (
        <PayrollDetailsModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onAdd={(mode) => openAdjustment(selectedEntry, mode)}
          onExportPayslip={() => exportPayrollPayslipPdf({ entry: selectedEntry })}
          payrollBounds={payrollBounds}
        />
      ) : null}

      {adjustment ? (
        <div className="payroll-modal-backdrop" role="presentation" onMouseDown={() => setAdjustment(null)}>
          <aside className="payroll-modal payroll-adjustment-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>{adjustment.mode === "addition" ? "ط¥ط¶ط§ظپط© ط§ط³طھط­ظ‚ط§ظ‚" : "ط¥ط¶ط§ظپط© ط®طµظ…"}</span>
                <h2>{adjustment.entry.employeeName}</h2>
              </div>
              <button type="button" onClick={() => setAdjustment(null)}><FiX /></button>
            </header>
            <label>
              <span>ط§ظ„ظ†ظˆط¹</span>
              <select value={adjustment.kind} onChange={(event) => setAdjustment({ ...adjustment, kind: event.target.value as PayrollManualItemKind })}>
                {(adjustment.mode === "addition" ? ADDITION_KINDS : DEDUCTION_KINDS).map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>ط§ظ„ظ…ط¨ظ„ط؛</span>
              <input type="number" min="0" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} />
            </label>
            <label>
              <span>ط§ظ„ط³ط¨ط¨</span>
              <input value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} />
            </label>
            <label>
              <span>ظ…ظ„ط§ط­ط¸ط© ط§ط®طھظٹط§ط±ظٹط©</span>
              <textarea value={adjustment.note} onChange={(event) => setAdjustment({ ...adjustment, note: event.target.value })} />
            </label>
            <footer>
              <button type="button" onClick={() => setAdjustment(null)}>ط¥ظ„ط؛ط§ط،</button>
              <button type="button" className="is-primary" disabled={busy === "adjustment"} onClick={() => void submitAdjustment()}>ط­ظپط¸ ط§ظ„ط¨ظ†ط¯</button>
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
            <p>{entry.jobTitle || "ظ…ظˆط¸ظپط©"} آ· {STATUS_LABELS[entry.status] || entry.status}</p>
          </div>
          <div className="payroll-modal-actions">
            <button type="button" onClick={onExportPayslip}><FiFileText /> طھطµط¯ظٹط± ظƒط´ظپ ط±ط§طھط¨ PDF</button>
            <button type="button" onClick={onClose} aria-label="ط¥ط؛ظ„ط§ظ‚"><FiX /></button>
          </div>
        </header>

        {!entry.payrollSetupComplete ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>ظ„ط§ ظٹظ…ظƒظ† ط§ط¹طھظ…ط§ط¯ ظ‡ط°ط§ ط§ظ„ط±ط§طھط¨ ظ„ط£ظ† ط¨ظٹط§ظ†ط§طھ ط§ظ„ط±ط§طھط¨ ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©.</strong>
              <small>{missingLabels.join("طŒ ")}</small>
            </div>
          </div>
        ) : null}

        {entry.payrollSetupComplete && payrollMoney.isPartial ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>ظ‡ط°ظ‡ ظ…ط³ظٹط±ط© ط¬ط²ط¦ظٹط© ظˆظ„ظٹط³طھ ط±ط§طھط¨ظ‹ط§ ظ†ظ‡ط§ط¦ظٹظ‹ط§.</strong>
              <small>
                ظ…ط­ط³ظˆط¨ط© ط­طھظ‰ {payrollMoney.completedThroughDate || "ظ„ظ… طھط¨ط¯ط£ ط§ظ„ظپطھط±ط©"} ظ…ظ† ظپطھط±ط© {payrollBounds.monthStart} ط¥ظ„ظ‰ {payrollBounds.monthEnd}.
              </small>
            </div>
          </div>
        ) : null}

        {attendanceDeductionBlocked(entry) ? (
          <div className="payroll-alert is-warning">
            <FiAlertTriangle />
            <div>
              <strong>{attendanceDeductionMessage(entry)}</strong>
              <small>ظ†ظ‚طµ ط§ظ„ط³ط§ط¹ط§طھ ط¸ط§ظ‡ط± ظ„ظ„ظ…ط±ط§ط¬ط¹ط© ظپظ‚ط· ظˆظ„ظ† ظٹطھط­ظˆظ„ ط¥ظ„ظ‰ ط®طµظ… ظ…ط§ظ„ظٹ طھظ„ظ‚ط§ط¦ظٹ.</small>
            </div>
          </div>
        ) : null}

        <div className="payroll-detail-grid">
          <section>
            <h3>ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط±ط§طھط¨</h3>
            <dl>
              <div><dt>ط­ط§ظ„ط© ط§ظ„ط¥ط¹ط¯ط§ط¯</dt><dd>{entry.payrollSetupComplete ? "ظ…ظƒطھظ…ظ„" : "ط؛ظٹط± ظ…ظƒطھظ…ظ„"}</dd></div>
              <div><dt>ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹ</dt><dd>{formatBaseSalary(entry)}</dd></div>
              <div><dt>ط¹ط¯ط¯ ط£ظٹط§ظ… ط§ظ„ط¹ظ…ظ„</dt><dd>{setupMissing(entry, "workDays") ? UNDEFINED_VALUE_LABEL : entry.workDays}</dd></div>
              <div><dt>ط³ط§ط¹ط§طھ ط§ظ„ظپطھط±ط©</dt><dd>{formatMonthlyHours(entry)}</dd></div>
              <div><dt>ط³ط§ط¹ط§طھ ط§ظ„ظٹظˆظ… ط§ظ„ظ…ط¹طھظ…ط¯ط©</dt><dd>{entry.dailyScheduledHours > 0 ? formatAttendanceHours(entry.dailyScheduledHours) : UNDEFINED_VALUE_LABEL}</dd></div>
              <div><dt>ط±ط§طھط¨ ط§ظ„ظٹظˆظ…</dt><dd>{formatSetupMoney(entry, entry.dailyRateHalalas)}</dd></div>
              <div><dt>ط±ط§طھط¨ ط§ظ„ط³ط§ط¹ط©</dt><dd>{formatSetupMoney(entry, entry.hourlyRateHalalas)}</dd></div>
              <div><dt>ظ…ط¹ط§ظ…ظ„ ط§ظ„ط£ظˆظپط± طھط§ظٹظ…</dt><dd>{entry.overtimeMultiplier}</dd></div>
              <div><dt>ظ…طµط¯ط± ط§ظ„ط³ط§ط¹ط§طھ</dt><dd>{entry.monthlyHoursSource === "configured_monthly_hours" ? "ط³ط§ط¹ط§طھ ط´ظ‡ط± ظ…ط­ط¯ط¯ط©" : entry.monthlyHoursSource === "configured_daily_hours" ? "ط¯ظˆط§ظ… ظٹظˆظ…ظٹ ظ…ط¹طھظ…ط¯" : entry.monthlyHoursSource === "saved_snapshot" ? "Snapshot ظ…ط­ظپظˆط¸" : "ط؛ظٹط± ظ…ط­ط¯ط¯"}</dd></div>
            </dl>
            {!entry.payrollSetupComplete ? (
              <a className="payroll-action-link payroll-action-link--inline" href={employeePayrollPath(entry)}><FiEdit3 />ظپطھط­ ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط©</a>
            ) : null}
          </section>

          <section>
            <h3>ظ…ظ„ط®طµ ط§ظ„ط­ط¶ظˆط±</h3>
            <dl>
              <div><dt>ط£ظٹط§ظ… ط§ظ„ط­ط¶ظˆط±</dt><dd>{entry.attendanceSummary.attendanceDays}</dd></div>
              <div><dt>ط­ط§ظ„ط© ط±ط¨ط· ط§ظ„ط­ط¶ظˆط±</dt><dd>{attendanceLinkLabel(entry)}</dd></div>
              <div><dt>ط¹ط¯ط¯ ط§ظ„ط¨طµظ…ط§طھ ط§ظ„ظ…ط±طھط¨ط·ط©</dt><dd>{entry.attendanceSummary.attendanceRecordCount || 0}</dd></div>
              <div><dt>ط£ظٹط§ظ… ط§ظ„ط؛ظٹط§ط¨</dt><dd>{entry.attendanceSummary.absentDays}</dd></div>
              <div><dt>ط£ظٹط§ظ… ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ظ…ط¹طھظ…ط¯ط©</dt><dd>{entry.attendanceSummary.approvedLeaveDays || 0}</dd></div>
              <div><dt>ط£ظٹط§ظ… ط§ظ„ط؛ظٹط§ط¨/ط§ظ„ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ط¹طھظ…ط¯</dt><dd>{entry.attendanceSummary.approvedAbsenceDays || 0}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط³ط§ط¹ط§طھ ط§ظ„ط¯ظˆط§ظ… ط§ظ„ظ…ط·ظ„ظˆط¨ط©</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط³ط§ط¹ط§طھ ط§ظ„ط¹ظ…ظ„ ط§ظ„ظپط¹ظ„ظٹط©</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طھط£ط®ظٹط± ط§ظ„ظپط¹ظ„ظٹ</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalLateHours)}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط§ظ†طµط±ط§ظپ ط§ظ„ظ…ط¨ظƒط±</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalEarlyLeaveHours || 0)}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„طھط¹ظˆظٹط¶ ط¨ط¹ط¯ ط§ظ„ط¯ظˆط§ظ…</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalCompensatedLateHours)}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ظ†ظ‚طµ ط§ظ„ط³ط§ط¹ط§طھ</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalMissingHours)}</dd></div>
              <div><dt>ط£ظٹط§ظ… ظ†ط§ظ‚طµط© ط§ظ„ط¨طµظ…ط©</dt><dd>{entry.attendanceSummary.incompleteDays}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط³ط§ط¹ط§طھ ط§ظ„ط²ط§ط¦ط¯ط© ط§ظ„ظ…ظƒطھط´ظپط©</dt><dd>{formatAttendanceHours(entry.detectedExtraHours)}</dd></div>
            </dl>
          </section>

          {(entry.attendanceSummary.attendanceNotes || []).length ? (
            <section>
              <h3>ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ط­ط¶ظˆط±</h3>
              <div className="payroll-attendance-note-list">
                {entry.attendanceSummary.attendanceNotes!.map((note, index) => (
                  <span key={`${note}:${index}`}>{note}</span>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3>ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ط§طھ</h3>
            <dl>
              <div><dt>ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹ</dt><dd>{formatBaseSalary(entry)}</dd></div>
              <div><dt>ط§ظ„ط¨ط¯ظ„ط§طھ</dt><dd>{formatPayrollMoney(entry.allowancesHalalas)}</dd></div>
              <div><dt>ط§ظ„ظ…ظƒط§ظپط¢طھ ظˆط§ظ„ط¥ط¶ط§ظپط§طھ</dt><dd>{formatPayrollMoney(entry.manualAdditionsHalalas)}</dd></div>
              <div><dt>ط§ظ„ط³ط§ط¹ط§طھ ط§ظ„ط²ط§ط¦ط¯ط© ط§ظ„ظ…ظƒطھط´ظپط©</dt><dd>{formatAttendanceHours(entry.detectedExtraHours)}</dd></div>
              <div><dt>ط§ط­طھط³ط§ط¨ ط§ظ„ط£ظˆظپط± طھط§ظٹظ…</dt><dd>{entry.overtimeEnabled ? "ظ…ظپط¹ظ„" : "ط؛ظٹط± ظ…ظپط¹ظ„"}</dd></div>
              <div><dt>ظ‚ظٹظ…ط© ط§ظ„ط£ظˆظپط± طھط§ظٹظ…</dt><dd>{formatSetupMoney(entry, entry.overtimeValueHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("addition")}><FiPlus />ط¥ط¶ط§ظپط© ط§ط³طھط­ظ‚ط§ظ‚</button>
          </section>

          <section>
            <h3>ط§ظ„ط®طµظˆظ…ط§طھ</h3>
            <dl>
              <div><dt>ط®طµظ… ط§ظ„ط­ط¶ظˆط±</dt><dd>{formatAttendanceDeduction(entry)}</dd></div>
              <div><dt>ط§ظ„ط³ظ„ظپ</dt><dd>{formatPayrollMoney(entry.advancesHalalas)}</dd></div>
              <div><dt>ط®طµظˆظ…ط§طھ ظٹط¯ظˆظٹط© ظˆط¬ط²ط§ط،ط§طھ</dt><dd>{formatPayrollMoney(entry.manualDeductionsHalalas)}</dd></div>
              <div><dt>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط®طµظˆظ…ط§طھ</dt><dd>{formatSetupMoney(entry, entry.totalDeductionsHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("deduction")}><FiPlus />ط¥ط¶ط§ظپط© ط®طµظ…</button>
          </section>
        </div>

        <section className="payroll-net-panel">
          <div><span>إجمالي الراتب</span><strong>{formatSetupMoney(entry, entry.grossSalaryHalalas)}</strong></div>
          <div><span>إجمالي الإضافات</span><strong>{formatPayrollMoney(entry.totalAdditionsHalalas)}</strong></div>
          <div><span>إجمالي الخصومات</span><strong>{formatSetupMoney(entry, entry.totalDeductionsHalalas)}</strong></div>
          <div className="is-net">
            <span>{payrollMoney.isPartial ? "ط§ظ„ظ…ط³طھط­ظ‚ ط­طھظ‰ ط§ظ„ظٹظˆظ…" : "طµط§ظپظٹ ط§ظ„ط±ط§طھط¨ ط§ظ„ظ†ظ‡ط§ط¦ظٹ"}</span>
            <strong>{formatSetupMoney(entry, payrollMoney.earnedToDateHalalas)}</strong>
          </div>
          {payrollMoney.isPartial ? (
            <div>
              <span>ط§ظ„طµط§ظپظٹ ط§ظ„ظ…طھظˆظ‚ط¹ ظ†ظ‡ط§ظٹط© ط§ظ„ظپطھط±ط©</span>
              <strong>{formatSetupMoney(entry, payrollMoney.expectedNetHalalas)}</strong>
            </div>
          ) : null}
        </section>

        <section className="payroll-adjustment-list">
          <h3>ط§ظ„ط¨ظ†ظˆط¯ ط§ظ„ظٹط¯ظˆظٹط©</h3>
          {[...entry.additions, ...entry.deductions].length ? (
            [...entry.additions, ...entry.deductions].map((item) => (
              <article key={item.id}>
                <strong>{itemKindLabel(item.kind)}</strong>
                <span>{formatPayrollMoney(item.amountHalalas)}</span>
                <small>{item.reason}{item.note ? ` آ· ${item.note}` : ""}</small>
              </article>
            ))
          ) : (
            <p>ظ„ط§ طھظˆط¬ط¯ ط¨ظ†ظˆط¯ ظٹط¯ظˆظٹط©.</p>
          )}
        </section>

        <section className="payroll-audit-list">
          <h3>ط³ط¬ظ„ ظ…ط®طھطµط±</h3>
          {(entry.auditLog || []).length ? (
            entry.auditLog!.map((item, index) => (
              <span key={`${item.action || "event"}:${index}`}>{String(item.action || "event")} آ· {String(item.at || "")}</span>
            ))
          ) : (
            <span>طھظ… ط§ظ„ط¥ظ†ط´ط§ط، ظƒظ…ط³ظˆط¯ط©</span>
          )}
        </section>
      </aside>
    </div>
  );
}

