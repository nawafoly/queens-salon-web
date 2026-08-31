import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDay,
  faCashRegister,
  faCreditCard,
  faFileInvoiceDollar,
  faLock,
  faPrint,
  faScaleBalanced,
  faUnlockKeyhole,
} from "@fortawesome/free-solid-svg-icons";
import { DashboardDatePickerV2, DashboardSkeletonV2 } from "../components/dashboard-v2";
import { CoreBookingService } from "../services/CoreBookingService";
import { listAllIncomeCore } from "../services/CoreIncomeService";
import "../styles/dashboard-v2/dashboard-v2.css";

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
type BookingPaymentType = "full" | "partial";

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

const MONEY_FORMATTER = new Intl.NumberFormat("ar-SA-u-nu-latn", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
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

  if (method === "cash" || method === "\u0646\u0642\u062f" || method === "\u0643\u0627\u0634") return "cash";

  if (
    method === "card" ||
    method === "pos_card" ||
    method === "mada_online" ||
    method === "network" ||
    method === "mada" ||
    method === "visa" ||
    method === "mastercard" ||
    method === "master_card" ||
    method === "credit_card" ||
    method === "debit_card" ||
    method === "apple_pay" ||
    method === "applepay" ||
    method === "tap" ||
    method === "\u0634\u0628\u0643\u0629" ||
    method === "\u0645\u062f\u0649"
  ) {
    return "card";
  }

  if (/(card|network|mada|visa|master|pos|apple|credit|debit)/.test(method)) return "card";

  if (
    method === "transfer" ||
    method === "bank_transfer" ||
    method === "\u062a\u062d\u0648\u064a\u0644" ||
    method === "\u0628\u0646\u0643\u064a"
  ) {
    return "transfer";
  }

  const note = String(rawNote ?? "").toLowerCase();
  if (note.includes("payment_method:cash") || note.includes("invoice_from_reception:cash")) return "cash";
  if (note.includes("payment_method:card") || note.includes("invoice_from_reception:card")) return "card";
  if (note.includes("payment_method:transfer") || note.includes("invoice_from_reception:transfer")) {
    return "transfer";
  }

  if (/(network|mada|visa|mastercard|master|credit|debit|pos|apple ?pay|card|\u0634\u0628\u0643\u0629|\u0645\u062f\u0649|\u0628\u0637\u0627\u0642\u0629)/.test(note)) {
    return "card";
  }
  if (/(cash|\u0646\u0642\u062f|\u0643\u0627\u0634)/.test(note)) return "cash";
  if (/(transfer|bank|\u062a\u062d\u0648\u064a\u0644|\u0628\u0646\u0643\u064a)/.test(note)) return "transfer";

  return "transfer";
}

function normalizePaymentType(raw: unknown): BookingPaymentType | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

function resolveAuditPaidAmount(raw: Record<string, unknown>): number {
  const totalAmount = Math.max(
    0,
    toNum(
      raw?.finalPrice ??
        raw?.total ??
        (raw as any)?.serviceSnapshot?.priceAtBooking ??
        (raw as any)?.packageSnapshot?.finalPriceAtBooking ??
        0
    )
  );
  const normalizedType = normalizePaymentType(raw?.paymentType);
  const hasExplicitPaid = Number.isFinite(Number(raw?.paidAmount));
  const explicitPaid = hasExplicitPaid ? Number(raw?.paidAmount) : NaN;
  const hasExplicitRemaining = Number.isFinite(Number(raw?.remainingAmount));
  const explicitRemaining = hasExplicitRemaining ? Number(raw?.remainingAmount) : NaN;
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "partial");
  let paidAmount: number;
  if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
  } else if (hasExplicitRemaining) {
    paidAmount = Math.max(0, Math.min(totalAmount, totalAmount - explicitRemaining));
  } else if (paymentType === "partial") {
    paidAmount = 0;
  } else {
    paidAmount = isRevenueStatus ? totalAmount : 0;
  }

  if (paymentType === "full") {
    paidAmount = isRevenueStatus ? totalAmount : Math.max(0, Math.min(totalAmount, paidAmount));
  } else {
    paymentType = paidAmount >= totalAmount ? "full" : "partial";
  }
  return Math.round(Math.max(0, Math.min(totalAmount, paidAmount)) * 100) / 100;
}

function toMillisSafe(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as any).toMillis === "function") return (v as any).toMillis();
  if (v && typeof (v as any).seconds === "number") return Number((v as any).seconds) * 1000;
  const parsed = Date.parse(String(v || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIsoDateLoose(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const strict = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (strict) return `${strict[1]}-${strict[2]}-${strict[3]}`;
  const withPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (withPrefix?.[1]) return withPrefix[1];
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  return todayISO(new Date(parsed));
}

function normalizeIncomeSource(rawSource: unknown): string {
  return String(rawSource || "").trim().toLowerCase();
}

function isSystemBookingSource(source: string): boolean {
  return (
    source === "booking" ||
    source === "invoice" ||
    source === "\u062d\u062c\u0632" ||
    source === "\u0641\u0627\u062a\u0648\u0631\u0629"
  );
}

function resolveIncomeBookingId(raw: Record<string, unknown>, docId: string): string {
  const explicitBookingId = String(raw?.bookingId || "").trim();
  if (explicitBookingId) return explicitBookingId;

  const source = normalizeIncomeSource(raw?.source);
  if (!isSystemBookingSource(source)) return "";
  return String(docId || "").trim();
}

function resolveIncomeDateForAudit(raw: Record<string, unknown>, bookingDateOverride?: string): string {
  const bookingDate = normalizeIsoDateLoose(bookingDateOverride);
  if (bookingDate) return bookingDate;

  const explicit = normalizeIsoDateLoose(raw?.date);
  if (explicit) return explicit;

  const createdAtMs = toMillisSafe(raw?.createdAt ?? raw?.updatedAt);
  const createdISO = createdAtMs > 0 ? todayISO(new Date(createdAtMs)) : "";
  return createdISO;
}

function isBookingIncomeRow(raw: Record<string, unknown>): boolean {
  const source = normalizeIncomeSource(raw?.source);
  if (
    isSystemBookingSource(source) ||
    source === "refund" ||
    source === "\u0627\u0633\u062a\u0631\u062c\u0627\u0639"
  ) {
    return true;
  }
  return !!String(raw?.bookingId || "").trim();
}

function isVoidedIncomeStatus(rawStatus: unknown): boolean {
  const status = String(rawStatus || "").trim().toLowerCase();
  return status === "voided" || status === "void" || status === "cancelled" || status === "canceled";
}

function resolveIncomeAuditIdentity(raw: Record<string, unknown>, docId: string, amount: number): string {
  const source = normalizeIncomeSource(raw?.source);
  const bookingId = resolveIncomeBookingId(raw, docId);
  const isRefund =
    source === "refund" ||
    source === "\u0627\u0633\u062a\u0631\u062c\u0627\u0639" ||
    String(docId || "").startsWith("refund_") ||
    amount < 0;

  if (bookingId) return `${isRefund ? "refund" : "booking"}:${bookingId}`;
  return `doc:${String(docId || "").trim() || "unknown"}`;
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
  const [todayLimitKey, setTodayLimitKey] = useState(() => todayISO());
  const [bookingDateById, setBookingDateById] = useState<Record<string, string>>({});
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
      setTodayLimitKey(todayISO());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;

    const loadCoreAuditData = async () => {
      try {
        const [bookings, incomeRows] = await Promise.all([
          CoreBookingService.list({ date: todayKey }),
          listAllIncomeCore(),
        ]);
        if (!active) return;

        const bookingDates: Record<string, string> = {};
        for (const booking of bookings) {
          const date = String(booking.bookingDate || "").slice(0, 10);
          if (booking.id && date) bookingDates[booking.id] = date;
        }
        setBookingDateById(bookingDates);

        let total = 0;
        let cash = 0;
        let card = 0;
        let transfer = 0;
        const dedupRows = new Map<string, { amount: number; method: PaymentChannel; sortMs: number }>();
        for (const x of incomeRows as any[]) {
          if (!isBookingIncomeRow(x)) continue;
          if (isVoidedIncomeStatus(x?.status)) continue;
          const docId = String(x?.id || "").trim();
          const source = normalizeIncomeSource(x?.source);
          const bookingId = resolveIncomeBookingId(x, docId);
          const bookingDate = isSystemBookingSource(source) && bookingId ? bookingDates[bookingId] : "";
          if (resolveIncomeDateForAudit(x, bookingDate) !== todayKey) continue;
          const amount = Math.round(toNum(x?.amount) * 100) / 100;
          if (!Number.isFinite(amount) || amount === 0) continue;
          const method = normalizeAuditPaymentMethod(x?.method ?? x?.paymentMethod, x?.note);
          const identity = resolveIncomeAuditIdentity(x, docId, amount);
          const sortMs = Math.max(toMillisSafe(x?.updatedAt), toMillisSafe(x?.createdAt));
          const previous = dedupRows.get(identity);
          if (!previous || sortMs >= previous.sortMs) dedupRows.set(identity, { amount, method, sortMs });
        }
        dedupRows.forEach((row) => {
          if (row.method === "cash") { cash += row.amount; total += row.amount; }
          else if (row.method === "card") { card += row.amount; total += row.amount; }
          else transfer += row.amount;
        });
        setRevenueLive({ total, cash, card, transfer });
        setLoadedDateKey(todayKey);
      } catch (error) {
        console.error("Core day audit load failed:", error);
        if (active) {
          setErrorText("تعذر تحميل جرد اليوم من Core.");
          setLoadedDateKey(todayKey);
        }
      }
    };

    void loadCoreAuditData();
    timer = window.setInterval(() => void loadCoreAuditData(), 30_000);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [todayKey]);

  const dateLabel = useMemo(() => {
    const m = todayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return todayKey;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "short" }).format(dt);
  }, [todayKey]);

  const applyDateSelection = (rawDate: string) => {
    const raw = String(rawDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    const bounded = raw > todayLimitKey ? todayLimitKey : raw;
    setErrorText("");
    setManualCashInput("");
    setTodayKey(bounded);
  };

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
    const cardRow = `<div class="summary-row"><span>إيراد الشبكة</span><strong>${escapeHtml(
      formatAmount(payload.cardRevenue)
    )}</strong></div>`;
    const transferRow = `<div class="summary-row"><span>إيراد التحويل (خارج القفل)</span><strong>${escapeHtml(
      formatAmount(payload.transferRevenue)
    )}</strong></div>`;

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
        <span>إيراد الجرد (الكاش + الشبكة)</span>
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

  const diffTone = diff < 0 ? "negative" : diff > 0 ? "positive" : "zero";
  const diffMetricClass = diff < 0
    ? "dsv2-metric-card--danger"
    : diff > 0
      ? "dsv2-metric-card--gold"
      : "dsv2-metric-card--success";

  return (
    <main className="dsv2-page day-audit-v2-page" dir="rtl">
      <section className="dsv2-card day-audit-v2-hero">
        <div className="day-audit-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">الجرد اليومي</span>
          <h1 className="dsv2-page-title">الجرد والإقفال اليومي</h1>
          <p className="dsv2-page-subtitle">
            مطابقة تحصيلات النظام مع الكاش الفعلي وإصدار محضر جرد واضح قبل إقفال اليوم.
          </p>
        </div>

        <div className="day-audit-v2-hero__controls no-print">
          <div className="day-audit-v2-date-card">
            <span className="day-audit-v2-date-card__icon" aria-hidden="true">
              <FontAwesomeIcon icon={faCalendarDay} />
            </span>
            <label className="day-audit-v2-date-card__field" htmlFor="day-audit-date">
              <span>تاريخ الجرد</span>
              <DashboardDatePickerV2
                id="day-audit-date"
                value={todayKey}
                max={todayLimitKey}
                clearable={false}
                onChange={applyDateSelection}
              />
            </label>
            <button
              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
              type="button"
              onClick={() => applyDateSelection(todayLimitKey)}
              disabled={todayKey === todayLimitKey}
            >
              اليوم
            </button>
          </div>

          <div className="day-audit-v2-status" data-state={lock ? "locked" : "open"}>
            <FontAwesomeIcon icon={lock ? faLock : faUnlockKeyhole} />
            <span>{lock ? "اليوم مقفل" : "اليوم مفتوح"}</span>
          </div>
        </div>
      </section>

      {lock ? (
        <div className="day-audit-v2-notice day-audit-v2-notice--success" role="status">
          <FontAwesomeIcon icon={faLock} />
          <span>
            تم إقفال هذا اليوم في <strong>{lockTimeLabel}</strong>. القيم محفوظة وغير قابلة للتعديل.
          </span>
        </div>
      ) : null}

      <section className="day-audit-v2-metrics" aria-label="ملخص الجرد">
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faFileInvoiceDollar} /></span>
          <p className="dsv2-metric-card__label">إجمالي التحصيل</p>
          <div className="dsv2-metric-card__value">
            {loading ? <DashboardSkeletonV2 width="72%" height={22} /> : formatAmount(bookingsRevenue)}
          </div>
          <p className="dsv2-metric-card__meta">{dateLabel}</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faCashRegister} /></span>
          <p className="dsv2-metric-card__label">تحصيل الكاش</p>
          <p className="dsv2-metric-card__value">{formatAmount(cashRevenue)}</p>
          <p className="dsv2-metric-card__meta">حسب المدفوعات المسجلة</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faCreditCard} /></span>
          <p className="dsv2-metric-card__label">الشبكة والتحويل</p>
          <p className="dsv2-metric-card__value">{formatAmount(cardRevenue + transferRevenue)}</p>
          <p className="dsv2-metric-card__meta">
            شبكة {formatAmount(cardRevenue)} · تحويل {formatAmount(transferRevenue)}
          </p>
        </article>

        <article className={`dsv2-metric-card ${diffMetricClass}`}>
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faScaleBalanced} /></span>
          <p className="dsv2-metric-card__label">فرق الكاش</p>
          <p className="dsv2-metric-card__value">{formatAmount(diff)}</p>
          <p className="dsv2-metric-card__meta">الكاش الفعلي ناقص تحصيل الكاش</p>
        </article>
      </section>

      <section className="day-audit-v2-layout" id="day-audit-print">
        <article className="dsv2-card day-audit-v2-panel day-audit-v2-entry">
          <header className="day-audit-v2-panel__head">
            <div className="day-audit-v2-panel__head-copy">
              <span className="dsv2-badge dsv2-badge--gold">عدّ الكاش</span>
              <h2>إدخال الكاش الفعلي</h2>
              <p>أدخل المبلغ الموجود فعليًا في الصندوق، ثم راجع الفرق قبل الإقفال.</p>
            </div>
            <span className="day-audit-v2-panel__index">01</span>
          </header>

          <label className="day-audit-v2-amount-field" htmlFor="day-audit-manual-cash">
            <span>مبلغ الكاش الموجود</span>
            <div className="day-audit-v2-amount-control">
              <input dir="ltr" lang="en"
                id="day-audit-manual-cash"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="0.00"
                value={lock ? String(lock.manualCash) : manualCashInput}
                onChange={(e) => {
                  setErrorText("");
                  setManualCashInput(String(e.target.value || ""));
                }}
                disabled={!!lock}
              />
              <b>ر.س</b>
            </div>
            <small>
              {lock ? "تم تثبيت المبلغ عند إقفال اليوم." : "استخدم المبلغ المحسوب فعليًا من الصندوق."}
            </small>
          </label>

          <div className="day-audit-v2-difference">
            <span>نتيجة المطابقة الحالية</span>
            <strong data-diff={diffTone}>
              {diff === 0
                ? "متطابق"
                : diff < 0
                  ? `عجز ${formatAmount(Math.abs(diff))}`
                  : `زيادة ${formatAmount(diff)}`}
            </strong>
          </div>

          {errorText ? (
            <div className="day-audit-v2-notice day-audit-v2-notice--danger no-print" role="alert">
              {errorText}
            </div>
          ) : null}

          <div className="day-audit-v2-actions no-print">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onPointerDown={primeAuditPrintPopup}
              onClick={printAudit}
            >
              <FontAwesomeIcon icon={faPrint} />
              طباعة مسودة الجرد
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onPointerDown={primeAuditPrintPopup}
              onClick={printAndLock}
              disabled={!!lock}
            >
              <FontAwesomeIcon icon={faLock} />
              {lock ? "تم إقفال اليوم" : "طباعة وإقفال اليوم"}
            </button>
          </div>
        </article>

        <aside className="dsv2-card day-audit-v2-panel day-audit-v2-breakdown">
          <header className="day-audit-v2-panel__head">
            <div className="day-audit-v2-panel__head-copy">
              <span className="dsv2-badge dsv2-badge--gold">التسوية</span>
              <h2>تفصيل التسوية</h2>
              <p>ملخص قنوات الدفع الداخلة في جرد التاريخ المحدد.</p>
            </div>
            <span className="day-audit-v2-panel__index">02</span>
          </header>

          <div className="day-audit-v2-summary">
            <div className="day-audit-v2-summary-row">
              <span>إجمالي التحصيل</span>
              <strong>{formatAmount(bookingsRevenue)}</strong>
            </div>
            <div className="day-audit-v2-summary-row">
              <span>تحصيل الكاش بالنظام</span>
              <strong>{formatAmount(cashRevenue)}</strong>
            </div>
            <div className="day-audit-v2-summary-row">
              <span>تحصيل الشبكة</span>
              <strong>{formatAmount(cardRevenue)}</strong>
            </div>
            <div className="day-audit-v2-summary-row">
              <span>التحويل البنكي</span>
              <strong>{formatAmount(transferRevenue)}</strong>
            </div>
            <div className="day-audit-v2-summary-row day-audit-v2-summary-row--highlight">
              <span>الكاش الفعلي</span>
              <strong>{formatAmount(manualCash)}</strong>
            </div>
            <div className="day-audit-v2-summary-row day-audit-v2-summary-row--total">
              <span>فرق الكاش النهائي</span>
              <strong className="day-audit-v2-value" data-diff={diffTone}>{formatAmount(diff)}</strong>
            </div>
          </div>

          <div className="day-audit-v2-policy">
            <strong>قاعدة الإقفال</strong>
            <p>
              التحويل البنكي يظهر في الإجمالي، لكنه لا يدخل في مقارنة الكاش الفعلي مع صندوق الاستقبال.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
