-- Local Core transactional outbox for canonical HR changes. No client monetary amounts.
CREATE TABLE hr_payroll_operations (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL DEFAULT 'core',
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
CREATE INDEX hr_payroll_operations_retry ON hr_payroll_operations(status, next_attempt_at);

CREATE TABLE hr_payroll_operation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL REFERENCES hr_payroll_operations(id),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  error TEXT,
  reconciliation_json TEXT,
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER hr_payroll_operation_created AFTER INSERT ON hr_payroll_operations
BEGIN
  INSERT INTO hr_payroll_operation_events(operation_id,status,attempts,recorded_at)
  VALUES(NEW.id,NEW.status,NEW.attempts,NEW.created_at);
END;
CREATE TRIGGER hr_payroll_operation_progress AFTER UPDATE OF status,attempts,last_error ON hr_payroll_operations
BEGIN
  INSERT INTO hr_payroll_operation_events(operation_id,status,attempts,error,reconciliation_json,recorded_at)
  VALUES(NEW.id,NEW.status,NEW.attempts,NEW.last_error,NEW.reconciliation_json,NEW.updated_at);
END;
CREATE TRIGGER hr_payroll_operation_identity_immutable BEFORE UPDATE ON hr_payroll_operations
WHEN NEW.id IS NOT OLD.id OR NEW.actor_json IS NOT OLD.actor_json OR NEW.origin IS NOT OLD.origin
  OR NEW.employee_uid IS NOT OLD.employee_uid OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.salon_id IS NOT OLD.salon_id OR NEW.work_date IS NOT OLD.work_date
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.before_records IS NOT OLD.before_records
  OR NEW.required_permissions IS NOT OLD.required_permissions OR NEW.reason IS NOT OLD.reason
  OR NEW.response_json IS NOT OLD.response_json OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.after_records IS NOT NULL AND NEW.after_records IS NOT OLD.after_records)
BEGIN
  SELECT RAISE(ABORT, 'hr_payroll_operation_audit_immutable');
END;
CREATE TRIGGER hr_payroll_operation_no_delete BEFORE DELETE ON hr_payroll_operations
BEGIN
  SELECT RAISE(ABORT, 'hr_payroll_operation_audit_immutable');
END;
CREATE TRIGGER hr_payroll_operation_event_no_update BEFORE UPDATE ON hr_payroll_operation_events
BEGIN
  SELECT RAISE(ABORT, 'hr_payroll_operation_audit_immutable');
END;
CREATE TRIGGER hr_payroll_operation_event_no_delete BEFORE DELETE ON hr_payroll_operation_events
BEGIN
  SELECT RAISE(ABORT, 'hr_payroll_operation_audit_immutable');
END;

CREATE INDEX hr_payroll_operations_source ON hr_payroll_operations(salon_id,json_extract(response_json,'$.sourceType'),json_extract(response_json,'$.sourceId'),status);

CREATE TRIGGER hr_payroll_employee_leaves_insert AFTER INSERT ON employee_leaves
 WHEN NEW.status='approved'
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.start_date,NEW.id,json_object('uid',NEW.decided_by_uid),'[]',NEW.hr_note,
 'null',json_object('id',NEW.id,'employee_id',NEW.employee_id,'status',NEW.status,'leave_type',NEW.leave_type,'start_date',NEW.start_date,'end_date',NEW.end_date,'affects_payroll',NEW.affects_payroll,'pay_segments_json',NEW.pay_segments_json),json_object('sourceType','employee_leave','sourceId',NEW.id,'date',NEW.start_date,
 'endDate',NEW.end_date,'previousDate',NULL,'previousEndDate',NULL),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_employee_leaves_update AFTER UPDATE ON employee_leaves
 WHEN (NEW.status='approved' OR OLD.status='approved') AND (NEW.status IS NOT OLD.status OR NEW.leave_type IS NOT OLD.leave_type OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.affects_payroll IS NOT OLD.affects_payroll OR NEW.pay_segments_json IS NOT OLD.pay_segments_json)
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.start_date,NEW.id,json_object('uid',NEW.decided_by_uid),'[]',NEW.hr_note,
 json_object('id',OLD.id,'employee_id',OLD.employee_id,'status',OLD.status,'leave_type',OLD.leave_type,'start_date',OLD.start_date,'end_date',OLD.end_date,'affects_payroll',OLD.affects_payroll,'pay_segments_json',OLD.pay_segments_json),json_object('id',NEW.id,'employee_id',NEW.employee_id,'status',NEW.status,'leave_type',NEW.leave_type,'start_date',NEW.start_date,'end_date',NEW.end_date,'affects_payroll',NEW.affects_payroll,'pay_segments_json',NEW.pay_segments_json),json_object('sourceType','employee_leave','sourceId',NEW.id,'date',NEW.start_date,
 'endDate',NEW.end_date,'previousDate',OLD.start_date,'previousEndDate',OLD.end_date),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_employee_permission_requests_insert AFTER INSERT ON employee_permission_requests

 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.date_key,NEW.id,json_object('uid',NEW.reviewer_uid),'[]',NEW.reason,
 'null',json_object('id',NEW.id,'employee_id',NEW.employee_id,'status',NEW.status,'financial_effect',NEW.financial_effect,'date_key',NEW.date_key,'unpaid_minutes',NEW.unpaid_minutes,'requested_exit_time',NEW.requested_exit_time,'expected_return_time',NEW.expected_return_time,'actual_exit_time',NEW.actual_exit_time,'actual_return_time',NEW.actual_return_time),json_object('sourceType','permission','sourceId',NEW.id,'date',NEW.date_key,
 'endDate',NEW.date_key,'previousDate',NULL,'previousEndDate',NULL),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_employee_permission_requests_update AFTER UPDATE ON employee_permission_requests
 WHEN (NEW.status IS NOT OLD.status OR NEW.financial_effect IS NOT OLD.financial_effect OR NEW.unpaid_minutes IS NOT OLD.unpaid_minutes OR NEW.date_key IS NOT OLD.date_key)
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.date_key,NEW.id,json_object('uid',NEW.reviewer_uid),'[]',NEW.reason,
 json_object('id',OLD.id,'employee_id',OLD.employee_id,'status',OLD.status,'financial_effect',OLD.financial_effect,'date_key',OLD.date_key,'unpaid_minutes',OLD.unpaid_minutes,'requested_exit_time',OLD.requested_exit_time,'expected_return_time',OLD.expected_return_time,'actual_exit_time',OLD.actual_exit_time,'actual_return_time',OLD.actual_return_time),json_object('id',NEW.id,'employee_id',NEW.employee_id,'status',NEW.status,'financial_effect',NEW.financial_effect,'date_key',NEW.date_key,'unpaid_minutes',NEW.unpaid_minutes,'requested_exit_time',NEW.requested_exit_time,'expected_return_time',NEW.expected_return_time,'actual_exit_time',NEW.actual_exit_time,'actual_return_time',NEW.actual_return_time),json_object('sourceType','permission','sourceId',NEW.id,'date',NEW.date_key,
 'endDate',NEW.date_key,'previousDate',OLD.date_key,'previousEndDate',OLD.date_key),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_employee_absences_insert AFTER INSERT ON employee_absences

 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.date_key,NEW.id,json_object('uid',NEW.created_by_uid),'[]',NEW.note,
 'null',json_object('id',NEW.id,'employee_id',NEW.employee_id,'absence_type',NEW.absence_type,'date_key',NEW.date_key,'note',NEW.note),json_object('sourceType','absence','sourceId',NEW.id,'date',NEW.date_key,
 'endDate',NEW.date_key,'previousDate',NULL,'previousEndDate',NULL),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_employee_absences_update AFTER UPDATE ON employee_absences
 WHEN (NEW.absence_type IS NOT OLD.absence_type OR NEW.date_key IS NOT OLD.date_key)
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.date_key,NEW.id,json_object('uid',NEW.created_by_uid),'[]',NEW.note,
 json_object('id',OLD.id,'employee_id',OLD.employee_id,'absence_type',OLD.absence_type,'date_key',OLD.date_key,'note',OLD.note),json_object('id',NEW.id,'employee_id',NEW.employee_id,'absence_type',NEW.absence_type,'date_key',NEW.date_key,'note',NEW.note),json_object('sourceType','absence','sourceId',NEW.id,'date',NEW.date_key,
 'endDate',NEW.date_key,'previousDate',OLD.date_key,'previousEndDate',OLD.date_key),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_employee_absences_delete AFTER DELETE ON employee_absences

 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',OLD.salon_id,COALESCE(OLD.employee_uid,OLD.employee_id),OLD.employee_id,
 OLD.date_key,OLD.id,json_object('uid',OLD.created_by_uid),'[]',OLD.note,
 json_object('id',OLD.id,'employee_id',OLD.employee_id,'absence_type',OLD.absence_type,'date_key',OLD.date_key,'note',OLD.note),'null',json_object('sourceType','absence','sourceId',OLD.id,'date',OLD.date_key,
 'endDate',OLD.date_key,'previousDate',NULL,'previousEndDate',NULL),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_attendance_records_insert AFTER INSERT ON attendance_records
 WHEN NEW.record_type IN ('check_in','check_out')
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.date_key,NEW.id,json_object('uid','system'),'[]',NEW.note,
 'null',json_object('id',NEW.id,'employee_id',NEW.employee_id,'record_type',NEW.record_type,'date_key',NEW.date_key,'recorded_at',NEW.recorded_at),json_object('sourceType','core_attendance','sourceId',NEW.id,'date',NEW.date_key,
 'endDate',NEW.date_key,'previousDate',NULL,'previousEndDate',NULL),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_attendance_records_update AFTER UPDATE ON attendance_records
 WHEN NEW.record_type IN ('check_in','check_out') AND (NEW.record_type IS NOT OLD.record_type OR NEW.date_key IS NOT OLD.date_key OR NEW.recorded_at IS NOT OLD.recorded_at)
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',NEW.salon_id,COALESCE(NEW.employee_uid,NEW.employee_id),NEW.employee_id,
 NEW.date_key,NEW.id,json_object('uid','system'),'[]',NEW.note,
 json_object('id',OLD.id,'employee_id',OLD.employee_id,'record_type',OLD.record_type,'date_key',OLD.date_key,'recorded_at',OLD.recorded_at),json_object('id',NEW.id,'employee_id',NEW.employee_id,'record_type',NEW.record_type,'date_key',NEW.date_key,'recorded_at',NEW.recorded_at),json_object('sourceType','core_attendance','sourceId',NEW.id,'date',NEW.date_key,
 'endDate',NEW.date_key,'previousDate',OLD.date_key,'previousEndDate',OLD.date_key),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;

CREATE TRIGGER hr_payroll_attendance_records_delete AFTER DELETE ON attendance_records
 WHEN OLD.record_type IN ('check_in','check_out')
 BEGIN
 INSERT INTO hr_payroll_operations
 (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,required_permissions,reason,
  before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
 VALUES ('hr:'||lower(hex(randomblob(16))),'core',OLD.salon_id,COALESCE(OLD.employee_uid,OLD.employee_id),OLD.employee_id,
 OLD.date_key,OLD.id,json_object('uid','system'),'[]',OLD.note,
 json_object('id',OLD.id,'employee_id',OLD.employee_id,'record_type',OLD.record_type,'date_key',OLD.date_key,'recorded_at',OLD.recorded_at),'null',json_object('sourceType','core_attendance','sourceId',OLD.id,'date',OLD.date_key,
 'endDate',OLD.date_key,'previousDate',NULL,'previousEndDate',NULL),
 '1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
 END;
