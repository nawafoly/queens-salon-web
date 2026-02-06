// src/pages/BookingInternal.tsx

import { useEffect, useMemo, useState, useRef } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import logo from "../assets/images/ssunnamed2.png";
const hairGuideImg = "/hair-length-guide.png";

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
  slotLabelToMinutes,
  toMinutes,
} from "../helpers/timeSlots";
import { AppSettingsService } from "../services/AppSettingsService";

import "../styles/Booking.css";

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
} from "firebase/firestore";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../services/firebase";

// Auth
import { getAuth, onAuthStateChanged } from "firebase/auth";

// fallback Pricing
import { pricingSections } from "./Pricing";

// Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import { findActiveOfferByCode, offerAppliesToService } from "../services/firestoreOffers";

// Staff
import { listActiveStaffBySpecialty, type StaffPublicWithId } from "../services/firestoreStaffPublic";

// Catalog
import { listActiveSections, type SectionDoc, type CategoryDoc, type ServiceDoc } from "../services/firestoreCatalog";

// Create booking
import { createBooking } from "../services/firestoreBookings";

// Profile loader (للعميلة لما تكون مسجلة دخول بالصفحات العامة)
import { createOrLoadUserProfile } from "../services/userProfile";

// Modal
import ConfirmModal from "../components/ConfirmModal";

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
  time: string; // slot string
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

function buildSlotId(salonId: string, employeeKey: string, date: string, time: string) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
}

function getTimesToLock(
  allSlots: string[],
  slotStepMin: number,
  startTime: string,
  durationMin: number,
  bufferMin: number
) {
  const startMin = slotLabelToMinutes(startTime);
  if (startMin == null) return [startTime];

  const step = Math.max(1, Number(slotStepMin || 0));
  const totalMin = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (totalMin <= 0) return [startTime];

  const slotsToLock = Math.max(1, Math.ceil(totalMin / step));

  const locked: string[] = [];
  for (let i = 0; i < slotsToLock; i++) {
    const targetMin = startMin + i * step;
    const t = allSlots.find((label) => slotLabelToMinutes(label) === targetMin);
    if (t) locked.push(t);
  }

  return locked.length ? locked : [startTime];
}

function getGreenStartTimes(args: {
  allSlots: string[];
  slotStepMin: number;
  durationMin: number;
  bufferMin: number;
  takenAll: Set<string>;
}) {
  const greens = new Set<string>();

  for (const start of args.allSlots) {
    const needed = getTimesToLock(
      args.allSlots,
      args.slotStepMin,
      start,
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
    if (ok) greens.add(start);
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

  // ✅ NEW: تفاصيل الحجز الموجود على الوقت (يطلع في الـ UI)
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
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
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

  const timeSlots = useMemo(() => {
    return generateSalonTimeSlots(openTime, closeTime, slotStepMin);
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
  const [catalogMode, setCatalogMode] = useState<"firestore" | "pricing">("pricing");
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
  const [bookingDate, setBookingDate] = useState<string>("");

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

  const [staffByService, setStaffByService] = useState<Record<string, StaffPublicWithId[]>>({});
  const [staffLoadingByService, setStaffLoadingByService] = useState<Record<string, boolean>>({});
  const [staffErrorByService, setStaffErrorByService] = useState<Record<string, string>>({});

  const [uiModal, setUiModal] = useState<UiModalState>({
    open: false,
    title: "",
    message: "",
    variant: "info",
    confirmText: "حسنًا",
  });

  const [onUiConfirm, setOnUiConfirm] = useState<null | (() => void)>(null);

  const openModal = (data: Omit<UiModalState, "open">, onConfirmAction?: () => void) => {
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
          const snap = await getDocs(query(col, where("phone", "==", qDigits), limit(5)));
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
        snap = await getDocs(query(col, where("nameLower", "==", nameLower), limit(5)));
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
    } catch (e: any) {
      setClientSearchMsg("صار خطأ أثناء البحث.");
    } finally {
      setClientSearching(false);
    }
  };

  // =========================
  // ✅ الاستقبال: لا نعمل Autofill من حساب العميلة (هذا مو مكانه)
  // =========================
  // (مقصود) — لا تستخدم createOrLoadUserProfile هنا للعميلة
  // لأن المستخدم المسجل هو موظفة الاستقبال.

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
          getTimesToLock(timeSlots, slotStepMin, timeA, Number(a.durationMin || DEFAULT_SERVICE_DURATION_MIN), bufferMin)
        );
        const bLocked = new Set(
          getTimesToLock(timeSlots, slotStepMin, timeB, Number(b.durationMin || DEFAULT_SERVICE_DURATION_MIN), bufferMin)
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
  // Load hair guide URL + role
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadGuideUrl() {
      try {
        const guideRef = doc(db, "salons", SALON_ID, "settings", "booking");
        const guideSnap = await getDoc(guideRef);

        if (!cancelled) {
          const url = String((guideSnap.data() as any)?.hairGuideUrl || "").trim();
          setHairGuideUrl(url ? url : hairGuideImg);
        }
      } catch {
        if (!cancelled) setHairGuideUrl(hairGuideImg);
      }
    }

    loadGuideUrl();

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
    return () => { cancelled = true; };
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
            query(catsCol, where("sectionId", "==", selectedSectionId), orderBy("order", "asc"))
          );
        } catch {
          catsSnap = await getDocs(query(catsCol, where("sectionId", "==", selectedSectionId)));
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
          const snap = await getDocs(query(colRef, where("sectionId", "==", selectedSectionId)));
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

        const secSnap = await getDocs(query(colRef, where("sectionId", "==", selectedSectionId)));
        if (cancelled) return;

        const merged: any[] = [];
        snaps.forEach((sn) => sn.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) })));
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
    return () => { cancelled = true; };
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

        const affectsChain = patch.employeeId !== undefined || patch.time !== undefined || patch.date !== undefined;
        if (i > idx && affectsChain) {
          return {
            ...it,
            locked: false,
            ...(patch.date !== undefined ? { employeeId: "", employeeUid: "", employeeName: "", time: "" } : {}),
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
        new Set((formData.items || []).map((it) => String(it.serviceId || "").trim()).filter(Boolean))
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

          const today = todayISO();

          const filtered = (res || []).filter((st: any) => {
            const name = String(st?.name || "").trim();
            if (!name) return false;
            if (st?.showOnBooking === false) return false;
            if (st?.active === false) return false;

            const onLeave = !!st?.onLeave;
            const leaveUntil = String(st?.leaveUntil || "").trim();
            if (onLeave) {
              if (!leaveUntil) return false;
              if (leaveUntil >= today) return false;
            }

            const specs = Array.isArray(st?.specialties)
              ? st.specialties.map((x: any) => String(x || "").trim()).filter(Boolean)
              : [];

            return specs.includes(sid);
          });

          setStaffByService((p) => ({ ...p, [sid]: filtered }));

          if (!filtered.length) {
            setStaffErrorByService((p) => ({
              ...p,
              [sid]: `ما فيه موظفات لهذه الخدمة حالياً.`,
            }));
          }
        } catch (e: any) {
          const msg = String(e?.message || "");
          let err = "تعذر تحميل قائمة الموظفات.";
          if (msg.toLowerCase().includes("requires an index"))
            err = "Firestore يحتاج Index للاستعلام. افتح Console واضغط Create index.";
          if (msg.toLowerCase().includes("missing or insufficient permissions"))
            err = "صلاحيات قراءة الموظفات غير كافية (staff_public).";

          setStaffByService((p) => ({ ...p, [sid]: [] }));
          setStaffErrorByService((p) => ({ ...p, [sid]: err }));
        } finally {
          if (!cancelled) setStaffLoadingByService((p) => ({ ...p, [sid]: false }));
        }
      }
    }

    loadNeededStaff();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items]);

  // =========================
  // ✅ Busy slots per item + + تحميل معلومات الحجز الموجود
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
          let snap = await getDocs(query(colSlots, where("employeeKey", "==", empKey), where("date", "==", date)));
          if (!snap.docs.length) {
            snap = await getDocs(query(colSlots, where("employeeId", "==", employeeId), where("date", "==", date)));
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

          // ✅ NEW: load bookings meta (مين حاجز)
          const bookedMetaByTime: Record<string, string> = {};
          try {
            const colBookings = collection(db, "salons", SALON_ID, "bookings");
            // نحاول employeeKey أول، ثم employeeId
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

              // اعتبر الملغي/المرفوض غير مؤثر
              if (["cancelled", "canceled", "rejected"].includes(status)) return;

              const clientName = String(data?.clientName || data?.name || "").trim();
              const clientPhone = phone10Digits(data?.clientPhone || data?.phone || "");
              const channel = String(data?.channel || data?.source || "").trim();

              const who = [clientName || "بدون اسم", clientPhone ? `(${clientPhone})` : ""].filter(Boolean).join(" ");
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
            let lastEndMin = -1;
            let lastTakenMinFs = -1;

            snap.docs.forEach((d) => {
              const t = String((d.data() as any)?.time || "").trim();
              const m = slotLabelToMinutes(t);
              if (m !== null) lastTakenMinFs = Math.max(lastTakenMinFs, m);
            });

            if (lastTakenMinFs !== -1) lastEndMin = Math.max(lastEndMin, lastTakenMinFs + slotStepMin);

            let lastTakenMinLocal = -1;
            items.forEach((other) => {
              if (other.id === itemId) return;

              const otherEmpKey = resolveEmployeeKey(other);
              if (otherEmpKey !== empKey) return;
              if (String(other.date || "").trim() !== date) return;

              const start = String(other.time || "").trim();
              if (!start) return;

              const locked = getTimesToLock(timeSlots, slotStepMin, start, Number(other.durationMin || 0), bufferMin);
              locked.forEach((label) => {
                const mm = slotLabelToMinutes(label);
                if (mm !== null) lastTakenMinLocal = Math.max(lastTakenMinLocal, mm);
              });
            });

            if (lastTakenMinLocal !== -1) lastEndMin = Math.max(lastEndMin, lastTakenMinLocal + slotStepMin);

            const openMin = toMinutes(openTime);

            if (lastEndMin === -1) {
              for (const start of timeSlots) {
                const m = slotLabelToMinutes(start);
                if (m !== null && m !== openMin) disabled.add(start);
              }

              const firstSlot = timeSlots.find((s) => slotLabelToMinutes(s) === openMin) || "";
              suggestedSlot = firstSlot;
              sequentialHint = "هذا اليوم متاح بالكامل، يرجى الحجز من بداية اليوم.";
            } else {
              let targetSlot = "";
              for (const start of timeSlots) {
                const m = slotLabelToMinutes(start);
                if (m !== null && m >= lastEndMin) {
                  targetSlot = start;
                  break;
                }
              }

              for (const start of timeSlots) {
                if (start !== targetSlot) disabled.add(start);
              }

              suggestedSlot = targetSlot || "";
              if (targetSlot) {
                sequentialHint = `لتقليل هدر الوقت، يرجى الحجز في الوقت المتاح التالي: ${targetSlot}`;
              } else {
                sequentialHint = "لا يوجد وقت متاح كافٍ لهذا اليوم مع هذه الموظفة.";
              }
            }
          } else {
            for (const start of timeSlots) {
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
    return () => { cancelled = true; };
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

    const timesToCheck = getTimesToLock(timeSlots, slotStepMin, time, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN), bufferMin);

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

    const timesToCheck = getTimesToLock(timeSlots, slotStepMin, time, Number(temp.durationMin || DEFAULT_SERVICE_DURATION_MIN), bufferMin);

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
          String(it.serviceSectionId || "").trim() || String(sv?.sectionId || "").trim() || undefined;

        const res = await createBooking({
          userId: staffUid, // ✅ creator uid (staff)
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
          time: String(it.time || "").trim(),

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

          name: String(formData.name || "").trim(),
          phone,

          service: it.serviceId,
          serviceName: it.serviceName,

          employee: String(it.employeeName || "").trim(),
          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim(),

          date: String(it.date || "").trim(),
          time: String(it.time || "").trim(),

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
    <div className="booking-page py-5">
      <ConfirmModal
        open={uiModal.open}
        title={uiModal.title}
        message={uiModal.message}
        variant={uiModal.variant}
        confirmText={uiModal.confirmText || "حسنًا"}
        onConfirm={() => {
          const fn = onUiConfirm;
          closeModal();
          if (fn) fn();
        }}
        onCancel={closeModal}
      />

      <div className="container">
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <div className="booking-card">
              <div className="booking-header">
                <div className="booking-logo">
                  <img src={logo} alt="Queens Salon Logo" />
                </div>

                <h1 className="booking-title">حجز داخلي — الاستقبال</h1>

                {/* ✅ NEW: بحث العميلة */}
                <div className="mt-3" style={{ maxWidth: 560, margin: "0 auto" }}>
                  <label className="form-label fw-bold small">بحث العميلة (اسم أو جوال)</label>

                  <div className="input-group">
                    <span className="input-group-text">
                      <FontAwesomeIcon icon={faSearch} />
                    </span>
                    <input
                      className="form-control"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="مثال: 055xxxxxxx أو اسم العميلة"
                      disabled={clientSearching || isLoading}
                    />
                    <button
                      type="button"
                      className="btn btn-dark"
                      onClick={handleSearchClient}
                      disabled={clientSearching || isLoading}
                    >
                      {clientSearching ? (
                        <>
                          <FontAwesomeIcon icon={faSpinner} spin /> بحث...
                        </>
                      ) : (
                        "بحث"
                      )}
                    </button>

                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={clientSearching || isLoading}
                      onClick={() => {
                        setClientSearch("");
                        setClientSearchMsg("");
                        setSelectedClient(null);
                      }}
                      title="مسح"
                    >
                      <FontAwesomeIcon icon={faTimesCircle} />
                    </button>
                  </div>

                  {clientSearchMsg && (
                    <div className={`small mt-2 ${clientSearchMsg.includes("✅") ? "text-success" : "text-muted"}`}>
                      {clientSearchMsg}
                    </div>
                  )}

                  {selectedClient && (
                    <div className="mt-2 small" style={{ background: "#f7f7f7", borderRadius: 10, padding: 10 }}>
                      <div><strong>تم اختيار:</strong> {String(selectedClient?.name || selectedClient?.fullName || "—")}</div>
                      <div className="text-muted">الجوال: {phone10Digits(selectedClient?.phone || selectedClient?.mobile || "") || "—"}</div>
                    </div>
                  )}
                </div>
              </div>

              <form className="booking-form" onSubmit={handleSubmit}>
                <div className="row">
                  <div className="col-md-6 mb-4">
                    <label htmlFor="name" className="form-label">الاسم</label>
                    <div className="input-group">
                      <span className="input-group-text" aria-hidden="true">
                        <FontAwesomeIcon icon={faUser} />
                      </span>

                      {/* ✅ الاستقبال يكتب دائمًا */}
                      <input
                        type="text"
                        className="form-control"
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="اسم العميلة"
                        required
                      />
                    </div>
                  </div>

                  <div className="col-md-6 mb-4">
                    <label htmlFor="phone" className="form-label">رقم الجوال</label>
                    <div className="input-group">
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faPhone} />
                      </span>

                      {/* ✅ الاستقبال يكتب دائمًا */}
                      <input
                        type="tel"
                        inputMode="numeric"
                        className="form-control"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        onChange={(e) => {
                          const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setFormData((prev) => ({ ...prev, phone: digitsOnly }));
                        }}
                        placeholder="05xxxxxxxx"
                        required
                        maxLength={10}
                      />
                    </div>
                  </div>

                  <div className="col-12 mb-4">
                    <label htmlFor="bookingDate" className="form-label">تاريخ الحجز</label>

                    <div
                      className="input-group"
                      role="button"
                      tabIndex={0}
                      onClick={() => dateRef.current?.showPicker?.() || dateRef.current?.focus()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          dateRef.current?.showPicker?.() || dateRef.current?.focus();
                        }
                      }}
                    >
                      <span className="input-group-text" aria-hidden="true">
                        <FontAwesomeIcon icon={faCalendarAlt} />
                      </span>

                      <input
                        ref={dateRef}
                        type="date"
                        className="form-control"
                        id="bookingDate"
                        value={bookingDate}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBookingDate(v);

                          setFormData((prev) => ({
                            ...prev,
                            items: (prev.items || []).map((it) => {
                              const sv = getServiceById(String(it.serviceId || "").trim());
                              const basePatch = { ...it, date: v, time: "" };

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
                        }}
                        min={todayISO()}
                      />
                    </div>
                  </div>
                </div>

                {/* إضافة خدمة */}
                <div
                  className="mb-4 bk-field"
                  style={{ border: "1px solid #eee", padding: "15px", borderRadius: "12px", background: "#fafafa" }}
                >
                  <label className="form-label" style={{ fontWeight: "bold" }}>أضيفي خدمة جديدة</label>

                  <div className="row g-2">
                    <div className="col-md-4">
                      <select
                        className="form-select dash-select"
                        value={selectedSectionId}
                        onChange={(e) => handleSectionChange(e as any)}
                        disabled={!bookingDate || catalogLoading}
                      >
                        <option value="">اختاري القسم</option>
                        {sectionOptions.map((sec) => (
                          <option key={sec.id} value={sec.id}>{sec.title}</option>
                        ))}
                      </select>
                    </div>

                    <div className="col-md-4">
                      <select
                        className="form-select dash-select"
                        value={selectedCategory}
                        onChange={(e) => handleCategoryChange(e as any)}
                        disabled={!bookingDate || !selectedSectionId || catalogLoading}
                      >
                        <option value="">اختاري التصنيف</option>
                        {categoryOptions.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="col-md-4">
                      <div className="input-group">
                        <select
                          className="form-select dash-select"
                          value={servicePicker}
                          onChange={(e) => setServicePicker(e.target.value)}
                          disabled={!bookingDate || !selectedSectionId}
                        >
                          <option value="">اختاري الخدمة</option>
                          {servicesGrouped.map(([cat, items]) => (
                            <optgroup key={cat} label={cat}>
                              {items.map((sv) => (
                                <option key={sv.id} value={sv.id}>
                                  {sv.name} — {sv.priceText}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>

                        <button
                          type="button"
                          className="btn btn-dark"
                          disabled={!servicePicker}
                          onClick={() => addServiceToCart(servicePicker)}
                        >
                          إضافة
                        </button>
                      </div>
                    </div>
                  </div>

                  {selectedSectionId && isHairSection && (
                    <div className="mt-3" style={{ border: "1px dashed rgba(13,13,13,0.18)", borderRadius: 14, padding: 12 }}>
                      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                        <div style={{ fontWeight: 900, color: "#0D0D0D" }}>
                          📏 دليل أطوال الشعر
                          <div className="small text-muted" style={{ fontWeight: 700 }}>
                            اختاري طول الشعر من الصورة قبل إكمال الحجز
                          </div>
                        </div>

                        <div className="d-flex align-items-center gap-2">
                          <button type="button" className="btn btn-outline-dark btn-sm" onClick={() => setShowHairGuide((v) => !v)}>
                            {showHairGuide ? "إخفاء الصورة" : "عرض الصورة"}
                          </button>

                          {isOwner && (
                            <>
                              <input
                                id="hairGuideUploadInput"
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadHairGuide(f);
                                  e.currentTarget.value = "";
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-dark btn-sm"
                                disabled={uploadingGuide}
                                onClick={() => document.getElementById("hairGuideUploadInput")?.click()}
                              >
                                {uploadingGuide ? "جاري الرفع..." : "رفع صورة"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {showHairGuide && (
                        <div className="mt-3 text-center">
                          <img
                            src={hairGuideUrl}
                            alt="دليل أطوال الشعر"
                            style={{ width: "100%", maxWidth: 520, borderRadius: 16, boxShadow: "0 10px 28px rgba(0,0,0,0.14)" }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* الخدمات المختارة */}
                <div className="mb-4">
                  <label className="form-label" style={{ fontWeight: "bold" }}>الخدمات المختارة</label>

                  {!!(formData.items || []).length ? (
                    <div className="mt-2">
                      {(formData.items || []).map((it) => {
                        const busy = busyByItem[it.id] || emptyBusyState();
                        const itemsList = formData.items || [];
                        const canEditThis = canEditByLockedPrev(itemsList, it.id);
                        const isLocked = !!it.locked;

                        const dur = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
                        const greenStarts = getGreenStartTimes({
                          allSlots: timeSlots,
                          slotStepMin,
                          durationMin: dur,
                          bufferMin,
                          takenAll: busy.busyTimes,
                        });

                        const serviceStaff = staffByService[it.serviceId] || [];
                        const staffLoading = !!staffLoadingByService[it.serviceId];
                        const staffError = staffErrorByService[it.serviceId] || "";

                        if (isLocked) {
                          return (
                            <div
                              key={it.id}
                              className="mb-3"
                              style={{
                                background: "#f0fff4",
                                borderLeft: "4px solid #28a745",
                                padding: "15px",
                                borderRadius: "8px",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                              }}
                            >
                              <div className="d-flex justify-content-between align-items-start">
                                <div>
                                  <p style={{ margin: 0, fontWeight: "bold", color: "#155724", fontSize: "1.1rem" }}>
                                    ✓ تم تأكيد هذه الخدمة: {it.serviceName}
                                  </p>
                                  <p style={{ margin: "5px 0 0 0", color: "#155724" }}>
                                    مع الموظفة <strong>{it.employeeName}</strong> الساعة <strong>{it.time}</strong>
                                  </p>
                                  <p style={{ margin: "5px 0 0 0", fontSize: "0.9rem", color: "#155724", opacity: 0.8 }}>
                                    المدة: {dur} دقيقة | السعر: {it.priceText}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  className="btn btn-link p-0"
                                  style={{ color: "#155724", textDecoration: "underline", fontWeight: "bold" }}
                                  onClick={() => {
                                    const list = formData.items || [];
                                    const idx = list.findIndex((x) => x.id === it.id);
                                    setFormData((prev) => ({
                                      ...prev,
                                      items: (prev.items || []).map((x, i) => {
                                        if (i === idx) return { ...x, locked: false };
                                        if (i > idx) return { ...x, locked: false, time: "", employeeId: "", employeeUid: "", employeeName: "" };
                                        return x;
                                      }),
                                    }));
                                  }}
                                >
                                  تعديل
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={it.id}
                            className="mb-3 p-3"
                            style={{
                              border: "1px solid rgba(13,13,13,0.12)",
                              borderRadius: 12,
                              background: canEditThis ? "#fff" : "rgba(245,245,244,0.75)",
                              opacity: canEditThis ? 1 : 0.7,
                            }}
                          >
                            <div className="d-flex justify-content-between align-items-center mb-3">
                              <h5 style={{ margin: 0, fontWeight: "bold" }}>
                                {it.serviceName}{" "}
                                <span className="badge bg-secondary ms-2" style={{ fontSize: "0.7rem" }}>
                                  {it.priceText}
                                </span>
                              </h5>

                              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeServiceFromCart(it.id)}>
                                حذف
                              </button>
                            </div>

                            {!canEditThis ? (
                              <div className="p-3 text-center" style={{ background: "#fff9db", borderRadius: "8px", border: "1px solid #ffe066" }}>
                                <p style={{ margin: 0, fontWeight: "bold", color: "#856404" }}>
                                  ⚠️ كمّلي الخدمة اللي قبلها عشان يفتح هذا الكرت ✅
                                </p>
                              </div>
                            ) : (
                              <div className="row g-3">
                                <div className="col-md-6">
                                  <label className="form-label small fw-bold">1. اختاري الموظفة</label>
                                  <div className="input-group">
                                    <span className="input-group-text">
                                      <FontAwesomeIcon icon={faUserTie} />
                                    </span>

                                    <select
                                      className="form-select"
                                      value={it.employeeId}
                                      onChange={(e) => {
                                        const empId = e.target.value;
                                        const emp = serviceStaff.find((x) => x.id === empId);
                                        updateItem(it.id, { employeeId: empId, employeeUid: emp?.linkedUid || "", employeeName: emp?.name || "", time: "" });
                                      }}
                                    >
                                      <option value="">اختاري الموظفة</option>
                                      {serviceStaff.map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                          {emp.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {staffLoading && (
                                    <div className="small text-muted mt-1">
                                      <FontAwesomeIcon icon={faSpinner} spin /> جاري التحميل...
                                    </div>
                                  )}
                                  {staffError && <div className="text-danger small mt-1">{staffError}</div>}
                                </div>

                                {it.employeeId && (
                                  <div className="col-12">
                                    <label className="form-label small fw-bold">2. اختاري الوقت المتاح</label>

                                    <div className="bk-time-grid">
                                      {timeSlots.map((t) => {
                                        const suggested = String(busy.suggestedSlot || "").trim();
                                        const disabled = busy.disabledStartTimes.has(t);
                                        const isGreen = greenStarts.has(t) && !disabled;
                                        const isSelected = it.time === t;
                                        const isSequentialSuggested = sequentialBooking && suggested === t && !disabled;

                                        const bookedLabel = busy.bookedMetaByTime[t] || "";
                                        const title = bookedLabel ? bookedLabel : disabled ? "غير متاح" : "متاح";

                                        return (
                                          <button
                                            key={t}
                                            type="button"
                                            className={[
                                              "bk-time-chip",
                                              isGreen && !sequentialBooking ? "is-green" : "",
                                              isSequentialSuggested ? "is-sequential-suggested" : "",
                                              disabled ? "is-disabled" : "",
                                              isSelected ? "is-selected" : "",
                                            ].join(" ")}
                                            disabled={disabled || busy.loading}
                                            title={title}
                                            onClick={() => {
                                              updateItem(it.id, { time: t });
                                              validatePickedTime(it.id, t);
                                            }}
                                          >
                                            {t}
                                            {bookedLabel && (
                                              <span style={{ display: "block", fontSize: 10, opacity: 0.85, marginTop: 3 }}>
                                                محجوز
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {busy.loading && (
                                      <div className="small text-muted mt-2">
                                        <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الأوقات...
                                      </div>
                                    )}

                                    {busy.hint && <div className="small text-warning mt-2">{busy.hint}</div>}

                                    {it.time && (
                                      <div className="mt-3 text-center">
                                        <button
                                          type="button"
                                          className="btn btn-success w-100 py-2 fw-bold"
                                          onClick={() => updateItem(it.id, { locked: true })}
                                        >
                                          تأكيد الموظفة والوقت لهذه الخدمة ✅
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 text-center" style={{ border: "2px dashed #ddd", borderRadius: "12px", background: "#fdfdfd" }}>
                      <p className="text-muted m-0">اختاري خدمة من القائمة أعلاه للبدء ✨</p>
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <label htmlFor="note" className="form-label">ملاحظة (اختياري)</label>
                  <textarea className="form-control" id="note" name="note" value={formData.note} onChange={handleChange} rows={3} placeholder="أي ملاحظة…" />
                </div>

                <div className="mb-4">
                  <label className="form-label">كود الخصم (اختياري)</label>
                  <div className="input-group">
                    <input
                      type="text"
                      className="form-control"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      placeholder="اكتبي الكود هنا"
                      disabled={!formData.items?.length || isLoading}
                    />
                    <button
                      type="button"
                      className="btn btn-dark"
                      onClick={handleApplyCoupon}
                      disabled={!formData.items?.length || isLoading}
                    >
                      تطبيق
                    </button>
                  </div>

                  {offerMsg && (
                    <div className={`small mt-2 ${offerMsg.includes("✅") ? "text-success" : "text-danger"}`}>
                      {offerMsg}
                    </div>
                  )}
                </div>

                <div className="booking-summary mb-4 qs-black">
                  <div className="d-flex justify-content-between">
                    <span>السعر</span>
                    <strong>{basePrice ? `${basePrice} ريال` : "—"}</strong>
                  </div>

                  {applied.offer && (
                    <div className="d-flex justify-content-between mt-1">
                      <span>الخصم</span>
                      <strong>-{Number(applied.discountAmount || 0)} ريال</strong>
                    </div>
                  )}

                  <div className="d-flex justify-content-between mt-2">
                    <span>الإجمالي</span>
                    <strong>{finalPrice ? `${finalPrice} ريال` : "—"}</strong>
                  </div>

                  <div className="small text-muted mt-2">
                    الاستقبال يدخل بيانات العميلة يدويًا ✅ — والوقت المحجوز يبان مباشرة.
                  </div>
                </div>

                <button type="submit" className="btn btn-primary w-100 booking-submit-btn" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <FontAwesomeIcon icon={faSpinner} spin /> جاري تأكيد الحجز…
                    </>
                  ) : (
                    "تأكيد الحجز النهائي (الاستقبال)"
                  )}
                </button>

                <div className="small text-muted mt-3 text-center">هذا الحجز يتم بواسطة الاستقبال ✨</div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingInternal;
