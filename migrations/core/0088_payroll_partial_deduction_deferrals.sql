-- Canonical partial payroll-deduction deferrals.
-- A deferral reduces the amount collected from the source payroll month and
-- creates a payroll obligation for collection in a later mutable month.
-- The decision is stored independently so payroll recalculation remains
-- deterministic and auditable.

CREATE TABLE IF NOT EXISTS payroll_deduction_deferrals (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  request_key TEXT NOT NULL,

  source_payroll_month TEXT NOT NULL,
  target_payroll_month TEXT NOT NULL,

  amount_halalas INTEGER NOT NULL
    CHECK (amount_halalas > 0),

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),

  reason TEXT NOT NULL,
  note TEXT,

  obligation_id TEXT NOT NULL,

  created_by_uid TEXT NOT NULL,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  cancelled_by_uid TEXT,
  cancelled_by_email TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,

  FOREIGN KEY (obligation_id)
    REFERENCES employee_payroll_obligations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_deduction_deferrals_request
  ON payroll_deduction_deferrals(
    salon_id,
    employee_id,
    request_key
  );

CREATE INDEX IF NOT EXISTS idx_payroll_deduction_deferrals_source
  ON payroll_deduction_deferrals(
    salon_id,
    employee_id,
    source_payroll_month,
    status
  );

CREATE INDEX IF NOT EXISTS idx_payroll_deduction_deferrals_target
  ON payroll_deduction_deferrals(
    salon_id,
    employee_id,
    target_payroll_month,
    status
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_deduction_deferrals_obligation
  ON payroll_deduction_deferrals(obligation_id)
  WHERE obligation_id IS NOT NULL;
