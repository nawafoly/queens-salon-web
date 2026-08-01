import "../styles/AdminDashboardShell.css";
import "../styles/AdminDashboardOverview.css";
import "../styles/AdminDashboardBookings.css";
// ✅ src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, NavLink, useNavigate, Navigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faCalendarAlt,
  faChartLine,
  faCog,
  faUserShield,
  faUserTie,
  faUser,
  faPercent,
  faChartPie,
  faMoneyBillWave,
  faWallet,
  faXmark,
  faBars,
  faChevronLeft,
  faChevronRight,
  faHouse,
  faClockRotateLeft,
  faFingerprint,
  faTv,
  faStore,
} from "@fortawesome/free-solid-svg-icons";
import LoadingBrand from "../components/LoadingBrand";
import DashboardMobileNav from "../components/DashboardMobileNav";
import DashboardHeader from "../components/DashboardHeader";
import InternalPortalSwitcher from "../components/InternalPortalSwitcher";
import PermissionRoute from "../components/PermissionRoute";
import { usePermissions } from "../security/PermissionContext";
import Modal from "../components/Modal";

import DashboardBookings from "../pages/DashboardBookings";
import DashboardOffers from "../pages/DashboardOffers";
import DashboardReports from "./DashboardReports";
import DashboardClients from "./DashboardClients";
import DashboardLoyalty from "./DashboardLoyalty";
import DashboardSettings from "../pages/DashboardSettings";
import DashboardExpenses from "../pages/DashboardExpenses";
import DashboardIncome from "../pages/DashboardIncome";
import DashboardLogs from "../pages/DashboardLogs";
import DashboardQueueTv from "../pages/DashboardQueueTv";
import DashboardDayAudit from "../pages/DashboardDayAudit";
import DashboardAdminProfile from "../pages/DashboardAdminProfile";
import DashboardPartners from "../pages/DashboardPartners";
import DashboardAttendanceSecurity from "../pages/DashboardAttendanceSecurity";
import DashboardPayroll from "../pages/DashboardPayroll";
import DashboardEmployeeTargets from "../pages/DashboardEmployeeTargets";
import DashboardStaffPerformance from "../pages/DashboardStaffPerformance";
import "../styles/DashboardEnterpriseWorkspacesV2.css";


// ✅ NEW: الحجز الداخلي داخل الداشبورد
import BookingInternal from "../pages/BookingInternal";
import BookingInternalV2 from "../features/internal-booking-v2/BookingInternalV2";

import logo1 from "../assets/images/ssunnamed.png";

import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { readStoredAuthSession } from "../services/localAuthSession";
import { logoutFirebase } from "../services/authService";

import type { Booking, BookingStatus } from "../helpers/dashboardService";
import { DashboardService } from "../helpers/dashboardService";

import {
  listAllBookings as listAllBookingsFS,
  updateBookingStatus as updateBookingStatusFS,
  type BookingDocWithId,
} from "../services/firestoreBookings";

import {
  listAllExpensesFS,
  countMonthlyExpensesMissingNotesFS,
} from "../services/firestoreExpenses";

import { listAllIncomeFS } from "../services/firestoreIncome";

import {
  canAccessDashboard,
  type UiRole as ProfileRole,
  type UserProfile,
} from "../services/userProfile";
import { readVerifiedUserAccess } from "../services/authAccess";

// ✅ NEW: App Settings from Firestore (settings/app)
import { AppSettingsService } from "../services/AppSettingsService";

import { resolveServiceName } from "../services/serviceResolver";
import { isStaffOperationallyActiveForDate } from "../helpers/staffAvailability";
import { normalizeTimeToHHMM, timeToMinutes } from "../helpers/timeContract";
import {
  formatTime12,
  round2,
  toMillisSafeDashboard as toMillisSafe,
} from "../helpers/pageSharedUtils";

/** ===== Settings (LocalStorage fallback) ===== */
type SectionKey =
  | "overview"
  | "bookings"
  | "clients"
  | "employees"
  | "offers"
  | "reports"
  | "income"
  | "expenses"
  | "logs"
  | "settings";

type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type BusinessHoursDay = { enabled?: boolean; start?: string; end?: string };
type BusinessHoursMap = Partial<Record<WeekdayKey, BusinessHoursDay>>;
type BookingHourOverride = {
  fromDate?: string;
  toDate?: string;
  mode?: "hours" | "closed";
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};
type StaffOperationalRow = {
  id: string;
  name?: string;
  linkedUid?: string;
  active?: boolean;
  employmentEndDate?: string;
};
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type DashboardStats = {
  todayBookings: number;
  totalRevenue: number;
  totalOperations: number;
  employeesCount: number;
};

type DashboardFinanceTransaction = {
  id: string;
  type: "income" | "expense";
  title: string;
  amount: number;
  date: string;
  createdAt: number;
};

type DashboardSnapshot = {
  stats: DashboardStats;
  allScheduleBookings: Booking[];
  staffOperationalRows: StaffOperationalRow[];
  expensesTotalFS: number;
  incomeTotalFS: number;
  financeToday: { income: number; expenses: number; net: number };
  recentFinanceTransactions: DashboardFinanceTransaction[];
  savedAt: number;
};

const DASHBOARD_VIEW_CACHE_KEY = "dashboard_view_cache_v1";
const emptyDashboardStats: DashboardStats = {
  todayBookings: 0,
  totalRevenue: 0,
  totalOperations: 0,
  employeesCount: 0,
};
const emptyFinanceToday = { income: 0, expenses: 0, net: 0 };

let dashboardViewMemoryCache: DashboardSnapshot | null = null;

function readDashboardViewCache(): DashboardSnapshot | null {
  if (dashboardViewMemoryCache) return dashboardViewMemoryCache;
  try {
    const raw = localStorage.getItem(DASHBOARD_VIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    dashboardViewMemoryCache = parsed;
    return parsed;
  } catch {
    return dashboardViewMemoryCache;
  }
}

function writeDashboardViewCache(snapshot: DashboardSnapshot) {
  dashboardViewMemoryCache = snapshot;
  try {
    localStorage.setItem(DASHBOARD_VIEW_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore cache write failures
  }
}

function clearDashboardViewCache() {
  dashboardViewMemoryCache = null;
  try {
    localStorage.removeItem(DASHBOARD_VIEW_CACHE_KEY);
  } catch {
    // ignore cache clear failures
  }
}

function formatLocalDateISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeISODateLoose(value: any): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const strict = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (strict) return `${strict[1]}-${strict[2]}-${strict[3]}`;

  const loose = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (loose) {
    const year = Number(loose[1]);
    const month = Number(loose[2]);
    const day = Number(loose[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return formatLocalDateISO(new Date(parsed));
}

function resolveBookingDateISO(rawDate: any, createdAt?: any, updatedAt?: any): string {
  const explicit = normalizeISODateLoose(rawDate);
  if (explicit) return explicit;

  const fallbackMs = Math.max(toMillisSafe(createdAt), toMillisSafe(updatedAt));
  if (!Number.isFinite(fallbackMs) || fallbackMs <= 0) return "";
  return formatLocalDateISO(new Date(fallbackMs));
}

function isBookingOnDate(booking: Pick<Booking, "date" | "createdAt">, targetDateISO: string): boolean {
  const target = normalizeISODateLoose(targetDateISO);
  if (!target) return false;
  return resolveBookingDateISO(booking.date, booking.createdAt) === target;
}

function normalizeStaffNameKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sortScheduleBookings(rows: Booking[]): Booking[] {
  return [...rows].sort((a, b) => {
    const aMin = parseTimeToMinutes(a.time);
    const bMin = parseTimeToMinutes(b.time);
    if (aMin === null && bMin === null) return 0;
    if (aMin === null) return 1;
    if (bMin === null) return -1;
    return aMin - bMin;
  });
}

function filterOperationalScheduleBookings(
  rows: Booking[],
  targetDateISO: string,
  staffRows: StaffOperationalRow[]
): Booking[] {
  const targetDate = normalizeISODateLoose(targetDateISO);
  const base = (rows || []).filter((b) => isBookingOnDate(b, targetDateISO) && b.status !== "cancelled");
  if (!targetDate) return sortScheduleBookings(base);

  const today = formatLocalDateISO(new Date());
  if (targetDate < today || !staffRows.length) {
    return sortScheduleBookings(base);
  }

  const byId = new Map<string, StaffOperationalRow>();
  const byUid = new Map<string, StaffOperationalRow>();
  const byName = new Map<string, StaffOperationalRow>();

  staffRows.forEach((staff) => {
    const id = String(staff.id || "").trim();
    if (id) byId.set(id, staff);

    const linkedUid = String(staff.linkedUid || "").trim();
    if (linkedUid) byUid.set(linkedUid, staff);

    const nameKey = normalizeStaffNameKey(staff.name);
    if (nameKey) byName.set(nameKey, staff);
  });

  return sortScheduleBookings(
    base.filter((booking) => {
      const matchedStaff =
        byId.get(String((booking as any).employeeId || "").trim()) ||
        byUid.get(String((booking as any).employeeUid || "").trim()) ||
        byName.get(normalizeStaffNameKey(booking.employeeName));

      if (!matchedStaff) return true;
      return isStaffOperationallyActiveForDate(matchedStaff as any, targetDate);
    })
  );
}

function weekdayKeyFromISODate(dateStr: string): WeekdayKey | null {
  const m = String(dateStr || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Math.max(0, Number(m[2]) - 1), Number(m[3]));
  return JS_DAY_TO_WEEKDAY[dt.getDay()] || null;
}

type AppSettings = {
  salonName: string;
  phone: string;
  city: string;
  sections: Record<SectionKey, boolean>;
  policies: {
    allowStaffChangeStatus: boolean;
    allowReceptionChangeStatus: boolean;
    allowStaffViewClients: boolean;
    allowAdminManageUsers: boolean;
  };
  booking?: {
    businessHours?: BusinessHoursMap;
    bookingHourOverrides?: BookingHourOverride[];
    autoCloseGraceMin?: number;
  };
};

const SETTINGS_KEY = "dashboard_settings_v1";
const DASHBOARD_BOOTSTRAPPED_KEY = "dashboard_bootstrapped_once_v1";

const defaultSettings: AppSettings = {
  salonName: "MALIKAT SALON",
  phone: "",
  city: "",
  sections: {
    overview: true,
    bookings: true,
    clients: true,
    employees: true,
    offers: true,
    reports: true,
    income: true,
    expenses: true,
    logs: true,
    settings: true,
  },
  policies: {
    allowStaffChangeStatus: true,
    allowReceptionChangeStatus: true,
    allowStaffViewClients: true,
    allowAdminManageUsers: false,
  },
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);

    return {
      ...defaultSettings,
      ...parsed,
      sections: { ...defaultSettings.sections, ...(parsed?.sections || {}) },
      policies: { ...defaultSettings.policies, ...(parsed?.policies || {}) },
    };
  } catch {
    return defaultSettings;
  }
}

function parseTimeToMinutes(time24: string): number | null {
  return timeToMinutes(time24);
}

function formatDateTimeAr(v: any): string {
  const ms = toMillisSafe(v);
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}

function bookingNoOf(b: Partial<Booking> | null | undefined) {
  const raw = String(b?.publicId || "").trim();
  if (!raw) return "—";
  const up = raw.toUpperCase();
  if (/^MK-\d+$/.test(up)) return up;
  if (/^\d+$/.test(up)) return `MK-${up}`;
  return up;
}

function financeSourceLabelAr(raw: unknown): string {
  const s = String(raw || "").toLowerCase().trim();
  if (s === "booking") return "حجز";
  if (s === "invoice") return "فاتورة";
  if (s === "manual") return "يدوي";
  if (s === "other" || s === "دخل آخر") return "دخل آخر";
  if (s === "income" || s === "revenue") return "إيراد";
  return String(raw || "").trim() || "إيراد";
}

function normalizePaymentType(raw: unknown): "full" | "partial" | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

function resolveBookingPayment(raw: any): {
  paidAmount: number;
  totalAmount: number;
  paymentType: "full" | "partial";
  remainingAmount: number;
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
  const hasExplicitRemaining = Number.isFinite(Number(raw?.remainingAmount));
  const explicitRemaining = hasExplicitRemaining ? Number(raw?.remainingAmount) : NaN;
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: "full" | "partial" = normalizedType || (isRevenueStatus ? "full" : "partial");
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

  return {
    paidAmount: round2(Math.max(0, Math.min(totalAmount, paidAmount))),
    totalAmount: round2(totalAmount),
    paymentType,
    remainingAmount: round2(Math.max(0, totalAmount - paidAmount)),
  };
}

function hasReliableBookingPayment(raw: any): boolean {
  if (Number.isFinite(Number(raw?.paidAmount))) return true;
  if (Number.isFinite(Number(raw?.remainingAmount))) return true;
  const normalizedType = normalizePaymentType(raw?.paymentType);
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";
  return normalizedType === "full" && isRevenueStatus;
}

function resolveLinkedBookingIdFromIncome(item: any): string {
  const source = String(item?.source || "").trim().toLowerCase();
  const isRefundLike =
    source === "refund" ||
    source === "\u0627\u0633\u062a\u0631\u062c\u0627\u0639" ||
    String(item?.id || "").startsWith("refund_") ||
    Number(item?.amount || 0) < 0;
  if (isRefundLike) return "";

  const explicit = String(item?.bookingId || "").trim();
  if (explicit) return isLikelySystemIncomeSource(source) ? explicit : "";
  if (source === "booking" || source === "\u062d\u062c\u0632") return String(item?.id || "").trim();
  return "";
}

function isoDayIndex(iso: string): number {
  const m = String(iso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

function isLikelySystemIncomeSource(sourceRaw: unknown): boolean {
  const source = String(sourceRaw || "").trim().toLowerCase();
  return (
    source === "booking" ||
    source === "invoice" ||
    source === "internal_booking" ||
    source === "\u062d\u062c\u0632" ||
    source === "\u0641\u0627\u062a\u0648\u0631\u0629"
  );
}

function resolveIncomeDateForTodayFilter(item: any): string {
  const explicit = normalizeISODateLoose(item?.date);
  const createdAtMs = toMillisSafe(item?.createdAt || item?.updatedAt);
  const createdAtISO = createdAtMs > 0 ? formatLocalDateISO(new Date(createdAtMs)) : "";
  return explicit || createdAtISO;
}

function isIncomeOnDate(item: any, targetDateISO: string): boolean {
  const target = normalizeISODateLoose(targetDateISO);
  if (!target) return false;
  return resolveIncomeDateForTodayFilter(item) === target;
}

function resolveIncomeEffectiveAmount(item: any, bookingPaidById: Record<string, number>): number {
  const linkedBookingId = resolveLinkedBookingIdFromIncome(item);
  if (linkedBookingId && Object.prototype.hasOwnProperty.call(bookingPaidById, linkedBookingId)) {
    const resolved = Number(bookingPaidById[linkedBookingId]);
    if (Number.isFinite(resolved)) return resolved;
  }
  return Number(item?.amount || 0);
}

function bookingStatusLabelAr(status: BookingStatus | string): string {
  const s = String(status || "").toLowerCase().trim();
  if (s === "confirmed") return "مؤكد";
  if (s === "pending") return "في الانتظار";
  if (s === "cancelled") return "ملغي";
  if (s === "completed") return "مكتمل";
  return String(status || "-");
}

type BookingActivityActorKind = "client" | "staff" | "admin" | "system" | "unknown";
type BookingActivityTone = "default" | "success" | "danger" | "info";
type BookingActivityItem = {
  id: string;
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
    .map((v) => String(v || "").toLowerCase().trim())
    .join(" ");

  return (
    hay.includes("النظام") ||
    hay.includes("تلقائي") ||
    /\b(system|auto|automatic)\b/i.test(hay)
  );
}

function resolveBookingActivitySortMs(raw: any) {
  const direct = Number(raw?.eventAtMs || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const atMs = toMillisSafe(raw?.at);
  if (atMs > 0) return atMs;
  return 0;
}

function resolveBookingActivityTitle(raw: any) {
  const type = String(raw?.type || "").trim().toLowerCase();
  const status = String(raw?.patch?.status || "").trim().toLowerCase();

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
  const type = String(raw?.type || "").trim().toLowerCase();
  const status = String(raw?.patch?.status || "").trim().toLowerCase();

  if (type === "created") return "info";
  if (type === "details_updated" || type === "staff_acknowledged") return "default";
  if (status === "confirmed" || status === "completed") return "success";
  if (status === "cancelled" || status === "canceled") return "danger";
  return "default";
}

function resolveBookingActivityActor(raw: any, booking: Booking) {
  const bookingClientName = String(booking?.customerName || "").trim();
  const byName = String(raw?.byName || "").trim();
  const byEmail = String(raw?.byEmail || "").trim();
  const byUid = String(raw?.byUid || "").trim();

  if (isAutomaticBookingActivity(raw)) {
    return {
      actorName: "النظام",
      actorKind: "system" as BookingActivityActorKind,
    };
  }

  if (byName) {
    const isClient =
      !!bookingClientName &&
      normalizeArabicLabel(byName) === normalizeArabicLabel(bookingClientName);
    return {
      actorName: isClient ? bookingClientName : byName,
      actorKind: isClient
        ? ("client" as BookingActivityActorKind)
        : String(raw?.type || "").trim().toLowerCase() === "staff_acknowledged"
          ? ("staff" as BookingActivityActorKind)
          : isMalikatAdminEmail(byEmail)
            ? ("admin" as BookingActivityActorKind)
            : ("unknown" as BookingActivityActorKind),
    };
  }

  if (byEmail) {
    const fallback = byEmail.split("@")[0] || byEmail;
    const isClient =
      !!bookingClientName &&
      normalizeArabicLabel(fallback) === normalizeArabicLabel(bookingClientName);
    return {
      actorName: isClient ? bookingClientName : fallback,
      actorKind: isClient
        ? ("client" as BookingActivityActorKind)
        : isMalikatAdminEmail(byEmail)
          ? ("admin" as BookingActivityActorKind)
          : ("unknown" as BookingActivityActorKind),
    };
  }

  if (byUid) {
    return {
      actorName: `#${byUid.slice(0, 8)}`,
      actorKind:
        String(raw?.type || "").trim().toLowerCase() === "staff_acknowledged"
          ? ("staff" as BookingActivityActorKind)
          : ("unknown" as BookingActivityActorKind),
    };
  }

  if (String(raw?.type || "").trim().toLowerCase() === "created" && bookingClientName) {
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
  const patch = raw?.patch && typeof raw.patch === "object" ? raw.patch : {};
  const changes: string[] = [];

  const push = (value: string) => {
    const txt = String(value || "").trim();
    if (!txt) return;
    if (!changes.includes(txt)) changes.push(txt);
  };

  const serviceName = String(
    patch?.serviceSnapshot?.serviceNameAtBooking ||
      patch?.serviceName ||
      patch?.serviceId ||
      ""
  ).trim();
  const sectionName = String(
    patch?.serviceSnapshot?.sectionTitleAtBooking ||
      patch?.serviceSectionName ||
      ""
  ).trim();
  const categoryName = String(
    patch?.serviceSnapshot?.categoryNameAtBooking ||
      patch?.serviceCategoryName ||
      ""
  ).trim();
  const clientName = String(patch?.clientName || patch?.customerName || "").trim();
  const clientPhone = String(
    patch?.clientPhone || patch?.customerPhone || patch?.phone || ""
  ).trim();
  const totalRaw = Number(patch?.finalPrice ?? patch?.total);

  if (patch?.date) push(`التاريخ إلى ${String(patch.date).trim()}`);
  if (patch?.time) push(`الوقت إلى ${formatTime12(String(patch.time).trim())}`);
  if (patch?.employeeName) push(`الموظفة إلى ${String(patch.employeeName).trim()}`);
  if (serviceName) push(`الخدمة إلى ${serviceName}`);
  if (sectionName) push(`القسم إلى ${sectionName}`);
  if (categoryName) push(`التصنيف إلى ${categoryName}`);
  if (clientName) push(`العميلة إلى ${clientName}`);
  if (clientPhone) push(`رقم الجوال إلى ${clientPhone}`);
  if (Number.isFinite(totalRaw) && totalRaw > 0) push(`الإجمالي إلى ${totalRaw} ريال`);

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
  if (String(raw?.type || "").trim().toLowerCase() === "status_changed") return "";
  return note;
}

function mapBookingActivityItem(raw: any, booking: Booking): BookingActivityItem {
  const actor = resolveBookingActivityActor(raw, booking);
  const sortMs = resolveBookingActivitySortMs(raw) || toMillisSafe((booking as any)?.createdAt);

  return {
    id: String(raw?.id || raw?.eventId || `${sortMs}-${raw?.type || "event"}`),
    title: resolveBookingActivityTitle(raw),
    actorName: actor.actorName,
    actorKind: actor.actorKind,
    actorKindLabel: bookingActivityActorKindLabelAr(actor.actorKind),
    atLabel: formatDateTimeAr(sortMs),
    changes: resolveBookingActivityChanges(raw),
    note: resolveBookingActivityNote(raw),
    tone: resolveBookingActivityTone(raw),
    sortMs,
  };
}

function buildFallbackCreatedActivity(booking: Booking): BookingActivityItem | null {
  const createdAtMs = toMillisSafe((booking as any)?.createdAt);
  if (!createdAtMs) return null;

  return {
    id: `fallback-created-${booking.id}`,
    title: "تم إنشاء الحجز",
    actorName: String(booking.customerName || "").trim() || "غير محدد",
    actorKind: String(booking.customerName || "").trim() ? "client" : "unknown",
    actorKindLabel: String(booking.customerName || "").trim() ? "العميلة" : "غير محدد",
    atLabel: formatDateTimeAr(createdAtMs),
    changes: [],
    note: "",
    tone: "info",
    sortMs: createdAtMs,
  };
}

/** ✅ تحويل حجز Firestore لشكل Booking اللي تستخدمه الواجهة */
async function mapFirestoreToUiBooking(b: BookingDocWithId): Promise<Booking> {
  const serviceId = (b as any)?.serviceId || b.serviceName || "";
  const normalizedDate = resolveBookingDateISO(b.date, (b as any)?.createdAt, (b as any)?.updatedAt);
  const rawTime = String(b.time || "").trim();
  const normalizedTime = normalizeTimeToHHMM(rawTime) || rawTime;

  return {
    id: b.id,
    publicId: (b as any)?.publicId ? String((b as any).publicId) : undefined,
    customerName: b.clientName || "-",
    phone: b.clientPhone || "",
    serviceId,
    serviceName: await resolveServiceName(serviceId),
    serviceSectionName:
      (b as any)?.serviceSnapshot?.sectionTitleAtBooking ||
      (b as any)?.sectionTitleAtBooking ||
      (b as any)?.serviceSectionTitle ||
      "",
    serviceCategoryName:
      (b as any)?.serviceSnapshot?.categoryNameAtBooking ||
      (b as any)?.categoryNameAtBooking ||
      (b as any)?.serviceCategoryName ||
      "",
    employeeName: b.employeeName || "",
    employeeId: String((b as any)?.employeeId || "").trim() || null,
    employeeUid: String((b as any)?.employeeUid || "").trim() || null,
    date: normalizedDate,
    time: normalizedTime,
    status: (b.status || "pending") as BookingStatus,
    total: Number(b.finalPrice ?? (b as any).total ?? 0),
    createdAt: toMillisSafe((b as any)?.createdAt || (b as any)?.updatedAt) || Date.now(),
    note: (b.note as any) || undefined,
  };
}

/** ===== Overview ===== */
type OverviewProps = {
  userInfo: any;
  stats: {
    todayBookings: number;
    totalRevenue: number;
    totalOperations: number;
    employeesCount: number;
  };
  scheduleBookings: Booking[];
  selectedScheduleDate: string;
  onSelectedScheduleDateChange: (nextDate: string) => void;
  businessHours?: BusinessHoursMap;
  onOpenBooking: (booking: Booking) => void;
  onQuickAction: (key: "newBooking" | "bookings" | "reports") => void;
  financial: {
    income: number;
    expenses: number;
    profit: number;
  };
  financeToday: {
    income: number;
    expenses: number;
    net: number;
  };
  recentFinanceTransactions: Array<{
    id: string;
    type: "income" | "expense";
    title: string;
    amount: number;
    date: string;
    createdAt: number;
  }>;
};

const DashboardOverview: React.FC<OverviewProps> = ({
  userInfo,
  stats,
  scheduleBookings,
  selectedScheduleDate,
  onSelectedScheduleDateChange,
  businessHours,
  onOpenBooking,
  onQuickAction,
  financial,
  financeToday,
  recentFinanceTransactions,
}) => {
  const todayISO = useMemo(() => formatLocalDateISO(new Date()), []);
  const scheduleDateInputRef = useRef<HTMLInputElement | null>(null);

  const openScheduleDatePicker = () => {
    const el = scheduleDateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    el.focus();
    if (typeof el.showPicker === "function") el.showPicker();
  };

  const statusLabel = useMemo(
    () =>
    ({
      confirmed: "مؤكد",
      pending: "في الانتظار",
      cancelled: "ملغي",
      completed: "مكتمل",
    } as Record<BookingStatus, string>),
    []
  );

  const hourRows = useMemo(() => {
    const bookingByHour = new Map<number, Booking[]>();

    const sorted = (scheduleBookings || [])
      .map((booking) => ({ booking, minute: parseTimeToMinutes(booking.time) }))
      .filter((x): x is { booking: Booking; minute: number } => x.minute !== null)
      .sort((a, b) => a.minute - b.minute);

    sorted.forEach(({ booking, minute }) => {
      const hour = Math.floor(minute / 60);
      if (!bookingByHour.has(hour)) bookingByHour.set(hour, []);
      bookingByHour.get(hour)!.push(booking);
    });

    return Array.from(bookingByHour.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, bookings]) => ({ hour, bookings }));
  }, [scheduleBookings, businessHours]);

  const scheduleHint = useMemo(() => {
    const dateKey = weekdayKeyFromISODate(selectedScheduleDate);
    const dayHours = dateKey ? businessHours?.[dateKey] : undefined;

    if (dayHours?.enabled === false) return "اليوم المختار مغلق حسب إعدادات ساعات العمل";

    const start = String(dayHours?.start || "").trim();
    const end = String(dayHours?.end || "").trim();
    if (start && end) return `ساعات العمل لليوم المختار: ${formatTime12(start)} - ${formatTime12(end)}`;

    return "اضغط على أي حجز لعرض التفاصيل";
  }, [businessHours, selectedScheduleDate]);

  const formatHourLabel = (hour: number) => {
    const normalized = ((hour % 24) + 24) % 24;
    return formatTime12(`${String(normalized).padStart(2, "0")}:00`);
  };

  const formatFinanceDate = (iso: string) => {
    const v = String(iso || "").trim();
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return v || "-";
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  return (
    <div className="overview-page madan-overview-v2">
      <div className="overview-header">
        <div className="overview-title">
          <span className="overview-kicker">لوحة التشغيل اليومية</span>
          <h1>مرحباً بك، {userInfo.name}</h1>
          <p>إليك نظرة عامة واضحة ومباشرة على أنشطة الصالون اليوم</p>
        </div>

        <div className="overview-live-status" aria-label="حالة البيانات">
          <span className="overview-live-status__dot" aria-hidden="true" />
          <div>
            <strong>بيانات مباشرة</strong>
            <small>تتحدث مع نشاط لوحة التحكم</small>
          </div>
        </div>
      </div>

      <div className="overview-content">
        <div className="overview-section-heading">
          <div>
            <span>المؤشرات الرئيسية</span>
            <h2>أداء الصالون اليوم</h2>
          </div>
          <p>قراءة سريعة للحجوزات والإيرادات وحركة التشغيل.</p>
        </div>

        <div className="overview-grid overview-grid--primary">
          <div
            className="ov-stat-card ov-stat-card--bookings"
            role="button"
            onClick={() => onQuickAction("bookings")}
          >
            <div className="ov-icon">
              <FontAwesomeIcon icon={faCalendarAlt} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.todayBookings}</h3>
              <p>حجوزات اليوم</p>
            </div>
          </div>

          <div
            className="ov-stat-card ov-stat-card--revenue"
            role="button"
            onClick={() => onQuickAction("reports")}
          >
            <div className="ov-icon">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.totalRevenue.toLocaleString()}</h3>
              <p>الإيرادات (من الحجوزات)</p>
            </div>
          </div>

          <div
            className="ov-stat-card ov-stat-card--operations"
            role="button"
            onClick={() => onQuickAction("bookings")}
          >
            <div className="ov-icon">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.totalOperations}</h3>
              <p>إجمالي العمليات</p>
            </div>
          </div>

          <div className="ov-stat-card ov-stat-card--staff">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.employeesCount}</h3>
              <p>عدد الموظفات لديهم حجز</p>
            </div>
          </div>
        </div>

        <div className="overview-section-heading overview-section-heading--compact">
          <div>
            <span>الملخص المالي</span>
            <h2>الحركة المالية</h2>
          </div>
          <p>ملخص الدخل والمصروفات وصافي الربح المسجل.</p>
        </div>

        <div className="overview-grid overview-grid-3 overview-grid--finance">
          <div className="ov-stat-card ov-stat-card--income">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faWallet} />
            </div>
            <div className="ov-info">
              <h3 className="value">{financial.income.toLocaleString()}</h3>
              <p>الدخل (من الحجوزات)</p>
            </div>
          </div>

          <div className="ov-stat-card ov-stat-card--expenses">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faMoneyBillWave} />
            </div>
            <div className="ov-info">
              <h3 className="value">{financial.expenses.toLocaleString()}</h3>
              <p>المصروفات</p>
            </div>
          </div>

          <div className="ov-stat-card ov-stat-card--profit">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
            <div className="ov-info">
              <h3 className="value">{financial.profit.toLocaleString()}</h3>
              <p>صافي الربح</p>
            </div>
          </div>
        </div>

        <div className="overview-section-heading overview-section-heading--compact">
          <div>
            <span>التشغيل اليومي</span>
            <h2>الجدول والعمليات الأخيرة</h2>
          </div>
          <p>متابعة الحجوزات حسب الساعة وآخر الحركات المالية.</p>
        </div>

        <div className="ov-main-grid">
          <div className="ov-card ov-card--schedule">
            <div className="ov-card-head">
              <div className="ov-card-head-main">
                <h3>جدول الحجوزات حسب الساعة</h3>
                <span className="ov-actions-hint">{scheduleHint}</span>
              </div>
              <div className="ov-date-filter" onClick={openScheduleDatePicker}>
                <label htmlFor="ov-schedule-date">تاريخ الجدول</label>
                <input
                  ref={scheduleDateInputRef}
                  id="ov-schedule-date"
                  type="date"
                  min={todayISO}
                  value={selectedScheduleDate}
                  onChange={(e) => onSelectedScheduleDateChange(String(e.target.value || todayISO))}
                  onFocus={openScheduleDatePicker}
                  onClick={openScheduleDatePicker}
                />
              </div>
            </div>

            <div className="table-responsive">
              <table className="ov-table">
                <thead>
                  <tr>
                    <th>الساعة</th>
                    <th>الحجوزات داخل الساعة</th>
                  </tr>
                </thead>

                <tbody>
                  {hourRows.length === 0 ? (
                    <tr>
                      <td className="ov-empty" colSpan={2}>
                        لا توجد حجوزات في التاريخ المحدد
                      </td>
                    </tr>
                  ) : (
                    hourRows.map((row) => (
                      <tr key={`h_${row.hour}`}>
                        <td className="ov-hour-cell">{formatHourLabel(row.hour)}</td>
                        <td>
                          {row.bookings.length === 0 ? (
                            <span className="ov-hour-empty-chip">لا يوجد حجز</span>
                          ) : (
                            <div className="ov-hour-bookings">
                              {row.bookings.map((b) => (
                                <button
                                  key={`${row.hour}_${b.id}`}
                                  type="button"
                                  className="ov-hour-booking-pill"
                                  onClick={() => onOpenBooking(b)}
                                  title="عرض تفاصيل الحجز"
                                >
                                  <span className="ov-hour-booking-name">{b.customerName}</span>
                                  <span className="ov-hour-booking-time">{formatTime12(b.time)}</span>
                                  <span className={`status-badge ${b.status}`}>
                                    {statusLabel[b.status]}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="ov-latest-mobile">
              {hourRows.length === 0 ? (
                <div className="ov-empty">لا توجد حجوزات في التاريخ المحدد</div>
              ) : (
                hourRows.map((row) => (
                  <div key={`m_h_${row.hour}`} className="ov-hour-mobile-row">
                    <div className="ov-hour-mobile-title">{formatHourLabel(row.hour)}</div>
                    {row.bookings.length === 0 ? (
                      <div className="ov-hour-mobile-empty">لا يوجد حجز</div>
                    ) : (
                      <div className="ov-hour-mobile-list">
                        {row.bookings.map((b) => (
                          <button
                            key={`m_${row.hour}_${b.id}`}
                            type="button"
                            className="ov-hour-mobile-booking"
                            onClick={() => onOpenBooking(b)}
                          >
                            <div className="ov-hour-mobile-top">
                              <strong>{b.customerName}</strong>
                              <span className={`status-badge ${b.status}`}>{statusLabel[b.status]}</span>
                            </div>
                            <div className="ov-hour-mobile-meta">
                              <span>{formatTime12(b.time)}</span>
                              <span>{b.serviceName || b.serviceId || "-"}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="ov-side-stack">
            <div className="ov-card ov-fin-summary">
              <div className="ov-card-head">
                <h3>ملخص اليوم</h3>
              </div>
              <div className="ov-fin-summary-body">
                <div className="ov-fin-row">
                  <span>دخل اليوم</span>
                  <strong className="is-income">{financeToday.income.toLocaleString()} ر.س</strong>
                </div>
                <div className="ov-fin-row">
                  <span>مصروف اليوم</span>
                  <strong className="is-expense">{financeToday.expenses.toLocaleString()} ر.س</strong>
                </div>
                <div className="ov-fin-row is-net">
                  <span>الصافي</span>
                  <strong className={financeToday.net >= 0 ? "is-income" : "is-expense"}>
                    {financeToday.net.toLocaleString()} ر.س
                  </strong>
                </div>
              </div>
            </div>

            <div className="ov-card ov-recent-card">
              <div className="ov-card-head">
                <h3>آخر العمليات</h3>
              </div>
              <div className="ov-recent-list">
                {recentFinanceTransactions.length === 0 ? (
                  <div className="ov-empty">لا توجد عمليات حديثة</div>
                ) : (
                  recentFinanceTransactions.map((t) => (
                    <div className="ov-recent-item" key={t.id}>
                      <div className="ov-recent-main">
                        <div className="ov-recent-title" title={t.title}>{t.title}</div>
                        <div className="ov-recent-date">{formatFinanceDate(t.date)}</div>
                      </div>
                      <div className={`ov-recent-amount ${t.type === "income" ? "is-plus" : "is-minus"}`}>
                        {t.type === "income" ? "+" : "-"}{Math.abs(t.amount).toLocaleString()} ر.س
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="overview-section-heading overview-section-heading--compact">
          <div>
            <span>الاختصارات</span>
            <h2>إجراءات سريعة</h2>
          </div>
          <p>انتقال مباشر إلى أكثر المهام استخدامًا داخل لوحة الإدارة.</p>
        </div>

        <div className="ov-card ov-card--quick-actions">
          <div className="ov-card-head">
            <h3>إجراءات سريعة</h3>
          </div>

          <div className="ov-actions">
            <div className="ov-action">
              <div className="ov-action-ico">
                <FontAwesomeIcon icon={faCalendarAlt} />
              </div>
              <div className="ov-action-body">
                <h4>حجز جديد</h4>
                <p>إضافة حجز جديد للعميلات</p>
              </div>
              <button
                className="exp-btn primary"
                onClick={() => onQuickAction("newBooking")}
                type="button"
              >
                إضافة حجز
              </button>
            </div>

            <div className="ov-action">
              <div className="ov-action-ico">
                <FontAwesomeIcon icon={faUsers} />
              </div>
              <div className="ov-action-body">
                <h4>إدارة الحجوزات</h4>
                <p>عرض وإدارة جميع الحجوزات</p>
              </div>
              <button
                className="exp-btn ghost"
                onClick={() => onQuickAction("bookings")}
                type="button"
              >
                إدارة الحجوزات
              </button>
            </div>

            <div className="ov-action">
              <div className="ov-action-ico">
                <FontAwesomeIcon icon={faChartLine} />
              </div>
              <div className="ov-action-body">
                <h4>التقارير</h4>
                <p>عرض تقارير الأداء والإيرادات</p>
              </div>
              <button
                className="exp-btn outline"
                onClick={() => onQuickAction("reports")}
                type="button"
              >
                عرض التقارير
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ✅ Roles
type UiRole = "owner" | "admin" | "accountant" | "reception" | "staff";

interface UserInfo {
  name: string;
  role: UiRole;
  email: string;
}

type DashboardProps = {
  initialRole?: ProfileRole | string;
  initialName?: string;
  initialEmail?: string;
  authReady?: boolean;
};

// ✅ IMPORTANT: normalize role هنا (حل تعليق staff بسبب Staff/ staff / spaces)
function mapProfileRoleToDashboardRole(role: ProfileRole): UiRole | null {
  const r = String(role || "").toLowerCase().trim() as ProfileRole;

  if (r === "owner" || r === "admin" || r === "accountant" || r === "reception" || r === "staff") {
    return r;
  }
  return null;
}

function isMalikatAdminEmail(email: unknown) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .endsWith("@malikat.com");
}

function normalizeArabicLabel(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function isProgrammerProfile(userInfo: UserInfo | null) {
  const normalizedName = normalizeArabicLabel(userInfo?.name || "");
  return normalizedName.includes("نواف") && normalizedName.includes("العليان");
}

function isDashboardUiRole(role: unknown): role is UiRole {
  const r = String(role || "").toLowerCase().trim();
  return r === "owner" || r === "admin" || r === "accountant" || r === "reception" || r === "staff";
}

function getDashboardStoredName() {
  try {
    return String(localStorage.getItem("userName") || "").trim();
  } catch {
    return "";
  }
}

function getInitialDashboardUserInfo(): UserInfo | null {
  try {
    const session = readStoredAuthSession();
    if (!session || !isDashboardUiRole(session.role)) return null;

    return {
      name: String(session.displayName || localStorage.getItem("userName") || "").trim() || "مستخدم",
      role: session.role,
      email: String(session.email || localStorage.getItem("userEmail") || "").trim(),
    };
  } catch {
    return null;
  }
}

function getDashboardHeaderTitle(pathname: string) {
  const parts = pathname.replace(/^\/dashboard\/?/, "").split("/").filter(Boolean);
  const section = parts[0] || "overview";
  const subSection = parts[1] || "";

  if (section === "settings") {
    const settingsTitles: Record<string, string> = {
      bookings: "إعدادات الحجوزات",
      catalog: "إدارة الكتالوج",
      users: "إدارة الحسابات",
      contact: "محتوى الموقع",
      attendance: "الحضور والبصمة",
    };
    return settingsTitles[subSection] || "الإعدادات الأساسية";
  }

  const titles: Record<string, string> = {
    overview: "لوحة التحكم",
    staff: "بوابة الموظفات",
    bookings: "الحجوزات",
    "booking-internal": "الحجز الإداري",
    attendance: "سجل البصمة والأجهزة",
    "staff-performance": "أداء الموظفات",
    "employee-targets": "تارقت الموظفات",
    "tv-queue": "شاشة نداء الحجوزات",
    "day-audit": "إغلاق اليوم / الشفت",
    clients: "العملاء",
    partners: "الشركاء",
    loyalty: "الولاء (VIP)",
    offers: "العروض والكوبونات",
    reports: "التقارير",
    income: "الإيرادات",
    expenses: "المصروفات",
    logs: "سجل الحركات",
    "admin-profile": "الملف الشخصي",
  };

  return titles[section] || "لوحة التحكم";
}

const Dashboard: React.FC<DashboardProps> = ({
  initialRole,
  initialName,
  initialEmail,
  authReady,
}) => {
  const hasExternalAuthBootstrap =
    typeof initialRole !== "undefined" && typeof authReady === "boolean";

  const externalDashboardRole = hasExternalAuthBootstrap
    ? mapProfileRoleToDashboardRole(initialRole as ProfileRole)
    : null;

  const [userInfo, setUserInfo] = useState<UserInfo | null>(() => {
    if (externalDashboardRole) {
      return {
        name:
          String(initialName || getDashboardStoredName() || "مستخدم").trim() || "مستخدم",
        role: externalDashboardRole,
        email: String(initialEmail || localStorage.getItem("userEmail") || "").trim(),
      };
    }

    return getInitialDashboardUserInfo();
  });
  const [dashError, setDashError] = useState<string>("");
  const [hasBootstrappedDashboard, setHasBootstrappedDashboard] = useState<boolean>(() => {
    if (hasExternalAuthBootstrap) return Boolean(externalDashboardRole);
    try {
      return sessionStorage.getItem(DASHBOARD_BOOTSTRAPPED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const initialDashboardSnapshot = readDashboardViewCache();

  const [stats, setStats] = useState<DashboardStats>(() => initialDashboardSnapshot?.stats || emptyDashboardStats);
  const [allScheduleBookings, setAllScheduleBookings] = useState<Booking[]>(
    () => initialDashboardSnapshot?.allScheduleBookings || []
  );
  const [staffOperationalRows, setStaffOperationalRows] = useState<StaffOperationalRow[]>(
    () => initialDashboardSnapshot?.staffOperationalRows || []
  );
  const [scheduleDate, setScheduleDate] = useState<string>(() => formatLocalDateISO(new Date()));
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [selectedBookingActivity, setSelectedBookingActivity] = useState<BookingActivityItem[]>([]);
  const [selectedBookingActivityLoading, setSelectedBookingActivityLoading] = useState(false);
  const [selectedBookingActivityError, setSelectedBookingActivityError] = useState("");

  const [expensesTotalFS, setExpensesTotalFS] = useState(() => initialDashboardSnapshot?.expensesTotalFS || 0);
  const [incomeTotalFS, setIncomeTotalFS] = useState(() => initialDashboardSnapshot?.incomeTotalFS || 0);
  const [financeToday, setFinanceToday] = useState(() => initialDashboardSnapshot?.financeToday || emptyFinanceToday);
  const [recentFinanceTransactions, setRecentFinanceTransactions] = useState<DashboardFinanceTransaction[]>(
    () => initialDashboardSnapshot?.recentFinanceTransactions || []
  );

  const [missingExpenseNotesCount, setMissingExpenseNotesCount] = useState(0);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [topbarNowMs, setTopbarNowMs] = useState<number>(() => Date.now());

  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const refreshRequestIdRef = useRef(0);
  const hasDashboardDataRef = useRef(Boolean(initialDashboardSnapshot));

  useEffect(() => {
    const query = window.matchMedia("(min-width: 992px)");
    const syncSidebarMode = () => {
      if (query.matches) setIsSidebarOpen(false);
    };
    syncSidebarMode();
    query.addEventListener("change", syncSidebarMode);
    return () => query.removeEventListener("change", syncSidebarMode);
  }, []);

  const markDashboardBootstrapped = () => {
    setHasBootstrappedDashboard(true);
    try {
      sessionStorage.setItem(DASHBOARD_BOOTSTRAPPED_KEY, "1");
    } catch {}
  };

  const totalIncome = incomeTotalFS;
  const totalExpenses = expensesTotalFS;
  const netProfit = totalIncome - totalExpenses;
  const todayScheduleBookings = useMemo(
    () => filterOperationalScheduleBookings(allScheduleBookings || [], scheduleDate, staffOperationalRows),
    [allScheduleBookings, scheduleDate, staffOperationalRows]
  );

  useEffect(() => {
    if (!hasExternalAuthBootstrap || !externalDashboardRole) return;

    const nextUserInfo: UserInfo = {
      name:
        String(initialName || getDashboardStoredName() || "مستخدم").trim() || "مستخدم",
      role: externalDashboardRole,
      email: String(initialEmail || localStorage.getItem("userEmail") || "").trim(),
    };

    setUserInfo((prev) => {
      if (
        prev &&
        prev.name === nextUserInfo.name &&
        prev.role === nextUserInfo.role &&
        prev.email === nextUserInfo.email
      ) {
        return prev;
      }
      return nextUserInfo;
    });
  }, [hasExternalAuthBootstrap, externalDashboardRole, initialName, initialEmail]);

  /**
   * ✅ refresh من Firestore
   * ✅ تعديل مهم: لا نقرأ المصروفات إلا لو AdminPower (Owner/Admin)
   */
  const refreshDashboard = async (
    roleForRefresh?: UiRole,
    options?: { silent?: boolean }
  ) => {
    const requestId = ++refreshRequestIdRef.current;

    if (roleForRefresh === "staff") {
      hasDashboardDataRef.current = false;
      clearDashboardViewCache();
      setStats(emptyDashboardStats);
      setAllScheduleBookings([]);
      setStaffOperationalRows([]);
      setExpensesTotalFS(0);
      setIncomeTotalFS(0);
      setFinanceToday(emptyFinanceToday);
      setRecentFinanceTransactions([]);
      return;
    }

    let step = "start";
    const canReadIncomeNow = hasPermission("income.view");
    const canReadExpensesNow = hasPermission("expenses.view");

    try {
      step = "migrateBookingsIfNeeded";
      try {
        DashboardService.migrateBookingsIfNeeded?.();
      } catch (err) {
        console.warn("REFRESH -> migrateBookingsIfNeeded skipped:", err);
      }

      step = "bookings:listAllBookings";
      const docs = await listAllBookingsFS();
      if (requestId !== refreshRequestIdRef.current) return;

      const bookingPaidById = docs.reduce((acc, b: any) => {
        const id = String(b?.id || "").trim();
        if (!id) return acc;
        const payment = resolveBookingPayment(b);
        acc[id] = hasReliableBookingPayment(b) ? Number(payment.paidAmount || 0) : Number.NaN;
        return acc;
      }, {} as Record<string, number>);

      const bookingDateById = docs.reduce((acc, b: any) => {
        const id = String(b?.id || "").trim();
        if (!id) return acc;
        const dateISO = resolveBookingDateISO(b?.date, b?.createdAt, b?.updatedAt);
        acc[id] = dateISO;
        return acc;
      }, {} as Record<string, string>);

      step = "staff_public:getDocs";
      const staffSnap = await getDocs(collection(db, "salons", "main", "staff_public"));
      if (requestId !== refreshRequestIdRef.current) return;

      const nextStaffRows = staffSnap.docs.map((snap) => {
        const data = snap.data() as any;
        return {
          id: String(snap.id || "").trim(),
          name: String(data?.name || "").trim() || undefined,
          linkedUid: String(data?.linkedUid || data?.uid || "").trim() || undefined,
          active: data?.active !== false,
          employmentEndDate: String(data?.employmentEndDate || "").trim() || undefined,
        } as StaffOperationalRow;
      });

      step = "bookings:mapFirestoreToUiBooking";
      const uiBookings = await Promise.all(docs.map(mapFirestoreToUiBooking));
      if (requestId !== refreshRequestIdRef.current) return;

      step = "today:compute";
      const todayStr = formatLocalDateISO(new Date());
      const todayListAll = uiBookings.filter((b) => isBookingOnDate(b, todayStr));
      const todayList = todayListAll.filter(
        (b) => b.status === "confirmed" || b.status === "completed"
      );
      let todayRevenue = todayList.reduce((sum, b) => sum + (Number((b as any).total) || 0), 0);
      const employeesCount = nextStaffRows.filter((staff) =>
        isStaffOperationallyActiveForDate(staff as any, todayStr)
      ).length;

      let nextExpensesTotal = 0;
      let nextIncomeTotal = 0;
      let nextFinanceToday = emptyFinanceToday;
      let nextRecentFinanceTransactions: DashboardFinanceTransaction[] = [];

      const incomes = canReadIncomeNow ? await listAllIncomeFS("main") : [];
      if (requestId !== refreshRequestIdRef.current) return;
      const expenses = canReadExpensesNow ? await listAllExpensesFS() : [];
      if (requestId !== refreshRequestIdRef.current) return;

      const effectiveIncomeAmount = (x: any) =>
        resolveIncomeEffectiveAmount(x, bookingPaidById);
      const effectiveIncomeDate = (x: any) => {
        const linkedBookingId = resolveLinkedBookingIdFromIncome(x);
        const linkedDate = String(bookingDateById[linkedBookingId] || "").trim();
        return linkedDate || resolveIncomeDateForTodayFilter(x);
      };

      if (canReadIncomeNow) {
        nextIncomeTotal = incomes.reduce(
          (sum: number, x: any) => sum + effectiveIncomeAmount(x),
          0
        );
        todayRevenue = incomes
          .filter((x: any) => normalizeISODateLoose(effectiveIncomeDate(x)) === todayStr)
          .reduce((sum: number, x: any) => sum + effectiveIncomeAmount(x), 0);
      }

      if (canReadExpensesNow) {
        nextExpensesTotal = expenses.reduce(
          (sum, e) => sum + (Number((e as any).amount) || 0),
          0
        );
      }

      const incomeToday = canReadIncomeNow
        ? incomes
            .filter((x: any) => normalizeISODateLoose(effectiveIncomeDate(x)) === todayStr)
            .reduce((sum: number, x: any) => sum + effectiveIncomeAmount(x), 0)
        : 0;
      const expensesToday = canReadExpensesNow
        ? expenses
            .filter((x: any) => String((x as any)?.date || "").trim() === todayStr)
            .reduce((sum: number, x: any) => sum + (Number((x as any)?.amount) || 0), 0)
        : 0;

      nextFinanceToday = {
        income: incomeToday,
        expenses: expensesToday,
        net: incomeToday - expensesToday,
      };

      const recentIncomeTx = canReadIncomeNow
        ? incomes.map((x: any) => ({
            id: `inc_${String(x?.id || "")}`,
            type: "income" as const,
            title: String(x?.note || "").trim() || financeSourceLabelAr(x?.source),
            amount: effectiveIncomeAmount(x),
            date: effectiveIncomeDate(x),
            createdAt: Number(x?.createdAt || 0) || Date.now(),
          }))
        : [];

      const recentExpenseTx = canReadExpensesNow
        ? expenses.map((x: any) => {
            const rawTitle =
              String((x as any)?.title || (x as any)?.category || "مصروف").trim() || "مصروف";
            const title = /^booking$/i.test(rawTitle) ? "حجز" : rawTitle;
            return {
              id: `exp_${String((x as any)?.id || "")}`,
              type: "expense" as const,
              title,
              amount: Number((x as any)?.amount || 0),
              date: String((x as any)?.date || ""),
              createdAt: Number((x as any)?.createdAt || 0) || Date.now(),
            };
          })
        : [];

      nextRecentFinanceTransactions = [...recentIncomeTx, ...recentExpenseTx]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 7);

      if (requestId !== refreshRequestIdRef.current) return;

      const nextStats: DashboardStats = {
        todayBookings: todayList.length,
        totalRevenue: todayRevenue,
        totalOperations: uiBookings.length,
        employeesCount,
      };

      step = "ui:commit";
      setStats(nextStats);
      setAllScheduleBookings(uiBookings);
      setStaffOperationalRows(nextStaffRows);
      setExpensesTotalFS(nextExpensesTotal);
      setIncomeTotalFS(nextIncomeTotal);
      setFinanceToday(nextFinanceToday);
      setRecentFinanceTransactions(nextRecentFinanceTransactions);
      hasDashboardDataRef.current = true;
      writeDashboardViewCache({
        stats: nextStats,
        allScheduleBookings: uiBookings,
        staffOperationalRows: nextStaffRows,
        expensesTotalFS: nextExpensesTotal,
        incomeTotalFS: nextIncomeTotal,
        financeToday: nextFinanceToday,
        recentFinanceTransactions: nextRecentFinanceTransactions,
        savedAt: Date.now(),
      });
    } catch (e) {
      if (requestId !== refreshRequestIdRef.current) return;
      console.error("refreshDashboard error:", e);

      const code = (e as any)?.code || (e as any)?.name || "-";
      const msg = String((e as any)?.message || "");

      if (!options?.silent && !hasDashboardDataRef.current) {
        alert(`❌ Dashboard Refresh Failed\nstep: ${step}\ncode: ${code}\nmsg: ${msg}`);
      }
    }
  };

  // ✅ Badge المصروفات بدون ملاحظات (AdminPower only)
  useEffect(() => {
    if (!userInfo) return;

    if (!hasPermission("expenses.view")) {
      setMissingExpenseNotesCount(0);
      return;
    }

    let alive = true;

    const load = async () => {
      try {
        const n = await countMonthlyExpensesMissingNotesFS("main");
        if (alive) setMissingExpenseNotesCount(Number(n || 0));
      } catch {
        if (alive) setMissingExpenseNotesCount(0);
      }
    };

    load();
    const t = window.setInterval(load, 60_000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hasPermission, userInfo?.role]);

  /**
   * ✅ ربط Dashboard مع Firestore settings/app (Realtime)
   */
  useEffect(() => {
    try {
      const cached = AppSettingsService.getCached() as any;
      setSettings((prev) => ({
        ...prev,
        ...cached,
        sections: { ...prev.sections, ...(cached?.sections || {}) },
        policies: { ...prev.policies, ...(cached?.policies || {}) },
      }));
    } catch { }

    const unsub = AppSettingsService.subscribe((remote: any) => {
      setSettings((prev) => ({
        ...prev,
        ...remote,
        sections: { ...prev.sections, ...(remote?.sections || {}) },
        policies: { ...prev.policies, ...(remote?.policies || {}) },
      }));

      localStorage.setItem(SETTINGS_KEY, JSON.stringify(remote));
      window.dispatchEvent(new Event("settingsChanged"));
    });

    return () => unsub?.();
  }, []);

  /**
   * ✅ FIX تعليق الموظف:
   */
  useEffect(() => {
    if (hasExternalAuthBootstrap) {
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      let step = "auth:start";
      try {
        setDashError("");

        step = "auth:checkUser";
        if (!user) {
          navigate("/hr");
          return;
        }

        step = "account:readVerifiedUserAccess";
        const isMalikatAuth = isMalikatAdminEmail(user.email);
        const access = await readVerifiedUserAccess(user.uid);
        const sourceProfile = access.profile || {};
        const profile: UserProfile | null = access.exists && access.active !== false
          ? {
              uid: user.uid,
              email: access.email || user.email || "",
              name:
                access.displayName ||
                String(sourceProfile.name || sourceProfile.displayName || "").trim() ||
                user.displayName ||
                user.email ||
                "مستخدم",
              phone: access.phone || String(sourceProfile.phone || ""),
              city: String(sourceProfile.city || ""),
              birthdate: String(sourceProfile.birthdate || ""),
              avatarUrl: String(sourceProfile.avatarUrl || ""),
              clientId: String(sourceProfile.clientId || "") || undefined,
              role: access.role,
              active: access.active,
              permissions: Array.isArray(sourceProfile.permissions)
                ? (sourceProfile.permissions as UserProfile["permissions"])
                : undefined,
              permissionOverrides:
                sourceProfile.permissionOverrides && typeof sourceProfile.permissionOverrides === "object"
                  ? (sourceProfile.permissionOverrides as UserProfile["permissionOverrides"])
                  : undefined,
              permissionVersion: Number(sourceProfile.permissionVersion || 0) || undefined,
            }
          : null;

        if (!profile) {
          step = "profile:fallback";
          navigate(isMalikatAuth ? "/dashboard-pending" : "/profile");
          return;
        }

        step = `profile:loaded role=${profile?.role || "-"}`;

        step = "profile:canAccessDashboard";
        if (!canAccessDashboard(profile.role)) {
          navigate(isMalikatAuth ? "/dashboard-pending" : "/profile");
          return;
        }

        step = "profile:mapRoleToDashboardRole";
        const dashRole = mapProfileRoleToDashboardRole(profile.role);
        if (!dashRole) {
          const normalizedRole = String(profile.role || "").toLowerCase().trim();
          navigate(normalizedRole === "hr" ? "/admin" : isMalikatAuth ? "/dashboard-pending" : "/profile");
          return;
        }

        step = "ui:setUserInfo";
        const name = profile.name || user.displayName || "مستخدم";

        setUserInfo({
          name,
          role: dashRole,
          email: profile.email || user.email || "",
        });
        markDashboardBootstrapped();

        await refreshDashboard(dashRole);
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        console.error("Dashboard auth error:", { step, err });
        setDashError(`❌ Dashboard blocked\nstep: ${step}\nmsg: ${msg}`);
      }
    });

    return () => unsub();
  }, [navigate]);

  // ✅ Auto Job (Client-side): كل 5 دقائق
  // - confirmed -> completed (لا يفك slots)
  // ملاحظة: إلغاء pending تلقائيًا يتم من السيرفر (Cloud Function) فقط
  // لتجنب الإلغاء الخاطئ بسبب ساعة/منطقة جهاز المتصفح.
  // ✅ حماية: يشتغل Owner/Admin فقط
  // ✅ يعتمد على وقت التقفيلة الفعلي (اليومي + الاستثناءات) مع مهلة إضافية قبل قلب اليوم
  useEffect(() => {
    if (!userInfo) return;

    const canRun = userInfo.role === "owner" || userInfo.role === "admin";
    if (!canRun) return;

    const role = userInfo.role; // ✅ ثبت الدور هنا عشان TS ما يقول userInfo ممكن null
    const businessHoursMap = (settings as any)?.booking?.businessHours || {};
    const bookingHourOverrides = Array.isArray((settings as any)?.booking?.bookingHourOverrides)
      ? ((settings as any).booking.bookingHourOverrides as BookingHourOverride[])
      : [];
    const configuredGrace = Number((settings as any)?.booking?.autoCloseGraceMin);
    const autoCloseGraceMin =
      Number.isFinite(configuredGrace) && configuredGrace >= 0
        ? Math.trunc(configuredGrace)
        : 30;

    let alive = true;
    let running = false;

    const parseHHMM = (time: string) => {
      const m = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      return { hh, mm, totalMin: hh * 60 + mm };
    };

    const parseISODate = (dateStr: string) => {
      const m = String(dateStr || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
      return { y, mo, d };
    };

    const resolveWeekdayFromISO = (dateStr: string): WeekdayKey | null => {
      const p = parseISODate(dateStr);
      if (!p) return null;
      const dt = new Date(p.y, Math.max(0, p.mo - 1), p.d);
      return JS_DAY_TO_WEEKDAY[dt.getDay()] || null;
    };

    const safeTimeHHMM = (timeStr: string, fallback: string): string => {
      const t = parseHHMM(timeStr);
      if (!t) return fallback;
      return `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}`;
    };

    const normalizeWeekdayList = (raw: any): WeekdayKey[] => {
      if (!Array.isArray(raw)) return [];
      const valid = new Set<WeekdayKey>(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
      const out: WeekdayKey[] = [];
      raw.forEach((x) => {
        const day = String(x || "").trim().toLowerCase() as WeekdayKey;
        if (valid.has(day) && !out.includes(day)) out.push(day);
      });
      return out;
    };

    const resolveDaySettings = (dateStr: string) => {
      const dayKey = resolveWeekdayFromISO(dateStr) || "sat";
      const dayCfg = (businessHoursMap as any)?.[dayKey] || {};

      let enabled = dayCfg?.enabled !== false;
      let openTime = safeTimeHHMM(String(dayCfg?.start || ""), "10:00");
      let closeTime = safeTimeHHMM(String(dayCfg?.end || ""), "22:00");

      for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
        const ov = bookingHourOverrides[i] || {};
        const rawFrom = String(ov?.fromDate || "").trim();
        const rawTo = String(ov?.toDate || "").trim();
        if (!parseISODate(rawFrom) || !parseISODate(rawTo)) continue;
        const fromDate = rawFrom <= rawTo ? rawFrom : rawTo;
        const toDate = rawFrom <= rawTo ? rawTo : rawFrom;
        if (dateStr < fromDate || dateStr > toDate) continue;

        const includeWeekdays = normalizeWeekdayList(ov?.includeWeekdays);
        if (includeWeekdays.length > 0 && !includeWeekdays.includes(dayKey)) continue;

        const blockedWeekdays = normalizeWeekdayList(ov?.blockedWeekdays);
        const mode = String(ov?.mode || "hours").trim().toLowerCase();
        if (blockedWeekdays.includes(dayKey) || mode === "closed") {
          enabled = false;
        } else {
          enabled = true;
          openTime = safeTimeHHMM(String(ov?.start || ""), openTime);
          closeTime = safeTimeHHMM(String(ov?.end || ""), closeTime);
        }
        break;
      }

      const open = parseHHMM(openTime);
      const close = parseHHMM(closeTime);
      const isOvernight = !!open && !!close && open.totalMin > close.totalMin;
      return {
        enabled,
        openTime,
        closeTime,
        closeMin: close?.totalMin ?? null,
        isOvernight,
      };
    };

    // ✅ ليلية-aware:
    // - الحجز يظل business-date كما هو
    // - لكن لو اليوم Overnight (start > end) والوقت بعد منتصف الليل (< end) نحسبه اليوم التالي فعليًا
    const toEffectiveDateStart = (
      dateStr: string,
      timeStr: string,
      daySettings: ReturnType<typeof resolveDaySettings>
    ) => {
      const p = parseISODate(dateStr);
      const t = parseHHMM(timeStr);
      if (!p || !t) return null;

      const start = new Date(p.y, Math.max(0, p.mo - 1), p.d, t.hh, t.mm, 0, 0);
      if (daySettings.isOvernight && daySettings.closeMin !== null && t.totalMin < daySettings.closeMin) {
        start.setDate(start.getDate() + 1);
      }

      return start;
    };

    const buildCloseGateDate = (
      dateStr: string,
      daySettings: ReturnType<typeof resolveDaySettings>
    ) => {
      const p = parseISODate(dateStr);
      const close = parseHHMM(daySettings.closeTime);
      if (!p || !close) return null;

      const closeAt = new Date(p.y, Math.max(0, p.mo - 1), p.d, close.hh, close.mm, 0, 0);
      if (daySettings.isOvernight) closeAt.setDate(closeAt.getDate() + 1);
      closeAt.setMinutes(closeAt.getMinutes() + autoCloseGraceMin);
      return closeAt;
    };

    async function tick() {
      if (!alive) return;
      if (running) return;
      running = true;

      try {
        const rows = await listAllBookingsFS();
        const nowMs = Date.now();

        for (const b of rows) {
          if (!b?.date || !b?.time) continue;

          const st = String(b.status || "pending");
          if (st !== "pending" && st !== "confirmed") continue;

          const daySettings = resolveDaySettings(String(b.date || ""));
          const start = toEffectiveDateStart(String(b.date || ""), String(b.time || ""), daySettings);
          if (!start) continue;

          // ✅ SAFE duration (بدون كراش)
          const duration =
            Number(b?.serviceSnapshot?.durationAtBooking ?? b?.durationMin ?? 0) || 60;
          const bufferMin = Number(b?.bufferMinAtBooking ?? 0);
          const safeBuffer = Number.isFinite(bufferMin) ? Math.max(0, Math.trunc(bufferMin)) : 0;

          const end = new Date(start.getTime() + (duration + safeBuffer) * 60_000);
          const closeGate = buildCloseGateDate(String(b.date || ""), daySettings);
          const readyAtMs = Math.max(end.getTime(), closeGate?.getTime() || 0);

          if (nowMs < readyAtMs) continue;

          // Business rule (manual completion only):
          // confirmed bookings stay confirmed until staff marks them completed manually.
          if (st === "confirmed") continue;
        }

        await refreshDashboard(role); // ✅ بدل userInfo.role
      } catch (e) {
        console.error("[AUTO] tick error:", e);
      } finally {
        running = false;
      }
    }

    tick();
    const id = window.setInterval(tick, 5 * 60_000);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [
    userInfo?.role,
    settings.booking?.businessHours,
    settings.booking?.bookingHourOverrides,
    settings.booking?.autoCloseGraceMin,
  ]);

  useEffect(() => {
    if (!hasExternalAuthBootstrap) return;
    if (!userInfo?.role) return;

    let cancelled = false;

    const run = async () => {
      try {
        markDashboardBootstrapped();
        await refreshDashboard(userInfo.role);
      } catch (e) {
        if (!cancelled) {
          console.error("Dashboard external bootstrap refresh failed:", e);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      refreshRequestIdRef.current += 1;
    };
  }, [hasExternalAuthBootstrap, userInfo?.role]);

  const handleLogout = async () => {
    try {
      await logoutFirebase();
    } finally {
      refreshRequestIdRef.current += 1;
      hasDashboardDataRef.current = false;
      clearDashboardViewCache();
      setUserInfo(null);
      setHasBootstrappedDashboard(false);
      setStats(emptyDashboardStats);
      setAllScheduleBookings([]);
      setStaffOperationalRows([]);
      setExpensesTotalFS(0);
      setIncomeTotalFS(0);
      setFinanceToday(emptyFinanceToday);
      setRecentFinanceTransactions([]);
      setSelectedBooking(null);
      setSelectedBookingActivity([]);
      setSelectedBookingActivityError("");
      setSelectedBookingActivityLoading(false);
      try {
        sessionStorage.removeItem(DASHBOARD_BOOTSTRAPPED_KEY);
      } catch {}
      window.dispatchEvent(new Event("authChanged"));
      navigate("/hr", { replace: true });
    }
  };

  const canOpenHrPortal = hasAnyPermission([
    "employees.view",
    "attendance.view",
    "recruitment.view",
    "messages.manage",
    "employees.files.view",
    "admin_accounts.view",
  ]);
  const hasPrimaryNavigation = hasAnyPermission([
    "workspace.dashboard.view",
    "bookings.view",
    "bookings.create",
    "bookings.day_audit.manage",
    "bookings.queue_tv.view",
    "clients.view",
    "income.view",
    "expenses.view",
    "payroll.view",
    "targets.view",
    "targets.view_all",
    "staffPerformance.view",
  ]);
  const hasManagementNavigation = hasAnyPermission([
    "partners.manage",
    "offers.manage",
    "reports.view",
    "logs.view",
    "clients.loyalty.manage",
  ]);
  const hasSettingsNavigation = hasAnyPermission([
      "workspace.dashboard.view",
      "settings.general.manage",
      "settings.booking.manage",
      "catalog.manage",
      "admin_accounts.view",
      "admin_accounts.manage",
      "settings.content.manage",
      "attendance.view",
      "attendance.settings.manage",
      "targets.view",
      "targets.view_all",
      "staffPerformance.view",
    ]);


  const getRoleIcon = (role: UiRole) => {
    switch (role) {
      case "owner":
        return faUserShield;
      case "admin":
        return faUserShield;
      case "staff":
        return faUserTie;
      default:
        return faUser;
    }
  };

  const getRoleTitle = (role: UiRole) => {
    switch (role) {
      case "owner":
        return "المالكة";
      case "admin":
        return "خدمة عملاء ملكات";
      case "accountant":
        return "المحاسبة";
      case "reception":
        return "موظفة الاستقبال";
      case "staff":
        return "موظفة";
      default:
        return "مستخدم";
    }
  };

  const displayedRoleTitle = isProgrammerProfile(userInfo)
    ? "المبرمج"
    : getRoleTitle(userInfo?.role || "staff");

  // ✅ QUICK ACTIONS (تم تعديل newBooking)
  const handleQuickAction = (key: "newBooking" | "bookings" | "reports") => {
    if (key === "newBooking") navigate("/dashboard/booking-internal");
    if (key === "bookings") navigate("/dashboard/bookings");
    if (key === "reports") navigate("/dashboard/reports");
    setIsSidebarOpen(false);
  };


  const handleOpenBooking = (booking: Booking) => setSelectedBooking(booking);

  useEffect(() => {
    let cancelled = false;

    const loadBookingActivity = async () => {
      if (!selectedBooking?.id) {
        setSelectedBookingActivity([]);
        setSelectedBookingActivityError("");
        setSelectedBookingActivityLoading(false);
        return;
      }

      setSelectedBookingActivityLoading(true);
      setSelectedBookingActivityError("");

      try {
        const snap = await getDocs(
          collection(db, "salons", "main", "booking_logs", selectedBooking.id, "events")
        );

        if (cancelled) return;

        const mapped = snap.docs
          .map((docSnap) =>
            mapBookingActivityItem(
              {
                id: docSnap.id,
                ...(docSnap.data() as Record<string, unknown>),
              },
              selectedBooking
            )
          )
          .sort((a, b) => b.sortMs - a.sortMs);

        const hasCreatedEvent = mapped.some((item) => item.title === "تم إنشاء الحجز");
        const fallbackCreated = hasCreatedEvent ? null : buildFallbackCreatedActivity(selectedBooking);
        const nextItems = fallbackCreated ? [...mapped, fallbackCreated] : mapped;

        setSelectedBookingActivity(
          nextItems.sort((a, b) => b.sortMs - a.sortMs || b.id.localeCompare(a.id))
        );
      } catch (error) {
        console.error("loadBookingActivity error:", error);
        if (cancelled) return;
        const fallbackCreated = buildFallbackCreatedActivity(selectedBooking);
        setSelectedBookingActivity(fallbackCreated ? [fallbackCreated] : []);
        setSelectedBookingActivityError("تعذر تحميل سجل الحجز بالكامل حالياً.");
      } finally {
        if (!cancelled) setSelectedBookingActivityLoading(false);
      }
    };

    void loadBookingActivity();

    return () => {
      cancelled = true;
    };
  }, [selectedBooking]);

  useEffect(() => {
    const close = () => setIsSidebarOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  const isTvQueuePage = location.pathname.startsWith("/dashboard/tv-queue");
  const isBookingInternalPage = location.pathname.startsWith("/dashboard/booking-internal");
  const isBookingsWorkspacePage = location.pathname === "/dashboard/bookings";
  const isAttendanceSecurityPage = location.pathname.startsWith("/dashboard/attendance");
  const isEnterpriseOperationsPage = [
    "/dashboard/tv-queue",
    "/dashboard/day-audit",
    "/dashboard/expenses",
    "/dashboard/partners",
    "/dashboard/offers",
    "/dashboard/logs",
    "/dashboard/settings",
  ].some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  const isSingleScrollWorkspacePage =
    isBookingInternalPage || isBookingsWorkspacePage || isAttendanceSecurityPage || isEnterpriseOperationsPage;
  useEffect(() => {
    if (!isTvQueuePage) return;
    setTopbarNowMs(Date.now());
    const id = window.setInterval(() => setTopbarNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isTvQueuePage]);

  if (dashError) {
    return (
      <div className="dashboard-loading" style={{ direction: "ltr", textAlign: "left" }}>
        <pre style={{ whiteSpace: "pre-wrap", maxWidth: 900 }}>{dashError}</pre>
      </div>
    );
  }

  if (!userInfo && !hasBootstrappedDashboard) {
    return <LoadingBrand text="جاري تحميل لوحة التحكم..." />;
  }

  if (!userInfo) {
    return (
      <div className="dashboard-skin madan-admin-shell dashboard-page dashboard-skin-page is-sidebar-drawer">
        <div className="container-fluid">
          <div className="row">
            <div className="col-md-3 col-lg-2 dashboard-sidebar" />
            <div className="col-md-9 col-lg-10 dashboard-main">
              <div className="dashboard-inner">
                <div className="dashboard-loading">جاري تحميل بيانات القسم...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const topbarClockText = `${new Date(topbarNowMs).toISOString().slice(0, 10)} • ${new Intl.DateTimeFormat("ar-SA", {
    timeStyle: "medium",
  }).format(new Date(topbarNowMs))}`;
  const dashboardHeaderTitle = isTvQueuePage
    ? "شاشة نداء الحجوزات"
    : getDashboardHeaderTitle(location.pathname);


  return (
    <div className={`dashboard-skin madan-admin-shell dashboard-page dashboard-skin-page is-sidebar-drawer${(isBookingInternalPage || isAttendanceSecurityPage) ? " is-booking-internal-route" : ""}${isBookingsWorkspacePage ? " is-bookings-workspace-route" : ""}${isEnterpriseOperationsPage ? " is-enterprise-workspace-route" : ""}${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      {/* ✅ Scoped styles: Booking Details Modal layout (fix broken column/white space) */}
      <style>
        {`
          .dash-booking-modal {
            --dash-booking-accent: #40010D;
            --dash-booking-border: rgba(64, 1, 13, 0.14);
            --dash-booking-soft: rgba(64, 1, 13, 0.05);
            --dash-booking-shadow: 0 18px 42px rgba(64, 1, 13, 0.1);
            direction: rtl;
            max-height: none !important;
            overflow: hidden !important;
          }

          .dash-booking-modal .dash-modal-body{
            max-height: min(78vh, 860px) !important;
            overflow: auto !important;
            padding-inline-end: 4px;
            scrollbar-width: thin;
          }

          .dash-booking-modal .dash-modal-header{
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            flex-wrap:wrap;
          }

          .dash-booking-modal .dash-modal-title{
            display:flex;
            flex-direction:column;
            gap:4px;
          }

          .dash-booking-modal .dash-modal-title h3{
            margin:0;
            font-size:22px;
            font-weight:900;
            letter-spacing:.2px;
            color:#1f1a17;
          }

          .dash-booking-modal .dash-modal-title small{
            opacity:.78;
            font-size:13px;
            font-weight:700;
            color:#5f524e;
          }

          .dash-booking-modal .dash-booking-sheet{
            display:grid;
            gap:18px;
            margin-top:6px;
          }

          .dash-booking-modal .dash-booking-section{
            background:
              linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,243,241,0.98));
            border:1px solid var(--dash-booking-border);
            border-radius:22px;
            padding:18px;
            box-shadow: var(--dash-booking-shadow);
          }

          .dash-booking-modal .dash-booking-section--timeline{
            background:
              radial-gradient(220px 120px at 100% 0%, rgba(64,1,13,0.07), transparent 72%),
              linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,246,244,0.98));
          }

          .dash-booking-modal .dash-section-head{
            display:flex;
            align-items:flex-start;
            justify-content:space-between;
            gap:12px;
            flex-wrap:wrap;
            margin-bottom:14px;
          }

          .dash-booking-modal .dash-section-head h4{
            margin:0;
            font-size:17px;
            font-weight:900;
            color:#201815;
          }

          .dash-booking-modal .dash-section-head span{
            display:block;
            margin-top:4px;
            font-size:12px;
            font-weight:700;
            color:#776864;
          }

          .dash-booking-modal .dash-details-grid{
            display:grid;
            grid-template-columns:repeat(2, minmax(0, 1fr));
            gap:14px;
          }

          .dash-booking-modal .dash-detail{
            background:
              linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,245,243,0.96));
            border:1px solid rgba(64,1,13,0.12);
            border-radius:18px;
            padding:14px 16px;
            box-shadow:0 12px 24px rgba(64,1,13,0.08);
            min-width:0;
            display:grid;
            gap:8px;
          }

          .dash-booking-modal .dash-detail b{
            display:block;
            font-size:12px;
            margin-bottom:0;
            font-weight:900;
            letter-spacing:.02em;
            color:#7a6863;
          }

          .dash-booking-modal .dash-detail .dash-value{
            font-weight:900;
            font-size:16px;
            line-height:1.8;
            color:#1f1a17;
            word-break:break-word;
          }

          .dash-booking-modal .dash-detail--wide{ grid-column:span 2; }
          .dash-booking-modal .dash-detail--hero{
            grid-column: span 2;
            border-color: rgba(64,1,13,.22);
            background:
              radial-gradient(420px 180px at 10% 10%, rgba(64,1,13,.1), transparent 60%),
              linear-gradient(180deg, #fff 0%, #f7f1ed 100%);
            padding:18px 18px 16px;
          }

          .dash-booking-modal .dash-value-sub{
            margin-top: 6px;
            font-size: 12px;
            color: rgba(13,13,13,.7);
            font-weight: 800;
          }

          .dash-booking-modal .dash-created-badge{
            display:inline-flex;
            align-items:center;
            gap:6px;
            margin-top:8px;
            padding:7px 11px;
            border-radius:999px;
            border:1px solid rgba(64,1,13,.18);
            background: rgba(64,1,13,.06);
            color:#40010D;
            font-size:12px;
            font-weight:900;
          }

          .dash-booking-modal .dash-status-row{
            display:flex;
            align-items:center;
            gap:10px;
            flex-wrap:wrap;
          }

          .dash-booking-modal .dash-select{
            height:44px !important;
            border-radius:14px !important;
            font-weight:900 !important;
            border:1px solid rgba(0,0,0,0.10) !important;
            background:#fff !important;
            padding:0 12px !important;
          }

          .dash-booking-modal .dash-activity-empty{
            border:1px dashed rgba(64,1,13,0.18);
            border-radius:16px;
            padding:16px 14px;
            background: rgba(255,255,255,0.78);
            font-size:13px;
            font-weight:700;
            color:#6c5b56;
          }

          .dash-booking-modal .dash-activity-timeline{
            display:grid;
            gap:14px;
          }

          .dash-booking-modal .dash-activity-item{
            display:grid;
            grid-template-columns: 26px minmax(0, 1fr);
            gap:14px;
            align-items:flex-start;
          }

          .dash-booking-modal .dash-activity-rail{
            position:relative;
            display:flex;
            justify-content:center;
            min-height:100%;
          }

          .dash-booking-modal .dash-activity-line{
            position:absolute;
            top:18px;
            bottom:-18px;
            width:2px;
            border-radius:999px;
            background: linear-gradient(180deg, rgba(64,1,13,0.28), rgba(64,1,13,0.08));
          }

          .dash-booking-modal .dash-activity-item:last-child .dash-activity-line{
            display:none;
          }

          .dash-booking-modal .dash-activity-dot{
            width:14px;
            height:14px;
            margin-top:6px;
            border-radius:999px;
            border:3px solid #fff;
            background: var(--dash-booking-accent);
            box-shadow:0 0 0 1px rgba(64,1,13,0.18), 0 6px 12px rgba(64,1,13,0.12);
            position:relative;
            z-index:1;
          }

          .dash-booking-modal .dash-activity-item--success .dash-activity-dot{
            background:#15803d;
            box-shadow:0 0 0 1px rgba(21,128,61,0.18), 0 6px 12px rgba(21,128,61,0.14);
          }

          .dash-booking-modal .dash-activity-item--danger .dash-activity-dot{
            background:#b42318;
            box-shadow:0 0 0 1px rgba(180,35,24,0.2), 0 6px 12px rgba(180,35,24,0.14);
          }

          .dash-booking-modal .dash-activity-item--info .dash-activity-dot{
            background:#0f766e;
            box-shadow:0 0 0 1px rgba(15,118,110,0.18), 0 6px 12px rgba(15,118,110,0.14);
          }

          .dash-booking-modal .dash-activity-card{
            border:1px solid rgba(64,1,13,0.12);
            border-radius:18px;
            padding:14px 16px;
            background:
              linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,246,244,0.98));
            box-shadow:0 10px 22px rgba(64,1,13,0.08);
            display:grid;
            gap:10px;
            min-width:0;
          }

          .dash-booking-modal .dash-activity-top{
            display:flex;
            align-items:flex-start;
            justify-content:space-between;
            gap:10px 12px;
            flex-wrap:wrap;
          }

          .dash-booking-modal .dash-activity-copy{
            display:grid;
            gap:6px;
            min-width:0;
          }

          .dash-booking-modal .dash-activity-copy strong{
            font-size:15px;
            font-weight:900;
            color:#201815;
          }

          .dash-booking-modal .dash-activity-time{
            font-size:12px;
            font-weight:800;
            color:#6d5c57;
            white-space:nowrap;
          }

          .dash-booking-modal .dash-activity-meta{
            display:flex;
            align-items:flex-start;
            gap:8px;
            flex-wrap:wrap;
            font-size:13px;
            color:#352d2a;
            line-height:1.8;
          }

          .dash-booking-modal .dash-activity-meta-label{
            color:#7b6a65;
            font-weight:900;
          }

          .dash-booking-modal .dash-activity-kind{
            display:inline-flex;
            align-items:center;
            justify-content:center;
            min-height:28px;
            padding:5px 10px;
            border-radius:999px;
            font-size:11px;
            font-weight:900;
            border:1px solid rgba(64,1,13,0.12);
            background: rgba(64,1,13,0.06);
            color:#40010D;
          }

          .dash-booking-modal .dash-activity-kind--client{
            border-color: rgba(14,116,144,0.2);
            background: rgba(14,116,144,0.08);
            color:#0f5b6b;
          }

          .dash-booking-modal .dash-activity-kind--staff{
            border-color: rgba(180,83,9,0.22);
            background: rgba(245,158,11,0.14);
            color:#92400e;
          }

          .dash-booking-modal .dash-activity-kind--admin{
            border-color: rgba(64,1,13,0.18);
            background: rgba(64,1,13,0.08);
            color:#40010D;
          }

          .dash-booking-modal .dash-activity-kind--system{
            border-color: rgba(71,85,105,0.2);
            background: rgba(148,163,184,0.16);
            color:#334155;
          }

          .dash-booking-modal .dash-activity-kind--unknown{
            border-color: rgba(148,163,184,0.22);
            background: rgba(248,250,252,0.92);
            color:#475569;
          }

          .dash-booking-modal .dash-activity-note{
            padding:10px 12px;
            border-radius:14px;
            background: rgba(64,1,13,0.05);
            border:1px solid rgba(64,1,13,0.08);
            font-size:13px;
            color:#423633;
            line-height:1.8;
          }

          .dash-booking-modal .dash-modal-actions{
            display:flex;
            gap:10px;
            justify-content:flex-end;
            margin-top:16px;
            flex-wrap:wrap;
          }

          /* ألوان أزرار مودال تفاصيل الحجز (هادئة ومتناغمة) */
          .dash-booking-modal .exp-btn,
          .dash-booking-modal .exp-btn.ghost{
            background: rgba(245, 245, 244, 0.95) !important;
            color: #0D0D0D !important;
            border: 1px solid rgba(13, 13, 13, 0.14) !important;
            box-shadow: 0 8px 18px rgba(13, 13, 13, 0.08);
          }

          .dash-booking-modal .exp-btn.primary{
            background: #515659 !important;
            color: #fff !important;
            border: 1px solid rgba(81, 86, 89, 0.65) !important;
            box-shadow: 0 10px 22px rgba(13, 13, 13, 0.14);
          }

          .dash-booking-modal .exp-btn:hover,
          .dash-booking-modal .exp-btn.primary:hover,
          .dash-booking-modal .exp-btn.ghost:hover{
            transform: translateY(-1px);
            filter: brightness(1.02);
          }

          @media (max-width: 992px){
            .dash-booking-modal .dash-details-grid{ grid-template-columns:repeat(2, minmax(0, 1fr)); }
            .dash-booking-modal .dash-detail--wide{ grid-column:span 2; }
            .dash-booking-modal .dash-detail--hero{ grid-column:span 2; }
            .dash-booking-modal .dash-booking-section{ padding:16px; }
          }

          @media (max-width: 600px){
            .dash-booking-modal .dash-modal-title h3{ font-size:19px; }
            .dash-booking-modal .dash-modal-body{ max-height: min(74vh, 760px) !important; }
            .dash-booking-modal .dash-booking-sheet{ gap:14px; }
            .dash-booking-modal .dash-booking-section{ padding:14px; border-radius:18px; }
            .dash-booking-modal .dash-section-head{ margin-bottom:12px; }
            .dash-booking-modal .dash-details-grid{ grid-template-columns:1fr; }
            .dash-booking-modal .dash-detail--wide{ grid-column:span 1; }
            .dash-booking-modal .dash-detail--hero{ grid-column:span 1; }
            .dash-booking-modal .dash-detail,
            .dash-booking-modal .dash-activity-card{ padding:13px 14px; border-radius:16px; }
            .dash-booking-modal .dash-activity-item{ grid-template-columns:20px minmax(0, 1fr); gap:10px; }
            .dash-booking-modal .dash-activity-time{ white-space:normal; }
            .dash-booking-modal .dash-modal-actions .exp-btn{ width:100%; justify-content:center; }
          }
        `}
      </style>

      {isSidebarOpen && (
        <div className="dash-side-overlay" onClick={() => setIsSidebarOpen(false)} />
      )}

      <div className="container-fluid">
        <div className="row">
          {/* Sidebar */}
          <div
            className={`col-md-3 col-lg-2 dashboard-sidebar ${isSidebarOpen ? "is-open" : ""}${isSidebarCollapsed ? " is-collapsed" : ""}`}
          >
            <button
              type="button"
              className="dash-mobile-close"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="إغلاق القائمة"
              title="إغلاق"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>

            <div className="sidebar-header">
              <img src={logo1} alt="MALIKAT SALON Logo" className="sidebar-logo" />
              <button
                type="button"
                className="dash-sidebar-collapse"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-expanded={!isSidebarCollapsed}
                aria-label={isSidebarCollapsed ? "توسيع القائمة" : "طي القائمة"}
                title={isSidebarCollapsed ? "توسيع القائمة" : "طي القائمة"}
              >
                <FontAwesomeIcon icon={isSidebarCollapsed ? faChevronLeft : faChevronRight} />
              </button>
            </div>

            <div className="user-info">
              <div className="user-avatar">
                <FontAwesomeIcon icon={getRoleIcon(userInfo.role)} />
              </div>
              <div className="user-details">
                <h5>{userInfo.name}</h5>
                <p>{displayedRoleTitle}</p>
              </div>
            </div>

            <nav className="sidebar-nav">
              <ul>
                {hasPrimaryNavigation ? (
                  <li className="sidebar-nav-section">الحجوزات والعملاء والمالية</li>
                ) : null}

                {hasPermission("workspace.dashboard.view") ? (
                  <li>
                    <NavLink to="/dashboard/overview" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faChartLine} />
                      نظرة عامة
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("bookings.view") ? (
                  <li>
                    <NavLink to="/dashboard/bookings" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      الحجوزات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("bookings.create") ? (
                  <li>
                    <NavLink to="/dashboard/booking-internal" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faUserShield} />
                      الحجز الإداري
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("bookings.day_audit.manage") ? (
                  <li>
                    <NavLink to="/dashboard/day-audit" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faWallet} />
                      إغلاق اليوم / الشفت
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("bookings.queue_tv.view") ? (
                  <li>
                    <NavLink to="/dashboard/tv-queue" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faTv} />
                      شاشة الحجوزات (TV)
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("clients.view") ? (
                  <li>
                    <NavLink to="/dashboard/clients" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faUsers} />
                      العملاء
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("income.view") ? (
                  <li>
                    <NavLink to="/dashboard/income" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faWallet} />
                      الإيرادات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("expenses.view") ? (
                  <li>
                    <NavLink to="/dashboard/expenses" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faMoneyBillWave} />
                      <span className="dash-nav-label">
                        المصروفات
                        {missingExpenseNotesCount > 0 ? <span className="dash-badge">{missingExpenseNotesCount}</span> : null}
                      </span>
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("payroll.view") ? (
                  <li>
                    <NavLink to="/dashboard/payroll" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faMoneyBillWave} />
                      إدارة الرواتب
                    </NavLink>
                  </li>
                ) : null}

                {hasAnyPermission(["targets.view", "targets.view_all", "payroll.view"]) ? (
                  <li>
                    <NavLink to="/dashboard/employee-targets" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faChartLine} />
                      تارقت الموظفات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("staffPerformance.view") ? (
                  <li>
                    <NavLink to="/dashboard/staff-performance" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faChartLine} />
                      أداء الموظفات
                    </NavLink>
                  </li>
                ) : null}

                {hasManagementNavigation ? (
                  <li className="sidebar-nav-section">الإدارة والتقارير</li>
                ) : null}

                {hasPermission("partners.manage") ? (
                  <li>
                    <NavLink to="/dashboard/partners" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faStore} />
                      الشريكات والمساحات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("offers.manage") ? (
                  <li>
                    <NavLink to="/dashboard/offers" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faPercent} />
                      العروض والكوبونات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("reports.view") ? (
                  <li>
                    <NavLink to="/dashboard/reports" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faChartPie} />
                      التقارير
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("logs.view") ? (
                  <li>
                    <NavLink to="/dashboard/logs" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faClockRotateLeft} />
                      سجل الحركات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("clients.loyalty.manage") ? (
                  <li>
                    <NavLink to="/dashboard/loyalty" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faChartPie} />
                      الولاء (VIP)
                    </NavLink>
                  </li>
                ) : null}

                {hasSettingsNavigation ? (
                  <li className="sidebar-nav-section">الموظفات والحسابات والإعدادات</li>
                ) : null}

                {hasPermission("workspace.dashboard.view") ? (
                  <li>
                    <NavLink to="/dashboard/admin-profile" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faUser} />
                      الملف الشخصي
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("settings.general.manage") ? (
                  <li>
                    <NavLink to="/dashboard/settings" className="nav-link" end onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faCog} />
                      الإعدادات الأساسية
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("settings.booking.manage") ? (
                  <li>
                    <NavLink to="/dashboard/settings/bookings" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      إعدادات الحجوزات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("catalog.manage") ? (
                  <li>
                    <NavLink to="/dashboard/settings/catalog" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faPercent} />
                      إدارة الكتالوج
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("admin_accounts.view") || hasPermission("admin_accounts.manage") ? (
                  <li>
                    <NavLink to="/dashboard/settings/users" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faUserShield} />
                      إدارة الحسابات
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("settings.content.manage") ? (
                  <li>
                    <NavLink to="/dashboard/settings/contact" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faHouse} />
                      محتوى الموقع
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("attendance.view") ? (
                  <li>
                    <NavLink to="/dashboard/attendance" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faFingerprint} />
                      سجل البصمة والأجهزة
                    </NavLink>
                  </li>
                ) : null}

                {hasPermission("attendance.settings.manage") ? (
                  <li>
                    <NavLink to="/dashboard/settings/attendance" className="nav-link" onClick={() => setIsSidebarOpen(false)}>
                      <FontAwesomeIcon icon={faCog} />
                      إعدادات البصمة والنطاقات
                    </NavLink>
                  </li>
                ) : null}
              </ul>
            </nav>

          </div>

          {/* Main Content */}
          <div className={`col-md-9 col-lg-10 dashboard-main${isSingleScrollWorkspacePage ? " has-single-scroll" : ""}`}>
            <DashboardHeader
              theme="dashboard"
              title={dashboardHeaderTitle}
              subtitle={settings.salonName || "Queens Salon"}
              className={`dash-topbar dash-topbar--sticky ${isTvQueuePage ? "is-tv-queue-topbar" : ""}`}
              showProfileButton={hasPermission("workspace.dashboard.view")}
              leading={
                <button
                  type="button"
                  className="dash-topbar-toggle"
                  onClick={() => setIsSidebarOpen((prev) => !prev)}
                  aria-label="فتح القائمة"
                  title="القائمة"
                >
                  <FontAwesomeIcon icon={faBars} />
                </button>
              }
              actions={
                isTvQueuePage ? (
                  <span className="dashboard-header__clock">
                    {topbarClockText}
                  </span>
                ) : (
                  <InternalPortalSwitcher
                    canOpenDashboard={hasPermission("workspace.dashboard.view")}
                    canOpenHr={canOpenHrPortal}
                    onLogout={handleLogout}
                    className="dash-topbar-actions"
                  />
                )
              }
            />

            <div className="dashboard-inner">
              <Routes>
                <Route index element={<Navigate to="/dashboard/overview" replace />} />

                <Route
                  path="staff"
                  element={
                    <Navigate to="/employee/overview" replace />
                  }
                />

                <Route
                  path="overview"
                  element={
                    <PermissionRoute permission="workspace.dashboard.view">
                      <DashboardOverview
                        userInfo={userInfo}
                        stats={stats}
                        scheduleBookings={todayScheduleBookings}
                        selectedScheduleDate={scheduleDate}
                        onSelectedScheduleDateChange={setScheduleDate}
                        businessHours={settings.booking?.businessHours}
                        onOpenBooking={handleOpenBooking}
                        onQuickAction={handleQuickAction}
                        financial={{
                          income: totalIncome,
                          expenses: totalExpenses,
                          profit: netProfit,
                        }}
                        financeToday={financeToday}
                        recentFinanceTransactions={recentFinanceTransactions}
                      />
                    </PermissionRoute>
                  }
                />

                <Route
                  path="booking-internal"
                  element={
                    <PermissionRoute permission="bookings.create">
                      <BookingInternalV2 />
                    </PermissionRoute>
                  }
                />

                <Route
                  path="booking-internal-v2"
                  element={
                    <PermissionRoute permission="bookings.create">
                      <BookingInternalV2 />
                    </PermissionRoute>
                  }
                />

                <Route
                  path="booking-internal-legacy"
                  element={
                    <PermissionRoute permission="bookings.create">
                      <BookingInternal internalMode />
                    </PermissionRoute>
                  }
                />

                <Route
                  path="bookings"
                  element={
                    <PermissionRoute permission="bookings.view">
                      <DashboardBookings currentRole={userInfo.role} />
                    </PermissionRoute>
                  }
                />

                <Route path="tv-queue" element={<PermissionRoute permission="bookings.queue_tv.view"><DashboardQueueTv /></PermissionRoute>} />
                <Route path="day-audit" element={<PermissionRoute permission="bookings.day_audit.manage"><DashboardDayAudit /></PermissionRoute>} />
                <Route path="clients" element={<PermissionRoute permission="clients.view"><DashboardClients currentRole={userInfo.role} /></PermissionRoute>} />
                <Route path="partners" element={<PermissionRoute permission="partners.manage"><DashboardPartners /></PermissionRoute>} />
                <Route path="loyalty" element={<PermissionRoute permission="clients.loyalty.manage"><DashboardLoyalty /></PermissionRoute>} />
                <Route path="offers" element={<PermissionRoute permission="offers.manage"><DashboardOffers /></PermissionRoute>} />
                <Route path="reports" element={<PermissionRoute permission="reports.view"><DashboardReports /></PermissionRoute>} />
                <Route path="income" element={<PermissionRoute permission="income.view"><DashboardIncome /></PermissionRoute>} />
                <Route path="expenses" element={<PermissionRoute permission="expenses.view"><DashboardExpenses /></PermissionRoute>} />
                <Route path="payroll" element={<PermissionRoute permission="payroll.view"><DashboardPayroll /></PermissionRoute>} />
                <Route path="employee-targets" element={<PermissionRoute anyOf={["targets.view", "targets.view_all", "payroll.view"]}><DashboardEmployeeTargets /></PermissionRoute>} />
                <Route path="staff-performance" element={<PermissionRoute permission="staffPerformance.view"><DashboardStaffPerformance /></PermissionRoute>} />
                <Route path="staff-performance/:employeeId" element={<PermissionRoute permission="staffPerformance.view"><DashboardStaffPerformance /></PermissionRoute>} />
                <Route
                  path="attendance"
                  element={
                    <PermissionRoute permission="attendance.view">
                      <DashboardAttendanceSecurity />
                    </PermissionRoute>
                  }
                />

                <Route
                  path="settings/*"
                  element={
                    <PermissionRoute
                      anyOf={[
                        "settings.general.manage",
                        "settings.booking.manage",
                        "catalog.manage",
                        "admin_accounts.view",
                        "admin_accounts.manage",
                        "settings.content.manage",
                        "attendance.settings.manage",
                      ]}
                    >
                      <DashboardSettings
                        initialRole={userInfo.role}
                        authReady={Boolean(userInfo)}
                        settings={settings}
                      />
                    </PermissionRoute>
                  }
                />

                <Route path="admin-profile" element={<PermissionRoute permission="workspace.dashboard.view"><DashboardAdminProfile /></PermissionRoute>} />
                <Route path="logs" element={<PermissionRoute permission="logs.view"><DashboardLogs /></PermissionRoute>} />

                <Route
                  path="*"
                  element={<Navigate to="/dashboard/overview" replace />}
                />
              </Routes>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Modal تفاصيل الحجز */}
      <DashboardMobileNav missingExpenseNotesCount={missingExpenseNotesCount} />
      {selectedBooking && (
        <Modal
          open={!!selectedBooking}
          onClose={() => setSelectedBooking(null)}
          ariaLabel="تفاصيل الحجز"
          panelClassName="dash-modal dash-booking-modal booking-details-modal dashboard-skin"
          size="lg"
        >
          <div className="dash-modal-header">
            <div className="dash-modal-title">
              <h3>تفاصيل الحجز</h3>
              <small>عرض تفاصيل الحجز بشكل مرتب وواضح</small>
            </div>

            <button
              className="exp-btn ghost"
              type="button"
              onClick={() => setSelectedBooking(null)}
            >
              <FontAwesomeIcon icon={faXmark} /> إغلاق
            </button>
          </div>

          <div className="dash-modal-body">
            <div className="dash-booking-sheet">
              <section className="dash-booking-section">
                <div className="dash-section-head">
                  <div>
                    <h4>بيانات الحجز</h4>
                    <span>نفس الحقول الحالية مع ترتيب أوضح ومسافات أفضل بين البطاقات.</span>
                  </div>
                </div>

                <div className="dash-details-grid">
                  <div className="dash-detail dash-detail--hero">
                    <b>رقم الحجز</b>
                    <div className="dash-value">{bookingNoOf(selectedBooking)}</div>
                    <div className="dash-created-badge">
                      <FontAwesomeIcon icon={faClockRotateLeft} />
                      تم إنشاء الحجز: {formatDateTimeAr((selectedBooking as any).createdAt)}
                    </div>
                  </div>

                  <div className="dash-detail">
                    <b>العميلة</b>
                    <div className="dash-value">{selectedBooking.customerName}</div>
                  </div>

                  <div className="dash-detail">
                    <b>رقم الجوال</b>
                    <div className="dash-value">{selectedBooking.phone || "—"}</div>
                  </div>

                  <div className="dash-detail">
                    <b>الخدمة</b>
                    <div className="dash-value">
                      {selectedBooking.serviceName || selectedBooking.serviceId || "-"}
                    </div>
                  </div>

                  <div className="dash-detail">
                    <b>القسم</b>
                    <div className="dash-value">{selectedBooking.serviceSectionName || "—"}</div>
                  </div>

                  <div className="dash-detail">
                    <b>التصنيف</b>
                    <div className="dash-value">{selectedBooking.serviceCategoryName || "—"}</div>
                  </div>

                  <div className="dash-detail">
                    <b>الموظفة</b>
                    <div className="dash-value">{selectedBooking.employeeName ?? "-"}</div>
                  </div>

                  <div className="dash-detail">
                    <b>التاريخ</b>
                    <div className="dash-value">{selectedBooking.date}</div>
                    <div className="dash-value-sub">
                      {selectedBooking.time ? `الساعة ${formatTime12(selectedBooking.time)}` : ""}
                    </div>
                  </div>

                  <div className="dash-detail">
                    <b>الوقت</b>
                    <div className="dash-value">{formatTime12(selectedBooking.time)}</div>
                  </div>

                  <div className="dash-detail">
                    <b>الإجمالي</b>
                    <div className="dash-value">
                      {selectedBooking.total ? `${selectedBooking.total} ريال` : "-"}
                    </div>
                  </div>

                  <div className="dash-detail dash-detail--wide">
                    <b>الحالة</b>

                    <div className="dash-status-row">
                      <span className={`status-badge ${selectedBooking.status}`}>
                        {bookingStatusLabelAr(selectedBooking.status)}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>
                        التحكم بالحالة من صفحة إدارة الحجوزات فقط
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="dash-booking-section dash-booking-section--timeline">
                <div className="dash-section-head">
                  <div>
                    <h4>سجل الحجز</h4>
                    <span>تسلسل الأحداث للحجز من الأحدث إلى الأقدم.</span>
                  </div>
                </div>

                {selectedBookingActivityLoading ? (
                  <div className="dash-activity-empty">جاري تحميل سجل الحجز...</div>
                ) : selectedBookingActivity.length > 0 ? (
                  <div className="dash-activity-timeline">
                    {selectedBookingActivity.map((event) => (
                      <div
                        key={event.id}
                        className={`dash-activity-item dash-activity-item--${event.tone}`}
                      >
                        <div className="dash-activity-rail">
                          <span className="dash-activity-dot" />
                          <span className="dash-activity-line" />
                        </div>

                        <div className="dash-activity-card">
                          <div className="dash-activity-top">
                            <div className="dash-activity-copy">
                              <strong>{event.title}</strong>
                              <div className="dash-activity-meta">
                                <span
                                  className={`dash-activity-kind dash-activity-kind--${event.actorKind}`}
                                >
                                  {event.actorKindLabel}
                                </span>
                                <span>
                                  <span className="dash-activity-meta-label">بواسطة:</span>{" "}
                                  {event.actorName}
                                </span>
                              </div>
                            </div>

                            <div className="dash-activity-time">{event.atLabel}</div>
                          </div>

                          {event.changes.length ? (
                            <div className="dash-activity-meta">
                              <span className="dash-activity-meta-label">ما الذي تغير:</span>
                              <span>{event.changes.join(" • ")}</span>
                            </div>
                          ) : null}

                          {event.note ? (
                            <div className="dash-activity-note">{event.note}</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dash-activity-empty">
                    {selectedBookingActivityError || "لا توجد أحداث مسجلة لهذا الحجز حتى الآن."}
                  </div>
                )}

                {selectedBookingActivityError && selectedBookingActivity.length > 0 ? (
                  <div className="dash-activity-note">{selectedBookingActivityError}</div>
                ) : null}
              </section>
            </div>

            <div className="dash-modal-actions">
              <button
                className="exp-btn ghost"
                onClick={() => navigate("/dashboard/bookings")}
                type="button"
              >
                فتح صفحة الحجوزات
              </button>
              <button
                className="exp-btn primary"
                onClick={() => setSelectedBooking(null)}
                type="button"
              >
                تم
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Dashboard;
