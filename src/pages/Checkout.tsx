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

import { getAuth } from "firebase/auth"; // ✅ NEW

import "../styles/Checkout.css";

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

  employee?: string; // (حاليًا اسم الموظفة عندك)
  date?: string;
  time?: string;

  total?: number;
  finalPrice?: number;

  paymentMethod?: PaymentMethod | string;
  paymentStatus?: PaymentStatus;

  // ✅ coupon/offer data
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

export default function Checkout() {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingData | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(BOOKING_KEY);
    if (!raw) {
      setBooking(null);
      return;
    }
    try {
      setBooking(JSON.parse(raw));
    } catch {
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
    const employee = booking.employee || "";

    const total = Number((booking.total ?? booking.finalPrice) ?? 0);
    const paymentMethod = normalizePaymentMethod(booking.paymentMethod);

    const paymentStatus: PaymentStatus =
      booking.paymentStatus === "paid" ? "paid" : "pending";

    return {
      bookingId,
      name,
      phone,
      date,
      time,
      service,
      employee,
      total,
      paymentMethod,
      paymentStatus,

      couponCode: String(booking.couponCode || "").trim(),
      offerId: booking.offerId || null,
      offerTitle: booking.offerTitle || null,
      discountAmount: Number(booking.discountAmount || 0),
    };
  }, [booking]);

  if (!view) {
    return (
      <div className="checkout-page">
        <div className="checkout-card">
          <h2>تأكيد الحجز</h2>
          <p style={{ color: "#777", textAlign: "center", margin: "10px 0 20px" }}>
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
    try {
      const id = view.bookingId || `B-${Date.now()}`;
      const normalizedPayment = normalizePaymentMethod(view.paymentMethod);

      // ✅ NEW: نخلي الحالة دائمًا Pending (قيد المراجعة)
      const bookingStatus: BookingStatus = "pending";

      // ✅ NEW: لو فيه تسجيل دخول نخزّن uid (وإذا ما فيه يصير null)
      const auth = getAuth();
      const uid = auth.currentUser?.uid ?? null;

      // ✅ ملاحظة: نضيف معلومات الخصم داخل note
      const discountNote =
        view.offerId
          ? `Offer: ${view.offerTitle || view.couponCode || "-"} | discount=${Number(
              view.discountAmount || 0
            )}`
          : "";

      const baseNote =
        normalizedPayment === "mada_online"
          ? `Payment: ${normalizedPayment} / ${opts?.paymentStatus || "pending"}`
          : `Payment: ${normalizedPayment}`;

      const noteFinal = [baseNote, discountNote].filter(Boolean).join(" | ");

      // ✅ 1) إنشاء الحجز في Firestore
      const firestoreId = await createBooking({
        userId: uid,                 // ✅ بدل null
        createdBy: "client",
        channel: "client",

        clientName: view.name,
        clientPhone: view.phone,

        serviceName: view.service,
        employeeName: view.employee,

        date: view.date,
        time: view.time,

        total: Number(view.total || 0),
        finalPrice: Number(view.total || 0),

        status: bookingStatus,        // ✅ pending دائمًا
        note: noteFinal || undefined,
      });

      // ✅ 2) بعد نجاح إنشاء الحجز: زوّد usageCount للعرض (إذا موجود)
      try {
        if (view.offerId) {
          await incrementOfferUsage(SALON_ID, view.offerId);
        }
      } catch (e) {
        console.warn("incrementOfferUsage failed:", e);
      }

      const trackId = firestoreId;

      const updatedCurrent: BookingData = {
        ...booking,
        bookingId: id,
        id: firestoreId,
        trackId,

        paymentMethod: normalizedPayment,
        paymentStatus: opts?.paymentStatus || "pending",
        status: bookingStatus,
      };

      localStorage.setItem(BOOKING_KEY, JSON.stringify(updatedCurrent));
      localStorage.removeItem(ALL_BOOKINGS_KEY);

      navigate("/success");
    } catch (e: any) {
      console.error(e);

      // ✅ NEW: لو السلوّت محجوز
      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        alert("هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر.");
        navigate("/booking");
        return;
      }

      alert(
        "صار خطأ أثناء حفظ الحجز في النظام. تأكد من Firestore Rules ثم جرّب مرة ثانية."
      );
    }
  };

  const handleMadaOnline = async () => {
    await upsertBookingAndGoSuccess({ paymentStatus: "pending" });
  };

  const handleSalonPay = async () => {
    await upsertBookingAndGoSuccess({ paymentStatus: "pending" });
  };

  const isOnline = view.paymentMethod === "mada_online";

  const primaryBtnText = isOnline
    ? "متابعة: دفع مدى أونلاين (مبدئي)"
    : "تأكيد الحجز";
  const primaryBtnIcon = isOnline ? faCreditCard : faCheckCircle;
  const primaryAction = isOnline ? handleMadaOnline : handleSalonPay;

  return (
    <div className="checkout-page">
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

        <button className="btn btn-primary confirm-btn" onClick={primaryAction}>
          <FontAwesomeIcon icon={primaryBtnIcon} /> {primaryBtnText}
        </button>

        <button
          className="btn btn-outline-secondary confirm-btn"
          style={{ marginTop: 10 }}
          onClick={() => navigate("/booking")}
        >
          <FontAwesomeIcon icon={faArrowRight} /> تعديل الحجز
        </button>
      </div>
    </div>
  );
}
