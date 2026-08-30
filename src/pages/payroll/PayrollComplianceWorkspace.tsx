import { DashboardSelectBridgeV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import { DashboardSelectV2 } from "../../components/dashboard-v2";
import { CoreComplianceService } from "../../services/CoreComplianceService";
import { CoreHrService } from "../../services/CoreHrService";
import type { CoreHrEmployee } from "../../types/hrCoreApi";
import { formatPayrollMoney } from "../../helpers/hr/payrollCalculations";
import "../../styles/dashboard-v2/pages/payroll-compliance-workspace.css";

type Props = {
  employees: CoreHrEmployee[];
  payrollMonth: string;
  canManage: boolean;
};

type ClassificationTargetKind = "obligation" | "recurring";

const CLASS_OPTIONS = [
  { value: "employer_loan", label: "سلفة من صاحب العمل" },
  { value: "judicial_debt", label: "دين قضائي" },
  { value: "thrift_fund", label: "صندوق ادخار" },
  { value: "housing_or_benefit_installment", label: "قسط سكن/ميزة" },
  { value: "disciplinary_fine", label: "غرامة تأديبية" },
  { value: "damage_recovery", label: "استرداد ضرر" },
  { value: "other_with_written_consent", label: "خصم بموافقة خطية" },
];

function monthBounds(payrollMonth: string) {
  const [year, month] = payrollMonth.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0, 12));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

function nextMonth(payrollMonth: string) {
  const [year, month] = payrollMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function futureMonthOptions(payrollMonth: string, count = 12) {
  const options: Array<{ value: string; label: string }> = [];
  let cursor = payrollMonth;
  for (let index = 0; index < count; index += 1) {
    cursor = nextMonth(cursor);
    options.push({ value: cursor, label: cursor });
  }
  return options;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function amountHalalas(row: any) {
  return Number(
    row?.amountHalalas ??
      row?.amount_halalas ??
      row?.remainingAmountHalalas ??
      row?.remaining_amount_halalas ??
      row?.originalAmountHalalas ??
      row?.original_amount_halalas ??
      0
  ) || 0;
}

export default function PayrollComplianceWorkspace({
  employees,
  payrollMonth,
  canManage,
}: Props) {
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [obligations, setObligations] = useState<any[]>([]);
  const [recurring, setRecurring] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [installments, setInstallments] = useState<any[]>([]);
  const [carryovers, setCarryovers] = useState<any[]>([]);
  const [locks, setLocks] = useState<any[]>([]);

  const [targetKind, setTargetKind] =
    useState<ClassificationTargetKind>("obligation");
  const [targetId, setTargetId] = useState("");
  const [deductionClass, setDeductionClass] = useState("employer_loan");
  const [classificationReason, setClassificationReason] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [writtenConsentReference, setWrittenConsentReference] = useState("");
  const [courtOrderReference, setCourtOrderReference] = useState("");
  const [judicialCapBps, setJudicialCapBps] = useState("5000");

  const [courtCapBps, setCourtCapBps] = useState("6000");
  const [laborCourtReference, setLaborCourtReference] = useState("");
  const [courtOverrideReason, setCourtOverrideReason] = useState("");
  const [cancelOverrideReason, setCancelOverrideReason] = useState("");

  const [installmentId, setInstallmentId] = useState("");
  const [deferralMonth, setDeferralMonth] = useState(nextMonth(payrollMonth));
  const [deferralReason, setDeferralReason] = useState("");
  const [deferralNote, setDeferralNote] = useState("");

  const [lockReason, setLockReason] = useState("");

  const bounds = useMemo(() => monthBounds(payrollMonth), [payrollMonth]);

  useEffect(() => {
    if (!employeeId && employees.length) setEmployeeId(employees[0].id);
    if (employeeId && !employees.some((row) => row.id === employeeId)) {
      setEmployeeId(employees[0]?.id || "");
    }
  }, [employeeId, employees]);

  useEffect(() => {
    setDeferralMonth(nextMonth(payrollMonth));
  }, [payrollMonth]);

  const selectedEmployee = employees.find((row) => row.id === employeeId) || null;

  const currentTargets = targetKind === "obligation" ? obligations : recurring;

  useEffect(() => {
    if (!currentTargets.some((row) => row.id === targetId)) {
      setTargetId(currentTargets[0]?.id || "");
    }
  }, [currentTargets, targetId]);

  useEffect(() => {
    const scheduled = installments.find(
      (row) =>
        text(row.status).toLowerCase() === "scheduled" &&
        text(row.payrollMonth) === payrollMonth
    );
    if (!installments.some((row) => row.id === installmentId)) {
      setInstallmentId(scheduled?.id || "");
    }
  }, [installments, installmentId, payrollMonth]);

  const load = async () => {
    if (!employeeId) return;
    setLoading(true);
    setError("");
    try {
      const [
        obligationRows,
        recurringRows,
        eventRows,
        overrideRows,
        installmentRows,
        carryoverRows,
        lockRows,
      ] = await Promise.all([
        CoreHrService.listPayrollObligations({ employeeId }),
        CoreHrService.listPayrollRecurringDeductions({ employeeId }),
        CoreComplianceService.listPayrollDeductionClassificationEvents({ employeeId }),
        CoreComplianceService.listPayrollDeductionCourtOverrides({
          employeeId,
          payrollMonth,
        }),
        CoreHrService.listSalaryAdvanceInstallments({ employeeId, payrollMonth }),
        CoreHrService.listPayrollCarryovers({
          employeeId,
          targetPayrollMonth: payrollMonth,
        }),
        CoreHrService.listShiftPayrollPeriodLocks({
          from: bounds.start,
          to: bounds.end,
        }),
      ]);

      setObligations(obligationRows as any[]);
      setRecurring(recurringRows as any[]);
      setEvents(eventRows as any[]);
      setOverrides(overrideRows as any[]);
      setInstallments(installmentRows as any[]);
      setCarryovers(carryoverRows as any[]);
      setLocks(lockRows as any[]);
    } catch (loadError: any) {
      setError(text(loadError?.message || "تعذر تحميل أدوات الامتثال."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [employeeId, payrollMonth]);

  const submitClassification = async () => {
    if (!canManage || !targetId) return;
    if (!classificationReason.trim()) {
      setError("سبب التصنيف مطلوب.");
      return;
    }

    setBusy("classification");
    setError("");
    setMessage("");
    try {
      const input = {
        laborDeductionClass: deductionClass,
        reason: classificationReason.trim(),
        writtenConsentReference: writtenConsentReference.trim() || null,
        courtOrderReference: courtOrderReference.trim() || null,
        judicialMonthlyCapBps:
          deductionClass === "judicial_debt"
            ? Number(judicialCapBps)
            : null,
        evidenceReference: evidenceReference.trim() || null,
      };

      if (targetKind === "obligation") {
        await CoreComplianceService.classifyPayrollObligation(targetId, input);
      } else {
        await CoreComplianceService.classifyRecurringPayrollDeduction(
          targetId,
          input
        );
      }

      setMessage("تم حفظ التصنيف القانوني وسجل الحدث.");
      setClassificationReason("");
      await load();
    } catch (actionError: any) {
      setError(text(actionError?.message || "تعذر حفظ التصنيف."));
    } finally {
      setBusy("");
    }
  };

  const createCourtOverride = async () => {
    if (!canManage || !employeeId) return;
    if (!laborCourtReference.trim() || !courtOverrideReason.trim()) {
      setError("مرجع المحكمة وسبب التجاوز مطلوبان.");
      return;
    }

    setBusy("court-create");
    setError("");
    try {
      await CoreComplianceService.createPayrollDeductionCourtOverride({
        employeeId,
        payrollMonth,
        maxTotalDeductionBps: Number(courtCapBps),
        laborCourtReference: laborCourtReference.trim(),
        reason: courtOverrideReason.trim(),
      });
      setMessage("تم تسجيل سقف الخصم القضائي.");
      setLaborCourtReference("");
      setCourtOverrideReason("");
      await load();
    } catch (actionError: any) {
      setError(text(actionError?.message || "تعذر إنشاء التجاوز القضائي."));
    } finally {
      setBusy("");
    }
  };

  const cancelCourtOverride = async (id: string) => {
    if (!canManage || !cancelOverrideReason.trim()) {
      setError("سبب إلغاء التجاوز القضائي مطلوب.");
      return;
    }

    setBusy("court-cancel:" + id);
    setError("");
    try {
      await CoreComplianceService.cancelPayrollDeductionCourtOverride(
        id,
        cancelOverrideReason.trim()
      );
      setMessage("تم إلغاء التجاوز القضائي مع حفظ السبب.");
      setCancelOverrideReason("");
      await load();
    } catch (actionError: any) {
      setError(text(actionError?.message || "تعذر إلغاء التجاوز."));
    } finally {
      setBusy("");
    }
  };

  const deferAdvance = async () => {
    if (!canManage || !installmentId) return;
    if (!deferralReason.trim()) {
      setError("سبب تأجيل قسط السلفة مطلوب.");
      return;
    }

    setBusy("advance-deferral");
    setError("");
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `salary-advance-ui-${employeeId}-${Date.now()}`;

      await CoreHrService.deferSalaryAdvanceInstallment(installmentId, {
        targetPayrollMonth: deferralMonth,
        reason: deferralReason.trim(),
        note: deferralNote.trim() || null,
        idempotencyKey,
      });

      setMessage("تم تأجيل قسط السلفة وإعادة ربطه بالشهر المستهدف.");
      setDeferralReason("");
      setDeferralNote("");
      await load();
    } catch (actionError: any) {
      setError(text(actionError?.message || "تعذر تأجيل قسط السلفة."));
    } finally {
      setBusy("");
    }
  };

  const saveLock = async (status: "locked" | "unlocked") => {
    if (!canManage) return;
    if (!lockReason.trim()) {
      setError("سبب قفل/فتح الفترة مطلوب.");
      return;
    }

    setBusy("period-lock");
    setError("");
    try {
      await CoreHrService.saveShiftPayrollPeriodLock({
        periodStart: bounds.start,
        periodEnd: bounds.end,
        status,
        reason: lockReason.trim(),
      });
      setMessage(
        status === "locked"
          ? "تم قفل فترة الشفتات المرتبطة بالمسير."
          : "تم فتح فترة الشفتات مع حفظ سجل القرار."
      );
      setLockReason("");
      await load();
    } catch (actionError: any) {
      setError(text(actionError?.message || "تعذر تحديث قفل الفترة."));
    } finally {
      setBusy("");
    }
  };

  const periodLock = locks.find(
    (row) =>
      text(row.periodStart ?? row.period_start) === bounds.start &&
      text(row.periodEnd ?? row.period_end) === bounds.end
  );

  return (
    <section className="dsv2-card dsv2-card--padded payroll-compliance-workspace">
      <div className="payroll-compliance-head">
        <div>
          <span className="dsv2-badge dsv2-badge--gold">Stage 1</span>
          <h2>الامتثال والخصومات التشغيلية</h2>
          <p>
            عرض وتنفيذ قدرات Core للخصومات والسلف وإقفال الفترة بدون نقل
            قواعد العمل إلى الواجهة.
          </p>
        </div>
        <div className="payroll-compliance-toolbar">
          <DashboardSelectBridgeV2
            className="dsv2-input"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name || employee.id}
              </option>
            ))}
          </DashboardSelectBridgeV2>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "جاري التحديث..." : "تحديث"}
          </button>
        </div>
      </div>

      {error ? <div className="payroll-alert is-error">{error}</div> : null}
      {message ? <div className="payroll-alert">{message}</div> : null}

      {!selectedEmployee ? (
        <div className="payroll-alert is-readonly">لا توجد موظفة محددة.</div>
      ) : (
        <div className="payroll-compliance-grid">
          <article className="payroll-compliance-card">
            <h3>التصنيف القانوني للخصومات</h3>
            <div className="payroll-compliance-form-grid">
              <label>
                <span>نوع السجل</span>
                <DashboardSelectBridgeV2
                  className="dsv2-input"
                  value={targetKind}
                  onChange={(event) =>
                    setTargetKind(event.target.value as ClassificationTargetKind)
                  }
                >
                  <option value="obligation">التزام راتب</option>
                  <option value="recurring">خصم متكرر</option>
                </DashboardSelectBridgeV2>
              </label>
              <label>
                <span>السجل</span>
                <DashboardSelectBridgeV2
                  className="dsv2-input"
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  {currentTargets.length ? (
                    currentTargets.map((row) => (
                      <option key={row.id} value={row.id}>
                        {text(
                          row.title ||
                            row.reason ||
                            row.obligationKind ||
                            row.obligation_kind ||
                            row.id
                        )}
                        {" — "}
                        {formatPayrollMoney(amountHalalas(row))}
                      </option>
                    ))
                  ) : (
                    <option value="">لا توجد سجلات</option>
                  )}
                </DashboardSelectBridgeV2>
              </label>
              <label>
                <span>التصنيف</span>
                <DashboardSelectBridgeV2
                  className="dsv2-input"
                  value={deductionClass}
                  onChange={(event) => setDeductionClass(event.target.value)}
                >
                  {CLASS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </DashboardSelectBridgeV2>
              </label>
              <label>
                <span>مرجع الإثبات</span>
                <input
                  className="dsv2-input"
                  value={evidenceReference}
                  onChange={(event) => setEvidenceReference(event.target.value)}
                />
              </label>
              <label>
                <span>مرجع الموافقة الخطية</span>
                <input
                  className="dsv2-input"
                  value={writtenConsentReference}
                  onChange={(event) =>
                    setWrittenConsentReference(event.target.value)
                  }
                />
              </label>
              <label>
                <span>مرجع أمر المحكمة</span>
                <input
                  className="dsv2-input"
                  value={courtOrderReference}
                  onChange={(event) =>
                    setCourtOrderReference(event.target.value)
                  }
                />
              </label>
              {deductionClass === "judicial_debt" ? (
                <label>
                  <span>السقف القضائي %</span>
                  <input dir="ltr" lang="en"
                    className="dsv2-input"
                    type="number"
                    min="1"
                    max="100"
                    step="0.01"
                    value={Number(judicialCapBps) / 100}
                    onChange={(event) =>
                      setJudicialCapBps(
                        String(Math.round(Number(event.target.value) * 100))
                      )
                    }
                  />
                </label>
              ) : null}
              <label className="is-wide">
                <span>سبب التصنيف</span>
                <textarea
                  className="dsv2-input"
                  rows={3}
                  value={classificationReason}
                  onChange={(event) =>
                    setClassificationReason(event.target.value)
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={() => void submitClassification()}
              disabled={!canManage || !targetId || Boolean(busy)}
            >
              حفظ التصنيف
            </button>
          </article>

          <article className="payroll-compliance-card">
            <h3>سقف خصم بأمر المحكمة</h3>
            <div className="payroll-compliance-form-grid">
              <label>
                <span>السقف %</span>
                <input dir="ltr" lang="en"
                  className="dsv2-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={Number(courtCapBps) / 100}
                  onChange={(event) =>
                    setCourtCapBps(
                      String(Math.round(Number(event.target.value) * 100))
                    )
                  }
                />
              </label>
              <label>
                <span>مرجع المحكمة العمالية</span>
                <input
                  className="dsv2-input"
                  value={laborCourtReference}
                  onChange={(event) =>
                    setLaborCourtReference(event.target.value)
                  }
                />
              </label>
              <label className="is-wide">
                <span>السبب</span>
                <textarea
                  className="dsv2-input"
                  rows={2}
                  value={courtOverrideReason}
                  onChange={(event) =>
                    setCourtOverrideReason(event.target.value)
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={() => void createCourtOverride()}
              disabled={!canManage || Boolean(busy)}
            >
              تسجيل التجاوز
            </button>

            <div className="payroll-compliance-list">
              {overrides.map((row) => (
                <div key={row.id} className="payroll-compliance-row">
                  <div>
                    <strong>
                      {Number(row.maxTotalDeductionBps || 0) / 100}%
                    </strong>
                    <span>
                      {text(row.laborCourtReference)} · {text(row.status)}
                    </span>
                  </div>
                  {text(row.status) === "active" && canManage ? (
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--secondary"
                      onClick={() => void cancelCourtOverride(row.id)}
                      disabled={Boolean(busy)}
                    >
                      إلغاء
                    </button>
                  ) : null}
                </div>
              ))}
              {overrides.some((row) => text(row.status) === "active") ? (
                <input
                  className="dsv2-input"
                  placeholder="سبب الإلغاء قبل الضغط على إلغاء"
                  value={cancelOverrideReason}
                  onChange={(event) =>
                    setCancelOverrideReason(event.target.value)
                  }
                />
              ) : null}
            </div>
          </article>

          <article className="payroll-compliance-card">
            <h3>أقساط السلف</h3>
            <div className="payroll-compliance-list">
              {installments.map((row) => (
                <div key={row.id} className="payroll-compliance-row">
                  <div>
                    <strong>
                      قسط {Number(row.installmentNumber || 0)} ·{" "}
                      {formatPayrollMoney(Number(row.amountHalalas || 0))}
                    </strong>
                    <span>
                      {text(row.payrollMonth)} · {text(row.status)}
                    </span>
                  </div>
                </div>
              ))}
              {!installments.length ? <span>لا توجد أقساط لهذا الشهر.</span> : null}
            </div>

            <div className="payroll-compliance-form-grid">
              <label>
                <span>القسط</span>
                <DashboardSelectBridgeV2
                  className="dsv2-input"
                  value={installmentId}
                  onChange={(event) => setInstallmentId(event.target.value)}
                >
                  {installments
                    .filter(
                      (row) =>
                        text(row.status).toLowerCase() === "scheduled" &&
                        text(row.payrollMonth) === payrollMonth
                    )
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        قسط {row.installmentNumber} —{" "}
                        {formatPayrollMoney(row.amountHalalas)}
                      </option>
                    ))}
                  {!installments.some(
                    (row) =>
                      text(row.status).toLowerCase() === "scheduled" &&
                      text(row.payrollMonth) === payrollMonth
                  ) ? (
                    <option value="">لا يوجد قسط قابل للتأجيل</option>
                  ) : null}
                </DashboardSelectBridgeV2>
              </label>
              <label>
                <span>الشهر المستهدف</span>
                <DashboardSelectV2
                  value={deferralMonth}
                  options={futureMonthOptions(payrollMonth)}
                  onChange={setDeferralMonth}
                />
              </label>
              <label>
                <span>سبب التأجيل</span>
                <input
                  className="dsv2-input"
                  value={deferralReason}
                  onChange={(event) => setDeferralReason(event.target.value)}
                />
              </label>
              <label>
                <span>ملاحظة</span>
                <input
                  className="dsv2-input"
                  value={deferralNote}
                  onChange={(event) => setDeferralNote(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={() => void deferAdvance()}
              disabled={!canManage || !installmentId || Boolean(busy)}
            >
              تأجيل القسط
            </button>
          </article>

          <article className="payroll-compliance-card payroll-period-lock-card">
            <h3>حماية جداول الدوام للفترة</h3>

            <div
              className={
                "payroll-period-lock-state " +
                (text(periodLock?.status).toLowerCase() === "locked"
                  ? "is-locked"
                  : "is-open")
              }
            >
              <strong>
                {text(periodLock?.status).toLowerCase() === "locked"
                  ? "🔒 جداول الفترة محمية"
                  : "🔓 جداول الفترة قابلة للتعديل"}
              </strong>
              <span>لا يؤثر هذا القفل على تسجيل الحضور والبصمة، ولا يعني اعتماد الرواتب.</span>
            </div>

            <div className="payroll-period-lock-range">
              <span>من</span>
              <strong dir="ltr">{bounds.start}</strong>
              <span>إلى</span>
              <strong dir="ltr">{bounds.end}</strong>
            </div>

            <label className="payroll-compliance-single-field">
              <span>سبب القرار الجديد</span>
              <input
                className="dsv2-input"
                value={lockReason}
                onChange={(event) => setLockReason(event.target.value)}
                placeholder="اكتب سبب القفل أو الفتح"
              />
            </label>

            <div className="payroll-compliance-actions">
              <button
                type="button"
                className="dsv2-btn dsv2-btn--primary"
                onClick={() => void saveLock("locked")}
                disabled={
                  !canManage ||
                  Boolean(busy) ||
                  text(periodLock?.status).toLowerCase() === "locked"
                }
              >
                {text(periodLock?.status).toLowerCase() === "locked"
                  ? "الجداول محمية الآن"
                  : "قفل الفترة"}
              </button>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--secondary"
                onClick={() => void saveLock("unlocked")}
                disabled={
                  !canManage ||
                  Boolean(busy) ||
                  text(periodLock?.status).toLowerCase() !== "locked"
                }
              >
                {text(periodLock?.status).toLowerCase() === "locked"
                  ? "فتح الفترة"
                  : "الجداول مفتوحة الآن"}
              </button>
            </div>
          </article>

          <article className="payroll-compliance-card">
            <h3>Carryover Audit</h3>
            <div className="payroll-compliance-list">
              {carryovers.map((row) => (
                <div key={row.id} className="payroll-compliance-row">
                  <div>
                    <strong>
                      {formatPayrollMoney(
                        Number(
                          row.amountHalalas ??
                            row.deltaHalalas ??
                            row.adjustmentHalalas ??
                            0
                        )
                      )}
                    </strong>
                    <span>
                      {text(
                        row.sourcePayrollMonth ??
                          row.source_payroll_month ??
                          "—"
                      )}{" "}
                      →{" "}
                      {text(
                        row.targetPayrollMonth ??
                          row.target_payroll_month ??
                          payrollMonth
                      )}{" "}
                      · {text(row.status || "—")}
                    </span>
                  </div>
                </div>
              ))}
              {!carryovers.length ? <span>لا توجد تسويات مرحّلة لهذا الشهر.</span> : null}
            </div>
          </article>

          <article className="payroll-compliance-card">
            <h3>سجل التصنيفات</h3>
            <div className="payroll-compliance-list">
              {events.slice(0, 20).map((row) => (
                <div key={row.id} className="payroll-compliance-row">
                  <div>
                    <strong>
                      {text(row.previousClass || "غير مصنف")} →{" "}
                      {text(row.nextClass)}
                    </strong>
                    <span>
                      {text(row.reason)} · {text(row.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!events.length ? <span>لا يوجد سجل تصنيف بعد.</span> : null}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
