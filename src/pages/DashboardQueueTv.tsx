import { useEffect, useMemo, useRef, useState } from "react";
import { FiClock, FiList, FiMonitor, FiPlayCircle } from "react-icons/fi";
import {
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { resolveBookingDataSource } from "../services/bookingDataSource";
import type { BookingDocWithId } from "../services/firestoreBookings";
import defaultLogo from "../assets/images/ssunnamed.png";
import "../styles/dashboard-v2/dashboard-v2.css";

const SHOW_AFTER_TURN_MS = 20 * 60 * 1000;
const MAX_PROMO_VIDEOS = 12;
const QUEUE_REFRESH_ACTIVE_MS = 8_000;
const QUEUE_REFRESH_IDLE_MS = 20_000;
const QUEUE_REFRESH_MAX_MS = 60_000;

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
    let refreshTimer: number | null = null;
    let unchangedStreak = 0;
    let failureStreak = 0;
    let lastSignature = "";

    const clearRefreshTimer = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const nextSuccessDelay = () => {
      if (unchangedStreak >= 8) return QUEUE_REFRESH_MAX_MS;
      if (unchangedStreak >= 3) return QUEUE_REFRESH_IDLE_MS;
      return QUEUE_REFRESH_ACTIVE_MS;
    };

    const scheduleNext = (delayMs: number) => {
      clearRefreshTimer();
      if (!active || document.visibilityState === "hidden") return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadBookings("timer");
      }, delayMs);
    };

    const loadBookings = async (source: "initial" | "timer" | "event") => {
      if (!active || inFlight) return;
      if (source === "timer" && document.visibilityState === "hidden") return;
      inFlight = true;
      let failed = false;
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
        const signature = next
          .map((b) => [b.id, b.status, b.date, b.time, b.employeeName, b.clientName].join("~"))
          .join("|");
        unchangedStreak = signature === lastSignature ? Math.min(unchangedStreak + 1, 20) : 0;
        lastSignature = signature;
        failureStreak = 0;
        setBookings(next);
        setError("");
      } catch (loadError) {
        failed = true;
        failureStreak = Math.min(failureStreak + 1, 4);
        if (!active) return;
        console.error("[DashboardQueueTv] Booking load failed", loadError);
        setError(copy.loadError);
      } finally {
        inFlight = false;
        if (!active) return;
        setLoading(false);
        firstLoad = false;
        const delay = failed
          ? Math.min(QUEUE_REFRESH_MAX_MS, 15_000 * (2 ** Math.max(0, failureStreak - 1)))
          : nextSuccessDelay();
        scheduleNext(delay);
      }
    };

    const refreshWhenActive = () => {
      if (!active || inFlight || document.visibilityState === "hidden") return;
      clearRefreshTimer();
      unchangedStreak = 0;
      void loadBookings("event");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshWhenActive();
      } else {
        clearRefreshTimer();
      }
    };

    void loadBookings("initial");
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      clearRefreshTimer();
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", onVisibility);
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

  const currentCount = useMemo(
    () => todayQueue.filter((row) => row.state === "current").length,
    [todayQueue]
  );
  const upcomingCount = todayQueue.length - currentCount;
  const nowDate = new Date(nowMs);
  const nowTime24 = `${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}`;
  const todayLabel = nowDate.toLocaleDateString("ar-SA-u-nu-latn", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const activeVideoNumber = Math.min(videoIndex + 1, Math.max(1, videoPlaylist.length));

  return (
    <main className="dsv2-page tv-queue-v2-page" dir="rtl">
      <section className="dsv2-card tv-queue-v2-hero">
        <div className="tv-queue-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">الشاشة التشغيلية</span>
          <h1 className="dsv2-page-title">شاشة قائمة الانتظار</h1>
          <p className="dsv2-page-subtitle">
            متابعة بث الفيديو الترويجي وحجوزات اليوم الحالية والقادمة من مساحة تشغيلية واحدة.
          </p>
        </div>

        <div className="tv-queue-v2-hero__status" aria-label="حالة الشاشة">
          <div className="tv-queue-v2-clock">
            <span>الوقت الآن</span>
            <strong dir="ltr">{formatTime12(nowTime24)}</strong>
            <small>{todayLabel}</small>
          </div>
          <span className="dsv2-badge dsv2-badge--success">تحديث ذكي تلقائي</span>
        </div>
      </section>

      <section className="tv-queue-v2-metrics" aria-label="ملخص شاشة الانتظار">
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon"><FiList /></span>
          <p className="dsv2-metric-card__label">الحجوزات المعروضة</p>
          <p className="dsv2-metric-card__value">{todayQueue.length}</p>
          <p className="dsv2-metric-card__meta">بعد استبعاد الملغي والمنتهي</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon"><FiClock /></span>
          <p className="dsv2-metric-card__label">الحالي الآن</p>
          <p className="dsv2-metric-card__value">{currentCount}</p>
          <p className="dsv2-metric-card__meta">ضمن نافذة العرض الحالية</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FiMonitor /></span>
          <p className="dsv2-metric-card__label">الحجوزات القادمة</p>
          <p className="dsv2-metric-card__value">{upcomingCount}</p>
          <p className="dsv2-metric-card__meta">مرتبة حسب وقت الموعد</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FiPlayCircle /></span>
          <p className="dsv2-metric-card__label">الفيديوهات المتاحة</p>
          <p className="dsv2-metric-card__value">{videoUnavailable ? 0 : videoPlaylist.length}</p>
          <p className="dsv2-metric-card__meta">قائمة تشغيل تلقائية</p>
        </article>
      </section>

      <section className="tv-queue-v2-workspace">
        <article className="dsv2-card tv-queue-v2-media">
          <header className="tv-queue-v2-panel-head">
            <div className="tv-queue-v2-panel-head__copy">
              <h2>الفيديو الترويجي</h2>
              <p>تشغيل تلقائي متتابع للمواد المتاحة داخل شاشة الصالون.</p>
            </div>
            <div className="tv-queue-v2-panel-meta" aria-label="الفيديو الحالي">
              <span>الفيديو الحالي</span>
              <strong dir="ltr">{activeVideoNumber} / {Math.max(1, videoPlaylist.length)}</strong>
            </div>
          </header>

          <div className="tv-queue-v2-media-body">
            <div className="tv-queue-v2-media-frame">
              <img
                src={logoSrc}
                alt="Malikat Salon"
                className="tv-queue-v2-video-logo"
                onError={() => setLogoSrc(defaultLogo)}
              />
              <video
                key={videoSrc}
                ref={videoRef}
                className="tv-queue-v2-video"
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

              {!videoUnavailable ? (
                <span className="tv-queue-v2-video-status">تشغيل تلقائي</span>
              ) : null}

              {videoUnavailable ? (
                <div className="tv-queue-v2-video-fallback" role="alert">
                  <p>{copy.videoError}</p>
                </div>
              ) : null}
            </div>
          </div>
        </article>

        <aside className="dsv2-card tv-queue-v2-queue" aria-label="قائمة حجوزات اليوم">
          <header className="tv-queue-v2-panel-head">
            <div className="tv-queue-v2-panel-head__copy">
              <h2>قائمة حجوزات اليوم</h2>
              <p>الحجوزات الحالية أولًا ثم القادمة، مع عد تنازلي محدث كل ثانية.</p>
            </div>
            <span className="dsv2-badge dsv2-badge--gold" aria-label="إجمالي الحجوزات المعروضة">
              {todayQueue.length} حجز
            </span>
          </header>

          <div className="tv-queue-v2-queue-body" aria-live="polite">
            {loading ? (
              <div className="tv-queue-v2-state-shell" role="status" aria-label={copy.loading}>
                <span className="dsv2-sr-only">{copy.loading}</span>
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="tv-queue-v2-skeleton-card" key={index}>
                    <DashboardSkeletonV2 variant="title" width="42%" />
                    <DashboardSkeletonV2 lines={3} />
                  </div>
                ))}
              </div>
            ) : null}

            {!loading && error ? (
              <DashboardErrorStateV2
                compact
                title="تعذر تحميل حجوزات اليوم"
                description={error}
                details="ستتم إعادة المحاولة تلقائيًا أثناء بقاء الشاشة مفتوحة."
              />
            ) : null}

            {!loading && !error && !todayQueue.length ? (
              <DashboardEmptyStateV2
                compact
                tone="gold"
                title="لا توجد حجوزات فعالة الآن"
                description={copy.empty}
              />
            ) : null}

            {!loading && !error && todayQueue.length ? (
              <div className="tv-queue-v2-booking-list">
                {todayQueue.map((row, idx) => (
                  <article
                    key={row.id}
                    className={`tv-queue-v2-booking tv-queue-v2-booking--${row.state}`}
                  >
                    <header className="tv-queue-v2-booking__head">
                      <div className="tv-queue-v2-booking__title">
                        <span>{copy.booking} {idx + 1}</span>
                        <strong dir="ltr">{bookingNoOf(row.publicId)}</strong>
                      </div>
                      <span
                        className={`dsv2-badge ${
                          row.state === "current" ? "dsv2-badge--success" : "dsv2-badge--gold"
                        }`}
                      >
                        {row.state === "current" ? copy.current : copy.upcoming}
                      </span>
                    </header>

                    <dl className="tv-queue-v2-booking__meta">
                      <div>
                        <dt>{copy.client}</dt>
                        <dd>{row.clientName || copy.dash}</dd>
                      </div>
                      <div>
                        <dt>{copy.employee}</dt>
                        <dd>{row.employeeName || copy.dash}</dd>
                      </div>
                      <div>
                        <dt>{copy.time}</dt>
                        <dd dir="ltr">{formatTime12(row.time)}</dd>
                      </div>
                      <div className="tv-queue-v2-countdown">
                        <dt>{row.state === "current" ? copy.endsAfter : copy.remaining}</dt>
                        <dd dir="ltr">
                          {row.state === "current"
                            ? msToMinSec(row.startMs + SHOW_AFTER_TURN_MS - nowMs)
                            : countdownLabel(row.startMs, nowMs)}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
