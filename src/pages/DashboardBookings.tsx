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
} from "@fortawesome/free-solid-svg-icons";

import { auth, db } from "../services/firebase";
import { FirestoreReadStats } from "../services/firestoreReadStats";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query as fsQuery,
  limit as fsLimit,
  where,
} from "firebase/firestore";

import {
  listAllBookings,
  watchAllBookings, // ✅ Realtime
  updateBookingStatus,
  createDashboardBooking,
  updateBookingDetails as updateBookingFields,
  deleteBooking,
  type BookingStatus,
} from "../services/firestoreBookings";
import { listAllIncomeFS, removeIncomeFS, upsertIncomeFS } from "../services/firestoreIncome";
import type { PaymentMethod } from "../types/finance";

import type { UiRole } from "../services/userProfile";

// ✅ NEW: resolve service name (make it readable)
import { resolveServiceName } from "../services/serviceResolver";

// ✅ NEW: AppSettings from Firestore (source of truth)
import { AppSettingsService, type AppSettings } from "../services/AppSettingsService";

import { isStaffAvailableForDate } from "../helpers/staffAvailability";
import {
  formatTime12,
  round2,
  toMillisSafeDashboardBookings as toMillisSafe,
} from "../helpers/pageSharedUtils";

// ✅ Styles
import "../styles/DashboardBookings.css";

/* =========================
   Constants / Types
========================= */

type StatusOption = BookingStatus | "all";
type ExcludedStatusOption = "" | BookingStatus;
type SettlementFilterOption = "all" | "unpaid";

const NOTES_KEY = "dashboard_booking_notes_v1";
const BOOKING_ACTION_PIN = "598867395";
const NEW_BOOKINGS_SEEN_AT_KEY = "dashboard_bookings_seen_at_v1";

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

const allStatusOptions: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
type BookingPaymentType = "full" | "partial";
type PaymentDisplayLine = {
  key: string;
  label: string;
  tone: "neutral" | "paid" | "remaining" | "total";
  amount?: number;
};

/* =========================
   Helpers
========================= */

function safeISODate(d: string | undefined | null) {
  if (!d) return "";
  return d.trim();
}

function inDateRange(bookingDate: string, from: string, to: string) {
  const d = safeISODate(bookingDate);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function todayISOLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateISOFromMillisLocal(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseBookingDateTimeMs(dateISO: string, timeHHMM: string): number | null {
  const d = String(dateISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(timeHHMM || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!d || !t) return null;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const stamp = new Date(year, Math.max(0, month - 1), day, hour, minute, 0, 0);
  if (
    stamp.getFullYear() !== year ||
    stamp.getMonth() !== month - 1 ||
    stamp.getDate() !== day
  ) {
    return null;
  }
  return stamp.getTime();
}

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

function bookingRef(b: Partial<Booking> | null | undefined) {
  const raw = String(b?.publicId || "").trim();
  if (!raw) return "—";
  const up = raw.toUpperCase();
  if (/^MK-\d+$/.test(up)) return up;
  if (/^\d+$/.test(up)) return `MK-${up}`;
  return up;
}

function readBookingTotalAmount(raw: any) {
  const n = Number(
    raw?.finalPrice ??
      raw?.total ??
      raw?.serviceSnapshot?.priceAtBooking ??
      raw?.packageSnapshot?.finalPriceAtBooking ??
      0
  );
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalizeBookingPaymentType(raw: any): BookingPaymentType | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

function resolveBookingPaymentSummary(raw: any): {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
} {
  const totalAmount = readBookingTotalAmount(raw);
  const normalizedType = normalizeBookingPaymentType(raw?.paymentType);
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

  const remainingAmount = Math.max(0, round2(totalAmount - paidAmount));
  return {
    paymentType,
    paidAmount: round2(Math.max(0, Math.min(totalAmount, paidAmount))),
    remainingAmount,
    totalAmount: round2(totalAmount),
  };
}

function detectPaymentMethod(b: Booking): PaymentMethod {
  const stored = String((b as any)?.paymentMethod || "").toLowerCase().trim();
  if (stored === "card" || stored === "cash" || stored === "transfer") {
    return stored as PaymentMethod;
  }
  const s = String((b as any)?.note || "").toLowerCase();
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("card")) return "card";
  if (s.includes("تحويل") || s.includes("transfer")) return "transfer";
  if (s.includes("كاش") || s.includes("cash") || s.includes("نقد")) return "cash";
  return "transfer";
}

function isPendingDepositBooking(
  raw: { status?: string } | null | undefined,
  payment: { paidAmount: number; remainingAmount: number; totalAmount: number }
) {
  const status = String(raw?.status || "").trim().toLowerCase();
  if (status !== "pending") return false;
  return (
    Number(payment.totalAmount || 0) > 0 &&
    Number(payment.paidAmount || 0) > 0 &&
    Number(payment.remainingAmount || 0) > 0
  );
}

function paymentStatusLabel(payment: {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
}) {
  const total = round2(payment.totalAmount);
  const paid = round2(payment.paidAmount);
  const remaining = round2(payment.remainingAmount);
  if (total <= 0) return "لا يوجد سعر محدد";
  if (paid <= 0 && remaining > 0) return "غير مدفوع (بانتظار السداد)";
  if (remaining <= 0) return "مدفوع بالكامل";
  if (payment.paymentType === "partial") return "عربون (دفع جزئي)";
  return "مدفوع جزئيًا";
}

function paymentBreakdownText(payment: {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
}) {
  if (round2(payment.totalAmount) <= 0) return paymentStatusLabel(payment);
  return `${paymentStatusLabel(payment)} - ${paymentAmountsInlineText(payment).replace(/\n/g, " | ")}`;
}

function paymentAmountsDisplayLines(payment: {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
}): PaymentDisplayLine[] {
  const total = round2(payment.totalAmount);
  const paid = round2(payment.paidAmount);
  const remaining = round2(payment.remainingAmount);
  if (total <= 0) {
    return [{ key: "empty", label: "لا يوجد مبلغ محدد", tone: "neutral" as const }];
  }
  if (remaining <= 0) {
    return [{ key: "paid", label: "مدفوع", amount: paid, tone: "paid" as const }];
  }
  if (paid <= 0) {
    return [{ key: "remaining", label: "متبقي", amount: remaining, tone: "remaining" as const }];
  }
  return [
    { key: "paid", label: "مدفوع", amount: paid, tone: "paid" as const },
    { key: "remaining", label: "متبقي", amount: remaining, tone: "remaining" as const },
    { key: "total", label: "إجمالي", amount: total, tone: "total" as const },
  ];
}

function paymentAmountsInlineText(payment: {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
}) {
  return paymentAmountsDisplayLines(payment)
    .map((line) => (typeof line.amount === "number" ? `${line.label} ${line.amount} ر.س` : line.label))
    .join("\n");
}

function bookingCreationRefMs(b: Partial<Booking> | null | undefined) {
  const createdAtMs = toMillisSafe((b as any)?.createdAt);
  if (createdAtMs > 0) return createdAtMs;
  const createdAtMsLegacy = Number((b as any)?.createdAtMs || 0);
  if (Number.isFinite(createdAtMsLegacy) && createdAtMsLegacy > 0) return createdAtMsLegacy;
  const pendingAtMs = Number((b as any)?.pendingAt || 0);
  if (Number.isFinite(pendingAtMs) && pendingAtMs > 0) return pendingAtMs;
  const updatedAtMs = toMillisSafe((b as any)?.updatedAt);
  if (updatedAtMs > 0) return updatedAtMs;
  return 0;
}

function bookingPublicBase(publicId?: string) {
  const up = String(publicId || "").trim().toUpperCase();
  if (!up) return "";
  const m = up.match(/^(MK-\d+)(?:-\d+)?$/i);
  return m ? m[1].toUpperCase() : up;
}

function resolveDashboardBookingBlockKey(b: Booking) {
  const groupId = String((b as any)?.bookingGroupId || (b as any)?.parentBookingId || "").trim();
  if (groupId) return `group:${groupId}`;

  const fullPublic = String(b?.publicId || "").trim().toUpperCase();
  const basePublic = bookingPublicBase(fullPublic);
  if (basePublic && fullPublic && fullPublic.startsWith(`${basePublic}-`)) {
    return `public:${basePublic}`;
  }

  const phone = digitsOnly(String(b?.phone || "").trim());
  const name = normalizeArabicName(String(b?.customerName || "").trim());
  const date = String(b?.date || "").trim();
  const createdMs = toMillisSafe((b as any)?.createdAt);
  if ((phone || name) && date && createdMs > 0) {
    const bucket = Math.floor(createdMs / (2 * 60 * 1000));
    const idPart = phone ? `p:${phone}` : `n:${name}`;
    return `batch:${String(b?.channel || "").trim()}:${idPart}:${date}:${bucket}`;
  }

  return `single:${String(b?.id || "").trim() || "unknown"}`;
}

type BookingBlock = {
  key: string;
  label: string;
  rows: Booking[];
};

type BookingSectionKind = "normal" | "internal";

type BookingDisplaySection = {
  key: BookingSectionKind;
  title: string;
  description: string;
  rows: Booking[];
  blocks: BookingBlock[];
  temporaryInternalCount: number;
};

function buildDashboardBookingBlocks(rows: Booking[]): BookingBlock[] {
  const blocks = new Map<string, BookingBlock>();

  rows.forEach((b) => {
    const key = resolveDashboardBookingBlockKey(b);
    const current = blocks.get(key);
    if (current) {
      current.rows.push(b);
      return;
    }

    const label = bookingPublicBase(String(b.publicId || "").trim()) || bookingRef(b);
    blocks.set(key, { key, label, rows: [b] });
  });

  const out = Array.from(blocks.values());
  out.forEach((block) => {
    block.rows.sort((a, b) => {
      const d = String(a.date || "").localeCompare(String(b.date || ""));
      if (d !== 0) return d;
      return String(a.time || "").localeCompare(String(b.time || ""));
    });
  });

  return out;
}

function isTemporaryNormalInternalBooking(b: Booking) {
  if (b.channel !== "internal") return false;
  if (String(b.status || "").trim().toLowerCase() !== "pending") return false;

  const payment = resolveBookingPaymentSummary(b);
  if (round2(payment.paidAmount) > 0) return false;

  const bookingMs = parseBookingDateTimeMs(String(b.date || ""), String(b.time || ""));
  if (bookingMs !== null) return bookingMs > Date.now();

  const bookingDate = safeISODate(String(b.date || ""));
  return !!bookingDate && bookingDate > todayISOLocal();
}

function resolveBookingSectionKind(b: Booking): BookingSectionKind {
  if (b.channel === "internal" && !isTemporaryNormalInternalBooking(b)) return "internal";
  return "normal";
}

function bookingChannelBadgeText(b: Booking) {
  if (b.channel !== "internal") return "";
  return isTemporaryNormalInternalBooking(b)
    ? "حجز داخلي مستقبلي قبل الدفع"
    : "حجز داخلي";
}

function channelLabel(channel?: string) {
  if (channel === "client") return "موقع العميلات";
  if (channel === "dashboard") return "الداشبورد";
  if (channel === "internal") return "الحجز الداخلي";
  return "غير محدد";
}

function formatEventAt(v: any) {
  try {
    const ms =
      typeof v?.toMillis === "function"
        ? v.toMillis()
        : typeof v?.seconds === "number"
          ? Number(v.seconds) * 1000
          : 0;
    if (!ms) return "—";
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${formatTime12(`${hh}:${mi}`)}`;
  } catch {
    return "—";
  }
}

function formatAnyDateTime(v: any) {
  try {
    if (!v) return "—";
    const ms =
      typeof v?.toMillis === "function"
        ? v.toMillis()
        : typeof v?.seconds === "number"
          ? Number(v.seconds) * 1000
          : typeof v === "number"
            ? v
            : Date.parse(String(v));
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${formatTime12(`${hh}:${mi}`)}`;
  } catch {
    return "—";
  }
}

function digitsOnly(v: string) {
  return String(v || "").replace(/\D/g, "");
}

const GENERIC_ACTOR_LABELS = new Set([
  "",
  "system",
  "النظام",
  "client",
  "staff",
  "dashboard",
  "internal",
  "owner",
  "admin",
  "reception",
  "guest",
  "user",
  "مستخدم",
  "عميلة",
  "موظفة",
  "تعيين تلقائي",
  "auto-assigned",
  "auto assigned",
]);

function normalizeActorLabel(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isMeaningfulActorLabel(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return !GENERIC_ACTOR_LABELS.has(normalizeActorLabel(raw));
}

function emailLocalPart(email: unknown) {
  const raw = String(email || "").trim();
  return raw ? raw.split("@")[0] : "";
}

function resolveUidActorLabel(
  uid: unknown,
  booking?: Partial<Booking> | null,
  userNamesByUid: Record<string, string> = {}
) {
  const rawUid = String(uid || "").trim();
  if (!rawUid) return "";
  const mappedName = String(userNamesByUid[rawUid] || "").trim();
  if (mappedName) return mappedName;

  const bookingUserId = String(booking?.userId || "").trim();
  const channel = String(booking?.channel || "").trim().toLowerCase();
  const createdBy = String(booking?.createdBy || "").trim().toLowerCase();
  const clientName = String(booking?.customerName || "").trim();
  if (
    bookingUserId &&
    rawUid === bookingUserId &&
    (channel === "client" || createdBy === "client") &&
    clientName &&
    clientName !== "غير متوفر"
  ) {
    return clientName;
  }

  return rawUid.slice(0, 8);
}

function resolveActorLabelFromParts(args: {
  name?: unknown;
  email?: unknown;
  uid?: unknown;
  booking?: Partial<Booking> | null;
  userNamesByUid?: Record<string, string>;
  createdBy?: unknown;
}) {
  const name = String(args.name || "").trim();
  if (isMeaningfulActorLabel(name)) return name;

  const createdBy = String(args.createdBy || "").trim();
  if (isMeaningfulActorLabel(createdBy)) return createdBy;

  const rawUid = String(args.uid || "").trim();
  const uidLabel = resolveUidActorLabel(rawUid, args.booking, args.userNamesByUid || {});
  const emailLabel = emailLocalPart(args.email);
  if (uidLabel && rawUid && uidLabel !== rawUid.slice(0, 8)) return uidLabel;
  if (emailLabel) return emailLabel;
  if (uidLabel) return uidLabel;

  return "";
}

function resolveBookingActorLabel(
  booking: Partial<Booking> | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  const b = booking || {};
  const candidates = [
    { name: b.updatedByName, email: b.updatedByEmail, uid: b.updatedByUid },
    { name: b.cancelledByName, email: b.cancelledByEmail, uid: b.cancelledByUid },
    { name: b.completedByName, email: b.completedByEmail, uid: b.completedByUid },
    { name: b.confirmedByName, email: b.confirmedByEmail, uid: b.confirmedByUid },
    { name: b.pendingByName, email: b.pendingByEmail, uid: b.pendingByUid },
    {
      name: b.createdByName,
      email: b.createdByEmail,
      uid: b.createdByUid || b.userId,
      createdBy: b.createdBy,
    },
  ];

  for (const candidate of candidates) {
    const label = resolveActorLabelFromParts({
      ...candidate,
      booking: b,
      userNamesByUid,
    });
    if (label) return label;
  }

  const clientName = String(b.customerName || "").trim();
  if (
    clientName &&
    clientName !== "غير متوفر" &&
    (String(b.channel || "").trim().toLowerCase() === "client" ||
      String(b.createdBy || "").trim().toLowerCase() === "client")
  ) {
    return clientName;
  }

  return "النظام";
}

function fallbackLastUpdateForBooking(
  booking: Partial<Booking> | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  const fallbackAt = formatAnyDateTime((booking as any)?.updatedAt || (booking as any)?.createdAt);
  return {
    by: resolveBookingActorLabel(booking, userNamesByUid),
    at: fallbackAt,
  };
}

function actorLabelFromEvent(
  ev: any,
  userNamesByUid: Record<string, string> = {},
  booking?: Partial<Booking> | null
) {
  const label = resolveActorLabelFromParts({
    name: ev?.byName || ev?.userName || ev?.displayName,
    email: ev?.byEmail,
    uid: ev?.byUid || ev?.userUid,
    booking,
    userNamesByUid,
  });
  return label || resolveBookingActorLabel(booking, userNamesByUid);
}

type BookingActivityActorKind = "client" | "staff" | "admin" | "system" | "unknown";
type BookingActivityTone = "default" | "success" | "danger" | "info";
type BookingActivityItem = {
  id: string;
  eventKey: string;
  title: string;
  actorName: string;
  actorKind: BookingActivityActorKind;
  actorKindLabel: string;
  atLabel: string;
  changes: string[];
  note: string;
  tone: BookingActivityTone;
  sortMs: number;
};

function bookingActivityActorKindLabelAr(kind: BookingActivityActorKind) {
  if (kind === "client") return "العميلة";
  if (kind === "staff") return "الموظفة";
  if (kind === "admin") return "الإدارة";
  if (kind === "system") return "النظام";
  return "غير محدد";
}

function isAutomaticBookingActivity(raw: any) {
  const hay = [
    raw?.byName,
    raw?.byEmail,
    raw?.note,
    raw?.type,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .join(" ");

  return (
    hay.includes("النظام") ||
    hay.includes("تلقائي") ||
    /\b(system|auto|automatic)\b/i.test(hay)
  );
}

function resolveBookingActivitySortMs(raw: any) {
  const directMs = Number(raw?.eventAtMs || 0);
  if (Number.isFinite(directMs) && directMs > 0) return directMs;
  const metaMs = Number(raw?.meta?.eventAtMs || 0);
  if (Number.isFinite(metaMs) && metaMs > 0) return metaMs;
  const atMs = toMillisSafe(raw?.at || raw?.createdAt);
  if (atMs > 0) return atMs;
  return 0;
}

function getBookingActivityPatch(raw: any) {
  const directPatch = raw?.patch;
  if (directPatch && typeof directPatch === "object" && !Array.isArray(directPatch)) {
    return directPatch as Record<string, unknown>;
  }

  const afterPatch = raw?.after;
  if (afterPatch && typeof afterPatch === "object" && !Array.isArray(afterPatch)) {
    return afterPatch as Record<string, unknown>;
  }

  return {} as Record<string, unknown>;
}

function resolveBookingActivityType(raw: any) {
  const explicitType = String(raw?.type || raw?.meta?.bookingLogType || "").trim().toLowerCase();
  if (explicitType) return explicitType;

  const action = String(raw?.action || "").trim().toLowerCase();
  if (action === "booking_created") return "created";
  if (action === "booking_updated") return "details_updated";
  if (action === "booking_viewed") return "staff_acknowledged";
  if (
    action === "booking_confirmed" ||
    action === "booking_completed" ||
    action === "booking_cancelled" ||
    action === "booking_status_changed"
  ) {
    return "status_changed";
  }

  return "";
}

function resolveBookingActivityStatus(raw: any) {
  const patch = getBookingActivityPatch(raw);
  const patchStatus = String(patch?.status || raw?.status || "").trim().toLowerCase();
  if (patchStatus) return patchStatus;

  const action = String(raw?.action || "").trim().toLowerCase();
  if (action === "booking_confirmed") return "confirmed";
  if (action === "booking_completed") return "completed";
  if (action === "booking_cancelled") return "cancelled";

  return "";
}

function bookingPaymentMethodLabelAr(method: unknown) {
  const raw = String(method || "").trim().toLowerCase();
  if (raw === "cash") return "كاش";
  if (raw === "card") return "شبكة";
  if (raw === "transfer") return "تحويل";
  if (raw === "other") return "أخرى";
  return "";
}

function bookingPaymentModeLabelAr(args: {
  paymentType?: unknown;
  paymentMethod?: unknown;
  paidAmount?: unknown;
}) {
  const paymentType = normalizeBookingPaymentType(args.paymentType);
  const paymentMethod = String(args.paymentMethod || "").trim().toLowerCase();
  const paidAmount = Number(args.paidAmount ?? 0);

  if (!paymentMethod && paymentType === "partial" && paidAmount <= 0) return "بدون دفع";
  if (paymentMethod === "none") return "بدون دفع";
  if (paymentType === "full") return "دفع كامل";
  if (paymentType === "partial") return "عربون";
  return "";
}

function resolveBookingActivityTitle(raw: any) {
  const type = resolveBookingActivityType(raw);
  const status = resolveBookingActivityStatus(raw);

  if (type === "created") return "تم إنشاء الحجز";
  if (type === "details_updated") return "تم تعديل الحجز";
  if (type === "staff_acknowledged") return "تم الاطلاع على الحجز";
  if (type === "status_changed") {
    if (status === "confirmed") return "تم تأكيد الحجز";
    if (status === "cancelled" || status === "canceled") return "تم إلغاء الحجز";
    if (status === "completed") return "تم إكمال الحجز";
    if (status === "pending") return "تم تحويل الحجز إلى الانتظار";
    return "تم تغيير حالة الحجز";
  }

  return "تم تحديث الحجز";
}

function resolveBookingActivityTone(raw: any): BookingActivityTone {
  const type = resolveBookingActivityType(raw);
  const status = resolveBookingActivityStatus(raw);

  if (type === "created") return "info";
  if (type === "staff_acknowledged") return "info";
  if (status === "confirmed" || status === "completed") return "success";
  if (status === "cancelled" || status === "canceled") return "danger";
  return "default";
}

function resolveBookingActivityActor(
  raw: any,
  booking: Partial<Booking> | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  if (isAutomaticBookingActivity(raw)) {
    return {
      actorName: "النظام",
      actorKind: "system" as BookingActivityActorKind,
    };
  }

  const explicit = resolveActorLabelFromParts({
    name: raw?.byName || raw?.userName || raw?.displayName,
    email: raw?.byEmail,
    uid: raw?.byUid || raw?.userUid,
    booking,
    userNamesByUid,
  });
  const bookingFallbackRaw = resolveBookingActorLabel(booking, userNamesByUid);
  const bookingFallback = bookingFallbackRaw === "النظام" ? "" : bookingFallbackRaw;
  const actorName = explicit || bookingFallback || "";
  const bookingClientName = String(booking?.customerName || "").trim();
  const bookingEmployeeName = String(booking?.employeeName || "").trim();
  const type = resolveBookingActivityType(raw);

  if (actorName) {
    if (
      bookingClientName &&
      normalizeArabicName(actorName) === normalizeArabicName(bookingClientName)
    ) {
      return {
        actorName: bookingClientName,
        actorKind: "client" as BookingActivityActorKind,
      };
    }

    if (
      bookingEmployeeName &&
      normalizeArabicName(actorName) === normalizeArabicName(bookingEmployeeName)
    ) {
      return {
        actorName: bookingEmployeeName,
        actorKind: "staff" as BookingActivityActorKind,
      };
    }

    return {
      actorName,
      actorKind:
        type === "staff_acknowledged"
          ? ("staff" as BookingActivityActorKind)
          : ("admin" as BookingActivityActorKind),
    };
  }

  if (
    type === "created" &&
    bookingClientName &&
    (String(booking?.channel || "").trim().toLowerCase() === "client" ||
      String(booking?.createdBy || "").trim().toLowerCase() === "client")
  ) {
    return {
      actorName: bookingClientName,
      actorKind: "client" as BookingActivityActorKind,
    };
  }

  return {
    actorName: "غير محدد",
    actorKind: "unknown" as BookingActivityActorKind,
  };
}

function resolveBookingActivityChanges(raw: any) {
  const type = resolveBookingActivityType(raw);
  const patch = getBookingActivityPatch(raw);
  const serviceSnapshot =
    patch?.serviceSnapshot && typeof patch.serviceSnapshot === "object" ? (patch.serviceSnapshot as any) : {};
  const changes: string[] = [];

  const push = (value: string) => {
    const txt = String(value || "").trim();
    if (!txt) return;
    if (!changes.includes(txt)) changes.push(txt);
  };

  const serviceName = String(
    serviceSnapshot?.serviceNameAtBooking ||
      patch?.serviceName ||
      patch?.serviceId ||
      ""
  ).trim();
  const sectionName = String(
    serviceSnapshot?.sectionTitleAtBooking ||
      patch?.sectionTitle ||
      patch?.sectionName ||
      patch?.sectionId ||
      ""
  ).trim();
  const categoryName = String(
    serviceSnapshot?.categoryNameAtBooking ||
      patch?.categoryName ||
      patch?.categoryId ||
      ""
  ).trim();
  const clientName = String(patch?.clientName || patch?.customerName || "").trim();
  const clientPhone = String(patch?.clientPhone || patch?.customerPhone || patch?.phone || "").trim();
  const totalRaw = Number(patch?.finalPrice ?? patch?.total);
  const paidAmountRaw = Number(patch?.paidAmount);
  const remainingAmountRaw = Number(patch?.remainingAmount);
  const status = String(patch?.status || "").trim();
  const paymentMode = bookingPaymentModeLabelAr({
    paymentType: patch?.paymentType,
    paymentMethod: patch?.paymentMethod,
    paidAmount: patch?.paidAmount,
  });
  const paymentMethod = bookingPaymentMethodLabelAr(patch?.paymentMethod);
  const noteText = String(patch?.note || "").trim();

  if (patch?.date) push(`التاريخ إلى ${String(patch.date).trim()}`);
  if (patch?.time) push(`الوقت إلى ${formatTime12(String(patch.time).trim())}`);
  if (sectionName) push(`القسم إلى ${toArabicOnlyLabel(sectionName, sectionName)}`);
  if (categoryName) push(`التصنيف إلى ${toArabicOnlyLabel(categoryName, categoryName)}`);
  if (patch?.employeeName) push(`الموظفة إلى ${String(patch.employeeName).trim()}`);
  if (serviceName) push(`الخدمة إلى ${toArabicOnlyLabel(serviceName, serviceName)}`);
  if (clientName) push(`العميلة إلى ${clientName}`);
  if (clientPhone) push(`رقم الجوال إلى ${clientPhone}`);
  if (status) push(`الحالة إلى ${statusLabel[status as BookingStatus] || status}`);
  if (paymentMode) push(`نوع الدفع إلى ${paymentMode}`);
  if (paymentMethod) push(`طريقة الدفع إلى ${paymentMethod}`);
  if (Number.isFinite(paidAmountRaw)) push(`المدفوع إلى ${round2(Math.max(0, paidAmountRaw))} ر.س`);
  if (Number.isFinite(remainingAmountRaw)) {
    push(`المتبقي إلى ${round2(Math.max(0, remainingAmountRaw))} ر.س`);
  }
  if (Number.isFinite(totalRaw) && totalRaw > 0) push(`الإجمالي إلى ${totalRaw} ر.س`);
  if (type === "details_updated" && noteText) push("تم تحديث ملاحظة الحجز");

  return changes;
}

function resolveBookingActivityNote(raw: any) {
  const note = String(raw?.note || "").trim();
  if (!note) return "";

  const genericNotes = new Set([
    "تم إنشاء الحجز",
    "تم تعديل بيانات الحجز",
    "تمت مشاهدة الحجز لأول مرة",
  ]);

  if (genericNotes.has(note)) return "";
  if (resolveBookingActivityType(raw) === "status_changed") return "";
  return note;
}

function mapBookingActivityItem(
  raw: any,
  booking: Partial<Booking> | null | undefined,
  userNamesByUid: Record<string, string> = {}
): BookingActivityItem {
  const type = resolveBookingActivityType(raw) || "details_updated";
  const patch = getBookingActivityPatch(raw);
  const status = resolveBookingActivityStatus(raw);
  const detailsKey =
    type === "details_updated"
      ? Object.keys(patch)
          .filter((key) => !/^updatedBy/i.test(key) && key !== "updatedAt")
          .sort()
          .join(",")
      : "";
  const actor = resolveBookingActivityActor(raw, booking, userNamesByUid);
  const sortMs =
    resolveBookingActivitySortMs(raw) ||
    bookingCreationRefMs(booking) ||
    Date.now();

  return {
    id: String(raw?.id || raw?.eventId || `${sortMs}-${raw?.type || "event"}`),
    eventKey:
      type === "status_changed"
        ? `status:${status || "changed"}`
        : type === "details_updated"
          ? `details:${detailsKey || "generic"}`
          : type,
    title: resolveBookingActivityTitle(raw),
    actorName: actor.actorName,
    actorKind: actor.actorKind,
    actorKindLabel: bookingActivityActorKindLabelAr(actor.actorKind),
    atLabel: formatAnyDateTime(sortMs),
    changes: resolveBookingActivityChanges(raw),
    note: resolveBookingActivityNote(raw),
    tone: resolveBookingActivityTone(raw),
    sortMs,
  };
}

function buildFallbackCreatedActivity(
  booking: Partial<Booking> | null | undefined
): BookingActivityItem | null {
  const createdAtMs = bookingCreationRefMs(booking);
  if (!createdAtMs) return null;

  const clientName = String(booking?.customerName || "").trim();
  const isClientCreated =
    !!clientName &&
    (String(booking?.channel || "").trim().toLowerCase() === "client" ||
      String(booking?.createdBy || "").trim().toLowerCase() === "client");

  return {
    id: `fallback-created-${String(booking?.id || "booking")}`,
    eventKey: "created",
    title: "تم إنشاء الحجز",
    actorName: isClientCreated ? clientName : "غير محدد",
    actorKind: isClientCreated ? "client" : "unknown",
    actorKindLabel: isClientCreated ? "العميلة" : "غير محدد",
    atLabel: formatAnyDateTime(createdAtMs),
    changes: [],
    note: "",
    tone: "info",
    sortMs: createdAtMs,
  };
}

function buildFallbackUpdatedActivity(
  booking: Partial<Booking> | null | undefined,
  userNamesByUid: Record<string, string> = {},
  existingItems: BookingActivityItem[] = []
): BookingActivityItem | null {
  const updatedAtMs = toMillisSafe((booking as any)?.updatedAt);
  const createdAtMs = bookingCreationRefMs(booking);
  if (!updatedAtMs) return null;
  if (createdAtMs > 0 && updatedAtMs <= createdAtMs + 1000) return null;

  const hasNonCreatedEvent = existingItems.some((item) => item.title !== "تم إنشاء الحجز");
  if (hasNonCreatedEvent) return null;

  return mapBookingActivityItem(
    {
      id: `fallback-updated-${String(booking?.id || "booking")}`,
      type: "details_updated",
      eventAtMs: updatedAtMs,
      at: (booking as any)?.updatedAt,
      byUid: (booking as any)?.updatedByUid || null,
      byEmail: (booking as any)?.updatedByEmail || null,
      byName: (booking as any)?.updatedByName || null,
      patch: {},
    },
    booking,
    userNamesByUid
  );
}

function normalizeBookingActivityEventRaw(
  id: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const status = resolveBookingActivityStatus(data);
  const patch = {
    ...getBookingActivityPatch(data),
    ...(status ? { status } : {}),
  };

  return {
    id: `event_${id}`,
    ...data,
    type: resolveBookingActivityType(data) || String(data?.type || "").trim().toLowerCase() || "details_updated",
    patch,
    eventAtMs: resolveBookingActivitySortMs(data),
    at: data?.at,
  };
}

function normalizeBookingActivityAuditRaw(
  id: string,
  data: Record<string, unknown>
): Record<string, unknown> | null {
  const action = String(data?.action || "").trim().toLowerCase();
  const type = resolveBookingActivityType(data);
  if (!action.startsWith("booking_") && !type) return null;

  const status = resolveBookingActivityStatus(data);
  const patch = {
    ...getBookingActivityPatch(data),
    ...(status ? { status } : {}),
  };

  return {
    id: `audit_${id}`,
    type: type || "details_updated",
    action,
    patch,
    note: String(data?.description || "").trim(),
    byUid: data?.userUid || null,
    byEmail: data?.userEmail || null,
    byName: data?.userName || null,
    eventAtMs: resolveBookingActivitySortMs(data),
    at: data?.createdAt,
    createdAt: data?.createdAt,
    meta: data?.meta,
  };
}

function buildBookingLifecycleActivityItems(
  booking: Partial<Booking> | null | undefined,
  userNamesByUid: Record<string, string> = {}
) {
  if (!booking) return [] as BookingActivityItem[];

  const b: any = booking;
  const totalAmount = readBookingTotalAmount(booking);
  const basePatch = {
    customerName: b.customerName || undefined,
    phone: b.phone || undefined,
    date: b.date || undefined,
    time: b.time || undefined,
    employeeName: b.employeeName || undefined,
    serviceName: b.serviceName || undefined,
    serviceSnapshot: b.serviceSnapshot || undefined,
    finalPrice: totalAmount || undefined,
    total: totalAmount || undefined,
    paymentType: b.paymentType || undefined,
    paymentMethod: b.paymentMethod ?? undefined,
    paidAmount: Number.isFinite(Number(b.paidAmount)) ? Number(b.paidAmount) : undefined,
    remainingAmount: Number.isFinite(Number(b.remainingAmount)) ? Number(b.remainingAmount) : undefined,
    note: String(b.note || "").trim() || undefined,
  };

  const raws: Array<Record<string, unknown>> = [];
  const createdAtMs = bookingCreationRefMs(booking);
  if (createdAtMs > 0) {
    raws.push({
      id: `derived_created_${String(b.id || "booking")}`,
      type: "created",
      patch: basePatch,
      byUid: b.createdByUid || b.userId || null,
      byEmail: b.createdByEmail || null,
      byName: b.createdByName || null,
      eventAtMs: createdAtMs,
      at: b.createdAt || createdAtMs,
      note: "",
    });
  }

  const lifecycleEntries = [
    {
      key: "confirmed",
      at: Number(b.confirmedAt || 0),
      byUid: b.confirmedByUid || null,
      byEmail: b.confirmedByEmail || null,
      byName: b.confirmedByName || null,
    },
    {
      key: "completed",
      at: Number(b.completedAt || 0),
      byUid: b.completedByUid || null,
      byEmail: b.completedByEmail || null,
      byName: b.completedByName || null,
    },
    {
      key: "cancelled",
      at: Number(b.cancelledAt || 0),
      byUid: b.cancelledByUid || null,
      byEmail: b.cancelledByEmail || null,
      byName: b.cancelledByName || null,
    },
    {
      key: "pending",
      at: Number(b.pendingAt || 0),
      byUid: b.pendingByUid || null,
      byEmail: b.pendingByEmail || null,
      byName: b.pendingByName || null,
    },
  ];

  lifecycleEntries.forEach((entry) => {
    if (!Number.isFinite(entry.at) || entry.at <= 0) return;
    if (entry.key === "pending" && createdAtMs > 0 && entry.at <= createdAtMs + 1000) return;

    raws.push({
      id: `derived_${entry.key}_${String(b.id || "booking")}_${entry.at}`,
      type: "status_changed",
      patch: {
        status: entry.key,
      },
      byUid: entry.byUid,
      byEmail: entry.byEmail,
      byName: entry.byName,
      eventAtMs: entry.at,
      at: entry.at,
      note: "",
    });
  });

  return raws.map((raw) => mapBookingActivityItem(raw, booking, userNamesByUid));
}

function normalizeBookingActivityActorMergeKey(item: BookingActivityItem) {
  const actorName = String(item.actorName || "").trim();
  if (!actorName) return `${item.actorKind}:unknown`;
  return `${item.actorKind}:${normalizeArabicName(actorName) || actorName.toLowerCase()}`;
}

function sanitizeBookingActivityChanges(item: BookingActivityItem) {
  const redundantStatusChange =
    item.title === "تم تأكيد الحجز"
      ? "الحالة إلى مؤكد"
      : item.title === "تم إلغاء الحجز"
        ? "الحالة إلى ملغي"
        : item.title === "تم إكمال الحجز"
          ? "الحالة إلى مكتمل"
          : item.title === "تم تحويل الحجز إلى الانتظار"
            ? "الحالة إلى في الانتظار"
            : "";

  if (!redundantStatusChange) return Array.from(new Set(item.changes));
  return Array.from(new Set(item.changes)).filter((change) => change !== redundantStatusChange);
}

function mergeBookingActivityItems(items: BookingActivityItem[]) {
  const merged = new Map<string, BookingActivityItem>();

  items.forEach((item) => {
    const bucket = item.sortMs > 0 ? Math.round(item.sortMs / 1000) : 0;
    const fingerprint = `${item.eventKey}::${bucket}`;
    const existing = merged.get(fingerprint);

    if (!existing) {
      merged.set(fingerprint, { ...item, changes: [...item.changes] });
      return;
    }

    const shouldReplaceActor =
      existing.actorKind === "unknown" && item.actorKind !== "unknown";
    const mergedChanges = Array.from(new Set([...existing.changes, ...item.changes]));

    merged.set(fingerprint, {
      ...existing,
      ...(shouldReplaceActor
        ? {
            actorName: item.actorName,
            actorKind: item.actorKind,
            actorKindLabel: item.actorKindLabel,
          }
        : {}),
      tone: existing.tone === "default" && item.tone !== "default" ? item.tone : existing.tone,
      note: existing.note || item.note,
      changes: mergedChanges,
    });
  });

  const exactMerged = Array.from(merged.values())
    .map((item) => ({
      ...item,
      changes: sanitizeBookingActivityChanges(item),
    }))
    .sort((a, b) => a.sortMs - b.sortMs || a.id.localeCompare(b.id));

  const collapsed: BookingActivityItem[] = [];
  const confirmFlowWindowMs = 10_000;

  exactMerged.forEach((item) => {
    const last = collapsed[collapsed.length - 1];
    if (!last) {
      collapsed.push(item);
      return;
    }

    const sameActor =
      normalizeBookingActivityActorMergeKey(last) === normalizeBookingActivityActorMergeKey(item);
    const withinConfirmFlow =
      sameActor &&
      Math.abs(item.sortMs - last.sortMs) <= confirmFlowWindowMs &&
      (last.title === "تم تأكيد الحجز" || item.title === "تم تأكيد الحجز");

    if (!withinConfirmFlow) {
      collapsed.push(item);
      return;
    }

    const confirmItem = last.title === "تم تأكيد الحجز" ? last : item;
    const otherItem = confirmItem === last ? item : last;

    collapsed[collapsed.length - 1] = {
      ...confirmItem,
      id: `${confirmItem.id}__merged__${otherItem.id}`,
      sortMs: Math.max(confirmItem.sortMs, otherItem.sortMs),
      atLabel: formatAnyDateTime(Math.max(confirmItem.sortMs, otherItem.sortMs)),
      note: confirmItem.note || (otherItem.title === "تم تأكيد الحجز" ? otherItem.note : ""),
      changes: [],
    };
  });

  return collapsed;
}

function normalizeArabicName(input: string) {
  const s = String(input || "").trim().toLowerCase();
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

type BookingServiceItem = {
  serviceId?: string;
  serviceName?: string;
  price?: number;
  durationMin?: number;
  sectionLabel?: string;
  categoryLabel?: string;
};

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

type EditBookingDraft = {
  customerName: string;
  phone: string;
  note: string;
  date: string;
  time: string;
  sectionId: string;
  categoryId: string;
  serviceId: string;
  price: string;
  paymentMethod: EditPaymentMethodOption;
  paymentType: BookingPaymentType;
  paidAmount: string;
};

function buildEditBookingDraftFromBooking(b: Booking): EditBookingDraft {
  const payment = resolveBookingPaymentSummary(b);
  const paymentMethod = detectPaymentMethod(b);
  const primaryService = resolvePrimaryBookingServiceSelection(b);
  const hasNoPayment = Number(payment.paidAmount || 0) <= 0;

  return {
    customerName: String(b.customerName || "").trim(),
    phone: String(b.phone || "").trim(),
    note: String((b as any)?.note || "").trim(),
    date: String(b.date || "").trim(),
    time: String(b.time || "").trim(),
    sectionId: primaryService.sectionId,
    categoryId: primaryService.categoryId,
    serviceId: primaryService.serviceId,
    price: String(readBookingTotalAmount(b)),
    paymentMethod: (hasNoPayment ? "none" : paymentMethod) as EditPaymentMethodOption,
    paymentType: hasNoPayment ? "partial" : payment.paymentType,
    paidAmount: String(payment.paidAmount || 0),
  };
}

function readCatalogLabel(raw: any, fallback = ""): string {
  const obj = raw && typeof raw === "object" ? raw : {};
  const candidates = [
    obj?.name,
    obj?.title,
    obj?.serviceName,
    obj?.categoryName,
    obj?.sectionTitle,
    obj?.["الاسم"],
    obj?.["العنوان"],
  ];
  for (const value of candidates) {
    const txt = String(value || "").trim();
    if (txt) return txt;
  }
  return String(fallback || "").trim();
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
        firstPackageService?.sectionId ||
        ""
    ).trim(),
    categoryId: String(
      booking?.serviceSnapshot?.categoryIdAtBooking ||
        firstPackageService?.categoryId ||
        ""
    ).trim(),
  };
}

function toArabicOnlyLabel(value: string, fallback = "—"): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const dict: Record<string, string> = {
    makeup: "مكياج",
    "hair care": "العناية بالشعر",
    "hair-care": "العناية بالشعر",
    hair: "شعر",
    nails: "أظافر",
    skin: "بشرة",
    eyeliner: "ايلاينر",
  };

  let s = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  Object.entries(dict)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([en, ar]) => {
      const re = new RegExp(`\\b${en.replace(/\s+/g, "\\s+")}\\b`, "gi");
      s = s.replace(re, ar);
    });

  // منع أي كلمات إنجليزية متبقية من الظهور
  s = s.replace(/\b[A-Za-z]{2,}\b/g, " ").replace(/\s+/g, " ").trim();
  return s || fallback;
}

function toStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return [];
}

function extractServicesFromAny(anyB: any): BookingServiceItem[] {
  const pkgServices = Array.isArray(anyB?.packageSnapshot?.services) ? anyB.packageSnapshot.services : [];
  if (pkgServices.length) {
    return pkgServices
      .map((x: any) => ({
        serviceId: String(x?.serviceId ?? "").trim() || undefined,
        serviceName: toArabicOnlyLabel(String(x?.serviceName ?? "").trim(), "") || undefined,
        price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
        durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
        sectionLabel: toArabicOnlyLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
        categoryLabel: toArabicOnlyLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
      }))
      .filter((x: any) => x.serviceId || x.serviceName);
  }

  const sArr = Array.isArray(anyB?.services) ? anyB.services : null;
  if (sArr && sArr.length) {
    return sArr.map((x: any) => ({
      serviceId: String(x?.serviceId ?? x?.id ?? x?.key ?? "").trim() || undefined,
      serviceName: toArabicOnlyLabel(String(x?.serviceName ?? x?.name ?? "").trim(), "") || undefined,
      price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
      durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
      sectionLabel: toArabicOnlyLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
      categoryLabel: toArabicOnlyLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
    })).filter((x: any) => x.serviceId || x.serviceName);
  }
  const ids = toStringArray(anyB?.serviceIds);
  const names = toStringArray(anyB?.serviceNames);
  if (ids.length || names.length) {
    const max = Math.max(ids.length, names.length);
    const out: BookingServiceItem[] = [];
    for (let i = 0; i < max; i++) {
      if (ids[i] || names[i]) out.push({ serviceId: ids[i] || undefined, serviceName: names[i] || undefined });
    }
    return out;
  }
  const serviceId = String(anyB?.serviceId ?? anyB?.service ?? anyB?.serviceKey ?? "").trim();
  const serviceName = String(anyB?.serviceName ?? "").trim();
  if (serviceId || serviceName) {
    return [{
      serviceId: serviceId || undefined,
      serviceName: toArabicOnlyLabel(serviceName, "") || undefined,
      sectionLabel: toArabicOnlyLabel(String(anyB?.serviceSnapshot?.sectionTitleAtBooking || anyB?.serviceSnapshot?.sectionIdAtBooking || "").trim(), "") || undefined,
      categoryLabel: toArabicOnlyLabel(String(anyB?.serviceSnapshot?.categoryNameAtBooking || anyB?.serviceSnapshot?.categoryIdAtBooking || "").trim(), "") || undefined,
    }];
  }
  return [];
}

function serviceMetaSummaryForTable(b: Booking): string {
  const section = String(
    b?.serviceSnapshot?.sectionTitleAtBooking ||
      b?.serviceSnapshot?.sectionIdAtBooking ||
      ""
  ).trim();
  const category = String(
    b?.serviceSnapshot?.categoryNameAtBooking ||
      b?.serviceSnapshot?.categoryIdAtBooking ||
      ""
  ).trim();
  const pkgName = String(b?.packageSnapshot?.packageName || "").trim();
  const pkgCount = Array.isArray(b?.packageSnapshot?.services) ? b.packageSnapshot.services.length : 0;
  if (pkgName) return `${pkgName}${pkgCount > 0 ? ` (${pkgCount} خدمات)` : ""}`;
  if (section || category) return `${section || "—"}${category ? ` • ${category}` : ""}`;
  return "—";
}

function serviceSummaryForTable(b: Booking): string {
  const list = b.services || [];
  if (!list.length) return b.serviceName || b.serviceId || "—";
  const firstName = (list[0]?.serviceName || list[0]?.serviceId || "").trim();
  if (list.length <= 1) return firstName || b.serviceName || b.serviceId || "—";
  return `${firstName || (b.serviceName || b.serviceId || "خدمة")} + ${list.length - 1} خدمات`;
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
  date: string;
  time: string;
  status: BookingStatus;
  paymentMethod?: string;
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

type ClientLoyaltyInfo = {
  points: number;
  loyaltyScore: number;
  isVip: boolean;
};

type BookingLastUpdate = {
  by: string;
  at: string;
};

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
  return `حذف نهائي للحجز ${bookingRef(action.booking)}`;
}

type ActionPinModalProps = {
  action: SensitiveBookingAction | null;
  onClose: () => void;
  onConfirm: (action: SensitiveBookingAction) => Promise<void>;
};

const ActionPinModal = memo(function ActionPinModal({ action, onClose, onConfirm }: ActionPinModalProps) {
  const open = !!action;
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPin("");
    setBusy(false);
    setError("");
  }, [open, action?.kind]);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!action) return;
    if (String(pin).trim() !== BOOKING_ACTION_PIN) {
      setError("الرقم السري غير صحيح.");
      return;
    }

    let shouldClose = false;
    setBusy(true);
    setError("");

    try {
      await onConfirm(action);
      shouldClose = true;
    } catch {
      setError("تعذر إكمال الإجراء.");
    } finally {
      setBusy(false);
    }

    if (shouldClose) onClose();
  }, [action, onClose, onConfirm, pin]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      ariaLabel="التحقق بالرقم السري"
      panelClassName="bk-cancel-modal bk-action-pin-modal"
      size="sm"
    >
      <div className="bk-cancel-head">تأكيد الإجراء</div>
      <div className="bk-cancel-body">
        <div className="bk-action-pin-summary">
          <div className="bk-action-pin-summary-label">الإجراء المطلوب</div>
          <div className="bk-action-pin-summary-value">
            {sensitiveActionDescription(action) || "إجراء حساس"}
          </div>
          {action?.kind === "delete" ? (
            <div className="bk-action-pin-warning">تنبيه: الحذف النهائي لا يمكن التراجع عنه.</div>
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
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void handleConfirm();
            }}
            placeholder="أدخلي الرقم السري"
            autoComplete="new-password"
            name="booking_action_pin"
            inputMode="numeric"
            disabled={busy}
            autoFocus
          />
          <div className="bk-action-pin-hint">هذا التحقق مخصص لحماية التعديلات الحساسة.</div>
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
  date: string;
  time: string;
  disabled: boolean;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
};

const EditBookingScheduleSection = memo(function EditBookingScheduleSection({
  date,
  time,
  disabled,
  onDateChange,
  onTimeChange,
}: EditBookingScheduleSectionProps) {
  return (
    <div className="bk-edit-grid">
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
  disabled: boolean;
  onPriceChange: (value: string) => void;
  onPaymentModeChange: (mode: UiPaymentMode) => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onPaidAmountChange: (value: string) => void;
};

const EditBookingPaymentSection = memo(function EditBookingPaymentSection({
  price,
  paymentMethod,
  paymentType,
  paidAmount,
  disabled,
  onPriceChange,
  onPaymentModeChange,
  onPaymentMethodChange,
  onPaidAmountChange,
}: EditBookingPaymentSectionProps) {
  const remainingAfterEditText = useMemo(() => {
    const total = Math.max(0, Number(price || 0));
    const paid =
      paymentMethod === "none"
        ? 0
        : paymentType === "full"
          ? total
          : Math.max(0, Number(paidAmount || 0));
    return `${round2(Math.max(0, total - paid))} ر.س`;
  }, [paidAmount, paymentMethod, paymentType, price]);

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
            onChange={(e) => onPaymentMethodChange((e.target.value as PaymentMethod) || "transfer")}
            disabled={disabled}
          >
            <option value="cash">كاش</option>
            <option value="card">شبكة</option>
            <option value="transfer">تحويل</option>
            <option value="other">أخرى</option>
          </select>
        </label>
      ) : null}

      {paymentMethod !== "none" && paymentType === "partial" ? (
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
  const [draft, setDraft] = useState<EditBookingDraft>(() =>
    target
      ? buildEditBookingDraftFromBooking(target)
      : {
          customerName: "",
          phone: "",
          note: "",
          date: "",
          time: "",
          sectionId: "",
          categoryId: "",
          serviceId: "",
          price: "",
          paymentMethod: "transfer",
          paymentType: "full",
          paidAmount: "",
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
        const sectionsCol = collection(db, "salons", "main", "service_sections");
        let sectionsSnap;
        try {
          sectionsSnap = await getDocs(fsQuery(sectionsCol, orderBy("order", "asc")));
        } catch {
          sectionsSnap = await getDocs(sectionsCol);
        }

        if (cancelled) return;

        const nextSections = sectionsSnap.docs
          .map((docSnap) => {
            const raw = docSnap.data() as any;
            return {
              id: String(docSnap.id || "").trim(),
              name: readCatalogLabel(raw, String(docSnap.id || "").trim()),
              active: raw?.active !== false,
            };
          })
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
        const categoriesCol = collection(db, "salons", "main", "service_categories");
        const servicesCol = collection(db, "salons", "main", "services");

        let categoriesSnap;
        try {
          categoriesSnap = await getDocs(
            fsQuery(categoriesCol, where("sectionId", "==", sectionId), orderBy("order", "asc"))
          );
        } catch {
          categoriesSnap = await getDocs(fsQuery(categoriesCol, where("sectionId", "==", sectionId)));
        }

        let servicesSnap;
        try {
          servicesSnap = await getDocs(
            fsQuery(servicesCol, where("sectionId", "==", sectionId), orderBy("createdAt", "desc"))
          );
        } catch {
          servicesSnap = await getDocs(fsQuery(servicesCol, where("sectionId", "==", sectionId)));
        }

        if (cancelled) return;

        const nextCategories = categoriesSnap.docs
          .map((docSnap) => {
            const raw = docSnap.data() as any;
            return {
              id: String(docSnap.id || "").trim(),
              name: readCatalogLabel(raw, String(docSnap.id || "").trim()),
              sectionId: String(raw?.sectionId || sectionId).trim(),
              active: raw?.active !== false,
            };
          })
          .filter((row) => row.id && row.name && row.active);

        const nextServices = servicesSnap.docs
          .map((docSnap) => {
            const raw = docSnap.data() as any;
            const duration = Number(raw?.durationMin ?? raw?.duration ?? raw?.["المدة"] ?? 60) || 60;
            const price = Number(raw?.price ?? raw?.["السعر"] ?? 0) || 0;
            return {
              id: String(docSnap.id || "").trim(),
              name: readCatalogLabel(raw, String(docSnap.id || "").trim()),
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
        const snap = await getDoc(doc(db, "salons", "main", "services", currentServiceId));
        if (cancelled || !snap.exists()) return;

        const raw = snap.data() as any;
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
        price: nextService ? String(nextService.price || 0) : prev.price,
      }));
    },
    [filteredServices]
  );
  const onDateChange = useCallback((value: string) => {
    setDraft((prev) => (prev.date === value ? prev : { ...prev, date: value }));
  }, []);
  const onTimeChange = useCallback((value: string) => {
    setDraft((prev) => (prev.time === value ? prev : { ...prev, time: value }));
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
      return {
        ...p,
        paymentType: nextMode === "full" ? "full" : "partial",
        paymentMethod: p.paymentMethod === "none" ? "transfer" : p.paymentMethod,
      };
    });
  }, []);
  const onPaymentMethodChange = useCallback((method: PaymentMethod) => {
    setDraft((p) => ({ ...p, paymentMethod: method || "transfer" }));
  }, []);
  const onPaidAmountChange = useCallback((value: string) => {
    setDraft((prev) => (prev.paidAmount === value ? prev : { ...prev, paidAmount: value }));
  }, []);
  const onNoteChange = useCallback((value: string) => {
    setDraft((prev) => (prev.note === value ? prev : { ...prev, note: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!target?.id) return;

    const customerName = String(draft.customerName || "").trim();
    const phone = String(draft.phone || "").trim();
    const note = String(draft.note || "").trim();
    const date = String(draft.date || "").trim();
    const time = String(draft.time || "").trim();
    const sectionId = String(draft.sectionId || "").trim();
    const categoryId = String(draft.categoryId || "").trim();
    const serviceId = String(draft.serviceId || "").trim();
    const priceInput = String(draft.price || "").trim();
    const fallbackPrice = readBookingTotalAmount(target);
    const price = priceInput === "" ? fallbackPrice : Number(priceInput);
    const paymentType = draft.paymentType === "partial" ? "partial" : "full";
    const hasNoPaymentMethod = draft.paymentMethod === "none";
    const paymentMethod = (["cash", "card", "transfer", "other"] as const).includes(draft.paymentMethod as any)
      ? (draft.paymentMethod as PaymentMethod)
      : "transfer";

    const selectedService = services.find((service) => String(service.id || "").trim() === serviceId) || null;
    const selectedSection = sections.find((section) => String(section.id || "").trim() === sectionId) || null;
    const selectedCategory =
      categories.find((category) => String(category.id || "").trim() === categoryId) || null;

    let paidAmount = paymentType === "full" ? price : Number(draft.paidAmount || 0);
    if (hasNoPaymentMethod) paidAmount = 0;

    if (!customerName) {
      setError("اسم العميلة مطلوب.");
      return;
    }
    if (!sectionId) {
      setError("القسم مطلوب.");
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
    if (!/^([01]?\\d|2[0-3]):([0-5]\\d)$/.test(time)) {
      setError("الوقت غير صحيح (HH:MM).");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError("السعر غير صحيح.");
      return;
    }
    if (paymentType === "partial") {
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
    if (paidAmount >= price) {
      nextPaymentType = "full";
      paidAmount = price;
    }
    const remainingAmount = round2(Math.max(0, price - paidAmount));
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
      await updateBookingFields(target.id, patch);
      if (statusAfterEdit && statusAfterEdit !== target.status) {
        await updateBookingStatus(target.id, statusAfterEdit);
      }

      const resolvedStatus = statusAfterEdit || target.status;
      onSaved(target.id, {
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
      });

      shouldClose = true;
    } catch {
      setError("تعذر حفظ تعديل الحجز.");
    } finally {
      setSaving(false);
    }

    if (shouldClose) onClose();
  }, [categories, draft, onClose, onSaved, sections, services, target]);

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
            date={draft.date}
            time={draft.time}
            disabled={saving}
            onDateChange={onDateChange}
            onTimeChange={onTimeChange}
          />

          <EditBookingPaymentSection
            price={draft.price}
            paymentMethod={draft.paymentMethod}
            paymentType={draft.paymentType}
            paidAmount={draft.paidAmount}
            disabled={saving}
            onPriceChange={onPriceChange}
            onPaymentModeChange={onPaymentModeChange}
            onPaymentMethodChange={onPaymentMethodChange}
            onPaidAmountChange={onPaidAmountChange}
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
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusOption>("all");
  const [excludedStatus, setExcludedStatus] = useState<ExcludedStatusOption>("");
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilterOption>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savedNoteId, setSavedNoteId] = useState("");
  const [clientLoyalty, setClientLoyalty] = useState<ClientLoyaltyInfo | null>(null);
  const [clientLoyaltyLoading, setClientLoyaltyLoading] = useState(false);
  const [selectedBookingActivity, setSelectedBookingActivity] = useState<BookingActivityItem[]>([]);
  const [selectedBookingActivityLoading, setSelectedBookingActivityLoading] = useState(false);
  const [selectedBookingActivityError, setSelectedBookingActivityError] = useState("");
  const [userNamesByUid, setUserNamesByUid] = useState<Record<string, string>>({});
  const [lastUpdateMap, setLastUpdateMap] = useState<Record<string, BookingLastUpdate>>({});
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [refundBusyId, setRefundBusyId] = useState("");
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
  const [editTarget, setEditTarget] = useState<Booking | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Booking | null>(null);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [confirmDraft, setConfirmDraft] = useState({
    paymentMode: "full" as UiPaymentMode,
    paymentType: "full" as BookingPaymentType,
    paidAmount: "",
  });
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SensitiveBookingAction | null>(null);
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
  const authUser = getAuthUserSafe();
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

  useEffect(() => {
    return () => {
      if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadUserNames = async () => {
      try {
        const snap = await getDocs(collection(db, "salons", "main", "users"));
        snap.docs.forEach((d) => {
          if (d?.ref?.path) {
            FirestoreReadStats.bump(d.ref.path, "DashboardBookings.loadUserNames", "getDocs");
          }
        });
        const next: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data: any = d.data() || {};
          const uid = String(d.id || data?.uid || "").trim();
          const name = String(data?.displayName || data?.name || "").trim();
          const email = String(data?.email || "").trim();
          const fallback = email ? email.split("@")[0] : "";
          const finalName = name || fallback;
          if (uid && finalName) next[uid] = finalName;
        });
        if (!cancelled) setUserNamesByUid(next);
      } catch {
        if (!cancelled) setUserNamesByUid({});
      }
    };
    void loadUserNames();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const loaded = loadNotesMap();
    setNotesMap(loaded);
    setNoteDrafts(loaded);
    const unsub = watchAllBookings((data) => {
      const baseList = data.map((b: any) => ({
        ...b,
        customerName: String(b?.customerName || b?.clientName || b?.name || "").trim() || "",
        phone: String(b?.phone || b?.clientPhone || b?.customerPhone || "").trim() || "",
        services: extractServicesFromAny(b),
      }));
      setBookings(
        baseList.map((x) => ({
          ...x,
          customerName: x.customerName || "غير متوفر",
          phone: x.phone || "غير متوفر",
        }))
      );
      setLoading(false);

      // fallback: بعض السجلات القديمة الاسم/الجوال موجودين فقط في booking_tracks
      const missing = baseList.filter((x) => !String(x.customerName || "").trim() || !String(x.phone || "").trim());
      if (!missing.length) return;

      Promise.all(
        missing.map(async (x) => {
          try {
            const tr = doc(db, "salons", "main", "booking_tracks", x.id);
            FirestoreReadStats.bump(tr.path, "DashboardBookings.missingTrackFallback", "getDoc");
            const t = await getDoc(tr);
            if (!t.exists()) return x;
            const td: any = t.data() || {};
            const name = String(td?.clientName || td?.customerName || td?.name || "").trim();
            const phone = String(td?.clientPhone || td?.phone || td?.customerPhone || "").trim();
            return {
              ...x,
              customerName: x.customerName || name || "غير متوفر",
              phone: x.phone || phone || "غير متوفر",
            };
          } catch {
            return {
              ...x,
              customerName: x.customerName || "غير متوفر",
              phone: x.phone || "غير متوفر",
            };
          }
        })
      ).then((patched) => {
        const patchedMap = new Map(patched.map((p) => [p.id, p]));
        const finalList = baseList.map((x) => {
          const p = patchedMap.get(x.id);
          if (!p) {
            return {
              ...x,
              customerName: x.customerName || "غير متوفر",
              phone: x.phone || "غير متوفر",
            };
          }
          return p;
        });
        setBookings(finalList);
      });
    }, (err) => {
      setError("خطأ في تحميل الحجوزات");
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const loadRefundState = useCallback(async () => {
    const incomeRows = await listAllIncomeFS();
    const next: Record<string, RefundRecord> = {};
    incomeRows.forEach((x) => {
      const bookingId = String(x.bookingId || "").trim();
      if (!bookingId) return;
      if (Number(x.amount || 0) >= 0) return;
      const source = String(x.source || "").trim().toLowerCase();
      if (source !== "استرجاع" && source !== "refund") return;
      const noteRaw = String(x.note || "").trim();
      const noteWithoutPrefix = noteRaw.replace(/^استرجاع للحجز\s+[^\-]+-\s*/i, "");
      const [reason, details] = noteWithoutPrefix
        .split("|")
        .map((p) => String(p || "").trim());
      next[bookingId] = {
        incomeId: String(x.id || `refund_${bookingId}`),
        bookingId,
        amount: Math.abs(Number(x.amount || 0)),
        method: (String(x.method || "").trim() as PaymentMethod) || "transfer",
        reason: reason || noteWithoutPrefix || noteRaw,
        details: details || "",
        date: String(x.date || ""),
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
        const phoneRaw = String(selectedBooking.phone || "");
        const phoneDigits = digitsOnly(phoneRaw);
        const nameNorm = normalizeArabicName(String(selectedBooking.customerName || ""));

        let found: any = null;

        if (phoneDigits) {
          const q1 = fsQuery(
            collection(db, "users"),
            where("role", "==", "client"),
            where("phone", "==", phoneDigits),
            fsLimit(1)
          );
          const s1 = await getDocs(q1);
          if (!s1.empty) found = s1.docs[0].data();
        }

        if (!found && phoneRaw && phoneRaw !== "غير متوفر") {
          const q2 = fsQuery(
            collection(db, "users"),
            where("role", "==", "client"),
            where("phone", "==", phoneRaw),
            fsLimit(1)
          );
          const s2 = await getDocs(q2);
          if (!s2.empty) found = s2.docs[0].data();
        }

        if (!found && nameNorm) {
          const allClients = await getDocs(fsQuery(collection(db, "users"), where("role", "==", "client")));
          const match = allClients.docs.find((d) => {
            const x: any = d.data() || {};
            return normalizeArabicName(String(x.name || "")) === nameNorm;
          });
          if (match) found = match.data();
        }

        if (cancelled) return;

        if (!found) {
          setClientLoyalty({ points: 0, loyaltyScore: 0, isVip: false });
          return;
        }

        setClientLoyalty({
          points: Number(found?.loyaltyPoints || 0),
          loyaltyScore: Number(found?.loyaltyStats?.loyaltyScore || 0),
          isVip: !!found?.vip?.isVip,
        });
      } catch {
        if (!cancelled) setClientLoyalty({ points: 0, loyaltyScore: 0, isVip: false });
      } finally {
        if (!cancelled) setClientLoyaltyLoading(false);
      }
    };
    loadClientLoyalty();
    return () => {
      cancelled = true;
    };
  }, [selectedBooking]);

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
        const [eventsResult, auditResult] = await Promise.allSettled([
          getDocs(collection(db, "salons", "main", "booking_logs", selectedBooking.id, "events")),
          getDocs(
            fsQuery(collection(db, "salons", "main", "logs"), where("entityId", "==", selectedBooking.id))
          ),
        ]);

        if (cancelled) return;

        const activityItems: BookingActivityItem[] = [];
        const partialErrors: string[] = [];

        if (eventsResult.status === "fulfilled") {
          activityItems.push(
            ...eventsResult.value.docs.map((d) =>
              mapBookingActivityItem(
                normalizeBookingActivityEventRaw(d.id, d.data() as Record<string, unknown>),
                selectedBooking,
                userNamesByUid
              )
            )
          );
        } else {
          partialErrors.push("تعذر تحميل بعض أحداث الحجز من السجل المباشر.");
        }

        if (auditResult.status === "fulfilled") {
          activityItems.push(
            ...auditResult.value.docs
              .map((d) => normalizeBookingActivityAuditRaw(d.id, d.data() as Record<string, unknown>))
              .filter((entry): entry is Record<string, unknown> => !!entry)
              .map((entry) => mapBookingActivityItem(entry, selectedBooking, userNamesByUid))
          );
        } else {
          partialErrors.push("تعذر تحميل جزء من سجل العمليات العامة لهذا الحجز.");
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

  const filteredBase = useMemo(() => {
    let list = [...bookings];
    if (dateFrom || dateTo) {
      list = list.filter((b) => inDateRange(b.date, dateFrom, dateTo));
    }
    const search = normalizeArabicName(q);
    const searchRaw = String(q || "").trim().toLowerCase();
    const searchDigits = digitsOnly(searchRaw);
    if (search || searchRaw) {
      list = list.filter((b) => {
        const name = normalizeArabicName(b.customerName || "");
        const phone = (b.phone || "").toLowerCase();
        const emp = normalizeArabicName(b.employeeName || "");
        const ref = bookingRef(b).toLowerCase();
        const refDigits = digitsOnly(ref);
        return (
          (search ? name.includes(search) || emp.includes(search) : false) ||
          phone.includes(searchRaw) ||
          ref.includes(searchRaw) ||
          (!!searchDigits && refDigits.includes(searchDigits))
        );
      });
    }
    // Filter by role if staff
    if (uiRole === "staff") {
      list = list.filter((b) => {
        const bUid = String(b.employeeUid || "").trim();
        const bId = String(b.employeeId || "").trim();
        const bName = String(b.employeeName || "").trim();
        const myUid = auth.currentUser?.uid;
        if (myUid && bUid === myUid) return true;
        if (myUid && bId === myUid) return true;
        return bName && normalizeArabicName(bName).includes(normalizeArabicName(authUser.displayName));
      });
    }
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  }, [bookings, q, dateFrom, dateTo, uiRole, authUser]);

  const filtered = useMemo(() => {
    const statusScoped =
      statusFilter === "all"
        ? excludedStatus
          ? filteredBase.filter((b) => b.status !== excludedStatus)
          : filteredBase
        : filteredBase.filter((b) => b.status === statusFilter);

    if (settlementFilter === "unpaid") {
      return statusScoped.filter((b) => resolveBookingPaymentSummary(b).remainingAmount > 0);
    }

    return statusScoped;
  }, [filteredBase, statusFilter, excludedStatus, settlementFilter]);

  useEffect(() => {
    let cancelled = false;
    const loadLastUpdates = async () => {
      const rows = filtered;
      if (!rows.length) return;

      const entries = await Promise.all(
        rows.map(async (b) => {
          try {
            const q = fsQuery(
              collection(db, "salons", "main", "booking_logs", b.id, "events"),
              orderBy("at", "desc"),
              fsLimit(1)
            );
            const snap = await getDocs(q);
            if (snap.empty) {
              return [b.id, fallbackLastUpdateForBooking(b, userNamesByUid)] as const;
            }

            const ev = snap.docs[0].data();
            const eventAt = formatEventAt(ev?.at);
            return [
              b.id,
              {
                by: actorLabelFromEvent(ev, userNamesByUid, b),
                at: eventAt === "—" ? fallbackLastUpdateForBooking(b, userNamesByUid).at : eventAt,
              },
            ] as const;
          } catch {
            return [b.id, fallbackLastUpdateForBooking(b, userNamesByUid)] as const;
          }
        })
      );

      if (cancelled) return;
      setLastUpdateMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    };

    void loadLastUpdates();
    return () => {
      cancelled = true;
    };
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

  const groupedFiltered = useMemo(() => buildDashboardBookingBlocks(filtered), [filtered]);

  const bookingSections = useMemo<BookingDisplaySection[]>(() => {
    const normalRows: Booking[] = [];
    const internalRows: Booking[] = [];

    filtered.forEach((b) => {
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
  }, [filtered]);

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
    setPendingSensitiveAction(action);
  }, []);

  const sensitiveActionDescription = (action: SensitiveBookingAction | null) => {
    if (!action) return "";
    if (action.kind === "status") {
      return `تغيير حالة الحجز ${action.bookingRef} إلى ${statusLabel[action.nextStatus]}`;
    }
    if (action.kind === "edit") return `تعديل بيانات الحجز ${bookingRef(action.booking)}`;
    if (action.kind === "refund") return `إدارة استرجاع الحجز ${bookingRef(action.booking)}`;
    return `حذف نهائي للحجز ${bookingRef(action.booking)}`;
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
      });
      setConfirmError("");
      setConfirmTarget(target);
      return;
    }
    try {
      await updateBookingStatus(id, newStatus);
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
    const nextType = nextMode === "full" ? "full" : "partial";
    let paidAmount =
      nextMode === "full"
        ? totalAmount
        : nextMode === "none"
          ? 0
          : Number(confirmDraft.paidAmount || 0);

    if (nextMode === "partial") {
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

    try {
      setConfirmSaving(true);
      setConfirmError("");

      await updateBookingFields(confirmTarget.id, {
        paymentType,
        paidAmount: round2(paidAmount),
        remainingAmount,
      } as any);
      await updateBookingStatus(confirmTarget.id, "confirmed");

      // Ensure confirmed bookings with partial/full paid amount are reflected in income immediately.
      try {
        const bookingId = String(confirmTarget.id || "").trim();
        const syncMethod = detectPaymentMethod({
          ...confirmTarget,
          status: "confirmed",
          paymentType,
          paidAmount: round2(paidAmount),
          remainingAmount,
        } as Booking);

        if (bookingId && Number(paidAmount) > 0) {
          const incomeNote =
            paymentType === "partial"
              ? `عربون: ${round2(paidAmount)} ر.س | المتبقي: ${remainingAmount} ر.س`
              : undefined;

          const incomeDate = safeISODate(String(confirmTarget.date || "")) || todayISOLocal();
          await upsertIncomeFS({
            id: bookingId,
            bookingId,
            date: incomeDate,
            amount: round2(paidAmount),
            method: syncMethod,
            source: "booking",
            note: incomeNote,
            createdAt: Date.now(),
          });
        } else if (bookingId) {
          await removeIncomeFS(bookingId);
        }
      } catch (syncErr) {
        console.warn("confirm->income sync failed:", syncErr);
      }

      const localAuditPatch = getLocalActorAudit();
      const localPatch = {
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
      await updateBookingStatus(cancelTarget.id, "cancelled");
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
      alert("الحذف النهائي متاح للمالك فقط");
      return;
    }

    try {
      await deleteBooking(b.id);
      if (selectedBooking?.id === b.id) setSelectedBooking(null);
    } catch (e) {
      alert("تعذر حذف الحجز نهائيًا");
    }
  };

  const handleDeleteBooking = useCallback((b: Booking) => {
    if (uiRole !== "owner") {
      alert("الحذف النهائي متاح للمالك فقط");
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
    requestSensitiveAction({ kind: "edit", booking: b });
  }, [canEditBookings, requestSensitiveAction]);

  const applyLocalBookingPatch = useCallback(
    (bookingId: string, patch: Partial<Booking>) => {
      const id = String(bookingId || "").trim();
      if (!id) return;

      const localAuditPatch = getLocalActorAudit();
      setBookings((prev) => {
        const idx = prev.findIndex((row) => row.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch, ...localAuditPatch };
        return next;
      });
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
      await updateBookingFields(editTarget.id, patch);
      if (statusAfterEdit && statusAfterEdit !== editTarget.status) {
        await updateBookingStatus(editTarget.id, statusAfterEdit);
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
    } catch {
      setEditError("تعذر حفظ تعديل الحجز.");
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
    const refundAmount = -Math.abs(amountInput);

    try {
      setRefundBusyId(bookingId);
      setRefundSaving(true);
      setRefundError("");
      await upsertIncomeFS({
        id: `refund_${bookingId}`,
        date: refundDraft.date || todayISOLocal(),
        amount: refundAmount,
        method,
        source: "استرجاع",
        note: `استرجاع للحجز ${bookingRef(b)} - ${note}`,
        bookingId,
        createdAt: Date.now(),
      });
      await loadRefundState();
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
      await removeIncomeFS(existing.incomeId);
      await loadRefundState();
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
                    const channelBadge = bookingChannelBadgeText(b);
                    const isTemporaryInternal = isTemporaryNormalInternalBooking(b);
                    rows.push(
                      <tr
                        key={b.id}
                        className={`bk-row bk-row-${safeStatus}${isPendingDeposit ? " bk-row-pending-deposit" : ""}`}
                      >
                        <td>
                          <div className="bk-ref-cell">
                            <div className="bk-ref-code">{bookingRef(b)}</div>
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
                          <div className="bk-customer-phone">{b.phone || "—"}</div>
                        </td>
                        <td>
                          <div className="bk-service-main">{serviceSummaryForTable(b)}</div>
                          <div className="bk-service-meta">{serviceMetaSummaryForTable(b)}</div>
                        </td>
                        <td>
                          <span className="bk-employee-pill">{b.employeeName || "—"}</span>
                        </td>
                        <td>
                          <div className="bk-datetime-date">{b.date}</div>
                          <div className="bk-datetime-time">{formatTime12(b.time)}</div>
                        </td>
                        <td>
                          <div className="bk-update-by">{lastUpdateMap[b.id]?.by || "—"}</div>
                          <div className="bk-update-at">{lastUpdateMap[b.id]?.at || "—"}</div>
                        </td>
                        <td>
                          <div className="bk-payment-cell">
                            <span className="bk-price-pill">{payment.totalAmount} ر.س</span>
                            <span
                              className={`bk-payment-status ${
                                payment.remainingAmount <= 0
                                  ? "is-paid"
                                  : payment.paidAmount > 0
                                    ? "is-partial"
                                    : "is-unpaid"
                              }`}
                            >
                              {paymentStatusLabel(payment)}
                            </span>
                          </div>
                        </td>
                        <td className="bk-payment-details-cell">
                          <div className="bk-payment-breakdown">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={line.key} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{line.label}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value">{line.amount} ر.س</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="bk-actions-cell">
                          <div className="bk-actions-row">
                            <button className="exp-btn ghost sm" onClick={() => setSelectedBooking(b)}>
                              تفاصيل
                            </button>
                            {canEditBookings && (
                              <button className="exp-btn ghost sm" onClick={() => openEditBookingModal(b)}>
                                تعديل
                              </button>
                            )}
                            <button
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
                                    className="exp-btn danger sm"
                                    onClick={() => handleDeleteBooking(b)}
                                    title="حذف الحجز"
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
                                  className="exp-btn sm"
                                  onClick={() => handleUpdateStatus(b.id, "confirmed")}
                                >
                                  تأكيد
                                </button>
                                <button
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
                  const payment = resolveBookingPaymentSummary(b);
                  const isPendingDeposit = isPendingDepositBooking(b, payment);
                  const channelBadge = bookingChannelBadgeText(b);
                  const isTemporaryInternal = isTemporaryNormalInternalBooking(b);
                  return (
                    <div
                      key={b.id}
                      className={`bk-mobile-card bk-mobile-card-${safeStatus}${isPendingDeposit ? " is-pending-deposit" : ""}`}
                    >
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">رقم الحجز:</span>
                        <span className="bk-mobile-val" style={{ fontWeight: 900 }}>{bookingRef(b)}</span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">العميلة:</span>
                        <span className="bk-mobile-val">{b.customerName || "—"}</span>
                      </div>
                      <div className="bk-mobile-row">
                        <span className="bk-mobile-label">الجوال:</span>
                        <span className="bk-mobile-val">{b.phone || "—"}</span>
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
                        <span className="bk-mobile-val bk-mobile-date-val">{b.date} {formatTime12(b.time)}</span>
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
                          <div className="bk-mobile-payment-line">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={`mob_pay_${b.id}_${line.key}`} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{line.label}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value">{line.amount} ر.س</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="bk-mobile-actions">
                        <button className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                        {canEditBookings && (
                          <button className="exp-btn ghost sm w-100" onClick={() => openEditBookingModal(b)}>
                            تعديل
                          </button>
                        )}
                        <button
                          className="exp-btn ghost sm w-100 bk-refund-btn"
                          onClick={() => openRefundModal(b)}
                          disabled={!canManageRefund(b) || refundBusyId === b.id}
                        >
                          {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع مسجل" : "استرجاع"}
                        </button>
                        {(uiRole === "owner" || uiRole === "admin") && (
                          <>
                            {uiRole === "owner" && (
                              <button className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
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
                            <button className="exp-btn sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>
                              تأكيد
                            </button>
                            <button className="exp-btn danger sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>
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
        <div className="bk-bookings-section-empty">
          لا توجد حجوزات في هذا القسم حسب الفلاتر الحالية.
        </div>
      )}
    </section>
  ), [
    canEditBookings,
    canManageRefund,
    handleDeleteBooking,
    handleUpdateStatus,
    lastUpdateMap,
    openEditBookingModal,
    openRefundModal,
    refundBusyId,
    refundMapByBookingId,
    uiRole,
  ]);

  const bookingSectionsView = useMemo(
    () => bookingSections.map(renderBookingSection),
    [bookingSections, renderBookingSection]
  );

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

          <div className="bk-filters">
            <div className="bk-field">
              <label>بحث</label>
              <input 
                type="text"
                className="bk-input bk-search-input" 
                autoComplete="new-password"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                placeholder="اسم، هاتف، موظفة، أو رقم الحجز (MK)..." 
                value={q} 
                onChange={e => setQ(e.target.value)} 
              />
            </div>
            <div className="bk-field bk-field-date">
              <label>من تاريخ</label>
              <input
                type="date"
                className="bk-input bk-date-input"
                lang="ar-SA"
                dir="rtl"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
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
                onChange={e => setDateTo(e.target.value)}
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
                <option value="unpaid">لم يتم السداد</option>
              </select>
            </div>
          </div>
          <div className="bk-actions">
            <button className="exp-btn" onClick={handleExport}>
              <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
            </button>
            <button
              className="exp-btn ghost"
              onClick={() => {
                setQ("");
                setStatusFilter("all");
                setExcludedStatus("");
                setSettlementFilter("all");
                setDateFrom("");
                setDateTo("");
              }}
            >
              <FontAwesomeIcon icon={faRotate} /> إعادة ضبط
            </button>
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
                {groupedFiltered.flatMap((block) => {
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
                            <div className="bk-ref-code">{bookingRef(b)}</div>
                            <span className={`status-badge ${safeStatus}${isPendingDeposit ? " pending-deposit" : ""}`}>
                              {statusLabel[safeStatus]}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="bk-customer-name">{b.customerName || "—"}</div>
                          <div className="bk-customer-phone">{b.phone || "—"}</div>
                        </td>
                        <td>
                          <div className="bk-service-main">{serviceSummaryForTable(b)}</div>
                          <div className="bk-service-meta">{serviceMetaSummaryForTable(b)}</div>
                        </td>
                        <td>
                          <span className="bk-employee-pill">{b.employeeName || "—"}</span>
                        </td>
                        <td>
                          <div className="bk-datetime-date">{b.date}</div>
                          <div className="bk-datetime-time">{formatTime12(b.time)}</div>
                        </td>
                        <td>
                          <div className="bk-update-by">{lastUpdateMap[b.id]?.by || "—"}</div>
                          <div className="bk-update-at">{lastUpdateMap[b.id]?.at || "—"}</div>
                        </td>
                        <td>
                          <div className="bk-payment-cell">
                            <span className="bk-price-pill">{payment.totalAmount} ر.س</span>
                            <span
                              className={`bk-payment-status ${
                                payment.remainingAmount <= 0
                                  ? "is-paid"
                                  : payment.paidAmount > 0
                                    ? "is-partial"
                                    : "is-unpaid"
                              }`}
                            >
                              {paymentStatusLabel(payment)}
                            </span>
                          </div>
                        </td>
                        <td className="bk-payment-details-cell">
                          <div className="bk-payment-breakdown">
                            {paymentAmountsDisplayLines(payment).map((line) => (
                              <div key={line.key} className={`bk-payment-metric-row ${line.tone}`}>
                                <span className="bk-payment-metric-label">{line.label}</span>
                                {typeof line.amount === "number" ? (
                                  <span className="bk-payment-metric-value">{line.amount} ر.س</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="bk-actions-cell">
                          <div className="bk-actions-row">
                            <button className="exp-btn ghost sm" onClick={() => setSelectedBooking(b)}>
                              تفاصيل
                            </button>
                            {canEditBookings && (
                              <button className="exp-btn ghost sm" onClick={() => openEditBookingModal(b)}>
                                تعديل
                              </button>
                            )}
                            <button
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
                                    className="exp-btn danger sm"
                                    onClick={() => handleDeleteBooking(b)}
                                    title="حذف نهائي"
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
                                  className="exp-btn sm"
                                  onClick={() => handleUpdateStatus(b.id, "confirmed")}
                                >
                                  تأكيد
                                </button>
                                <button
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
            {groupedFiltered.map((block) => (
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
                      <span className="bk-mobile-val">{b.phone || "—"}</span>
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
                      <span className="bk-mobile-val bk-mobile-date-val">{b.date} {formatTime12(b.time)}</span>
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
                                <span className="bk-payment-metric-value">{line.amount} ر.س</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="bk-mobile-actions">
                       <button className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                       {canEditBookings && (
                         <button className="exp-btn ghost sm w-100" onClick={() => openEditBookingModal(b)}>
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
                             <button className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
                               حذف نهائي
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
                           <button className="exp-btn sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>
                             تأكيد
                           </button>
                           <button className="exp-btn danger sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>
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
                  حذف نهائي
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
                <div className="bk-action-pin-warning">تنبيه: الحذف النهائي لا يمكن التراجع عنه.</div>
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
                          paidAmount: "0",
                        };
                      }
                      return {
                        ...p,
                        paymentMode: nextMode,
                        paymentType: nextMode === "full" ? "full" : "partial",
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

              {confirmDraft.paymentMode === "partial" ? (
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
                    confirmDraft.paymentType === "full"
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
