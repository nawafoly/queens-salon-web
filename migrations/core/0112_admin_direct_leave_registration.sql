-- HR06: distinguish administrative leave registration
-- from employee requests and historical operational leaves.
-- Do not infer historical sources.

ALTER TABLE employee_leaves
ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'legacy'
CHECK (
  registration_source IN (
    'legacy',
    'employee_request',
    'admin_direct'
  )
);

ALTER TABLE employee_leaves
ADD COLUMN registered_by_uid TEXT;

ALTER TABLE employee_leaves
ADD COLUMN registration_operation_id TEXT;

CREATE UNIQUE INDEX idx_employee_leaves_registration_operation
ON employee_leaves (
  salon_id,
  registration_operation_id
)
WHERE registration_operation_id IS NOT NULL;

CREATE INDEX idx_employee_leaves_registration_source
ON employee_leaves (
  salon_id,
  employee_id,
  registration_source,
  start_date
);

CREATE TRIGGER trg_admin_direct_leave_registration_insert
BEFORE INSERT ON employee_leaves
WHEN NEW.registration_source = 'admin_direct'
AND (
  NEW.registered_by_uid IS NULL
  OR length(trim(NEW.registered_by_uid)) = 0
  OR NEW.registration_operation_id IS NULL
  OR length(trim(NEW.registration_operation_id)) = 0
  OR NEW.request_id IS NOT NULL
  OR NEW.status <> 'pending'
  OR NEW.duration_kind <> 'full_day'
)
BEGIN
  SELECT RAISE(
    ABORT,
    'admin_direct_leave_invalid_registration'
  );
END;

CREATE TRIGGER trg_leave_registration_identity_immutable
BEFORE UPDATE ON employee_leaves
WHEN NEW.registration_source IS NOT OLD.registration_source
  OR NEW.registered_by_uid IS NOT OLD.registered_by_uid
  OR NEW.registration_operation_id
     IS NOT OLD.registration_operation_id
  OR (
    OLD.registration_source = 'admin_direct'
    AND (
      NEW.employee_id IS NOT OLD.employee_id
      OR NEW.salon_id IS NOT OLD.salon_id
      OR NEW.id IS NOT OLD.id
      OR NEW.request_id IS NOT OLD.request_id
    )
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'leave_registration_identity_immutable'
  );
END;

CREATE TRIGGER trg_admin_direct_leave_no_delete
BEFORE DELETE ON employee_leaves
WHEN OLD.registration_source = 'admin_direct'
BEGIN
  SELECT RAISE(
    ABORT,
    'admin_direct_leave_delete_forbidden'
  );
END;

-- Protect direct registration against concurrent overlapping inserts.
-- Historical overlapping rows remain untouched.

CREATE TRIGGER trg_admin_direct_leave_overlap_insert
BEFORE INSERT ON employee_leaves
WHEN NEW.status IN ('pending', 'approved')
AND EXISTS (
  SELECT 1
  FROM employee_leaves existing
  WHERE existing.salon_id = NEW.salon_id
    AND existing.employee_id = NEW.employee_id
    AND existing.status IN ('pending', 'approved')
    AND (
      NEW.registration_source = 'admin_direct'
      OR existing.registration_source = 'admin_direct'
    )
    AND existing.start_date <= NEW.end_date
    AND existing.end_date >= NEW.start_date
)
BEGIN
  SELECT RAISE(
    ABORT,
    'admin_direct_leave_overlap'
  );
END;

CREATE TRIGGER trg_admin_direct_leave_overlap_update
BEFORE UPDATE OF
  status, start_date, end_date, employee_id, salon_id
ON employee_leaves
WHEN NEW.status IN ('pending', 'approved')
AND (
  OLD.status NOT IN ('pending', 'approved')
  OR NEW.start_date IS NOT OLD.start_date
  OR NEW.end_date IS NOT OLD.end_date
  OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.salon_id IS NOT OLD.salon_id
)
AND EXISTS (
  SELECT 1
  FROM employee_leaves existing
  WHERE existing.id <> OLD.id
    AND existing.salon_id = NEW.salon_id
    AND existing.employee_id = NEW.employee_id
    AND existing.status IN ('pending', 'approved')
    AND (
      NEW.registration_source = 'admin_direct'
      OR existing.registration_source = 'admin_direct'
    )
    AND existing.start_date <= NEW.end_date
    AND existing.end_date >= NEW.start_date
)
BEGIN
  SELECT RAISE(
    ABORT,
    'admin_direct_leave_overlap'
  );
END;

-- HR06N: append-only administrative leave lifecycle evidence.

CREATE TABLE employee_admin_leave_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'registered',
      'approved',
      'rejected',
      'status_changed'
    )
  ),
  actor_uid TEXT NOT NULL,
  previous_status TEXT,
  resulting_status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json)
  ),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_leave_events_history
ON employee_admin_leave_events (
  salon_id,
  leave_id,
  id
);

CREATE UNIQUE INDEX idx_admin_leave_events_registration
ON employee_admin_leave_events (
  salon_id,
  leave_id
)
WHERE event_type = 'registered';

CREATE TRIGGER trg_admin_leave_event_registered
AFTER INSERT ON employee_leaves
WHEN NEW.registration_source = 'admin_direct'
BEGIN
  INSERT INTO employee_admin_leave_events (
    salon_id,
    employee_id,
    leave_id,
    operation_id,
    event_type,
    actor_uid,
    previous_status,
    resulting_status,
    snapshot_json,
    created_at
  )
  VALUES (
    NEW.salon_id,
    NEW.employee_id,
    NEW.id,
    NEW.registration_operation_id,
    'registered',
    NEW.registered_by_uid,
    NULL,
    NEW.status,
    json_object(
      'leaveType', NEW.leave_type,
      'startDate', NEW.start_date,
      'endDate', NEW.end_date,
      'daysCount', NEW.days_count,
      'reason', NEW.employee_note,
      'deductFromBalance', NEW.deduct_from_balance,
      'affectsPayroll', NEW.affects_payroll,
      'policyVersion', NEW.policy_version,
      'legalBasis', NEW.legal_basis
    ),
    NEW.created_at
  );
END;

CREATE TRIGGER trg_admin_leave_event_decision
AFTER UPDATE OF status ON employee_leaves
WHEN OLD.registration_source = 'admin_direct'
AND NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO employee_admin_leave_events (
    salon_id,
    employee_id,
    leave_id,
    operation_id,
    event_type,
    actor_uid,
    previous_status,
    resulting_status,
    snapshot_json,
    created_at
  )
  VALUES (
    NEW.salon_id,
    NEW.employee_id,
    NEW.id,
    NEW.registration_operation_id,
    CASE
      WHEN NEW.status = 'approved' THEN 'approved'
      WHEN NEW.status = 'rejected' THEN 'rejected'
      ELSE 'status_changed'
    END,
    NEW.decided_by_uid,
    OLD.status,
    NEW.status,
    json_object(
      'hrNote', NEW.hr_note,
      'balanceAdjustmentId', NEW.balance_adjustment_id,
      'deductFromBalance', NEW.deduct_from_balance,
      'affectsPayroll', NEW.affects_payroll,
      'decidedByName', NEW.decided_by_name
    ),
    NEW.updated_at
  );
END;

CREATE TRIGGER trg_admin_leave_events_no_update
BEFORE UPDATE ON employee_admin_leave_events
BEGIN
  SELECT RAISE(
    ABORT,
    'admin_leave_event_immutable'
  );
END;

CREATE TRIGGER trg_admin_leave_events_no_delete
BEFORE DELETE ON employee_admin_leave_events
BEGIN
  SELECT RAISE(
    ABORT,
    'admin_leave_event_immutable'
  );
END;
