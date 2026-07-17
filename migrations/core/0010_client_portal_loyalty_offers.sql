-- Client portal source-of-truth, loyalty ledger, and publishable offer metadata.

CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'refund', 'adjustment')),
  points INTEGER NOT NULL,
  booking_id TEXT,
  refund_id TEXT,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_uid TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_loyalty_idempotency
  ON loyalty_point_transactions(salon_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_core_loyalty_client_created
  ON loyalty_point_transactions(salon_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_loyalty_booking
  ON loyalty_point_transactions(salon_id, booking_id);

ALTER TABLE discounts ADD COLUMN description TEXT;
ALTER TABLE discounts ADD COLUMN price_before_halalas INTEGER;
ALTER TABLE discounts ADD COLUMN price_after_halalas INTEGER;
ALTER TABLE discounts ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
ALTER TABLE discounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE discounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discounts ADD COLUMN cta_label TEXT;
ALTER TABLE discounts ADD COLUMN cta_url TEXT;
ALTER TABLE discounts ADD COLUMN target_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE discounts ADD COLUMN target_client_ids_json TEXT NOT NULL DEFAULT '[]';
