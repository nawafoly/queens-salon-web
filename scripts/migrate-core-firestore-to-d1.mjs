#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildClientCanonicalization } from "./migration-client-canonicalization.mjs";

const DEFAULT_DATABASE = "queens-salon-core";
const DEFAULT_SALON_ID = "main";
const MAX_SQL_STATEMENT_BYTES = 250000;
const DAY_TO_WEEKDAY = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

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

function normalizeTime(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(clean(value));
  if (!match) return "";
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function addMinutes(time, minutes) {
  const normalized = normalizeTime(time);
  if (!normalized) return "";
  const [hours, mins] = normalized.split(":").map(Number);
  const total = Math.min(24 * 60 - 1, hours * 60 + mins + Math.max(0, Number(minutes || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function occupiedSlots(startTime, endTime, stepMin, bufferMin) {
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  if (!start || !end) return [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const from = sh * 60 + sm;
  const until = Math.min(24 * 60, eh * 60 + em + Math.max(0, Number(bufferMin || 0)));
  if (until <= from) return [];
  const step = Math.max(5, Number(stepMin || 10));
  const out = [];
  for (let minute = from; minute < until; minute += step) {
    out.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return out;
}

function rows(input, ...names) {
  for (const name of names) {
    const value = input?.[name];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).map(([id, data]) => ({ id, ...(data || {}) }));
    }
  }
  return [];
}

function pick(data, names, fallback = "") {
  for (const name of names) {
    const value = data?.[name];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function halalasFromRiyals(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : fallback;
}

function moneyHalalas(source, halalaKeys = [], riyalKeys = [], fallback = 0) {
  for (const key of halalaKeys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  for (const key of riyalKeys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === "") continue;
    return halalasFromRiyals(value, fallback);
  }
  return fallback;
}

function stableId(prefix, value) {
  const hash = createHash("sha1").update(clean(value) || prefix).digest("hex").slice(0, 18);
  return `${prefix}_${hash}`;
}

function sqlValue(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insert(table, row) {
  const columns = Object.keys(row);
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns
    .map((key) => sqlValue(row[key]))
    .join(", ")});`;
}

async function firestoreAccessToken() {
  const existing = clean(
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.FIRESTORE_ACCESS_TOKEN
  );
  if (existing) return existing;

  const credentialsPath = clean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!credentialsPath) {
    throw new Error(
      "GOOGLE_OAUTH_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS is required when --input is not used."
    );
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "Only service account GOOGLE_APPLICATION_CREDENTIALS JSON is supported by this migration script."
    );
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
  if (!response.ok) {
    throw new Error(`OAuth token failed: ${body.error || response.status}`);
  }
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
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [
        key,
        firestoreValue(child),
      ])
    );
  }
  return undefined;
}

function firestoreDoc(document) {
  const id = clean(document.name).split("/").pop();
  return {
    id,
    ...Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [
        key,
        firestoreValue(value),
      ])
    ),
  };
}

async function fetchCollection(projectId, salonId, collection, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/salons/${salonId}/${collection}`;
  const out = [];
  let pageToken = "";
  do {
    const url = new URL(base);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Source read failed for ${collection}: ${body?.error?.message || response.status}`
      );
    }
    out.push(...(body.documents || []).map(firestoreDoc));
    pageToken = clean(body.nextPageToken);
    if (pageToken) await delay(100);
  } while (pageToken);
  return out;
}

async function readSourceFromFirestore(projectId, salonId) {
  const token = await firestoreAccessToken();
  const collections = [
    "clients",
    "services",
    "service_categories",
    "service_sections",
    "staff_public",
    "employees",
    "users",
    "admin_users",
    "bookings",
    "invoices",
    "payments",
    "income",
    "expenses",
    "discounts",
    "offers",
    "refunds",
    "audit_logs",
    "attendance_records",
    "attendance",
    "employee_leave_requests",
    "employee_absences",
    "employee_payroll_records",
    "work_schedules",
    "settings",
    "employee_files",
    "notifications",
    "client_packages",
    "client_package_transactions",
  ];
  const entries = await Promise.all(
    collections.map(async (collection) => [
      collection,
      await fetchCollection(projectId, salonId, collection, token),
    ])
  );
  return Object.fromEntries(entries);
}

function mergeRowsById(...collections) {
  const out = new Map();
  for (const collection of collections) {
    for (const row of collection) {
      const id = clean(row.id);
      if (!id) continue;
      const existing = out.get(id) || {};
      const next = { ...existing };
      for (const [key, value] of Object.entries(row)) {
        if (value !== undefined && value !== null && clean(value) !== "") {
          next[key] = value;
        }
      }
      next.id = id;
      out.set(id, next);
    }
  }
  return [...out.values()];
}

function scheduleWindows(dayConfig) {
  if (!dayConfig || typeof dayConfig !== "object" || dayConfig.enabled === false) return [];
  for (const key of ["shifts", "windows", "periods"]) {
    const value = dayConfig[key];
    if (Array.isArray(value) && value.length) {
      return value
        .filter((row) => row?.enabled !== false)
        .map((row) => ({
          start: normalizeTime(row?.start),
          end: normalizeTime(row?.end),
        }))
        .filter((row) => row.start && row.end && row.start < row.end);
    }
  }
  const start = normalizeTime(dayConfig.start);
  const end = normalizeTime(dayConfig.end);
  return start && end && start < end ? [{ start, end }] : [];
}

function bookingItemSources(row) {
  if (Array.isArray(row.items) && row.items.length) return row.items;
  const packageServices = row?.packageSnapshot?.services;
  if (Array.isArray(packageServices) && packageServices.length) return packageServices;
  return [row];
}

function migrationToday() {
  const explicit = clean(arg("--today") || process.env.MIGRATION_TODAY);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sortText(a, b) {
  return clean(a).localeCompare(clean(b), "en", { sensitivity: "base" });
}

function sourceDate(row) {
  return clean(row.updatedAt || row.updated_at || row.createdAt || row.created_at);
}

function newestFirst(a, b) {
  const aDate = sourceDate(a);
  const bDate = sourceDate(b);
  if (aDate !== bDate) return bDate.localeCompare(aDate);
  return sortText(a.id, b.id);
}

function uniqueClean(values) {
  const seen = new Set();
  const out = [];
  for (const value of values.flat()) {
    const text = clean(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

const LOCK_INACTIVE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "no_show",
  "no-show",
  "noshow",
  "rejected",
]);

function shouldCreateSlotLocks(status) {
  return !LOCK_INACTIVE_STATUSES.has(clean(status || "booked").toLowerCase());
}

function firstBookingClientId(row) {
  return clean(row.clientId || row.client_id || row.canonicalClientId || row.canonical_client_id);
}

function bookingTrustedPhone(row) {
  return normalizePhone(row.phoneNormalized || row.phone_normalized || row.normalizedPhone);
}

function bookingPrimaryPhone(row) {
  return normalizePhone(row.clientPhone || row.phone || row.mobile || row.phoneNumber);
}

function bookingClientName(row) {
  return clean(row.clientName || row.name || row.customerName || "Legacy booking client");
}

function bookingClientEmail(row) {
  return clean(row.clientEmail || row.email || row.customerEmail);
}

function createBookingClientResolver({
  salonId,
  now,
  clientMap,
  coreClients,
  clientAliases,
  report,
  blockingConflicts,
}) {
  const aliasMap = new Map();
  const phoneOwners = new Map();
  const canonicalMappings = new Map(
    (report.clientCanonicalMappings || []).map((row) => [clean(row.oldClientId), clean(row.canonicalClientId)])
  );

  for (const alias of clientAliases) {
    const aliasId = clean(alias.alias_id);
    const canonicalId = clean(alias.canonical_client_id);
    if (!aliasId || !canonicalId) continue;
    aliasMap.set(aliasId, canonicalId);
  }

  const rebuildPhoneOwners = () => {
    phoneOwners.clear();
    for (const client of coreClients) {
      const phone = clean(client.phone_normalized);
      if (!phone) continue;
      const owners = phoneOwners.get(phone) || new Set();
      owners.add(client.id);
      phoneOwners.set(phone, owners);
    }
  };
  rebuildPhoneOwners();

  const addAliasIfUnowned = (aliasId, canonicalId, type) => {
    const value = clean(aliasId);
    if (!value || value === canonicalId) return false;
    const existing = aliasMap.get(value);
    if (existing) return existing === canonicalId;
    aliasMap.set(value, canonicalId);
    clientAliases.push({
      salon_id: salonId,
      alias_id: value,
      canonical_client_id: canonicalId,
      alias_type: type,
      created_at: now,
    });
    return true;
  };

  const resolveKnown = (value) => {
    const id = clean(value);
    if (!id) return "";
    if (clientMap.has(id)) return id;
    const mapped = canonicalMappings.get(id);
    if (mapped && clientMap.has(mapped)) return mapped;
    const alias = aliasMap.get(id);
    if (alias && clientMap.has(alias)) return alias;
    return "";
  };

  const resolveUniquePhone = (phone) => {
    const normalized = clean(phone);
    if (!normalized) return "";
    const owners = phoneOwners.get(normalized);
    if (!owners || owners.size !== 1) return "";
    const [owner] = [...owners];
    return clientMap.has(owner) ? owner : "";
  };

  const createLegacyClient = (row, sourceClientId, phone) => {
    const bookingId = clean(row.id);
    const legacyClientId = `legacy_booking_client_${bookingId}`;
    if (!clientMap.has(legacyClientId)) {
      const client = {
        id: legacyClientId,
        salon_id: salonId,
        name: bookingClientName(row),
        phone_normalized: phone,
        email: bookingClientEmail(row),
        firebase_uid: "",
        status: "active",
        notes: [
          "Created during Core D1 migration because booking client could not be resolved deterministically.",
          sourceClientId ? `Original booking client field: ${sourceClientId}` : "",
        ].filter(Boolean).join(" "),
        vip: 0,
        legacy_client_doc_id: "",
        created_at: clean(row.createdAt || now),
        updated_at: now,
      };
      clientMap.set(legacyClientId, client);
      coreClients.push(client);
      if (sourceClientId) addAliasIfUnowned(sourceClientId, legacyClientId, "legacy_booking_client_id");
      if (phone) {
        const owners = phoneOwners.get(phone);
        if (!owners || owners.size === 0) addAliasIfUnowned(phone, legacyClientId, "booking_phone");
      }
      rebuildPhoneOwners();
    }
    report.bookingLegacyClientsCreated += 1;
    report.bookingLegacyClientRows.push({
      bookingId,
      originalClientField: sourceClientId,
      legacyClientId,
      phone,
    });
    return legacyClientId;
  };

  return (row) => {
    const bookingId = clean(row.id);
    const sourceClientId = firstBookingClientId(row);
    if (sourceClientId) {
      if (clientMap.has(sourceClientId)) {
        report.bookingClientsResolvedDirect += 1;
        return sourceClientId;
      }
      const canonical = canonicalMappings.get(sourceClientId);
      if (canonical && clientMap.has(canonical)) {
        report.bookingClientsResolvedCanonical += 1;
        return canonical;
      }
      const alias = aliasMap.get(sourceClientId);
      if (alias && clientMap.has(alias)) {
        report.bookingClientsResolvedByAlias += 1;
        return alias;
      }
    }

    const trustedPhone = bookingTrustedPhone(row);
    const trustedPhoneClient = resolveUniquePhone(trustedPhone);
    if (trustedPhoneClient) {
      report.bookingClientsResolvedByPhone += 1;
      return trustedPhoneClient;
    }

    const primaryPhone = bookingPrimaryPhone(row);
    const primaryPhoneClient = resolveUniquePhone(primaryPhone);
    if (primaryPhoneClient) {
      report.bookingClientsResolvedByPhone += 1;
      return primaryPhoneClient;
    }

    const phoneForLegacy = trustedPhone || primaryPhone;
    if (bookingId) return createLegacyClient(row, sourceClientId, phoneForLegacy);

    report.bookingClientsUnresolved += 1;
    blockingConflicts.push({
      type: "booking_client_unresolved",
      bookingId,
      originalClientField: sourceClientId,
      phone: phoneForLegacy,
    });
    return "";
  };
}

function buildBookingSlotLocks(candidates, warningConflicts) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.salon_id}\u0000${candidate.staff_id}\u0000${candidate.booking_date}\u0000${candidate.slot_time}`;
    const group = grouped.get(key) || [];
    group.push(candidate);
    grouped.set(key, group);
  }

  const locks = [];
  for (const group of [...grouped.values()]) {
    group.sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
      if (a.booking_id !== b.booking_id) return sortText(a.booking_id, b.booking_id);
      return sortText(a.booking_item_id, b.booking_item_id);
    });
    const winner = group[0];
    const bookingIds = uniqueClean(group.map((candidate) => candidate.booking_id));
    if (bookingIds.length > 1) {
      warningConflicts.push({
        type: "booking_slot_conflict",
        staffId: winner.staff_id,
        date: winner.booking_date,
        slotTime: winner.slot_time,
        bookingIds,
        chosenBookingId: winner.booking_id,
      });
    }
    locks.push({
      salon_id: winner.salon_id,
      staff_id: winner.staff_id,
      booking_date: winner.booking_date,
      slot_time: winner.slot_time,
      booking_id: winner.booking_id,
      booking_item_id: winner.booking_item_id,
      created_at: winner.created_at,
    });
  }
  return locks.sort((a, b) => {
    const aKey = `${a.staff_id}\u0000${a.booking_date}\u0000${a.slot_time}\u0000${a.booking_id}`;
    const bKey = `${b.staff_id}\u0000${b.booking_date}\u0000${b.slot_time}\u0000${b.booking_id}`;
    return sortText(aKey, bKey);
  });
}

function legacyDiscountCode(code, id, usedCodes) {
  const base = clean(code || "DISCOUNT").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "DISCOUNT";
  const suffix =
    clean(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) ||
    stableId("discount", id).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  let candidate = `${base}_LEGACY_${suffix}`;
  if (candidate.length > 64) candidate = candidate.slice(0, 64);
  let counter = 2;
  while (usedCodes.has(candidate)) {
    const hash = createHash("sha1").update(`${code}:${id}:${counter}`).digest("hex").slice(0, 8).toUpperCase();
    candidate = `${base}_LEGACY_${hash}`;
    counter += 1;
  }
  usedCodes.add(candidate);
  return candidate;
}

function resolveDiscountCodeConflicts(discounts, warningConflicts) {
  const groups = new Map();
  for (const discount of discounts) {
    const key = clean(discount.code_key || discount.code).toUpperCase();
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(discount);
    groups.set(key, group);
  }

  const usedCodes = new Set(
    [...groups.entries()]
      .filter(([, group]) => group.length === 1)
      .map(([code]) => code)
  );
  const decisions = [];

  for (const [code, group] of [...groups.entries()].sort(([a], [b]) => sortText(a, b))) {
    if (group.length === 1) {
      group[0].code = clean(group[0].code || code).toUpperCase();
      group[0].code_key = code;
      continue;
    }
    group.sort((a, b) => {
      const activeDelta = (b.active ? 1 : 0) - (a.active ? 1 : 0);
      if (activeDelta) return activeDelta;
      return newestFirst(a, b);
    });
    const canonical = group[0];
    canonical.code = code;
    canonical.code_key = code;
    usedCodes.add(code);
    for (const duplicate of group.slice(1)) {
      const legacyCode = legacyDiscountCode(code, duplicate.id, usedCodes);
      duplicate.code = legacyCode;
      duplicate.code_key = legacyCode;
      duplicate.active = 0;
      const decision = {
        code,
        canonicalDiscountId: canonical.id,
        legacyDiscountId: duplicate.id,
        legacyCode,
        reason: code === "QS953" ? "QS953 duplicate resolved: active row preferred, then newest, then id" : "duplicate discount code resolved",
      };
      decisions.push(decision);
      warningConflicts.push({
        type: "discount_code_resolved",
        ...decision,
      });
    }
  }

  return decisions;
}

function transform(input, salonId, options = {}) {
  const now = new Date().toISOString();
  const today = options.today || migrationToday();
  const blockingConflicts = [];
  const warningConflicts = [];
  const report = {
    asOfDate: today,
    slotLocksGeneratedActiveFuture: 0,
    slotLocksSkippedPast: 0,
    slotLocksSkippedTerminalStatus: 0,
    slotLocksSkippedInvalid: 0,
    slotLockItemsProcessed: 0,
    bookingClientsResolvedDirect: 0,
    bookingClientsResolvedCanonical: 0,
    bookingClientsResolvedByAlias: 0,
    bookingClientsResolvedByPhone: 0,
    bookingLegacyClientsCreated: 0,
    bookingClientsUnresolved: 0,
    bookingLegacyClientRows: [],
    mergedClients: 0,
    mergedClientGroups: 0,
    clientCanonicalMappings: [],
    discountDecisions: [],
  };

  const clientPackageRows = rows(input, "client_packages");
  const clientIdentity = buildClientCanonicalization({
    salonId,
    now,
    asOfDate: today,
    clients: rows(input, "clients"),
    clientPackages: clientPackageRows,
  });
  const { clientMap, resolveClientId } = clientIdentity;
  const clientAliases = clientIdentity.aliases;
  blockingConflicts.push(...clientIdentity.blockingConflicts);
  blockingConflicts.push(...clientIdentity.validateClientPackageLinks(clientPackageRows));
  warningConflicts.push(...clientIdentity.warningConflicts);
  Object.assign(report, clientIdentity.report);
  const coreClients = [...clientMap.values()].map((client) => ({
    id: client.id,
    salon_id: client.salon_id,
    name: client.name,
    phone_normalized: client.phone_normalized,
    email: client.email,
    firebase_uid: client.firebase_uid,
    status: client.status,
    notes: client.notes,
    vip: client.vip,
    legacy_client_doc_id: client.legacy_client_doc_id,
    created_at: client.created_at,
    updated_at: client.updated_at,
  }));

  const categories = rows(input, "service_categories", "categories")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      name: clean(row.name || row.title || "Category"),
      section_id: clean(row.sectionId || row.section_id),
      active: row.active === false ? 0 : 1,
      sort_order: number(row.sortOrder || row.order, 0),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    }))
    .filter((row) => row.id && row.name);

  const sections = rows(input, "service_sections", "sections")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      name: clean(row.name || row.title || row["الاسم"] || "Section"),
      active: row.active === false ? 0 : 1,
      sort_order: number(row.sortOrder || row.order, 0),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    }))
    .filter((row) => row.id && row.name);

  const serviceMap = new Map();
  for (const row of rows(input, "services")) {
    const id = clean(row.id);
    if (!id) continue;
    serviceMap.set(id, {
      id,
      salon_id: salonId,
      name: clean(row.name || row.title || row["الاسم"] || "Service"),
      section_id: clean(row.sectionId || row.section_id),
      category_id: clean(row.categoryId || row.category_id),
      description: clean(row.description),
      duration_minutes: Math.max(
        1,
        number(row.durationMin ?? row.durationMinutes ?? row.duration_minutes ?? row["المدة"], 30)
      ),
      price_halalas: moneyHalalas(row, ["priceHalalas", "price_halalas"], ["price", "السعر"], 0),
      active: row.active === false ? 0 : 1,
      image_url: clean(row.imageUrl || row.image_url),
      sort_order: number(row.sortOrder || row.order, 0),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    });
  }

  const staffSources = mergeRowsById(
    rows(input, "employees"),
    rows(input, "staff_public")
  );
  const staffMap = new Map();
  const staffServices = [];
  const staffSchedules = [];

  for (const row of staffSources) {
    const id = clean(row.id);
    if (!id) continue;
    const specialties = Array.from(
      new Set(
        [
          ...(Array.isArray(row.specialties) ? row.specialties : []),
          ...(Array.isArray(row.serviceIds) ? row.serviceIds : []),
          ...(Array.isArray(row.servicesIds) ? row.servicesIds : []),
        ]
          .map(clean)
          .filter(Boolean)
      )
    );
    staffMap.set(id, {
      id,
      salon_id: salonId,
      firebase_uid: clean(row.firebaseUid || row.authUid || row.uid || row.linkedUid),
      name: clean(row.name || row.displayName || "Staff"),
      phone_normalized: normalizePhone(row.phone || row.mobile),
      active:
        row.active === false || row.isActive === false || row.archived === true ? 0 : 1,
      employment_status: clean(row.employmentStatus || "active"),
      avatar_url: clean(
        row.avatarUrl || row.avatarURL || row.photoURL || row.imageUrl
      ),
      show_on_booking: row.showOnBooking === false ? 0 : 1,
      specialties_json: JSON.stringify(specialties),
      leave_start_date: clean(
        row.leaveStartDate || row.onLeaveSince || (row.onLeave ? "0001-01-01" : "")
      ),
      leave_end_date: clean(row.leaveUntil || row.leaveEndDate),
      leave_note: clean(row.leaveNote),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    });

    for (const serviceId of specialties) {
      if (!serviceMap.has(serviceId)) continue;
      staffServices.push({
        salon_id: salonId,
        staff_id: id,
        service_id: serviceId,
        active: 1,
      });
    }

    const custom = row.customWorkingHours;
    if (custom && typeof custom === "object") {
      for (const [dayKey, weekday] of Object.entries(DAY_TO_WEEKDAY)) {
        const windows = scheduleWindows(custom[dayKey]);
        windows.forEach((window, index) => {
          staffSchedules.push({
            id: `schedule_${id}_${weekday}_${index}`,
            salon_id: salonId,
            staff_id: id,
            weekday,
            start_time: window.start,
            end_time: window.end,
            active: 1,
            created_at: now,
            updated_at: now,
          });
        });
      }
    }
  }

  const bookings = [];
  const bookingItems = [];
  const bookingLockCandidates = [];
  const resolveBookingClientId = createBookingClientResolver({
    salonId,
    now,
    clientMap,
    coreClients,
    clientAliases,
    report,
    blockingConflicts,
  });

  for (const row of rows(input, "bookings")) {
    const bookingId = clean(row.id);
    if (!bookingId) continue;
    const clientId = resolveBookingClientId(row);

    const parentDate = clean(row.date || row.bookingDate || row.booking_date);
    const parentStart = normalizeTime(row.time || row.startTime || row.start_time);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parentDate) || !parentStart) {
      blockingConflicts.push({ type: "booking_missing_schedule", bookingId });
      continue;
    }
    const slotStepMin = Math.max(5, number(row.slotStepMinAtBooking || row.slotStepMin, 10));
    const bufferMin = Math.max(0, number(row.bufferMinAtBooking || row.bufferMin, 0));
    const itemSources = bookingItemSources(row);
    const transformedItems = [];
    let cursorDate = parentDate;
    let cursorTime = parentStart;
    const status = clean(row.status || "booked").toLowerCase();

    itemSources.forEach((item, index) => {
      const serviceName = clean(
        item.serviceName || item.name || row.serviceName || "Legacy service"
      );
      let serviceId = clean(item.serviceId || row.serviceId);
      if (!serviceId) serviceId = stableId("legacy_service", serviceName || bookingId);
      if (!serviceMap.has(serviceId)) {
        serviceMap.set(serviceId, {
          id: serviceId,
          salon_id: salonId,
          name: serviceName || "Legacy service",
          section_id: clean(item.sectionId || row.serviceSnapshot?.sectionIdAtBooking),
          category_id: clean(item.categoryId || row.serviceSnapshot?.categoryIdAtBooking),
          description: "Created during Core D1 migration from booking history",
          duration_minutes: Math.max(
            1,
            number(
              item.durationMin ||
                item.durationMinutes ||
                row.durationMin ||
                row.serviceSnapshot?.durationAtBooking,
              30
            )
          ),
          price_halalas: moneyHalalas(
            item,
            ["priceHalalas", "price_halalas", "unitPriceHalalas", "unit_price_halalas"],
            ["price", "finalPrice"],
            moneyHalalas(row, ["totalHalalas", "total_halalas"], ["finalPrice", "total"], 0)
          ),
          active: 0,
          image_url: "",
          sort_order: 9999,
          created_at: clean(row.createdAt || now),
          updated_at: now,
        });
      }
      const service = serviceMap.get(serviceId);
      const itemDate = clean(item.date || item.bookingDate || cursorDate || parentDate);
      const itemStart = normalizeTime(
        item.time || item.startTime || (itemDate === cursorDate ? cursorTime : parentStart)
      );
      const duration = Math.max(
        1,
        number(item.durationMin || item.durationMinutes || service.duration_minutes, 30)
      );
      const itemEnd = normalizeTime(item.endTime) || addMinutes(itemStart, duration);
      const staffId = clean(
        item.staffId || item.employeeId || row.staffId || row.employeeId || row.staff_id
      );
      if (staffId && !staffMap.has(staffId)) {
        staffMap.set(staffId, {
          id: staffId,
          salon_id: salonId,
          firebase_uid: clean(item.employeeUid || row.employeeUid),
          name: clean(item.employeeName || row.employeeName || "Legacy staff"),
          phone_normalized: "",
          active: 0,
          employment_status: "unknown",
          avatar_url: "",
          show_on_booking: 0,
          specialties_json: JSON.stringify([serviceId]),
          leave_start_date: "",
          leave_end_date: "",
          leave_note: "",
          created_at: clean(row.createdAt || now),
          updated_at: now,
        });
      }
      const itemId = clean(item.id) || `${bookingId}_item_${index}`;
      const price = moneyHalalas(
        item,
        ["priceHalalas", "price_halalas", "unitPriceHalalas", "unit_price_halalas", "totalHalalas", "total_halalas"],
        ["price", "finalPrice", "total"],
        moneyHalalas(row, ["totalHalalas", "total_halalas"], ["finalPrice", "total"], service.price_halalas)
      );
      const bookingItem = {
        id: itemId,
        booking_id: bookingId,
        salon_id: salonId,
        service_id: serviceId,
        service_name_snapshot: serviceName || service.name,
        staff_id: staffId,
        quantity: Math.max(1, number(item.quantity, 1)),
        unit_price_halalas: price,
        total_halalas: price,
        package_covered:
          item.packageCovered || item.consumeOneSession || row.fromSessionPackage || row.consumeOneSession ? 1 : 0,
        client_package_id: clean(item.clientPackageId || row.sessionPackageId),
        duration_minutes: duration,
        created_at: clean(row.createdAt || now),
        booking_date: itemDate,
        start_time: itemStart,
        end_time: itemEnd,
        cart_item_id: clean(item.cartItemId) || `item_${index}`,
        package_reservation_id: clean(
          item.packageReservationId || item.packageTransactionId || row.packageTransactionId
        ),
      };
      transformedItems.push(bookingItem);
      bookingItems.push(bookingItem);

      report.slotLockItemsProcessed += 1;
      // Use the same fixed five-minute lock granularity as the Core Worker.
      // Historical UI slot steps are preserved on the booking row but must
      // not weaken overlap protection in booking_slot_locks.
      const slotTimes = occupiedSlots(itemStart, itemEnd, 5, bufferMin);
      if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(itemDate) || !itemStart || !itemEnd || !slotTimes.length) {
        report.slotLocksSkippedInvalid += 1;
      } else if (!shouldCreateSlotLocks(status)) {
        report.slotLocksSkippedTerminalStatus += slotTimes.length;
      } else if (itemDate < today) {
        report.slotLocksSkippedPast += slotTimes.length;
      } else {
        for (const slotTime of slotTimes) {
          bookingLockCandidates.push({
            salon_id: salonId,
            staff_id: staffId,
            booking_date: itemDate,
            slot_time: slotTime,
            booking_id: bookingId,
            booking_item_id: itemId,
            created_at: clean(row.createdAt || now),
          });
        }
      }
      cursorDate = itemDate;
      cursorTime = itemEnd;
    });

    if (!transformedItems.length) {
      blockingConflicts.push({ type: "booking_without_items", bookingId });
      continue;
    }
    const subtotal = transformedItems.reduce(
      (sum, item) => sum + Number(item.total_halalas || 0),
      0
    );
    const first = transformedItems[0];
    const uniqueStaff = Array.from(
      new Set(transformedItems.map((item) => item.staff_id).filter(Boolean))
    );
    bookings.push({
      id: bookingId,
      public_id: clean(row.publicId || row.trackPublicId || row.mk || bookingId),
      salon_id: salonId,
      client_id: clientId,
      staff_id: uniqueStaff.length === 1 ? uniqueStaff[0] : "",
      booking_date: first.booking_date,
      start_time: first.start_time,
      end_time: normalizeTime(row.endTime || row.end_time) || first.end_time,
      status: clean(row.status || "booked"),
      source: clean(row.channel || row.source || "migration"),
      notes: clean(row.note || row.notes),
      subtotal_halalas: moneyHalalas(row, ["subtotalHalalas", "subtotal_halalas"], ["subtotal"], subtotal),
      discount_halalas: moneyHalalas(row, ["discountHalalas", "discount_halalas"], ["discountAmount", "discount"], 0),
      total_halalas: moneyHalalas(row, ["totalHalalas", "total_halalas"], ["finalPrice", "total"], subtotal),
      payment_status: clean(
        row.paymentStatus ||
          (row.paymentType === "full" ? "paid" : row.paymentType === "partial" ? "partial" : "unpaid")
      ),
      package_sessions_used: number(
        row.packageSessionsUsed ?? (row.consumeOneSession || row.fromSessionPackage ? 1 : 0),
        0
      ),
      created_by_uid: clean(row.createdByUid || row.createdBy),
      created_at: clean(row.createdAt || now),
      updated_at: clean(row.updatedAt || now),
      cancelled_at: clean(row.cancelledAt),
      completed_at: clean(row.completedAt),
      slot_step_min: slotStepMin,
      buffer_min: bufferMin,
    });
  }

  const bookingClientIds = new Set(coreClients.map((client) => client.id).filter(Boolean));
  for (const booking of bookings) {
    if (booking.client_id && bookingClientIds.has(booking.client_id)) continue;
    report.bookingClientsUnresolved += 1;
    blockingConflicts.push({
      type: "booking_client_unresolved",
      bookingId: booking.id,
      clientId: booking.client_id,
      reason: booking.client_id ? "client_id_not_found_in_clients" : "empty_client_id",
    });
  }

  const bookingSlotLocks = buildBookingSlotLocks(bookingLockCandidates, warningConflicts);
  report.slotLocksGeneratedActiveFuture = bookingSlotLocks.length;

  const invoices = rows(input, "invoices")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      booking_id: clean(row.bookingId),
      client_id: resolveClientId(row.clientId),
      invoice_number: clean(row.invoiceNumber || row.number),
      subtotal_halalas: moneyHalalas(row, ["subtotalHalalas", "subtotal_halalas"], ["subtotal"], 0),
      discount_halalas: moneyHalalas(row, ["discountHalalas", "discount_halalas"], ["discount"], 0),
      total_halalas: moneyHalalas(row, ["totalHalalas", "total_halalas"], ["total"], 0),
      paid_halalas: moneyHalalas(row, ["paidHalalas", "paid_halalas"], ["paid"], 0),
      status: clean(row.status || "unpaid"),
      issued_at: clean(row.issuedAt || row.createdAt || now),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    }))
    .filter((row) => row.id && row.client_id);

  const payments = rows(input, "payments")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      invoice_id: clean(row.invoiceId),
      booking_id: clean(row.bookingId),
      client_id: resolveClientId(row.clientId),
      method: clean(row.method || row.paymentMethod || "cash"),
      amount_halalas: moneyHalalas(row, ["amountHalalas", "amount_halalas"], ["amount"], 0),
      status: clean(row.status || "paid"),
      provider: clean(row.provider),
      provider_reference: clean(row.providerReference),
      idempotency_key: clean(row.idempotencyKey || row.id),
      paid_at: clean(row.paidAt || row.createdAt || now),
      created_at: clean(row.createdAt || now),
    }))
    .filter((row) => row.id && row.amount_halalas > 0);

  const income = rows(input, "income", "income_entries")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      booking_id: clean(row.bookingId),
      invoice_id: clean(row.invoiceId),
      payment_id: clean(row.paymentId),
      amount_halalas: moneyHalalas(row, ["amountHalalas", "amount_halalas"], ["amount"], 0),
      category: clean(row.category),
      description: clean(row.description || row.note),
      method: clean(row.method || row.paymentMethod),
      payment_breakdown_json: JSON.stringify(row.paymentBreakdown || {}),
      source: clean(row.source),
      note: clean(row.note),
      client_name: clean(row.clientName),
      client_phone: normalizePhone(row.clientPhone),
      occurred_at: clean(row.occurredAt || row.date || row.createdAt || now),
      created_at: clean(row.createdAt || now),
    }))
    .filter((row) => row.id && row.amount_halalas > 0);

  const expenses = rows(input, "expenses", "expense_entries")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      amount_halalas: moneyHalalas(row, ["amountHalalas", "amount_halalas"], ["amount"], 0),
      category: clean(row.category),
      description: clean(row.description || row.note),
      payment_method: clean(row.paymentMethod || "cash"),
      occurred_at: clean(row.occurredAt || row.date || row.createdAt || now),
      created_by_uid: clean(row.createdByUid || row.createdBy),
      created_at: clean(row.createdAt || now),
      updated_at: now,
      title: clean(row.title),
      note: clean(row.note),
      added_by: clean(row.addedBy || row.createdByName || row.createdBy),
      source_kind: clean(row.sourceKind),
      source_ref_id: clean(row.sourceRefId),
      source_type: clean(row.sourceType),
      staff_id: clean(row.staffId),
      staff_name: clean(row.staffName),
      month_key: clean(row.monthKey),
      payroll_kind: clean(row.payrollKind),
    }))
    .filter((row) => row.id && row.amount_halalas > 0);

  const discounts = mergeRowsById(rows(input, "discounts"), rows(input, "offers"))
    .map((row) => {
      const id = clean(row.id);
      const code = clean(row.code).toUpperCase();
      let codeKey = clean(row.codeKey || row.code).toUpperCase();
      return {
        id,
        salon_id: salonId,
        code,
        code_key: codeKey,
        name: clean(row.name || row.title || "Discount"),
        type: clean(row.type || row.discountType || "fixed"),
        value: number(row.value, 0),
        active: row.active === false ? 0 : 1,
        starts_at: clean(row.startsAt || row.startDate),
        ends_at: clean(row.endsAt || row.endDate),
        usage_limit: row.usageLimit === undefined ? null : number(row.usageLimit, 0),
        used_count: number(row.usedCount ?? row.usageCount, 0),
        applies_to: clean(row.appliesTo || "all"),
        service_ids_json: JSON.stringify(Array.isArray(row.serviceIds) ? row.serviceIds : []),
        sequence_steps_json: JSON.stringify(Array.isArray(row.sequenceSteps) ? row.sequenceSteps : []),
        image_url: clean(row.imageUrl),
        deleted_at: clean(row.deletedAt),
        created_at: clean(row.createdAt || now),
        updated_at: now,
      };
    })
    .filter((row) => row.id && row.name);
  report.discountDecisions = resolveDiscountCodeConflicts(discounts, warningConflicts);

  const refunds = rows(input, "refunds")
    .map((row) => ({
      id: clean(row.id), salon_id: salonId, payment_id: clean(row.paymentId),
      invoice_id: clean(row.invoiceId), booking_id: clean(row.bookingId), client_id: resolveClientId(row.clientId),
      amount_halalas: moneyHalalas(row, ["amountHalalas", "amount_halalas"], ["amount"], 0),
      method: clean(row.method || row.paymentMethod || "cash"), reason: clean(row.reason),
      status: clean(row.status || "completed"), idempotency_key: clean(row.idempotencyKey || row.id),
      provider_reference: clean(row.providerReference), created_by_uid: clean(row.createdByUid),
      refunded_at: clean(row.refundedAt || row.createdAt || now),
      voided_at: clean(row.voidedAt), voided_by_uid: clean(row.voidedByUid),
      created_at: clean(row.createdAt || now),
    }))
    .filter((row) => row.id && row.amount_halalas > 0);

  const auditLogs = rows(input, "audit_logs", "logs")
    .map((row) => ({
      id: clean(row.id), salon_id: salonId, action: clean(row.action || "legacy_event"),
      entity_type: clean(row.entityType || "unknown"), entity_id: clean(row.entityId),
      description: clean(row.description), source: clean(row.source || "migration"),
      actor_uid: clean(row.actorUid), actor_email: clean(row.actorEmail), actor_name: clean(row.actorName),
      before_json: JSON.stringify(row.before ?? null), after_json: JSON.stringify(row.after ?? null),
      meta_json: JSON.stringify(row.meta ?? {}), created_at: clean(row.createdAt || now),
    }))
    .filter((row) => row.id && row.action);


  const employeeProfiles = [];
  const employeeEmployment = [];
  const hrWorkSchedules = [];
  for (const row of staffSources) {
    const id = clean(row.id);
    if (!id) continue;
    const personal = row.personal && typeof row.personal === "object" ? row.personal : {};
    const employment = row.employment && typeof row.employment === "object" ? row.employment : {};
    employeeProfiles.push({
      id,
      salon_id: salonId,
      firebase_uid: clean(row.firebaseUid || row.authUid || row.uid || row.linkedUid || personal.uid),
      name: clean(personal.name || row.name || row.displayName || "Employee"),
      email: clean(personal.email || row.email),
      phone_normalized: normalizePhone(personal.phone || row.phone || row.mobile),
      avatar_file_id: clean(row.avatarFileId || personal.avatar?.id),
      status: clean(employment.status || employment.employmentStatus || row.employmentStatus || (row.active === false ? "inactive" : "active")),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    });
    employeeEmployment.push({
      salon_id: salonId,
      employee_id: id,
      title: clean(employment.title || row.title),
      job_title: clean(employment.jobTitle || row.jobTitle),
      department: clean(employment.department || row.department),
      employment_source: clean(employment.employmentSource || row.employmentSource || "salon"),
      partner_id: clean(employment.partnerId || row.partnerId),
      partner_member_id: clean(employment.partnerMemberId || row.partnerMemberId),
      contract_id: clean(employment.contractId || row.contractId),
      start_date: clean(employment.startDate || row.startDate),
      leave_balance: Number(employment.leaveBalance ?? row.leaveBalance ?? 0) || 0,
      base_salary_halalas: moneyHalalas(employment, ["baseSalaryHalalas", "base_salary_halalas"], ["baseSalary"], 0),
      housing_allowance_halalas: moneyHalalas(employment, ["housingAllowanceHalalas", "housing_allowance_halalas"], ["housingAllowance"], 0),
      transportation_allowance_halalas: moneyHalalas(employment, ["transportationAllowanceHalalas", "transportation_allowance_halalas"], ["transportationAllowance"], 0),
      other_allowances_halalas: moneyHalalas(employment, ["otherAllowancesHalalas", "other_allowances_halalas"], ["otherAllowances", "allowances"], 0),
      expected_work_days: employment.expectedWorkDays ?? row.expectedWorkDays ?? null,
      expected_work_hours: employment.expectedWorkHours ?? row.expectedWorkHours ?? null,
      shift_start_time: normalizeTime(employment.shiftStartTime || row.shiftStartTime),
      shift_end_time: normalizeTime(employment.shiftEndTime || row.shiftEndTime),
      weekly_off_days_json: JSON.stringify(Array.isArray(employment.workSchedule?.weeklyOffDays) ? employment.workSchedule.weeklyOffDays : Array.isArray(row.weeklyOffDays) ? row.weeklyOffDays : []),
      allowed_zone_ids_json: JSON.stringify(Array.isArray(employment.allowedZoneIds) ? employment.allowedZoneIds : Array.isArray(row.allowedZoneIds) ? row.allowedZoneIds : []),
      employment_status: clean(employment.employmentStatus || employment.status || row.employmentStatus || "active"),
      employee_code: clean(employment.employeeCode || row.employeeCode),
      fingerprint_number: clean(employment.fingerprintNumber || row.fingerprintNumber),
      admin_notes: clean(employment.adminNotes || row.adminNotes),
      updated_by_uid: clean(employment.updatedByUid || row.updatedByUid),
      updated_by_email: clean(employment.updatedByEmail || row.updatedByEmail),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    });
  }
  for (const schedule of staffSchedules) {
    hrWorkSchedules.push({
      id: `hr_${schedule.id}`,
      salon_id: salonId,
      employee_id: schedule.staff_id,
      weekday: schedule.weekday,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      active: schedule.active,
      effective_from: "",
      effective_to: "",
      created_at: schedule.created_at,
      updated_at: now,
    });
  }
  for (const row of rows(input, "work_schedules")) {
    const employeeId = clean(row.employeeId || row.staffId || row.id);
    if (!employeeId) continue;
    const weekday = Number(row.weekday ?? row.dayIndex);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    hrWorkSchedules.push({
      id: clean(row.id) || stableId("hr_schedule", `${employeeId}:${weekday}:${row.startTime}:${row.endTime}`),
      salon_id: salonId,
      employee_id: employeeId,
      weekday,
      start_time: normalizeTime(row.startTime || row.start),
      end_time: normalizeTime(row.endTime || row.end),
      active: row.active === false ? 0 : 1,
      effective_from: clean(row.effectiveFrom),
      effective_to: clean(row.effectiveTo),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    });
  }

  const attendanceRecords = mergeRowsById(rows(input, "attendance_records"), rows(input, "attendance"))
    .map((row) => {
      const employeeId = clean(row.employeeId || row.employeeDocId || row.staffId || row.employeeUid);
      const recordedAt = clean(row.recordedAt || row.serverTime || row.time || row.createdAt || now);
      return {
        id: clean(row.id), salon_id: salonId, employee_id: employeeId,
        employee_uid: clean(row.employeeUid || row.uid),
        date_key: clean(row.dateKey || row.date || recordedAt.slice(0, 10)),
        record_type: clean(row.recordType || row.type || "check_in"), recorded_at: recordedAt,
        latitude: row.latitude ?? row.location?.lat ?? null,
        longitude: row.longitude ?? row.location?.lng ?? null,
        accuracy_meters: row.accuracyMeters ?? row.location?.accuracy ?? null,
        zone_id: clean(row.zoneId), device_id: clean(row.deviceId || row.deviceInfo?.deviceId),
        source: clean(row.source || "migration"), note: clean(row.note),
        idempotency_key: clean(row.idempotencyKey || row.id), created_at: clean(row.createdAt || now),
      };
    }).filter((row) => row.id && row.employee_id && row.date_key);
  const attendanceStateMap = new Map();
  for (const row of [...attendanceRecords].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) {
    attendanceStateMap.set(row.employee_id, {
      salon_id: salonId, employee_id: row.employee_id, last_type: row.record_type,
      last_record_id: row.id, last_time: row.recorded_at, last_latitude: row.latitude,
      last_longitude: row.longitude, last_accuracy_meters: row.accuracy_meters,
      last_zone_id: row.zone_id, updated_at: now,
    });
  }

  const employeeLeaves = rows(input, "employee_leave_requests")
    .map((row) => ({
      id: clean(row.id), salon_id: salonId,
      employee_id: clean(row.employeeId || row.employeeDocId || row.employeeUid),
      employee_uid: clean(row.employeeUid || row.userId), employee_name: clean(row.employeeName),
      employee_email: clean(row.employeeEmail), status: clean(row.status || "pending"),
      leave_type: clean(row.leaveType || row.type || "annual"),
      start_date: clean(row.startDate || row.fromDate), end_date: clean(row.endDate || row.toDate),
      days_count: Number(row.daysCount ?? row.days ?? 0) || 0,
      employee_note: clean(row.employeeNote || row.note), hr_note: clean(row.hrNote),
      decided_at: clean(row.decidedAt || row.reviewedAt),
      decided_by_uid: clean(row.decidedBy || row.reviewedBy || row.reviewerUid),
      decided_by_email: clean(row.decidedByEmail || row.reviewedByEmail),
      decided_by_name: clean(row.decidedByName || row.reviewedByName || row.reviewerName),
      created_at: clean(row.createdAt || now), updated_at: clean(row.updatedAt || now),
    })).filter((row) => row.id && row.employee_id && row.start_date && row.end_date);

  const employeeAbsences = rows(input, "employee_absences")
    .map((row) => ({
      id: clean(row.id), salon_id: salonId,
      employee_id: clean(row.employeeId || row.employeeDocId || row.employeeUid),
      employee_uid: clean(row.employeeUid), date_key: clean(row.date || row.dateKey),
      absence_type: clean(row.type || row.absenceType || "full_day"), note: clean(row.note),
      created_by_uid: clean(row.createdByUid), created_at: clean(row.createdAt || now), updated_at: clean(row.updatedAt || now),
    })).filter((row) => row.id && row.employee_id && row.date_key);

  const payrollPeriodsMap = new Map();
  const payrollEntries = rows(input, "employee_payroll_records")
    .map((row) => {
      const employeeId = clean(row.employeeId || row.employeeUid);
      const payrollMonth = clean(row.payrollMonth || row.monthKey);
      if (!employeeId || !/^\d{4}-\d{2}$/.test(payrollMonth)) return null;
      const monthStart = clean(row.monthStart || `${payrollMonth}-01`);
      const monthEnd = clean(row.monthEnd || row.calculationEndDate || monthStart);
      if (!payrollPeriodsMap.has(payrollMonth)) payrollPeriodsMap.set(payrollMonth, {
        id: `payroll_period_${payrollMonth}`, salon_id: salonId, payroll_month: payrollMonth,
        month_start: monthStart, month_end: monthEnd, status: "open",
        created_by_uid: clean(row.createdByUid), closed_by_uid: "", closed_at: "",
        created_at: clean(row.createdAt || now), updated_at: now,
      });
      return {
        id: clean(row.id) || `${employeeId}__${payrollMonth}`, salon_id: salonId,
        period_id: `payroll_period_${payrollMonth}`, employee_id: employeeId, payroll_month: payrollMonth,
        base_salary_halalas: moneyHalalas(row, ["baseSalaryHalalas"], ["baseSalary"], 0),
        allowances_halalas: moneyHalalas(row, ["allowancesHalalas"], ["allowances", "housingAllowance", "transportationAllowance", "otherAllowances"], 0),
        absence_days: Number(row.absenceDays || 0),
        absence_deduction_halalas: moneyHalalas(row, ["absenceDeductionHalalas"], ["absenceDeduction", "absencePenalties"], 0),
        expected_work_hours: row.expectedWorkHours ?? null, actual_worked_hours: row.actualWorkedHours ?? null,
        missing_hours: row.attendanceMissingHours ?? row.missingHours ?? null,
        overtime_hours: row.attendanceOvertimeHours ?? row.overtimeHours ?? null,
        overtime_bonus_halalas: moneyHalalas(row, ["overtimeBonusHalalas"], ["overtimeBonus", "overtime"], 0),
        delay_deduction_halalas: moneyHalalas(row, ["delayDeductionHalalas"], ["delayDeduction", "delay"], 0),
        insurance_deduction_halalas: moneyHalalas(row, ["insuranceDeductionHalalas"], ["insuranceDeduction", "insurance"], 0),
        other_deductions_halalas: moneyHalalas(row, ["otherDeductionsHalalas"], ["totalSalaryDeductions", "deductions"], 0),
        gross_salary_halalas: moneyHalalas(row, ["grossSalaryHalalas"], ["grossSalary"], 0),
        final_salary_halalas: moneyHalalas(row, ["finalSalaryHalalas"], ["finalSalary", "total", "salary"], 0),
        schedule_snapshot_json: JSON.stringify(row.scheduleSnapshot || null),
        absence_entries_json: JSON.stringify(row.absenceEntries || []),
        deductions_json: JSON.stringify(row.salaryDeductions || []),
        mudad_file_id: clean(row.mudadDocument?.id || row.mudadFileId),
        created_by_uid: clean(row.createdByUid), created_by_email: clean(row.createdByEmail),
        created_at: clean(row.createdAt || now), updated_at: clean(row.updatedAt || now),
      };
    }).filter(Boolean);

  const salonSettings = rows(input, "settings").map((row) => ({
    salon_id: salonId, setting_key: clean(row.id || row.key || "app"),
    value_json: JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"))),
    visibility: clean(row.visibility || (clean(row.id) === "app" ? "public" : "private")),
    updated_by_uid: clean(row.updatedByUid), updated_at: clean(row.updatedAt || now),
  })).filter((row) => row.setting_key);

  const adminProfiles = [];
  const roleAssignments = [];
  for (const row of mergeRowsById(rows(input, "users"), rows(input, "admin_users"))) {
    const uid = clean(row.uid || row.firebaseUid || row.id);
    if (!uid) continue;
    const role = clean(row.role || "client").toLowerCase();
    adminProfiles.push({
      salon_id: salonId, firebase_uid: uid, username: clean(row.username),
      display_name: clean(row.displayName || row.name), email: clean(row.email),
      employee_id: clean(row.employeeId || row.linkedEmployeeDocId),
      active: row.active === false || row.disabled === true ? 0 : 1,
      created_at: clean(row.createdAt || now), updated_at: clean(row.updatedAt || now),
    });
    roleAssignments.push({
      salon_id: salonId, firebase_uid: uid, role, scope: "salon",
      active: row.active === false || row.disabled === true ? 0 : 1,
      assigned_by_uid: clean(row.updatedByUid || row.createdByUid),
      created_at: clean(row.createdAt || now), updated_at: clean(row.updatedAt || now),
    });
  }

  const fileMetadata = rows(input, "employee_files").map((row) => ({
    id: clean(row.id), salon_id: salonId,
    employee_id: clean(row.employeeId || row.employeeUid), category: clean(row.category || row.fileType || "general"),
    title: clean(row.title), description: clean(row.description || row.notes),
    file_name: clean(row.fileName || row.name || "file"),
    storage_key: clean(row.storageKey || row.filePath), bucket_name: clean(row.bucketName),
    content_type: clean(row.contentType || row.mimeType), size_bytes: row.fileSize ?? row.sizeBytes ?? null,
    status: clean(row.status || "active"), visibility: clean(row.visibility || "private"),
    uploaded_by_uid: clean(row.uploadedBy || row.createdByUid),
    replaced_by_file_id: clean(row.replacedByFileId), replaces_file_id: clean(row.replacesFileId),
    created_at: clean(row.createdAt || row.uploadedAt || now), updated_at: clean(row.updatedAt || now),
  })).filter((row) => row.id && row.storage_key);

  const notificationRecords = rows(input, "notifications").map((row) => ({
    id: clean(row.id), salon_id: salonId, target_uid: clean(row.targetUid || row.userId || row.uid),
    title: clean(row.title), body: clean(row.body || row.message),
    notification_type: clean(row.type || "system"), related_type: clean(row.relatedTo || row.relatedType),
    related_id: clean(row.relatedId), is_read: row.isRead === true ? 1 : 0,
    read_at: clean(row.readAt), created_at: clean(row.createdAt || now), updated_at: clean(row.updatedAt || now),
  })).filter((row) => row.id && row.target_uid && row.title);

  return {
    blockingConflicts,
    warningConflicts,
    report,
    tables: {
      clients: coreClients,
      client_aliases: clientAliases,
      service_categories: categories,
      service_sections: sections,
      services: [...serviceMap.values()],
      staff: [...staffMap.values()],
      staff_services: staffServices,
      staff_schedules: staffSchedules,
      bookings,
      booking_items: bookingItems,
      booking_slot_locks: bookingSlotLocks,
      invoices,
      payments,
      income_entries: income,
      expense_entries: expenses,
      discounts,
      refunds,
      audit_logs: auditLogs,
      employee_profiles: employeeProfiles,
      employee_employment: employeeEmployment,
      hr_work_schedules: hrWorkSchedules,
      attendance_records: attendanceRecords,
      attendance_state: [...attendanceStateMap.values()],
      employee_leaves: employeeLeaves,
      employee_absences: employeeAbsences,
      payroll_periods: [...payrollPeriodsMap.values()],
      payroll_entries: payrollEntries,
      salon_settings: salonSettings,
      admin_profiles: adminProfiles,
      role_assignments: roleAssignments,
      file_metadata: fileMetadata,
      notification_records: notificationRecords,
    },
  };
}

const SQL_TABLE_ORDER = [
  "clients",
  "client_aliases",
  "service_categories",
  "service_sections",
  "services",
  "staff",
  "staff_services",
  "staff_schedules",
  "bookings",
  "booking_items",
  "booking_slot_locks",
  "invoices",
  "payments",
  "income_entries",
  "expense_entries",
  "discounts",
  "refunds",
  "audit_logs",
  "employee_profiles",
  "employee_employment",
  "hr_work_schedules",
  "attendance_records",
  "attendance_state",
  "employee_leaves",
  "employee_absences",
  "payroll_periods",
  "payroll_entries",
  "salon_settings",
  "admin_profiles",
  "role_assignments",
  "file_metadata",
  "notification_records",
];

const SQL_PRIMARY_KEYS = {
  clients: ["id"],
  client_aliases: ["salon_id", "alias_id"],
  service_categories: ["id"],
  service_sections: ["id"],
  services: ["id"],
  staff: ["id"],
  staff_services: ["salon_id", "staff_id", "service_id"],
  staff_schedules: ["id"],
  bookings: ["id"],
  booking_items: ["id"],
  booking_slot_locks: ["salon_id", "staff_id", "booking_date", "slot_time"],
  invoices: ["id"],
  payments: ["id"],
  income_entries: ["id"],
  expense_entries: ["id"],
  discounts: ["id"],
  refunds: ["id"],
  audit_logs: ["id"],
  employee_profiles: ["id"],
  employee_employment: ["salon_id", "employee_id"],
  hr_work_schedules: ["id"],
  attendance_records: ["id"],
  attendance_state: ["salon_id", "employee_id"],
  employee_leaves: ["id"],
  employee_absences: ["id"],
  payroll_periods: ["id"],
  payroll_entries: ["id"],
  salon_settings: ["salon_id", "setting_key"],
  admin_profiles: ["salon_id", "firebase_uid"],
  role_assignments: ["salon_id", "firebase_uid", "role", "scope"],
  file_metadata: ["id"],
  notification_records: ["id"],
};

function utf8Bytes(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function insertPrefix(table, columns) {
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES `;
}

function rowValuesSql(row, columns) {
  return `(${columns.map((key) => sqlValue(row[key])).join(", ")})`;
}

function whereByPrimaryKey(table, row) {
  const keys = SQL_PRIMARY_KEYS[table] || ["id"];
  if (keys.some((key) => clean(row[key]) === "")) return "";
  return keys.map((key) => `${key} = ${sqlValue(row[key])}`).join(" AND ");
}

function splitSqlString(value, maxLiteralBytes) {
  const chunks = [];
  let current = "";
  for (const char of Array.from(String(value))) {
    const candidate = `${current}${char}`;
    if (current && utf8Bytes(sqlValue(candidate)) > maxLiteralBytes) {
      chunks.push(current);
      current = char;
      continue;
    }
    current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

function singleRowInsert(table, row, columns) {
  return `${insertPrefix(table, columns)}${rowValuesSql(row, columns)};`;
}

function buildLargeRowStatements(table, row, columns, maxStatementBytes) {
  const original = singleRowInsert(table, row, columns);
  if (utf8Bytes(original) <= maxStatementBytes) return [original];

  const where = whereByPrimaryKey(table, row);
  if (!where) return [original];
  const primaryKeys = new Set(SQL_PRIMARY_KEYS[table] || ["id"]);
  const stringColumns = columns
    .filter((column) => !primaryKeys.has(column) && typeof row[column] === "string" && row[column] !== "")
    .sort((a, b) => utf8Bytes(sqlValue(row[b])) - utf8Bytes(sqlValue(row[a])));

  const baseRow = { ...row };
  const offloaded = [];
  for (const column of stringColumns) {
    baseRow[column] = "";
    offloaded.push(column);
    if (utf8Bytes(singleRowInsert(table, baseRow, columns)) <= maxStatementBytes) break;
  }

  const statements = [singleRowInsert(table, baseRow, columns)];
  for (const column of offloaded) {
    const prefix = `UPDATE ${table} SET ${column} = COALESCE(${column}, '') || `;
    const suffix = ` WHERE ${where};`;
    const maxLiteralBytes = Math.max(1, maxStatementBytes - utf8Bytes(prefix) - utf8Bytes(suffix));
    for (const chunk of splitSqlString(row[column], maxLiteralBytes)) {
      statements.push(`${prefix}${sqlValue(chunk)}${suffix}`);
    }
  }
  return statements;
}

function buildSqlArtifact(tables, { maxStatementBytes = MAX_SQL_STATEMENT_BYTES } = {}) {
  const statements = [];
  const chunksPerTable = {};
  let largestStatementBytes = 0;
  const addStatement = (table, statement) => {
    const bytes = utf8Bytes(statement);
    largestStatementBytes = Math.max(largestStatementBytes, bytes);
    chunksPerTable[table] = (chunksPerTable[table] || 0) + 1;
    statements.push(statement);
  };

  for (const table of SQL_TABLE_ORDER) {
    const rowsForTable = tables[table] || [];
    let activeSignature = "";
    let activePrefix = "";
    let activePrefixBytes = 0;
    let activeValues = [];
    let activeValuesBytes = 0;

    const flush = () => {
      if (!activeValues.length) return;
      addStatement(table, `${activePrefix}${activeValues.join(", ")};`);
      activeSignature = "";
      activePrefix = "";
      activePrefixBytes = 0;
      activeValues = [];
      activeValuesBytes = 0;
    };

    for (const row of rowsForTable) {
      const columns = Object.keys(row);
      const signature = columns.join("\u0000");
      const prefix = insertPrefix(table, columns);
      const valuesSql = rowValuesSql(row, columns);
      const singleStatement = `${prefix}${valuesSql};`;
      if (utf8Bytes(singleStatement) > maxStatementBytes) {
        flush();
        for (const statement of buildLargeRowStatements(table, row, columns, maxStatementBytes)) {
          addStatement(table, statement);
        }
        continue;
      }

      if (!activeValues.length || activeSignature !== signature) {
        flush();
        activeSignature = signature;
        activePrefix = prefix;
        activePrefixBytes = utf8Bytes(prefix);
      }

      const valuesBytes = utf8Bytes(valuesSql);
      const separatorBytes = activeValues.length ? utf8Bytes(", ") : 0;
      const candidateBytes = activePrefixBytes + activeValuesBytes + separatorBytes + valuesBytes + utf8Bytes(";");
      if (activeValues.length && candidateBytes > maxStatementBytes) {
        flush();
        activeSignature = signature;
        activePrefix = prefix;
        activePrefixBytes = utf8Bytes(prefix);
      }
      activeValues.push(valuesSql);
      activeValuesBytes += (activeValues.length > 1 ? utf8Bytes(", ") : 0) + valuesBytes;
    }
    flush();
  }

  const sql = statements.join("\n");
  return {
    sql,
    report: {
      sqlStatementsGenerated: statements.length,
      largestStatementBytes,
      sqlFileBytes: utf8Bytes(sql),
      chunksPerTable,
      maxStatementBytes,
    },
  };
}

function buildSql(tables) {
  // Wrangler D1 remote execution on Windows is reliable with --file, but
  // rejects explicit BEGIN/COMMIT statements in the SQL file. Statements are
  // bounded by UTF-8 byte size and remain idempotent via INSERT OR REPLACE.
  return buildSqlArtifact(tables).sql;
}

function runWranglerD1(sql, database, config) {
  const directory = mkdtempSync(join(tmpdir(), "queens-core-migration-"));
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

const salonId = clean(arg("--salon") || process.env.SALON_ID || DEFAULT_SALON_ID);
const database = clean(
  arg("--database") || process.env.CORE_D1_DATABASE || DEFAULT_DATABASE
);
const config = clean(arg("--config") || "wrangler.core.jsonc");
const projectId = clean(
  arg("--project") ||
    process.env.FIREBASE_PROJECT_ID ||
    "waves-hotel-dashboard"
);
const inputPath = arg("--input");
const apply = hasFlag("--apply");
const input = inputPath
  ? JSON.parse(readFileSync(inputPath, "utf8"))
  : await readSourceFromFirestore(projectId, salonId);
const { tables, blockingConflicts, warningConflicts, report } = transform(input, salonId);
const counts = Object.fromEntries(
  Object.entries(tables).map(([table, tableRows]) => [table, tableRows.length])
);
const sqlArtifact = buildSqlArtifact(tables);
const sqlReport = sqlArtifact.report;

console.log("core migration source", inputPath ? "input-file" : "source-rest");
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
console.log(`asOfDate = ${report.asOfDate}`);
console.log(`slotLocksGeneratedActiveFuture = ${report.slotLocksGeneratedActiveFuture}`);
console.log(`slotLocksSkippedPast = ${report.slotLocksSkippedPast}`);
console.log(`slotLocksSkippedTerminalStatus = ${report.slotLocksSkippedTerminalStatus}`);
console.log(`slotLocksSkippedInvalid = ${report.slotLocksSkippedInvalid}`);
console.log(`slotLockItemsProcessed = ${report.slotLockItemsProcessed}`);
console.log(`bookingClientsResolvedDirect = ${report.bookingClientsResolvedDirect}`);
console.log(`bookingClientsResolvedCanonical = ${report.bookingClientsResolvedCanonical}`);
console.log(`bookingClientsResolvedByAlias = ${report.bookingClientsResolvedByAlias}`);
console.log(`bookingClientsResolvedByPhone = ${report.bookingClientsResolvedByPhone}`);
console.log(`bookingLegacyClientsCreated = ${report.bookingLegacyClientsCreated}`);
console.log(`bookingClientsUnresolved = ${report.bookingClientsUnresolved}`);
if (report.bookingLegacyClientRows.length) {
  console.log("booking legacy clients created");
  console.table(report.bookingLegacyClientRows);
}
console.log(`mergedClients = ${report.mergedClients}`);
console.log(`mergedClientGroups = ${report.mergedClientGroups}`);
if (report.clientCanonicalMappings.length) {
  console.log("client canonicalization oldClientId -> canonicalClientId");
  console.table(report.clientCanonicalMappings);
}
if (report.packageCanonicalMappings.length) {
  console.log("package canonicalization clientPackageId -> canonicalClientId");
  console.table(report.packageCanonicalMappings);
}
if (report.discountDecisions.length) {
  console.log("discount conflict decisions");
  console.table(report.discountDecisions);
}
console.log(`sqlStatementsGenerated = ${sqlReport.sqlStatementsGenerated}`);
console.log(`largestStatementBytes = ${sqlReport.largestStatementBytes}`);
console.log(`sqlFileBytes = ${sqlReport.sqlFileBytes}`);
console.log(`maxStatementBytes = ${sqlReport.maxStatementBytes}`);
console.log("chunksPerTable");
console.table(
  Object.entries(sqlReport.chunksPerTable).map(([table, chunks]) => ({
    table,
    chunks,
  }))
);
if (!apply && hasFlag("--dump-sql")) {
  console.log("sql dump");
  console.log(sqlArtifact.sql);
  process.exit(0);
}
if (!apply) {
  console.log("dry-run only. Re-run with --apply to write to Cloudflare D1.");
  process.exit(0);
}
if (blockingConflicts.length && !hasFlag("--allow-conflicts")) {
  throw new Error(
    "Blocking conflicts detected. Resolve them or pass --allow-conflicts after review."
  );
}
if (sqlReport.largestStatementBytes > MAX_SQL_STATEMENT_BYTES) {
  throw new Error(
    `Generated SQL statement exceeds ${MAX_SQL_STATEMENT_BYTES} bytes: ${sqlReport.largestStatementBytes}`
  );
}
runWranglerD1(sqlArtifact.sql, database, config);
console.log("core migration applied idempotently with INSERT OR REPLACE.");
