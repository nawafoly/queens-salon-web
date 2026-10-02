-- Internal booking drafts are non-operational working state.
-- They do not reserve slots, consume offers, create invoices, or count as bookings.

CREATE TABLE IF NOT EXISTS internal_booking_drafts (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  created_by_uid TEXT NOT NULL,
  title TEXT,
  current_step INTEGER NOT NULL DEFAULT 1,
  draft_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_internal_booking_drafts_owner_updated
  ON internal_booking_drafts(salon_id, created_by_uid, updated_at DESC)
  WHERE deleted_at IS NULL;
