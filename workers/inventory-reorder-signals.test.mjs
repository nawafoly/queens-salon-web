import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getInventoryReorderSignals } from './core/repositories/inventory-reorder.js';

function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT, salon_id TEXT, name TEXT, unit TEXT, is_active INTEGER, min_stock_qty REAL);
    CREATE TABLE inventory_locations (id TEXT, salon_id TEXT, active INTEGER);
    CREATE TABLE inventory_stock_levels (item_id TEXT, location_id TEXT, salon_id TEXT, qty_on_hand REAL);
    INSERT INTO inventory_items VALUES ('missing', 'main', 'Missing item', 'piece', 1, 10);
    INSERT INTO inventory_items VALUES ('split', 'main', 'Split item', 'ml', 1, 20);
    INSERT INTO inventory_items VALUES ('safe', 'main', 'Safe item', 'piece', 1, 3);
    INSERT INTO inventory_items VALUES ('unused', 'main', 'Unused item', 'piece', 0, 20);
    INSERT INTO inventory_items VALUES ('no-min', 'main', 'No minimum', 'piece', 1, 0);
    INSERT INTO inventory_items VALUES ('remote', 'other', 'Foreign', 'piece', 1, 50);
    INSERT INTO inventory_locations VALUES ('front', 'main', 1);
    INSERT INTO inventory_locations VALUES ('back', 'main', 1);
    INSERT INTO inventory_locations VALUES ('closed', 'main', 0);
    INSERT INTO inventory_locations VALUES ('foreign', 'other', 1);
    INSERT INTO inventory_stock_levels VALUES ('split', 'front', 'main', 6);
    INSERT INTO inventory_stock_levels VALUES ('split', 'back', 'main', 8);
    INSERT INTO inventory_stock_levels VALUES ('split', 'closed', 'main', 100);
    INSERT INTO inventory_stock_levels VALUES ('safe', 'front', 'main', 9);
    INSERT INTO inventory_stock_levels VALUES ('remote', 'foreign', 'other', 1);
  `);
  return {
    __fakeD1: true,
    all: (query, params) => sql.prepare(query).all(...params),
    close: () => sql.close(),
  };
}

test('Core reorder report includes zero-balance items and sums only active locations', async () => {
  const db = makeDb();
  try {
    const rows = await getInventoryReorderSignals(db, 'main');
    assert.deepEqual(rows.map((row) => row.item_id), ['missing', 'split']);
    const missing = rows.find((row) => row.item_id === 'missing');
    assert.equal(missing.stock_qty, 0);
    assert.equal(missing.shortage_qty, 10);
    const split = rows.find((row) => row.item_id === 'split');
    assert.equal(split.stock_qty, 14);
    assert.equal(split.shortage_qty, 6);
    assert.equal(split.unit, 'ml');
  } finally { db.close(); }
});

test('reorder signals are tenant scoped and never include inactive or no-threshold items', async () => {
  const db = makeDb();
  try {
    const other = await getInventoryReorderSignals(db, 'other');
    assert.deepEqual(other.map((row) => row.item_id), ['remote']);
    assert.equal(other[0].stock_qty, 1);
    assert.equal(other[0].shortage_qty, 49);
  } finally { db.close(); }
});

test('reorder endpoint is a permission-gated Core read and no writes are triggered by UI', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const repo = readFileSync('workers/core/repositories/inventory-reorder.js', 'utf8');
  const ui = readFileSync('src/pages/DashboardInventory.tsx', 'utf8');
  const point = worker.indexOf('return getInventoryReorderSignals(');
  assert.notEqual(point, -1);
  assert.match(worker.slice(point - 95, point), /requireAnyPermission\(ctx, \["inventory\.view", "inventory\.items\.manage"\]\)/);
  assert.doesNotMatch(repo, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*inventory_/i);
  assert.match(ui, /CoreInventoryService\.listReorderSignals/);
});
