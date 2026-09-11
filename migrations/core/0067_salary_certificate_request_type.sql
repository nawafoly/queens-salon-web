-- Add salary certificate as a canonical employee request type.
-- SQLite cannot alter a CHECK constraint in place, so rebuild the table while
-- preserving all request data and the existing request indexes.

CREATE TABLE employee_requests_v3 (
  id TEXT PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  employee_name_snapshot TEXT,
  request_type TEXT NOT NULL CHECK (request_type IN (
    'attendance_correction', 'permission', 'overtime', 'salary_advance',
    'exceptional_financial_payment', 'salary_certificate', 'leave', 'exit_return', 'resignation'
  )),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'received', 'under_review', 'needs_info', 'approved',
    'rejected', 'executing', 'completed', 'cancelled'
  )),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  decision_note TEXT,
  rejection_reason TEXT,
  assigned_to_uid TEXT,
  assigned_to_name TEXT,
  source_reference_type TEXT,
  source_reference_id TEXT,
  execution_status TEXT NOT NULL DEFAULT 'not_started' CHECK (execution_status IN (
    'not_started', 'pending', 'running', 'completed', 'failed', 'cancelled'
  )),
  execution_attempts INTEGER NOT NULL DEFAULT 0,
  execution_started_at TEXT,
  execution_completed_at TEXT,
  execution_error TEXT,
  external_reference TEXT,
  idempotency_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT NOT NULL,
  received_at TEXT,
  reviewed_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  executing_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_uid TEXT,
  updated_by_uid TEXT,
  received_by_uid TEXT,
  reviewed_by_uid TEXT,
  decided_by_uid TEXT,
  cancelled_by_uid TEXT,
  actual_exit_at TEXT,
  actual_return_at TEXT,
  expected_return_at TEXT,
  final_working_day TEXT,
  UNIQUE (salon_id, idempotency_key)
);

INSERT INTO employee_requests_v3 (
  id, request_number, salon_id, employee_id, employee_uid, employee_name_snapshot,
  request_type, status, priority, title, payload_json, decision_note, rejection_reason,
  assigned_to_uid, assigned_to_name, source_reference_type, source_reference_id,
  execution_status, execution_attempts, execution_started_at, execution_completed_at,
  execution_error, external_reference, idempotency_key, version, submitted_at,
  received_at, reviewed_at, approved_at, rejected_at, executing_at, completed_at,
  cancelled_at, created_at, updated_at, created_by_uid, updated_by_uid, received_by_uid,
  reviewed_by_uid, decided_by_uid, cancelled_by_uid, actual_exit_at, actual_return_at,
  expected_return_at, final_working_day
)
SELECT
  id, request_number, salon_id, employee_id, employee_uid, employee_name_snapshot,
  request_type, status, priority, title, payload_json, decision_note, rejection_reason,
  assigned_to_uid, assigned_to_name, source_reference_type, source_reference_id,
  execution_status, execution_attempts, execution_started_at, execution_completed_at,
  execution_error, external_reference, idempotency_key, version, submitted_at,
  received_at, reviewed_at, approved_at, rejected_at, executing_at, completed_at,
  cancelled_at, created_at, updated_at, created_by_uid, updated_by_uid, received_by_uid,
  reviewed_by_uid, decided_by_uid, cancelled_by_uid, actual_exit_at, actual_return_at,
  expected_return_at, final_working_day
FROM employee_requests;

DROP TABLE employee_requests;
ALTER TABLE employee_requests_v3 RENAME TO employee_requests;

CREATE INDEX IF NOT EXISTS idx_employee_requests_employee ON employee_requests(salon_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_uid ON employee_requests(salon_id, employee_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_type ON employee_requests(salon_id, request_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_status ON employee_requests(salon_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_assignee ON employee_requests(salon_id, assigned_to_uid, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_number ON employee_requests(salon_id, request_number);
