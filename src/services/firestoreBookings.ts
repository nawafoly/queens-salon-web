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
  limit,
} from "firebase/firestore";

// ✅ generate same time slots list used by Booking page
import { generateSalonTimeSlots } from "../helpers/timeSlots";

// ✅ read slotStep/buffer from settings/app (source of truth)
import { AppSettingsService } from "./AppSettingsService";

// ✅ for logging who did the action (best effort)
import { getAuth } from "firebase/auth";

import { writeAuditLog } from "./logService";


export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingChannel = "client" | "dashboard" | "internal";
type BookingPaymentMethod = "cash" | "card" | "transfer";

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
};

export type BookingDoc = {
  userId?: string | null;

  slotStepMinAtBooking?: number;
  bufferMinAtBooking?: number;

  createdBy: string;
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

  // ✅ stored start-slotId (for debugging & tracking)
  slotId?: string;

  total?: number;
  finalPrice?: number;
  paymentMethod?: BookingPaymentMethod;

  status: BookingStatus;
  note?: string;
  pendingAt?: number;
  pendingByUid?: string;
  confirmedAt?: number;
  confirmedByUid?: string;
  completedAt?: number;
  completedByUid?: string;
  cancelledAt?: number;
  cancelledByUid?: string;
  paidAt?: number;
  paidByUid?: string;

  createdAt?: Timestamp;
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

function normalizeBooking(raw: any): BookingDoc {
  return {
    userId: raw?.userId ?? null,

    slotStepMinAtBooking: Number(raw?.slotStepMinAtBooking ?? 0) || undefined,
    bufferMinAtBooking: Number(raw?.bufferMinAtBooking ?? 0) || undefined,

    createdBy: String(raw?.createdBy ?? ""),
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
          serviceIds: Array.isArray(raw.packageSnapshot.serviceIds)
            ? raw.packageSnapshot.serviceIds.map((x: any) => String(x || "").trim()).filter(Boolean)
            : [],
          services: Array.isArray(raw.packageSnapshot.services)
            ? raw.packageSnapshot.services.map((x: any) => ({
                serviceId: String(x?.serviceId || "").trim(),
                serviceName: String(x?.serviceName || "").trim(),
                sectionId: String(x?.sectionId || "").trim() || undefined,
                categoryId: String(x?.categoryId || "").trim() || undefined,
                price: Number(x?.price || 0),
                durationMin: Number(x?.durationMin || 0),
              }))
            : [],
        }
      : undefined,

    durationMin: Number(raw?.durationMin ?? 0) || undefined,

    employeeId: raw?.employeeId ?? null,
    employeeUid: raw?.employeeUid ?? null,
    employeeName: String(raw?.employeeName ?? ""),

    employeeKey: raw?.employeeKey ? String(raw.employeeKey) : undefined,

    date: String(raw?.date ?? ""),
    time: String(raw?.time ?? ""),

    slotId: raw?.slotId ? String(raw.slotId) : undefined,

    total: Number(raw?.total ?? 0),
    finalPrice: Number(raw?.finalPrice ?? 0),
    paymentMethod: normalizePaymentMethod(raw?.paymentMethod) ?? undefined,

    status: raw?.status ?? "pending",
    note: raw?.note ?? undefined,
    createdAt: raw?.createdAt,
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
  return null;
}

// ✅ Helper: parse explicit payment method from note only
function parseExplicitPaymentMethod(note?: string): BookingPaymentMethod | null {
  const raw = String(note || "").trim();
  const s = raw.toLowerCase();

  // Structured markers from reception/invoice flows
  const inv = s.match(/invoice_from_reception:(cash|transfer|card)/);
  if (inv?.[1]) return inv[1] as BookingPaymentMethod;

  const pm = s.match(/payment[_\s-]?method\s*[:=]\s*(cash|transfer|card)/);
  if (pm?.[1]) return pm[1] as BookingPaymentMethod;

  // Explicit payment phrases only (avoid accidental matches in free notes)
  if (/(طريقة\s*(الدفع|السداد)\s*[:\-]?\s*(شبكة|مدى))/i.test(raw)) return "card";
  if (/(طريقة\s*(الدفع|السداد)\s*[:\-]?\s*(كاش|نقد))/i.test(raw)) return "cash";
  if (/(طريقة\s*(الدفع|السداد)\s*[:\-]?\s*(تحويل|بنكي))/i.test(raw)) return "transfer";

  // Legacy explicit tokens
  if (/\b(card|mada|pos_card|mada_online)\b/i.test(s)) return "card";
  if (/\b(cash)\b/i.test(s)) return "cash";
  if (/\b(transfer|bank)\b/i.test(s)) return "transfer";

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
  const v = Number(b.finalPrice ?? b.total ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function buildStatusAuditPatch(
  status: BookingStatus,
  nowMs: number,
  actorUid?: string
): Record<string, any> {
  const byUid = String(actorUid || "").trim() || undefined;

  if (status === "pending") return { pendingAt: nowMs, pendingByUid: byUid };
  if (status === "confirmed") return { confirmedAt: nowMs, confirmedByUid: byUid };
  if (status === "completed") {
    return {
      completedAt: nowMs,
      completedByUid: byUid,
      paidAt: nowMs,
      paidByUid: byUid,
    };
  }
  return { cancelledAt: nowMs, cancelledByUid: byUid };
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
      const fromDate = normalizeISODate(x?.fromDate);
      const toDate = normalizeISODate(x?.toDate);
      if (!fromDate || !toDate) return null;
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

  let enabled = dayHoursBase?.enabled !== false;
  let openTime = safeTimeHHMM(dayHoursBase?.start, "10:00");
  let closeTime = safeTimeHHMM(dayHoursBase?.end, "22:00");

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
        openTime = safeTimeHHMM(String(ov?.start || ""), openTime);
        closeTime = safeTimeHHMM(String(ov?.end || ""), closeTime);
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

/* =========================
   ✅ Booking Logs (Audit) - Best Effort
========================= */

function bookingEventsCol(bookingId: string) {
  return collection(db, ...LOGS_COL, bookingId, "events");
}

type BookingLogType = "created" | "status_changed" | "details_updated" | "staff_acknowledged";

async function writeBookingLog(args: {
  bookingId: string;
  type: BookingLogType;
  note?: string;
  patch?: any;
}) {
  const auth = getAuth();
  const u = auth.currentUser;
  const eventAtMs = Date.now();

  const payload = stripUndefined({
    type: args.type,
    bookingId: args.bookingId,
    byUid: u?.uid || null,
    byEmail: u?.email || null,
    note: args.note || "",
    patch: args.patch || null,
    eventAtMs,
    at: serverTimestamp(),
  }) as any;

  // ✅ map booking log types -> audit actions
  let action: string = "booking_updated";
  if (args.type === "created") action = "booking_created";
  if (args.type === "details_updated") action = "booking_updated";
  if (args.type === "staff_acknowledged") action = "booking_reassigned";
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
      source: "dashboard",
      meta: {
        bookingLogType: args.type,
        eventAtMs,
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
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch {
    // best-effort: لا نكسر تعديل الحالة
  }
}

async function lockSlotsFromBooking(bookingId: string) {
  // ✅ نقرأ الحجز ونرجع نقفل كل السلوّتات بناءً على وقت/مدة الحجز
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
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

  const employeeKeyForLock = employeeIdTrimmed;

  // ✅ employeeKey للـ staff portal = linkedUid (إن وجد) وإلا staff_public id وإلا safeKey(name)
  const employeeUidTrimmed = String(data.employeeUid ?? "").trim();
  const employeeKey =
    employeeUidTrimmed || employeeIdTrimmed || safeKey(employeeNameTrimmed || "unknown_employee");

  // ✅ duration (default)
  const durationMin = Math.max(0, Number(data.durationMin || 0)) || 60;
  const nowMs = Date.now();
  const actorUid = String(data.userId || getAuth().currentUser?.uid || "").trim() || undefined;
  const statusNow = ((data.status as BookingStatus) || "pending") as BookingStatus;
  const statusAuditPatch = buildStatusAuditPatch(statusNow, nowMs, actorUid);
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
    ...statusAuditPatch,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const shouldCreateIncomeOnCreate = statusNow === "confirmed" || statusNow === "completed";
  const incomeAmount = Number(data.finalPrice ?? data.total ?? serviceSnapshot.priceAtBooking ?? 0) || 0;
  const incomeMethod = resolvedPaymentMethod || "transfer";
  const incomeStatus = statusNow === "completed" ? "completed" : "confirmed";

  // ✅✅✅ FIX: reads before writes inside transaction
  const { bookingId, publicId } = await runTransaction(db, async (tx) => {
    // ---------- READS FIRST ----------
    const counterRef = doc(db, ...COUNTERS_COL, BOOKINGS_COUNTER_DOC);
    const counterSnap = await tx.get(counterRef);

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
          date: data.date,
          clientName: data.clientName,
          clientNameLower: String(data.clientName || "").toLowerCase(),
          clientPhone: data.clientPhone,
          serviceName: serviceSnapshot?.serviceNameAtBooking || data.serviceName,
          employeeName: data.employeeName,
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

        // legacy + new
        serviceName: data.serviceName,
        serviceId: data.serviceId ?? undefined,
        serviceSnapshot,
        packageId: data.packageId ? String(data.packageId).trim() : undefined,
        packageSnapshot: data.packageSnapshot ?? undefined,

        employeeId: data.employeeId ?? null,
        employeeUid: data.employeeUid ?? null,
        employeeName: data.employeeName,
        employeeKey,

        date: data.date,
        time: data.time,
        durationMin,
        paymentMethod: resolvedPaymentMethod,

        // ✅ NEW: خزن إعدادات السلوّت وقت الحجز
        slotStepMinAtBooking: (payloadBase as any).slotStepMinAtBooking,
        bufferMinAtBooking: (payloadBase as any).bufferMinAtBooking,

        status: data.status,
        slotId: startSlotId,
        ...statusAuditPatch,

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
    patch: {
      serviceId: data.serviceId ?? null,
      packageId: data.packageId ?? null,
      employeeId: data.employeeId ?? null,
      employeeUid: data.employeeUid ?? null,
      date: data.date,
      time: data.time,
      total: Number(data.finalPrice ?? data.total ?? 0),
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
  const actorUid = String(parent.userId || getAuth().currentUser?.uid || "").trim() || undefined;
  const status: BookingStatus = (parent.status as BookingStatus) || "pending";
  const statusAuditPatch = buildStatusAuditPatch(status, nowMs, actorUid);

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

    const payloadBase = stripUndefined({
      ...it,
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
      status,
      ...statusAuditPatch,
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
    const counterSnap = await tx.get(counterRef);

    const slotSnaps = await Promise.all(prepared.flatMap((p) => p.slotRefs).map((r) => tx.get(r)));
    for (const snap of slotSnaps) {
      if (!snap.exists()) continue;
      const sd: any = snap.data() || {};
      const bId = String(sd.bookingId || "").trim();
      if (bId) throw slotTakenError();
      throw slotTakenError();
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
      status,
      ...statusAuditPatch,
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

    return { parentPublicId };
  });

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

    status: args.status ?? "confirmed",
    note: args.note?.trim() || undefined,
  };

  return createBooking(payload);
}

/* =========================
   READ
========================= */

export async function getBookingById(id: string) {
  const snap = await getDoc(doc(db, ...BOOKINGS_COL, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...normalizeBooking(snap.data()) };
}

export async function listAllBookings(): Promise<BookingDocWithId[]> {
  const snap = await getDocs(collection(db, ...BOOKINGS_COL));
  return snap.docs
    .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
    .sort((a, b) => (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.());
}

/**
 * ✅ Realtime watcher for all bookings
 */
export function watchAllBookings(
  onData: (rows: BookingDocWithId[]) => void,
  onError?: (err: unknown) => void
) {
  const q = query(collection(db, ...BOOKINGS_COL));

  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort((a, b) => (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.());

      onData(rows);
    },
    (err) => onError?.(err)
  );
}

export async function listUserBookings(userId: string) {
  const q = query(collection(db, ...BOOKINGS_COL), where("userId", "==", userId));
  const snap = await getDocs(q);
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
  const baseCol = collection(db, ...BOOKINGS_COL);

  // primary by employeeKey (uid or safeKey or staff_public id)
  const qKey = query(baseCol, where("employeeKey", "==", employeeIdOrUid));
  const sKey = await getDocs(qKey);
  const rKey = sKey.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  // old way (employeeId)
  const q1 = query(baseCol, where("employeeId", "==", employeeIdOrUid));
  const s1 = await getDocs(q1);
  const r1 = s1.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  let r2: BookingDocWithId[] = [];
  const name = String(employeeName || "").trim();
  if (name) {
    const q2k = query(baseCol, where("employeeKey", "==", safeKey(name)));
    const s2k = await getDocs(q2k);
    const r2k = s2k.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

    const q2 = query(baseCol, where("employeeName", "==", name));
    const s2 = await getDocs(q2);
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
  const baseCol = collection(db, ...BOOKINGS_COL);

  let rowsByKeyUid: BookingDocWithId[] = [];
  let rowsById: BookingDocWithId[] = [];
  let rowsByKeyName: BookingDocWithId[] = [];
  let rowsByName: BookingDocWithId[] = [];

  const emit = () => {
    onData(uniqMerge(uniqMerge(rowsByKeyUid, rowsById), uniqMerge(rowsByKeyName, rowsByName)));
  };

  // employeeKey == uid/stable key
  const unsubKeyUid = onSnapshot(
    query(baseCol, where("employeeKey", "==", employeeIdOrUid)),
    (snap) => {
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
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const actorUid = String(getAuth().currentUser?.uid || "").trim() || undefined;
  const nowMs = Date.now();
  const statusAuditPatch = buildStatusAuditPatch(status, nowMs, actorUid);

  // ✅ ثابت: نخلي income docId = bookingId (يعطيك uniqueness تلقائي)
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  // ✅ 1) Transaction: booking + track فقط
  const txResult = await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("BOOKING_NOT_FOUND");

    const booking = normalizeBooking(snap.data());

    const resolvedPaymentMethod = resolvePaymentMethodForStatus(
      status,
      (booking as any).paymentMethod,
      booking.note
    );

    // booking
    tx.update(
      bookingRef,
      stripUndefined({
        status,
        paymentMethod: resolvedPaymentMethod,
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

        status,
        ...statusAuditPatch,
        slotId: booking.slotId ?? undefined,

        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );

    return { booking, resolvedPaymentMethod };
  });

  // ✅ booking log: status changed (best effort)
  await writeBookingLog({
    bookingId,
    type: "status_changed",
    note: `تغيير الحالة إلى: ${status}`,
    patch: { status, at: nowMs, byUid: actorUid || null },
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


  // ✅ 2) Best-effort: income خارج الترانزاكشن (ما يمنع تعديل الحجز)
  try {
    const bookingForIncome = txResult.booking;
    const resolvedPaymentMethod =
      txResult.resolvedPaymentMethod ||
      resolvePaymentMethodForStatus(status, (bookingForIncome as any).paymentMethod, bookingForIncome.note) ||
      "transfer";
    const amount = getAmount(bookingForIncome);

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

            date: bookingForIncome.date,
            clientName: bookingForIncome.clientName,
            clientPhone: bookingForIncome.clientPhone,

            serviceName:
              bookingForIncome.serviceSnapshot?.serviceNameAtBooking ||
              bookingForIncome.serviceName,

            employeeName: bookingForIncome.employeeName,

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
              status: "confirmed",
              method: resolvedPaymentMethod,
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
              updatedAt: serverTimestamp(),
            }) as any,
            { merge: true }
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

export async function updateBookingDetails(bookingId: string, patch: Partial<BookingDoc>) {
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const anyPatch = patch as any;

  // ✅ تحديث booking
  await updateDoc(
    bookingRef,
    stripUndefined({
      ...patch,
      updatedAt: serverTimestamp(),
    }) as any
  );

  // ✅ booking log: details updated (best effort)
  await writeBookingLog({
    bookingId,
    type: "details_updated",
    note: "تم تعديل بيانات الحجز",
    patch,
  });

  // ✅ best-effort track update (إذا track ناقص أو rules تمنع، لا نكسر حفظ الحجز)
  try {
    await setDoc(
      doc(db, ...TRACKS_COL, bookingId),
      stripUndefined({
        publicId: patch.publicId,

        serviceName: patch.serviceName,
        serviceId: patch.serviceId,
        serviceSnapshot: patch.serviceSnapshot,
        packageId: patch.packageId,
        packageSnapshot: patch.packageSnapshot,

        employeeId: patch.employeeId,
        employeeUid: patch.employeeUid,
        employeeName: patch.employeeName,
        employeeKey: patch.employeeKey,

        date: patch.date,
        time: patch.time,
        durationMin: patch.durationMin,
        paymentMethod: patch.paymentMethod,
        total: patch.total,
        finalPrice: patch.finalPrice,
        clientName: patch.clientName,
        clientPhone: patch.clientPhone,
        note: patch.note,

        // legacy mirrors (بعض الشاشات القديمة تقرأ هذه المفاتيح)
        customerName: anyPatch.customerName,
        phone: anyPatch.phone,
        customerPhone: anyPatch.customerPhone,
        name: anyPatch.name,

        status: patch.status,
        slotId: patch.slotId,

        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );
  } catch {
    // ignore
  }

  // ✅ best-effort income sync (يعكس التعديل في الإيرادات/التقارير)
  const hasIncomePatch =
    patch.finalPrice !== undefined ||
    patch.total !== undefined ||
    patch.date !== undefined ||
    patch.paymentMethod !== undefined ||
    patch.status !== undefined ||
    patch.clientName !== undefined ||
    patch.clientPhone !== undefined ||
    patch.serviceName !== undefined ||
    patch.serviceSnapshot !== undefined ||
    patch.employeeName !== undefined ||
    patch.note !== undefined;

  if (hasIncomePatch) {
    try {
      const incomeUpdates: Record<string, any> = {
        bookingId,
        updatedAt: serverTimestamp(),
      };

      if (patch.finalPrice !== undefined || patch.total !== undefined) {
        const amount = Number(patch.finalPrice ?? patch.total);
        if (Number.isFinite(amount) && amount >= 0) incomeUpdates.amount = amount;
      }

      const nextDate = String(patch.date || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) incomeUpdates.date = nextDate;

      if (patch.paymentMethod !== undefined) {
        const method = normalizePaymentMethod(patch.paymentMethod);
        if (method) incomeUpdates.method = method;
      }

      if (patch.status !== undefined) {
        incomeUpdates.status = patch.status;
      }

      if (patch.clientName !== undefined) {
        const name = String(patch.clientName || "").trim();
        incomeUpdates.clientName = name;
        incomeUpdates.clientNameLower = name.toLowerCase();
      }

      if (patch.clientPhone !== undefined) {
        incomeUpdates.clientPhone = String(patch.clientPhone || "").trim();
      }

      if (patch.employeeName !== undefined) {
        incomeUpdates.employeeName = String(patch.employeeName || "").trim();
      }

      const serviceName = String(
        patch.serviceSnapshot?.serviceNameAtBooking ?? patch.serviceName ?? ""
      ).trim();
      if (serviceName) incomeUpdates.serviceName = serviceName;

      if (patch.note !== undefined) {
        incomeUpdates.note = String(patch.note || "").trim();
      }

      const incomeRefs = new Map<string, any>();

      const primaryIncomeRef = doc(db, ...INCOME_COL, bookingId);
      const primaryIncomeSnap = await getDoc(primaryIncomeRef);
      if (primaryIncomeSnap.exists()) incomeRefs.set(primaryIncomeRef.id, primaryIncomeRef);

      const linkedIncomeQ = query(collection(db, ...INCOME_COL), where("bookingId", "==", bookingId));
      const linkedIncomeSnap = await getDocs(linkedIncomeQ);
      linkedIncomeSnap.docs.forEach((d) => incomeRefs.set(d.id, d.ref));

      if (incomeRefs.size > 0) {
        const payload = stripUndefined(incomeUpdates) as any;
        await Promise.all(
          Array.from(incomeRefs.values()).map((ref) => setDoc(ref, payload, { merge: true }))
        );
      }
    } catch (e) {
      console.error("income details sync failed (ignored):", e);
    }
  }

  // ✅ إذا تغيّر وقت/تاريخ/موظفة أو مدة الخدمة: أعِد مزامنة الأقفال
  const hasSlotPatch =
    patch.date !== undefined ||
    patch.time !== undefined ||
    patch.durationMin !== undefined ||
    patch.employeeId !== undefined ||
    patch.employeeUid !== undefined ||
    patch.employeeKey !== undefined ||
    patch.employeeName !== undefined ||
    patch.slotId !== undefined;

  if (hasSlotPatch) {
    try {
      const freshSnap = await getDoc(bookingRef);
      if (freshSnap.exists()) {
        const fresh = normalizeBooking(freshSnap.data());
        await unlockSlotsByBookingId(bookingId);
        if (fresh.status === "confirmed" || fresh.status === "completed") {
          await lockSlotsFromBooking(bookingId);
        }
      }
    } catch (e) {
      console.warn("[updateBookingDetails] slot resync failed (ignored):", e);
    }
  }
}

/* =========================
   TRACK READ
========================= */

export async function getTrackById(id: string) {
  const snap = await getDoc(doc(db, ...TRACKS_COL, id));
  if (!snap.exists()) return null;
  return snap.data();
}

// ✅ Track by publicId (MK-xxxxx)
export async function getTrackByPublicId(publicId: string) {
  const code = String(publicId || "").trim();
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
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  // 1) الحصول على بيانات الحجز قبل الحذف لفك الأقفال
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) return; // حُذف مسبقاً

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
  });
}
