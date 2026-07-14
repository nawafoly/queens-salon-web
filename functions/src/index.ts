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
import { buildPackageSubscriptionHandlers } from "./packageSubscriptionFunctions.js";
import { expireClientPackagesInBatches } from "./packageExpiration.js";
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
   ✅ Helpers: Legacy Booking Repair (slots + availability)
========================================================= */

type SlotSettingsLite = {
  enabled: boolean;
  openTime: string;
  closeTime: string;
  slotStepMin: number;
  bufferMin: number;
};

type BasicSlot = { value24: string; minutes: number };

function safeKey(s: string) {
  return String(s || "")
    .trim()
    .replace(/\//g, "-")
    .replace(/\s+/g, "_");
}

function buildSlotIdForRepair(salonId: string, date: string, time: string, employeeKey: string) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(employeeKey)}`;
}

function toMinutesHHMM(hhmm: string) {
  const parsed = parseHHMM(hhmm);
  if (!parsed) return 0;
  return parsed.totalMin;
}

function generateSalonTimeSlotsLite(
  openTime?: string,
  closeTime?: string,
  stepMinutes?: number
): BasicSlot[] {
  const open = safeTimeHHMM(openTime, "09:00");
  const close = safeTimeHHMM(closeTime, "22:00");
  const step = Math.max(1, Number(stepMinutes || 5));

  const startMin = toMinutesHHMM(open);
  const endMin = toMinutesHHMM(close);

  if (startMin === endMin) {
    return [{ value24: open, minutes: startMin }];
  }

  const slots: BasicSlot[] = [];
  const isOvernight = startMin > endMin;
  const endCursor = isOvernight ? endMin + 1440 : endMin;

  for (let t = startMin; t < endCursor; t += step) {
    const normalized = ((Math.floor(t) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mm = String(normalized % 60).padStart(2, "0");
    slots.push({ value24: `${hh}:${mm}`, minutes: normalized });
  }

  return slots;
}

function resolveSlotSettingsLite(settingsRaw: any, dateISO: string): SlotSettingsLite {
  const booking = (settingsRaw as any)?.booking || {};
  const dayHours = resolveBookingDayHours(settingsRaw, dateISO);

  const rawStep = Number(booking?.slotStepMin ?? 0);
  const slotStepMin = [5, 10, 15, 30].includes(rawStep) ? rawStep : 10;

  const rawBuffer = Number(booking?.bufferMin ?? 0);
  const bufferMin = Number.isFinite(rawBuffer) ? Math.max(0, Math.trunc(rawBuffer)) : 0;

  return {
    enabled: dayHours.enabled,
    openTime: dayHours.openTime,
    closeTime: dayHours.closeTime,
    slotStepMin,
    bufferMin,
  };
}

function getTimesToLockLite(args: {
  startTime: string;
  durationMin: number;
  slotStepMin: number;
  bufferMin: number;
  openTime: string;
  closeTime: string;
}) {
  const allSlots = generateSalonTimeSlotsLite(args.openTime, args.closeTime, args.slotStepMin);
  const s = String(args.startTime || "").trim();
  const startSlot = allSlots.find((slot) => slot.value24 === s);
  if (!startSlot) return [s || args.startTime];

  const startMin = Number(startSlot.minutes);
  const totalMin =
    Math.max(0, Number(args.durationMin || 0)) + Math.max(0, Number(args.bufferMin || 0));
  if (totalMin <= 0) return [s || args.startTime];

  const endMinRaw = startMin + totalMin;
  const endMin =
    args.slotStepMin > 0 ? Math.ceil(endMinRaw / args.slotStepMin) * args.slotStepMin : endMinRaw;

  const locked: string[] = [];
  for (const t of allSlots) {
    const m = Number(t.minutes);
    if (!Number.isFinite(m)) continue;
    if (m >= startMin && m < endMin) locked.push(t.value24);
  }

  return locked.length ? locked : [s || args.startTime];
}

function resolveBookingDurationMinLegacy(b: any) {
  const d1 = Number(b?.durationMin ?? 0);
  if (Number.isFinite(d1) && d1 > 0) return Math.trunc(d1);

  const d2 = Number(b?.serviceSnapshot?.durationAtBooking ?? 0);
  if (Number.isFinite(d2) && d2 > 0) return Math.trunc(d2);

  const d3 = Number(b?.packageSnapshot?.totalDurationMinAtBooking ?? 0);
  if (Number.isFinite(d3) && d3 > 0) return Math.trunc(d3);

  return 60;
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
type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "client";
const ALLOWED_ROLES: UiRole[] = ["owner", "admin", "hr", "reception", "staff", "client"];

function normalizeRole(x: any): UiRole | "guest" {
  const r = String(x || "").toLowerCase().trim();
  return (ALLOWED_ROLES as string[]).includes(r) ? (r as UiRole) : "guest";
}

async function getCallerRole(uid: string): Promise<UiRole | "guest"> {
  const u = await admin.auth().getUser(uid);
  const claimed = normalizeRole((u.customClaims as any)?.role);
  if (claimed !== "guest") return claimed;
  const profile = await db.collection("salons").doc(SALON_ID).collection("users").doc(uid).get();
  return profile.exists ? normalizeRole(profile.data()?.role) : "guest";
}

const packageSubscriptionHandlers = buildPackageSubscriptionHandlers({
  db,
  resolveCallerRole: getCallerRole,
  defaultSalonId: SALON_ID,
});

export const purchaseClientPackage = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.purchaseClientPackage
);

export const getMyPackageWallet = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.getMyPackageWallet
);

export const reservePackageSession = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.reservePackageSession
);

export const createPackageRedemptionBooking = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.createPackageRedemptionBooking
);

export const consumeReservedPackageSession = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.consumeReservedPackageSession
);

export const restoreReservedPackageSession = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.restoreReservedPackageSession
);

export const cancelPackageRedemptionBooking = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.cancelPackageRedemptionBooking
);

export const markPackageRedemptionNoShow = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.markPackageRedemptionNoShow
);

export const adminRestoreConsumedPackageSession = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.adminRestoreConsumedPackageSession
);

export const cancelClientPackage = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.cancelClientPackage
);

export const adjustClientPackageBalance = onCall(
  { region: "us-central1" },
  packageSubscriptionHandlers.adjustClientPackageBalance
);

export const expireClientPackages = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1", timeZone: "Asia/Riyadh" },
  async () => {
    const result = await expireClientPackagesInBatches({
      db,
      salonId: SALON_ID,
      onBatchError: (error, attempted) => logger.error("[expireClientPackages] batch failed", {
        attempted,
        error: error instanceof Error ? error.message : "unknown",
      }),
    });
    logger.info("[expireClientPackages] completed", result);
  }
);

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
  const targetUser = await admin.auth().getUser(uid);
  const targetDisplayName = String(targetUser.displayName || "").trim() || uid;
  const targetEmail = String(targetUser.email || "").toLowerCase().trim();

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

  const isEmployeeRole = ["owner", "admin", "hr", "reception", "staff"].includes(role);
  if (isEmployeeRole) {
    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("employees")
      .doc(uid)
      .set(
        {
          uid,
          linkedUid: uid,
          linkedUserId: uid,
          employeeId: uid,
          linkedEmployeeDocId: uid,
          email: targetEmail || targetUser.email || "",
          userEmail: targetEmail || targetUser.email || "",
          name: targetDisplayName,
          displayName: targetDisplayName,
          phone: String(targetUser.phoneNumber || ""),
          role,
          active: true,
          isActive: true,
          employeeProfileEnabled: true,
          showOnAbout: role === "staff",
          showOnBooking: role === "staff",
          removedFromStaff: false,
          employmentStatus: "active",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("admin_users")
      .doc(uid)
      .set(
        {
          uid,
          email: targetEmail || targetUser.email || "",
          displayName: targetDisplayName,
          phone: String(targetUser.phoneNumber || ""),
          role,
          active: true,
          employeeId: uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("staff_public")
      .doc(uid)
      .set(
        {
          name: targetDisplayName,
          email: targetEmail || targetUser.email || "",
          phone: String(targetUser.phoneNumber || ""),
          role,
          isActive: true,
          active: true,
          showOnAbout: role === "staff",
          showOnBooking: role === "staff",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

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

type StaffCreateRole = "staff" | "hr" | "reception" | "admin";

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
  const employeeId = String(data.employeeId || "").trim() || "";
  const department = String(data.department || "").trim();
  const title = String(data.title || "").trim();
  const avatarUrl = String(data.avatarUrl || "").trim();
  const employeeProfileEnabled =
    data.employeeProfileEnabled !== undefined ? !!data.employeeProfileEnabled : true;
  const showOnAbout = data.showOnAbout !== undefined ? !!data.showOnAbout : roleRaw === "staff";
  const showOnBooking =
    data.showOnBooking !== undefined ? !!data.showOnBooking : roleRaw === "staff";

  const allowedCreateRoles: StaffCreateRole[] = ["staff", "hr", "reception", "admin"];
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
  const resolvedEmployeeId = employeeId || uid;

  // 2) set custom claims
  const claimRole: UiRole =
    role === "admin" ? "admin" : role === "hr" ? "hr" : role === "reception" ? "reception" : "staff";

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
  const isEmployeeRole = ["staff", "hr", "reception", "admin"].includes(role);

  if (isEmployeeRole) {
    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("employees")
      .doc(uid)
      .set(
      {
        uid,
        linkedUid: uid,
        linkedUserId: uid,
        employeeId: resolvedEmployeeId,
        linkedEmployeeDocId: resolvedEmployeeId,
        email,
        userEmail: email,
        name: displayName,
        displayName,
        phone: phone || "",
        role: claimRole,
        active: true,
        isActive: true,
        employeeProfileEnabled,
        showOnAbout,
        showOnBooking,
        removedFromStaff: false,
        employmentStatus: "active",
        department,
        title,
        avatarUrl,
        specialties,
        bio,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
        },
        { merge: true }
      );

    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("admin_users")
      .doc(uid)
      .set(
        {
          uid,
          email,
          displayName,
          phone: phone || "",
          role: claimRole,
          active: true,
          employeeId: resolvedEmployeeId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: callerUid,
        },
        { merge: true }
      );
  }

  if (role === "staff") {
    await db
      .collection("salons")
      .doc(SALON_ID)
      .collection("staff_public")
      .doc(uid)
      .set(
        {
          employeeId: resolvedEmployeeId,
          name: displayName,
          email,
          phone: phone || "",
          role: "staff",
          isActive: true,
          active: true,
          department,
          title,
          avatarUrl,
          specialties,
          bio,
          showOnAbout,
          showOnBooking,
          employeeProfileEnabled,
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
          employeeId: resolvedEmployeeId,
          name: displayName,
          email,
          phone: phone || "",
          role, // reception/admin
          isActive: true,
          active: true,
          department,
          title,
          avatarUrl,
          showOnAbout: false,
          showOnBooking: false,
          employeeProfileEnabled,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  return { ok: true, uid, employeeId: resolvedEmployeeId, email, role: claimRole, displayName };
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

/* =========================================================
   ✅ Callable: adminRepairLegacyBookings
   - One-time repair for old bookings + booking_slots + availability_days
========================================================= */

export const adminRepairLegacyBookings = onCall(
  { region: "us-central1", timeoutSeconds: 3600, memory: "1GiB", maxInstances: 1 },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");

    const callerUid = auth.uid;
    const callerUser = await admin.auth().getUser(callerUid);
    const callerEmail = String(callerUser.email || "").toLowerCase().trim();
    const callerRole = await getCallerRole(callerUid);
    const isBootstrap = isBootstrapEmail(callerEmail);

    if (!isBootstrap && !["owner", "admin"].includes(callerRole)) {
      throw new HttpsError("permission-denied", "غير مصرح. فقط Owner/Admin.");
    }

    const data: any = request.data || {};
    const salonId = String(data?.salonId || SALON_ID).trim() || SALON_ID;
    const dryRun = !!data?.dryRun;
    const onlyStartTimeMismatch = data?.onlyStartTimeMismatch === false ? false : true;
    const rebuildAvailabilityDays = data?.rebuildAvailabilityDays === false ? false : true;
    const allowFullScan = !!data?.allowFullScan;
    const limit = Math.max(1, Number(data?.limit ?? 500));
    const verbose = !!data?.verbose;

    const bookingIds = Array.isArray(data?.bookingIds)
      ? data.bookingIds.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];

    const employeeIds = Array.isArray(data?.employeeIds)
      ? data.employeeIds.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];

    const dateFromISO = String(data?.dateFrom || data?.fromDateISO || "").trim();
    const dateToISO = String(data?.dateTo || data?.toDateISO || "").trim();

    let updatedFromMsRaw = Number(data?.updatedFromMs ?? NaN);
    let updatedToMsRaw = Number(data?.updatedToMs ?? NaN);
    const updatedOnDateISO = String(data?.updatedOnDateISO || "").trim();

    if (
      (!Number.isFinite(updatedFromMsRaw) || !Number.isFinite(updatedToMsRaw)) &&
      updatedOnDateISO
    ) {
      if (!parseISODateYMD(updatedOnDateISO)) {
        throw new HttpsError("invalid-argument", "updatedOnDateISO غير صحيح (YYYY-MM-DD).");
      }
      const start = toDateAtRiyadh(updatedOnDateISO, "00:00");
      if (start) {
        const end = addDays(start, 1);
        updatedFromMsRaw = start.getTime();
        updatedToMsRaw = end.getTime() - 1;
      }
    }

    const hasUpdatedRange = Number.isFinite(updatedFromMsRaw) && Number.isFinite(updatedToMsRaw);

    if ((dateFromISO && !dateToISO) || (!dateFromISO && dateToISO)) {
      throw new HttpsError("invalid-argument", "لازم dateFrom + dateTo معًا (YYYY-MM-DD).");
    }

    if ((dateFromISO || dateToISO) && (!parseISODateYMD(dateFromISO) || !parseISODateYMD(dateToISO))) {
      throw new HttpsError("invalid-argument", "dateFrom/dateTo غير صحيحة (YYYY-MM-DD).");
    }

    if ((Number.isFinite(updatedFromMsRaw) && !Number.isFinite(updatedToMsRaw)) ||
        (!Number.isFinite(updatedFromMsRaw) && Number.isFinite(updatedToMsRaw))) {
      throw new HttpsError("invalid-argument", "updatedFromMs و updatedToMs لازم يكونوا معًا.");
    }

    const hasHardFilter =
      bookingIds.length > 0 ||
      (dateFromISO && dateToISO) ||
      hasUpdatedRange ||
      employeeIds.length > 0;

    if (!hasHardFilter && !allowFullScan) {
      throw new HttpsError(
        "invalid-argument",
        "لازم تحدد نطاق آمن: bookingIds أو date range أو updatedAt range أو employeeIds. أو allowFullScan=true."
      );
    }

    const bookingsCol = db.collection("salons").doc(salonId).collection("bookings");
    const slotsCol = db.collection("salons").doc(salonId).collection("booking_slots");

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
      logger.warn("[adminRepairLegacyBookings] failed to read settings/app, fallback defaults", e as any);
      settingsRaw = {};
    }

    const startedAtMs = Date.now();
    logger.info("[adminRepairLegacyBookings] start", {
      salonId,
      dryRun,
      onlyStartTimeMismatch,
      rebuildAvailabilityDays,
      allowFullScan,
      limit,
      bookingIdsCount: bookingIds.length,
      employeeIdsCount: employeeIds.length,
      dateFromISO,
      dateToISO,
      updatedOnDateISO: updatedOnDateISO || undefined,
      updatedFromMs: hasUpdatedRange ? updatedFromMsRaw : undefined,
      updatedToMs: hasUpdatedRange ? updatedToMsRaw : undefined,
      callerUid,
      callerRole,
    });

    let candidates: FirebaseFirestore.QueryDocumentSnapshot[] = [];

    if (bookingIds.length > 0) {
      const refs = bookingIds.map((id: string) => bookingsCol.doc(id));
      const snaps = await db.getAll(...refs);
      candidates = snaps.filter((s) => s.exists) as FirebaseFirestore.QueryDocumentSnapshot[];
    } else {
      if (hasUpdatedRange && (dateFromISO || dateToISO)) {
        throw new HttpsError(
          "invalid-argument",
          "اختر نطاق واحد فقط: date range أو updatedAt range."
        );
      }

      if (hasUpdatedRange) {
        const from = admin.firestore.Timestamp.fromMillis(updatedFromMsRaw);
        const to = admin.firestore.Timestamp.fromMillis(updatedToMsRaw);
        const snap = await bookingsCol.where("updatedAt", ">=", from).where("updatedAt", "<=", to).limit(limit).get();
        candidates = snap.docs;
      } else if (dateFromISO && dateToISO) {
        const snap = await bookingsCol.where("date", ">=", dateFromISO).where("date", "<=", dateToISO).limit(limit).get();
        candidates = snap.docs;
      } else if (employeeIds.length > 0) {
        if (employeeIds.length <= 10) {
          const snap = await bookingsCol.where("employeeId", "in", employeeIds.slice(0, 10)).limit(limit).get();
          candidates = snap.docs;
        } else {
          throw new HttpsError(
            "invalid-argument",
            "employeeIds أكبر من 10 بدون نطاق تاريخ. أضف date range أو قلّل العدد."
          );
        }
      } else if (allowFullScan) {
        const snap = await bookingsCol.limit(limit).get();
        candidates = snap.docs;
      }
    }

    let scanned = 0;
    let processed = 0;
    let matched = 0;

    let timePatched = 0;
    let slotIdPatched = 0;
    let slotDocsScanned = 0;
    let slotsDeleted = 0;
    let slotsCreated = 0;
    let slotsUpdated = 0;
    let slotsKept = 0;
    let skippedByMismatch = 0;
    let skippedNoTime = 0;
    let skippedNoEmployee = 0;
    let skippedNoDate = 0;
    let skippedNoSlots = 0;

    const availabilityPairs = new Map<string, { dateISO: string; employeeId: string; employeeKey: string }>();
    const sampleBookingIds: string[] = [];

    let batch = db.batch();
    let ops = 0;

    const commitIfNeeded = async () => {
      if (dryRun) return;
      if (ops <= 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    for (const docSnap of candidates) {
      if (processed >= limit) break;
      scanned++;

      const bookingId = String(docSnap.id || "").trim();
      const b: any = docSnap.data() || {};

      const bookingDate = String(b?.date || "").trim();
      const employeeId = String(b?.employeeId ?? "").trim();
      const status = String(b?.status || "").trim().toLowerCase();

      if (employeeIds.length > 0 && employeeId && !employeeIds.includes(employeeId)) continue;
      if (employeeIds.length > 0 && !employeeId) continue;

      if (dateFromISO && dateToISO && bookingDate) {
        if (bookingDate < dateFromISO || bookingDate > dateToISO) continue;
      }

      if (hasUpdatedRange) {
        const updatedAt: any = b?.updatedAt;
        const updatedAtMs =
          typeof updatedAt?.toMillis === "function"
            ? updatedAt.toMillis()
            : Number(updatedAt?.seconds ?? NaN) * 1000;
        if (!Number.isFinite(updatedAtMs)) continue;
        if (updatedAtMs < updatedFromMsRaw || updatedAtMs > updatedToMsRaw) continue;
      }

      const timeRaw = String(b?.time ?? "").trim();
      const startRaw = String(b?.startTime ?? "").trim();
      const timeNorm = safeTimeHHMM(timeRaw, "");
      const startNorm = safeTimeHHMM(startRaw, "");
      const canonicalTime = timeNorm || startNorm;

      const needsTimeFix =
        !!canonicalTime &&
        (!timeRaw || !startRaw || timeRaw !== startRaw || timeNorm !== timeRaw || startNorm !== startRaw);

      if (onlyStartTimeMismatch && !needsTimeFix) {
        skippedByMismatch++;
        continue;
      }

      processed++;
      matched++;
      if (sampleBookingIds.length < 20 && bookingId) sampleBookingIds.push(bookingId);

      if (verbose) {
        logger.info("[adminRepairLegacyBookings] booking", {
          bookingId,
          bookingDate,
          employeeId,
          status,
          timeRaw,
          startRaw,
          canonicalTime,
        });
      }

      const bookingPatch: any = {};
      let patchedTimeFields = false;

      if (needsTimeFix && canonicalTime) {
        if (timeRaw !== canonicalTime) {
          bookingPatch.time = canonicalTime;
          patchedTimeFields = true;
        }
        if (startRaw !== canonicalTime) {
          bookingPatch.startTime = canonicalTime;
          patchedTimeFields = true;
        }
      }

      if (canonicalTime && bookingDate && employeeId) {
        const nextSlotId = buildSlotIdForRepair(salonId, bookingDate, canonicalTime, employeeId);
        if (nextSlotId && String(b?.slotId || "").trim() !== nextSlotId) {
          bookingPatch.slotId = nextSlotId;
        }
      }

      const hasBookingPatch = Object.keys(bookingPatch).length > 0;
      if (hasBookingPatch) {
        bookingPatch.updatedAt = FieldValue.serverTimestamp();
        if (!dryRun) {
          batch.update(bookingsCol.doc(bookingId), bookingPatch);
          ops++;
        }
        if (patchedTimeFields) timePatched++;
        if (bookingPatch.slotId) slotIdPatched++;
      }

      // ----- booking_slots repair -----
      const shouldHaveSlots = status !== "cancelled";
      const hasDate = !!bookingDate && !!parseISODateYMD(bookingDate);
      const hasTime = !!canonicalTime && !!parseHHMM(canonicalTime);
      const hasEmployee = !!employeeId;

      const canComputeSlots = shouldHaveSlots && hasDate && hasTime && hasEmployee;

      if (!hasDate) skippedNoDate++;
      if (!hasEmployee) skippedNoEmployee++;
      if (!hasTime) skippedNoTime++;

      const slotsSnap = await slotsCol.where("bookingId", "==", bookingId).get();
      slotDocsScanned += slotsSnap.size;

      const existingIds = new Set<string>();
      const existingById = new Map<string, any>();
      slotsSnap.docs.forEach((d) => {
        existingIds.add(d.id);
        existingById.set(d.id, d);
      });

      if (!shouldHaveSlots) {
        // cancelled: delete any existing locks
        for (const d of slotsSnap.docs) {
          if (!dryRun) {
            batch.delete(d.ref);
            ops++;
          }
          slotsDeleted++;
        }

        if (hasDate && hasEmployee) {
          const key = `${bookingDate}__${employeeId}`;
          const employeeKeyHint =
            String(b?.employeeKey || "").trim() ||
            String(b?.employeeUid || "").trim() ||
            employeeId;
          availabilityPairs.set(key, { dateISO: bookingDate, employeeId, employeeKey: employeeKeyHint });
        }

        await commitIfNeeded();
        continue;
      }

      if (!canComputeSlots) {
        skippedNoSlots++;
        await commitIfNeeded();
        continue;
      }

      const slotSettings = resolveSlotSettingsLite(settingsRaw, bookingDate);
      const slotStepMin = [5, 10, 15, 30].includes(Number(b?.slotStepMinAtBooking))
        ? Number(b?.slotStepMinAtBooking)
        : slotSettings.slotStepMin;
      const bufferMin = Number.isFinite(Number(b?.bufferMinAtBooking))
        ? Math.max(0, Math.trunc(Number(b?.bufferMinAtBooking)))
        : slotSettings.bufferMin;
      const durationMin = resolveBookingDurationMinLegacy(b);

      const timesToLockRaw = getTimesToLockLite({
        startTime: canonicalTime,
        durationMin,
        slotStepMin,
        bufferMin,
        openTime: slotSettings.openTime,
        closeTime: slotSettings.closeTime,
      });

      const timesToLock = Array.from(
        new Set(timesToLockRaw.map((t) => String(t || "").trim()).filter(Boolean))
      );

      const employeeKey =
        String(b?.employeeKey || "").trim() ||
        String(b?.employeeUid || "").trim() ||
        employeeId ||
        safeKey(String(b?.employeeName || "unknown_employee"));

      const correctSlotById = new Map<string, string>();
      timesToLock.forEach((t) => {
        const slotId = buildSlotIdForRepair(salonId, bookingDate, t, employeeId);
        correctSlotById.set(slotId, t);
      });

      // delete stale slots
      for (const [id, docAny] of existingById.entries()) {
        if (!correctSlotById.has(id)) {
          if (!dryRun) {
            batch.delete((docAny as any).ref);
            ops++;
          }
          slotsDeleted++;
        }
      }

      // update existing correct slots if needed
      for (const [id, expectedTime] of correctSlotById.entries()) {
        if (!existingIds.has(id)) continue;
        const docAny: any = existingById.get(id);
        const sd: any = docAny?.data?.() || {};

        const needsUpdate =
          String(sd?.time || "").trim() !== expectedTime ||
          String(sd?.startTime || "").trim() !== canonicalTime ||
          String(sd?.date || "").trim() !== bookingDate ||
          String(sd?.employeeId ?? "").trim() !== employeeId ||
          String(sd?.employeeKey ?? "").trim() !== employeeKey;

        if (needsUpdate) {
          if (!dryRun) {
            batch.set(
              docAny.ref,
              {
                bookingId,
                employeeId: b?.employeeId ?? null,
                employeeUid: b?.employeeUid ?? null,
                employeeName: String(b?.employeeName || ""),
                employeeKey,
                date: bookingDate,
                time: expectedTime,
                startTime: canonicalTime,
                durationMin,
                userId: b?.userId ?? null,
                clientPhone: String(b?.clientPhone || ""),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            ops++;
          }
          slotsUpdated++;
        } else {
          slotsKept++;
        }
      }

      // create missing correct slots
      for (const [id, expectedTime] of correctSlotById.entries()) {
        if (existingIds.has(id)) continue;
        if (!dryRun) {
          batch.set(
            slotsCol.doc(id),
            {
              bookingId,
              employeeId: b?.employeeId ?? null,
              employeeUid: b?.employeeUid ?? null,
              employeeName: String(b?.employeeName || ""),
              employeeKey,
              date: bookingDate,
              time: expectedTime,
              startTime: canonicalTime,
              durationMin,
              userId: b?.userId ?? null,
              clientPhone: String(b?.clientPhone || ""),
              createdAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          ops++;
        }
        slotsCreated++;
      }

      if (hasDate && hasEmployee) {
        const key = `${bookingDate}__${employeeId}`;
        availabilityPairs.set(key, { dateISO: bookingDate, employeeId, employeeKey });
      }

      await commitIfNeeded();
    }

    await commitIfNeeded();

    let availabilityRebuilt = 0;
    if (rebuildAvailabilityDays) {
      if (dryRun) {
        availabilityRebuilt = availabilityPairs.size;
      } else {
        for (const entry of availabilityPairs.values()) {
          await rebuildAvailabilityDayEmployeeFromBookingSlots({
            salonId,
            dateISO: entry.dateISO,
            employeeId: entry.employeeId,
            employeeKeyHint: entry.employeeKey,
          });
          availabilityRebuilt++;
        }
      }
    }

    const finishedAtMs = Date.now();
    const result = {
      ok: true,
      salonId,
      dryRun,
      onlyStartTimeMismatch,
      rebuildAvailabilityDays,
      allowFullScan,
      limit,
      dateFromISO: dateFromISO || undefined,
      dateToISO: dateToISO || undefined,
      updatedOnDateISO: updatedOnDateISO || undefined,
      updatedFromMs: hasUpdatedRange ? updatedFromMsRaw : undefined,
      updatedToMs: hasUpdatedRange ? updatedToMsRaw : undefined,
      scanned,
      processed,
      matched,
      timePatched,
      slotIdPatched,
      slotDocsScanned,
      slotsDeleted,
      slotsCreated,
      slotsUpdated,
      slotsKept,
      skippedByMismatch,
      skippedNoTime,
      skippedNoEmployee,
      skippedNoDate,
      skippedNoSlots,
      availabilityRebuilt,
      sampleBookingIds,
      durationMs: finishedAtMs - startedAtMs,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
    };

    logger.info("[adminRepairLegacyBookings] done", result);
    return result;
  }
);
