-- Historical payroll settlements for approved/paid payroll corrections.
-- The original payroll entry/snapshot stays immutable. Direct settlements are
-- recorded separately and reduce only the remaining carryover residual.

CREATE TABLE IF NOT EXISTS payroll_historical_settlements (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  source_payroll_month TEXT NOT NULL,
  source_payroll_entry_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('addition', 'deduction')),
  amount_halalas INTEGER NOT NULL CHECK(amount_halalas > 0),
  settlement_method TEXT NOT NULL DEFAULT 'other'
    CHECK(settlement_method IN ('cash', 'bank_transfer', 'other')),
  settlement_date TEXT NOT NULL,
  reference TEXT,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK(status IN ('recorded', 'void')),
  operation_id TEXT NOT NULL,
  recorded_by_uid TEXT,
  recorded_by_name TEXT,
  voided_at TEXT,
  voided_by_uid TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_historical_settlement_operation
  ON payroll_historical_settlements(salon_id, operation_id);

CREATE INDEX IF NOT EXISTS idx_payroll_historical_settlement_source
  ON payroll_historical_settlements(
    salon_id,
    source_snapshot_id,
    status,
    created_at
  );

CREATE INDEX IF NOT EXISTS idx_payroll_historical_settlement_employee_month
  ON payroll_historical_settlements(
    salon_id,
    employee_id,
    source_payroll_month,
    status
  );
