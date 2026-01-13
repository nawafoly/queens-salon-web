// src/pages/Success.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
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

import "../styles/Success.css";

// Firestore
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { getBookingById } from "../services/firestoreBookings";

/* =========================
   Types & Const
========================= */

type UiBookingView = {
  id: string;
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

/* =========================
   Helpers
========================= */

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function resolveServiceName(serviceId: string): Promise<string> {
  if (!serviceId || serviceId.length < 10) return serviceId;

  try {
    const ref = doc(db, "salons", SALON_ID, "services", serviceId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return "—";
    return snap.data()?.name || "—";
  } catch {
    return "—";
  }
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

// ✅ رقم حجز مختصر للعرض (مع الاحتفاظ بالـ id الحقيقي للنسخ)
function shortBookingCode(id: string) {
  const s = String(id || "").trim();
  if (!s) return "—";
  // مثال: #QNS-AB12CD
  const tail = s.slice(-6).toUpperCase();
  return `#QNS-${tail}`;
}

export default function Success() {
  const navigate = useNavigate();

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

        if (!bookingId) {
          setError("رقم الحجز غير موجود");
          return;
        }

        const docData = await getBookingById(bookingId);
        if (!docData) {
          setError("لم يتم العثور على الحجز");
          return;
        }

        const serviceName = await resolveServiceName(docData.serviceName);

        if (!mounted) return;

        setView({
          id: docData.id,
          clientName: docData.clientName || "-",
          clientPhone: docData.clientPhone || "-",
          serviceId: docData.serviceName,
          serviceName,
          employeeName: docData.employeeName || "-",
          date: docData.date || "-",
          time: docData.time || "-",
          total: safeNum(docData.finalPrice ?? docData.total),
          status: docData.status || "pending",
        });
      } catch (e) {
        console.error(e);
        setError("صار خطأ أثناء تحميل بيانات الحجز");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [bookingId]);

  const copyBookingId = async () => {
    if (!view?.id) return;
    try {
      await navigator.clipboard.writeText(view.id);
      showToast("تم نسخ رقم الحجز ✅", "success");
    } catch {
      showToast("تعذر النسخ", "error");
    }
  };

  /* =========================
     UI States
  ========================= */

  if (loading) {
    return (
      <div className="success-page">
        <div className="success-card">
          <p className="success-loading">جاري تجهيز تفاصيل الحجز...</p>
        </div>
      </div>
    );
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
            <button className="btn btn-primary" onClick={() => navigate("/booking")} type="button">
              <FontAwesomeIcon icon={faArrowRight} /> رجوع للحجز
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!view) return null;

  // ✅ عنوان/وصف ديناميكي حسب الحالة
  const st = normStatus(view.status);
  const isConfirmed = st === "confirmed" || view.status === "مؤكد";
  const heroTitle = isConfirmed ? "تم تأكيد حجزك بنجاح!" : "تم استلام طلب حجزك بنجاح!";
  const heroDesc = isConfirmed
    ? "تم تأكيد الموعد. إذا احتجت تعديل، تواصل معنا."
    : "تم استلام طلب حجزك، وسيتم التواصل معك قريبًا لتأكيد الموعد.";

  const displayCode = shortBookingCode(view.id);

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-topline" />

        <div className="success-header">
          <div className="success-icon">
            <FontAwesomeIcon icon={faCheckCircle} />
          </div>

          <h1 className="success-title">{heroTitle}</h1>
          <p className="success-subtitle">{heroDesc}</p>

          <div className="success-badge">
            <span>رقم الحجز</span>
            <span className="mono">{displayCode}</span>
          </div>

          <div className="success-sourcehint">
            (للنسخ والمراجعة: رقم الحجز الكامل موجود بالأسفل)
          </div>
        </div>

        <div className="success-details">
          <div className="detail-row detail-row--id">
            <span className="detail-label">رقم الحجز الكامل</span>
            <span className="detail-value mono">{view.id}</span>
          </div>

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
            <span className={`status-pill ${statusClass(view.status)}`}>
              {statusLabel(view.status)}
            </span>
          </div>

          <div className="total-row">
            <FontAwesomeIcon icon={faMoneyBill} />
            <span>{view.total ? `${view.total.toLocaleString()} ريال` : "—"}</span>
          </div>
        </div>

        <button type="button" className="success-copy-btn" onClick={copyBookingId}>
          <FontAwesomeIcon icon={faCopy} /> نسخ رقم الحجز
        </button>

        <div className="success-actions">
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
