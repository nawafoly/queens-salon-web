// src/pages/Track.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../styles/Track.css";
import { getTrackById } from "../services/firestoreBookings";

type TrackData = {
  status?: "pending" | "confirmed" | "cancelled" | "completed" | string;
  serviceName?: string;
  employeeName?: string;
  date?: string;
  time?: string;
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
  const [error, setError] = useState("");

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
        const res = await getTrackById(effectiveId);
        if (!alive) return;

        if (!res) {
          setNotFound(true);
        } else {
          setData({
            status: res.status,
            serviceName: res.serviceName,
            employeeName: res.employeeName,
            date: res.date,
            time: res.time,
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
  }, [effectiveId]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = inputId.trim();
    if (!v) return;
    navigate(`/track/${encodeURIComponent(v)}`);
  };

  const showContact =
    !loading &&
    (notFound ||
      data?.status === "pending" ||
      data?.status === "cancelled");

  return (
    <div className="track-page">
      <div className="track-card">
        <div className="track-head">
          <div className="track-badge">📌</div>
          <h2 className="track-title">تتبع الحجز</h2>
          <p className="track-subtitle">
            أدخل رقم الحجز لمشاهدة حالة الحجز
          </p>
        </div>

        <div className="track-body">
          {/* القسم الأيسر */}
          <div className="track-panel">
            <form className="track-form" onSubmit={onSubmit}>
              <input
                className="track-input"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                placeholder="مثال: RQH9CkGj2X0WwWsuAp7O"
                autoComplete="off"
                dir="ltr"
              />
              <button
                className="track-btn"
                type="submit"
                disabled={loading}
              >
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

            {!loading && error && (
              <div className="track-error">⚠️ {error}</div>
            )}

            {!loading && notFound && (
              <div className="track-notfound">
                ❌ رقم التتبع غير موجود. تأكد من الرقم وحاول مرة أخرى.
              </div>
            )}

            {showContact && (
              <a
                href="/contact"
                className="track-btn-ghost"
              >
                تواصل معنا للاستفسار
              </a>

            )}
          </div>

          {/* القسم الأيمن */}
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
                  ℹ️ في حال تأخر تأكيد الحجز أو وجود أي استفسار،
                  يسعدنا تواصلك معنا مباشرة.
                </div>
              </div>
            ) : (
              <div className="track-state">
                أدخل رقم التتبع وستظهر تفاصيل الحجز هنا.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Track;
