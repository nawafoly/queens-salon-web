-- Preserve Core payroll recovery for voided attendance.

DROP TRIGGER hr_payroll_attendance_records_update;

CREATE TRIGGER hr_payroll_attendance_records_update AFTER UPDATE ON attendance_records
 WHEN (
   OLD.record_type IN ('check_in','check_out')
   OR NEW.record_type IN ('check_in','check_out')
 )
 AND (
   NEW.record_type IS NOT OLD.record_type
   OR NEW.date_key IS NOT OLD.date_key
   OR NEW.recorded_at IS NOT OLD.recorded_at
   OR NEW.employee_id IS NOT OLD.employee_id
   OR NEW.salon_id IS NOT OLD.salon_id
   OR NEW.employee_uid IS NOT OLD.employee_uid
 )
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

-- Core attendance mutations must invalidate older weekly-rest
-- correction snapshots in the same database transaction.

CREATE TRIGGER hr_weekly_rest_attendance_insert
AFTER INSERT ON attendance_records
WHEN NEW.record_type IN ('check_in', 'check_out')
BEGIN
    UPDATE employee_weekly_rest_work_assignments
       SET correction_pending = 1,
           correction_revision = correction_revision + 1
     WHERE salon_id = NEW.salon_id
       AND employee_id = NEW.employee_id
       AND rest_date = NEW.date_key
       AND rest_date >= '2026-08-31'
       AND status = 'completed';
END;

CREATE TRIGGER hr_weekly_rest_attendance_update
AFTER UPDATE ON attendance_records
WHEN (
    OLD.record_type IN ('check_in', 'check_out')
    OR NEW.record_type IN ('check_in', 'check_out')
)
AND (
    NEW.record_type IS NOT OLD.record_type
    OR NEW.recorded_at IS NOT OLD.recorded_at
    OR NEW.date_key IS NOT OLD.date_key
    OR NEW.employee_id IS NOT OLD.employee_id
    OR NEW.employee_uid IS NOT OLD.employee_uid
    OR NEW.salon_id IS NOT OLD.salon_id
)
BEGIN
    UPDATE employee_weekly_rest_work_assignments
       SET correction_pending = 1,
           correction_revision = correction_revision + 1
     WHERE status = 'completed'
       AND rest_date >= '2026-08-31'
       AND (
           (
               salon_id = OLD.salon_id
               AND employee_id = OLD.employee_id
               AND rest_date = OLD.date_key
           )
           OR (
               salon_id = NEW.salon_id
               AND employee_id = NEW.employee_id
               AND rest_date = NEW.date_key
           )
       );
END;

CREATE TRIGGER hr_weekly_rest_attendance_delete
AFTER DELETE ON attendance_records
WHEN OLD.record_type IN ('check_in', 'check_out')
BEGIN
    UPDATE employee_weekly_rest_work_assignments
       SET correction_pending = 1,
           correction_revision = correction_revision + 1
     WHERE salon_id = OLD.salon_id
       AND employee_id = OLD.employee_id
       AND rest_date = OLD.date_key
       AND rest_date >= '2026-08-31'
       AND status = 'completed';
END;
