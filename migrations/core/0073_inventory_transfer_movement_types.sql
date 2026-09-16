-- Rebuild movements CHECK so TRANSFER_OUT / TRANSFER_IN are allowed.
-- Local D1 was created from an older 0069 without those types.
CREATE TABLE IF NOT EXISTS inventory_stock_movements__rebuild (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN (
      'PURCHASE_RECEIPT_IN',
      'PURCHASE_RETURN_OUT',
      'SERVICE_CONSUMPTION_OUT',
      'EMPLOYEE_ISSUE_OUT',
      'EMPLOYEE_RETURN_IN',
      'DIRECT_SALE_OUT',
      'DIRECT_SALE_RETURN_IN',
      'WASTE_OUT',
      'DAMAGED_OUT',
      'EXPIRED_OUT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'STOCKTAKE_VARIANCE',
      'ADJUSTMENT_CORRECTION',
      'REVERSAL',
      'OPENING_BALANCE_IN'
    )),
  quantity_delta REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_cost_halalas INTEGER,
  balance_after REAL NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  line_key TEXT NOT NULL DEFAULT '0',
  operation_id TEXT,
  employee_id TEXT,
  booking_id TEXT,
  booking_item_id TEXT,
  service_id TEXT,
  reverses_movement_id TEXT,
  note TEXT,
  created_by_uid TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  supplier_id TEXT
);

INSERT INTO inventory_stock_movements__rebuild
  (id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
   unit_cost_halalas, balance_after, source_type, source_id, line_key,
   operation_id, employee_id, booking_id, booking_item_id, service_id,
   reverses_movement_id, note, created_by_uid, created_by_name, created_at, supplier_id)
SELECT
  id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
  unit_cost_halalas, balance_after, source_type, source_id, line_key,
  operation_id, employee_id, booking_id, booking_item_id, service_id,
  reverses_movement_id, note, created_by_uid, created_by_name, created_at, supplier_id
FROM inventory_stock_movements;

DROP TABLE inventory_stock_movements;
ALTER TABLE inventory_stock_movements__rebuild RENAME TO inventory_stock_movements;

CREATE INDEX IF NOT EXISTS idx_inv_movements_salon_created
  ON inventory_stock_movements(salon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_item_location
  ON inventory_stock_movements(salon_id, item_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_source
  ON inventory_stock_movements(salon_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_booking_item
  ON inventory_stock_movements(salon_id, booking_item_id)
  WHERE booking_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_movements_employee
  ON inventory_stock_movements(salon_id, employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_movements_operation
  ON inventory_stock_movements(salon_id, operation_id)
  WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_movements_source_line_unique
  ON inventory_stock_movements(salon_id, source_type, source_id, line_key);
CREATE INDEX IF NOT EXISTS idx_inv_movements_supplier
  ON inventory_stock_movements(salon_id, supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;
