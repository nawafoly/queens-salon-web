ALTER TABLE bookings ADD COLUMN deleted_at TEXT;
ALTER TABLE bookings ADD COLUMN deleted_by_uid TEXT;
ALTER TABLE bookings ADD COLUMN delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_core_bookings_active_dashboard
  ON bookings(salon_id, booking_date DESC, start_time DESC)
  WHERE deleted_at IS NULL;
