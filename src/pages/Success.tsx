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

// ✅ Firestore
import {
  getBookingById,
  type BookingDocWithId,
} from "../services/firestoreBookings";

type UiBookingView = {
  id: string;

  clientName: string;
  clientPhone: string;

  serviceName: string;
  employeeName: string;

  date: string;
  time: string;

  total: number;
  status: string;

  source: "firestore" | "local";
};

const BOOKING_KEY = "currentBooking";

function statusLabel(s: string) {
  const v = String(s || "").toLowerCase().trim();
  if (v === "confirmed" || s === "مؤكد") return "مؤكد";
  if (v === "pending" || s === "بانتظار" || s === "بالانتظار") return "بالانتظار";
  if (v === "completed" || s === "مكتمل") return "مكتمل";
  if (v === "cancelled" || s === "ملغي") return "ملغي";
  return s || "-";
}

// ✅ مهم: تثبيت كلاس الحالة مهما كانت قيمة status (إنجليزي/عربي)
function statusClass(s: string) {
  const v = String(s || "").toLowerCase().trim();
  if (v === "confirmed" || s === "مؤكد") return "confirmed";
  if (v === "pending" || s === "بانتظار" || s === "بالانتظار") return "pending";
  if (v === "completed" || s === "مكتمل") return "completed";
  if (v === "cancelled" || s === "ملغي") return "cancelled";
  return "default";
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadLocalBooking(): UiBookingView | null {
  try {
    const raw = localStorage.getItem(BOOKING_KEY);
    if (!raw) return null;

    const b = JSON.parse(raw);
    const id = String(b?.id || b?.bookingId || "").trim();

    return {
      id: id || "-",
      clientName: String(b?.name || b?.clientName || "-"),
      clientPhone: String(b?.phone || b?.clientPhone || "-"),
      serviceName: String(b?.serviceName || b?.service || "-"),
      employeeName: String(b?.employeeName || b?.employee || "-"),
      date: String(b?.date || "-"),
      time: String(b?.time || "-"),
      total: safeNum(b?.finalPrice ?? b?.total ?? 0),
      status: String(b?.status || "pending"),
      source: "local",
    };
  } catch {
    return null;
  }
}

export default function Success() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<BookingDocWithId | null>(null);
  const [error, setError] = useState<string>("");
  const [localView, setLocalView] = useState<UiBookingView | null>(null);

  // ✅ Toast بدل alert (قابل للتنسيق)
  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToastMsg(msg);
    setToastType(type);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToastMsg(""), 1600);
  };

  const firestoreId = useMemo(() => {
    try {
      const raw = localStorage.getItem(BOOKING_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(parsed?.id || "").trim();
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

        const lv = loadLocalBooking();
        if (mounted) setLocalView(lv);

        if (!firestoreId) {
          setDoc(null);
          setError("");
          return;
        }

        const res = await getBookingById(firestoreId);
        if (!mounted) return;

        if (!res) {
          setDoc(null);
          setError("");
          return;
        }

        setDoc(res);
        setError("");
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;

        setDoc(null);

        const lv = loadLocalBooking();
        setLocalView(lv);

        if (!lv) {
          setError("صار خطأ أثناء جلب بيانات الحجز. جرّب مرة ثانية.");
        } else {
          setError("");
        }
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [firestoreId]);

  const view: UiBookingView | null = useMemo(() => {
    if (doc) {
      return {
        id: doc.id,
        clientName: doc.clientName || "-",
        clientPhone: doc.clientPhone || "-",
        serviceName: doc.serviceName || "-",
        employeeName: doc.employeeName || "-",
        date: doc.date || "-",
        time: doc.time || "-",
        total: safeNum(doc.finalPrice ?? doc.total ?? 0),
        status: doc.status || "pending",
        source: "firestore",
      };
    }
    return localView;
  }, [doc, localView]);

  const copyBookingId = async () => {
    const id = view?.id?.trim();
    if (!id || id === "-") return;

    try {
      await navigator.clipboard.writeText(id);
      showToast("تم نسخ رقم الحجز ✅", "success");
    } catch {
      // fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = id;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        showToast("تم نسخ رقم الحجز ✅", "success");
      } catch {
        showToast("تعذر النسخ، انسخ الرقم يدويًا", "error");
      }
    }
  };

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-icon">
          <FontAwesomeIcon icon={faCheckCircle} />
        </div>

        <h1 className="success-title">تم تأكيد حجزك بنجاح!</h1>

        {loading ? (
          <p className="success-subtitle">جاري تجهيز تفاصيل الحجز...</p>
        ) : error ? (
          <>
            <div className="success-alert">
              <FontAwesomeIcon icon={faCircleInfo} />
              <span>{error}</span>
            </div>

            <div className="success-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate("/booking")}
                type="button"
              >
                <FontAwesomeIcon icon={faArrowRight} /> رجوع للحجز
              </button>
            </div>
          </>
        ) : view ? (
          <>
            <p className="success-subtitle">
              تم استلام طلب حجزك، وسيتم التواصل معك قريبًا لتأكيد الموعد.
            </p>

            <div className="success-sourcehint">
              {view.source === "firestore"
                ? "تم جلب البيانات من النظام (Firestore)."
                : "تم عرض البيانات من الجهاز (localStorage) لضمان ظهور التفاصيل حتى لو كانت الصلاحيات مغلقة."}
            </div>

            <div className="success-details">
              {/* ✅ رقم الحجز (بدون زر نسخ هنا) */}
              <div className="detail-row detail-row--id">
                <span className="detail-label">رقم الحجز</span>
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

              {/* ✅ رجعنا التاريخ */}
              <div className="detail-row">
                <FontAwesomeIcon icon={faCalendarAlt} className="detail-ico" />
                <span className="detail-label">التاريخ</span>
                <span className="detail-value">{view.date}</span>
              </div>

              {/* ✅ رجعنا الوقت */}
              <div className="detail-row">
                <FontAwesomeIcon icon={faClock} className="detail-ico" />
                <span className="detail-label">الوقت</span>
                <span className="detail-value">{view.time}</span>
              </div>

              {/* ✅ الحالة (ثابتة اللون) */}
              <div className="detail-row detail-row--full">
                <span className={`status-pill ${statusClass(view.status)}`}>
                  {statusLabel(view.status)}
                </span>
              </div>

              <div className="total-row">
                <FontAwesomeIcon icon={faMoneyBill} />
                <span>
                  {view.total ? `${view.total.toLocaleString()} ريال` : "—"}
                </span>
              </div>
            </div>

            {/* ✅ زر النسخ المستقل لوحده تحت */}
            {view.id && view.id !== "-" && (
              <button
                type="button"
                className="success-copy-btn"
                onClick={copyBookingId}
                title="نسخ رقم الحجز"
              >
                <FontAwesomeIcon icon={faCopy} /> نسخ رقم الحجز
              </button>
            )}

            <div className="success-actions">
              <button
                className="success-btn success-home"
                onClick={() => navigate("/")}
                type="button"
              >
                الرئيسية
              </button>

              <button
                className="success-btn success-booking"
                onClick={() => navigate("/booking")}
                type="button"
              >
                حجز جديد
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="success-alert">
              <FontAwesomeIcon icon={faCircleInfo} />
              <span>ما لقينا تفاصيل كافية لعرضها. ارجع للحجز وسوّي حجز جديد.</span>
            </div>
            <div className="success-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate("/booking")}
                type="button"
              >
                <FontAwesomeIcon icon={faArrowRight} /> رجوع للحجز
              </button>
            </div>
          </>
        )}

        {/* ✅ Toast (بديل alert) */}
        {toastMsg && (
          <div className={`success-toast ${toastType}`}>{toastMsg}</div>
        )}
      </div>
    </div>
  );
}
