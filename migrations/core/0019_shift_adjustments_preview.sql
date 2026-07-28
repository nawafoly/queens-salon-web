-- Shift control v5: payroll-lock adjustments and preview support.

CREATE TABLE IF NOT EXISTS hr_shift_payroll_adjustments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  locked_periods_json TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hr_shift_payroll_adjustments_employee_date
  ON hr_shift_payroll_adjustments(salon_id, employee_id, date_from, date_to, status);
CREATE INDEX IF NOT EXISTS idx_hr_shift_payroll_adjustments_source
  ON hr_shift_payroll_adjustments(salon_id, source_entity_type, source_entity_id);
