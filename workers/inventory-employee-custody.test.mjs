import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { issueToEmployee, returnFromEmployee } from './core/repositories/inventory.js';
import { getEmployeeCustodyReport } from './core/repositories/inventory-custody.js';

function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, unit TEXT, is_active INTEGER, consumption_policy TEXT);
    CREATE TABLE inventory_locations (id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, is_default INTEGER, active INTEGER);
    CREATE TABLE employee_profiles (id TEXT, salon_id TEXT, status TEXT);
    CREATE TABLE staff (id TEXT, salon_id TEXT, name TEXT);
    CREATE TABLE inventory_stock_levels (
      id TEXT PRIMARY KEY, salon_id TEXT, item_id TEXT, location_id TEXT,
      qty_on_hand REAL, updated_at TEXT, UNIQUE (salon_id, item_id, location_id)
    );
    CREATE TABLE inventory_stock_movements (
      id TEXT PRIMARY KEY, salon_id TEXT, item_id TEXT, location_id TEXT,
      movement_type TEXT, quantity_delta REAL, unit TEXT, unit_cost_halalas INTEGER,
      balance_after REAL, source_type TEXT, source_id TEXT, line_key TEXT,
      operation_id TEXT, employee_id TEXT, supplier_id TEXT, booking_id TEXT,
      booking_item_id TEXT, service_id TEXT, reverses_movement_id TEXT,
      note TEXT, created_by_uid TEXT, created_by_name TEXT, created_at TEXT,
      UNIQUE (salon_id, source_type, source_id, line_key)
    );
  `);
  sql.exec(readFileSync('migrations/core/0102_inventory_employee_custody_index.sql', 'utf8'));
  sql.exec(`
    INSERT INTO inventory_items VALUES ('gloves', 'main', 'Gloves', 'piece', 1, 'EMPLOYEE_ISSUED');
    INSERT INTO inventory_items VALUES ('dye', 'main', 'Dye', 'ml', 1, 'SERVICE_TRACKED');
    INSERT INTO inventory_items VALUES ('foreign-gloves', 'other', 'Foreign gloves', 'piece', 1, 'EMPLOYEE_ISSUED');
    INSERT INTO inventory_locations VALUES ('store', 'main', 'Store', 1, 1);
    INSERT INTO inventory_locations VALUES ('other-store', 'other', 'Other', 1, 1);
    INSERT INTO employee_profiles VALUES ('alice', 'main', 'active');
    INSERT INTO employee_profiles VALUES ('beth', 'main', 'active');
    INSERT INTO employee_profiles VALUES ('other-employee', 'other', 'active');
    INSERT INTO staff VALUES ('alice', 'main', 'Alice');
    INSERT INTO staff VALUES ('beth', 'main', 'Beth');
    INSERT INTO inventory_stock_levels VALUES ('1', 'main', 'gloves', 'store', 50, 'now');
    INSERT INTO inventory_stock_levels VALUES ('2', 'main', 'dye', 'store', 100, 'now');
    INSERT INTO inventory_stock_levels VALUES ('3', 'other', 'foreign-gloves', 'other-store', 300, 'now');
  `);
  let beforeBatch = null;
  return {
    __fakeD1: true,
    first: (q, p) => sql.prepare(q).get(...p),
    all: (q, p) => sql.prepare(q).all(...p),
    run: (q, p) => sql.prepare(q).run(...p),
    batch: (statements) => {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
      sql.exec('BEGIN');
      try {
        const result = statements.map(({ sql: q, params }) => ({ meta: { changes: sql.prepare(q).run(...params).changes } }));
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    beforeNextBatch: (callback) => { beforeBatch = callback; },
    insertConcurrentReturn: (quantity) => {
      sql.prepare(`INSERT INTO inventory_stock_movements
        (id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
         balance_after, source_type, source_id, line_key, employee_id, created_at)
        VALUES (?, 'main', 'gloves', 'store', 'EMPLOYEE_RETURN_IN', ?, 'piece',
                46, 'EMPLOYEE_RETURN', ?, 'gloves', 'alice', 'now')`)
        .run(`concurrent-${quantity}`, quantity, `concurrent-${quantity}`);
      sql.prepare('UPDATE inventory_stock_levels SET qty_on_hand = qty_on_hand + ? WHERE id = ?').run(quantity, '1');
    },
    movements: () => sql.prepare('SELECT * FROM inventory_stock_movements').all(),
    balance: () => sql.prepare('SELECT qty_on_hand FROM inventory_stock_levels WHERE id = ?').get('1')?.qty_on_hand,
    close: () => sql.close(),
  };
}

const qty = (quantity, employeeId = 'alice', itemId = 'gloves') => ({ itemId, employeeId, quantity });

test('custody report derives per-employee outstanding issue less return from the ledger', async () => {
  const db = makeDb();
  try {
    await issueToEmployee(db, 'main', qty(7));
    await issueToEmployee(db, 'main', qty(2, 'beth'));
    await returnFromEmployee(db, 'main', qty(3));
    const report = await getEmployeeCustodyReport(db, 'main');
    assert.equal(report.lines.length, 2);
    const alice = report.lines.find((row) => row.employee_id === 'alice');
    assert.equal(alice.employee_name, 'Alice');
    assert.equal(alice.issued_qty, 7);
    assert.equal(alice.returned_qty, 3);
    assert.equal(alice.outstanding_qty, 4);
    assert.equal(report.summary.outstanding_lines, 2);
    assert.equal(report.summary.anomalies, 0);
    assert.equal((await getEmployeeCustodyReport(db, 'main', { employeeId: 'beth' })).lines.length, 1);
    assert.equal((await getEmployeeCustodyReport(db, 'other')).lines.length, 0);
  } finally { db.close(); }
});

test('returns cannot exceed employee custody or return non-employee-issued material', async () => {
  const db = makeDb();
  try {
    await issueToEmployee(db, 'main', qty(5));
    const before = db.balance();
    await assert.rejects(returnFromEmployee(db, 'main', qty(6)),
      (e) => e.code === 'inventory:employee_custody_insufficient');
    await assert.rejects(returnFromEmployee(db, 'main', qty(1, 'beth')),
      (e) => e.code === 'inventory:employee_custody_insufficient');
    await assert.rejects(returnFromEmployee(db, 'main', qty(1, 'alice', 'dye')),
      (e) => e.code === 'inventory:item_policy_mismatch');
    assert.equal(db.balance(), before);
    assert.equal(db.movements().length, 1);
  } finally { db.close(); }
});

test('concurrent returns are guarded by the same ledger INSERT without over-crediting stock', async () => {
  const db = makeDb();
  try {
    await issueToEmployee(db, 'main', qty(5));
    db.beforeNextBatch(() => db.insertConcurrentReturn(2));
    await assert.rejects(returnFromEmployee(db, 'main', qty(4)),
      (e) => e.code === 'inventory:employee_custody_insufficient');
    assert.equal(db.balance(), 47);
    assert.equal(db.movements().length, 2);
    const report = await getEmployeeCustodyReport(db, 'main');
    assert.equal(report.lines[0].outstanding_qty, 3);
  } finally { db.close(); }
});

test('custody endpoint is read-only and permission-gated in Core', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const report = readFileSync('workers/core/repositories/inventory-custody.js', 'utf8');
  const ui = readFileSync('src/pages/DashboardInventoryIssue.tsx', 'utf8');
  const point = worker.indexOf('return getEmployeeCustodyReport(');
  assert.notEqual(point, -1);
  assert.match(worker.slice(point - 110, point), /requireAnyPermission\(ctx, \["inventory\.adjust", "inventory\.movements\.view"\]\)/);
  assert.doesNotMatch(report, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*inventory_/i);
  assert.match(ui, /getEmployeeCustodyReport/);
});
