// src/services/OfferEngine.ts
import { db } from "./firebase";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

export type DiscountType = "PERCENT" | "FIXED";

export interface Offer {
  id: string;
  title: string;
  code?: string;
  isActive: boolean;

  appliesToAllServices?: boolean;
  serviceIds?: string[];
  employeeIds?: string[];
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD

  autoApply?: boolean;

  discountType: DiscountType;
  discountValue: number;
}

export interface ApplyOfferInput {
  basePrice: number;
  serviceId?: string;
  employeeId?: string;
  dateISO?: string;
}

export interface AppliedOfferResult {
  offer: Offer | null;
  discountAmount: number;
  finalPrice: number;
  reason?: string;
}

const SALON_ID = "main";

const safeNumber = (n: any, fallback = 0) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
};

const toDiscountType = (raw: any): DiscountType => {
  const v = String(raw ?? "").toUpperCase();
  return v === "PERCENT" ? "PERCENT" : "FIXED";
};

function normalizeOffer(raw: any, id: string): Offer | null {
  if (!raw) return null;

  return {
    id,
    title: String(raw.title ?? ""),
    code: raw.code ? String(raw.code).toUpperCase() : undefined,
    isActive: Boolean(raw.isActive),

    appliesToAllServices: raw.appliesToAllServices ?? false,
    serviceIds: Array.isArray(raw.serviceIds) ? raw.serviceIds : undefined,
    employeeIds: Array.isArray(raw.employeeIds) ? raw.employeeIds : undefined,
    startDate: raw.startDate,
    endDate: raw.endDate,

    autoApply: Boolean(raw.autoApply),

    discountType: toDiscountType(raw.discountType),
    discountValue: safeNumber(raw.discountValue),
  };
}

async function fetchOffers(): Promise<Offer[]> {
  const col = collection(db, "salons", SALON_ID, "offers");
  const q = query(col, where("isActive", "==", true));
  const snap = await getDocs(q);

  const list: Offer[] = [];
  snap.forEach((d) => {
    const o = normalizeOffer(d.data(), d.id);
    if (o) list.push(o);
  });
  return list;
}

const inRange = (offer: Offer, dateISO?: string) => {
  if (!dateISO) return true;
  if (offer.startDate && dateISO < offer.startDate) return false;
  if (offer.endDate && dateISO > offer.endDate) return false;
  return true;
};

const matches = (list?: string[], value?: string) => {
  if (!list || list.length === 0) return true;
  if (!value) return false;
  return list.includes(value);
};

const offerMatches = (offer: Offer, input: ApplyOfferInput) => {
  if (!offer.isActive) return false;
  if (!inRange(offer, input.dateISO)) return false;

  if (!offer.appliesToAllServices) {
    if (!matches(offer.serviceIds, input.serviceId)) return false;
  }

  if (offer.employeeIds?.length) {
    if (!matches(offer.employeeIds, input.employeeId)) return false;
  }

  return true;
};

const calcDiscount = (base: number, offer: Offer) => {
  const val = Math.max(0, safeNumber(offer.discountValue));
  if (offer.discountType === "PERCENT") {
    return Math.min(base, (base * Math.min(100, val)) / 100);
  }
  return Math.min(base, val);
};

export async function applyBestAutoOffer(
  input: ApplyOfferInput
): Promise<AppliedOfferResult> {
  const basePrice = Math.max(0, safeNumber(input.basePrice));
  const offers = await fetchOffers();

  const candidates = offers
    .filter((o) => o.autoApply)
    .filter((o) => offerMatches(o, input));

  if (!candidates.length) {
    return { offer: null, discountAmount: 0, finalPrice: basePrice };
  }

  let best = candidates[0];
  let bestDiscount = calcDiscount(basePrice, best);

  for (let i = 1; i < candidates.length; i++) {
    const d = calcDiscount(basePrice, candidates[i]);
    if (d > bestDiscount) {
      best = candidates[i];
      bestDiscount = d;
    }
  }

  return {
    offer: best,
    discountAmount: bestDiscount,
    finalPrice: basePrice - bestDiscount,
  };
}

export async function applyCodeOffer(
  code: string,
  input: ApplyOfferInput
): Promise<AppliedOfferResult> {
  const basePrice = Math.max(0, safeNumber(input.basePrice));
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) {
    return { offer: null, discountAmount: 0, finalPrice: basePrice, reason: "اكتب كود الخصم" };
  }

  const offers = await fetchOffers();
  const matched = offers.find((o) => o.code === c);

  if (!matched) {
    return { offer: null, discountAmount: 0, finalPrice: basePrice, reason: "الكود غير صحيح" };
  }

  if (!offerMatches(matched, input)) {
    return {
      offer: null,
      discountAmount: 0,
      finalPrice: basePrice,
      reason: "الكود غير متاح لهذا الحجز",
    };
  }

  const discountAmount = calcDiscount(basePrice, matched);

  return {
    offer: matched,
    discountAmount,
    finalPrice: basePrice - discountAmount,
    reason: "تم تطبيق الخصم",
  };
}
