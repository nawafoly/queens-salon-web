-- Preserve cancelled assignment history while preventing
-- multiple assigned or completed records for the same day.

CREATE UNIQUE INDEX idx_weekly_rest_assignment_non_cancelled
ON employee_weekly_rest_work_assignments (
    salon_id,
    employee_id,
    rest_date
)
WHERE status IN ('assigned', 'completed');
