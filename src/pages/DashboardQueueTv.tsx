import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import logo1 from "../assets/images/ssunnamed3.png";
import "../styles/DashboardQueueTv.css";

const SALON_ID = "main";
const SHOW_AFTER_TURN_MS = 20 * 60 * 1000;

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

export default function DashboardQueueTv() {
  const [todayKey, setTodayKey] = useState<string>(() => todayISO());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [bookings, setBookings] = useState<QueueBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const videoSrc = "/tv-promo.mp4";

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

  const perEmployee = useMemo(() => {
    const byEmp = new Map<
      string,
      {
        employeeName: string;
        allToday: Array<
          QueueBooking & {
            startMs: number;
            state: "upcoming" | "current";
            countdownMs: number;
          }
        >;
        current: Array<
          QueueBooking & {
            startMs: number;
            state: "upcoming" | "current";
            countdownMs: number;
          }
        >;
        priorityStartMs: number;
      }
    >();

    bookings.forEach((b) => {
      const startMs = toDateTimeMs(b.date, b.time);
      if (!Number.isFinite(startMs)) return;
      if (nowMs > startMs + SHOW_AFTER_TURN_MS) return;
      const state: "upcoming" | "current" = nowMs >= startMs ? "current" : "upcoming";
      const countdownMs = Math.max(0, startMs - nowMs);
      const key = String(b.employeeName || "غير محدد").trim() || "غير محدد";
      const item = { ...b, startMs, state, countdownMs };
      const group = byEmp.get(key);
      if (!group) {
        byEmp.set(key, {
          employeeName: key,
          allToday: [item],
          current: state === "current" ? [item] : [],
          priorityStartMs: startMs,
        });
        return;
      }
      group.allToday.push(item);
      if (state === "current") group.current.push(item);
      if (startMs < group.priorityStartMs) group.priorityStartMs = startMs;
    });

    const groups = Array.from(byEmp.values()).map((g) => {
      g.allToday.sort((a, b) => {
        const aRank = a.state === "current" ? 0 : 1;
        const bRank = b.state === "current" ? 0 : 1;
        if (aRank !== bRank) return aRank - bRank;
        return a.startMs - b.startMs;
      });
      g.current.sort((a, b) => a.startMs - b.startMs);
      return g;
    });

    groups.sort((a, b) => a.priorityStartMs - b.priorityStartMs);
    return groups;
  }, [bookings, nowMs]);

  return (
    <div className="dashboard-tv-page">
      <div className="dashboard-tv-header">
        <img src={logo1} alt="Malikat Salon" className="dashboard-tv-logo" />
      </div>

      <section className="dashboard-tv-video-card">
        <video className="dashboard-tv-video" src={videoSrc} autoPlay loop muted playsInline controls />
      </section>

      <section className="dashboard-tv-queue-card">
        <div className="dashboard-tv-title-row">
          <h3>شاشة الدور - حجوزات اليوم</h3>
          <span>
            {todayKey} • {new Intl.DateTimeFormat("ar-SA", { timeStyle: "medium" }).format(new Date(nowMs))}
          </span>
        </div>

        {loading ? <div className="dashboard-tv-empty">جاري تحميل حجوزات اليوم...</div> : null}
        {!loading && error ? <div className="dashboard-tv-empty">{error}</div> : null}

        {!loading && !error ? (
          <>
            <div className="dashboard-tv-summary">
              إجمالي الظاهر الآن: {perEmployee.reduce((sum, g) => sum + g.allToday.length, 0)} حجز
            </div>

            {!perEmployee.length ? (
              <div className="dashboard-tv-empty">لا توجد حجوزات فعالة لعرضها الآن.</div>
            ) : (
              <div className="dashboard-tv-employee-grid">
                {perEmployee.map((g) => (
                  <article key={g.employeeName} className="dashboard-tv-employee-card">
                    <div className="dashboard-tv-employee-head">
                      <h4>{g.employeeName}</h4>
                      <span>{g.allToday.length} حجز</span>
                    </div>

                    <div className="dashboard-tv-main-card is-current">
                      <div className="dashboard-tv-main-label">الحالي</div>
                      {g.current.length ? (
                        g.current.map((c) => (
                          <div key={c.id} className="dashboard-tv-now-item">
                            <b>{bookingNoOf(c.publicId)}</b>
                            <span>{c.clientName}</span>
                            <small>الوقت: {formatTime12(c.time)}</small>
                            <small>ينتهي العرض بعد: {msToMinSec(c.startMs + SHOW_AFTER_TURN_MS - nowMs)}</small>
                          </div>
                        ))
                      ) : (
                        <div className="dashboard-tv-empty">لا يوجد دور حالي</div>
                      )}
                    </div>

                    <div className="dashboard-tv-timeline">
                      {g.allToday.map((row) => (
                        <div key={row.id} className={`dashboard-tv-timeline-row ${row.state === "current" ? "is-current" : "is-upcoming"}`}>
                          <div className="dashboard-tv-timeline-left">
                            <b>{bookingNoOf(row.publicId)}</b>
                            <span>{row.clientName}</span>
                          </div>
                          <div className="dashboard-tv-timeline-right">
                            <span>{formatTime12(row.time)}</span>
                            {row.state === "upcoming" ? (
                              <small>باقي: {countdownLabel(row.startMs, nowMs)}</small>
                            ) : (
                              <small>الحجز الحالي</small>
                            )}
                          </div>
                        </div>
                      ))}
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
