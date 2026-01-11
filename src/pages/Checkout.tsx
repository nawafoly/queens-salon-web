// src/pages/Checkout.tsx
import { useEffect, useMemo, useState } from "react";
import { createBooking, type BookingStatus } from "../services/firestoreBookings";
import { incrementOfferUsage } from "../services/firestoreOffers";

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

import ConfirmModal from "../components/ConfirmModal";

type PaymentMethod = "cash" | "pos_card" | "mada_online";
type PaymentStatus = "pending" | "paid";

type BookingData = {
  bookingId?: string;
  id?: string;
  trackId?: string;

  name?: string;
  phone?: string;

  service?: string;
  serviceName?: string;

  // ✅ القديم (اسم الموظفة)
  employee?: string;

  // ✅ NEW: id الحقيقي للموظفة (UID / docId)
  employeeId?: string;

  date?: string;
  time?: string;

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
};

const BOOKING_KEY = "currentBooking";
const ALL_BOOKINGS_KEY = "allBookings";
const SALON_ID = "main";

function methodLabel(m: PaymentMethod) {
  if (m === "mada_online") return "مدى أونلاين";
  if (m === "pos_card") return "شبكة في الصالون";
  return "كاش";
}

function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x || "").toLowerCase().trim();

  if (s === "mada_online" || s.includes("اونلاين") || s.includes("online")) return "mada_online";
  if (s === "pos_card" || s.includes("في الصالون") || s.includes("صالون")) return "pos_card";
  if (s === "cash" || s === "كاش" || s === "نقد") return "cash";

  if (s === "pos_mada") return "pos_card";
  if (s === "card" || s === "شبكة" || s === "مدى" || s === "mada") return "pos_card";
  if (s === "transfer" || s === "تحويل" || s === "بنكي" || s === "bank") return "cash";
  if (s === "other" || s === "اخرى" || s === "أخرى") return "cash";

  return "cash";
}

function toInt(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

export default function Checkout() {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingData | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ modal بدل alert
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

      // ✅ fallback (إذا صار اختلاف/مسح للكي)
      const draft = localStorage.getItem("bookingDraft");
      if (draft) {
        const parsedDraft = JSON.parse(draft);
        // نحاول نحول الدرفت لنفس شكل BookingData قدر الإمكان بدون كسر
        setBooking({
          name: parsedDraft?.name,
          phone: parsedDraft?.phone,
          service: parsedDraft?.service,
          serviceName: parsedDraft?.serviceName,
          employee: parsedDraft?.employee,
          employeeId: parsedDraft?.employeeId,
          date: parsedDraft?.date,
          time: parsedDraft?.time,
          total: parsedDraft?.total ?? parsedDraft?.finalPrice,
          finalPrice: parsedDraft?.finalPrice ?? parsedDraft?.total,
          paymentMethod: parsedDraft?.paymentMethod,
          couponCode: parsedDraft?.couponCode,
          offerId: parsedDraft?.offerId,
          offerTitle: parsedDraft?.offerTitle,
          discountAmount: parsedDraft?.discountAmount,
        });
        return;
      }

      setBooking(null);
    } catch (e) {
      console.error("[Checkout] parse error:", e);
      setBooking(null);
    }
  }, []);

  const view = useMemo(() => {
    if (!booking) return null;

    const bookingId = String(booking.bookingId || booking.id || "").trim();
    const name = booking.name || "";
    const phone = booking.phone || "";
    const date = String(booking.date || "");
    const time = String(booking.time || "");
    const service = booking.serviceName || booking.service || "";

    const employee = String(booking.employee || "").trim();
    const employeeId = String(booking.employeeId || "").trim(); // ✅ NEW

    const total = toInt((booking.total ?? booking.finalPrice) ?? 0);
    const paymentMethod = normalizePaymentMethod(booking.paymentMethod);

    const paymentStatus: PaymentStatus = booking.paymentStatus === "paid" ? "paid" : "pending";

    return {
      bookingId,
      name,
      phone,
      date,
      time,
      service,

      employee,
      employeeId,

      total,
      paymentMethod,
      paymentStatus,

      couponCode: String(booking.couponCode || "").trim(),
      offerId: booking.offerId || null,
      offerTitle: booking.offerTitle || null,
      discountAmount: toInt(booking.discountAmount || 0),
    };
  }, [booking]);

  if (!view) {
    return (
      <div className="checkout-page">
        <div className="checkout-card">
          <h2>تأكيد الحجز</h2>
          <p style={{ color: "#777", textAlign: "center", margin: "10px 0 14px" }}>
            ما لقينا بيانات حجز للتأكيد. ارجع لصفحة الحجز وسوّي حجز جديد.
          </p>

          <button className="btn btn-primary confirm-btn" onClick={() => navigate("/booking")}>
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

      // ✅ حماية بسيطة: لازم موظفة (ونفضّل UID)
      if (!view.employeeId) {
        openModal({
          title: "بيانات غير مكتملة",
          message: "ما تم اختيار الموظفة بشكل صحيح. ارجع وعدّل الحجز.",
          variant: "danger",
          afterClose: () => navigate("/booking"),
        });
        return;
      }

      const auth = getAuth();

      // ✅ لو ما فيه مستخدم، حاول Anonymous
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.warn("[Checkout] signInAnonymously failed:", err);
        }
      }

      const uid = auth.currentUser?.uid ?? null;

      const discountNote = view.offerId
        ? `Offer: ${view.offerTitle || view.couponCode || "-"} | discount=${toInt(view.discountAmount || 0)}`
        : "";

      const employeeNote = view.employeeId ? `employeeId: ${view.employeeId}` : "";

      const baseNote =
        normalizedPayment === "mada_online"
          ? `Payment: ${normalizedPayment} / ${opts?.paymentStatus || "pending"}`
          : `Payment: ${normalizedPayment}`;

      const noteFinal = [baseNote, employeeNote, discountNote].filter(Boolean).join(" | ");

      // ✅✅ أهم إصلاح للـ Rules:
      // total/finalPrice لازم تكون INT (مو Double)
      const totalInt = toInt(view.total || 0);
      const finalInt = toInt(view.total || 0);

      const firestoreId = await createBooking({
        userId: uid,
        createdBy: "client",
        channel: "client",

        clientName: view.name,
        clientPhone: view.phone,

        serviceName: view.service,

        employeeId: view.employeeId, // ✅ UID فقط
        employeeName: view.employee || "-", // ✅ للعرض

        date: view.date,
        time: view.time,

        total: totalInt,
        finalPrice: finalInt,

        status: bookingStatus,
        note: noteFinal || undefined,
      } as any);

      try {
        if (view.offerId) {
          await incrementOfferUsage(SALON_ID, view.offerId);
        }
      } catch (e) {
        console.warn("incrementOfferUsage failed:", e);
      }

      const updatedCurrent: BookingData = {
        ...booking,

        bookingId: firestoreId,
        id: firestoreId,
        trackId: firestoreId,

        employeeId: view.employeeId,
        employee: view.employee || booking?.employee || "",

        total: totalInt,
        finalPrice: finalInt,

        paymentMethod: normalizedPayment,
        paymentStatus: opts?.paymentStatus || "pending",
        status: bookingStatus,
      };

      localStorage.setItem(BOOKING_KEY, JSON.stringify(updatedCurrent));
      localStorage.removeItem(ALL_BOOKINGS_KEY);

      navigate("/success");
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
          `ملاحظة مهمة:\n` +
          `Rules عندك تشترط total و finalPrice تكون int.\n` +
          `وأيضًا إذا Anonymous Auth مقفل، لازم تفعيلها من Firebase Auth.\n`,
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
              <div style={{ fontWeight: 700, marginBottom: 4 }}>مدى أونلاين (مبدئيًا)</div>
              <div style={{ color: "#555" }}>
                حالياً بنسجّل الحجز <b>بانتظار الدفع</b>، وخطوة ربط بوابة الدفع نضيفها لاحقًا عبر مزود دفع + Firebase
                Functions.
              </div>
            </div>
          </div>
        )}

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
          <span>{view.time || "—"}</span>
        </div>

        <div className="checkout-item">
          <strong>الخدمة:</strong>
          <span>{view.service || "—"}</span>
        </div>

        <div className="checkout-item">
          <strong>الموظفة:</strong>
          <span>{view.employee || "—"}</span>
        </div>

        {!!view.employeeId && (
          <div className="checkout-item" style={{ opacity: 0.8, fontSize: 13 }}>
            <strong>employeeId:</strong>
            <span>{view.employeeId}</span>
          </div>
        )}

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
          <FontAwesomeIcon icon={primaryBtnIcon} /> {isSubmitting ? "جاري حفظ الحجز..." : primaryBtnText}
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
