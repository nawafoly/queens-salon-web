// src/pages/DashboardBookings.tsx
import { memo, useEffect, useMemo, useState, useRef, useCallback } from "react";
import Modal from "../components/Modal";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faFilter,
  faFileCsv,
  faXmark,
  faRotate,
  faPlus,
  faPrint,
} from "@fortawesome/free-solid-svg-icons";

import { auth } from "../services/firebase";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";

import type {
  BookingPaymentType,
  BookingStatus,
} from "../services/firestoreBookings";
import type { StaffPublicWithId } from "../services/firestoreStaffPublic";
import { resolveBookingDataSource } from "../services/bookingDataSource";
import { coreD1BookingDataSource } from "../services/bookingDataSources/coreD1BookingDataSource";
import { CoreBookingService } from "../services/CoreBookingService";
import { coreBookingToLegacy } from "../services/coreBookingMappers";
import { CoreAuditService } from "../services/CoreAuditService";
import { CoreClientService } from "../services/CoreClientService";
import { CoreRefundService } from "../services/CoreRefundService";
import { CoreInvoiceService } from "../services/CoreInvoiceService";
import { CorePaymentService } from "../services/CorePaymentService";
import { PackageOperationsService } from "../services/PackageOperationsService";
import type { PaymentMethod } from "../types/finance";

import type { UiRole } from "../services/userProfile";

// ✅ NEW: resolve service name (make it readable)
import { resolveServiceName } from "../services/serviceResolver";

// ✅ AppSettings through the unified Core settings adapter
import { AppSettingsService, type AppSettings } from "../services/AppSettingsService";
import { SALON_ID } from "../helpers/bookingSharedConstants";

import { isStaffAvailableForDate } from "../helpers/staffAvailability";
import {
  formatTime12,
  round2,
  toMillisSafeDashboardBookings as toMillisSafe,
} from "../helpers/pageSharedUtils";
import {
  bookingChannelBadgeText,
  bookingCreationRefMs,
  bookingRef,
  buildBookingLifecycleActivityItems,
  buildDashboardBookingBlocks,
  buildFallbackCreatedActivity,
  buildFallbackUpdatedActivity,
  channelLabel,
  dateISOFromMillisLocal,
  deriveLastUpdateForBooking,
  digitsOnly,
  extractServicesFromAny,
  formatAnyDateTime,
  inDateRange,
  isPendingDepositBooking,
  isTemporaryNormalInternalBooking,
  mapBookingActivityItem,
  mergeBookingActivityItems,
  mergeBookingLists,
  normalizeArabicName,
  normalizeBookingActivityAuditRaw,
  normalizeBookingPaymentType,
  parseBookingDateTimeMs,
  paymentAmountsDisplayLines,
  paymentBreakdownText,
  paymentStatusLabel,
  readBookingTotalAmount,
  readCatalogLabel,
  resolveBookingPaymentSummary,
  resolveBookingSectionKind,
  safeISODate,
  serviceMetaSummaryForTable,
  serviceSummaryForTable,
  statusLabel,
  shiftISODate,
  toArabicOnlyLabel,
  todayISOLocal,
  type BookingActivityItem,
  type BookingLastUpdate,
  type DashboardBookingDisplaySection,
  type DashboardBookingServiceItem as BookingServiceItem,
} from "./DashboardBookings.helpers";

// ✅ Styles

/* =========================
   Constants / Types
========================= */

type StatusOption = BookingStatus | "all";
type ExcludedStatusOption = "" | BookingStatus;
type SettlementFilterOption = "all" | "paid" | "partial" | "unpaid";
type DatePresetOption = "all" | "today" | "yesterday" | "week" | "month" | "last_month" | "custom";
type PaymentMethodFilterOption = "all" | "cash" | "card" | "transfer" | "mixed" | "other" | "none";
type BookingSourceFilterOption = "all" | "client" | "dashboard" | "internal" | "unknown";
type SortOrderOption = "newest" | "oldest";
type OldPendingFilterOption = "off" | "before_today" | "older_7" | "older_30" | "custom";

const NOTES_KEY = "dashboard_booking_notes_v1";
const NEW_BOOKINGS_SEEN_AT_KEY = "dashboard_bookings_seen_at_v1";
const LIVE_WINDOW_PAST_DAYS = 90;
const LIVE_WINDOW_FUTURE_DAYS = 90;
const LIVE_ACTIVE_STATUSES: BookingStatus[] = ["pending", "confirmed"];
const NON_LIVE_HISTORY_STATUSES: BookingStatus[] = ["completed", "cancelled"];

const allStatusOptions: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
const DEFAULT_PAGE_SIZE = 25;
const pageSizeOptions = [10, 25, 50, 100] as const;

function formatBookingAmount(value: unknown) {
  const amount = round2(Math.max(0, Number(value || 0)));
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function bookingUsesSessionPackage(booking: Booking): boolean {
  return Boolean(
    booking.fromSessionPackage ||
      booking.consumeOneSession ||
      String(booking.sessionPackageId || "").trim()
  );
}

function isFullBookingRefund(amount: number, bookingTotal: number): boolean {
  return bookingTotal > 0 && amount >= bookingTotal - 0.005;
}

function BookingMoney({ value }: { value: unknown }) {
  return (
    <span className="bk-money" dir="ltr">
      <bdi className="bk-money-number">{formatBookingAmount(value)}</bdi>
      <span className="bk-money-currency">ر.س</span>
    </span>
  );
}

function compactPaymentStatusLabel(payment: ReturnType<typeof resolveBookingPaymentSummary>) {
  if (payment.totalAmount <= 0) return "بدون سعر";
  if (payment.paidAmount <= 0 && payment.remainingAmount > 0) return "بانتظار السداد";
  if (payment.remainingAmount <= 0) return "مدفوع بالكامل";
  return "دفع جزئي";
}

/* =========================
   Helpers
========================= */

function downloadCSV(filename: string, rows: string[][]) {
  const escapeCell = (cell: string) => {
    const s = (cell ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = rows.map((r) => r.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function loadNotesMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function saveNotesMap(map: Record<string, string>) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(map));
}

function getAuthUserSafe(): { displayName: string; email: string } {
  const u = auth.currentUser;
  const displayName = String(u?.displayName || "").trim();
  const email = String(u?.email || "").trim();
  return { displayName, email };
}

function detectPaymentMethod(b: Booking): PaymentMethod {
  const stored = String((b as any)?.paymentMethod || "").toLowerCase().trim();
  if (stored === "card" || stored === "cash" || stored === "transfer" || stored === "mixed" || stored === "other") {
    return stored as PaymentMethod;
  }
  const s = String((b as any)?.note || "").toLowerCase();
  if (s.includes("مختلط") || s.includes("mixed")) return "mixed";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("card")) return "card";
  if (s.includes("تحويل") || s.includes("transfer")) return "transfer";
  if (s.includes("كاش") || s.includes("cash") || s.includes("نقد")) return "cash";
  return "transfer";
}

function paymentMethodLabel(method: PaymentMethodFilterOption | PaymentMethod | "none") {
  if (method === "cash") return "كاش";
  if (method === "card") return "شبكة";
  if (method === "transfer") return "تحويل";
  if (method === "mixed") return "مختلط";
  if (method === "other") return "أخرى";
  if (method === "none") return "بدون دفع";
  return "الكل";
}

function readPaymentBreakdown(raw: any): { cash: number; card: number; transfer: number } {
  const source = raw?.paymentBreakdown && typeof raw.paymentBreakdown === "object" ? raw.paymentBreakdown : {};
  const cash = Math.max(0, Number((source as any).cash || 0));
  const card = Math.max(0, Number((source as any).card || 0));
  const transfer = Math.max(0, Number((source as any).transfer || 0));
  return { cash: round2(cash), card: round2(card), transfer: round2(transfer) };
}

function paymentBreakdownAmount(raw: any) {
  const breakdown = readPaymentBreakdown(raw);
  return round2(
    Number(breakdown.cash || 0) +
      Number(breakdown.card || 0) +
      Number(breakdown.transfer || 0)
  );
}

function bookingPaymentMethodFilterValue(b: Booking): PaymentMethodFilterOption {
  const stored = String((b as any)?.paymentMethod || "").toLowerCase().trim();
  if (stored === "mixed") return "mixed";
  const payment = resolveBookingPaymentSummary(b);
  if (payment.paidAmount <= 0) return "none";
  const method = detectPaymentMethod(b);
  if (method === "cash" || method === "card" || method === "transfer" || method === "mixed" || method === "other") {
    return method;
  }
  return "other";
}

function paymentMethodDisplayText(b: Booking) {
  const method = bookingPaymentMethodFilterValue(b);
  if (method !== "mixed") return paymentMethodLabel(method);
  const breakdown = readPaymentBreakdown(b);
  return `مختلط: ${breakdown.cash} كاش + ${breakdown.card} شبكة + ${breakdown.transfer} تحويل`;
}

function createInvoicePrintRequestId(source: string) {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  const requestId = `${Date.now()}-${randomPart}`;
  localStorage.setItem("internalInvoicePrintRequestId", requestId);
  localStorage.setItem("internalInvoicePrintRequestSource", source);
  return requestId;
}

function paymentMethodForInvoice(b: Booking): "cash" | "card" | "transfer" | "mixed" | undefined {
  const method = bookingPaymentMethodFilterValue(b);
  if (method === "none") return undefined;
  if (method === "cash" || method === "card" || method === "transfer" || method === "mixed") return method;
  const fallback = detectPaymentMethod(b);
  if (fallback === "cash" || fallback === "card" || fallback === "transfer" || fallback === "mixed") {
    return fallback;
  }
  return undefined;
}

function buildInvoiceBaseFields(b: Booking) {
  const payment = resolveBookingPaymentSummary(b);
  const totalAmount = readBookingTotalAmount(b);
  const paymentMethod = paymentMethodForInvoice(b);
  const paymentBreakdown = readPaymentBreakdown(b);
  const createdAtMs = toMillisSafe(b.createdAt) || toMillisSafe(b.updatedAt) || bookingCreationRefMs(b) || Date.now();

  return {
    id: String(b.id || "").trim(),
    bookingId: String(b.id || "").trim(),
    publicId: String(b.publicId || "").trim(),
    clientName: String(b.customerName || "").trim(),
    clientPhone: String(b.phone || "").trim(),
    name: String(b.customerName || "").trim(),
    phone: String(b.phone || "").trim(),
    employeeName: String(b.employeeName || "").trim(),
    employeeId: String(b.employeeId || "").trim() || undefined,
    employeeUid: String(b.employeeUid || "").trim() || undefined,
    date: String(b.date || "").trim(),
    time: String(b.time || "").trim(),
    status: b.status,
    total: totalAmount,
    finalPrice: totalAmount,
    paymentMethod,
    paymentBreakdown,
    paymentType: payment.paymentType,
    paidAmount: payment.paidAmount,
    remainingAmount: payment.remainingAmount,
    createdAt: createdAtMs,
    channel: b.channel || "dashboard",
  };
}

function splitAmountByWeights(amountRaw: number, weightsRaw: number[]) {
  const amount = round2(Math.max(0, Number(amountRaw || 0)));
  const weights = weightsRaw.map((value) => round2(Math.max(0, Number(value || 0))));
  const totalWeight = round2(weights.reduce((sum, value) => sum + value, 0));
  if (amount <= 0 || totalWeight <= 0 || !weights.length) return weights.map(() => 0);

  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return round2(Math.max(0, amount - allocated));
    const part = round2((amount * weight) / totalWeight);
    allocated = round2(allocated + part);
    return part;
  });
}

function paymentTypeFromAmounts(paidAmount: number, remainingAmount: number): BookingPaymentType {
  if (round2(paidAmount) <= 0 && round2(remainingAmount) > 0) return "none";
  if (round2(remainingAmount) > 0) return "partial";
  return "full";
}

function buildBookingInvoiceRows(b: Booking) {
  const base = buildInvoiceBaseFields(b);
  const totalAmount = Number(base.finalPrice || 0);
  const services = extractServicesFromAny(b);
  const pricedServices = services.filter((service) => Number.isFinite(Number(service.price)));
  const servicePricesTotal = round2(pricedServices.reduce((sum, service) => sum + Number(service.price || 0), 0));

  if (services.length > 0 && pricedServices.length === services.length && servicePricesTotal === round2(totalAmount)) {
    const rowPrices = services.map((service) => Number(service.price || 0));
    const paidParts = splitAmountByWeights(Number(base.paidAmount || 0), rowPrices);
    const remainingParts = splitAmountByWeights(Number(base.remainingAmount || 0), rowPrices);
    const cashParts = splitAmountByWeights(Number(base.paymentBreakdown.cash || 0), rowPrices);
    const cardParts = splitAmountByWeights(Number(base.paymentBreakdown.card || 0), rowPrices);
    const transferParts = splitAmountByWeights(Number(base.paymentBreakdown.transfer || 0), rowPrices);

    return services.map((service, index) => ({
      ...base,
      id: `${base.id || base.publicId || "booking"}_${String(service.serviceId || index)}`,
      serviceId: String(service.serviceId || "").trim() || undefined,
      serviceName: String(service.serviceName || "").trim() || serviceSummaryForTable(b),
      serviceSectionTitle: String(service.sectionLabel || "").trim() || undefined,
      serviceCategoryName: String(service.categoryLabel || "").trim() || undefined,
      durationMin: Number.isFinite(Number(service.durationMin)) ? Number(service.durationMin) : b.durationMin,
      total: Number(service.price || 0),
      finalPrice: Number(service.price || 0),
      paymentBreakdown: {
        cash: cashParts[index] || 0,
        card: cardParts[index] || 0,
        transfer: transferParts[index] || 0,
      },
      paymentType: paymentTypeFromAmounts(paidParts[index] || 0, remainingParts[index] || 0),
      paidAmount: paidParts[index] || 0,
      remainingAmount: remainingParts[index] || 0,
      serviceSnapshot: {
        serviceNameAtBooking: String(service.serviceName || "").trim() || serviceSummaryForTable(b),
        sectionTitleAtBooking: String(service.sectionLabel || "").trim() || undefined,
        categoryNameAtBooking: String(service.categoryLabel || "").trim() || undefined,
      },
    }));
  }

  const snapshot = b.serviceSnapshot || {};
  const packageSnapshot = b.packageSnapshot || {};
  const serviceName =
    String(packageSnapshot.packageName || "").trim() ||
    String(snapshot.serviceNameAtBooking || "").trim() ||
    serviceSummaryForTable(b);

  return [
    {
      ...base,
      serviceId: String(b.serviceId || "").trim() || undefined,
      serviceName,
      serviceSectionTitle: String(snapshot.sectionTitleAtBooking || "").trim() || undefined,
      serviceCategoryName: String(snapshot.categoryNameAtBooking || "").trim() || undefined,
      durationMin:
        Number(packageSnapshot.totalDurationMinAtBooking || 0) > 0
          ? Number(packageSnapshot.totalDurationMinAtBooking || 0)
          : b.durationMin,
      serviceSnapshot: {
        serviceNameAtBooking: serviceName,
        sectionIdAtBooking: String(snapshot.sectionIdAtBooking || "").trim() || undefined,
        sectionTitleAtBooking: String(snapshot.sectionTitleAtBooking || "").trim() || undefined,
        categoryIdAtBooking: String(snapshot.categoryIdAtBooking || "").trim() || undefined,
        categoryNameAtBooking: String(snapshot.categoryNameAtBooking || "").trim() || undefined,
      },
    },
  ];
}

function stageBookingInvoiceForPrint(b: Booking) {
  const rows = buildBookingInvoiceRows(b);
  createInvoicePrintRequestId("dashboard_booking_reprint");
  localStorage.setItem("allBookings", JSON.stringify(rows));
  localStorage.setItem("currentBooking", JSON.stringify(rows[0] || null));
  return rows;
}

function normalizeCorePaymentMethod(method: string): "cash" | "card" | "transfer" | "other" {
  const value = String(method || "").trim().toLowerCase();
  if (value === "cash") return "cash";
  if (value === "card" || value === "mada" || value === "network") return "card";
  if (value === "transfer" || value === "bank_transfer") return "transfer";
  return "other";
}

function resolvePaymentMethodFromBreakdown(
  breakdown: { cash: number; card: number; transfer: number },
  fallback?: string
): "cash" | "card" | "transfer" | "mixed" | undefined {
  const active = [
    breakdown.cash > 0 ? "cash" : "",
    breakdown.card > 0 ? "card" : "",
    breakdown.transfer > 0 ? "transfer" : "",
  ].filter(Boolean);
  if (active.length > 1) return "mixed";
  if (active.length === 1) return active[0] as "cash" | "card" | "transfer";
  const normalized = normalizeCorePaymentMethod(String(fallback || ""));
  return normalized === "other" ? undefined : normalized;
}

async function enrichCoreBookingForInvoicePrint(booking: Booking): Promise<Booking> {
  const bookingId = String(booking?.id || "").trim();
  if (!bookingId) return booking;

  const invoice = await CoreInvoiceService.getByBookingId(bookingId).catch(() => null);
  const payments = await CorePaymentService.list()
    .then((rows) =>
      rows.filter((payment) => {
        const paymentBookingId = String(payment.bookingId || "").trim();
        const paymentInvoiceId = String(payment.invoiceId || "").trim();
        return (
          paymentBookingId === bookingId ||
          (!!invoice?.id && paymentInvoiceId === invoice.id)
        );
      })
    )
    .catch(() => []);

  const totalAmount = invoice
    ? round2(Number(invoice.totalHalalas || 0) / 100)
    : readBookingTotalAmount(booking);
  const paidAmount = invoice
    ? round2(Number(invoice.paidHalalas || 0) / 100)
    : round2(payments.reduce((sum, payment) => sum + Number(payment.amountHalalas || 0) / 100, 0));
  const remainingAmount = round2(Math.max(0, totalAmount - paidAmount));
  const breakdown = payments.reduce(
    (sum, payment) => {
      const amount = round2(Number(payment.amountHalalas || 0) / 100);
      const method = normalizeCorePaymentMethod(payment.method);
      if (method === "cash") sum.cash = round2(sum.cash + amount);
      if (method === "card") sum.card = round2(sum.card + amount);
      if (method === "transfer") sum.transfer = round2(sum.transfer + amount);
      return sum;
    },
    { cash: 0, card: 0, transfer: 0 }
  );
  const paymentMethod = resolvePaymentMethodFromBreakdown(breakdown, payments[0]?.method);

  return {
    ...booking,
    total: totalAmount,
    finalPrice: totalAmount,
    discountAmount: invoice ? round2(Number(invoice.discountHalalas || 0) / 100) : (booking as any).discountAmount,
    paidAmount,
    remainingAmount,
    paymentType: paidAmount <= 0 && remainingAmount > 0 ? "none" : remainingAmount > 0 ? "partial" : "full",
    paymentMethod,
    paymentBreakdown: breakdown,
    invoiceId: invoice?.id || (booking as any).invoiceId,
    invoiceNumber: invoice?.invoiceNumber || (booking as any).invoiceNumber,
  } as Booking;
}

function toLocalISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthRangeFromOffset(offset: number) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1, 12);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 12);
  return { from: toLocalISODate(first), to: toLocalISODate(last) };
}

function datePresetRange(preset: DatePresetOption) {
  const today = todayISOLocal();
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = shiftISODate(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "week") {
    const now = new Date();
    const sundayOffset = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sundayOffset, 12);
    return { from: toLocalISODate(start), to: today };
  }
  if (preset === "month") return monthRangeFromOffset(0);
  if (preset === "last_month") return monthRangeFromOffset(-1);
  return { from: "", to: "" };
}

function dateFilterLabel(dateFrom: string, dateTo: string, datePreset: DatePresetOption) {
  if (datePreset === "all" || (!dateFrom && !dateTo)) return "كل الحجوزات";
  const labels: Record<DatePresetOption, string> = {
    all: "كل الحجوزات",
    today: "اليوم",
    yesterday: "أمس",
    week: "هذا الأسبوع",
    month: "هذا الشهر",
    last_month: "الشهر الماضي",
    custom: "نطاق مخصص",
  };
  return `${labels[datePreset] || "نطاق مخصص"} (${dateFrom || "البداية"} - ${dateTo || "النهاية"})`;
}

function normalizeEditBookingTimeInput(raw: string): string {
  const arabicIndicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicDigits = "۰۱۲۳۴۵۶۷۸۹";
  const normalized = String(raw || "")
    .replace(/[٠-٩]/g, (digit) => String(arabicIndicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternArabicDigits.indexOf(digit)))
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  const match = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp]\.?[Mm]\.?|[صم]))?$/u);
  if (!match) return "";

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = String(match[3] || "").toLowerCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return "";
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return "";
    const isAm = meridiem === "ص" || meridiem === "am" || meridiem === "a.m.";
    const isPm = meridiem === "م" || meridiem === "pm" || meridiem === "p.m.";
    if (!isAm && !isPm) return "";
    if (isAm) {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours < 0 || hours > 23) {
    return "";
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizedDigitsOnly(raw: string): string {
  const arabicIndicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicDigits = "۰۱۲۳۴۵۶۷۸۹";
  return digitsOnly(
    String(raw || "")
      .replace(/[٠-٩]/g, (digit) => String(arabicIndicDigits.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String(easternArabicDigits.indexOf(digit)))
  );
}

type UiPaymentMode = BookingPaymentType | "none";
type EditPaymentMethodOption = PaymentMethod | "none";
type EditSectionOption = { id: string; name: string };
type EditCategoryOption = { id: string; name: string; sectionId: string };
type EditServiceOption = {
  id: string;
  name: string;
  sectionId: string;
  categoryId: string;
  price: number;
  durationMin: number;
};
type EditEmployeeOption = {
  id: string;
  name: string;
  linkedUid?: string;
  active?: boolean;
};

type EditBookingDraft = {
  customerName: string;
  phone: string;
  note: string;
  employeeId: string;
  date: string;
  time: string;
  sectionId: string;
  categoryId: string;
  serviceId: string;
  price: string;
  paymentMethod: EditPaymentMethodOption;
  paymentType: BookingPaymentType;
  paidAmount: string;
  mixedCashAmount: string;
  mixedCardAmount: string;
};

function sanitizeBookingNoteForEditor(value: unknown): string {
  return String(value ?? "")
    .split(/\r?\n|\s*\|\s*/g)
    .map((part) => part.trim())
    .filter((part) => {
      const normalized = part.toLowerCase();
      return !(
        normalized.startsWith("payment_method:") ||
        normalized.startsWith("payment_type:") ||
        normalized.startsWith("paid_amount:") ||
        normalized.startsWith("remaining_amount:") ||
        normalized.startsWith("invoice_from_reception:")
      );
    })
    .filter(Boolean)
    .join("\n");
}

function buildEditBookingDraftFromBooking(b: Booking): EditBookingDraft {
  const payment = resolveBookingPaymentSummary(b);
  const paymentMethod = detectPaymentMethod(b);
  const primaryService = resolvePrimaryBookingServiceSelection(b);
  const hasNoPayment = Number(payment.paidAmount || 0) <= 0;
  const breakdown = readPaymentBreakdown(b);

  return {
    customerName: String(b.customerName || "").trim(),
    phone: String(b.phone || "").trim(),
    note: sanitizeBookingNoteForEditor((b as any)?.note),
    employeeId: String((b as any)?.employeeId || "").trim(),
    date: String(b.date || "").trim(),
    time: normalizeEditBookingTimeInput(String(b.time || "").trim()) || String(b.time || "").trim(),
    sectionId: primaryService.sectionId,
    categoryId: primaryService.categoryId,
    serviceId: primaryService.serviceId,
    price: String(readBookingTotalAmount(b)),
    paymentMethod: (hasNoPayment ? "none" : paymentMethod) as EditPaymentMethodOption,
    paymentType: hasNoPayment ? "partial" : payment.paymentType,
    paidAmount: String(payment.paidAmount || 0),
    mixedCashAmount: String(breakdown.cash || ""),
    mixedCardAmount: String(breakdown.card || ""),
  };
}

function resolvePrimaryBookingServiceSelection(booking: Partial<Booking> | null | undefined) {
  const firstService = Array.isArray(booking?.services) && booking?.services?.length ? booking.services[0] : null;
  const firstPackageService =
    Array.isArray((booking as any)?.packageSnapshot?.services) && (booking as any)?.packageSnapshot?.services?.length
      ? (booking as any).packageSnapshot.services[0]
      : null;

  return {
    serviceId: String(
      booking?.serviceId ||
        firstService?.serviceId ||
        firstPackageService?.serviceId ||
        ""
    ).trim(),
    serviceName: String(
      booking?.serviceName ||
        firstService?.serviceName ||
        firstPackageService?.serviceName ||
        ""
    ).trim(),
    sectionId: String(
      booking?.serviceSnapshot?.sectionIdAtBooking ||
        (firstService as any)?.sectionId ||
        firstPackageService?.sectionId ||
        ""
    ).trim(),
    categoryId: String(
      booking?.serviceSnapshot?.categoryIdAtBooking ||
        (firstService as any)?.categoryId ||
        firstPackageService?.categoryId ||
        ""
    ).trim(),
  };
}

type Booking = {
  id: string;
  publicId?: string;
  bookingGroupId?: string;
  parentBookingId?: string;
  isParentBooking?: boolean;
  isSubBooking?: boolean;
  userId?: string | null;
  channel?: "client" | "dashboard" | "internal";
  createdBy?: string;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdByName?: string | null;
  customerName?: string;
  phone?: string;
  serviceName?: string;
  serviceId?: string;
  note?: string;
  services?: BookingServiceItem[];
  serviceSnapshot?: {
    serviceNameAtBooking?: string;
    priceAtBooking?: number;
    durationAtBooking?: number;
    sectionIdAtBooking?: string;
    sectionTitleAtBooking?: string;
    categoryIdAtBooking?: string;
    categoryNameAtBooking?: string;
  };
  packageId?: string | null;
  fromSessionPackage?: boolean;
  consumeOneSession?: boolean;
  sessionPackageId?: string;
  packageSnapshot?: {
    packageId?: string;
    packageName?: string;
    finalPriceAtBooking?: number;
    baseTotalPriceAtBooking?: number;
    totalDurationMinAtBooking?: number;
    services?: Array<{
      serviceId?: string;
      serviceName?: string;
      sectionId?: string;
      sectionTitle?: string;
      categoryId?: string;
      categoryName?: string;
      price?: number;
      durationMin?: number;
    }>;
  };
  durationMin?: number;
  slotStepMinAtBooking?: number;
  bufferMinAtBooking?: number;
  employeeName?: string;
  employeeId?: string | null;
  employeeUid?: string | null;
  employeeKey?: string | null;
  date: string;
  time: string;
  status: BookingStatus;
  paymentMethod?: string;
  paymentBreakdown?: {
    cash?: number;
    card?: number;
    transfer?: number;
  };
  paymentType?: BookingPaymentType;
  paidAmount?: number;
  remainingAmount?: number;
  total?: number;
  finalPrice?: number;
  pendingAt?: number;
  pendingByUid?: string | null;
  pendingByEmail?: string | null;
  pendingByName?: string | null;
  confirmedAt?: number;
  confirmedByUid?: string | null;
  confirmedByEmail?: string | null;
  confirmedByName?: string | null;
  completedAt?: number;
  completedByUid?: string | null;
  completedByEmail?: string | null;
  completedByName?: string | null;
  cancelledAt?: number;
  cancelledByUid?: string | null;
  cancelledByEmail?: string | null;
  cancelledByName?: string | null;
  updatedByUid?: string | null;
  updatedByEmail?: string | null;
  updatedByName?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

type BookingDisplaySection = DashboardBookingDisplaySection<Booking>;

async function getCoreBookingById(id: string): Promise<Booking | null> {
  try {
    return coreBookingToLegacy(await CoreBookingService.get(id)) as Booking;
  } catch {
    return null;
  }
}

async function updateCoreBookingFields(id: string, patch: Partial<Booking>) {
  await coreD1BookingDataSource.updateBooking(id, patch as any);
}

async function updateCoreBookingStatus(id: string, status: BookingStatus) {
  await coreD1BookingDataSource.updateBookingStatus(id, status);
}

async function deleteCoreBooking(id: string) {
  await CoreBookingService.remove(id);
}

async function updateCoreBookingsStatusBatch(args: {
  bookingIds: string[];
  status: BookingStatus;
  note?: string;
  filterSummary?: string;
}) {
  const bookingIds = Array.from(
    new Set(args.bookingIds.map((id) => String(id || "").trim()).filter(Boolean))
  );
  const successes: string[] = [];
  const failures: Array<{ bookingId: string; message: string }> = [];

  for (const bookingId of bookingIds) {
    try {
      await updateCoreBookingStatus(bookingId, args.status);
      successes.push(bookingId);
    } catch (error: any) {
      failures.push({
        bookingId,
        message: String(error?.message || error || "UNKNOWN_ERROR"),
      });
    }
  }

  try {
    await CoreAuditService.record({
      action: "booking_bulk_status_updated",
      entityType: "booking",
      entityId: `bulk_${Date.now()}`,
      description: args.note || `Bulk booking status update to ${args.status}`,
      source: "dashboard",
      actorUid: auth.currentUser?.uid || undefined,
      actorEmail: auth.currentUser?.email || undefined,
      actorName: auth.currentUser?.displayName || undefined,
      after: {
        status: args.status,
        bookingIds,
        successCount: successes.length,
        failedCount: failures.length,
      },
      meta: {
        filterSummary: args.filterSummary || "",
        successes,
        failures,
      },
    });
  } catch {
    // Operational update succeeded; audit failure must not block the dashboard.
  }

  return {
    requestedCount: bookingIds.length,
    successCount: successes.length,
    failedCount: failures.length,
    successes,
    failures,
  };
}

function parseCoreAuditJson(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

type ClientLoyaltyInfo = {
  points: number;
  loyaltyScore: number;
  isVip: boolean;
};

function createEmptyClientLoyaltyInfo(): ClientLoyaltyInfo {
  return { points: 0, loyaltyScore: 0, isVip: false };
}

function toClientLoyaltyInfo(raw: any): ClientLoyaltyInfo {
  return {
    points: Number(raw?.loyaltyPoints || 0),
    loyaltyScore: Number(raw?.loyaltyStats?.loyaltyScore || 0),
    isVip: !!raw?.vip?.isVip,
  };
}

type RefundRecord = {
  incomeId: string;
  bookingId: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  details: string;
  date: string;
};

type RefundDraft = {
  amount: string;
  method: PaymentMethod;
  reason: string;
  details: string;
  date: string;
};

function normalizeIncomePaymentMethod(raw: any): PaymentMethod {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  if (s === "other") return "other";
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق")) return "card";
  if (s.includes("تحويل")) return "transfer";
  return "transfer";
}

type SensitiveBookingAction =
  | { kind: "status"; bookingId: string; nextStatus: BookingStatus; bookingRef: string }
  | { kind: "edit"; booking: Booking }
  | { kind: "refund"; booking: Booking }
  | { kind: "delete"; booking: Booking };

function sensitiveActionDescription(action: SensitiveBookingAction | null) {
  if (!action) return "";
  if (action.kind === "status") {
    return `تغيير حالة الحجز ${action.bookingRef} إلى ${statusLabel[action.nextStatus]}`;
  }
  if (action.kind === "edit") return `تعديل بيانات الحجز ${bookingRef(action.booking)}`;
  if (action.kind === "refund") return `إدارة استرجاع الحجز ${bookingRef(action.booking)}`;
  return `إزالة الحجز ${bookingRef(action.booking)} من صفحة الحجوزات`;
}

type ActionPinModalProps = {
  action: SensitiveBookingAction | null;
  onClose: () => void;
  onConfirm: (action: SensitiveBookingAction) => Promise<void>;
  onVerifyPassword: (password: string) => Promise<void>;
};

const ActionPinModal = memo(function ActionPinModal({
  action,
  onClose,
  onConfirm,
  onVerifyPassword,
}: ActionPinModalProps) {
  const open = !!action;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordInputId = "booking_action_account_password_input";
  const passwordHintId = "booking_action_account_password_hint";

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setBusy(false);
    setError("");
  }, [open, action?.kind]);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!action) return;
    if (!String(password).trim()) {
      setError("أدخلي كلمة مرور الحساب الحالي.");
      return;
    }

    let shouldClose = false;
    setBusy(true);
    setError("");

    try {
      await onVerifyPassword(password);
      await onConfirm(action);
      shouldClose = true;
    } catch (caught) {
      const code = String((caught as any)?.code || "").toLowerCase();
      if (
        code.includes("invalid-credential") ||
        code.includes("wrong-password") ||
        code.includes("invalid-login-credentials")
      ) {
        setError("كلمة المرور غير صحيحة.");
      } else if (code.includes("too-many-requests")) {
        setError("تم إيقاف المحاولات مؤقتًا بسبب كثرة المحاولات. انتظري قليلًا ثم أعيدي المحاولة.");
      } else if (code.includes("requires-recent-login")) {
        setError("انتهت صلاحية التحقق. سجّلي الخروج ثم ادخلي مرة أخرى.");
      } else {
        setError(
          caught instanceof Error && String(caught.message || "").trim()
            ? caught.message
            : "تعذر التحقق من كلمة المرور."
        );
      }
    } finally {
      setBusy(false);
    }

    if (shouldClose) onClose();
  }, [action, onClose, onConfirm, onVerifyPassword, password]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      ariaLabel="التحقق بكلمة مرور الحساب"
      overlayClassName="bk-action-pin-overlay"
      panelClassName="bk-cancel-modal bk-action-pin-modal"
      size="sm"
    >
      <div className="bk-cancel-head">تأكيد كلمة مرور الحساب</div>
      <div className="bk-cancel-body">
        <div className="bk-action-pin-summary">
          <div className="bk-action-pin-summary-label">الإجراء المطلوب</div>
          <div className="bk-action-pin-summary-value">
            {sensitiveActionDescription(action) || "إجراء حساس"}
          </div>
          {action?.kind === "delete" ? (
            <div className="bk-action-pin-warning">
              سيختفي الحجز من صفحة الحجوزات، مع الاحتفاظ بالفاتورة والمدفوعات والسجل المالي للمراجعة.
            </div>
          ) : null}
        </div>
        <div className="bk-action-pin-form">
          <label className="bk-action-pin-label" htmlFor={passwordInputId}>
            كلمة مرور حسابك الحالي
          </label>
          <input
            id={passwordInputId}
            type="password"
            className="bk-input bk-action-pin-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void handleConfirm();
            }}
            placeholder="أدخلي كلمة مرور الحساب"
            autoComplete="current-password"
            name="booking_action_current_password"
            maxLength={128}
            aria-describedby={passwordHintId}
            disabled={busy}
            autoFocus
          />
          <div className="bk-action-pin-hint" id={passwordHintId}>
            سيتم التحقق من كلمة مرور الحساب المسجل حاليًا قبل تنفيذ الإجراء.
          </div>
        </div>
        {error ? <div className="bk-action-pin-error">{error}</div> : null}
      </div>
      <div className="bk-cancel-foot">
        <button type="button" className="exp-btn ghost" onClick={handleClose} disabled={busy}>
          إلغاء
        </button>
        <button
          type="button"
          className={`exp-btn ${action?.kind === "delete" ? "danger" : ""}`}
          onClick={() => void handleConfirm()}
          disabled={busy}
        >
          {busy ? "جاري التحقق..." : "متابعة"}
        </button>
      </div>
    </Modal>
  );
});

type EditBookingCustomerSectionProps = {
  customerName: string;
  phone: string;
  disabled: boolean;
  onCustomerNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
};

const EditBookingCustomerSection = memo(function EditBookingCustomerSection({
  customerName,
  phone,
  disabled,
  onCustomerNameChange,
  onPhoneChange,
}: EditBookingCustomerSectionProps) {
  return (
    <>
      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>اسم العميلة</div>
        <input
          type="text"
          className="bk-input"
          value={customerName}
          onChange={(e) => onCustomerNameChange(e.target.value)}
          placeholder="مثال: سارة أحمد"
          disabled={disabled}
        />
      </label>

      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>رقم الجوال</div>
        <input
          type="text"
          className="bk-input"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder="05xxxxxxxx"
          disabled={disabled}
        />
      </label>
    </>
  );
});

type EditBookingCatalogSectionProps = {
  sectionId: string;
  categoryId: string;
  serviceId: string;
  sections: EditSectionOption[];
  categories: EditCategoryOption[];
  services: EditServiceOption[];
  catalogLoading: boolean;
  disabled: boolean;
  onSectionChange: (nextSectionId: string) => void;
  onCategoryChange: (nextCategoryId: string) => void;
  onServiceChange: (nextServiceId: string) => void;
};

const EditBookingCatalogSection = memo(function EditBookingCatalogSection({
  sectionId,
  categoryId,
  serviceId,
  sections,
  categories,
  services,
  catalogLoading,
  disabled,
  onSectionChange,
  onCategoryChange,
  onServiceChange,
}: EditBookingCatalogSectionProps) {
  return (
    <>
      <div className="bk-edit-grid bk-edit-grid--catalog">
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>القسم</div>
          <select
            className="bk-select"
            value={sectionId}
            onChange={(e) => onSectionChange(e.target.value)}
            disabled={disabled || catalogLoading}
          >
            <option value="">اختاري القسم</option>
            {sections.map((section) => (
              <option key={`edit_section_${section.id}`} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>التصنيف</div>
          <select
            className="bk-select"
            value={categoryId}
            onChange={(e) => onCategoryChange(e.target.value)}
            disabled={disabled || catalogLoading || !sectionId || !categories.length}
          >
            <option value="">
              {categories.length ? "بدون تحديد" : "لا توجد تصنيفات"}
            </option>
            {categories.map((category) => (
              <option key={`edit_category_${category.id}`} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>الخدمة</div>
        <select
          className="bk-select"
          value={serviceId}
          onChange={(e) => onServiceChange(e.target.value)}
          disabled={disabled || catalogLoading || !sectionId}
        >
          <option value="">{services.length ? "اختاري الخدمة" : "لا توجد خدمات"}</option>
          {services.map((service) => (
            <option key={`edit_service_${service.id}`} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </label>

      {catalogLoading ? (
        <div className="bk-edit-helper">جاري تحميل الأقسام والتصنيفات والخدمات...</div>
      ) : null}
    </>
  );
});

type EditBookingScheduleSectionProps = {
  employeeId: string;
  staffOptions: EditEmployeeOption[];
  staffLoading: boolean;
  date: string;
  time: string;
  disabled: boolean;
  onEmployeeChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
};

const EditBookingScheduleSection = memo(function EditBookingScheduleSection({
  employeeId,
  staffOptions,
  staffLoading,
  date,
  time,
  disabled,
  onEmployeeChange,
  onDateChange,
  onTimeChange,
}: EditBookingScheduleSectionProps) {
  return (
    <div className="bk-edit-grid">
      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>الموظفة</div>
        <select
          className="bk-select"
          value={employeeId}
          onChange={(e) => onEmployeeChange(e.target.value)}
          disabled={disabled || staffLoading}
        >
          <option value="">
            {staffLoading
              ? "جاري تحميل الموظفات..."
              : staffOptions.length
                ? "اختاري الموظفة"
                : "لا توجد موظفات متاحة"}
          </option>
          {staffOptions.map((staff) => (
            <option key={`edit_employee_${staff.id}`} value={staff.id}>
              {staff.name}
              {staff.active === false ? " (غير نشطة)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>التاريخ</div>
        <input
          type="date"
          className="bk-input"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>الوقت</div>
        <input
          type="time"
          className="bk-input"
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
  );
});

type EditBookingPaymentSectionProps = {
  price: string;
  paymentMethod: EditPaymentMethodOption;
  paymentType: BookingPaymentType;
  paidAmount: string;
  mixedCashAmount: string;
  mixedCardAmount: string;
  disabled: boolean;
  onPriceChange: (value: string) => void;
  onPaymentModeChange: (mode: UiPaymentMode) => void;
  onPaymentMethodChange: (method: EditPaymentMethodOption) => void;
  onPaidAmountChange: (value: string) => void;
  onMixedCashAmountChange: (value: string) => void;
  onMixedCardAmountChange: (value: string) => void;
};

const EditBookingPaymentSection = memo(function EditBookingPaymentSection({
  price,
  paymentMethod,
  paymentType,
  paidAmount,
  mixedCashAmount,
  mixedCardAmount,
  disabled,
  onPriceChange,
  onPaymentModeChange,
  onPaymentMethodChange,
  onPaidAmountChange,
  onMixedCashAmountChange,
  onMixedCardAmountChange,
}: EditBookingPaymentSectionProps) {
  const total = Math.max(0, Number(price || 0));
  const mixedCash = Math.max(0, Number(mixedCashAmount || 0));
  const mixedCard = Math.max(0, Number(mixedCardAmount || 0));
  const mixedPaid = round2(mixedCash + mixedCard);
  const mixedRemaining = round2(total - mixedPaid);
  const remainingAfterEditText = useMemo(() => {
    const paid =
      paymentMethod === "none"
        ? 0
        : paymentMethod === "mixed"
          ? Math.max(0, Number(mixedCashAmount || 0)) + Math.max(0, Number(mixedCardAmount || 0))
        : paymentType === "full"
          ? total
          : Math.max(0, Number(paidAmount || 0));
    return `${round2(Math.max(0, total - paid))} ر.س`;
  }, [mixedCardAmount, mixedCashAmount, paidAmount, paymentMethod, paymentType, price, total]);

  return (
    <>
      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>السعر النهائي</div>
        <input
          type="number"
          min={0}
          step="0.01"
          className="bk-input"
          value={price}
          onChange={(e) => onPriceChange(e.target.value)}
          placeholder="مثال: 120"
          disabled={disabled}
        />
      </label>

      <label>
        <div style={{ fontSize: 13, marginBottom: 4 }}>نوع الدفع</div>
        <select
          className="bk-select"
          value={paymentMethod === "none" ? "none" : paymentType}
          onChange={(e) => onPaymentModeChange(e.target.value as UiPaymentMode)}
          disabled={disabled}
        >
          <option value="full">دفع كامل</option>
          <option value="partial">عربون</option>
          <option value="none">بدون دفع</option>
        </select>
      </label>

      {paymentMethod !== "none" ? (
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>طريقة الدفع</div>
          <select
            className="bk-select"
            value={paymentMethod}
            onChange={(e) => onPaymentMethodChange((e.target.value as EditPaymentMethodOption) || "transfer")}
            disabled={disabled}
          >
            <option value="cash">كاش</option>
            <option value="card">شبكة</option>
            <option value="transfer">تحويل</option>
            <option value="mixed">دفع مختلط</option>
            <option value="other">أخرى</option>
          </select>
        </label>
      ) : null}

      {paymentMethod === "mixed" ? (
        <div className="bk-mixed-payment-box">
          <label>
            <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ الكاش</div>
            <input
              type="number"
              min={0}
              step="0.01"
              className="bk-input"
              value={mixedCashAmount}
              onChange={(e) => onMixedCashAmountChange(e.target.value)}
              placeholder="مثال: 100"
              disabled={disabled}
            />
          </label>
          <label>
            <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ الشبكة</div>
            <input
              type="number"
              min={0}
              step="0.01"
              className="bk-input"
              value={mixedCardAmount}
              onChange={(e) => onMixedCardAmountChange(e.target.value)}
              placeholder="مثال: 200"
              disabled={disabled}
            />
          </label>
          <div className={`bk-mixed-payment-balance ${mixedRemaining === 0 ? "is-balanced" : "is-unbalanced"}`}>
            المجموع: {mixedPaid} ر.س | المتبقي: {round2(Math.max(0, mixedRemaining))} ر.س
          </div>
        </div>
      ) : null}

      {paymentMethod !== "none" && paymentMethod !== "mixed" && paymentType === "partial" ? (
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ العربون</div>
          <input
            type="number"
            min={0}
            step="0.01"
            className="bk-input"
            value={paidAmount}
            onChange={(e) => onPaidAmountChange(e.target.value)}
            placeholder="مثال: 100"
            disabled={disabled}
          />
        </label>
      ) : null}

      <div style={{ fontSize: 12, color: "#667085" }}>
        المتبقي بعد التعديل: {remainingAfterEditText}
      </div>
    </>
  );
});

type EditBookingNoteSectionProps = {
  note: string;
  disabled: boolean;
  onNoteChange: (value: string) => void;
};

const EditBookingNoteSection = memo(function EditBookingNoteSection({
  note,
  disabled,
  onNoteChange,
}: EditBookingNoteSectionProps) {
  return (
    <label>
      <div style={{ fontSize: 13, marginBottom: 4 }}>ملاحظة الحجز</div>
      <textarea
        className="bk-input"
        rows={3}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="ملاحظة داخلية على نفس الحجز"
        disabled={disabled}
      />
    </label>
  );
});

type EditBookingModalProps = {
  target: Booking | null;
  onClose: () => void;
  onSaved: (bookingId: string, patch: Partial<Booking>) => void;
};

const EditBookingModal = memo(function EditBookingModal({ target, onClose, onSaved }: EditBookingModalProps) {
  const open = !!target;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [sections, setSections] = useState<EditSectionOption[]>([]);
  const [categories, setCategories] = useState<EditCategoryOption[]>([]);
  const [services, setServices] = useState<EditServiceOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<EditEmployeeOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const staffCacheRef = useRef<EditEmployeeOption[] | null>(null);
  const [draft, setDraft] = useState<EditBookingDraft>(() =>
    target
      ? buildEditBookingDraftFromBooking(target)
      : {
          customerName: "",
          phone: "",
          note: "",
          employeeId: "",
          date: "",
          time: "",
          sectionId: "",
          categoryId: "",
          serviceId: "",
          price: "",
          paymentMethod: "transfer",
          paymentType: "full",
          paidAmount: "",
          mixedCashAmount: "",
          mixedCardAmount: "",
        }
  );
  const draftTargetIdRef = useRef<string>(target?.id || "");

  useEffect(() => {
    if (!open || !target) return;
    if (draftTargetIdRef.current === target.id) return;
    draftTargetIdRef.current = target.id;
    setDraft(buildEditBookingDraftFromBooking(target));
    setError("");
  }, [open, target?.id]);

  const handleClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  useEffect(() => {
    let cancelled = false;

    const loadEditSections = async () => {
      if (!open || !target) return;

      setCatalogLoading(true);
      try {
        const rows = await resolveBookingDataSource().getServiceSections();
        if (cancelled) return;

        const nextSections = (rows || [])
          .map((raw: any) => ({
            id: String(raw?.id || "").trim(),
            name: readCatalogLabel(raw, String(raw?.id || "").trim()),
            active: raw?.active !== false,
          }))
          .filter((row) => row.id && row.name && row.active)
          .map(({ id, name }) => ({ id, name }));

        setSections(nextSections);
      } catch {
        if (!cancelled) setSections([]);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    };

    void loadEditSections();
    return () => {
      cancelled = true;
    };
  }, [open, target?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadEditSectionCatalog = async () => {
      if (!open || !target || !draft.sectionId) {
        setCategories([]);
        setServices([]);
        return;
      }

      setCatalogLoading(true);
      try {
        const sectionId = String(draft.sectionId || "").trim();
        const dataSource = resolveBookingDataSource();
        const [categoryRows, serviceRows] = await Promise.all([
          dataSource.getServiceCategories(sectionId),
          dataSource.getServices(sectionId),
        ]);

        if (cancelled) return;

        const nextCategories = (categoryRows || [])
          .map((raw: any) => ({
            id: String(raw?.id || "").trim(),
            name: readCatalogLabel(raw, String(raw?.id || "").trim()),
            sectionId: String(raw?.sectionId || sectionId).trim(),
            active: raw?.active !== false,
          }))
          .filter((row) => row.id && row.name && row.active);

        const nextServices = (serviceRows || [])
          .map((raw: any) => {
            const duration = Number(raw?.durationMin ?? raw?.duration ?? raw?.["المدة"] ?? 60) || 60;
            const price = Number(raw?.price ?? raw?.["السعر"] ?? 0) || 0;
            return {
              id: String(raw?.id || "").trim(),
              name: readCatalogLabel(raw, String(raw?.id || "").trim()),
              sectionId: String(raw?.sectionId || sectionId).trim(),
              categoryId: String(raw?.categoryId || "").trim(),
              price: Math.max(0, price),
              durationMin: Math.max(5, duration),
              active: raw?.active !== false,
            };
          })
          .filter((row) => row.id && row.name && row.active);

        setCategories(nextCategories);
        setServices(nextServices);
      } catch {
        if (!cancelled) {
          setCategories([]);
          setServices([]);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    };

    void loadEditSectionCatalog();
    return () => {
      cancelled = true;
    };
  }, [draft.sectionId, open, target?.id]);

  useEffect(() => {
    let cancelled = false;

    const hydrateEditSelectionFromService = async () => {
      if (!open || !target || draft.sectionId || !draft.serviceId) return;
      const currentServiceId = String(draft.serviceId || "").trim();
      if (!currentServiceId) return;

      try {
        const serviceRows = await resolveBookingDataSource().getServices();
        if (cancelled) return;
        const raw: any = (serviceRows || []).find(
          (row: any) => String(row?.id || "").trim() === currentServiceId
        );
        if (!raw) return;
        const nextSectionId = String(raw?.sectionId || "").trim();
        const nextCategoryId = String(raw?.categoryId || "").trim();
        if (!nextSectionId) return;

        setDraft((prev) =>
          prev.serviceId !== currentServiceId
            ? prev
            : {
                ...prev,
                sectionId: prev.sectionId || nextSectionId,
                categoryId: prev.categoryId || nextCategoryId,
              }
        );
      } catch {
        // ignore
      }
    };

    void hydrateEditSelectionFromService();
    return () => {
      cancelled = true;
    };
  }, [draft.sectionId, draft.serviceId, open, target?.id]);

  useEffect(() => {
    let cancelled = false;

    const mergeCurrentEmployee = (rows: EditEmployeeOption[]) => {
      const currentId = String(target?.employeeId || "").trim();
      if (!currentId) return rows;
      if (rows.some((row) => row.id === currentId)) return rows;

      const currentName = String(target?.employeeName || "").trim() || currentId;
      const currentUid = String(target?.employeeUid || "").trim() || undefined;
      return [
        ...rows,
        {
          id: currentId,
          name: currentName,
          linkedUid: currentUid,
          active: false,
        },
      ];
    };

    const loadEditStaffOptions = async () => {
      if (!open || !target) return;

      const cached = staffCacheRef.current;
      if (Array.isArray(cached)) {
        if (!cancelled) setStaffOptions(mergeCurrentEmployee(cached));
        return;
      }

      setStaffLoading(true);
      try {
        const rows = await resolveBookingDataSource().getActiveStaff();
        const nextOptions = (rows || [])
          .map((row: StaffPublicWithId) => ({
            id: String(row.id || "").trim(),
            name: String(row.name || "").trim(),
            linkedUid: String(row.linkedUid || "").trim() || undefined,
            active: row.active !== false,
          }))
          .filter((row) => row.id && row.name)
          .sort((a, b) => a.name.localeCompare(b.name));

        staffCacheRef.current = nextOptions;
        if (!cancelled) setStaffOptions(mergeCurrentEmployee(nextOptions));
      } catch {
        if (!cancelled) setStaffOptions(mergeCurrentEmployee([]));
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    };

    void loadEditStaffOptions();
    return () => {
      cancelled = true;
    };
  }, [open, target?.employeeId, target?.employeeName, target?.employeeUid, target?.id]);

  useEffect(() => {
    if (!open || !target) return;
    if (draft.employeeId) return;
    const targetKey = normalizeArabicName(String(target.employeeName || "").trim());
    if (!targetKey) return;
    const match = staffOptions.find(
      (row) => normalizeArabicName(String(row.name || "").trim()) === targetKey
    );
    if (!match) return;
    setDraft((prev) => (prev.employeeId ? prev : { ...prev, employeeId: match.id }));
  }, [draft.employeeId, open, staffOptions, target?.employeeName, target?.id]);

  const filteredServices = useMemo(() => {
    const selectedCategoryId = String(draft.categoryId || "").trim();
    if (!selectedCategoryId) return services;
    const hasStructuredCategories = categories.length > 0;
    if (!hasStructuredCategories) return services;
    return services.filter((service) => String(service.categoryId || "").trim() === selectedCategoryId);
  }, [categories.length, draft.categoryId, services]);

  const onCustomerNameChange = useCallback((value: string) => {
    setDraft((prev) => (prev.customerName === value ? prev : { ...prev, customerName: value }));
  }, []);
  const onPhoneChange = useCallback((value: string) => {
    setDraft((prev) => (prev.phone === value ? prev : { ...prev, phone: value }));
  }, []);
  const onSectionChange = useCallback((nextSectionId: string) => {
    setDraft((prev) =>
      prev.sectionId === nextSectionId
        ? prev
        : { ...prev, sectionId: nextSectionId, categoryId: "", serviceId: "" }
    );
  }, []);
  const onCategoryChange = useCallback((nextCategoryId: string) => {
    setDraft((prev) =>
      prev.categoryId === nextCategoryId ? prev : { ...prev, categoryId: nextCategoryId, serviceId: "" }
    );
  }, []);
  const onServiceChange = useCallback(
    (nextServiceId: string) => {
      const nextService = filteredServices.find((service) => service.id === nextServiceId) || null;
      setDraft((prev) => {
        const originalServiceId = resolvePrimaryBookingServiceSelection(target).serviceId;
        const isOriginalService = nextServiceId === originalServiceId;
        return {
          ...prev,
          serviceId: nextServiceId,
          categoryId: nextService?.categoryId || prev.categoryId,
          // Preserve the historical booked price when the same service is selected.
          // Use the current catalog price only when the administrator intentionally changes the service.
          price: nextService
            ? isOriginalService
              ? String(readBookingTotalAmount(target))
              : String(nextService.price || 0)
            : prev.price,
        };
      });
    },
    [filteredServices, target]
  );
  const onEmployeeChange = useCallback((value: string) => {
    setDraft((prev) => (prev.employeeId === value ? prev : { ...prev, employeeId: value }));
  }, []);
  const onDateChange = useCallback((value: string) => {
    setDraft((prev) => (prev.date === value ? prev : { ...prev, date: value }));
  }, []);
  const onTimeChange = useCallback((value: string) => {
    const normalizedValue = normalizeEditBookingTimeInput(value) || String(value || "").trim();
    setDraft((prev) => (prev.time === normalizedValue ? prev : { ...prev, time: normalizedValue }));
  }, []);
  const onPriceChange = useCallback((value: string) => {
    setDraft((prev) => (prev.price === value ? prev : { ...prev, price: value }));
  }, []);
  const onPaymentModeChange = useCallback((nextMode: UiPaymentMode) => {
    setDraft((p) => {
      if (nextMode === "none") {
        return {
          ...p,
          paymentType: "partial",
          paymentMethod: "none",
          paidAmount: "0",
        };
      }
      if (nextMode !== "full" && p.paymentMethod === "mixed") {
        return {
          ...p,
          paymentType: "partial",
          paymentMethod: "cash",
        };
      }
      return {
        ...p,
        paymentType: nextMode === "full" ? "full" : "partial",
        paymentMethod: p.paymentMethod === "none" ? "transfer" : p.paymentMethod,
      };
    });
  }, []);
  const onPaymentMethodChange = useCallback((method: EditPaymentMethodOption) => {
    setDraft((p) => ({
      ...p,
      paymentMethod: method || "transfer",
      paymentType: method === "mixed" ? "full" : p.paymentType,
    }));
  }, []);
  const onPaidAmountChange = useCallback((value: string) => {
    setDraft((prev) => (prev.paidAmount === value ? prev : { ...prev, paidAmount: value }));
  }, []);
  const onMixedCashAmountChange = useCallback((value: string) => {
    setDraft((prev) => (prev.mixedCashAmount === value ? prev : { ...prev, mixedCashAmount: value }));
  }, []);
  const onMixedCardAmountChange = useCallback((value: string) => {
    setDraft((prev) => (prev.mixedCardAmount === value ? prev : { ...prev, mixedCardAmount: value }));
  }, []);
  const onNoteChange = useCallback((value: string) => {
    setDraft((prev) => (prev.note === value ? prev : { ...prev, note: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!target?.id) return;

    const customerName = String(draft.customerName || "").trim();
    const phone = String(draft.phone || "").trim();
    const note = String(draft.note || "").trim();
    const employeeId = String(draft.employeeId || "").trim();
    const date = String(draft.date || "").trim();
    const time = normalizeEditBookingTimeInput(String(draft.time || "").trim());
    const sectionId = String(draft.sectionId || "").trim();
    const categoryId = String(draft.categoryId || "").trim();
    const serviceId = String(draft.serviceId || "").trim();
    const priceInput = String(draft.price || "").trim();
    const fallbackPrice = readBookingTotalAmount(target);
    const price = priceInput === "" ? fallbackPrice : Number(priceInput);
    const paymentType = draft.paymentType === "partial" ? "partial" : "full";
    const hasNoPaymentMethod = draft.paymentMethod === "none";
    const isMixedPayment = draft.paymentMethod === "mixed";
    const paymentMethod = (["cash", "card", "transfer", "other", "mixed"] as const).includes(draft.paymentMethod as any)
      ? (draft.paymentMethod as PaymentMethod)
      : "transfer";
    const mixedCashAmount = Math.max(0, Number(draft.mixedCashAmount || 0));
    const mixedCardAmount = Math.max(0, Number(draft.mixedCardAmount || 0));

    const selectedEmployee = staffOptions.find(
      (row) => String(row.id || "").trim() === employeeId
    ) || null;
    const fallbackEmployeeUid =
      String(target.employeeId || "").trim() === employeeId
        ? String(target.employeeUid || "").trim()
        : "";
    const employeeUid = String(selectedEmployee?.linkedUid || fallbackEmployeeUid || "").trim();
    const employeeName = String(selectedEmployee?.name || target.employeeName || "").trim();

    const selectedService = services.find((service) => String(service.id || "").trim() === serviceId) || null;
    const selectedSection = sections.find((section) => String(section.id || "").trim() === sectionId) || null;
    const selectedCategory =
      categories.find((category) => String(category.id || "").trim() === categoryId) || null;

    let paidAmount = isMixedPayment
      ? round2(mixedCashAmount + mixedCardAmount)
      : paymentType === "full"
        ? price
        : Number(draft.paidAmount || 0);
    if (hasNoPaymentMethod) paidAmount = 0;

    if (!customerName) {
      setError("اسم العميلة مطلوب.");
      return;
    }
    if (!sectionId) {
      setError("القسم مطلوب.");
      return;
    }
    if (!employeeId) {
      setError("الموظفة مطلوبة.");
      return;
    }
    if (!employeeName) {
      setError("تعذر تحديد الموظفة المختارة.");
      return;
    }
    if (!serviceId || !selectedService) {
      setError("الخدمة مطلوبة.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("التاريخ غير صحيح.");
      return;
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError("الوقت غير صحيح (HH:MM).");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError("السعر غير صحيح.");
      return;
    }
    if (isMixedPayment) {
      if (
        !Number.isFinite(mixedCashAmount) ||
        !Number.isFinite(mixedCardAmount) ||
        mixedCashAmount < 0 ||
        mixedCardAmount < 0
      ) {
        setError("مبالغ الدفع المختلط يجب أن تكون 0 أو أكثر.");
        return;
      }
      if (round2(mixedCashAmount + mixedCardAmount) !== round2(price)) {
        setError("مجموع الكاش والشبكة يجب أن يساوي إجمالي الحجز.");
        return;
      }
    }
    if (!isMixedPayment && paymentType === "partial") {
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        setError("أدخلي مبلغ عربون صحيح (0 أو أكثر).");
        return;
      }
      if (paidAmount > price) {
        setError("مبلغ العربون لا يمكن أن يتجاوز إجمالي الحجز.");
        return;
      }
    }

    let nextPaymentType: BookingPaymentType = paymentType;
    if (hasNoPaymentMethod) nextPaymentType = "partial";
    if (isMixedPayment) nextPaymentType = "full";
    if (paidAmount >= price) {
      nextPaymentType = "full";
      paidAmount = price;
    }
    const remainingAmount = round2(Math.max(0, price - paidAmount));
    const paymentBreakdown = isMixedPayment
      ? {
          cash: round2(mixedCashAmount),
          card: round2(mixedCardAmount),
        }
      : null;
    const durationMin = Math.max(5, Number(selectedService?.durationMin || target.durationMin || 60));
    const serviceName = selectedService?.name || target.serviceName || "";
    const sectionName = selectedSection?.name || sectionId;
    const categoryName = selectedCategory?.name || "";
    const serviceSnapshot = {
      serviceNameAtBooking: serviceName,
      priceAtBooking: price,
      durationAtBooking: durationMin,
      sectionIdAtBooking: sectionId || undefined,
      sectionTitleAtBooking: sectionName || undefined,
      categoryIdAtBooking: categoryId || undefined,
      categoryNameAtBooking: categoryName || undefined,
    };
    const servicesPatch = [
      {
        serviceId,
        serviceName,
        price,
        durationMin,
        sectionId,
        sectionTitle: sectionName || undefined,
        categoryId: categoryId || undefined,
        categoryName: categoryName || undefined,
      },
    ];

    const targetEmployeeId = String(target.employeeId || "").trim();
    const targetEmployeeName = String(target.employeeName || "").trim();
    const shouldUpdateEmployee = employeeId !== targetEmployeeId;
    const employeePatch = shouldUpdateEmployee
      ? {
          employeeId,
          employeeUid: employeeUid || null,
          employeeName: employeeName || targetEmployeeName || "",
          employeeKey: employeeUid || employeeId || undefined,
        }
      : {};

    const isFullyPaidAfterEdit = price > 0 && remainingAmount <= 0;
    let statusAfterEdit: BookingStatus | null = null;
    if (isFullyPaidAfterEdit && (target.status === "pending" || target.status === "confirmed")) {
      const chooseCompleted = window.confirm(
        "تم سداد الحجز كاملاً.\n\nاضغطي \"موافق\" لتحويل الحالة إلى \"مكتمل\".\nاضغطي \"إلغاء\" للإبقاء على الحالة \"مؤكد\"."
      );
      statusAfterEdit = chooseCompleted ? "completed" : "confirmed";
    }

    let shouldClose = false;
    setSaving(true);
    setError("");

    try {
      const patch = {
        ...employeePatch,
        clientName: customerName,
        clientPhone: phone || null,
        note,
        customerName,
        phone: phone || null,
        customerPhone: phone || null,
        date,
        time,
        serviceId,
        serviceName,
        serviceSnapshot,
        services: servicesPatch,
        durationMin,
        packageId: null,
        packageSnapshot: null,
        finalPrice: price,
        total: price,
        paymentMethod: hasNoPaymentMethod ? null : paymentMethod,
        paymentBreakdown,
        paymentType: nextPaymentType,
        paidAmount: round2(paidAmount),
        remainingAmount,
      } as any;
      await updateCoreBookingFields(target.id, patch);
      if (statusAfterEdit && statusAfterEdit !== target.status) {
        await updateCoreBookingStatus(target.id, statusAfterEdit);
      }

      const resolvedStatus = statusAfterEdit || target.status;
      onSaved(target.id, {
        ...employeePatch,
        customerName,
        phone: phone || "",
        note,
        date,
        time,
        serviceId,
        serviceName,
        serviceSnapshot,
        services: servicesPatch,
        durationMin,
        packageId: undefined,
        packageSnapshot: undefined,
        finalPrice: price,
        total: price,
        paymentMethod: hasNoPaymentMethod ? undefined : paymentMethod,
        paymentBreakdown: paymentBreakdown || undefined,
        paymentType: nextPaymentType,
        paidAmount: round2(paidAmount),
        remainingAmount,
        status: resolvedStatus,
      });

      shouldClose = true;
    } catch (e: any) {
      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        setError("الموعد يتعارض مع حجز آخر لنفس الموظفة. اختاري وقتًا أو موظفة أخرى.");
      } else if (e?.code === "BOOKING_DAY_CLOSED") {
        setError("اليوم المختار غير متاح للحجز. اختاري تاريخًا آخر.");
      } else if (e?.code === "BOOKING_TIME_OUT_OF_HOURS") {
        setError("الوقت المختار خارج ساعات الدوام أو لا يكفي لمدة الخدمة والبافر.");
      } else if (e?.code === "EMPLOYEE_UNAVAILABLE") {
        setError("الموظفة المعينة على هذا الحجز لم تعد نشطة تشغيليًا لهذا الموعد. اختاري موظفة أخرى أو أعيدي جدولة الحجز.");
      } else {
        console.error("[DashboardBookings] update booking failed", {
          bookingId: target.id,
          code: e?.code,
          message: e?.message,
          name: e?.name,
          error: e,
        });
        const code = String(e?.code || "").trim();
        setError(
          code
            ? `تعذر حفظ تعديل الحجز (${code}).`
            : "تعذر حفظ تعديل الحجز. راجعي Console لمعرفة الخطأ التفصيلي."
        );
      }
    } finally {
      setSaving(false);
    }

    if (shouldClose) onClose();
  }, [categories, draft, onClose, onSaved, sections, services, staffOptions, target]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      ariaLabel="تعديل الحجز"
      panelClassName="bk-edit-modal"
      size="sm"
    >
      <div className="bk-cancel-head">تعديل الحجز</div>
      <div className="bk-cancel-body">
        <div className="bk-cancel-meta">
          <span>رقم الحجز: {bookingRef(target)}</span>
          <span>الخدمة: {target ? serviceSummaryForTable(target) : "—"}</span>
        </div>

        <div className="bk-edit-form">
          <EditBookingCustomerSection
            customerName={draft.customerName}
            phone={draft.phone}
            disabled={saving}
            onCustomerNameChange={onCustomerNameChange}
            onPhoneChange={onPhoneChange}
          />

          <EditBookingCatalogSection
            sectionId={draft.sectionId}
            categoryId={draft.categoryId}
            serviceId={draft.serviceId}
            sections={sections}
            categories={categories}
            services={filteredServices}
            catalogLoading={catalogLoading}
            disabled={saving}
            onSectionChange={onSectionChange}
            onCategoryChange={onCategoryChange}
            onServiceChange={onServiceChange}
          />

          <EditBookingScheduleSection
            employeeId={draft.employeeId}
            staffOptions={staffOptions}
            staffLoading={staffLoading}
            date={draft.date}
            time={draft.time}
            disabled={saving}
            onEmployeeChange={onEmployeeChange}
            onDateChange={onDateChange}
            onTimeChange={onTimeChange}
          />

          <EditBookingPaymentSection
            price={draft.price}
            paymentMethod={draft.paymentMethod}
            paymentType={draft.paymentType}
            paidAmount={draft.paidAmount}
            mixedCashAmount={draft.mixedCashAmount}
            mixedCardAmount={draft.mixedCardAmount}
            disabled={saving}
            onPriceChange={onPriceChange}
            onPaymentModeChange={onPaymentModeChange}
            onPaymentMethodChange={onPaymentMethodChange}
            onPaidAmountChange={onPaidAmountChange}
            onMixedCashAmountChange={onMixedCashAmountChange}
            onMixedCardAmountChange={onMixedCardAmountChange}
          />

          <EditBookingNoteSection note={draft.note} disabled={saving} onNoteChange={onNoteChange} />
        </div>

        {error ? <div style={{ color: "#b42318", marginTop: 10, fontSize: 13 }}>{error}</div> : null}
      </div>
      <div className="bk-cancel-foot">
        <button type="button" className="exp-btn ghost" onClick={handleClose} disabled={saving}>
          رجوع
        </button>
        <button type="button" className="exp-btn" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
        </button>
      </div>
    </Modal>
  );
});

/* =========================
   Component
========================= */
type DashboardBookingsProps = {
  currentRole?: UiRole;
};

export default function DashboardBookings({ currentRole = "guest" }: DashboardBookingsProps) {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [liveBookingsSource, setLiveBookingsSource] = useState<Booking[]>([]);
  const [historyBookingsSource, setHistoryBookingsSource] = useState<Booking[]>([]);
  const [error, setError] = useState("");
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusOption>("all");
  const [excludedStatus, setExcludedStatus] = useState<ExcludedStatusOption>("");
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilterOption>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePreset, setDatePreset] = useState<DatePresetOption>("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentMethodFilterOption>("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<BookingSourceFilterOption>("all");
  const [sortOrder, setSortOrder] = useState<SortOrderOption>("newest");
  const [oldPendingFilter, setOldPendingFilter] = useState<OldPendingFilterOption>("off");
  const [oldPendingFrom, setOldPendingFrom] = useState("");
  const [oldPendingTo, setOldPendingTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(() => new Set());
  const [bulkTargetStatus, setBulkTargetStatus] = useState<BookingStatus | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResultMessage, setBulkResultMessage] = useState("");
  const [bulkError, setBulkError] = useState("");

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savedNoteId, setSavedNoteId] = useState("");
  const [clientLoyalty, setClientLoyalty] = useState<ClientLoyaltyInfo | null>(null);
  const [clientLoyaltyLoading, setClientLoyaltyLoading] = useState(false);
  const clientLoyaltyCacheRef = useRef<Record<string, ClientLoyaltyInfo>>({});
  const [selectedBookingActivity, setSelectedBookingActivity] = useState<BookingActivityItem[]>([]);
  const [selectedBookingActivityLoading, setSelectedBookingActivityLoading] = useState(false);
  const [selectedBookingActivityError, setSelectedBookingActivityError] = useState("");
  const [userNamesByUid, setUserNamesByUid] = useState<Record<string, string>>({});
  const [lastUpdateMap, setLastUpdateMap] = useState<Record<string, BookingLastUpdate>>({});
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [refundBusyId, setRefundBusyId] = useState("");
  const [printInvoiceBusyId, setPrintInvoiceBusyId] = useState("");
  const printInvoiceLockRef = useRef(false);
  const [refundMapByBookingId, setRefundMapByBookingId] = useState<Record<string, RefundRecord>>({});
  const [refundTarget, setRefundTarget] = useState<Booking | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundDraft, setRefundDraft] = useState<RefundDraft>({
    amount: "",
    method: "transfer",
    reason: "",
    details: "",
    date: todayISOLocal(),
  });
  const saveHintTimerRef = useRef<number | null>(null);
  const employeeFilterLabelCacheRef = useRef<Map<string, string>>(new Map());
  const serviceFilterLabelCacheRef = useRef<Map<string, string>>(new Map());
  const [editTarget, setEditTarget] = useState<Booking | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Booking | null>(null);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [confirmDraft, setConfirmDraft] = useState({
    paymentMode: "full" as UiPaymentMode,
    paymentType: "full" as BookingPaymentType,
    paidAmount: "",
    paymentMethod: "transfer" as EditPaymentMethodOption,
    mixedCashAmount: "",
    mixedCardAmount: "",
  });
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SensitiveBookingAction | null>(null);
  const searchQueryBeforeSensitiveActionRef = useRef("");
  const [newBookingsSeenAt, setNewBookingsSeenAt] = useState<number>(() => {
    try {
      if (typeof window === "undefined") return 0;
      const raw = Number(window.localStorage.getItem(NEW_BOOKINGS_SEEN_AT_KEY) || "0");
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    } catch {
      return 0;
    }
  });

  const uiRole = currentRole;
  const liveWindowStart = useMemo(
    () => shiftISODate(todayISOLocal(), -LIVE_WINDOW_PAST_DAYS),
    []
  );
  const liveWindowEnd = useMemo(
    () => shiftISODate(todayISOLocal(), LIVE_WINDOW_FUTURE_DAYS),
    []
  );
  const mergedBookingSources = useMemo(
    () => mergeBookingLists(liveBookingsSource, historyBookingsSource),
    [liveBookingsSource, historyBookingsSource]
  );
  const explicitHistoryScope = useMemo(() => {
    const requestsFullHistoryByDate =
      (!!dateFrom && (dateFrom < liveWindowStart || dateFrom > liveWindowEnd)) ||
      (!!dateTo && (dateTo < liveWindowStart || dateTo > liveWindowEnd));

    if (requestsFullHistoryByDate) {
      return {
        cacheKey: `range:${dateFrom || ""}:${dateTo || ""}`,
        scope: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      };
    }

    return {
      cacheKey: `nonlive:${dateFrom || ""}:${dateTo || ""}`,
      scope: {
        statuses: NON_LIVE_HISTORY_STATUSES,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      },
    };
  }, [dateFrom, dateTo, liveWindowStart, liveWindowEnd]);
  const authUser = getAuthUserSafe();
  const authUserUid = String(auth.currentUser?.uid || "").trim();
  const authUserDisplayName = authUser.displayName;
  const canEditBookings = uiRole === "owner" || uiRole === "admin";
  const getLocalActorAudit = useCallback((atMs = Date.now()) => {
    const currentDisplayName = String(auth.currentUser?.displayName || authUser.displayName || "").trim();
    const currentEmail = String(auth.currentUser?.email || authUser.email || "").trim();
    const currentUid = String(auth.currentUser?.uid || "").trim();
    const fallbackEmailLabel = currentEmail ? currentEmail.split("@")[0] : "";
    const mappedUidLabel = currentUid ? String(userNamesByUid[currentUid] || "").trim() : "";
    const actorName =
      currentDisplayName ||
      mappedUidLabel ||
      fallbackEmailLabel ||
      (currentUid ? currentUid.slice(0, 8) : "");

    return {
      atMs,
      updatedAt: atMs,
      updatedByUid: currentUid || null,
      updatedByEmail: currentEmail || null,
      updatedByName: actorName || null,
      label: actorName || "â€”",
    };
  }, [authUser.displayName, authUser.email, userNamesByUid]);
  const touchLastUpdate = useCallback((bookingId: string, atMs = Date.now()) => {
    const id = String(bookingId || "").trim();
    if (!id) return;

    const currentDisplayName = String(auth.currentUser?.displayName || authUser.displayName || "").trim();
    const currentEmail = String(auth.currentUser?.email || authUser.email || "").trim();
    const currentUid = String(auth.currentUser?.uid || "").trim();
    const fallbackEmailLabel = currentEmail ? currentEmail.split("@")[0] : "";
    const mappedUidLabel = currentUid ? String(userNamesByUid[currentUid] || "").trim() : "";
    const by = currentDisplayName || fallbackEmailLabel || mappedUidLabel || (currentUid ? currentUid.slice(0, 8) : "—");

    setLastUpdateMap((prev) => ({
      ...prev,
      [id]: {
        by,
        at: formatAnyDateTime(atMs),
      },
    }));
  }, [authUser.displayName, authUser.email, userNamesByUid]);
  const closeBookingModal = useCallback(() => setSelectedBooking(null), []);
  const closeCancelModal = useCallback(() => setCancelTarget(null), []);
  const closeRefundModal = useCallback(() => {
    if (refundSaving) return;
    setRefundTarget(null);
    setRefundError("");
  }, [refundSaving]);
  const closeEditModal = useCallback(() => setEditTarget(null), []);
  const closeConfirmModal = useCallback(() => {
    if (confirmSaving) return;
    setConfirmTarget(null);
    setConfirmError("");
  }, [confirmSaving]);
  const closeActionPinModal = useCallback(() => setPendingSensitiveAction(null), []);
  const verifyCurrentAccountPassword = useCallback(async (password: string) => {
    const currentUser = auth.currentUser;
    const email = String(currentUser?.email || "").trim();
    if (!currentUser || !email) {
      throw new Error("لا يمكن التحقق من هذا الحساب لأنه لا يحتوي على بريد إلكتروني مسجل.");
    }
    const credential = EmailAuthProvider.credential(email, password);
    await reauthenticateWithCredential(currentUser, credential);
  }, []);

  useEffect(() => {
    return () => {
      if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const uid = String(auth.currentUser?.uid || authUserUid || "").trim();
    const email = String(auth.currentUser?.email || "").trim();
    const name = String(
      auth.currentUser?.displayName || authUserDisplayName || (email ? email.split("@")[0] : "")
    ).trim();
    setUserNamesByUid(uid && name ? { [uid]: name } : {});
  }, [authUserDisplayName, authUserUid]);

  useEffect(() => {
    const loaded = loadNotesMap();
    setNotesMap(loaded);
    setNoteDrafts(loaded);
  }, []);

  useEffect(() => {
    let active = true;
    let firstLoad = true;

    const loadCoreBookings = async () => {
      if (firstLoad) setLoading(true);
      try {
        const data = (await CoreBookingService.list()).map(coreBookingToLegacy);
        if (!active) return;
        setLiveBookingsSource(data as Booking[]);
        setHistoryBookingsSource([]);
        setError("");
      } catch (loadError) {
        if (!active) return;
        console.error("[DashboardBookings] Core booking load failed", loadError);
        setError("تعذر تحميل الحجوزات من Core D1. اضغط تحديث البيانات وحاول مرة أخرى.");
      } finally {
        if (active) setLoading(false);
        firstLoad = false;
      }
    };

    void loadCoreBookings();
    const timer = window.setInterval(() => void loadCoreBookings(), 8_000);
    const handleFocus = () => void loadCoreBookings();
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [bookingsRefreshKey]);

  useEffect(() => {
    const baseList = mergedBookingSources.map((b: any) => ({
      ...b,
      customerName: String(b?.customerName || b?.clientName || b?.name || "").trim() || "غير متوفر",
      phone: String(b?.phone || b?.clientPhone || b?.customerPhone || "").trim() || "غير متوفر",
      services: extractServicesFromAny(b),
    }));
    setBookings(baseList);
  }, [mergedBookingSources]);

  const loadRefundState = useCallback(async () => {
    const refunds = await CoreRefundService.list();
    const next: Record<string, RefundRecord> = {};
    refunds.forEach((refund) => {
      const bookingId = String(refund.bookingId || "").trim();
      if (!bookingId || String(refund.status || "").toLowerCase() === "voided") return;
      const reasonText = String(refund.reason || "").trim();
      const [reason, ...detailParts] = reasonText.split("|").map((part) => part.trim());
      next[bookingId] = {
        incomeId: refund.id,
        bookingId,
        amount: Number(refund.amountHalalas || 0) / 100,
        method: normalizeIncomePaymentMethod(refund.method),
        reason: reason || reasonText,
        details: detailParts.join(" | "),
        date: String(refund.refundedAt || "").slice(0, 10),
      };
    });
    setRefundMapByBookingId(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadRefundState();
      } catch {
        if (!cancelled) setRefundMapByBookingId({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRefundState]);

  useEffect(() => {
    let cancelled = false;
    const loadClientLoyalty = async () => {
      if (!selectedBooking) {
        setClientLoyalty(null);
        return;
      }

      setClientLoyaltyLoading(true);
      try {
        const phoneRaw = String(selectedBooking.phone || "").trim();
        const phoneDigits = digitsOnly(phoneRaw);
        const nameNorm = normalizeArabicName(String(selectedBooking.customerName || ""));
        const relatedBooking = bookings.find((booking) => {
          if (booking.id === selectedBooking.id) return false;
          const samePhone = !!phoneDigits && digitsOnly(String(booking.phone || "")) === phoneDigits;
          const sameName =
            !!nameNorm && normalizeArabicName(String(booking.customerName || "")) === nameNorm;
          return samePhone || sameName;
        });

        const clientIdCandidates = Array.from(
          new Set(
            [selectedBooking.userId, relatedBooking?.userId]
              .map((value) => String(value || "").trim())
              .filter(Boolean)
          )
        );
        const cacheKeys = Array.from(
          new Set([
            ...clientIdCandidates.map((value) => `client:${value}`),
            phoneDigits ? `phone:${phoneDigits}` : "",
          ].filter(Boolean))
        );
        const cachedKey = cacheKeys.find((key) => clientLoyaltyCacheRef.current[key]);
        if (cachedKey) {
          setClientLoyalty(clientLoyaltyCacheRef.current[cachedKey]);
          return;
        }

        let overview = null as Awaited<ReturnType<typeof CoreClientService.overview>> | null;
        for (const clientId of clientIdCandidates) {
          try {
            overview = await CoreClientService.overview(clientId);
            break;
          } catch {
            // Try the next canonical client id.
          }
        }

        if (!overview) {
          const candidates = await CoreClientService.list(phoneDigits || phoneRaw || nameNorm);
          const client = candidates.find((candidate) => {
            const samePhone =
              !!phoneDigits && digitsOnly(String(candidate.phoneNormalized || "")) === phoneDigits;
            const sameName =
              !!nameNorm && normalizeArabicName(String(candidate.name || "")) === nameNorm;
            return samePhone || sameName;
          });
          if (client) overview = await CoreClientService.overview(client.id);
        }

        if (cancelled) return;
        const nextInfo = overview
          ? {
              points: Number(overview.loyalty.balance || 0),
              loyaltyScore: Number(overview.loyalty.earned || 0),
              isVip: Boolean(overview.client.vip),
            }
          : createEmptyClientLoyaltyInfo();
        const finalKeys = Array.from(
          new Set([
            ...cacheKeys,
            overview?.client.id ? `client:${overview.client.id}` : "",
          ].filter(Boolean))
        );
        finalKeys.forEach((key) => {
          clientLoyaltyCacheRef.current[key] = nextInfo;
        });
        setClientLoyalty(nextInfo);
      } catch {
        if (!cancelled) setClientLoyalty(createEmptyClientLoyaltyInfo());
      } finally {
        if (!cancelled) setClientLoyaltyLoading(false);
      }
    };

    void loadClientLoyalty();
    return () => {
      cancelled = true;
    };
  }, [selectedBooking, bookings]);

  useEffect(() => {
    let cancelled = false;

    const loadBookingActivity = async () => {
      if (!selectedBooking?.id) {
        setSelectedBookingActivity([]);
        setSelectedBookingActivityLoading(false);
        setSelectedBookingActivityError("");
        return;
      }

      setSelectedBookingActivityLoading(true);
      setSelectedBookingActivityError("");

      try {
        const activityItems: BookingActivityItem[] = [];
        const partialErrors: string[] = [];

        try {
          const auditRows = await CoreAuditService.list({
            entityType: "booking",
            entityId: selectedBooking.id,
            limit: 100,
          });
          activityItems.push(
            ...auditRows
              .map((row) =>
                normalizeBookingActivityAuditRaw(row.id, {
                  action: row.action,
                  description: row.description || "",
                  userUid: row.actorUid || null,
                  userEmail: row.actorEmail || null,
                  userName: row.actorName || null,
                  createdAt: row.createdAt,
                  before: parseCoreAuditJson(row.beforeJson),
                  after: parseCoreAuditJson(row.afterJson),
                  meta: parseCoreAuditJson(row.metaJson),
                  source: row.source || "dashboard",
                })
              )
              .filter((entry): entry is Record<string, unknown> => Boolean(entry))
              .map((entry) => mapBookingActivityItem(entry, selectedBooking, userNamesByUid))
          );
        } catch {
          partialErrors.push("تعذر تحميل سجل العمليات لهذا الحجز.");
        }

        const lifecycleItems = buildBookingLifecycleActivityItems(selectedBooking, userNamesByUid);
        const fallbackCreated = buildFallbackCreatedActivity(selectedBooking);
        const fallbackUpdated = buildFallbackUpdatedActivity(selectedBooking, userNamesByUid, activityItems);
        const nextItems = mergeBookingActivityItems([
          ...activityItems,
          ...lifecycleItems,
          ...(fallbackUpdated ? [fallbackUpdated] : []),
          ...(fallbackCreated ? [fallbackCreated] : []),
        ]).sort((a, b) => b.sortMs - a.sortMs || b.id.localeCompare(a.id));

        setSelectedBookingActivity(nextItems);
        setSelectedBookingActivityError(partialErrors.join(" "));
      } catch (error) {
        console.error("loadBookingActivity error:", error);
        if (cancelled) return;
        const lifecycleItems = buildBookingLifecycleActivityItems(selectedBooking, userNamesByUid);
        const fallbackUpdated = buildFallbackUpdatedActivity(selectedBooking, userNamesByUid, lifecycleItems);
        const fallbackCreated = buildFallbackCreatedActivity(selectedBooking);
        setSelectedBookingActivity(
          mergeBookingActivityItems(
            [fallbackUpdated, fallbackCreated, ...lifecycleItems].filter(Boolean) as BookingActivityItem[]
          ).sort((a, b) => b.sortMs - a.sortMs || b.id.localeCompare(a.id))
        );
        setSelectedBookingActivityError("تعذر تحميل سجل الحجز بالكامل حالياً.");
      } finally {
        if (!cancelled) setSelectedBookingActivityLoading(false);
      }
    };

    void loadBookingActivity();

    return () => {
      cancelled = true;
    };
  }, [selectedBooking, userNamesByUid]);

  const previousClientNotes = useMemo(() => {
    if (!selectedBooking) return [] as Array<{ id: string; ref: string; date: string; time: string; note: string }>;

    const targetPhone = digitsOnly(String(selectedBooking.phone || ""));
    const targetName = normalizeArabicName(String(selectedBooking.customerName || ""));

    return bookings
      .filter((b) => b.id !== selectedBooking.id)
      .map((b) => {
        const note = String(notesMap[b.id] || "").trim();
        if (!note) return null;

        const samePhone = !!targetPhone && digitsOnly(String(b.phone || "")) === targetPhone;
        const sameName =
          !!targetName &&
          normalizeArabicName(String(b.customerName || "")) === targetName;

        if (!samePhone && !sameName) return null;

        return {
          id: b.id,
          ref: bookingRef(b),
          date: String(b.date || ""),
          time: String(b.time || ""),
          note,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)) as Array<{
      id: string; ref: string; date: string; time: string; note: string
    }>;
  }, [selectedBooking, bookings, notesMap]);

  const employeeFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    bookings.forEach((b) => {
      const id = String(b.employeeId || b.employeeUid || b.employeeName || "").trim();
      const label = String(b.employeeName || id || "").trim();
      if (!id || !label) return;
      map.set(id, label);
      employeeFilterLabelCacheRef.current.set(id, label);
    });

    // Keep the active option visible even when the edited booking was the last
    // row using that employee. Otherwise the native select visually falls back
    // to "all" while the state still contains the old value, which looks like
    // the filter disappeared and leaves the list unexpectedly empty.
    if (employeeFilter !== "all" && !map.has(employeeFilter)) {
      map.set(
        employeeFilter,
        employeeFilterLabelCacheRef.current.get(employeeFilter) || employeeFilter
      );
    }

    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [bookings, employeeFilter]);

  const serviceFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    bookings.forEach((b) => {
      const services = extractServicesFromAny(b);
      if (services.length) {
        services.forEach((service) => {
          const key = String(service.serviceId || service.serviceName || "").trim();
          const label = String(service.serviceName || service.serviceId || "").trim();
          if (!key || !label) return;
          map.set(key, label);
          serviceFilterLabelCacheRef.current.set(key, label);
        });
        return;
      }
      const fallback = serviceSummaryForTable(b);
      if (fallback && fallback !== "—") {
        map.set(fallback, fallback);
        serviceFilterLabelCacheRef.current.set(fallback, fallback);
      }
    });

    // Same protection for the service filter. Editing the only matching row
    // must not remove the selected option from the control.
    if (serviceFilter !== "all" && !map.has(serviceFilter)) {
      map.set(
        serviceFilter,
        serviceFilterLabelCacheRef.current.get(serviceFilter) || serviceFilter
      );
    }

    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [bookings, serviceFilter]);

  const applyDatePreset = useCallback((preset: DatePresetOption) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = datePresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, []);

  const filteredBase = useMemo(() => {
    let list = [...bookings];
    if (dateFrom || dateTo) {
      list = list.filter((b) => inDateRange(b.date, dateFrom, dateTo));
    }
    const search = normalizeArabicName(q);
    const searchRaw = String(q || "").trim().toLowerCase();
    const searchDigits = normalizedDigitsOnly(searchRaw);
    if (search || searchRaw) {
      list = list.filter((b) => {
        const name = normalizeArabicName(b.customerName || "");
        const phone = String(b.phone || "").toLowerCase();
        const phoneDigits = normalizedDigitsOnly(phone);
        const emp = normalizeArabicName(b.employeeName || "");
        const service = normalizeArabicName(`${serviceSummaryForTable(b)} ${serviceMetaSummaryForTable(b)}`);
        const ref = bookingRef(b).toLowerCase();
        const refDigits = normalizedDigitsOnly(ref);
        return (
          (search ? name.includes(search) || emp.includes(search) || service.includes(search) : false) ||
          phone.includes(searchRaw) ||
          (!!searchDigits && phoneDigits.includes(searchDigits)) ||
          ref.includes(searchRaw) ||
          (!!searchDigits && refDigits.includes(searchDigits))
        );
      });
    }
    if (employeeFilter !== "all") {
      list = list.filter((b) => {
        const target = String(employeeFilter || "").trim();
        return (
          String(b.employeeId || "").trim() === target ||
          String(b.employeeUid || "").trim() === target ||
          String(b.employeeName || "").trim() === target
        );
      });
    }
    if (serviceFilter !== "all") {
      list = list.filter((b) => {
        const target = String(serviceFilter || "").trim();
        const services = extractServicesFromAny(b);
        return (
          services.some((service) => {
            const id = String(service.serviceId || "").trim();
            const name = String(service.serviceName || "").trim();
            return id === target || name === target;
          }) ||
          serviceSummaryForTable(b) === target
        );
      });
    }
    if (sourceFilter !== "all") {
      list = list.filter((b) => {
        const channel = String(b.channel || "").trim() || "unknown";
        return channel === sourceFilter;
      });
    }
    if (paymentMethodFilter !== "all") {
      list = list.filter((b) => bookingPaymentMethodFilterValue(b) === paymentMethodFilter);
    }
    if (oldPendingFilter !== "off") {
      const today = todayISOLocal();
      const cutoff =
        oldPendingFilter === "before_today"
          ? today
          : oldPendingFilter === "older_7"
            ? shiftISODate(today, -7)
            : oldPendingFilter === "older_30"
              ? shiftISODate(today, -30)
              : "";
      list = list.filter((b) => {
        if (b.status !== "pending") return false;
        const date = String(b.date || "").trim();
        if (!date) return false;
        if (oldPendingFilter === "custom") return inDateRange(date, oldPendingFrom, oldPendingTo);
        return cutoff ? date < cutoff : true;
      });
    }
    // Filter by role if staff
    if (uiRole === "staff") {
      list = list.filter((b) => {
        const bUid = String(b.employeeUid || "").trim();
        const bId = String(b.employeeId || "").trim();
        const bName = String(b.employeeName || "").trim();
        const myUid = authUserUid;
        if (myUid && bUid === myUid) return true;
        if (myUid && bId === myUid) return true;
        return bName && normalizeArabicName(bName).includes(normalizeArabicName(authUserDisplayName));
      });
    }
    return list;
  }, [
    bookings,
    q,
    dateFrom,
    dateTo,
    employeeFilter,
    serviceFilter,
    sourceFilter,
    paymentMethodFilter,
    oldPendingFilter,
    oldPendingFrom,
    oldPendingTo,
    uiRole,
    authUserUid,
    authUserDisplayName,
  ]);

  const filtered = useMemo(() => {
    const statusScoped =
      statusFilter === "all"
        ? excludedStatus
          ? filteredBase.filter((b) => b.status !== excludedStatus)
          : filteredBase
        : filteredBase.filter((b) => b.status === statusFilter);

    if (settlementFilter !== "all") {
      return statusScoped.filter((b) => {
        const payment = resolveBookingPaymentSummary(b);
        if (settlementFilter === "paid") return payment.totalAmount > 0 && payment.remainingAmount <= 0;
        if (settlementFilter === "partial") return payment.paidAmount > 0 && payment.remainingAmount > 0;
        if (settlementFilter === "unpaid") return payment.paidAmount <= 0 && payment.remainingAmount > 0;
        return true;
      });
    }

    return statusScoped;
  }, [filteredBase, statusFilter, excludedStatus, settlementFilter]);

  const filteredSorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const aMs = parseBookingDateTimeMs(String(a.date || ""), String(a.time || "")) || 0;
      const bMs = parseBookingDateTimeMs(String(b.date || ""), String(b.time || "")) || 0;
      const diff = aMs !== bMs ? aMs - bMs : String(a.id || "").localeCompare(String(b.id || ""));
      return sortOrder === "oldest" ? diff : -diff;
    });
    return rows;
  }, [filtered, sortOrder]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredSorted.length / Math.max(1, pageSize))),
    [filteredSorted.length, pageSize]
  );

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    q,
    statusFilter,
    excludedStatus,
    settlementFilter,
    dateFrom,
    dateTo,
    paymentMethodFilter,
    employeeFilter,
    serviceFilter,
    sourceFilter,
    oldPendingFilter,
    oldPendingFrom,
    oldPendingTo,
    sortOrder,
    pageSize,
  ]);

  const pagedBookings = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSorted.slice(start, start + pageSize);
  }, [currentPage, filteredSorted, pageSize]);

  useEffect(() => {
    const rows = filtered;
    if (!rows.length) return;

    const entries = Object.fromEntries(
      rows.map((b) => [b.id, deriveLastUpdateForBooking(b, userNamesByUid)])
    );
    setLastUpdateMap((prev) => ({ ...prev, ...entries }));
  }, [filtered, userNamesByUid]);

  const statusTabCounts = useMemo(
    () => {
      const pending = filteredBase.filter((b) => b.status === "pending").length;
      const confirmed = filteredBase.filter((b) => b.status === "confirmed").length;
      const completed = filteredBase.filter((b) => b.status === "completed").length;
      const cancelled = filteredBase.filter((b) => b.status === "cancelled").length;
      const excludedCount =
        excludedStatus === "pending"
          ? pending
          : excludedStatus === "confirmed"
            ? confirmed
            : excludedStatus === "completed"
              ? completed
              : excludedStatus === "cancelled"
                ? cancelled
                : 0;
      return {
        all: Math.max(0, filteredBase.length - excludedCount),
        pending,
        confirmed,
        completed,
        cancelled,
      };
    },
    [filteredBase, excludedStatus]
  );

  const totalRemainingAmount = useMemo(
    () =>
      round2(
        filtered.reduce((sum, b) => {
          if (b.status === "cancelled") return sum;
          return sum + resolveBookingPaymentSummary(b).remainingAmount;
        }, 0)
      ),
    [filtered]
  );

  const paymentSummaryByBookingId = useMemo<
    Record<string, ReturnType<typeof resolveBookingPaymentSummary>>
  >(() => {
    const next: Record<string, ReturnType<typeof resolveBookingPaymentSummary>> = {};
    filtered.forEach((b) => {
      const id = String(b.id || "").trim();
      if (!id) return;
      next[id] = resolveBookingPaymentSummary(b);
    });
    return next;
  }, [filtered]);

  const bookingSections = useMemo<BookingDisplaySection[]>(() => {
    const normalRows: Booking[] = [];
    const internalRows: Booking[] = [];

    pagedBookings.forEach((b) => {
      if (resolveBookingSectionKind(b) === "internal") {
        internalRows.push(b);
        return;
      }
      normalRows.push(b);
    });

    return [
      {
        key: "normal",
        title: "الحجوزات العادية",
        description:
          "تظهر هنا الحجوزات العادية فقط، ويظهر الحجز الداخلي المستقبلي قبل الدفع مؤقتًا في هذا القسم.",
        rows: normalRows,
        blocks: buildDashboardBookingBlocks(normalRows),
        temporaryInternalCount: normalRows.filter((row) => isTemporaryNormalInternalBooking(row)).length,
      },
      {
        key: "internal",
        title: "الحجوزات الداخلية",
        description:
          "تظهر هنا جميع الحجوزات الداخلية بشكل مستقل، ولا يبقى أي حجز داخلي داخل القسم العادي بعد الدفع أو التأكيد.",
        rows: internalRows,
        blocks: buildDashboardBookingBlocks(internalRows),
        temporaryInternalCount: 0,
      },
    ];
  }, [pagedBookings]);

  const unseenNewBookings = useMemo(() => {
    return bookings
      .filter((b) => {
        if (!(b.status === "pending" || b.status === "confirmed")) return false;
        const createdAtMs = toMillisSafe((b as any)?.createdAt);
        return createdAtMs > newBookingsSeenAt;
      })
      .sort((a, b) => {
        const aMs = toMillisSafe((a as any)?.createdAt);
        const bMs = toMillisSafe((b as any)?.createdAt);
        return bMs - aMs;
      });
  }, [bookings, newBookingsSeenAt]);

  const unseenNewPreviewBookings = useMemo(() => unseenNewBookings.slice(0, 6), [unseenNewBookings]);

  const markNewBookingsSeen = useCallback(() => {
    const latestCreatedAt = bookings.reduce((max, b) => {
      const createdAtMs = toMillisSafe((b as any)?.createdAt);
      return createdAtMs > max ? createdAtMs : max;
    }, 0);

    const nextSeenAt = Math.max(newBookingsSeenAt, latestCreatedAt);
    setNewBookingsSeenAt(nextSeenAt);

    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(NEW_BOOKINGS_SEEN_AT_KEY, String(nextSeenAt));
      }
    } catch {
      // ignore storage failures
    }
  }, [bookings, newBookingsSeenAt]);

  const staleStatusBookings = useMemo(() => {
    const nowMs = Date.now();
    return bookings
      .filter((b) => {
        if (!(b.status === "pending" || b.status === "confirmed")) return false;
        const bookingMs = parseBookingDateTimeMs(String(b.date || ""), String(b.time || ""));
        if (bookingMs === null) return false;
        return bookingMs < nowMs;
      })
      .sort((a, b) => {
        const aMs = parseBookingDateTimeMs(String(a.date || ""), String(a.time || "")) || 0;
        const bMs = parseBookingDateTimeMs(String(b.date || ""), String(b.time || "")) || 0;
        return aMs - bMs;
      });
  }, [bookings]);

  const stalePendingCount = useMemo(
    () => staleStatusBookings.filter((b) => b.status === "pending").length,
    [staleStatusBookings]
  );
  const staleConfirmedCount = useMemo(
    () => staleStatusBookings.filter((b) => b.status === "confirmed").length,
    [staleStatusBookings]
  );
  const stalePreviewBookings = useMemo(() => staleStatusBookings.slice(0, 6), [staleStatusBookings]);

  const expiredPendingDayBookings = useMemo(() => {
    const today = todayISOLocal();
    return bookings
      .filter((b) => {
        if (b.status !== "pending") return false;
        const createdAtMs = bookingCreationRefMs(b);
        const createdDateISO = dateISOFromMillisLocal(createdAtMs);
        if (!createdDateISO) return false;
        return createdDateISO < today;
      })
      .sort((a, b) => {
        const aMs = bookingCreationRefMs(a);
        const bMs = bookingCreationRefMs(b);
        if (aMs !== bMs) return aMs - bMs;
        const d = String(a.date || "").localeCompare(String(b.date || ""));
        if (d !== 0) return d;
        return String(a.time || "").localeCompare(String(b.time || ""));
      });
  }, [bookings]);

  const expiredPendingDayDepositBookings = useMemo(
    () =>
      expiredPendingDayBookings.filter((b) => {
        const payment = resolveBookingPaymentSummary(b);
        return isPendingDepositBooking(b, payment);
      }),
    [expiredPendingDayBookings]
  );
  const expiredPendingDayNoPaymentBookings = useMemo(
    () =>
      expiredPendingDayBookings.filter((b) => {
        const payment = resolveBookingPaymentSummary(b);
        return !isPendingDepositBooking(b, payment);
      }),
    [expiredPendingDayBookings]
  );

  const getAllowedStatusOptions = useCallback((b: Booking): BookingStatus[] => {
    if (uiRole === "owner" || uiRole === "admin") return allStatusOptions;
    if (uiRole === "reception") {
      if (b.status === "pending") return ["pending", "confirmed", "cancelled"];
      return [b.status];
    }
    return [b.status];
  }, [uiRole]);

  const requestSensitiveAction = useCallback((action: SensitiveBookingAction) => {
    // Preserve the active booking search. Password managers used to pair the
    // authorization-code field with the page search and inject the admin email.
    searchQueryBeforeSensitiveActionRef.current = q;
    setPendingSensitiveAction(action);
  }, [q]);

  useEffect(() => {
    if (!pendingSensitiveAction) return;

    const expectedQuery = searchQueryBeforeSensitiveActionRef.current;
    const currentEmail = String(auth.currentUser?.email || authUser.email || "")
      .trim()
      .toLowerCase();
    const currentQuery = String(q || "").trim().toLowerCase();
    const expectedNormalized = String(expectedQuery || "").trim().toLowerCase();

    // Defense in depth for browser/password-manager autofill. Restore only
    // when the injected value is exactly the signed-in administrator email.
    if (currentEmail && currentQuery === currentEmail && currentQuery !== expectedNormalized) {
      setQ(expectedQuery);
    }
  }, [authUser.email, pendingSensitiveAction, q]);

  const sensitiveActionDescription = (action: SensitiveBookingAction | null) => {
    if (!action) return "";
    if (action.kind === "status") {
      return `تغيير حالة الحجز ${action.bookingRef} إلى ${statusLabel[action.nextStatus]}`;
    }
    if (action.kind === "edit") return `تعديل بيانات الحجز ${bookingRef(action.booking)}`;
    if (action.kind === "refund") return `إدارة استرجاع الحجز ${bookingRef(action.booking)}`;
    return `إزالة الحجز ${bookingRef(action.booking)} من صفحة الحجوزات`;
  };

  const executeStatusUpdate = async (id: string, newStatus: BookingStatus) => {
    const target = bookings.find((x) => x.id === id);
    if (!target) return;
    const allowed = getAllowedStatusOptions(target);
    if (!allowed.includes(newStatus)) {
      alert("غير مسموح لك بهذا التغيير.");
      return;
    }
    if (newStatus === "cancelled") {
      setCancelTarget(target);
      return;
    }
    if (newStatus === "confirmed" && target.status === "pending") {
      const payment = resolveBookingPaymentSummary(target);
      const paymentMode: UiPaymentMode =
        Number(payment.paidAmount || 0) <= 0
          ? "none"
          : payment.paymentType === "partial"
            ? "partial"
            : "full";
      setConfirmDraft({
        paymentMode,
        paymentType: payment.paymentType === "partial" ? "partial" : "full",
        paidAmount: String(round2(payment.paidAmount || 0)),
        paymentMethod: paymentMode === "none" ? "none" : detectPaymentMethod(target),
        mixedCashAmount: String(readPaymentBreakdown(target).cash || ""),
        mixedCardAmount: String(readPaymentBreakdown(target).card || ""),
      });
      setConfirmError("");
      setConfirmTarget(target);
      return;
    }
    try {
      await updateCoreBookingStatus(id, newStatus);
      const localAuditPatch = getLocalActorAudit();
      const localPatch = {
        status: newStatus,
        ...localAuditPatch,
      };
      setBookings((prev) => prev.map((row) => (row.id === id ? { ...row, ...localPatch } : row)));
      setSelectedBooking((prev) => (prev && prev.id === id ? { ...prev, ...localPatch } : prev));
      touchLastUpdate(id, localAuditPatch.atMs);
    } catch (e) {
      alert("فشل تحديث الحالة");
    }
  };

  const handleUpdateStatus = useCallback((id: string, newStatus: BookingStatus) => {
    const target = bookings.find((x) => x.id === id);
    if (!target) return;
    const allowed = getAllowedStatusOptions(target);
    if (!allowed.includes(newStatus)) {
      alert("غير مسموح لك بهذا التغيير.");
      return;
    }
    requestSensitiveAction({
      kind: "status",
      bookingId: id,
      nextStatus: newStatus,
      bookingRef: bookingRef(target),
    });
  }, [bookings, getAllowedStatusOptions, requestSensitiveAction]);

  const handleConfirmPending = async () => {
    if (!confirmTarget?.id) return;
    const totalAmount = readBookingTotalAmount(confirmTarget);
    const nextMode = confirmDraft.paymentMode;
    const isMixedPayment = confirmDraft.paymentMethod === "mixed";
    const nextType = nextMode === "full" || isMixedPayment ? "full" : "partial";
    const mixedCashAmount = Math.max(0, Number(confirmDraft.mixedCashAmount || 0));
    const mixedCardAmount = Math.max(0, Number(confirmDraft.mixedCardAmount || 0));
    let paidAmount =
      isMixedPayment
        ? round2(mixedCashAmount + mixedCardAmount)
        : nextMode === "full"
        ? totalAmount
        : nextMode === "none"
          ? 0
          : Number(confirmDraft.paidAmount || 0);

    if (isMixedPayment) {
      if (
        !Number.isFinite(mixedCashAmount) ||
        !Number.isFinite(mixedCardAmount) ||
        mixedCashAmount < 0 ||
        mixedCardAmount < 0
      ) {
        setConfirmError("مبالغ الدفع المختلط يجب أن تكون 0 أو أكثر.");
        return;
      }
      if (round2(mixedCashAmount + mixedCardAmount) !== round2(totalAmount)) {
        setConfirmError("مجموع الكاش والشبكة يجب أن يساوي إجمالي الحجز.");
        return;
      }
    }

    if (!isMixedPayment && nextMode === "partial") {
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        setConfirmError("أدخلي مبلغ عربون صحيح (0 أو أكثر).");
        return;
      }
      if (paidAmount > totalAmount) {
        setConfirmError("مبلغ العربون لا يمكن أن يتجاوز إجمالي الحجز.");
        return;
      }
    }

    let paymentType: BookingPaymentType = nextType;
    if (paidAmount >= totalAmount) {
      paymentType = "full";
      paidAmount = totalAmount;
    }
    const remainingAmount = round2(Math.max(0, totalAmount - paidAmount));
    const paymentMethod =
      confirmDraft.paymentMethod === "none"
        ? null
        : (["cash", "card", "transfer", "other", "mixed"] as const).includes(confirmDraft.paymentMethod as any)
          ? (confirmDraft.paymentMethod as PaymentMethod)
          : detectPaymentMethod(confirmTarget);
    const paymentBreakdown = isMixedPayment
      ? { cash: round2(mixedCashAmount), card: round2(mixedCardAmount) }
      : null;

    try {
      setConfirmSaving(true);
      setConfirmError("");

      await updateCoreBookingFields(confirmTarget.id, {
        paymentMethod,
        paymentBreakdown,
        paymentType,
        paidAmount: round2(paidAmount),
        remainingAmount,
      } as any);
      await updateCoreBookingStatus(confirmTarget.id, "confirmed");

      // Core booking reconciliation already updates invoice and payment state.

      const localAuditPatch = getLocalActorAudit();
      const localPatch = {
        paymentMethod: paymentMethod || undefined,
        paymentBreakdown: paymentBreakdown || undefined,
        paymentType,
        paidAmount: round2(paidAmount),
        remainingAmount,
        status: "confirmed" as BookingStatus,
        ...localAuditPatch,
      };
      setBookings((prev) =>
        prev.map((row) => (row.id === confirmTarget.id ? { ...row, ...localPatch } : row))
      );
      setSelectedBooking((prev) =>
        prev && prev.id === confirmTarget.id ? { ...prev, ...localPatch } : prev
      );
      touchLastUpdate(confirmTarget.id, localAuditPatch.atMs);

      setConfirmTarget(null);
    } catch {
      setConfirmError("تعذر تأكيد الحجز الآن.");
    } finally {
      setConfirmSaving(false);
    }
  };

  const confirmCancelBooking = async () => {
    if (!cancelTarget?.id) return;
    setCancelBusy(true);
    try {
      await updateCoreBookingStatus(cancelTarget.id, "cancelled");
      const localAuditPatch = getLocalActorAudit();
      const localPatch = {
        status: "cancelled" as BookingStatus,
        ...localAuditPatch,
      };
      setBookings((prev) =>
        prev.map((row) => (row.id === cancelTarget.id ? { ...row, ...localPatch } : row))
      );
      setSelectedBooking((prev) =>
        prev && prev.id === cancelTarget.id ? { ...prev, ...localPatch } : prev
      );
      touchLastUpdate(cancelTarget.id, localAuditPatch.atMs);
      setCancelTarget(null);
    } catch {
      alert("فشل إلغاء الحجز");
    } finally {
      setCancelBusy(false);
    }
  };

  const executeDeleteBooking = async (b: Booking) => {
    if (uiRole !== "owner") {
      alert("حذف الحجز متاح للمالك فقط");
      return;
    }

    const bookingId = String(b.id || "").trim();
    if (!bookingId) return;

    try {
      await deleteCoreBooking(bookingId);
      setBookings((current) => current.filter((row) => String(row.id || "").trim() !== bookingId));
      setSelectedBooking((current) =>
        current && String(current.id || "").trim() === bookingId ? null : current
      );
      setSelectedBookingIds((current) => {
        if (!current.has(bookingId)) return current;
        const next = new Set(current);
        next.delete(bookingId);
        return next;
      });
      setRefundMapByBookingId((current) => {
        if (!current[bookingId]) return current;
        const next = { ...current };
        delete next[bookingId];
        return next;
      });
    } catch (error) {
      console.error("[DashboardBookings] booking delete failed", error);
      if (error instanceof Error) throw error;
      throw new Error("تعذر حذف الحجز الآن.");
    }
  };

  const handleDeleteBooking = useCallback((b: Booking) => {
    if (uiRole !== "owner") {
      alert("حذف الحجز متاح للمالك فقط");
      return;
    }
    requestSensitiveAction({ kind: "delete", booking: b });
  }, [requestSensitiveAction, uiRole]);

  const openEditBookingModalUnsafe = useCallback((b: Booking) => {
    if (!canEditBookings) {
      alert("التعديل متاح فقط للمالك أو الأدمن.");
      return;
    }
    setEditTarget(b);
  }, [canEditBookings]);

  const openEditBookingModal = useCallback((b: Booking) => {
    if (!canEditBookings) {
      alert("التعديل متاح فقط للمالك أو الأدمن.");
      return;
    }
    if (uiRole === "owner") {
      openEditBookingModalUnsafe(b);
      return;
    }
    requestSensitiveAction({ kind: "edit", booking: b });
  }, [canEditBookings, openEditBookingModalUnsafe, requestSensitiveAction, uiRole]);

  const applyLocalBookingPatch = useCallback(
    (bookingId: string, patch: Partial<Booking>) => {
      const id = String(bookingId || "").trim();
      if (!id) return;

      const localAuditPatch = getLocalActorAudit();
      const applyPatchToRows = (prev: Booking[]) => {
        const idx = prev.findIndex((row) => row.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch, ...localAuditPatch };
        return next;
      };

      setLiveBookingsSource(applyPatchToRows);
      setHistoryBookingsSource(applyPatchToRows);
      setBookings(applyPatchToRows);
      setSelectedBooking((prev) =>
        prev && prev.id === id ? { ...prev, ...patch, ...localAuditPatch } : prev
      );
      touchLastUpdate(id, localAuditPatch.atMs);
    },
    [getLocalActorAudit, touchLastUpdate]
  );

  /*
  const confirmSensitiveAction = async () => {
    if (!pendingSensitiveAction) return;
    if (String(actionPin).trim() !== BOOKING_ACTION_PIN) {
      setActionPinError("الرقم السري غير صحيح.");
      return;
    }

    setActionPinBusy(true);
    setActionPinError("");

    try {
      const action = pendingSensitiveAction;
      if (action.kind === "status") {
        await executeStatusUpdate(action.bookingId, action.nextStatus);
      } else if (action.kind === "edit") {
        openEditBookingModalUnsafe(action.booking);
      } else if (action.kind === "refund") {
        openRefundModalUnsafe(action.booking);
      } else if (action.kind === "delete") {
        await executeDeleteBooking(action.booking);
      }

      setActionPinOpen(false);
      setActionPin("");
      setActionPinError("");
      setPendingSensitiveAction(null);
    } finally {
      setActionPinBusy(false);
    }
  };
  */

  /*
  const handleSaveBookingEdit = async () => {
    if (!editTarget?.id || !canEditBookings) return;
    const customerName = String(editDraft.customerName || "").trim();
    const phone = String(editDraft.phone || "").trim();
    const note = String(editDraft.note || "").trim();
    const date = String(editDraft.date || "").trim();
    const time = String(editDraft.time || "").trim();
    const sectionId = String(editDraft.sectionId || "").trim();
    const categoryId = String(editDraft.categoryId || "").trim();
    const serviceId = String(editDraft.serviceId || "").trim();
    const priceInput = String(editDraft.price || "").trim();
    const fallbackPrice = readBookingTotalAmount(editTarget);
    const price = priceInput === "" ? fallbackPrice : Number(priceInput);
    const paymentType = editDraft.paymentType === "partial" ? "partial" : "full";
    const hasNoPaymentMethod = editDraft.paymentMethod === "none";
    const paymentMethod = (["cash", "card", "transfer", "other"] as const).includes(
      editDraft.paymentMethod as any
    )
      ? (editDraft.paymentMethod as PaymentMethod)
      : "transfer";
    const selectedService =
      editServices.find((service) => String(service.id || "").trim() === serviceId) || null;
    const selectedSection =
      editSections.find((section) => String(section.id || "").trim() === sectionId) || null;
    const selectedCategory =
      editCategories.find((category) => String(category.id || "").trim() === categoryId) || null;
    let paidAmount = paymentType === "full" ? price : Number(editDraft.paidAmount || 0);
    if (hasNoPaymentMethod) paidAmount = 0;

    if (!customerName) {
      setEditError("اسم العميلة مطلوب.");
      return;
    }
    if (!sectionId) {
      setEditError("القسم مطلوب.");
      return;
    }
    if (!serviceId || !selectedService) {
      setEditError("الخدمة مطلوبة.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setEditError("التاريخ غير صحيح.");
      return;
    }
    if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(time)) {
      setEditError("الوقت غير صحيح (HH:MM).");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setEditError("السعر غير صحيح.");
      return;
    }
    if (paymentType === "partial") {
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        setEditError("أدخلي مبلغ عربون صحيح (0 أو أكثر).");
        return;
      }
      if (paidAmount > price) {
        setEditError("مبلغ العربون لا يمكن أن يتجاوز إجمالي الحجز.");
        return;
      }
    }

    let nextPaymentType: BookingPaymentType = paymentType;
    if (hasNoPaymentMethod) nextPaymentType = "partial";
    if (paidAmount >= price) {
      nextPaymentType = "full";
      paidAmount = price;
    }
    const remainingAmount = round2(Math.max(0, price - paidAmount));
    const durationMin = Math.max(5, Number(selectedService?.durationMin || editTarget.durationMin || 60));
    const serviceName = selectedService?.name || editTarget.serviceName || "";
    const sectionName = selectedSection?.name || sectionId;
    const categoryName = selectedCategory?.name || "";
    const serviceSnapshot = {
      serviceNameAtBooking: serviceName,
      priceAtBooking: price,
      durationAtBooking: durationMin,
      sectionIdAtBooking: sectionId || undefined,
      sectionTitleAtBooking: sectionName || undefined,
      categoryIdAtBooking: categoryId || undefined,
      categoryNameAtBooking: categoryName || undefined,
    };
    const servicesPatch = [
      {
        serviceId,
        serviceName,
        price,
        durationMin,
        sectionId,
        sectionTitle: sectionName || undefined,
        categoryId: categoryId || undefined,
        categoryName: categoryName || undefined,
      },
    ];
    const isFullyPaidAfterEdit = price > 0 && remainingAmount <= 0;
    let statusAfterEdit: BookingStatus | null = null;
    if (
      isFullyPaidAfterEdit &&
      (editTarget.status === "pending" || editTarget.status === "confirmed")
    ) {
      const chooseCompleted = window.confirm(
        "تم سداد الحجز كاملًا.\n\nاضغطي \"موافق\" لتحويل الحالة إلى \"مكتمل\".\nاضغطي \"إلغاء\" للإبقاء على الحالة \"مؤكد\"."
      );
      statusAfterEdit = chooseCompleted ? "completed" : "confirmed";
    }

    try {
      setEditSaving(true);
      setEditError("");
      const patch = {
        clientName: customerName,
        clientPhone: phone || null,
        note,
        customerName,
        phone: phone || null,
        customerPhone: phone || null,
        date,
        time,
        serviceId,
        serviceName,
        serviceSnapshot,
        services: servicesPatch,
        durationMin,
        packageId: null,
        packageSnapshot: null,
        finalPrice: price,
        total: price,
        paymentMethod: hasNoPaymentMethod ? null : paymentMethod,
        paymentType: nextPaymentType,
        paidAmount: round2(paidAmount),
        remainingAmount,
      } as any;
      await updateCoreBookingFields(editTarget.id, patch);
      if (statusAfterEdit && statusAfterEdit !== editTarget.status) {
        await updateCoreBookingStatus(editTarget.id, statusAfterEdit);
      }

      const resolvedStatus = statusAfterEdit || editTarget.status;
      const localAuditPatch = getLocalActorAudit();

      setBookings((prev) =>
        prev.map((row) =>
          row.id === editTarget.id
            ? {
                ...row,
                customerName,
                phone: phone || "",
                note,
                date,
                time,
                serviceId,
                serviceName,
                serviceSnapshot,
                services: servicesPatch,
                durationMin,
                packageId: undefined,
                packageSnapshot: undefined,
                finalPrice: price,
                total: price,
                paymentMethod: hasNoPaymentMethod ? undefined : paymentMethod,
                paymentType: nextPaymentType,
                paidAmount: round2(paidAmount),
                remainingAmount,
                status: resolvedStatus,
                ...localAuditPatch,
              }
            : row
        )
      );

      setSelectedBooking((prev) =>
        prev && prev.id === editTarget.id
          ? {
              ...prev,
              customerName,
              phone: phone || "",
              note,
              date,
              time,
              serviceId,
              serviceName,
              serviceSnapshot,
              services: servicesPatch,
              durationMin,
              packageId: undefined,
              packageSnapshot: undefined,
              finalPrice: price,
              total: price,
              paymentMethod: hasNoPaymentMethod ? undefined : paymentMethod,
              paymentType: nextPaymentType,
              paidAmount: round2(paidAmount),
              remainingAmount,
              status: resolvedStatus,
              ...localAuditPatch,
            }
          : prev
      );
      touchLastUpdate(editTarget.id, localAuditPatch.atMs);

      setEditTarget(null);
    } catch (e: any) {
      if (e?.code === "EMPLOYEE_UNAVAILABLE") {
        setEditError("الموظفة المعينة على هذا الحجز لم تعد نشطة تشغيليًا لهذا الموعد. اختاري موظفة أخرى أو أعيدي جدولة الحجز.");
      } else {
        setEditError("تعذر حفظ تعديل الحجز.");
      }
    } finally {
      setEditSaving(false);
    }
  };

  */

  const canManageRefund = useCallback((b: Booking) => {
    if (!(uiRole === "owner" || uiRole === "admin" || uiRole === "reception")) return false;
    if (!(b.status === "confirmed" || b.status === "completed")) return false;
    const amount = readBookingTotalAmount(b);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    return true;
  }, [uiRole]);

  /*
  const detectPaymentMethod = (b: Booking): PaymentMethod => {
    const stored = String((b as any)?.paymentMethod || "").toLowerCase().trim();
    if (stored === "card" || stored === "cash" || stored === "transfer") {
      return stored as PaymentMethod;
    }
    const s = String((b as any)?.note || "").toLowerCase();
    if (s.includes("شبكة") || s.includes("مدى") || s.includes("card")) return "card";
    if (s.includes("تحويل") || s.includes("transfer")) return "transfer";
    if (s.includes("كاش") || s.includes("cash") || s.includes("نقد")) return "cash";
    return "transfer";
  };
  */

  const openRefundModalUnsafe = useCallback((b: Booking) => {
    if (!canManageRefund(b)) return;
    const bookingId = String(b.id || "").trim();
    const existing = refundMapByBookingId[bookingId];
    const bookingAmount = readBookingTotalAmount(b);
    const fallbackMethod = detectPaymentMethod(b);
    setRefundDraft({
      amount: existing ? String(existing.amount || "") : String(Math.abs(bookingAmount || 0)),
      method: existing?.method || fallbackMethod || "transfer",
      reason: existing?.reason || "",
      details: existing?.details || "",
      date: existing?.date || todayISOLocal(),
    });
    setRefundError("");
    setRefundTarget(b);
  }, [canManageRefund, refundMapByBookingId]);

  const openRefundModal = useCallback((b: Booking) => {
    if (!canManageRefund(b)) return;
    requestSensitiveAction({ kind: "refund", booking: b });
  }, [canManageRefund, requestSensitiveAction]);

  const executeSensitiveAction = useCallback(
    async (action: SensitiveBookingAction) => {
      if (action.kind === "status") {
        await executeStatusUpdate(action.bookingId, action.nextStatus);
        return;
      }
      if (action.kind === "edit") {
        openEditBookingModalUnsafe(action.booking);
        return;
      }
      if (action.kind === "refund") {
        openRefundModalUnsafe(action.booking);
        return;
      }
      await executeDeleteBooking(action.booking);
    },
    [executeDeleteBooking, executeStatusUpdate, openEditBookingModalUnsafe, openRefundModalUnsafe]
  );

  const handleSaveRefund = async () => {
    const b = refundTarget;
    if (!b) return;
    const bookingId = String(b.id || "").trim();
    if (!bookingId || !canManageRefund(b)) return;

    const bookingAmount = readBookingTotalAmount(b);
    const amountInput = Number(refundDraft.amount || 0);
    if (!Number.isFinite(amountInput) || amountInput <= 0) {
      setRefundError("أدخل مبلغ استرجاع صحيح.");
      return;
    }
    if (amountInput > bookingAmount) {
      setRefundError("مبلغ الاسترجاع لا يمكن أن يتجاوز قيمة الحجز.");
      return;
    }
    const reason = String(refundDraft.reason || "").trim();
    if (!reason) {
      setRefundError("سبب الاسترجاع مطلوب.");
      return;
    }
    const details = String(refundDraft.details || "").trim();
    const note = details ? `${reason} | ${details}` : reason;
    const method = (refundDraft.method || "transfer") as PaymentMethod;
    try {
      setRefundBusyId(bookingId);
      setRefundSaving(true);
      setRefundError("");
      const refundDate = refundDraft.date || todayISOLocal();
      const refundId = `refund_${bookingId}`;
      const existingRefund = refundMapByBookingId[bookingId];
      const payload = {
        bookingId,
        clientId: String(b.userId || "").trim() || undefined,
        amountHalalas: Math.round(Math.abs(amountInput) * 100),
        method,
        reason: note,
        refundedAt: `${refundDate}T12:00:00.000Z`,
      };
      const created = existingRefund?.incomeId
        ? await CoreRefundService.patch(existingRefund.incomeId, payload)
        : await CoreRefundService.create({
            ...payload,
            id: refundId,
            idempotencyKey: `dashboard-refund:${bookingId}`,
          });

      if (bookingUsesSessionPackage(b)) {
        const wasFullRefund = Boolean(
          existingRefund && isFullBookingRefund(Number(existingRefund.amount || 0), bookingAmount)
        );
        const isFullRefund = isFullBookingRefund(amountInput, bookingAmount);
        if (isFullRefund && !wasFullRefund) {
          await PackageOperationsService.restoreConsumed(
            bookingId,
            `full_refund:${created.id}`
          );
        } else if (!isFullRefund && wasFullRefund) {
          await PackageOperationsService.reapplyBookingSession(
            bookingId,
            b.status === "completed" ? "used" : "reserved",
            `refund_reduced:${created.id}`
          );
        }
      }
      setRefundMapByBookingId((prev) => ({
        ...prev,
        [bookingId]: {
          incomeId: created.id,
          bookingId,
          amount: Number(created.amountHalalas || 0) / 100,
          method: normalizeIncomePaymentMethod(created.method),
          reason,
          details,
          date: String(created.refundedAt || refundDate).slice(0, 10),
        },
      }));
      setRefundTarget(null);
    } catch {
      setRefundError("تعذر تسجيل الاسترجاع.");
    } finally {
      setRefundSaving(false);
      setRefundBusyId("");
    }
  };

  const handleCancelRefund = async () => {
    const b = refundTarget;
    if (!b) return;
    const bookingId = String(b.id || "").trim();
    const existing = refundMapByBookingId[bookingId];
    if (!existing?.incomeId) return;
    try {
      setRefundBusyId(bookingId);
      setRefundSaving(true);
      setRefundError("");
      await CoreRefundService.remove(existing.incomeId);
      if (
        bookingUsesSessionPackage(b) &&
        isFullBookingRefund(Number(existing.amount || 0), readBookingTotalAmount(b))
      ) {
        await PackageOperationsService.reapplyBookingSession(
          bookingId,
          b.status === "completed" ? "used" : "reserved",
          `refund_voided:${existing.incomeId}`
        );
      }
      setRefundMapByBookingId((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
      setRefundTarget(null);
    } catch {
      setRefundError("تعذر إلغاء الاسترجاع.");
    } finally {
      setRefundSaving(false);
      setRefundBusyId("");
    }
  };

  const activeRefundForTarget = refundTarget
    ? refundMapByBookingId[String(refundTarget.id || "").trim()] || null
    : null;
  const selectedBookingPayment = useMemo(
    () => resolveBookingPaymentSummary(selectedBooking || {}),
    [selectedBooking]
  );
  const selectedBookingIsPendingDeposit = useMemo(
    () => isPendingDepositBooking(selectedBooking || null, selectedBookingPayment),
    [selectedBooking, selectedBookingPayment]
  );

  const handleExport = () => {
    const rows = [
      [
        "ID",
        "الزبون",
        "الهاتف",
        "الخدمة",
        "الموظفة",
        "التاريخ",
        "الوقت",
        "الحالة",
        "الإجمالي",
        "نوع الدفع",
        "طريقة الدفع",
        "المدفوع",
        "المتبقي",
      ],
      ...filtered.map((b) => {
        const payment = resolveBookingPaymentSummary(b);
        return [
        bookingRef(b),
        b.customerName || "—",
        b.phone || "—",
        serviceSummaryForTable(b),
        b.employeeName || "—",
        b.date,
        formatTime12(b.time),
        statusLabel[b.status],
        String(payment.totalAmount),
        paymentStatusLabel(payment),
        paymentMethodDisplayText(b),
        String(payment.paidAmount),
        String(payment.remainingAmount),
      ];
      })
    ];
    downloadCSV(`bookings_${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const updateNote = (id: string, note: string) => {
    setNoteDrafts((prev) => ({ ...prev, [id]: note }));
  };

  const saveNote = (id: string) => {
    const text = String(noteDrafts[id] ?? "").trim();
    const newMap = { ...notesMap, [id]: text };
    setNotesMap(newMap);
    setNoteDrafts(newMap);
    saveNotesMap(newMap);
    setSavedNoteId(id);
    if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
    saveHintTimerRef.current = window.setTimeout(() => setSavedNoteId(""), 1800);
  };

  const hasActiveBookingFilters = useMemo(
    () =>
      Boolean(
        q.trim() ||
        statusFilter !== "all" ||
        excludedStatus ||
        settlementFilter !== "all" ||
        dateFrom ||
        dateTo ||
        datePreset !== "all" ||
        paymentMethodFilter !== "all" ||
        employeeFilter !== "all" ||
        serviceFilter !== "all" ||
        sourceFilter !== "all" ||
        oldPendingFilter !== "off" ||
        oldPendingFrom ||
        oldPendingTo ||
        sortOrder !== "newest"
      ),
    [
      dateFrom,
      dateTo,
      datePreset,
      employeeFilter,
      excludedStatus,
      oldPendingFilter,
      oldPendingFrom,
      oldPendingTo,
      paymentMethodFilter,
      q,
      serviceFilter,
      settlementFilter,
      sortOrder,
      sourceFilter,
      statusFilter,
    ]
  );

  const resetBookingFilters = useCallback(() => {
    setQ("");
    setStatusFilter("all");
    setExcludedStatus("");
    setSettlementFilter("all");
    setDateFrom("");
    setDateTo("");
    setDatePreset("all");
    setPaymentMethodFilter("all");
    setEmployeeFilter("all");
    setServiceFilter("all");
    setSourceFilter("all");
    setSortOrder("newest");
    setOldPendingFilter("off");
    setOldPendingFrom("");
    setOldPendingTo("");
  }, []);

  const filterSummaryText = useMemo(() => {
    const parts = [
      dateFilterLabel(dateFrom, dateTo, datePreset),
      statusFilter === "all" ? "كل الحالات" : `الحالة: ${statusLabel[statusFilter]}`,
      settlementFilter === "all"
        ? ""
        : `حالة الدفع: ${
            settlementFilter === "paid"
              ? "مدفوع بالكامل"
              : settlementFilter === "partial"
                ? "مدفوع جزئيا"
                : "غير مدفوع"
          }`,
      paymentMethodFilter === "all" ? "" : `طريقة الدفع: ${paymentMethodLabel(paymentMethodFilter)}`,
      employeeFilter === "all"
        ? ""
        : `الموظفة: ${employeeFilterOptions.find(([id]) => id === employeeFilter)?.[1] || employeeFilter}`,
      serviceFilter === "all"
        ? ""
        : `الخدمة: ${serviceFilterOptions.find(([id]) => id === serviceFilter)?.[1] || serviceFilter}`,
      sourceFilter === "all" ? "" : `المصدر: ${sourceFilter}`,
      oldPendingFilter === "off" ? "" : "حجوزات قديمة ما زالت بالانتظار",
      q.trim() ? `بحث: ${q.trim()}` : "",
    ].filter(Boolean);
    return parts.join(" | ");
  }, [
    dateFrom,
    datePreset,
    dateTo,
    employeeFilter,
    employeeFilterOptions,
    oldPendingFilter,
    paymentMethodFilter,
    q,
    serviceFilter,
    serviceFilterOptions,
    settlementFilter,
    sourceFilter,
    statusFilter,
  ]);

  const filteredBookingIds = useMemo(
    () => filteredSorted.map((b) => String(b.id || "").trim()).filter(Boolean),
    [filteredSorted]
  );
  const pageBookingIds = useMemo(
    () => pagedBookings.map((b) => String(b.id || "").trim()).filter(Boolean),
    [pagedBookings]
  );
  const selectedBookings = useMemo(() => {
    const selected = new Set(selectedBookingIds);
    return bookings.filter((b) => selected.has(String(b.id || "").trim()));
  }, [bookings, selectedBookingIds]);
  const selectedPageCount = useMemo(
    () => pageBookingIds.filter((id) => selectedBookingIds.has(id)).length,
    [pageBookingIds, selectedBookingIds]
  );
  const allPageSelected = pageBookingIds.length > 0 && selectedPageCount === pageBookingIds.length;
  const selectedMatchingCount = useMemo(
    () => filteredBookingIds.filter((id) => selectedBookingIds.has(id)).length,
    [filteredBookingIds, selectedBookingIds]
  );

  const toggleBookingSelection = useCallback((bookingId: string) => {
    const id = String(bookingId || "").trim();
    if (!id) return;
    setSelectedBookingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCurrentPageSelection = useCallback(() => {
    setSelectedBookingIds((prev) => {
      const next = new Set(prev);
      const shouldClear = pageBookingIds.length > 0 && pageBookingIds.every((id) => next.has(id));
      pageBookingIds.forEach((id) => {
        if (shouldClear) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, [pageBookingIds]);

  const selectAllMatchingBookings = useCallback(() => {
    if (!filteredBookingIds.length) return;
    const ok = window.confirm(
      `سيتم تحديد ${filteredBookingIds.length} حجز مطابق للفلاتر الحالية، وليس الصفحة الحالية فقط. هل تريد المتابعة؟`
    );
    if (!ok) return;
    setSelectedBookingIds(new Set(filteredBookingIds));
  }, [filteredBookingIds]);

  const clearSelectedBookings = useCallback(() => {
    setSelectedBookingIds(new Set());
  }, []);

  const openBulkStatusModal = useCallback((nextStatus: BookingStatus) => {
    setBulkResultMessage("");
    setBulkError("");
    const eligible = selectedBookings.filter((b) => b.status !== nextStatus);
    if (!eligible.length) {
      setBulkError("لا توجد حجوزات محددة تحتاج إلى هذا التغيير.");
      return;
    }
    setBulkTargetStatus(nextStatus);
  }, [selectedBookings]);

  const closeBulkStatusModal = useCallback(() => {
    if (bulkSaving) return;
    setBulkTargetStatus(null);
    setBulkError("");
  }, [bulkSaving]);

  const confirmBulkStatusUpdate = useCallback(async () => {
    if (!bulkTargetStatus) return;
    const targets = selectedBookings.filter((b) => b.status !== bulkTargetStatus);
    const bookingIds = targets.map((b) => String(b.id || "").trim()).filter(Boolean);
    if (!bookingIds.length) {
      setBulkError("لا توجد حجوزات محددة تحتاج إلى هذا التغيير.");
      return;
    }

    setBulkSaving(true);
    setBulkError("");
    setBulkResultMessage("");
    try {
      const result = await updateCoreBookingsStatusBatch({
        bookingIds,
        status: bulkTargetStatus,
        filterSummary: filterSummaryText,
        note: `تحديث جماعي لحالة الحجوزات إلى ${statusLabel[bulkTargetStatus]}`,
      });
      const localAuditPatch = getLocalActorAudit();
      setBookings((prev) =>
        prev.map((row) =>
          bookingIds.includes(String(row.id || "").trim())
            ? { ...row, status: bulkTargetStatus, ...localAuditPatch }
            : row
        )
      );
      setSelectedBooking((prev) =>
        prev && bookingIds.includes(String(prev.id || "").trim())
          ? { ...prev, status: bulkTargetStatus, ...localAuditPatch }
          : prev
      );
      setBulkResultMessage(
        `تم تحديث ${result.successCount} حجز. فشل ${result.failedCount} حجز.`
      );
      if (result.failedCount === 0) {
        setSelectedBookingIds((prev) => {
          const next = new Set(prev);
          bookingIds.forEach((id) => next.delete(id));
          return next;
        });
        setBulkTargetStatus(null);
      } else {
        setBulkError(result.failures.map((failure) => `${failure.bookingId}: ${failure.message}`).join(" | "));
      }
    } catch (e: any) {
      setBulkError(String(e?.message || e || "تعذر تنفيذ التحديث الجماعي."));
    } finally {
      setBulkSaving(false);
    }
  }, [bulkTargetStatus, filterSummaryText, getLocalActorAudit, selectedBookings]);

  const handlePrintBookingInvoice = useCallback(async (booking: Booking) => {
    const bookingId = String(booking?.id || "").trim();
    if (!bookingId || printInvoiceLockRef.current) return;

    printInvoiceLockRef.current = true;
    setPrintInvoiceBusyId(bookingId);
    setError("");

    try {
      let sourceBooking = booking;
      try {
        const latest = await getCoreBookingById(bookingId);
        if (latest) sourceBooking = latest as Booking;
      } catch (readError) {
        console.warn("Could not refresh booking before invoice print; using current row data.", readError);
      }

      const printableBooking = await enrichCoreBookingForInvoicePrint(sourceBooking);
      const rows = stageBookingInvoiceForPrint(printableBooking);
      if (!rows.length) throw new Error("NO_INVOICE_ROWS");

      const popup = window.open(
        `${window.location.origin}/success-internal`,
        "internal_print_popup",
        "width=980,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
      );
      if (!popup || popup === window) {
        setError("تم منع فتح نافذة الفاتورة. فعّلي النوافذ المنبثقة للموقع ثم جرّبي مرة أخرى.");
        return;
      }
      popup.focus();
    } catch (e) {
      console.error("print booking invoice error:", e);
      setError("تعذر تجهيز الفاتورة للطباعة.");
    } finally {
      window.setTimeout(() => {
        printInvoiceLockRef.current = false;
        setPrintInvoiceBusyId("");
      }, 1500);
    }
  }, []);

  const renderBookingSection = useCallback((section: BookingDisplaySection) => (
    <section
      key={section.key}
      className={`bk-bookings-section bk-bookings-section--${section.key}`}
      aria-label={section.title}
    >
      <div className="bk-bookings-section-head">
        <div className="bk-bookings-section-copy">
          <h2>{section.title}</h2>
          <p>{section.description}</p>
        </div>
        <div className="bk-bookings-section-meta">
          <span className="bk-bookings-section-count">{section.rows.length} حجز</span>
          {section.key === "normal" && section.temporaryInternalCount > 0 ? (
            <span className="bk-bookings-section-note">
              منها {section.temporaryInternalCount} حجز داخلي مستقبلي قبل الدفع
            </span>
          ) : null}
        </div>
      </div>

      {section.rows.length ? (
        <div className="bookings-table-card">
          <div className="bk-table-wrap">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      className="bk-select-checkbox"
                      checked={allPageSelected}
                      onChange={toggleCurrentPageSelection}
                      aria-label="تحديد حجوزات الصفحة الحالية"
                    />
                  </th>
                  <th>رقم الحجز</th>
                  <th>العميلة</th>
                  <th>الخدمة</th>
                  <th>الموظفة</th>
                  <th>التاريخ والوقت</th>
                  <th>آخر تحديث</th>
                  <th>الدفع</th>
                  <th>تفاصيل الدفع</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {section.blocks.flatMap((block) => {
                  const rows: any[] = [];
                  if (block.rows.length > 1) {
                    rows.push(
                      <tr key={`${section.key}-group-${block.key}`} className="bookings-group-row">
                        <td colSpan={10}>
                          <div className="bookings-group-row-inner">
                            <span className="bookings-group-title">حجز مجمّع</span>
                            <span className="bookings-group-meta">
                              المرجع: {block.label} - الخدمات: {block.rows.length}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  block.rows.forEach((b) => {
                    const safeStatus = (["pending", "confirmed", "completed", "cancelled"] as const).includes(
                      b.status as any
                    )
                      ? (b.status as BookingStatus)
                      : "pending";
                    const payment = paymentSummaryByBookingId[b.id] || resolveBookingPaymentSummary(b);
                    const isPendingDeposit = isPendingDepositBooking(b, payment);
                    const channelBadge = bookingChannelBadgeText(b);
                    const isTemporaryInternal = isTemporaryNormalInternalBooking(b);
                    rows.push(
                      <tr
                        key={b.id}
                        className={`bk-row bk-row-${safeStatus}${isPendingDeposit ? " bk-row-pending-deposit" : ""}`}
                      >
                        <td>
                          <input
                            type="checkbox"
                            className="bk-select-checkbox"
                            checked={selectedBookingIds.has(String(b.id || "").trim())}
                            onChange={() => toggleBookingSelection(b.id)}
                            aria-label={`تحديد الحجز ${bookingRef(b)}`}
                          />
                        </td>
                        <td>
                          <div className="bk-ref-cell">
                            <div className="bk-ref-code" title={`المعرف الكامل: ${String(b.id || "—")}`}><bdi className="bk-numeric" dir="ltr">{bookingRef(b)}</bdi></div>
                            <div className="bk-ref-meta">
                              <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                                {statusLabel[safeStatus]}
                              </span>
                              {channelBadge ? (
                                <span
                                  className={`bk-channel-badge${isTemporaryInternal ? " is-temporary" : ""}`}
                                >
                                  {channelBadge}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="bk-customer-name">{b.customerName || "—"}</div>
                          <div className="bk-customer-phone"><bdi className="bk-numeric" dir="ltr">{b.phone || "—"}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-service-main">{serviceSummaryForTable(b)}</div>
                          <div className="bk-service-meta">{serviceMetaSummaryForTable(b)}</div>
                        </td>
                        <td>
                          <span className="bk-employee-pill">{b.employeeName || "—"}</span>
                        </td>
                        <td>
                          <div className="bk-datetime-date"><bdi className="bk-numeric" dir="ltr">{b.date}</bdi></div>
                          <div className="bk-datetime-time"><bdi className="bk-numeric" dir="ltr">{formatTime12(b.time)}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-update-by">{lastUpdateMap[b.id]?.by || "—"}</div>
                          <div className="bk-update-at"><bdi className="bk-numeric" dir="ltr">{lastUpdateMap[b.id]?.at || "—"}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-payment-cell">
                            <div className="bk-payment-total">
                              <span className="bk-payment-total-label">الإجمالي</span>
                              <span className="bk-payment-total-value"><BookingMoney value={payment.totalAmount} /></span>
                            </div>
                            <div className="bk-payment-state-row">
                              <span
                                className={`bk-payment-status ${
                                  payment.remainingAmount <= 0
                                    ? "is-paid"
                                    : payment.paidAmount > 0
                                      ? "is-partial"
                                      : "is-unpaid"
                                }`}
                                title={paymentStatusLabel(payment)}
                              >
                                {compactPaymentStatusLabel(payment)}
                              </span>
                              {bookingPaymentMethodFilterValue(b) !== "none" ? (
                                <span className={`bk-payment-method-chip bk-payment-method-${bookingPaymentMethodFilterValue(b)}`}>
                                  {paymentMethodLabel(bookingPaymentMethodFilterValue(b))}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="bk-payment-details-cell">
                          <div className="bk-payment-breakdown">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={line.key} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{line.label}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value"><BookingMoney value={line.amount} /></span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="bk-actions-cell">
                          <div className="bk-actions-row">
                            <button type="button" className="exp-btn ghost sm" onClick={() => setSelectedBooking(b)}>
                              تفاصيل
                            </button>
                            <button
                              type="button"
                              className="exp-btn ghost sm bk-print-invoice-btn"
                              onClick={() => void handlePrintBookingInvoice(b)}
                              disabled={printInvoiceBusyId === b.id}
                              title="طباعة الفاتورة"
                            >
                              <FontAwesomeIcon icon={faPrint} aria-hidden="true" />
                              <span>{printInvoiceBusyId === b.id ? "تجهيز..." : "طباعة"}</span>
                            </button>
                            {canEditBookings && (
                              <button type="button" className="exp-btn ghost sm" onClick={() => openEditBookingModal(b)}>
                                تعديل
                              </button>
                            )}
                            <button
                              type="button"
                              className="exp-btn ghost sm bk-refund-btn"
                              onClick={() => openRefundModal(b)}
                              disabled={!canManageRefund(b) || refundBusyId === b.id}
                              title={refundMapByBookingId[String(b.id || "").trim()] ? "تم تسجيل استرجاع لهذا الحجز" : "تسجيل استرجاع"}
                            >
                              {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع مسجل" : "استرجاع"}
                            </button>
                            {(uiRole === "owner" || uiRole === "admin") && (
                              <>
                                {uiRole === "owner" && (
                                  <button
                                    type="button"
                                    className="exp-btn danger sm"
                                    onClick={() => handleDeleteBooking(b)}
                                    title="إزالة الحجز من القائمة مع حفظ السجلات المالية"
                                  >
                                    حذف
                                  </button>
                                )}
                                <select
                                  className={`bk-select sm bk-owner-status-select bk-owner-status-compact bk-owner-status-${b.status}`}
                                  value={b.status}
                                  onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                                >
                                  {allStatusOptions.map((s) => (
                                    <option key={`desk_${b.id}_${s}`} value={s}>
                                      {statusLabel[s]}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                            {uiRole === "reception" && b.status === "pending" && (
                              <>
                                <button
                                  type="button"
                                  className="exp-btn sm"
                                  onClick={() => handleUpdateStatus(b.id, "confirmed")}
                                >
                                  تأكيد
                                </button>
                                <button
                                  type="button"
                                  className="exp-btn danger sm"
                                  onClick={() => handleUpdateStatus(b.id, "cancelled")}
                                >
                                  إلغاء
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  });

                  return rows;
                })}
              </tbody>
            </table>
          </div>

          <div className="bk-mobile-grid">
            {section.blocks.map((block) => (
              <div key={`mob-${section.key}-${block.key}`} className="bk-mobile-group">
                {block.rows.length > 1 ? (
                  <div className="bk-mobile-group-head">
                    <span>حجز مجمّع</span>
                    <span>{block.label} - {block.rows.length} خدمات</span>
                  </div>
                ) : null}
                {block.rows.map((b) => {
                  const safeStatus = (["pending", "confirmed", "completed", "cancelled"] as const).includes(
                    b.status as any
                  )
                    ? (b.status as BookingStatus)
                    : "pending";
                  const payment = paymentSummaryByBookingId[b.id] || resolveBookingPaymentSummary(b);
                  const isPendingDeposit = isPendingDepositBooking(b, payment);
                  const channelBadge = bookingChannelBadgeText(b);
                  const isTemporaryInternal = isTemporaryNormalInternalBooking(b);
                  return (
                    <div
                      key={b.id}
                      className={`bk-mobile-card bk-mobile-card-${safeStatus}${isPendingDeposit ? " is-pending-deposit" : ""}`}
                    >
                      <label className="bk-mobile-select-row">
                        <input
                          type="checkbox"
                          className="bk-select-checkbox"
                          checked={selectedBookingIds.has(String(b.id || "").trim())}
                          onChange={() => toggleBookingSelection(b.id)}
                        />
                        <span>تحديد هذا الحجز</span>
                      </label>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">رقم الحجز:</span>
                        <bdi className="bk-mobile-val bk-numeric" dir="ltr" style={{ fontWeight: 900 }}>{bookingRef(b)}</bdi>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">العميلة:</span>
                        <span className="bk-mobile-val">{b.customerName || "—"}</span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">الجوال:</span>
                        <bdi className="bk-mobile-val bk-numeric" dir="ltr">{b.phone || "—"}</bdi>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">الخدمة:</span>
                        <span className="bk-mobile-val">
                          {serviceSummaryForTable(b)}
                          <div style={{ fontSize: 11, opacity: 0.75 }}>{serviceMetaSummaryForTable(b)}</div>
                        </span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">الموظفة:</span>
                        <span className="bk-mobile-val">{b.employeeName || "—"}</span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">التاريخ:</span>
                        <bdi className="bk-mobile-val bk-mobile-date-val bk-numeric" dir="ltr">{b.date} {formatTime12(b.time)}</bdi>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">الحالة:</span>
                        <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                          {statusLabel[safeStatus]}
                        </span>
                      </div>
                      {channelBadge ? (
                        <div className="bk-mobile-row">
                          <span className="bk-mobile-label">نوع الحجز:</span>
                          <span className={`bk-channel-badge${isTemporaryInternal ? " is-temporary" : ""}`}>
                            {channelBadge}
                          </span>
                        </div>
                      ) : null}
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">الدفع:</span>
                        <div className="bk-mobile-val bk-mobile-payment-val">
                          <strong>{paymentStatusLabel(payment)}</strong>
                          <span className={`bk-payment-method-chip bk-payment-method-${bookingPaymentMethodFilterValue(b)}`}>
                            {paymentMethodDisplayText(b)}
                          </span>
                          <div className="bk-mobile-payment-line">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={`mob_pay_${b.id}_${line.key}`} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{line.label}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value"><BookingMoney value={line.amount} /></span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="bk-mobile-actions">
                        <button type="button" className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                        <button
                          type="button"
                          className="exp-btn ghost sm w-100 bk-print-invoice-btn"
                          onClick={() => void handlePrintBookingInvoice(b)}
                          disabled={printInvoiceBusyId === b.id}
                        >
                          <FontAwesomeIcon icon={faPrint} />
                          {printInvoiceBusyId === b.id ? "جاري تجهيز الفاتورة..." : "طباعة الفاتورة"}
                        </button>
                        {canEditBookings && (
                          <button type="button" className="exp-btn ghost sm w-100" onClick={() => openEditBookingModal(b)}>
                            تعديل
                          </button>
                        )}
                        <button
                          type="button"
                          className="exp-btn ghost sm w-100 bk-refund-btn"
                          onClick={() => openRefundModal(b)}
                          disabled={!canManageRefund(b) || refundBusyId === b.id}
                        >
                          {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع مسجل" : "استرجاع"}
                        </button>
                        {(uiRole === "owner" || uiRole === "admin") && (
                          <>
                            {uiRole === "owner" && (
                              <button type="button" className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
                                حذف الحجز
                              </button>
                            )}
                            <select
                              className={`bk-select sm bk-owner-status-select bk-owner-status-compact bk-owner-status-${b.status}`}
                              style={{ height: 40, padding: "0 12px", fontSize: 12 }}
                              value={b.status}
                              onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                            >
                              {allStatusOptions.map((s) => (
                                <option key={`mob_${b.id}_${s}`} value={s}>
                                  {statusLabel[s]}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                        {uiRole === "reception" && b.status === "pending" && (
                          <>
                            <button type="button" className="exp-btn sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>
                              تأكيد
                            </button>
                            <button type="button" className="exp-btn danger sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>
                              إلغاء
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bk-bookings-section-empty" role="status">
          <div className="bk-bookings-empty-card">
            <span className="bk-bookings-empty-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faFilter} />
            </span>
            <strong>
              {hasActiveBookingFilters
                ? "لا توجد نتائج مطابقة"
                : `لا توجد ${section.key === "internal" ? "حجوزات داخلية" : "حجوزات عادية"} حالياً`}
            </strong>
            <p>
              {hasActiveBookingFilters
                ? "غيّر البحث أو الفلاتر الحالية لعرض حجوزات هذا القسم."
                : "عند إضافة حجوزات لهذا القسم ستظهر هنا مباشرة."}
            </p>
            {hasActiveBookingFilters ? (
              <button type="button" className="exp-btn ghost sm" onClick={resetBookingFilters}>
                <FontAwesomeIcon icon={faRotate} /> إعادة ضبط الفلاتر
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  ), [
    allPageSelected,
    canEditBookings,
    canManageRefund,
    handleDeleteBooking,
    handlePrintBookingInvoice,
    handleUpdateStatus,
    hasActiveBookingFilters,
    lastUpdateMap,
    openEditBookingModal,
    openRefundModal,
    paymentSummaryByBookingId,
    printInvoiceBusyId,
    refundBusyId,
    refundMapByBookingId,
    resetBookingFilters,
    selectedBookingIds,
    toggleBookingSelection,
    toggleCurrentPageSelection,
    uiRole,
  ]);

  const bookingSectionsView = useMemo(
    () => bookingSections.map(renderBookingSection),
    [bookingSections, renderBookingSection]
  );

  const bulkTargetBookings = useMemo(
    () => (bulkTargetStatus ? selectedBookings.filter((b) => b.status !== bulkTargetStatus) : []),
    [bulkTargetStatus, selectedBookings]
  );
  const bulkCurrentStatusSummary = useMemo(() => {
    const counts = new Map<BookingStatus, number>();
    bulkTargetBookings.forEach((b) => counts.set(b.status, (counts.get(b.status) || 0) + 1));
    return Array.from(counts.entries())
      .map(([status, count]) => `${statusLabel[status]}: ${count}`)
      .join(" | ");
  }, [bulkTargetBookings]);

  const refreshBookingData = useCallback(() => {
    setError("");
    setLoading(true);
    setBookingsRefreshKey((current) => current + 1);
  }, []);

  if (loading) return <div className="p-5 text-center">جاري التحميل...</div>;

  return (
    <div className="bk-page-wrapper">
      <div className="container-fluid">
        <div className="bookings-header">
          <h1>إدارة الحجوزات</h1>
          <p>عرض وتعديل كافة الحجوزات في النظام</p>
          {error && <div className="bookings-error">{error}</div>}
        </div>

        <div className="bk-mini">
          {unseenNewBookings.length > 0 ? (
            <div className="bk-new-alert" role="status" aria-live="polite">
              <div className="bk-new-alert-head">
                <strong>تنبيه: يوجد {unseenNewBookings.length} حجز جديد.</strong>
                <span>حجوزات جديدة منذ آخر مرة تم الاطلاع عليها.</span>
              </div>

              <div className="bk-new-alert-actions">
                <button
                  type="button"
                  className="bk-new-alert-btn is-primary"
                  onClick={() => setStatusFilter("pending")}
                >
                  عرض الحجوزات الجديدة
                </button>
                <button type="button" className="bk-new-alert-btn" onClick={markNewBookingsSeen}>
                  تم الاطلاع
                </button>
              </div>

              <div className="bk-new-alert-list">
                {unseenNewPreviewBookings.map((b) => (
                  <button
                    key={`new_${b.id}`}
                    type="button"
                    className="bk-new-alert-item"
                    onClick={() => setSelectedBooking(b)}
                    title="فتح تفاصيل الحجز"
                  >
                    <span className="bk-new-alert-ref">
                      {bookingRef(b)} • {b.customerName || "—"}
                    </span>
                    <span className="bk-new-alert-meta">
                      {b.date} {formatTime12(b.time)} • {statusLabel[b.status]}
                    </span>
                  </button>
                ))}
              </div>

              {unseenNewBookings.length > unseenNewPreviewBookings.length ? (
                <div className="bk-new-alert-more">
                  +{unseenNewBookings.length - unseenNewPreviewBookings.length} حجوزات جديدة إضافية
                </div>
              ) : null}
            </div>
          ) : null}

          {staleStatusBookings.length > 0 ? (
            <div className="bk-stale-alert" role="status" aria-live="polite">
              <div className="bk-stale-alert-head">
                <strong>تنبيه: يوجد {staleStatusBookings.length} حجز قديم ما زال غير مغلق.</strong>
                <span>
                  في الانتظار: {stalePendingCount} • مؤكد: {staleConfirmedCount}
                </span>
              </div>

              <div className="bk-stale-alert-list">
                {stalePreviewBookings.map((b) => (
                  <button
                    key={`stale_${b.id}`}
                    type="button"
                    className="bk-stale-alert-item"
                    onClick={() => setSelectedBooking(b)}
                    title="فتح تفاصيل الحجز"
                  >
                    <span className="bk-stale-alert-ref">
                      {bookingRef(b)} • {b.customerName || "—"}
                    </span>
                    <span className="bk-stale-alert-meta">
                      {b.date} {formatTime12(b.time)} • {statusLabel[b.status]}
                    </span>
                  </button>
                ))}
              </div>

              {staleStatusBookings.length > stalePreviewBookings.length ? (
                <div className="bk-stale-alert-more">
                  +{staleStatusBookings.length - stalePreviewBookings.length} حجوزات قديمة إضافية
                </div>
              ) : null}
            </div>
          ) : null}

          {expiredPendingDayDepositBookings.length > 0 ? (
            <div className="bk-stale-alert" role="status" aria-live="polite">
              <div className="bk-stale-alert-head">
                <strong>
                  تنبيه: يوجد {expiredPendingDayDepositBookings.length} حجز في الانتظار (
                  <span className="bk-stale-alert-keyword">عربون</span>) لم يتم تاكيدها من تاريخ انشاء الحجز .
                </strong>
                <span>يرجى مراجعتها وإغلاقها بالحالة المناسبة.</span>
              </div>

              <div className="bk-stale-alert-list">
                {expiredPendingDayDepositBookings.map((b) => (
                  <button
                    key={`expired_pending_deposit_${b.id}`}
                    type="button"
                    className="bk-stale-alert-item"
                    onClick={() => setSelectedBooking(b)}
                    title="فتح تفاصيل الحجز"
                  >
                    {(() => {
                      const createdAtMs = bookingCreationRefMs(b);
                      const createdISO = dateISOFromMillisLocal(createdAtMs) || "—";
                      return (
                        <>
                          <span className="bk-stale-alert-ref">
                            {bookingRef(b)} • {b.customerName || "—"}
                          </span>
                          <span className="bk-stale-alert-meta">
                            إنشاء: {createdISO} • الموعد: {b.date} {formatTime12(b.time)} • في الانتظار (عربون)
                          </span>
                        </>
                      );
                    })()}
                  </button>
                ))}
              </div>

            </div>
          ) : null}

          {expiredPendingDayNoPaymentBookings.length > 0 ? (
            <div className="bk-stale-alert" role="status" aria-live="polite">
              <div className="bk-stale-alert-head">
                <strong>
                  تنبيه: يوجد {expiredPendingDayNoPaymentBookings.length} حجز في الانتظار (
                  <span className="bk-stale-alert-keyword">بدون دفع</span>) لم يتم تاكيدها من تاريخ انشاء الحجز .
                </strong>
                <span>يرجى مراجعتها وإغلاقها بالحالة المناسبة.</span>
              </div>

              <div className="bk-stale-alert-list">
                {expiredPendingDayNoPaymentBookings.map((b) => (
                  <button
                    key={`expired_pending_unpaid_${b.id}`}
                    type="button"
                    className="bk-stale-alert-item"
                    onClick={() => setSelectedBooking(b)}
                    title="فتح تفاصيل الحجز"
                  >
                    {(() => {
                      const createdAtMs = bookingCreationRefMs(b);
                      const createdISO = dateISOFromMillisLocal(createdAtMs) || "—";
                      return (
                        <>
                          <span className="bk-stale-alert-ref">
                            {bookingRef(b)} • {b.customerName || "—"}
                          </span>
                          <span className="bk-stale-alert-meta">
                            إنشاء: {createdISO} • الموعد: {b.date} {formatTime12(b.time)} • في الانتظار (بدون دفع)
                          </span>
                        </>
                      );
                    })()}
                  </button>
                ))}
              </div>

            </div>
          ) : null}

          <div className="bk-headline">
            <div className="bk-status-tabs" role="tablist" aria-label="فلترة حالة الحجز">
              <button
                type="button"
                className={`bk-status-tab ${statusFilter === "all" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                الكل
                <span>{statusTabCounts.all}</span>
              </button>
              <button
                type="button"
                className={`bk-status-tab ${statusFilter === "pending" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("pending")}
              >
                بالانتظار
                <span>{statusTabCounts.pending}</span>
              </button>
              <button
                type="button"
                className={`bk-status-tab ${statusFilter === "confirmed" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("confirmed")}
              >
                مؤكد
                <span>{statusTabCounts.confirmed}</span>
              </button>
              <button
                type="button"
                className={`bk-status-tab ${statusFilter === "completed" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("completed")}
              >
                مكتمل
                <span>{statusTabCounts.completed}</span>
              </button>
              <button
                type="button"
                className={`bk-status-tab ${statusFilter === "cancelled" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("cancelled")}
              >
                ملغي
                <span>{statusTabCounts.cancelled}</span>
              </button>
            </div>
            <div className="bk-total-remaining">
              إجمالي المتبقي: <strong>{totalRemainingAmount} ر.س</strong>
            </div>
          </div>

          <div className="bk-result-summary" role="status">
            <span>المحمّل: {bookings.length}</span>
            <span>بعد الفلترة: {filteredSorted.length}</span>
            <span>المعروض الآن: {pagedBookings.length}</span>
            <span>الصفحة {currentPage} من {totalPages}</span>
          </div>

          <div className="bk-filters">
            <div className="bk-field">
              <label>بحث</label>
              <input 
                type="text"
                className="bk-input bk-search-input" 
                name="booking_filters_search_query"
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                placeholder="اسم، جوال، رقم الحجز، موظفة، أو خدمة..."
                value={q} 
                onChange={e => setQ(e.target.value)} 
              />
            </div>
            <div className="bk-field">
              <label>الفترة الزمنية</label>
              <select
                className="bk-select"
                value={datePreset}
                onChange={(e) => applyDatePreset(e.target.value as DatePresetOption)}
              >
                <option value="all">كل الحجوزات</option>
                <option value="today">اليوم</option>
                <option value="yesterday">أمس</option>
                <option value="week">هذا الأسبوع</option>
                <option value="month">هذا الشهر</option>
                <option value="last_month">الشهر الماضي</option>
                <option value="custom">نطاق مخصص</option>
              </select>
            </div>
            <div className="bk-field bk-field-date">
              <label>من تاريخ</label>
              <input
                type="date"
                className="bk-input bk-date-input"
                lang="ar-SA"
                dir="rtl"
                value={dateFrom}
                onChange={e => {
                  setDatePreset("custom");
                  setDateFrom(e.target.value);
                }}
                onClick={(e) => {
                  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                  if (typeof el.showPicker === "function") el.showPicker();
                }}
              />
            </div>
            <div className="bk-field bk-field-date">
              <label>إلى تاريخ</label>
              <input
                type="date"
                className="bk-input bk-date-input"
                lang="ar-SA"
                dir="rtl"
                value={dateTo}
                onChange={e => {
                  setDatePreset("custom");
                  setDateTo(e.target.value);
                }}
                onClick={(e) => {
                  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                  if (typeof el.showPicker === "function") el.showPicker();
                }}
              />
            </div>
            <div className="bk-field">
              <label>استثناء (في الكل)</label>
              <select
                className="bk-select"
                value={excludedStatus}
                onChange={(e) => setExcludedStatus(e.target.value as ExcludedStatusOption)}
                disabled={statusFilter !== "all"}
              >
                <option value="">بدون استثناء</option>
                {allStatusOptions.map((s) => (
                  <option key={`exclude_${s}`} value={s}>
                    {`استثناء: ${statusLabel[s]}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="bk-field">
              <label>السداد</label>
              <select
                className="bk-select"
                value={settlementFilter}
                onChange={(e) => setSettlementFilter(e.target.value as SettlementFilterOption)}
              >
                <option value="all">الكل</option>
                <option value="paid">مدفوع بالكامل</option>
                <option value="partial">مدفوع جزئيا</option>
                <option value="unpaid">غير مدفوع</option>
              </select>
            </div>
            <div className="bk-field">
              <label>طريقة الدفع</label>
              <select
                className="bk-select"
                value={paymentMethodFilter}
                onChange={(e) => setPaymentMethodFilter(e.target.value as PaymentMethodFilterOption)}
              >
                <option value="all">كل الطرق</option>
                <option value="cash">كاش</option>
                <option value="card">شبكة</option>
                <option value="transfer">تحويل</option>
                <option value="mixed">مختلط</option>
                <option value="other">أخرى</option>
                <option value="none">بدون دفع</option>
              </select>
            </div>
            <div className="bk-field">
              <label>الموظفة</label>
              <select
                className="bk-select"
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
              >
                <option value="all">كل الموظفات</option>
                {employeeFilterOptions.map(([id, label]) => (
                  <option key={`employee_filter_${id}`} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="bk-field">
              <label>الخدمة</label>
              <select
                className="bk-select"
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
              >
                <option value="all">كل الخدمات</option>
                {serviceFilterOptions.map(([id, label]) => (
                  <option key={`service_filter_${id}`} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="bk-field">
              <label>مصدر الحجز</label>
              <select
                className="bk-select"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as BookingSourceFilterOption)}
              >
                <option value="all">كل المصادر</option>
                <option value="client">موقع العميلات</option>
                <option value="dashboard">الداشبورد</option>
                <option value="internal">الحجز الداخلي</option>
                <option value="unknown">غير محدد</option>
              </select>
            </div>
            <div className="bk-field">
              <label>الترتيب</label>
              <select
                className="bk-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrderOption)}
              >
                <option value="newest">الأحدث أولا</option>
                <option value="oldest">الأقدم أولا</option>
              </select>
            </div>
            <div className="bk-field">
              <label>حجوزات قديمة بالانتظار</label>
              <select
                className="bk-select"
                value={oldPendingFilter}
                onChange={(e) => setOldPendingFilter(e.target.value as OldPendingFilterOption)}
              >
                <option value="off">بدون فلتر</option>
                <option value="before_today">الأقدم من اليوم</option>
                <option value="older_7">الأقدم من 7 أيام</option>
                <option value="older_30">الأقدم من 30 يوما</option>
                <option value="custom">نطاق مخصص</option>
              </select>
            </div>
            {oldPendingFilter === "custom" ? (
              <>
                <div className="bk-field bk-field-date">
                  <label>قديم من</label>
                  <input
                    type="date"
                    className="bk-input bk-date-input"
                    value={oldPendingFrom}
                    onChange={(e) => setOldPendingFrom(e.target.value)}
                  />
                </div>
                <div className="bk-field bk-field-date">
                  <label>قديم إلى</label>
                  <input
                    type="date"
                    className="bk-input bk-date-input"
                    value={oldPendingTo}
                    onChange={(e) => setOldPendingTo(e.target.value)}
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="bk-actions">
            <button className="exp-btn ghost" type="button" onClick={refreshBookingData}>
              <FontAwesomeIcon icon={faRotate} /> تحديث البيانات
            </button>
            <button className="exp-btn" onClick={handleExport}>
              <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
            </button>
            <button
              className="exp-btn ghost"
              onClick={resetBookingFilters}
              disabled={!hasActiveBookingFilters}
            >
              <FontAwesomeIcon icon={faRotate} /> مسح الفلاتر
            </button>
          </div>

          <div className="bk-bulk-toolbar">
            <div className="bk-bulk-summary">
              <strong>{selectedBookingIds.size}</strong>
              <span>حجز محدد</span>
              <span>منها {selectedMatchingCount} ضمن النتائج الحالية</span>
            </div>
            <div className="bk-bulk-actions">
              <button type="button" className="exp-btn ghost" onClick={toggleCurrentPageSelection} disabled={!pageBookingIds.length}>
                {allPageSelected ? "إلغاء تحديد الصفحة" : "تحديد الصفحة الحالية"}
              </button>
              <button type="button" className="exp-btn ghost" onClick={selectAllMatchingBookings} disabled={!filteredBookingIds.length}>
                تحديد كل النتائج المطابقة
              </button>
              <button type="button" className="exp-btn ghost" onClick={clearSelectedBookings} disabled={!selectedBookingIds.size}>
                إلغاء التحديد
              </button>
              <button type="button" className="exp-btn" onClick={() => openBulkStatusModal("completed")} disabled={!selectedBookingIds.size}>
                تحويل إلى مكتمل
              </button>
              <button type="button" className="exp-btn" onClick={() => openBulkStatusModal("confirmed")} disabled={!selectedBookingIds.size}>
                تحويل إلى مؤكد
              </button>
              <button type="button" className="exp-btn danger" onClick={() => openBulkStatusModal("cancelled")} disabled={!selectedBookingIds.size}>
                تحويل إلى ملغي
              </button>
            </div>
            {bulkResultMessage ? <div className="bk-bulk-result">{bulkResultMessage}</div> : null}
            {bulkError ? <div className="bk-bulk-error">{bulkError}</div> : null}
          </div>

          <div className="bk-pagination-bar">
            <div className="bk-pagination-count">
              عرض {pagedBookings.length ? (currentPage - 1) * pageSize + 1 : 0}
              {" - "}
              {Math.min(currentPage * pageSize, filteredSorted.length)}
              {" من "}
              {filteredSorted.length} حجز
            </div>
            <div className="bk-pagination-controls">
              <label>
                لكل صفحة
                <select
                  className="bk-select"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || DEFAULT_PAGE_SIZE)}
                >
                  {pageSizeOptions.map((size) => (
                    <option key={`page_size_${size}`} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="exp-btn ghost" onClick={() => setCurrentPage(1)} disabled={currentPage <= 1}>
                الأولى
              </button>
              <button type="button" className="exp-btn ghost" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                السابق
              </button>
              <span className="bk-page-number">صفحة {currentPage} / {totalPages}</span>
              <button type="button" className="exp-btn ghost" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                التالي
              </button>
              <button type="button" className="exp-btn ghost" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages}>
                الأخيرة
              </button>
            </div>
          </div>
        </div>

        <div className="bk-bookings-sections">
          {bookingSectionsView}
        </div>

        {false ? (
        <div className="bookings-table-card">
          <div className="bk-table-wrap">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>رقم الحجز</th>
                  <th>الزبون</th>
                  <th>الخدمة</th>
                  <th>الموظفة</th>
                  <th>التاريخ والوقت</th>
                  <th>آخر تحديث</th>
                  <th>السعر</th>
                  <th>تفاصيل الدفع</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {bookingSections.flatMap((section) => section.blocks).flatMap((block) => {
                  const rows: any[] = [];
                  if (block.rows.length > 1) {
                    rows.push(
                      <tr key={`group-${block.key}`} className="bookings-group-row">
                        <td colSpan={9}>
                          <div className="bookings-group-row-inner">
                            <span className="bookings-group-title">حجز مجمّع</span>
                            <span className="bookings-group-meta">
                              المرجع: {block.label} - الخدمات: {block.rows.length}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  block.rows.forEach((b) => {
                    const safeStatus = (["pending", "confirmed", "completed", "cancelled"] as const).includes(
                      b.status as any
                    )
                      ? (b.status as BookingStatus)
                      : "pending";
                    const payment = resolveBookingPaymentSummary(b);
                    const isPendingDeposit = isPendingDepositBooking(b, payment);
                    rows.push(
                      <tr
                        key={b.id}
                        className={`bk-row bk-row-${safeStatus}${isPendingDeposit ? " bk-row-pending-deposit" : ""}`}
                      >
                        <td>
                          <div className="bk-ref-cell">
                            <div className="bk-ref-code" title={`المعرف الكامل: ${String(b.id || "—")}`}><bdi className="bk-numeric" dir="ltr">{bookingRef(b)}</bdi></div>
                            <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                              {statusLabel[safeStatus]}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="bk-customer-name">{b.customerName || "—"}</div>
                          <div className="bk-customer-phone"><bdi className="bk-numeric" dir="ltr">{b.phone || "—"}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-service-main">{serviceSummaryForTable(b)}</div>
                          <div className="bk-service-meta">{serviceMetaSummaryForTable(b)}</div>
                        </td>
                        <td>
                          <span className="bk-employee-pill">{b.employeeName || "—"}</span>
                        </td>
                        <td>
                          <div className="bk-datetime-date"><bdi className="bk-numeric" dir="ltr">{b.date}</bdi></div>
                          <div className="bk-datetime-time"><bdi className="bk-numeric" dir="ltr">{formatTime12(b.time)}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-update-by">{lastUpdateMap[b.id]?.by || "—"}</div>
                          <div className="bk-update-at"><bdi className="bk-numeric" dir="ltr">{lastUpdateMap[b.id]?.at || "—"}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-payment-cell">
                            <div className="bk-payment-total">
                              <span className="bk-payment-total-label">الإجمالي</span>
                              <span className="bk-payment-total-value"><BookingMoney value={payment.totalAmount} /></span>
                            </div>
                            <div className="bk-payment-state-row">
                              <span
                                className={`bk-payment-status ${
                                  payment.remainingAmount <= 0
                                    ? "is-paid"
                                    : payment.paidAmount > 0
                                      ? "is-partial"
                                      : "is-unpaid"
                                }`}
                                title={paymentStatusLabel(payment)}
                              >
                                {compactPaymentStatusLabel(payment)}
                              </span>
                              {bookingPaymentMethodFilterValue(b) !== "none" ? (
                                <span className={`bk-payment-method-chip bk-payment-method-${bookingPaymentMethodFilterValue(b)}`}>
                                  {paymentMethodLabel(bookingPaymentMethodFilterValue(b))}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="bk-payment-details-cell">
                          <div className="bk-payment-breakdown">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={line.key} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{line.label}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value"><BookingMoney value={line.amount} /></span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="bk-actions-cell">
                          <div className="bk-actions-row">
                            <button type="button" className="exp-btn ghost sm" onClick={() => setSelectedBooking(b)}>
                              تفاصيل
                            </button>
                            {canEditBookings && (
                              <button type="button" className="exp-btn ghost sm" onClick={() => openEditBookingModal(b)}>
                                تعديل
                              </button>
                            )}
                            <button
                              type="button"
                              className="exp-btn ghost sm bk-refund-btn"
                              onClick={() => openRefundModal(b)}
                              disabled={!canManageRefund(b) || refundBusyId === b.id}
                              title={refundMapByBookingId[String(b.id || "").trim()] ? "تعديل/إلغاء الاسترجاع" : "تسجيل استرجاع"}
                            >
                              {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع" : "استرجاع"}
                            </button>
                            {(uiRole === "owner" || uiRole === "admin") && (
                              <>
                                {uiRole === "owner" && (
                                  <button
                                    type="button"
                                    className="exp-btn danger sm"
                                    onClick={() => handleDeleteBooking(b)}
                                    title="إزالة الحجز من القائمة مع حفظ السجلات المالية"
                                  >
                                    حذف
                                  </button>
                                )}
                                <select
                                  className={`bk-select sm bk-owner-status-select bk-owner-status-compact bk-owner-status-${b.status}`}
                                  style={{ width: "auto", height: 40, padding: "0 12px", fontSize: 12 }}
                                  value={b.status}
                                  onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                                >
                                  {allStatusOptions.map((s) => (
                                    <option key={`desk_${b.id}_${s}`} value={s}>
                                      {statusLabel[s]}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                            {uiRole === "reception" && b.status === "pending" && (
                              <>
                                <button
                                  type="button"
                                  className="exp-btn sm"
                                  onClick={() => handleUpdateStatus(b.id, "confirmed")}
                                >
                                  تأكيد
                                </button>
                                <button
                                  type="button"
                                  className="exp-btn danger sm"
                                  onClick={() => handleUpdateStatus(b.id, "cancelled")}
                                >
                                  إلغاء
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  });

                  return rows;
                })}
              </tbody>
            </table>
          </div>

          <div className="bk-mobile-grid">
            {bookingSections.flatMap((section) => section.blocks).map((block) => (
              <div key={`mob-${block.key}`} className="bk-mobile-group">
                {block.rows.length > 1 ? (
                  <div className="bk-mobile-group-head">
                    <span>حجز مجمّع</span>
                    <span>{block.label} - {block.rows.length} خدمات</span>
                  </div>
                ) : null}
                {block.rows.map((b) => {
                  const safeStatus = (["pending", "confirmed", "completed", "cancelled"] as const).includes(
                    b.status as any
                  )
                    ? (b.status as BookingStatus)
                    : "pending";
                  const payment = resolveBookingPaymentSummary(b);
                  const isPendingDeposit = isPendingDepositBooking(b, payment);
                  return (
                  <div
                    key={b.id}
                    className={`bk-mobile-card bk-mobile-card-${safeStatus}${isPendingDeposit ? " is-pending-deposit" : ""}`}
                  >
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">رقم الحجز:</span>
                      <span className="bk-mobile-val" style={{fontWeight: 900}}>{bookingRef(b)}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الزبون:</span>
                      <span className="bk-mobile-val">{b.customerName || "—"}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الجوال:</span>
                      <bdi className="bk-mobile-val bk-numeric" dir="ltr">{b.phone || "—"}</bdi>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الخدمة:</span>
                      <span className="bk-mobile-val">
                        {serviceSummaryForTable(b)}
                        <div style={{ fontSize: 11, opacity: 0.75 }}>{serviceMetaSummaryForTable(b)}</div>
                      </span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الموظفة:</span>
                      <span className="bk-mobile-val">{b.employeeName || "—"}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">التاريخ:</span>
                      <bdi className="bk-mobile-val bk-mobile-date-val bk-numeric" dir="ltr">{b.date} {formatTime12(b.time)}</bdi>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الحالة:</span>
                      <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                        {statusLabel[safeStatus]}
                      </span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الدفع:</span>
                      <div className="bk-mobile-val bk-mobile-payment-val">
                        <strong>{paymentStatusLabel(payment)}</strong>
                        <div className="bk-mobile-payment-line">
                          {paymentAmountsDisplayLines(payment).map((line) => (
                            <div key={`mob_pay_${b.id}_${line.key}`} className={`bk-payment-metric-row ${line.tone}`}>
                              <span className="bk-payment-metric-label">{line.label}</span>
                              {typeof line.amount === "number" ? (
                                <span className="bk-payment-metric-value"><BookingMoney value={line.amount} /></span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="bk-mobile-actions">
                       <button type="button" className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                       {canEditBookings && (
                         <button type="button" className="exp-btn ghost sm w-100" onClick={() => openEditBookingModal(b)}>
                           تعديل
                         </button>
                       )}
                       <button
                         className="exp-btn ghost sm w-100 bk-refund-btn"
                         onClick={() => openRefundModal(b)}
                         disabled={!canManageRefund(b) || refundBusyId === b.id}
                       >
                         {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع" : "استرجاع"}
                       </button>
                       {(uiRole === "owner" || uiRole === "admin") && (
                         <>
                           {uiRole === "owner" && (
                             <button type="button" className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
                               حذف الحجز
                             </button>
                           )}
                           <select
                             className={`bk-select sm bk-owner-status-select bk-owner-status-compact bk-owner-status-${b.status}`}
                             style={{ height: 40, padding: "0 12px", fontSize: 12 }}
                             value={b.status}
                             onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                           >
                             {allStatusOptions.map((s) => (
                               <option key={`mob_${b.id}_${s}`} value={s}>
                                 {statusLabel[s]}
                               </option>
                             ))}
                           </select>
                         </>
                       )}
                       {uiRole === "reception" && b.status === "pending" && (
                         <>
                           <button type="button" className="exp-btn sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>
                             تأكيد
                           </button>
                           <button type="button" className="exp-btn danger sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>
                             إلغاء
                           </button>
                         </>
                       )}
                    </div>
                  </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        ) : null}

        {selectedBooking && (
          <Modal
            open={!!selectedBooking}
            onClose={closeBookingModal}
            ariaLabel="تفاصيل الحجز"
            panelClassName="bk-modal"
            size="lg"
          >
            <div className="modal-head">
              <b>تفاصيل الحجز #{bookingRef(selectedBooking)}</b>
              <button className="exp-btn ghost" onClick={closeBookingModal}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="modal-body">
              <div className="bk-booking-sheet">
                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>بيانات الحجز</h4>
                      <span>نفس البيانات الحالية مع ترتيب أوضح ومسافات أنظف بين البطاقات.</span>
                    </div>
                  </div>

                  <div className="bk-details-grid">
                    <div className="bk-item bk-item--hero">
                      <span className="bk-item-label">رقم الحجز</span>
                      <span className="bk-item-val">{bookingRef(selectedBooking)}</span>
                      <div className="bk-item-chip-row">
                        <span className="bk-created-badge">
                          تم إنشاء الحجز: {formatAnyDateTime(bookingCreationRefMs(selectedBooking))}
                        </span>
                        {lastUpdateMap[selectedBooking.id]?.at ? (
                          <span className="bk-created-badge is-muted">
                            آخر تحديث: {lastUpdateMap[selectedBooking.id]?.at}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="bk-item">
                      <span className="bk-item-label">اسم الزبون</span>
                      <span className="bk-item-val">{selectedBooking.customerName || "—"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">رقم الهاتف</span>
                      <span className="bk-item-val">{selectedBooking.phone || "—"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">نقاط العميلة</span>
                      <span className="bk-item-val">
                        {clientLoyaltyLoading ? "..." : `${clientLoyalty?.points ?? 0} نقطة`}
                      </span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">ولاء العميلة</span>
                      <span className="bk-item-val">
                        {clientLoyaltyLoading
                          ? "..."
                          : `${clientLoyalty?.loyaltyScore ?? 0}${clientLoyalty?.isVip ? " • VIP" : ""}`}
                      </span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">المصدر</span>
                      <span className="bk-item-val">{channelLabel(selectedBooking.channel)}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">التاريخ</span>
                      <span className="bk-item-val">{selectedBooking.date}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">الوقت</span>
                      <span className="bk-item-val">{formatTime12(selectedBooking.time)}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">الموظفة</span>
                      <span className="bk-item-val">{selectedBooking.employeeName || "—"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">مدة الخدمة</span>
                      <span className="bk-item-val">
                        {Number(selectedBooking.durationMin || 0) > 0
                          ? `${selectedBooking.durationMin} دقيقة`
                          : "—"}
                      </span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">السعر الإجمالي</span>
                      <span className="bk-item-val">{selectedBookingPayment.totalAmount} ر.س</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">نوع الدفع</span>
                      <span className="bk-item-val">{paymentStatusLabel(selectedBookingPayment)}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">طريقة الدفع</span>
                      <span className="bk-item-val">{paymentMethodDisplayText(selectedBooking)}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">المدفوع</span>
                      <span className="bk-item-val">{selectedBookingPayment.paidAmount} ر.س</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">المتبقي</span>
                      <span className="bk-item-val">{selectedBookingPayment.remainingAmount} ر.س</span>
                    </div>
                    <div className="bk-item bk-item--wide">
                      <span className="bk-item-label">الحالة</span>
                      <span className="bk-item-val">
                        <span
                          className={`status-badge ${selectedBooking.status}${selectedBookingIsPendingDeposit ? " pending-deposit" : ""}`}
                        >
                          {statusLabel[selectedBooking.status]}
                        </span>
                      </span>
                    </div>
                  </div>
                </section>

                <section className="bk-booking-section bk-booking-section--timeline">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>سجل الحجز</h4>
                      <span>تسلسل الأحداث للحجز من الأحدث إلى الأقدم.</span>
                    </div>
                  </div>

                  {selectedBookingActivityLoading ? (
                    <div className="bk-activity-empty">جاري تحميل سجل الحجز...</div>
                  ) : selectedBookingActivity.length > 0 ? (
                    <div className="bk-activity-timeline">
                      {selectedBookingActivity.map((event) => (
                        <div
                          key={event.id}
                          className={`bk-activity-item bk-activity-item--${event.tone}`}
                        >
                          <div className="bk-activity-rail">
                            <span className="bk-activity-dot" />
                            <span className="bk-activity-line" />
                          </div>

                          <div className="bk-activity-card">
                            <div className="bk-activity-top">
                              <div className="bk-activity-copy">
                                <strong>{event.title}</strong>
                                <div className="bk-activity-meta">
                                  <span className={`bk-activity-kind bk-activity-kind--${event.actorKind}`}>
                                    {event.actorKindLabel}
                                  </span>
                                  <span>
                                    <span className="bk-activity-meta-label">بواسطة:</span>{" "}
                                    {event.actorName}
                                  </span>
                                </div>
                              </div>

                              <div className="bk-activity-time">{event.atLabel}</div>
                            </div>

                            {event.changes.length ? (
                              <div className="bk-activity-changes">
                                <span className="bk-activity-meta-label">ما الذي تغير:</span>
                                {event.changes.map((change, index) => (
                                  <div key={`${event.id}_change_${index}`} className="bk-activity-change">
                                    {change}
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {event.note ? (
                              <div className="bk-activity-note">{event.note}</div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bk-activity-empty">
                      {selectedBookingActivityError || "لا توجد أحداث مسجلة لهذا الحجز حتى الآن."}
                    </div>
                  )}

                  {selectedBookingActivityError && selectedBookingActivity.length > 0 ? (
                    <div className="bk-activity-note">{selectedBookingActivityError}</div>
                  ) : null}
                </section>

                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>الخدمات داخل الحجز</h4>
                    </div>
                  </div>
                  <div className="bk-services-list">
                    {(selectedBooking.services && selectedBooking.services.length > 0
                      ? selectedBooking.services
                      : [{ serviceName: selectedBooking.serviceName, serviceId: selectedBooking.serviceId }]
                    ).map((s, idx) => (
                      <div key={`modern_${selectedBooking.id}_svc_${idx}`} className="bk-service-row">
                        <span>
                          {toArabicOnlyLabel(String(s.serviceName || s.serviceId || ""), "خدمة")}
                          <div className="bk-service-row-sub">
                            {toArabicOnlyLabel(String(s.sectionLabel || ""), "—")} • {toArabicOnlyLabel(String(s.categoryLabel || ""), "—")}
                          </div>
                        </span>
                        <span>
                          {Number(s.durationMin || 0) > 0 ? `${s.durationMin} د` : "—"} • {Number(s.price || 0) > 0 ? `${s.price} ر.س` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>ملاحظات سابقة على العميلة</h4>
                    </div>
                  </div>
                  {previousClientNotes.length === 0 ? (
                    <div className="bk-events-empty">لا توجد ملاحظات سابقة لهذه العميلة.</div>
                  ) : (
                    <div className="bk-events-list">
                      {previousClientNotes.map((n) => (
                        <div key={`modern_${n.id}`} className="bk-event-row">
                          <div className="bk-event-top">
                            <strong>#{n.ref}</strong>
                            <span>{n.date} {formatTime12(n.time)}</span>
                          </div>
                          <div className="bk-event-note">{n.note}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>ملاحظات الإدارة (خاصة)</h4>
                    </div>
                  </div>
                  <textarea
                    className="bk-input bk-booking-note-input"
                    rows={3}
                    placeholder="أضف ملاحظات هنا..."
                    value={noteDrafts[selectedBooking.id] ?? notesMap[selectedBooking.id] ?? ""}
                    onChange={(e) => updateNote(selectedBooking.id, e.target.value)}
                  />
                  <div className="bk-note-actions">
                    <button
                      type="button"
                      className="exp-btn"
                      onClick={() => saveNote(selectedBooking.id)}
                    >
                      حفظ الملاحظة
                    </button>
                    {savedNoteId === selectedBooking.id ? (
                      <span className="bk-note-saved">تم الحفظ</span>
                    ) : null}
                  </div>
                </section>
              </div>
              <div className="bk-booking-legacy-hide" aria-hidden="true">
              <div className="bk-details-grid">
                <div className="bk-item">
                  <span className="bk-item-label">رقم الحجز</span>
                  <span className="bk-item-val">{bookingRef(selectedBooking)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">اسم الزبون</span>
                  <span className="bk-item-val">{selectedBooking.customerName || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">رقم الهاتف</span>
                  <span className="bk-item-val">{selectedBooking.phone || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">نقاط العميلة</span>
                  <span className="bk-item-val">
                    {clientLoyaltyLoading ? "..." : `${clientLoyalty?.points ?? 0} نقطة`}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ولاء العميلة</span>
                  <span className="bk-item-val">
                    {clientLoyaltyLoading
                      ? "..."
                      : `${clientLoyalty?.loyaltyScore ?? 0}${(clientLoyalty?.isVip ? " • VIP" : "")}`}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">المصدر</span>
                  <span className="bk-item-val">{channelLabel(selectedBooking.channel)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">التاريخ</span>
                  <span className="bk-item-val">{selectedBooking.date}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الوقت</span>
                  <span className="bk-item-val">{formatTime12(selectedBooking.time)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الموظفة</span>
                  <span className="bk-item-val">{selectedBooking.employeeName || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">مدة الخدمة</span>
                  <span className="bk-item-val">
                    {Number(selectedBooking.durationMin || 0) > 0
                      ? `${selectedBooking.durationMin} دقيقة`
                      : "—"}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">السعر الإجمالي</span>
                  <span className="bk-item-val">{selectedBookingPayment.totalAmount} ر.س</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">نوع الدفع</span>
                  <span className="bk-item-val">
                    {paymentStatusLabel(selectedBookingPayment)}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">المدفوع</span>
                  <span className="bk-item-val">{selectedBookingPayment.paidAmount} ر.س</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">المتبقي</span>
                  <span className="bk-item-val">{selectedBookingPayment.remainingAmount} ر.س</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الحالة</span>
                  <span className="bk-item-val">
                    <span
                      className={`status-badge ${selectedBooking.status}${selectedBookingIsPendingDeposit ? " pending-deposit" : ""}`}
                    >
                      {statusLabel[selectedBooking.status]}
                    </span>
                  </span>
                </div>
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">الخدمات داخل الحجز</label>
                <div className="bk-services-list">
                  {(selectedBooking.services && selectedBooking.services.length > 0
                    ? selectedBooking.services
                    : [{ serviceName: selectedBooking.serviceName, serviceId: selectedBooking.serviceId }]
                  ).map((s, idx) => (
                    <div key={`${selectedBooking.id}_svc_${idx}`} className="bk-service-row">
                      <span>
                        {toArabicOnlyLabel(String(s.serviceName || s.serviceId || ""), "خدمة")}
                        <div style={{ fontSize: 11, opacity: 0.75 }}>
                          {toArabicOnlyLabel(String(s.sectionLabel || ""), "—")} • {toArabicOnlyLabel(String(s.categoryLabel || ""), "—")}
                        </div>
                      </span>
                      <span>
                        {Number(s.durationMin || 0) > 0 ? `${s.durationMin} د` : "—"} · {Number(s.price || 0) > 0 ? `${s.price} ر.س` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">ملاحظات سابقة على العميلة</label>
                {previousClientNotes.length === 0 ? (
                  <div className="bk-events-empty">لا توجد ملاحظات سابقة لهذه العميلة.</div>
                ) : (
                  <div className="bk-events-list">
                    {previousClientNotes.map((n) => (
                      <div key={n.id} className="bk-event-row">
                        <div className="bk-event-top">
                          <strong>#{n.ref}</strong>
                          <span>{n.date} {formatTime12(n.time)}</span>
                        </div>
                        <div className="bk-event-note">{n.note}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">ملاحظات الإدارة (خاصة)</label>
                <textarea 
                  className="bk-input" 
                  rows={3} 
                  placeholder="أضف ملاحظات هنا..."
                  value={noteDrafts[selectedBooking.id] ?? notesMap[selectedBooking.id] ?? ""}
                  onChange={e => updateNote(selectedBooking.id, e.target.value)}
                />
                <div className="bk-note-actions">
                  <button
                    type="button"
                    className="exp-btn"
                    onClick={() => saveNote(selectedBooking.id)}
                  >
                    حفظ الملاحظة
                  </button>
                  {savedNoteId === selectedBooking.id ? (
                    <span className="bk-note-saved">تم الحفظ</span>
                  ) : null}
                </div>
              </div>
            </div>
              </div>
            <div className="modal-foot">
              {canManageRefund(selectedBooking) && (
                <button className="exp-btn ghost" onClick={() => openRefundModal(selectedBooking)}>
                  {refundMapByBookingId[String(selectedBooking.id || "").trim()]
                    ? "إدارة الاسترجاع"
                    : "تسجيل استرجاع"}
                </button>
              )}
              {canEditBookings && (
                <button className="exp-btn ghost" onClick={() => openEditBookingModal(selectedBooking)}>
                  تعديل الحجز
                </button>
              )}
              {uiRole === "owner" && (
                <button className="exp-btn danger" onClick={() => handleDeleteBooking(selectedBooking)}>
                  حذف الحجز
                </button>
              )}
              <button className="exp-btn bk-close-btn" onClick={closeBookingModal}>إغلاق</button>
            </div>
          </Modal>
        )}

        {pendingSensitiveAction ? (
          <ActionPinModal
            action={pendingSensitiveAction}
            onClose={closeActionPinModal}
            onConfirm={executeSensitiveAction}
            onVerifyPassword={verifyCurrentAccountPassword}
          />
        ) : null}

        {/*
        <Modal
          open={actionPinOpen}
          onClose={closeActionPinModal}
          ariaLabel="التحقق بالرقم السري"
          panelClassName="bk-cancel-modal bk-action-pin-modal"
          size="sm"
        >
          <div className="bk-cancel-head">تأكيد الإجراء</div>
          <div className="bk-cancel-body">
            <div className="bk-action-pin-summary">
              <div className="bk-action-pin-summary-label">الإجراء المطلوب</div>
              <div className="bk-action-pin-summary-value">
                {sensitiveActionDescription(pendingSensitiveAction) || "إجراء حساس"}
              </div>
              {pendingSensitiveAction?.kind === "delete" ? (
                <div className="bk-action-pin-warning">سيختفي الحجز من صفحة الحجوزات مع الاحتفاظ بالسجلات المالية.</div>
              ) : null}
            </div>
            <div className="bk-action-pin-form">
              <label className="bk-action-pin-label" htmlFor="booking_action_pin_input">
                الرقم السري
              </label>
              <input
                id="booking_action_pin_input"
                type="password"
                className="bk-input bk-action-pin-input"
                value={actionPin}
                onChange={(e) => setActionPin(e.target.value)}
                placeholder="أدخلي الرقم السري"
                autoComplete="new-password"
                name="booking_action_pin"
                inputMode="numeric"
                disabled={actionPinBusy}
                autoFocus
              />
              <div className="bk-action-pin-hint">هذا التحقق مخصص لحماية التعديلات الحساسة.</div>
            </div>
            {actionPinError ? (
              <div className="bk-action-pin-error">{actionPinError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeActionPinModal}
              disabled={actionPinBusy}
            >
              إلغاء
            </button>
            <button
              type="button"
              className={`exp-btn ${pendingSensitiveAction?.kind === "delete" ? "danger" : ""}`}
              onClick={confirmSensitiveAction}
              disabled={actionPinBusy}
            >
              {actionPinBusy ? "جاري التحقق..." : "متابعة"}
            </button>
          </div>
        </Modal>
        */}

        <Modal
          open={!!bulkTargetStatus}
          onClose={closeBulkStatusModal}
          ariaLabel="تأكيد الإجراء الجماعي للحجوزات"
          panelClassName="bk-cancel-modal bk-bulk-modal"
          size="sm"
        >
          <div className="bk-cancel-head">تأكيد الإجراء الجماعي</div>
          <div className="bk-cancel-body">
            <div className="bk-bulk-confirm-list">
              <div>
                <span>عدد الحجوزات التي ستتغير</span>
                <strong>{bulkTargetBookings.length}</strong>
              </div>
              <div>
                <span>الحالة الحالية</span>
                <strong>{bulkCurrentStatusSummary || "غير محدد"}</strong>
              </div>
              <div>
                <span>الحالة الجديدة</span>
                <strong>{bulkTargetStatus ? statusLabel[bulkTargetStatus] : "غير محدد"}</strong>
              </div>
              <div>
                <span>التاريخ/الفلاتر المستخدمة</span>
                <strong>{filterSummaryText || "بدون فلاتر"}</strong>
              </div>
            </div>
            <div className="bk-action-pin-warning">
              تنبيه: هذا الإجراء سيؤثر في عدة حجوزات محددة فقط. لن يتم تعديل أي حجز غير محدد.
            </div>
            {bulkError ? <div className="bk-action-pin-error">{bulkError}</div> : null}
          </div>
          <div className="bk-cancel-foot">
            <button type="button" className="exp-btn ghost" onClick={closeBulkStatusModal} disabled={bulkSaving}>
              رجوع
            </button>
            <button
              type="button"
              className={`exp-btn ${bulkTargetStatus === "cancelled" ? "danger" : ""}`}
              onClick={() => void confirmBulkStatusUpdate()}
              disabled={bulkSaving || !bulkTargetBookings.length}
            >
              {bulkSaving ? "جاري التحديث..." : "تأكيد التحديث الجماعي"}
            </button>
          </div>
        </Modal>

        <Modal
          open={!!refundTarget}
          onClose={closeRefundModal}
          ariaLabel="الاسترجاع"
          panelClassName="bk-refund-modal"
          size="sm"
        >
          <div className="bk-cancel-head">إدارة الاسترجاع</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>رقم الحجز: {bookingRef(refundTarget)}</span>
              <span>العميلة: {refundTarget?.customerName || "—"}</span>
              <span>قيمة الحجز: {refundTarget ? readBookingTotalAmount(refundTarget) : 0} ر.س</span>
            </div>

            <div className={`bk-refund-status ${activeRefundForTarget ? "is-refunded" : "is-none"}`}>
              {activeRefundForTarget ? (
                <>
                  <strong>حالة الاسترجاع: تم الاسترجاع</strong>
                  <span>
                    المبلغ: {Number(activeRefundForTarget.amount || 0).toLocaleString()} ر.س
                    {" • "}
                    الطريقة: {activeRefundForTarget.method === "transfer" ? "تحويل" : activeRefundForTarget.method === "card" ? "شبكة" : "كاش"}
                    {" • "}
                    التاريخ: {activeRefundForTarget.date || "—"}
                  </span>
                </>
              ) : (
                <>
                  <strong>حالة الاسترجاع: غير مسترجع</strong>
                  <span>لا يوجد استرجاع مسجل لهذا الحجز حالياً.</span>
                </>
              )}
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ الاسترجاع</div>
                <input
                  type="number"
                  className="bk-input"
                  value={refundDraft.amount}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="مثال: 120"
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>طريقة الاسترجاع</div>
                <select
                  className="bk-select"
                  value={refundDraft.method}
                  onChange={(e) =>
                    setRefundDraft((p) => ({ ...p, method: e.target.value as PaymentMethod }))
                  }
                  disabled={refundSaving}
                >
                  <option value="transfer">تحويل</option>
                  <option value="cash">كاش</option>
                  <option value="card">شبكة</option>
                  <option value="none">لا يوجد دفع</option>
                  <option value="other">أخرى</option>
                </select>
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>تاريخ الاسترجاع</div>
                <input
                  type="date"
                  className="bk-input"
                  value={refundDraft.date}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, date: e.target.value }))}
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>سبب الاسترجاع</div>
                <input
                  type="text"
                  className="bk-input"
                  value={refundDraft.reason}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="مثال: إلغاء قبل الموعد"
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>تفاصيل إضافية</div>
                <textarea
                  className="bk-input"
                  rows={3}
                  value={refundDraft.details}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, details: e.target.value }))}
                  placeholder="أي تفاصيل داخلية للاسترجاع"
                  disabled={refundSaving}
                />
              </label>
            </div>

            {refundError ? (
              <div style={{ color: "#b42318", marginTop: 10, fontSize: 13 }}>{refundError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeRefundModal}
              disabled={refundSaving}
            >
              رجوع
            </button>
            {refundTarget && refundMapByBookingId[String(refundTarget.id || "").trim()] ? (
              <button
                type="button"
                className="exp-btn danger"
                onClick={handleCancelRefund}
                disabled={refundSaving}
                title="يمكن التراجع عن الاسترجاع من هنا"
              >
                {refundSaving ? "جاري الإلغاء..." : "إلغاء الاسترجاع"}
              </button>
            ) : null}
            <button
              type="button"
              className="exp-btn"
              onClick={handleSaveRefund}
              disabled={refundSaving}
            >
              {refundSaving ? "جاري الحفظ..." : "حفظ الاسترجاع"}
            </button>
          </div>
        </Modal>

        <Modal
          open={!!confirmTarget}
          onClose={closeConfirmModal}
          ariaLabel="تأكيد الحجز مع الدفع"
          panelClassName="bk-edit-modal"
          size="sm"
        >
          <div className="bk-cancel-head">تأكيد الحجز</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>رقم الحجز: {bookingRef(confirmTarget)}</span>
              <span>العميلة: {confirmTarget?.customerName || "—"}</span>
              <span>إجمالي الحجز: {readBookingTotalAmount(confirmTarget)} ر.س</span>
            </div>

            <div className="bk-edit-form">
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>نوع الدفع وقت التأكيد</div>
                <select
                  className="bk-select"
                  value={confirmDraft.paymentMode}
                  onChange={(e) =>
                    setConfirmDraft((p) => {
                      const nextMode = e.target.value as UiPaymentMode;
                      if (nextMode === "none") {
                        return {
                          ...p,
                          paymentMode: "none",
                          paymentType: "partial",
                          paymentMethod: "none",
                          paidAmount: "0",
                        };
                      }
                      return {
                        ...p,
                        paymentMode: nextMode,
                        paymentType: nextMode === "full" ? "full" : "partial",
                        paymentMethod: p.paymentMethod === "none" ? "transfer" : p.paymentMethod,
                      };
                    })
                  }
                  disabled={confirmSaving}
                >
                  <option value="full">دفع كامل</option>
                  <option value="partial">عربون</option>
                  <option value="none">بدون دفع</option>
                </select>
              </label>

              {confirmDraft.paymentMode !== "none" ? (
                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>طريقة الدفع</div>
                  <select
                    className="bk-select"
                    value={confirmDraft.paymentMethod}
                    onChange={(e) =>
                      setConfirmDraft((p) => {
                        const method = e.target.value as EditPaymentMethodOption;
                        return {
                          ...p,
                          paymentMethod: method,
                          paymentMode: method === "mixed" ? "full" : p.paymentMode,
                          paymentType: method === "mixed" ? "full" : p.paymentType,
                        };
                      })
                    }
                    disabled={confirmSaving}
                  >
                    <option value="cash">كاش</option>
                    <option value="card">شبكة</option>
                    <option value="transfer">تحويل</option>
                    <option value="mixed">دفع مختلط</option>
                    <option value="other">أخرى</option>
                  </select>
                </label>
              ) : null}

              {confirmDraft.paymentMethod === "mixed" ? (
                <div className="bk-mixed-payment-box">
                  <label>
                    <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ الكاش</div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="bk-input"
                      value={confirmDraft.mixedCashAmount}
                      onChange={(e) =>
                        setConfirmDraft((p) => ({ ...p, mixedCashAmount: e.target.value }))
                      }
                      disabled={confirmSaving}
                    />
                  </label>
                  <label>
                    <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ الشبكة</div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="bk-input"
                      value={confirmDraft.mixedCardAmount}
                      onChange={(e) =>
                        setConfirmDraft((p) => ({ ...p, mixedCardAmount: e.target.value }))
                      }
                      disabled={confirmSaving}
                    />
                  </label>
                  {(() => {
                    const total = readBookingTotalAmount(confirmTarget);
                    const paid = paymentBreakdownAmount({
                      paymentBreakdown: {
                        cash: Number(confirmDraft.mixedCashAmount || 0),
                        card: Number(confirmDraft.mixedCardAmount || 0),
                      },
                    });
                    return (
                      <div className={`bk-mixed-payment-balance ${round2(total - paid) === 0 ? "is-balanced" : "is-unbalanced"}`}>
                        المجموع: {paid} ر.س | المتبقي: {round2(Math.max(0, total - paid))} ر.س
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {confirmDraft.paymentMode === "partial" && confirmDraft.paymentMethod !== "mixed" ? (
                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ العربون</div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="bk-input"
                    value={confirmDraft.paidAmount}
                    onChange={(e) =>
                      setConfirmDraft((p) => ({ ...p, paidAmount: e.target.value }))
                    }
                    placeholder="مثال: 150"
                    disabled={confirmSaving}
                  />
                </label>
              ) : null}

              <div style={{ fontSize: 12, color: "#667085" }}>
                {(() => {
                  const total = readBookingTotalAmount(confirmTarget);
                  const paid =
                    confirmDraft.paymentMethod === "mixed"
                      ? paymentBreakdownAmount({
                          paymentBreakdown: {
                            cash: Number(confirmDraft.mixedCashAmount || 0),
                            card: Number(confirmDraft.mixedCardAmount || 0),
                          },
                        })
                    : confirmDraft.paymentType === "full"
                      ? total
                      : Math.max(0, Number(confirmDraft.paidAmount || 0));
                  const remaining = round2(Math.max(0, total - paid));
                  return paymentBreakdownText({
                    paymentType: confirmDraft.paymentType === "full" ? "full" : "partial",
                    paidAmount: round2(paid),
                    remainingAmount: remaining,
                    totalAmount: total,
                  });
                })()}
              </div>
            </div>

            {confirmError ? (
              <div style={{ color: "#b42318", marginTop: 10, fontSize: 13 }}>{confirmError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeConfirmModal}
              disabled={confirmSaving}
            >
              رجوع
            </button>
            <button
              type="button"
              className="exp-btn"
              onClick={handleConfirmPending}
              disabled={confirmSaving}
            >
              {confirmSaving ? "جاري التأكيد..." : "تأكيد"}
            </button>
          </div>
        </Modal>

        {editTarget ? (
          <EditBookingModal target={editTarget} onClose={closeEditModal} onSaved={applyLocalBookingPatch} />
        ) : null}

        {/*
        <Modal
          open={!!editTarget}
          onClose={closeEditModal}
          ariaLabel="تعديل الحجز"
          panelClassName="bk-edit-modal"
          size="sm"
        >
          <div className="bk-cancel-head">تعديل الحجز</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>رقم الحجز: {bookingRef(editTarget)}</span>
              <span>الخدمة: {editTarget ? serviceSummaryForTable(editTarget) : "—"}</span>
            </div>

            <div className="bk-edit-form">
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>اسم العميلة</div>
                <input
                  type="text"
                  className="bk-input"
                  value={editDraft.customerName}
                  onChange={(e) => setEditDraft((p) => ({ ...p, customerName: e.target.value }))}
                  placeholder="مثال: سارة أحمد"
                  disabled={editSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>رقم الجوال</div>
                <input
                  type="text"
                  className="bk-input"
                  value={editDraft.phone}
                  onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="05xxxxxxxx"
                  disabled={editSaving}
                />
              </label>

              <div className="bk-edit-grid bk-edit-grid--catalog">
                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>القسم</div>
                  <select
                    className="bk-select"
                    value={editDraft.sectionId}
                    onChange={(e) => {
                      const nextSectionId = e.target.value;
                      setEditDraft((prev) => ({
                        ...prev,
                        sectionId: nextSectionId,
                        categoryId: "",
                        serviceId: "",
                      }));
                    }}
                    disabled={editSaving || editCatalogLoading}
                  >
                    <option value="">اختاري القسم</option>
                    {editSections.map((section) => (
                      <option key={`edit_section_${section.id}`} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>التصنيف</div>
                  <select
                    className="bk-select"
                    value={editDraft.categoryId}
                    onChange={(e) => {
                      const nextCategoryId = e.target.value;
                      setEditDraft((prev) => ({
                        ...prev,
                        categoryId: nextCategoryId,
                        serviceId: "",
                      }));
                    }}
                    disabled={editSaving || editCatalogLoading || !editDraft.sectionId || !editCategories.length}
                  >
                    <option value="">
                      {editCategories.length ? "بدون تحديد" : "لا توجد تصنيفات"}
                    </option>
                    {editCategories.map((category) => (
                      <option key={`edit_category_${category.id}`} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>الخدمة</div>
                <select
                  className="bk-select"
                  value={editDraft.serviceId}
                  onChange={(e) => {
                    const nextServiceId = e.target.value;
                    const nextService =
                      filteredEditServices.find((service) => service.id === nextServiceId) || null;
                    setEditDraft((prev) => ({
                      ...prev,
                      serviceId: nextServiceId,
                      categoryId: nextService?.categoryId || prev.categoryId,
                      price: nextService ? String(nextService.price || 0) : prev.price,
                    }));
                  }}
                  disabled={editSaving || editCatalogLoading || !editDraft.sectionId}
                >
                  <option value="">
                    {filteredEditServices.length ? "اختاري الخدمة" : "لا توجد خدمات"}
                  </option>
                  {filteredEditServices.map((service) => (
                    <option key={`edit_service_${service.id}`} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </label>

              {editCatalogLoading ? (
                <div className="bk-edit-helper">جاري تحميل الأقسام والتصنيفات والخدمات...</div>
              ) : null}

              <div className="bk-edit-grid">
                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>التاريخ</div>
                  <input
                    type="date"
                    className="bk-input"
                    value={editDraft.date}
                    onChange={(e) => setEditDraft((p) => ({ ...p, date: e.target.value }))}
                    disabled={editSaving}
                  />
                </label>

                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>الوقت</div>
                  <input
                    type="time"
                    className="bk-input"
                    value={editDraft.time}
                    onChange={(e) => setEditDraft((p) => ({ ...p, time: e.target.value }))}
                    disabled={editSaving}
                  />
                </label>
              </div>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>السعر النهائي</div>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="bk-input"
                  value={editDraft.price}
                  onChange={(e) => setEditDraft((p) => ({ ...p, price: e.target.value }))}
                  placeholder="مثال: 120"
                  disabled={editSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>نوع الدفع</div>
                <select
                  className="bk-select"
                  value={editDraft.paymentMethod === "none" ? "none" : editDraft.paymentType}
                  onChange={(e) =>
                    setEditDraft((p) => {
                      const nextMode = e.target.value as UiPaymentMode;
                      if (nextMode === "none") {
                        return {
                          ...p,
                          paymentType: "partial",
                          paymentMethod: "none",
                          paidAmount: "0",
                        };
                      }
                      return {
                        ...p,
                        paymentType: nextMode === "full" ? "full" : "partial",
                        paymentMethod: p.paymentMethod === "none" ? "transfer" : p.paymentMethod,
                      };
                    })
                  }
                  disabled={editSaving}
                >
                  <option value="full">دفع كامل</option>
                  <option value="partial">عربون</option>
                  <option value="none">بدون دفع</option>
                </select>
              </label>

              {editDraft.paymentMethod !== "none" ? (
                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>طريقة الدفع</div>
                  <select
                    className="bk-select"
                    value={editDraft.paymentMethod}
                    onChange={(e) =>
                      setEditDraft((p) => ({
                        ...p,
                        paymentMethod: (e.target.value as PaymentMethod) || "transfer",
                      }))
                    }
                    disabled={editSaving}
                  >
                    <option value="cash">كاش</option>
                    <option value="card">شبكة</option>
                    <option value="transfer">تحويل</option>
                    <option value="other">أخرى</option>
                  </select>
                </label>
              ) : null}

              {editDraft.paymentMethod !== "none" && editDraft.paymentType === "partial" ? (
                <label>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ العربون</div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="bk-input"
                    value={editDraft.paidAmount}
                    onChange={(e) => setEditDraft((p) => ({ ...p, paidAmount: e.target.value }))}
                    placeholder="مثال: 100"
                    disabled={editSaving}
                  />
                </label>
              ) : null}

              <div style={{ fontSize: 12, color: "#667085" }}>
                المتبقي بعد التعديل:{" "}
                {(() => {
                  const total = Math.max(0, Number(editDraft.price || 0));
                  const paid =
                    editDraft.paymentMethod === "none"
                      ? 0
                      : editDraft.paymentType === "full"
                      ? total
                      : Math.max(0, Number(editDraft.paidAmount || 0));
                  return `${round2(Math.max(0, total - paid))} ر.س`;
                })()}
              </div>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>ملاحظة الحجز</div>
                <textarea
                  className="bk-input"
                  rows={3}
                  value={editDraft.note}
                  onChange={(e) => setEditDraft((p) => ({ ...p, note: e.target.value }))}
                  placeholder="ملاحظة داخلية على نفس الحجز"
                  disabled={editSaving}
                />
              </label>
            </div>

            {editError ? (
              <div style={{ color: "#b42318", marginTop: 10, fontSize: 13 }}>{editError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeEditModal}
              disabled={editSaving}
            >
              رجوع
            </button>
            <button
              type="button"
              className="exp-btn"
              onClick={handleSaveBookingEdit}
              disabled={editSaving}
            >
              {editSaving ? "جاري الحفظ..." : "حفظ التعديلات"}
            </button>
          </div>
        </Modal>
        */}

        <Modal
          open={!!cancelTarget}
          onClose={() => (cancelBusy ? null : closeCancelModal())}
          ariaLabel="تأكيد إلغاء الحجز"
          panelClassName="bk-cancel-modal"
          size="sm"
        >
          <div className="bk-cancel-head">تأكيد إلغاء الحجز</div>
          <div className="bk-cancel-body">
            <p>هل تريد بالفعل إلغاء هذا الحجز؟</p>
            <div className="bk-cancel-meta">
              <span>رقم الحجز: {bookingRef(cancelTarget)}</span>
              <span>العميلة: {cancelTarget?.customerName || "—"}</span>
              <span>التاريخ: {cancelTarget?.date || "—"} - {formatTime12(cancelTarget?.time || "")}</span>
            </div>
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeCancelModal}
              disabled={cancelBusy}
            >
              رجوع
            </button>
            <button
              type="button"
              className="exp-btn danger"
              onClick={confirmCancelBooking}
              disabled={cancelBusy}
            >
              {cancelBusy ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
