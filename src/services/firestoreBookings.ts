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

// ✅ read slotStep/buffer from settings/app (source of truth)
import { AppSettingsService } from "./AppSettingsService";

// ✅ for logging who did the action (best effort)
import { getAuth } from "firebase/auth";

import { writeAuditLog, type LogSource } from "./logService";
import { FirestoreReadStats } from "./firestoreReadStats";
import { normalizeBookedSlotsMap } from "./firestoreAvailabilityDays";
import { PackageOperationsService } from "./PackageOperationsService";
import { coreD1BookingDataSource } from "./bookingDataSources/coreD1BookingDataSource";
import { CoreBookingService } from "./CoreBookingService";
import { CoreAvailabilityService } from "./CoreAvailabilityService";
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
  /**
   * Canonical client id in Core D1. Internal/dashboard bookings must pass this
   * when an existing client was selected so the booking is attached to the
   * exact same account shown in the client portal.
   */
  clientId?: string | null;

  /** Firebase Auth UID for the client account, never the staff creator UID. */
  clientFirebaseUid?: string | null;

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
  discountAmount?: number;
  discountSnapshot?: any;
  paymentMethod?: BookingPaymentMethod;
  paymentBreakdown?: BookingPaymentBreakdown;
  paymentType?: BookingPaymentType;
  paidAmount?: number;
  remainingAmount?: number;
  invoiceId?: string;
  invoiceNumber?: string;

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
  source?: "firestore" | "core-d1" | string;
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
const ALLOW_OVERTIME_MIN = 0;

// ✅ Income collection
const INCOME_COL = ["salons", SALON_ID, "income"] as const;

// ✅ Counter doc for server-generated publicId
const COUNTERS_COL = ["salons", SALON_ID, "counters"] as const;
const BOOKINGS_COUNTER_DOC = "bookings";

// ✅ Booking Logs
const LOGS_COL = ["salons", SALON_ID, "booking_logs"] as const;
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function bookingReadSortMs(row: BookingDocWithId): number {
  const createdAt = (row.createdAt as any);
  const fromTimestamp =
    typeof createdAt?.toMillis === "function"
      ? Number(createdAt.toMillis())
      : typeof createdAt?.seconds === "number"
        ? Number(createdAt.seconds) * 1000
        : 0;
  const fromCreatedAtMs = Number(row.createdAtMs || 0);
  const fromDate = Date.parse(`${String(row.date || "").trim()}T${String(row.time || "00:00").trim()}:00`);
  return [fromTimestamp, fromCreatedAtMs, fromDate]
    .find((value) => Number.isFinite(value) && value > 0) || 0;
}

function sortBookingReadRows(rows: BookingDocWithId[]) {
  return [...rows].sort((a, b) => {
    const diff = bookingReadSortMs(b) - bookingReadSortMs(a);
    if (diff !== 0) return diff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

function bookingDedupeKeys(row: BookingDocWithId): string[] {
  const keys = new Set<string>();
  const id = String(row.id || "").trim();
  const publicId = String(row.publicId || "").trim().toUpperCase();
  if (id) keys.add(`id:${id}`);
  if (publicId) keys.add(`public:${publicId}`);
  return Array.from(keys);
}

function preferBookingReadRow(current: BookingDocWithId | undefined, next: BookingDocWithId) {
  if (!current) return next;
  const currentSource = String((current as any).source || "").trim();
  const nextSource = String((next as any).source || "").trim();
  if (nextSource === "core-d1" && currentSource !== "core-d1") return next;
  if (currentSource === "core-d1" && nextSource !== "core-d1") return current;
  return bookingReadSortMs(next) >= bookingReadSortMs(current) ? next : current;
}

function mergeBookingReadRows(...lists: BookingDocWithId[][]): BookingDocWithId[] {
  const byPrimaryKey = new Map<string, BookingDocWithId>();
  const aliasToPrimaryKey = new Map<string, string>();

  lists.flat().forEach((row) => {
    const keys = bookingDedupeKeys(row);
    if (!keys.length) return;
    const matchedPrimary = keys.map((key) => aliasToPrimaryKey.get(key)).find(Boolean);
    const primary = matchedPrimary || keys[0];
    byPrimaryKey.set(primary, preferBookingReadRow(byPrimaryKey.get(primary), row));
    keys.forEach((key) => aliasToPrimaryKey.set(key, primary));
  });

  return sortBookingReadRows(Array.from(byPrimaryKey.values()));
}

function scopeAllowsBooking(row: BookingDocWithId, scope?: BookingReadScope) {
  const statuses = new Set(scope?.statuses || []);
  if (statuses.size && !statuses.has(row.status)) return false;
  if (scope?.dateFrom && String(row.date || "") < scope.dateFrom) return false;
  if (scope?.dateTo && String(row.date || "") > scope.dateTo) return false;
  return true;
}

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
    discountAmount: Number(raw?.discountAmount || 0) || undefined,
    discountSnapshot: raw?.discountSnapshot || undefined,
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
  const employeeId =
    String(
      args.employeeId ||
      ""
    ).trim();

  const dateISO =
    normalizeISODate(
      args.dateISO
    ) ||
    localISODate();

  if (!employeeId) {
    throw employeeRequiredError();
  }

  const availability =
    await CoreAvailabilityService.getStaffDay({
      staffId: employeeId,
      date: dateISO,
      forceFresh: true,
    });

  const requireShowOnBooking =
    String(
      args.channel ||
      ""
    )
      .trim()
      .toLowerCase() ===
    "client";

  /*
   * Core availableForDate intentionally includes public visibility.
   * Internal/admin validation therefore uses the canonical HR booking-day
   * facts directly: active employee + dated HR schedule window + no
   * full-day leave/absence/off/no_hr_schedule reason.
   */
  const operationalForDate =
    Boolean(
      availability.active &&
      Array.isArray(
        availability.scheduleWindows
      ) &&
      availability.scheduleWindows.length > 0 &&
      !String(
        availability.unavailableReason ||
        ""
      ).trim()
    );

  const available =
    requireShowOnBooking
      ? Boolean(
          operationalForDate &&
          availability.showOnBooking
        )
      : operationalForDate;

  if (!available) {
    throw employeeUnavailableError(
      requireShowOnBooking
        ? "EMPLOYEE_NOT_PUBLICLY_BOOKABLE"
        : "EMPLOYEE_NOT_OPERATIONAL"
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
  return coreD1BookingDataSource.createBooking(data);
}

export async function createBookingGroup(data: BookingGroupInput): Promise<{ parentId: string; parentPublicId: string; itemIds: string[] }> {
  return coreD1BookingDataSource.createBookingGroup({ parent: data.parent, items: data.items });
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
  const bookingId = String(id || "").trim();
  if (!bookingId) return null;
  return { ...coreBookingToLegacy(await CoreBookingService.get(bookingId)), source: "core-d1" as const };
}

export async function markBookingViewed(bookingId: string) {
  const id = String(bookingId || "").trim();
  if (!id) throw new Error("BOOKING_ID_REQUIRED");
  await CoreAuditService.record({
    action: "booking_viewed",
    entityType: "booking",
    entityId: id,
    description: "Booking viewed from dashboard",
    source: "dashboard",
  });
}

export async function listAllBookings(): Promise<BookingDocWithId[]> {
  return listCoreBookings();
}

export type BookingReadScope = {
  statuses?: BookingStatus[];
  dateFrom?: string;
  dateTo?: string;
};

export async function listCoreBookings(scope?: BookingReadScope): Promise<BookingDocWithId[]> {
  return (await CoreBookingService.list()).map((row) => ({
    ...coreBookingToLegacy(row),
    source: "core-d1" as const,
  })).filter((row) => scopeAllowsBooking(row, scope));
}

export async function listBookings(scope?: BookingReadScope): Promise<BookingDocWithId[]> {
  return listCoreBookings(scope);
}


/** Core D1 polling watcher for all bookings. */
export function watchAllBookings(
  onData: (rows: BookingDocWithId[]) => void,
  onError?: (err: unknown) => void,
  scope?: BookingReadScope
) {
  let stopped = false;
  let loading = false;
  const loadCore = async () => {
    if (stopped || loading) return;
    loading = true;
    try {
      const rows = await listCoreBookings(scope);
      if (!stopped) onData(rows);
    } catch (error) {
      if (!stopped) onError?.(error);
    } finally {
      loading = false;
    }
  };
  void loadCore();
  const timer = globalThis.setInterval(loadCore, 8_000);
  return () => { stopped = true; globalThis.clearInterval(timer); };
}

export async function listUserBookings(userId: string) {
  return (await CoreBookingService.list({ clientId: String(userId || "").trim() })).map(coreBookingToLegacy);
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
  _employeeName?: string
): Promise<BookingDocWithId[]> {
  return (await CoreBookingService.list({ staffId: String(employeeIdOrUid || "").trim() })).map(coreBookingToLegacy);
}

export function watchEmployeeBookings(
  employeeIdOrUid: string,
  employeeName: string | undefined,
  onData: (rows: BookingDocWithId[]) => void,
  onError?: (err: unknown) => void
) {
  let stopped = false;
  const load = async () => {
    try { if (!stopped) onData(await listEmployeeBookings(employeeIdOrUid, employeeName)); }
    catch (error) { if (!stopped) onError?.(error); }
  };
  void load();
  const timer = globalThis.setInterval(load, 12_000);
  return () => { stopped = true; globalThis.clearInterval(timer); };
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
  await coreD1BookingDataSource.updateBookingStatus(bookingId, status);
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
  await coreD1BookingDataSource.updateBooking(bookingId, patch);
}

/* =========================
   TRACK READ
========================= */

export async function getTrackById(id: string) {
  const booking = await getBookingById(id);
  return booking || null;
}

// ✅ Track by publicId (MK-xxxxx)
export async function getTrackByPublicId(publicId: string) {
  const code = String(publicId || "").trim();
  if (!code) return null;
  return coreBookingToLegacy(await CoreBookingService.trackPublic(code));
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
  const id = String(bookingId || "").trim();
  if (!id) throw new Error("BOOKING_ID_REQUIRED");
  await CoreBookingService.remove(id);
}
