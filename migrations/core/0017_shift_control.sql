-- Shift control v2: reusable templates, dated assignments, day/range exceptions,
-- payroll-period locks, and immutable audit history.

CREATE TABLE IF NOT EXISTS hr_shift_templates (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  start_time TEXT,
  end_time TEXT,
  crosses_midnight INTEGER NOT NULL DEFAULT 0,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  break_paid INTEGER NOT NULL DEFAULT 0,
  late_grace_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_grace_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_after_minutes INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_shift_templates_code
  ON hr_shift_templates(salon_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_shift_templates_active
  ON hr_shift_templates(salon_id, active, name);

CREATE TABLE IF NOT EXISTS hr_shift_assignments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  shift_template_id TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  assignment_type TEXT NOT NULL DEFAULT 'permanent',
  status TEXT NOT NULL DEFAULT 'published',
  reason TEXT,
  snapshot_json TEXT NOT NULL,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shift_template_id) REFERENCES hr_shift_templates(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_shift_assignments_employee_date
  ON hr_shift_assignments(salon_id, employee_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_hr_shift_assignments_template
  ON hr_shift_assignments(salon_id, shift_template_id);

CREATE TABLE IF NOT EXISTS hr_schedule_exceptions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  exception_type TEXT NOT NULL,
  shift_template_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  start_time TEXT,
  end_time TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  approved_by_uid TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shift_template_id) REFERENCES hr_shift_templates(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_schedule_exceptions_employee_date
  ON hr_schedule_exceptions(salon_id, employee_id, date_from, date_to, status);

CREATE TABLE IF NOT EXISTS hr_payroll_period_locks (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',
  reason TEXT,
  locked_by_uid TEXT,
  locked_at TEXT NOT NULL,
  unlocked_by_uid TEXT,
  unlocked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_payroll_period_lock_unique
  ON hr_payroll_period_locks(salon_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS hr_shift_audit_log (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  actor_uid TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hr_shift_audit_entity
  ON hr_shift_audit_log(salon_id, entity_type, entity_id, created_at);
