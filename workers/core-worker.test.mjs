import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import worker from "./core/index.js";

class FakeD1 {
  constructor() {
    this.__fakeD1 = true;
    this.tables = Object.fromEntries([
      "clients",
      "client_aliases",
      "services",
      "service_categories",
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
    ].map((table) => [table, new Map()]));
  }

  key(table, row) {
    if (table === "client_aliases") return `${row.salon_id}\u0000${row.alias_id}`;
    if (table === "staff_services") return `${row.salon_id}\u0000${row.staff_id}\u0000${row.service_id}`;
    if (table === "booking_slot_locks") return `${row.salon_id}\u0000${row.staff_id}\u0000${row.booking_date}\u0000${row.slot_time}`;
    return row.id;
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

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }

  async all(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("clients", salonId, id) ? [this.find("clients", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM clients WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("clients").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("services", salonId, id) ? [this.find("services", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM services WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("services").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("staff", salonId, id) ? [this.find("staff", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM staff WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("staff").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT id FROM bookings")) {
      const [salonId, staffId, bookingDate, startTime, excludeId] = params;
      return this.rows("bookings").filter((row) =>
        row.salon_id === salonId &&
        row.staff_id === staffId &&
        row.booking_date === bookingDate &&
        row.start_time === startTime &&
        row.status !== "cancelled" &&
        row.id !== excludeId
      ).slice(0, 1).map((row) => ({ id: row.id }));
    }
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("bookings", salonId, id) ? [this.find("bookings", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ? AND booking_date = ?")) {
      const [salonId, date] = params;
      return this.rows("bookings").filter((row) => row.salon_id === salonId && row.booking_date === date);
    }
    if (normalized.startsWith("SELECT * FROM bookings WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("bookings").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM booking_items WHERE booking_id = ?")) {
      const [bookingId] = params;
      return this.rows("booking_items").filter((row) => row.booking_id === bookingId);
    }
    if (normalized.startsWith("SELECT * FROM invoices WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("invoices", salonId, id) ? [this.find("invoices", salonId, id)] : [];
    }
    if (normalized.startsWith("SELECT * FROM invoices WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("invoices").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM payments WHERE salon_id = ? AND idempotency_key = ?")) {
      const [salonId, key] = params;
      return this.rows("payments").filter((row) => row.salon_id === salonId && row.idempotency_key === key).slice(0, 1);
    }
    if (normalized.startsWith("SELECT * FROM payments WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("payments").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM income_entries WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("income_entries").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM expense_entries WHERE salon_id = ? ORDER BY")) {
      const [salonId] = params;
      return this.rows("expense_entries").filter((row) => row.salon_id === salonId);
    }
    if (normalized.startsWith("SELECT * FROM expense_entries WHERE salon_id = ? AND id = ?")) {
      const [salonId, id] = params;
      return this.find("expense_entries", salonId, id) ? [this.find("expense_entries", salonId, id)] : [];
    }
    throw new Error(`unhandled fake D1 all: ${normalized}`);
  }

  insert(table, row) {
    this.seed(table, row);
    return { meta: { changes: 1 } };
  }

  update(table, salonId, id, fields) {
    const row = this.find(table, salonId, id);
    if (!row) return { meta: { changes: 0 } };
    this.seed(table, { ...row, ...fields });
    return { meta: { changes: 1 } };
  }

  async run(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("INSERT INTO clients")) {
      const [id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, created_at, updated_at] = params;
      return this.insert("clients", { id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, created_at, updated_at });
    }
    if (normalized.startsWith("INSERT INTO services")) {
      const [id, salon_id, name, section_id, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at] = params;
      return this.insert("services", { id, salon_id, name, section_id, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at });
    }
    if (normalized.startsWith("UPDATE clients SET")) return this.dynamicUpdate("clients", normalized, params);
    if (normalized.startsWith("UPDATE services SET")) return this.dynamicUpdate("services", normalized, params);
    if (normalized.startsWith("UPDATE staff SET")) return this.dynamicUpdate("staff", normalized, params);
    if (normalized.startsWith("UPDATE bookings SET status = 'completed'")) {
      const [completed_at, updated_at, salonId, id] = params;
      return this.update("bookings", salonId, id, { status: "completed", completed_at, updated_at });
    }
    if (normalized.startsWith("UPDATE bookings SET status = 'cancelled'")) {
      const [cancelled_at, notes, updated_at, salonId, id] = params;
      return this.update("bookings", salonId, id, { status: "cancelled", cancelled_at, notes, updated_at });
    }
    if (normalized.startsWith("UPDATE bookings SET")) return this.dynamicUpdate("bookings", normalized, params);
    if (normalized.startsWith("INSERT INTO invoices")) {
      const [id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas, total_halalas, paid_halalas, status, issued_at, created_at, updated_at] = params;
      return this.insert("invoices", { id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas, total_halalas, paid_halalas, status, issued_at, created_at, updated_at });
    }
    if (normalized.startsWith("INSERT INTO income_entries")) {
      const [id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description, occurred_at, created_at] = params;
      return this.insert("income_entries", { id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description, occurred_at, created_at });
    }
    if (normalized.startsWith("INSERT INTO expense_entries")) {
      const [id, salon_id, amount_halalas, category, description, payment_method, occurred_at, created_by_uid, created_at, updated_at] = params;
      return this.insert("expense_entries", { id, salon_id, amount_halalas, category, description, payment_method, occurred_at, created_by_uid, created_at, updated_at });
    }
    if (normalized.startsWith("UPDATE expense_entries SET")) return this.dynamicUpdate("expense_entries", normalized, params);
    throw new Error(`unhandled fake D1 run: ${normalized}`);
  }

  dynamicUpdate(table, normalizedSql, params) {
    const assignments = normalizedSql.match(/SET (.+) WHERE salon_id/)?.[1]?.split(",").map((part) => part.trim().split(" = ")[0]) || [];
    const salonId = params[params.length - 2];
    const id = params[params.length - 1];
    const fields = {};
    assignments.forEach((field, index) => {
      fields[field] = params[index];
    });
    return this.update(table, salonId, id, fields);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      const sql = statement.sql.replace(/\s+/g, " ").trim();
      const params = statement.params || [];
      if (sql.startsWith("INSERT INTO bookings")) {
        const [id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes, subtotal_halalas, discount_halalas, total_halalas, package_sessions_used, created_by_uid, created_at, updated_at, slot_step_min, buffer_min] = params;
        results.push(this.insert("bookings", {
          id, public_id, salon_id, client_id, staff_id, booking_date, start_time, end_time, status, source, notes,
          subtotal_halalas, discount_halalas, total_halalas, payment_status: "unpaid", package_sessions_used,
          created_by_uid, created_at, updated_at, cancelled_at: null, completed_at: null, slot_step_min, buffer_min,
        }));
      } else if (sql.startsWith("INSERT INTO booking_items")) {
        const [id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity, unit_price_halalas, total_halalas, package_covered, client_package_id, duration_minutes, created_at, booking_date, start_time, end_time, cart_item_id, package_reservation_id] = params;
        results.push(this.insert("booking_items", { id, booking_id, salon_id, service_id, service_name_snapshot, staff_id, quantity, unit_price_halalas, total_halalas, package_covered, client_package_id, duration_minutes, created_at, booking_date, start_time, end_time, cart_item_id, package_reservation_id }));
      } else if (sql.startsWith("INSERT INTO booking_slot_locks")) {
        const [salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at] = params;
        const key = `${salon_id}\u0000${staff_id}\u0000${booking_date}\u0000${slot_time}`;
        if (this.tables.booking_slot_locks.has(key)) throw new Error("UNIQUE constraint failed: booking_slot_locks");
        results.push(this.insert("booking_slot_locks", { salon_id, staff_id, booking_date, slot_time, booking_id, booking_item_id, created_at }));
      } else if (sql.startsWith("UPDATE bookings SET status = 'cancelled'")) {
        const [cancelled_at, notes, updated_at, salonId, id] = params;
        results.push(this.update("bookings", salonId, id, { status: "cancelled", cancelled_at, notes, updated_at }));
      } else if (sql.startsWith("DELETE FROM booking_slot_locks")) {
        const [salonId, bookingId] = params;
        let removed = 0;
        for (const [key, row] of this.tables.booking_slot_locks.entries()) {
          if (row.salon_id === salonId && row.booking_id === bookingId) {
            this.tables.booking_slot_locks.delete(key);
            removed += 1;
          }
        }
        results.push({ meta: { changes: removed } });
      } else if (sql.startsWith("INSERT INTO invoices")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("INSERT INTO payments")) {
        const [id, salon_id, invoice_id, booking_id, client_id, method, amount_halalas, status, provider, provider_reference, idempotency_key, paid_at, created_at] = params;
        results.push(this.insert("payments", { id, salon_id, invoice_id, booking_id, client_id, method, amount_halalas, status, provider, provider_reference, idempotency_key, paid_at, created_at }));
      } else if (sql.startsWith("INSERT INTO income_entries")) {
        results.push(await this.run(statement.sql, params));
      } else if (sql.startsWith("UPDATE invoices SET")) {
        const [paid_halalas, status, updated_at, salonId, id] = params;
        results.push(this.update("invoices", salonId, id, { paid_halalas, status, updated_at }));
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

async function json(response) {
  return response.json();
}

function seedCore(fake) {
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("clients", { id: "client-a", salon_id: "main", name: "Client A", phone_normalized: "0500000001", email: null, firebase_uid: "client1", status: "active", notes: null, created_at: now, updated_at: now });
  fake.seed("services", { id: "svc-a", salon_id: "main", name: "Service A", category_id: null, description: null, duration_minutes: 30, price_halalas: 7500, active: 1, image_url: null, sort_order: 0, created_at: now, updated_at: now });
  fake.seed("staff", { id: "staff-a", salon_id: "main", firebase_uid: "staff1", name: "Staff A", phone_normalized: null, active: 1, employment_status: "active", created_at: now, updated_at: now });
}

test("core operational path passes D1-only guard", () => {
  const result = spawnSync(process.execPath, ["scripts/check-core-d1-only.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("core endpoint fails clearly when D1 binding is missing", async () => {
  const response = await worker.fetch(request("/api/core/clients", { method: "GET" }), {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
  });
  const body = await json(response);
  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.error, "core_d1:not_configured");
});

test("client CRUD uses D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/clients", {
    method: "POST",
    body: { salonId: "main", id: "client-a", name: "Client A", phone: "+966500000001" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.phone_normalized, "0500000001");

  response = await worker.fetch(request("/api/core/clients/client-a", {
    method: "PATCH",
    body: { salonId: "main", notes: "VIP" },
  }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.notes, "VIP");

  response = await worker.fetch(request("/api/core/clients/client-a"), env(fake));
  body = await json(response);
  assert.equal(body.data.name, "Client A");
});

test("service CRUD uses D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/services", {
    method: "POST",
    body: { salonId: "main", id: "svc-a", name: "Service A", durationMinutes: 30, priceHalalas: 7500 },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.price_halalas, 7500);

  response = await worker.fetch(request("/api/core/services/svc-a", {
    method: "PATCH",
    body: { salonId: "main", active: false },
  }), env(fake));
  body = await json(response);
  assert.equal(body.data.active, 0);
});

test("booking creation creates booking items and invoice", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-a",
      invoiceId: "invoice-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      items: [{ id: "item-a", serviceId: "svc-a" }],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.total_halalas, 7500);
  assert.equal(body.data.end_time, "10:30");
  assert.equal(body.data.items.length, 1);
  assert.equal(fake.rows("invoices")[0].booking_id, "booking-a");
});

test("booking conflict rejects same staff slot", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const payload = {
    salonId: "main",
    clientId: "client-a",
    staffId: "staff-a",
    bookingDate: "2027-01-10",
    startTime: "10:00",
    items: [{ serviceId: "svc-a" }],
  };
  const first = await worker.fetch(request("/api/core/bookings", { method: "POST", body: { ...payload, id: "booking-a" } }), env(fake));
  const second = await worker.fetch(request("/api/core/bookings", { method: "POST", body: { ...payload, id: "booking-b" } }), env(fake));
  assert.equal(first.status, 200);
  const body = await json(second);
  assert.equal(second.status, 409, JSON.stringify(body));
  assert.equal(body.error, "core_booking:staff_slot_conflict");
});

test("booking completion and cancellation update status", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("bookings", { id: "booking-a", salon_id: "main", client_id: "client-a", staff_id: "staff-a", booking_date: "2027-01-10", start_time: "10:00", end_time: "10:30", status: "booked", source: "test", notes: null, subtotal_halalas: 7500, discount_halalas: 0, total_halalas: 7500, payment_status: "unpaid", package_sessions_used: 0, created_by_uid: "owner1", created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-01T00:00:00.000Z", cancelled_at: null, completed_at: null });
  let response = await worker.fetch(request("/api/core/bookings/booking-a/complete", { method: "POST", body: { salonId: "main" } }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "completed");
  response = await worker.fetch(request("/api/core/bookings/booking-a/cancel", { method: "POST", body: { salonId: "main", reason: "client request" } }), env(fake));
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "cancelled");
});

test("invoice creation and split payment are idempotent", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  let response = await worker.fetch(request("/api/core/invoices", {
    method: "POST",
    body: { salonId: "main", id: "invoice-a", clientId: "client-a", subtotalHalalas: 10000, totalHalalas: 10000 },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", id: "payment-cash", invoiceId: "invoice-a", method: "cash", amountHalalas: 4000, idempotencyKey: "cash-1" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", id: "payment-card", invoiceId: "invoice-a", method: "card", amountHalalas: 6000, idempotencyKey: "card-1" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));

  response = await worker.fetch(request("/api/core/payments", {
    method: "POST",
    body: { salonId: "main", id: "payment-card-repeat", invoiceId: "invoice-a", method: "card", amountHalalas: 6000, idempotencyKey: "card-1" },
  }), env(fake));
  const repeat = await json(response);
  assert.equal(repeat.data.idempotent, true);
  assert.equal(fake.find("invoices", "main", "invoice-a").status, "paid");
  assert.equal(fake.rows("payments").length, 2);
});

test("expense creation and patch use D1", async () => {
  const fake = new FakeD1();
  let response = await worker.fetch(request("/api/core/expenses", {
    method: "POST",
    body: { salonId: "main", id: "expense-a", amountHalalas: 1200, category: "supplies" },
  }), env(fake));
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  response = await worker.fetch(request("/api/core/expenses/expense-a", {
    method: "PATCH",
    body: { salonId: "main", description: "Towels" },
  }), env(fake));
  body = await json(response);
  assert.equal(body.data.description, "Towels");
});

test("core migration dry-run parses fixture and prints counts", () => {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-core-firestore-to-d1.mjs",
    "--input=scripts/fixtures/core-migration-fixture.json",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dry-run only/);
  assert.match(result.stdout, /clients/);
  assert.match(result.stdout, /payments/);
});

test("availability endpoint returns D1 slot locks and booking metadata", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("staff_schedules", {
    id: "schedule-a",
    salon_id: "main",
    staff_id: "staff-a",
    weekday: 0,
    start_time: "09:00",
    end_time: "18:00",
    active: 1,
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });

  const created = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-availability",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      slotStepMin: 10,
      items: [{ id: "item-availability", serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(created.status, 200, JSON.stringify(await json(created)));

  const response = await worker.fetch(request(
    "/api/core/availability?staffId=staff-a&date=2027-01-10&slotStepMin=10"
  ), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.takenTimes, ["10:00", "10:10", "10:20"]);
  assert.equal(body.data.bookedSlots["10:00"].bookingId, "booking-availability");
  assert.equal(body.data.scheduleWindows[0].startTime, "09:00");
  assert.equal(body.data.availableForDate, true);
});


test("availability projects five-minute locks onto the requested UI slot grid", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const created = await worker.fetch(
    request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: "booking-five-minute-grid",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "10:05",
        slotStepMin: 5,
        items: [{ serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  assert.equal(created.status, 200, JSON.stringify(await json(created)));
  assert.equal(fake.rows("booking_slot_locks").length, 6);

  const availability = await worker.fetch(
    request("/api/core/availability?staffId=staff-a&date=2027-01-10&slotStepMin=10"),
    env(fake)
  );
  const body = await json(availability);
  assert.equal(availability.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.takenTimes, ["10:10", "10:20", "10:30"]);
});

test("overlapping ranges are rejected while adjacent ranges are allowed", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const first = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-range-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:00",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(first.status, 200, JSON.stringify(await json(first)));

  const overlap = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-range-overlap",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:20",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  const overlapBody = await json(overlap);
  assert.equal(overlap.status, 409, JSON.stringify(overlapBody));
  assert.equal(overlapBody.error, "core_booking:staff_slot_conflict");

  const adjacent = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-range-adjacent",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "10:30",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(adjacent.status, 200, JSON.stringify(await json(adjacent)));
});

test("cancelling a booking releases D1 slot locks", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  let response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-release-a",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "11:00",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.equal(fake.rows("booking_slot_locks").length, 6);

  response = await worker.fetch(request("/api/core/bookings/booking-release-a/cancel", {
    method: "POST",
    body: { salonId: "main", reason: "client request" },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.equal(fake.rows("booking_slot_locks").length, 0);

  response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-release-b",
      clientId: "client-a",
      staffId: "staff-a",
      bookingDate: "2027-01-10",
      startTime: "11:00",
      items: [{ serviceId: "svc-a" }],
    },
  }), env(fake));
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
});

test("multi-item booking preserves each item date and time", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(request("/api/core/bookings", {
    method: "POST",
    body: {
      salonId: "main",
      id: "booking-group-a",
      clientId: "client-a",
      bookingDate: "2027-01-10",
      startTime: "12:00",
      slotStepMin: 10,
      items: [
        {
          id: "group-item-a",
          cartItemId: "cart-a",
          serviceId: "svc-a",
          staffId: "staff-a",
          bookingDate: "2027-01-10",
          startTime: "12:00",
        },
        {
          id: "group-item-b",
          cartItemId: "cart-b",
          serviceId: "svc-a",
          staffId: "staff-a",
          bookingDate: "2027-01-11",
          startTime: "14:00",
        },
      ],
    },
  }), env(fake));
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[0].booking_date, "2027-01-10");
  assert.equal(body.data.items[0].start_time, "12:00");
  assert.equal(body.data.items[1].booking_date, "2027-01-11");
  assert.equal(body.data.items[1].start_time, "14:00");
  assert.equal(body.data.items[1].cart_item_id, "cart-b");
});

test("booking creation is idempotent when the same booking id is retried", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const payload = {
    salonId: "main",
    id: "booking-idempotent",
    clientId: "client-a",
    staffId: "staff-a",
    bookingDate: "2027-01-10",
    startTime: "15:00",
    items: [{ id: "item-idempotent", serviceId: "svc-a" }],
  };
  const first = await worker.fetch(
    request("/api/core/bookings", { method: "POST", body: payload }),
    env(fake)
  );
  const second = await worker.fetch(
    request("/api/core/bookings", { method: "POST", body: payload }),
    env(fake)
  );
  assert.equal(first.status, 200, JSON.stringify(await json(first)));
  assert.equal(second.status, 200, JSON.stringify(await json(second)));
  assert.equal(fake.rows("bookings").length, 1);
  assert.equal(fake.rows("booking_slot_locks").length, 6);
});

test("booking creation rejects starts that are not aligned to the configured slot step", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  const response = await worker.fetch(
    request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: "booking-misaligned",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "10:05",
        slotStepMin: 10,
        items: [{ serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:invalid_slot_alignment");
});

test("staff leave blocks booking and is exposed by availability", async () => {
  const fake = new FakeD1();
  seedCore(fake);
  fake.seed("staff", {
    ...fake.find("staff", "main", "staff-a"),
    leave_start_date: "2027-01-09",
    leave_end_date: "2027-01-11",
    leave_note: "annual leave",
    show_on_booking: 1,
  });

  const availability = await worker.fetch(
    request("/api/core/availability?staffId=staff-a&date=2027-01-10"),
    env(fake)
  );
  const availabilityBody = await json(availability);
  assert.equal(availability.status, 200, JSON.stringify(availabilityBody));
  assert.equal(availabilityBody.data.onLeave, true);
  assert.equal(availabilityBody.data.availableForDate, false);

  const response = await worker.fetch(
    request("/api/core/bookings", {
      method: "POST",
      body: {
        salonId: "main",
        id: "booking-leave",
        clientId: "client-a",
        staffId: "staff-a",
        bookingDate: "2027-01-10",
        startTime: "16:00",
        items: [{ serviceId: "svc-a" }],
      },
    }),
    env(fake)
  );
  const body = await json(response);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(body.error, "core_booking:staff_unavailable");
});
