#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildClientCanonicalization,
  sourceClientPackageId,
} from "./migration-client-canonicalization.mjs";

const DEFAULT_DATABASE = "queens-salon-packages";
const DEFAULT_SALON_ID = "main";

function arg(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function clean(value) {
  return String(value ?? "").trim();
}

function jsonArray(value) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = clean(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return JSON.stringify(out);
}

function sqlString(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function toRows(input, collection) {
  const aliases = {
    package_catalog: ["package_catalog", "packages_catalog"],
    package_transactions: ["package_transactions", "client_package_transactions"],
  };
  for (const key of aliases[collection] || [collection]) {
    const value = input?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).map(([id, data]) => ({ id, ...(data || {}) }));
    }
  }
  return [];
}

async function firestoreAccessToken() {
  const existing = clean(process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.FIRESTORE_ACCESS_TOKEN);
  if (existing) return existing;
  const credentialsPath = clean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!credentialsPath) {
    throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS is required when --input is not used.");
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Only service account GOOGLE_APPLICATION_CREDENTIALS JSON is supported by this migration script.");
  }
  const { SignJWT, importPKCS8 } = await import("jose");
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(credentials.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/datastore",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(credentials.client_email)
    .setSubject(credentials.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OAuth token failed: ${body.error || response.status}`);
  return body.access_token;
}

function firestoreValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, firestoreValue(child)]));
  }
  return undefined;
}

function firestoreDoc(document) {
  const id = clean(document.name).split("/").pop();
  return {
    id,
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreValue(value)])),
  };
}

async function fetchCollection(projectId, salonId, collection) {
  const token = await firestoreAccessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/salons/${salonId}/${collection}`;
  const rows = [];
  let pageToken = "";
  do {
    const url = new URL(base);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Firestore read failed for ${collection}: ${body?.error?.message || response.status}`);
    rows.push(...(body.documents || []).map(firestoreDoc));
    pageToken = clean(body.nextPageToken);
    if (pageToken) await delay(100);
  } while (pageToken);
  return rows;
}

async function readSource({ projectId, salonId, inputPath }) {
  if (inputPath) return JSON.parse(readFileSync(inputPath, "utf8"));
  return {
    clients: await fetchCollection(projectId, salonId, "clients"),
    users: await fetchCollection(projectId, salonId, "users").catch(() => []),
    package_catalog: await fetchCollection(projectId, salonId, "packages_catalog"),
    client_packages: await fetchCollection(projectId, salonId, "client_packages"),
    package_transactions: await fetchCollection(projectId, salonId, "client_package_transactions"),
  };
}

function transform(input, salonId) {
  const now = new Date().toISOString();
  const clientPackageRows = toRows(input, "client_packages");
  const transactionRows = toRows(input, "package_transactions");
  const clientIdentity = buildClientCanonicalization({
    salonId,
    now,
    asOfDate: clean(arg("--today") || process.env.MIGRATION_TODAY) || now.slice(0, 10),
    clients: toRows(input, "clients"),
    clientPackages: clientPackageRows,
  });
  const blockingConflicts = [
    ...clientIdentity.blockingConflicts,
    ...clientIdentity.validateClientPackageLinks(clientPackageRows),
  ];
  const warningConflicts = [...clientIdentity.warningConflicts];
  const clients = clientIdentity.clients.map((row) => ({
    canonical_client_id: row.canonical_client_id,
    salon_id: salonId,
    name: row.name,
    phone_normalized: row.phone_normalized,
    firebase_uid: row.firebase_uid,
    legacy_ids_json: row.legacy_ids_json,
    created_at: row.created_at,
    updated_at: now,
  }));
  const aliases = clientIdentity.aliases;
  const { resolveClientId } = clientIdentity;

  const packageCatalog = toRows(input, "package_catalog").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    name: clean(row.name),
    total_sessions: Number(row.totalSessions ?? row.sessionsCount ?? row.sessions ?? 0),
    price: Number(row.price || 0),
    allowed_service_ids_json: jsonArray(row.allowedServiceIds || row.serviceIds || row.allowedServiceIdsSnapshot),
    active: row.active === false ? 0 : 1,
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.name && row.total_sessions > 0);

  const packageCanonicalById = new Map();
  const clientPackages = clientPackageRows
    .map((row) => {
      const canonicalClientId = resolveClientId(sourceClientPackageId(row));
      if (!canonicalClientId) return null;
      const packageRow = {
        id: clean(row.id),
        salon_id: salonId,
        canonical_client_id: canonicalClientId,
        package_catalog_id: clean(row.packageCatalogId || row.catalogId || "migrated"),
        package_name_snapshot: clean(row.packageNameSnapshot || row.packageName || row.name || "Migrated package"),
        allowed_service_ids_json: jsonArray(row.allowedServiceIdsSnapshot || row.allowedServiceIds || row.serviceIds),
        total_sessions: Number(row.totalSessions || 0),
        remaining_sessions: Number(row.remainingSessions || 0),
        reserved_sessions: Number(row.reservedSessions || 0),
        used_sessions: Number(row.usedSessions || 0),
        status: clean(row.status || "active"),
        purchased_at: clean(row.purchasedAt || row.createdAt || now),
        expires_at: clean(row.expiresAt),
        invoice_id: clean(row.invoiceId || row.invoiceDocumentId),
        created_at: clean(row.createdAt || now),
        updated_at: now,
      };
      if (packageRow.id) packageCanonicalById.set(packageRow.id, canonicalClientId);
      return packageRow;
    })
    .filter((row) => row && row.id && row.canonical_client_id);

  const transactions = transactionRows
    .map((row) => {
      const clientPackageId = clean(row.clientPackageId);
      const packageCanonicalId = packageCanonicalById.get(clientPackageId) || "";
      const rawClientId = clean(row.canonicalClientId || row.clientId || packageCanonicalId);
      const canonicalClientId = resolveClientId(rawClientId) || packageCanonicalId;
      if (!canonicalClientId) {
        blockingConflicts.push({
          type: "package_transaction_unresolved_client",
          transactionId: clean(row.id),
          clientPackageId,
          sourceClientId: rawClientId,
        });
        return null;
      }
      if (packageCanonicalId && canonicalClientId !== packageCanonicalId) {
        blockingConflicts.push({
          type: "package_transaction_client_mismatch",
          transactionId: clean(row.id),
          clientPackageId,
          transactionCanonicalClientId: canonicalClientId,
          packageCanonicalClientId: packageCanonicalId,
        });
        return null;
      }
      return {
        id: clean(row.id),
        salon_id: salonId,
        client_package_id: clientPackageId,
        canonical_client_id: canonicalClientId,
        type: clean(row.type || "migration"),
        sessions_delta: Number(row.sessionsDelta || 0),
        remaining_before: Number(row.remainingBefore || 0),
        remaining_after: Number(row.remainingAfter || 0),
        reserved_before: Number(row.reservedBefore || 0),
        reserved_after: Number(row.reservedAfter || 0),
        used_before: Number(row.usedBefore || 0),
        used_after: Number(row.usedAfter || 0),
        service_id: clean(row.serviceId),
        booking_id: clean(row.bookingId),
        cart_item_id: clean(row.cartItemId),
        invoice_id: clean(row.invoiceId),
        created_at: clean(row.createdAt || now),
      };
    })
    .filter((row) => row && row.id && row.client_package_id && row.canonical_client_id);

  return {
    rows: {
      clients,
      client_identity_aliases: aliases,
      package_catalog: packageCatalog,
      client_packages: clientPackages,
      package_transactions: transactions,
    },
    blockingConflicts,
    warningConflicts,
    report: clientIdentity.report,
  };
}

function insertSql(table, row) {
  const columns = Object.keys(row);
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => {
    const value = row[column];
    return typeof value === "number" ? sqlNumber(value) : sqlString(value);
  }).join(", ")});`;
}

function buildSql(rowsByTable) {
  // Wrangler D1 remote execution rejects explicit SQL BEGIN/COMMIT statements.
  // Each statement is idempotent, so the import can be safely retried if interrupted.
  const statements = [];
  for (const table of ["package_catalog", "clients", "client_identity_aliases", "client_packages", "package_transactions"]) {
    for (const row of rowsByTable[table] || []) statements.push(insertSql(table, row));
  }
  return statements.join("\n");
}

function runWranglerD1(sql, database, config) {
  const directory = mkdtempSync(join(tmpdir(), "queens-packages-migration-"));
  const sqlPath = join(directory, "migration.sql");
  try {
    writeFileSync(sqlPath, sql, "utf8");
    const result = spawnSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        database,
        "--remote",
        "--file",
        sqlPath,
        "--config",
        config,
      ],
      {
        stdio: "inherit",
        shell: process.platform === "win32",
      }
    );
    if (result.status !== 0) {
      const detail = result.error?.message || result.signal || `exit code ${result.status}`;
      throw new Error(`wrangler d1 execute failed: ${detail}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const apply = hasFlag("--apply");
const inputPath = arg("--input");
const projectId = clean(arg("--project") || process.env.FIREBASE_PROJECT_ID || "waves-hotel-dashboard");
const salonId = clean(arg("--salon") || process.env.SALON_ID || DEFAULT_SALON_ID);
const database = clean(arg("--database") || process.env.PACKAGES_D1_DATABASE || DEFAULT_DATABASE);
const config = clean(arg("--config") || process.env.PACKAGES_WRANGLER_CONFIG || "wrangler.packages.jsonc");

const source = await readSource({ projectId, salonId, inputPath });
const { rows, blockingConflicts, warningConflicts, report } = transform(source, salonId);
const counts = Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length]));

console.log("session package migration source", inputPath ? "input-file" : "firestore");
console.table(counts);
console.log(`blockingConflicts = ${blockingConflicts.length}`);
if (blockingConflicts.length) {
  console.log("blocking conflicts");
  console.table(blockingConflicts);
}
console.log(`warningConflicts = ${warningConflicts.length}`);
if (warningConflicts.length) {
  console.log("warning conflicts");
  console.table(warningConflicts);
}
console.log(`mergedClients = ${report.mergedClients}`);
if (report.clientCanonicalMappings.length) {
  console.log("client canonicalization oldClientId -> canonicalClientId");
  console.table(report.clientCanonicalMappings);
}
if (report.packageCanonicalMappings.length) {
  console.log("package canonicalization clientPackageId -> canonicalClientId");
  console.table(report.packageCanonicalMappings);
}

if (!apply) {
  console.log("dry-run only. Re-run with --apply to write to Cloudflare D1.");
  process.exit(0);
}

if (blockingConflicts.length && !hasFlag("--allow-conflicts")) {
  throw new Error("Blocking conflicts detected. Resolve them or pass --allow-conflicts after review.");
}

runWranglerD1(buildSql(rows), database, config);
console.log("migration applied idempotently with INSERT OR REPLACE.");
