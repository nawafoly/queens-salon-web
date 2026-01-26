

// src/pages/Success.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarAlt,
  faClock,
  faUser,
  faPhone,
  faScissors,
  faUserTie,
  faMoneyBill,
  faCircleInfo,
  faArrowRight,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";

import "../styles/Success.css";
import LoadingBrand from "../components/LoadingBrand";

// Firestore
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { getBookingById } from "../services/firestoreBookings";

/* =========================
   Types & Const
========================= */

type UiBookingView = {
  id: string; // داخلي فقط
  publicId?: string; // MK-xxxx للعرض
  clientName: string;
  clientPhone: string;

  serviceId: string;
  serviceName: string;

  employeeName: string;
  date: string;
  time: string;

  total: number;
  status: string;
};

const BOOKING_KEY = "currentBooking";
const SALON_ID = "main";
const SALON_WHATSAPP = "966548440401";

/* =========================
   Helpers
========================= */

function normalizeMk(raw: string) {
  const s = String(raw || "").trim().toUpperCase();
  const digits = s.match(/\d{3,}/)?.[0] || "";
  if (!digits) return "";
  return `MK-${digits}`;
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normStatus(s: string) {
  return String(s || "").toLowerCase().trim();
}

function statusLabel(s: string) {
  const v = normStatus(s);
  if (v === "confirmed" || s === "مؤكد") return "مؤكد";
  if (v === "pending" || s === "بانتظار" || s === "بالانتظار") return "بالانتظار";
  if (v === "completed" || s === "مكتمل") return "مكتمل";
  if (v === "cancelled" || s === "ملغي") return "ملغي";
  return s || "-";
}

function statusClass(s: string) {
  const v = normStatus(s);
  if (v === "confirmed" || s === "مؤكد") return "confirmed";
  if (v === "pending" || s === "بانتظار" || s === "بالانتظار") return "pending";
  if (v === "completed" || s === "مكتمل") return "completed";
  if (v === "cancelled" || s === "ملغي") return "cancelled";
  return "default";
}

function buildWhatsappMessage(args: { publicId: string; date: string; time: string }) {
  return (
    `مرحباً 🌷\n` +
    `أود تأكيد حجزي في صالون ملكات\n\n` +
    `رقم الحجز: ${args.publicId}\n` +
    `التاريخ: ${args.date}\n` +
    `الوقت: ${args.time}\n\n` +
    `شكراً لكم 🤍`
  );
}

// اختياري: لو ما عندك snapshot أو تبي احتياط
async function resolveServiceName(serviceId: string): Promise<string> {
  if (!serviceId) return "—";
  // إذا واضح إنه اسم مو ID (مثل "قص شعر")
  if (serviceId.length < 10) return serviceId;

  try {
    const ref = doc(db, "salons", SALON_ID, "services", serviceId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return "—";
    return (snap.data() as any)?.name || (snap.data() as any)?.الاسم || "—";
  } catch {
    return "—";
  }
}

export default function Success() {
  const navigate = useNavigate();
  const location = useLocation(); // موجود إذا احتجته (تقدر تحذفه لو ما تستخدمه)

  void location;

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<UiBookingView | null>(null);
  const [error, setError] = useState("");

  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToastMsg(msg);
    setToastType(type);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToastMsg(""), 1600);
  };

  const bookingId = useMemo(() => {
    try {
      const raw = localStorage.getItem(BOOKING_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return String(parsed?.id || parsed?.bookingId || "").trim();
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        setLoading(true);
        setError("");
        setView(null);

        if (!bookingId) {
          setError("رقم الحجز غير موجود");
          return;
        }

        const docData: any = await getBookingById(bookingId);
        if (!docData) {
          setError("لم يتم العثور على الحجز");
          return;
        }

        // ✅ اسم الخدمة: snapshot أولاً (ثابت) ثم احتياط من services
        const serviceId = String(docData.serviceId ?? docData.serviceName ?? "").trim();
        const snapName = String(docData.serviceSnapshot?.serviceNameAtBooking ?? "").trim();
        const serviceName = snapName || (await resolveServiceName(serviceId));

        if (!mounted) return;

        setView({
          id: docData.id || bookingId,
          publicId: normalizeMk(docData.publicId || ""),
          clientName: docData.clientName || "-",
          clientPhone: docData.clientPhone || "-",

          serviceId,
          serviceName,

          employeeName: docData.employeeName || "-",
          date: docData.date || "-",
          time: docData.time || "-",

          total: safeNum(docData.finalPrice ?? docData.total),
          status: docData.status || "pending",
        });
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "صار خطأ أثناء تحميل بيانات الحجز");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [bookingId]);

  const copyPublicId = async () => {
    const publicId = String(view?.publicId || "").trim();
    if (!publicId) return showToast("رقم الحجز غير متوفر", "error");
    try {
      await navigator.clipboard.writeText(publicId);
      showToast("تم نسخ رقم الحجز ✅", "success");
    } catch {
      showToast("تعذر النسخ", "error");
    }
  };

  const openWhatsapp = () => {
    const publicId = String(view?.publicId || "").trim();
    if (!publicId) return showToast("رقم الحجز غير متوفر لإرسال الواتساب", "error");

    const msg = buildWhatsappMessage({
      publicId,
      date: String(view?.date || "").trim() || "-",
      time: String(view?.time || "").trim() || "-",
    });

    const url = `https://wa.me/${SALON_WHATSAPP}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return <LoadingBrand text="جاري تحميل البيانات..." />;
  }
  
  if (error) {
    return (
      <div className="success-page">
        <div className="success-card">
          <div className="success-alert">
            <FontAwesomeIcon icon={faCircleInfo} />
            <span>{error}</span>
          </div>

          <div className="success-actions">
            <button className="success-btn success-home" onClick={() => navigate("/booking")} type="button">
              <FontAwesomeIcon icon={faArrowRight} /> رجوع للحجز
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!view) return null;

  const st = normStatus(view.status);
  const isConfirmed = st === "confirmed" || view.status === "مؤكد";
  const heroTitle = isConfirmed ? "تم تأكيد حجزك بنجاح! 🎉" : "تم استلام طلب حجزك بنجاح! ✨";
  const heroDesc = isConfirmed
    ? "تم تأكيد الموعد. إذا احتجتِ تعديل، تواصلي معنا عبر الواتساب."
    : "تم استلام طلب حجزك، وسيتم التواصل معك قريبًا لتأكيد الموعد.";

  const displayPublicId = String(view.publicId || "").trim() || "—";
  const canTrack = displayPublicId !== "—";

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-topline" />

        <div className="success-header">
          <div className="success-icon" aria-hidden="true">
          <span className="success-check">✓</span>
          </div>

          <h1 className="success-title">{heroTitle}</h1>
          <p className="success-subtitle">{heroDesc}</p>

          <div className="success-badge">
            <span>رقم الحجز</span>
            <span className="mono">{displayPublicId}</span>
          </div>

          <p className="success-sourcehint">احتفظي بالرقم للتتبع أو انسخيه بضغطة واحدة</p>
        </div>

        <div className="success-details">
          <div className="detail-row">
            <FontAwesomeIcon icon={faUser} className="detail-ico" />
            <span className="detail-label">العميلة</span>
            <span className="detail-value">{view.clientName}</span>
          </div>

          <div className="detail-row">
            <FontAwesomeIcon icon={faPhone} className="detail-ico" />
            <span className="detail-label">الجوال</span>
            <span className="detail-value">{view.clientPhone}</span>
          </div>

          <div className="detail-row">
            <FontAwesomeIcon icon={faScissors} className="detail-ico" />
            <span className="detail-label">الخدمة</span>
            <span className="detail-value">{view.serviceName}</span>
          </div>

          <div className="detail-row">
            <FontAwesomeIcon icon={faUserTie} className="detail-ico" />
            <span className="detail-label">الموظفة</span>
            <span className="detail-value">{view.employeeName}</span>
          </div>

          <div className="detail-row">
            <FontAwesomeIcon icon={faCalendarAlt} className="detail-ico" />
            <span className="detail-label">التاريخ</span>
            <span className="detail-value">{view.date}</span>
          </div>

          <div className="detail-row">
            <FontAwesomeIcon icon={faClock} className="detail-ico" />
            <span className="detail-label">الوقت</span>
            <span className="detail-value">{view.time}</span>
          </div>

          <div className="detail-row detail-row--full">
            <span className={`status-pill ${statusClass(view.status)}`}>{statusLabel(view.status)}</span>
          </div>

          <div className="total-row">
            <FontAwesomeIcon icon={faMoneyBill} />
            <span>{view.total ? `${view.total.toLocaleString()} ريال` : "—"}</span>
          </div>
        </div>

        <button type="button" className="success-copy-btn" onClick={copyPublicId}>
          <FontAwesomeIcon icon={faCopy} /> نسخ رقم الحجز (MK)
        </button>

        <button type="button" className="success-copy-btn" onClick={openWhatsapp}>
          <FontAwesomeIcon icon={faWhatsapp} /> تأكيد عبر واتساب
        </button>

        <div className="success-actions">
          <button
            className="success-btn success-primary"
            onClick={() => navigate(`/track/${encodeURIComponent(displayPublicId)}`)}
            type="button"
            disabled={!canTrack}
            title={canTrack ? "تتبع الحجز" : "رقم التتبع غير متوفر"}
          >
            تتبع الحجز
          </button>

          <button className="success-btn success-home" onClick={() => navigate("/")} type="button">
            الرئيسية
          </button>

          <button className="success-btn success-booking" onClick={() => navigate("/booking")} type="button">
            حجز جديد
          </button>
        </div>

        {toastMsg && <div className={`success-toast ${toastType}`}>{toastMsg}</div>}
      </div>
    </div>
  );
}

