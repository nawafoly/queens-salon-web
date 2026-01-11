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
} from "firebase/firestore";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingChannel = "client" | "dashboard";

export type BookingDoc = {
  userId?: string | null;

  createdBy: string;
  channel: BookingChannel;

  clientName: string;
  clientPhone: string;

  serviceName: string;

  employeeId?: string | null;
  employeeName: string;

  date: string;
  time: string;

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

// ✅ NEW: Income collection (linked to booking by same id)
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

    // ✅ خليه null بدل undefined (أوضح + أسهل في التعامل)
    employeeId: raw?.employeeId ?? null,
    employeeName: String(raw?.employeeName ?? ""),

    date: String(raw?.date ?? ""),
    time: String(raw?.time ?? ""),

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
  return `${SALON_ID}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
}

function slotTakenError() {
  const e: any = new Error("SLOT_TAKEN");
  e.code = "SLOT_TAKEN";
  return e;
}

// ✅ Helper: parse payment method from note like "Payment: cash" / "Payment: card"
function parsePaymentMethod(note?: string): string {
  const s = String(note || "").toLowerCase();
  // Very tolerant parsing
  if (s.includes("card") || s.includes("شبكة") || s.includes("مدى")) return "card";
  if (s.includes("cash") || s.includes("كاش") || s.includes("نقد")) return "cash";
  return "cash"; // default
}

function getAmount(b: BookingDoc): number {
  const v = Number(b.finalPrice ?? b.total ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/* =========================
   CREATE
========================= */

export async function createBooking(data: BookingDoc) {
  // ✅ employeeKey: اعتمد ID إن وجد، وإلا الاسم، وتأكد ما يكون فاضي
  const employeeKeyRaw = (data.employeeId ?? "").trim() || String(data.employeeName || "").trim();
  const employeeKey = employeeKeyRaw || "unknown_employee";

  const slotId = buildSlotId(data.date, data.time, employeeKey);

  const bookingRef = doc(collection(db, ...BOOKINGS_COL));
  const slotRef = doc(db, ...SLOTS_COL, slotId);

  const payload = stripUndefined({
    ...data,
    // ✅ خلها null بدل undefined عشان تكون ثابتة في الداتا
    employeeId: (data.employeeId ?? null) as any,
    slotId,
    createdAt: serverTimestamp(),
  });

  const bookingId = await runTransaction(db, async (tx) => {
    const slotSnap = await tx.get(slotRef);

    // ✅ NEW: لو السلوّت موجود، افحص هل هو لنفس العميل (retry)؟
    if (slotSnap.exists()) {
      const slotData: any = slotSnap.data() || {};
      const existingBookingId = String(slotData.bookingId || "").trim();

      if (existingBookingId) {
        const existingBookingRef = doc(db, ...BOOKINGS_COL, existingBookingId);
        const existingBookingSnap = await tx.get(existingBookingRef);

        if (existingBookingSnap.exists()) {
          const existingBooking = normalizeBooking(existingBookingSnap.data());

          const sameUser =
            (data.userId && existingBooking.userId && data.userId === existingBooking.userId) ||
            (!data.userId &&
              String(existingBooking.clientPhone || "") === String(data.clientPhone || ""));

          const sameSlot =
            String(existingBooking.date || "") === String(data.date || "") &&
            String(existingBooking.time || "") === String(data.time || "") &&
            safeKey((existingBooking.employeeId ?? "").trim() || existingBooking.employeeName.trim()) ===
              safeKey(employeeKey);

          // ✅ إذا نفس العميل ونفس السلوّت: رجّع نفس الحجز (بدون خطأ)
          if (sameUser && sameSlot) {
            return existingBookingId;
          }
        }
      }

      // ❌ السلوّت لعميلة ثانية (أو بيانات غير متطابقة)
      throw slotTakenError();
    }

    // ✅ السلوّت فاضي: اقفله + أنشئ الحجز (Atomic)
    tx.set(slotRef, {
      bookingId: bookingRef.id,
      employeeId: data.employeeId ?? null,
      employeeName: data.employeeName,
      date: data.date,
      time: data.time,
      // ✅ NEW: نخزن معلومات العميل لتسهيل retry لاحقاً
      userId: data.userId ?? null,
      clientPhone: data.clientPhone,
      createdAt: serverTimestamp(),
    });

    tx.set(bookingRef, payload);

    return bookingRef.id;
  });

  // ✅ tracks: idempotent (merge) سواء كان جديد أو retry
  await setDoc(
    doc(db, ...TRACKS_COL, bookingId),
    {
      bookingId,
      serviceName: data.serviceName,
      employeeId: data.employeeId ?? null, // ✅ NEW (مفيد)
      employeeName: data.employeeName,
      date: data.date,
      time: data.time,
      status: data.status,
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
  employeeName: string;
  employeeId?: string | null;
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

    employeeId: args.employeeId ?? null,
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
 * يدعم onError اختياريًا (لأن DashboardBookings يستدعيه بوسيطين)
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
   STAFF (Employee) READ ✅ NEW
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

/**
 * ✅ List bookings for a single employee (Staff)
 * - Primary: employeeId == uid
 * - Fallback: employeeName == name (for old data)
 */
export async function listEmployeeBookings(
  employeeId: string,
  employeeName?: string
): Promise<BookingDocWithId[]> {
  const baseCol = collection(db, ...BOOKINGS_COL);

  // 1) by employeeId
  const q1 = query(baseCol, where("employeeId", "==", employeeId));
  const s1 = await getDocs(q1);
  const r1 = s1.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));

  // 2) fallback by employeeName (optional)
  let r2: BookingDocWithId[] = [];
  const name = String(employeeName || "").trim();
  if (name) {
    const q2 = query(baseCol, where("employeeName", "==", name));
    const s2 = await getDocs(q2);
    r2 = s2.docs.map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }));
  }

  return uniqMerge(r1, r2);
}

/**
 * ✅ Realtime watcher for staff bookings only
 * - merges two listeners (employeeId + employeeName fallback)
 */
export function watchEmployeeBookings(
  employeeId: string,
  employeeName: string | undefined,
  onData: (rows: BookingDocWithId[]) => void,
  onError?: (err: unknown) => void
) {
  const baseCol = collection(db, ...BOOKINGS_COL);

  let rowsById: BookingDocWithId[] = [];
  let rowsByName: BookingDocWithId[] = [];

  const emit = () => {
    onData(uniqMerge(rowsById, rowsByName));
  };

  // Listener 1: by employeeId
  const unsub1 = onSnapshot(
    query(baseCol, where("employeeId", "==", employeeId)),
    (snap) => {
      rowsById = snap.docs
        .map((d) => ({ id: d.id, ...normalizeBooking(d.data()) }))
        .sort(sortByCreatedAtDesc);
      emit();
    },
    (err) => onError?.(err)
  );

  // Listener 2: fallback by employeeName (optional)
  const name = String(employeeName || "").trim();
  let unsub2: (() => void) | null = null;

  if (name) {
    unsub2 = onSnapshot(
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
    unsub1?.();
    unsub2?.();
  };
}

/* =========================
   UPDATE
========================= */

/**
 * ✅ updateBookingStatus (FIXED)
 * - إذا Confirmed/Completed: ينشئ/يحدث دخل تلقائيًا داخل salons/main/income/{bookingId}
 * - إذا Pending/Cancelled: يحذف دخل الحجز (إن وجد)
 * - FIX: ممنوع tx.get بعد أي write داخل transaction
 */
export async function updateBookingStatus(bookingId: string, status: BookingStatus) {
  const bookingRef = doc(db, ...BOOKINGS_COL, bookingId);
  const trackRef = doc(db, ...TRACKS_COL, bookingId);
  const incomeRef = doc(db, ...INCOME_COL, bookingId);

  await runTransaction(db, async (tx) => {
    // ✅ READS FIRST
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) {
      throw new Error("BOOKING_NOT_FOUND");
    }

    const booking = normalizeBooking(snap.data());
    const amount = getAmount(booking);

    // ✅ اقرأ income قبل أي write (عشان لو بنحذفه)
    const incomeSnap = await tx.get(incomeRef);

    // ✅ WRITES ONLY بعد هذا السطر
    tx.update(bookingRef, { status });

    tx.set(
      trackRef,
      {
        bookingId,
        serviceName: booking.serviceName,
        employeeId: booking.employeeId ?? null, // ✅ NEW
        employeeName: booking.employeeName,
        date: booking.date,
        time: booking.time,
        status,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const shouldCreateIncome = status === "confirmed" || status === "completed";
    const shouldDeleteIncome = status === "pending" || status === "cancelled";

    if (shouldCreateIncome) {
      const method = parsePaymentMethod(booking.note);

      tx.set(
        incomeRef,
        {
          bookingId,
          amount,
          date: booking.date,
          method, // "cash" | "card" (string)
          source: "booking",
          clientName: booking.clientName,
          clientPhone: booking.clientPhone,
          serviceName: booking.serviceName,
          employeeName: booking.employeeName,
          status,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else if (shouldDeleteIncome) {
      if (incomeSnap.exists()) {
        tx.delete(incomeRef);
      }
    }
  });
}

export async function updateBookingDetails(bookingId: string, patch: Partial<BookingDoc>) {
  await updateDoc(doc(db, ...BOOKINGS_COL, bookingId), stripUndefined(patch));

  await updateDoc(
    doc(db, ...TRACKS_COL, bookingId),
    stripUndefined({
      serviceName: patch.serviceName,
      employeeId: patch.employeeId, // ✅ NEW
      employeeName: patch.employeeName,
      date: patch.date,
      time: patch.time,
      status: patch.status,
      updatedAt: serverTimestamp(),
    })
  );
}

export async function getTrackById(id: string) {
  const snap = await getDoc(doc(db, ...TRACKS_COL, id));
  if (!snap.exists()) return null;
  return snap.data();
}
