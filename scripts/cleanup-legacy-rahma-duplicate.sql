-- One-time/idempotent production cleanup for the legacy duplicate staff row "رحمه".
-- Canonical employee/staff row:
--   fdT1SCLaa6fGp76QWhyHQ3zLYnJ2
-- Legacy duplicate row:
--   رحمه
--
-- Safety goals:
-- 1) Preserve booking/history references where possible.
-- 2) Keep the canonical row's inactive/show_on_booking state untouched.
-- 3) Merge service assignments without re-enabling the canonical staff row.
-- 4) Delete legacy operational HR/schedule rows so they cannot surface again.

-- Merge service assignments into the canonical row, preserving any service that
-- existed only on the legacy duplicate.
INSERT INTO staff_services (salon_id, staff_id, service_id, active)
SELECT salon_id, 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2', service_id, active
FROM staff_services
WHERE salon_id = 'main' AND staff_id = 'رحمه'
ON CONFLICT (salon_id, staff_id, service_id) DO UPDATE SET
  active = MAX(staff_services.active, excluded.active);

DELETE FROM staff_services
WHERE salon_id = 'main' AND staff_id = 'رحمه';

-- Preserve booking history under the canonical identity.
UPDATE OR IGNORE bookings
SET staff_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND staff_id = 'رحمه';

UPDATE OR IGNORE booking_items
SET staff_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND staff_id = 'رحمه';

-- Remove only duplicate slot-lock keys that already exist for the canonical row,
-- then move the remaining locks.
DELETE FROM booking_slot_locks AS legacy
WHERE legacy.salon_id = 'main'
  AND legacy.staff_id = 'رحمه'
  AND EXISTS (
    SELECT 1
    FROM booking_slot_locks AS canonical
    WHERE canonical.salon_id = legacy.salon_id
      AND canonical.staff_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
      AND canonical.booking_date = legacy.booking_date
      AND canonical.slot_time = legacy.slot_time
  );

UPDATE OR IGNORE booking_slot_locks
SET staff_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND staff_id = 'رحمه';

UPDATE OR IGNORE expense_entries
SET staff_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND staff_id = 'رحمه';

-- Preserve historical HR references when no uniqueness collision exists.
UPDATE OR IGNORE attendance_records
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2',
    employee_uid = COALESCE(employee_uid, 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2')
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE employee_leaves
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2',
    employee_uid = COALESCE(employee_uid, 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2')
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE employee_absences
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2',
    employee_uid = COALESCE(employee_uid, 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2')
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE payroll_entries
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE file_metadata
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE admin_profiles
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE employee_target_assignments
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE employee_target_ledger
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND employee_id = 'رحمه';

UPDATE OR IGNORE employee_target_period_summaries
SET employee_id = 'fdT1SCLaa6fGp76QWhyHQ3zLYnJ2'
WHERE salon_id = 'main' AND employee_id = 'رحمه';

-- The canonical row already owns the correct current schedule/employment state.
-- Do not merge the legacy 10:00-22:00 schedule into it.
DELETE FROM staff_schedules
WHERE salon_id = 'main' AND staff_id = 'رحمه';

DELETE FROM hr_work_schedules
WHERE salon_id = 'main' AND employee_id = 'رحمه';

DELETE FROM hr_shift_assignments
WHERE salon_id = 'main' AND employee_id = 'رحمه';

DELETE FROM hr_schedule_exceptions
WHERE salon_id = 'main' AND employee_id = 'رحمه';

DELETE FROM attendance_state
WHERE salon_id = 'main' AND employee_id = 'رحمه';

DELETE FROM employee_employment
WHERE salon_id = 'main' AND employee_id = 'رحمه';

-- Finally remove the duplicate identity rows. Canonical UID row remains unchanged.
DELETE FROM employee_profiles
WHERE salon_id = 'main' AND id = 'رحمه';

DELETE FROM staff
WHERE salon_id = 'main' AND id = 'رحمه';
