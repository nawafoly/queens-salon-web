// Core-derived low-stock read model across every active location. This avoids
// partial client-side sums and includes materials with no stock-level row.
import { dbAll } from '../d1.js';

export async function getInventoryReorderSignals(db, salonId) {
  return dbAll(db, `
    SELECT i.id AS item_id, i.name AS item_name, i.unit,
      i.min_stock_qty,
      COALESCE(SUM(CASE WHEN loc.active = 1 THEN sl.qty_on_hand ELSE 0 END), 0) AS stock_qty,
      i.min_stock_qty - COALESCE(SUM(CASE WHEN loc.active = 1 THEN sl.qty_on_hand ELSE 0 END), 0) AS shortage_qty
    FROM inventory_items i
    LEFT JOIN inventory_stock_levels sl
      ON sl.salon_id = i.salon_id AND sl.item_id = i.id
    LEFT JOIN inventory_locations loc
      ON loc.salon_id = sl.salon_id AND loc.id = sl.location_id
    WHERE i.salon_id = ? AND i.is_active = 1 AND i.min_stock_qty > 0
    GROUP BY i.id, i.name, i.unit, i.min_stock_qty
    HAVING COALESCE(SUM(CASE WHEN loc.active = 1 THEN sl.qty_on_hand ELSE 0 END), 0) <= i.min_stock_qty
    ORDER BY shortage_qty DESC, i.name, i.id`, [salonId]);
}
