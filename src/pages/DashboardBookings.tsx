import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
import { DashboardDateInputV2, DashboardSelectBridgeV2 } from "../components/dashboard-v2/DashboardNativeControlBridgeV2";
// src/pages/DashboardBookings.tsx
import { memo, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faFilter,
  faXmark,
  faRotate,
  faPlus,
  faPrint,
  faCalendarDay,
  faClock,
  faMoneyBillWave,
  faChevronDown,
  faChevronUp,
  faChartLine,
  faCheckCircle,
  faTriangleExclamation,
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

// âœ… NEW: resolve service name (make it readable)
import { resolveServiceName } from "../services/serviceResolver";

// âœ… AppSettings through the unified Core settings adapter
import { AppSettingsService, type AppSettings } from "../services/AppSettingsService";
import { SALON_ID } from "../helpers/bookingSharedConstants";
import { bookingsText, translateBookingCatalogLabel, type DashboardLanguage } from "../helpers/dashboardBookingsLanguage";

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

// âœ… Styles

/* =========================
   Constants / Types
========================= */


/* BOOKING_DASHBOARD_DECISION_MODAL_V1 */

type BookingDecisionResult = "confirm" | "cancel" | "close";

type BookingDecisionOptions = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  tone?: "success" | "warning";
};

function BookingDecisionDialog({
  options,
  onDecision,
}: {
  options: BookingDecisionOptions;
  onDecision: (value: BookingDecisionResult) => void;
}) {
  const isSuccess = options.tone !== "warning";

  return (
    <Modal
      open
      onClose={() => onDecision("close")}
      ariaLabel={options.title}
      size="sm"
      panelClassName="bk-decision-modal"
      overlayClassName="bk-decision-overlay"
      closeOnOverlayClick={false}
    >
      <button
        type="button"
        className="bk-decision-modal__close"
        onClick={() => onDecision("close")}
        aria-label="ط¥ط؛ظ„ط§ظ‚"
        title="ط¥ط؛ظ„ط§ظ‚ ط¨ط¯ظˆظ† طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط¬ط²"
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>

      <div className="bk-decision-modal__body">
        <div
          className={[
            "bk-decision-modal__icon",
            isSuccess
              ? "is-success"
              : "is-warning",
          ].join(" ")}
        >
          <FontAwesomeIcon
            icon={
              isSuccess
                ? faCheckCircle
                : faTriangleExclamation
            }
          />
        </div>

        <div className="bk-decision-modal__copy">
          <span className="bk-decision-modal__kicker">
            {isSuccess
              ? "ط­ط§ظ„ط© ط§ظ„ط³ط¯ط§ط¯"
              : "طھط£ظƒظٹط¯ ط§ظ„ط¥ط¬ط±ط§ط،"}
          </span>

          <h3>{options.title}</h3>

          <p>{options.message}</p>
        </div>
      </div>

      <div className="bk-decision-modal__actions">
        <button
          type="button"
          className="bk-decision-modal__confirm"
          onClick={() => onDecision("confirm")}
        >
          <FontAwesomeIcon icon={faCheckCircle} />
          <span>{options.confirmText}</span>
        </button>

        <button
          type="button"
          className="bk-decision-modal__cancel"
          onClick={() => onDecision("cancel")}
        >
          {options.cancelText}
        </button>
      </div>
    </Modal>
  );
}

function askBookingDecision(
  options: BookingDecisionOptions
): Promise<BookingDecisionResult> {
  if (typeof document === "undefined") {
    return Promise.resolve("close");
  }

  return new Promise<BookingDecisionResult>((resolve) => {
    const host = document.createElement("div");

    host.className =
      "bk-decision-modal-host";

    document.body.appendChild(host);

    const root = createRoot(host);

    let settled = false;

    const finish = (value: BookingDecisionResult) => {
      if (settled) return;

      settled = true;
      resolve(value);

      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };

    root.render(
      <BookingDecisionDialog
        options={options}
        onDecision={finish}
      />
    );
  });
}


type StatusOption = BookingStatus | "all";
type ExcludedStatusOption = "" | BookingStatus;
type SettlementFilterOption = "all" | "paid" | "partial" | "unpaid";
type DatePresetOption = "all" | "today" | "yesterday" | "week" | "month" | "last_month" | "custom";
type PaymentMethodFilterOption = "all" | "cash" | "card" | "transfer" | "mixed" | "other" | "none";
type BookingSourceFilterOption = "all" | "client" | "dashboard" | "internal" | "unknown";
type SortOrderOption = "newest" | "oldest";
type OldPendingFilterOption = "off" | "before_today" | "older_7" | "older_30" | "custom";

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

function BookingMoney({ value, language = "ar" }: { value: unknown; language?: DashboardLanguage }) {
  return (
    <span className="bk-money" dir="ltr">
      <bdi className="bk-money-number">{formatBookingAmount(value)}</bdi>
      <span className="bk-money-currency">{language === "en" ? "SAR" : "ط±.ط³"}</span>
    </span>
  );
}

function compactPaymentStatusLabel(payment: ReturnType<typeof resolveBookingPaymentSummary>) {
  if (payment.totalAmount <= 0) return "ط¨ط¯ظˆظ† ط³ط¹ط±";
  if (payment.paidAmount <= 0 && payment.remainingAmount > 0) return "ط¨ط§ظ†طھط¸ط§ط± ط§ظ„ط³ط¯ط§ط¯";
  if (payment.remainingAmount <= 0) return "ظ…ط¯ظپظˆط¹ ط¨ط§ظ„ظƒط§ظ…ظ„";
  return "ط¯ظپط¹ ط¬ط²ط¦ظٹ";
}

/* =========================
   Helpers
========================= */

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
  if (s.includes("ظ…ط®طھظ„ط·") || s.includes("mixed")) return "mixed";
  if (s.includes("ط´ط¨ظƒط©") || s.includes("ظ…ط¯ظ‰") || s.includes("card")) return "card";
  if (s.includes("طھط­ظˆظٹظ„") || s.includes("transfer")) return "transfer";
  if (s.includes("ظƒط§ط´") || s.includes("cash") || s.includes("ظ†ظ‚ط¯")) return "cash";
  return "transfer";
}

function paymentMethodLabel(method: PaymentMethodFilterOption | PaymentMethod | "none") {
  if (method === "cash") return "ظƒط§ط´";
  if (method === "card") return "ط´ط¨ظƒط©";
  if (method === "transfer") return "طھط­ظˆظٹظ„";
  if (method === "mixed") return "ظ…ط®طھظ„ط·";
  if (method === "other") return "ط£ط®ط±ظ‰";
  if (method === "none") return "ط¨ط¯ظˆظ† ط¯ظپط¹";
  return "ط§ظ„ظƒظ„";
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
  return `ظ…ط®طھظ„ط·: ${breakdown.cash} ظƒط§ط´ + ${breakdown.card} ط´ط¨ظƒط© + ${breakdown.transfer} طھط­ظˆظٹظ„`;
}

function bookingClockText(value: string, language: DashboardLanguage): string {
  if (language === "ar") return formatTime12(value);
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

function bookingDateTimeLabelText(value: unknown, language: DashboardLanguage): string {
  const raw = String(value || "").trim();
  if (!raw || language === "ar") return raw;
  return raw
    .replace(/\sطµ(?=\s|$)/g, " AM")
    .replace(/\sظ…(?=\s|$)/g, " PM");
}

function bookingFormattedDateTimeText(value: unknown, language: DashboardLanguage): string {
  return bookingDateTimeLabelText(formatAnyDateTime(value), language);
}

function bookingActivityDisplayText(value: string, language: DashboardLanguage): string {
  const raw = String(value || "").trim();
  if (!raw || language === "ar") return raw;

  const direct = bookingsText(language, raw);
  if (direct !== raw) return direct;

  const saveErrorMatch = raw.match(/^طھط¹ط°ط± ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط² \((.+)\)\.$/);
  if (saveErrorMatch) {
    return `Could not save booking changes (${saveErrorMatch[1]}).`;
  }

  const rules: Array<{
    prefix: string;
    english: string;
    kind?: "service" | "section" | "category";
  }> = [
    { prefix: "ط§ظ„طھط§ط±ظٹط® ط¥ظ„ظ‰ ", english: "Date changed to" },
    { prefix: "ط§ظ„ظˆظ‚طھ ط¥ظ„ظ‰ ", english: "Time changed to" },
    { prefix: "ط§ظ„ظ‚ط³ظ… ط¥ظ„ظ‰ ", english: "Section changed to", kind: "section" },
    { prefix: "ط§ظ„طھطµظ†ظٹظپ ط¥ظ„ظ‰ ", english: "Category changed to", kind: "category" },
    { prefix: "ط§ظ„ظ…ظˆط¸ظپط© ط¥ظ„ظ‰ ", english: "Staff member changed to" },
    { prefix: "ط§ظ„ط®ط¯ظ…ط© ط¥ظ„ظ‰ ", english: "Service changed to", kind: "service" },
    { prefix: "ط§ظ„ط¹ظ…ظٹظ„ط© ط¥ظ„ظ‰ ", english: "Client changed to" },
    { prefix: "ط±ظ‚ظ… ط§ظ„ط¬ظˆط§ظ„ ط¥ظ„ظ‰ ", english: "Phone number changed to" },
    { prefix: "ط§ظ„ط­ط§ظ„ط© ط¥ظ„ظ‰ ", english: "Status changed to" },
    { prefix: "ظ†ظˆط¹ ط§ظ„ط¯ظپط¹ ط¥ظ„ظ‰ ", english: "Payment type changed to" },
    { prefix: "ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹ ط¥ظ„ظ‰ ", english: "Payment method changed to" },
    { prefix: "ط§ظ„ظ…ط¯ظپظˆط¹ ط¥ظ„ظ‰ ", english: "Paid amount changed to" },
    { prefix: "ط§ظ„ظ…طھط¨ظ‚ظٹ ط¥ظ„ظ‰ ", english: "Remaining amount changed to" },
    { prefix: "ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط¥ظ„ظ‰ ", english: "Total changed to" },
  ];

  for (const rule of rules) {
    if (!raw.startsWith(rule.prefix)) continue;
    const suffixRaw = raw.slice(rule.prefix.length).trim();
    let suffix = rule.kind
      ? translateBookingCatalogLabel(language, suffixRaw, rule.kind)
      : bookingsText(language, suffixRaw);

    suffix = bookingDateTimeLabelText(
      String(suffix || suffixRaw)
        .replace(/\s*ط±\.ط³\b/g, " SAR")
        .trim(),
      language
    );

    return `${rule.english} ${suffix}`.trim();
  }

  return raw.replace(/\s*ط±\.ط³\b/g, " SAR");
}

function bookingPaymentMethodText(b: Booking, language: DashboardLanguage): string {
  if (language === "ar") return paymentMethodDisplayText(b);
  if (bookingPaymentMethodFilterValue(b) !== "mixed") return bookingsText(language, paymentMethodDisplayText(b));
  const amounts = readPaymentBreakdown(b);
  return `${bookingsText(language, "ظ…ط®طھظ„ط·")}: ${amounts.cash} ${bookingsText(language, "ظƒط§ط´")} + ${amounts.card} ${bookingsText(language, "ط´ط¨ظƒط©")} + ${amounts.transfer} ${bookingsText(language, "طھط­ظˆظٹظ„")}`;
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
  if (datePreset === "all" || (!dateFrom && !dateTo)) return "ظƒظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ";
  const labels: Record<DatePresetOption, string> = {
    all: "ظƒظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ",
    today: "ط§ظ„ظٹظˆظ…",
    yesterday: "ط£ظ…ط³",
    week: "ظ‡ط°ط§ ط§ظ„ط£ط³ط¨ظˆط¹",
    month: "ظ‡ط°ط§ ط§ظ„ط´ظ‡ط±",
    last_month: "ط§ظ„ط´ظ‡ط± ط§ظ„ظ…ط§ط¶ظٹ",
    custom: "ظ†ط·ط§ظ‚ ظ…ط®طµطµ",
  };
  return `${labels[datePreset] || "ظ†ط·ط§ظ‚ ظ…ط®طµطµ"} (${dateFrom || "ط§ظ„ط¨ط¯ط§ظٹط©"} - ${dateTo || "ط§ظ„ظ†ظ‡ط§ظٹط©"})`;
}

function normalizeEditBookingTimeInput(raw: string): string {
  const arabicIndicDigits = "ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©";
  const easternArabicDigits = "غ°غ±غ²غ³غ´غµغ¶غ·غ¸غ¹";
  const normalized = String(raw || "")
    .replace(/[ظ -ظ©]/g, (digit) => String(arabicIndicDigits.indexOf(digit)))
    .replace(/[غ°-غ¹]/g, (digit) => String(easternArabicDigits.indexOf(digit)))
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  const match = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp]\.?[Mm]\.?|[طµظ…]))?$/u);
  if (!match) return "";

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = String(match[3] || "").toLowerCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return "";
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return "";
    const isAm = meridiem === "طµ" || meridiem === "am" || meridiem === "a.m.";
    const isPm = meridiem === "ظ…" || meridiem === "pm" || meridiem === "p.m.";
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
  const arabicIndicDigits = "ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©";
  const easternArabicDigits = "غ°غ±غ²غ³غ´غµغ¶غ·غ¸غ¹";
  return digitsOnly(
    String(raw || "")
      .replace(/[ظ -ظ©]/g, (digit) => String(arabicIndicDigits.indexOf(digit)))
      .replace(/[غ°-غ¹]/g, (digit) => String(easternArabicDigits.indexOf(digit)))
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
  status: BookingStatus;
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
    status: b.status || "pending",
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
  adminNote?: string;
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


// BOOKING_COMPLETED_PAYMENT_RULE_V2
function completedBookingPaymentPatch(
  booking: Booking
): Partial<Booking> {
  const totalAmount = round2(
    Math.max(0, readBookingTotalAmount(booking))
  );

  return {
    paymentMethod: "other",
    paymentBreakdown: {},
    paymentType: "full",
    paidAmount: totalAmount,
    remainingAmount: 0,
  };
}

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
  if (s.includes("ظƒط§ط´") || s.includes("ظ†ظ‚ط¯")) return "cash";
  if (s.includes("ط´ط¨ظƒط©") || s.includes("ظ…ط¯ظ‰") || s.includes("ط¨ط·ط§ظ‚")) return "card";
  if (s.includes("طھط­ظˆظٹظ„")) return "transfer";
  return "transfer";
}

type SensitiveBookingAction =
  | { kind: "status"; bookingId: string; nextStatus: BookingStatus; bookingRef: string }
  | { kind: "edit"; booking: Booking }
  | { kind: "refund"; booking: Booking }
  | { kind: "delete"; booking: Booking };

function sensitiveActionDescription(action: SensitiveBookingAction | null, language: DashboardLanguage = "ar") {
  if (!action) return "";
  if (action.kind === "status") {
    return language === "en" ? `Change booking ${action.bookingRef} to ${bookingsText(language, statusLabel[action.nextStatus])}` : `طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط¬ط² ${action.bookingRef} ط¥ظ„ظ‰ ${statusLabel[action.nextStatus]}`;
  }
  if (language === "en") {
    if (action.kind === "edit") return `Edit booking ${bookingRef(action.booking)}`;
    if (action.kind === "refund") return `Manage refund for booking ${bookingRef(action.booking)}`;
    return `Remove booking ${bookingRef(action.booking)} from the bookings page`;
  }
  if (action.kind === "edit") return `طھط¹ط¯ظٹظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط¬ط² ${bookingRef(action.booking)}`;
  if (action.kind === "refund") return `ط¥ط¯ط§ط±ط© ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ط­ط¬ط² ${bookingRef(action.booking)}`;
  return `ط¥ط²ط§ظ„ط© ط§ظ„ط­ط¬ط² ${bookingRef(action.booking)} ظ…ظ† طµظپط­ط© ط§ظ„ط­ط¬ظˆط²ط§طھ`;
}

type ActionPinModalProps = {
  language: DashboardLanguage;
  action: SensitiveBookingAction | null;
  onClose: () => void;
  onConfirm: (action: SensitiveBookingAction) => Promise<void>;
  onVerifyPassword: (password: string) => Promise<void>;
};

const ActionPinModal = memo(function ActionPinModal({
  language,
  action,
  onClose,
  onConfirm,
  onVerifyPassword,
}: ActionPinModalProps) {
  const t = (arabic: string) => bookingsText(language, arabic);
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
      setError("ط£ط¯ط®ظ„ظٹ ظƒظ„ظ…ط© ظ…ط±ظˆط± ط§ظ„ط­ط³ط§ط¨ ط§ظ„ط­ط§ظ„ظٹ.");
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
        setError("ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط؛ظٹط± طµط­ظٹط­ط©.");
      } else if (code.includes("too-many-requests")) {
        setError("طھظ… ط¥ظٹظ‚ط§ظپ ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ظ…ط¤ظ‚طھظ‹ط§ ط¨ط³ط¨ط¨ ظƒط«ط±ط© ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ. ط§ظ†طھط¸ط±ظٹ ظ‚ظ„ظٹظ„ظ‹ط§ ط«ظ… ط£ط¹ظٹط¯ظٹ ط§ظ„ظ…ط­ط§ظˆظ„ط©.");
      } else if (code.includes("requires-recent-login")) {
        setError("ط§ظ†طھظ‡طھ طµظ„ط§ط­ظٹط© ط§ظ„طھط­ظ‚ظ‚. ط³ط¬ظ‘ظ„ظٹ ط§ظ„ط®ط±ظˆط¬ ط«ظ… ط§ط¯ط®ظ„ظٹ ظ…ط±ط© ط£ط®ط±ظ‰.");
      } else {
        setError(
          caught instanceof Error && String(caught.message || "").trim()
            ? caught.message
            : "طھط¹ط°ط± ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±."
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
      ariaLabel={t("ط§ظ„طھط­ظ‚ظ‚ ط¨ظƒظ„ظ…ط© ظ…ط±ظˆط± ط§ظ„ط­ط³ط§ط¨")}
      overlayClassName="bookings-v2-modal-overlay bk-action-pin-overlay"
      panelClassName={`bookings-v2-modal-panel bk-cancel-modal bk-action-pin-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
      size="sm"
    >
      <div className="bk-cancel-head">{t("طھط£ظƒظٹط¯ ظƒظ„ظ…ط© ظ…ط±ظˆط± ط§ظ„ط­ط³ط§ط¨")}</div>
      <div className="bk-cancel-body">
        <div className="bk-action-pin-summary">
          <div className="bk-action-pin-summary-label">{t("ط§ظ„ط¥ط¬ط±ط§ط، ط§ظ„ظ…ط·ظ„ظˆط¨")}</div>
          <div className="bk-action-pin-summary-value">
            {sensitiveActionDescription(action, language) || t("ط¥ط¬ط±ط§ط، ط­ط³ط§ط³")}
          </div>
          {action?.kind === "delete" ? (
            <div className="bk-action-pin-warning">
              {t("ط³ظٹط®طھظپظٹ ط§ظ„ط­ط¬ط² ظ…ظ† طµظپط­ط© ط§ظ„ط­ط¬ظˆط²ط§طھطŒ ظ…ط¹ ط§ظ„ط§ط­طھظپط§ط¸ ط¨ط§ظ„ظپط§طھظˆط±ط© ظˆط§ظ„ظ…ط¯ظپظˆط¹ط§طھ ظˆط§ظ„ط³ط¬ظ„ ط§ظ„ظ…ط§ظ„ظٹ ظ„ظ„ظ…ط±ط§ط¬ط¹ط©.")}
            </div>
          ) : null}
        </div>
        <div className="bk-action-pin-form">
          <label className="bk-action-pin-label" htmlFor={passwordInputId}>
            {t("ظƒظ„ظ…ط© ظ…ط±ظˆط± ط­ط³ط§ط¨ظƒ ط§ظ„ط­ط§ظ„ظٹ")}
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
            placeholder={t("ط£ط¯ط®ظ„ظٹ ظƒظ„ظ…ط© ظ…ط±ظˆط± ط§ظ„ط­ط³ط§ط¨")}
            autoComplete="current-password"
            name="booking_action_current_password"
            maxLength={128}
            aria-describedby={passwordHintId}
            disabled={busy}
            autoFocus
          />
          <div className="bk-action-pin-hint" id={passwordHintId}>
            {t("ط³ظٹطھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ظ…ط© ظ…ط±ظˆط± ط§ظ„ط­ط³ط§ط¨ ط§ظ„ظ…ط³ط¬ظ„ ط­ط§ظ„ظٹظ‹ط§ ظ‚ط¨ظ„ طھظ†ظپظٹط° ط§ظ„ط¥ط¬ط±ط§ط،.")}
          </div>
        </div>
        {error ? <div className="bk-action-pin-error">{t(error)}</div> : null}
      </div>
      <div className="bk-cancel-foot">
        <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={handleClose} disabled={busy}>
          {t("ط¥ظ„ط؛ط§ط،")}
        </button>
        <button
          type="button"
          className={`dsv2-btn ${action?.kind === "delete" ? "dsv2-btn--danger" : "dsv2-btn--primary"}`}
          onClick={() => void handleConfirm()}
          disabled={busy}
        >
          {busy ? t("ط¬ط§ط±ظٹ ط§ظ„طھط­ظ‚ظ‚...") : t("ظ…طھط§ط¨ط¹ط©")}
        </button>
      </div>
    </Modal>
  );
});

type EditBookingCustomerSectionProps = {
  customerName: string;
  phone: string;
  disabled: boolean;
  language: DashboardLanguage;
  onCustomerNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
};

const EditBookingCustomerSection = memo(function EditBookingCustomerSection({
  customerName,
  phone,
  disabled,
  language,
  onCustomerNameChange,
  onPhoneChange,
}: EditBookingCustomerSectionProps) {
  const t = (arabic: string) => bookingsText(language, arabic);
  return (
    <>
      <label>
        <div className="bk-field-label">{t("ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ط©")}</div>
        <input
          type="text"
          className="bk-input"
          value={customerName}
          onChange={(e) => onCustomerNameChange(e.target.value)}
          placeholder={t("ظ…ط«ط§ظ„: ط³ط§ط±ط© ط£ط­ظ…ط¯")}
          disabled={disabled}
        />
      </label>

      <label>
        <div className="bk-field-label">{t("ط±ظ‚ظ… ط§ظ„ط¬ظˆط§ظ„")}</div>
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


/* BOOKING_CUSTOM_SELECT_CONTROL_V1 */

type BookingSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};


type BookingFilterDateFieldProps = {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  language?: DashboardLanguage;
};

const BOOKING_FILTER_MONTHS_AR = [
  "ظٹظ†ط§ظٹط±",
  "ظپط¨ط±ط§ظٹط±",
  "ظ…ط§ط±ط³",
  "ط£ط¨ط±ظٹظ„",
  "ظ…ط§ظٹظˆ",
  "ظٹظˆظ†ظٹظˆ",
  "ظٹظˆظ„ظٹظˆ",
  "ط£ط؛ط³ط·ط³",
  "ط³ط¨طھظ…ط¨ط±",
  "ط£ظƒطھظˆط¨ط±",
  "ظ†ظˆظپظ…ط¨ط±",
  "ط¯ظٹط³ظ…ط¨ط±",
] as const;

const BOOKING_FILTER_WEEKDAYS_AR = [
  "ط­",
  "ظ†",
  "ط«",
  "ط±",
  "ط®",
  "ط¬",
  "ط³",
] as const;

function bookingFilterParseDate(value: string) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  const date = new Date(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
  };
}

function bookingFilterDateISO(
  year: number,
  month: number,
  day: number
) {
  const pad = (value: number) =>
    String(value).padStart(2, "0");

  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

const BookingFilterDateField = memo(
  function BookingFilterDateField({
    label,
    value,
    disabled = false,
    onChange,
    language = "ar",
  }: BookingFilterDateFieldProps) {
    const t = (arabic: string) => bookingsText(language, arabic);
    const [open, setOpen] = useState(false);

    const initial =
      bookingFilterParseDate(value);

    const now = new Date();

    const [cursorYear, setCursorYear] =
      useState(
        initial?.year ?? now.getFullYear()
      );

    const [cursorMonth, setCursorMonth] =
      useState(
        initial?.month ?? now.getMonth()
      );

    const [panelStyle, setPanelStyle] =
      useState({
        top: 0,
        left: 0,
        width: 320,
      });

    const rootRef =
      useRef<HTMLDivElement>(null);

    const triggerRef =
      useRef<HTMLButtonElement>(null);

    const panelRef =
      useRef<HTMLDivElement>(null);

    const selected =
      bookingFilterParseDate(value);

    const displayValue = selected
      ? `${String(selected.day).padStart(2, "0")} / ${String(
          selected.month + 1
        ).padStart(2, "0")} / ${selected.year}`
      : t("ط§ط®طھط§ط±ظٹ ط§ظ„طھط§ط±ظٹط®");

    const updatePosition = useCallback(() => {
      if (typeof window === "undefined") {
        return;
      }

      const trigger = triggerRef.current;

      if (!trigger) return;

      const rect =
        trigger.getBoundingClientRect();

      const viewportPadding = 12;

      const width = Math.min(
        Math.max(rect.width, 320),
        window.innerWidth -
          viewportPadding * 2
      );

      const estimatedHeight = 390;

      const spaceBelow =
        window.innerHeight -
        rect.bottom -
        viewportPadding;

      const openAbove =
        spaceBelow < estimatedHeight &&
        rect.top > spaceBelow;

      const top = openAbove
        ? Math.max(
            viewportPadding,
            rect.top -
              estimatedHeight -
              8
          )
        : Math.min(
            rect.bottom + 8,
            window.innerHeight -
              viewportPadding -
              Math.min(
                estimatedHeight,
                window.innerHeight -
                  viewportPadding * 2
              )
          );

      const preferredLeft =
        rect.right - width;

      const left = Math.min(
        Math.max(
          viewportPadding,
          preferredLeft
        ),
        Math.max(
          viewportPadding,
          window.innerWidth -
            width -
            viewportPadding
        )
      );

      setPanelStyle({
        top,
        left,
        width,
      });
    }, []);

    const openCalendar = useCallback(() => {
      if (disabled) return;

      const current =
        bookingFilterParseDate(value);

      const today = new Date();

      setCursorYear(
        current?.year ??
          today.getFullYear()
      );

      setCursorMonth(
        current?.month ??
          today.getMonth()
      );

      updatePosition();
      setOpen(true);
    }, [
      disabled,
      updatePosition,
      value,
    ]);

    const moveMonth = useCallback(
      (amount: number) => {
        const date = new Date(
          cursorYear,
          cursorMonth + amount,
          1
        );

        setCursorYear(
          date.getFullYear()
        );

        setCursorMonth(
          date.getMonth()
        );
      },
      [cursorMonth, cursorYear]
    );

    useEffect(() => {
      if (!open) return;

      updatePosition();

      const handlePointerDown = (
        event: PointerEvent
      ) => {
        const target = event.target;

        if (!(target instanceof Node)) {
          return;
        }

        if (
          rootRef.current?.contains(
            target
          ) ||
          panelRef.current?.contains(
            target
          )
        ) {
          return;
        }

        setOpen(false);
      };

      const handleKeyDown = (
        event: KeyboardEvent
      ) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      };

      const handleViewport = () => {
        updatePosition();
      };

      document.addEventListener(
        "pointerdown",
        handlePointerDown
      );

      document.addEventListener(
        "keydown",
        handleKeyDown
      );

      window.addEventListener(
        "resize",
        handleViewport
      );

      window.addEventListener(
        "scroll",
        handleViewport,
        true
      );

      return () => {
        document.removeEventListener(
          "pointerdown",
          handlePointerDown
        );

        document.removeEventListener(
          "keydown",
          handleKeyDown
        );

        window.removeEventListener(
          "resize",
          handleViewport
        );

        window.removeEventListener(
          "scroll",
          handleViewport,
          true
        );
      };
    }, [
      open,
      updatePosition,
    ]);

    const daysInMonth =
      new Date(
        cursorYear,
        cursorMonth + 1,
        0
      ).getDate();

    const firstWeekDay =
      new Date(
        cursorYear,
        cursorMonth,
        1
      ).getDay();

    const today = new Date();

    const selectDay = (
      day: number
    ) => {
      onChange(
        bookingFilterDateISO(
          cursorYear,
          cursorMonth,
          day
        )
      );

      setOpen(false);
    };

    return (
      <div
        ref={rootRef}
        className={[
          "bk-filter-date-field",
          open ? "is-open" : "",
          disabled ? "is-disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="bk-field-label">
          {label}
        </div>

        <div className="bk-filter-date-control">
          <button
            ref={triggerRef}
            type="button"
            className={[
              "bk-filter-date-trigger",
              value ? "has-value" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              if (open) {
                setOpen(false);
              } else {
                openCalendar();
              }
            }}
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span>{displayValue}</span>

            <FontAwesomeIcon
              icon={faCalendarDay}
              aria-hidden="true"
            />
          </button>

          {value ? (
            <button
              type="button"
              className="bk-filter-date-clear"
              onClick={(event) => {
                event.stopPropagation();

                onChange("");
                setOpen(false);
              }}
              aria-label={`${t("ظ…ط³ط­")} ${label}`}
              title={t("ظ…ط³ط­ ط§ظ„طھط§ط±ظٹط®")}
            >
              <FontAwesomeIcon
                icon={faXmark}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>

        {open &&
        typeof document !== "undefined"
          ? createPortal(
              <div
                ref={panelRef}
                className="bk-filter-calendar-portal"
                style={panelStyle}
                role="dialog"
                aria-label={`${t("ط§ط®طھظٹط§ط±")} ${label}`}
                dir={language === "en" ? "ltr" : "rtl"}
              >
                <div className="bk-filter-calendar__head">
                  <button
                    type="button"
                    onClick={() =>
                      moveMonth(-1)
                    }
                    aria-label={t("ط§ظ„ط´ظ‡ط± ط§ظ„ط³ط§ط¨ظ‚")}
                  >
                    â€¹
                  </button>

                  <strong>
                    {
                      language === "en"
                        ? new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(cursorYear, cursorMonth, 1))
                        : BOOKING_FILTER_MONTHS_AR[cursorMonth]
                    }{" "}
                    {cursorYear}
                  </strong>

                  <button
                    type="button"
                    onClick={() =>
                      moveMonth(1)
                    }
                    aria-label={t("ط§ظ„ط´ظ‡ط± ط§ظ„طھط§ظ„ظٹ")}
                  >
                    â€؛
                  </button>
                </div>

                <div className="bk-filter-calendar__weekdays">
                  {(language === "en" ? ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] : BOOKING_FILTER_WEEKDAYS_AR).map(
                    (day) => (
                      <span key={day}>
                        {day}
                      </span>
                    )
                  )}
                </div>

                <div className="bk-filter-calendar__days">
                  {Array.from({
                    length: firstWeekDay,
                  }).map((_, index) => (
                    <span
                      key={`empty_${index}`}
                      className="is-empty"
                      aria-hidden="true"
                    />
                  ))}

                  {Array.from({
                    length: daysInMonth,
                  }).map((_, index) => {
                    const day = index + 1;

                    const isSelected =
                      selected?.year ===
                        cursorYear &&
                      selected?.month ===
                        cursorMonth &&
                      selected?.day === day;

                    const isToday =
                      today.getFullYear() ===
                        cursorYear &&
                      today.getMonth() ===
                        cursorMonth &&
                      today.getDate() === day;

                    return (
                      <button
                        key={day}
                        type="button"
                        className={[
                          isSelected
                            ? "is-selected"
                            : "",
                          isToday
                            ? "is-today"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() =>
                          selectDay(day)
                        }
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>

                <div className="bk-filter-calendar__footer">
                  <button
                    type="button"
                    className="is-today-action"
                    onClick={() => {
                      const date =
                        new Date();

                      onChange(
                        bookingFilterDateISO(
                          date.getFullYear(),
                          date.getMonth(),
                          date.getDate()
                        )
                      );

                      setOpen(false);
                    }}
                  >
                    {t("ط§ظ„ظٹظˆظ…")}
                  </button>

                  {value ? (
                    <button
                      type="button"
                      className="is-clear-action"
                      onClick={() => {
                        onChange("");
                        setOpen(false);
                      }}
                    >
                      {t("ظ…ط³ط­")}
                    </button>
                  ) : null}
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    );
  }
);

type BookingSelectFieldProps = {
  label: string;
  value: string;
  options: BookingSelectOption[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  language?: DashboardLanguage;
};


const BookingSelectField = memo(function BookingSelectField({
  label,
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
  language = "ar",
}: BookingSelectFieldProps) {
  const [open, setOpen] = useState(false);

  const [panelStyle, setPanelStyle] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 250,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.top = `${panelStyle.top}px`;
    panel.style.left = `${panelStyle.left}px`;
    panel.style.width = `${panelStyle.width}px`;
    panel.style.maxHeight = `${panelStyle.maxHeight}px`;
  }, [open, panelStyle.left, panelStyle.maxHeight, panelStyle.top, panelStyle.width]);

  const listboxIdRef = useRef(
    "booking_custom_select_" +
      Math.random().toString(36).slice(2, 10)
  );

  const selectedOption =
    options.find((option) => option.value === value) ||
    null;

  const updatePanelPosition = useCallback(() => {
    if (typeof window === "undefined") return;

    const trigger = triggerRef.current;

    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;

    const estimatedHeight = Math.min(
      270,
      Math.max(62, options.length * 48 + 14)
    );

    const spaceBelow =
      window.innerHeight -
      rect.bottom -
      viewportPadding;

    const spaceAbove =
      rect.top -
      viewportPadding;

    const openAbove =
      spaceBelow < Math.min(180, estimatedHeight) &&
      spaceAbove > spaceBelow;

    const availableSpace = openAbove
      ? spaceAbove
      : spaceBelow;

    const maxHeight = Math.max(
      120,
      Math.min(270, availableSpace - 8)
    );

    const actualHeight = Math.min(
      estimatedHeight,
      maxHeight
    );

    const top = openAbove
      ? Math.max(
          viewportPadding,
          rect.top - actualHeight - 8
        )
      : Math.min(
          window.innerHeight -
            viewportPadding -
            actualHeight,
          rect.bottom + 8
        );

    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(
        viewportPadding,
        window.innerWidth -
          rect.width -
          viewportPadding
      )
    );

    setPanelStyle({
      top,
      left,
      width: rect.width,
      maxHeight,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;

    updatePanelPosition();

    const handleOutsidePointer = (
      event: PointerEvent
    ) => {
      const target = event.target;

      if (!(target instanceof Node)) return;

      const clickedInsideTrigger =
        rootRef.current?.contains(target);

      const clickedInsidePanel =
        panelRef.current?.contains(target);

      if (
        !clickedInsideTrigger &&
        !clickedInsidePanel
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (
      event: KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const handleViewportChange = () => {
      updatePanelPosition();
    };

    document.addEventListener(
      "pointerdown",
      handleOutsidePointer
    );

    document.addEventListener(
      "keydown",
      handleEscape
    );

    window.addEventListener(
      "resize",
      handleViewportChange
    );

    window.addEventListener(
      "scroll",
      handleViewportChange,
      true
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleOutsidePointer
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );

      window.removeEventListener(
        "resize",
        handleViewportChange
      );

      window.removeEventListener(
        "scroll",
        handleViewportChange,
        true
      );
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={listboxIdRef.current}
            className="bk-custom-select__portal-panel"
            dir={language === "en" ? "ltr" : "rtl"}
            role="listbox"
            aria-label={label}
          >
            {options.map((option) => {
              const active =
                option.value === value;

              return (
                <button
                  key={
                    label +
                    "_" +
                    (option.value || "empty")
                  }
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={[
                    "bk-custom-select__option",
                    active ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>

                  {active ? (
                    <FontAwesomeIcon
                      icon={faCheckCircle}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="bk-custom-select-field">
      <div className="bk-field-label">
        {label}
      </div>

      <div
        ref={rootRef}
        className={[
          "bk-custom-select",
          open ? "is-open" : "",
          disabled ? "is-disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          ref={triggerRef}
          type="button"
          className="bk-custom-select__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxIdRef.current}
          disabled={disabled}
          onClick={() => {
            if (!open) {
              updatePanelPosition();
            }

            setOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              updatePanelPosition();
              setOpen(true);
            }
          }}
        >
          <span
            className={
              selectedOption && value
                ? ""
                : "is-placeholder"
            }
          >
            {selectedOption?.label || placeholder}
          </span>

          <FontAwesomeIcon
            icon={faChevronDown}
            aria-hidden="true"
          />
        </button>
      </div>

      {panel}
    </div>
  );
});

type EditBookingCatalogSectionProps = {
  language: DashboardLanguage;
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
  language,
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
  const t = (arabic: string) => bookingsText(language, arabic);
  const sectionOptions: BookingSelectOption[] = [
    {
      value: "",
      label: catalogLoading
        ? t("ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ط£ظ‚ط³ط§ظ…...")
        : t("ط§ط®طھط§ط±ظٹ ط§ظ„ظ‚ط³ظ…"),
    },
    ...sections.map((section) => ({
      value: section.id,
      label: section.name,
    })),
  ];

  const categoryOptions: BookingSelectOption[] = [
    {
      value: "",
      label: categories.length
        ? t("ط¨ط¯ظˆظ† طھط­ط¯ظٹط¯")
        : t("ظ„ط§ طھظˆط¬ط¯ طھطµظ†ظٹظپط§طھ"),
      disabled: !categories.length,
    },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];

  const serviceOptions: BookingSelectOption[] = [
    {
      value: "",
      label: services.length
        ? t("ط§ط®طھط§ط±ظٹ ط§ظ„ط®ط¯ظ…ط©")
        : t("ظ„ط§ طھظˆط¬ط¯ ط®ط¯ظ…ط§طھ"),
      disabled: !services.length,
    },
    ...services.map((service) => ({
      value: service.id,
      label: service.name,
    })),
  ];

  return (
    <>
      <div className="bk-edit-grid bk-edit-grid--catalog">
        <BookingSelectField
          label={t("ط§ظ„ظ‚ط³ظ…")}
          value={sectionId}
          options={sectionOptions}
          placeholder={t("ط§ط®طھط§ط±ظٹ ط§ظ„ظ‚ط³ظ…")}
          disabled={disabled || catalogLoading}
          onChange={onSectionChange}
          language={language}
        />

        <BookingSelectField
          label={t("ط§ظ„طھطµظ†ظٹظپ")}
          value={categoryId}
          options={categoryOptions}
          placeholder={
            categories.length
              ? t("ط¨ط¯ظˆظ† طھط­ط¯ظٹط¯")
              : t("ظ„ط§ طھظˆط¬ط¯ طھطµظ†ظٹظپط§طھ")
          }
          disabled={
            disabled ||
            catalogLoading ||
            !sectionId ||
            !categories.length
          }
          onChange={onCategoryChange}
          language={language}
        />
      </div>

      <BookingSelectField
        label={t("ط§ظ„ط®ط¯ظ…ط©")}
        value={serviceId}
        options={serviceOptions}
        placeholder={
          services.length
            ? t("ط§ط®طھط§ط±ظٹ ط§ظ„ط®ط¯ظ…ط©")
            : t("ظ„ط§ طھظˆط¬ط¯ ط®ط¯ظ…ط§طھ")
        }
        disabled={
          disabled ||
          catalogLoading ||
          !sectionId ||
          !services.length
        }
        onChange={onServiceChange}
        language={language}
      />

      {catalogLoading ? (
        <div className="bk-edit-helper">
          {t("ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ط£ظ‚ط³ط§ظ… ظˆط§ظ„طھطµظ†ظٹظپط§طھ ظˆط§ظ„ط®ط¯ظ…ط§طھ...")}
        </div>
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
  slotStepMin: number;
  disabled: boolean;
  language: DashboardLanguage;
  onEmployeeChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
};

type EditBookingTimeDraft = {
  hour: number;
  minute: number;
  period: "am" | "pm";
};





const EditBookingScheduleSection = memo(function EditBookingScheduleSection({
  employeeId,
  staffOptions,
  staffLoading,
  date,
  time,
  slotStepMin,
  disabled,
  language,
  onEmployeeChange,
  onDateChange,
  onTimeChange,
}: EditBookingScheduleSectionProps) {
  const t = (arabic: string) => bookingsText(language, arabic);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const datePanelRef = useRef<HTMLDivElement>(null);
  const timeTriggerRef = useRef<HTMLButtonElement>(null);
  const timePanelRef = useRef<HTMLDivElement>(null);

  const parseTimeDraft = useCallback((value: string): EditBookingTimeDraft => {
    const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return { hour: 12, minute: 0, period: "pm" };

    const hour24 = Number(match[1]);
    const minute = Number(match[2]);

    return {
      hour: hour24 % 12 || 12,
      minute,
      period: hour24 >= 12 ? "pm" : "am",
    };
  }, []);

  const [timeDraft, setTimeDraft] = useState<EditBookingTimeDraft>(() =>
    parseTimeDraft(time)
  );

  const parseIsoDate = useCallback((value: string) => {
    const match = String(value || "").match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day)
    ) {
      return null;
    }

    return { year, month, day };
  }, []);

  const initialDate = parseIsoDate(date);

  const [calendarCursor, setCalendarCursor] = useState(() => {
    if (initialDate) {
      return new Date(
        initialDate.year,
        initialDate.month - 1,
        1
      );
    }

    const now = new Date();

    return new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );
  });

  const [calendarPosition, setCalendarPosition] = useState({
    top: 0,
    left: 0,
    width: 330,
  });
  const [timePosition, setTimePosition] = useState({
    top: 0,
    left: 0,
    width: 330,
  });

  useEffect(() => {
    if (!calendarOpen) return;
    const panel = datePanelRef.current;
    if (!panel) return;
    panel.style.top = `${calendarPosition.top}px`;
    panel.style.left = `${calendarPosition.left}px`;
    panel.style.width = `${calendarPosition.width}px`;
  }, [calendarOpen, calendarPosition.left, calendarPosition.top, calendarPosition.width]);

  const employeeOptions: BookingSelectOption[] = [
    {
      value: "",
      label: staffLoading
        ? t("ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ...")
        : staffOptions.length
          ? t("ط§ط®طھط§ط±ظٹ ط§ظ„ظ…ظˆط¸ظپط©")
          : t("ظ„ط§ طھظˆط¬ط¯ ظ…ظˆط¸ظپط§طھ ظ…طھط§ط­ط©"),
      disabled: !staffOptions.length,
    },
    ...staffOptions.map((staff) => ({
      value: staff.id,
      label:
        staff.name +
        (staff.active === false
          ? " â€” " + t("ط؛ظٹط± ظ†ط´ط·ط©")
          : ""),
    })),
  ];

  useEffect(() => {
    if (!calendarOpen) return;

    const selected = parseIsoDate(date);

    if (selected) {
      setCalendarCursor(
        new Date(
          selected.year,
          selected.month - 1,
          1
        )
      );
    }
  }, [calendarOpen, date, parseIsoDate]);

  const updateCalendarPosition = useCallback(() => {
    if (typeof window === "undefined") return;

    const trigger = dateTriggerRef.current;

    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();

    const width = Math.min(
      340,
      Math.max(300, rect.width)
    );

    const viewportPadding = 12;
    const estimatedHeight = 390;

    const spaceBelow =
      window.innerHeight -
      rect.bottom -
      viewportPadding;

    const spaceAbove =
      rect.top -
      viewportPadding;

    const openAbove =
      spaceBelow < estimatedHeight &&
      spaceAbove > spaceBelow;

    let top = openAbove
      ? rect.top - estimatedHeight - 8
      : rect.bottom + 8;

    top = Math.max(
      viewportPadding,
      Math.min(
        top,
        window.innerHeight -
          estimatedHeight -
          viewportPadding
      )
    );

    let left =
      rect.right - width;

    left = Math.max(
      viewportPadding,
      Math.min(
        left,
        window.innerWidth -
          width -
          viewportPadding
      )
    );

    setCalendarPosition({
      top,
      left,
      width,
    });
  }, []);

  const updateTimePosition = useCallback(() => {
    if (typeof window === "undefined") return;

    const trigger = timeTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(360, Math.max(300, rect.width));
    const viewportPadding = 12;
    const estimatedHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

    let top = openAbove
      ? rect.top - estimatedHeight - 8
      : rect.bottom + 8;

    top = Math.max(
      viewportPadding,
      Math.min(top, window.innerHeight - estimatedHeight - viewportPadding)
    );

    let left = rect.right - width;
    left = Math.max(
      viewportPadding,
      Math.min(left, window.innerWidth - width - viewportPadding)
    );

    setTimePosition({ top, left, width });
  }, []);

  useEffect(() => {
    if (!calendarOpen) return;

    updateCalendarPosition();

    const handlePointer = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) return;

      const insideTrigger =
        dateTriggerRef.current?.contains(target);

      const insidePanel =
        datePanelRef.current?.contains(target);

      if (!insideTrigger && !insidePanel) {
        setCalendarOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCalendarOpen(false);
      }
    };

    const handleViewport = () => {
      updateCalendarPosition();
    };

    document.addEventListener(
      "pointerdown",
      handlePointer
    );

    document.addEventListener(
      "keydown",
      handleKey
    );

    window.addEventListener(
      "resize",
      handleViewport
    );

    window.addEventListener(
      "scroll",
      handleViewport,
      true
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointer
      );

      document.removeEventListener(
        "keydown",
        handleKey
      );

      window.removeEventListener(
        "resize",
        handleViewport
      );

      window.removeEventListener(
        "scroll",
        handleViewport,
        true
      );
    };
  }, [calendarOpen, updateCalendarPosition]);

  useEffect(() => {
    if (!timeOpen) return;

    setTimeDraft(parseTimeDraft(time));
    updateTimePosition();

    const handlePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const insideTrigger = timeTriggerRef.current?.contains(target);
      const insidePanel = timePanelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) setTimeOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimeOpen(false);
    };

    const handleViewport = () => updateTimePosition();

    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleViewport);
    window.addEventListener("scroll", handleViewport, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleViewport);
      window.removeEventListener("scroll", handleViewport, true);
    };
  }, [parseTimeDraft, time, timeOpen, updateTimePosition]);

  const toArabicDigits = useCallback(
    (value: string | number) =>
      String(value).replace(
        /\d/g,
        (digit) =>
          "ظ ظ،ظ¢ظ£ظ¤ظ¥ظ¦ظ§ظ¨ظ©"[Number(digit)]
      ),
    []
  );

  const dateLabel = useMemo(() => {
    const selected = parseIsoDate(date);

    if (!selected) {
      return t("ط§ط®طھط§ط±ظٹ ط§ظ„طھط§ط±ظٹط®");
    }

    if (language === "en") {
      return (
        String(selected.month).padStart(2, "0") +
        "/" +
        String(selected.day).padStart(2, "0") +
        "/" +
        String(selected.year)
      );
    }

    return (
      toArabicDigits(selected.day) +
      "/" +
      toArabicDigits(selected.month) +
      "/" +
      toArabicDigits(selected.year)
    );
  }, [date, language, parseIsoDate, toArabicDigits]);

  const timeLabel = useMemo(
    () => (time ? bookingClockText(time, language) : t("ط§ط®طھط§ط±ظٹ ط§ظ„ظˆظ‚طھ")),
    [language, time]
  );

  const minuteStep = Math.max(5, Math.min(30, Number(slotStepMin || 10)));
  const minuteOptions = useMemo(() => {
    const values: number[] = [];
    for (let minute = 0; minute < 60; minute += minuteStep) values.push(minute);
    return values;
  }, [minuteStep]);

  const commitTimeDraft = useCallback(() => {
    const hour24 =
      timeDraft.period === "pm"
        ? (timeDraft.hour % 12) + 12
        : timeDraft.hour % 12;

    onTimeChange(
      String(hour24).padStart(2, "0") +
        ":" +
        String(timeDraft.minute).padStart(2, "0")
    );
    setTimeOpen(false);
  }, [onTimeChange, timeDraft]);

  const calendarYear =
    calendarCursor.getFullYear();

  const calendarMonth =
    calendarCursor.getMonth();

  const daysInMonth = useMemo(
    () =>
      new Date(
        calendarYear,
        calendarMonth + 1,
        0
      ).getDate(),
    [calendarMonth, calendarYear]
  );

  const firstWeekday = useMemo(
    () =>
      new Date(
        calendarYear,
        calendarMonth,
        1
      ).getDay(),
    [calendarMonth, calendarYear]
  );

  const calendarCells = useMemo(() => {
    const cells: Array<number | null> = [];

    for (
      let index = 0;
      index < firstWeekday;
      index += 1
    ) {
      cells.push(null);
    }

    for (
      let day = 1;
      day <= daysInMonth;
      day += 1
    ) {
      cells.push(day);
    }

    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    return cells;
  }, [daysInMonth, firstWeekday]);

  const monthTitle = useMemo(() => {
    return new Intl.DateTimeFormat(
      language === "en" ? "en-US" : "ar-SA-u-ca-gregory-nu-latn",
      {
        month: "long",
        year: "numeric",
      }
    ).format(
      new Date(
        calendarYear,
        calendarMonth,
        1
      )
    );
  }, [calendarMonth, calendarYear, language]);

  const selectedDate = parseIsoDate(date);

  const today = new Date();

  const formatIso = useCallback(
    (
      year: number,
      monthIndex: number,
      day: number
    ) => {
      const month = String(
        monthIndex + 1
      ).padStart(2, "0");

      const dayText = String(day).padStart(
        2,
        "0"
      );

      return (
        String(year) +
        "-" +
        month +
        "-" +
        dayText
      );
    },
    []
  );

  const chooseDate = useCallback(
    (day: number) => {
      onDateChange(
        formatIso(
          calendarYear,
          calendarMonth,
          day
        )
      );

      setCalendarOpen(false);
    },
    [
      calendarMonth,
      calendarYear,
      formatIso,
      onDateChange,
    ]
  );

  const calendarPanel =
    calendarOpen &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={datePanelRef}
            className="bk-calendar-popover"
            dir={language === "en" ? "ltr" : "rtl"}
          >
            <div className="bk-calendar-head">
              <button
                type="button"
                className="bk-calendar-nav"
                onClick={() =>
                  setCalendarCursor(
                    new Date(
                      calendarYear,
                      calendarMonth - 1,
                      1
                    )
                  )
                }
                aria-label={t("ط§ظ„ط´ظ‡ط± ط§ظ„ط³ط§ط¨ظ‚")}
              >
                â€¹
              </button>

              <strong>
                {monthTitle}
              </strong>

              <button
                type="button"
                className="bk-calendar-nav"
                onClick={() =>
                  setCalendarCursor(
                    new Date(
                      calendarYear,
                      calendarMonth + 1,
                      1
                    )
                  )
                }
                aria-label={t("ط§ظ„ط´ظ‡ط± ط§ظ„طھط§ظ„ظٹ")}
              >
                â€؛
              </button>
            </div>

            <div className="bk-calendar-weekdays">
              {(language === "en"
                ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                : ["ط£ط­ط¯", "ط§ط«ظ†", "ط«ظ„ط§", "ط£ط±ط¨", "ط®ظ…ظٹ", "ط¬ظ…ط¹", "ط³ط¨طھ"]
              ).map((label) => (
                <span key={label}>
                  {label}
                </span>
              ))}
            </div>

            <div className="bk-calendar-grid">
              {calendarCells.map(
                (day, index) => {
                  if (!day) {
                    return (
                      <span
                        key={
                          "empty_" + index
                        }
                        className="bk-calendar-empty"
                      />
                    );
                  }

                  const isSelected =
                    !!selectedDate &&
                    selectedDate.year ===
                      calendarYear &&
                    selectedDate.month ===
                      calendarMonth + 1 &&
                    selectedDate.day === day;

                  const isToday =
                    today.getFullYear() ===
                      calendarYear &&
                    today.getMonth() ===
                      calendarMonth &&
                    today.getDate() === day;

                  return (
                    <button
                      key={day}
                      type="button"
                      className={[
                        "bk-calendar-day",
                        isSelected
                          ? "is-selected"
                          : "",
                        isToday
                          ? "is-today"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() =>
                        chooseDate(day)
                      }
                    >
                      {language === "en" ? day : toArabicDigits(day)}
                    </button>
                  );
                }
              )}
            </div>

            <div className="bk-calendar-foot">
              <button
                type="button"
                onClick={() => {
                  onDateChange("");
                  setCalendarOpen(false);
                }}
              >
                {t("ظ…ط³ط­")}
              </button>

              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  const now = new Date();

                  onDateChange(
                    formatIso(
                      now.getFullYear(),
                      now.getMonth(),
                      now.getDate()
                    )
                  );

                  setCalendarOpen(false);
                }}
              >
                {t("ط§ظ„ظٹظˆظ…")}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  const timePanel =
    timeOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={timePanelRef}
            className="bk-time-popover"
            dir={language === "en" ? "ltr" : "rtl"}
            style={{
              top: timePosition.top,
              left: timePosition.left,
              width: timePosition.width,
            }}
          >
            <div className="bk-time-popover__head">
              <strong>{t("ط§ط®طھظٹط§ط± ط§ظ„ظˆظ‚طھ")}</strong>
              <span>{bookingClockText(
                String(
                  timeDraft.period === "pm"
                    ? (timeDraft.hour % 12) + 12
                    : timeDraft.hour % 12
                ).padStart(2, "0") +
                  ":" +
                  String(timeDraft.minute).padStart(2, "0"),
                language
              )}</span>
            </div>

            <div className="bk-time-popover__section">
              <span className="bk-time-popover__label">{t("ط§ظ„ظپطھط±ط©")}</span>
              <div className="bk-time-period">
                {([
                  ["am", language === "en" ? "AM" : "طµ"],
                  ["pm", language === "en" ? "PM" : "ظ…"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={timeDraft.period === value ? "is-selected" : ""}
                    onClick={() =>
                      setTimeDraft((current) => ({
                        ...current,
                        period: value,
                      }))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bk-time-popover__section">
              <span className="bk-time-popover__label">{t("ط§ظ„ط³ط§ط¹ط©")}</span>
              <div className="bk-time-hours">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    className={timeDraft.hour === hour ? "is-selected" : ""}
                    onClick={() =>
                      setTimeDraft((current) => ({
                        ...current,
                        hour,
                      }))
                    }
                  >
                    {hour}
                  </button>
                ))}
              </div>
            </div>

            <div className="bk-time-popover__section">
              <span className="bk-time-popover__label">{t("ط§ظ„ط¯ظ‚ط§ط¦ظ‚")}</span>
              <div className="bk-time-minutes">
                {minuteOptions.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    className={timeDraft.minute === minute ? "is-selected" : ""}
                    onClick={() =>
                      setTimeDraft((current) => ({
                        ...current,
                        minute,
                      }))
                    }
                  >
                    {String(minute).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            <div className="bk-time-popover__foot">
              <button
                type="button"
                onClick={() => {
                  onTimeChange("");
                  setTimeOpen(false);
                }}
              >
                {t("ظ…ط³ط­")}
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={commitTimeDraft}
              >
                {t("طھظ…")}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="bk-edit-grid bk-edit-grid--schedule">
      <BookingSelectField
        label={t("ط§ظ„ظ…ظˆط¸ظپط©")}
        value={employeeId}
        options={employeeOptions}
        placeholder={
          staffLoading
            ? t("ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ...")
            : t("ط§ط®طھط§ط±ظٹ ط§ظ„ظ…ظˆط¸ظپط©")
        }
        disabled={
          disabled ||
          staffLoading ||
          !staffOptions.length
        }
        onChange={onEmployeeChange}
        language={language}
      />

      <div className="bk-edit-picker-field">
        <div className="bk-field-label">
          {t("ط§ظ„طھط§ط±ظٹط®")}
        </div>

        <button
          ref={dateTriggerRef}
          type="button"
          className={[
            "bk-edit-picker-control",
            calendarOpen
              ? "is-open"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={disabled}
          onClick={() => {
            setTimeOpen(false);
            updateCalendarPosition();

            setCalendarOpen(
              (current) => !current
            );
          }}
        >
          <span
            className={
              date ? "" : "is-placeholder"
            }
            dir="ltr"
          >
            {dateLabel}
          </span>

          <FontAwesomeIcon
            icon={faCalendarDay}
            aria-hidden="true"
          />
        </button>

        {calendarPanel}
      </div>

      <div className="bk-edit-picker-field">
        <div className="bk-field-label">
          {t("ط§ظ„ظˆظ‚طھ")}
        </div>

        <button
          ref={timeTriggerRef}
          type="button"
          className={[
            "bk-edit-picker-control",
            timeOpen ? "is-open" : "",
          ].filter(Boolean).join(" ")}
          disabled={disabled}
          onClick={() => {
            setCalendarOpen(false);
            setTimeDraft(parseTimeDraft(time));
            updateTimePosition();
            setTimeOpen((current) => !current);
          }}
        >
          <span className={time ? "" : "is-placeholder"}>
            {timeLabel}
          </span>
          <FontAwesomeIcon icon={faClock} aria-hidden="true" />
        </button>

        {timePanel}
      </div>
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
  language: DashboardLanguage;
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
  language,
  onPaymentModeChange,
  onPaymentMethodChange,
  onPaidAmountChange,
  onMixedCashAmountChange,
  onMixedCardAmountChange,
}: EditBookingPaymentSectionProps) {
  const t = (arabic: string) => bookingsText(language, arabic);
  const total = Math.max(0, Number(price || 0));
  const mixedCash = Math.max(
    0,
    Number(mixedCashAmount || 0)
  );
  const mixedCard = Math.max(
    0,
    Number(mixedCardAmount || 0)
  );
  const mixedPaid = round2(mixedCash + mixedCard);
  const mixedRemaining = round2(total - mixedPaid);

  const remainingAfterEditText = useMemo(() => {
    const paid =
      paymentMethod === "none"
        ? 0
        : paymentMethod === "mixed"
          ? Math.max(
              0,
              Number(mixedCashAmount || 0)
            ) +
            Math.max(
              0,
              Number(mixedCardAmount || 0)
            )
          : paymentType === "full"
            ? total
            : Math.max(
                0,
                Number(paidAmount || 0)
              );

    return (
      String(
        round2(Math.max(0, total - paid))
      ) + " ط±.ط³"
    );
  }, [
    mixedCardAmount,
    mixedCashAmount,
    paidAmount,
    paymentMethod,
    paymentType,
    total,
  ]);

  const paymentModeValue =
    paymentMethod === "none"
      ? "none"
      : paymentType;

  const paymentModeOptions: BookingSelectOption[] = [
    { value: "full", label: t("ط¯ظپط¹ ظƒط§ظ…ظ„") },
    { value: "partial", label: t("ط¹ط±ط¨ظˆظ†") },
    { value: "none", label: t("ط¨ط¯ظˆظ† ط¯ظپط¹") },
  ];

  const paymentMethodOptions: BookingSelectOption[] = [
    { value: "cash", label: t("ظƒط§ط´") },
    { value: "card", label: t("ط´ط¨ظƒط©") },
    { value: "transfer", label: t("طھط­ظˆظٹظ„") },
    { value: "mixed", label: t("ط¯ظپط¹ ظ…ط®طھظ„ط·") },
    { value: "other", label: t("ط£ط®ط±ظ‰") },
  ];

  return (
    <>
      <label>
        <div className="bk-field-label">
          {t("ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط² (ظ„ظ„ظ‚ط±ط§ط،ط© ظپظ‚ط·)")}
        </div>

        <DashboardNumberInputV2
          min={0}
          step="0.01"
          className="bk-input"
          value={price}
          onChange={() => {}}
          disabled
        />
        <small className="bk-helper-text">
          {t("طھط¹ط¯ظٹظ„ ط§ظ„ط³ط¹ط± ظ„ط§ ظٹطھظ… ظ…ظ† ط§ظ„ط¯ظپط¹ط› ظٹط³طھط®ط¯ظ… ظ…ط³ط§ط± طھط¹ط¯ظٹظ„ ط³ط¹ط± ط§ظ„ط­ط¬ط² ط§ظ„ظ…ط®طµطµ.")}
        </small>
      </label>

      <BookingSelectField
        label={t("ظ†ظˆط¹ ط§ظ„ط¯ظپط¹")}
        value={paymentModeValue}
        options={paymentModeOptions}
        placeholder={t("ط§ط®طھط§ط±ظٹ ظ†ظˆط¹ ط§ظ„ط¯ظپط¹")}
        disabled={disabled}
        onChange={(value) =>
          onPaymentModeChange(value as UiPaymentMode)
        }
        language={language}
      />

      {paymentMethod !== "none" ? (
        <BookingSelectField
          label={t("ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}
          value={paymentMethod}
          options={paymentMethodOptions}
          placeholder={t("ط§ط®طھط§ط±ظٹ ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}
          disabled={disabled}
          onChange={(value) =>
            onPaymentMethodChange(
              (value as EditPaymentMethodOption) ||
                "transfer"
            )
          }
          language={language}
        />
      ) : null}

      {paymentMethod === "mixed" ? (
        <div className="bk-mixed-payment-box">
          <label>
            <div className="bk-field-label">
              {t("ظ…ط¨ظ„ط؛ ط§ظ„ظƒط§ط´")}
            </div>

            <DashboardNumberInputV2
              min={0}
              step="0.01"
              className="bk-input"
              value={mixedCashAmount}
              onChange={(event) =>
                onMixedCashAmountChange(
                  event.target.value
                )
              }
              placeholder={t("ظ…ط«ط§ظ„: 100")}
              disabled={disabled}
            />
          </label>

          <label>
            <div className="bk-field-label">
              {t("ظ…ط¨ظ„ط؛ ط§ظ„ط´ط¨ظƒط©")}
            </div>

            <DashboardNumberInputV2
              min={0}
              step="0.01"
              className="bk-input"
              value={mixedCardAmount}
              onChange={(event) =>
                onMixedCardAmountChange(
                  event.target.value
                )
              }
              placeholder={t("ظ…ط«ط§ظ„: 200")}
              disabled={disabled}
            />
          </label>

          <div
            className={[
              "bk-mixed-payment-balance",
              mixedRemaining === 0
                ? "is-balanced"
                : "is-unbalanced",
            ].join(" ")}
          >
            {t("ط§ظ„ظ…ط¬ظ…ظˆط¹")}: {mixedPaid} {language === "en" ? "SAR" : "ط±.ط³"} | {t("ط§ظ„ظ…طھط¨ظ‚ظٹ")}:{" "}
            {round2(
              Math.max(0, mixedRemaining)
            )}{" "}
            {language === "en" ? "SAR" : "ط±.ط³"}
          </div>
        </div>
      ) : null}

      {paymentMethod !== "none" &&
      paymentMethod !== "mixed" &&
      paymentType === "partial" ? (
        <label>
          <div className="bk-field-label">
            {t("ظ…ط¨ظ„ط؛ ط§ظ„ط¹ط±ط¨ظˆظ†")}
          </div>

          <DashboardNumberInputV2
            min={0}
            step="0.01"
            className="bk-input"
            value={paidAmount}
            onChange={(event) =>
              onPaidAmountChange(event.target.value)
            }
            placeholder={t("ظ…ط«ط§ظ„: 100")}
            disabled={disabled}
          />
        </label>
      ) : null}

      <div className="bk-helper-text">
        {t("ط§ظ„ظ…طھط¨ظ‚ظٹ ط¨ط¹ط¯ ط§ظ„طھط¹ط¯ظٹظ„")}:{" "}
        {language === "en" ? remainingAfterEditText.replace("ط±.ط³", "SAR") : remainingAfterEditText}
      </div>
    </>
  );
});

type EditBookingNoteSectionProps = {
  note: string;
  disabled: boolean;
  language: DashboardLanguage;
  onNoteChange: (value: string) => void;
};

const EditBookingNoteSection = memo(function EditBookingNoteSection({
  note,
  disabled,
  language,
  onNoteChange,
}: EditBookingNoteSectionProps) {
  const t = (arabic: string) => bookingsText(language, arabic);
  return (
    <label>
      <div className="bk-field-label">{t("ظ…ظ„ط§ط­ط¸ط© ط§ظ„ط­ط¬ط²")}</div>
      <textarea
        className="bk-input"
        rows={3}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder={t("ظ…ظ„ط§ط­ط¸ط© ط¯ط§ط®ظ„ظٹط© ط¹ظ„ظ‰ ظ†ظپط³ ط§ظ„ط­ط¬ط²")}
        disabled={disabled}
      />
    </label>
  );
});

type EditBookingModalProps = {
  target: Booking | null;
  language: DashboardLanguage;
  onClose: () => void;
  onSaved: (bookingId: string, patch: Partial<Booking>) => void;
};

const EditBookingModal = memo(function EditBookingModal({ target, language, onClose, onSaved }: EditBookingModalProps) {
  const t = (arabic: string) => bookingsText(language, arabic);
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
          status: "pending",
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
  }, [language, open, target?.id]);

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
            name:
              language === "en"
                ? String(raw?.nameEn || raw?.name_en || "").trim() ||
                  translateBookingCatalogLabel(
                    language,
                    readCatalogLabel(raw, String(raw?.id || "").trim()),
                    "section"
                  )
                : readCatalogLabel(raw, String(raw?.id || "").trim()),
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
  }, [language, open, target?.id]);

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
            name:
              language === "en"
                ? String(raw?.nameEn || raw?.name_en || "").trim() ||
                  translateBookingCatalogLabel(
                    language,
                    readCatalogLabel(raw, String(raw?.id || "").trim()),
                    "category"
                  )
                : readCatalogLabel(raw, String(raw?.id || "").trim()),
            sectionId: String(raw?.sectionId || sectionId).trim(),
            active: raw?.active !== false,
          }))
          .filter((row) => row.id && row.name && row.active);

        const nextServices = (serviceRows || [])
          .map((raw: any) => {
            const duration = Number(raw?.durationMin ?? raw?.duration ?? raw?.["ط§ظ„ظ…ط¯ط©"] ?? 60) || 60;
            const price = Number(raw?.price ?? raw?.["ط§ظ„ط³ط¹ط±"] ?? 0) || 0;
            return {
              id: String(raw?.id || "").trim(),
              name:
                language === "en"
                  ? String(raw?.nameEn || raw?.name_en || "").trim() ||
                    translateBookingCatalogLabel(
                      language,
                      readCatalogLabel(raw, String(raw?.id || "").trim()),
                      "service"
                    )
                  : readCatalogLabel(raw, String(raw?.id || "").trim()),
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
  }, [draft.sectionId, language, open, target?.id]);

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
      setDraft((prev) => ({
        ...prev,
        serviceId: nextServiceId,
        categoryId: nextService?.categoryId || prev.categoryId,
        // Service edits must not silently change financial totals.
        // Booking price changes use the dedicated audited pricing path.
        price: prev.price,
      }));
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
      setError("ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ط© ظ…ط·ظ„ظˆط¨.");
      return;
    }
    if (!sectionId) {
      setError("ط§ظ„ظ‚ط³ظ… ظ…ط·ظ„ظˆط¨.");
      return;
    }
    if (!employeeId) {
      setError("ط§ظ„ظ…ظˆط¸ظپط© ظ…ط·ظ„ظˆط¨ط©.");
      return;
    }
    if (!employeeName) {
      setError("طھط¹ط°ط± طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظ…ط®طھط§ط±ط©.");
      return;
    }
    if (!serviceId || !selectedService) {
      setError("ط§ظ„ط®ط¯ظ…ط© ظ…ط·ظ„ظˆط¨ط©.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("ط§ظ„طھط§ط±ظٹط® ط؛ظٹط± طµط­ظٹط­.");
      return;
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError("ط§ظ„ظˆظ‚طھ ط؛ظٹط± طµط­ظٹط­ (HH:MM).");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError("ط§ظ„ط³ط¹ط± ط؛ظٹط± طµط­ظٹط­.");
      return;
    }
    if (isMixedPayment) {
      if (
        !Number.isFinite(mixedCashAmount) ||
        !Number.isFinite(mixedCardAmount) ||
        mixedCashAmount < 0 ||
        mixedCardAmount < 0
      ) {
        setError("ظ…ط¨ط§ظ„ط؛ ط§ظ„ط¯ظپط¹ ط§ظ„ظ…ط®طھظ„ط· ظٹط¬ط¨ ط£ظ† طھظƒظˆظ† 0 ط£ظˆ ط£ظƒط«ط±.");
        return;
      }
      if (round2(mixedCashAmount + mixedCardAmount) !== round2(price)) {
        setError("ظ…ط¬ظ…ظˆط¹ ط§ظ„ظƒط§ط´ ظˆط§ظ„ط´ط¨ظƒط© ظٹط¬ط¨ ط£ظ† ظٹط³ط§ظˆظٹ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط².");
        return;
      }
    }
    if (!isMixedPayment && paymentType === "partial") {
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        setError("ط£ط¯ط®ظ„ظٹ ظ…ط¨ظ„ط؛ ط¹ط±ط¨ظˆظ† طµط­ظٹط­ (0 ط£ظˆ ط£ظƒط«ط±).");
        return;
      }
      if (paidAmount > price) {
        setError("ظ…ط¨ظ„ط؛ ط§ظ„ط¹ط±ط¨ظˆظ† ظ„ط§ ظٹظ…ظƒظ† ط£ظ† ظٹطھط¬ط§ظˆط² ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط².");
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

    // BOOKING_EDIT_STATUS_RULE_V2
    const statusAfterEdit: BookingStatus = draft.status;

    const completionPaymentPatch: Partial<Booking> | null =
      statusAfterEdit === "completed"
        ? completedBookingPaymentPatch({
            ...target,
            finalPrice: price,
            total: price,
          } as Booking)
        : null;

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
      // BOOKING_EDIT_COMPLETION_APPLY_V2
      if (completionPaymentPatch) {
        Object.assign(
          patch,
          completionPaymentPatch
        );
      }

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
        // BOOKING_EDIT_COMPLETION_LOCAL_V2
        ...(completionPaymentPatch || {}),
        status: resolvedStatus,
      });

      shouldClose = true;
    } catch (e: any) {
      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        setError("ط§ظ„ظ…ظˆط¹ط¯ ظٹطھط¹ط§ط±ط¶ ظ…ط¹ ط­ط¬ط² ط¢ط®ط± ظ„ظ†ظپط³ ط§ظ„ظ…ظˆط¸ظپط©. ط§ط®طھط§ط±ظٹ ظˆظ‚طھظ‹ط§ ط£ظˆ ظ…ظˆط¸ظپط© ط£ط®ط±ظ‰.");
      } else if (e?.code === "BOOKING_DAY_CLOSED") {
        setError("ط§ظ„ظٹظˆظ… ط§ظ„ظ…ط®طھط§ط± ط؛ظٹط± ظ…طھط§ط­ ظ„ظ„ط­ط¬ط². ط§ط®طھط§ط±ظٹ طھط§ط±ظٹط®ظ‹ط§ ط¢ط®ط±.");
      } else if (e?.code === "BOOKING_TIME_OUT_OF_HOURS") {
        setError("ط§ظ„ظˆظ‚طھ ط§ظ„ظ…ط®طھط§ط± ط®ط§ط±ط¬ ط³ط§ط¹ط§طھ ط§ظ„ط¯ظˆط§ظ… ط£ظˆ ظ„ط§ ظٹظƒظپظٹ ظ„ظ…ط¯ط© ط§ظ„ط®ط¯ظ…ط© ظˆط§ظ„ط¨ط§ظپط±.");
      } else if (e?.code === "EMPLOYEE_UNAVAILABLE") {
        setError("ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظ…ط¹ظٹظ†ط© ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط­ط¬ط² ظ„ظ… طھط¹ط¯ ظ†ط´ط·ط© طھط´ط؛ظٹظ„ظٹظ‹ط§ ظ„ظ‡ط°ط§ ط§ظ„ظ…ظˆط¹ط¯. ط§ط®طھط§ط±ظٹ ظ…ظˆط¸ظپط© ط£ط®ط±ظ‰ ط£ظˆ ط£ط¹ظٹط¯ظٹ ط¬ط¯ظˆظ„ط© ط§ظ„ط­ط¬ط².");
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
            ? `طھط¹ط°ط± ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط² (${code}).`
            : "طھط¹ط°ط± ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط². ط±ط§ط¬ط¹ظٹ Console ظ„ظ…ط¹ط±ظپط© ط§ظ„ط®ط·ط£ ط§ظ„طھظپطµظٹظ„ظٹ."
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
      ariaLabel={t("طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط²")}
      overlayClassName="bookings-v2-modal-overlay"
      panelClassName={`bookings-v2-modal-panel bk-edit-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
      size="lg"
    >
      <div className="bk-cancel-head">{t("طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط²")}</div>
      <div className="bk-cancel-body">
        <div className="bk-cancel-meta">
          <span>{t("ط±ظ‚ظ… ط§ظ„ط­ط¬ط²")}: {bookingRef(target)}</span>
          <span>
            {t("ط§ظ„ط®ط¯ظ…ط©")}:{" "}
            {target
              ? translateBookingCatalogLabel(
                  language,
                  String(
                    target.serviceName ||
                      resolvePrimaryBookingServiceSelection(target).serviceName ||
                      serviceSummaryForTable(target)
                  ),
                  "service"
                )
              : "â€”"}
          </span>
        </div>

        <div className="bk-edit-form">
          <EditBookingCustomerSection
            customerName={draft.customerName}
            phone={draft.phone}
            disabled={saving}
            language={language}
            onCustomerNameChange={onCustomerNameChange}
            onPhoneChange={onPhoneChange}
          />

          <EditBookingCatalogSection
            language={language}
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
            language={language}
            employeeId={draft.employeeId}
            staffOptions={staffOptions}
            staffLoading={staffLoading}
            date={draft.date}
            time={draft.time}
            slotStepMin={Math.max(5, Number(target?.slotStepMinAtBooking || 10))}
            disabled={saving}
            onEmployeeChange={onEmployeeChange}
            onDateChange={onDateChange}
            onTimeChange={onTimeChange}
          />


          {/* BOOKING_EDIT_STATUS_FIELD_V2 */}
          <BookingSelectField
            label={t("ط­ط§ظ„ط© ط§ظ„ط­ط¬ط²")}
            value={draft.status}
            options={[
              { value: "pending", label: t("ظپظٹ ط§ظ„ط§ظ†طھط¸ط§ط±") },
              { value: "confirmed", label: t("ظ…ط¤ظƒط¯") },
              { value: "completed", label: t("ظ…ظƒطھظ…ظ„") },
              { value: "cancelled", label: t("ظ…ظ„ط؛ظٹ") },
            ]}
            placeholder={t("ط§ط®طھط§ط±ظٹ ط­ط§ظ„ط© ط§ظ„ط­ط¬ط²")}
            disabled={saving}
            language={language}
            onChange={(value) => {
              const nextStatus = value as BookingStatus;

              setDraft((prev) => {
                if (nextStatus !== "completed") {
                  return {
                    ...prev,
                    status: nextStatus,
                  };
                }

                const total = round2(
                  Math.max(0, Number(prev.price || 0))
                );

                return {
                  ...prev,
                  status: "completed",
                  paymentMethod: "other",
                  paymentType: "full",
                  paidAmount: String(total),
                };
              });
            }}
          />

          <EditBookingPaymentSection
            language={language}
            price={draft.price}
            paymentMethod={draft.paymentMethod}
            paymentType={draft.paymentType}
            paidAmount={draft.paidAmount}
            mixedCashAmount={draft.mixedCashAmount}
            mixedCardAmount={draft.mixedCardAmount}
            disabled={saving}
            onPaymentModeChange={onPaymentModeChange}
            onPaymentMethodChange={onPaymentMethodChange}
            onPaidAmountChange={onPaidAmountChange}
            onMixedCashAmountChange={onMixedCashAmountChange}
            onMixedCardAmountChange={onMixedCardAmountChange}
          />

          <EditBookingNoteSection note={draft.note} disabled={saving} language={language} onNoteChange={onNoteChange} />
        </div>

        {error ? <div className="bk-inline-error">{bookingActivityDisplayText(error, language)}</div> : null}
      </div>
      <div className="bk-cancel-foot">
        <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={handleClose} disabled={saving}>
          {t("ط±ط¬ظˆط¹")}
        </button>
        <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t("ط¬ط§ط±ظٹ ط§ظ„ط­ظپط¸...") : t("ط­ظپط¸ ط§ظ„طھط¹ط¯ظٹظ„ط§طھ")}
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
  language?: DashboardLanguage;
};

export default function DashboardBookings({ currentRole = "guest", language = "ar" }: DashboardBookingsProps) {
  const t = (arabic: string) => bookingsText(language, arabic);

  /* BOOKING_STATUS_OUTSIDE_CLOSE_V1 */
  useEffect(() => {
    const handleStatusMenuOutsidePointer = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) return;

      document
        .querySelectorAll<HTMLDetailsElement>(
          ".dashboard-v2 .bk-status-menu[open]",
        )
        .forEach((menu) => {
          if (!menu.contains(target)) {
            menu.removeAttribute("open");
          }
        });
    };

    document.addEventListener(
      "pointerdown",
      handleStatusMenuOutsidePointer,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleStatusMenuOutsidePointer,
      );
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [liveBookingsSource, setLiveBookingsSource] = useState<Booking[]>([]);
  const [historyBookingsSource, setHistoryBookingsSource] = useState<Booking[]>([]);
  const [error, setError] = useState("");
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);

  const [q, setQ] = useState("");
  const [bookingSearchFocused, setBookingSearchFocused] = useState(false);
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
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savedNoteId, setSavedNoteId] = useState("");
  const [savingNoteId, setSavingNoteId] = useState("");
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
  const noteSaveInFlightRef = useRef<Record<string, boolean>>({});
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

  const completedBookingManagerEmail =
    "nawafaaa6@gmail.com";

  const authUserEmailNormalized =
    String(
      auth.currentUser?.email ||
        authUser.email ||
        ""
    )
      .trim()
      .toLowerCase();

  const canManageCompletedBooking =
    authUserEmailNormalized ===
    completedBookingManagerEmail;

  const canEditBooking = useCallback(
    (booking: Booking) => {
      if (!canEditBookings) return false;

      if (
        booking.status === "completed" &&
        !canManageCompletedBooking
      ) {
        return false;
      }

      return true;
    },
    [
      canEditBookings,
      canManageCompletedBooking,
    ]
  );
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
    const by = currentDisplayName || fallbackEmailLabel || mappedUidLabel || (currentUid ? currentUid.slice(0, 8) : "â€”");

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
      throw new Error("ظ„ط§ ظٹظ…ظƒظ† ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‡ط°ط§ ط§ظ„ط­ط³ط§ط¨ ظ„ط£ظ†ظ‡ ظ„ط§ ظٹط­طھظˆظٹ ط¹ظ„ظ‰ ط¨ط±ظٹط¯ ط¥ظ„ظƒطھط±ظˆظ†ظٹ ظ…ط³ط¬ظ„.");
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
    let active = true;
    let firstLoad = true;
    let requestInFlight = false;

    const loadCoreBookings = async () => {
      if (!active || requestInFlight) return;
      requestInFlight = true;
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
        setError("طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ ظ…ظ† Core D1. ط§ط¶ط؛ط· طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ ظˆط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.");
      } finally {
        requestInFlight = false;
        if (active) setLoading(false);
        firstLoad = false;
      }
    };

    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void loadCoreBookings();
    };

    void loadCoreBookings();
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [bookingsRefreshKey]);

  useEffect(() => {
    const baseList = mergedBookingSources.map((b: any) => ({
      ...b,
      customerName: String(b?.customerName || b?.clientName || b?.name || "").trim() || "ط؛ظٹط± ظ…طھظˆظپط±",
      phone: String(b?.phone || b?.clientPhone || b?.customerPhone || "").trim() || "ط؛ظٹط± ظ…طھظˆظپط±",
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
          partialErrors.push("طھط¹ط°ط± طھط­ظ…ظٹظ„ ط³ط¬ظ„ ط§ظ„ط¹ظ…ظ„ظٹط§طھ ظ„ظ‡ط°ط§ ط§ظ„ط­ط¬ط².");
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
        setSelectedBookingActivityError("طھط¹ط°ط± طھط­ظ…ظٹظ„ ط³ط¬ظ„ ط§ظ„ط­ط¬ط² ط¨ط§ظ„ظƒط§ظ…ظ„ ط­ط§ظ„ظٹط§ظ‹.");
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
        const note = String(b.adminNote || "").trim();
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
  }, [selectedBooking, bookings]);

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
      if (fallback && fallback !== "â€”") {
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

  const bookingOperationsOverview = useMemo(() => {
    const today = todayISOLocal();
    let todayCount = 0;
    let todayConfirmed = 0;
    let todayCompleted = 0;
    let todayCollectedAmount = 0;
    let totalOutstandingAmount = 0;

    bookings.forEach((booking) => {
      const payment = resolveBookingPaymentSummary(booking);
      if (
        booking.status !== "cancelled" &&
        booking.status !== "completed"
      ) {
        totalOutstandingAmount += payment.remainingAmount;
      }
      if (String(booking.date || "") !== today || booking.status === "cancelled") return;
      todayCount += 1;
      if (booking.status === "confirmed") todayConfirmed += 1;
      if (booking.status === "completed") todayCompleted += 1;
      todayCollectedAmount += payment.paidAmount;
    });

    return {
      today,
      todayCount,
      todayConfirmed,
      todayCompleted,
      todayCollectedAmount: round2(todayCollectedAmount),
      totalOutstandingAmount: round2(totalOutstandingAmount),
    };
  }, [bookings]);

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
        title: "ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¹ط§ط¯ظٹط©",
        description:
          "طھط¸ظ‡ط± ظ‡ظ†ط§ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¹ط§ط¯ظٹط© ظپظ‚ط·طŒ ظˆظٹط¸ظ‡ط± ط§ظ„ط­ط¬ط² ط§ظ„ط¯ط§ط®ظ„ظٹ ط§ظ„ظ…ط³طھظ‚ط¨ظ„ظٹ ظ‚ط¨ظ„ ط§ظ„ط¯ظپط¹ ظ…ط¤ظ‚طھظ‹ط§ ظپظٹ ظ‡ط°ط§ ط§ظ„ظ‚ط³ظ….",
        rows: normalRows,
        blocks: buildDashboardBookingBlocks(normalRows),
        temporaryInternalCount: normalRows.filter((row) => isTemporaryNormalInternalBooking(row)).length,
      },
      {
        key: "internal",
        title: "ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¯ط§ط®ظ„ظٹط©",
        description:
          "طھط¸ظ‡ط± ظ‡ظ†ط§ ط¬ظ…ظٹط¹ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¯ط§ط®ظ„ظٹط© ط¨ط´ظƒظ„ ظ…ط³طھظ‚ظ„طŒ ظˆظ„ط§ ظٹط¨ظ‚ظ‰ ط£ظٹ ط­ط¬ط² ط¯ط§ط®ظ„ظٹ ط¯ط§ط®ظ„ ط§ظ„ظ‚ط³ظ… ط§ظ„ط¹ط§ط¯ظٹ ط¨ط¹ط¯ ط§ظ„ط¯ظپط¹ ط£ظˆ ط§ظ„طھط£ظƒظٹط¯.",
        rows: internalRows,
        blocks: buildDashboardBookingBlocks(internalRows),
        temporaryInternalCount: 0,
      },
    ];
  }, [pagedBookings]);

  const unseenNewBookings = useMemo(() => {
    const today = todayISOLocal();

    return bookings
      .filter((b) => {
        if (b.status === "cancelled") return false;

        const bookingDate = safeISODate(b.date);
        return Boolean(bookingDate && bookingDate >= today);
      })
      .sort((a, b) => {
        const aMs =
          parseBookingDateTimeMs(String(a.date || ""), String(a.time || "")) ??
          Number.MAX_SAFE_INTEGER;
        const bMs =
          parseBookingDateTimeMs(String(b.date || ""), String(b.time || "")) ??
          Number.MAX_SAFE_INTEGER;

        return aMs - bMs;
      });
  }, [bookings]);

  const unseenNewPreviewBookings = useMemo(
    () => unseenNewBookings.slice(0, 6),
    [unseenNewBookings]
  );

  const unseenNewBookingIds = useMemo(
    () =>
      new Set(
        unseenNewBookings
          .filter((booking) => {
            const createdAtMs = toMillisSafe((booking as any)?.createdAt);
            return createdAtMs > newBookingsSeenAt;
          })
          .map((booking) => String(booking.id || "").trim())
          .filter(Boolean)
      ),
    [unseenNewBookings, newBookingsSeenAt]
  );

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

  const attentionBookingCount = useMemo(() => {
    const ids = new Set<string>();
    [...staleStatusBookings, ...expiredPendingDayBookings].forEach((booking) => {
      const id = String(booking.id || "").trim();
      if (id) ids.add(id);
    });
    return ids.size;
  }, [expiredPendingDayBookings, staleStatusBookings]);

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
      return `طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط¬ط² ${action.bookingRef} ط¥ظ„ظ‰ ${statusLabel[action.nextStatus]}`;
    }
    if (action.kind === "edit") return `طھط¹ط¯ظٹظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط¬ط² ${bookingRef(action.booking)}`;
    if (action.kind === "refund") return `ط¥ط¯ط§ط±ط© ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ط­ط¬ط² ${bookingRef(action.booking)}`;
    return `ط¥ط²ط§ظ„ط© ط§ظ„ط­ط¬ط² ${bookingRef(action.booking)} ظ…ظ† طµظپط­ط© ط§ظ„ط­ط¬ظˆط²ط§طھ`;
  };

  const executeStatusUpdate = async (id: string, newStatus: BookingStatus) => {
    const target = bookings.find((x) => x.id === id);
    if (!target) return;
    const allowed = getAllowedStatusOptions(target);
    if (!allowed.includes(newStatus)) {
      alert("ط؛ظٹط± ظ…ط³ظ…ظˆط­ ظ„ظƒ ط¨ظ‡ط°ط§ ط§ظ„طھط؛ظٹظٹط±.");
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
      // BOOKING_SINGLE_COMPLETED_PAYMENT_V2
      const completedPaymentPatch: Partial<Booking> | null =
        newStatus === "completed"
          ? completedBookingPaymentPatch(target)
          : null;

      if (completedPaymentPatch) {
        await updateCoreBookingFields(
          id,
          completedPaymentPatch as any
        );
      }

      await updateCoreBookingStatus(id, newStatus);
      const localAuditPatch = getLocalActorAudit();
      const localPatch = {
        status: newStatus,
        ...(completedPaymentPatch || {}),
        ...localAuditPatch,
      };
      setBookings((prev) => prev.map((row) => (row.id === id ? { ...row, ...localPatch } : row)));
      setSelectedBooking((prev) => (prev && prev.id === id ? { ...prev, ...localPatch } : prev));
      touchLastUpdate(id, localAuditPatch.atMs);
    } catch (e) {
      alert("ظپط´ظ„ طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط©");
    }
  };

  const handleUpdateStatus = useCallback((id: string, newStatus: BookingStatus) => {
    const target = bookings.find((x) => x.id === id);
    if (!target) return;
    const allowed = getAllowedStatusOptions(target);
    if (!allowed.includes(newStatus)) {
      alert("ط؛ظٹط± ظ…ط³ظ…ظˆط­ ظ„ظƒ ط¨ظ‡ط°ط§ ط§ظ„طھط؛ظٹظٹط±.");
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
        setConfirmError("ظ…ط¨ط§ظ„ط؛ ط§ظ„ط¯ظپط¹ ط§ظ„ظ…ط®طھظ„ط· ظٹط¬ط¨ ط£ظ† طھظƒظˆظ† 0 ط£ظˆ ط£ظƒط«ط±.");
        return;
      }
      if (round2(mixedCashAmount + mixedCardAmount) !== round2(totalAmount)) {
        setConfirmError("ظ…ط¬ظ…ظˆط¹ ط§ظ„ظƒط§ط´ ظˆط§ظ„ط´ط¨ظƒط© ظٹط¬ط¨ ط£ظ† ظٹط³ط§ظˆظٹ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط².");
        return;
      }
    }

    if (!isMixedPayment && nextMode === "partial") {
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        setConfirmError("ط£ط¯ط®ظ„ظٹ ظ…ط¨ظ„ط؛ ط¹ط±ط¨ظˆظ† طµط­ظٹط­ (0 ط£ظˆ ط£ظƒط«ط±).");
        return;
      }
      if (paidAmount > totalAmount) {
        setConfirmError("ظ…ط¨ظ„ط؛ ط§ظ„ط¹ط±ط¨ظˆظ† ظ„ط§ ظٹظ…ظƒظ† ط£ظ† ظٹطھط¬ط§ظˆط² ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط².");
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
      setConfirmError("طھط¹ط°ط± طھط£ظƒظٹط¯ ط§ظ„ط­ط¬ط² ط§ظ„ط¢ظ†.");
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
      alert("ظپط´ظ„ ط¥ظ„ط؛ط§ط، ط§ظ„ط­ط¬ط²");
    } finally {
      setCancelBusy(false);
    }
  };

  const executeDeleteBooking = async (b: Booking) => {
    if (uiRole !== "owner") {
      alert("ط­ط°ظپ ط§ظ„ط­ط¬ط² ظ…طھط§ط­ ظ„ظ„ظ…ط§ظ„ظƒ ظپظ‚ط·");
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
      throw new Error("طھط¹ط°ط± ط­ط°ظپ ط§ظ„ط­ط¬ط² ط§ظ„ط¢ظ†.");
    }
  };

  const handleDeleteBooking = useCallback((b: Booking) => {
    if (uiRole !== "owner") {
      alert("ط­ط°ظپ ط§ظ„ط­ط¬ط² ظ…طھط§ط­ ظ„ظ„ظ…ط§ظ„ظƒ ظپظ‚ط·");
      return;
    }
    requestSensitiveAction({ kind: "delete", booking: b });
  }, [requestSensitiveAction, uiRole]);

  const openEditBookingModalUnsafe = useCallback((b: Booking) => {
    if (!canEditBooking(b)) {
      if (
        b.status === "completed" &&
        !canManageCompletedBooking
      ) {
        alert(
          "ط§ظ„ط­ط¬ط² ط§ظ„ظ…ظƒطھظ…ظ„ ظ…ط­ظ…ظٹ ظˆظ„ط§ ظٹظ…ظƒظ† طھط¹ط¯ظٹظ„ظ‡ ظ…ظ† ظ‡ط°ط§ ط§ظ„ط­ط³ط§ط¨."
        );
        return;
      }

      alert("ط§ظ„طھط¹ط¯ظٹظ„ ظ…طھط§ط­ ظپظ‚ط· ظ„ظ„ظ…ط§ظ„ظƒ ط£ظˆ ط§ظ„ط£ط¯ظ…ظ†.");
      return;
    }

    setEditTarget(b);
  }, [
    canEditBooking,
    canManageCompletedBooking,
  ]);

  const openEditBookingModal = useCallback((b: Booking) => {
    if (!canEditBooking(b)) {
      if (
        b.status === "completed" &&
        !canManageCompletedBooking
      ) {
        alert(
          "ط§ظ„ط­ط¬ط² ط§ظ„ظ…ظƒطھظ…ظ„ ظ…ط­ظ…ظٹ ظˆظ„ط§ ظٹظ…ظƒظ† طھط¹ط¯ظٹظ„ظ‡ ظ…ظ† ظ‡ط°ط§ ط§ظ„ط­ط³ط§ط¨."
        );
        return;
      }

      alert("ط§ظ„طھط¹ط¯ظٹظ„ ظ…طھط§ط­ ظپظ‚ط· ظ„ظ„ظ…ط§ظ„ظƒ ط£ظˆ ط§ظ„ط£ط¯ظ…ظ†.");
      return;
    }

    if (uiRole === "owner") {
      openEditBookingModalUnsafe(b);
      return;
    }

    requestSensitiveAction({
      kind: "edit",
      booking: b,
    });
  }, [
    canEditBooking,
    canManageCompletedBooking,
    openEditBookingModalUnsafe,
    requestSensitiveAction,
    uiRole,
  ]);

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
      setActionPinError("ط§ظ„ط±ظ‚ظ… ط§ظ„ط³ط±ظٹ ط؛ظٹط± طµط­ظٹط­.");
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
      setEditError("ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ط© ظ…ط·ظ„ظˆط¨.");
      return;
    }
    if (!sectionId) {
      setEditError("ط§ظ„ظ‚ط³ظ… ظ…ط·ظ„ظˆط¨.");
      return;
    }
    if (!serviceId || !selectedService) {
      setEditError("ط§ظ„ط®ط¯ظ…ط© ظ…ط·ظ„ظˆط¨ط©.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setEditError("ط§ظ„طھط§ط±ظٹط® ط؛ظٹط± طµط­ظٹط­.");
      return;
    }
    if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(time)) {
      setEditError("ط§ظ„ظˆظ‚طھ ط؛ظٹط± طµط­ظٹط­ (HH:MM).");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setEditError("ط§ظ„ط³ط¹ط± ط؛ظٹط± طµط­ظٹط­.");
      return;
    }
    if (paymentType === "partial") {
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        setEditError("ط£ط¯ط®ظ„ظٹ ظ…ط¨ظ„ط؛ ط¹ط±ط¨ظˆظ† طµط­ظٹط­ (0 ط£ظˆ ط£ظƒط«ط±).");
        return;
      }
      if (paidAmount > price) {
        setEditError("ظ…ط¨ظ„ط؛ ط§ظ„ط¹ط±ط¨ظˆظ† ظ„ط§ ظٹظ…ظƒظ† ط£ظ† ظٹطھط¬ط§ظˆط² ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط².");
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
      const paymentStatusDecision = await askBookingDecision({
        title: "طھظ… ط§ظƒطھظ…ط§ظ„ ط§ظ„ط³ط¯ط§ط¯",
        message:
          "ط£طµط¨ط­ ط§ظ„ظ…طھط¨ظ‚ظٹ 0 ط±.ط³. ط§ظƒطھظ…ط§ظ„ ط§ظ„ط¯ظپط¹ ظ„ط§ ظٹط¹ظ†ظٹ ط¨ط§ظ„ط¶ط±ظˆط±ط© ط£ظ† ط§ظ„ط®ط¯ظ…ط© ط§ظ†طھظ‡طھطŒ ظ„ط°ظ„ظƒ ط§ط®طھط§ط±ظٹ ط­ط§ظ„ط© ط§ظ„ط­ط¬ط² ط§ظ„طµط­ظٹط­ط©.",
        confirmText: "طھط­ظˆظٹظ„ ط¥ظ„ظ‰ ظ…ظƒطھظ…ظ„",
        cancelText: "ط§ظ„ط¥ط¨ظ‚ط§ط، ظ…ط¤ظƒط¯ظ‹ط§",
        tone: "success",
      });

      if (paymentStatusDecision === "confirm") {
        statusAfterEdit = "completed";
      } else if (paymentStatusDecision === "cancel") {
        statusAfterEdit = "confirmed";
      } else {
        // X / ط¥ط؛ظ„ط§ظ‚: ظ„ط§ ظ†ط؛ظٹظ‘ط± ط­ط§ظ„ط© ط§ظ„ط­ط¬ط²
        statusAfterEdit = null;
      }
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
        setEditError("ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظ…ط¹ظٹظ†ط© ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط­ط¬ط² ظ„ظ… طھط¹ط¯ ظ†ط´ط·ط© طھط´ط؛ظٹظ„ظٹظ‹ط§ ظ„ظ‡ط°ط§ ط§ظ„ظ…ظˆط¹ط¯. ط§ط®طھط§ط±ظٹ ظ…ظˆط¸ظپط© ط£ط®ط±ظ‰ ط£ظˆ ط£ط¹ظٹط¯ظٹ ط¬ط¯ظˆظ„ط© ط§ظ„ط­ط¬ط².");
      } else {
        setEditError("طھط¹ط°ط± ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط².");
      }
    } finally {
      setEditSaving(false);
    }
  };

  */

  const canManageRefund = useCallback((b: Booking) => {
    if (
      !(
        uiRole === "owner" ||
        uiRole === "admin" ||
        uiRole === "reception"
      )
    ) {
      return false;
    }

    if (
      !(
        b.status === "confirmed" ||
        b.status === "completed"
      )
    ) {
      return false;
    }

    if (
      b.status === "completed" &&
      !canManageCompletedBooking
    ) {
      return false;
    }

    const amount = readBookingTotalAmount(b);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return false;
    }

    return true;
  }, [
    uiRole,
    canManageCompletedBooking,
  ]);

  /*
  const detectPaymentMethod = (b: Booking): PaymentMethod => {
    const stored = String((b as any)?.paymentMethod || "").toLowerCase().trim();
    if (stored === "card" || stored === "cash" || stored === "transfer") {
      return stored as PaymentMethod;
    }
    const s = String((b as any)?.note || "").toLowerCase();
    if (s.includes("ط´ط¨ظƒط©") || s.includes("ظ…ط¯ظ‰") || s.includes("card")) return "card";
    if (s.includes("طھط­ظˆظٹظ„") || s.includes("transfer")) return "transfer";
    if (s.includes("ظƒط§ط´") || s.includes("cash") || s.includes("ظ†ظ‚ط¯")) return "cash";
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
      setRefundError("ط£ط¯ط®ظ„ ظ…ط¨ظ„ط؛ ط§ط³طھط±ط¬ط§ط¹ طµط­ظٹط­.");
      return;
    }
    if (amountInput > bookingAmount) {
      setRefundError("ظ…ط¨ظ„ط؛ ط§ظ„ط§ط³طھط±ط¬ط§ط¹ ظ„ط§ ظٹظ…ظƒظ† ط£ظ† ظٹطھط¬ط§ظˆط² ظ‚ظٹظ…ط© ط§ظ„ط­ط¬ط².");
      return;
    }
    const reason = String(refundDraft.reason || "").trim();
    if (!reason) {
      setRefundError("ط³ط¨ط¨ ط§ظ„ط§ط³طھط±ط¬ط§ط¹ ظ…ط·ظ„ظˆط¨.");
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
      setRefundError("طھط¹ط°ط± طھط³ط¬ظٹظ„ ط§ظ„ط§ط³طھط±ط¬ط§ط¹.");
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
      setRefundError("طھط¹ط°ط± ط¥ظ„ط؛ط§ط، ط§ظ„ط§ط³طھط±ط¬ط§ط¹.");
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

  const updateNote = (id: string, note: string) => {
    setNoteDrafts((prev) => ({ ...prev, [id]: note }));
  };

  const saveNote = async (id: string) => {
    if (noteSaveInFlightRef.current[id]) return;

    const text = String(noteDrafts[id] ?? "").trim();

    noteSaveInFlightRef.current[id] = true;
    setSavingNoteId(id);
    setSavedNoteId("");

    try {
      const canonical = coreBookingToLegacy(
        await CoreBookingService.patch(id, {
          adminNotes: text || null,
        })
      ) as Booking;

      setLiveBookingsSource((prev) =>
        prev.map((booking) =>
          booking.id === id ? canonical : booking
        )
      );

      setHistoryBookingsSource((prev) =>
        prev.map((booking) =>
          booking.id === id ? canonical : booking
        )
      );

      setSelectedBooking((prev) =>
        prev?.id === id ? canonical : prev
      );

      setNoteDrafts((prev) => ({
        ...prev,
        [id]: canonical.adminNote || "",
      }));

      setSavedNoteId(id);

      if (saveHintTimerRef.current) {
        window.clearTimeout(saveHintTimerRef.current);
      }

      saveHintTimerRef.current = window.setTimeout(
        () => setSavedNoteId(""),
        1800
      );
    } catch (error) {
      console.error("[DashboardBookings] Core admin note save failed", error);
      setSavedNoteId("");
      setError("طھط¹ط°ط± ط­ظپط¸ ظ…ظ„ط§ط­ط¸ط© ط§ظ„ط¥ط¯ط§ط±ط© ظپظٹ Core D1. ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.");
    } finally {
      noteSaveInFlightRef.current[id] = false;
      setSavingNoteId((current) => current === id ? "" : current);
    }
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

  const activeFilterCount = useMemo(
    () =>
      [
        Boolean(q.trim()),
        statusFilter !== "all",
        Boolean(excludedStatus),
        settlementFilter !== "all",
        Boolean(dateFrom || dateTo || datePreset !== "all"),
        paymentMethodFilter !== "all",
        employeeFilter !== "all",
        serviceFilter !== "all",
        sourceFilter !== "all",
        oldPendingFilter !== "off" || Boolean(oldPendingFrom || oldPendingTo),
        sortOrder !== "newest",
      ].filter(Boolean).length,
    [
      dateFrom,
      datePreset,
      dateTo,
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
      language === "en"
        ? `${t(datePreset === "all" ? "ظƒظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ" : datePreset === "today" ? "ط§ظ„ظٹظˆظ…" : datePreset === "yesterday" ? "ط£ظ…ط³" : datePreset === "week" ? "ظ‡ط°ط§ ط§ظ„ط£ط³ط¨ظˆط¹" : datePreset === "month" ? "ظ‡ط°ط§ ط§ظ„ط´ظ‡ط±" : datePreset === "last_month" ? "ط§ظ„ط´ظ‡ط± ط§ظ„ظ…ط§ط¶ظٹ" : "ظ†ط·ط§ظ‚ ظ…ط®طµطµ")}${datePreset === "all" ? "" : ` (${dateFrom || "start"} - ${dateTo || "end"})`}`
        : dateFilterLabel(dateFrom, dateTo, datePreset),
      statusFilter === "all" ? t("ظƒظ„ ط§ظ„ط­ط§ظ„ط§طھ") : `${t("ط§ظ„ط­ط§ظ„ط©")}: ${t(statusLabel[statusFilter])}`,
      settlementFilter === "all"
        ? ""
        : `${t("ط­ط§ظ„ط© ط§ظ„ط¯ظپط¹")}: ${t(
            settlementFilter === "paid"
              ? "ظ…ط¯ظپظˆط¹ ط¨ط§ظ„ظƒط§ظ…ظ„"
              : settlementFilter === "partial"
                ? "ظ…ط¯ظپظˆط¹ ط¬ط²ط¦ظٹط§"
                : "ط؛ظٹط± ظ…ط¯ظپظˆط¹"
          )}`,
      paymentMethodFilter === "all" ? "" : `${t("ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}: ${t(paymentMethodLabel(paymentMethodFilter))}`,
      employeeFilter === "all"
        ? ""
        : `${t("ط§ظ„ظ…ظˆط¸ظپط©")}: ${employeeFilterOptions.find(([id]) => id === employeeFilter)?.[1] || employeeFilter}`,
      serviceFilter === "all"
        ? ""
        : `${t("ط§ظ„ط®ط¯ظ…ط©")}: ${serviceFilterOptions.find(([id]) => id === serviceFilter)?.[1] || serviceFilter}`,
      sourceFilter === "all" ? "" : `${t("ط§ظ„ظ…طµط¯ط±")}: ${t(sourceFilter)}`,
      oldPendingFilter === "off" ? "" : t("ط­ط¬ظˆط²ط§طھ ظ‚ط¯ظٹظ…ط© ظ…ط§ ط²ط§ظ„طھ ط¨ط§ظ„ط§ظ†طھط¸ط§ط±"),
      q.trim() ? `${t("ط¨ط­ط«")}: ${q.trim()}` : "",
    ].filter(Boolean);
    return parts.join(" | ");
  }, [
    dateFrom,
    datePreset,
    dateTo,
    employeeFilter,
    employeeFilterOptions,
    language,
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

  const toggleSectionSelection = useCallback((rows: Booking[]) => {
    const sectionIds = rows
      .map((booking) => String(booking.id || "").trim())
      .filter(Boolean);

    if (!sectionIds.length) return;

    setSelectedBookingIds((prev) => {
      const next = new Set(prev);

      const allSectionSelected =
        sectionIds.every((id) => next.has(id));

      sectionIds.forEach((id) => {
        if (allSectionSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });

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

  const selectAllMatchingBookings = useCallback(async () => {
    if (!filteredBookingIds.length) return;
    const ok = await askBookingDecision({
      title: "طھط­ط¯ظٹط¯ ظƒظ„ ط§ظ„ظ†طھط§ط¦ط¬",
      message:
        `ط³ظٹطھظ… طھط­ط¯ظٹط¯ ${filteredBookingIds.length} ط­ط¬ط² ظ…ط·ط§ط¨ظ‚ ظ„ظ„ظپظ„ط§طھط± ط§ظ„ط­ط§ظ„ظٹط©طŒ ظˆظ„ظٹط³ ط§ظ„طµظپط­ط© ط§ظ„ط­ط§ظ„ظٹط© ظپظ‚ط·.`,
      confirmText: "طھط­ط¯ظٹط¯ ط§ظ„ظƒظ„",
      cancelText: "ط±ط¬ظˆط¹",
      tone: "warning",
    });

    if (ok !== "confirm") return;
    setSelectedBookingIds(new Set(filteredBookingIds));
  }, [filteredBookingIds]);

  const clearSelectedBookings = useCallback(() => {
    setSelectedBookingIds(new Set());
  }, []);

  const openBulkStatusModal = useCallback((nextStatus: BookingStatus) => {
    setBulkResultMessage("");
    setBulkError("");

    if (!selectedBookings.length) {
      setBulkError("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط£ظٹ ط­ط¬ط².");
      return;
    }

    const eligible = selectedBookings.filter(
      (booking) => booking.status !== nextStatus
    );

    if (!eligible.length) {
      setBulkError(
        `طھظ… طھط­ط¯ظٹط¯ ${selectedBookings.length} ط­ط¬ط²طŒ ظˆط¬ظ…ظٹط¹ظ‡ط§ ط­ط§ظ„طھظ‡ط§ ط¨ط§ظ„ظپط¹ظ„ ${statusLabel[nextStatus]}.`
      );
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
      setBulkError(
        selectedBookings.length && bulkTargetStatus
          ? `ط¬ظ…ظٹط¹ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ…ط­ط¯ط¯ط© ط­ط§ظ„طھظ‡ط§ ط¨ط§ظ„ظپط¹ظ„ ${statusLabel[bulkTargetStatus]}.`
          : "ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط£ظٹ ط­ط¬ط²."
      );
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
        note: `طھط­ط¯ظٹط« ط¬ظ…ط§ط¹ظٹ ظ„ط­ط§ظ„ط© ط§ظ„ط­ط¬ظˆط²ط§طھ ط¥ظ„ظ‰ ${statusLabel[bulkTargetStatus]}`,
      });

      // BOOKING_BULK_COMPLETED_PAYMENT_V2
      const failedBookingIds = new Set(
        (result.failures || []).map((failure) =>
          String(failure.bookingId || "").trim()
        )
      );

      const successfulBookingIds =
        bookingIds.filter(
          (bookingId) =>
            !failedBookingIds.has(bookingId)
        );

      const localAuditPatch = getLocalActorAudit();
      setBookings((prev) =>
        prev.map((row) =>
          successfulBookingIds.includes(String(row.id || "").trim())
            ? {
                ...row,
                status: bulkTargetStatus,
                ...localAuditPatch,
              }
            : row
        )
      );
      setSelectedBooking((prev) =>
        prev && successfulBookingIds.includes(String(prev.id || "").trim())
          ? {
              ...prev,
              status: bulkTargetStatus,
              ...localAuditPatch,
            }
          : prev
      );
      setBulkResultMessage(
        `طھظ… طھط­ط¯ظٹط« ${result.successCount} ط­ط¬ط². ظپط´ظ„ ${result.failedCount} ط­ط¬ط².`
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
      setBulkError(String(e?.message || e || "طھط¹ط°ط± طھظ†ظپظٹط° ط§ظ„طھط­ط¯ظٹط« ط§ظ„ط¬ظ…ط§ط¹ظٹ."));
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
        setError("طھظ… ظ…ظ†ط¹ ظپطھط­ ظ†ط§ظپط°ط© ط§ظ„ظپط§طھظˆط±ط©. ظپط¹ظ‘ظ„ظٹ ط§ظ„ظ†ظˆط§ظپط° ط§ظ„ظ…ظ†ط¨ط«ظ‚ط© ظ„ظ„ظ…ظˆظ‚ط¹ ط«ظ… ط¬ط±ظ‘ط¨ظٹ ظ…ط±ط© ط£ط®ط±ظ‰.");
        return;
      }
      popup.focus();
    } catch (e) {
      console.error("print booking invoice error:", e);
      setError("طھط¹ط°ط± طھط¬ظ‡ظٹط² ط§ظ„ظپط§طھظˆط±ط© ظ„ظ„ط·ط¨ط§ط¹ط©.");
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
      className={`dsv2-card dsv2-card--padded bookings-v2-table-section bookings-v2-table-section--${section.key}`}
      aria-label={t(section.title)}
    >
      <div className="dsv2-section-head bookings-v2-table-section__head">
        <div className="bk-bookings-section-copy">
          <h2>{t(section.title)}</h2>
          <p>{t(section.description)}</p>
        </div>
        <div className="bk-bookings-section-meta">
          <span className="bk-bookings-section-count">{section.rows.length} {t("ط­ط¬ط²")}</span>
          {section.key === "normal" && section.temporaryInternalCount > 0 ? (
            <span className="bk-bookings-section-note">
              {t("ظ…ظ†ظ‡ط§")} {section.temporaryInternalCount} {t("ط­ط¬ط² ط¯ط§ط®ظ„ظٹ ظ…ط³طھظ‚ط¨ظ„ظٹ ظ‚ط¨ظ„ ط§ظ„ط¯ظپط¹")}
            </span>
          ) : null}
        </div>
      </div>

      {section.rows.length ? (
        <div className="bookings-v2-table-card">
          <div className="bk-table-wrap">
            <table className="dsv2-table bookings-v2-table">
              <thead>
                <tr>
                  <th className="bk-col-select">
                    <input
                      type="checkbox"
                      className="bk-select-checkbox"
                      checked={
                        section.rows.length > 0 &&
                        section.rows.every((booking) =>
                          selectedBookingIds.has(
                            String(booking.id || "").trim()
                          )
                        )
                      }
                      onChange={() =>
                        toggleSectionSelection(section.rows)
                      }
                      aria-label={`${t("طھط­ط¯ظٹط¯ ط­ط¬ظˆط²ط§طھ ظ‚ط³ظ…")} ${t(section.title)}`}
                    />
                  </th>
                  <th>{t("ط§ظ„ط­ط¬ط²")}</th>
                  <th>{t("ط§ظ„ط¹ظ…ظٹظ„ط©")}</th>
                  <th>{t("ط§ظ„ط®ط¯ظ…ط© ظˆط§ظ„ظ…ظˆط¸ظپط©")}</th>
                  <th>{t("ط§ظ„ظ…ظˆط¹ط¯")}</th>
                  <th>{t("ط§ظ„طھط­طµظٹظ„")}</th>
                  <th>{t("ط§ظ„ط¥ط¬ط±ط§ط،ط§طھ")}</th>
                </tr>
              </thead>
              <tbody>
                {section.blocks.flatMap((block) => {
                  const rows: any[] = [];
                  if (block.rows.length > 1) {
                    rows.push(
                      <tr key={`${section.key}-group-${block.key}`} className="bookings-group-row">
                        <td colSpan={7}>
                          <div className="bookings-group-row-inner">
                            <span className="bookings-group-title">{t("ط­ط¬ط² ظ…ط¬ظ…ظ‘ط¹")}</span>
                            <span className="bookings-group-meta">
                              {t("ط§ظ„ظ…ط±ط¬ط¹")}: {block.label} â€¢ {block.rows.length} {t("ط®ط¯ظ…ط§طھ")}
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
                    const isNewBooking = unseenNewBookingIds.has(String(b.id || "").trim());

                    rows.push(
                      <tr
                        key={b.id}
                        className={`bk-row bk-row-${safeStatus}${isPendingDeposit ? " bk-row-pending-deposit" : ""}${isNewBooking ? " is-new-booking" : ""}`}
                      >
                        <td className="bk-col-select">
                          <input
                            type="checkbox"
                            className="bk-select-checkbox"
                            checked={selectedBookingIds.has(String(b.id || "").trim())}
                            onChange={() => toggleBookingSelection(b.id)}
                            aria-label={`${t("طھط­ط¯ظٹط¯ ط§ظ„ط­ط¬ط²")} ${bookingRef(b)}`}
                          />
                        </td>
                        <td>
                          <div className="bk-ref-cell">
                            <div className="bk-ref-title-row">
                              <button type="button" className="bk-ref-code" onClick={() => setSelectedBooking(b)} title={t("ظپطھط­ طھظپط§طµظٹظ„ ط§ظ„ط­ط¬ط²")}>
                                <bdi className="bk-numeric" dir="ltr">{bookingRef(b)}</bdi>
                              </button>
                              {isNewBooking ? <span className="bk-new-row-badge">{t("ط¬ط¯ظٹط¯")}</span> : null}
                            </div>
                            <div className="bk-ref-meta">
                              <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                                {t(statusLabel[safeStatus])}
                              </span>
                              {channelBadge ? (
                                <span className={`bk-channel-badge${isTemporaryInternal ? " is-temporary" : ""}`}>
                                  {t(channelBadge)}
                                </span>
                              ) : null}
                            </div>
                            <small className="bk-row-update">{t("ط¢ط®ط± طھط­ط¯ظٹط«")}: {lastUpdateMap[b.id]?.at || "â€”"}</small>
                          </div>
                        </td>
                        <td>
                          <div className="bk-customer-name">{b.customerName || "â€”"}</div>
                          <div className="bk-customer-phone"><bdi className="bk-numeric" dir="ltr">{b.phone || "â€”"}</bdi></div>
                        </td>
                        <td>
                          <div className="bk-service-main">{serviceSummaryForTable(b)}</div>
                          <div className="bk-service-meta">{serviceMetaSummaryForTable(b)}</div>
                          <span className="bk-employee-pill">{b.employeeName || t("ط؛ظٹط± ظ…ط­ط¯ط¯ط©")}</span>
                        </td>
                        <td>
                          <div className="bk-appointment-cell">
                            <strong><bdi className="bk-numeric" dir="ltr">{b.date}</bdi></strong>
                            <span><FontAwesomeIcon icon={faClock} /><bdi className="bk-numeric" dir="ltr">{formatTime12(b.time)}</bdi></span>
                          </div>
                        </td>
                        <td>
                          <div className="bk-payment-cell bk-payment-cell--compact">
                            <div className="bk-payment-total">
                              <span className="bk-payment-total-label">{t("ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ")}</span>
                              <span className="bk-payment-total-value"><BookingMoney value={payment.totalAmount} language={language} /></span>
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
                              >
                                {t(compactPaymentStatusLabel(payment))}
                              </span>
                              {bookingPaymentMethodFilterValue(b) !== "none" ? (
                                <span className={`bk-payment-method-chip bk-payment-method-${bookingPaymentMethodFilterValue(b)}`}>
                                  {t(paymentMethodLabel(bookingPaymentMethodFilterValue(b)))}
                                </span>
                              ) : null}
                            </div>
                            <div className="bk-payment-inline-metrics">
                              <span className="bk-payment-inline-paid">{t("ظ…ط¯ظپظˆط¹")}<b><BookingMoney value={payment.paidAmount} language={language} /></b></span>
                              <span className="bk-payment-inline-remaining">{t("ظ…طھط¨ظ‚ظٹ")}<b><BookingMoney value={payment.remainingAmount} language={language} /></b></span>
                            </div>
                          </div>
                        </td>
                        <td className="bk-actions-cell">
                          <div className="bk-actions-row">
                            <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm bookings-v2-row-primary" onClick={() => setSelectedBooking(b)}>
                              {t("ظپطھط­")}
                            </button>
                            <button
                              type="button"
                              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm bk-print-invoice-btn"
                              onClick={() => void handlePrintBookingInvoice(b)}
                              disabled={printInvoiceBusyId === b.id}
                              title={t("ط·ط¨ط§ط¹ط© ط§ظ„ظپط§طھظˆط±ط©")}
                            >
                              <FontAwesomeIcon icon={faPrint} aria-hidden="true" />
                              <span>{printInvoiceBusyId === b.id ? t("طھط¬ظ‡ظٹط²...") : t("ط·ط¨ط§ط¹ط©")}</span>
                            </button>
                            {canEditBooking(b) ? (
                              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm bookings-v2-row-edit" onClick={() => openEditBookingModal(b)}>
                                {t("طھط¹ط¯ظٹظ„")}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm bk-refund-btn"
                              onClick={() => openRefundModal(b)}
                              disabled={!canManageRefund(b) || refundBusyId === b.id}
                            >
                              {refundMapByBookingId[String(b.id || "").trim()] ? t("ط§ظ„ط§ط³طھط±ط¬ط§ط¹") : t("ط§ط³طھط±ط¬ط§ط¹")}
                            </button>
                            {(uiRole === "owner" || uiRole === "admin") ? (
                              <details className={`bk-status-menu bk-owner-status-${b.status}`}>
                              <summary aria-label={`${t("طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط¬ط²")} ${bookingRef(b)}`}>
                                {t(statusLabel[b.status])}
                              </summary>
                              <div className="bk-status-menu__panel" role="menu">
                                {allStatusOptions.map((s) => (
                                  <button
                                    key={`desk_${b.id}_${s}`}
                                    type="button"
                                    className={s === b.status ? "is-active" : ""}
                                    onClick={(event) => {
                                      const details = event.currentTarget.closest("details") as HTMLDetailsElement | null;
                                      details?.removeAttribute("open");
                                      handleUpdateStatus(b.id, s);
                                    }}
                                  >
                                    {t(statusLabel[s])}
                                  </button>
                                ))}
                              </div>
                            </details>
                            ) : null}
                            {uiRole === "owner" ? (
                              <button
                                type="button"
                                className="dsv2-btn dsv2-btn--danger dsv2-btn--sm bookings-v2-row-delete"
                                onClick={() => handleDeleteBooking(b)}
                                title={t("ط¥ط²ط§ظ„ط© ط§ظ„ط­ط¬ط² ظ…ظ† ط§ظ„ظ‚ط§ط¦ظ…ط© ظ…ط¹ ط­ظپط¸ ط§ظ„ط³ط¬ظ„ط§طھ ط§ظ„ظ…ط§ظ„ظٹط©")}
                              >
                                {t("ط­ط°ظپ")}
                              </button>
                            ) : null}
                            {uiRole === "reception" && b.status === "pending" ? (
                              <>
                                <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => handleUpdateStatus(b.id, "confirmed")}>{t("طھط£ظƒظٹط¯")}</button>
                                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => handleUpdateStatus(b.id, "cancelled")}>{t("ط¥ظ„ط؛ط§ط،")}</button>
                              </>
                            ) : null}
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
                    <span>{t("ط­ط¬ط² ظ…ط¬ظ…ظ‘ط¹")}</span>
                    <span>{block.label} - {block.rows.length} {t("ط®ط¯ظ…ط§طھ")}</span>
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
                  const isNewBooking = unseenNewBookingIds.has(String(b.id || "").trim());
                  return (
                    <div
                      key={b.id}
                      className={`bk-mobile-card bk-mobile-card-${safeStatus}${isPendingDeposit ? " is-pending-deposit" : ""}${isNewBooking ? " is-new-booking" : ""}`}
                    >
                      <label className="bk-mobile-select-row">
                        <input
                          type="checkbox"
                          className="bk-select-checkbox"
                          checked={selectedBookingIds.has(String(b.id || "").trim())}
                          onChange={() => toggleBookingSelection(b.id)}
                        />
                        <span>{t("طھط­ط¯ظٹط¯ ظ‡ط°ط§ ط§ظ„ط­ط¬ط²")}</span>
                      </label>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط±ظ‚ظ… ط§ظ„ط­ط¬ط²:")}</span>
                        <span className="bk-mobile-val bk-mobile-ref-value">
                          <bdi className="bk-numeric bk-font-strong" dir="ltr">{bookingRef(b)}</bdi>
                          {isNewBooking ? <span className="bk-mobile-new-badge">{t("ط¬ط¯ظٹط¯")}</span> : null}
                        </span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„ط¹ظ…ظٹظ„ط©:")}</span>
                        <span className="bk-mobile-val">{b.customerName || "â€”"}</span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„ط¬ظˆط§ظ„:")}</span>
                        <bdi className="bk-mobile-val bk-numeric" dir="ltr">{b.phone || "â€”"}</bdi>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„ط®ط¯ظ…ط©:")}</span>
                        <span className="bk-mobile-val">
                          {serviceSummaryForTable(b)}
                          <div className="bk-cell-meta">{serviceMetaSummaryForTable(b)}</div>
                        </span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„ظ…ظˆط¸ظپط©:")}</span>
                        <span className="bk-mobile-val">{b.employeeName || "â€”"}</span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„طھط§ط±ظٹط®:")}</span>
                        <bdi className="bk-mobile-val bk-mobile-date-val bk-numeric" dir="ltr">{b.date} {formatTime12(b.time)}</bdi>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„ط­ط§ظ„ط©:")}</span>
                        <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                          {t(statusLabel[safeStatus])}
                        </span>
                      </div>
                      {channelBadge ? (
                        <div className="bk-mobile-row">
                          <span className="bk-mobile-label">{t("ظ†ظˆط¹ ط§ظ„ط­ط¬ط²:")}</span>
                          <span className={`bk-channel-badge${isTemporaryInternal ? " is-temporary" : ""}`}>
                            {t(channelBadge)}
                          </span>
                        </div>
                      ) : null}
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">{t("ط§ظ„ط¯ظپط¹:")}</span>
                        <div className="bk-mobile-val bk-mobile-payment-val">
                          <strong>{t(paymentStatusLabel(payment))}</strong>
                          <span className={`bk-payment-method-chip bk-payment-method-${bookingPaymentMethodFilterValue(b)}`}>
                            {bookingPaymentMethodText(b, language)}
                          </span>
                          <div className="bk-mobile-payment-line">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={`mob_pay_${b.id}_${line.key}`} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{t(line.label)}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value"><BookingMoney value={line.amount} language={language} /></span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="bk-mobile-actions">
                        <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm w-100" onClick={() => setSelectedBooking(b)}>{t("طھظپط§طµظٹظ„")}</button>
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm w-100 bk-print-invoice-btn"
                          onClick={() => void handlePrintBookingInvoice(b)}
                          disabled={printInvoiceBusyId === b.id}
                        >
                          <FontAwesomeIcon icon={faPrint} />
                          {printInvoiceBusyId === b.id ? t("ط¬ط§ط±ظٹ طھط¬ظ‡ظٹط² ط§ظ„ظپط§طھظˆط±ط©...") : t("ط·ط¨ط§ط¹ط© ط§ظ„ظپط§طھظˆط±ط©")}
                        </button>
                        {canEditBooking(b) && (
                          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm w-100" onClick={() => openEditBookingModal(b)}>
                            {t("طھط¹ط¯ظٹظ„")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm w-100 bk-refund-btn"
                          onClick={() => openRefundModal(b)}
                          disabled={!canManageRefund(b) || refundBusyId === b.id}
                        >
                          {refundMapByBookingId[String(b.id || "").trim()] ? t("ط§ظ„ط§ط³طھط±ط¬ط§ط¹ ظ…ط³ط¬ظ„") : t("ط§ط³طھط±ط¬ط§ط¹")}
                        </button>
                        {(uiRole === "owner" || uiRole === "admin") && (
                          <>
                            {uiRole === "owner" && (
                              <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm w-100" onClick={() => handleDeleteBooking(b)}>
                                {t("ط­ط°ظپ ط§ظ„ط­ط¬ط²")}
                              </button>
                            )}
                            <details className={`bk-status-menu bk-status-menu--mobile bk-owner-status-${b.status}`}>
                              <summary>
                                {t(statusLabel[b.status])}
                              </summary>
                              <div className="bk-status-menu__panel" role="menu">
                                {allStatusOptions.map((s) => (
                                  <button
                                    key={`mob_${b.id}_${s}`}
                                    type="button"
                                    className={s === b.status ? "is-active" : ""}
                                    onClick={(event) => {
                                      const details = event.currentTarget.closest("details") as HTMLDetailsElement | null;
                                      details?.removeAttribute("open");
                                      handleUpdateStatus(b.id, s);
                                    }}
                                  >
                                    {t(statusLabel[s])}
                                  </button>
                                ))}
                              </div>
                            </details>
                          </>
                        )}
                        {uiRole === "reception" && b.status === "pending" && (
                          <>
                            <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>
                              {t("طھط£ظƒظٹط¯")}
                            </button>
                            <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>
                              {t("ط¥ظ„ط؛ط§ط،")}
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
                ? t("ظ„ط§ طھظˆط¬ط¯ ظ†طھط§ط¦ط¬ ظ…ط·ط§ط¨ظ‚ط©")
                : `${t("ظ„ط§ طھظˆط¬ط¯")} ${t(section.key === "internal" ? "ط­ط¬ظˆط²ط§طھ ط¯ط§ط®ظ„ظٹط©" : "ط­ط¬ظˆط²ط§طھ ط¹ط§ط¯ظٹط©")} ${t("ط­ط§ظ„ظٹط§ظ‹")}`}
            </strong>
            <p>
              {hasActiveBookingFilters
                ? t("ط؛ظٹظ‘ط± ط§ظ„ط¨ط­ط« ط£ظˆ ط§ظ„ظپظ„ط§طھط± ط§ظ„ط­ط§ظ„ظٹط© ظ„ط¹ط±ط¶ ط­ط¬ظˆط²ط§طھ ظ‡ط°ط§ ط§ظ„ظ‚ط³ظ….")
                : t("ط¹ظ†ط¯ ط¥ط¶ط§ظپط© ط­ط¬ظˆط²ط§طھ ظ„ظ‡ط°ط§ ط§ظ„ظ‚ط³ظ… ط³طھط¸ظ‡ط± ظ‡ظ†ط§ ظ…ط¨ط§ط´ط±ط©.")}
            </p>
            {hasActiveBookingFilters ? (
              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={resetBookingFilters}>
                <FontAwesomeIcon icon={faRotate} /> {t("ط¥ط¹ط§ط¯ط© ط¶ط¨ط· ط§ظ„ظپظ„ط§طھط±")}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  ), [
    allPageSelected,
    canEditBookings,
    canEditBooking,
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
    toggleSectionSelection,
    toggleCurrentPageSelection,
    uiRole,
    unseenNewBookingIds,
    language,
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
      .map(([status, count]) => `${t(statusLabel[status])}: ${count}`)
      .join(" | ");
  }, [bulkTargetBookings, language]);

  const refreshBookingData = useCallback(() => {
    setError("");
    setLoading(true);
    setBookingsRefreshKey((current) => current + 1);
  }, []);

  if (loading) {
    return (
      <main className="dsv2-page bookings-v2-page" dir={language === "en" ? "ltr" : "rtl"}>
        <section className="dsv2-card dsv2-card--padded bookings-v2-loading" role="status">
          <strong>{t("ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ...")}</strong>
          <span>{t("ظٹطھظ… طھط¬ظ‡ظٹط² ظ‚ط§ط¦ظ…ط© ط§ظ„ط­ط¬ظˆط²ط§طھ ظˆط§ظ„ط­ط§ظ„ط§طھ ط§ظ„ظ…ط§ظ„ظٹط©.")}</span>
        </section>
      </main>
    );
  }

  return (
    <main className="dsv2-page bookings-v2-page" dir={language === "en" ? "ltr" : "rtl"} aria-labelledby="bookings-v2-title">
      <div className="bookings-v2-layout">
        <header className="dsv2-card dsv2-card--padded dsv2-card--elevated bookings-v2-hero">
          <div className="bookings-v2-hero__content">
            <span className="dsv2-badge dsv2-badge--gold">{t("طھط´ط؛ظٹظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ")}</span>
            <h1 id="bookings-v2-title" className="dsv2-page-title">{t("ظ…ط±ظƒط² ط¥ط¯ط§ط±ط© ط§ظ„ط­ط¬ظˆط²ط§طھ")}</h1>
            <p className="dsv2-page-subtitle">{t("ظˆط§ط¬ظ‡ط© طھط´ط؛ظٹظ„ ظ…ظˆط­ط¯ط© ظ„ظ…طھط§ط¨ط¹ط© ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¬ط¯ظٹط¯ط©طŒ ط§ظ„ظ…ظˆط§ط¹ظٹط¯طŒ ط§ظ„طھط­طµظٹظ„طŒ ظˆط§ظ„ط¥ط¬ط±ط§ط،ط§طھ ط§ظ„ظٹظˆظ…ظٹط©.")}</p>
          </div>
          <div className="bookings-v2-hero__actions">
            <Link to="/dashboard/booking-internal" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm">
              <FontAwesomeIcon icon={faPlus} />
              {t("ط¥ظ†ط´ط§ط، ط­ط¬ط² ط¬ط¯ظٹط¯")}
            </Link>
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={refreshBookingData}>
              <FontAwesomeIcon icon={faRotate} />
              {t("طھط­ط¯ظٹط«")}
            </button>
            
          </div>
        </header>

        {error ? <div className="bookings-v2-error" role="alert">{error}</div> : null}

        <section className="dsv2-grid--metrics bookings-v2-metrics" aria-label={t("ظ…ظ„ط®طµ ط¹ظ…ظ„ظٹط§طھ ط§ظ„ط­ط¬ظˆط²ط§طھ")}>
          <article className="dsv2-metric-card dsv2-metric-card--gold bookings-v2-metric">
            <span className="dsv2-metric-card__icon bookings-v2-metric__icon"><FontAwesomeIcon icon={faCalendarDay} /></span>
            <div><small className="dsv2-metric-card__label">{t("ط­ط¬ظˆط²ط§طھ ط§ظ„ظٹظˆظ…")}</small><strong className="dsv2-metric-card__value">{bookingOperationsOverview.todayCount}</strong><em className="dsv2-metric-card__meta">{bookingOperationsOverview.today}</em></div>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--success bookings-v2-metric">
            <span className="dsv2-metric-card__icon bookings-v2-metric__icon"><FontAwesomeIcon icon={faCheckCircle} /></span>
            <div><small className="dsv2-metric-card__label">{t("ط§ظ„ظ…ط¤ظƒط¯ ظˆط§ظ„ظ…ظƒطھظ…ظ„ ط§ظ„ظٹظˆظ…")}</small><strong className="dsv2-metric-card__value">{bookingOperationsOverview.todayConfirmed + bookingOperationsOverview.todayCompleted}</strong><em className="dsv2-metric-card__meta">{t("ظ…ط¤ظƒط¯")} {bookingOperationsOverview.todayConfirmed} â€¢ {t("ظ…ظƒطھظ…ظ„")} {bookingOperationsOverview.todayCompleted}</em></div>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--dark bookings-v2-metric">
            <span className="dsv2-metric-card__icon bookings-v2-metric__icon"><FontAwesomeIcon icon={faMoneyBillWave} /></span>
            <div><small className="dsv2-metric-card__label">{t("ط§ظ„ظ…ط­طµظ‘ظ„ ط§ظ„ظٹظˆظ…")}</small><strong className="dsv2-metric-card__value"><BookingMoney value={bookingOperationsOverview.todayCollectedAmount} language={language} /></strong><em className="dsv2-metric-card__meta">{t("ط­ط³ط¨ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ…ط­ظ…ظ‘ظ„ط©")}</em></div>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--danger bookings-v2-metric bookings-v2-metric--alert">
            <span className="dsv2-metric-card__icon bookings-v2-metric__icon"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
            <div><small className="dsv2-metric-card__label">{t("طھط­طھط§ط¬ ظ…طھط§ط¨ط¹ط©")}</small><strong className="dsv2-metric-card__value">{attentionBookingCount}</strong><em className="dsv2-metric-card__meta">{t("ط­ط¬ظˆط²ط§طھ ظ‚ط¯ظٹظ…ط© ط£ظˆ ط؛ظٹط± ظ…ط؛ظ„ظ‚ط©")}</em></div>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--gold bookings-v2-metric">
            <span className="dsv2-metric-card__icon bookings-v2-metric__icon"><FontAwesomeIcon icon={faChartLine} /></span>
            <div><small className="dsv2-metric-card__label">{t("ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…طھط¨ظ‚ظٹ")}</small><strong className="dsv2-metric-card__value"><BookingMoney value={bookingOperationsOverview.totalOutstandingAmount} language={language} /></strong><em className="dsv2-metric-card__meta">{t("ط¹ظ„ظ‰ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ…ظپطھظˆط­ط© ظپظ‚ط·")}</em></div>
          </article>
        </section>

        <section className="bookings-v2-work-grid">
          <article className="dsv2-card dsv2-card--padded bookings-v2-panel bookings-v2-panel--new-queue">
            <div className="dsv2-section-head bookings-v2-panel__head">
              <div>
                <span className="bk-panel-kicker">{t("ط§ظ„ظˆط§ط±ط¯ ط§ظ„ط¬ط¯ظٹط¯")}</span>
                <h2 className="dsv2-section-title">{t("ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¬ط¯ظٹط¯ط©")}</h2>
                <p className="dsv2-section-caption">{t("ط­ط¬ظˆط²ط§طھ ط§ظ„ظٹظˆظ… ظˆط§ظ„ظ…ظˆط§ط¹ظٹط¯ ط§ظ„ظ‚ط§ط¯ظ…ط©طŒ ظ…ط±طھط¨ط© ط­ط³ط¨ ط£ظ‚ط±ط¨ ظ…ظˆط¹ط¯.")}</p>
              </div>
              <span className="bk-panel-count">{unseenNewBookings.length}</span>
            </div>

            {unseenNewPreviewBookings.length ? (
              <div className="bookings-v2-queue-list">
                {unseenNewPreviewBookings.map((booking) => (
                  <button key={`booking_new_${booking.id}`} type="button" onClick={() => setSelectedBooking(booking)}>
                    <span className="bookings-v2-queue-time">
                      <strong>{formatTime12(booking.time)}</strong>
                      <small>{booking.date}</small>
                    </span>
                    <span className="bookings-v2-queue-copy">
                      <strong>{booking.customerName || t("ط¹ظ…ظٹظ„ط© ط؛ظٹط± ظ…ط¹ط±ظˆظپط©")}</strong>
                      <small>{serviceSummaryForTable(booking)} â€¢ {booking.employeeName || t("ط¨ط¯ظˆظ† ظ…ظˆط¸ظپط©")}</small>
                    </span>
                    <span className="bookings-v2-queue-ref"><bdi dir="ltr">{bookingRef(booking)}</bdi></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bookings-v2-empty-state">
                <FontAwesomeIcon icon={faCheckCircle} />
                <strong>{t("ظ„ط§ طھظˆط¬ط¯ ط­ط¬ظˆط²ط§طھ ظ‚ط§ط¯ظ…ط©")}</strong>
                <span>{t("ط³طھط¸ظ‡ط± ظ‡ظ†ط§ ط­ط¬ظˆط²ط§طھ ط§ظ„ظٹظˆظ… ظˆط§ظ„ظ…ظˆط§ط¹ظٹط¯ ط§ظ„ظ…ط³طھظ‚ط¨ظ„ظٹط© ظ…ط¨ط§ط´ط±ط©.")}</span>
              </div>
            )}

            <div className="bookings-v2-panel-actions">
              <button type="button" onClick={() => { resetBookingFilters(); setSortOrder("newest"); }} disabled={!unseenNewBookings.length}>{t("ط¹ط±ط¶ ط§ظ„ط£ط­ط¯ط« ظپظٹ ط§ظ„ظ‚ط§ط¦ظ…ط©")}</button>
              <button type="button" onClick={markNewBookingsSeen} disabled={!unseenNewBookings.length}>{t("طھط­ط¯ظٹط¯ ط§ظ„ظƒظ„ ظƒظ…ظڈط·ظ‘ظ„ط¹ ط¹ظ„ظٹظ‡")}</button>
            </div>
          </article>

          <article className="dsv2-card dsv2-card--padded bookings-v2-panel bookings-v2-panel--attention">
            <div className="dsv2-section-head bookings-v2-panel__head">
              <div>
                <span className="bk-panel-kicker">{t("ظ…ط±ظƒط² ط§ظ„ظ…طھط§ط¨ط¹ط©")}</span>
                <h2 className="dsv2-section-title">{t("ط­ط¬ظˆط²ط§طھ طھط­طھط§ط¬ ط¥ط¬ط±ط§ط،")}</h2>
                <p className="dsv2-section-caption">{t("ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ…طھط£ط®ط±ط© ط£ظˆ ط§ظ„طھظٹ ط¨ظ‚ظٹطھ ط¨ط­ط§ظ„ط© ظ…ظپطھظˆط­ط©.")}</p>
              </div>
              <span className="bk-panel-count is-warning">{attentionBookingCount}</span>
            </div>

            <div className="bookings-v2-attention-stats">
              <button type="button" onClick={() => { setStatusFilter("pending"); setOldPendingFilter("before_today"); }}>
                <span>{t("ظ‚ط¯ظٹظ… ط¨ط§ظ„ط§ظ†طھط¸ط§ط±")}</span><strong>{stalePendingCount}</strong>
              </button>
              <button type="button" onClick={() => { setStatusFilter("confirmed"); setOldPendingFilter("off"); setDatePreset("custom"); setDateFrom(""); setDateTo(shiftISODate(todayISOLocal(), -1)); }}>
                <span>{t("ظ‚ط¯ظٹظ… ظˆظ…ط¤ظƒط¯")}</span><strong>{staleConfirmedCount}</strong>
              </button>
              <button type="button" onClick={() => { setStatusFilter("pending"); setSettlementFilter("partial"); }}>
                <span>{t("ط¹ط±ط¨ظˆظ† ط؛ظٹط± ظ…ط؛ظ„ظ‚")}</span><strong>{expiredPendingDayDepositBookings.length}</strong>
              </button>
              <button type="button" onClick={() => { setStatusFilter("pending"); setSettlementFilter("unpaid"); }}>
                <span>{t("ط¨ط¯ظˆظ† ط¯ظپط¹")}</span><strong>{expiredPendingDayNoPaymentBookings.length}</strong>
              </button>
            </div>

            {stalePreviewBookings.length ? (
              <div className="bookings-v2-attention-list">
                {stalePreviewBookings.slice(0, 4).map((booking) => (
                  <button key={`attention_${booking.id}`} type="button" onClick={() => setSelectedBooking(booking)}>
                    <span className={`status-badge ${booking.status}`}>{t(statusLabel[booking.status])}</span>
                    <span><strong>{booking.customerName || "â€”"}</strong><small>{booking.date} â€¢ {formatTime12(booking.time)}</small></span>
                    <bdi dir="ltr">{bookingRef(booking)}</bdi>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bookings-v2-empty-state is-compact">
                <FontAwesomeIcon icon={faCheckCircle} />
                <strong>{t("ظ„ط§ طھظˆط¬ط¯ ط­ط¬ظˆط²ط§طھ ظ…طھط£ط®ط±ط©")}</strong>
              </div>
            )}
          </article>
        </section>

        <section className="dsv2-card dsv2-card--padded bookings-v2-command" aria-label={t("ط§ظ„ط¨ط­ط« ظˆط§ظ„ظپظ„ط§طھط±")}>
          <div className="dsv2-section-head bookings-v2-command__head">
            <div><span className="dsv2-badge dsv2-badge--gold">{t("ظ…ط³ط§ط­ط© ط§ظ„ط¹ظ…ظ„")}</span><h2 className="dsv2-section-title">{t("ط§ظ„ط¨ط­ط« ظˆط¥ط¯ط§ط±ط© ط§ظ„ظ‚ط§ط¦ظ…ط©")}</h2></div>
            <div className="bk-command-result"><strong>{filteredSorted.length}</strong><span>{t("ظ†طھظٹط¬ط© ظ…ط·ط§ط¨ظ‚ط©")}</span></div>
          </div>

          <div className="bk-command-primary-row">
            <label className="bookings-v2-search">
              <FontAwesomeIcon icon={faSearch} />
              <input
                type="search"
                name="malikat_booking_lookup_no_autofill"
                autoComplete="new-password"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                inputMode="search"
                enterKeyHint="search"
                aria-label={t("ط¨ط­ط« ط§ظ„ط­ط¬ظˆط²ط§طھ")}
                readOnly={!bookingSearchFocused}
                placeholder={t("ط§ط¨ط­ط«ظٹ ط¨ط§ظ„ط§ط³ظ…طŒ ط§ظ„ط¬ظˆط§ظ„طŒ ط±ظ‚ظ… ط§ظ„ط­ط¬ط²طŒ ط§ظ„ط®ط¯ظ…ط© ط£ظˆ ط§ظ„ظ…ظˆط¸ظپط©...")}
                value={q}
                onFocus={(event) => {
                  setBookingSearchFocused(true);

                  if (event.currentTarget.value.includes("@")) {
                    setQ("");
                  }
                }}
                onBlur={() => setBookingSearchFocused(false)}
                onChange={(event) => {
                  const next = event.target.value;

                  if (next.includes("@")) {
                    setQ("");
                    return;
                  }

                  setQ(next);
                }}
              />
              {q ? <button type="button" onClick={() => setQ("")} aria-label={t("ظ…ط³ط­ ط§ظ„ط¨ط­ط«")}><FontAwesomeIcon icon={faXmark} /></button> : null}
            </label>

            
            <BookingSelectField
                language={language}
              label={t("ط§ظ„ظپطھط±ط©")}
              value={datePreset}
              options={[
                { value: "all", label: t("ظƒظ„ ط§ظ„ط­ط¬ظˆط²ط§طھ") },
                { value: "today", label: t("ط§ظ„ظٹظˆظ…") },
                { value: "yesterday", label: t("ط£ظ…ط³") },
                { value: "week", label: t("ظ‡ط°ط§ ط§ظ„ط£ط³ط¨ظˆط¹") },
                { value: "month", label: t("ظ‡ط°ط§ ط§ظ„ط´ظ‡ط±") },
                { value: "last_month", label: t("ط§ظ„ط´ظ‡ط± ط§ظ„ظ…ط§ط¶ظٹ") },
                { value: "custom", label: t("ظ†ط·ط§ظ‚ ظ…ط®طµطµ") },
              ]}
              placeholder={t("ط§ط®طھط§ط±ظٹ ط§ظ„ظپطھط±ط©")}
              onChange={(value) => {
                const next =
                  value as DatePresetOption;

                applyDatePreset(next);

                if (next === "custom") {
                  setAdvancedFiltersOpen(true);
                }
              }}
            />

            <button type="button" className={`bk-advanced-toggle ${advancedFiltersOpen ? "is-open" : ""}`} onClick={() => setAdvancedFiltersOpen((open) => !open)}>
              <FontAwesomeIcon icon={faFilter} />
              {t("ظپظ„ط§طھط± ظ…طھظ‚ط¯ظ…ط©")}
              {activeFilterCount ? <span>{activeFilterCount}</span> : null}
              <FontAwesomeIcon icon={advancedFiltersOpen ? faChevronUp : faChevronDown} />
            </button>

            <button type="button" className="bk-clear-filters" onClick={resetBookingFilters} disabled={!hasActiveBookingFilters}>
              {t("ظ…ط³ط­ ط§ظ„ظپظ„ط§طھط±")}
            </button>
          </div>

          <div className="bk-status-tabs" role="tablist" aria-label={t("ظپظ„طھط±ط© ط­ط§ظ„ط© ط§ظ„ط­ط¬ط²")}>
            {([
              ["all", "ط§ظ„ظƒظ„", statusTabCounts.all],
              ["pending", "ط¨ط§ظ„ط§ظ†طھط¸ط§ط±", statusTabCounts.pending],
              ["confirmed", "ظ…ط¤ظƒط¯", statusTabCounts.confirmed],
              ["completed", "ظ…ظƒطھظ…ظ„", statusTabCounts.completed],
              ["cancelled", "ظ…ظ„ط؛ظٹ", statusTabCounts.cancelled],
            ] as Array<[StatusOption, string, number]>).map(([status, label, count]) => (
              <button key={status} type="button" className={`bk-status-tab ${statusFilter === status ? "is-active" : ""}`} onClick={() => setStatusFilter(status)}>
                {t(label)}<span>{count}</span>
              </button>
            ))}
          </div>


          {advancedFiltersOpen ? (
            <div className="bk-advanced-filters bk-advanced-filters--custom">

              <BookingFilterDateField
                language={language}
                label={t("ظ…ظ† طھط§ط±ظٹط®")}
                value={dateFrom}
                onChange={(value) => {
                  setDatePreset("custom");
                  setDateFrom(value);
                }}
              />

              <BookingFilterDateField
                language={language}
                label={t("ط¥ظ„ظ‰ طھط§ط±ظٹط®")}
                value={dateTo}
                onChange={(value) => {
                  setDatePreset("custom");
                  setDateTo(value);
                }}
              />

              <BookingSelectField
                language={language}
                label={t("ط§ط³طھط«ظ†ط§ط، ط­ط§ظ„ط©")}
                value={excludedStatus}
                options={[
                  {
                    value: "",
                    label: t("ط¨ط¯ظˆظ† ط§ط³طھط«ظ†ط§ط،"),
                  },
                  ...allStatusOptions.map((status) => ({
                    value: status,
                    label:
                      t("ط§ط³طھط«ظ†ط§ط،: ") +
                      t(statusLabel[status]),
                  })),
                ]}
                placeholder={t("ط¨ط¯ظˆظ† ط§ط³طھط«ظ†ط§ط،")}
                disabled={statusFilter !== "all"}
                onChange={(value) =>
                  setExcludedStatus(
                    value as ExcludedStatusOption
                  )
                }
              />

              <BookingSelectField
                language={language}
                label={t("ط­ط§ظ„ط© ط§ظ„ط³ط¯ط§ط¯")}
                value={settlementFilter}
                options={[
                  { value: "all", label: t("ط§ظ„ظƒظ„") },
                  {
                    value: "paid",
                    label: t("ظ…ط¯ظپظˆط¹ ط¨ط§ظ„ظƒط§ظ…ظ„"),
                  },
                  {
                    value: "partial",
                    label: t("ظ…ط¯ظپظˆط¹ ط¬ط²ط¦ظٹظ‹ط§"),
                  },
                  {
                    value: "unpaid",
                    label: t("ط؛ظٹط± ظ…ط¯ظپظˆط¹"),
                  },
                ]}
                placeholder={t("ظƒظ„ ط­ط§ظ„ط§طھ ط§ظ„ط³ط¯ط§ط¯")}
                onChange={(value) =>
                  setSettlementFilter(
                    value as SettlementFilterOption
                  )
                }
              />

              <BookingSelectField
                language={language}
                label={t("ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}
                value={paymentMethodFilter}
                options={[
                  {
                    value: "all",
                    label: t("ظƒظ„ ط§ظ„ط·ط±ظ‚"),
                  },
                  { value: "cash", label: t("ظƒط§ط´") },
                  { value: "card", label: t("ط´ط¨ظƒط©") },
                  {
                    value: "transfer",
                    label: t("طھط­ظˆظٹظ„"),
                  },
                  {
                    value: "mixed",
                    label: t("ط¯ظپط¹ ظ…ط®طھظ„ط·"),
                  },
                  { value: "other", label: t("ط£ط®ط±ظ‰") },
                  {
                    value: "none",
                    label: t("ط¨ط¯ظˆظ† ط¯ظپط¹"),
                  },
                ]}
                placeholder={t("ظƒظ„ ط·ط±ظ‚ ط§ظ„ط¯ظپط¹")}
                onChange={(value) =>
                  setPaymentMethodFilter(
                    value as PaymentMethodFilterOption
                  )
                }
              />

              <BookingSelectField
                language={language}
                label={t("ط§ظ„ظ…ظˆط¸ظپط©")}
                value={employeeFilter}
                options={[
                  {
                    value: "all",
                    label: t("ظƒظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ"),
                  },
                  ...employeeFilterOptions.map(
                    ([value, label]) => ({
                      value,
                      label,
                    })
                  ),
                ]}
                placeholder={t("ظƒظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ")}
                onChange={setEmployeeFilter}
              />

              <BookingSelectField
                language={language}
                label={t("ط§ظ„ط®ط¯ظ…ط©")}
                value={serviceFilter}
                options={[
                  {
                    value: "all",
                    label: t("ظƒظ„ ط§ظ„ط®ط¯ظ…ط§طھ"),
                  },
                  ...serviceFilterOptions.map(
                    ([value, label]) => ({
                      value,
                      label,
                    })
                  ),
                ]}
                placeholder={t("ظƒظ„ ط§ظ„ط®ط¯ظ…ط§طھ")}
                onChange={setServiceFilter}
              />

              <BookingSelectField
                language={language}
                label={t("ظ…طµط¯ط± ط§ظ„ط­ط¬ط²")}
                value={sourceFilter}
                options={[
                  {
                    value: "all",
                    label: t("ظƒظ„ ط§ظ„ظ…طµط§ط¯ط±"),
                  },
                  {
                    value: "client",
                    label: t("ظ…ظˆظ‚ط¹ ط§ظ„ط¹ظ…ظٹظ„ط§طھ"),
                  },
                  {
                    value: "dashboard",
                    label: t("ط§ظ„ط¯ط§ط´ط¨ظˆط±ط¯"),
                  },
                  {
                    value: "internal",
                    label: t("ط§ظ„ط­ط¬ط² ط§ظ„ط¯ط§ط®ظ„ظٹ"),
                  },
                  {
                    value: "unknown",
                    label: t("ط؛ظٹط± ظ…ط­ط¯ط¯"),
                  },
                ]}
                placeholder={t("ظƒظ„ ط§ظ„ظ…طµط§ط¯ط±")}
                onChange={(value) =>
                  setSourceFilter(
                    value as BookingSourceFilterOption
                  )
                }
              />

              <BookingSelectField
                language={language}
                label={t("ط§ظ„طھط±طھظٹط¨")}
                value={sortOrder}
                options={[
                  {
                    value: "newest",
                    label: t("ط§ظ„ط£ط­ط¯ط« ط£ظˆظ„ظ‹ط§"),
                  },
                  {
                    value: "oldest",
                    label: t("ط§ظ„ط£ظ‚ط¯ظ… ط£ظˆظ„ظ‹ط§"),
                  },
                ]}
                placeholder={t("ط§ط®طھط§ط±ظٹ ط§ظ„طھط±طھظٹط¨")}
                onChange={(value) =>
                  setSortOrder(
                    value as SortOrderOption
                  )
                }
              />

              <BookingSelectField
                language={language}
                label={t("ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ‚ط¯ظٹظ…ط©")}
                value={oldPendingFilter}
                options={[
                  {
                    value: "off",
                    label: t("ط¨ط¯ظˆظ† ظپظ„طھط±"),
                  },
                  {
                    value: "before_today",
                    label: t("ط§ظ„ط£ظ‚ط¯ظ… ظ…ظ† ط§ظ„ظٹظˆظ…"),
                  },
                  {
                    value: "older_7",
                    label: t("ط§ظ„ط£ظ‚ط¯ظ… ظ…ظ† 7 ط£ظٹط§ظ…"),
                  },
                  {
                    value: "older_30",
                    label: t("ط§ظ„ط£ظ‚ط¯ظ… ظ…ظ† 30 ظٹظˆظ…ظ‹ط§"),
                  },
                  {
                    value: "custom",
                    label: t("ظ†ط·ط§ظ‚ ظ…ط®طµطµ"),
                  },
                ]}
                placeholder={t("ط¨ط¯ظˆظ† ظپظ„طھط±")}
                onChange={(value) =>
                  setOldPendingFilter(
                    value as OldPendingFilterOption
                  )
                }
              />

              {oldPendingFilter === "custom" ? (
                <>
                  <BookingFilterDateField
                language={language}
                    label={t("ظ‚ط¯ظٹظ… ظ…ظ†")}
                    value={oldPendingFrom}
                    onChange={setOldPendingFrom}
                  />

                  <BookingFilterDateField
                language={language}
                    label={t("ظ‚ط¯ظٹظ… ط¥ظ„ظ‰")}
                    value={oldPendingTo}
                    onChange={setOldPendingTo}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          <div className="bk-command-footer" role="status">
            <div className="bk-result-summary">
              <span>{t("ط§ظ„ظ…ط­ظ…ظ‘ظ„")}<strong>{bookings.length}</strong></span>
              <span>{t("ط§ظ„ظ…ط·ط§ط¨ظ‚")}<strong>{filteredSorted.length}</strong></span>
              <span>{t("ط§ظ„ظ…ط¹ط±ظˆط¶")}<strong>{pagedBookings.length}</strong></span>
              <span>{t("ط§ظ„طµظپط­ط©")}<strong>{currentPage} / {totalPages}</strong></span>
            </div>
            <div className="bk-total-remaining">{t("ط§ظ„ظ…طھط¨ظ‚ظٹ ط¶ظ…ظ† ط§ظ„ظ†طھط§ط¦ط¬")}<strong><BookingMoney value={totalRemainingAmount} language={language} /></strong></div>
          </div>
        </section>

        {selectedBookingIds.size || bulkResultMessage || bulkError ? (
          <section className="dsv2-card dsv2-card--padded bookings-v2-bulk-toolbar">
            <div className="bk-bulk-summary"><strong>{selectedBookingIds.size}</strong><span>{t("ط­ط¬ط² ظ…ط­ط¯ط¯")}</span><small>{selectedMatchingCount} {t("ط¶ظ…ظ† ط§ظ„ظ†طھط§ط¦ط¬ ط§ظ„ط­ط§ظ„ظٹط©")}</small></div>
            <div className="bk-bulk-actions">
              <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={toggleCurrentPageSelection} disabled={!pageBookingIds.length}>{allPageSelected ? t("ط¥ظ„ط؛ط§ط، طھط­ط¯ظٹط¯ ط§ظ„طµظپط­ط©") : t("طھط­ط¯ظٹط¯ ط§ظ„طµظپط­ط©")}</button>
              <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={selectAllMatchingBookings} disabled={!filteredBookingIds.length}>{t("طھط­ط¯ظٹط¯ ظƒظ„ ط§ظ„ظ†طھط§ط¦ط¬")}</button>
              <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={clearSelectedBookings} disabled={!selectedBookingIds.size}>{t("ط¥ظ„ط؛ط§ط، ط§ظ„طھط­ط¯ظٹط¯")}</button>
              <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => openBulkStatusModal("completed")} disabled={!selectedBookingIds.size}>{t("ظ…ظƒطھظ…ظ„")}</button>
              <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => openBulkStatusModal("confirmed")} disabled={!selectedBookingIds.size}>{t("ظ…ط¤ظƒط¯")}</button>
              <button type="button" className="dsv2-btn dsv2-btn--danger" onClick={() => openBulkStatusModal("cancelled")} disabled={!selectedBookingIds.size}>{t("ظ…ظ„ط؛ظٹ")}</button>
            </div>
            {bulkResultMessage ? <div className="bk-bulk-result">{bulkResultMessage}</div> : null}
            {bulkError ? <div className="bk-bulk-error">{bulkError}</div> : null}
          </section>
        ) : null}

        <div className="bookings-v2-sections">
          {bookingSectionsView}
        </div>

        <nav className="dsv2-card bookings-v2-pagination-bar" aria-label={t("ط§ظ„طھظ†ظ‚ظ„ ط¨ظٹظ† طµظپط­ط§طھ ط§ظ„ط­ط¬ظˆط²ط§طھ")}>
          <div className="bk-pagination-count">
            {t("ط¹ط±ط¶")} {pagedBookings.length ? (currentPage - 1) * pageSize + 1 : 0} - {Math.min(currentPage * pageSize, filteredSorted.length)} {t("ظ…ظ†")} {filteredSorted.length}
          </div>
          <div className="bk-pagination-controls">
            <div className="bk-page-size-control">
              <span>{t("ظ„ظƒظ„ طµظپط­ط©")}</span>
              <details className="bk-page-size-menu">
                <summary aria-label={`${t("ط¹ط¯ط¯ ط§ظ„ط­ط¬ظˆط²ط§طھ ظپظٹ ط§ظ„طµظپط­ط©")}: ${pageSize}`}>{pageSize}</summary>
                <div className="bk-page-size-menu__panel" role="menu">
                  {pageSizeOptions.map((size) => (
                    <button
                      key={`page_size_${size}`}
                      type="button"
                      className={size === pageSize ? "is-active" : ""}
                      onClick={(event) => {
                        const details = event.currentTarget.closest("details") as HTMLDetailsElement | null;
                        details?.removeAttribute("open");
                        setPageSize(size);
                      }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setCurrentPage(1)} disabled={currentPage <= 1}>{t("ط§ظ„ط£ظˆظ„ظ‰")}</button>
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1}>{t("ط§ظ„ط³ط§ط¨ظ‚")}</button>
            <span className="bk-page-number">{currentPage} / {totalPages}</span>
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages}>{t("ط§ظ„طھط§ظ„ظٹ")}</button>
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages}>{t("ط§ظ„ط£ط®ظٹط±ط©")}</button>
          </div>
        </nav>

        {selectedBooking && (
          <Modal
            open={!!selectedBooking}
            onClose={closeBookingModal}
            ariaLabel={t("طھظپط§طµظٹظ„ ط§ظ„ط­ط¬ط²")}
            overlayClassName="bookings-v2-modal-overlay"
            panelClassName={`bookings-v2-modal-panel bk-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
            size="lg"
          >
            <div className="modal-head">
              <b>{t("طھظپط§طµظٹظ„ ط§ظ„ط­ط¬ط²")} #{bookingRef(selectedBooking)}</b>
              <button className="dsv2-btn dsv2-btn--secondary" onClick={closeBookingModal}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="modal-body">
              <div className="bk-booking-sheet">
                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>{t("ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط¬ط²")}</h4>
                      <span>{t("ظ†ظپط³ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط§ظ„ظٹط© ظ…ط¹ طھط±طھظٹط¨ ط£ظˆط¶ط­ ظˆظ…ط³ط§ظپط§طھ ط£ظ†ط¸ظپ ط¨ظٹظ† ط§ظ„ط¨ط·ط§ظ‚ط§طھ.")}</span>
                    </div>
                  </div>

                  <div className="bk-details-grid">
                    <div className="bk-item bk-item--hero">
                      <span className="bk-item-label">{t("ط±ظ‚ظ… ط§ظ„ط­ط¬ط²")}</span>
                      <span className="bk-item-val">{bookingRef(selectedBooking)}</span>
                      <div className="bk-item-chip-row">
                        <span className="bk-created-badge">
                          {t("طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط­ط¬ط²")}: {bookingFormattedDateTimeText(bookingCreationRefMs(selectedBooking), language)}
                        </span>
                        {lastUpdateMap[selectedBooking.id]?.at ? (
                          <span className="bk-created-badge is-muted">
                            {t("ط¢ط®ط± طھط­ط¯ظٹط«")}: {bookingDateTimeLabelText(lastUpdateMap[selectedBooking.id]?.at, language)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ط³ظ… ط§ظ„ط²ط¨ظˆظ†")}</span>
                      <span className="bk-item-val">{selectedBooking.customerName || "â€”"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ")}</span>
                      <span className="bk-item-val">{selectedBooking.phone || "â€”"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ظ†ظ‚ط§ط· ط§ظ„ط¹ظ…ظٹظ„ط©")}</span>
                      <span className="bk-item-val">
                        {clientLoyaltyLoading ? "..." : `${clientLoyalty?.points ?? 0} ${t("ظ†ظ‚ط·ط©")}`}
                      </span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ظˆظ„ط§ط، ط§ظ„ط¹ظ…ظٹظ„ط©")}</span>
                      <span className="bk-item-val">
                        {clientLoyaltyLoading
                          ? "..."
                          : `${clientLoyalty?.loyaltyScore ?? 0}${clientLoyalty?.isVip ? " â€¢ VIP" : ""}`}
                      </span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„ظ…طµط¯ط±")}</span>
                      <span className="bk-item-val">{t(channelLabel(selectedBooking.channel))}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„طھط§ط±ظٹط®")}</span>
                      <span className="bk-item-val">{selectedBooking.date}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„ظˆظ‚طھ")}</span>
                      <span className="bk-item-val">{bookingClockText(selectedBooking.time, language)}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„ظ…ظˆط¸ظپط©")}</span>
                      <span className="bk-item-val">{selectedBooking.employeeName || "â€”"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ظ…ط¯ط© ط§ظ„ط®ط¯ظ…ط©")}</span>
                      <span className="bk-item-val">
                        {Number(selectedBooking.durationMin || 0) > 0
                          ? `${selectedBooking.durationMin} ${t("ط¯ظ‚ظٹظ‚ط©")}`
                          : "â€”"}
                      </span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„ط³ط¹ط± ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ")}</span>
                      <span className="bk-item-val">{selectedBookingPayment.totalAmount} {language === "en" ? "SAR" : "ط±.ط³"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ظ†ظˆط¹ ط§ظ„ط¯ظپط¹")}</span>
                      <span className="bk-item-val">{t(paymentStatusLabel(selectedBookingPayment))}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}</span>
                      <span className="bk-item-val">{bookingPaymentMethodText(selectedBooking, language)}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„ظ…ط¯ظپظˆط¹")}</span>
                      <span className="bk-item-val">{selectedBookingPayment.paidAmount} {language === "en" ? "SAR" : "ط±.ط³"}</span>
                    </div>
                    <div className="bk-item">
                      <span className="bk-item-label">{t("ط§ظ„ظ…طھط¨ظ‚ظٹ")}</span>
                      <span className="bk-item-val">{selectedBookingPayment.remainingAmount} {language === "en" ? "SAR" : "ط±.ط³"}</span>
                    </div>
                    <div className="bk-item bk-item--wide">
                      <span className="bk-item-label">{t("ط§ظ„ط­ط§ظ„ط©")}</span>
                      <span className="bk-item-val">
                        <span
                          className={`status-badge ${selectedBooking.status}${selectedBookingIsPendingDeposit ? " pending-deposit" : ""}`}
                        >
                          {t(statusLabel[selectedBooking.status])}
                        </span>
                      </span>
                    </div>
                  </div>
                </section>

                <section className="bk-booking-section bk-booking-section--timeline">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>{t("ط³ط¬ظ„ ط§ظ„ط­ط¬ط²")}</h4>
                      <span>{t("طھط³ظ„ط³ظ„ ط§ظ„ط£ط­ط¯ط§ط« ظ„ظ„ط­ط¬ط² ظ…ظ† ط§ظ„ط£ط­ط¯ط« ط¥ظ„ظ‰ ط§ظ„ط£ظ‚ط¯ظ….")}</span>
                    </div>
                  </div>

                  {selectedBookingActivityLoading ? (
                    <div className="bk-activity-empty">{t("ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط³ط¬ظ„ ط§ظ„ط­ط¬ط²...")}</div>
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
                                <strong>{bookingActivityDisplayText(event.title, language)}</strong>
                                <div className="bk-activity-meta">
                                  <span className={`bk-activity-kind bk-activity-kind--${event.actorKind}`}>
                                    {bookingActivityDisplayText(event.actorKindLabel, language)}
                                  </span>
                                  <span>
                                    <span className="bk-activity-meta-label">{t("ط¨ظˆط§ط³ط·ط©:")}</span>{" "}
                                    {bookingActivityDisplayText(event.actorName, language)}
                                  </span>
                                </div>
                              </div>

                              <div className="bk-activity-time">{bookingDateTimeLabelText(event.atLabel, language)}</div>
                            </div>

                            {event.changes.length ? (
                              <div className="bk-activity-changes">
                                <div className="bk-activity-changes__head">
                                  <span>{t("طھظپط§طµظٹظ„ ط§ظ„ط¹ظ…ظ„ظٹط©")}</span>
                                  <b>{event.changes.length}</b>
                                </div>

                                <div className="bk-activity-changes__grid">
                                  {event.changes.map((change, index) => (
                                    <div
                                      key={`${event.id}_change_${index}`}
                                      className="bk-activity-change"
                                    >
                                      <span className="bk-activity-change__index">
                                        {index + 1}
                                      </span>

                                      <span className="bk-activity-change__text">
                                        {bookingActivityDisplayText(change, language)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {event.note ? (
                              <div className="bk-activity-note">{bookingActivityDisplayText(event.note, language)}</div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bk-activity-empty">
                      {selectedBookingActivityError
                        ? bookingActivityDisplayText(selectedBookingActivityError, language)
                        : t("ظ„ط§ طھظˆط¬ط¯ ط£ط­ط¯ط§ط« ظ…ط³ط¬ظ„ط© ظ„ظ‡ط°ط§ ط§ظ„ط­ط¬ط² ط­طھظ‰ ط§ظ„ط¢ظ†.")}
                    </div>
                  )}

                  {selectedBookingActivityError && selectedBookingActivity.length > 0 ? (
                    <div className="bk-activity-note">{bookingActivityDisplayText(selectedBookingActivityError, language)}</div>
                  ) : null}
                </section>

                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>{t("ط§ظ„ط®ط¯ظ…ط§طھ ط¯ط§ط®ظ„ ط§ظ„ط­ط¬ط²")}</h4>
                    </div>
                  </div>
                  <div className="bk-services-list">
                    {(selectedBooking.services && selectedBooking.services.length > 0
                      ? selectedBooking.services
                      : [{ serviceName: selectedBooking.serviceName, serviceId: selectedBooking.serviceId }]
                    ).map((s, idx) => {
                      const serviceEmployeeName = String(
                        (s as any).employeeName ||
                        selectedBooking.employeeName ||
                        ""
                      ).trim();

                      const serviceMeta = [
                        language === "en"
                          ? translateBookingCatalogLabel(
                              language,
                              String(s.sectionLabel || ""),
                              "section"
                            )
                          : toArabicOnlyLabel(
                              String(s.sectionLabel || ""),
                              ""
                            ),
                        language === "en"
                          ? translateBookingCatalogLabel(
                              language,
                              String(s.categoryLabel || ""),
                              "category"
                            )
                          : toArabicOnlyLabel(
                              String(s.categoryLabel || ""),
                              ""
                            ),
                      ]
                        .filter(Boolean)
                        .join(" â€¢ ");

                      const serviceDuration = Number(s.durationMin || 0);
                      const servicePrice = Number(s.price || 0);

                      return (
                        <article
                          key={`modern_${selectedBooking.id}_svc_${idx}`}
                          className="bk-service-row bk-service-row--modern"
                        >
                          <div className="bk-service-row__main">
                            <span className="bk-service-row__eyebrow">
                              {t("ط§ظ„ط®ط¯ظ…ط©")}
                            </span>

                            <strong className="bk-service-row__name">
                              {language === "en"
                                ? translateBookingCatalogLabel(
                                    language,
                                    String(
                                      s.serviceName ||
                                      s.serviceId ||
                                      ""
                                    ),
                                    "service"
                                  )
                                : toArabicOnlyLabel(
                                    String(
                                      s.serviceName ||
                                      s.serviceId ||
                                      ""
                                    ),
                                    t("ط®ط¯ظ…ط©")
                                  )}
                            </strong>

                            {serviceMeta ? (
                              <div className="bk-service-row__meta">
                                {serviceMeta}
                              </div>
                            ) : null}
                          </div>

                          <div className="bk-service-row__facts">
                            {serviceEmployeeName ? (
                              <span className="bk-service-fact">
                                <small>{t("ط§ظ„ظ…ظˆط¸ظپط©")}</small>
                                <b>{serviceEmployeeName}</b>
                              </span>
                            ) : null}

                            {serviceDuration > 0 ? (
                              <span className="bk-service-fact">
                                <small>{t("ط§ظ„ظ…ط¯ط©")}</small>
                                <b>{serviceDuration} {t("ط¯ظ‚ظٹظ‚ط©")}</b>
                              </span>
                            ) : null}

                            {servicePrice > 0 ? (
                              <span className="bk-service-fact">
                                <small>{t("ط§ظ„ط³ط¹ط±")}</small>
                                <b>{servicePrice} {language === "en" ? "SAR" : "ط±.ط³"}</b>
                              </span>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="bk-booking-section">
                  <div className="bk-booking-section-head">
                    <div>
                      <h4>{t("ظ…ظ„ط§ط­ط¸ط§طھ ط³ط§ط¨ظ‚ط© ط¹ظ„ظ‰ ط§ظ„ط¹ظ…ظٹظ„ط©")}</h4>
                    </div>
                  </div>
                  {previousClientNotes.length === 0 ? (
                    <div className="bk-events-empty">{t("ظ„ط§ طھظˆط¬ط¯ ظ…ظ„ط§ط­ط¸ط§طھ ط³ط§ط¨ظ‚ط© ظ„ظ‡ط°ظ‡ ط§ظ„ط¹ظ…ظٹظ„ط©.")}</div>
                  ) : (
                    <div className="bk-events-list">
                      {previousClientNotes.map((n) => (
                        <div key={`modern_${n.id}`} className="bk-event-row">
                          <div className="bk-event-top">
                            <strong>#{n.ref}</strong>
                            <span>{n.date} {bookingClockText(n.time, language)}</span>
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
                      <h4>{t("ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ط¥ط¯ط§ط±ط© (ط®ط§طµط©)")}</h4>
                    </div>
                  </div>
                  <textarea
                    className="bk-input bk-booking-note-input"
                    rows={3}
                    placeholder={t("ط£ط¶ظپ ظ…ظ„ط§ط­ط¸ط§طھ ظ‡ظ†ط§...")}
                    value={noteDrafts[selectedBooking.id] ?? selectedBooking.adminNote ?? ""}
                    onChange={(e) => updateNote(selectedBooking.id, e.target.value)}
                    disabled={savingNoteId === selectedBooking.id}
                  />
                  <div className="bk-note-actions">
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--primary"
                      onClick={() => saveNote(selectedBooking.id)}
                      disabled={savingNoteId === selectedBooking.id}
                    >
                      {t("ط­ظپط¸ ط§ظ„ظ…ظ„ط§ط­ط¸ط©")}
                    </button>
                    {savedNoteId === selectedBooking.id ? (
                      <span className="bk-note-saved">{t("طھظ… ط§ظ„ط­ظپط¸")}</span>
                    ) : null}
                  </div>
                </section>
              </div>
              <div className="bk-booking-legacy-hide" aria-hidden="true">
              <div className="bk-details-grid">
                <div className="bk-item">
                  <span className="bk-item-label">ط±ظ‚ظ… ط§ظ„ط­ط¬ط²</span>
                  <span className="bk-item-val">{bookingRef(selectedBooking)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ط³ظ… ط§ظ„ط²ط¨ظˆظ†</span>
                  <span className="bk-item-val">{selectedBooking.customerName || "â€”"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ</span>
                  <span className="bk-item-val">{selectedBooking.phone || "â€”"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ظ†ظ‚ط§ط· ط§ظ„ط¹ظ…ظٹظ„ط©</span>
                  <span className="bk-item-val">
                    {clientLoyaltyLoading ? "..." : `${clientLoyalty?.points ?? 0} ظ†ظ‚ط·ط©`}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ظˆظ„ط§ط، ط§ظ„ط¹ظ…ظٹظ„ط©</span>
                  <span className="bk-item-val">
                    {clientLoyaltyLoading
                      ? "..."
                      : `${clientLoyalty?.loyaltyScore ?? 0}${(clientLoyalty?.isVip ? " â€¢ VIP" : "")}`}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ظ…طµط¯ط±</span>
                  <span className="bk-item-val">{channelLabel(selectedBooking.channel)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„طھط§ط±ظٹط®</span>
                  <span className="bk-item-val">{selectedBooking.date}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ظˆظ‚طھ</span>
                  <span className="bk-item-val">{formatTime12(selectedBooking.time)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ظ…ظˆط¸ظپط©</span>
                  <span className="bk-item-val">{selectedBooking.employeeName || "â€”"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ظ…ط¯ط© ط§ظ„ط®ط¯ظ…ط©</span>
                  <span className="bk-item-val">
                    {Number(selectedBooking.durationMin || 0) > 0
                      ? `${selectedBooking.durationMin} ط¯ظ‚ظٹظ‚ط©`
                      : "â€”"}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ط³ط¹ط± ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</span>
                  <span className="bk-item-val">{selectedBookingPayment.totalAmount} ط±.ط³</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ظ†ظˆط¹ ط§ظ„ط¯ظپط¹</span>
                  <span className="bk-item-val">
                    {paymentStatusLabel(selectedBookingPayment)}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ظ…ط¯ظپظˆط¹</span>
                  <span className="bk-item-val">{selectedBookingPayment.paidAmount} ط±.ط³</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ظ…طھط¨ظ‚ظٹ</span>
                  <span className="bk-item-val">{selectedBookingPayment.remainingAmount} ط±.ط³</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ط§ظ„ط­ط§ظ„ط©</span>
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
                <label className="bk-item-label">ط§ظ„ط®ط¯ظ…ط§طھ ط¯ط§ط®ظ„ ط§ظ„ط­ط¬ط²</label>
                <div className="bk-services-list">
                  {(selectedBooking.services && selectedBooking.services.length > 0
                    ? selectedBooking.services
                    : [{ serviceName: selectedBooking.serviceName, serviceId: selectedBooking.serviceId }]
                  ).map((s, idx) => (
                    <div key={`${selectedBooking.id}_svc_${idx}`} className="bk-service-row">
                      <span>
                        {toArabicOnlyLabel(String(s.serviceName || s.serviceId || ""), "ط®ط¯ظ…ط©")}
                        <div className="bk-cell-meta">
                          {toArabicOnlyLabel(String(s.sectionLabel || ""), "â€”")} â€¢ {toArabicOnlyLabel(String(s.categoryLabel || ""), "â€”")}
                        </div>
                      </span>
                      <span>
                        {Number(s.durationMin || 0) > 0 ? `${s.durationMin} ط¯` : "â€”"} آ· {Number(s.price || 0) > 0 ? `${s.price} ط±.ط³` : "â€”"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">ظ…ظ„ط§ط­ط¸ط§طھ ط³ط§ط¨ظ‚ط© ط¹ظ„ظ‰ ط§ظ„ط¹ظ…ظٹظ„ط©</label>
                {previousClientNotes.length === 0 ? (
                  <div className="bk-events-empty">ظ„ط§ طھظˆط¬ط¯ ظ…ظ„ط§ط­ط¸ط§طھ ط³ط§ط¨ظ‚ط© ظ„ظ‡ط°ظ‡ ط§ظ„ط¹ظ…ظٹظ„ط©.</div>
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
                <label className="bk-item-label">ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ط¥ط¯ط§ط±ط© (ط®ط§طµط©)</label>
                <textarea 
                  className="bk-input" 
                  rows={3} 
                  placeholder="ط£ط¶ظپ ظ…ظ„ط§ط­ط¸ط§طھ ظ‡ظ†ط§..."
                  value={noteDrafts[selectedBooking.id] ?? selectedBooking.adminNote ?? ""}
                  onChange={e => updateNote(selectedBooking.id, e.target.value)}
                  disabled={savingNoteId === selectedBooking.id}
                />
                <div className="bk-note-actions">
                  <button
                    type="button"
                    className="dsv2-btn dsv2-btn--primary"
                    onClick={() => saveNote(selectedBooking.id)}
                      disabled={savingNoteId === selectedBooking.id}
                  >
                    ط­ظپط¸ ط§ظ„ظ…ظ„ط§ط­ط¸ط©
                  </button>
                  {savedNoteId === selectedBooking.id ? (
                    <span className="bk-note-saved">طھظ… ط§ظ„ط­ظپط¸</span>
                  ) : null}
                </div>
              </div>
            </div>
              </div>
            <div className="modal-foot">
              {canManageRefund(selectedBooking) && (
                <button className="dsv2-btn dsv2-btn--secondary" onClick={() => openRefundModal(selectedBooking)}>
                  {refundMapByBookingId[String(selectedBooking.id || "").trim()]
                    ? t("ط¥ط¯ط§ط±ط© ط§ظ„ط§ط³طھط±ط¬ط§ط¹")
                    : t("طھط³ط¬ظٹظ„ ط§ط³طھط±ط¬ط§ط¹")}
                </button>
              )}
              {canEditBooking(selectedBooking) && (
                <button className="dsv2-btn dsv2-btn--secondary" onClick={() => openEditBookingModal(selectedBooking)}>
                  {t("طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط²")}
                </button>
              )}
              {uiRole === "owner" && (
                <button className="dsv2-btn dsv2-btn--danger" onClick={() => handleDeleteBooking(selectedBooking)}>
                  {t("ط­ط°ظپ ط§ظ„ط­ط¬ط²")}
                </button>
              )}
              <button className="dsv2-btn dsv2-btn--primary bk-close-btn" onClick={closeBookingModal}>{t("ط¥ط؛ظ„ط§ظ‚")}</button>
            </div>
          </Modal>
        )}

        {pendingSensitiveAction ? (
          <ActionPinModal
            language={language}
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
          ariaLabel="ط§ظ„طھط­ظ‚ظ‚ ط¨ط§ظ„ط±ظ‚ظ… ط§ظ„ط³ط±ظٹ"
          panelClassName="bk-cancel-modal bk-action-pin-modal"
          size="sm"
        >
          <div className="bk-cancel-head">طھط£ظƒظٹط¯ ط§ظ„ط¥ط¬ط±ط§ط،</div>
          <div className="bk-cancel-body">
            <div className="bk-action-pin-summary">
              <div className="bk-action-pin-summary-label">ط§ظ„ط¥ط¬ط±ط§ط، ط§ظ„ظ…ط·ظ„ظˆط¨</div>
              <div className="bk-action-pin-summary-value">
                {sensitiveActionDescription(pendingSensitiveAction) || "ط¥ط¬ط±ط§ط، ط­ط³ط§ط³"}
              </div>
              {pendingSensitiveAction?.kind === "delete" ? (
                <div className="bk-action-pin-warning">ط³ظٹط®طھظپظٹ ط§ظ„ط­ط¬ط² ظ…ظ† طµظپط­ط© ط§ظ„ط­ط¬ظˆط²ط§طھ ظ…ط¹ ط§ظ„ط§ط­طھظپط§ط¸ ط¨ط§ظ„ط³ط¬ظ„ط§طھ ط§ظ„ظ…ط§ظ„ظٹط©.</div>
              ) : null}
            </div>
            <div className="bk-action-pin-form">
              <label className="bk-action-pin-label" htmlFor="booking_action_pin_input">
                ط§ظ„ط±ظ‚ظ… ط§ظ„ط³ط±ظٹ
              </label>
              <input
                id="booking_action_pin_input"
                type="password"
                className="bk-input bk-action-pin-input"
                value={actionPin}
                onChange={(e) => setActionPin(e.target.value)}
                placeholder="ط£ط¯ط®ظ„ظٹ ط§ظ„ط±ظ‚ظ… ط§ظ„ط³ط±ظٹ"
                autoComplete="new-password"
                name="booking_action_pin"
                inputMode="numeric"
                disabled={actionPinBusy}
                autoFocus
              />
              <div className="bk-action-pin-hint">ظ‡ط°ط§ ط§ظ„طھط­ظ‚ظ‚ ظ…ط®طµطµ ظ„ط­ظ…ط§ظٹط© ط§ظ„طھط¹ط¯ظٹظ„ط§طھ ط§ظ„ط­ط³ط§ط³ط©.</div>
            </div>
            {actionPinError ? (
              <div className="bk-action-pin-error">{actionPinError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={closeActionPinModal}
              disabled={actionPinBusy}
            >
              ط¥ظ„ط؛ط§ط،
            </button>
            <button
              type="button"
              className={`dsv2-btn ${pendingSensitiveAction?.kind === "delete" ? "dsv2-btn--danger" : "dsv2-btn--primary"}`}
              onClick={confirmSensitiveAction}
              disabled={actionPinBusy}
            >
              {actionPinBusy ? "ط¬ط§ط±ظٹ ط§ظ„طھط­ظ‚ظ‚..." : "ظ…طھط§ط¨ط¹ط©"}
            </button>
          </div>
        </Modal>
        */}

        <Modal
          open={!!bulkTargetStatus}
          onClose={closeBulkStatusModal}
          ariaLabel={t("طھط£ظƒظٹط¯ ط§ظ„ط¥ط¬ط±ط§ط، ط§ظ„ط¬ظ…ط§ط¹ظٹ ظ„ظ„ط­ط¬ظˆط²ط§طھ")}
          overlayClassName="bookings-v2-modal-overlay"
          panelClassName={`bookings-v2-modal-panel bk-cancel-modal bk-bulk-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
          size="sm"
        >
          <div className="bk-cancel-head">{t("طھط£ظƒظٹط¯ ط§ظ„ط¥ط¬ط±ط§ط، ط§ظ„ط¬ظ…ط§ط¹ظٹ")}</div>
          <div className="bk-cancel-body">
            <div className="bk-bulk-confirm-list">
              <div>
                <span>{t("ط¹ط¯ط¯ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„طھظٹ ط³طھطھط؛ظٹط±")}</span>
                <strong>{bulkTargetBookings.length}</strong>
              </div>
              <div>
                <span>{t("ط§ظ„ط­ط§ظ„ط© ط§ظ„ط­ط§ظ„ظٹط©")}</span>
                <strong>{bulkCurrentStatusSummary || t("ط؛ظٹط± ظ…ط­ط¯ط¯")}</strong>
              </div>
              <div>
                <span>{t("ط§ظ„ط­ط§ظ„ط© ط§ظ„ط¬ط¯ظٹط¯ط©")}</span>
                <strong>{bulkTargetStatus ? t(statusLabel[bulkTargetStatus]) : t("ط؛ظٹط± ظ…ط­ط¯ط¯")}</strong>
              </div>
              <div>
                <span>{t("ط§ظ„طھط§ط±ظٹط®/ط§ظ„ظپظ„ط§طھط± ط§ظ„ظ…ط³طھط®ط¯ظ…ط©")}</span>
                <strong>{filterSummaryText || t("ط¨ط¯ظˆظ† ظپظ„ط§طھط±")}</strong>
              </div>
            </div>
            <div className="bk-action-pin-warning">
              {t("طھظ†ط¨ظٹظ‡: ظ‡ط°ط§ ط§ظ„ط¥ط¬ط±ط§ط، ط³ظٹط¤ط«ط± ظپظٹ ط¹ط¯ط© ط­ط¬ظˆط²ط§طھ ظ…ط­ط¯ط¯ط© ظپظ‚ط·. ظ„ظ† ظٹطھظ… طھط¹ط¯ظٹظ„ ط£ظٹ ط­ط¬ط² ط؛ظٹط± ظ…ط­ط¯ط¯.")}
            </div>
            {bulkError ? <div className="bk-action-pin-error">{bulkError}</div> : null}
          </div>
          <div className="bk-cancel-foot">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeBulkStatusModal} disabled={bulkSaving}>
              {t("ط±ط¬ظˆط¹")}
            </button>
            <button
              type="button"
              className={`dsv2-btn ${bulkTargetStatus === "cancelled" ? "dsv2-btn--danger" : "dsv2-btn--primary"}`}
              onClick={() => void confirmBulkStatusUpdate()}
              disabled={bulkSaving || !bulkTargetBookings.length}
            >
              {bulkSaving ? t("ط¬ط§ط±ظٹ ط§ظ„طھط­ط¯ظٹط«...") : t("طھط£ظƒظٹط¯ ط§ظ„طھط­ط¯ظٹط« ط§ظ„ط¬ظ…ط§ط¹ظٹ")}
            </button>
          </div>
        </Modal>

        <Modal
          open={!!refundTarget}
          onClose={closeRefundModal}
          ariaLabel={t("ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}
          overlayClassName="bookings-v2-modal-overlay"
          panelClassName={`bookings-v2-modal-panel bk-refund-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
          size="sm"
        >
          <div className="bk-cancel-head">{t("ط¥ط¯ط§ط±ط© ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>{t("ط±ظ‚ظ… ط§ظ„ط­ط¬ط²")}: {bookingRef(refundTarget)}</span>
              <span>{t("ط§ظ„ط¹ظ…ظٹظ„ط©")}: {refundTarget?.customerName || "â€”"}</span>
              <span>{t("ظ‚ظٹظ…ط© ط§ظ„ط­ط¬ط²")}: {refundTarget ? readBookingTotalAmount(refundTarget) : 0} {language === "en" ? "SAR" : "ط±.ط³"}</span>
            </div>

            <div className={`bk-refund-status ${activeRefundForTarget ? "is-refunded" : "is-none"}`}>
              {activeRefundForTarget ? (
                <>
                  <strong>{t("ط­ط§ظ„ط© ط§ظ„ط§ط³طھط±ط¬ط§ط¹: طھظ… ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}</strong>
                  <span>
                    {t("ط§ظ„ظ…ط¨ظ„ط؛")}: {Number(activeRefundForTarget.amount || 0).toLocaleString("ar-SA-u-nu-latn")} {language === "en" ? "SAR" : "ط±.ط³"}
                    {" â€¢ "}
                    {t("ط§ظ„ط·ط±ظٹظ‚ط©")}: {t(activeRefundForTarget.method === "transfer" ? "طھط­ظˆظٹظ„" : activeRefundForTarget.method === "card" ? "ط´ط¨ظƒط©" : "ظƒط§ط´")}
                    {" â€¢ "}
                    {t("ط§ظ„طھط§ط±ظٹط®")}: {activeRefundForTarget.date || "â€”"}
                  </span>
                </>
              ) : (
                <>
                  <strong>{t("ط­ط§ظ„ط© ط§ظ„ط§ط³طھط±ط¬ط§ط¹: ط؛ظٹط± ظ…ط³طھط±ط¬ط¹")}</strong>
                  <span>{t("ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط±ط¬ط§ط¹ ظ…ط³ط¬ظ„ ظ„ظ‡ط°ط§ ط§ظ„ط­ط¬ط² ط­ط§ظ„ظٹط§ظ‹.")}</span>
                </>
              )}
            </div>

            <div className="bk-refund-form">
              <label>
                <div className="bk-field-label">{t("ظ…ط¨ظ„ط؛ ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}</div>
                <DashboardNumberInputV2
                  className="bk-input"
                  value={refundDraft.amount}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, amount: e.target.value }))}
                  placeholder={t("ظ…ط«ط§ظ„: 120")}
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div className="bk-field-label">{t("ط·ط±ظٹظ‚ط© ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}</div>
                <DashboardSelectBridgeV2
                  className="bk-select"
                  value={refundDraft.method}
                  onChange={(e) =>
                    setRefundDraft((p) => ({ ...p, method: e.target.value as PaymentMethod }))
                  }
                  disabled={refundSaving}
                >
                  <option value="transfer">{t("طھط­ظˆظٹظ„")}</option>
                  <option value="cash">{t("ظƒط§ط´")}</option>
                  <option value="card">{t("ط´ط¨ظƒط©")}</option>
                  <option value="none">{t("ظ„ط§ ظٹظˆط¬ط¯ ط¯ظپط¹")}</option>
                  <option value="other">{t("ط£ط®ط±ظ‰")}</option>
                </DashboardSelectBridgeV2>
              </label>

              <label>
                <div className="bk-field-label">{t("طھط§ط±ظٹط® ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}</div>
                <DashboardDateInputV2 className="bk-input" value={refundDraft.date} onChange={(e) => setRefundDraft((p) => ({ ...p, date: e.target.value }))} disabled={refundSaving} />
              </label>

              <label>
                <div className="bk-field-label">{t("ط³ط¨ط¨ ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}</div>
                <input
                  type="text"
                  className="bk-input"
                  value={refundDraft.reason}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, reason: e.target.value }))}
                  placeholder={t("ظ…ط«ط§ظ„: ط¥ظ„ط؛ط§ط، ظ‚ط¨ظ„ ط§ظ„ظ…ظˆط¹ط¯")}
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div className="bk-field-label">{t("طھظپط§طµظٹظ„ ط¥ط¶ط§ظپظٹط©")}</div>
                <textarea
                  className="bk-input"
                  rows={3}
                  value={refundDraft.details}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, details: e.target.value }))}
                  placeholder={t("ط£ظٹ طھظپط§طµظٹظ„ ط¯ط§ط®ظ„ظٹط© ظ„ظ„ط§ط³طھط±ط¬ط§ط¹")}
                  disabled={refundSaving}
                />
              </label>
            </div>

            {refundError ? (
              <div className="bk-inline-error">{t(refundError)}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={closeRefundModal}
              disabled={refundSaving}
            >
              {t("ط±ط¬ظˆط¹")}
            </button>
            {refundTarget && refundMapByBookingId[String(refundTarget.id || "").trim()] ? (
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger"
                onClick={handleCancelRefund}
                disabled={refundSaving}
                title={t("ظٹظ…ظƒظ† ط§ظ„طھط±ط§ط¬ط¹ ط¹ظ† ط§ظ„ط§ط³طھط±ط¬ط§ط¹ ظ…ظ† ظ‡ظ†ط§")}
              >
                {refundSaving ? t("ط¬ط§ط±ظٹ ط§ظ„ط¥ظ„ط؛ط§ط،...") : t("ط¥ظ„ط؛ط§ط، ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}
              </button>
            ) : null}
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={handleSaveRefund}
              disabled={refundSaving}
            >
              {refundSaving ? t("ط¬ط§ط±ظٹ ط§ظ„ط­ظپط¸...") : t("ط­ظپط¸ ط§ظ„ط§ط³طھط±ط¬ط§ط¹")}
            </button>
          </div>
        </Modal>

        <Modal
          open={!!confirmTarget}
          onClose={closeConfirmModal}
          ariaLabel={t("طھط£ظƒظٹط¯ ط§ظ„ط­ط¬ط² ظ…ط¹ ط§ظ„ط¯ظپط¹")}
          overlayClassName="bookings-v2-modal-overlay"
          panelClassName={`bookings-v2-modal-panel bk-edit-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
          size="sm"
        >
          <div className="bk-cancel-head">{t("طھط£ظƒظٹط¯ ط§ظ„ط­ط¬ط²")}</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>{t("ط±ظ‚ظ… ط§ظ„ط­ط¬ط²")}: {bookingRef(confirmTarget)}</span>
              <span>{t("ط§ظ„ط¹ظ…ظٹظ„ط©")}: {confirmTarget?.customerName || "â€”"}</span>
              <span>{t("ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط­ط¬ط²")}: {readBookingTotalAmount(confirmTarget)} {language === "en" ? "SAR" : "ط±.ط³"}</span>
            </div>

            <div className="bk-edit-form">
              
              <BookingSelectField
                label={t("ظ†ظˆط¹ ط§ظ„ط¯ظپط¹ ظˆظ‚طھ ط§ظ„طھط£ظƒظٹط¯")}
                value={confirmDraft.paymentMode}
                options={[
                  {
                    value: "full",
                    label: t("ط¯ظپط¹ ظƒط§ظ…ظ„"),
                  },
                  {
                    value: "partial",
                    label: t("ط¹ط±ط¨ظˆظ†"),
                  },
                  {
                    value: "none",
                    label: t("ط¨ط¯ظˆظ† ط¯ظپط¹"),
                  },
                ]}
                placeholder={t("ط§ط®طھط§ط±ظٹ ظ†ظˆط¹ ط§ظ„ط¯ظپط¹")}
                disabled={confirmSaving}
                onChange={(value) =>
                  setConfirmDraft((p) => {
                    const nextMode =
                      value as UiPaymentMode;

                    if (nextMode === "none") {
                      return {
                        ...p,
                        paymentMode: "none",
                        paymentType: "partial",
                        paidAmount: "0",
                      };
                    }

                    return {
                      ...p,
                      paymentMode: nextMode,
                      paymentType:
                        nextMode === "full"
                          ? "full"
                          : "partial",
                    };
                  })
                }
              />

              {confirmDraft.paymentMode !== "none" ? (
                
                <BookingSelectField
                  language={language}
                  label={t("ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}
                  value={confirmDraft.paymentMethod}
                  options={[
                    { value: "cash", label: t("ظƒط§ط´") },
                    { value: "card", label: t("ط´ط¨ظƒط©") },
                    { value: "transfer", label: t("طھط­ظˆظٹظ„") },
                    { value: "mixed", label: t("ط¯ظپط¹ ظ…ط®طھظ„ط·") },
                    { value: "other", label: t("ط£ط®ط±ظ‰") },
                  ]}
                  placeholder={t("ط§ط®طھط§ط±ظٹ ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹")}
                  disabled={confirmSaving}
                  onChange={(value) =>
                    setConfirmDraft((p) => ({
                      ...p,
                      paymentMethod:
                        value as PaymentMethod,
                    }))
                  }
                />
              ) : null}

              {confirmDraft.paymentMethod === "mixed" ? (
                <div className="bk-mixed-payment-box">
                  <label>
                    <div className="bk-field-label">{t("ظ…ط¨ظ„ط؛ ط§ظ„ظƒط§ط´")}</div>
                    <DashboardNumberInputV2
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
                    <div className="bk-field-label">{t("ظ…ط¨ظ„ط؛ ط§ظ„ط´ط¨ظƒط©")}</div>
                    <DashboardNumberInputV2
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
                        {t("ط§ظ„ظ…ط¬ظ…ظˆط¹")}: {paid} {language === "en" ? "SAR" : "ط±.ط³"} | {t("ط§ظ„ظ…طھط¨ظ‚ظٹ")}: {round2(Math.max(0, total - paid))} {language === "en" ? "SAR" : "ط±.ط³"}
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {confirmDraft.paymentMode === "partial" && confirmDraft.paymentMethod !== "mixed" ? (
                <label>
                  <div className="bk-field-label">{t("ظ…ط¨ظ„ط؛ ط§ظ„ط¹ط±ط¨ظˆظ†")}</div>
                  <DashboardNumberInputV2
                    min={0}
                    step="0.01"
                    className="bk-input"
                    value={confirmDraft.paidAmount}
                    onChange={(e) =>
                      setConfirmDraft((p) => ({ ...p, paidAmount: e.target.value }))
                    }
                    placeholder={t("ظ…ط«ط§ظ„: 150")}
                    disabled={confirmSaving}
                  />
                </label>
              ) : null}

              <div className="bk-helper-text">
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
                  const breakdown = {
                    paymentType: confirmDraft.paymentType === "full" ? ("full" as const) : ("partial" as const),
                    paidAmount: round2(paid),
                    remainingAmount: remaining,
                    totalAmount: total,
                  };
                  return language === "en"
                    ? `${confirmDraft.paymentType === "full" ? "Paid in full" : "Deposit"}: ${round2(paid)} SAR آ· Remaining: ${remaining} SAR آ· Total: ${total} SAR`
                    : paymentBreakdownText(breakdown);
                })()}
              </div>
            </div>

            {confirmError ? (
              <div className="bk-inline-error">{confirmError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={closeConfirmModal}
              disabled={confirmSaving}
            >
              {t("ط±ط¬ظˆط¹")}
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={handleConfirmPending}
              disabled={confirmSaving}
            >
              {confirmSaving ? t("ط¬ط§ط±ظٹ ط§ظ„طھط£ظƒظٹط¯...") : t("طھط£ظƒظٹط¯")}
            </button>
          </div>
        </Modal>

        {editTarget ? (
          <EditBookingModal target={editTarget} language={language} onClose={closeEditModal} onSaved={applyLocalBookingPatch} />
        ) : null}

        {/*
        <Modal
          open={!!editTarget}
          onClose={closeEditModal}
          ariaLabel="طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط²"
          panelClassName="bk-edit-modal"
          size="sm"
        >
          <div className="bk-cancel-head">طھط¹ط¯ظٹظ„ ط§ظ„ط­ط¬ط²</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>ط±ظ‚ظ… ط§ظ„ط­ط¬ط²: {bookingRef(editTarget)}</span>
              <span>ط§ظ„ط®ط¯ظ…ط©: {editTarget ? serviceSummaryForTable(editTarget) : "â€”"}</span>
            </div>

            <div className="bk-edit-form">
              <label>
                <div className="bk-field-label">ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ط©</div>
                <input
                  type="text"
                  className="bk-input"
                  value={editDraft.customerName}
                  onChange={(e) => setEditDraft((p) => ({ ...p, customerName: e.target.value }))}
                  placeholder="ظ…ط«ط§ظ„: ط³ط§ط±ط© ط£ط­ظ…ط¯"
                  disabled={editSaving}
                />
              </label>

              <label>
                <div className="bk-field-label">ط±ظ‚ظ… ط§ظ„ط¬ظˆط§ظ„</div>
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
                  <div className="bk-field-label">ط§ظ„ظ‚ط³ظ…</div>
                  <DashboardSelectBridgeV2
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
                    <option value="">ط§ط®طھط§ط±ظٹ ط§ظ„ظ‚ط³ظ…</option>
                    {editSections.map((section) => (
                      <option key={`edit_section_${section.id}`} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </DashboardSelectBridgeV2>
                </label>

                <label>
                  <div className="bk-field-label">ط§ظ„طھطµظ†ظٹظپ</div>
                  <DashboardSelectBridgeV2
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
                      {editCategories.length ? "ط¨ط¯ظˆظ† طھط­ط¯ظٹط¯" : "ظ„ط§ طھظˆط¬ط¯ طھطµظ†ظٹظپط§طھ"}
                    </option>
                    {editCategories.map((category) => (
                      <option key={`edit_category_${category.id}`} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </DashboardSelectBridgeV2>
                </label>
              </div>

              <label>
                <div className="bk-field-label">ط§ظ„ط®ط¯ظ…ط©</div>
                <DashboardSelectBridgeV2
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
                    {filteredEditServices.length ? "ط§ط®طھط§ط±ظٹ ط§ظ„ط®ط¯ظ…ط©" : "ظ„ط§ طھظˆط¬ط¯ ط®ط¯ظ…ط§طھ"}
                  </option>
                  {filteredEditServices.map((service) => (
                    <option key={`edit_service_${service.id}`} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </DashboardSelectBridgeV2>
              </label>

              {editCatalogLoading ? (
                <div className="bk-edit-helper">ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ط£ظ‚ط³ط§ظ… ظˆط§ظ„طھطµظ†ظٹظپط§طھ ظˆط§ظ„ط®ط¯ظ…ط§طھ...</div>
              ) : null}

              <div className="bk-edit-grid">
                <label>
                  <div className="bk-field-label">ط§ظ„طھط§ط±ظٹط®</div>
                  <DashboardDateInputV2 className="bk-input" value={editDraft.date} onChange={(e) => setEditDraft((p) => ({ ...p, date: e.target.value }))} disabled={editSaving} />
                </label>

                <label>
                  <div className="bk-field-label">ط§ظ„ظˆظ‚طھ</div>
                  <DashboardTimeInputV2 className="bk-input" value={editDraft.time} onChange={(e) => setEditDraft((p) => ({ ...p, time: e.target.value }))} disabled={editSaving} />
                </label>
              </div>

              <label>
                <div className="bk-field-label">ط§ظ„ط³ط¹ط± ط§ظ„ظ†ظ‡ط§ط¦ظٹ</div>
                <input dir="ltr" lang="en"
                  type="number"
                  min={0}
                  step="0.01"
                  className="bk-input"
                  value={editDraft.price}
                  onChange={(e) => setEditDraft((p) => ({ ...p, price: e.target.value }))}
                  placeholder="ظ…ط«ط§ظ„: 120"
                  disabled={editSaving}
                />
              </label>

              <label>
                <div className="bk-field-label">ظ†ظˆط¹ ط§ظ„ط¯ظپط¹</div>
                <DashboardSelectBridgeV2
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
                  <option value="full">ط¯ظپط¹ ظƒط§ظ…ظ„</option>
                  <option value="partial">ط¹ط±ط¨ظˆظ†</option>
                  <option value="none">ط¨ط¯ظˆظ† ط¯ظپط¹</option>
                </DashboardSelectBridgeV2>
              </label>

              {editDraft.paymentMethod !== "none" ? (
                <label>
                  <div className="bk-field-label">ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹</div>
                  <DashboardSelectBridgeV2
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
                    <option value="cash">ظƒط§ط´</option>
                    <option value="card">ط´ط¨ظƒط©</option>
                    <option value="transfer">طھط­ظˆظٹظ„</option>
                    <option value="other">ط£ط®ط±ظ‰</option>
                  </DashboardSelectBridgeV2>
                </label>
              ) : null}

              {editDraft.paymentMethod !== "none" && editDraft.paymentType === "partial" ? (
                <label>
                  <div className="bk-field-label">ظ…ط¨ظ„ط؛ ط§ظ„ط¹ط±ط¨ظˆظ†</div>
                  <input dir="ltr" lang="en"
                    type="number"
                    min={0}
                    step="0.01"
                    className="bk-input"
                    value={editDraft.paidAmount}
                    onChange={(e) => setEditDraft((p) => ({ ...p, paidAmount: e.target.value }))}
                    placeholder="ظ…ط«ط§ظ„: 100"
                    disabled={editSaving}
                  />
                </label>
              ) : null}

              <div className="bk-helper-text">
                ط§ظ„ظ…طھط¨ظ‚ظٹ ط¨ط¹ط¯ ط§ظ„طھط¹ط¯ظٹظ„:{" "}
                {(() => {
                  const total = Math.max(0, Number(editDraft.price || 0));
                  const paid =
                    editDraft.paymentMethod === "none"
                      ? 0
                      : editDraft.paymentType === "full"
                      ? total
                      : Math.max(0, Number(editDraft.paidAmount || 0));
                  return `${round2(Math.max(0, total - paid))} ط±.ط³`;
                })()}
              </div>

              <label>
                <div className="bk-field-label">ظ…ظ„ط§ط­ط¸ط© ط§ظ„ط­ط¬ط²</div>
                <textarea
                  className="bk-input"
                  rows={3}
                  value={editDraft.note}
                  onChange={(e) => setEditDraft((p) => ({ ...p, note: e.target.value }))}
                  placeholder="ظ…ظ„ط§ط­ط¸ط© ط¯ط§ط®ظ„ظٹط© ط¹ظ„ظ‰ ظ†ظپط³ ط§ظ„ط­ط¬ط²"
                  disabled={editSaving}
                />
              </label>
            </div>

            {editError ? (
              <div className="bk-inline-error">{editError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={closeEditModal}
              disabled={editSaving}
            >
              ط±ط¬ظˆط¹
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={handleSaveBookingEdit}
              disabled={editSaving}
            >
              {editSaving ? "ط¬ط§ط±ظٹ ط§ظ„ط­ظپط¸..." : "ط­ظپط¸ ط§ظ„طھط¹ط¯ظٹظ„ط§طھ"}
            </button>
          </div>
        </Modal>
        */}

        <Modal
          open={!!cancelTarget}
          onClose={() => (cancelBusy ? null : closeCancelModal())}
          ariaLabel={t("طھط£ظƒظٹط¯ ط¥ظ„ط؛ط§ط، ط§ظ„ط­ط¬ط²")}
          overlayClassName="bookings-v2-modal-overlay"
          panelClassName={`bookings-v2-modal-panel bk-cancel-modal${language === "en" ? " bookings-v2-modal-panel--en" : ""}`}
          size="sm"
        >
          <div className="bk-cancel-head">{t("طھط£ظƒظٹط¯ ط¥ظ„ط؛ط§ط، ط§ظ„ط­ط¬ط²")}</div>
          <div className="bk-cancel-body">
            <p>{t("ظ‡ظ„ طھط±ظٹط¯ ط¨ط§ظ„ظپط¹ظ„ ط¥ظ„ط؛ط§ط، ظ‡ط°ط§ ط§ظ„ط­ط¬ط²طں")}</p>
            <div className="bk-cancel-meta">
              <span>{t("ط±ظ‚ظ… ط§ظ„ط­ط¬ط²")}: {bookingRef(cancelTarget)}</span>
              <span>{t("ط§ظ„ط¹ظ…ظٹظ„ط©")}: {cancelTarget?.customerName || "â€”"}</span>
              <span>{t("ط§ظ„طھط§ط±ظٹط®")}: {cancelTarget?.date || "â€”"} - {bookingClockText(cancelTarget?.time || "", language)}</span>
            </div>
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={closeCancelModal}
              disabled={cancelBusy}
            >
              {t("ط±ط¬ظˆط¹")}
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--danger"
              onClick={confirmCancelBooking}
              disabled={cancelBusy}
            >
              {cancelBusy ? t("ط¬ط§ط±ظٹ ط§ظ„ط¥ظ„ط؛ط§ط،...") : t("طھط£ظƒظٹط¯ ط§ظ„ط¥ظ„ط؛ط§ط،")}
            </button>
          </div>
        </Modal>
      </div>
    </main>
  );
}
