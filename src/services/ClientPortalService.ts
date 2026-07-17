import { coreApiRequest } from "./coreApiClient";

export type ClientPortalBookingItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName?: string;
  quantity: number;
  unitPriceHalalas: number;
  totalHalalas: number;
  packageCovered: boolean;
  clientPackageId?: string;
  bookingDate?: string;
  startTime?: string;
  endTime?: string;
};

export type ClientPortalBooking = {
  id: string;
  publicId?: string;
  clientId: string;
  clientName?: string;
  clientPhone?: string;
  staffId?: string;
  staffName?: string;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  status: string;
  originalStatus?: string;
  notes?: string;
  totalHalalas: number;
  paidHalalas: number;
  refundedHalalas: number;
  paymentStatus: string;
  paymentMethod?: string;
  packageSessionsUsed: number;
  invoiceNumber?: string;
  createdAt?: string;
  updatedAt?: string;
  items: ClientPortalBookingItem[];
};

export type ClientPortalProfile = {
  id: string;
  name: string;
  phoneNormalized?: string;
  email?: string;
  firebaseUid?: string;
  createdAt?: string;
  updatedAt?: string;
  counts: {
    total: number;
    completed: number;
    upcoming: number;
    cancelled: number;
    pending: number;
    confirmed: number;
  };
};

export type ClientPortalLoyalty = {
  clientId: string;
  membershipId: string;
  balance: number;
  earned: number;
  used: number;
  reversed: number;
  level: number;
  levelKey: string;
  levelLabel: string;
  progress: number;
  pointsToNext: number;
  nextLevelLabel?: string | null;
  conversion?: { halalasPerPoint: number; label: string };
  transactions: Array<{
    id: string;
    type: "earn" | "redeem" | "refund" | "adjustment" | string;
    points: number;
    booking_id?: string;
    refund_id?: string;
    reason: string;
    created_at: string;
  }>;
};

export type ClientPortalOffer = {
  id: string;
  title: string;
  description?: string;
  code?: string;
  discountType: string;
  value: number;
  imageUrl?: string;
  priceBeforeHalalas?: number;
  priceAfterHalalas?: number;
  startsAt?: string;
  endsAt?: string;
  serviceIds: string[];
  ctaLabel?: string;
  ctaUrl?: string;
};

export type ClientPortalSnapshot = {
  profile: ClientPortalProfile;
  bookings: ClientPortalBooking[];
  loyalty: ClientPortalLoyalty;
  offers: ClientPortalOffer[];
  generatedAt: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  try {
    const parsed = JSON.parse(text(value) || "[]");
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapItem(row: Record<string, unknown>): ClientPortalBookingItem {
  return {
    id: text(row.id),
    serviceId: text(row.service_id),
    serviceName: text(row.service_name_snapshot) || "خدمة",
    staffId: text(row.staff_id) || undefined,
    staffName: text(row.staff_name) || undefined,
    quantity: Math.max(1, number(row.quantity)),
    unitPriceHalalas: number(row.unit_price_halalas),
    totalHalalas: number(row.final_total_halalas ?? row.total_halalas),
    packageCovered: Number(row.package_covered) === 1 || row.package_covered === true,
    clientPackageId: text(row.client_package_id) || undefined,
    bookingDate: text(row.booking_date) || undefined,
    startTime: text(row.start_time) || undefined,
    endTime: text(row.end_time) || undefined,
  };
}

function mapBooking(row: Record<string, unknown>): ClientPortalBooking {
  const items = Array.isArray(row.items) ? row.items.map((item) => mapItem(item as Record<string, unknown>)) : [];
  return {
    id: text(row.id),
    publicId: text(row.public_id) || undefined,
    clientId: text(row.client_id),
    clientName: text(row.client_name) || undefined,
    clientPhone: text(row.client_phone) || undefined,
    staffId: text(row.staff_id) || undefined,
    staffName: text(row.staff_name) || undefined,
    bookingDate: text(row.booking_date),
    startTime: text(row.start_time),
    endTime: text(row.end_time) || undefined,
    status: text(row.status || "pending").toLowerCase(),
    originalStatus: text(row.original_status) || undefined,
    notes: text(row.notes) || undefined,
    totalHalalas: number(row.total_halalas),
    paidHalalas: number(row.paid_halalas),
    refundedHalalas: number(row.refunded_halalas),
    paymentStatus: text(row.payment_status || "unpaid"),
    paymentMethod: text(row.payment_method) || undefined,
    packageSessionsUsed: number(row.package_sessions_used),
    invoiceNumber: text(row.invoice_number) || undefined,
    createdAt: text(row.created_at) || undefined,
    updatedAt: text(row.updated_at) || undefined,
    items,
  };
}

function mapProfile(row: Record<string, unknown>): ClientPortalProfile {
  const counts = (row.counts || {}) as Record<string, unknown>;
  return {
    id: text(row.id),
    name: text(row.name) || "عميلة",
    phoneNormalized: text(row.phone_normalized) || undefined,
    email: text(row.email) || undefined,
    firebaseUid: text(row.firebase_uid) || undefined,
    createdAt: text(row.created_at) || undefined,
    updatedAt: text(row.updated_at) || undefined,
    counts: {
      total: number(counts.total),
      completed: number(counts.completed),
      upcoming: number(counts.upcoming),
      cancelled: number(counts.cancelled),
      pending: number(counts.pending),
      confirmed: number(counts.confirmed),
    },
  };
}

function mapLoyalty(row: Record<string, unknown>): ClientPortalLoyalty {
  return {
    clientId: text(row.clientId || row.client_id),
    membershipId: text(row.membershipId || row.membership_id),
    balance: number(row.balance),
    earned: number(row.earned),
    used: number(row.used),
    reversed: number(row.reversed),
    level: Math.max(1, number(row.level)),
    levelKey: text(row.levelKey || row.level_key || "bronze"),
    levelLabel: text(row.levelLabel || row.level_label || "برونزي"),
    progress: Math.max(0, Math.min(100, number(row.progress))),
    pointsToNext: Math.max(0, number(row.pointsToNext || row.points_to_next)),
    nextLevelLabel: text(row.nextLevelLabel || row.next_level_label) || null,
    conversion: row.conversion as ClientPortalLoyalty["conversion"],
    transactions: Array.isArray(row.transactions) ? row.transactions as ClientPortalLoyalty["transactions"] : [],
  };
}

function mapOffer(row: Record<string, unknown>): ClientPortalOffer {
  return {
    id: text(row.id),
    title: text(row.name || row.title) || "عرض",
    description: text(row.description) || undefined,
    code: text(row.code) || undefined,
    discountType: text(row.type || "fixed"),
    value: number(row.value),
    imageUrl: text(row.image_url) || undefined,
    priceBeforeHalalas: row.price_before_halalas == null ? undefined : number(row.price_before_halalas),
    priceAfterHalalas: row.price_after_halalas == null ? undefined : number(row.price_after_halalas),
    startsAt: text(row.starts_at) || undefined,
    endsAt: text(row.ends_at) || undefined,
    serviceIds: jsonArray(row.service_ids_json),
    ctaLabel: text(row.cta_label) || undefined,
    ctaUrl: text(row.cta_url) || undefined,
  };
}

function mapSnapshot(raw: Record<string, unknown>): ClientPortalSnapshot {
  return {
    profile: mapProfile((raw.profile || {}) as Record<string, unknown>),
    bookings: Array.isArray(raw.bookings) ? raw.bookings.map((row) => mapBooking(row as Record<string, unknown>)) : [],
    loyalty: mapLoyalty((raw.loyalty || {}) as Record<string, unknown>),
    offers: Array.isArray(raw.offers) ? raw.offers.map((row) => mapOffer(row as Record<string, unknown>)) : [],
    generatedAt: text(raw.generatedAt || raw.generated_at),
  };
}

export const ClientPortalService = {
  async snapshot(): Promise<ClientPortalSnapshot> {
    const raw = await coreApiRequest<Record<string, unknown>>("/api/core/client/portal");
    return mapSnapshot(raw);
  },

  async patchProfile(input: { name?: string; phone?: string; email?: string }): Promise<ClientPortalProfile> {
    const raw = await coreApiRequest<Record<string, unknown>>("/api/core/client/me", {
      method: "PATCH",
      body: input,
    });
    return mapProfile(raw);
  },
};
