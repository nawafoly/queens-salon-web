-- Merge duplicate Nawaf Core identity into the canonical Nawaf employee.
-- Canonical employee/account identity remains EkAxHGHMMBfD11OCDP1XavS9KA43.
-- Duplicate Firebase/Core account is soft-deleted; historical employee references are repointed.
-- Canonical employment + 15:00-23:00 schedule are preserved.

-- Historical HR records
UPDATE employee_leaves
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_name = 'نواف العليان',
    employee_email = 'nawafaaa6@gmail.com',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE employee_absences
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE attendance_records
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE payroll_entries
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE employee_permission_requests
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_name = 'نواف العليان',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE employee_requests
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_name_snapshot = 'نواف العليان',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE employee_overtime_records
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE salary_advances
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE employee_financial_payments
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE employee_leave_balance_ledger
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE file_metadata
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE employee_target_assignments
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE employee_target_ledger
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE employee_target_period_summaries
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

-- Booking/staff history, if any
INSERT INTO staff_services (salon_id, staff_id, service_id, active)
SELECT salon_id, 'EkAxHGHMMBfD11OCDP1XavS9KA43', service_id, active
FROM staff_services
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12'
ON CONFLICT (salon_id, staff_id, service_id) DO UPDATE SET
  active = MAX(staff_services.active, excluded.active);

DELETE FROM staff_services
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE bookings
SET staff_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE booking_items
SET staff_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM booking_slot_locks AS legacy
WHERE legacy.salon_id = 'main'
  AND legacy.staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12'
  AND EXISTS (
    SELECT 1
    FROM booking_slot_locks AS canonical
    WHERE canonical.salon_id = legacy.salon_id
      AND canonical.staff_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
      AND canonical.booking_date = legacy.booking_date
      AND canonical.slot_time = legacy.slot_time
  );

UPDATE OR IGNORE booking_slot_locks
SET staff_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE OR IGNORE expense_entries
SET staff_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

-- Old schedule/employment must NOT overwrite canonical Nawaf.
DELETE FROM staff_schedules
WHERE salon_id = 'main' AND staff_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM hr_work_schedules
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM hr_shift_assignments
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM hr_schedule_exceptions
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM attendance_state
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM employee_employment
WHERE salon_id = 'main' AND employee_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

-- Remove duplicate legacy operational identity rows.
DELETE FROM admin_profiles
WHERE salon_id = 'main' AND firebase_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM role_assignments
WHERE salon_id = 'main' AND firebase_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

UPDATE user_employee_links
SET employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    link_status = 'unlinked',
    unlinked_at = COALESCE(unlinked_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main'
  AND user_id = 'app_user_eb5edb5b820ee274ce';

UPDATE app_users
SET display_name = 'نواف - حساب مكرر مؤرشف',
    status = 'deleted',
    deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main'
  AND id = 'app_user_eb5edb5b820ee274ce'
  AND firebase_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM employee_profiles
WHERE salon_id = 'main' AND id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM staff
WHERE salon_id = 'main' AND id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

-- Move notifications from the duplicate login identity to canonical Nawaf.
UPDATE notification_records
SET target_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE salon_id = 'main' AND target_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

-- Verification
SELECT 'CANONICAL_EMPLOYEE' AS src, id, firebase_uid, name, email, status
FROM employee_profiles
WHERE salon_id = 'main' AND id = 'EkAxHGHMMBfD11OCDP1XavS9KA43';

SELECT 'DUPLICATE_EMPLOYEE_REMAINING' AS src, COUNT(*) AS count
FROM employee_profiles
WHERE salon_id = 'main' AND id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

SELECT 'CANONICAL_ACCOUNT' AS src, id, firebase_uid, display_name, email, status, primary_role
FROM app_users
WHERE salon_id = 'main' AND firebase_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43';

SELECT 'DUPLICATE_ACCOUNT' AS src, id, firebase_uid, display_name, email, status, primary_role
FROM app_users
WHERE salon_id = 'main' AND firebase_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

SELECT employee_id, weekday, start_time, end_time, active, effective_from, effective_to
FROM hr_work_schedules
WHERE salon_id = 'main' AND employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
ORDER BY weekday, effective_from;

SELECT id, employee_id, employee_uid, leave_type, start_date, end_date, days_count, status
FROM employee_leaves
WHERE salon_id = 'main' AND employee_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43'
ORDER BY start_date;
