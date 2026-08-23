export const PAYROLL_CARRYOVER_SOURCE_TYPE = "payroll_carryover";
export const PAYROLL_CARRYOVER_ITEM_PREFIX = "payroll_carryover:";

function finiteMoney(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

export function payrollMonthShift(payrollMonth, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(cleanText(payrollMonth));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(delta || 0), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousPayrollMonth(payrollMonth) {
  return payrollMonthShift(payrollMonth, -1);
}

export function nextPayrollMonth(payrollMonth) {
  return payrollMonthShift(payrollMonth, 1);
}

export function payrollCarryoverDelta(approvedNetHalalas, recalculatedNetHalalas) {
  const approved = finiteMoney(approvedNetHalalas);
  const recalculated = finiteMoney(recalculatedNetHalalas);
  const signedDeltaHalalas = recalculated - approved;
  if (signedDeltaHalalas === 0) {
    return {
      approvedNetHalalas: approved,
      recalculatedNetHalalas: recalculated,
      signedDeltaHalalas: 0,
      direction: "none",
      amountHalalas: 0,
    };
  }
  return {
    approvedNetHalalas: approved,
    recalculatedNetHalalas: recalculated,
    signedDeltaHalalas,
    direction: signedDeltaHalalas > 0 ? "addition" : "deduction",
    amountHalalas: Math.abs(signedDeltaHalalas),
  };
}

export function isPayrollCarryoverItem(item) {
  if (!item || typeof item !== "object") return false;
  return (
    cleanText(item.sourceType ?? item.source_type) === PAYROLL_CARRYOVER_SOURCE_TYPE ||
    cleanText(item.id).startsWith(PAYROLL_CARRYOVER_ITEM_PREFIX)
  );
}

export function withoutPayrollCarryoverItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !isPayrollCarryoverItem(item));
}

export function payrollCarryoverItem(adjustment) {
  const id = cleanText(adjustment?.id);
  const direction = cleanText(adjustment?.direction) === "addition" ? "addition" : "deduction";
  const sourceMonth = cleanText(adjustment?.sourcePayrollMonth ?? adjustment?.source_payroll_month);
  const sourceDate = cleanText(adjustment?.sourceDate ?? adjustment?.source_date);
  const amountHalalas = finiteMoney(adjustment?.amountHalalas ?? adjustment?.amount_halalas);
  const reason = cleanText(adjustment?.reason) || `تسوية مسيرة ${sourceMonth || "سابقة"}`;
  return {
    id: `${PAYROLL_CARRYOVER_ITEM_PREFIX}${id || `${sourceMonth}:${amountHalalas}`}`,
    direction,
    kind: direction === "addition" ? "manual_addition" : "manual_deduction",
    amountHalalas,
    reason,
    note: [
      "تسوية تلقائية من فترة سابقة",
      sourceMonth ? `الفترة: ${sourceMonth}` : "",
      sourceDate ? `المرجع: ${sourceDate}` : "",
    ].filter(Boolean).join(" | "),
    sourceType: PAYROLL_CARRYOVER_SOURCE_TYPE,
    sourceId: id || null,
    sourcePayrollMonth: sourceMonth || null,
    sourceDate: sourceDate || null,
    addedBy: "system",
    addedAt: cleanText(adjustment?.updatedAt ?? adjustment?.updated_at ?? adjustment?.createdAt ?? adjustment?.created_at) || new Date().toISOString(),
  };
}

export function payrollCarryoverNetHalalas(additions, deductions) {
  const additionTotal = (Array.isArray(additions) ? additions : [])
    .filter(isPayrollCarryoverItem)
    .reduce((total, item) => total + finiteMoney(item.amountHalalas ?? item.amount_halalas), 0);
  const deductionTotal = (Array.isArray(deductions) ? deductions : [])
    .filter(isPayrollCarryoverItem)
    .reduce((total, item) => total + finiteMoney(item.amountHalalas ?? item.amount_halalas), 0);
  return additionTotal - deductionTotal;
}
