-- Saudi Labor compliance foundation.
-- Runtime cutover and historical data reconciliation are intentionally separate.
-- No existing balance is mutated by this migration.

ALTER TABLE payroll_entries
  ADD COLUMN labor_policy_version TEXT;

ALTER TABLE payroll_entries
  ADD COLUMN fixed_actual_wage_halalas INTEGER;

ALTER TABLE payroll_entries
  ADD COLUMN wage_source_updated_at TEXT;

ALTER TABLE payroll_entries
  ADD COLUMN overtime_actual_hourly_halalas INTEGER;

ALTER TABLE payroll_entries
  ADD COLUMN overtime_basic_hourly_halalas INTEGER;

ALTER TABLE employee_leaves
  ADD COLUMN policy_version TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN pay_rate_bps INTEGER;

ALTER TABLE employee_leaves
  ADD COLUMN balance_bucket TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN entitlement_source_type TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN entitlement_source_id TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN legal_basis TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN documentation_status TEXT NOT NULL DEFAULT 'not_required';

CREATE TABLE employee_comp_time_ledger (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,

  entitlement_type TEXT NOT NULL CHECK (
    entitlement_type IN (
      'overtime_comp',
      'weekly_rest_due',
      'public_holiday_overlap_due'
    )
  ),

  entry_kind TEXT NOT NULL CHECK (
    entry_kind IN ('credit', 'debit', 'reversal')
  ),

  minutes INTEGER NOT NULL CHECK (minutes > 0),
  source_minutes INTEGER NOT NULL DEFAULT 0 CHECK (source_minutes >= 0),

  balance_before_minutes INTEGER NOT NULL CHECK (balance_before_minutes >= 0),
  balance_after_minutes INTEGER NOT NULL CHECK (balance_after_minutes >= 0),

  conversion_ratio_milli INTEGER,
  source_date TEXT,

  source_type TEXT NOT NULL,
  source_id TEXT,

  employee_consent_at TEXT,
  employee_consent_reference TEXT,

  expires_at TEXT,
  policy_version TEXT NOT NULL,
  note TEXT,

  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_employee_comp_time_employee
  ON employee_comp_time_ledger(
    salon_id,
    employee_id,
    entitlement_type,
    created_at DESC
  );

CREATE INDEX idx_employee_comp_time_expiry
  ON employee_comp_time_ledger(
    salon_id,
    entitlement_type,
    expires_at
  );

CREATE UNIQUE INDEX idx_employee_comp_time_source_kind
  ON employee_comp_time_ledger(
    salon_id,
    entitlement_type,
    source_type,
    source_id,
    entry_kind
  )
  WHERE source_id IS NOT NULL;

CREATE TABLE employee_labor_compliance_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT,

  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN ('info', 'warning', 'blocking')
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'resolved', 'waived')
  ),

  source_type TEXT,
  source_id TEXT,

  details_json TEXT NOT NULL DEFAULT '{}',
  policy_version TEXT NOT NULL,

  created_by_uid TEXT,
  created_at TEXT NOT NULL,

  resolved_by_uid TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE INDEX idx_labor_compliance_events_open
  ON employee_labor_compliance_events(
    salon_id,
    status,
    severity,
    created_at DESC
  );

CREATE INDEX idx_labor_compliance_events_employee
  ON employee_labor_compliance_events(
    salon_id,
    employee_id,
    status,
    created_at DESC
  );