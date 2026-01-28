// src/pages/Track.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../styles/Track.css";
import { getTrackByPublicId } from "../services/firestoreBookings";

// ✅ الشعار
import logo from "../assets/images/ssunnamed1.png";

type TrackData = {
  id?: string;
  publicId?: string;
  status?: "pending" | "confirmed" | "cancelled" | "completed" | string;

  serviceName?: string;
  employeeName?: string;
  date?: string;
  time?: string;

  updatedAt?: any;
};

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

const Track = () => {
  const { trackId } = useParams();
  const navigate = useNavigate();

  const [inputId, setInputId] = useState(trackId || "");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState("");

  const normalizedParam = useMemo(() => normalizeMk(trackId || ""), [trackId]);

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
          setData({
            id: res.id,
            publicId: res.publicId,
            status: res.status,
            serviceName:
              res.serviceSnapshot?.serviceNameAtBooking || res.serviceName || "-",
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

  const showContact =
    !loading &&
    (notFound || data?.status === "pending" || data?.status === "cancelled");

  return (
    <div className="track-page">
      <div className="track-card">
        <div className="track-head">
          {/* ✅ الشعار بدل الدبوس */}
          <div className="track-logo">
            <img src={logo} alt="Queens Salon Logo" />
          </div>

          <h2 className="track-title">تتبع الحجز</h2>
          <p className="track-subtitle">
            أدخل رقم الحجز (MK-xxxxx) أو اكتب الرقم فقط وسنحوّله تلقائيًا
          </p>
        </div>

        <div className="track-body">
          <div className="track-panel">
            <form className="track-form" onSubmit={onSubmit}>
              <input
                className="track-input"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                placeholder="مثال: MK-10007 أو 10007"
                autoComplete="off"
                dir="ltr"
              />
              <button className="track-btn" type="submit" disabled={loading}>
                {loading ? "..." : "تتبع"}
              </button>
            </form>

            {loading && (
              <div className="track-skeleton">
                <div className="skel" />
                <div className="skel" />
                <div className="skel" />
              </div>
            )}

            {!loading && error && <div className="track-error">⚠️ {error}</div>}

            {!loading && notFound && (
              <div className="track-notfound">
                ❌ رقم التتبع غير موجود. تأكد من الرقم وحاول مرة أخرى.
              </div>
            )}

            {showContact && (
              <a href="/contact" className="track-btn-ghost">
                تواصل معنا للاستفسار
              </a>
            )}
          </div>

          <div className="track-side">
            {!loading && data ? (
              <div className="track-result">
                <div className={`track-status ${statusClass(data.status)}`}>
                  <span>الحالة</span>
                  <strong>{statusLabel(data.status)}</strong>
                </div>

                <div className="track-grid">
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
                    <strong>{data.time || "-"}</strong>
                  </div>
                </div>

                <div className="track-hint">
                  ℹ️ في حال تأخر تأكيد الحجز أو وجود أي استفسار، يسعدنا تواصلك معنا مباشرة.
                </div>
              </div>
            ) : (
              <div className="track-state">
                أدخل رقم الحجز (MK) وستظهر تفاصيل الحجز هنا.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Track;
