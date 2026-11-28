import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";

const directory = "migrations/core";

const migrations = readdirSync(directory)
  .filter(name => /^\d+.*\.sql$/.test(name))
  .sort();

async function setup(t) {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'package-sale-test', compatibilityDate: '2026-06-24',
    manifest: {
      mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
      modules: { 'script-0.mjs': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' } },
    },
    env: { CORE_DB: { type: 'd1', id: 'package-sale-test' } }, exports: {},
  }, dev: { rootPath: process.cwd() } }] });

  t.after(async () => {
    await mf.dispose();
  });

  const db = await mf.getD1Database("CORE_DB");

  const sqlite = await import("node:sqlite");
  const parser = new sqlite.DatabaseSync(":memory:");

  try {
    for (const name of migrations) {
      const sql = readFileSync(
        `${directory}/${name}`,
        "utf8"
      );

      // SQLite executes full migration files, including triggers.
      // Miniflare receives the resulting local schema below.
      try {
        parser.exec(sql);
      } catch (error) {
        throw new Error(
          `Migration ${name}: ${error.message}`
        );
      }
    }

    const schema = parser.prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE sql IS NOT NULL
        AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type
        WHEN 'table' THEN 1
        WHEN 'index' THEN 2
        WHEN 'view' THEN 3
        WHEN 'trigger' THEN 4
        ELSE 5
      END, rowid
    `).all();

    for (const row of schema) {
      try {
        await db.prepare(row.sql).run();
      } catch (error) {
        throw new Error(
          `Miniflare schema ${row.name}: ${error.message}`
        );
      }
    }

  } finally {
    parser.close();
  }

  return db;
}

test("B04 complete local schema loads into Miniflare D1", async t => {
  const db = await setup(t);

  const result = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
  `).all();

  const tables = new Set(
    result.results.map(row => row.name)
  );

  for (const name of [
    "bookings",
    "booking_items",
    "client_packages",
    "package_transactions",
    "package_sales",
    "invoices",
    "payments",
    "income_entries",
    "audit_logs",
    "employee_weekly_rest_rescheduling"
  ]) {
    assert.ok(
      tables.has(name),
      `Missing table: ${name}`
    );
  }
});

test("B04 booking fingerprint column exists in local D1", async t => {
  const db = await setup(t);

  const result = await db.prepare(
    "PRAGMA table_info(bookings)"
  ).all();

  const fingerprint = result.results.find(
    row => row.name === "creation_request_fingerprint"
  );

  assert.ok(fingerprint);

  assert.equal(
    fingerprint.type.toUpperCase(),
    "TEXT"
  );
});

test("B04 booking protection triggers exist in local D1", async t => {
  const db = await setup(t);

  const result = await db.prepare(`
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
  `).all();

  const triggers = result.results;

  for (const name of [
    "trg_booking_item_live_package_guard_v2",
    "trg_booking_item_package_binding_immutable",
    "trg_booking_package_owner_immutable"
  ]) {
    assert.ok(
      triggers.some(row => row.name === name),
      `Missing trigger: ${name}`
    );
  }

  assert.ok(
    triggers.some(row =>
      row.tbl_name === "bookings" &&
      row.sql.includes(
        "creation_request_fingerprint"
      ) &&
      /RAISE\s*\(/i.test(row.sql)
    )
  );
});

test("B04 local D1 rejects a failing transaction without partial writes", async t => {
  const db = await setup(t);

  await db.prepare(`
    CREATE TABLE local_transaction_probe (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL CHECK(amount >= 0)
    )
  `).run();

  await assert.rejects(
    db.batch([
      db.prepare(`
        INSERT INTO local_transaction_probe
        (id, amount) VALUES (?, ?)
      `).bind("first", 100),

      db.prepare(`
        INSERT INTO local_transaction_probe
        (id, amount) VALUES (?, ?)
      `).bind("second", -1)
    ])
  );

  const result = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM local_transaction_probe
  `).first();

  assert.equal(result.total, 0);
});

test("B04 local D1 commits a valid transaction exactly once", async t => {
  const db = await setup(t);

  await db.prepare(`
    CREATE TABLE local_replay_probe (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL
    )
  `).run();

  await db.batch([
    db.prepare(`
      INSERT INTO local_replay_probe
      (id, amount) VALUES (?, ?)
    `).bind("operation-a", 100)
  ]);

  await assert.rejects(
    db.batch([
      db.prepare(`
        INSERT INTO local_replay_probe
        (id, amount) VALUES (?, ?)
      `).bind("operation-a", 200)
    ])
  );

  const result = await db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(amount) AS amount
    FROM local_replay_probe
  `).first();

  assert.equal(result.total, 1);
  assert.equal(result.amount, 100);
});

async function guestContractSnapshot(db) {
  const tables = (
    await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
      ORDER BY name
    `).all()
  ).results;

  const snapshot = {};

  for (const { name } of tables) {
    assert.match(name, /^[A-Za-z0-9_]+$/);

    const rows = await db.prepare(
      `SELECT * FROM "${name}"`
    ).all();

    snapshot[name] = rows.results
      .map(row => JSON.stringify(row))
      .sort();
  }

  return snapshot;
}

async function guestContractRequest(
  db,
  route,
  body,
  token
) {
  const { default: worker } =
    await import("./core/index.js");

  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": "b04-guest-contract"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await worker.fetch(
    new Request(`https://worker.test${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }),
    {
      CORE_DB: db,
      SALON_ID: "main",
      FIREBASE_PROJECT_ID: "booking-runtime-test",
      PACKAGES_AUTH_TEST_MODE: "true"
    }
  );

  return {
    status: response.status,
    body: await response.text()
  };
}

function guestContractPayload() {
  return {
    id: "b04-guest-contract-booking",
    clientId: "nonexistent-local-client",
    staffId: "local-staff",
    source: "client",
    bookingDate: "2099-01-15",
    startTime: "14:00",
    items: [
      {
        id: "local-cart-item",
        serviceId: "local-service"
      }
    ]
  };
}

const guestContractCases = [
  {
    title: "public creation rejects invalid bearer credentials",
    route: "/api/core/bookings",
    token: "invalid-local-token",
    status: 401
  },
  {
    title: "internal creation requires authentication",
    route: "/api/core/internal/bookings",
    token: null,
    status: 401
  },
  {
    title: "internal creation rejects invalid bearer credentials",
    route: "/api/core/internal/bookings",
    token: "invalid-local-token",
    status: 401
  },
  {
    title: "guest creation cannot reference a nonexistent client",
    route: "/api/core/bookings",
    token: null,
    status: 404,
    error: "core_client:not_found"
  }
];

for (const scenario of guestContractCases) {
  test(
    `B04 guest security contract: ${scenario.title}`,
    async t => {
      const db = await setup(t);

      const before = await guestContractSnapshot(db);

      const response = await guestContractRequest(
        db,
        scenario.route,
        guestContractPayload(),
        scenario.token
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before,
        "Rejected request mutated operational tables"
      );

      assert.equal(
        response.status,
        scenario.status,
        JSON.stringify(response)
      );

      if (scenario.error) {
        assert.equal(
          JSON.parse(response.body).error,
          scenario.error
        );
      }
    }
  );
}


async function seedActualCoreBooking(db) {
  const records = [];

  const collector = {
    seed(table, row) {
      records.push({ table, row });
    }
  };

  const originalSeed = function seedCore(fake) {
  const now = "2027-01-01T00:00:00.000Z";
  fake.seed("clients", { id: "client-a", salon_id: "main", name: "Client A", phone_normalized: "0500000001", email: null, firebase_uid: "client1", status: "active", notes: null, created_at: now, updated_at: now });
  fake.seed("services", { id: "svc-a", salon_id: "main", name: "Service A", category_id: null, description: null, duration_minutes: 30, price_halalas: 7500, active: 1, image_url: null, sort_order: 0, created_at: now, updated_at: now });
  fake.seed("staff", { id: "staff-a", salon_id: "main", firebase_uid: "staff1", name: "Staff A", phone_normalized: null, active: 1, employment_status: "active", show_on_booking: 1, created_at: now, updated_at: now });
  fake.seed("staff_services", {
    id: "staff-a__svc-a",
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-a",
    active: 1,
    created_at: now,
    updated_at: now,
  });
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    fake.seed("hr_work_schedules", {
      id: `staff-a__weekday-${weekday}`,
      salon_id: "main",
      employee_id: "staff-a",
      weekday,
      shift_template_id: null,
      active: 1,
      start_time: "09:00",
      end_time: "23:00",
      effective_from: "2020-01-01",
      effective_to: null,
      schedule_source: "test_fixture",
      created_at: now,
      updated_at: now,
    });
  }
};

  await originalSeed(collector);

  assert.ok(records.length > 0);

  for (const { table, row } of records) {
    assert.match(table, /^[A-Za-z0-9_]+$/);

    const schema = (
      await db.prepare(
        "PRAGMA table_info(" + table + ")"
      ).all()
    ).results;

    assert.ok(
      schema.length,
      "Missing fixture table: " + table
    );

    const columns = new Set(
      schema.map(column => column.name)
    );

    const selected = Object.entries(row).filter(
      ([key, value]) =>
        columns.has(key) &&
        value !== undefined
    );

    const missing = schema.filter(column =>
      column.notnull === 1 &&
      column.dflt_value === null &&
      !selected.some(([key]) => key === column.name)
    );

    assert.deepEqual(
      missing.map(column => column.name),
      [],
      "Required fixture fields missing: " + table
    );

    for (const [key] of selected) {
      assert.match(key, /^[A-Za-z0-9_]+$/);
    }

    await db.prepare(
      "INSERT INTO " + table +
      " (" +
      selected.map(([key]) => key).join(",") +
      ") VALUES (" +
      selected.map(() => "?").join(",") +
      ")"
    ).bind(
      ...selected.map(([key, value]) =>
        typeof value === "boolean"
          ? Number(value)
          : value !== null && typeof value === "object"
            ? JSON.stringify(value)
            : value
      )
    ).run();
  }

  console.log(
    "ACTUAL_CORE_FIXTURE_RECORDS:",
    records.length
  );
}

function actualBookingPayload(id) {
  return {
    salonId: "main",
    id,
    invoiceId: "invoice-" + id,
    clientId: "client-a",
    staffId: "staff-a",
    source: "client",
    bookingDate: "2027-01-10",
    startTime: "15:00",
    items: [
      {
        id: "item-" + id,
        serviceId: "svc-a"
      }
    ]
  };
}

async function actualBookingCount(db, table) {
  assert.match(table, /^[A-Za-z0-9_]+$/);

  return (
    await db.prepare(
      "SELECT COUNT(*) AS total FROM " + table
    ).first()
  ).total;
}

test("B04 actual booking commits through Core Worker and local D1", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-actual-booking-commit"
  );

  const before = {
    bookings: await actualBookingCount(db, "bookings"),
    items: await actualBookingCount(db, "booking_items"),
    locks: await actualBookingCount(db, "booking_slot_locks"),
    audit: await actualBookingCount(db, "audit_logs")
  };

  const response = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    "test:owner1:owner"
  );

  console.log(
    "ACTUAL_BOOKING_RESPONSE:",
    JSON.stringify(response)
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(response)
  );

  const booking = await db.prepare(
    "SELECT * FROM bookings WHERE salon_id = ? AND id = ?"
  ).bind(
    "main",
    payload.id
  ).first();

  assert.ok(booking);
  assert.equal(booking.client_id, "client-a");

  assert.match(
    booking.creation_request_fingerprint,
    /^[a-f0-9]{64}$/
  );

  assert.equal(
    await actualBookingCount(db, "bookings"),
    before.bookings + 1
  );

  assert.equal(
    await actualBookingCount(db, "booking_items"),
    before.items + 1
  );

  assert.ok(
    await actualBookingCount(db, "booking_slot_locks") >
      before.locks
  );

  assert.ok(
    await actualBookingCount(db, "audit_logs") >
      before.audit
  );

  console.log("ACTUAL_BOOKING_COMMITTED");
});

test("B04 actual booking exact replay does not duplicate operational records", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-actual-booking-replay"
  );

  const first = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    "test:owner1:owner"
  );

  assert.equal(
    first.status,
    200,
    JSON.stringify(first)
  );

  const snapshot = await guestContractSnapshot(db);

  const replay = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    "test:owner1:owner"
  );

  console.log(
    "ACTUAL_REPLAY_RESPONSE:",
    JSON.stringify(replay)
  );

  assert.equal(
    replay.status,
    200,
    JSON.stringify(replay)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    snapshot,
    "Replay duplicated or mutated committed records"
  );
});

test("B04 actual booking rejects changed payload after successful commit", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-actual-booking-conflict"
  );

  const first = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    "test:owner1:owner"
  );

  assert.equal(
    first.status,
    200,
    JSON.stringify(first)
  );

  const snapshot = await guestContractSnapshot(db);

  const changed = await guestContractRequest(
    db,
    "/api/core/bookings",
    {
      ...payload,
      startTime: "16:00"
    },
    "test:owner1:owner"
  );

  assert.equal(
    changed.status,
    409,
    JSON.stringify(changed)
  );

  assert.equal(
    JSON.parse(changed.body).error,
    "core_booking:creation_replay_conflict"
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    snapshot
  );
});

test("B04 actual booking fingerprint is immutable at database level", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-actual-booking-fingerprint"
  );

  const response = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    "test:owner1:owner"
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(response)
  );

  const snapshot = await guestContractSnapshot(db);

  await assert.rejects(
    db.prepare(
      "UPDATE bookings SET creation_request_fingerprint = ? WHERE salon_id = ? AND id = ?"
    ).bind(
      "0".repeat(64),
      "main",
      payload.id
    ).run()
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    snapshot
  );
});

async function assertSingleCommittedBooking(db, id) {
  const parent = await db.prepare(`
    SELECT *
    FROM bookings
    WHERE salon_id = ? AND id = ?
  `).bind("main", id).first();

  assert.ok(parent);

  assert.match(
    parent.creation_request_fingerprint,
    /^[a-f0-9]{64}$/
  );

  const children = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM booking_items
    WHERE salon_id = ? AND booking_id = ?
  `).bind("main", id).first();

  assert.equal(children.total, 1);

  const locks = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM booking_slot_locks
    WHERE salon_id = ? AND booking_id = ?
  `).bind("main", id).first();

  assert.ok(locks.total > 0);

  return parent;
}

test("B04 concurrent identical booking creation commits only once", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-concurrent-identical"
  );

  const before = await actualBookingCount(
    db,
    "bookings"
  );

  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      guestContractRequest(
        db,
        "/api/core/bookings",
        payload,
        "test:owner1:owner"
      )
    )
  );

  console.log(
    "CONCURRENT_IDENTICAL:",
    JSON.stringify(responses)
  );

  for (const response of responses) {
    assert.equal(
      response.status,
      200,
      JSON.stringify(response)
    );
  }

  assert.equal(
    await actualBookingCount(db, "bookings"),
    before + 1
  );

  await assertSingleCommittedBooking(
    db,
    payload.id
  );

  const committed = await guestContractSnapshot(db);

  const replay = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    "test:owner1:owner"
  );

  assert.equal(
    replay.status,
    200,
    JSON.stringify(replay)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );
});

test("B04 concurrent conflicting booking payloads cannot both succeed", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const firstPayload = actualBookingPayload(
    "b04-concurrent-conflict"
  );

  const secondPayload = {
    ...firstPayload,
    startTime: "16:00"
  };

  const before = await actualBookingCount(
    db,
    "bookings"
  );

  const responses = await Promise.all([
    guestContractRequest(
      db,
      "/api/core/bookings",
      firstPayload,
      "test:owner1:owner"
    ),
    guestContractRequest(
      db,
      "/api/core/bookings",
      secondPayload,
      "test:owner1:owner"
    )
  ]);

  console.log(
    "CONCURRENT_CONFLICT:",
    JSON.stringify(responses)
  );

  assert.deepEqual(
    responses.map(response => response.status).sort(),
    [200, 409]
  );

  assert.equal(
    await actualBookingCount(db, "bookings"),
    before + 1
  );

  await assertSingleCommittedBooking(
    db,
    firstPayload.id
  );

  const winner =
    responses[0].status === 200
      ? firstPayload
      : secondPayload;

  const loser =
    responses[0].status === 200
      ? secondPayload
      : firstPayload;

  const snapshot = await guestContractSnapshot(db);

  const winningReplay = await guestContractRequest(
    db,
    "/api/core/bookings",
    winner,
    "test:owner1:owner"
  );

  assert.equal(
    winningReplay.status,
    200,
    JSON.stringify(winningReplay)
  );

  const losingReplay = await guestContractRequest(
    db,
    "/api/core/bookings",
    loser,
    "test:owner1:owner"
  );

  assert.equal(
    losingReplay.status,
    409,
    JSON.stringify(losingReplay)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    snapshot
  );
});

test("B04 concurrent bookings cannot occupy the same staff slot", async t => {
  const db = await setup(t);

  await seedActualCoreBooking(db);

  const before = await actualBookingCount(
    db,
    "bookings"
  );

  const payloads = [
    actualBookingPayload("b04-slot-race-a"),
    actualBookingPayload("b04-slot-race-b")
  ];

  const responses = await Promise.all(
    payloads.map(payload =>
      guestContractRequest(
        db,
        "/api/core/bookings",
        payload,
        "test:owner1:owner"
      )
    )
  );

  console.log(
    "CONCURRENT_SLOT:",
    JSON.stringify(responses)
  );

  assert.deepEqual(
    responses.map(response => response.status).sort(),
    [200, 409]
  );

  assert.equal(
    await actualBookingCount(db, "bookings"),
    before + 1
  );

  const winner = responses.findIndex(
    response => response.status === 200
  );

  await assertSingleCommittedBooking(
    db,
    payloads[winner].id
  );

  const losingId = payloads[1 - winner].id;

  const orphanItems = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM booking_items
    WHERE salon_id = ? AND booking_id = ?
  `).bind("main", losingId).first();

  assert.equal(orphanItems.total, 0);

  const orphanLocks = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM booking_slot_locks
    WHERE salon_id = ? AND booking_id = ?
  `).bind("main", losingId).first();

  assert.equal(orphanLocks.total, 0);
});

for (const failingTable of [
  "bookings",
  "booking_items",
  "booking_slot_locks",
  "invoices",
  "audit_logs"
]) {
  test(
    `B04 booking transaction rollback at ${failingTable}`,
    async t => {
      const db = await setup(t);

      await seedActualCoreBooking(db);

      const payload = actualBookingPayload(
        "b04-fault-" + failingTable
      );

      assert.match(
        failingTable,
        /^[A-Za-z0-9_]+$/
      );

      const triggerName =
        "b04_fault_" + failingTable;

      await db.prepare(
        "CREATE TRIGGER " + triggerName +
        " BEFORE INSERT ON " + failingTable +
        " BEGIN SELECT RAISE(ABORT, 'b04_injected_booking_failure'); END"
      ).run();

      const before = await guestContractSnapshot(db);

      const response = await guestContractRequest(
        db,
        "/api/core/bookings",
        payload,
        "test:owner1:owner"
      );

      console.log(
        "BOOKING_FAULT:",
        JSON.stringify({
          table: failingTable,
          response
        })
      );

      assert.ok(
        response.status >= 400,
        "Fault injection did not reject creation: " +
          JSON.stringify(response)
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before,
        "Partial database writes after failure in " +
          failingTable
      );

      await db.prepare(
        "DROP TRIGGER " + triggerName
      ).run();

      const retry = await guestContractRequest(
        db,
        "/api/core/bookings",
        payload,
        "test:owner1:owner"
      );

      console.log(
        "BOOKING_FAULT_RECOVERY:",
        JSON.stringify({
          table: failingTable,
          retry
        })
      );

      assert.equal(
        retry.status,
        200,
        JSON.stringify(retry)
      );

      await assertSingleCommittedBooking(
        db,
        payload.id
      );
    }
  );
}



test("B04 booking reference allocation preserves historical high-water marks", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  await db.prepare(
    "INSERT INTO booking_counters (salon_id,last_number,updated_at) VALUES (?,?,?)"
  ).bind(
    "main",
    50000,
    "2026-01-01T00:00:00.000Z"
  ).run();

  const first = actualBookingPayload(
    "b04-reference-high-water"
  );

  const response = await guestContractRequest(
    db,
    "/api/core/bookings",
    {
      ...first,
      publicId: "MK-1"
    },
    "test:owner1:owner"
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(response)
  );

  const row = await assertSingleCommittedBooking(
    db,
    first.id
  );

  assert.equal(row.public_id, "MK-50001");

  const counter = await db.prepare(
    "SELECT last_number FROM booking_counters WHERE salon_id = ?"
  ).bind("main").first();

  assert.equal(counter.last_number, 50001);
});

test("B04 successful concurrent distinct bookings receive unique references and matching audits", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payloads = [
    {
      ...actualBookingPayload("b04-reference-a"),
      startTime: "13:00"
    },
    {
      ...actualBookingPayload("b04-reference-b"),
      startTime: "16:00"
    }
  ];

  const responses = await Promise.all(
    payloads.map(payload =>
      guestContractRequest(
        db,
        "/api/core/bookings",
        payload,
        "test:owner1:owner"
      )
    )
  );

  for (const response of responses) {
    assert.equal(
      response.status,
      200,
      JSON.stringify(response)
    );
  }

  const rows = [];

  for (const payload of payloads) {
    rows.push(
      await assertSingleCommittedBooking(db, payload.id)
    );
  }

  assert.deepEqual(
    rows.map(row => row.public_id).sort(),
    ["MK-10423", "MK-10424"]
  );

  const counter = await db.prepare(
    "SELECT last_number FROM booking_counters WHERE salon_id = ?"
  ).bind("main").first();

  assert.equal(counter.last_number, 10424);

  for (const row of rows) {
    const audit = await db.prepare(
      "SELECT after_json FROM audit_logs WHERE salon_id = ? AND entity_id = ? AND action = ?"
    ).bind(
      "main",
      row.id,
      "booking_created"
    ).first();

    assert.ok(audit);

    assert.equal(
      JSON.parse(audit.after_json).publicId,
      row.public_id
    );
  }
});

test("B04 repeated concurrent replay advances the booking counter exactly once", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-reference-replay"
  );

  const responses = await Promise.all(
    Array.from({length: 4}, () =>
      guestContractRequest(
        db,
        "/api/core/bookings",
        payload,
        "test:owner1:owner"
      )
    )
  );

  for (const response of responses) {
    assert.equal(
      response.status,
      200,
      JSON.stringify(response)
    );
  }

  const row = await assertSingleCommittedBooking(
    db,
    payload.id
  );

  assert.equal(row.public_id, "MK-10423");

  const counter = await db.prepare(
    "SELECT last_number FROM booking_counters WHERE salon_id = ?"
  ).bind("main").first();

  assert.equal(counter.last_number, 10423);
});

async function seedD6Package(db, sessions = 3) {
  await seedActualCoreBooking(db);

  const existingClient = await db.prepare(
    "SELECT id, salon_id, canonical_client_id FROM clients WHERE salon_id = ? AND id = ?"
  ).bind(
    "main",
    "client-a"
  ).first();

  assert.ok(
    existingClient,
    "Actual Core fixture client is missing"
  );

  console.log(
    "D6_CLIENT_IDENTITY_BEFORE:",
    JSON.stringify(existingClient)
  );

  // Only initialize the synthetic client's missing canonical
  // identity. Never overwrite a conflicting identity.

  if (
    existingClient.canonical_client_id === null ||
    existingClient.canonical_client_id === ""
  ) {
    const result = await db.prepare(
      "UPDATE clients SET canonical_client_id = ? " +
      "WHERE salon_id = ? AND id = ? " +
      "AND (canonical_client_id IS NULL OR canonical_client_id = '')"
    ).bind(
      "client-a",
      "main",
      "client-a"
    ).run();

    assert.equal(
      Number(result.meta.changes),
      1
    );
  }

  const canonicalClient = await db.prepare(
    "SELECT id, salon_id, canonical_client_id FROM clients WHERE salon_id = ? AND id = ?"
  ).bind(
    "main",
    "client-a"
  ).first();

  assert.equal(
    canonicalClient.canonical_client_id,
    "client-a",
    "Conflicting canonical fixture identity"
  );

  const canonicalParent = await db.prepare(
    "SELECT id FROM clients WHERE salon_id = ? AND canonical_client_id = ?"
  ).bind(
    "main",
    "client-a"
  ).first();

  assert.equal(
    canonicalParent?.id,
    "client-a"
  );

  console.log(
    "D6_CANONICAL_CLIENT_VERIFIED:",
    JSON.stringify(canonicalClient)
  );



  const foreignKeys = (
    await db.prepare(
      "PRAGMA foreign_key_list(client_packages)"
    ).all()
  ).results;

  console.log(
    "D6_PACKAGE_FOREIGN_KEYS:",
    JSON.stringify(foreignKeys)
  );

  const catalogRelation = foreignKeys.find(
    row => row.from === "package_catalog_id"
  );

  assert.ok(
    catalogRelation,
    "Package catalog foreign key missing"
  );

  const catalogTable =
    String(catalogRelation.table);

  assert.match(
    catalogTable,
    /^[A-Za-z_][A-Za-z0-9_]*$/
  );

  const catalogSchema = (
    await db.prepare(
      "PRAGMA table_info(" + catalogTable + ")"
    ).all()
  ).results;

  const catalogColumns = new Set(
    catalogSchema.map(column => column.name)
  );

  console.log(
    "D6_CATALOG_SCHEMA:",
    JSON.stringify(catalogSchema)
  );

  const catalogValues = {
    price: 225,
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    sale_enabled: 1,
    audience_scope: "all",
    id: "b04-d6-catalog",
    salon_id: "main",
    name: "B04 Local Package",
    name_ar: "B04 Local Package",
    name_en: "B04 Local Package",
    title: "B04 Local Package",
    description: "Local runtime fixture",
    description_ar: "Local runtime fixture",
    description_en: "Local runtime fixture",
    total_sessions: sessions,
    session_count: sessions,
    sessions_count: sessions,
    sessions: sessions,
    price_halalas: 22500,
    original_price_halalas: 22500,
    sale_price_halalas: 22500,
    currency: "SAR",
    service_ids_json: JSON.stringify(["svc-a"]),
    services_json: JSON.stringify(["svc-a"]),
    validity_days: 365,
    valid_days: 365,
    duration_days: 365,
    expiry_days: 365,
    is_active: 1,
    active: 1,
    is_visible: 1,
    status: "active",
    sort_order: 0,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z"
  };

  const catalogIdColumn =
    String(catalogRelation.to || "id");

  assert.match(
    catalogIdColumn,
    /^[A-Za-z_][A-Za-z0-9_]*$/
  );

  catalogValues[catalogIdColumn] =
    "b04-d6-catalog";

  const selectedCatalog = Object
    .entries(catalogValues)
    .filter(([key]) => catalogColumns.has(key));

  const missingCatalog = catalogSchema.filter(
    column =>
      column.notnull === 1 &&
      column.dflt_value === null &&
      !selectedCatalog.some(
        ([key]) => key === column.name
      )
  );

  assert.deepEqual(
    missingCatalog.map(column => column.name),
    [],
    "Catalog fixture missing required fields"
  );

  await db.prepare(
    "INSERT INTO " + catalogTable + " (" +
      selectedCatalog.map(([key]) => key).join(",") +
    ") VALUES (" +
      selectedCatalog.map(() => "?").join(",") +
    ")"
  ).bind(
    ...selectedCatalog.map(([,value]) => value)
  ).run();

  const catalogRow = await db.prepare(
    "SELECT * FROM " + catalogTable +
    " WHERE " + catalogIdColumn + " = ?"
  ).bind(
    "b04-d6-catalog"
  ).first();

  assert.ok(
    catalogRow,
    "Catalog fixture was not persisted"
  );

  if (catalogColumns.has("salon_id")) {
    assert.equal(catalogRow.salon_id, "main");
  }

  console.log("D6_CATALOG_FIXTURE_CREATED");



  const schema = (
    await db.prepare(
      "PRAGMA table_info(client_packages)"
    ).all()
  ).results;

  const available = new Set(
    schema.map(column => column.name)
  );

  const values = {
    allowed_service_ids_json: JSON.stringify(["svc-a"]),
    id: "b04-d6-client-package",
    salon_id: "main",
    client_id: "client-a",
    canonical_client_id: "client-a",
    package_id: "b04-d6-catalog",
    package_catalog_id: "b04-d6-catalog",
    package_name: "B04 Local Package",
    package_name_snapshot: "B04 Local Package",
    name: "B04 Local Package",
    service_ids_json: JSON.stringify(["svc-a"]),
    total_sessions: sessions,
    remaining_sessions: sessions,
    reserved_sessions: 0,
    used_sessions: 0,
    status: "active",
    price_halalas: 22500,
    purchased_at: "2026-11-01T00:00:00.000Z",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    expiry_date: "2099-01-01",
    source: "local-runtime-test"
  };

  const selected = Object.entries(values)
    .filter(([key]) => available.has(key));

  const missing = schema.filter(
    column =>
      column.notnull === 1 &&
      column.dflt_value === null &&
      !selected.some(
        ([key]) => key === column.name
      )
  );

  assert.deepEqual(
    missing.map(column => column.name),
    [],
    "D6 package fixture requires additional fields"
  );


  const verifiedCatalogParent = await db.prepare(
    "SELECT id FROM package_catalog WHERE salon_id = ? AND id = ?"
  ).bind(
    "main",
    "b04-d6-catalog"
  ).first();

  assert.equal(
    verifiedCatalogParent?.id,
    "b04-d6-catalog"
  );

  const verifiedClientParent = await db.prepare(
    "SELECT id FROM clients WHERE salon_id = ? AND canonical_client_id = ?"
  ).bind(
    "main",
    "client-a"
  ).first();

  assert.equal(
    verifiedClientParent?.id,
    "client-a"
  );

  console.log("D6_BOTH_FOREIGN_KEY_PARENTS_VERIFIED");

  await db.prepare(
    "INSERT INTO client_packages (" +
    selected.map(([key]) => key).join(",") +
    ") VALUES (" +
    selected.map(() => "?").join(",") +
    ")"
  ).bind(
    ...selected.map(([,value]) => value)
  ).run();
}

function d6PackagePayload(id, startTime = "15:00") {
  const base = actualBookingPayload(id);

  return {
    ...base,
    startTime,
    items: [
      {
        ...base.items[0],
        cartItemId: "cart-" + id,
        packageCovered: true,
        package_covered: 1,
        clientPackageId: "b04-d6-client-package",
        client_package_id: "b04-d6-client-package",
        quantity: 1
      }
    ]
  };
}

async function d6PackageBalance(db) {
  const row = await db.prepare(`
    SELECT total_sessions,
           remaining_sessions,
           reserved_sessions,
           used_sessions
    FROM client_packages
    WHERE salon_id = ? AND id = ?
  `).bind(
    "main",
    "b04-d6-client-package"
  ).first();

  assert.ok(row);

  return {
    total: Number(row.total_sessions),
    remaining: Number(row.remaining_sessions),
    reserved: Number(row.reserved_sessions),
    used: Number(row.used_sessions)
  };
}

async function d6BookingRequest(db, payload, token = "test:owner1:owner") {
  const response = await guestContractRequest(
    db,
    "/api/core/bookings",
    payload,
    token
  );

  console.log(
    "D6_BOOKING_RESPONSE:",
    JSON.stringify(response)
  );

  return response;
}

async function assertD6Reservation(db, bookingId) {
  const booking = await db.prepare(`
    SELECT *
    FROM bookings
    WHERE salon_id = ? AND id = ?
  `).bind("main", bookingId).first();

  assert.ok(booking);

  const item = await db.prepare(`
    SELECT *
    FROM booking_items
    WHERE salon_id = ? AND booking_id = ?
  `).bind("main", bookingId).first();

  assert.ok(item);
  assert.equal(item.package_covered, 1);
  assert.equal(
    item.client_package_id,
    "b04-d6-client-package"
  );

  assert.ok(item.package_reservation_id);

  const movements = (
    await db.prepare(`
      SELECT *
      FROM package_transactions
      WHERE salon_id = ? AND booking_id = ?
    `).bind("main", bookingId).all()
  ).results;

  assert.equal(movements.length, 1);

  const movement = movements[0];

  assert.equal(
    movement.id,
    item.package_reservation_id
  );

  assert.equal(
    movement.client_package_id,
    item.client_package_id
  );

  assert.equal(
    movement.cart_item_id,
    item.cart_item_id
  );

  assert.equal(
    movement.service_id,
    item.service_id
  );

  return {booking, item, movement};
}

test("B04 D6 package-covered booking commits one reservation", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:3, reserved:0, used:0}
  );

  const payload = d6PackagePayload(
    "b04-d6-first-booking"
  );

  const response = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(response)
  );

  await assertD6Reservation(
    db,
    payload.id
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:1, used:0}
  );
});

test("B04 D6 package-covered booking replay does not reserve twice", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload(
    "b04-d6-exact-replay"
  );

  const first = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(first.status, 200);

  const snapshot = await guestContractSnapshot(db);

  const replay = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(
    replay.status,
    200,
    JSON.stringify(replay)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    snapshot
  );

  await assertD6Reservation(db, payload.id);
});

test("B04 D6 package-covered booking rejects zero remaining balance", async t => {
  const db = await setup(t);
  await seedD6Package(db, 1);

  const first = await d6BookingRequest(
    db,
    d6PackagePayload("b04-d6-exhaust-first", "13:00")
  );

  assert.equal(first.status, 200);

  const snapshot = await guestContractSnapshot(db);

  const second = await d6BookingRequest(
    db,
    d6PackagePayload("b04-d6-exhaust-second", "16:00")
  );

  assert.equal(
    second.status,
    409,
    JSON.stringify(second)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    snapshot
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:1, remaining:0, reserved:1, used:0}
  );
});

test("B04 D6 package-covered booking concurrent requests cannot overspend", async t => {
  const db = await setup(t);
  await seedD6Package(db, 1);

  const payloads = [
    d6PackagePayload("b04-d6-race-a", "13:00"),
    d6PackagePayload("b04-d6-race-b", "16:00")
  ];

  const responses = await Promise.all(
    payloads.map(
      payload => d6BookingRequest(db, payload)
    )
  );

  assert.deepEqual(
    responses.map(response => response.status).sort(),
    [200, 409]
  );

  const rejected = responses.find(
    response => response.status === 409
  );

  const rejectedBody = JSON.parse(rejected.body);

  assert.equal(rejectedBody.ok, false);

  assert.ok(
    [
      "core_booking:package_reservation_missing",
      "core_booking:package_balance_exhausted"
    ].includes(rejectedBody.error),
    JSON.stringify(rejectedBody)
  );


  const winner = responses.findIndex(
    response => response.status === 200
  );

  await assertD6Reservation(
    db,
    payloads[winner].id
  );

  const loser = await db.prepare(`
    SELECT id FROM bookings
    WHERE salon_id = ? AND id = ?
  `).bind(
    "main",
    payloads[1-winner].id
  ).first();

  assert.equal(loser, null);

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:1, remaining:0, reserved:1, used:0}
  );
});

for (const failingTable of [
  "package_transactions",
  "bookings",
  "booking_items",
  "booking_slot_locks",
  "invoices",
  "audit_logs"
]) {
  test(
    "B04 D6 package-covered booking rollback at " + failingTable,
    async t => {
      const db = await setup(t);
      await seedD6Package(db);

      const trigger =
        "b04_d6_fault_" + failingTable;

      await db.prepare(
        "CREATE TRIGGER " + trigger +
        " BEFORE INSERT ON " + failingTable +
        " BEGIN SELECT RAISE(ABORT, 'b04_d6_injected_failure'); END"
      ).run();

      const payload = d6PackagePayload(
        "b04-d6-fault-" + failingTable
      );

      const before = await guestContractSnapshot(db);

      const response = await d6BookingRequest(
        db,
        payload
      );

      assert.ok(
        response.status >= 400,
        "Fault did not reject the booking"
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before,
        "Partial writes after failure in " + failingTable
      );

      assert.deepEqual(
        await d6PackageBalance(db),
        {total:3, remaining:3, reserved:0, used:0}
      );

      await db.prepare(
        "DROP TRIGGER " + trigger
      ).run();

      const retry = await d6BookingRequest(
        db,
        payload
      );

      assert.equal(
        retry.status,
        200,
        JSON.stringify(retry)
      );

      await assertD6Reservation(db, payload.id);

      assert.deepEqual(
        await d6PackageBalance(db),
        {total:3, remaining:2, reserved:1, used:0}
      );
    }
  );
}



test("B04 D6 package-covered booking preserves unexpected database errors", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  await db.prepare(
    "CREATE TRIGGER b04_d6_unrelated_failure " +
    "BEFORE INSERT ON audit_logs " +
    "BEGIN SELECT RAISE(ABORT, 'b04_unrelated_database_failure'); END"
  ).run();

  const payload = d6PackagePayload(
    "b04-d6-unexpected-error"
  );

  const before = await guestContractSnapshot(db);

  const response = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(
    response.status,
    500,
    JSON.stringify(response)
  );

  assert.equal(
    JSON.parse(response.body).error,
    "core_api:internal"
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:3, reserved:0, used:0}
  );
});

async function assertD7FinancialTotals(db, bookingId, expected) {
  const booking = await db.prepare(
    "SELECT * FROM bookings WHERE salon_id = ? AND id = ?"
  ).bind("main", bookingId).first();

  const invoice = await db.prepare(
    "SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ?"
  ).bind("main", bookingId).first();

  assert.ok(booking);
  assert.ok(invoice);

  for (const row of [booking, invoice]) {
    assert.equal(Number(row.subtotal_halalas), expected);
    assert.equal(Number(row.total_halalas), expected);
    assert.equal(Number(row.discount_halalas), 0);
  }

  assert.equal(Number(invoice.paid_halalas), 0);

  const payments = (
    await db.prepare(
      "SELECT * FROM payments WHERE salon_id = ? AND invoice_id = ?"
    ).bind("main", invoice.id).all()
  ).results;

  assert.equal(payments.length, 0);

  const items = (
    await db.prepare(
      "SELECT * FROM booking_items WHERE salon_id = ? AND booking_id = ?"
    ).bind("main", bookingId).all()
  ).results;

  assert.equal(
    items.reduce(
      (sum, item) => sum + Number(item.final_total_halalas),
      0
    ),
    expected
  );

  for (const item of items.filter(row => row.package_covered === 1)) {
    assert.equal(Number(item.unit_price_halalas), 0);
    assert.equal(Number(item.total_halalas), 0);
    assert.equal(Number(item.final_total_halalas), 0);
    assert.equal(Number(item.catalog_unit_price_halalas), 7500);
    assert.ok(item.package_reservation_id);
  }

  return {booking, invoice, items};
}

test("B04 D7 financial covered service has no additional charge", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-covered");

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 200, JSON.stringify(response));

  await assertD7FinancialTotals(db, payload.id, 0);
  await assertD6Reservation(db, payload.id);

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:1, used:0}
  );
});

test("B04 D7 financial ordinary service retains catalog price", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload("b04-d7-ordinary");

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 200, JSON.stringify(response));

  await assertD7FinancialTotals(db, payload.id, 7500);
});

test("B04 D7 financial mixed booking charges uncovered item only", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-mixed", "13:00");

  const covered = {
    ...payload.items[0],
    startTime: "13:00",
    endTime: "13:30"
  };

  const ordinary = {
    ...actualBookingPayload("b04-d7-mixed-ordinary").items[0],
    cartItemId: "b04-d7-mixed-ordinary-cart",
    startTime: "14:00",
    endTime: "14:30"
  };

  payload.items = [covered, ordinary];

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 200, JSON.stringify(response));

  const result = await assertD7FinancialTotals(
    db, payload.id, 7500
  );

  assert.equal(result.items.length, 2);

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:1, used:0}
  );
});

test("B04 D7 financial covered quantity cannot consume multiple services for one session", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-quantity");
  payload.items[0].quantity = 2;

  const before = await guestContractSnapshot(db);

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 400, JSON.stringify(response));

  assert.equal(
    JSON.parse(response.body).error,
    "core_booking:package_quantity_invalid"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D7 financial forged package price cannot create an additional charge", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-forged-price");
  payload.items[0].unitPriceHalalas = 999999;

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 200, JSON.stringify(response));

  await assertD7FinancialTotals(db, payload.id, 0);
});

test("B04 D7 financial package coverage without verified package fails closed", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-missing-package");

  delete payload.items[0].clientPackageId;
  delete payload.items[0].client_package_id;

  const before = await guestContractSnapshot(db);

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 400, JSON.stringify(response));
  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D7 financial exact replay never creates another charge or reservation", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-replay");

  const first = await d6BookingRequest(db, payload);
  assert.equal(first.status, 200);

  await assertD7FinancialTotals(db, payload.id, 0);

  const before = await guestContractSnapshot(db);

  const second = await d6BookingRequest(db, payload);
  assert.equal(second.status, 200);

  assert.deepEqual(await guestContractSnapshot(db), before);
});

for (const column of [
  "unit_price_halalas",
  "total_halalas",
  "final_total_halalas"
]) {
  test(
    "B04 D7 DB rejects package financial mutation " + column,
    async t => {
      const db = await setup(t);
      await seedD6Package(db);

      const payload = d6PackagePayload(
        "b04-d7-db-" + column
      );

      const response = await d6BookingRequest(db, payload);
      assert.equal(response.status, 200, JSON.stringify(response));

      const before = await guestContractSnapshot(db);

      await assert.rejects(
        () => db.prepare(
          "UPDATE booking_items SET " + column +
          " = ? WHERE salon_id = ? AND booking_id = ?"
        ).bind(7500, "main", payload.id).run(),
        /core_booking:package_financial_coverage_invalid/
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );

      await assertD7FinancialTotals(db, payload.id, 0);
    }
  );
}

test("B04 D7 DB permits normal nonfinancial metadata updates", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d7-db-metadata");

  const response = await d6BookingRequest(db, payload);
  assert.equal(response.status, 200);

  const result = await db.prepare(`
    UPDATE booking_items
    SET service_name_snapshot = ?
    WHERE salon_id = ? AND booking_id = ?
  `).bind(
    "Updated local service label",
    "main",
    payload.id
  ).run();

  assert.equal(Number(result.meta.changes), 1);

  await assertD7FinancialTotals(db, payload.id, 0);

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:1, used:0}
  );
});

test("B04 D7 DB ordinary items remain financially chargeable", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload("b04-d7-db-ordinary");

  const response = await d6BookingRequest(db, payload);
  assert.equal(response.status, 200);

  await assertD7FinancialTotals(db, payload.id, 7500);

  // Verify the package-specific trigger does not apply
  // to an ordinary item. This is isolated test data.
  const result = await db.prepare(`
    UPDATE booking_items
    SET unit_price_halalas = 7500,
        total_halalas = 7500,
        final_total_halalas = 7500
    WHERE salon_id = ? AND booking_id = ?
  `).bind("main", payload.id).run();

  assert.equal(Number(result.meta.changes), 1);

  await assertD7FinancialTotals(db, payload.id, 7500);
});

test("B04 D7 DB financial triggers are installed", async t => {
  const db = await setup(t);

  const triggers = (
    await db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'trigger'
        AND name IN (?, ?)
      ORDER BY name
    `).bind(
      "trg_booking_item_package_financial_insert",
      "trg_booking_item_package_financial_update"
    ).all()
  ).results;

  assert.deepEqual(
    triggers.map(row => row.name),
    [
      "trg_booking_item_package_financial_insert",
      "trg_booking_item_package_financial_update"
    ]
  );
});

test("B04 D7 DB rejects a positive charge during covered booking insertion", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  // Create a synthetic fault at the insert boundary.
  // The production booking path remains unchanged.
  await db.prepare(`
    CREATE TRIGGER b04_d7_inject_invalid_covered_charge
    AFTER INSERT ON booking_items
    WHEN NEW.package_covered = 1
    BEGIN
      UPDATE booking_items
      SET final_total_halalas = 7500
      WHERE salon_id = NEW.salon_id AND id = NEW.id;
    END
  `).run();

  const payload = d6PackagePayload("b04-d7-db-fault");

  const before = await guestContractSnapshot(db);

  const response = await d6BookingRequest(db, payload);

  assert.ok(response.status >= 400);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:3, reserved:0, used:0}
  );

  await db.prepare(
    "DROP TRIGGER b04_d7_inject_invalid_covered_charge"
  ).run();

  const retry = await d6BookingRequest(db, payload);

  assert.equal(retry.status, 200);

  await assertD7FinancialTotals(db, payload.id, 0);
  await assertD6Reservation(db, payload.id);
});

async function d73FinancialRows(db, table, bookingId, invoiceId) {
  assert.ok(
    ["payments", "income_entries"].includes(table)
  );

  const schema = (
    await db.prepare(
      "PRAGMA table_info(" + table + ")"
    ).all()
  ).results;

  const columns = new Set(
    schema.map(row => row.name)
  );

  const conditions = [];
  const params = ["main"];

  if (columns.has("booking_id")) {
    conditions.push("booking_id = ?");
    params.push(bookingId);
  }

  if (columns.has("invoice_id")) {
    conditions.push("invoice_id = ?");
    params.push(invoiceId);
  }

  assert.ok(
    conditions.length > 0,
    "Financial table has no supported booking reference"
  );

  return (
    await db.prepare(
      "SELECT * FROM " + table +
      " WHERE salon_id = ? AND (" +
      conditions.join(" OR ") + ")"
    ).bind(...params).all()
  ).results;
}

test("B04 D73 settlement covered booking creates no cash movement", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload(
    "b04-d73-covered"
  );

  const response = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(response.status, 200);

  const {booking, invoice} =
    await assertD7FinancialTotals(
      db,
      payload.id,
      0
    );

  assert.equal(
    Number(invoice.total_halalas) -
    Number(invoice.paid_halalas),
    0
  );

  assert.deepEqual(
    await d73FinancialRows(
      db,
      "payments",
      booking.id,
      invoice.id
    ),
    []
  );

  assert.deepEqual(
    await d73FinancialRows(
      db,
      "income_entries",
      booking.id,
      invoice.id
    ),
    []
  );

  console.log(
    "D73_COVERED_FINANCIAL_STATE:",
    JSON.stringify({
      bookingId: booking.id,
      invoiceId: invoice.id,
      bookingPaymentStatus: booking.payment_status,
      invoiceStatus: invoice.status,
      totalHalalas: invoice.total_halalas,
      paidHalalas: invoice.paid_halalas,
      outstandingHalalas:
        Number(invoice.total_halalas) -
        Number(invoice.paid_halalas)
    })
  );
});

test("B04 D73 settlement ordinary booking retains its outstanding balance", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "b04-d73-ordinary"
  );

  const response = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(response.status, 200);

  const {booking, invoice} =
    await assertD7FinancialTotals(
      db,
      payload.id,
      7500
    );

  assert.equal(booking.payment_status, "unpaid");
  assert.equal(invoice.status, "unpaid");

  assert.equal(
    Number(invoice.total_halalas) -
    Number(invoice.paid_halalas),
    7500
  );

  assert.deepEqual(
    await d73FinancialRows(
      db,
      "income_entries",
      booking.id,
      invoice.id
    ),
    []
  );
});

test("B04 D73 settlement package replay preserves financial evidence", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload(
    "b04-d73-replay"
  );

  const first = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(first.status, 200);

  const initial = await assertD7FinancialTotals(
    db,
    payload.id,
    0
  );

  const before = await guestContractSnapshot(db);

  const replay = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(replay.status, 200);

  const current = await assertD7FinancialTotals(
    db,
    payload.id,
    0
  );

  assert.equal(
    current.invoice.id,
    initial.invoice.id
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 D73 settlement mixed booking does not recognize package coverage as new income", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload(
    "b04-d73-mixed",
    "13:00"
  );

  payload.items = [
    {
      ...payload.items[0],
      startTime: "13:00",
      endTime: "13:30"
    },
    {
      ...actualBookingPayload(
        "b04-d73-mixed-ordinary"
      ).items[0],
      cartItemId: "b04-d73-ordinary-cart",
      startTime: "14:00",
      endTime: "14:30"
    }
  ];

  const response = await d6BookingRequest(
    db,
    payload
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(response)
  );

  const {booking, invoice, items} =
    await assertD7FinancialTotals(
      db,
      payload.id,
      7500
    );

  assert.equal(items.length, 2);
  assert.equal(booking.payment_status, "unpaid");
  assert.equal(invoice.status, "unpaid");

  assert.equal(
    Number(invoice.total_halalas) -
    Number(invoice.paid_halalas),
    7500
  );

  assert.deepEqual(
    await d73FinancialRows(
      db,
      "income_entries",
      booking.id,
      invoice.id
    ),
    []
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:1, used:0}
  );
});

async function d73DirectPayment(
  db,
  invoice,
  amountHalalas,
  operationId,
  overrides = {}
) {
  const {createPayment} = await import(
    "./core/repositories/payments.js"
  );

  return createPayment(
    db,
    "main",
    {
      id: operationId,
      invoiceId: invoice.id,
      bookingId: invoice.booking_id,
      clientId: invoice.client_id,
      amountHalalas,
      method: "cash",
      status: "paid",
      idempotencyKey: operationId,
      ...overrides
    },
    {uid: "owner1", role: "owner"}
  );
}

test("B04 D73 guard ordinary payment remains supported", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload("b04-d73-guard-ordinary");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 7500);

  await d73DirectPayment(db, invoice, 7500, "d73-ordinary-pay");

  const current = await db.prepare(
    "SELECT * FROM invoices WHERE salon_id = ? AND id = ?"
  ).bind("main", invoice.id).first();

  assert.equal(current.paid_halalas, 7500);
  assert.equal(current.status, "paid");

  const payments = await d73FinancialRows(
    db, "payments", payload.id, invoice.id
  );

  const income = await d73FinancialRows(
    db, "income_entries", payload.id, invoice.id
  );

  assert.equal(payments.length, 1);
  assert.equal(income.length, 1);
  assert.equal(payments[0].amount_halalas, 7500);
  assert.equal(income[0].amount_halalas, 7500);
});

test("B04 D73 guard covered invoice rejects additional collection", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d73-guard-covered");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 0);
  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(db, invoice, 7500, "d73-covered-pay"),
    error =>
      error?.status === 409 &&
      error?.code === "core_payment:package_covered_no_collection"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D73 guard booking-only reference cannot bypass protection", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d73-guard-booking-only");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 0);
  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d73-booking-only-pay",
      {invoiceId: undefined}
    ),
    error => error?.code === "core_payment:package_covered_no_collection"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D73 guard invoice-only reference cannot bypass protection", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d73-guard-invoice-only");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 0);
  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d73-invoice-only-pay",
      {bookingId: undefined}
    ),
    error => error?.code === "core_payment:package_covered_no_collection"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D73 guard mixed booking accepts uncovered service payment", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d73-guard-mixed", "13:00");

  payload.items = [
    {
      ...payload.items[0],
      startTime: "13:00",
      endTime: "13:30"
    },
    {
      ...actualBookingPayload("d73-mixed-extra").items[0],
      cartItemId: "d73-mixed-extra",
      startTime: "14:00",
      endTime: "14:30"
    }
  ];

  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 7500);

  await d73DirectPayment(db, invoice, 7500, "d73-mixed-pay");

  const current = await db.prepare(
    "SELECT paid_halalas,status FROM invoices WHERE salon_id = ? AND id = ?"
  ).bind("main", invoice.id).first();

  assert.equal(current.paid_halalas, 7500);
  assert.equal(current.status, "paid");

  const income = await d73FinancialRows(
    db, "income_entries", payload.id, invoice.id
  );

  assert.equal(income.length, 1);
  assert.equal(income[0].amount_halalas, 7500);

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:1, used:0}
  );
});

test("B04 D73 guard preserves legitimate ordinary overpayment", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload("b04-d73-guard-overpayment");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 7500);

  await d73DirectPayment(db, invoice, 8000, "d73-ordinary-overpay");

  const current = await db.prepare(
    "SELECT paid_halalas,total_halalas FROM invoices WHERE salon_id = ? AND id = ?"
  ).bind("main", invoice.id).first();

  assert.equal(current.paid_halalas, 8000);
  assert.equal(current.total_halalas, 7500);
});

test("B04 D73 guard concurrent covered payments leave no financial mutation", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d73-guard-concurrent");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 0);
  const before = await guestContractSnapshot(db);

  const results = await Promise.allSettled([
    d73DirectPayment(db, invoice, 7500, "d73-race-pay-a"),
    d73DirectPayment(db, invoice, 7500, "d73-race-pay-b")
  ]);

  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.equal(
      result.reason.code,
      "core_payment:package_covered_no_collection"
    );
  }

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D73 guard direct SQL insertion is rejected atomically", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload("b04-d73-guard-direct-sql");
  assert.equal((await d6BookingRequest(db, payload)).status, 200);

  const {invoice} = await assertD7FinancialTotals(db, payload.id, 0);
  const before = await guestContractSnapshot(db);
  const now = new Date().toISOString();

  await assert.rejects(
    () => db.prepare(`
      INSERT INTO payments (
        id,salon_id,invoice_id,booking_id,client_id,
        method,amount_halalas,status,paid_at,created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      "d73-direct-payment",
      "main",
      invoice.id,
      payload.id,
      invoice.client_id,
      "cash",
      7500,
      "paid",
      now,
      now
    ).run(),
    /core_payment:package_covered_no_collection/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

async function d74OrdinaryInvoice(db, id) {
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(id);

  assert.equal(
    (await d6BookingRequest(db, payload)).status,
    200
  );

  const {invoice} = await assertD7FinancialTotals(
    db, payload.id, 7500
  );

  return invoice;
}

test("B04 D74 rejects mismatched booking reference", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-booking-mismatch"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d74-booking-op",
      {bookingId: "different-booking"}
    ),
    error =>
      error?.status === 409 &&
      error?.code === "core_payment:reference_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects mismatched client reference", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-client-mismatch"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d74-client-op",
      {clientId: "different-client"}
    ),
    error =>
      error?.status === 409 &&
      error?.code === "core_payment:reference_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects conflicting invoice aliases", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-invoice-alias"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d74-invoice-alias-op",
      {invoice_id: "another-invoice"}
    ),
    error => error?.code === "core_payment:reference_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects conflicting booking aliases", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-booking-alias"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d74-booking-alias-op",
      {booking_id: "another-booking"}
    ),
    error => error?.code === "core_payment:reference_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects conflicting client aliases", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-client-alias"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 7500, "d74-client-alias-op",
      {client_id: "another-client"}
    ),
    error => error?.code === "core_payment:reference_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 preserves exact committed payment replay", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-exact-replay"
  );

  const first = await d73DirectPayment(
    db, invoice, 4000, "d74-exact-op"
  );

  const before = await guestContractSnapshot(db);

  const replay = await d73DirectPayment(
    db, invoice, 4000, "d74-exact-op"
  );

  assert.equal(first.id, replay.id);
  assert.equal(replay.idempotent, true);

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects replay with changed payment amount", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-amount-replay"
  );

  await d73DirectPayment(
    db, invoice, 3000, "d74-amount-op"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 4000, "d74-amount-op"
    ),
    error =>
      error?.status === 409 &&
      error?.code === "core_payment:idempotency_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects replay with changed payment method", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-method-replay"
  );

  await d73DirectPayment(
    db, invoice, 3000, "d74-method-op"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 3000, "d74-method-op",
      {method: "card"}
    ),
    error => error?.code === "core_payment:idempotency_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 rejects replay with changed invoice reference", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-invoice-replay"
  );

  await d73DirectPayment(
    db, invoice, 3000, "d74-invoice-replay-op"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d73DirectPayment(
      db, invoice, 3000, "d74-invoice-replay-op",
      {invoiceId: "another-invoice"}
    ),
    error => error?.code === "core_payment:idempotency_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D74 preserves concurrent identical payment replay", async t => {
  const db = await setup(t);
  const invoice = await d74OrdinaryInvoice(
    db, "d74-concurrent-replay"
  );

  const rows = await Promise.all([
    d73DirectPayment(
      db, invoice, 3000, "d74-concurrent-op"
    ),
    d73DirectPayment(
      db, invoice, 3000, "d74-concurrent-op"
    )
  ]);

  assert.equal(rows[0].id, rows[1].id);

  const payments = await d73FinancialRows(
    db, "payments", invoice.booking_id, invoice.id
  );

  const income = await d73FinancialRows(
    db, "income_entries", invoice.booking_id, invoice.id
  );

  assert.equal(payments.length, 1);
  assert.equal(income.length, 1);
  assert.equal(payments[0].amount_halalas, 3000);

  const current = await db.prepare(
    "SELECT paid_halalas FROM invoices WHERE salon_id = ? AND id = ?"
  ).bind("main", invoice.id).first();

  assert.equal(current.paid_halalas, 3000);
});

async function d75InsertPaymentRow(db, invoice, overrides = {}) {
  const now = new Date().toISOString();

  const values = {
    id: "d75-local-payment",
    salon_id: "main",
    invoice_id: invoice.id,
    booking_id: invoice.booking_id,
    client_id: invoice.client_id,
    method: "cash",
    amount_halalas: 1000,
    status: "paid",
    paid_at: now,
    created_at: now,
    ...overrides
  };

  const columns = Object.keys(values);

  return db.prepare(
    "INSERT INTO payments (" +
    columns.join(",") +
    ") VALUES (" +
    columns.map(() => "?").join(",") +
    ")"
  ).bind(
    ...Object.values(values)
  ).run();
}

test("B04 D75 DB rejects conflicting booking reference", async t => {
  const db = await setup(t);

  const invoice = await d74OrdinaryInvoice(
    db, "d75-invalid-booking"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d75InsertPaymentRow(
      db, invoice,
      {booking_id: "different-booking"}
    ),
    /core_payment:reference_conflict/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D75 DB rejects conflicting client reference", async t => {
  const db = await setup(t);

  const invoice = await d74OrdinaryInvoice(
    db, "d75-invalid-client"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d75InsertPaymentRow(
      db, invoice,
      {client_id: "different-client"}
    ),
    /core_payment:reference_conflict/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D75 DB rejects missing invoice reference", async t => {
  const db = await setup(t);

  const invoice = await d74OrdinaryInvoice(
    db, "d75-invalid-invoice"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d75InsertPaymentRow(
      db, invoice,
      {invoice_id: "different-invoice"}
    ),
    /core_payment:reference_conflict/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D75 DB rejects cross-tenant references", async t => {
  const db = await setup(t);

  const invoice = await d74OrdinaryInvoice(
    db, "d75-tenant"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => d75InsertPaymentRow(
      db, invoice,
      {salon_id: "another-tenant"}
    ),
    /core_payment:reference_conflict/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

for (const column of [
  "invoice_id",
  "booking_id",
  "client_id",
  "salon_id",
  "id"
]) {
  test(
    "B04 D75 DB preserves established payment identity " + column,
    async t => {
      const db = await setup(t);

      const invoice = await d74OrdinaryInvoice(
        db, "d75-immutable-" + column
      );

      const payment = await d73DirectPayment(
        db,
        invoice,
        3000,
        "d75-op-" + column
      );

      const before = await guestContractSnapshot(db);

      await assert.rejects(
        () => db.prepare(
          "UPDATE payments SET " + column +
          " = ? WHERE salon_id = ? AND id = ?"
        ).bind(
          "different-reference",
          "main",
          payment.id
        ).run(),
        /core_payment:reference_immutable/
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );
    }
  );
}

test("B04 D75 DB preserves legitimate partial payment and replay", async t => {
  const db = await setup(t);

  const invoice = await d74OrdinaryInvoice(
    db, "d75-normal-payment"
  );

  const first = await d73DirectPayment(
    db, invoice, 3000, "d75-normal-op"
  );

  const before = await guestContractSnapshot(db);

  const replay = await d73DirectPayment(
    db, invoice, 3000, "d75-normal-op"
  );

  assert.equal(first.id, replay.id);
  assert.equal(replay.idempotent, true);

  assert.deepEqual(await guestContractSnapshot(db), before);

  const current = await db.prepare(
    "SELECT paid_halalas,total_halalas FROM invoices WHERE salon_id = ? AND id = ?"
  ).bind("main", invoice.id).first();

  assert.equal(current.paid_halalas, 3000);
  assert.equal(current.total_halalas, 7500);
});

test("B04 D75 DB permits no-op payment reference updates", async t => {
  const db = await setup(t);

  const invoice = await d74OrdinaryInvoice(
    db, "d75-noop"
  );

  const payment = await d73DirectPayment(
    db, invoice, 3000, "d75-noop-op"
  );

  const before = await guestContractSnapshot(db);

  const result = await db.prepare(`
    UPDATE payments
    SET invoice_id = invoice_id,
        booking_id = booking_id,
        client_id = client_id
    WHERE salon_id = ? AND id = ?
  `).bind("main", payment.id).run();

  assert.equal(Number(result.meta.changes), 1);

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D75 DB prevents pending package payment from becoming collected", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload(
    "d75-pending-package"
  );

  assert.equal(
    (await d6BookingRequest(db, payload)).status,
    200
  );

  const {invoice} = await assertD7FinancialTotals(
    db, payload.id, 0
  );

  await d75InsertPaymentRow(
    db,
    invoice,
    {
      id: "d75-pending-row",
      status: "pending",
      paid_at: null
    }
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => db.prepare(`
      UPDATE payments
      SET status = 'paid'
      WHERE salon_id = ? AND id = ?
    `).bind(
      "main",
      "d75-pending-row"
    ).run(),
    /core_payment:package_covered_no_collection/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 D75 DB reference and settlement triggers are installed", async t => {
  const db = await setup(t);

  const rows = (
    await db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'trigger'
        AND name IN (?, ?, ?)
      ORDER BY name
    `).bind(
      "trg_payment_reference_integrity_insert",
      "trg_payment_reference_identity_immutable",
      "trg_payment_package_covered_zero_total_update"
    ).all()
  ).results;

  assert.deepEqual(
    rows.map(row => row.name),
    [
      "trg_payment_package_covered_zero_total_update",
      "trg_payment_reference_identity_immutable",
      "trg_payment_reference_integrity_insert"
    ]
  );
});

async function e1BookingRepository() {
  return import("./core/repositories/bookings.js");
}

async function e1CreateCoveredBooking(
  db,
  id,
  startTime = "15:00"
) {
  await seedD6Package(db);

  const payload = d6PackagePayload(id, startTime);

  const result = await d6BookingRequest(db, payload);

  assert.equal(result.status, 200, JSON.stringify(result));

  await assertD7FinancialTotals(db, id, 0);
  await assertD6Reservation(db, id);

  return payload;
}

async function e1BookingState(db, id) {
  return db.prepare(`
    SELECT *
    FROM bookings
    WHERE salon_id = ? AND id = ?
  `).bind("main", id).first();
}

async function e1Ledger(db, id) {
  return (
    await db.prepare(`
      SELECT *
      FROM package_transactions
      WHERE salon_id = ? AND booking_id = ?
      ORDER BY created_at, id
    `).bind("main", id).all()
  ).results;
}

async function e1Locks(db, id) {
  return (
    await db.prepare(`
      SELECT *
      FROM booking_slot_locks
      WHERE salon_id = ? AND booking_id = ?
    `).bind("main", id).all()
  ).results;
}

async function e1Evidence(db, id) {
  const booking = await e1BookingState(db, id);

  const balance = await d6PackageBalance(db);
  const ledger = await e1Ledger(db, id);
  const locks = await e1Locks(db, id);

  const evidence = {
    bookingId: id,
    status: booking?.status,
    deletedAt: booking?.deleted_at,
    completedAt: booking?.completed_at,
    cancelledAt: booking?.cancelled_at,
    balance,
    movements: ledger.map(row => ({
      id: row.id,
      type: row.type,
      packageId: row.client_package_id,
      clientId: row.canonical_client_id,
      cartItemId: row.cart_item_id,
      serviceId: row.service_id,
      remainingBefore: row.remaining_before,
      remainingAfter: row.remaining_after,
      reservedBefore: row.reserved_before,
      reservedAfter: row.reserved_after,
      usedBefore: row.used_before,
      usedAfter: row.used_after
    })),
    lockCount: locks.length
  };

  console.log(
    "E1_LIFECYCLE_EVIDENCE:",
    JSON.stringify(evidence)
  );

  return evidence;
}

const e1Actor = {
  uid: "owner1",
  role: "owner"
};

test("B04 E1 ordinary booking completion control", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "e1-ordinary-complete"
  );

  assert.equal(
    (await d6BookingRequest(db, payload)).status,
    200
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const booking = await e1BookingState(
    db, payload.id
  );

  assert.equal(booking.status, "completed");
  assert.ok(booking.completed_at);

  await assertD7FinancialTotals(
    db, payload.id, 7500
  );
});

test("B04 E1 ordinary booking cancellation control", async t => {
  const db = await setup(t);
  await seedActualCoreBooking(db);

  const payload = actualBookingPayload(
    "e1-ordinary-cancel"
  );

  assert.equal(
    (await d6BookingRequest(db, payload)).status,
    200
  );

  const repo = await e1BookingRepository();

  await repo.cancelBooking(
    db, "main", payload.id,
    "local lifecycle test"
  );

  const booking = await e1BookingState(
    db, payload.id
  );

  assert.equal(booking.status, "cancelled");
  assert.ok(booking.cancelled_at);

  assert.equal(
    (await e1Locks(db, payload.id)).length,
    0
  );
});

test("B04 E1 covered completion consumes reserved session", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-covered-complete"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const result = await e1Evidence(db, payload.id);

  assert.equal(result.status, "completed");

  assert.deepEqual(
    result.balance,
    {total:3, remaining:2, reserved:0, used:1}
  );

  assert.deepEqual(
    result.movements.map(row => row.type),
    ["reserve", "consume"]
  );

  await assertD7FinancialTotals(db, payload.id, 0);
});

test("B04 E1 covered cancellation releases reserved session", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-covered-cancel"
  );

  const repo = await e1BookingRepository();

  await repo.cancelBooking(
    db, "main", payload.id,
    "local lifecycle cancellation"
  );

  const result = await e1Evidence(db, payload.id);

  assert.equal(result.status, "cancelled");
  assert.equal(result.lockCount, 0);

  assert.deepEqual(
    result.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );

  assert.deepEqual(
    result.movements.map(row => row.type),
    ["reserve", "release"]
  );

  await assertD7FinancialTotals(db, payload.id, 0);
});

test("B04 E1 covered deletion cannot strand reserved session", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-covered-delete"
  );

  const repo = await e1BookingRepository();

  await repo.deleteBooking(
    db, "main", payload.id, e1Actor
  );

  const result = await e1Evidence(db, payload.id);

  assert.equal(result.status, "cancelled");
  assert.ok(result.deletedAt);
  assert.equal(result.lockCount, 0);

  assert.deepEqual(
    result.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );

  assert.deepEqual(
    result.movements.map(row => row.type),
    ["reserve", "release"]
  );

  await assertD7FinancialTotals(db, payload.id, 0);
});

test("B04 E1 completion retry does not consume twice", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-complete-retry"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const first = await e1Evidence(db, payload.id);

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const second = await e1Evidence(db, payload.id);

  assert.deepEqual(
    second.balance,
    {total:3, remaining:2, reserved:0, used:1}
  );

  assert.deepEqual(
    second.movements,
    first.movements
  );

  assert.deepEqual(
    second.movements.map(row => row.type),
    ["reserve", "consume"]
  );

  assert.equal(
    second.completedAt,
    first.completedAt
  );
});

test("B04 E1 cancellation retry does not release twice", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-cancel-retry"
  );

  const repo = await e1BookingRepository();

  await repo.cancelBooking(
    db, "main", payload.id, "retry test"
  );

  const first = await e1Evidence(db, payload.id);

  await repo.cancelBooking(
    db, "main", payload.id, "retry test"
  );

  const second = await e1Evidence(db, payload.id);

  assert.deepEqual(
    second.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );

  assert.deepEqual(
    second.movements,
    first.movements
  );

  assert.deepEqual(
    second.movements.map(row => row.type),
    ["reserve", "release"]
  );

  assert.equal(
    second.cancelledAt,
    first.cancelledAt
  );
});

for (const operation of [
  "completeBooking",
  "cancelBooking",
  "deleteBooking"
]) {
  test(
    "B04 E1 rollback on package balance failure " + operation,
    async t => {
      const db = await setup(t);

      const payload = await e1CreateCoveredBooking(
        db,
        "e1-fault-" + operation
      );

      const repo = await e1BookingRepository();

      await db.prepare(`
        CREATE TRIGGER e1_balance_fault
        BEFORE UPDATE ON client_packages
        BEGIN
          SELECT RAISE(ABORT, 'e1_balance_write_failed');
        END
      `).run();

      const before = await guestContractSnapshot(db);

      let failure = null;

      try {
        await repo[operation](
          db,
          "main",
          payload.id,
          operation === "cancelBooking"
            ? "fault injection"
            : e1Actor
        );
      } catch (error) {
        failure = error;
      }

      await e1Evidence(db, payload.id);

      assert.ok(
        failure,
        "Booking mutation ignored failed package balance write"
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );
    }
  );
}

test("B04 E1 completion rolls back if ledger write fails", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-ledger-fault"
  );

  const repo = await e1BookingRepository();

  await db.prepare(`
    CREATE TRIGGER e1_ledger_fault
    BEFORE INSERT ON package_transactions
    WHEN NEW.type = 'consume'
    BEGIN
      SELECT RAISE(ABORT, 'e1_ledger_write_failed');
    END
  `).run();

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.completeBooking(
      db, "main", payload.id, e1Actor
    )
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 E1 cancellation rolls back if release ledger fails", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-release-fault"
  );

  const repo = await e1BookingRepository();

  await db.prepare(`
    CREATE TRIGGER e1_release_fault
    BEFORE INSERT ON package_transactions
    WHEN NEW.type = 'release'
    BEGIN
      SELECT RAISE(ABORT, 'e1_release_write_failed');
    END
  `).run();

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.cancelBooking(
      db, "main", payload.id, "release fault"
    )
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 E1 concurrent duplicate completion preserves one consume", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-concurrent-complete"
  );

  const repo = await e1BookingRepository();

  const results = await Promise.allSettled([
    repo.completeBooking(
      db, "main", payload.id, e1Actor
    ),
    repo.completeBooking(
      db, "main", payload.id, e1Actor
    )
  ]);

  assert.ok(
    results.some(row => row.status === "fulfilled")
  );

  const state = await e1Evidence(db, payload.id);

  assert.equal(state.status, "completed");

  assert.deepEqual(
    state.balance,
    {total:3, remaining:2, reserved:0, used:1}
  );

  assert.equal(
    state.movements.filter(
      row => row.type === "consume"
    ).length,
    1
  );
});

test("B04 E1 concurrent duplicate cancellation preserves one release", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e1-concurrent-cancel"
  );

  const repo = await e1BookingRepository();

  const results = await Promise.allSettled([
    repo.cancelBooking(
      db, "main", payload.id, "duplicate cancel"
    ),
    repo.cancelBooking(
      db, "main", payload.id, "duplicate cancel"
    )
  ]);

  assert.ok(
    results.some(row => row.status === "fulfilled")
  );

  const state = await e1Evidence(db, payload.id);

  assert.equal(state.status, "cancelled");

  assert.deepEqual(
    state.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );

  assert.equal(
    state.movements.filter(
      row => row.type === "release"
    ).length,
    1
  );

  assert.equal(state.lockCount, 0);
});

async function e3CreateMultiCoveredBooking(db, id) {
  await seedD6Package(db);

  const payload = d6PackagePayload(id, "13:00");

  const first = {
    ...payload.items[0],
    startTime: "13:00",
    endTime: "13:30"
  };

  const second = {
    ...payload.items[0],
    id: "item-" + id + "-second",
    cartItemId: "cart-" + id + "-second",
    startTime: "14:00",
    endTime: "14:30"
  };

  payload.items = [first, second];

  const response = await d6BookingRequest(db, payload);

  assert.equal(response.status, 200, JSON.stringify(response));

  const rows = await e1Ledger(db, id);

  assert.equal(
    rows.filter(row => row.type === "reserve").length,
    2
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:1, reserved:2, used:0}
  );

  await assertD7FinancialTotals(db, id, 0);

  return payload;
}

test("B04 E3 multi-item completion consumes both reservations atomically", async t => {
  const db = await setup(t);

  const payload = await e3CreateMultiCoveredBooking(
    db, "e3-multi-complete"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const result = await e1Evidence(db, payload.id);

  assert.equal(result.status, "completed");

  assert.deepEqual(
    result.balance,
    {total:3, remaining:1, reserved:0, used:2}
  );

  assert.equal(
    result.movements.filter(row => row.type === "consume").length,
    2
  );

  const booking = await e1BookingState(db, payload.id);

  assert.equal(Number(booking.package_sessions_used), 2);

  await assertD7FinancialTotals(db, payload.id, 0);
});

test("B04 E3 multi-item cancellation releases both reservations atomically", async t => {
  const db = await setup(t);

  const payload = await e3CreateMultiCoveredBooking(
    db, "e3-multi-cancel"
  );

  const repo = await e1BookingRepository();

  await repo.cancelBooking(
    db, "main", payload.id, "multi-item cancellation"
  );

  const result = await e1Evidence(db, payload.id);

  assert.equal(result.status, "cancelled");

  assert.deepEqual(
    result.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );

  assert.equal(
    result.movements.filter(row => row.type === "release").length,
    2
  );

  assert.equal(result.lockCount, 0);

  await assertD7FinancialTotals(db, payload.id, 0);
});

test("B04 E3 second consume failure rolls back every session transition", async t => {
  const db = await setup(t);

  const payload = await e3CreateMultiCoveredBooking(
    db, "e3-second-consume-fault"
  );

  const repo = await e1BookingRepository();

  await db.prepare(`
    CREATE TRIGGER e3_second_consume_fault
    BEFORE INSERT ON package_transactions
    WHEN NEW.type = 'consume'
      AND EXISTS (
        SELECT 1 FROM package_transactions
        WHERE salon_id = NEW.salon_id
          AND booking_id = NEW.booking_id
          AND type = 'consume'
      )
    BEGIN
      SELECT RAISE(ABORT, 'e3_second_consume_failed');
    END
  `).run();

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.completeBooking(
      db, "main", payload.id, e1Actor
    ),
    /e3_second_consume_failed/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);

  await db.prepare(
    "DROP TRIGGER e3_second_consume_fault"
  ).run();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:1, reserved:0, used:2}
  );
});

test("B04 E3 second release failure rolls back all items and booking cancellation", async t => {
  const db = await setup(t);

  const payload = await e3CreateMultiCoveredBooking(
    db, "e3-second-release-fault"
  );

  const repo = await e1BookingRepository();

  await db.prepare(`
    CREATE TRIGGER e3_second_release_fault
    BEFORE INSERT ON package_transactions
    WHEN NEW.type = 'release'
      AND EXISTS (
        SELECT 1 FROM package_transactions
        WHERE salon_id = NEW.salon_id
          AND booking_id = NEW.booking_id
          AND type = 'release'
      )
    BEGIN
      SELECT RAISE(ABORT, 'e3_second_release_failed');
    END
  `).run();

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.cancelBooking(
      db, "main", payload.id, "second release fault"
    ),
    /e3_second_release_failed/
  );

  assert.deepEqual(await guestContractSnapshot(db), before);

  await db.prepare(
    "DROP TRIGGER e3_second_release_fault"
  ).run();

  await repo.cancelBooking(
    db, "main", payload.id, "retry after failure"
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:3, reserved:0, used:0}
  );
});

test("B04 E3 completed covered booking cannot be silently cancelled", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e3-completed-cancel"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.cancelBooking(
      db, "main", payload.id, "invalid reversal"
    ),
    error =>
      error?.status === 409 &&
      error?.code === "core_booking:package_transition_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 E3 completed covered booking cannot be silently deleted", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e3-completed-delete"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.deleteBooking(
      db, "main", payload.id, e1Actor
    ),
    error =>
      error?.status === 409 &&
      error?.code === "core_booking:package_transition_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 E3 cancelled covered booking cannot be completed without explicit reapplication", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e3-cancelled-complete"
  );

  const repo = await e1BookingRepository();

  await repo.cancelBooking(
    db, "main", payload.id, "cancel before complete"
  );

  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.completeBooking(
      db, "main", payload.id, e1Actor
    ),
    error =>
      error?.status === 409 &&
      error?.code === "core_booking:package_transition_conflict"
  );

  assert.deepEqual(await guestContractSnapshot(db), before);
});

test("B04 E3 concurrent completion and cancellation cannot both commit", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e3-opposite-transitions"
  );

  const repo = await e1BookingRepository();

  const results = await Promise.allSettled([
    repo.completeBooking(
      db, "main", payload.id, e1Actor
    ),
    repo.cancelBooking(
      db, "main", payload.id, "concurrent cancellation"
    )
  ]);

  assert.equal(
    results.filter(row => row.status === "fulfilled").length,
    1
  );

  const result = await e1Evidence(db, payload.id);

  if (result.status === "completed") {
    assert.deepEqual(
      result.balance,
      {total:3, remaining:2, reserved:0, used:1}
    );

    assert.deepEqual(
      result.movements.map(row => row.type),
      ["reserve", "consume"]
    );
  } else {
    assert.equal(result.status, "cancelled");

    assert.deepEqual(
      result.balance,
      {total:3, remaining:3, reserved:0, used:0}
    );

    assert.deepEqual(
      result.movements.map(row => row.type),
      ["reserve", "release"]
    );

    assert.equal(result.lockCount, 0);
  }

  await assertD7FinancialTotals(db, payload.id, 0);
});

for (const operation of [
  "completeBooking",
  "cancelBooking",
  "deleteBooking"
]) {
  test(
    "B04 E3 audit failure rolls back lifecycle " + operation,
    async t => {
      const db = await setup(t);

      const payload = await e1CreateCoveredBooking(
        db, "e3-audit-" + operation
      );

      const repo = await e1BookingRepository();

      await db.prepare(`
        CREATE TRIGGER e3_audit_fault
        BEFORE INSERT ON audit_logs
        BEGIN
          SELECT RAISE(ABORT, 'e3_audit_write_failed');
        END
      `).run();

      const before = await guestContractSnapshot(db);

      await assert.rejects(
        () => repo[operation](
          db,
          "main",
          payload.id,
          operation === "cancelBooking"
            ? "audit failure"
            : e1Actor
        ),
        /e3_audit_write_failed/
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );

      await db.prepare(
        "DROP TRIGGER e3_audit_fault"
      ).run();

      await repo[operation](
        db,
        "main",
        payload.id,
        operation === "cancelBooking"
          ? "retry after audit failure"
          : e1Actor
      );

      const current = await e1BookingState(
        db, payload.id
      );

      assert.equal(
        current.status,
        operation === "completeBooking"
          ? "completed"
          : "cancelled"
      );
    }
  );
}

test("B04 E3 completion preserves original financial records", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e3-financial-preservation"
  );

  const {invoice} = await assertD7FinancialTotals(
    db, payload.id, 0
  );

  const beforeInvoice = await db.prepare(`
    SELECT * FROM invoices
    WHERE salon_id = ? AND id = ?
  `).bind("main", invoice.id).first();

  const beforePayments = await d73FinancialRows(
    db, "payments", payload.id, invoice.id
  );

  const beforeIncome = await d73FinancialRows(
    db, "income_entries", payload.id, invoice.id
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const afterInvoice = await db.prepare(`
    SELECT * FROM invoices
    WHERE salon_id = ? AND id = ?
  `).bind("main", invoice.id).first();

  assert.deepEqual(afterInvoice, beforeInvoice);

  assert.deepEqual(
    await d73FinancialRows(
      db, "payments", payload.id, invoice.id
    ),
    beforePayments
  );

  assert.deepEqual(
    await d73FinancialRows(
      db, "income_entries", payload.id, invoice.id
    ),
    beforeIncome
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:0, used:1}
  );
});

for (const status of [
  "completed",
  "cancelled",
  "canceled",
  "rejected"
]) {
  test(
    "B04 E51 rejects terminal package creation " + status,
    async t => {
      const db = await setup(t);
      await seedD6Package(db);

      const payload = d6PackagePayload(
        "e51-create-" + status
      );

      payload.status = status;

      const before = await guestContractSnapshot(db);

      const response = await d6BookingRequest(
        db, payload
      );

      assert.equal(
        response.status,
        409,
        JSON.stringify(response)
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );
    }
  );
}

test("B04 E51 package creation rejects forged used session count", async t => {
  const db = await setup(t);

  await seedD6Package(db);

  const payload = d6PackagePayload(
    "e51-forged-used-count"
  );

  payload.packageSessionsUsed = 2;

  const before = await guestContractSnapshot(db);

  const response = await d6BookingRequest(
    db, payload
  );

  assert.equal(
    response.status,
    400,
    JSON.stringify(response)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

for (const status of [
  "completed",
  "canceled",
  "rejected"
]) {
  test(
    "B04 E51 prevents direct terminal status patch " + status,
    async t => {
      const db = await setup(t);

      const payload = await e1CreateCoveredBooking(
        db, "e51-patch-" + status
      );

      const repo = await e1BookingRepository();

      const before = await guestContractSnapshot(db);

      await assert.rejects(
        () => repo.patchBooking(
          db,
          "main",
          payload.id,
          {status},
          e1Actor
        ),
        error =>
          error?.status === 409 &&
          error?.code ===
            "core_booking:package_lifecycle_endpoint_required"
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );
    }
  );
}

for (const terminal of [
  "completed",
  "cancelled"
]) {
  test(
    "B04 E51 prevents reopening terminal package booking " + terminal,
    async t => {
      const db = await setup(t);

      const payload = await e1CreateCoveredBooking(
        db, "e51-reopen-" + terminal
      );

      const repo = await e1BookingRepository();

      if (terminal === "completed") {
        await repo.completeBooking(
          db, "main", payload.id, e1Actor
        );
      } else {
        await repo.cancelBooking(
          db, "main", payload.id, "local cancel"
        );
      }

      const before = await guestContractSnapshot(db);

      await assert.rejects(
        () => repo.patchBooking(
          db,
          "main",
          payload.id,
          {status:"booked"},
          e1Actor
        ),
        error =>
          error?.status === 409 &&
          error?.code ===
            "core_booking:package_transition_conflict"
      );

      assert.deepEqual(
        await guestContractSnapshot(db),
        before
      );
    }
  );
}

test("B04 E51 cancellation patch uses atomic lifecycle", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e51-cancel-patch"
  );

  const repo = await e1BookingRepository();

  await repo.patchBooking(
    db,
    "main",
    payload.id,
    {status:"cancelled"},
    e1Actor
  );

  const result = await e1Evidence(
    db, payload.id
  );

  assert.equal(result.status, "cancelled");
  assert.equal(result.lockCount, 0);

  assert.deepEqual(
    result.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );

  assert.deepEqual(
    result.movements.map(row => row.type),
    ["reserve", "release"]
  );
});

test("B04 E51 package session count cannot be patched", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e51-count-patch"
  );

  const repo = await e1BookingRepository();
  const before = await guestContractSnapshot(db);

  await assert.rejects(
    () => repo.patchBooking(
      db,
      "main",
      payload.id,
      {packageSessionsUsed:3},
      e1Actor
    ),
    error =>
      error?.status === 400 &&
      error?.code ===
        "core_booking:package_session_count_server_owned"
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 E51 ordinary package booking completion remains available", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e51-valid-completion"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db, "main", payload.id, e1Actor
  );

  const current = await e1BookingState(
    db, payload.id
  );

  assert.equal(current.status, "completed");

  assert.equal(
    Number(current.package_sessions_used),
    1
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3, remaining:2, reserved:0, used:1}
  );
});

test("B04 E51 package booking metadata edits preserve reservation", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e51-metadata"
  );

  const repo = await e1BookingRepository();

  const ledger = await e1Ledger(db, payload.id);
  const balance = await d6PackageBalance(db);

  await repo.patchBooking(
    db,
    "main",
    payload.id,
    {notes:"Local metadata update"},
    e1Actor
  );

  const current = await e1BookingState(
    db, payload.id
  );

  assert.equal(
    current.notes,
    "Local metadata update"
  );

  assert.deepEqual(
    await e1Ledger(db, payload.id),
    ledger
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    balance
  );
});

function e52InterceptBatch(db, intercept) {
  let entered = false;

  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async statements => {
          if (!entered) {
            entered = true;
            await intercept();
          }

          return target.batch(statements);
        };
      }

      const value = Reflect.get(
        target, property, target
      );

      return typeof value === "function"
        ? value.bind(target)
        : value;
    }
  });
}

test("B04 E52 legitimate package reschedule preserves reservation", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-valid-reschedule"
  );

  const repo = await e1BookingRepository();

  const ledger = await e1Ledger(db, payload.id);
  const balance = await d6PackageBalance(db);

  await repo.rescheduleBooking(
    db,
    "main",
    payload.id,
    {startTime:"16:00"}
  );

  const booking = await e1BookingState(
    db, payload.id
  );

  assert.equal(booking.start_time, "16:00");

  assert.deepEqual(
    await e1Ledger(db, payload.id),
    ledger
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    balance
  );

  const locks = await e1Locks(db, payload.id);

  assert.ok(locks.length > 0);

  assert.ok(
    locks.every(lock => lock.slot_time >= "16:00")
  );
});

test("B04 E52 stale reschedule cannot recreate locks after cancellation", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-reschedule-cancel"
  );

  const repo = await e1BookingRepository();

  let committed;

  const raced = e52InterceptBatch(
    db,
    async () => {
      await repo.cancelBooking(
        db,
        "main",
        payload.id,
        "Concurrent cancellation"
      );

      committed = await guestContractSnapshot(db);
    }
  );

  await assert.rejects(
    () => repo.rescheduleBooking(
      raced,
      "main",
      payload.id,
      {startTime:"16:00"}
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );

  const state = await e1Evidence(db, payload.id);

  assert.equal(state.status, "cancelled");
  assert.equal(state.lockCount, 0);

  assert.deepEqual(
    state.balance,
    {total:3, remaining:3, reserved:0, used:0}
  );
});

test("B04 E52 stale reschedule cannot move completed package booking", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-reschedule-complete"
  );

  const repo = await e1BookingRepository();

  let committed;

  const raced = e52InterceptBatch(
    db,
    async () => {
      await repo.completeBooking(
        db,
        "main",
        payload.id,
        e1Actor
      );

      committed = await guestContractSnapshot(db);
    }
  );

  await assert.rejects(
    () => repo.rescheduleBooking(
      raced,
      "main",
      payload.id,
      {startTime:"16:00"}
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );

  const state = await e1Evidence(db, payload.id);

  assert.equal(state.status, "completed");

  assert.deepEqual(
    state.balance,
    {total:3, remaining:2, reserved:0, used:1}
  );
});

test("B04 E52 stale status patch cannot reopen cancelled package booking", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-patch-cancel"
  );

  const repo = await e1BookingRepository();

  let committed;

  const raced = e52InterceptBatch(
    db,
    async () => {
      await repo.cancelBooking(
        db,
        "main",
        payload.id,
        "Concurrent cancellation"
      );

      committed = await guestContractSnapshot(db);
    }
  );

  await assert.rejects(
    () => repo.patchBooking(
      raced,
      "main",
      payload.id,
      {status:"booked"},
      e1Actor
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );
});

test("B04 E52 stale operational patch cannot recreate cancelled booking locks", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-operational-cancel"
  );

  const repo = await e1BookingRepository();

  let committed;

  const raced = e52InterceptBatch(
    db,
    async () => {
      await repo.cancelBooking(
        db,
        "main",
        payload.id,
        "Concurrent cancellation"
      );

      committed = await guestContractSnapshot(db);
    }
  );

  await assert.rejects(
    () => repo.patchBooking(
      raced,
      "main",
      payload.id,
      {startTime:"16:00"},
      e1Actor
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );

  assert.equal(
    (await e1Locks(db, payload.id)).length,
    0
  );
});

test("B04 E52 stale metadata patch cannot overwrite concurrent completion", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-metadata-complete"
  );

  const repo = await e1BookingRepository();

  let committed;

  const raced = e52InterceptBatch(
    db,
    async () => {
      await repo.completeBooking(
        db,
        "main",
        payload.id,
        e1Actor
      );

      committed = await guestContractSnapshot(db);
    }
  );

  await assert.rejects(
    () => repo.patchBooking(
      raced,
      "main",
      payload.id,
      {notes:"Stale edit"},
      e1Actor
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );
});

test("B04 E52 fresh metadata edit preserves completed session ledger", async t => {
  const db = await setup(t);

  const payload = await e1CreateCoveredBooking(
    db, "e52-fresh-metadata"
  );

  const repo = await e1BookingRepository();

  await repo.completeBooking(
    db,
    "main",
    payload.id,
    e1Actor
  );

  const ledger = await e1Ledger(db, payload.id);
  const balance = await d6PackageBalance(db);

  await repo.patchBooking(
    db,
    "main",
    payload.id,
    {notes:"Fresh metadata"},
    e1Actor
  );

  const current = await e1BookingState(
    db, payload.id
  );

  assert.equal(current.status, "completed");
  assert.equal(current.notes, "Fresh metadata");

  assert.deepEqual(
    await e1Ledger(db, payload.id),
    ledger
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    balance
  );
});

async function e53PrepareInternalRollback(db, id, { discount = false } = {}) {
  const payload = await e1CreateCoveredBooking(db, id);
  let discountSnapshot = null;
  if (discount) {
    await db.prepare(`INSERT INTO discounts
      (id, salon_id, name, type, value, active, used_count, created_at, updated_at)
      VALUES ('rollback-discount', 'main', 'Rollback discount', 'fixed', 100,
              1, 1, ?, ?)`)
      .bind(new Date().toISOString(), new Date().toISOString()).run();
    discountSnapshot = JSON.stringify({ source: 'discount', sourceId: 'rollback-discount' });
  }
  await db.prepare(`UPDATE bookings
    SET source = 'internal', party_id = ?, party_lead_client_id = client_id,
        party_member_order = 0, party_size = 1,
        discount_snapshot_json = COALESCE(?, discount_snapshot_json)
    WHERE salon_id = 'main' AND id = ?`)
    .bind(`party-${id}`, discountSnapshot, id).run();
  return payload;
}

test("B04 E53 internal rollback atomically releases package lock discount and audits", async t => {
  const db = await setup(t);
  const payload = await e53PrepareInternalRollback(
    db, 'e53-atomic-rollback', { discount: true }
  );
  const repo = await e1BookingRepository();
  const invoiceBefore = await db.prepare(
    'SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ?'
  ).bind('main', payload.id).first();

  await repo.rollbackInternalBookingCreation(db, 'main', payload.id, e1Actor);
  const evidence = await e1Evidence(db, payload.id);
  assert.equal(evidence.status, 'cancelled');
  assert.equal(evidence.lockCount, 0);
  assert.deepEqual(evidence.balance, {total:3, remaining:3, reserved:0, used:0});
  assert.deepEqual(evidence.movements.map(row => row.type), ['reserve', 'release']);
  assert.equal((await db.prepare(
    "SELECT used_count FROM discounts WHERE id = 'rollback-discount'"
  ).first()).used_count, 0);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS total FROM audit_logs
    WHERE action = 'internal_booking_creation_rolled_back' AND entity_id = ?`)
    .bind(payload.id).first()).total, 1);
  assert.deepEqual(await db.prepare(
    'SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ?'
  ).bind('main', payload.id).first(), invoiceBefore);

  const replaySnapshot = await guestContractSnapshot(db);
  const replay = await repo.rollbackInternalBookingCreation(
    db, 'main', payload.id, e1Actor
  );
  assert.equal(replay.status, 'cancelled');
  assert.deepEqual(await guestContractSnapshot(db), replaySnapshot);
});

for (const [boundary, trigger] of [
  ['slot-lock deletion', `CREATE TRIGGER e53_slot_fault BEFORE DELETE ON booking_slot_locks
    BEGIN SELECT RAISE(ABORT, 'e53_slot_fault'); END`],
  ['discount reversal', `CREATE TRIGGER e53_discount_fault BEFORE UPDATE ON discounts
    BEGIN SELECT RAISE(ABORT, 'e53_discount_fault'); END`],
  ['audit insertion', `CREATE TRIGGER e53_audit_fault BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'internal_booking_creation_rolled_back'
    BEGIN SELECT RAISE(ABORT, 'e53_audit_fault'); END`],
]) {
  test(`B04 E53 rollback failure at ${boundary} preserves the complete snapshot`, async t => {
    const db = await setup(t);
    const payload = await e53PrepareInternalRollback(
      db, `e53-fault-${boundary.replaceAll(' ', '-')}`,
      { discount: true }
    );
    const repo = await e1BookingRepository();
    await db.prepare(trigger).run();
    const before = await guestContractSnapshot(db);
    await assert.rejects(
      () => repo.rollbackInternalBookingCreation(db, 'main', payload.id, e1Actor),
      new RegExp(
        boundary === "slot-lock deletion"
          ? "e53_slot_fault"
          : boundary === "discount reversal"
            ? "e53_discount_fault"
            : "e53_audit_fault"
      )
    );
    assert.deepEqual(await guestContractSnapshot(db), before);
  });
}

test("B04 E53 settled financial evidence blocks internal rollback without writes", async t => {
  const db = await setup(t);
  await seedD6Package(db);

  const payload = d6PackagePayload(
    'e53-settled-block', '13:00'
  );

  const covered = {
    ...payload.items[0],
    startTime: "13:00",
    endTime: "13:30"
  };

  const ordinary = {
    ...actualBookingPayload(
      'e53-settled-ordinary'
    ).items[0],
    id: "e53-settled-ordinary-item",
    cartItemId: "e53-settled-ordinary-cart",
    packageCovered: false,
    package_covered: 0,
    startTime: "14:00",
    endTime: "14:30"
  };

  payload.items = [covered, ordinary];

  const response = await d6BookingRequest(db, payload);

  assert.equal(
    response.status, 200,
    JSON.stringify(response)
  );

  await assertD7FinancialTotals(
    db, payload.id, 7500
  );

  await db.prepare(`UPDATE bookings
    SET source = 'internal',
        party_id = ?,
        party_lead_client_id = client_id,
        party_member_order = 0,
        party_size = 1
    WHERE salon_id = 'main' AND id = ?`)
    .bind("party-e53-settled-block", payload.id)
    .run();
  const invoice = await db.prepare(
    'SELECT id FROM invoices WHERE salon_id = ? AND booking_id = ?'
  ).bind('main', payload.id).first();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO payments
    (id, salon_id, invoice_id, booking_id, client_id, method,
     amount_halalas, status, paid_at, created_at)
    VALUES ('e53-payment', 'main', ?, ?, 'client-a', 'cash', 1, 'paid', ?, ?)`)
    .bind(invoice.id, payload.id, now, now).run();
  const before = await guestContractSnapshot(db);
  const repo = await e1BookingRepository();
  await assert.rejects(
    () => repo.rollbackInternalBookingCreation(db, 'main', payload.id, e1Actor),
    error => error?.status === 409 &&
      error?.code === 'core_booking:internal_rollback_financial_records_exist'
  );
  assert.deepEqual(await guestContractSnapshot(db), before);
});


async function f61Revision(db,bookingId) {
  const row=await db.prepare(
    "SELECT lifecycle_revision FROM bookings "+
    "WHERE salon_id=? AND id=?"
  ).bind("main",bookingId).first();

  assert.ok(row);

  return row.lifecycle_revision;
}

test("B04 F61 covered reschedule advances durable revision",async t=>{
  const db=await setup(t);
  const payload=await e1CreateCoveredBooking(
    db,"f61-revision"
  );

  const repo=await e1BookingRepository();

  const revision=await f61Revision(db,payload.id);
  const ledger=await e1Ledger(db,payload.id);
  const balance=await d6PackageBalance(db);

  await repo.rescheduleBooking(
    db,"main",payload.id,{startTime:"16:00"}
  );

  assert.equal(
    await f61Revision(db,payload.id),
    revision+1
  );

  await repo.rescheduleBooking(
    db,"main",payload.id,{startTime:"17:00"}
  );

  assert.equal(
    await f61Revision(db,payload.id),
    revision+2
  );

  assert.deepEqual(
    await e1Ledger(db,payload.id),
    ledger
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    balance
  );
});

test("B04 F61 concurrent covered reschedules cannot overwrite committed winner",async t=>{
  const db=await setup(t);

  const payload=await e1CreateCoveredBooking(
    db,"f61-concurrent-reschedule"
  );

  const repo=await e1BookingRepository();

  const original=await e1BookingState(
    db,payload.id
  );

  const revision=await f61Revision(
    db,payload.id
  );

  let committed;

  const raced=e52InterceptBatch(db,async()=>{
    await repo.rescheduleBooking(
      db,"main",payload.id,{startTime:"17:00"}
    );

    // Simulate a collision in timestamp precision.
    // Revision remains the authoritative concurrency fence.
    await db.prepare(
      "UPDATE bookings SET updated_at=? "+
      "WHERE salon_id=? AND id=?"
    ).bind(
      original.updated_at,
      "main",
      payload.id
    ).run();

    committed=await guestContractSnapshot(db);
  });

  await assert.rejects(
    ()=>repo.rescheduleBooking(
      raced,"main",payload.id,{startTime:"16:00"}
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );

  const current=await e1BookingState(
    db,payload.id
  );

  assert.equal(current.start_time,"17:00");

  assert.equal(
    await f61Revision(db,payload.id),
    revision+1
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3,remaining:2,reserved:1,used:0}
  );
});

test("B04 F61 failed reschedule cannot advance revision or replace locks",async t=>{
  const db=await setup(t);

  const payload=await e1CreateCoveredBooking(
    db,"f61-slot-fault"
  );

  const repo=await e1BookingRepository();

  await db.prepare(
    "CREATE TRIGGER f61_slot_fault "+
    "BEFORE INSERT ON booking_slot_locks BEGIN "+
    "SELECT RAISE(ABORT,'f61_slot_fault'); END;"
  ).run();

  const revision=await f61Revision(db,payload.id);
  const before=await guestContractSnapshot(db);

  await assert.rejects(
    ()=>repo.rescheduleBooking(
      db,"main",payload.id,{startTime:"16:00"}
    ),
    /f61_slot_fault/
  );

  assert.equal(
    await f61Revision(db,payload.id),
    revision
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F61 stale metadata cannot cross a reschedule revision",async t=>{
  const db=await setup(t);

  const payload=await e1CreateCoveredBooking(
    db,"f61-metadata-race"
  );

  const repo=await e1BookingRepository();

  const original=await e1BookingState(
    db,payload.id
  );

  let committed;

  const raced=e52InterceptBatch(db,async()=>{
    await repo.rescheduleBooking(
      db,"main",payload.id,{startTime:"17:00"}
    );

    await db.prepare(
      "UPDATE bookings SET updated_at=? "+
      "WHERE salon_id=? AND id=?"
    ).bind(
      original.updated_at,
      "main",
      payload.id
    ).run();

    committed=await guestContractSnapshot(db);
  });

  await assert.rejects(
    ()=>repo.patchBooking(
      raced,
      "main",
      payload.id,
      {notes:"Stale metadata"},
      e1Actor
    )
  );

  assert.ok(committed);

  assert.deepEqual(
    await guestContractSnapshot(db),
    committed
  );
});

test("B04 F61 ordinary booking reschedule advances revision",async t=>{
  const db=await setup(t);

  await seedActualCoreBooking(db);

  const payload=actualBookingPayload(
    "f61-ordinary-reschedule"
  );

  assert.equal(
    (await d6BookingRequest(db,payload)).status,
    200
  );

  const repo=await e1BookingRepository();

  const revision=await f61Revision(db,payload.id);

  await repo.rescheduleBooking(
    db,"main",payload.id,{startTime:"16:00"}
  );

  assert.equal(
    await f61Revision(db,payload.id),
    revision+1
  );

  const current=await e1BookingState(
    db,payload.id
  );

  assert.equal(current.start_time,"16:00");
});


async function f62Request(db,id,options={}) {
  const {
    action="cancel",
    method="POST",
    token="test:owner1:owner",
    key="f62-mutation",
    body={reason:"Local authorization test"},
    tenant="main"
  }=options;

  const {default:worker}=await import("./core/index.js");

  const headers={
    "Content-Type":"application/json"
  };

  if(token!==null) {
    headers.Authorization="Bearer "+token;
  }

  if(key!==null) {
    headers["Idempotency-Key"]=key;
  }

  const path=action==="rollback"
    ? "/api/core/internal/bookings/"+id+"/rollback"
    : "/api/core/bookings/"+id+(action?"/"+action:"");

  const response=await worker.fetch(
    new Request("https://worker.test"+path,{
      method,
      headers,
      ...(method==="DELETE"
        ? {}
        : {body:JSON.stringify(body)})
    }),
    {
      CORE_DB:db,
      SALON_ID:tenant,
      FIREBASE_PROJECT_ID:"booking-runtime-test",
      PACKAGES_AUTH_TEST_MODE:"true"
    }
  );

  return {
    status:response.status,
    body:await response.json()
  };
}

async function f62DomainSnapshot(db) {
  const snapshot=await guestContractSnapshot(db);
  delete snapshot.core_idempotency_operations;
  return snapshot;
}




async function f621SeedAuthority(db) {
  const now = "2026-11-27T12:00:00.000Z";

  for (const table of [
    "employee_profiles",
    "app_users",
    "user_employee_links",
    "roles",
    "permissions",
    "role_permissions",
    "user_permissions",
    "core_idempotency_operations"
  ]) {
    const row = await db.prepare(
      "SELECT name FROM sqlite_master "+
      "WHERE type='table' AND name=?"
    ).bind(table).first();

    assert.ok(row,"Missing canonical schema: "+table);
  }

  for (const [uid,role] of [
    ["owner1","owner"],
    ["f621-owner2","owner"],
    ["client1","client"]
  ]) {

    await db.prepare(
      "INSERT INTO app_users "+
      "(id,salon_id,firebase_uid,email,"+
      "display_name,primary_role,status,"+
      "email_verified,created_at,updated_at) "+
      "VALUES (?,?,?,?,?,?,'active',1,?,?)"
    ).bind(
      uid,
      "main",
      uid,
      uid+"@example.test",
      uid,
      role,
      now,
      now
    ).run();

    const saved = await db.prepare(
      "SELECT * FROM app_users "+
      "WHERE salon_id=? AND firebase_uid=?"
    ).bind("main",uid).first();

    assert.ok(saved);
    assert.equal(saved.id,uid);
    assert.equal(saved.primary_role,role);
    assert.equal(saved.status,"active");
    assert.equal(saved.email_verified,1);
  }

  console.log("F622_CANONICAL_AUTH_USERS_VERIFIED");
}


async function f62Setup(t,id) {
  const db=await setup(t);
  await e1CreateCoveredBooking(db,id);
  await f621SeedAuthority(db);
  return db;
}

test("B04 F62 authorized cancel replay preserves ledger",async t=>{
  const id="f62-cancel-replay";
  const db=await f62Setup(t,id);

  const first=await f62Request(db,id);

  assert.equal(first.status,200,JSON.stringify(first));

  const before=await f62DomainSnapshot(db);

  const retry=await f62Request(db,id);

  assert.deepEqual(retry,first);

  assert.deepEqual(
    await f62DomainSnapshot(db),
    before
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3,remaining:3,reserved:0,used:0}
  );
});

test("B04 F62 anonymous cannot replay cancellation",async t=>{
  const id="f62-anonymous";
  const db=await f62Setup(t,id);

  assert.equal((await f62Request(db,id)).status,200);

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id,{token:null});

  assert.equal(denied.status,401);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F62 invalid bearer cannot replay cancellation",async t=>{
  const id="f62-invalid-bearer";
  const db=await f62Setup(t,id);

  assert.equal((await f62Request(db,id)).status,200);

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id,{
    token:"invalid-local-token"
  });

  assert.equal(denied.status,401);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F62 client cannot replay cancellation",async t=>{
  const id="f62-client";
  const db=await f62Setup(t,id);

  assert.equal((await f62Request(db,id)).status,200);

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id,{
    token:"test:client1:client"
  });

  assert.equal(denied.status,403);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F62 changed cancel payload cannot reuse key",async t=>{
  const id="f62-changed-payload";
  const db=await f62Setup(t,id);

  assert.equal((await f62Request(db,id)).status,200);

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id,{
    body:{reason:"Changed operation"}
  });

  assert.equal(denied.status,409);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F62 conflicting tenant cannot acquire execution",async t=>{
  const id="f62-tenant";
  const db=await f62Setup(t,id);

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id,{
    body:{
      salonId:"main",
      salon_id:"other",
      reason:"Cross tenant"
    }
  });

  assert.equal(denied.status,403);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F62 invalid supplied keys cannot mutate booking",async t=>{
  const id="f62-invalid-key";
  const db=await f62Setup(t,id);

  const before=await guestContractSnapshot(db);

  for(const key of ["","   ","a".repeat(129)]) {
    assert.equal(
      (await f62Request(db,id,{key})).status,
      400
    );
  }

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F62 completion replay cannot consume sessions twice",async t=>{
  const id="f62-completion";
  const db=await f62Setup(t,id);

  const options={
    action:"complete",
    body:{}
  };

  const first=await f62Request(db,id,options);

  assert.equal(first.status,200,JSON.stringify(first));

  const before=await f62DomainSnapshot(db);

  assert.deepEqual(
    await f62Request(db,id,options),
    first
  );

  assert.deepEqual(
    await f62DomainSnapshot(db),
    before
  );

  assert.deepEqual(
    await d6PackageBalance(db),
    {total:3,remaining:2,reserved:0,used:1}
  );

  assert.equal(
    (await f62Request(db,id,{
      ...options,token:null
    })).status,
    401
  );
});

test("B04 F62 reschedule replay does not advance revision again",async t=>{
  const id="f62-reschedule";
  const db=await f62Setup(t,id);

  const options={
    action:"reschedule",
    body:{startTime:"16:00"}
  };

  const first=await f62Request(db,id,options);

  assert.equal(first.status,200,JSON.stringify(first));

  const before=await f62DomainSnapshot(db);

  assert.deepEqual(
    await f62Request(db,id,options),
    first
  );

  assert.deepEqual(
    await f62DomainSnapshot(db),
    before
  );

  assert.equal(
    (await e1BookingState(db,id)).lifecycle_revision,
    1
  );
});

test("B04 F62 patch replay requires current authorization",async t=>{
  const id="f62-patch";
  const db=await f62Setup(t,id);

  const options={
    action:"",
    method:"PATCH",
    body:{notes:"Authorized note"}
  };

  const first=await f62Request(db,id,options);

  assert.equal(first.status,200,JSON.stringify(first));

  const before=await f62DomainSnapshot(db);

  assert.deepEqual(
    await f62Request(db,id,options),
    first
  );

  assert.equal(
    (await f62Request(db,id,{
      ...options,token:null
    })).status,
    401
  );

  assert.deepEqual(
    await f62DomainSnapshot(db),
    before
  );
});

test("B04 F62 delete replay cannot release sessions twice",async t=>{
  const id="f62-delete";
  const db=await f62Setup(t,id);

  const options={
    action:"",
    method:"DELETE"
  };

  const first=await f62Request(db,id,options);

  assert.equal(first.status,200,JSON.stringify(first));

  const before=await f62DomainSnapshot(db);

  assert.deepEqual(
    await f62Request(db,id,options),
    first
  );

  assert.deepEqual(
    await f62DomainSnapshot(db),
    before
  );

  assert.equal(
    (await f62Request(db,id,{
      ...options,token:null
    })).status,
    401
  );
});

test("B04 F62 historical unscoped evidence cannot replay",async t=>{
  const id="f62-historical";
  const db=await f62Setup(t,id);

  const {
    requestFingerprint,
    beginIdempotentOperation,
    completeIdempotentOperation
  }=await import("./core/idempotency.js");

  const body={
    reason:"Local authorization test"
  };

  const request=new Request(
    "https://worker.test/api/core/bookings/"+id+"/cancel",
    {
      method:"POST",
      body:JSON.stringify(body)
    }
  );

  const fingerprint=await requestFingerprint(request);

  const gate=await beginIdempotentOperation(
    db,"main","f62-mutation",fingerprint,
    "legacy-request","legacy-owner"
  );

  assert.equal(gate.action,"proceed");

  await completeIdempotentOperation(
    db,"main","f62-mutation",fingerprint,
    "legacy-request",200,
    JSON.stringify({
      ok:true,data:{id,status:"cancelled"}
    }),
    "legacy-owner"
  );

  const before=await guestContractSnapshot(db);

  const result=await f62Request(db,id);

  assert.equal(result.status,409);

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});


test("B04 F621 different verified owner cannot replay cancellation",async t=>{
  const id="f621-different-owner";
  const db=await f62Setup(t,id);

  const first=await f62Request(db,id);
  assert.equal(first.status,200,JSON.stringify(first));

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id,{
    token:"test:f621-owner2:owner"
  });

  assert.equal(
    denied.status,409,
    JSON.stringify(denied)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});

test("B04 F621 disabled owner cannot replay committed cancellation",async t=>{
  const id="f621-disabled-owner";
  const db=await f62Setup(t,id);

  const first=await f62Request(db,id);

  assert.equal(first.status,200,JSON.stringify(first));

  await db.prepare(
    "UPDATE app_users SET status=? "+
    "WHERE salon_id=? AND id=?"
  ).bind("disabled","main","owner1").run();

  const before=await guestContractSnapshot(db);

  const denied=await f62Request(db,id);

  assert.equal(
    denied.status,403,
    JSON.stringify(denied)
  );

  assert.deepEqual(
    await guestContractSnapshot(db),
    before
  );
});
