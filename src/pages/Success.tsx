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
  faQrcode,
  faLink,
  faLocationArrow,
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
  if (s === "confirmed") return "مؤكد";
  if (s === "pending") return "بانتظار";
  if (s === "completed") return "مكتمل";
  if (s === "cancelled") return "ملغي";
  return s || "-";
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
        status: doc.status || "-",
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
      alert("تم نسخ رقم الحجز ✅");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      alert("تم نسخ رقم الحجز ✅");
    }
  };

  // ✅ رابط تتبع صحيح: /track/:id
  const trackingUrl = useMemo(() => {
    const id = view?.id?.trim();
    if (!id || id === "-") return "";
    return `${window.location.origin}/track/${encodeURIComponent(id)}`;
  }, [view?.id]);

  const copyTrackingLink = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      alert("تم نسخ رابط تتبع الحجز ✅");
    } catch {
      alert("انسخ الرابط يدويًا: " + trackingUrl);
    }
  };

  const goTrackNow = () => {
    const id = view?.id?.trim();
    if (!id || id === "-") return;
    navigate(`/track/${id}`);
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

            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
              {view.source === "firestore"
                ? "تم جلب البيانات من النظام (Firestore)."
                : "تم عرض البيانات من الجهاز (localStorage) لضمان ظهور التفاصيل حتى لو كانت الصلاحيات مغلقة."}
            </div>

            <div className="success-details">
              <div className="detail-row">
                <span className="detail-label">رقم الحجز</span>
                <span className="detail-value mono">{view.id}</span>

                {view.id && view.id !== "-" && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    style={{ marginInlineStart: "auto" }}
                    onClick={copyBookingId}
                    title="نسخ رقم الحجز"
                  >
                    <FontAwesomeIcon icon={faCopy} /> نسخ
                  </button>
                )}
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

              <div className="detail-row">
                <span className={`status-pill ${view.status}`}>
                  {statusLabel(view.status)}
                </span>
              </div>

              <div className="total-row">
                <FontAwesomeIcon icon={faMoneyBill} />
                <span>
                  {view.total ? `${view.total.toLocaleString()} ريال` : "—"}
                </span>
              </div>

              {trackingUrl && (
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={goTrackNow}
                  >
                    <FontAwesomeIcon icon={faLocationArrow} /> تتبع حجزي الآن
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={copyTrackingLink}
                  >
                    <FontAwesomeIcon icon={faLink} /> نسخ رابط التتبع
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => alert("QR Code نضيفه بعد خطوة بسيطة (مكتبة qrcode.react)")}
                  >
                    <FontAwesomeIcon icon={faQrcode} /> QR Code
                  </button>
                </div>
              )}
            </div>

            <div className="success-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate("/")}
                type="button"
              >
                الرئيسية
              </button>

              <button
                className="btn btn-outline-secondary"
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
      </div>
    </div>
  );
}
