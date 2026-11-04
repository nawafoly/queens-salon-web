import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { receivePurchase } from './core/repositories/inventory.js';

function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT PRIMARY KEY, salon_id TEXT, unit TEXT, is_active INTEGER);
    CREATE TABLE inventory_locations (id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, is_default INTEGER, active INTEGER);
    CREATE TABLE inventory_suppliers (id TEXT PRIMARY KEY, salon_id TEXT);
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
  sql.exec(`
    INSERT INTO inventory_items VALUES ('dye', 'main', 'ml', 1);
    INSERT INTO inventory_locations VALUES ('front', 'main', 'Front', 1, 1);
    INSERT INTO inventory_locations VALUES ('back', 'main', 'Back', 0, 1);
    INSERT INTO inventory_locations VALUES ('closed', 'main', 'Closed', 0, 0);
    INSERT INTO inventory_locations VALUES ('foreign', 'another', 'Foreign', 1, 1);
    INSERT INTO inventory_stock_levels VALUES ('f', 'main', 'dye', 'front', 5, 'now');
    INSERT INTO inventory_stock_levels VALUES ('b', 'main', 'dye', 'back', 7, 'now');
  `);
  return {
    __fakeD1: true,
    first: (q, p) => sql.prepare(q).get(...p),
    all: (q, p) => sql.prepare(q).all(...p),
    run: (q, p) => sql.prepare(q).run(...p),
    batch: (statements) => {
      sql.exec('BEGIN');
      try {
        const result = statements.map(({ sql: q, params }) => ({ meta: { changes: sql.prepare(q).run(...params).changes } }));
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    balance: (loc) => sql.prepare('SELECT qty_on_hand FROM inventory_stock_levels WHERE location_id = ?').get(loc)?.qty_on_hand,
    movements: () => sql.prepare('SELECT * FROM inventory_stock_movements').all(),
    close: () => sql.close(),
  };
}

test('purchase receipt credits chosen warehouse and records exactly one audited movement', async () => {
  const db = makeDb();
  try {
    await receivePurchase(db, 'main', { itemId: 'dye', locationId: 'back', quantity: 3, unitCostHalalas: 95 }, { uid: 'admin', name: 'Manager' });
    assert.equal(db.balance('back'), 10);
    assert.equal(db.balance('front'), 5);
    const [move] = db.movements();
    assert.equal(move.location_id, 'back');
    assert.equal(move.movement_type, 'PURCHASE_RECEIPT_IN');
    assert.equal(move.unit_cost_halalas, 95);
    assert.equal(move.created_by_uid, 'admin');
  } finally { db.close(); }
});

test('inactive or other-salon receiving locations fail without movements', async () => {
  const db = makeDb();
  try {
    await assert.rejects(receivePurchase(db, 'main', { itemId: 'dye', locationId: 'closed', quantity: 3 }),
      (e) => e.code === 'inventory:location_inactive');
    await assert.rejects(receivePurchase(db, 'main', { itemId: 'dye', locationId: 'foreign', quantity: 3 }));
    assert.equal(db.balance('back'), 7);
    assert.equal(db.balance('front'), 5);
    assert.equal(db.movements().length, 0);
  } finally { db.close(); }
});

test('legacy purchase API callers without location still use the active default', async () => {
  const db = makeDb();
  try {
    await receivePurchase(db, 'main', { itemId: 'dye', quantity: 2 });
    assert.equal(db.balance('front'), 7);
    assert.equal(db.balance('back'), 7);
    assert.equal(db.movements()[0].location_id, 'front');
  } finally { db.close(); }
});

test('purchase receipt loads active locations from canonical Core and requires explicit selection', () => {
  const ui = readFileSync('src/pages/DashboardInventoryTrade.tsx', 'utf8');
  assert.match(ui, /CoreInventoryService\.listLocations\(\)/);
  assert.match(ui, /setLocations\(\(locationRows \|\| \[\]\)\.filter\(/);
  assert.match(ui, /Number\(location\.active \?\? 1\) === 1/);
  assert.match(ui, /locations\.some\(\(location\) => location\.id === locationId\)/);
  assert.match(ui, /locationId,\s*\}\);/);
  assert.doesNotMatch(ui, /locationId:\s*locationId\s*\|\|\s*undefined/);
  assert.doesNotMatch(ui, /void setLocations|الموقع الافتراضي/);
});
