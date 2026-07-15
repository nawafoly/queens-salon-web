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

const DEFAULT_DATABASE = "queens-salon-core";
const DEFAULT_SALON_ID = "main";
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

function halalas(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number.isInteger(parsed) && parsed > 1000 ? parsed : Math.round(parsed * 100);
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
    "staff_public",
    "employees",
    "bookings",
    "invoices",
    "payments",
    "income",
    "expenses",
    "discounts",
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

function transform(input, salonId) {
  const now = new Date().toISOString();
  const conflicts = [];

  const clientMap = new Map();
  for (const row of rows(input, "clients")) {
    const id = clean(pick(row, ["canonicalClientId", "clientId", "id"], row.id));
    if (!id) continue;
    clientMap.set(id, {
      id,
      salon_id: salonId,
      name: clean(pick(row, ["name", "clientName", "displayName"], "Unnamed client")),
      phone_normalized: normalizePhone(
        pick(row, ["phoneNormalized", "normalizedPhone", "phone", "mobile", "clientPhone"])
      ),
      email: clean(row.email),
      firebase_uid: clean(pick(row, ["firebaseUid", "authUid", "uid", "userId"])),
      status: clean(row.status || "active"),
      notes: clean(row.notes),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    });
  }

  const clientAliases = [];
  const aliasOwner = new Map();
  const addAlias = (alias, canonicalId, type) => {
    const value = clean(alias);
    if (!value || value === canonicalId) return;
    const key = `${salonId}\u0000${value}`;
    const prior = aliasOwner.get(key);
    if (prior && prior !== canonicalId) {
      conflicts.push({
        type: "client_alias_conflict",
        alias: value,
        canonicalClientIds: [prior, canonicalId],
      });
      return;
    }
    aliasOwner.set(key, canonicalId);
    clientAliases.push({
      salon_id: salonId,
      alias_id: value,
      canonical_client_id: canonicalId,
      alias_type: type,
      created_at: now,
    });
  };

  for (const client of clientMap.values()) {
    addAlias(client.firebase_uid, client.id, "firebase_uid");
    addAlias(client.phone_normalized, client.id, "phone");
  }

  const categories = rows(input, "service_categories", "categories")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      name: clean(row.name || row.title || "Category"),
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
      price_halalas: halalas(
        row.priceHalalas ?? row.price_halalas ?? row.price ?? row["السعر"],
        0
      ),
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
  const bookingSlotLocks = [];
  const lockOwners = new Map();

  for (const row of rows(input, "bookings")) {
    const bookingId = clean(row.id);
    if (!bookingId) continue;
    const clientPhone = normalizePhone(row.clientPhone || row.phone || row.mobile);
    const clientId = clean(
      row.clientId || row.client_id || row.canonicalClientId || row.userId || clientPhone || stableId("client", bookingId)
    );
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, {
        id: clientId,
        salon_id: salonId,
        name: clean(row.clientName || row.name || "Legacy client"),
        phone_normalized: clientPhone,
        email: clean(row.clientEmail || row.email),
        firebase_uid: clean(row.userId),
        status: "active",
        notes: "Created during Core D1 migration from booking history",
        created_at: clean(row.createdAt || now),
        updated_at: now,
      });
      addAlias(row.userId, clientId, "booking_user_id");
      addAlias(clientPhone, clientId, "phone");
    }

    const parentDate = clean(row.date || row.bookingDate || row.booking_date);
    const parentStart = normalizeTime(row.time || row.startTime || row.start_time);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parentDate) || !parentStart) {
      conflicts.push({ type: "booking_missing_schedule", bookingId });
      continue;
    }
    const slotStepMin = Math.max(5, number(row.slotStepMinAtBooking || row.slotStepMin, 10));
    const bufferMin = Math.max(0, number(row.bufferMinAtBooking || row.bufferMin, 0));
    const itemSources = bookingItemSources(row);
    const transformedItems = [];
    let cursorDate = parentDate;
    let cursorTime = parentStart;

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
          price_halalas: halalas(
            item.price ?? item.finalPrice ?? row.finalPrice ?? row.total,
            0
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
      const price = halalas(
        item.price ?? item.finalPrice ?? item.total ?? row.finalPrice ?? row.total,
        service.price_halalas
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

      const status = clean(row.status || "booked").toLowerCase();
      if (staffId && !["cancelled", "canceled", "rejected"].includes(status)) {
        // Use the same fixed five-minute lock granularity as the Core Worker.
        // Historical UI slot steps are preserved on the booking row but must
        // not weaken overlap protection in booking_slot_locks.
        for (const slotTime of occupiedSlots(itemStart, itemEnd, 5, bufferMin)) {
          const key = `${salonId}\u0000${staffId}\u0000${itemDate}\u0000${slotTime}`;
          const prior = lockOwners.get(key);
          if (prior && prior.booking_id !== bookingId) {
            conflicts.push({
              type: "booking_slot_conflict",
              staffId,
              date: itemDate,
              slotTime,
              bookingIds: [prior.booking_id, bookingId],
            });
            continue;
          }
          const lock = {
            salon_id: salonId,
            staff_id: staffId,
            booking_date: itemDate,
            slot_time: slotTime,
            booking_id: bookingId,
            booking_item_id: itemId,
            created_at: clean(row.createdAt || now),
          };
          lockOwners.set(key, lock);
          bookingSlotLocks.push(lock);
        }
      }
      cursorDate = itemDate;
      cursorTime = itemEnd;
    });

    if (!transformedItems.length) {
      conflicts.push({ type: "booking_without_items", bookingId });
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
      subtotal_halalas: halalas(row.subtotalHalalas ?? row.subtotal, subtotal),
      discount_halalas: halalas(row.discountHalalas ?? row.discountAmount ?? row.discount, 0),
      total_halalas: halalas(row.totalHalalas ?? row.finalPrice ?? row.total, subtotal),
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

  const invoices = rows(input, "invoices")
    .map((row) => ({
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
    }))
    .filter((row) => row.id && row.client_id);

  const payments = rows(input, "payments")
    .map((row) => ({
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
      amount_halalas: halalas(row.amountHalalas ?? row.amount, 0),
      category: clean(row.category),
      description: clean(row.description || row.note),
      occurred_at: clean(row.occurredAt || row.date || row.createdAt || now),
      created_at: clean(row.createdAt || now),
    }))
    .filter((row) => row.id && row.amount_halalas > 0);

  const expenses = rows(input, "expenses", "expense_entries")
    .map((row) => ({
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
    }))
    .filter((row) => row.id && row.amount_halalas > 0);

  const discounts = rows(input, "discounts")
    .map((row) => ({
      id: clean(row.id),
      salon_id: salonId,
      code: clean(row.code),
      name: clean(row.name || row.title || "Discount"),
      type: clean(row.type || "fixed"),
      value: number(row.value, 0),
      active: row.active === false ? 0 : 1,
      starts_at: clean(row.startsAt),
      ends_at: clean(row.endsAt),
      usage_limit:
        row.usageLimit === undefined ? null : number(row.usageLimit, 0),
      used_count: number(row.usedCount, 0),
      created_at: clean(row.createdAt || now),
      updated_at: now,
    }))
    .filter((row) => row.id && row.name);

  return {
    conflicts,
    tables: {
      clients: [...clientMap.values()],
      client_aliases: clientAliases,
      service_categories: categories,
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
    "staff_schedules",
    "bookings",
    "booking_items",
    "booking_slot_locks",
    "invoices",
    "payments",
    "income_entries",
    "expense_entries",
    "discounts",
  ];
  return [
    "BEGIN TRANSACTION;",
    ...order.flatMap((table) =>
      (tables[table] || []).map((row) => insert(table, row))
    ),
    "COMMIT;",
  ].join("\n");
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
      throw new Error(
        `wrangler d1 execute failed with exit code ${result.status}`
      );
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
const { tables, conflicts } = transform(input, salonId);
const counts = Object.fromEntries(
  Object.entries(tables).map(([table, tableRows]) => [table, tableRows.length])
);

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
  throw new Error(
    "Conflicts detected. Resolve them or pass --allow-conflicts after review."
  );
}
runWranglerD1(buildSql(tables), database, config);
console.log("core migration applied idempotently with INSERT OR REPLACE.");
