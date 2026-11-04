// Per-line review of a completed periodic count. The review and any ledger
// adjustment are committed together; no UI caller may edit stock levels.
import {
  cleanText,
  dbBatch,
  dbFirst,
  changes,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { getStocktakeSession } from './inventory-stocktakes.js';

async function findResolution(db, salonId, sessionId, lineId) {
  return dbFirst(db, `
    SELECT decision, movement_id FROM inventory_stocktake_line_resolutions
    WHERE salon_id = ? AND session_id = ? AND line_id = ? LIMIT 1`,
  [salonId, sessionId, lineId]);
}

export async function resolveStocktakeSessionLine(db, salonId, sessionId, data, actor = {}) {
  const id = requiredId(sessionId, 'sessionId');
  const lineId = requiredId(data?.lineId ?? data?.line_id, 'lineId');
  const decision = cleanText(data?.decision).toUpperCase();
  if (!['APPLY', 'DISMISS'].includes(decision)) {
    throw new AppError(400, 'inventory:stocktake_review_invalid', 'Choose APPLY or DISMISS');
  }
  const reason = cleanText(data?.reason);
  if (reason.length < 3 || reason.length > 300) {
    throw new AppError(400, 'inventory:stocktake_review_reason_required', 'Review reason must be 3–300 characters');
  }
  const line = await dbFirst(db, `
    SELECT l.*, s.status AS session_status, i.is_active AS item_active,
      i.unit AS current_item_unit, loc.active AS location_active
    FROM inventory_stocktake_lines l
    JOIN inventory_stocktake_sessions s ON s.id = l.session_id AND s.salon_id = l.salon_id
    JOIN inventory_items i ON i.id = l.item_id AND i.salon_id = l.salon_id
    JOIN inventory_locations loc ON loc.id = l.location_id AND loc.salon_id = l.salon_id
    WHERE l.salon_id = ? AND l.session_id = ? AND l.id = ? LIMIT 1`,
  [salonId, id, lineId]);
  if (!line) throw new AppError(404, 'inventory:stocktake_line_not_found', 'Stocktake line was not found');
  const existing = await findResolution(db, salonId, id, lineId);
  if (existing) {
    if (existing.decision !== decision) {
      throw new AppError(409, 'inventory:stocktake_already_reviewed', 'The stocktake line already has a different review decision');
    }
    // A retry is read-only; it cannot create a second stock movement.
    return getStocktakeSession(db, salonId, id);
  }
  if (line.session_status !== 'submitted' || line.counted_qty === null) {
    throw new AppError(409, 'inventory:stocktake_not_submitted', 'Complete and close the count report before reviewing');
  }
  if (Number(line.counted_qty) === Number(line.expected_qty)) {
    throw new AppError(409, 'inventory:stocktake_no_variance', 'Matching lines require no adjustment');
  }
  if (Number(line.item_active) !== 1 || Number(line.location_active) !== 1 ||
      line.item_unit !== line.current_item_unit) {
    throw new AppError(409, 'inventory:stocktake_item_or_location_changed', 'Item or location changed after count');
  }

  const now = nowIso();
  const resolutionId = generatedId('invreview');
  const whoUid = optionalText(actor.uid) || null;
  const whoName = optionalText(actor.name) || null;

  if (decision === 'DISMISS') {
    try {
      const results = await dbBatch(db, [{
        sql: `INSERT INTO inventory_stocktake_line_resolutions
            (id, salon_id, session_id, line_id, decision, reason, movement_id,
             resolved_by_uid, resolved_by_name, resolved_at)
          SELECT ?, l.salon_id, l.session_id, l.id, 'DISMISS', ?, NULL, ?, ?, ?
          FROM inventory_stocktake_lines l
          JOIN inventory_stocktake_sessions s
            ON s.salon_id = l.salon_id AND s.id = l.session_id
          WHERE l.salon_id = ? AND l.session_id = ? AND l.id = ?
            AND s.status = 'submitted' AND l.counted_qty IS NOT NULL
            AND l.counted_qty <> l.expected_qty
            AND NOT EXISTS (
              SELECT 1 FROM inventory_stocktake_line_resolutions r
              WHERE r.salon_id = l.salon_id AND r.session_id = l.session_id AND r.line_id = l.id
            )`,
        params: [resolutionId, reason, whoUid, whoName, now, salonId, id, lineId],
      }]);
      if (changes(results[0]) !== 1) {
        throw new AppError(409, 'inventory:stocktake_review_conflict', 'Count report changed before review');
      }
    } catch (error) {
      const resolved = await findResolution(db, salonId, id, lineId);
      if (resolved?.decision === decision) return getStocktakeSession(db, salonId, id);
      throw error;
    }
    return getStocktakeSession(db, salonId, id);
  }

  // Revalidate against the *original* count snapshot. A stale count is not
  // converted into a new quantity delta, since subsequent stock activity
  // would otherwise be silently written off.
  const balance = await dbFirst(db, `
    SELECT qty_on_hand FROM inventory_stock_levels
    WHERE salon_id = ? AND item_id = ? AND location_id = ? LIMIT 1`,
  [salonId, line.item_id, line.location_id]);
  if (Number(balance?.qty_on_hand ?? 0) !== Number(line.expected_qty)) {
    throw new AppError(409, 'inventory:stocktake_stale_balance', 'Stock changed after the physical count; recount before approval');
  }
  const movementId = generatedId('invmov');
  const operationId = `stocktake-review:${lineId}`;

  try {
    const results = await dbBatch(db, [
      // Safely initialize a zero-balance read model for a newly discovered item.
      {
        sql: `INSERT INTO inventory_stock_levels
          (id, salon_id, item_id, location_id, qty_on_hand, updated_at)
          VALUES (?, ?, ?, ?, 0, ?)
          ON CONFLICT(salon_id, item_id, location_id) DO NOTHING`,
        params: [generatedId('invlvl'), salonId, line.item_id, line.location_id, now],
      },
      {
        sql: `INSERT INTO inventory_stock_movements (
          id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
          unit_cost_halalas, balance_after, source_type, source_id, line_key, operation_id,
          employee_id, supplier_id, booking_id, booking_item_id, service_id,
          reverses_movement_id, note, created_by_uid, created_by_name, created_at)
        SELECT ?, l.salon_id, l.item_id, l.location_id, 'STOCKTAKE_VARIANCE',
          l.counted_qty - sl.qty_on_hand, l.item_unit,
          NULL, l.counted_qty, 'STOCKTAKE_SESSION', l.session_id, l.id, ?,
          NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?
        FROM inventory_stocktake_lines l
        JOIN inventory_stocktake_sessions s
          ON s.salon_id = l.salon_id AND s.id = l.session_id
        JOIN inventory_items i ON i.id = l.item_id AND i.salon_id = l.salon_id
        JOIN inventory_locations loc ON loc.id = l.location_id AND loc.salon_id = l.salon_id
        JOIN inventory_stock_levels sl
          ON sl.salon_id = l.salon_id AND sl.item_id = l.item_id AND sl.location_id = l.location_id
        WHERE l.salon_id = ? AND l.session_id = ? AND l.id = ?
          AND s.status = 'submitted' AND l.counted_qty IS NOT NULL
          AND l.counted_qty <> l.expected_qty
          AND i.is_active = 1 AND loc.active = 1 AND i.unit = l.item_unit
          AND sl.qty_on_hand = l.expected_qty
          AND NOT EXISTS (
            SELECT 1 FROM inventory_stocktake_line_resolutions r
            WHERE r.salon_id = l.salon_id AND r.session_id = l.session_id AND r.line_id = l.id
          )`,
        params: [movementId, operationId, reason, whoUid, whoName, now, salonId, id, lineId],
      },
      {
        sql: `UPDATE inventory_stock_levels
          SET qty_on_hand = ?, updated_at = ?
          WHERE salon_id = ? AND item_id = ? AND location_id = ?
            AND qty_on_hand = ?
            AND EXISTS (
              SELECT 1 FROM inventory_stock_movements
              WHERE id = ? AND salon_id = ? AND source_type = 'STOCKTAKE_SESSION'
            )`,
        params: [Number(line.counted_qty), now, salonId, line.item_id, line.location_id,
          Number(line.expected_qty), movementId, salonId],
      },
      {
        sql: `INSERT INTO inventory_stocktake_line_resolutions
          (id, salon_id, session_id, line_id, decision, reason, movement_id,
           resolved_by_uid, resolved_by_name, resolved_at)
          VALUES (?, ?, ?, ?, 'APPLY', ?,
            (SELECT m.id
             FROM inventory_stock_movements m
             JOIN inventory_stock_levels sl
               ON sl.salon_id = m.salon_id AND sl.item_id = m.item_id
               AND sl.location_id = m.location_id
             WHERE m.id = ? AND m.salon_id = ?
               AND m.source_type = 'STOCKTAKE_SESSION'
               AND sl.qty_on_hand = m.balance_after),
            ?, ?, ?)`,
        // The CHECK in migration 0101 rejects a null movement_id, rolling
        // back the entire D1 batch if the movement or balance update failed.
        params: [resolutionId, salonId, id, lineId, reason, movementId, salonId,
          whoUid, whoName, now],
      },
    ]);
    if (changes(results[1]) !== 1 || changes(results[2]) !== 1 || changes(results[3]) !== 1) {
      // A stale balance or competing resolution makes all guarded operations
      // no-ops. Never treat this as an approved adjustment.
      throw new AppError(409, 'inventory:stocktake_stale_balance', 'Stock changed during review; recount before approval');
    }
  } catch (error) {
    const resolved = await findResolution(db, salonId, id, lineId);
    if (resolved?.decision === decision) return getStocktakeSession(db, salonId, id);
    // Guarded INSERTs intentionally fail the 0101 CHECK if a concurrent
    // writer invalidates their prerequisites. Surface that as a conflict.
    if (/CHECK constraint failed:.*(?:inventory_stocktake_line_resolutions|decision = 'APPLY')|constraint failed: inventory_stocktake_line_resolutions/i.test(String(error?.message || ''))) {
      throw new AppError(409, 'inventory:stocktake_stale_balance', 'Stock changed during review; recount before approval');
    }
    throw error;
  }
  return getStocktakeSession(db, salonId, id);
}
