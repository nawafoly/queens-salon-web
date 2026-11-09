-- An administrative punch mutation and its recovery record commit together.
-- Core remains the sole authority for financial amounts and carryovers.
CREATE TABLE attendance_operations (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL DEFAULT 'admin',
  salon_id TEXT NOT NULL,
  employee_uid TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  required_permissions TEXT NOT NULL,
  reason TEXT,
  before_records TEXT NOT NULL,
  after_records TEXT,
  response_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','needs_attention')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT,
  reconciliation_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  snapshot_matches INTEGER NOT NULL CHECK(snapshot_matches = 1)
);
CREATE UNIQUE INDEX attendance_operations_employee_pending
  ON attendance_operations(employee_uid) WHERE status <> 'completed' AND origin = 'admin';
CREATE INDEX attendance_operations_retry ON attendance_operations(status, next_attempt_at);

CREATE TABLE attendance_operation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL REFERENCES attendance_operations(id),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  error TEXT,
  reconciliation_json TEXT,
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER attendance_operation_created AFTER INSERT ON attendance_operations
BEGIN
  INSERT INTO attendance_operation_events(operation_id,status,attempts,recorded_at)
  VALUES(NEW.id,NEW.status,NEW.attempts,NEW.created_at);
END;
CREATE TRIGGER attendance_operation_progress AFTER UPDATE OF status,attempts,last_error ON attendance_operations
BEGIN
  INSERT INTO attendance_operation_events(operation_id,status,attempts,error,reconciliation_json,recorded_at)
  VALUES(NEW.id,NEW.status,NEW.attempts,NEW.last_error,NEW.reconciliation_json,NEW.updated_at);
END;
CREATE TRIGGER attendance_operation_identity_immutable BEFORE UPDATE ON attendance_operations
WHEN NEW.id IS NOT OLD.id OR NEW.actor_json IS NOT OLD.actor_json OR NEW.origin IS NOT OLD.origin
  OR NEW.employee_uid IS NOT OLD.employee_uid OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.salon_id IS NOT OLD.salon_id OR NEW.work_date IS NOT OLD.work_date
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.before_records IS NOT OLD.before_records
  OR NEW.required_permissions IS NOT OLD.required_permissions OR NEW.reason IS NOT OLD.reason
  OR NEW.response_json IS NOT OLD.response_json OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.after_records IS NOT NULL AND NEW.after_records IS NOT OLD.after_records)
BEGIN
  SELECT RAISE(ABORT, 'attendance_operation_audit_immutable');
END;
CREATE TRIGGER attendance_operation_no_delete BEFORE DELETE ON attendance_operations
BEGIN
  SELECT RAISE(ABORT, 'attendance_operation_audit_immutable');
END;
CREATE TRIGGER attendance_operation_event_no_update BEFORE UPDATE ON attendance_operation_events
BEGIN
  SELECT RAISE(ABORT, 'attendance_operation_audit_immutable');
END;
CREATE TRIGGER attendance_operation_event_no_delete BEFORE DELETE ON attendance_operation_events
BEGIN
  SELECT RAISE(ABORT, 'attendance_operation_audit_immutable');
END;
