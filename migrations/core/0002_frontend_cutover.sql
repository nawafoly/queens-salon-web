ALTER TABLE services ADD COLUMN section_id TEXT;
ALTER TABLE staff ADD COLUMN avatar_url TEXT;
ALTER TABLE staff ADD COLUMN show_on_booking INTEGER NOT NULL DEFAULT 1;
ALTER TABLE staff ADD COLUMN specialties_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bookings ADD COLUMN public_id TEXT;

CREATE INDEX IF NOT EXISTS idx_core_services_active_section
  ON services(salon_id, active, section_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_bookings_public_id
  ON bookings(salon_id, public_id)
  WHERE public_id IS NOT NULL;
