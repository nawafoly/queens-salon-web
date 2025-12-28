// src/services/OfferService.ts
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

export type OfferStatus = "ACTIVE" | "EXPIRED" | "DRAFT";

export interface OfferRecord {
  id: string;
  title: string;
  description: string;
  originalPrice: number;
  discountPrice: number;
  discountPercent: number;
  validUntil: string; // YYYY-MM-DD
  badge: string;
  features: string[];

  imageSrc: string;
  imageAlt?: string;

  status?: OfferStatus;
  createdAt: number;
  updatedAt: number;
}

const SALON_ID = "main";

function offersCol() {
  return collection(db, "salons", SALON_ID, "offers");
}

function toMillis(v: any): number {
  if (v?.toMillis) return v.toMillis();
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function normalizeOffer(raw: any, id: string): OfferRecord {
  const createdAtMs = toMillis(raw?.createdAt);
  const updatedAtMs = toMillis(raw?.updatedAt);

  return {
    id,
    title: String(raw?.title ?? ""),
    description: String(raw?.description ?? ""),
    originalPrice: Number(raw?.originalPrice ?? 0),
    discountPrice: Number(raw?.discountPrice ?? 0),
    discountPercent: Number(raw?.discountPercent ?? 0),
    validUntil: String(raw?.validUntil ?? ""),
    badge: String(raw?.badge ?? ""),
    features: Array.isArray(raw?.features) ? raw.features : [],
    imageSrc: String(raw?.imageSrc ?? ""),
    imageAlt: raw?.imageAlt ? String(raw.imageAlt) : undefined,
    status: raw?.status ?? "DRAFT",
    createdAt: createdAtMs || Date.now(),
    updatedAt: updatedAtMs || Date.now(),
  };
}

/** ✅ جلب العروض */
export async function listOffersFS(): Promise<OfferRecord[]> {
  try {
    const q = query(offersCol(), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeOffer(d.data(), d.id));
  } catch {
    const snap = await getDocs(offersCol());
    const items = snap.docs.map((d) => normalizeOffer(d.data(), d.id));
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }
}

/** ✅ إضافة / تحديث */
export async function upsertOfferFS(offer: OfferRecord) {
  const ref = doc(db, "salons", SALON_ID, "offers", offer.id);

  await setDoc(
    ref,
    {
      title: offer.title,
      description: offer.description,
      originalPrice: offer.originalPrice,
      discountPrice: offer.discountPrice,
      discountPercent: offer.discountPercent,
      validUntil: offer.validUntil,
      badge: offer.badge,
      features: offer.features,
      imageSrc: offer.imageSrc,
      imageAlt: offer.imageAlt ?? undefined,
      status: offer.status ?? "DRAFT",
      createdAt: offer.createdAt
        ? Timestamp.fromMillis(offer.createdAt)
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** ✅ حذف */
export async function removeOfferFS(id: string) {
  await deleteDoc(doc(db, "salons", SALON_ID, "offers", id));
}
