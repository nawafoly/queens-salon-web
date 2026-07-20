import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker, { __test } from "./packages/index.js";

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

  prepare(sql) {
    const statement = {
      sql,
      params: [],
      bind: (...params) => { statement.params = params; return statement; },
      first: () => this.first(statement.sql, statement.params),
      all: () => this.all(statement.sql, statement.params),
      run: () => this.run(statement.sql, statement.params),
    };
    return statement;
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized === "SELECT 1 AS ok") return [{ ok: 1 }];
    if (normalized.startsWith("SELECT alias_id FROM client_identity_aliases")) {
      const [salonId, canonicalClientId] = params;
      return this.rows("client_identity_aliases")
        .filter((row) => row.salon_id === salonId && row.canonical_client_id === canonicalClientId)
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
      return this.rows("clients").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM client_identity_aliases WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("client_identity_aliases").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM package_catalog WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.rows("package_catalog").filter((row) => row.salon_id === salonId && row.id === id && Number(row.active) === 1).slice(0, 1);
    }
    if (normalized.startsWith("SELECT reserved_sessions FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1")) {
      const [salonId, id] = params;
      return this.rows("client_packages").filter((row) => row.salon_id === salonId && row.id === id).slice(0, 1).map((row) => ({ reserved_sessions: row.reserved_sessions }));
    }
    if (normalized.startsWith("SELECT * FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1")) {
      const [salonId, id] = params;
      return this.rows("client_packages").filter((row) => row.salon_id === salonId && row.id === id).slice(0, 1);
    }
    if (normalized.startsWith("SELECT id FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1")) {
      const [salonId, id] = params;
      return this.rows("client_packages").filter((row) => row.salon_id === salonId && row.id === id).slice(0, 1).map((row) => ({ id: row.id }));
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
      return this.rows("client_packages").filter((row) => row.salon_id === salonId && clientIds.includes(row.canonical_client_id));
    }
    if (normalized.startsWith("SELECT * FROM package_transactions WHERE id = ?")) {
      const [id] = params;
      return this.rows("package_transactions").filter((row) => row.id === id).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM package_transactions WHERE salon_id = ? AND canonical_client_id IN")) {
      const [salonId, ...clientIds] = params;
      return this.rows("package_transactions").filter((row) => row.salon_id === salonId && clientIds.includes(row.canonical_client_id));
    }
    if (normalized.startsWith("SELECT cp.*, c.name AS client_name")) {
      const [salonId] = params;
      const activeOnly = normalized.includes("cp.status = 'active'");
      return this.rows("client_packages")
        .filter((row) => row.salon_id === salonId && (!activeOnly || row.status === "active"))
        .map((row) => {
          const client = this.rows("clients").find((item) => item.salon_id === row.salon_id && item.canonical_client_id === row.canonical_client_id) || {};
          return { ...row, client_name: client.name || "", client_phone: client.phone_normalized || "" };
        });
    }
    if (normalized.startsWith("SELECT pt.*, cp.package_name_snapshot")) {
      const [salonId] = params;
      return this.rows("package_transactions")
        .filter((row) => row.salon_id === salonId)
        .map((row) => {
          const pkg = this.rows("client_packages").find((item) => item.salon_id === row.salon_id && item.id === row.client_package_id) || {};
          const client = this.rows("clients").find((item) => item.salon_id === row.salon_id && item.canonical_client_id === row.canonical_client_id) || {};
          return { ...row, package_name_snapshot: pkg.package_name_snapshot || "", client_name: client.name || "", client_phone: client.phone_normalized || "" };
        })
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
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
      } else if (sql.startsWith("INSERT INTO package_transactions") && !sql.includes(" WHERE EXISTS ")) {
        const [id, salon_id, client_package_id, canonical_client_id, sessions_delta, remaining_after, invoice_id, created_at] = params;
        this.seed("package_transactions", {
          id, salon_id, client_package_id, canonical_client_id, type: "purchase", sessions_delta,
          remaining_before: 0, remaining_after, reserved_before: 0, reserved_after: 0,
          used_before: 0, used_after: 0, service_id: null, booking_id: null, cart_item_id: null,
          invoice_id, created_at,
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
      } else if (sql.startsWith("DELETE FROM package_transactions WHERE client_package_id = ?")) {
        const [clientPackageId] = params;
        let changes = 0;
        for (const row of this.rows("package_transactions")) {
          if (row.client_package_id !== clientPackageId) continue;
          this.tables.package_transactions.delete(row.id);
          changes += 1;
        }
        results.push({ meta: { changes } });
      } else if (sql.startsWith("DELETE FROM client_packages WHERE salon_id = ? AND id = ?")) {
        const [salonId, id] = params;
        const row = this.rows("client_packages").find((item) => item.salon_id === salonId && item.id === id);
        if (row) this.tables.client_packages.delete(row.id);
        results.push({ meta: { changes: row ? 1 : 0 } });
      } else {
        throw new Error(`unhandled fake D1 batch: ${sql}`);
      }
    }
    return results;
  }
}

function env(fake) {
  return {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    PACKAGES_DB: fake,
  };
}

function request(path, { method = "POST", token = "test:owner1:owner", body } = {}) {
  return new Request(`http://worker.test${path}`, {
    method,
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });
}

function seedBase(fake) {
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

async function json(response) {
  return response.json();
}



function coreAuthDb({ accounts = [], rolePermissions = [], userPermissions = [], links = [], permissions = [] } = {}) {
  return {
    prepare(sql) {
      const statement = {
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() {
          const normalized = sql.replace(/\s+/g, " ").trim();
          if (normalized.startsWith("SELECT * FROM app_users")) {
            const [salonId, uid] = this.params;
            return accounts.find((row) => row.salon_id === salonId && row.firebase_uid === uid) || null;
          }
          if (normalized.startsWith("SELECT * FROM user_employee_links")) {
            const [salonId, userId] = this.params;
            return links.find((row) => row.salon_id === salonId && row.user_id === userId && row.link_status === "active") || null;
          }
          throw new Error(`Unhandled auth first(): ${normalized}`);
        },
        async all() {
          const normalized = sql.replace(/\s+/g, " ").trim();
          if (normalized.startsWith("SELECT permission_key FROM permissions")) {
            return { results: permissions.map((permission_key) => ({ permission_key })) };
          }
          if (normalized.startsWith("SELECT permission_key FROM role_permissions")) {
            const [salonId, role] = this.params;
            return { results: rolePermissions.filter((row) => row.salon_id === salonId && row.role_key === role) };
          }
          if (normalized.startsWith("SELECT permission_key, effect FROM user_permissions")) {
            const [salonId, userId] = this.params;
            return { results: userPermissions.filter((row) => row.salon_id === salonId && row.user_id === userId) };
          }
          throw new Error(`Unhandled auth all(): ${normalized}`);
        },
      };
      return statement;
    },
  };
}

function activeAccount(uid, role = "client", overrides = {}) {
  return {
    id: `account-${uid}`,
    salon_id: "main",
    firebase_uid: uid,
    primary_role: role,
    status: "active",
    deleted_at: null,
    ...overrides,
  };
}

test("actor role is loaded from Core D1 and ignores token role claims", async () => {
  __test.clearActorRoleCache();
  const CORE_DB = coreAuthDb({ accounts: [activeAccount("d1-admin", "admin")] });
  const role = await __test.resolveActorRole(
    { CORE_DB },
    "main",
    { uid: "d1-admin", email: "admin@example.com", claims: { role: "client" }, idToken: "verified-id-token" }
  );
  assert.equal(role, "admin");
});

test("bootstrap owner emails no longer bypass Core D1 authorization", async () => {
  __test.clearActorRoleCache();
  const CORE_DB = coreAuthDb({ accounts: [activeAccount("known-client", "client")] });
  const role = await __test.resolveActorRole(
    { CORE_DB },
    "main",
    { uid: "known-client", email: "nawafaaa0@gmail.com", claims: { role: "owner" }, idToken: "verified-id-token" }
  );
  assert.equal(role, "client");
});

test("unprovisioned package user is rejected instead of falling back to client", async () => {
  __test.clearActorRoleCache();
  await assert.rejects(
    () => __test.resolveActorRole(
      { CORE_DB: coreAuthDb() },
      "main",
      { uid: "missing-user", email: "missing@example.com", claims: { role: "owner" }, idToken: "verified-id-token" }
    ),
    (error) => error?.status === 403 && error?.code === "ACCOUNT_NOT_PROVISIONED"
  );
});

test("disabled package account is rejected from Core D1", async () => {
  __test.clearActorRoleCache();
  const CORE_DB = coreAuthDb({ accounts: [activeAccount("disabled-user", "staff", { status: "disabled" })] });
  await assert.rejects(
    () => __test.resolveActorRole(
      { CORE_DB },
      "main",
      { uid: "disabled-user", claims: {}, idToken: "verified-id-token" }
    ),
    (error) => error?.status === 403 && error?.code === "ACCOUNT_DISABLED"
  );
});

test("package authorization never performs Firestore profile lookup", async () => {
  __test.clearActorRoleCache();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected external lookup"); };
  try {
    const role = await __test.resolveActorRole(
      { CORE_DB: coreAuthDb({ accounts: [activeAccount("staff-user", "staff")] }) },
      "main",
      { uid: "staff-user", claims: {}, idToken: "verified-id-token" }
    );
    assert.equal(role, "staff");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("packages operational path passes D1-only guard", () => {
  const result = spawnSync(process.execPath, ["scripts/check-packages-d1-only.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("package migration dry-run uses shared package-backed client canonicalization", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-session-packages-firestore-to-d1.mjs",
    "--input=scripts/fixtures/client-canonicalization-regression-fixture.json",
    "--today=2026-07-16",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /blockingConflicts = 0/);
  assert.match(result.stdout, /pkg-rodina/);
  assert.match(result.stdout, /3be178a6-dacb-5407-aca0-1215f403631e/);
  assert.match(result.stdout, /pkg-ghada/);
  assert.match(result.stdout, /78967b2b-d2d1-4260-adac-95fac142ee9d/);
});

test("package endpoints fail clearly when D1 binding is missing", async () => {
  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: { salonId: "main", clientId: "client-a" },
  }), {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
  });
  const body = await json(response);
  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.error, "packages_d1:not_configured");
});

test("D1 health endpoint verifies packages database binding", async () => {
  const fake = new FakeD1();
  const response = await worker.fetch(new Request("http://worker.test/api/packages/health?salonId=main", {
    method: "GET",
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.storage, "d1");
});

test("signed-in client without a packages identity receives an empty wallet instead of 404", async () => {
  __test.clearActorRoleCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "not found" } }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
  try {
    const fake = new FakeD1();
    const response = await worker.fetch(request("/api/packages/my-wallet?salonId=main", {
      method: "GET",
      token: "test:new-client-uid:client",
    }), env(fake));
    const body = await json(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.canonicalClientId, "new-client-uid");
    assert.deepEqual(body.data.packages, []);
    assert.equal(fake.rows("clients").length, 1);
    assert.equal(fake.rows("clients")[0].firebase_uid, "new-client-uid");
  } finally {
    globalThis.fetch = originalFetch;
    __test.clearActorRoleCache();
  }
});

test("client wallet reads active packages from D1", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-wallet",
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
    invoice_id: "invoice-wallet",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });
  const response = await worker.fetch(request("/api/packages/client-wallet", {
    body: { salonId: "main", clientId: "legacy-client-a", clientLookup: { phone: "0500000001" } },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.canonicalClientId, "client-a");
  assert.equal(body.data.activePackageCount, 1);
  assert.equal(body.data.totalRemainingSessions, 7);
});

test("D1 purchase is idempotent", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  const payload = {
    salonId: "main",
    clientId: "client-a",
    packageCatalogId: "blowdry-10",
    paymentMethod: "cash",
    invoiceId: "invoice-idem",
  };
  const first = await worker.fetch(request("/api/packages/purchase", { body: payload }), env(fake));
  const firstBody = await json(first);
  assert.equal(first.status, 200, JSON.stringify(firstBody));
  const second = await worker.fetch(request("/api/packages/purchase", { body: payload }), env(fake));
  const secondBody = await json(second);
  assert.equal(second.status, 200, JSON.stringify(secondBody));
  assert.equal(secondBody.data.idempotent, true);
  assert.equal(fake.rows("client_packages").length, 1);
  assert.equal(fake.rows("package_transactions").length, 1);
});

test("D1 redeem consumes one remaining session atomically", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-redeem",
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
    invoice_id: "invoice-redeem",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });
  const response = await worker.fetch(request("/api/packages/redeem", {
    body: {
      salonId: "main",
      clientId: "client-a",
      clientPackageId: "pkg-redeem",
      serviceId: "svc-a",
      operationId: "redeem-op",
      cartItemId: "cart-redeem",
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.beforeRemaining, 2);
  assert.equal(body.data.afterRemaining, 1);
  assert.equal(fake.rows("client_packages")[0].used_sessions, 1);
});

test("D1 duplicate phone lookup returns ambiguous identity", async () => {
  const fake = new FakeD1();
  seedBase(fake);
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
    body: { salonId: "main", clientId: "", clientLookup: { phone: "0500000001" } },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_client:ambiguous_identity");
});

test("D1 concurrent-style sequential redeem cannot over-consume one session", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-one",
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
    invoice_id: "invoice-one",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });
  const first = await worker.fetch(request("/api/packages/redeem", {
    body: { salonId: "main", clientId: "client-a", clientPackageId: "pkg-one", serviceId: "svc-a", operationId: "one-a" },
  }), env(fake));
  const second = await worker.fetch(request("/api/packages/redeem", {
    body: { salonId: "main", clientId: "client-a", clientPackageId: "pkg-one", serviceId: "svc-a", operationId: "one-b" },
  }), env(fake));
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(fake.rows("client_packages")[0].remaining_sessions, 0);
});

test("D1 admin list exposes only safe package fields", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-admin",
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
    invoice_id: "invoice-admin",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });
  const response = await worker.fetch(request("/api/packages/admin/list-client-packages", { method: "GET" }), env(fake));
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

test("D1 admin session dashboard returns package summary and ledger", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-dashboard", salon_id: "main", canonical_client_id: "client-a", package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10", allowed_service_ids_json: JSON.stringify(["svc-a"]), total_sessions: 10,
    remaining_sessions: 7, reserved_sessions: 1, used_sessions: 2, status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", invoice_id: "invoice-dashboard",
    created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-02T00:00:00.000Z",
  });
  fake.seed("package_transactions", {
    id: "tx-dashboard", salon_id: "main", client_package_id: "pkg-dashboard", canonical_client_id: "client-a",
    type: "reserve", sessions_delta: -1, remaining_before: 8, remaining_after: 7, reserved_before: 0, reserved_after: 1,
    used_before: 2, used_after: 2, service_id: "svc-a", booking_id: "MK-10423", cart_item_id: "item-a", invoice_id: "invoice-dashboard",
    created_at: "2027-01-02T00:00:00.000Z",
  });
  const response = await worker.fetch(request("/api/packages/admin/session-dashboard", { method: "GET" }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.summary.subscribedClients, 1);
  assert.equal(body.data.summary.activePackages, 1);
  assert.equal(body.data.summary.totalRemainingSessions, 7);
  assert.equal(body.data.packages[0].id, "pkg-dashboard");
  assert.equal(body.data.transactions[0].bookingId, "MK-10423");
});



test("D1 admin session dashboard accepts compatibility alias and trailing slash", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  const aliasResponse = await worker.fetch(request("/api/packages/session-dashboard", { method: "GET" }), env(fake));
  assert.equal(aliasResponse.status, 200, JSON.stringify(await json(aliasResponse.clone())));
  const slashResponse = await worker.fetch(request("/api/packages/admin/session-dashboard/", { method: "GET" }), env(fake));
  assert.equal(slashResponse.status, 200, JSON.stringify(await json(slashResponse.clone())));
});


test("D1 admin deletes a package and all of its ledger rows", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-delete", salon_id: "main", canonical_client_id: "client-a", package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10", allowed_service_ids_json: JSON.stringify(["svc-a"]), total_sessions: 10,
    remaining_sessions: 8, reserved_sessions: 0, used_sessions: 2, status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", invoice_id: "invoice-delete",
    created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-02T00:00:00.000Z",
  });
  fake.seed("package_transactions", {
    id: "tx-delete", salon_id: "main", client_package_id: "pkg-delete", canonical_client_id: "client-a",
    type: "purchase", sessions_delta: 10, remaining_before: 0, remaining_after: 10, reserved_before: 0,
    reserved_after: 0, used_before: 0, used_after: 0, service_id: null, booking_id: null,
    cart_item_id: null, invoice_id: "invoice-delete", created_at: "2027-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch(request("/api/packages/admin/client-package?salonId=main&clientPackageId=pkg-delete", {
    method: "DELETE",
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.deleted, true);
  assert.equal(fake.rows("client_packages").some((row) => row.id === "pkg-delete"), false);
  assert.equal(fake.rows("package_transactions").some((row) => row.client_package_id === "pkg-delete"), false);
});

test("D1 admin refuses to delete a package with reserved sessions", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-reserved", salon_id: "main", canonical_client_id: "client-a", package_catalog_id: "blowdry-10",
    package_name_snapshot: "Blowdry 10", allowed_service_ids_json: JSON.stringify(["svc-a"]), total_sessions: 10,
    remaining_sessions: 8, reserved_sessions: 1, used_sessions: 1, status: "active",
    purchased_at: "2027-01-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", invoice_id: "invoice-reserved",
    created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-02T00:00:00.000Z",
  });
  const response = await worker.fetch(request("/api/packages/admin/delete-client-package", {
    body: { salonId: "main", clientPackageId: "pkg-reserved" },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "packages_d1:package_has_reserved_sessions");
  assert.equal(fake.rows("client_packages").some((row) => row.id === "pkg-reserved"), true);
});

test("D1 cron expires active packages", async () => {
  const fake = new FakeD1();
  seedBase(fake);
  fake.seed("client_packages", {
    id: "pkg-expired",
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
    invoice_id: "invoice-expired",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  });
  const result = await __test.__testD1.expireClientPackagesD1(env(fake));
  assert.equal(result.storage, "d1");
  assert.equal(result.expired, 1);
});

test("package worker source contains multi-item booking session state transitions", () => {
  const routesSource = readFileSync("workers/packages/routes.js", "utf8");
  const d1Source = readFileSync("workers/packages/d1.js", "utf8");

  assert.match(routesSource, /POST \/api\/packages\/redemption\/reapply/);
  assert.match(d1Source, /async function bookingSessionLedger/);
  assert.match(d1Source, /for \(const source of ledger\.sources\)/);
  assert.match(d1Source, /consumeReservedD1/);
  assert.match(d1Source, /restoreBookingSessionD1/);
  assert.match(d1Source, /reapplyBookingSessionD1/);
  assert.match(d1Source, /reason/);
  assert.match(d1Source, /created_by_uid/);
});
