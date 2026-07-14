import { AppError } from './errors.js';

export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "https://queens-salon-web.vercel.app",
];
export const SALES_ROLES = new Set(["owner", "admin", "reception"]);
export const ADMIN_ROLES = new Set(["owner", "admin"]);
export const PACKAGE_LIMITS = {
  documentId: 128,
  externalId: 256,
  reason: 500,
  packageName: 200,
  packageDescription: 2000,
  sessions: 1000,
  price: 1000000,
  validityDays: 3650,
  allowedServices: 100,
  serviceDurationMinutes: 12 * 60,
  adjustmentSessions: 1000,
  cancellationWindowMinutes: 7 * 24 * 60,
};
export const DEFAULT_CANCELLATION_POLICY = {
  lateCancellationWindowMinutes: 240,
  lateCancellationConsumesSession: true,
  noShowConsumesSession: true,
};

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function optionalText(value) {
  const text = cleanText(value);
  return text || undefined;
}

export function requiredDocumentId(value, field) {
  const normalized = cleanText(value);
  if (
    !normalized ||
    normalized.length > PACKAGE_LIMITS.documentId ||
    normalized.includes("/") ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new AppError(400, "package_validation:invalid_document_id", `${field} must be a valid document id`);
  }
  return normalized;
}

export function optionalDocumentId(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredDocumentId(value, field);
}

export function requiredExternalId(value, field) {
  const normalized = cleanText(value);
  if (!normalized || normalized.length > PACKAGE_LIMITS.externalId) {
    throw new AppError(400, "package_validation:invalid_external_id", `${field} is invalid`);
  }
  return normalized;
}

export function boundedText(value, field, maxLength = PACKAGE_LIMITS.reason, required = false) {
  const text = cleanText(value);
  if (!text) {
    if (required) throw new AppError(400, "package_validation:text_required", `${field} is required`);
    return undefined;
  }
  if (text.length > maxLength) {
    throw new AppError(400, "package_validation:text_too_long", `${field} is too long`);
  }
  return text;
}

export function boundedInteger(value, field, { min, max, allowZero = false }) {
  if (!Number.isInteger(value) || value < min || value > max || (!allowZero && value === 0)) {
    throw new AppError(400, "package_validation:invalid_integer", `${field} is outside the allowed range`);
  }
  return value;
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = cleanText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function normalizePaymentMethod(value) {
  const raw = cleanText(value || "cash").toLowerCase();
  if (["cash", "كاش", "نقد"].includes(raw)) return "cash";
  if (["card", "pos_card", "mada_online", "شبكة", "مدى"].includes(raw)) return "card";
  if (["transfer", "تحويل", "بنكي"].includes(raw)) return "transfer";
  if (raw === "other") return "other";
  throw new AppError(400, "package_validation:unsupported_payment_method", "Unsupported paymentMethod");
}

export function timestampNow() {
  return new Date().toISOString();
}

export function timestampMs(value) {
  if (!value) return undefined;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return undefined;
}

export function timestampFromMs(ms) {
  return new Date(ms).toISOString();
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function transactionId(type, entityId) {
  const normalized = cleanText(entityId);
  if (!normalized) throw new AppError(400, "package_validation:invalid_transaction_source");
  const safe = normalized.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "source";
  const hash = (await sha256Hex(normalized)).slice(0, 20);
  return `${type}:${safe}:${hash}`;
}

export async function stableLegacyClientId(salonId, legacyDocId) {
  const hex = await sha256Hex(`${salonId}:${legacyDocId}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildPurchasedPackageSnapshot(raw) {
  const name = cleanText(raw.name);
  if (!name || name.length > PACKAGE_LIMITS.packageName) {
    throw new AppError(400, "package_validation:invalid_catalog", "Package name is invalid");
  }
  const sessionsCount = Number(raw.sessionsCount);
  if (!Number.isInteger(sessionsCount) || sessionsCount <= 0 || sessionsCount > PACKAGE_LIMITS.sessions) {
    throw new AppError(400, "package_validation:invalid_catalog", "sessionsCount is invalid");
  }
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0 || price > PACKAGE_LIMITS.price) {
    throw new AppError(400, "package_validation:invalid_catalog", "price is invalid");
  }
  const allowedServiceIds = normalizeStringArray([
    ...(Array.isArray(raw.allowedServiceIds) ? raw.allowedServiceIds : []),
    ...(Array.isArray(raw.serviceIds) ? raw.serviceIds : []),
  ]);
  if (
    !allowedServiceIds.length ||
    allowedServiceIds.length > PACKAGE_LIMITS.allowedServices ||
    allowedServiceIds.some((id) => id.length > PACKAGE_LIMITS.documentId || id.includes("/"))
  ) {
    throw new AppError(400, "package_validation:invalid_catalog", "Package services are invalid");
  }
  const description = boundedText(raw.description, "description", PACKAGE_LIMITS.packageDescription);
  const validityRaw = raw.validityDays;
  const validityDays =
    validityRaw === undefined || validityRaw === null || validityRaw === ""
      ? undefined
      : boundedInteger(Number(validityRaw), "validityDays", { min: 1, max: PACKAGE_LIMITS.validityDays });
  return {
    name,
    ...(description ? { description } : {}),
    sessionsCount,
    price: Math.round(price * 100) / 100,
    allowedServiceIds,
    ...(validityDays ? { validityDays } : {}),
  };
}

export function derivePackageStatus(balances, nowMs) {
  if (balances.status === "cancelled") return "cancelled";
  if (balances.expiresAtMs !== undefined && balances.expiresAtMs < nowMs) return "expired";
  if (balances.remainingSessions === 0 && balances.reservedSessions === 0) return "exhausted";
  return "active";
}

export function assertBalanceInvariant(value) {
  const fields = [value.totalSessions, value.remainingSessions, value.reservedSessions, value.usedSessions];
  if (fields.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new AppError(409, "package_balance:invalid", "Package balances must be non-negative integers");
  }
  if (value.totalSessions !== value.remainingSessions + value.reservedSessions + value.usedSessions) {
    throw new AppError(409, "package_balance:invalid", "Package balance invariant failed");
  }
}

export function balancesFromDoc(raw, nowMs) {
  const rawStatus = cleanText(raw.status);
  const status = ["active", "exhausted", "expired", "cancelled"].includes(rawStatus)
    ? rawStatus
    : raw.active === false
      ? "cancelled"
      : "active";
  const normalized = {
    totalSessions: Number(raw.totalSessions || 0),
    remainingSessions: Number(raw.remainingSessions || 0),
    reservedSessions: Number(raw.reservedSessions || 0),
    usedSessions: Number(raw.usedSessions || 0),
    status,
    expiresAtMs: timestampMs(raw.expiresAt),
  };
  assertBalanceInvariant(normalized);
  normalized.status = derivePackageStatus(normalized, nowMs);
  return normalized;
}

export function finishTransition(before, draft, sessionsDelta, nowMs) {
  const after = { ...draft, status: derivePackageStatus(draft, nowMs) };
  assertBalanceInvariant(after);
  return { before, after, sessionsDelta };
}

export function reserveOneSession(raw, nowMs) {
  const before = balancesFromDoc(raw, nowMs);
  if (before.status !== "active") throw new AppError(409, "package_balance:not_active", `Package is ${before.status}`);
  if (before.remainingSessions <= 0) throw new AppError(409, "package_balance:exhausted", "No remaining sessions");
  return finishTransition(before, {
    ...before,
    remainingSessions: before.remainingSessions - 1,
    reservedSessions: before.reservedSessions + 1,
  }, -1, nowMs);
}

export function consumeOneReservedSession(raw, nowMs) {
  const before = balancesFromDoc(raw, nowMs);
  if (before.status === "cancelled") throw new AppError(409, "package_balance:cancelled");
  if (before.reservedSessions <= 0) throw new AppError(409, "package_balance:no_reserved_session");
  return finishTransition(before, {
    ...before,
    reservedSessions: before.reservedSessions - 1,
    usedSessions: before.usedSessions + 1,
  }, 0, nowMs);
}

export function restoreOneReservedSession(raw, nowMs) {
  const before = balancesFromDoc(raw, nowMs);
  if (before.status === "cancelled") throw new AppError(409, "package_balance:cancelled");
  if (before.reservedSessions <= 0) throw new AppError(409, "package_balance:no_reserved_session");
  return finishTransition(before, {
    ...before,
    reservedSessions: before.reservedSessions - 1,
    remainingSessions: before.remainingSessions + 1,
  }, 1, nowMs);
}

export function restoreOneUsedSession(raw, nowMs) {
  const before = balancesFromDoc(raw, nowMs);
  if (before.status === "cancelled") throw new AppError(409, "package_balance:cancelled");
  if (before.usedSessions <= 0) throw new AppError(409, "package_balance:no_used_session");
  return finishTransition(before, {
    ...before,
    usedSessions: before.usedSessions - 1,
    remainingSessions: before.remainingSessions + 1,
  }, 1, nowMs);
}

export function cancelPackageBalance(raw, nowMs) {
  const before = balancesFromDoc(raw, nowMs);
  if (before.reservedSessions > 0) throw new AppError(409, "package_balance:has_reservations");
  if (before.status === "cancelled") return { before, after: before, sessionsDelta: 0 };
  const after = { ...before, status: "cancelled" };
  assertBalanceInvariant(after);
  return { before, after, sessionsDelta: 0 };
}

export function adjustRemainingBalance(raw, sessionsDelta, nowMs) {
  const before = balancesFromDoc(raw, nowMs);
  if (before.status === "cancelled") throw new AppError(409, "package_balance:cancelled");
  if (!Number.isInteger(sessionsDelta) || sessionsDelta === 0) {
    throw new AppError(400, "package_validation:invalid_adjustment");
  }
  if (before.remainingSessions + sessionsDelta < 0 || before.totalSessions + sessionsDelta < 0) {
    throw new AppError(409, "package_balance:negative");
  }
  return finishTransition(before, {
    ...before,
    totalSessions: before.totalSessions + sessionsDelta,
    remainingSessions: before.remainingSessions + sessionsDelta,
  }, sessionsDelta, nowMs);
}

export function packageCandidateFromDoc(doc, nowMs) {
  const raw = doc.data || {};
  return {
    id: doc.id,
    clientId: cleanText(raw.clientId),
    allowedServiceIdsSnapshot: normalizeStringArray(raw.allowedServiceIdsSnapshot || raw.serviceIds),
    purchasedAtMs: timestampMs(raw.purchasedAt),
    ...balancesFromDoc(raw, nowMs),
  };
}

export function isEligiblePackage(candidate, clientId, serviceId, nowMs, appointmentAtMs = nowMs) {
  if (candidate.clientId !== clientId) return false;
  const balances = balancesFromDoc(candidate, nowMs);
  if (balances.status !== "active" || balances.remainingSessions <= 0) return false;
  if (candidate.expiresAtMs !== undefined && appointmentAtMs > candidate.expiresAtMs) return false;
  return normalizeStringArray(candidate.allowedServiceIdsSnapshot).includes(serviceId);
}

export function selectNearestExpiringPackage(candidates, clientId, serviceId, nowMs, appointmentAtMs = nowMs) {
  const eligible = candidates.filter((item) => isEligiblePackage(item, clientId, serviceId, nowMs, appointmentAtMs));
  eligible.sort((a, b) => {
    const expiry = (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity);
    if (expiry) return expiry;
    const purchased = (a.purchasedAtMs ?? 0) - (b.purchasedAtMs ?? 0);
    if (purchased) return purchased;
    return a.id.localeCompare(b.id);
  });
  return eligible[0] || null;
}

export function statusPatch(after, nowIso = timestampNow()) {
  return {
    totalSessions: after.totalSessions,
    remainingSessions: after.remainingSessions,
    reservedSessions: after.reservedSessions,
    usedSessions: after.usedSessions,
    status: after.status,
    updatedAt: nowIso,
  };
}

export function ledgerPayload(args, nowIso = timestampNow()) {
  return {
    clientPackageId: args.clientPackageId,
    clientId: args.clientId,
    type: args.type,
    ...(args.bookingId ? { bookingId: args.bookingId } : {}),
    ...(args.invoiceId ? { invoiceId: args.invoiceId } : {}),
    ...(args.serviceId ? { serviceId: args.serviceId } : {}),
    sessionsDelta: args.sessionsDelta,
    remainingBefore: args.before.remainingSessions,
    remainingAfter: args.after.remainingSessions,
    reservedBefore: args.before.reservedSessions,
    reservedAfter: args.after.reservedSessions,
    usedBefore: args.before.usedSessions,
    usedAfter: args.after.usedSessions,
    idempotencyKey: args.idempotencyKey,
    ...(args.reason ? { reason: args.reason } : {}),
    createdBy: args.actorUid,
    createdAt: nowIso,
  };
}

export function appointmentTimestampMs(dateISO, timeHHMM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeHHMM)) {
    throw new AppError(400, "package_booking:invalid_appointment");
  }
  const value = Date.parse(`${dateISO}T${timeHHMM}:00+03:00`);
  if (!Number.isFinite(value)) throw new AppError(400, "package_booking:invalid_appointment");
  return value;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function validTime(value, fallback) {
  const text = cleanText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

export function resolveSlotSettings(raw, dateISO) {
  const booking = raw.booking && typeof raw.booking === "object" ? raw.booking : {};
  const date = new Date(`${dateISO}T12:00:00+03:00`);
  const weekday = WEEKDAYS[date.getUTCDay()] || "sat";
  const base = booking.businessHours?.[weekday] || {};
  let enabled = base.enabled !== false;
  let openTime = validTime(base.start, "10:00");
  let closeTime = validTime(base.end, "22:00");
  const configuredStep = Number(booking.slotStepMin);
  const slotStepMin = [5, 10, 15, 30].includes(configuredStep) ? configuredStep : 10;
  const bufferMin = Math.max(0, Math.floor(Number(booking.bufferMin) || 0));
  return { enabled, openTime, closeTime, slotStepMin, bufferMin };
}

export function minutes(value) {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

export function buildLockedTimes({ settings, startTime, durationMin }) {
  if (!settings.enabled) throw new AppError(409, "package_booking:day_closed");
  const start = minutes(validTime(startTime, "invalid"));
  if (!Number.isFinite(start)) throw new AppError(400, "package_booking:invalid_start_time");
  const open = minutes(settings.openTime);
  let close = minutes(settings.closeTime);
  if (close <= open) close += 24 * 60;
  const normalizedStart = start < open && close > 24 * 60 ? start + 24 * 60 : start;
  const total = Math.max(1, Math.floor(durationMin)) + settings.bufferMin;
  if (normalizedStart < open || normalizedStart + total > close + 15) {
    throw new AppError(409, "package_booking:outside_business_hours");
  }
  if ((normalizedStart - open) % settings.slotStepMin !== 0) {
    throw new AppError(400, "package_booking:slot_not_aligned");
  }
  const count = Math.max(1, Math.ceil(total / settings.slotStepMin));
  return Array.from({ length: count }, (_, index) => {
    const current = (normalizedStart + index * settings.slotStepMin) % (24 * 60);
    return `${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`;
  });
}

export function safeSegment(value) {
  return cleanText(value).replace(/\//g, "-").replace(/\s+/g, "_");
}

export function buildBookingSlotId(salonId, date, time, employeeId) {
  return [salonId, date, time, employeeId].map(safeSegment).join("__");
}

export function cancellationPolicy(raw) {
  const source = raw.packageSubscriptions && typeof raw.packageSubscriptions === "object" ? raw.packageSubscriptions : raw;
  const windowMinutes = Number(source.lateCancellationWindowMinutes);
  return {
    lateCancellationWindowMinutes:
      Number.isFinite(windowMinutes) && windowMinutes >= 0
        ? Math.min(PACKAGE_LIMITS.cancellationWindowMinutes, Math.floor(windowMinutes))
        : DEFAULT_CANCELLATION_POLICY.lateCancellationWindowMinutes,
    lateCancellationConsumesSession:
      source.lateCancellationConsumesSession === undefined
        ? DEFAULT_CANCELLATION_POLICY.lateCancellationConsumesSession
        : source.lateCancellationConsumesSession === true,
    noShowConsumesSession:
      source.noShowConsumesSession === undefined
        ? DEFAULT_CANCELLATION_POLICY.noShowConsumesSession
        : source.noShowConsumesSession === true,
  };
}

export function shouldConsumeCancelledReservation({ nowMs, appointmentAtMs, policy }) {
  const cutoffMs = Math.max(0, policy.lateCancellationWindowMinutes) * 60_000;
  return policy.lateCancellationConsumesSession && appointmentAtMs - nowMs <= cutoffMs;
}

export function phoneCandidates(raw) {
  let digits = cleanText(raw).replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  const local = digits.startsWith("9665") ? `0${digits.slice(3)}` : digits;
  const intl = local.startsWith("05") ? `966${local.slice(1)}` : digits;
  return [...new Set([local, intl, `+${intl}`].filter(Boolean))];
}

export function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeJwtPart(part) {
  const normalized = cleanText(part).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function salonPath(salonId, ...segments) {
  return ["salons", salonId, ...segments].join("/");
}

export function requireRole(role, allowed) {
  if (!allowed.has(role)) throw new AppError(403, "packages_auth:insufficient_permissions");
}
