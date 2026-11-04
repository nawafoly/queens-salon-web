-- Inventory periodic physical counts: durable sessions and counted lines.
-- CORE D1 ONLY. These records are an audit draft/report, NOT stock movements.
-- Submitting a session does not alter inventory_stock_levels or its ledger.
-- Production migration requires explicit readiness review and backup.

CREATE TABLE IF NOT EXISTS inventory_stocktake_sessions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'cancelled')),
  created_by_uid TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_stocktake_sessions_salon_recent
  ON inventory_stocktake_sessions(salon_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_stocktake_lines (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  item_unit TEXT NOT NULL,
  expected_qty REAL NOT NULL CHECK (expected_qty >= 0),
  counted_qty REAL CHECK (counted_qty IS NULL OR counted_qty >= 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, session_id, item_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_stocktake_lines_session
  ON inventory_stocktake_lines(salon_id, session_id, location_id, item_id);
