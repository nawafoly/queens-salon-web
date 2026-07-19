import React, { useEffect, useMemo, useRef, useState } from "react";
import { resolveBookingDataSource } from "../services/bookingDataSource";
import type { BookingDocWithId } from "../services/firestoreBookings";
import defaultLogo from "../assets/images/ssunnamed.png";

const SHOW_AFTER_TURN_MS = 20 * 60 * 1000;
const MAX_PROMO_VIDEOS = 12;
const QUEUE_REFRESH_MS = 8_000;

const copy = {
  dash: "\u2014",
  am: "\u0635",
  pm: "\u0645",
  loading: "\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u062d\u062c\u0648\u0632\u0627\u062a \u0627\u0644\u064a\u0648\u0645...",
  loadError:
    "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u062d\u062c\u0648\u0632\u0627\u062a \u0627\u0644\u064a\u0648\u0645 \u0645\u0646 \u062e\u062f\u0645\u0629 \u0627\u0644\u062d\u062c\u0632. \u062d\u062f\u062b \u0627\u0644\u0634\u0627\u0634\u0629 \u0623\u0648 \u062a\u0623\u0643\u062f \u0645\u0646 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644.",
  videoError:
    "\u062a\u0639\u0630\u0631 \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0641\u064a\u062f\u064a\u0648. \u062a\u0623\u0643\u062f \u0645\u0646 \u0635\u064a\u063a\u0629 MP4 (H.264 + AAC).",
  empty:
    "\u0644\u0627 \u062a\u0648\u062c\u062f \u062d\u062c\u0648\u0632\u0627\u062a \u0641\u0639\u0627\u0644\u0629 \u0644\u0639\u0631\u0636\u0647\u0627 \u0627\u0644\u0622\u0646.",
  booking: "\u062d\u062c\u0632",
  current: "\u0627\u0644\u062d\u0627\u0644\u064a",
  upcoming: "\u0642\u0627\u062f\u0645",
  client: "\u0627\u0644\u0639\u0645\u064a\u0644\u0629",
  employee: "\u0627\u0644\u0645\u0648\u0638\u0641\u0629",
  time: "\u0627\u0644\u0648\u0642\u062a",
  endsAfter: "\u064a\u0646\u062a\u0647\u064a \u0628\u0639\u062f",
  remaining: "\u0628\u0627\u0642\u064a",
};

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
  const m = String(time24 || "")
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toDateTimeMs(dateISO: string, time24: string): number {
  const dm = String(dateISO || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = String(time24 || "")
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
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

const decoderByteMaps = new Map<string, Map<string, number>>();

function byteMapForEncoding(encoding: string): Map<string, number> | null {
  try {
    const cached = decoderByteMaps.get(encoding);
    if (cached) return cached;

    const decoder = new TextDecoder(encoding);
    const map = new Map<string, number>();
    for (let byte = 0; byte <= 255; byte += 1) {
      const char = decoder.decode(new Uint8Array([byte]));
      if (char && char !== "\ufffd" && !map.has(char)) {
        map.set(char, byte);
      }
    }
    decoderByteMaps.set(encoding, map);
    return map;
  } catch {
    return null;
  }
}

function decodeMojibakeCandidate(value: string, sourceEncoding: string): string {
  const map = byteMapForEncoding(sourceEncoding);
  if (!map) return "";

  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) || 0;
    const byte = code <= 0x7f ? code : map.get(char);
    if (byte === undefined) return "";
    bytes.push(byte);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}

function textDisplayScore(value: string): number {
  const arabic = (value.match(/[\u0600-\u06ff]/g) || []).length;
  const brokenLatin = (value.match(/[\u00d8\u00d9\u00c3\u00c2\u00e2\ufffd]/g) || []).length;
  const brokenArabicPairs = (value.match(/[\u0637\u0638][^\s]/g) || []).length;
  return arabic * 2 - brokenLatin * 6 - brokenArabicPairs * 3;
}

function repairDisplayText(value: unknown, fallback = copy.dash): string {
  const text = String(value ?? "").trim();
  if (!text) return fallback;

  const candidates = [
    text,
    decodeMojibakeCandidate(text, "windows-1256"),
    decodeMojibakeCandidate(text, "windows-1252"),
  ].filter(Boolean);

  return candidates.reduce((best, candidate) =>
    textDisplayScore(candidate) > textDisplayScore(best) ? candidate : best
  );
}

function queueBookingFromDoc(row: BookingDocWithId, fallbackDate: string): QueueBooking {
  const raw = row as BookingDocWithId & {
    customerName?: unknown;
    name?: unknown;
    staffName?: unknown;
    trackPublicId?: unknown;
    mk?: unknown;
  };

  return {
    id: String(row.id),
    publicId: String(raw.publicId || raw.trackPublicId || raw.mk || row.id || ""),
    clientName: repairDisplayText(raw.clientName || raw.customerName || raw.name),
    employeeName: repairDisplayText(raw.employeeName || raw.staffName),
    date: String(raw.date || fallbackDate),
    time: String(raw.time || raw.startTime || ""),
    status: String(raw.status || "").toLowerCase().trim(),
  };
}

function bookingNoOf(raw: string): string {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return copy.dash;
  if (/^MK-\d+$/.test(v)) return v;
  if (/^\d+$/.test(v)) return `MK-${v}`;
  return v;
}

function formatTime12(time24: string): string {
  const m = String(time24 || "")
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || copy.dash);
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? copy.pm : copy.am}`;
}

function countdownLabel(targetMs: number, nowMs: number): string {
  const diff = Math.max(0, targetMs - nowMs);
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
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
    // Ignore and fall back to GET.
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
    void loadPromoPlaylist();
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
    let active = true;
    let firstLoad = true;
    let inFlight = false;

    const loadBookings = async () => {
      if (inFlight) return;
      inFlight = true;
      if (firstLoad) {
        setLoading(true);
        setError("");
      }
      try {
        const rows = await resolveBookingDataSource().searchBookings({ date: todayKey });
        if (!active) return;
        const next = rows
          .map((row) => queueBookingFromDoc(row, todayKey))
          .filter((b) => !["cancelled", "canceled", "rejected"].includes(b.status))
          .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
        setBookings(next);
        setError("");
      } catch (loadError) {
        if (!active) return;
        console.error("[DashboardQueueTv] Booking load failed", loadError);
        setError(copy.loadError);
      } finally {
        inFlight = false;
        if (!active) return;
        setLoading(false);
        firstLoad = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadBookings();
    };

    void loadBookings();
    const timer = window.setInterval(() => void loadBookings(), QUEUE_REFRESH_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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
          <div className="dashboard-tv-video-fallback">{copy.videoError}</div>
        ) : null}
      </section>

      <section className="dashboard-tv-queue-card">
        {loading ? <div className="dashboard-tv-empty">{copy.loading}</div> : null}
        {!loading && error ? <div className="dashboard-tv-empty">{error}</div> : null}

        {!loading && !error ? (
          <>
            {!todayQueue.length ? (
              <div className="dashboard-tv-empty">{copy.empty}</div>
            ) : (
              <div className="dashboard-tv-booking-list">
                {todayQueue.map((row, idx) => (
                  <article
                    key={row.id}
                    className={`dashboard-tv-booking-card ${
                      row.state === "current" ? "is-current" : "is-upcoming"
                    }`}
                  >
                    <div className="dashboard-tv-booking-head">
                      <h4>
                        {copy.booking} {idx + 1}
                      </h4>
                      <span
                        className={`dashboard-tv-state-chip ${
                          row.state === "current" ? "is-current" : "is-upcoming"
                        }`}
                      >
                        {row.state === "current" ? copy.current : copy.upcoming}
                      </span>
                    </div>
                    <div className="dashboard-tv-booking-main">
                      <div className="dashboard-tv-booking-id">{bookingNoOf(row.publicId)}</div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">{copy.client}</span>
                        <b className="dashboard-tv-kv-value">{row.clientName || "-"}</b>
                      </div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">{copy.employee}</span>
                        <b className="dashboard-tv-kv-value">{row.employeeName || "-"}</b>
                      </div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">{copy.time}</span>
                        <b className="dashboard-tv-kv-value">{formatTime12(row.time)}</b>
                      </div>
                      <div className="dashboard-tv-kv-row">
                        <span className="dashboard-tv-kv-label">
                          {row.state === "current" ? copy.endsAfter : copy.remaining}
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
