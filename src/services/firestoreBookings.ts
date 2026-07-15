// src/services/firestoreBookings.ts
import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  where,
  serverTimestamp,
  Timestamp,
  setDoc,
  query,
  onSnapshot,
  runTransaction,
  deleteDoc,
  deleteField,
  limit,
} from "firebase/firestore";

// ✅ generate same time slots list used by Booking page
import { generateSalonTimeSlots, filterSlotsByServiceEnd } from "../helpers/timeSlots";
import { isStaffAvailableForDate } from "../helpers/staffAvailability";

// ✅ read slotStep/buffer from settings/app (source of truth)
import { AppSettingsService } from "./AppSettingsService";

// ✅ for logging who did the action (best effort)
import { getAuth } from "firebase/auth";

import { writeAuditLog, type LogSource } from "./logService";
import { FirestoreReadStats } from "./firestoreReadStats";
import { normalizeBookedSlotsMap } from "./firestoreAvailabilityDays";
import { PackageOperationsService } from "./PackageOperationsService";
import { getDataSourceFlags } from "../config/dataSourceFlags";
import { coreD1BookingDataSource } from "./bookingDataSources/coreD1BookingDataSource";
import { CoreBookingService } from "./CoreBookingService";
import { CoreAuditService } from "./CoreAuditService";
import { coreBookingToLegacy } from "./coreBookingMappers";


export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingChannel = "client" | "dashboard" | "internal";
type BookingPaymentMethod = "cash" | "card" | "transfer" | "mixed";
export type BookingPaymentType = "full" | "partial" | "none";
export type BookingPaymentBreakdown = {
  cash?: number;
  card?: number;
  transfer?: number;
};

function hasReservedPackageRedemption(raw: any) {
  const clientPackageId = String(raw?.clientPackageId || "").trim();
  const state = String(raw?.packageRedemptionState || "").trim();
  return Boolean(clientPackageId) && state === "reserved";
}

// ✅ NEW: Snapshot ثابت للعرض وعدم تأثر الحجوزات بتغيير الأسعار لاحقًا
export type ServiceSnapshot = {
  serviceNameAtBooking: string;
  priceAtBooking: number;
  durationAtBooking: number;
  sectionIdAtBooking?: string;
  sectionTitleAtBooking?: string;
  categoryIdAtBooking?: string;
  categoryNameAtBooking?: string;
};

export type PackageServiceSnapshot = {
  serviceId: string;
  serviceName: string;
  sectionId?: string;
  categoryId?: string;
  price: number;
  durationMin: number;
};

export type PackageSnapshot = {
  packageId: string;
  packageName: string;
  finalPriceAtBooking: number;
  baseTotalPriceAtBooking: number;
  totalDurationMinAtBooking: number;
  serviceIds: string[];
  services: PackageServiceSnapshot[];
  sessionsCount?: number;
  kind?: "service_package" | "session_package";
};

export type BookingDoc = {
  userId?: string | null;

  slotStepMinAtBooking?: number;
  bufferMinAtBooking?: number;

  createdBy: string;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdByName?: string | null;
  channel: BookingChannel;

  clientName: string;
  clientPhone: string;

  /**
   * ✅ legacy (نتركه للتوافق)
   * قد يكون اسم أو serviceId في الداتا القديمة
   */
  serviceName: string;

  /**
   * ✅ NEW (ID-first)
   */
  serviceId?: string;
  serviceSnapshot?: ServiceSnapshot;
  packageId?: string;
  packageSnapshot?: PackageSnapshot;
  fromSessionPackage?: boolean;
  sessionPackageId?: string;
  sessionPackageName?: string;
  allowedServiceIds?: string[];
  consumeOneSession?: boolean;

  /**
   * ✅ NEW: رقم حجز بشري MK-xxxxx (سيرفر)
   */
  publicId?: string;

  // ✅ service duration in minutes (prevents overlaps)
  durationMin?: number;

  /**
   * ✅ employee linking
   * employeeId = staff_public doc id (من Booking page)
   * employeeUid = linkedUid الحقيقي (اختياري)
   * employeeKey = المفتاح المستخدم لعرض حجوزات الموظفة في Staff portal
   *   - Prefer employeeUid
   *   - Fallback employeeId (staff_public id)
   *   - Fallback safeKey(employeeName)
   */
  employeeId?: string | null;
  employeeUid?: string | null;

  employeeName: string;
  employeeKey?: string;

  date: string;
  time: string;
  startTime?: string;
  endTime?: string;

  // ✅ stored start-slotId (for debugging & tracking)
  slotId?: string;

  total?: number;
  finalPrice?: number;
  paymentMethod?: BookingPaymentMethod;
  paymentBreakdown?: BookingPaymentBreakdown;
  paymentType?: BookingPaymentType;
  paidAmount?: number;
  remainingAmount?: number;

  status: BookingStatus;
  note?: string;
  viewedAt?: Timestamp | number;
  viewedAtMs?: number;
  viewedByUid?: string | null;
  viewedByEmail?: string | null;
  viewedByName?: string | null;
  pendingAt?: number;
  pendingByUid?: string;
  pendingByEmail?: string | null;
  pendingByName?: string | null;
  confirmedAt?: number;
  confirmedByUid?: string;
  confirmedByEmail?: string | null;
  confirmedByName?: string | null;
  completedAt?: number;
  completedByUid?: string;
  completedByEmail?: string | null;
  completedByName?: string | null;
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByEmail?: string | null;
  cancelledByName?: string | null;
  paidAt?: number;
  paidByUid?: string;
  paidByEmail?: string | null;
  paidByName?: string | null;
  createdAtMs?: number;
  updatedByUid?: string | null;
  updatedByEmail?: string | null;
  updatedByName?: string | null;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type BookingDocWithId = BookingDoc & { id: string };
export type BookingGroupInput = {
  parent: BookingDoc;
  items: BookingDoc[];
};

const SALON_ID = "main";
const BOOKINGS_COL = ["salons", SALON_ID, "bookings"] as const;
const SLOTS_COL = ["salons", SALON_ID, "booking_slots"] as const;
const TRACKS_COL = ["salons", SALON_ID, "booking_tracks"] as const;
const ALLOW_OVERTIME_MIN = 15;

// ✅ Income collection
const INCOME_COL = ["salons", SALON_ID, "income"] as const;

// ✅ Counter doc for server-generated publicId
const COUNTERS_COL = ["salons", SALON_ID, "counters"] as const;
const BOOKINGS_COUNTER_DOC = "bookings";

// ✅ Booking Logs
const LOGS_COL = ["salons", SALON_ID, "booking_logs"] as const;
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function isPlainObject(v: any): v is Record<string, any> {
  if (Object.prototype.toString.call(v) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function stripUndefined<T>(value: T): T {
  if (value === undefined) return value;

  if (Array.isArray(value)) {
    const cleanedArr = value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined);
    return cleanedArr as T;
  }

  if (isPlainObject(value)) {
    const cleanedObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleanedVal = stripUndefined(v as any);
      if (cleanedVal !== undefined) cleanedObj[k] = cleanedVal;
    }
    return cleanedObj as T;
  }

  return value;
}

function normalizeStringArray(values: any): string[] {
  if (!Array.isArray(values)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const next = String(value || "").trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  });
  return out;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const batchSize = Math.max(1, Number(size || 1));
  for (let index = 0; index < items.length; index += batchSize) {
    out.push(items.slice(index, index + batchSize));
  }
  return out;
}

function normalizePackageServices(values: any): PackageServiceSnapshot[] {
  if (!Array.isArray(values)) return [];

  const byId = new Map<string, PackageServiceSnapshot>();
  values.forEach((row) => {
    const serviceId = String(row?.serviceId || "").trim();
    if (!serviceId) return;

    const prev = byId.get(serviceId);
    byId.set(serviceId, {
      serviceId,
      serviceName:
        String(row?.serviceName || "").trim() ||
        String(prev?.serviceName || "").trim() ||
        serviceId,
      sectionId:
        String(row?.sectionId || "").trim() ||
        String(prev?.sectionId || "").trim() ||
        undefined,
      categoryId:
        String(row?.categoryId || "").trim() ||
        String(prev?.categoryId || "").trim() ||
        undefined,
      price: Math.max(0, Number(row?.price ?? prev?.price ?? 0)),
      durationMin: Math.max(0, Number(row?.durationMin ?? prev?.durationMin ?? 0)),
    });
  });

  return Array.from(byId.values());
}

function normalizeBooking(raw: any): BookingDoc {
  const paymentState = resolveBookingPaymentState(raw);
  return {
    userId: raw?.userId ?? null,

    slotStepMinAtBooking: Number(raw?.slotStepMinAtBooking ?? 0) || undefined,
    bufferMinAtBooking: Number(raw?.bufferMinAtBooking ?? 0) || undefined,

    createdBy: String(raw?.createdBy ?? ""),
    createdByUid: raw?.createdByUid ? String(raw.createdByUid) : undefined,
    createdByEmail: raw?.createdByEmail ? String(raw.createdByEmail) : undefined,
    createdByName: raw?.createdByName ? String(raw.createdByName) : undefined,
    channel:
      raw?.channel === "internal"
        ? "internal"
        : raw?.channel === "dashboard"
          ? "dashboard"
          : "client",

    clientName: String(
      raw?.clientName ??
      raw?.customerName ??
      raw?.name ??
      raw?.customer ??
      raw?.client?.name ??
      raw?.customer?.name ??
      raw?.userName ??
      ""
    ),
    clientPhone: String(
      raw?.clientPhone ??
      raw?.phone ??
      raw?.customerPhone ??
      raw?.mobile ??
      raw?.client?.phone ??
      raw?.customer?.phone ??
      raw?.userPhone ??
      ""
    ),

    // legacy
    serviceName: String(raw?.serviceName ?? ""),

    // ✅ NEW
    serviceId: raw?.serviceId ? String(raw.serviceId) : undefined,
    publicId: raw?.publicId ? String(raw.publicId) : undefined,
    serviceSnapshot: raw?.serviceSnapshot
      ? {
        serviceNameAtBooking: String(raw.serviceSnapshot.serviceNameAtBooking ?? ""),
        priceAtBooking: Number(raw.serviceSnapshot.priceAtBooking ?? 0),
        durationAtBooking: Number(raw.serviceSnapshot.durationAtBooking ?? 0),
        sectionIdAtBooking: raw.serviceSnapshot.sectionIdAtBooking
          ? String(raw.serviceSnapshot.sectionIdAtBooking)
          : undefined,
        sectionTitleAtBooking: raw.serviceSnapshot.sectionTitleAtBooking
          ? String(raw.serviceSnapshot.sectionTitleAtBooking)
          : undefined,
        categoryIdAtBooking: raw.serviceSnapshot.categoryIdAtBooking
          ? String(raw.serviceSnapshot.categoryIdAtBooking)
          : undefined,
        categoryNameAtBooking: raw.serviceSnapshot.categoryNameAtBooking
          ? String(raw.serviceSnapshot.categoryNameAtBooking)
          : undefined,
      }
      : undefined,
    packageId: raw?.packageId ? String(raw.packageId) : undefined,
    packageSnapshot: raw?.packageSnapshot
      ? {
          packageId: String(raw.packageSnapshot.packageId ?? ""),
          packageName: String(raw.packageSnapshot.packageName ?? ""),
          finalPriceAtBooking: Number(raw.packageSnapshot.finalPriceAtBooking ?? 0),
          baseTotalPriceAtBooking: Number(raw.packageSnapshot.baseTotalPriceAtBooking ?? 0),
          totalDurationMinAtBooking: Number(raw.packageSnapshot.totalDurationMinAtBooking ?? 0),
          serviceIds: normalizeStringArray(raw.packageSnapshot.serviceIds),
          services: normalizePackageServices(raw.packageSnapshot.services),
          sessionsCount:
            raw?.packageSnapshot?.sessionsCount === undefined ||
            raw?.packageSnapshot?.sessionsCount === null
              ? undefined
              : Math.max(1, Number(raw.packageSnapshot.sessionsCount || 0)),
          kind:
            raw.packageSnapshot.kind === "session_package"
              ? "session_package"
              : raw.packageSnapshot.kind === "service_package"
                ? "service_package"
                : undefined,
        }
      : undefined,
    fromSessionPackage:
      raw?.fromSessionPackage === undefined ? undefined : !!raw.fromSessionPackage,
    sessionPackageId: raw?.sessionPackageId ? String(raw.sessionPackageId) : undefined,
    sessionPackageName: raw?.sessionPackageName ? String(raw.sessionPackageName) : undefined,
    allowedServiceIds:
      normalizeStringArray(raw?.allowedServiceIds).length > 0
        ? normalizeStringArray(raw?.allowedServiceIds)
        : normalizeStringArray(raw?.packageSnapshot?.serviceIds),
    consumeOneSession:
      raw?.consumeOneSession === undefined ? undefined : !!raw.consumeOneSession,

    durationMin: Number(raw?.durationMin ?? 0) || undefined,

    employeeId: raw?.employeeId ?? null,
    employeeUid: raw?.employeeUid ?? null,
    employeeName: String(raw?.employeeName ?? ""),

    employeeKey: raw?.employeeKey ? String(raw.employeeKey) : undefined,

    date: String(raw?.date ?? ""),
    time: String(raw?.time ?? ""),
    startTime: raw?.startTime ? String(raw.startTime) : undefined,

    slotId: raw?.slotId ? String(raw.slotId) : undefined,

    total: paymentState.totalAmount,
    finalPrice: Number(raw?.finalPrice ?? paymentState.totalAmount),
    paymentMethod: normalizePaymentMethod(raw?.paymentMethod) ?? undefined,
    paymentBreakdown: normalizePaymentBreakdown(raw?.paymentBreakdown),
    paymentType: paymentState.paymentType,
    paidAmount: paymentState.paidAmount,
    remainingAmount: paymentState.remainingAmount,

    status: raw?.status ?? "pending",
    note: raw?.note ?? undefined,
    viewedAt: raw?.viewedAt ?? undefined,
    viewedAtMs: Number(raw?.viewedAtMs || 0) || undefined,
    viewedByUid: raw?.viewedByUid ? String(raw.viewedByUid) : undefined,
    viewedByEmail: raw?.viewedByEmail ? String(raw.viewedByEmail) : undefined,
    viewedByName: raw?.viewedByName ? String(raw.viewedByName) : undefined,
    pendingAt: Number(raw?.pendingAt || 0) || undefined,
    pendingByUid: raw?.pendingByUid ? String(raw.pendingByUid) : undefined,
    pendingByEmail: raw?.pendingByEmail ? String(raw.pendingByEmail) : undefined,
    pendingByName: raw?.pendingByName ? String(raw.pendingByName) : undefined,
    confirmedAt: Number(raw?.confirmedAt || 0) || undefined,
    confirmedByUid: raw?.confirmedByUid ? String(raw.confirmedByUid) : undefined,
    confirmedByEmail: raw?.confirmedByEmail ? String(raw.confirmedByEmail) : undefined,
    confirmedByName: raw?.confirmedByName ? String(raw.confirmedByName) : undefined,
    completedAt: Number(raw?.completedAt || 0) || undefined,
    completedByUid: raw?.completedByUid ? String(raw.completedByUid) : undefined,
    completedByEmail: raw?.completedByEmail ? String(raw.completedByEmail) : undefined,
    completedByName: raw?.completedByName ? String(raw.completedByName) : undefined,
    cancelledAt: Number(raw?.cancelledAt || 0) || undefined,
    cancelledByUid: raw?.cancelledByUid ? String(raw.cancelledByUid) : undefined,
    cancelledByEmail: raw?.cancelledByEmail ? String(raw.cancelledByEmail) : undefined,
    cancelledByName: raw?.cancelledByName ? String(raw.cancelledByName) : undefined,
    paidAt: Number(raw?.paidAt || 0) || undefined,
    paidByUid: raw?.paidByUid ? String(raw.paidByUid) : undefined,
    paidByEmail: raw?.paidByEmail ? String(raw.paidByEmail) : undefined,
    paidByName: raw?.paidByName ? String(raw.paidByName) : undefined,
    createdAtMs: Number(raw?.createdAtMs || 0) || undefined,
    updatedByUid: raw?.updatedByUid ? String(raw.updatedByUid) : undefined,
    updatedByEmail: raw?.updatedByEmail ? String(raw.updatedByEmail) : undefined,
    updatedByName: raw?.updatedByName ? String(raw.updatedByName) : undefined,
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
}

function safeKey(s: string) {
  return String(s || "")
    .trim()
    .replaceAll("/", "-")
    .replace(/\s+/g, "_");
}

/**
 * ✅ IMPORTANT (Contract):
 * Lock key for booking_slots MUST match Booking.tsx checks.
 * Currently Booking.tsx checks by:
 * - query booking_slots where employeeId == staff_public doc id
 * and reads docs by slotId:
 *   `${salonId}__${date}__${time}__${employeeKey}`
 *
 * So in locks we use employeeKeyForLock = employeeId (staff_public id).
 */
function buildSlotId(date: string, time: string, employeeKey: string) {
  return `${safeKey(SALON_ID)}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
}

// ✅ Exported helper so Checkout/Booking can display the SAME slotId format used by Firestore lock
export function buildBookingSlotId(date: string, time: string, employeeKey: string) {
  return buildSlotId(date, time, employeeKey);
}

function slotTakenError() {
  const e: any = new Error("SLOT_TAKEN");
  e.code = "SLOT_TAKEN";
  return e;
}

// ✅ New: explicit employee required error
function employeeRequiredError() {
  const e: any = new Error("EMPLOYEE_REQUIRED");
  e.code = "EMPLOYEE_REQUIRED";
  return e;
}

function bookingDayClosedError() {
  const e: any = new Error("BOOKING_DAY_CLOSED");
  e.code = "BOOKING_DAY_CLOSED";
  return e;
}

function bookingTimeOutOfHoursError() {
  const e: any = new Error("BOOKING_TIME_OUT_OF_HOURS");
  e.code = "BOOKING_TIME_OUT_OF_HOURS";
  return e;
}

function employeeUnavailableError(reason = "EMPLOYEE_UNAVAILABLE") {
  const e: any = new Error(reason);
  e.code = "EMPLOYEE_UNAVAILABLE";
  e.reason = reason;
  return e;
}

async function assertEmployeeCanAcceptBooking(args: {
  employeeId: string;
  dateISO: string;
  channel?: BookingChannel;
}) {
  const employeeId = String(args.employeeId || "").trim();
  const dateISO = normalizeISODate(args.dateISO) || localISODate();
  if (!employeeId) throw employeeRequiredError();

  const staffRef = doc(db, "salons", SALON_ID, "staff_public", employeeId);
  const staffSnap = await getDoc(staffRef);
  if (!staffSnap.exists()) {
    throw employeeUnavailableError("EMPLOYEE_NOT_FOUND");
  }

  const staff = staffSnap.data() as any;
  const requireShowOnBooking = String(args.channel || "").trim().toLowerCase() === "client";
  const available = isStaffAvailableForDate(staff, dateISO, {
    requireShowOnBooking,
  });

  if (!available) {
    throw employeeUnavailableError(
      requireShowOnBooking ? "EMPLOYEE_NOT_PUBLICLY_BOOKABLE" : "EMPLOYEE_NOT_OPERATIONAL"
    );
  }
}

function resolveWeekdayFromISO(dateISO: string): WeekdayKey {
  const s = String(dateISO || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return JS_DAY_TO_WEEKDAY[new Date().getDay()] || "sat";

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, Math.max(0, mo - 1), d);
  return JS_DAY_TO_WEEKDAY[dt.getDay()] || "sat";
}

function normalizePaymentMethod(raw: any): BookingPaymentMethod | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "cash" || s === "نقد" || s === "كاش") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online" || s === "شبكة" || s === "مدى")
    return "card";
  if (s === "transfer" || s === "تحويل" || s === "بنكي") return "transfer";
  if (s === "mixed" || s === "مختلط" || s.includes("مختلط")) return "mixed";
  return null;
}

function normalizePaymentBreakdown(raw: any): BookingPaymentBreakdown | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const hasExplicitBreakdown =
    Object.prototype.hasOwnProperty.call(raw, "cash") ||
    Object.prototype.hasOwnProperty.call(raw, "card") ||
    Object.prototype.hasOwnProperty.call(raw, "transfer");

  const cash = Number((raw as any).cash ?? 0);
  const card = Number((raw as any).card ?? 0);
  const transfer = Number((raw as any).transfer ?? 0);
  const out: BookingPaymentBreakdown = {};

  if (Number.isFinite(cash) && cash > 0) out.cash = round2(cash);
  if (Number.isFinite(card) && card > 0) out.card = round2(card);
  if (Number.isFinite(transfer) && transfer > 0) out.transfer = round2(transfer);

  if (out.cash || out.card || out.transfer) return out;
  return hasExplicitBreakdown ? { cash: 0, card: 0, transfer: 0 } : undefined;
}

function paymentBreakdownPaidAmount(raw: any): number | null {
  const breakdown = normalizePaymentBreakdown(raw?.paymentBreakdown);
  if (!breakdown) return null;
  const total = round2(
    Number(breakdown.cash || 0) +
      Number(breakdown.card || 0) +
      Number(breakdown.transfer || 0)
  );
  return Number.isFinite(total) && total > 0 ? total : null;
}

function paymentBreakdownIncomeNote(raw: any): string | undefined {
  if (normalizePaymentMethod(raw?.paymentMethod) !== "mixed") return undefined;
  const breakdown = normalizePaymentBreakdown(raw?.paymentBreakdown);
  if (!breakdown) return "مختلط";
  return `مختلط: ${round2(Number(breakdown.cash || 0))} كاش + ${round2(
    Number(breakdown.card || 0)
  )} شبكة + ${round2(Number(breakdown.transfer || 0))} تحويل`;
}

function normalizePaymentType(raw: any): BookingPaymentType | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s === "none" || s === "no_payment" || s === "unpaid" || s === "بدون دفع") return "none";
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

function readTotalAmount(raw: any): number {
  const v = Number(
    raw?.finalPrice ??
      raw?.total ??
      raw?.serviceSnapshot?.priceAtBooking ??
      raw?.packageSnapshot?.finalPriceAtBooking ??
      0
  );
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function localISODate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveBookingPaymentState(raw: any): {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
} {
  const totalAmount = readTotalAmount(raw);
  const normalizedType = normalizePaymentType(raw?.paymentType);
  const breakdownPaid = paymentBreakdownPaidAmount(raw);
  const hasStoredPaid = Number.isFinite(Number(raw?.paidAmount));
  const hasExplicitPaid = hasStoredPaid || breakdownPaid !== null;
  const explicitPaid = hasStoredPaid ? Number(raw?.paidAmount) : Number(breakdownPaid ?? NaN);
  const status = String(raw?.status || "").toLowerCase().trim() as BookingStatus;
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "none");
  let paidAmount: number;
  if (paymentType === "none") {
    paidAmount = 0;
  } else if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
  } else if (paymentType === "partial") {
    paidAmount = 0;
  } else {
    paidAmount = isRevenueStatus ? totalAmount : 0;
  }

  if (paidAmount <= 0 && totalAmount > 0) {
    paymentType = "none";
  } else if (paymentType === "full") {
    paidAmount = isRevenueStatus ? totalAmount : Math.max(0, Math.min(totalAmount, paidAmount));
  } else {
    paymentType = paidAmount >= totalAmount ? "full" : "partial";
  }

  const remainingAmount = Math.max(0, round2(totalAmount - paidAmount));
  return {
    paymentType,
    paidAmount: round2(Math.max(0, Math.min(totalAmount, paidAmount))),
    remainingAmount,
    totalAmount,
  };
}

// ✅ Helper: parse explicit payment method from note only
function parseExplicitPaymentMethod(note?: string): BookingPaymentMethod | null {
  const raw = String(note || "").trim();
  const s = raw.toLowerCase();

  // Structured markers from reception/invoice flows
  const inv = s.match(/invoice_from_reception:(cash|transfer|card|mixed)/);
  if (inv?.[1]) return inv[1] as BookingPaymentMethod;

  const pm = s.match(/payment[_\s-]?method\s*[:=]\s*(cash|transfer|card|mixed)/);
  if (pm?.[1]) return pm[1] as BookingPaymentMethod;

  // Explicit payment phrases only (avoid accidental matches in free notes)
  if (/(طريقة\s*(الدفع|السداد)\s*[:\-]?\s*(شبكة|مدى))/i.test(raw)) return "card";
  if (/(طريقة\s*(الدفع|السداد)\s*[:\-]?\s*(كاش|نقد))/i.test(raw)) return "cash";
  if (/(طريقة\s*(الدفع|السداد)\s*[:\-]?\s*(تحويل|بنكي))/i.test(raw)) return "transfer";

  // Legacy explicit tokens
  if (/\b(card|mada|pos_card|mada_online)\b/i.test(s)) return "card";
  if (/\b(cash)\b/i.test(s)) return "cash";
  if (/\b(transfer|bank)\b/i.test(s)) return "transfer";
  if (/\b(mixed)\b/i.test(s) || raw.includes("مختلط")) return "mixed";

  return null;
}

function resolvePaymentMethodForStatus(
  status: BookingStatus,
  paymentMethodRaw: any,
  note?: string
): BookingPaymentMethod | undefined {
  const fromField = normalizePaymentMethod(paymentMethodRaw);
  if (fromField) return fromField;
  const fromNote = parseExplicitPaymentMethod(note);
  if (fromNote) return fromNote;
  if (status === "confirmed" || status === "completed") return "transfer";
  return undefined;
}

function getAmount(b: BookingDoc): number {
  return resolveBookingPaymentState(b).paidAmount;
}

function shouldAutoConfirmPendingOnFullPayment(
  raw: Partial<BookingDoc>,
  requestedStatus: BookingStatus
): boolean {
  if (requestedStatus !== "pending") return false;
  const channel = String(raw?.channel || "").trim().toLowerCase();
  if (channel === "internal") return false;

  const payment = resolveBookingPaymentState({
    ...raw,
    status: requestedStatus,
  });
  const total = Number(payment.totalAmount || 0);
  if (!Number.isFinite(total) || total <= 0) return false;

  return (
    payment.paymentType === "full" &&
    Number(payment.paidAmount || 0) >= total &&
    Number(payment.remainingAmount || 0) <= 0
  );
}

// Backward-compatible alias for create flows that still reference the old name.
function shouldAutoConfirmClientPendingOnCreate(
  raw: Partial<BookingDoc>,
  requestedStatus: BookingStatus
): boolean {
  return shouldAutoConfirmPendingOnFullPayment(raw, requestedStatus);
}

function shouldForceClientPendingUnpaidOnCreate(raw: Partial<BookingDoc>): boolean {
  return (
    String(raw?.channel || "").trim().toLowerCase() === "client" &&
    String(raw?.createdBy || "").trim().toLowerCase() === "client"
  );
}

type ActorSnapshot = {
  uid: string;
  email: string;
  displayName: string;
};

const GENERIC_ACTOR_TOKENS = new Set<string>([
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
  "anonymous",
  "anon",
  "auto-assigned",
  "auto assigned",
  "تعيين تلقائي",
  "مستخدم",
  "عميلة",
  "موظفة",
]);

function normalizeActorToken(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function emailLocalPart(email: unknown) {
  const raw = String(email || "").trim();
  return raw ? raw.split("@")[0] : "";
}

function isMeaningfulActorName(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return !GENERIC_ACTOR_TOKENS.has(normalizeActorToken(raw));
}

function resolveBookingLogSource(channel?: string): LogSource {
  const raw = String(channel || "").trim().toLowerCase();
  if (raw === "client") return "client_app";
  if (raw === "internal") return "internal_booking";
  return "dashboard";
}

function resolveActorSnapshot(args?: {
  booking?: Partial<BookingDoc> | null;
  uid?: string;
  email?: string;
  name?: string;
}): ActorSnapshot {
  const auth = getAuth();
  const u = auth.currentUser;
  const storedActor = readStoredActorSnapshot();
  const booking = (args?.booking || {}) as Partial<BookingDoc>;

  const uid = String(
    args?.uid ||
      u?.uid ||
      storedActor.uid ||
      booking.userId ||
      booking.updatedByUid ||
      booking.createdByUid ||
      ""
  ).trim();
  const email = String(
    args?.email ||
      u?.email ||
      storedActor.email ||
      booking.updatedByEmail ||
      booking.createdByEmail ||
      ""
  ).trim();

  const createdByRaw = String(booking.createdBy || "").trim();
  const clientName =
    String((booking as any)?.clientName || (booking as any)?.customerName || "").trim();
  const roleAwareClientName =
    String(booking.channel || "").trim().toLowerCase() === "client" ||
    createdByRaw.toLowerCase() === "client"
      ? clientName
      : "";

  const displayNameCandidates = [
    args?.name,
    u?.displayName,
    storedActor.displayName,
    booking.updatedByName,
    booking.createdByName,
    isMeaningfulActorName(createdByRaw) ? createdByRaw : "",
    roleAwareClientName,
    emailLocalPart(email),
    uid,
  ];

  const displayName =
    displayNameCandidates.find((value) => isMeaningfulActorName(value)) ||
    displayNameCandidates.map((value) => String(value || "").trim()).find(Boolean) ||
    "";

  return { uid, email, displayName: String(displayName || "").trim() };
}

function buildStatusAuditPatch(
  status: BookingStatus,
  nowMs: number,
  actor?: Partial<ActorSnapshot> | null
): Record<string, any> {
  const byUid = String(actor?.uid || "").trim() || undefined;
  const byEmail = String(actor?.email || "").trim() || undefined;
  const byName = String(actor?.displayName || "").trim() || undefined;

  if (status === "pending") {
    return { pendingAt: nowMs, pendingByUid: byUid, pendingByEmail: byEmail, pendingByName: byName };
  }
  if (status === "confirmed") {
    return {
      confirmedAt: nowMs,
      confirmedByUid: byUid,
      confirmedByEmail: byEmail,
      confirmedByName: byName,
    };
  }
  if (status === "completed") {
    return {
      completedAt: nowMs,
      completedByUid: byUid,
      completedByEmail: byEmail,
      completedByName: byName,
      paidAt: nowMs,
      paidByUid: byUid,
      paidByEmail: byEmail,
      paidByName: byName,
    };
  }
  return {
    cancelledAt: nowMs,
    cancelledByUid: byUid,
    cancelledByEmail: byEmail,
    cancelledByName: byName,
  };
}

// ====== helpers to mirror Booking.tsx ======
function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeTimeHHMM(v: any, fallback: string) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23) return fallback;
  if (mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

type SlotSettings = {
  dayKey: WeekdayKey;
  enabled: boolean;
  openTime: string;
  closeTime: string;
  slotStepMin: number;
  bufferMin: number;
};

type BookingHourOverrideMode = "hours" | "closed";
type BookingHourOverride = {
  id?: string;
  fromDate: string;
  toDate: string;
  mode: BookingHourOverrideMode;
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};

function normalizeISODate(v: any): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function normalizeWeekdayList(v: any): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<WeekdayKey>(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
  const out: WeekdayKey[] = [];
  for (const d0 of v) {
    const d = String(d0 || "").trim().toLowerCase() as WeekdayKey;
    if (allowed.has(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

function readBookingHourOverrides(raw: any): BookingHourOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: any) => {
      const fromDateRaw = normalizeISODate(x?.fromDate);
      const toDateRaw = normalizeISODate(x?.toDate);
      if (!fromDateRaw || !toDateRaw) return null;
      const fromDate = fromDateRaw <= toDateRaw ? fromDateRaw : toDateRaw;
      const toDate = fromDateRaw <= toDateRaw ? toDateRaw : fromDateRaw;
      const mode: BookingHourOverrideMode = String(x?.mode || "").trim() === "closed" ? "closed" : "hours";
      return {
        id: String(x?.id || "").trim() || undefined,
        fromDate,
        toDate,
        mode,
        start: String(x?.start || "").trim() || undefined,
        end: String(x?.end || "").trim() || undefined,
        includeWeekdays: normalizeWeekdayList(x?.includeWeekdays),
        blockedWeekdays: normalizeWeekdayList(x?.blockedWeekdays),
      };
    })
    .filter(Boolean) as BookingHourOverride[];
}

function resolveSlotSettings(source: any, dateISO?: string): SlotSettings {
  const booking = (source as any)?.booking || {};
  const businessHours = booking?.businessHours || {};
  const bookingHourOverrides = readBookingHourOverrides(booking?.bookingHourOverrides);

  const dateKey = normalizeISODate(dateISO);
  const dayKey = resolveWeekdayFromISO(dateKey || String(dateISO || "").trim());
  const dayHoursBase = businessHours?.[dayKey] || {};
  const weeklyEnabled = dayHoursBase?.enabled !== false;
  const weeklyOpen = safeTimeHHMM(dayHoursBase?.start, "10:00");
  const weeklyClose = safeTimeHHMM(dayHoursBase?.end, "22:00");

  let enabled = weeklyEnabled;
  let openTime = weeklyOpen;
  let closeTime = weeklyClose;

  if (dateKey) {
    for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
      const ov = bookingHourOverrides[i];
      if (dateKey < ov.fromDate || dateKey > ov.toDate) continue;

      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;

      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        enabled = false;
      } else {
        enabled = true;
        // Active exception wins as a single source for this date (no mixing with weekly row).
        openTime = safeTimeHHMM(String(ov?.start || ""), "10:00");
        closeTime = safeTimeHHMM(String(ov?.end || ""), "22:00");
      }
      break;
    }
  }

  const rawStep = safeInt(booking?.slotStepMin, 10);
  const slotStepMin = [5, 10, 15, 30].includes(rawStep) ? rawStep : 10;

  const bufferMin = Math.max(0, safeInt(booking?.bufferMin, 0));

  return { dayKey, enabled, openTime, closeTime, slotStepMin, bufferMin };
}

/** ✅ read slot settings from cache/defaults */
function getSlotSettings(dateISO?: string): SlotSettings {
  const cached = AppSettingsService.getCached() || {};
  return resolveSlotSettings(cached, dateISO);
}

/** ✅ read slot settings with fresh remote attempt (for booking writes) */
async function getSlotSettingsFresh(dateISO?: string): Promise<SlotSettings> {
  try {
    const remote = await AppSettingsService.fetchRemote();
    return resolveSlotSettings(remote, dateISO);
  } catch {
    return getSlotSettings(dateISO);
  }
}

/**
 * ✅ lock multiple time slots based on duration
 * - Uses same slots list from generateSalonTimeSlots(open, close, step)
 * - If time not found, falls back to locking only the chosen time
 */
function getTimesToLock(
  startTime: string,
  durationMin: number,
  overrides?: { slotStepMin?: number; bufferMin?: number },
  dateISO?: string,
  preloadedSettings?: SlotSettings
) {
  const base = preloadedSettings || getSlotSettings(dateISO);

  const slotStepMin =
    [5, 10, 15, 30].includes(Number(overrides?.slotStepMin))
      ? Number(overrides?.slotStepMin)
      : base.slotStepMin;

  const bufferMin = Math.max(
    0,
    Number.isFinite(Number(overrides?.bufferMin))
      ? Number(overrides?.bufferMin)
      : base.bufferMin
  );

  const allSlots = generateSalonTimeSlots(base.openTime, base.closeTime, slotStepMin);

  const s = String(startTime || "").trim();
  const startSlot = allSlots.find((slot) => slot.value24 === s);
  if (!startSlot) return [s || startTime];
  const startMin = Number(startSlot.minutes);

  const totalMin = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));
  if (totalMin <= 0) return [s || startTime];

  const endMinRaw = startMin + totalMin;

  // ✅ round UP to nearest slot boundary (step-based)
  const endMin =
    slotStepMin > 0 ? Math.ceil(endMinRaw / slotStepMin) * slotStepMin : endMinRaw;

  const locked: string[] = [];

  // ✅ start inclusive, end exclusive
  for (const t of allSlots) {
    const m = Number(t.minutes);
    if (!Number.isFinite(m)) continue;
    if (m >= startMin && m < endMin) locked.push(t.value24);
  }

  return locked.length ? locked : [s || startTime];
}

async function buildSlotPlanForUpdate(args: {
  dateISO: string;
  time: string;
  employeeId: string;
  durationMin: number;
  slotStepMinAtBooking?: number;
  bufferMinAtBooking?: number;
}) {
  const dateISO = normalizeISODate(args.dateISO);
  const employeeId = String(args.employeeId || "").trim();
  if (!employeeId) throw employeeRequiredError();
  if (!dateISO) throw bookingTimeOutOfHoursError();

  const requestedStartTime = String(args.time || "").trim();
  const durationMin = Math.max(0, Number(args.durationMin || 0)) || 60;

  const daySlotSettings = await getSlotSettingsFresh(dateISO);
  if (!daySlotSettings.enabled) throw bookingDayClosedError();

  const requestedStep =
    [5, 10, 15, 30].includes(Number(args.slotStepMinAtBooking))
      ? Number(args.slotStepMinAtBooking)
      : daySlotSettings.slotStepMin;

  const allSlotsForDay = generateSalonTimeSlots(
    daySlotSettings.openTime,
    daySlotSettings.closeTime,
    requestedStep
  );
  const hasRequestedStart = allSlotsForDay.some(
    (slot) => String(slot.value24 || "").trim() === requestedStartTime
  );
  if (!hasRequestedStart) throw bookingTimeOutOfHoursError();

  const requestedBufferMin = Math.max(
    0,
    Number.isFinite(Number(args.bufferMinAtBooking))
      ? Number(args.bufferMinAtBooking)
      : daySlotSettings.bufferMin
  );
  const allowedStartsByDuration = filterSlotsByServiceEnd(
    allSlotsForDay,
    daySlotSettings.closeTime,
    durationMin,
    requestedBufferMin,
    ALLOW_OVERTIME_MIN
  );
  const isAllowedByDuration = allowedStartsByDuration.some(
    (slot) => String(slot.value24 || "").trim() === requestedStartTime
  );
  if (!isAllowedByDuration) throw bookingTimeOutOfHoursError();

  const timesToLock = getTimesToLock(
    requestedStartTime,
    durationMin,
    {
      slotStepMin: args.slotStepMinAtBooking,
      bufferMin: args.bufferMinAtBooking,
    },
    dateISO,
    daySlotSettings
  );

  const slotRefs = timesToLock.map((t) =>
    doc(db, ...SLOTS_COL, buildSlotId(dateISO, t, employeeId))
  );

  const startSlotId = buildSlotId(dateISO, requestedStartTime, employeeId);

  return {
    dateISO,
    requestedStartTime,
    durationMin,
    timesToLock,
    slotRefs,
    startSlotId,
    slotStepMin: requestedStep,
    bufferMin: requestedBufferMin,
  };
}

/* =========================
   ✅ Booking Logs (Audit) - Best Effort
========================= */

function bookingEventsCol(bookingId: string) {
  return collection(db, ...LOGS_COL, bookingId, "events");
}

type BookingLogType = "created" | "status_changed" | "details_updated" | "staff_acknowledged";

function readStoredActorSnapshot(): {
  uid: string;
  email: string;
  displayName: string;
} {
  try {
    const authUserRaw = localStorage.getItem("auth_user");
    const authUser = authUserRaw ? JSON.parse(authUserRaw) as any : null;
    const profileRaw = localStorage.getItem("user_profile_v1");
    const profile = profileRaw ? JSON.parse(profileRaw) as any : null;
    const fallbackName = String(localStorage.getItem("userName") || "").trim();
    return {
      uid: String(authUser?.uid || profile?.uid || "").trim(),
      email: String(authUser?.email || profile?.email || "").trim(),
      displayName: String(
        authUser?.displayName ||
          profile?.displayName ||
          profile?.name ||
          fallbackName ||
          ""
      ).trim(),
    };
  } catch {
    return { uid: "", email: "", displayName: "" };
  }
}

function resolveBookingLogDisplay(booking: Partial<BookingDoc> | null | undefined, bookingId: string) {
  const clientName = String(
    (booking as any)?.clientName ||
      (booking as any)?.customerName ||
      (booking as any)?.name ||
      ""
  )
    .trim() || undefined;
  const bookingPublicId = String((booking as any)?.publicId || "").trim() || undefined;
  const bookingShortId = bookingId ? bookingId.slice(0, 6) : undefined;
  if (!clientName && !bookingPublicId && !bookingId) return undefined;
  return {
    clientName,
    bookingPublicId,
    bookingShortId,
    bookingId,
  };
}

async function writeBookingLog(args: {
  bookingId: string;
  type: BookingLogType;
  note?: string;
  patch?: any;
  actor?: Partial<ActorSnapshot> | null;
  booking?: Partial<BookingDoc> | null;
  source?: LogSource;
}) {
  const actor = resolveActorSnapshot({
    booking: args.booking,
    uid: String(args.actor?.uid || "").trim() || undefined,
    email: String(args.actor?.email || "").trim() || undefined,
    name: String(args.actor?.displayName || "").trim() || undefined,
  });
  const eventAtMs = Date.now();
  const source = args.source || resolveBookingLogSource(args.booking?.channel);
  const display = resolveBookingLogDisplay(args.booking, args.bookingId);

  const payload = stripUndefined({
    type: args.type,
    bookingId: args.bookingId,
    byUid: actor.uid || null,
    byEmail: actor.email || null,
    byName: actor.displayName || null,
    note: args.note || "",
    patch: args.patch || null,
    eventAtMs,
    at: serverTimestamp(),
  }) as any;

  // ✅ map booking log types -> audit actions
  let action: string = "booking_updated";
  if (args.type === "created") action = "booking_created";
  if (args.type === "details_updated") action = "booking_updated";
  if (args.type === "staff_acknowledged") action = "booking_viewed";
  if (args.type === "status_changed") {
    const status = String(args?.patch?.status || "").toLowerCase().trim();
    if (status === "confirmed") action = "booking_confirmed";
    else if (status === "completed") action = "booking_completed";
    else if (status === "cancelled" || status === "canceled") action = "booking_cancelled";
    else action = "booking_status_changed";
  }

  // 1) event log under booking (best effort)
  try {
    const evRef = doc(bookingEventsCol(args.bookingId));
    await setDoc(evRef, payload);
  } catch {
    // ignore
  }

  // 2) global audit log (best effort, مستقل عن event log)
  try {
    await writeAuditLog({
      salonId: SALON_ID,
      action,
      entityType: "booking",
      entityId: args.bookingId,
      description: args.note || "تم تحديث الحجز",
      after: args.patch || null,
      source,
      actorUid: actor.uid || undefined,
      actorEmail: actor.email || undefined,
      actorName: actor.displayName || undefined,
      meta: {
        bookingLogType: args.type,
        eventAtMs,
        display,
        patch: args.patch || null,
      },
    });
  } catch {
    // ignore
  }
}


/* =========================
   ✅ Slots Unlock (Best Effort) — Guaranteed
   - Deletes booking_slots by bookingId (works even لو employeeId/Key اختلف)
========================= */
async function unlockSlotsByBookingId(bookingId: string) {
  try {
    const q = query(collection(db, ...SLOTS_COL), where("bookingId", "==", bookingId));
    const snap = await getDocs(q);
    if (snap.empty) return;
    // Build aggregated availability patches BEFORE deleting legacy slot docs.
    const timesByAvailPath = new Map<
      string,
      { ref: any; dateISO: string; employeeId: string; employeeKey: string; times: Set<string> }
    >();
    snap.docs.forEach((d: any) => {
      if (d?.ref?.path) {
        FirestoreReadStats.bump(d.ref.path, "firestoreBookings.unlockSlotsByBookingId", "getDocs");
      }
      const sd: any = d.data() || {};
      const dateISO = String(sd.date || "").trim();
      const time = String(sd.time || "").trim();
      const employeeId = String(sd.employeeId ?? "").trim();
      const employeeKey = String(sd.employeeKey ?? "").trim();
      if (!dateISO || !time || !employeeId) return;

      const aRef = doc(db, "salons", SALON_ID, "availability_days", dateISO, "employees", employeeId);
      const key = aRef.path;
      const entry =
        timesByAvailPath.get(key) || {
          ref: aRef,
          dateISO,
          employeeId,
          employeeKey: employeeKey || employeeId,
          times: new Set<string>(),
        };
      entry.times.add(time);
      if (!entry.employeeKey) entry.employeeKey = employeeKey || employeeId;
      timesByAvailPath.set(key, entry);
    });

    // 1) Always unlock legacy slot docs first (source of truth today).
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));

    // 2) Best-effort: keep aggregated index in sync (ignore errors).
    try {
      await Promise.all(
        Array.from(timesByAvailPath.values()).map(async (entry) => {
          const patch: any = {
            date: entry.dateISO,
            employeeId: entry.employeeId,
            employeeKey: entry.employeeKey,
            updatedAt: serverTimestamp(),
          };
          entry.times.forEach((t) => {
            patch[`bookedSlots.${t}`] = deleteField();
          });
          await updateDoc(entry.ref, patch);
        })
      );
    } catch {
      // ignore: best-effort only
    }
  } catch {
    // best-effort: لا نكسر تعديل الحالة
  }
}

async function lockSlotsFromBooking(bookingId: string) {
  // ✅ نقرأ الحجز ونرجع نقفل كل السلوّتات بناءً على وقت/مدة الحجز
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  FirestoreReadStats.bump(bookingRef.path, "firestoreBookings.lockSlotsFromBooking", "getDoc");
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error("BOOKING_NOT_FOUND");

  const b = normalizeBooking(snap.data());

  // لازم يكون فيه موظفة
  const employeeIdTrimmed = String(b.employeeId ?? "").trim();
  if (!employeeIdTrimmed) throw employeeRequiredError();

  // ✅ lock key لازم يطابق Booking.tsx (employeeId = staff_public doc id)
  const employeeKeyForLock = employeeIdTrimmed;

  const durationMin = Math.max(0, Number(b.durationMin || 0)) || 60;

  const timesToLock = getTimesToLock(
    String(b.time || "").trim(),
    durationMin,
    {
      slotStepMin: (b as any).slotStepMinAtBooking,
      bufferMin: (b as any).bufferMinAtBooking,
    },
    String(b.date || "").trim()
  );

  const employeeKey =
    String(b.employeeKey || "").trim() ||
    String(b.employeeUid || "").trim() ||
    employeeIdTrimmed ||
    safeKey(String(b.employeeName || "unknown_employee"));

  // ✅ نكتب (setDoc) على نفس docIds المعتادة
  await Promise.all(
    timesToLock.map((t) => {
      const slotId = buildSlotId(b.date, t, employeeKeyForLock);
      const slotRef = doc(db, ...SLOTS_COL, slotId);

      return setDoc(
        slotRef,
        stripUndefined({
          bookingId,

          employeeId: b.employeeId ?? null,
          employeeUid: b.employeeUid ?? null,
          employeeName: b.employeeName,
          employeeKey,

          date: b.date,
          time: t,

          startTime: b.time,
          durationMin,

          userId: b.userId ?? null,
          clientPhone: b.clientPhone,

          createdAt: serverTimestamp(),
        }) as any,
        { merge: true } as any
      );
    })
  );

  // ✅ Best-effort: update aggregated availability index (write-through during migration).
  try {
    const dateISO = String(b.date || "").trim();
    if (dateISO) {
      const availabilityRef = doc(
        db,
        "salons",
        SALON_ID,
        "availability_days",
        dateISO,
        "employees",
        employeeIdTrimmed
      );

      const patch: any = {
        date: dateISO,
        employeeId: employeeIdTrimmed,
        employeeKey,
        updatedAt: serverTimestamp(),
      };
      const bookedSlots: Record<string, true> = {};
      timesToLock.forEach((t) => {
        const k = String(t || "").trim();
        if (!k) return;
        patch[`bookedSlots.${k}`] = true;
        bookedSlots[k] = true;
      });

      try {
        await updateDoc(availabilityRef, patch);
      } catch (e: any) {
        // Create if missing (keep complete=false until explicitly backfilled).
        if (String(e?.code || "").trim() === "not-found") {
          await setDoc(availabilityRef, {
            date: dateISO,
            employeeId: employeeIdTrimmed,
            employeeKey,
            bookedSlots,
            complete: false,
            updatedAt: serverTimestamp(),
          } as any);
        }
      }
    }
  } catch {
    // ignore: best-effort only
  }
}


/* =========================
   CREATE
========================= */

export async function createBooking(data: BookingDoc): Promise<{ id: string; publicId: string }> {
  // ✅ lock key = staff_public doc id (لأن Booking.tsx يفحص السلوّت بهذا المفتاح)
  const employeeIdTrimmed = String(data.employeeId ?? "").trim();
  const employeeNameTrimmed = String(data.employeeName || "").trim();

  // ✅ enforce employeeId 100% (contract)
  if (!employeeIdTrimmed) {
    throw employeeRequiredError();
  }

  await assertEmployeeCanAcceptBooking({
    employeeId: employeeIdTrimmed,
    dateISO: String(data.date || "").trim(),
    channel: data.channel,
  });

  const employeeKeyForLock = employeeIdTrimmed;

  // ✅ employeeKey للـ staff portal = linkedUid (إن وجد) وإلا staff_public id وإلا safeKey(name)
  const employeeUidTrimmed = String(data.employeeUid ?? "").trim();
  const employeeKey =
    employeeUidTrimmed || employeeIdTrimmed || safeKey(employeeNameTrimmed || "unknown_employee");

  // ✅ duration (default)
  const durationMin = Math.max(0, Number(data.durationMin || 0)) || 60;
  const nowMs = Date.now();
  const actorSnapshot = resolveActorSnapshot({
    booking: data,
    uid: String(data.userId || "").trim() || undefined,
  });
  const requestedStatus = ((data.status as BookingStatus) || "pending") as BookingStatus;
  const forceClientPendingUnpaid = shouldForceClientPendingUnpaidOnCreate(data);
  const statusNow: BookingStatus = forceClientPendingUnpaid
    ? "pending"
    : shouldAutoConfirmClientPendingOnCreate(data, requestedStatus)
      ? "confirmed"
      : requestedStatus;
  const statusAuditPatch = buildStatusAuditPatch(statusNow, nowMs, actorSnapshot);
  const resolvedPaymentMethod = resolvePaymentMethodForStatus(
    statusNow,
    (data as any).paymentMethod,
    data.note
  );

  // ✅ times to lock (start + next slots)
  const dateISO = String(data.date || "").trim();
  const daySlotSettings = await getSlotSettingsFresh(dateISO);
  if (!daySlotSettings.enabled) throw bookingDayClosedError();

  const requestedStartTime = String(data.time || "").trim();
  const requestedStep =
    [5, 10, 15, 30].includes(Number((data as any).slotStepMinAtBooking))
      ? Number((data as any).slotStepMinAtBooking)
      : daySlotSettings.slotStepMin;

  const allSlotsForDay = generateSalonTimeSlots(
    daySlotSettings.openTime,
    daySlotSettings.closeTime,
    requestedStep
  );
  const hasRequestedStart = allSlotsForDay.some(
    (slot) => String(slot.value24 || "").trim() === requestedStartTime
  );
  if (!hasRequestedStart) throw bookingTimeOutOfHoursError();

  const requestedBufferMin = Math.max(
    0,
    Number.isFinite(Number((data as any).bufferMinAtBooking))
      ? Number((data as any).bufferMinAtBooking)
      : daySlotSettings.bufferMin
  );
  const allowedStartsByDuration = filterSlotsByServiceEnd(
    allSlotsForDay,
    daySlotSettings.closeTime,
    durationMin,
    requestedBufferMin,
    ALLOW_OVERTIME_MIN
  );
  const isAllowedByDuration = allowedStartsByDuration.some(
    (slot) => String(slot.value24 || "").trim() === requestedStartTime
  );
  if (!isAllowedByDuration) throw bookingTimeOutOfHoursError();

  const timesToLock = getTimesToLock(
    requestedStartTime,
    durationMin,
    {
      slotStepMin: (data as any).slotStepMinAtBooking,
      bufferMin: (data as any).bufferMinAtBooking,
    },
    dateISO,
    daySlotSettings
  );

  // ✅ booking ref
  const bookingRef = doc(collection(db, ...BOOKINGS_COL));

  // ✅ build slot refs (LOCK DOCS)
  const slotRefs = timesToLock.map((t) =>
    doc(db, ...SLOTS_COL, buildSlotId(data.date, t, employeeKeyForLock))
  );

  // ✅ store start-slotId inside booking doc for tracking/debugging
  const startSlotId = buildSlotId(data.date, String(data.time || "").trim(), employeeKeyForLock);

  // ✅ snapshot: لو ما انرسل، نبني واحد minimal من الموجود
  const snapFromInput = data.serviceSnapshot;
  const fallbackName =
    String(snapFromInput?.serviceNameAtBooking || "").trim() || String(data.serviceName || "").trim();

  const fallbackPrice = Number(snapFromInput?.priceAtBooking ?? data.finalPrice ?? data.total ?? 0);
  const fallbackDur = Number(snapFromInput?.durationAtBooking ?? durationMin);
  const totalAmount = Number.isFinite(fallbackPrice) ? Math.max(0, fallbackPrice) : 0;
  const paymentState = forceClientPendingUnpaid
    ? {
        paymentType: "partial" as BookingPaymentType,
        paidAmount: 0,
        remainingAmount: round2(totalAmount),
        totalAmount: round2(totalAmount),
      }
    : resolveBookingPaymentState({
        ...data,
        status: statusNow,
        total: totalAmount,
        finalPrice: totalAmount,
      });

  const serviceSnapshot: ServiceSnapshot = stripUndefined({
    serviceNameAtBooking: fallbackName || "-",
    priceAtBooking: Number.isFinite(fallbackPrice) ? fallbackPrice : 0,
    durationAtBooking: Number.isFinite(fallbackDur) ? fallbackDur : durationMin,
    sectionIdAtBooking: snapFromInput?.sectionIdAtBooking,
    sectionTitleAtBooking: snapFromInput?.sectionTitleAtBooking,
    categoryIdAtBooking: snapFromInput?.categoryIdAtBooking,
    categoryNameAtBooking: snapFromInput?.categoryNameAtBooking,
  }) as ServiceSnapshot;

  const payloadBase = stripUndefined({
    ...data,
    createdByUid: actorSnapshot.uid || null,
    createdByEmail: actorSnapshot.email || null,
    createdByName: actorSnapshot.displayName || null,
    updatedByUid: actorSnapshot.uid || null,
    updatedByEmail: actorSnapshot.email || null,
    updatedByName: actorSnapshot.displayName || null,

    // ✅ normalize nullables
    employeeId: (data.employeeId ?? null) as any,
    employeeUid: (data.employeeUid ?? null) as any,

    durationMin,
    employeeKey,
    slotId: startSlotId,

    // ✅ NEW
    serviceId: data.serviceId ?? undefined,
    serviceSnapshot,
    packageId: data.packageId ? String(data.packageId).trim() : undefined,
    packageSnapshot: data.packageSnapshot ?? undefined,

    slotStepMinAtBooking: (data as any).slotStepMinAtBooking ?? daySlotSettings.slotStepMin,
    bufferMinAtBooking: (data as any).bufferMinAtBooking ?? daySlotSettings.bufferMin,
    paymentMethod: resolvedPaymentMethod,
    paymentBreakdown: normalizePaymentBreakdown((data as any).paymentBreakdown),
    paymentType: paymentState.paymentType,
    paidAmount: paymentState.paidAmount,
    remainingAmount: paymentState.remainingAmount,
    status: statusNow,
    ...statusAuditPatch,
    createdAtMs: nowMs,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const shouldCreateIncomeOnCreate =
    (statusNow === "confirmed" || statusNow === "completed") && paymentState.paidAmount > 0;
  const incomeAmount = paymentState.paidAmount;
  const incomeMethod = resolvedPaymentMethod || "transfer";
  const incomeStatus = statusNow === "completed" ? "completed" : "confirmed";
  const incomeDateOnCreate = normalizeISODate(data.date) || localISODate();

  // ✅✅✅ FIX: reads before writes inside transaction
  const { bookingId, publicId } = await runTransaction(db, async (tx) => {
    // ---------- READS FIRST ----------
    const counterRef = doc(db, ...COUNTERS_COL, BOOKINGS_COUNTER_DOC);
    FirestoreReadStats.bump(counterRef.path, "firestoreBookings.createBooking.runTransaction", "tx.get");
    const counterSnap = await tx.get(counterRef);

    const availabilityRef = doc(
      db,
      "salons",
      SALON_ID,
      "availability_days",
      dateISO,
      "employees",
      employeeIdTrimmed
    );
    FirestoreReadStats.bump(
      availabilityRef.path,
      "firestoreBookings.createBooking.runTransaction",
      "tx.get"
    );
    const availabilitySnap = await tx.get(availabilityRef);

    slotRefs.forEach((r) => {
      FirestoreReadStats.bump(r.path, "firestoreBookings.createBooking.runTransaction", "tx.get");
    });
    const slotSnaps = await Promise.all(slotRefs.map((r) => tx.get(r)));

    let existingBookingId: string | null = null;

    for (const snap of slotSnaps) {
      if (!snap.exists()) continue;

      const sd: any = snap.data() || {};
      const bId = String(sd.bookingId || "").trim();
      if (!bId) throw slotTakenError();

      if (!existingBookingId) existingBookingId = bId;
      if (existingBookingId && bId !== existingBookingId) throw slotTakenError();
    }

    if (existingBookingId) {
      const existingBookingRef = doc(db, ...BOOKINGS_COL, existingBookingId);
      const existingBookingSnap = await tx.get(existingBookingRef);

      if (existingBookingSnap.exists()) {
        const existingBooking = normalizeBooking(existingBookingSnap.data());

        const sameUser =
          (data.userId && existingBooking.userId && data.userId === existingBooking.userId) ||
          (!data.userId && String(existingBooking.clientPhone || "") === String(data.clientPhone || ""));

        const sameDate = String(existingBooking.date || "") === String(data.date || "");
        const sameStart = String(existingBooking.time || "") === String(data.time || "");

        // ✅ prefer employeeKey comparison
        const sameEmp =
          String(existingBooking.employeeKey || "") === String(employeeKey) ||
          safeKey(String(existingBooking.employeeId ?? "").trim() || existingBooking.employeeName.trim()) ===
          safeKey(employeeKeyForLock);

        if (sameUser && sameDate && sameStart && sameEmp) {
          const existingPublic = String(existingBooking.publicId || "").trim();
          return { bookingId: existingBookingId, publicId: existingPublic || "MK-00000" };
        }
      }

      throw slotTakenError();
    }

    // ✅ Aggregated availability sanity check (diagnostic only during migration).
    // booking_slots is still the source of truth for final conflict prevention.
    if (availabilitySnap.exists()) {
      const a: any = availabilitySnap.data() || {};
      if (a.complete === true) {
        const bookedSlots = normalizeBookedSlotsMap(a.bookedSlots);
        const anyBooked = timesToLock.some((t) => bookedSlots[String(t || "").trim()] === true);
        if (anyBooked && (import.meta as any)?.env?.DEV) {
          // If this fires, availability_days is stale; the write-through below will heal it.
          // Don't block booking creation based on the derived index.
          // eslint-disable-next-line no-console
          console.warn("[createBooking] availability_days mismatch (ignored):", availabilityRef.path);
        }
      }
    }

    // ---------- WRITES AFTER READS ----------
    let next = 10000;
    if (counterSnap.exists()) {
      const d: any = counterSnap.data() || {};
      const cur = typeof d.next === "number" ? d.next : 10000;
      next = cur + 1;
      tx.update(counterRef, { next });
    } else {
      next = 10001;
      tx.set(counterRef, { next }, { merge: true } as any);
    }

    const publicId = `MK-${String(next).padStart(5, "0")}`;

    const payload = stripUndefined({
      ...payloadBase,
      publicId,
    });

    // ✅ lock slots
    for (let i = 0; i < slotRefs.length; i++) {
      const slotRef = slotRefs[i];
      const t = timesToLock[i];

      tx.set(slotRef, {
        bookingId: bookingRef.id,

        // ✅ must match Booking.tsx queries (employeeId + date)
        employeeId: data.employeeId ?? null,

        employeeUid: data.employeeUid ?? null,
        employeeName: data.employeeName,

        employeeKey, // for staff portal

        date: data.date,
        time: t,

        startTime: data.time,
        durationMin,

        userId: data.userId ?? null,
        clientPhone: data.clientPhone,
        createdAt: serverTimestamp(),
      });
    }

    // ✅ Update aggregated availability index (write-through during migration).
    if (availabilitySnap.exists()) {
      const patch: any = {
        date: dateISO,
        employeeId: employeeIdTrimmed,
        employeeKey,
        updatedAt: serverTimestamp(),
      };
      timesToLock.forEach((t) => {
        const k = String(t || "").trim();
        if (k) patch[`bookedSlots.${k}`] = true;
      });
      tx.update(availabilityRef, patch);
    } else {
      const bookedSlots: Record<string, true> = {};
      timesToLock.forEach((t) => {
        const k = String(t || "").trim();
        if (k) bookedSlots[k] = true;
      });
      tx.set(availabilityRef, {
        date: dateISO,
        employeeId: employeeIdTrimmed,
        employeeKey,
        bookedSlots,
        complete: false,
        updatedAt: serverTimestamp(),
      } as any);
    }

    // ✅ write booking
    tx.set(bookingRef, payload);

    // ✅ atomic income write with booking creation
    if (shouldCreateIncomeOnCreate) {
      const incomeRef = doc(db, ...INCOME_COL, bookingRef.id);
      tx.set(
        incomeRef,
        stripUndefined({
          source: "booking",
          bookingId: bookingRef.id,
          amount: incomeAmount,
          status: incomeStatus,
          method: incomeMethod,
          paymentBreakdown: normalizePaymentBreakdown((data as any).paymentBreakdown),
          date: incomeDateOnCreate,
          clientName: data.clientName,
          clientNameLower: String(data.clientName || "").toLowerCase(),
          clientPhone: data.clientPhone,
          serviceName: serviceSnapshot?.serviceNameAtBooking || data.serviceName,
          employeeName: data.employeeName,
          note: paymentBreakdownIncomeNote({ ...data, paymentMethod: incomeMethod }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as any,
        { merge: true } as any
      );
    }

    return { bookingId: bookingRef.id, publicId };
  });

  // ✅ track doc (best effort merge) — لا نخلي track يكسر الحجز
  try {
    await setDoc(
      doc(db, ...TRACKS_COL, bookingId),
      stripUndefined({
        bookingId,
        publicId,

        // ✅ مهم مع rules حقك
        userId: data.userId ?? null,
        createdByUid: actorSnapshot.uid || null,
        createdByEmail: actorSnapshot.email || null,
        createdByName: actorSnapshot.displayName || null,
        updatedByUid: actorSnapshot.uid || null,
        updatedByEmail: actorSnapshot.email || null,
        updatedByName: actorSnapshot.displayName || null,

        // legacy + new
        serviceName: data.serviceName,
        serviceId: data.serviceId ?? undefined,
        serviceSnapshot,
        packageId: data.packageId ? String(data.packageId).trim() : undefined,
        packageSnapshot: data.packageSnapshot ?? undefined,
        fromSessionPackage:
          data.fromSessionPackage === undefined ? undefined : !!data.fromSessionPackage,
        sessionPackageId: data.sessionPackageId ? String(data.sessionPackageId).trim() : undefined,
        sessionPackageName: data.sessionPackageName
          ? String(data.sessionPackageName).trim()
          : undefined,
        allowedServiceIds:
          data.allowedServiceIds === undefined
            ? undefined
            : normalizeStringArray(data.allowedServiceIds),
        consumeOneSession:
          data.consumeOneSession === undefined ? undefined : !!data.consumeOneSession,

        employeeId: data.employeeId ?? null,
        employeeUid: data.employeeUid ?? null,
        employeeName: data.employeeName,
        employeeKey,

        date: data.date,
        time: data.time,
        durationMin,
        paymentMethod: resolvedPaymentMethod,
        paymentBreakdown: normalizePaymentBreakdown((data as any).paymentBreakdown),
        paymentType: paymentState.paymentType,
        paidAmount: paymentState.paidAmount,
        remainingAmount: paymentState.remainingAmount,

        // ✅ NEW: خزن إعدادات السلوّت وقت الحجز
        slotStepMinAtBooking: (payloadBase as any).slotStepMinAtBooking,
        bufferMinAtBooking: (payloadBase as any).bufferMinAtBooking,

        status: statusNow,
        slotId: startSlotId,
        ...statusAuditPatch,
        createdAtMs: nowMs,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );
  } catch (e) {
    console.warn("[createBooking] track write failed (ignored):", e);
  }

  // ✅ booking log: created (best effort)
  await writeBookingLog({
    bookingId,
    type: "created",
    note: "تم إنشاء الحجز",
    actor: actorSnapshot,
    booking: payloadBase as Partial<BookingDoc>,
    source: resolveBookingLogSource(data.channel),
    patch: {
      serviceId: data.serviceId ?? null,
      packageId: data.packageId ?? null,
      employeeId: data.employeeId ?? null,
      employeeUid: data.employeeUid ?? null,
      date: data.date,
      time: data.time,
      total: Number(data.finalPrice ?? data.total ?? 0),
      paymentType: paymentState.paymentType,
      paidAmount: paymentState.paidAmount,
      remainingAmount: paymentState.remainingAmount,
      byUid: actorSnapshot.uid || null,
      byEmail: actorSnapshot.email || null,
      byName: actorSnapshot.displayName || null,
    },
  });

  return { id: bookingId, publicId };
}

/* =========================
  CREATE GROUP (Parent + Sub in same collection)
========================= */
export async function createBookingGroup(data: BookingGroupInput): Promise<{ parentId: string; parentPublicId: string; itemIds: string[] }> {
  const parent = data?.parent as BookingDoc;
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!parent || !items.length) {
    throw new Error("GROUP_BOOKING_INVALID");
  }

  const nowMs = Date.now();
  const actorSnapshot = resolveActorSnapshot({
    booking: parent,
    uid: String(parent.userId || "").trim() || undefined,
  });
  const requestedStatus: BookingStatus = (parent.status as BookingStatus) || "pending";
  const forceClientPendingUnpaid = shouldForceClientPendingUnpaidOnCreate(parent);
  const status: BookingStatus = shouldAutoConfirmClientPendingOnCreate(parent, requestedStatus)
    ? "confirmed"
    : requestedStatus;
  const statusAuditPatch = buildStatusAuditPatch(status, nowMs, actorSnapshot);
  const parentTotalAmount = readTotalAmount(parent);
  const parentPaymentState = forceClientPendingUnpaid
    ? {
        paymentType: "partial" as BookingPaymentType,
        paidAmount: 0,
        remainingAmount: round2(parentTotalAmount),
        totalAmount: round2(parentTotalAmount),
      }
    : resolveBookingPaymentState({
        ...parent,
        status,
        total: parentTotalAmount,
        finalPrice: parentTotalAmount,
      });
  const parentResolvedPaymentMethod = resolvePaymentMethodForStatus(
    status,
    (parent as any).paymentMethod,
    parent.note
  );

  const parentRef = doc(collection(db, ...BOOKINGS_COL));
  const itemRefs = items.map(() => doc(collection(db, ...BOOKINGS_COL)));

  const settingsByDate = new Map<string, SlotSettings>();
  const getFreshSettingsForDate = async (dateISO: string) => {
    const k = String(dateISO || "").trim();
    if (settingsByDate.has(k)) return settingsByDate.get(k)!;
    const settings = await getSlotSettingsFresh(k);
    settingsByDate.set(k, settings);
    return settings;
  };

  const prepared: Array<any> = [];
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const employeeIdTrimmed = String(it.employeeId ?? "").trim();
    if (!employeeIdTrimmed) throw employeeRequiredError();
    await assertEmployeeCanAcceptBooking({
      employeeId: employeeIdTrimmed,
      dateISO: String(it.date || "").trim(),
      channel: it.channel ?? parent.channel,
    });
    const employeeUidTrimmed = String(it.employeeUid ?? "").trim();
    const employeeNameTrimmed = String(it.employeeName || "").trim();
    const employeeKeyForLock = employeeIdTrimmed;
    const employeeKey =
      employeeUidTrimmed || employeeIdTrimmed || safeKey(employeeNameTrimmed || "unknown_employee");

    const durationMin = Math.max(0, Number(it.durationMin || 0)) || 60;
    const dateISO = String(it.date || "").trim();
    const requestedStartTime = String(it.time || "").trim();
    const daySlotSettings = await getFreshSettingsForDate(dateISO);
    if (!daySlotSettings.enabled) throw bookingDayClosedError();

    const requestedStep =
      [5, 10, 15, 30].includes(Number((it as any).slotStepMinAtBooking))
        ? Number((it as any).slotStepMinAtBooking)
        : daySlotSettings.slotStepMin;

    const allSlotsForDay = generateSalonTimeSlots(
      daySlotSettings.openTime,
      daySlotSettings.closeTime,
      requestedStep
    );
    const hasRequestedStart = allSlotsForDay.some(
      (slot) => String(slot.value24 || "").trim() === requestedStartTime
    );
    if (!hasRequestedStart) throw bookingTimeOutOfHoursError();

    const requestedBufferMin = Math.max(
      0,
      Number.isFinite(Number((it as any).bufferMinAtBooking))
        ? Number((it as any).bufferMinAtBooking)
        : daySlotSettings.bufferMin
    );
    const allowedStartsByDuration = filterSlotsByServiceEnd(
      allSlotsForDay,
      daySlotSettings.closeTime,
      durationMin,
      requestedBufferMin,
      ALLOW_OVERTIME_MIN
    );
    const isAllowedByDuration = allowedStartsByDuration.some(
      (slot) => String(slot.value24 || "").trim() === requestedStartTime
    );
    if (!isAllowedByDuration) throw bookingTimeOutOfHoursError();

    const timesToLock = getTimesToLock(
      requestedStartTime,
      durationMin,
      {
        slotStepMin: (it as any).slotStepMinAtBooking,
        bufferMin: (it as any).bufferMinAtBooking,
      },
      dateISO,
      daySlotSettings
    );

    const slotRefs = timesToLock.map((t) =>
      doc(db, ...SLOTS_COL, buildSlotId(dateISO, t, employeeKeyForLock))
    );
    const startSlotId = buildSlotId(dateISO, requestedStartTime, employeeKeyForLock);

    const fallbackName =
      String(it?.serviceSnapshot?.serviceNameAtBooking || "").trim() || String(it.serviceName || "").trim();
    const fallbackPrice = Number(it?.serviceSnapshot?.priceAtBooking ?? it.finalPrice ?? it.total ?? 0);
    const fallbackDur = Number(it?.serviceSnapshot?.durationAtBooking ?? durationMin);
    const serviceSnapshot: ServiceSnapshot = stripUndefined({
      serviceNameAtBooking: fallbackName || "-",
      priceAtBooking: Number.isFinite(fallbackPrice) ? fallbackPrice : 0,
      durationAtBooking: Number.isFinite(fallbackDur) ? fallbackDur : durationMin,
      sectionIdAtBooking: it?.serviceSnapshot?.sectionIdAtBooking,
      sectionTitleAtBooking: it?.serviceSnapshot?.sectionTitleAtBooking,
      categoryIdAtBooking: it?.serviceSnapshot?.categoryIdAtBooking,
      categoryNameAtBooking: it?.serviceSnapshot?.categoryNameAtBooking,
    }) as ServiceSnapshot;
    const totalAmount = Number.isFinite(fallbackPrice) ? Math.max(0, fallbackPrice) : 0;
    const paymentState = forceClientPendingUnpaid
      ? {
          paymentType: "partial" as BookingPaymentType,
          paidAmount: 0,
          remainingAmount: round2(totalAmount),
          totalAmount: round2(totalAmount),
        }
      : resolveBookingPaymentState({
          ...it,
          status,
          total: totalAmount,
          finalPrice: totalAmount,
        });
    const resolvedPaymentMethod = resolvePaymentMethodForStatus(
      status,
      (it as any).paymentMethod,
      it.note
    );

    const payloadBase = stripUndefined({
      ...it,
      createdByUid: actorSnapshot.uid || null,
      createdByEmail: actorSnapshot.email || null,
      createdByName: actorSnapshot.displayName || null,
      updatedByUid: actorSnapshot.uid || null,
      updatedByEmail: actorSnapshot.email || null,
      updatedByName: actorSnapshot.displayName || null,
      employeeId: it.employeeId ?? null,
      employeeUid: it.employeeUid ?? null,
      durationMin,
      employeeKey,
      slotId: startSlotId,
      serviceSnapshot,
      packageId: it.packageId ? String(it.packageId).trim() : undefined,
      packageSnapshot: it.packageSnapshot ?? undefined,
      slotStepMinAtBooking: (it as any).slotStepMinAtBooking ?? daySlotSettings.slotStepMin,
      bufferMinAtBooking: (it as any).bufferMinAtBooking ?? daySlotSettings.bufferMin,
      paymentMethod: resolvedPaymentMethod,
      paymentBreakdown: normalizePaymentBreakdown((it as any).paymentBreakdown),
      paymentType: paymentState.paymentType,
      paidAmount: paymentState.paidAmount,
      remainingAmount: paymentState.remainingAmount,
      status,
      ...statusAuditPatch,
      createdAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    prepared.push({
      idx,
      it,
      ref: itemRefs[idx],
      employeeKeyForLock,
      employeeKey,
      timesToLock,
      slotRefs,
      startSlotId,
      durationMin,
      payloadBase,
    });
  }

  const { parentPublicId } = await runTransaction(db, async (tx) => {
    const counterRef = doc(db, ...COUNTERS_COL, BOOKINGS_COUNTER_DOC);
    FirestoreReadStats.bump(counterRef.path, "firestoreBookings.createGroupBooking.runTransaction", "tx.get");
    const counterSnap = await tx.get(counterRef);

    // ✅ Aggregated availability docs per employee/day (read once per unique doc).
    const availabilityRefByPath = new Map<string, any>();
    prepared.forEach((p) => {
      const empId = String(p?.it?.employeeId ?? "").trim();
      const dISO = String(p?.it?.date ?? "").trim();
      if (!empId || !dISO) return;
      const ref = doc(db, "salons", SALON_ID, "availability_days", dISO, "employees", empId);
      availabilityRefByPath.set(ref.path, ref);
    });
    const availabilityRefs = Array.from(availabilityRefByPath.values());
    availabilityRefs.forEach((r: any) => {
      FirestoreReadStats.bump(r.path, "firestoreBookings.createGroupBooking.runTransaction", "tx.get");
    });
    const availabilitySnaps = await Promise.all(availabilityRefs.map((r: any) => tx.get(r)));
    const availabilitySnapByPath = new Map<string, any>();
    for (let i = 0; i < availabilityRefs.length; i++) {
      availabilitySnapByPath.set(String(availabilityRefs[i].path), availabilitySnaps[i]);
    }

    prepared.flatMap((p) => p.slotRefs).forEach((r) => {
      FirestoreReadStats.bump(r.path, "firestoreBookings.createGroupBooking.runTransaction", "tx.get");
    });
    const slotSnaps = await Promise.all(prepared.flatMap((p) => p.slotRefs).map((r) => tx.get(r)));
    for (const snap of slotSnaps) {
      if (!snap.exists()) continue;
      const sd: any = snap.data() || {};
      const bId = String(sd.bookingId || "").trim();
      if (bId) throw slotTakenError();
      throw slotTakenError();
    }

    // ✅ Aggregated availability conflict check (only when `complete=true`).
    for (const p of prepared) {
      const empId = String(p?.it?.employeeId ?? "").trim();
      const dISO = String(p?.it?.date ?? "").trim();
      if (!empId || !dISO) continue;
      const aRef = doc(db, "salons", SALON_ID, "availability_days", dISO, "employees", empId);
      const aSnap = availabilitySnapByPath.get(aRef.path);
      if (!aSnap || !aSnap.exists()) continue;
      const a: any = aSnap.data() || {};
      if (a.complete !== true) continue;
      const bookedSlots = normalizeBookedSlotsMap(a.bookedSlots);
      const anyBooked = (p.timesToLock || []).some(
        (t: any) => bookedSlots[String(t || "").trim()] === true
      );
      if (anyBooked && (import.meta as any)?.env?.DEV) {
        // booking_slots is still the source of truth. If this fires, availability_days is stale.
        // eslint-disable-next-line no-console
        console.warn(
          "[createGroupBooking] availability_days mismatch (ignored):",
          String(aRef.path || "")
        );
      }
    }

    let next = 10000;
    if (counterSnap.exists()) {
      const d: any = counterSnap.data() || {};
      const cur = typeof d.next === "number" ? d.next : 10000;
      next = cur + 1;
      tx.update(counterRef, { next });
    } else {
      next = 10001;
      tx.set(counterRef, { next }, { merge: true } as any);
    }
    const parentPublicId = `MK-${String(next).padStart(5, "0")}`;

    const parentEmployeeId = String((parent as any)?.employeeId ?? "").trim();
    const parentEmployeeUid = String((parent as any)?.employeeUid ?? "").trim();
    const parentEmployeeName = String((parent as any)?.employeeName ?? "").trim();

    const parentPayload = stripUndefined({
      ...parent,
      createdByUid: actorSnapshot.uid || null,
      createdByEmail: actorSnapshot.email || null,
      createdByName: actorSnapshot.displayName || null,
      updatedByUid: actorSnapshot.uid || null,
      updatedByEmail: actorSnapshot.email || null,
      updatedByName: actorSnapshot.displayName || null,
      serviceName: String(parent.serviceName || parent.packageSnapshot?.packageName || "Package Booking"),
      serviceId: parent.serviceId ?? undefined,
      serviceSnapshot: parent.serviceSnapshot ? (stripUndefined(parent.serviceSnapshot as any) as ServiceSnapshot) : undefined,
      packageId: parent.packageId ? String(parent.packageId).trim() : undefined,
      packageSnapshot: parent.packageSnapshot ?? undefined,
      employeeId: parentEmployeeId || null,
      employeeUid: parentEmployeeUid || null,
      employeeName: parentEmployeeName || "Auto-assigned",
      employeeKey: undefined,
      slotId: undefined,
      parentBookingId: null,
      bookingGroupId: parentRef.id,
      isParentBooking: true,
      isSubBooking: false,
      subBookingCount: prepared.length,
      publicId: parentPublicId,
      paymentMethod: parentResolvedPaymentMethod,
      paymentBreakdown: normalizePaymentBreakdown((parent as any).paymentBreakdown),
      paymentType: parentPaymentState.paymentType,
      paidAmount: parentPaymentState.paidAmount,
      remainingAmount: parentPaymentState.remainingAmount,
      status,
      ...statusAuditPatch,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(parentRef, parentPayload as any);

    for (const p of prepared) {
      const subPublicId = `${parentPublicId}-${String(p.idx + 1).padStart(2, "0")}`;
      const payload = stripUndefined({
        ...p.payloadBase,
        publicId: subPublicId,
        parentBookingId: parentRef.id,
        bookingGroupId: parentRef.id,
        isParentBooking: false,
        isSubBooking: true,
        createdAt: serverTimestamp(),
      });

      for (let i = 0; i < p.slotRefs.length; i++) {
        const slotRef = p.slotRefs[i];
        const t = p.timesToLock[i];
        tx.set(slotRef, {
          bookingId: p.ref.id,
          parentBookingId: parentRef.id,
          bookingGroupId: parentRef.id,
          employeeId: p.it.employeeId ?? null,
          employeeUid: p.it.employeeUid ?? null,
          employeeName: p.it.employeeName,
          employeeKey: p.employeeKey,
          date: p.it.date,
          time: t,
          startTime: p.it.time,
          durationMin: p.durationMin,
          userId: p.it.userId ?? parent.userId ?? null,
          clientPhone: p.it.clientPhone ?? parent.clientPhone ?? "",
          createdAt: serverTimestamp(),
        });
      }

      tx.set(p.ref, payload as any);
    }

    // ✅ Update aggregated availability index docs (write-through during migration).
    const timesByAvailPath = new Map<
      string,
      { ref: any; dateISO: string; employeeId: string; employeeKey: string; times: Set<string> }
    >();
    for (const p of prepared) {
      const empId = String(p?.it?.employeeId ?? "").trim();
      const dISO = String(p?.it?.date ?? "").trim();
      if (!empId || !dISO) continue;
      const aRef = doc(db, "salons", SALON_ID, "availability_days", dISO, "employees", empId);
      const key = aRef.path;
      const entry =
        timesByAvailPath.get(key) || {
          ref: aRef,
          dateISO: dISO,
          employeeId: empId,
          employeeKey: String(p?.employeeKey || "").trim(),
          times: new Set<string>(),
        };
      (p.timesToLock || []).forEach((t: any) => {
        const k = String(t || "").trim();
        if (k) entry.times.add(k);
      });
      if (!entry.employeeKey) {
        entry.employeeKey = String(p?.employeeKey || "").trim();
      }
      timesByAvailPath.set(key, entry);
    }

    for (const entry of timesByAvailPath.values()) {
      const aSnap = availabilitySnapByPath.get(String(entry.ref.path));
      if (aSnap && aSnap.exists()) {
        const patch: any = {
          date: entry.dateISO,
          employeeId: entry.employeeId,
          employeeKey: entry.employeeKey,
          updatedAt: serverTimestamp(),
        };
        entry.times.forEach((t) => {
          patch[`bookedSlots.${t}`] = true;
        });
        tx.update(entry.ref, patch);
      } else {
        const bookedSlots: Record<string, true> = {};
        entry.times.forEach((t) => {
          bookedSlots[t] = true;
        });
        tx.set(entry.ref, {
          date: entry.dateISO,
          employeeId: entry.employeeId,
          employeeKey: entry.employeeKey,
          bookedSlots,
          complete: false,
          updatedAt: serverTimestamp(),
        } as any);
      }
    }

    return { parentPublicId };
  });

  await writeBookingLog({
    bookingId: parentRef.id,
    type: "created",
    note: "تم إنشاء الحجز",
    actor: actorSnapshot,
    booking: parent,
    source: resolveBookingLogSource(parent.channel),
    patch: {
      publicId: parentPublicId,
      serviceId: parent.serviceId ?? null,
      packageId: parent.packageId ?? null,
      employeeId: parent.employeeId ?? null,
      employeeUid: parent.employeeUid ?? null,
      date: parent.date,
      time: parent.time,
      total: Number(parent.finalPrice ?? parent.total ?? 0),
      paymentType: parentPaymentState.paymentType,
      paidAmount: parentPaymentState.paidAmount,
      remainingAmount: parentPaymentState.remainingAmount,
      byUid: actorSnapshot.uid || null,
      byEmail: actorSnapshot.email || null,
      byName: actorSnapshot.displayName || null,
    },
  });

  await Promise.all(
    prepared.map((p, idx) =>
      writeBookingLog({
        bookingId: itemRefs[idx].id,
        type: "created",
        note: "تم إنشاء الحجز",
        actor: actorSnapshot,
        booking: p.payloadBase as Partial<BookingDoc>,
        source: resolveBookingLogSource(p.it?.channel || parent.channel),
        patch: {
          publicId: `${parentPublicId}-${String(p.idx + 1).padStart(2, "0")}`,
          serviceId: p.it?.serviceId ?? null,
          packageId: p.it?.packageId ?? null,
          employeeId: p.it?.employeeId ?? null,
          employeeUid: p.it?.employeeUid ?? null,
          date: p.it?.date ?? null,
          time: p.it?.time ?? null,
          total: Number(p.it?.finalPrice ?? p.it?.total ?? 0),
          paymentType: p.payloadBase?.paymentType ?? null,
          paidAmount: p.payloadBase?.paidAmount ?? null,
          remainingAmount: p.payloadBase?.remainingAmount ?? null,
          byUid: actorSnapshot.uid || null,
          byEmail: actorSnapshot.email || null,
          byName: actorSnapshot.displayName || null,
        },
      })
    )
  );

  return {
    parentId: parentRef.id,
    parentPublicId,
    itemIds: itemRefs.map((x) => x.id),
  };
}

/** ✅ إنشاء حجز من لوحة التحكم */
export async function createDashboardBooking(args: {
  createdBy: string;
  clientName: string;
  clientPhone: string;

  // legacy
  serviceName: string;

  // ✅ new (optional)
  serviceId?: string;
  serviceSnapshot?: ServiceSnapshot;

  durationMin?: number;

  employeeName: string;
  employeeId: string; // ✅ REQUIRED
  employeeUid?: string | null;

  date: string;
  time: string;

  total?: number;
  finalPrice?: number;
  paymentType?: BookingPaymentType;
  paidAmount?: number;
  remainingAmount?: number;

  status?: BookingStatus;
  note?: string;
}) {
  const dashEmployeeId = String(args.employeeId || "").trim();
  if (!dashEmployeeId) throw employeeRequiredError();

  const payload: BookingDoc = {
    userId: null,
    createdBy: args.createdBy,
    channel: "dashboard",

    clientName: args.clientName,
    clientPhone: args.clientPhone,

    serviceName: args.serviceName,

    // ✅ new
    serviceId: args.serviceId,
    serviceSnapshot: args.serviceSnapshot,

    durationMin: args.durationMin,

    employeeId: dashEmployeeId,
    employeeUid: args.employeeUid ?? null,
    employeeName: args.employeeName,

    date: args.date,
    time: args.time,

    total: args.total ?? 0,
    finalPrice: args.finalPrice ?? 0,
    paymentType: args.paymentType,
    paidAmount: args.paidAmount,
    remainingAmount: args.remainingAmount,

    status: args.status ?? "confirmed",
    note: args.note?.trim() || undefined,
  };

  return createBooking(payload);
}

/* =========================
   READ
========================= */

export async function getBookingById(id: string) {
  if (getDataSourceFlags().useCoreD1) {
    try { return coreBookingToLegacy(await CoreBookingService.get(id)); }
    catch { return null; }
  }
  const snap = await getDoc(doc(db, ...BOOKINGS_COL, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...normalizeBooking(snap.data()) };
}

export async function markBookingViewed(bookingId: string) {
  const id = String(bookingId || "").trim();
  if (getDataSourceFlags().useCoreD1) {
    if (!id) throw new Error("BOOKING_ID_REQUIRED");
    await CoreAuditService.record({
      action: "booking_viewed", entityType: "booking", entityId: id,
      description: "Booking viewed from dashboard", source: "dashboard",
    });
    return;
  }
  if (!id) throw new Error("BOOKING_ID_REQUIRED");

  const bookingRef = doc(db, ...BOOKINGS_COL, id);
  const trackRef = doc(db, ...TRACKS_COL, id);
  const auth = getAuth();
  const viewer = auth.currentUser;
  const nowMs = Date.now();

  let didWrite = false;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("BOOKING_NOT_FOUND");

    const data = snap.data() as any;
    const viewedAtMs = Number(data?.viewedAtMs || 0);
    const hasViewedTimestamp =
      typeof data?.viewedAt?.toMillis === "function" ||
      (typeof data?.viewedAt?.seconds === "number" && Number(data?.viewedAt.seconds) > 0) ||
      Number.isFinite(Number(data?.viewedAt)) && Number(data?.viewedAt) > 0;
    if ((Number.isFinite(viewedAtMs) && viewedAtMs > 0) || hasViewedTimestamp) return;

    tx.update(
      bookingRef,
      stripUndefined({
        viewedAt: serverTimestamp(),
        viewedAtMs: nowMs,
        viewedByUid: String(viewer?.uid || "").trim() || null,
        viewedByEmail: String(viewer?.email || "").trim() || null,
        viewedByName: String(viewer?.displayName || "").trim() || null,
        updatedAt: serverTimestamp(),
      }) as any
    );
    didWrite = true;
  });

  if (!didWrite) return;

  try {
    await setDoc(
      trackRef,
      stripUndefined({
        viewedAt: serverTimestamp(),
        viewedAtMs: nowMs,
        viewedByUid: String(viewer?.uid || "").trim() || null,
        viewedByEmail: String(viewer?.email || "").trim() || null,
        viewedByName: String(viewer?.displayName || "").trim() || null,
        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );
  } catch {
    // ignore
  }

  await writeBookingLog({
    bookingId: id,
    type: "staff_acknowledged",
    note: "تمت مشاهدة الحجز لأول مرة",
    patch: {
      viewedAtMs: nowMs,
      viewedByUid: String(viewer?.uid || "").trim() || null,
      viewedByEmail: String(viewer?.email || "").trim() || null,
    },
  });
}

export async function listAllBookings(): Promise<BookingDocWithId[]> {
  if (getDataSourceFlags().useCoreD1) {
    return (await CoreBookingService.list()).map(coreBookingToLegacy);
  }
  const snap = await getDocs(collection(db, ...BOOKINGS_COL));
  snap.docs.forEach((d) => {
    if (d?.ref?.path) {
      FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listAllBookings", "getDocs");
    }
  });
  return snap.docs
    .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
    .sort((a, b) => (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.());
}

/**
 * ✅ Realtime watcher for all bookings
 */
export type BookingReadScope = {
  statuses?: BookingStatus[];
  dateFrom?: string;
  dateTo?: string;
};

function buildBookingsReadQuery(scope?: BookingReadScope) {
  const constraints: Array<ReturnType<typeof where>> = [];
  const statuses = Array.from(
    new Set(
      (Array.isArray(scope?.statuses) ? scope?.statuses : [])
        .map((status) => String(status || "").trim())
        .filter(Boolean)
    )
  ) as BookingStatus[];
  const dateFrom = String(scope?.dateFrom || "").trim();
  const dateTo = String(scope?.dateTo || "").trim();

  if (statuses.length === 1) {
    constraints.push(where("status", "==", statuses[0]));
  } else if (statuses.length > 1) {
    constraints.push(where("status", "in", statuses.slice(0, 10)));
  }
  if (dateFrom) constraints.push(where("date", ">=", dateFrom));
  if (dateTo) constraints.push(where("date", "<=", dateTo));

  return query(collection(db, ...BOOKINGS_COL), ...constraints);
}

export async function listBookings(scope?: BookingReadScope): Promise<BookingDocWithId[]> {
  if (getDataSourceFlags().useCoreD1) {
    const rows = (await CoreBookingService.list()).map(coreBookingToLegacy);
    const statuses = new Set(scope?.statuses || []);
    return rows.filter((row) => {
      if (statuses.size && !statuses.has(row.status)) return false;
      if (scope?.dateFrom && String(row.date || "") < scope.dateFrom) return false;
      if (scope?.dateTo && String(row.date || "") > scope.dateTo) return false;
      return true;
    });
  }
  const snap = await getDocs(buildBookingsReadQuery(scope));
  snap.docs.forEach((d) => {
    if (d?.ref?.path) {
      FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listBookings", "getDocs");
    }
  });
  return snap.docs
    .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
    .sort((a, b) => (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.());
}

export function watchAllBookings(
  onData: (rows: BookingDocWithId[]) => void,
  onError?: (err: unknown) => void,
  scope?: BookingReadScope
) {
  if (getDataSourceFlags().useCoreD1) {
    let stopped = false;
    const load = async () => {
      try { if (!stopped) onData(await listBookings(scope)); }
      catch (error) { if (!stopped) onError?.(error); }
    };
    void load();
    const timer = globalThis.setInterval(load, 12_000);
    return () => { stopped = true; globalThis.clearInterval(timer); };
  }
  const q = buildBookingsReadQuery(scope);
  let first = true;

  return onSnapshot(
    q,
    (snap) => {
      // Track billed reads: initial snapshot reads all docs, later snapshots read only changes.
      const source = "firestoreBookings.watchAllBookings";
      const docs = first ? snap.docs : snap.docChanges().map((c) => c.doc);
      docs.forEach((d) => {
        if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, source, "onSnapshot");
      });
      first = false;

      const rows = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort((a, b) => (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.());

      onData(rows);
    },
    (err) => onError?.(err)
  );
}

export async function listUserBookings(userId: string) {
  if (getDataSourceFlags().useCoreD1) {
    return (await CoreBookingService.list({ clientId: userId })).map(coreBookingToLegacy);
  }
  const q = query(collection(db, ...BOOKINGS_COL), where("userId", "==", userId));
  const snap = await getDocs(q);
  snap.docs.forEach((d) => {
    if (d?.ref?.path) {
      FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listUserBookings", "getDocs");
    }
  });
  return snap.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));
}

/* =========================
   STAFF (Employee) READ
========================= */

function sortByCreatedAtDesc(a: BookingDocWithId, b: BookingDocWithId) {
  return (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.();
}

function uniqMerge(a: BookingDocWithId[], b: BookingDocWithId[]) {
  const m = new Map<string, BookingDocWithId>();
  for (const x of a) m.set(x.id, x);
  for (const x of b) m.set(x.id, x);
  return Array.from(m.values()).sort(sortByCreatedAtDesc);
}

export async function listEmployeeBookings(
  employeeIdOrUid: string,
  employeeName?: string
): Promise<BookingDocWithId[]> {
  if (getDataSourceFlags().useCoreD1) {
    return (await CoreBookingService.list({ staffId: employeeIdOrUid })).map(coreBookingToLegacy);
  }
  const baseCol = collection(db, ...BOOKINGS_COL);

  // primary by employeeKey (uid or safeKey or staff_public id)
  const qKey = query(baseCol, where("employeeKey", "==", employeeIdOrUid));
  const sKey = await getDocs(qKey);
  sKey.docs.forEach((d) => {
    if (d?.ref?.path) {
      FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listEmployeeBookings", "getDocs");
    }
  });
  const rKey = sKey.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  // old way (employeeId)
  const q1 = query(baseCol, where("employeeId", "==", employeeIdOrUid));
  const s1 = await getDocs(q1);
  s1.docs.forEach((d) => {
    if (d?.ref?.path) {
      FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listEmployeeBookings", "getDocs");
    }
  });
  const r1 = s1.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  let r2: BookingDocWithId[] = [];
  const name = String(employeeName || "").trim();
  if (name) {
    const q2k = query(baseCol, where("employeeKey", "==", safeKey(name)));
    const s2k = await getDocs(q2k);
    s2k.docs.forEach((d) => {
      if (d?.ref?.path) {
        FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listEmployeeBookings", "getDocs");
      }
    });
    const r2k = s2k.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

    const q2 = query(baseCol, where("employeeName", "==", name));
    const s2 = await getDocs(q2);
    s2.docs.forEach((d) => {
      if (d?.ref?.path) {
        FirestoreReadStats.bump(d.ref.path, "firestoreBookings.listEmployeeBookings", "getDocs");
      }
    });
    const r2n = s2.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

    r2 = uniqMerge(r2k, r2n);
  }

  return uniqMerge(uniqMerge(rKey, r1), r2);
}

export function watchEmployeeBookings(
  employeeIdOrUid: string,
  employeeName: string | undefined,
  onData: (rows: BookingDocWithId[]) => void,
  onError?: (err: unknown) => void
) {
  if (getDataSourceFlags().useCoreD1) {
    let stopped = false;
    const load = async () => {
      try { if (!stopped) onData(await listEmployeeBookings(employeeIdOrUid, employeeName)); }
      catch (error) { if (!stopped) onError?.(error); }
    };
    void load();
    const timer = globalThis.setInterval(load, 12_000);
    return () => { stopped = true; globalThis.clearInterval(timer); };
  }
  const baseCol = collection(db, ...BOOKINGS_COL);

  let rowsByKeyUid: BookingDocWithId[] = [];
  let rowsById: BookingDocWithId[] = [];
  let rowsByKeyName: BookingDocWithId[] = [];
  let rowsByName: BookingDocWithId[] = [];

  const makeSnapLogger = (label: string) => {
    let first = true;
    const src = `firestoreBookings.watchEmployeeBookings.${String(label || "").trim() || "unknown"}`;
    return (snap: any) => {
      const docs = first ? snap.docs : snap.docChanges().map((c: any) => c.doc);
      docs.forEach((d: any) => {
        if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, src, "onSnapshot");
      });
      first = false;
    };
  };
  const logKeyUidSnap = makeSnapLogger("employeeKey");
  const logIdSnap = makeSnapLogger("employeeId");
  const logKeyNameSnap = makeSnapLogger("employeeKeyName");
  const logNameSnap = makeSnapLogger("employeeName");

  const emit = () => {
    onData(uniqMerge(uniqMerge(rowsByKeyUid, rowsById), uniqMerge(rowsByKeyName, rowsByName)));
  };

  // employeeKey == uid/stable key
  const unsubKeyUid = onSnapshot(
    query(baseCol, where("employeeKey", "==", employeeIdOrUid)),
    (snap) => {
      logKeyUidSnap(snap);
      rowsByKeyUid = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort(sortByCreatedAtDesc);
      emit();
    },
    (err) => onError?.(err)
  );

  // old: employeeId == uid/staff_public id
  const unsubId = onSnapshot(
    query(baseCol, where("employeeId", "==", employeeIdOrUid)),
    (snap) => {
      logIdSnap(snap);
      rowsById = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort(sortByCreatedAtDesc);
      emit();
    },
    (err) => onError?.(err)
  );

  const name = String(employeeName || "").trim();

  let unsubKeyName: (() => void) | null = null;
  if (name) {
    unsubKeyName = onSnapshot(
      query(baseCol, where("employeeKey", "==", safeKey(name))),
      (snap) => {
        logKeyNameSnap(snap);
        rowsByKeyName = snap.docs
          .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
          .sort(sortByCreatedAtDesc);
        emit();
      },
      (err) => onError?.(err)
    );
  }

  let unsubName: (() => void) | null = null;
  if (name) {
    unsubName = onSnapshot(
      query(baseCol, where("employeeName", "==", name)),
      (snap) => {
        logNameSnap(snap);
        rowsByName = snap.docs
          .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
          .sort(sortByCreatedAtDesc);
        emit();
      },
      (err) => onError?.(err)
    );
  }

  return () => {
    unsubKeyUid?.();
    unsubId?.();
    unsubKeyName?.();
    unsubName?.();
  };
}

/* =========================
   UPDATE
========================= */

/**
 * ✅ FIX:
 * 1) تحديث الحالة لازم ينجح حتى لو income ممنوع بالـ rules
 * 2) نخلي income "best-effort" خارج الترانزاكشن (ما يكسّر تعديل الحجز)
 * 3) ✅ إلغاء الحجز يفتح الوقت (يفك booking_slots) بطريقة مضمونة by bookingId
 * 4) ✅ الدخل ما يتكرر: ننشئ income مرة وحدة فقط عند confirmed (وإذا موجود لا نعيد إنشاء)
 */
export async function updateBookingStatus(bookingId: string, status: BookingStatus) {
  if (getDataSourceFlags().useCoreD1) {
    await coreD1BookingDataSource.updateBookingStatus(bookingId, status);
    return;
  }
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const nowMs = Date.now();

  // ✅ ثابت: نخلي income docId = bookingId (يعطيك uniqueness تلقائي)
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  if (status === "cancelled") {
    const preSnap = await getDoc(bookingRef);
    if (!preSnap.exists()) throw new Error("BOOKING_NOT_FOUND");
    const preRaw: any = preSnap.data() || {};
    if (hasReservedPackageRedemption(preRaw)) {
      const actorSnapshot = resolveActorSnapshot({ booking: normalizeBooking(preRaw) });
      await PackageOperationsService.cancelRedemptionBooking(bookingId, "cancelled_from_booking_status");
      await writeBookingLog({
        bookingId,
        type: "status_changed",
        note: `طھط؛ظٹظٹط± ط§ظ„ط­ط§ظ„ط© ط¥ظ„ظ‰: ${status}`,
        actor: actorSnapshot,
        booking: normalizeBooking({ ...preRaw, status }) as BookingDoc,
        source: resolveBookingLogSource(normalizeBooking(preRaw).channel),
        patch: {
          status,
          at: nowMs,
          byUid: actorSnapshot.uid || null,
          byEmail: actorSnapshot.email || null,
          byName: actorSnapshot.displayName || null,
        },
      });
      return;
    }
  }

  // ✅ 1) Transaction: booking + track فقط
  const txResult = await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("BOOKING_NOT_FOUND");

    const bookingRaw: any = snap.data() || {};
    const booking = normalizeBooking(bookingRaw);
    const actorSnapshot = resolveActorSnapshot({ booking });
    const statusAuditPatch = buildStatusAuditPatch(status, nowMs, actorSnapshot);

    const resolvedPaymentMethod = resolvePaymentMethodForStatus(
      status,
      (booking as any).paymentMethod,
      booking.note
    );
    const totalAmount = readTotalAmount(bookingRaw);
    const hasStoredPaymentFields =
      Number.isFinite(Number(bookingRaw?.paidAmount)) ||
      normalizePaymentType(bookingRaw?.paymentType) !== null;
    const nextPaymentState = resolveBookingPaymentState({
      ...bookingRaw,
      status,
      total: totalAmount,
      finalPrice: totalAmount,
      ...(hasStoredPaymentFields
        ? {}
        : {
            paymentType: "full",
            paidAmount: status === "confirmed" || status === "completed" ? totalAmount : 0,
          }),
    });

    // booking
    tx.update(
      bookingRef,
      stripUndefined({
        status,
        paymentMethod: resolvedPaymentMethod,
        paymentBreakdown: normalizePaymentBreakdown((bookingRaw as any).paymentBreakdown),
        paymentType: nextPaymentState.paymentType,
        paidAmount: nextPaymentState.paidAmount,
        remainingAmount: nextPaymentState.remainingAmount,
        updatedByUid: actorSnapshot.uid || null,
        updatedByEmail: actorSnapshot.email || null,
        updatedByName: actorSnapshot.displayName || null,
        ...statusAuditPatch,
        updatedAt: serverTimestamp(),
      }) as any
    );

    // track
    tx.set(
      trackRef,
      stripUndefined({
        bookingId,

        // ✅ keep these for dashboards
        publicId: booking.publicId ?? undefined,

        // legacy + new
        serviceName: booking.serviceName,
        serviceId: booking.serviceId ?? undefined,
        serviceSnapshot: booking.serviceSnapshot ?? undefined,
        packageId: booking.packageId ?? undefined,
        packageSnapshot: booking.packageSnapshot ?? undefined,

        employeeId: booking.employeeId ?? null,
        employeeUid: booking.employeeUid ?? null,
        employeeName: booking.employeeName,
        employeeKey: booking.employeeKey ?? undefined,

        date: booking.date,
        time: booking.time,
        durationMin: booking.durationMin ?? undefined,
        paymentMethod: resolvedPaymentMethod,
        paymentBreakdown: normalizePaymentBreakdown((booking as any).paymentBreakdown),
        paymentType: nextPaymentState.paymentType,
        paidAmount: nextPaymentState.paidAmount,
        remainingAmount: nextPaymentState.remainingAmount,
        updatedByUid: actorSnapshot.uid || null,
        updatedByEmail: actorSnapshot.email || null,
        updatedByName: actorSnapshot.displayName || null,

        status,
        ...statusAuditPatch,
        slotId: booking.slotId ?? undefined,

        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );

    return {
      booking: {
        ...booking,
        status,
        paymentMethod: resolvedPaymentMethod,
        paymentType: nextPaymentState.paymentType,
        paidAmount: nextPaymentState.paidAmount,
        remainingAmount: nextPaymentState.remainingAmount,
        updatedByUid: actorSnapshot.uid || null,
        updatedByEmail: actorSnapshot.email || null,
        updatedByName: actorSnapshot.displayName || null,
        ...statusAuditPatch,
      } as BookingDoc,
      shouldConsumeReservedPackageSession:
        status === "completed" && hasReservedPackageRedemption(bookingRaw),
      resolvedPaymentMethod,
      actorSnapshot,
      source: resolveBookingLogSource(booking.channel),
    };
  });

  // ✅ booking log: status changed (best effort)
  await writeBookingLog({
    bookingId,
    type: "status_changed",
    note: `تغيير الحالة إلى: ${status}`,
    actor: txResult.actorSnapshot,
    booking: txResult.booking,
    source: txResult.source,
    patch: {
      status,
      at: nowMs,
      byUid: txResult.actorSnapshot.uid || null,
      byEmail: txResult.actorSnapshot.email || null,
      byName: txResult.actorSnapshot.displayName || null,
    },
  });

// ✅ إذا صار الحجز ملغي: فك الأقفال
if (status === "cancelled") {
  await unlockSlotsByBookingId(bookingId);
}

// ✅ إذا رجع confirmed أو completed: لازم نقفل الأقفال من جديد
if (status === "confirmed" || status === "completed") {
  // (best-effort) لا نخليها تكسر تغيير الحالة لو صار خطأ
  try {
    // أولاً فك أي بقايا قديمة غلط (اختياري لكنه يحمي من تضارب الموظفة/المفتاح)
    await unlockSlotsByBookingId(bookingId);

    // ثم اقفلها حسب بيانات الحجز الحالية
    await lockSlotsFromBooking(bookingId);
  } catch (e) {
    console.warn("[updateBookingStatus] re-lock slots failed (ignored):", e);
  }
}


  if (txResult.shouldConsumeReservedPackageSession) {
    await PackageOperationsService.consumeReserved(bookingId);
  }

  // ✅ 2) Best-effort: income خارج الترانزاكشن (ما يمنع تعديل الحجز)
  try {
    const bookingForIncome = txResult.booking;
    const incomeDateNow = normalizeISODate(bookingForIncome.date) || localISODate();
    const resolvedPaymentMethod =
      txResult.resolvedPaymentMethod ||
      resolvePaymentMethodForStatus(status, (bookingForIncome as any).paymentMethod, bookingForIncome.note) ||
      "transfer";
    const amount = getAmount(bookingForIncome);
    if ((status === "confirmed" || status === "completed") && (!Number.isFinite(amount) || amount <= 0)) {
      try {
        const s = await getDoc(incomeRef);
        if (s.exists()) await deleteDoc(incomeRef);
      } catch {
        // ignore
      }
      return;
    }

    // ✅ المطلوب منك: الدخل يننشأ مرة وحدة فقط عند confirmed
    if (status === "confirmed") {
      // ✅ check: إذا income موجود مسبقًا لنفس bookingId → لا نعيد إنشاء (ما يتكرر)
      const existing = await getDoc(incomeRef);
      if (!existing.exists()) {
        await setDoc(
          incomeRef,
          stripUndefined({
            source: "booking",
            bookingId,
            amount: Number(amount || 0),
            status: "confirmed",
            method: resolvedPaymentMethod,
            paymentBreakdown: normalizePaymentBreakdown((bookingForIncome as any).paymentBreakdown),

            date: incomeDateNow,
            clientName: bookingForIncome.clientName,
            clientPhone: bookingForIncome.clientPhone,

            serviceName:
              bookingForIncome.serviceSnapshot?.serviceNameAtBooking ||
              bookingForIncome.serviceName,

            employeeName: bookingForIncome.employeeName,
            note: paymentBreakdownIncomeNote(bookingForIncome),

            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }) as any
        );
      } else {
        // ✅ موجود: فقط حدّث updatedAt/status لو تحب (بدون تكرار)
        try {
          await setDoc(
            incomeRef,
            stripUndefined({
              amount: Number(amount || 0),
              status: "confirmed",
              method: resolvedPaymentMethod,
              paymentBreakdown: normalizePaymentBreakdown((bookingForIncome as any).paymentBreakdown),
              date: incomeDateNow,
              clientName: bookingForIncome.clientName,
              clientPhone: bookingForIncome.clientPhone,
              serviceName:
                bookingForIncome.serviceSnapshot?.serviceNameAtBooking ||
                bookingForIncome.serviceName,
              employeeName: bookingForIncome.employeeName,
              note: paymentBreakdownIncomeNote(bookingForIncome),
              updatedAt: serverTimestamp(),
            }) as any,
            { merge: true }
          );
        } catch {
          // ignore
        }
      }

      return;
    }

    // ✅ إذا رجع pending أو cancelled: احذف income (best-effort)
    if (status === "pending" || status === "cancelled") {
      try {
        const s = await getDoc(incomeRef);
        if (s.exists()) await deleteDoc(incomeRef);
      } catch {
        // ignore
      }
      return;
    }

    // ✅ completed: ما ننشئ income جديد (عشان شرطك "confirmed مرة وحدة")،
    // لكن نقدر نحدّث status فقط إذا الدخل موجود.
    if (status === "completed") {
      try {
        const s = await getDoc(incomeRef);
        if (s.exists()) {
          await setDoc(
            incomeRef,
            stripUndefined({
              status: "completed",
              method: resolvedPaymentMethod,
              amount: Number(amount || 0),
              paymentBreakdown: normalizePaymentBreakdown((bookingForIncome as any).paymentBreakdown),
              note: paymentBreakdownIncomeNote(bookingForIncome),
              updatedAt: serverTimestamp(),
            }) as any,
            { merge: true }
          );
        } else {
          await setDoc(
            incomeRef,
            stripUndefined({
              source: "booking",
              bookingId,
              amount: Number(amount || 0),
              status: "completed",
              method: resolvedPaymentMethod,
              paymentBreakdown: normalizePaymentBreakdown((bookingForIncome as any).paymentBreakdown),
              date: incomeDateNow,
              clientName: bookingForIncome.clientName,
              clientPhone: bookingForIncome.clientPhone,
              serviceName:
                bookingForIncome.serviceSnapshot?.serviceNameAtBooking ||
                bookingForIncome.serviceName,
              employeeName: bookingForIncome.employeeName,
              note: paymentBreakdownIncomeNote(bookingForIncome),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }) as any
          );
        }
      } catch {
        // ignore
      }
      return;
    }
  } catch (e) {
    // ✅ مهم: لا نرمي خطأ هنا عشان ما نكسر تعديل الحجز
    console.error("income update failed (ignored):", e);
  }
}

export async function updateBookingsStatusBatch(args: {
  bookingIds: string[];
  status: BookingStatus;
  note?: string;
  filterSummary?: string;
}) {
  const bookingIds = Array.from(
    new Set(
      (Array.isArray(args.bookingIds) ? args.bookingIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  const status = args.status;
  const actorSnapshot = resolveActorSnapshot();
  const startedAtMs = Date.now();
  const successes: string[] = [];
  const failures: Array<{ bookingId: string; message: string }> = [];

  for (const group of chunkItems(bookingIds, 8)) {
    const settled = await Promise.allSettled(
      group.map(async (bookingId) => {
        await updateBookingStatus(bookingId, status);
        return bookingId;
      })
    );

    settled.forEach((result, index) => {
      const bookingId = group[index];
      if (result.status === "fulfilled") {
        successes.push(result.value);
        return;
      }
      failures.push({
        bookingId,
        message: String(result.reason?.message || result.reason || "UNKNOWN_ERROR"),
      });
    });
  }

  try {
    await writeAuditLog({
      salonId: SALON_ID,
      action: "booking_bulk_status_updated",
      entityType: "booking",
      entityId: `bulk_${startedAtMs}`,
      description: args.note || `Bulk booking status update to ${status}`,
      source: "dashboard",
      actorUid: actorSnapshot.uid || undefined,
      actorEmail: actorSnapshot.email || undefined,
      actorName: actorSnapshot.displayName || undefined,
      after: {
        status,
        bookingIds,
        successCount: successes.length,
        failedCount: failures.length,
      },
      meta: {
        status,
        filterSummary: args.filterSummary || "",
        bookingIds,
        successes,
        failures,
        startedAtMs,
        completedAtMs: Date.now(),
      },
    });
  } catch {
    // ignore audit failures
  }

  return {
    requestedCount: bookingIds.length,
    successCount: successes.length,
    failedCount: failures.length,
    successes,
    failures,
  };
}

type AvailabilityPatchEntry = {
  ref: any;
  dateISO: string;
  employeeId: string;
  employeeKey: string;
  patch: Record<string, any>;
  addTimes: Set<string>;
};

function getAvailabilityPatchEntry(
  map: Map<string, AvailabilityPatchEntry>,
  args: { ref: any; dateISO: string; employeeId: string; employeeKey: string }
) {
  const key = args.ref.path;
  const existing = map.get(key);
  if (existing) {
    if (!existing.employeeKey) existing.employeeKey = args.employeeKey;
    return existing;
  }
  const entry: AvailabilityPatchEntry = {
    ref: args.ref,
    dateISO: args.dateISO,
    employeeId: args.employeeId,
    employeeKey: args.employeeKey,
    patch: {},
    addTimes: new Set<string>(),
  };
  map.set(key, entry);
  return entry;
}

async function applyAvailabilityPatchMap(map: Map<string, AvailabilityPatchEntry>) {
  if (map.size === 0) return;
  await Promise.all(
    Array.from(map.values()).map(async (entry) => {
      const patch = stripUndefined({
        date: entry.dateISO,
        employeeId: entry.employeeId,
        employeeKey: entry.employeeKey,
        updatedAt: serverTimestamp(),
        ...entry.patch,
      }) as any;
      try {
        await updateDoc(entry.ref, patch);
      } catch (e: any) {
        if (String(e?.code || "").trim() === "not-found" && entry.addTimes.size > 0) {
          const bookedSlots: Record<string, true> = {};
          entry.addTimes.forEach((t) => {
            const k = String(t || "").trim();
            if (k) bookedSlots[k] = true;
          });
          await setDoc(entry.ref, {
            date: entry.dateISO,
            employeeId: entry.employeeId,
            employeeKey: entry.employeeKey,
            bookedSlots,
            complete: false,
            updatedAt: serverTimestamp(),
          } as any);
        }
      }
    })
  );
}

export async function updateBookingDetails(bookingId: string, patch: Partial<BookingDoc>) {
  if (getDataSourceFlags().useCoreD1) {
    const unsupported = [patch.date, patch.time, patch.startTime, patch.employeeId, patch.employeeUid, patch.employeeKey, patch.employeeName, patch.durationMin].some((value) => value !== undefined);
    if (unsupported) throw new Error("CORE_D1_BOOKING_RESCHEDULE_REQUIRES_PHASE6");
    await coreD1BookingDataSource.updateBooking(bookingId, patch);
    return;
  }
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  let effectivePatch: Partial<BookingDoc> = { ...patch };
  const hasOperationalAssignmentPatch =
    patch.date !== undefined ||
    patch.time !== undefined ||
    (patch as any).startTime !== undefined ||
    patch.employeeId !== undefined ||
    patch.employeeUid !== undefined ||
    patch.employeeKey !== undefined ||
    patch.employeeName !== undefined;
  const hasSlotSensitivePatch =
    hasOperationalAssignmentPatch ||
    patch.durationMin !== undefined ||
    patch.slotStepMinAtBooking !== undefined ||
    patch.bufferMinAtBooking !== undefined;
  const needsCurrentBooking =
    hasOperationalAssignmentPatch ||
    hasSlotSensitivePatch ||
    patch.employeeId !== undefined ||
    patch.employeeUid !== undefined ||
    patch.employeeKey !== undefined ||
    patch.employeeName !== undefined;

  let current: BookingDoc | null = null;
  if (needsCurrentBooking) {
    const currentSnap = await getDoc(bookingRef);
    if (currentSnap.exists()) {
      current = normalizeBooking(currentSnap.data());
    }
  }

  const currentEmployeeId = String(current?.employeeId ?? "").trim();
  const currentEmployeeUid = String(current?.employeeUid ?? "").trim();
  const currentEmployeeName = String(current?.employeeName ?? "").trim();
  const currentEmployeeKey = String(current?.employeeKey ?? "").trim();
  const currentDate = normalizeISODate(current?.date);
  const currentTime = String(current?.time ?? (current as any)?.startTime ?? "").trim();
  const currentDurationMin = Math.max(0, Number(current?.durationMin || 0)) || 60;
  const currentSlotStepMin = Number((current as any)?.slotStepMinAtBooking ?? 0) || 0;
  const currentBufferMin = Number((current as any)?.bufferMinAtBooking ?? 0) || 0;

  const nextEmployeeId = String(
    patch.employeeId !== undefined ? patch.employeeId ?? "" : currentEmployeeId
  ).trim();
  const nextEmployeeUid = String(
    patch.employeeUid !== undefined ? patch.employeeUid ?? "" : currentEmployeeUid
  ).trim();
  const nextEmployeeName = String(
    patch.employeeName !== undefined ? patch.employeeName ?? "" : currentEmployeeName
  ).trim();
  const nextDate = normalizeISODate(patch.date !== undefined ? patch.date : current?.date);
  const nextTimeRaw =
    patch.time !== undefined
      ? patch.time
      : (patch as any).startTime !== undefined
        ? (patch as any).startTime
        : current?.time ?? (current as any)?.startTime ?? "";
  const nextTime = String(nextTimeRaw ?? "").trim();
  const nextDurationMin = Math.max(
    0,
    Number(patch.durationMin !== undefined ? patch.durationMin : current?.durationMin ?? 0)
  ) || 60;
  const nextSlotStepMin =
    patch.slotStepMinAtBooking !== undefined
      ? Number(patch.slotStepMinAtBooking)
      : (current as any)?.slotStepMinAtBooking;
  const nextBufferMin =
    patch.bufferMinAtBooking !== undefined
      ? Number(patch.bufferMinAtBooking)
      : (current as any)?.bufferMinAtBooking;

  const hasSlotChange = current
    ? currentEmployeeId !== nextEmployeeId ||
      currentDate !== nextDate ||
      currentTime !== nextTime ||
      Number(currentDurationMin || 0) !== Number(nextDurationMin || 0) ||
      Number(currentSlotStepMin || 0) !== Number(nextSlotStepMin || 0) ||
      Number(currentBufferMin || 0) !== Number(nextBufferMin || 0)
    : hasSlotSensitivePatch;

  if (hasSlotChange && nextEmployeeId && nextDate && nextDate >= localISODate()) {
    await assertEmployeeCanAcceptBooking({
      employeeId: nextEmployeeId,
      dateISO: nextDate,
      channel: "dashboard",
    });
  }

  const shouldResolveEmployeePatch =
    patch.employeeId !== undefined ||
    patch.employeeUid !== undefined ||
    patch.employeeKey !== undefined ||
    patch.employeeName !== undefined;

  const resolvedEmployeeId = nextEmployeeId;
  const resolvedEmployeeUid = nextEmployeeUid;
  const resolvedEmployeeName = nextEmployeeName || currentEmployeeName;
  const resolvedEmployeeKey =
    resolvedEmployeeUid || resolvedEmployeeId || safeKey(resolvedEmployeeName || "unknown_employee");

  if (shouldResolveEmployeePatch) {
    effectivePatch = {
      ...effectivePatch,
      employeeId: resolvedEmployeeId || null,
      employeeUid: resolvedEmployeeUid || null,
      employeeName: resolvedEmployeeName,
      employeeKey: resolvedEmployeeKey || undefined,
    };
  }

  const shouldSyncTime =
    hasSlotChange || patch.time !== undefined || (patch as any).startTime !== undefined;
  if (shouldSyncTime && nextTime) {
    effectivePatch = {
      ...effectivePatch,
      time: nextTime,
      startTime: nextTime,
    };
  }

  const anyPatch = effectivePatch as any;
  let actorSnapshot = resolveActorSnapshot({ booking: { ...(current || {}), ...effectivePatch } });

  let availabilityPatchMap: Map<string, AvailabilityPatchEntry> | null = null;

  if (hasSlotChange) {
    if (!current) throw new Error("BOOKING_NOT_FOUND");

    const slotPlan = await buildSlotPlanForUpdate({
      dateISO: nextDate,
      time: nextTime,
      employeeId: resolvedEmployeeId,
      durationMin: nextDurationMin,
      slotStepMinAtBooking: nextSlotStepMin,
      bufferMinAtBooking: nextBufferMin,
    });

    effectivePatch = {
      ...effectivePatch,
      slotId: slotPlan.startSlotId,
      slotStepMinAtBooking: slotPlan.slotStepMin,
      bufferMinAtBooking: slotPlan.bufferMin,
      time: slotPlan.requestedStartTime,
      startTime: slotPlan.requestedStartTime,
    };

    actorSnapshot = resolveActorSnapshot({ booking: { ...current, ...effectivePatch } });

    const oldSlotsSnap = await getDocs(
      query(collection(db, ...SLOTS_COL), where("bookingId", "==", bookingId))
    );
    const oldSlotDocs = oldSlotsSnap.docs;

    const newSlotIds = new Set(slotPlan.slotRefs.map((r) => r.id));
    const oldSlotRefsToDelete = oldSlotDocs.map((d) => d.ref).filter((r) => !newSlotIds.has(r.id));

    const bookingUpdatePayload = stripUndefined({
      ...effectivePatch,
      updatedByUid: actorSnapshot.uid || null,
      updatedByEmail: actorSnapshot.email || null,
      updatedByName: actorSnapshot.displayName || null,
      updatedAt: serverTimestamp(),
    }) as any;

    await runTransaction(db, async (tx) => {
      const slotSnaps = await Promise.all(slotPlan.slotRefs.map((r) => tx.get(r)));
      for (const snap of slotSnaps) {
        if (!snap.exists()) continue;
        const sd: any = snap.data() || {};
        const bId = String(sd.bookingId || "").trim();
        if (!bId) throw slotTakenError();
        if (bId !== bookingId) throw slotTakenError();
      }

      oldSlotRefsToDelete.forEach((ref) => tx.delete(ref));

      for (let i = 0; i < slotPlan.slotRefs.length; i++) {
        const slotRef = slotPlan.slotRefs[i];
        const slotSnap = slotSnaps[i];
        const t = slotPlan.timesToLock[i];
        const slotPayload = {
          bookingId,
          employeeId: resolvedEmployeeId || null,
          employeeUid: resolvedEmployeeUid || null,
          employeeName: resolvedEmployeeName,
          employeeKey: resolvedEmployeeKey || resolvedEmployeeId || null,
          date: slotPlan.dateISO,
          time: t,
          startTime: slotPlan.requestedStartTime,
          durationMin: slotPlan.durationMin,
          userId: current?.userId ?? null,
          clientPhone: current?.clientPhone ?? "",
          updatedAt: serverTimestamp(),
        };

        if (slotSnap.exists()) {
          // Preserve the original creation timestamp when the slot document is reused.
          tx.update(slotRef, slotPayload);
        } else {
          tx.set(slotRef, {
            ...slotPayload,
            createdAt: serverTimestamp(),
          });
        }
      }

      tx.update(bookingRef, bookingUpdatePayload);
    });

    const availabilityPatch = new Map<string, AvailabilityPatchEntry>();
    availabilityPatchMap = availabilityPatch;

    if (oldSlotDocs.length > 0) {
      oldSlotDocs.forEach((d: any) => {
        if (d?.ref?.path) {
          FirestoreReadStats.bump(d.ref.path, "firestoreBookings.updateBookingDetails", "getDocs");
        }
        const sd: any = d.data() || {};
        const dateISO = String(sd.date || "").trim();
        const time = String(sd.time || "").trim();
        const employeeId = String(sd.employeeId ?? "").trim();
        const employeeKey = String(sd.employeeKey ?? "").trim() || employeeId;
        if (!dateISO || !time || !employeeId) return;
        const aRef = doc(db, "salons", SALON_ID, "availability_days", dateISO, "employees", employeeId);
        const entry = getAvailabilityPatchEntry(availabilityPatch, {
          ref: aRef,
          dateISO,
          employeeId,
          employeeKey,
        });
        entry.patch[`bookedSlots.${time}`] = deleteField();
      });
    } else if (currentDate && currentEmployeeId) {
      const fallbackTimes = getTimesToLock(
        currentTime,
        currentDurationMin,
        {
          slotStepMin: currentSlotStepMin,
          bufferMin: currentBufferMin,
        },
        currentDate
      );
      if (fallbackTimes.length > 0) {
        const oldEmployeeKey =
          currentEmployeeKey ||
          currentEmployeeUid ||
          currentEmployeeId ||
          safeKey(currentEmployeeName || "unknown_employee");
        const aRef = doc(
          db,
          "salons",
          SALON_ID,
          "availability_days",
          currentDate,
          "employees",
          currentEmployeeId
        );
        const entry = getAvailabilityPatchEntry(availabilityPatch, {
          ref: aRef,
          dateISO: currentDate,
          employeeId: currentEmployeeId,
          employeeKey: oldEmployeeKey,
        });
        fallbackTimes.forEach((t) => {
          const k = String(t || "").trim();
          if (k) entry.patch[`bookedSlots.${k}`] = deleteField();
        });
      }
    }

    if (slotPlan.dateISO && resolvedEmployeeId) {
      const newEmployeeKey = resolvedEmployeeKey || resolvedEmployeeId;
      const aRef = doc(
        db,
        "salons",
        SALON_ID,
        "availability_days",
        slotPlan.dateISO,
        "employees",
        resolvedEmployeeId
      );
      const entry = getAvailabilityPatchEntry(availabilityPatch, {
        ref: aRef,
        dateISO: slotPlan.dateISO,
        employeeId: resolvedEmployeeId,
        employeeKey: newEmployeeKey,
      });
      slotPlan.timesToLock.forEach((t) => {
        const k = String(t || "").trim();
        if (!k) return;
        entry.patch[`bookedSlots.${k}`] = true;
        entry.addTimes.add(k);
      });
    }
  } else {
    // ✅ تحديث booking (بدون تغيير على الأقفال)
    await updateDoc(
      bookingRef,
      stripUndefined({
        ...effectivePatch,
        updatedByUid: actorSnapshot.uid || null,
        updatedByEmail: actorSnapshot.email || null,
        updatedByName: actorSnapshot.displayName || null,
        updatedAt: serverTimestamp(),
      }) as any
    );
  }

  // ✅ Auto-confirm pending bookings when fully paid.
  // Keep internal flow unchanged (channel=internal does not auto-promote).
  if (
    effectivePatch.status === undefined &&
    (effectivePatch.paymentType !== undefined ||
      effectivePatch.paidAmount !== undefined ||
      effectivePatch.remainingAmount !== undefined ||
      effectivePatch.finalPrice !== undefined ||
      effectivePatch.total !== undefined)
  ) {
    try {
      const freshSnap = await getDoc(bookingRef);
      if (freshSnap.exists()) {
        const fresh = normalizeBooking(freshSnap.data());
        const freshStatus = (String(fresh.status || "").trim().toLowerCase() || "pending") as BookingStatus;
        if (shouldAutoConfirmPendingOnFullPayment(fresh, freshStatus)) {
          await updateBookingStatus(bookingId, "confirmed");
        }
      }
    } catch (e) {
      console.warn("[updateBookingDetails] auto-confirm check failed (ignored):", e);
    }
  }

  // ✅ booking log: details updated (best effort)
  await writeBookingLog({
    bookingId,
    type: "details_updated",
    note: "تم تعديل بيانات الحجز",
    actor: actorSnapshot,
    booking: effectivePatch,
    patch: {
      ...effectivePatch,
      updatedByUid: actorSnapshot.uid || null,
      updatedByEmail: actorSnapshot.email || null,
      updatedByName: actorSnapshot.displayName || null,
    },
  });

  // ✅ best-effort track update (إذا track ناقص أو rules تمنع، لا نكسر حفظ الحجز)
  try {
    await setDoc(
      doc(db, ...TRACKS_COL, bookingId),
      stripUndefined({
        publicId: effectivePatch.publicId,

        serviceName: patch.serviceName,
        serviceId: patch.serviceId,
        serviceSnapshot: patch.serviceSnapshot,
        packageId: patch.packageId,
        packageSnapshot: patch.packageSnapshot,

        employeeId: effectivePatch.employeeId,
        employeeUid: effectivePatch.employeeUid,
        employeeName: effectivePatch.employeeName,
        employeeKey: effectivePatch.employeeKey,

        date: effectivePatch.date,
        time: effectivePatch.time,
        durationMin: effectivePatch.durationMin,
        paymentMethod: effectivePatch.paymentMethod,
        paymentBreakdown: effectivePatch.paymentBreakdown,
        paymentType: effectivePatch.paymentType,
        paidAmount: effectivePatch.paidAmount,
        remainingAmount: effectivePatch.remainingAmount,
        total: effectivePatch.total,
        finalPrice: effectivePatch.finalPrice,
        clientName: effectivePatch.clientName,
        clientPhone: effectivePatch.clientPhone,
        note: effectivePatch.note,

        // legacy mirrors (بعض الشاشات القديمة تقرأ هذه المفاتيح)
        customerName: anyPatch.customerName,
        phone: anyPatch.phone,
        customerPhone: anyPatch.customerPhone,
        name: anyPatch.name,

        status: effectivePatch.status,
        slotId: effectivePatch.slotId,
        updatedByUid: actorSnapshot.uid || null,
        updatedByEmail: actorSnapshot.email || null,
        updatedByName: actorSnapshot.displayName || null,

        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );
  } catch {
    // ignore
  }

  if (availabilityPatchMap) {
    try {
      await applyAvailabilityPatchMap(availabilityPatchMap);
    } catch (e) {
      console.warn("[updateBookingDetails] availability_days sync failed (ignored):", e);
    }
  }

  // ✅ best-effort income sync (يعكس التعديل في الإيرادات/التقارير)
  const hasIncomePatch =
    effectivePatch.finalPrice !== undefined ||
    effectivePatch.total !== undefined ||
    effectivePatch.date !== undefined ||
    effectivePatch.paymentMethod !== undefined ||
    effectivePatch.paymentBreakdown !== undefined ||
    effectivePatch.paymentType !== undefined ||
    effectivePatch.paidAmount !== undefined ||
    effectivePatch.remainingAmount !== undefined ||
    effectivePatch.status !== undefined ||
    effectivePatch.clientName !== undefined ||
    effectivePatch.clientPhone !== undefined ||
    effectivePatch.serviceName !== undefined ||
    effectivePatch.serviceSnapshot !== undefined ||
    effectivePatch.employeeName !== undefined ||
    effectivePatch.note !== undefined;

  if (hasIncomePatch) {
    try {
      const incomeRefs = new Map<string, any>();
      const primaryIncomeRef = doc(db, ...INCOME_COL, bookingId);
      const primaryIncomeSnap = await getDoc(primaryIncomeRef);
      let existingIncomeDate = "";
      if (primaryIncomeSnap.exists()) {
        existingIncomeDate = String((primaryIncomeSnap.data() as any)?.date || "").trim();
      }
      if (primaryIncomeSnap.exists()) incomeRefs.set(primaryIncomeRef.id, primaryIncomeRef);
      const linkedIncomeQ = query(collection(db, ...INCOME_COL), where("bookingId", "==", bookingId));
      const linkedIncomeSnap = await getDocs(linkedIncomeQ);
      linkedIncomeSnap.docs.forEach((d) => {
        if (!existingIncomeDate) {
          existingIncomeDate = String((d.data() as any)?.date || "").trim();
        }
        incomeRefs.set(d.id, d.ref);
      });

      const freshSnap = await getDoc(bookingRef);
      const freshBooking = freshSnap.exists() ? normalizeBooking(freshSnap.data()) : null;
      const freshStatus = String(freshBooking?.status || "").toLowerCase().trim() as BookingStatus;
      const shouldKeepIncome =
        (freshStatus === "confirmed" || freshStatus === "completed") &&
        Number(getAmount((freshBooking || {}) as BookingDoc) || 0) > 0;

      if (!shouldKeepIncome) {
        if (incomeRefs.size > 0) {
          await Promise.all(Array.from(incomeRefs.values()).map((ref) => deleteDoc(ref)));
        }
        return;
      }

      const method = normalizePaymentMethod(
        (freshBooking as any)?.paymentMethod ?? effectivePatch.paymentMethod
      ) || "transfer";
      const bookingDateISO = normalizeISODate(freshBooking?.date);
      const serviceName = String(
        freshBooking?.serviceSnapshot?.serviceNameAtBooking ??
          freshBooking?.serviceName ??
          effectivePatch.serviceSnapshot?.serviceNameAtBooking ??
          effectivePatch.serviceName ??
          ""
      ).trim();
      const payload = stripUndefined({
        bookingId,
        amount: Number(getAmount((freshBooking || {}) as BookingDoc) || 0),
        status: freshStatus,
        method,
        paymentBreakdown: normalizePaymentBreakdown((freshBooking as any)?.paymentBreakdown),
        date: bookingDateISO || existingIncomeDate || localISODate(),
        clientName: String(freshBooking?.clientName || "").trim(),
        clientNameLower: String(freshBooking?.clientName || "").toLowerCase().trim(),
        clientPhone: String(freshBooking?.clientPhone || "").trim(),
        serviceName: serviceName || undefined,
        employeeName: String(freshBooking?.employeeName || "").trim(),
        note: paymentBreakdownIncomeNote(freshBooking) || String(freshBooking?.note || "").trim() || undefined,
        updatedAt: serverTimestamp(),
      }) as any;

      if (incomeRefs.size > 0) {
        await Promise.all(
          Array.from(incomeRefs.values()).map((ref) => setDoc(ref, payload, { merge: true }))
        );
      } else {
        await setDoc(
          primaryIncomeRef,
          {
            source: "booking",
            createdAt: serverTimestamp(),
            ...payload,
          } as any
        );
      }
    } catch (e) {
      console.error("income details sync failed (ignored):", e);
    }
  }

}

/* =========================
   TRACK READ
========================= */

export async function getTrackById(id: string) {
  if (getDataSourceFlags().useCoreD1) {
    try { return coreBookingToLegacy(await CoreBookingService.get(id)); } catch { return null; }
  }
  const snap = await getDoc(doc(db, ...TRACKS_COL, id));
  if (!snap.exists()) return null;
  return snap.data();
}

// ✅ Track by publicId (MK-xxxxx)
export async function getTrackByPublicId(publicId: string) {
  const code = String(publicId || "").trim();
  if (getDataSourceFlags().useCoreD1) {
    const rows = await CoreBookingService.list({ search: code });
    const found = rows.find((row) => row.publicId === code || row.id === code);
    return found ? coreBookingToLegacy(found) : null;
  }
  if (!code) return null;

  const q1 = query(collection(db, ...TRACKS_COL), where("publicId", "==", code), limit(1));
  const snap = await getDocs(q1);
  if (snap.empty) return null;

  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as any) };
}

/* =========================
   ✅ One-time Migration Helpers
========================= */

/**
 * ✅ Fill missing employeeKey for old bookings
 */
export async function backfillEmployeeKeys(opts?: { dryRun?: boolean; limit?: number }) {
  const dryRun = !!opts?.dryRun;
  const max = Math.max(1, Number(opts?.limit ?? 1000));

  const baseCol = collection(db, ...BOOKINGS_COL);
  const snap = await getDocs(baseCol);

  let patched = 0;

  for (const d of snap.docs) {
    if (patched >= max) break;

    const b = normalizeBooking(d.data());

    if (b.employeeKey && String(b.employeeKey).trim()) continue;

    const employeeUid = String(b.employeeUid ?? "").trim();
    const employeeId = String(b.employeeId ?? "").trim();
    const employeeName = String(b.employeeName ?? "").trim();

    const nextKey = employeeUid || employeeId || (employeeName ? safeKey(employeeName) : "");

    if (!nextKey) continue;

    patched++;

    if (!dryRun) {
      await updateDoc(doc(db, ...BOOKINGS_COL, d.id), {
        employeeKey: nextKey,
        updatedAt: serverTimestamp(),
      } as any);

      try {
        await updateDoc(doc(db, ...TRACKS_COL, d.id), {
          employeeKey: nextKey,
          updatedAt: serverTimestamp(),
        } as any);
      } catch {
        // ignore
      }
    }
  }

  return { scanned: snap.size, patched, dryRun };
}

/**
 * ✅ Backfill serviceId + snapshot for old bookings
 */
export async function backfillServiceFields(opts?: { dryRun?: boolean; limit?: number }) {
  const dryRun = !!opts?.dryRun;
  const max = Math.max(1, Number(opts?.limit ?? 1000));

  const baseCol = collection(db, ...BOOKINGS_COL);
  const snap = await getDocs(baseCol);

  let patched = 0;

  for (const d of snap.docs) {
    if (patched >= max) break;

    const b = normalizeBooking(d.data());

    const hasServiceId = !!String(b.serviceId || "").trim();
    const hasSnap = !!b.serviceSnapshot?.serviceNameAtBooking;

    if (hasServiceId && hasSnap) continue;

    const legacy = String(b.serviceName || "").trim();

    const looksLikeId =
      legacy.length >= 15 && !legacy.includes(" ") && /^[A-Za-z0-9_-]+$/.test(legacy);

    const nextServiceId = hasServiceId ? b.serviceId : looksLikeId ? legacy : undefined;

    const snapName = String(b.serviceSnapshot?.serviceNameAtBooking || "").trim() || legacy || "—";
    const snapPrice = Number(b.serviceSnapshot?.priceAtBooking ?? b.finalPrice ?? b.total ?? 0);
    const snapDur = Number(b.serviceSnapshot?.durationAtBooking ?? b.durationMin ?? 60);

    const nextSnap: ServiceSnapshot = {
      serviceNameAtBooking: snapName,
      priceAtBooking: Number.isFinite(snapPrice) ? snapPrice : 0,
      durationAtBooking: Number.isFinite(snapDur) ? snapDur : 60,
      sectionIdAtBooking: b.serviceSnapshot?.sectionIdAtBooking,
    };

    patched++;

    if (!dryRun) {
      await updateDoc(
        doc(db, ...BOOKINGS_COL, d.id),
        stripUndefined({
          serviceId: nextServiceId,
          serviceSnapshot: nextSnap,
          updatedAt: serverTimestamp(),
        }) as any
      );

      try {
        await updateDoc(
          doc(db, ...TRACKS_COL, d.id),
          stripUndefined({
            serviceId: nextServiceId,
            serviceSnapshot: nextSnap,
            updatedAt: serverTimestamp(),
          }) as any
        );
      } catch {
        // ignore
      }
    }
  }

  return { scanned: snap.size, patched, dryRun };
}

/**
 * ✅ DELETE: حذف الحجز نهائياً من Firebase
 * يقوم بحذف الحجز، التتبع، الدخل، وفك الأقفال (Slots)
 */
export async function deleteBooking(bookingId: string) {
  if (getDataSourceFlags().useCoreD1) {
    await CoreBookingService.remove(bookingId);
    return;
  }
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  // 1) الحصول على بيانات الحجز قبل الحذف لفك الأقفال
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) return; // حُذف مسبقاً
  const booking = normalizeBooking(snap.data());
  const actorSnapshot = resolveActorSnapshot({ booking });

  // 2) حذف الوثائق الأساسية
  await deleteDoc(bookingRef);
  try {
    await deleteDoc(trackRef);
  } catch { }
  try {
    await deleteDoc(incomeRef);
  } catch { }

  // 3) ✅ فك الأقفال (Slots) — مضمونة by bookingId
  await unlockSlotsByBookingId(bookingId);

  // 4) تسجيل اللوغ
  await writeBookingLog({
    bookingId,
    type: "status_changed",
    note: "تم حذف الحجز نهائياً من الداشبورد",
    actor: actorSnapshot,
    booking,
    source: resolveBookingLogSource(booking.channel),
    patch: {
      status: "deleted",
      byUid: actorSnapshot.uid || null,
      byEmail: actorSnapshot.email || null,
      byName: actorSnapshot.displayName || null,
    },
  });
}
