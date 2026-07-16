import type { BookingPaymentType, BookingStatus } from "../services/firestoreBookings";
import {
  formatTime12,
  round2,
  toMillisSafeDashboardBookings as toMillisSafe,
} from "../helpers/pageSharedUtils";
import { formatBookingReference } from "../helpers/bookingReference";

export type PaymentDisplayLine = {
  key: string;
  label: string;
  tone: "neutral" | "paid" | "remaining" | "total";
  amount?: number;
};

export type BookingPaymentSummary = {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
};

export type DashboardBookingServiceItem = {
  serviceId?: string;
  serviceName?: string;
  price?: number;
  durationMin?: number;
  sectionLabel?: string;
  categoryLabel?: string;
};

type DashboardBookingServiceSnapshot = {
  serviceNameAtBooking?: string;
  priceAtBooking?: number;
  durationAtBooking?: number;
  sectionIdAtBooking?: string;
  sectionTitleAtBooking?: string;
  categoryIdAtBooking?: string;
  categoryNameAtBooking?: string;
};

type DashboardBookingPackageService = {
  serviceId?: string;
  serviceName?: string;
  sectionId?: string;
  sectionTitle?: string;
  categoryId?: string;
  categoryName?: string;
  price?: number;
  durationMin?: number;
};

type DashboardBookingPackageSnapshot = {
  packageId?: string;
  packageName?: string;
  finalPriceAtBooking?: number;
  baseTotalPriceAtBooking?: number;
  totalDurationMinAtBooking?: number;
  services?: DashboardBookingPackageService[];
};

export type BookingTrackFallbackContact = {
  customerName: string;
  phone: string;
};

export type DashboardBookingRowLike = {
  id?: string;
  publicId?: string;
  bookingGroupId?: string;
  parentBookingId?: string;
  channel?: string;
  customerName?: string;
  phone?: string;
  serviceName?: string;
  serviceId?: string;
  services?: DashboardBookingServiceItem[];
  serviceSnapshot?: DashboardBookingServiceSnapshot;
  packageSnapshot?: DashboardBookingPackageSnapshot;
  date?: string;
  time?: string;
  status?: string;
  paymentType?: BookingPaymentType | string;
  paidAmount?: number;
  remainingAmount?: number;
  total?: number;
  finalPrice?: number;
  createdAt?: any;
  createdAtMs?: number;
  pendingAt?: number;
  updatedAt?: any;
};

export type DashboardBookingBlock<T extends DashboardBookingRowLike = DashboardBookingRowLike> = {
  key: string;
  label: string;
  rows: T[];
};

export type DashboardBookingSectionKind = "normal" | "internal";

export type DashboardBookingDisplaySection<
  T extends DashboardBookingRowLike = DashboardBookingRowLike,
> = {
  key: DashboardBookingSectionKind;
  title: string;
  description: string;
  rows: T[];
  blocks: DashboardBookingBlock<T>[];
  temporaryInternalCount: number;
};

export type BookingLastUpdate = {
  by: string;
  at: string;
};

export type BookingActivityActorKind = "client" | "staff" | "admin" | "system" | "unknown";
export type BookingActivityTone = "default" | "success" | "danger" | "info";

export type BookingActivityItem = {
  id: string;
  eventKey: string;
  title: string;
  actorName: string;
  actorKind: BookingActivityActorKind;
  actorKindLabel: string;
  atLabel: string;
  changes: string[];
  note: string;
  tone: BookingActivityTone;
  sortMs: number;
};

export const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

export function safeISODate(d: string | undefined | null) {
  if (!d) return "";
  return d.trim();
}

export function inDateRange(bookingDate: string, from: string, to: string) {
  const date = safeISODate(bookingDate);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function todayISOLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function dateISOFromMillisLocal(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function shiftISODate(dateISO: string, days: number) {
  const base = String(dateISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!base) return "";
  const stamp = new Date(Number(base[1]), Number(base[2]) - 1, Number(base[3]), 12, 0, 0, 0);
  stamp.setDate(stamp.getDate() + Number(days || 0));
  return dateISOFromMillisLocal(stamp.getTime());
}

export function parseBookingDateTimeMs(dateISO: string, timeHHMM: string): number | null {
  const dateMatch = String(dateISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeHHMM || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const stamp = new Date(year, Math.max(0, month - 1), day, hour, minute, 0, 0);
  if (
    stamp.getFullYear() !== year ||
    stamp.getMonth() !== month - 1 ||
    stamp.getDate() !== day
  ) {
    return null;
  }
  return stamp.getTime();
}

export function readBookingTotalAmount(raw: any) {
  const n = Number(
    raw?.finalPrice ??
      raw?.total ??
      raw?.serviceSnapshot?.priceAtBooking ??
      raw?.packageSnapshot?.finalPriceAtBooking ??
      0
  );
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function normalizeBookingPaymentType(raw: any): BookingPaymentType | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "none" || s === "no_payment" || s === "unpaid" || s === "بدون دفع") return "none";
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

export function resolveBookingPaymentSummary(raw: any): BookingPaymentSummary {
  const totalAmount = readBookingTotalAmount(raw);
  const normalizedType = normalizeBookingPaymentType(raw?.paymentType);
  const hasExplicitPaid = Number.isFinite(Number(raw?.paidAmount));
  const explicitPaid = hasExplicitPaid ? Number(raw?.paidAmount) : NaN;
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "none");
  let paidAmount: number;
  if (paymentType === "none") {
    paidAmount = 0;
  } else if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
  } else if (paymentType === "partial") {
    paidAmount = 0;
  } else {
    paidAmount = isRevenueStatus ? totalAmount : 0;
  }

  if (paidAmount <= 0 && totalAmount > 0) {
    paymentType = "none";
  } else if (paymentType === "full") {
    paidAmount = isRevenueStatus ? totalAmount : Math.max(0, Math.min(totalAmount, paidAmount));
  } else {
    paymentType = paidAmount >= totalAmount ? "full" : "partial";
  }

  const remainingAmount = Math.max(0, round2(totalAmount - paidAmount));
  return {
    paymentType,
    paidAmount: round2(Math.max(0, Math.min(totalAmount, paidAmount))),
    remainingAmount,
    totalAmount: round2(totalAmount),
  };
}

export function paymentStatusLabel(payment: BookingPaymentSummary) {
  const total = round2(payment.totalAmount);
  const paid = round2(payment.paidAmount);
  const remaining = round2(payment.remainingAmount);
  if (total <= 0) return "لا يوجد سعر محدد";
  if (paid <= 0 && remaining > 0) return "غير مدفوع (بانتظار السداد)";
  if (remaining <= 0) return "مدفوع بالكامل";
  if (payment.paymentType === "partial") return "عربون (دفع جزئي)";
  return "مدفوع جزئيًا";
}

function paymentAmountsInlineText(payment: BookingPaymentSummary) {
  return paymentAmountsDisplayLines(payment)
    .map((line) => (typeof line.amount === "number" ? `${line.label} ${line.amount} ر.س` : line.label))
    .join("\n");
}

export function paymentBreakdownText(payment: BookingPaymentSummary) {
  if (round2(payment.totalAmount) <= 0) return paymentStatusLabel(payment);
  return `${paymentStatusLabel(payment)} - ${paymentAmountsInlineText(payment).replace(/\n/g, " | ")}`;
}

export function paymentAmountsDisplayLines(payment: BookingPaymentSummary): PaymentDisplayLine[] {
  const total = round2(payment.totalAmount);
  const paid = round2(payment.paidAmount);
  const remaining = round2(payment.remainingAmount);
  if (total <= 0) {
    return [{ key: "empty", label: "لا يوجد مبلغ محدد", tone: "neutral" }];
  }
  if (remaining <= 0) {
    return [{ key: "paid", label: "مدفوع", amount: paid, tone: "paid" }];
  }
  if (paid <= 0) {
    return [{ key: "remaining", label: "متبقي", amount: remaining, tone: "remaining" }];
  }
  return [
    { key: "paid", label: "مدفوع", amount: paid, tone: "paid" },
    { key: "remaining", label: "متبقي", amount: remaining, tone: "remaining" },
    { key: "total", label: "إجمالي", amount: total, tone: "total" },
  ];
}

export function bookingRef(
  b: Pick<DashboardBookingRowLike, "id" | "publicId" | "date"> | null | undefined
) {
  return formatBookingReference(b);
}

export function bookingCreationRefMs(b: DashboardBookingRowLike | null | undefined) {
  const createdAtMs = toMillisSafe((b as any)?.createdAt);
  if (createdAtMs > 0) return createdAtMs;
  const createdAtMsLegacy = Number((b as any)?.createdAtMs || 0);
  if (Number.isFinite(createdAtMsLegacy) && createdAtMsLegacy > 0) return createdAtMsLegacy;
  const pendingAtMs = Number((b as any)?.pendingAt || 0);
  if (Number.isFinite(pendingAtMs) && pendingAtMs > 0) return pendingAtMs;
  const updatedAtMs = toMillisSafe((b as any)?.updatedAt);
  if (updatedAtMs > 0) return updatedAtMs;
  return 0;
}

export function sortBookingsForDashboard<T extends DashboardBookingRowLike>(a: T, b: T) {
  const diff = bookingCreationRefMs(b) - bookingCreationRefMs(a);
  if (diff !== 0) return diff;
  const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateDiff !== 0) return dateDiff;
  return String(b.time || "").localeCompare(String(a.time || ""));
}

export function mergeBookingLists<T extends DashboardBookingRowLike>(...lists: T[][]) {
  const merged = new Map<string, T>();
  lists.forEach((rows) => {
    rows.forEach((row) => {
      const id = String(row?.id || "").trim();
      if (!id) return;
      merged.set(id, row);
    });
  });
  return Array.from(merged.values()).sort(sortBookingsForDashboard);
}

export function bookingPublicBase(publicId?: string) {
  const up = String(publicId || "").trim().toUpperCase();
  if (!up) return "";
  const m = up.match(/^(MK-\d+)(?:-\d+)?$/i);
  return m ? m[1].toUpperCase() : up;
}

export function digitsOnly(v: string) {
  return String(v || "").replace(/\D/g, "");
}

export function normalizeArabicName(input: string) {
  const s = String(input || "").trim().toLowerCase();
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveDashboardBookingBlockKey(b: DashboardBookingRowLike) {
  const groupId = String((b as any)?.bookingGroupId || (b as any)?.parentBookingId || "").trim();
  if (groupId) return `group:${groupId}`;

  const fullPublic = String(b?.publicId || "").trim().toUpperCase();
  const basePublic = bookingPublicBase(fullPublic);
  if (basePublic && fullPublic && fullPublic.startsWith(`${basePublic}-`)) {
    return `public:${basePublic}`;
  }

  const phone = digitsOnly(String(b?.phone || "").trim());
  const name = normalizeArabicName(String(b?.customerName || "").trim());
  const date = String(b?.date || "").trim();
  const createdMs = toMillisSafe((b as any)?.createdAt);
  if ((phone || name) && date && createdMs > 0) {
    const bucket = Math.floor(createdMs / (2 * 60 * 1000));
    const idPart = phone ? `p:${phone}` : `n:${name}`;
    return `batch:${String(b?.channel || "").trim()}:${idPart}:${date}:${bucket}`;
  }

  return `single:${String(b?.id || "").trim() || "unknown"}`;
}

export function buildDashboardBookingBlocks<T extends DashboardBookingRowLike>(
  rows: T[]
): DashboardBookingBlock<T>[] {
  const blocks = new Map<string, DashboardBookingBlock<T>>();

  rows.forEach((b) => {
    const key = resolveDashboardBookingBlockKey(b);
    const current = blocks.get(key);
    if (current) {
      current.rows.push(b);
      return;
    }

    const label = bookingPublicBase(String(b.publicId || "").trim()) || bookingRef(b);
    blocks.set(key, { key, label, rows: [b] });
  });

  const out = Array.from(blocks.values());
  out.forEach((block) => {
    block.rows.sort((a, b) => {
      const dateDiff = String(a.date || "").localeCompare(String(b.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return String(a.time || "").localeCompare(String(b.time || ""));
    });
  });

  return out;
}

export function channelLabel(channel?: string) {
  if (channel === "client") return "موقع العميلات";
  if (channel === "dashboard") return "الداشبورد";
  if (channel === "internal") return "الحجز الداخلي";
  return "غير محدد";
}

export function formatAnyDateTime(v: any) {
  try {
    if (!v) return "—";
    const ms =
      typeof v?.toMillis === "function"
        ? v.toMillis()
        : typeof v?.seconds === "number"
          ? Number(v.seconds) * 1000
          : typeof v === "number"
            ? v
            : Date.parse(String(v));
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${formatTime12(`${hh}:${mi}`)}`;
  } catch {
    return "—";
  }
}

export function normalizeBookingTrackFallback(raw: any): BookingTrackFallbackContact {
  return {
    customerName: String(raw?.clientName || raw?.customerName || raw?.name || "").trim() || "غير متوفر",
    phone: String(raw?.clientPhone || raw?.phone || raw?.customerPhone || "").trim() || "غير متوفر",
  };
}

export function chunkItems<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const batchSize = Math.max(1, size);
  for (let index = 0; index < items.length; index += batchSize) {
    out.push(items.slice(index, index + batchSize));
  }
  return out;
}

export function readCatalogLabel(raw: any, fallback = ""): string {
  const obj = raw && typeof raw === "object" ? raw : {};
  const candidates = [
    obj?.name,
    obj?.title,
    obj?.serviceName,
    obj?.categoryName,
    obj?.sectionTitle,
    obj?.["الاسم"],
    obj?.["العنوان"],
  ];
  for (const value of candidates) {
    const txt = String(value || "").trim();
    if (txt) return txt;
  }
  return String(fallback || "").trim();
}

export function toArabicOnlyLabel(value: string, fallback = "—"): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const dict: Record<string, string> = {
    makeup: "مكياج",
    "hair care": "العناية بالشعر",
    "hair-care": "العناية بالشعر",
    hair: "شعر",
    nails: "أظافر",
    skin: "بشرة",
    eyeliner: "ايلاينر",
  };

  let s = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  Object.entries(dict)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([en, ar]) => {
      const re = new RegExp(`\\b${en.replace(/\s+/g, "\\s+")}\\b`, "gi");
      s = s.replace(re, ar);
    });

  s = s.replace(/\b[A-Za-z]{2,}\b/g, " ").replace(/\s+/g, " ").trim();
  return s || fallback;
}

export function toStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return [];
}

export function extractServicesFromAny(anyB: any): DashboardBookingServiceItem[] {
  const pkgServices = Array.isArray(anyB?.packageSnapshot?.services) ? anyB.packageSnapshot.services : [];
  if (pkgServices.length) {
    return pkgServices
      .map((x: any) => ({
        serviceId: String(x?.serviceId ?? "").trim() || undefined,
        serviceName: toArabicOnlyLabel(String(x?.serviceName ?? "").trim(), "") || undefined,
        price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
        durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
        sectionLabel: toArabicOnlyLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
        categoryLabel: toArabicOnlyLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
      }))
      .filter((x: any) => x.serviceId || x.serviceName);
  }

  const services = Array.isArray(anyB?.services) ? anyB.services : null;
  if (services && services.length) {
    return services
      .map((x: any) => ({
        serviceId: String(x?.serviceId ?? x?.id ?? x?.key ?? "").trim() || undefined,
        serviceName: toArabicOnlyLabel(String(x?.serviceName ?? x?.name ?? "").trim(), "") || undefined,
        price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
        durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
        sectionLabel: toArabicOnlyLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
        categoryLabel: toArabicOnlyLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
      }))
      .filter((x: any) => x.serviceId || x.serviceName);
  }

  const ids = toStringArray(anyB?.serviceIds);
  const names = toStringArray(anyB?.serviceNames);
  if (ids.length || names.length) {
    const max = Math.max(ids.length, names.length);
    const out: DashboardBookingServiceItem[] = [];
    for (let index = 0; index < max; index += 1) {
      if (ids[index] || names[index]) {
        out.push({ serviceId: ids[index] || undefined, serviceName: names[index] || undefined });
      }
    }
    return out;
  }

  const serviceId = String(anyB?.serviceId ?? anyB?.service ?? anyB?.serviceKey ?? "").trim();
  const serviceName = String(anyB?.serviceName ?? "").trim();
  if (serviceId || serviceName) {
    return [
      {
        serviceId: serviceId || undefined,
        serviceName: toArabicOnlyLabel(serviceName, "") || undefined,
        sectionLabel:
          toArabicOnlyLabel(
            String(
              anyB?.serviceSnapshot?.sectionTitleAtBooking ||
                anyB?.serviceSnapshot?.sectionIdAtBooking ||
                ""
            ).trim(),
            ""
          ) || undefined,
        categoryLabel:
          toArabicOnlyLabel(
            String(
              anyB?.serviceSnapshot?.categoryNameAtBooking ||
                anyB?.serviceSnapshot?.categoryIdAtBooking ||
                ""
            ).trim(),
            ""
          ) || undefined,
      },
    ];
  }
  return [];
}

export function serviceMetaSummaryForTable(b: DashboardBookingRowLike): string {
  const section = String(
    b?.serviceSnapshot?.sectionTitleAtBooking ||
      b?.serviceSnapshot?.sectionIdAtBooking ||
      ""
  ).trim();
  const category = String(
    b?.serviceSnapshot?.categoryNameAtBooking ||
      b?.serviceSnapshot?.categoryIdAtBooking ||
      ""
  ).trim();
  const pkgName = String(b?.packageSnapshot?.packageName || "").trim();
  const pkgCount = Array.isArray(b?.packageSnapshot?.services) ? b.packageSnapshot.services.length : 0;
  if (pkgName) return `${pkgName}${pkgCount > 0 ? ` (${pkgCount} خدمات)` : ""}`;
  if (section || category) return `${section || "—"}${category ? ` • ${category}` : ""}`;
  return "—";
}

export function serviceSummaryForTable(b: DashboardBookingRowLike): string {
  const list = b.services || [];
  if (!list.length) return b.serviceName || b.serviceId || "—";
  const firstName = (list[0]?.serviceName || list[0]?.serviceId || "").trim();
  if (list.length <= 1) return firstName || b.serviceName || b.serviceId || "—";
  return `${firstName || (b.serviceName || b.serviceId || "خدمة")} + ${list.length - 1} خدمات`;
}

export function isPendingDepositBooking(
  raw: { status?: string } | null | undefined,
  payment: Pick<BookingPaymentSummary, "paidAmount" | "remainingAmount" | "totalAmount">
) {
  const status = String(raw?.status || "").trim().toLowerCase();
  if (status !== "pending") return false;
  return (
    Number(payment.totalAmount || 0) > 0 &&
    Number(payment.paidAmount || 0) > 0 &&
    Number(payment.remainingAmount || 0) > 0
  );
}

export function isTemporaryNormalInternalBooking(b: DashboardBookingRowLike) {
  if (b.channel !== "internal") return false;
  if (String(b.status || "").trim().toLowerCase() !== "pending") return false;

  const payment = resolveBookingPaymentSummary(b);
  if (round2(payment.paidAmount) > 0) return false;

  const bookingMs = parseBookingDateTimeMs(String(b.date || ""), String(b.time || ""));
  if (bookingMs !== null) return bookingMs > Date.now();

  const bookingDate = safeISODate(String(b.date || ""));
  return !!bookingDate && bookingDate > todayISOLocal();
}

export function resolveBookingSectionKind(b: DashboardBookingRowLike): DashboardBookingSectionKind {
  if (b.channel === "internal" && !isTemporaryNormalInternalBooking(b)) return "internal";
  return "normal";
}

export function bookingChannelBadgeText(b: DashboardBookingRowLike) {
  if (b.channel !== "internal") return "";
  return isTemporaryNormalInternalBooking(b) ? "حجز داخلي مستقبلي قبل الدفع" : "حجز داخلي";
}

const GENERIC_ACTOR_LABELS = new Set([
  "",
  "system",
  "النظام",
  "client",
  "staff",
  "dashboard",
  "internal",
  "owner",
  "admin",
  "reception",
  "guest",
  "user",
  "مستخدم",
  "عميلة",
  "موظفة",
  "تعيين تلقائي",
  "auto-assigned",
  "auto assigned",
]);

function normalizeActorLabel(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isMeaningfulActorLabel(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return !GENERIC_ACTOR_LABELS.has(normalizeActorLabel(raw));
}

function emailLocalPart(email: unknown) {
  const raw = String(email || "").trim();
  return raw ? raw.split("@")[0] : "";
}

function resolveUidActorLabel(
  uid: unknown,
  booking?: DashboardBookingRowLike | null,
  userNamesByUid: Record<string, string> = {}
) {
  const rawUid = String(uid || "").trim();
  if (!rawUid) return "";
  const mappedName = String(userNamesByUid[rawUid] || "").trim();
  if (mappedName) return mappedName;

  const source = (booking || {}) as any;
  const bookingUserId = String(source?.userId || "").trim();
  const channel = String(source?.channel || "").trim().toLowerCase();
  const createdBy = String(source?.createdBy || "").trim().toLowerCase();
  const clientName = String(source?.customerName || "").trim();
  if (
    bookingUserId &&
    rawUid === bookingUserId &&
    (channel === "client" || createdBy === "client") &&
    clientName &&
    clientName !== "غير متوفر"
  ) {
    return clientName;
  }

  return rawUid.slice(0, 8);
}

function resolveActorLabelFromParts(args: {
  name?: unknown;
  email?: unknown;
  uid?: unknown;
  booking?: DashboardBookingRowLike | null;
  userNamesByUid?: Record<string, string>;
  createdBy?: unknown;
}) {
  const name = String(args.name || "").trim();
  if (isMeaningfulActorLabel(name)) return name;

  const createdBy = String(args.createdBy || "").trim();
  if (isMeaningfulActorLabel(createdBy)) return createdBy;

  const rawUid = String(args.uid || "").trim();
  const uidLabel = resolveUidActorLabel(rawUid, args.booking, args.userNamesByUid || {});
  const emailLabel = emailLocalPart(args.email);
  if (uidLabel && rawUid && uidLabel !== rawUid.slice(0, 8)) return uidLabel;
  if (emailLabel) return emailLabel;
  if (uidLabel) return uidLabel;

  return "";
}

export function resolveBookingActorLabel(
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  const b = (booking || {}) as any;
  const candidates = [
    { name: b.updatedByName, email: b.updatedByEmail, uid: b.updatedByUid },
    { name: b.cancelledByName, email: b.cancelledByEmail, uid: b.cancelledByUid },
    { name: b.completedByName, email: b.completedByEmail, uid: b.completedByUid },
    { name: b.confirmedByName, email: b.confirmedByEmail, uid: b.confirmedByUid },
    { name: b.pendingByName, email: b.pendingByEmail, uid: b.pendingByUid },
    {
      name: b.createdByName,
      email: b.createdByEmail,
      uid: b.createdByUid || b.userId,
      createdBy: b.createdBy,
    },
  ];

  for (const candidate of candidates) {
    const label = resolveActorLabelFromParts({
      ...candidate,
      booking,
      userNamesByUid,
    });
    if (label) return label;
  }

  const clientName = String(b.customerName || "").trim();
  if (
    clientName &&
    clientName !== "غير متوفر" &&
    (String(b.channel || "").trim().toLowerCase() === "client" ||
      String(b.createdBy || "").trim().toLowerCase() === "client")
  ) {
    return clientName;
  }

  return "النظام";
}

function fallbackLastUpdateForBooking(
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {}
): BookingLastUpdate {
  const fallbackAt = formatAnyDateTime((booking as any)?.updatedAt || (booking as any)?.createdAt);
  return {
    by: resolveBookingActorLabel(booking, userNamesByUid),
    at: fallbackAt,
  };
}

export function deriveLastUpdateForBooking(
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {}
): BookingLastUpdate {
  const fallback = fallbackLastUpdateForBooking(booking, userNamesByUid);
  const lifecycleItems = buildBookingLifecycleActivityItems(booking, userNamesByUid);
  const fallbackUpdated = buildFallbackUpdatedActivity(booking, userNamesByUid, lifecycleItems);
  const fallbackCreated = buildFallbackCreatedActivity(booking);
  const merged = mergeBookingActivityItems(
    [
      ...lifecycleItems,
      ...(fallbackUpdated ? [fallbackUpdated] : []),
      ...(fallbackCreated ? [fallbackCreated] : []),
    ].filter(Boolean) as BookingActivityItem[]
  ).sort((a, b) => b.sortMs - a.sortMs || b.id.localeCompare(a.id));

  const latest = merged[0];
  if (!latest) return fallback;

  return {
    by: String(latest.actorName || "").trim() || fallback.by,
    at: String(latest.atLabel || "").trim() || fallback.at,
  };
}

function bookingActivityActorKindLabelAr(kind: BookingActivityActorKind) {
  if (kind === "client") return "العميلة";
  if (kind === "staff") return "الموظفة";
  if (kind === "admin") return "الإدارة";
  if (kind === "system") return "النظام";
  return "غير محدد";
}

function isAutomaticBookingActivity(raw: any) {
  const hay = [raw?.byName, raw?.byEmail, raw?.note, raw?.type]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(" ");

  return (
    hay.includes("النظام") ||
    hay.includes("تلقائي") ||
    /\b(system|auto|automatic)\b/i.test(hay)
  );
}

function resolveBookingActivitySortMs(raw: any) {
  const directMs = Number(raw?.eventAtMs || 0);
  if (Number.isFinite(directMs) && directMs > 0) return directMs;
  const metaMs = Number(raw?.meta?.eventAtMs || 0);
  if (Number.isFinite(metaMs) && metaMs > 0) return metaMs;
  const atMs = toMillisSafe(raw?.at || raw?.createdAt);
  if (atMs > 0) return atMs;
  return 0;
}

function getBookingActivityPatch(raw: any) {
  const directPatch = raw?.patch;
  if (directPatch && typeof directPatch === "object" && !Array.isArray(directPatch)) {
    return directPatch as Record<string, unknown>;
  }

  const afterPatch = raw?.after;
  if (afterPatch && typeof afterPatch === "object" && !Array.isArray(afterPatch)) {
    return afterPatch as Record<string, unknown>;
  }

  return {} as Record<string, unknown>;
}

function resolveBookingActivityType(raw: any) {
  const explicitType = String(raw?.type || raw?.meta?.bookingLogType || "")
    .trim()
    .toLowerCase();
  if (explicitType) return explicitType;

  const action = String(raw?.action || "").trim().toLowerCase();
  if (action === "booking_created") return "created";
  if (action === "booking_updated") return "details_updated";
  if (action === "booking_viewed") return "staff_acknowledged";
  if (
    action === "booking_confirmed" ||
    action === "booking_completed" ||
    action === "booking_cancelled" ||
    action === "booking_status_changed"
  ) {
    return "status_changed";
  }

  return "";
}

function resolveBookingActivityStatus(raw: any) {
  const patch = getBookingActivityPatch(raw);
  const patchStatus = String(patch?.status || raw?.status || "").trim().toLowerCase();
  if (patchStatus) return patchStatus;

  const action = String(raw?.action || "").trim().toLowerCase();
  if (action === "booking_confirmed") return "confirmed";
  if (action === "booking_completed") return "completed";
  if (action === "booking_cancelled") return "cancelled";

  return "";
}

function bookingPaymentMethodLabelAr(method: unknown) {
  const raw = String(method || "").trim().toLowerCase();
  if (raw === "cash") return "كاش";
  if (raw === "card") return "شبكة";
  if (raw === "transfer") return "تحويل";
  if (raw === "mixed") return "مختلط";
  if (raw === "other") return "أخرى";
  return "";
}

function bookingPaymentModeLabelAr(args: {
  paymentType?: unknown;
  paymentMethod?: unknown;
  paidAmount?: unknown;
}) {
  const paymentType = normalizeBookingPaymentType(args.paymentType);
  const paymentMethod = String(args.paymentMethod || "").trim().toLowerCase();
  const paidAmount = Number(args.paidAmount ?? 0);

  if (paymentType === "none") return "بدون دفع";
  if (!paymentMethod && paymentType === "partial" && paidAmount <= 0) return "بدون دفع";
  if (paymentMethod === "none") return "بدون دفع";
  if (paymentType === "full") return "دفع كامل";
  if (paymentType === "partial") return "عربون";
  return "";
}

function resolveBookingActivityTitle(raw: any) {
  const type = resolveBookingActivityType(raw);
  const status = resolveBookingActivityStatus(raw);

  if (type === "created") return "تم إنشاء الحجز";
  if (type === "details_updated") return "تم تعديل الحجز";
  if (type === "staff_acknowledged") return "تم الاطلاع على الحجز";
  if (type === "status_changed") {
    if (status === "confirmed") return "تم تأكيد الحجز";
    if (status === "cancelled" || status === "canceled") return "تم إلغاء الحجز";
    if (status === "completed") return "تم إكمال الحجز";
    if (status === "pending") return "تم تحويل الحجز إلى الانتظار";
    return "تم تغيير حالة الحجز";
  }

  return "تم تحديث الحجز";
}

function resolveBookingActivityTone(raw: any): BookingActivityTone {
  const type = resolveBookingActivityType(raw);
  const status = resolveBookingActivityStatus(raw);

  if (type === "created") return "info";
  if (type === "staff_acknowledged") return "info";
  if (status === "confirmed" || status === "completed") return "success";
  if (status === "cancelled" || status === "canceled") return "danger";
  return "default";
}

function resolveBookingActivityActor(
  raw: any,
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  if (isAutomaticBookingActivity(raw)) {
    return {
      actorName: "النظام",
      actorKind: "system" as BookingActivityActorKind,
    };
  }

  const explicit = resolveActorLabelFromParts({
    name: raw?.byName || raw?.userName || raw?.displayName,
    email: raw?.byEmail,
    uid: raw?.byUid || raw?.userUid,
    booking,
    userNamesByUid,
  });
  const bookingFallbackRaw = resolveBookingActorLabel(booking, userNamesByUid);
  const bookingFallback = bookingFallbackRaw === "النظام" ? "" : bookingFallbackRaw;
  const actorName = explicit || bookingFallback || "";
  const source = (booking || {}) as any;
  const bookingClientName = String(source?.customerName || "").trim();
  const bookingEmployeeName = String(source?.employeeName || "").trim();
  const type = resolveBookingActivityType(raw);

  if (actorName) {
    if (
      bookingClientName &&
      normalizeArabicName(actorName) === normalizeArabicName(bookingClientName)
    ) {
      return {
        actorName: bookingClientName,
        actorKind: "client" as BookingActivityActorKind,
      };
    }

    if (
      bookingEmployeeName &&
      normalizeArabicName(actorName) === normalizeArabicName(bookingEmployeeName)
    ) {
      return {
        actorName: bookingEmployeeName,
        actorKind: "staff" as BookingActivityActorKind,
      };
    }

    return {
      actorName,
      actorKind:
        type === "staff_acknowledged"
          ? ("staff" as BookingActivityActorKind)
          : ("admin" as BookingActivityActorKind),
    };
  }

  if (
    type === "created" &&
    bookingClientName &&
    (String(source?.channel || "").trim().toLowerCase() === "client" ||
      String(source?.createdBy || "").trim().toLowerCase() === "client")
  ) {
    return {
      actorName: bookingClientName,
      actorKind: "client" as BookingActivityActorKind,
    };
  }

  return {
    actorName: "غير محدد",
    actorKind: "unknown" as BookingActivityActorKind,
  };
}

function resolveBookingActivityChanges(raw: any) {
  const type = resolveBookingActivityType(raw);
  const patch = getBookingActivityPatch(raw);
  const serviceSnapshot =
    patch?.serviceSnapshot && typeof patch.serviceSnapshot === "object"
      ? (patch.serviceSnapshot as any)
      : {};
  const changes: string[] = [];

  const push = (value: string) => {
    const text = String(value || "").trim();
    if (!text) return;
    if (!changes.includes(text)) changes.push(text);
  };

  const serviceName = String(
    serviceSnapshot?.serviceNameAtBooking || patch?.serviceName || patch?.serviceId || ""
  ).trim();
  const sectionName = String(
    serviceSnapshot?.sectionTitleAtBooking ||
      patch?.sectionTitle ||
      patch?.sectionName ||
      patch?.sectionId ||
      ""
  ).trim();
  const categoryName = String(
    serviceSnapshot?.categoryNameAtBooking || patch?.categoryName || patch?.categoryId || ""
  ).trim();
  const clientName = String(patch?.clientName || patch?.customerName || "").trim();
  const clientPhone = String(
    patch?.clientPhone || patch?.customerPhone || patch?.phone || ""
  ).trim();
  const totalRaw = Number(patch?.finalPrice ?? patch?.total);
  const paidAmountRaw = Number(patch?.paidAmount);
  const remainingAmountRaw = Number(patch?.remainingAmount);
  const status = String(patch?.status || "").trim();
  const paymentMode = bookingPaymentModeLabelAr({
    paymentType: patch?.paymentType,
    paymentMethod: patch?.paymentMethod,
    paidAmount: patch?.paidAmount,
  });
  const paymentMethod = bookingPaymentMethodLabelAr(patch?.paymentMethod);
  const noteText = String(patch?.note || "").trim();

  if (patch?.date) push(`التاريخ إلى ${String(patch.date).trim()}`);
  if (patch?.time) push(`الوقت إلى ${formatTime12(String(patch.time).trim())}`);
  if (sectionName) push(`القسم إلى ${toArabicOnlyLabel(sectionName, sectionName)}`);
  if (categoryName) push(`التصنيف إلى ${toArabicOnlyLabel(categoryName, categoryName)}`);
  if (patch?.employeeName) push(`الموظفة إلى ${String(patch.employeeName).trim()}`);
  if (serviceName) push(`الخدمة إلى ${toArabicOnlyLabel(serviceName, serviceName)}`);
  if (clientName) push(`العميلة إلى ${clientName}`);
  if (clientPhone) push(`رقم الجوال إلى ${clientPhone}`);
  if (status) push(`الحالة إلى ${statusLabel[status as BookingStatus] || status}`);
  if (paymentMode) push(`نوع الدفع إلى ${paymentMode}`);
  if (paymentMethod) push(`طريقة الدفع إلى ${paymentMethod}`);
  if (Number.isFinite(paidAmountRaw)) {
    push(`المدفوع إلى ${round2(Math.max(0, paidAmountRaw))} ر.س`);
  }
  if (Number.isFinite(remainingAmountRaw)) {
    push(`المتبقي إلى ${round2(Math.max(0, remainingAmountRaw))} ر.س`);
  }
  if (Number.isFinite(totalRaw) && totalRaw > 0) push(`الإجمالي إلى ${totalRaw} ر.س`);
  if (type === "details_updated" && noteText) push("تم تحديث ملاحظة الحجز");

  return changes;
}

function resolveBookingActivityNote(raw: any) {
  const note = String(raw?.note || "").trim();
  if (!note) return "";

  const genericNotes = new Set([
    "تم إنشاء الحجز",
    "تم تعديل بيانات الحجز",
    "تمت مشاهدة الحجز لأول مرة",
  ]);

  if (genericNotes.has(note)) return "";
  if (resolveBookingActivityType(raw) === "status_changed") return "";
  return note;
}

export function mapBookingActivityItem(
  raw: any,
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {}
): BookingActivityItem {
  const type = resolveBookingActivityType(raw) || "details_updated";
  const patch = getBookingActivityPatch(raw);
  const status = resolveBookingActivityStatus(raw);
  const detailsKey =
    type === "details_updated"
      ? Object.keys(patch)
          .filter((key) => !/^updatedBy/i.test(key) && key !== "updatedAt")
          .sort()
          .join(",")
      : "";
  const actor = resolveBookingActivityActor(raw, booking, userNamesByUid);
  const sortMs = resolveBookingActivitySortMs(raw) || bookingCreationRefMs(booking) || Date.now();

  return {
    id: String(raw?.id || raw?.eventId || `${sortMs}-${raw?.type || "event"}`),
    eventKey:
      type === "status_changed"
        ? `status:${status || "changed"}`
        : type === "details_updated"
          ? `details:${detailsKey || "generic"}`
          : type,
    title: resolveBookingActivityTitle(raw),
    actorName: actor.actorName,
    actorKind: actor.actorKind,
    actorKindLabel: bookingActivityActorKindLabelAr(actor.actorKind),
    atLabel: formatAnyDateTime(sortMs),
    changes: resolveBookingActivityChanges(raw),
    note: resolveBookingActivityNote(raw),
    tone: resolveBookingActivityTone(raw),
    sortMs,
  };
}

export function buildFallbackCreatedActivity(
  booking: DashboardBookingRowLike | null | undefined
): BookingActivityItem | null {
  const createdAtMs = bookingCreationRefMs(booking);
  if (!createdAtMs) return null;

  const source = (booking || {}) as any;
  const clientName = String(source?.customerName || "").trim();
  const isClientCreated =
    !!clientName &&
    (String(source?.channel || "").trim().toLowerCase() === "client" ||
      String(source?.createdBy || "").trim().toLowerCase() === "client");

  return {
    id: `fallback-created-${String(source?.id || "booking")}`,
    eventKey: "created",
    title: "تم إنشاء الحجز",
    actorName: isClientCreated ? clientName : "غير محدد",
    actorKind: isClientCreated ? "client" : "unknown",
    actorKindLabel: isClientCreated ? "العميلة" : "غير محدد",
    atLabel: formatAnyDateTime(createdAtMs),
    changes: [],
    note: "",
    tone: "info",
    sortMs: createdAtMs,
  };
}

export function buildFallbackUpdatedActivity(
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {},
  existingItems: BookingActivityItem[] = []
): BookingActivityItem | null {
  const source = (booking || {}) as any;
  const updatedAtMs = toMillisSafe(source?.updatedAt);
  const createdAtMs = bookingCreationRefMs(booking);
  if (!updatedAtMs) return null;
  if (createdAtMs > 0 && updatedAtMs <= createdAtMs + 1000) return null;

  const hasNonCreatedEvent = existingItems.some((item) => item.title !== "تم إنشاء الحجز");
  if (hasNonCreatedEvent) return null;

  return mapBookingActivityItem(
    {
      id: `fallback-updated-${String(source?.id || "booking")}`,
      type: "details_updated",
      eventAtMs: updatedAtMs,
      at: source?.updatedAt,
      byUid: source?.updatedByUid || null,
      byEmail: source?.updatedByEmail || null,
      byName: source?.updatedByName || null,
      patch: {},
    },
    booking,
    userNamesByUid
  );
}

export function normalizeBookingActivityEventRaw(
  id: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const status = resolveBookingActivityStatus(data);
  const patch = {
    ...getBookingActivityPatch(data),
    ...(status ? { status } : {}),
  };

  return {
    id: `event_${id}`,
    ...data,
    type:
      resolveBookingActivityType(data) ||
      String(data?.type || "").trim().toLowerCase() ||
      "details_updated",
    patch,
    eventAtMs: resolveBookingActivitySortMs(data),
    at: data?.at,
  };
}

export function normalizeBookingActivityAuditRaw(
  id: string,
  data: Record<string, unknown>
): Record<string, unknown> | null {
  const action = String(data?.action || "").trim().toLowerCase();
  const type = resolveBookingActivityType(data);
  if (!action.startsWith("booking_") && !type) return null;

  const status = resolveBookingActivityStatus(data);
  const patch = {
    ...getBookingActivityPatch(data),
    ...(status ? { status } : {}),
  };

  return {
    id: `audit_${id}`,
    type: type || "details_updated",
    action,
    patch,
    note: String(data?.description || "").trim(),
    byUid: data?.userUid || null,
    byEmail: data?.userEmail || null,
    byName: data?.userName || null,
    eventAtMs: resolveBookingActivitySortMs(data),
    at: data?.createdAt,
    createdAt: data?.createdAt,
    meta: data?.meta,
  };
}

export function buildBookingLifecycleActivityItems(
  booking: DashboardBookingRowLike | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  if (!booking) return [] as BookingActivityItem[];

  const b: any = booking;
  const totalAmount = readBookingTotalAmount(booking);
  const basePatch = {
    customerName: b.customerName || undefined,
    phone: b.phone || undefined,
    date: b.date || undefined,
    time: b.time || undefined,
    employeeName: b.employeeName || undefined,
    serviceName: b.serviceName || undefined,
    serviceSnapshot: b.serviceSnapshot || undefined,
    finalPrice: totalAmount || undefined,
    total: totalAmount || undefined,
    paymentType: b.paymentType || undefined,
    paymentMethod: b.paymentMethod ?? undefined,
    paidAmount: Number.isFinite(Number(b.paidAmount)) ? Number(b.paidAmount) : undefined,
    remainingAmount: Number.isFinite(Number(b.remainingAmount))
      ? Number(b.remainingAmount)
      : undefined,
    note: String(b.note || "").trim() || undefined,
  };

  const raws: Array<Record<string, unknown>> = [];
  const createdAtMs = bookingCreationRefMs(booking);
  if (createdAtMs > 0) {
    raws.push({
      id: `derived_created_${String(b.id || "booking")}`,
      type: "created",
      patch: basePatch,
      byUid: b.createdByUid || b.userId || null,
      byEmail: b.createdByEmail || null,
      byName: b.createdByName || null,
      eventAtMs: createdAtMs,
      at: b.createdAt || createdAtMs,
      note: "",
    });
  }

  const lifecycleEntries = [
    {
      key: "confirmed",
      at: Number(b.confirmedAt || 0),
      byUid: b.confirmedByUid || null,
      byEmail: b.confirmedByEmail || null,
      byName: b.confirmedByName || null,
    },
    {
      key: "completed",
      at: Number(b.completedAt || 0),
      byUid: b.completedByUid || null,
      byEmail: b.completedByEmail || null,
      byName: b.completedByName || null,
    },
    {
      key: "cancelled",
      at: Number(b.cancelledAt || 0),
      byUid: b.cancelledByUid || null,
      byEmail: b.cancelledByEmail || null,
      byName: b.cancelledByName || null,
    },
    {
      key: "pending",
      at: Number(b.pendingAt || 0),
      byUid: b.pendingByUid || null,
      byEmail: b.pendingByEmail || null,
      byName: b.pendingByName || null,
    },
  ];

  lifecycleEntries.forEach((entry) => {
    if (!Number.isFinite(entry.at) || entry.at <= 0) return;
    if (entry.key === "pending" && createdAtMs > 0 && entry.at <= createdAtMs + 1000) return;

    raws.push({
      id: `derived_${entry.key}_${String(b.id || "booking")}_${entry.at}`,
      type: "status_changed",
      patch: {
        status: entry.key,
      },
      byUid: entry.byUid,
      byEmail: entry.byEmail,
      byName: entry.byName,
      eventAtMs: entry.at,
      at: entry.at,
      note: "",
    });
  });

  return raws.map((raw) => mapBookingActivityItem(raw, booking, userNamesByUid));
}

function normalizeBookingActivityActorMergeKey(item: BookingActivityItem) {
  const actorName = String(item.actorName || "").trim();
  if (!actorName) return `${item.actorKind}:unknown`;
  return `${item.actorKind}:${normalizeArabicName(actorName) || actorName.toLowerCase()}`;
}

function sanitizeBookingActivityChanges(item: BookingActivityItem) {
  const redundantStatusChange =
    item.title === "تم تأكيد الحجز"
      ? "الحالة إلى مؤكد"
      : item.title === "تم إلغاء الحجز"
        ? "الحالة إلى ملغي"
        : item.title === "تم إكمال الحجز"
          ? "الحالة إلى مكتمل"
          : item.title === "تم تحويل الحجز إلى الانتظار"
            ? "الحالة إلى في الانتظار"
            : "";

  if (!redundantStatusChange) return Array.from(new Set(item.changes));
  return Array.from(new Set(item.changes)).filter((change) => change !== redundantStatusChange);
}

export function mergeBookingActivityItems(items: BookingActivityItem[]) {
  const merged = new Map<string, BookingActivityItem>();

  items.forEach((item) => {
    const bucket = item.sortMs > 0 ? Math.round(item.sortMs / 1000) : 0;
    const fingerprint = `${item.eventKey}::${bucket}`;
    const existing = merged.get(fingerprint);

    if (!existing) {
      merged.set(fingerprint, { ...item, changes: [...item.changes] });
      return;
    }

    const shouldReplaceActor =
      existing.actorKind === "unknown" && item.actorKind !== "unknown";
    const mergedChanges = Array.from(new Set([...existing.changes, ...item.changes]));

    merged.set(fingerprint, {
      ...existing,
      ...(shouldReplaceActor
        ? {
            actorName: item.actorName,
            actorKind: item.actorKind,
            actorKindLabel: item.actorKindLabel,
          }
        : {}),
      tone: existing.tone === "default" && item.tone !== "default" ? item.tone : existing.tone,
      note: existing.note || item.note,
      changes: mergedChanges,
    });
  });

  const exactMerged = Array.from(merged.values())
    .map((item) => ({
      ...item,
      changes: sanitizeBookingActivityChanges(item),
    }))
    .sort((a, b) => a.sortMs - b.sortMs || a.id.localeCompare(b.id));

  const collapsed: BookingActivityItem[] = [];
  const confirmFlowWindowMs = 10_000;

  exactMerged.forEach((item) => {
    const last = collapsed[collapsed.length - 1];
    if (!last) {
      collapsed.push(item);
      return;
    }

    const sameActor =
      normalizeBookingActivityActorMergeKey(last) === normalizeBookingActivityActorMergeKey(item);
    const withinConfirmFlow =
      sameActor &&
      Math.abs(item.sortMs - last.sortMs) <= confirmFlowWindowMs &&
      (last.title === "تم تأكيد الحجز" || item.title === "تم تأكيد الحجز");

    if (!withinConfirmFlow) {
      collapsed.push(item);
      return;
    }

    const confirmItem = last.title === "تم تأكيد الحجز" ? last : item;
    const otherItem = confirmItem === last ? item : last;

    collapsed[collapsed.length - 1] = {
      ...confirmItem,
      id: `${confirmItem.id}__merged__${otherItem.id}`,
      sortMs: Math.max(confirmItem.sortMs, otherItem.sortMs),
      atLabel: formatAnyDateTime(Math.max(confirmItem.sortMs, otherItem.sortMs)),
      note: confirmItem.note || (otherItem.title === "تم تأكيد الحجز" ? otherItem.note : ""),
      changes: [],
    };
  });

  return collapsed;
}
