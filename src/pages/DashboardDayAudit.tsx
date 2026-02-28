import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import "../styles/DashboardDayAudit.css";

const SALON_ID = "main";
const LOCK_KEY = "dashboard_day_audit_lock_v1";

type LockSnapshot = {
  date: string;
  manualCash: number;
  bookingsRevenue: number;
  cashRevenue?: number;
  cardRevenue?: number;
  transferRevenue?: number;
  diff: number;
  lockedAt: number;
};

type PaymentChannel = "cash" | "card" | "transfer";

type RevenueBreakdown = {
  total: number;
  cash: number;
  card: number;
  transfer: number;
};

type DayAuditPrintPayload = {
  dateLabel: string;
  totalRevenue: number;
  cashRevenue: number;
  cardRevenue: number;
  transferRevenue: number;
  manualCash: number;
  diff: number;
  isLocked: boolean;
  lockTimeLabel: string;
  printedAtLabel: string;
};

const MONEY_FORMATTER = new Intl.NumberFormat("ar-SA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ar-SA", {
  dateStyle: "medium",
  timeStyle: "short",
});

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

function formatAmount(v: unknown): string {
  return `${MONEY_FORMATTER.format(toNum(v))} ر.س`;
}

function formatLockedAt(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return DATE_TIME_FORMATTER.format(new Date(n));
}

function escapeHtml(value: unknown): string {
  const text = String(value ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeAuditPaymentMethod(rawMethod: unknown, rawNote: unknown): PaymentChannel {
  const method = String(rawMethod ?? "").toLowerCase().trim();
  if (method === "cash" || method === "كاش" || method === "نقد") return "cash";
  if (
    method === "card" ||
    method === "pos_card" ||
    method === "mada_online" ||
    method === "شبكة" ||
    method === "مدى"
  ) {
    return "card";
  }
  if (method === "transfer" || method === "تحويل" || method === "بنكي") return "transfer";

  const note = String(rawNote ?? "").toLowerCase();
  if (note.includes("payment_method:cash") || note.includes("invoice_from_reception:cash")) return "cash";
  if (note.includes("payment_method:card") || note.includes("invoice_from_reception:card")) return "card";
  if (note.includes("payment_method:transfer") || note.includes("invoice_from_reception:transfer")) {
    return "transfer";
  }
  if (note.includes("شبكة") || note.includes("مدى") || /\bcard\b/.test(note)) return "card";
  if (note.includes("كاش") || note.includes("نقد") || /\bcash\b/.test(note)) return "cash";
  if (note.includes("تحويل") || note.includes("بنكي") || /\btransfer\b|\bbank\b/.test(note)) {
    return "transfer";
  }

  return "transfer";
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
  const [revenueLive, setRevenueLive] = useState<RevenueBreakdown>({
    total: 0,
    cash: 0,
    card: 0,
    transfer: 0,
  });
  const [loadedDateKey, setLoadedDateKey] = useState("");
  const [manualCashInput, setManualCashInput] = useState("");
  const [errorText, setErrorText] = useState("");
  const [lockMap, setLockMap] = useState<Record<string, LockSnapshot>>(() => loadLockMap());
  const pendingPrintPopupRef = useRef<Window | null>(null);

  const lock = lockMap[todayKey] || null;
  const bookingsRevenue = lock ? lock.bookingsRevenue : revenueLive.total;
  const cashRevenue = lock ? toNum(lock.cashRevenue ?? lock.bookingsRevenue) : revenueLive.cash;
  const cardRevenue = lock ? toNum(lock.cardRevenue ?? 0) : revenueLive.card;
  const transferRevenue = lock ? toNum(lock.transferRevenue ?? 0) : revenueLive.transfer;
  const manualCash = lock ? lock.manualCash : toNum(manualCashInput || 0);
  const diff = lock ? lock.diff : manualCash - cashRevenue;
  const lockTimeLabel = lock ? formatLockedAt(lock.lockedAt) : "";
  const loading = loadedDateKey !== todayKey;

  useEffect(() => {
    const t = window.setInterval(() => {
      setTodayKey((prev) => {
        const next = todayISO();
        if (prev !== next) {
          setManualCashInput("");
          setErrorText("");
        }
        return next;
      });
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const q = query(collection(db, "salons", SALON_ID, "bookings"), where("date", "==", todayKey));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let total = 0;
        let cash = 0;
        let card = 0;
        let transfer = 0;

        snap.docs.forEach((d) => {
          const x = d.data() as Record<string, unknown>;
          const status = String(x?.status || "").toLowerCase().trim();
          if (status !== "confirmed" && status !== "completed") return;

          const amount = toNum(x?.finalPrice ?? x?.total ?? 0);
          total += amount;

          const method = normalizeAuditPaymentMethod(x?.paymentMethod, x?.note);
          if (method === "cash") cash += amount;
          else if (method === "card") card += amount;
          else transfer += amount;
        });

        setRevenueLive({ total, cash, card, transfer });
        setLoadedDateKey(todayKey);
      },
      () => setLoadedDateKey(todayKey)
    );
    return () => unsub();
  }, [todayKey]);

  const dateLabel = useMemo(() => {
    const m = todayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return todayKey;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "short" }).format(dt);
  }, [todayKey]);

  const closePendingAuditPrintPopup = () => {
    const popup = pendingPrintPopupRef.current;
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // ignore popup close errors
      }
    }
    pendingPrintPopupRef.current = null;
  };

  useEffect(() => {
    return () => closePendingAuditPrintPopup();
  }, []);

  const primeAuditPrintPopup = () => {
    const current = pendingPrintPopupRef.current;
    if (current && !current.closed) {
      current.focus();
      return true;
    }
    const popup = window.open(
      "about:blank",
      "day_audit_print_popup",
      "width=720,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
    );
    if (!popup) return false;
    pendingPrintPopupRef.current = popup;
    try {
      popup.document.title = "جاري تجهيز جرد اليوم";
    } catch {
      // ignore popup access errors
    }
    popup.focus();
    return true;
  };

  const buildAuditPrintHtml = (payload: DayAuditPrintPayload) => {
    const statusLabel = payload.isLocked ? "مقفل" : "مفتوح";
    const diffClass = payload.diff < 0 ? "neg" : payload.diff > 0 ? "pos" : "zero";
    const lockedRow = payload.isLocked
      ? `<tr><td>وقت الإغلاق</td><td>${escapeHtml(payload.lockTimeLabel)}</td></tr>`
      : "";
    const cardRow =
      payload.cardRevenue > 0
        ? `<div class="summary-row"><span>إيراد الشبكة</span><strong>${escapeHtml(
            formatAmount(payload.cardRevenue)
          )}</strong></div>`
        : "";
    const transferRow =
      payload.transferRevenue > 0
        ? `<div class="summary-row"><span>إيراد التحويل</span><strong>${escapeHtml(
            formatAmount(payload.transferRevenue)
          )}</strong></div>`
        : "";

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>جرد اليوم</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    html, body {
      width: 80mm;
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: "Lucida Console", "Courier New", monospace;
      font-size: 11px;
      line-height: 1.35;
    }
    .receipt {
      width: 72mm;
      margin: 0 auto;
      padding: 2mm 1.5mm 4mm;
      box-sizing: border-box;
    }
    .title {
      margin: 0;
      text-align: center;
      font-size: 16px;
      font-weight: 700;
    }
    .meta {
      margin-top: 1mm;
      text-align: center;
      font-size: 10px;
      color: #000;
    }
    .line {
      margin: 2mm 0;
      border-top: 1px dashed #000;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 1mm 0;
      vertical-align: top;
    }
    td:first-child {
      width: 50%;
      color: #000;
    }
    td:last-child {
      width: 50%;
      text-align: left;
      font-weight: 700;
    }
    .summary {
      margin-top: 1.5mm;
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      padding: 1.2mm 0;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      padding: 0.8mm 0;
    }
    .summary-row strong {
      font-size: 13px;
    }
    .summary-row.neg strong { color: #b42318; }
    .summary-row.pos strong { color: #067647; }
    .summary-row.zero strong { color: #000; }
    .footer {
      margin-top: 2mm;
      text-align: center;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <main class="receipt">
    <h1 class="title">جرد اليوم</h1>
    <div class="meta">${escapeHtml(payload.printedAtLabel)}</div>
    <div class="line"></div>
    <table>
      <tr><td>تاريخ الجرد</td><td>${escapeHtml(payload.dateLabel)}</td></tr>
      <tr><td>الحالة</td><td>${statusLabel}</td></tr>
      ${lockedRow}
    </table>
    <div class="summary">
      <div class="summary-row">
        <span>إيراد الحجوزات (الكل)</span>
        <strong>${escapeHtml(formatAmount(payload.totalRevenue))}</strong>
      </div>
      <div class="summary-row">
        <span>إيراد الكاش</span>
        <strong>${escapeHtml(formatAmount(payload.cashRevenue))}</strong>
      </div>
      ${cardRow}
      ${transferRow}
      <div class="summary-row">
        <span>الكاش اليدوي</span>
        <strong>${escapeHtml(formatAmount(payload.manualCash))}</strong>
      </div>
      <div class="summary-row ${diffClass}">
        <span>فرق الكاش (الكاش اليدوي - إيراد الكاش)</span>
        <strong>${escapeHtml(formatAmount(payload.diff))}</strong>
      </div>
    </div>
    <div class="footer">تم إعداد الجرد آليًا من لوحة التحكم</div>
  </main>
  <script>
    (function () {
      var printed = false;
      function runPrint() {
        if (printed) return;
        printed = true;
        window.focus();
        window.print();
      }
      window.addEventListener("load", function () {
        setTimeout(runPrint, 120);
      });
      window.onafterprint = function () {
        setTimeout(function () {
          window.close();
        }, 80);
      };
    })();
  </script>
</body>
</html>`;
  };

  const openAuditPrintPopup = (payload: DayAuditPrintPayload) => {
    const pending = pendingPrintPopupRef.current;
    const popup =
      pending && !pending.closed
        ? pending
        : window.open(
            "about:blank",
            "day_audit_print_popup",
            "width=720,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
          );
    if (!popup) {
      closePendingAuditPrintPopup();
      return false;
    }
    pendingPrintPopupRef.current = popup;
    try {
      popup.document.open();
      popup.document.write(buildAuditPrintHtml(payload));
      popup.document.close();
      popup.focus();
      pendingPrintPopupRef.current = null;
      return true;
    } catch {
      closePendingAuditPrintPopup();
      return false;
    }
  };

  const printAudit = () => {
    setErrorText("");
    const payload: DayAuditPrintPayload = {
      dateLabel,
      totalRevenue: bookingsRevenue,
      cashRevenue,
      cardRevenue,
      transferRevenue,
      manualCash,
      diff,
      isLocked: !!lock,
      lockTimeLabel: lock ? formatLockedAt(lock.lockedAt) : "—",
      printedAtLabel: DATE_TIME_FORMATTER.format(new Date()),
    };
    if (!openAuditPrintPopup(payload)) {
      setErrorText("تعذر فتح نافذة الطباعة. فعّل النوافذ المنبثقة للموقع ثم أعد المحاولة.");
    }
  };

  const printAndLock = () => {
    if (lock) return;

    const manual = toNum(manualCashInput || 0);
    if (manual < 0) {
      setErrorText("الكاش اليدوي لا يمكن أن يكون رقمًا سالبًا.");
      return;
    }

    setErrorText("");
    const nextLock: LockSnapshot = {
      date: todayKey,
      manualCash: manual,
      bookingsRevenue: revenueLive.total,
      cashRevenue: revenueLive.cash,
      cardRevenue: revenueLive.card,
      transferRevenue: revenueLive.transfer,
      diff: manual - revenueLive.cash,
      lockedAt: Date.now(),
    };
    const nextMap = { ...lockMap, [todayKey]: nextLock };
    setLockMap(nextMap);
    saveLockMap(nextMap);

    const payload: DayAuditPrintPayload = {
      dateLabel,
      totalRevenue: nextLock.bookingsRevenue,
      cashRevenue: toNum(nextLock.cashRevenue),
      cardRevenue: toNum(nextLock.cardRevenue),
      transferRevenue: toNum(nextLock.transferRevenue),
      manualCash: nextLock.manualCash,
      diff: nextLock.diff,
      isLocked: true,
      lockTimeLabel: formatLockedAt(nextLock.lockedAt),
      printedAtLabel: DATE_TIME_FORMATTER.format(new Date()),
    };
    if (!openAuditPrintPopup(payload)) {
      setErrorText("تعذر فتح نافذة الطباعة. فعّل النوافذ المنبثقة للموقع ثم أعد المحاولة.");
    }
  };

  return (
    <div className="day-audit-page">
      <div className="day-audit-card" id="day-audit-print">
        <div className="day-audit-head">
          <div className="day-audit-head-main">
            <h2>جرد اليوم</h2>
            <p>اطبع ملخص اليوم وأدخل الكاش اليدوي قبل الطباعة والإغلاق.</p>
          </div>
          <div className={`day-audit-badge ${lock ? "is-locked" : "is-open"}`}>
            {lock ? "مقفل" : "مفتوح"}
          </div>
        </div>

        {lock && (
          <div className="day-audit-lock-note">
            تم قفل هذا اليوم في: <strong>{lockTimeLabel}</strong>
          </div>
        )}

        <div className="day-audit-kpis">
          <div className="day-audit-kpi day-audit-kpi--date">
            <div className="day-audit-kpi-label">تاريخ الجرد</div>
            <div className="day-audit-kpi-value">{dateLabel}</div>
          </div>
          <div className="day-audit-kpi day-audit-kpi--revenue">
            <div className="day-audit-kpi-label">إيراد الحجوزات (مؤكد + مكتمل)</div>
            <div className="day-audit-kpi-value">
              {loading ? "جاري التحميل..." : formatAmount(bookingsRevenue)}
            </div>
          </div>
          <div className="day-audit-kpi day-audit-kpi--diff">
            <div className="day-audit-kpi-label">فرق الكاش (الكاش اليدوي - إيراد الكاش)</div>
            <div
              className={[
                "day-audit-kpi-value",
                diff < 0 ? "is-neg" : diff > 0 ? "is-pos" : "is-zero",
              ].join(" ")}
            >
              {formatAmount(diff)}
            </div>
          </div>
        </div>

        <div className="day-audit-manual">
          <label htmlFor="day-audit-manual-cash">الكاش اليدوي قبل الطباعة</label>
          <input
            id="day-audit-manual-cash"
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="مثال: 500"
            value={lock ? String(lock.manualCash) : manualCashInput}
            onChange={(e) => {
              setErrorText("");
              setManualCashInput(String(e.target.value || ""));
            }}
            disabled={!!lock}
          />
          <div className="day-audit-manual-hint">
            {lock
              ? "تم قفل اليوم. لا يمكن تعديل القيم بعد الإغلاق."
              : "أدخل الكاش الفعلي قبل الطباعة والإغلاق."}
          </div>
        </div>

        <div className="day-audit-summary">
          <div className="day-audit-summary-row day-audit-summary-row--revenue">
            <span>إيراد الحجوزات (الكل)</span>
            <strong>{formatAmount(bookingsRevenue)}</strong>
          </div>
          <div className="day-audit-summary-row day-audit-summary-row--cash-bookings">
            <span>إيراد الكاش</span>
            <strong>{formatAmount(cashRevenue)}</strong>
          </div>
          {cardRevenue > 0 && (
            <div className="day-audit-summary-row day-audit-summary-row--card">
              <span>إيراد الشبكة</span>
              <strong>{formatAmount(cardRevenue)}</strong>
            </div>
          )}
          {transferRevenue > 0 && (
            <div className="day-audit-summary-row day-audit-summary-row--transfer">
              <span>إيراد التحويل</span>
              <strong>{formatAmount(transferRevenue)}</strong>
            </div>
          )}
          <div className="day-audit-summary-row day-audit-summary-row--cash">
            <span>الكاش اليدوي</span>
            <strong>{formatAmount(manualCash)}</strong>
          </div>
          <div className="day-audit-summary-row day-audit-summary-row--diff">
            <span>فرق الكاش النهائي</span>
            <strong className={diff < 0 ? "is-neg" : diff > 0 ? "is-pos" : "is-zero"}>
              {formatAmount(diff)}
            </strong>
          </div>
        </div>

        {!!errorText && <div className="day-audit-alert is-error no-print">{errorText}</div>}

        <div className="day-audit-actions no-print">
          <button
            type="button"
            className="day-audit-btn day-audit-btn--ghost"
            onPointerDown={primeAuditPrintPopup}
            onClick={printAudit}
          >
            طباعة جرد اليوم
          </button>
          <button
            type="button"
            className="day-audit-btn day-audit-btn--primary"
            onPointerDown={primeAuditPrintPopup}
            onClick={printAndLock}
            disabled={!!lock}
          >
            {lock ? "تم قفل اليوم" : "طباعة + قفل اليوم"}
          </button>
        </div>
      </div>
    </div>
  );
}
