import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDays, faChartLine, faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../services/firebase";
import { AppSettingsService } from "../services/AppSettingsService";
import { FirestoreReadStats } from "../services/firestoreReadStats";
import type { PaymentMethod } from "../types/finance";
import {
  buildPayrollExpenseRowsForMonths,
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  payrollCycleRangeForMonthKey,
  type BookingPayrollSource,
  type StaffPayrollSource,
} from "../helpers/staffPayroll";

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

const SALON_ID = "main";
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

function formatMoney(v: number) {
  return `${Number(v || 0).toLocaleString("en-US")} ر.س`;
}

function formatDateTime(date: string, time: string) {
  const d = String(date || "").trim() || "-";
  const t = String(time || "").trim() || "-";
  return `${d} ${t}`;
}

function bookingStatusLabel(status: BookingStatus) {
  if (status === "confirmed") return "مؤكد";
  if (status === "completed") return "مكتمل";
  if (status === "cancelled") return "ملغي";
  return "انتظار";
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

function sourceLabel(kind: IncomeSourceKind) {
  if (kind === "booking") return "حجز";
  if (kind === "invoice") return "فاتورة";
  if (kind === "internal") return "داخلي";
  if (kind === "refund") return "استرجاع";
  return "دخل آخر";
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
  if (s === "other") return "other";
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق")) return "card";
  if (s.includes("تحويل")) return "transfer";
  return "other";
}

function methodLabelFromRaw(raw?: string): string {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f";
  if (s === "cash" || s === "\u0643\u0627\u0634") return "\u0643\u0627\u0634";
  if (
    s === "card" ||
    s === "mada" ||
    s.includes("\u0634\u0628\u0643") ||
    s.includes("\u0628\u0637\u0627\u0642")
  )
    return "\u0634\u0628\u0643\u0629";
  if (s === "transfer" || s.includes("\u062a\u062d\u0648\u064a\u0644")) return "\u062a\u062d\u0648\u064a\u0644";
  return String(raw || "").trim();
}

function formatIncomeNotePart(part: string): string {
  const p = String(part || "").trim();
  if (!p) return "";
  const lower = p.toLowerCase();

  if (lower.startsWith("invoice_from_reception:")) {
    const method = p.split(":")[1] || "";
    return `\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u0627\u0633\u062a\u0642\u0628\u0627\u0644 (${methodLabelFromRaw(method)})`;
  }
  if (lower.startsWith("internal_payment:")) {
    const method = p.split(":")[1] || "";
    return `\u062f\u0641\u0639 \u062f\u0627\u062e\u0644\u064a (${methodLabelFromRaw(method)})`;
  }
  if (lower.startsWith("payment_method:")) {
    const method = p.split(":")[1] || "";
    return `\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639 (${methodLabelFromRaw(method)})`;
  }

  return p;
}

function formatIncomeNote(raw?: string): string {
  const note = String(raw || "").trim();
  if (!note) return "";

  const parts = note
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!parts.length) return note;
  return parts.map((p) => formatIncomeNotePart(p)).filter(Boolean).join(" - ");
}

function resolveIncomeReportNote(sourceRaw: string, noteText: string): string {
  if (noteText) return noteText;

  const kind = sourceKind(sourceRaw || "");
  if (kind === "booking") return "\u0633\u062c\u0644 \u062d\u062c\u0632 \u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u062d\u0638\u0629";
  if (kind === "invoice") return "\u0641\u0627\u062a\u0648\u0631\u0629 \u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u062d\u0638\u0629";
  if (kind === "internal") return "\u062f\u0641\u0639 \u062f\u0627\u062e\u0644\u064a \u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u062d\u0638\u0629";
  if (kind === "refund") return "\u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u062d\u0638\u0629";

  const source = String(sourceRaw || "").trim().toLowerCase();
  if (source === "manual" || source === "\u064a\u062f\u0648\u064a") {
    return "\u062f\u062e\u0644 \u064a\u062f\u0648\u064a \u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u062d\u0638\u0629";
  }
  return "\u062f\u062e\u0644 \u0622\u062e\u0631 \u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u062d\u0638\u0629";
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

function statusLabelForIncome(item: IncomeRow): string {
  const status = String(item.status || "").trim().toLowerCase();
  if (status === "active" || status === "confirmed" || status === "completed") return "نشط";
  if (status === "refunded" || status === "refund") return "استرجاع";
  if (status === "voided" || status === "void" || status === "cancelled" || status === "canceled") return "ملغي";
  if (isRefundIncomeRow(item)) return "استرجاع";
  return "نشط";
}

function rowEffectiveAmount(item: IncomeRow, bookingMetaById: Record<string, BookingMeta>) {
  const linkedBookingId = resolveLinkedBookingId(item);
  const meta = linkedBookingId ? bookingMetaById[linkedBookingId] : undefined;
  return meta ? Number(meta.paidAmount || 0) : Number(item.amount || 0);
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

function normalizeStaffPayrollRows(rows: any[]): StaffPayrollSource[] {
  return (Array.isArray(rows) ? rows : [])
    .map((x) => {
      const id = String(x?.id || "").trim();
      if (!id) return null;
      return {
        id,
        name: String(x?.name || "").trim() || id,
        active: x?.active !== false,
        employmentEndDate: String(x?.employmentEndDate || "").trim() || undefined,
        useCustomWorkingHours: !!x?.useCustomWorkingHours,
        customWorkingHours: x?.customWorkingHours || {},
        customWorkingHourOverrides: Array.isArray(x?.customWorkingHourOverrides)
          ? x.customWorkingHourOverrides
          : [],
        monthlySalary: Number(x?.monthlySalary ?? 0) || 0,
        overtimeMethod:
          String(x?.overtimeMethod || "").trim() === "invoice_percentage"
            ? "invoice_percentage"
            : "hours_from_salary",
        overtimeDaysPerMonth: Number(x?.overtimeDaysPerMonth ?? 30) || 30,
        overtimeBaseHoursPerDay: Number(x?.overtimeBaseHoursPerDay ?? 8) || 8,
        overtimeSeasonBaseHoursPerDay: Number(x?.overtimeSeasonBaseHoursPerDay ?? 6) || 6,
        autoSeasonOvertimeBasis: x?.autoSeasonOvertimeBasis === true,
        overtimeHoursBasis:
          String(x?.overtimeHoursBasis || "").trim() === "season" ? "season" : "regular",
        overtimePercent: Number(x?.overtimePercent ?? 0) || 0,
        overtimeInvoicePercent: Number(x?.overtimeInvoicePercent ?? 0) || 0,
      } as StaffPayrollSource;
    })
    .filter(Boolean) as StaffPayrollSource[];
}

function normalizeBookingPayrollRows(rows: BookingRow[]): BookingPayrollSource[] {
  return (Array.isArray(rows) ? rows : [])
    .map((x) => {
      const date = String(x?.date || "").trim();
      if (!isIsoDate(date)) return null;
      return {
        date,
        status: String(x?.status || "").trim().toLowerCase(),
        amount: Math.max(0, Number(x?.amount || 0)),
        employeeId: String(x?.employeeId || "").trim() || null,
        employeeUid: String(x?.employeeUid || "").trim() || null,
        employeeKey: String(x?.employeeKey || "").trim() || null,
        employeeName: String(x?.employeeName || "").trim() || null,
      } as BookingPayrollSource;
    })
    .filter(Boolean) as BookingPayrollSource[];
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

function monthLabelAr(monthKey: string) {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
  return `${MONTHS_AR[m - 1]} ${y}`;
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

function loadCollectionOnce(
  ref: any,
  onNext: (snap: any) => void,
  onError?: (err: any) => void
) {
  let active = true;
  void getDocs(ref)
    .then((snap) => {
      if (!active) return;
      onNext(snap);
    })
    .catch((err) => {
      if (!active) return;
      onError?.(err);
    });
  return () => {
    active = false;
  };
}

function loadAppSettingsOnce(
  onNext: (settings: any) => void,
  onError?: (err: any) => void
) {
  let active = true;
  void AppSettingsService.fetchRemote()
    .then((remote) => {
      if (!active) return;
      FirestoreReadStats.bump(
        `salons/${SALON_ID}/settings/app`,
        "DashboardReports.settings.fetchRemote",
        "getDoc"
      );
      onNext(remote || {});
    })
    .catch((err) => {
      if (!active) return;
      onError?.(err);
    });
  return () => {
    active = false;
  };
}

export default function DashboardReports() {
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
  const [staffRows, setStaffRows] = useState<StaffPayrollSource[]>([]);
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const [loading, setLoading] = useState(true);
  const [lastSyncMs, setLastSyncMs] = useState<number>(Date.now());
  const [loadErr, setLoadErr] = useState("");

  const range = useMemo(
    () => getRange(period, customFrom, customTo, selectedMonth),
    [period, customFrom, customTo, selectedMonth]
  );

  useEffect(() => {
    let active = true;
    let pending = 5;
    setLoading(true);
    setLoadErr("");

    const done = () => {
      pending -= 1;
      if (active && pending <= 0) setLoading(false);
    };
    let bookingsReady = false;
    let incomeReady = false;
    let expensesReady = false;
    let staffReady = false;
    let settingsReady = false;

    const bookingsQ = collection(db, "salons", SALON_ID, "bookings");
    const incomeQ = collection(db, "salons", SALON_ID, "income");
    const expensesQ = collection(db, "salons", SALON_ID, "expenses");
    const staffQ = collection(db, "salons", SALON_ID, "staff_public");

    let firstBookings = true;
    let firstIncome = true;
    let firstExpenses = true;
    let firstStaff = true;

    const unsubBookings = loadCollectionOnce(
      bookingsQ,
      (snap) => {
        const source = "DashboardReports.bookings.getDocs";
        const docs = firstBookings ? snap.docs : snap.docChanges().map((c: any) => c.doc);
        docs.forEach((d: any) => {
          if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, source, "getDocs");
        });
        firstBookings = false;

        const rows: BookingRow[] = snap.docs.map((d: any) => {
          const raw = d.data() as any;
          const createdAtMs = parseMillis(raw?.createdAt || raw?.updatedAt);
          const date = normalizeIsoDate(raw?.date, createdAtMs);
          const payment = resolveBookingPayment(raw);
          return {
            id: d.id,
            publicId: String(raw?.publicId || raw?.trackPublicId || "").trim(),
            date,
            time: String(raw?.time || "").trim(),
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
        if (!bookingsReady) {
          bookingsReady = true;
          done();
        }
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل الحجوزات"));
        if (!bookingsReady) {
          bookingsReady = true;
          done();
        }
      }
    );

    const unsubIncome = loadCollectionOnce(
      incomeQ,
      (snap) => {
        const source = "DashboardReports.income.getDocs";
        const docs = firstIncome ? snap.docs : snap.docChanges().map((c: any) => c.doc);
        docs.forEach((d: any) => {
          if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, source, "getDocs");
        });
        firstIncome = false;

        const rows: IncomeRow[] = snap.docs.map((d: any) => {
          const raw = d.data() as any;
          const createdAtMs = parseMillis(raw?.createdAt || raw?.updatedAt);
          const date = normalizeIsoDate(raw?.date, createdAtMs);
          const time = createdAtMs
            ? new Intl.DateTimeFormat("ar-SA", {
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(createdAtMs))
            : "";

          return {
            id: d.id,
            date,
            time,
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
        if (!incomeReady) {
          incomeReady = true;
          done();
        }
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل الإيرادات"));
        if (!incomeReady) {
          incomeReady = true;
          done();
        }
      }
    );

    const unsubExpenses = loadCollectionOnce(
      expensesQ,
      (snap) => {
        const source = "DashboardReports.expenses.getDocs";
        const docs = firstExpenses ? snap.docs : snap.docChanges().map((c: any) => c.doc);
        docs.forEach((d: any) => {
          if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, source, "getDocs");
        });
        firstExpenses = false;

        const rows: ExpenseRow[] = snap.docs.map((d: any) => {
          const raw = d.data() as any;
          const createdAtMs = parseMillis(raw?.createdAt || raw?.updatedAt);
          return {
            id: d.id,
            date: normalizeIsoDate(raw?.date, createdAtMs),
            amount: Number(raw?.amount ?? 0) || 0,
            category: String(raw?.category || "أخرى").trim() || "أخرى",
            title: String(raw?.title || "").trim(),
            note: String(raw?.note || "").trim(),
            addedBy: String(
              raw?.createdByName ||
                raw?.addedBy ||
                raw?.createdBy ||
                raw?.createdByEmail ||
                raw?.createdByUid ||
                "الإدارة"
            ).trim() || "الإدارة",
            createdAtMs,
          };
        });
        setExpenses(rows);
        setLastSyncMs(Date.now());
        if (!expensesReady) {
          expensesReady = true;
          done();
        }
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل المصروفات"));
        if (!expensesReady) {
          expensesReady = true;
          done();
        }
      }
    );

    const unsubStaff = loadCollectionOnce(
      staffQ,
      (snap) => {
        const source = "DashboardReports.staff_public.getDocs";
        const docs = firstStaff ? snap.docs : snap.docChanges().map((c: any) => c.doc);
        docs.forEach((d: any) => {
          if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, source, "getDocs");
        });
        firstStaff = false;

        const rows = normalizeStaffPayrollRows(
          snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        );
        setStaffRows(rows);
        setLastSyncMs(Date.now());
        if (!staffReady) {
          staffReady = true;
          done();
        }
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل الموظفات"));
        if (!staffReady) {
          staffReady = true;
          done();
        }
      }
    );

    const unsubSettings = loadAppSettingsOnce(
      (remote: any) => {
        setAppSettings(remote || {});
        setLastSyncMs(Date.now());
        if (!settingsReady) {
          settingsReady = true;
          done();
        }
      },
      () => {
        if (!settingsReady) {
          settingsReady = true;
          done();
        }
      }
    );

    return () => {
      active = false;
      unsubBookings();
      unsubIncome();
      unsubExpenses();
      unsubStaff();
      try {
        unsubSettings?.();
      } catch {
        // noop
      }
    };
  }, []);

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

  const payrollMonthKeys = useMemo(() => {
    const set = new Set<string>();
    bookings.forEach((x) => {
      const mk = monthKeyFromIsoDate(String(x.date || ""));
      if (mk) set.add(mk);
    });
    expenses.forEach((x) => {
      const mk = monthKeyFromIsoDate(String(x.date || ""));
      if (mk) set.add(mk);
    });
    incomeRows.forEach((x) => {
      const mk = monthKeyFromIsoDate(incomeEffectiveDate(x));
      if (mk) set.add(mk);
    });
    monthKeysBetween(range.from, range.to).forEach((mk) => set.add(mk));
    const rangeToMonth = monthKeyFromIsoDate(String(range.to || ""));
    if (rangeToMonth) {
      set.add(rangeToMonth);
      const prev = previousMonthKey(rangeToMonth);
      if (prev) set.add(prev);
    }
    set.add(toMonthKey(new Date()));
    const expanded = new Set<string>();
    set.forEach((mk) => {
      expanded.add(mk);
      const prev = previousMonthKey(mk);
      const next = nextMonthKey(mk);
      if (prev) expanded.add(prev);
      if (next) expanded.add(next);
    });
    return Array.from(expanded).sort((a, b) => a.localeCompare(b));
  }, [bookings, expenses, range.from, range.to, incomeRows, bookingById]);

  const autoPayrollExpenses = useMemo<ExpenseRow[]>(() => {
    if (!staffRows.length || !payrollMonthKeys.length) return [];
    const bookingRows = normalizeBookingPayrollRows(bookings);
    const payrollRows = buildPayrollExpenseRowsForMonths({
      staffList: staffRows,
      bookings: bookingRows,
      appSettings: appSettings || {},
      monthKeys: payrollMonthKeys,
    });
    return payrollRows.map((x) => ({
      id: x.id,
      date: String(x.date || "").trim(),
      amount: Number(x.amount || 0),
      category: String(x.category || "أخرى").trim() || "أخرى",
      title: String(x.title || "").trim(),
      note: String(x.note || "").trim(),
      addedBy: "النظام (رواتب)",
      createdAtMs: Number(x.createdAt || 0),
    }));
  }, [staffRows, bookings, appSettings, payrollMonthKeys]);

  const expensesWithPayroll = useMemo(() => {
    const map = new Map<string, ExpenseRow>();
    [...expenses, ...autoPayrollExpenses].forEach((x) => {
      const id = String(x?.id || "").trim();
      if (!id) return;
      map.set(id, x);
    });
    return Array.from(map.values());
  }, [expenses, autoPayrollExpenses]);

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
        const noteText = formatIncomeNote(x.note);
        const displayNote = resolveIncomeReportNote(x.source, noteText);
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
          statusLabel: statusLabelForIncome(x),
        };
      })
      .sort((a, b) => {
        const aKey = `${a.date} ${a.time}`;
        const bKey = `${b.date} ${b.time}`;
        return bKey.localeCompare(aKey);
      });
  }, [incomeRowsInRange, bookingById, bookingMetaById]);

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
      currentLabel: monthLabelAr(currentKey),
      previousLabel: monthLabelAr(previousKey),
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
        label: m,
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
      pending: "نشط",
      confirmed: "مؤكد",
      completed: "مكتمل",
      cancelled: "مرفوض",
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

    const sourceRaw: Array<{ label: string; key: IncomeSourceKind; value: number; color: string }> = [
      { label: sourceLabel("booking"), key: "booking", value: 0, color: "#40010D" },
      { label: sourceLabel("invoice"), key: "invoice", value: 0, color: "#7A1F3D" },
      { label: sourceLabel("internal"), key: "internal", value: 0, color: "#5C0A9D" },
      { label: sourceLabel("refund"), key: "refund", value: 0, color: "#888C8C" },
      { label: sourceLabel("other"), key: "other", value: 0, color: "#2F6C74" },
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
  }, [trendMode, revenueRowsDetailed, expensesInRange, bookings, range.from, range.to]);

  const lastSyncLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(lastSyncMs)),
    [lastSyncMs]
  );

  return (
    <div className="reports-v2">
      <div className="reports-v2__header">
        <div>
          <h1>اللوحة المالية</h1>
          <p>
            المصدر الرسمي للإيرادات هنا هو قائمة الدخل `income` فقط (بنفس منطق صفحة الإيرادات:
            المبلغ الفعلي للحجوزات = `paidAmount`، وغير المرتبط بالحجوزات = `amount`). المصروفات من
            `expenses` مع إضافة الرواتب/الأوفر تايم المحسوبة تلقائيًا. العرض الشهري هنا تقويمي
            (1-آخر الشهر)، بينما الرواتب تُغلق بدورة 28-27.
          </p>
          <small className="reports-v2__sync">
            <FontAwesomeIcon icon={faClockRotateLeft} /> آخر مزامنة: {lastSyncLabel}
          </small>
        </div>
      </div>

      <div className="reports-v2__filters">
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
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  const next = String(e.target.value || "").trim();
                  if (/^\d{4}-\d{2}$/.test(next)) setSelectedMonth(next);
                }}
              />
            </label>
          </div>
        )}

        {period === "custom" && (
          <div className="reports-v2__custom-range">
            <label>
              من
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label>
              إلى
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}

        <div className="reports-v2__custom-range">
          <label>
            طريقة الدفع
            <select
              value={incomeMethodFilter}
              onChange={(e) => setIncomeMethodFilter(e.target.value as PaymentMethod | "all")}
            >
              <option value="all">الكل</option>
              <option value="cash">كاش</option>
              <option value="card">شبكة</option>
              <option value="transfer">تحويل</option>
              <option value="other">أخرى</option>
            </select>
          </label>
          <label>
            المصدر
            <select
              value={incomeSourceFilter}
              onChange={(e) => setIncomeSourceFilter(e.target.value as IncomeSourceKind | "all")}
            >
              <option value="all">الكل</option>
              <option value="booking">حجز</option>
              <option value="invoice">فاتورة</option>
              <option value="internal">داخلي</option>
              <option value="refund">استرجاع</option>
              <option value="other">دخل آخر</option>
            </select>
          </label>
          <label>
            الحالة
            <select
              value={incomeStatusFilter}
              onChange={(e) => setIncomeStatusFilter(e.target.value as IncomeStatusFilter)}
            >
              <option value="all">الكل</option>
              <option value="active">نشط</option>
              <option value="refunded">مسترجع</option>
              <option value="voided">ملغي/Voided</option>
            </select>
          </label>
        </div>

        <div className="reports-v2__range-caption">
          <FontAwesomeIcon icon={faCalendarDays} /> الفترة: {range.from} إلى {range.to}
        </div>
      </div>

      <section className="reports-v2__payroll-cycle">
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
            <p>مصروفات الرواتب التلقائية داخل الدورة</p>
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

      <div className="reports-v2__kpis">
        <article className="kpi kpi-revenue">
          <h3>إجمالي الإيرادات</h3>
          <strong>{formatMoney(totals.revenue)}</strong>
        </article>
        <article className="kpi kpi-expense">
          <h3>إجمالي المصروفات</h3>
          <strong>{formatMoney(totals.expenses)}</strong>
        </article>
        <article className={`kpi kpi-net ${totals.net >= 0 ? "is-positive" : "is-negative"}`}>
          <h3>صافي الربح / الخسارة</h3>
          <strong>{formatMoney(totals.net)}</strong>
        </article>
      </div>

      <section className="reports-v2__month-compare">
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

      <section className="reports-v2__charts-board">
        <article className="chart-card chart-card--wide">
          <div className="chart-card__head">
            <div>
              <h2>
                اتجاه التدفقات {trendMode === "month" ? "الشهرية" : "اليومية"}
                {trendMode === "month" ? ` (${chartsModel.selectedYear})` : ""}
              </h2>
              <p>العوائد مقابل المصروفات</p>
            </div>
            <div className="chart-switch" dir="rtl">
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
          <div className="top-chart-wrap">
            <svg viewBox={`0 0 ${chartsModel.topWidth} ${chartsModel.topHeight}`} className="top-chart" preserveAspectRatio="none">
              {chartsModel.yTicks.map((tickVal, i) => {
                const y = chartsModel.padT + ((chartsModel.topHeight - chartsModel.padT - chartsModel.padB) * i) / 4;
                return (
                  <g key={`yg_${i}`}>
                    <line
                      x1={chartsModel.padL}
                      y1={y}
                      x2={chartsModel.topWidth - chartsModel.padR}
                      y2={y}
                      className="grid-line"
                    />
                    <text x={chartsModel.padL - 8} y={y + 4} textAnchor="end" className="axis-y">
                      {formatAxisNumber(tickVal)}
                    </text>
                  </g>
                );
              })}
              {chartsModel.points.map((p, i) => (
                <g key={`x_${p.key}`}>
                  <line
                    x1={chartsModel.xOf(i)}
                    y1={chartsModel.padT}
                    x2={chartsModel.xOf(i)}
                    y2={chartsModel.topHeight - chartsModel.padB}
                    className="grid-line grid-line--v"
                  />
                  {i % chartsModel.xTickStride === 0 || i === chartsModel.points.length - 1 ? (
                    <text x={chartsModel.xOf(i)} y={chartsModel.topHeight - 10} textAnchor="middle" className="axis-x">
                      {p.label}
                    </text>
                  ) : null}
                </g>
              ))}
              <path d={chartsModel.returnsPath} className="trend-line trend-line--returns" />
              <path d={chartsModel.investmentsPath} className="trend-line trend-line--investments" />
              {chartsModel.points.map((p, i) => (
                <circle key={`ret_pt_${i}`} cx={chartsModel.xOf(i)} cy={chartsModel.yOf(p.returns)} r={3.2} className="trend-dot trend-dot--returns" />
              ))}
              {chartsModel.points.map((p, i) => (
                <circle key={`inv_pt_${i}`} cx={chartsModel.xOf(i)} cy={chartsModel.yOf(p.investments)} r={3.2} className="trend-dot trend-dot--investments" />
              ))}
            </svg>
          </div>
          <div className="trend-legend">
            <span className="legend-item legend-item--returns">العوائد</span>
            <span className="legend-item legend-item--investments">المصروفات</span>
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h3>حالة الحجوزات (حسب الفترة)</h3>
          </div>
          <div className="mini-chart-wrap">
            <svg viewBox="0 0 520 280" className="mini-chart">
              {Array.from({ length: 5 }).map((_, i) => {
                const y = 24 + (220 * i) / 4;
                return (
                  <line key={`sg_${i}`} x1={40} y1={y} x2={500} y2={y} className="grid-line" />
                );
              })}
              {chartsModel.statusBars.map((b, i) => {
                const x = 70 + i * 110;
                const h = (Math.max(0, b.value) / chartsModel.statusMax) * 180;
                const y = 240 - h;
                return (
                  <g key={`sb_${b.key}`}>
                    <rect x={x} y={y} width={62} height={h} rx={8} className="status-bar" />
                    <text x={x + 31} y={258} textAnchor="middle" className="axis-x">{b.label}</text>
                    <text x={x + 31} y={Math.max(18, y - 6)} textAnchor="middle" className="axis-y">{b.value}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h3>توزيع مصادر الإيرادات</h3>
          </div>
          <div className="mini-chart-wrap">
            <svg viewBox="0 0 520 260" className="mini-chart mini-chart--pie">
              <g transform="translate(260,130)">
                {chartsModel.pieSlices.map((s) => (
                  <path
                    key={`pie_${s.key}`}
                    d={arcPath(0, 0, 84, s.start, s.end)}
                    fill={s.color}
                    stroke="#ffffff"
                    strokeWidth="2.5"
                  />
                ))}
                {chartsModel.pieSlices.length === 0 ? (
                  <>
                    <circle r="78" fill="rgba(136, 140, 140, 0.18)" stroke="rgba(13, 13, 13, 0.16)" />
                    <text textAnchor="middle" y="5" className="axis-x">No data</text>
                  </>
                ) : null}
              </g>
            </svg>
          </div>
          <div className="pie-legend" dir="rtl">
            {chartsModel.pieSlices.map((s) => {
              const ratio = chartsModel.sourceTotal > 0 ? Math.round((s.value / chartsModel.sourceTotal) * 100) : 0;
              return (
                <div key={`pie_legend_${s.key}`} className="pie-legend__item">
                  <span className="pie-legend__dot" style={{ backgroundColor: s.color }} />
                  <span className="pie-legend__label">{s.label}</span>
                  <span className="pie-legend__value">{s.value}</span>
                  <span className="pie-legend__ratio">({ratio}%)</span>
                </div>
              );
            })}
            {chartsModel.pieSlices.length === 0 ? (
              <div className="pie-legend__empty">لا توجد بيانات في الفترة المحددة</div>
            ) : null}
          </div>
        </article>
      </section>

      {loadErr ? <div className="reports-v2__error">{loadErr}</div> : null}

      <section className="reports-v2__section">
        <div className="section-head">
          <h2>
            <FontAwesomeIcon icon={faChartLine} /> تفاصيل الإيرادات
          </h2>
          <span>عدد الحركات: {revenueRowsDetailed.length}</span>
        </div>
        <div className="table-wrap">
          <table>
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
                      {sourceLabel(row.source)}
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

      <section className="reports-v2__section">
        <div className="section-head">
          <h2>تفاصيل المصروفات</h2>
          <span>عدد السجلات: {expensesInRange.length}</span>
        </div>
        <div className="table-wrap">
          <table>
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

      {loading ? <div className="reports-v2__loading">جاري مزامنة البيانات...</div> : null}
    </div>
  );
}
