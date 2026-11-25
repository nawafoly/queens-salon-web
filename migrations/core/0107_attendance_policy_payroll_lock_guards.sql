-- Attendance policy mutations must not change locked payroll dates.
-- CORE D1 only.
-- No existing employee or payroll rows are rewritten.

CREATE VIEW IF NOT EXISTS employee_attendance_policy_locked_ranges AS
SELECT
  salon_id,
  employee_id,
  payroll_month || '-01' AS date_from,
  date(payroll_month || '-01', '+1 month', '-1 day') AS date_to,
  'payroll_entry' AS lock_source
FROM payroll_entries
WHERE status IN ('approved', 'paid')

UNION ALL

SELECT
  salon_id,
  NULL AS employee_id,
  period_start AS date_from,
  period_end AS date_to,
  'attendance_period' AS lock_source
FROM hr_payroll_period_locks
WHERE status = 'locked';


-- Creation may not introduce policy coverage into a locked range.

CREATE TRIGGER trg_attendance_policy_locked_insert
BEFORE INSERT ON employee_attendance_policy_periods
WHEN NEW.status = 'active'
AND EXISTS (
  SELECT 1
  FROM employee_attendance_policy_locked_ranges l
  WHERE l.salon_id = NEW.salon_id
    AND (
      l.employee_id IS NULL
      OR l.employee_id = NEW.employee_id
    )
    AND l.date_from <= COALESCE(NEW.effective_to, '9999-12-31')
    AND l.date_to >= NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_payroll_period_locked');
END;


-- Compare the intersection of both policy revisions with every lock.
-- Future-only extensions and endings may remain permissible.
-- Changes to mode or reason within a lock are prohibited.

CREATE TRIGGER trg_attendance_policy_locked_update
BEFORE UPDATE ON employee_attendance_policy_periods
WHEN EXISTS (
  SELECT 1
  FROM employee_attendance_policy_locked_ranges l
  WHERE l.salon_id = OLD.salon_id
    AND (
      l.employee_id IS NULL
      OR l.employee_id = OLD.employee_id
    )
    AND (
      (
        OLD.status = 'active'
        AND l.date_from <= COALESCE(OLD.effective_to, '9999-12-31')
        AND l.date_to >= OLD.effective_from
      )
      OR
      (
        NEW.status = 'active'
        AND l.date_from <= COALESCE(NEW.effective_to, '9999-12-31')
        AND l.date_to >= NEW.effective_from
      )
    )
    AND (
      OLD.status IS NOT NEW.status
      OR OLD.policy_mode IS NOT NEW.policy_mode
      OR OLD.reason IS NOT NEW.reason
      OR MAX(OLD.effective_from, l.date_from)
         IS NOT MAX(NEW.effective_from, l.date_from)
      OR MIN(COALESCE(OLD.effective_to, '9999-12-31'), l.date_to)
         IS NOT MIN(COALESCE(NEW.effective_to, '9999-12-31'), l.date_to)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_payroll_period_locked');
END;
