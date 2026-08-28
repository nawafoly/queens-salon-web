-- Canonical leave consumption evidence for non-annual time entitlements.
-- Overtime compensatory time and weekly-rest substitute remain independent
-- from annual leave and from each other.

ALTER TABLE employee_leaves
  ADD COLUMN entitlement_minutes_requested INTEGER NOT NULL DEFAULT 0
  CHECK (entitlement_minutes_requested >= 0);

ALTER TABLE employee_leaves
  ADD COLUMN entitlement_minutes_applied INTEGER NOT NULL DEFAULT 0
  CHECK (entitlement_minutes_applied >= 0);

ALTER TABLE employee_leaves
  ADD COLUMN entitlement_ledger_entry_id TEXT;

CREATE UNIQUE INDEX idx_employee_leave_entitlement_ledger_entry
  ON employee_leaves(salon_id, entitlement_ledger_entry_id)
  WHERE entitlement_ledger_entry_id IS NOT NULL;

CREATE TRIGGER trg_leave_overtime_comp_approval_requires_ledger_insert
BEFORE INSERT ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'overtime_comp_time_use' AND
  (
    NEW.balance_bucket <> 'overtime_comp' OR
    NEW.entitlement_minutes_applied <= 0 OR
    NEW.entitlement_ledger_entry_id IS NULL OR
    NEW.deduct_from_balance <> 0 OR
    NEW.affects_payroll <> 0
  )
BEGIN
  SELECT RAISE(ABORT, 'overtime_comp_leave_requires_entitlement_ledger');
END;

CREATE TRIGGER trg_leave_overtime_comp_approval_requires_ledger_update
BEFORE UPDATE OF status, leave_type, balance_bucket,
                 entitlement_minutes_applied, entitlement_ledger_entry_id,
                 deduct_from_balance, affects_payroll
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'overtime_comp_time_use' AND
  (
    NEW.balance_bucket <> 'overtime_comp' OR
    NEW.entitlement_minutes_applied <= 0 OR
    NEW.entitlement_ledger_entry_id IS NULL OR
    NEW.deduct_from_balance <> 0 OR
    NEW.affects_payroll <> 0
  )
BEGIN
  SELECT RAISE(ABORT, 'overtime_comp_leave_requires_entitlement_ledger');
END;

CREATE TRIGGER trg_leave_weekly_rest_approval_requires_ledger_insert
BEFORE INSERT ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'weekly_rest_substitute_use' AND
  (
    NEW.balance_bucket <> 'weekly_rest_due' OR
    NEW.entitlement_minutes_applied <> 1440 OR
    NEW.entitlement_ledger_entry_id IS NULL OR
    NEW.deduct_from_balance <> 0 OR
    NEW.affects_payroll <> 0
  )
BEGIN
  SELECT RAISE(ABORT, 'weekly_rest_leave_requires_24h_entitlement_ledger');
END;

CREATE TRIGGER trg_leave_weekly_rest_approval_requires_ledger_update
BEFORE UPDATE OF status, leave_type, balance_bucket,
                 entitlement_minutes_applied, entitlement_ledger_entry_id,
                 deduct_from_balance, affects_payroll
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'weekly_rest_substitute_use' AND
  (
    NEW.balance_bucket <> 'weekly_rest_due' OR
    NEW.entitlement_minutes_applied <> 1440 OR
    NEW.entitlement_ledger_entry_id IS NULL OR
    NEW.deduct_from_balance <> 0 OR
    NEW.affects_payroll <> 0
  )
BEGIN
  SELECT RAISE(ABORT, 'weekly_rest_leave_requires_24h_entitlement_ledger');
END;
