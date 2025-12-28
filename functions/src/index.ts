// functions/src/index.ts

import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions"; // ✅ فقط لـ functions.config()

setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();
const db = admin.firestore();

/**
 * 🔐 مفاتيح Moyasar
 */
const MOYASAR_SECRET_KEY =
  process.env.MOYASAR_SECRET_KEY || functions.config()?.moyasar?.secret || "";

/**
 * ✅ Bootstrap Owner Email (مرة واحدة فقط)
 */
const BOOTSTRAP_OWNER_EMAIL = "nawafaaa0@gmail.com";

/**
 * Helper: Authorization header
 */
function authHeaderBasic(secret: string) {
  const token = Buffer.from(`${secret}:`).toString("base64");
  return `Basic ${token}`;
}

/**
 * ===========================
 * ✅ Custom Claims (Roles)
 * ===========================
 */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client";
const ALLOWED_ROLES: UiRole[] = ["owner", "admin", "reception", "staff", "client"];

async function getCallerRole(uid: string): Promise<UiRole | "guest"> {
  const u = await admin.auth().getUser(uid);
  const r = (u.customClaims?.role as string) || "guest";
  return (ALLOWED_ROLES as string[]).includes(r) ? (r as UiRole) : "guest";
}

export const setUserRole = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");

  const callerUid = auth.uid;
  const callerUser = await admin.auth().getUser(callerUid);
  const callerEmail = (callerUser.email || "").toLowerCase();

  const uid = String((request.data as any)?.uid || "").trim();
  const role = String((request.data as any)?.role || "").trim().toLowerCase();

  if (!uid || !role) throw new HttpsError("invalid-argument", "uid و role مطلوبة.");
  if (!ALLOWED_ROLES.includes(role as UiRole))
    throw new HttpsError("invalid-argument", "role غير مسموحة.");

  const callerRole = await getCallerRole(callerUid);

  const isBootstrapOwner =
    callerEmail === BOOTSTRAP_OWNER_EMAIL.toLowerCase() &&
    uid === callerUid &&
    role === "owner";

  if (!isBootstrapOwner && callerRole !== "owner") {
    throw new HttpsError("permission-denied", "غير مصرح. فقط Owner يقدر يعيّن الأدوار.");
  }

  await admin.auth().setCustomUserClaims(uid, { role });

  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        role,
        roleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        roleUpdatedBy: callerUid,
      },
      { merge: true }
    );

  return { ok: true, uid, role };
});

export const whoAmI = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");
  const u = await admin.auth().getUser(request.auth.uid);
  return {
    uid: u.uid,
    email: u.email || "",
    role: (u.customClaims?.role as string) || "guest",
  };
});

/**
 * ✅ Webhook: Moyasar → Firebase
 */
export const moyasarWebhook = onRequest(async (req, res) => {
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
      .collection("bookings")
      .doc(bookingId)
      .set(
        {
          bookingId,
          paymentId,
          paymentStatus: isPaid ? "paid" : "pending",
          paymentProvider: "moyasar",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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

export const verifyMoyasarPayment = onRequest(async (req, res) => {
  try {
    const { bookingId, paymentId } = req.body;

    if (!bookingId || !paymentId || !MOYASAR_SECRET_KEY) {
      res.status(400).json({ ok: false, reason: "missing_params_or_secret" });
      return;
    }

    const r = await fetch(`https://api.moyasar.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: authHeaderBasic(MOYASAR_SECRET_KEY),
      },
    });

    const data = await r.json();
    const status = String(data?.status || "");
    const paid = status === "paid" || status === "captured";

    await db
      .collection("bookings")
      .doc(bookingId)
      .set(
        {
          bookingId,
          paymentId,
          paymentStatus: paid ? "paid" : "pending",
          paymentProvider: "moyasar",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
 * ===========================
 * ✅ trackId = نفس bookingId (docId)
 * ✅ نكتب/نحدّث تلقائيًا سواء كان الحجز في:
 *   1) /bookings/{bookingId}
 *   2) /salons/{salonId}/bookings/{bookingId}
 */

async function upsertTrack(bookingId: string, bookingData: any) {
  if (!bookingId) return;

  await db
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // نخلي createdAt ما ينمسح إذا كان موجود
        createdAt: bookingData?.createdAt
          ? bookingData.createdAt
          : admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

// ✅ (A) إذا الحجز في root: /bookings/{bookingId}
export const onBookingCreateTrack = onDocumentCreated(
  "bookings/{bookingId}",
  async (event) => {
    const bookingId = event.params.bookingId;
    const snap = event.data;
    if (!snap) return;

    await upsertTrack(bookingId, snap.data());
  }
);

export const onBookingUpdateTrack = onDocumentUpdated(
  "bookings/{bookingId}",
  async (event) => {
    const bookingId = event.params.bookingId;
    const after = event.data?.after;
    if (!after) return;

    await upsertTrack(bookingId, after.data());
  }
);

// ✅ (B) إذا الحجز داخل salons: /salons/{salonId}/bookings/{bookingId}
export const onSalonBookingCreateTrack = onDocumentCreated(
  "salons/{salonId}/bookings/{bookingId}",
  async (event) => {
    const bookingId = event.params.bookingId;
    const snap = event.data;
    if (!snap) return;

    await upsertTrack(bookingId, snap.data());
  }
);

export const onSalonBookingUpdateTrack = onDocumentUpdated(
  "salons/{salonId}/bookings/{bookingId}",
  async (event) => {
    const bookingId = event.params.bookingId;
    const after = event.data?.after;
    if (!after) return;

    await upsertTrack(bookingId, after.data());
  }
);
