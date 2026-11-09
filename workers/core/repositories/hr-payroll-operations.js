import { dbAll, dbFirst } from '../d1.js';
import { AppError } from '../errors.js';
import { processReconciliationOperation, retryReconciliationOperations, readReconciliationOperation } from '../../reconciliation-operation-store.js';

const table = 'hr_payroll_operations';
const readyDatabases = new WeakSet();
export async function ensureHrPayrollOutbox(db) {
  if (readyDatabases.has(db)) return;
  await dbAll(db,'SELECT id FROM hr_payroll_operations LIMIT 0');
  readyDatabases.add(db);
}

async function reconcile(db,op,options) {
  const source = JSON.parse(op.response_json);
  const actor = JSON.parse(op.actor_json);
  const payroll = await import('./payroll.js');
  if (source.sourceType === 'permission') {
    const {refreshPayrollEntries}=await import('./permissions.js');
    await refreshPayrollEntries(db,op.salon_id,op.employee_id,op.work_date);
  }
  if (source.sourceType === 'employee_leave') {
    return payroll.reconcileLockedPayrollImpactForHrCorrection(db,op.salon_id,{leaveId:source.sourceId},actor,options);
  }
  return payroll.reconcileLockedPayrollImpactForEmployeeDate(db,op.salon_id,{
    employeeId:op.employee_id,date:op.work_date,sourceType:source.sourceType,sourceId:source.sourceId,
    reason:op.reason || `Canonical ${source.sourceType} reconciliation (${op.id}).`,
  },actor,options);
}

export async function recoverHrPayrollOperations(db,options={}) {
  return retryReconciliationOperations(db,op=>reconcile(db,op,options),20,table);
}

export async function getHrPayrollOperation(db,salonId,id) {
  const op=await dbFirst(db,`SELECT * FROM hr_payroll_operations WHERE salon_id=? AND id=?`,[salonId,id]);
  if (!op) throw new AppError(404,'core_hr:operation_not_found');
  const events=await dbAll(db,'SELECT * FROM hr_payroll_operation_events WHERE operation_id=? ORDER BY sequence',[id]);
  return {...op,events};
}

export async function retryHrPayrollOperation(db,salonId,id,options={}) {
  await getHrPayrollOperation(db,salonId,id);
  await db.prepare(`UPDATE hr_payroll_operations SET status='pending',attempts=0,next_attempt_at=?,updated_at=?
    WHERE salon_id=? AND id=? AND status='needs_attention'`)
    .bind(new Date().toISOString(),new Date().toISOString(),salonId,id).run();
  return processReconciliationOperation(db,id,op=>reconcile(db,op,options),table);
}

export async function reconcileHrPayrollSource(db,salonId,sourceType,sourceId,options={},fallback) {
  let rows;
  try { rows = await dbAll(db,`SELECT id FROM hr_payroll_operations WHERE salon_id=?
    AND json_extract(response_json,'$.sourceType')=? AND json_extract(response_json,'$.sourceId')=?
    AND status<>'completed' ORDER BY created_at,id`,[salonId,sourceType,sourceId]); }
  catch (error) {
    // This helper runs only after the HR change has committed. Its D1 trigger
    // has already persisted recovery work even if the acknowledgement is lost.
    console.error('[core-hr] reconciliation lookup unavailable',sourceType,sourceId,error);
    return {fullyCompleted:false,status:'pending',sourceType,sourceId,
      operationId:`source:${sourceType}:${sourceId}`,message:'hr_saved_reconciliation_pending'};
  }
  // An idempotent decision can predate the outbox migration. Reconciliation of
  // that already committed state still uses Core's existing financial logic.
  if (!rows.length) return fallback();
  let result, pending;
  for (const row of rows) {
    let op;
    try { op = await processReconciliationOperation(db,row.id,value=>reconcile(db,value,options),table); }
    catch (error) {
      console.error('[core-hr] reconciliation acknowledgement unavailable',row.id,error);
      op = await readReconciliationOperation(db,row.id,table).catch(()=>null) || {id:row.id,status:'pending'};
    }
    if (op.status !== 'completed') pending = op;
    else result = JSON.parse(op.reconciliation_json);
  }
  return pending ? {
    status:pending.status,fullyCompleted:false,operationId:pending.id,
    message:'hr_saved_reconciliation_pending',
  } : {...result,fullyCompleted:true};
}
