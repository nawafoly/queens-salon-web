ALTER TABLE employee_weekly_rest_work_assignments
ADD COLUMN correction_revision INTEGER NOT NULL DEFAULT 0
CHECK (correction_revision >= 0);
