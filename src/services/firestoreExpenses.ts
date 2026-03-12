

// ✅ src/services/firestoreExpenses.ts
import { auth, db } from "./firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";

import type { Expense } from "../types/finance";
import { writeAuditLog } from "./logService";
import { FirestoreReadStats } from "./firestoreReadStats";

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

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeIsoDate(rawDate: any, fallbackMs: number): string {
  const direct = String(rawDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

  const withPrefix = direct.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (withPrefix?.[1]) return withPrefix[1];

  if (direct) {
    const parsed = Date.parse(direct);
    if (Number.isFinite(parsed)) return toIsoDate(new Date(parsed));
  }

  if (fallbackMs > 0) return toIsoDate(new Date(fallbackMs));
  return "";
}

function normalizeExpense(raw: any, id: string): Expense {
  const createdAtMs = toMillis(raw?.createdAt || raw?.updatedAt);
  const date = normalizeIsoDate(raw?.date, createdAtMs);
  const addedBy = String(
    raw?.createdByName ||
      raw?.addedBy ||
      raw?.createdBy ||
      raw?.createdByEmail ||
      raw?.createdByUid ||
      ""
  ).trim();

  return {
    id,
    title: String(raw?.title ?? "").trim(),
    category: String(raw?.category ?? "أخرى").trim(),
    amount: Number(raw?.amount ?? 0),
    date,
    paymentMethod: raw?.paymentMethod ?? "كاش",
    note: raw?.note ? String(raw.note).trim() : undefined,
    createdAt: createdAtMs || Date.now(),
    addedBy: addedBy || undefined,
    createdBy: raw?.createdBy ? String(raw.createdBy).trim() : undefined,
    createdByName: raw?.createdByName ? String(raw.createdByName).trim() : undefined,
    createdByUid: raw?.createdByUid ? String(raw.createdByUid).trim() : undefined,
    createdByEmail: raw?.createdByEmail ? String(raw.createdByEmail).trim() : undefined,
    sourceKind: raw?.sourceKind ? String(raw.sourceKind).trim() : undefined,
    sourceRefId: raw?.sourceRefId ? String(raw.sourceRefId).trim() : undefined,
    sourceType: raw?.sourceType ? String(raw.sourceType).trim() : undefined,
    staffId: raw?.staffId ? String(raw.staffId).trim() : undefined,
    staffName: raw?.staffName ? String(raw.staffName).trim() : undefined,
    monthKey: raw?.monthKey ? String(raw.monthKey).trim() : undefined,
    payrollKind: raw?.payrollKind === "salary" || raw?.payrollKind === "overtime"
      ? raw.payrollKind
      : undefined,
  };
}

type AuthUserLS = {
  uid?: string;
  email?: string;
  displayName?: string;
  name?: string;
};

function getAuthUserFromLocalStorage(): AuthUserLS | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) return JSON.parse(raw) as AuthUserLS;
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem("user_profile_v1");
    if (raw) return JSON.parse(raw) as AuthUserLS;
  } catch {
    // ignore
  }

  return null;
}

function resolveExpenseActor() {
  const ls = getAuthUserFromLocalStorage();
  const u = auth.currentUser;

  const uid = String(ls?.uid || u?.uid || "").trim();
  const email = String(ls?.email || u?.email || "").trim();
  const name = String(ls?.displayName || ls?.name || u?.displayName || email || uid || "").trim();

  return { uid, email, name };
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
    snaps1.docs.forEach((d) => {
      if (d?.ref?.path) {
        FirestoreReadStats.bump(d.ref.path, "firestoreExpenses.listAllExpensesFS", "getDocs");
      }
    });
    return snaps1.docs.map((d) => normalizeExpense(d.data(), d.id));
  } catch (e) {
    console.warn(
      "listAllExpensesFS: orderBy(createdAt) failed, fallback without orderBy.",
      e
    );

    const snaps2 = await getDocs(col);
    snaps2.docs.forEach((d) => {
      if (d?.ref?.path) {
        FirestoreReadStats.bump(d.ref.path, "firestoreExpenses.listAllExpensesFS", "getDocs");
      }
    });
    const mapped = snaps2.docs.map((d) => normalizeExpense(d.data(), d.id));

    mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return mapped;
  }
}

/** ✅ إضافة/تحديث */
export async function upsertExpenseFS(expense: Expense, salonId?: string) {
  const sid = salonId || DEFAULT_SALON_ID;
  const ref = doc(db, "salons", sid, "expenses", expense.id);
  FirestoreReadStats.bump(ref.path, "firestoreExpenses.upsertExpenseFS", "getDoc");
  const prevSnap = await getDoc(ref);
  const prevData = prevSnap.exists() ? prevSnap.data() : null;
  const isCreate = !prevSnap.exists();
  const actor = resolveExpenseActor();

  const existingAddedBy = String(
    prevData?.createdByName ||
      prevData?.addedBy ||
      prevData?.createdBy ||
      prevData?.createdByEmail ||
      prevData?.createdByUid ||
      ""
  ).trim();

  const createdByName = isCreate ? actor.name || "الإدارة" : existingAddedBy || undefined;
  const createdByUid = isCreate ? actor.uid || undefined : prevData?.createdByUid || undefined;
  const createdByEmail = isCreate ? actor.email || undefined : prevData?.createdByEmail || undefined;

  const payload = stripUndefined({
    title: expense.title,
    category: expense.category,
    amount: expense.amount,
    date: expense.date,
    paymentMethod: expense.paymentMethod,
    note: expense.note ?? undefined,
    createdByName,
    createdByUid,
    createdByEmail,
    // توافق مع المسارات القديمة في الواجهة
    addedBy: createdByName,
    createdBy: createdByName,

    // ✅ createdAt Timestamp لضمان orderBy
    createdAt: expense.createdAt
      ? Timestamp.fromMillis(expense.createdAt)
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(ref, payload, { merge: true });

  try {
    await writeAuditLog({
      salonId: sid,
      action: isCreate ? "expense_created" : "expense_updated",
      entityType: "expense",
      entityId: expense.id,
      description: isCreate ? "تم إنشاء مصروف" : "تم تعديل مصروف",
      source: "dashboard",
      before: prevData,
      after: {
        title: expense.title,
        category: expense.category,
        amount: expense.amount,
        date: expense.date,
        paymentMethod: expense.paymentMethod,
        note: expense.note ?? null,
      },
      meta: {
        paymentMethod: expense.paymentMethod,
        amount: expense.amount,
      },
    });
  } catch {
    // ignore
  }
}

/** ✅ حذف */
export async function removeExpenseFS(id: string, salonId?: string) {
  const sid = salonId || DEFAULT_SALON_ID;
  const ref = doc(db, "salons", sid, "expenses", id);
  FirestoreReadStats.bump(ref.path, "firestoreExpenses.removeExpenseFS", "getDoc");
  const prevSnap = await getDoc(ref);
  const prevData = prevSnap.exists() ? prevSnap.data() : null;
  await deleteDoc(ref);

  try {
    await writeAuditLog({
      salonId: sid,
      action: "expense_deleted",
      entityType: "expense",
      entityId: id,
      description: "تم حذف مصروف",
      source: "dashboard",
      before: prevData,
      after: null,
      meta: {
        amount: (prevData as any)?.amount ?? null,
      },
    });
  } catch {
    // ignore
  }
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
  snaps.docs.forEach((d) => {
    if (d?.ref?.path) {
      FirestoreReadStats.bump(d.ref.path, "firestoreExpenses.countMonthlyExpensesMissingNotesFS", "getDocs");
    }
  });

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
