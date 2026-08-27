// src/pages/Track.tsx
import { useEffect, useMemo, useState } from "react";
import "../styles/TrackMobile.css";
import { useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { getTrackByPublicId } from "../services/firestoreBookings";

// ✅ Firebase (للإعدادات العامة: واتساب + خريطة)
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";

// ✅ الشعار
import logo from "../assets/images/ssunnamed2.png";

type TrackData = {
  id?: string;
  publicId?: string;
  status?: "pending" | "confirmed" | "cancelled" | "completed" | string;

  sectionLabel?: string;
  categoryLabel?: string;
  serviceName?: string;
  employeeName?: string;
  date?: string;
  time?: string;

  updatedAt?: any;
};

type PublicSettings = {
  phone?: string;
  whatsapp?: string;
  locationText?: string;
  mapEmbedUrl?: string; // رابط embed كامل أو pb فقط
};

const SALON_ID = "main";

function statusLabel(s?: string) {
  const v = String(s || "").toLowerCase().trim();
  if (v === "pending") return "قيد المراجعة";
  if (v === "confirmed") return "مؤكد";
  if (v === "cancelled") return "ملغي";
  if (v === "completed") return "مكتمل";
  return s || "غير معروف";
}

function statusClass(s?: string) {
  const v = String(s || "").toLowerCase().trim();
  if (v === "confirmed") return "is-confirmed";
  if (v === "pending") return "is-pending";
  if (v === "cancelled") return "is-cancelled";
  if (v === "completed") return "is-completed";
  return "is-unknown";
}

function normalizeMk(raw: string) {
  const s = String(raw || "").trim().toUpperCase();
  const m = s.match(/\d+/);
  const digits = m?.[0] ?? "";
  if (!digits) return "";
  return `MK-${digits}`;
}

function formatTime12ForClient(time24: string) {
  const m = String(time24 || "")
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "-");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

// ✅ واتساب: نحول الرقم لصيغة wa.me
function normalizeWhatsAppNumber(input?: string) {
  const raw = String(input || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("05")) return "966" + raw.slice(1);
  if (raw.startsWith("5")) return "966" + raw;
  return raw; // لو أصلاً 966...
}

// ✅ خريطة: نفس Normalize المستخدم في Contact (يدعم embed كامل أو pb فقط)
function normalizeMapEmbedUrl(input?: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("pb=")) return `https://www.google.com/maps/embed?${raw}`;
  if (raw.startsWith("!1m")) return `https://www.google.com/maps/embed?pb=${raw}`;

  return raw;
}

const Track = () => {
  const { trackId } = useParams();
  const navigate = useNavigate();

  const [inputId, setInputId] = useState(trackId || "");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState("");

  // ✅ public settings
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);

  const normalizedParam = useMemo(() => normalizeMk(trackId || ""), [trackId]);

  // ✅ اسحب إعدادات التواصل (واتساب + خريطة) Live
  useEffect(() => {
    const ref = doc(db, "salons", SALON_ID, "settings", "public");
    const unsub = onSnapshot(
      ref,
      (snap) => setPublicSettings(snap.exists() ? (snap.data() as PublicSettings) : null),
      () => setPublicSettings(null)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!trackId) return;
    const raw = String(trackId).trim();
    const norm = normalizeMk(raw);
    if (!norm) return;
    if (raw.toUpperCase() === norm) return;
    navigate(`/track/${encodeURIComponent(norm)}`, { replace: true });
  }, [trackId, navigate]);

  useEffect(() => {
    if (!trackId) return;
    const norm = normalizeMk(trackId);
    setInputId(norm || trackId);
  }, [trackId]);

  useEffect(() => {
    if (!normalizedParam) return;

    let alive = true;
    setLoading(true);
    setNotFound(false);
    setError("");
    setData(null);

    (async () => {
      try {
        const res: any = await getTrackByPublicId(normalizedParam);
        if (!alive) return;

        if (!res) {
          setNotFound(true);
        } else {
          let sectionLabel =
            res.serviceSnapshot?.sectionTitleAtBooking ||
            res.serviceSnapshot?.sectionIdAtBooking ||
            res.sectionTitleAtBooking ||
            res.sectionIdAtBooking ||
            res.sectionTitle ||
            res.sectionId ||
            "-";

          let categoryLabel =
            res.serviceSnapshot?.categoryNameAtBooking ||
            res.serviceSnapshot?.categoryIdAtBooking ||
            res.categoryNameAtBooking ||
            res.categoryIdAtBooking ||
            res.categoryName ||
            res.categoryId ||
            "-";



          setData({
            id: res.id,
            publicId: res.publicId,
            status: res.status,
            sectionLabel,
            categoryLabel,
            serviceName: res.serviceSnapshot?.serviceNameAtBooking || res.serviceName || "-",
            employeeName: res.employeeName || "-",
            date: res.date || "-",
            time: res.time || "-",
            updatedAt: res.updatedAt,
          });
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "حدث خطأ أثناء جلب بيانات التتبع");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [normalizedParam]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeMk(inputId);
    if (!norm) return;
    navigate(`/track/${encodeURIComponent(norm)}`);
  };

  const showContact = !loading && (notFound || data?.status === "pending" || data?.status === "cancelled");

  // ✅ روابط التواصل
  const waNumber = normalizeWhatsAppNumber(publicSettings?.whatsapp || publicSettings?.phone);
  const waHref = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(
        `استفسار بخصوص حجز (رقم التتبع): ${normalizeMk(inputId) || inputId}`
      )}`
    : "";

  const mapEmbedUrl = normalizeMapEmbedUrl(publicSettings?.mapEmbedUrl);
  const hasMap = !!mapEmbedUrl && mapEmbedUrl.includes("google.com/maps/embed");

  return (
    <div className="track-page success-page" dir="rtl">
      <div className="track-card success-card">
        <div className="success-topline" />
        <div className="track-head success-header">
          <div className="track-logo">
            <img src={logo} alt="MALIKAT SALON Logo" />
          </div>

          <h2 className="track-title success-title">تتبع الحجز</h2>
          <p className="track-subtitle success-subtitle">
            أدخل رقم الحجز (MK-xxxxx) أو اكتب الرقم فقط وسنحوّله تلقائيًا
          </p>
        </div>

        <div className="track-body">
          <div className="track-panel success-details">
            {/* ✅ الزر يمين + الإنبت يسار: نحط الزر أول عنصر */}
            <form className="track-form" onSubmit={onSubmit}>
              <button className="track-btn success-btn success-primary" type="submit" disabled={loading}>
                {loading ? "..." : "تتبع"}
              </button>

              <input
                className="track-input"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                placeholder="مثال: MK-10007 أو 10007"
                autoComplete="off"
                dir="ltr"
              />
            </form>

            {loading && (
              <div className="track-skeleton">
                <div className="skel" />
                <div className="skel" />
                <div className="skel" />
              </div>
            )}

            {!loading && error && <div className="track-error success-alert">⚠️ {error}</div>}

            {!loading && notFound && (
              <div className="track-notfound success-alert">❌ رقم التتبع غير موجود. تأكد من الرقم وحاول مرة أخرى.</div>
            )}

            {/* ✅ استفسار: واتساب + خريطة */}
            {showContact && (
              <div className="track-contact-wrap" style={{ gap: 10, flexWrap: "wrap" }}>
                {waHref ? (
                  <a href={waHref} target="_blank" rel="noreferrer" className="track-btn-ghost is-whatsapp">
                    <FontAwesomeIcon icon={faWhatsapp} />
                    واتساب للاستفسار
                  </a>
                ) : (
                  <a href="/contact" className="track-btn-ghost">
                    تواصل معنا للاستفسار
                  </a>
                )}
                <div className="track-contact-map">
                  {hasMap ? (
                    <iframe
                      src={mapEmbedUrl}
                      width="100%"
                      height="340"
                      style={{
                        border: 0,
                        borderRadius: "18px",
                        boxShadow: "0 20px 50px rgba(0,0,0,0.1)",
                      }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title="MALIKAT SALON Location"
                    />
                  ) : (
                    <div className="track-map-fallback">
                      لم يتم إضافة رابط الخريطة بعد من لوحة التحكم.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="track-side success-policy">
            {!loading && data ? (
              <div className="track-result">
                <div className={`track-status ${statusClass(data.status)}`}>
                  <span>الحالة</span>
                  <strong className={`status-pill ${String(data.status || "").toLowerCase().trim()}`}>
                    {statusLabel(data.status)}
                  </strong>
                </div>

                <div className="track-grid">
                  <div className="track-row">
                    <span>القسم</span>
                    <strong>{data.sectionLabel || "-"}</strong>
                  </div>
                  <div className="track-row">
                    <span>التصنيف</span>
                    <strong>{data.categoryLabel || "-"}</strong>
                  </div>
                  <div className="track-row">
                    <span>الخدمة</span>
                    <strong>{data.serviceName || "-"}</strong>
                  </div>
                  <div className="track-row">
                    <span>الموظفة</span>
                    <strong>{data.employeeName || "-"}</strong>
                  </div>
                  <div className="track-row">
                    <span>التاريخ</span>
                    <strong>{data.date || "-"}</strong>
                  </div>
                  <div className="track-row">
                    <span>الوقت</span>
                    <strong>{formatTime12ForClient(data.time || "-")}</strong>
                  </div>
                </div>

                <div className="track-hint">
                  ℹ️ في حال تأخر تأكيد الحجز أو وجود أي استفسار، يسعدنا تواصلك معنا مباشرة.
                </div>
              </div>
            ) : (
              <div className="track-state success-alert">أدخل رقم الحجز (MK) وستظهر تفاصيل الحجز هنا.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Track;
