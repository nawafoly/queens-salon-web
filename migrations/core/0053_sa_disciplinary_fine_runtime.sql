-- Saudi Labor Law disciplinary fine runtime (Articles 67-72).
-- A fine is never a free-form payroll deduction: it must trace to one violation,
-- investigation/defense minutes, a written decision and employee notification.

CREATE TABLE employee_disciplinary_cases (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  violation_reference TEXT NOT NULL,
  violation_code TEXT,
  incident_date TEXT,
  discovered_date TEXT NOT NULL,
  allegation_notified_at TEXT NOT NULL,
  investigation_completed_at TEXT NOT NULL,
  defense_minutes_reference TEXT NOT NULL,
  decision_at TEXT NOT NULL,
  employee_notification_reference TEXT NOT NULL,
  penalty_type TEXT NOT NULL CHECK(penalty_type IN ('warning','fine')),
  fine_halalas INTEGER NOT NULL DEFAULT 0 CHECK(fine_halalas >= 0),
  daily_wage_snapshot_halalas INTEGER NOT NULL CHECK(daily_wage_snapshot_halalas > 0),
  target_payroll_month TEXT,
  payroll_obligation_id TEXT,
  status TEXT NOT NULL DEFAULT 'decided' CHECK(status IN ('decided','cancelled')),
  decision_reason TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  cancelled_by_uid TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  UNIQUE(salon_id, employee_id, violation_reference)
);

CREATE INDEX idx_disciplinary_case_employee_month
  ON employee_disciplinary_cases(
    salon_id, employee_id, target_payroll_month, status
  );

CREATE TRIGGER trg_disciplinary_case_timeline_guard_insert
BEFORE INSERT ON employee_disciplinary_cases
WHEN
  julianday(substr(NEW.allegation_notified_at,1,10)) - julianday(NEW.discovered_date) > 30 OR
  julianday(substr(NEW.decision_at,1,10)) - julianday(substr(NEW.investigation_completed_at,1,10)) > 30 OR
  julianday(substr(NEW.allegation_notified_at,1,10)) < julianday(NEW.discovered_date) OR
  julianday(substr(NEW.decision_at,1,10)) < julianday(substr(NEW.investigation_completed_at,1,10))
BEGIN
  SELECT RAISE(ABORT, 'disciplinary_case_statutory_timeline_invalid');
END;

CREATE TRIGGER trg_disciplinary_case_fine_limit_insert
BEFORE INSERT ON employee_disciplinary_cases
WHEN
  NEW.penalty_type = 'fine' AND
  NEW.fine_halalas > NEW.daily_wage_snapshot_halalas * 5
BEGIN
  SELECT RAISE(ABORT, 'disciplinary_fine_single_violation_limit_exceeded');
END;

CREATE TRIGGER trg_disciplinary_case_warning_has_no_fine_insert
BEFORE INSERT ON employee_disciplinary_cases
WHEN NEW.penalty_type = 'warning' AND NEW.fine_halalas <> 0
BEGIN
  SELECT RAISE(ABORT, 'disciplinary_warning_cannot_have_fine');
END;

CREATE TRIGGER trg_disciplinary_case_fine_requires_payroll_month_insert
BEFORE INSERT ON employee_disciplinary_cases
WHEN NEW.penalty_type = 'fine' AND TRIM(COALESCE(NEW.target_payroll_month,'')) = ''
BEGIN
  SELECT RAISE(ABORT, 'disciplinary_fine_payroll_month_required');
END;

CREATE TRIGGER trg_disciplinary_monthly_fine_limit_insert
BEFORE INSERT ON employee_disciplinary_cases
WHEN
  NEW.penalty_type = 'fine' AND
  NEW.status = 'decided' AND
  NEW.fine_halalas + COALESCE((
    SELECT SUM(existing.fine_halalas)
      FROM employee_disciplinary_cases existing
     WHERE existing.salon_id = NEW.salon_id
       AND existing.employee_id = NEW.employee_id
       AND existing.target_payroll_month = NEW.target_payroll_month
       AND existing.penalty_type = 'fine'
       AND existing.status = 'decided'
  ),0) > NEW.daily_wage_snapshot_halalas * 5
BEGIN
  SELECT RAISE(ABORT, 'disciplinary_fine_monthly_limit_exceeded');
END;
