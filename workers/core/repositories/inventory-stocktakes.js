// Durable periodic physical counts. These records never change stock balances.
// Only the separately guarded stocktake adjustment workflow may append to the ledger.
import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  changes,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';

function readCountedQty(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new AppError(400, 'inventory:stocktake_count_required', 'A physical count is required');
  }
  const counted = Number(value);
  if (!Number.isFinite(counted) || counted < 0) {
    throw new AppError(400, 'core_validation:invalid_quantity', 'Physical count must be non-negative');
  }
  return counted;
}

function sameKey(line) {
  return `${line.itemId}\u0000${line.locationId}`;
}

function placeholders(length) {
  return Array.from({ length }, () => '?').join(', ');
}

export async function createStocktakeSession(db, salonId, data, actor = {}) {
  const title = requiredText(data?.title, 'title', 140);
  const requested = Array.isArray(data?.lines) ? data.lines : [];
  if (!requested.length || requested.length > 100) {
    throw new AppError(400, 'inventory:stocktake_lines_invalid', 'Choose 1 to 100 unique item/location pairs');
  }
  const lines = requested.map((line) => ({
    itemId: requiredId(line?.itemId ?? line?.item_id, 'itemId'),
    locationId: requiredId(line?.locationId ?? line?.location_id, 'locationId'),
  }));
  if (new Set(lines.map(sameKey)).size !== lines.length) {
    throw new AppError(400, 'inventory:stocktake_duplicate_line', 'An item/location pair can be counted only once');
  }

  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const locationIds = [...new Set(lines.map((line) => line.locationId))];
  const [items, locations, balances] = await Promise.all([
    dbAll(db,
      `SELECT id, unit FROM inventory_items WHERE salon_id = ? AND is_active = 1 AND id IN (${placeholders(itemIds.length)})`,
      [salonId, ...itemIds]),
    dbAll(db,
      `SELECT id FROM inventory_locations WHERE salon_id = ? AND active = 1 AND id IN (${placeholders(locationIds.length)})`,
      [salonId, ...locationIds]),
    dbAll(db,
      `SELECT item_id, location_id, qty_on_hand FROM inventory_stock_levels
        WHERE salon_id = ? AND item_id IN (${placeholders(itemIds.length)})
        AND location_id IN (${placeholders(locationIds.length)})`,
      [salonId, ...itemIds, ...locationIds]),
  ]);
  const itemUnits = new Map(items.map((item) => [item.id, item.unit]));
  const allowedLocations = new Set(locations.map((location) => location.id));
  if (itemUnits.size !== itemIds.length || locationIds.some((id) => !allowedLocations.has(id))) {
    throw new AppError(404, 'inventory:stocktake_item_or_location_missing', 'Selected inventory item or location is unavailable');
  }
  const stock = new Map(balances.map((row) => [sameKey({ itemId: row.item_id, locationId: row.location_id }), Number(row.qty_on_hand)]));
  if ([...stock.values()].some((qty) => !Number.isFinite(qty) || qty < 0)) {
    throw new AppError(409, 'inventory:stocktake_balance_invalid', 'An invalid stock balance cannot be counted');
  }

  const now = nowIso();
  const id = generatedId('invcount');
  const statements = [{
    sql: `INSERT INTO inventory_stocktake_sessions
      (id, salon_id, title, status, created_by_uid, created_by_name, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
    params: [id, salonId, title, optionalText(actor.uid) || null, optionalText(actor.name) || null, now, now],
  }, ...lines.map((line) => ({
    sql: `INSERT INTO inventory_stocktake_lines
      (id, salon_id, session_id, item_id, location_id, item_unit, expected_qty,
       counted_qty, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    params: [generatedId('invcountline'), salonId, id, line.itemId, line.locationId,
      itemUnits.get(line.itemId), stock.get(sameKey(line)) ?? 0, now, now],
  }))];
  await dbBatch(db, statements);
  return getStocktakeSession(db, salonId, id);
}

export async function listStocktakeSessions(db, salonId) {
  return dbAll(db, `
    SELECT s.id, s.title, s.status, s.created_at, s.submitted_at,
      COUNT(l.id) AS line_count,
      COUNT(l.counted_qty) AS counted_count,
      SUM(CASE WHEN l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty THEN 1 ELSE 0 END) AS variance_count,
      COUNT(r.id) AS reviewed_count
    FROM inventory_stocktake_sessions s
    LEFT JOIN inventory_stocktake_lines l ON l.salon_id = s.salon_id AND l.session_id = s.id
    LEFT JOIN inventory_stocktake_line_resolutions r
      ON r.salon_id = l.salon_id AND r.session_id = l.session_id AND r.line_id = l.id
    WHERE s.salon_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC LIMIT 100`, [salonId]);
}

export async function getStocktakeSession(db, salonId, sessionId) {
  const id = requiredId(sessionId, 'sessionId');
  const session = await dbFirst(db,
    'SELECT * FROM inventory_stocktake_sessions WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]);
  if (!session) {
    throw new AppError(404, 'inventory:stocktake_session_not_found', 'Stocktake session was not found');
  }
  const rows = await dbAll(db, `
    SELECT l.*, i.name AS item_name, loc.name AS location_name,
      r.decision AS review_decision, r.reason AS review_reason,
      r.movement_id AS review_movement_id,
      r.resolved_by_name AS reviewed_by_name, r.resolved_at AS reviewed_at
    FROM inventory_stocktake_lines l
    LEFT JOIN inventory_items i ON i.id = l.item_id AND i.salon_id = l.salon_id
    LEFT JOIN inventory_locations loc ON loc.id = l.location_id AND loc.salon_id = l.salon_id
    LEFT JOIN inventory_stocktake_line_resolutions r
      ON r.salon_id = l.salon_id AND r.session_id = l.session_id AND r.line_id = l.id
    WHERE l.salon_id = ? AND l.session_id = ?
    ORDER BY loc.name, i.name, l.id`, [salonId, id]);
  const lines = rows.map((row) => ({ ...row,
    variance_qty: row.counted_qty === null ? null : Number(row.counted_qty) - Number(row.expected_qty),
  }));
  return {
    ...session,
    lines,
    summary: {
      total_lines: lines.length,
      counted_lines: lines.filter((line) => line.counted_qty !== null).length,
      variance_lines: lines.filter((line) => line.variance_qty !== null && line.variance_qty !== 0).length,
      reviewed_lines: lines.filter((line) => line.review_decision !== null).length,
    },
  };
}

export async function recordStocktakeSessionCount(db, salonId, sessionId, data) {
  const id = requiredId(sessionId, 'sessionId');
  const lineId = requiredId(data?.lineId ?? data?.line_id, 'lineId');
  const counted = readCountedQty(data?.countedQty ?? data?.counted_qty);
  const note = optionalText(data?.note) || '';
  if (note.length > 300) {
    throw new AppError(400, 'inventory:stocktake_reason_invalid', 'Count reason is too long');
  }
  const line = await dbFirst(db,
    'SELECT expected_qty FROM inventory_stocktake_lines WHERE salon_id = ? AND session_id = ? AND id = ? LIMIT 1',
    [salonId, id, lineId]);
  if (!line) throw new AppError(404, 'inventory:stocktake_line_not_found', 'Stocktake line was not found');
  if (counted !== Number(line.expected_qty) && note.length < 3) {
    throw new AppError(400, 'inventory:stocktake_reason_required', 'A variance needs a 3–300 character explanation');
  }
  const result = await dbRun(db, `
    UPDATE inventory_stocktake_lines
       SET counted_qty = ?, note = ?, updated_at = ?
     WHERE salon_id = ? AND session_id = ? AND id = ?
       AND EXISTS (
         SELECT 1 FROM inventory_stocktake_sessions s
         WHERE s.salon_id = ? AND s.id = ? AND s.status = 'draft'
       )`, [counted, note || null, nowIso(), salonId, id, lineId, salonId, id]);
  if (changes(result) !== 1) {
    throw new AppError(409, 'inventory:stocktake_session_locked', 'Submitted stocktakes cannot be edited');
  }
  return getStocktakeSession(db, salonId, id);
}

export async function submitStocktakeSession(db, salonId, sessionId) {
  const id = requiredId(sessionId, 'sessionId');
  const now = nowIso();
  const result = await dbRun(db, `
    UPDATE inventory_stocktake_sessions
       SET status = 'submitted', submitted_at = ?, updated_at = ?
     WHERE salon_id = ? AND id = ? AND status = 'draft'
       AND EXISTS (SELECT 1 FROM inventory_stocktake_lines l
                    WHERE l.salon_id = ? AND l.session_id = ?)
       AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_lines l
                        WHERE l.salon_id = ? AND l.session_id = ? AND l.counted_qty IS NULL)`,
    [now, now, salonId, id, salonId, id, salonId, id]);
  if (changes(result) !== 1) {
    const existing = await getStocktakeSession(db, salonId, id);
    if (existing.status === 'submitted') return existing;
    throw new AppError(409, 'inventory:stocktake_incomplete', 'Count all session lines before submitting');
  }
  // Deliberately no inventory_stock_movements or stock-level updates here.
  return getStocktakeSession(db, salonId, id);
}
