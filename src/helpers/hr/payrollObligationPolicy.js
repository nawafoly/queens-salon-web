export const PAYROLL_OBLIGATION_STATUSES = Object.freeze({
  OPEN: "open",
  SCHEDULED: "scheduled",
  PARTIALLY_SETTLED: "partially_settled",
  SETTLED: "settled",
  CANCELLED: "cancelled",
});

export const PAYROLL_INSTALLMENT_STATUSES = Object.freeze({
  SCHEDULED: "scheduled",
  APPLIED: "applied",
  DEFERRED: "deferred",
  CANCELLED: "cancelled",
});

const NON_DEFERRABLE_KINDS = new Set([
  "gosi",
  "statutory_gosi",
  "statutory",
  "social_insurance",
  "social_insurance_gosi",
  "pension",
  "saned",
]);

function money(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

export function normalizePayrollMonth(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new Error("payroll_month_invalid");
  return text;
}

export function assertDeferrableDeductionKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!normalized) throw new Error("deduction_kind_required");
  if (NON_DEFERRABLE_KINDS.has(normalized)) throw new Error("statutory_deduction_not_deferrable");
  return normalized;
}

function requireReason(value) {
  const reason = String(value || "").trim();
  if (!reason) throw new Error("deduction_reason_required");
  return reason;
}

function requireActor(input) {
  const uid = String(input?.createdByUid || "").trim();
  const email = String(input?.createdByEmail || "").trim();
  if (!uid && !email) throw new Error("deduction_actor_required");
  return { createdByUid: uid || null, createdByEmail: email || null };
}

export function buildDeferredDeduction(input) {
  const kind = assertDeferrableDeductionKind(input?.kind);
  const originalPayrollMonth = normalizePayrollMonth(input?.originalPayrollMonth);
  const targetPayrollMonth = normalizePayrollMonth(input?.targetPayrollMonth);
  if (targetPayrollMonth <= originalPayrollMonth) {
    throw new Error("deferred_deduction_target_must_be_later");
  }
  const amountHalalas = money(input?.amountHalalas);
  if (amountHalalas <= 0) throw new Error("deduction_amount_required");
  const reason = requireReason(input?.reason);
  const actor = requireActor(input);

  return {
    kind,
    originalPayrollMonth,
    targetPayrollMonth,
    originalAmountHalalas: amountHalalas,
    scheduledAmountHalalas: amountHalalas,
    status: PAYROLL_INSTALLMENT_STATUSES.SCHEDULED,
    sourceType: String(input?.sourceType || "manual").trim() || "manual",
    sourceRef: String(input?.sourceRef || "").trim() || null,
    reason,
    note: String(input?.note || "").trim() || null,
    ...actor,
    createdAt: String(input?.createdAt || new Date().toISOString()),
  };
}

export function buildInstallmentPlan(input) {
  const kind = assertDeferrableDeductionKind(input?.kind);
  const originalPayrollMonth = normalizePayrollMonth(input?.originalPayrollMonth);
  const originalAmountHalalas = money(input?.amountHalalas);
  if (originalAmountHalalas <= 0) throw new Error("deduction_amount_required");
  const reason = requireReason(input?.reason);
  const actor = requireActor(input);
  const rawInstallments = Array.isArray(input?.installments) ? input.installments : [];
  if (rawInstallments.length === 0) throw new Error("deduction_installments_required");

  const seenMonths = new Set();
  const installments = rawInstallments.map((item, index) => {
    const targetPayrollMonth = normalizePayrollMonth(item?.targetPayrollMonth);
    if (targetPayrollMonth <= originalPayrollMonth) {
      throw new Error("deduction_installment_target_must_be_later");
    }
    if (seenMonths.has(targetPayrollMonth)) throw new Error("deduction_installment_month_duplicate");
    seenMonths.add(targetPayrollMonth);
    const amountHalalas = money(item?.amountHalalas);
    if (amountHalalas <= 0) throw new Error("deduction_installment_amount_required");
    return {
      sequence: index + 1,
      targetPayrollMonth,
      amountHalalas,
      status: PAYROLL_INSTALLMENT_STATUSES.SCHEDULED,
    };
  });

  const scheduledTotalHalalas = installments.reduce((sum, item) => sum + item.amountHalalas, 0);
  if (scheduledTotalHalalas !== originalAmountHalalas) {
    throw new Error("deduction_installment_total_mismatch");
  }

  return {
    kind,
    originalPayrollMonth,
    originalAmountHalalas,
    scheduledTotalHalalas,
    status: PAYROLL_OBLIGATION_STATUSES.SCHEDULED,
    sourceType: String(input?.sourceType || "manual").trim() || "manual",
    sourceRef: String(input?.sourceRef || "").trim() || null,
    reason,
    note: String(input?.note || "").trim() || null,
    installments,
    ...actor,
    createdAt: String(input?.createdAt || new Date().toISOString()),
  };
}

export const PAYROLL_OBLIGATION_SOURCE_TYPE = "payroll_obligation";

export function isPayrollObligationDeductionItem(item) {
  const sourceType = String(item?.sourceType ?? item?.source_type ?? "").trim().toLowerCase();
  const kind = String(item?.kind ?? "").trim().toLowerCase();
  return sourceType === PAYROLL_OBLIGATION_SOURCE_TYPE || kind === PAYROLL_OBLIGATION_SOURCE_TYPE;
}

export function payrollObligationDeductionItem(input) {
  const obligationKind = assertDeferrableDeductionKind(input?.obligationKind ?? input?.kind);
  const amountHalalas = money(input?.amountHalalas);
  if (amountHalalas <= 0) throw new Error("deduction_amount_required");
  const originalPayrollMonth = normalizePayrollMonth(input?.originalPayrollMonth);
  const targetPayrollMonth = normalizePayrollMonth(input?.targetPayrollMonth);
  const obligationId = String(input?.obligationId || "").trim();
  const installmentId = String(input?.installmentId || "").trim();
  if (!obligationId) throw new Error("deduction_obligation_id_required");
  if (!installmentId) throw new Error("deduction_installment_id_required");
  const reason = requireReason(input?.reason);
  const title = String(input?.title || reason).trim() || reason;
  const note = String(input?.note || "").trim() || null;
  const recurringDeductionId = String(input?.recurringDeductionId || "").trim() || null;

  return {
    id: `payroll-obligation:${installmentId}`,
    kind: PAYROLL_OBLIGATION_SOURCE_TYPE,
    obligationKind,
    label: title,
    amountHalalas,
    direction: "deduction",
    sourceType: PAYROLL_OBLIGATION_SOURCE_TYPE,
    sourceRef: installmentId,
    obligationId,
    installmentId,
    recurringDeductionId,
    originalPayrollMonth,
    targetPayrollMonth,
    reason,
    note,
    trace: {
      domain: "employee_payroll_obligation",
      obligationId,
      installmentId,
      recurringDeductionId,
      originalPayrollMonth,
      targetPayrollMonth,
      obligationKind,
      reason,
      sourceType: String(input?.sourceType || "manual").trim() || "manual",
      sourceRef: String(input?.sourceRef || "").trim() || null,
    },
  };
}

export function withoutPayrollObligationDeductionItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !isPayrollObligationDeductionItem(item));
}

export function isAttendancePayrollObligationDeductionItem(item) {
  if (!isPayrollObligationDeductionItem(item)) return false;

  const obligationKind = String(
    item?.obligationKind ??
    item?.obligation_kind ??
    item?.trace?.obligationKind ??
    item?.trace?.obligation_kind ??
    ""
  ).trim().toLowerCase();

  const originSourceType = String(
    item?.trace?.sourceType ??
    item?.trace?.source_type ??
    ""
  ).trim().toLowerCase();

  return (
    originSourceType === "attendance" ||
    obligationKind === "attendance_missing_hours"
  );
}

export function payrollAttendanceObligationDeductionTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (!isAttendancePayrollObligationDeductionItem(item)) return sum;
    return sum + money(
      item?.amountHalalas ??
      item?.amount_halalas ??
      item?.amount
    );
  }, 0);
}

export function payrollOtherObligationDeductionTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (!isPayrollObligationDeductionItem(item)) return sum;
    if (isAttendancePayrollObligationDeductionItem(item)) return sum;
    return sum + money(
      item?.amountHalalas ??
      item?.amount_halalas ??
      item?.amount
    );
  }, 0);
}

export function payrollObligationDeductionTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (!isPayrollObligationDeductionItem(item)) return sum;
    return sum + money(item?.amountHalalas ?? item?.amount_halalas ?? item?.amount);
  }, 0);
}
