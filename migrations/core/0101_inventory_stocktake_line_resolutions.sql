-- Review decisions for submitted physical count reports.
-- CORE D1 ONLY. This builds on 0100 and must first be tested in isolated Staging.
-- No production D1 migration without explicit release review and backup.

CREATE TABLE IF NOT EXISTS inventory_stocktake_line_resolutions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPLY', 'DISMISS')),
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) BETWEEN 3 AND 300),
  movement_id TEXT,
  resolved_by_uid TEXT,
  resolved_by_name TEXT,
  resolved_at TEXT NOT NULL,
  UNIQUE (salon_id, session_id, line_id),
  CHECK ((decision = 'APPLY' AND movement_id IS NOT NULL)
      OR (decision = 'DISMISS' AND movement_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_inv_stocktake_resolutions_session
  ON inventory_stocktake_line_resolutions(salon_id, session_id, line_id);
