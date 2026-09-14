import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./core/index.js";

class FakeD1 {
  constructor() {
    this.__fakeD1 = true;
    this.tables = {
      testimonials: new Map(),
      employee_profiles: new Map(),
      staff: new Map(),
      employee_employment: new Map(),
      bookings: new Map(),
      roles: new Map(),
      permissions: new Map(),
      role_permissions: new Map(),
      app_users: new Map(),
      user_permissions: new Map(),
      user_employee_links: new Map(),
      clients: new Map(),
      client_aliases: new Map(),
      audit_logs: new Map(),
    };
    this.seedIdentity();
  }

  key(table, row) {
    if (table === "roles") return `${row.salon_id}\u0000${row.role_key}`;
    if (table === "role_permissions") {
      return `${row.salon_id}\u0000${row.role_key}\u0000${row.permission_key}`;
    }
    if (table === "user_permissions") {
      return `${row.salon_id}\u0000${row.user_id}\u0000${row.permission_key}\u0000${row.effect}`;
    }
    if (table === "user_employee_links") return `${row.salon_id}\u0000${row.id}`;
    if (table === "client_aliases") return `${row.salon_id}\u0000${row.alias_id}`;
    if (table === "employee_employment") return `${row.salon_id}\u0000${row.employee_id}`;
    return `${row.salon_id}\u0000${row.id}`;
  }

  seed(table, row) {
    if (!this.tables[table]) this.tables[table] = new Map();
    this.tables[table].set(this.key(table, row), { ...row });
  }

  rows(table) {
    return [...(this.tables[table]?.values() || [])].map((row) => ({ ...row }));
  }

  find(table, salonId, id) {
    return this.rows(table).find((row) => row.salon_id === salonId && row.id === id) || null;
  }

  seedIdentity() {
    const now = "2027-01-01T00:00:00.000Z";
    for (const [role_key, rank] of [
      ["owner", 100],
      ["admin", 80],
      ["client", 10],
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
      ["user-client1", "client1", "client1@test.local", "Client One", "client"],
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
    this.seed("clients", {
      id: "client-row-1",
      salon_id: "main",
      name: "Client One",
      phone_normalized: "0500000001",
      email: "client1@test.local",
      firebase_uid: "client1",
      status: "active",
      notes: null,
      vip: 0,
      legacy_client_doc_id: null,
      city: "",
      birthdate: "",
      avatar_url: "",
      membership_id: "client-2027-client",
      membership_percent: 0,
      created_at: now,
      updated_at: now,
    });
    this.seed("employee_profiles", {
      id: "staff-1",
      salon_id: "main",
      firebase_uid: null,
      name: "Aisha",
      email: null,
      phone_normalized: null,
      avatar_file_id: null,
      status: "active",
      created_at: now,
      updated_at: now,
      avatar_url: "/assets/aisha.webp",
      bio: "Hair expert",
      cv_url: "",
      show_on_about: 1,
      include_in_employee_management: 1,
      rating: 5,
      reviews_count: 10,
    });
    this.seed("staff", {
      id: "staff-1",
      salon_id: "main",
      firebase_uid: null,
      name: "Aisha",
      phone_normalized: null,
      active: 1,
      employment_status: "active",
      avatar_url: "/assets/aisha.webp",
      show_on_booking: 1,
      specialties_json: JSON.stringify(["hair-care", "skin-care"]),
      created_at: now,
      updated_at: now,
    });
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ?")) {
      const [salonId, uid] = params;
      return this.rows("app_users").filter(
        (row) => row.salon_id === salonId && row.firebase_uid === uid
      );
    }
    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("app_users", salonId, id);
      return row ? [row] : [];
    }
    if (normalized.startsWith("SELECT * FROM permissions ORDER BY") || normalized.startsWith("SELECT permission_key FROM permissions ORDER BY")) {
      return this.rows("permissions");
    }
    if (normalized.startsWith("SELECT permission_key FROM role_permissions WHERE salon_id = ? AND role_key = ?")) {
      const [salonId, roleKey] = params;
      return this.rows("role_permissions")
        .filter((row) => row.salon_id === salonId && row.role_key === roleKey)
        .map((row) => ({ permission_key: row.permission_key }));
    }
    if (normalized.startsWith("SELECT permission_key, effect FROM user_permissions WHERE salon_id = ? AND user_id = ?")) {
      const [salonId, userId] = params;
      return this.rows("user_permissions").filter(
        (row) => row.salon_id === salonId && row.user_id === userId
      );
    }
    if (normalized.includes("FROM user_employee_links")) return [];
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ?")) {
      const [salonId, uid] = params;
      return this.rows("clients").filter(
        (row) => row.salon_id === salonId && row.firebase_uid === uid
      );
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("clients", salonId, id);
      return row ? [row] : [];
    }
    if (normalized.startsWith("SELECT * FROM testimonials WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      const row = this.find("testimonials", salonId, id);
      return row ? [row] : [];
    }
    if (
      normalized.startsWith("SELECT * FROM testimonials WHERE salon_id = ?") &&
      normalized.includes("ORDER BY created_at DESC")
    ) {
      const salonId = params[0];
      let rows = this.rows("testimonials").filter((row) => row.salon_id === salonId);
      if (normalized.includes("AND approved = 1 AND hidden = 0")) {
        rows = rows.filter((row) => Number(row.approved) === 1 && Number(row.hidden) === 0);
      }
      const limit = Number(params[params.length - 1] || 50);
      return rows
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, limit);
    }
    if (normalized.includes("FROM employee_profiles ep") && normalized.includes("show_on_about = 1")) {
      const [salonId] = params;
      return this.rows("employee_profiles")
        .filter(
          (ep) =>
            ep.salon_id === salonId &&
            Number(ep.show_on_about) === 1 &&
            String(ep.status || "active").toLowerCase() === "active"
        )
        .map((ep) => {
          const staff = this.find("staff", salonId, ep.id) || {};
          const employment = this.rows("employee_employment").find(
            (row) => row.salon_id === salonId && row.employee_id === ep.id
          );
          return {
            ...ep,
            specialties_json: staff.specialties_json || "[]",
            staff_active: staff.active ?? 1,
            employment_end_date: employment?.end_date || null,
          };
        });
    }
    if (normalized.includes("SELECT DISTINCT b.start_time AS start_time")) {
      const [salonId, date] = params;
      const times = [
        ...new Set(
          this.rows("bookings")
            .filter(
              (row) =>
                row.salon_id === salonId &&
                row.booking_date === date &&
                !row.deleted_at &&
                !["cancelled", "canceled", "refunded"].includes(
                  String(row.status || "").toLowerCase()
                )
            )
            .map((row) => String(row.start_time || "").trim())
            .filter(Boolean)
        ),
      ].sort();
      return times.map((start_time) => ({ start_time }));
    }
    if (normalized.startsWith("SELECT * FROM bookings")) return [];

    throw new Error(`unhandled fake D1 all: ${normalized}`);
  }

  async run(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("UPDATE app_users SET last_login_at = ?")) {
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("INSERT INTO testimonials")) {
      const [
        salon_id,
        id,
        uid,
        name,
        role_label,
        image_url,
        content,
        rating,
        vip,
        created_at,
        updated_at,
      ] = params;
      this.seed("testimonials", {
        salon_id,
        id,
        uid,
        name,
        role_label,
        image_url,
        content,
        rating,
        vip,
        approved: 1,
        hidden: 0,
        admin_reply: "",
        created_at,
        updated_at,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("UPDATE testimonials SET hidden = ?")) {
      const [hidden, approved, admin_reply, updated_at, salonId, id] = params;
      const row = this.find("testimonials", salonId, id);
      if (!row) return { meta: { changes: 0 } };
      this.seed("testimonials", {
        ...row,
        hidden,
        approved,
        admin_reply,
        updated_at,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("DELETE FROM testimonials WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      this.tables.testimonials.delete(`${salonId}\u0000${id}`);
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("INSERT INTO audit_logs") || normalized.includes("INSERT INTO audit_logs")) {
      return { meta: { changes: 1 } };
    }
    throw new Error(`unhandled fake D1 run: ${normalized}`);
  }

  async batch() {
    throw new Error("batch not used");
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

function request(path, { method = "GET", token = "", body } = {}) {
  return new Request(`http://worker.test${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== "GET" && method !== "DELETE"
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body || {}),
  });
}

test("guest can list public about staff from Core", async () => {
  const fake = new FakeD1();
  const response = await worker.fetch(
    request("/api/core/staff/public-about", { token: "" }),
    env(fake)
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].name, "Aisha");
  assert.deepEqual(body.data[0].specialties, ["hair-care", "skin-care"]);
  assert.equal(body.data[0].showOnAbout, true);
});

test("guest can list taken booking times without PII", async () => {
  const fake = new FakeD1();
  fake.seed("bookings", {
    id: "b1",
    salon_id: "main",
    booking_date: "2027-02-01",
    start_time: "10:00",
    status: "confirmed",
    deleted_at: null,
    client_id: "secret-client",
  });
  fake.seed("bookings", {
    id: "b2",
    salon_id: "main",
    booking_date: "2027-02-01",
    start_time: "11:30",
    status: "cancelled",
    deleted_at: null,
    client_id: "secret-client",
  });
  const response = await worker.fetch(
    request("/api/core/bookings/taken-times?date=2027-02-01", { token: "" }),
    env(fake)
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.times, ["10:00"]);
  assert.equal(JSON.stringify(body).includes("secret-client"), false);
});

test("client can create testimonial; guest sees approved only", async () => {
  const fake = new FakeD1();
  const create = await worker.fetch(
    request("/api/core/testimonials", {
      method: "POST",
      token: "test:client1:client",
      body: { content: "خدمة ممتازة", rating: 5, name: "Client One" },
    }),
    env(fake)
  );
  const created = await create.json();
  assert.equal(create.status, 200, JSON.stringify(created));
  assert.equal(created.data.content, "خدمة ممتازة");
  assert.equal(created.data.approved, true);
  assert.equal(created.data.hidden, false);

  const list = await worker.fetch(request("/api/core/testimonials", { token: "" }), env(fake));
  const listed = await list.json();
  assert.equal(list.status, 200, JSON.stringify(listed));
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].content, "خدمة ممتازة");
});

test("owner can hide and delete testimonials", async () => {
  const fake = new FakeD1();
  fake.seed("testimonials", {
    salon_id: "main",
    id: "t1",
    uid: "client1",
    name: "Client One",
    role_label: "عميلة",
    image_url: "",
    content: "hello",
    rating: 5,
    vip: 0,
    approved: 1,
    hidden: 0,
    admin_reply: "",
    created_at: "2027-01-02T00:00:00.000Z",
    updated_at: "2027-01-02T00:00:00.000Z",
  });

  const hide = await worker.fetch(
    request("/api/core/testimonials/t1", {
      method: "PATCH",
      token: "test:owner1:owner",
      body: { hidden: true },
    }),
    env(fake)
  );
  const hidden = await hide.json();
  assert.equal(hide.status, 200, JSON.stringify(hidden));
  assert.equal(hidden.data.hidden, true);

  const guestList = await worker.fetch(
    request("/api/core/testimonials", { token: "" }),
    env(fake)
  );
  const guestBody = await guestList.json();
  assert.equal(guestBody.data.length, 0);

  const del = await worker.fetch(
    request("/api/core/testimonials/t1", {
      method: "DELETE",
      token: "test:owner1:owner",
    }),
    env(fake)
  );
  const deleted = await del.json();
  assert.equal(del.status, 200, JSON.stringify(deleted));
  assert.equal(fake.rows("testimonials").length, 0);
});
