import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getInventoryConsumptionCostReport } from './core/repositories/inventory.js';

function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE services (id TEXT, salon_id TEXT, name TEXT);
    CREATE TABLE staff (id TEXT, salon_id TEXT, name TEXT);
    CREATE TABLE service_consumptions (
      id TEXT, salon_id TEXT, service_id TEXT, employee_id TEXT, status TEXT,
      confirmed_at TEXT, total_material_cost_halalas INTEGER
    );
    CREATE TABLE service_consumption_lines (
      id TEXT, salon_id TEXT, consumption_id TEXT, unit_cost_halalas INTEGER
    );
  `);
  const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
  run('INSERT INTO services VALUES (?, ?, ?)', 'cut', 'main', 'قص شعر');
  run('INSERT INTO services VALUES (?, ?, ?)', 'color', 'main', 'صبغة');
  run('INSERT INTO staff VALUES (?, ?, ?)', 's1', 'main', 'الموظفة الأولى');
  run('INSERT INTO staff VALUES (?, ?, ?)', 's2', 'main', 'الموظفة الثانية');
  const add = (id, salon, service, employee, status, at, cost, lineCost) => {
    run('INSERT INTO service_consumptions VALUES (?, ?, ?, ?, ?, ?, ?)', id, salon, service, employee, status, at, cost);
    run('INSERT INTO service_consumption_lines VALUES (?, ?, ?, ?)', `l_${id}`, salon, id, lineCost);
  };
  // Saudi November 3 starts at November 2, 21:00 UTC.
  add('a', 'main', 'cut', 's1', 'confirmed', '2026-11-02T21:00:00.000Z', 550, 55);
  add('b', 'main', 'cut', 's2', 'confirmed', '2026-11-03T10:00:00.000Z', 200, null);
  add('c', 'main', 'color', 's1', 'confirmed', '2026-11-03T20:59:59.999Z', 750, 75);
  add('d', 'main', 'color', 's1', 'confirmed', '2026-11-03T21:00:00.000Z', 9999, 99); // next Saudi day
  add('e', 'main', 'cut', 's1', 'reversed', '2026-11-03T10:00:00.000Z', 9999, 99);
  add('f', 'other', 'cut', 's1', 'confirmed', '2026-11-03T10:00:00.000Z', 9999, 99);
  return { __fakeD1: true, all: (sql, params) => sqlite.prepare(sql).all(...params), close: () => sqlite.close() };
}

test('cost report uses Saudi-day boundaries and confirmed tenant-scoped actual costs', async () => {
  const db = testDatabase();
  try {
    const report = await getInventoryConsumptionCostReport(db, 'main', { days: 1 }, new Date('2026-11-03T14:00:00.000Z'));
    assert.deepEqual(report.period, { days: 1, from: '2026-11-03', through: '2026-11-03' });
    assert.deepEqual(report.summary, {
      confirmations: 3,
      known_cost_halalas: 1500,
      uncosted_confirmations: 1,
    });
    assert.equal(report.by_service.length, 2);
    assert.deepEqual(report.by_service.find(row => row.id === 'cut'), {
      id: 'cut', name: 'قص شعر', confirmations: 2,
      known_cost_halalas: 750, uncosted_confirmations: 1,
    });
    assert.equal(report.by_employee.find(row => row.id === 's1').known_cost_halalas, 1300);
    assert.equal(report.by_employee.find(row => row.id === 's2').uncosted_confirmations, 1);
  } finally { db.close(); }
});

test('cost report validates its read window', async () => {
  const db = testDatabase();
  try {
    await assert.rejects(getInventoryConsumptionCostReport(db, 'main', { days: 0 }), /days/);
    await assert.rejects(getInventoryConsumptionCostReport(db, 'main', { days: 91 }), /days/);
  } finally { db.close(); }
});

test('cost report API is read-only and restricted to sensitive movement viewers', () => {
  const code = readFileSync(resolve('workers/core/index.js'), 'utf8');
  const route = code.indexOf('case "inventory:consumption-costs":');
  assert.notEqual(route, -1);
  const block = code.slice(route, code.indexOf('\n    case ', route + 1));
  assert.match(block, /method === "GET"/);
  assert.match(block, /requirePermission\(ctx, "inventory\.movements\.view"\)/);
  assert.match(block, /getInventoryConsumptionCostReport/);
  assert.doesNotMatch(block, /dbRun|dbBatch|appendMovement|confirmServiceConsumption/);
});
