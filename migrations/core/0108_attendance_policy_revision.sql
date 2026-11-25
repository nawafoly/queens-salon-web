-- Monotonic attendance policy revision for payroll concurrency guards.
-- Core D1 only. Existing policy modes and payroll rows remain unchanged.

ALTER TABLE employee_employment
ADD COLUMN attendance_policy_revision INTEGER NOT NULL
DEFAULT 0
CHECK (
  typeof(attendance_policy_revision) = 'integer'
  AND attendance_policy_revision >= 0
  AND attendance_policy_revision <= 9007199254740991
);


-- A revision may never decrease or skip values.

CREATE TRIGGER trg_attendance_policy_revision_monotonic
BEFORE UPDATE OF attendance_policy_revision
ON employee_employment
WHEN NEW.attendance_policy_revision IS NOT OLD.attendance_policy_revision
AND NEW.attendance_policy_revision <> OLD.attendance_policy_revision + 1
BEGIN
  SELECT RAISE(
    ABORT,
    'attendance_policy_revision_invalid'
  );
END;


-- Creating a policy revision and recording its audit must succeed together.

CREATE TRIGGER trg_attendance_policy_revision_after_insert
AFTER INSERT ON employee_attendance_policy_periods
BEGIN
  UPDATE employee_employment
  SET attendance_policy_revision = attendance_policy_revision + 1
  WHERE salon_id = NEW.salon_id
    AND employee_id = NEW.employee_id;
END;


-- Updates and cancellations invalidate previous payroll policy evidence.

CREATE TRIGGER trg_attendance_policy_revision_after_update
AFTER UPDATE ON employee_attendance_policy_periods
BEGIN
  UPDATE employee_employment
  SET attendance_policy_revision = attendance_policy_revision + 1
  WHERE salon_id = NEW.salon_id
    AND employee_id = NEW.employee_id;
END;


-- Employees who remain under the legacy policy still participate
-- in the same revision contract.

CREATE TRIGGER trg_attendance_policy_revision_legacy_update
AFTER UPDATE OF
  attendance_payroll_mode,
  attendance_payroll_exemption_reason
ON employee_employment
WHEN OLD.attendance_policy_authority = 'legacy'
AND (
  NEW.attendance_payroll_mode IS NOT OLD.attendance_payroll_mode
  OR NEW.attendance_payroll_exemption_reason
     IS NOT OLD.attendance_payroll_exemption_reason
)
BEGIN
  UPDATE employee_employment
  SET attendance_policy_revision = attendance_policy_revision + 1
  WHERE salon_id = NEW.salon_id
    AND employee_id = NEW.employee_id;
END;


-- Ownership changes must also invalidate previous evidence.
-- The first dated policy can increment the revision twice:
-- once for adoption and once for creation.
-- Revisions are opaque concurrency tokens, not event counts.

CREATE TRIGGER trg_attendance_policy_revision_authority_update
AFTER UPDATE OF attendance_policy_authority
ON employee_employment
WHEN NEW.attendance_policy_authority IS NOT OLD.attendance_policy_authority
BEGIN
  UPDATE employee_employment
  SET attendance_policy_revision = attendance_policy_revision + 1
  WHERE salon_id = NEW.salon_id
    AND employee_id = NEW.employee_id;
END;
