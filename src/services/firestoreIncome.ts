

// ✅ src/services/firestoreIncome.ts
import { db } from "./firebase";
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

import type { IncomeItem, PaymentMethod } from "../types/finance";
import { writeAuditLog } from "./logService";

// ✅ ثابت الآن (لاحقًا نخليه ديناميكي)
const DEFAULT_SALON_ID = "main";

function incomeCol(salonId = DEFAULT_SALON_ID) {
  return collection(db, "salons", salonId, "income");
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
  if (v?.toMillis) return v.toMillis(); // Timestamp
  if (typeof v === "number") return v; // number
  const t = Date.parse(v); // string
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

/** ✅ تطبيع طريقة الدفع (يدعم العربي + القديم) */
function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x ?? "").toLowerCase().trim();

  // already normalized
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  if (s === "other") return "other";

  // arabic / legacy
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق")) return "card";
  if (s.includes("تحويل")) return "transfer";

  return "other";
}

function normalizeIncome(raw: any, id: string): IncomeItem {
  const createdAtMs = toMillis(raw?.createdAt || raw?.updatedAt);
  const date = normalizeIsoDate(raw?.date, createdAtMs);

  return {
    id,
    date, // YYYY-MM-DD
    amount: Number(raw?.amount ?? 0),
    method: normalizePaymentMethod(raw?.method),
    source: String(raw?.source ?? "دخل").trim(),
    note: raw?.note ? String(raw.note).trim() : undefined,
    bookingId: raw?.bookingId ? String(raw.bookingId).trim() : undefined,
    createdAt: createdAtMs || Date.now(),
  };
}

/**
 * ✅ جلب الإيرادات
 * - يحاول orderBy(createdAt desc)
 * - لو فشل: fallback بدون orderBy + ترتيب محلي
 */
export async function listAllIncomeFS(salonId?: string): Promise<IncomeItem[]> {
  const col = incomeCol(salonId || DEFAULT_SALON_ID);

  try {
    const q1 = query(col, orderBy("createdAt", "desc"));
    const snaps1 = await getDocs(q1);
    return snaps1.docs.map((d) => normalizeIncome(d.data(), d.id));
  } catch (e) {
    console.warn(
      "listAllIncomeFS: orderBy(createdAt) failed, fallback without orderBy.",
      e
    );

    const snaps2 = await getDocs(col);
    const mapped = snaps2.docs.map((d) => normalizeIncome(d.data(), d.id));
    mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return mapped;
  }
}

/** ✅ إضافة/تحديث */
export async function upsertIncomeFS(item: IncomeItem, salonId?: string) {
  const sid = salonId || DEFAULT_SALON_ID;
  const ref = doc(db, "salons", sid, "income", item.id);
  const prevSnap = await getDoc(ref);
  const prevData = prevSnap.exists() ? prevSnap.data() : null;
  const isCreate = !prevSnap.exists();

  const payload = stripUndefined({
    date: item.date,
    amount: item.amount,
    method: item.method,
    source: item.source,
    note: item.note ?? undefined,
    bookingId: item.bookingId ?? undefined,

    // ✅ createdAt Timestamp لضمان orderBy
    createdAt: item.createdAt
      ? Timestamp.fromMillis(item.createdAt)
      : serverTimestamp(),

    updatedAt: serverTimestamp(),
  });

  await setDoc(ref, payload, { merge: true });

  try {
    await writeAuditLog({
      salonId: sid,
      action: isCreate ? "income_created" : "income_updated",
      entityType: "income",
      entityId: item.id,
      description: isCreate ? "تم إنشاء سجل دخل" : "تم تعديل سجل دخل",
      source: item.source === "invoice" ? "internal_booking" : "dashboard",
      before: prevData,
      after: {
        date: item.date,
        amount: item.amount,
        method: item.method,
        source: item.source,
        note: item.note ?? null,
        bookingId: item.bookingId ?? null,
      },
      meta: {
        paymentMethod: item.method,
        bookingId: item.bookingId ?? null,
      },
    });
  } catch {
    // ignore
  }
}

/** ✅ حذف */
export async function removeIncomeFS(id: string, salonId?: string) {
  const sid = salonId || DEFAULT_SALON_ID;
  const ref = doc(db, "salons", sid, "income", id);
  const prevSnap = await getDoc(ref);
  const prevData = prevSnap.exists() ? prevSnap.data() : null;
  await deleteDoc(ref);

  try {
    await writeAuditLog({
      salonId: sid,
      action: "income_deleted",
      entityType: "income",
      entityId: id,
      description: "تم حذف سجل دخل",
      source: "dashboard",
      before: prevData,
      after: null,
      meta: {
        bookingId: (prevData as any)?.bookingId ?? null,
      },
    });
  } catch {
    // ignore
  }
}
