-- Explicit audit of purchase-order approval and cancellation decisions.
-- Staging first. No production migration without backup and release approval.
CREATE TABLE IF NOT EXISTS inventory_purchase_order_decisions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'CANCEL')),
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) BETWEEN 3 AND 300),
  decided_by_uid TEXT,
  decided_by_name TEXT,
  decided_at TEXT NOT NULL,
  UNIQUE (salon_id, purchase_order_id, decision)
);
CREATE INDEX IF NOT EXISTS idx_inv_po_decisions_order
  ON inventory_purchase_order_decisions (salon_id, purchase_order_id, decided_at);
