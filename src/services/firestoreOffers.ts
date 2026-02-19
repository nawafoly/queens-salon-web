// src/services/firestoreOffers.ts
import { db } from "./firebase";
import {
  collection,
  getDoc,
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
import { writeAuditLog } from "./logService";

export type DiscountType = "fixed" | "percent";
export type OfferAppliesTo = "all" | "services";
export type OfferSequenceStep = {
  serviceId: string;
  orderIndex: number;
  gapAfterMin: number;
  titleSnapshot?: string;
};

export type Offer = {
  id: string;
  title: string;

  /** كود العرض (مولّد تلقائيًا غالبًا) */
  code: string;

  /** مفتاح بحث (نخليه Uppercase عشان يكون ثابت) */
  codeKey?: string;

  discountType: DiscountType;
  value: number;

  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  active: boolean;

  /** تطبيق العرض على الكل أو خدمات محددة */
  appliesTo?: OfferAppliesTo;
  serviceIds?: string[];
  sequenceSteps?: OfferSequenceStep[];

  usageCount?: number;
  imageUrl?: string;

  createdAt?: Timestamp | any;
  updatedAt?: Timestamp | any;

  /** ✅ للتوافق مع كود قديم ممكن يستخدم isActive */
  isActive?: boolean;
};

const DEFAULT_SALON_ID = "main";

function offersCol(salonId = DEFAULT_SALON_ID) {
  return collection(db, "salons", salonId, "offers");
}

/** Firestore يرفض undefined */
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

/** ✅ تحقق صلاحية التاريخ الآن (inclusive) */
export function isOfferActiveNow(offerLike: {
  startDate?: string;
  endDate?: string;
  active?: boolean;
  isActive?: boolean;
}) {
  const now = new Date();

  const activeFlag =
    offerLike?.active === true ||
    offerLike?.isActive === true;

  if (!activeFlag) return false;

  const startDate = offerLike?.startDate;
  const endDate = offerLike?.endDate;

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

/** ============================
 * ✅ توليد كود تلقائي QSXXXX
 * - بدون شرطة
 * - حروف/أرقام بدون 0,O,1,I لتجنب اللبس
 ============================ */
export function generateOfferCodeQS(len = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excludes I,O,1,0
  let out = "QS";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out; // e.g. QS7K3M
}

/** ✅ normalize: نخليه Uppercase ثابت */
function normalizeCode(codeRaw: any) {
  return String(codeRaw ?? "").trim().toUpperCase();
}

/** ✅ قائمة العروض */
export async function listOffers(salonId = DEFAULT_SALON_ID): Promise<Offer[]> {
  const q = query(offersCol(salonId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Offer[];
}

/** ✅ إضافة/تحديث */
export async function upsertOffer(offer: Offer, salonId = DEFAULT_SALON_ID) {
  const ref = doc(db, "salons", salonId, "offers", offer.id);
  const beforeSnap = await getDoc(ref);
  const before = beforeSnap.exists() ? beforeSnap.data() : null;

  const payload = stripUndefined({ ...offer });

  // ✅ لو الكود فاضي → ولّده تلقائيًا QSXXXX (بدون شرطة)
  const code = normalizeCode(payload.code) || generateOfferCodeQS(4);
  const codeKey = code; // ✅ ثابت (Uppercase)

  const active = Boolean(payload.active);
  const usageCount = Number(payload.usageCount ?? 0);

  await setDoc(
    ref,
    {
      ...payload,

      // ✅ حقول موحدة
      code,
      codeKey,

      active,
      isActive: active, // ✅ للتوافق مع أي كود قديم

      usageCount,

      appliesTo: (payload.appliesTo as any) || "all",
      serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
      sequenceSteps: Array.isArray((payload as any).sequenceSteps)
        ? (payload as any).sequenceSteps
            .map((x: any) => ({
              ...(() => {
                const serviceId = String(x?.serviceId || "").trim();
                const orderIndex = Number(x?.orderIndex || 0);
                const gapAfterMin = Math.max(0, Number(x?.gapAfterMin || 0));
                const titleSnapshot = String(x?.titleSnapshot || "").trim();
                return titleSnapshot
                  ? { serviceId, orderIndex, gapAfterMin, titleSnapshot }
                  : { serviceId, orderIndex, gapAfterMin };
              })(),
            }))
            .filter((x: any) => x.serviceId)
            .sort((a: any, b: any) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0))
        : [],

      updatedAt: serverTimestamp(),
      createdAt: payload.createdAt ?? serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const wasDeleted = Boolean((before as any)?.deletedAt);
    const isDeletedNow = Boolean((offer as any)?.deletedAt);
    const action = !before ? "offer_created" : isDeletedNow && !wasDeleted ? "offer_deleted" : "offer_updated";

    await writeAuditLog({
      salonId,
      action,
      entityType: "offer",
      entityId: offer.id,
      description:
        action === "offer_created"
          ? "تم إنشاء عرض"
          : action === "offer_deleted"
          ? "تم حذف العرض (نقل للمحذوفات)"
          : "تم تعديل العرض",
      source: "dashboard",
      before,
      after: {
        id: offer.id,
        title: offer.title,
        code: offer.code,
        discountType: offer.discountType,
        value: offer.value,
        active: offer.active,
        startDate: offer.startDate || "",
        endDate: offer.endDate || "",
        appliesTo: offer.appliesTo || "all",
        serviceIds: Array.isArray(offer.serviceIds) ? offer.serviceIds : [],
        deletedAt: (offer as any)?.deletedAt ?? null,
      },
      meta: {
        code: offer.code,
        deletedAt: (offer as any)?.deletedAt ?? null,
      },
    });
  } catch {
    // ignore
  }
}

/**
 * ✅ حذف عرض
 * - ممنوع إذا usageCount > 0 (عشان ما نكسر السجل/التقارير)
 */
export async function removeOffer(id: string, salonId = DEFAULT_SALON_ID) {
  const ref = doc(db, "salons", salonId, "offers", id);
  const beforeSnap = await getDoc(ref);
  const before = beforeSnap.exists() ? beforeSnap.data() : null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const data = snap.data() as any;
    const used = Number(data?.usageCount ?? 0);

    if (used > 0) {
      // ✅ ممنوع حذف بعد الاستخدام
      throw new Error("لا يمكن حذف العرض بعد استخدامه. يمكنك إيقافه أو أرشفته.");
    }

    tx.delete(ref);
  });

  try {
    await writeAuditLog({
      salonId,
      action: "offer_deleted",
      entityType: "offer",
      entityId: id,
      description: "تم حذف العرض نهائيًا",
      source: "dashboard",
      before,
      after: null,
      meta: {
        hardDelete: true,
      },
    });
  } catch {
    // ignore
  }
}

/**
 * ✅ جلب عرض فعّال عن طريق الكود
 * - يبحث عن codeKey + active=true
 * - ويتأكد أن التاريخ داخل startDate/endDate
 */
export async function findActiveOfferByCode(
  salonId: string,
  codeRaw: string
): Promise<Offer | null> {
  const code = normalizeCode(codeRaw);
  if (!code) return null;

  const q = query(
    offersCol(salonId),
    where("codeKey", "==", code),
    where("active", "==", true),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const d0 = snap.docs[0];
  const data = d0.data() as any;

  // ✅ أهم نقطة: التواريخ الآن تُطبق فعليًا
  if (!isOfferActiveNow({ ...data, active: true })) return null;

  return { id: d0.id, ...data } as Offer;
}

/**
 * ✅ يزيد usageCount للعرض بعد تطبيقه بنجاح
 * - Transaction آمن مع التزامن
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
