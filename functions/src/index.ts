// functions/src/index.ts

import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions"; // ✅ فقط لـ functions.config()

/**
 * ✅ IMPORTANT:
 * اجعل كل الـ Functions على Region واحد (عشان httpsCallable ما يتوه)
 */
setGlobalOptions({
  maxInstances: 10,
  region: "us-central1",
});

admin.initializeApp();
const db = admin.firestore();

const SALON_ID = "main";

/**
 * 🔐 مفاتيح Moyasar
 */
const MOYASAR_SECRET_KEY =
  process.env.MOYASAR_SECRET_KEY || functions.config()?.moyasar?.secret || "";

/**
 * ✅ Bootstrap Owner/Admin Emails
 */
const BOOTSTRAP_OWNER_EMAIL = "nawafaaa0@gmail.com";
const BOOTSTRAP_ADMIN_EMAIL = "nawafaaa6@gmail.com";

/**
 * Helper: Authorization header
 */
function authHeaderBasic(secret: string) {
  const token = Buffer.from(`${secret}:`).toString("base64");
  return `Basic ${token}`;
}

const RIYADH_TZ_OFFSET = "+03:00";
const AUTO_CLOSE_GRACE_MIN_DEFAULT = 30;
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type BookingDayHours = {
  enabled: boolean;
  openTime: string; // HH:MM
  closeTime: string; // HH:MM
};

type BookingHourOverride = {
  fromDate?: string;
  toDate?: string;
  mode?: "hours" | "closed";
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};

function safeTimeHHMM(value: any, fallback: string) {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function parseHHMM(value: string): { hh: number; mm: number; totalMin: number } | null {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm, totalMin: hh * 60 + mm };
}

function parseISODateYMD(value: string): { y: number; m: number; d: number } | null {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function toDateAtRiyadh(dateYMD: string, timeHHMM: string): Date | null {
  const d = parseISODateYMD(dateYMD);
  const t = parseHHMM(timeHHMM);
  if (!d || !t) return null;
  const iso = `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}T${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}:00${RIYADH_TZ_OFFSET}`;
  const out = new Date(iso);
  return Number.isFinite(out.getTime()) ? out : null;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeWeekdayList(v: any): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  const valid = new Set<WeekdayKey>(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
  const out: WeekdayKey[] = [];
  for (const item of v) {
    const day = String(item || "").trim().toLowerCase() as WeekdayKey;
    if (valid.has(day) && !out.includes(day)) out.push(day);
  }
  return out;
}

function resolveWeekdayFromISO(dateYMD: string): WeekdayKey | null {
  const d = parseISODateYMD(dateYMD);
  if (!d) return null;
  const dt = new Date(d.y, d.m - 1, d.d);
  return JS_DAY_TO_WEEKDAY[dt.getDay()] || null;
}

function resolveBookingDayHours(settingsRaw: any, dateYMD: string): BookingDayHours {
  const booking = (settingsRaw as any)?.booking || {};
  const businessHours = booking?.businessHours || {};
  const overridesRaw = Array.isArray(booking?.bookingHourOverrides)
    ? booking.bookingHourOverrides
    : [];

  const dayKey = resolveWeekdayFromISO(dateYMD) || "sat";
  const base = (businessHours as any)?.[dayKey] || {};
  const fallbackBase = { enabled: true, start: "10:00", end: "22:00" };

  let enabled = base?.enabled !== false && fallbackBase.enabled;
  let openTime = safeTimeHHMM(base?.start, fallbackBase.start);
  let closeTime = safeTimeHHMM(base?.end, fallbackBase.end);

  const overrides = overridesRaw as BookingHourOverride[];
  for (let i = overrides.length - 1; i >= 0; i--) {
    const ov = overrides[i] || {};
    const rawFrom = String(ov?.fromDate || "").trim();
    const rawTo = String(ov?.toDate || "").trim();
    if (!parseISODateYMD(rawFrom) || !parseISODateYMD(rawTo)) continue;

    const fromDate = rawFrom <= rawTo ? rawFrom : rawTo;
    const toDate = rawFrom <= rawTo ? rawTo : rawFrom;
    if (dateYMD < fromDate || dateYMD > toDate) continue;

    const includeWeekdays = normalizeWeekdayList(ov?.includeWeekdays);
    if (includeWeekdays.length && !includeWeekdays.includes(dayKey)) continue;

    const blockedWeekdays = normalizeWeekdayList(ov?.blockedWeekdays);
    const mode = String(ov?.mode || "hours").trim().toLowerCase();
    if (blockedWeekdays.includes(dayKey) || mode === "closed") {
      enabled = false;
    } else {
      enabled = true;
      openTime = safeTimeHHMM(ov?.start, openTime);
      closeTime = safeTimeHHMM(ov?.end, closeTime);
    }
    break;
  }

  return { enabled, openTime, closeTime };
}

function resolveEffectiveBookingStartAt(
  dateYMD: string,
  timeHHMM: string,
  dayHours: BookingDayHours
): Date | null {
  const startAt = toDateAtRiyadh(dateYMD, timeHHMM);
  const slot = parseHHMM(timeHHMM);
  const open = parseHHMM(dayHours.openTime);
  const close = parseHHMM(dayHours.closeTime);
  if (!startAt || !slot || !open || !close) return startAt;

  const isOvernight = open.totalMin > close.totalMin;
  if (isOvernight && slot.totalMin < close.totalMin) {
    return addDays(startAt, 1);
  }
  return startAt;
}

function resolveCloseGateAt(
  dateYMD: string,
  dayHours: BookingDayHours,
  graceMin: number
): Date | null {
  const closeAtBase = toDateAtRiyadh(dateYMD, dayHours.closeTime);
  const open = parseHHMM(dayHours.openTime);
  const close = parseHHMM(dayHours.closeTime);
  if (!closeAtBase || !open || !close) return closeAtBase;

  const isOvernight = open.totalMin > close.totalMin;
  const closeAt = isOvernight ? addDays(closeAtBase, 1) : closeAtBase;
  return new Date(closeAt.getTime() + Math.max(0, graceMin) * 60 * 1000);
}

/* =========================================================
   ✅ AUTO JOB: كل 5 دقائق
   - pending انتهى وقتها → cancelled + فك الأقفال
   - confirmed انتهى وقتها → completed
========================================================= */

export const autoCloseBookings = onSchedule(
  {
    region: "us-central1",
    schedule: "every 5 minutes",
    timeZone: "Asia/Riyadh",
  },
  async () => {
    const salonId = SALON_ID;

    const bookingsCol = db
      .collection("salons")
      .doc(salonId)
      .collection("bookings");

    const slotsCol = db
      .collection("salons")
      .doc(salonId)
      .collection("booking_slots");

    const nowMs = Date.now();

    let settingsRaw: any = {};
    try {
      const settingsSnap = await db
        .collection("salons")
        .doc(salonId)
        .collection("settings")
        .doc("app")
        .get();
      settingsRaw = settingsSnap.exists ? settingsSnap.data() || {} : {};
    } catch (e) {
      logger.warn("[autoCloseBookings] failed to read settings/app, fallback defaults", e as any);
      settingsRaw = {};
    }

    const configuredGraceMin = Number((settingsRaw as any)?.booking?.autoCloseGraceMin);
    const autoCloseGraceMin =
      Number.isFinite(configuredGraceMin) && configuredGraceMin >= 0
        ? Math.trunc(configuredGraceMin)
        : AUTO_CLOSE_GRACE_MIN_DEFAULT;

    const [pendingSnap, confirmedSnap] = await Promise.all([
      bookingsCol.where("status", "==", "pending").limit(500).get(),
      bookingsCol.where("status", "==", "confirmed").limit(500).get(),
    ]);

    const getDurationMin = (b: any) => {
      const d1 = Number(b?.durationMin ?? 0);
      const d2 = Number(b?.serviceSnapshot?.durationAtBooking ?? 0);
      const d =
        Number.isFinite(d1) && d1 > 0
          ? d1
          : Number.isFinite(d2) && d2 > 0
          ? d2
          : 60;
      return Math.max(0, Math.trunc(d));
    };

    const getBufferMin = (b: any) => {
      const v = Number(b?.bufferMinAtBooking ?? 0);
      return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
    };

    const toCancel: string[] = [];
    const toComplete: string[] = [];

    const scan = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
      for (const docSnap of docs) {
        const b = docSnap.data() || {};
        const bookingDate = String(b.date || "").trim();
        const bookingTime = String(b.time || "").trim();
        if (!parseISODateYMD(bookingDate) || !parseHHMM(bookingTime)) continue;

        const dayHours = resolveBookingDayHours(settingsRaw, bookingDate);
        const start = resolveEffectiveBookingStartAt(bookingDate, bookingTime, dayHours);
        if (!start) continue;

        const endAt = new Date(
          start.getTime() +
            (getDurationMin(b) + getBufferMin(b)) * 60 * 1000
        );
        const closeGateAt = resolveCloseGateAt(
          bookingDate,
          dayHours,
          autoCloseGraceMin
        );
        const readyAtMs = Math.max(
          endAt.getTime(),
          closeGateAt?.getTime() || 0
        );

        if (nowMs < readyAtMs) continue;

        const st = String(b.status || "");
        if (st === "pending") toCancel.push(docSnap.id);
        if (st === "confirmed") toComplete.push(docSnap.id);
      }
    };

    scan(pendingSnap.docs);
    scan(confirmedSnap.docs);

    if (!toCancel.length && !toComplete.length) return;

    // 1) تحديث الحالات
    const batch = db.batch();

    for (const id of toCancel) {
      batch.update(bookingsCol.doc(id), {
        status: "cancelled",
        updatedAt: FieldValue.serverTimestamp(),
        autoClosedAt: FieldValue.serverTimestamp(),
        autoCloseReason: "pending_expired",
      });
    }

    for (const id of toComplete) {
      batch.update(bookingsCol.doc(id), {
        status: "completed",
        updatedAt: FieldValue.serverTimestamp(),
        autoClosedAt: FieldValue.serverTimestamp(),
        autoCloseReason: "confirmed_finished",
      });
    }

    await batch.commit();

    // 2) فك الأقفال للملغي فقط (cancelled)
    for (const id of toCancel) {
      const q = await slotsCol.where("bookingId", "==", id).get();
      if (q.empty) continue;

      const b2 = db.batch();
      q.docs.forEach((d) => b2.delete(d.ref));
      await b2.commit();
    }

    logger.info("[autoCloseBookings] done", {
      cancelled: toCancel.length,
      completed: toComplete.length,
      graceMin: autoCloseGraceMin,
    });
  }
);

/**
 * ===========================
 * ✅ Custom Claims (Roles)
 * ===========================
 */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client";
const ALLOWED_ROLES: UiRole[] = ["owner", "admin", "reception", "staff", "client"];

function normalizeRole(x: any): UiRole | "guest" {
  const r = String(x || "").toLowerCase().trim();
  return (ALLOWED_ROLES as string[]).includes(r) ? (r as UiRole) : "guest";
}

async function getCallerRole(uid: string): Promise<UiRole | "guest"> {
  const u = await admin.auth().getUser(uid);
  return normalizeRole((u.customClaims as any)?.role);
}

/**
 * ✅ helper: check bootstrap emails
 */
function isBootstrapEmail(email: string) {
  const e = String(email || "").toLowerCase().trim();
  return (
    e === BOOTSTRAP_OWNER_EMAIL.toLowerCase() ||
    e === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
  );
}

/**
 * ===========================
 * ✅ Callable: setUserRole
 * - يحدّث Custom Claims
 * - يكتب في salons/main/users/{uid} (Source of Truth)
 * ===========================
 */
export const setUserRole = onCall({ region: "us-central1" }, async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");

  const callerUid = auth.uid;
  const callerUser = await admin.auth().getUser(callerUid);
  const callerEmail = String(callerUser.email || "").toLowerCase().trim();

  const uid = String((request.data as any)?.uid || "").trim();
  const roleRaw = String((request.data as any)?.role || "").trim().toLowerCase();

  if (!uid || !roleRaw) {
    throw new HttpsError("invalid-argument", "uid و role مطلوبة.");
  }

  if (!ALLOWED_ROLES.includes(roleRaw as UiRole)) {
    throw new HttpsError("invalid-argument", "role غير مسموحة.");
  }

  const role = roleRaw as UiRole;
  const callerRole = await getCallerRole(callerUid);

  // ✅ السماح بالـ bootstrap owner يثبت نفسه owner مرة واحدة
  const isBootstrapOwner =
    callerEmail === BOOTSTRAP_OWNER_EMAIL.toLowerCase() &&
    uid === callerUid &&
    role === "owner";

  // ✅ غير كذا: فقط owner يقدر يعيّن أدوار
  if (!isBootstrapOwner && callerRole !== "owner") {
    throw new HttpsError("permission-denied", "غير مصرح. فقط Owner يقدر يعيّن الأدوار.");
  }

  // 1) Claims
  await admin.auth().setCustomUserClaims(uid, { role });

  // 2) Firestore (Source of Truth)
  await db
    .collection("salons")
    .doc(SALON_ID)
    .collection("users")
    .doc(uid)
    .set(
      {
        uid,
        role,
        active: true,
        roleUpdatedAt: FieldValue.serverTimestamp(),
        roleUpdatedBy: callerUid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, uid, role };
});

/**
 * ✅ Callable: whoAmI
 */
export const whoAmI = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");
  const u = await admin.auth().getUser(request.auth.uid);
  return {
    uid: u.uid,
    email: u.email || "",
    role: normalizeRole((u.customClaims as any)?.role),
  };
});

/**
 * ✅ Webhook: Moyasar → Firebase (HTTP)
 * ✅ تم توحيد المسار على salons/main/bookings
 */
export const moyasarWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    const body = req.body;
    logger.info("Moyasar Webhook Received", body);

    const eventType = String(body?.type || body?.event || "");
    const payment = body?.data || body?.payment || body;

    const paymentId = String(payment?.id || "");
    const status = String(payment?.status || "");
    const bookingId = String(payment?.metadata?.bookingId || "");

    if (!bookingId) {
      logger.warn("Webhook without bookingId");
      res.status(200).send("ok");
      return;
    }

    const isPaid =
      eventType === "payment_paid" || status === "paid" || status === "captured";

    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("bookings")
      .doc(bookingId)
      .set(
        {
          bookingId,
          paymentId,
          paymentStatus: isPaid ? "paid" : "pending",
          paymentProvider: "moyasar",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    logger.info(`Booking ${bookingId} updated → ${isPaid ? "PAID" : "PENDING"}`);
    res.status(200).send("ok");
  } catch (err) {
    logger.error("Webhook error", err);
    res.status(200).send("ok");
  }
});

export const verifyMoyasarPayment = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    const { bookingId, paymentId } = req.body;

    if (!bookingId || !paymentId || !MOYASAR_SECRET_KEY) {
      res.status(400).json({ ok: false, reason: "missing_params_or_secret" });
      return;
    }

    const r = await fetch(`https://api.moyasar.com/v1/payments/${paymentId}`, {
      headers: { Authorization: authHeaderBasic(MOYASAR_SECRET_KEY) },
    });

    const data = await r.json();
    const status = String(data?.status || "");
    const paid = status === "paid" || status === "captured";

    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("bookings")
      .doc(bookingId)
      .set(
        {
          bookingId,
          paymentId,
          paymentStatus: paid ? "paid" : "pending",
          paymentProvider: "moyasar",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    res.json({ ok: true, paid, status });
  } catch (err) {
    logger.error("Verify payment error", err);
    res.status(500).json({ ok: false });
  }
});

/**
 * ===========================
 * ✅ Booking Tracking (booking_tracks)
 * ✅ تم توحيد المسار على salons/main/booking_tracks
 * ===========================
 */
async function upsertTrack(bookingId: string, bookingData: any) {
  if (!bookingId) return;

  await db
    .collection("salons")
    .doc(SALON_ID)
    .collection("booking_tracks")
    .doc(bookingId)
    .set(
      {
        bookingId,
        serviceName: String(bookingData?.serviceName || bookingData?.service || "-"),
        employeeName: String(bookingData?.employeeName || bookingData?.employee || "-"),
        date: String(bookingData?.date || "-"),
        time: String(bookingData?.time || "-"),
        status: String(bookingData?.status || "pending"),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: bookingData?.createdAt ? bookingData.createdAt : FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

// ✅ نلغّي root bookings tracking لأن النظام صار رسميًا على salons/main/bookings فقط
// export const onBookingCreateTrack = onDocumentCreated(
//   { document: "bookings/{bookingId}", region: "us-central1" },
//   async (event) => {
//     const bookingId = event.params.bookingId;
//     const snap = event.data;
//     if (!snap) return;
//     await upsertTrack(bookingId, snap.data());
//   }
// );

// export const onBookingUpdateTrack = onDocumentUpdated(
//   { document: "bookings/{bookingId}", region: "us-central1" },
//   async (event) => {
//     const bookingId = event.params.bookingId;
//     const after = event.data?.after;
//     if (!after) return;
//     await upsertTrack(bookingId, after.data());
//   }
// );

// ✅ salons bookings
export const onSalonBookingCreateTrack = onDocumentCreated(
  { document: "salons/{salonId}/bookings/{bookingId}", region: "us-central1" },
  async (event) => {
    const bookingId = event.params.bookingId;
    const snap = event.data;
    if (!snap) return;
    await upsertTrack(bookingId, snap.data());
  }
);

export const onSalonBookingUpdateTrack = onDocumentUpdated(
  { document: "salons/{salonId}/bookings/{bookingId}", region: "us-central1" },
  async (event) => {
    const bookingId = event.params.bookingId;
    const after = event.data?.after;
    if (!after) return;
    await upsertTrack(bookingId, after.data());
  }
);

/* =========================================================
   ✅ Callable: adminCreateStaffUser
========================================================= */

type StaffCreateRole = "staff" | "reception" | "admin";

export const adminCreateStaffUser = onCall({ region: "us-central1" }, async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");

  const callerUid = auth.uid;
  const caller = await admin.auth().getUser(callerUid);
  const callerEmail = String(caller.email || "").toLowerCase().trim();

  const callerRole = await getCallerRole(callerUid);
  const isBootstrap = isBootstrapEmail(callerEmail);

  if (!isBootstrap && callerRole !== "owner" && callerRole !== "admin") {
    throw new HttpsError("permission-denied", "غير مصرح. فقط Owner/Admin.");
  }

  const data: any = request.data || {};
  const email = String(data.email || "").trim().toLowerCase();
  const password = String(data.password || "").trim();
  const displayName = String(data.displayName || "").trim();
  const phone = String(data.phone || "").trim();
  const roleRaw = String(data.role || "staff").trim().toLowerCase();

  const allowedCreateRoles: StaffCreateRole[] = ["staff", "reception", "admin"];
  const role: StaffCreateRole = allowedCreateRoles.includes(roleRaw as any)
    ? (roleRaw as StaffCreateRole)
    : "staff";

  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "البريد غير صحيح.");
  if (!password || password.length < 6)
    throw new HttpsError("invalid-argument", "كلمة المرور 6 أحرف على الأقل.");
  if (!displayName) throw new HttpsError("invalid-argument", "الاسم مطلوب.");

  // 1) create auth user
  let created: admin.auth.UserRecord;
  try {
    created = await admin.auth().createUser({
      email,
      password,
      displayName,
      disabled: false,
    });
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    if (msg.includes("email") || msg.includes("already")) {
      throw new HttpsError("already-exists", "هذا الإيميل موجود مسبقاً.");
    }
    throw new HttpsError("internal", "تعذر إنشاء المستخدم.");
  }

  const uid = created.uid;

  // 2) set custom claims
  const claimRole: UiRole =
    role === "admin" ? "admin" : role === "reception" ? "reception" : "staff";

  await admin.auth().setCustomUserClaims(uid, { role: claimRole });

  // 3) salons/main/users/{uid}
  await db
    .collection("salons")
    .doc(SALON_ID)
    .collection("users")
    .doc(uid)
    .set(
      {
        uid,
        email,
        displayName,
        name: displayName,
        phone: phone || "",
        role: claimRole,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
      },
      { merge: true }
    );

  // 4) staff_public
  const specialties = Array.isArray(data.specialties)
    ? data.specialties.map((x: any) => String(x).trim()).filter(Boolean)
    : [];

  const bio = String(data.bio || "").trim();

  if (role === "staff") {
    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("staff_public")
      .doc(uid)
      .set(
        {
          name: displayName,
          email,
          phone: phone || "",
          role: "staff",
          isActive: true,
          active: true,
          specialties,
          bio,
          showOnAbout: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: callerUid,
        },
        { merge: true }
      );
  } else {
    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("staff_public")
      .doc(uid)
      .set(
        {
          name: displayName,
          email,
          phone: phone || "",
          role, // reception/admin
          isActive: true,
          active: true,
          showOnAbout: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  return { ok: true, uid, email, role: claimRole, displayName };
});

/* =========================================================
   booking_slots -> availability_days (write-through index)
   هدفها: تقليل fallback إلى booking_slots في صفحات الحجز.
========================================================= */

function tryParseBookingSlotId(slotId: string): { dateISO: string; time: string; employeeId: string } | null {
  const raw = String(slotId || "").trim();
  if (!raw) return null;
  const parts = raw.split("__");
  if (parts.length < 4) return null;
  const dateISO = String(parts[1] || "").trim();
  const time = String(parts[2] || "").trim();
  const employeeId = String(parts[3] || "").trim();
  if (!dateISO || !time || !employeeId) return null;
  return { dateISO, time, employeeId };
}

async function rebuildAvailabilityDayEmployeeFromBookingSlots(args: {
  salonId: string;
  dateISO: string;
  employeeId: string;
  employeeKeyHint?: string;
}) {
  const salonId = String(args.salonId || "").trim();
  const dateISO = String(args.dateISO || "").trim();
  const employeeId = String(args.employeeId || "").trim();
  const employeeKeyHint = String(args.employeeKeyHint || "").trim();

  if (!salonId || !dateISO || !employeeId) return;

  const slotsCol = db.collection("salons").doc(salonId).collection("booking_slots");
  const snaps: FirebaseFirestore.QuerySnapshot[] = [];

  snaps.push(await slotsCol.where("employeeId", "==", employeeId).where("date", "==", dateISO).get());

  // Legacy fallback: if employeeId path yields nothing, try employeeKey (only if different).
  if (employeeKeyHint && employeeKeyHint !== employeeId && (snaps[0]?.size || 0) === 0) {
    snaps.push(await slotsCol.where("employeeKey", "==", employeeKeyHint).where("date", "==", dateISO).get());
  }

  const times = new Set<string>();
  let resolvedEmployeeKey = employeeKeyHint || employeeId;

  snaps.forEach((snap) => {
    snap.docs.forEach((d) => {
      const sd: any = d.data() || {};
      const t = String(sd?.time || "").trim();
      if (t) times.add(t);
      if (!resolvedEmployeeKey) resolvedEmployeeKey = String(sd?.employeeKey || "").trim();
    });
  });

  const bookedSlots: Record<string, true> = {};
  times.forEach((t) => {
    const k = String(t || "").trim();
    if (k) bookedSlots[k] = true;
  });

  const availabilityRef = db
    .collection("salons")
    .doc(salonId)
    .collection("availability_days")
    .doc(dateISO)
    .collection("employees")
    .doc(employeeId);

  await availabilityRef.set(
    {
      date: dateISO,
      employeeId,
      employeeKey: resolvedEmployeeKey || employeeId,
      bookedSlots,
      complete: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export const onBookingSlotCreatedUpdateAvailabilityDay = onDocumentCreated(
  {
    document: "salons/{salonId}/booking_slots/{slotId}",
    region: "us-central1",
    retry: true,
  },
  async (event) => {
    const salonId = String(event.params.salonId || "").trim();
    const slotId = String(event.params.slotId || "").trim();
    const data: any = event.data?.data() || {};

    const parsed = tryParseBookingSlotId(slotId);
    const dateISO = String(data?.date || parsed?.dateISO || "").trim();
    const time = String(data?.time || parsed?.time || "").trim();
    const employeeId = String(data?.employeeId || parsed?.employeeId || "").trim();
    const employeeKey = String(data?.employeeKey || employeeId).trim();

    if (!salonId || !dateISO || !employeeId) return;

    const availabilityRef = db
      .collection("salons")
      .doc(salonId)
      .collection("availability_days")
      .doc(dateISO)
      .collection("employees")
      .doc(employeeId);

    // Fast path: if doc already trusted, update incrementally (no query).
    try {
      const aSnap = await availabilityRef.get();
      const a: any = aSnap.exists ? aSnap.data() || {} : {};
      if (aSnap.exists && a?.complete === true && time) {
        await availabilityRef.update({
          date: dateISO,
          employeeId,
          employeeKey,
          complete: true,
          [`bookedSlots.${time}`]: true,
          updatedAt: FieldValue.serverTimestamp(),
        } as any);
        return;
      }
    } catch (e) {
      logger.warn(
        "[onBookingSlotCreatedUpdateAvailabilityDay] availability read/update failed, fallback rebuild",
        e as any
      );
    }

    await rebuildAvailabilityDayEmployeeFromBookingSlots({
      salonId,
      dateISO,
      employeeId,
      employeeKeyHint: employeeKey,
    });
  }
);

export const onBookingSlotDeletedUpdateAvailabilityDay = onDocumentDeleted(
  {
    document: "salons/{salonId}/booking_slots/{slotId}",
    region: "us-central1",
    retry: true,
  },
  async (event) => {
    const salonId = String(event.params.salonId || "").trim();
    const slotId = String(event.params.slotId || "").trim();
    const data: any = event.data?.data() || {};

    const parsed = tryParseBookingSlotId(slotId);
    const dateISO = String(data?.date || parsed?.dateISO || "").trim();
    const time = String(data?.time || parsed?.time || "").trim();
    const employeeId = String(data?.employeeId || parsed?.employeeId || "").trim();
    const employeeKey = String(data?.employeeKey || employeeId).trim();

    if (!salonId || !dateISO || !employeeId) return;

    const availabilityRef = db
      .collection("salons")
      .doc(salonId)
      .collection("availability_days")
      .doc(dateISO)
      .collection("employees")
      .doc(employeeId);

    // Fast path: if doc already trusted, update incrementally (no query).
    try {
      const aSnap = await availabilityRef.get();
      const a: any = aSnap.exists ? aSnap.data() || {} : {};
      if (aSnap.exists && a?.complete === true && time) {
        await availabilityRef.update({
          date: dateISO,
          employeeId,
          employeeKey,
          complete: true,
          [`bookedSlots.${time}`]: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        } as any);
        return;
      }
    } catch (e) {
      logger.warn(
        "[onBookingSlotDeletedUpdateAvailabilityDay] availability read/update failed, fallback rebuild",
        e as any
      );
    }

    await rebuildAvailabilityDayEmployeeFromBookingSlots({
      salonId,
      dateISO,
      employeeId,
      employeeKeyHint: employeeKey,
    });
  }
);

/* =========================================================
   ✅ Callable: adminBackfillAvailabilityDaysFromBookingSlots
   - Runs on server (Admin SDK) to bypass Firestore rules safely.
   - Writes `complete=true` + `bookedSlots` + `updatedAt`.
   - Optionally creates empty docs for staff to minimize fallback.
========================================================= */

function toUTCDate(ymd: { y: number; m: number; d: number }) {
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
}

function formatISODateUTC(dt: Date) {
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function listISODateRangeInclusive(fromISO: string, toISO: string, maxDays: number) {
  const from = parseISODateYMD(fromISO);
  const to = parseISODateYMD(toISO);
  if (!from || !to) throw new Error("INVALID_DATE_RANGE");

  const start = toUTCDate(from);
  const end = toUTCDate(to);
  if (start.getTime() > end.getTime()) throw new Error("INVALID_DATE_RANGE");

  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < maxDays + 1; i++) {
    const iso = formatISODateUTC(cur);
    out.push(iso);
    if (iso === toISO) break;
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }

  if (out[out.length - 1] !== toISO) {
    throw new Error("DATE_RANGE_TOO_LARGE");
  }

  return out;
}

export const adminBackfillAvailabilityDaysFromBookingSlots = onCall(
  { region: "us-central1", timeoutSeconds: 3600, memory: "1GiB", maxInstances: 1 },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");

    const callerUid = auth.uid;
    const callerUser = await admin.auth().getUser(callerUid);
    const callerEmail = String(callerUser.email || "").toLowerCase().trim();
    const callerRole = await getCallerRole(callerUid);
    const isBootstrap = isBootstrapEmail(callerEmail);

    if (!isBootstrap && !["owner", "admin", "reception"].includes(callerRole)) {
      throw new HttpsError("permission-denied", "غير مصرح. فقط Owner/Admin/Reception.");
    }

    const data: any = request.data || {};
    const salonId = String(data?.salonId || SALON_ID).trim() || SALON_ID;
    const fromDateISO = String(data?.fromDateISO || "").trim();
    const toDateISO = String(data?.toDateISO || "").trim();
    const dryRun = !!data?.dryRun;

    const maxDays = Math.max(1, Number(data?.maxDays ?? 200));
    const includeEmptyEmployees =
      data?.includeEmptyEmployees === false ? false : true; // default true

    if (!fromDateISO || !toDateISO) {
      throw new HttpsError("invalid-argument", "fromDateISO و toDateISO مطلوبة (YYYY-MM-DD).");
    }

    let dates: string[] = [];
    try {
      dates = listISODateRangeInclusive(fromDateISO, toDateISO, maxDays);
    } catch (e: any) {
      const code = String(e?.message || "");
      throw new HttpsError(
        "invalid-argument",
        code === "DATE_RANGE_TOO_LARGE"
          ? `نطاق الأيام كبير. maxDays=${maxDays}`
          : "نطاق التاريخ غير صحيح."
      );
    }

    const startedAtMs = Date.now();
    logger.info("[adminBackfillAvailabilityDaysFromBookingSlots] start", {
      salonId,
      fromDateISO,
      toDateISO,
      days: dates.length,
      includeEmptyEmployees,
      dryRun,
      callerUid,
      callerRole,
    });

    // Load staff_public once so we can create empty availability docs and set employeeKey consistently.
    const staffById = new Map<string, { employeeKey: string }>();
    if (includeEmptyEmployees) {
      try {
        const staffSnap = await db
          .collection("salons")
          .doc(salonId)
          .collection("staff_public")
          .get();
        staffSnap.docs.forEach((d) => {
          const employeeId = String(d.id || "").trim();
          if (!employeeId) return;
          const sd: any = d.data() || {};
          const linkedUid = String(sd?.linkedUid || "").trim();
          staffById.set(employeeId, { employeeKey: linkedUid || employeeId });
        });
      } catch (e) {
        logger.warn("[adminBackfillAvailabilityDaysFromBookingSlots] staff_public load failed", e as any);
      }
    }

    let totalSlotDocs = 0;
    let totalAvailabilityDocs = 0;
    let daysProcessed = 0;

    if (!dryRun) {
      // Batch writes (safety: 500 ops per batch).
    }

    let batch = db.batch();
    let ops = 0;

    const commitIfNeeded = async () => {
      if (dryRun) return;
      if (ops <= 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    for (const dateISO of dates) {
      const slotsCol = db.collection("salons").doc(salonId).collection("booking_slots");
      const snap = await slotsCol.where("date", "==", dateISO).get();
      totalSlotDocs += snap.size;

      const timesByEmployeeId = new Map<string, { employeeKey: string; times: Set<string> }>();

      snap.docs.forEach((d) => {
        const sd: any = d.data() || {};
        const employeeId = String(sd?.employeeId ?? "").trim();
        const employeeKey = String(sd?.employeeKey ?? "").trim();
        const time = String(sd?.time || "").trim();
        if (!employeeId || !time) return;

        const fromStaff = staffById.get(employeeId);
        const entry =
          timesByEmployeeId.get(employeeId) || {
            employeeKey: employeeKey || fromStaff?.employeeKey || employeeId,
            times: new Set<string>(),
          };
        entry.times.add(time);
        if (employeeKey) entry.employeeKey = employeeKey;
        timesByEmployeeId.set(employeeId, entry);
      });

      if (includeEmptyEmployees) {
        for (const [employeeId, info] of staffById.entries()) {
          const existing = timesByEmployeeId.get(employeeId);
          if (!existing) {
            timesByEmployeeId.set(employeeId, { employeeKey: info.employeeKey, times: new Set<string>() });
          } else if (!existing.employeeKey) {
            existing.employeeKey = info.employeeKey;
          }
        }
      }

      if (!timesByEmployeeId.size) {
        daysProcessed++;
        continue;
      }

      totalAvailabilityDocs += timesByEmployeeId.size;
      daysProcessed++;

      if (dryRun) continue;

      for (const [employeeId, entry] of timesByEmployeeId.entries()) {
        const bookedSlots: Record<string, true> = {};
        entry.times.forEach((t) => {
          const k = String(t || "").trim();
          if (k) bookedSlots[k] = true;
        });

        const ref = db
          .collection("salons")
          .doc(salonId)
          .collection("availability_days")
          .doc(dateISO)
          .collection("employees")
          .doc(employeeId);

        batch.set(
          ref,
          {
            date: dateISO,
            employeeId,
            employeeKey: entry.employeeKey || employeeId,
            bookedSlots,
            complete: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        ops++;

        if (ops >= 450) {
          await commitIfNeeded();
        }
      }
    }

    await commitIfNeeded();

    const finishedAtMs = Date.now();
    const result = {
      ok: true,
      salonId,
      fromDateISO,
      toDateISO,
      daysRequested: dates.length,
      daysProcessed,
      includeEmptyEmployees,
      dryRun,
      totalSlotDocs,
      totalAvailabilityDocs,
      durationMs: finishedAtMs - startedAtMs,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
    };

    logger.info("[adminBackfillAvailabilityDaysFromBookingSlots] done", result);
    return result;
  }
);
