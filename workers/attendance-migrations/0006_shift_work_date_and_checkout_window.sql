-- Keep attendance punches attached to the shift work date across midnight.
-- A check-out remains valid for three hours after the actual shift end.
-- After that window, the previous day remains incomplete and the employee can
-- start a new shift without inventing a check-out time.

ALTER TABLE attendance_records
  ADD COLUMN work_date TEXT;

UPDATE attendance_records
   SET work_date = date(server_time, '+3 hours')
 WHERE work_date IS NULL
   AND result = 'allowed';

CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_work_date
  ON attendance_records (employee_uid, work_date, server_time DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_work_date_result
  ON attendance_records (work_date, result, server_time DESC);

ALTER TABLE attendance_state
  ADD COLUMN work_date TEXT;

ALTER TABLE attendance_state
  ADD COLUMN shift_end_at TEXT;

ALTER TABLE attendance_state
  ADD COLUMN checkout_deadline_at TEXT;

UPDATE attendance_state
   SET work_date = date(last_server_time, '+3 hours')
 WHERE work_date IS NULL
   AND status = 'checked_in'
   AND last_server_time IS NOT NULL;
