#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
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

function pick(data, fields) {
  for (const field of fields) {
    const value = data?.[field];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return "";
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

function canonicalClientId(row) {
  return clean(pick(row, ["canonicalClientId", "clientId", "id", "docId", "customerId", "authUid", "uid", "firebaseUid"])) || clean(row.id);
}

function clientAliases(row) {
  return [
    row.id,
    row.clientId,
    row.canonicalClientId,
    row.docId,
    row.customerId,
    row.uid,
    row.authUid,
    row.userId,
    row.firebaseUid,
    ...(Array.isArray(row.aliasClientIds) ? row.aliasClientIds : []),
    ...(Array.isArray(row.legacyIds) ? row.legacyIds : []),
  ].map(clean).filter(Boolean);
}

function transform(input, salonId) {
  const now = new Date().toISOString();
  const clients = new Map();
  const aliases = new Map();
  const conflicts = [];

  for (const row of [...toRows(input, "clients"), ...toRows(input, "users")]) {
    const canonical = canonicalClientId(row);
    if (!canonical) continue;
    const phone = normalizePhone(pick(row, ["phoneNormalized", "normalizedPhone", "phone", "mobile", "clientPhone", "phoneNumber"]));
    const existing = clients.get(canonical) || {};
    clients.set(canonical, {
      canonical_client_id: canonical,
      salon_id: salonId,
      name: clean(existing.name || pick(row, ["name", "displayName", "clientName"])),
      phone_normalized: clean(existing.phone_normalized || phone),
      firebase_uid: clean(existing.firebase_uid || pick(row, ["firebaseUid", "authUid", "uid", "userId"])),
      legacy_ids_json: jsonArray([...JSON.parse(existing.legacy_ids_json || "[]"), ...clientAliases(row).filter((id) => id !== canonical)]),
      created_at: clean(existing.created_at || row.createdAt || now),
      updated_at: now,
    });
    for (const alias of clientAliases(row).filter((id) => id !== canonical)) {
      const key = `${salonId}\u0000${alias}`;
      const prior = aliases.get(key);
      if (prior && prior.canonical_client_id !== canonical) {
        conflicts.push({ type: "alias_conflict", aliasId: alias, canonicalClientIds: [prior.canonical_client_id, canonical] });
        continue;
      }
      aliases.set(key, {
        salon_id: salonId,
        alias_id: alias,
        canonical_client_id: canonical,
        alias_type: "migration",
        created_at: now,
      });
    }
  }

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

  const clientPackages = toRows(input, "client_packages").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    canonical_client_id: clean(row.canonicalClientId || row.clientId),
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
  })).filter((row) => row.id && row.canonical_client_id);

  const transactions = toRows(input, "package_transactions").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    client_package_id: clean(row.clientPackageId),
    canonical_client_id: clean(row.canonicalClientId || row.clientId),
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
  })).filter((row) => row.id && row.client_package_id && row.canonical_client_id);

  return {
    rows: {
      clients: [...clients.values()],
      client_identity_aliases: [...aliases.values()],
      package_catalog: packageCatalog,
      client_packages: clientPackages,
      package_transactions: transactions,
    },
    conflicts,
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
const { rows, conflicts } = transform(source, salonId);
const counts = Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length]));

console.log("session package migration source", inputPath ? "input-file" : "firestore");
console.table(counts);
if (conflicts.length) {
  console.warn("conflicts");
  console.table(conflicts);
}

if (!apply) {
  console.log("dry-run only. Re-run with --apply to write to Cloudflare D1.");
  process.exit(0);
}

if (conflicts.length && !hasFlag("--allow-conflicts")) {
  throw new Error("Conflicts detected. Resolve them or pass --allow-conflicts after review.");
}

runWranglerD1(buildSql(rows), database, config);
console.log("migration applied idempotently with INSERT OR REPLACE.");
