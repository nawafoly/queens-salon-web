import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dbBatch } from './core/d1.js';
import { buildAtomicPackageReservationStatements } from './core/repositories/bookings.js';
import { sqliteD1 } from './test-support/sqlite-d1.mjs';

const now = '2027-01-01T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';

function setup(t, sessions = 3) {
  const db = sqliteD1();
  t.after(() => db.database.close());
  db.database.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_core_schema.sql',
    '0003_booking_availability.sql',
    '0011_unify_packages_into_core.sql',
    '0115_atomic_booking_package_reservations.sql', '0116_live_package_reservation_guard.sql',
  ]) {
    db.database.exec(readFileSync(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'));
  }
  db.database.prepare(`INSERT INTO clients
    (id, salon_id, name, created_at, updated_at, canonical_client_id)
    VALUES ('client-a', 'main', 'Client A', ?, ?, 'client-a')`).run(now, now);
  db.database.prepare(`INSERT INTO package_catalog
    (id, salon_id, name, total_sessions, price, allowed_service_ids_json, created_at, updated_at)
    VALUES ('catalog-a', 'main', 'Package A', ?, 100, '["service-a","service-b"]', ?, ?)`
  ).run(sessions, now, now);
  db.database.prepare(`INSERT INTO client_packages
    (id, salon_id, canonical_client_id, package_catalog_id, package_name_snapshot,
     allowed_service_ids_json, total_sessions, remaining_sessions, reserved_sessions,
     used_sessions, status, purchased_at, expires_at, created_at, updated_at)
    VALUES ('package-a', 'main', 'client-a', 'catalog-a', 'Package A',
            '["service-a","service-b"]', ?, ?, 0, 0, 'active', ?, ?, ?, ?)`
  ).run(sessions, sessions, now, future, now, now);
  return db;
}

function item(cartItemId, serviceId = 'service-a') {
  return {
    id: `booking-item-${cartItemId}`,
    service_id: serviceId,
    service_name_snapshot: serviceId,
    staff_id: null,
    quantity: 1,
    unit_price_halalas: 5000,
    total_halalas: 5000,
    package_covered: 1,
    client_package_id: 'package-a',
    duration_minutes: 30,
    booking_date: '2027-02-01',
    start_time: '10:00',
    end_time: '10:30',
    cart_item_id: cartItemId,
    package_reservation_id: null,
  };
}

function bookingStatements(bookingId, rows, { invalidReservation = false } = {}) {
  return [
    {
      sql: `INSERT INTO bookings
        (id, salon_id, client_id, booking_date, start_time, end_time, status, source, created_at, updated_at)
        VALUES (?, 'main', 'client-a', '2027-02-01', '10:00', '11:00', 'booked', 'test', ?, ?)`,
      params: [bookingId, now, now],
    },
    ...rows.map((row) => ({
      sql: `INSERT INTO booking_items
        (id, booking_id, salon_id, service_id, service_name_snapshot, quantity,
         unit_price_halalas, total_halalas, package_covered, client_package_id,
         duration_minutes, created_at, booking_date, start_time, end_time,
         cart_item_id, package_reservation_id)
        VALUES (?, ?, 'main', ?, ?, 1, 5000, 5000, 1, ?, 30, ?, ?, ?, ?, ?, ?)`,
      params: [
        `${bookingId}-${row.cart_item_id}`,
        bookingId,
        row.service_id,
        row.service_name_snapshot,
        row.client_package_id,
        now,
        row.booking_date,
        row.start_time,
        row.end_time,
        row.cart_item_id,
        invalidReservation ? 'missing-reservation' : row.package_reservation_id,
      ],
    })),
  ];
}

function balances(db) {
  return { ...db.database.prepare(`SELECT total_sessions, remaining_sessions,
    reserved_sessions, used_sessions FROM client_packages WHERE id = 'package-a'`).get() };
}

test('multi-item package booking commits booking, balances and one movement per item atomically', async (t) => {
  const db = setup(t, 3);
  const rows = [item('item-a', 'service-a'), item('item-b', 'service-b')];
  const packageStatements = await buildAtomicPackageReservationStatements(
    db, 'main', 'booking-a', 'client-a', rows, 'owner', now
  );
  await dbBatch(db, [...packageStatements, ...bookingStatements('booking-a', rows)]);
  assert.deepEqual(balances(db), {
    total_sessions: 3,
    remaining_sessions: 1,
    reserved_sessions: 2,
    used_sessions: 0,
  });
  const movements = db.database.prepare(
    "SELECT * FROM package_transactions WHERE booking_id = 'booking-a' ORDER BY cart_item_id"
  ).all();
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map((row) => row.cart_item_id), ['item-a', 'item-b']);
  assert.ok(movements.every((row) => row.type === 'reserve' && row.created_by_uid === 'owner'));
  assert.equal(db.database.prepare("SELECT COUNT(*) count FROM booking_items WHERE booking_id = 'booking-a'").get().count, 2);
});

test('a later invalid reservation leaves no earlier package mutation or orphan movement', async (t) => {
  const db = setup(t, 3);
  const before = balances(db);
  const rows = [item('item-a', 'service-a'), item('item-b', 'not-in-package')];
  await assert.rejects(
    buildAtomicPackageReservationStatements(db, 'main', 'booking-invalid', 'client-a', rows, 'owner', now),
    (error) => error?.code === 'core_booking:service_not_in_package'
  );
  assert.deepEqual(balances(db), before);
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM package_transactions').get().count, 0);
});

test('booking failure after reservation statements rolls back every package effect', async (t) => {
  const db = setup(t, 2);
  const rows = [item('item-a')];
  const packageStatements = await buildAtomicPackageReservationStatements(
    db, 'main', 'booking-fails', 'client-a', rows, 'owner', now
  );
  await assert.rejects(
    dbBatch(db, [
      ...packageStatements,
      ...bookingStatements('booking-fails', rows, { invalidReservation: true }),
    ])
  );
  assert.deepEqual(balances(db), {
    total_sessions: 2,
    remaining_sessions: 2,
    reserved_sessions: 0,
    used_sessions: 0,
  });
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM package_transactions').get().count, 0);
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM bookings').get().count, 0);
});

test('concurrent booking batches cannot overspend one package or leave a booking without its movement', async (t) => {
  const db = setup(t, 1);
  const rowsA = [item('item-a')];
  const rowsB = [item('item-b')];
  const statementsA = await buildAtomicPackageReservationStatements(
    db, 'main', 'booking-a', 'client-a', rowsA, 'owner', now
  );
  const statementsB = await buildAtomicPackageReservationStatements(
    db, 'main', 'booking-b', 'client-a', rowsB, 'owner', now
  );
  const results = await Promise.allSettled([
    dbBatch(db, [...statementsA, ...bookingStatements('booking-a', rowsA)]),
    dbBatch(db, [...statementsB, ...bookingStatements('booking-b', rowsB)]),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(balances(db), {
    total_sessions: 1,
    remaining_sessions: 0,
    reserved_sessions: 1,
    used_sessions: 0,
  });
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM package_transactions').get().count, 1);
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM bookings').get().count, 1);
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM booking_items').get().count, 1);
});

test('cross-client and cross-tenant package reservations fail closed without mutation', async (t) => {
  const db = setup(t, 2);
  for (const [salonId, clientId] of [['main', 'client-b'], ['other', 'client-a']]) {
    const rows = [item(`${salonId}-${clientId}`)];
    await assert.rejects(
      buildAtomicPackageReservationStatements(db, salonId, 'booking-denied', clientId, rows, 'owner', now),
      (error) => error?.code === 'core_booking:client_package_not_found'
    );
  }
  assert.deepEqual(balances(db), {
    total_sessions: 2,
    remaining_sessions: 2,
    reserved_sessions: 0,
    used_sessions: 0,
  });
  assert.equal(db.database.prepare('SELECT COUNT(*) count FROM package_transactions').get().count, 0);
});

async function seedHistoricalReservation(db, bookingId, row) {
  const statements = await buildAtomicPackageReservationStatements(
    db, 'main', bookingId, 'client-a', [row], 'owner', now
  );

  await dbBatch(db, statements);

  return row.package_reservation_id;
}

function appendLifecycleMovement(db, sourceId, type, timestamp, deltas) {
  const source = db.database.prepare(
    "SELECT * FROM package_transactions WHERE id = ?"
  ).get(sourceId);

  const current = balances(db);

  const [dr, ds, du] = deltas;

  db.database.prepare(`
    UPDATE client_packages
    SET remaining_sessions = ?,
        reserved_sessions = ?,
        used_sessions = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    current.remaining_sessions + dr,
    current.reserved_sessions + ds,
    current.used_sessions + du,
    timestamp,
    source.client_package_id
  );

  db.database.prepare(`
    INSERT INTO package_transactions
    (
      id, salon_id, client_package_id, canonical_client_id,
      type, sessions_delta, remaining_before, remaining_after,
      reserved_before, reserved_after, used_before, used_after,
      service_id, booking_id, cart_item_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `${sourceId}-${type}-${timestamp}`,
    source.salon_id,
    source.client_package_id,
    source.canonical_client_id,
    type,
    dr,
    current.remaining_sessions,
    current.remaining_sessions + dr,
    current.reserved_sessions,
    current.reserved_sessions + ds,
    current.used_sessions,
    current.used_sessions + du,
    source.service_id,
    source.booking_id,
    source.cart_item_id,
    timestamp
  );
}

test('B04 lifecycle accepts a legitimately reapplied reservation', async t => {
  const db = setup(t, 3);
  const bookingId = 'booking-reapply';
  const row = item('reapply-item');

  const sourceId = await seedHistoricalReservation(db, bookingId, row);

  appendLifecycleMovement(
    db, sourceId, 'release',
    '2027-01-01T00:00:01.000Z',
    [1, -1, 0]
  );

  appendLifecycleMovement(
    db, sourceId, 'reapply_reserved',
    '2027-01-01T00:00:02.000Z',
    [-1, 1, 0]
  );

  const before = balances(db);

  const statements = await buildAtomicPackageReservationStatements(
    db, 'main', bookingId, 'client-a', [row], 'owner',
    '2027-01-01T00:00:03.000Z'
  );

  assert.equal(statements.length, 0);

  await dbBatch(db, bookingStatements(bookingId, [row]));

  assert.deepEqual(balances(db), before);

  assert.equal(db.database.prepare(
    'SELECT COUNT(*) count FROM package_transactions'
  ).get().count, 3);
});

test('B04 lifecycle rejects released reservation in actual repository', async t => {
  const db = setup(t, 3);
  const bookingId = 'booking-released';
  const row = item('released-item');

  const sourceId = await seedHistoricalReservation(db, bookingId, row);

  appendLifecycleMovement(
    db, sourceId, 'release',
    '2027-01-01T00:00:01.000Z',
    [1, -1, 0]
  );

  const before = balances(db);

  await assert.rejects(
    buildAtomicPackageReservationStatements(
      db, 'main', bookingId, 'client-a', [row], 'owner',
      '2027-01-01T00:00:02.000Z'
    ),
    error => error?.code === 'core_booking:package_reservation_not_live'
  );

  assert.deepEqual(balances(db), before);
});

test('B04 lifecycle rejects a consumed reservation reference', async t => {
  const db = setup(t, 3);
  const bookingId = 'booking-consumed';
  const row = item('consumed-item');

  const sourceId = await seedHistoricalReservation(db, bookingId, row);

  appendLifecycleMovement(
    db, sourceId, 'consume',
    '2027-01-01T00:00:01.000Z',
    [0, -1, 1]
  );

  const before = balances(db);

  await assert.rejects(
    buildAtomicPackageReservationStatements(
      db, 'main', bookingId, 'client-a', [row], 'owner',
      '2027-01-01T00:00:02.000Z'
    ),
    error => error?.code === 'core_booking:package_reservation_not_live'
  );

  assert.deepEqual(balances(db), before);
});

test('B04 lifecycle rejects release between validation and booking commit', async t => {
  const db = setup(t, 3);
  const bookingId = 'booking-race-release';
  const row = item('race-item');

  const sourceId = await seedHistoricalReservation(db, bookingId, row);

  const statements = await buildAtomicPackageReservationStatements(
    db, 'main', bookingId, 'client-a', [row], 'owner', now
  );

  assert.equal(statements.length, 0);

  appendLifecycleMovement(
    db, sourceId, 'release',
    '2027-01-01T00:00:01.000Z',
    [1, -1, 0]
  );

  const before = balances(db);

  await assert.rejects(
    dbBatch(db, bookingStatements(bookingId, [row])),
    /core_booking:package_reservation_missing/
  );

  assert.deepEqual(balances(db), before);

  assert.equal(db.database.prepare(
    'SELECT COUNT(*) count FROM bookings'
  ).get().count, 0);
});
