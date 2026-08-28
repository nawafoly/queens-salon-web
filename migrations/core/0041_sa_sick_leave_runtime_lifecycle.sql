-- Sick-leave runtime lifecycle hardening.
-- Approved sick segments are durable statutory usage. Cancellation never deletes
-- history; it reverses segment participation so future sick-year calculations stay correct.

ALTER TABLE employee_sick_leave_segments
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reversed'));

ALTER TABLE employee_sick_leave_segments
  ADD COLUMN reversed_at TEXT;

ALTER TABLE employee_sick_leave_segments
  ADD COLUMN reversed_by_uid TEXT;

ALTER TABLE employee_sick_leave_segments
  ADD COLUMN reversal_reason TEXT;

CREATE INDEX idx_employee_sick_leave_segments_active
  ON employee_sick_leave_segments(
    salon_id,
    employee_id,
    sick_year_start,
    status,
    ordinal_from
  );

CREATE TABLE employee_sick_leave_year_state (
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  sick_year_start TEXT NOT NULL,

  used_days REAL NOT NULL DEFAULT 0
    CHECK (used_days >= 0 AND used_days <= 120),

  version INTEGER NOT NULL DEFAULT 0
    CHECK (version >= 0),

  last_leave_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  PRIMARY KEY (
    salon_id,
    employee_id,
    sick_year_start
  )
);

CREATE INDEX idx_employee_sick_leave_year_state_employee
  ON employee_sick_leave_year_state(
    salon_id,
    employee_id,
    sick_year_start DESC
  );
