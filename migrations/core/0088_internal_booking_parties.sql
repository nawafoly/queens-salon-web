-- Administrative party booking: several canonical client bookings created from one reception checkout.
-- Each booking remains owned by exactly one canonical client; party_id only groups them operationally.

ALTER TABLE bookings ADD COLUMN party_id TEXT;
ALTER TABLE bookings ADD COLUMN party_lead_client_id TEXT;
ALTER TABLE bookings ADD COLUMN party_member_order INTEGER;
ALTER TABLE bookings ADD COLUMN party_size INTEGER;

CREATE INDEX IF NOT EXISTS idx_core_bookings_party
  ON bookings(salon_id, party_id, party_member_order, booking_date, start_time)
  WHERE party_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_bookings_party_member_order_unique
  ON bookings(salon_id, party_id, party_member_order)
  WHERE party_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_bookings_party_client_unique
  ON bookings(salon_id, party_id, client_id)
  WHERE party_id IS NOT NULL AND deleted_at IS NULL;
