import { atomicIdempotencyCompletionStatements } from "../core/idempotency.js";
// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication token verification.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { AppError } from './errors.js';
import {
  buildPackageSettlement,
  checkPackageSaleReplay,
  normalizePackageSettlementError,
  packageSaleResult,
  parsePackageSale,
} from './sales.js';
import {
  ADMIN_ROLES,
  SALES_ROLES,
  PACKAGE_LIMITS,
  boundedInteger,
  boundedText,
  buildPurchasedPackageSnapshot,
  cleanText,
  normalizeStringArray,
  optionalText,
  requiredDocumentId,
  requiredExternalId,
  requireRole,
  requireCatalogManage,
  timestampFromMs,
  timestampMs,
  timestampNow,
  transactionId,
} from './validation.js';

const CLIENT_LOOKUP_ID_FIELDS = ["clientId", "customerId", "authUid", "uid", "userId", "firebaseUid", "id", "docId"];
const CLIENT_LOOKUP_PHONE_FIELDS = ["phone", "mobile", "clientPhone", "phoneNumber"];
const pendingWalletRequests = new Map();

export function clearD1WalletRuntimeCaches() {
  pendingWalletRequests.clear();
}

function packagesDb(ctx) {
  const db = ctx.coreDb || ctx.packagesDb;
  if (!db) throw new AppError(503, "packages_d1:not_configured", "Unified Core D1 database is not configured");
  return db;
}

function usesUnifiedCoreClients(ctx) {
  return Boolean(ctx?.unifiedCore || ctx?.coreDb);
}

function clientInsertStatement(ctx, row) {
  const name = optionalText(row.name) || "عميلة";
  if (usesUnifiedCoreClients(ctx)) {
    return {
      sql: `INSERT INTO clients
        (id, canonical_client_id, salon_id, name, phone_normalized, firebase_uid, legacy_ids_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET canonical_client_id = excluded.canonical_client_id
       WHERE clients.salon_id = excluded.salon_id
         AND (clients.canonical_client_id IS NULL OR clients.canonical_client_id = '')`,
      params: [
        row.documentId || row.canonicalClientId,
        row.canonicalClientId,
        row.salonId,
        name,
        row.phoneNormalized || null,
        row.firebaseUid || null,
        jsonArray(row.legacyIds || []),
        row.createdAt,
        row.updatedAt,
      ],
    };
  }
  return {
    sql: `INSERT OR IGNORE INTO clients
      (canonical_client_id, salon_id, name, phone_normalized, firebase_uid, legacy_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.canonicalClientId,
      row.salonId,
      name,
      row.phoneNormalized || null,
      row.firebaseUid || null,
      jsonArray(row.legacyIds || []),
      row.createdAt,
      row.updatedAt,
    ],
  };
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
    canonicalClientId: cleanText(row.canonical_client_id || row.id),
    documentId: optionalText(row.id),
    name: optionalText(row.name),
    phoneNormalized: optionalText(row.phone_normalized),
    firebaseUid: optionalText(row.firebase_uid),
    legacyIds: dedupe([...safeJsonArray(row.legacy_ids_json), row.legacy_client_doc_id]),
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
    reason: row.reason || undefined,
    createdByUid: row.created_by_uid || undefined,
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
    `SELECT alias_id FROM client_identity_aliases
      WHERE salon_id = ? AND canonical_client_id = ? AND alias_type <> 'lookup' ORDER BY alias_id`,
    [salonId, canonicalClientId]
  ).then((rows) => rows.map((row) => cleanText(row.alias_id)).filter(Boolean));
}

function clientIdColumn(ctx) {
  return usesUnifiedCoreClients(ctx) ? "COALESCE(NULLIF(canonical_client_id, ''), id)" : 'canonical_client_id';
}

async function resolveByAliases(db, salonId, lookupIds) {
  if (!lookupIds.length) return null;
  const rows = await dbAll(
    db,
    `SELECT alias_id, canonical_client_id
       FROM client_identity_aliases
      WHERE salon_id = ? AND alias_id IN (${placeholders(lookupIds.length)}) AND alias_type <> 'lookup'
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

async function resolveByClientId(ctx, lookupIds) {
  if (!lookupIds.length) return null;
  const rows = await dbAll(
    packagesDb(ctx),
    `SELECT * FROM clients
      WHERE salon_id = ? AND ${clientIdColumn(ctx)} IN (${placeholders(lookupIds.length)})
      LIMIT 2`,
    [ctx.salonId, ...lookupIds]
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

  const aliasId = await resolveByAliases(db, ctx.salonId, lookupIds);
  const [byId, byUid] = await Promise.all([
    resolveByClientId(ctx, dedupe([...lookupIds, aliasId])),
    resolveByFirebaseUid(db, ctx.salonId, firebaseUid),
  ]);
  if (byId && byUid && byId.canonicalClientId !== byUid.canonicalClientId) {
    throw new AppError(409, 'packages_client:ambiguous_identity');
  }
  const client = byId || byUid || (options.allowPhone !== false && await resolveByPhone(db, ctx.salonId, phones));
  if (client) {
    if (firebaseUid && client.firebaseUid && client.firebaseUid !== firebaseUid) {
      throw new AppError(409, 'packages_client:ambiguous_identity');
    }
    return packageIdentity(ctx, client);
  }

  // A sale or grant may provision a client inside its package/ledger batch.
  // Caller-supplied identifiers must never create a Firebase link or aliases.
  const newId = requestedId || (phones.length === 1 ? `phone_${phones[0]}` : '');
  if (options.allowCreate && newId && !firebaseUid) {
    const canonicalClientId = requiredDocumentId(newId, 'clientId');
    return {
      canonicalClientId,
      clientId: canonicalClientId,
      name: optionalText(lookup.name || data.clientName),
      phoneNormalized: phones[0] || null,
      legacyIds: [],
      aliasClientIds: [],
    };
  }
  throw new AppError(404, "packages_client:not_found", "Client was not found");
}

async function packageIdentity(ctx, client) {
  const canonicalClientId = client.canonicalClientId;
  const db = packagesDb(ctx);
  const aliases = dedupe([...client.legacyIds, ...await fetchAliases(db, ctx.salonId, canonicalClientId)]);
  const foreignOwners = aliases.length ? await dbAll(
    db,
    `SELECT * FROM clients WHERE salon_id = ? AND ${clientIdColumn(ctx)} IN (${placeholders(aliases.length)})
       AND firebase_uid IS NOT NULL AND firebase_uid <> '' AND firebase_uid <> ?`,
    [ctx.salonId, ...aliases, client.firebaseUid || '']
  ) : [];
  const conflictingIds = new Set(foreignOwners.map((row) => clientFromRow(row).canonicalClientId));
  return {
    ...client,
    clientId: canonicalClientId,
    aliasClientIds: aliases.filter((id) => !conflictingIds.has(id)),
  };
}

function lookupDedupeKey(salonId, data = {}) {
  const lookup = data.clientLookup && typeof data.clientLookup === "object" ? data.clientLookup : {};
  return JSON.stringify({
    salonId,
    ids: collectLookupIds(cleanText(data.clientId || data.requestedClientId), lookup),
    phones: collectLookupPhones(lookup),
    uid: primaryFirebaseUid(lookup),
  });
}

async function walletRevision(db, salonId, canonicalClientId) {
  const row = await dbFirst(
    db,
    `SELECT revision FROM package_wallet_versions
      WHERE salon_id = ? AND canonical_client_id = ? LIMIT 1`,
    [salonId, canonicalClientId]
  );
  return Number(row?.revision || 0);
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
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeRevision = await walletRevision(
        packagesDb(ctx), ctx.salonId, identity.canonicalClientId
      );
      response = await walletSummaryD1(ctx, identity, { includeTransactions: false });
      const afterRevision = await walletRevision(
        packagesDb(ctx), ctx.salonId, identity.canonicalClientId
      );
      if (beforeRevision === afterRevision) break;
      response = undefined;
    }
    if (!response) throw new AppError(409, 'packages_wallet:concurrent_modification');
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
    if (pendingWalletRequests.get(dedupeKey) === work) pendingWalletRequests.delete(dedupeKey);
  }
}


function catalogRow(row) {
  return {
    id: cleanText(row.id),
    name: cleanText(row.name),
    description: optionalText(row.description),
    serviceIds: safeJsonArray(row.allowed_service_ids_json),
    allowedServiceIds: safeJsonArray(row.allowed_service_ids_json),
    sessionsCount: Number(row.total_sessions || 0),
    price: Number(row.price || 0),
    validityDays: row.validity_days == null ? undefined : Number(row.validity_days),
    active: Number(row.active) === 1,
    saleEnabled: Number(row.sale_enabled ?? 1) === 1,
    imageUrl: optionalText(row.image_url),
    terms: optionalText(row.terms),
    startsAt: optionalText(row.starts_at),
    endsAt: optionalText(row.ends_at),
    audienceScope: cleanText(row.audience_scope || 'all'),
    targetClientIds: safeJsonArray(row.target_client_ids_json),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPackageCatalogD1(ctx, data = {}) {
  const includeInactive = cleanText(data.includeInactive).toLowerCase() === 'true';
  if (includeInactive) requireCatalogManage(ctx);
  const now = timestampNow();
  const rows = await dbAll(
    packagesDb(ctx),
    includeInactive
      ? `SELECT * FROM package_catalog WHERE salon_id = ? ORDER BY sort_order, name, created_at DESC LIMIT 500`
      : `SELECT * FROM package_catalog
          WHERE salon_id = ? AND active = 1 AND COALESCE(sale_enabled, 1) = 1
            AND (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
            AND (ends_at IS NULL OR ends_at = '' OR ends_at >= ?)
          ORDER BY sort_order, name, created_at DESC LIMIT 500`,
    includeInactive ? [ctx.salonId] : [ctx.salonId, now, now]
  );
  return rows.map(catalogRow);
}

export async function listMyPackageCatalogD1(ctx) {
  const identity = await resolveVerifiedPackageClient(ctx);
  const rows = await listPackageCatalogD1(ctx, {});
  const allowedIds = new Set([
    identity.canonicalClientId,
    ctx.identity?.uid,
    ...(identity.aliasClientIds || []),
  ].map(cleanText).filter(Boolean));
  return rows.filter((row) => {
    const scope = cleanText(row.audienceScope || "all").toLowerCase();
    if (!scope || scope === "all") return true;
    return (row.targetClientIds || []).some((id) => allowedIds.has(cleanText(id)));
  });
}

export async function createPackageCatalogD1(ctx, data) {
  requireCatalogManage(ctx);
  const snapshot = buildPurchasedPackageSnapshot(data);
  const id = requiredDocumentId(data.id || `package_${crypto.randomUUID()}`, 'id');
  const now = timestampNow();
  const validityDays = snapshot.validityDays || null;
  const active = data.active === false ? 0 : 1;
  const saleEnabled = data.saleEnabled === false ? 0 : 1;
  const sortOrder = boundedInteger(Number(data.sortOrder || 0), 'sortOrder', { min: 0, max: 1000000, allowZero: true });
  await dbRun(
    packagesDb(ctx),
    `INSERT INTO package_catalog
      (id, salon_id, name, total_sessions, price, allowed_service_ids_json, active, created_at, updated_at,
       description, validity_days, image_url, terms, starts_at, ends_at, sale_enabled,
       audience_scope, target_client_ids_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ctx.salonId, snapshot.name, snapshot.sessionsCount, snapshot.price,
      jsonArray(snapshot.allowedServiceIds), active, now, now,
      snapshot.description || null, validityDays, optionalText(data.imageUrl) || null,
      boundedText(data.terms, 'terms', 5000) || null, optionalText(data.startsAt) || null,
      optionalText(data.endsAt) || null, saleEnabled, cleanText(data.audienceScope || 'all'),
      jsonArray(data.targetClientIds || []), sortOrder,
    ]
  );
  return catalogRow(await dbFirst(packagesDb(ctx), 'SELECT * FROM package_catalog WHERE salon_id = ? AND id = ? LIMIT 1', [ctx.salonId, id]));
}

export async function updatePackageCatalogD1(ctx, data) {
  requireCatalogManage(ctx);
  const id = requiredDocumentId(data.id || data.packageCatalogId, 'id');
  const db = packagesDb(ctx);
  const current = await dbFirst(db, 'SELECT * FROM package_catalog WHERE salon_id = ? AND id = ? LIMIT 1', [ctx.salonId, id]);
  if (!current) throw new AppError(404, 'packages_catalog:not_found');
  const merged = {
    name: data.name ?? current.name,
    description: data.description ?? current.description,
    sessionsCount: data.sessionsCount ?? current.total_sessions,
    price: data.price ?? current.price,
    allowedServiceIds: data.allowedServiceIds ?? data.serviceIds ?? safeJsonArray(current.allowed_service_ids_json),
    validityDays: data.validityDays ?? current.validity_days,
  };
  const snapshot = buildPurchasedPackageSnapshot(merged);
  const now = timestampNow();
  await dbRun(
    db,
    `UPDATE package_catalog SET
      name = ?, total_sessions = ?, price = ?, allowed_service_ids_json = ?, active = ?, updated_at = ?,
      description = ?, validity_days = ?, image_url = ?, terms = ?, starts_at = ?, ends_at = ?,
      sale_enabled = ?, audience_scope = ?, target_client_ids_json = ?, sort_order = ?
     WHERE salon_id = ? AND id = ?`,
    [
      snapshot.name, snapshot.sessionsCount, snapshot.price, jsonArray(snapshot.allowedServiceIds),
      data.active === undefined ? Number(current.active) : (data.active === false ? 0 : 1), now,
      snapshot.description || null, snapshot.validityDays || null,
      data.imageUrl === undefined ? current.image_url : optionalText(data.imageUrl) || null,
      data.terms === undefined ? current.terms : boundedText(data.terms, 'terms', 5000) || null,
      data.startsAt === undefined ? current.starts_at : optionalText(data.startsAt) || null,
      data.endsAt === undefined ? current.ends_at : optionalText(data.endsAt) || null,
      data.saleEnabled === undefined ? Number(current.sale_enabled ?? 1) : (data.saleEnabled === false ? 0 : 1),
      data.audienceScope === undefined ? cleanText(current.audience_scope || 'all') : cleanText(data.audienceScope || 'all'),
      data.targetClientIds === undefined ? cleanText(current.target_client_ids_json || '[]') : jsonArray(data.targetClientIds),
      data.sortOrder === undefined ? Number(current.sort_order || 0) : boundedInteger(Number(data.sortOrder), 'sortOrder', { min: 0, max: 1000000, allowZero: true }),
      ctx.salonId, id,
    ]
  );
  return catalogRow(await dbFirst(db, 'SELECT * FROM package_catalog WHERE salon_id = ? AND id = ? LIMIT 1', [ctx.salonId, id]));
}

export async function deletePackageCatalogD1(ctx, data) {
  requireCatalogManage(ctx);
  const id = requiredDocumentId(data.id || data.packageCatalogId, 'id');
  const db = packagesDb(ctx);
  const sold = await dbFirst(db, 'SELECT COUNT(*) AS count FROM client_packages WHERE salon_id = ? AND package_catalog_id = ?', [ctx.salonId, id]);
  if (Number(sold?.count || 0) > 0) {
    await dbRun(db, 'UPDATE package_catalog SET active = 0, sale_enabled = 0, updated_at = ? WHERE salon_id = ? AND id = ?', [timestampNow(), ctx.salonId, id]);
    return { id, deleted: false, archived: true };
  }
  const result = await dbRun(db, 'DELETE FROM package_catalog WHERE salon_id = ? AND id = ?', [ctx.salonId, id]);
  if (changes(result) < 1) throw new AppError(404, 'packages_catalog:not_found');
  return { id, deleted: true, archived: false };
}

async function resolveVerifiedPackageClient(ctx) {
  if (ctx.role !== "client") throw new AppError(403, "packages_auth:client_required");
  const uid = cleanText(ctx.identity?.uid);
  if (!uid) throw new AppError(401, 'packages_auth:login_required');
  const db = packagesDb(ctx);
  let client = await resolveByFirebaseUid(db, ctx.salonId, uid);
  if (!client) {
    if (await resolveByClientId(ctx, [uid])) {
      throw new AppError(409, 'packages_client:ambiguous_identity');
    }
    const now = timestampNow();
    const insert = clientInsertStatement(ctx, {
      canonicalClientId: uid,
      salonId: ctx.salonId,
      firebaseUid: uid,
      createdAt: now,
      updatedAt: now,
    });
    await dbRun(db, insert.sql, insert.params);
    client = await resolveByFirebaseUid(db, ctx.salonId, uid);
    if (!client) throw new AppError(409, 'packages_client:ambiguous_identity');
  }
  return packageIdentity(ctx, client);
}

export async function myWalletD1(ctx) {
  return walletSummaryD1(ctx, await resolveVerifiedPackageClient(ctx));
}


export async function grantClientSessionsAdminD1(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const db = packagesDb(ctx);
  const packageCatalogId = requiredDocumentId(data.packageCatalogId, "packageCatalogId");
  const sessionsCount = boundedInteger(Number(data.sessionsCount || 1), "sessionsCount", {
    min: 1,
    max: PACKAGE_LIMITS.sessions,
  });
  const operationSource = requiredExternalId(data.operationId, "operationId");
  const reason =
    boundedText(data.reason, "reason", PACKAGE_LIMITS.reason) ||
    "إضافة جلسة إدارية";
  const expiresAt = optionalText(data.expiresAt);
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
    throw new AppError(400, "packages_d1:expires_at_invalid");
  }

  const identity = await resolveD1ClientIdentity(
    ctx,
    {
      clientId: data.clientId,
      clientName: data.clientName,
      clientLookup: {
        ...(data.clientLookup && typeof data.clientLookup === "object"
          ? data.clientLookup
          : {}),
        name:
          optionalText(data.clientName) ||
          optionalText(data.clientLookup?.name) ||
          undefined,
        phone:
          optionalText(data.phone) ||
          optionalText(data.clientLookup?.phone) ||
          optionalText(data.clientLookup?.mobile) ||
          undefined,
      },
    },
    { allowCreate: true }
  );

  const catalog = await dbFirst(
    db,
    "SELECT * FROM package_catalog WHERE salon_id = ? AND id = ? AND active = 1 LIMIT 1",
    [ctx.salonId, packageCatalogId]
  );
  if (!catalog) {
    throw new AppError(
      404,
      "packages_catalog:not_found",
      "Package catalog item was not found"
    );
  }

  const clientPackageId = (
    await transactionId("admin_grant_package", operationSource)
  ).replace(/^admin_grant_package:/, "pkg_");
  const transactionDocumentId = await transactionId(
    "admin_grant",
    operationSource
  );

  const existing = await dbFirst(
    db,
    "SELECT * FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1",
    [ctx.salonId, clientPackageId]
  );
  if (existing) {
    if (
      cleanText(existing.canonical_client_id) !== identity.canonicalClientId ||
      cleanText(existing.package_catalog_id) !== packageCatalogId
    ) {
      throw new AppError(409, "packages_idempotency:admin_grant_conflict");
    }
    return {
      ok: true,
      idempotent: true,
      clientPackageId,
      clientId: identity.canonicalClientId,
      canonicalClientId: identity.canonicalClientId,
      packageCatalogId,
      packageName: cleanText(existing.package_name_snapshot),
      sessionsCount: Number(existing.total_sessions || 0),
      expiresAt: optionalText(existing.expires_at) || null,
    };
  }

  const now = timestampNow();
  const validityDays = Number(catalog.validity_days || 0);
  const resolvedExpiry =
    expiresAt ||
    (validityDays > 0
      ? timestampFromMs(Date.parse(now) + validityDays * 24 * 60 * 60 * 1000)
      : null);
  const packageName = cleanText(catalog.name) || "جلسة";
  const allowedServiceIdsJson =
    cleanText(catalog.allowed_service_ids_json) || "[]";

  await dbBatch(db, [
    clientInsertStatement(ctx, {
      canonicalClientId: identity.canonicalClientId,
      salonId: ctx.salonId,
      name:
        optionalText(data.clientName) ||
        identity.name ||
        "عميلة",
      phoneNormalized: identity.phoneNormalized || null,
      firebaseUid: identity.firebaseUid || null,
      legacyIds: identity.legacyIds || [],
      createdAt: now,
      updatedAt: now,
    }),
    {
      sql: `INSERT INTO client_packages
        (id, salon_id, canonical_client_id, package_catalog_id, package_name_snapshot, allowed_service_ids_json,
         total_sessions, remaining_sessions, reserved_sessions, used_sessions, status, purchased_at, expires_at,
         invoice_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', ?, ?, NULL, ?, ?)`,
      params: [
        clientPackageId,
        ctx.salonId,
        identity.canonicalClientId,
        packageCatalogId,
        packageName,
        allowedServiceIdsJson,
        sessionsCount,
        sessionsCount,
        now,
        resolvedExpiry,
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO package_transactions
        (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
         remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
         service_id, booking_id, cart_item_id, invoice_id, reason, created_by_uid, created_at)
       VALUES (?, ?, ?, ?, 'admin_grant', ?, 0, ?, 0, 0, 0, 0, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      params: [
        transactionDocumentId,
        ctx.salonId,
        clientPackageId,
        identity.canonicalClientId,
        sessionsCount,
        sessionsCount,
        reason,
        cleanText(ctx.identity?.uid) || null,
        now,
      ],
    },
  ]);

  clearD1WalletRuntimeCaches();
  return {
    ok: true,
    clientPackageId,
    clientId: identity.canonicalClientId,
    canonicalClientId: identity.canonicalClientId,
    packageCatalogId,
    packageName,
    sessionsCount,
    expiresAt: resolvedExpiry,
  };
}

export async function purchasePackageD1(
  ctx, data, executionContext = null
) {
  requireRole(ctx.role, SALES_ROLES);
  const db = ctx.coreDb;
  if (!db) throw new AppError(503, 'packages_d1:not_configured');
  if (executionContext) {
    if (
      executionContext.salonId !== ctx.salonId ||
      !cleanText(ctx.identity?.uid) ||
      !cleanText(ctx.user?.id) ||
      executionContext.actorUid !== ctx.identity.uid ||
      executionContext.accountId !== ctx.user.id
    ) {
      throw new AppError(
        409, "packages_purchase:execution_identity_conflict"
      );
    }

    if (
      data.salonId != null &&
      cleanText(data.salonId) !== ctx.salonId
    ) {
      throw new AppError(
        409, "packages_purchase:execution_identity_conflict"
      );
    }
  }

  const packageCatalogId = requiredDocumentId(data.packageCatalogId, "packageCatalogId");
  const input = parsePackageSale(data);
  const { saleReference } = input;
  const identity = await resolveD1ClientIdentity(ctx, data, { allowCreate: true });

  const findReplay = async () => {
    const sale = await dbFirst(db, `SELECT * FROM package_sales
      WHERE salon_id = ? AND sale_reference = ?`, [ctx.salonId, saleReference]);
    if (sale) return checkPackageSaleReplay(sale, input, identity.canonicalClientId, packageCatalogId);

    const matches = await dbAll(db, `SELECT cp.* FROM client_packages cp
      WHERE cp.salon_id = ? AND cp.invoice_id = ?
        AND NOT EXISTS (SELECT 1 FROM package_sales s WHERE s.client_package_id = cp.id)
      LIMIT 2`, [ctx.salonId, saleReference]);
    const referencedInvoices = await dbAll(
      db, `SELECT id, salon_id, client_id FROM invoices
        WHERE id = ? OR (salon_id = ? AND invoice_number = ?) LIMIT 2`,
      [saleReference, ctx.salonId, saleReference]
    );
    const [existing] = matches;
    if (referencedInvoices.length && (
      !existing || referencedInvoices.length !== 1 || referencedInvoices[0].salon_id !== ctx.salonId ||
      referencedInvoices[0].client_id !== (identity.documentId || identity.canonicalClientId)
    )) throw new AppError(409, 'packages_purchase:invoice_reference_conflict');
    if (!existing) return null;
    if (matches.length > 1 || existing.canonical_client_id !== identity.canonicalClientId ||
        existing.package_catalog_id !== packageCatalogId ||
        Object.keys(input.quote).length ||
        (input.purchasedAt !== undefined && existing.purchased_at !== input.purchasedAt) ||
        (input.expiresAt !== undefined && existing.expires_at !== input.expiresAt)) {
      throw new AppError(409, "packages_idempotency:purchase_conflict");
    }
    return {
      ok: true,
      idempotent: true,
      settlementStatus: 'unverified',
      saleReference,
      clientPackageId: existing.id,
      invoiceId: null,
      invoiceDocumentId: null,
      invoiceNumber: null,
      clientId: identity.canonicalClientId,
      canonicalClientId: identity.canonicalClientId,
    };
  };
  const replay = await findReplay();
  if (replay) {
    if (executionContext) {
      throw new AppError(
        409,
        "packages_purchase:existing_operation_requires_verification"
      );
    }
    return replay;
  }

  const now = timestampNow();
  const catalog = await dbFirst(
    db,
    `SELECT * FROM package_catalog
     WHERE salon_id = ? AND id = ? AND active = 1 AND COALESCE(sale_enabled, 1) = 1
       AND (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
       AND (ends_at IS NULL OR ends_at = '' OR ends_at >= ?)
     LIMIT 1`,
    [ctx.salonId, packageCatalogId, now, now]
  );
  if (!catalog) throw new AppError(404, "packages_catalog:not_found", "Package catalog item was not found");

  const purchaseKey = JSON.stringify([ctx.salonId, saleReference]);
  const clientPackageId = (await transactionId("client_package", purchaseKey)).replace(/^client_package:/, "pkg_");
  const purchaseTxId = await transactionId("purchase", purchaseKey);
  const totalSessions = Number(catalog.total_sessions || 0);
  const allowedServiceIdsJson = cleanText(catalog.allowed_service_ids_json) || "[]";
  const { sale, statements: financialStatements } = await buildPackageSettlement(ctx, {
    catalog, identity, input, clientPackageId, purchaseTxId, now,
  });

  const statements = [
    clientInsertStatement(ctx, {
      documentId: identity.documentId,
      canonicalClientId: identity.canonicalClientId,
      salonId: ctx.salonId,
      name: identity.name || "عميلة",
      phoneNormalized: identity.phoneNormalized || null,
      firebaseUid: identity.firebaseUid || null,
      legacyIds: identity.legacyIds || [],
      createdAt: now,
      updatedAt: now,
    }),
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
        sale.purchased_at,
        sale.expires_at,
        sale.invoice_id,
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO package_transactions
        (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
         remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
         service_id, booking_id, cart_item_id, invoice_id, created_at, created_by_uid)
       VALUES (?, ?, ?, ?, 'purchase', ?, 0, ?, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?, ?)`,
      params: [purchaseTxId, ctx.salonId, clientPackageId, identity.canonicalClientId, totalSessions, totalSessions,
        sale.invoice_id, now, cleanText(ctx.identity?.uid) || null],
    },
    ...financialStatements,
  ];

  const result = packageSaleResult(sale, false);

  if (executionContext) {
    statements.push(
      ...atomicIdempotencyCompletionStatements({
        salonId: ctx.salonId,
        operationId: executionContext.operationId,
        fingerprint: executionContext.fingerprint,
        requestId: executionContext.requestId,
        executionToken: executionContext.executionToken,
        status: 200,
        responseBody: JSON.stringify({
          ok: true,
          data: result,
        }),
      })
    );
  }

  try {
    await dbBatch(db, statements);
  } catch (error) {
    // Atomic callers must never convert a conflicting or
    // unverified historical sale into a new HTTP commit.
    if (!executionContext) {
      const committed = await findReplay();
      if (committed) return committed;
    }
    throw normalizePackageSettlementError(error);
  }
  clearD1WalletRuntimeCaches();
  return result;
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

function assertTransactionReplay(prior, scope) {
  if (Object.entries(scope).some(([key, value]) => cleanText(prior[key]) !== cleanText(value))) {
    throw new AppError(409, 'packages_idempotency:transaction_conflict');
  }
}

async function balanceTransactionD1(ctx, data, transition) {
  requireRole(ctx.role, SALES_ROLES);
  const db = packagesDb(ctx);
  const identity = await resolveD1ClientIdentity(ctx, data, { allowPhone: false });
  const clientPackageId = requiredDocumentId(data.clientPackageId, "clientPackageId");
  const serviceId = optionalText(data.serviceId);
  const row = await packageForOperation(ctx, identity, clientPackageId);
  const txSource = data.operationId || data.bookingId || data.cartItemId || `${transition.type}_${Date.now()}`;
  const txId = await transactionId(transition.type, txSource);
  const bookingId = cleanText(data.bookingId) || cleanText(data.operationId);
  const cartItemId = cleanText(data.cartItemId);
  const invoiceId = cleanText(data.invoiceId);
  const findReplay = async () => {
    const priorTx = await dbFirst(db, "SELECT * FROM package_transactions WHERE id = ? LIMIT 1", [txId]);
    if (!priorTx) return null;
    assertTransactionReplay(priorTx, {
      salon_id: ctx.salonId,
      canonical_client_id: row.canonical_client_id,
      client_package_id: clientPackageId,
      type: transition.type,
      service_id: serviceId,
      booking_id: bookingId,
      cart_item_id: cartItemId,
      invoice_id: invoiceId,
    });
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
  };
  const replay = await findReplay();
  if (replay) return replay;

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
  const recordsBookingItem = (transition.type === 'reserve' || transition.type === 'redeem') && bookingId && cartItemId;
  const bookingItemGuard = recordsBookingItem ? `AND NOT EXISTS (
      SELECT 1 FROM package_transactions
      WHERE salon_id = ? AND booking_id = ? AND cart_item_id = ? AND type IN ('reserve', 'redeem')
    )` : '';
  const updateSql = `UPDATE client_packages
      SET remaining_sessions = ?, reserved_sessions = ?, used_sessions = ?, status = ?, updated_at = ?
    WHERE salon_id = ? AND id = ? AND canonical_client_id = ?
      AND remaining_sessions = ? AND reserved_sessions = ? AND used_sessions = ? AND status = ? AND updated_at = ?
      ${bookingItemGuard}`;
  const insertSql = `INSERT INTO package_transactions
      (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
       remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
       service_id, booking_id, cart_item_id, invoice_id, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE changes() = 1`;
  const statements = [
    {
      sql: updateSql,
      params: [
        after.remaining,
        after.reserved,
        after.used,
        status,
        now,
        ctx.salonId,
        clientPackageId,
        row.canonical_client_id,
        before.remaining,
        before.reserved,
        before.used,
        row.status,
        row.updated_at,
        ...(recordsBookingItem ? [ctx.salonId, bookingId, cartItemId] : []),
      ],
    },
    {
      sql: insertSql,
      params: [
        txId,
        ctx.salonId,
        clientPackageId,
        row.canonical_client_id,
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
        invoiceId || null,
        now,
      ],
    },
  ];
  let results;
  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    const committed = await findReplay();
    if (committed) return committed;
    throw error;
  }
  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1) {
    const committed = await findReplay();
    if (committed) return committed;
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
  requireRole(ctx.role, SALES_ROLES);
  const bookingId = optionalText(data.bookingId);
  if (bookingId) {
    const ledger = await bookingSessionLedger(ctx, requiredExternalId(bookingId, 'bookingId'));
    const sources = ledger.sources.filter((row) => row.type === 'reserve' &&
      (!data.clientPackageId || row.client_package_id === data.clientPackageId) &&
      (!data.cartItemId || row.cart_item_id === data.cartItemId));
    if (!sources.length) throw new AppError(404, 'packages_redemption:not_found');
    if (sources.length !== 1) throw new AppError(409, 'packages_redemption:ambiguous_reservation');
    const [source] = sources;
    if (data.clientId || data.clientLookup || data.requestedClientId) {
      const identity = await resolveD1ClientIdentity(ctx, data, { allowPhone: false });
      await packageForOperation(ctx, identity, source.client_package_id);
    }
    const operationId = cleanText(data.operationId);
    if (operationId) {
      const txId = await transactionId('release', operationId);
      const prior = await dbFirst(packagesDb(ctx), 'SELECT * FROM package_transactions WHERE id = ? LIMIT 1', [txId]);
      if (prior) {
        assertTransactionReplay(prior, {
          salon_id: ctx.salonId, type: 'release', client_package_id: source.client_package_id,
          canonical_client_id: source.canonical_client_id, booking_id: bookingId, cart_item_id: source.cart_item_id,
        });
        return { ok: true, idempotent: true, packageTransactionId: txId };
      }
    }
    const current = currentSessionState(source, ledger.rows, ledger.sources);
    if (current.state === 'remaining') return { ok: true, idempotent: true };
    if (current.state !== 'reserved') throw new AppError(409, 'package_balance:no_reserved_session');
    const sourceKey = operationId || `${bookingId}:${bookingSessionKey(source)}:${cleanText(current.lastMovement.id)}`;
    const result = await applySessionTransition(
      ctx, source, 'reserved', 'remaining', 'release', sourceKey, data.reason, current.lastMovement
    );
    clearD1WalletRuntimeCaches();
    return result;
  }

  return balanceTransactionD1(ctx, data, {
    type: "release",
    sessionsDelta: 1,
    requireReserved: true,
    apply: (before) => ({ ...before, remaining: before.remaining + 1, reserved: before.reserved - 1 }),
  });
}

function bookingSessionKey(row) {
  const clientPackageId = cleanText(row?.client_package_id);
  const cartItemId = cleanText(row?.cart_item_id);
  const serviceId = cleanText(row?.service_id);
  return `${clientPackageId}|${cartItemId || serviceId || cleanText(row?.id)}`;
}

function movementsForSessionSource(source, allRows, allSources) {
  const packageId = cleanText(source.client_package_id);
  const sourceCart = cleanText(source.cart_item_id);
  const sourceService = cleanText(source.service_id);
  const samePackageSources = allSources.filter((row) => cleanText(row.client_package_id) === packageId);
  return allRows
    .filter((row) => {
      if (row.id === source.id || cleanText(row.client_package_id) !== packageId) return false;
      const rowCart = cleanText(row.cart_item_id);
      if (sourceCart && rowCart === sourceCart) return true;
      if (!sourceCart && !rowCart && sourceService && cleanText(row.service_id) === sourceService) return true;
      // Compatibility with the old single-session implementation which did not
      // persist cart_item_id on consume/restore rows.
      return samePackageSources.length === 1 && !rowCart;
    })
    .sort((a, b) => {
      const dateDiff = cleanText(a.created_at).localeCompare(cleanText(b.created_at));
      return dateDiff || cleanText(a.id).localeCompare(cleanText(b.id));
    });
}

function currentSessionState(source, allRows, allSources) {
  let state = cleanText(source.type) === 'redeem' ? 'used' : 'reserved';
  let lastMovement = source;
  for (const row of movementsForSessionSource(source, allRows, allSources)) {
    const type = cleanText(row.type);
    if (type === 'consume' || type === 'redeem' || type === 'reapply_used') state = 'used';
    if (type === 'reserve' || type === 'reapply_reserved') state = 'reserved';
    if (type === 'release' || type === 'restore') state = 'remaining';
    lastMovement = row;
  }
  return { state, lastMovement };
}

async function bookingSessionLedger(ctx, bookingId) {
  const rows = await dbAll(
    packagesDb(ctx),
    `SELECT * FROM package_transactions
      WHERE salon_id = ? AND booking_id = ?
      ORDER BY created_at ASC, id ASC`,
    [ctx.salonId, bookingId]
  );
  const sources = rows.filter((row) => ['reserve', 'redeem'].includes(cleanText(row.type)));
  return { rows, sources };
}

async function assertStandaloneBookingLifecycle(ctx, bookingId, ledger) {
  const persistedBooking = await dbFirst(
    packagesDb(ctx),
    'SELECT id FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1',
    [ctx.salonId, bookingId]
  );
  if (persistedBooking) {
    throw new AppError(
      409,
      'packages_redemption:core_booking_lifecycle_owned',
      'Persisted Core bookings must use the atomic Core booking lifecycle'
    );
  }
  for (const source of ledger.sources) {
    if (
      !cleanText(source.client_package_id) ||
      !cleanText(source.canonical_client_id) ||
      !cleanText(source.service_id)
    ) {
      throw new AppError(409, 'packages_redemption:history_review_required');
    }
  }
}

function assertSingleStandaloneTransition(count) {
  if (count > 1) {
    throw new AppError(
      409,
      'packages_redemption:multi_item_atomic_workflow_required'
    );
  }
}

async function applySessionTransition(ctx, source, fromState, toState, type, operationSource, reason, lastMovement) {
  const db = packagesDb(ctx);
  const txId = await transactionId(type, operationSource);
  const row = await directPackageRow(ctx, source.client_package_id);
  const findReplay = async () => {
    const prior = await dbFirst(db, 'SELECT * FROM package_transactions WHERE id = ? LIMIT 1', [txId]);
    if (!prior) return null;
    assertTransactionReplay(prior, {
      salon_id: ctx.salonId,
      canonical_client_id: row.canonical_client_id,
      client_package_id: row.id,
      type,
      booking_id: source.booking_id,
      cart_item_id: source.cart_item_id,
      service_id: source.service_id,
    });
    return { ok: true, idempotent: true, packageTransactionId: txId };
  };
  const replay = await findReplay();
  if (replay) return replay;

  const latest = await bookingSessionLedger(ctx, source.booking_id);
  if (currentSessionState(source, latest.rows, latest.sources).lastMovement.id !== lastMovement.id) {
    throw new AppError(409, 'package_balance:conflict', 'Reservation state changed; retry the operation');
  }
  const before = {
    remaining: Number(row.remaining_sessions),
    reserved: Number(row.reserved_sessions),
    used: Number(row.used_sessions),
  };
  const after = { ...before };
  if (fromState === 'reserved') {
    if (before.reserved <= 0) throw new AppError(409, 'package_balance:no_reserved_session');
    after.reserved -= 1;
  } else if (fromState === 'used') {
    if (before.used <= 0) throw new AppError(409, 'package_balance:no_used_session');
    after.used -= 1;
  } else if (fromState === 'remaining') {
    if (before.remaining <= 0) throw new AppError(409, 'package_balance:insufficient_remaining');
    after.remaining -= 1;
  } else {
    throw new AppError(409, 'package_balance:invalid_transition');
  }

  if (toState === 'reserved') after.reserved += 1;
  else if (toState === 'used') after.used += 1;
  else if (toState === 'remaining') after.remaining += 1;
  else throw new AppError(409, 'package_balance:invalid_transition');

  const status = after.remaining === 0 && after.reserved === 0 ? 'exhausted' : 'active';
  // Movements for one reservation must have a stable order even in the same millisecond.
  const now = timestampFromMs(Math.max(Date.now(), (timestampMs(lastMovement.created_at) ?? 0) + 1));
  const actorUid = cleanText(ctx.identity?.uid) || null;
  const statements = [
    {
      sql: `UPDATE client_packages
              SET remaining_sessions = ?, reserved_sessions = ?, used_sessions = ?, status = ?, updated_at = ?
            WHERE salon_id = ? AND id = ? AND canonical_client_id = ?
              AND remaining_sessions = ? AND reserved_sessions = ? AND used_sessions = ?
              AND status = ? AND updated_at = ?`,
      params: [
        after.remaining, after.reserved, after.used, status, now,
        ctx.salonId, row.id, row.canonical_client_id, before.remaining, before.reserved, before.used,
        row.status, row.updated_at,
      ],
    },
    {
      sql: `INSERT INTO package_transactions
        (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
         remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
         service_id, booking_id, cart_item_id, invoice_id, created_at, reason, created_by_uid)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
       WHERE changes() = 1`,
      params: [
        txId, ctx.salonId, row.id, row.canonical_client_id, type,
        after.remaining - before.remaining,
        before.remaining, after.remaining,
        before.reserved, after.reserved,
        before.used, after.used,
        source.service_id || null,
        source.booking_id || null,
        source.cart_item_id || null,
        now,
        boundedText(reason, 'reason', PACKAGE_LIMITS.reason) || null,
        actorUid,
      ],
    },
  ];
  let results;
  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    const committed = await findReplay();
    if (committed) return committed;
    throw error;
  }
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    const committed = await findReplay();
    if (committed) return committed;
    throw new AppError(409, 'package_balance:conflict', 'Package balance changed; retry the operation');
  }
  clearD1WalletRuntimeCaches();
  return {
    ok: true,
    clientPackageId: row.id,
    packageTransactionId: txId,
    cartItemId: source.cart_item_id || '',
    fromState,
    toState,
    remainingBefore: before.remaining,
    remainingAfter: after.remaining,
  };
}

export async function consumeReservedD1(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const bookingId = optionalText(data.bookingId);
  if (!bookingId) {
    // Backward compatibility for callers that still send a complete package
    // identity instead of a booking reference.
    return balanceTransactionD1(ctx, data, {
      type: 'consume',
      sessionsDelta: 0,
      requireReserved: true,
      apply: (before) => ({ ...before, reserved: before.reserved - 1, used: before.used + 1 }),
    });
  }

  const ledger = await bookingSessionLedger(ctx, requiredExternalId(bookingId, 'bookingId'));
  const sources = ledger.sources.filter((row) => cleanText(row.type) === 'reserve');
  if (!sources.length) throw new AppError(404, 'packages_redemption:not_found');
  await assertStandaloneBookingLifecycle(ctx, bookingId, { ...ledger, sources });
  assertSingleStandaloneTransition(
    sources.filter(source => currentSessionState(source, ledger.rows, ledger.sources).state === 'reserved').length
  );

  const items = [];
  for (const source of sources) {
    const current = currentSessionState(source, ledger.rows, ledger.sources);
    if (current.state !== 'reserved') {
      items.push({ clientPackageId: source.client_package_id, cartItemId: source.cart_item_id || '', idempotent: true, state: current.state });
      continue;
    }
    const sourceKey = `${bookingId}:${bookingSessionKey(source)}:${cleanText(current.lastMovement.id)}`;
    const result = await applySessionTransition(
      ctx,
      source,
      'reserved',
      'used',
      'consume',
      sourceKey,
      data.reason || 'booking_completed',
      current.lastMovement
    );
    items.push(result);
    ledger.rows.push({
      id: result.packageTransactionId,
      salon_id: ctx.salonId,
      client_package_id: source.client_package_id,
      type: 'consume',
      booking_id: bookingId,
      cart_item_id: source.cart_item_id,
      created_at: timestampNow(),
    });
  }
  clearD1WalletRuntimeCaches();
  return { ok: true, bookingId, items, idempotent: items.every((item) => item.idempotent) };
}


async function directPackageRow(ctx, clientPackageId) {
  const row = await dbFirst(
    packagesDb(ctx),
    'SELECT * FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1',
    [ctx.salonId, requiredDocumentId(clientPackageId, 'clientPackageId')]
  );
  if (!row) throw new AppError(404, 'packages_d1:client_package_not_found');
  assertPackageInvariant(row);
  return row;
}

async function matchAdministrativeReplay(ctx, row, txId, type, sessionsDelta, reason) {
  const prior = await dbFirst(packagesDb(ctx), 'SELECT * FROM package_transactions WHERE id = ? LIMIT 1', [txId]);
  if (!prior) return null;
  assertTransactionReplay(prior, {
    salon_id: ctx.salonId,
    canonical_client_id: row.canonical_client_id,
    client_package_id: row.id,
    type,
    sessions_delta: sessionsDelta,
    reason,
  });
  return { ok: true, idempotent: true, clientPackageId: row.id, packageTransactionId: txId };
}

export async function adjustClientPackageD1(ctx, data) {
  requireRole(ctx.role, ADMIN_ROLES);
  const row = await directPackageRow(ctx, data.clientPackageId);
  const delta = boundedInteger(Number(data.sessionsDelta), 'sessionsDelta', { min: -PACKAGE_LIMITS.adjustmentSessions, max: PACKAGE_LIMITS.adjustmentSessions });
  const reason = boundedText(data.reason, 'reason', PACKAGE_LIMITS.reason, true);
  const txId = await transactionId('admin_adjustment', data.operationId || `${row.id}:${delta}:${reason}`);
  const replay = await matchAdministrativeReplay(ctx, row, txId, 'admin_adjustment', delta, reason);
  if (replay) return replay;
  const before = { remaining: Number(row.remaining_sessions), reserved: Number(row.reserved_sessions), used: Number(row.used_sessions) };
  const remaining = before.remaining + delta;
  if (remaining < 0) throw new AppError(409, 'package_balance:insufficient_remaining');
  const total = remaining + before.reserved + before.used;
  const status = remaining === 0 && before.reserved === 0 ? 'exhausted' : 'active';
  const now = timestampNow();
  const results = await dbBatch(packagesDb(ctx), [
    { sql: `UPDATE client_packages SET total_sessions = ?, remaining_sessions = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ? AND remaining_sessions = ? AND reserved_sessions = ? AND used_sessions = ? AND status = ? AND updated_at = ?`, params: [total, remaining, status, now, ctx.salonId, row.id, before.remaining, before.reserved, before.used, row.status, row.updated_at] },
    { sql: `INSERT INTO package_transactions (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta, remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after, service_id, booking_id, cart_item_id, invoice_id, created_at, reason, created_by_uid) SELECT ?, ?, ?, ?, 'admin_adjustment', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ? WHERE changes() = 1`, params: [txId, ctx.salonId, row.id, row.canonical_client_id, delta, before.remaining, remaining, before.reserved, before.reserved, before.used, before.used, now, reason, cleanText(ctx.identity?.uid) || null] },
  ]);
  if (changes(results[0]) < 1 || changes(results[1]) < 1) throw new AppError(409, 'package_balance:conflict');
  clearD1WalletRuntimeCaches();
  return { ok: true, clientPackageId: row.id, packageTransactionId: txId, remainingBefore: before.remaining, remainingAfter: remaining };
}

export async function cancelClientPackageD1(ctx, data) {
  requireRole(ctx.role, ADMIN_ROLES);
  const row = await directPackageRow(ctx, data.clientPackageId);
  const reason = boundedText(data.reason, 'reason', PACKAGE_LIMITS.reason, true);
  const txId = await transactionId('cancel', data.operationId || row.id);
  const replay = await matchAdministrativeReplay(ctx, row, txId, 'cancel', 0, reason);
  if (replay) return replay;
  if (cleanText(row.status) === 'cancelled') return { ok: true, idempotent: true, clientPackageId: row.id };
  if (Number(row.reserved_sessions || 0) > 0) throw new AppError(409, 'package_balance:reserved_sessions_exist');
  const now = timestampNow();
  const results = await dbBatch(packagesDb(ctx), [
    { sql: `UPDATE client_packages SET status = 'cancelled', updated_at = ?
      WHERE salon_id = ? AND id = ? AND status = ? AND updated_at = ? AND reserved_sessions = 0
        AND remaining_sessions = ? AND used_sessions = ?`,
      params: [now, ctx.salonId, row.id, row.status, row.updated_at, row.remaining_sessions, row.used_sessions] },
    { sql: `INSERT INTO package_transactions (id, salon_id, client_package_id, canonical_client_id, type, sessions_delta, remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after, service_id, booking_id, cart_item_id, invoice_id, created_at, reason, created_by_uid) SELECT ?, ?, ?, ?, 'cancel', 0, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ? WHERE changes() = 1`, params: [txId, ctx.salonId, row.id, row.canonical_client_id, row.remaining_sessions, row.remaining_sessions, row.reserved_sessions, row.reserved_sessions, row.used_sessions, row.used_sessions, now, reason, cleanText(ctx.identity?.uid) || null] },
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    const committed = await matchAdministrativeReplay(ctx, row, txId, 'cancel', 0, reason);
    if (committed) return committed;
    throw new AppError(409, 'package_balance:conflict');
  }
  clearD1WalletRuntimeCaches();
  return { ok: true, clientPackageId: row.id, packageTransactionId: txId };
}

export async function restoreBookingSessionD1(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const bookingId = requiredExternalId(data.bookingId, 'bookingId');
  const ledger = await bookingSessionLedger(ctx, bookingId);
  if (!ledger.sources.length) throw new AppError(404, 'packages_redemption:not_found');
  await assertStandaloneBookingLifecycle(ctx, bookingId, ledger);
  assertSingleStandaloneTransition(
    ledger.sources.filter(source => ['reserved', 'used'].includes(
      currentSessionState(source, ledger.rows, ledger.sources).state
    )).length
  );

  const items = [];
  for (const source of ledger.sources) {
    const current = currentSessionState(source, ledger.rows, ledger.sources);
    if (!['reserved', 'used'].includes(current.state)) {
      items.push({ clientPackageId: source.client_package_id, cartItemId: source.cart_item_id || '', idempotent: true, state: current.state });
      continue;
    }
    const sourceKey = `${bookingId}:${bookingSessionKey(source)}:${cleanText(current.lastMovement.id)}`;
    const result = await applySessionTransition(
      ctx,
      source,
      current.state,
      'remaining',
      'restore',
      sourceKey,
      data.reason || 'booking_restore',
      current.lastMovement
    );
    items.push(result);
    ledger.rows.push({
      id: result.packageTransactionId,
      salon_id: ctx.salonId,
      client_package_id: source.client_package_id,
      type: 'restore',
      booking_id: bookingId,
      cart_item_id: source.cart_item_id,
      created_at: timestampNow(),
    });
  }
  clearD1WalletRuntimeCaches();
  return { ok: true, bookingId, items, idempotent: items.every((item) => item.idempotent) };
}

export async function reapplyBookingSessionD1(ctx, data) {
  requireRole(ctx.role, SALES_ROLES);
  const bookingId = requiredExternalId(data.bookingId, 'bookingId');
  const targetState = cleanText(data.targetState || data.target_state).toLowerCase();
  if (!['reserved', 'used'].includes(targetState)) {
    throw new AppError(400, 'packages_redemption:invalid_target_state');
  }
  const ledger = await bookingSessionLedger(ctx, bookingId);
  if (!ledger.sources.length) throw new AppError(404, 'packages_redemption:not_found');
  await assertStandaloneBookingLifecycle(ctx, bookingId, ledger);
  assertSingleStandaloneTransition(
    ledger.sources.filter(source => {
      const current = currentSessionState(source, ledger.rows, ledger.sources);
      return current.state === 'remaining' && cleanText(current.lastMovement?.type) === 'restore';
    }).length
  );

  const items = [];
  for (const source of ledger.sources) {
    const current = currentSessionState(source, ledger.rows, ledger.sources);
    const lastType = cleanText(current.lastMovement?.type);
    if (current.state !== 'remaining' || lastType !== 'restore') {
      items.push({ clientPackageId: source.client_package_id, cartItemId: source.cart_item_id || '', idempotent: true, state: current.state });
      continue;
    }
    const type = targetState === 'used' ? 'reapply_used' : 'reapply_reserved';
    const sourceKey = `${bookingId}:${bookingSessionKey(source)}:${cleanText(current.lastMovement.id)}`;
    const result = await applySessionTransition(
      ctx,
      source,
      'remaining',
      targetState,
      type,
      sourceKey,
      data.reason || 'refund_voided',
      current.lastMovement
    );
    items.push(result);
    ledger.rows.push({
      id: result.packageTransactionId,
      salon_id: ctx.salonId,
      client_package_id: source.client_package_id,
      type,
      booking_id: bookingId,
      cart_item_id: source.cart_item_id,
      created_at: timestampNow(),
    });
  }
  clearD1WalletRuntimeCaches();
  return { ok: true, bookingId, targetState, items, idempotent: items.every((item) => item.idempotent) };
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
    reason: row.reason || "",
    createdByUid: row.created_by_uid || "",
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
    binding: ctx?.unifiedCore ? "CORE_DB" : "PACKAGES_DB",
  };
}

export async function expireClientPackagesD1(env, salonId = cleanText(env.SALON_ID || "main")) {
  const db = env.CORE_DB || env.PACKAGES_DB;
  if (!db) throw new AppError(503, "packages_d1:not_configured");
  const now = timestampNow();
  const result = await dbRun(
    db,
    `UPDATE client_packages
        SET status = 'expired', updated_at = ?
      WHERE salon_id = ?
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at != ''
        AND expires_at < ?`,
    [now, salonId, now]
  );
  if (changes(result)) clearD1WalletRuntimeCaches();
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
