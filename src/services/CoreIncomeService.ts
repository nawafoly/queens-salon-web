

// Core-only income runtime for Malikat Finance
import type { IncomeItem, PaymentBreakdown, PaymentMethod } from "../types/finance";
import { CoreFinanceService } from "./CoreFinanceService";
import { CoreRefundService } from "./CoreRefundService";
import { CoreApiError } from "./coreApiClient";

// ✅ ثابت الآن (لاحقًا نخليه ديناميكي)
function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x ?? "").toLowerCase().trim();

  // already normalized
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  if (s === "mixed") return "mixed";
  if (s === "other") return "other";

  // arabic / legacy
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق")) return "card";
  if (s.includes("تحويل")) return "transfer";
  if (s.includes("مختلط") || s.includes("mixed")) return "mixed";

  return "other";
}

function isRefundSource(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "refund" || normalized === "استرجاع";
}

function coreIncomeToLegacy(row: import("../types/coreApi").CoreIncomeEntry): IncomeItem {
  let paymentBreakdown: PaymentBreakdown | undefined;
  try {
    const parsed = JSON.parse(String(row.paymentBreakdownJson || "{}"));
    if (parsed && typeof parsed === "object") paymentBreakdown = parsed as PaymentBreakdown;
  } catch {
    paymentBreakdown = undefined;
  }
  const source = String(row.source || (row.bookingId ? "booking" : row.category) || "دخل");
  const amount = Number(row.amountHalalas || 0) / 100;
  const refund = isRefundSource(source) || String(row.id || "").startsWith("refund_");
  return {
    id: row.id,
    date: String(row.occurredAt || "").slice(0, 10),
    amount: refund ? -Math.abs(amount) : amount,
    method: normalizePaymentMethod(row.method),
    paymentBreakdown,
    source,
    note: row.note || row.description || undefined,
    bookingId: row.bookingId || undefined,
    clientName: row.clientName || undefined,
    clientPhone: row.clientPhone || undefined,
    createdAt: Date.parse(row.createdAt || row.occurredAt || "") || Date.now(),
  };
}

function coreRefundToLegacy(row: import("../types/coreApi").CoreRefund): IncomeItem {
  return {
    id: row.id,
    date: String(row.refundedAt || row.createdAt || "").slice(0, 10),
    amount: -Math.abs(Number(row.amountHalalas || 0) / 100),
    method: normalizePaymentMethod(row.method),
    source: "refund",
    note: row.reason || undefined,
    bookingId: row.bookingId || undefined,
    createdAt: Date.parse(row.refundedAt || row.createdAt || "") || Date.now(),
  };
}

function legacyIncomeToCore(item: IncomeItem) {
  const date = String(item.date || "").trim();
  return {
    id: item.id,
    bookingId: item.bookingId,
    amountHalalas: Math.max(1, Math.round(Number(item.amount || 0) * 100)),
    category: item.source || "income",
    description: item.note || item.source || "Income",
    method: item.method,
    paymentBreakdown: item.paymentBreakdown || {},
    source: item.source,
    note: item.note,
    clientName: item.clientName,
    clientPhone: item.clientPhone,
    occurredAt: date ? `${date}T12:00:00.000Z` : new Date(item.createdAt || Date.now()).toISOString(),
    createdAt: new Date(item.createdAt || Date.now()).toISOString(),
  };
}

/**
 * ✅ جلب الإيرادات
 * - يحاول orderBy(createdAt desc)
 * - لو فشل: fallback بدون orderBy + ترتيب محلي
 */
export async function listAllIncomeCore(): Promise<IncomeItem[]> {
  const [incomeRows, refundRows] = await Promise.all([
    CoreFinanceService.listIncome(),
    CoreRefundService.list(),
  ]);

  const income = incomeRows.map(coreIncomeToLegacy);
  const existingIds = new Set(income.map((item) => String(item.id || "").trim()));
  const refunds = refundRows
    .filter((row) => String(row.status || "completed").trim().toLowerCase() === "completed")
    .filter((row) => !existingIds.has(String(row.id || "").trim()))
    .map(coreRefundToLegacy);

  return [...income, ...refunds].sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
}

/** Core-only income write used by D1 dashboard surfaces. */
export async function upsertIncomeCore(item: IncomeItem) {
  const payload = legacyIncomeToCore(item);
  try {
    await CoreFinanceService.patchIncome(item.id, payload);
  } catch (error) {
    if (!(error instanceof CoreApiError) || error.status !== 404) throw error;
    await CoreFinanceService.createIncome(payload);
  }
}

/** ✅ حذف */
export async function removeIncomeCore(id: string) {
  await CoreFinanceService.deleteIncome(id);
}

