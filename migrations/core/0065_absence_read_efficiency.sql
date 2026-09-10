CREATE INDEX IF NOT EXISTS idx_employee_absence_salon_date
  ON employee_absences(salon_id, date_key DESC);

CREATE INDEX IF NOT EXISTS idx_employee_absence_employee_date
  ON employee_absences(salon_id, employee_id, date_key DESC);

CREATE INDEX IF NOT EXISTS idx_employee_absence_uid_date
  ON employee_absences(salon_id, employee_uid, date_key DESC);
