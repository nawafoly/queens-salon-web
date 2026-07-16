-- Booking discount snapshots and per-item allocations.
-- Local migration only until explicitly applied to production.

ALTER TABLE bookings ADD COLUMN discount_snapshot_json TEXT;
ALTER TABLE invoices ADD COLUMN discount_snapshot_json TEXT;

ALTER TABLE booking_items ADD COLUMN discount_halalas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_items ADD COLUMN final_total_halalas INTEGER;

ALTER TABLE discounts ADD COLUMN min_order_halalas INTEGER;
ALTER TABLE discounts ADD COLUMN max_discount_halalas INTEGER;
ALTER TABLE discounts ADD COLUMN per_client_limit INTEGER;
ALTER TABLE discounts ADD COLUMN category_ids_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_core_bookings_discount_client
  ON bookings(salon_id, client_id)
  WHERE discount_snapshot_json IS NOT NULL AND discount_snapshot_json <> '';
