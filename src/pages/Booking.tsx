// src/pages/Booking.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import logo from "../assets/images/ssunnamed1.png";

import {
  faCalendarAlt,
  faClock,
  faUser,
  faPhone,
  faSpinner,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { generateSalonTimeSlots } from "../helpers/timeSlots";
import "../styles/Booking.css";

// ✅ Firestore slot availability check
import { doc, getDoc, getDocs, collection, query, where, orderBy } from "firebase/firestore";
import { db } from "../services/firebase";

// ✅ Firebase Auth (Anonymous)
import { getAuth, signInAnonymously } from "firebase/auth";

// ✅ fallback Pricing (مؤقت فقط إذا Firestore فاضي)
import { pricingSections } from "./Pricing";

// ✅ Firestore Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import { findActiveOfferByCode, offerAppliesToService } from "../services/firestoreOffers";

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

interface BookingFormData {
  name: string;
  phone: string;
  service: string; // ✅ serviceId
  employee: string; // name (display)
  employeeId?: string; // staff_public doc id
  employeeUid?: string; // linkedUid الحقيقي (لـ Staff portal)
  date: string;
  time: string;
  note?: string;

  couponCode?: string;
  offerId?: string | null;
  offerTitle?: string | null;
  discountAmount?: number;
  finalPrice?: number;
  offerAppliesTo?: "all" | "services";
  offerServiceIds?: string[];

  total?: number;

  // ✅ مدة الخدمة بالدقائق (لتفادي تداخل الحجوزات)
  durationMin?: number;
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

const timeSlots = generateSalonTimeSlots();
const SALON_ID = "main";

const DEFAULT_SERVICE_DURATION_MIN = 60;

// ✅ نفس منطق slotId الموجود في firestoreBookings.ts
function safeKey(s: string) {
  return String(s || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
}

function buildSlotId(salonId: string, employeeKey: string, date: string, time: string) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
}

// ✅ (مؤقت) نفس حساب BookingSlots بالصفحة (مبني على generateSalonTimeSlots)
const SLOT_STEP_MIN = 30;
const BUFFER_MIN = 0;

function getTimesToLock(startTime: string, durationMin: number) {
  const slots = generateSalonTimeSlots();
  const idx = slots.indexOf(startTime);
  if (idx < 0) return [startTime];

  const totalMin = Math.max(0, Number(durationMin || 0)) + Math.max(0, BUFFER_MIN);
  const slotsNeeded = Math.max(1, Math.ceil(totalMin / SLOT_STEP_MIN));
  return slots.slice(idx, idx + slotsNeeded);
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

async function ensureUserUid(): Promise<string | null> {
  const auth = getAuth();
  if (auth.currentUser?.uid) return auth.currentUser.uid;

  try {
    const cred = await signInAnonymously(auth);
    return cred.user?.uid ?? null;
  } catch (err) {
    console.warn("[Booking] signInAnonymously failed:", err);
    return null;
  }
}

type UiModalState = {
  open: boolean;
  title: string;
  message: string;
  variant: "info" | "danger" | "success";
  confirmText?: string;
};

const Booking: React.FC = () => {
  const navigate = useNavigate();
  const dateInputRef = useRef<HTMLInputElement | null>(null);

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

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    service: "",
    employee: "",
    employeeId: "",
    employeeUid: "",
    date: "",
    time: "",
    note: "",
    durationMin: DEFAULT_SERVICE_DURATION_MIN,
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

  // ✅ فحص مبكر لتوفر السلوّت من Firestore
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotChecking, setSlotChecking] = useState(false);
  const [slotMsg, setSlotMsg] = useState("");

  // ✅ تعطيل الأوقات غير المناسبة (حسب حجوزات الموظفة + مدة الخدمة)
  const [busyTimes, setBusyTimes] = useState<Set<string>>(new Set());
  const [disabledStartTimes, setDisabledStartTimes] = useState<Set<string>>(new Set());
  const [busyLoading, setBusyLoading] = useState(false);
  const [busyHint, setBusyHint] = useState("");

  // ✅ الموظفات من Firestore حسب الخدمة (ID)
  const [staff, setStaff] = useState<StaffPublicWithId[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState("");

  // ✅ Modal بدل alert
  const [uiModal, setUiModal] = useState<UiModalState>({
    open: false,
    title: "",
    message: "",
    variant: "info",
    confirmText: "حسنًا",
  });

  const openModal = (data: Omit<UiModalState, "open">) => {
    setUiModal({ open: true, ...data });
  };

  const closeModal = () => setUiModal((p) => ({ ...p, open: false }));

  // =========================
  // Load sections
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadSectionsFirstTime() {
      try {
        setCatalogLoading(true);
        setCatalogError("");

        const secs = await listActiveSections(SALON_ID);
        if (cancelled) return;

        if (secs && secs.length > 0) {
          setCatalogMode("firestore");
          setFsSections(secs);
        } else {
          setCatalogMode("pricing");
          setFsSections([]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setCatalogMode("pricing");
          setFsSections([]);

          const msg = String(e?.message || "");
          if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            setCatalogError("صلاحيات قراءة الأقسام غير كافية. سيتم استخدام Pricing مؤقتًا.");
          } else {
            setCatalogError("تعذر تحميل الأقسام من Firestore. سيتم استخدام Pricing مؤقتًا.");
          }
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
      console.log("[Booking] loadCatalogForSection START", { catalogMode, selectedSectionId });

      if (catalogMode !== "firestore") return;

      if (!selectedSectionId) {
        setFsCategories([]);
        setFsServices([]);
        return;
      }

      try {
        setCatalogLoading(true);
        setCatalogError("");

        // ✅ 1) التصنيفات: حاول بـ orderBy وإذا فشل رجّع بدون orderBy (يحميك من عدم وجود order/index)
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
          catsSnap = await getDocs(query(catsCol, where("sectionId", "==", selectedSectionId)));
        }

        if (cancelled) return;

        const safeCats: any[] = catsSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((c) => String(c?.الاسم ?? c?.name ?? "").trim())
          .filter((c) => c?.active !== false);

        console.log("[Booking] catsSnap size =", catsSnap.size, safeCats);

        setFsCategories(safeCats as any);

        // ✅ catIds: ادعم id / key / categoryId (لو خدماتك تستخدم key بدل docId)
        const catIds = safeCats
          .map((c: any) => String(c.categoryId ?? c.key ?? c.id ?? "").trim())
          .filter(Boolean);

        // ✅ 2) لو ما فيه تصنيفات: رجّع للنظام القديم وجيب الخدمات بالـ sectionId
        if (catIds.length === 0) {
          console.log("[Booking] NO categories -> old schema path. sectionId =", selectedSectionId);

          const colRef = collection(db, "salons", SALON_ID, "services");
          const snap = await getDocs(query(colRef, where("sectionId", "==", selectedSectionId)));

          if (cancelled) return;

          const merged = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          const activeOnly = merged.filter((x) => x?.active !== false);

          setFsServices(activeOnly);
          console.log("[Booking] old schema services loaded =", activeOnly.length, activeOnly);

          return;
        }

        // ✅ 3) schema الجديد: services مرتبطة بـ categoryId (in chunks of 10)
        // ✅ + نجيب خدمات legacy: sectionId == selectedSectionId
        const chunks: string[][] = [];
        for (let i = 0; i < catIds.length; i += 10) chunks.push(catIds.slice(i, i + 10));

        const colRef = collection(db, "salons", SALON_ID, "services");

        // A) خدمات النظام الجديد: categoryId in [...]
        const snaps = await Promise.all(
          chunks.map((arr) => getDocs(query(colRef, where("categoryId", "in", arr))))
        );

        // B) خدمات النظام القديم: sectionId == selectedSectionId (حتى لو categoryId فاضي)
        const secSnap = await getDocs(query(colRef, where("sectionId", "==", selectedSectionId)));

        if (cancelled) return;

        const merged: any[] = [];

        snaps.forEach((sn) => {
          sn.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));
        });

        secSnap.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));

        // إزالة التكرار حسب id
        const uniq = new Map<string, any>();
        merged.forEach((x) => uniq.set(String(x.id), x));

        const activeOnly = Array.from(uniq.values()).filter((x) => x?.active !== false);

        setFsServices(activeOnly);
        console.log("[Booking] fsServices loaded =", activeOnly.length, activeOnly);
      } catch (e: any) {
        if (!cancelled) {
          setFsCategories([]);
          setFsServices([]);

          const msg = String(e?.message || "");
          if (msg.toLowerCase().includes("requires an index")) {
            setCatalogError("Firestore يحتاج Index (sectionId + order). افتح الكونسول واضغط Create index.");
          } else {
            setCatalogError("تعذر تحميل الخدمات من Firestore. سيتم استخدام Pricing مؤقتًا.");
          }

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

    // لو ما فيه categories: فلترة بسيطة بالـ sectionId
    if (!fsCategories.length) {
      const base = fsServices.filter((s: any) => String(s.sectionId || "").trim() === sid);
      if (!cid) return base;

      // هنا selectedCategory بنعامله كـ "اسم تصنيف" من داخل الخدمة
      return base.filter((s: any) => {
        const catName = String(s.category ?? s.categoryName ?? s.التصنيف ?? "").trim();
        return catName === cid;
      });
    }

    // لو فيه categories: فلترة بالـ categoryId
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
        // ✅ لو ما عندنا Categories (schema قديم): اعتمد sectionId داخل الخدمة نفسها
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

        // ✅ schema الجديد: service.categoryId -> category.sectionId
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

      console.log("[Booking] servicesFlat(list) =", list.length, list);
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
      // لو فيه categories (schema جديد)
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

      // لو ما فيه categories (schema قديم): استخرج تصنيفات من الخدمات
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

    // Pricing mode
    const cats = servicesFlat
      .filter((s) => s.sectionId === selectedSectionId)
      .map((s) => ({ id: s.category, name: s.category }))
      .filter((x) => x.id && x.name);

    const seen = new Set<string>();
    return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }, [catalogMode, fsSections.length, fsCategories, fsServices, servicesFlat, selectedSectionId]);

  // ✅✅✅ التعديل الوحيد هنا ✅✅✅
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
    servicesInSection.forEach((s) => {
      const arr = map.get(s.category) || [];
      arr.push(s);
      map.set(s.category, arr);
    });
    return Array.from(map.entries());
  }, [servicesInSection]);

  const getServiceById = (id: string) => servicesFlat.find((s) => s.id === id) || null;
  const getServiceName = (id: string) => getServiceById(id)?.name || id;
  const getServiceBasePrice = (id: string) => getServiceById(id)?.basePrice || 0;

  // =========================
  // ✅ Load staff when service selected (SERVICE-ID based)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadStaff() {
      const serviceId = String(formData.service || "").trim();

      if (!serviceId) {
        setStaff([]);
        setStaffError("");
        setStaffLoading(false);
        return;
      }

      try {
        setStaffLoading(true);
        setStaffError("");

        // ✅ الربط الصحيح: بالـ serviceId الثابت
        const res = await listActiveStaffBySpecialty({
          salonId: SALON_ID,
          specialty: serviceId,
        });

        if (cancelled) return;

        setStaff(res || []);

        if (!res?.length) {
          setStaffError(
            `ما فيه موظفات مربوطة بهذه الخدمة. تأكد أن staff_public.specialties تحتوي serviceId التالي:\n${serviceId}`
          );
        }
      } catch (e: any) {
        console.error("loadStaff error:", e);

        if (!cancelled) {
          const msg = String(e?.message || "");

          if (msg.toLowerCase().includes("requires an index")) {
            setStaffError("Firestore يحتاج Index للاستعلام. افتح Console واضغط Create index.");
          } else if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            setStaffError("صلاحيات قراءة الموظفات غير كافية (staff_public).");
          } else {
            setStaffError("تعذر تحميل قائمة الموظفات.");
          }

          setStaff([]);
        }
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    }

    loadStaff();
    return () => {
      cancelled = true;
    };
  }, [formData.service]);


  // =========================
  // Preload busy slots for employee+date (Firestore)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadBusy() {
      setBusyHint("");
      setBusyTimes(new Set());
      setDisabledStartTimes(new Set());

      const employeeId = String(formData.employeeId || "").trim();
      const date = String(formData.date || "").trim();

      if (!employeeId || !date) return;

      try {
        setBusyLoading(true);

        const colRef = collection(db, "salons", SALON_ID, "booking_slots");
        const q1 = query(colRef, where("employeeId", "==", employeeId), where("date", "==", date));
        const snap = await getDocs(q1);

        if (cancelled) return;

        const taken = new Set<string>();
        snap.docs.forEach((d) => {
          const t = String((d.data() as any)?.time || "").trim();
          if (t) taken.add(t);
        });

        setBusyTimes(taken);

        const durationMin = Number(formData.durationMin || DEFAULT_SERVICE_DURATION_MIN);
        const allSlots = generateSalonTimeSlots();

        const disabled = new Set<string>();
        for (const start of allSlots) {
          const needed = getTimesToLock(start, durationMin);
          const bad = needed.some((t) => taken.has(t));
          if (bad) disabled.add(start);
        }

        setDisabledStartTimes(disabled);

        const currentTime = String(formData.time || "").trim();
        if (currentTime && disabled.has(currentTime)) {
          setFormData((p) => ({ ...p, time: "" }));
          setSlotBusy(true);
          setSlotMsg("اخترنا لك حماية تلقائية: هذا الوقت ما يكفي لمدة الخدمة. اختاري وقتًا آخر.");
        } else {
          setSlotBusy(false);
          setSlotMsg("");
        }
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (msg.toLowerCase().includes("requires an index")) {
          setBusyHint("Firestore يحتاج Index (employeeId + date). افتح Console واضغط Create index.");
        }
        setBusyTimes(new Set());
        setDisabledStartTimes(new Set());
      } finally {
        if (!cancelled) setBusyLoading(false);
      }
    }

    loadBusy();
    return () => {
      cancelled = true;
    };
  }, [formData.employeeId, formData.date, formData.durationMin]);

  // =========================
  // Slot availability check (Firestore)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function checkSlotAvailability() {
      setSlotBusy(false);
      setSlotMsg("");

      const employeeKey = String(formData.employeeId || formData.employee || "").trim();
      const date = String(formData.date || "").trim();
      const time = String(formData.time || "").trim();

      if (!employeeKey || !date || !time) return;

      try {
        setSlotChecking(true);

        const durationMin = Number(formData.durationMin || DEFAULT_SERVICE_DURATION_MIN);
        const timesToCheck = getTimesToLock(time, durationMin);

        const snaps = await Promise.all(
          timesToCheck.map((t) => {
            const slotId = buildSlotId(SALON_ID, employeeKey, date, t);
            return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
          })
        );

        if (cancelled) return;

        const anyTaken = snaps.some((s) => s.exists());
        if (anyTaken) {
          setSlotBusy(true);
          setSlotMsg("هذا الوقت غير متاح. يرجى اختيار وقت آخر.");
        } else {
          setSlotBusy(false);
          setSlotMsg("");
        }
      } catch {
        if (!cancelled) {
          setSlotBusy(false);
          setSlotMsg("هذا الوقت غير متاح. يرجى اختيار وقت آخر.");
        }
      } finally {
        if (!cancelled) setSlotChecking(false);
      }
    }

    checkSlotAvailability();
    return () => {
      cancelled = true;
    };
  }, [formData.employeeId, formData.employee, formData.date, formData.time, formData.durationMin]);

  // =========================
  // Employee dropdown list
  // =========================
  const filteredEmployees = useMemo(() => {
    const list = staff
      .filter((s) => (s?.name || "").trim())
      .map((s) => ({
        id: s.id,
        name: s.name.trim(),
        uid: String((s as any).linkedUid || "").trim(),
      }));

    return list;
  }, [staff]);

  useEffect(() => {
    const chosenId = String(formData.employeeId || "").trim();
    const chosenName = String(formData.employee || "").trim();
    if (!chosenId && !chosenName) return;

    const exists =
      (chosenId && filteredEmployees.some((e) => e.id === chosenId)) ||
      (!chosenId && chosenName && filteredEmployees.some((e) => e.name === chosenName));

    if (!exists) {
      setFormData((p) => ({ ...p, employeeId: "", employeeUid: "", employee: "" }));
    }
  }, [filteredEmployees, formData.employeeId, formData.employee]);

  // =========================
  // Change handlers
  // =========================
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    if (name === "phone") {
      const digitsOnly = value.replace(/\D/g, "").slice(0, 10);
      setFormData((prev) => ({ ...prev, phone: digitsOnly }));
      return;
    }

    setFormData((prev) => {
      const next = { ...prev, [name]: value } as BookingFormData;

      if (name === "service") {
        next.employee = "";
        next.employeeId = "";
        next.employeeUid = "";

        const s = getServiceById(String(value));
        next.durationMin = Number(s?.durationMin || DEFAULT_SERVICE_DURATION_MIN);

        setCouponCode("");
        setManualOverride(false);
        setOfferMsg("");
        setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
      }

      if (name === "date" || name === "time") {
        if (!couponCode.trim()) setManualOverride(false);
      }

      return next;
    });
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sectionId = e.target.value;
    setSelectedSectionId(sectionId);

    setSelectedCategory("");

    setFormData((prev) => ({
      ...prev,
      service: "",
      employee: "",
      employeeId: "",
      employeeUid: "",
      durationMin: DEFAULT_SERVICE_DURATION_MIN,
    }));

    setCouponCode("");
    setManualOverride(false);
    setOfferMsg("");
    setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const catIdOrName = e.target.value;
    setSelectedCategory(catIdOrName);

    setFormData((prev) => ({
      ...prev,
      service: "",
      employee: "",
      employeeId: "",
      employeeUid: "",
      durationMin: DEFAULT_SERVICE_DURATION_MIN,
    }));

    setCouponCode("");
    setManualOverride(false);
    setOfferMsg("");
    setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
  };

  useEffect(() => {
    const basePrice = getServiceBasePrice(formData.service);
    if (!basePrice) {
      setApplied({ offer: null, discountAmount: 0, finalPrice: 0 });
      setOfferMsg("");
      return;
    }

    if (manualOverride) return;

    setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
    setOfferMsg("");
  }, [formData.service, formData.employeeId, formData.employee, formData.date, manualOverride]);

  const handleApplyCoupon = async () => {
    const basePrice = getServiceBasePrice(formData.service);
    const serviceId = formData.service;

    if (!serviceId || !basePrice) {
      setOfferMsg("اختاري الخدمة أولاً قبل تطبيق الكود");
      return;
    }

    if (!formData.date) {
      setOfferMsg("اختاري تاريخ الحجز أولاً ثم طبّقي الكود");
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

      if (!offerAppliesToService(offer, serviceId)) {
        setManualOverride(false);
        setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
        setOfferMsg("هذا الكود لا ينطبق على هذه الخدمة");
        return;
      }

      const dateCheck = isOfferValidForBookingDate(offer as any, formData.date);
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
  // Submit (Create Firestore booking مباشرة + Go Success)
  // =========================
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (slotBusy) {
      openModal({
        title: "الوقت غير متاح",
        message: "هذا الوقت غير متاح لأن مدة الخدمة تتداخل مع حجز آخر. اختاري وقتًا آخر.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

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

    if (!String(formData.employeeId || "").trim() || !String(formData.employee || "").trim()) {
      openModal({
        title: "اختيار الموظفة",
        message: "فضلاً اختاري الموظفة من القائمة.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    if (!String(formData.service || "").trim()) {
      openModal({
        title: "اختيار الخدمة",
        message: "فضلاً اختاري الخدمة من القائمة.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    setIsLoading(true);

    try {
      const basePrice = getServiceBasePrice(formData.service);
      const serviceId = formData.service;

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

        if (!offerAppliesToService(offer, serviceId)) {
          openModal({
            title: "الكود لا ينطبق",
            message: "هذا الكود لا ينطبق على هذه الخدمة.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const dateCheck = isOfferValidForBookingDate(offer as any, formData.date);
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

      const finalPriceNum = Number(finalApplied.finalPrice || 0) > 0 ? finalApplied.finalPrice : basePrice;

      const durationMin = Number(formData.durationMin || DEFAULT_SERVICE_DURATION_MIN);

      const uid = await ensureUserUid();
      if (!uid) {
        openModal({
          title: "تعذر إكمال الحجز",
          message:
            "لم نستطع إنشاء جلسة مستخدم للكتابة في Firestore.\n\n" +
            "فعّل Anonymous Auth من Firebase Authentication.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }

      const userNote = String(formData.note || "").trim();
      const offerNote = finalApplied.offer
        ? `Offer: ${(finalApplied.offer as any)?.title || normalizedCode || "-"} | discount=${Number(
          finalApplied.discountAmount || 0
        ).toFixed(0)}`
        : "";

      const noteFinal = [userNote, offerNote].filter(Boolean).join(" | ") || undefined;

      const serviceNameAtBooking = getServiceName(formData.service);
      const sectionIdAtBooking = String(selectedSectionId || "").trim() || undefined;

      const res = await createBooking({
        userId: uid,
        createdBy: "client",
        channel: "client",

        clientName: String(formData.name || "").trim(),
        clientPhone: phone,

        serviceName: formData.service,
        serviceId: formData.service,
        serviceSnapshot: {
          serviceNameAtBooking,
          priceAtBooking: Number(finalPriceNum || 0),
          durationAtBooking: durationMin,
          sectionIdAtBooking,
        },

        employeeId: String(formData.employeeId || "").trim(),
        employeeUid: String(formData.employeeUid || "").trim() || null,
        employeeName: String(formData.employee || "").trim() || "-",

        date: String(formData.date || "").trim(),
        time: String(formData.time || "").trim(),

        total: Number(finalPriceNum || 0),
        finalPrice: Number(finalPriceNum || 0),

        status: "pending",
        note: noteFinal,

        durationMin,
      } as any);

      const currentBooking = {
        bookingId: res.id,
        id: res.id,
        trackId: res.id,
        publicId: (res as any).publicId,

        name: String(formData.name || "").trim(),
        phone,
        service: formData.service,
        serviceName: formData.service,
        employee: String(formData.employee || "").trim(),
        employeeId: String(formData.employeeId || "").trim(),
        employeeUid: String(formData.employeeUid || "").trim(),

        date: String(formData.date || "").trim(),
        time: String(formData.time || "").trim(),

        total: Number(finalPriceNum || 0),
        finalPrice: Number(finalPriceNum || 0),

        couponCode: normalizedCode || "",
        offerId: (finalApplied.offer as any)?.id || null,
        offerTitle: (finalApplied.offer as any)?.title || null,
        discountAmount: Number(finalApplied.discountAmount || 0),

        durationMin,
        status: "pending",
        createdAt: Date.now(),
      };

      localStorage.setItem("currentBooking", JSON.stringify(currentBooking));
      localStorage.removeItem("allBookings");
      localStorage.removeItem("bookingDraft");

      navigate("/success");
    } catch (e: any) {
      console.error(e);

      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        openModal({
          title: "الوقت محجوز",
          message: "هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر.",
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

      if (!parsed?.durationMin) parsed.durationMin = DEFAULT_SERVICE_DURATION_MIN;

      setFormData((prev) => ({
        ...prev,
        ...parsed,
        employee: String(parsed?.employee || "").trim(),
        employeeId: String(parsed?.employeeId || "").trim(),
        employeeUid: String(parsed?.employeeUid || "").trim(),
        durationMin: Number(parsed?.durationMin || DEFAULT_SERVICE_DURATION_MIN),
      }));

      if (parsed?.service) {
        const s = getServiceById(parsed.service);
        if (s?.sectionId) setSelectedSectionId(s.sectionId);

        if (catalogMode === "firestore") {
          if (s?.categoryId) setSelectedCategory(String(s.categoryId));
          else setSelectedCategory("");
        } else {
          if (s?.category) setSelectedCategory(String(s.category));
        }
      }
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const basePrice = getServiceBasePrice(formData.service);
  const finalPrice = Number(applied.finalPrice || 0) > 0 ? applied.finalPrice : basePrice;

  return (
    <div className="booking-page py-5">
      <ConfirmModal
        open={uiModal.open}
        title={uiModal.title}
        message={uiModal.message}
        variant={uiModal.variant}
        confirmText={uiModal.confirmText || "حسنًا"}
        onConfirm={closeModal}
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
                {/* <p className="booking-subtitle">اختاري الخدمة والوقت المناسب لك وسنكون بانتظارك</p> */}

                {/* <div className="mt-2 booking-offer-msg">
                  {catalogLoading
                    ? "جاري تحميل الخدمات..."
                    : catalogMode === "firestore"
                      ? "الخدمات: من قاعدة البيانات ✅"
                      : "الخدمات: مؤقتًا من التسعير (Pricing) ⏳"}
                  {catalogError ? ` — ${catalogError}` : ""}
                </div> */}
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
                        onChange={() => { }}
                        onInput={(e: any) => {
                          const v = String(e?.target?.value ?? "");
                          setFormData((p) => ({ ...p, name: v }));
                        }}
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

                    {sectionOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
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
                  <label className="form-label">الخدمة</label>

                  <select
                    className="form-select dash-select"
                    name="service"
                    value={formData.service}
                    onChange={handleChange}
                    required
                    disabled={!selectedSectionId}
                  >
                    <option value="" disabled>
                      اختاري الخدمة
                    </option>

                    {servicesGrouped.map(([cat, items]) => (
                      <optgroup key={cat} label={cat}>
                        {items.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} — {s.priceText}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="row">
                  <div className="col-md-6 mb-4">
                    <label className="form-label">الموظفة</label>

                    <div className="input-group">
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faUserTie} />
                      </span>

                      <select
                        className="form-select"
                        value={formData.employeeId}
                        disabled={!formData.service || staffLoading}
                        onChange={(e) => {
                          const id = e.target.value;
                          const emp = filteredEmployees.find((x) => x.id === id);

                          setFormData((p) => ({
                            ...p,
                            employeeId: id,
                            employeeUid: emp?.uid || "",
                            employee: emp?.name || "",
                          }));
                        }}
                        required
                      >
                        <option value="">اختاري الموظفة</option>
                        {filteredEmployees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {staffLoading && (
                      <div className="small text-muted mt-1">
                        <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الموظفات…
                      </div>
                    )}

                    {staffError && <div className="text-danger small mt-1">{staffError}</div>}
                  </div>

                  <div className="col-md-6 mb-4">
                    <label className="form-label">التاريخ</label>

                    <div
                      className="input-group booking-date-group"
                      onClick={() => {
                        const el = dateInputRef.current as any;
                        if (!el) return;
                        el.focus();
                        if (typeof el.showPicker === "function") el.showPicker(); // Chrome/Edge
                      }}
                    >
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faCalendarAlt} />
                      </span>

                      <input
                        ref={dateInputRef}
                        type="date"
                        className="form-control"
                        name="date"
                        value={formData.date}
                        onChange={handleChange}
                        required
                      />
                    </div>

                  </div>
                </div>

                <div className="mb-4">
                  <label className="form-label">الوقت</label>

                  <div className="input-group">
                    <span className="input-group-text">
                      <FontAwesomeIcon icon={faClock} />
                    </span>

                    <select
                      className="form-select"
                      name="time"
                      value={formData.time}
                      onChange={handleChange}
                      required
                    >
                      <option value="" disabled>
                        اختاري الوقت
                      </option>

                      {timeSlots.map((t) => {
                        const isDisabled = disabledStartTimes.has(t);

                        return (
                          <option key={t} value={t} disabled={isDisabled}>
                            {t} {isDisabled ? "— غير متاح" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {busyLoading ? (
                    <div className="bk-hint">جاري فحص الأوقات المتاحة…</div>
                  ) : busyHint ? (
                    <div className="bk-hint text-danger">{busyHint}</div>
                  ) : busyTimes.size > 0 ? (
                    <div className="bk-hint">الأوقات المحجوزة في هذا اليوم: {busyTimes.size}</div>
                  ) : null}

                  {slotChecking && (
                    <div className="small text-muted mt-1">
                      <FontAwesomeIcon icon={faSpinner} spin /> فحص توفر الوقت…
                    </div>
                  )}

                  {slotMsg && <div className="text-danger small mt-1">{slotMsg}</div>}
                </div>

                <div className="mb-4">
                  <label className="form-label">ملاحظات (اختياري)</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    name="note"
                    value={formData.note}
                    onChange={handleChange}
                    placeholder="أي ملاحظة تحبين إضافتها"
                  />
                </div>

                <div className="mb-4">
                  <label className="form-label">كود الخصم</label>

                  <div className="input-group bk-coupon-actions">
                    <input
                      type="text"
                      className="form-control"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      placeholder="اكتبي كود الخصم"
                    />
                    <button
                      type="button"
                      className="bk-coupon-btn bk-coupon-btn--apply"
                      onClick={handleApplyCoupon}
                    >
                      تطبيق
                    </button>
                  </div>


                  {offerMsg && <div className="small mt-1">{offerMsg}</div>}
                </div>

                <div className="booking-summary mb-4">
                  <div>
                    السعر:
                    <strong className="ms-2">{basePrice} ريال</strong>
                  </div>

                  {applied.discountAmount > 0 && (
                    <div>
                      الخصم:
                      <strong className="ms-2 text-success">−{applied.discountAmount} ريال</strong>
                    </div>
                  )}

                  <div className="fs-5 mt-2">
                    الإجمالي:
                    <strong className="ms-2">{finalPrice} ريال</strong>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={isLoading || slotBusy}>
                  {isLoading ? "جاري تأكيد الحجز…" : "تأكيد الحجز"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Booking;
