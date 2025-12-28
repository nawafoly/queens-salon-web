// src/services/firestoreOffers.ts
import { db } from "./firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  runTransaction,
  increment,
} from "firebase/firestore";

export type DiscountType = "fixed" | "percent";
export type OfferAppliesTo = "all" | "services";

export type Offer = {
  id: string;
  title: string;

  /** الكود الأصلي للعرض */
  code: string;

  /** ✅ مفتاح بحث (lowercase) لتفادي مشكلة case-sensitive */
  codeKey?: string;

  discountType: DiscountType;
  value: number;

  startDate?: string;
  endDate?: string;
  active: boolean;

  /** ✅ تطبيق العرض على (الكل/خدمات محددة) */
  appliesTo?: OfferAppliesTo;
  serviceIds?: string[];

  usageCount?: number;
  imageUrl?: string; // base64 أو رابط

  createdAt?: Timestamp | any;
  updatedAt?: Timestamp | any;
};

const DEFAULT_SALON_ID = "main";

function offersCol(salonId = DEFAULT_SALON_ID) {
  return collection(db, "salons", salonId, "offers");
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

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** ✅ يتحقق من صلاحية الفترة (إن وُجدت) */
function isWithinDates(startDate?: string, endDate?: string) {
  const now = new Date();

  if (startDate) {
    const s = new Date(startDate);
    s.setHours(0, 0, 0, 0);
    if (now < s) return false;
  }

  if (endDate) {
    const e = endOfDay(new Date(endDate));
    if (now > e) return false;
  }

  return true;
}

/** ✅ هل العرض ينطبق على خدمة معينة؟ */
export function offerAppliesToService(offer: Offer, serviceId: string) {
  const mode: OfferAppliesTo = (offer.appliesTo as any) || "all";
  if (mode === "all") return true;

  const list = Array.isArray(offer.serviceIds) ? offer.serviceIds : [];
  return list.includes(serviceId);
}

export async function listOffers(salonId = DEFAULT_SALON_ID): Promise<Offer[]> {
  const q = query(offersCol(salonId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Offer[];
}

export async function upsertOffer(offer: Offer, salonId = DEFAULT_SALON_ID) {
  const ref = doc(db, "salons", salonId, "offers", offer.id);

  const payload = stripUndefined({ ...offer });

  const code = String(payload.code ?? "").trim();
  const codeKey = code.toLowerCase();

  await setDoc(
    ref,
    {
      ...payload,
      code,
      codeKey, // ✅ مهم للبحث
      appliesTo: (payload.appliesTo as any) || "all",
      serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
      updatedAt: serverTimestamp(),
      createdAt: payload.createdAt ?? serverTimestamp(),
    },
    { merge: true }
  );
}

export async function removeOffer(id: string, salonId = DEFAULT_SALON_ID) {
  await deleteDoc(doc(db, "salons", salonId, "offers", id));
}

/**
 * ✅ جلب عرض فعّال عن طريق الكود
 * - يبحث عن codeKey + active=true
 * - ويتأكد أن التاريخ داخل startDate/endDate إذا موجودة
 */
export async function findActiveOfferByCode(
  salonId: string,
  codeRaw: string
): Promise<Offer | null> {
  const code = String(codeRaw || "").trim();
  if (!code) return null;

  const codeKey = code.toLowerCase();

  const q = query(
    offersCol(salonId),
    where("codeKey", "==", codeKey),
    where("active", "==", true),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const d0 = snap.docs[0];
  const data = d0.data() as any;

  if (!isWithinDates(data?.startDate, data?.endDate)) return null;

  return { id: d0.id, ...data } as Offer;
}

/**
 * ✅ يزيد usageCount للعرض بعد تطبيقه بنجاح
 * - يستخدم Transaction عشان يكون آمن مع التزامن
 */
export async function incrementOfferUsage(
  salonId: string,
  offerId: string
): Promise<void> {
  const sid = salonId || DEFAULT_SALON_ID;
  if (!offerId) return;

  const ref = doc(db, "salons", sid, "offers", offerId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    tx.update(ref, {
      usageCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  });
}
