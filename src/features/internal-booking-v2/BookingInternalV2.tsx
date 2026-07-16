import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiCalendar, FiChevronLeft, FiClock, FiCreditCard, FiPlus, FiSearch, FiShoppingBag, FiUser, FiUsers } from "react-icons/fi";
import "./booking-internal-v2.css";
import { addDoc, collection, getDocs, limit, orderBy, query as fsQuery, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { getDataSourceFlags } from "../../config/dataSourceFlags";
import { resolveBookingDataSource } from "../../services/bookingDataSource";
import { createBookingGroup, getStaffAvailability, listActiveCategoriesBySection, listActiveSections, listActiveServices, listActiveStaffAll, updateBookingDetails } from "../../services/bookingDataSourceCompat";
import { SALON_ID } from "../../helpers/bookingSharedConstants";
import { classifySearchKey } from "../../helpers/bookingSearchUtils";
import { normalizeDigits, normalizeSearchText, phone10Digits } from "../../helpers/bookingTextUtils";
import { extractMinPriceInternal, readDisplayLabel } from "../../helpers/pageSharedUtils";
import { generateSalonTimeSlots, filterSlotsByServiceEnd } from "../../helpers/timeSlots";
import { formatTime12 } from "../../helpers/timeDisplay";
import { filterStaffForResolverTarget, resolveEmployeeKey } from "../../helpers/bookingAvailabilityUtils";
import { filterStaffSlotsByWorkingHours, isStaffOperationallyActiveForDate, isStaffAvailableForDate } from "../../helpers/staffAvailability";
import { AppSettingsService } from "../../services/AppSettingsService";
import { todayISO } from "../../helpers/bookingDateUtils";
import { getAuth } from "firebase/auth";

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
}) {
  const bookingIds = Array.isArray(args.createdBookingIds) ? args.createdBookingIds : [];
  const parentId = String(bookingIds[0] || "").trim();
  if (!parentId || !args.selectedClient || !args.cart.length) return [];

  const rowPrices = args.cart.map((service) => Math.max(0, servicePrice(service)));
  const paidParts = splitAmountByWeights(args.effectivePaidAmount, rowPrices);
  const remainingParts = splitAmountByWeights(args.remainingAmount, rowPrices);
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
  const cashParts = splitAmountByWeights(paymentBreakdown.cash, rowPrices);
  const cardParts = splitAmountByWeights(paymentBreakdown.card, rowPrices);
  const transferParts = splitAmountByWeights(paymentBreakdown.transfer, rowPrices);
  const createdAt = Date.now();

  return args.cart.map((service, index) => {
    const serviceKey = String(service.id || "");
    const schedule = (args.scheduleByService[serviceKey] || {}) as Partial<ScheduleSelection>;
    const rowId = String(bookingIds[index + 1] || parentId || `${serviceKey}_${index}`).trim();
    const total = rowPrices[index] || 0;
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

const steps = [
  { id: 1 as const, title: "العميلة", subtitle: "اختيار العميلة", icon: FiUser },
  { id: 2 as const, title: "الخدمات", subtitle: "اختيار الخدمات", icon: FiShoppingBag },
  { id: 3 as const, title: "الموظفة والموعد", subtitle: "تحديد الوقت", icon: FiUsers },
  { id: 4 as const, title: "الدفع", subtitle: "المراجعة والدفع", icon: FiCreditCard },
];

export default function BookingInternalV2() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<"new" | "manage">("new");
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
  const [allStaff, setAllStaff] = useState<StaffRow[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [scheduleByService, setScheduleByService] = useState<Record<string, ScheduleSelection>>({});
  const [availableTimes, setAvailableTimes] = useState<Record<string, string[]>>({});
  const [timesLoading, setTimesLoading] = useState<Record<string, boolean>>({});
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [appSettings, setAppSettings] = useState(() => AppSettingsService.getCached());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentType, setPaymentType] = useState<PaymentType>("full");
  const [paidAmount, setPaidAmount] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [bookingNote, setBookingNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdBookingIds, setCreatedBookingIds] = useState<string[]>([]);


  const createNewClient = useCallback(async () => {
    const name = String(newClientName || "").trim();
    const phone = phone10Digits(newClientPhone);
    const email = String(newClientEmail || "").trim();
    if (name.length < 2) { setNewClientError("اكتبي اسم العميلة كاملًا."); return; }
    if (!phone || phone.length !== 10) { setNewClientError("أدخلي رقم جوال سعودي صحيح من 10 أرقام."); return; }
    setCreatingClient(true);
    setNewClientError("");
    try {
      let created: any;
      if (getDataSourceFlags().useCoreD1) {
        created = await resolveBookingDataSource().createClient({ name, phone, email: email || undefined });
      } else {
        const ref = await addDoc(collection(db, "salons", SALON_ID, "clients"), {
          name, fullName: name, phone, mobile: phone, phoneNormalized: phone,
          email: email || null, status: "active", source: "internal_booking_v2",
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        created = { id: ref.id, name, fullName: name, phone, mobile: phone, email, source: "client_profile" };
      }
      const candidate: ClientCandidate = {
        id: String(created?.id || `client:${makeLocalId()}`),
        name: String(created?.name || created?.fullName || name),
        phone: phone10Digits(created?.phone || created?.mobile || phone),
        publicId: String(created?.publicId || created?.mk || "").trim() || undefined,
        source: String(created?.source || "client_profile"),
      };
      setSelectedClient(candidate);
      setClients((current) => [candidate, ...current.filter((row) => candidateIdentity(row) !== candidateIdentity(candidate))]);
      markQuickClientUsage(candidate);
      setShowNewClient(false);
      setNewClientName(""); setNewClientPhone(""); setNewClientEmail("");
      setClientMessage("تمت إضافة العميلة واختيارها للحجز.");
    } catch (error) {
      console.error("[BookingInternalV2] client create failed", error);
      setNewClientError("تعذر إضافة العميلة. تحققي من الاتصال ثم حاولي مرة أخرى.");
    } finally { setCreatingClient(false); }
  }, [newClientName, newClientPhone, newClientEmail]);

  const searchClients = useCallback(async (rawQuery: string) => {
    const qRaw = String(rawQuery || "").trim();
    if (!qRaw) {
      setClients(readQuickClients());
      setClientMessage("");
      return;
    }

    const parsed = classifySearchKey(qRaw);
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
      if (getDataSourceFlags().useCoreD1) {
        const rows = await resolveBookingDataSource().searchClients(qRaw);
        (Array.isArray(rows) ? rows : []).forEach((row: any) => push(row, "core_d1"));
      } else {
        const collections = [
          { ref: collection(db, "salons", SALON_ID, "clients"), source: "client_profile" },
          { ref: collection(db, "salons", SALON_ID, "users"), source: "user_profile" },
          { ref: collection(db, "users"), source: "root_user" },
        ];
        const digits = parsed.kind === "phone" ? parsed.value : phone10Digits(qRaw);
        const nameNeedle = normalizeSearchText(qRaw);

        for (const item of collections) {
          if (digits) {
            for (const field of ["phone", "mobile"]) {
              try {
                const snap = await getDocs(fsQuery(item.ref, where(field, "==", digits), limit(20)));
                snap.docs.forEach((docSnap) => push({ id: docSnap.id, ...docSnap.data() }, item.source));
              } catch { /* continue */ }
            }
          }
          if (nameNeedle) {
            for (const field of ["nameLower", "name", "fullName"]) {
              try {
                const value = field === "nameLower" ? nameNeedle : normalizeDigits(qRaw);
                const snap = await getDocs(fsQuery(item.ref, where(field, ">=", value), where(field, "<=", `${value}\uf8ff`), orderBy(field), limit(30)));
                snap.docs.forEach((docSnap) => push({ id: docSnap.id, ...docSnap.data() }, item.source));
              } catch { /* continue */ }
            }
          }
        }
      }

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

  useEffect(() => AppSettingsService.subscribe(setAppSettings), []);

  useEffect(() => {
    let cancelled = false;
    async function loadStaff() {
      setStaffLoading(true);
      try {
        const rows = await listActiveStaffAll(SALON_ID);
        if (!cancelled) setAllStaff(Array.isArray(rows) ? (rows as StaffRow[]) : []);
      } catch (error) {
        console.error("[BookingInternalV2] staff load failed", error);
        if (!cancelled) setScheduleMessage("تعذر جلب الموظفات من السيرفر.");
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    }
    void loadStaff();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSections() {
      setCatalogLoading(true);
      setCatalogMessage("");
      try {
        const rows = await listActiveSections(SALON_ID);
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
          listActiveCategoriesBySection(selectedSectionId, SALON_ID),
          listActiveServices({ sectionId: selectedSectionId }, SALON_ID),
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
  const canContinue = Boolean(selectedClient);
  const bookingConfig = appSettings?.booking || AppSettingsService.getDefaults().booking!;
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
    const end = start + Math.max(1, serviceDuration(currentService) || 30) + bufferMin;
    for (const other of cart) {
      const otherKey = String(other.id);
      if (otherKey === serviceKey) continue;
      const selected = scheduleByService[otherKey];
      if (!selected?.time || selected.staffId !== staffKey) continue;
      const otherStart = timeToMinutes(selected.time);
      const otherEnd = otherStart + Math.max(1, serviceDuration(other) || 30) + bufferMin;
      if (start < otherEnd && otherStart < end) {
        return {
          service: other,
          start: selected.time,
          end: `${String(Math.floor(otherEnd / 60)).padStart(2, "0")}:${String(otherEnd % 60).padStart(2, "0")}`,
        };
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
      if (!selected?.time || selected.staffId !== staffKey) return [];
      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) return [];
      const otherEnd = otherStart + Math.max(1, serviceDuration(other) || 30) + bufferMin;
      return [{
        serviceTitle: serviceTitle(other),
        start: selected.time,
        end: `${String(Math.floor(otherEnd / 60)).padStart(2, "0")}:${String(otherEnd % 60).padStart(2, "0")}`,
      }];
    }).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }, [cart, scheduleByService, bufferMin]);

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    cart.forEach((service) => {
      const key = String(service.id);
      const selected = scheduleByService[key];
      if (selected?.time && hasCartScheduleConflict(key, selected.staffId, selected.time)) keys.add(key);
    });
    return keys;
  }, [cart, scheduleByService, hasCartScheduleConflict]);


  const eligibleStaffByService = useMemo(() => {
    const out: Record<string, StaffRow[]> = {};
    cart.forEach((service) => {
      out[String(service.id)] = filterStaffForResolverTarget(allStaff, String(service.id), {
        kind: String(service?.kind || service?.type || "service"),
        name: serviceTitle(service),
        sectionId: String(service?.sectionId || service?.section_id || ""),
        sectionTitle: String(service?.sectionTitle || service?.sectionName || ""),
        categoryId: String(service?.categoryId || service?.category_id || ""),
        category: String(service?.category || service?.categoryName || ""),
      })
        .filter((staff: any) => staff?.showOnBooking !== false)
        .filter((staff: any) => isStaffOperationallyActiveForDate(staff, bookingDate))
        .filter((staff: any) => isStaffAvailableForDate(staff, bookingDate));
    });
    return out;
  }, [cart, allStaff, bookingDate]);

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
      const baseSlots = generateSalonTimeSlots(dayHours.start || "12:00", dayHours.end || "22:00", slotStepMin);
      const staffSlots = filterStaffSlotsByWorkingHours(staff as any, {
        dateISO: bookingDate,
        slots: baseSlots,
        fallbackOpenTime: dayHours.start || "12:00",
        fallbackCloseTime: dayHours.end || "22:00",
      });
      const duration = Math.max(1, serviceDuration(service) || 30);
      const endingOk = filterSlotsByServiceEnd(staffSlots, dayHours.end || "22:00", duration, bufferMin, 0);
      const availability = await getStaffAvailability({
        staffId: employeeId,
        employeeKey: resolveEmployeeKey({ employeeUid: String(staff?.uid || staff?.employeeUid || ""), employeeId: employeeId }),
        employeeUid: String(staff?.uid || ""),
        employeeName: staffName(staff),
        date: bookingDate,
        slotStepMin,
        bufferMin,
      });
      const taken = new Set((availability?.takenTimes || []).map((value: any) => String(value || "").trim()));
      const free = endingOk.map((slot: any) => String(slot.value24 || "").trim()).filter(Boolean).filter((time) => !taken.has(time));
      setAvailableTimes((current) => ({ ...current, [serviceKey]: free }));
    } catch (error) {
      console.error("[BookingInternalV2] availability load failed", error);
      setAvailableTimes((current) => ({ ...current, [serviceKey]: [] }));
      setScheduleMessage("تعذر جلب الأوقات المتاحة. حاولي مرة أخرى.");
    } finally {
      setTimesLoading((current) => ({ ...current, [serviceKey]: false }));
    }
  }, [bookingDate, dayHours.enabled, dayHours.start, dayHours.end, slotStepMin, bufferMin]);

  useEffect(() => {
    setScheduleByService({});
    setAvailableTimes({});
  }, [bookingDate]);

  const allScheduled = cart.length > 0 && cart.every((service) => {
    const key = String(service.id);
    const row = scheduleByService[key];
    return Boolean(row?.staffId && row?.time && !conflictKeys.has(key));
  });

  const finalTotal = cartTotal;
  const effectivePaidAmount = paymentType === "none"
    ? 0
    : paymentType === "full"
      ? finalTotal
      : Math.max(0, Number(paidAmount || 0));
  const remainingAmount = Math.max(0, finalTotal - effectivePaidAmount);
  const mixedTotal = Math.max(0, Number(cashAmount || 0)) + Math.max(0, Number(cardAmount || 0)) + Math.max(0, Number(transferAmount || 0));

  const submitBooking = useCallback(async () => {
    setSubmitError("");
    setCreatedBookingIds([]);
    if (!selectedClient) { setSubmitError("اختاري العميلة أولًا."); setStep(1); return; }
    if (!cart.length) { setSubmitError("أضيفي خدمة واحدة على الأقل."); setStep(2); return; }
    if (!allScheduled) { setSubmitError("أكملي الموظفة والوقت لجميع الخدمات بدون تعارض."); setStep(3); return; }
    if (paymentType === "partial" && (effectivePaidAmount <= 0 || effectivePaidAmount >= finalTotal)) {
      setSubmitError("قيمة العربون يجب أن تكون أكبر من صفر وأقل من إجمالي الحجز."); return;
    }
    if (paymentMethod === "mixed" && Math.abs(mixedTotal - effectivePaidAmount) > 0.01) {
      setSubmitError(`مجموع الدفع المختلط يجب أن يساوي ${effectivePaidAmount.toLocaleString("ar-SA")} ر.س.`); return;
    }

    setSubmitting(true);
    try {
      const authUser = getAuth().currentUser;
      const userId = String(authUser?.uid || "internal_staff");
      const status = paymentType === "none" ? "pending" : "confirmed";
      const total = Math.max(0, finalTotal);

      const itemRows = cart.map((service, index) => {
        const key = String(service.id);
        const schedule = scheduleByService[key];
        const itemTotal = Math.max(0, servicePrice(service));
        const proportionalPaid = total > 0
          ? Math.round((effectivePaidAmount * itemTotal / total) * 100) / 100
          : 0;
        const selectedStaff = allStaff.find((row) => staffId(row) === schedule.staffId);
        return {
          userId,
          createdBy: "staff",
          channel: "internal",
          clientName: selectedClient.name,
          clientPhone: selectedClient.phone,
          serviceName: serviceTitle(service),
          serviceId: key,
          serviceSnapshot: {
            serviceNameAtBooking: serviceTitle(service),
            priceAtBooking: itemTotal,
            durationAtBooking: serviceDuration(service) || 30,
            sectionIdAtBooking: String(service?.sectionId || selectedSectionId || "") || undefined,
            categoryIdAtBooking: String(service?.categoryId || service?.category || "") || undefined,
          },
          employeeId: schedule.staffId,
          employeeUid: String(selectedStaff?.uid || selectedStaff?.employeeUid || "") || null,
          employeeName: schedule.staffName,
          date: bookingDate,
          time: schedule.time,
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

      const created = await createBookingGroup({ parent, items: itemRows });
      const bookingId = String(created.parentId || "");

      // Core D1 separates booking creation from financial posting. Record each
      // actual payment here so income_entries, invoice totals and reports stay in sync.
      if (getDataSourceFlags().useCoreD1 && effectivePaidAmount > 0 && bookingId) {
        const dataSource = resolveBookingDataSource();
        const payments = paymentMethod === "mixed"
          ? [
              ["cash", Number(cashAmount || 0)],
              ["card", Number(cardAmount || 0)],
              ["transfer", Number(transferAmount || 0)],
            ] as const
          : [[paymentMethod, effectivePaidAmount]] as const;

        for (const [method, amount] of payments) {
          if (amount <= 0) continue;
          await dataSource.recordPayment({
            bookingId,
            method,
            amountHalalas: Math.round(amount * 100),
            status: "paid",
            paidAt: new Date().toISOString(),
            idempotencyKey: `booking-v2:${bookingId}:${method}:${Math.round(amount * 100)}`,
          });
        }

        await updateBookingDetails(bookingId, {
          paymentType,
          paidAmount: effectivePaidAmount,
          remainingAmount,
          paymentMethod,
          status,
        } as any);

      }

      setCreatedBookingIds([bookingId, ...(created.itemIds || [])].filter(Boolean));
      markQuickClientUsage(selectedClient);
    } catch (error: any) {
      console.error("[BookingInternalV2] booking submit failed", error);
      setSubmitError(`تعذر حفظ الحجز: ${String(error?.message || error || "خطأ غير معروف")}`);
    } finally {
      setSubmitting(false);
    }
  }, [selectedClient, cart, allScheduled, paymentType, paymentMethod, effectivePaidAmount, finalTotal, remainingAmount, mixedTotal, cashAmount, cardAmount, transferAmount, scheduleByService, allStaff, bookingDate, bookingNote, slotStepMin, bufferMin, selectedSectionId]);

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
  }, [
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
  ]);

  const resetCompletedBooking = useCallback(() => {
    setCart([]); setScheduleByService({}); setAvailableTimes({}); setSelectedClient(null);
    setStep(1); setPaymentMethod("cash"); setPaymentType("full"); setPaidAmount("");
    setCashAmount(""); setCardAmount(""); setTransferAmount(""); setBookingNote("");
    setCreatedBookingIds([]); setSubmitError("");
  }, []);

  return (
    <div className="bk2-page" dir="rtl">
      <header className="bk2-heading">
        <div>
          <p className="bk2-eyebrow">Queens Salon</p>
          <h1>الحجز الإداري</h1>
          <p>إنشاء حجز جديد بخطوات واضحة وسريعة.</p>
        </div>

        <div className="bk2-mode-switch" aria-label="وضع الحجز">
          <button className={mode === "new" ? "is-active" : ""} onClick={() => setMode("new")}>حجز جديد</button>
          <button className={mode === "manage" ? "is-active" : ""} onClick={() => setMode("manage")}>إدارة الحجوزات</button>
        </div>
      </header>

      {mode === "manage" ? (
        <section className="bk2-manage-card">
          <div className="bk2-empty-icon"><FiCalendar /></div>
          <h2>إدارة الحجوزات ستكون في مساحة مستقلة</h2>
          <p>البحث، التحصيل، التأكيد، الطباعة والاسترجاع ستُنقل هنا دون تغيير منطق الحجز الحالي.</p>
          <button onClick={() => navigate("/dashboard/bookings")}>فتح صفحة الحجوزات</button>
        </section>
      ) : (
        <>
          <nav className="bk2-stepper" aria-label="خطوات الحجز">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = step === item.id;
              const completed = step > item.id;
              return (
                <button
                  key={item.id}
                  className={`${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`}
                  onClick={() => setStep(item.id)}
                >
                  <span className="bk2-step-number">{completed ? "✓" : item.id}</span>
                  <span className="bk2-step-icon"><Icon /></span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  {index < steps.length - 1 ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>

          <div className="bk2-workspace">
            <main className="bk2-main-card">
              {step === 1 ? (
                <section className="bk2-client-step">
                  <div className="bk2-section-title">
                    <div>
                      <h2>البحث عن العميلة</h2>
                      <p>ابحثي بالاسم أو رقم الجوال أو رقم العضوية MK.</p>
                    </div>
                    <span><FiUser /></span>
                  </div>

                  <label className="bk2-search-box">
                    <FiSearch />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="ابحثي بالاسم أو رقم الجوال أو رقم العضوية (MK)"
                    />
                  </label>
                  {(clientSearching || clientMessage) ? (
                    <p className={`bk2-status-line ${clientSearching ? "is-loading" : ""}`}>
                      {clientSearching ? "جاري البحث في بيانات السيرفر..." : clientMessage}
                    </p>
                  ) : null}

                  <div className="bk2-recent-header">
                    <h3>{query ? "نتائج البحث" : "العميلات الأخيرات"}</h3>
                    <span>{visibleClients.length} عميلات</span>
                  </div>

                  <div className="bk2-client-grid">
                    {visibleClients.map((client) => (
                      <button
                        key={client.id}
                        className={selectedClient?.id === client.id ? "is-selected" : ""}
                        onClick={() => { setSelectedClient(client); markQuickClientUsage(client); }}
                      >
                        <span className="bk2-avatar">{client.name.slice(0, 1)}</span>
                        <span className="bk2-client-copy">
                          <strong>{client.name}</strong>
                          <small>{client.phone}</small>
                          <span className="bk2-client-badges">
                            <em>{client.visits ? `${client.visits} استخدامات` : client.publicId ? client.publicId : client.source || "عميلة"}</em>
                            {client.sessions ? <em className="is-green">{client.sessions} جلسات متبقية</em> : null}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="bk2-divider"><span>أو</span></div>

                  <button className="bk2-add-client" type="button" onClick={() => { setShowNewClient(true); setNewClientError(""); }}>
                    <FiPlus />
                    إضافة عميلة جديدة
                  </button>

                  {showNewClient ? (
                    <div className="bk2-new-client-panel">
                      <div className="bk2-new-client-head">
                        <div><strong>إضافة عميلة جديدة</strong><small>سيتم حفظها في مصدر البيانات الحالي واختيارها مباشرة.</small></div>
                        <button type="button" onClick={() => setShowNewClient(false)}>×</button>
                      </div>
                      <div className="bk2-new-client-grid">
                        <label><span>اسم العميلة *</span><input autoFocus value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="مثال: رانيا الحربي" /></label>
                        <label><span>رقم الجوال *</span><input inputMode="numeric" value={newClientPhone} onChange={(e) => setNewClientPhone(normalizeDigits(e.target.value).slice(0, 10))} placeholder="05xxxxxxxx" /></label>
                        <label className="is-wide"><span>البريد الإلكتروني (اختياري)</span><input type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} placeholder="name@example.com" /></label>
                      </div>
                      {newClientError ? <p className="bk2-inline-warning">{newClientError}</p> : null}
                      <div className="bk2-new-client-actions">
                        <button type="button" className="is-secondary" onClick={() => setShowNewClient(false)} disabled={creatingClient}>إلغاء</button>
                        <button type="button" className="is-primary" onClick={() => void createNewClient()} disabled={creatingClient}>{creatingClient ? "جاري الحفظ..." : "حفظ واختيار العميلة"}</button>
                      </div>
                    </div>
                  ) : null}

                  <div className="bk2-tip">
                    <span>i</span>
                    <div>
                      <strong>نصيحة</strong>
                      <p>استخدمي الاسم أو رقم الجوال أو رقم العضوية للوصول إلى العميلة بسرعة.</p>
                    </div>
                  </div>
                </section>
              ) : step === 2 ? (
                <section className="bk2-services-step">
                  <div className="bk2-section-title">
                    <div><h2>اختيار الخدمات</h2><p>القائمة مرتبطة الآن بكتالوج الخدمات الحقيقي.</p></div>
                    <span><FiShoppingBag /></span>
                  </div>

                  <label className="bk2-search-box">
                    <FiSearch />
                    <input value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} placeholder="ابحثي عن خدمة..." />
                  </label>

                  <div className="bk2-section-tabs">
                    {sections.map((section) => (
                      <button key={section.id} className={selectedSectionId === String(section.id) ? "is-active" : ""} onClick={() => setSelectedSectionId(String(section.id))}>
                        {catalogLabel(section, "قسم")}
                      </button>
                    ))}
                  </div>

                  {categories.length ? (
                    <div className="bk2-category-tabs">
                      <button className={!selectedCategoryId ? "is-active" : ""} onClick={() => setSelectedCategoryId("")}>الكل</button>
                      {categories.map((category) => (
                        <button key={category.id} className={selectedCategoryId === String(category.id) ? "is-active" : ""} onClick={() => setSelectedCategoryId(String(category.id))}>
                          {catalogLabel(category, "تصنيف")}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {(catalogLoading || catalogMessage) ? <p className={`bk2-status-line ${catalogLoading ? "is-loading" : ""}`}>{catalogLoading ? "جاري تحميل الخدمات..." : catalogMessage}</p> : null}

                  <div className="bk2-service-list">
                    {visibleServices.map((service) => {
                      const inCart = cart.some((item) => String(item.id) === String(service.id));
                      return (
                        <button key={service.id} className={inCart ? "is-selected" : ""} onClick={() => setCart((current) => inCart ? current.filter((item) => String(item.id) !== String(service.id)) : [...current, service])}>
                          <span className="bk2-service-copy"><strong>{serviceTitle(service)}</strong><small>{serviceDuration(service) ? `${serviceDuration(service)} دقيقة` : "المدة حسب الخدمة"}</small></span>
                          <span className="bk2-service-price">{servicePrice(service).toLocaleString("ar-SA")} ر.س</span>
                          <span className="bk2-service-add">{inCart ? "✓" : "+"}</span>
                        </button>
                      );
                    })}
                  </div>

                  {!catalogLoading && !visibleServices.length ? <div className="bk2-no-results">لا توجد خدمات مطابقة في هذا القسم.</div> : null}
                </section>
              ) : step === 3 ? (
                <section className="bk2-schedule-step">
                  <div className="bk2-section-title">
                    <div><h2>الموظفة والموعد</h2><p>الموظفات والأوقات مرتبطة الآن ببيانات الدوام والحجوزات الفعلية.</p></div>
                    <span><FiClock /></span>
                  </div>

                  <label className="bk2-date-field">
                    <span>تاريخ الحجز</span>
                    <input type="date" min={todayISO()} value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} />
                  </label>
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
                            <label>
                              <span>الموظفة</span>
                              <select value={selection?.staffId || ""} onChange={(event) => {
                                const chosen = staffRows.find((row) => staffId(row) === event.target.value);
                                setScheduleByService((current) => ({ ...current, [key]: { staffId: event.target.value, staffName: chosen ? staffName(chosen) : "", time: "" } }));
                                setAvailableTimes((current) => ({ ...current, [key]: [] }));
                                if (chosen) void loadTimesForService(service, chosen);
                              }}>
                                <option value="">اختاري الموظفة</option>
                                {staffRows.map((row) => <option key={staffId(row)} value={staffId(row)}>{staffName(row)}</option>)}
                              </select>
                            </label>
                            <div className="bk2-time-picker">
                              <span>الأوقات المتاحة</span>
                              {selection?.staffId && getBusyIntervalsForService(key, selection.staffId).length ? (
                                <div className="bk2-busy-intervals">
                                  {getBusyIntervalsForService(key, selection.staffId).map((busy) => (
                                    <p key={`${busy.serviceTitle}-${busy.start}`}>
                                      الموظفة مشغولة من <strong>{formatTime12(busy.start, busy.start)}</strong> إلى <strong>{formatTime12(busy.end, busy.end)}</strong>
                                      <span>بسبب: {busy.serviceTitle}</span>
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                              {!selection?.staffId ? <p>اختاري الموظفة أولًا.</p> : timesLoading[key] ? <p>جاري فحص المواعيد...</p> : times.length ? (
                                <div>{times.map((time) => {
                                  const conflict = getCartScheduleConflict(key, selection.staffId, time);
                                  const conflicting = Boolean(conflict);
                                  const conflictTitle = conflict
                                    ? `غير متاح: يتعارض مع ${serviceTitle(conflict.service)} من ${formatTime12(conflict.start, conflict.start)} إلى ${formatTime12(conflict.end, conflict.end)}`
                                    : "";
                                  return <button type="button" key={time} disabled={conflicting} title={conflictTitle} aria-label={conflictTitle || `اختيار ${formatTime12(time, time)}`} className={`${selection?.time === time ? "is-active" : ""} ${conflicting ? "is-conflicting" : ""}`} onClick={() => {
                                    if (conflicting) return;
                                    setScheduleByService((current) => ({ ...current, [key]: { ...current[key], time } }));
                                  }}>{formatTime12(time, time)}</button>;
                                })}</div>
                              ) : <p>لا توجد أوقات متاحة لهذه الموظفة في التاريخ المختار.</p>}
                            </div>
                          </div>
                          {conflictKeys.has(key) ? <p className="bk2-inline-warning">هذا الموعد يتعارض مع خدمة أخرى لنفس الموظفة. اختاري وقتًا مختلفًا.</p> : null}
                          {!staffRows.length && !staffLoading ? <p className="bk2-inline-warning">لا توجد موظفة مؤهلة ومتاحة لهذه الخدمة في هذا اليوم.</p> : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <section className="bk2-payment-step">
                  <div className="bk2-section-title">
                    <div><h2>المراجعة والدفع</h2><p>راجعي الحجز ثم اختاري طريقة ونوع التحصيل.</p></div>
                    <span><FiCreditCard /></span>
                  </div>

                  {createdBookingIds.length ? (
                    <div className="bk2-booking-success">
                      <strong>✓ تم حفظ الحجز بنجاح</strong>
                      <p>تم إنشاء {createdBookingIds.length} سجل حجز وربطها بالعميلة والموظفات المختارات.</p>
                      <button type="button" onClick={printCreatedBookingInvoice}>طباعة الفاتورة</button>
                      <button type="button" onClick={resetCompletedBooking}>إنشاء حجز جديد</button>
                    </div>
                  ) : (
                    <>
                      <div className="bk2-review-list">
                        {cart.map((service, index) => {
                          const schedule = scheduleByService[String(service.id)];
                          return <article key={service.id}><span>{index + 1}</span><div><strong>{serviceTitle(service)}</strong><small>{schedule?.staffName} · {bookingDate} · {formatTime12(schedule?.time, schedule?.time)}</small></div><b>{servicePrice(service).toLocaleString("ar-SA")} ر.س</b></article>;
                        })}
                      </div>

                      <div className="bk2-payment-block">
                        <h3>نوع التحصيل</h3>
                        <div className="bk2-choice-grid">
                          <button type="button" className={paymentType === "full" ? "is-active" : ""} onClick={() => setPaymentType("full")}>دفع كامل</button>
                          <button type="button" className={paymentType === "partial" ? "is-active" : ""} onClick={() => setPaymentType("partial")}>عربون</button>
                          <button type="button" className={paymentType === "none" ? "is-active" : ""} onClick={() => setPaymentType("none")}>بدون دفع الآن</button>
                        </div>
                        {paymentType === "partial" ? <label className="bk2-payment-input"><span>قيمة العربون</span><input inputMode="decimal" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" /><em>ر.س</em></label> : null}
                      </div>

                      {paymentType !== "none" ? <div className="bk2-payment-block">
                        <h3>طريقة الدفع</h3>
                        <div className="bk2-choice-grid four">
                          <button type="button" className={paymentMethod === "cash" ? "is-active" : ""} onClick={() => setPaymentMethod("cash")}>كاش</button>
                          <button type="button" className={paymentMethod === "card" ? "is-active" : ""} onClick={() => setPaymentMethod("card")}>شبكة</button>
                          <button type="button" className={paymentMethod === "transfer" ? "is-active" : ""} onClick={() => setPaymentMethod("transfer")}>تحويل</button>
                          <button type="button" className={paymentMethod === "mixed" ? "is-active" : ""} onClick={() => setPaymentMethod("mixed")}>مختلط</button>
                        </div>
                        {paymentMethod === "mixed" ? <div className="bk2-mixed-grid">
                          <label><span>كاش</span><input inputMode="decimal" value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
                          <label><span>شبكة</span><input inputMode="decimal" value={cardAmount} onChange={(e) => setCardAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
                          <label><span>تحويل</span><input inputMode="decimal" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
                          <p>المجموع: {mixedTotal.toLocaleString("ar-SA")} من {effectivePaidAmount.toLocaleString("ar-SA")} ر.س</p>
                        </div> : null}
                      </div> : null}

                      <label className="bk2-note-field"><span>ملاحظة الحجز (اختياري)</span><textarea value={bookingNote} onChange={(e) => setBookingNote(e.target.value)} placeholder="أي تفاصيل مهمة للموظفة أو الاستقبال..." /></label>
                      <div className="bk2-payment-summary"><div><span>الإجمالي</span><strong>{finalTotal.toLocaleString("ar-SA")} ر.س</strong></div><div><span>المدفوع الآن</span><strong>{effectivePaidAmount.toLocaleString("ar-SA")} ر.س</strong></div><div><span>المتبقي</span><strong>{remainingAmount.toLocaleString("ar-SA")} ر.س</strong></div></div>
                      {submitError ? <p className="bk2-inline-warning">{submitError}</p> : null}
                      <div className="bk2-final-actions"><button type="button" className="is-secondary" onClick={() => setStep(3)} disabled={submitting}>العودة للموعد</button><button type="button" className="is-primary" onClick={() => void submitBooking()} disabled={submitting}>{submitting ? "جاري حفظ الحجز..." : paymentType === "none" ? "حفظ كحجز غير مدفوع" : paymentType === "partial" ? `حفظ الحجز بعربون ${effectivePaidAmount.toLocaleString("ar-SA")} ر.س` : `حفظ الحجز وتحصيل ${effectivePaidAmount.toLocaleString("ar-SA")} ر.س`}</button></div>
                    </>
                  )}
                </section>
              )}
            </main>

            <aside className="bk2-summary-card">
              <div className="bk2-summary-title">
                <h2>ملخص الحجز</h2>
                <FiCalendar />
              </div>

              <div className={`bk2-selected-client ${selectedClient ? "has-client" : ""}`}>
                <span className="bk2-avatar">{selectedClient ? selectedClient.name.slice(0, 1) : <FiUser />}</span>
                <div>
                  <strong>{selectedClient?.name || "لم يتم اختيار عميلة بعد"}</strong>
                  <small>{selectedClient?.phone || "اختاري عميلة للمتابعة"}</small>
                </div>
              </div>

              <dl className="bk2-summary-meta">
                <div><dt><FiShoppingBag /> نوع الحجز</dt><dd>حجز داخل الصالون</dd></div>
                <div><dt><FiCalendar /> التاريخ</dt><dd>{step >= 3 ? bookingDate : "—"}</dd></div>
                <div><dt><FiUsers /> الموظفة</dt><dd>{Object.values(scheduleByService)[0]?.staffName || "—"}</dd></div>
              </dl>

              {cart.length ? (
                <div className="bk2-summary-services">
                  {cart.map((service) => {
                    const schedule = scheduleByService[String(service.id)];
                    return <div key={service.id}><span>{serviceTitle(service)}{schedule?.time ? <small>{schedule.staffName} · {formatTime12(schedule.time, schedule.time)}</small> : null}</span><strong>{servicePrice(service).toLocaleString("ar-SA")} ر.س</strong></div>;
                  })}
                </div>
              ) : (
                <div className="bk2-empty-services"><FiShoppingBag /><p>لم تتم إضافة خدمات بعد</p></div>
              )}

              <div className="bk2-totals">
                <div><span>الإجمالي الفرعي</span><strong>{cartTotal.toLocaleString("ar-SA")} ر.س</strong></div>
                <div className="is-discount"><span>الخصم</span><strong>0 ر.س</strong></div>
                <div className="is-total"><span>الإجمالي</span><strong>{cartTotal.toLocaleString("ar-SA")} ر.س</strong></div>
              </div>

              <button
                className="bk2-continue"
                disabled={step === 1 ? !canContinue : step === 2 ? !cart.length : step === 3 ? !allScheduled : step === 4}
                onClick={() => {
                  if (step === 1 && canContinue) setStep(2);
                  else if (step === 2 && cart.length) setStep(3);
                  else if (step === 3 && allScheduled) setStep(4);
                }}
              >
                {step === 1 ? "المتابعة للخدمات" : step === 2 ? "المتابعة للموظفة والموعد" : step === 3 ? "المتابعة للمراجعة والدفع" : "راجعي وأكدي الحجز أعلاه"}
                <FiChevronLeft />
              </button>

              <p className="bk2-safe-note">هذه نسخة V2 تجريبية منفصلة، ولم تستبدل نظام الحجز الحالي.</p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
