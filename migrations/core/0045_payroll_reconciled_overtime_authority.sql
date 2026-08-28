-- Payroll overtime authority cutover.
-- Raw attendance extra time remains an informational signal only. Financial
-- overtime must come from reconciled cash-overtime records. Comp-time can never
-- be linked to payroll, and an approved/paid payroll month is a hard boundary.

ALTER TABLE payroll_entries
  ADD COLUMN reconciled_overtime_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (reconciled_overtime_minutes >= 0);

ALTER TABLE payroll_entries
  ADD COLUMN overtime_source_snapshot_json TEXT NOT NULL DEFAULT '[]';

CREATE TRIGGER trg_overtime_comp_time_never_payroll_insert
BEFORE INSERT ON employee_overtime_records
WHEN
  NEW.compensation_mode = 'comp_time' AND
  (
    NEW.payroll_entry_id IS NOT NULL OR
    NEW.financial_status = 'included'
  )
BEGIN
  SELECT RAISE(ABORT, 'comp_time_cannot_be_included_in_payroll');
END;

CREATE TRIGGER trg_overtime_comp_time_never_payroll_update
BEFORE UPDATE OF compensation_mode, payroll_entry_id, financial_status
ON employee_overtime_records
WHEN
  NEW.compensation_mode = 'comp_time' AND
  (
    NEW.payroll_entry_id IS NOT NULL OR
    NEW.financial_status = 'included'
  )
BEGIN
  SELECT RAISE(ABORT, 'comp_time_cannot_be_included_in_payroll');
END;

CREATE TRIGGER trg_overtime_included_requires_cash_evidence_insert
BEFORE INSERT ON employee_overtime_records
WHEN
  NEW.financial_status = 'included' AND
  (
    NEW.compensation_mode <> 'cash_overtime' OR
    NEW.payroll_entry_id IS NULL OR
    NEW.actual_worked_minutes <= 0 OR
    NEW.attendance_reconciled_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'included_overtime_requires_reconciled_cash_evidence');
END;

CREATE TRIGGER trg_overtime_included_requires_cash_evidence_update
BEFORE UPDATE OF financial_status, compensation_mode, payroll_entry_id,
                 actual_worked_minutes, attendance_reconciled_at
ON employee_overtime_records
WHEN
  NEW.financial_status = 'included' AND
  (
    NEW.compensation_mode <> 'cash_overtime' OR
    NEW.payroll_entry_id IS NULL OR
    NEW.actual_worked_minutes <= 0 OR
    NEW.attendance_reconciled_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'included_overtime_requires_reconciled_cash_evidence');
END;

CREATE TRIGGER trg_overtime_comp_credit_requires_nonpayroll_evidence_insert
BEFORE INSERT ON employee_overtime_records
WHEN
  NEW.financial_status = 'comp_time_credited' AND
  (
    NEW.compensation_mode <> 'comp_time' OR
    NEW.comp_time_ledger_entry_id IS NULL OR
    NEW.payroll_entry_id IS NOT NULL OR
    NEW.actual_worked_minutes <= 0 OR
    NEW.attendance_reconciled_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'comp_time_credit_requires_reconciled_nonpayroll_evidence');
END;

CREATE TRIGGER trg_overtime_comp_credit_requires_nonpayroll_evidence_update
BEFORE UPDATE OF financial_status, compensation_mode, comp_time_ledger_entry_id,
                 payroll_entry_id, actual_worked_minutes, attendance_reconciled_at
ON employee_overtime_records
WHEN
  NEW.financial_status = 'comp_time_credited' AND
  (
    NEW.compensation_mode <> 'comp_time' OR
    NEW.comp_time_ledger_entry_id IS NULL OR
    NEW.payroll_entry_id IS NOT NULL OR
    NEW.actual_worked_minutes <= 0 OR
    NEW.attendance_reconciled_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'comp_time_credit_requires_reconciled_nonpayroll_evidence');
END;

CREATE TRIGGER trg_overtime_ready_blocked_after_payroll_lock_update
BEFORE UPDATE OF financial_status ON employee_overtime_records
WHEN
  NEW.financial_status = 'ready_for_payroll' AND
  OLD.financial_status <> 'ready_for_payroll' AND
  EXISTS (
    SELECT 1
      FROM payroll_entries payroll
     WHERE payroll.salon_id = NEW.salon_id
       AND payroll.employee_id = NEW.employee_id
       AND payroll.payroll_month = NEW.payroll_month
       AND payroll.status IN ('approved', 'paid')
  )
BEGIN
  SELECT RAISE(ABORT, 'overtime_payroll_month_locked');
END;

CREATE TRIGGER trg_payroll_reconciled_overtime_projection_insert
AFTER INSERT ON payroll_entries
BEGIN
  UPDATE payroll_entries
     SET reconciled_overtime_minutes = COALESCE((
           SELECT SUM(overtime.actual_worked_minutes)
             FROM employee_overtime_records overtime
            WHERE overtime.salon_id = NEW.salon_id
              AND overtime.employee_id = NEW.employee_id
              AND overtime.payroll_month = NEW.payroll_month
              AND overtime.compensation_mode = 'cash_overtime'
              AND (
                overtime.financial_status = 'ready_for_payroll' OR
                (
                  overtime.financial_status = 'included' AND
                  overtime.payroll_entry_id = NEW.id
                )
              )
         ), 0),
         overtime_source_snapshot_json = COALESCE((
           SELECT json_group_array(json_object(
             'id', overtime.id,
             'requestId', overtime.request_id,
             'date', overtime.date_key,
             'minutes', overtime.actual_worked_minutes,
             'status', overtime.financial_status,
             'attendanceReconciledAt', overtime.attendance_reconciled_at,
             'policyVersion', overtime.policy_version
           ))
             FROM employee_overtime_records overtime
            WHERE overtime.salon_id = NEW.salon_id
              AND overtime.employee_id = NEW.employee_id
              AND overtime.payroll_month = NEW.payroll_month
              AND overtime.compensation_mode = 'cash_overtime'
              AND (
                overtime.financial_status = 'ready_for_payroll' OR
                (
                  overtime.financial_status = 'included' AND
                  overtime.payroll_entry_id = NEW.id
                )
              )
         ), '[]')
   WHERE salon_id = NEW.salon_id
     AND id = NEW.id;
END;

CREATE TRIGGER trg_payroll_reconciled_overtime_projection_update
AFTER UPDATE OF employee_id, payroll_month, overtime_value_halalas,
                financial_overtime_hours, updated_at
ON payroll_entries
WHEN NEW.status IN ('draft', 'reviewed')
BEGIN
  UPDATE payroll_entries
     SET reconciled_overtime_minutes = COALESCE((
           SELECT SUM(overtime.actual_worked_minutes)
             FROM employee_overtime_records overtime
            WHERE overtime.salon_id = NEW.salon_id
              AND overtime.employee_id = NEW.employee_id
              AND overtime.payroll_month = NEW.payroll_month
              AND overtime.compensation_mode = 'cash_overtime'
              AND overtime.financial_status = 'ready_for_payroll'
         ), 0),
         overtime_source_snapshot_json = COALESCE((
           SELECT json_group_array(json_object(
             'id', overtime.id,
             'requestId', overtime.request_id,
             'date', overtime.date_key,
             'minutes', overtime.actual_worked_minutes,
             'status', overtime.financial_status,
             'attendanceReconciledAt', overtime.attendance_reconciled_at,
             'policyVersion', overtime.policy_version
           ))
             FROM employee_overtime_records overtime
            WHERE overtime.salon_id = NEW.salon_id
              AND overtime.employee_id = NEW.employee_id
              AND overtime.payroll_month = NEW.payroll_month
              AND overtime.compensation_mode = 'cash_overtime'
              AND overtime.financial_status = 'ready_for_payroll'
         ), '[]')
   WHERE salon_id = NEW.salon_id
     AND id = NEW.id;
END;

CREATE TRIGGER trg_payroll_approval_reconciled_overtime_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN
  NEW.status = 'approved' AND
  OLD.status <> 'approved' AND
  NEW.reconciled_overtime_minutes <> COALESCE((
    SELECT SUM(overtime.actual_worked_minutes)
      FROM employee_overtime_records overtime
     WHERE overtime.salon_id = NEW.salon_id
       AND overtime.employee_id = NEW.employee_id
       AND overtime.payroll_month = NEW.payroll_month
       AND overtime.compensation_mode = 'cash_overtime'
       AND (
         overtime.financial_status = 'ready_for_payroll' OR
         (
           overtime.financial_status = 'included' AND
           overtime.payroll_entry_id = NEW.id
         )
       )
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'payroll_reconciled_overtime_snapshot_stale');
END;

CREATE TRIGGER trg_payroll_approval_include_reconciled_overtime
AFTER UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved'
BEGIN
  UPDATE employee_overtime_records
     SET financial_status = 'included',
         payroll_entry_id = NEW.id,
         payout_status = 'approved',
         updated_at = NEW.updated_at
   WHERE salon_id = NEW.salon_id
     AND employee_id = NEW.employee_id
     AND payroll_month = NEW.payroll_month
     AND compensation_mode = 'cash_overtime'
     AND financial_status = 'ready_for_payroll'
     AND actual_worked_minutes > 0
     AND attendance_reconciled_at IS NOT NULL;
END;

CREATE TRIGGER trg_payroll_reopen_release_reconciled_overtime
AFTER UPDATE OF status ON payroll_entries
WHEN
  OLD.status = 'approved' AND
  NEW.status IN ('draft', 'reviewed')
BEGIN
  UPDATE employee_overtime_records
     SET financial_status = 'ready_for_payroll',
         payroll_entry_id = NULL,
         updated_at = NEW.updated_at
   WHERE salon_id = NEW.salon_id
     AND payroll_entry_id = NEW.id
     AND compensation_mode = 'cash_overtime'
     AND financial_status = 'included';
END;
