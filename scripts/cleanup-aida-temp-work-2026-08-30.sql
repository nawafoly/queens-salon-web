-- Cancel the stale TEMP_WORK row that incorrectly keeps Aida bookable
-- on the date her base Sunday weekly off is supposed to return.
-- Safe/idempotent: only touches the exact approved TEMP_WEEKLY_OFF row for 2026-08-30.

UPDATE hr_schedule_exceptions
SET status = 'cancelled',
    enabled = 0,
    note = TRIM(COALESCE(note, '') || ' [CANCELLED_RETURN_DATE_BOUNDARY_FIX]'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE salon_id = 'main'
  AND employee_id = 'VjtXO2JSgza3mYUnhTJ5QNh3MBp1'
  AND exception_type = 'custom'
  AND date_from = '2026-08-30'
  AND date_to = '2026-08-30'
  AND status = 'approved'
  AND enabled = 1
  AND instr(COALESCE(note, ''), '[TEMP_WEEKLY_OFF:sun:none:2026-08-11:2026-08-30]') = 1
  AND instr(COALESCE(note, ''), 'TEMP_WORK') > 0;

SELECT id, employee_id, exception_type, date_from, date_to, enabled, status, note
FROM hr_schedule_exceptions
WHERE salon_id = 'main'
  AND employee_id = 'VjtXO2JSgza3mYUnhTJ5QNh3MBp1'
  AND date_from = '2026-08-30'
ORDER BY created_at DESC;
