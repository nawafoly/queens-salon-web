-- Staff home inventory location. Consumption deducts from this location.
CREATE TABLE IF NOT EXISTS inventory_staff_locations (
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_staff_loc_salon ON inventory_staff_locations (salon_id, location_id);
