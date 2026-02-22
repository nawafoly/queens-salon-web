import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import "../styles/DashboardDayAudit.css";

const SALON_ID = "main";
const LOCK_KEY = "dashboard_day_audit_lock_v1";

type LockSnapshot = {
  date: string;
  manualCash: number;
  bookingsRevenue: number;
  diff: number;
  lockedAt: number;
};

function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadLockMap(): Record<string, LockSnapshot> {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLockMap(next: Record<string, LockSnapshot>) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(next));
}

export default function DashboardDayAudit() {
  const [todayKey, setTodayKey] = useState(() => todayISO());
  const [bookingsRevenueLive, setBookingsRevenueLive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [manualCashInput, setManualCashInput] = useState("");
  const [lockMap, setLockMap] = useState<Record<string, LockSnapshot>>(() => loadLockMap());

  const lock = lockMap[todayKey] || null;
  const bookingsRevenue = lock ? lock.bookingsRevenue : bookingsRevenueLive;
  const manualCash = lock ? lock.manualCash : toNum(manualCashInput || 0);
  const diff = lock ? lock.diff : manualCash - bookingsRevenue;

  useEffect(() => {
    const t = window.setInterval(() => {
      setTodayKey((prev) => {
        const next = todayISO();
        if (prev !== next) setManualCashInput("");
        return next;
      });
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "salons", SALON_ID, "bookings"), where("date", "==", todayKey));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let total = 0;
        snap.docs.forEach((d) => {
          const x = d.data() as any;
          const status = String(x?.status || "").toLowerCase().trim();
          if (status !== "confirmed" && status !== "completed") return;
          total += toNum(x?.finalPrice ?? x?.total ?? 0);
        });
        setBookingsRevenueLive(total);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [todayKey]);

  const dateLabel = useMemo(() => {
    const m = todayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return todayKey;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "short" }).format(dt);
  }, [todayKey]);

  const printAudit = () => {
    window.print();
  };

  const printAndLock = () => {
    const manual = toNum(manualCashInput || 0);
    const nextLock: LockSnapshot = {
      date: todayKey,
      manualCash: manual,
      bookingsRevenue: bookingsRevenueLive,
      diff: manual - bookingsRevenueLive,
      lockedAt: Date.now(),
    };
    const nextMap = { ...lockMap, [todayKey]: nextLock };
    setLockMap(nextMap);
    saveLockMap(nextMap);
    window.print();
  };

  return (
    <div className="day-audit-page">
      <div className="day-audit-card" id="day-audit-print">
        <h2>جرد اليوم</h2>
        <p>اطبع ملخص اليوم + إدخال الكاش اليدوي قبل الطباعة</p>

        <div className="day-audit-grid">
          <div className="day-audit-row">
            <label>تاريخ الجرد</label>
            <div>{dateLabel}</div>
          </div>

          <div className="day-audit-row">
            <label>الكاش اليدوي قبل الطباعة</label>
            <input
              type="number"
              inputMode="decimal"
              placeholder="مثال: 500"
              value={lock ? String(lock.manualCash) : manualCashInput}
              onChange={(e) => setManualCashInput(String(e.target.value || ""))}
              disabled={!!lock}
            />
          </div>

          <div className="day-audit-row">
            <label>إيراد الحجوزات (مؤكد + مكتمل)</label>
            <div>{loading ? "جاري التحميل..." : bookingsRevenue.toFixed(2)}</div>
          </div>

          <div className="day-audit-row">
            <label>فرق الكاش (الكاش - الإيراد)</label>
            <div className={diff < 0 ? "is-neg" : diff > 0 ? "is-pos" : ""}>{diff.toFixed(2)}</div>
          </div>
        </div>

        <div className="day-audit-actions no-print">
          <button type="button" className="btn btn-outline-dark" onClick={printAudit}>
            طباعة جرد اليوم
          </button>
          <button type="button" className="btn btn-dark" onClick={printAndLock} disabled={!!lock}>
            {lock ? "تم قفل اليوم" : "طباعة + قفل اليوم"}
          </button>
        </div>
      </div>
    </div>
  );
}

