// src/pages/Track.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../styles/Track.css";
import { getTrackById } from "../services/firestoreBookings";

type TrackData = {
  status?: "pending" | "confirmed" | "cancelled" | "completed" | string;
  serviceName?: string;
  employeeName?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  updatedAt?: any;
};

function statusLabel(s?: string) {
  if (s === "pending") return "قيد المراجعة";
  if (s === "confirmed") return "مؤكد";
  if (s === "cancelled") return "ملغي";
  if (s === "completed") return "مكتمل";
  return s || "غير معروف";
}

function statusClass(s?: string) {
  if (s === "confirmed") return "is-confirmed";
  if (s === "pending") return "is-pending";
  if (s === "cancelled") return "is-cancelled";
  if (s === "completed") return "is-completed";
  return "is-unknown";
}

const Track: React.FC = () => {
  const { trackId } = useParams();
  const navigate = useNavigate();

  const [inputId, setInputId] = useState(trackId || "");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string>("");

  const effectiveId = useMemo(() => (trackId || "").trim(), [trackId]);

  useEffect(() => {
    if (!effectiveId) return;

    let alive = true;
    setLoading(true);
    setNotFound(false);
    setError("");
    setData(null);

    (async () => {
      try {
        // ✅ الصحيح: القراءة من booking_tracks عبر service (قراءة عامة)
        const res = await getTrackById(effectiveId);

        if (!alive) return;

        if (!res) {
          setNotFound(true);
          setData(null);
        } else {
          // res يرجع كائن مناسب
          setData({
            status: res.status,
            serviceName: res.serviceName,
            employeeName: res.employeeName,
            date: res.date,
            time: res.time,
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
  }, [effectiveId]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = inputId.trim();
    if (!v) return;
    navigate(`/track/${encodeURIComponent(v)}`);
  };

  return (
    <div className="track-page">
      <div className="track-card">
        <div className="track-head">
          <div className="track-badge">📌</div>
          <h2 className="track-title">تتبع الحجز</h2>
          <p className="track-subtitle">أدخل رقم التتبع لمشاهدة حالة الحجز</p>
        </div>

        <form className="track-form" onSubmit={onSubmit}>
          <input
            className="track-input"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="مثال: RQH9CkGj2X0WwWsuAp7O"
          />
          <button className="track-btn" type="submit" disabled={loading}>
            {loading ? "..." : "تتبع"}
          </button>
        </form>

        {loading && <div className="track-state">جاري التحميل...</div>}

        {!loading && error && <div className="track-error">⚠️ {error}</div>}

        {!loading && notFound && (
          <div className="track-notfound">
            ❌ رقم التتبع غير موجود. تأكد من الرقم وحاول مرة أخرى.
          </div>
        )}

        {!loading && data && (
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
              ℹ️ هذه صفحة تتبع عامة تعرض معلومات الحجز الأساسية فقط.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Track;
