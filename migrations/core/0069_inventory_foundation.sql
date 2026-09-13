-- Inventory Control Center — Phase 1 Foundation
-- CORE D1 ONLY. No Firestore fallback.
-- Ledger-based stock. UI never mutates qty_on_hand directly.
-- Service consumption is confirmed at execution time, not at booking create.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_categories (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_categories_salon_active
  ON inventory_categories(salon_id, active, sort_order);

-- ---------------------------------------------------------------------------
-- Items (Source of Truth for materials / products)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  category_id TEXT,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  unit TEXT NOT NULL
    CHECK (unit IN ('ml', 'g', 'piece', 'pair', 'unit', 'bottle', 'box')),
  consumption_policy TEXT NOT NULL DEFAULT 'SERVICE_TRACKED'
    CHECK (consumption_policy IN (
      'SERVICE_TRACKED',
      'EMPLOYEE_ISSUED',
      'DIRECT_SALE',
      'SHARED_OPERATIONAL'
    )),
  track_batches INTEGER NOT NULL DEFAULT 0,
  min_stock_qty REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_items_salon_active
  ON inventory_items(salon_id, is_active, name);

CREATE INDEX IF NOT EXISTS idx_inv_items_salon_category
  ON inventory_items(salon_id, category_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_items_salon_sku
  ON inventory_items(salon_id, sku)
  WHERE sku IS NOT NULL AND TRIM(sku) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_items_salon_barcode
  ON inventory_items(salon_id, barcode)
  WHERE barcode IS NOT NULL AND TRIM(barcode) <> '';

-- ---------------------------------------------------------------------------
-- Locations (enterprise-capable; single default location is fine for now)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_locations (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_locations_salon_active
  ON inventory_locations(salon_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_locations_one_default
  ON inventory_locations(salon_id)
  WHERE is_default = 1 AND active = 1;

-- ---------------------------------------------------------------------------
-- Stock levels (read model / current balance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock_levels (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  qty_on_hand REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, item_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_stock_levels_salon_item
  ON inventory_stock_levels(salon_id, item_id);

CREATE INDEX IF NOT EXISTS idx_inv_stock_levels_low
  ON inventory_stock_levels(salon_id, qty_on_hand);

-- ---------------------------------------------------------------------------
-- Stock movements (append-mostly ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock_movements (
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
  created_at TEXT NOT NULL
);

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

-- Prevent duplicate lines for the same operational source
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_movements_source_line_unique
  ON inventory_stock_movements(salon_id, source_type, source_id, line_key);

-- ---------------------------------------------------------------------------
-- Service consumption recipes (standard / default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_consumption_recipes (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_svc_recipes_salon_service
  ON service_consumption_recipes(salon_id, service_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_recipes_one_active
  ON service_consumption_recipes(salon_id, service_id)
  WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS service_consumption_recipe_lines (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  line_type TEXT NOT NULL
    CHECK (line_type IN ('SPECIFIC_ITEM', 'CATEGORY')),
  inventory_item_id TEXT,
  category_id TEXT,
  default_qty REAL NOT NULL
    CHECK (default_qty > 0),
  unit TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (
    (line_type = 'SPECIFIC_ITEM' AND inventory_item_id IS NOT NULL AND category_id IS NULL)
    OR
    (line_type = 'CATEGORY' AND category_id IS NOT NULL AND inventory_item_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_svc_recipe_lines_recipe
  ON service_consumption_recipe_lines(salon_id, recipe_id, sort_order);

-- ---------------------------------------------------------------------------
-- Actual service consumption (execution-time confirmation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_consumptions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  booking_item_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'reversed')),
  total_material_cost_halalas INTEGER NOT NULL DEFAULT 0,
  operation_id TEXT,
  confirmed_at TEXT NOT NULL,
  confirmed_by_uid TEXT,
  confirmed_by_name TEXT,
  reversed_at TEXT,
  reversed_by_uid TEXT,
  reverse_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_svc_consumptions_salon_created
  ON service_consumptions(salon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_svc_consumptions_booking
  ON service_consumptions(salon_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_svc_consumptions_employee
  ON service_consumptions(salon_id, employee_id, confirmed_at DESC);

-- One active confirmation per booking item
CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consumptions_booking_item_confirmed
  ON service_consumptions(salon_id, booking_item_id)
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS service_consumption_lines (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  consumption_id TEXT NOT NULL,
  recipe_line_id TEXT,
  inventory_item_id TEXT NOT NULL,
  quantity REAL NOT NULL
    CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_cost_halalas INTEGER,
  line_cost_halalas INTEGER NOT NULL DEFAULT 0,
  stock_movement_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_svc_consumption_lines_consumption
  ON service_consumption_lines(salon_id, consumption_id);

CREATE INDEX IF NOT EXISTS idx_svc_consumption_lines_item
  ON service_consumption_lines(salon_id, inventory_item_id);

-- ---------------------------------------------------------------------------
-- Inventory permissions (reuse existing permissions system)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  ('inventory.view', 'inventory', 'View inventory', 'View inventory items, levels and movements.', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
  ('inventory.items.manage', 'inventory', 'Manage inventory items', 'Create and update inventory items and categories.', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
  ('inventory.recipes.manage', 'inventory', 'Manage service consumption recipes', 'Configure default material recipes for services.', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
  ('inventory.consume.confirm', 'inventory', 'Confirm service consumption', 'Confirm actual material usage at service execution.', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
  ('inventory.movements.view', 'inventory', 'View stock movements', 'View inventory ledger movements.', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
  ('inventory.adjust', 'inventory', 'Adjust inventory', 'Create correction or opening balance movements.', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'),
  ('inventory.waste.record', 'inventory', 'Record waste', 'Record waste, damage or expiry movements.', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z');

-- Owner + admin baseline grants for salon "main"
INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
VALUES
  ('main', 'owner', 'inventory.view', '2026-09-13T00:00:00.000Z'),
  ('main', 'owner', 'inventory.items.manage', '2026-09-13T00:00:00.000Z'),
  ('main', 'owner', 'inventory.recipes.manage', '2026-09-13T00:00:00.000Z'),
  ('main', 'owner', 'inventory.consume.confirm', '2026-09-13T00:00:00.000Z'),
  ('main', 'owner', 'inventory.movements.view', '2026-09-13T00:00:00.000Z'),
  ('main', 'owner', 'inventory.adjust', '2026-09-13T00:00:00.000Z'),
  ('main', 'owner', 'inventory.waste.record', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.view', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.items.manage', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.recipes.manage', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.consume.confirm', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.movements.view', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.adjust', '2026-09-13T00:00:00.000Z'),
  ('main', 'admin', 'inventory.waste.record', '2026-09-13T00:00:00.000Z'),
  ('main', 'staff', 'inventory.consume.confirm', '2026-09-13T00:00:00.000Z'),
  ('main', 'reception', 'inventory.view', '2026-09-13T00:00:00.000Z');