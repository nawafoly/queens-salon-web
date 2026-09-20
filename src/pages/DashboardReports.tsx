import { DashboardMonthInputV2, DashboardSelectBridgeV2 } from "../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { DashboardDatePickerV2, DashboardSelectV2 } from "../components/dashboard-v2";
import {
  faCalendarDays,
  faChartLine,
  faClockRotateLeft,
  faFileExcel,
  faFilePdf,
} from "@fortawesome/free-solid-svg-icons";
import { CoreHrService } from "../services/CoreHrService";
import {
  generatePayrollEntriesForMonths,
  type PayrollEntryView,
} from "../services/CorePayrollService";
import { listCoreBookings } from "../services/firestoreBookings";
import { listAllIncomeCore } from "../services/CoreIncomeService";
import { listAllExpensesCore } from "../services/CoreExpenseService";
import { exportFinancialOverviewReportExcel, exportFinancialOverviewReportPdf } from "../helpers/reports/exportFinancialOverviewReport";
import type { PaymentMethod } from "../types/finance";
import { financePaymentMethodLabel, formatFinanceNote } from "../helpers/financeDisplay";
import { reportsText, type DashboardLanguage } from "../helpers/dashboardReportsLanguage";
import {
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  payrollCycleRangeForMonthKey,
} from "../helpers/hr/payrollCycle";
import {
  projectCorePayrollEntriesToFinancialRows,
} from "../helpers/corePayrollFinancialRows";

type PeriodKey = "day" | "week" | "month" | "year" | "custom";
type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
type BookingPaymentType = "full" | "partial";
type IncomeSourceKind = "booking" | "invoice" | "internal" | "refund" | "other";
type IncomeStatusFilter = "all" | "active" | "refunded" | "voided";

type BookingRow = {
  id: string;
  publicId: string;
  date: string;
  time: string;
  status: BookingStatus;
  amount: number;
  totalAmount: number;
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  employeeId?: string | null;
  employeeUid?: string | null;
  employeeKey?: string | null;
  employeeName: string;
  clientName: string;
};

type IncomeRow = {
  id: string;
  date: string;
  time: string;
  amount: number;
  method: PaymentMethod;
  source: string;
  status: string;
  bookingId: string;
  note: string;
  createdAtMs: number;
};

type ExpenseRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  title: string;
  note: string;
  addedBy: string;
  createdAtMs: number;
  employeeId?: string;
  payrollMonth?: string;
  payrollKind?: "salary" | "overtime";
};

type RevenueDetailsRow = {
  id: string;
  date: string;
  time: string;
  source: IncomeSourceKind;
  mkRef: string;
  employeeName: string;
  note: string;
  amount: number;
  statusLabel: string;
};

type BookingMeta = {
  bookingRef: string;
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
  employeeName: string;
};

const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function pad2(v: number) {
  return String(v).padStart(2, "0");
}

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeIsoDate(v: any, fallbackMs?: number): string {
  const raw = String(v ?? "").trim();
  if (isIsoDate(raw)) return raw;

  const datePrefixMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (datePrefixMatch?.[1]) return datePrefixMatch[1];

  if (raw) {
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return toIsoDate(parsed);
  }

  if (Number.isFinite(Number(fallbackMs)) && Number(fallbackMs) > 0) {
    const fromFallback = new Date(Number(fallbackMs));
    if (Number.isFinite(fromFallback.getTime())) return toIsoDate(fromFallback);
  }
  return "";
}

function parseMillis(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const asNum = Number(v);
    if (Number.isFinite(asNum)) return asNum;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof v?.toMillis === "function") return Number(v.toMillis()) || 0;
  if (typeof v?.seconds === "number") {
    return Number(v.seconds) * 1000 + Math.floor(Number(v.nanoseconds || 0) / 1e6);
  }
  return 0;
}

function formatMoney(v: number, language: DashboardLanguage = "ar") {
  return `${Number(v || 0).toLocaleString("en-US")} ${language === "en" ? "SAR" : "ر.س"}`;
}

function formatDateTime(date: string, time: string) {
  const d = String(date || "").trim() || "-";
  const t = String(time || "").trim() || "-";
  return `${d} ${t}`;
}

function bookingStatusLabel(status: BookingStatus, language: DashboardLanguage = "ar") {
  if (status === "confirmed") return reportsText(language, "مؤكد");
  if (status === "completed") return reportsText(language, "مكتمل");
  if (status === "cancelled") return reportsText(language, "ملغي");
  return reportsText(language, "انتظار");
}

function sourceKind(raw: string): IncomeSourceKind {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "other";
  if (s === "booking" || s === "حجز") return "booking";
  if (s === "invoice" || s === "فاتورة") return "invoice";
  if (s === "internal_booking") return "internal";
  if (s === "manual" || s === "يدوي") return "other";
  if (s === "refund" || s === "استرجاع") return "refund";
  return "other";
}

function sourceLabel(kind: IncomeSourceKind, language: DashboardLanguage = "ar") {
  if (kind === "booking") return reportsText(language, "حجز");
  if (kind === "invoice") return reportsText(language, "فاتورة");
  if (kind === "internal") return reportsText(language, "داخلي");
  if (kind === "refund") return reportsText(language, "استرجاع");
  return reportsText(language, "دخل آخر");
}

function isBookingLinkedIncomeSource(raw: string): boolean {
  const s = String(raw || "").trim().toLowerCase();
  return (
    s === "booking" ||
    s === "invoice" ||
    s === "internal_booking" ||
    s === "حجز" ||
    s === "فاتورة"
  );
}
function normalizePaymentMethod(raw: any): PaymentMethod {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  if (s === "mixed") return "mixed";
  if (s === "other") return "other";
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق")) return "card";
  if (s.includes("تحويل")) return "transfer";
  if (s.includes("مختلط") || s.includes("mixed")) return "mixed";
  return "other";
}

function resolveIncomeReportNote(sourceRaw: string, noteText: string, language: DashboardLanguage = "ar"): string {
  if (noteText) return noteText;

  const kind = sourceKind(sourceRaw || "");
  if (kind === "booking") return reportsText(language, "سجل حجز بدون ملاحظة");
  if (kind === "invoice") return reportsText(language, "فاتورة بدون ملاحظة");
  if (kind === "internal") return reportsText(language, "دفع داخلي بدون ملاحظة");
  if (kind === "refund") return reportsText(language, "استرجاع بدون ملاحظة");

  const source = String(sourceRaw || "").trim().toLowerCase();
  if (source === "manual" || source === "يدوي") {
    return reportsText(language, "دخل يدوي بدون ملاحظة");
  }
  return reportsText(language, "دخل آخر بدون ملاحظة");
}
function toBookingRef(v?: string) {
  const raw = String(v || "").trim().toUpperCase();
  if (!raw) return "-";
  if (/^MK-\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `MK-${raw}`;
  return raw;
}

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function resolveLinkedBookingId(item: Pick<IncomeRow, "id" | "bookingId" | "source" | "amount">): string {
  const kind = sourceKind(item.source);
  if (kind === "refund" || Number(item.amount || 0) < 0 || String(item.id || "").startsWith("refund_")) {
    return "";
  }

  const explicit = String(item.bookingId || "").trim();
  if (explicit) {
    return isBookingLinkedIncomeSource(item.source) ? explicit : "";
  }

  if (kind === "booking") return String(item.id || "").trim();
  return "";
}

function isRefundIncomeRow(item: Pick<IncomeRow, "id" | "source" | "amount">): boolean {
  const kind = sourceKind(item.source);
  return kind === "refund" || Number(item.amount || 0) < 0 || String(item.id || "").startsWith("refund_");
}

function statusLabelForIncome(item: IncomeRow, language: DashboardLanguage = "ar"): string {
  const status = String(item.status || "").trim().toLowerCase();
  if (status === "active" || status === "confirmed" || status === "completed") return reportsText(language, "نشط");
  if (status === "refunded" || status === "refund") return reportsText(language, "استرجاع");
  if (status === "voided" || status === "void" || status === "cancelled" || status === "canceled") return reportsText(language, "ملغي");
  if (isRefundIncomeRow(item)) return reportsText(language, "استرجاع");
  return reportsText(language, "نشط");
}

function rowEffectiveAmount(item: IncomeRow, _bookingMetaById: Record<string, BookingMeta>) {
  // Each income row is an actual posted financial movement. Replacing it with
  // the booking paid total duplicates mixed payments and turns partial Core
  // payments into zero when the booking snapshot is stale.
  return Number(item.amount || 0);
}

function normalizePaymentType(raw: any): BookingPaymentType | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

function resolveBookingPayment(raw: any): {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
} {
  const totalAmount = Math.max(
    0,
    Number(
      raw?.finalPrice ??
        raw?.total ??
        raw?.serviceSnapshot?.priceAtBooking ??
        raw?.packageSnapshot?.finalPriceAtBooking ??
        0
    ) || 0
  );
  const normalizedType = normalizePaymentType(raw?.paymentType);
  const hasExplicitPaid = Number.isFinite(Number(raw?.paidAmount));
  const explicitPaid = hasExplicitPaid ? Number(raw?.paidAmount) : NaN;
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "partial");
  let paidAmount: number;
  if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
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

  const remainingAmount = Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100);
  return {
    paymentType,
    paidAmount: Math.round(Math.max(0, Math.min(totalAmount, paidAmount)) * 100) / 100,
    remainingAmount,
    totalAmount: Math.round(totalAmount * 100) / 100,
  };
}

function isIsoDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}

function monthKeyFromIsoDate(v: string) {
  return isIsoDate(v) ? String(v).slice(0, 7) : "";
}

function previousMonthKey(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return "";
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return "";
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function nextMonthKey(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return "";
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return "";
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthKeysBetween(fromIso: string, toIso: string): string[] {
  const from = isIsoDate(fromIso) ? fromIso : "";
  const to = isIsoDate(toIso) ? toIso : "";
  if (!from && !to) return [];
  const start = new Date(`${(from || to).slice(0, 7)}-01T00:00:00`);
  const end = new Date(`${(to || from).slice(0, 7)}-01T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  const out: string[] = [];
  const cursor = new Date(a);
  let guard = 0;
  while (cursor <= b && guard < 180) {
    out.push(`${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`);
    cursor.setMonth(cursor.getMonth() + 1);
    guard += 1;
  }
  return out;
}

function monthRangeFromKey(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || "").trim())) return null;
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { from: toIsoDate(start), to: toIsoDate(end) };
}

function getRange(period: PeriodKey, customFrom: string, customTo: string, selectedMonth: string) {
  const now = new Date();
  const today = toIsoDate(now);

  if (period === "day") return { from: today, to: today };

  if (period === "week") {
    const day = now.getDay(); // 0=Sun
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    return { from: toIsoDate(start), to: today };
  }

  if (period === "month") {
    const monthRange =
      monthRangeFromKey(String(selectedMonth || "").trim()) ||
      monthRangeFromKey(toMonthKey(now));
    return monthRange || { from: today, to: today };
  }

  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: toIsoDate(start), to: today };
  }

  const from = String(customFrom || "").trim();
  const to = String(customTo || "").trim();
  if (!from && !to) return { from: today, to: today };
  if (!from) return { from: to, to };
  if (!to) return { from, to: from };
  return from <= to ? { from, to } : { from: to, to: from };
}

function inDateRange(dateIso: string, from: string, to: string) {
  const d = normalizeIsoDate(dateIso);
  if (!d) return false;
  return d >= from && d <= to;
}

function toMonthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthLabel(monthKey: string, language: DashboardLanguage = "ar") {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
  if (language === "en") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  }
  return `${MONTHS_AR[m - 1]} ${y}`;
}

function paymentMethodLabel(method: PaymentMethod, language: DashboardLanguage = "ar") {
  if (language === "ar") return financePaymentMethodLabel(method);
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  if (method === "transfer") return "Transfer";
  if (method === "mixed") return "Mixed";
  return "Other";
}

function formatDeltaPct(v: number | null) {
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function calcDeltaPct(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function deltaClass(v: number | null) {
  if (v == null) return "is-flat";
  if (Math.abs(v) < 0.0001) return "is-flat";
  return v > 0 ? "is-up" : "is-down";
}

function niceCeil(v: number) {
  const x = Number(v || 0);
  if (x <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(x));
  const normalized = x / magnitude;
  let nice = 1;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function niceFloor(v: number) {
  const x = Number(v || 0);
  if (x >= 0) return 0;
  return -niceCeil(Math.abs(x));
}

function formatAxisNumber(v: number) {
  return Math.round(Number(v || 0)).toLocaleString("en-US");
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const span = Math.abs(endDeg - startDeg);
  // SVG arc cannot draw a full 360deg circle in a single arc command.
  if (span >= 359.999) {
    return [
      `M ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
      "Z",
    ].join(" ");
  }
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy + r * Math.sin(rad(endDeg));
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

export default function DashboardReports({ language = "ar" }: { language?: DashboardLanguage }) {
  const t = (text: string) => reportsText(language, text);
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [selectedMonth, setSelectedMonth] = useState(toMonthKey(new Date()));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [trendMode, setTrendMode] = useState<"month" | "day">("month");
  const [incomeMethodFilter, setIncomeMethodFilter] = useState<PaymentMethod | "all">("all");
  const [incomeSourceFilter, setIncomeSourceFilter] = useState<IncomeSourceKind | "all">("all");
  const [incomeStatusFilter, setIncomeStatusFilter] = useState<IncomeStatusFilter>("all");

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payrollEntries, setPayrollEntries] = useState<any[]>([]);
  const [calculatedPayrollEntries, setCalculatedPayrollEntries] = useState<PayrollEntryView[]>([]);
  const [calculatedPayrollMonthKeys, setCalculatedPayrollMonthKeys] = useState<string[]>([]);
  const [payrollCalculationLoading, setPayrollCalculationLoading] = useState(false);
  const [payrollCalculationError, setPayrollCalculationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastSyncMs, setLastSyncMs] = useState<number>(Date.now());
  const [loadErr, setLoadErr] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState("");

  const range = useMemo(
    () => getRange(period, customFrom, customTo, selectedMonth),
    [period, customFrom, customTo, selectedMonth]
  );

  useEffect(() => {
    let active = true;
    let pending = 4;
    let bookingsReady = false;
    let incomeReady = false;
    let expensesReady = false;
    let payrollReady = false;
    let refreshInFlight: Promise<void> | null = null;
    setLoading(true);
    setLoadErr("");

    const done = () => {
      pending -= 1;
      if (active && pending <= 0) setLoading(false);
    };
    const readyOnce = (key: "bookings" | "income" | "expenses" | "payroll") => {
      if (key === "bookings" && !bookingsReady) { bookingsReady = true; done(); }
      if (key === "income" && !incomeReady) { incomeReady = true; done(); }
      if (key === "expenses" && !expensesReady) { expensesReady = true; done(); }
      if (key === "payroll" && !payrollReady) { payrollReady = true; done(); }
    };
    const appendLoadError = (label: string, error: unknown) => {
      const detail = String((error as any)?.message || error || t("خطأ غير معروف"));
      const nextMessage = `${t(label)}: ${detail}`;
      setLoadErr((current) => {
        const messages = current
          .split(" | ")
          .map((item) => item.trim())
          .filter(Boolean);
        return messages.includes(nextMessage)
          ? current
          : [...messages, nextMessage].join(" | ");
      });
    };

    const loadBookingsData = async () => {
      try {
        const data = await listCoreBookings();
        if (!active) return;
        const rows: BookingRow[] = data.map((raw: any) => {
          const createdAtMs = parseMillis(raw?.createdAt || raw?.createdAtMs || raw?.updatedAt);
          const payment = resolveBookingPayment(raw);
          return {
            id: String(raw?.id || "").trim(),
            publicId: String(raw?.publicId || raw?.trackPublicId || "").trim(),
            date: normalizeIsoDate(raw?.date, createdAtMs),
            time: String(raw?.time || raw?.startTime || "").trim(),
            status: String(raw?.status || "pending").trim().toLowerCase() as BookingStatus,
            amount: payment.paidAmount,
            totalAmount: payment.totalAmount,
            paymentType: payment.paymentType,
            paidAmount: payment.paidAmount,
            remainingAmount: payment.remainingAmount,
            employeeId: String(raw?.employeeId || "").trim() || null,
            employeeUid: String(raw?.employeeUid || "").trim() || null,
            employeeKey: String(raw?.employeeKey || "").trim() || null,
            employeeName: String(raw?.employeeName || "").trim(),
            clientName: String(raw?.clientName || raw?.name || raw?.customerName || "").trim(),
          };
        });
        setBookings(rows);
        setLastSyncMs(Date.now());
      } catch (error) {
        if (active) appendLoadError("تعذر تحميل الحجوزات", error);
      } finally {
        if (active) readyOnce("bookings");
      }
    };

    const loadIncomeData = async () => {
      try {
        const data = await listAllIncomeCore();
        if (!active) return;
        const rows: IncomeRow[] = data.map((raw: any) => {
          const createdAtMs = parseMillis(raw?.createdAt);
          return {
            id: String(raw?.id || "").trim(),
            date: normalizeIsoDate(raw?.date, createdAtMs),
            time: createdAtMs ? new Intl.DateTimeFormat("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }).format(new Date(createdAtMs)) : "",
            amount: Number(raw?.amount ?? 0) || 0,
            method: normalizePaymentMethod(raw?.method),
            source: String(raw?.source || "").trim(),
            status: String(raw?.status || "").trim().toLowerCase(),
            bookingId: String(raw?.bookingId || "").trim(),
            note: String(raw?.note || "").trim(),
            createdAtMs,
          };
        });
        setIncomeRows(rows);
        setLastSyncMs(Date.now());
      } catch (error) {
        if (active) appendLoadError("تعذر تحميل الإيرادات", error);
      } finally {
        if (active) readyOnce("income");
      }
    };

    const loadExpensesData = async () => {
      try {
        const data = await listAllExpensesCore();
        if (!active) return;
        const rows: ExpenseRow[] = data.map((raw: any) => {
          const createdAtMs = parseMillis(raw?.createdAt);
          return {
            id: String(raw?.id || "").trim(),
            date: normalizeIsoDate(raw?.date, createdAtMs),
            amount: Number(raw?.amount ?? 0) || 0,
            category: String(raw?.category || "أخرى").trim() || "أخرى",
            title: String(raw?.title || "").trim(),
            note: String(raw?.note || "").trim(),
            addedBy: String(raw?.createdByName || raw?.addedBy || raw?.createdBy || "الإدارة").trim() || "الإدارة",
            createdAtMs,
          };
        });
        setExpenses(rows);
        setLastSyncMs(Date.now());
      } catch (error) {
        if (active) appendLoadError("تعذر تحميل المصروفات", error);
      } finally {
        if (active) readyOnce("expenses");
      }
    };

    const refreshFinancialData = () => {
      if (!active || refreshInFlight) return refreshInFlight;
      refreshInFlight = Promise.all([
        loadBookingsData(),
        loadIncomeData(),
        loadExpensesData(),
      ]).then(() => undefined).finally(() => {
        refreshInFlight = null;
      });
      return refreshInFlight;
    };
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refreshFinancialData();
    };

    void refreshFinancialData();
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    const loadPayrollEntriesData = async () => {
      try {
        const rows = await CoreHrService.listPayrollEntries();
        if (!active) return;
        setPayrollEntries(Array.isArray(rows) ? rows : []);
        setLastSyncMs(Date.now());
      } catch (error) {
        if (active) appendLoadError("تعذر تحميل كشوف الرواتب", error);
      } finally {
        if (active) readyOnce("payroll");
      }
    };

    void loadPayrollEntriesData();

    return () => {
      active = false;
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, []);

  const requestedPayrollMonthKeys = useMemo(() => {
    const keys = new Set(monthKeysBetween(range.from, range.to));
    const fromCycleKey = payrollCycleKeyFromDate(range.from, PAYROLL_CLOSE_DAY);
    const toCycleKey = payrollCycleKeyFromDate(range.to, PAYROLL_CLOSE_DAY);
    if (fromCycleKey) keys.add(fromCycleKey);
    if (toCycleKey) keys.add(toCycleKey);
    if (period === "month" && /^\d{4}-\d{2}$/.test(selectedMonth)) {
      keys.add(selectedMonth);
    }
    return Array.from(keys).sort((left, right) => left.localeCompare(right));
  }, [period, range.from, range.to, selectedMonth]);

  const requestedPayrollMonthKeysSignature = requestedPayrollMonthKeys.join(",");

  useEffect(() => {
    let active = true;
    if (!requestedPayrollMonthKeys.length) {
      setCalculatedPayrollEntries([]);
      setCalculatedPayrollMonthKeys([]);
      setPayrollCalculationError("");
      return () => {
        active = false;
      };
    }

    setPayrollCalculationLoading(true);
    setPayrollCalculationError("");
    void generatePayrollEntriesForMonths({ monthKeys: requestedPayrollMonthKeys })
      .then((entries) => {
        if (!active) return;
        setCalculatedPayrollEntries(entries);
        setCalculatedPayrollMonthKeys(requestedPayrollMonthKeys);
        setLastSyncMs(Date.now());
      })
      .catch((error) => {
        if (!active) return;
        setCalculatedPayrollEntries([]);
        setCalculatedPayrollMonthKeys([]);
        setPayrollCalculationError(String((error as any)?.message || error || t("خطأ غير معروف")));
      })
      .finally(() => {
        if (active) setPayrollCalculationLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestedPayrollMonthKeysSignature]);

  const bookingById = useMemo(() => {
    const map: Record<string, BookingRow> = {};
    bookings.forEach((b) => {
      map[b.id] = b;
    });
    return map;
  }, [bookings]);

  const incomeEffectiveDate = (item: IncomeRow): string => {
    const linkedBookingId = resolveLinkedBookingId(item);
    const bookingDate = linkedBookingId ? String(bookingById[linkedBookingId]?.date || "").trim() : "";
    if (isIsoDate(bookingDate)) return bookingDate;
    const rowDate = String(item.date || "").trim();
    return isIsoDate(rowDate) ? rowDate : "";
  };

  const bookingMetaById = useMemo(() => {
    const map: Record<string, BookingMeta> = {};
    bookings.forEach((b) => {
      map[String(b.id)] = {
        bookingRef: toBookingRef(String(b.publicId || "")),
        paymentType: b.paymentType,
        paidAmount: round2(Number(b.paidAmount || 0)),
        remainingAmount: round2(Number(b.remainingAmount || 0)),
        totalAmount: round2(Number(b.totalAmount || 0)),
        employeeName: String(b.employeeName || "").trim(),
      };
    });
    return map;
  }, [bookings]);

  const incomeRowsInRange = useMemo(() => {
    return incomeRows.filter((x) => {
      const effectiveDate = incomeEffectiveDate(x);
      if (!inDateRange(effectiveDate, range.from, range.to)) return false;
      if (incomeMethodFilter !== "all" && x.method !== incomeMethodFilter) return false;
      const kind = sourceKind(x.source);
      if (incomeSourceFilter !== "all" && kind !== incomeSourceFilter) return false;
      if (incomeStatusFilter === "refunded" && !isRefundIncomeRow(x)) return false;
      if (incomeStatusFilter === "active") {
        const st = String(x.status || "").trim().toLowerCase();
        const isVoided = st === "voided" || st === "void" || st === "cancelled" || st === "canceled";
        if (isRefundIncomeRow(x) || isVoided) return false;
      }
      if (incomeStatusFilter === "voided") {
        const st = String(x.status || "").trim().toLowerCase();
        const isVoided = st === "voided" || st === "void" || st === "cancelled" || st === "canceled";
        if (!isVoided) return false;
      }
      return true;
    });
  }, [incomeRows, range.from, range.to, incomeMethodFilter, incomeSourceFilter, incomeStatusFilter, bookingById]);

  const recordedPayrollExpenses = useMemo<ExpenseRow[]>(
    () =>
      projectCorePayrollEntriesToFinancialRows(
        payrollEntries,
        "recorded"
      ),
    [payrollEntries]
  );

  const calculatedPayrollExpenses = useMemo<ExpenseRow[]>(
    () =>
      projectCorePayrollEntriesToFinancialRows(
        calculatedPayrollEntries,
        "calculated"
      ),
    [calculatedPayrollEntries]
  );

  const calculatedPayrollMonthKeySet = useMemo(
    () => new Set(calculatedPayrollMonthKeys),
    [calculatedPayrollMonthKeys]
  );

  const effectiveRecordedPayrollExpenses = useMemo(
    () =>
      recordedPayrollExpenses.filter((row) => {
        const monthKey = String(row.payrollMonth || "").trim();
        return !monthKey || !calculatedPayrollMonthKeySet.has(monthKey);
      }),
    [recordedPayrollExpenses, calculatedPayrollMonthKeySet]
  );

  const expensesWithPayroll = useMemo(() => {
    const map = new Map<string, ExpenseRow>();
    [
      ...expenses,
      ...effectiveRecordedPayrollExpenses,
      ...calculatedPayrollExpenses,
    ].forEach((x) => {
      const id = String(x?.id || "").trim();
      if (!id) return;
      map.set(id, x);
    });
    return Array.from(map.values());
  }, [
    expenses,
    effectiveRecordedPayrollExpenses,
    calculatedPayrollExpenses,
  ]);

  const expensesInRange = useMemo(
    () => expensesWithPayroll.filter((x) => inDateRange(x.date, range.from, range.to)),
    [expensesWithPayroll, range.from, range.to]
  );

  const payrollCycleMonthKey = useMemo(() => {
    if (period === "month" && /^\d{4}-\d{2}$/.test(String(selectedMonth || "").trim())) {
      return String(selectedMonth || "").trim();
    }
    return monthKeyFromIsoDate(String(range.to || "").trim()) || toMonthKey(new Date());
  }, [period, selectedMonth, range.to]);

  const payrollCycleRange = useMemo(() => {
    return (
      payrollCycleRangeForMonthKey(payrollCycleMonthKey, PAYROLL_CLOSE_DAY) || {
        from: range.from,
        to: range.to,
      }
    );
  }, [payrollCycleMonthKey, range.from, range.to]);

  const expensesInPayrollCycle = useMemo(
    () =>
      expensesWithPayroll.filter((x) =>
        inDateRange(x.date, payrollCycleRange.from, payrollCycleRange.to)
      ),
    [expensesWithPayroll, payrollCycleRange.from, payrollCycleRange.to]
  );

  const payrollCycleTotals = useMemo(() => {
    let salary = 0;
    let overtime = 0;
    let other = 0;
    expensesInPayrollCycle.forEach((row) => {
      const amount = Number(row.amount || 0);
      const id = String(row.id || "");
      if (id.startsWith("auto_payroll_salary_")) {
        salary += amount;
        return;
      }
      if (id.startsWith("auto_payroll_overtime_")) {
        overtime += amount;
        return;
      }
      other += amount;
    });
    return {
      cycleKey:
        payrollCycleKeyFromDate(payrollCycleRange.to, PAYROLL_CLOSE_DAY) || payrollCycleMonthKey,
      salary,
      overtime,
      other,
      total: salary + overtime + other,
    };
  }, [expensesInPayrollCycle, payrollCycleRange.to, payrollCycleMonthKey]);

  const revenueRowsDetailed = useMemo<RevenueDetailsRow[]>(() => {
    return incomeRowsInRange
      .map((x) => {
        const kind = sourceKind(x.source);
        const linkedBookingId = resolveLinkedBookingId(x);
        const linkedBooking = linkedBookingId ? bookingById[linkedBookingId] : undefined;
        const linkedMeta = linkedBookingId ? bookingMetaById[linkedBookingId] : undefined;
        const noteText = formatFinanceNote(x.note);
        const displayNote = resolveIncomeReportNote(x.source, noteText, language);
        return {
          id: `income_${x.id}`,
          date: incomeEffectiveDate(x),
          time: x.time || "-",
          source: kind,
          mkRef: linkedMeta?.bookingRef || toBookingRef(linkedBooking?.publicId),
          employeeName:
            String(linkedMeta?.employeeName || linkedBooking?.employeeName || "").trim() || "-",
          note: displayNote,
          amount: rowEffectiveAmount(x, bookingMetaById),
          statusLabel: statusLabelForIncome(x, language),
        };
      })
      .sort((a, b) => {
        const aKey = `${a.date} ${a.time}`;
        const bKey = `${b.date} ${b.time}`;
        return bKey.localeCompare(aKey);
      });
  }, [incomeRowsInRange, bookingById, bookingMetaById, language]);

  const totals = useMemo(() => {
    const revenue = revenueRowsDetailed.reduce((s, x) => s + Number(x.amount || 0), 0);
    const expensesTotal = expensesInRange.reduce((s, x) => s + Number(x.amount || 0), 0);
    const net = revenue - expensesTotal;
    return { revenue, expenses: expensesTotal, net };
  }, [revenueRowsDetailed, expensesInRange]);

  const monthCompare = useMemo(() => {
    const monthFromRange = monthKeyFromIsoDate(String(range.to || "").trim());
    const monthFromPicker = String(selectedMonth || "").trim();
    const currentKey =
      period === "month" && /^\d{4}-\d{2}$/.test(monthFromPicker)
        ? monthFromPicker
        : monthFromRange || toMonthKey(new Date());
    const previousKey = previousMonthKey(currentKey) || currentKey;

    const filteredIncomeByMonth = (key: string) =>
      incomeRows.filter((x) => {
        if (!incomeEffectiveDate(x).startsWith(`${key}-`)) return false;
        if (incomeMethodFilter !== "all" && x.method !== incomeMethodFilter) return false;
        const kind = sourceKind(x.source);
        if (incomeSourceFilter !== "all" && kind !== incomeSourceFilter) return false;
        if (incomeStatusFilter === "refunded" && !isRefundIncomeRow(x)) return false;
        if (incomeStatusFilter === "active") {
          const st = String(x.status || "").trim().toLowerCase();
          const isVoided = st === "voided" || st === "void" || st === "cancelled" || st === "canceled";
          if (isRefundIncomeRow(x) || isVoided) return false;
        }
        if (incomeStatusFilter === "voided") {
          const st = String(x.status || "").trim().toLowerCase();
          const isVoided = st === "voided" || st === "void" || st === "cancelled" || st === "canceled";
          if (!isVoided) return false;
        }
        return true;
      });

    const incomeRevenueByMonth = (key: string) =>
      filteredIncomeByMonth(key).reduce((s, x) => s + rowEffectiveAmount(x, bookingMetaById), 0);

    const expensesByMonth = (key: string) =>
      expensesWithPayroll
        .filter((x) => String(x.date || "").startsWith(`${key}-`))
        .reduce((s, x) => s + Number(x.amount || 0), 0);

    const currentRevenue = incomeRevenueByMonth(currentKey);
    const previousRevenue = incomeRevenueByMonth(previousKey);

    const currentExpenses = expensesByMonth(currentKey);
    const previousExpenses = expensesByMonth(previousKey);

    const currentNet = currentRevenue - currentExpenses;
    const previousNet = previousRevenue - previousExpenses;

    return {
      currentLabel: monthLabel(currentKey, language),
      previousLabel: monthLabel(previousKey, language),
      current: {
        revenue: currentRevenue,
        expenses: currentExpenses,
        net: currentNet,
      },
      previous: {
        revenue: previousRevenue,
        expenses: previousExpenses,
        net: previousNet,
      },
      delta: {
        revenue: calcDeltaPct(currentRevenue, previousRevenue),
        expenses: calcDeltaPct(currentExpenses, previousExpenses),
        net: calcDeltaPct(currentNet, previousNet),
      },
    };
  }, [
    period,
    selectedMonth,
    range.to,
    incomeRows,
    expensesWithPayroll,
    bookingById,
    bookingMetaById,
    incomeMethodFilter,
    incomeSourceFilter,
    incomeStatusFilter,
    language,
  ]);

  const chartsModel = useMemo(() => {
    const selectedYear = Number(String(range.to || "").slice(0, 4)) || new Date().getFullYear();
    let points: Array<{ key: string; label: string; returns: number; investments: number }> = [];

    if (trendMode === "month") {
      const returnsMonthly = new Array(12).fill(0);
      const investmentsMonthly = new Array(12).fill(0);

      revenueRowsDetailed.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d || !d.startsWith(`${selectedYear}-`)) return;
        const monthIdx = Number(d.slice(5, 7)) - 1;
        if (monthIdx < 0 || monthIdx > 11) return;
        returnsMonthly[monthIdx] += Number(row.amount || 0);
      });

      expensesInRange.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d || !d.startsWith(`${selectedYear}-`)) return;
        const monthIdx = Number(d.slice(5, 7)) - 1;
        if (monthIdx < 0 || monthIdx > 11) return;
        investmentsMonthly[monthIdx] += Number(row.amount || 0);
      });

      points = MONTHS_AR.map((m, i) => ({
        key: `${selectedYear}-${pad2(i + 1)}`,
        label: t(m),
        returns: returnsMonthly[i],
        investments: investmentsMonthly[i],
      }));
    } else {
      const from = String(range.from || "").trim();
      const to = String(range.to || "").trim();
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00`) : new Date();
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00`) : fromDate;
      const start = fromDate <= toDate ? fromDate : toDate;
      const end = fromDate <= toDate ? toDate : fromDate;
      const dayKeys: string[] = [];
      const cursor = new Date(start);
      while (cursor <= end && dayKeys.length < 800) {
        dayKeys.push(toIsoDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      if (!dayKeys.length) dayKeys.push(toIsoDate(new Date()));

      const returnsByDay: Record<string, number> = {};
      const investmentsByDay: Record<string, number> = {};
      revenueRowsDetailed.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d) return;
        returnsByDay[d] = (returnsByDay[d] || 0) + Number(row.amount || 0);
      });
      expensesInRange.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d) return;
        investmentsByDay[d] = (investmentsByDay[d] || 0) + Number(row.amount || 0);
      });

      const hasMultiYear = dayKeys.some((d) => d.slice(0, 4) !== dayKeys[0].slice(0, 4));
      points = dayKeys.map((d) => ({
        key: d,
        label: hasMultiYear ? d.slice(2) : d.slice(5),
        returns: Number(returnsByDay[d] || 0),
        investments: Number(investmentsByDay[d] || 0),
      }));
    }

    const returnsSeries = points.map((p) => p.returns);
    const investmentsSeries = points.map((p) => p.investments);
    const denom = Math.max(1, points.length - 1);
    const maxRaw = Math.max(0, ...returnsSeries, ...investmentsSeries);
    const minRaw = Math.min(0, ...returnsSeries, ...investmentsSeries);
    const maxY = niceCeil(Math.max(4, maxRaw));
    const minY = niceFloor(minRaw);
    const spanY = Math.max(1, maxY - minY);
    const yTicks = Array.from({ length: 5 }, (_, i) => Math.round(maxY - (spanY * i) / 4));
    const topWidth = 860;
    const topHeight = 310;
    const padR = 20;
    const padT = 28;
    const padB = 40;
    const longestTickLabel = yTicks.reduce((max, v) => {
      const len = formatAxisNumber(v).length;
      return len > max ? len : max;
    }, 1);
    const padL = Math.max(72, 20 + longestTickLabel * 9);
    const plotW = topWidth - padL - padR;
    const plotH = topHeight - padT - padB;
    const xOf = (i: number) => padL + (i * plotW) / denom;
    const yOf = (v: number) => padT + plotH - ((v - minY) / spanY) * plotH;
    const toPath = (series: number[]) =>
      series
        .map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(2)} ${yOf(v).toFixed(2)}`)
        .join(" ");

    const statusOrder: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
    const statusLabel: Record<BookingStatus, string> = {
      pending: t("نشط"),
      confirmed: t("مؤكد"),
      completed: t("مكتمل"),
      cancelled: t("مرفوض"),
    };
    const statusCount: Record<BookingStatus, number> = {
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
    };
    bookings
      .filter((b) => inDateRange(b.date, range.from, range.to))
      .forEach((b) => {
        const s = statusOrder.includes(b.status) ? b.status : "pending";
        statusCount[s] += 1;
      });
    const statusBars = statusOrder.map((k) => ({
      key: k,
      label: statusLabel[k],
      value: statusCount[k],
    }));

    const sourceRaw: Array<{ label: string; key: IncomeSourceKind; value: number }> = [
      { label: sourceLabel("booking", language), key: "booking", value: 0 },
      { label: sourceLabel("invoice", language), key: "invoice", value: 0 },
      { label: sourceLabel("internal", language), key: "internal", value: 0 },
      { label: sourceLabel("refund", language), key: "refund", value: 0 },
      { label: sourceLabel("other", language), key: "other", value: 0 },
    ];
    revenueRowsDetailed.forEach((x) => {
      const row = sourceRaw.find((it) => it.key === x.source);
      if (!row) return;
      row.value += 1;
    });
    const sourceTotal = sourceRaw.reduce((s, x) => s + x.value, 0);
    const pie = sourceRaw.filter((x) => x.value > 0);
    const pieTotal = pie.reduce((s, x) => s + x.value, 0);
    let cursor = -90;
    const pieSlices = pie.map((item) => {
      const delta = (item.value / pieTotal) * 360;
      const start = cursor;
      const end = cursor + delta;
      cursor = end;
      return {
        ...item,
        start,
        end,
      };
    });

    return {
      selectedYear,
      topWidth,
      topHeight,
      padL,
      padR,
      padT,
      padB,
      xOf,
      yOf,
      maxY,
      yTicks,
      returnsPath: toPath(returnsSeries),
      investmentsPath: toPath(investmentsSeries),
      points,
      xTickStride: Math.max(1, Math.ceil(points.length / 12)),
      statusBars,
      statusMax: Math.max(4, ...statusBars.map((x) => x.value)),
      pieSlices,
      sourceTotal,
    };
  }, [trendMode, revenueRowsDetailed, expensesInRange, bookings, range.from, range.to, language]);

  const lastSyncLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(lastSyncMs)),
    [language, lastSyncMs]
  );

  const buildFinancialOverviewReportInput = () => ({
    language,
    revenueRows: revenueRowsDetailed.map((row) => ({
      date: row.date,
      time: row.time,
      source: sourceLabel(row.source, language),
      mkRef: row.mkRef,
      employeeName: row.employeeName,
      note: row.note,
      amount: row.amount,
      statusLabel: row.statusLabel,
    })),
    expenseRows: expensesInRange.map((row) => ({
      date: row.date,
      category: t(row.category || "أخرى"),
      title: row.title || row.note || "-",
      amount: row.amount,
      addedBy: row.addedBy === "الإدارة" ? t("الإدارة") : row.addedBy,
      note: row.note,
    })),
    trendRows: chartsModel.points.map((point) => ({
      label: point.label,
      returns: point.returns,
      investments: point.investments,
    })),
    filters: {
      fromDate: range.from,
      toDate: range.to,
      periodLabel: period,
      incomeMethod: incomeMethodFilter === "all" ? t("الكل") : paymentMethodLabel(incomeMethodFilter, language),
      incomeSource: incomeSourceFilter === "all" ? t("الكل") : sourceLabel(incomeSourceFilter, language),
      incomeStatus: incomeStatusFilter,
    },
    payrollCycle: {
      cycleKey: payrollCycleTotals.cycleKey,
      fromDate: payrollCycleRange.from,
      toDate: payrollCycleRange.to,
      salary: payrollCycleTotals.salary,
      overtime: payrollCycleTotals.overtime,
      other: payrollCycleTotals.other,
      total: payrollCycleTotals.total,
    },
    generatedBy: t("لوحة التقارير العامة"),
  });

  const exportFinancialPdf = async () => {
    if (exporting) return;
    setExportError("");
    setExporting("pdf");
    try {
      await exportFinancialOverviewReportPdf(buildFinancialOverviewReportInput());
    } catch (error) {
      console.error("Financial PDF export failed", error);
      setExportError(t("تعذر إنشاء ملف PDF. أعد المحاولة بعد اكتمال تحميل البيانات."));
    } finally {
      setExporting(null);
    }
  };

  const exportFinancialExcel = () => {
    if (exporting) return;
    setExportError("");
    setExporting("excel");
    try {
      exportFinancialOverviewReportExcel(buildFinancialOverviewReportInput());
    } catch (error) {
      console.error("Financial Excel export failed", error);
      setExportError(t("تعذر إنشاء ملف Excel. أعد المحاولة بعد اكتمال تحميل البيانات."));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="dsv2-page dsv2-reports-page reports-v2">
      <header className="dsv2-card dsv2-card--padded dsv2-card--elevated reports-v2__header">
        <div>
          <span className="dsv2-badge dsv2-badge--gold">التحليل المالي</span>
          <h1 className="dsv2-page-title">اللوحة المالية</h1>
          <p className="dsv2-page-subtitle">
            متابعة موحدة للإيرادات والمصروفات وصافي الربح، مع المقارنات الزمنية ودورة الرواتب
            والتفاصيل المطابقة للفلاتر الحالية. العرض الشهري تقويمي، بينما تُعرض دورة الرواتب
            المحاسبية للفترة من يوم 28 إلى يوم 27.
          </p>
          <small className="reports-v2__sync">
            <FontAwesomeIcon icon={faClockRotateLeft} /> آخر مزامنة: {lastSyncLabel}
          </small>
          <div className="reports-v2__export-panel">
            <div className="reports-v2__export-copy">
              <strong>تصدير التقرير الكامل</strong>
              <span>الملخص، الفلاتر، دورة الرواتب، الإيرادات والمصروفات</span>
            </div>
            <div className="reports-v2__export-actions">
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger reports-btn reports-btn--pdf"
                onClick={exportFinancialPdf}
                disabled={loading || payrollCalculationLoading || exporting !== null}
              >
                <FontAwesomeIcon icon={faFilePdf} />
                {exporting === "pdf" ? "جاري تجهيز PDF..." : "تصدير PDF"}
              </button>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--success reports-btn reports-btn--excel"
                onClick={exportFinancialExcel}
                disabled={loading || payrollCalculationLoading || exporting !== null}
              >
                <FontAwesomeIcon icon={faFileExcel} />
                {exporting === "excel" ? "جاري تجهيز Excel..." : "تصدير Excel"}
              </button>
            </div>
            {exportError ? (
              <span className="reports-v2__export-error" role="alert">
                {exportError}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <section className="dsv2-card dsv2-card--padded reports-v2__filters">
        <button
          className={`f-btn ${period === "day" ? "is-active" : ""}`}
          onClick={() => setPeriod("day")}
          type="button"
        >
          اليوم
        </button>
        <button
          className={`f-btn ${period === "week" ? "is-active" : ""}`}
          onClick={() => setPeriod("week")}
          type="button"
        >
          هذا الأسبوع
        </button>
        <button
          className={`f-btn ${period === "month" ? "is-active" : ""}`}
          onClick={() => setPeriod("month")}
          type="button"
        >
          هذا الشهر
        </button>
        <button
          className={`f-btn ${period === "year" ? "is-active" : ""}`}
          onClick={() => setPeriod("year")}
          type="button"
        >
          هذه السنة
        </button>
        <button
          className={`f-btn ${period === "custom" ? "is-active" : ""}`}
          onClick={() => setPeriod("custom")}
          type="button"
        >
          فترة مخصصة
        </button>

        {period === "month" && (
          <div className="reports-v2__custom-range">
            <label>
              الشهر
              <DashboardMonthInputV2 value={selectedMonth} onChange={(e) => { const next = String(e.target.value || "").trim(); if (/^\d{4}-\d{2}$/.test(next)) setSelectedMonth(next); }} />
            </label>
          </div>
        )}

        {period === "custom" && (
          <div className="reports-v2__custom-range">
            <label>
              من
              <DashboardDatePickerV2 value={customFrom} onChange={setCustomFrom} />
            </label>
            <label>
              إلى
              <DashboardDatePickerV2 value={customTo} onChange={setCustomTo} />
            </label>
          </div>
        )}

        <div className="reports-v2__custom-range">
          <label>
            طريقة الدفع
            <DashboardSelectBridgeV2
              value={incomeMethodFilter}
              onChange={(e) => setIncomeMethodFilter(e.target.value as PaymentMethod | "all")}
            >
              <option value="all">الكل</option>
              <option value="cash">كاش</option>
              <option value="card">شبكة</option>
              <option value="transfer">تحويل</option>
              <option value="mixed">مختلط</option>
              <option value="other">أخرى</option>
            </DashboardSelectBridgeV2>
          </label>
          <label>
            المصدر
            <DashboardSelectBridgeV2
              value={incomeSourceFilter}
              onChange={(e) => setIncomeSourceFilter(e.target.value as IncomeSourceKind | "all")}
            >
              <option value="all">الكل</option>
              <option value="booking">حجز</option>
              <option value="invoice">فاتورة</option>
              <option value="internal">داخلي</option>
              <option value="refund">استرجاع</option>
              <option value="other">دخل آخر</option>
            </DashboardSelectBridgeV2>
          </label>
          <label>
            الحالة
            <DashboardSelectBridgeV2
              value={incomeStatusFilter}
              onChange={(e) => setIncomeStatusFilter(e.target.value as IncomeStatusFilter)}
            >
              <option value="all">الكل</option>
              <option value="active">نشط</option>
              <option value="refunded">مسترجع</option>
              <option value="voided">ملغي/Voided</option>
            </DashboardSelectBridgeV2>
          </label>
        </div>

        <div className="reports-v2__range-caption">
          <FontAwesomeIcon icon={faCalendarDays} /> الفترة: {range.from} إلى {range.to}
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded reports-v2__payroll-cycle">
        <div className="section-head">
          <h2>دورة الرواتب (28-27)</h2>
          <span>الإغلاق المحاسبي ثابت يوم {PAYROLL_CLOSE_DAY}</span>
        </div>
        <div className="reports-v2__payroll-cycle-grid">
          <article className="payroll-chip">
            <h4>الدورة</h4>
            <strong>{payrollCycleTotals.cycleKey}</strong>
            <p>
              من {payrollCycleRange.from} إلى {payrollCycleRange.to}
            </p>
          </article>
          <article className="payroll-chip">
            <h4>رواتب</h4>
            <strong>{formatMoney(payrollCycleTotals.salary)}</strong>
            <p>صافي مسير جميع الموظفات بعد الإضافات والخصومات</p>
          </article>
          <article className="payroll-chip">
            <h4>أوفر تايم</h4>
            <strong>{formatMoney(payrollCycleTotals.overtime)}</strong>
            <p>مسجل يوميًا بتاريخ يومه الفعلي</p>
          </article>
          <article className="payroll-chip">
            <h4>مصروفات أخرى</h4>
            <strong>{formatMoney(payrollCycleTotals.other)}</strong>
            <p>باقي المصروفات</p>
          </article>
        </div>
      </section>

      <div className="dsv2-grid--metrics reports-v2__kpis">
        <article className="dsv2-metric-card dsv2-metric-card--success kpi kpi-revenue">
          <h3 className="dsv2-metric-card__label">إجمالي الإيرادات</h3>
          <strong className="dsv2-metric-card__value">{formatMoney(totals.revenue)}</strong>
          <span className="dsv2-metric-card__meta">حسب الفترة والفلاتر الحالية</span>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--danger kpi kpi-expense">
          <h3 className="dsv2-metric-card__label">إجمالي المصروفات</h3>
          <strong className="dsv2-metric-card__value">{formatMoney(totals.expenses)}</strong>
          <span className="dsv2-metric-card__meta">المصروفات المسجلة داخل الفترة</span>
        </article>
        <article className={`dsv2-metric-card ${totals.net >= 0 ? "dsv2-metric-card--gold is-positive" : "dsv2-metric-card--danger is-negative"} kpi kpi-net`}>
          <h3 className="dsv2-metric-card__label">صافي الربح / الخسارة</h3>
          <strong className="dsv2-metric-card__value">{formatMoney(totals.net)}</strong>
          <span className="dsv2-metric-card__meta">الإيرادات بعد خصم المصروفات</span>
        </article>
      </div>

      <section className="dsv2-card dsv2-card--padded reports-v2__month-compare">
        <div className="section-head">
          <h2>مقارنة الأشهر (تقويميًا) - {monthCompare.currentLabel} مقابل {monthCompare.previousLabel}</h2>
        </div>
        <div className="month-compare-grid">
          <article className="month-compare-card">
            <h4>الإيرادات</h4>
            <div className="month-compare-row">
              <span>{monthCompare.currentLabel}</span>
              <b>{formatMoney(monthCompare.current.revenue)}</b>
            </div>
            <div className="month-compare-row">
              <span>{monthCompare.previousLabel}</span>
              <b>{formatMoney(monthCompare.previous.revenue)}</b>
            </div>
            <div className={`month-compare-delta ${deltaClass(monthCompare.delta.revenue)}`}>
              {formatDeltaPct(monthCompare.delta.revenue)}
            </div>
          </article>

          <article className="month-compare-card">
            <h4>المصروفات</h4>
            <div className="month-compare-row">
              <span>{monthCompare.currentLabel}</span>
              <b>{formatMoney(monthCompare.current.expenses)}</b>
            </div>
            <div className="month-compare-row">
              <span>{monthCompare.previousLabel}</span>
              <b>{formatMoney(monthCompare.previous.expenses)}</b>
            </div>
            <div className={`month-compare-delta ${deltaClass(monthCompare.delta.expenses)}`}>
              {formatDeltaPct(monthCompare.delta.expenses)}
            </div>
          </article>

          <article className="month-compare-card">
            <h4>صافي الربح</h4>
            <div className="month-compare-row">
              <span>{monthCompare.currentLabel}</span>
              <b>{formatMoney(monthCompare.current.net)}</b>
            </div>
            <div className="month-compare-row">
              <span>{monthCompare.previousLabel}</span>
              <b>{formatMoney(monthCompare.previous.net)}</b>
            </div>
            <div className={`month-compare-delta ${deltaClass(monthCompare.delta.net)}`}>
              {formatDeltaPct(monthCompare.delta.net)}
            </div>
          </article>
        </div>
      </section>

      <section className="reports-v2__charts-board reports-charts-v2">
        <article className="dsv2-card dsv2-card--padded chart-card chart-card--wide chart-card--trend">
          <div className="chart-card__head chart-card__head--modern">
            <div className="chart-title-block">
              <span className="chart-eyebrow">التحليل المالي</span>
              <h2>
                اتجاه التدفقات {trendMode === "month" ? "الشهرية" : "اليومية"}
                {trendMode === "month" ? ` (${chartsModel.selectedYear})` : ""}
              </h2>
              <p>مقارنة الإيرادات والمصروفات خلال الفترة المحددة</p>
            </div>

            <div className="chart-head-tools">
              <div className="chart-summary-pills" aria-label="ملخص الرسم">
                <span className="chart-summary-pill chart-summary-pill--returns">
                  <small>الإيرادات</small>
                  <b>
                    {formatMoney(
                      chartsModel.points.reduce(
                        (sum, point) => sum + Number(point.returns || 0),
                        0
                      )
                    )}
                  </b>
                </span>
                <span className="chart-summary-pill chart-summary-pill--expenses">
                  <small>المصروفات</small>
                  <b>
                    {formatMoney(
                      chartsModel.points.reduce(
                        (sum, point) => sum + Number(point.investments || 0),
                        0
                      )
                    )}
                  </b>
                </span>
              </div>

              <div className="chart-switch" dir="rtl" aria-label="نطاق الرسم">
                <button
                  type="button"
                  className={`chart-switch__btn ${trendMode === "day" ? "is-active" : ""}`}
                  onClick={() => setTrendMode("day")}
                >
                  يومي
                </button>
                <button
                  type="button"
                  className={`chart-switch__btn ${trendMode === "month" ? "is-active" : ""}`}
                  onClick={() => setTrendMode("month")}
                >
                  شهري
                </button>
              </div>
            </div>
          </div>

          <div className="top-chart-wrap top-chart-wrap--modern">
            <svg
              viewBox={`0 0 ${chartsModel.topWidth} ${chartsModel.topHeight}`}
              className="top-chart top-chart--modern"
              preserveAspectRatio="none"
              role="img"
              aria-label="رسم اتجاه الإيرادات والمصروفات"
            >
              {chartsModel.yTicks.map((tickVal, i) => {
                const y =
                  chartsModel.padT +
                  ((chartsModel.topHeight - chartsModel.padT - chartsModel.padB) * i) / 4;
                return (
                  <g key={`yg_${i}`}>
                    <line
                      x1={chartsModel.padL}
                      y1={y}
                      x2={chartsModel.topWidth - chartsModel.padR}
                      y2={y}
                      className="grid-line grid-line--horizontal"
                    />
                    <text
                      x={chartsModel.padL - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="axis-y"
                    >
                      {formatAxisNumber(tickVal)}
                    </text>
                  </g>
                );
              })}

              {chartsModel.points.map((point, i) => (
                <g key={`x_${point.key}`}>
                  <line
                    x1={chartsModel.xOf(i)}
                    y1={chartsModel.padT}
                    x2={chartsModel.xOf(i)}
                    y2={chartsModel.topHeight - chartsModel.padB}
                    className="grid-line grid-line--v"
                  />
                  {i % chartsModel.xTickStride === 0 ||
                  i === chartsModel.points.length - 1 ? (
                    <text
                      x={chartsModel.xOf(i)}
                      y={chartsModel.topHeight - 10}
                      textAnchor="middle"
                      className="axis-x"
                    >
                      {point.label}
                    </text>
                  ) : null}
                </g>
              ))}

              <path
                d={chartsModel.returnsPath}
                className="trend-line trend-line--returns"
              />
              <path
                d={chartsModel.investmentsPath}
                className="trend-line trend-line--investments"
              />

              {chartsModel.points.map((point, i) => (
                <circle
                  key={`ret_pt_${i}`}
                  cx={chartsModel.xOf(i)}
                  cy={chartsModel.yOf(point.returns)}
                  r={3.2}
                  className="trend-dot trend-dot--returns"
                />
              ))}
              {chartsModel.points.map((point, i) => (
                <circle
                  key={`inv_pt_${i}`}
                  cx={chartsModel.xOf(i)}
                  cy={chartsModel.yOf(point.investments)}
                  r={3.2}
                  className="trend-dot trend-dot--investments"
                />
              ))}
            </svg>
          </div>

          <div className="trend-legend trend-legend--modern">
            <span className="legend-item legend-item--returns">الإيرادات</span>
            <span className="legend-item legend-item--investments">المصروفات</span>
          </div>
        </article>

        <article className="dsv2-card dsv2-card--padded chart-card chart-card--compact chart-card--status">
          <div className="chart-card__head chart-card__head--modern">
            <div className="chart-title-block">
              <span className="chart-eyebrow">تشغيل الحجوزات</span>
              <h3>حالة الحجوزات</h3>
              <p>توزيع الحالات خلال الفترة الحالية</p>
            </div>
          </div>

          {chartsModel.statusBars.some((bar) => Number(bar.value || 0) > 0) ? (
            <div className="mini-chart-wrap mini-chart-wrap--modern">
              <svg
                viewBox="0 0 520 280"
                className="mini-chart mini-chart--status"
                role="img"
                aria-label="رسم حالات الحجوزات"
              >
                {Array.from({ length: 5 }).map((_, i) => {
                  const y = 24 + (220 * i) / 4;
                  return (
                    <line
                      key={`sg_${i}`}
                      x1={40}
                      y1={y}
                      x2={500}
                      y2={y}
                      className="grid-line grid-line--horizontal"
                    />
                  );
                })}

                {chartsModel.statusBars.map((bar, i) => {
                  const x = 70 + i * 110;
                  const height =
                    (Math.max(0, bar.value) / chartsModel.statusMax) * 180;
                  const y = 240 - height;
                  return (
                    <g key={`sb_${bar.key}`}>
                      <rect
                        x={x}
                        y={60}
                        width={62}
                        height={180}
                        rx={12}
                        className="status-track"
                      />
                      <rect
                        x={x}
                        y={y}
                        width={62}
                        height={height}
                        rx={12}
                        className={`status-bar status-bar--${bar.key}`}
                      />
                      <text
                        x={x + 31}
                        y={260}
                        textAnchor="middle"
                        className="axis-x"
                      >
                        {bar.label}
                      </text>
                      <text
                        x={x + 31}
                        y={Math.max(22, y - 10)}
                        textAnchor="middle"
                        className="status-value"
                      >
                        {bar.value}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <div className="chart-empty-v2" role="status">
              <span className="chart-empty-v2__icon" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>لا توجد حجوزات في الفترة</strong>
              <p>ستظهر حالات الحجوزات هنا فور تسجيل حركات جديدة.</p>
            </div>
          )}
        </article>

        <article className="dsv2-card dsv2-card--padded chart-card chart-card--compact chart-card--sources">
          <div className="chart-card__head chart-card__head--modern">
            <div className="chart-title-block">
              <span className="chart-eyebrow">مزيج الإيرادات</span>
              <h3>مصادر الإيرادات</h3>
              <p>نسبة مساهمة كل مصدر في إجمالي الدخل</p>
            </div>
          </div>

          {chartsModel.pieSlices.length > 0 ? (
            <div className="donut-layout-v2">
              <div className="mini-chart-wrap mini-chart-wrap--modern donut-chart-wrap-v2">
                <svg
                  viewBox="0 0 360 300"
                  className="mini-chart mini-chart--donut"
                  role="img"
                  aria-label="رسم توزيع مصادر الإيرادات"
                >
                  <g transform="translate(180,145)">
                    {chartsModel.pieSlices.map((slice) => (
                      <path
                        key={`pie_${slice.key}`}
                        d={arcPath(0, 0, 96, slice.start, slice.end)}
                        className={`donut-slice-v2 donut-slice-v2--${slice.key}`}
                      />
                    ))}
                    <circle r="59" className="donut-hole-v2" />
                    <text
                      textAnchor="middle"
                      y="-3"
                      className="donut-total-v2"
                    >
                      {formatAxisNumber(chartsModel.sourceTotal)}
                    </text>
                    <text
                      textAnchor="middle"
                      y="20"
                      className="donut-caption-v2"
                    >
                      إجمالي الإيرادات
                    </text>
                  </g>
                </svg>
              </div>

              <div className="pie-legend pie-legend--modern" dir="rtl">
                {chartsModel.pieSlices.map((slice) => {
                  const ratio =
                    chartsModel.sourceTotal > 0
                      ? Math.round((slice.value / chartsModel.sourceTotal) * 100)
                      : 0;
                  return (
                    <div
                      key={`pie_legend_${slice.key}`}
                      className="pie-legend__item"
                    >
                      <span
                        className={`pie-legend__dot pie-legend__dot--${slice.key}`}
                      />
                      <span className="pie-legend__label">{slice.label}</span>
                      <span className="pie-legend__value">
                        {formatMoney(slice.value)}
                      </span>
                      <span className="pie-legend__ratio">{ratio}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="chart-empty-v2" role="status">
              <span className="chart-empty-v2__donut" aria-hidden="true" />
              <strong>لا توجد إيرادات في الفترة</strong>
              <p>غيّر الفترة أو الفلاتر لعرض توزيع مصادر الإيرادات.</p>
            </div>
          )}
        </article>
      </section>

      {loadErr || payrollCalculationError ? <div className="reports-v2__error">{[loadErr, payrollCalculationError].filter(Boolean).join(" | ")}</div> : null}

      <section className="dsv2-card reports-v2__section">
        <div className="section-head">
          <h2>
            <FontAwesomeIcon icon={faChartLine} /> تفاصيل الإيرادات
          </h2>
          <span>عدد الحركات: {revenueRowsDetailed.length}</span>
        </div>
        <div className="dsv2-table-scroll table-wrap">
          <table className="dsv2-table">
            <thead>
              <tr>
                <th>التاريخ/الوقت</th>
                <th>المصدر</th>
                <th>رقم الحجز MK</th>
                <th>الموظفة</th>
                <th>الملاحظة</th>
                <th>المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {revenueRowsDetailed.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">لا توجد بيانات إيراد داخل الفترة.</td>
                </tr>
              ) : (
                revenueRowsDetailed.map((row) => (
                  <tr key={row.id}>
                    <td data-label="التاريخ/الوقت">{formatDateTime(row.date, row.time)}</td>
                    <td data-label="المصدر">
                      {sourceLabel(row.source, language)}
                    </td>
                    <td data-label="رقم الحجز MK">{row.mkRef}</td>
                    <td data-label="الموظفة">{row.employeeName || "-"}</td>
                    <td data-label="الملاحظة">{row.note || "-"}</td>
                    <td data-label="المبلغ" className={row.amount < 0 ? "amount-neg" : "amount-pos"}>
                      {formatMoney(row.amount)}
                    </td>
                    <td data-label="الحالة">{row.statusLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dsv2-card reports-v2__section">
        <div className="section-head">
          <h2>تفاصيل المصروفات</h2>
          <span>عدد السجلات: {expensesInRange.length}</span>
        </div>
        <div className="dsv2-table-scroll table-wrap">
          <table className="dsv2-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>التصنيف</th>
                <th>الوصف</th>
                <th>المبلغ</th>
                <th>من أضافه</th>
              </tr>
            </thead>
            <tbody>
              {expensesInRange.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">لا توجد مصروفات داخل الفترة.</td>
                </tr>
              ) : (
                expensesInRange
                  .slice()
                  .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                  .map((row) => (
                    <tr key={row.id}>
                      <td data-label="التاريخ">{row.date}</td>
                      <td data-label="التصنيف">{row.category || "أخرى"}</td>
                      <td data-label="الوصف">{row.title || row.note || "-"}</td>
                      <td data-label="المبلغ" className="amount-exp">{formatMoney(row.amount)}</td>
                      <td data-label="من أضافه">{row.addedBy || "-"}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {loading || payrollCalculationLoading ? <div className="reports-v2__loading">{payrollCalculationLoading ? "جاري احتساب مسير جميع الموظفات..." : "جاري مزامنة البيانات..."}</div> : null}
    </div>
  );
}
