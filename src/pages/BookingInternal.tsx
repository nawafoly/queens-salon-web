import { useEffect, useMemo, useState, useRef } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import logo from "../assets/images/ssunnamed2.png";
import hairGuideImg from "../assets/images/hair-length-guide.png";

import {
  faCalendarAlt,
  faUser,
  faPhone,
  faSpinner,
  faUserTie,
  faSearch,
  faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";

import {
  generateSalonTimeSlots,
  filterSlotsByServiceEnd,
  toMinutes,
  type TimeSlot,
} from "../helpers/timeSlots";
import { formatTime12 } from "../helpers/timeDisplay";
import { isStaffAvailableForDate } from "../helpers/staffAvailability";

import { AppSettingsService } from "../services/AppSettingsService";
import Modal from "../components/Modal";

// Firestore
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  setDoc,
  limit,
  updateDoc, // ✅ NEW
} from "firebase/firestore";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../services/firebase";
import { upsertIncomeFS } from "../services/firestoreIncome";
import { writeAuditLog } from "../services/logService";

// Auth
import { getAuth, onAuthStateChanged } from "firebase/auth";

// fallback Pricing
import { pricingSections } from "./Pricing";

// Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import {
  findActiveOfferByCode,
  offerAppliesToService,
} from "../services/firestoreOffers";

// Staff
import {
  listActiveStaffBySpecialty,
  type StaffPublicWithId,
} from "../services/firestoreStaffPublic";

// Catalog
import {
  listActiveSections,
  type SectionDoc,
  type CategoryDoc,
  type ServiceDoc,
} from "../services/firestoreCatalog";

// Create booking
import { createBooking } from "../services/firestoreBookings";

// Profile loader (للعميلة لما تكون مسجلة دخول بالصفحات العامة)
// ✅ ملاحظة: intentionally unused هنا (الاستقبال)
// import { createOrLoadUserProfile } from "../services/userProfile";

// Modal
import ConfirmModal from "../components/ConfirmModal";
import "../styles/BookingInternal.css";


/* =========================
   Types
========================= */

type CartItem = {
  id: string; // local id
  serviceId: string;
  serviceName: string;
  serviceSectionId: string;
  serviceCategoryId?: string;
  serviceCategoryName?: string;

  basePrice: number;
  priceText: string;
  durationMin: number;

  employeeId: string; // staff_public doc id
  employeeUid?: string; // linkedUid
  employeeName?: string;

  date: string; // YYYY-MM-DD
  time: string; // ✅ نخزن 24h "HH:MM" (value24)
  locked?: boolean;
};

interface BookingFormData {
  name: string;
  phone: string;
  note?: string;
  items: CartItem[];
}

type AppliedOfferResult = {
  offer: FsOffer | null;
  discountAmount: number;
  finalPrice: number;
  reason?: string;
};

function extractMinPrice(priceText: string): number {
  const cleaned = priceText.replace(/[^\d\-]/g, "");
  if (!cleaned) return 0;

  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  if (!parts.length) return 0;
  return Math.min(...parts);
}

type FlatService = {
  id: string;
  sectionId: string;
  sectionTitle: string;

  categoryId?: string;
  category: string;
  name: string;

  priceText: string;
  basePrice: number;
  seasonPrice?: number;

  durationMin?: number;

  source: "firestore" | "pricing";
};

type CategoryOption = { id: string; name: string };

const SALON_ID = "main";
const DEFAULT_SERVICE_DURATION_MIN = 60;
const ALLOW_OVERTIME_MIN = 20;

// نفس منطق slotId
function safeKey(v: string) {
  return String(v || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
}

function resolveEmployeeKey(it: { employeeUid?: string; employeeId: string }) {
  const uid = String(it.employeeUid || "").trim();
  if (uid) return uid;
  return String(it.employeeId || "").trim();
}

function buildSlotId(
  salonId: string,
  employeeKey: string,
  date: string,
  time: string
) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(
    employeeKey
  )}`;
}

function buildEmployeeLookupKeys(args: {
  employeeKey?: string;
  employeeIdFallback?: string;
  employeeUidFallback?: string;
  employeeNameFallback?: string;
}) {
  const primaryKey = String(args.employeeKey || "").trim();
  const primaryId = String(args.employeeIdFallback || "").trim();
  const uid = String(args.employeeUidFallback || "").trim();
  const nameKey = safeKey(String(args.employeeNameFallback || "").trim());

  const primaryEmployeeKeyKeys = new Set<string>();
  const primaryEmployeeIdKeys = new Set<string>();
  if (primaryKey) primaryEmployeeKeyKeys.add(primaryKey);
  if (primaryId) primaryEmployeeIdKeys.add(primaryId);
  if (primaryId && primaryId !== primaryKey) primaryEmployeeKeyKeys.add(primaryId);

  const fallbackEmployeeKeyKeys = new Set<string>();
  const fallbackEmployeeIdKeys = new Set<string>();
  if (uid && !primaryEmployeeKeyKeys.has(uid)) fallbackEmployeeKeyKeys.add(uid);
  if (uid && !primaryEmployeeIdKeys.has(uid)) fallbackEmployeeIdKeys.add(uid);
  if (nameKey && !primaryEmployeeKeyKeys.has(nameKey)) fallbackEmployeeKeyKeys.add(nameKey);

  const slotKeys = Array.from(
    new Set<string>([
      ...Array.from(primaryEmployeeKeyKeys),
      ...Array.from(primaryEmployeeIdKeys),
      ...Array.from(fallbackEmployeeKeyKeys),
      ...Array.from(fallbackEmployeeIdKeys),
    ])
  );

  return {
    primaryEmployeeKeyKeys: Array.from(primaryEmployeeKeyKeys),
    primaryEmployeeIdKeys: Array.from(primaryEmployeeIdKeys),
    fallbackEmployeeKeyKeys: Array.from(fallbackEmployeeKeyKeys),
    fallbackEmployeeIdKeys: Array.from(fallbackEmployeeIdKeys),
    slotKeys,
  };
}

function getTimesToLock(
  allSlots: TimeSlot[],
  slotStepMin: number,
  startTime24: string, // ✅ "HH:MM"
  durationMin: number,
  bufferMin: number
) {
  const step = Math.max(1, Number(slotStepMin || 0));

  const totalMin =
    Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (totalMin <= 0) return [startTime24];

  const slotsToLock = Math.max(1, Math.ceil(totalMin / step));
  const startIdx = allSlots.findIndex(
    (s) => String(s.value24 || "").trim() === String(startTime24 || "").trim()
  );

  if (startIdx < 0) return [startTime24];

  const locked: string[] = [];
  for (let i = 0; i < slotsToLock; i++) {
    const slot = allSlots[startIdx + i];
    if (!slot) break;
    locked.push(slot.value24);
  }

  return locked.length ? locked : [startTime24];
}

function getGreenStartTimes(args: {
  allSlots: TimeSlot[];
  slotStepMin: number;
  durationMin: number;
  bufferMin: number;
  takenAll: Set<string>; // ✅ times 24h
}) {
  const greens = new Set<string>(); // ✅ نخزن value24

  for (const slot of args.allSlots) {
    const start24 = slot.value24;

    const needed = getTimesToLock(
      args.allSlots,
      args.slotStepMin,
      start24,
      args.durationMin,
      args.bufferMin
    );

    let ok = true;
    for (const t of needed) {
      if (args.takenAll.has(t)) {
        ok = false;
        break;
      }
    }

    if (ok) greens.add(start24);
  }

  return greens;
}

function sortTimesBySlotOrder(times: string[], allSlots: TimeSlot[]) {
  const order = new Map<string, number>();
  allSlots.forEach((s, idx) => {
    const k = String(s.value24 || "").trim();
    if (k && !order.has(k)) order.set(k, idx);
  });
  return [...times].sort(
    (a, b) =>
      (order.get(String(a || "").trim()) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(String(b || "").trim()) ?? Number.MAX_SAFE_INTEGER)
  );
}

function buildUniformReasonByStarts(starts: string[], reason: string) {
  const out: Record<string, string> = {};
  for (const t of starts) out[t] = reason;
  return out;
}

type BlockedReasonSummary = {
  from: string;
  to: string;
  reasonKey: string;
  reasonLabel: string;
  reasonDetail?: string;
  count: number;
};

const BLOCKED_TIME_TOKEN_RE = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م|a\.m\.|p\.m\.)?/g;

function normalizeBlockedReasonKey(reason: string) {
  return String(reason || "")
    .trim()
    .replace(BLOCKED_TIME_TOKEN_RE, "<time>")
    .replace(/\s+/g, " ");
}

function parseBlockedReason(reason: string) {
  const raw = String(reason || "").trim();
  if (!raw) {
    return {
      key: "unknown",
      label: "غير متاح",
      detail: "",
    };
  }

  if (raw.includes("لا يكفي")) {
    return {
      key: "end-limit",
      label: "لا يكفي الوقت لإنهاء الخدمة قبل الإغلاق.",
      detail: "",
    };
  }

  if (raw.includes("خدمة أخرى في السلة")) {
    return {
      key: "cart-conflict",
      label: "يتعارض مع خدمة أخرى في السلة.",
      detail: "",
    };
  }

  if (raw.includes("حجز/قفل فعلي")) {
    return {
      key: "booking-conflict",
      label: "يتعارض مع حجز/قفل فعلي.",
      detail: "",
    };
  }

  if (raw.includes("يتعارض عند")) {
    const meta = String(raw.split(":").slice(1).join(":") || "")
      .trim()
      .replace(/\.+$/g, "");
    return {
      key: "booking-conflict",
      label: "يتعارض مع وقت محجوز مسبقًا.",
      detail: meta,
    };
  }

  const cleaned = raw
    .replace(/\s+(?:at|عند)\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م|a\.m\.|p\.m\.)?/g, "")
    .replace(BLOCKED_TIME_TOKEN_RE, "")
    .replace(/\s+([:.,،؛])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    key: normalizeBlockedReasonKey(raw),
    label: cleaned || raw,
    detail: "",
  };
}

function formatBlockedRangeLabel(from: string, to: string) {
  const fromLabel = formatTime12(from, from);
  if (from === to) return `عند ${fromLabel}`;
  return `من ${fromLabel} إلى ${formatTime12(to, to)}`;
}

function summarizeBlockedReasons(
  entries: [string, string][],
  slotStepMin: number
): BlockedReasonSummary[] {
  const sorted = [...entries].sort((a, b) => {
    const am = toMinutes(a[0]);
    const bm = toMinutes(b[0]);
    const safeA = Number.isFinite(am) ? am : Number.MAX_SAFE_INTEGER;
    const safeB = Number.isFinite(bm) ? bm : Number.MAX_SAFE_INTEGER;
    return safeA - safeB;
  });

  const step = Math.max(1, Number(slotStepMin || 0));
  const out: BlockedReasonSummary[] = [];

  for (const [time24, reason] of sorted) {
    const minute = toMinutes(time24);
    const parsed = parseBlockedReason(reason);
    const reasonKey = parsed.key;
    const reasonLabel = parsed.label;
    const reasonDetail = parsed.detail;
    const prev = out[out.length - 1];

    if (prev) {
      const prevMin = toMinutes(prev.to);
      if (
        prev.reasonKey === reasonKey &&
        Number.isFinite(prevMin) &&
        Number.isFinite(minute) &&
        minute >= prevMin &&
        minute - prevMin <= step
      ) {
        prev.to = time24;
        prev.count += 1;
        if (!prev.reasonDetail && reasonDetail) {
          prev.reasonDetail = reasonDetail;
        } else if (
          prev.reasonDetail &&
          reasonDetail &&
          prev.reasonDetail !== reasonDetail &&
          reasonKey === "booking-conflict"
        ) {
          prev.reasonDetail = "تفاصيل متعددة.";
        }
        continue;
      }
    }

    out.push({
      from: time24,
      to: time24,
      reasonKey,
      reasonLabel,
      reasonDetail,
      count: 1,
    });
  }

  return out;
}

function calcDiscount(basePrice: number, offer: FsOffer) {
  const value = Number((offer as any).value || 0);

  if ((offer as any).discountType === "percent") {
    const percent = Math.min(100, Math.max(0, value));
    const discount = Math.round((basePrice * percent) / 100);
    return {
      discountAmount: discount,
      finalPrice: Math.max(0, basePrice - discount),
    };
  }

  const fixed = Math.max(0, value);
  const discount = Math.min(basePrice, fixed);
  return {
    discountAmount: discount,
    finalPrice: Math.max(0, basePrice - discount),
  };
}

function isOfferValidForBookingDate(offer: any, bookingDateISO: string) {
  if (!bookingDateISO) return { ok: true, reason: "" };

  const s = String(offer?.startDate || "").trim();
  const e = String(offer?.endDate || "").trim();

  if (s && bookingDateISO < s) return { ok: false, reason: `العرض يبدأ من ${s}` };
  if (e && bookingDateISO > e) return { ok: false, reason: `العرض انتهى بتاريخ ${e}` };
  return { ok: true, reason: "" };
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(startISO: string, addDays: number) {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + addDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeTimeHHMM(v: any, fallback: string) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23) return fallback;
  if (mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const ARABIC_DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function normalizeDigits(raw: string) {
  return String(raw || "").replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGIT_MAP[d] || d);
}

function normalizeSearchText(raw: string) {
  const text = normalizeDigits(String(raw || "").trim().toLowerCase())
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء");

  return text
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKsaPhone(raw: string) {
  const digits = normalizeDigits(String(raw || "")).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("9665") && digits.length === 12) return "0" + digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) return "0" + digits;
  if (digits.startsWith("05") && digits.length === 10) return digits;
  return digits;
}

function phone10Digits(raw: string) {
  return normalizeKsaPhone(raw).replace(/\D/g, "").slice(0, 10);
}

function mapBookingStatusAr(raw: any) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "confirmed") return "مؤكد";
  if (s === "pending") return "بالانتظار";
  if (s === "cancelled" || s === "canceled") return "ملغي";
  if (s === "completed") return "مكتمل";
  return String(raw || "—");
}

function bookingStatusClass(raw: any) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "confirmed") return "bk-status-confirmed";
  if (s === "pending") return "bk-status-pending";
  if (s === "cancelled" || s === "canceled") return "bk-status-cancelled";
  if (s === "completed") return "bk-status-completed";
  return "bk-status-default";
}

function mapBookingChannelAr(raw: any) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "—";
  if (s === "client") return "عميلة";
  if (s === "internal") return "استقبال";
  if (s === "dashboard") return "إدارة";
  if (s === "online") return "أونلاين";
  return String(raw);
}

type UiModalState = {
  open: boolean;
  title: string;
  message: string;
  variant: "info" | "danger" | "success";
  confirmText?: string;
};

function makeLocalId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type BusyState = {
  busyTimes: Set<string>;
  disabledStartTimes: Set<string>;
  loading: boolean;
  hint: string;
  suggestedSlot?: string;
  disabledReasonByStart: Record<string, string>;

  // ✅ تفاصيل الحجز الموجود على الوقت (يطلع في الـ UI)
  bookedMetaByTime: Record<string, string>;
};

const emptyBusyState = (): BusyState => ({
  busyTimes: new Set(),
  disabledStartTimes: new Set(),
  loading: false,
  hint: "",
  suggestedSlot: "",
  disabledReasonByStart: {},
  bookedMetaByTime: {},
});

const BookingInternal = ({ internalMode = true }: { internalMode?: boolean }) => {
  const navigate = useNavigate();
  const dateRef = useRef<HTMLInputElement>(null);

  // =========================
  // Settings (live)
  // =========================
  const [appSettings, setAppSettings] = useState<any>(
    () => AppSettingsService.getCached?.() || {}
  );
  const booking = (appSettings as any)?.booking || {};
  const seasonPricing = (appSettings as any)?.catalogSeasonPricing || {};
  const seasonCfg = seasonPricing;
  const sequentialBooking = !!(booking as any)?.sequentialBooking;

  const businessHours = (booking as any)?.businessHours || {};

  const openTime = useMemo(
    () => safeTimeHHMM((businessHours as any)?.sat?.start, "10:00"),
    [(businessHours as any)?.sat?.start]
  );

  const closeTime = useMemo(
    () => safeTimeHHMM((businessHours as any)?.sat?.end, "22:00"),
    [(businessHours as any)?.sat?.end]
  );

  const slotStepMin = useMemo(() => {
    const v = safeInt((booking as any)?.slotStepMin, 10);
    return [5, 10, 15, 30].includes(v) ? v : 10;
  }, [(booking as any)?.slotStepMin]);

  const bufferMin = useMemo(() => {
    return Math.max(0, safeInt((booking as any)?.bufferMin, 5));
  }, [(booking as any)?.bufferMin]);

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);

  useEffect(() => {
    setTimeSlots(generateSalonTimeSlots(openTime, closeTime, slotStepMin));
  }, [openTime, closeTime, slotStepMin]);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => unsub();
  }, []);

  // =========================
  // Catalog mode
  // =========================
  const [catalogMode, setCatalogMode] = useState<"firestore" | "pricing">(
    "pricing"
  );
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [fsSections, setFsSections] = useState<SectionDoc[]>([]);
  const [fsCategories, setFsCategories] = useState<CategoryDoc[]>([]);
  const [fsServices, setFsServices] = useState<ServiceDoc[]>([]);

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [servicePicker, setServicePicker] = useState<string>("");

  const [showHairGuide, setShowHairGuide] = useState(false);

  const [hairGuideUrl, setHairGuideUrl] = useState<string>(hairGuideImg);
  const [isOwner, setIsOwner] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);

  // ✅ الاستقبال يختار التاريخ أول
  const [bookingDate, setBookingDate] = useState<string>(() => todayISO());

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    note: "",
    items: [],
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [couponCode, setCouponCode] = useState("");
  const [applied, setApplied] = useState<AppliedOfferResult>({
    offer: null,
    discountAmount: 0,
    finalPrice: 0,
  });
  const [offerMsg, setOfferMsg] = useState("");
  const [manualOverride, setManualOverride] = useState(false);

  const [busyByItem, setBusyByItem] = useState<Record<string, BusyState>>({});

  // =========================
  // ✅ NEW: Future availability (للأيام القادمة)
  // =========================
  const [futureAnyStaff, setFutureAnyStaff] = useState(true);
  const [futureSelectedEmployeeKey, setFutureSelectedEmployeeKey] = useState<string>("");
  const [futureStaffNameQuery, setFutureStaffNameQuery] = useState("");
  const [futureLoading, setFutureLoading] = useState(false);
  const [futureServiceId, setFutureServiceId] = useState("");
  const [futureTargetItemId, setFutureTargetItemId] = useState("");
  const [futureResult, setFutureResult] = useState<
    { date: string; times: string[]; note?: string; contributors?: string[] }[]
  >([]);

  const [futureMsg, setFutureMsg] = useState("");
  const futureSearchRef = useRef<HTMLDivElement | null>(null);
  const autoFutureSearchKeyRef = useRef("");

  const [staffByService, setStaffByService] = useState<
    Record<string, StaffPublicWithId[]>
  >({});

  const [staffLoadingByService, setStaffLoadingByService] = useState<
    Record<string, boolean>
  >({});

  const [staffErrorByService, setStaffErrorByService] = useState<
    Record<string, string>
  >({});

  const resolvedFutureServiceId = useMemo(() => {
    const picked = String(servicePicker || "").trim();
    if (picked) return picked;
    const fixed = String(futureServiceId || "").trim();
    if (fixed) return fixed;
    const targetItem = (formData.items || []).find(
      (it) => String(it.id || "").trim() === String(futureTargetItemId || "").trim()
    );
    const fromTarget = String(targetItem?.serviceId || "").trim();
    if (fromTarget) return fromTarget;
    const fromCart = (formData.items || [])
      .map((it) => String(it?.serviceId || "").trim())
      .find(Boolean);
    return String(fromCart || "").trim();
  }, [futureServiceId, servicePicker, futureTargetItemId, formData.items]);

  useEffect(() => {
    const targetId = String(futureTargetItemId || "").trim();
    if (!targetId) return;
    const exists = (formData.items || []).some(
      (it) => String(it?.id || "").trim() === targetId
    );
    if (!exists) setFutureTargetItemId("");
  }, [futureTargetItemId, formData.items]);

  useEffect(() => {
    const sid = String(futureServiceId || "").trim();
    if (!sid) return;
    if (String(servicePicker || "").trim() === sid) return;
    const existsInCart = (formData.items || []).some(
      (it) => String(it?.serviceId || "").trim() === sid
    );
    if (!existsInCart) setFutureServiceId("");
  }, [futureServiceId, servicePicker, formData.items]);

  const [uiModal, setUiModal] = useState<UiModalState>({
    open: false,
    title: "",
    message: "",
    variant: "info",
    confirmText: "حسنًا",
  });

  const [onUiConfirm, setOnUiConfirm] = useState<null | (() => void)>(null);

  const openModal = (
    data: Omit<UiModalState, "open">,
    onConfirmAction?: () => void
  ) => {
    setOnUiConfirm(() => onConfirmAction ?? null);
    setUiModal({ open: true, ...data });
  };

  const closeModal = () => {
    setUiModal((p) => ({ ...p, open: false }));
    setOnUiConfirm(null);
  };

  // =========================
  // ✅ NEW: بحث العميلة (اسم/جوال)
  // =========================
  const [clientSearch, setClientSearch] = useState("");
  const [clientSearching, setClientSearching] = useState(false);
  const [clientSearchMsg, setClientSearchMsg] = useState("");
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);

  function toClientCandidateFromBooking(b: any) {
    const name = String(b?.clientName || b?.name || b?.fullName || "").trim();
    const phone = phone10Digits(b?.clientPhone || b?.phone || b?.mobile || "");
    if (!name && !phone) return null;

    const bid = String(b?.id || "").trim();
    const pub = String(b?.publicId || b?.trackPublicId || b?.mk || "").trim();
    return {
      id: bid ? `booking:${bid}` : `booking:${pub || makeLocalId()}`,
      name,
      fullName: name,
      phone,
      mobile: phone,
      bookingId: bid,
      publicId: pub,
      source: "booking",
    };
  }

  function applyClientSelection(found: any) {
    const name = String(found?.name || found?.fullName || "").trim();
    const phone = phone10Digits(found?.phone || found?.mobile || found?.clientPhone || "");

    setSelectedClient(found);
    setFormData((prev) => ({
      ...prev,
      name: name || prev.name,
      phone: phone || prev.phone,
    }));
  }

  async function tryFindClientByPhoneOrName(raw: string) {
    const qRaw = String(raw || "").trim();
    const parsed = classifySearchKey(qRaw);
    const qDigits = parsed.kind === "phone" ? parsed.value : "";
    const qNameNeedle = normalizeSearchText(qRaw);

    const profileCollections = [
      collection(db, "salons", SALON_ID, "clients"),
      collection(db, "salons", SALON_ID, "users"),
      collection(db, "users"),
    ];
    const out: any[] = [];
    const seen = new Set<string>();

    const toCandidate = (rawCandidate: any) => {
      const name = String(
        rawCandidate?.name || rawCandidate?.fullName || rawCandidate?.clientName || ""
      ).trim();
      const phone = phone10Digits(
        rawCandidate?.phone || rawCandidate?.mobile || rawCandidate?.clientPhone || ""
      );
      const publicId = String(
        rawCandidate?.publicId || rawCandidate?.trackPublicId || rawCandidate?.mk || ""
      ).trim();
      const bookingId = String(rawCandidate?.bookingId || rawCandidate?.id || "").trim();
      const rawId = String(rawCandidate?.id || "").trim();
      const source = String(rawCandidate?.source || "profile").trim();

      if (!name && !phone && !publicId) return null;

      const normalizedName = normalizeSearchText(name);
      const identity = phone
        ? `phone:${normalizedName}|${phone}`
        : publicId
        ? `public:${normalizeSearchText(publicId)}`
        : `name:${normalizedName}|id:${rawId || bookingId || source}`;
      if (seen.has(identity)) return null;
      seen.add(identity);

      return {
        ...rawCandidate,
        id: rawId || `${source}:${bookingId || publicId || makeLocalId()}`,
        name: name || "بدون اسم",
        fullName: name || "بدون اسم",
        phone,
        mobile: phone,
        publicId,
        bookingId,
        source,
      };
    };

    const pushCandidate = (rawCandidate: any) => {
      const c = toCandidate(rawCandidate);
      if (c) out.push(c);
    };

    const runProfileEq = async (field: string, value: string, take = 20) => {
      const val = String(value || "").trim();
      if (!val) return;
      for (const col of profileCollections) {
        try {
          const snap = await getDocs(query(col, where(field, "==", val), limit(take)));
          snap.docs.forEach((d) =>
            pushCandidate({ id: d.id, ...(d.data() as any), source: "profile" })
          );
        } catch {
          // ignore
        }
      }
    };

    const runProfilePrefix = async (field: string, prefix: string, take = 25) => {
      const val = String(prefix || "").trim();
      if (!val) return;
      for (const col of profileCollections) {
        try {
          const snap = await getDocs(
            query(
              col,
              where(field, ">=", val),
              where(field, "<=", val + "\uf8ff"),
              orderBy(field, "asc"),
              limit(take)
            )
          );
          snap.docs.forEach((d) =>
            pushCandidate({ id: d.id, ...(d.data() as any), source: "profile" })
          );
        } catch {
          // ignore
        }
      }
    };

    const runProfileContainsFallback = async (needle: string, take = 120) => {
      const val = normalizeSearchText(needle);
      if (!val) return;

      for (const col of profileCollections) {
        try {
          const snap = await getDocs(query(col, limit(take)));
          snap.docs.forEach((d) => {
            const data = d.data() as any;
            const candidateName = String(
              data?.name || data?.fullName || data?.clientName || ""
            ).trim();
            if (!candidateName) return;
            if (normalizeSearchText(candidateName).includes(val)) {
              pushCandidate({ id: d.id, ...data, source: "profile" });
            }
          });
        } catch {
          // ignore
        }
      }
    };

    if (qDigits) {
      await runProfileEq("phone", qDigits, 25);
      await runProfileEq("mobile", qDigits, 25);
    }

    if (qNameNeedle) {
      const rawName = normalizeDigits(qRaw);
      await runProfileEq("name", rawName, 20);
      await runProfileEq("fullName", rawName, 20);
      await runProfileEq("nameLower", qNameNeedle, 20);
      await runProfilePrefix("nameLower", qNameNeedle, 35);
      await runProfileContainsFallback(qNameNeedle, 120);
    }

    // Include matches that exist only on bookings
    const bookings = await searchBookingsForReception(qRaw);
    bookings.forEach((b) => {
      const c = toClientCandidateFromBooking(b);
      if (c) pushCandidate(c);
    });

    const phoneNeedle = phone10Digits(qRaw);
    const nameNeedle = normalizeSearchText(qRaw);
    const publicNeedles = (parsed.kind === "publicId" ? parsed.publicIdCandidates : [])
      .map((x) => normalizeSearchText(x))
      .filter(Boolean);

    const idNeedle = normalizeSearchText(qRaw);

    const scoreCandidate = (candidate: any) => {
      let score = 0;
      const cName = normalizeSearchText(String(candidate?.name || candidate?.fullName || ""));
      const cPhone = phone10Digits(candidate?.phone || candidate?.mobile || "");
      const cPublic = normalizeSearchText(
        String(candidate?.publicId || candidate?.bookingId || "")
      );
      const cId = normalizeSearchText(
        String(candidate?.bookingId || candidate?.id || candidate?.publicId || "")
      );

      if (phoneNeedle) {
        if (cPhone === phoneNeedle) score -= 40;
        else if (cPhone.includes(phoneNeedle)) score -= 20;
      }

      if (nameNeedle) {
        if (cName === nameNeedle) score -= 35;
        else if (cName.startsWith(nameNeedle)) score -= 25;
        else if (cName.includes(nameNeedle)) score -= 10;
      }

      if (publicNeedles.length && publicNeedles.some((n) => cPublic.includes(n))) {
        score -= 30;
      }

      if (parsed.kind === "id" && idNeedle) {
        if (cId === idNeedle) score -= 45;
        else if (cId.includes(idNeedle)) score -= 20;
      }

      return score;
    };

    const scored = out
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
      .filter((x) => x.score < 0);

    if (!scored.length) return [];

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.candidate?.name || "").localeCompare(
        String(b.candidate?.name || ""),
        "ar"
      );
    });

    return scored.map((x) => x.candidate).slice(0, 25);
  }

  const handleSearchClient = async () => {
    const q = String(clientSearch || "").trim();
    if (!q) {
      setClientSearchMsg("اكتبي اسم أو رقم جوال أو رقم حجز للبحث.");
      return;
    }

    setClientSearching(true);
    setClientSearchMsg("");
    setSelectedClient(null);
    setClientSearchResults([]);

    try {
      const found = await tryFindClientByPhoneOrName(q);

      if (!found.length) {
        setClientSearchMsg("ما لقينا بيانات مطابقة. ابحثي بالاسم أو الجوال أو رقم الحجز.");
        return;
      }

      setClientSearchResults(found);

      if (found.length === 1) {
        applyClientSelection(found[0]);
        setClientSearchMsg("تم جلب بيانات العميلة ✅");
        return;
      }

      setClientSearchMsg(`تم العثور على ${found.length} نتائج. اختاري العميلة الصحيحة من القائمة.`);
    } catch {
      setClientSearchMsg("صار خطأ أثناء البحث.");
    } finally {
      setClientSearching(false);
    }
  };

  // =========================
  // ✅ NEW: بحث الحجز الموجود (جوال / MK / bookingId)
  // =========================
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingSearching, setBookingSearching] = useState(false);
  const [bookingSearchMsg, setBookingSearchMsg] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [confirmTargetBooking, setConfirmTargetBooking] = useState<any | null>(null);
  const [confirmPaymentMethod, setConfirmPaymentMethod] = useState<"cash" | "transfer">("cash");
  const [foundBookings, setFoundBookings] = useState<any[]>([]);
  const [selectedExistingBooking, setSelectedExistingBooking] = useState<any>(null);
  const [bookingNameChoices, setBookingNameChoices] = useState<
    { key: string; name: string; phone: string; count: number }[]
  >([]);
  const [selectedBookingNameKey, setSelectedBookingNameKey] = useState("");

  const displayFoundBookings = useMemo(() => {
    if (bookingNameChoices.length > 1 && !selectedBookingNameKey) return [] as any[];
    if (!selectedBookingNameKey) return foundBookings;
    return foundBookings.filter((b) => {
      const name = String(b?.clientName || b?.name || b?.fullName || "").trim();
      return normalizeSearchText(name) === selectedBookingNameKey;
    });
  }, [foundBookings, selectedBookingNameKey, bookingNameChoices.length]);

  type ReceptionSearchKind = "empty" | "phone" | "publicId" | "name" | "id";

  function normalizeSearchKey(raw: string) {
    return normalizeDigits(String(raw || "").trim());
  }

  function classifySearchKey(q: string): {
    kind: ReceptionSearchKind;
    value: string;
    publicIdCandidates: string[];
  } {
    const s = normalizeSearchKey(q);
    if (!s) return { kind: "empty", value: "", publicIdCandidates: [] };

    // 1) phone
    const digits10 = phone10Digits(s);
    if (/^05\d{8}$/.test(digits10)) {
      return { kind: "phone", value: digits10, publicIdCandidates: [] };
    }

    // 2) MK / QS / any prefixed publicId
    const compact = s.replace(/\s+/g, "").replace(/_/g, "-");
    const prefixed = compact.match(/^([A-Za-z]{2})-?(\d{1,12})$/);
    if (prefixed) {
      const prefix = prefixed[1].toUpperCase();
      const num = prefixed[2];
      const candidates = Array.from(
        new Set<string>([
          `${prefix}-${num}`,
          `${prefix}${num}`,
          compact.toUpperCase(),
        ])
      );
      return {
        kind: "publicId",
        value: `${prefix}-${num}`,
        publicIdCandidates: candidates,
      };
    }

    if (/^(mk|qs)\b/i.test(s) || /^mk[-_ ]?/i.test(s) || /^qs[-_ ]?/i.test(s)) {
      const cleaned = compact.toUpperCase();
      const m = cleaned.match(/^([A-Z]{2})-?(\d+)$/);
      if (m) {
        const prefix = m[1];
        const num = m[2];
        return {
          kind: "publicId",
          value: `${prefix}-${num}`,
          publicIdCandidates: [`${prefix}-${num}`, `${prefix}${num}`, cleaned],
        };
      }
      return { kind: "publicId", value: cleaned, publicIdCandidates: [cleaned] };
    }

    // 3) digits only => treat as MK number
    const onlyDigits = compact.replace(/\D/g, "");
    if (onlyDigits && onlyDigits.length >= 3 && onlyDigits.length <= 12) {
      return {
        kind: "publicId",
        value: `MK-${onlyDigits}`,
        publicIdCandidates: [`MK-${onlyDigits}`, `MK${onlyDigits}`, onlyDigits],
      };
    }

    // 4) otherwise treat as name
    const hasLetters = /[A-Za-z\u0600-\u06FF]/.test(s);
    if (hasLetters) return { kind: "name", value: s.trim(), publicIdCandidates: [] };

    // 5) fallback: doc id
    return { kind: "id", value: s, publicIdCandidates: [] };
  }

  async function searchBookingsForReception(raw: string) {
    const q0 = normalizeSearchKey(raw);
    const q = classifySearchKey(q0);
    if (q.kind === "empty") return [];

    const colBookings = collection(db, "salons", SALON_ID, "bookings");
    const out: any[] = [];
    const seen = new Set<string>();

    const pushDoc = (id: string, data: any) => {
      const safeId = String(id || "").trim();
      if (!safeId || seen.has(safeId)) return;
      seen.add(safeId);
      out.push({ id: safeId, ...(data || {}) });
    };

    const appendSnapshot = (snap: any) => {
      snap.docs.forEach((d: any) => pushDoc(d.id, d.data() as any));
    };

    const runEq = async (field: string, value: string, take = 25) => {
      const v = String(value || "").trim();
      if (!v) return;
      try {
        const snap = await getDocs(query(colBookings, where(field, "==", v), limit(take)));
        appendSnapshot(snap);
      } catch {
        // ignore
      }
    };

    const runPrefix = async (field: string, prefix: string, take = 25) => {
      const p = String(prefix || "").trim();
      if (!p) return;
      try {
        const snap = await getDocs(
          query(
            colBookings,
            where(field, ">=", p),
            where(field, "<=", p + "\uf8ff"),
            orderBy(field, "asc"),
            limit(take)
          )
        );
        appendSnapshot(snap);
      } catch {
        // ignore
      }
    };

    const runRecent = async (take = 160) => {
      try {
        const snap = await getDocs(
          query(colBookings, orderBy("createdAt", "desc"), limit(take))
        );
        appendSnapshot(snap);
      } catch {
        try {
          const snap = await getDocs(query(colBookings, limit(take)));
          appendSnapshot(snap);
        } catch {
          // ignore
        }
      }
    };

    // 1) by phone
    if (q.kind === "phone") {
      await runEq("clientPhone", q.value, 40);
      await runEq("phone", q.value, 40);
    }

    // 2) by public id
    if (q.kind === "publicId") {
      for (const candidate of q.publicIdCandidates) {
        await runEq("publicId", candidate, 25);
        await runEq("trackPublicId", candidate, 25);
        await runEq("mk", candidate, 25);
      }
    }

    // 3) by name (case-insensitive, Arabic/English)
    if (q.kind === "name") {
      const nameRaw = String(q.value || "").trim();
      const nameLower = normalizeDigits(nameRaw).toLowerCase();
      const nameNeedle = normalizeSearchText(nameRaw);

      await runPrefix("clientNameLower", nameLower, 30);
      await runPrefix("nameLower", nameLower, 30);
      if (nameNeedle && nameNeedle !== nameLower) {
        await runPrefix("clientNameLower", nameNeedle, 30);
        await runPrefix("nameLower", nameNeedle, 30);
      }
      await runEq("clientName", nameRaw, 20);
      await runEq("name", nameRaw, 20);
    }

    // 4) by doc id direct (always try as fallback)
    const idCandidates = Array.from(
      new Set<string>([q.value, q0, String(raw || "").trim()].filter(Boolean))
    );
    for (const idCandidate of idCandidates) {
      try {
        const snap = await getDoc(doc(db, "salons", SALON_ID, "bookings", idCandidate));
        if (snap.exists()) pushDoc(snap.id, snap.data() as any);
      } catch {
        // ignore
      }
    }

    // 5) broad fallback (helps when lower fields are missing or casing differs)
    if (q.kind === "name" || out.length === 0) {
      await runRecent(160);

      const qName = normalizeSearchText(q0);
      const qPhone = phone10Digits(q0);
      const qPublicIds = (q.kind === "publicId" ? q.publicIdCandidates : [q0])
        .map((v) => normalizeSearchText(v))
        .filter(Boolean);

      const filtered = out.filter((b) => {
        const nameCandidate = normalizeSearchText(
          String(b?.clientName || b?.name || b?.fullName || "")
        );
        const phoneCandidate = phone10Digits(
          String(b?.clientPhone || b?.phone || b?.mobile || "")
        );
        const publicIdCandidate = normalizeSearchText(
          String(b?.publicId || b?.trackPublicId || b?.mk || "")
        );

        if (q.kind === "phone") return !!qPhone && phoneCandidate.includes(qPhone);
        if (q.kind === "publicId") {
          return qPublicIds.some((needle) => publicIdCandidate.includes(needle));
        }
        if (q.kind === "name") return !!qName && nameCandidate.includes(qName);

        return (
          (!!qPhone && phoneCandidate.includes(qPhone)) ||
          (!!qName && (nameCandidate.includes(qName) || publicIdCandidate.includes(qName)))
        );
      });

      if (filtered.length) {
        out.splice(0, out.length, ...filtered);
      }
    }

    const toEpoch = (v: any) => {
      if (!v) return 0;
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : 0;
      }
      if (typeof v?.toDate === "function") {
        const t = v.toDate();
        return t instanceof Date ? t.getTime() : 0;
      }
      if (Number.isFinite(v?.seconds)) {
        const sec = Number(v.seconds);
        const ns = Number(v.nanoseconds || 0);
        return sec * 1000 + Math.floor(ns / 1_000_000);
      }
      return 0;
    };

    out.sort((a, b) => toEpoch(b?.createdAt) - toEpoch(a?.createdAt));
    return out.slice(0, 25);
  }

  async function applyFutureTimeSelection(dateISO: string, time24: string) {
    const serviceId = String(resolvedFutureServiceId || futureServiceId || "").trim();
    if (!serviceId || !dateISO || !time24) return;

    applyBookingDate(dateISO);

    const target =
      (formData.items || []).find(
        (it) =>
          String(it.id || "").trim() === String(futureTargetItemId || "").trim() &&
          String(it.serviceId || "").trim() === serviceId
      ) ||
      (formData.items || []).find(
        (it) => String(it.serviceId || "").trim() === serviceId && !it.locked
      ) ||
      (formData.items || []).find((it) => String(it.serviceId || "").trim() === serviceId);

    if (!target) return;
    const targetItemId = String(target.id || "").trim();

    const sv = getServiceById(serviceId);
    const durationMin = Number(
      sv?.durationMin ||
      target?.durationMin ||
      DEFAULT_SERVICE_DURATION_MIN
    );

    let staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    if (!Object.prototype.hasOwnProperty.call(staffByService, serviceId)) {
      const res = await listActiveStaffBySpecialty({
        salonId: SALON_ID,
        specialty: serviceId,
      });
      staffList = (res || []) as StaffPublicWithId[];
      setStaffByService((p) => ({ ...p, [serviceId]: staffList }));
    }

    const preferredEmployeeKey = String(
      futureSelectedEmployeeKey ||
      target.employeeUid ||
      target.employeeId ||
      ""
    ).trim();

    let chosenStaff: StaffPublicWithId | null = null;

    if (!futureAnyStaff) {
      const fixedKey = String(futureSelectedEmployeeKey || "").trim();
      if (fixedKey) {
        chosenStaff =
          staffList.find((s: any) => String(s.linkedUid || s.id || "").trim() === fixedKey) ||
          staffList.find((s: any) => String(s.id || "").trim() === fixedKey) ||
          null;
      }
    } else {
      const availableStaffRaw = staffList.filter((st: any) =>
        isStaffAvailableForDate(st, dateISO, { requireShowOnBooking: true })
      );
      const availableStaff = preferredEmployeeKey
        ? [
          ...availableStaffRaw.filter(
            (st: any) =>
              String(st?.linkedUid || st?.id || "").trim() === preferredEmployeeKey ||
              String(st?.id || "").trim() === preferredEmployeeKey
          ),
          ...availableStaffRaw.filter(
            (st: any) =>
              String(st?.linkedUid || st?.id || "").trim() !== preferredEmployeeKey &&
              String(st?.id || "").trim() !== preferredEmployeeKey
          ),
        ]
        : availableStaffRaw;

      for (const st of availableStaff) {
        const empKey = String((st as any)?.linkedUid || "").trim() || String((st as any)?.id || "").trim();
        const empIdFallback = String((st as any)?.id || "").trim();
        if (!empKey) continue;
        const localTaken = targetItemId
          ? getLocalTakenTimesForItem(
            formData.items || [],
            targetItemId,
            empKey,
            dateISO,
            empIdFallback
          )
          : new Set<string>();

        const starts = await getAvailableStartsForDay({
          salonId: SALON_ID,
          employeeKey: empKey,
          employeeIdFallback: empIdFallback,
          employeeUidFallback: String((st as any)?.linkedUid || (st as any)?.uid || "").trim(),
          employeeNameFallback: String((st as any)?.name || "").trim(),
          dateISO,
          durationMin,
          take: 288,
          localTakenTimes: localTaken,
        });
        if (starts.includes(time24)) {
          chosenStaff = st;
          break;
        }
      }
    }

    if (!futureAnyStaff && chosenStaff) {
      const chosenKey =
        String((chosenStaff as any)?.linkedUid || "").trim() ||
        String((chosenStaff as any)?.id || "").trim();
      const chosenId = String((chosenStaff as any)?.id || "").trim();
      const localTaken = targetItemId
        ? getLocalTakenTimesForItem(
          formData.items || [],
          targetItemId,
          chosenKey,
          dateISO,
          chosenId
        )
        : new Set<string>();
      const starts = await getAvailableStartsForDay({
        salonId: SALON_ID,
        employeeKey: chosenKey,
        employeeIdFallback: chosenId,
        employeeUidFallback: String((chosenStaff as any)?.linkedUid || "").trim(),
        employeeNameFallback: String((chosenStaff as any)?.name || "").trim(),
        dateISO,
        durationMin,
        take: 288,
        localTakenTimes: localTaken,
      });
      if (!starts.includes(time24)) {
        chosenStaff = null;
      }
    }

    if (!chosenStaff) {
      setFutureMsg("تم تحديد اليوم والوقت. اختاري الموظفة لإكمال الخدمة.");
      updateItem(target.id, { date: dateISO, time: time24, locked: false });
      return;
    }

    updateItem(target.id, {
      date: dateISO,
      time: time24,
      employeeId: String((chosenStaff as any)?.id || "").trim(),
      employeeUid: String((chosenStaff as any)?.linkedUid || "").trim(),
      employeeName: String((chosenStaff as any)?.name || "").trim(),
      locked: false,
    });
  }

  async function runFutureAvailabilitySearch(overrides?: {
    serviceId?: string;
    anyStaff?: boolean;
    employeeKey?: string;
    employeeName?: string;
    startISO?: string;
    targetItemId?: string;
  }) {
    setFutureMsg("");
    setFutureResult([]);

    const cartItems = formData.items || [];
    const explicitTargetItemId = String(
      overrides?.targetItemId || futureTargetItemId || ""
    ).trim();
    const targetItemById = explicitTargetItemId
      ? cartItems.find((it) => String(it?.id || "").trim() === explicitTargetItemId) || null
      : null;
    const fallbackServiceIdFromCart = String(
      targetItemById?.serviceId || cartItems[0]?.serviceId || ""
    ).trim();
    const serviceId = String(
      overrides?.serviceId ?? servicePicker ?? futureServiceId ?? fallbackServiceIdFromCart ?? ""
    ).trim();
    if (!serviceId) {
      setFutureMsg("اختاري خدمة أولاً.");
      return;
    }

    if (serviceId !== String(futureServiceId || "").trim()) {
      setFutureServiceId(serviceId);
    }
    if (explicitTargetItemId && explicitTargetItemId !== String(futureTargetItemId || "").trim()) {
      setFutureTargetItemId(explicitTargetItemId);
    } else if (!explicitTargetItemId) {
      const currentTarget = (cartItems || []).find(
        (it) => String(it?.id || "").trim() === String(futureTargetItemId || "").trim()
      );
      if (
        currentTarget &&
        String(currentTarget.serviceId || "").trim() !== serviceId
      ) {
        setFutureTargetItemId("");
      }
    }

    const sv = getServiceById(serviceId);
    const itemFromCart =
      (targetItemById &&
        String(targetItemById.serviceId || "").trim() === serviceId
        ? targetItemById
        : null) ||
      cartItems.find((it) => String(it?.serviceId || "").trim() === serviceId) ||
      null;
    const targetItemId = String(
      overrides?.targetItemId ||
      ((targetItemById &&
        String(targetItemById.serviceId || "").trim() === serviceId)
        ? targetItemById.id
        : "") ||
      itemFromCart?.id ||
      ""
    ).trim();

    const durationMin = Number(
      sv?.durationMin ||
      itemFromCart?.durationMin ||
      DEFAULT_SERVICE_DURATION_MIN
    );
    if (!durationMin || durationMin <= 0) {
      setFutureMsg("مدة الخدمة غير صحيحة.");
      return;
    }

    let staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    const hasStaffCache = Object.prototype.hasOwnProperty.call(staffByService, serviceId);
    if (!hasStaffCache) {
      const res = await listActiveStaffBySpecialty({
        salonId: SALON_ID,
        specialty: serviceId,
      });

      staffList = (res || []).filter((st: any) => {
        const name = String(st?.name || "").trim();
        if (!name) return false;
        const specs = Array.isArray(st?.specialties)
          ? st.specialties.map((x: any) => String(x || "").trim()).filter(Boolean)
          : [];
        return specs.includes(serviceId);
      }) as any;

      setStaffByService((p) => ({ ...p, [serviceId]: staffList }));
    }

    const anyStaff =
      typeof overrides?.anyStaff === "boolean" ? overrides.anyStaff : futureAnyStaff;
    const desiredEmployeeName = String(
      overrides?.employeeName ?? futureStaffNameQuery ?? ""
    ).trim();
    let fixedEmployeeKey = String(
      overrides?.employeeKey || futureSelectedEmployeeKey || ""
    ).trim();
    if (!fixedEmployeeKey && !anyStaff && desiredEmployeeName) {
      const lowerName = desiredEmployeeName.toLowerCase();
      const hit = staffList.find(
        (s: any) => String(s?.name || "").trim().toLowerCase() === lowerName
      );
      fixedEmployeeKey = String((hit as any)?.linkedUid || (hit as any)?.uid || hit?.id || "").trim();
    }
    if (!anyStaff && !fixedEmployeeKey) {
      setFutureMsg("اختاري موظفة محددة أو اختاري (أي موظفة للخدمة).");
      return;
    }

    const startISO = String(overrides?.startISO || bookingDate || "").trim() || todayISO();
    const scanDays = 60;

    setFutureLoading(true);
    try {
      const results: { date: string; times: string[]; note?: string; contributors?: string[] }[] = [];
      const baseSlots =
        timeSlots.length > 0
          ? timeSlots
          : generateSalonTimeSlots(openTime, closeTime, slotStepMin);

      for (let i = 0; i < scanDays; i++) {
        const dateISO = addDaysISO(startISO, i);
        let dayTimes: string[] = [];
        let dayNote = "";

        if (!anyStaff && fixedEmployeeKey) {
          const staff =
            staffList.find((s: any) => String(s.linkedUid || s.id || "") === fixedEmployeeKey) ||
            staffList.find((s: any) => String(s.id || "") === fixedEmployeeKey);
          const employeeIdFallback = String(staff?.id || "").trim();
          const fixedName = String((staff as any)?.name || "").trim();
          const fixedAvailable = staff
            ? isStaffAvailableForDate(staff as any, dateISO, { requireShowOnBooking: true })
            : false;

          if (!fixedAvailable) {
            dayTimes = [];
            dayNote = "";
          } else {
            const localTaken = targetItemId
              ? getLocalTakenTimesForItem(
                formData.items || [],
                targetItemId,
                fixedEmployeeKey,
                dateISO,
                employeeIdFallback
              )
              : new Set<string>();
            dayTimes = await getAvailableStartsForDay({
              salonId: SALON_ID,
              employeeKey: fixedEmployeeKey,
              employeeIdFallback,
              employeeUidFallback: String((staff as any)?.linkedUid || (staff as any)?.uid || "").trim(),
              employeeNameFallback: fixedName,
              dateISO,
              durationMin,
              take: 5,
              localTakenTimes: localTaken,
            });

            if (dayTimes.length && fixedName) {
              dayNote = `المتاح لدى: ${fixedName}`;
            }
          }
          const fixedContributors = fixedName ? [fixedName] : [];
          if (dayTimes.length) {
            results.push({ date: dateISO, times: dayTimes, note: dayNote, contributors: fixedContributors });
            if (results.length >= 5) break;
          }
        } else {
          const merged = new Set<string>();
          const timeToStaff = new Map<string, Set<string>>();
          const availableStaff = staffList.filter((st) =>
            isStaffAvailableForDate(st as any, dateISO, { requireShowOnBooking: true })
          );
          for (const st of availableStaff) {
            const empKey = String((st as any)?.linkedUid || "").trim() || String((st as any)?.id || "").trim();
            const empIdFallback = String((st as any)?.id || "").trim();
            if (!empKey) continue;
            const localTaken = targetItemId
              ? getLocalTakenTimesForItem(
                formData.items || [],
                targetItemId,
                empKey,
                dateISO,
                empIdFallback
              )
              : new Set<string>();

            const times = await getAvailableStartsForDay({
              salonId: SALON_ID,
              employeeKey: empKey,
              employeeIdFallback: empIdFallback,
              employeeUidFallback: String((st as any)?.linkedUid || (st as any)?.uid || "").trim(),
              employeeNameFallback: String((st as any)?.name || "").trim(),
              dateISO,
              durationMin,
              take: 5,
              localTakenTimes: localTaken,
            });
            if (times.length) {
              const stName = String((st as any)?.name || "").trim();
              times.forEach((t) => {
                merged.add(t);
                if (!stName) return;
                const owners = timeToStaff.get(t) || new Set<string>();
                owners.add(stName);
                timeToStaff.set(t, owners);
              });
            }
          }

          dayTimes = sortTimesBySlotOrder(Array.from(merged.values()), baseSlots).slice(0, 5);

          if (dayTimes.length) {
            const visibleContributors = new Set<string>();
            dayTimes.forEach((t) => {
              const owners = timeToStaff.get(t);
              if (!owners) return;
              owners.forEach((name) => visibleContributors.add(name));
            });
            if (visibleContributors.size) {
              dayNote = `المتاح لدى: ${Array.from(visibleContributors).slice(0, 3).join("، ")}`;
            }
            results.push({
              date: dateISO,
              times: dayTimes,
              note: dayNote,
              contributors: Array.from(visibleContributors),
            });
            if (results.length >= 5) break;
          }
        }
      }

      if (!results.length) {
        setFutureMsg("ما لقينا أوقات متاحة ضمن الفترة.");
        return;
      }

      setFutureResult(results);
    } catch (e: any) {
      setFutureMsg(`صار خطأ أثناء البحث: ${String(e?.message || e)}`);
    } finally {
      setFutureLoading(false);
    }
  }

  const handleSearchBooking = async () => {
    const q = String(bookingSearch || "").trim();
    if (!q) {
      setBookingSearchMsg("اكتب اسم أو رقم جوال أو رقم الحجز (MK) أو رقم الوثيقة.");
      return;
    }

    setBookingSearching(true);
    setBookingSearchMsg("");
    setFoundBookings([]);
    setSelectedExistingBooking(null);
    setBookingNameChoices([]);
    setSelectedBookingNameKey("");

    try {
      const res = await searchBookingsForReception(q);
      if (!res.length) {
        setBookingSearchMsg("ما لقينا حجوزات مطابقة.");
        return;
      }
      const queryKind = classifySearchKey(q).kind;
      const nameChoicesMap = new Map<string, { key: string; name: string; phone: string; count: number }>();
      res.forEach((b: any) => {
        const rawName = String(b?.clientName || b?.name || b?.fullName || "").trim();
        const key = normalizeSearchText(rawName);
        if (!key) return;
        const phone = phone10Digits(String(b?.clientPhone || b?.phone || b?.mobile || ""));
        const prev = nameChoicesMap.get(key);
        if (!prev) {
          nameChoicesMap.set(key, {
            key,
            name: rawName || "بدون اسم",
            phone,
            count: 1,
          });
          return;
        }
        prev.count += 1;
      });

      const nameChoices = Array.from(nameChoicesMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "ar");
      });

      setFoundBookings(res);

      if (queryKind === "name" && nameChoices.length > 1) {
        setBookingNameChoices(nameChoices);
        setSelectedBookingNameKey("");
        setBookingSearchMsg(
          `تم العثور على ${res.length} حجز لنفس البحث. اختاري الاسم الصحيح من القائمة.`
        );
      } else {
        setBookingNameChoices([]);
        setSelectedBookingNameKey("");
        setBookingSearchMsg(`تم العثور على ${res.length} حجز ✅`);
      }
    } catch {
      setBookingSearchMsg("صار خطأ أثناء البحث عن الحجز.");
    } finally {
      setBookingSearching(false);
    }
  };

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function openConfirmAndPrintModal(b: any) {
    setConfirmTargetBooking(b || null);
    setConfirmPaymentMethod("cash");
    setPaymentModalOpen(true);
  }

  async function confirmAndPrintExistingBooking() {
    const b = confirmTargetBooking;
    const id = String(b?.id || "").trim();
    if (!id) return;

    const authNow = getAuth();
    const staffUid = authNow.currentUser?.uid || "";
    if (!staffUid) {
      openModal({
        title: "تسجيل دخول الموظف مطلوب",
        message: "لازم موظفة الاستقبال/الإدارة تكون مسجلة دخول.",
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    setIsLoading(true);
    try {
      const now = Date.now();
      const amount = Number(b?.finalPrice ?? b?.total ?? 0) || 0;

      await updateDoc(doc(db, "salons", SALON_ID, "bookings", id), {
        status: "completed",
        confirmedAt: now,
        confirmedByUid: staffUid,
        completedAt: now,
        completedByUid: staffUid,
        paidAt: now,
        paidByUid: staffUid,
        paymentMethod: confirmPaymentMethod,
        invoiceIssuedAt: now,
        channel: b?.channel || b?.source || "online",
      } as any);

      await upsertIncomeFS(
        {
          id,
          date: todayISO(),
          amount,
          method: confirmPaymentMethod,
          source: "invoice",
          bookingId: id,
          note: `invoice_from_reception:${String(confirmPaymentMethod)}`,
          createdAt: now,
        } as any,
        SALON_ID
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "booking_completed",
        entityType: "booking",
        entityId: id,
        description: "تم تأكيد الحجز وإصدار الفاتورة من الاستقبال",
        source: "internal_booking",
        after: {
          status: "completed",
          paymentMethod: confirmPaymentMethod,
          amount,
          paidAt: now,
          invoiceIssuedAt: now,
        },
        meta: {
          bookingId: id,
          paymentMethod: confirmPaymentMethod,
          amount,
        },
      });

      const refreshed = {
        ...b,
        status: "completed",
        paymentMethod: confirmPaymentMethod,
        paidAt: now,
      };

      localStorage.setItem("currentBooking", JSON.stringify(refreshed));
      localStorage.setItem("allBookings", JSON.stringify([refreshed]));
      setPaymentModalOpen(false);
      setConfirmTargetBooking(null);
      navigate("/success-internal");
    } catch (e: any) {
      openModal({
        title: "تعذر إصدار الفاتورة",
        message:
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "تمام",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function printExistingBooking(b: any) {
    localStorage.setItem("currentBooking", JSON.stringify(b));
    localStorage.setItem("allBookings", JSON.stringify([b]));
    navigate("/success-internal");
  }

  // =========================
  // Helper: تعارض داخل السلة
  // =========================
  function getLocalTakenTimesForItem(
    items: CartItem[],
    currentItemId: string,
    employeeKey: string,
    date: string,
    employeeIdFallback?: string
  ) {
    const taken = new Set<string>();
    const targetKey = String(employeeKey || "").trim();
    const targetEmployeeId = String(employeeIdFallback || "").trim();

    for (const other of items) {
      if (!other) continue;
      if (other.id === currentItemId) continue;

      const otherKey = resolveEmployeeKey(other);
      const otherEmployeeId = String(other.employeeId || "").trim();
      const d = String(other.date || "").trim();
      const t = String(other.time || "").trim();

      if ((!otherKey && !otherEmployeeId) || !d || !t) continue;
      const sameByKey = !!targetKey && otherKey === targetKey;
      const sameByEmployeeId = !!targetEmployeeId && otherEmployeeId === targetEmployeeId;
      const crossKeyMatch =
        (!!targetEmployeeId && otherKey === targetEmployeeId) ||
        (!!targetKey && otherEmployeeId === targetKey);
      if (!sameByKey && !sameByEmployeeId && !crossKeyMatch) continue;
      if (d !== date) continue;

      const dur = Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN);
      const locked = getTimesToLock(timeSlots, slotStepMin, t, dur, bufferMin);
      locked.forEach((x) => taken.add(x));
    }

    return taken;
  }

  function isCartItemStaffAvailable(it: CartItem) {
    const date = String(it?.date || "").trim();
    if (!date) return true;

    const serviceId = String(it?.serviceId || "").trim();
    if (!serviceId) return true;

    const staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    if (!staffList.length) return true;

    const empId = String(it?.employeeId || "").trim();
    const empUid = String(it?.employeeUid || "").trim();
    const empKey = resolveEmployeeKey(it);

    const staff =
      staffList.find((st: any) => String(st?.id || "").trim() === empId) ||
      (empUid
        ? staffList.find((st: any) => String(st?.linkedUid || st?.uid || "").trim() === empUid)
        : null) ||
      staffList.find((st: any) => String(st?.linkedUid || st?.id || "").trim() === empKey) ||
      null;

    if (!staff) return true;
    return isStaffAvailableForDate(staff as any, date, { requireShowOnBooking: true });
  }

  // =========================
  // Season enabled
  // =========================
  function isDateInRange(dateISO: string, startISO: string, endISO: string) {
    if (!dateISO) return false;
    if (startISO && dateISO < startISO) return false;
    if (endISO && dateISO > endISO) return false;
    return true;
  }

  function isSeasonEnabledForDate(appSettings: any, dateISO: string) {
    const season = (appSettings as any)?.catalogSeasonPricing || {};
    const enabled = !!season.enabled;

    const start = String(season.startDate || season.from || "").trim();
    const end = String(season.endDate || season.to || "").trim();

    if (!enabled) return { ok: false, start, end };
    if (!start && !end) return { ok: true, start, end };

    return { ok: isDateInRange(dateISO, start, end), start, end };
  }

  function pickEffectivePrice(args: {
    basePrice: number;
    seasonPrice?: number;
    appSettings: any;
    dateISO: string;
  }) {
    const base = Math.max(0, Number(args.basePrice || 0));
    const season = Math.max(0, Number(args.seasonPrice || 0));

    const seasonState = isSeasonEnabledForDate(args.appSettings, args.dateISO);
    const seasonActive = seasonState.ok;

    if (seasonActive && season > 0) {
      return { price: season, label: "سعر موسم ✅", usedSeason: true };
    }

    return {
      price: base,
      label: seasonActive ? "سعر عادي (لا يوجد سعر موسم)" : "سعر عادي",
      usedSeason: false,
    };
  }

  function findCartOverlap(items: CartItem[]) {
    const list = (items || []).map((x) => ({ ...x }));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];

        const empA = resolveEmployeeKey(a);
        const empB = resolveEmployeeKey(b);
        const dateA = String(a.date || "").trim();
        const dateB = String(b.date || "").trim();
        const timeA = String(a.time || "").trim();
        const timeB = String(b.time || "").trim();

        if (!empA || !empB || !dateA || !dateB || !timeA || !timeB) continue;
        if (empA !== empB) continue;
        if (dateA !== dateB) continue;

        const aLocked = new Set(
          getTimesToLock(
            timeSlots,
            slotStepMin,
            timeA,
            Number(a.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin
          )
        );
        const bLocked = new Set(
          getTimesToLock(
            timeSlots,
            slotStepMin,
            timeB,
            Number(b.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin
          )
        );

        let overlap = false;
        for (const t of aLocked) {
          if (bLocked.has(t)) {
            overlap = true;
            break;
          }
        }

        if (overlap) return { ok: false as const, a, b };
      }
    }
    return { ok: true as const, a: null as any, b: null as any };
  }

  // =========================
  // Use local hair guide image + role
  // =========================
  useEffect(() => {
    let cancelled = false;
    setHairGuideUrl(hairGuideImg);

    const auth = getAuth();
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u || (u as any).isAnonymous) {
          if (!cancelled) setIsOwner(false);
          return;
        }

        const userRef = doc(db, "salons", SALON_ID, "users", u.uid);
        const userSnap = await getDoc(userRef);
        const role = String((userSnap.data() as any)?.role || "").toLowerCase();

        if (!cancelled) setIsOwner(role === "owner" || role === "admin");
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, []);

  async function uploadHairGuide(file: File) {
    setUploadingGuide(true);
    try {
      const path = `salons/${SALON_ID}/booking/hair-guide_${Date.now()}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);

      const url = await getDownloadURL(storageRef);

      const guideRef = doc(db, "salons", SALON_ID, "settings", "booking");
      await setDoc(guideRef, { hairGuideUrl: url }, { merge: true });

      setHairGuideUrl(url);

      openModal({
        title: "تم ✅",
        message: "تم رفع صورة دليل أطوال الشعر وتحديثها.",
        variant: "success",
        confirmText: "تمام",
      });
    } catch (e: any) {
      openModal({
        title: "فشل الرفع",
        message:
          `صار خطأ أثناء رفع الصورة\n\n` +
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    } finally {
      setUploadingGuide(false);
    }
  }

  // =========================
  // Load sections
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadSectionsFirstTime() {
      try {
        setCatalogLoading(true);
        const secs = await listActiveSections(SALON_ID);
        if (cancelled) return;

        if (secs && secs.length > 0) {
          setCatalogMode("firestore");
          setFsSections(secs);
        } else {
          setCatalogMode("pricing");
          setFsSections([]);
        }
      } catch {
        if (!cancelled) {
          setCatalogMode("pricing");
          setFsSections([]);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }

    loadSectionsFirstTime();
    return () => {
      cancelled = true;
    };
  }, []);

  // =========================
  // Load cats + services for section (Firestore)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadCatalogForSection() {
      if (catalogMode !== "firestore") return;

      if (!selectedSectionId) {
        setFsCategories([]);
        setFsServices([]);
        return;
      }

      try {
        setCatalogLoading(true);

        const catsCol = collection(db, "salons", SALON_ID, "service_categories");

        let catsSnap;
        try {
          catsSnap = await getDocs(
            query(
              catsCol,
              where("sectionId", "==", selectedSectionId),
              orderBy("order", "asc")
            )
          );
        } catch {
          catsSnap = await getDocs(
            query(catsCol, where("sectionId", "==", selectedSectionId))
          );
        }

        if (cancelled) return;

        const safeCats: any[] = catsSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((c) => String(c?.الاسم ?? c?.name ?? "").trim())
          .filter((c) => c?.active !== false);

        setFsCategories(safeCats as any);

        const catIds = safeCats
          .map((c: any) => String(c.categoryId ?? c.key ?? c.id ?? "").trim())
          .filter(Boolean);

        const colRef = collection(db, "salons", SALON_ID, "services");

        if (catIds.length === 0) {
          const snap = await getDocs(
            query(colRef, where("sectionId", "==", selectedSectionId))
          );
          if (cancelled) return;

          const merged = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          const activeOnly = merged.filter((x) => x?.active !== false);

          setFsServices(activeOnly);
          return;
        }

        const chunks: string[][] = [];
        for (let i = 0; i < catIds.length; i += 10) chunks.push(catIds.slice(i, i + 10));

        const snaps = await Promise.all(
          chunks.map((arr) => getDocs(query(colRef, where("categoryId", "in", arr))))
        );

        const secSnap = await getDocs(
          query(colRef, where("sectionId", "==", selectedSectionId))
        );
        if (cancelled) return;

        const merged: any[] = [];
        snaps.forEach((sn) =>
          sn.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }))
        );
        secSnap.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));

        const uniq = new Map<string, any>();
        merged.forEach((x) => uniq.set(String(x.id), x));
        const activeOnly = Array.from(uniq.values()).filter((x) => x?.active !== false);

        setFsServices(activeOnly);
      } catch {
        if (!cancelled) {
          setFsCategories([]);
          setFsServices([]);
          setCatalogMode("pricing");
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }

    loadCatalogForSection();
    return () => {
      cancelled = true;
    };
  }, [catalogMode, selectedSectionId]);

  // =========================
  // FS services filtered
  // =========================
  const fsServicesFiltered = useMemo(() => {
    if (catalogMode !== "firestore") return [];
    if (!selectedSectionId) return [];

    const sid = String(selectedSectionId || "").trim();
    const cid = String(selectedCategory || "").trim();

    if (!fsCategories.length) {
      const base = fsServices.filter((s: any) => String(s.sectionId || "").trim() === sid);
      if (!cid) return base;

      return base.filter((s: any) => {
        const catName = String(s.category ?? s.categoryName ?? s.التصنيف ?? "").trim();
        return catName === cid;
      });
    }

    const catIdsInSection = new Set(
      fsCategories
        .filter((c: any) => String(c.sectionId || "").trim() === sid)
        .map((c: any) => String(c.id || "").trim())
        .filter(Boolean)
    );

    return fsServices.filter((s: any) => {
      const catId = String(s.categoryId || "").trim();
      if (!catIdsInSection.has(catId)) return false;
      if (!cid) return true;
      return catId === cid;
    });
  }, [catalogMode, fsServices, fsCategories, selectedSectionId, selectedCategory]);

  // =========================
  // One source services list
  // =========================
  const HAIR_SECTION_IDS = new Set(["hair", "الشعر", "hair_section", "قص", "قص_شعر"]);

  const servicesFlat: FlatService[] = useMemo(() => {
    if (catalogMode === "firestore" && fsSections.length > 0) {
      const secMap = new Map<string, string>();
      fsSections.forEach((s: any) =>
        secMap.set(String(s.id), String((s as any).الاسم ?? (s as any).name ?? ""))
      );

      const catMap = new Map<string, string>();
      fsCategories.forEach((c: any) =>
        catMap.set(String(c.id), String((c as any).الاسم ?? (c as any).name ?? ""))
      );

      const catById = new Map<string, any>();
      fsCategories.forEach((c: any) => catById.set(String(c.id), c));

      const hasCats = fsCategories.length > 0;

      const list = (selectedSectionId ? fsServicesFiltered : []).map((x: any) => {
        if (!hasCats) {
          const sectionId = String(x.sectionId || selectedSectionId || "").trim();
          const sectionTitle = secMap.get(sectionId) || sectionId || "—";

          const catName = String(x.category ?? x.categoryName ?? x.التصنيف ?? "عام").trim() || "عام";
          const name = String(x.الاسم ?? x.name ?? "").trim();
          const priceNum = Number(x.السعر ?? x.price ?? 0);

          const seasonPriceRaw =
            (x as any).seasonPrice ??
            (x as any).سعر_الموسم ??
            (x as any).season_price ??
            (x as any).seasonPriceValue ??
            0;

          const seasonPriceNum = Number(String(seasonPriceRaw).replace(/[^\d.]/g, "")) || 0;
          const seasonPrice = seasonPriceNum > 0 ? seasonPriceNum : undefined;

          const durationMin = Number(x.المدة ?? x.durationMin ?? DEFAULT_SERVICE_DURATION_MIN);

          return {
            id: String(x.id),
            sectionId,
            sectionTitle,
            categoryId: "",
            category: catName,
            name,
            priceText: `${priceNum} ريال`,
            basePrice: priceNum,
            seasonPrice,
            durationMin,
            source: "firestore" as const,
          };
        }

        const catId = String(x.categoryId || "").trim();
        const catDoc = catById.get(catId);

        const sectionId = String(catDoc?.sectionId || "").trim();
        const sectionTitle = secMap.get(sectionId) || sectionId || "—";

        const catName = catId ? catMap.get(catId) || "عام" : "عام";
        const name = String(x.الاسم ?? x.name ?? "").trim();
        const priceNum = Number(x.السعر ?? x.price ?? 0);

        const seasonPriceRaw =
          (x as any).seasonPrice ??
          (x as any).سعر_الموسم ??
          (x as any).season_price ??
          (x as any).seasonPriceValue ??
          0;

        const seasonPriceNum = Number(String(seasonPriceRaw).replace(/[^\d.]/g, "")) || 0;
        const seasonPrice = seasonPriceNum > 0 ? seasonPriceNum : undefined;

        const durationMin = Number(x.المدة ?? x.durationMin ?? DEFAULT_SERVICE_DURATION_MIN);

        return {
          id: String(x.id),
          sectionId,
          sectionTitle,
          categoryId: catId,
          category: String(catName || "عام"),
          name,
          priceText: `${priceNum} ريال`,
          basePrice: priceNum,
          seasonPrice,
          durationMin,
          source: "firestore" as const,
        };
      });

      return list;
    }

    const out: FlatService[] = [];
    Object.entries(pricingSections).forEach(([sectionId, section]) => {
      section.services.forEach((cat, catIdx) => {
        cat.items.forEach((it, itemIdx) => {
          const id = `${sectionId}-${catIdx}-${itemIdx}`;
          const basePrice = extractMinPrice(it.price);

          out.push({
            id,
            sectionId,
            sectionTitle: section.title,
            categoryId: "",
            category: cat.category,
            name: `${cat.category} - ${it.name}`,
            priceText: it.price,
            basePrice,
            durationMin: DEFAULT_SERVICE_DURATION_MIN,
            source: "pricing",
          });
        });
      });
    });

    return out;
  }, [catalogMode, fsSections, fsCategories, fsServicesFiltered, selectedSectionId]);

  const sectionOptions = useMemo(() => {
    if (catalogMode === "firestore" && fsSections.length > 0) {
      return fsSections.map((s: any) => ({
        id: String(s.id),
        title: String((s as any).الاسم ?? (s as any).name ?? ""),
      }));
    }

    return Object.entries(pricingSections).map(([id, sec]) => ({ id, title: sec.title }));
  }, [catalogMode, fsSections]);

  const categoryOptions: CategoryOption[] = useMemo(() => {
    if (!selectedSectionId) return [];

    if (catalogMode === "firestore" && fsSections.length > 0) {
      if (fsCategories.length) {
        const sid = String(selectedSectionId).trim();

        const cats = fsCategories
          .filter((c: any) => String(c.sectionId || "").trim() === sid)
          .map((c: any) => ({ id: String(c.id), name: String(c.الاسم ?? c.name ?? "").trim() }))
          .filter((x) => x.id && x.name);

        const seen = new Set<string>();
        return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
      }

      const sid = String(selectedSectionId).trim();
      const base = fsServices
        .filter((s: any) => String(s.sectionId || "").trim() === sid)
        .map((s: any) => String(s.category ?? s.categoryName ?? s.التصنيف ?? "عام").trim())
        .filter(Boolean);

      const seen = new Set<string>();
      return base
        .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
        .map((n) => ({ id: n, name: n }));
    }

    const cats = servicesFlat
      .filter((s) => s.sectionId === selectedSectionId)
      .map((s) => ({ id: s.category, name: s.category }))
      .filter((x) => x.id && x.name);

    const seen = new Set<string>();
    return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }, [catalogMode, fsSections.length, fsCategories, fsServices, servicesFlat, selectedSectionId]);

  const servicesInSection = useMemo(() => {
    if (!selectedSectionId) return [];

    const sid = String(selectedSectionId || "").trim();
    const sel = String(selectedCategory || "").trim();

    const all = servicesFlat.filter((s) => String(s.sectionId || "").trim() === sid);
    if (!sel) return all;

    if (catalogMode === "firestore") {
      const hasCats = fsCategories.length > 0;
      if (hasCats) return all.filter((s) => String(s.categoryId || "").trim() === sel);
      return all.filter((s) => String(s.category || "").trim() === sel);
    }

    return all.filter((s) => String(s.category || "").trim() === sel);
  }, [servicesFlat, selectedSectionId, selectedCategory, catalogMode, fsCategories.length]);

  const servicesGrouped = useMemo(() => {
    const map = new Map<string, FlatService[]>();
    servicesInSection.forEach((sv) => {
      const arr = map.get(sv.category) || [];
      arr.push(sv);
      map.set(sv.category, arr);
    });
    return Array.from(map.entries());
  }, [servicesInSection]);

  function servicePickerPriceText(sv: FlatService) {
    const dateISO = String(bookingDate || "").trim();
    if (!dateISO) return sv.priceText;

    const eff = pickEffectivePrice({
      basePrice: Number(sv.basePrice || 0),
      seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
      appSettings,
      dateISO,
    });

    const price = Number(eff.price || 0);
    return `${price} ريال`;
  }

  const isHairSection = useMemo(() => {
    const id = String(selectedSectionId || "").trim().toLowerCase();
    if (HAIR_SECTION_IDS.has(id)) return true;

    const sec = sectionOptions.find((s) => String(s.id) === String(selectedSectionId));
    const title = String(sec?.title || "").toLowerCase();

    return (
      title.includes("شعر") ||
      title.includes("hair") ||
      title.includes("صبغ") ||
      title.includes("استشوار") ||
      title.includes("تساريح")
    );
  }, [selectedSectionId, sectionOptions]);

  const futureStaffOptions = useMemo(() => {
    const sid = String(resolvedFutureServiceId || "").trim();
    if (!sid) return [] as { key: string; name: string }[];

    const base = (staffByService[sid] || []) as StaffPublicWithId[];
    const seen = new Set<string>();

    return base
      .map((st: any) => {
        const key = String(st?.linkedUid || st?.uid || st?.id || "").trim();
        const name = String(st?.name || st?.displayName || st?.id || "").trim();
        return { key, name };
      })
      .filter((x) => x.key && x.name)
      .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  }, [resolvedFutureServiceId, staffByService]);

  const filteredFutureStaffOptions = useMemo(() => {
    const q = String(futureStaffNameQuery || "").trim().toLowerCase();
    if (!q) return futureStaffOptions;
    return futureStaffOptions.filter((x) =>
      String(x.name || "").toLowerCase().includes(q)
    );
  }, [futureStaffOptions, futureStaffNameQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadFutureStaffForPickedService() {
      const sid = String(resolvedFutureServiceId || "").trim();
      if (!sid) return;
      const hasCache = Object.prototype.hasOwnProperty.call(staffByService, sid);
      if (hasCache) return;

      try {
        setStaffLoadingByService((p) => ({ ...p, [sid]: true }));
        setStaffErrorByService((p) => ({ ...p, [sid]: "" }));

        const res = await listActiveStaffBySpecialty({
          salonId: SALON_ID,
          specialty: sid,
        });

        if (cancelled) return;

        const norm = (v: any) => String(v ?? "").trim().toLowerCase();
        const normalized = (res || []).filter((st: any) => {
          const name = String(st?.name || "").trim();
          if (!name) return false;

          const specs = Array.isArray(st?.specialties)
            ? st.specialties.map((x: any) => String(x || "").trim()).filter(Boolean)
            : [];

          return specs.some((sp: string) => norm(sp) === norm(sid));
        });

        setStaffByService((p) => ({ ...p, [sid]: normalized as any }));
      } catch {
        if (!cancelled) {
          setStaffByService((p) => ({ ...p, [sid]: [] }));
          setStaffErrorByService((p) => ({
            ...p,
            [sid]: "تعذر تحميل الموظفات لهذه الخدمة.",
          }));
        }
      } finally {
        if (!cancelled) {
          setStaffLoadingByService((p) => ({ ...p, [sid]: false }));
        }
      }
    }

    loadFutureStaffForPickedService();
    return () => {
      cancelled = true;
    };
  }, [resolvedFutureServiceId, staffByService]);

  useEffect(() => {
    if (futureAnyStaff) return;
    if (!futureSelectedEmployeeKey) return;

    const exists = futureStaffOptions.some((x) => x.key === futureSelectedEmployeeKey);
    if (!exists) {
      setFutureSelectedEmployeeKey("");
      setFutureStaffNameQuery("");
    }
  }, [futureAnyStaff, futureSelectedEmployeeKey, futureStaffOptions]);

  useEffect(() => {
    if (!futureAnyStaff) return;
    if (!futureSelectedEmployeeKey && !futureStaffNameQuery) return;
    setFutureSelectedEmployeeKey("");
    setFutureStaffNameQuery("");
  }, [futureAnyStaff, futureSelectedEmployeeKey, futureStaffNameQuery]);

  function getServiceById(id: string) {
    return servicesFlat.find((sv) => sv.id === id) || null;
  }

  function focusFutureSearchForCartItem(it: CartItem) {
    const serviceId = String(it.serviceId || "").trim();
    const employeeKey = resolveEmployeeKey(it);
    const employeeName = String(it.employeeName || "").trim();
    const dateISO = String(it.date || bookingDate || "").trim();
    if (!serviceId || !employeeKey) return;

    const contextKey = `${serviceId}|${employeeKey}|${dateISO}|${String(it.id || "").trim()}`;
    if (autoFutureSearchKeyRef.current === contextKey) return;
    autoFutureSearchKeyRef.current = contextKey;

    const sv = getServiceById(serviceId);
    if (sv) {
      const sectionId = String(sv.sectionId || "").trim();
      if (sectionId) setSelectedSectionId(sectionId);

      if (catalogMode === "firestore") {
        const catId = String((sv as any).categoryId || "").trim();
        setSelectedCategory(catId || "");
      } else {
        const catName = String((sv as any).category || "").trim();
        if (catName) setSelectedCategory(catName);
      }
    }

    setFutureServiceId(serviceId);
    setFutureTargetItemId(String(it.id || "").trim());
    setServicePicker(serviceId);
    setFutureAnyStaff(false);
    setFutureSelectedEmployeeKey(employeeKey);
    setFutureStaffNameQuery(employeeName);

    requestAnimationFrame(() => {
      futureSearchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    void runFutureAvailabilitySearch({
      serviceId,
      anyStaff: false,
      employeeKey,
      employeeName,
      startISO: dateISO || String(bookingDate || "").trim() || todayISO(),
      targetItemId: String(it.id || "").trim(),
    });
  }

  function canEditByLockedPrev(items: CartItem[], itemId: string) {
    const list = items || [];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx < 0) return false;
    if (idx === 0) return true;
    return !!list[idx - 1]?.locked;
  }

  // =========================
  // Cart actions
  // =========================
  const addServiceToCart = (idRaw: string) => {
    const id = String(idRaw || "").trim();
    if (!id) return;

    const sv = getServiceById(id);
    if (!sv) return;

    const dateISO = String(bookingDate || "").trim();

    const eff = pickEffectivePrice({
      basePrice: Number(sv.basePrice || 0),
      seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
      appSettings,
      dateISO,
    });

    const effectiveBasePrice = Number(eff.price || 0);
    const effectivePriceText = `${effectiveBasePrice} ريال`;

    setFormData((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        {
          id: makeLocalId(),
          serviceId: id,
          serviceName: sv.name,
          basePrice: effectiveBasePrice,
          priceText: effectivePriceText,
          durationMin: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
          employeeId: "",
          employeeUid: "",
          employeeName: "",
          date: bookingDate,
          time: "",
          locked: false,
          serviceSectionId: String(sv.sectionId || "").trim(),
          serviceCategoryId: String(sv.categoryId || "").trim() || undefined,
          serviceCategoryName: String(sv.category || "").trim() || undefined,
        },
      ],
    }));

    setServicePicker("");
    setSelectedCategory("");
    setSelectedSectionId("");
    setShowHairGuide(false);

    setCouponCode("");
    setManualOverride(false);
    setOfferMsg("");
    setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
  };

  const removeServiceFromCart = (itemId: string) => {
    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).filter((it) => it.id !== itemId),
    }));

    setBusyByItem((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

    setCouponCode("");
    setManualOverride(false);
    setOfferMsg("");
    setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
  };

  const updateItem = (itemId: string, patch: Partial<CartItem>) => {
    setFormData((prev) => {
      const list = prev.items || [];
      const idx = list.findIndex((x) => x.id === itemId);
      if (idx < 0) return prev;

      const nextItems = list.map((it, i) => {
        if (i === idx) return { ...it, ...patch };

        const affectsChain =
          patch.employeeId !== undefined ||
          patch.time !== undefined ||
          patch.date !== undefined;

        if (i > idx && affectsChain) {
          return {
            ...it,
            locked: false,
            ...(patch.date !== undefined
              ? { employeeId: "", employeeUid: "", employeeName: "", time: "" }
              : {}),
          };
        }

        return it;
      });

      return { ...prev, items: nextItems };
    });

    if (patch.serviceId || patch.employeeId || patch.date || patch.time) {
      if (!couponCode.trim()) setManualOverride(false);
    }
  };

  // =========================
  // Load staff per serviceId
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadNeededStaff() {
      const serviceIds = Array.from(
        new Set(
          (formData.items || [])
            .map((it) => String(it.serviceId || "").trim())
            .filter(Boolean)
        )
      );

      if (!serviceIds.length) return;

      for (const sid of serviceIds) {
        if (cancelled) return;
        if (staffByService[sid] && Array.isArray(staffByService[sid])) continue;

        try {
          setStaffLoadingByService((p) => ({ ...p, [sid]: true }));
          setStaffErrorByService((p) => ({ ...p, [sid]: "" }));

          const res = await listActiveStaffBySpecialty({
            salonId: SALON_ID,
            specialty: sid,
          });

          if (cancelled) return;

          const norm = (v: any) => String(v ?? "").trim().toLowerCase();

          const normalized = (res || []).filter((st: any) => {
            const name = String(st?.name || "").trim();
            if (!name) return false;

            const specs = Array.isArray(st?.specialties)
              ? st.specialties.map((x: any) => String(x || "").trim()).filter(Boolean)
              : [];

            return specs.some((sp: string) => norm(sp) === norm(sid));
          });

          setStaffByService((p) => ({ ...p, [sid]: normalized }));

          if (!normalized.length) {
            setStaffErrorByService((p) => ({
              ...p,
              [sid]: `ما فيه موظفات لهذه الخدمة حالياً.`,
            }));
          }
        } catch (e: any) {
          const msg = String(e?.message || "");
          let err = "تعذر تحميل قائمة الموظفات.";
          if (msg.toLowerCase().includes("requires an index")) {
            err = "Firestore يحتاج Index للاستعلام. افتح Console واضغط Create index.";
          }
          if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            err = "صلاحيات قراءة الموظفات غير كافية (staff_public).";
          }

          setStaffByService((p) => ({ ...p, [sid]: [] }));
          setStaffErrorByService((p) => ({ ...p, [sid]: err }));
        } finally {
          if (!cancelled) {
            setStaffLoadingByService((p) => ({ ...p, [sid]: false }));
          }
        }
      }
    }

    loadNeededStaff();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items]);

  async function collectTakenTimesForEmployeeDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    employeeUidFallback?: string;
    employeeNameFallback?: string;
    dateISO: string;
  }) {
    const {
      salonId,
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
      dateISO,
    } = args;
    const takenFs = new Set<string>();
    const colSlots = collection(db, "salons", salonId, "booking_slots");

    const lookup = buildEmployeeLookupKeys({
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
    });

    const primaryReads: Promise<any>[] = [
      ...lookup.primaryEmployeeKeyKeys.map((k) =>
        getDocs(query(colSlots, where("employeeKey", "==", k), where("date", "==", dateISO)))
      ),
      ...lookup.primaryEmployeeIdKeys.map((k) =>
        getDocs(query(colSlots, where("employeeId", "==", k), where("date", "==", dateISO)))
      ),
    ];

    const primarySnaps = await Promise.all(primaryReads);
    primarySnaps.forEach((snap) => {
      snap.docs.forEach((d: any) => {
        const t = String((d.data() as any)?.time || "").trim();
        if (t) takenFs.add(t);
      });
    });

    const fallbackReads: Promise<any>[] = [
      ...lookup.fallbackEmployeeKeyKeys.map((k) =>
        getDocs(query(colSlots, where("employeeKey", "==", k), where("date", "==", dateISO)))
      ),
      ...lookup.fallbackEmployeeIdKeys.map((k) =>
        getDocs(query(colSlots, where("employeeId", "==", k), where("date", "==", dateISO)))
      ),
    ];
    if (!fallbackReads.length) return takenFs;

    const snaps = await Promise.all(fallbackReads);
    snaps.forEach((snap) => {
      snap.docs.forEach((d: any) => {
        const t = String((d.data() as any)?.time || "").trim();
        if (t) takenFs.add(t);
      });
    });

    return takenFs;
  }

  function resolveBookableStartTimes(args: {
    allSlots: TimeSlot[];
    durationMin: number;
    takenAll: Set<string>;
  }) {
    const normalizedDuration = Number(args.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const slotsForThisService = filterSlotsByServiceEnd(
      args.allSlots,
      closeTime,
      normalizedDuration,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    if (!slotsForThisService.length) return [] as string[];

    const greens = getGreenStartTimes({
      allSlots: args.allSlots,
      slotStepMin,
      durationMin: normalizedDuration,
      bufferMin,
      takenAll: args.takenAll,
    });

    return sortTimesBySlotOrder(
      slotsForThisService
      .map((s) => s.value24)
      .filter((t) => greens.has(t)),
      args.allSlots
    );
  }

  async function getAvailableStartsForDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    employeeUidFallback?: string;
    employeeNameFallback?: string;
    dateISO: string;
    durationMin: number;
    take: number;
    localTakenTimes?: Set<string>;
  }) {
    const {
      salonId,
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
      dateISO,
      durationMin,
      take,
      localTakenTimes,
    } = args;

    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    if (!baseSlots.length) return [];

    const takenFs = await collectTakenTimesForEmployeeDay({
      salonId,
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
      dateISO,
    });
    const takenAll = new Set<string>(takenFs);
    (localTakenTimes || new Set<string>()).forEach((t) => takenAll.add(t));

    const list = resolveBookableStartTimes({
      allSlots: baseSlots,
      durationMin: Number(durationMin || DEFAULT_SERVICE_DURATION_MIN),
      takenAll,
    });

    return list.slice(0, Math.max(1, take));
  }

  // =========================
  // ✅ Busy slots per item + تحميل معلومات الحجز الموجود
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadBusyForItems() {
      const items = formData.items || [];
      const baseSlots =
        timeSlots.length > 0
          ? timeSlots
          : generateSalonTimeSlots(openTime, closeTime, slotStepMin);

      for (const it of items) {
        if (cancelled) return;

        const itemId = it.id;
        const employeeId = String(it.employeeId || "").trim();
        const date = String(it.date || "").trim();

        if (!employeeId || !date) {
          setBusyByItem((p) => ({ ...p, [itemId]: { ...emptyBusyState() } }));
          continue;
        }

        setBusyByItem((p) => ({
          ...p,
          [itemId]: {
            ...(p[itemId] || emptyBusyState()),
            loading: true,
            hint: "",
            disabledStartTimes: new Set(baseSlots.map((s) => s.value24)),
            disabledReasonByStart: {},
          },
        }));

        try {
          const empKey = resolveEmployeeKey(it);
          if (!isCartItemStaffAvailable(it)) {
            const disabledAll = new Set(baseSlots.map((s) => s.value24));
            const allStarts = baseSlots.map((s) => s.value24);
            setBusyByItem((p) => ({
              ...p,
              [itemId]: {
                busyTimes: new Set<string>(),
                disabledStartTimes: disabledAll,
                loading: false,
                hint: "الموظفة غير متاحة في هذا اليوم.",
                suggestedSlot: "",
                disabledReasonByStart: buildUniformReasonByStarts(
                  allStarts,
                  "الموظفة غير متاحة في هذا اليوم."
                ),
                bookedMetaByTime: {},
              },
            }));
            if (String(it.time || "").trim()) {
              updateItem(itemId, { time: "", locked: false });
            }
            focusFutureSearchForCartItem(it);
            continue;
          }
          const takenFs = await collectTakenTimesForEmployeeDay({
            salonId: SALON_ID,
            employeeKey: empKey,
            employeeIdFallback: employeeId,
            employeeUidFallback: String(it.employeeUid || "").trim(),
            employeeNameFallback: String(it.employeeName || "").trim(),
            dateISO: date,
          });

          if (cancelled) return;

          // 2) local cart
          const takenLocal = getLocalTakenTimesForItem(
            items,
            itemId,
            empKey,
            date,
            employeeId
          );

          const takenAll = new Set<string>();
          takenFs.forEach((x) => takenAll.add(x));
          takenLocal.forEach((x) => takenAll.add(x));

          // ✅ load bookings meta (مين حاجز)
          const bookedMetaByTime: Record<string, string> = {};
          try {
            const colBookings = collection(db, "salons", SALON_ID, "bookings");
            let bSnap = await getDocs(
              query(colBookings, where("employeeKey", "==", empKey), where("date", "==", date), limit(250))
            );
            if (bSnap.empty) {
              bSnap = await getDocs(
                query(colBookings, where("employeeId", "==", employeeId), where("date", "==", date), limit(250))
              );
            }

            bSnap.docs.forEach((d) => {
              const data = d.data() as any;
              const t = String(data?.time || "").trim();
              const status = String(data?.status || "").toLowerCase();
              if (!t) return;

              if (["cancelled", "canceled", "rejected"].includes(status)) return;

              const clientName = String(data?.clientName || data?.name || "").trim();
              const clientPhone = phone10Digits(data?.clientPhone || data?.phone || "");
              const channel = String(data?.channel || data?.source || "").trim();

              const who = [clientName || "بدون اسم", clientPhone ? `(${clientPhone})` : ""]
                .filter(Boolean)
                .join(" ");
              const ch = channel ? ` — ${channel}` : "";

              bookedMetaByTime[t] = `محجوز — ${who}${ch}`;
            });
          } catch {
            // ignore
          }

          const disabled = new Set<string>();
          const disabledReasonByStart: Record<string, string> = {};
          let sequentialHint = "";
          let suggestedSlot = "";
          let hasAnyAvailableForItem = false;
          const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
          const slotsForThisService = filterSlotsByServiceEnd(
            baseSlots,
            closeTime,
            durationMin,
            bufferMin,
            ALLOW_OVERTIME_MIN
          );
          const allowedByEndSet = new Set<string>(
            slotsForThisService.map((s) => s.value24)
          );
          const availableStarts = resolveBookableStartTimes({
            allSlots: baseSlots,
            durationMin,
            takenAll,
          });
          const availableSet = new Set<string>(availableStarts);
          baseSlots.forEach((s) => {
            const start = s.value24;
            if (!allowedByEndSet.has(start)) {
              disabled.add(start);
              disabledReasonByStart[start] =
                "لا يكفي لإنهاء مدة الخدمة مع البافر ضمن حدود الدوام.";
              return;
            }
            if (availableSet.has(start)) return;

            disabled.add(start);

            const needed = getTimesToLock(
              baseSlots,
              slotStepMin,
              start,
              durationMin,
              bufferMin
            );

            const conflictTime = needed.find((t) => takenAll.has(t));
            if (!conflictTime) {
              disabledReasonByStart[start] =
                "غير متاح بسبب تعارض ضمن نافذة مدة الخدمة والبافر.";
              return;
            }

            const conflictLabel = formatTime12(conflictTime, conflictTime);

            if (takenLocal.has(conflictTime)) {
              disabledReasonByStart[start] =
                `يتعارض مع خدمة أخرى في السلة عند ${conflictLabel}.`;
              return;
            }

            const meta = String(bookedMetaByTime[conflictTime] || "").trim();
            if (meta) {
              disabledReasonByStart[start] =
                `يتعارض عند ${conflictLabel}: ${meta}.`;
              return;
            }

            disabledReasonByStart[start] =
              `يتعارض مع حجز/قفل فعلي عند ${conflictLabel}.`;
          });
          hasAnyAvailableForItem = availableStarts.length > 0;

          if (sequentialBooking) {
            // ✅ طور متتابع: نظهر فقط الأوقات الخضراء (التي تكفي مدة+بافر بدون تعارض)
            // + نعطي اقتراح "أقرب وقت" بعد آخر نهاية (اقتراح فقط لا يمنع باقي الأخضر)

            // احسب آخر نهاية (من FS + من السلة) للاقتراح فقط
            let lastEndMin = -1;

            // FS last
            let lastTakenMinFs = -1;
            takenFs.forEach((t) => {
              const m = toMinutes(t);
              if (Number.isFinite(m)) lastTakenMinFs = Math.max(lastTakenMinFs, m);
            });
            if (lastTakenMinFs !== -1) lastEndMin = Math.max(lastEndMin, lastTakenMinFs + slotStepMin);

            // Local cart last (other items same staff/date)
            let lastTakenMinLocal = -1;
            items.forEach((other) => {
              if (other.id === itemId) return;

              const otherEmpKey = resolveEmployeeKey(other);
              if (otherEmpKey !== empKey) return;
              if (String(other.date || "").trim() !== date) return;

              const start = String(other.time || "").trim();
              if (!start) return;

              const locked = getTimesToLock(
                timeSlots,
                slotStepMin,
                start,
                Number(other.durationMin || 0),
                bufferMin
              );

              locked.forEach((label) => {
                const mm = toMinutes(label);
                if (Number.isFinite(mm)) lastTakenMinLocal = Math.max(lastTakenMinLocal, mm);
              });
            });
            if (lastTakenMinLocal !== -1) lastEndMin = Math.max(lastEndMin, lastTakenMinLocal + slotStepMin);

            // suggestedSlot = أقرب أخضر بعد lastEndMin
            let targetSlot = "";
            if (lastEndMin !== -1) {
              for (const start of availableStarts) {
                const m = toMinutes(start);
                if (Number.isFinite(m) && m >= lastEndMin) {
                  targetSlot = start;
                  break;
                }
              }
            }
            if (!targetSlot) {
              targetSlot = availableStarts[0] || "";
            }

            suggestedSlot = targetSlot;
            sequentialHint = targetSlot
              ? ""
              : "لا يوجد وقت متاح كافٍ لهذا اليوم مع هذه الموظفة.";
          } else {
            if (!hasAnyAvailableForItem) {
              sequentialHint = "لا يوجد وقت متاح كافٍ لهذا اليوم مع هذه الموظفة.";
            }
          }

          setBusyByItem((p) => ({
            ...p,
            [itemId]: {
              busyTimes: takenAll,
              disabledStartTimes: disabled,
              loading: false,
              hint: sequentialHint,
              suggestedSlot,
              disabledReasonByStart,
              bookedMetaByTime,
            },
          }));

          const currentTime = String(it.time || "").trim();
          if (currentTime && disabled.has(currentTime)) {
            updateItem(itemId, { time: "", locked: false });
          }

          if (!hasAnyAvailableForItem && String(it.employeeId || "").trim()) {
            focusFutureSearchForCartItem(it);
          }
        } catch (e: any) {
          console.error(e);
          setBusyByItem((p) => ({
            ...p,
            [itemId]: { ...emptyBusyState(), hint: "تعذر تحميل التوفر حالياً." },
          }));
        }
      }
    }

    loadBusyForItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items, sequentialBooking, timeSlots, slotStepMin, bufferMin, openTime, closeTime, staffByService]);

  // =========================
  // Handlers
  // =========================
  function applyBookingDate(v: string) {
    setBookingDate(v);

    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => {
        const sv = getServiceById(String(it.serviceId || "").trim());

        const basePatch = {
          ...it,
          date: v,
          time: "",
          employeeId: "",
          employeeUid: "",
          employeeName: "",
          locked: false,
        };

        if (sv) {
          const eff = pickEffectivePrice({
            basePrice: Number(sv.basePrice || 0),
            seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
            appSettings,
            dateISO: v,
          });
          const price = Number(eff.price || 0);
          return { ...basePatch, basePrice: price, priceText: `${price} ريال` };
        }

        return basePatch;
      }),
    }));
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sid = e.target.value;
    setSelectedSectionId(sid);
    setSelectedCategory("");
    setServicePicker("");
    setShowHairGuide(false);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
    setServicePicker("");
  };

  const basePrice = useMemo(() => {
    return (formData.items || []).reduce((sum, it) => sum + Number(it.basePrice || 0), 0);
  }, [formData.items]);

  const finalPrice = useMemo(() => {
    if (applied.offer) return applied.finalPrice;
    return basePrice;
  }, [basePrice, applied]);

  // =========================
  // Coupon
  // =========================
  const handleApplyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) {
      setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
      setOfferMsg("");
      setManualOverride(false);
      return;
    }

    try {
      const offer = await findActiveOfferByCode(SALON_ID, code);
      if (!offer) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg("الكود غير صحيح أو منتهي");
        return;
      }

      const applicable = (formData.items || []).filter((it) => {
        const sid = String(it.serviceId || "").trim();
        return sid && offerAppliesToService(offer, sid);
      });

      if (!applicable.length) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg("هذا الكود لا ينطبق على الخدمات المختارة");
        return;
      }

      const missingDate = applicable.find((it) => !String(it.date || "").trim());
      if (missingDate) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg("اختاري تاريخ الحجز للخدمات قبل تطبيق الكود");
        return;
      }

      const badDate = applicable
        .map((it) => ({
          it,
          check: isOfferValidForBookingDate(offer as any, String(it.date || "").trim()),
        }))
        .find((x) => !x.check.ok);

      if (badDate) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg(badDate.check.reason || "هذا العرض غير متاح لتاريخ الحجز المختار");
        return;
      }

      const applicableTotal = applicable.reduce((s, it) => s + Number(it.basePrice || 0), 0);
      const { discountAmount } = calcDiscount(applicableTotal, offer);
      const nextFinal = Math.max(0, basePrice - discountAmount);

      setApplied({
        offer,
        discountAmount,
        finalPrice: nextFinal,
        reason: "تم تطبيق الخصم ✅",
      });

      setManualOverride(true);
      setOfferMsg(`تم تطبيق الخصم: ${(offer as any).title} ✅`);
    } catch (e: any) {
      console.error("❌ apply coupon error:", e?.code, e?.message, e);
      setOfferMsg("صار خطأ في التحقق من الكود");
    }
  };

  function allocateDiscount(items: CartItem[], discountTotal: number) {
    const total = items.reduce((s, it) => s + Number(it.basePrice || 0), 0);
    if (!total || !discountTotal) return items.map(() => 0);

    const raw = items.map((it) => (Number(it.basePrice || 0) / total) * discountTotal);
    const rounded = raw.map((x) => Math.floor(x));
    let used = rounded.reduce((s, x) => s + x, 0);
    let remaining = Math.max(0, Math.round(discountTotal - used));

    let i = 0;
    while (remaining > 0 && items.length) {
      rounded[i % items.length] += 1;
      remaining -= 1;
      i += 1;
    }

    return rounded;
  }

  const checkOneItemSlot = async (it: CartItem) => {
    const employeeKey = resolveEmployeeKey(it);
    const employeeIdFallback = String(it.employeeId || "").trim();
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };
    if (!isCartItemStaffAvailable(it)) {
      return { ok: false, msg: "الموظفة غير متاحة في هذا اليوم." };
    }
    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const allowedStarts = filterSlotsByServiceEnd(
      baseSlots,
      closeTime,
      durationMin,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    const isStartAllowed = allowedStarts.some((s) => s.value24 === time);
    if (!isStartAllowed) {
      return {
        ok: false,
        msg: "هذا الوقت لا يكفي مدة الخدمة مع البافر ضمن حدود دوام الصالون.",
      };
    }

    const timesToCheck = getTimesToLock(
      baseSlots,
      slotStepMin,
      time,
      durationMin,
      bufferMin
    );

    const localTaken = getLocalTakenTimesForItem(
      formData.items || [],
      it.id,
      employeeKey,
      date,
      String(it.employeeId || "").trim()
    );
    const localConflict = timesToCheck.some((t) => localTaken.has(t));
    if (localConflict) {
      return { ok: false, msg: "هذا الوقت يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر." };
    }

    try {
      const lockKeys = buildEmployeeLookupKeys({
        employeeKey,
        employeeIdFallback,
        employeeUidFallback: String(it.employeeUid || "").trim(),
        employeeNameFallback: String(it.employeeName || "").trim(),
      }).slotKeys;
      const snaps = await Promise.all(
        lockKeys.flatMap((lockKey) =>
          timesToCheck.map((t) => {
            const slotId = buildSlotId(SALON_ID, lockKey, date, t);
            return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
          })
        )
      );

      const anyTaken = snaps.some((s) => s.exists());
      if (anyTaken) return { ok: false, msg: "هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر." };

      return { ok: true, msg: "" };
    } catch {
      return { ok: false, msg: "تعذر فحص الوقت. جرّبي وقتًا آخر." };
    }
  };

  const validatePickedTime = async (itemId: string, pickedTime: string) => {
    const items = formData.items || [];
    const it = items.find((x) => x.id === itemId);
    if (!it) return;

    const nextTime = String(pickedTime || "").trim();
    if (!nextTime) return;

    const temp: CartItem = { ...it, time: nextTime };

    const employeeKey = resolveEmployeeKey(temp);
    const employeeIdFallback = String(temp.employeeId || "").trim();
    const date = String(temp.date || "").trim();
    const time = String(temp.time || "").trim();
    if (!employeeKey || !date || !time) return;
    if (!isCartItemStaffAvailable(temp)) {
      openModal({
        title: "الموظفة غير متاحة",
        message: "الموظفة المختارة غير متاحة في هذا اليوم.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "", locked: false });
      return;
    }
    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    const durationMin = Number(temp.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const allowedStarts = filterSlotsByServiceEnd(
      baseSlots,
      closeTime,
      durationMin,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    const isStartAllowed = allowedStarts.some((s) => s.value24 === time);
    if (!isStartAllowed) {
      openModal({
        title: "وقت غير متاح",
        message: "هذا الوقت لا يكفي مدة الخدمة مع البافر ضمن حدود دوام الصالون.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "", locked: false });
      return;
    }

    const timesToCheck = getTimesToLock(
      baseSlots,
      slotStepMin,
      time,
      durationMin,
      bufferMin
    );

    const localTaken = getLocalTakenTimesForItem(
      items,
      temp.id,
      employeeKey,
      date,
      String(temp.employeeId || "").trim()
    );
    const localConflict = timesToCheck.some((t) => localTaken.has(t));
    if (localConflict) {
      if (sequentialBooking) return;

      openModal({
        title: "تعارض في الوقت",
        message: "وقتك يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "" });
      return;
    }

    try {
      const lockKeys = buildEmployeeLookupKeys({
        employeeKey,
        employeeIdFallback,
        employeeUidFallback: String(temp.employeeUid || "").trim(),
        employeeNameFallback: String(temp.employeeName || "").trim(),
      }).slotKeys;
      const snaps = await Promise.all(
        lockKeys.flatMap((lockKey) =>
          timesToCheck.map((t) => {
            const slotId = buildSlotId(SALON_ID, lockKey, date, t);
            return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
          })
        )
      );

      const anyTaken = snaps.some((s) => s.exists());
      if (anyTaken) {
        openModal({
          title: "وقت غير متاح",
          message: "الوقت محجوز بالفعل (واضح عند الاستقبال). اختاري وقتًا ثاني.",
          variant: "danger",
          confirmText: "تمام",
        });
        updateItem(itemId, { time: "" });
        return;
      }
    } catch {
      openModal({
        title: "تعذر فحص الوقت",
        message: "ما قدرنا نتحقق من توفر الوقت الآن. جرّبي وقتًا ثاني.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      updateItem(itemId, { time: "" });
    }
  };

  // =========================
  // Submit (الاستقبال)
  // =========================
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const phone = (formData.phone ?? "").replace(/\D/g, "");
    const isValidSaudiMobile = /^05\d{8}$/.test(phone);

    if (!isValidSaudiMobile) {
      openModal({
        title: "رقم الجوال غير صحيح",
        message: "لازم يبدأ بـ 05 ويكون 10 أرقام.",
        variant: "danger",
        confirmText: "تعديل",
      });
      return;
    }

    const items = (formData.items || []).map((x) => ({ ...x }));
    if (!items.length) {
      openModal({
        title: "اختيار الخدمات",
        message: "فضلاً اختاري خدمة واحدة على الأقل.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    if (!String(bookingDate || "").trim()) {
      openModal({
        title: "اختيار التاريخ",
        message: "فضلاً اختاري تاريخ الحجز أولاً.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const missing = items.find((it) => {
      if (!String(it.employeeId || "").trim()) return true;
      if (!String(it.employeeName || "").trim()) return true;
      if (!String(it.time || "").trim()) return true;
      return false;
    });

    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const prevOk = String(prev.employeeId || "").trim() && String(prev.time || "").trim();
      if (!prevOk) {
        openModal({
          title: "ترتيب الخدمات",
          message: "لازم تكمّلين بيانات الخدمة الأولى قبل ما تحددين الخدمة اللي بعدها ✅",
          variant: "danger",
          confirmText: "تمام",
        });
        return;
      }
    }

    if (missing) {
      openModal({
        title: "بيانات الحجز ناقصة",
        message: "لكل خدمة داخل السلة: لازم تختارين (الموظفة + التاريخ + الوقت).",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const notLocked = items.find((x) => !x.locked);
    if (notLocked) {
      openModal({
        title: "كمّلي خطوات الحجز",
        message: "لازم تضغطين (تأكيد الموظفة والوقت) لكل خدمة قبل الحفظ النهائي.",
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    const overlap = findCartOverlap(items);
    if (!overlap.ok) {
      openModal({
        title: "تعارض في الأوقات",
        message:
          `عندك خدمتين متداخلات بنفس الموظفة ونفس اليوم:\n\n` +
          `• ${String(overlap.a?.serviceName || "—")} (${formatTime12(String(overlap.a?.time || "—"), "—")})\n` +
          `• ${String(overlap.b?.serviceName || "—")} (${formatTime12(String(overlap.b?.time || "—"), "—")})\n\n` +
          `عدّلي وقت واحدة منهم ✅`,
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    setIsLoading(true);

    try {
      const normalizedCode = couponCode.trim();
      let finalApplied: AppliedOfferResult = applied;

      if (normalizedCode) {
        const offer = await findActiveOfferByCode(SALON_ID, normalizedCode);
        if (!offer) {
          openModal({
            title: "كود الخصم غير صحيح",
            message: "الكود غير صحيح أو غير متاح حالياً.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const applicable = items.filter((it) => {
          const sid = String(it.serviceId || "").trim();
          return sid && offerAppliesToService(offer, sid);
        });

        if (!applicable.length) {
          openModal({
            title: "الكود لا ينطبق",
            message: "هذا الكود لا ينطبق على الخدمات المختارة.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const badDate = applicable
          .map((it) => ({
            it,
            check: isOfferValidForBookingDate(offer as any, String(it.date || "").trim()),
          }))
          .find((x) => !x.check.ok);

        if (badDate) {
          openModal({
            title: "العرض غير متاح لهذا التاريخ",
            message: badDate.check.reason || "هذا العرض غير متاح لتاريخ الحجز المختار.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const applicableTotal = applicable.reduce((s, it) => s + Number(it.basePrice || 0), 0);
        const { discountAmount } = calcDiscount(applicableTotal, offer);

        finalApplied = {
          offer,
          discountAmount,
          finalPrice: Math.max(0, basePrice - discountAmount),
          reason: "تم تطبيق الخصم ✅",
        };

        setApplied(finalApplied);
        setManualOverride(true);
      }

      // تحقق نهائي للوقت
      for (const it of items) {
        const check = await checkOneItemSlot(it);
        if (!check.ok) {
          openModal({
            title: "الوقت غير متاح",
            message: `خدمة "${it.serviceName}": ${check.msg}`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }
      }

      const discountTotal = Number(finalApplied.discountAmount || 0);
      const offerObj = finalApplied.offer;

      const applicableIdx: number[] = offerObj
        ? items
          .map((it, idx) => ({ it, idx }))
          .filter(({ it }) => offerAppliesToService(offerObj, String(it.serviceId || "").trim()))
          .map(({ idx }) => idx)
        : [];

      const perItemDiscounts = items.map(() => 0);

      if (discountTotal > 0 && applicableIdx.length) {
        const applicableItems = applicableIdx.map((i) => items[i]);
        const allocated = allocateDiscount(applicableItems, discountTotal);
        applicableIdx.forEach((originalIndex, j) => {
          perItemDiscounts[originalIndex] = Number(allocated[j] || 0);
        });
      }

      // ✅ الاستقبال: الموظف لازم يكون مسجل دخول
      const authNow = getAuth();
      const staffUid = authNow.currentUser?.uid || "";
      if (!staffUid) {
        openModal({
          title: "تسجيل دخول الموظف مطلوب",
          message: "لازم موظفة الاستقبال/الإدارة تكون مسجلة دخول عشان الحجز الداخلي.",
          variant: "danger",
          confirmText: "تمام",
        });
        return;
      }

      const userNote = String(formData.note || "").trim();
      const offerNote = finalApplied.offer
        ? `Offer: ${(finalApplied.offer as any)?.title || normalizedCode || "-"} | discount=${Number(finalApplied.discountAmount || 0).toFixed(0)}`
        : "";

      const noteFinal = [userNote, offerNote].filter(Boolean).join(" | ") || undefined;

      const createdBookings: any[] = [];

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemDiscount = Number(perItemDiscounts[idx] || 0);
        const itemFinal = Math.max(0, Number(it.basePrice || 0) - itemDiscount);

        const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);

        const sv = getServiceById(String(it.serviceId || "").trim());
        const sectionIdAtBooking =
          String(it.serviceSectionId || "").trim() ||
          String(sv?.sectionId || "").trim() ||
          undefined;

        const res = await createBooking({
          userId: staffUid,
          createdBy: "staff",
          channel: "internal",

          clientName: String(formData.name || "").trim(),
          clientPhone: phone,

          serviceName: it.serviceName,
          serviceId: it.serviceId,

          serviceSnapshot: {
            serviceNameAtBooking: it.serviceName,
            priceAtBooking: Number(itemFinal || 0),
            durationAtBooking: durationMin,
            sectionIdAtBooking,
          },

          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim() || null,
          employeeName: String(it.employeeName || "").trim() || "-",

          date: String(it.date || "").trim(),
          time: String(it.time || "").trim(), // ✅ 24h

          total: Number(itemFinal || 0),
          finalPrice: Number(itemFinal || 0),

          status: "pending",
          note: noteFinal,

          slotStepMinAtBooking: slotStepMin,
          bufferMinAtBooking: bufferMin,
          durationMin,
        } as any);

        createdBookings.push({
          bookingId: res.id,
          id: res.id,
          trackId: res.id,
          publicId: (res as any).publicId,

          clientName: String(formData.name || "").trim(),
          clientPhone: phone,

          name: String(formData.name || "").trim(),
          phone,

          service: it.serviceId,
          serviceName: it.serviceName,

          employeeName: String(it.employeeName || "").trim(),
          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim(),

          date: String(it.date || "").trim(),
          time: String(it.time || "").trim(), // ✅ 24h

          total: Number(itemFinal || 0),
          finalPrice: Number(itemFinal || 0),

          couponCode: normalizedCode || "",
          offerId: (finalApplied.offer as any)?.id || null,
          offerTitle: (finalApplied.offer as any)?.title || null,
          discountAmount: itemDiscount,

          durationMin,
          status: "pending",
          createdAt: Date.now(),
          channel: "internal",
        });
      }

      localStorage.setItem("allBookings", JSON.stringify(createdBookings));
      localStorage.setItem("currentBooking", JSON.stringify(createdBookings[0] || null));
      localStorage.removeItem("bookingDraft");

      navigate("/success-internal");
    } catch (e: any) {
      console.error(e);

      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        openModal({
          title: "الوقت محجوز",
          message: "هذا الوقت محجوز بالفعل. اختاري وقتًا آخر.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }

      openModal({
        title: "تعذر حفظ الحجز",
        message:
          `صار خطأ أثناء حفظ الحجز.\n\n` +
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // =========================
  // Restore draft (optional)
  // =========================
  useEffect(() => {
    const draft = localStorage.getItem("bookingDraft");
    if (!draft) return;

    try {
      const parsed = JSON.parse(draft);
      const items: CartItem[] = Array.isArray(parsed?.items) ? parsed.items : [];

      setFormData((prev) => ({
        ...prev,
        ...parsed,
        phone: String(parsed?.phone || "").replace(/\D/g, "").slice(0, 10),
        items: items.map((it) => ({
          ...it,
          id: String(it?.id || makeLocalId()),
          durationMin: Number(it?.durationMin || DEFAULT_SERVICE_DURATION_MIN),
          basePrice: Number(it?.basePrice || 0),
          serviceId: String(it?.serviceId || "").trim(),
          serviceName: String(it?.serviceName || "").trim(),
          employeeId: String(it?.employeeId || "").trim(),
          employeeUid: String(it?.employeeUid || "").trim(),
          employeeName: String(it?.employeeName || "").trim(),
          date: String(it?.date || "").trim(),
          time: String(it?.time || "").trim(),
          priceText: String(it?.priceText || "").trim(),
          serviceSectionId: String((it as any)?.serviceSectionId || "").trim(),
          serviceCategoryId: String((it as any)?.serviceCategoryId || "").trim() || undefined,
          serviceCategoryName: String((it as any)?.serviceCategoryName || "").trim() || undefined,
        })),
      }));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bk-page-wrapper bk-internal">
      
      <div className="booking-page py-5">
      <ConfirmModal
        open={uiModal.open}
        title={uiModal.title}
        message={uiModal.message}
        variant={uiModal.variant}
        confirmText={uiModal.confirmText || "حسنًا"}
        onCancel={() => closeModal()}
        onConfirm={() => {
          const fn = onUiConfirm;
          closeModal();
          if (fn) fn();
        }}
      />
      <Modal
        open={paymentModalOpen}
        onClose={() => {
          if (isLoading) return;
          setPaymentModalOpen(false);
          setConfirmTargetBooking(null);
        }}
        ariaLabel="اختيار طريقة سداد الفاتورة"
        size="sm"
      >
        <div className="p-3">
          <h5 className="mb-2" style={{ fontWeight: 800 }}>تأكيد الحجز + إصدار الفاتورة</h5>
          <p className="mb-3 text-muted" style={{ fontSize: 13 }}>
            اختاري طريقة سداد الفاتورة. بعد الإصدار والطباعة يتم اعتماد الحجز كمكتمل.
          </p>
          <div className="form-label mb-2">طريقة سداد الفاتورة</div>
          <div
            className="d-grid gap-2"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
          >
            <button
              type="button"
              className={`btn ${confirmPaymentMethod === "cash" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setConfirmPaymentMethod("cash")}
              disabled={isLoading}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                borderWidth: 2,
                fontWeight: 800,
                minHeight: 50,
              }}
            >
              كاش
            </button>
            <button
              type="button"
              className={`btn ${confirmPaymentMethod === "transfer" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setConfirmPaymentMethod("transfer")}
              disabled={isLoading}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                borderWidth: 2,
                fontWeight: 800,
                minHeight: 50,
              }}
            >
              تحويل
            </button>
          </div>
          <div className="d-grid gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              style={{ borderRadius: 12, fontWeight: 800, minHeight: 48 }}
              onClick={() => {
                void confirmAndPrintExistingBooking();
              }}
              disabled={isLoading || !confirmTargetBooking}
            >
              {isLoading ? "جاري الإصدار..." : "إصدار الفاتورة + طباعة"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              style={{ borderRadius: 12, minHeight: 44 }}
              onClick={() => {
                setPaymentModalOpen(false);
                setConfirmTargetBooking(null);
              }}
              disabled={isLoading}
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      <div className="container bk-internal-container">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-3 bk-page-header">
          <div className="d-flex align-items-center gap-2">
            <img src={logo} alt="logo" className="bk-logo" />
            <div>
              <div className="bk-title">حجز داخلي (الاستقبال)</div>
              <div className="bk-subtitle">
                اختاري الخدمة → الموظفة → الوقت → تأكيد لكل خدمة
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline-light"
            onClick={() => navigate("/dashboard")}
            disabled={isLoading}
            style={{ borderRadius: 12 }}
          >
            <FontAwesomeIcon icon={faTimesCircle} className="me-2" />
            رجوع
          </button>
        </div>

        <div className="card p-3 mb-3 bk-panel">
          {/* =========================
              Booking search
          ========================= */}
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div style={{ fontWeight: 800 }}>بحث حجز موجود (تأكيد + طباعة)</div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              اسم / جوال / MK / bookingId
            </span>
          </div>

          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-6">
              <label className="form-label">ابحثي باسم أو رقم جوال أو MK</label>
              <input
                className="form-control"
                value={bookingSearch}
                onChange={(e) => {
                  setBookingSearch(String(e.target.value || ""));
                  setFoundBookings([]);
                  setBookingNameChoices([]);
                  setSelectedBookingNameKey("");
                  setSelectedExistingBooking(null);
                }}
                placeholder="مثال: نورة أو 054xxxxxxx أو MK-123"
              />
            </div>

            <div className="col-12 col-md-3 d-grid">
              <button
                type="button"
                className="btn btn-outline-light"
                onClick={handleSearchBooking}
                disabled={bookingSearching}
                style={{ borderRadius: 12 }}
              >
                <FontAwesomeIcon icon={faSearch} className="me-2" />
                {bookingSearching ? "جاري البحث..." : "بحث الحجوزات"}
              </button>
            </div>

            <div className="col-12 col-md-3">
              {bookingSearchMsg ? (
                <div
                  className="alert alert-secondary mb-0 py-2"
                  style={{ borderRadius: 12, fontSize: 13 }}
                >
                  {bookingSearchMsg}
                </div>
              ) : null}
            </div>
          </div>

          {foundBookings.length ? (
            <div className="mt-3">
              {bookingNameChoices.length > 1 ? (
                <div className="mb-3">
                  <div className="small text-muted mb-2">
                    نتائج أسماء متشابهة ({bookingNameChoices.length}) - اختاري الاسم:
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    {bookingNameChoices.map((choice) => {
                      const active = selectedBookingNameKey === choice.key;
                      return (
                        <button
                          key={choice.key}
                          type="button"
                          className={`btn btn-sm ${active ? "bk-action-confirm" : "btn-outline-light"}`}
                          onClick={() => {
                            setSelectedBookingNameKey(choice.key);
                            setSelectedExistingBooking(null);
                          }}
                        >
                          {choice.name}
                          {choice.phone ? ` - ${choice.phone}` : ""}
                          {choice.count > 1 ? ` (${choice.count})` : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="table-responsive">
                <table className="table align-middle mb-0 bk-existing-table">
                  <thead>
                    <tr>
                      <th>MK</th>
                      <th>العميلة</th>
                      <th>الخدمة</th>
                      <th>التاريخ</th>
                      <th>الوقت</th>
                      <th>الحالة</th>
                      <th style={{ width: 260 }}>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayFoundBookings.map((b) => (
                      <tr key={String(b.id)}>
                        <td>{String(b.publicId || b.trackPublicId || b.mk || "—")}</td>
                        <td>{String(b.clientName || b.name || "—")}</td>
                        <td>{String(b.serviceName || b.serviceSnapshot?.serviceNameAtBooking || "—")}</td>
                        <td>{String(b.date || "—")}</td>
                        <td>{formatTime12(String(b.time || ""), "—")}</td>
                        <td>
                          <span className={`bk-status-pill ${bookingStatusClass(b?.status)}`}>
                            {mapBookingStatusAr(b?.status)}
                          </span>
                        </td>
                        <td>
                          <div className="d-flex gap-2 flex-wrap">
                            <button
                              type="button"
                              className="btn btn-sm bk-action-confirm"
                              style={{ borderRadius: 10 }}
                              onClick={() => openConfirmAndPrintModal(b)}
                              disabled={isLoading}
                            >
                              تأكيد + طباعة
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm bk-action-print"
                              style={{ borderRadius: 10 }}
                              onClick={() => printExistingBooking(b)}
                              disabled={isLoading}
                            >
                              طباعة فقط
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm bk-action-details"
                              style={{ borderRadius: 10 }}
                              onClick={() => setSelectedExistingBooking(b)}
                            >
                              تفاصيل
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {bookingNameChoices.length > 1 && !selectedBookingNameKey ? (
                      <tr>
                        <td colSpan={7} className="text-muted">
                          اختاري اسمًا من القائمة أعلاه لعرض الحجوزات الخاصة به.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {selectedExistingBooking &&
              (!selectedBookingNameKey ||
                normalizeSearchText(
                  String(
                    selectedExistingBooking?.clientName ||
                      selectedExistingBooking?.name ||
                      selectedExistingBooking?.fullName ||
                      ""
                  )
                ) === selectedBookingNameKey) ? (
                <div className="bk-booking-details mt-3">
                  <div className="bk-booking-details-title">تفاصيل الحجز</div>
                  <div className="bk-booking-details-grid">
                    {[
                      ["رقم الحجز", String(selectedExistingBooking?.publicId || selectedExistingBooking?.mk || selectedExistingBooking?.id || "—")],
                      ["اسم العميلة", String(selectedExistingBooking?.clientName || selectedExistingBooking?.name || "—")],
                      ["رقم الجوال", String(selectedExistingBooking?.clientPhone || selectedExistingBooking?.phone || "—")],
                      [
                        "الخدمة",
                        String(
                          selectedExistingBooking?.serviceName ||
                          selectedExistingBooking?.serviceSnapshot?.serviceNameAtBooking ||
                          "—"
                        ),
                      ],
                      ["الموظفة", String(selectedExistingBooking?.employeeName || "—")],
                      ["التاريخ", String(selectedExistingBooking?.date || "—")],
                      ["الوقت", formatTime12(String(selectedExistingBooking?.time || ""), "—")],
                      ["الحالة", mapBookingStatusAr(selectedExistingBooking?.status)],
                      [
                        "القناة",
                        mapBookingChannelAr(
                          selectedExistingBooking?.channel || selectedExistingBooking?.source
                        ),
                      ],
                      [
                        "المبلغ",
                        `${Number(
                          selectedExistingBooking?.finalPrice ??
                          selectedExistingBooking?.total ??
                          0
                        ).toFixed(0)} ريال`,
                      ],
                    ].map(([label, value]) => (
                      <div key={label} className="bk-booking-row">
                        <div className="bk-booking-label">{label}</div>
                        <div className="bk-booking-value">
                          {label === "الحالة" ? (
                            <span className={`bk-status-pill ${bookingStatusClass(selectedExistingBooking?.status)}`}>
                              {value}
                            </span>
                          ) : (
                            value
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* =========================
            Form
        ========================= */}
        <form onSubmit={handleSubmit}>
          <div className="row g-3">
            {/* اختيار الخدمة */}
            <div className="col-12 order-2">
              <div className="card p-3 bk-panel">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <div style={{ fontWeight: 800 }}>
                    <FontAwesomeIcon icon={faCalendarAlt} className="me-2" />
                    اختيار الخدمة
                  </div>
                  {isHairSection ? (
                    <button
                      type="button"
                      className="btn btn-outline-light btn-sm"
                      onClick={() => setShowHairGuide((p) => !p)}
                      style={{ borderRadius: 12 }}
                    >
                      دليل أطوال الشعر
                    </button>
                  ) : null}
                </div>

                {showHairGuide ? (
                  <div className="mb-3">
                    <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
                      <span className="badge text-bg-secondary" style={{ borderRadius: 999 }}>
                        Hair Guide
                      </span>

                      {isOwner ? (
                        <label
                          className="btn btn-outline-info btn-sm mb-0"
                          style={{ borderRadius: 12, cursor: "pointer" }}
                        >
                          {uploadingGuide ? "جاري الرفع..." : "رفع صورة جديدة"}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadHairGuide(f);
                            }}
                            disabled={uploadingGuide}
                          />
                        </label>
                      ) : (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          رفع الصورة للإدارة فقط
                        </span>
                      )}
                    </div>

                    <div
                      className="p-2"
                      style={{
                        borderRadius: 14,
                        background: "rgba(255,255,255,0.06)",
                        overflow: "hidden",
                      }}
                    >
                      <img
                        src={hairGuideUrl}
                        alt="hair guide"
                        style={{ width: "100%", borderRadius: 12, display: "block" }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="row g-2">
                  <div className="col-12">
                    <label className="form-label">القسم</label>
                    <select
                      className="form-select"
                      value={selectedSectionId}
                      onChange={handleSectionChange}
                    >
                      <option value="">اختاري قسم...</option>
                      {sectionOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title || s.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-12">
                    <label className="form-label">التصنيف</label>
                    <select
                      className="form-select"
                      value={selectedCategory}
                      onChange={handleCategoryChange}
                      disabled={!selectedSectionId}
                    >
                      <option value="">الكل</option>
                      {categoryOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-12">
                    <label className="form-label">الخدمة</label>
                    <select
                      className="form-select"
                      value={servicePicker}
                      onChange={(e) => setServicePicker(String(e.target.value || ""))}
                      disabled={!selectedSectionId}
                    >
                      <option value="">اختاري خدمة...</option>
                      {servicesGrouped.map(([catName, arr]) => (
                        <optgroup key={catName} label={catName}>
                          {arr.map((sv) => (
                            <option key={sv.id} value={sv.id}>
                              {sv.name} — {servicePickerPriceText(sv)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="col-12 d-grid mt-1">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ borderRadius: 12 }}
                      disabled={!servicePicker}
                      onClick={() => addServiceToCart(servicePicker)}
                    >
                      + إضافة للسلة
                    </button>
                  </div>

                  <div className="col-12 mt-2">
                    <div className="alert alert-secondary mb-0 py-2" style={{ borderRadius: 12 }}>
                      <div style={{ fontSize: 12, opacity: 0.9 }}>
                        السعر يتحدد حسب تاريخ الحجز (سعر موسم/عادي) ✅
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* بيانات العميلة */}
            <div className="col-12 order-1">
              <div className="card p-3 bk-panel">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                  <div style={{ fontWeight: 800 }}>
                    <FontAwesomeIcon icon={faUser} className="me-2" />
                    بيانات العميلة
                  </div>

                  <span className="badge text-bg-dark" style={{ borderRadius: 999 }}>
                    عدد الخدمات: {(formData.items || []).length}
                  </span>
                </div>

                <div className="row g-3 align-items-end mb-3 pb-3" style={{ borderBottom: "1px dashed #e2cdbb" }}>
                  <div className="col-12 col-md-4">
                    <label className="form-label">تاريخ الحجز</label>
                    <input
                      ref={dateRef}
                      type="date"
                      className="form-control"
                      value={bookingDate}
                      min={todayISO()}
                      onChange={(e) => {
                        const next = String(e.target.value || "").trim();
                        applyBookingDate(next);
                      }}
                    />
                    <div className="mt-2" style={{ fontSize: 12, opacity: 0.8 }}>
                      ملاحظة: تغيير التاريخ يصفر اختيار الموظفات/الأوقات داخل السلة.
                    </div>
                  </div>

                  <div className="col-12 col-md-8">
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span className="badge text-bg-dark" style={{ borderRadius: 999 }}>
                        Catalog: {catalogMode === "firestore" ? "Firestore" : "Pricing"}
                      </span>
                      {catalogLoading ? (
                        <span className="badge text-bg-secondary" style={{ borderRadius: 999 }}>
                          <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                          تحميل الكتالوج...
                        </span>
                      ) : null}

                      {sequentialBooking ? (
                        <span className="badge text-bg-success" style={{ borderRadius: 999 }}>
                          ✅ طور متتابع مفعّل (Sequential)
                        </span>
                      ) : (
                        <span className="badge text-bg-warning" style={{ borderRadius: 999 }}>
                          ⚠️ طور متتابع غير مفعّل
                        </span>
                      )}

                      <span className="badge text-bg-info" style={{ borderRadius: 999 }}>
                        SlotStep: {slotStepMin}m — Buffer: {bufferMin}m
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mb-3 pb-3" style={{ borderBottom: "1px dashed #e2cdbb" }}>
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                    <div style={{ fontWeight: 800 }}>بحث عميلة (اختياري)</div>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      يبحث بالاسم/الجوال/رقم الحجز
                    </span>
                  </div>

                  <div className="row g-2 align-items-end">
                    <div className="col-12 col-md-6">
                      <label className="form-label">ابحثي باسم أو رقم جوال أو رقم حجز</label>
                      <input
                        className="form-control"
                        value={clientSearch}
                        onChange={(e) => {
                          setClientSearch(String(e.target.value || ""));
                          setSelectedClient(null);
                          setClientSearchResults([]);
                        }}
                        placeholder="مثال: 054xxxxxxx أو نورة أو MK-123"
                      />
                    </div>

                    <div className="col-12 col-md-3 d-grid">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSearchClient}
                        disabled={clientSearching}
                        style={{ borderRadius: 12 }}
                      >
                        <FontAwesomeIcon icon={faSearch} className="me-2" />
                        {clientSearching ? "جاري البحث..." : "بحث"}
                      </button>
                    </div>

                    <div className="col-12 col-md-3">
                      {clientSearchMsg ? (
                        <div
                          className="alert alert-secondary mb-0 py-2"
                          style={{ borderRadius: 12, fontSize: 13 }}
                        >
                          {clientSearchMsg}
                        </div>
                      ) : null}
                    </div>

                    {clientSearchResults.length > 1 ? (
                      <div className="mt-2">
                        <div className="small text-muted mb-2">
                          نتائج متشابهة ({clientSearchResults.length}) - اختاري العميلة الصحيحة:
                        </div>
                        <div className="d-grid gap-2">
                          {clientSearchResults.map((candidate) => {
                            const cid = String(candidate?.id || "").trim();
                            const cname = String(
                              candidate?.name || candidate?.fullName || "بدون اسم"
                            ).trim();
                            const cphone = phone10Digits(
                              candidate?.phone || candidate?.mobile || candidate?.clientPhone || ""
                            );
                            const cpublic = String(
                              candidate?.publicId || candidate?.bookingId || ""
                            ).trim();
                            const active = String(selectedClient?.id || "").trim() === cid;
                            return (
                              <button
                                key={cid || `${cname}_${cphone}_${cpublic}`}
                                type="button"
                                className={`btn btn-sm ${active ? "bk-action-confirm" : "btn-outline-light"} text-start`}
                                onClick={() => {
                                  applyClientSelection(candidate);
                                  setClientSearchMsg("تم اختيار العميلة ✅");
                                }}
                              >
                                {cname}
                                {cphone ? ` — ${cphone}` : ""}
                                {cpublic ? ` — ${cpublic}` : ""}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {selectedClient ? (
                      <div className="alert alert-dark mt-2 mb-0 py-2" style={{ borderRadius: 12, fontSize: 13 }}>
                        <b>تم اختيار عميلة:</b>{" "}
                        {String(selectedClient?.name || selectedClient?.fullName || "—")}
                        {" — "}
                        {phone10Digits(
                          selectedClient?.phone || selectedClient?.mobile || selectedClient?.clientPhone || ""
                        )}
                        {String(
                          selectedClient?.publicId || selectedClient?.bookingId || ""
                        ).trim()
                          ? ` — ${String(selectedClient?.publicId || selectedClient?.bookingId || "").trim()}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label">اسم العميلة</label>
                    <input
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className="form-control"
                      placeholder="مثال: نورة"
                      required
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">رقم الجوال</label>
                    <input
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="form-control"
                      placeholder="05xxxxxxxx"
                      required
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">ملاحظة (اختياري)</label>
                    <textarea
                      name="note"
                      value={formData.note}
                      onChange={handleChange}
                      className="form-control"
                      rows={2}
                      placeholder="ملاحظة للصالون..."
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* السلة */}
            <div className="col-12 order-3">
              <div className="card p-3 bk-panel">
                {/* Cart */}
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                  <div style={{ fontWeight: 800 }}>
                    <FontAwesomeIcon icon={faUserTie} className="me-2" />
                    السلة (اختيار الموظفة والوقت)
                  </div>

                  <div className="d-flex gap-2 flex-wrap">
                    <span className="badge text-bg-secondary" style={{ borderRadius: 999 }}>
                      الإجمالي: {basePrice.toFixed(0)} ريال
                    </span>
                    {applied.offer ? (
                      <span className="badge text-bg-success" style={{ borderRadius: 999 }}>
                        بعد الخصم: {finalPrice.toFixed(0)} ريال
                      </span>
                    ) : null}
                  </div>
                </div>

                {(formData.items || []).length === 0 ? (
                  <div className="alert alert-secondary mb-0" style={{ borderRadius: 12 }}>
                    ما فيه خدمات في السلة. اختاري خدمة من اليسار 👈
                  </div>
                ) : (
                  <div className="bk-cart-list">
                    {(formData.items || []).map((it, idx) => {
                      const sid = String(it.serviceId || "").trim();
                      const staffList = (staffByService[sid] || []) as StaffPublicWithId[];
                      const busy = busyByItem[it.id] || emptyBusyState();
                      const baseSlotsForUi =
                        timeSlots.length > 0
                          ? timeSlots
                          : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
                      const availableTimeSlots = baseSlotsForUi.filter(
                        (s) => !busy.disabledStartTimes?.has(s.value24)
                      );
                      const blockedReasonEntries = Object.entries(
                        busy.disabledReasonByStart || {}
                      )
                        .filter(([t]) => busy.disabledStartTimes?.has(t));
                      const blockedReasonSummaries = summarizeBlockedReasons(
                        blockedReasonEntries,
                        slotStepMin
                      );
                      const blockedReasonPreview = blockedReasonSummaries.slice(0, 10);
                      const blockedReasonHiddenCount = Math.max(
                        0,
                        blockedReasonSummaries.length - blockedReasonPreview.length
                      );
                      const canPickTime =
                        !!String(it.employeeId || "").trim() &&
                        !busy.loading &&
                        canEditByLockedPrev(formData.items || [], it.id);

                      return (
                        <div key={it.id} className="bk-cart-item">
                          <div className="bk-cart-item-head">
                            <div>
                              <div className="bk-cart-service-title">
                                <span className="bk-cart-index">{idx + 1}</span>
                                {it.serviceName}
                              </div>
                              <div className="bk-cart-service-meta">
                                {it.durationMin} دقيقة — {it.date}
                              </div>
                            </div>
                            <div className="bk-cart-price">
                              {Number(it.basePrice || 0).toFixed(0)} ريال
                            </div>
                          </div>

                          <div className="bk-cart-fields">
                            <div className="bk-cart-field bk-cart-field-staff">
                              <label className="form-label">الموظفة</label>
                              {staffLoadingByService[sid] ? (
                                <div className="small text-muted">
                                  <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                                  تحميل الموظفات...
                                </div>
                              ) : staffErrorByService[sid] ? (
                                <div className="small text-warning">{staffErrorByService[sid]}</div>
                              ) : (
                                <select
                                  className="form-select bk-cart-select"
                                  value={it.employeeId}
                                  disabled={!canEditByLockedPrev(formData.items || [], it.id)}
                                  onChange={(e) => {
                                    const empId = String(e.target.value || "").trim();
                                    const st = staffList.find((x) => String(x.id) === empId);
                                    const empUid = String((st as any)?.linkedUid || "").trim();
                                    const empName = String((st as any)?.name || "").trim();

                                    updateItem(it.id, {
                                      employeeId: empId,
                                      employeeUid: empUid,
                                      employeeName: empName,
                                      time: "",
                                      locked: false,
                                    });
                                    setBusyByItem((p) => ({
                                      ...p,
                                      [it.id]: {
                                        ...emptyBusyState(),
                                        loading: !!empId,
                                        hint: empId ? "جاري التحقق من الأوقات المتاحة..." : "",
                                        disabledStartTimes: new Set(
                                          (
                                            timeSlots.length > 0
                                              ? timeSlots
                                              : generateSalonTimeSlots(openTime, closeTime, slotStepMin)
                                          ).map((x) => x.value24)
                                        ),
                                      },
                                    }));
                                  }}
                                >
                                  <option value="">اختاري موظفة...</option>
                                  {staffList.map((st) => (
                                    <option key={String(st.id)} value={String(st.id)}>
                                      {String((st as any)?.name || st.id)}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>

                            <div className="bk-cart-field bk-cart-field-time">
                              <label className="form-label">الوقت</label>
                              {!String(it.employeeId || "").trim() ? (
                                <div className="small text-muted bk-time-grid-empty">
                                  اختاري موظفة أولاً.
                                </div>
                              ) : availableTimeSlots.length ? (
                                <div className="bk-time-grid" role="listbox" aria-label="الأوقات المتاحة">
                                  {availableTimeSlots.map((s) => {
                                    const t = s.value24;
                                    const active = String(it.time || "").trim() === t;
                                    return (
                                      <button
                                        key={t}
                                        type="button"
                                        className={`btn btn-sm bk-time-pill bk-time-grid-btn${active ? " is-active" : ""}`}
                                        aria-pressed={active}
                                        disabled={!canPickTime}
                                        onClick={() => {
                                          updateItem(it.id, { time: t, locked: false });
                                          validatePickedTime(it.id, t);
                                        }}
                                      >
                                        {s.label12}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="small text-muted bk-time-grid-empty">
                                  لا يوجد وقت متاح لهذا اليوم.
                                </div>
                              )}
                              {busy.loading ? (
                                <div className="small mt-1 bk-availability-loading">
                                  <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                                  تحميل التوفر...
                                </div>
                              ) : busy.hint ? (
                                <div className="small mt-1 bk-availability-hint">{busy.hint}</div>
                              ) : null}
                              {!busy.loading &&
                              String(it.employeeId || "").trim() &&
                              blockedReasonSummaries.length > 0 ? (
                                <details className="bk-time-debug mt-2">
                                  <summary>
                                    تشخيص الأوقات غير المتاحة ({blockedReasonSummaries.length})
                                  </summary>
                                  <div className="bk-time-debug-list">
                                    {blockedReasonPreview.map((entry) => (
                                      <div
                                        key={`${entry.from}_${entry.to}_${entry.reasonKey}`}
                                        className="bk-time-debug-row"
                                      >
                                        <span className="bk-time-debug-time">
                                          {formatBlockedRangeLabel(entry.from, entry.to)}
                                        </span>
                                        <span className="bk-time-debug-reason">
                                          {entry.reasonLabel}
                                          {entry.reasonDetail ? (
                                            <span className="bk-time-debug-meta">
                                              {" "}
                                              - {entry.reasonDetail}
                                            </span>
                                          ) : null}
                                        </span>
                                      </div>
                                    ))}
                                    {blockedReasonHiddenCount > 0 ? (
                                      <div className="bk-time-debug-more">
                                        +{blockedReasonHiddenCount} نطاقات إضافية.
                                      </div>
                                    ) : null}
                                  </div>
                                </details>
                              ) : null}
                              {!busy.loading &&
                              String(it.employeeId || "").trim() &&
                              availableTimeSlots.length === 0 ? (
                                <div className="mt-2 d-grid">
                                  <button
                                    type="button"
                                    className="btn btn-outline-dark btn-sm"
                                    onClick={() => focusFutureSearchForCartItem(it)}
                                  >
                                    بحث أوقات للأيام القادمة لهذه الخدمة
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="bk-cart-item-footer">
                            <div>
                              {it.locked ? (
                                <span className="badge text-bg-success" style={{ borderRadius: 999 }}>
                                  ✅ مؤكد
                                </span>
                              ) : null}
                            </div>

                            <div className="d-flex gap-2 flex-wrap">
                              <button
                                type="button"
                                className="btn btn-success btn-sm"
                                style={{ borderRadius: 10 }}
                                disabled={
                                  !it.employeeId ||
                                  !it.time ||
                                  !canEditByLockedPrev(formData.items || [], it.id) ||
                                  isLoading
                                }
                                onClick={async () => {
                                  const check = await checkOneItemSlot(it);
                                  if (!check.ok) {
                                    openModal({
                                      title: "الوقت غير متاح",
                                      message: `خدمة "${it.serviceName}": ${check.msg}`,
                                      variant: "danger",
                                      confirmText: "تمام",
                                    });
                                    updateItem(it.id, { time: "", locked: false });
                                    return;
                                  }
                                  updateItem(it.id, { locked: true });
                                }}
                              >
                                تأكيد الوقت
                              </button>

                              {sequentialBooking && busy.suggestedSlot && !it.time ? (
                                <button
                                  type="button"
                                  className="btn btn-outline-info btn-sm"
                                  style={{ borderRadius: 10 }}
                                  disabled={!it.employeeId}
                                  onClick={() => {
                                    updateItem(it.id, { time: busy.suggestedSlot || "", locked: false });
                                    validatePickedTime(it.id, busy.suggestedSlot || "");
                                  }}
                                >
                                  أقرب وقت: {formatTime12(busy.suggestedSlot || "", "—")}
                                </button>
                              ) : null}

                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                style={{ borderRadius: 10 }}
                                onClick={() => removeServiceFromCart(it.id)}
                                disabled={isLoading}
                              >
                                حذف
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Coupon */}
                <div className="mt-2">
                  <div className="row g-2 align-items-end">
                    <div className="col-12 col-md-6">
                      <label className="form-label">كود خصم (اختياري)</label>
                      <input
                        className="form-control"
                        value={couponCode}
                        onChange={(e) => setCouponCode(String(e.target.value || ""))}
                        placeholder="مثال: SALE10"
                        disabled={isLoading}
                      />
                    </div>

                    <div className="col-12 col-md-3 d-grid">
                      <button
                        type="button"
                        className="btn btn-outline-light"
                        style={{ borderRadius: 12 }}
                        onClick={handleApplyCoupon}
                        disabled={isLoading}
                      >
                        تطبيق
                      </button>
                    </div>

                    <div className="col-12 col-md-3">
                      {offerMsg ? (
                        <div
                          className="alert alert-secondary mb-0 py-2"
                          style={{ borderRadius: 12, fontSize: 13 }}
                        >
                          {offerMsg}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Submit */}
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3">
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    عند الحفظ: يتم إنشاء الحجوزات بالحالة <b>pending</b> ثم يتم الطباعة من صفحة النجاح.
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ borderRadius: 14, minWidth: 200 }}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                        جاري الحفظ...
                      </>
                    ) : (
                      "حفظ الحجز الداخلي"
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* بحث أوقات للأيام القادمة */}
            <div className="col-12 order-4">
              <div className="card p-3 bk-panel">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                  <div style={{ fontWeight: 800, color: "#0d0d0d" }}>بحث أوقات للأيام القادمة</div>
                  <span className="text-muted" style={{ fontSize: 12 }}>يُظهر أول 5 أيام متاحة</span>
                </div>

                <div className="row g-2 align-items-end">
                  <div className="col-12">
                    <select
                      className="form-select"
                      value={futureAnyStaff ? "any" : "one"}
                      onChange={(e) => setFutureAnyStaff(e.target.value === "any")}
                    >
                      <option value="any">أي موظفة للخدمة</option>
                      <option value="one">موظفة محددة</option>
                    </select>
                  </div>

                  {!futureAnyStaff ? (
                    <div className="col-12">
                      <label className="form-label">اختاري الموظفة</label>
                      {!servicePicker ? (
                        <div className="alert alert-danger mb-0 py-2" style={{ borderRadius: 12 }}>
                          اختاري الخدمة أولاً ثم اختاري الموظفة.
                        </div>
                      ) : staffLoadingByService[String(servicePicker || "").trim()] ? (
                        <div className="small text-muted mt-1">
                          <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                          جاري تحميل الموظفات...
                        </div>
                      ) : staffErrorByService[String(servicePicker || "").trim()] ? (
                        <div className="small text-warning mt-1">
                          {staffErrorByService[String(servicePicker || "").trim()]}
                        </div>
                      ) : (
                        <>
                          <input
                            className="form-control"
                            value={futureStaffNameQuery}
                            onChange={(e) => {
                              const v = String(e.target.value || "");
                              setFutureStaffNameQuery(v);
                              setFutureSelectedEmployeeKey("");
                            }}
                            placeholder="ابحثي باسم الموظفة..."
                            disabled={!futureStaffOptions.length}
                          />
                          {futureStaffNameQuery && filteredFutureStaffOptions.length ? (
                            <div className="mt-2 d-flex flex-wrap gap-2">
                              {filteredFutureStaffOptions.slice(0, 8).map((st) => (
                                <button
                                  key={st.key}
                                  type="button"
                                  className="btn btn-outline-light btn-sm"
                                  onClick={() => {
                                    setFutureStaffNameQuery(st.name);
                                    setFutureSelectedEmployeeKey(st.key);
                                  }}
                                >
                                  {st.name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div style={{ fontSize: 12, opacity: 0.75 }} className="mt-1">
                            ابحثي باسم الموظفة وسيتم ربط EmployeeKey تلقائيًا.
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}

                  <div className="col-12 d-grid">
                    <button
                      type="button"
                      className="btn btn-outline-info"
                      style={{ borderRadius: 12 }}
                      onClick={() => {
                        void runFutureAvailabilitySearch();
                      }}
                      disabled={futureLoading}
                    >
                      {futureLoading ? "جاري البحث..." : "بحث"}
                    </button>
                  </div>

                  {futureMsg ? (
                    <div className="col-12">
                      <div className="alert alert-secondary mb-0 py-2" style={{ borderRadius: 12 }}>
                        {futureMsg}
                      </div>
                    </div>
                  ) : null}

                  {futureResult.length ? (
                    <div className="col-12">
                      <div className="bk-future-inline">
                        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                          <div style={{ fontWeight: 800 }}>نتائج البحث</div>
                          <button
                            type="button"
                            className="btn btn-sm bk-time-pill"
                            onClick={() => {
                              const nearestDate = String(futureResult[0]?.date || "").trim();
                              const nearestTime = String(futureResult[0]?.times?.[0] || "").trim();
                              if (!nearestDate || !nearestTime) return;

                              applyBookingDate(nearestDate);
                              openModal({
                                title: "تم اختيار أقرب موعد ✅",
                                message: `التاريخ: ${nearestDate} - الوقت: ${nearestTime}`,
                                variant: "info",
                                confirmText: "تمام",
                              });
                            }}
                          >
                            اختيار أقرب موعد
                          </button>
                        </div>

                        <div className="table-responsive">
                          <table className="table align-middle mb-0 bk-future-table">
                            <thead>
                              <tr>
                                <th>التاريخ</th>
                                <th>أوقات متاحة</th>
                              </tr>
                            </thead>
                            <tbody>
                              {futureResult.map((r) => (
                                <tr key={r.date}>
                                  <td>{r.date}</td>
                                  <td>
                                    <div className="d-flex gap-2 flex-wrap">
                                      {(r.times || []).map((t) => (
                                        <button
                                          key={t}
                                          type="button"
                                          className="btn btn-sm bk-time-pill"
                                          style={{ borderRadius: 999 }}
                                          onClick={() => {
                                            applyBookingDate(r.date);
                                            openModal({
                                              title: "تم اختيار الموعد ✅",
                                              message: `التاريخ: ${r.date} - الوقت: ${t}`,
                                              variant: "info",
                                              confirmText: "تمام",
                                            });
                                          }}
                                        >
                                          {t}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </form>

        </div>
      </div>
    </div>);
};

export default BookingInternal;
