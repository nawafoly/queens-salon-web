-- STAGE 11 REMEDIATION
-- Canonical attendance-derived payroll deduction deferral integrity.

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_payroll_obligation_attendance_source_unique
ON employee_payroll_obligations(
  salon_id,
  employee_id,
  source_type,
  source_ref
)
WHERE source_type = 'attendance'
  AND source_ref IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS
  trg_payroll_obligation_attendance_validate_insert
BEFORE INSERT ON employee_payroll_obligations
WHEN NEW.source_type = 'attendance'
 AND (
   NEW.obligation_kind <> 'attendance_missing_hours'
   OR NEW.source_ref IS NULL
   OR LENGTH(TRIM(NEW.source_ref)) = 0
   OR NEW.source_ref <>
      'attendance_missing_hours:' ||
      NEW.employee_id ||
      ':' ||
      NEW.original_payroll_month
   OR NEW.original_amount_halalas <= 0
 )
BEGIN
  SELECT RAISE(
    ABORT,
    'attendance_payroll_obligation_invalid'
  );
END;

CREATE TRIGGER IF NOT EXISTS
  trg_payroll_obligation_attendance_identity_immutable
BEFORE UPDATE OF
  employee_id,
  obligation_kind,
  source_type,
  source_ref,
  original_payroll_month,
  original_amount_halalas
ON employee_payroll_obligations
WHEN OLD.source_type = 'attendance'
BEGIN
  SELECT RAISE(
    ABORT,
    'attendance_payroll_obligation_identity_immutable'
  );
END;

CREATE TRIGGER IF NOT EXISTS
  trg_payroll_obligation_attendance_installment_validate
BEFORE INSERT ON employee_payroll_obligation_installments
WHEN EXISTS (
  SELECT 1
    FROM employee_payroll_obligations o
   WHERE o.salon_id = NEW.salon_id
     AND o.id = NEW.obligation_id
     AND o.source_type = 'attendance'
     AND (
       NEW.target_payroll_month <= o.original_payroll_month
       OR NEW.amount_halalas <> o.original_amount_halalas
     )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'attendance_payroll_obligation_installment_invalid'
  );
END;
