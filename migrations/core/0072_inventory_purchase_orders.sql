-- Inventory purchase orders (lean). CORE D1 ONLY.
-- Receiving still goes through PURCHASE_RECEIPT_IN ledger movements.

CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_po_salon_created
  ON inventory_purchase_orders (salon_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_purchase_order_lines (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty_ordered REAL NOT NULL,
  qty_received REAL NOT NULL DEFAULT 0,
  unit_cost_halalas INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_po_lines_po
  ON inventory_purchase_order_lines (salon_id, purchase_order_id);