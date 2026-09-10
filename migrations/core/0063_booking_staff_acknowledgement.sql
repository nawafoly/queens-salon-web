CREATE TABLE IF NOT EXISTS booking_staff_acknowledgements (
  salon_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  acknowledged_by_uid TEXT,
  PRIMARY KEY (salon_id, booking_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_staff_ack_employee
  ON booking_staff_acknowledgements(salon_id, employee_id, acknowledged_at DESC);
