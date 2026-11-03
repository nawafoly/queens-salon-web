import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  listStaffHomeLocations,
  setStaffHomeLocation,
} from './core/repositories/inventory.js';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE staff (id TEXT, salon_id TEXT, name TEXT, active INTEGER);
    CREATE TABLE inventory_locations (id TEXT, salon_id TEXT, name TEXT, active INTEGER);
    CREATE TABLE inventory_staff_locations (
      salon_id TEXT, employee_id TEXT, location_id TEXT, updated_at TEXT,
      PRIMARY KEY (salon_id, employee_id)
    );
  `);
  const insert = (statement, ...values) => sql.prepare(statement).run(...values);
  insert('INSERT INTO staff VALUES (?, ?, ?, ?)', 'a', 'main', 'عايدة', 1);
  insert('INSERT INTO staff VALUES (?, ?, ?, ?)', 'b', 'main', 'غير نشطة', 0);
  insert('INSERT INTO staff VALUES (?, ?, ?, ?)', 'a', 'other', 'موظفة أخرى', 1);
  insert('INSERT INTO inventory_locations VALUES (?, ?, ?, ?)', 'front', 'main', 'الاستقبال', 1);
  insert('INSERT INTO inventory_locations VALUES (?, ?, ?, ?)', 'closed', 'main', 'مغلق', 0);
  insert('INSERT INTO inventory_locations VALUES (?, ?, ?, ?)', 'remote', 'other', 'موقع آخر', 1);
  return {
    __fakeD1: true,
    all: (statement, values) => sql.prepare(statement).all(...values),
    first: (statement, values) => sql.prepare(statement).get(...values),
    run: (statement, values) => sql.prepare(statement).run(...values),
    close: () => sql.close(),
  };
}

test('staff locations are tenant-isolated and can be reassigned idempotently', async () => {
  const db = database();
  try {
    assert.deepEqual((await listStaffHomeLocations(db, 'main')).map((row) => row.employee_id), ['a']);
    assert.deepEqual(await setStaffHomeLocation(db, 'main', { employeeId: 'a', locationId: 'front' }), {
      employeeId: 'a', locationId: 'front',
    });
    await setStaffHomeLocation(db, 'main', { employeeId: 'a', locationId: 'front' });
    const rows = await listStaffHomeLocations(db, 'main');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].location_id, 'front');
    assert.equal(rows[0].location_name, 'الاستقبال');
    assert.equal((await listStaffHomeLocations(db, 'other'))[0].location_id, null);
  } finally { db.close(); }
});

test('staff location assignment rejects nonexistent, inactive, and cross-tenant targets', async () => {
  const db = database();
  try {
    await assert.rejects(setStaffHomeLocation(db, 'main', { employeeId: 'b', locationId: 'front' }), /Employee is inactive/);
    await assert.rejects(setStaffHomeLocation(db, 'main', { employeeId: 'a', locationId: 'closed' }), /Location is inactive/);
    await assert.rejects(setStaffHomeLocation(db, 'main', { employeeId: 'a', locationId: 'remote' }), /Location was not found/);
    await assert.rejects(setStaffHomeLocation(db, 'main', { employeeId: 'not-found', locationId: 'front' }), /Employee was not found/);
  } finally { db.close(); }
});

test('staff location route requires existing inventory management permission', () => {
  const worker = readFileSync(resolve('workers/core/index.js'), 'utf8');
  assert.match(worker, /\/api\/core\/inventory\/staff-home-locations/);
  const start = worker.indexOf('case "inventory:staff-home-locations":');
  assert.notEqual(start, -1);
  const block = worker.slice(start, worker.indexOf('\n    case ', start + 1));
  assert.match(block, /method === "GET"/);
  assert.match(block, /method === "POST"/);
  assert.equal((block.match(/requirePermission\(ctx, "inventory\.items\.manage"\)/g) || []).length, 2);
  assert.doesNotMatch(block, /tenantId|env\.D1|return json\(/);
});
