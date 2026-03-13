import type { Offer } from "../services/firestoreOffers";
import type { CartItem } from "../types/bookingShared";
import {
  calcManualDiscount,
  isLegacyPackageLinkedOffer,
  normalizeCouponCode,
} from "./bookingPaymentUtils";

type DiscountType = "fixed" | "percent";

type CartItemPriceLike = Pick<CartItem, "basePrice">;
type CartItemOfferLike = Pick<CartItem, "basePrice" | "serviceId">;

export type SavedOfferDropdownOption = {
  value: string;
  label: string;
};

export type AppliedDiscountState = {
  discountType: DiscountType | null;
  discountValue: number;
  title: string;
  discountAmount: number;
  finalPrice: number;
  offerId: string | null;
  couponCode: string;
  applicableItemIndexes: number[];
};

export function sortSelectableOffers(rows: Offer[] | null | undefined): Offer[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((offer) => !isLegacyPackageLinkedOffer(offer))
    .sort((a, b) => {
      const at = Number((a as any)?.updatedAt?.seconds || (a as any)?.createdAt?.seconds || 0);
      const bt = Number((b as any)?.updatedAt?.seconds || (b as any)?.createdAt?.seconds || 0);
      return bt - at;
    });
}

export function buildSavedOffersDropdownOptions(
  offers: Offer[] | null | undefined
): SavedOfferDropdownOption[] {
  return [
    { value: "", label: "بدون خصم محفوظ" },
    ...(Array.isArray(offers) ? offers : []).map((offer) => {
      const id = String((offer as any)?.id || "").trim();
      const code = normalizeCouponCode((offer as any)?.code);
      const title = String((offer as any)?.title || "").trim() || "عرض";
      const kind =
        String((offer as any)?.discountType || "").trim() === "percent"
          ? `${Number((offer as any)?.value || 0)}%`
          : `${Number((offer as any)?.value || 0)} ريال`;
      return {
        value: id,
        label: `${title}${code ? ` (${code})` : ""} - ${kind}`,
      };
    }),
  ];
}

export function findSelectedOfferById(
  offers: Offer[] | null | undefined,
  selectedOfferId: string
): Offer | null {
  const id = String(selectedOfferId || "").trim();
  if (!id) return null;
  return (Array.isArray(offers) ? offers : []).find(
    (offer) => String((offer as any)?.id || "").trim() === id
  ) || null;
}

export function resolveDiscountApplicableIndexes(
  items: CartItemOfferLike[] | null | undefined,
  selectedOffer: Offer | null,
  offerAppliesToService: (offer: Offer, serviceId: string) => boolean
): number[] {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return [];
  if (!selectedOffer) return rows.map((_, idx) => idx);

  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const serviceId = String(rows[i]?.serviceId || "").trim();
    if (!serviceId) continue;
    if (offerAppliesToService(selectedOffer, serviceId)) out.push(i);
  }
  return out;
}

export function sumDiscountBasePrice(
  items: CartItemPriceLike[] | null | undefined,
  discountApplicableIndexes: number[]
): number {
  const rows = Array.isArray(items) ? items : [];
  if (!discountApplicableIndexes.length) return 0;
  return discountApplicableIndexes.reduce((sum, idx) => {
    const row = rows[idx];
    return sum + Number(row?.basePrice || 0);
  }, 0);
}

export function buildAppliedDiscountState(args: {
  basePrice: number;
  cartItemCount: number;
  discountApplicableIndexes: number[];
  discountBasePrice: number;
  manualDiscountType: "" | DiscountType;
  manualDiscountValue: string;
  selectedOffer: Offer | null;
}): { applied: AppliedDiscountState; warningMessage: string } {
  const usingOffer = !!args.selectedOffer;
  const rawValue = usingOffer
    ? Number((args.selectedOffer as any)?.value || 0)
    : Number(args.manualDiscountValue);
  const sourceTypeRaw = usingOffer
    ? String((args.selectedOffer as any)?.discountType || "").trim()
    : args.manualDiscountType;
  const hasType = sourceTypeRaw === "fixed" || sourceTypeRaw === "percent";
  const sourceType = hasType ? (sourceTypeRaw as DiscountType) : null;
  const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
  const warningParts: string[] = [];

  if (sourceType === "percent" && value > 100) {
    warningParts.push("نسبة الخصم لا يمكن أن تتجاوز 100%.");
  }
  if (usingOffer && args.discountApplicableIndexes.length === 0 && args.cartItemCount > 0) {
    warningParts.push("العرض المحدد لا ينطبق على الخدمات الموجودة في السلة.");
  }

  const normalizedValue = sourceType === "percent" ? Math.min(100, value) : value;
  const calc = calcManualDiscount(args.discountBasePrice, sourceType, normalizedValue);
  const code = usingOffer ? normalizeCouponCode((args.selectedOffer as any)?.code) : "";
  const title = usingOffer
    ? String((args.selectedOffer as any)?.title || "").trim() || (code ? `كود ${code}` : "عرض محفوظ")
    : hasType && normalizedValue > 0
      ? sourceType === "percent"
        ? `خصم يدوي (${normalizedValue.toFixed(0)}%)`
        : `خصم يدوي (${normalizedValue.toFixed(0)} ريال)`
      : "";

  const discountAmount = calc.discountAmount;
  return {
    applied: {
      discountType: sourceType,
      discountValue: normalizedValue,
      title,
      discountAmount,
      finalPrice: Math.max(0, Number(args.basePrice || 0) - Number(discountAmount || 0)),
      offerId: usingOffer ? String((args.selectedOffer as any)?.id || "").trim() || null : null,
      couponCode: usingOffer ? code : "",
      applicableItemIndexes: args.discountApplicableIndexes,
    },
    warningMessage: warningParts.join(" "),
  };
}

export function allocateDiscountAcrossItems(
  items: CartItemPriceLike[] | null | undefined,
  discountTotal: number
): number[] {
  const rows = Array.isArray(items) ? items : [];
  const total = rows.reduce((sum, item) => sum + Number(item?.basePrice || 0), 0);
  if (!total || !discountTotal) return rows.map(() => 0);

  const raw = rows.map((item) => (Number(item?.basePrice || 0) / total) * discountTotal);
  const rounded = raw.map((value) => Math.floor(value));
  const used = rounded.reduce((sum, value) => sum + value, 0);
  let remaining = Math.max(0, Math.round(discountTotal - used));

  let i = 0;
  while (remaining > 0 && rows.length) {
    rounded[i % rows.length] += 1;
    remaining -= 1;
    i += 1;
  }

  return rounded;
}
