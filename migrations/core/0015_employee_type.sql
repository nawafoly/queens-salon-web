-- Separate administrative employees from booking service providers.
-- Employment defaults to administrative; only rows represented in staff
-- are classified as service providers.

ALTER TABLE employee_employment
  ADD COLUMN employee_type TEXT NOT NULL DEFAULT 'administrative'
  CHECK (employee_type IN ('administrative', 'service_provider'));

UPDATE employee_employment
SET employee_type = CASE
  WHEN EXISTS (
    SELECT 1
    FROM staff
    WHERE staff.salon_id = employee_employment.salon_id
      AND staff.id = employee_employment.employee_id
  )
  THEN 'service_provider'
  ELSE 'administrative'
END;

CREATE INDEX IF NOT EXISTS idx_employee_employment_type
  ON employee_employment(salon_id, employee_type, employment_status);