// functions/src/index.ts

import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  onDocumentCreated,
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

    const now = new Date();

    const [pendingSnap, confirmedSnap] = await Promise.all([
      bookingsCol.where("status", "==", "pending").limit(500).get(),
      bookingsCol.where("status", "==", "confirmed").limit(500).get(),
    ]);

    const parseHHMM = (time: string) => {
      const m = String(time || "")
        .trim()
        .match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      return { hh, mm };
    };

    const toLocalDate = (dateYMD: string, timeHHMM: string) => {
      const [y, mo, d] = String(dateYMD || "").split("-").map(Number);
      const t = parseHHMM(timeHHMM);
      if (!y || !mo || !d || !t) return null;
      return new Date(y, mo - 1, d, t.hh, t.mm, 0, 0);
    };

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
        const start = toLocalDate(String(b.date || ""), String(b.time || ""));
        if (!start) continue;

        const end = new Date(
          start.getTime() +
            (getDurationMin(b) + getBufferMin(b)) * 60 * 1000
        );

        if (now < end) continue;

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
