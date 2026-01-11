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

// ✅ جلب خدماتك الحقيقية من Pricing
import { pricingSections } from "./Pricing";

// ✅ Firestore Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import { findActiveOfferByCode, offerAppliesToService } from "../services/firestoreOffers";

// ✅ NEW: Staff Public (Firestore)
import {
  listActiveStaffBySpecialty,
  type StaffPublicWithId,
} from "../services/firestoreStaffPublic";

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

  // ✅ NEW: المرجع الحقيقي للموظفة (Firestore doc id)
  employeeId?: string;

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
  category: string;
  name: string;
  department: string;
  priceText: string;
  basePrice: number;
};

const timeSlots = generateSalonTimeSlots();

const getAllBookings = () => {
  const data = localStorage.getItem("allBookings");
  return data ? JSON.parse(data) : [];
};

const makeBookingId = () => `B-${Date.now()}`;

const SALON_ID = "main";

// ✅ NEW: نفس منطق slotId الموجود في firestoreBookings.ts
function safeKey(s: string) {
  return String(s || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
}
function buildSlotId(salonId: string, employeeKey: string, date: string, time: string) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
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
 * ✅ أهم إصلاح: صلاحية العرض حسب "تاريخ الحجز" (مو اليوم)
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

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    service: "",
    employee: "",
    employeeId: "",
    date: "",
    time: "",
    note: "",
    paymentMethod: "cash",
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

  // ✅ NEW: فحص مبكر لتوفر السلوّت من Firestore
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotChecking, setSlotChecking] = useState(false);
  const [slotMsg, setSlotMsg] = useState("");

  // ✅ NEW: الموظفات من Firestore حسب القسم
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

  const servicesFlat: FlatService[] = useMemo(() => {
    const out: FlatService[] = [];

    Object.entries(pricingSections).forEach(([sectionId, section]) => {
      const dept =
        sectionId === "hair" || sectionId === "coloring"
          ? "الشعر"
          : sectionId === "makeup"
          ? "المكياج"
          : sectionId === "nails"
          ? "الأظافر"
          : sectionId === "waxing"
          ? "البشرة"
          : "الشعر";

      section.services.forEach((cat, catIdx) => {
        cat.items.forEach((it, itemIdx) => {
          const id = `${sectionId}-${catIdx}-${itemIdx}`;
          const basePrice = extractMinPrice(it.price);

          out.push({
            id,
            sectionId,
            sectionTitle: section.title,
            category: cat.category,
            name: `${cat.category} - ${it.name}`,
            department: dept,
            priceText: it.price,
            basePrice,
          });
        });
      });
    });

    return out;
  }, []);

  const sectionOptions = useMemo(() => {
    return Object.entries(pricingSections).map(([id, sec]) => ({
      id,
      title: sec.title,
    }));
  }, []);

  const servicesInSection = useMemo(() => {
    if (!selectedSectionId) return [];
    return servicesFlat.filter((s) => s.sectionId === selectedSectionId);
  }, [servicesFlat, selectedSectionId]);

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

  const selectedService = useMemo(() => {
    return formData.service ? getServiceById(formData.service) : null;
  }, [formData.service]);

  // =========================
  // ✅ تحميل الموظفات عند اختيار القسم
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

      try {
        setStaffLoading(true);
        setStaffError("");

        const res = await listActiveStaffBySpecialty({
          salonId: SALON_ID,
          sectionId: selectedSectionId,
        });

        if (!cancelled) setStaff(res);
      } catch (e: any) {
        console.error("loadStaff error:", e);
        if (!cancelled) {
          const msg = String(e?.message || "");
          if (msg.toLowerCase().includes("requires an index")) {
            setStaffError(
              "Firestore يحتاج Index للاستعلام (array-contains). افتح الكونسول واضغط Create index من رسالة الخطأ."
            );
          } else if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            setStaffError("صلاحيات قراءة الموظفات غير كافية. لازم نفتح قراءة staff_public للعميلات في Rules.");
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
  }, [selectedSectionId]);

  // =========================
  // ✅ فلترة الموظفات حسب الوقت (LocalStorage فقط)
  // =========================
  const filteredEmployees = useMemo(() => {
    const list = staff
      .filter((s) => (s?.name || "").trim())
      .map((s) => ({
        id: s.id,
        name: s.name.trim(),
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
      (!chosenId && chosenName && filteredEmployees.some((e) => e.name === chosenName));

    if (!exists) {
      setFormData((p) => ({ ...p, employeeId: "", employee: "" }));
    }
  }, [filteredEmployees, formData.employeeId, formData.employee]);

  // =========================
  // ✅ NEW: فحص السلوّت مبكرًا من Firestore
  // ✅✅ FIX: اقرأ من نفس المسار الحقيقي: salons/main/booking_slots
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

        const slotId = buildSlotId(SALON_ID, employeeKey, date, time);

        // ✅✅ هنا التعديل الحقيقي:
        // بدل doc(db, "booking_slots", slotId)
        const snap = await getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));

        if (cancelled) return;

        if (snap.exists()) {
          setSlotBusy(true);
          setSlotMsg("هذا الوقت محجوز لهذه الموظفة. اختاري وقتًا آخر أو موظفة أخرى إن وُجدت.");
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
  }, [formData.employeeId, formData.employee, formData.date, formData.time]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
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

    setFormData((prev) => ({
      ...prev,
      service: "",
      employee: "",
      employeeId: "",
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

  const handleRemoveCoupon = () => {
    setCouponCode("");
    setManualOverride(false);

    const basePrice = getServiceBasePrice(formData.service);
    setApplied({ offer: null, discountAmount: 0, finalPrice: basePrice });
    setOfferMsg("");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (slotBusy) {
      openModal({
        title: "الوقت غير متاح",
        message: "هذا الوقت محجوز لهذه الموظفة. اختاري وقتًا آخر أو موظفة أخرى إن وُجدت.",
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

    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 900));

    const basePrice = getServiceBasePrice(formData.service);
    const serviceId = formData.service;

    const normalizedPayment: PaymentMethod = normalizePaymentMethod(formData.paymentMethod);

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

        const dateCheck = isOfferValidForBookingDate(offer as any, formData.date);
        if (!dateCheck.ok) {
          setIsLoading(false);
          openModal({
            title: "العرض غير متاح لهذا التاريخ",
            message: dateCheck.reason || "هذا العرض غير متاح لتاريخ الحجز المختار.",
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
      Number(finalApplied.finalPrice || 0) > 0 ? finalApplied.finalPrice : basePrice;

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

      employeeId: String(formData.employeeId || "").trim(),
      employee: String(formData.employee || "").trim(),
    };

    localStorage.setItem("currentBooking", JSON.stringify(bookingWithOffer));

    setIsLoading(false);
    setShowSuccess(true);
    setCountdown(5);
    setShouldRedirect(false);
  };

  useEffect(() => {
    const draft = localStorage.getItem("bookingDraft");
    if (draft) {
      const parsed = JSON.parse(draft);

      if (parsed?.paymentMethod) {
        parsed.paymentMethod = normalizePaymentMethod(parsed.paymentMethod);
      } else {
        parsed.paymentMethod = "cash";
      }

      setFormData((prev) => ({
        ...prev,
        ...parsed,
        employee: String(parsed?.employee || "").trim(),
        employeeId: String(parsed?.employeeId || "").trim(),
      }));

      if (parsed?.service) {
        const s = getServiceById(parsed.service);
        if (s?.sectionId) setSelectedSectionId(s.sectionId);
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
                <h1 className="booking-title">احجزي موعدك الآن</h1>
                <p className="booking-subtitle">اختاري الخدمة والوقت المناسب لك وسنكون بانتظارك</p>
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
                        onChange={handleChange}
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
                    disabled={!selectedSectionId}
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
                          const employeeId = e.target.value;
                          const emp = filteredEmployees.find((x) => x.id === employeeId);

                          setFormData((prev) => ({
                            ...prev,
                            employeeId,
                            employee: emp?.name || "",
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

                    {staffError && <div className="no-employee-warning mt-2">{staffError}</div>}

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

                  {slotChecking && formData.employeeId && formData.date && formData.time && (
                    <div className="mt-2 booking-offer-msg">جاري التحقق من توفر هذا الوقت...</div>
                  )}
                  {slotMsg && <div className="no-employee-warning mt-2">{slotMsg}</div>}
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
                      * مدى أونلاين حالياً تجربة مبدئية: سيتم حفظ الحجز “بانتظار الدفع” ثم المتابعة لصفحة Success.
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
                      onClick={handleRemoveCoupon}
                      disabled={!formData.service}
                    >
                      إزالة
                    </button>
                  </div>

                  {offerMsg && <div className="mt-2 booking-offer-msg">{offerMsg}</div>}

                  <div className="booking-price-summary mt-3">
                    <div className="d-flex justify-content-between">
                      <span>السعر قبل الخصم</span>
                      <strong>{basePrice} ريال</strong>
                    </div>

                    <div className="d-flex justify-content-between">
                      <span>الخصم</span>
                      <strong>{Number(applied.discountAmount || 0).toFixed(0)} ريال</strong>
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
              شكراً لاختيارك صالون ملكات. تم استلام طلب حجزك وسيتم التواصل معك قريباً لتأكيد الموعد.
            </p>

            <div className="booking-details">
              <div className="booking-detail-item">
                <span className="booking-detail-label">الخدمة:</span>
                <span className="booking-detail-value">{getServiceName(formData.service)}</span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">الموظفة:</span>
                <span className="booking-detail-value">{formData.employee}</span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">التاريخ:</span>
                <span className="booking-detail-value">{formatDate(formData.date)}</span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">الوقت:</span>
                <span className="booking-detail-value">{formData.time}</span>
              </div>

              <div className="booking-detail-item">
                <span className="booking-detail-label">السعر النهائي:</span>
                <span className="booking-detail-value">{Number(finalPrice).toFixed(0)} ريال</span>
              </div>

              {applied.offer && (
                <div className="booking-detail-item">
                  <span className="booking-detail-label">العرض:</span>
                  <span className="booking-detail-value">{(applied.offer as any).title}</span>
                </div>
              )}
            </div>

            <div className="success-actions">
              <button className="success-primary-btn" onClick={() => navigate("/checkout")}>
                الانتقال للدفع
              </button>
            </div>

            <p className="redirect-message">
              سيتم تحويلك تلقائياً إلى صفحة الدفع خلال <span className="countdown">{countdown}</span> ثواني
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Booking;
