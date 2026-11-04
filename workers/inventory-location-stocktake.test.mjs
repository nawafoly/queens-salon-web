import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { adjustAfterStocktake } from './core/repositories/inventory.js';

function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT PRIMARY KEY, salon_id TEXT, is_active INTEGER, unit TEXT);
    CREATE TABLE inventory_locations (id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, active INTEGER);
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
  const insert = (statement, ...params) => sql.prepare(statement).run(...params);
  insert('INSERT INTO inventory_items VALUES (?, ?, ?, ?)', 'color', 'main', 1, 'ml');
  insert('INSERT INTO inventory_items VALUES (?, ?, ?, ?)', 'color-other', 'other', 1, 'ml');
  for (const [id, salonId] of [['front', 'main'], ['back', 'main'], ['outside', 'other']]) {
    insert('INSERT INTO inventory_locations VALUES (?, ?, ?, ?)', id, salonId, id, 1);
  }
  insert('INSERT INTO inventory_locations VALUES (?, ?, ?, ?)', 'disabled', 'main', 'disabled', 0);
  for (const [id, salonId, itemId, locationId, qty] of [
    ['f', 'main', 'color', 'front', 10],
    ['b', 'main', 'color', 'back', 30],
    ['o', 'other', 'color-other', 'outside', 40],
  ]) insert('INSERT INTO inventory_stock_levels VALUES (?, ?, ?, ?, ?, ?)', id, salonId, itemId, locationId, qty, '2026-11-04');

  let beforeBatch = null;
  return {
    __fakeD1: true,
    first: (statement, params) => sql.prepare(statement).get(...params),
    all: (statement, params) => sql.prepare(statement).all(...params),
    run: (statement, params) => sql.prepare(statement).run(...params),
    batch: (statements) => {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
      sql.exec('BEGIN');
      try {
        const result = statements.map(({ sql: statement, params }) => {
          const info = sql.prepare(statement).run(...params);
          return { meta: { changes: info.changes } };
        });
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    setBeforeBatch: (callback) => { beforeBatch = callback; },
    balance: (locationId) => sql.prepare('SELECT qty_on_hand FROM inventory_stock_levels WHERE location_id = ?').get(locationId)?.qty_on_hand,
    movements: () => sql.prepare('SELECT * FROM inventory_stock_movements').all(),
    updateBalance: (locationId, quantity) => sql.prepare('UPDATE inventory_stock_levels SET qty_on_hand = ? WHERE location_id = ?').run(quantity, locationId),
    close: () => sql.close(),
  };
}

const payload = (overrides = {}) => ({
  itemId: 'color', locationId: 'back', countedQty: 27, expectedQty: 30,
  note: 'Monthly physical count', ...overrides,
});

test('stocktake changes only the selected location and writes the audit ledger', async () => {
  const db = makeDb();
  try {
    const result = await adjustAfterStocktake(db, 'main', payload(), { uid: 'qa-user', name: 'QA' });
    assert.equal(result.balanceAfter, 27);
    assert.equal(db.balance('back'), 27);
    assert.equal(db.balance('front'), 10);
    assert.equal(db.balance('outside'), 40);
    const [movement] = db.movements();
    assert.equal(movement.location_id, 'back');
    assert.equal(movement.quantity_delta, -3);
    assert.equal(movement.movement_type, 'STOCKTAKE_VARIANCE');
    assert.equal(movement.note, 'Monthly physical count');
    assert.equal(movement.created_by_uid, 'qa-user');
  } finally { db.close(); }
});

test('stocktake requires a location, recorded balance and meaningful reason', async () => {
  const db = makeDb();
  try {
    for (const invalid of [
      { locationId: undefined }, { expectedQty: undefined },
      { note: '' }, { note: 'x' }, { countedQty: -1 },
      { countedQty: Number.NaN }, { countedQty: undefined },
      { countedQty: null }, { countedQty: '' }, { expectedQty: ' ' },
    ]) await assert.rejects(adjustAfterStocktake(db, 'main', payload(invalid)));
    assert.equal(db.movements().length, 0);
    assert.equal(db.balance('back'), 30);
  } finally { db.close(); }
});

test('stocktake fails closed for cross-tenant and inactive locations', async () => {
  const db = makeDb();
  try {
    await assert.rejects(adjustAfterStocktake(db, 'main', payload({ locationId: 'outside' })));
    await assert.rejects(adjustAfterStocktake(db, 'main', payload({ locationId: 'disabled' })));
    assert.equal(db.movements().length, 0);
  } finally { db.close(); }
});

test('stocktake rejects a stale read and concurrent changes without overwriting balance', async () => {
  const db = makeDb();
  try {
    await assert.rejects(
      adjustAfterStocktake(db, 'main', payload({ expectedQty: 29 })),
      (error) => error.code === 'inventory:stocktake_stale_balance'
    );
    db.setBeforeBatch(() => db.updateBalance('back', 31));
    await assert.rejects(
      adjustAfterStocktake(db, 'main', payload()),
      (error) => error.code === 'inventory:stocktake_stale_balance'
    );
    assert.equal(db.balance('back'), 31);
    assert.equal(db.movements().length, 0);
  } finally { db.close(); }
});

test('matching stocktake does not produce a zero-quantity ledger entry', async () => {
  const db = makeDb();
  try {
    await assert.rejects(adjustAfterStocktake(db, 'main', payload({ countedQty: 30 })),
      (error) => error.code === 'inventory:stocktake_no_variance');
    assert.equal(db.movements().length, 0);
  } finally { db.close(); }
});

test('inventory UI requires a location-specific read before it can confirm stocktake', () => {
  const ui = readFileSync('src/pages/DashboardInventoryOps.tsx', 'utf8');
  const service = readFileSync('src/services/CoreInventoryService.ts', 'utf8');
  assert.match(ui, /listStockLevels\(\{ itemId, locationId: stocktakeLocationId \}\)/);
  assert.match(ui, /expectedQty: stocktakeBalance/);
  assert.match(ui, /locationId: stocktakeLocationId/);
  assert.match(service, /expectedQty: number/);
});
