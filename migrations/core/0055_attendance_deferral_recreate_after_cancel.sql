-- Allow a cancelled canonical attendance deferral to be recreated after recalculation.
-- Historical cancelled obligations remain immutable and auditable, while at most one
-- non-cancelled canonical attendance obligation may exist for the same source.

DROP INDEX IF EXISTS idx_payroll_obligation_attendance_source_unique;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_payroll_obligation_attendance_source_unique
ON employee_payroll_obligations(
  salon_id,
  employee_id,
  source_type,
  source_ref
)
WHERE source_type = 'attendance'
  AND source_ref IS NOT NULL
  AND status <> 'cancelled';
