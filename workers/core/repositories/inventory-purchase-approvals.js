// Core purchase-order decisions. They are separate from physical receipt and
// are guarded/recorded in one atomic D1 batch.
import { cleanText, dbAll, dbBatch, dbFirst, changes, generatedId, nowIso, optionalText, requiredId } from '../d1.js';
import { AppError } from '../errors.js';

export async function getPurchaseOrderDetail(db, salonId, orderId) {
  const id = requiredId(orderId, 'purchaseOrderId');
  const order = await dbFirst(db, `SELECT * FROM inventory_purchase_orders
    WHERE salon_id = ? AND id = ? LIMIT 1`, [salonId, id]);
  if (!order) throw new AppError(404, 'inventory:po_not_found', 'Purchase order was not found');
  const [lines, decisions] = await Promise.all([
    dbAll(db, `SELECT pol.*, i.name AS item_name, i.unit AS item_unit
      FROM inventory_purchase_order_lines pol
      LEFT JOIN inventory_items i ON i.salon_id = pol.salon_id AND i.id = pol.item_id
      WHERE pol.salon_id = ? AND pol.purchase_order_id = ?
      ORDER BY pol.created_at, pol.id`, [salonId, id]),
    dbAll(db, `SELECT decision, reason, decided_by_name, decided_at
      FROM inventory_purchase_order_decisions
      WHERE salon_id = ? AND purchase_order_id = ?
      ORDER BY decided_at, id`, [salonId, id]),
  ]);
  return { ...order, lines, decisions };
}

export async function decidePurchaseOrder(db, salonId, orderId, data, actor = {}) {
  const id = requiredId(orderId, 'purchaseOrderId');
  const decision = cleanText(data?.decision).toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'CANCEL') {
    throw new AppError(400, 'inventory:po_decision_invalid', 'Choose APPROVE or CANCEL');
  }
  const reason = cleanText(data?.reason);
  if (reason.length < 3 || reason.length > 300) {
    throw new AppError(400, 'inventory:po_decision_reason_required', 'Decision reason must be 3–300 characters');
  }

  const before = await dbFirst(db, `SELECT status FROM inventory_purchase_orders
    WHERE salon_id = ? AND id = ? LIMIT 1`, [salonId, id]);
  if (!before) throw new AppError(404, 'inventory:po_not_found', 'Purchase order was not found');
  // Legacy PARTIAL orders may have real historical receipts but no recorded
  // approval. An admin must explicitly authorize their *remaining* receipts.
  const partialLegacyApproval = decision === 'APPROVE' && cleanText(before.status).toUpperCase() === 'PARTIAL';
  const desiredStatus = decision === 'APPROVE'
    ? (partialLegacyApproval ? 'PARTIAL' : 'APPROVED')
    : 'CANCELLED';
  const prior = await dbFirst(db, `SELECT decision FROM inventory_purchase_order_decisions
    WHERE salon_id = ? AND purchase_order_id = ? AND decision = ? LIMIT 1`, [salonId, id, decision]);
  if (prior && cleanText(before.status).toUpperCase() === desiredStatus) {
    return getPurchaseOrderDetail(db, salonId, id);
  }

  const now = nowIso();
  const statusGuard = decision === 'APPROVE'
    ? `UPPER(status) IN ('DRAFT', 'ORDERED', 'PARTIAL')
       AND EXISTS (SELECT 1 FROM inventory_purchase_order_lines l
         JOIN inventory_items i ON i.salon_id = l.salon_id AND i.id = l.item_id
         WHERE l.salon_id = inventory_purchase_orders.salon_id
           AND l.purchase_order_id = inventory_purchase_orders.id
           AND l.qty_ordered > l.qty_received AND i.is_active = 1)
       AND NOT EXISTS (SELECT 1 FROM inventory_purchase_order_lines l
         LEFT JOIN inventory_items i ON i.salon_id = l.salon_id AND i.id = l.item_id
         WHERE l.salon_id = inventory_purchase_orders.salon_id
           AND l.purchase_order_id = inventory_purchase_orders.id
           AND (l.qty_ordered <= 0 OR i.id IS NULL OR i.is_active <> 1
                OR l.qty_received < 0 OR l.qty_received > l.qty_ordered
                OR (UPPER(inventory_purchase_orders.status) <> 'PARTIAL' AND l.qty_received > 0)))`
    : `UPPER(status) IN ('DRAFT', 'ORDERED', 'APPROVED')
       AND NOT EXISTS (SELECT 1 FROM inventory_purchase_order_lines l
         WHERE l.salon_id = inventory_purchase_orders.salon_id
           AND l.purchase_order_id = inventory_purchase_orders.id
           AND l.qty_received > 0)`;

  try {
    const results = await dbBatch(db, [
      {
        sql: `UPDATE inventory_purchase_orders SET status = ?, updated_at = ?
          WHERE salon_id = ? AND id = ? AND ${statusGuard}`,
        params: [desiredStatus, now, salonId, id],
      },
      {
        sql: `INSERT INTO inventory_purchase_order_decisions
          (id, salon_id, purchase_order_id, decision, reason, decided_by_uid,
           decided_by_name, decided_at)
          VALUES (?, ?, (SELECT id FROM inventory_purchase_orders
            WHERE salon_id = ? AND id = ? AND status = ?), ?, ?, ?, ?, ?)`,
        // The NOT NULL decision.purchase_order_id forces a rollback if the
        // guarded transition failed. D1 batch executes as one transaction.
        params: [generatedId('invpodecision'), salonId, salonId, id, desiredStatus,
          decision, reason, optionalText(actor.uid) || null, optionalText(actor.name) || null, now],
      },
    ]);
    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
      throw new AppError(409, 'inventory:po_decision_conflict', 'Purchase order changed before review');
    }
  } catch (error) {
    const current = await dbFirst(db, `SELECT status FROM inventory_purchase_orders
      WHERE salon_id = ? AND id = ? LIMIT 1`, [salonId, id]);
    const existing = await dbFirst(db, `SELECT id FROM inventory_purchase_order_decisions
      WHERE salon_id = ? AND purchase_order_id = ? AND decision = ? LIMIT 1`, [salonId, id, decision]);
    if (existing && current?.status === desiredStatus) return getPurchaseOrderDetail(db, salonId, id);
    if (/constraint failed/i.test(String(error?.message || ''))) {
      throw new AppError(409, 'inventory:po_decision_conflict', 'Purchase order is not eligible for this decision');
    }
    throw error;
  }
  return getPurchaseOrderDetail(db, salonId, id);
}
