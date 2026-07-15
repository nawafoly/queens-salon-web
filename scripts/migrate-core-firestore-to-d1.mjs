#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_DATABASE = "queens-salon-core";
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

function rows(input, ...names) {
  for (const name of names) {
    const value = input?.[name];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.entries(value).map(([id, data]) => ({ id, ...(data || {}) }));
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

function halalas(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number.isInteger(parsed) && parsed > 1000 ? parsed : Math.round(parsed * 100);
}

function sqlValue(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insert(table, row) {
  const columns = Object.keys(row);
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((key) => sqlValue(row[key])).join(", ")});`;
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

async function fetchCollection(projectId, salonId, collection, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/salons/${salonId}/${collection}`;
  const out = [];
  let pageToken = "";
  do {
    const url = new URL(base);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Source read failed for ${collection}: ${body?.error?.message || response.status}`);
    out.push(...(body.documents || []).map(firestoreDoc));
    pageToken = clean(body.nextPageToken);
  } while (pageToken);
  return out;
}

async function readSourceFromFirestore(projectId, salonId) {
  const token = clean(process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.FIRESTORE_ACCESS_TOKEN);
  if (!token) {
    throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN or FIRESTORE_ACCESS_TOKEN is required when --input is not used.");
  }
  const collections = [
    "clients",
    "services",
    "service_categories",
    "staff_public",
    "employees",
    "bookings",
    "invoices",
    "payments",
    "income",
    "expenses",
    "discounts",
  ];
  const entries = await Promise.all(collections.map(async (collection) => [
    collection,
    await fetchCollection(projectId, salonId, collection, token),
  ]));
  return Object.fromEntries(entries);
}

function transform(input, salonId) {
  const now = new Date().toISOString();
  const conflicts = [];

  const clients = rows(input, "clients").map((row) => ({
    id: clean(pick(row, ["canonicalClientId", "clientId", "id"], row.id)),
    salon_id: salonId,
    name: clean(pick(row, ["name", "clientName", "displayName"], "Unnamed client")),
    phone_normalized: normalizePhone(pick(row, ["phoneNormalized", "normalizedPhone", "phone", "mobile", "clientPhone"])),
    email: clean(row.email),
    firebase_uid: clean(pick(row, ["firebaseUid", "authUid", "uid", "userId"])),
    status: clean(row.status || "active"),
    notes: clean(row.notes),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.name);

  const clientAliases = [];
  const aliasOwner = new Map();
  for (const client of clients) {
    for (const alias of [client.id, client.firebase_uid, client.phone_normalized].filter(Boolean)) {
      const key = `${salonId}\u0000${alias}`;
      const prior = aliasOwner.get(key);
      if (prior && prior !== client.id) {
        conflicts.push({ type: "client_alias_conflict", alias, canonicalClientIds: [prior, client.id] });
        continue;
      }
      aliasOwner.set(key, client.id);
      if (alias !== client.id) {
        clientAliases.push({
          salon_id: salonId,
          alias_id: alias,
          canonical_client_id: client.id,
          alias_type: alias === client.phone_normalized ? "phone" : "migration",
          created_at: now,
        });
      }
    }
  }

  const categories = rows(input, "service_categories", "categories").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    name: clean(row.name || row.title || "Category"),
    active: row.active === false ? 0 : 1,
    sort_order: number(row.sortOrder || row.order, 0),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.name);

  const services = rows(input, "services").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    name: clean(row.name || row.title || "Service"),
    section_id: clean(row.sectionId || row.section_id),
    category_id: clean(row.categoryId || row.category_id),
    description: clean(row.description),
    duration_minutes: number(row.durationMin ?? row.durationMinutes ?? row.duration_minutes, 30),
    price_halalas: halalas(row.priceHalalas ?? row.price_halalas ?? row.price, 0),
    active: row.active === false ? 0 : 1,
    image_url: clean(row.imageUrl || row.image_url),
    sort_order: number(row.sortOrder || row.order, 0),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.name);

  const staff = rows(input, "staff", "staff_public", "employees").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    firebase_uid: clean(row.firebaseUid || row.authUid || row.uid),
    name: clean(row.name || row.displayName || "Staff"),
    phone_normalized: normalizePhone(row.phone || row.mobile),
    active: row.active === false || row.isActive === false ? 0 : 1,
    employment_status: clean(row.employmentStatus || "active"),
    avatar_url: clean(row.avatarUrl || row.avatarURL || row.photoURL || row.imageUrl),
    show_on_booking: row.showOnBooking === false ? 0 : 1,
    specialties_json: JSON.stringify(
      Array.isArray(row.specialties)
        ? row.specialties
        : Array.isArray(row.serviceIds)
          ? row.serviceIds
          : []
    ),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.name);

  const staffServices = [];
  for (const row of rows(input, "staff", "staff_public", "employees")) {
    for (const serviceId of Array.isArray(row.serviceIds) ? row.serviceIds : []) {
      staffServices.push({
        salon_id: salonId,
        staff_id: clean(row.id),
        service_id: clean(serviceId),
        active: 1,
      });
    }
  }

  const bookings = rows(input, "bookings").map((row) => ({
    id: clean(row.id),
    public_id: clean(row.publicId || row.trackPublicId || row.mk || row.id),
    salon_id: salonId,
    client_id: clean(row.clientId || row.client_id),
    staff_id: clean(row.staffId || row.employeeId || row.staff_id),
    booking_date: clean(row.date || row.bookingDate || row.booking_date),
    start_time: clean(row.time || row.startTime || row.start_time),
    end_time: clean(row.endTime || row.end_time),
    status: clean(row.status || "booked"),
    source: clean(row.source || "migration"),
    notes: clean(row.notes),
    subtotal_halalas: halalas(row.subtotalHalalas ?? row.subtotal, 0),
    discount_halalas: halalas(row.discountHalalas ?? row.discount, 0),
    total_halalas: halalas(row.totalHalalas ?? row.total, 0),
    payment_status: clean(row.paymentStatus || "unpaid"),
    package_sessions_used: number(row.packageSessionsUsed, 0),
    created_by_uid: clean(row.createdBy || row.createdByUid),
    created_at: clean(row.createdAt || now),
    updated_at: now,
    cancelled_at: clean(row.cancelledAt),
    completed_at: clean(row.completedAt),
  })).filter((row) => row.id && row.client_id && row.booking_date && row.start_time);

  const invoices = rows(input, "invoices").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    booking_id: clean(row.bookingId),
    client_id: clean(row.clientId),
    invoice_number: clean(row.invoiceNumber || row.number),
    subtotal_halalas: halalas(row.subtotalHalalas ?? row.subtotal, 0),
    discount_halalas: halalas(row.discountHalalas ?? row.discount, 0),
    total_halalas: halalas(row.totalHalalas ?? row.total, 0),
    paid_halalas: halalas(row.paidHalalas ?? row.paid, 0),
    status: clean(row.status || "unpaid"),
    issued_at: clean(row.issuedAt || row.createdAt || now),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.client_id);

  const payments = rows(input, "payments").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    invoice_id: clean(row.invoiceId),
    booking_id: clean(row.bookingId),
    client_id: clean(row.clientId),
    method: clean(row.method || row.paymentMethod || "cash"),
    amount_halalas: halalas(row.amountHalalas ?? row.amount, 0),
    status: clean(row.status || "paid"),
    provider: clean(row.provider),
    provider_reference: clean(row.providerReference),
    idempotency_key: clean(row.idempotencyKey),
    paid_at: clean(row.paidAt || row.createdAt || now),
    created_at: clean(row.createdAt || now),
  })).filter((row) => row.id && row.amount_halalas > 0);

  const income = rows(input, "income", "income_entries").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    booking_id: clean(row.bookingId),
    invoice_id: clean(row.invoiceId),
    payment_id: clean(row.paymentId),
    amount_halalas: halalas(row.amountHalalas ?? row.amount, 0),
    category: clean(row.category),
    description: clean(row.description || row.note),
    occurred_at: clean(row.occurredAt || row.date || row.createdAt || now),
    created_at: clean(row.createdAt || now),
  })).filter((row) => row.id && row.amount_halalas > 0);

  const expenses = rows(input, "expenses", "expense_entries").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    amount_halalas: halalas(row.amountHalalas ?? row.amount, 0),
    category: clean(row.category),
    description: clean(row.description || row.note),
    payment_method: clean(row.paymentMethod || "cash"),
    occurred_at: clean(row.occurredAt || row.date || row.createdAt || now),
    created_by_uid: clean(row.createdBy || row.createdByUid),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.amount_halalas > 0);

  const discounts = rows(input, "discounts").map((row) => ({
    id: clean(row.id),
    salon_id: salonId,
    code: clean(row.code),
    name: clean(row.name || row.title || "Discount"),
    type: clean(row.type || "fixed"),
    value: number(row.value, 0),
    active: row.active === false ? 0 : 1,
    starts_at: clean(row.startsAt),
    ends_at: clean(row.endsAt),
    usage_limit: row.usageLimit === undefined ? null : number(row.usageLimit, 0),
    used_count: number(row.usedCount, 0),
    created_at: clean(row.createdAt || now),
    updated_at: now,
  })).filter((row) => row.id && row.name);

  return {
    conflicts,
    tables: {
      clients,
      client_aliases: clientAliases,
      service_categories: categories,
      services,
      staff,
      staff_services: staffServices,
      bookings,
      invoices,
      payments,
      income_entries: income,
      expense_entries: expenses,
      discounts,
    },
  };
}

function buildSql(tables) {
  const order = [
    "clients",
    "client_aliases",
    "service_categories",
    "services",
    "staff",
    "staff_services",
    "bookings",
    "invoices",
    "payments",
    "income_entries",
    "expense_entries",
    "discounts",
  ];
  return ["BEGIN TRANSACTION;", ...order.flatMap((table) => (tables[table] || []).map((row) => insert(table, row))), "COMMIT;"].join("\n");
}

function runWranglerD1(sql, database) {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", database, "--remote", "--command", sql], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`wrangler d1 execute failed with exit code ${result.status}`);
}

const salonId = clean(arg("--salon") || process.env.SALON_ID || DEFAULT_SALON_ID);
const database = clean(arg("--database") || process.env.CORE_D1_DATABASE || DEFAULT_DATABASE);
const projectId = clean(arg("--project") || process.env.FIREBASE_PROJECT_ID || "waves-hotel-dashboard");
const inputPath = arg("--input");
const apply = hasFlag("--apply");
const input = inputPath ? JSON.parse(readFileSync(inputPath, "utf8")) : await readSourceFromFirestore(projectId, salonId);
const { tables, conflicts } = transform(input, salonId);
const counts = Object.fromEntries(Object.entries(tables).map(([table, tableRows]) => [table, tableRows.length]));

console.log("core migration source", inputPath ? "input-file" : "source-rest");
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
runWranglerD1(buildSql(tables), database);
console.log("core migration applied idempotently with INSERT OR REPLACE.");
