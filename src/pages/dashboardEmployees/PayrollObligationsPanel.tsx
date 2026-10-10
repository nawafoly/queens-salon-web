import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { DashboardMonthInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import { useEmployeeLanguage } from "./employeeLanguage";
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

type DeductionComplianceDraft = {
  laborDeductionClass: string;
  evidenceReference: string;
  writtenConsentReference: string;
  courtOrderReference: string;
};

type CreationFormErrors = Record<string, string>;

const DEDUCTION_CLASS_OPTIONS = [
  {
    value: "employer_loan",
    label: "سلفة من صاحب العمل",
    labelEn: "Employer loan / salary advance",
  },
  {
    value: "judicial_debt",
    label: "دين قضائي",
    labelEn: "Judicial debt",
  },
  {
    value: "thrift_fund",
    label: "صندوق ادخار",
    labelEn: "Thrift fund",
  },
  {
    value: "housing_or_benefit_installment",
    label: "قسط سكن / ميزة",
    labelEn: "Housing or benefit installment",
  },
  {
    value: "disciplinary_fine",
    label: "غرامة تأديبية",
    labelEn: "Disciplinary fine",
  },
  {
    value: "damage_recovery",
    label: "استرداد ضرر",
    labelEn: "Damage recovery",
  },
  {
    value: "other_with_written_consent",
    label: "خصم بموافقة خطية",
    labelEn: "Deduction with written consent",
  },
] as const;

const EVIDENCE_REQUIRED_CLASSES = new Set([
  "employer_loan",
  "thrift_fund",
  "housing_or_benefit_installment",
  "disciplinary_fine",
  "damage_recovery",
]);

function emptyDeductionComplianceDraft(): DeductionComplianceDraft {
  return {
    laborDeductionClass: "",
    evidenceReference: "",
    writtenConsentReference: "",
    courtOrderReference: "",
  };
}

function requiresEvidenceReference(value: unknown) {
  return EVIDENCE_REQUIRED_CLASSES.has(String(value || "").trim());
}

function complianceValidationErrors(
  draft: DeductionComplianceDraft
): CreationFormErrors {
  const errors: CreationFormErrors = {};
  const deductionClass = String(
    draft.laborDeductionClass || ""
  ).trim();

  if (!deductionClass) {
    errors.laborDeductionClass =
      "اختر التصنيف النظامي للخصم.";
    return errors;
  }

  if (
    requiresEvidenceReference(deductionClass) &&
    !String(draft.evidenceReference || "").trim()
  ) {
    errors.evidenceReference =
      "أدخل رقم أو مرجع المستند المؤيد لهذا الخصم.";
  }

  if (
    deductionClass === "other_with_written_consent" &&
    !String(draft.writtenConsentReference || "").trim()
  ) {
    errors.writtenConsentReference =
      "أدخل مرجع الموافقة الخطية.";
  }

  if (
    deductionClass === "judicial_debt" &&
    !String(draft.courtOrderReference || "").trim()
  ) {
    errors.courtOrderReference =
      "أدخل مرجع الأمر أو الحكم القضائي.";
  }

  return errors;
}

function compliancePayload(
  draft: DeductionComplianceDraft,
  reason: string
) {
  return {
    laborDeductionClass:
      String(draft.laborDeductionClass || "").trim(),
    evidenceReference:
      String(draft.evidenceReference || "").trim() || null,
    writtenConsentReference:
      String(draft.writtenConsentReference || "").trim() || null,
    courtOrderReference:
      String(draft.courtOrderReference || "").trim() || null,
    complianceClassificationReason:
      String(reason || "").trim(),
  };
}

function focusFirstInvalidForm(selector: string) {
  window.requestAnimationFrame(() => {
    const field = document.querySelector<HTMLElement>(
      `${selector} [aria-invalid="true"]`
    );

    if (!field) return;

    field.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    field.focus?.();
  });
}

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

function money(value: unknown, language: "ar" | "en" = "ar") {
  return `${fromHalalas(value).toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn", { maximumFractionDigits: 2 })} ${language === "en" ? "SAR" : "ر.س"}`;
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
    deduction_legal_class_required: "اختر التصنيف النظامي للخصم قبل الحفظ.",
    obligation_deduction_class_required: "اختر التصنيف النظامي للالتزام قبل الحفظ.",
    deduction_class_not_user_assignable: "التصنيف المختار غير مسموح للإدخال اليدوي.",
    deduction_evidence_reference_required: "هذا التصنيف يحتاج مستندًا أو مرجع إثبات.",
    written_consent_reference_required: "هذا الخصم يحتاج مرجع الموافقة الخطية.",
    court_order_reference_required: "الدين القضائي يحتاج مرجع الأمر أو الحكم القضائي.",
    deduction_classification_reason_required: "سبب الخصم مطلوب لتسجيل التصنيف النظامي.",
    judicial_monthly_cap_invalid: "حد الخصم القضائي غير صالح.",
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
  const { language, t, tr } = useEmployeeLanguage();
  const formatMoney = (value: unknown) => money(value, language);
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
  const [recurringCompliance, setRecurringCompliance] =
    useState<DeductionComplianceDraft>(
      emptyDeductionComplianceDraft
    );
  const [recurringErrors, setRecurringErrors] =
    useState<CreationFormErrors>({});

  const [obligationKind, setObligationKind] = useState("manual");
  const [obligationAmount, setObligationAmount] = useState("");
  const [obligationOriginalMonth, setObligationOriginalMonth] = useState(month);
  const [collectionMode, setCollectionMode] = useState<CollectionMode>("current");
  const [deferredTargetMonth, setDeferredTargetMonth] = useState(shiftMonth(month, 1));
  const [obligationReason, setObligationReason] = useState("");
  const [obligationNote, setObligationNote] = useState("");
  const [obligationSourceRef, setObligationSourceRef] = useState(() => newOperationId());
  const [obligationCompliance, setObligationCompliance] =
    useState<DeductionComplianceDraft>(
      emptyDeductionComplianceDraft
    );
  const [obligationErrors, setObligationErrors] =
    useState<CreationFormErrors>({});
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
    setRecurringCompliance(
      emptyDeductionComplianceDraft()
    );
    setRecurringErrors({});
    setObligationKind("manual");
    setObligationAmount("");
    setObligationOriginalMonth(month);
    setCollectionMode("current");
    setDeferredTargetMonth(shiftMonth(month, 1));
    setObligationReason("");
    setObligationNote("");
    setObligationSourceRef(newOperationId());
    setObligationCompliance(
      emptyDeductionComplianceDraft()
    );
    setObligationErrors({});
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
    setRecurringCompliance(
      emptyDeductionComplianceDraft()
    );
    setRecurringErrors({});
  }

  function resetObligationForm() {
    setObligationAmount("");
    setObligationReason("");
    setObligationNote("");
    setCollectionMode("current");
    setDeferredTargetMonth(shiftMonth(month, 1));
    setObligationSourceRef(newOperationId());
    setObligationCompliance(
      emptyDeductionComplianceDraft()
    );
    setObligationErrors({});
    setInstallmentDrafts(buildEvenInstallments(month, 0, 3));
  }

  async function submitRecurringDeduction() {
    if (readOnly || working) return;

    const nextErrors: CreationFormErrors = {};

    if (!cleanText(recurringTitle)) {
      nextErrors.title = "اكتب اسم الخصم.";
    }

    if (toHalalas(recurringAmount) <= 0) {
      nextErrors.amount =
        "أدخل مبلغًا شهريًا أكبر من صفر.";
    }

    if (!validMonth(recurringStartMonth)) {
      nextErrors.startMonth =
        "اختر شهر بداية صحيحًا.";
    }

    if (
      cleanText(recurringEndMonth) &&
      (
        !validMonth(recurringEndMonth) ||
        recurringEndMonth < recurringStartMonth
      )
    ) {
      nextErrors.endMonth =
        "شهر النهاية يجب ألا يكون قبل شهر البداية.";
    }

    if (!cleanText(recurringReason)) {
      nextErrors.reason =
        "اكتب سبب الخصم أو أساسه المالي.";
    }

    Object.assign(
      nextErrors,
      complianceValidationErrors(recurringCompliance)
    );

    if (Object.keys(nextErrors).length > 0) {
      nextErrors.form =
        "أكمل الحقول المطلوبة الموضحة باللون الأحمر ثم أعد المحاولة.";
      setRecurringErrors(nextErrors);
      setError("");
      setMessage("");
      focusFirstInvalidForm(
        '[data-payroll-recurring-form="true"]'
      );
      return;
    }

    setRecurringErrors({});

    await run(
      async () => {
        await CoreHrService.savePayrollRecurringDeduction({
          employeeId,
          title: recurringTitle.trim(),
          deductionKind: recurringKind,
          amountHalalas: toHalalas(recurringAmount),
          startPayrollMonth: recurringStartMonth,
          endPayrollMonth: recurringEndMonth || null,
          reason: recurringReason.trim(),
          note: recurringNote.trim() || null,
          status: "active",
          ...compliancePayload(
            recurringCompliance,
            recurringReason
          ),
        });

        resetRecurringForm();
      },
      tr(
        "تم حفظ الخصم الثابت.",
        "Recurring deduction saved."
      )
    );
  }

  async function submitOneTimeObligation() {
    if (readOnly || working) return;

    const nextErrors: CreationFormErrors = {};

    if (toHalalas(obligationAmount) <= 0) {
      nextErrors.amount =
        "أدخل إجمالي مبلغ أكبر من صفر.";
    }

    if (!validMonth(obligationOriginalMonth)) {
      nextErrors.originalMonth =
        "اختر شهر نشوء صحيحًا.";
    }

    if (!cleanText(obligationReason)) {
      nextErrors.reason =
        "اكتب سبب الخصم أو أساسه المالي.";
    }

    if (
      collectionMode === "defer" &&
      (
        !validMonth(deferredTargetMonth) ||
        deferredTargetMonth <= obligationOriginalMonth
      )
    ) {
      nextErrors.targetMonth =
        "شهر التحصيل الجديد يجب أن يكون بعد شهر نشوء الالتزام.";
    }

    if (collectionMode === "installments") {
      const invalidInstallment = installmentDrafts.find(
        (draft) =>
          !validMonth(draft.targetPayrollMonth) ||
          draft.targetPayrollMonth <= obligationOriginalMonth ||
          toHalalas(draft.amount) <= 0
      );

      if (invalidInstallment) {
        nextErrors.amount =
          "راجع جدول الأقساط: كل قسط يحتاج شهرًا لاحقًا ومبلغًا أكبر من صفر.";
      } else if (
        installmentTotalHalalas !== obligationTotalHalalas
      ) {
        nextErrors.amount =
          "مجموع الأقساط يجب أن يساوي إجمالي الالتزام تمامًا.";
      }
    }

    Object.assign(
      nextErrors,
      complianceValidationErrors(obligationCompliance)
    );

    if (Object.keys(nextErrors).length > 0) {
      nextErrors.form =
        "أكمل الحقول المطلوبة الموضحة باللون الأحمر ثم أعد المحاولة.";
      setObligationErrors(nextErrors);
      setError("");
      setMessage("");
      focusFirstInvalidForm(
        '[data-payroll-obligation-form="true"]'
      );
      return;
    }

    setObligationErrors({});

    await run(
      async () => {
        const payload: Record<string, unknown> = {
          employeeId,
          kind: obligationKind,
          amountHalalas: toHalalas(obligationAmount),
          originalPayrollMonth: obligationOriginalMonth,
          reason: obligationReason.trim(),
          note: obligationNote.trim() || null,
          sourceType: "employee_profile",
          sourceRef: obligationSourceRef,
          ...compliancePayload(
            obligationCompliance,
            obligationReason
          ),
        };

        if (collectionMode === "defer") {
          payload.targetPayrollMonth =
            deferredTargetMonth;
        }

        if (collectionMode === "installments") {
          payload.installments = installmentDrafts.map(
            (draft) => ({
              targetPayrollMonth:
                draft.targetPayrollMonth,
              amountHalalas: toHalalas(draft.amount),
            })
          );
        }

        await CoreHrService.createPayrollObligation(
          payload
        );

        resetObligationForm();
      },
      collectionMode === "current"
        ? tr(
            "تم إنشاء الخصم لهذا الشهر.",
            "Deduction created for this month."
          )
        : collectionMode === "defer"
          ? tr(
              "تم إنشاء الالتزام وتأجيل تحصيله.",
              "Obligation created and collection deferred."
            )
          : tr(
              "تم إنشاء الالتزام وجدول الأقساط.",
              "Obligation and installment schedule created."
            )
    );
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
          <WorkspaceMetricV2 label={tr(`المستحق للتحصيل — ${month}`, `Due for collection — ${month}`)} value={formatMoney(currentMonthTotalHalalas)} tone={currentMonthTotalHalalas > 0 ? "gold" : "success"} />
          <WorkspaceMetricV2 label="مؤجل من أشهر سابقة" value={formatMoney(deferredFromPriorMonthsHalalas)} tone={deferredFromPriorMonthsHalalas > 0 ? "gold" : "neutral"} />
          <WorkspaceMetricV2 label="الأقساط القادمة" value={formatMoney(upcomingInstallmentsHalalas)} />
          <WorkspaceMetricV2 label="إجمالي الالتزامات المفتوحة" value={formatMoney(openObligationsHalalas)} tone={openObligationsHalalas > 0 ? "gold" : "success"} />
        </div>

        <WorkspaceNoticeV2
          title="فصل مالي صريح"
          description="هذه الخصومات الإدارية مستقلة عن GOSI وعن Carryover. خصم GOSI النظامي لا يقبل التأجيل أو التقسيط هنا، وCarryover يبقى فقط لتصحيح فروقات اكتشفت بعد اعتماد المسير."
          tone="neutral"
        />

        {error ? <WorkspaceNoticeV2 title={t("تعذر تنفيذ العملية")} description={t(error)} tone="danger" /> : null}
        {message ? <WorkspaceNoticeV2 title={tr("تم", "Completed")} description={t(message)} tone="success" /> : null}
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="المستحق في هذا الشهر"
        description="هذه هي البنود التي سيدخلها مسير الرواتب Draft لهذا الشهر. البنود المرحّلة تظهر في شهر التحصيل الجديد مع الاحتفاظ بالشهر الأصلي."
      >
        <WorkspaceTableV2
          headers={["البند", "المبلغ", "النوع", "شهر الأصل", "شهر التحصيل", "السبب", "المصدر"]}
          rows={collectibleRows.map((row) => [
            row.label || row.reason || tr("خصم", "Deduction"),
            formatMoney(row.amountHalalas),
            t(deductionKindLabel(row.obligationKind)),
            row.originalPayrollMonth || "-",
            row.targetPayrollMonth || "-",
            row.reason || "-",
            row.recurringDeductionId ? tr("خصم ثابت", "Recurring deduction") : row.synthetic ? tr("متوقع / قبل الحفظ", "Expected / before save") : tr("التزام محفوظ", "Saved obligation"),
          ])}
          emptyText={loading ? "جاري تحميل الخصومات..." : "لا توجد خصومات أو التزامات مستحقة للتحصيل في هذا الشهر."}
        />
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="خصم ثابت متكرر"
        description="ينشئ بندًا شهريًا متوقعًا من شهر البداية إلى شهر النهاية إن وجد. لا يتم إنشاء حركة تحصيل فعلية إلا عند بناء/حفظ مسير الشهر."
      >
        <div
          className="dsv2-ew-form-grid dsv2-ew-form-grid--3"
          data-payroll-recurring-form="true"
        >
          <DashboardFieldV2
            id="payroll-recurring-title"
            label={t("اسم الخصم")}
            required
            error={recurringErrors.title}
          >
            <input id="payroll-recurring-title" className="dsv2-input" value={recurringTitle} disabled={readOnly} onChange={(event) => setRecurringTitle(event.target.value)} placeholder={t("مثال: خصم اشتراك شهري")} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-recurring-kind" label={t("نوع الخصم")}>
            <DashboardSelectV2 id="payroll-recurring-kind" value={recurringKind} disabled={readOnly} options={DEDUCTION_KIND_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onChange={setRecurringKind} />
          </DashboardFieldV2>
          <DashboardFieldV2
            id="payroll-recurring-amount"
            label={t("المبلغ الشهري (ر.س)")}
            required
            error={recurringErrors.amount}
          >
            <DashboardNumberInputV2 id="payroll-recurring-amount" className="dsv2-input" min="0" step="0.01" value={recurringAmount} disabled={readOnly} onChange={(event) => setRecurringAmount(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2
            id="payroll-recurring-start"
            label={t("شهر البداية")}
            required
            error={recurringErrors.startMonth}
          >
            <DashboardMonthInputV2 id="payroll-recurring-start" className="dsv2-input" value={recurringStartMonth} disabled={readOnly} onChange={(event) => setRecurringStartMonth(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2
            id="payroll-recurring-end"
            label={t("شهر النهاية — اختياري")}
            error={recurringErrors.endMonth}
          >
            <DashboardMonthInputV2 id="payroll-recurring-end" className="dsv2-input" value={recurringEndMonth} disabled={readOnly} onChange={(event) => setRecurringEndMonth(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2
            id="payroll-recurring-reason"
            label={t("السبب / الأساس")}
            required
            error={recurringErrors.reason}
          >
            <input id="payroll-recurring-reason" className="dsv2-input" value={recurringReason} disabled={readOnly} onChange={(event) => setRecurringReason(event.target.value)} placeholder={t("لماذا يوجد هذا الخصم؟")} />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="payroll-recurring-legal-class"
            label={tr("التصنيف النظامي", "Legal classification")}
            required
            error={recurringErrors.laborDeductionClass}
            hint={tr(
              "حدد الأساس النظامي الحقيقي للخصم.",
              "Select the actual legal basis for the deduction."
            )}
          >
            <DashboardSelectV2
              id="payroll-recurring-legal-class"
              value={recurringCompliance.laborDeductionClass}
              disabled={readOnly}
              options={[
                {
                  value: "",
                  label: tr(
                    "اختر التصنيف النظامي",
                    "Choose legal classification"
                  ),
                },
                ...DEDUCTION_CLASS_OPTIONS.map((option) => ({
                  value: option.value,
                  label:
                    language === "en"
                      ? option.labelEn
                      : option.label,
                })),
              ]}
              onChange={(value) =>
                setRecurringCompliance((current) => ({
                  ...current,
                  laborDeductionClass: value,
                }))
              }
            />
          </DashboardFieldV2>

          {requiresEvidenceReference(
            recurringCompliance.laborDeductionClass
          ) ? (
            <DashboardFieldV2
              id="payroll-recurring-evidence"
              label={tr(
                "مرجع المستند / الإثبات",
                "Evidence reference"
              )}
              required
              error={recurringErrors.evidenceReference}
            >
              <input
                id="payroll-recurring-evidence"
                className="dsv2-input"
                value={recurringCompliance.evidenceReference}
                disabled={readOnly}
                onChange={(event) =>
                  setRecurringCompliance((current) => ({
                    ...current,
                    evidenceReference: event.target.value,
                  }))
                }
                placeholder={tr(
                  "مثال: رقم السلفة أو المستند",
                  "Example: loan or document reference"
                )}
              />
            </DashboardFieldV2>
          ) : null}

          {recurringCompliance.laborDeductionClass ===
          "other_with_written_consent" ? (
            <DashboardFieldV2
              id="payroll-recurring-consent"
              label={tr(
                "مرجع الموافقة الخطية",
                "Written consent reference"
              )}
              required
              error={recurringErrors.writtenConsentReference}
            >
              <input
                id="payroll-recurring-consent"
                className="dsv2-input"
                value={recurringCompliance.writtenConsentReference}
                disabled={readOnly}
                onChange={(event) =>
                  setRecurringCompliance((current) => ({
                    ...current,
                    writtenConsentReference: event.target.value,
                  }))
                }
              />
            </DashboardFieldV2>
          ) : null}

          {recurringCompliance.laborDeductionClass ===
          "judicial_debt" ? (
            <DashboardFieldV2
              id="payroll-recurring-court-order"
              label={tr(
                "مرجع الأمر / الحكم القضائي",
                "Court order reference"
              )}
              required
              error={recurringErrors.courtOrderReference}
            >
              <input
                id="payroll-recurring-court-order"
                className="dsv2-input"
                value={recurringCompliance.courtOrderReference}
                disabled={readOnly}
                onChange={(event) =>
                  setRecurringCompliance((current) => ({
                    ...current,
                    courtOrderReference: event.target.value,
                  }))
                }
              />
            </DashboardFieldV2>
          ) : null}

          <DashboardFieldV2 id="payroll-recurring-note" label={t("ملاحظة — اختياري")}>
            <input id="payroll-recurring-note" className="dsv2-input" value={recurringNote} disabled={readOnly} onChange={(event) => setRecurringNote(event.target.value)} />
          </DashboardFieldV2>
        </div>

        {recurringErrors.form ? (
          <WorkspaceNoticeV2
            title={tr(
              "بيانات الخصم غير مكتملة",
              "Deduction details are incomplete"
            )}
            description={recurringErrors.form}
            tone="danger"
          />
        ) : null}

        <div className="dsv2-cluster">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            disabled={readOnly || working}
            onClick={() =>
              void submitRecurringDeduction()
            }
          >
            حفظ الخصم الثابت
          </button>
        </div>

        <WorkspaceTableV2
          headers={["الاسم", "المبلغ", "النوع", "من", "إلى", "الحالة", "السبب", "إجراء"]}
          rows={recurringRows.map((row) => [
            row.title,
            formatMoney(row.amountHalalas),
            t(deductionKindLabel(row.deductionKind)),
            row.startPayrollMonth,
            row.endPayrollMonth || tr("مستمر", "Ongoing"),
            <WorkspaceStatusBadgeV2 key={`${row.id}-status`} tone={row.status === "active" ? "success" : "gold"}>{row.status === "active" ? t("نشط") : row.status === "paused" ? tr("موقوف", "Paused") : row.status}</WorkspaceStatusBadgeV2>,
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
                  row.status === "active" ? tr("تم إيقاف الخصم الثابت.", "Recurring deduction paused.") : tr("تم تفعيل الخصم الثابت.", "Recurring deduction activated.")
                )
              }
            >
              {row.status === "active" ? tr("إيقاف", "Pause") : tr("تفعيل", "Activate")}
            </button>,
          ])}
          emptyText="لا توجد خصومات ثابتة محفوظة."
        />
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="التزام أو خصم لمرة واحدة"
        description="سجّل أصل المبلغ أولًا، ثم اختر تحصيله في شهر الأصل أو تأجيله إلى شهر لاحق أو تقسيمه على عدة أشهر."
      >
        <div
          className="dsv2-ew-form-grid dsv2-ew-form-grid--3"
          data-payroll-obligation-form="true"
        >
          <DashboardFieldV2 id="payroll-obligation-kind" label={t("نوع الالتزام")}>
            <DashboardSelectV2 id="payroll-obligation-kind" value={obligationKind} disabled={readOnly} options={DEDUCTION_KIND_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onChange={setObligationKind} />
          </DashboardFieldV2>
          <DashboardFieldV2
            id="payroll-obligation-amount"
            label={t("إجمالي المبلغ (ر.س)")}
            required
            error={obligationErrors.amount}
          >
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
          <DashboardFieldV2
            id="payroll-obligation-original-month"
            label={t("شهر نشوء الالتزام")}
            required
            error={obligationErrors.originalMonth}
          >
            <DashboardMonthInputV2 id="payroll-obligation-original-month" className="dsv2-input" value={obligationOriginalMonth} disabled={readOnly} onChange={(event) => { const nextMonth = event.target.value; setObligationOriginalMonth(nextMonth); if (collectionMode === "installments") { setInstallmentDrafts((rows) => buildEvenInstallments( nextMonth || month, toHalalas(obligationAmount), rows.length || 1 ) ); } }} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-obligation-mode" label={t("طريقة التحصيل")}>
            <DashboardSelectV2
              id="payroll-obligation-mode"
              value={collectionMode}
              disabled={readOnly}
              options={[
                { value: "current", label: tr("تحصيل في شهر الأصل", "Collect in original month") },
                { value: "defer", label: tr("تأجيل إلى شهر محدد", "Defer to a specific month") },
                { value: "installments", label: tr("تقسيط على عدة أشهر", "Split into installments") },
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
            <DashboardFieldV2
              id="payroll-obligation-target-month"
              label={t("شهر التحصيل الجديد")}
              required
              error={obligationErrors.targetMonth}
            >
              <DashboardMonthInputV2 id="payroll-obligation-target-month" className="dsv2-input" value={deferredTargetMonth} disabled={readOnly} onChange={(event) => setDeferredTargetMonth(event.target.value)} />
            </DashboardFieldV2>
          ) : null}
          <DashboardFieldV2
            id="payroll-obligation-reason"
            label={collectionMode === "defer" ? t("سبب الخصم / قرار التأجيل") : collectionMode === "installments" ? t("سبب الخصم / قرار التقسيط") : t("السبب / الأساس")}
            required
            error={obligationErrors.reason}
          >
            <input id="payroll-obligation-reason" className="dsv2-input" value={obligationReason} disabled={readOnly} onChange={(event) => setObligationReason(event.target.value)} placeholder={t("سبب مالي واضح وقابل للمراجعة")} />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="payroll-obligation-legal-class"
            label={tr("التصنيف النظامي", "Legal classification")}
            required
            error={obligationErrors.laborDeductionClass}
            hint={tr(
              "حدد الأساس النظامي الحقيقي للخصم.",
              "Select the actual legal basis for the deduction."
            )}
          >
            <DashboardSelectV2
              id="payroll-obligation-legal-class"
              value={obligationCompliance.laborDeductionClass}
              disabled={readOnly}
              options={[
                {
                  value: "",
                  label: tr(
                    "اختر التصنيف النظامي",
                    "Choose legal classification"
                  ),
                },
                ...DEDUCTION_CLASS_OPTIONS.map((option) => ({
                  value: option.value,
                  label:
                    language === "en"
                      ? option.labelEn
                      : option.label,
                })),
              ]}
              onChange={(value) =>
                setObligationCompliance((current) => ({
                  ...current,
                  laborDeductionClass: value,
                }))
              }
            />
          </DashboardFieldV2>

          {requiresEvidenceReference(
            obligationCompliance.laborDeductionClass
          ) ? (
            <DashboardFieldV2
              id="payroll-obligation-evidence"
              label={tr(
                "مرجع المستند / الإثبات",
                "Evidence reference"
              )}
              required
              error={obligationErrors.evidenceReference}
            >
              <input
                id="payroll-obligation-evidence"
                className="dsv2-input"
                value={obligationCompliance.evidenceReference}
                disabled={readOnly}
                onChange={(event) =>
                  setObligationCompliance((current) => ({
                    ...current,
                    evidenceReference: event.target.value,
                  }))
                }
                placeholder={tr(
                  "مثال: رقم السلفة أو المستند",
                  "Example: loan or document reference"
                )}
              />
            </DashboardFieldV2>
          ) : null}

          {obligationCompliance.laborDeductionClass ===
          "other_with_written_consent" ? (
            <DashboardFieldV2
              id="payroll-obligation-consent"
              label={tr(
                "مرجع الموافقة الخطية",
                "Written consent reference"
              )}
              required
              error={obligationErrors.writtenConsentReference}
            >
              <input
                id="payroll-obligation-consent"
                className="dsv2-input"
                value={obligationCompliance.writtenConsentReference}
                disabled={readOnly}
                onChange={(event) =>
                  setObligationCompliance((current) => ({
                    ...current,
                    writtenConsentReference: event.target.value,
                  }))
                }
              />
            </DashboardFieldV2>
          ) : null}

          {obligationCompliance.laborDeductionClass ===
          "judicial_debt" ? (
            <DashboardFieldV2
              id="payroll-obligation-court-order"
              label={tr(
                "مرجع الأمر / الحكم القضائي",
                "Court order reference"
              )}
              required
              error={obligationErrors.courtOrderReference}
            >
              <input
                id="payroll-obligation-court-order"
                className="dsv2-input"
                value={obligationCompliance.courtOrderReference}
                disabled={readOnly}
                onChange={(event) =>
                  setObligationCompliance((current) => ({
                    ...current,
                    courtOrderReference: event.target.value,
                  }))
                }
              />
            </DashboardFieldV2>
          ) : null}

          <DashboardFieldV2 id="payroll-obligation-note" label={t("ملاحظة — اختياري")}>
            <input id="payroll-obligation-note" className="dsv2-input" value={obligationNote} disabled={readOnly} onChange={(event) => setObligationNote(event.target.value)} />
          </DashboardFieldV2>
        </div>

        {obligationErrors.form ? (
          <WorkspaceNoticeV2
            title={tr(
              "بيانات الالتزام غير مكتملة",
              "Obligation details are incomplete"
            )}
            description={obligationErrors.form}
            tone="danger"
          />
        ) : null}

        {collectionMode === "installments" ? (
          <div className="dsv2-ew-stack">
            <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
              <DashboardFieldV2 id="payroll-installment-count" label={t("عدد الأقساط")}>
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
              <DashboardFieldV2 id="payroll-installment-average" label={t("متوسط قيمة القسط")}>
                <input
                  id="payroll-installment-average"
                  className="dsv2-input"
                  readOnly
                  value={formatMoney(installmentDrafts.length ? Math.round(obligationTotalHalalas / installmentDrafts.length) : 0)}
                />
              </DashboardFieldV2>
              <div className="dsv2-field">
                <span className="dsv2-field__label">{tr("توزيع تلقائي", "Automatic distribution")}</span>
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
              description={tr(`الإجمالي: ${formatMoney(obligationTotalHalalas)} — مجموع الأقساط: ${formatMoney(installmentTotalHalalas)}${installmentDifferenceHalalas === 0 ? " — التوزيع متوازن." : ` — الفرق: ${formatMoney(Math.abs(installmentDifferenceHalalas))}.`}`, `Total: ${formatMoney(obligationTotalHalalas)} — Installments: ${formatMoney(installmentTotalHalalas)}${installmentDifferenceHalalas === 0 ? " — balanced distribution." : ` — difference: ${formatMoney(Math.abs(installmentDifferenceHalalas))}.`}`)}
              tone={obligationTotalHalalas > 0 && installmentDifferenceHalalas === 0 ? "success" : "gold"}
            />
            {installmentDrafts.map((draft, index) => (
              <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3" key={`installment-${index}`}>
                <DashboardFieldV2 id={`payroll-installment-month-${index}`} label={tr(`شهر القسط ${index + 1}`, `Installment month ${index + 1}`)}>
                  <DashboardMonthInputV2 id={`payroll-installment-month-${index}`} className="dsv2-input" value={draft.targetPayrollMonth} disabled={readOnly} onChange={(event) => setInstallmentDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, targetPayrollMonth: event.target.value } : row))} />
                </DashboardFieldV2>
                <DashboardFieldV2 id={`payroll-installment-amount-${index}`} label={t("مبلغ القسط (ر.س)")}>
                  <DashboardNumberInputV2 id={`payroll-installment-amount-${index}`} className="dsv2-input" min="0" step="0.01" value={draft.amount} disabled={readOnly} onChange={(event) => setInstallmentDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} />
                </DashboardFieldV2>
                <div className="dsv2-field">
                  <span className="dsv2-field__label">{t("إجراء")}</span>
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly || installmentDrafts.length <= 1} onClick={() => setInstallmentDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>{tr("حذف القسط", "Delete installment")}</button>
                </div>
              </div>
            ))}
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => setInstallmentDrafts((rows) => [...rows, { targetPayrollMonth: shiftMonth(obligationOriginalMonth || month, rows.length + 1), amount: "" }])}>{tr("إضافة قسط", "Add installment")}</button>
          </div>
        ) : null}

        <div className="dsv2-cluster">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            disabled={readOnly || working}
            onClick={() =>
              void submitOneTimeObligation()
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
          <DashboardFieldV2 id="payroll-defer-installment" label={t("القسط")}>
            <DashboardSelectV2
              id="payroll-defer-installment"
              value={selectedInstallmentId}
              disabled={readOnly}
              options={[
                { value: "", label: tr("اختر قسطًا", "Choose installment") },
                ...scheduledInstallments.map(({ obligation, installment }) => ({
                  value: installment.id,
                  label: `${obligation.reason} — ${formatMoney(installment.amountHalalas)} — ${installment.targetPayrollMonth}`,
                })),
              ]}
              onChange={(value) => {
                setSelectedInstallmentId(value);
                const selected = scheduledInstallments.find(({ installment }) => installment.id === value)?.installment;
                if (selected) setDeferToMonth(shiftMonth(selected.targetPayrollMonth, 1));
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-defer-target" label={t("شهر التحصيل الجديد")}>
            <DashboardMonthInputV2 id="payroll-defer-target" className="dsv2-input" value={deferToMonth} disabled={readOnly} onChange={(event) => setDeferToMonth(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-defer-reason" label={t("سبب التأجيل")}>
            <input id="payroll-defer-reason" className="dsv2-input" value={deferReason} disabled={readOnly} onChange={(event) => setDeferReason(event.target.value)} placeholder={t("مثال: ظرف الموظفة — بموافقة الإدارة")} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="payroll-defer-note" label={t("ملاحظة — اختياري")}>
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
              tr("تم تأجيل القسط مع الاحتفاظ بالحركة الأصلية وسجل القرار.", "Installment deferred while preserving the original transaction and decision history.")
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
        <DashboardFieldV2 id="payroll-cancel-reason" label={t("سبب الإلغاء — يستخدم عند الضغط على إلغاء")}>
          <input id="payroll-cancel-reason" className="dsv2-input" value={cancelReason} disabled={readOnly} onChange={(event) => setCancelReason(event.target.value)} placeholder={t("سبب الإلغاء مطلوب للتدقيق")} />
        </DashboardFieldV2>
        <WorkspaceTableV2
          headers={["النوع", "المبلغ الأصلي", "الشهر الأصلي", "جدول التحصيل", "المتبقي", "الحالة", "السبب", "المصدر", "إجراء"]}
          rows={obligations.map((obligation) => [
            t(deductionKindLabel(obligation.obligationKind)),
            formatMoney(obligation.originalAmountHalalas),
            obligation.originalPayrollMonth,
            (obligation.installments || []).length
              ? (obligation.installments || []).map((installment: CorePayrollObligationInstallment) => `${installment.targetPayrollMonth}: ${formatMoney(installment.amountHalalas)} (${t(installmentStatusLabel(installment.status))})`).join(" • ")
              : tr("لا توجد أقساط", "No installments"),
            formatMoney(obligation.remainingAmountHalalas),
            t(obligationStatusLabel(obligation.status)),
            obligation.reason,
            t(sourceLabel(obligation.sourceType, obligation.recurringDeductionId)),
            <button
              key={`${obligation.id}-cancel`}
              type="button"
              className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
              disabled={readOnly || working || !["open", "scheduled", "partially_settled"].includes(obligation.status)}
              onClick={() =>
                void run(
                  () => CoreHrService.cancelPayrollObligation(obligation.id, cancelReason),
                  tr("تم إلغاء الرصيد المتبقي من الالتزام مع الاحتفاظ بالسجل.", "Remaining obligation balance cancelled while preserving the history.")
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
