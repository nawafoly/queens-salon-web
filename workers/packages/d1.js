// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication token verification.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { AppError } from './errors.js';
import {
  ADMIN_ROLES,
  SALES_ROLES,
  cleanText,
  normalizePaymentMethod,
  normalizeStringArray,
  optionalText,
  requiredDocumentId,
  requiredExternalId,
  requireRole,
  timestampFromMs,
  timestampMs,
  timestampNow,
  transactionId,
} from './validation.js';

const CLIENT_LOOKUP_ID_FIELDS = ["clientId", "customerId", "authUid", "uid", "userId", "firebaseUid", "id", "docId"];
const CLIENT_LOOKUP_PHONE_FIELDS = ["phone", "mobile", "clientPhone", "phoneNumber"];
const WALLET_CACHE_TTL_MS = 60_000;

const walletCache = new Map();
const pendingWalletRequests = new Map();

export function clearD1WalletRuntimeCaches() {
  walletCache.clear();
  pendingWalletRequests.clear();
}

function packagesDb(ctx) {
  if (!ctx.packagesDb) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  return ctx.packagesDb;
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

function safeJsonArray(value) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  try {
    return normalizeStringArray(JSON.parse(cleanText(value) || "[]"));
  } catch {
    return [];
  }
}

function jsonArray(value) {
  return JSON.stringify(normalizeStringArray(value));
}

function dedupe(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function collectLookupIds(requestedId, lookup = {}) {
  const raw = lookup && typeof lookup === "object" ? lookup : {};
  const values = [requestedId];
  for (const field of CLIENT_LOOKUP_ID_FIELDS) values.push(raw[field]);
  return dedupe(values).filter((value) => value.length <= 256 && !value.includes("/"));
}

function collectLookupPhones(lookup = {}) {
  const raw = lookup && typeof lookup === "object" ? lookup : {};
  return dedupe(CLIENT_LOOKUP_PHONE_FIELDS.map((field) => normalizeLookupPhone(raw[field])));
}

function primaryFirebaseUid(lookup = {}) {
  const raw = lookup && typeof lookup === "object" ? lookup : {};
  return cleanText(raw.firebaseUid || raw.authUid || raw.uid || raw.userId);
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function clientFromRow(row) {
  if (!row) return null;
  return {
    canonicalClientId: cleanText(row.canonical_client_id),
    name: optionalText(row.name),
    phoneNormalized: optionalText(row.phone_normalized),
    firebaseUid: optionalText(row.firebase_uid),
    legacyIds: safeJsonArray(row.legacy_ids_json),
  };
}

function packageStatus(row, nowMs = Date.now()) {
  const raw = cleanText(row?.status || "active");
  if (raw === "cancelled") return "cancelled";
  if (row?.expires_at && timestampMs(row.expires_at) !== undefined && timestampMs(row.expires_at) < nowMs) return "expired";
  const remaining = Number(row?.remaining_sessions || 0);
  const reserved = Number(row?.reserved_sessions || 0);
  if (remaining === 0 && reserved === 0) return "exhausted";
  return ["active", "expired", "exhausted"].includes(raw) ? raw : "active";
}

function assertPackageInvariant(row) {
  const total = Number(row.total_sessions || 0);
  const remaining = Number(row.remaining_sessions || 0);
  const reserved = Number(row.reserved_sessions || 0);
  const used = Number(row.used_sessions || 0);
  if ([total, remaining, reserved, used].some((value) => !Number.isInteger(value) || value < 0)) {
    throw new AppError(409, "package_balance:invalid", "Package balances must be non-negative integers");
  }
  if (total !== remaining + reserved + used) {
    throw new AppError(409, "package_balance:invalid", "Package balance invariant failed");
  }
}

function walletPackage(row, canonicalClientId) {
  assertPackageInvariant(row);
  const status = packageStatus(row);
  return {
    id: row.id,
    packageNameSnapshot: row.package_name_snapshot,
    allowedServiceIdsSnapshot: safeJsonArray(row.allowed_service_ids_json),
    totalSessions: Number(row.total_sessions || 0),
    remainingSessions: Number(row.remaining_sessions || 0),
    reservedSessions: Number(row.reserved_sessions || 0),
    usedSessions: Number(row.used_sessions || 0),
    purchasedAt: row.purchased_at || undefined,
    expiresAt: row.expires_at || undefined,
    status,
    invoiceId: row.invoice_id || undefined,
    clientId: canonicalClientId,
    canonicalClientId,
    packageCatalogId: row.package_catalog_id,
  };
}

function transactionRow(row) {
  return {
    id: row.id,
    clientPackageId: row.client_package_id,
    clientId: row.canonical_client_id,
    canonicalClientId: row.canonical_client_id,
    type: row.type,
    bookingId: row.booking_id || undefined,
    cartItemId: row.cart_item_id || undefined,
    invoiceId: row.invoice_id || undefined,
    serviceId: row.service_id || undefined,
    sessionsDelta: Number(row.sessions_delta || 0),
    remainingBefore: Number(row.remaining_before || 0),
    remainingAfter: Number(row.remaining_after || 0),
    reservedBefore: Number(row.reserved_before || 0),
    reservedAfter: Number(row.reserved_after || 0),
    usedBefore: Number(row.used_before || 0),
    usedAfter: Number(row.used_after || 0),
    createdAt: row.created_at,
  };
}

async function dbFirst(db, sql, params = []) {
  if (db.__fakeD1) return db.first(sql, params);
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, params = []) {
  if (db.__fakeD1) return db.all(sql, params);
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function dbRun(db, sql, params = []) {
  if (db.__fakeD1) return db.run(sql, params);
  return db.prepare(sql).bind(...params).run();
}

async function dbBatch(db, statements) {
  if (db.__fakeD1) return db.batch(statements);
  return db.batch(statements.map(({ sql, params = [] }) => db.prepare(sql).bind(...params)));
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function fetchAliases(db, salonId, canonicalClientId) {
  return dbAll(
    db,
    "SELECT alias_id FROM client_identity_aliases WHERE salon_id = ? AND canonical_client_id = ? ORDER BY alias_id",
    [salonId, canonicalClientId]
  ).then((rows) => rows.map((row) => cleanText(row.alias_id)).filter(Boolean));
}

async function upsertClientAliases(db, salonId, canonicalClientId, aliasIds, aliasType = "legacy") {
  const now = timestampNow();
  for (const aliasId of dedupe(aliasIds).filter((value) => value !== canonicalClientId)) {
    await dbRun(
      db,
      `INSERT OR IGNORE INTO client_identity_aliases
        (salon_id, alias_id, canonical_client_id, alias_type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [salonId, aliasId, canonicalClientId, aliasType, now]
    );
  }
}

async function loadClient(db, salonId, canonicalClientId) {
  return clientFromRow(await dbFirst(
    db,
    "SELECT * FROM clients WHERE salon_id = ? AND canonical_client_id = ? LIMIT 1",
    [salonId, canonicalClientId]
  ));
}

async function resolveByAliases(db, salonId, lookupIds) {
  if (!lookupIds.length) return null;
  const rows = await dbAll(
    db,
    `SELECT alias_id, canonical_client_id
       FROM client_identity_aliases
      WHERE salon_id = ? AND alias_id IN (${placeholders(lookupIds.length)})
      LIMIT ${Math.max(lookupIds.length, 1)}`,
    [salonId, ...lookupIds]
  );
  const canonicalIds = dedupe(rows.map((row) => row.canonical_client_id));
  if (canonicalIds.length > 1) {
    throw new AppError(409, "packages_client:ambiguous_identity", "packages_client:ambiguous_identity", {
      candidateCount: canonicalIds.length,
    });
  }
  return canonicalIds[0] || null;
}

async function resolveByClientId(db, salonId, lookupIds) {
  if (!lookupIds.length) return null;
  const rows = await dbAll(
    db,
    `SELECT * FROM clients
      WHERE salon_id = ? AND canonical_client_id IN (${placeholders(lookupIds.length)})
      LIMIT 2`,
    [salonId, ...lookupIds]
  );
  if (rows.length > 1) {
    throw new AppError(409, "packages_client:ambiguous_identity", "packages_client:ambiguous_identity", {
      candidateCount: rows.length,
    });
  }
  return clientFromRow(rows[0]);
}

async function resolveByFirebaseUid(db, salonId, firebaseUid) {
  if (!firebaseUid) return null;
  const rows = await dbAll(
    db,
    "SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ? LIMIT 2",
    [salonId, firebaseUid]
  );
  if (rows.length > 1) {
    throw new AppError(409, "packages_client:ambiguous_identity", "packages_client:ambiguous_identity", {
      candidateCount: rows.length,
    });
  }
  return clientFromRow(rows[0]);
}

async function resolveByPhone(db, salonId, phones) {
  if (!phones.length) return null;
  const rows = await dbAll(
    db,
    `SELECT * FROM clients
      WHERE salon_id = ? AND phone_normalized IN (${placeholders(phones.length)})
      LIMIT 2`,
    [salonId, ...phones]
  );
  if (rows.length > 1) {
    throw new AppError(409, "packages_client:ambiguous_identity", "packages_client:ambiguous_identity", {
      candidateCount: rows.length,
    });
  }
  return clientFromRow(rows[0]);
}

async function resolveD1ClientIdentity(ctx, data = {}, options = {}) {
  const db = packagesDb(ctx);
  const lookup = data.clientLookup && typeof data.clientLookup === "object" ? data.clientLookup : {};
  const requestedId = cleanText(data.clientId || data.requestedClientId);
  const lookupIds = collectLookupIds(requestedId, lookup);
  const phones = collectLookupPhones(lookup);
  const firebaseUid = primaryFirebaseUid(lookup);
  if (!lookupIds.length && !phones.length && !firebaseUid) {
    throw new AppError(400, "packages_client:missing_identifier", "clientId or clientLookup phone/uid is required");
  }

  let canonicalClientId = await resolveByAliases(db, ctx.salonId, lookupIds);
  let client = canonicalClientId ? await loadClient(db, ctx.salonId, canonicalClientId) : null;
  if (!client) client = await resolveByClientId(db, ctx.salonId, lookupIds);
  if (!client) client = await resolveByFirebaseUid(db, ctx.salonId, firebaseUid);
  if (!client) client = await resolveByPhone(db, ctx.salonId, phones);

  if (!client && options.allowCreate) {
    canonicalClientId = lookupIds[0] || (firebaseUid ? `uid_${firebaseUid}` : `phone_${phones[0]}`);
    const now = timestampNow();
    await dbRun(
      db,
      `INSERT OR IGNORE INTO clients
        (canonical_client_id, salon_id, name, phone_normalized, firebase_uid, legacy_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        canonicalClientId,
        ctx.salonId,
        optionalText(lookup.name || data.clientName) || null,
        phones[0] || null,
        firebaseUid || null,
        jsonArray(lookupIds.filter((value) => value !== canonicalClientId)),
        now,
        now,
      ]
    );
    client = await loadClient(db, ctx.salonId, canonicalClientId);
  }

  if (!client) throw new AppError(404, "packages_client:not_found", "Client was not found");
  canonicalClientId = client.canonicalClientId;
  await upsertClientAliases(db, ctx.salonId, canonicalClientId, lookupIds, "lookup");
  const aliases = dedupe([canonicalClientId, ...client.legacyIds, ...(await fetchAliases(db, ctx.salonId, canonicalClientId))]);
  return {
    ...client,
    canonicalClientId,
    clientId: canonicalClientId,
    aliasClientIds: aliases,
  };
}

function walletCacheKey(salonId, canonicalClientId) {
  return `${salonId}\u0000${canonicalClientId}`;
}

function lookupDedupeKey(salonId, data = {}) {
  const lookup = data.clientLookup && typeof data.clientLookup === "object" ? data.clientLookup : {};
  return JSON.stringify({
    salonId,
    ids: collectLookupIds(cleanText(data.clientId), lookup),
    phones: collectLookupPhones(lookup),
    uid: primaryFirebaseUid(lookup),
  });
}

function getCachedWallet(salonId, canonicalClientId) {
  const key = walletCacheKey(salonId, canonicalClientId);
  const entry = walletCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    walletCache.delete(key);
    return null;
  }
  return structuredClone(entry.value);
}

function setCachedWallet(salonId, canonicalClientId, value) {
  walletCache.set(walletCacheKey(salonId, canonicalClientId), {
    value: structuredClone(value),
    expiresAt: Date.now() + WALLET_CACHE_TTL_MS,
  });
}

async function walletSummaryD1(ctx, identity, options = {}) {
  const db = packagesDb(ctx);
  const ids = dedupe([identity.canonicalClientId, ...(identity.aliasClientIds || [])]);
  const packageRows = ids.length
    ? await dbAll(
        db,
        `SELECT * FROM client_packages
          WHERE salon_id = ? AND canonical_client_id IN (${placeholders(ids.length)})
          ORDER BY purchased_at DESC, created_at DESC
          LIMIT 100`,
        [ctx.salonId, ...ids]
      )
    : [];
  const packages = packageRows.map((row) => walletPackage(row, identity.canonicalClientId));
  const activePackages = packages.filter((pkg) => pkg.status === "active");
  const transactions = options.includeTransactions === false || !ids.length
    ? []
    : (await dbAll(
        db,
        `SELECT * FROM package_transactions
          WHERE salon_id = ? AND canonical_client_id IN (${placeholders(ids.length)})
          ORDER BY created_at DESC
          LIMIT 100`,
        [ctx.salonId, ...ids]
      )).map(transactionRow);
  const serviceIds = dedupe(packages.flatMap((pkg) => pkg.allowedServiceIdsSnapshot || []));
  const services = Object.fromEntries(serviceIds.map((id) => [id, id]));
  const nearestExpiryMs = activePackages
    .map((pkg) => timestampMs(pkg.expiresAt))
    .filter((value) => value !== undefined)
    .sort((a, b) => a - b)[0];
  return {
    ok: true,
    clientId: identity.canonicalClientId,
    canonicalClientId: identity.canonicalClientId,
    aliasClientIds: ids,
    packages,
    transactions,
    services,
    activePackages,
    activePackageCount: activePackages.length,
    totalRemainingSessions: activePackages.reduce((sum, pkg) => sum + Number(pkg.remainingSessions || 0), 0),
    totalUsedSessions: activePackages.reduce((sum, pkg) => sum + Number(pkg.usedSessions || 0), 0),
    totalReservedSessions: activePackages.reduce((sum, pkg) => sum + Number(pkg.reservedSessions || 0), 0),
    nearestExpiryAt: nearestExpiryMs ? timestampFromMs(nearestExpiryMs) : null,
    warnings: [],
  };
}

export async function clientWalletD1(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const startedAt = Date.now();
  const dedupeKey = lookupDedupeKey(ctx.salonId, data);
  if (pendingWalletRequests.has(dedupeKey)) return structuredClone(await pendingWalletRequests.get(dedupeKey));

  const work = (async () => {
    const identity = await resolveD1ClientIdentity(ctx, data);
    const cached = getCachedWallet(ctx.salonId, identity.canonicalClientId);
    if (cached) return cached;
    const response = await walletSummaryD1(ctx, identity, { includeTransactions: false });
    setCachedWallet(ctx.salonId, identity.canonicalClientId, response);
    console.log("packages_d1_client_wallet", {
      aliasCount: response.aliasClientIds.length,
      packageCount: response.activePackages.length,
      durationMs: Date.now() - startedAt,
    });
    return response;
  })();

  pendingWalletRequests.set(dedupeKey, work);
  try {
    return structuredClone(await work);
  } finally {
    pendingWalletRequests.delete(dedupeKey);
  }
}

export async function myWalletD1(ctx) {
  if (ctx.role !== "client") throw new AppError(403, "packages_auth:client_required");
  const identity = await resolveD1ClientIdentity(ctx, {
    clientId: ctx.identity?.claims?.clientId || "",
    clientLookup: {
      uid: ctx.identity?.uid,
      authUid: ctx.identity?.uid,
      firebaseUid: ctx.identity?.uid,
    },
  });
  return walletSummaryD1(ctx, identity);
}

export async function purchasePackageD1(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const db = packagesDb(ctx);
  const packageCatalogId = requiredDocumentId(data.packageCatalogId, "packageCatalogId");
  const invoiceId = requiredExternalId(data.invoiceId, "invoiceId");
  normalizePaymentMethod(data.paymentMethod || "cash");
  const identity = await resolveD1ClientIdentity(ctx, data, { allowCreate: true });

  const existing = await dbFirst(
    db,
    "SELECT * FROM client_packages WHERE salon_id = ? AND invoice_id = ? LIMIT 1",
    [ctx.salonId, invoiceId]
  );
  if (existing) {
    if (existing.canonical_client_id !== identity.canonicalClientId || existing.package_catalog_id !== packageCatalogId) {
      throw new AppError(409, "packages_idempotency:purchase_conflict");
    }
    return {
      ok: true,
      idempotent: true,
      clientPackageId: existing.id,
      invoiceId,
      invoiceDocumentId: invoiceId,
      invoiceNumber: invoiceId,
      clientId: identity.canonicalClientId,
      canonicalClientId: identity.canonicalClientId,
    };
  }

  const catalog = await dbFirst(
    db,
    "SELECT * FROM package_catalog WHERE salon_id = ? AND id = ? AND active = 1 LIMIT 1",
    [ctx.salonId, packageCatalogId]
  );
  if (!catalog) throw new AppError(404, "packages_catalog:not_found", "Package catalog item was not found");

  const now = timestampNow();
  const clientPackageId = (await transactionId("client_package", invoiceId)).replace(/^client_package:/, "pkg_");
  const purchaseTxId = await transactionId("purchase", invoiceId);
  const totalSessions = Number(catalog.total_sessions || 0);
  const allowedServiceIdsJson = cleanText(catalog.allowed_service_ids_json) || "[]";

  const statements = [
    {
      sql: `INSERT OR IGNORE INTO clients
        (canonical_client_id, salon_id, name, phone_normalized, firebase_uid, legacy_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        identity.canonicalClientId,
        ctx.salonId,
        identity.name || null,
        identity.phoneNormalized || null,
        identity.firebaseUid || null,
        jsonArray(identity.legacyIds || []),
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO client_packages
        (id, salon_id, canonical_client_id, package_catalog_id, package_name_snapshot, allowed_service_ids_json,
         total_sessions, remaining_sessions, reserved_sessions, used_sessions, status, purchased_at, expires_at,
         invoice_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', ?, ?, ?, ?, ?)`,
      params: [
        clientPackageId,
        ctx.salonId,
        identity.canonicalClientId,
        packageCatalogId,
        catalog.name,
        allowedServiceIdsJson,
        totalSessions,
        totalSessions,
        data.purchasedAt || now,
        data.expiresAt || null,
        invoiceId,
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO package_transactions
        (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
         remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
         service_id, booking_id, cart_item_id, invoice_id, created_at)
       VALUES (?, ?, ?, ?, 'purchase', ?, 0, ?, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?)`,
      params: [purchaseTxId, ctx.salonId, clientPackageId, identity.canonicalClientId, totalSessions, totalSessions, invoiceId, now],
    },
  ];
  await dbBatch(db, statements);
  clearD1WalletRuntimeCaches();
  return {
    ok: true,
    clientPackageId,
    invoiceId,
    invoiceDocumentId: invoiceId,
    invoiceNumber: invoiceId,
    clientId: identity.canonicalClientId,
    canonicalClientId: identity.canonicalClientId,
  };
}

async function packageForOperation(ctx, identity, clientPackageId) {
  const db = packagesDb(ctx);
  const ids = dedupe([identity.canonicalClientId, ...(identity.aliasClientIds || [])]);
  const row = await dbFirst(
    db,
    `SELECT * FROM client_packages
      WHERE salon_id = ? AND id = ? AND canonical_client_id IN (${placeholders(ids.length)})
      LIMIT 1`,
    [ctx.salonId, requiredDocumentId(clientPackageId, "clientPackageId"), ...ids]
  );
  if (!row) throw new AppError(404, "packages_client_package:not_found", "Client package was not found");
  assertPackageInvariant(row);
  return row;
}

function requireActivePackage(row, serviceId) {
  const status = packageStatus(row);
  if (status !== "active") throw new AppError(409, "package_balance:not_active", `Package is ${status}`);
  if (Number(row.remaining_sessions || 0) <= 0) throw new AppError(409, "package_balance:exhausted", "No remaining sessions");
  if (serviceId && !safeJsonArray(row.allowed_service_ids_json).includes(serviceId)) {
    throw new AppError(409, "packages_redemption:service_not_included", "Service is not included in the package");
  }
}

async function balanceTransactionD1(ctx, data, transition) {
  requireRole(ctx.role, SALES_ROLES);
  const db = packagesDb(ctx);
  const identity = await resolveD1ClientIdentity(ctx, data);
  const clientPackageId = requiredDocumentId(data.clientPackageId, "clientPackageId");
  const serviceId = optionalText(data.serviceId);
  const row = await packageForOperation(ctx, identity, clientPackageId);
  const txSource = data.operationId || data.bookingId || data.cartItemId || `${transition.type}_${Date.now()}`;
  const txId = await transactionId(transition.type, txSource);
  const priorTx = await dbFirst(db, "SELECT * FROM package_transactions WHERE id = ? LIMIT 1", [txId]);
  if (priorTx) {
    return {
      ok: true,
      idempotent: true,
      bookingId: priorTx.booking_id || data.bookingId || "",
      publicId: priorTx.booking_id || data.bookingId || "",
      clientPackageId,
      packageDocumentId: clientPackageId,
      packageTransactionId: txId,
      canonicalClientId: identity.canonicalClientId,
      beforeRemaining: Number(priorTx.remaining_before || 0),
      afterRemaining: Number(priorTx.remaining_after || 0),
      redeemedServiceId: priorTx.service_id || serviceId,
      cartItemId: priorTx.cart_item_id || data.cartItemId || "",
    };
  }

  if (transition.requireRemaining) requireActivePackage(row, serviceId);
  if (transition.requireReserved && Number(row.reserved_sessions || 0) <= 0) {
    throw new AppError(409, "package_balance:no_reserved_session");
  }

  const before = {
    remaining: Number(row.remaining_sessions || 0),
    reserved: Number(row.reserved_sessions || 0),
    used: Number(row.used_sessions || 0),
  };
  const after = transition.apply(before);
  const status = after.remaining === 0 && after.reserved === 0 ? "exhausted" : "active";
  const now = timestampNow();
  const ids = dedupe([identity.canonicalClientId, ...(identity.aliasClientIds || [])]);
  const bookingId = cleanText(data.bookingId) || cleanText(data.operationId) || "";
  const cartItemId = cleanText(data.cartItemId);

  const updateSql = `UPDATE client_packages
      SET remaining_sessions = ?, reserved_sessions = ?, used_sessions = ?, status = ?, updated_at = ?,
          canonical_client_id = ?
    WHERE salon_id = ? AND id = ? AND canonical_client_id IN (${placeholders(ids.length)})
      AND remaining_sessions = ? AND reserved_sessions = ? AND used_sessions = ?`;
  const insertSql = `INSERT INTO package_transactions
      (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
       remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
       service_id, booking_id, cart_item_id, invoice_id, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM client_packages
        WHERE salon_id = ? AND id = ? AND canonical_client_id = ?
          AND remaining_sessions = ? AND reserved_sessions = ? AND used_sessions = ?
     )`;
  const results = await dbBatch(db, [
    {
      sql: updateSql,
      params: [
        after.remaining,
        after.reserved,
        after.used,
        status,
        now,
        identity.canonicalClientId,
        ctx.salonId,
        clientPackageId,
        ...ids,
        before.remaining,
        before.reserved,
        before.used,
      ],
    },
    {
      sql: insertSql,
      params: [
        txId,
        ctx.salonId,
        clientPackageId,
        identity.canonicalClientId,
        transition.type,
        transition.sessionsDelta,
        before.remaining,
        after.remaining,
        before.reserved,
        after.reserved,
        before.used,
        after.used,
        serviceId || null,
        bookingId || null,
        cartItemId || null,
        cleanText(data.invoiceId) || null,
        now,
        ctx.salonId,
        clientPackageId,
        identity.canonicalClientId,
        after.remaining,
        after.reserved,
        after.used,
      ],
    },
  ]);
  if (changes(results?.[0]) < 1 || changes(results?.[1]) < 1) {
    throw new AppError(409, "package_balance:conflict", "Package balance changed; retry the operation");
  }
  clearD1WalletRuntimeCaches();
  return {
    ok: true,
    bookingId,
    publicId: bookingId,
    clientPackageId,
    packageDocumentId: clientPackageId,
    packageTransactionId: txId,
    canonicalClientId: identity.canonicalClientId,
    beforeRemaining: before.remaining,
    afterRemaining: after.remaining,
    redeemedServiceId: serviceId,
    cartItemId,
    remainingBefore: before.remaining,
    remainingAfter: after.remaining,
    reservedBefore: before.reserved,
    reservedAfter: after.reserved,
    usedBefore: before.used,
    usedAfter: after.used,
  };
}

export async function redeemPackageD1(ctx, data) {
  return balanceTransactionD1(ctx, data, {
    type: "redeem",
    sessionsDelta: -1,
    requireRemaining: true,
    apply: (before) => ({ ...before, remaining: before.remaining - 1, used: before.used + 1 }),
  });
}

export async function reservePackageD1(ctx, data) {
  return balanceTransactionD1(ctx, data, {
    type: "reserve",
    sessionsDelta: -1,
    requireRemaining: true,
    apply: (before) => ({ ...before, remaining: before.remaining - 1, reserved: before.reserved + 1 }),
  });
}

export async function releasePackageD1(ctx, data) {
  return balanceTransactionD1(ctx, data, {
    type: "release",
    sessionsDelta: 1,
    requireReserved: true,
    apply: (before) => ({ ...before, remaining: before.remaining + 1, reserved: before.reserved - 1 }),
  });
}

export async function consumeReservedD1(ctx, data) {
  return balanceTransactionD1(ctx, data, {
    type: "consume",
    sessionsDelta: 0,
    requireReserved: true,
    apply: (before) => ({ ...before, reserved: before.reserved - 1, used: before.used + 1 }),
  });
}

export async function listClientPackagesAdminD1(ctx) {
  requireRole(ctx.role, ADMIN_ROLES);
  const rows = await dbAll(
    packagesDb(ctx),
    `SELECT cp.*, c.name AS client_name, c.phone_normalized AS client_phone
       FROM client_packages cp
       LEFT JOIN clients c
         ON c.salon_id = cp.salon_id AND c.canonical_client_id = cp.canonical_client_id
      WHERE cp.salon_id = ? AND cp.status = 'active'
      ORDER BY COALESCE(c.name, ''), COALESCE(c.phone_normalized, ''), cp.package_name_snapshot`,
    [ctx.salonId]
  );
  return rows.map((row) => ({
    clientName: row.client_name || "",
    phone: row.client_phone || "",
    canonicalClientId: row.canonical_client_id,
    packageName: row.package_name_snapshot,
    totalSessions: Number(row.total_sessions || 0),
    remainingSessions: Number(row.remaining_sessions || 0),
    usedSessions: Number(row.used_sessions || 0),
    reservedSessions: Number(row.reserved_sessions || 0),
    status: packageStatus(row),
    expiresAt: row.expires_at || "",
  }));
}

export async function sessionDashboardAdminD1(ctx) {
  requireRole(ctx.role, ADMIN_ROLES);
  const db = packagesDb(ctx);
  const packageRows = await dbAll(
    db,
    `SELECT cp.*, c.name AS client_name, c.phone_normalized AS client_phone
       FROM client_packages cp
       LEFT JOIN clients c
         ON c.salon_id = cp.salon_id AND c.canonical_client_id = cp.canonical_client_id
      WHERE cp.salon_id = ?
      ORDER BY COALESCE(cp.updated_at, cp.created_at) DESC
      LIMIT 1000`,
    [ctx.salonId]
  );
  const transactionRows = await dbAll(
    db,
    `SELECT pt.*, cp.package_name_snapshot, c.name AS client_name, c.phone_normalized AS client_phone
       FROM package_transactions pt
       LEFT JOIN client_packages cp
         ON cp.salon_id = pt.salon_id AND cp.id = pt.client_package_id
       LEFT JOIN clients c
         ON c.salon_id = pt.salon_id AND c.canonical_client_id = pt.canonical_client_id
      WHERE pt.salon_id = ?
      ORDER BY pt.created_at DESC
      LIMIT 500`,
    [ctx.salonId]
  );

  const packages = packageRows.map((row) => ({
    id: cleanText(row.id),
    clientName: row.client_name || "",
    phone: row.client_phone || "",
    canonicalClientId: cleanText(row.canonical_client_id),
    packageCatalogId: cleanText(row.package_catalog_id),
    packageName: row.package_name_snapshot || "",
    totalSessions: Number(row.total_sessions || 0),
    remainingSessions: Number(row.remaining_sessions || 0),
    usedSessions: Number(row.used_sessions || 0),
    reservedSessions: Number(row.reserved_sessions || 0),
    status: packageStatus(row),
    purchasedAt: row.purchased_at || row.created_at || "",
    expiresAt: row.expires_at || "",
    invoiceId: row.invoice_id || "",
    updatedAt: row.updated_at || row.created_at || "",
  }));

  const transactions = transactionRows.map((row) => ({
    id: cleanText(row.id),
    clientPackageId: cleanText(row.client_package_id),
    canonicalClientId: cleanText(row.canonical_client_id),
    clientName: row.client_name || "",
    phone: row.client_phone || "",
    packageName: row.package_name_snapshot || "",
    type: cleanText(row.type),
    sessionsDelta: Number(row.sessions_delta || 0),
    remainingBefore: Number(row.remaining_before || 0),
    remainingAfter: Number(row.remaining_after || 0),
    reservedBefore: Number(row.reserved_before || 0),
    reservedAfter: Number(row.reserved_after || 0),
    usedBefore: Number(row.used_before || 0),
    usedAfter: Number(row.used_after || 0),
    serviceId: row.service_id || "",
    bookingId: row.booking_id || "",
    cartItemId: row.cart_item_id || "",
    invoiceId: row.invoice_id || "",
    createdAt: row.created_at || "",
  }));

  const activePackages = packages.filter((row) => row.status === "active");
  const subscribedClients = new Set(activePackages.map((row) => row.canonicalClientId).filter(Boolean)).size;
  const now = Date.now();
  const soon = now + 30 * 24 * 60 * 60 * 1000;
  const expiringSoonCount = activePackages.filter((row) => {
    const expiry = Date.parse(row.expiresAt || "");
    return Number.isFinite(expiry) && expiry >= now && expiry <= soon;
  }).length;

  return {
    summary: {
      subscribedClients,
      totalPackages: packages.length,
      activePackages: activePackages.length,
      totalRemainingSessions: activePackages.reduce((sum, row) => sum + row.remainingSessions, 0),
      totalUsedSessions: packages.reduce((sum, row) => sum + row.usedSessions, 0),
      totalReservedSessions: activePackages.reduce((sum, row) => sum + row.reservedSessions, 0),
      expiringSoonCount,
      exhaustedPackages: packages.filter((row) => row.status === "exhausted").length,
      expiredPackages: packages.filter((row) => row.status === "expired").length,
    },
    packages,
    transactions,
  };
}

export async function auditClientIdentitiesAdminD1(ctx) {
  requireRole(ctx.role, ADMIN_ROLES);
  const clients = await dbAll(packagesDb(ctx), "SELECT * FROM clients WHERE salon_id = ? ORDER BY canonical_client_id LIMIT 1000", [ctx.salonId]);
  const aliases = await dbAll(packagesDb(ctx), "SELECT * FROM client_identity_aliases WHERE salon_id = ? ORDER BY canonical_client_id, alias_id LIMIT 5000", [ctx.salonId]);
  const aliasMap = new Map();
  for (const alias of aliases) {
    const key = cleanText(alias.canonical_client_id);
    const rows = aliasMap.get(key) || [];
    rows.push({ aliasId: alias.alias_id, aliasType: alias.alias_type });
    aliasMap.set(key, rows);
  }
  const identityGroups = clients.map((row) => ({
    candidateCount: 1,
    canonicalSuggested: row.canonical_client_id,
    aliases: [
      row.canonical_client_id,
      ...safeJsonArray(row.legacy_ids_json),
      ...(aliasMap.get(row.canonical_client_id) || []).map((item) => item.aliasId),
    ],
    reason: ["d1_canonical_record"],
    scores: [{
      canonicalClientId: row.canonical_client_id,
      score: 1,
      reasons: ["d1_canonical_record"],
      relations: {
        activePackages: 0,
        transactions: 0,
        bookings: 0,
        invoices: 0,
      },
    }],
  }));
  return { ok: true, groupCount: identityGroups.length, identityGroups };
}

export async function packagesHealthD1(ctx) {
  const row = await dbFirst(packagesDb(ctx), "SELECT 1 AS ok", []);
  return {
    ok: Number(row?.ok || 0) === 1,
    storage: "d1",
    binding: "PACKAGES_DB",
  };
}

export async function expireClientPackagesD1(env, salonId = cleanText(env.SALON_ID || "main")) {
  if (!env.PACKAGES_DB) throw new AppError(503, "packages_d1:not_configured");
  const now = timestampNow();
  const result = await dbRun(
    env.PACKAGES_DB,
    `UPDATE client_packages
        SET status = 'expired', updated_at = ?
      WHERE salon_id = ?
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at != ''
        AND expires_at < ?`,
    [now, salonId, now]
  );
  return {
    ok: true,
    storage: "d1",
    expired: changes(result),
  };
}

export const __testD1 = {
  normalizeLookupPhone,
  resolveD1ClientIdentity,
  walletSummaryD1,
  clearD1WalletRuntimeCaches,
  expireClientPackagesD1,
};
