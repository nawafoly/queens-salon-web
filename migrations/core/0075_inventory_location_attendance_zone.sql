-- Link inventory location to attendance work zone (HR owns the zone).
ALTER TABLE inventory_locations ADD COLUMN attendance_zone_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inv_loc_zone ON inventory_locations (salon_id, attendance_zone_id);
