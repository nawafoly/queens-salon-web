-- Inventory suppliers. CORE D1 ONLY.
CREATE TABLE IF NOT EXISTS inventory_suppliers (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_suppliers_salon
  ON inventory_suppliers (salon_id, active, name);

-- Link optional supplier on purchase receipt movements (local 0071 only)
ALTER TABLE inventory_stock_movements ADD COLUMN supplier_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inv_movements_supplier
  ON inventory_stock_movements(salon_id, supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;