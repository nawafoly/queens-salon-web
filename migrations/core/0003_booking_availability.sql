ALTER TABLE booking_items ADD COLUMN booking_date TEXT;
ALTER TABLE booking_items ADD COLUMN start_time TEXT;
ALTER TABLE booking_items ADD COLUMN end_time TEXT;
ALTER TABLE booking_items ADD COLUMN cart_item_id TEXT;
ALTER TABLE booking_items ADD COLUMN package_reservation_id TEXT;

ALTER TABLE bookings ADD COLUMN slot_step_min INTEGER NOT NULL DEFAULT 10;
ALTER TABLE bookings ADD COLUMN buffer_min INTEGER NOT NULL DEFAULT 0;

ALTER TABLE staff ADD COLUMN leave_start_date TEXT;
ALTER TABLE staff ADD COLUMN leave_end_date TEXT;
ALTER TABLE staff ADD COLUMN leave_note TEXT;

CREATE TABLE IF NOT EXISTS booking_slot_locks (
  salon_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  booking_item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, staff_id, booking_date, slot_time)
);

CREATE INDEX IF NOT EXISTS idx_core_booking_items_staff_date
  ON booking_items(salon_id, staff_id, booking_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_core_booking_items_cart_item
  ON booking_items(salon_id, booking_id, cart_item_id)
  WHERE cart_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_core_slot_locks_booking
  ON booking_slot_locks(salon_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_core_slot_locks_staff_date
  ON booking_slot_locks(salon_id, staff_id, booking_date, slot_time);
