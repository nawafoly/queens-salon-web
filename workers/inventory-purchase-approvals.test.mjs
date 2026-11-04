import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { addPurchaseOrderLine, createPurchaseOrder, receivePurchaseOrderLine } from './core/repositories/inventory.js';
import { decidePurchaseOrder, getPurchaseOrderDetail } from './core/repositories/inventory-purchase-approvals.js';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE inventory_items (id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, unit TEXT, is_active INTEGER);
    CREATE TABLE inventory_locations (
      id TEXT PRIMARY KEY, salon_id TEXT, name TEXT, is_default INTEGER, active INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE inventory_stock_levels (
      id TEXT PRIMARY KEY, salon_id TEXT, item_id TEXT, location_id TEXT,
      qty_on_hand REAL, updated_at TEXT, UNIQUE(salon_id,item_id,location_id)
    );
    CREATE TABLE inventory_stock_movements (
      id TEXT PRIMARY KEY, salon_id TEXT, item_id TEXT, location_id TEXT,
      movement_type TEXT, quantity_delta REAL, unit TEXT, unit_cost_halalas INTEGER,
      balance_after REAL, source_type TEXT, source_id TEXT, line_key TEXT,
      operation_id TEXT, employee_id TEXT, supplier_id TEXT, booking_id TEXT,
      booking_item_id TEXT, service_id TEXT, reverses_movement_id TEXT,
      note TEXT, created_by_uid TEXT, created_by_name TEXT, created_at TEXT,
      UNIQUE(salon_id,source_type,source_id,line_key)
    );
  `);
  sql.exec(readFileSync('migrations/core/0072_inventory_purchase_orders.sql', 'utf8'));
  sql.exec(readFileSync('migrations/core/0103_inventory_purchase_order_decisions.sql', 'utf8'));
  sql.exec(`
    INSERT INTO inventory_items VALUES ('dye','main','صبغة','ml',1);
    INSERT INTO inventory_items VALUES ('gloves','main','قفازات','piece',1);
    INSERT INTO inventory_items VALUES ('inactive','main','متوقف','unit',0);
    INSERT INTO inventory_items VALUES ('remote','other','أخرى','piece',1);
    INSERT INTO inventory_locations VALUES ('front','main','Front',1,1,'now','now');
    INSERT INTO inventory_locations VALUES ('back','main','Back',0,1,'now','now');
    INSERT INTO inventory_locations VALUES ('closed','main','Closed',0,0,'now','now');
    INSERT INTO inventory_locations VALUES ('other-loc','other','Other',1,1,'now','now');
    INSERT INTO inventory_stock_levels VALUES ('front-dye','main','dye','front',5,'now');
  `);
  const db = {
    __fakeD1: true,
    first: (q, p) => sql.prepare(q).get(...p),
    all: (q, p) => sql.prepare(q).all(...p),
    run: (q, p) => sql.prepare(q).run(...p),
    batch: (statements) => {
      sql.exec('BEGIN');
      try {
        const result = statements.map(({ sql: query, params }) => ({
          meta: { changes: sql.prepare(query).run(...params).changes },
        }));
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    raw: (q, ...p) => sql.prepare(q).all(...p),
    close: () => sql.close(),
  };
  return db;
}

const manager = { uid: 'owner-uid', name: 'Owner' };
const approval = { decision: 'APPROVE', reason: 'Reviewed purchase need' };
const cancellation = { decision: 'CANCEL', reason: 'Supplier unavailable' };

async function draftWithLine(db, options = {}) {
  const po = await createPurchaseOrder(db, 'main', { note: 'Hair supplies' });
  const line = await addPurchaseOrderLine(db, 'main', {
    purchaseOrderId: po.id, itemId: options.itemId || 'dye',
    qtyOrdered: options.qtyOrdered || 10, unitCostHalalas: 250,
  });
  return { po, line };
}

test('draft remains DRAFT after adding lines; receiving cannot bypass manager approval', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'DRAFT');
    await assert.rejects(receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 2 }),
      (error) => error.code === 'inventory:po_approval_required');
    assert.equal(db.raw('SELECT qty_on_hand FROM inventory_stock_levels WHERE id = ?', 'front-dye')[0].qty_on_hand, 5);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 0);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_decisions')[0].n, 0);
  } finally { db.close(); }
});

test('approve requires lines, active items and a documented reason', async () => {
  const db = database();
  try {
    const empty = await createPurchaseOrder(db, 'main', {});
    await assert.rejects(decidePurchaseOrder(db, 'main', empty.id, approval),
      (error) => error.code === 'inventory:po_decision_conflict');
    const { po } = await draftWithLine(db, { itemId: 'inactive' });
    await assert.rejects(decidePurchaseOrder(db, 'main', po.id, approval),
      (error) => error.code === 'inventory:po_decision_conflict');
    await assert.rejects(decidePurchaseOrder(db, 'main', po.id, { decision: 'APPROVE', reason: 'x' }),
      (error) => error.code === 'inventory:po_decision_reason_required');
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'DRAFT');
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_decisions')[0].n, 0);
  } finally { db.close(); }
});

test('approval is audited and idempotent; only approved orders receive movements', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    const reviewed = await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    assert.equal(reviewed.status, 'APPROVED');
    assert.deepEqual(reviewed.decisions.map((d) => d.decision), ['APPROVE']);
    assert.equal(reviewed.decisions[0].decided_by_name, 'Owner');
    await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_decisions')[0].n, 1);
    await assert.rejects(addPurchaseOrderLine(db, 'main', { purchaseOrderId: po.id, itemId: 'gloves', qtyOrdered: 2 }),
      (error) => error.code === 'inventory:po_not_editable');
    const first = await receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 3, operationId: 'approval-receipt-1' }, manager);
    assert.equal(first.replayed, false);
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'PARTIAL');
    const replay = await receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 3, operationId: 'approval-receipt-1' }, manager);
    assert.equal(replay.replayed, true);
    await assert.rejects(receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 8, operationId: 'approval-receipt-2' }),
      (error) => error.code === 'inventory:po_over_receive');
    await receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 7, operationId: 'approval-receipt-2' }, manager);
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'RECEIVED');
    const finalReplay = await receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 7, operationId: 'approval-receipt-2' }, manager);
    assert.equal(finalReplay.replayed, true);
    assert.equal(db.raw('SELECT qty_on_hand AS n FROM inventory_stock_levels WHERE id = ?', 'front-dye')[0].n, 15);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 2);
  } finally { db.close(); }
});

test('cancellation blocks receipt, preserves quantities and records who/why', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    const cancelled = await decidePurchaseOrder(db, 'main', po.id, cancellation, manager);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.deepEqual(cancelled.decisions.map((row) => row.decision), ['APPROVE', 'CANCEL']);
    assert.equal(cancelled.decisions[1].reason, cancellation.reason);
    await decidePurchaseOrder(db, 'main', po.id, cancellation, manager);
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_decisions')[0].n, 2);
    await assert.rejects(receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 1 }),
      (error) => error.code === 'inventory:po_cancelled');
    await assert.rejects(decidePurchaseOrder(db, 'main', po.id, approval, manager));
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 0);
  } finally { db.close(); }
});

test('partially received orders cannot be cancelled; no stock reversal occurs', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    await receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 1 });
    await assert.rejects(decidePurchaseOrder(db, 'main', po.id, cancellation, manager),
      (error) => error.code === 'inventory:po_decision_conflict');
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'PARTIAL');
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_decisions')[0].n, 1);
  } finally { db.close(); }
});

test('legacy partially received order requires explicit approval before receiving remainder', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    db.run('UPDATE inventory_purchase_orders SET status = ? WHERE id = ?', ['PARTIAL', po.id]);
    db.run('UPDATE inventory_purchase_order_lines SET qty_received = ? WHERE id = ?', [2, line.id]);
    await assert.rejects(receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 1 }),
      (error) => error.code === 'inventory:po_approval_required');
    const authorized = await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    assert.equal(authorized.status, 'PARTIAL');
    assert.equal(authorized.decisions.length, 1);
    await receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 8 });
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'RECEIVED');
  } finally { db.close(); }
});

test('PO receipt credits only the explicitly selected active tenant location', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    for (const locationId of ['closed', 'other-loc']) {
      await assert.rejects(receivePurchaseOrderLine(db, 'main', {
        lineId: line.id, quantity: 2, locationId,
      }));
    }
    await receivePurchaseOrderLine(db, 'main', {
      lineId: line.id, quantity: 4, locationId: 'back', operationId: 'received-back',
    }, manager);
    assert.equal(db.raw('SELECT qty_on_hand AS n FROM inventory_stock_levels WHERE id = ?', 'front-dye')[0].n, 5);
    assert.equal(db.raw('SELECT qty_on_hand AS n FROM inventory_stock_levels WHERE location_id = ?', 'back')[0].n, 4);
    assert.equal(db.raw('SELECT location_id FROM inventory_stock_movements')[0].location_id, 'back');
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 1);
  } finally { db.close(); }
});

test('decision batch rolls back audit insert when PO status changes after pre-read', async () => {
  const db = database();
  try {
    const { po } = await draftWithLine(db);
    const originalBatch = db.batch;
    db.batch = (statements) => {
      db.run('UPDATE inventory_purchase_orders SET status = ? WHERE id = ?', ['CANCELLED', po.id]);
      return originalBatch(statements);
    };
    await assert.rejects(decidePurchaseOrder(db, 'main', po.id, approval, manager),
      (error) => error.code === 'inventory:po_decision_conflict');
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'CANCELLED');
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_decisions')[0].n, 0);
  } finally { db.close(); }
});

test('concurrent cancellation cannot be bypassed by a receipt after pre-read', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    await decidePurchaseOrder(db, 'main', po.id, approval, manager);
    const originalBatch = db.batch;
    db.batch = (statements) => {
      db.run('UPDATE inventory_purchase_orders SET status = ? WHERE id = ?', ['CANCELLED', po.id]);
      return originalBatch(statements);
    };
    await assert.rejects(receivePurchaseOrderLine(db, 'main', { lineId: line.id, quantity: 2 }));
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_stock_movements')[0].n, 0);
    assert.equal(db.raw('SELECT qty_received AS n FROM inventory_purchase_order_lines WHERE id = ?', line.id)[0].n, 0);
    assert.equal(db.raw('SELECT qty_on_hand AS n FROM inventory_stock_levels WHERE id = ?', 'front-dye')[0].n, 5);
  } finally { db.close(); }
});

test('concurrent manager approval prevents late draft-line insertion', async () => {
  const db = database();
  try {
    const { po } = await draftWithLine(db);
    const originalRun = db.run;
    db.run = (q, params) => {
      if (q.includes('INSERT INTO inventory_purchase_order_lines')) {
        originalRun('UPDATE inventory_purchase_orders SET status = ? WHERE id = ?', ['APPROVED', po.id]);
      }
      return originalRun(q, params);
    };
    await assert.rejects(addPurchaseOrderLine(db, 'main', { purchaseOrderId: po.id, itemId: 'gloves', qtyOrdered: 2 }),
      (error) => error.code === 'inventory:po_not_editable');
    assert.equal(db.raw('SELECT COUNT(*) AS n FROM inventory_purchase_order_lines WHERE purchase_order_id = ?', po.id)[0].n, 1);
  } finally { db.close(); }
});

test('tenant isolation applies to detail, decisions and received stock', async () => {
  const db = database();
  try {
    const { po, line } = await draftWithLine(db);
    await assert.rejects(getPurchaseOrderDetail(db, 'other', po.id),
      (error) => error.code === 'inventory:po_not_found');
    await assert.rejects(decidePurchaseOrder(db, 'other', po.id, approval),
      (error) => error.code === 'inventory:po_not_found');
    await assert.rejects(receivePurchaseOrderLine(db, 'other', { lineId: line.id, quantity: 1 }),
      (error) => error.code === 'inventory:po_line_not_found');
    assert.equal((await getPurchaseOrderDetail(db, 'main', po.id)).status, 'DRAFT');
  } finally { db.close(); }
});

test('route permissions and typed interface cover approval, audit and receipt', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const ui = readFileSync('src/pages/DashboardInventoryPurchaseOrders.tsx', 'utf8');
  const api = readFileSync('src/services/CoreInventoryService.ts', 'utf8');
  assert.match(worker, /case "inventory:purchase-order-decision":[\s\S]*?requirePermission\(ctx, "inventory.adjust"\);[\s\S]*?requireRole\(ctx.role, ADMIN_ROLES\)/);
  assert.match(worker, /case "inventory:purchase-order-detail":[\s\S]*?requireAnyPermission\(ctx, \["inventory.view", "inventory.adjust"\]\)/);
  assert.match(worker, /unit_cost_halalas: null/);
  assert.match(ui, /role === "admin" \|\| role === "owner"/);
  assert.match(ui, /getPurchaseOrderDetail/);
  assert.match(ui, /decidePurchaseOrder/);
  assert.match(ui, /detail\.decisions\.map/);
  assert.match(ui, /locations\.some\(\(location\) => location\.id === receiveLocationId\)/);
  assert.match(ui, /locationId: receiveLocationId/);
  assert.match(api, /export type InventoryPurchaseOrderDetail/);
});
