import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";

function setup(t) {
  const db = new DatabaseSync(":memory:");

  t.after(() => db.close());

  db.exec("PRAGMA foreign_keys = ON");

  for (const migration of [
    "0001_core_schema.sql",
    "0003_booking_availability.sql",
    "0011_unify_packages_into_core.sql",
    "0115_atomic_booking_package_reservations.sql",
    "0116_live_package_reservation_guard.sql"
  ]) {
    db.exec(readFileSync(
      new URL(`../migrations/core/${migration}`, import.meta.url),
      "utf8"
    ));
  }

  db.exec(`
    INSERT INTO clients
    (id,salon_id,name,canonical_client_id,created_at,updated_at)
    VALUES
    ('client-a','main','Client A','client-a','2026-01-01','2026-01-01');

    INSERT INTO package_catalog
    (id,salon_id,name,total_sessions,price,created_at,updated_at)
    VALUES
    ('catalog-a','main','Package A',5,100,'2026-01-01','2026-01-01');

    INSERT INTO client_packages
    (
      id,salon_id,canonical_client_id,package_catalog_id,
      package_name_snapshot,allowed_service_ids_json,
      total_sessions,remaining_sessions,reserved_sessions,
      used_sessions,status,expires_at,created_at,updated_at
    )
    VALUES (
      'package-a','main','client-a','catalog-a','Package A',
      '["service-a"]',5,5,0,0,'active',
      '2100-01-01T00:00:00Z','2026-01-01','2026-01-01'
    );
  `);

  return db;
}

function snapshot(db) {
  return Object.fromEntries(
    [
      "client_packages",
      "package_transactions",
      "bookings",
      "booking_items",
      "booking_slot_locks",
      "invoices"
    ].map(table => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    ])
  );
}

function reserve(db) {
  db.exec(`
    UPDATE client_packages
    SET remaining_sessions = 4,
        reserved_sessions = 1
    WHERE id = 'package-a';

    INSERT INTO package_transactions
    (
      id,salon_id,client_package_id,canonical_client_id,
      type,sessions_delta,remaining_before,remaining_after,
      reserved_before,reserved_after,used_before,used_after,
      service_id,booking_id,cart_item_id,created_at
    )
    VALUES (
      'reserve-a','main','package-a','client-a','reserve',
      -1,5,4,0,1,0,0,
      'service-a','booking-a','cart-a','2026-01-01'
    );
  `);
}

function insertBooking(db) {
  db.exec(`
    INSERT INTO bookings
    (
      id,salon_id,client_id,booking_date,start_time,status,
      created_at,updated_at
    )
    VALUES (
      'booking-a','main','client-a','2099-01-01','10:00',
      'confirmed','2026-01-01','2026-01-01'
    );
  `);
}

function insertItem(db, service = "service-a", id = "item-a") {
  db.prepare(`
    INSERT INTO booking_items
    (
      id,booking_id,salon_id,service_id,service_name_snapshot,
      unit_price_halalas,total_halalas,package_covered,
      client_package_id,cart_item_id,package_reservation_id,
      created_at
    )
    VALUES (
      ?,'booking-a','main',?,'Test Service',0,0,1,
      'package-a','cart-a','reserve-a','2026-01-01'
    )
  `).run(id, service);
}

function transaction(db, callback) {
  db.exec("BEGIN");

  try {
    callback();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("B04 valid reservation commits atomically", t => {
  const db = setup(t);

  transaction(db, () => {
    reserve(db);
    insertBooking(db);
    insertItem(db);
  });

  const state = snapshot(db);

  assert.equal(state.bookings.length, 1);
  assert.equal(state.booking_items.length, 1);
  assert.equal(state.package_transactions.length, 1);
  assert.equal(state.client_packages[0].remaining_sessions, 4);
  assert.equal(state.client_packages[0].reserved_sessions, 1);
});

for (const [name, change] of [
  [
    "cancelled package",
    db => db.exec(
      "UPDATE client_packages SET status = 'cancelled'"
    )
  ],
  [
    "expired package",
    db => db.exec(
      "UPDATE client_packages SET expires_at = '2000-01-01'"
    )
  ],
  [
    "malformed expiry",
    db => db.exec(
      "UPDATE client_packages SET expires_at = 'invalid'"
    )
  ],
  [
    "changed service eligibility",
    db => db.prepare(
      "UPDATE client_packages SET allowed_service_ids_json = ?"
    ).run('["service-b"]')
  ],
  [
    "malformed service policy",
    db => db.prepare(
      "UPDATE client_packages SET allowed_service_ids_json = ?"
    ).run("invalid")
  ],
  [
    "invalid service policy entries",
    db => db.prepare(
      "UPDATE client_packages SET allowed_service_ids_json = ?"
    ).run('[null,1]')
  ]
]) {
  test(`B04 commit fence rejects ${name}`, t => {
    const db = setup(t);
    const before = snapshot(db);

    assert.throws(() => {
      transaction(db, () => {
        reserve(db);
        insertBooking(db);
        change(db);
        insertItem(db);
      });
    }, /core_booking:package_reservation_missing/);

    assert.deepEqual(snapshot(db), before);
  });
}

test("B04 duplicate reservation aborts the entire booking transaction", t => {
  const db = setup(t);
  const before = snapshot(db);

  assert.throws(() => {
    transaction(db, () => {
      reserve(db);
      insertBooking(db);
      insertItem(db);
      insertItem(db, "service-a", "duplicate-item");
    });
  }, /core_booking:package_reservation_missing/);

  assert.deepEqual(snapshot(db), before);
});

test("B04 released historical reservation cannot create a booking", t => {
  const db = setup(t);

  reserve(db);

  db.exec(`
    UPDATE client_packages
    SET remaining_sessions = 5,
        reserved_sessions = 0
    WHERE id = 'package-a';

    INSERT INTO package_transactions
    (
      id,salon_id,client_package_id,canonical_client_id,
      type,sessions_delta,remaining_before,remaining_after,
      reserved_before,reserved_after,used_before,used_after,
      service_id,booking_id,cart_item_id,created_at
    )
    VALUES (
      'release-a','main','package-a','client-a','release',
      1,4,5,1,0,0,0,
      'service-a','booking-a','cart-a','2026-01-02'
    );
  `);

  const before = snapshot(db);

  assert.throws(() => {
    transaction(db, () => {
      insertBooking(db);
      insertItem(db);
    });
  }, /core_booking:package_reservation_missing/);

  assert.deepEqual(snapshot(db), before);
});

test("B04 an unrelated reserved session cannot revive a released reference", t => {
  const db = setup(t);

  reserve(db);

  db.exec(`
    INSERT INTO package_transactions
    (
      id,salon_id,client_package_id,canonical_client_id,
      type,sessions_delta,remaining_before,remaining_after,
      reserved_before,reserved_after,used_before,used_after,
      service_id,booking_id,cart_item_id,created_at
    )
    VALUES (
      'release-a','main','package-a','client-a','release',
      1,4,5,1,0,0,0,
      'service-a','booking-a','cart-a','2026-01-02'
    );

    INSERT INTO package_transactions
    (
      id,salon_id,client_package_id,canonical_client_id,
      type,sessions_delta,remaining_before,remaining_after,
      reserved_before,reserved_after,used_before,used_after,
      service_id,booking_id,cart_item_id,created_at
    )
    VALUES (
      'reserve-b','main','package-a','client-a','reserve',
      -1,5,4,0,1,0,0,
      'service-a','booking-b','cart-b','2026-01-03'
    );
  `);

  const before = snapshot(db);

  assert.throws(() => {
    transaction(db, () => {
      insertBooking(db);
      insertItem(db);
    });
  }, /core_booking:package_reservation_missing/);

  assert.deepEqual(snapshot(db), before);
});

test("B04 booking cannot use another client's package reservation", t => {
  const db = setup(t);

  db.exec(`
    INSERT INTO clients
    (id,salon_id,name,canonical_client_id,created_at,updated_at)
    VALUES
    ('client-b','main','Client B','client-b','2026-01-01','2026-01-01');
  `);

  const before = snapshot(db);

  assert.throws(() => {
    transaction(db, () => {
      reserve(db);
      insertBooking(db);

      db.exec(`
        UPDATE bookings
        SET client_id = 'client-b'
        WHERE id = 'booking-a'
      `);

      insertItem(db);
    });
  }, /core_booking:package_reservation_missing/);

  assert.deepEqual(snapshot(db), before);
});

test("B04 reservation cannot bind to a nonexistent parent booking", t => {
  const db = setup(t);
  const before = snapshot(db);

  assert.throws(() => {
    transaction(db, () => {
      reserve(db);
      insertItem(db);
    });
  }, /core_booking:package_reservation_missing/);

  assert.deepEqual(snapshot(db), before);
});

test("B04 reservation cannot bind across parent booking tenants", t => {
  const db = setup(t);
  const before = snapshot(db);

  assert.throws(() => {
    transaction(db, () => {
      reserve(db);
      insertBooking(db);

      db.exec(`
        UPDATE bookings
        SET salon_id = 'other'
        WHERE id = 'booking-a'
      `);

      insertItem(db);
    });
  }, /core_booking:package_reservation_missing/);

  assert.deepEqual(snapshot(db), before);
});

function createPackageBooking(db) {
  transaction(db, () => {
    reserve(db);
    insertBooking(db);
    insertItem(db);
  });
}

for (const [name, statement] of [
  [
    "service",
    "UPDATE booking_items SET service_id = 'service-b'"
  ],
  [
    "quantity",
    "UPDATE booking_items SET quantity = quantity + 1"
  ],
  [
    "package coverage",
    "UPDATE booking_items SET package_covered = 0"
  ],
  [
    "package identity",
    "UPDATE booking_items SET client_package_id = 'another-package'"
  ],
  [
    "reservation reference",
    "UPDATE booking_items SET package_reservation_id = 'another-reference'"
  ],
  [
    "cart identity",
    "UPDATE booking_items SET cart_item_id = 'another-cart'"
  ],
  [
    "item tenant",
    "UPDATE booking_items SET salon_id = 'other'"
  ],
  [
    "parent booking",
    "UPDATE booking_items SET booking_id = 'another-booking'"
  ],
  [
    "booking owner",
    "UPDATE bookings SET client_id = 'client-b'"
  ],
  [
    "booking tenant",
    "UPDATE bookings SET salon_id = 'other'"
  ]
]) {
  test(`B04 package booking rejects unsafe ${name} edits`, t => {
    const db = setup(t);

    db.exec(`
      INSERT INTO clients
      (id,salon_id,name,canonical_client_id,created_at,updated_at)
      VALUES
      ('client-b','main','Client B','client-b','2026-01-01','2026-01-01');
    `);

    createPackageBooking(db);

    const before = snapshot(db);

    assert.throws(
      () => transaction(db, () => db.exec(statement)),
      /core_booking:package_binding_change_requires_reconciliation/
    );

    assert.deepEqual(snapshot(db), before);
  });
}

test("B04 package booking permits a schedule-only update", t => {
  const db = setup(t);

  createPackageBooking(db);

  const before = snapshot(db);

  transaction(db, () => {
    db.exec(`
      UPDATE bookings
      SET booking_date = '2099-01-02',
          start_time = '11:00'
      WHERE id = 'booking-a'
    `);
  });

  const after = snapshot(db);

  assert.equal(after.bookings[0].booking_date, "2099-01-02");
  assert.equal(after.bookings[0].start_time, "11:00");

  assert.deepEqual(after.client_packages, before.client_packages);
  assert.deepEqual(after.package_transactions, before.package_transactions);
  assert.deepEqual(after.booking_items, before.booking_items);
});

test("B04 package booking permits a no-op binding update", t => {
  const db = setup(t);

  createPackageBooking(db);

  const before = snapshot(db);

  db.exec(`
    UPDATE booking_items
    SET service_id = service_id,
        quantity = quantity,
        client_package_id = client_package_id
  `);

  assert.deepEqual(snapshot(db), before);
});
