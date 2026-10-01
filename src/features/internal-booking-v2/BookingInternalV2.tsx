import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { FiCalendar, FiChevronLeft, FiClock, FiCreditCard, FiPlus, FiSearch, FiShoppingBag, FiUser, FiUsers } from "react-icons/fi";
import ConfirmModal from "../../components/ConfirmModal";
import HairLengthGuideDrawer from "../../components/bookingInternal/HairLengthGuideDrawer";
import hairLengthGuideImage from "../../assets/images/hair-length-guide.png";
import { DashboardDatePickerV2, DashboardSelectV2 } from "../../components/dashboard-v2";
import "./booking-internal-v2.css";
import PackageSessionsManager from "./PackageSessionsManager";
import { resolveCoreBookingDataSource } from "../../services/bookingDataSource";
import { CoreSettingsService } from "../../services/CoreSettingsService";
import { CoreOfferService } from "../../services/CoreOfferService";
import type { CoreDiscount } from "../../types/coreApi";
import { normalizeDigits, normalizeSearchText, phone10Digits } from "../../helpers/bookingTextUtils";
import { extractMinPriceInternal, readDisplayLabel } from "../../helpers/pageSharedUtils";
import { formatTime12 } from "../../helpers/timeDisplay";
import { getCoreStaffBookableStartSlots, isCoreStaffStartBookable } from "../../helpers/coreBookingAvailability";
import { listCoreBookableStaffForDate } from "../../services/coreBookableStaffService";

import { todayISO } from "../../helpers/bookingDateUtils";
import {
  buildDiscountSnapshot,
  halalasToSar,
  normalizeDiscountCode,
  toHalalas,
  type DiscountSnapshot,
  type DiscountSnapshotSource,
} from "../../helpers/bookingDiscountSnapshot";
import { getAuth } from "firebase/auth";
import { formatBookingReference } from "../../helpers/bookingReference";
import { bookingsText, translateBookingCatalogLabel, type DashboardLanguage } from "../../helpers/dashboardBookingsLanguage";
import { usePermissions } from "../../security/PermissionContext";

type Step = 1 | 2 | 3 | 4;

type ClientCandidate = {
  id: string;
  name: string;
  phone: string;
  publicId?: string;
  source?: string;
  visits?: number;
  sessions?: number;
};

type CatalogSection = { id: string; title?: string; name?: string; label?: string };
type CatalogCategory = { id: string; title?: string; name?: string; label?: string; sectionId?: string };
type CatalogService = Record<string, any> & { id: string };
type StaffRow = Record<string, any> & { id: string };
type ScheduleSelection = { staffId: string; staffName: string; time: string };
type CreatedPartyBooking = {
  clientKey: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  parentId: string;
  publicId: string;
  itemIds: string[];
  reference: string;
};
type PaymentMethod = "cash" | "card" | "transfer" | "mixed";
type PaymentType = "full" | "partial" | "none";
type DiscountMode = "none" | "fixed" | "percent" | "offer" | "coupon";
type PriceAdjustmentReason =
  | "catalog_pending_update"
  | "management_approved"
  | "special_price"
  | "other";
type BookingPriceAdjustment = {
  price: string;
  reason: PriceAdjustmentReason | "";
  note: string;
};
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type BookingBusinessHoursDay = { enabled: boolean; start: string; end: string };
type InternalBookingConfig = {
  slotStepMin: number;
  bufferMin: number;
  businessHours: Record<WeekdayKey, BookingBusinessHoursDay>;
};
type InternalBookingAppSettings = {
  booking?: Partial<Omit<InternalBookingConfig, "businessHours">> & {
    businessHours?: Partial<Record<WeekdayKey, BookingBusinessHoursDay>>;
  };
};

const DEFAULT_BOOKING_CONFIG: InternalBookingConfig = {
  slotStepMin: 5,
  bufferMin: 0,
  businessHours: {
    sat: { enabled: true, start: "12:00", end: "22:00" },
    sun: { enabled: true, start: "12:00", end: "22:00" },
    mon: { enabled: true, start: "12:00", end: "22:00" },
    tue: { enabled: true, start: "12:00", end: "22:00" },
    wed: { enabled: true, start: "12:00", end: "22:00" },
    thu: { enabled: true, start: "12:00", end: "22:00" },
    fri: { enabled: false, start: "12:00", end: "22:00" },
  },
};

function mergeBookingConfig(raw: InternalBookingAppSettings["booking"]): InternalBookingConfig {
  const businessHours = { ...DEFAULT_BOOKING_CONFIG.businessHours };
  for (const key of Object.keys(businessHours) as WeekdayKey[]) {
    const day = raw?.businessHours?.[key];
    if (!day) continue;
    businessHours[key] = {
      enabled: typeof day.enabled === "boolean" ? day.enabled : businessHours[key].enabled,
      start: String(day.start || businessHours[key].start),
      end: String(day.end || businessHours[key].end),
    };
  }
  return {
    slotStepMin: Math.max(5, Number(raw?.slotStepMin || DEFAULT_BOOKING_CONFIG.slotStepMin)),
    bufferMin: Math.max(0, Number(raw?.bufferMin || DEFAULT_BOOKING_CONFIG.bufferMin)),
    businessHours,
  };
}

function isCoreOfferActiveNow(offer: CoreDiscount, now = new Date()) {
  if (!offer.active || offer.deletedAt || offer.published === false) return false;
  const today = now.toISOString().slice(0, 10);
  const startsAt = String(offer.startsAt || "").slice(0, 10);
  const endsAt = String(offer.endsAt || "").slice(0, 10);
  if (startsAt && today < startsAt) return false;
  if (endsAt && today > endsAt) return false;
  if (offer.usageLimit != null && offer.usedCount >= offer.usageLimit) return false;
  return true;
}

const QUICK_CLIENT_HISTORY_KEY = "internal_quick_clients_history_v1";

function makeLocalId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function candidateIdentity(raw: any) {
  const phone = phone10Digits(raw?.phone || raw?.mobile || raw?.clientPhone || "");
  if (phone) return `p:${phone}`;
  const name = normalizeSearchText(String(raw?.name || raw?.fullName || raw?.clientName || ""));
  return name ? `n:${name}` : "";
}

function readQuickClients(): ClientCandidate[] {
  try {
    const raw = localStorage.getItem(QUICK_CLIENT_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.entries(parsed || {})
      .map(([key, value]: [string, any]) => ({
        id: String(value?.id || `history:${key}`).trim(),
        name: String(value?.name || "بدون اسم").trim(),
        phone: phone10Digits(value?.phone || ""),
        source: String(value?.source || "history"),
        visits: Math.max(0, Number(value?.usedCount || 0)),
        _lastUsedAt: Math.max(0, Number(value?.lastUsedAt || 0)),
      }))
      .sort((a: any, b: any) => b._lastUsedAt - a._lastUsedAt)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function markQuickClientUsage(raw: ClientCandidate) {
  const key = candidateIdentity(raw);
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(QUICK_CLIENT_HISTORY_KEY) || "{}") || {};
    const prev = parsed[key] || {};
    parsed[key] = {
      id: raw.id || prev.id || "",
      name: raw.name || prev.name || "",
      phone: raw.phone || prev.phone || "",
      usedCount: Math.max(1, Number(prev.usedCount || 0) + 1),
      lastUsedAt: Date.now(),
      source: raw.source || prev.source || "v2",
    };
    localStorage.setItem(QUICK_CLIENT_HISTORY_KEY, JSON.stringify(parsed));
  } catch {
    // ignore local storage errors
  }
}

function catalogLabel(raw: any, fallback: string) {
  return String(readDisplayLabel(raw, fallback) || fallback).trim();
}

function serviceTitle(service: any) {
  return catalogLabel(service, "خدمة");
}

function partyClientKey(client: ClientCandidate | null | undefined) {
  if (!client) return "";
  const rawId = String(client.id || "").trim();

  // Canonical Core client ID is the booking ownership key. Phone/name are only
  // fallbacks for quick-history rows that have not been resolved to Core yet.
  if (rawId && !rawId.startsWith("history:")) return `id:${rawId}`;

  const fallbackIdentity = candidateIdentity(client);
  if (fallbackIdentity) return fallbackIdentity;
  return rawId ? `id:${rawId}` : "";
}

function samePartyClient(left: ClientCandidate | null | undefined, right: ClientCandidate | null | undefined) {
  if (!left || !right) return false;

  const leftId = String(left.id || "").trim();
  const rightId = String(right.id || "").trim();
  const leftCanonical = leftId && !leftId.startsWith("history:");
  const rightCanonical = rightId && !rightId.startsWith("history:");
  if (leftCanonical && rightCanonical && leftId === rightId) return true;

  const leftPhone = phone10Digits(left.phone || "");
  const rightPhone = phone10Digits(right.phone || "");
  if (leftPhone && rightPhone && leftPhone === rightPhone) return true;

  return partyClientKey(left) === partyClientKey(right);
}

function bookingLineKey(service: any) {
  return String(service?.__bookingLineId || service?.id || "").trim();
}

function bookingLineClientKey(service: any) {
  return String(service?.__partyClientKey || "").trim();
}

function bookingLineClientName(service: any) {
  return String(service?.__partyClientName || "").trim();
}

function attachServiceToClient(service: CatalogService, client: ClientCandidate): CatalogService {
  const clientKey = partyClientKey(client);
  const serviceId = String(service?.id || "").trim();
  return {
    ...service,
    __bookingLineId: `${clientKey}::${serviceId}`,
    __partyClientKey: clientKey,
    __partyClientId: String(client.id || "").trim(),
    __partyClientName: client.name,
    __partyClientPhone: client.phone,
  };
}

function clientHasService(cart: CatalogService[], client: ClientCandidate, service: CatalogService) {
  const clientKey = partyClientKey(client);
  const serviceId = String(service?.id || "").trim();
  return cart.some(
    (item) =>
      bookingLineClientKey(item) === clientKey &&
      String(item?.id || "").trim() === serviceId
  );
}

function addServiceForClient(cart: CatalogService[], service: CatalogService, client: ClientCandidate) {
  if (clientHasService(cart, client, service)) return cart;
  return [...cart, attachServiceToClient(service, client)];
}

function removeServiceForClient(cart: CatalogService[], service: CatalogService, client: ClientCandidate) {
  const lineKey = bookingLineKey(attachServiceToClient(service, client));
  return cart.filter((item) => bookingLineKey(item) !== lineKey);
}

function offerAutoAddedId(service: any) {
  return String(service?.__autoAddedByOfferId || "").trim();
}

function attachOfferServiceToClient(service: CatalogService, client: ClientCandidate, offerId: string): CatalogService {
  return {
    ...attachServiceToClient(service, client),
    __autoAddedByOfferId: String(offerId || "").trim(),
  };
}

function serviceDuration(service: any) {
  const raw =
    service?.["المدة"] ??
    service?.durationMin ??
    service?.durationMinutes ??
    service?.duration_minutes ??
    service?.duration ??
    0;
  const value = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function servicePrice(service: any) {
  const raw =
    service?.["السعر"] ??
    service?.priceText ??
    service?.priceLabel ??
    service?.price ??
    service?.basePrice ??
    service?.amount ??
    0;
  if (typeof raw === "number") return Math.max(0, Number(raw || 0));
  const numeric = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return Math.max(0, Number(extractMinPriceInternal(String(raw || "")) || 0));
}

function roundMoney(value: number) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function splitAmountByWeights(total: number, weights: number[]) {
  const roundedTotal = roundMoney(total);
  const sum = weights.reduce((acc, value) => acc + Math.max(0, Number(value || 0)), 0);
  if (roundedTotal <= 0 || sum <= 0 || !weights.length) return weights.map(() => 0);

  let running = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return roundMoney(roundedTotal - running);
    const part = roundMoney((roundedTotal * Math.max(0, Number(weight || 0))) / sum);
    running = roundMoney(running + part);
    return part;
  });
}

function createInternalV2InvoicePrintRequestId(source: string) {
  const requestId = `${source}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem("invoicePrintRequestId", requestId);
  } catch {
    // ignore storage errors; SuccessInternal can still render allBookings.
  }
  return requestId;
}

function buildInternalV2InvoiceRows(args: {
  createdPartyBookings: CreatedPartyBooking[];
  cart: CatalogService[];
  scheduleByService: Record<string, ScheduleSelection>;
  bookingDate: string;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  effectivePaidAmount: number;
  remainingAmount: number;
  cashAmount: string;
  cardAmount: string;
  transferAmount: string;
  selectedSectionId: string;
  bookingPriceByService: Record<string, number>;
  discountSnapshot?: DiscountSnapshot | null;
}) {
  if (!args.createdPartyBookings.length || !args.cart.length) return [];

  const createdByClient = new Map(args.createdPartyBookings.map((row) => [row.clientKey, row]));
  const rowOriginalPrices = args.cart.map((service) => {
    const key = bookingLineKey(service);
    const agreed = Number(args.bookingPriceByService[key]);
    return Number.isFinite(agreed)
      ? Math.max(0, agreed)
      : Math.max(0, servicePrice(service));
  });
  const allocationByItem = new Map(
    (args.discountSnapshot?.allocations || []).map((row) => [String(row.bookingItemId || row.serviceId || "").trim(), row])
  );
  const rowFinalPrices = args.cart.map((service, index) => {
    const lineKey = bookingLineKey(service);
    const allocation = allocationByItem.get(lineKey);
    return allocation ? halalasToSar(allocation.finalAmountHalalas) : rowOriginalPrices[index] || 0;
  });
  const paidParts = splitAmountByWeights(args.effectivePaidAmount, rowFinalPrices);
  const remainingParts = splitAmountByWeights(args.remainingAmount, rowFinalPrices);
  const paymentBreakdown =
    args.paymentType === "none"
      ? { cash: 0, card: 0, transfer: 0 }
      : args.paymentMethod === "mixed"
        ? {
            cash: Math.max(0, Number(args.cashAmount || 0)),
            card: Math.max(0, Number(args.cardAmount || 0)),
            transfer: Math.max(0, Number(args.transferAmount || 0)),
          }
        : {
            cash: args.paymentMethod === "cash" ? args.effectivePaidAmount : 0,
            card: args.paymentMethod === "card" ? args.effectivePaidAmount : 0,
            transfer: args.paymentMethod === "transfer" ? args.effectivePaidAmount : 0,
          };
  const cashParts = splitAmountByWeights(paymentBreakdown.cash, rowFinalPrices);
  const cardParts = splitAmountByWeights(paymentBreakdown.card, rowFinalPrices);
  const transferParts = splitAmountByWeights(paymentBreakdown.transfer, rowFinalPrices);
  const createdAt = Date.now();

  return args.cart.map((service, index) => {
    const lineKey = bookingLineKey(service);
    const serviceId = String(service.id || "").trim();
    const clientKey = bookingLineClientKey(service);
    const created = createdByClient.get(clientKey);
    const memberLines = args.cart.filter((row) => bookingLineClientKey(row) === clientKey);
    const memberIndex = memberLines.findIndex((row) => bookingLineKey(row) === lineKey);
    const schedule = (args.scheduleByService[lineKey] || {}) as Partial<ScheduleSelection>;
    const rowId = String(created?.itemIds?.[memberIndex] || created?.parentId || `${lineKey}_${index}`).trim();
    const allocation = allocationByItem.get(lineKey);
    const originalTotal = rowOriginalPrices[index] || 0;
    const discountAmount = allocation ? halalasToSar(allocation.discountAmountHalalas) : 0;
    const total = rowFinalPrices[index] || 0;
    const serviceName = serviceTitle(service);
    const sectionTitle = String(service?.sectionTitle || service?.sectionName || service?.sectionLabel || args.selectedSectionId || "").trim();
    const categoryTitle = String(service?.categoryTitle || service?.categoryName || service?.categoryLabel || service?.categoryId || "").trim();
    return {
      id: rowId,
      publicId: created?.publicId || created?.parentId || "",
      parentId: created?.parentId || "",
      clientId: created?.clientId || "",
      clientName: created?.clientName || bookingLineClientName(service),
      clientPhone: created?.clientPhone || String(service?.__partyClientPhone || ""),
      serviceId,
      serviceName,
      serviceSectionId: String(service?.sectionId || args.selectedSectionId || "").trim() || undefined,
      serviceSectionTitle: sectionTitle || undefined,
      serviceCategoryId: String(service?.categoryId || service?.category || "").trim() || undefined,
      serviceCategoryName: categoryTitle || undefined,
      serviceSnapshot: {
        serviceNameAtBooking: serviceName,
        sectionIdAtBooking: String(service?.sectionId || args.selectedSectionId || "").trim() || undefined,
        sectionTitleAtBooking: sectionTitle || undefined,
        categoryIdAtBooking: String(service?.categoryId || service?.category || "").trim() || undefined,
        categoryNameAtBooking: categoryTitle || undefined,
      },
      employeeName: String(schedule.staffName || "").trim(),
      date: args.bookingDate,
      time: String(schedule.time || "").trim(),
      durationMin: serviceDuration(service) || 30,
      originalAmount: originalTotal,
      discountAmount,
      discountSnapshot: args.discountSnapshot || undefined,
      total,
      finalPrice: total,
      paymentMethod: args.paymentType === "none" ? undefined : args.paymentMethod,
      paymentBreakdown: {
        cash: cashParts[index] || 0,
        card: cardParts[index] || 0,
        transfer: transferParts[index] || 0,
      },
      paymentType: args.paymentType,
      paidAmount: paidParts[index] || 0,
      remainingAmount: remainingParts[index] || 0,
      status: args.paymentType === "none" ? "pending" : "confirmed",
      createdAt,
    };
  });
}

function serviceCategoryId(service: any) {
  return String(service?.categoryId ?? service?.category_id ?? service?.["معرف_التصنيف"] ?? "").trim();
}

function weekdayKey(dateISO: string) {
  const date = new Date(`${dateISO}T12:00:00`);
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return keys[date.getDay()] || "sun";
}

function staffName(staff: any) {
  return String(staff?.name || staff?.fullName || staff?.displayName || staff?.employeeName || "موظفة").trim();
}

function staffId(staff: any) {
  return String(staff?.id || staff?.employeeId || staff?.uid || "").trim();
}

function offerValueLabel(offer: CoreDiscount, language: DashboardLanguage = "ar") {
  const type = String((offer as any)?.discountType || (offer as any)?.type || "").trim();
  const value = Number((offer as any)?.value || 0);
  if (type === "percent") return `${value}%`;
  return `${value.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")} ${language === "en" ? "SAR" : "ر.س"}`;
}

function serviceCatalogPrice(service: any) {
  const direct = Number(service?.catalogPrice);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const halalas = Number(service?.catalogPriceHalalas ?? service?.catalog_price_halalas);
  if (Number.isFinite(halalas) && halalas >= 0) return halalas / 100;
  return servicePrice(service);
}

function serviceHasActivePromo(service: any) {
  return service?.promoActive === true || Number(service?.promo_active) === 1;
}

function offerLinkedServiceIds(offer: CoreDiscount) {
  const orderedSteps = Array.isArray(offer.sequenceSteps)
    ? [...offer.sequenceSteps].sort(
        (left: any, right: any) =>
          Number(left?.orderIndex ?? left?.order_index ?? 0) -
          Number(right?.orderIndex ?? right?.order_index ?? 0)
      )
    : [];
  const ids = [
    ...orderedSteps.map((step: any) => String(step?.serviceId ?? step?.service_id ?? "").trim()),
    ...(Array.isArray(offer.serviceIds) ? offer.serviceIds.map((id) => String(id || "").trim()) : []),
  ].filter(Boolean);
  return Array.from(new Set(ids));
}

function discountReasonText(reason: string, language: DashboardLanguage = "ar") {
  const map: Record<string, string> = {
    discount_inactive: "الخصم غير نشط.",
    discount_expired_or_not_started: "الخصم خارج فترة الصلاحية.",
    discount_usage_limit_reached: "تم تجاوز حد استخدام الخصم.",
    discount_no_eligible_services: "لا توجد خدمات مؤهلة لهذا الخصم.",
    discount_minimum_not_met: "لم يتحقق الحد الأدنى للخصم.",
    discount_invalid_type: "نوع الخصم غير صحيح.",
    discount_invalid_value: "قيمة الخصم غير صحيحة.",
    discount_percent_over_100: "النسبة لا يمكن أن تتجاوز 100%.",
    discount_zero: "الخصم الناتج يساوي صفر.",
  };
  return map[reason] ? bookingsText(language, map[reason]) : reason || "";
}

const steps = [
  { id: 1 as const, title: "العميلة", subtitle: "اختيار العميلة", icon: FiUser },
  { id: 2 as const, title: "الخدمات", subtitle: "اختيار الخدمات", icon: FiShoppingBag },
  { id: 3 as const, title: "الموظفة والموعد", subtitle: "تحديد الوقت", icon: FiUsers },
  { id: 4 as const, title: "الدفع", subtitle: "المراجعة والدفع", icon: FiCreditCard },
];

export default function BookingInternalV2({ language = "ar" }: { language?: DashboardLanguage }) {
  const t = (text: string) => bookingsText(language, text);
  const { hasPermission } = usePermissions();
  const canAdjustBookingPrice = hasPermission("bookings.price.adjust");
  const canApplyManualDiscount = hasPermission("bookings.discount.apply");
  const locale = language === "en" ? "en-US" : "ar-SA-u-nu-latn";
  const currency = language === "en" ? "SAR" : "ر.س";
  const money = (value: number) => `${Number(value || 0).toLocaleString(locale)} ${currency}`;
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<"new" | "sessions">("new");
  const [hairGuideOpen, setHairGuideOpen] = useState(false);
  const hairGuideTriggerRef = useRef<HTMLButtonElement | null>(null);
  const summaryScrollRef = useRef<HTMLDivElement | null>(null);
  const handleSummaryWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    const scroller = summaryScrollRef.current;
    if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScrollTop <= 0) return;

    const canScrollUp = event.deltaY < 0 && scroller.scrollTop > 0;
    const canScrollDown = event.deltaY > 0 && scroller.scrollTop < maxScrollTop - 1;
    if (!canScrollUp && !canScrollDown) return;

    event.preventDefault();
    event.stopPropagation();
    scroller.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scroller.scrollTop + event.deltaY)
    );
  }, []);

  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientCandidate | null>(null);
  const [companions, setCompanions] = useState<ClientCandidate[]>([]);
  const [addingCompanion, setAddingCompanion] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(true);
  const [activePartyClientKey, setActivePartyClientKey] = useState("");
  const [clients, setClients] = useState<ClientCandidate[]>(() => readQuickClients());
  const [clientSearching, setClientSearching] = useState(false);
  const [clientMessage, setClientMessage] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientError, setNewClientError] = useState("");
  // CLIENT_PHONE_DEDUP_UI_V1
  const [existingClientMatch, setExistingClientMatch] = useState<ClientCandidate | null>(null);
  const [existingClientChecking, setExistingClientChecking] = useState(false);
  const [existingClientLookupError, setExistingClientLookupError] = useState("");
  const newClientLookupSeq = useRef(0);
  const clientSearchInputRef = useRef<HTMLInputElement | null>(null);

  const [sections, setSections] = useState<CatalogSection[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [allServices, setAllServices] = useState<CatalogService[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [cart, setCart] = useState<CatalogService[]>([]);
  const [priceAdjustments, setPriceAdjustments] = useState<Record<string, BookingPriceAdjustment>>({});
  const [bookingDate, setBookingDate] = useState(todayISO());
  const [eligibleStaffByService, setEligibleStaffByService] = useState<Record<string, StaffRow[]>>({});
  const [staffLoading, setStaffLoading] = useState(false);
  const [scheduleByService, setScheduleByService] = useState<Record<string, ScheduleSelection>>({});
  const [availableTimes, setAvailableTimes] = useState<Record<string, string[]>>({});
  const [timesLoading, setTimesLoading] = useState<Record<string, boolean>>({});
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [appSettings, setAppSettings] = useState<InternalBookingAppSettings>({ booking: DEFAULT_BOOKING_CONFIG });
  const [settingsReady, setSettingsReady] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentType, setPaymentType] = useState<PaymentType>("full");
  const [paidAmount, setPaidAmount] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [bookingNote, setBookingNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [postSaveWarning, setPostSaveWarning] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [showPastDateConfirmation, setShowPastDateConfirmation] = useState(false);
  const [createdBookingIds, setCreatedBookingIds] = useState<string[]>([]);
  const [createdPartyBookings, setCreatedPartyBookings] = useState<CreatedPartyBooking[]>([]);
  const [createdBookingReference, setCreatedBookingReference] = useState("");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("none");
  const [manualFixedDiscount, setManualFixedDiscount] = useState("");
  const [manualPercentDiscount, setManualPercentDiscount] = useState("");
  const [manualMaxDiscount, setManualMaxDiscount] = useState("");
  const [offers, setOffers] = useState<CoreDiscount[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersMessage, setOffersMessage] = useState("");
  const [selectedOfferByClientKey, setSelectedOfferByClientKey] = useState<Record<string, string>>({});
  const [couponInput, setCouponInput] = useState("");
  const [couponOffer, setCouponOffer] = useState<CoreDiscount | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponMessage, setCouponMessage] = useState("");

  const candidateFromCoreRow = useCallback((raw: any, fallbackSource = "core_d1"): ClientCandidate => ({
    id: String(raw?.id || `${fallbackSource}:${makeLocalId()}`),
    name: String(raw?.name || raw?.fullName || raw?.clientName || "بدون اسم").trim(),
    phone: phone10Digits(raw?.phone || raw?.mobile || raw?.clientPhone || raw?.phoneNormalized || raw?.phone_normalized || ""),
    publicId: String(raw?.publicId || raw?.public_id || raw?.trackPublicId || raw?.mk || "").trim() || undefined,
    source: String(raw?.source || fallbackSource),
    visits: Math.max(0, Number(raw?.visits || raw?.usedCount || 0)) || undefined,
    sessions: Math.max(0, Number(raw?.sessions || raw?.remainingSessions || 0)) || undefined,
  }), []);

  const bookingClients = useMemo(
    () => selectedClient ? [selectedClient, ...companions] : [],
    [selectedClient, companions]
  );
  const activeBookingClient = useMemo(() => {
    if (!bookingClients.length) return null;
    return bookingClients.find((client) => partyClientKey(client) === activePartyClientKey) || bookingClients[0];
  }, [bookingClients, activePartyClientKey]);

  const scheduleGroups = useMemo(
    () => bookingClients
      .map((client, clientIndex) => {
        const clientKey = partyClientKey(client);
        return {
          client,
          clientKey,
          clientIndex,
          services: cart.filter((service) => bookingLineClientKey(service) === clientKey),
        };
      })
      .filter((group) => group.services.length > 0),
    [bookingClients, cart]
  );

  useEffect(() => {
    if (clientPickerOpen || addingCompanion) {
      window.setTimeout(() => clientSearchInputRef.current?.focus(), 0);
    }
  }, [clientPickerOpen, addingCompanion]);

  useEffect(() => {
    if (!selectedClient) {
      setActivePartyClientKey("");
      return;
    }
    const keys = new Set(bookingClients.map(partyClientKey));
    if (!activePartyClientKey || !keys.has(activePartyClientKey)) {
      setActivePartyClientKey(partyClientKey(selectedClient));
    }
  }, [selectedClient, bookingClients, activePartyClientKey]);

  const findExistingClientByPhone = useCallback(async (rawPhone: string) => {
    const phone = phone10Digits(rawPhone);
    if (phone.length !== 10) return null;
    const rows = await resolveCoreBookingDataSource().searchClients(phone);
    const exact = (Array.isArray(rows) ? rows : []).find((row: any) =>
      phone10Digits(row?.phone || row?.mobile || row?.clientPhone || row?.phoneNormalized || row?.phone_normalized || "") === phone
    );
    return exact ? candidateFromCoreRow(exact, "core_d1") : null;
  }, [candidateFromCoreRow]);

  const chooseClientForBooking = useCallback((candidate: ClientCandidate, message: string) => {
    const candidateKey = partyClientKey(candidate);
    if (addingCompanion && selectedClient) {
      if (companions.length >= 19) {
        setClientMessage(t("وصلت مجموعة الحجز إلى الحد الأقصى المسموح."));
        return;
      }

      const existingPartyClient = bookingClients.find((row) => samePartyClient(row, candidate));
      if (existingPartyClient) {
        setActivePartyClientKey(partyClientKey(existingPartyClient));
        setClientMessage(
          samePartyClient(selectedClient, candidate)
            ? t("هذه هي العميلة الأساسية بالفعل.")
            : t("هذه العميلة موجودة بالفعل في مجموعة الحجز.")
        );
      } else {
        setCompanions((current) => [...current, candidate]);
        setActivePartyClientKey(candidateKey);
        setClientMessage(t("تمت إضافة المرافقة إلى نفس مجموعة الحجز."));
      }
      setAddingCompanion(false);
      setClientPickerOpen(false);
    } else {
      const currentPrimaryKey = partyClientKey(selectedClient);
      setSelectedClient(candidate);
      setCompanions([]);
      setActivePartyClientKey(candidateKey);
      setAddingCompanion(false);
      setClientPickerOpen(false);
      if (currentPrimaryKey && currentPrimaryKey !== candidateKey) {
        setCart([]);
        setPriceAdjustments({});
        setScheduleByService({});
        setAvailableTimes({});
        setSelectedOfferByClientKey({});
        setDiscountMode("none");
      }
      setClientMessage(message);
    }
    setClients((current) => [candidate, ...current.filter((row) => candidateIdentity(row) !== candidateIdentity(candidate))]);
    setQuery("");
    markQuickClientUsage(candidate);
    setShowNewClient(false);
    setNewClientName("");
    setNewClientPhone("");
    setNewClientEmail("");
    setExistingClientMatch(null);
    setExistingClientLookupError("");
    setNewClientError("");
  }, [addingCompanion, selectedClient, companions.length, bookingClients, language]);

  useEffect(() => {
    const phone = phone10Digits(newClientPhone);
    const lookupSeq = ++newClientLookupSeq.current;

    if (!showNewClient || phone.length !== 10) {
      setExistingClientMatch(null);
      setExistingClientChecking(false);
      setExistingClientLookupError("");
      return;
    }

    setExistingClientChecking(true);
    setExistingClientLookupError("");

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const match = await findExistingClientByPhone(phone);
          if (lookupSeq !== newClientLookupSeq.current) return;
          setExistingClientMatch(match);
        } catch (error) {
          console.error("[BookingInternalV2] client phone dedup lookup failed", error);
          if (lookupSeq !== newClientLookupSeq.current) return;
          setExistingClientMatch(null);
          setExistingClientLookupError(t("تعذر التحقق من رقم الجوال. لن يتم إنشاء سجل جديد قبل نجاح التحقق."));
        } finally {
          if (lookupSeq === newClientLookupSeq.current) setExistingClientChecking(false);
        }
      })();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [showNewClient, newClientPhone, findExistingClientByPhone, language]);

  const createNewClient = useCallback(async () => {
    const name = String(newClientName || "").trim();
    const phone = phone10Digits(newClientPhone);
    const email = String(newClientEmail || "").trim();
    if (name.length < 2) { setNewClientError(t(addingCompanion ? "اكتبي اسم المرافقة." : "اكتبي اسم العميلة كاملًا.")); return; }
    if (!addingCompanion && (!phone || phone.length !== 10)) { setNewClientError(t("أدخلي رقم جوال سعودي صحيح من 10 أرقام.")); return; }
    if (phone && phone.length !== 10) { setNewClientError(t("أدخلي رقم جوال سعودي صحيح من 10 أرقام أو اتركيه فارغًا للمرافقة.")); return; }

    setCreatingClient(true);
    setExistingClientChecking(Boolean(phone));
    setExistingClientLookupError("");
    setNewClientError("");

    try {
      // Re-check immediately before CREATE. The preview lookup is UX only;
      // this gate is the authoritative client-side duplicate stop.
      const existing = phone ? await findExistingClientByPhone(phone) : null;
      if (existing) {
        setExistingClientMatch(existing);
        setClientMessage(t("تم العثور على عميلة مسجلة بهذا الرقم. اختاري السجل الموجود للمتابعة."));
        return;
      }

      const created: any = await resolveCoreBookingDataSource().createClient({
        name,
        phone: phone || undefined,
        email: email || undefined,
      });
      const candidate = candidateFromCoreRow(created || { name, phone }, "client_profile");
      chooseClientForBooking(candidate, t("تم اختيار العميلة للحجز بنجاح."));
    } catch (error: any) {
      console.error("[BookingInternalV2] client create/dedup check failed", error);
      const code = String(error?.code || "").toLowerCase();
      if (code === "core_api:offline" || code === "core_api:network_unavailable" || code === "core_api:timeout") {
        setNewClientError(t("غير متصل بالإنترنت. لم يتم إنشاء العميلة. أعيدي الاتصال ثم حاولي مرة أخرى."));
      } else if (code === "core_api:write_outcome_unknown") {
        setNewClientError(t("انقطع الاتصال أثناء حفظ العميلة. النتيجة غير مؤكدة؛ أعيدي الاتصال وابحثي برقم الجوال قبل إعادة المحاولة."));
      } else {
        setNewClientError(t("تعذر التحقق من رقم الجوال أو حفظ العميلة. حاولي مرة أخرى."));
      }
    } finally {
      setExistingClientChecking(false);
      setCreatingClient(false);
    }
  }, [newClientName, newClientPhone, newClientEmail, addingCompanion, findExistingClientByPhone, candidateFromCoreRow, chooseClientForBooking, language]);

  const searchClients = useCallback(async (rawQuery: string) => {
    const qRaw = String(rawQuery || "").trim();
    if (!qRaw) {
      setClients(readQuickClients());
      setClientMessage("");
      return;
    }

    setClientSearching(true);
    setClientMessage("");
    const seen = new Set<string>();
    const found: ClientCandidate[] = [];

    const push = (raw: any, source = "profile") => {
      const name = String(raw?.name || raw?.fullName || raw?.clientName || "").trim();
      const phone = phone10Digits(raw?.phone || raw?.mobile || raw?.clientPhone || "");
      const publicId = String(raw?.publicId || raw?.trackPublicId || raw?.mk || "").trim();
      if (!name && !phone && !publicId) return;
      const identity = phone ? `phone:${phone}` : publicId ? `mk:${normalizeSearchText(publicId)}` : `name:${normalizeSearchText(name)}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      found.push({
        id: String(raw?.id || `${source}:${makeLocalId()}`),
        name: name || t("بدون اسم"),
        phone,
        publicId,
        source: String(raw?.source || source),
        visits: Math.max(0, Number(raw?.visits || raw?.usedCount || 0)),
        sessions: Math.max(0, Number(raw?.sessions || raw?.remainingSessions || 0)) || undefined,
      });
    };

    try {
      const rows = await resolveCoreBookingDataSource().searchClients(qRaw);
      (Array.isArray(rows) ? rows : []).forEach((row: any) => push(row, "core_d1"));
      setClients(found.slice(0, 25));
      setClientMessage(found.length ? (language === "en" ? `${found.length} result(s) found.` : `تم العثور على ${found.length} نتيجة.`) : t("لم يتم العثور على عميلة مطابقة."));
    } catch (error) {
      console.error("[BookingInternalV2] client search failed", error);
      setClients([]);
      setClientMessage(t("تعذر جلب بيانات العميلات من السيرفر."));
    } finally {
      setClientSearching(false);
    }
  }, [language]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchClients(query);
    }, query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [query, searchClients]);

  useEffect(() => {
    let cancelled = false;
    async function loadCoreSettings() {
      try {
        const setting = await CoreSettingsService.get<InternalBookingAppSettings>("app");
        if (!setting) throw new Error("SETTINGS_D1_NOT_FOUND");
        if (!cancelled) {
          setAppSettings(setting.value || { booking: DEFAULT_BOOKING_CONFIG });
          setSettingsReady(true);
        }
      } catch (error) {
        console.error("[BookingInternalV2] settings load failed", error);
        if (!cancelled) {
          setSettingsReady(false);
          setScheduleMessage(t("تعذر تحميل إعدادات الحجز من Core D1. أعيدي المحاولة قبل حفظ الحجز."));
        }
      }
    }
    void loadCoreSettings();
    return () => { cancelled = true; };
  }, []);


  useEffect(() => {
    let cancelled = false;
    async function loadDiscountOffers() {
      setOffersLoading(true);
      setOffersMessage("");
      try {
        const rows = await CoreOfferService.list({ active: true });
        if (cancelled) return;
        const activeRows = (Array.isArray(rows) ? rows : [])
          .filter((offer: any) => !offer?.deletedAt)
          .filter((offer) => isCoreOfferActiveNow(offer))
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
        setOffers(activeRows);
        if (!activeRows.length) setOffersMessage(t("لا توجد عروض نشطة حالياً."));
      } catch (error) {
        console.error("[BookingInternalV2] offers load failed", error);
        if (!cancelled) {
          setOffers([]);
          setOffersMessage(t("تعذر جلب العروض النشطة."));
        }
      } finally {
        if (!cancelled) setOffersLoading(false);
      }
    }
    void loadDiscountOffers();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAllServicesForOffers() {
      try {
        const rows = await resolveCoreBookingDataSource().getServices();
        if (!cancelled) {
          setAllServices(Array.isArray(rows) ? (rows as CatalogService[]) : []);
        }
      } catch (error) {
        console.error("[BookingInternalV2] all services load for offers failed", error);
        if (!cancelled) setAllServices([]);
      }
    }
    void loadAllServicesForOffers();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSections() {
      setCatalogLoading(true);
      setCatalogMessage("");
      try {
        const rows = await resolveCoreBookingDataSource().getServiceSections();
        if (cancelled) return;
        const safe = Array.isArray(rows) ? (rows as CatalogSection[]) : [];
        setSections(safe);
        setSelectedSectionId((current) => current || String(safe[0]?.id || ""));
        if (!safe.length) setCatalogMessage(t("لا توجد أقسام خدمات نشطة."));
      } catch (error) {
        console.error("[BookingInternalV2] sections load failed", error);
        if (!cancelled) setCatalogMessage(t("تعذر جلب قائمة الخدمات من السيرفر."));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }
    void loadSections();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSectionCatalog() {
      if (!selectedSectionId) {
        setCategories([]);
        setServices([]);
        return;
      }
      setCategories([]);
      setServices([]);
      setSelectedCategoryId("");
      setCatalogLoading(true);
      setCatalogMessage("");
      try {
        const [cats, rows] = await Promise.all([
          resolveCoreBookingDataSource().getServiceCategories(selectedSectionId),
          resolveCoreBookingDataSource().getServices(selectedSectionId),
        ]);
        if (cancelled) return;
        setCategories(Array.isArray(cats) ? (cats as CatalogCategory[]) : []);
        setServices(Array.isArray(rows) ? (rows as CatalogService[]) : []);
        setSelectedCategoryId("");
      } catch (error) {
        console.error("[BookingInternalV2] services load failed", error);
        if (!cancelled) {
          setCategories([]);
          setServices([]);
          setCatalogMessage(t("تعذر جلب خدمات هذا القسم."));
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }
    void loadSectionCatalog();
    return () => { cancelled = true; };
  }, [selectedSectionId]);

  const visibleClients = clients;
  const visibleServices = useMemo(() => {
    const needle = normalizeSearchText(serviceQuery);
    return services.filter((service) => {
      const categoryOk = !selectedCategoryId || serviceCategoryId(service) === selectedCategoryId;
      const displayTitle = translateBookingCatalogLabel(language, serviceTitle(service), "service");
      const textOk = !needle || normalizeSearchText(`${serviceTitle(service)} ${displayTitle} ${service?.description || ""}`).includes(needle);
      return categoryOk && textOk;
    });
  }, [services, selectedCategoryId, serviceQuery, language]);

  const catalogTotal = useMemo(
    () => cart.reduce((sum, service) => sum + serviceCatalogPrice(service), 0),
    [cart]
  );
  const bookingPriceForService = useCallback(
    (service: CatalogService) => {
      const key = bookingLineKey(service);
      const catalogPrice = Math.max(0, servicePrice(service));
      const raw = priceAdjustments[key]?.price;
      if (raw == null || String(raw).trim() === "") return catalogPrice;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : catalogPrice;
    },
    [priceAdjustments]
  );
  const bookingSubtotal = useMemo(
    () => cart.reduce((sum, service) => sum + bookingPriceForService(service), 0),
    [cart, bookingPriceForService]
  );
  const hasPriceAdjustments = useMemo(
    () => cart.some((service) =>
      Math.abs(bookingPriceForService(service) - servicePrice(service)) > 0.005
    ),
    [cart, bookingPriceForService]
  );
  const selectedOfferId = String(selectedOfferByClientKey[activePartyClientKey] || "").trim();
  const selectedOffer = useMemo(() => {
    if (!selectedOfferId) return null;
    return offers.find((offer) => String((offer as any)?.id || "").trim() === selectedOfferId) || null;
  }, [offers, selectedOfferId]);

  const setOfferForClient = useCallback((clientKey: string, offerId: string) => {
    if (!clientKey) return;
    const normalizedOfferId = String(offerId || "").trim();
    setSelectedOfferByClientKey((current) => {
      const next = { ...current };
      if (normalizedOfferId) next[clientKey] = normalizedOfferId;
      else delete next[clientKey];
      return next;
    });
  }, []);

  const selectCatalogOffer = useCallback((offer: CoreDiscount) => {
    const offerId = String(offer?.id || "").trim();
    if (!offerId || !activeBookingClient) return;

    const clientKey = partyClientKey(activeBookingClient);
    const previousOfferId = selectedOfferId;
    const togglingOff = previousOfferId === offerId;
    const nextOfferId = togglingOff ? "" : offerId;
    const nextLinkedIds = togglingOff ? [] : offerLinkedServiceIds(offer);
    const nextLinkedIdSet = new Set(nextLinkedIds);

    const serviceMap = new Map<string, CatalogService>();
    for (const service of [...allServices, ...services]) {
      const key = String(service?.id || "").trim();
      if (key && !serviceMap.has(key)) serviceMap.set(key, service);
    }
    const nextLinkedServices = nextLinkedIds
      .map((id) => serviceMap.get(id))
      .filter((service): service is CatalogService => Boolean(service));

    const removedLineKeys = cart
      .filter((service) =>
        bookingLineClientKey(service) === clientKey &&
        Boolean(offerAutoAddedId(service)) &&
        (!nextOfferId || !nextLinkedIdSet.has(String(service?.id || "").trim()))
      )
      .map(bookingLineKey);
    const removedKeySet = new Set(removedLineKeys);

    if (removedKeySet.size) {
      setPriceAdjustments((current) =>
        Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removedKeySet.has(lineKey)))
      );
      setScheduleByService((current) =>
        Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removedKeySet.has(lineKey)))
      );
      setAvailableTimes((current) =>
        Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removedKeySet.has(lineKey)))
      );
      setEligibleStaffByService((current) =>
        Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removedKeySet.has(lineKey)))
      );
    }

    setCart((current) => {
      let next = current.flatMap((service) => {
        if (bookingLineClientKey(service) !== clientKey) return [service];

        const autoOfferId = offerAutoAddedId(service);
        if (!autoOfferId) return [service];

        const serviceId = String(service?.id || "").trim();
        if (!nextOfferId || !nextLinkedIdSet.has(serviceId)) return [];

        // This service belongs to both the previous and next offer. Keep its
        // booking line/schedule, but transfer ownership to the newly selected offer.
        return [{ ...service, __autoAddedByOfferId: nextOfferId }];
      });

      if (nextOfferId && nextLinkedServices.length) {
        const existing = new Set(
          next
            .filter((service) => bookingLineClientKey(service) === clientKey)
            .map((service) => String(service.id || "").trim())
        );
        const missing = nextLinkedServices
          .filter((service) => !existing.has(String(service.id || "").trim()))
          .map((service) => attachOfferServiceToClient(service, activeBookingClient, nextOfferId));
        if (missing.length) next = [...next, ...missing];
      }

      return next;
    });

    setOfferForClient(clientKey, nextOfferId);

    if (!nextOfferId) {
      const hasOtherOffers = Object.entries(selectedOfferByClientKey)
        .some(([key, value]) => key !== clientKey && Boolean(String(value || "").trim()));
      if (!hasOtherOffers) setDiscountMode("none");
      return;
    }

    setDiscountMode("offer");
    setCouponOffer(null);
    setCouponInput("");
    setCouponMessage("");
  }, [allServices, services, cart, selectedOfferId, selectedOfferByClientKey, activeBookingClient, setOfferForClient]);

  const discountItems = useMemo(() => cart.map((service) => ({
    bookingItemId: bookingLineKey(service),
    serviceId: String(service.id || "").trim(),
    categoryId: String(service?.categoryId || service?.category || "").trim() || undefined,
    originalAmountHalalas: toHalalas(bookingPriceForService(service)),
    partyClientKey: bookingLineClientKey(service),
  })), [cart, bookingPriceForService]);
  useEffect(() => {
    if (
      !canApplyManualDiscount &&
      (discountMode === "fixed" || discountMode === "percent")
    ) {
      setDiscountMode("none");
      setManualFixedDiscount("");
      setManualPercentDiscount("");
      setManualMaxDiscount("");
    }
  }, [canApplyManualDiscount, discountMode]);

  const discountRequest = useMemo(() => {
    if (discountMode === "fixed") {
      return {
        source: "manual" as DiscountSnapshotSource,
        type: "fixed" as const,
        title: t("خصم مبلغ ثابت"),
        value: Math.max(0, Number(manualFixedDiscount || 0)),
        maxDiscountHalalas: manualMaxDiscount ? toHalalas(manualMaxDiscount) : null,
      };
    }
    if (discountMode === "percent") {
      return {
        source: "manual" as DiscountSnapshotSource,
        type: "percent" as const,
        title: t("خصم نسبة"),
        percentage: Math.max(0, Number(manualPercentDiscount || 0)),
        maxDiscountHalalas: manualMaxDiscount ? toHalalas(manualMaxDiscount) : null,
      };
    }
    if (discountMode === "offer" && selectedOffer) {
      return {
        source: "offer" as DiscountSnapshotSource,
        sourceId: String((selectedOffer as any)?.id || ""),
        code: String((selectedOffer as any)?.code || ""),
        title: String(selectedOffer.name || ""),
        offer: selectedOffer,
      };
    }
    if (discountMode === "coupon" && couponOffer) {
      return {
        source: "coupon" as DiscountSnapshotSource,
        sourceId: String((couponOffer as any)?.id || ""),
        code: normalizeDiscountCode(couponInput || (couponOffer as any)?.code),
        title: String(couponOffer.name || ""),
        offer: couponOffer,
      };
    }
    return { source: "none" as DiscountSnapshotSource };
  }, [discountMode, manualFixedDiscount, manualMaxDiscount, manualPercentDiscount, selectedOffer, couponOffer, couponInput]);
  const discountResultsByClient = useMemo(() => {
    const results = new Map<string, ReturnType<typeof buildDiscountSnapshot>>();
    const isPartyManualDiscount =
      bookingClients.length > 1 &&
      (discountMode === "fixed" || discountMode === "percent");

    let globalManualResult: ReturnType<typeof buildDiscountSnapshot> | null = null;
    if (isPartyManualDiscount) {
      const globalItems = discountItems.map(({ partyClientKey: _partyClientKey, ...item }: any) => item);
      globalManualResult = buildDiscountSnapshot(globalItems, discountRequest);
    }

    for (const client of bookingClients) {
      const key = partyClientKey(client);
      const items = discountItems
        .filter((item: any) => item.partyClientKey === key)
        .map(({ partyClientKey: _partyClientKey, ...item }: any) => item);
      if (!items.length) continue;

      if (discountMode === "offer") {
        const memberOfferId = String(selectedOfferByClientKey[key] || "").trim();
        const memberOffer = memberOfferId
          ? offers.find((offer) => String((offer as any)?.id || "").trim() === memberOfferId) || null
          : null;

        results.set(
          key,
          memberOffer
            ? buildDiscountSnapshot(items, {
                source: "offer",
                sourceId: memberOfferId,
                code: String((memberOffer as any)?.code || ""),
                title: String(memberOffer.name || ""),
                offer: memberOffer,
              })
            : buildDiscountSnapshot(items, { source: "none" })
        );
        continue;
      }

      if (globalManualResult) {
        if (!globalManualResult.ok || !globalManualResult.snapshot) {
          results.set(key, globalManualResult);
          continue;
        }

        const lineKeys = new Set(items.map((item: any) => String(item.bookingItemId || "").trim()));
        const memberDiscountHalalas = globalManualResult.snapshot.allocations
          .filter((row) => lineKeys.has(String(row.bookingItemId || "").trim()))
          .reduce((sum, row) => sum + Math.max(0, Number(row.discountAmountHalalas || 0)), 0);

        if (memberDiscountHalalas <= 0) {
          results.set(key, buildDiscountSnapshot(items, { source: "none" }));
          continue;
        }

        // A fixed amount is sent to each underlying client booking so the sum
        // of the independent Core bookings equals the single checkout discount.
        // This also preserves one global cap for percentage discounts.
        results.set(key, buildDiscountSnapshot(items, {
          source: "manual",
          type: "fixed",
          title: discountRequest.title,
          value: halalasToSar(memberDiscountHalalas),
        }));
        continue;
      }

      results.set(key, buildDiscountSnapshot(items, discountRequest));
    }
    return results;
  }, [bookingClients, discountItems, discountRequest, discountMode, selectedOfferByClientKey, offers]);

  const discountResult = useMemo(() => {
    const rows = [...discountResultsByClient.values()];
    const skippablePartyReasons = new Set([
      "discount_no_eligible_services",
      "discount_minimum_not_met",
    ]);
    const snapshots = rows.filter((row) => row.ok && row.snapshot).map((row) => row.snapshot as DiscountSnapshot);
    const blocking = rows.find((row) => !row.ok && !skippablePartyReasons.has(row.reason));
    const noAppliedDiscount = discountMode !== "none" && !snapshots.length;
    const firstSkipped = rows.find((row) => !row.ok);
    const subtotalHalalas = discountItems.reduce((sum, item) => sum + Math.max(0, Number(item.originalAmountHalalas || 0)), 0);
    const discountHalalas = rows.reduce((sum, row) => sum + (row.ok ? row.discountHalalas : 0), 0);
    const allocations = snapshots.flatMap((snapshot) => snapshot.allocations || []);
    const snapshot = snapshots.length
      ? {
          ...snapshots[0],
          amountHalalas: discountHalalas,
          eligibleSubtotalHalalas: snapshots.reduce((sum, row) => sum + Number(row.eligibleSubtotalHalalas || 0), 0),
          allocations,
          ...(bookingClients.length > 1 ? { partyBooking: true, partyClientCount: bookingClients.length } : {}),
        } as DiscountSnapshot
      : null;
    return {
      ok: !blocking && !noAppliedDiscount,
      reason: blocking?.reason || (noAppliedDiscount ? firstSkipped?.reason || "discount_no_eligible_services" : ""),
      subtotalHalalas,
      discountHalalas,
      totalHalalas: Math.max(0, subtotalHalalas - discountHalalas),
      snapshot,
    };
  }, [discountResultsByClient, discountItems, bookingClients.length, discountMode]);
  const discountSnapshot = discountResult.snapshot;
  const discountAmount = halalasToSar(discountResult.discountHalalas);
  const discountMessage = discountResult.ok ? "" : discountReasonText(discountResult.reason);
  const canContinue = Boolean(selectedClient);
  const allPartyClientsHaveServices = bookingClients.length > 0 && bookingClients.every((client) => {
    const clientKey = partyClientKey(client);
    return cart.some((service) => bookingLineClientKey(service) === clientKey);
  });
  const isPastBookingDate = Boolean(bookingDate && bookingDate < todayISO());
  const bookingConfig = mergeBookingConfig(appSettings?.booking);
  const dayHours = bookingConfig.businessHours?.[weekdayKey(bookingDate)] || { enabled: true, start: "12:00", end: "22:00" };
  const slotStepMin = Math.max(5, Number(bookingConfig.slotStepMin || 10));
  const bufferMin = Math.max(0, Number(bookingConfig.bufferMin || 0));

  function timeToMinutes(value: string) {
    const [hours, minutes] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1;
  }

  const getCartScheduleConflict = useCallback((
    serviceKey: string,
    staffKey: string,
    time: string,
    scheduleState: Record<string, ScheduleSelection> = scheduleByService
  ) => {
    const currentService = cart.find((item) => bookingLineKey(item) === serviceKey);
    const start = timeToMinutes(time);
    if (!currentService || start < 0 || !staffKey) return null;

    const currentClientKey = bookingLineClientKey(currentService);
    const clientEnd = start + Math.max(1, serviceDuration(currentService) || 30);
    const staffEnd = clientEnd + bufferMin;

    for (const other of cart) {
      const otherKey = bookingLineKey(other);
      if (otherKey === serviceKey) continue;
      const selected = scheduleState[otherKey];
      if (!selected?.time) continue;
      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) continue;
      const otherClientEnd = otherStart + Math.max(1, serviceDuration(other) || 30);

      if (
        bookingLineClientKey(other) === currentClientKey &&
        start < otherClientEnd &&
        otherStart < clientEnd
      ) {
        return {
          kind: "client" as const,
          service: other,
          start: selected.time,
          end: `${String(Math.floor(otherClientEnd / 60)).padStart(2, "0")}:${String(otherClientEnd % 60).padStart(2, "0")}`,
        };
      }

      if (selected.staffId === staffKey) {
        const otherStaffEnd = otherClientEnd + bufferMin;
        if (start < otherStaffEnd && otherStart < staffEnd) {
          return {
            kind: "staff" as const,
            service: other,
            start: selected.time,
            end: `${String(Math.floor(otherStaffEnd / 60)).padStart(2, "0")}:${String(otherStaffEnd % 60).padStart(2, "0")}`,
          };
        }
      }
    }
    return null;
  }, [cart, scheduleByService, bufferMin]);

  const hasCartScheduleConflict = useCallback((serviceKey: string, staffKey: string, time: string) => {
    return Boolean(getCartScheduleConflict(serviceKey, staffKey, time));
  }, [getCartScheduleConflict]);

  const getBusyIntervalsForService = useCallback((serviceKey: string, staffKey: string) => {
    if (!staffKey) return [];
    const currentService = cart.find((item) => bookingLineKey(item) === serviceKey);
    const currentClientKey = bookingLineClientKey(currentService);
    return cart.flatMap((other) => {
      const otherKey = bookingLineKey(other);
      if (otherKey === serviceKey) return [];
      const selected = scheduleByService[otherKey];
      if (!selected?.time) return [];
      const sameStaff = selected.staffId === staffKey;
      const sameClient = bookingLineClientKey(other) === currentClientKey;
      if (!sameStaff && !sameClient) return [];
      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) return [];
      const otherEnd = otherStart + Math.max(1, serviceDuration(other) || 30);
      return [{
        kind: sameStaff ? "staff" as const : "client" as const,
        serviceTitle: serviceTitle(other),
        clientName: bookingLineClientName(other),
        start: selected.time,
        end: `${String(Math.floor(otherEnd / 60)).padStart(2, "0")}:${String(otherEnd % 60).padStart(2, "0")}`,
      }];
    }).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }, [cart, scheduleByService]);

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    cart.forEach((service) => {
      const key = bookingLineKey(service);
      const selected = scheduleByService[key];
      if (selected?.time && hasCartScheduleConflict(key, selected.staffId, selected.time)) keys.add(key);
    });
    return keys;
  }, [cart, scheduleByService, hasCartScheduleConflict]);

  useEffect(() => {
    let cancelled = false;
    const serviceRows = cart.filter((service) => String(service?.id || "").trim());

    setEligibleStaffByService({});
    setAvailableTimes({});

    if (!serviceRows.length || !bookingDate || !dayHours.enabled) {
      setStaffLoading(false);
      return () => { cancelled = true; };
    }

    setStaffLoading(true);
    async function loadDatedBookableStaff() {
      try {
        const resolved = await Promise.all(serviceRows.map(async (service) => {
          const serviceKey = bookingLineKey(service);
          const canonicalServiceId = String(service.id || "").trim();
          const rows = await listCoreBookableStaffForDate({
            serviceId: canonicalServiceId,
            date: bookingDate,
            slotStepMin,
            bufferMin,
            requireShowOnBooking: false,
          });
          return [serviceKey, rows] as const;
        }));
        if (cancelled) return;

        const nextStaff: Record<string, StaffRow[]> = {};
        for (const [serviceKey, rows] of resolved) {
          nextStaff[serviceKey] = rows.map((row) => row.staff as StaffRow);
        }

        setEligibleStaffByService(nextStaff);
        setScheduleByService((current) => {
          let changed = false;
          const next = { ...current };
          for (const service of serviceRows) {
            const key = bookingLineKey(service);
            const selected = next[key];
            if (!selected?.staffId) continue;
            const stillBookable = (nextStaff[key] || []).some((staff) => staffId(staff) === selected.staffId);
            if (!stillBookable) {
              next[key] = { staffId: "", staffName: "", time: "" };
              changed = true;
            }
          }
          return changed ? next : current;
        });
      } catch (error) {
        console.error("[BookingInternalV2] dated Core staff load failed", error);
        if (!cancelled) {
          setEligibleStaffByService({});
          setScheduleMessage(t("تعذر جلب توفر الموظفات من Core HR. أعيدي المحاولة."));
        }
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    }

    void loadDatedBookableStaff();
    return () => { cancelled = true; };
  }, [cart, bookingDate, dayHours.enabled, slotStepMin, bufferMin]);

  const loadTimesForService = useCallback(async (service: CatalogService, staff: StaffRow) => {
    const serviceKey = bookingLineKey(service);
    const employeeId = staffId(staff);
    if (!employeeId || !dayHours.enabled) {
      setAvailableTimes((current) => ({ ...current, [serviceKey]: [] }));
      return;
    }
    setTimesLoading((current) => ({ ...current, [serviceKey]: true }));
    setScheduleMessage("");
    try {
      const duration = Math.max(1, serviceDuration(service) || 30);
      const availability = await resolveCoreBookingDataSource().getStaffAvailability({
        staffId: employeeId,
        date: bookingDate,
        slotStepMin,
        bufferMin,
        forceFresh: true,
      });
      const free = getCoreStaffBookableStartSlots(availability, {
        durationMin: duration,
        bufferMin,
        slotStepMin,
      }).map((slot) => slot.value24);
      setAvailableTimes((current) => ({ ...current, [serviceKey]: free }));
    } catch (error) {
      console.error("[BookingInternalV2] availability load failed", error);
      setAvailableTimes((current) => ({ ...current, [serviceKey]: [] }));
      setScheduleMessage(t("تعذر جلب الأوقات المتاحة. حاولي مرة أخرى."));
    } finally {
      setTimesLoading((current) => ({ ...current, [serviceKey]: false }));
    }
  }, [bookingDate, dayHours.enabled, slotStepMin, bufferMin]);

  useEffect(() => {
    setScheduleByService({});
    setAvailableTimes({});
  }, [bookingDate]);

  const allScheduled = cart.length > 0 && cart.every((service) => {
    const key = bookingLineKey(service);
    const row = scheduleByService[key];
    const staffStillBookable = Boolean(row?.staffId) &&
      (eligibleStaffByService[key] || []).some((staff) => staffId(staff) === row.staffId);
    return Boolean(row?.staffId && row?.time && staffStillBookable && !conflictKeys.has(key));
  });

  const sidebarCanAdvance =
    step === 1
      ? Boolean(canContinue && !addingCompanion && !clientPickerOpen && !showNewClient)
      : step === 2
        ? allPartyClientsHaveServices
        : step === 3
          ? allScheduled
          : false;

  const isStepComplete = (target: Step) => {
    if (target === 1) return Boolean(selectedClient);
    if (target === 2) return cart.length > 0;
    if (target === 3) return allScheduled;
    return createdBookingIds.length > 0;
  };

  const finalTotal = halalasToSar(discountResult.totalHalalas);
  const effectivePaidAmount = paymentType === "none"
    ? 0
    : paymentType === "full"
      ? finalTotal
      : Math.max(0, Number(paidAmount || 0));
  const remainingAmount = Math.max(0, finalTotal - effectivePaidAmount);
  const mixedTotal = Math.max(0, Number(cashAmount || 0)) + Math.max(0, Number(cardAmount || 0)) + Math.max(0, Number(transferAmount || 0));

  const verifyCoupon = useCallback(async () => {
    const code = normalizeDiscountCode(couponInput);
    setCouponMessage("");
    setCouponOffer(null);
    if (!code) {
      setCouponMessage(t("أدخلي كود الكوبون أولاً."));
      return;
    }
    setCouponChecking(true);
    try {
      const offer = (await CoreOfferService.list({ active: true, code }))
        .find((row) => normalizeDiscountCode(row.code || row.codeKey) === code && isCoreOfferActiveNow(row)) || null;
      if (!offer) {
        setCouponMessage(t("الكوبون غير صحيح أو منتهي أو غير نشط."));
        return;
      }

      const request = {
        source: "coupon" as DiscountSnapshotSource,
        sourceId: String((offer as any)?.id || ""),
        code,
        title: String(offer.name || ""),
        offer,
      };
      const previews = bookingClients.length
        ? bookingClients.map((client) => {
            const clientKey = partyClientKey(client);
            const items = discountItems
              .filter((item: any) => item.partyClientKey === clientKey)
              .map(({ partyClientKey: _partyClientKey, ...item }: any) => item);
            return items.length ? buildDiscountSnapshot(items, request) : null;
          }).filter(Boolean) as Array<ReturnType<typeof buildDiscountSnapshot>>
        : [buildDiscountSnapshot(
            discountItems.map(({ partyClientKey: _partyClientKey, ...item }: any) => item),
            request
          )];

      const skippable = new Set(["discount_no_eligible_services", "discount_minimum_not_met"]);
      const blocking = previews.find((preview) => !preview.ok && !skippable.has(preview.reason));
      const applicable = previews.filter((preview) => preview.ok && preview.snapshot);
      if (blocking || !applicable.length) {
        const reason = blocking?.reason || previews.find((preview) => !preview.ok)?.reason || "";
        setCouponMessage(discountReasonText(reason, language) || t("الكوبون لا ينطبق على الخدمات المختارة."));
        return;
      }

      const expectedDiscount = applicable.reduce((sum, preview) => sum + preview.discountHalalas, 0);
      setCouponOffer(offer);
      setDiscountMode("coupon");
      setCouponMessage(language === "en"
        ? `Coupon verified. Expected discount ${money(halalasToSar(expectedDiscount))}.`
        : `تم التحقق من الكوبون. الخصم المتوقع ${money(halalasToSar(expectedDiscount))}.`);
    } catch (error) {
      console.error("[BookingInternalV2] coupon verify failed", error);
      setCouponMessage(t("تعذر التحقق من الكوبون الآن."));
    } finally {
      setCouponChecking(false);
    }
  }, [couponInput, discountItems, bookingClients, language]);

  const submitBooking = useCallback(async () => {
    if (submittingRef.current) return;
    setSubmitError("");
    setPostSaveWarning("");
    setCreatedBookingIds([]);
    setCreatedPartyBookings([]);
    setCreatedBookingReference("");

    if (!selectedClient || !bookingClients.length) {
      setSubmitError(t("اختاري العميلة أولًا."));
      setStep(1);
      return;
    }

    const invalidClient = bookingClients.find((client) => phone10Digits(client.phone).length !== 10);
    if (invalidClient) {
      setSubmitError(
        language === "en"
          ? `${invalidClient.name} does not have a valid mobile number. Update or replace the client before creating the party booking.`
          : `العميلة ${invalidClient.name} بدون رقم جوال صحيح. حدّثي بياناتها أو استبدليها قبل إنشاء الحجز الجماعي.`
      );
      setStep(1);
      return;
    }

    if (!settingsReady) {
      setSubmitError(t("إعدادات الحجز لم تُحمّل من Core D1 بعد. أعيدي فتح الصفحة أو حاولي مرة أخرى."));
      return;
    }
    if (!cart.length) {
      setSubmitError(t("أضيفي خدمة واحدة على الأقل."));
      setStep(2);
      return;
    }

    const clientWithoutService = bookingClients.find((client) => {
      const key = partyClientKey(client);
      return !cart.some((service) => bookingLineClientKey(service) === key);
    });
    if (clientWithoutService) {
      setActivePartyClientKey(partyClientKey(clientWithoutService));
      setSubmitError(
        language === "en"
          ? `Add at least one service for ${clientWithoutService.name}, or remove her from the booking group.`
          : `أضيفي خدمة واحدة على الأقل لـ ${clientWithoutService.name} أو أزيليها من مجموعة الحجز.`
      );
      setStep(2);
      return;
    }

    const liveDraftConflict = cart.find((service) => {
      const key = bookingLineKey(service);
      const selected = scheduleByService[key];
      return Boolean(
        selected?.staffId &&
        selected?.time &&
        getCartScheduleConflict(key, selected.staffId, selected.time, scheduleByService)
      );
    });
    if (!allScheduled || liveDraftConflict) {
      setSubmitError(t("أكملي الموظفة والوقت لجميع الخدمات بدون تعارض."));
      setStep(3);
      return;
    }

    for (const service of cart) {
      const key = bookingLineKey(service);
      const effectiveBasePrice = Math.max(0, servicePrice(service));
      const draft = priceAdjustments[key];
      if (!draft) continue;
      const rawPrice = String(draft.price ?? "").trim();
      const parsedPrice = Number(rawPrice);
      if (!rawPrice || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
        setSubmitError(t("أدخلي سعر حجز صحيح للخدمة المعدلة."));
        return;
      }
      const changed = Math.abs(parsedPrice - effectiveBasePrice) > 0.005;
      if (changed && !canAdjustBookingPrice) {
        setSubmitError(t("ليس لديك صلاحية تعديل سعر الحجز."));
        return;
      }
      if (changed && !draft.reason) {
        setSubmitError(t("اختاري سبب تعديل السعر لكل خدمة تم تعديلها."));
        return;
      }
    }

    if (
      (discountMode === "fixed" || discountMode === "percent") &&
      !canApplyManualDiscount
    ) {
      setSubmitError(t("ليس لديك صلاحية تطبيق خصم يدوي."));
      return;
    }

    if (discountMode !== "none" && !discountResult.ok) {
      setSubmitError(discountMessage || t("الخصم المحدد غير صالح."));
      return;
    }
    if (discountMode === "coupon" && !couponOffer) {
      setSubmitError(t("تحققي من الكوبون قبل حفظ الحجز."));
      return;
    }
    if (paymentType === "partial" && (effectivePaidAmount <= 0 || effectivePaidAmount >= finalTotal)) {
      setSubmitError(t("قيمة العربون يجب أن تكون أكبر من صفر وأقل من إجمالي الحجز."));
      return;
    }
    if (paymentMethod === "mixed" && Math.abs(mixedTotal - effectivePaidAmount) > 0.01) {
      setSubmitError(language === "en"
        ? `Mixed payment total must equal ${money(effectivePaidAmount)}.`
        : `مجموع الدفع المختلط يجب أن يساوي ${money(effectivePaidAmount)}.`);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const staleSelections: Array<{ service: CatalogService; staff: StaffRow; serviceKey: string }> = [];
      for (const service of cart) {
        const serviceKey = bookingLineKey(service);
        const canonicalServiceId = String(service.id || "").trim();
        const selection = scheduleByService[serviceKey];
        const staff = (eligibleStaffByService[serviceKey] || []).find((row) => staffId(row) === selection?.staffId);
        if (!selection?.time || !staff) continue;

        const freshRows = await listCoreBookableStaffForDate({
          serviceId: canonicalServiceId,
          date: bookingDate,
          slotStepMin,
          bufferMin,
          requireShowOnBooking: false,
          forceFresh: true,
        });
        const fresh = freshRows.find((row) => staffId(row.staff as StaffRow) === selection.staffId);
        const freshAvailability = fresh?.availability;

        if (!freshAvailability || !isCoreStaffStartBookable(freshAvailability, selection.time, {
          durationMin: serviceDuration(service) || 30,
          bufferMin,
          slotStepMin,
        })) {
          staleSelections.push({ service, staff, serviceKey });
        }
      }

      if (staleSelections.length) {
        setScheduleByService((current) => {
          const next = { ...current };
          for (const row of staleSelections) {
            const existing = next[row.serviceKey];
            if (existing) next[row.serviceKey] = { ...existing, time: "" };
          }
          return next;
        });
        await Promise.all(staleSelections.map(({ service, staff }) => loadTimesForService(service, staff)));
        setScheduleMessage(t("تم تحديث المواعيد؛ الوقت المختار أصبح محجوزًا أو يتداخل مع حجز آخر. اختاري وقتًا جديدًا."));
        setSubmitError(t("الموعد المختار لم يعد متاحًا. تمت إعادتك إلى خطوة الموعد بعد تحديث الأوقات."));
        setStep(3);
        return;
      }

      const authUser = getAuth().currentUser;
      const userId = String(authUser?.uid || "internal_staff");
      const bookingDataSource = resolveCoreBookingDataSource();

      const canonicalByClientKey = new Map<string, string>();
      for (const client of bookingClients) {
        const clientKey = partyClientKey(client);
        const selectedClientId = String(client.id || "").trim();
        let canonicalClientId = "";

        if (selectedClientId && !selectedClientId.startsWith("history:")) {
          try {
            canonicalClientId = String((await bookingDataSource.getClient(selectedClientId))?.id || "").trim();
          } catch {
            canonicalClientId = "";
          }
        }

        if (!canonicalClientId) {
          const ensuredClient = await bookingDataSource.createClient({
            name: client.name,
            phone: client.phone,
            email: String((client as any).email || "").trim() || undefined,
          });
          canonicalClientId = String(ensuredClient?.id || "").trim();
        }

        if (!canonicalClientId) {
          throw new Error(
            language === "en"
              ? `Could not resolve the canonical client record for ${client.name}.`
              : `تعذر ربط الحجز بحساب العميلة ${client.name}.`
          );
        }
        canonicalByClientKey.set(clientKey, canonicalClientId);
      }

      const partyEnabled = bookingClients.length > 1;
      const partyId = partyEnabled
        ? `party_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        : "";
      const leadClientKey = partyClientKey(bookingClients[0]);
      const leadCanonicalClientId = canonicalByClientKey.get(leadClientKey) || "";
      const status = paymentType === "none" ? "pending" : "confirmed";

      const memberPlans = bookingClients.map((client, memberOrder) => {
        const clientKey = partyClientKey(client);
        const memberCart = cart.filter((service) => bookingLineClientKey(service) === clientKey);
        const memberDiscountResult = discountResultsByClient.get(clientKey);
        const memberSubtotal = memberCart.reduce((sum, service) => sum + bookingPriceForService(service), 0);
        const memberDiscount = memberDiscountResult?.ok ? halalasToSar(memberDiscountResult.discountHalalas) : 0;
        const memberTotal = memberDiscountResult?.ok
          ? halalasToSar(memberDiscountResult.totalHalalas)
          : memberSubtotal;
        return {
          client,
          clientKey,
          canonicalClientId: canonicalByClientKey.get(clientKey) || "",
          memberOrder,
          memberCart,
          memberSubtotal,
          memberDiscount,
          memberTotal,
          discountSnapshot: memberDiscountResult?.ok && memberDiscountResult.snapshot
            ? {
                ...memberDiscountResult.snapshot,
                appliedBy: userId,
                appliedAt: new Date().toISOString(),
                ...(partyEnabled ? { partyId, partyMemberOrder: memberOrder, partySize: bookingClients.length } : {}),
              }
            : null,
        };
      });

      const memberWeights = memberPlans.map((plan) => plan.memberTotal);
      const cashByMember = splitAmountByWeights(
        paymentType === "none" ? 0 : paymentMethod === "mixed" ? Number(cashAmount || 0) : paymentMethod === "cash" ? effectivePaidAmount : 0,
        memberWeights
      );
      const cardByMember = splitAmountByWeights(
        paymentType === "none" ? 0 : paymentMethod === "mixed" ? Number(cardAmount || 0) : paymentMethod === "card" ? effectivePaidAmount : 0,
        memberWeights
      );
      const transferByMember = splitAmountByWeights(
        paymentType === "none" ? 0 : paymentMethod === "mixed" ? Number(transferAmount || 0) : paymentMethod === "transfer" ? effectivePaidAmount : 0,
        memberWeights
      );
      // Derive each member's paid total from the exact method allocations that
      // will be posted to Core. This prevents independent rounding from making
      // a mixed-payment member total differ by one halala from its payments.
      const paidByMember = memberPlans.map((_, index) => roundMoney(
        (cashByMember[index] || 0) +
        (cardByMember[index] || 0) +
        (transferByMember[index] || 0)
      ));

      const createdParty: CreatedPartyBooking[] = [];
      const createdParentIds: string[] = [];
      let compensationFailed = false;

      try {
        for (const plan of memberPlans) {
          const memberPaid = paidByMember[plan.memberOrder] || 0;
          const memberRemaining = Math.max(0, plan.memberTotal - memberPaid);
          const allocationByItem = new Map(
            (plan.discountSnapshot?.allocations || []).map((row: any) => [
              String(row.bookingItemId || row.serviceId || "").trim(),
              row,
            ])
          );

          const itemFinalWeights = plan.memberCart.map((service) => {
            const lineKey = bookingLineKey(service);
            const allocation = allocationByItem.get(lineKey) as any;
            return allocation
              ? halalasToSar(allocation.finalAmountHalalas)
              : bookingPriceForService(service);
          });
          const itemPaidParts = splitAmountByWeights(memberPaid, itemFinalWeights);

          const itemRows = plan.memberCart.map((service, index) => {
            const lineKey = bookingLineKey(service);
            const canonicalServiceId = String(service.id || "").trim();
            const schedule = scheduleByService[lineKey];
            const catalogPrice = Math.max(0, serviceCatalogPrice(service));
            const effectiveBasePrice = Math.max(0, servicePrice(service));
            const itemOriginal = Math.max(0, bookingPriceForService(service));
            const priceDraft = priceAdjustments[lineKey];
            const priceAdjusted = Math.abs(itemOriginal - effectiveBasePrice) > 0.005;
            const allocation = allocationByItem.get(lineKey) as any;
            const itemDiscount = allocation ? halalasToSar(allocation.discountAmountHalalas) : 0;
            const itemTotal = allocation ? halalasToSar(allocation.finalAmountHalalas) : itemOriginal;
            const proportionalPaid = itemPaidParts[index] || 0;
            const selectedStaff = (eligibleStaffByService[lineKey] || []).find((row) => staffId(row) === schedule.staffId);

            return {
              clientId: plan.canonicalClientId,
              userId: null,
              createdBy: "staff",
              createdByUid: userId,
              channel: "internal",
              clientName: plan.client.name,
              clientPhone: plan.client.phone,
              clientEmail: String((plan.client as any).email || "").trim() || null,
              serviceName: serviceTitle(service),
              serviceId: canonicalServiceId,
              serviceSnapshot: {
                serviceNameAtBooking: serviceTitle(service),
                priceAtBooking: itemTotal,
                priceBeforeDiscountAtBooking: itemOriginal,
                durationAtBooking: serviceDuration(service) || 30,
                sectionIdAtBooking: String(service?.sectionId || selectedSectionId || "") || undefined,
                categoryIdAtBooking: String(service?.categoryId || service?.category || "") || undefined,
              },
              employeeId: schedule.staffId,
              employeeUid: String(selectedStaff?.uid || selectedStaff?.employeeUid || "") || null,
              employeeName: schedule.staffName,
              date: bookingDate,
              time: schedule.time,
              catalogPrice,
              bookingPrice: itemOriginal,
              priceAdjustmentReason: priceAdjusted ? priceDraft?.reason || undefined : undefined,
              priceAdjustmentNote: priceAdjusted ? priceDraft?.note?.trim() || undefined : undefined,
              originalAmount: itemOriginal,
              discountAmount: itemDiscount,
              discountSnapshot: plan.discountSnapshot || undefined,
              total: itemTotal,
              finalPrice: itemTotal,
              status,
              paymentMethod: paymentType === "none" ? undefined : paymentMethod,
              paymentType,
              paidAmount: proportionalPaid,
              remainingAmount: Math.max(0, itemTotal - proportionalPaid),
              ...(proportionalPaid > 0 ? { paidAt: Date.now() } : {}),
              note: bookingNote.trim() || undefined,
              slotStepMinAtBooking: slotStepMin,
              bufferMinAtBooking: bufferMin,
              durationMin: serviceDuration(service) || 30,
              cartItemId: lineKey,
              ...(partyEnabled ? {
                partyId,
                partyLeadClientId: leadCanonicalClientId,
                partyMemberOrder: plan.memberOrder,
                partySize: bookingClients.length,
              } : {}),
            } as any;
          });

          const firstItem = itemRows[0];
          const parent = {
            ...firstItem,
            serviceName: itemRows.length === 1 ? firstItem.serviceName : `${itemRows.length} خدمات`,
            serviceId: itemRows.length === 1 ? firstItem.serviceId : undefined,
            employeeId: undefined,
            employeeUid: null,
            employeeName: "عدة موظفات",
            originalAmount: plan.memberSubtotal,
            discountAmount: plan.memberDiscount,
            discountSnapshot: plan.discountSnapshot || undefined,
            total: plan.memberTotal,
            finalPrice: plan.memberTotal,
            paymentMethod: paymentType === "none" ? undefined : paymentMethod,
            paymentType,
            paidAmount: memberPaid,
            remainingAmount: memberRemaining,
            paymentBreakdown: {
              cash: cashByMember[plan.memberOrder] || 0,
              card: cardByMember[plan.memberOrder] || 0,
              transfer: transferByMember[plan.memberOrder] || 0,
            },
            ...(partyEnabled ? {
              partyId,
              partyLeadClientId: leadCanonicalClientId,
              partyMemberOrder: plan.memberOrder,
              partySize: bookingClients.length,
            } : {}),
          } as any;

          const created = await bookingDataSource.createBookingGroup({ parent, items: itemRows });
          const bookingId = String(created.parentId || "");
          if (!bookingId) throw new Error(t("تعذر إنشاء أحد حجوزات المجموعة."));
          createdParentIds.push(bookingId);

          const reference = formatBookingReference({
            id: bookingId,
            publicId: String(created.parentPublicId || ""),
            date: bookingDate,
          });

          createdParty.push({
            clientKey: plan.clientKey,
            clientId: plan.canonicalClientId,
            clientName: plan.client.name,
            clientPhone: plan.client.phone,
            parentId: bookingId,
            publicId: String(created.parentPublicId || bookingId),
            itemIds: (created.itemIds || []).map(String),
            reference,
          });
        }
      } catch (creationError) {
        const compensation = await Promise.allSettled(
          createdParentIds.map((bookingId) => bookingDataSource.updateBookingStatus(bookingId, "cancelled"))
        );
        compensationFailed = compensation.some((result) => result.status === "rejected");
        if (compensationFailed) {
          setPostSaveWarning(
            language === "en"
              ? "Party creation stopped after a partial failure, and one or more already-created bookings could not be automatically cancelled. Do not repeat the whole booking; review today's bookings first."
              : "توقفت عملية الحجز الجماعي بعد فشل جزئي، وتعذر إلغاء حجز أو أكثر تم إنشاؤه تلقائيًا. لا تعيدي إنشاء المجموعة كاملة؛ راجعي حجوزات اليوم أولًا."
          );
        }
        throw creationError;
      }

      setCreatedPartyBookings(createdParty);
      setCreatedBookingIds(createdParty.map((row) => row.parentId));
      const references = createdParty.map((row) => row.reference).filter(Boolean);
      setCreatedBookingReference(
        references.length <= 1
          ? references[0] || ""
          : `${references[0]} +${references.length - 1}`
      );
      bookingClients.forEach(markQuickClientUsage);

      if (effectivePaidAmount > 0 && createdParty.length) {
        const recordPaymentWithRetry = async (bookingId: string, method: string, amount: number) => {
          const amountHalalas = Math.round(amount * 100);
          if (amountHalalas <= 0) return;
          let lastError: unknown = null;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              await bookingDataSource.recordPayment({
                bookingId,
                method,
                amountHalalas,
                status: "paid",
                paidAt: new Date().toISOString(),
                idempotencyKey: `booking-v2-party:${partyId || bookingId}:${bookingId}:${method}:${amountHalalas}`,
              });
              return;
            } catch (error) {
              lastError = error;
              if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 350));
            }
          }
          throw lastError;
        };

        try {
          for (let index = 0; index < createdParty.length; index += 1) {
            const bookingId = createdParty[index].parentId;
            const plan = memberPlans[index];
            const memberPaid = paidByMember[index] || 0;
            const memberRemaining = Math.max(0, plan.memberTotal - memberPaid);
            const memberPayments = [
              ["cash", cashByMember[index] || 0],
              ["card", cardByMember[index] || 0],
              ["transfer", transferByMember[index] || 0],
            ] as const;

            for (const [method, amount] of memberPayments) {
              await recordPaymentWithRetry(bookingId, method, amount);
            }

            await bookingDataSource.updateBooking(bookingId, {
              paymentType,
              paidAmount: memberPaid,
              remainingAmount: memberRemaining,
              paymentMethod,
              status,
            } as any);
          }
        } catch (financialError) {
          console.error("[BookingInternalV2] party financial posting failed after booking creation", financialError);
          setPostSaveWarning(
            language === "en"
              ? "The party bookings were saved, but payment synchronization was not completed for every member after automatic retry. Do not recreate the bookings; review them in Bookings and retry collection only where needed."
              : "تم حفظ حجوزات المجموعة، لكن لم تكتمل مزامنة الدفعات لكل العميلات بعد المحاولة التلقائية. لا تعيدي إنشاء الحجوزات؛ راجعي صفحة الحجوزات وأعيدي التحصيل فقط للحجز الذي يحتاج ذلك."
          );
        }
      }
    } catch (error: any) {
      console.error("[BookingInternalV2] booking submit failed", error);
      const code = String(error?.code || "").toLowerCase();
      const message = String(error?.message || error || "");
      const isSlotConflict =
        Number(error?.status || 0) === 409 ||
        code.includes("slot") ||
        code.includes("staff_slot_conflict") ||
        message.toUpperCase().includes("SLOT_TAKEN") ||
        message.toLowerCase().includes("الموعد محجوز");

      if (isSlotConflict) {
        setScheduleByService((current) => Object.fromEntries(
          Object.entries(current).map(([key, value]) => [key, { ...value, time: "" }])
        ));
        setAvailableTimes({});
        setScheduleMessage(t("سبق حجز هذا الوقت قبل إتمام العملية. أعيدي اختيار المواعيد من القائمة المحدثة."));
        setSubmitError(t("الموعد محجوز بالفعل. تمت إعادتك إلى خطوة الموعد ولم يتم إنشاء حجز مكرر."));
        setStep(3);
      } else if (
        code === "core_api:offline" ||
        code === "core_api:network_unavailable" ||
        code === "core_api:timeout"
      ) {
        setSubmitError(t("غير متصل بالإنترنت. لم يتم إنشاء الحجز. أعيدي الاتصال ثم حاولي مرة أخرى."));
      } else if (code === "core_api:write_outcome_unknown") {
        setSubmitError(t("انقطع الاتصال أثناء حفظ الحجز. نتيجة العملية غير مؤكدة؛ لا تعيدي الحفظ. أعيدي الاتصال وافتحي صفحة الحجوزات للتحقق أولًا."));
      } else {
        setSubmitError(language === "en"
          ? `Could not save booking: ${message || "Unknown error"}`
          : `تعذر حفظ الحجز: ${message || "خطأ غير معروف"}`);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    selectedClient,
    bookingClients,
    settingsReady,
    cart,
    allScheduled,
    discountMode,
    discountResult.ok,
    discountMessage,
    couponOffer,
    discountResultsByClient,
    priceAdjustments,
    bookingPriceForService,
    canAdjustBookingPrice,
    canApplyManualDiscount,
    paymentType,
    paymentMethod,
    effectivePaidAmount,
    finalTotal,
    mixedTotal,
    cashAmount,
    cardAmount,
    transferAmount,
    scheduleByService,
    eligibleStaffByService,
    bookingDate,
    bookingNote,
    slotStepMin,
    bufferMin,
    selectedSectionId,
    loadTimesForService,
    language,
  ]);

  const requestSubmitBooking = useCallback(() => {
    if (submittingRef.current) return;
    if (isPastBookingDate) {
      setShowPastDateConfirmation(true);
      return;
    }
    void submitBooking();
  }, [isPastBookingDate, submitBooking]);

  const confirmPastDateBooking = useCallback(() => {
    setShowPastDateConfirmation(false);
    void submitBooking();
  }, [submitBooking]);

  const printCreatedBookingInvoice = useCallback(() => {
    const rows = buildInternalV2InvoiceRows({
      createdPartyBookings,
      cart,
      scheduleByService,
      bookingDate,
      paymentType,
      paymentMethod,
      effectivePaidAmount,
      remainingAmount,
      cashAmount,
      cardAmount,
      transferAmount,
      selectedSectionId,
      bookingPriceByService: Object.fromEntries(
        cart.map((service) => [
          bookingLineKey(service),
          bookingPriceForService(service),
        ])
      ),
      discountSnapshot,
    });
    if (!rows.length) {
      setSubmitError(t("لا توجد بيانات فاتورة جاهزة للطباعة."));
      return;
    }

    createInternalV2InvoicePrintRequestId("internal_booking_v2");
    localStorage.setItem("allBookings", JSON.stringify(rows));
    localStorage.setItem("currentBooking", JSON.stringify(rows[0] || null));

    const popup = window.open(
      `${window.location.origin}/success-internal`,
      "internal_print_popup",
      "width=980,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
    );
    if (!popup || popup === window) {
      setSubmitError(t("تم منع فتح نافذة الفاتورة. فعّلي النوافذ المنبثقة للموقع ثم حاولي مرة أخرى."));
      return;
    }
    popup.focus();
  }, [createdPartyBookings, cart, scheduleByService, bookingDate, paymentType, paymentMethod, effectivePaidAmount, remainingAmount, cashAmount, cardAmount, transferAmount, selectedSectionId, discountSnapshot, bookingPriceForService]);

  const resetCompletedBooking = useCallback(() => {
    setCart([]); setPriceAdjustments({}); setScheduleByService({}); setAvailableTimes({}); setSelectedClient(null);
    setCompanions([]); setAddingCompanion(false); setClientPickerOpen(true); setActivePartyClientKey("");
    setBookingDate(todayISO()); setShowPastDateConfirmation(false);
    setStep(1); setPaymentMethod("cash"); setPaymentType("full"); setPaidAmount("");
    setCashAmount(""); setCardAmount(""); setTransferAmount(""); setBookingNote("");
    setCreatedBookingIds([]); setCreatedPartyBookings([]); setCreatedBookingReference(""); setSubmitError(""); setPostSaveWarning("");
    setDiscountMode("none"); setManualFixedDiscount(""); setManualPercentDiscount(""); setManualMaxDiscount("");
    setSelectedOfferByClientKey({}); setCouponInput(""); setCouponOffer(null); setCouponMessage("");
  }, []);

  return (
    <div className="bk2-page" data-booking-step={step} data-booking-mode={mode} dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <header className="bk2-heading">
        <div>
          <p className="bk2-eyebrow">MALIKAT</p>
          <h1>{t("الحجز الإداري")}</h1>
          <p>{t("إنشاء حجز جديد بخطوات واضحة وسريعة.")}</p>
        </div>
        <button
          ref={hairGuideTriggerRef}
          type="button"
          className="bk2-hair-guide-trigger"
          onClick={() => setHairGuideOpen(true)}
        >
          {language === "en" ? "Hair Length Guide" : "دليل أطوال الشعر"}
        </button>
        <div className="bk2-mode-switch" aria-label={t("وضع الحجز")}>
          <button className={mode === "new" ? "is-active" : ""} onClick={() => setMode("new")}>{t("حجز جديد")}</button>
          <button className={mode === "sessions" ? "is-active" : ""} onClick={() => setMode("sessions")}>{t("الباقات والجلسات")}</button>
        </div>
      </header>

      {mode === "sessions" ? <PackageSessionsManager language={language} /> : (
        <>
          <nav className="bk2-stepper" aria-label={t("خطوات الحجز")}>
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = step === item.id;
              const completed = isStepComplete(item.id);
              return (
                <button key={item.id} className={`${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`} aria-current={active ? "step" : undefined} onClick={() => setStep(item.id)}>
                  <span className="bk2-step-number">{completed ? "✓" : item.id}</span>
                  <span className="bk2-step-icon"><Icon /></span>
                  <span><strong>{t(item.title)}</strong><small>{t(item.subtitle)}</small></span>
                  {index < steps.length - 1 ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>

          <div className="bk2-workspace">
            <main className="bk2-main-card">
              {step === 1 ? (
                <section className="bk2-client-step">
                  <div className="bk2-section-title"><div><h2>{t(addingCompanion ? "إضافة مرافقة للحجز" : selectedClient && !clientPickerOpen ? "العميلات في هذا الحجز" : "اختيار العميلة الأساسية")}</h2><p>{t(addingCompanion ? "الآن اختاري المرافقة من العملاء الموجودين أو أضيفي عميلة جديدة." : selectedClient && !clientPickerOpen ? "تم اختيار العميلة. يمكنك المتابعة أو إضافة مرافقة قبل اختيار الخدمات." : "ابدئي بالبحث عن العميلة الأساسية بالاسم أو الجوال أو رقم العضوية.")}</p></div><span><FiUser /></span></div>
                  {(!selectedClient || clientPickerOpen || addingCompanion) ? (
                    <div className={`bk2-client-action-banner ${addingCompanion ? "is-companion" : "is-primary"}`}>
                      <span className="bk2-client-action-icon">{addingCompanion ? <FiUsers /> : <FiUser />}</span>
                      <div>
                        <small>{t(addingCompanion ? "وضع إضافة مرافقة" : "الخطوة الحالية")}</small>
                        <strong>{t(addingCompanion ? "اختاري المرافقة الآن" : "اختاري العميلة الأساسية")}</strong>
                        <p>{t(addingCompanion ? "أي عميلة تختارينها الآن ستُضاف كمرافقة ولن تستبدل العميلة الأساسية." : "اختيار العميلة هنا يحدد صاحبة الحجز الأساسية. بعد الاختيار ستختفي قائمة البحث ويمكنك المتابعة مباشرة.")}</p>
                      </div>
                    </div>
                  ) : null}
                  {selectedClient ? (
                    <div className="bk2-party-clients">
                      <div className="bk2-party-clients-head">
                        <div><strong>{t("مجموعة الحجز")}</strong><small>{bookingClients.length} {t("عميلات في نفس العملية")}</small></div>
                        <div className="bk2-party-client-actions">
                          {!addingCompanion ? <button
                            type="button"
                            className="is-secondary"
                            onClick={() => {
                              setClientPickerOpen(true);
                              setAddingCompanion(false);
                              setQuery("");
                              setClientMessage(t("اختاري عميلة أخرى لاستبدال العميلة الأساسية."));
                            }}
                          >{t("تغيير العميلة الأساسية")}</button> : null}
                          <button
                            type="button"
                            className={addingCompanion ? "is-cancel" : "is-primary"}
                            disabled={!addingCompanion && bookingClients.length >= 20}
                            onClick={() => {
                              if (addingCompanion) {
                                setAddingCompanion(false);
                                setClientPickerOpen(false);
                                setQuery("");
                                setClientMessage("");
                                setShowNewClient(false);
                                return;
                              }
                              setAddingCompanion(true);
                              setClientPickerOpen(true);
                              setShowNewClient(false);
                              setQuery("");
                              setClientMessage(t("اختاري المرافقة من القائمة أو أضيفي عميلة جديدة."));
                            }}
                          >{addingCompanion ? "×" : <FiPlus />} {t(addingCompanion ? "إلغاء إضافة المرافقة" : bookingClients.length >= 20 ? "الحد الأقصى للمجموعة" : "إضافة مرافقة")}</button>
                        </div>
                      </div>
                      <div className="bk2-party-client-chips">
                        {bookingClients.map((client, index) => {
                          const key = partyClientKey(client);
                          return (
                            <div key={key} className={`bk2-party-client-chip ${activePartyClientKey === key ? "is-active" : ""}`}>
                              <button type="button" onClick={() => setActivePartyClientKey(key)}>
                                <span className="bk2-avatar">{client.name.slice(0, 1)}</span>
                                <span><strong>{client.name}</strong><small>{index === 0 ? t("العميلة الأساسية") : t("مرافقة")}</small></span>
                              </button>
                              {index > 0 ? <button
                                type="button"
                                className="bk2-party-client-remove"
                                aria-label={t("إزالة المرافقة")}
                                onClick={() => {
                                  const lineKeys = cart.filter((item) => bookingLineClientKey(item) === key).map(bookingLineKey);
                                  const removeKeys = new Set(lineKeys);
                                  setCompanions((current) => current.filter((row) => partyClientKey(row) !== key));
                                  setCart((current) => current.filter((item) => bookingLineClientKey(item) !== key));
                                  setPriceAdjustments((current) => Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removeKeys.has(lineKey))));
                                  setScheduleByService((current) => Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removeKeys.has(lineKey))));
                                  setAvailableTimes((current) => Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removeKeys.has(lineKey))));
                                  setEligibleStaffByService((current) => Object.fromEntries(Object.entries(current).filter(([lineKey]) => !removeKeys.has(lineKey))));
                                  setSelectedOfferByClientKey((current) => {
                                    const next = { ...current };
                                    delete next[key];
                                    if (!Object.values(next).some((value) => Boolean(String(value || "").trim()))) {
                                      setDiscountMode("none");
                                    }
                                    return next;
                                  });
                                  if (activePartyClientKey === key) setActivePartyClientKey(partyClientKey(selectedClient));
                                }}
                              >×</button> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {selectedClient && !clientPickerOpen && clientMessage ? <p className="bk2-client-selection-success">✓ {clientMessage}</p> : null}
                  {(!selectedClient || clientPickerOpen || addingCompanion) ? (
                    <div className={`bk2-client-picker-shell ${addingCompanion ? "is-companion" : ""}`}>
                      <label className="bk2-search-box"><FiSearch /><input ref={clientSearchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(addingCompanion ? "ابحثي عن المرافقة بالاسم أو رقم الجوال أو العضوية" : "ابحثي بالاسم أو رقم الجوال أو رقم العضوية (MK)")} /></label>
                      {(clientSearching || clientMessage) ? <p className={`bk2-status-line ${clientSearching ? "is-loading" : ""}`}>{clientSearching ? t("جاري البحث في بيانات السيرفر...") : clientMessage}</p> : null}
                      <div className="bk2-recent-header"><h3>{addingCompanion ? t("اختاري المرافقة") : query ? t("نتائج البحث") : t("العميلات الأخيرات")}</h3><span>{visibleClients.length} {t("عميلات")}</span></div>
                      <div className="bk2-client-grid">
                        {visibleClients.map((client) => {
                          const alreadyInParty = bookingClients.some((row) => samePartyClient(row, client));
                          return (
                            <button
                              key={client.id}
                              className={alreadyInParty ? "is-selected" : ""}
                              onClick={() => chooseClientForBooking(client, t("تم اختيار العميلة للحجز بنجاح."))}
                            >
                              <span className="bk2-avatar">{client.name.slice(0, 1)}</span>
                              <span className="bk2-client-copy"><strong>{client.name}</strong><small>{client.phone || t("بدون جوال")}</small><span className="bk2-client-badges"><em>{client.visits ? `${client.visits} ${t("استخدامات")}` : client.publicId ? client.publicId : client.source || t("عميلة")}</em>{client.sessions ? <em className="is-green">{client.sessions} {t("جلسات متبقية")}</em> : null}</span></span>
                              <span className="bk2-client-card-action">{alreadyInParty ? t("مضافة بالفعل") : t(addingCompanion ? "إضافة كمرافقة" : "اختيار")}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="bk2-divider"><span>{t("أو")}</span></div>
                      <button className="bk2-add-client" type="button" onClick={() => { setShowNewClient(true); setNewClientError(""); setExistingClientMatch(null); setExistingClientLookupError(""); }}><FiPlus />{t(addingCompanion ? "إضافة مرافقة جديدة" : "إضافة عميلة جديدة")}</button>
                  {showNewClient ? (
                    <div className="bk2-new-client-panel">
                      <div className="bk2-new-client-head"><div><strong>{t(addingCompanion ? "إضافة مرافقة جديدة" : "إضافة عميلة جديدة")}</strong><small>{t(addingCompanion ? "اسم المرافقة مطلوب. رقم الجوال والبريد الإلكتروني اختياريان." : "سنفحص رقم الجوال أولًا حتى لا يتم إنشاء سجل مكرر.")}</small></div><button type="button" onClick={() => setShowNewClient(false)}>×</button></div>
                      <div className="bk2-new-client-grid">
                        <label><span>{t(addingCompanion ? "اسم المرافقة" : "اسم العميلة")} *</span><input autoFocus value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder={t("مثال: رانيا الحربي")} disabled={Boolean(existingClientMatch)} /></label>
                        <label><span>{t(addingCompanion ? "رقم الجوال (اختياري)" : "رقم الجوال")} {!addingCompanion ? "*" : ""}</span><input inputMode="numeric" value={newClientPhone} onChange={(e) => { setNewClientPhone(normalizeDigits(e.target.value).slice(0, 10)); setNewClientError(""); }} placeholder={addingCompanion ? t("اختياري للمرافقة") : "05xxxxxxxx"} /></label>
                        <label className="is-wide"><span>{t("البريد الإلكتروني (اختياري)")}</span><input type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} placeholder="name@example.com" disabled={Boolean(existingClientMatch)} /></label>
                      </div>

                      {existingClientChecking ? (
                        <div className="bk2-client-identity-check is-loading" role="status">
                          <span className="bk2-client-identity-dot" />
                          <div><strong>{t("جاري التحقق من رقم الجوال...")}</strong><small>{t("نتأكد أن العميلة غير مسجلة مسبقًا.")}</small></div>
                        </div>
                      ) : existingClientMatch ? (
                        <div className="bk2-existing-client-match" role="status">
                          <div className="bk2-existing-client-icon" aria-hidden="true">
                            <FiUser />
                          </div>
                          <div className="bk2-existing-client-content">
                            <div className="bk2-existing-client-heading">
                              <div>
                                <span className="bk2-existing-client-kicker">{t("تم العثور على عميلة مسجلة")}</span>
                                <strong><bdi dir="auto">{existingClientMatch.name}</bdi></strong>
                              </div>
                              <span className="bk2-existing-client-status">{t("سجل موجود")}</span>
                            </div>
                            <div className="bk2-existing-client-meta">
                              <span><small>{t("رقم الجوال")}</small><bdi dir="ltr">{existingClientMatch.phone}</bdi></span>
                              {existingClientMatch.publicId ? <span><small>{t("رقم العضوية")}</small><bdi dir="ltr">{existingClientMatch.publicId}</bdi></span> : null}
                            </div>
                            <p>{t("لن يتم إنشاء سجل جديد. اختاري العميلة الموجودة للمتابعة بالحجز.")}</p>
                            {newClientName.trim() && normalizeSearchText(newClientName) !== normalizeSearchText(existingClientMatch.name) ? (
                              <div className="bk2-existing-client-name-warning">
                                {t("الاسم الذي كتبتيه مختلف عن الاسم المسجل؛ لن نستبدل بيانات العميلة تلقائيًا.")}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : existingClientLookupError ? (
                        <div className="bk2-client-identity-check is-error" role="alert">
                          <div><strong>{t("تعذر التحقق من رقم الجوال")}</strong><small>{existingClientLookupError}</small></div>
                        </div>
                      ) : phone10Digits(newClientPhone).length === 10 ? (
                        <div className="bk2-client-identity-check is-clear" role="status">
                          <span className="bk2-client-identity-dot" />
                          <div><strong>{t("رقم الجوال غير مسجل حاليًا")}</strong><small>{t("يمكن إنشاء عميلة جديدة بهذا الرقم.")}</small></div>
                        </div>
                      ) : null}

                      {newClientError ? <p className="bk2-inline-warning">{newClientError}</p> : null}
                      <div className="bk2-new-client-actions">
                        <button type="button" className="is-secondary" onClick={() => setShowNewClient(false)} disabled={creatingClient}>{t("إلغاء")}</button>
                        <button
                          type="button"
                          className="is-primary"
                          onClick={() => existingClientMatch
                            ? chooseClientForBooking(existingClientMatch, t("تم اختيار العميلة الموجودة. لم يتم إنشاء سجل جديد."))
                            : void createNewClient()
                          }
                          disabled={creatingClient || existingClientChecking}
                        >
                          {creatingClient
                            ? t("جاري الحفظ...")
                            : existingClientChecking
                              ? t("جاري التحقق...")
                              : existingClientMatch
                                ? t("اختيار العميلة الموجودة")
                                : existingClientLookupError
                                  ? t("إعادة التحقق والحفظ")
                                  : t("حفظ واختيار العميلة")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                    </div>
                  ) : null}
                  {!selectedClient ? <div className="bk2-tip"><span>i</span><div><strong>{t("نصيحة")}</strong><p>{t("استخدمي الاسم أو رقم الجوال أو رقم العضوية للوصول إلى العميلة بسرعة.")}</p></div></div> : null}
                </section>
              ) : step === 2 ? (
                <section className="bk2-services-step">
                  <div className="bk2-section-title"><div><h2>{t("اختيار الخدمات")}</h2><p>{t("القائمة مرتبطة الآن بكتالوج الخدمات الحقيقي.")}</p></div><span><FiShoppingBag /></span></div>
                  <div className="bk2-party-service-owner">
                    <div><strong>{t("إضافة الخدمات لمن؟")}</strong><small>{t("اختاري العميلة ثم أضيفي خدماتها. يمكنك التنقل بين أفراد المجموعة بدون إعادة الحجز.")}</small></div>
                    <div>
                      {bookingClients.map((client, index) => {
                        const key = partyClientKey(client);
                        const count = cart.filter((service) => bookingLineClientKey(service) === key).length;
                        return <button type="button" key={key} className={activePartyClientKey === key ? "is-active" : ""} onClick={() => setActivePartyClientKey(key)}><span>{client.name}</span><small>{index === 0 ? t("الأساسية") : t("مرافقة")} · {count} {t("خدمات")}</small></button>;
                      })}
                    </div>
                  </div>
                  <div className="bk2-catalog-offers">
                    <div className="bk2-catalog-offers-head">
                      <div>
                        <strong>{t("العروض المحفوظة")}</strong>
                        <small>{t("اختاري عرضًا محفوظًا لإضافته للحجز وتطبيقه مباشرة.")}</small>
                      </div>
                      {!offersLoading ? <span>{offers.length}</span> : null}
                    </div>
                    {offersLoading ? <p className="bk2-status-line is-loading">{t("جاري تحميل العروض...")}</p> : offers.length ? (
                      <div className="bk2-catalog-offers-grid">
                        {offers.map((offer) => {
                          const offerId = String(offer.id || "");
                          const linkedCount = offerLinkedServiceIds(offer).length;
                          const selected = selectedOfferId === offerId;
                          return (
                            <button
                              type="button"
                              key={offerId}
                              className={selected ? "is-selected" : ""}
                              onClick={() => selectCatalogOffer(offer)}
                            >
                              <span className="bk2-catalog-offer-copy">
                                <strong>{offer.name}</strong>
                                <small>
                                  {offer.description || (linkedCount
                                    ? `${linkedCount} ${t("خدمات مرتبطة")}`
                                    : t("اختاري خدمات العرض من القائمة."))}
                                </small>
                              </span>
                              <span className="bk2-catalog-offer-value">
                                <small>{t("خصم")}</small>
                                <strong>{offerValueLabel(offer, language)}</strong>
                              </span>
                              <span className="bk2-catalog-offer-add">{selected ? "✓" : "+"}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : <p className="bk2-status-line">{offersMessage || t("لا توجد عروض نشطة حالياً.")}</p>}
                    {selectedOffer ? <p className="bk2-catalog-offer-selected">✓ {t("تم اختيار العرض وتطبيقه على الخدمات المؤهلة.")} <strong>{selectedOffer.name}</strong></p> : null}
                  </div>
                  <label className="bk2-search-box"><FiSearch /><input value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} placeholder={t("ابحثي عن خدمة...")} /></label>
                  <div className="bk2-section-tabs">{sections.map((section) => <button key={section.id} className={selectedSectionId === String(section.id) ? "is-active" : ""} onClick={() => { setSelectedCategoryId(""); setSelectedSectionId(String(section.id)); }}>{translateBookingCatalogLabel(language, catalogLabel(section, "قسم"), "section")}</button>)}</div>
                  {categories.length ? <div className="bk2-category-tabs"><button className={!selectedCategoryId ? "is-active" : ""} onClick={() => setSelectedCategoryId("")}>{t("الكل")}</button>{categories.map((category) => <button key={category.id} className={selectedCategoryId === String(category.id) ? "is-active" : ""} onClick={() => setSelectedCategoryId(String(category.id))}>{translateBookingCatalogLabel(language, catalogLabel(category, "تصنيف"), "category")}</button>)}</div> : null}
                  {(catalogLoading || catalogMessage) ? <p className={`bk2-status-line ${catalogLoading ? "is-loading" : ""}`}>{catalogLoading ? t("جاري تحميل الخدمات...") : catalogMessage}</p> : null}
                  <div className="bk2-service-list">
                    {visibleServices.map((service) => {
                      const owner = activeBookingClient || selectedClient;
                      const inCart = owner ? clientHasService(cart, owner, service) : false;
                      const lineKey = owner ? bookingLineKey(attachServiceToClient(service, owner)) : "";
                      const promoActive = serviceHasActivePromo(service);
                      const catalogPrice = serviceCatalogPrice(service);
                      const effectivePrice = servicePrice(service);
                      return <button
                        key={service.id}
                        className={inCart ? "is-selected" : ""}
                        disabled={!owner}
                        onClick={() => {
                          if (!owner) return;
                          if (inCart) {
                            setCart((current) => removeServiceForClient(current, service, owner));
                            setPriceAdjustments((current) => {
                              const next = { ...current };
                              delete next[lineKey];
                              return next;
                            });
                            setScheduleByService((current) => {
                              const next = { ...current };
                              delete next[lineKey];
                              return next;
                            });
                            setAvailableTimes((current) => {
                              const next = { ...current };
                              delete next[lineKey];
                              return next;
                            });
                            setEligibleStaffByService((current) => {
                              const next = { ...current };
                              delete next[lineKey];
                              return next;
                            });
                          } else {
                            setCart((current) => addServiceForClient(current, service, owner));
                          }
                        }}
                      >
                        <span className="bk2-service-copy">
                          <strong>{translateBookingCatalogLabel(language, serviceTitle(service), "service")}</strong>
                          <small>{serviceDuration(service) ? `${serviceDuration(service)} ${t("دقيقة")}` : t("المدة حسب الخدمة")}</small>
                        </span>
                        <span className={`bk2-service-price ${promoActive ? "is-promo" : ""}`}>
                          <small>{promoActive ? t("سعر العرض") : t("سعر الكتالوج")}</small>
                          <strong>{money(effectivePrice)}</strong>
                          {promoActive ? <del>{money(catalogPrice)}</del> : null}
                        </span>
                        <span className="bk2-service-add">{inCart ? "✓" : "+"}</span>
                      </button>;
                    })}
                  </div>
                  {!catalogLoading && !visibleServices.length ? <div className="bk2-no-results">{t("لا توجد خدمات مطابقة في هذا القسم.")}</div> : null}
                </section>
              ) : step === 3 ? (
                <section className="bk2-schedule-step">
                  <div className="bk2-section-title"><div><h2>{t("الموظفة والموعد")}</h2><p>{t("الموظفات والأوقات مرتبطة الآن ببيانات الدوام والحجوزات الفعلية.")}</p></div><span><FiClock /></span></div>
                  <div className="bk2-date-field">
                    <span>{t("تاريخ الحجز")}</span>
                    <DashboardDatePickerV2
                      value={bookingDate}
                      onChange={setBookingDate}
                      clearable={false}
                      className="bk2-date-picker-v2"
                      aria-describedby={isPastBookingDate ? "bk2-past-date-warning" : undefined}
                    />
                    {isPastBookingDate ? <p id="bk2-past-date-warning" className="bk2-past-date-warning" role="status">{t("أنت تقوم بإنشاء حجز بتاريخ سابق")}</p> : null}
                  </div>
                  {!dayHours.enabled ? <p className="bk2-status-line">{t("الصالون مغلق في هذا اليوم حسب إعدادات الدوام.")}</p> : null}
                  {staffLoading ? <p className="bk2-status-line is-loading">{t("جاري تحميل الموظفات...")}</p> : null}
                  {scheduleMessage ? <p className="bk2-status-line">{scheduleMessage}</p> : null}
                  <div className="bk2-party-schedule-groups">
                    {scheduleGroups.map((group) => {
                      const completedCount = group.services.filter((service) => {
                        const lineKey = bookingLineKey(service);
                        return Boolean(scheduleByService[lineKey]?.time);
                      }).length;
                      const groupComplete = completedCount === group.services.length;

                      return (
                        <section
                          key={group.clientKey}
                          className={`bk2-party-schedule-group ${groupComplete ? "is-complete" : ""}`}
                        >
                          <header className="bk2-party-schedule-group-head">
                            <div className="bk2-party-schedule-client">
                              <span className="bk2-party-schedule-avatar">
                                {group.client.name.slice(0, 1)}
                              </span>
                              <div>
                                <small>{t(group.clientIndex === 0 ? "العميلة الأساسية" : "مرافقة")}</small>
                                <strong>{group.client.name}</strong>
                                {group.client.phone ? <bdi dir="ltr">{group.client.phone}</bdi> : null}
                              </div>
                            </div>
                            <div className="bk2-party-schedule-progress">
                              <strong>{completedCount}/{group.services.length}</strong>
                              <span>{t(group.services.length === 1 ? "خدمة" : "خدمات")}</span>
                              {groupComplete ? <em>✓ {t("مكتمل")}</em> : null}
                            </div>
                          </header>

                          <div className="bk2-party-schedule-services">
                            {group.services.map((service, serviceIndex) => {
                              const key = bookingLineKey(service);
                              const selection = scheduleByService[key];
                              const staffRows = eligibleStaffByService[key] || [];
                              const times = availableTimes[key] || [];

                              return (
                                <article key={key} className={`bk2-schedule-item ${selection?.time ? "is-complete" : ""}`}>
                                  <header>
                                    <span>{serviceIndex + 1}</span>
                                    <div>
                                      <strong>{translateBookingCatalogLabel(language, serviceTitle(service), "service")}</strong>
                                      <small>{serviceDuration(service) || 30} {t("دقيقة")}</small>
                                    </div>
                                    {selection?.time ? <em>✓ {t("مكتمل")}</em> : null}
                                  </header>
                                  <div className="bk2-schedule-controls">
                                    <div className="bk2-staff-field">
                                      <span>{t("الموظفة")}</span>
                                      <DashboardSelectV2
                                        value={selection?.staffId || ""}
                                        placeholder={t("اختاري الموظفة")}
                                        className="bk2-staff-select-v2"
                                        options={staffRows.map((row) => ({ value: staffId(row), label: staffName(row) }))}
                                        onChange={(value) => {
                                          const chosen = staffRows.find((row) => staffId(row) === value);
                                          setScheduleByService((current) => ({ ...current, [key]: { staffId: value, staffName: chosen ? staffName(chosen) : "", time: "" } }));
                                          setAvailableTimes((current) => ({ ...current, [key]: [] }));
                                          if (chosen) void loadTimesForService(service, chosen);
                                        }}
                                      />
                                    </div>
                                    <div className="bk2-time-picker">
                                      <span>{t("الأوقات المتاحة")}</span>
                                      {selection?.staffId && getBusyIntervalsForService(key, selection.staffId).length ? <div className="bk2-busy-intervals">{getBusyIntervalsForService(key, selection.staffId).map((busy) => <p key={`${busy.kind}-${busy.serviceTitle}-${busy.start}`}>{busy.kind === "staff" ? t("الموظفة مشغولة من") : t("العميلة لديها خدمة من")} <strong>{formatTime12(busy.start, busy.start)}</strong> {t("إلى")} <strong>{formatTime12(busy.end, busy.end)}</strong><span>{t("بسبب")}: {busy.clientName ? `${busy.clientName} · ` : ""}{busy.serviceTitle}</span></p>)}</div> : null}
                                      {!selection?.staffId ? <p>{t("اختاري الموظفة أولًا.")}</p> : timesLoading[key] ? <p>{t("جاري فحص المواعيد...")}</p> : times.length ? (
                                        <div>{times.map((time) => {
                                          const conflict = getCartScheduleConflict(key, selection.staffId, time);
                                          const conflicting = Boolean(conflict);
                                          const conflictTitle = conflict
                                            ? (language === "en"
                                              ? `Unavailable: conflicts with ${serviceTitle(conflict.service)} from ${formatTime12(conflict.start, conflict.start)} to ${formatTime12(conflict.end, conflict.end)}`
                                              : `غير متاح: يتعارض مع ${serviceTitle(conflict.service)} من ${formatTime12(conflict.start, conflict.start)} إلى ${formatTime12(conflict.end, conflict.end)}`)
                                            : "";
                                          return <button type="button" key={time} disabled={conflicting} title={conflictTitle} aria-label={conflictTitle || `${t("اختيار")} ${formatTime12(time, time)}`} className={`${selection?.time === time ? "is-active" : ""} ${conflicting ? "is-conflicting" : ""}`} onClick={() => {
                                            if (conflicting) return;
                                            setScheduleByService((current) => {
                                              const liveStaffId = current[key]?.staffId || selection.staffId;
                                              const liveConflict = getCartScheduleConflict(key, liveStaffId, time, current);
                                              if (liveConflict) {
                                                setScheduleMessage(
                                                  liveConflict.kind === "staff"
                                                    ? t("هذا الوقت أصبح مستخدمًا لنفس الموظفة في خدمة أخرى. اختاري وقتًا مختلفًا.")
                                                    : t("العميلة لديها خدمة أخرى في هذا الوقت. اختاري وقتًا مختلفًا.")
                                                );
                                                return current;
                                              }
                                              setScheduleMessage("");
                                              return { ...current, [key]: { ...current[key], time } };
                                            });
                                          }}>{formatTime12(time, time)}</button>;
                                        })}</div>
                                      ) : <p>{t("لا توجد أوقات متاحة لهذه الموظفة في التاريخ المختار.")}</p>}
                                    </div>
                                  </div>
                                  {conflictKeys.has(key) ? <p className="bk2-inline-warning">{t("هذا الموعد يتعارض مع خدمة أخرى في نفس حجز العميلة. اختاري وقتًا مختلفًا.")}</p> : null}
                                  {!staffRows.length && !staffLoading ? <p className="bk2-inline-warning">{t("لا توجد موظفة مؤهلة ومتاحة لهذه الخدمة في هذا اليوم.")}</p> : null}
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <section className="bk2-payment-step">
                  <div className="bk2-section-title"><div><h2>{t("المراجعة والدفع")}</h2><p>{t("راجعي الحجز ثم اختاري طريقة ونوع التحصيل.")}</p></div><span><FiCreditCard /></span></div>
                  {createdBookingIds.length ? (
                    <div className="bk2-booking-success">
                      <strong>✓ {t(createdPartyBookings.length > 1 ? "تم حفظ مجموعة الحجز بنجاح" : "تم حفظ الحجز بنجاح")}</strong>
                      {createdBookingReference ? <div className="bk2-booking-success-reference"><span>{t(createdPartyBookings.length > 1 ? "مراجع الحجوزات" : "رقم الحجز")}</span><bdi dir="ltr">{createdBookingReference}</bdi></div> : null}
                      {createdPartyBookings.length > 1 ? (
                        <div className="bk2-party-success-bookings">
                          {createdPartyBookings.map((row) => <div key={row.parentId}><span>{row.clientName}</span><bdi dir="ltr">{row.reference}</bdi></div>)}
                        </div>
                      ) : null}
                      <p>{createdPartyBookings.length > 1 ? t("تم إنشاء حجز مستقل لكل عميلة وربطها كلها بنفس مجموعة الحجز والدفع.") : <>{t("تم ربط")} {cart.length} {cart.length === 1 ? t("خدمة") : t("خدمات")} {t("بالعميلة والموظفات المختارات.")}</>}</p>
                      {postSaveWarning ? <p className="bk2-inline-warning">{postSaveWarning}</p> : null}
                      <div className="bk2-booking-success-actions"><button type="button" onClick={printCreatedBookingInvoice}>{t("طباعة الفاتورة")}</button><button type="button" onClick={resetCompletedBooking}>{t("إنشاء حجز جديد")}</button></div>
                    </div>
                  ) : (
                    <>
                      <div className="bk2-review-list">
                        {cart.map((service, index) => {
                          const key = bookingLineKey(service);
                          const schedule = scheduleByService[key];
                          const allocation = discountSnapshot?.allocations?.find(
                            (row) => String(row.bookingItemId || "").trim() === key
                          );
                          const catalogPrice = Math.max(0, serviceCatalogPrice(service));
                          const effectiveBasePrice = Math.max(0, servicePrice(service));
                          const promoActive = serviceHasActivePromo(service);
                          const bookingPrice = Math.max(0, bookingPriceForService(service));
                          const draft = priceAdjustments[key];
                          const adjusted = Math.abs(bookingPrice - effectiveBasePrice) > 0.005;
                          const rowDiscount = allocation
                            ? halalasToSar(allocation.discountAmountHalalas)
                            : 0;
                          const rowFinal = allocation
                            ? halalasToSar(allocation.finalAmountHalalas)
                            : bookingPrice;

                          return (
                            <article
                              key={key}
                              className={`bk2-review-item ${adjusted ? "has-price-adjustment" : ""}`}
                            >
                              <span className="bk2-review-index">{index + 1}</span>
                              <div className="bk2-review-content">
                                <strong>
                                  {translateBookingCatalogLabel(
                                    language,
                                    serviceTitle(service),
                                    "service"
                                  )}
                                </strong>
                                <small>
                                  {bookingClients.length > 1 ? `${bookingLineClientName(service)} · ` : ""}
                                  {schedule?.staffName} · {bookingDate} ·{" "}
                                  {formatTime12(schedule?.time, schedule?.time)}
                                </small>

                                <div className="bk2-item-price-breakdown">
                                  <span>
                                    {t("سعر الكتالوج")}
                                    <strong>{money(catalogPrice)}</strong>
                                  </span>
                                  {promoActive ? (
                                    <span className="is-promo">
                                      {t("سعر العرض")}
                                      <strong>{money(effectiveBasePrice)}</strong>
                                    </span>
                                  ) : null}
                                  <span className={adjusted ? "is-adjusted" : ""}>
                                    {adjusted
                                      ? t("سعر الحجز المعدل")
                                      : t("سعر الحجز")}
                                    <strong>{money(bookingPrice)}</strong>
                                  </span>
                                  <span>
                                    {t("الخصم")}
                                    <strong>{money(rowDiscount)}</strong>
                                  </span>
                                  <span className="is-final">
                                    {t("السعر النهائي")}
                                    <strong>{money(rowFinal)}</strong>
                                  </span>
                                </div>

                                <div className="bk2-price-adjustment">
                                    {!draft ? (
                                      <button
                                        type="button"
                                        className="bk2-price-adjust-toggle"
                                        disabled={!canAdjustBookingPrice}
                                        title={
                                          canAdjustBookingPrice
                                            ? undefined
                                            : t("لا تملك صلاحية تعديل سعر الحجز.")
                                        }
                                        onClick={() => {
                                          if (!canAdjustBookingPrice) return;
                                          setPriceAdjustments((current) => ({
                                            ...current,
                                            [key]: {
                                              price: String(effectiveBasePrice),
                                              reason: "",
                                              note: "",
                                            },
                                          }));
                                        }}
                                      >
                                        {t("تعديل سعر الحجز")}
                                      </button>
                                    ) : canAdjustBookingPrice ? (
                                      <div className="bk2-price-adjustment-editor">
                                        <label>
                                          <span>{t("السعر الفعلي للحجز")}</span>
                                          <div className="bk2-price-input">
                                            <input
                                              inputMode="decimal"
                                              value={draft.price}
                                              onChange={(event) => {
                                                const value = normalizeDigits(event.target.value)
                                                  .replace(/[^0-9.]/g, "");
                                                setPriceAdjustments((current) => ({
                                                  ...current,
                                                  [key]: {
                                                    ...current[key],
                                                    price: value,
                                                  },
                                                }));
                                              }}
                                            />
                                            <em>{currency}</em>
                                          </div>
                                        </label>

                                        <label>
                                          <span>
                                            {t("سبب تعديل السعر")}
                                            {adjusted ? " *" : ""}
                                          </span>
                                          <select
                                            value={draft.reason}
                                            onChange={(event) =>
                                              setPriceAdjustments((current) => ({
                                                ...current,
                                                [key]: {
                                                  ...current[key],
                                                  reason: event.target.value as
                                                    | PriceAdjustmentReason
                                                    | "",
                                                },
                                              }))
                                            }
                                          >
                                            <option value="">
                                              {t("اختاري السبب")}
                                            </option>
                                            <option value="catalog_pending_update">
                                              {t("السعر محدث ولم يحدث الكتالوج")}
                                            </option>
                                            <option value="management_approved">
                                              {t("سعر معتمد من الإدارة")}
                                            </option>
                                            <option value="special_price">
                                              {t("سعر خاص")}
                                            </option>
                                            <option value="other">
                                              {t("أخرى")}
                                            </option>
                                          </select>
                                        </label>

                                        <label className="is-wide">
                                          <span>
                                            {t("ملاحظة إضافية (اختياري)")}
                                          </span>
                                          <input
                                            value={draft.note}
                                            maxLength={300}
                                            onChange={(event) =>
                                              setPriceAdjustments((current) => ({
                                                ...current,
                                                [key]: {
                                                  ...current[key],
                                                  note: event.target.value,
                                                },
                                              }))
                                            }
                                            placeholder={t("تفاصيل داخلية للإدارة فقط")}
                                          />
                                        </label>

                                        <button
                                          type="button"
                                          className="bk2-price-reset"
                                          onClick={() =>
                                            setPriceAdjustments((current) => {
                                              const next = { ...current };
                                              delete next[key];
                                              return next;
                                            })
                                          }
                                        >
                                          {t("إلغاء تعديل السعر")}
                                        </button>
                                      </div>
                                    ) : null}
                                    {!canAdjustBookingPrice ? (
                                      <p className="bk2-price-permission-note">
                                        {t("لا تملك صلاحية تعديل سعر الحجز.")}
                                      </p>
                                    ) : null}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                      <div className="bk2-payment-block bk2-discount-block">
                        <h3>{t("إضافة خصم أو كوبون")}</h3>
                        <div className="bk2-choice-grid five">
                          <button type="button" className={discountMode === "none" ? "is-active" : ""} onClick={() => { setDiscountMode("none"); setCouponOffer(null); setSelectedOfferByClientKey({}); }}>{t("بدون خصم")}</button>
                          <button type="button" disabled={!canApplyManualDiscount} title={canApplyManualDiscount ? undefined : t("الخصم اليدوي يحتاج صلاحية مستقلة.")} className={discountMode === "fixed" ? "is-active" : ""} onClick={() => { if (!canApplyManualDiscount) return; setDiscountMode("fixed"); setCouponOffer(null); setSelectedOfferByClientKey({}); }}>{t("مبلغ ثابت")}</button>
                          <button type="button" disabled={!canApplyManualDiscount} title={canApplyManualDiscount ? undefined : t("الخصم اليدوي يحتاج صلاحية مستقلة.")} className={discountMode === "percent" ? "is-active" : ""} onClick={() => { if (!canApplyManualDiscount) return; setDiscountMode("percent"); setCouponOffer(null); setSelectedOfferByClientKey({}); }}>{t("نسبة")}</button>
                          <button type="button" className={discountMode === "offer" ? "is-active" : ""} onClick={() => { setDiscountMode("offer"); setCouponOffer(null); }}>{t("عرض محفوظ")}</button>
                          <button type="button" className={discountMode === "coupon" ? "is-active" : ""} onClick={() => { setDiscountMode("coupon"); setSelectedOfferByClientKey({}); }}>{t("كوبون")}</button>
                        </div>
                        {!canApplyManualDiscount ? <p className="bk2-price-permission-note">{t("الخصم اليدوي يحتاج صلاحية مستقلة.")}</p> : null}
                        {bookingClients.length > 1 && (discountMode === "fixed" || discountMode === "percent") ? <p className="bk2-price-permission-note">{t("في الحجز الجماعي يتم توزيع الخصم اليدوي على حجوزات العميلات مع بقاء الإجمالي المدخل كما هو.")}</p> : null}
                        {discountMode === "fixed" ? <label className="bk2-payment-input"><span>{t("قيمة الخصم")}</span><input inputMode="decimal" value={manualFixedDiscount} onChange={(e) => setManualFixedDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" /><em>{currency}</em></label> : null}
                        {discountMode === "percent" ? <div className="bk2-discount-grid"><label><span>{t("النسبة")}</span><input inputMode="decimal" value={manualPercentDiscount} onChange={(e) => setManualPercentDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 - 100" /></label><label><span>{t("حد أقصى اختياري")}</span><input inputMode="decimal" value={manualMaxDiscount} onChange={(e) => setManualMaxDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={t("بدون حد")} /></label></div> : null}
                        {discountMode === "offer" ? (
                          <div className="bk2-offer-client-scope">
                            {bookingClients.length > 1 ? (
                              <div className="bk2-discount-client-picker">
                                {bookingClients.map((client, index) => {
                                  const clientKey = partyClientKey(client);
                                  const clientOfferId = String(selectedOfferByClientKey[clientKey] || "");
                                  const clientOffer = offers.find((offer) => String((offer as any)?.id || "") === clientOfferId);
                                  return (
                                    <button type="button" key={clientKey} className={activePartyClientKey === clientKey ? "is-active" : ""} onClick={() => setActivePartyClientKey(clientKey)}>
                                      <strong>{client.name}</strong>
                                      <small>{index === 0 ? t("الأساسية") : t("مرافقة")} · {clientOffer ? clientOffer.name : t("بدون عرض")}</small>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            <div className="bk2-offers-list">
                              {offersLoading ? <p>{t("جاري تحميل العروض...")}</p> : null}
                              {!offersLoading && offersMessage ? <p>{offersMessage}</p> : null}
                              {!offersLoading && offers.map((offer) => {
                                const activeItems = discountItems
                                  .filter((item: any) => item.partyClientKey === activePartyClientKey)
                                  .map(({ partyClientKey: _partyClientKey, ...item }: any) => item);
                                const preview = buildDiscountSnapshot(activeItems, {
                                  source: "offer",
                                  sourceId: String((offer as any)?.id || ""),
                                  code: String((offer as any)?.code || ""),
                                  title: String(offer.name || ""),
                                  offer,
                                });
                                const offerId = String((offer as any)?.id || "");
                                const selected = selectedOfferId === offerId;
                                return (
                                  <button
                                    type="button"
                                    key={offer.id}
                                    className={selected ? "is-active" : ""}
                                    onClick={() => setOfferForClient(activePartyClientKey, selected ? "" : offerId)}
                                  >
                                    <strong>{offer.name}</strong>
                                    <span>{offerValueLabel(offer, language)} · {preview.ok ? `${t("خصم متوقع")} ${money(halalasToSar(preview.discountHalalas))}` : discountReasonText(preview.reason, language)}</span>
                                    {Array.isArray(offer.serviceIds) && offer.serviceIds.length ? <small>{t("خدمات محددة")}: {offer.serviceIds.length}</small> : null}
                                    {Array.isArray((offer as any).categoryIds) && (offer as any).categoryIds.length ? <small>{t("تصنيفات محددة")}: {(offer as any).categoryIds.length}</small> : null}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {discountMode === "coupon" ? <div className="bk2-coupon-row"><label><span>{t("كود الكوبون")}</span><input value={couponInput} onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponOffer(null); setCouponMessage(""); }} placeholder="QSXXXX" /></label><button type="button" onClick={() => void verifyCoupon()} disabled={couponChecking || !couponInput.trim()}>{couponChecking ? t("جاري التحقق...") : t("تحقق")}</button></div> : null}
                        {couponMessage ? <p className={couponOffer ? "bk2-inline-success" : "bk2-inline-warning"}>{couponMessage}</p> : null}
                        {discountMode !== "none" && discountMessage ? <p className="bk2-inline-warning">{discountMessage}</p> : null}
                        {discountSnapshot ? <div className="bk2-discount-preview"><span>{t("الإجمالي المؤهل")}: {money(halalasToSar(discountSnapshot.eligibleSubtotalHalalas))}</span><strong>{t("الخصم")}: {money(discountAmount)}</strong></div> : null}
                      </div>
                      <div className="bk2-payment-block"><h3>{t("نوع التحصيل")}</h3><div className="bk2-choice-grid"><button type="button" className={paymentType === "full" ? "is-active" : ""} onClick={() => setPaymentType("full")}>{t("دفع كامل")}</button><button type="button" className={paymentType === "partial" ? "is-active" : ""} onClick={() => setPaymentType("partial")}>{t("عربون")}</button><button type="button" className={paymentType === "none" ? "is-active" : ""} onClick={() => setPaymentType("none")}>{t("بدون دفع الآن")}</button></div>{paymentType === "partial" ? <label className="bk2-payment-input"><span>{t("قيمة العربون")}</span><input inputMode="decimal" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" /><em>{currency}</em></label> : null}</div>
                      {paymentType !== "none" ? <div className="bk2-payment-block"><h3>{t("طريقة الدفع")}</h3><div className="bk2-choice-grid four"><button type="button" className={paymentMethod === "cash" ? "is-active" : ""} onClick={() => setPaymentMethod("cash")}>{t("كاش")}</button><button type="button" className={paymentMethod === "card" ? "is-active" : ""} onClick={() => setPaymentMethod("card")}>{t("شبكة")}</button><button type="button" className={paymentMethod === "transfer" ? "is-active" : ""} onClick={() => setPaymentMethod("transfer")}>{t("تحويل")}</button><button type="button" className={paymentMethod === "mixed" ? "is-active" : ""} onClick={() => setPaymentMethod("mixed")}>{t("مختلط")}</button></div>{paymentMethod === "mixed" ? <div className="bk2-mixed-grid"><label><span>{t("كاش")}</span><input inputMode="decimal" value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label><label><span>{t("شبكة")}</span><input inputMode="decimal" value={cardAmount} onChange={(e) => setCardAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label><label><span>{t("تحويل")}</span><input inputMode="decimal" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label><p>{t("المجموع")}: {money(mixedTotal)} {t("من")} {money(effectivePaidAmount)}</p></div> : null}</div> : null}
                      <label className="bk2-note-field"><span>{t("ملاحظة الحجز (اختياري)")}</span><textarea value={bookingNote} onChange={(e) => setBookingNote(e.target.value)} placeholder={t("أي تفاصيل مهمة للموظفة أو الاستقبال...")} /></label>
                      <div className="bk2-payment-summary">
                        {hasPriceAdjustments ? <div><span>{t("إجمالي الكتالوج")}</span><strong>{money(catalogTotal)}</strong></div> : null}
                        <div><span>{t("سعر الحجز قبل الخصم")}</span><strong>{money(bookingSubtotal)}</strong></div>
                        <div><span>{t("الخصم")}</span><strong>{money(discountAmount)}</strong></div>
                        <div><span>{t("الإجمالي بعد الخصم")}</span><strong>{money(finalTotal)}</strong></div>
                        <div><span>{t("المدفوع الآن")}</span><strong>{money(effectivePaidAmount)}</strong></div>
                        <div><span>{t("المتبقي")}</span><strong>{money(remainingAmount)}</strong></div>
                      </div>
                      {submitError ? <p className="bk2-inline-warning">{submitError}</p> : null}
                      <div className="bk2-final-actions"><button type="button" className="is-secondary" onClick={() => setStep(3)} disabled={submitting}>{t("العودة للموعد")}</button><button type="button" className="is-primary" onClick={requestSubmitBooking} disabled={submitting}>{submitting ? "جاري حفظ الحجز..." : paymentType === "none" ? "حفظ كحجز غير مدفوع" : paymentType === "partial" ? `حفظ الحجز بعربون ${money(effectivePaidAmount)}` : `حفظ الحجز وتحصيل ${money(effectivePaidAmount)}`}</button></div>
                    </>
                  )}
                </section>
              )}
            </main>

            <div className="bk2-summary-column">
              <aside className="bk2-summary-card" onWheel={handleSummaryWheel}>
              <div ref={summaryScrollRef} className="bk2-summary-scroll">
              <div className="bk2-summary-title"><h2>{t("ملخص الحجز")}</h2><FiCalendar /></div>
              <div className={`bk2-selected-client ${selectedClient ? "has-client" : ""}`}><span className="bk2-avatar">{selectedClient ? selectedClient.name.slice(0, 1) : <FiUser />}</span><div><strong>{selectedClient?.name || t("لم يتم اختيار عميلة بعد")}</strong><small>{selectedClient ? (companions.length ? `${selectedClient.phone} · +${companions.length} ${t("مرافقات")}` : selectedClient.phone) : t("اختاري عميلة للمتابعة")}</small></div></div>
              <dl className="bk2-summary-meta"><div><dt><FiShoppingBag /> {t("نوع الحجز")}</dt><dd>{t("حجز داخل الصالون")}</dd></div><div><dt><FiCalendar /> {t("التاريخ")}</dt><dd>{step >= 3 ? bookingDate : "—"}</dd></div><div><dt><FiUsers /> {t("الموظفة")}</dt><dd>{Object.values(scheduleByService)[0]?.staffName || "—"}</dd></div></dl>
              {cart.length ? (
                <div className="bk2-summary-party-groups">
                  {scheduleGroups.map((group) => {
                    const memberOfferId = String(selectedOfferByClientKey[group.clientKey] || "");
                    const memberOffer = offers.find((offer) => String((offer as any)?.id || "") === memberOfferId) || null;
                    const memberDiscount = discountResultsByClient.get(group.clientKey);
                    const memberSubtotal = group.services.reduce((sum, service) => sum + bookingPriceForService(service), 0);
                    const memberFinal = memberDiscount?.ok ? halalasToSar(memberDiscount.totalHalalas) : memberSubtotal;
                    return (
                      <section key={group.clientKey} className="bk2-summary-party-group">
                        <header>
                          <div>
                            <small>{t(group.clientIndex === 0 ? "العميلة الأساسية" : "مرافقة")}</small>
                            <strong>{group.client.name}</strong>
                          </div>
                          <span>{group.services.length} {t(group.services.length === 1 ? "خدمة" : "خدمات")}</span>
                        </header>
                        {memberOffer ? <div className="bk2-summary-party-offer"><span>{t("العرض المختار")}</span><strong>{memberOffer.name}</strong></div> : null}
                        <div className="bk2-summary-services">
                          {group.services.map((service) => {
                            const key = bookingLineKey(service);
                            const schedule = scheduleByService[key];
                            const catalogPrice = serviceCatalogPrice(service);
                            const effectiveBasePrice = servicePrice(service);
                            const promoActive = serviceHasActivePromo(service);
                            const bookingPrice = bookingPriceForService(service);
                            const adjusted = Math.abs(bookingPrice - effectiveBasePrice) > 0.005;
                            return <div key={key}><span>{translateBookingCatalogLabel(language, serviceTitle(service), "service")}{schedule?.time ? <small>{schedule.staffName} · {formatTime12(schedule.time, schedule.time)}</small> : null}{promoActive || adjusted ? <small>{t("سعر الكتالوج")}: {money(catalogPrice)}</small> : null}{promoActive ? <small>{t("سعر العرض")}: {money(effectiveBasePrice)}</small> : null}</span><strong>{money(bookingPrice)}</strong></div>;
                          })}
                        </div>
                        <footer><span>{t("إجمالي العميلة")}</span><strong>{money(memberFinal)}</strong></footer>
                      </section>
                    );
                  })}
                </div>
              ) : <div className="bk2-empty-services"><FiShoppingBag /><p>{t("لم تتم إضافة خدمات بعد")}</p></div>}
              </div>
              <div className="bk2-summary-footer">
              <div className="bk2-totals">
                {hasPriceAdjustments ? <div><span>{t("إجمالي الكتالوج")}</span><strong>{money(catalogTotal)}</strong></div> : null}
                <div><span>{t("سعر الحجز")}</span><strong>{money(bookingSubtotal)}</strong></div>
                <div className="is-discount"><span>{t("الخصم")}</span><strong>{money(discountAmount)}</strong></div>
                <div className="is-total"><span>{t("الإجمالي")}</span><strong>{money(finalTotal)}</strong></div>
              </div>
              {sidebarCanAdvance ? (
                <button
                  key={`continue-${step}`}
                  className="bk2-continue is-revealed"
                  onClick={() => {
                    if (step === 1) setStep(2);
                    else if (step === 2) setStep(3);
                    else if (step === 3) setStep(4);
                  }}
                >
                  {step === 1 ? t("المتابعة للخدمات") : step === 2 ? t("المتابعة للموظفة والموعد") : t("المتابعة للمراجعة والدفع")}
                  <FiChevronLeft />
                </button>
              ) : step < 4 ? (
                <div className="bk2-next-hint" aria-live="polite">
                  <span>•</span>
                  <p>{t(step === 1
                    ? addingCompanion
                      ? "أكملي اختيار المرافقة أو ألغِ الإضافة للمتابعة."
                      : clientPickerOpen
                        ? "اختاري العميلة أولًا وسيظهر زر المتابعة تلقائيًا."
                        : "اختاري العميلة للمتابعة."
                    : step === 2
                      ? "أضيفي خدمة واحدة على الأقل لكل عميلة وسيظهر زر المتابعة."
                      : "أكملي الموظفة والوقت لكل خدمة وسيظهر زر المتابعة.")}</p>
                </div>
              ) : null}
              </div>
              </aside>
            </div>
          </div>
        </>
      )}
      <ConfirmModal open={showPastDateConfirmation} title={t("تأكيد الحجز بتاريخ سابق")} message={t("تاريخ الحجز المحدد سابق لتاريخ اليوم. هل تريد متابعة إنشاء الحجز؟")} confirmText={t("تأكيد وإنشاء الحجز")} cancelText={t("إلغاء")} showCancel onConfirm={confirmPastDateBooking} onCancel={() => setShowPastDateConfirmation(false)} />
      <HairLengthGuideDrawer
        open={hairGuideOpen}
        imageUrl={hairLengthGuideImage}
        triggerRef={hairGuideTriggerRef}
        canUpload={false}
        uploading={false}
        onUpload={() => undefined}
        onClose={() => setHairGuideOpen(false)}
      />
    </div>
  );
}
