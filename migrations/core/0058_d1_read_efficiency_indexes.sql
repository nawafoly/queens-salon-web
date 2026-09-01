-- Reduce D1 row scans for the production booking dashboard.
-- These composite indexes match the tenant-fenced hydration and active timeline queries.

CREATE INDEX IF NOT EXISTS idx_core_booking_items_salon_booking
  ON booking_items(salon_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_core_invoices_salon_booking
  ON invoices(salon_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_core_bookings_active_timeline
  ON bookings(salon_id, deleted_at, booking_date DESC, start_time DESC);
