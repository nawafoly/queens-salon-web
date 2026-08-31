-- Leave/rest operational workflow foundation.
-- Annual leave recall is an audited exception date; weekly-rest work authorization
-- preserves the original weekly-rest schedule so reconciliation can still prove it.

CREATE TABLE employee_leave_recalls (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  leave_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  recall_date TEXT NOT NULL,
  recalled_days REAL NOT NULL DEFAULT 1 CHECK (recalled_days = 1),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  balance_ledger_entry_id TEXT NOT NULL,
  reversal_ledger_entry_id TEXT,
  created_by_uid TEXT,
  created_by_email TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  cancelled_by_uid TEXT,
  cancelled_by_email TEXT,
  cancelled_by_name TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_employee_leave_recall_active_date
  ON employee_leave_recalls(salon_id, leave_id, recall_date)
  WHERE status = 'active';

CREATE INDEX idx_employee_leave_recall_employee_date
  ON employee_leave_recalls(salon_id, employee_id, recall_date, status);

CREATE TABLE employee_weekly_rest_work_assignments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  rest_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  attendance_lock_enabled INTEGER NOT NULL DEFAULT 0 CHECK (attendance_lock_enabled IN (0,1)),
  attendance_lock_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (attendance_lock_after_minutes >= 0),
  reason TEXT NOT NULL,
  schedule_source_type TEXT NOT NULL,
  schedule_source_id TEXT,
  schedule_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed','cancelled')),
  assigned_by_uid TEXT,
  assigned_by_email TEXT,
  assigned_by_name TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_by_uid TEXT,
  cancelled_by_email TEXT,
  cancelled_by_name TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_weekly_rest_work_assignment_active
  ON employee_weekly_rest_work_assignments(salon_id, employee_id, rest_date)
  WHERE status = 'assigned';

CREATE INDEX idx_weekly_rest_work_assignment_date
  ON employee_weekly_rest_work_assignments(salon_id, rest_date, status);
