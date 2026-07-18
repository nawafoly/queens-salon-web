// Compatibility facade retained temporarily so existing pages do not need a
// simultaneous rename. All operational offer reads and writes go to Core D1.
// Firebase Authentication remains handled by coreApiClient only.
import { CoreOfferService } from "./CoreOfferService";
import type { CoreDiscount } from "../types/coreApi";

export type DiscountType = "fixed" | "percent";
export type OfferAppliesTo = "all" | "services" | "categories";

export type OfferSequenceStep = {
  serviceId: string;
  orderIndex: number;
  gapAfterMin: number;
  titleSnapshot?: string;
};

export type Offer = {
  id: string;
  title: string;
  code: string;
  codeKey?: string;
  discountType: DiscountType;
  value: number;
  startDate?: string;
  endDate?: string;
  active: boolean;
  appliesTo?: OfferAppliesTo;
  serviceIds?: string[];
  sequenceSteps?: OfferSequenceStep[];
  usageCount?: number;
  usageLimit?: number | null;
  minOrderHalalas?: number | null;
  maxDiscountHalalas?: number | null;
  perClientLimit?: number | null;
  categoryIds?: string[];
  imageUrl?: string;
  description?: string;
  priceBeforeHalalas?: number | null;
  priceAfterHalalas?: number | null;
  published?: boolean;
  status?: "draft" | "scheduled" | "active" | "expired" | "disabled" | string;
  sortOrder?: number;
  ctaLabel?: string;
  ctaUrl?: string;
  targetScope?: "all" | "specific" | string;
  targetClientIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
  isActive?: boolean;
};

const DEFAULT_SALON_ID = "main";

export type OfferDataSourceMode = "auto" | "core";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function localISODate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDateISO(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const prefix = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/)?.[1];
    if (prefix) return prefix;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : localISODate(parsed);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : localISODate(value);
  }

  const timestampLike = value as {
    toDate?: () => Date;
    seconds?: number;
    _seconds?: number;
  };

  if (typeof timestampLike?.toDate === "function") {
    return normalizeDateISO(timestampLike.toDate());
  }

  const seconds = Number(
    timestampLike?.seconds ?? timestampLike?._seconds ?? Number.NaN
  );
  if (Number.isFinite(seconds)) {
    return normalizeDateISO(new Date(seconds * 1000));
  }

  return "";
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function isOfferActiveNow(offerLike: {
  startDate?: unknown;
  endDate?: unknown;
  active?: boolean;
  isActive?: boolean;
}) {
  const activeFlag =
    offerLike?.active === true || offerLike?.isActive === true;
  if (!activeFlag) return false;

  const now = new Date();
  const startDate = normalizeDateISO(offerLike?.startDate);
  const endDate = normalizeDateISO(offerLike?.endDate);

  if (startDate && now < new Date(`${startDate}T00:00:00`)) return false;
  if (
    endDate &&
    now > endOfDay(new Date(`${endDate}T00:00:00`))
  ) {
    return false;
  }

  return true;
}

export function offerAppliesToService(
  offer: Offer,
  serviceIdRaw: string
): boolean {
  const mode: OfferAppliesTo = offer.appliesTo || "all";
  if (mode === "all") return true;
  if (mode === "categories") return false;

  const serviceId = text(serviceIdRaw);
  return (offer.serviceIds || []).map(text).includes(serviceId);
}

export function generateOfferCodeQS(length = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "QS";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

function normalizeCode(value: unknown): string {
  return text(value).toUpperCase();
}

function coreDiscountToOffer(row: CoreDiscount): Offer {
  return {
    id: row.id,
    title: row.name,
    code: row.code || "",
    codeKey: row.codeKey || row.code || "",
    discountType: row.type,
    value: row.value,
    startDate: row.startsAt || undefined,
    endDate: row.endsAt || undefined,
    active: row.active,
    isActive: row.active,
    appliesTo: row.appliesTo,
    serviceIds: row.serviceIds || [],
    sequenceSteps: (row.sequenceSteps || [])
      .map((step, index) => ({
        serviceId: text(step.serviceId),
        orderIndex: Number(step.orderIndex ?? index),
        gapAfterMin: Math.max(0, Number(step.gapAfterMin || 0)),
        ...(text(step.titleSnapshot)
          ? { titleSnapshot: text(step.titleSnapshot) }
          : {}),
      }))
      .filter((step) => step.serviceId),
    usageCount: row.usedCount,
    usageLimit: row.usageLimit ?? null,
    minOrderHalalas: row.minOrderHalalas ?? null,
    maxDiscountHalalas: row.maxDiscountHalalas ?? null,
    perClientLimit: row.perClientLimit ?? null,
    categoryIds: row.categoryIds || [],
    imageUrl: row.imageUrl || undefined,
    description: row.description || undefined,
    priceBeforeHalalas: row.priceBeforeHalalas ?? null,
    priceAfterHalalas: row.priceAfterHalalas ?? null,
    published: row.published,
    status: row.status,
    sortOrder: row.sortOrder,
    ctaLabel: row.ctaLabel || undefined,
    ctaUrl: row.ctaUrl || undefined,
    targetScope: row.targetScope || "all",
    targetClientIds: row.targetClientIds || [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt || undefined,
  };
}

function offerToCore(offer: Offer): Record<string, unknown> {
  const code = normalizeCode(offer.code) || generateOfferCodeQS(4);
  const startDate = normalizeDateISO(offer.startDate);
  const endDate = normalizeDateISO(offer.endDate);

  return {
    id: text(offer.id),
    name: text(offer.title) || "\u0639\u0631\u0636",
    title: text(offer.title) || "\u0639\u0631\u0636",
    code,
    codeKey: code,
    type: offer.discountType,
    discountType: offer.discountType,
    value: Math.max(0, Number(offer.value || 0)),
    active: offer.active === true,
    startsAt: startDate || null,
    endsAt: endDate || null,
    startDate: startDate || null,
    endDate: endDate || null,
    usedCount: Math.max(0, Number(offer.usageCount || 0)),
    usageLimit: offer.usageLimit ?? null,
    minOrderHalalas: offer.minOrderHalalas ?? null,
    maxDiscountHalalas: offer.maxDiscountHalalas ?? null,
    perClientLimit: offer.perClientLimit ?? null,
    appliesTo: offer.appliesTo || "all",
    serviceIds: (offer.serviceIds || []).map(text).filter(Boolean),
    categoryIds: (offer.categoryIds || []).map(text).filter(Boolean),
    sequenceSteps: (offer.sequenceSteps || [])
      .map((step, index) => ({
        serviceId: text(step.serviceId),
        orderIndex: Number(step.orderIndex ?? index),
        gapAfterMin: Math.max(0, Number(step.gapAfterMin || 0)),
        ...(text(step.titleSnapshot)
          ? { titleSnapshot: text(step.titleSnapshot) }
          : {}),
      }))
      .filter((step) => step.serviceId),
    imageUrl: text(offer.imageUrl) || null,
    description: text(offer.description) || null,
    priceBeforeHalalas: offer.priceBeforeHalalas ?? null,
    priceAfterHalalas: offer.priceAfterHalalas ?? null,
    published: offer.published !== false,
    status:
      offer.status ||
      (offer.active ? "active" : "disabled"),
    sortOrder: Math.max(0, Number(offer.sortOrder || 0)),
    ctaLabel: text(offer.ctaLabel) || null,
    ctaUrl: text(offer.ctaUrl) || null,
    targetScope: offer.targetScope || "all",
    targetClientIds: (offer.targetClientIds || [])
      .map(text)
      .filter(Boolean),
    deletedAt: offer.deletedAt || null,
  };
}

export async function listOffers(
  _salonId = DEFAULT_SALON_ID,
  _mode: OfferDataSourceMode = "auto"
): Promise<Offer[]> {
  const rows = await CoreOfferService.list({ includeDeleted: true });
  return rows.map(coreDiscountToOffer);
}

export async function upsertOffer(
  offer: Offer,
  _salonId = DEFAULT_SALON_ID
): Promise<void> {
  const payload = offerToCore(offer);
  const rows = await CoreOfferService.list({ includeDeleted: true });
  const exists = rows.some((row) => row.id === offer.id);

  if (exists) {
    await CoreOfferService.patch(offer.id, payload);
  } else {
    await CoreOfferService.create(payload);
  }
}

export async function removeOffer(
  idRaw: string,
  _salonId = DEFAULT_SALON_ID
): Promise<void> {
  const id = text(idRaw);
  if (!id) return;
  await CoreOfferService.remove(id);
}

export async function findActiveOfferByCode(
  _salonId: string,
  codeRaw: string,
  _mode: OfferDataSourceMode = "auto"
): Promise<Offer | null> {
  const code = normalizeCode(codeRaw);
  if (!code) return null;

  const [row] = await CoreOfferService.list({
    active: true,
    code,
  });
  if (!row) return null;

  const offer = coreDiscountToOffer(row);
  return isOfferActiveNow(offer) ? offer : null;
}

export async function incrementOfferUsage(
  _salonId: string,
  offerIdRaw: string
): Promise<void> {
  const offerId = text(offerIdRaw);
  if (!offerId) return;
  await CoreOfferService.incrementUsage(offerId);
}