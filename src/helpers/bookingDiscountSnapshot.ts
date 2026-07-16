export type DiscountSnapshotSource = "none" | "manual" | "offer" | "coupon";
export type DiscountSnapshotType = "none" | "fixed" | "percent";

export type DiscountItemInput = {
  bookingItemId?: string;
  serviceId: string;
  categoryId?: string;
  originalAmountHalalas: number;
};

export type DiscountOfferLike = {
  id?: string;
  code?: string | null;
  codeKey?: string | null;
  title?: string;
  name?: string;
  description?: string | null;
  discountType?: "fixed" | "percent" | string;
  type?: "fixed" | "percent" | string;
  value?: number;
  percentage?: number;
  active?: boolean;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  usedCount?: number;
  usageCount?: number;
  minOrderHalalas?: number | null;
  minimumOrderHalalas?: number | null;
  minimumSubtotalHalalas?: number | null;
  maxDiscountHalalas?: number | null;
  appliesTo?: string;
  serviceIds?: string[];
  categoryIds?: string[];
};

export type DiscountBuildRequest = {
  source: DiscountSnapshotSource;
  type?: DiscountSnapshotType;
  sourceId?: string | null;
  code?: string | null;
  title?: string | null;
  value?: number;
  percentage?: number;
  maxDiscountHalalas?: number | null;
  offer?: DiscountOfferLike | null;
  appliedBy?: string | null;
  appliedAt?: string;
  now?: Date;
};

export type DiscountAllocationSnapshot = {
  serviceId: string;
  bookingItemId?: string;
  originalAmountHalalas: number;
  discountAmountHalalas: number;
  finalAmountHalalas: number;
};

export type DiscountSnapshot = {
  type: DiscountSnapshotType;
  source: DiscountSnapshotSource;
  sourceId?: string | null;
  code?: string | null;
  title?: string | null;
  value?: number;
  percentage?: number;
  amountHalalas: number;
  eligibleSubtotalHalalas: number;
  maxDiscountHalalas?: number | null;
  appliedAt: string;
  appliedBy?: string | null;
  allocations: DiscountAllocationSnapshot[];
};

export type DiscountBuildResult = {
  ok: boolean;
  reason: string;
  subtotalHalalas: number;
  discountHalalas: number;
  totalHalalas: number;
  eligibleSubtotalHalalas: number;
  snapshot: DiscountSnapshot | null;
  allocations: DiscountAllocationSnapshot[];
};

export function normalizeDiscountCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function toHalalas(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

export function halalasToSar(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function dateOnly(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function isDateActive(offer: DiscountOfferLike, now: Date): boolean {
  const today = dateOnly(now.toISOString());
  const startsAt = dateOnly(offer.startsAt || offer.startDate);
  const endsAt = dateOnly(offer.endsAt || offer.endDate);
  if (startsAt && today < startsAt) return false;
  if (endsAt && today > endsAt) return false;
  return true;
}

function offerType(offer: DiscountOfferLike | null | undefined): DiscountSnapshotType {
  const raw = cleanText(offer?.type || offer?.discountType).toLowerCase();
  return raw === "percent" ? "percent" : raw === "fixed" ? "fixed" : "none";
}

function offerValue(offer: DiscountOfferLike | null | undefined): number {
  const value = Number(offer?.value ?? offer?.percentage ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)))
    : [];
}

function itemIsEligible(item: DiscountItemInput, request: DiscountBuildRequest): boolean {
  const offer = request.offer;
  const source = request.source;
  if (source === "none") return false;
  if (!offer) return true;

  const appliesTo = cleanText(offer.appliesTo || "all").toLowerCase();
  const serviceIds = uniqueStrings(offer.serviceIds);
  const categoryIds = uniqueStrings(offer.categoryIds);

  if (appliesTo === "services" || serviceIds.length) {
    return serviceIds.includes(cleanText(item.serviceId));
  }
  if (appliesTo === "categories" || categoryIds.length) {
    return categoryIds.includes(cleanText(item.categoryId));
  }
  return true;
}

function allocateDiscount(items: DiscountItemInput[], amountHalalas: number): DiscountAllocationSnapshot[] {
  const eligible = items.filter((item) => Number(item.originalAmountHalalas || 0) > 0);
  const eligibleSubtotal = eligible.reduce((sum, item) => sum + Math.max(0, Math.round(item.originalAmountHalalas || 0)), 0);
  if (!eligible.length || amountHalalas <= 0 || eligibleSubtotal <= 0) {
    return items.map((item) => ({
      serviceId: cleanText(item.serviceId),
      bookingItemId: cleanText(item.bookingItemId) || undefined,
      originalAmountHalalas: Math.max(0, Math.round(item.originalAmountHalalas || 0)),
      discountAmountHalalas: 0,
      finalAmountHalalas: Math.max(0, Math.round(item.originalAmountHalalas || 0)),
    }));
  }

  let allocated = 0;
  return items.map((item, index) => {
    const original = Math.max(0, Math.round(item.originalAmountHalalas || 0));
    const isEligible = eligible.includes(item);
    let discount = 0;
    if (isEligible) {
      const eligibleIndex = eligible.indexOf(item);
      if (eligibleIndex === eligible.length - 1) {
        discount = Math.max(0, amountHalalas - allocated);
      } else {
        discount = Math.floor((amountHalalas * original) / eligibleSubtotal);
        allocated += discount;
      }
    }
    discount = Math.min(original, discount);
    return {
      serviceId: cleanText(item.serviceId),
      bookingItemId: cleanText(item.bookingItemId) || `item_${index}`,
      originalAmountHalalas: original,
      discountAmountHalalas: discount,
      finalAmountHalalas: Math.max(0, original - discount),
    };
  });
}

export function buildDiscountSnapshot(
  allItems: DiscountItemInput[],
  request: DiscountBuildRequest
): DiscountBuildResult {
  const items = Array.isArray(allItems)
    ? allItems.map((item) => ({
        ...item,
        serviceId: cleanText(item.serviceId),
        categoryId: cleanText(item.categoryId) || undefined,
        bookingItemId: cleanText(item.bookingItemId) || undefined,
        originalAmountHalalas: Math.max(0, Math.round(item.originalAmountHalalas || 0)),
      }))
    : [];
  const subtotalHalalas = items.reduce((sum, item) => sum + item.originalAmountHalalas, 0);
  const now = request.now || new Date();
  const source = request.source || "none";

  if (source === "none") {
    return {
      ok: true,
      reason: "",
      subtotalHalalas,
      discountHalalas: 0,
      totalHalalas: subtotalHalalas,
      eligibleSubtotalHalalas: 0,
      snapshot: null,
      allocations: allocateDiscount(items, 0),
    };
  }

  const offer = request.offer || null;
  if (offer) {
    const active = offer.active === true || offer.isActive === true;
    if (!active) return invalid("discount_inactive", subtotalHalalas, items);
    if (!isDateActive(offer, now)) return invalid("discount_expired_or_not_started", subtotalHalalas, items);
    if (offer.usageLimit != null && Number(offer.usedCount ?? offer.usageCount ?? 0) >= Number(offer.usageLimit)) {
      return invalid("discount_usage_limit_reached", subtotalHalalas, items);
    }
  }

  const eligibleItems = items.filter((item) => itemIsEligible(item, request));
  const eligibleSubtotalHalalas = eligibleItems.reduce((sum, item) => sum + item.originalAmountHalalas, 0);
  if (eligibleSubtotalHalalas <= 0) return invalid("discount_no_eligible_services", subtotalHalalas, items);

  const minOrderHalalas = Math.max(
    0,
    Math.round(
      Number(
        offer?.minOrderHalalas ??
          offer?.minimumOrderHalalas ??
          offer?.minimumSubtotalHalalas ??
          0
      ) || 0
    )
  );
  if (minOrderHalalas > 0 && eligibleSubtotalHalalas < minOrderHalalas) {
    return invalid("discount_minimum_not_met", subtotalHalalas, items, eligibleSubtotalHalalas);
  }

  const type = offer ? offerType(offer) : request.type || "none";
  if (type !== "fixed" && type !== "percent") return invalid("discount_invalid_type", subtotalHalalas, items, eligibleSubtotalHalalas);

  const rawValue = offer ? offerValue(offer) : Number(request.value ?? request.percentage ?? 0);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return invalid("discount_invalid_value", subtotalHalalas, items, eligibleSubtotalHalalas);
  if (type === "percent" && rawValue > 100) return invalid("discount_percent_over_100", subtotalHalalas, items, eligibleSubtotalHalalas);

  const requestedAmount =
    type === "percent"
      ? Math.floor((eligibleSubtotalHalalas * rawValue) / 100)
      : toHalalas(rawValue);
  const maxDiscountHalalasRaw = Math.max(
    0,
    Math.round(Number(request.maxDiscountHalalas ?? offer?.maxDiscountHalalas ?? 0) || 0)
  );
  const cappedByMax = maxDiscountHalalasRaw > 0 ? Math.min(requestedAmount, maxDiscountHalalasRaw) : requestedAmount;
  const discountHalalas = Math.max(0, Math.min(eligibleSubtotalHalalas, cappedByMax));
  if (discountHalalas <= 0) return invalid("discount_zero", subtotalHalalas, items, eligibleSubtotalHalalas);

  const allocations = allocateDiscount(
    items.filter((item) => itemIsEligible(item, request)),
    discountHalalas
  );
  const allocationByItem = new Map(
    allocations.map((row) => [row.bookingItemId || row.serviceId, row])
  );
  const fullAllocations = items.map((item, index) => {
    const key = cleanText(item.bookingItemId) || `item_${index}`;
    const matched = allocationByItem.get(key) || allocationByItem.get(item.serviceId);
    if (matched) return { ...matched, bookingItemId: key };
    return {
      serviceId: item.serviceId,
      bookingItemId: key,
      originalAmountHalalas: item.originalAmountHalalas,
      discountAmountHalalas: 0,
      finalAmountHalalas: item.originalAmountHalalas,
    };
  });

  const sourceId = cleanText(request.sourceId || offer?.id) || null;
  const code = normalizeDiscountCode(request.code || offer?.code || offer?.codeKey) || null;
  const title = cleanText(request.title || offer?.title || offer?.name) || null;
  const snapshot: DiscountSnapshot = {
    type,
    source,
    sourceId,
    code,
    title,
    value: type === "fixed" ? rawValue : undefined,
    percentage: type === "percent" ? rawValue : undefined,
    amountHalalas: discountHalalas,
    eligibleSubtotalHalalas,
    maxDiscountHalalas: maxDiscountHalalasRaw || null,
    appliedAt: request.appliedAt || now.toISOString(),
    appliedBy: cleanText(request.appliedBy) || null,
    allocations: fullAllocations,
  };

  return {
    ok: true,
    reason: "",
    subtotalHalalas,
    discountHalalas,
    totalHalalas: Math.max(0, subtotalHalalas - discountHalalas),
    eligibleSubtotalHalalas,
    snapshot,
    allocations: fullAllocations,
  };
}

function invalid(
  reason: string,
  subtotalHalalas: number,
  items: DiscountItemInput[],
  eligibleSubtotalHalalas = 0
): DiscountBuildResult {
  return {
    ok: false,
    reason,
    subtotalHalalas,
    discountHalalas: 0,
    totalHalalas: subtotalHalalas,
    eligibleSubtotalHalalas,
    snapshot: null,
    allocations: allocateDiscount(items, 0),
  };
}
