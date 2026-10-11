CREATE TABLE IF NOT EXISTS day_audit_closings (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  audit_date TEXT NOT NULL,
  total_halalas INTEGER NOT NULL,
  cash_halalas INTEGER NOT NULL,
  card_halalas INTEGER NOT NULL,
  transfer_halalas INTEGER NOT NULL,
  unclassified_halalas INTEGER NOT NULL DEFAULT 0,
  manual_cash_halalas INTEGER NOT NULL CHECK (manual_cash_halalas >= 0),
  cash_diff_halalas INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by_uid TEXT,
  closed_by_name TEXT,
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (salon_id, audit_date)
);

CREATE INDEX IF NOT EXISTS idx_day_audit_closings_salon_date
  ON day_audit_closings (salon_id, audit_date DESC);
