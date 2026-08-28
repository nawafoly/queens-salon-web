-- Weekly-rest/public-holiday operational workflow hardening.
-- Holiday work is an assignment + observed-work event; the public holiday itself
-- is never cancelled. Comp-time selection requires explicit employee consent.
--
-- Keep this migration idempotent because a failed remote migration attempt may
-- have created the table/index before D1 reports the migration as applied.

CREATE TABLE IF NOT EXISTS employee_public_holiday_work_assignments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  holiday_calendar_id TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  holiday_code TEXT NOT NULL,

  reason TEXT NOT NULL,
  note TEXT,

  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'cancelled', 'completed')),

  assigned_by_uid TEXT,
  assigned_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_work_assignment_active
  ON employee_public_holiday_work_assignments(
    salon_id,
    employee_id,
    holiday_calendar_id
  )
  WHERE status = 'assigned';

CREATE INDEX IF NOT EXISTS idx_public_holiday_work_assignment_date
  ON employee_public_holiday_work_assignments(
    salon_id,
    holiday_date,
    status
  );

CREATE TRIGGER IF NOT EXISTS trg_public_holiday_comp_time_requires_consent_insert
BEFORE INSERT ON employee_public_holiday_work_events
WHEN NEW.compensation_mode = 'comp_time'
  AND (NEW.employee_consent_at IS NULL OR TRIM(NEW.employee_consent_at) = '')
BEGIN
  SELECT RAISE(ABORT, 'public_holiday_comp_time_requires_employee_consent');
END;

CREATE TRIGGER IF NOT EXISTS trg_public_holiday_comp_time_requires_consent_update
BEFORE UPDATE OF compensation_mode, employee_consent_at ON employee_public_holiday_work_events
WHEN NEW.compensation_mode = 'comp_time'
  AND (NEW.employee_consent_at IS NULL OR TRIM(NEW.employee_consent_at) = '')
BEGIN
  SELECT RAISE(ABORT, 'public_holiday_comp_time_requires_employee_consent');
END;
