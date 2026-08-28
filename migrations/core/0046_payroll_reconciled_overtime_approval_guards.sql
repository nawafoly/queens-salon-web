-- Approval guards for the reconciled-overtime cutover.
-- Reconciled approved work is statutory evidence and cannot be extinguished by
-- an internal overtime-enabled toggle. Approval instead validates that financial
-- hours and value agree exactly with the reconciled evidence and wage snapshot.

CREATE TRIGGER trg_payroll_approval_overtime_hours_match_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN
  NEW.status = 'approved' AND
  OLD.status <> 'approved' AND
  ABS(
    COALESCE(NEW.financial_overtime_hours, 0) -
    (COALESCE(NEW.reconciled_overtime_minutes, 0) / 60.0)
  ) > 0.011
BEGIN
  SELECT RAISE(ABORT, 'payroll_reconciled_overtime_hours_mismatch');
END;

CREATE TRIGGER trg_payroll_approval_overtime_value_presence_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN
  NEW.status = 'approved' AND
  OLD.status <> 'approved' AND
  (
    (
      NEW.reconciled_overtime_minutes = 0 AND
      COALESCE(NEW.overtime_value_halalas, 0) <> 0
    ) OR
    (
      NEW.reconciled_overtime_minutes > 0 AND
      COALESCE(NEW.overtime_value_halalas, 0) <= 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'payroll_reconciled_overtime_value_mismatch');
END;

CREATE TRIGGER trg_payroll_approval_overtime_value_formula_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN
  NEW.status = 'approved' AND
  OLD.status <> 'approved' AND
  NEW.reconciled_overtime_minutes > 0 AND
  COALESCE(NEW.overtime_value_halalas, 0) <> ROUND(
    (
      COALESCE(NEW.overtime_actual_hourly_halalas, 0) +
      ROUND(
        COALESCE(NEW.overtime_basic_hourly_halalas, 0) *
        MAX(
          5000,
          ROUND((MAX(1.5, COALESCE(NEW.overtime_multiplier, 1.5)) - 1) * 10000)
        ) /
        10000.0
      )
    ) *
    NEW.reconciled_overtime_minutes /
    60.0
  )
BEGIN
  SELECT RAISE(ABORT, 'payroll_reconciled_overtime_value_formula_mismatch');
END;
