

// ✅ src/services/firestoreExpenses.ts
import { db } from "./firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";

import type { Expense } from "../types/finance";

// ✅ ثابت الآن (لاحقًا نخليه ديناميكي)
const DEFAULT_SALON_ID = "main";

function expensesCol(salonId = DEFAULT_SALON_ID) {
  return collection(db, "salons", salonId, "expenses");
}

/** ✅ Firestore يرفض undefined */
function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

function toMillis(v: any): number {
  // Timestamp
  if (v?.toMillis) return v.toMillis();
  // number
  if (typeof v === "number") return v;
  // date string fallback
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function normalizeExpense(raw: any, id: string): Expense {
  const createdAtMs = toMillis(raw?.createdAt);

  return {
    id,
    title: String(raw?.title ?? "").trim(),
    category: String(raw?.category ?? "أخرى").trim(),
    amount: Number(raw?.amount ?? 0),
    date: String(raw?.date ?? "").trim(),
    paymentMethod: raw?.paymentMethod ?? "كاش",
    note: raw?.note ? String(raw.note).trim() : undefined,
    createdAt: createdAtMs || Date.now(),
  };
}

/**
 * ✅ جلب المصروفات
 * - يحاول orderBy(createdAt desc)
 * - لو فشل: fallback بدون orderBy + ترتيب محلي
 */
export async function listAllExpensesFS(salonId?: string): Promise<Expense[]> {
  const col = expensesCol(salonId || DEFAULT_SALON_ID);

  try {
    const q1 = query(col, orderBy("createdAt", "desc"));
    const snaps1 = await getDocs(q1);
    return snaps1.docs.map((d) => normalizeExpense(d.data(), d.id));
  } catch (e) {
    console.warn(
      "listAllExpensesFS: orderBy(createdAt) failed, fallback without orderBy.",
      e
    );

    const snaps2 = await getDocs(col);
    const mapped = snaps2.docs.map((d) => normalizeExpense(d.data(), d.id));

    mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return mapped;
  }
}

/** ✅ إضافة/تحديث */
export async function upsertExpenseFS(expense: Expense, salonId?: string) {
  const sid = salonId || DEFAULT_SALON_ID;
  const ref = doc(db, "salons", sid, "expenses", expense.id);

  const payload = stripUndefined({
    title: expense.title,
    category: expense.category,
    amount: expense.amount,
    date: expense.date,
    paymentMethod: expense.paymentMethod,
    note: expense.note ?? undefined,

    // ✅ createdAt Timestamp لضمان orderBy
    createdAt: expense.createdAt
      ? Timestamp.fromMillis(expense.createdAt)
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(ref, payload, { merge: true });
}

/** ✅ حذف */
export async function removeExpenseFS(id: string, salonId?: string) {
  const sid = salonId || DEFAULT_SALON_ID;
  const ref = doc(db, "salons", sid, "expenses", id);
  await deleteDoc(ref);
}

/**
 * ✅ جديد: عدّ مصروفات هذا الشهر بدون ملاحظات
 * - يعتمد على حقل date (YYYY-MM-DD)
 * - لا يؤثر على list / upsert / delete
 */
export async function countMonthlyExpensesMissingNotesFS(
  salonId?: string
): Promise<number> {
  const sid = salonId || DEFAULT_SALON_ID;
  const col = expensesCol(sid);

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(
    new Date(y, m, 0).getDate()
  ).padStart(2, "0")}`;

  const snaps = await getDocs(col);

  let count = 0;

  snaps.forEach((d) => {
    const raw = d.data();
    const date = String(raw?.date ?? "");
    if (date < start || date > end) return;

    const note = raw?.note ? String(raw.note).trim() : "";
    if (!note) count += 1;
  });

  return count;
}

