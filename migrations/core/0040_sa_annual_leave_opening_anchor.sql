-- Annual leave opening-balance anchor hardening.
-- 0039 introduced canonical metadata columns. This migration makes the
-- opening balance a first-class auditable anchor, including a valid zero
-- balance, without rewriting historical leave or payroll data.

DROP INDEX IF EXISTS idx_employee_leave_balance_ledger_employee;
DROP INDEX IF EXISTS idx_employee_leave_balance_ledger_source;
DROP INDEX IF EXISTS idx_employee_leave_balance_ledger_source_unique;
DROP INDEX IF EXISTS idx_employee_leave_balance_ledger_effective;

CREATE TABLE employee_leave_balance_ledger_v2 (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,

  action_type TEXT NOT NULL
    CHECK (action_type IN ('add', 'deduct')),

  days REAL NOT NULL
    CHECK (
      days > 0 OR
      (entry_code = 'OPENING_BALANCE' AND days = 0)
    ),

  change_amount REAL NOT NULL,

  balance_before REAL NOT NULL,
  balance_after REAL NOT NULL,

  operation_date TEXT NOT NULL,
  note TEXT,

  source_type TEXT NOT NULL DEFAULT 'manual_adjustment',
  source_id TEXT,

  created_by_uid TEXT,
  created_by_email TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,

  deleted_at TEXT,
  deleted_by_uid TEXT,
  deleted_by_email TEXT,
  deleted_by_name TEXT,
  delete_reason TEXT,

  entry_code TEXT
    CHECK (
      entry_code IS NULL OR
      entry_code IN (
        'OPENING_BALANCE',
        'LEAVE_USED',
        'LEAVE_REVERSAL',
        'MANUAL_CORRECTION',
        'CARRYOVER',
        'CARRYOVER_EXPIRY',
        'MIGRATION_LEGACY'
      )
    ),

  effective_date TEXT,

  service_year_start TEXT,
  service_year_end TEXT,

  policy_version TEXT,

  metadata_json TEXT NOT NULL DEFAULT '{}',

  CHECK (
    entry_code IS NULL OR
    effective_date IS NOT NULL
  )
);

INSERT INTO employee_leave_balance_ledger_v2 (
  id,
  salon_id,
  employee_id,
  action_type,
  days,
  change_amount,
  balance_before,
  balance_after,
  operation_date,
  note,
  source_type,
  source_id,
  created_by_uid,
  created_by_email,
  created_by_name,
  created_at,
  deleted_at,
  deleted_by_uid,
  deleted_by_email,
  deleted_by_name,
  delete_reason,
  entry_code,
  effective_date,
  service_year_start,
  service_year_end,
  policy_version,
  metadata_json
)
SELECT
  id,
  salon_id,
  employee_id,
  action_type,
  days,
  change_amount,
  balance_before,
  balance_after,
  operation_date,
  note,
  source_type,
  source_id,
  created_by_uid,
  created_by_email,
  created_by_name,
  created_at,
  deleted_at,
  deleted_by_uid,
  deleted_by_email,
  deleted_by_name,
  delete_reason,
  entry_code,
  effective_date,
  service_year_start,
  service_year_end,
  policy_version,
  COALESCE(metadata_json, '{}')
FROM employee_leave_balance_ledger;

DROP TABLE employee_leave_balance_ledger;

ALTER TABLE employee_leave_balance_ledger_v2
  RENAME TO employee_leave_balance_ledger;

CREATE INDEX idx_employee_leave_balance_ledger_employee
  ON employee_leave_balance_ledger(
    salon_id,
    employee_id,
    created_at DESC
  );

CREATE INDEX idx_employee_leave_balance_ledger_source
  ON employee_leave_balance_ledger(
    salon_id,
    source_type,
    source_id
  );

CREATE UNIQUE INDEX idx_employee_leave_balance_ledger_source_unique
  ON employee_leave_balance_ledger(
    salon_id,
    source_type,
    source_id
  )
  WHERE source_id IS NOT NULL;

CREATE INDEX idx_employee_leave_balance_ledger_effective
  ON employee_leave_balance_ledger(
    salon_id,
    employee_id,
    effective_date,
    created_at
  );

CREATE INDEX idx_employee_leave_balance_ledger_code
  ON employee_leave_balance_ledger(
    salon_id,
    employee_id,
    entry_code,
    effective_date
  );

CREATE UNIQUE INDEX idx_employee_leave_opening_balance_active
  ON employee_leave_balance_ledger(
    salon_id,
    employee_id
  )
  WHERE
    entry_code = 'OPENING_BALANCE' AND
    deleted_at IS NULL;
