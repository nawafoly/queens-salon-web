-- Shift attendance policy + weekly schedule source of truth.
-- Keeps legacy columns for compatibility, but early departure grace is disabled.

ALTER TABLE hr_shift_templates ADD COLUMN attendance_lock_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_shift_templates ADD COLUMN attendance_lock_after_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE hr_work_schedules ADD COLUMN shift_template_id TEXT;
ALTER TABLE hr_work_schedules ADD COLUMN schedule_source TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS idx_hr_work_schedules_template
  ON hr_work_schedules(salon_id, shift_template_id);
CREATE INDEX IF NOT EXISTS idx_hr_work_schedules_effective
  ON hr_work_schedules(salon_id, employee_id, weekday, effective_from, effective_to, active);

-- The new policy has no early-departure grace. Keep the old column only so
-- historical code and snapshots remain readable.
UPDATE hr_shift_templates
SET early_leave_grace_minutes = 0
WHERE early_leave_grace_minutes <> 0;

-- Best-effort migration for old weekly rows whose hours already match a shift.
UPDATE hr_work_schedules
SET shift_template_id = (
  SELECT t.id
  FROM hr_shift_templates t
  WHERE t.salon_id = hr_work_schedules.salon_id
    AND t.start_time = hr_work_schedules.start_time
    AND t.end_time = hr_work_schedules.end_time
  ORDER BY t.active DESC, t.updated_at DESC
  LIMIT 1
)
WHERE shift_template_id IS NULL
  AND start_time IS NOT NULL
  AND end_time IS NOT NULL;

UPDATE hr_work_schedules
SET schedule_source = CASE
  WHEN active = 0 THEN 'weekly_off'
  WHEN shift_template_id IS NOT NULL THEN 'shift_template'
  ELSE 'legacy'
END;
