-- Approval guards for the reconciled-overtime cutover.
-- A payroll cannot lock reconciled minutes while overtime policy is disabled,
-- nor can its financial hours/value disagree with the reconciled evidence.

CREATE TRIGGER trg_payroll_approval_overtime_policy_enabled_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN
  NEW.status = 'approved' AND
  OLD.status <> 'approved' AND
  NEW.reconciled_overtime_minutes > 0 AND
  COALESCE(NEW.overtime_enabled, 0) <> 1
BEGIN
  SELECT RAISE(ABORT, 'payroll_reconciled_overtime_policy_disabled');
END;

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
