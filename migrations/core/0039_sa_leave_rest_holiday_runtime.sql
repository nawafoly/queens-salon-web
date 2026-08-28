-- Saudi Labor leave/rest/holiday runtime foundation.
-- Builds durable domain separation without mutating historical balances or payroll.

ALTER TABLE employee_employment
  ADD COLUMN annual_leave_contract_days REAL;

ALTER TABLE employee_employment
  ADD COLUMN annual_leave_accrual_mode TEXT NOT NULL DEFAULT 'service_anniversary';

ALTER TABLE employee_employment
  ADD COLUMN annual_leave_legacy_projection_updated_at TEXT;

ALTER TABLE employee_leave_balance_ledger
  ADD COLUMN entry_code TEXT;

ALTER TABLE employee_leave_balance_ledger
  ADD COLUMN effective_date TEXT;

ALTER TABLE employee_leave_balance_ledger
  ADD COLUMN service_year_start TEXT;

ALTER TABLE employee_leave_balance_ledger
  ADD COLUMN service_year_end TEXT;

ALTER TABLE employee_leave_balance_ledger
  ADD COLUMN policy_version TEXT;

ALTER TABLE employee_leave_balance_ledger
  ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX idx_employee_leave_balance_ledger_effective
  ON employee_leave_balance_ledger(
    salon_id,
    employee_id,
    effective_date,
    created_at
  );

ALTER TABLE employee_leaves
  ADD COLUMN sick_year_start TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN sick_day_ordinal_from INTEGER;

ALTER TABLE employee_leaves
  ADD COLUMN sick_day_ordinal_to INTEGER;

ALTER TABLE employee_leaves
  ADD COLUMN pay_segments_json TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_review_required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE employee_sick_leave_segments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_id TEXT NOT NULL,
  sick_year_start TEXT NOT NULL,
  ordinal_from INTEGER NOT NULL CHECK (ordinal_from >= 1),
  ordinal_to INTEGER NOT NULL CHECK (ordinal_to >= ordinal_from),
  days REAL NOT NULL CHECK (days > 0),
  pay_rate_bps INTEGER NOT NULL CHECK (pay_rate_bps >= 0 AND pay_rate_bps <= 10000),
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_employee_sick_leave_segments_employee
  ON employee_sick_leave_segments(
    salon_id,
    employee_id,
    sick_year_start,
    ordinal_from
  );

CREATE UNIQUE INDEX idx_employee_sick_leave_segments_range
  ON employee_sick_leave_segments(
    salon_id,
    leave_id,
    ordinal_from,
    ordinal_to
  );

CREATE TABLE employee_weekly_rest_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  rest_date TEXT NOT NULL,

  schedule_source_type TEXT NOT NULL,
  schedule_source_id TEXT,
  schedule_snapshot_json TEXT NOT NULL DEFAULT '{}',

  attendance_source_type TEXT,
  attendance_source_id TEXT,
  attendance_evidence_json TEXT NOT NULL DEFAULT '{}',

  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),

  restoration_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (
    restoration_status IN ('not_required','pending_review','owed','scheduled','fulfilled')
  ),
  substitute_rest_minutes INTEGER NOT NULL DEFAULT 0 CHECK (substitute_rest_minutes >= 0),
  substitute_rest_source_id TEXT,

  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','resolved','cancelled')
  ),
  details_json TEXT NOT NULL DEFAULT '{}',

  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_employee_weekly_rest_event_date
  ON employee_weekly_rest_events(
    salon_id,
    employee_id,
    rest_date
  );

CREATE INDEX idx_employee_weekly_rest_event_status
  ON employee_weekly_rest_events(
    salon_id,
    restoration_status,
    status,
    rest_date
  );

CREATE TABLE sa_public_holiday_calendar (
  id TEXT PRIMARY KEY,
  holiday_code TEXT NOT NULL CHECK (
    holiday_code IN ('eid_al_fitr','eid_al_adha','national_day','founding_day')
  ),
  holiday_date TEXT NOT NULL,
  holiday_name_ar TEXT NOT NULL,
  holiday_name_en TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  calendar_year INTEGER NOT NULL,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (
    status IN ('draft','verified','superseded')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_sa_public_holiday_calendar_date_code
  ON sa_public_holiday_calendar(
    holiday_date,
    holiday_code
  );

CREATE INDEX idx_sa_public_holiday_calendar_year
  ON sa_public_holiday_calendar(
    calendar_year,
    status,
    holiday_date
  );

CREATE TABLE employee_public_holiday_work_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  holiday_calendar_id TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  holiday_code TEXT NOT NULL,

  assignment_source_type TEXT,
  assignment_source_id TEXT,
  assignment_reason TEXT,

  attendance_source_type TEXT,
  attendance_source_id TEXT,
  attendance_evidence_json TEXT NOT NULL DEFAULT '{}',

  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),

  compensation_mode TEXT NOT NULL DEFAULT 'cash_overtime' CHECK (
    compensation_mode IN ('cash_overtime','comp_time','pending_employee_choice')
  ),
  employee_consent_at TEXT,
  employee_consent_reference TEXT,
  comp_time_ledger_entry_id TEXT,

  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','resolved','cancelled')
  ),
  details_json TEXT NOT NULL DEFAULT '{}',

  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_employee_public_holiday_work_event
  ON employee_public_holiday_work_events(
    salon_id,
    employee_id,
    holiday_calendar_id
  );

CREATE INDEX idx_employee_public_holiday_work_status
  ON employee_public_holiday_work_events(
    salon_id,
    status,
    holiday_date
  );
