import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCalendar, FiChevronLeft, FiClock, FiCreditCard, FiPlus, FiSearch, FiShoppingBag, FiUser, FiUsers } from "react-icons/fi";
import ConfirmModal from "../../components/ConfirmModal";
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
type PaymentMethod = "cash" | "card" | "transfer" | "mixed";
type PaymentType = "full" | "partial" | "none";
type DiscountMode = "none" | "fixed" | "percent" | "offer" | "coupon";
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
        id: `history:${key}`,
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
  createdBookingIds: string[];
  selectedClient: ClientCandidate | null;
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
  discountSnapshot?: DiscountSnapshot | null;
}) {
  const bookingIds = Array.isArray(args.createdBookingIds) ? args.createdBookingIds : [];
  const parentId = String(bookingIds[0] || "").trim();
  if (!parentId || !args.selectedClient || !args.cart.length) return [];

  const rowOriginalPrices = args.cart.map((service) => Math.max(0, servicePrice(service)));
  const allocationByItem = new Map(
    (args.discountSnapshot?.allocations || []).map((row) => [String(row.bookingItemId || row.serviceId || "").trim(), row])
  );
  const rowFinalPrices = args.cart.map((service, index) => {
    const key = `item_${index}`;
    const allocation = allocationByItem.get(key) || allocationByItem.get(String(service.id || "").trim());
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
    const serviceKey = String(service.id || "");
    const schedule = (args.scheduleByService[serviceKey] || {}) as Partial<ScheduleSelection>;
    const rowId = String(bookingIds[index + 1] || parentId || `${serviceKey}_${index}`).trim();
    const allocation = allocationByItem.get(`item_${index}`) || allocationByItem.get(serviceKey);
    const originalTotal = rowOriginalPrices[index] || 0;
    const discountAmount = allocation ? halalasToSar(allocation.discountAmountHalalas) : 0;
    const total = rowFinalPrices[index] || 0;
    const serviceName = serviceTitle(service);
    const sectionTitle = String(service?.sectionTitle || service?.sectionName || service?.sectionLabel || args.selectedSectionId || "").trim();
    const categoryTitle = String(service?.categoryTitle || service?.categoryName || service?.categoryLabel || service?.categoryId || "").trim();
    return {
      id: rowId,
      publicId: parentId,
      clientName: args.selectedClient?.name || "",
      clientPhone: args.selectedClient?.phone || "",
      serviceId: serviceKey,
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

function offerValueLabel(offer: CoreDiscount) {
  const type = String((offer as any)?.discountType || (offer as any)?.type || "").trim();
  const value = Number((offer as any)?.value || 0);
  if (type === "percent") return `${value}%`;
  return `${value.toLocaleString("ar-SA-u-nu-latn")} ر.س`;
}

function discountReasonText(reason: string) {
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
  return map[reason] || reason || "";
}

const steps = [
  { id: 1 as const, title: "العميلة", subtitle: "اختيار العميلة", icon: FiUser },
  { id: 2 as const, title: "الخدمات", subtitle: "اختيار الخدمات", icon: FiShoppingBag },
  { id: 3 as const, title: "الموظفة والموعد", subtitle: "تحديد الوقت", icon: FiUsers },
  { id: 4 as const, title: "الدفع", subtitle: "المراجعة والدفع", icon: FiCreditCard },
];

export default function BookingInternalV2() {
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<"new" | "sessions">("new");
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientCandidate | null>(null);
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

  const [sections, setSections] = useState<CatalogSection[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [cart, setCart] = useState<CatalogService[]>([]);
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
  const [createdBookingReference, setCreatedBookingReference] = useState("");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>("none");
  const [manualFixedDiscount, setManualFixedDiscount] = useState("");
  const [manualPercentDiscount, setManualPercentDiscount] = useState("");
  const [manualMaxDiscount, setManualMaxDiscount] = useState("");
  const [offers, setOffers] = useState<CoreDiscount[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersMessage, setOffersMessage] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState("");
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
    setSelectedClient(candidate);
    setClients((current) => [candidate, ...current.filter((row) => candidateIdentity(row) !== candidateIdentity(candidate))]);
    markQuickClientUsage(candidate);
    setShowNewClient(false);
    setNewClientName("");
    setNewClientPhone("");
    setNewClientEmail("");
    setExistingClientMatch(null);
    setExistingClientLookupError("");
    setNewClientError("");
    setClientMessage(message);
  }, []);

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
          setExistingClientLookupError("تعذر التحقق من رقم الجوال. لن يتم إنشاء سجل جديد قبل نجاح التحقق.");
        } finally {
          if (lookupSeq === newClientLookupSeq.current) setExistingClientChecking(false);
        }
      })();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [showNewClient, newClientPhone, findExistingClientByPhone]);

  const createNewClient = useCallback(async () => {
    const name = String(newClientName || "").trim();
    const phone = phone10Digits(newClientPhone);
    const email = String(newClientEmail || "").trim();
    if (name.length < 2) { setNewClientError("اكتبي اسم العميلة كاملًا."); return; }
    if (!phone || phone.length !== 10) { setNewClientError("أدخلي رقم جوال سعودي صحيح من 10 أرقام."); return; }

    setCreatingClient(true);
    setExistingClientChecking(true);
    setExistingClientLookupError("");
    setNewClientError("");

    try {
      // Re-check immediately before CREATE. The preview lookup is UX only;
      // this gate is the authoritative client-side duplicate stop.
      const existing = await findExistingClientByPhone(phone);
      if (existing) {
        setExistingClientMatch(existing);
        setClientMessage("تم العثور على عميلة مسجلة بهذا الرقم. اختاري السجل الموجود للمتابعة.");
        return;
      }

      const created: any = await resolveCoreBookingDataSource().createClient({
        name,
        phone,
        email: email || undefined,
      });
      const candidate = candidateFromCoreRow(created || { name, phone }, "client_profile");
      chooseClientForBooking(candidate, "تم اختيار العميلة للحجز بنجاح.");
    } catch (error: any) {
      console.error("[BookingInternalV2] client create/dedup check failed", error);
      const code = String(error?.code || "").toLowerCase();
      if (code === "core_api:offline" || code === "core_api:network_unavailable" || code === "core_api:timeout") {
        setNewClientError("غير متصل بالإنترنت. لم يتم إنشاء العميلة. أعيدي الاتصال ثم حاولي مرة أخرى.");
      } else if (code === "core_api:write_outcome_unknown") {
        setNewClientError("انقطع الاتصال أثناء حفظ العميلة. النتيجة غير مؤكدة؛ أعيدي الاتصال وابحثي برقم الجوال قبل إعادة المحاولة.");
      } else {
        setNewClientError("تعذر التحقق من رقم الجوال أو حفظ العميلة. حاولي مرة أخرى.");
      }
    } finally {
      setExistingClientChecking(false);
      setCreatingClient(false);
    }
  }, [newClientName, newClientPhone, newClientEmail, findExistingClientByPhone, candidateFromCoreRow, chooseClientForBooking]);

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
        name: name || "بدون اسم",
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
      setClientMessage(found.length ? `تم العثور على ${found.length} نتيجة.` : "لم يتم العثور على عميلة مطابقة.");
    } catch (error) {
      console.error("[BookingInternalV2] client search failed", error);
      setClients([]);
      setClientMessage("تعذر جلب بيانات العميلات من السيرفر.");
    } finally {
      setClientSearching(false);
    }
  }, []);

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
          setScheduleMessage("تعذر تحميل إعدادات الحجز من Core D1. أعيدي المحاولة قبل حفظ الحجز.");
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
        if (!activeRows.length) setOffersMessage("لا توجد عروض نشطة حالياً.");
      } catch (error) {
        console.error("[BookingInternalV2] offers load failed", error);
        if (!cancelled) {
          setOffers([]);
          setOffersMessage("تعذر جلب العروض النشطة.");
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
    async function loadSections() {
      setCatalogLoading(true);
      setCatalogMessage("");
      try {
        const rows = await resolveCoreBookingDataSource().getServiceSections();
        if (cancelled) return;
        const safe = Array.isArray(rows) ? (rows as CatalogSection[]) : [];
        setSections(safe);
        setSelectedSectionId((current) => current || String(safe[0]?.id || ""));
        if (!safe.length) setCatalogMessage("لا توجد أقسام خدمات نشطة.");
      } catch (error) {
        console.error("[BookingInternalV2] sections load failed", error);
        if (!cancelled) setCatalogMessage("تعذر جلب قائمة الخدمات من السيرفر.");
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
          setCatalogMessage("تعذر جلب خدمات هذا القسم.");
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
      const textOk = !needle || normalizeSearchText(`${serviceTitle(service)} ${service?.description || ""}`).includes(needle);
      return categoryOk && textOk;
    });
  }, [services, selectedCategoryId, serviceQuery]);

  const cartTotal = useMemo(() => cart.reduce((sum, service) => sum + servicePrice(service), 0), [cart]);
  const selectedOffer = useMemo(() => {
    const id = String(selectedOfferId || "").trim();
    if (!id) return null;
    return offers.find((offer) => String((offer as any)?.id || "").trim() === id) || null;
  }, [offers, selectedOfferId]);
  const discountItems = useMemo(() => cart.map((service, index) => ({
    bookingItemId: `item_${index}`,
    serviceId: String(service.id || "").trim(),
    categoryId: String(service?.categoryId || service?.category || "").trim() || undefined,
    originalAmountHalalas: toHalalas(servicePrice(service)),
  })), [cart]);
  const discountRequest = useMemo(() => {
    if (discountMode === "fixed") {
      return {
        source: "manual" as DiscountSnapshotSource,
        type: "fixed" as const,
        title: "خصم مبلغ ثابت",
        value: Math.max(0, Number(manualFixedDiscount || 0)),
        maxDiscountHalalas: manualMaxDiscount ? toHalalas(manualMaxDiscount) : null,
      };
    }
    if (discountMode === "percent") {
      return {
        source: "manual" as DiscountSnapshotSource,
        type: "percent" as const,
        title: "خصم نسبة",
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
  const discountResult = useMemo(() => buildDiscountSnapshot(discountItems, discountRequest), [discountItems, discountRequest]);
  const discountSnapshot = discountResult.snapshot;
  const discountAmount = halalasToSar(discountResult.discountHalalas);
  const discountMessage = discountResult.ok ? "" : discountReasonText(discountResult.reason);
  const canContinue = Boolean(selectedClient);
  const isPastBookingDate = Boolean(bookingDate && bookingDate < todayISO());
  const bookingConfig = mergeBookingConfig(appSettings?.booking);
  const dayHours = bookingConfig.businessHours?.[weekdayKey(bookingDate)] || { enabled: true, start: "12:00", end: "22:00" };
  const slotStepMin = Math.max(5, Number(bookingConfig.slotStepMin || 10));
  const bufferMin = Math.max(0, Number(bookingConfig.bufferMin || 0));

  function timeToMinutes(value: string) {
    const [hours, minutes] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1;
  }

  const getCartScheduleConflict = useCallback((serviceKey: string, staffKey: string, time: string) => {
    const currentService = cart.find((item) => String(item.id) === serviceKey);
    const start = timeToMinutes(time);
    if (!currentService || start < 0 || !staffKey) return null;

    const clientEnd = start + Math.max(1, serviceDuration(currentService) || 30);
    const staffEnd = clientEnd + bufferMin;

    for (const other of cart) {
      const otherKey = String(other.id);
      if (otherKey === serviceKey) continue;
      const selected = scheduleByService[otherKey];
      if (!selected?.time) continue;
      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) continue;
      const otherClientEnd = otherStart + Math.max(1, serviceDuration(other) || 30);

      // Client-level rule: services in one booking cannot overlap even when
      // they are assigned to different employees.
      if (start < otherClientEnd && otherStart < clientEnd) {
        return {
          kind: "client" as const,
          service: other,
          start: selected.time,
          end: `${String(Math.floor(otherClientEnd / 60)).padStart(2, "0")}:${String(otherClientEnd % 60).padStart(2, "0")}`,
        };
      }

      // Same staff remains stricter because its turnaround buffer must also be free.
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
    return cart.flatMap((other) => {
      const otherKey = String(other.id);
      if (otherKey === serviceKey) return [];
      const selected = scheduleByService[otherKey];
      if (!selected?.time) return [];
      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) return [];
      const otherEnd = otherStart + Math.max(1, serviceDuration(other) || 30);
      return [{
        kind: selected.staffId === staffKey ? "staff" as const : "client" as const,
        serviceTitle: serviceTitle(other),
        start: selected.time,
        end: `${String(Math.floor(otherEnd / 60)).padStart(2, "0")}:${String(otherEnd % 60).padStart(2, "0")}`,
      }];
    }).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }, [cart, scheduleByService]);

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    cart.forEach((service) => {
      const key = String(service.id);
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
          const serviceKey = String(service.id);
          const rows = await listCoreBookableStaffForDate({
            serviceId: serviceKey,
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
            const key = String(service.id);
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
          setScheduleMessage("تعذر جلب توفر الموظفات من Core HR. أعيدي المحاولة.");
        }
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    }

    void loadDatedBookableStaff();
    return () => { cancelled = true; };
  }, [cart, bookingDate, dayHours.enabled, slotStepMin, bufferMin]);

  const loadTimesForService = useCallback(async (service: CatalogService, staff: StaffRow) => {
    const serviceKey = String(service.id);
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
      setScheduleMessage("تعذر جلب الأوقات المتاحة. حاولي مرة أخرى.");
    } finally {
      setTimesLoading((current) => ({ ...current, [serviceKey]: false }));
    }
  }, [bookingDate, dayHours.enabled, slotStepMin, bufferMin]);

  useEffect(() => {
    setScheduleByService({});
    setAvailableTimes({});
  }, [bookingDate]);

  const allScheduled = cart.length > 0 && cart.every((service) => {
    const key = String(service.id);
    const row = scheduleByService[key];
    const staffStillBookable = Boolean(row?.staffId) &&
      (eligibleStaffByService[key] || []).some((staff) => staffId(staff) === row.staffId);
    return Boolean(row?.staffId && row?.time && staffStillBookable && !conflictKeys.has(key));
  });

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
      setCouponMessage("أدخلي كود الكوبون أولاً.");
      return;
    }
    setCouponChecking(true);
    try {
      const offer = (await CoreOfferService.list({ active: true, code }))
        .find((row) => normalizeDiscountCode(row.code || row.codeKey) === code && isCoreOfferActiveNow(row)) || null;
      if (!offer) {
        setCouponMessage("الكوبون غير صحيح أو منتهي أو غير نشط.");
        return;
      }
      const preview = buildDiscountSnapshot(discountItems, {
        source: "coupon",
        sourceId: String((offer as any)?.id || ""),
        code,
        title: String(offer.name || ""),
        offer,
      });
      if (!preview.ok || !preview.snapshot) {
        setCouponMessage(discountReasonText(preview.reason) || "الكوبون لا ينطبق على الخدمات المختارة.");
        return;
      }
      setCouponOffer(offer);
      setDiscountMode("coupon");
      setCouponMessage(`تم التحقق من الكوبون. الخصم المتوقع ${halalasToSar(preview.discountHalalas).toLocaleString("ar-SA-u-nu-latn")} ر.س.`);
    } catch (error) {
      console.error("[BookingInternalV2] coupon verify failed", error);
      setCouponMessage("تعذر التحقق من الكوبون الآن.");
    } finally {
      setCouponChecking(false);
    }
  }, [couponInput, discountItems]);

  const submitBooking = useCallback(async () => {
    if (submittingRef.current) return;
    setSubmitError("");
    setPostSaveWarning("");
    setCreatedBookingIds([]);
    setCreatedBookingReference("");
    if (!selectedClient) { setSubmitError("اختاري العميلة أولًا."); setStep(1); return; }
    if (!settingsReady) { setSubmitError("إعدادات الحجز لم تُحمّل من Core D1 بعد. أعيدي فتح الصفحة أو حاولي مرة أخرى."); return; }
    if (!cart.length) { setSubmitError("أضيفي خدمة واحدة على الأقل."); setStep(2); return; }
    if (!allScheduled) { setSubmitError("أكملي الموظفة والوقت لجميع الخدمات بدون تعارض."); setStep(3); return; }
    if (discountMode !== "none" && !discountResult.ok) {
      setSubmitError(discountMessage || "الخصم المحدد غير صالح.");
      return;
    }
    if (discountMode === "coupon" && !couponOffer) {
      setSubmitError("تحققي من الكوبون قبل حفظ الحجز.");
      return;
    }
    if (paymentType === "partial" && (effectivePaidAmount <= 0 || effectivePaidAmount >= finalTotal)) {
      setSubmitError("قيمة العربون يجب أن تكون أكبر من صفر وأقل من إجمالي الحجز."); return;
    }
    if (paymentMethod === "mixed" && Math.abs(mixedTotal - effectivePaidAmount) > 0.01) {
      setSubmitError(`مجموع الدفع المختلط يجب أن يساوي ${effectivePaidAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س.`); return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const staleSelections: Array<{ service: CatalogService; staff: StaffRow; serviceKey: string }> = [];
      for (const service of cart) {
        const serviceKey = String(service.id);
        const selection = scheduleByService[serviceKey];
        const staff = (eligibleStaffByService[serviceKey] || []).find((row) => staffId(row) === selection?.staffId);
        if (!selection?.time || !staff) continue;

        const freshRows = await listCoreBookableStaffForDate({
          serviceId: serviceKey,
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
        setScheduleMessage("تم تحديث المواعيد؛ الوقت المختار أصبح محجوزًا أو يتداخل مع حجز آخر. اختاري وقتًا جديدًا.");
        setSubmitError("الموعد المختار لم يعد متاحًا. تمت إعادتك إلى خطوة الموعد بعد تحديث الأوقات.");
        setStep(3);
        return;
      }

      const authUser = getAuth().currentUser;
      const userId = String(authUser?.uid || "internal_staff");
      const bookingDataSource = resolveCoreBookingDataSource();
      const selectedClientId = String(selectedClient.id || "").trim();
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
          name: selectedClient.name,
          phone: selectedClient.phone,
        });
        canonicalClientId = String(ensuredClient?.id || "").trim();
      }
      if (!canonicalClientId) {
        throw new Error("تعذر ربط الحجز بحساب العميلة المحدد.");
      }
      const status = paymentType === "none" ? "pending" : "confirmed";
      const total = Math.max(0, finalTotal);
      const allocationByItem = new Map(
        (discountSnapshot?.allocations || []).map((row) => [String(row.bookingItemId || row.serviceId || "").trim(), row])
      );
      const finalDiscountSnapshot = discountSnapshot
        ? { ...discountSnapshot, appliedBy: userId, appliedAt: new Date().toISOString() }
        : null;

      const itemRows = cart.map((service, index) => {
        const key = String(service.id);
        const schedule = scheduleByService[key];
        const itemOriginal = Math.max(0, servicePrice(service));
        const allocation = allocationByItem.get(`item_${index}`) || allocationByItem.get(key);
        const itemDiscount = allocation ? halalasToSar(allocation.discountAmountHalalas) : 0;
        const itemTotal = allocation ? halalasToSar(allocation.finalAmountHalalas) : itemOriginal;
        const proportionalPaid = total > 0
          ? Math.round((effectivePaidAmount * itemTotal / total) * 100) / 100
          : 0;
        const selectedStaff = (eligibleStaffByService[key] || []).find((row) => staffId(row) === schedule.staffId);
        return {
          clientId: canonicalClientId,
          userId: null,
          createdBy: "staff",
          createdByUid: userId,
          channel: "internal",
          clientName: selectedClient.name,
          clientPhone: selectedClient.phone,
          serviceName: serviceTitle(service),
          serviceId: key,
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
          originalAmount: itemOriginal,
          discountAmount: itemDiscount,
          discountSnapshot: finalDiscountSnapshot || undefined,
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
          cartItemId: `item_${index}`,
        } as any;
      });

      const firstItem = itemRows[0];
      const parent = {
        ...firstItem,
        serviceName: cart.length === 1 ? firstItem.serviceName : `${cart.length} خدمات`,
        serviceId: cart.length === 1 ? firstItem.serviceId : undefined,
        employeeId: undefined,
        employeeUid: null,
        employeeName: "عدة موظفات",
        originalAmount: cartTotal,
        discountAmount,
        discountSnapshot: finalDiscountSnapshot || undefined,
        total,
        finalPrice: total,
        paymentMethod: paymentType === "none" ? undefined : paymentMethod,
        paymentType,
        paidAmount: effectivePaidAmount,
        remainingAmount,
        paymentBreakdown: paymentMethod === "mixed"
          ? { cash: Number(cashAmount || 0), card: Number(cardAmount || 0), transfer: Number(transferAmount || 0) }
          : {
              cash: paymentMethod === "cash" ? effectivePaidAmount : 0,
              card: paymentMethod === "card" ? effectivePaidAmount : 0,
              transfer: paymentMethod === "transfer" ? effectivePaidAmount : 0,
            },
      } as any;

      const created = await resolveCoreBookingDataSource().createBookingGroup({ parent, items: itemRows });
      const bookingId = String(created.parentId || "");
      const savedIds = [bookingId, ...(created.itemIds || [])].filter(Boolean);
      setCreatedBookingReference(
        formatBookingReference({
          id: bookingId,
          publicId: String(created.parentPublicId || ""),
          date: bookingDate,
        })
      );

      setCreatedBookingIds(savedIds);
      markQuickClientUsage(selectedClient);

      if (effectivePaidAmount > 0 && bookingId) {
        const dataSource = resolveCoreBookingDataSource();
        const payments = paymentMethod === "mixed"
          ? [
              ["cash", Number(cashAmount || 0)],
              ["card", Number(cardAmount || 0)],
              ["transfer", Number(transferAmount || 0)],
            ] as const
          : [[paymentMethod, effectivePaidAmount]] as const;

        const recordPaymentWithRetry = async (method: string, amount: number) => {
          const amountHalalas = Math.round(amount * 100);
          let lastError: unknown = null;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              await dataSource.recordPayment({
                bookingId,
                method,
                amountHalalas,
                status: "paid",
                paidAt: new Date().toISOString(),
                idempotencyKey: `booking-v2:${bookingId}:${method}:${amountHalalas}`,
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
          for (const [method, amount] of payments) {
            if (amount <= 0) continue;
            await recordPaymentWithRetry(method, amount);
          }

          await resolveCoreBookingDataSource().updateBooking(bookingId, {
            paymentType,
            paidAmount: effectivePaidAmount,
            remainingAmount,
            paymentMethod,
            status,
          } as any);
        } catch (financialError: any) {
          console.error("[BookingInternalV2] financial posting failed after booking creation", financialError);
          setPostSaveWarning(
            `تم حفظ الحجز رقم ${bookingId}، لكن تعذر إكمال مزامنة الدفعة بعد المحاولة التلقائية. لا تعيدي إنشاء الحجز؛ راجعيه من صفحة الحجوزات ثم أعيدي التحصيل.`
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
        setScheduleMessage("سبق حجز هذا الوقت قبل إتمام العملية. أعيدي اختيار المواعيد من القائمة المحدثة.");
        setSubmitError("الموعد محجوز بالفعل. تمت إعادتك إلى خطوة الموعد ولم يتم إنشاء حجز مكرر.");
        setStep(3);
      } else if (
        code === "core_api:offline" ||
        code === "core_api:network_unavailable" ||
        code === "core_api:timeout"
      ) {
        setSubmitError("غير متصل بالإنترنت. لم يتم إنشاء الحجز. أعيدي الاتصال ثم حاولي مرة أخرى.");
      } else if (code === "core_api:write_outcome_unknown") {
        setSubmitError("انقطع الاتصال أثناء حفظ الحجز. نتيجة العملية غير مؤكدة؛ لا تعيدي الحفظ. أعيدي الاتصال وافتحي صفحة الحجوزات للتحقق أولًا.");
      } else {
        setSubmitError(`تعذر حفظ الحجز: ${message || "خطأ غير معروف"}`);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [selectedClient, settingsReady, cart, allScheduled, discountMode, discountResult.ok, discountMessage, couponOffer, discountSnapshot, discountAmount, cartTotal, paymentType, paymentMethod, effectivePaidAmount, finalTotal, remainingAmount, mixedTotal, cashAmount, cardAmount, transferAmount, scheduleByService, eligibleStaffByService, bookingDate, bookingNote, slotStepMin, bufferMin, selectedSectionId, loadTimesForService]);

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
      createdBookingIds,
      selectedClient,
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
      discountSnapshot,
    });
    if (!rows.length) {
      setSubmitError("لا توجد بيانات فاتورة جاهزة للطباعة.");
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
      setSubmitError("تم منع فتح نافذة الفاتورة. فعّلي النوافذ المنبثقة للموقع ثم حاولي مرة أخرى.");
      return;
    }
    popup.focus();
  }, [createdBookingIds, selectedClient, cart, scheduleByService, bookingDate, paymentType, paymentMethod, effectivePaidAmount, remainingAmount, cashAmount, cardAmount, transferAmount, selectedSectionId, discountSnapshot]);

  const resetCompletedBooking = useCallback(() => {
    setCart([]); setScheduleByService({}); setAvailableTimes({}); setSelectedClient(null);
    setBookingDate(todayISO()); setShowPastDateConfirmation(false);
    setStep(1); setPaymentMethod("cash"); setPaymentType("full"); setPaidAmount("");
    setCashAmount(""); setCardAmount(""); setTransferAmount(""); setBookingNote("");
    setCreatedBookingIds([]); setCreatedBookingReference(""); setSubmitError(""); setPostSaveWarning("");
    setDiscountOpen(false); setDiscountMode("none"); setManualFixedDiscount(""); setManualPercentDiscount(""); setManualMaxDiscount("");
    setSelectedOfferId(""); setCouponInput(""); setCouponOffer(null); setCouponMessage("");
  }, []);

  return (
    <div className="bk2-page" dir="rtl">
      <header className="bk2-heading">
        <div>
          <p className="bk2-eyebrow">MALIKAT</p>
          <h1>الحجز الإداري</h1>
          <p>إنشاء حجز جديد بخطوات واضحة وسريعة.</p>
        </div>
        <div className="bk2-mode-switch" aria-label="وضع الحجز">
          <button className={mode === "new" ? "is-active" : ""} onClick={() => setMode("new")}>حجز جديد</button>
          <button className={mode === "sessions" ? "is-active" : ""} onClick={() => setMode("sessions")}>الباقات والجلسات</button>
        </div>
      </header>

      {mode === "sessions" ? <PackageSessionsManager /> : (
        <>
          <nav className="bk2-stepper" aria-label="خطوات الحجز">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = step === item.id;
              const completed = step > item.id;
              return (
                <button key={item.id} className={`${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`} onClick={() => setStep(item.id)}>
                  <span className="bk2-step-number">{completed ? "✓" : item.id}</span>
                  <span className="bk2-step-icon"><Icon /></span>
                  <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                  {index < steps.length - 1 ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>

          <div className="bk2-workspace">
            <main className="bk2-main-card">
              {step === 1 ? (
                <section className="bk2-client-step">
                  <div className="bk2-section-title"><div><h2>البحث عن العميلة</h2><p>ابحثي بالاسم أو رقم الجوال أو رقم العضوية MK.</p></div><span><FiUser /></span></div>
                  <label className="bk2-search-box"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحثي بالاسم أو رقم الجوال أو رقم العضوية (MK)" /></label>
                  {(clientSearching || clientMessage) ? <p className={`bk2-status-line ${clientSearching ? "is-loading" : ""}`}>{clientSearching ? "جاري البحث في بيانات السيرفر..." : clientMessage}</p> : null}
                  <div className="bk2-recent-header"><h3>{query ? "نتائج البحث" : "العميلات الأخيرات"}</h3><span>{visibleClients.length} عميلات</span></div>
                  <div className="bk2-client-grid">
                    {visibleClients.map((client) => (
                      <button key={client.id} className={selectedClient?.id === client.id ? "is-selected" : ""} onClick={() => { setSelectedClient(client); markQuickClientUsage(client); }}>
                        <span className="bk2-avatar">{client.name.slice(0, 1)}</span>
                        <span className="bk2-client-copy"><strong>{client.name}</strong><small>{client.phone}</small><span className="bk2-client-badges"><em>{client.visits ? `${client.visits} استخدامات` : client.publicId ? client.publicId : client.source || "عميلة"}</em>{client.sessions ? <em className="is-green">{client.sessions} جلسات متبقية</em> : null}</span></span>
                      </button>
                    ))}
                  </div>
                  <div className="bk2-divider"><span>أو</span></div>
                  <button className="bk2-add-client" type="button" onClick={() => { setShowNewClient(true); setNewClientError(""); setExistingClientMatch(null); setExistingClientLookupError(""); }}><FiPlus />إضافة عميلة جديدة</button>
                  {showNewClient ? (
                    <div className="bk2-new-client-panel">
                      <div className="bk2-new-client-head"><div><strong>إضافة عميلة جديدة</strong><small>سنفحص رقم الجوال أولًا حتى لا يتم إنشاء سجل مكرر.</small></div><button type="button" onClick={() => setShowNewClient(false)}>×</button></div>
                      <div className="bk2-new-client-grid">
                        <label><span>اسم العميلة *</span><input autoFocus value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="مثال: رانيا الحربي" disabled={Boolean(existingClientMatch)} /></label>
                        <label><span>رقم الجوال *</span><input inputMode="numeric" value={newClientPhone} onChange={(e) => { setNewClientPhone(normalizeDigits(e.target.value).slice(0, 10)); setNewClientError(""); }} placeholder="05xxxxxxxx" /></label>
                        <label className="is-wide"><span>البريد الإلكتروني (اختياري)</span><input type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} placeholder="name@example.com" disabled={Boolean(existingClientMatch)} /></label>
                      </div>

                      {existingClientChecking ? (
                        <div className="bk2-client-identity-check is-loading" role="status">
                          <span className="bk2-client-identity-dot" />
                          <div><strong>جاري التحقق من رقم الجوال...</strong><small>نتأكد أن العميلة غير مسجلة مسبقًا.</small></div>
                        </div>
                      ) : existingClientMatch ? (
                        <div className="bk2-existing-client-match" role="status">
                          <div className="bk2-existing-client-icon" aria-hidden="true">
                            <FiUser />
                          </div>
                          <div className="bk2-existing-client-content">
                            <div className="bk2-existing-client-heading">
                              <div>
                                <span className="bk2-existing-client-kicker">تم العثور على عميلة مسجلة</span>
                                <strong><bdi dir="auto">{existingClientMatch.name}</bdi></strong>
                              </div>
                              <span className="bk2-existing-client-status">سجل موجود</span>
                            </div>
                            <div className="bk2-existing-client-meta">
                              <span><small>رقم الجوال</small><bdi dir="ltr">{existingClientMatch.phone}</bdi></span>
                              {existingClientMatch.publicId ? <span><small>رقم العضوية</small><bdi dir="ltr">{existingClientMatch.publicId}</bdi></span> : null}
                            </div>
                            <p>لن يتم إنشاء سجل جديد. اختاري العميلة الموجودة للمتابعة بالحجز.</p>
                            {newClientName.trim() && normalizeSearchText(newClientName) !== normalizeSearchText(existingClientMatch.name) ? (
                              <div className="bk2-existing-client-name-warning">
                                الاسم الذي كتبتيه مختلف عن الاسم المسجل؛ لن نستبدل بيانات العميلة تلقائيًا.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : existingClientLookupError ? (
                        <div className="bk2-client-identity-check is-error" role="alert">
                          <div><strong>تعذر التحقق من رقم الجوال</strong><small>{existingClientLookupError}</small></div>
                        </div>
                      ) : phone10Digits(newClientPhone).length === 10 ? (
                        <div className="bk2-client-identity-check is-clear" role="status">
                          <span className="bk2-client-identity-dot" />
                          <div><strong>رقم الجوال غير مسجل حاليًا</strong><small>يمكن إنشاء عميلة جديدة بهذا الرقم.</small></div>
                        </div>
                      ) : null}

                      {newClientError ? <p className="bk2-inline-warning">{newClientError}</p> : null}
                      <div className="bk2-new-client-actions">
                        <button type="button" className="is-secondary" onClick={() => setShowNewClient(false)} disabled={creatingClient}>إلغاء</button>
                        <button
                          type="button"
                          className="is-primary"
                          onClick={() => existingClientMatch
                            ? chooseClientForBooking(existingClientMatch, "تم اختيار العميلة الموجودة. لم يتم إنشاء سجل جديد.")
                            : void createNewClient()
                          }
                          disabled={creatingClient || existingClientChecking}
                        >
                          {creatingClient
                            ? "جاري الحفظ..."
                            : existingClientChecking
                              ? "جاري التحقق..."
                              : existingClientMatch
                                ? "اختيار العميلة الموجودة"
                                : existingClientLookupError
                                  ? "إعادة التحقق والحفظ"
                                  : "حفظ واختيار العميلة"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="bk2-tip"><span>i</span><div><strong>نصيحة</strong><p>استخدمي الاسم أو رقم الجوال أو رقم العضوية للوصول إلى العميلة بسرعة.</p></div></div>
                </section>
              ) : step === 2 ? (
                <section className="bk2-services-step">
                  <div className="bk2-section-title"><div><h2>اختيار الخدمات</h2><p>القائمة مرتبطة الآن بكتالوج الخدمات الحقيقي.</p></div><span><FiShoppingBag /></span></div>
                  <label className="bk2-search-box"><FiSearch /><input value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} placeholder="ابحثي عن خدمة..." /></label>
                  <div className="bk2-section-tabs">{sections.map((section) => <button key={section.id} className={selectedSectionId === String(section.id) ? "is-active" : ""} onClick={() => setSelectedSectionId(String(section.id))}>{catalogLabel(section, "قسم")}</button>)}</div>
                  {categories.length ? <div className="bk2-category-tabs"><button className={!selectedCategoryId ? "is-active" : ""} onClick={() => setSelectedCategoryId("")}>الكل</button>{categories.map((category) => <button key={category.id} className={selectedCategoryId === String(category.id) ? "is-active" : ""} onClick={() => setSelectedCategoryId(String(category.id))}>{catalogLabel(category, "تصنيف")}</button>)}</div> : null}
                  {(catalogLoading || catalogMessage) ? <p className={`bk2-status-line ${catalogLoading ? "is-loading" : ""}`}>{catalogLoading ? "جاري تحميل الخدمات..." : catalogMessage}</p> : null}
                  <div className="bk2-service-list">
                    {visibleServices.map((service) => {
                      const inCart = cart.some((item) => String(item.id) === String(service.id));
                      return <button key={service.id} className={inCart ? "is-selected" : ""} onClick={() => setCart((current) => inCart ? current.filter((item) => String(item.id) !== String(service.id)) : [...current, service])}><span className="bk2-service-copy"><strong>{serviceTitle(service)}</strong><small>{serviceDuration(service) ? `${serviceDuration(service)} دقيقة` : "المدة حسب الخدمة"}</small></span><span className="bk2-service-price">{servicePrice(service).toLocaleString("ar-SA-u-nu-latn")} ر.س</span><span className="bk2-service-add">{inCart ? "✓" : "+"}</span></button>;
                    })}
                  </div>
                  {!catalogLoading && !visibleServices.length ? <div className="bk2-no-results">لا توجد خدمات مطابقة في هذا القسم.</div> : null}
                </section>
              ) : step === 3 ? (
                <section className="bk2-schedule-step">
                  <div className="bk2-section-title"><div><h2>الموظفة والموعد</h2><p>الموظفات والأوقات مرتبطة الآن ببيانات الدوام والحجوزات الفعلية.</p></div><span><FiClock /></span></div>
                  <div className="bk2-date-field">
                    <span>تاريخ الحجز</span>
                    <DashboardDatePickerV2
                      value={bookingDate}
                      onChange={setBookingDate}
                      clearable={false}
                      className="bk2-date-picker-v2"
                      aria-describedby={isPastBookingDate ? "bk2-past-date-warning" : undefined}
                    />
                    {isPastBookingDate ? <p id="bk2-past-date-warning" className="bk2-past-date-warning" role="status">أنت تقوم بإنشاء حجز بتاريخ سابق</p> : null}
                  </div>
                  {!dayHours.enabled ? <p className="bk2-status-line">الصالون مغلق في هذا اليوم حسب إعدادات الدوام.</p> : null}
                  {staffLoading ? <p className="bk2-status-line is-loading">جاري تحميل الموظفات...</p> : null}
                  {scheduleMessage ? <p className="bk2-status-line">{scheduleMessage}</p> : null}
                  <div className="bk2-schedule-list">
                    {cart.map((service, index) => {
                      const key = String(service.id);
                      const selection = scheduleByService[key];
                      const staffRows = eligibleStaffByService[key] || [];
                      const times = availableTimes[key] || [];
                      return (
                        <article key={key} className={`bk2-schedule-item ${selection?.time ? "is-complete" : ""}`}>
                          <header><span>{index + 1}</span><div><strong>{serviceTitle(service)}</strong><small>{serviceDuration(service) || 30} دقيقة</small></div>{selection?.time ? <em>✓ مكتمل</em> : null}</header>
                          <div className="bk2-schedule-controls">
                            <div className="bk2-staff-field">
                              <span>الموظفة</span>
                              <DashboardSelectV2
                                value={selection?.staffId || ""}
                                placeholder="اختاري الموظفة"
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
                              <span>الأوقات المتاحة</span>
                              {selection?.staffId && getBusyIntervalsForService(key, selection.staffId).length ? <div className="bk2-busy-intervals">{getBusyIntervalsForService(key, selection.staffId).map((busy) => <p key={`${busy.serviceTitle}-${busy.start}`}>العميلة لديها خدمة من <strong>{formatTime12(busy.start, busy.start)}</strong> إلى <strong>{formatTime12(busy.end, busy.end)}</strong><span>بسبب: {busy.serviceTitle}</span></p>)}</div> : null}
                              {!selection?.staffId ? <p>اختاري الموظفة أولًا.</p> : timesLoading[key] ? <p>جاري فحص المواعيد...</p> : times.length ? (
                                <div>{times.map((time) => {
                                  const conflict = getCartScheduleConflict(key, selection.staffId, time);
                                  const conflicting = Boolean(conflict);
                                  const conflictTitle = conflict ? `غير متاح: يتعارض مع ${serviceTitle(conflict.service)} من ${formatTime12(conflict.start, conflict.start)} إلى ${formatTime12(conflict.end, conflict.end)}` : "";
                                  return <button type="button" key={time} disabled={conflicting} title={conflictTitle} aria-label={conflictTitle || `اختيار ${formatTime12(time, time)}`} className={`${selection?.time === time ? "is-active" : ""} ${conflicting ? "is-conflicting" : ""}`} onClick={() => { if (conflicting) return; setScheduleByService((current) => ({ ...current, [key]: { ...current[key], time } })); }}>{formatTime12(time, time)}</button>;
                                })}</div>
                              ) : <p>لا توجد أوقات متاحة لهذه الموظفة في التاريخ المختار.</p>}
                            </div>
                          </div>
                          {conflictKeys.has(key) ? <p className="bk2-inline-warning">هذا الموعد يتعارض مع خدمة أخرى في نفس حجز العميلة. اختاري وقتًا مختلفًا.</p> : null}
                          {!staffRows.length && !staffLoading ? <p className="bk2-inline-warning">لا توجد موظفة مؤهلة ومتاحة لهذه الخدمة في هذا اليوم.</p> : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <section className="bk2-payment-step">
                  <div className="bk2-section-title"><div><h2>المراجعة والدفع</h2><p>راجعي الحجز ثم اختاري طريقة ونوع التحصيل.</p></div><span><FiCreditCard /></span></div>
                  {createdBookingIds.length ? (
                    <div className="bk2-booking-success"><strong>✓ تم حفظ الحجز بنجاح</strong>{createdBookingReference ? <div className="bk2-booking-success-reference"><span>رقم الحجز</span><bdi dir="ltr">{createdBookingReference}</bdi></div> : null}<p>تم ربط {cart.length} {cart.length === 1 ? "خدمة" : "خدمات"} بالعميلة والموظفات المختارات.</p>{postSaveWarning ? <p className="bk2-inline-warning">{postSaveWarning}</p> : null}<div className="bk2-booking-success-actions"><button type="button" onClick={printCreatedBookingInvoice}>طباعة الفاتورة</button><button type="button" onClick={resetCompletedBooking}>إنشاء حجز جديد</button></div></div>
                  ) : (
                    <>
                      <div className="bk2-review-list">{cart.map((service, index) => { const schedule = scheduleByService[String(service.id)]; const allocation = discountSnapshot?.allocations?.find((row) => row.bookingItemId === `item_${index}` || row.serviceId === String(service.id)); const originalAmount = servicePrice(service); const rowDiscount = allocation ? halalasToSar(allocation.discountAmountHalalas) : 0; const rowFinal = allocation ? halalasToSar(allocation.finalAmountHalalas) : originalAmount; return <article key={service.id}><span>{index + 1}</span><div><strong>{serviceTitle(service)}</strong><small>{schedule?.staffName} · {bookingDate} · {formatTime12(schedule?.time, schedule?.time)}</small>{rowDiscount > 0 ? <small>خصم هذه الخدمة: {rowDiscount.toLocaleString("ar-SA-u-nu-latn")} ر.س</small> : null}</div><b>{rowDiscount > 0 ? <small className="bk2-price-before">{originalAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</small> : null}{rowFinal.toLocaleString("ar-SA-u-nu-latn")} ر.س</b></article>; })}</div>
                      <div className="bk2-payment-block bk2-discount-block"><h3>إضافة خصم أو كوبون</h3><button type="button" className="bk2-discount-toggle" onClick={() => setDiscountOpen((open) => !open)}>{discountOpen ? "إخفاء خيارات الخصم" : "+ إضافة خصم أو كوبون"}</button>{discountOpen || discountMode !== "none" ? <><div className="bk2-choice-grid five"><button type="button" className={discountMode === "none" ? "is-active" : ""} onClick={() => { setDiscountMode("none"); setCouponOffer(null); setSelectedOfferId(""); }}>بدون خصم</button><button type="button" className={discountMode === "fixed" ? "is-active" : ""} onClick={() => { setDiscountMode("fixed"); setCouponOffer(null); setSelectedOfferId(""); }}>مبلغ ثابت</button><button type="button" className={discountMode === "percent" ? "is-active" : ""} onClick={() => { setDiscountMode("percent"); setCouponOffer(null); setSelectedOfferId(""); }}>نسبة</button><button type="button" className={discountMode === "offer" ? "is-active" : ""} onClick={() => { setDiscountMode("offer"); setCouponOffer(null); }}>عرض محفوظ</button><button type="button" className={discountMode === "coupon" ? "is-active" : ""} onClick={() => { setDiscountMode("coupon"); setSelectedOfferId(""); }}>كوبون</button></div>{discountMode === "fixed" ? <label className="bk2-payment-input"><span>قيمة الخصم</span><input inputMode="decimal" value={manualFixedDiscount} onChange={(e) => setManualFixedDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" /><em>ر.س</em></label> : null}{discountMode === "percent" ? <div className="bk2-discount-grid"><label><span>النسبة</span><input inputMode="decimal" value={manualPercentDiscount} onChange={(e) => setManualPercentDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 - 100" /></label><label><span>حد أقصى اختياري</span><input inputMode="decimal" value={manualMaxDiscount} onChange={(e) => setManualMaxDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="بدون حد" /></label></div> : null}{discountMode === "offer" ? <div className="bk2-offers-list">{offersLoading ? <p>جاري تحميل العروض...</p> : null}{!offersLoading && offersMessage ? <p>{offersMessage}</p> : null}{!offersLoading && offers.map((offer) => { const preview = buildDiscountSnapshot(discountItems, { source: "offer", sourceId: String((offer as any)?.id || ""), code: String((offer as any)?.code || ""), title: String(offer.name || ""), offer }); const selected = selectedOfferId === String((offer as any)?.id || ""); return <button type="button" key={offer.id} className={selected ? "is-active" : ""} onClick={() => setSelectedOfferId(String((offer as any)?.id || ""))}><strong>{offer.name}</strong><span>{offerValueLabel(offer)} · {preview.ok ? `خصم متوقع ${halalasToSar(preview.discountHalalas).toLocaleString("ar-SA-u-nu-latn")} ر.س` : discountReasonText(preview.reason)}</span>{Array.isArray(offer.serviceIds) && offer.serviceIds.length ? <small>خدمات محددة: {offer.serviceIds.length}</small> : null}{Array.isArray((offer as any).categoryIds) && (offer as any).categoryIds.length ? <small>تصنيفات محددة: {(offer as any).categoryIds.length}</small> : null}</button>; })}</div> : null}{discountMode === "coupon" ? <div className="bk2-coupon-row"><label><span>كود الكوبون</span><input value={couponInput} onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponOffer(null); setCouponMessage(""); }} placeholder="QSXXXX" /></label><button type="button" onClick={() => void verifyCoupon()} disabled={couponChecking || !couponInput.trim()}>{couponChecking ? "جاري التحقق..." : "تحقق"}</button></div> : null}{couponMessage ? <p className={couponOffer ? "bk2-inline-success" : "bk2-inline-warning"}>{couponMessage}</p> : null}{discountMode !== "none" && discountMessage ? <p className="bk2-inline-warning">{discountMessage}</p> : null}{discountSnapshot ? <div className="bk2-discount-preview"><span>الإجمالي المؤهل: {halalasToSar(discountSnapshot.eligibleSubtotalHalalas).toLocaleString("ar-SA-u-nu-latn")} ر.س</span><strong>الخصم: {discountAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div> : null}</> : null}</div>
                      <div className="bk2-payment-block"><h3>نوع التحصيل</h3><div className="bk2-choice-grid"><button type="button" className={paymentType === "full" ? "is-active" : ""} onClick={() => setPaymentType("full")}>دفع كامل</button><button type="button" className={paymentType === "partial" ? "is-active" : ""} onClick={() => setPaymentType("partial")}>عربون</button><button type="button" className={paymentType === "none" ? "is-active" : ""} onClick={() => setPaymentType("none")}>بدون دفع الآن</button></div>{paymentType === "partial" ? <label className="bk2-payment-input"><span>قيمة العربون</span><input inputMode="decimal" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" /><em>ر.س</em></label> : null}</div>
                      {paymentType !== "none" ? <div className="bk2-payment-block"><h3>طريقة الدفع</h3><div className="bk2-choice-grid four"><button type="button" className={paymentMethod === "cash" ? "is-active" : ""} onClick={() => setPaymentMethod("cash")}>كاش</button><button type="button" className={paymentMethod === "card" ? "is-active" : ""} onClick={() => setPaymentMethod("card")}>شبكة</button><button type="button" className={paymentMethod === "transfer" ? "is-active" : ""} onClick={() => setPaymentMethod("transfer")}>تحويل</button><button type="button" className={paymentMethod === "mixed" ? "is-active" : ""} onClick={() => setPaymentMethod("mixed")}>مختلط</button></div>{paymentMethod === "mixed" ? <div className="bk2-mixed-grid"><label><span>كاش</span><input inputMode="decimal" value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label><label><span>شبكة</span><input inputMode="decimal" value={cardAmount} onChange={(e) => setCardAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label><label><span>تحويل</span><input inputMode="decimal" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label><p>المجموع: {mixedTotal.toLocaleString("ar-SA-u-nu-latn")} من {effectivePaidAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</p></div> : null}</div> : null}
                      <label className="bk2-note-field"><span>ملاحظة الحجز (اختياري)</span><textarea value={bookingNote} onChange={(e) => setBookingNote(e.target.value)} placeholder="أي تفاصيل مهمة للموظفة أو الاستقبال..." /></label>
                      <div className="bk2-payment-summary"><div><span>الإجمالي قبل الخصم</span><strong>{cartTotal.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div><div><span>الخصم</span><strong>{discountAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div><div><span>الإجمالي بعد الخصم</span><strong>{finalTotal.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div><div><span>المدفوع الآن</span><strong>{effectivePaidAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div><div><span>المتبقي</span><strong>{remainingAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div></div>
                      {submitError ? <p className="bk2-inline-warning">{submitError}</p> : null}
                      <div className="bk2-final-actions"><button type="button" className="is-secondary" onClick={() => setStep(3)} disabled={submitting}>العودة للموعد</button><button type="button" className="is-primary" onClick={requestSubmitBooking} disabled={submitting}>{submitting ? "جاري حفظ الحجز..." : paymentType === "none" ? "حفظ كحجز غير مدفوع" : paymentType === "partial" ? `حفظ الحجز بعربون ${effectivePaidAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س` : `حفظ الحجز وتحصيل ${effectivePaidAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س`}</button></div>
                    </>
                  )}
                </section>
              )}
            </main>

            <aside className="bk2-summary-card">
              <div className="bk2-summary-title"><h2>ملخص الحجز</h2><FiCalendar /></div>
              <div className={`bk2-selected-client ${selectedClient ? "has-client" : ""}`}><span className="bk2-avatar">{selectedClient ? selectedClient.name.slice(0, 1) : <FiUser />}</span><div><strong>{selectedClient?.name || "لم يتم اختيار عميلة بعد"}</strong><small>{selectedClient?.phone || "اختاري عميلة للمتابعة"}</small></div></div>
              <dl className="bk2-summary-meta"><div><dt><FiShoppingBag /> نوع الحجز</dt><dd>حجز داخل الصالون</dd></div><div><dt><FiCalendar /> التاريخ</dt><dd>{step >= 3 ? bookingDate : "—"}</dd></div><div><dt><FiUsers /> الموظفة</dt><dd>{Object.values(scheduleByService)[0]?.staffName || "—"}</dd></div></dl>
              {cart.length ? <div className="bk2-summary-services">{cart.map((service) => { const schedule = scheduleByService[String(service.id)]; return <div key={service.id}><span>{serviceTitle(service)}{schedule?.time ? <small>{schedule.staffName} · {formatTime12(schedule.time, schedule.time)}</small> : null}</span><strong>{servicePrice(service).toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div>; })}</div> : <div className="bk2-empty-services"><FiShoppingBag /><p>لم تتم إضافة خدمات بعد</p></div>}
              <div className="bk2-totals"><div><span>الإجمالي الفرعي</span><strong>{cartTotal.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div><div className="is-discount"><span>الخصم</span><strong>{discountAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div><div className="is-total"><span>الإجمالي</span><strong>{finalTotal.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div></div>
              <button className="bk2-continue" disabled={step === 1 ? !canContinue : step === 2 ? !cart.length : step === 3 ? !allScheduled : step === 4} onClick={() => { if (step === 1 && canContinue) setStep(2); else if (step === 2 && cart.length) setStep(3); else if (step === 3 && allScheduled) setStep(4); }}>{step === 1 ? "المتابعة للخدمات" : step === 2 ? "المتابعة للموظفة والموعد" : step === 3 ? "المتابعة للمراجعة والدفع" : "راجعي وأكدي الحجز أعلاه"}<FiChevronLeft /></button>
              <p className="bk2-safe-note">هذه نسخة V2 تجريبية منفصلة، ولم تستبدل نظام الحجز الحالي.</p>
            </aside>
          </div>
        </>
      )}
      <ConfirmModal open={showPastDateConfirmation} title="تأكيد الحجز بتاريخ سابق" message="تاريخ الحجز المحدد سابق لتاريخ اليوم. هل تريد متابعة إنشاء الحجز؟" confirmText="تأكيد وإنشاء الحجز" cancelText="إلغاء" showCancel onConfirm={confirmPastDateBooking} onCancel={() => setShowPastDateConfirmation(false)} />
    </div>
  );
}
