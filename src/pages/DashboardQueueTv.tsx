import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import defaultLogo from "../assets/images/ssunnamed.png";
import "../styles/DashboardQueueTv.css";

const SALON_ID = "main";
const SHOW_AFTER_TURN_MS = 20 * 60 * 1000;
const MAX_PROMO_VIDEOS = 12;

type QueueBooking = {
  id: string;
  publicId: string;
  clientName: string;
  employeeName: string;
  date: string;
  time: string;
  status: string;
};

function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toMinutes(time24: string): number {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toDateTimeMs(dateISO: string, time24: string): number {
  const dm = String(dateISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!dm || !tm) return Number.NaN;
  return new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
    0
  ).getTime();
}

function msToMinSec(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function bookingNoOf(raw: string): string {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return "—";
  if (/^MK-\d+$/.test(v)) return v;
  if (/^\d+$/.test(v)) return `MK-${v}`;
  return v;
}

function formatTime12(time24: string): string {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "—");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

function countdownLabel(targetMs: number, nowMs: number): string {
  const diff = Math.max(0, targetMs - nowMs);
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildPromoCandidates(): string[] {
  const out: string[] = [];
  out.push("/tv-promo.mp4");
  for (let i = 1; i <= MAX_PROMO_VIDEOS; i += 1) {
    out.push(`/tv-promo-${i}.mp4`);
  }
  return Array.from(new Set(out));
}

async function checkFileExists(path: string): Promise<boolean> {
  try {
    const head = await fetch(path, { method: "HEAD", cache: "no-store" });
    if (head.ok) return true;
  } catch {
    // ignore and fallback to GET
  }
  try {
    const res = await fetch(path, { method: "GET", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export default function DashboardQueueTv() {
  const [todayKey, setTodayKey] = useState<string>(() => todayISO());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [bookings, setBookings] = useState<QueueBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logoSrc, setLogoSrc] = useState(defaultLogo);
  const [videoPlaylist, setVideoPlaylist] = useState<string[]>(["/tv-promo.mp4"]);
  const [videoIndex, setVideoIndex] = useState(0);
  const [videoErrorStreak, setVideoErrorStreak] = useState(0);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc = videoPlaylist[videoIndex] || videoPlaylist[0];

  useEffect(() => {
    let cancelled = false;
    const loadPromoPlaylist = async () => {
      const candidates = buildPromoCandidates();
      const checks = await Promise.all(candidates.map((p) => checkFileExists(p)));
      if (cancelled) return;
      const found = candidates.filter((_, i) => checks[i]);
      setVideoPlaylist(found.length ? found : ["/tv-promo.mp4"]);
      setVideoIndex(0);
      setVideoErrorStreak(0);
      setVideoUnavailable(false);
    };
    loadPromoPlaylist();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const ensurePlaying = () => {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") ensurePlaying();
    };
    ensurePlaying();
    el.addEventListener("ended", ensurePlaying);
    el.addEventListener("canplay", ensurePlaying);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      el.removeEventListener("ended", ensurePlaying);
      el.removeEventListener("canplay", ensurePlaying);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [videoSrc]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setNowMs(now.getTime());
      const nextDay = todayISO(now);
      setTodayKey((prev) => (prev === nextDay ? prev : nextDay));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    const col = collection(db, "salons", SALON_ID, "bookings");
    const q = query(col, where("date", "==", todayKey));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: QueueBooking[] = snap.docs
          .map((d) => {
            const x = d.data() as any;
            return {
              id: String(d.id),
              publicId: String(x?.publicId || x?.trackPublicId || x?.mk || d.id || ""),
              clientName: String(x?.clientName || x?.name || "—"),
              employeeName: String(x?.employeeName || "—"),
              date: String(x?.date || todayKey),
              time: String(x?.time || ""),
              status: String(x?.status || "").toLowerCase().trim(),
            };
          })
          .filter((b) => !["cancelled", "canceled", "rejected"].includes(b.status))
          .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
        setBookings(rows);
        setLoading(false);
      },
      () => {
        setError("تعذر تحميل حجوزات اليوم مباشرة. تأكد من صلاحيات القراءة.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [todayKey]);

  const todayQueue = useMemo(() => {
    const rows = bookings
      .map((b) => {
        const startMs = toDateTimeMs(b.date, b.time);
        if (!Number.isFinite(startMs)) return null;
        const isExpired = nowMs > startMs + SHOW_AFTER_TURN_MS;
        if (isExpired) return null;
        const isCurrent = nowMs >= startMs;
        return {
          ...b,
          startMs,
          state: (isCurrent ? "current" : "upcoming") as "current" | "upcoming",
        };
      })
      .filter(Boolean) as Array<
      QueueBooking & {
        startMs: number;
        state: "current" | "upcoming";
      }
    >;

    rows.sort((a, b) => {
      const aRank = a.state === "current" ? 0 : 1;
      const bRank = b.state === "current" ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return a.startMs - b.startMs;
    });
    return rows;
  }, [bookings, nowMs]);

  return (
    <div className="dashboard-tv-page">
      <section className="dashboard-tv-video-card">
        <img
          src={logoSrc}
          alt="Malikat Salon"
          className="dashboard-tv-video-logo"
          onError={() => setLogoSrc(defaultLogo)}
        />
        <video
          key={videoSrc}
          ref={videoRef}
          className="dashboard-tv-video"
          src={videoSrc}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onCanPlay={() => {
            setVideoErrorStreak(0);
            setVideoUnavailable(false);
          }}
          onEnded={() => {
            setVideoIndex((prev) => (prev + 1) % Math.max(1, videoPlaylist.length));
          }}
          onError={() => {
            setVideoErrorStreak((prev) => {
              const next = prev + 1;
              if (next >= Math.max(1, videoPlaylist.length)) {
                setVideoUnavailable(true);
              }
              return next;
            });
            setVideoIndex((prev) => (prev + 1) % Math.max(1, videoPlaylist.length));
          }}
        />
        {videoUnavailable ? (
          <div className="dashboard-tv-video-fallback">تعذر تشغيل الفيديو. تأكد من صيغة MP4 (H.264 + AAC).</div>
        ) : null}
      </section>

      <section className="dashboard-tv-queue-card">
        {loading ? <div className="dashboard-tv-empty">جاري تحميل حجوزات اليوم...</div> : null}
        {!loading && error ? <div className="dashboard-tv-empty">{error}</div> : null}

        {!loading && !error ? (
          <>
            {!todayQueue.length ? (
              <div className="dashboard-tv-empty">لا توجد حجوزات فعالة لعرضها الآن.</div>
            ) : (
              <div className="dashboard-tv-booking-list">
                {todayQueue.map((row, idx) => (
                  <article key={row.id} className={`dashboard-tv-booking-card ${row.state === "current" ? "is-current" : "is-upcoming"}`}>
                    <div className="dashboard-tv-booking-head">
                      <h4>حجز {idx + 1}</h4>
                      <span
                        className={`dashboard-tv-state-chip ${
                          row.state === "current" ? "is-current" : "is-upcoming"
                        }`}
                      >
                        {row.state === "current" ? "الحالي" : "قادم"}
                      </span>
                    </div>
                    <div className="dashboard-tv-booking-main">
                      <div className="dashboard-tv-booking-id">{bookingNoOf(row.publicId)}</div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">{"\u0627\u0644\u0639\u0645\u064a\u0644\u0629"}</span>
                        <b className="dashboard-tv-kv-value">{row.clientName || "-"}</b>
                      </div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">{"\u0627\u0644\u0645\u0648\u0638\u0641\u0629"}</span>
                        <b className="dashboard-tv-kv-value">{row.employeeName || "-"}</b>
                      </div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">{"\u0627\u0644\u0648\u0642\u062a"}</span>
                        <b className="dashboard-tv-kv-value">{formatTime12(row.time)}</b>
                      </div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">
                          {row.state === "current"
                            ? "\u064a\u0646\u062a\u0647\u064a \u0628\u0639\u062f"
                            : "\u0628\u0627\u0642\u064a"}
                        </span>
                        <b className="dashboard-tv-kv-value">
                          {row.state === "current"
                            ? msToMinSec(row.startMs + SHOW_AFTER_TURN_MS - nowMs)
                            : countdownLabel(row.startMs, nowMs)}
                        </b>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}


