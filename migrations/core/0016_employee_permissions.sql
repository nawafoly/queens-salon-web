-- Employee permission requests on Core D1.
-- CORE D1 ONLY — Firebase remains authentication-only.

CREATE TABLE IF NOT EXISTS employee_permission_requests (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  employee_name TEXT,
  date_key TEXT NOT NULL,
  requested_exit_time TEXT NOT NULL,
  expected_return_time TEXT,
  actual_exit_time TEXT,
  actual_return_time TEXT,
  reason TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'employee_request'
    CHECK (source IN ('employee_request', 'admin_direct')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'out', 'returned', 'cancelled')),
  financial_effect TEXT NOT NULL DEFAULT 'none'
    CHECK (financial_effect IN ('none', 'paid', 'unpaid')),
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  unpaid_minutes INTEGER NOT NULL DEFAULT 0,
  created_by_uid TEXT,
  created_by_name TEXT,
  reviewer_uid TEXT,
  reviewer_name TEXT,
  returned_by_uid TEXT,
  returned_by_name TEXT,
  reviewed_at TEXT,
  exited_at TEXT,
  returned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_permissions_employee_date
  ON employee_permission_requests(salon_id, employee_id, date_key, created_at);
CREATE INDEX IF NOT EXISTS idx_employee_permissions_uid
  ON employee_permission_requests(salon_id, employee_uid, date_key, created_at);
CREATE INDEX IF NOT EXISTS idx_employee_permissions_status
  ON employee_permission_requests(salon_id, status, date_key, created_at);

CREATE TABLE IF NOT EXISTS employee_permission_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_uid TEXT,
  actor_name TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_permission_events_request
  ON employee_permission_events(salon_id, permission_id, created_at);

ALTER TABLE payroll_entries
  ADD COLUMN permission_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_entries
  ADD COLUMN unpaid_permission_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_entries
  ADD COLUMN permission_deduction_halalas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_entries
  ADD COLUMN permission_entries_json TEXT NOT NULL DEFAULT '[]';

-- New payroll entries automatically inherit all returned permissions in their period.
-- No salary deduction is applied automatically; the financial deduction remains an
-- explicit payroll decision through permission_deduction_halalas.
CREATE TRIGGER IF NOT EXISTS trg_payroll_permission_summary_after_insert
AFTER INSERT ON payroll_entries
BEGIN
  UPDATE payroll_entries
     SET permission_minutes = COALESCE((
           SELECT SUM(COALESCE(pr.duration_minutes, 0))
             FROM employee_permission_requests pr
            WHERE pr.salon_id = NEW.salon_id
              AND pr.employee_id = NEW.employee_id
              AND pr.status = 'returned'
              AND pr.date_key BETWEEN
                COALESCE((
                  SELECT pp.month_start
                    FROM payroll_periods pp
                   WHERE pp.salon_id = NEW.salon_id
                     AND (pp.id = NEW.period_id OR pp.payroll_month = NEW.payroll_month)
                   ORDER BY CASE WHEN pp.id = NEW.period_id THEN 0 ELSE 1 END
                   LIMIT 1
                ), NEW.payroll_month || '-01')
                AND
                COALESCE((
                  SELECT pp.month_end
                    FROM payroll_periods pp
                   WHERE pp.salon_id = NEW.salon_id
                     AND (pp.id = NEW.period_id OR pp.payroll_month = NEW.payroll_month)
                   ORDER BY CASE WHEN pp.id = NEW.period_id THEN 0 ELSE 1 END
                   LIMIT 1
                ), date(NEW.payroll_month || '-01', '+1 month', '-1 day'))
         ), 0),
         unpaid_permission_minutes = COALESCE((
           SELECT SUM(COALESCE(pr.unpaid_minutes, 0))
             FROM employee_permission_requests pr
            WHERE pr.salon_id = NEW.salon_id
              AND pr.employee_id = NEW.employee_id
              AND pr.status = 'returned'
              AND pr.date_key BETWEEN
                COALESCE((
                  SELECT pp.month_start
                    FROM payroll_periods pp
                   WHERE pp.salon_id = NEW.salon_id
                     AND (pp.id = NEW.period_id OR pp.payroll_month = NEW.payroll_month)
                   ORDER BY CASE WHEN pp.id = NEW.period_id THEN 0 ELSE 1 END
                   LIMIT 1
                ), NEW.payroll_month || '-01')
                AND
                COALESCE((
                  SELECT pp.month_end
                    FROM payroll_periods pp
                   WHERE pp.salon_id = NEW.salon_id
                     AND (pp.id = NEW.period_id OR pp.payroll_month = NEW.payroll_month)
                   ORDER BY CASE WHEN pp.id = NEW.period_id THEN 0 ELSE 1 END
                   LIMIT 1
                ), date(NEW.payroll_month || '-01', '+1 month', '-1 day'))
         ), 0),
         permission_entries_json = COALESCE((
           SELECT json_group_array(json_object(
             'id', pr.id,
             'date', pr.date_key,
             'exitTime', COALESCE(pr.actual_exit_time, pr.requested_exit_time),
             'returnTime', pr.actual_return_time,
             'durationMinutes', pr.duration_minutes,
             'unpaidMinutes', pr.unpaid_minutes,
             'financialEffect', pr.financial_effect,
             'reason', pr.reason
           ))
             FROM employee_permission_requests pr
            WHERE pr.salon_id = NEW.salon_id
              AND pr.employee_id = NEW.employee_id
              AND pr.status = 'returned'
              AND pr.date_key BETWEEN
                COALESCE((
                  SELECT pp.month_start
                    FROM payroll_periods pp
                   WHERE pp.salon_id = NEW.salon_id
                     AND (pp.id = NEW.period_id OR pp.payroll_month = NEW.payroll_month)
                   ORDER BY CASE WHEN pp.id = NEW.period_id THEN 0 ELSE 1 END
                   LIMIT 1
                ), NEW.payroll_month || '-01')
                AND
                COALESCE((
                  SELECT pp.month_end
                    FROM payroll_periods pp
                   WHERE pp.salon_id = NEW.salon_id
                     AND (pp.id = NEW.period_id OR pp.payroll_month = NEW.payroll_month)
                   ORDER BY CASE WHEN pp.id = NEW.period_id THEN 0 ELSE 1 END
                   LIMIT 1
                ), date(NEW.payroll_month || '-01', '+1 month', '-1 day'))
         ), '[]')
   WHERE id = NEW.id;
END;
