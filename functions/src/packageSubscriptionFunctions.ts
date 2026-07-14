import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  PackageDomainError,
  adjustRemainingBalance,
  buildPurchasedPackageSnapshot,
  cancelPackage,
  consumeOneReservedSession,
  normalizeBalances,
  normalizeStringArray,
  reserveOneSession,
  restoreOneUsedSession,
  restoreOneReservedSession,
  selectNearestExpiringPackage,
  shouldConsumeCancelledReservation,
  DEFAULT_PACKAGE_CANCELLATION_POLICY,
  transactionId,
  type ClientPackageStatus,
  type PackageBalances,
  type PackageCandidate,
  type PackageTransactionType,
} from "./packageSubscriptionDomain.js";
import {
  appointmentTimestampMs,
  buildBookingSlotId,
  buildLockedTimes,
  resolveSlotSettings,
  stableLegacyClientId,
} from "./packageRedemptionBookingDomain.js";
import {
  PACKAGE_INPUT_LIMITS,
  boundedInteger,
  optionalBoundedText,
  optionalDocumentId,
  requiredDocumentId,
  requiredExternalId,
  requiredReason,
  safeStoredDocumentIds,
} from "./packageSubscriptionValidation.js";

type CallableRequest = {
  auth?: { uid: string; token: Record<string, unknown> };
  data?: unknown;
};

type CallerRole = "owner" | "admin" | "reception" | "hr" | "staff" | "client" | "guest";

type Dependencies = {
  db: admin.firestore.Firestore;
  resolveCallerRole: (uid: string) => Promise<CallerRole>;
  defaultSalonId: string;
};

type Actor = { uid: string; role: CallerRole };

const SALES_ROLES = new Set<CallerRole>(["owner", "admin", "reception"]);
const ADMIN_ROLES = new Set<CallerRole>(["owner", "admin"]);

function phoneCandidates(raw: unknown): string[] {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  const local = digits.startsWith("9665") ? `0${digits.slice(3)}` : digits;
  const intl = local.startsWith("05") ? `966${local.slice(1)}` : digits;
  return [...new Set([local, intl, `+${intl}`].filter(Boolean))];
}

async function resolveAuthenticatedClientIdentity(args: {
  db: admin.firestore.Firestore;
  salonRef: admin.firestore.DocumentReference;
  uid: string;
  token: Record<string, unknown>;
}) {
  const userRef = args.salonRef.collection("users").doc(args.uid);
  const userSnap = await userRef.get();
  const linkedId = String(userSnap.data()?.clientId || "").trim();
  if (linkedId) {
    const direct = await args.salonRef.collection("clients").doc(linkedId).get();
    if (direct.exists) return { clientId: linkedId, clientSnap: direct };
    const byStable = await args.salonRef.collection("clients").where("clientId", "==", linkedId).limit(2).get();
    if (byStable.size === 1) return { clientId: linkedId, clientSnap: byStable.docs[0] };
    if (byStable.size > 1) throw new HttpsError("failed-precondition", "Duplicate stable client identity");
  }

  const byAuth = await args.salonRef.collection("clients").where("authUid", "==", args.uid).limit(2).get();
  if (byAuth.size > 1) throw new HttpsError("failed-precondition", "Multiple client records require manual review");
  if (byAuth.size === 1) {
    const snap = byAuth.docs[0];
    const clientId = String(snap.data()?.clientId || "").trim() || stableLegacyClientId(args.salonRef.id, snap.id);
    await Promise.all([
      userRef.set({ clientId, identityLinkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      snap.ref.set({ clientId, authUid: args.uid, legacyClientDocId: snap.id === clientId ? null : snap.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    return { clientId, clientSnap: await snap.ref.get() };
  }

  const verifiedPhone = String(args.token.phone_number || "").trim();
  if (!verifiedPhone) {
    throw new HttpsError("failed-precondition", "Verify the phone number to link the client wallet");
  }
  const candidates = phoneCandidates(verifiedPhone);
  const matches = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  for (const phone of candidates) {
    const snap = await args.salonRef.collection("clients").where("phone", "==", phone).limit(3).get();
    snap.docs.forEach((row) => matches.set(row.id, row));
  }
  if (matches.size === 0) {
    const legacyScan = await args.salonRef.collection("clients").limit(500).get();
    const expected = new Set(candidates.flatMap((phone) => phoneCandidates(phone)));
    legacyScan.docs.forEach((row) => {
      const stored = phoneCandidates(row.data()?.phone || row.data()?.mobile);
      if (stored.some((phone) => expected.has(phone))) matches.set(row.id, row);
    });
    if (matches.size === 0 && legacyScan.size >= 500) {
      throw new HttpsError("failed-precondition", "Client identity requires manual verification");
    }
  }
  if (matches.size > 1) throw new HttpsError("failed-precondition", "Multiple phone matches require manual verification");
  if (matches.size === 1) {
    const snap = [...matches.values()][0];
    const existingAuth = String(snap.data()?.authUid || "").trim();
    if (existingAuth && existingAuth !== args.uid) throw new HttpsError("permission-denied", "Client record is linked to another account");
    const clientId = String(snap.data()?.clientId || "").trim() || stableLegacyClientId(args.salonRef.id, snap.id);
    await Promise.all([
      userRef.set({ clientId, identityLinkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      snap.ref.set({ clientId, authUid: args.uid, legacyClientDocId: snap.id === clientId ? null : snap.id, identityLinkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    return { clientId, clientSnap: await snap.ref.get() };
  }

  const clientId = stableLegacyClientId(args.salonRef.id, `auth:${args.uid}`);
  const clientRef = args.salonRef.collection("clients").doc(clientId);
  await args.db.runTransaction(async (tx) => {
    const existing = await tx.get(clientRef);
    if (!existing.exists) tx.create(clientRef, {
      clientId, authUid: args.uid, phone: candidates[0] || verifiedPhone,
      name: String(userSnap.data()?.name || "").trim(), source: "authenticated_client",
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, { clientId, identityLinkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { clientId, clientSnap: await clientRef.get() };
}

function dataOf(request: CallableRequest): Record<string, unknown> {
  return request.data && typeof request.data === "object"
    ? (request.data as Record<string, unknown>)
    : {};
}

const requiredString = requiredDocumentId;

function optionalString(value: unknown): string | undefined {
  return optionalBoundedText(value, "text");
}

function normalizePaymentMethod(value: unknown): "cash" | "card" | "transfer" | "other" {
  const raw = String(value || "cash").trim().toLowerCase();
  if (["cash", "كاش", "نقد"].includes(raw)) return "cash";
  if (["card", "pos_card", "mada_online", "شبكة", "مدى"].includes(raw)) return "card";
  if (["transfer", "تحويل", "بنكي"].includes(raw)) return "transfer";
  if (raw === "other") return "other";
  throw new HttpsError("invalid-argument", "Unsupported paymentMethod");
}

function timestampMs(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis();
  const candidate = value as { toMillis?: () => number; seconds?: number } | null;
  if (typeof candidate?.toMillis === "function") return candidate.toMillis();
  if (typeof candidate?.seconds === "number") return candidate.seconds * 1000;
  return undefined;
}

function balancesFromDoc(raw: Record<string, unknown>, nowMs: number): PackageBalances {
  const rawStatus = String(raw.status || "").trim();
  const status: ClientPackageStatus =
    rawStatus === "active" ||
    rawStatus === "exhausted" ||
    rawStatus === "expired" ||
    rawStatus === "cancelled"
      ? rawStatus
      : raw.active === false
        ? "cancelled"
        : "active";
  return normalizeBalances(
    {
      totalSessions: Number(raw.totalSessions || 0),
      remainingSessions: Number(raw.remainingSessions || 0),
      reservedSessions: Number(raw.reservedSessions || 0),
      usedSessions: Number(raw.usedSessions || 0),
      status,
      expiresAtMs: timestampMs(raw.expiresAt),
    },
    nowMs
  );
}

function packageCandidateFromDoc(
  id: string,
  raw: Record<string, unknown>,
  nowMs: number
): PackageCandidate {
  const balances = balancesFromDoc(raw, nowMs);
  return {
    id,
    clientId: String(raw.clientId || "").trim(),
    allowedServiceIdsSnapshot: normalizeStringArray(
      Array.isArray(raw.allowedServiceIdsSnapshot)
        ? raw.allowedServiceIdsSnapshot
        : raw.serviceIds
    ),
    purchasedAtMs: timestampMs(raw.purchasedAt),
    ...balances,
  };
}

function statusPatch(after: PackageBalances) {
  return {
    totalSessions: after.totalSessions,
    remainingSessions: after.remainingSessions,
    reservedSessions: after.reservedSessions,
    usedSessions: after.usedSessions,
    status: after.status,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function ledgerPayload(args: {
  clientPackageId: string;
  clientId: string;
  type: PackageTransactionType;
  idempotencyKey: string;
  actorUid: string;
  before: PackageBalances;
  after: PackageBalances;
  sessionsDelta: number;
  bookingId?: string;
  invoiceId?: string;
  serviceId?: string;
  reason?: string;
}) {
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
    createdAt: FieldValue.serverTimestamp(),
  };
}

async function resolveClientIdentity(args: {
  tx: admin.firestore.Transaction;
  salonRef: admin.firestore.DocumentReference;
  requestedId: string;
}) {
  const directRef = args.salonRef.collection("clients").doc(args.requestedId);
  const direct = await args.tx.get(directRef);
  let snap: admin.firestore.DocumentSnapshot = direct;
  if (!direct.exists) {
    const byStableId = await args.tx.get(
      args.salonRef.collection("clients").where("clientId", "==", args.requestedId).limit(2)
    );
    if (byStableId.empty) throw new HttpsError("not-found", "Client was not found");
    if (byStableId.size > 1) throw new HttpsError("failed-precondition", "Duplicate stable client identity");
    snap = byStableId.docs[0];
  }
  const raw = snap.data() || {};
  const existingStableId = String(raw.clientId || "").trim();
  const clientId = existingStableId || stableLegacyClientId(args.salonRef.id, snap.id);
  return {
    snap,
    clientId,
    legacyClientDocId: snap.id === clientId ? undefined : snap.id,
    phoneSnapshot: String(raw.phone || raw.mobile || "").trim() || undefined,
    nameSnapshot: String(raw.name || raw.fullName || "").trim() || undefined,
    needsLink: !existingStableId,
  };
}

function cancellationPolicy(raw: Record<string, unknown>) {
  const source = raw.packageSubscriptions && typeof raw.packageSubscriptions === "object"
    ? raw.packageSubscriptions as Record<string, unknown>
    : raw;
  return {
    lateCancellationWindowMinutes: (() => {
      const value = Number(source.lateCancellationWindowMinutes);
      return Number.isFinite(value) && value >= 0
        ? Math.min(PACKAGE_INPUT_LIMITS.cancellationWindowMinutes, Math.floor(value))
        : DEFAULT_PACKAGE_CANCELLATION_POLICY.lateCancellationWindowMinutes;
    })(),
    lateCancellationConsumesSession:
      source.lateCancellationConsumesSession === undefined
        ? DEFAULT_PACKAGE_CANCELLATION_POLICY.lateCancellationConsumesSession
        : source.lateCancellationConsumesSession === true,
    noShowConsumesSession:
      source.noShowConsumesSession === undefined
        ? DEFAULT_PACKAGE_CANCELLATION_POLICY.noShowConsumesSession
        : source.noShowConsumesSession === true,
  };
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof PackageDomainError) {
    const failedPrecondition = new Set([
      "PACKAGE_NOT_ACTIVE",
      "PACKAGE_EXHAUSTED",
      "PACKAGE_CANCELLED",
      "PACKAGE_HAS_RESERVATIONS",
      "NO_RESERVED_SESSION",
      "NEGATIVE_BALANCE",
    ]);
    throw new HttpsError(
      failedPrecondition.has(error.code) ? "failed-precondition" : "invalid-argument",
      error.message,
      { domainCode: error.code }
    );
  }
  throw new HttpsError("internal", "Package operation failed");
}

async function actorFor(
  request: CallableRequest,
  resolveCallerRole: Dependencies["resolveCallerRole"],
  allowedRoles: Set<CallerRole>
): Promise<Actor> {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Authentication is required");
  const role = await resolveCallerRole(request.auth.uid);
  if (!allowedRoles.has(role)) throw new HttpsError("permission-denied", "Insufficient permissions");
  return { uid: request.auth.uid, role };
}

function salonIdFrom(data: Record<string, unknown>, fallback: string): string {
  return requiredDocumentId(data.salonId ?? fallback, "salonId");
}

export function buildPackageSubscriptionHandlers(deps: Dependencies) {
  const { db, resolveCallerRole, defaultSalonId } = deps;

  return {
    getMyPackageWallet: async (request: CallableRequest) => {
      if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Authentication is required");
      const role = await resolveCallerRole(request.auth.uid);
      if (role !== "client") throw new HttpsError("permission-denied", "Client account is required");
      const salonId = salonIdFrom(dataOf(request), defaultSalonId);
      const salonRef = db.collection("salons").doc(salonId);
      const identity = await resolveAuthenticatedClientIdentity({ db, salonRef, uid: request.auth.uid, token: request.auth.token || {} });
      const packageSnap = await salonRef.collection("client_packages").where("clientId", "==", identity.clientId).get();
      const transactionSnap = await salonRef.collection("client_package_transactions").where("clientId", "==", identity.clientId).get();
      const serviceIds = [...new Set(packageSnap.docs.flatMap((p) => normalizeStringArray(p.data().allowedServiceIdsSnapshot)))];
      const servicePairs = await Promise.all(serviceIds.map(async (id) => {
        const snap = await salonRef.collection("services").doc(id).get();
        return [id, snap.exists ? String(snap.data()?.name || id) : id] as const;
      }));
      return {
        ok: true,
        clientId: identity.clientId,
        packages: packageSnap.docs.map((p) => {
          const raw = p.data();
          return {
            id: p.id,
            packageNameSnapshot: raw.packageNameSnapshot,
            packageDescriptionSnapshot: raw.packageDescriptionSnapshot,
            allowedServiceIdsSnapshot: raw.allowedServiceIdsSnapshot,
            totalSessions: raw.totalSessions,
            remainingSessions: raw.remainingSessions,
            reservedSessions: raw.reservedSessions,
            usedSessions: raw.usedSessions,
            purchasedAt: raw.purchasedAt,
            expiresAt: raw.expiresAt,
            status: raw.status,
            invoiceId: raw.invoiceId,
          };
        }),
        transactions: transactionSnap.docs.map((t) => {
          const raw = t.data();
          return {
            id: t.id,
            clientPackageId: raw.clientPackageId,
            type: raw.type,
            bookingId: raw.bookingId,
            serviceId: raw.serviceId,
            sessionsDelta: raw.sessionsDelta,
            remainingBefore: raw.remainingBefore,
            remainingAfter: raw.remainingAfter,
            reservedBefore: raw.reservedBefore,
            reservedAfter: raw.reservedAfter,
            usedBefore: raw.usedBefore,
            usedAfter: raw.usedAfter,
            createdAt: raw.createdAt,
          };
        }),
        services: Object.fromEntries(servicePairs),
      };
    },
    purchaseClientPackage: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, SALES_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const clientId = requiredString(data.clientId, "clientId");
      const packageCatalogId = requiredString(data.packageCatalogId, "packageCatalogId");
      const invoiceId = requiredExternalId(data.invoiceId, "invoiceId");
      const paymentMethod = normalizePaymentMethod(data.paymentMethod);
      const purchaseTxId = transactionId("purchase", invoiceId);
      const invoiceDocumentId = purchaseTxId.replace(/^purchase:/, "invoice_");
      const now = Timestamp.now();

      const salonRef = db.collection("salons").doc(salonId);
      const catalogRef = salonRef.collection("packages_catalog").doc(packageCatalogId);
      const invoiceRef = salonRef.collection("invoices").doc(invoiceDocumentId);
      const financeSettingsRef = salonRef.collection("settings").doc("finance");
      const invoiceCounterRef = salonRef.collection("counters").doc("invoices");
      const transactionRef = salonRef.collection("client_package_transactions").doc(purchaseTxId);
      const clientPackageRef = salonRef.collection("client_packages").doc();
      const incomeRef = salonRef.collection("income").doc(purchaseTxId);

      try {
        return await db.runTransaction(async (tx) => {
          const [existingTransaction, catalogSnap, invoiceSnap, financeSettingsSnap, counterSnap] = await Promise.all([
            tx.get(transactionRef),
            tx.get(catalogRef),
            tx.get(invoiceRef),
            tx.get(financeSettingsRef),
            tx.get(invoiceCounterRef),
          ]);

          if (existingTransaction.exists) {
            const existing = existingTransaction.data() || {};
            if (
              existing.invoiceId !== invoiceId ||
              existing.packageCatalogId !== packageCatalogId ||
              ![existing.requestedClientId, existing.clientId].includes(clientId)
            ) {
              throw new HttpsError("already-exists", "Idempotency key belongs to another purchase");
            }
            return {
              ok: true,
              idempotent: true,
              clientPackageId: String(existing.clientPackageId || ""),
              invoiceId,
              invoiceDocumentId: String(existing.invoiceDocumentId || invoiceDocumentId),
              invoiceNumber: String(existing.invoiceNumber || ""),
              clientId: String(existing.clientId || ""),
            };
          }
          const client = await resolveClientIdentity({ tx, salonRef, requestedId: clientId });
          if (!catalogSnap.exists) throw new HttpsError("not-found", "Package catalog item was not found");
          if (invoiceSnap.exists) throw new HttpsError("already-exists", "Invoice id is already in use");

          const catalog = catalogSnap.data() || {};
          if (catalog.active === false) throw new HttpsError("failed-precondition", "Package is inactive");
          const snapshot = buildPurchasedPackageSnapshot(catalog);
          const packageNameSnapshot = snapshot.name;
          const totalSessions = snapshot.sessionsCount;
          const purchasePrice = snapshot.price;
          const allowedServiceIdsSnapshot = snapshot.allowedServiceIds;
          const validityDays = snapshot.validityDays;
          const expiresAt = validityDays
            ? Timestamp.fromMillis(now.toMillis() + validityDays * 24 * 60 * 60 * 1000)
            : undefined;
          const packageDescriptionSnapshot = snapshot.description;
          const finance = financeSettingsSnap.data() || {};
          const configuredTaxRate = Number(finance.taxRate ?? finance.vatRate ?? 0);
          const taxRate = Number.isFinite(configuredTaxRate)
            ? Math.min(100, Math.max(0, configuredTaxRate))
            : 0;
          const taxAmount = taxRate > 0
            ? Math.round((purchasePrice - purchasePrice / (1 + taxRate / 100)) * 100) / 100
            : 0;
          const subtotalBeforeTax = Math.round((purchasePrice - taxAmount) * 100) / 100;
          const nextInvoice = Number(counterSnap.data()?.next || 10000) + 1;
          const invoiceNumber = `INV-${String(nextInvoice).padStart(5, "0")}`;
          const before: PackageBalances = {
            totalSessions: 0,
            remainingSessions: 0,
            reservedSessions: 0,
            usedSessions: 0,
            status: "active",
            ...(expiresAt ? { expiresAtMs: expiresAt.toMillis() } : {}),
          };
          const after: PackageBalances = {
            ...before,
            totalSessions,
            remainingSessions: totalSessions,
          };

          tx.create(clientPackageRef, {
            clientId: client.clientId,
            ...(client.legacyClientDocId ? { legacyClientDocId: client.legacyClientDocId } : {}),
            ...(client.phoneSnapshot ? { phoneSnapshot: client.phoneSnapshot } : {}),
            packageCatalogId,
            packageNameSnapshot,
            ...(packageDescriptionSnapshot ? { packageDescriptionSnapshot } : {}),
            allowedServiceIdsSnapshot,
            totalSessions,
            remainingSessions: totalSessions,
            reservedSessions: 0,
            usedSessions: 0,
            purchasePrice,
            purchasedAt: now,
            ...(expiresAt ? { expiresAt } : {}),
            status: "active",
            invoiceId,
            invoiceDocumentId,
            catalogSnapshot: {
              name: packageNameSnapshot,
              ...(packageDescriptionSnapshot ? { description: packageDescriptionSnapshot } : {}),
              sessionsCount: totalSessions,
              price: purchasePrice,
              allowedServiceIds: allowedServiceIdsSnapshot,
              ...(validityDays ? { validityDays } : {}),
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.create(invoiceRef, {
            invoiceType: "package_purchase",
            invoiceId,
            invoiceDocumentId,
            clientId: client.clientId,
            ...(client.legacyClientDocId ? { legacyClientDocId: client.legacyClientDocId } : {}),
            invoiceNumber,
            clientPackageId: clientPackageRef.id,
            packageCatalogId,
            packageNameSnapshot,
            quantity: 1,
            subtotal: subtotalBeforeTax,
            taxRate,
            taxAmount,
            total: purchasePrice,
            paidAmount: purchasePrice,
            remainingAmount: 0,
            status: "paid",
            paymentMethod,
            issuedAt: now,
            createdBy: actor.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.create(transactionRef, {
            ...ledgerPayload({
              clientPackageId: clientPackageRef.id,
              clientId: client.clientId,
              type: "purchase",
              idempotencyKey: purchaseTxId,
              actorUid: actor.uid,
              before,
              after,
              sessionsDelta: totalSessions,
              invoiceId,
            }),
            packageCatalogId,
            requestedClientId: clientId,
            invoiceNumber,
            invoiceDocumentId,
          });
          tx.set(incomeRef, {
            source: "package_purchase",
            invoiceId,
            invoiceDocumentId,
            clientPackageId: clientPackageRef.id,
            clientId: client.clientId,
            amount: purchasePrice,
            method: paymentMethod,
            taxRate,
            taxAmount,
            status: "completed",
            date: now.toDate().toISOString().slice(0, 10),
            note: `package_purchase:${packageNameSnapshot}`,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(invoiceCounterRef, { next: nextInvoice, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          if (client.needsLink) {
            tx.update(client.snap.ref, {
              clientId: client.clientId,
              legacyClientDocId: client.snap.id,
              identityLinkedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          return {
            ok: true,
            idempotent: false,
            clientPackageId: clientPackageRef.id,
            invoiceId,
            invoiceDocumentId,
            invoiceNumber,
            clientId: client.clientId,
          };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    createPackageRedemptionBooking: async (request: CallableRequest) => {
      if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Authentication is required");
      const role = await resolveCallerRole(request.auth.uid);
      if (!SALES_ROLES.has(role) && role !== "client") throw new HttpsError("permission-denied", "Insufficient permissions");
      const actor: Actor = { uid: request.auth.uid, role };
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const salonRef = db.collection("salons").doc(salonId);
      const requestedClientId = role === "client"
        ? (await resolveAuthenticatedClientIdentity({ db, salonRef, uid: request.auth.uid, token: request.auth.token || {} })).clientId
        : requiredString(data.clientId, "clientId");
      const serviceId = requiredString(data.serviceId, "serviceId");
      const employeeId = requiredString(data.employeeId, "employeeId");
      const date = requiredString(data.date, "date");
      const time = requiredString(data.time, "time");
      const operationId = requiredExternalId(data.operationId, "operationId");
      const requestedClientPackageId = optionalDocumentId(data.clientPackageId, "clientPackageId");
      const now = Timestamp.now();
      const nowMs = now.toMillis();
      const appointmentAtMs = appointmentTimestampMs(date, time);
      const bookingId = transactionId("reserve", operationId).replace(/^reserve:/, "pkg_");
      const bookingRef = salonRef.collection("bookings").doc(bookingId);
      const reserveTxId = transactionId("reserve", bookingRef.id);
      const ledgerRef = salonRef.collection("client_package_transactions").doc(reserveTxId);

      try {
        return await db.runTransaction(async (tx) => {
          const existingLedger = await tx.get(ledgerRef);
          if (existingLedger.exists) {
            const prior = existingLedger.data() || {};
            if (
              prior.idempotencySource !== operationId ||
              ![prior.requestedClientId, prior.clientId].includes(requestedClientId) ||
              (prior.requestedClientPackageId || undefined) !== requestedClientPackageId ||
              prior.serviceId !== serviceId ||
              prior.employeeId !== employeeId ||
              prior.appointmentAtMs !== appointmentAtMs
            ) {
              throw new HttpsError("already-exists", "Operation id belongs to another redemption booking");
            }
            return {
              ok: true,
              idempotent: true,
              bookingId: String(prior.bookingId || ""),
              publicId: String(prior.bookingPublicId || ""),
              clientPackageId: String(prior.clientPackageId || ""),
              packageTransactionId: reserveTxId,
            };
          }

          const client = await resolveClientIdentity({
            tx,
            salonRef,
            requestedId: requestedClientId,
          });
          const serviceRef = salonRef.collection("services").doc(serviceId);
          const employeeRef = salonRef.collection("staff_public").doc(employeeId);
          const settingsRef = salonRef.collection("settings").doc("app");
          const counterRef = salonRef.collection("counters").doc("bookings");
          const [serviceSnap, employeeSnap, settingsSnap, counterSnap] = await Promise.all([
            tx.get(serviceRef),
            tx.get(employeeRef),
            tx.get(settingsRef),
            tx.get(counterRef),
          ]);
          if (!serviceSnap.exists || serviceSnap.data()?.active === false) {
            throw new HttpsError("failed-precondition", "Service is unavailable");
          }
          if (!employeeSnap.exists) throw new HttpsError("not-found", "Employee was not found");
          const employee = employeeSnap.data() || {};
          if (
            employee.active === false ||
            employee.isActive === false ||
            employee.removedFromStaff === true ||
            String(employee.employmentStatus || "active") !== "active"
          ) {
            throw new HttpsError("failed-precondition", "Employee is not operational");
          }
          const employeeServices = normalizeStringArray(
            employee.serviceIds || employee.allowedServiceIds || employee.services
          );
          if (employeeServices.length && !employeeServices.includes(serviceId)) {
            throw new HttpsError("failed-precondition", "Employee does not provide this service");
          }

          const service = serviceSnap.data() || {};
          const rawDuration = Number(service.durationMin || service.duration || 60);
          if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
            throw new HttpsError("failed-precondition", "Service duration is invalid");
          }
          const durationMin = Math.min(
            PACKAGE_INPUT_LIMITS.serviceDurationMinutes,
            Math.max(1, Math.floor(rawDuration))
          );
          const slotSettings = resolveSlotSettings(settingsSnap.data() || {}, date);
          const lockedTimes = buildLockedTimes({ settings: slotSettings, startTime: time, durationMin });
          const lockedSlotIds = lockedTimes.map((lockedTime) =>
            buildBookingSlotId(salonId, date, lockedTime, employeeId)
          );
          const slotRefs = lockedSlotIds.map((id) => salonRef.collection("booking_slots").doc(id));
          const availabilityRef = salonRef
            .collection("availability_days")
            .doc(date)
            .collection("employees")
            .doc(employeeId);

          let packageSnap: admin.firestore.DocumentSnapshot;
          if (requestedClientPackageId) {
            packageSnap = await tx.get(salonRef.collection("client_packages").doc(requestedClientPackageId));
            if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          } else {
            const querySnap = await tx.get(
              salonRef.collection("client_packages").where("clientId", "==", client.clientId)
            );
            const candidates = querySnap.docs.flatMap((doc) => {
              try {
                return [packageCandidateFromDoc(doc.id, doc.data(), nowMs)];
              } catch {
                return [];
              }
            });
            const selected = selectNearestExpiringPackage(
              candidates,
              client.clientId,
              serviceId,
              nowMs,
              appointmentAtMs
            );
            if (!selected) throw new HttpsError("failed-precondition", "No eligible client package exists");
            packageSnap = querySnap.docs.find((doc) => doc.id === selected.id) as admin.firestore.DocumentSnapshot;
          }

          const [availabilitySnap, ...slotSnaps] = await Promise.all([
            tx.get(availabilityRef),
            ...slotRefs.map((ref) => tx.get(ref)),
          ]);
          if (slotSnaps.some((snap) => snap.exists)) {
            throw new HttpsError("already-exists", "Appointment slot is already locked");
          }

          const clientPackage = packageSnap.data() || {};
          if (String(clientPackage.clientId || "") !== client.clientId) {
            throw new HttpsError("permission-denied", "Package does not belong to the client");
          }
          const allowedServices = normalizeStringArray(clientPackage.allowedServiceIdsSnapshot);
          if (!allowedServices.length) {
            throw new HttpsError("failed-precondition", "Legacy package requires manual review");
          }
          if (!allowedServices.includes(serviceId)) {
            throw new HttpsError("failed-precondition", "Service is not included in this package");
          }
          const expiresAtMs = timestampMs(clientPackage.expiresAt);
          if (expiresAtMs !== undefined && appointmentAtMs > expiresAtMs) {
            throw new HttpsError("failed-precondition", "Appointment is after package expiry");
          }
          const transition = reserveOneSession(balancesFromDoc(clientPackage, nowMs), nowMs);
          const nextCounter = Number(counterSnap.data()?.next || 10000) + 1;
          const publicId = `MK-${String(nextCounter).padStart(5, "0")}`;
          const packageNameSnapshot = String(clientPackage.packageNameSnapshot || "").trim();
          const serviceName = String(service.name || service.title || service.serviceName || serviceId).trim();
          const employeeName = String(employee.name || employee.displayName || employeeId).trim();
          const appointmentAt = Timestamp.fromMillis(appointmentAtMs);

          tx.update(packageSnap.ref, statusPatch(transition.after));
          tx.create(ledgerRef, {
            ...ledgerPayload({
              clientPackageId: packageSnap.id,
              clientId: client.clientId,
              type: "reserve",
              idempotencyKey: reserveTxId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId: bookingRef.id,
              serviceId,
            }),
            idempotencySource: operationId,
            requestedClientId,
            ...(requestedClientPackageId ? { requestedClientPackageId } : {}),
            bookingPublicId: publicId,
            employeeId,
            appointmentAt,
            appointmentAtMs,
          });
          tx.create(bookingRef, {
            publicId,
            clientId: client.clientId,
            ...(client.legacyClientDocId ? { legacyClientDocId: client.legacyClientDocId } : {}),
            ...(client.phoneSnapshot ? { phoneSnapshot: client.phoneSnapshot } : {}),
            clientName: client.nameSnapshot || "",
            clientPhone: client.phoneSnapshot || "",
            serviceId,
            serviceName,
            serviceSnapshot: {
              serviceNameAtBooking: serviceName,
              priceAtBooking: 0,
              catalogPriceAtBooking: Number.isFinite(Number(service.price))
                ? Math.min(PACKAGE_INPUT_LIMITS.price, Math.max(0, Number(service.price)))
                : 0,
              durationAtBooking: durationMin,
              ...(optionalString(service.sectionId)
                ? { sectionIdAtBooking: optionalString(service.sectionId) }
                : {}),
              ...(optionalString(service.categoryId)
                ? { categoryIdAtBooking: optionalString(service.categoryId) }
                : {}),
            },
            employeeId,
            ...(optionalString(employee.linkedUid || employee.uid)
              ? { employeeUid: optionalString(employee.linkedUid || employee.uid) }
              : {}),
            employeeName,
            employeeKey: employeeId,
            date,
            time,
            appointmentAt,
            durationMin,
            slotId: lockedSlotIds[0],
            lockedSlotIds,
            slotStepMinAtBooking: slotSettings.slotStepMin,
            bufferMinAtBooking: slotSettings.bufferMin,
            status: "confirmed",
            channel: "internal",
            createdBy: actor.uid,
            createdByUid: actor.uid,
            lineType: "package_redemption",
            fromSessionPackage: true,
            consumeOneSession: true,
            clientPackageId: packageSnap.id,
            packageTransactionId: reserveTxId,
            packageRedemptionState: "reserved",
            packageSnapshot: {
              clientPackageId: packageSnap.id,
              packageCatalogId: clientPackage.packageCatalogId || null,
              packageName: packageNameSnapshot,
              allowedServiceIds: allowedServices,
              totalSessions: transition.after.totalSessions,
              remainingBefore: transition.before.remainingSessions,
              remainingAfter: transition.after.remainingSessions,
              reservedAfter: transition.after.reservedSessions,
              usedAfter: transition.after.usedSessions,
              expiresAt: clientPackage.expiresAt || null,
            },
            total: 0,
            finalPrice: 0,
            paidAmount: 0,
            remainingAmount: 0,
            paymentType: "none",
            invoiceId: bookingRef.id,
            createdAtMs: nowMs,
            confirmedAt: nowMs,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          slotRefs.forEach((ref, index) => {
            tx.create(ref, {
              bookingId: bookingRef.id,
              employeeId,
              employeeUid: optionalString(employee.linkedUid || employee.uid) || null,
              employeeName,
              employeeKey: employeeId,
              date,
              time: lockedTimes[index],
              startTime: time,
              durationMin,
              clientId: client.clientId,
              clientPhone: client.phoneSnapshot || "",
              createdAt: FieldValue.serverTimestamp(),
            });
          });
          const bookedSlots = { ...((availabilitySnap.data()?.bookedSlots || {}) as Record<string, boolean>) };
          lockedTimes.forEach((value) => { bookedSlots[value] = true; });
          tx.set(availabilityRef, {
            date,
            employeeId,
            employeeKey: employeeId,
            bookedSlots,
            complete: availabilitySnap.data()?.complete === true,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          tx.set(counterRef, { next: nextCounter, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          tx.create(salonRef.collection("invoices").doc(bookingRef.id), {
            invoiceType: "package_redemption",
            invoiceNumber: publicId,
            bookingId: bookingRef.id,
            clientId: client.clientId,
            clientPackageId: packageSnap.id,
            serviceId,
            serviceNameSnapshot: serviceName,
            total: 0,
            paidAmount: 0,
            remainingAmount: 0,
            status: "settled_by_package",
            issuedAt: now,
            createdBy: actor.uid,
            createdAt: FieldValue.serverTimestamp(),
          });
          tx.set(salonRef.collection("booking_tracks").doc(bookingRef.id), {
            bookingId: bookingRef.id,
            publicId,
            clientId: client.clientId,
            serviceId,
            serviceName,
            employeeId,
            employeeName,
            date,
            time,
            status: "confirmed",
            lineType: "package_redemption",
            clientPackageId: packageSnap.id,
            packageRedemptionState: "reserved",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (client.needsLink) {
            tx.update(client.snap.ref, {
              clientId: client.clientId,
              legacyClientDocId: client.snap.id,
              identityLinkedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          return {
            ok: true,
            idempotent: false,
            bookingId: bookingRef.id,
            publicId,
            clientPackageId: packageSnap.id,
            packageTransactionId: reserveTxId,
            clientId: client.clientId,
          };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    reservePackageSession: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, SALES_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const clientId = requiredString(data.clientId, "clientId");
      const bookingId = requiredString(data.bookingId, "bookingId");
      const requestedServiceId = optionalDocumentId(data.serviceId, "serviceId");
      const requestedClientPackageId = optionalDocumentId(data.clientPackageId, "clientPackageId");
      const reserveTxId = transactionId("reserve", bookingId);
      const now = Timestamp.now();
      const nowMs = now.toMillis();
      const salonRef = db.collection("salons").doc(salonId);
      const bookingRef = salonRef.collection("bookings").doc(bookingId);
      const ledgerRef = salonRef.collection("client_package_transactions").doc(reserveTxId);

      try {
        return await db.runTransaction(async (tx) => {
          const [existingLedger, bookingSnap] = await Promise.all([tx.get(ledgerRef), tx.get(bookingRef)]);
          if (existingLedger.exists) {
            const existing = existingLedger.data() || {};
            if (existing.clientId !== clientId) {
              throw new HttpsError("already-exists", "Reserve idempotency key belongs to another client");
            }
            if (
              bookingSnap.exists &&
              existing.serviceId &&
              bookingSnap.data()?.serviceId &&
              existing.serviceId !== bookingSnap.data()?.serviceId
            ) {
              throw new HttpsError("failed-precondition", "Booking service changed after reservation");
            }
            return {
              ok: true,
              idempotent: true,
              clientPackageId: String(existing.clientPackageId || ""),
              packageTransactionId: reserveTxId,
              balanceBefore: Number(existing.remainingBefore || 0),
              balanceAfter: Number(existing.remainingAfter || 0),
            };
          }
          if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking was not found");
          const booking = bookingSnap.data() || {};
          const bookingClientId = String(booking.clientId || "").trim();
          if (bookingClientId && bookingClientId !== clientId) {
            throw new HttpsError("permission-denied", "Booking does not belong to the selected client");
          }
          const bookingStatus = String(booking.status || "pending").toLowerCase();
          if (["cancelled", "completed"].includes(bookingStatus)) {
            throw new HttpsError("failed-precondition", "Booking cannot reserve a package session");
          }
          const serviceId = requestedServiceId || String(booking.serviceId || "").trim();
          if (!serviceId) throw new HttpsError("failed-precondition", "Booking serviceId is missing");
          if (requestedServiceId && booking.serviceId && requestedServiceId !== booking.serviceId) {
            throw new HttpsError("failed-precondition", "Requested service does not match booking service");
          }
          const appointmentAtMs = timestampMs(booking.appointmentAt) ||
            appointmentTimestampMs(String(booking.date || ""), String(booking.time || ""));

          let packageSnap: admin.firestore.DocumentSnapshot;
          if (requestedClientPackageId) {
            packageSnap = await tx.get(salonRef.collection("client_packages").doc(requestedClientPackageId));
            if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          } else {
            const query = salonRef.collection("client_packages").where("clientId", "==", clientId);
            const querySnap = await tx.get(query);
            const candidates = querySnap.docs.flatMap((doc) => {
              try {
                return [packageCandidateFromDoc(doc.id, doc.data(), nowMs)];
              } catch {
                return [];
              }
            });
            const selected = selectNearestExpiringPackage(
              candidates,
              clientId,
              serviceId,
              nowMs,
              appointmentAtMs
            );
            if (!selected) throw new HttpsError("failed-precondition", "No eligible client package exists");
            packageSnap = querySnap.docs.find((doc) => doc.id === selected.id) as admin.firestore.DocumentSnapshot;
          }

          const clientPackage = packageSnap.data() || {};
          if (String(clientPackage.clientId || "").trim() !== clientId) {
            throw new HttpsError("permission-denied", "Package does not belong to the selected client");
          }
          const allowedServices = normalizeStringArray(clientPackage.allowedServiceIdsSnapshot);
          if (!allowedServices.length) {
            throw new HttpsError(
              "failed-precondition",
              "Legacy client package requires review before it can be redeemed"
            );
          }
          if (!allowedServices.includes(serviceId)) {
            throw new HttpsError("failed-precondition", "Service is not included in this package");
          }
          const expiresAtMs = timestampMs(clientPackage.expiresAt);
          if (expiresAtMs !== undefined && appointmentAtMs > expiresAtMs) {
            throw new HttpsError("failed-precondition", "Appointment is after package expiry");
          }
          const transition = reserveOneSession(balancesFromDoc(clientPackage, nowMs), nowMs);
          const clientPackageId = packageSnap.id;

          tx.update(packageSnap.ref, statusPatch(transition.after));
          tx.create(
            ledgerRef,
            ledgerPayload({
              clientPackageId,
              clientId,
              type: "reserve",
              idempotencyKey: reserveTxId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId,
              serviceId,
            })
          );
          tx.update(bookingRef, {
            clientId,
            lineType: "package_redemption",
            clientPackageId,
            packageTransactionId: reserveTxId,
            fromSessionPackage: true,
            consumeOneSession: true,
            serviceId,
            finalPrice: 0,
            total: 0,
            paidAmount: 0,
            remainingAmount: 0,
            paymentType: "none",
            balanceBefore: transition.before.remainingSessions,
            balanceAfter: transition.after.remainingSessions,
            packageRedemptionState: "reserved",
            appointmentAt: Timestamp.fromMillis(appointmentAtMs),
            serviceSnapshot: {
              ...(booking.serviceSnapshot && typeof booking.serviceSnapshot === "object"
                ? booking.serviceSnapshot
                : {}),
              priceAtBooking: 0,
            },
            updatedAt: FieldValue.serverTimestamp(),
          });

          return {
            ok: true,
            idempotent: false,
            clientPackageId,
            packageTransactionId: reserveTxId,
            balanceBefore: transition.before.remainingSessions,
            balanceAfter: transition.after.remainingSessions,
          };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    consumeReservedPackageSession: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, SALES_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const bookingId = requiredString(data.bookingId, "bookingId");
      const consumeTxId = transactionId("consume", bookingId);
      const reserveTxId = transactionId("reserve", bookingId);
      const nowMs = Date.now();
      const salonRef = db.collection("salons").doc(salonId);
      const ledger = salonRef.collection("client_package_transactions");
      const consumeRef = ledger.doc(consumeTxId);
      const reserveRef = ledger.doc(reserveTxId);
      const restoreRef = ledger.doc(transactionId("restore", bookingId));
      const bookingRef = salonRef.collection("bookings").doc(bookingId);

      try {
        return await db.runTransaction(async (tx) => {
          const [existing, reserveSnap, restoreSnap, bookingSnap] = await Promise.all([
            tx.get(consumeRef),
            tx.get(reserveRef),
            tx.get(restoreRef),
            tx.get(bookingRef),
          ]);
          if (existing.exists) {
            return { ok: true, idempotent: true, packageTransactionId: consumeTxId };
          }
          if (!reserveSnap.exists) throw new HttpsError("failed-precondition", "Reserve transaction is missing");
          if (restoreSnap.exists) throw new HttpsError("failed-precondition", "Reserved session was restored");
          if (!bookingSnap.exists || String(bookingSnap.data()?.status || "") !== "completed") {
            throw new HttpsError("failed-precondition", "Booking must be completed first");
          }
          const reserve = reserveSnap.data() || {};
          if (
            reserve.serviceId &&
            bookingSnap.data()?.serviceId &&
            reserve.serviceId !== bookingSnap.data()?.serviceId
          ) {
            throw new HttpsError("failed-precondition", "Booking service changed after reservation");
          }
          const clientPackageId = requiredString(reserve.clientPackageId, "clientPackageId");
          const clientId = requiredString(reserve.clientId, "clientId");
          const packageRef = salonRef.collection("client_packages").doc(clientPackageId);
          const packageSnap = await tx.get(packageRef);
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const transition = consumeOneReservedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs);

          tx.update(packageRef, statusPatch(transition.after));
          tx.create(
            consumeRef,
            ledgerPayload({
              clientPackageId,
              clientId,
              type: "consume",
              idempotencyKey: consumeTxId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId,
              serviceId: optionalString(reserve.serviceId),
            })
          );
          tx.update(bookingRef, {
            packageTransactionId: consumeTxId,
            packageRedemptionState: "consumed",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { ok: true, idempotent: false, packageTransactionId: consumeTxId };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    restoreReservedPackageSession: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, SALES_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const bookingId = requiredString(data.bookingId, "bookingId");
      const reason = optionalBoundedText(data.reason, "reason");
      const restoreTxId = transactionId("restore", bookingId);
      const reserveTxId = transactionId("reserve", bookingId);
      const nowMs = Date.now();
      const salonRef = db.collection("salons").doc(salonId);
      const ledger = salonRef.collection("client_package_transactions");
      const restoreRef = ledger.doc(restoreTxId);
      const reserveRef = ledger.doc(reserveTxId);
      const consumeRef = ledger.doc(transactionId("consume", bookingId));
      const bookingRef = salonRef.collection("bookings").doc(bookingId);

      try {
        return await db.runTransaction(async (tx) => {
          const [existing, reserveSnap, consumeSnap, bookingSnap] = await Promise.all([
            tx.get(restoreRef),
            tx.get(reserveRef),
            tx.get(consumeRef),
            tx.get(bookingRef),
          ]);
          if (existing.exists) {
            return { ok: true, idempotent: true, packageTransactionId: restoreTxId };
          }
          if (!reserveSnap.exists) throw new HttpsError("failed-precondition", "Reserve transaction is missing");
          if (consumeSnap.exists) throw new HttpsError("failed-precondition", "Consumed session cannot be restored as reserved");
          if (!bookingSnap.exists || String(bookingSnap.data()?.status || "") !== "cancelled") {
            throw new HttpsError("failed-precondition", "Booking must be cancelled first");
          }
          const reserve = reserveSnap.data() || {};
          const clientPackageId = requiredString(reserve.clientPackageId, "clientPackageId");
          const clientId = requiredString(reserve.clientId, "clientId");
          const packageRef = salonRef.collection("client_packages").doc(clientPackageId);
          const packageSnap = await tx.get(packageRef);
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const transition = restoreOneReservedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs);

          tx.update(packageRef, statusPatch(transition.after));
          tx.create(
            restoreRef,
            ledgerPayload({
              clientPackageId,
              clientId,
              type: "restore",
              idempotencyKey: restoreTxId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId,
              serviceId: optionalString(reserve.serviceId),
              reason,
            })
          );
          tx.update(bookingRef, {
            packageTransactionId: restoreTxId,
            packageRedemptionState: "restored",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { ok: true, idempotent: false, packageTransactionId: restoreTxId };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    cancelPackageRedemptionBooking: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, SALES_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const bookingId = requiredString(data.bookingId, "bookingId");
      const reason = requiredReason(data.reason);
      const salonRef = db.collection("salons").doc(salonId);
      const bookingRef = salonRef.collection("bookings").doc(bookingId);
      const ledger = salonRef.collection("client_package_transactions");
      const reserveRef = ledger.doc(transactionId("reserve", bookingId));
      const restoreRef = ledger.doc(transactionId("restore", bookingId));
      const consumeRef = ledger.doc(transactionId("consume", bookingId));
      const settingsRef = salonRef.collection("settings").doc("package_subscriptions");
      const nowMs = Date.now();
      try {
        return await db.runTransaction(async (tx) => {
          const [bookingSnap, reserveSnap, restoreSnap, consumeSnap, settingsSnap] = await Promise.all([
            tx.get(bookingRef), tx.get(reserveRef), tx.get(restoreRef), tx.get(consumeRef), tx.get(settingsRef),
          ]);
          if (restoreSnap.exists || consumeSnap.exists) {
            const terminal = restoreSnap.exists ? restoreSnap : consumeSnap;
            const prior = terminal.data() || {};
            if (prior.resolutionReason !== "cancellation") {
              throw new HttpsError("failed-precondition", "Reservation already has another terminal result");
            }
            return {
              ok: true,
              idempotent: true,
              action: String(prior.type || ""),
              packageTransactionId: terminal.id,
            };
          }
          if (!bookingSnap.exists || !reserveSnap.exists) {
            throw new HttpsError("failed-precondition", "Package redemption reservation is incomplete");
          }
          const booking = bookingSnap.data() || {};
          const reserve = reserveSnap.data() || {};
          const appointmentAtMs = timestampMs(booking.appointmentAt) ||
            appointmentTimestampMs(String(booking.date || ""), String(booking.time || ""));
          const policy = cancellationPolicy(settingsSnap.data() || {});
          const consume = shouldConsumeCancelledReservation({ nowMs, appointmentAtMs, policy });
          const packageRef = salonRef.collection("client_packages").doc(requiredString(reserve.clientPackageId, "clientPackageId"));
          const packageSnap = await tx.get(packageRef);
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const lockedSlotIds = safeStoredDocumentIds(
            booking.lockedSlotIds || [booking.slotId],
            "lockedSlotId"
          );
          const slotRefs = lockedSlotIds.map((id) => salonRef.collection("booking_slots").doc(id));
          const storedDate = requiredDocumentId(booking.date, "booking.date");
          const storedEmployeeId = requiredDocumentId(booking.employeeId, "booking.employeeId");
          const availabilityRef = salonRef.collection("availability_days").doc(storedDate)
            .collection("employees").doc(storedEmployeeId);
          const [availabilitySnap, ...slotSnaps] = await Promise.all([
            tx.get(availabilityRef), ...slotRefs.map((ref) => tx.get(ref)),
          ]);
          const transition = consume
            ? consumeOneReservedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs)
            : restoreOneReservedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs);
          const terminalRef = consume ? consumeRef : restoreRef;
          tx.update(packageRef, statusPatch(transition.after));
          tx.create(terminalRef, {
            ...ledgerPayload({
              clientPackageId: packageRef.id,
              clientId: requiredString(reserve.clientId, "clientId"),
              type: consume ? "consume" : "restore",
              idempotencyKey: terminalRef.id,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId,
              serviceId: optionalString(reserve.serviceId),
              reason,
            }),
            resolutionReason: "cancellation",
            lateCancellation: consume,
            policySnapshot: policy,
          });
          tx.update(bookingRef, {
            status: "cancelled",
            cancelledAt: nowMs,
            cancelledByUid: actor.uid,
            packageTransactionId: terminalRef.id,
            packageRedemptionState: consume ? "consumed_late_cancellation" : "restored",
            packageCancellationPolicySnapshot: policy,
            cancellationReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
          });
          slotRefs.forEach((ref, index) => {
            if (slotSnaps[index]?.exists) tx.delete(ref);
          });
          if (availabilitySnap.exists) {
            const bookedSlots = { ...((availabilitySnap.data()?.bookedSlots || {}) as Record<string, boolean>) };
            lockedSlotIds.forEach((id) => {
              const slot = slotSnaps.find((snap) => snap.id === id)?.data();
              if (slot?.time) delete bookedSlots[String(slot.time)];
            });
            tx.update(availabilityRef, { bookedSlots, updatedAt: FieldValue.serverTimestamp() });
          }
          tx.set(salonRef.collection("booking_tracks").doc(bookingId), {
            status: "cancelled",
            packageRedemptionState: consume ? "consumed_late_cancellation" : "restored",
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return { ok: true, idempotent: false, action: consume ? "consume" : "restore", packageTransactionId: terminalRef.id };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    markPackageRedemptionNoShow: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, SALES_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const bookingId = requiredString(data.bookingId, "bookingId");
      const reason = requiredReason(data.reason);
      const salonRef = db.collection("salons").doc(salonId);
      const bookingRef = salonRef.collection("bookings").doc(bookingId);
      const ledger = salonRef.collection("client_package_transactions");
      const reserveRef = ledger.doc(transactionId("reserve", bookingId));
      const consumeRef = ledger.doc(transactionId("consume", bookingId));
      const restoreRef = ledger.doc(transactionId("restore", bookingId));
      const settingsRef = salonRef.collection("settings").doc("package_subscriptions");
      const nowMs = Date.now();
      try {
        return await db.runTransaction(async (tx) => {
          const [bookingSnap, reserveSnap, consumeSnap, restoreSnap, settingsSnap] = await Promise.all([
            tx.get(bookingRef), tx.get(reserveRef), tx.get(consumeRef), tx.get(restoreRef), tx.get(settingsRef),
          ]);
          if (consumeSnap.exists || restoreSnap.exists) {
            const terminal = consumeSnap.exists ? consumeSnap : restoreSnap;
            const prior = terminal.data() || {};
            if (prior.resolutionReason !== "no_show") {
              throw new HttpsError("failed-precondition", "Reservation already has another terminal result");
            }
            return { ok: true, idempotent: true, action: prior.type, packageTransactionId: terminal.id };
          }
          if (!bookingSnap.exists || !reserveSnap.exists) {
            throw new HttpsError("failed-precondition", "Package redemption reservation is incomplete");
          }
          const policy = cancellationPolicy(settingsSnap.data() || {});
          const reserve = reserveSnap.data() || {};
          const packageRef = salonRef.collection("client_packages").doc(requiredString(reserve.clientPackageId, "clientPackageId"));
          const packageSnap = await tx.get(packageRef);
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const consume = policy.noShowConsumesSession;
          const transition = consume
            ? consumeOneReservedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs)
            : restoreOneReservedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs);
          const terminalRef = consume ? consumeRef : restoreRef;
          tx.update(packageRef, statusPatch(transition.after));
          tx.create(terminalRef, {
            ...ledgerPayload({
              clientPackageId: packageRef.id,
              clientId: requiredString(reserve.clientId, "clientId"),
              type: consume ? "consume" : "restore",
              idempotencyKey: terminalRef.id,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId,
              serviceId: optionalString(reserve.serviceId),
              reason,
            }),
            resolutionReason: "no_show",
            policySnapshot: policy,
          });
          tx.update(bookingRef, {
            status: "no_show",
            noShowAt: nowMs,
            noShowByUid: actor.uid,
            packageTransactionId: terminalRef.id,
            packageRedemptionState: consume ? "consumed_no_show" : "restored_no_show",
            packageCancellationPolicySnapshot: policy,
            noShowReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(salonRef.collection("booking_tracks").doc(bookingId), {
            status: "no_show",
            packageRedemptionState: consume ? "consumed_no_show" : "restored_no_show",
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return { ok: true, idempotent: false, action: consume ? "consume" : "restore", packageTransactionId: terminalRef.id };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    adminRestoreConsumedPackageSession: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, ADMIN_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const bookingId = requiredString(data.bookingId, "bookingId");
      const operationId = requiredExternalId(data.operationId, "operationId");
      const reason = requiredReason(data.reason);
      const adminRestoreId = transactionId("admin_restore", operationId);
      const salonRef = db.collection("salons").doc(salonId);
      const ledger = salonRef.collection("client_package_transactions");
      const adminRestoreRef = ledger.doc(adminRestoreId);
      const consumeRef = ledger.doc(transactionId("consume", bookingId));
      const bookingRef = salonRef.collection("bookings").doc(bookingId);
      const nowMs = Date.now();
      try {
        return await db.runTransaction(async (tx) => {
          const [existing, consumeSnap, bookingSnap] = await Promise.all([
            tx.get(adminRestoreRef), tx.get(consumeRef), tx.get(bookingRef),
          ]);
          if (existing.exists) {
            const prior = existing.data() || {};
            if (prior.bookingId !== bookingId || prior.idempotencySource !== operationId) {
              throw new HttpsError("already-exists", "Operation id belongs to another administrative restore");
            }
            return { ok: true, idempotent: true, packageTransactionId: adminRestoreId };
          }
          if (!consumeSnap.exists || !bookingSnap.exists) {
            throw new HttpsError("failed-precondition", "Consumed package booking was not found");
          }
          const consumed = consumeSnap.data() || {};
          const packageRef = salonRef.collection("client_packages").doc(requiredString(consumed.clientPackageId, "clientPackageId"));
          const packageSnap = await tx.get(packageRef);
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const transition = restoreOneUsedSession(balancesFromDoc(packageSnap.data() || {}, nowMs), nowMs);
          tx.update(packageRef, statusPatch(transition.after));
          tx.create(adminRestoreRef, {
            ...ledgerPayload({
              clientPackageId: packageRef.id,
              clientId: requiredString(consumed.clientId, "clientId"),
              type: "admin_restore",
              idempotencyKey: adminRestoreId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              bookingId,
              serviceId: optionalString(consumed.serviceId),
              reason,
            }),
            idempotencySource: operationId,
            reversesTransactionId: consumeRef.id,
          });
          tx.update(bookingRef, {
            packageTransactionId: adminRestoreId,
            packageRedemptionState: "admin_restored",
            adminRestoreReason: reason,
            adminRestoredByUid: actor.uid,
            adminRestoredAt: nowMs,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { ok: true, idempotent: false, packageTransactionId: adminRestoreId };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    cancelClientPackage: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, ADMIN_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const clientPackageId = requiredString(data.clientPackageId, "clientPackageId");
      const reason = optionalBoundedText(data.reason, "reason");
      const cancelTxId = transactionId("cancel", clientPackageId);
      const salonRef = db.collection("salons").doc(salonId);
      const packageRef = salonRef.collection("client_packages").doc(clientPackageId);
      const ledgerRef = salonRef.collection("client_package_transactions").doc(cancelTxId);
      const nowMs = Date.now();

      try {
        return await db.runTransaction(async (tx) => {
          const [existing, packageSnap] = await Promise.all([tx.get(ledgerRef), tx.get(packageRef)]);
          if (existing.exists) return { ok: true, idempotent: true, packageTransactionId: cancelTxId };
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const raw = packageSnap.data() || {};
          const clientId = requiredString(raw.clientId, "clientId");
          const transition = cancelPackage(balancesFromDoc(raw, nowMs), nowMs);
          tx.update(packageRef, statusPatch(transition.after));
          tx.create(
            ledgerRef,
            ledgerPayload({
              clientPackageId,
              clientId,
              type: "cancel",
              idempotencyKey: cancelTxId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: 0,
              reason,
            })
          );
          return { ok: true, idempotent: false, packageTransactionId: cancelTxId };
        });
      } catch (error) {
        return mapError(error);
      }
    },

    adjustClientPackageBalance: async (request: CallableRequest) => {
      const actor = await actorFor(request, resolveCallerRole, ADMIN_ROLES);
      const data = dataOf(request);
      const salonId = salonIdFrom(data, defaultSalonId);
      const clientPackageId = requiredString(data.clientPackageId, "clientPackageId");
      const operationId = requiredString(data.operationId, "operationId");
      const sessionsDelta = boundedInteger(data.sessionsDelta, "sessionsDelta", {
        min: -PACKAGE_INPUT_LIMITS.adjustmentSessions,
        max: PACKAGE_INPUT_LIMITS.adjustmentSessions,
      });
      const reason = requiredReason(data.reason);
      const adjustmentTxId = transactionId("admin_adjustment", operationId);
      const salonRef = db.collection("salons").doc(salonId);
      const packageRef = salonRef.collection("client_packages").doc(clientPackageId);
      const ledgerRef = salonRef.collection("client_package_transactions").doc(adjustmentTxId);
      const nowMs = Date.now();

      try {
        return await db.runTransaction(async (tx) => {
          const [existing, packageSnap] = await Promise.all([tx.get(ledgerRef), tx.get(packageRef)]);
          if (existing.exists) {
            const prior = existing.data() || {};
            if (prior.clientPackageId !== clientPackageId || Number(prior.sessionsDelta) !== sessionsDelta) {
              throw new HttpsError("already-exists", "Adjustment idempotency key is already used");
            }
            return { ok: true, idempotent: true, packageTransactionId: adjustmentTxId };
          }
          if (!packageSnap.exists) throw new HttpsError("not-found", "Client package was not found");
          const raw = packageSnap.data() || {};
          const clientId = requiredString(raw.clientId, "clientId");
          const transition = adjustRemainingBalance(balancesFromDoc(raw, nowMs), sessionsDelta, nowMs);
          tx.update(packageRef, statusPatch(transition.after));
          tx.create(
            ledgerRef,
            ledgerPayload({
              clientPackageId,
              clientId,
              type: "admin_adjustment",
              idempotencyKey: adjustmentTxId,
              actorUid: actor.uid,
              before: transition.before,
              after: transition.after,
              sessionsDelta: transition.sessionsDelta,
              reason,
            })
          );
          return { ok: true, idempotent: false, packageTransactionId: adjustmentTxId };
        });
      } catch (error) {
        return mapError(error);
      }
    },
  };
}
