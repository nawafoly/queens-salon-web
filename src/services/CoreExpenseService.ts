

// Core-only expense runtime for Malikat Finance
import type { Expense } from "../types/finance";
import { CoreFinanceService } from "./CoreFinanceService";
import { CoreApiError } from "./coreApiClient";

// ✅ ثابت الآن (لاحقًا نخليه ديناميكي)
function isRefundExpense(expense: Pick<Expense, "sourceKind" | "sourceType">): boolean {
  const sourceKind = String(expense.sourceKind || "").trim().toLowerCase();
  const sourceType = String(expense.sourceType || "").trim().toLowerCase();
  return sourceKind === "refund" || sourceType === "refund";
}

function coreExpenseToLegacy(row: import("../types/coreApi").CoreExpenseEntry): Expense {
  return {
    id: row.id,
    title: String(row.title || row.description || "مصروف"),
    category: String(row.category || "أخرى"),
    amount: Number(row.amountHalalas || 0) / 100,
    date: String(row.occurredAt || "").slice(0, 10),
    paymentMethod: (String(row.paymentMethod || "cash") as Expense["paymentMethod"]),
    note: row.note || row.description || undefined,
    createdAt: Date.parse(row.createdAt || row.occurredAt || "") || Date.now(),
    addedBy: row.addedBy || undefined,
    createdByUid: row.createdByUid || undefined,
    sourceKind: row.sourceKind || undefined,
    sourceRefId: row.sourceRefId || undefined,
    sourceType: row.sourceType || undefined,
    staffId: row.staffId || undefined,
    staffName: row.staffName || undefined,
    monthKey: row.monthKey || undefined,
    payrollKind: row.payrollKind === "salary" || row.payrollKind === "overtime" ? row.payrollKind : undefined,
  };
}

function legacyExpenseToCore(expense: Expense) {
  const date = String(expense.date || "").trim();
  return {
    id: expense.id,
    amountHalalas: Math.max(1, Math.round(Number(expense.amount || 0) * 100)),
    category: expense.category,
    description: expense.note || expense.title,
    paymentMethod: expense.paymentMethod,
    occurredAt: date ? `${date}T12:00:00.000Z` : new Date(expense.createdAt || Date.now()).toISOString(),
    createdAt: new Date(expense.createdAt || Date.now()).toISOString(),
    title: expense.title,
    note: expense.note,
    addedBy: expense.addedBy || expense.createdByName || expense.createdBy,
    sourceKind: expense.sourceKind,
    sourceRefId: expense.sourceRefId,
    sourceType: expense.sourceType,
    staffId: expense.staffId,
    staffName: expense.staffName,
    monthKey: expense.monthKey,
    payrollKind: expense.payrollKind,
  };
}

/**
 * ✅ جلب المصروفات
 * - يحاول orderBy(createdAt desc)
 * - لو فشل: fallback بدون orderBy + ترتيب محلي
 */
export async function listAllExpensesCore(): Promise<Expense[]> {
  return (await CoreFinanceService.listExpenses())
    .map(coreExpenseToLegacy)
    .filter((expense) => !isRefundExpense(expense));
}

export async function upsertExpenseCore(expense: Expense): Promise<void> {
  const payload = legacyExpenseToCore(expense);
  try {
    await CoreFinanceService.patchExpense(expense.id, payload);
  } catch (error) {
    if (!(error instanceof CoreApiError) || error.status !== 404) throw error;
    await CoreFinanceService.createExpense(payload);
  }
}
export async function removeExpenseCore(id: string): Promise<void> {
  await CoreFinanceService.deleteExpense(id);
}
function currentRiyadhMonthKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
}

export async function countMonthlyExpensesMissingNotesCore(): Promise<number> {
  const rows = await CoreFinanceService.listExpenses();
  const month = currentRiyadhMonthKey();
  return rows.filter((row) =>
    String(row.occurredAt || "").startsWith(month) &&
    !String(row.note || row.description || "").trim()
  ).length;
}
