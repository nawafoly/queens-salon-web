-- Payroll early-approval snapshot + next-period reconciliation.
-- Additive migration only. Approved payroll entries remain immutable.

CREATE TABLE IF NOT EXISTS payroll_approval_snapshots (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  payroll_entry_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  approval_version INTEGER NOT NULL DEFAULT 1,
  approved_at TEXT NOT NULL,
  approved_by_uid TEXT,
  approved_net_halalas INTEGER NOT NULL DEFAULT 0,
  base_salary_halalas INTEGER NOT NULL DEFAULT 0,
  total_additions_halalas INTEGER NOT NULL DEFAULT 0,
  total_deductions_halalas INTEGER NOT NULL DEFAULT 0,
  attendance_summary_json TEXT,
  entry_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_approval_snapshot_version
  ON payroll_approval_snapshots(salon_id, payroll_entry_id, approval_version);
CREATE INDEX IF NOT EXISTS idx_payroll_approval_snapshot_employee_month
  ON payroll_approval_snapshots(salon_id, employee_id, payroll_month, approval_version DESC);

CREATE TABLE IF NOT EXISTS payroll_carryover_adjustments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  source_payroll_month TEXT NOT NULL,
  target_payroll_month TEXT NOT NULL,
  source_payroll_entry_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('addition', 'deduction')),
  amount_halalas INTEGER NOT NULL DEFAULT 0,
  approved_net_halalas INTEGER NOT NULL DEFAULT 0,
  recalculated_net_halalas INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  source_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'void')),
  target_payroll_entry_id TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payroll_carryover_target
  ON payroll_carryover_adjustments(salon_id, target_payroll_month, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_carryover_source
  ON payroll_carryover_adjustments(salon_id, source_snapshot_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_carryover_pending_target
  ON payroll_carryover_adjustments(salon_id, source_snapshot_id, target_payroll_month)
  WHERE status = 'pending';
