ALTER TABLE employee_weekly_rest_work_assignments
ADD COLUMN correction_pending INTEGER NOT NULL DEFAULT 0
CHECK (correction_pending IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_weekly_rest_pending_correction
ON employee_weekly_rest_work_assignments (
  salon_id, rest_date, employee_id
)
WHERE status = 'completed' AND correction_pending = 1;
