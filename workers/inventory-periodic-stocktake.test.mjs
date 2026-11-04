import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createStocktakeSession,
  getStocktakeSession,
  listStocktakeSessions,
  recordStocktakeSessionCount,
  submitStocktakeSession,
} from './core/repositories/inventory-stocktakes.js';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT, salon_id TEXT, name TEXT, unit TEXT, is_active INTEGER);
    CREATE TABLE inventory_locations (id TEXT, salon_id TEXT, name TEXT, active INTEGER);
    CREATE TABLE inventory_stock_levels (item_id TEXT, location_id TEXT, salon_id TEXT, qty_on_hand REAL);
    CREATE TABLE inventory_stock_movements (id TEXT, salon_id TEXT);
  `);
  sql.exec(readFileSync('migrations/core/0100_inventory_stocktake_sessions.sql', 'utf8'));
  sql.exec(readFileSync('migrations/core/0101_inventory_stocktake_line_resolutions.sql', 'utf8'));
  const insert = (statement, ...params) => sql.prepare(statement).run(...params);
  for (const [id, salon, name, unit, active] of [
    ['dye', 'main', 'صبغة', 'ml', 1], ['gloves', 'main', 'قفازات', 'piece', 1],
    ['old', 'main', 'قديم', 'unit', 0], ['other-dye', 'other', 'خاص', 'ml', 1],
  ]) insert('INSERT INTO inventory_items VALUES (?, ?, ?, ?, ?)', id, salon, name, unit, active);
  for (const [id, salon, active] of [['front', 'main', 1], ['back', 'main', 1], ['inactive', 'main', 0], ['remote', 'other', 1]]) {
    insert('INSERT INTO inventory_locations VALUES (?, ?, ?, ?)', id, salon, id, active);
  }
  for (const [item, loc, salon, qty] of [
    ['dye', 'front', 'main', 100], ['dye', 'back', 'main', 40],
    ['gloves', 'back', 'main', 12], ['other-dye', 'remote', 'other', 333],
  ]) insert('INSERT INTO inventory_stock_levels VALUES (?, ?, ?, ?)', item, loc, salon, qty);
  return {
    __fakeD1: true,
    first: (query, params) => sql.prepare(query).get(...params),
    all: (query, params) => sql.prepare(query).all(...params),
    run: (query, params) => sql.prepare(query).run(...params),
    batch: (statements) => {
      sql.exec('BEGIN');
      try {
        const results = statements.map(({ sql: query, params }) => ({
          meta: { changes: sql.prepare(query).run(...params).changes },
        }));
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    raw: (query, ...params) => sql.prepare(query).all(...params),
    close: () => sql.close(),
  };
}

const selected = [
  { itemId: 'dye', locationId: 'front' },
  { itemId: 'dye', locationId: 'back' },
  { itemId: 'gloves', locationId: 'back' },
];

test('a session snapshots many items and locations with no ledger movement', async () => {
  const db = database();
  try {
    const session = await createStocktakeSession(db, 'main', { title: 'نهاية الشهر', lines: selected }, { uid: 'admin', name: 'QA' });
    assert.equal(session.status, 'draft');
    assert.equal(session.summary.total_lines, 3);
    assert.equal(session.summary.counted_lines, 0);
    assert.equal(session.created_by_uid, 'admin');
    assert.deepEqual(session.lines.map((line) => [line.item_id, line.location_id, line.expected_qty]), [
      ['dye', 'back', 40], ['gloves', 'back', 12], ['dye', 'front', 100],
    ]);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 0);
    assert.equal(db.raw('SELECT qty_on_hand FROM inventory_stock_levels WHERE item_id = ?', 'dye')[0].qty_on_hand, 100);
    assert.equal((await listStocktakeSessions(db, 'main'))[0].line_count, 3);
    assert.equal((await listStocktakeSessions(db, 'other')).length, 0);
  } finally { db.close(); }
});

test('session creation rejects duplicates, empty lists, and inactive or cross-tenant pairs atomically', async () => {
  const db = database();
  try {
    for (const lines of [[], [...selected, selected[0]], [{ itemId: 'old', locationId: 'back' }],
      [{ itemId: 'dye', locationId: 'inactive' }], [{ itemId: 'dye', locationId: 'remote' }],
      [{ itemId: 'other-dye', locationId: 'front' }]]) {
      await assert.rejects(createStocktakeSession(db, 'main', { title: 'Invalid', lines }));
    }
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stocktake_sessions')[0].n, 0);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stocktake_lines')[0].n, 0);
  } finally { db.close(); }
});

test('counts need explanations for variance; submitted report is frozen and read-only', async () => {
  const db = database();
  try {
    const created = await createStocktakeSession(db, 'main', { title: 'Count', lines: selected });
    const [backDye, gloves, frontDye] = created.lines;
    await assert.rejects(submitStocktakeSession(db, 'main', created.id),
      (error) => error.code === 'inventory:stocktake_incomplete');
    await assert.rejects(recordStocktakeSessionCount(db, 'main', created.id, { lineId: backDye.id, countedQty: 37 }),
      (error) => error.code === 'inventory:stocktake_reason_required');
    await recordStocktakeSessionCount(db, 'main', created.id, { lineId: backDye.id, countedQty: 37, note: 'Spillage' });
    await recordStocktakeSessionCount(db, 'main', created.id, { lineId: gloves.id, countedQty: 12 });
    await recordStocktakeSessionCount(db, 'main', created.id, { lineId: frontDye.id, countedQty: 103, note: 'Found box' });
    const submitted = await submitStocktakeSession(db, 'main', created.id);
    assert.equal(submitted.status, 'submitted');
    assert.deepEqual(submitted.summary, { total_lines: 3, counted_lines: 3, variance_lines: 2, reviewed_lines: 0 });
    assert.deepEqual(submitted.lines.map((line) => line.variance_qty), [-3, 0, 3]);
    assert.equal((await submitStocktakeSession(db, 'main', created.id)).status, 'submitted');
    await assert.rejects(recordStocktakeSessionCount(db, 'main', created.id, { lineId: frontDye.id, countedQty: 0, note: 'Changed' }),
      (error) => error.code === 'inventory:stocktake_session_locked');
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 0);
    assert.deepEqual(db.raw('SELECT qty_on_hand FROM inventory_stock_levels WHERE salon_id = ? ORDER BY qty_on_hand', 'main').map(x => x.qty_on_hand), [12, 40, 100]);
  } finally { db.close(); }
});

test('all tenant-scoped session reads and edits reject foreign salon ids', async () => {
  const db = database();
  try {
    const created = await createStocktakeSession(db, 'main', { title: 'Count', lines: selected });
    await assert.rejects(getStocktakeSession(db, 'other', created.id), (error) => error.code === 'inventory:stocktake_session_not_found');
    await assert.rejects(recordStocktakeSessionCount(db, 'other', created.id, {
      lineId: created.lines[0].id, countedQty: 0, note: 'Foreign',
    }), (error) => error.code === 'inventory:stocktake_line_not_found');
    assert.equal((await getStocktakeSession(db, 'main', created.id)).summary.counted_lines, 0);
  } finally { db.close(); }
});

test('stocktake session routes use adjustment permission and cannot mutate stock by submission', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const repo = readFileSync('workers/core/repositories/inventory-stocktakes.js', 'utf8');
  assert.match(worker, /inventory:stocktake-sessions/);
  assert.match(worker, /inventory:stocktake-session-count/);
  assert.match(worker, /inventory:stocktake-session-submit/);
  for (const action of ['createStocktakeSession', 'recordStocktakeSessionCount', 'submitStocktakeSession']) {
    const pos = worker.indexOf(`return ${action}(`);
    assert.notEqual(pos, -1);
    assert.match(worker.slice(pos - 85, pos), /requirePermission\(ctx, "inventory\.adjust"\)/);
  }
  assert.doesNotMatch(repo, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+inventory_stock_movements|UPDATE\s+inventory_stock_levels|appendMovement\(/);
});

test('inventory dashboard exposes the staged periodic report without automatic adjustment', () => {
  const dashboard = readFileSync('src/pages/DashboardInventory.tsx', 'utf8');
  const sessions = readFileSync('src/pages/DashboardInventorySessions.tsx', 'utf8');
  const service = readFileSync('src/services/CoreInventoryService.ts', 'utf8');
  assert.match(dashboard, /tab === "sessions" && \(canAdjust \|\| canViewCosts\)/);
  assert.match(sessions, /submitStocktakeSession\(selected.id\)/);
  assert.match(sessions, /recordStocktakeSessionCount\(selected.id/);
  assert.doesNotMatch(sessions, /adjustAfterStocktake|transferStock|recordWaste/);
  assert.match(service, /\/api\/core\/inventory\/stocktake-sessions/);
});
