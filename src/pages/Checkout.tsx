

// src/pages/Checkout.tsx
import { useEffect, useMemo, useState } from "react";
import {
  createBooking,
  type BookingStatus,
  buildBookingSlotId, // ✅ NEW
} from "../services/firestoreBookings";
import { incrementOfferUsage } from "../services/firestoreOffers";
import { incrementPackageUsage } from "../services/firestorePackages";

import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarAlt,
  faClock,
  faUser,
  faPhone,
  faMoneyBill,
  faCheckCircle,
  faArrowRight,
  faCircleInfo,
  faCreditCard,
  faTag,
} from "@fortawesome/free-solid-svg-icons";

import { getAuth, signInAnonymously } from "firebase/auth";
import "../styles/Checkout.css";
import { formatTime12 } from "../helpers/timeDisplay";

import ConfirmModal from "../components/ConfirmModal";
import { buildSuccessNavigationPayload } from "../helpers/successNavigation";

// ✅ NEW: same resolver used in Dashboard (serviceId -> serviceName)
import { resolveServiceName } from "../services/serviceResolver";

type PaymentMethod = "cash" | "pos_card" | "mada_online";
type PaymentStatus = "pending" | "paid";

type BookingData = {
  bookingId?: string;
  id?: string;
  trackId?: string;

  // ✅ NEW: Human readable booking number (MK-10234)
  publicId?: string;

  name?: string;
  phone?: string;

  service?: string;
  serviceName?: string;

  employee?: string;
  employeeId?: string;

  date?: string;
  time?: string;

  // ✅ slotId might exist in LS but is NOT source of truth
  slotId?: string;

  total?: number;
  finalPrice?: number;

  paymentMethod?: PaymentMethod | string;
  paymentStatus?: PaymentStatus;

  couponCode?: string;
  offerId?: string | null;
  offerTitle?: string | null;
  discountAmount?: number;

  status?: "pending" | "confirmed" | "completed" | "cancelled";
  createdAt?: number;

  durationMin?: number;
};

const BOOKING_KEY = "currentBooking";
const ALL_BOOKINGS_KEY = "allBookings";
const SALON_ID = "main";

// ✅ NEW: counter key for human booking numbers
const BOOKING_PUBLIC_COUNTER_KEY = "booking_public_counter_v1";

function methodLabel(m: PaymentMethod) {
  if (m === "mada_online") return "مدى أونلاين";
  if (m === "pos_card") return "شبكة في الصالون";
  return "كاش";
}

function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x || "").toLowerCase().trim();

  if (s === "mada_online" || s.includes("اونلاين") || s.includes("online"))
    return "mada_online";
  if (s === "pos_card" || s.includes("في الصالون") || s.includes("صالون"))
    return "pos_card";
  if (s === "cash" || s === "كاش" || s === "نقد") return "cash";

  if (s === "pos_mada") return "pos_card";
  if (s === "card" || s === "شبكة" || s === "مدى" || s === "mada")
    return "pos_card";
  if (s === "transfer" || s === "تحويل" || s === "بنكي" || s === "bank")
    return "cash";
  if (s === "other" || s === "اخرى" || s === "أخرى") return "cash";

  return "cash";
}

function toInt(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

async function ensureUserUid(): Promise<string | null> {
  const auth = getAuth();
  if (auth.currentUser?.uid) return auth.currentUser.uid;

  try {
    const cred = await signInAnonymously(auth);
    return cred.user?.uid ?? null;
  } catch (err) {
    console.warn("[Checkout] signInAnonymously failed:", err);
    return null;
  }
}

// ✅ NEW: generate MK-10234 style id (local counter)
function nextPublicBookingId(prefix = "MK"): string {
  try {
    const raw = localStorage.getItem(BOOKING_PUBLIC_COUNTER_KEY);
    const current = Number(raw || "10233"); // start so first becomes 10234
    const next = Number.isFinite(current) ? current + 1 : 10234;

    localStorage.setItem(BOOKING_PUBLIC_COUNTER_KEY, String(next));

    // pad to 5 digits (optional) — gives MK-10234 as-is if already 5 digits
    const n = String(next).padStart(5, "0");
    return `${prefix}-${n}`;
  } catch {
    // fallback random-ish
    const rnd = Math.floor(10000 + Math.random() * 90000);
    return `${prefix}-${rnd}`;
  }
}

export default function Checkout() {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingData | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ NEW: label to show real service name even if stored value is serviceId
  const [serviceLabel, setServiceLabel] = useState<string>("");

  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
    variant: "info" as "info" | "danger" | "success",
    afterClose: null as null | (() => void),
  });

  const openModal = (x: {
    title: string;
    message: string;
    variant?: "info" | "danger" | "success";
    afterClose?: null | (() => void);
  }) => {
    setModal({
      open: true,
      title: x.title,
      message: x.message,
      variant: x.variant || "info",
      afterClose: x.afterClose ?? null,
    });
  };

  const closeModal = () => {
    setModal((p) => {
      const cb = p.afterClose;
      setTimeout(() => cb?.(), 0);
      return { ...p, open: false, afterClose: null };
    });
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOOKING_KEY);

      if (raw) {
        const parsed = JSON.parse(raw);
        setBooking(parsed);
        return;
      }

      const draft = localStorage.getItem("bookingDraft");
      if (draft) {
        const parsedDraft = JSON.parse(draft);
        setBooking({
          name: parsedDraft?.name,
          phone: parsedDraft?.phone,
          service: parsedDraft?.service,
          serviceName: parsedDraft?.serviceName,
          employee: parsedDraft?.employee,
          employeeId: parsedDraft?.employeeId,
          date: parsedDraft?.date,
          time: parsedDraft?.time,

          slotId:
            parsedDraft?.slotId ||
            parsedDraft?.slotKey ||
            parsedDraft?.selectedSlotId,

          total: parsedDraft?.total ?? parsedDraft?.finalPrice,
          finalPrice: parsedDraft?.finalPrice ?? parsedDraft?.total,
          paymentMethod: parsedDraft?.paymentMethod,
          couponCode: parsedDraft?.couponCode,
          offerId: parsedDraft?.offerId,
          offerTitle: parsedDraft?.offerTitle,
          discountAmount: parsedDraft?.discountAmount,
          durationMin: parsedDraft?.durationMin,
        });
        return;
      }

      setBooking(null);
    } catch (e) {
      console.error("[Checkout] parse error:", e);
      setBooking(null);
    }
  }, []);

  // ✅ NEW: generate preview booking number early (so it shows on Checkout)
  useEffect(() => {
    if (!booking) return;

    // إذا موجود مسبقًا لا تولد مرّة ثانية
    const existing = String(booking.publicId || "").trim();
    if (existing) return;

    const generated = nextPublicBookingId("MK");

    const updated: BookingData = {
      ...booking,
      publicId: generated,
    };

    setBooking(updated);

    // خزّن نفس الرقم فورًا عشان يطلع مباشرة
    try {
      localStorage.setItem(BOOKING_KEY, JSON.stringify(updated));
    } catch { }
  }, [booking]);


  const view = useMemo(() => {
    if (!booking) return null;

    const bookingId = String(booking.bookingId || booking.id || "").trim();
    const publicId = String(booking.publicId || "").trim();

    const name = booking.name || "";
    const phone = booking.phone || "";
    const date = String(booking.date || "");
    const time = String(booking.time || "");
    const service = booking.serviceName || booking.service || "";

    const employee = String(booking.employee || "").trim();
    const employeeId = String(booking.employeeId || "").trim();

    // ✅ SlotId is DISPLAY/debug only (source of truth will be created in Firestore)
    const employeeKey = employeeId || employee || "unknown_employee";
    const slotIdDisplay = date && time ? buildBookingSlotId(date, time, employeeKey) : "";

    const total = toInt((booking.total ?? booking.finalPrice) ?? 0);
    const paymentMethod = normalizePaymentMethod(booking.paymentMethod);
    const paymentStatus: PaymentStatus =
      booking.paymentStatus === "paid" ? "paid" : "pending";

    const durationMin = Number(booking.durationMin || 0) || undefined;

    return {
      bookingId,
      publicId,
      name,
      phone,
      date,
      time,
      service,

      employee,
      employeeId,

      slotIdDisplay,

      total,
      paymentMethod,
      paymentStatus,

      couponCode: String(booking.couponCode || "").trim(),
      offerId: booking.offerId || null,
      offerTitle: booking.offerTitle || null,
      discountAmount: toInt(booking.discountAmount || 0),

      durationMin,
    };
  }, [booking]);

  // ✅ NEW: Convert serviceId -> serviceName (same logic idea as Dashboard)
  // ✅ المكان: بعد view مباشرة
  useEffect(() => {
    let alive = true;

    const load = async () => {
      const raw = String(view?.service || "").trim();
      if (!raw) {
        if (alive) setServiceLabel("");
        return;
      }

      // إذا كان النص يبدو كـ ID (طويل + بدون مسافات + حروف/أرقام/underscore/dash)
      const looksLikeId =
        raw.length >= 15 && !raw.includes(" ") && /^[A-Za-z0-9_-]+$/.test(raw);

      if (!looksLikeId) {
        if (alive) setServiceLabel(raw);
        return;
      }

      try {
        const name = await resolveServiceName(raw);
        if (alive) setServiceLabel(name || raw);
      } catch {
        if (alive) setServiceLabel(raw);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, [view?.service]);

  if (!view) {
    return (
      <div className="checkout-page">
        <div className="checkout-card">
          <h2>تأكيد الحجز</h2>
          <p style={{ color: "#777", textAlign: "center", margin: "10px 0 14px" }}>
            ما لقينا بيانات حجز للتأكيد. ارجع لصفحة الحجز وسوّي حجز جديد.
          </p>

          <button
            className="btn btn-primary confirm-btn"
            onClick={() => navigate("/booking")}
          >
            <FontAwesomeIcon icon={faArrowRight} /> رجوع للحجز
          </button>
        </div>
      </div>
    );
  }

  const upsertBookingAndGoSuccess = async (opts?: { paymentStatus?: PaymentStatus }) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const normalizedPayment = normalizePaymentMethod(view.paymentMethod);
      const bookingStatus: BookingStatus = "pending";

      if (!view.employeeId) {
        openModal({
          title: "بيانات غير مكتملة",
          message: "ما تم اختيار الموظفة بشكل صحيح. ارجع وعدّل الحجز.",
          variant: "danger",
          afterClose: () => navigate("/booking"),
        });
        return;
      }

      // ✅ IMPORTANT: لا نتحقق من slotId هنا — Firestore هو اللي يبنيه ويقفل المواعيد
      const uid = await ensureUserUid();
      if (!uid) {
        openModal({
          title: "تعذر إكمال الحجز",
          message:
            "لم نستطع إنشاء جلسة مستخدم للكتابة في Firestore.\n\n" +
            "إذا تبي الحجز يمشي للزوار بدون حساب، فعّل Anonymous Auth من Firebase Authentication.",
          variant: "danger",
        });
        return;
      }

      const discountNote = view.offerId
        ? `Offer: ${view.offerTitle || view.couponCode || "-"} | discount=${toInt(
          view.discountAmount || 0
        )}`
        : "";

      const employeeNote = view.employeeId ? `employeeId: ${view.employeeId}` : "";

      const baseNote =
        normalizedPayment === "mada_online"
          ? `Payment: ${normalizedPayment} / ${opts?.paymentStatus || "pending"}`
          : `Payment: ${normalizedPayment}`;

      const noteFinal = [baseNote, employeeNote, discountNote].filter(Boolean).join(" | ");

      const totalInt = toInt(view.total || 0);
      const finalInt = toInt(view.total || 0);

      const { id: firestoreId, publicId: fsPublicId } = await createBooking({
        userId: uid,

        createdBy: "client",
        channel: "client",

        clientName: view.name,
        clientPhone: view.phone,

        serviceName: view.service,

        durationMin: view.durationMin ?? 60,

        employeeId: view.employeeId,
        employeeName: view.employee || "-",

        date: view.date,
        time: view.time,

        total: totalInt,
        finalPrice: finalInt,

        status: bookingStatus,
        note: noteFinal || undefined,
      });

      try {
        if (view.offerId) {
          await incrementOfferUsage(SALON_ID, view.offerId);
        }
        const packageIdRaw = String((view as any)?.packageId || "").trim();
        if (packageIdRaw) {
          const packageId = packageIdRaw.toLowerCase().startsWith("package:")
            ? packageIdRaw.slice("package:".length).trim()
            : packageIdRaw;
          if (packageId && !packageId.toLowerCase().startsWith("offer:")) {
            await incrementPackageUsage(SALON_ID, packageId);
          }
        }
      } catch (e) {
        console.warn("usage counter update failed:", e);
      }

      // ✅ NEW: build human readable booking number (MK-10234)
      const publicId = fsPublicId || booking?.publicId || view.publicId || nextPublicBookingId("MK");

      const updatedCurrent: BookingData = {
        ...(booking || {}),

        bookingId: firestoreId,
        id: firestoreId,
        trackId: firestoreId,

        // ✅ NEW
        publicId,

        employeeId: view.employeeId,
        employee: view.employee || booking?.employee || "",

        // ✅ store display slotId for debugging (optional)
        slotId: view.slotIdDisplay,

        total: totalInt,
        finalPrice: finalInt,

        paymentMethod: normalizedPayment,
        paymentStatus: opts?.paymentStatus || "pending",
        status: bookingStatus,

        durationMin: view.durationMin ?? booking?.durationMin ?? 60,
      };

      localStorage.setItem(BOOKING_KEY, JSON.stringify(updatedCurrent));
      localStorage.removeItem(ALL_BOOKINGS_KEY);

      {
        const successNav = buildSuccessNavigationPayload(updatedCurrent, "created");
        navigate(successNav.to, { state: successNav.state });
      }
    } catch (e: any) {
      console.error(e);

      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        openModal({
          title: "الوقت محجوز",
          message: "هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر.",
          variant: "danger",
          afterClose: () => navigate("/booking"),
        });
        return;
      }

      const code = String(e?.code || "");
      const msg = String(e?.message || "");

      openModal({
        title: "تعذر حفظ الحجز",
        message:
          `خطأ Firestore:\n` +
          `code: ${code || "—"}\n` +
          `message: ${msg || "—"}\n\n` +
          `نقاط تحقق سريعة:\n` +
          `- total و finalPrice لازم تكون أرقام (int).\n` +
          `- إذا تبي الزوار بدون حساب: فعّل Anonymous Auth.\n`,
        variant: "danger",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMadaOnline = async () => {
    await upsertBookingAndGoSuccess({ paymentStatus: "pending" });
  };

  const handleSalonPay = async () => {
    await upsertBookingAndGoSuccess({ paymentStatus: "pending" });
  };

  const isOnline = normalizePaymentMethod(view.paymentMethod) === "mada_online";

  const primaryBtnText = isOnline ? "متابعة: دفع مدى أونلاين (مبدئي)" : "تأكيد الحجز";
  const primaryBtnIcon = isOnline ? faCreditCard : faCheckCircle;
  const primaryAction = isOnline ? handleMadaOnline : handleSalonPay;

  return (
    <div className="checkout-page">
      <ConfirmModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        variant={modal.variant}
        confirmText="حسنًا"
        onConfirm={closeModal}
        onCancel={closeModal}
      />

      <div className="checkout-card">
        <h2>تأكيد الحجز</h2>

        {isOnline && (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(0,0,0,0.04)",
              marginBottom: 14,
            }}
          >
            <FontAwesomeIcon icon={faCircleInfo} style={{ marginTop: 3 }} />
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                مدى أونلاين (مبدئيًا)
              </div>
              <div style={{ color: "#555" }}>
                حالياً بنسجّل الحجز <b>بانتظار الدفع</b>، وخطوة ربط بوابة الدفع
                نضيفها لاحقًا عبر مزود دفع + Firebase Functions.
              </div>
            </div>
          </div>
        )}

        {/* ✅ NEW: Human booking number */}
        <div className="checkout-item">
          <strong>رقم الحجز:</strong>
          <span style={{ fontWeight: 800 }}>{view.publicId || "—"}</span>
        </div>

        <div className="checkout-item">
          <FontAwesomeIcon icon={faUser} />
          <span>{view.name || "—"}</span>
        </div>

        <div className="checkout-item">
          <FontAwesomeIcon icon={faPhone} />
          <span>{view.phone || "—"}</span>
        </div>

        <div className="checkout-item">
          <FontAwesomeIcon icon={faCalendarAlt} />
          <span>{view.date || "—"}</span>
        </div>

        <div className="checkout-item">
          <FontAwesomeIcon icon={faClock} />
          <span>{formatTime12(view.time || "", "—")}</span>
        </div>

        <div className="checkout-item">
          <strong>الخدمة:</strong>
          <span>{serviceLabel || view.service || "—"}</span>
        </div>

        <div className="checkout-item">
          <strong>الموظفة:</strong>
          <span>{view.employee || "—"}</span>
        </div>

        <div className="checkout-item">
          <strong>طريقة الدفع:</strong>
          <span>{methodLabel(normalizePaymentMethod(view.paymentMethod))}</span>
        </div>

        {view.offerId && (
          <div className="checkout-item">
            <FontAwesomeIcon icon={faTag} />
            <span>
              الخصم: <b>{view.offerTitle || view.couponCode || "—"}</b> —{" "}
              <b>{Number(view.discountAmount || 0).toFixed(0)} ريال</b>
            </span>
          </div>
        )}

        <div className="checkout-total">
          <FontAwesomeIcon icon={faMoneyBill} />
          <span>{Number(view.total ?? 0).toLocaleString()} ريال</span>
        </div>

        <button
          className="btn btn-primary confirm-btn"
          onClick={primaryAction}
          disabled={isSubmitting}
          style={isSubmitting ? { opacity: 0.75, cursor: "not-allowed" } : undefined}
        >
          <FontAwesomeIcon icon={primaryBtnIcon} />{" "}
          {isSubmitting ? "جاري حفظ الحجز..." : primaryBtnText}
        </button>

        <button
          className="btn btn-outline-secondary confirm-btn"
          style={{ marginTop: 10 }}
          onClick={() => navigate("/booking")}
          disabled={isSubmitting}
        >
          <FontAwesomeIcon icon={faArrowRight} /> تعديل الحجز
        </button>
      </div>
    </div>
  );
}
