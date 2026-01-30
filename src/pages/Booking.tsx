// src/pages/Booking.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import logo from "../assets/images/ssunnamed2.png";

import {
  faCalendarAlt,
  faClock,
  faUser,
  faPhone,
  faSpinner,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { generateSalonTimeSlots } from "../helpers/timeSlots";
import { AppSettingsService } from "../services/AppSettingsService";

import "../styles/Booking.css";

// ✅ Firestore slot availability check
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../services/firebase";

// ✅ Firebase Auth (للقراءة فقط)
import { getAuth } from "firebase/auth";

// ✅ fallback Pricing (مؤقت فقط إذا Firestore فاضي)
import { pricingSections } from "./Pricing";

// ✅ Firestore Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import {
  findActiveOfferByCode,
  offerAppliesToService,
} from "../services/firestoreOffers";

// ✅ Staff Public (Firestore)
import {
  listActiveStaffBySpecialty,
  type StaffPublicWithId,
} from "../services/firestoreStaffPublic";

// ✅ Catalog from Firestore (Sections/Categories/Services)
import {
  listActiveSections,
  type SectionDoc,
  type CategoryDoc,
  type ServiceDoc,
} from "../services/firestoreCatalog";

// ✅ Create booking (Firestore)
import { createBooking } from "../services/firestoreBookings";

// ✅ Custom modal بدل alert
import ConfirmModal from "../components/ConfirmModal";

/* =========================
   Types
========================= */

type CartItem = {
  id: string; // local id
  serviceId: string;
  serviceName: string;
  basePrice: number;
  priceText: string;
  durationMin: number;

  employeeId: string; // staff_public doc id
  employeeUid?: string; // linkedUid
  employeeName?: string;

  date: string; // YYYY-MM-DD
  time: string; // slot string
};

interface BookingFormData {
  name: string;
  phone: string;
  note?: string;

  // ✅ سلة خدمات: كل خدمة لها (موظفة/تاريخ/وقت)
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

  // ✅ التصنيف
  categoryId?: string; // Firestore فقط
  category: string; // اسم التصنيف للعرض (Firestore/Pricing)
  name: string;

  // ✅ حقول تسعير/عرض
  priceText: string;
  basePrice: number;

  // ✅ مدة من Firestore إذا كانت موجودة
  durationMin?: number;

  // ✅ معرفة مصدر الخدمة
  source: "firestore" | "pricing";
};

type CategoryOption = { id: string; name: string };

const SALON_ID = "main";
const DEFAULT_SERVICE_DURATION_MIN = 60;

// ✅ نفس منطق slotId الموجود في firestoreBookings.ts
function safeKey(v: string) {
  return String(v || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
}

function buildSlotId(salonId: string, employeeKey: string, date: string, time: string) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
}

const BUFFER_MIN = 0;

function getTimesToLock(
  allSlots: string[],
  slotStepMin: number,
  startTime: string,
  durationMin: number
) {
  const idx = allSlots.indexOf(startTime);
  if (idx < 0) return [startTime];

  const step = Math.max(1, Number(slotStepMin || 10));
  const totalMin = Math.max(0, Number(durationMin || 0)) + Math.max(0, BUFFER_MIN);
  const slotsNeeded = Math.max(1, Math.ceil(totalMin / step));
  return allSlots.slice(idx, idx + slotsNeeded);
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

/**
 * ✅ صلاحية العرض حسب "تاريخ الحجز" (مو اليوم)
 */
function isOfferValidForBookingDate(offer: any, bookingDateISO: string) {
  if (!bookingDateISO) return { ok: true, reason: "" };

  const s = String(offer?.startDate || "").trim();
  const e = String(offer?.endDate || "").trim();

  if (s && bookingDateISO < s) return { ok: false, reason: `العرض يبدأ من ${s}` };
  if (e && bookingDateISO > e) return { ok: false, reason: `العرض انتهى بتاريخ ${e}` };
  return { ok: true, reason: "" };
}

// ✅ نبي UID الحقيقي فقط (إذا مسجل دخول) ونرفض anonymous
function getSignedInUidOrNull(): string | null {
  const auth = getAuth();
  const u = auth.currentUser;
  if (!u) return null;
  if ((u as any).isAnonymous) return null;
  return u.uid;
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
};

const emptyBusyState = (): BusyState => ({
  busyTimes: new Set(),
  disabledStartTimes: new Set(),
  loading: false,
  hint: "",
});

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

const Booking = () => {
  const navigate = useNavigate();

  // =========================
  // ✅ Settings (live)
  // =========================
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const booking = (appSettings as any)?.booking || {};
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
    return [10, 15, 30].includes(v) ? v : 10;
  }, [(booking as any)?.slotStepMin]);


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

  // ✅ busy/disabled per item
  const [busyByItem, setBusyByItem] = useState<Record<string, BusyState>>({});

  // ✅ Staff per serviceId
  const [staffByService, setStaffByService] = useState<Record<string, StaffPublicWithId[]>>({});
  const [staffLoadingByService, setStaffLoadingByService] = useState<Record<string, boolean>>({});
  const [staffErrorByService, setStaffErrorByService] = useState<Record<string, string>>({});

  // ✅ Modal بدل alert
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
  // Supports BOTH schemas:
  // A) categories + services.categoryId
  // B) old: services.sectionId (no categories)
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

        // ✅ 2) لو ما فيه تصنيفات: رجّع للنظام القديم وجيب الخدمات بالـ sectionId
        if (catIds.length === 0) {
          const colRef = collection(db, "salons", SALON_ID, "services");
          const snap = await getDocs(query(colRef, where("sectionId", "==", selectedSectionId)));

          if (cancelled) return;

          const merged = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          const activeOnly = merged.filter((x) => x?.active !== false);

          setFsServices(activeOnly);
          return;
        }

        // ✅ 3) schema الجديد: services مرتبطة بـ categoryId (in chunks of 10)
        // ✅ + نجيب خدمات legacy: sectionId == selectedSectionId
        const chunks: string[][] = [];
        for (let i = 0; i < catIds.length; i += 10) chunks.push(catIds.slice(i, i + 10));

        const colRef = collection(db, "salons", SALON_ID, "services");

        const snaps = await Promise.all(
          chunks.map((arr) => getDocs(query(colRef, where("categoryId", "in", arr))))
        );

        const secSnap = await getDocs(query(colRef, where("sectionId", "==", selectedSectionId)));

        if (cancelled) return;

        const merged: any[] = [];

        snaps.forEach((sn) => {
          sn.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));
        });

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
  // Filter FS services by categoryId
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
  // One source services list (Firestore else Pricing)
  // =========================
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

    return Object.entries(pricingSections).map(([id, sec]) => ({
      id,
      title: sec.title,
    }));
  }, [catalogMode, fsSections]);

  const categoryOptions: CategoryOption[] = useMemo(() => {
    if (!selectedSectionId) return [];

    if (catalogMode === "firestore" && fsSections.length > 0) {
      if (fsCategories.length) {
        const sid = String(selectedSectionId).trim();

        const cats = fsCategories
          .filter((c: any) => String(c.sectionId || "").trim() === sid)
          .map((c: any) => ({
            id: String(c.id),
            name: String(c.الاسم ?? c.name ?? "").trim(),
          }))
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

      if (hasCats) {
        return all.filter((s) => String(s.categoryId || "").trim() === sel);
      }

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

  const getServiceById = (id: string) => servicesFlat.find((sv) => sv.id === id) || null;

  // =========================
  // Cart: add/remove + update item fields
  // =========================
  const addServiceToCart = (idRaw: string) => {
    const id = String(idRaw || "").trim();
    if (!id) return;

    const sv = getServiceById(id);
    if (!sv) return;

    setFormData((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        {
          id: makeLocalId(),
          serviceId: id,
          serviceName: sv.name,
          basePrice: Number(sv.basePrice || 0),
          priceText: sv.priceText,
          durationMin: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
          employeeId: "",
          employeeUid: "",
          employeeName: "",
          date: "",
          time: "",
        },
      ],
    }));

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
    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }));

    if (patch.serviceId || patch.employeeId || patch.date || patch.time) {
      if (!couponCode.trim()) setManualOverride(false);
    }
  };

  // =========================
  // ✅ Load staff per serviceId when item exists
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items]);

  // =========================
  // ✅ Busy slots per item (employee+date+duration)
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
        const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);

        if (!employeeId || !date) {
          setBusyByItem((p) => ({ ...p, [itemId]: { ...emptyBusyState() } }));
          continue;
        }

        setBusyByItem((p) => ({
          ...p,
          [itemId]: { ...(p[itemId] || emptyBusyState()), loading: true, hint: "" },
        }));

        try {
          const colRef = collection(db, "salons", SALON_ID, "booking_slots");
          const q1 = query(colRef, where("employeeId", "==", employeeId), where("date", "==", date));
          const snap = await getDocs(q1);

          if (cancelled) return;

          const taken = new Set<string>();
          snap.docs.forEach((d) => {
            const t = String((d.data() as any)?.time || "").trim();
            if (t) taken.add(t);
          });

          const allSlots = timeSlots;
          const disabled = new Set<string>();

          for (const start of allSlots) {
            const needed = getTimesToLock(allSlots, slotStepMin, start, durationMin);
            const bad = needed.some((t) => taken.has(t));
            if (bad) disabled.add(start);
          }

          setBusyByItem((p) => ({
            ...p,
            [itemId]: {
              busyTimes: taken,
              disabledStartTimes: disabled,
              loading: false,
              hint: "",
            },
          }));

          const currentTime = String(it.time || "").trim();
          if (currentTime && disabled.has(currentTime)) {
            updateItem(itemId, { time: "" });
          }
        } catch (e: any) {
          const msg = String(e?.message || "");
          const hint = msg.toLowerCase().includes("requires an index")
            ? "Firestore يحتاج Index (employeeId + date). افتح Console واضغط Create index."
            : "";

          setBusyByItem((p) => ({
            ...p,
            [itemId]: { ...emptyBusyState(), loading: false, hint },
          }));
        }
      }
    }

    loadBusyForItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slotStepMin,
    timeSlots.join("|"),
    formData.items.map((x) => `${x.id}|${x.employeeId}|${x.date}|${x.durationMin}`).join("::"),
  ]);

  // =========================
  // Change handlers (name/phone/note)
  // =========================
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;

    if (name === "phone") {
      const digitsOnly = value.replace(/\D/g, "").slice(0, 10);
      setFormData((prev) => ({ ...prev, phone: digitsOnly }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value } as any));
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sectionId = e.target.value;
    setSelectedSectionId(sectionId);

    setSelectedCategory("");
    setServicePicker("");

    setFormData((prev) => ({
      ...prev,
      items: [],
    }));

    setBusyByItem({});
    setStaffByService({});
    setStaffLoadingByService({});
    setStaffErrorByService({});

    setCouponCode("");
    setManualOverride(false);
    setOfferMsg("");
    setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const catIdOrName = e.target.value;
    setSelectedCategory(catIdOrName);
    setServicePicker("");

    setCouponCode("");
    setManualOverride(false);
    setOfferMsg("");
    setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
  };

  // =========================
  // Totals + offer auto
  // =========================
  const cartItems = formData.items || [];
  const basePrice = cartItems.reduce((sum, it) => sum + Number(it.basePrice || 0), 0);
  const finalPrice = Number(applied.finalPrice || 0) > 0 ? applied.finalPrice : basePrice;

  useEffect(() => {
    if (!basePrice) {
      setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
      setOfferMsg("");
      return;
    }

    if (manualOverride) return;

    setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
    setOfferMsg("");
  }, [basePrice, manualOverride, formData.items.map((x) => `${x.serviceId}|${x.date}`).join("::")]);

  const handleApplyCoupon = async () => {
    const items = formData.items || [];
    const primaryServiceId = String(items[0]?.serviceId || "").trim();

    if (!items.length || !basePrice) {
      setOfferMsg("اختاري خدمة أولاً قبل تطبيق الكود");
      return;
    }

    if (!String(items[0]?.date || "").trim()) {
      setOfferMsg("اختاري تاريخ الحجز (على الأقل لأول خدمة) ثم طبّقي الكود");
      return;
    }

    const normalized = couponCode.trim();
    if (!normalized) {
      setOfferMsg("اكتبي كود الخصم أولاً");
      return;
    }

    try {
      const offer = await findActiveOfferByCode(SALON_ID, normalized);

      if (!offer) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg("الكود غير صحيح أو غير متاح");
        return;
      }

      if (!primaryServiceId || !offerAppliesToService(offer, primaryServiceId)) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg("هذا الكود لا ينطبق على هذه الخدمة");
        return;
      }

      const dateCheck = isOfferValidForBookingDate(offer as any, String(items[0]?.date || "").trim());
      if (!dateCheck.ok) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg(dateCheck.reason || "هذا العرض غير متاح لتاريخ الحجز المختار");
        return;
      }

      const { discountAmount, finalPrice } = calcDiscount(basePrice, offer);

      setApplied({
        offer,
        discountAmount,
        finalPrice,
        reason: "تم تطبيق الخصم ✅",
      });

      setManualOverride(true);
      setOfferMsg(`تم تطبيق الخصم: ${(offer as any).title} ✅`);
    } catch (e: any) {
      console.error("❌ apply coupon error:", e?.code, e?.message, e);
      setOfferMsg("صار خطأ في التحقق من الكود");
    }
  };

  // =========================
  // Helper: توزيع الخصم على العناصر (بشكل عادل)
  // =========================
  function allocateDiscount(items: CartItem[], discountTotal: number) {
    const total = items.reduce((s, it) => s + Number(it.basePrice || 0), 0);
    if (!total || !discountTotal) {
      return items.map(() => 0);
    }

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

  // =========================
  // ✅ Slot check for one item (before submit)
  // =========================
  const checkOneItemSlot = async (it: CartItem) => {
    const employeeKey = String(it.employeeId || "").trim();
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };

    const timesToCheck = getTimesToLock(
      timeSlots,
      slotStepMin,
      time,
      Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN)
    );

    try {
      const snaps = await Promise.all(
        timesToCheck.map((t) => {
          const slotId = buildSlotId(SALON_ID, employeeKey, date, t);
          return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
        })
      );

      const anyTaken = snaps.some((s) => s.exists());
      if (anyTaken) {
        return { ok: false, msg: "هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر." };
      }

      return { ok: true, msg: "" };
    } catch {
      return { ok: false, msg: "تعذر فحص الوقت. جرّبي وقتًا آخر." };
    }
  };

  // =========================
  // Submit (Create Firestore bookings لكل عنصر + Go Success)
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

    const missing = items.find((it) => {
      if (!String(it.employeeId || "").trim()) return true;
      if (!String(it.employeeName || "").trim()) return true;
      if (!String(it.date || "").trim()) return true;
      if (!String(it.time || "").trim()) return true;
      return false;
    });

    if (missing) {
      openModal({
        title: "بيانات الحجز ناقصة",
        message: "لكل خدمة داخل السلة: لازم تختارين (الموظفة + التاريخ + الوقت).",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const signedUid = getSignedInUidOrNull();
    if (!signedUid) {
      openModal(
        {
          title: "لازم تسجّلين دخول",
          message:
            "عشان نثبت حجزك ونرسله لك في ملفك، لازم يكون عندك حساب.\n\n" +
            "اضغطي زر تسجيل الدخول وبعدها كمّلي الحجز بسهولة ✅",
          variant: "info",
          confirmText: "تسجيل الدخول",
        },
        () => navigate("/login")
      );
      return;
    }

    setIsLoading(true);

    try {
      const normalizedCode = couponCode.trim();
      let finalApplied: AppliedOfferResult = applied;

      if (normalizedCode) {
        const primaryServiceId = String(items[0]?.serviceId || "").trim();
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

        if (!primaryServiceId || !offerAppliesToService(offer, primaryServiceId)) {
          openModal({
            title: "الكود لا ينطبق",
            message: "هذا الكود لا ينطبق على هذه الخدمة.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const dateCheck = isOfferValidForBookingDate(offer as any, String(items[0]?.date || "").trim());
        if (!dateCheck.ok) {
          openModal({
            title: "العرض غير متاح لهذا التاريخ",
            message: dateCheck.reason || "هذا العرض غير متاح لتاريخ الحجز المختار.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const { discountAmount, finalPrice } = calcDiscount(basePrice, offer);
        finalApplied = { offer, discountAmount, finalPrice, reason: "تم تطبيق الخصم ✅" };
        setApplied(finalApplied);
        setManualOverride(true);
      }

      for (const it of items) {
        const busyState = busyByItem[it.id];
        const disabled = busyState?.disabledStartTimes;
        if (disabled && disabled.has(String(it.time || "").trim())) {
          openModal({
            title: "الوقت غير متاح",
            message: `خدمة "${it.serviceName}" الوقت المختار ما يكفي لمدة الخدمة أو فيه تعارض. اختاري وقتًا آخر.`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const check = await checkOneItemSlot(it);
        if (!check.ok) {
          openModal({
            title: "الوقت محجوز",
            message: `خدمة "${it.serviceName}": ${check.msg}`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }
      }

      const discountTotal = Number(finalApplied.discountAmount || 0);
      const perItemDiscounts = allocateDiscount(items, discountTotal);

      const uid = signedUid;

      const userNote = String(formData.note || "").trim();
      const offerNote = finalApplied.offer
        ? `Offer: ${(finalApplied.offer as any)?.title || normalizedCode || "-"} | discount=${Number(
          finalApplied.discountAmount || 0
        ).toFixed(0)}`
        : "";

      const noteFinal = [userNote, offerNote].filter(Boolean).join(" | ") || undefined;

      const sectionIdAtBooking = String(selectedSectionId || "").trim() || undefined;

      const createdBookings: any[] = [];

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemDiscount = Number(perItemDiscounts[idx] || 0);
        const itemFinal = Math.max(0, Number(it.basePrice || 0) - itemDiscount);

        const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);

        const res = await createBooking({
          userId: uid,
          createdBy: "client",
          channel: "client",

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
        });
      }

      localStorage.setItem("allBookings", JSON.stringify(createdBookings));
      localStorage.setItem("currentBooking", JSON.stringify(createdBookings[0] || null));
      localStorage.removeItem("bookingDraft");

      navigate("/success");
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
  // Restore draft (optional) - بسيط
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
        })),
      }));

      const firstServiceId = String(items[0]?.serviceId || "").trim();
      if (firstServiceId) {
        const sv = getServiceById(firstServiceId);
        if (sv?.sectionId) setSelectedSectionId(sv.sectionId);

        if (catalogMode === "firestore") {
          if (sv?.categoryId) setSelectedCategory(String(sv.categoryId));
          else setSelectedCategory("");
        } else {
          if (sv?.category) setSelectedCategory(String(sv.category));
        }
      }
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

                <h1 className="booking-title">احجزي موعدك الآن</h1>
              </div>

              <form className="booking-form" onSubmit={handleSubmit}>
                <div className="row">
                  <div className="col-md-6 mb-4">
                    <label htmlFor="name" className="form-label">
                      الاسم الكامل
                    </label>

                    <div className="input-group">
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faUser} />
                      </span>

                      <input
                        type="text"
                        className="form-control"
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        placeholder="أدخلي اسمك الكامل"
                        required
                      />
                    </div>
                  </div>

                  <div className="col-md-6 mb-4">
                    <label htmlFor="phone" className="form-label">
                      رقم الجوال
                    </label>

                    <div className="input-group">
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faPhone} />
                      </span>

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
                </div>

                <div className="mb-4 bk-field">
                  <label className="form-label">القسم</label>

                  <select
                    className="form-select dash-select"
                    value={selectedSectionId}
                    onChange={handleSectionChange}
                    required
                    disabled={catalogLoading}
                  >
                    <option value="" disabled>
                      اختاري القسم
                    </option>

                    {sectionOptions.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-4 bk-field">
                  <label className="form-label">التصنيف</label>

                  <select
                    className="form-select dash-select"
                    value={selectedCategory}
                    onChange={handleCategoryChange}
                    disabled={!selectedSectionId || catalogLoading}
                  >
                    <option value="">الكل</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-4 bk-field">
                  <label className="form-label">الخدمات</label>

                  <div className="input-group">
                    <select
                      className="form-select dash-select"
                      value={servicePicker}
                      onChange={(e) => setServicePicker(e.target.value)}
                      disabled={!selectedSectionId}
                    >
                      <option value="">اختاري خدمة لإضافتها</option>

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
                      onClick={() => {
                        addServiceToCart(servicePicker);
                        setServicePicker("");
                      }}
                    >
                      إضافة
                    </button>
                  </div>

                  {!!(formData.items || []).length && (
                    <div className="mt-3">
                      {(formData.items || []).map((it) => {
                        const busy = busyByItem[it.id] || emptyBusyState();
                        const serviceStaff = staffByService[it.serviceId] || [];
                        const staffLoading = !!staffLoadingByService[it.serviceId];
                        const staffError = staffErrorByService[it.serviceId] || "";

                        return (
                          <div
                            key={it.id}
                            className="mt-3 p-3"
                            style={{
                              border: "1px solid rgba(13,13,13,0.12)",
                              borderRadius: 12,
                              background: "rgba(245,245,244,0.75)",
                              color: "#0D0D0D",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div>
                                <div style={{ fontWeight: 800 }}>{it.serviceName}</div>
                                <div className="small">
                                  {it.priceText || `${Number(it.basePrice || 0)} ريال`} •{" "}
                                  {Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN)} دقيقة
                                </div>
                              </div>

                              <button
                                type="button"
                                className="btn btn-outline-dark btn-sm"
                                onClick={() => removeServiceFromCart(it.id)}
                              >
                                حذف
                              </button>
                            </div>

                            <div className="row mt-3">
                              <div className="col-md-6 mb-3">
                                <label className="form-label">الموظفة</label>

                                <div className="input-group">
                                  <span className="input-group-text">
                                    <FontAwesomeIcon icon={faUserTie} />
                                  </span>

                                  <select
                                    className="form-select"
                                    value={it.employeeId}
                                    disabled={staffLoading}
                                    onChange={(e) => {
                                      const empId = e.target.value;
                                      const emp = serviceStaff
                                        .filter((s) => (s?.name || "").trim())
                                        .map((s) => ({
                                          id: s.id,
                                          name: String(s.name || "").trim(),
                                          uid: String((s as any).linkedUid || "").trim(),
                                        }))
                                        .find((x) => x.id === empId);

                                      updateItem(it.id, {
                                        employeeId: empId,
                                        employeeUid: emp?.uid || "",
                                        employeeName: emp?.name || "",
                                        date: "",
                                        time: "",
                                      });
                                    }}
                                    required
                                  >
                                    <option value="">اختاري الموظفة</option>
                                    {serviceStaff
                                      .filter((s) => (s?.name || "").trim())
                                      .map((s) => ({
                                        id: s.id,
                                        name: s.name.trim(),
                                      }))
                                      .map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                          {emp.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>

                                {staffLoading && (
                                  <div className="small text-muted mt-1">
                                    <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الموظفات…
                                  </div>
                                )}

                                {!!staffError && <div className="text-danger small mt-1">{staffError}</div>}
                              </div>

                              <div className="col-md-6 mb-3">
                                <label htmlFor={`date_${it.id}`} className="form-label">
                                  التاريخ
                                </label>

                                <div className="input-group">
                                  <span className="input-group-text">
                                    <FontAwesomeIcon icon={faCalendarAlt} />
                                  </span>

                                  <input
                                    type="date"
                                    className="form-control"
                                    id={`date_${it.id}`}
                                    value={it.date}
                                    onChange={(e) => updateItem(it.id, { date: e.target.value, time: "" })}
                                    required
                                    min={todayISO()}
                                    disabled={!it.employeeId}
                                  />
                                </div>

                                {!it.employeeId && (
                                  <div className="small text-muted mt-1">اختاري الموظفة أولاً عشان يظهر التقويم</div>
                                )}
                              </div>

                              <div className="col-12">
                                <label htmlFor={`time_${it.id}`} className="form-label">
                                  الوقت
                                </label>

                                <div className="input-group">
                                  <span className="input-group-text">
                                    <FontAwesomeIcon icon={faClock} />
                                  </span>

                                  <select
                                    className="form-select"
                                    id={`time_${it.id}`}
                                    value={it.time}
                                    onChange={(e) => updateItem(it.id, { time: e.target.value })}
                                    required
                                    disabled={!it.employeeId || !it.date || busy.loading}
                                  >
                                    <option value="">اختاري الوقت</option>
                                    {timeSlots.map((t) => {
                                      const disabled = busy.disabledStartTimes.has(t);
                                      return (
                                        <option key={t} value={t} disabled={disabled}>
                                          {t} {disabled ? "— غير متاح" : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>

                                {busy.loading && (
                                  <div className="small text-muted mt-2">
                                    <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الأوقات المتاحة…
                                  </div>
                                )}

                                {!!busy.hint && <div className="small text-warning mt-2">{busy.hint}</div>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!formData.items?.length && (
                    <div className="small text-muted mt-2">
                      اختاري خدمة أو أكثر، وبعدها لكل خدمة: (الموظفة + التاريخ + الوقت) ✨
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <label htmlFor="note" className="form-label">
                    ملاحظة (اختياري)
                  </label>

                  <textarea
                    className="form-control"
                    id="note"
                    name="note"
                    value={formData.note}
                    onChange={handleChange}
                    rows={3}
                    placeholder="أي ملاحظة تحبيها…"
                  />
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

                  <div className="small text-muted mt-2">ملاحظة: كل خدمة لها وقتها وموظفتها بشكل مستقل ✅</div>
                </div>

                <button type="submit" className="btn btn-primary w-100 booking-submit-btn" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <FontAwesomeIcon icon={faSpinner} spin /> جاري تأكيد الحجز…
                    </>
                  ) : (
                    "تأكيد الحجز"
                  )}
                </button>

                <div className="small text-muted mt-3 text-center">بإكمال الحجز أنتِ توافقين على سياسة الصالون ✨</div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Booking;
