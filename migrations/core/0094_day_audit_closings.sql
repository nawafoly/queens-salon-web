CREATE TABLE IF NOT EXISTS day_audit_closings (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  audit_date TEXT NOT NULL,
  total_halalas INTEGER NOT NULL CHECK (total_halalas >= 0),
  cash_halalas INTEGER NOT NULL CHECK (cash_halalas >= 0),
  card_halalas INTEGER NOT NULL CHECK (card_halalas >= 0),
  transfer_halalas INTEGER NOT NULL CHECK (transfer_halalas >= 0),
  unclassified_halalas INTEGER NOT NULL DEFAULT 0 CHECK (unclassified_halalas >= 0),
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
