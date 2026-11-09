import {readReconciliationOperation} from './reconciliation-operation-store.js';
export {processReconciliationOperation as processAttendanceOperation,
  retryReconciliationOperations as retryAttendanceOperations} from './reconciliation-operation-store.js';
// Durable recovery on Attendance D1. No transaction spans Attendance and Core.
// Replays only invoke Core's canonical residual reconciliation, never a delta
// supplied by the client. A lost acknowledgement therefore cannot add money twice.
const snapshotSql = `SELECT json_group_array(json_object(
  'id',id,'employee_uid',employee_uid,'employee_doc_id',employee_doc_id,
  'type',type,'server_time',server_time,'work_date',work_date,'result',result,
  'source',source,'updated_at',updated_at)) AS records
  FROM (SELECT * FROM attendance_records WHERE employee_uid = ?
    AND COALESCE(work_date,date(server_time,'+3 hours')) = ? ORDER BY id)`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])])
  );
  return value;
}

export async function attendanceRequestHash(body) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(body))));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function readAttendanceOperation(db, id) {
  return readReconciliationOperation(db,id);
}

export async function prepareAttendanceOperation(db, data) {
  const before = await db.prepare(snapshotSql).bind(data.employeeUid, data.date).first();
  return { ...data, before: before.records, createdAt: new Date().toISOString() };
}

export async function commitAttendanceOperation(db, op, statements, response) {
  const insert = db.prepare(`INSERT INTO attendance_operations
    (id,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,
     required_permissions,reason,before_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT CASE WHEN records = ? THEN 1 ELSE 0 END FROM (${snapshotSql})))`)
    .bind(op.id,op.salonId,op.employeeUid,op.employeeId,op.date,op.requestHash,
      JSON.stringify(op.actor),JSON.stringify(op.permissions),op.reason || null,op.before,
      JSON.stringify(response),op.createdAt,op.createdAt,op.createdAt,op.before,op.employeeUid,op.date);
  const after = db.prepare(`UPDATE attendance_operations SET after_records = (${snapshotSql}) WHERE id = ?`)
    .bind(op.employeeUid,op.date,op.id);
  // The CHECK rejects stale reads; the partial unique index serializes pending
  // admin corrections for an employee, including corrections in another month.
  const invalidate = db.prepare('DELETE FROM attendance_monthly_summaries WHERE employee_uid=? AND year_month=?')
    .bind(op.employeeUid,op.date.slice(0,7));
  const results = await db.batch([insert, ...statements, after, invalidate]);
  return results.slice(1,-2);
}

export function punchReconciliationStatement(db,{recordId,salonId,employeeId,employeeUid,date,actor,now}) {
  return db.prepare(`INSERT INTO attendance_operations
    (id,origin,salon_id,employee_uid,employee_id,work_date,request_hash,actor_json,
      required_permissions,before_records,after_records,response_json,next_attempt_at,created_at,updated_at,snapshot_matches)
    SELECT ?,'punch',?,?,?,?,?,?,'[]','[]',json_array(json_object('id',id,'type',type,
      'server_time',server_time,'work_date',work_date)),json_object('ok',json('true'),'id',id,'type',type,'result',result,
        'date',work_date), ?,?,?,1
    FROM attendance_records WHERE id=? AND result='allowed'`)
    .bind(`punch:${recordId}`,salonId,employeeUid,employeeId,date,recordId,
      JSON.stringify({uid:actor.uid,email:actor.email,runtime:{role:actor.runtime?.role}}),
      now,now,now,recordId);
}

export function attendanceOperationPayload(op) {
  return {
    ...JSON.parse(op.response_json),
    ok: true,
    attendanceApplied: true,
    fullyCompleted: op.status === 'completed',
    operation: { id: op.id, status: op.status, attempts: op.attempts, nextAttemptAt: op.next_attempt_at },
    payrollReconciliation: op.reconciliation_json ? JSON.parse(op.reconciliation_json) : null,
    message: op.status === 'completed' ? 'attendance_operation_completed' : 'attendance_saved_reconciliation_pending',
  };
}
