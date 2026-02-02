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
import { generateSalonTimeSlots, slotLabelToMinutes } from "../helpers/timeSlots";

// ✅ read slotStep/buffer from settings/app (source of truth)
import { AppSettingsService } from "./AppSettingsService";

// ✅ for logging who did the action (best effort)
import { getAuth } from "firebase/auth";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingChannel = "client" | "dashboard";

// ✅ NEW: Snapshot ثابت للعرض وعدم تأثر الحجوزات بتغيير الأسعار لاحقًا
export type ServiceSnapshot = {
  serviceNameAtBooking: string;
  priceAtBooking: number;
  durationAtBooking: number;
  sectionIdAtBooking?: string;
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

  status: BookingStatus;
  note?: string;

  createdAt?: Timestamp;
};

export type BookingDocWithId = BookingDoc & { id: string };

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

function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return cleaned as Partial<T>;
}

function normalizeBooking(raw: any): BookingDoc {
  return {
    userId: raw?.userId ?? null,
    createdBy: String(raw?.createdBy ?? ""),
    channel: raw?.channel === "dashboard" ? "dashboard" : "client",

    clientName: String(raw?.clientName ?? ""),
    clientPhone: String(raw?.clientPhone ?? ""),

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

// ✅ Helper: parse payment method from note
function parsePaymentMethod(note?: string): string {
  const s = String(note || "").toLowerCase();
  if (s.includes("card") || s.includes("شبكة") || s.includes("مدى")) return "card";
  if (s.includes("cash") || s.includes("كاش") || s.includes("نقد")) return "cash";
  return "cash";
}

function getAmount(b: BookingDoc): number {
  const v = Number(b.finalPrice ?? b.total ?? 0);
  return Number.isFinite(v) ? v : 0;
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

/** ✅ read slot settings safely (fallback to defaults) */
function getSlotSettings() {
  const cached = AppSettingsService.getCached() || {};
  const booking = (cached as any)?.booking || {};
  const businessHours = booking?.businessHours || {};

  // ✅ same defaults as Booking.tsx (sat currently)
  const openTime = safeTimeHHMM(businessHours?.sat?.start, "10:00");
  const closeTime = safeTimeHHMM(businessHours?.sat?.end, "22:00");

  const rawStep = safeInt(booking?.slotStepMin, 10);
  const slotStepMin = [5, 10, 15, 30].includes(rawStep) ? rawStep : 10;

  const bufferMin = Math.max(0, safeInt(booking?.bufferMin, 0));

  return { openTime, closeTime, slotStepMin, bufferMin };
}

/**
 * ✅ lock multiple time slots based on duration
 * - Uses same slots list from generateSalonTimeSlots(open, close, step)
 * - If time not found, falls back to locking only the chosen time
 */
function getTimesToLock(
  startTime: string,
  durationMin: number,
  overrides?: { slotStepMin?: number; bufferMin?: number }
) {
  const base = getSlotSettings();

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
  const startMin = slotLabelToMinutes(s);
  if (startMin == null) return [s || startTime];

  const totalMin = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));
  if (totalMin <= 0) return [s || startTime];

  const endMinRaw = startMin + totalMin;

  // ✅ نعرض أول وقت حجز متاح من بداية الدوام مباشرة (بدون منع أول سلوّت)
  // ✅ round UP to nearest slot boundary (step-based)
  const endMin =
    slotStepMin > 0
      ? Math.ceil(endMinRaw / slotStepMin) * slotStepMin
      : endMinRaw;

  const locked: string[] = [];

  // ✅ start inclusive, end exclusive
  for (const t of allSlots) {
    const m = slotLabelToMinutes(t);
    if (m == null) continue;
    if (m >= startMin && m < endMin) locked.push(t);
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
  try {
    const auth = getAuth();
    const u = auth.currentUser;

    const evRef = doc(bookingEventsCol(args.bookingId));

    await setDoc(
      evRef,
      stripUndefined({
        type: args.type,
        bookingId: args.bookingId,

        byUid: u?.uid || null,
        byEmail: u?.email || null,

        note: args.note || "",
        patch: args.patch || null,

        at: serverTimestamp(),
      }) as any
    );
  } catch {
    // best-effort: اللوق ما يكسر شغل الحجز
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

  const employeeKeyForLock = employeeIdTrimmed;

  // ✅ employeeKey للـ staff portal = linkedUid (إن وجد) وإلا staff_public id وإلا safeKey(name)
  const employeeUidTrimmed = String(data.employeeUid ?? "").trim();
  const employeeKey =
    employeeUidTrimmed || employeeIdTrimmed || safeKey(employeeNameTrimmed || "unknown_employee");

  // ✅ duration (default)
  const durationMin = Math.max(0, Number(data.durationMin || 0)) || 60;

  // ✅ times to lock (start + next slots)
  const timesToLock = getTimesToLock(
    String(data.time || "").trim(),
    durationMin,
    {
      slotStepMin: (data as any).slotStepMinAtBooking,
      bufferMin: (data as any).bufferMinAtBooking,
    }
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

  const serviceSnapshot: ServiceSnapshot = {
    serviceNameAtBooking: fallbackName || "—",
    priceAtBooking: Number.isFinite(fallbackPrice) ? fallbackPrice : 0,
    durationAtBooking: Number.isFinite(fallbackDur) ? fallbackDur : durationMin,
    sectionIdAtBooking: snapFromInput?.sectionIdAtBooking,
  };

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

    createdAt: serverTimestamp(),
  });

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

        employeeId: data.employeeId ?? null,
        employeeUid: data.employeeUid ?? null,
        employeeName: data.employeeName,
        employeeKey,

        date: data.date,
        time: data.time,
        durationMin,

        status: data.status,
        slotId: startSlotId,

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
      employeeId: data.employeeId ?? null,
      employeeUid: data.employeeUid ?? null,
      date: data.date,
      time: data.time,
      total: Number(data.finalPrice ?? data.total ?? 0),
    },
  });

  return { id: bookingId, publicId };
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
 */
export async function updateBookingStatus(bookingId: string, status: BookingStatus) {
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  // ✅ 1) Transaction: booking + track فقط
  const bookingForIncome = await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("BOOKING_NOT_FOUND");

    const booking = normalizeBooking(snap.data());

    // booking
    tx.update(
      bookingRef,
      stripUndefined({
        status,
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

        employeeId: booking.employeeId ?? null,
        employeeUid: booking.employeeUid ?? null,
        employeeName: booking.employeeName,
        employeeKey: booking.employeeKey ?? undefined,

        date: booking.date,
        time: booking.time,
        durationMin: booking.durationMin ?? undefined,

        status,
        slotId: booking.slotId ?? undefined,

        updatedAt: serverTimestamp(),
      }) as any,
      { merge: true }
    );

    // ✅ IMPORTANT: إذا صار الحجز "ملغي" لازم نفك الأقفال من booking_slots
    // لأن Booking.tsx يعتبر الوقت محجوز إذا وثيقة slot موجودة.
    if (status === "cancelled") {
      const employeeIdForLock = String(booking.employeeId ?? "").trim();

      // لو ما عندنا employeeId ما نقدر نحدد أقفال الموظفة (حماية)
      if (employeeIdForLock) {
        // ✅ نفس منطق إنشاء الأقفال (مدة + بفر + step)
        const duration =
          Number(booking.durationMin ?? booking.serviceSnapshot?.durationAtBooking ?? 0) || 60;

        const timesToUnlock = getTimesToLock(
          String(booking.time || "").trim(),
          duration,
          {
            slotStepMin: (booking as any).slotStepMinAtBooking,
            bufferMin: (booking as any).bufferMinAtBooking,
          }
        );

        const slotRefsToDelete = timesToUnlock.map((t) =>
          doc(db, ...SLOTS_COL, buildSlotId(booking.date, t, employeeIdForLock))
        );

        for (const r of slotRefsToDelete) {
          tx.delete(r);
        }
      }
    }

    return booking;
  });

  // ✅ booking log: status changed (best effort)
  await writeBookingLog({
    bookingId,
    type: "status_changed",
    note: `تغيير الحالة إلى: ${status}`,
    patch: { status },
  });

  // ✅ 2) Best-effort: income خارج الترانزاكشن (ما يمنع تعديل الحجز)
  try {
    const amount = getAmount(bookingForIncome);

    const shouldCreateIncome = status === "confirmed" || status === "completed";
    const shouldDeleteIncome = status === "pending" || status === "cancelled";

    if (shouldCreateIncome) {
      const method = parsePaymentMethod(bookingForIncome.note);

      await setDoc(
        incomeRef,
        stripUndefined({
          bookingId,
          amount,
          date: bookingForIncome.date,
          method,
          source: "booking",
          clientName: bookingForIncome.clientName,
          clientPhone: bookingForIncome.clientPhone,

          // ✅ prefer snapshot name when available
          serviceName:
            bookingForIncome.serviceSnapshot?.serviceNameAtBooking || bookingForIncome.serviceName,

          employeeName: bookingForIncome.employeeName,
          status,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        }) as any,
        { merge: true }
      );
    } else if (shouldDeleteIncome) {
      try {
        const s = await getDoc(incomeRef);
        if (s.exists()) await deleteDoc(incomeRef);
      } catch {
        // ignore
      }
    }
  } catch {
    // ✅ مهم: لا نرمي خطأ هنا عشان ما نكسر تعديل الحجز
  }
}

export async function updateBookingDetails(bookingId: string, patch: Partial<BookingDoc>) {
  // ✅ تحديث booking
  await updateDoc(
    doc(db, ...BOOKINGS_COL, bookingId),
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
    await updateDoc(
      doc(db, ...TRACKS_COL, bookingId),
      stripUndefined({
        publicId: patch.publicId,

        serviceName: patch.serviceName,
        serviceId: patch.serviceId,
        serviceSnapshot: patch.serviceSnapshot,

        employeeId: patch.employeeId,
        employeeUid: patch.employeeUid,
        employeeName: patch.employeeName,
        employeeKey: patch.employeeKey,

        date: patch.date,
        time: patch.time,
        durationMin: patch.durationMin,

        status: patch.status,
        slotId: patch.slotId,

        updatedAt: serverTimestamp(),
      }) as any
    );
  } catch {
    // ignore
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

    const looksLikeId = legacy.length >= 15 && !legacy.includes(" ") && /^[A-Za-z0-9_-]+$/.test(legacy);

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

  const booking = normalizeBooking(snap.data());

  // 2) حذف الوثائق الأساسية
  await deleteDoc(bookingRef);
  try { await deleteDoc(trackRef); } catch(e) {}
  try { await deleteDoc(incomeRef); } catch(e) {}

  // 3) فك الأقفال (Slots)
  const employeeIdForLock = String(booking.employeeId ?? "").trim();
  if (employeeIdForLock) {
    const duration = Number(booking.durationMin ?? booking.serviceSnapshot?.durationAtBooking ?? 0) || 60;
    const timesToUnlock = getTimesToLock(
      String(booking.time || "").trim(),
      duration,
      {
        slotStepMin: (booking as any).slotStepMinAtBooking,
        bufferMin: (booking as any).bufferMinAtBooking,
      }
    );

    const batch = timesToUnlock.map((t) =>
      deleteDoc(doc(db, ...SLOTS_COL, buildSlotId(booking.date, t, employeeIdForLock)))
    );
    await Promise.all(batch);
  }

  // 4) تسجيل اللوغ
  await writeBookingLog({
    bookingId,
    type: "status_changed",
    note: "تم حذف الحجز نهائياً من الداشبورد",
  });
}
