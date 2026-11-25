-- Atomic attendance policy revision verification.
-- Historical approved and paid rows are not rewritten.
-- Every new financial locking transition requires current policy evidence.

CREATE TRIGGER trg_payroll_attendance_policy_insert_guard
BEFORE INSERT ON payroll_entries
WHEN NEW.status IN ('approved', 'paid')
BEGIN

  SELECT CASE
    WHEN json_valid(NEW.attendance_summary_json) IS NOT 1
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_snapshot_invalid'
    )
  END;

  SELECT CASE
    WHEN json_type(
      NEW.attendance_summary_json,
      '$.attendancePolicyRevision'
    ) IS NOT 'integer'
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_revision_required'
    )
  END;

  SELECT CASE
    WHEN json_type(
      NEW.attendance_summary_json,
      '$.attendancePolicySnapshot'
    ) IS NOT 'object'
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_snapshot_required'
    )
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM employee_employment e
      WHERE e.salon_id = NEW.salon_id
        AND e.employee_id = NEW.employee_id
        AND e.attendance_policy_revision = json_extract(
          NEW.attendance_summary_json,
          '$.attendancePolicyRevision'
        )
    )
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_revision_mismatch'
    )
  END;

END;


CREATE TRIGGER trg_payroll_attendance_policy_update_guard
BEFORE UPDATE OF status ON payroll_entries

WHEN NEW.status IN ('approved', 'paid')
AND OLD.status NOT IN ('approved', 'paid')

BEGIN

  SELECT CASE
    WHEN json_valid(NEW.attendance_summary_json) IS NOT 1
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_snapshot_invalid'
    )
  END;

  SELECT CASE
    WHEN json_type(
      NEW.attendance_summary_json,
      '$.attendancePolicyRevision'
    ) IS NOT 'integer'
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_revision_required'
    )
  END;

  SELECT CASE
    WHEN json_type(
      NEW.attendance_summary_json,
      '$.attendancePolicySnapshot'
    ) IS NOT 'object'
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_snapshot_required'
    )
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM employee_employment e
      WHERE e.salon_id = NEW.salon_id
        AND e.employee_id = NEW.employee_id
        AND e.attendance_policy_revision = json_extract(
          NEW.attendance_summary_json,
          '$.attendancePolicyRevision'
        )
    )
    THEN RAISE(
      ABORT,
      'payroll_attendance_policy_revision_mismatch'
    )
  END;

END;


-- A locked payroll must not silently replace its attendance evidence.
-- Explicit reopening is handled by the canonical payroll workflow.

CREATE TRIGGER trg_payroll_attendance_policy_locked_evidence_guard
BEFORE UPDATE OF attendance_summary_json ON payroll_entries

WHEN OLD.status IN ('approved', 'paid')
AND NEW.status IN ('approved', 'paid')
AND NEW.attendance_summary_json IS NOT OLD.attendance_summary_json

BEGIN

  SELECT RAISE(
    ABORT,
    'payroll_attendance_policy_locked_evidence'
  );

END;
