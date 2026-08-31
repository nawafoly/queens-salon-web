import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { DashboardMonthInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import {
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import { CoreHrService } from "../../services/CoreHrService";
import type {
  CorePayrollObligation,
  CorePayrollObligationDeduction,
  CorePayrollObligationInstallment,
  CorePayrollRecurringDeduction,
} from "../../types/hrCoreApi";

type Props = {
  employeeId: string;
  currentPayrollMonth: string;
  readOnly: boolean;
};

type CollectionMode = "current" | "defer" | "installments";
type InstallmentDraft = { targetPayrollMonth: string; amount: string };

const DEDUCTION_KIND_OPTIONS = [
  { value: "fixed_agreed", label: "خصم ثابت متفق عليه" },
  { value: "loan", label: "قرض / سلفة خارجية موثقة" },
  { value: "manual", label: "خصم إداري يدوي" },
  { value: "absence", label: "غياب يدوي موثق" },
  { value: "delay", label: "تأخير يدوي موثق" },
  { value: "asset_reimbursement", label: "تعويض عهدة / أصل" },
  { value: "subscription", label: "اشتراك" },
  { value: "other", label: "التزام آخر" },
];

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function newOperationId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid || `payroll-obligation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toHalalas(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : 0;
}

function fromHalalas(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number) / 100 : 0;
}

function money(value: unknown) {
  return `${fromHalalas(value).toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 2 })} ر.س`;
}

function deductionKindLabel(value: unknown) {
  const kind = cleanText(value);
  return DEDUCTION_KIND_OPTIONS.find((option) => option.value === kind)?.label || kind || "غير محدد";
}

function sourceLabel(sourceType: unknown, recurringDeductionId?: unknown) {
  if (cleanText(recurringDeductionId)) return "خصم ثابت متكرر";
  const source = cleanText(sourceType);
  if (source === "employee_profile") return "ملف الموظفة";
  if (source === "manual") return "إدخال إداري";
  if (source === "salary_advance") return "سلفة راتب";
  return source || "غير محدد";
}

function clampInstallmentCount(value: unknown) {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) ? Math.min(24, Math.max(1, count)) : 1;
}

function buildEvenInstallments(originalMonth: string, amountHalalas: number, countInput: number) {
  const count = clampInstallmentCount(countInput);
  const total = Math.max(0, Math.trunc(amountHalalas || 0));
  const base = count > 0 ? Math.floor(total / count) : 0;
  const remainder = count > 0 ? total % count : 0;
  return Array.from({ length: count }, (_, index) => {
    const installmentHalalas = base + (index < remainder ? 1 : 0);
    return {
      targetPayrollMonth: shiftMonth(originalMonth, index + 1),
      amount: installmentHalalas > 0 ? (installmentHalalas / 100).toFixed(2) : "",
    };
  });
}

function validMonth(value: unknown, fallback = "") {
  const text = cleanText(value);
  return /^\d{4}-\d{2}$/.test(text) ? text : fallback;
}

function shiftMonth(monthKey: string, offset: number) {
  const normalized = validMonth(monthKey, new Date().toISOString().slice(0, 7));
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  const raw = cleanText((error as Error)?.message || error);
  const rawCode = cleanText((error as { code?: unknown })?.code);
  const code = (rawCode || raw).split(":").pop() || rawCode || raw;
  const labels: Record<string, string> = {
    statutory_deduction_not_deferrable: "خصومات GOSI النظامية لا يمكن تأجيلها أو تقسيطها من هذه الشاشة.",
    deduction_reason_required: "اكتب سبب الخصم أو القرار المالي.",
    deduction_amount_required: "اكتب مبلغًا أكبر من صفر.",
    deduction_installment_total_mismatch: "مجموع الأقساط يجب أن يساوي إجمالي الالتزام تمامًا.",
    deduction_installment_target_must_be_later: "شهور الأقساط يجب أن تكون بعد شهر نشوء الالتزام.",
    deferred_deduction_target_must_be_later: "شهر التأجيل يجب أن يكون بعد شهر التحصيل الحالي.",
    obligation_target_payroll_locked: "لا يمكن تعديل تحصيل شهر له مسير Approved/Paid.",
    obligation_snapshot_stale: "تغيرت الالتزامات بعد إنشاء المسير. أعد توليد المسير قبل الاعتماد.",
  };
  return labels[code] || raw || "تعذر تنفيذ العملية.";
}

function obligationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "مفتوح",
    scheduled: "مجدول",
    partially_settled: "مسدد جزئيًا",
    settled: "مسدد",
    cancelled: "ملغي",
  };
  return labels[status] || status || "غير محدد";
}

function installmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    scheduled: "مجدول",
    applied: "مطبق",
    deferred: "مرحّل",
    cancelled: "ملغي",
  };
  return labels[status] || status || "غير محدد";
}

export default function PayrollObligationsPanel({
  employeeId,
  currentPayrollMonth,
  readOnly,
}: Props) {
  const month = validMonth(currentPayrollMonth, new Date().toISOString().slice(0, 7));
  const [recurringRows, setRecurringRows] = useState<CorePayrollRecurringDeduction[]>([]);
  const [obligations, setObligations] = useState<CorePayrollObligation[]>([]);
  const [collectibleRows, setCollectibleRows] = useState<CorePayrollObligationDeduction[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [recurringTitle, setRecurringTitle] = useState("");
  const [recurringKind, setRecurringKind] = useState("fixed_agreed");
  const [recurringAmount, setRecurringAmount] = useState("");
  const [recurringStartMonth, setRecurringStartMonth] = useState(month);
  const [recurringEndMonth, setRecurringEndMonth] = useState("");
  const [recurringReason, setRecurringReason] = useState("");
  const [recurringNote, setRecurringNote] = useState("");

  const [obligationKind, setObligationKind] = useState("manual");
  const [obligationAmount, setObligationAmount] = useState("");
  const [obligationOriginalMonth, setObligationOriginalMonth] = useState(month);
  const [collectionMode, setCollectionMode] = useState<CollectionMode>("current");
  const [deferredTargetMonth, setDeferredTargetMonth] = useState(shiftMonth(month, 1));
  const [obligationReason, setObligationReason] = useState("");
  const [obligationNote, setObligationNote] = useState("");
  const [obligationSourceRef, setObligationSourceRef] = useState(() => newOperationId());
  const [installmentDrafts, setInstallmentDrafts] = useState<InstallmentDraft[]>(() =>
    buildEvenInstallments(month, 0, 3)
  );

  const [selectedInstallmentId, setSelectedInstallmentId] = useState("");
  const [deferToMonth, setDeferToMonth] = useState(shiftMonth(month, 1));
  const [deferReason, setDeferReason] = useState("");
  const [deferNote, setDeferNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const scheduledInstallments = useMemo(
    () =>
      obligations.flatMap((obligation) =>
        (obligation.installments || [])
          .filter((installment) => installment.status === "scheduled")
          .map((installment) => ({ obligation, installment }))
      ),
    [obligations]
  );

  const currentMonthTotalHalalas = useMemo(
    () => collectibleRows.reduce((sum, row) => sum + Math.max(0, Number(row.amountHalalas || 0)), 0),
    [collectibleRows]
  );

  const deferredFromPriorMonthsHalalas = useMemo(
    () => collectibleRows.reduce((sum, row) => {
      const original = validMonth(row.originalPayrollMonth);
      const target = validMonth(row.targetPayrollMonth);
      return original && target === month && original < target
        ? sum + Math.max(0, Number(row.amountHalalas || 0))
        : sum;
    }, 0),
    [collectibleRows, month]
  );

  const upcomingInstallmentsHalalas = useMemo(
    () => scheduledInstallments.reduce((sum, { installment }) =>
      installment.targetPayrollMonth > month
        ? sum + Math.max(0, Number(installment.amountHalalas || 0))
        : sum, 0),
    [scheduledInstallments, month]
  );

  const openObligationsHalalas = useMemo(
    () => obligations.reduce((sum, obligation) =>
      ["open", "scheduled", "partially_settled"].includes(obligation.status)
        ? sum + Math.max(0, Number(obligation.remainingAmountHalalas || 0))
        : sum, 0),
    [obligations]
  );

  const installmentTotalHalalas = useMemo(
    () => installmentDrafts.reduce((sum, draft) => sum + toHalalas(draft.amount), 0),
    [installmentDrafts]
  );
  const obligationTotalHalalas = toHalalas(obligationAmount);
  const installmentDifferenceHalalas = obligationTotalHalalas - installmentTotalHalalas;

  async function refresh() {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const [recurring, obligationRows, collectible] = await Promise.all([
        CoreHrService.listPayrollRecurringDeductions({ employeeId }),
        CoreHrService.listPayrollObligations({ employeeId }),
        CoreHrService.listPayrollObligationDeductions({ employeeId, payrollMonth: month }),
      ]);
      setRecurringRows(recurring);
      setObligations(obligationRows);
      setCollectibleRows(collectible);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Never carry an unsaved financial form across employee/month boundaries.
    setRecurringTitle("");
    setRecurringKind("fixed_agreed");
    setRecurringAmount("");
    setRecurringStartMonth(month);
    setRecurringEndMonth("");
    setRecurringReason("");
    setRecurringNote("");
    setObligationKind("manual");
    setObligationAmount("");
    setObligationOriginalMonth(month);
    setCollectionMode("current");
    setDeferredTargetMonth(shiftMonth(month, 1));
    setObligationReason("");
    setObligationNote("");
    setObligationSourceRef(newOperationId());
    setInstallmentDrafts(buildEvenInstallments(month, 0, 3));
    setSelectedInstallmentId("");
    setDeferToMonth(shiftMonth(month, 1));
    setDeferReason("");
    setDeferNote("");
    setCancelReason("");
    void refresh();
    // employee/month change is the canonical reload boundary for this financial panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, month]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    if (readOnly || working) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(successMessage);
      await refresh();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setWorking(false);
    }
  }

  function resetRecurringForm() {
    setRecurringTitle("");
    setRecurringAmount("");
    setRecurringEndMonth("");
    setRecurringReason("");
    setRecurringNote("");
  }

  function resetObligationForm() {
    setObligationAmount("");
    setObligationReason("");
    setObligationNote("");
    setCollectionMode("current");
    setDeferredTargetMonth(shiftMonth(month, 1));
    setObligationSourceRef(newOperationId());
    setInstallmentDrafts(buildEvenInstallments(month, 0, 3));
  }

  return (
    <div className="dsv2-ew-grid dsv2-ew-grid--1" data-payroll-obligations-panel="true">
      <WorkspaceCardV2
        title="الخصومات والالتزامات"
        description="كل مبلغ موثق بنوعه وسببه وشهر نشوئه وشهر تحصيله. التأجيل والتقسيط يغيران موعد التحصيل ولا يحذفان أصل الالتزام."
        actions={
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
            disabled={loading || working}
            onClick={() => void refresh()}
          >
            تحديث
          </button>
        }
      >
        <div className="dsv2-ew-metrics">
          <WorkspaceMetricV2 label={`المستحق للتحصيل — ${month}`} value={money(currentMonthTotalHalalas)} tone={currentMonthTotalHalalas > 0 ? "gold" : "success"} />
          <WorkspaceMetricV2 label="مؤجل من أشهر سابقة" value={money(deferredFromPriorMonthsHalalas)} tone={deferredFromPriorMonthsHalalas > 0 ? "gold" : "neutral"} />
          <WorkspaceMetricV2 label="الأقساط القادمة" value={money(upcomingInstallmentsHalalas)} />
          <WorkspaceMetricV2 label="إجمالي الالتزامات المفتوحة" value={money(openObligationsHalalas)} tone={openObligationsHalalas > 0 ? "gold" : "success"} />
        </div>

        <WorkspaceNoticeV2
          title="فصل مالي صريح"
          description="هذه الخصومات الإدارية مستقلة عن GOSI وعن Carryover. خصم GOSI النظامي لا يقبل التأجيل أو التقسيط هنا، وCarryover يبقى فقط لتصحيح فروقات اكتشفت بعد اعتماد المسير."
          tone="neutral"
        />

        {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ العملية" description={error} tone="danger" /> : null}
        {message ? <WorkspaceNoticeV2 title="تم" description={message} tone="success" /> : null}
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="المستحق في هذا الشهر"
        description="هذه هي البنود التي سيدخلها مسير الرواتب Draft لهذا الشهر. البنود المرحّلة تظهر في شهر التحصيل الجديد مع الاحتفاظ بالشهر الأصلي."
      >
        <WorkspaceTableV2
          headers={["البند", "المبلغ", "النوع", "شهر الأصل", "شهر التحصيل", "السبب", "المصدر"]}
          rows={collectibleRows.map((row) => [
            row.label || row.reason || "خصم",
            money(row.amountHalalas),
            deductionKindLabel(row.obligationKind),
            row.originalPayrollMonth || "-",
            row.targetPayrollMonth || "-",
            row.reason || "-",
            row.recurringDeductionId ? "خصم ثابت" : row.synthetic ? "متوقع / قبل الحفظ" : "التزام محفوظ",
          ])}
          emptyText={loading ? "جاري تحميل الخصومات..." : "لا توجد خصومات أو التزامات مستحقة للتحصيل في هذا الشهر."}
        />
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="خصم ثابت متكرر"
        description="ينشئ بندًا شهريًا متوقعًا من شهر البداية إلى شهر النهاية إن وجد. لا يتم إنشاء حركة تحصيل فعلية إلا عند بناء/حفظ مسير الشهر."
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="payroll-recurring-title" label="اسم الخصم">
            <input id="payroll-recurring-title" className="dsv2-input" value={recurringTitle} disabled={readOnly} onChange={(event) => setRecurringTitle(event.target.value)} placeholder="مثال: خصم اشتراك شهري" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-kind" label="نوع الخصم">
            <DashboardSelectV2 id="payroll-recurring-kind" value={recurringKind} disabled={readOnly} options={DEDUCTION_KIND_OPTIONS} onChange={setRecurringKind} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-amount" label="المبلغ الشهري (ر.س)">
            <DashboardNumberInputV2 id="payroll-recurring-amount" className="dsv2-input" min="0" step="0.01" value={recurringAmount} disabled={readOnly} onChange={(event) => setRecurringAmount(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-start" label="شهر البداية">
            <DashboardMonthInputV2 id="payroll-recurring-start" className="dsv2-input" value={recurringStartMonth} disabled={readOnly} onChange={(event) => setRecurringStartMonth(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-end" label="شهر النهاية — اختياري">
            <DashboardMonthInputV2 id="payroll-recurring-end" className="dsv2-input" value={recurringEndMonth} disabled={readOnly} onChange={(event) => setRecurringEndMonth(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-reason" label="السبب / الأساس">
            <input id="payroll-recurring-reason" className="dsv2-input" value={recurringReason} disabled={readOnly} onChange={(event) => setRecurringReason(event.target.value)} placeholder="لماذا يوجد هذا الخصم؟" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-note" label="ملاحظة — اختياري">
            <input id="payroll-recurring-note" className="dsv2-input" value={recurringNote} disabled={readOnly} onChange={(event) => setRecurringNote(event.target.value)} />
          </DashboardFieldV2>
        </div>
        <div className="dsv2-cluster">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            disabled={readOnly || working}
            onClick={() =>
              void run(
                async () => {
                  await CoreHrService.savePayrollRecurringDeduction({
                    employeeId,
                    title: recurringTitle,
                    deductionKind: recurringKind,
                    amountHalalas: toHalalas(recurringAmount),
                    startPayrollMonth: recurringStartMonth,
                    endPayrollMonth: recurringEndMonth || null,
                    reason: recurringReason,
                    note: recurringNote || null,
                    status: "active",
                  });
                  resetRecurringForm();
                },
                "تم حفظ الخصم الثابت."
              )
            }
          >
            حفظ الخصم الثابت
          </button>
        </div>

        <WorkspaceTableV2
          headers={["الاسم", "المبلغ", "النوع", "من", "إلى", "الحالة", "السبب", "إجراء"]}
          rows={recurringRows.map((row) => [
            row.title,
            money(row.amountHalalas),
            deductionKindLabel(row.deductionKind),
            row.startPayrollMonth,
            row.endPayrollMonth || "مستمر",
            <WorkspaceStatusBadgeV2 key={`${row.id}-status`} tone={row.status === "active" ? "success" : "gold"}>{row.status === "active" ? "نشط" : row.status === "paused" ? "موقوف" : row.status}</WorkspaceStatusBadgeV2>,
            row.reason,
            <button
              key={`${row.id}-toggle`}
              type="button"
              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
              disabled={readOnly || working || !["active", "paused"].includes(row.status)}
              onClick={() =>
                void run(
                  () => CoreHrService.savePayrollRecurringDeduction({
                    ...row,
                    status: row.status === "active" ? "paused" : "active",
                  }),
                  row.status === "active" ? "تم إيقاف الخصم الثابت." : "تم تفعيل الخصم الثابت."
                )
              }
            >
              {row.status === "active" ? "إيقاف" : "تفعيل"}
            </button>,
          ])}
          emptyText="لا توجد خصومات ثابتة محفوظة."
        />
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="التزام أو خصم لمرة واحدة"
        description="سجّل أصل المبلغ أولًا، ثم اختر تحصيله في شهر الأصل أو تأجيله إلى شهر لاحق أو تقسيمه على عدة أشهر."
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="payroll-obligation-kind" label="نوع الالتزام">
            <DashboardSelectV2 id="payroll-obligation-kind" value={obligationKind} disabled={readOnly} options={DEDUCTION_KIND_OPTIONS} onChange={setObligationKind} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-obligation-amount" label="إجمالي المبلغ (ر.س)">
            <DashboardNumberInputV2
              id="payroll-obligation-amount"
              className="dsv2-input"
              min="0"
              step="0.01"
              value={obligationAmount}
              disabled={readOnly}
              onChange={(event) => {
                const nextAmount = event.target.value;
                setObligationAmount(nextAmount);
                if (collectionMode === "installments") {
                  setInstallmentDrafts((rows) =>
                    buildEvenInstallments(
                      obligationOriginalMonth || month,
                      toHalalas(nextAmount),
                      rows.length || 1
                    )
                  );
                }
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-obligation-original-month" label="شهر نشوء الالتزام">
            <DashboardMonthInputV2 id="payroll-obligation-original-month" className="dsv2-input" value={obligationOriginalMonth} disabled={readOnly} onChange={(event) => { const nextMonth = event.target.value; setObligationOriginalMonth(nextMonth); if (collectionMode === "installments") { setInstallmentDrafts((rows) => buildEvenInstallments( nextMonth || month, toHalalas(obligationAmount), rows.length || 1 ) ); } }} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-obligation-mode" label="طريقة التحصيل">
            <DashboardSelectV2
              id="payroll-obligation-mode"
              value={collectionMode}
              disabled={readOnly}
              options={[
                { value: "current", label: "تحصيل في شهر الأصل" },
                { value: "defer", label: "تأجيل إلى شهر محدد" },
                { value: "installments", label: "تقسيط على عدة أشهر" },
              ]}
              onChange={(value) => {
                const nextMode = value === "defer" ? "defer" : value === "installments" ? "installments" : "current";
                setCollectionMode(nextMode);
                if (nextMode === "installments") {
                  setInstallmentDrafts((rows) =>
                    buildEvenInstallments(
                      obligationOriginalMonth || month,
                      toHalalas(obligationAmount),
                      rows.length || 3
                    )
                  );
                }
              }}
            />
          </DashboardFieldV2>
          {collectionMode === "defer" ? (
            <DashboardFieldV2 id="payroll-obligation-target-month" label="شهر التحصيل الجديد">
              <DashboardMonthInputV2 id="payroll-obligation-target-month" className="dsv2-input" value={deferredTargetMonth} disabled={readOnly} onChange={(event) => setDeferredTargetMonth(event.target.value)} />
            </DashboardFieldV2>
          ) : null}
          <DashboardFieldV2
            id="payroll-obligation-reason"
            label={collectionMode === "defer" ? "سبب الخصم / قرار التأجيل" : collectionMode === "installments" ? "سبب الخصم / قرار التقسيط" : "السبب / الأساس"}
          >
            <input id="payroll-obligation-reason" className="dsv2-input" value={obligationReason} disabled={readOnly} onChange={(event) => setObligationReason(event.target.value)} placeholder="سبب مالي واضح وقابل للمراجعة" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-obligation-note" label="ملاحظة — اختياري">
            <input id="payroll-obligation-note" className="dsv2-input" value={obligationNote} disabled={readOnly} onChange={(event) => setObligationNote(event.target.value)} />
          </DashboardFieldV2>
        </div>

        {collectionMode === "installments" ? (
          <div className="dsv2-ew-stack">
            <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
              <DashboardFieldV2 id="payroll-installment-count" label="عدد الأقساط">
                <DashboardNumberInputV2
                  id="payroll-installment-count"
                  className="dsv2-input"
                  min="1"
                  max="24"
                  value={installmentDrafts.length}
                  disabled={readOnly}
                  onChange={(event) =>
                    setInstallmentDrafts(
                      buildEvenInstallments(
                        obligationOriginalMonth || month,
                        obligationTotalHalalas,
                        clampInstallmentCount(event.target.value)
                      )
                    )
                  }
                />
              </DashboardFieldV2>
              <DashboardFieldV2 id="payroll-installment-average" label="متوسط قيمة القسط">
                <input
                  id="payroll-installment-average"
                  className="dsv2-input"
                  readOnly
                  value={money(installmentDrafts.length ? Math.round(obligationTotalHalalas / installmentDrafts.length) : 0)}
                />
              </DashboardFieldV2>
              <div className="dsv2-field">
                <span className="dsv2-field__label">توزيع تلقائي</span>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                  disabled={readOnly || obligationTotalHalalas <= 0}
                  onClick={() =>
                    setInstallmentDrafts((rows) =>
                      buildEvenInstallments(
                        obligationOriginalMonth || month,
                        obligationTotalHalalas,
                        rows.length || 1
                      )
                    )
                  }
                >
                  توزيع المبلغ على الأقساط
                </button>
              </div>
            </div>

            <WorkspaceNoticeV2
              title="جدول الأقساط"
              description={`الإجمالي: ${money(obligationTotalHalalas)} — مجموع الأقساط: ${money(installmentTotalHalalas)}${installmentDifferenceHalalas === 0 ? " — التوزيع متوازن." : ` — الفرق: ${money(Math.abs(installmentDifferenceHalalas))}.`}`}
              tone={obligationTotalHalalas > 0 && installmentDifferenceHalalas === 0 ? "success" : "gold"}
            />
            {installmentDrafts.map((draft, index) => (
              <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3" key={`installment-${index}`}>
                <DashboardFieldV2 id={`payroll-installment-month-${index}`} label={`شهر القسط ${index + 1}`}>
                  <DashboardMonthInputV2 id={`payroll-installment-month-${index}`} className="dsv2-input" value={draft.targetPayrollMonth} disabled={readOnly} onChange={(event) => setInstallmentDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, targetPayrollMonth: event.target.value } : row))} />
                </DashboardFieldV2>
                <DashboardFieldV2 id={`payroll-installment-amount-${index}`} label="مبلغ القسط (ر.س)">
                  <DashboardNumberInputV2 id={`payroll-installment-amount-${index}`} className="dsv2-input" min="0" step="0.01" value={draft.amount} disabled={readOnly} onChange={(event) => setInstallmentDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} />
                </DashboardFieldV2>
                <div className="dsv2-field">
                  <span className="dsv2-field__label">إجراء</span>
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly || installmentDrafts.length <= 1} onClick={() => setInstallmentDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>حذف القسط</button>
                </div>
              </div>
            ))}
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => setInstallmentDrafts((rows) => [...rows, { targetPayrollMonth: shiftMonth(obligationOriginalMonth || month, rows.length + 1), amount: "" }])}>إضافة قسط</button>
          </div>
        ) : null}

        <div className="dsv2-cluster">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            disabled={readOnly || working}
            onClick={() =>
              void run(
                async () => {
                  const payload: Record<string, unknown> = {
                    employeeId,
                    kind: obligationKind,
                    amountHalalas: toHalalas(obligationAmount),
                    originalPayrollMonth: obligationOriginalMonth,
                    reason: obligationReason,
                    note: obligationNote || null,
                    sourceType: "employee_profile",
                    sourceRef: obligationSourceRef,
                  };
                  if (collectionMode === "defer") payload.targetPayrollMonth = deferredTargetMonth;
                  if (collectionMode === "installments") {
                    payload.installments = installmentDrafts.map((draft) => ({
                      targetPayrollMonth: draft.targetPayrollMonth,
                      amountHalalas: toHalalas(draft.amount),
                    }));
                  }
                  await CoreHrService.createPayrollObligation(payload);
                  resetObligationForm();
                },
                collectionMode === "current" ? "تم إنشاء الخصم لهذا الشهر." : collectionMode === "defer" ? "تم إنشاء الالتزام وتأجيل تحصيله." : "تم إنشاء الالتزام وجدول الأقساط."
              )
            }
          >
            إنشاء الالتزام
          </button>
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="تأجيل قسط مجدول"
        description="اختر قسطًا لم يُطبق بعد وحدد الشهر الجديد والسبب. يحتفظ النظام بالقسط القديم بحالة «مرحّل» ويربطه بالقسط البديل."
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="payroll-defer-installment" label="القسط">
            <DashboardSelectV2
              id="payroll-defer-installment"
              value={selectedInstallmentId}
              disabled={readOnly}
              options={[
                { value: "", label: "اختر قسطًا" },
                ...scheduledInstallments.map(({ obligation, installment }) => ({
                  value: installment.id,
                  label: `${obligation.reason} — ${money(installment.amountHalalas)} — ${installment.targetPayrollMonth}`,
                })),
              ]}
              onChange={(value) => {
                setSelectedInstallmentId(value);
                const selected = scheduledInstallments.find(({ installment }) => installment.id === value)?.installment;
                if (selected) setDeferToMonth(shiftMonth(selected.targetPayrollMonth, 1));
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-defer-target" label="شهر التحصيل الجديد">
            <DashboardMonthInputV2 id="payroll-defer-target" className="dsv2-input" value={deferToMonth} disabled={readOnly} onChange={(event) => setDeferToMonth(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-defer-reason" label="سبب التأجيل">
            <input id="payroll-defer-reason" className="dsv2-input" value={deferReason} disabled={readOnly} onChange={(event) => setDeferReason(event.target.value)} placeholder="مثال: ظرف الموظفة — بموافقة الإدارة" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-defer-note" label="ملاحظة — اختياري">
            <input id="payroll-defer-note" className="dsv2-input" value={deferNote} disabled={readOnly} onChange={(event) => setDeferNote(event.target.value)} />
          </DashboardFieldV2>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          disabled={readOnly || working || !selectedInstallmentId}
          onClick={() =>
            void run(
              async () => {
                await CoreHrService.deferPayrollObligationInstallment(selectedInstallmentId, {
                  targetPayrollMonth: deferToMonth,
                  reason: deferReason,
                  note: deferNote || null,
                });
                setSelectedInstallmentId("");
                setDeferReason("");
                setDeferNote("");
              },
              "تم تأجيل القسط مع الاحتفاظ بالحركة الأصلية وسجل القرار."
            )
          }
        >
          تأجيل القسط
        </button>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="سجل الالتزامات"
        description="السجل يوضح أصل كل التزام، المتبقي، وحالة كل قسط ومتى كان مقررًا تحصيله."
      >
        <DashboardFieldV2 id="payroll-cancel-reason" label="سبب الإلغاء — يستخدم عند الضغط على إلغاء">
          <input id="payroll-cancel-reason" className="dsv2-input" value={cancelReason} disabled={readOnly} onChange={(event) => setCancelReason(event.target.value)} placeholder="سبب الإلغاء مطلوب للتدقيق" />
        </DashboardFieldV2>
        <WorkspaceTableV2
          headers={["النوع", "المبلغ الأصلي", "الشهر الأصلي", "جدول التحصيل", "المتبقي", "الحالة", "السبب", "المصدر", "إجراء"]}
          rows={obligations.map((obligation) => [
            deductionKindLabel(obligation.obligationKind),
            money(obligation.originalAmountHalalas),
            obligation.originalPayrollMonth,
            (obligation.installments || []).length
              ? (obligation.installments || []).map((installment: CorePayrollObligationInstallment) => `${installment.targetPayrollMonth}: ${money(installment.amountHalalas)} (${installmentStatusLabel(installment.status)})`).join(" • ")
              : "لا توجد أقساط",
            money(obligation.remainingAmountHalalas),
            obligationStatusLabel(obligation.status),
            obligation.reason,
            sourceLabel(obligation.sourceType, obligation.recurringDeductionId),
            <button
              key={`${obligation.id}-cancel`}
              type="button"
              className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
              disabled={readOnly || working || !["open", "scheduled", "partially_settled"].includes(obligation.status)}
              onClick={() =>
                void run(
                  () => CoreHrService.cancelPayrollObligation(obligation.id, cancelReason),
                  "تم إلغاء الرصيد المتبقي من الالتزام مع الاحتفاظ بالسجل."
                )
              }
            >
              إلغاء المتبقي
            </button>,
          ])}
          emptyText={loading ? "جاري تحميل الالتزامات..." : "لا توجد التزامات محفوظة."}
        />
      </WorkspaceCardV2>
    </div>
  );
}
