-- Saudi Labor statutory overtime request runtime.
-- Overtime request approval authorizes work; payroll remains based on verified
-- actual work and the canonical statutory wage formula.

ALTER TABLE employee_overtime_records
  ADD COLUMN compensation_mode TEXT NOT NULL DEFAULT 'cash_overtime'
  CHECK (compensation_mode IN ('cash_overtime','comp_time'));

ALTER TABLE employee_overtime_records
  ADD COLUMN employee_consent_at TEXT;

ALTER TABLE employee_overtime_records
  ADD COLUMN employee_consent_reference TEXT;

ALTER TABLE employee_overtime_records
  ADD COLUMN policy_version TEXT;

ALTER TABLE employee_overtime_records
  ADD COLUMN actual_worked_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (actual_worked_minutes >= 0);

ALTER TABLE employee_overtime_records
  ADD COLUMN attendance_reconciled_at TEXT;

ALTER TABLE employee_overtime_records
  ADD COLUMN financial_status TEXT NOT NULL DEFAULT 'pending_attendance'
  CHECK (
    financial_status IN (
      'pending_attendance',
      'ready_for_payroll',
      'included',
      'comp_time_credited',
      'cancelled'
    )
  );

CREATE INDEX idx_employee_overtime_financial_status
  ON employee_overtime_records(
    salon_id,
    employee_id,
    financial_status,
    date_key
  );
