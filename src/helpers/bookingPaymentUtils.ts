export type BookingPaymentType = "full" | "partial" | "none";
export type BookingPaymentMethod = "cash" | "card" | "transfer" | "mixed";
export type BookingPaymentBreakdown = {
  cash: number;
  card: number;
  transfer: number;
};

export type ExistingBookingPayment = {
  paymentMethod: BookingPaymentMethod;
  paymentBreakdown: BookingPaymentBreakdown;
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
};

export const EMPTY_PAYMENT_BREAKDOWN: BookingPaymentBreakdown = {
  cash: 0,
  card: 0,
  transfer: 0,
};

export function calcManualDiscount(
  basePrice: number,
  discountType: "fixed" | "percent" | null,
  discountValue: number
) {
  const value = Math.max(0, Number(discountValue || 0));
  if (!discountType || value <= 0 || basePrice <= 0) {
    return { discountAmount: 0, finalPrice: Math.max(0, basePrice) };
  }

  if (discountType === "percent") {
    const percent = Math.min(100, value);
    const discount = Math.round((basePrice * percent) / 100);
    return { discountAmount: discount, finalPrice: Math.max(0, basePrice - discount) };
  }

  const discount = Math.min(basePrice, value);
  return { discountAmount: discount, finalPrice: Math.max(0, basePrice - discount) };
}

export function isLegacyPackageLinkedOffer(raw: any) {
  return (
    raw &&
    (Number(raw?.packageFinalPrice || 0) > 0 ||
      Number(raw?.packageBaseTotalPrice || 0) > 0 ||
      Number(raw?.packageTotalDurationMin || 0) > 0)
  );
}

export function normalizeCouponCode(raw: any) {
  return String(raw || "").trim().toUpperCase();
}

export function isRefundedBooking(raw: any) {
  const s = String(raw?.status || "").trim().toLowerCase();
  if (s === "refunded") return true;
  return !!raw?.refundedAt || !!raw?.refundIncomeId || String(raw?.refundReason || "").trim().length > 0;
}

export function isCompletedStatus(raw: any) {
  if (isRefundedBooking(raw)) return false;
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  return String(statusRaw || "").trim().toLowerCase() === "completed";
}

export function isCancelledStatus(raw: any) {
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "rejected";
}

export function canRefundBooking(raw: any) {
  if (isRefundedBooking(raw)) return false;
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  return s === "confirmed" || s === "completed";
}

export function mapBookingStatusAr(raw: any) {
  if (isRefundedBooking(raw)) return "مسترجع";
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  if (s === "refunded") return "مسترجع";
  if (s === "confirmed") return "مؤكد";
  if (s === "pending") return "بالانتظار";
  if (s === "cancelled" || s === "canceled") return "ملغي";
  if (s === "completed") return "مكتمل";
  return String(statusRaw || "—");
}

export function bookingStatusClass(raw: any) {
  if (isRefundedBooking(raw)) return "bk-status-refunded";
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  if (s === "refunded") return "bk-status-refunded";
  if (s === "confirmed") return "bk-status-confirmed";
  if (s === "pending") return "bk-status-pending";
  if (s === "cancelled" || s === "canceled") return "bk-status-cancelled";
  if (s === "completed") return "bk-status-completed";
  return "bk-status-default";
}

export function mapBookingChannelAr(raw: any) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "—";
  if (s === "client") return "عميلة";
  if (s === "internal") return "استقبال";
  if (s === "dashboard") return "إدارة";
  if (s === "online") return "أونلاين";
  return String(raw);
}

export function normalizeExistingPaymentMethod(raw: any): BookingPaymentMethod {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "cash" || s.includes("كاش") || s.includes("نقد")) return "cash";
  if (
    s === "card" ||
    s === "pos_card" ||
    s === "mada_online" ||
    s.includes("شبكة") ||
    s.includes("مدى")
  ) {
    return "card";
  }
  if (s === "mixed" || s.includes("مختلط")) return "mixed";
  if (s === "transfer" || s.includes("تحويل") || s.includes("بنكي")) return "transfer";
  return "transfer";
}

export function normalizeExistingPaymentType(raw: any): BookingPaymentType | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "none" || s === "no_payment" || s === "unpaid" || s === "بدون دفع") return "none";
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

export function roundMoney2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

export function normalizePaymentBreakdown(raw: any): BookingPaymentBreakdown {
  const read = (key: keyof BookingPaymentBreakdown) => {
    const n = Number(raw?.[key] ?? 0);
    return Number.isFinite(n) ? roundMoney2(Math.max(0, n)) : 0;
  };

  return {
    cash: read("cash"),
    card: read("card"),
    transfer: read("transfer"),
  };
}

export function sumPaymentBreakdown(raw: any) {
  const breakdown = normalizePaymentBreakdown(raw);
  return roundMoney2(
    Number(breakdown.cash || 0) +
      Number(breakdown.card || 0) +
      Number(breakdown.transfer || 0)
  );
}

export function hasPaymentBreakdownValue(raw: any) {
  return sumPaymentBreakdown(raw) > 0;
}

export function paymentBreakdownForSingleMethod(
  method: BookingPaymentMethod | null | undefined,
  amountRaw: any
): BookingPaymentBreakdown {
  const amount = roundMoney2(Math.max(0, Number(amountRaw || 0)));
  const out = { ...EMPTY_PAYMENT_BREAKDOWN };
  if (method === "cash") out.cash = amount;
  if (method === "card") out.card = amount;
  if (method === "transfer") out.transfer = amount;
  return out;
}

export function bookingPaymentMethodLabelAr(method: BookingPaymentMethod | null | undefined) {
  if (method === "cash") return "كاش";
  if (method === "card") return "شبكة";
  if (method === "transfer") return "تحويل";
  if (method === "mixed") return "مختلط";
  return "—";
}

export function paymentBreakdownLines(raw: any) {
  const breakdown = normalizePaymentBreakdown(raw);
  const lines: string[] = [];
  if (breakdown.cash > 0) lines.push(`كاش ${breakdown.cash.toFixed(2)} ر.س`);
  if (breakdown.card > 0) lines.push(`شبكة ${breakdown.card.toFixed(2)} ر.س`);
  if (breakdown.transfer > 0) lines.push(`تحويل ${breakdown.transfer.toFixed(2)} ر.س`);
  return lines;
}

export function readBookingTotalAmount(raw: any) {
  const n = Number(
    raw?.finalPrice ??
      raw?.total ??
      raw?.serviceSnapshot?.priceAtBooking ??
      raw?.packageSnapshot?.finalPriceAtBooking ??
      0
  );
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function resolveExistingBookingPayment(
  raw: any,
  override?: Partial<{
    paymentType: BookingPaymentType;
    paidAmount: number;
    paymentMethod: BookingPaymentMethod;
    paymentBreakdown: Partial<BookingPaymentBreakdown>;
  }>
): ExistingBookingPayment {
  const totalAmount = readBookingTotalAmount(raw);
  const normalizedType = normalizeExistingPaymentType(override?.paymentType ?? raw?.paymentType);
  const paymentMethod = normalizeExistingPaymentMethod(override?.paymentMethod ?? raw?.paymentMethod);
  const paymentBreakdown = normalizePaymentBreakdown(override?.paymentBreakdown ?? raw?.paymentBreakdown);
  const breakdownPaid = paymentMethod === "mixed" ? sumPaymentBreakdown(paymentBreakdown) : 0;
  const hasExplicitPaid =
    Number.isFinite(Number(override?.paidAmount ?? raw?.paidAmount)) || breakdownPaid > 0;
  const explicitPaid = Number.isFinite(Number(override?.paidAmount ?? raw?.paidAmount))
    ? Number(override?.paidAmount ?? raw?.paidAmount)
    : Number(breakdownPaid || NaN);
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "none");
  let paidAmount: number;

  if (paymentType === "none") {
    paidAmount = 0;
  } else if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
  } else if (paymentType === "partial") {
    paidAmount = 0;
  } else {
    paidAmount = isRevenueStatus ? totalAmount : 0;
  }

  if (paidAmount <= 0 && totalAmount > 0) {
    paymentType = "none";
  } else if (paymentType === "full") {
    paidAmount = isRevenueStatus ? totalAmount : Math.max(0, Math.min(totalAmount, paidAmount));
  } else {
    paymentType = paidAmount >= totalAmount ? "full" : "partial";
  }

  const remainingAmount = Math.max(0, roundMoney2(totalAmount - paidAmount));
  return {
    paymentMethod,
    paymentBreakdown:
      paymentMethod === "mixed"
        ? normalizePaymentBreakdown(paymentBreakdown)
        : paymentBreakdownForSingleMethod(paymentMethod, paidAmount),
    paymentType,
    paidAmount: roundMoney2(Math.max(0, Math.min(totalAmount, paidAmount))),
    remainingAmount,
    totalAmount: roundMoney2(totalAmount),
  };
}

export function describeBookingPaymentState(payment: ExistingBookingPayment) {
  const total = roundMoney2(payment.totalAmount);
  const paid = roundMoney2(payment.paidAmount);
  const remaining = roundMoney2(payment.remainingAmount);
  if (total <= 0) return "لا يوجد سعر محدد";
  if (paid <= 0 && remaining > 0) return "غير مدفوع";
  if (remaining <= 0) return "مدفوع بالكامل";
  if (payment.paymentType === "partial") return "عربون";
  return "مدفوع";
}

export function allocatePaidAcrossTargets(targetTotals: number[], paidTotal: number): number[] {
  const totals = targetTotals.map((v) => roundMoney2(Math.max(0, Number(v) || 0)));
  const grandTotal = roundMoney2(totals.reduce((sum, v) => sum + v, 0));
  if (!totals.length || grandTotal <= 0) return totals.map(() => 0);

  let remainingPaid = roundMoney2(Math.max(0, Math.min(grandTotal, Number(paidTotal) || 0)));
  let remainingTotal = grandTotal;
  const out = totals.map(() => 0);

  for (let i = 0; i < totals.length; i++) {
    if (remainingPaid <= 0 || remainingTotal <= 0) break;
    const slotTotal = totals[i];
    let share =
      i === totals.length - 1
        ? remainingPaid
        : roundMoney2((slotTotal / remainingTotal) * remainingPaid);
    share = roundMoney2(Math.max(0, Math.min(slotTotal, share)));
    out[i] = share;
    remainingPaid = roundMoney2(Math.max(0, remainingPaid - share));
    remainingTotal = roundMoney2(Math.max(0, remainingTotal - slotTotal));
  }

  if (remainingPaid > 0) {
    for (let i = totals.length - 1; i >= 0 && remainingPaid > 0; i--) {
      const room = roundMoney2(Math.max(0, totals[i] - out[i]));
      if (room <= 0) continue;
      const add = roundMoney2(Math.min(room, remainingPaid));
      out[i] = roundMoney2(out[i] + add);
      remainingPaid = roundMoney2(Math.max(0, remainingPaid - add));
    }
  }

  return out.map((v, i) => roundMoney2(Math.max(0, Math.min(totals[i], v))));
}
