ALTER TABLE bookings ADD COLUMN staff_ack INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN staff_ack_at TEXT;
ALTER TABLE bookings ADD COLUMN staff_ack_by_uid TEXT;
