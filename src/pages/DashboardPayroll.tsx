import { useEffect, useMemo, useState } from "react";
import {
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiEye,
  FiPlus,
  FiRefreshCw,
  FiSave,
  FiShield,
  FiSliders,
  FiX,
} from "react-icons/fi";
import { usePermissions } from "../security/PermissionContext";
import { CoreHrService } from "../services/CoreHrService";
import {
  approvePayrollEntry,
  ensurePayrollPeriod,
  generatePayrollEntries,
  loadPayrollMonth,
  markPayrollEntryPaid,
  payrollMonthBounds,
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
  type PayrollStatus,
} from "../helpers/hr/payrollCalculations";
import { formatAttendanceHours } from "../helpers/hr/attendanceDiscipline";
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

const STATUS_LABELS: Record<string, string> = {
  all: "كل الحالات",
  draft: "مسودة",
  reviewed: "تمت المراجعة",
  approved: "معتمد",
  paid: "مدفوع",
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

export default function DashboardPayroll() {
  const { hasPermission } = usePermissions();
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const payrollMonth = payrollMonthBounds(year, month).payrollMonth;

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
      setEmployees(employeeRows);
      setEntries(payroll.entries);
      setMessage(payroll.entries.length ? "تم تحميل مسيرات الرواتب المحفوظة." : "لا توجد مسيرات محفوظة لهذا الشهر بعد.");
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
        acc.base += entry.baseSalaryHalalas;
        acc.additions += entry.totalAdditionsHalalas;
        acc.deductions += entry.totalDeductionsHalalas;
        acc.net += entry.netSalaryHalalas;
        if (entry.status === "draft") acc.drafts += 1;
        if (entry.status === "approved") acc.approved += 1;
        if (entry.status === "paid") acc.paid += 1;
        return acc;
      },
      { count: 0, base: 0, additions: 0, deductions: 0, net: 0, drafts: 0, approved: 0, paid: 0 }
    );
  }, [visibleEntries]);

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
      setMessage(recalculate ? "تمت إعادة الحساب للمسودات غير المقفلة." : "تم توليد مسيرة الشهر كمسودات جاهزة للحفظ.");
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
      setMessage(`تم حفظ ${saved.length} مسودة في Core D1.`);
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
      const next = generated[0] || entry;
      setEntries((current) => replaceEntry(current, next));
      setMessage("تمت إعادة حساب السجل.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذرت إعادة حساب السجل."));
    } finally {
      setBusy("");
    }
  };

  const handleToggleOvertime = async (entry: PayrollEntryView, checked: boolean) => {
    if (!canManage || isPayrollSnapshotLocked(entry.status)) return;
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
    setBusy(`approve:${entry.employeeId}`);
    try {
      const saved = await approvePayrollEntry(entry);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("تم اعتماد الراتب.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر اعتماد الراتب."));
    } finally {
      setBusy("");
    }
  };

  const handlePaid = async (entry: PayrollEntryView) => {
    if (!canManage) return;
    setBusy(`paid:${entry.employeeId}`);
    try {
      const saved = await markPayrollEntryPaid(entry);
      setEntries((current) => replaceEntry(current, saved));
      setMessage("تم تسجيل الراتب كمدفوع.");
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر تسجيل الدفع."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="payroll-page" dir="rtl">
      <header className="payroll-hero">
        <div>
          <span>Core D1 Payroll</span>
          <h1>إدارة الرواتب</h1>
          <p>إنشاء ومراجعة واعتماد مسيرات الرواتب الشهرية للموظفات.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          تحديث
        </button>
      </header>

      <div className="payroll-toolbar">
        <label>
          <span>الشهر</span>
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>السنة</span>
          <input type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} />
        </label>
        <label>
          <span>الموظفة</span>
          <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
            <option value="all">كل الموظفات</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>حالة الراتب</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="payroll-toolbar__actions">
          <button type="button" onClick={() => void handleGenerate(false)} disabled={!canManage || Boolean(busy)}>
            <FiSliders /> توليد مسيرة الشهر
          </button>
          <button type="button" onClick={() => void handleGenerate(true)} disabled={!canManage || Boolean(busy)}>
            <FiRefreshCw /> إعادة حساب
          </button>
          <button type="button" className="is-primary" onClick={() => void handleSaveDrafts()} disabled={!canManage || Boolean(busy)}>
            <FiSave /> حفظ المسودات
          </button>
        </div>
      </div>

      {error ? <div className="payroll-alert is-error">{error}</div> : null}
      {message ? <div className="payroll-alert"><FiCheckCircle />{message}</div> : null}
      {!canManage ? <div className="payroll-alert is-readonly">وضع قراءة فقط: يمكنك مراجعة الرواتب دون تعديلها.</div> : null}

      <div className="payroll-summary-grid">
        <article><span><FiShield /></span><small>عدد الموظفات</small><strong>{summary.count}</strong></article>
        <article><span><FiDollarSign /></span><small>إجمالي الرواتب الأساسية</small><strong>{formatPayrollMoney(summary.base)}</strong></article>
        <article><span><FiPlus /></span><small>إجمالي الإضافات</small><strong>{formatPayrollMoney(summary.additions)}</strong></article>
        <article><span><FiX /></span><small>إجمالي الخصومات</small><strong>{formatPayrollMoney(summary.deductions)}</strong></article>
        <article><span><FiDollarSign /></span><small>إجمالي صافي الرواتب</small><strong>{formatPayrollMoney(summary.net)}</strong></article>
        <article><span><FiClock /></span><small>عدد المسودات</small><strong>{summary.drafts}</strong></article>
        <article><span><FiCheckCircle /></span><small>عدد الرواتب المعتمدة</small><strong>{summary.approved}</strong></article>
        <article><span><FiDollarSign /></span><small>عدد الرواتب المدفوعة</small><strong>{summary.paid}</strong></article>
      </div>

      <div className="payroll-table-wrap">
        <table className="payroll-table">
          <thead>
            <tr>
              <th>الموظفة</th>
              <th>الراتب الأساسي</th>
              <th>أيام العمل</th>
              <th>ساعات الشهر</th>
              <th>راتب اليوم</th>
              <th>راتب الساعة</th>
              <th>التأخير الفعلي</th>
              <th>التعويض بعد الدوام</th>
              <th>نقص الساعات</th>
              <th>الساعات الزائدة المكتشفة</th>
              <th>احتساب الأوفر تايم</th>
              <th>قيمة الأوفر تايم</th>
              <th>الإضافات</th>
              <th>الخصومات</th>
              <th>السلف</th>
              <th>صافي الراتب</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const locked = isPayrollSnapshotLocked(entry.status);
              return (
                <tr key={`${entry.employeeId}:${entry.payrollMonth}`}>
                  <td><strong>{entry.employeeName}</strong><small>{entry.jobTitle || entry.employeeId}</small></td>
                  <td>{formatPayrollMoney(entry.baseSalaryHalalas)}</td>
                  <td>{entry.workDays}</td>
                  <td>{formatAttendanceHours(entry.monthlyHours)}</td>
                  <td>{formatPayrollMoney(entry.dailyRateHalalas)}</td>
                  <td>{formatPayrollMoney(entry.hourlyRateHalalas)}</td>
                  <td>{formatAttendanceHours(entry.attendanceSummary.totalLateHours)}</td>
                  <td>{formatAttendanceHours(entry.attendanceSummary.totalCompensatedLateHours)}</td>
                  <td>{formatAttendanceHours(entry.attendanceSummary.totalMissingHours)}</td>
                  <td>{formatAttendanceHours(entry.detectedExtraHours)}</td>
                  <td>
                    <label className="payroll-switch">
                      <input
                        type="checkbox"
                        checked={entry.overtimeEnabled}
                        disabled={!canManage || locked}
                        onChange={(event) => void handleToggleOvertime(entry, event.target.checked)}
                      />
                      <span />
                    </label>
                  </td>
                  <td>{formatPayrollMoney(entry.overtimeValueHalalas)}</td>
                  <td>{formatPayrollMoney(entry.totalAdditionsHalalas)}</td>
                  <td>{formatPayrollMoney(entry.totalDeductionsHalalas)}</td>
                  <td>{formatPayrollMoney(entry.advancesHalalas)}</td>
                  <td><strong>{formatPayrollMoney(entry.netSalaryHalalas)}</strong></td>
                  <td><span className={`payroll-status ${statusClass(entry.status)}`}>{STATUS_LABELS[entry.status] || entry.status}</span></td>
                  <td>
                    <div className="payroll-row-actions">
                      <button type="button" onClick={() => setSelectedEntry(entry)}><FiEye />عرض</button>
                      <button type="button" disabled={!canManage || locked} onClick={() => void handleRecalculateEntry(entry)}>إعادة الحساب</button>
                      <button type="button" disabled={!canManage || locked} onClick={() => openAdjustment(entry, "deduction")}>إضافة خصم</button>
                      <button type="button" disabled={!canManage || locked} onClick={() => openAdjustment(entry, "addition")}>إضافة إضافة</button>
                      <button type="button" disabled={!canManage || entry.status === "paid"} onClick={() => void handleApprove(entry)}>اعتماد</button>
                      <button type="button" disabled={!canManage || entry.status === "paid"} onClick={() => void handlePaid(entry)}>تسجيل كمدفوع</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !visibleEntries.length ? <p className="payroll-empty">لا توجد رواتب مطابقة. استخدم زر توليد مسيرة الشهر لإنشاء مسودات.</p> : null}
      </div>

      {selectedEntry ? (
        <PayrollDetailsModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onAdd={(mode) => openAdjustment(selectedEntry, mode)}
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
              <select value={adjustment.kind} onChange={(event) => setAdjustment({ ...adjustment, kind: event.target.value as PayrollManualItemKind })}>
                {(adjustment.mode === "addition" ? ADDITION_KINDS : DEDUCTION_KINDS).map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
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
}: {
  entry: PayrollEntryView;
  onClose: () => void;
  onAdd: (mode: AdjustmentMode) => void;
}) {
  return (
    <div className="payroll-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="payroll-modal payroll-detail-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{entry.payrollMonth}</span>
            <h2>{entry.employeeName}</h2>
            <p>{entry.jobTitle || "موظفة"} · {STATUS_LABELS[entry.status] || entry.status}</p>
          </div>
          <button type="button" onClick={onClose}><FiX /></button>
        </header>

        <div className="payroll-detail-grid">
          <section>
            <h3>إعدادات الراتب</h3>
            <dl>
              <div><dt>الراتب الأساسي</dt><dd>{formatPayrollMoney(entry.baseSalaryHalalas)}</dd></div>
              <div><dt>عدد أيام العمل</dt><dd>{entry.workDays}</dd></div>
              <div><dt>ساعات الشهر</dt><dd>{formatAttendanceHours(entry.monthlyHours)}</dd></div>
              <div><dt>معامل الأوفر تايم</dt><dd>{entry.overtimeMultiplier}</dd></div>
            </dl>
          </section>

          <section>
            <h3>ملخص الحضور</h3>
            <dl>
              <div><dt>أيام الحضور</dt><dd>{entry.attendanceSummary.attendanceDays}</dd></div>
              <div><dt>أيام الغياب</dt><dd>{entry.attendanceSummary.absentDays}</dd></div>
              <div><dt>إجمالي ساعات الدوام المطلوبة</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalScheduledHours)}</dd></div>
              <div><dt>إجمالي ساعات العمل الفعلية</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalActualWorkedHours)}</dd></div>
              <div><dt>إجمالي التأخير الفعلي</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalLateHours)}</dd></div>
              <div><dt>إجمالي التعويض بعد الدوام</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalCompensatedLateHours)}</dd></div>
              <div><dt>إجمالي نقص الساعات</dt><dd>{formatAttendanceHours(entry.attendanceSummary.totalMissingHours)}</dd></div>
              <div><dt>إجمالي الساعات الزائدة المكتشفة</dt><dd>{formatAttendanceHours(entry.detectedExtraHours)}</dd></div>
            </dl>
          </section>

          <section>
            <h3>الاستحقاقات</h3>
            <dl>
              <div><dt>الراتب الأساسي</dt><dd>{formatPayrollMoney(entry.baseSalaryHalalas)}</dd></div>
              <div><dt>البدلات</dt><dd>{formatPayrollMoney(entry.allowancesHalalas)}</dd></div>
              <div><dt>المكافآت والإضافات</dt><dd>{formatPayrollMoney(entry.manualAdditionsHalalas)}</dd></div>
              <div><dt>قيمة الأوفر تايم</dt><dd>{formatPayrollMoney(entry.overtimeValueHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("addition")}><FiPlus />إضافة استحقاق</button>
          </section>

          <section>
            <h3>الخصومات</h3>
            <dl>
              <div><dt>خصم نقص الساعات</dt><dd>{formatPayrollMoney(entry.missingHoursDeductionHalalas)}</dd></div>
              <div><dt>السلف</dt><dd>{formatPayrollMoney(entry.advancesHalalas)}</dd></div>
              <div><dt>خصومات يدوية وجزاءات</dt><dd>{formatPayrollMoney(entry.manualDeductionsHalalas)}</dd></div>
              <div><dt>إجمالي الخصومات</dt><dd>{formatPayrollMoney(entry.totalDeductionsHalalas)}</dd></div>
            </dl>
            <button type="button" onClick={() => onAdd("deduction")}><FiPlus />إضافة خصم</button>
          </section>
        </div>

        <section className="payroll-net-panel">
          <div><span>grossSalary</span><strong>{formatPayrollMoney(entry.grossSalaryHalalas)}</strong></div>
          <div><span>totalAdditions</span><strong>{formatPayrollMoney(entry.totalAdditionsHalalas)}</strong></div>
          <div><span>totalDeductions</span><strong>{formatPayrollMoney(entry.totalDeductionsHalalas)}</strong></div>
          <div className="is-net"><span>netSalary</span><strong>{formatPayrollMoney(entry.netSalaryHalalas)}</strong></div>
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
