-- Traceable employee payroll obligations: recurring deductions, deferrals and installment plans.
-- This is intentionally separate from payroll_carryover_adjustments:
--   obligation/deferral = known deduction collection decision before payroll approval
--   carryover           = financial correction after an Approved/Paid snapshot
-- Statutory GOSI deductions are NOT deferrable through this domain.

CREATE TABLE IF NOT EXISTS employee_recurring_deductions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  title TEXT NOT NULL,
  deduction_kind TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL CHECK(amount_halalas > 0),
  cadence TEXT NOT NULL DEFAULT 'monthly' CHECK(cadence IN ('monthly')),
  start_payroll_month TEXT NOT NULL,
  end_payroll_month TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'ended', 'cancelled')),
  reason TEXT NOT NULL,
  note TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  created_by_uid TEXT,
  created_by_email TEXT,
  updated_by_uid TEXT,
  updated_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_recurring_deductions_employee
  ON employee_recurring_deductions(salon_id, employee_id, status, start_payroll_month);

CREATE TABLE IF NOT EXISTS employee_payroll_obligations (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  recurring_deduction_id TEXT,
  obligation_kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  original_payroll_month TEXT NOT NULL,
  original_amount_halalas INTEGER NOT NULL CHECK(original_amount_halalas > 0),
  remaining_amount_halalas INTEGER NOT NULL CHECK(remaining_amount_halalas >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open', 'scheduled', 'partially_settled', 'settled', 'cancelled')),
  reason TEXT NOT NULL,
  note TEXT,
  created_by_uid TEXT,
  created_by_email TEXT,
  cancelled_by_uid TEXT,
  cancelled_by_email TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_payroll_obligations_employee
  ON employee_payroll_obligations(salon_id, employee_id, status, original_payroll_month);
CREATE INDEX IF NOT EXISTS idx_employee_payroll_obligations_source
  ON employee_payroll_obligations(salon_id, source_type, source_ref);

CREATE TABLE IF NOT EXISTS employee_payroll_obligation_installments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  obligation_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  target_payroll_month TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL CHECK(amount_halalas > 0),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled', 'applied', 'deferred', 'cancelled')),
  applied_payroll_entry_id TEXT,
  applied_at TEXT,
  deferred_from_installment_id TEXT,
  superseded_by_installment_id TEXT,
  decision_reason TEXT NOT NULL,
  note TEXT,
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(salon_id, obligation_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_employee_payroll_obligation_installments_target
  ON employee_payroll_obligation_installments(salon_id, target_payroll_month, status);
CREATE INDEX IF NOT EXISTS idx_employee_payroll_obligation_installments_obligation
  ON employee_payroll_obligation_installments(salon_id, obligation_id, status, sequence_no);
