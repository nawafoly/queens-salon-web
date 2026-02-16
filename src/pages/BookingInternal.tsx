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
  toMinutes,
  type TimeSlot,
} from "../helpers/timeSlots";

import { AppSettingsService } from "../services/AppSettingsService";

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

function getTimesToLock(
  allSlots: TimeSlot[],
  slotStepMin: number,
  startTime24: string, // ✅ "HH:MM"
  durationMin: number,
  bufferMin: number
) {
  const startMin = toMinutes(startTime24);
  const step = Math.max(1, Number(slotStepMin || 0));

  const totalMin =
    Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (totalMin <= 0) return [startTime24];

  const slotsToLock = Math.max(1, Math.ceil(totalMin / step));

  const locked: string[] = [];
  for (let i = 0; i < slotsToLock; i++) {
    const targetMin = startMin + i * step;
    const hit = allSlots.find((s) => s.minutes === targetMin);
    if (hit) locked.push(hit.value24);
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

function normalizeKsaPhone(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
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

  // ✅ تفاصيل الحجز الموجود على الوقت (يطلع في الـ UI)
  bookedMetaByTime: Record<string, string>;
};

const emptyBusyState = (): BusyState => ({
  busyTimes: new Set(),
  disabledStartTimes: new Set(),
  loading: false,
  hint: "",
  suggestedSlot: "",
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
  const [futureResult, setFutureResult] = useState<
    { date: string; times: string[]; note?: string }[]
  >([]);

  const [futureMsg, setFutureMsg] = useState("");

  const [staffByService, setStaffByService] = useState<
    Record<string, StaffPublicWithId[]>
  >({});

  const [staffLoadingByService, setStaffLoadingByService] = useState<
    Record<string, boolean>
  >({});

  const [staffErrorByService, setStaffErrorByService] = useState<
    Record<string, string>
  >({});

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

  function isLikelyPhone(q: string) {
    const digits = String(q || "").replace(/\D/g, "");
    return digits.length >= 9;
  }

  async function tryFindClientByPhoneOrName(raw: string) {
    const qRaw = String(raw || "").trim();
    const qDigits = phone10Digits(qRaw);

    const isPhone = isLikelyPhone(qRaw);

    // أماكن شائعة للبروفايلات
    const candidates = [
      collection(db, "salons", SALON_ID, "clients"),
      collection(db, "salons", SALON_ID, "users"),
      collection(db, "users"),
    ];

    // 1) Phone exact
    if (isPhone && qDigits) {
      for (const col of candidates) {
        try {
          const snap = await getDocs(
            query(col, where("phone", "==", qDigits), limit(5))
          );
          if (!snap.empty) {
            const d = snap.docs[0];
            return { id: d.id, ...(d.data() as any) };
          }
        } catch {
          // ignore
        }
      }
    }

    // 2) Name exact / nameLower exact
    const name = String(qRaw || "").trim();
    const nameLower = name.toLowerCase();

    for (const col of candidates) {
      try {
        // name exact
        let snap = await getDocs(query(col, where("name", "==", name), limit(5)));
        if (!snap.empty) {
          const d = snap.docs[0];
          return { id: d.id, ...(d.data() as any) };
        }

        // nameLower exact (لو عندك الحقل)
        snap = await getDocs(
          query(col, where("nameLower", "==", nameLower), limit(5))
        );
        if (!snap.empty) {
          const d = snap.docs[0];
          return { id: d.id, ...(d.data() as any) };
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  const handleSearchClient = async () => {
    const q = String(clientSearch || "").trim();
    if (!q) {
      setClientSearchMsg("اكتبي اسم أو رقم جوال للبحث.");
      return;
    }

    setClientSearching(true);
    setClientSearchMsg("");
    setSelectedClient(null);

    try {
      const found = await tryFindClientByPhoneOrName(q);

      if (!found) {
        setClientSearchMsg("ما لقينا عميلة مطابقة. كملي إدخال البيانات يدويًا.");
        return;
      }

      const name = String(found?.name || found?.fullName || "").trim();
      const phone = phone10Digits(found?.phone || found?.mobile || "");

      setSelectedClient(found);

      setFormData((prev) => ({
        ...prev,
        name: name || prev.name,
        phone: phone || prev.phone,
      }));

      setClientSearchMsg("تم جلب بيانات العميلة ✅");
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
  const [foundBookings, setFoundBookings] = useState<any[]>([]);
  const [selectedExistingBooking, setSelectedExistingBooking] = useState<any>(null);

  function normalizeSearchKey(raw: string) {
    return String(raw || "").trim();
  }

  function isLikelyPhoneOrMk(q: string) {
    const s = normalizeSearchKey(q);
    if (!s) return { kind: "empty" as const, value: "" };

    // 1) phone
    const digits10 = phone10Digits(s);
    if (/^05\d{8}$/.test(digits10)) return { kind: "phone" as const, value: digits10 };

    // 2) MK / QS / any prefixed publicId
    if (/^(mk|qs)\b/i.test(s) || /^mk[\-_ ]?/i.test(s)) {
      const cleaned = s.replace(/\s+/g, "").replace(/_/g, "-").toUpperCase();
      const m = cleaned.match(/^MK-?\d+$/);
      if (m) {
        const num = cleaned.replace(/^MK-?/i, "");
        return { kind: "publicId" as const, value: `MK-${num}` };
      }
      return { kind: "publicId" as const, value: cleaned };
    }

    // 3) digits only => treat as MK number
    const onlyDigits = s.replace(/\D/g, "");
    if (onlyDigits && onlyDigits.length >= 3 && onlyDigits.length <= 12) {
      return { kind: "publicId" as const, value: `MK-${onlyDigits}` };
    }

    // 4) otherwise treat as name
    const hasLetters = /[A-Za-z\u0600-\u06FF]/.test(s);
    if (hasLetters) return { kind: "name" as const, value: s.trim() };

    // 5) fallback: doc id
    return { kind: "id" as const, value: s };
  }

  async function searchBookingsForReception(raw: string) {
    const q0 = normalizeSearchKey(raw);
    const q = isLikelyPhoneOrMk(q0);
    if (q.kind === "empty") return [];

    const colBookings = collection(db, "salons", SALON_ID, "bookings");
    const out: any[] = [];

    // 1) by phone
    if (q.kind === "phone") {
      try {
        const snap = await getDocs(
          query(
            colBookings,
            where("clientPhone", "==", q.value),
            orderBy("createdAt", "desc"),
            limit(25)
          )
        );
        snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
      } catch {
        const snap = await getDocs(
          query(colBookings, where("clientPhone", "==", q.value), limit(25))
        );
        snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
      }
      return out;
    }

    // 2) by name (prefix on lower fields)
    if (q.kind === "name") {
      const nameRaw = String(q.value || "").trim();
      const nameLower = nameRaw.toLowerCase();

      if (nameLower) {
        // A) clientNameLower prefix
        try {
          const snap = await getDocs(
            query(
              colBookings,
              where("clientNameLower", ">=", nameLower),
              where("clientNameLower", "<=", nameLower + "\uf8ff"),
              orderBy("clientNameLower", "asc"),
              limit(25)
            )
          );
          snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
          if (out.length) return out;
        } catch { }

        // B) nameLower prefix (legacy)
        try {
          const snap = await getDocs(
            query(
              colBookings,
              where("nameLower", ">=", nameLower),
              where("nameLower", "<=", nameLower + "\uf8ff"),
              orderBy("nameLower", "asc"),
              limit(25)
            )
          );
          snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
          if (out.length) return out;
        } catch { }

        // C) fallback exact
        try {
          const snap = await getDocs(
            query(colBookings, where("clientName", "==", nameRaw), limit(25))
          );
          snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
          if (out.length) return out;
        } catch { }

        try {
          const snap = await getDocs(
            query(colBookings, where("name", "==", nameRaw), limit(25))
          );
          snap.docs.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
          if (out.length) return out;
        } catch { }
      }
    }

    // 3) by doc id direct
    try {
      const snap = await getDoc(doc(db, "salons", SALON_ID, "bookings", q.value));
      if (snap.exists()) return [{ id: snap.id, ...(snap.data() as any) }];
    } catch {
      // ignore
    }

    return out;
  }

  async function runFutureAvailabilitySearch() {
    setFutureMsg("");
    setFutureResult([]);

    const serviceId = String(servicePicker || "").trim();
    if (!serviceId) {
      setFutureMsg("اختاري خدمة أولاً.");
      return;
    }

    const sv = getServiceById(serviceId);
    if (!sv) {
      setFutureMsg("الخدمة غير موجودة.");
      return;
    }

    const durationMin = Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    if (!durationMin || durationMin <= 0) {
      setFutureMsg("مدة الخدمة غير صحيحة.");
      return;
    }

    // الموظفات للخدمة (موجود عندك staffByService)
    let staffList = staffByService[serviceId] || [];

    if (!staffList.length) {
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
      });

      setStaffByService((p) => ({ ...p, [serviceId]: staffList as any }));
    }

    const startISO = todayISO();
    const scanDays = 60;

    setFutureLoading(true);
    try {
      const results: { date: string; times: string[]; note?: string }[] = [];

      const resolvedByName =
        futureStaffOptions.find(
          (x) => String(x.name || "").trim() === String(futureStaffNameQuery || "").trim()
        )?.key || "";

      const fixedEmployeeKey = String(
        futureSelectedEmployeeKey || resolvedByName || ""
      ).trim();
      if (!futureAnyStaff && !fixedEmployeeKey) {
        setFutureMsg("اكتبي اسم الموظفة ثم اختاريها من النتائج.");
        return;
      }

      for (let i = 0; i < scanDays; i++) {
        const dateISO = addDaysISO(startISO, i);

        let dayTimes: string[] = [];

        if (!futureAnyStaff && fixedEmployeeKey) {
          const staff =
            staffList.find((s: any) => String(s.linkedUid || s.uid || s.id || "") === fixedEmployeeKey) ||
            staffList.find((s: any) => String(s.id || "") === fixedEmployeeKey);

          const employeeIdFallback = String(staff?.id || "").trim();

          dayTimes = await getAvailableStartsForDay({
            salonId: SALON_ID,
            employeeKey: fixedEmployeeKey,
            employeeIdFallback,
            dateISO,
            durationMin,
            take: 5,
          });
        } else {
          const merged = new Set<string>();

          for (const st of staffList) {
            const empKey = String(st?.linkedUid || "").trim() || String(st?.id || "").trim();
            const empIdFallback = String(st?.id || "").trim();
            if (!empKey) continue;

            const times = await getAvailableStartsForDay({
              salonId: SALON_ID,
              employeeKey: empKey,
              employeeIdFallback: empIdFallback,
              dateISO,
              durationMin,
              take: 5,
            });

            times.forEach((t) => merged.add(t));
          }

          dayTimes = Array.from(merged.values())
            .sort((a, b) => toMinutes(a) - toMinutes(b))
            .slice(0, 5);
        }

        if (dayTimes.length) results.push({ date: dateISO, times: dayTimes });

        if (results.length >= 5) break;
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
      setBookingSearchMsg("اكتب رقم جوال أو رقم الحجز (MK) أو رقم الوثيقة.");
      return;
    }

    setBookingSearching(true);
    setBookingSearchMsg("");
    setFoundBookings([]);
    setSelectedExistingBooking(null);

    try {
      const res = await searchBookingsForReception(q);
      if (!res.length) {
        setBookingSearchMsg("ما لقينا حجوزات مطابقة.");
        return;
      }
      setFoundBookings(res);
      setBookingSearchMsg(`تم العثور على ${res.length} حجز ✅`);
    } catch {
      setBookingSearchMsg("صار خطأ أثناء البحث عن الحجز.");
    } finally {
      setBookingSearching(false);
    }
  };

  async function confirmAndPrintExistingBooking(b: any) {
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
      await updateDoc(doc(db, "salons", SALON_ID, "bookings", id), {
        status: "confirmed",
        confirmedAt: Date.now(),
        confirmedByUid: staffUid,
        paidAt: Date.now(),
        paidByUid: staffUid,
        paymentMethod: "cash",
        channel: b?.channel || b?.source || "online",
      } as any);

      const refreshed = { ...b, status: "confirmed" };

      localStorage.setItem("currentBooking", JSON.stringify(refreshed));
      localStorage.setItem("allBookings", JSON.stringify([refreshed]));
      navigate("/success-internal");
    } catch (e: any) {
      openModal({
        title: "تعذر تأكيد الحجز",
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
    date: string
  ) {
    const taken = new Set<string>();

    for (const other of items) {
      if (!other) continue;
      if (other.id === currentItemId) continue;

      const otherKey = resolveEmployeeKey(other);
      const d = String(other.date || "").trim();
      const t = String(other.time || "").trim();

      if (!otherKey || !d || !t) continue;
      if (otherKey !== employeeKey) continue;
      if (d !== date) continue;

      const dur = Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN);
      const locked = getTimesToLock(timeSlots, slotStepMin, t, dur, bufferMin);
      locked.forEach((x) => taken.add(x));
    }

    return taken;
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
    const sid = String(servicePicker || "").trim();
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
  }, [servicePicker, staffByService]);

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
      const sid = String(servicePicker || "").trim();
      if (!sid) return;
      if ((staffByService[sid] || []).length > 0) return;

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
  }, [servicePicker, staffByService]);

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

  const getServiceById = (id: string) => servicesFlat.find((sv) => sv.id === id) || null;

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

  async function getAvailableStartsForDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    dateISO: string;
    durationMin: number;
    take: number;
  }) {
    const { salonId, employeeKey, employeeIdFallback, dateISO, durationMin, take } = args;

    const takenFs = new Set<string>();
    const colSlots = collection(db, "salons", salonId, "booking_slots");

    let snap = await getDocs(
      query(colSlots, where("employeeKey", "==", employeeKey), where("date", "==", dateISO))
    );

    if (!snap.docs.length && employeeIdFallback) {
      snap = await getDocs(
        query(colSlots, where("employeeId", "==", employeeIdFallback), where("date", "==", dateISO))
      );
    }

    snap.docs.forEach((d) => {
      const t = String((d.data() as any)?.time || "").trim();
      if (t) takenFs.add(t);
    });

    const greens = getGreenStartTimes({
      allSlots: timeSlots,
      slotStepMin,
      durationMin: Number(durationMin || DEFAULT_SERVICE_DURATION_MIN),
      bufferMin,
      takenAll: takenFs,
    });

    const list = Array.from(greens.values()).sort((a, b) => {
      const am = toMinutes(a) ?? 999999;
      const bm = toMinutes(b) ?? 999999;
      return am - bm;
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
          [itemId]: { ...(p[itemId] || emptyBusyState()), loading: true, hint: "" },
        }));

        try {
          const colSlots = collection(db, "salons", SALON_ID, "booking_slots");
          const empKey = resolveEmployeeKey(it);

          // 1) slots
          let snap = await getDocs(
            query(colSlots, where("employeeKey", "==", empKey), where("date", "==", date))
          );
          if (!snap.docs.length) {
            snap = await getDocs(
              query(colSlots, where("employeeId", "==", employeeId), where("date", "==", date))
            );
          }

          if (cancelled) return;

          const takenFs = new Set<string>();
          snap.docs.forEach((d) => {
            const t = String((d.data() as any)?.time || "").trim();
            if (t) takenFs.add(t);
          });

          // 2) local cart
          const takenLocal = getLocalTakenTimesForItem(items, itemId, empKey, date);

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
          let sequentialHint = "";
          let suggestedSlot = "";

          if (sequentialBooking) {
            // ✅ طور متتابع: نظهر فقط الأوقات الخضراء (التي تكفي مدة+بافر بدون تعارض)
            // + نعطي اقتراح "أقرب وقت" بعد آخر نهاية (اقتراح فقط لا يمنع باقي الأخضر)

            // احسب آخر نهاية (من FS + من السلة) للاقتراح فقط
            let lastEndMin = -1;

            // FS last
            let lastTakenMinFs = -1;
            snap.docs.forEach((d) => {
              const t = String((d.data() as any)?.time || "").trim();
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

            const greens = getGreenStartTimes({
              allSlots: timeSlots,
              slotStepMin,
              durationMin: Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
              bufferMin,
              takenAll,
            });

            // disabled = كل شيء غير أخضر (مع السماح بالوقت الحالي لو كان مختار)
            for (const s of timeSlots) {
              const start = s.value24;
              const isCurrentTime = String(it.time || "").trim() === start;
              if (!greens.has(start) && !isCurrentTime) disabled.add(start);
            }

            // suggestedSlot = أقرب أخضر بعد lastEndMin
            let targetSlot = "";
            if (lastEndMin !== -1) {
              for (const s of timeSlots) {
                const start = s.value24;
                const m = toMinutes(start);
                if (Number.isFinite(m) && m >= lastEndMin && greens.has(start)) {
                  targetSlot = start;
                  break;
                }
              }
            }
            if (!targetSlot) {
              targetSlot = Array.from(greens.values())[0] || "";
            }

            suggestedSlot = targetSlot;
            sequentialHint = targetSlot
              ? ""
              : "لا يوجد وقت متاح كافٍ لهذا اليوم مع هذه الموظفة.";
          } else {
            for (const s of timeSlots) {
              const start = s.value24;
              const isCurrentTime = String(it.time || "").trim() === start;
              if (takenAll.has(start) && !isCurrentTime) disabled.add(start);
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
              bookedMetaByTime,
            },
          }));
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
  }, [formData.items, sequentialBooking, timeSlots, slotStepMin, bufferMin]);

  // =========================
  // Handlers
  // =========================
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
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };

    const timesToCheck = getTimesToLock(
      timeSlots,
      slotStepMin,
      time,
      Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
      bufferMin
    );

    const localTaken = getLocalTakenTimesForItem(formData.items || [], it.id, employeeKey, date);
    const localConflict = timesToCheck.some((t) => localTaken.has(t));
    if (localConflict) {
      return { ok: false, msg: "هذا الوقت يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر." };
    }

    try {
      const snaps = await Promise.all(
        timesToCheck.map((t) => {
          const slotId = buildSlotId(SALON_ID, employeeKey, date, t);
          return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
        })
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
    const date = String(temp.date || "").trim();
    const time = String(temp.time || "").trim();
    if (!employeeKey || !date || !time) return;

    const timesToCheck = getTimesToLock(
      timeSlots,
      slotStepMin,
      time,
      Number(temp.durationMin || DEFAULT_SERVICE_DURATION_MIN),
      bufferMin
    );

    const localTaken = getLocalTakenTimesForItem(items, temp.id, employeeKey, date);
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
      const snaps = await Promise.all(
        timesToCheck.map((t) => {
          const slotId = buildSlotId(SALON_ID, employeeKey, date, t);
          return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
        })
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
          `• ${String(overlap.a?.serviceName || "—")} (${String(overlap.a?.time || "—")})\n` +
          `• ${String(overlap.b?.serviceName || "—")} (${String(overlap.b?.time || "—")})\n\n` +
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

        {/* =========================
            Date (reception picks first)
        ========================= */}
        <div className="card p-3 mb-3 bk-panel">
          <div className="row g-3 align-items-end">
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
                  setBookingDate(next);
                  // نخلي كل عناصر السلة تتبع تاريخ الصفحة (للاستقبال)
                  setFormData((p) => ({
                    ...p,
                    items: (p.items || []).map((it) => ({
                      ...it,
                      date: next,
                      time: "",
                      locked: false,
                      employeeId: "",
                      employeeUid: "",
                      employeeName: "",
                    })),
                  }));
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
        </div>

        {/* =========================
            Client search
        ========================= */}
        <div className="card p-3 mb-3 bk-panel">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div style={{ fontWeight: 800 }}>بحث عميلة (اختياري)</div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              يبحث بالاسم/الجوال من (clients/users)
            </span>
          </div>

          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-6">
              <label className="form-label">ابحثي باسم أو رقم جوال</label>
              <input
                className="form-control"
                value={clientSearch}
                onChange={(e) => setClientSearch(String(e.target.value || ""))}
                placeholder="مثال: 054xxxxxxx أو (نورة)"
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

            {selectedClient ? (
  <div className="alert alert-dark mt-2 mb-0 py-2" style={{ borderRadius: 12, fontSize: 13 }}>
    <b>تم اختيار عميلة:</b>{" "}
    {String(selectedClient?.name || selectedClient?.fullName || "—")}
    {" — "}
    {phone10Digits(selectedClient?.phone || selectedClient?.mobile || "")}
  </div>
) : null}

          </div>

          <hr />

          {/* =========================
              Booking search
          ========================= */}
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div style={{ fontWeight: 800 }}>بحث حجز موجود (تأكيد + طباعة)</div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              جوال / MK / bookingId
            </span>
          </div>

          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-6">
              <label className="form-label">ابحثي برقم جوال أو MK</label>
              <input
                className="form-control"
                value={bookingSearch}
                onChange={(e) => setBookingSearch(String(e.target.value || ""))}
                placeholder="مثال: 054xxxxxxx أو MK-123"
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
                    {foundBookings.map((b) => (
                      <tr key={String(b.id)}>
                        <td>{String(b.publicId || b.trackPublicId || b.mk || "—")}</td>
                        <td>{String(b.clientName || b.name || "—")}</td>
                        <td>{String(b.serviceName || b.serviceSnapshot?.serviceNameAtBooking || "—")}</td>
                        <td>{String(b.date || "—")}</td>
                        <td>{String(b.time || "—")}</td>
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
                              onClick={() => confirmAndPrintExistingBooking(b)}
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
                  </tbody>
                </table>
              </div>

              {selectedExistingBooking ? (
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
                      ["الوقت", String(selectedExistingBooking?.time || "—")],
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
            {/* left: catalog */}
            <div className="col-12 col-lg-5">
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

                {/* Future availability (helper) */}
                <hr className="my-3" />
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
                      onClick={runFutureAvailabilitySearch}
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

                              setBookingDate(nearestDate);
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
                                            setBookingDate(r.date);
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

            {/* right: cart + details */}
            <div className="col-12 col-lg-7">
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
                            <div>
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

                            <div>
                              <label className="form-label">الوقت</label>
                              <select
                                className="form-select bk-cart-select"
                                value={it.time}
                                disabled={!it.employeeId || !canEditByLockedPrev(formData.items || [], it.id)}
                                onChange={(e) => {
                                  const t = String(e.target.value || "").trim();
                                  updateItem(it.id, { time: t, locked: false });
                                  validatePickedTime(it.id, t);
                                }}
                              >
                                <option value="">اختاري وقت...</option>
                                {timeSlots.map((s) => {
                                  const t = s.value24;
                                  const dis = busy.disabledStartTimes?.has(t);
                                  const meta = busy.bookedMetaByTime?.[t];
                                  return (
                                    <option key={t} value={t} disabled={dis}>
                                      {s.label12}{meta ? ` — ${meta}` : ""}
                                    </option>
                                  );
                                })}
                              </select>

                              {busy.loading ? (
                                <div className="small mt-1 bk-availability-loading">
                                  <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                                  تحميل التوفر...
                                </div>
                              ) : busy.hint ? (
                                <div className="small mt-1 bk-availability-hint">{busy.hint}</div>
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
                                  أقرب وقت: {busy.suggestedSlot}
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
          </div>
        </form>

        </div>
      </div>
    </div>);
};

export default BookingInternal;
