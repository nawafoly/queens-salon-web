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
  deleteDoc, // ✅ NEW
} from "firebase/firestore";

// ✅ NEW: generate same time slots list used by Booking page
import { generateSalonTimeSlots } from "../helpers/timeSlots";

// ✅ NEW: read slotStep/buffer from settings/app (source of truth)
import { AppSettingsService } from "./AppSettingsService";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingChannel = "client" | "dashboard";

export type BookingDoc = {
  userId?: string | null;

  createdBy: string;
  channel: BookingChannel;

  clientName: string;
  clientPhone: string;

  serviceName: string;

  // ✅ service duration in minutes (prevents overlaps)
  durationMin?: number;

  /**
   * employeeId = staff_public id (used for Booking UI + slot locks)
   * employeeUid = real Firebase Auth uid (used for Staff Portal linking)
   */
  employeeId?: string | null;
  employeeUid?: string | null; // ✅ NEW
  employeeName: string;

  /**
   * ✅ employeeKey is the stable linking key used to fetch employee bookings safely.
   * - Prefer UID (employeeUid)
   * - Fallback: safeKey(employeeName)
   */
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

// ✅ Income collection (linked to booking by same id)
const INCOME_COL = ["salons", SALON_ID, "income"] as const;

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

    serviceName: String(raw?.serviceName ?? ""),

    durationMin: Number(raw?.durationMin ?? 0) || undefined,

    employeeId: raw?.employeeId ?? null,
    employeeUid: raw?.employeeUid ?? null, // ✅ NEW
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

function buildSlotId(date: string, time: string, employeeKey: string) {
  return `${SALON_ID}__${safeKey(date)}__${safeKey(time)}__${safeKey(
    employeeKey
  )}`;
}

// ✅ Exported helper so Checkout can display the SAME slotId format used by Firestore lock
export function buildBookingSlotId(date: string, time: string, employeeKey: string) {
  return buildSlotId(date, time, employeeKey);
}

function slotTakenError() {
  const e: any = new Error("SLOT_TAKEN");
  e.code = "SLOT_TAKEN";
  return e;
}

// ✅ Helper: parse payment method from note like "Payment: cash" / "Payment: card"
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

/** ✅ read slot settings safely (fallback to defaults) */
function getSlotSettings() {
  const cached = AppSettingsService.getCached();
  const slotStepMin = Math.max(
    5,
    Number((cached as any)?.booking?.slotStepMin ?? 30)
  );
  const bufferMin = Math.max(
    0,
    Number((cached as any)?.booking?.bufferMin ?? 0)
  );
  return { slotStepMin, bufferMin };
}

/**
 * ✅ lock multiple time slots based on duration
 * - Uses same slots list from generateSalonTimeSlots()
 * - If time not found, falls back to locking only the chosen time
 */
function getTimesToLock(startTime: string, durationMin: number) {
  const { slotStepMin, bufferMin } = getSlotSettings();

  const slots = generateSalonTimeSlots();
  const idx = slots.indexOf(startTime);

  if (idx < 0) return [startTime];

  const totalMin =
    Math.max(0, Number(durationMin || 0)) + Math.max(0, bufferMin);
  const slotsNeeded = Math.max(1, Math.ceil(totalMin / slotStepMin));

  return slots.slice(idx, idx + slotsNeeded);
}

/* =========================
   CREATE
========================= */

export async function createBooking(data: BookingDoc) {
  // ✅ For locks: use staff_public id (employeeId) if available, otherwise name
  const employeeIdTrimmed = String(data.employeeId ?? "").trim(); // staff_public id
  const employeeNameTrimmed = String(data.employeeName || "").trim();

  // ✅ For staff portal: use real uid if available, otherwise safeKey(name)
  const employeeUidTrimmed = String(data.employeeUid ?? "").trim(); // ✅ NEW

  const employeeKeyForLock =
    employeeIdTrimmed || employeeNameTrimmed || "unknown_employee";

  // ✅ employeeKey = UID (best), fallback = safeKey(name)
  const employeeKey =
    employeeUidTrimmed || safeKey(employeeNameTrimmed || "unknown_employee");

  // ✅ duration (default)
  const durationMin = Math.max(0, Number(data.durationMin || 0)) || 60;

  // ✅ times to lock (start + next slots)
  const timesToLock = getTimesToLock(String(data.time || "").trim(), durationMin);

  // ✅ booking ref
  const bookingRef = doc(collection(db, ...BOOKINGS_COL));

  // ✅ build slot refs (LOCK DOCS)
  const slotRefs = timesToLock.map((t) =>
    doc(db, ...SLOTS_COL, buildSlotId(data.date, t, employeeKeyForLock))
  );

  // ✅ store start-slotId inside booking doc for tracking/debugging
  const startSlotId = buildSlotId(
    data.date,
    String(data.time || "").trim(),
    employeeKeyForLock
  );

  const payload = stripUndefined({
    ...data,
    employeeId: (data.employeeId ?? null) as any,
    employeeUid: (data.employeeUid ?? null) as any, // ✅ NEW
    durationMin,

    // ✅ Fix Staff Portal
    employeeKey,

    slotId: startSlotId,

    createdAt: serverTimestamp(),
  });

  const bookingId = await runTransaction(db, async (tx) => {
    const slotSnaps = await Promise.all(slotRefs.map((r) => tx.get(r)));

    let existingBookingId: string | null = null;

    for (const snap of slotSnaps) {
      if (!snap.exists()) continue;

      const sd: any = snap.data() || {};
      const bId = String(sd.bookingId || "").trim();
      if (!bId) throw slotTakenError();

      if (!existingBookingId) existingBookingId = bId;
      if (existingBookingId && bId !== existingBookingId) {
        throw slotTakenError();
      }
    }

    if (existingBookingId) {
      const existingBookingRef = doc(db, ...BOOKINGS_COL, existingBookingId);
      const existingBookingSnap = await tx.get(existingBookingRef);

      if (existingBookingSnap.exists()) {
        const existingBooking = normalizeBooking(existingBookingSnap.data());

        const sameUser =
          (data.userId &&
            existingBooking.userId &&
            data.userId === existingBooking.userId) ||
          (!data.userId &&
            String(existingBooking.clientPhone || "") ===
              String(data.clientPhone || ""));

        const sameDate =
          String(existingBooking.date || "") === String(data.date || "");
        const sameStart =
          String(existingBooking.time || "") === String(data.time || "");

        // ✅ compare by employeeKey (UID) OR same lock key
        const sameEmp =
          String(existingBooking.employeeKey || "") === String(employeeKey) ||
          safeKey(
            (existingBooking.employeeId ?? "").trim() ||
              existingBooking.employeeName.trim()
          ) === safeKey(employeeKeyForLock);

        if (sameUser && sameDate && sameStart && sameEmp) {
          return existingBookingId;
        }
      }

      throw slotTakenError();
    }

    for (let i = 0; i < slotRefs.length; i++) {
      const slotRef = slotRefs[i];
      const t = timesToLock[i];

      tx.set(slotRef, {
        bookingId: bookingRef.id,

        employeeId: data.employeeId ?? null,      // staff_public id
        employeeUid: data.employeeUid ?? null,    // ✅ NEW real uid
        employeeName: data.employeeName,

        employeeKey,

        date: data.date,
        time: t,

        startTime: data.time,
        durationMin,

        userId: data.userId ?? null,
        clientPhone: data.clientPhone,
        createdAt: serverTimestamp(),
      });
    }

    tx.set(bookingRef, payload);

    return bookingRef.id;
  });

  await setDoc(
    doc(db, ...TRACKS_COL, bookingId),
    {
      bookingId,
      serviceName: data.serviceName,

      employeeId: data.employeeId ?? null,
      employeeUid: data.employeeUid ?? null, // ✅ NEW
      employeeName: data.employeeName,

      employeeKey,

      date: data.date,
      time: data.time,
      durationMin: Math.max(0, Number(data.durationMin || 0)) || 60,
      status: data.status,

      slotId: startSlotId,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return bookingId;
}

/** ✅ إنشاء حجز من لوحة التحكم */
export async function createDashboardBooking(args: {
  createdBy: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  durationMin?: number;
  employeeName: string;
  employeeId?: string | null;   // staff_public id
  employeeUid?: string | null;  // ✅ NEW real uid
  date: string;
  time: string;
  total?: number;
  finalPrice?: number;
  status?: BookingStatus;
  note?: string;
}) {
  const payload: BookingDoc = {
    userId: null,
    createdBy: args.createdBy,
    channel: "dashboard",

    clientName: args.clientName,
    clientPhone: args.clientPhone,
    serviceName: args.serviceName,

    durationMin: args.durationMin,

    employeeId: args.employeeId ?? null,
    employeeUid: args.employeeUid ?? null, // ✅ NEW
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
    .sort(
      (a, b) =>
        (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.()
    );
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
        .sort(
          (a, b) =>
            (b.createdAt as any)?.toMillis?.() -
            (a.createdAt as any)?.toMillis?.()
        );

      onData(rows);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function listUserBookings(userId: string) {
  const q = query(collection(db, ...BOOKINGS_COL), where("userId", "==", userId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...normalizeBooking(d.data()),
  }));
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
  employeeId: string,
  employeeName?: string
): Promise<BookingDocWithId[]> {
  const baseCol = collection(db, ...BOOKINGS_COL);

  // ✅ primary query by employeeKey (UID)
  const qKey = query(baseCol, where("employeeKey", "==", employeeId));
  const sKey = await getDocs(qKey);
  const rKey = sKey.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  // old way (employeeId)
  const q1 = query(baseCol, where("employeeId", "==", employeeId));
  const s1 = await getDocs(q1);
  const r1 = s1.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  let r2: BookingDocWithId[] = [];
  const name = String(employeeName || "").trim();
  if (name) {
    // ✅ fallback by employeeKey (safeKey(name))
    const q2k = query(baseCol, where("employeeKey", "==", safeKey(name)));
    const s2k = await getDocs(q2k);
    const r2k = s2k.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

    // old fallback by name
    const q2 = query(baseCol, where("employeeName", "==", name));
    const s2 = await getDocs(q2);
    const r2n = s2.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

    r2 = uniqMerge(r2k, r2n);
  }

  return uniqMerge(uniqMerge(rKey, r1), r2);
}

export function watchEmployeeBookings(
  employeeId: string,
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
    onData(
      uniqMerge(
        uniqMerge(rowsByKeyUid, rowsById),
        uniqMerge(rowsByKeyName, rowsByName)
      )
    );
  };

  // ✅ employeeKey == uid
  const unsubKeyUid = onSnapshot(
    query(baseCol, where("employeeKey", "==", employeeId)),
    (snap) => {
      rowsByKeyUid = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort(sortByCreatedAtDesc);
      emit();
    },
    (err) => onError?.(err)
  );

  // old: employeeId == uid
  const unsubId = onSnapshot(
    query(baseCol, where("employeeId", "==", employeeId)),
    (snap) => {
      rowsById = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort(sortByCreatedAtDesc);
      emit();
    },
    (err) => onError?.(err)
  );

  const name = String(employeeName || "").trim();

  // ✅ employeeKey == safeKey(name)
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

  // old: employeeName == name
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

export async function updateBookingStatus(bookingId: string, status: BookingStatus) {
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  const bookingForIncome = await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("BOOKING_NOT_FOUND");

    const booking = normalizeBooking(snap.data());

    tx.update(bookingRef, { status });

    tx.set(
      trackRef,
      stripUndefined({
        bookingId,
        serviceName: booking.serviceName,
        employeeId: booking.employeeId ?? null,
        employeeUid: booking.employeeUid ?? null, // ✅ NEW
        employeeName: booking.employeeName,
        employeeKey: booking.employeeKey ?? undefined,
        date: booking.date,
        time: booking.time,
        durationMin: booking.durationMin ?? undefined,
        status,
        slotId: booking.slotId ?? undefined,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );

    return booking;
  });

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
          serviceName: bookingForIncome.serviceName,
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
    // ignore
  }
}

export async function updateBookingDetails(bookingId: string, patch: Partial<BookingDoc>) {
  await updateDoc(doc(db, ...BOOKINGS_COL, bookingId), stripUndefined(patch));

  try {
    await updateDoc(
      doc(db, ...TRACKS_COL, bookingId),
      stripUndefined({
        serviceName: patch.serviceName,
        employeeId: patch.employeeId,
        employeeUid: patch.employeeUid, // ✅ NEW
        employeeName: patch.employeeName,
        employeeKey: patch.employeeKey,
        date: patch.date,
        time: patch.time,
        durationMin: patch.durationMin,
        status: patch.status,
        slotId: patch.slotId,
        updatedAt: serverTimestamp(),
      })
    );
  } catch {
    // ignore
  }
}

export async function getTrackById(id: string) {
  const snap = await getDoc(doc(db, ...TRACKS_COL, id));
  if (!snap.exists()) return null;
  return snap.data();
}

/* =========================
   ✅ One-time Migration (Fix Staff visibility)
========================= */

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

    // ✅ preferred: employeeUid if exists, fallback: safeKey(name)
    const employeeUid = String(b.employeeUid ?? "").trim();
    const employeeName = String(b.employeeName ?? "").trim();

    const nextKey = employeeUid || (employeeName ? safeKey(employeeName) : "");
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
