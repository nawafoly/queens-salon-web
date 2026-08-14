-- Canonical employee annual leave balance ledger.
-- CORE D1 ONLY. No Firestore fallback.

ALTER TABLE employee_employment
  ADD COLUMN leave_entitlement_date TEXT;

-- Internal atomicity marker.
-- Every successful balance mutation stores the exact ledger entry
-- that performed the latest leave-balance change.
ALTER TABLE employee_employment
  ADD COLUMN leave_balance_last_entry_id TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN deduct_from_balance INTEGER NOT NULL DEFAULT 0;

ALTER TABLE employee_leaves
  ADD COLUMN affects_payroll INTEGER NOT NULL DEFAULT 0;

ALTER TABLE employee_leaves
  ADD COLUMN balance_adjustment_id TEXT;

CREATE TABLE employee_leave_balance_ledger (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,

  action_type TEXT NOT NULL
    CHECK (action_type IN ('add', 'deduct')),

  days REAL NOT NULL
    CHECK (days > 0),

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
  delete_reason TEXT
);

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

-- One operational Core leave per source employee leave request.
CREATE UNIQUE INDEX idx_employee_leaves_request_unique
  ON employee_leaves(
    salon_id,
    request_id
  )
  WHERE request_id IS NOT NULL;
