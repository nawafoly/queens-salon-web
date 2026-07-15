import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { __test } from "./packages/index.js";

const {
  FirestoreRestClient,
  toFirestoreFields,
  fromFirestoreFields,
  expireClientPackages,
  clearPackageWalletRuntimeCaches,
  __testD1,
} = __test;

class FakeFirestoreRest {
  constructor() {
    this.docs = new Map();
    this.failNextCommit = false;
    this.requestCount = 0;
    this.readOperations = 0;
    this.queryCollectionCounts = new Map();
    this.fail429Remaining = 0;
    this.delayRunQueryMs = 0;
    this.batchGetCount = 0;
    this.getDocumentCount = 0;
    this.runQueryCount = 0;
    this.getDocumentPaths = [];
  }

  seed(path, data) {
    this.docs.set(path, toFirestoreFields(data));
  }

  data(path) {
    const fields = this.docs.get(path);
    return fields ? fromFirestoreFields(fields) : null;
  }

  patch(path, data) {
    this.seed(path, { ...(this.data(path) || {}), ...data });
  }

  paths(prefix) {
    return [...this.docs.keys()].filter((path) => path.startsWith(prefix));
  }

  response(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  pathFromResource(name) {
    const marker = "/documents/";
    return decodeURIComponent(String(name).split(marker)[1] || "");
  }

  resource(path) {
    return `projects/waves-hotel-dashboard/databases/(default)/documents/${path}`;
  }

  docResponse(path) {
    const fields = this.docs.get(path);
    if (!fields) return { missing: this.resource(path) };
    return { found: { name: this.resource(path), fields } };
  }

  matchesWhere(data, where) {
    if (!where) return true;
    if (where.compositeFilter) {
      return where.compositeFilter.filters.every((filter) => this.matchesWhere(data, filter));
    }
    const filter = where.fieldFilter;
    const field = filter?.field?.fieldPath;
    const op = filter?.op;
    const value = fromFirestoreFields({ value: filter?.value }).value;
    if (op === "EQUAL") return data?.[field] === value;
    if (op === "LESS_THAN") return data?.[field] < value;
    return true;
  }

  query(parentPath, collectionId, structuredQuery) {
    const prefix = parentPath ? `${parentPath}/${collectionId}/` : `${collectionId}/`;
    const parentSegments = prefix.split("/").length;
    const rows = [];
    for (const [path, fields] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (path.split("/").length !== parentSegments) continue;
      const data = fromFirestoreFields(fields);
      if (!this.matchesWhere(data, structuredQuery.where)) continue;
      rows.push({ document: { name: this.resource(path), fields } });
    }
    const offset = Number(structuredQuery.offset || 0);
    const limit = Number(structuredQuery.limit || rows.length);
    return rows.slice(offset, offset + limit);
  }

  applyWrite(write) {
    if (write.delete) {
      this.docs.delete(this.pathFromResource(write.delete));
      return;
    }
    const path = this.pathFromResource(write.update.name);
    const exists = this.docs.has(path);
    if (write.currentDocument?.exists === false && exists) {
      throw new Error("ALREADY_EXISTS");
    }
    if (write.currentDocument?.exists === true && !exists) {
      throw new Error("NOT_FOUND");
    }
    if (write.updateMask) {
      const prior = this.docs.get(path) || {};
      this.docs.set(path, { ...prior, ...write.update.fields });
    } else {
      this.docs.set(path, write.update.fields || {});
    }
  }

  fetch = async (url, init = {}) => {
    this.requestCount += 1;
    if (this.fail429Remaining > 0) {
      this.fail429Remaining -= 1;
      return this.response({
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exceeded in fake Firestore",
        },
      }, 429, { "Retry-After": "0" });
    }
    const textUrl = String(url);
    if (textUrl.endsWith(":beginTransaction")) {
      return this.response({ transaction: "fake-transaction" });
    }
    if (textUrl.endsWith(":rollback")) {
      return this.response({});
    }
    if (textUrl.endsWith(":batchGet")) {
      this.batchGetCount += 1;
      const body = JSON.parse(init.body || "{}");
      this.readOperations += (body.documents || []).length;
      return this.response((body.documents || []).map((name) => this.docResponse(this.pathFromResource(name))));
    }
    if (textUrl.includes(":runQuery")) {
      this.runQueryCount += 1;
      if (this.delayRunQueryMs) await new Promise((resolve) => setTimeout(resolve, this.delayRunQueryMs));
      const body = JSON.parse(init.body || "{}");
      const parentRaw = decodeURIComponent((new URL(textUrl).pathname.split("/documents/")[1] || "").replace(":runQuery", ""));
      const collectionId = body.structuredQuery?.from?.[0]?.collectionId;
      this.queryCollectionCounts.set(collectionId, (this.queryCollectionCounts.get(collectionId) || 0) + 1);
      const rows = this.query(parentRaw, collectionId, body.structuredQuery || {});
      this.readOperations += rows.filter((row) => row.document).length;
      return this.response(rows);
    }
    if (String(init.method || "GET").toUpperCase() === "GET" && textUrl.includes("/documents/")) {
      this.getDocumentCount += 1;
      const path = this.pathFromResource(decodeURIComponent(new URL(textUrl).pathname));
      this.getDocumentPaths.push(path);
      const fields = this.docs.get(path);
      this.readOperations += 1;
      if (!fields) {
        return this.response({ error: { status: "NOT_FOUND", message: "Document not found" } }, 404);
      }
      return this.response({ name: this.resource(path), fields });
    }
    if (textUrl.endsWith(":commit")) {
      if (this.failNextCommit) {
        this.failNextCommit = false;
        return this.response({ error: { message: "forced commit failure" } }, 500);
      }
      const body = JSON.parse(init.body || "{}");
      try {
        (body.writes || []).forEach((write) => this.applyWrite(write));
      } catch (error) {
        return this.response({ error: { message: error.message } }, 409);
      }
      return this.response({ writeResults: [] });
    }
    return this.response({ error: { message: `unexpected fetch ${textUrl}` } }, 500);
  };
}

function env() {
  return {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    FIRESTORE_EMULATOR_HOST: "firestore.test",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5174,https://queens-salon-web.vercel.app,https://queens-salon-web-gnxk.vercel.app",
  };
}

class FakeD1 {
  constructor() {
    this.__fakeD1 = true;
    this.tables = {
      package_catalog: new Map(),
      clients: new Map(),
      client_packages: new Map(),
      package_transactions: new Map(),
      client_identity_aliases: new Map(),
    };
    this.queryCount = 0;
    this.batchCount = 0;
  }

  key(table, row) {
    if (table === "clients") return `${row.salon_id}\u0000${row.canonical_client_id}`;
    if (table === "client_identity_aliases") return `${row.salon_id}\u0000${row.alias_id}`;
    return row.id;
  }

  seed(table, row) {
    this.tables[table].set(this.key(table, row), { ...row });
  }

  rows(table) {
    return [...this.tables[table].values()].map((row) => ({ ...row }));
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    this.queryCount += 1;
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized === "SELECT 1 AS ok") return [{ ok: 1 }];
    if (normalized.startsWith("SELECT alias_id FROM client_identity_aliases")) {
      const [salonId, canonicalClientId] = params;
      return this.rows("client_identity_aliases")
        .filter((row) => row.salon_id === salonId && row.canonical_client_id === canonicalClientId)
        .sort((a, b) => a.alias_id.localeCompare(b.alias_id))
        .map((row) => ({ alias_id: row.alias_id }));
    }
    if (normalized.startsWith("SELECT alias_id, canonical_client_id FROM client_identity_aliases")) {
      const [salonId, ...aliases] = params;
      return this.rows("client_identity_aliases")
        .filter((row) => row.salon_id === salonId && aliases.includes(row.alias_id))
        .map((row) => ({ alias_id: row.alias_id, canonical_client_id: row.canonical_client_id }));
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND canonical_client_id = ?")) {
      const [salonId, canonicalClientId] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId && row.canonical_client_id === canonicalClientId).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND canonical_client_id IN")) {
      const [salonId, ...ids] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId && ids.includes(row.canonical_client_id)).slice(0, 2);
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ?")) {
      const [salonId, uid] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId && row.firebase_uid === uid).slice(0, 2);
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND phone_normalized IN")) {
      const [salonId, ...phones] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId && phones.includes(row.phone_normalized)).slice(0, 2);
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId).sort((a, b) => a.canonical_client_id.localeCompare(b.canonical_client_id));
    }
    if (normalized.startsWith("SELECT * FROM client_identity_aliases WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("client_identity_aliases").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM package_catalog WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.rows("package_catalog").filter((row) => row.salon_id === salonId && row.id === id && Number(row.active) === 1).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM client_packages WHERE salon_id = ? AND invoice_id = ?")) {
      const [salonId, invoiceId] = params;
      return this.rows("client_packages").filter((row) => row.salon_id === salonId && row.invoice_id === invoiceId).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM client_packages WHERE salon_id = ? AND id = ? AND canonical_client_id IN")) {
      const [salonId, id, ...clientIds] = params;
      return this.rows("client_packages").filter((row) => row.salon_id === salonId && row.id === id && clientIds.includes(row.canonical_client_id)).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM client_packages WHERE salon_id = ? AND canonical_client_id IN")) {
      const [salonId, ...clientIds] = params;
      return this.rows("client_packages")
        .filter((row) => row.salon_id === salonId && clientIds.includes(row.canonical_client_id))
        .sort((a, b) => String(b.purchased_at || b.created_at).localeCompare(String(a.purchased_at || a.created_at)));
    }
    if (normalized.startsWith("SELECT * FROM package_transactions WHERE id = ?")) {
      const [id] = params;
      return this.rows("package_transactions").filter((row) => row.id === id).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM package_transactions WHERE salon_id = ? AND canonical_client_id IN")) {
      const [salonId, ...clientIds] = params;
      return this.rows("package_transactions")
        .filter((row) => row.salon_id === salonId && clientIds.includes(row.canonical_client_id))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 100);
    }
    if (normalized.startsWith("SELECT cp.*, c.name AS client_name")) {
      const [salonId] = params;
      return this.rows("client_packages")
        .filter((row) => row.salon_id === salonId && row.status === "active")
        .map((row) => {
          const client = this.rows("clients").find((item) => item.salon_id === row.salon_id && item.canonical_client_id === row.canonical_client_id) || {};
          return { ...row, client_name: client.name || "", client_phone: client.phone_normalized || "" };
        });
    }
    throw new Error(`unhandled fake D1 all: ${normalized}`);
  }

  async run(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("INSERT OR IGNORE INTO client_identity_aliases")) {
      const [salon_id, alias_id, canonical_client_id, alias_type, created_at] = params;
      const key = `${salon_id}\u0000${alias_id}`;
      if (this.tables.client_identity_aliases.has(key)) return { meta: { changes: 0 } };
      this.seed("client_identity_aliases", { salon_id, alias_id, canonical_client_id, alias_type, created_at });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("INSERT OR IGNORE INTO clients")) {
      const [canonical_client_id, salon_id, name, phone_normalized, firebase_uid, legacy_ids_json, created_at, updated_at] = params;
      const key = `${salon_id}\u0000${canonical_client_id}`;
      if (this.tables.clients.has(key)) return { meta: { changes: 0 } };
      this.seed("clients", { canonical_client_id, salon_id, name, phone_normalized, firebase_uid, legacy_ids_json, created_at, updated_at });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("UPDATE client_packages SET status = 'expired'")) {
      const [updated_at, salon_id, now] = params;
      let count = 0;
      for (const row of this.rows("client_packages")) {
        if (row.salon_id !== salon_id || row.status !== "active" || !row.expires_at || row.expires_at >= now) continue;
        this.seed("client_packages", { ...row, status: "expired", updated_at });
        count += 1;
      }
      return { meta: { changes: count } };
    }
    throw new Error(`unhandled fake D1 run: ${normalized}`);
  }

  async batch(statements) {
    this.batchCount += 1;
    const results = [];
    for (const statement of statements) {
      const sql = statement.sql.replace(/\s+/g, " ").trim();
      const params = statement.params || [];
      if (sql.startsWith("INSERT OR IGNORE INTO clients")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("INSERT INTO client_packages")) {
        const [
          id, salon_id, canonical_client_id, package_catalog_id, package_name_snapshot, allowed_service_ids_json,
          total_sessions, remaining_sessions, purchased_at, expires_at, invoice_id, created_at, updated_at,
        ] = params;
        this.seed("client_packages", {
          id, salon_id, canonical_client_id, package_catalog_id, package_name_snapshot, allowed_service_ids_json,
          total_sessions, remaining_sessions, reserved_sessions: 0, used_sessions: 0, status: "active",
          purchased_at, expires_at, invoice_id, created_at, updated_at,
        });
        results.push({ meta: { changes: 1 } });
      } else if (sql.startsWith("UPDATE client_packages")) {
        const [
          remaining_sessions, reserved_sessions, used_sessions, status, updated_at, canonical_client_id,
          salon_id, id,
        ] = params;
        const ids = params.slice(8, params.length - 3);
        const [beforeRemaining, beforeReserved, beforeUsed] = params.slice(-3);
        const row = this.rows("client_packages").find((item) =>
          item.salon_id === salon_id &&
          item.id === id &&
          ids.includes(item.canonical_client_id) &&
          Number(item.remaining_sessions) === Number(beforeRemaining) &&
          Number(item.reserved_sessions) === Number(beforeReserved) &&
          Number(item.used_sessions) === Number(beforeUsed)
        );
        if (!row) {
          results.push({ meta: { changes: 0 } });
        } else {
          this.seed("client_packages", {
            ...row,
            remaining_sessions,
            reserved_sessions,
            used_sessions,
            status,
            updated_at,
            canonical_client_id,
          });
          results.push({ meta: { changes: 1 } });
        }
      } else if (sql.startsWith("INSERT INTO package_transactions") && sql.includes(" WHERE EXISTS ")) {
        const [
          id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
          remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
          service_id, booking_id, cart_item_id, invoice_id, created_at,
          existsSalonId, existsPackageId, existsCanonicalId, existsRemaining, existsReserved, existsUsed,
        ] = params;
        const exists = this.rows("client_packages").some((row) =>
          row.salon_id === existsSalonId &&
          row.id === existsPackageId &&
          row.canonical_client_id === existsCanonicalId &&
          Number(row.remaining_sessions) === Number(existsRemaining) &&
          Number(row.reserved_sessions) === Number(existsReserved) &&
          Number(row.used_sessions) === Number(existsUsed)
        );
        if (!exists) {
          results.push({ meta: { changes: 0 } });
        } else {
          this.seed("package_transactions", {
            id, salon_id, client_package_id, canonical_client_id, type, sessions_delta,
            remaining_before, remaining_after, reserved_before, reserved_after, used_before, used_after,
            service_id, booking_id, cart_item_id, invoice_id, created_at,
          });
          results.push({ meta: { changes: 1 } });
        }
      } else if (sql.startsWith("INSERT INTO package_transactions")) {
        const [
          id, salon_id, client_package_id, canonical_client_id, sessions_delta, remaining_after, invoice_id, created_at,
        ] = params;
        this.seed("package_transactions", {
          id, salon_id, client_package_id, canonical_client_id, type: "purchase", sessions_delta,
          remaining_before: 0, remaining_after, reserved_before: 0, reserved_after: 0,
          used_before: 0, used_after: 0, service_id: null, booking_id: null,
          cart_item_id: null, invoice_id, created_at,
        });
        results.push({ meta: { changes: 1 } });
      } else {
        throw new Error(`unhandled fake D1 batch: ${sql}`);
      }
    }
    return results;
  }
}

function envD1(fake) {
  return { ...env(), PACKAGES_DB: fake };
}

function seedD1Base(fake) {
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("clients", {
    canonical_client_id: "client-a",
    salon_id: "main",
    name: "Client A",
    phone_normalized: "0500000001",
    firebase_uid: "client1",
    legacy_ids_json: JSON.stringify(["legacy-client-a"]),
    created_at: now,
    updated_at: now,
  });
  fake.seed("client_identity_aliases", {
    salon_id: "main",
    alias_id: "legacy-client-a",
    canonical_client_id: "client-a",
    alias_type: "migration",
    created_at: now,
  });
  fake.seed("package_catalog", {
    id: "blowdry-10",
    salon_id: "main",
    name: "Blowdry 10",
    total_sessions: 10,
    price: 300,
    allowed_service_ids_json: JSON.stringify(["svc-a", "svc-b"]),
    active: 1,
    created_at: now,
    updated_at: now,
  });
}

function request(path, { method = "POST", token = "test:owner1:owner", body, origin = "http://127.0.0.1:5174" } = {}) {
  return new Request(`http://worker.test${path}`, {
    method,
    headers: {
      Origin: origin,
      Authorization: token ? `Bearer ${token}` : "",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });
}

function seedBase(fake) {
  fake.seed("salons/main/users/owner1", { role: "owner", active: true });
  fake.seed("salons/main/users/client1", { role: "client", active: true, clientId: "client-a" });
  fake.seed("salons/main/clients/client-a", { clientId: "client-a", authUid: "client1", name: "Client A", phone: "0500000001" });
  fake.seed("salons/main/clients/client-b", { clientId: "client-b", name: "Client B", phone: "0500000002" });
  fake.seed("salons/main/packages_catalog/blowdry-10", {
    name: "Blowdry 10",
    sessionsCount: 10,
    price: 300,
    validityDays: 365,
    allowedServiceIds: ["svc-a", "svc-b"],
    active: true,
  });
  fake.seed("salons/main/services/svc-a", { name: "Service A", price: 60, durationMin: 30, active: true });
  fake.seed("salons/main/services/svc-b", { name: "Service B", price: 80, durationMin: 45, active: true });
  fake.seed("salons/main/staff_public/staff-a", {
    name: "Staff A",
    active: true,
    isActive: true,
    employmentStatus: "active",
    serviceIds: ["svc-a", "svc-b"],
  });
  fake.seed("salons/main/settings/app", {
    booking: {
      slotStepMin: 30,
      bufferMin: 0,
      businessHours: {
        sun: { enabled: true, start: "09:00", end: "22:00" },
        mon: { enabled: true, start: "09:00", end: "22:00" },
        tue: { enabled: true, start: "09:00", end: "22:00" },
        wed: { enabled: true, start: "09:00", end: "22:00" },
        thu: { enabled: true, start: "09:00", end: "22:00" },
        fri: { enabled: true, start: "09:00", end: "22:00" },
        sat: { enabled: true, start: "09:00", end: "22:00" },
      },
    },
  });
  fake.seed("salons/main/settings/finance", { taxRate: 15 });
  fake.seed("salons/main/settings/package_subscriptions", {
    lateCancellationWindowMinutes: 0,
    lateCancellationConsumesSession: false,
    noShowConsumesSession: true,
  });
  fake.seed("salons/main/counters/invoices", { next: 10000 });
  fake.seed("salons/main/counters/bookings", { next: 10000 });
}

async function withFakeFirestore(fn) {
  const fake = new FakeFirestoreRest();
  seedBase(fake);
  clearPackageWalletRuntimeCaches();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    return await fn(fake);
  } finally {
    globalThis.fetch = originalFetch;
    clearPackageWalletRuntimeCaches();
  }
}

async function json(response) {
  return response.json();
}

async function purchase(fake, invoiceId = "invoice-1") {
  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId,
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  return body.data;
}

async function redeem(clientPackageId, operationId = "booking-1", time = "10:00") {
  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId,
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-15",
      time,
      operationId,
      cartItemId: `cart-${operationId}`,
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data;
}

test("rejects missing and invalid tokens", async () => {
  const missing = await worker.fetch(request("/api/packages/purchase", { token: "", body: {} }), env());
  assert.equal(missing.status, 401);

  const invalid = await worker.fetch(request("/api/packages/purchase", { token: "invalid-token", body: {} }), env());
  assert.equal(invalid.status, 401);
});

test("package worker allows both production dashboard origins", async () => {
  for (const origin of ["https://queens-salon-web.vercel.app", "https://queens-salon-web-gnxk.vercel.app"]) {
    const response = await worker.fetch(new Request("http://worker.test/api/packages/client-wallet", {
      method: "OPTIONS",
      headers: { Origin: origin },
    }), env());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  }
});

test("rejects unauthorized role before package sale", async () => withFakeFirestore(async () => {
  const response = await worker.fetch(request("/api/packages/purchase", {
    token: "test:client1:client",
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "forbidden-sale",
    },
  }), env());
  assert.equal(response.status, 403);
}));

test("sells package idempotently and writes invoice, ledger and balance", async () => withFakeFirestore(async (fake) => {
  const sale = await purchase(fake, "sale-idem-1");
  const clientPackage = fake.data(`salons/main/client_packages/${sale.clientPackageId}`);
  assert.equal(clientPackage.remainingSessions, 10);
  assert.equal(clientPackage.reservedSessions, 0);
  assert.equal(fake.paths("salons/main/invoices/").length, 1);
  assert.equal(fake.paths("salons/main/client_package_transactions/purchase:").length, 1);

  const repeated = await purchase(fake, "sale-idem-1");
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.clientPackageId, sale.clientPackageId);
  assert.equal(fake.paths("salons/main/client_packages/").length, 1);
}));

test("purchase resolves client when document id differs from auth uid", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/client-doc-not-uid", {
    clientId: "client-canonical-c",
    authUid: "firebase-uid-c",
    customerId: "customer-c",
    name: "Client C",
    phone: "0500000003",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "firebase-uid-c",
      clientLookup: {
        id: "firebase-uid-c",
        uid: "firebase-uid-c",
        authUid: "firebase-uid-c",
        customerId: "customer-c",
        phone: "0500000003",
      },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-doc-id-diff-uid",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "client-canonical-c");
  const clientPackage = fake.data(`salons/main/client_packages/${body.data.clientPackageId}`);
  assert.equal(clientPackage.clientId, "client-canonical-c");
  assert.equal(clientPackage.legacyClientDocId, "client-doc-not-uid");
  const ledgerPath = fake.paths("salons/main/client_package_transactions/purchase:")[0];
  const ledger = fake.data(ledgerPath);
  assert.equal(ledger.requestedClientId, "firebase-uid-c");
  assert.equal(ledger.clientId, "client-canonical-c");
}));

test("purchase prefers direct document id over duplicate phone matches", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/direct-doc-client", {
    clientId: "direct-canonical",
    name: "Direct Client",
    phone: "0500000099",
  });
  fake.seed("salons/main/clients/other-same-phone-client", {
    clientId: "other-same-phone",
    name: "Other Same Phone",
    phone: "0500000099",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "direct-doc-client",
      clientLookup: { phone: "0500000099" },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-direct-doc-priority",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "direct-canonical");
}));

test("purchase ignores document id value sent inside phone lookup fields", async () => withFakeFirestore(async (fake) => {
  const idLikeValue = "AbCdEfGhIjKlMnOpQrSt";
  fake.seed("salons/main/clients/id-like-phone-doc", {
    clientId: "id-like-canonical",
    authUid: idLikeValue,
    name: "ID Like Client",
    phone: "0500000061",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: idLikeValue,
      clientLookup: {
        authUid: idLikeValue,
        clientPhone: idLikeValue,
        phoneNumber: idLikeValue,
      },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-ignore-id-as-phone",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "id-like-canonical");
}));

test("purchase counts same document matched by uid and clientId once", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/multi-field-client", {
    clientId: "multi-canonical",
    uid: "multi-uid",
    authUid: "multi-uid",
    name: "Multi Field Client",
    phone: "0500000062",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "missing-strong-id",
      clientLookup: {
        clientId: "multi-canonical",
        uid: "multi-uid",
      },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-same-doc-multi-fields",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "multi-canonical");
}));

test("purchase returns ambiguous identity when phone-only lookup matches two clients", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/phone-duplicate-a", {
    clientId: "phone-duplicate-a",
    name: "Phone Duplicate A",
    phone: "0500000077",
  });
  fake.seed("salons/main/clients/phone-duplicate-b", {
    clientId: "phone-duplicate-b",
    name: "Phone Duplicate B",
    phone: "0500000077",
  });

  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "missing-phone-only",
      clientLookup: { phone: "0500000077" },
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "sale-phone-duplicate",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_client:ambiguous_identity");
}));

test("client wallet resolves canonical identity and includes package linked to legacy client id", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/canonical-wallet-client", {
    clientId: "canonical-wallet-client",
    legacyClientDocId: "legacy-wallet-client",
    authUid: "wallet-auth-uid",
    name: "Wallet Client",
    phone: "0500000088",
  });
  fake.seed("salons/main/client_packages/legacy-linked-package", {
    clientId: "legacy-wallet-client",
    packageNameSnapshot: "Legacy Linked Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 10,
    remainingSessions: 10,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "wallet-auth-uid",
      clientLookup: { authUid: "wallet-auth-uid" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "canonical-wallet-client");
  assert.equal(body.data.activePackageCount, 1);
  assert.equal(body.data.activePackages.length, 1);
  assert.equal(body.data.totalRemainingSessions, 10);
  assert.equal(body.data.totalUsedSessions, 0);
  assert.equal(body.data.totalReservedSessions, 0);
  assert.deepEqual(body.data.packages.map((p) => p.id), ["legacy-linked-package"]);
  assert.equal(body.data.packages[0].legacyClientId, "legacy-wallet-client");
}));

test("client wallet phone match with no packages returns 200 and zero balances", async () => withFakeFirestore(async () => {
  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "missing-client-by-phone",
      clientLookup: { phone: "0500000001" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "client-a");
  assert.deepEqual(body.data.packages, []);
  assert.deepEqual(body.data.activePackages, []);
  assert.equal(body.data.activePackageCount, 0);
  assert.equal(body.data.totalRemainingSessions, 0);
  assert.equal(body.data.totalUsedSessions, 0);
  assert.equal(body.data.totalReservedSessions, 0);
}));

test("client wallet phone match returns package linked to canonical alias", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/phone-wallet-client", {
    clientId: "phone-wallet-canonical",
    legacyClientDocId: "phone-wallet-legacy",
    name: "Phone Wallet Client",
    phone: "0500000091",
  });
  fake.seed("salons/main/client_packages/phone-wallet-package", {
    clientId: "phone-wallet-legacy",
    packageNameSnapshot: "Phone Wallet Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 4,
    remainingSessions: 4,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "missing-phone-wallet-client",
      clientLookup: { phone: "0500000091" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "phone-wallet-canonical");
  assert.equal(body.data.activePackageCount, 1);
  assert.equal(body.data.activePackages.length, 1);
  assert.equal(body.data.totalRemainingSessions, 4);
  assert.deepEqual(body.data.packages.map((p) => p.id), ["phone-wallet-package"]);
  assert.equal(body.data.packages[0].legacyClientId, "phone-wallet-legacy");
}));

test("client wallet accepts empty clientId when phone lookup resolves canonical package", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/phone-only-wallet-client", {
    clientId: "phone-only-wallet-canonical",
    name: "Phone Only Wallet Client",
    phone: "0500000092",
  });
  fake.seed("salons/main/client_packages/phone-only-wallet-package", {
    clientId: "phone-only-wallet-canonical",
    packageNameSnapshot: "Phone Only Wallet Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 3,
    remainingSessions: 3,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "",
      clientLookup: { phone: "0500000092" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "phone-only-wallet-canonical");
  assert.equal(body.data.activePackageCount, 1);
  assert.equal(body.data.totalRemainingSessions, 3);
  assert.deepEqual(body.data.packages.map((p) => p.id), ["phone-only-wallet-package"]);
  assert.equal(fake.batchGetCount, 0);
  assert.ok(fake.runQueryCount >= 1);
  assert.equal(fake.queryCollectionCounts.get("clients"), 1);
}));

test("client wallet stays under firestore call budget and avoids heavy audit relations", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/client_packages/budget-wallet-package", {
    clientId: "client-a",
    packageNameSnapshot: "Budget Wallet Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const before = fake.requestCount;
  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientLookup: { clientId: "client-a" },
    },
  }), env());
  const body = await json(response);
  const firestoreCalls = fake.requestCount - before;

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.activePackageCount, 1);
  assert.equal(body.data.activePackages.length, 1);
  assert.ok(firestoreCalls <= 5, `expected <= 5 Firestore calls, got ${firestoreCalls}`);
  assert.equal(fake.batchGetCount, 0);
  assert.ok(fake.getDocumentPaths.includes("salons/main/clients/client-a"));
  assert.equal(fake.queryCollectionCounts.get("client_packages"), 1);
  assert.equal(fake.queryCollectionCounts.get("client_package_transactions") || 0, 0);
  assert.equal(fake.queryCollectionCounts.get("bookings") || 0, 0);
  assert.equal(fake.queryCollectionCounts.get("invoices") || 0, 0);
  assert.equal(fake.queryCollectionCounts.get("payments") || 0, 0);
}));

test("repeated client wallet calls use cache after canonical id is known", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/client_packages/cache-wallet-package", {
    clientId: "client-a",
    packageNameSnapshot: "Cache Wallet Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const first = await worker.fetch(request("/api/packages/client-wallet", {
    body: { salonId: "main", clientId: "client-a", clientLookup: { clientId: "client-a" } },
  }), env());
  assert.equal(first.status, 200, JSON.stringify(await json(first)));
  const afterFirst = fake.requestCount;
  const packageQueriesAfterFirst = fake.queryCollectionCounts.get("client_packages") || 0;

  const second = await worker.fetch(request("/api/packages/client-wallet", {
    body: { salonId: "main", clientId: "client-a", clientLookup: { clientId: "client-a" } },
  }), env());
  assert.equal(second.status, 200, JSON.stringify(await json(second)));
  const secondDelta = fake.requestCount - afterFirst;

  assert.ok(secondDelta <= 1, `expected cached call to only resolve actor role, got ${secondDelta}`);
  assert.equal(fake.batchGetCount, 0);
  assert.equal(fake.queryCollectionCounts.get("client_packages") || 0, packageQueriesAfterFirst);
}));

test("concurrent client wallet calls are deduped for the same lookup", async () => withFakeFirestore(async (fake) => {
  fake.delayRunQueryMs = 15;
  fake.seed("salons/main/client_packages/dedupe-wallet-package", {
    clientId: "client-a",
    packageNameSnapshot: "Dedupe Wallet Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const [first, second] = await Promise.all([
    worker.fetch(request("/api/packages/client-wallet", {
      body: { salonId: "main", clientId: "client-a", clientLookup: { clientId: "client-a" } },
    }), env()),
    worker.fetch(request("/api/packages/client-wallet", {
      body: { salonId: "main", clientId: "client-a", clientLookup: { clientId: "client-a" } },
    }), env()),
  ]);

  assert.equal(first.status, 200, JSON.stringify(await json(first)));
  assert.equal(second.status, 200, JSON.stringify(await json(second)));
  assert.equal(fake.batchGetCount, 0);
  assert.equal(fake.queryCollectionCounts.get("client_packages"), 1);
}));

test("firestore 429 retries once then returns resource exhausted", async () => {
  const fake = new FakeFirestoreRest();
  fake.fail429Remaining = 2;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const client = new FirestoreRestClient(env(), "waves-hotel-dashboard");
    await assert.rejects(
      () => client.getDoc("salons/main/users/owner1"),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, "packages_firestore:resource_exhausted");
        return true;
      }
    );
    assert.equal(fake.requestCount, 2);
    assert.equal(fake.batchGetCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("identity ranking handles three client documents and package linked to second candidate", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/rank-doc-a", {
    clientId: "rank-canonical-a",
    name: "Ranked Client",
    phone: "0500000101",
  });
  fake.seed("salons/main/clients/rank-doc-b", {
    clientId: "rank-canonical-b",
    customerId: "rank-customer-b",
    name: "Ranked Client",
    phone: "0500000101",
  });
  fake.seed("salons/main/clients/rank-doc-c", {
    clientId: "rank-canonical-c",
    authUid: "rank-auth-c",
    name: "Ranked Client",
    phone: "0500000101",
  });
  fake.seed("salons/main/client_packages/rank-package-b", {
    clientId: "rank-canonical-b",
    packageNameSnapshot: "Rank Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 6,
    remainingSessions: 6,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/admin/audit-client-identities?salonId=main", {
    method: "GET",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const group = body.data.identityGroups.find((entry) => entry.canonicalSuggested === "rank-canonical-b");
  assert.ok(group, JSON.stringify(body.data.identityGroups));
  assert.equal(group.candidateCount, 3);
  for (const alias of ["rank-doc-a", "rank-canonical-a", "rank-doc-b", "rank-canonical-b", "rank-customer-b", "rank-doc-c", "rank-canonical-c", "rank-auth-c"]) {
    assert.equal(group.aliases.includes(alias), true, alias);
  }
  assert.equal(new Set(group.aliases).size, group.aliases.length);
  assert.equal(group.scores[0].relations.activePackageCount, 1);
}));

test("identity ranking prefers UUID document over legacy phone document when otherwise equal", async () => withFakeFirestore(async (fake) => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  fake.seed("salons/main/clients/legacy-phone-doc", {
    clientId: "phone-0500000102",
    name: "UUID Client",
    phone: "0500000102",
  });
  fake.seed(`salons/main/clients/${uuid}`, {
    clientId: uuid,
    name: "UUID Client",
    phone: "0500000102",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "missing-uuid-client",
      clientLookup: { phone: "0500000102" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, uuid);
}));

test("identity ranking resolves same uid in multiple records without duplicating a document", async () => withFakeFirestore(async (fake) => {
  const uuid = "22222222-3333-4444-8555-666666666666";
  fake.seed("salons/main/clients/same-uid-legacy", {
    clientId: "same-uid-legacy",
    authUid: "shared-auth-uid",
    name: "Same UID Client",
    phone: "0500000103",
  });
  fake.seed(`salons/main/clients/${uuid}`, {
    clientId: uuid,
    uid: "shared-auth-uid",
    authUid: "shared-auth-uid",
    name: "Same UID Client",
    phone: "0500000103",
  });
  fake.seed("salons/main/client_packages/same-uid-package", {
    clientId: "same-uid-legacy",
    packageNameSnapshot: "Same UID Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/admin/audit-client-identities?salonId=main", {
    method: "GET",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const group = body.data.identityGroups.find((entry) => entry.canonicalSuggested === "same-uid-legacy");
  assert.ok(group, JSON.stringify(body.data.identityGroups));
  assert.equal(group.scores[0].relations.activePackageCount, 1);
  assert.equal(group.aliases.filter((alias) => alias === "shared-auth-uid").length, 1);
}));

test("identity ranking rejects same phone for different people with different roles", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/role-owner-phone", {
    clientId: "role-owner-phone",
    name: "Role Owner",
    phone: "0500000104",
    role: "owner",
  });
  fake.seed("salons/main/clients/role-client-phone", {
    clientId: "role-client-phone",
    name: "Role Client",
    phone: "0500000104",
    role: "client",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "missing-role-phone",
      clientLookup: { phone: "0500000104" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_client:ambiguous_identity");
}));

test("identity ranking chooses candidate linked to bookings when no packages exist", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/booking-rank-a", {
    clientId: "booking-rank-a",
    name: "Booking Rank",
    phone: "0500000105",
  });
  fake.seed("salons/main/clients/booking-rank-b", {
    clientId: "booking-rank-b",
    name: "Booking Rank",
    phone: "0500000105",
  });
  fake.seed("salons/main/bookings/booking-rank-existing", {
    clientId: "booking-rank-b",
    serviceId: "svc-a",
    status: "completed",
  });

  const response = await worker.fetch(request("/api/packages/admin/audit-client-identities?salonId=main", {
    method: "GET",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const group = body.data.identityGroups.find((entry) => entry.canonicalSuggested === "booking-rank-b");
  assert.ok(group, JSON.stringify(body.data.identityGroups));
  assert.equal(group.scores[0].relations.bookingCount, 1);
}));

test("identity ranking returns ambiguous_identity when candidates tie without enough evidence", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/tie-doc-a", {
    clientId: "tie-canonical-a",
    name: "Tie Client",
    phone: "0500000106",
  });
  fake.seed("salons/main/clients/tie-doc-b", {
    clientId: "tie-canonical-b",
    name: "Tie Client",
    phone: "0500000106",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "missing-tie-client",
      clientLookup: { phone: "0500000106" },
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_client:ambiguous_identity");
}));

test("identity audit returns proposed canonical, aliases, scores and relations without writes", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/audit-doc-a", {
    clientId: "audit-canonical-a",
    name: "Audit Client",
    phone: "0500000107",
  });
  fake.seed("salons/main/clients/audit-doc-b", {
    clientId: "audit-canonical-b",
    name: "Audit Client",
    phone: "0500000107",
  });
  fake.seed("salons/main/client_packages/audit-package-b", {
    clientId: "audit-canonical-b",
    packageNameSnapshot: "Audit Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });
  const before = JSON.stringify([...fake.docs.entries()]);

  const response = await worker.fetch(request("/api/packages/admin/audit-client-identities?salonId=main", {
    method: "GET",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const group = body.data.identityGroups.find((row) => row.aliases.includes("audit-canonical-b"));
  assert.equal(group.canonicalSuggested, "audit-canonical-b");
  assert.equal(group.scores.some((row) => row.relations.activePackageCount === 1), true);
  assert.equal(JSON.stringify([...fake.docs.entries()]), before);
}));

test("redemption uses canonical client id and relinks legacy package id", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/canonical-redeem-client", {
    clientId: "canonical-redeem-client",
    legacyClientDocId: "legacy-redeem-client",
    authUid: "redeem-auth-uid",
    name: "Redeem Client",
    phone: "0500000089",
  });
  fake.seed("salons/main/client_packages/legacy-redeem-package", {
    clientId: "legacy-redeem-client",
    packageNameSnapshot: "Legacy Redeem Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "redeem-auth-uid",
      clientLookup: { authUid: "redeem-auth-uid" },
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-16",
      time: "12:00",
      operationId: "legacy-redeem-op",
      cartItemId: "legacy-cart-item",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "canonical-redeem-client");
  assert.equal(body.data.canonicalClientId, "canonical-redeem-client");
  assert.equal(body.data.clientPackageId, "legacy-redeem-package");
  assert.equal(body.data.packageDocumentId, "legacy-redeem-package");
  assert.equal(body.data.beforeRemaining, 1);
  assert.equal(body.data.afterRemaining, 0);
  assert.equal(body.data.redeemedServiceId, "svc-a");
  assert.equal(body.data.cartItemId, "legacy-cart-item");
  const packageDoc = fake.data("salons/main/client_packages/legacy-redeem-package");
  assert.equal(packageDoc.clientId, "canonical-redeem-client");
  assert.equal(packageDoc.legacyClientId, "legacy-redeem-client");
  assert.equal(packageDoc.remainingSessions, 0);
  assert.equal(packageDoc.reservedSessions, 1);
  const booking = fake.data(`salons/main/bookings/${body.data.bookingId}`);
  assert.equal(booking.clientId, "canonical-redeem-client");
}));

test("redemption rejects phone-only client lookup", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/client_packages/phone-only-package", {
    clientId: "client-a",
    packageNameSnapshot: "Phone Only Package",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 3,
    remainingSessions: 3,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    purchasedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-12-31T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "missing-client-id",
      clientLookup: { phone: "0500000001" },
      clientPackageId: "phone-only-package",
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-16",
      time: "13:00",
      operationId: "phone-only-redeem",
      cartItemId: "phone-only-cart",
    },
  }), env());
  const body = await json(response);
  assert.equal(response.status, 404, JSON.stringify(body));
  assert.equal(body.error, "packages_client:not_found");
  const packageDoc = fake.data("salons/main/client_packages/phone-only-package");
  assert.equal(packageDoc.remainingSessions, 3);
  assert.equal(packageDoc.reservedSessions, 0);
}));

test("creates package redemption, prevents slot conflict, consumes and cancels reservation", async () => withFakeFirestore(async (fake) => {
  const sale = await purchase(fake, "sale-flow-1");
  const first = await redeem(sale.clientPackageId, "op-flow-1", "10:00");
  assert.equal(first.canonicalClientId, "client-a");
  assert.equal(first.packageDocumentId, sale.clientPackageId);
  assert.equal(first.beforeRemaining, 10);
  assert.equal(first.afterRemaining, 9);
  assert.equal(first.redeemedServiceId, "svc-a");
  assert.equal(first.cartItemId, "cart-op-flow-1");
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 9);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).reservedSessions, 1);
  assert.equal(fake.paths("salons/main/booking_slots/").length, 1);

  const conflict = await worker.fetch(request("/api/packages/redemption/create", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId: sale.clientPackageId,
      serviceId: "svc-a",
      employeeId: "staff-a",
      date: "2027-05-15",
      time: "10:00",
      operationId: "op-conflict",
    },
  }), env());
  assert.equal(conflict.status, 409);

  fake.patch(`salons/main/bookings/${first.bookingId}`, { status: "completed" });
  const consume = await worker.fetch(request("/api/packages/redemption/consume", {
    body: { salonId: "main", bookingId: first.bookingId },
  }), env());
  assert.equal(consume.status, 200, await consume.text());
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 9);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).reservedSessions, 0);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).usedSessions, 1);

  const second = await redeem(sale.clientPackageId, "op-flow-2", "11:00");
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 8);
  const cancel = await worker.fetch(request("/api/packages/redemption/cancel", {
    body: { salonId: "main", bookingId: second.bookingId, reason: "test cancel" },
  }), env());
  assert.equal(cancel.status, 200, await cancel.text());
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).remainingSessions, 9);
  assert.equal(fake.data(`salons/main/client_packages/${sale.clientPackageId}`).reservedSessions, 0);
}));

test("client wallet is derived from token identity and ignores requested clientId", async () => withFakeFirestore(async (fake) => {
  const sale = await purchase(fake, "wallet-sale-1");
  fake.seed("salons/main/client_packages/other-package", {
    clientId: "client-b",
    packageNameSnapshot: "Other",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
  });

  const response = await worker.fetch(request(`/api/packages/my-wallet?salonId=main&clientId=client-b`, {
    method: "GET",
    token: "test:client1:client",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.clientId, "client-a");
  assert.deepEqual(body.data.packages.map((p) => p.id), [sale.clientPackageId]);
}));

test("admin client package list is restricted to owner and admin roles", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/users/admin1", { role: "admin", active: true });

  const client = await worker.fetch(request("/api/packages/admin/list-client-packages?salonId=main", {
    method: "GET",
    token: "test:client1:client",
  }), env());
  assert.equal(client.status, 403);

  const admin = await worker.fetch(request("/api/packages/admin/list-client-packages?salonId=main", {
    method: "GET",
    token: "test:admin1:admin",
  }), env());
  const body = await json(admin);
  assert.equal(admin.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data, []);
}));

test("admin client package list returns only safe active package fields", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/clients/legacy-client-doc", {
    clientId: "canonical-legacy-client",
    legacyClientDocId: "legacy-client-id",
    name: "Legacy Client",
    phone: "0500000090",
    refreshToken: "do-not-return",
  });
  fake.seed("salons/main/client_packages/visible-package", {
    clientId: "legacy-client-id",
    packageNameSnapshot: "VIP Sessions",
    totalSessions: 5,
    remainingSessions: 3,
    reservedSessions: 1,
    usedSessions: 1,
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
    token: "do-not-return",
  });
  fake.seed("salons/main/client_packages/expired-package", {
    clientId: "client-a",
    packageNameSnapshot: "Expired Sessions",
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2024-01-01T00:00:00.000Z",
  });
  fake.seed("salons/main/client_packages/cancelled-package", {
    clientId: "client-a",
    packageNameSnapshot: "Cancelled Sessions",
    totalSessions: 2,
    remainingSessions: 2,
    reservedSessions: 0,
    usedSessions: 0,
    status: "cancelled",
  });
  const before = JSON.stringify([...fake.docs.entries()]);

  const response = await worker.fetch(request("/api/packages/admin/list-client-packages?salonId=main", {
    method: "GET",
  }), env());
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.deepEqual(body.data, [{
    clientName: "Legacy Client",
    phone: "0500000090",
    canonicalClientId: "canonical-legacy-client",
    packageName: "VIP Sessions",
    totalSessions: 5,
    remainingSessions: 3,
    usedSessions: 1,
    reservedSessions: 1,
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }]);
  assert.deepEqual(Object.keys(body.data[0]), [
    "clientName",
    "phone",
    "canonicalClientId",
    "packageName",
    "totalSessions",
    "remainingSessions",
    "usedSessions",
    "reservedSessions",
    "status",
    "expiresAt",
  ]);
  assert.equal(JSON.stringify([...fake.docs.entries()]), before);
}));

test("failed Firestore commit does not leave partial purchase docs in fake store", async () => withFakeFirestore(async (fake) => {
  fake.failNextCommit = true;
  const response = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "commit-fail",
    },
  }), env());
  assert.equal(response.status, 500);
  assert.equal(fake.paths("salons/main/client_packages/").length, 0);
  assert.equal(fake.paths("salons/main/invoices/").length, 0);
}));

test("cron expires active packages without touching future packages", async () => withFakeFirestore(async (fake) => {
  fake.seed("salons/main/client_packages/expired-package", {
    clientId: "client-a",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2024-01-01T00:00:00.000Z",
  });
  fake.seed("salons/main/client_packages/future-package", {
    clientId: "client-a",
    allowedServiceIdsSnapshot: ["svc-a"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const result = await expireClientPackages(env());
  assert.equal(result.ok, true);
  assert.equal(fake.data("salons/main/client_packages/expired-package").status, "expired");
  assert.equal(fake.data("salons/main/client_packages/future-package").status, "active");
}));

test("D1 health endpoint verifies packages database binding", async () => {
  const fake = new FakeD1();
  const response = await worker.fetch(new Request("http://worker.test/api/packages/health?salonId=main", {
    method: "GET",
  }), envD1(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.storage, "d1");
});

test("client-wallet reads active packages from D1 without Firestore", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("client_packages", {
    id: "pkg-d1-wallet",
    salon_id: "main",
    canonical_client_id: "legacy-client-a",
    package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10",
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: 10,
    remaining_sessions: 7,
    reserved_sessions: 1,
    used_sessions: 2,
    status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z",
    expires_at: "2028-01-01T00:00:00.000Z",
    invoice_id: "invoice-d1-wallet",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "legacy-client-a",
      clientLookup: { phone: "0500000001" },
    },
  }), envD1(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "client-a");
  assert.equal(body.data.activePackageCount, 1);
  assert.equal(body.data.totalRemainingSessions, 7);
});

test("D1 purchase writes client package and transaction idempotently", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);

  const first = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "d1-invoice-1",
    },
  }), envD1(fake));
  const firstBody = await json(first);
  assert.equal(first.status, 200, JSON.stringify(firstBody));
  assert.equal(fake.rows("client_packages").length, 1);
  assert.equal(fake.rows("package_transactions").length, 1);

  const second = await worker.fetch(request("/api/packages/purchase", {
    body: {
      salonId: "main",
      clientId: "client-a",
      packageCatalogId: "blowdry-10",
      paymentMethod: "cash",
      invoiceId: "d1-invoice-1",
    },
  }), envD1(fake));
  const secondBody = await json(second);
  assert.equal(second.status, 200, JSON.stringify(secondBody));
  assert.equal(secondBody.data.idempotent, true);
  assert.equal(fake.rows("client_packages").length, 1);
  assert.equal(fake.rows("package_transactions").length, 1);
});

test("D1 redeem atomically consumes one remaining session", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("client_packages", {
    id: "pkg-d1-redeem",
    salon_id: "main",
    canonical_client_id: "client-a",
    package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10",
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: 2,
    remaining_sessions: 2,
    reserved_sessions: 0,
    used_sessions: 0,
    status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z",
    expires_at: "2028-01-01T00:00:00.000Z",
    invoice_id: "invoice-d1-redeem",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId: "pkg-d1-redeem",
      serviceId: "svc-a",
      operationId: "d1-redeem-op",
      cartItemId: "cart-d1-redeem",
    },
  }), envD1(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "client-a");
  assert.equal(body.data.packageDocumentId, "pkg-d1-redeem");
  assert.equal(body.data.beforeRemaining, 2);
  assert.equal(body.data.afterRemaining, 1);
  assert.equal(body.data.redeemedServiceId, "svc-a");
  assert.equal(fake.rows("client_packages")[0].remaining_sessions, 1);
  assert.equal(fake.rows("client_packages")[0].used_sessions, 1);
});

test("D1 duplicate phone lookup returns ambiguity instead of selecting randomly", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("clients", {
    canonical_client_id: "client-b",
    salon_id: "main",
    name: "Client B",
    phone_normalized: "0500000001",
    firebase_uid: "",
    legacy_ids_json: "[]",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: {
      salonId: "main",
      clientId: "",
      clientLookup: { phone: "0500000001" },
    },
  }), envD1(fake));
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_client:ambiguous_identity");
});

test("D1 redeem rejects insufficient sessions and leaves balance unchanged", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("client_packages", {
    id: "pkg-d1-empty",
    salon_id: "main",
    canonical_client_id: "client-a",
    package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10",
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: 1,
    remaining_sessions: 0,
    reserved_sessions: 0,
    used_sessions: 1,
    status: "exhausted",
    purchased_at: "2027-01-01T00:00:00.000Z",
    expires_at: "2028-01-01T00:00:00.000Z",
    invoice_id: "invoice-d1-empty",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId: "pkg-d1-empty",
      serviceId: "svc-a",
      operationId: "d1-empty-op",
    },
  }), envD1(fake));
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "package_balance:not_active");
  assert.equal(fake.rows("package_transactions").length, 0);
});

test("D1 sequential concurrent redeem attempts cannot over-consume one session", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("client_packages", {
    id: "pkg-d1-one",
    salon_id: "main",
    canonical_client_id: "client-a",
    package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10",
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: 1,
    remaining_sessions: 1,
    reserved_sessions: 0,
    used_sessions: 0,
    status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z",
    expires_at: "2028-01-01T00:00:00.000Z",
    invoice_id: "invoice-d1-one",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const first = await worker.fetch(request("/api/packages/redeem", {
    body: { salonId: "main", clientId: "client-a", clientPackageId: "pkg-d1-one", serviceId: "svc-a", operationId: "d1-one-a" },
  }), envD1(fake));
  const second = await worker.fetch(request("/api/packages/redeem", {
    body: { salonId: "main", clientId: "client-a", clientPackageId: "pkg-d1-one", serviceId: "svc-a", operationId: "d1-one-b" },
  }), envD1(fake));
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  const row = fake.rows("client_packages")[0];
  assert.equal(row.remaining_sessions, 0);
  assert.equal(row.used_sessions, 1);
});

test("D1 admin list exposes only safe package fields", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("client_packages", {
    id: "pkg-d1-admin",
    salon_id: "main",
    canonical_client_id: "client-a",
    package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10",
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: 10,
    remaining_sessions: 8,
    reserved_sessions: 1,
    used_sessions: 1,
    status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z",
    expires_at: "2028-01-01T00:00:00.000Z",
    invoice_id: "invoice-d1-admin",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/admin/list-client-packages", {
    method: "GET",
  }), envD1(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(Object.keys(body.data[0]), [
    "clientName",
    "phone",
    "canonicalClientId",
    "packageName",
    "totalSessions",
    "remainingSessions",
    "usedSessions",
    "reservedSessions",
    "status",
    "expiresAt",
  ]);
});

test("D1 cron expires active packages without Firestore", async () => {
  const fake = new FakeD1();
  seedD1Base(fake);
  fake.seed("client_packages", {
    id: "pkg-d1-expired",
    salon_id: "main",
    canonical_client_id: "client-a",
    package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10",
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: 1,
    remaining_sessions: 1,
    reserved_sessions: 0,
    used_sessions: 0,
    status: "active",
    purchased_at: "2024-01-01T00:00:00.000Z",
    expires_at: "2024-01-01T00:00:00.000Z",
    invoice_id: "invoice-d1-expired",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  });
  const result = await __testD1.expireClientPackagesD1(envD1(fake));
  assert.equal(result.storage, "d1");
  assert.equal(result.expired, 1);
  assert.equal(fake.rows("client_packages")[0].status, "expired");
});
