// src/pages/Booking.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarAlt,
  faClock,
  faUser,
  faPhone,
  faCheck,
  faSpinner,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";
import { generateSalonTimeSlots } from "../helpers/timeSlots";
import "../styles/Booking.css";

// ✅ NEW: Firestore slot availability check
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";

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
  listActiveCategoriesBySection,
  listActiveServices,
  type SectionDoc,
  type CategoryDoc,
  type ServiceDoc,
} from "../services/firestoreCatalog";

// ✅ Custom modal بدل alert
import ConfirmModal from "../components/ConfirmModal";

/**
 * ✅ Payment methods
 */
type PaymentMethod = "cash" | "pos_card" | "mada_online";

/** ✅ تطبيع القيم القديمة حتى لا ينكسر شيء */
function normalizePaymentMethod(v: any): PaymentMethod {
  const raw = String(v || "").toLowerCase();

  if (raw === "cash" || raw === "pos_card" || raw === "mada_online") {
    return raw as PaymentMethod;
  }

  if (raw === "card") return "pos_card";
  if (raw === "transfer") return "cash";
  if (raw === "other") return "cash";

  return "cash";
}

interface BookingFormData {
  name: string;
  phone: string;
  service: string; // ✅ serviceId

  // ✅ نحتفظ بالاسم للتوافق مع صفحات قديمة
  employee: string;

  // ✅ المرجع الثابت للموظفة (Firestore staff_public doc id)
  employeeId?: string;

  // ✅ NEW: UID الحقيقي للموظفة (لربط حجوزاتها في DashboardStaff)
  employeeUid?: string;

  date: string;
  time: string;
  note?: string;

  paymentMethod: PaymentMethod;

  couponCode?: string;
  offerId?: string | null;
  offerTitle?: string | null;
  discountAmount?: number;
  finalPrice?: number;

  offerAppliesTo?: "all" | "services";
  offerServiceIds?: string[];

  bookingId?: string;
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

  // ✅ NEW: مدة من Firestore إذا كانت موجودة
  durationMin?: number;

  // ✅ NEW: معرفة مصدر الخدمة (Firestore/Pricing)
  source: "firestore" | "pricing";
};

type CategoryOption = { id: string; name: string };

const timeSlots = generateSalonTimeSlots();

const getAllBookings = () => {
  const data = localStorage.getItem("allBookings");
  return data ? JSON.parse(data) : [];
};

const makeBookingId = () => `B-${Date.now()}`;

const SALON_ID = "main";

function normalizeArabicKey(s: string) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[إأآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ـ/g, ""); // tatweel
}

async function tryLoadStaffBySpecialty(salonId: string, candidates: string[]) {
  for (const raw of candidates) {
    const specialty = String(raw || "").trim();
    if (!specialty) continue;

    const res = await listActiveStaffBySpecialty({
      salonId,
      specialty,
    });

    if (Array.isArray(res) && res.length > 0) return res;
  }
  return [];
}

// ✅ fallback durations للـ Pricing فقط (مؤقت)
const SERVICE_DURATIONS_MIN: Record<string, number> = {};
const DEFAULT_SERVICE_DURATION_MIN = 60;

// ✅ نفس منطق slotId الموجود في firestoreBookings.ts
function safeKey(s: string) {
  return String(s || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
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

// ✅ حساب عدد السلوّتات التي يجب فحصها/قفلها حسب مدة الخدمة
const SLOT_STEP_MIN = 30;
const BUFFER_MIN = 0;

function getTimesToLock(startTime: string, durationMin: number) {
  const slots = generateSalonTimeSlots();
  const idx = slots.indexOf(startTime);
  if (idx < 0) return [startTime];

  const totalMin =
    Math.max(0, Number(durationMin || 0)) + Math.max(0, BUFFER_MIN);
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

  if (s && bookingDateISO < s) {
    return { ok: false, reason: `العرض يبدأ من ${s}` };
  }
  if (e && bookingDateISO > e) {
    return { ok: false, reason: `العرض انتهى بتاريخ ${e}` };
  }
  return { ok: true, reason: "" };
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
  // ✅ NEW: مصدر الكاتالوج (Firestore أو Pricing fallback)
  // =========================
  const [catalogMode, setCatalogMode] = useState<"firestore" | "pricing">(
    "pricing"
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");

  const [fsSections, setFsSections] = useState<SectionDoc[]>([]);
  const [fsCategories, setFsCategories] = useState<CategoryDoc[]>([]);
  const [fsServices, setFsServices] = useState<ServiceDoc[]>([]);

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  // ✅ مهم: في Firestore نخزن categoryId
  // أما في Pricing نخزن category name (عادي لأنه fallback)
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    service: "",
    employee: "",
    employeeId: "",
    employeeUid: "", // ✅ NEW
    date: "",
    time: "",
    note: "",
    paymentMethod: "cash",
    durationMin: DEFAULT_SERVICE_DURATION_MIN,
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);
  const [shouldRedirect, setShouldRedirect] = useState(false);

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

  // ✅ الموظفات من Firestore حسب القسم
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
  // ✅ NEW: تحميل الأقسام أول مرة من Firestore
  // - إذا فاضي => fallback Pricing
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
          // ✅ Firestore فاضي => fallback
          setCatalogMode("pricing");
          setFsSections([]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setCatalogMode("pricing");
          setFsSections([]);
          const msg = String(e?.message || "");
          if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            setCatalogError(
              "صلاحيات قراءة الأقسام غير كافية. سيتم استخدام Pricing مؤقتًا."
            );
          } else {
            setCatalogError(
              "تعذر تحميل الأقسام من Firestore. سيتم استخدام Pricing مؤقتًا."
            );
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
  // ✅ NEW: عند تغيير القسم (في وضع Firestore)
  // - نحمل التصنيفات والخدمات للقسم
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
        setCatalogError("");

        const [cats, servs] = await Promise.all([
          listActiveCategoriesBySection(selectedSectionId, SALON_ID),
          listActiveServices({ sectionId: selectedSectionId }, SALON_ID),
        ]);

        if (cancelled) return;
        setFsCategories(cats || []);
        setFsServices(servs || []);
      } catch (e: any) {
        if (!cancelled) {
          setFsCategories([]);
          setFsServices([]);
          setCatalogError(
            "تعذر تحميل الخدمات من Firestore. سيتم استخدام Pricing مؤقتًا."
          );
          // ✅ fallback عند أي مشكلة
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
  // ✅ فلترة خدمات Firestore حسب categoryId (مو الاسم)
  // =========================
  const fsServicesFiltered = useMemo(() => {
    if (catalogMode !== "firestore") return [];
    if (!selectedSectionId) return [];

    const sid = String(selectedSectionId || "").trim();
    const cid = String(selectedCategory || "").trim(); // هنا categoryId في Firestore

    return fsServices.filter((s: any) => {
      if (String(s.sectionId || "").trim() !== sid) return false;
      if (!cid) return true;
      return String(s.categoryId || "").trim() === cid;
    });
  }, [catalogMode, fsServices, selectedSectionId, selectedCategory]);

  // =========================
  // ✅ مصدر واحد للخدمات: Firestore (إن وجد) وإلا Pricing
  // =========================
  const servicesFlat: FlatService[] = useMemo(() => {
    // ✅ Firestore mode
    if (catalogMode === "firestore" && fsSections.length > 0) {
      const secMap = new Map<string, string>();
      fsSections.forEach((s: any) =>
        secMap.set(String(s.id), String((s as any).الاسم ?? (s as any).name ?? ""))
      );

      const catMap = new Map<string, string>();
      fsCategories.forEach((c: any) =>
        catMap.set(String(c.id), String((c as any).الاسم ?? (c as any).name ?? ""))
      );

      const list = (selectedSectionId ? fsServicesFiltered : []).map((x: any) => {
        const sectionTitle =
          secMap.get(String(x.sectionId)) || String(x.sectionId || "");

        const catName = x.categoryId
          ? catMap.get(String(x.categoryId)) || "عام"
          : "عام";

        const name = String(x.الاسم ?? x.name ?? "").trim();
        const priceNum = Number(x.السعر ?? x.price ?? 0);
        const durationMin = Number(
          x.المدة ?? x.durationMin ?? DEFAULT_SERVICE_DURATION_MIN
        );

        return {
          id: String(x.id),
          sectionId: String(x.sectionId),
          sectionTitle,
          categoryId: x.categoryId ? String(x.categoryId) : "",
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

    // ✅ Pricing fallback
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
            durationMin:
              SERVICE_DURATIONS_MIN[String(id)] ?? DEFAULT_SERVICE_DURATION_MIN,
            source: "pricing",
          });
        });
      });
    });
    return out;
  }, [
    catalogMode,
    fsSections,
    fsCategories,
    fsServicesFiltered,
    selectedSectionId,
  ]);

  // ✅ الأقسام للواجهة
  const sectionOptions = useMemo(() => {
    // Firestore
    if (catalogMode === "firestore" && fsSections.length > 0) {
      return fsSections.map((s: any) => ({
        id: String(s.id),
        title: String((s as any).الاسم ?? (s as any).name ?? ""),
      }));
    }
    // Pricing
    return Object.entries(pricingSections).map(([id, sec]) => ({
      id,
      title: sec.title,
    }));
  }, [catalogMode, fsSections]);

  // ✅ التصنيفات (اختياري) — الآن نرجع {id,name}
  const categoryOptions: CategoryOption[] = useMemo(() => {
    if (!selectedSectionId) return [];

    // Firestore
    if (catalogMode === "firestore" && fsSections.length > 0) {
      const sid = String(selectedSectionId).trim();
      const cats = fsCategories
        .filter((c: any) => String(c.sectionId || "").trim() === sid)
        .map((c: any) => ({
          id: String(c.id),
          name: String(c.الاسم ?? c.name ?? "").trim(),
        }))
        .filter((x) => x.id && x.name);

      // unique by id
      const seen = new Set<string>();
      return cats.filter((x) =>
        seen.has(x.id) ? false : (seen.add(x.id), true)
      );
    }

    // Pricing (نعطي id = الاسم)
    const cats = servicesFlat
      .filter((s) => s.sectionId === selectedSectionId)
      .map((s) => ({ id: s.category, name: s.category }))
      .filter((x) => x.id && x.name);

    const seen = new Set<string>();
    return cats.filter((x) =>
      seen.has(x.id) ? false : (seen.add(x.id), true)
    );
  }, [catalogMode, fsSections.length, fsCategories, servicesFlat, selectedSectionId]);

  const servicesInSection = useMemo(() => {
    if (!selectedSectionId) return [];
    const all = servicesFlat.filter((s) => s.sectionId === selectedSectionId);

    if (!selectedCategory) return all;

    // ✅ Firestore: selectedCategory = categoryId
    if (catalogMode === "firestore") {
      return all.filter(
        (s) => String(s.categoryId || "").trim() === String(selectedCategory).trim()
      );
    }

    // ✅ Pricing: selectedCategory = category name
    return all.filter((s) => s.category === selectedCategory);
  }, [servicesFlat, selectedSectionId, selectedCategory, catalogMode]);

  const servicesGrouped = useMemo(() => {
    const map = new Map<string, FlatService[]>();
    servicesInSection.forEach((s) => {
      const arr = map.get(s.category) || [];
      arr.push(s);
      map.set(s.category, arr);
    });
    return Array.from(map.entries());
  }, [servicesInSection]);

  const getServiceById = (id: string) =>
    servicesFlat.find((s) => s.id === id) || null;
  const getServiceName = (id: string) => getServiceById(id)?.name || id;
  const getServiceBasePrice = (id: string) => getServiceById(id)?.basePrice || 0;

  const selectedService = useMemo(() => {
    return formData.service ? getServiceById(formData.service) : null;
  }, [formData.service, servicesFlat]);

  // =========================
  // ✅ تحميل الموظفات عند اختيار القسم
  // ✅ FIX: جرّب أكثر من قيمة (اسم القسم + id + تطبيع)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadStaff() {
      if (!selectedSectionId) {
        setStaff([]);
        setStaffError("");
        setStaffLoading(false);
        return;
      }

      const sectionTitle =
        sectionOptions.find((s) => s.id === selectedSectionId)?.title?.trim() || "";

      // ✅ candidates متعددة عشان Firestore لازم تطابق حرفيًا
      const candidates = [
        sectionTitle,                         // الاسم العربي
        normalizeArabicKey(sectionTitle),      // عربي مطبع
        selectedSectionId,                    // لو specialties مخزنة كـ id
        normalizeArabicKey(selectedSectionId), // احتياط
      ].filter(Boolean);

      try {
        setStaffLoading(true);
        setStaffError("");

        // ✅ بدل استعلام واحد — نجرب كل candidate ونوقف أول ما نلقى موظفات
        const res = await tryLoadStaffBySpecialty(SALON_ID, candidates);

        if (cancelled) return;

        setStaff(res);

        if (!res.length) {
          setStaffError(
            `ما لقينا موظفات لهذا القسم. تأكد إن staff_public.specialties تحتوي أحد القيم التالية "بالضبط": ${candidates.join(
              " / "
            )}`
          );
        }
      } catch (e: any) {
        console.error("loadStaff error:", e);
        if (!cancelled) {
          const msg = String(e?.message || "");
          if (msg.toLowerCase().includes("requires an index")) {
            setStaffError(
              "Firestore يحتاج Index للاستعلام. افتح رسالة الخطأ في الكونسول واضغط Create index."
            );
          } else if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            setStaffError(
              "صلاحيات قراءة الموظفات غير كافية. لازم نفتح قراءة staff_public للعميلات في Rules."
            );
          } else {
            setStaffError("تعذر تحميل قائمة الموظفات. جرّبي تحديث الصفحة.");
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
  }, [selectedSectionId, sectionOptions]);

  // =========================
  // ✅ فلترة الموظفات حسب الوقت (LocalStorage فقط)
  // =========================
  const filteredEmployees = useMemo(() => {
    const list = staff
      .filter((s) => (s?.name || "").trim())
      .map((s) => ({
        id: s.id, // ✅ staff_public doc id
        name: s.name.trim(),
        uid: String((s as any).linkedUid || "").trim(), // ✅ UID الحقيقي
      }));


    if (!formData.date || !formData.time) return list;

    const all = getAllBookings();
    return list.filter((emp) => {
      const found = all.find(
        (b: any) =>
          (String(b.employeeId || "").trim() === emp.id ||
            String(b.employee || "").trim() === emp.name) &&
          String(b.date || "").trim() === formData.date &&
          String(b.time || "").trim() === formData.time
      );
      return !found;
    });
  }, [staff, formData.date, formData.time]);

  useEffect(() => {
    const chosenId = String(formData.employeeId || "").trim();
    const chosenName = String(formData.employee || "").trim();

    if (!chosenId && !chosenName) return;

    const exists =
      (chosenId && filteredEmployees.some((e) => e.id === chosenId)) ||
      (!chosenId &&
        chosenName &&
        filteredEmployees.some((e) => e.name === chosenName));

    if (!exists) {
      setFormData((p) => ({ ...p, employeeId: "", employeeUid: "", employee: "" }));
    }
  }, [filteredEmployees, formData.employeeId, formData.employee]);

  // =========================
  // ✅ فحص السلوّت مبكرًا من Firestore
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function checkSlotAvailability() {
      setSlotBusy(false);
      setSlotMsg("");

      // ✅ مهم: نستخدم employeeId (staff_public id) لقفل السلوّت
      const employeeKey = String(formData.employeeId || formData.employee || "").trim();
      const date = String(formData.date || "").trim();
      const time = String(formData.time || "").trim();

      if (!employeeKey || !date || !time) return;

      try {
        setSlotChecking(true);

        const durationMin = Number(
          formData.durationMin || DEFAULT_SERVICE_DURATION_MIN
        );
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
          setSlotMsg(
            "هذا الوقت غير متاح لأن مدة الخدمة تتداخل مع حجز آخر. اختاري وقتًا آخر."
          );
        } else {
          setSlotBusy(false);
          setSlotMsg("");
        }
      } catch (e) {
        if (!cancelled) {
          setSlotBusy(false);
          setSlotMsg("");
        }
      } finally {
        if (!cancelled) setSlotChecking(false);
      }
    }

    checkSlotAvailability();
    return () => {
      cancelled = true;
    };
  }, [
    formData.employeeId,
    formData.employee,
    formData.date,
    formData.time,
    formData.durationMin,
  ]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value } = e.target;

    if (name === "phone") {
      const digitsOnly = value.replace(/\D/g, "").slice(0, 10);
      setFormData((prev) => ({ ...prev, phone: digitsOnly }));
      return;
    }

    if (name === "paymentMethod") {
      setFormData((prev) => ({
        ...prev,
        paymentMethod: normalizePaymentMethod(value),
      }));
      return;
    }

    setFormData((prev) => {
      const next = { ...prev, [name]: value } as BookingFormData;

      if (name === "service") {
        next.employee = "";
        next.employeeId = "";
        next.employeeUid = ""; // ✅ NEW

        // ✅ مدة الخدمة من Firestore إن وجدت وإلا default
        const s = getServiceById(String(value));
        next.durationMin = Number(
          s?.durationMin || DEFAULT_SERVICE_DURATION_MIN
        );

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

    // ✅ عند تغيير القسم: نرجع التصنيف فاضي
    setSelectedCategory("");

    setFormData((prev) => ({
      ...prev,
      service: "",
      employee: "",
      employeeId: "",
      employeeUid: "", // ✅ NEW
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
      employeeUid: "", // ✅ NEW
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
  }, [
    formData.service,
    formData.employeeId,
    formData.employee,
    formData.date,
    manualOverride,
  ]);

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


  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (slotBusy) {
      openModal({
        title: "الوقت غير متاح",
        message:
          "هذا الوقت غير متاح لأن مدة الخدمة تتداخل مع حجز آخر. اختاري وقتًا آخر.",
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

    if (
      !String(formData.employeeId || "").trim() ||
      !String(formData.employee || "").trim()
    ) {
      openModal({
        title: "اختيار الموظفة",
        message: "فضلاً اختاري الموظفة من القائمة.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 900));

    const basePrice = getServiceBasePrice(formData.service);
    const serviceId = formData.service;

    const normalizedPayment: PaymentMethod = normalizePaymentMethod(
      formData.paymentMethod
    );

    const normalizedCode = couponCode.trim();
    let finalApplied: AppliedOfferResult = applied;

    if (normalizedCode) {
      try {
        const offer = await findActiveOfferByCode(SALON_ID, normalizedCode);
        if (!offer) {
          setIsLoading(false);
          openModal({
            title: "كود الخصم غير صحيح",
            message: "الكود غير صحيح أو غير متاح حالياً.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        if (!offerAppliesToService(offer, serviceId)) {
          setIsLoading(false);
          openModal({
            title: "الكود لا ينطبق",
            message: "هذا الكود لا ينطبق على هذه الخدمة.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const dateCheck = isOfferValidForBookingDate(
          offer as any,
          formData.date
        );
        if (!dateCheck.ok) {
          setIsLoading(false);
          openModal({
            title: "العرض غير متاح لهذا التاريخ",
            message:
              dateCheck.reason || "هذا العرض غير متاح لتاريخ الحجز المختار.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const { discountAmount, finalPrice } = calcDiscount(basePrice, offer);
        finalApplied = {
          offer,
          discountAmount,
          finalPrice,
          reason: "تم تطبيق الخصم ✅",
        };
        setApplied(finalApplied);
        setManualOverride(true);
      } catch (err) {
        setIsLoading(false);
        openModal({
          title: "تعذر التحقق من الكود",
          message: "صار خطأ أثناء التحقق من كود الخصم. جرّبي مرة ثانية.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }
    }

    const finalPriceNum =
      Number(finalApplied.finalPrice || 0) > 0
        ? finalApplied.finalPrice
        : basePrice;

    const bookingId = makeBookingId();

    const bookingWithOffer: BookingFormData = {
      ...formData,
      paymentMethod: normalizedPayment,
      phone,
      couponCode: normalizedCode || "",
      offerId: (finalApplied.offer as any)?.id || null,
      offerTitle: (finalApplied.offer as any)?.title || null,
      discountAmount: finalApplied.discountAmount || 0,
      finalPrice: finalPriceNum,
      offerAppliesTo: ((finalApplied.offer as any)?.appliesTo as any) || "all",
      offerServiceIds: Array.isArray((finalApplied.offer as any)?.serviceIds)
        ? ((finalApplied.offer as any).serviceIds as string[])
        : [],
      bookingId,
      total: Number(finalPriceNum || 0),

      // ✅ ثابت للسلوّت
      employeeId: String(formData.employeeId || "").trim(), // staff_public id
      employee: String(formData.employee || "").trim(),     // اسم للعرض

      // ✅ NEW: للربط الحقيقي (DashboardStaff)
      employeeUid: String(formData.employeeUid || "").trim(),

      durationMin: Number(formData.durationMin || DEFAULT_SERVICE_DURATION_MIN),
    };

    localStorage.setItem("currentBooking", JSON.stringify(bookingWithOffer));

    setIsLoading(false);
    setShowSuccess(true);
    setCountdown(5);
    setShouldRedirect(false);
  };

  // ✅ استرجاع draft
  useEffect(() => {
    const draft = localStorage.getItem("bookingDraft");
    if (draft) {
      const parsed = JSON.parse(draft);

      if (parsed?.paymentMethod) {
        parsed.paymentMethod = normalizePaymentMethod(parsed.paymentMethod);
      } else {
        parsed.paymentMethod = "cash";
      }

      if (!parsed?.durationMin) {
        parsed.durationMin = DEFAULT_SERVICE_DURATION_MIN;
      }

      setFormData((prev) => ({
        ...prev,
        ...parsed,
        employee: String(parsed?.employee || "").trim(),
        employeeId: String(parsed?.employeeId || "").trim(),
        employeeUid: String(parsed?.employeeUid || "").trim(), // ✅ NEW
        durationMin: Number(parsed?.durationMin || DEFAULT_SERVICE_DURATION_MIN),
      }));

      if (parsed?.service) {
        const s = getServiceById(parsed.service);

        if (s?.sectionId) setSelectedSectionId(s.sectionId);

        // ✅ Firestore: نخزن categoryId
        // ✅ Pricing: نخزن category name
        if (catalogMode === "firestore") {
          if (s?.categoryId) setSelectedCategory(String(s.categoryId));
          else setSelectedCategory("");
        } else {
          if (s?.category) setSelectedCategory(String(s.category));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    if (showSuccess) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          const next = prev - 1;
          if (next <= 0) return 0;
          return next;
        });
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [showSuccess]);

  useEffect(() => {
    if (!showSuccess) return;
    if (countdown === 0) setShouldRedirect(true);
  }, [showSuccess, countdown]);

  useEffect(() => {
    if (!shouldRedirect) return;
    navigate("/checkout");
  }, [shouldRedirect, navigate]);

  const formatDate = (dateString: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    return date.toLocaleDateString("ar-SA", options);
  };

  const basePrice = getServiceBasePrice(formData.service);
  const finalPrice =
    Number(applied.finalPrice || 0) > 0 ? applied.finalPrice : basePrice;

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
                <h1 className="booking-title">احجزي موعدك الآن</h1>
                <p className="booking-subtitle">
                  اختاري الخدمة والوقت المناسب لك وسنكون بانتظارك
                </p>

                {/* ✅ اختياري: توضيح وضع الكاتالوج */}
                <div className="mt-2 booking-offer-msg">
                  {catalogLoading
                    ? "جاري تحميل الخدمات..."
                    : catalogMode === "firestore"
                      ? "الخدمات: من قاعدة البيانات ✅"
                      : "الخدمات: مؤقتًا من التسعير (Pricing) ⏳"}
                  {catalogError ? ` — ${catalogError}` : ""}
                </div>
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
                          const digitsOnly = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 10);
                          setFormData((prev) => ({
                            ...prev,
                            phone: digitsOnly,
                          }));
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
                  <label className="form-label">التصنيف (اختياري)</label>
                  <select
                    className="form-select dash-select"
                    value={selectedCategory}
                    onChange={handleCategoryChange}
                    disabled={
                      !selectedSectionId ||
                      catalogLoading ||
                      categoryOptions.length === 0
                    }
                  >
                    <option value="">
                      {!selectedSectionId
                        ? "اختاري القسم أولاً"
                        : categoryOptions.length === 0
                          ? "لا توجد تصنيفات"
                          : "كل التصنيفات"}
                    </option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-4 bk-field">
                  <label htmlFor="service" className="form-label">
                    الخدمة المطلوبة
                  </label>

                  <select
                    className="form-select dash-select"
                    id="service"
                    name="service"
                    value={formData.service}
                    onChange={handleChange}
                    required
                    disabled={!selectedSectionId || catalogLoading}
                  >
                    <option value="" disabled>
                      {selectedSectionId ? "اختاري الخدمة" : "اختاري القسم أولاً"}
                    </option>

                    {servicesGrouped.map(([catName, list]) => (
                      <optgroup key={catName} label={catName}>
                        {list.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} — {s.basePrice} ريال
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  {selectedService && (
                    <div className="mt-2 booking-price-box">
                      <div className="d-flex justify-content-between">
                        <span>السعر</span>
                        <strong>{selectedService.basePrice} ريال</strong>
                      </div>
                      <div className="d-flex justify-content-between mt-1">
                        <span>المدة</span>
                        <strong>
                          {Number(
                            selectedService.durationMin ||
                            DEFAULT_SERVICE_DURATION_MIN
                          )}{" "}
                          دقيقة
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                <div className="row">
                  <div className="col-md-6 mb-4">
                    <label htmlFor="employee" className="form-label">
                      الموظفة
                    </label>
                    <div className="input-group">
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faUserTie} />
                      </span>

                      <select
                        className="form-select"
                        id="employee"
                        name="employeeId"
                        value={formData.employeeId || ""}
                        onChange={(e) => {
                          const selectedPublicId = e.target.value;

                          // ✅ نجيب full من staff عشان linkedUid
                          const full = staff.find((x) => x.id === selectedPublicId);

                          setFormData((prev) => ({
                            ...prev,
                            employeeId: selectedPublicId || "", // staff_public id
                            employeeUid: String((full as any)?.linkedUid || "").trim(), // ✅ NEW UID الحقيقي
                            employee: String(full?.name || "").trim(),
                          }));
                        }}
                        required={!!selectedSectionId}
                        disabled={!selectedSectionId || staffLoading}
                      >
                        <option value="">
                          {staffLoading
                            ? "جاري تحميل الموظفات..."
                            : !selectedSectionId
                              ? "اختاري القسم أولاً"
                              : "اختاري الموظفة"}
                        </option>

                        {filteredEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {staffError && (
                      <div className="no-employee-warning mt-2">
                        {staffError}
                      </div>
                    )}

                    {!staffError &&
                      selectedSectionId &&
                      formData.date &&
                      formData.time &&
                      !staffLoading &&
                      filteredEmployees.length === 0 && (
                        <div className="no-employee-warning mt-2">
                          عذرًا، لا تتوفر موظفات في الوقت الذي اخترتيه.
                          <br />
                          هذا الوقت محجوز حاليًا. نرجو اختيار وقت أو يوم آخر.
                        </div>
                      )}
                  </div>

                  <div className="col-md-6 mb-4">
                    <label htmlFor="date" className="form-label">
                      التاريخ
                    </label>

                    <div
                      className="input-group booking-date-group"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        dateInputRef.current?.focus();
                        dateInputRef.current?.showPicker?.();
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          dateInputRef.current?.focus();
                          dateInputRef.current?.showPicker?.();
                        }
                      }}
                      aria-label="اختيار التاريخ"
                      title="اختيار التاريخ"
                    >
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faCalendarAlt} />
                      </span>

                      <input
                        ref={dateInputRef}
                        type="date"
                        className="form-control"
                        id="date"
                        name="date"
                        value={formData.date}
                        onChange={handleChange}
                        min={new Date().toISOString().split("T")[0]}
                        required
                        onFocus={() => {
                          dateInputRef.current?.showPicker?.();
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <label htmlFor="time" className="form-label">
                    الوقت
                  </label>
                  <div className="input-group">
                    <span className="input-group-text">
                      <FontAwesomeIcon icon={faClock} />
                    </span>
                    <select
                      className="form-select"
                      id="time"
                      name="time"
                      value={formData.time}
                      onChange={handleChange}
                      required
                    >
                      <option value="" disabled>
                        اختاري الوقت
                      </option>
                      {timeSlots.map((time, index) => (
                        <option key={index} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </div>

                  {slotChecking &&
                    formData.employeeId &&
                    formData.date &&
                    formData.time && (
                      <div className="mt-2 booking-offer-msg">
                        جاري التحقق من توفر هذا الوقت...
                      </div>
                    )}
                  {slotMsg && (
                    <div className="no-employee-warning mt-2">{slotMsg}</div>
                  )}
                </div>

                <div className="mb-4 bk-field">
                  <label className="form-label">طريقة الدفع</label>
                  <select
                    className="form-select dash-select"
                    name="paymentMethod"
                    value={formData.paymentMethod}
                    onChange={handleChange}
                    required
                  >
                    <option value="mada_online">مدى أونلاين (تجريبي)</option>
                    <option value="pos_card">شبكة في الصالون</option>
                    <option value="cash">كاش</option>
                  </select>

                  {formData.paymentMethod === "mada_online" && (
                    <div className="mt-2 booking-offer-msg">
                      * مدى أونلاين حالياً تجربة مبدئية: سيتم حفظ الحجز “بانتظار
                      الدفع” ثم المتابعة لصفحة Success.
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <label htmlFor="note" className="form-label">
                    ملاحظات إضافية (اختياري)
                  </label>
                  <textarea
                    className="form-control"
                    id="note"
                    name="note"
                    value={formData.note}
                    onChange={handleChange}
                    rows={3}
                    placeholder="أي تفاصيل إضافية تودين إضافتها"
                  />
                </div>

                <div className="booking-offer-box mb-4">
                  <label className="form-label">كود خصم (اختياري)</label>

                  <div className="bk-coupon-row d-flex gap-2">
                    <input
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      className="form-control"
                      placeholder="مثال: QUEENS10"
                      disabled={!formData.service}
                    />

                    <button
                      type="button"
                      className="bk-coupon-btn bk-coupon-btn--apply"
                      onClick={handleApplyCoupon}
                      disabled={!formData.service}
                    >
                      تطبيق
                    </button>

                    <button
                      type="button"
                      className="bk-coupon-btn bk-coupon-btn--remove"
                      onClick={() => {
                        setCouponCode("");
                        setManualOverride(false);
                        const bp = getServiceBasePrice(formData.service);
                        setApplied({
                          offer: null,
                          discountAmount: 0,
                          finalPrice: bp,
                        });
                        setOfferMsg("");
                      }}
                      disabled={!formData.service}
                    >
                      إزالة
                    </button>
                  </div>

                  {offerMsg && (
                    <div className="mt-2 booking-offer-msg">{offerMsg}</div>
                  )}

                  <div className="booking-price-summary mt-3">
                    <div className="d-flex justify-content-between">
                      <span>السعر قبل الخصم</span>
                      <strong>{basePrice} ريال</strong>
                    </div>

                    <div className="d-flex justify-content-between">
                      <span>الخصم</span>
                      <strong>
                        {Number(applied.discountAmount || 0).toFixed(0)} ريال
                      </strong>
                    </div>

                    <div className="d-flex justify-content-between">
                      <span>السعر النهائي</span>
                      <strong>{Number(finalPrice).toFixed(0)} ريال</strong>
                    </div>

                    {applied.offer && (
                      <div className="mt-2">
                        العرض المطبق: <b>{(applied.offer as any).title}</b>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary rounded-pill w-100"
                  disabled={isLoading || slotChecking || slotBusy}
                >
                  {slotChecking ? (
                    <>
                      <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                      جاري التحقق من الوقت...
                    </>
                  ) : isLoading ? (
                    <>
                      <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                      جاري الحجز...
                    </>
                  ) : slotBusy ? (
                    "الوقت غير متاح"
                  ) : (
                    "تأكيد الحجز"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {showSuccess && (
        <div className="booking-success-modal">
          <div className="booking-success-content">
            <div className="success-icon">
              <FontAwesomeIcon icon={faCheck} />
            </div>
            <h2 className="success-title">تم تأكيد حجزك بنجاح!</h2>
            <p className="success-message">
              شكراً لاختيارك صالون ملكات. تم استلام طلب حجزك وسيتم التواصل معك
              قريباً لتأكيد الموعد.
            </p>

            <div className="booking-details">
              <div className="booking-detail-item">
                <span className="booking-detail-label">الخدمة:</span>
                <span className="booking-detail-value">
                  {getServiceName(formData.service)}
                </span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">الموظفة:</span>
                <span className="booking-detail-value">{formData.employee}</span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">التاريخ:</span>
                <span className="booking-detail-value">
                  {formatDate(formData.date)}
                </span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">الوقت:</span>
                <span className="booking-detail-value">{formData.time}</span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">السعر النهائي:</span>
                <span className="booking-detail-value">
                  {Number(finalPrice).toFixed(0)} ريال
                </span>
              </div>

              {applied.offer && (
                <div className="booking-detail-item">
                  <span className="booking-detail-label">العرض:</span>
                  <span className="booking-detail-value">
                    {(applied.offer as any).title}
                  </span>
                </div>
              )}
            </div>

            <div className="success-actions">
              <button
                className="success-primary-btn"
                onClick={() => navigate("/checkout")}
              >
                الانتقال للدفع
              </button>
            </div>

            <p className="redirect-message">
              سيتم تحويلك تلقائياً إلى صفحة الدفع خلال{" "}
              <span className="countdown">{countdown}</span> ثواني
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Booking;
