import { AppError } from './errors.js';
import {
  ADMIN_ROLES,
  PACKAGE_LIMITS,
  SALES_ROLES,
  adjustRemainingBalance,
  appointmentTimestampMs,
  balancesFromDoc,
  boundedInteger,
  boundedText,
  buildBookingSlotId,
  buildLockedTimes,
  buildPurchasedPackageSnapshot,
  cancelPackageBalance,
  cancellationPolicy,
  cleanText,
  consumeOneReservedSession,
  ledgerPayload,
  normalizePaymentMethod,
  normalizeStringArray,
  optionalDocumentId,
  optionalText,
  packageCandidateFromDoc,
  phoneCandidates,
  requiredDocumentId,
  requiredExternalId,
  requireRole,
  reserveOneSession,
  resolveSlotSettings,
  restoreOneReservedSession,
  restoreOneUsedSession,
  salonPath,
  selectNearestExpiringPackage,
  sha256Hex,
  shouldConsumeCancelledReservation,
  stableLegacyClientId,
  statusPatch,
  timestampFromMs,
  timestampMs,
  timestampNow,
  transactionId,
} from './validation.js';

const CLIENT_LOOKUP_ID_FIELDS = ["clientId", "customerId", "authUid", "uid", "userId", "firebaseUid"];
const CLIENT_LOOKUP_PHONE_FIELDS = ["phone", "mobile", "clientPhone", "phoneNumber"];

function isSafeDocumentId(value) {
  const normalized = cleanText(value);
  return (
    !!normalized &&
    normalized.length <= 128 &&
    !normalized.includes("/") &&
    normalized !== "." &&
    normalized !== ".."
  );
}

function normalizeLookupPhone(value) {
  const raw = cleanText(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

function collectClientLookupCandidates(requestedId, lookup, kind) {
  const raw = lookup && typeof lookup === "object" ? lookup : {};
  const out = [];
  const seen = new Set();

  const addId = (inputField, value) => {
    const normalized = cleanText(value);
    if (!normalized) return;
    if (normalized.length > 256) return;
    const key = `id:${inputField}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ inputField, value: normalized, kind: "id" });
  };

  const addPhone = (inputField, value) => {
    const normalized = normalizeLookupPhone(value);
    if (!normalized) return;
    const key = `phone:${inputField}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ inputField, value: normalized, kind: "phone" });
  };

  if (kind === "id") {
    addId("requestedClientId", requestedId);
    addId("id", raw.id);
    addId("docId", raw.docId);
    addId("clientId", raw.clientId);
    addId("customerId", raw.customerId);
    addId("authUid", raw.authUid);
    addId("uid", raw.uid);
    addId("userId", raw.userId);
    addId("firebaseUid", raw.firebaseUid);
  } else {
    addPhone("phone", raw.phone);
    addPhone("mobile", raw.mobile);
    addPhone("clientPhone", raw.clientPhone);
    addPhone("phoneNumber", raw.phoneNumber);
  }

  return out;
}

async function safeLookupLog(event, salonId, candidates, extra = {}) {
  try {
    const identifiers = await Promise.all(
      candidates.map(async (candidate) => ({
        inputField: candidate.inputField,
        kind: candidate.kind,
        length: cleanText(candidate.value).length,
        hash: (await sha256Hex(cleanText(candidate.value))).slice(0, 12),
      }))
    );
    console.info("packages_client_lookup", {
      event,
      salonId,
      inputFields: [...new Set(candidates.map((candidate) => candidate.inputField))],
      lookupFields: extra.lookupFields || [],
      identifiers,
      ...(extra.matchCount !== undefined ? { matchCount: extra.matchCount } : {}),
      ...(extra.matchedBy ? { matchedBy: extra.matchedBy } : {}),
    });
  } catch {
    console.info("packages_client_lookup", { event, salonId });
  }
}

function materializeClientIdentity(snap) {
  const raw = snap.data || {};
  const existingStableId = cleanText(raw.clientId);
  return { raw, existingStableId };
}

function clientAliasIds(raw, snapId, clientId, extra = []) {
  const values = [
    clientId,
    snapId,
    raw.clientId,
    raw.legacyClientDocId,
    raw.customerId,
    raw.authUid,
    raw.uid,
    raw.userId,
    raw.firebaseUid,
    ...extra,
  ];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized || normalized.length > 256 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function buildClientIdentityResult(salonId, snap) {
  const { raw, existingStableId } = materializeClientIdentity(snap);
  const clientId = existingStableId || await stableLegacyClientId(salonId, snap.id);
  return {
    snap,
    clientId,
    canonicalClientId: clientId,
    legacyClientDocId: snap.id === clientId ? undefined : snap.id,
    phoneSnapshot: optionalText(raw.phone || raw.mobile || raw.clientPhone || raw.phoneNumber),
    nameSnapshot: optionalText(raw.name || raw.fullName || raw.clientName),
    aliasClientIds: clientAliasIds(raw, snap.id, clientId),
    needsLink: !existingStableId,
  };
}

async function buildClientIdentityResultWithAliases(salonId, snap, extraAliases = []) {
  const result = await buildClientIdentityResult(salonId, snap);
  const raw = snap.data || {};
  return {
    ...result,
    aliasClientIds: clientAliasIds(raw, snap.id, result.clientId, [
      ...(result.aliasClientIds || []),
      ...extraAliases,
    ]),
  };
}

export async function resolveClientIdentity(tx, salonId, requestedId, lookup = {}) {
  const directPath = salonPath(salonId, "clients", requestedId);
  const direct = await tx.get(directPath);
  if (direct.exists) return buildClientIdentityResultWithAliases(salonId, direct, [requestedId]);

  const idCandidates = collectClientLookupCandidates(requestedId, lookup, "id");
  const strongMatches = new Map();
  const strongMatchedBy = new Map();
  const strongLookupFields = new Set(["documentId", ...CLIENT_LOOKUP_ID_FIELDS]);

  const addStrongMatch = (snap, by) => {
    if (!snap?.exists) return;
    strongMatches.set(snap.path, snap);
    const list = strongMatchedBy.get(snap.path) || [];
    list.push(by);
    strongMatchedBy.set(snap.path, list);
  };

  for (const candidate of idCandidates) {
    if (!isSafeDocumentId(candidate.value) || candidate.value === requestedId) continue;
    const altDirect = await tx.get(salonPath(salonId, "clients", candidate.value));
    addStrongMatch(altDirect, `documentId:${candidate.inputField}`);
  }

  for (const candidate of idCandidates) {
    for (const field of CLIENT_LOOKUP_ID_FIELDS) {
      const rows = await tx.query(salonPath(salonId), "clients", [[field, "EQUAL", candidate.value]], 3);
      rows.forEach((row) => addStrongMatch(row, `${field}:${candidate.inputField}`));
    }
  }

  if (strongMatches.size === 1) {
    const [snap] = strongMatches.values();
    await safeLookupLog("strong_match", salonId, idCandidates, {
      lookupFields: [...strongLookupFields],
      matchCount: 1,
      matchedBy: strongMatchedBy.get(snap.path) || [],
    });
    return buildClientIdentityResultWithAliases(salonId, snap, idCandidates.map((candidate) => candidate.value));
  }
  if (strongMatches.size > 1) {
    await safeLookupLog("duplicate_identity", salonId, idCandidates, {
      lookupFields: [...strongLookupFields],
      matchCount: strongMatches.size,
    });
    throw new AppError(409, "packages_client:duplicate_identity");
  }

  const phoneCandidatesFromPayload = collectClientLookupCandidates(requestedId, lookup, "phone");
  const phoneMatches = new Map();
  const phoneMatchedBy = new Map();
  const phoneLookupFields = new Set(CLIENT_LOOKUP_PHONE_FIELDS);
  const addPhoneMatch = (snap, by) => {
    if (!snap?.exists) return;
    phoneMatches.set(snap.path, snap);
    const list = phoneMatchedBy.get(snap.path) || [];
    list.push(by);
    phoneMatchedBy.set(snap.path, list);
  };

  const phoneValues = new Set();
  for (const candidate of phoneCandidatesFromPayload) {
    phoneCandidates(candidate.value).forEach((phone) => phoneValues.add(phone));
  }
  for (const phone of phoneValues) {
    for (const field of CLIENT_LOOKUP_PHONE_FIELDS) {
      const rows = await tx.query(salonPath(salonId), "clients", [[field, "EQUAL", phone]], 3);
      rows.forEach((row) => addPhoneMatch(row, `${field}:phone`));
    }
  }

  if (phoneMatches.size === 1) {
    const [snap] = phoneMatches.values();
    await safeLookupLog("phone_match", salonId, phoneCandidatesFromPayload, {
      lookupFields: [...phoneLookupFields],
      matchCount: 1,
      matchedBy: phoneMatchedBy.get(snap.path) || [],
    });
    return buildClientIdentityResultWithAliases(salonId, snap);
  }
  if (phoneMatches.size > 1) {
    await safeLookupLog("duplicate_identity", salonId, phoneCandidatesFromPayload, {
      lookupFields: [...phoneLookupFields],
      matchCount: phoneMatches.size,
    });
    throw new AppError(409, "packages_client:duplicate_identity");
  }

  await safeLookupLog("not_found", salonId, [...idCandidates, ...phoneCandidatesFromPayload], {
    lookupFields: [...new Set([...strongLookupFields, ...phoneLookupFields])],
    matchCount: 0,
  });
  throw new AppError(404, "packages_client:not_found", "Client was not found");
}

export async function resolveAuthenticatedClientIdentity(db, salonId, identity) {
  const userPath = salonPath(salonId, "users", identity.uid);
  const userSnap = await db.getDoc(userPath);
  const linkedId = cleanText(userSnap.data?.clientId);
  if (linkedId) {
    const direct = await db.getDoc(salonPath(salonId, "clients", linkedId));
    if (direct.exists) return { clientId: linkedId, clientSnap: direct, userSnap };
    const byStable = await db.query(salonPath(salonId), "clients", [["clientId", "EQUAL", linkedId]], 2);
    if (byStable.length === 1) return { clientId: linkedId, clientSnap: byStable[0], userSnap };
    if (byStable.length > 1) throw new AppError(409, "packages_client:duplicate_identity");
  }
  const byAuth = await db.query(salonPath(salonId), "clients", [["authUid", "EQUAL", identity.uid]], 2);
  if (byAuth.length > 1) throw new AppError(409, "packages_client:multiple_auth_matches");
  if (byAuth.length === 1) {
    const snap = byAuth[0];
    const clientId = cleanText(snap.data?.clientId) || await stableLegacyClientId(salonId, snap.id);
    await db.runTransaction(async (tx) => {
      tx.set(userPath, { clientId, identityLinkedAt: timestampNow(), updatedAt: timestampNow() });
      tx.set(snap.path, { clientId, authUid: identity.uid, legacyClientDocId: snap.id === clientId ? null : snap.id, updatedAt: timestampNow() });
    });
    return { clientId, clientSnap: { ...snap, data: { ...snap.data, clientId } }, userSnap };
  }
  const verifiedPhone = cleanText(identity.claims?.phone_number);
  if (!verifiedPhone) throw new AppError(409, "packages_client:phone_verification_required");
  const candidates = phoneCandidates(verifiedPhone);
  const matches = new Map();
  for (const phone of candidates) {
    const rows = await db.query(salonPath(salonId), "clients", [["phone", "EQUAL", phone]], 3);
    rows.forEach((row) => matches.set(row.id, row));
  }
  if (matches.size !== 1) throw new AppError(409, "packages_client:manual_identity_review");
  const snap = [...matches.values()][0];
  const existingAuth = cleanText(snap.data?.authUid);
  if (existingAuth && existingAuth !== identity.uid) throw new AppError(403, "packages_client:linked_to_another_account");
  const clientId = cleanText(snap.data?.clientId) || await stableLegacyClientId(salonId, snap.id);
  await db.runTransaction(async (tx) => {
    tx.set(userPath, { clientId, identityLinkedAt: timestampNow(), updatedAt: timestampNow() });
    tx.set(snap.path, { clientId, authUid: identity.uid, legacyClientDocId: snap.id === clientId ? null : snap.id, updatedAt: timestampNow() });
  });
  return { clientId, clientSnap: { ...snap, data: { ...snap.data, clientId } }, userSnap };
}

export async function purchasePackage(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const clientId = requiredDocumentId(data.clientId, "clientId");
  const packageCatalogId = requiredDocumentId(data.packageCatalogId, "packageCatalogId");
  const invoiceId = requiredExternalId(data.invoiceId, "invoiceId");
  const paymentMethod = normalizePaymentMethod(data.paymentMethod);
  const purchaseTxId = await transactionId("purchase", invoiceId);
  const invoiceDocumentId = purchaseTxId.replace(/^purchase:/, "invoice_");
  const nowIso = timestampNow();
  const nowMs = Date.now();

  return ctx.db.runTransaction(async (tx) => {
    const transactionPath = salonPath(ctx.salonId, "client_package_transactions", purchaseTxId);
    const catalogPath = salonPath(ctx.salonId, "packages_catalog", packageCatalogId);
    const invoicePath = salonPath(ctx.salonId, "invoices", invoiceDocumentId);
    const financePath = salonPath(ctx.salonId, "settings", "finance");
    const counterPath = salonPath(ctx.salonId, "counters", "invoices");
    const incomePath = salonPath(ctx.salonId, "income", purchaseTxId);
    const clientPackageId = crypto.randomUUID();
    const clientPackagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);

    const [existingTransaction, catalogSnap, invoiceSnap, financeSettingsSnap, counterSnap] = await Promise.all([
      tx.get(transactionPath),
      tx.get(catalogPath),
      tx.get(invoicePath),
      tx.get(financePath),
      tx.get(counterPath),
    ]);
    if (existingTransaction.exists) {
      const existing = existingTransaction.data || {};
      if (
        existing.invoiceId !== invoiceId ||
        existing.packageCatalogId !== packageCatalogId ||
        ![existing.requestedClientId, existing.clientId].includes(clientId)
      ) {
        throw new AppError(409, "packages_idempotency:purchase_conflict");
      }
      return {
        ok: true,
        idempotent: true,
        clientPackageId: cleanText(existing.clientPackageId),
        invoiceId,
        invoiceDocumentId: cleanText(existing.invoiceDocumentId || invoiceDocumentId),
        invoiceNumber: cleanText(existing.invoiceNumber),
        clientId: cleanText(existing.clientId),
      };
    }
    const client = await resolveClientIdentity(tx, ctx.salonId, clientId, data.clientLookup);
    if (!catalogSnap.exists) throw new AppError(404, "packages_catalog:not_found");
    if (invoiceSnap.exists) throw new AppError(409, "packages_invoice:duplicate_id");
    const catalog = catalogSnap.data || {};
    if (catalog.active === false) throw new AppError(409, "packages_catalog:inactive");
    const snapshot = buildPurchasedPackageSnapshot(catalog);
    const expiresAt = snapshot.validityDays ? timestampFromMs(nowMs + snapshot.validityDays * 24 * 60 * 60 * 1000) : undefined;
    const taxRateRaw = Number(financeSettingsSnap.data?.taxRate ?? financeSettingsSnap.data?.vatRate ?? 0);
    const taxRate = Number.isFinite(taxRateRaw) ? Math.min(100, Math.max(0, taxRateRaw)) : 0;
    const taxAmount = taxRate > 0 ? Math.round((snapshot.price - snapshot.price / (1 + taxRate / 100)) * 100) / 100 : 0;
    const subtotalBeforeTax = Math.round((snapshot.price - taxAmount) * 100) / 100;
    const nextInvoice = Number(counterSnap.data?.next || 10000) + 1;
    const invoiceNumber = `INV-${String(nextInvoice).padStart(5, "0")}`;
    const before = { totalSessions: 0, remainingSessions: 0, reservedSessions: 0, usedSessions: 0, status: "active", expiresAtMs: timestampMs(expiresAt) };
    const after = { ...before, totalSessions: snapshot.sessionsCount, remainingSessions: snapshot.sessionsCount };

    tx.create(clientPackagePath, {
      clientId: client.clientId,
      ...(client.legacyClientDocId ? { legacyClientDocId: client.legacyClientDocId } : {}),
      ...(client.phoneSnapshot ? { phoneSnapshot: client.phoneSnapshot } : {}),
      packageCatalogId,
      packageNameSnapshot: snapshot.name,
      ...(snapshot.description ? { packageDescriptionSnapshot: snapshot.description } : {}),
      allowedServiceIdsSnapshot: snapshot.allowedServiceIds,
      totalSessions: snapshot.sessionsCount,
      remainingSessions: snapshot.sessionsCount,
      reservedSessions: 0,
      usedSessions: 0,
      purchasePrice: snapshot.price,
      purchasedAt: nowIso,
      ...(expiresAt ? { expiresAt } : {}),
      status: "active",
      invoiceId,
      invoiceDocumentId,
      catalogSnapshot: snapshot,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    tx.create(invoicePath, {
      invoiceType: "package_purchase",
      invoiceId,
      invoiceDocumentId,
      clientId: client.clientId,
      ...(client.legacyClientDocId ? { legacyClientDocId: client.legacyClientDocId } : {}),
      invoiceNumber,
      clientPackageId,
      packageCatalogId,
      packageNameSnapshot: snapshot.name,
      quantity: 1,
      subtotal: subtotalBeforeTax,
      taxRate,
      taxAmount,
      total: snapshot.price,
      paidAmount: snapshot.price,
      remainingAmount: 0,
      status: "paid",
      paymentMethod,
      issuedAt: nowIso,
      createdBy: ctx.identity.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    tx.create(transactionPath, {
      ...ledgerPayload({
        clientPackageId,
        clientId: client.clientId,
        type: "purchase",
        idempotencyKey: purchaseTxId,
        actorUid: ctx.identity.uid,
        before,
        after,
        sessionsDelta: snapshot.sessionsCount,
        invoiceId,
      }, nowIso),
      packageCatalogId,
      requestedClientId: clientId,
      invoiceNumber,
      invoiceDocumentId,
    });
    tx.set(incomePath, {
      source: "package_purchase",
      invoiceId,
      invoiceDocumentId,
      clientPackageId,
      clientId: client.clientId,
      amount: snapshot.price,
      method: paymentMethod,
      taxRate,
      taxAmount,
      status: "completed",
      date: nowIso.slice(0, 10),
      note: `package_purchase:${snapshot.name}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    tx.set(counterPath, { next: nextInvoice, updatedAt: nowIso });
    if (client.needsLink) {
      tx.update(client.snap.path, {
        clientId: client.clientId,
        legacyClientDocId: client.snap.id,
        identityLinkedAt: nowIso,
        updatedAt: nowIso,
      });
    }
    return { ok: true, idempotent: false, clientPackageId, invoiceId, invoiceDocumentId, invoiceNumber, clientId: client.clientId };
  });
}

export async function createRedemptionBooking(ctx, data) {
  if (!SALES_ROLES.has(ctx.role) && ctx.role !== "client") throw new AppError(403, "packages_auth:insufficient_permissions");
  const requestedClientId = ctx.role === "client"
    ? (await resolveAuthenticatedClientIdentity(ctx.db, ctx.salonId, ctx.identity)).clientId
    : requiredDocumentId(data.clientId, "clientId");
  const serviceId = requiredDocumentId(data.serviceId, "serviceId");
  const employeeId = requiredDocumentId(data.employeeId, "employeeId");
  const date = requiredDocumentId(data.date, "date");
  const time = requiredDocumentId(data.time, "time");
  const operationId = requiredExternalId(data.operationId, "operationId");
  const requestedClientPackageId = optionalDocumentId(data.clientPackageId, "clientPackageId");
  const nowIso = timestampNow();
  const nowMs = Date.now();
  const appointmentAtMs = appointmentTimestampMs(date, time);
  const bookingId = (await transactionId("reserve", operationId)).replace(/^reserve:/, "pkg_");
  const reserveTxId = await transactionId("reserve", bookingId);

  return ctx.db.runTransaction(async (tx) => {
    const bookingPath = salonPath(ctx.salonId, "bookings", bookingId);
    const ledgerPath = salonPath(ctx.salonId, "client_package_transactions", reserveTxId);
    const existingLedger = await tx.get(ledgerPath);
    if (existingLedger.exists) {
      const prior = existingLedger.data || {};
      if (
        prior.idempotencySource !== operationId ||
        ![prior.requestedClientId, prior.clientId].includes(requestedClientId) ||
        (prior.requestedClientPackageId || undefined) !== requestedClientPackageId ||
        prior.serviceId !== serviceId ||
        prior.employeeId !== employeeId ||
        prior.appointmentAtMs !== appointmentAtMs
      ) {
        throw new AppError(409, "packages_idempotency:redemption_conflict");
      }
      return {
        ok: true,
        idempotent: true,
        bookingId: cleanText(prior.bookingId),
        publicId: cleanText(prior.bookingPublicId),
        clientPackageId: cleanText(prior.clientPackageId),
        packageTransactionId: reserveTxId,
      };
    }

    const client = await resolveClientIdentity(tx, ctx.salonId, requestedClientId, data.clientLookup);
    const servicePath = salonPath(ctx.salonId, "services", serviceId);
    const employeePath = salonPath(ctx.salonId, "staff_public", employeeId);
    const settingsPath = salonPath(ctx.salonId, "settings", "app");
    const counterPath = salonPath(ctx.salonId, "counters", "bookings");
    const [serviceSnap, employeeSnap, settingsSnap, counterSnap] = await Promise.all([
      tx.get(servicePath),
      tx.get(employeePath),
      tx.get(settingsPath),
      tx.get(counterPath),
    ]);
    if (!serviceSnap.exists || serviceSnap.data?.active === false) throw new AppError(409, "packages_service:unavailable");
    if (!employeeSnap.exists) throw new AppError(404, "packages_employee:not_found");
    const employee = employeeSnap.data || {};
    if (
      employee.active === false ||
      employee.isActive === false ||
      employee.removedFromStaff === true ||
      cleanText(employee.employmentStatus || "active") !== "active"
    ) {
      throw new AppError(409, "packages_employee:not_operational");
    }
    const employeeServices = normalizeStringArray(employee.serviceIds || employee.allowedServiceIds || employee.services);
    if (employeeServices.length && !employeeServices.includes(serviceId)) {
      throw new AppError(409, "packages_employee:service_not_supported");
    }

    const service = serviceSnap.data || {};
    const durationRaw = Number(service.durationMin || service.duration || 60);
    if (!Number.isFinite(durationRaw) || durationRaw <= 0) throw new AppError(409, "packages_service:invalid_duration");
    const durationMin = Math.min(PACKAGE_LIMITS.serviceDurationMinutes, Math.max(1, Math.floor(durationRaw)));
    const slotSettings = resolveSlotSettings(settingsSnap.data || {}, date);
    const lockedTimes = buildLockedTimes({ settings: slotSettings, startTime: time, durationMin });
    const lockedSlotIds = lockedTimes.map((lockedTime) => buildBookingSlotId(ctx.salonId, date, lockedTime, employeeId));
    const slotPaths = lockedSlotIds.map((id) => salonPath(ctx.salonId, "booking_slots", id));
    const availabilityPath = salonPath(ctx.salonId, "availability_days", date, "employees", employeeId);

    const clientAliases = new Set(clientAliasIds({}, "", client.clientId, client.aliasClientIds || []));
    let packageSnap;
    if (requestedClientPackageId) {
      packageSnap = await tx.get(salonPath(ctx.salonId, "client_packages", requestedClientPackageId));
      if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    } else {
      const packageRowsByPath = new Map();
      for (const alias of clientAliases) {
        const rows = await tx.query(salonPath(ctx.salonId), "client_packages", [["clientId", "EQUAL", alias]]);
        rows.forEach((doc) => packageRowsByPath.set(doc.path, doc));
      }
      const packageRows = [...packageRowsByPath.values()];
      const candidates = packageRows.flatMap((doc) => {
        try {
          const candidate = packageCandidateFromDoc(doc, nowMs);
          if (clientAliases.has(candidate.clientId)) candidate.clientId = client.clientId;
          return [candidate];
        } catch (error) {
          console.warn("packages_redemption_excluded_package", { packageId: doc.id, reason: cleanText(error?.code || error?.message || "invalid_package") });
          return [];
        }
      });
      const selected = selectNearestExpiringPackage(candidates, client.clientId, serviceId, nowMs, appointmentAtMs);
      if (!selected) throw new AppError(409, "packages_client_package:no_eligible_balance");
      packageSnap = packageRows.find((doc) => doc.id === selected.id);
    }

    const availabilitySnap = await tx.get(availabilityPath);
    const slotSnaps = await tx.getMany(slotPaths);
    if (slotSnaps.some((snap) => snap.exists)) throw new AppError(409, "packages_booking:slot_conflict");

    const clientPackage = packageSnap.data || {};
    const storedPackageClientId = cleanText(clientPackage.clientId);
    if (!clientAliases.has(storedPackageClientId)) throw new AppError(403, "packages_client_package:not_owner");
    const allowedServices = normalizeStringArray(clientPackage.allowedServiceIdsSnapshot);
    if (!allowedServices.length) throw new AppError(409, "packages_client_package:legacy_review_required");
    if (!allowedServices.includes(serviceId)) throw new AppError(409, "packages_client_package:service_not_included");
    const expiresAtMs = timestampMs(clientPackage.expiresAt);
    if (expiresAtMs !== undefined && appointmentAtMs > expiresAtMs) throw new AppError(409, "packages_client_package:appointment_after_expiry");
    const transition = reserveOneSession(clientPackage, nowMs);
    const nextCounter = Number(counterSnap.data?.next || 10000) + 1;
    const publicId = `MK-${String(nextCounter).padStart(5, "0")}`;
    const packageNameSnapshot = cleanText(clientPackage.packageNameSnapshot);
    const serviceName = cleanText(service.name || service.title || service.serviceName || serviceId);
    const employeeName = cleanText(employee.name || employee.displayName || employeeId);
    const appointmentAt = timestampFromMs(appointmentAtMs);

    tx.update(packageSnap.path, {
      ...statusPatch(transition.after, nowIso),
      ...(storedPackageClientId !== client.clientId ? { clientId: client.clientId, legacyClientId: storedPackageClientId } : {}),
    });
    tx.create(ledgerPath, {
      ...ledgerPayload({
        clientPackageId: packageSnap.id,
        clientId: client.clientId,
        type: "reserve",
        idempotencyKey: reserveTxId,
        actorUid: ctx.identity.uid,
        before: transition.before,
        after: transition.after,
        sessionsDelta: transition.sessionsDelta,
        bookingId,
        serviceId,
      }, nowIso),
      idempotencySource: operationId,
      requestedClientId,
      ...(requestedClientPackageId ? { requestedClientPackageId } : {}),
      bookingPublicId: publicId,
      employeeId,
      appointmentAt,
      appointmentAtMs,
    });
    tx.create(bookingPath, {
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
        catalogPriceAtBooking: Number.isFinite(Number(service.price)) ? Math.max(0, Number(service.price)) : 0,
        durationAtBooking: durationMin,
        ...(optionalText(service.sectionId) ? { sectionIdAtBooking: optionalText(service.sectionId) } : {}),
        ...(optionalText(service.categoryId) ? { categoryIdAtBooking: optionalText(service.categoryId) } : {}),
      },
      employeeId,
      ...(optionalText(employee.linkedUid || employee.uid) ? { employeeUid: optionalText(employee.linkedUid || employee.uid) } : {}),
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
      channel: ctx.role === "client" ? "client" : "internal",
      createdBy: ctx.identity.uid,
      createdByUid: ctx.identity.uid,
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
      invoiceId: bookingId,
      createdAtMs: nowMs,
      confirmedAt: nowMs,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    slotPaths.forEach((slotPath, index) => {
      tx.create(slotPath, {
        bookingId,
        employeeId,
        employeeUid: optionalText(employee.linkedUid || employee.uid) || null,
        employeeName,
        employeeKey: employeeId,
        date,
        time: lockedTimes[index],
        startTime: time,
        durationMin,
        clientId: client.clientId,
        clientPhone: client.phoneSnapshot || "",
        createdAt: nowIso,
      });
    });
    const bookedSlots = { ...(availabilitySnap.data?.bookedSlots || {}) };
    lockedTimes.forEach((value) => { bookedSlots[value] = true; });
    tx.set(availabilityPath, {
      date,
      employeeId,
      employeeKey: employeeId,
      bookedSlots,
      complete: availabilitySnap.data?.complete === true,
      updatedAt: nowIso,
    });
    tx.set(counterPath, { next: nextCounter, updatedAt: nowIso });
    tx.create(salonPath(ctx.salonId, "invoices", bookingId), {
      invoiceType: "package_redemption",
      invoiceNumber: publicId,
      bookingId,
      clientId: client.clientId,
      clientPackageId: packageSnap.id,
      serviceId,
      serviceNameSnapshot: serviceName,
      total: 0,
      paidAmount: 0,
      remainingAmount: 0,
      status: "settled_by_package",
      issuedAt: nowIso,
      createdBy: ctx.identity.uid,
      createdAt: nowIso,
    });
    tx.set(salonPath(ctx.salonId, "booking_tracks", bookingId), {
      bookingId,
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
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    if (client.needsLink) {
      tx.update(client.snap.path, {
        clientId: client.clientId,
        legacyClientDocId: client.snap.id,
        identityLinkedAt: nowIso,
        updatedAt: nowIso,
      });
    }
    return { ok: true, idempotent: false, bookingId, publicId, clientPackageId: packageSnap.id, packageTransactionId: reserveTxId, clientId: client.clientId };
  });
}

export async function consumeReserved(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const bookingId = requiredDocumentId(data.bookingId, "bookingId");
  const consumeTxId = await transactionId("consume", bookingId);
  const reserveTxId = await transactionId("reserve", bookingId);
  const restoreTxId = await transactionId("restore", bookingId);
  const nowMs = Date.now();
  const nowIso = timestampNow();
  return ctx.db.runTransaction(async (tx) => {
    const consumePath = salonPath(ctx.salonId, "client_package_transactions", consumeTxId);
    const reservePath = salonPath(ctx.salonId, "client_package_transactions", reserveTxId);
    const restorePath = salonPath(ctx.salonId, "client_package_transactions", restoreTxId);
    const bookingPath = salonPath(ctx.salonId, "bookings", bookingId);
    const [existing, reserveSnap, restoreSnap, bookingSnap] = await Promise.all([
      tx.get(consumePath),
      tx.get(reservePath),
      tx.get(restorePath),
      tx.get(bookingPath),
    ]);
    if (existing.exists) return { ok: true, idempotent: true, packageTransactionId: consumeTxId };
    if (!reserveSnap.exists) throw new AppError(409, "packages_redemption:reserve_missing");
    if (restoreSnap.exists) throw new AppError(409, "packages_redemption:already_restored");
    if (!bookingSnap.exists || cleanText(bookingSnap.data?.status) !== "completed") {
      throw new AppError(409, "packages_redemption:booking_must_be_completed");
    }
    const reserve = reserveSnap.data || {};
    if (reserve.serviceId && bookingSnap.data?.serviceId && reserve.serviceId !== bookingSnap.data.serviceId) {
      throw new AppError(409, "packages_redemption:service_changed");
    }
    const clientPackageId = requiredDocumentId(reserve.clientPackageId, "clientPackageId");
    const clientId = requiredDocumentId(reserve.clientId, "clientId");
    const packagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);
    const packageSnap = await tx.get(packagePath);
    if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    const transition = consumeOneReservedSession(packageSnap.data || {}, nowMs);
    tx.update(packagePath, statusPatch(transition.after, nowIso));
    tx.create(consumePath, ledgerPayload({
      clientPackageId,
      clientId,
      type: "consume",
      idempotencyKey: consumeTxId,
      actorUid: ctx.identity.uid,
      before: transition.before,
      after: transition.after,
      sessionsDelta: transition.sessionsDelta,
      bookingId,
      serviceId: optionalText(reserve.serviceId),
    }, nowIso));
    tx.update(bookingPath, { packageTransactionId: consumeTxId, packageRedemptionState: "consumed", updatedAt: nowIso });
    return { ok: true, idempotent: false, packageTransactionId: consumeTxId };
  });
}

export async function restoreRedemption(ctx, data) {
  requireRole(ctx.role, ADMIN_ROLES);
  const bookingId = requiredDocumentId(data.bookingId, "bookingId");
  const reason = boundedText(data.reason, "reason", PACKAGE_LIMITS.reason, Boolean(data.operationId));
  if (data.operationId) return adminRestoreConsumed(ctx, data);
  const restoreTxId = await transactionId("restore", bookingId);
  const reserveTxId = await transactionId("reserve", bookingId);
  const consumeTxId = await transactionId("consume", bookingId);
  const nowMs = Date.now();
  const nowIso = timestampNow();
  return ctx.db.runTransaction(async (tx) => {
    const restorePath = salonPath(ctx.salonId, "client_package_transactions", restoreTxId);
    const reservePath = salonPath(ctx.salonId, "client_package_transactions", reserveTxId);
    const consumePath = salonPath(ctx.salonId, "client_package_transactions", consumeTxId);
    const bookingPath = salonPath(ctx.salonId, "bookings", bookingId);
    const [existing, reserveSnap, consumeSnap, bookingSnap] = await Promise.all([
      tx.get(restorePath),
      tx.get(reservePath),
      tx.get(consumePath),
      tx.get(bookingPath),
    ]);
    if (existing.exists) return { ok: true, idempotent: true, packageTransactionId: restoreTxId };
    if (!reserveSnap.exists) throw new AppError(409, "packages_redemption:reserve_missing");
    if (consumeSnap.exists) throw new AppError(409, "packages_redemption:already_consumed");
    if (!bookingSnap.exists || cleanText(bookingSnap.data?.status) !== "cancelled") {
      throw new AppError(409, "packages_redemption:booking_must_be_cancelled");
    }
    const reserve = reserveSnap.data || {};
    const clientPackageId = requiredDocumentId(reserve.clientPackageId, "clientPackageId");
    const clientId = requiredDocumentId(reserve.clientId, "clientId");
    const packagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);
    const packageSnap = await tx.get(packagePath);
    if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    const transition = restoreOneReservedSession(packageSnap.data || {}, nowMs);
    tx.update(packagePath, statusPatch(transition.after, nowIso));
    tx.create(restorePath, ledgerPayload({
      clientPackageId,
      clientId,
      type: "restore",
      idempotencyKey: restoreTxId,
      actorUid: ctx.identity.uid,
      before: transition.before,
      after: transition.after,
      sessionsDelta: transition.sessionsDelta,
      bookingId,
      serviceId: optionalText(reserve.serviceId),
      reason,
    }, nowIso));
    tx.update(bookingPath, { packageTransactionId: restoreTxId, packageRedemptionState: "restored", updatedAt: nowIso });
    return { ok: true, idempotent: false, packageTransactionId: restoreTxId };
  });
}

export async function cancelRedemption(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const bookingId = requiredDocumentId(data.bookingId, "bookingId");
  const reason = boundedText(data.reason, "reason", PACKAGE_LIMITS.reason, true);
  const reserveTxId = await transactionId("reserve", bookingId);
  const restoreTxId = await transactionId("restore", bookingId);
  const consumeTxId = await transactionId("consume", bookingId);
  const nowMs = Date.now();
  const nowIso = timestampNow();
  return ctx.db.runTransaction(async (tx) => {
    const bookingPath = salonPath(ctx.salonId, "bookings", bookingId);
    const reservePath = salonPath(ctx.salonId, "client_package_transactions", reserveTxId);
    const restorePath = salonPath(ctx.salonId, "client_package_transactions", restoreTxId);
    const consumePath = salonPath(ctx.salonId, "client_package_transactions", consumeTxId);
    const settingsPath = salonPath(ctx.salonId, "settings", "package_subscriptions");
    const [bookingSnap, reserveSnap, restoreSnap, consumeSnap, settingsSnap] = await Promise.all([
      tx.get(bookingPath), tx.get(reservePath), tx.get(restorePath), tx.get(consumePath), tx.get(settingsPath),
    ]);
    if (restoreSnap.exists || consumeSnap.exists) {
      const terminal = restoreSnap.exists ? restoreSnap : consumeSnap;
      if (terminal.data?.resolutionReason !== "cancellation") {
        throw new AppError(409, "packages_redemption:terminal_conflict");
      }
      return { ok: true, idempotent: true, action: cleanText(terminal.data?.type), packageTransactionId: terminal.id };
    }
    if (!bookingSnap.exists || !reserveSnap.exists) throw new AppError(409, "packages_redemption:reservation_incomplete");
    const booking = bookingSnap.data || {};
    const reserve = reserveSnap.data || {};
    const appointmentAtMs = timestampMs(booking.appointmentAt) || appointmentTimestampMs(cleanText(booking.date), cleanText(booking.time));
    const policy = cancellationPolicy(settingsSnap.data || {});
    const consume = shouldConsumeCancelledReservation({ nowMs, appointmentAtMs, policy });
    const clientPackageId = requiredDocumentId(reserve.clientPackageId, "clientPackageId");
    const clientId = requiredDocumentId(reserve.clientId, "clientId");
    const packagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);
    const packageSnap = await tx.get(packagePath);
    if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    const lockedSlotIds = normalizeStringArray(Array.isArray(booking.lockedSlotIds) ? booking.lockedSlotIds : [booking.slotId]).map((id) => requiredDocumentId(id, "lockedSlotId"));
    const slotPaths = lockedSlotIds.map((id) => salonPath(ctx.salonId, "booking_slots", id));
    const availabilityPath = salonPath(ctx.salonId, "availability_days", requiredDocumentId(booking.date, "booking.date"), "employees", requiredDocumentId(booking.employeeId, "booking.employeeId"));
    const availabilitySnap = await tx.get(availabilityPath);
    const slotSnaps = await tx.getMany(slotPaths);
    const transition = consume ? consumeOneReservedSession(packageSnap.data || {}, nowMs) : restoreOneReservedSession(packageSnap.data || {}, nowMs);
    const terminalTxId = consume ? consumeTxId : restoreTxId;
    const terminalPath = consume ? consumePath : restorePath;
    tx.update(packagePath, statusPatch(transition.after, nowIso));
    tx.create(terminalPath, {
      ...ledgerPayload({
        clientPackageId,
        clientId,
        type: consume ? "consume" : "restore",
        idempotencyKey: terminalTxId,
        actorUid: ctx.identity.uid,
        before: transition.before,
        after: transition.after,
        sessionsDelta: transition.sessionsDelta,
        bookingId,
        serviceId: optionalText(reserve.serviceId),
        reason,
      }, nowIso),
      resolutionReason: "cancellation",
      lateCancellation: consume,
      policySnapshot: policy,
    });
    tx.update(bookingPath, {
      status: "cancelled",
      cancelledAt: nowMs,
      cancelledByUid: ctx.identity.uid,
      packageTransactionId: terminalTxId,
      packageRedemptionState: consume ? "consumed_late_cancellation" : "restored",
      packageCancellationPolicySnapshot: policy,
      cancellationReason: reason,
      updatedAt: nowIso,
    });
    slotPaths.forEach((path, index) => { if (slotSnaps[index]?.exists) tx.delete(path); });
    if (availabilitySnap.exists) {
      const bookedSlots = { ...(availabilitySnap.data?.bookedSlots || {}) };
      slotSnaps.forEach((slot) => { if (slot?.data?.time) delete bookedSlots[cleanText(slot.data.time)]; });
      tx.update(availabilityPath, { bookedSlots, updatedAt: nowIso });
    }
    tx.set(salonPath(ctx.salonId, "booking_tracks", bookingId), {
      status: "cancelled",
      packageRedemptionState: consume ? "consumed_late_cancellation" : "restored",
      updatedAt: nowIso,
    });
    return { ok: true, idempotent: false, action: consume ? "consume" : "restore", packageTransactionId: terminalTxId };
  });
}

export async function adminRestoreConsumed(ctx, data) {
  const bookingId = requiredDocumentId(data.bookingId, "bookingId");
  const operationId = requiredExternalId(data.operationId, "operationId");
  const reason = boundedText(data.reason, "reason", PACKAGE_LIMITS.reason, true);
  const adminRestoreId = await transactionId("admin_restore", operationId);
  const consumeTxId = await transactionId("consume", bookingId);
  const nowMs = Date.now();
  const nowIso = timestampNow();
  return ctx.db.runTransaction(async (tx) => {
    const restorePath = salonPath(ctx.salonId, "client_package_transactions", adminRestoreId);
    const consumePath = salonPath(ctx.salonId, "client_package_transactions", consumeTxId);
    const bookingPath = salonPath(ctx.salonId, "bookings", bookingId);
    const [existing, consumeSnap, bookingSnap] = await Promise.all([tx.get(restorePath), tx.get(consumePath), tx.get(bookingPath)]);
    if (existing.exists) {
      if (existing.data?.bookingId !== bookingId || existing.data?.idempotencySource !== operationId) {
        throw new AppError(409, "packages_idempotency:admin_restore_conflict");
      }
      return { ok: true, idempotent: true, packageTransactionId: adminRestoreId };
    }
    if (!consumeSnap.exists || !bookingSnap.exists) throw new AppError(409, "packages_redemption:consumed_not_found");
    const consumed = consumeSnap.data || {};
    const clientPackageId = requiredDocumentId(consumed.clientPackageId, "clientPackageId");
    const clientId = requiredDocumentId(consumed.clientId, "clientId");
    const packagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);
    const packageSnap = await tx.get(packagePath);
    if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    const transition = restoreOneUsedSession(packageSnap.data || {}, nowMs);
    tx.update(packagePath, statusPatch(transition.after, nowIso));
    tx.create(restorePath, {
      ...ledgerPayload({
        clientPackageId,
        clientId,
        type: "admin_restore",
        idempotencyKey: adminRestoreId,
        actorUid: ctx.identity.uid,
        before: transition.before,
        after: transition.after,
        sessionsDelta: transition.sessionsDelta,
        bookingId,
        serviceId: optionalText(consumed.serviceId),
        reason,
      }, nowIso),
      idempotencySource: operationId,
      reversesTransactionId: consumeTxId,
    });
    tx.update(bookingPath, {
      packageTransactionId: adminRestoreId,
      packageRedemptionState: "admin_restored",
      adminRestoreReason: reason,
      adminRestoredByUid: ctx.identity.uid,
      adminRestoredAt: nowMs,
      updatedAt: nowIso,
    });
    return { ok: true, idempotent: false, packageTransactionId: adminRestoreId };
  });
}

export async function cancelClientPackage(ctx, data) {
  requireRole(ctx.role, ADMIN_ROLES);
  const clientPackageId = requiredDocumentId(data.clientPackageId, "clientPackageId");
  const reason = boundedText(data.reason, "reason");
  const cancelTxId = await transactionId("cancel", clientPackageId);
  const nowMs = Date.now();
  const nowIso = timestampNow();
  return ctx.db.runTransaction(async (tx) => {
    const packagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);
    const ledgerPath = salonPath(ctx.salonId, "client_package_transactions", cancelTxId);
    const [existing, packageSnap] = await Promise.all([tx.get(ledgerPath), tx.get(packagePath)]);
    if (existing.exists) return { ok: true, idempotent: true, packageTransactionId: cancelTxId };
    if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    const clientId = requiredDocumentId(packageSnap.data?.clientId, "clientId");
    const transition = cancelPackageBalance(packageSnap.data || {}, nowMs);
    tx.update(packagePath, statusPatch(transition.after, nowIso));
    tx.create(ledgerPath, ledgerPayload({
      clientPackageId,
      clientId,
      type: "cancel",
      idempotencyKey: cancelTxId,
      actorUid: ctx.identity.uid,
      before: transition.before,
      after: transition.after,
      sessionsDelta: 0,
      reason,
    }, nowIso));
    return { ok: true, idempotent: false, packageTransactionId: cancelTxId };
  });
}

export async function adjustClientPackage(ctx, data) {
  requireRole(ctx.role, ADMIN_ROLES);
  const clientPackageId = requiredDocumentId(data.clientPackageId, "clientPackageId");
  const operationId = requiredDocumentId(data.operationId, "operationId");
  const sessionsDelta = boundedInteger(Number(data.sessionsDelta), "sessionsDelta", {
    min: -PACKAGE_LIMITS.adjustmentSessions,
    max: PACKAGE_LIMITS.adjustmentSessions,
  });
  const reason = boundedText(data.reason, "reason", PACKAGE_LIMITS.reason, true);
  const adjustmentTxId = await transactionId("admin_adjustment", operationId);
  const nowMs = Date.now();
  const nowIso = timestampNow();
  return ctx.db.runTransaction(async (tx) => {
    const packagePath = salonPath(ctx.salonId, "client_packages", clientPackageId);
    const ledgerPath = salonPath(ctx.salonId, "client_package_transactions", adjustmentTxId);
    const [existing, packageSnap] = await Promise.all([tx.get(ledgerPath), tx.get(packagePath)]);
    if (existing.exists) {
      if (existing.data?.clientPackageId !== clientPackageId || Number(existing.data?.sessionsDelta) !== sessionsDelta) {
        throw new AppError(409, "packages_idempotency:adjustment_conflict");
      }
      return { ok: true, idempotent: true, packageTransactionId: adjustmentTxId };
    }
    if (!packageSnap.exists) throw new AppError(404, "packages_client_package:not_found");
    const clientId = requiredDocumentId(packageSnap.data?.clientId, "clientId");
    const transition = adjustRemainingBalance(packageSnap.data || {}, sessionsDelta, nowMs);
    tx.update(packagePath, statusPatch(transition.after, nowIso));
    tx.create(ledgerPath, ledgerPayload({
      clientPackageId,
      clientId,
      type: "admin_adjustment",
      idempotencyKey: adjustmentTxId,
      actorUid: ctx.identity.uid,
      before: transition.before,
      after: transition.after,
      sessionsDelta: transition.sessionsDelta,
      reason,
    }, nowIso));
    return { ok: true, idempotent: false, packageTransactionId: adjustmentTxId };
  });
}

async function queryByClientAliases(db, salonId, collectionId, aliases) {
  const rowsByPath = new Map();
  for (const alias of aliases || []) {
    const clientId = cleanText(alias);
    if (!clientId) continue;
    const rows = await db.query(salonPath(salonId), collectionId, [["clientId", "EQUAL", clientId]]);
    rows.forEach((row) => rowsByPath.set(row.path, row));
  }
  return [...rowsByPath.values()];
}

async function queryAllDocs(db, salonId, collectionId, filters = []) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await db.query(salonPath(salonId), collectionId, filters, pageSize, offset);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function identityDisplayName(raw) {
  return optionalText(raw.name || raw.fullName || raw.clientName || raw.displayName);
}

function identityPhone(raw) {
  return optionalText(raw.phone || raw.mobile || raw.clientPhone || raw.phoneNumber || raw.phoneSnapshot);
}

function mergeIdentity(existing, next) {
  if (!existing) return next;
  return {
    canonicalClientId: existing.canonicalClientId || next.canonicalClientId,
    clientName: existing.clientName || next.clientName,
    phone: existing.phone || next.phone,
    priority: Math.max(existing.priority || 0, next.priority || 0),
  };
}

function upsertIdentity(index, aliases, identity) {
  for (const alias of aliases) {
    const key = cleanText(alias);
    if (!key) continue;
    const existing = index.get(key);
    if (!existing || (identity.priority || 0) > (existing.priority || 0)) {
      index.set(key, mergeIdentity(existing, identity));
    } else {
      index.set(key, mergeIdentity(existing, identity));
    }
  }
}

async function buildClientIdentityIndex(salonId, clientDocs, userDocs) {
  const index = new Map();
  await Promise.all(clientDocs.map(async (doc) => {
    const raw = doc.data || {};
    const canonicalClientId = cleanText(raw.clientId) || await stableLegacyClientId(salonId, doc.id);
    upsertIdentity(index, [
      doc.id,
      canonicalClientId,
      raw.clientId,
      raw.legacyClientDocId,
      raw.customerId,
      raw.authUid,
      raw.uid,
      raw.userId,
      raw.firebaseUid,
    ], {
      canonicalClientId,
      clientName: identityDisplayName(raw),
      phone: identityPhone(raw),
      priority: 2,
    });
  }));

  for (const doc of userDocs) {
    const raw = doc.data || {};
    const canonicalClientId = cleanText(raw.clientId || raw.canonicalClientId || raw.customerId || doc.id);
    upsertIdentity(index, [
      doc.id,
      canonicalClientId,
      raw.clientId,
      raw.canonicalClientId,
      raw.customerId,
      raw.authUid,
      raw.uid,
      raw.userId,
      raw.firebaseUid,
    ], {
      canonicalClientId,
      clientName: identityDisplayName(raw),
      phone: identityPhone(raw),
      priority: 1,
    });
  }
  return index;
}

function integerOrZero(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function fallbackPackageBalances(raw, nowMs) {
  const totalSessions = integerOrZero(raw.totalSessions ?? raw.sessionsCount ?? raw.initialSessions);
  const remainingSessions = integerOrZero(raw.remainingSessions ?? raw.sessionsRemaining ?? raw.balance);
  const reservedSessions = integerOrZero(raw.reservedSessions);
  const usedSessions = raw.usedSessions === undefined && raw.sessionsUsed === undefined
    ? Math.max(0, totalSessions - remainingSessions - reservedSessions)
    : integerOrZero(raw.usedSessions ?? raw.sessionsUsed);
  const rawStatus = cleanText(raw.status).toLowerCase();
  const expiresAtMs = timestampMs(raw.expiresAt || raw.expiryAt || raw.expirationDate);
  let status = ["active", "exhausted", "expired", "cancelled"].includes(rawStatus)
    ? rawStatus
    : raw.active === false ? "cancelled" : "active";
  if (status !== "cancelled" && expiresAtMs !== undefined && expiresAtMs < nowMs) status = "expired";
  if (status === "active" && remainingSessions === 0 && reservedSessions === 0) status = "exhausted";
  return { totalSessions, remainingSessions, usedSessions, reservedSessions, status };
}

function packageBalancesForAdminList(doc, nowMs) {
  try {
    return balancesFromDoc(doc.data || {}, nowMs);
  } catch (error) {
    console.warn("packages_admin_list_balance_fallback", {
      packageId: doc.id,
      reason: cleanText(error?.code || error?.message || "invalid_balance"),
    });
    return fallbackPackageBalances(doc.data || {}, nowMs);
  }
}

function packageNameForAdminList(raw) {
  return optionalText(raw.packageNameSnapshot || raw.packageName || raw.packageTitle || raw.name || raw.packageCatalogId) || "";
}

function clientIdForAdminList(raw) {
  return cleanText(raw.clientId || raw.canonicalClientId || raw.customerId || raw.authUid || raw.uid || raw.userId || raw.firebaseUid);
}

function packageRowForAdminList(doc, identityIndex, nowMs) {
  const raw = doc.data || {};
  const balances = packageBalancesForAdminList(doc, nowMs);
  if (balances.status !== "active") return null;
  const storedClientId = clientIdForAdminList(raw);
  const identity = identityIndex.get(storedClientId);
  return {
    clientName: identity?.clientName || optionalText(raw.clientNameSnapshot || raw.clientName || raw.nameSnapshot) || "",
    phone: identity?.phone || optionalText(raw.phoneSnapshot || raw.phone || raw.mobile || raw.clientPhone || raw.phoneNumber) || "",
    canonicalClientId: identity?.canonicalClientId || cleanText(raw.canonicalClientId || raw.clientId || storedClientId),
    packageName: packageNameForAdminList(raw),
    totalSessions: balances.totalSessions,
    remainingSessions: balances.remainingSessions,
    usedSessions: balances.usedSessions,
    reservedSessions: balances.reservedSessions,
    status: balances.status,
    expiresAt: raw.expiresAt || raw.expiryAt || raw.expirationDate || "",
  };
}

export async function listClientPackagesAdmin(ctx) {
  requireRole(ctx.role, ADMIN_ROLES);
  const [packageDocs, clientDocs, userDocs] = await Promise.all([
    queryAllDocs(ctx.db, ctx.salonId, "client_packages"),
    queryAllDocs(ctx.db, ctx.salonId, "clients"),
    queryAllDocs(ctx.db, ctx.salonId, "users"),
  ]);
  const identityIndex = await buildClientIdentityIndex(ctx.salonId, clientDocs, userDocs);
  const nowMs = Date.now();
  return packageDocs
    .map((doc) => packageRowForAdminList(doc, identityIndex, nowMs))
    .filter(Boolean)
    .sort((a, b) => (
      `${a.clientName}\u0000${a.phone}\u0000${a.packageName}`.localeCompare(
        `${b.clientName}\u0000${b.phone}\u0000${b.packageName}`,
        "ar"
      )
    ));
}

function walletPackageFromDoc(doc, nowMs, canonicalClientId) {
  const raw = doc.data || {};
  const balances = balancesFromDoc(raw, nowMs);
  const storedClientId = cleanText(raw.clientId);
  return {
    id: doc.id,
    packageNameSnapshot: raw.packageNameSnapshot,
    packageDescriptionSnapshot: raw.packageDescriptionSnapshot,
    allowedServiceIdsSnapshot: normalizeStringArray(raw.allowedServiceIdsSnapshot || raw.serviceIds),
    totalSessions: balances.totalSessions,
    remainingSessions: balances.remainingSessions,
    reservedSessions: balances.reservedSessions,
    usedSessions: balances.usedSessions,
    purchasedAt: raw.purchasedAt,
    expiresAt: raw.expiresAt,
    status: balances.status,
    invoiceId: raw.invoiceId,
    invoiceDocumentId: raw.invoiceDocumentId,
    invoiceNumber: raw.invoiceNumber,
    clientId: storedClientId,
    canonicalClientId,
    ...(storedClientId && storedClientId !== canonicalClientId ? { legacyClientId: storedClientId } : {}),
  };
}

async function walletSummaryForIdentity(ctx, identity) {
  const canonicalClientId = cleanText(identity.canonicalClientId || identity.clientId);
  const aliases = clientAliasIds({}, "", canonicalClientId, identity.aliasClientIds || []);
  const nowMs = Date.now();
  const packageSnap = await queryByClientAliases(ctx.db, ctx.salonId, "client_packages", aliases);
  const transactionSnap = await queryByClientAliases(ctx.db, ctx.salonId, "client_package_transactions", aliases);
  const warnings = [];
  const packages = [];

  for (const doc of packageSnap) {
    try {
      packages.push(walletPackageFromDoc(doc, nowMs, canonicalClientId));
    } catch (error) {
      const warning = {
        packageId: doc.id,
        reason: cleanText(error?.code || error?.message || "invalid_package"),
      };
      warnings.push(warning);
      console.warn("packages_wallet_excluded_package", warning);
    }
  }

  packages.sort((a, b) => (timestampMs(b.purchasedAt) || 0) - (timestampMs(a.purchasedAt) || 0));
  const transactions = transactionSnap
    .map((t) => ({
      id: t.id,
      clientPackageId: t.data?.clientPackageId,
      clientId: t.data?.clientId,
      type: t.data?.type,
      bookingId: t.data?.bookingId,
      serviceId: t.data?.serviceId,
      sessionsDelta: t.data?.sessionsDelta,
      remainingBefore: t.data?.remainingBefore,
      remainingAfter: t.data?.remainingAfter,
      reservedBefore: t.data?.reservedBefore,
      reservedAfter: t.data?.reservedAfter,
      usedBefore: t.data?.usedBefore,
      usedAfter: t.data?.usedAfter,
      createdAt: t.data?.createdAt,
    }))
    .sort((a, b) => (timestampMs(b.createdAt) || 0) - (timestampMs(a.createdAt) || 0));

  const serviceIds = [...new Set(packages.flatMap((p) => normalizeStringArray(p.allowedServiceIdsSnapshot)))];
  const serviceDocs = await Promise.all(serviceIds.map((id) => ctx.db.getDoc(salonPath(ctx.salonId, "services", id))));
  const services = Object.fromEntries(
    serviceDocs.map((doc, index) => [
      serviceIds[index],
      doc.exists ? cleanText(doc.data?.name || doc.data?.title || serviceIds[index]) : serviceIds[index],
    ])
  );
  const activePackageRows = packages.filter((p) => p.status === "active");
  const nearestExpiryMs = activePackageRows
    .map((p) => timestampMs(p.expiresAt))
    .filter((value) => value !== undefined)
    .sort((a, b) => a - b)[0];

  return {
    ok: true,
    clientId: canonicalClientId,
    canonicalClientId,
    legacyClientDocId: identity.legacyClientDocId,
    aliasClientIds: aliases,
    packages,
    transactions,
    services,
    activePackages: activePackageRows.length,
    totalRemainingSessions: activePackageRows.reduce((sum, p) => sum + Number(p.remainingSessions || 0), 0),
    totalUsedSessions: activePackageRows.reduce((sum, p) => sum + Number(p.usedSessions || 0), 0),
    totalReservedSessions: activePackageRows.reduce((sum, p) => sum + Number(p.reservedSessions || 0), 0),
    nearestExpiryAt: nearestExpiryMs ? timestampFromMs(nearestExpiryMs) : null,
    warnings,
  };
}

export async function clientWallet(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const requestedClientId = requiredDocumentId(data.clientId, "clientId");
  const identity = await ctx.db.runTransaction((tx) =>
    resolveClientIdentity(tx, ctx.salonId, requestedClientId, data.clientLookup)
  );
  return walletSummaryForIdentity(ctx, identity);
}

export async function myWallet(ctx) {
  if (ctx.role !== "client") throw new AppError(403, "packages_auth:client_required");
  const identity = await resolveAuthenticatedClientIdentity(ctx.db, ctx.salonId, ctx.identity);
  return walletSummaryForIdentity(ctx, {
    clientId: identity.clientId,
    canonicalClientId: identity.clientId,
    clientSnap: identity.clientSnap,
    aliasClientIds: clientAliasIds(identity.clientSnap?.data || {}, identity.clientSnap?.id || "", identity.clientId),
  });
}
