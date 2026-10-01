-- Booking-only companions for internal party bookings.
-- A guest companion is intentionally NOT a row in clients.
-- The booking keeps a stable participant id in bookings.client_id while
-- participant PII is scoped to this booking/party only.

CREATE TABLE IF NOT EXISTS booking_party_guests (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_booking_party_guests_booking
  ON booking_party_guests(salon_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_core_booking_party_guests_party
  ON booking_party_guests(salon_id, party_id, id);
