import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./core/index.js";

class FakeD1 {
  constructor() {
    this.__fakeD1 = true;
    this.tables = {
      contact_messages: new Map(),
      roles: new Map(),
      permissions: new Map(),
      role_permissions: new Map(),
      app_users: new Map(),
      user_permissions: new Map(),
      user_employee_links: new Map(),
    };
    this.seedIdentity();
  }

  key(table, row) {
    if (table === "roles") return `${row.salon_id}\u0000${row.role_key}`;
    if (table === "role_permissions") return `${row.salon_id}\u0000${row.role_key}\u0000${row.permission_key}`;
    if (table === "user_employee_links") return `${row.salon_id}\u0000${row.id}`;
    if (table === "user_permissions") return `${row.salon_id}\u0000${row.user_id}\u0000${row.permission_key}\u0000${row.effect}`;
    return `${row.salon_id}\u0000${row.id}`;
  }

  seed(table, row) {
    this.tables[table].set(this.key(table, row), { ...row });
  }

  rows(table) {
    return [...this.tables[table].values()].map((row) => ({ ...row }));
  }

  find(table, salonId, id) {
    return this.rows(table).find((row) => row.salon_id === salonId && row.id === id) || null;
  }

  seedIdentity() {
    const now = "2027-01-01T00:00:00.000Z";
    for (const [role_key, rank] of [
      ["owner", 100],
      ["admin", 80],
      ["guest", 0],
    ]) {
      this.seed("roles", {
        id: role_key,
        salon_id: "main",
        role_key,
        label: role_key,
        rank,
        protected: role_key === "owner" ? 1 : 0,
        assignable: role_key !== "guest" ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
    }
    for (const [id, firebase_uid, email, display_name, primary_role] of [
      ["user-owner1", "owner1", "owner@example.com", "Owner", "owner"],
      ["user-admin1", "admin1", "admin@example.com", "Admin", "admin"],
    ]) {
      this.seed("app_users", {
        id,
        firebase_uid,
        salon_id: "main",
        email,
        phone: null,
        display_name,
        primary_role,
        status: "active",
        email_verified: 1,
        last_login_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        legacy_source: "test",
        legacy_id: null,
      });
    }
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ?")) {
      const [salonId, uid] = params;
      return this.rows("app_users").filter((row) => row.salon_id === salonId && row.firebase_uid === uid);
    }
    if (normalized.startsWith("SELECT permission_key FROM role_permissions WHERE salon_id = ? AND role_key = ?")) {
      const [salonId, roleKey] = params;
      return this.rows("role_permissions")
        .filter((row) => row.salon_id === salonId && row.role_key === roleKey)
        .map((row) => ({ permission_key: row.permission_key }));
    }
    if (normalized.startsWith("SELECT permission_key, effect FROM user_permissions WHERE salon_id = ? AND user_id = ?")) {
      const [salonId, userId] = params;
      return this.rows("user_permissions").filter((row) => row.salon_id === salonId && row.user_id === userId);
    }
    if (normalized.includes("FROM user_employee_links") && normalized.includes("firebase_uid")) {
      return [];
    }
    if (
      normalized.includes("FROM user_employee_links l") &&
      normalized.includes("LEFT JOIN employee_profiles") &&
      normalized.includes("l.user_id = ?")
    ) {
      return [];
    }
    if (normalized.startsWith("SELECT * FROM contact_messages WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("contact_messages", salonId, id);
      return row ? [row] : [];
    }
    if (
      normalized.startsWith("SELECT * FROM contact_messages WHERE salon_id = ?") &&
      normalized.includes("ORDER BY created_at DESC")
    ) {
      const [salonId, limit] = params;
      return this.rows("contact_messages")
        .filter((row) => row.salon_id === salonId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, Number(limit));
    }

    throw new Error(`unhandled fake D1 all: ${normalized}`);
  }

  async run(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("UPDATE app_users SET last_login_at = ?")) {
      return { meta: { changes: 1 } };
    }

    if (normalized.startsWith("INSERT INTO contact_messages")) {
      const [salon_id, id, name, email, phone, subject, message, source, created_at] = params;
      this.seed("contact_messages", {
        salon_id,
        id,
        name,
        email,
        phone,
        subject,
        message,
        source,
        status: "new",
        created_at,
        read_at: null,
      });
      return { meta: { changes: 1 } };
    }

    if (
      normalized.startsWith("UPDATE contact_messages SET status = 'read', read_at = ?") ||
      normalized.startsWith("UPDATE contact_messages SET status = 'read', read_at = ? WHERE salon_id = ? AND id = ?")
    ) {
      const [read_at, salonId, id] = params;
      const row = this.find("contact_messages", salonId, id);
      if (!row) return { meta: { changes: 0 } };
      this.seed("contact_messages", { ...row, status: "read", read_at });
      return { meta: { changes: 1 } };
    }

    throw new Error(`unhandled fake D1 run: ${normalized}`);
  }

  async batch() {
    throw new Error("batch not used by contact-messages tests");
  }
}

function env(fake) {
  return {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    CORE_DB: fake,
  };
}

function request(path, { method = "GET", token = "test:owner1:owner", body } = {}) {
  return new Request(`http://worker.test${path}`, {
    method,
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
}

test("guest POST creates contact message with status new", async () => {
  const fake = new FakeD1();
  const response = await worker.fetch(
    request("/api/core/contact-messages", {
      method: "POST",
      token: "",
      body: {
        name: "Nawaf",
        email: "nawaf@example.com",
        phone: "0500000000",
        subject: "Hello",
        message: "Please call me",
      },
    }),
    env(fake)
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "new");
  assert.equal(body.data.name, "Nawaf");
  assert.equal(body.data.email, "nawaf@example.com");
  assert.equal(body.data.phone, "0500000000");
  assert.equal(body.data.subject, "Hello");
  assert.equal(body.data.message, "Please call me");
  assert.equal(body.data.source, "contact_page");
  assert.ok(body.data.id);
  assert.ok(body.data.createdAt);
  assert.equal(body.data.readAt, null);
  assert.equal(fake.rows("contact_messages").length, 1);
});

test("guest GET contact-messages is rejected", async () => {
  const fake = new FakeD1();
  const response = await worker.fetch(
    request("/api/core/contact-messages?limit=20", { token: "" }),
    env(fake)
  );
  const body = await response.json();
  assert.ok([401, 403].includes(response.status), JSON.stringify(body));
});

test("admin GET lists newest first with limit", async () => {
  const fake = new FakeD1();
  fake.seed("contact_messages", {
    salon_id: "main",
    id: "contact_old",
    name: "Old",
    email: "old@example.com",
    phone: "",
    subject: "",
    message: "older",
    source: "contact_page",
    status: "new",
    created_at: "2026-01-01T00:00:00.000Z",
    read_at: null,
  });
  fake.seed("contact_messages", {
    salon_id: "main",
    id: "contact_new",
    name: "New",
    email: "new@example.com",
    phone: "",
    subject: "",
    message: "newer",
    source: "contact_page",
    status: "new",
    created_at: "2026-02-01T00:00:00.000Z",
    read_at: null,
  });
  fake.seed("contact_messages", {
    salon_id: "main",
    id: "contact_mid",
    name: "Mid",
    email: "mid@example.com",
    phone: "",
    subject: "",
    message: "middle",
    source: "contact_page",
    status: "new",
    created_at: "2026-01-15T00:00:00.000Z",
    read_at: null,
  });

  const response = await worker.fetch(
    request("/api/core/contact-messages?limit=2", { token: "test:admin1:admin" }),
    env(fake)
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.length, 2);
  assert.deepEqual(
    body.data.map((row) => row.id),
    ["contact_new", "contact_mid"]
  );
});

test("admin PATCH marks contact message read and sets readAt", async () => {
  const fake = new FakeD1();
  fake.seed("contact_messages", {
    salon_id: "main",
    id: "contact_patch",
    name: "Patch",
    email: "patch@example.com",
    phone: "",
    subject: "Sub",
    message: "Body",
    source: "contact_page",
    status: "new",
    created_at: "2026-03-01T00:00:00.000Z",
    read_at: null,
  });

  const response = await worker.fetch(
    request("/api/core/contact-messages/contact_patch", {
      method: "PATCH",
      token: "test:admin1:admin",
      body: { status: "read" },
    }),
    env(fake)
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.id, "contact_patch");
  assert.equal(body.data.status, "read");
  assert.ok(body.data.readAt);
  assert.equal(fake.find("contact_messages", "main", "contact_patch")?.status, "read");
  assert.ok(fake.find("contact_messages", "main", "contact_patch")?.read_at);
});
