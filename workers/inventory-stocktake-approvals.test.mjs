import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createStocktakeSession,
  recordStocktakeSessionCount,
  submitStocktakeSession,
  getStocktakeSession,
} from './core/repositories/inventory-stocktakes.js';
import { resolveStocktakeSessionLine } from './core/repositories/inventory-stocktake-approvals.js';

function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, is_active INTEGER, unit TEXT);
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
  sql.exec(readFileSync('migrations/core/0100_inventory_stocktake_sessions.sql', 'utf8'));
  sql.exec(readFileSync('migrations/core/0101_inventory_stocktake_line_resolutions.sql', 'utf8'));
  const run = (query, ...params) => sql.prepare(query).run(...params);
  for (const [id, salonId, name] of [['color', 'main', 'Color'], ['glove', 'main', 'Glove'], ['other-color', 'other', 'Other']]) {
    run('INSERT INTO inventory_items VALUES (?, ?, ?, 1, ?)', id, salonId, name, id === 'glove' ? 'piece' : 'ml');
  }
  for (const [id, salonId] of [['front', 'main'], ['back', 'main'], ['other-room', 'other']]) {
    run('INSERT INTO inventory_locations VALUES (?, ?, ?, 1)', id, salonId, id);
  }
  for (const [id, salonId, itemId, locId, qty] of [
    ['1', 'main', 'color', 'front', 100],
    ['2', 'main', 'color', 'back', 30],
    ['3', 'main', 'glove', 'back', 10],
    ['4', 'other', 'other-color', 'other-room', 400],
  ]) run('INSERT INTO inventory_stock_levels VALUES (?, ?, ?, ?, ?, ?)', id, salonId, itemId, locId, qty, '2026-11-04');

  let beforeBatch = null;
  return {
    __fakeD1: true,
    first: (query, params) => sql.prepare(query).get(...params),
    all: (query, params) => sql.prepare(query).all(...params),
    run: (query, params) => sql.prepare(query).run(...params),
    batch: (statements) => {
      if (beforeBatch) { const action = beforeBatch; beforeBatch = null; action(); }
      sql.exec('BEGIN');
      try {
        const result = statements.map(({ sql: query, params }) => ({
          meta: { changes: sql.prepare(query).run(...params).changes },
        }));
        sql.exec('COMMIT');
        return result;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
    setBeforeBatch: (action) => { beforeBatch = action; },
    raw: (query, ...params) => sql.prepare(query).all(...params),
    updateBalance: (loc, qty) => run('UPDATE inventory_stock_levels SET qty_on_hand = ? WHERE salon_id = ? AND item_id = ? AND location_id = ?', qty, 'main', 'color', loc),
    balance: (loc) => sql.prepare('SELECT qty_on_hand FROM inventory_stock_levels WHERE salon_id = ? AND item_id = ? AND location_id = ?').get('main', 'color', loc)?.qty_on_hand,
    movements: () => sql.prepare('SELECT * FROM inventory_stock_movements ORDER BY created_at').all(),
    decisions: () => sql.prepare('SELECT * FROM inventory_stocktake_line_resolutions').all(),
    close: () => sql.close(),
  };
}

async function submitted(db) {
  const session = await createStocktakeSession(db, 'main', {
    title: 'Monthly count',
    lines: [{ itemId: 'color', locationId: 'front' }, { itemId: 'color', locationId: 'back' }, { itemId: 'glove', locationId: 'back' }],
  });
  const front = session.lines.find((l) => l.location_id === 'front');
  const back = session.lines.find((l) => l.location_id === 'back' && l.item_id === 'color');
  const glove = session.lines.find((l) => l.item_id === 'glove');
  await recordStocktakeSessionCount(db, 'main', session.id, { lineId: front.id, countedQty: 92, note: 'Broken bottle' });
  await recordStocktakeSessionCount(db, 'main', session.id, { lineId: back.id, countedQty: 36, note: 'Extra stock located' });
  await recordStocktakeSessionCount(db, 'main', session.id, { lineId: glove.id, countedQty: 10 });
  await submitStocktakeSession(db, 'main', session.id);
  return { session, front, back, glove };
}

const decide = (line, decision = 'APPLY') => ({ lineId: line.id, decision, reason: 'Reviewed and reconciled by QA' });

test('approving one periodic variance atomically changes only its location, with one unique ledger entry', async () => {
  const db = makeDb();
  try {
    const { session, front } = await submitted(db);
    const review = await resolveStocktakeSessionLine(db, 'main', session.id, decide(front), { uid: 'admin', name: 'Manager' });
    assert.equal(db.balance('front'), 92);
    assert.equal(db.balance('back'), 30);
    assert.equal(review.summary.reviewed_lines, 1);
    const [movement] = db.movements();
    assert.equal(movement.quantity_delta, -8);
    assert.equal(movement.balance_after, 92);
    assert.equal(movement.movement_type, 'STOCKTAKE_VARIANCE');
    assert.equal(movement.source_type, 'STOCKTAKE_SESSION');
    assert.equal(movement.source_id, session.id);
    assert.equal(movement.line_key, front.id);
    assert.equal(movement.created_by_uid, 'admin');
    assert.equal(db.decisions()[0].movement_id, movement.id);
    assert.equal(db.decisions()[0].resolved_by_name, 'Manager');
    await resolveStocktakeSessionLine(db, 'main', session.id, decide(front));
    assert.equal(db.movements().length, 1);
    assert.equal(db.decisions().length, 1);
  } finally { db.close(); }
});

test('dismissal records a reason, never changes stock, and conflicts with subsequent approval', async () => {
  const db = makeDb();
  try {
    const { session, front, back } = await submitted(db);
    const review = await resolveStocktakeSessionLine(db, 'main', session.id, decide(front, 'DISMISS'));
    assert.equal(review.lines.find((l) => l.id === front.id).review_decision, 'DISMISS');
    assert.equal(db.decisions()[0].movement_id, null);
    assert.equal(db.movements().length, 0);
    assert.equal(db.balance('front'), 100);
    await assert.rejects(resolveStocktakeSessionLine(db, 'main', session.id, decide(front)),
      (e) => e.code === 'inventory:stocktake_already_reviewed');
    await resolveStocktakeSessionLine(db, 'main', session.id, decide(back));
    assert.equal(db.balance('back'), 36);
    assert.equal(db.balance('front'), 100);
    assert.equal(db.movements().length, 1);
  } finally { db.close(); }
});

test('stale snapshots reject adjustment before and during the batch without orphan ledger entries', async () => {
  const db = makeDb();
  try {
    const { session, front, back } = await submitted(db);
    db.updateBalance('front', 97);
    await assert.rejects(resolveStocktakeSessionLine(db, 'main', session.id, decide(front)),
      (e) => e.code === 'inventory:stocktake_stale_balance');
    db.setBeforeBatch(() => db.updateBalance('back', 33));
    await assert.rejects(resolveStocktakeSessionLine(db, 'main', session.id, decide(back)),
      (e) => e.code === 'inventory:stocktake_stale_balance');
    assert.equal(db.balance('front'), 97);
    assert.equal(db.balance('back'), 33);
    assert.equal(db.movements().length, 0);
    assert.equal(db.decisions().length, 0);
  } finally { db.close(); }
});

test('unsubmitted, matching and cross-salon lines cannot be reviewed; invalid input is rejected', async () => {
  const db = makeDb();
  try {
    const session = await createStocktakeSession(db, 'main', {
      title: 'Draft', lines: [{ itemId: 'color', locationId: 'front' }],
    });
    await assert.rejects(resolveStocktakeSessionLine(db, 'main', session.id, decide(session.lines[0])),
      (e) => e.code === 'inventory:stocktake_not_submitted');
    const closed = await submitted(db);
    await assert.rejects(resolveStocktakeSessionLine(db, 'other', closed.session.id, decide(closed.front)),
      (e) => e.code === 'inventory:stocktake_line_not_found');
    await assert.rejects(resolveStocktakeSessionLine(db, 'main', closed.session.id, decide(closed.glove)),
      (e) => e.code === 'inventory:stocktake_no_variance');
    await assert.rejects(resolveStocktakeSessionLine(db, 'main', closed.session.id, { lineId: closed.front.id, decision: 'APPLY', reason: 'x' }),
      (e) => e.code === 'inventory:stocktake_review_reason_required');
    assert.equal(db.movements().length, 0);
    assert.equal(db.decisions().length, 0);
  } finally { db.close(); }
});

test('approval endpoint is scoped to inventory.adjust and calls Core, not direct UI balance editing', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const ui = readFileSync('src/pages/DashboardInventorySessions.tsx', 'utf8');
  const endpoint = worker.indexOf('return resolveStocktakeSessionLine(');
  assert.notEqual(endpoint, -1);
  assert.match(worker.slice(endpoint - 85, endpoint), /requirePermission\(ctx, "inventory\.adjust"\)/);
  assert.match(ui, /CoreInventoryService\.resolveStocktakeSessionLine/);
  assert.doesNotMatch(ui, /inventory_stock_levels|inventory_stock_movements/);
});
