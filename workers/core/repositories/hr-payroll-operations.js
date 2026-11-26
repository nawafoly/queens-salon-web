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

async function reconcileWeeklyRestRescheduling(
  db,
  op,
  source,
  actor,
  options,
  payroll
) {
  if (!options.externalAttendanceDb) {
    throw new Error(
      'weekly_rest_rescheduling_attendance_unavailable'
    );
  }

  const operation = await dbFirst(
    db,
    `SELECT *
       FROM employee_weekly_rest_rescheduling
      WHERE salon_id = ?
        AND employee_id = ?
        AND id = ?
      LIMIT 1`,
    [op.salon_id, op.employee_id, source.sourceId]
  );

  if (!operation) {
    throw new Error(
      'weekly_rest_rescheduling_source_missing'
    );
  }

  if (
    ![
      operation.original_rest_date,
      operation.replacement_rest_date
    ].includes(op.work_date)
  ) {
    throw new Error(
      'weekly_rest_rescheduling_target_mismatch'
    );
  }

  // Restoring the schedule does not erase evidence of work
  // performed during the original weekly rest.
  let weeklyRestReview = null;

  if (
    source.action === 'cancel' &&
    operation.status === 'cancelled' &&
    op.work_date === operation.original_rest_date
  ) {
    const {
      reconcileWeeklyRestDate
    } = await import('./rest-holiday-compliance.js');

    const result = await reconcileWeeklyRestDate(
      db,
      op.salon_id,
      op.employee_id,
      op.work_date,
      actor,
      options.externalAttendanceDb
    );

    if (!result.weeklyRest) {
      throw new Error(
        'weekly_rest_rescheduling_restoration_source_mismatch'
      );
    }

    if (result.worked && !result.event?.id) {
      throw new Error(
        'weekly_rest_rescheduling_review_evidence_missing'
      );
    }

    weeklyRestReview = {
      date: op.work_date,
      worked: result.worked === true,
      eventId: result.event?.id || null,
      restorationStatus:
        result.event?.restoration_status || null,
      attendanceComplete:
        result.attendance?.complete === true,
      workedMinutes:
        result.attendance?.workedMinutes || 0,
      requiresReview:
        result.worked === true &&
        !['fulfilled', 'scheduled', 'owed'].includes(
          result.event?.restoration_status
        )
    };
  }

  const month = op.work_date.slice(0, 7);

  const entries = await dbAll(
    db,
    `SELECT *
       FROM payroll_entries
      WHERE salon_id = ?
        AND employee_id = ?
        AND payroll_month = ?
        AND status IN ('draft', 'reviewed')
      ORDER BY id`,
    [op.salon_id, op.employee_id, month]
  );

  const previews = [];

  for (const entry of entries) {
    const refresh =
      await payroll.refreshPayrollDraftForRestRescheduling(
        db,
        op.salon_id,
        entry,
        actor,
        options
      );

    previews.push({
      payrollEntryId: entry.id,
      payrollMonth: entry.payroll_month,
      savedNetHalalas:
        refresh.previousNetHalalas,
      canonicalNetHalalas:
        refresh.resultingNetHalalas,
      changed: refresh.changed,
      requiresRefresh: false
    });
  }

  const lockedResult =
    await payroll.reconcileLockedPayrollImpactForEmployeeDate(
      db,
      op.salon_id,
      {
        employeeId: op.employee_id,
        date: op.work_date,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        reason: op.reason
      },
      actor,
      options
    );

  return {
    ...lockedResult,
    payrollPreviews: previews,
    draftRefreshRequired:
      previews.some(row => row.requiresRefresh),
    reconciliationMode: 'canonical_draft_refresh',
    operationStatus: operation.status,
    weeklyRestReview
  };
}

async function reconcile(db,op,options) {
  const source = JSON.parse(op.response_json);
  const actor = JSON.parse(op.actor_json);
  const payroll = await import('./payroll.js');

  if (source.sourceType === 'weekly_rest_rescheduling') {
    return reconcileWeeklyRestRescheduling(
      db,
      op,
      source,
      actor,
      options,
      payroll
    );
  }
  if (source.sourceType === 'permission') {
    const {refreshPayrollEntries}=await import('./permissions.js');
    await refreshPayrollEntries(db,op.salon_id,op.employee_id,op.work_date);
  }
  if (source.sourceType === 'employee_leave') {
    return payroll.reconcileLockedPayrollImpactForHrCorrection(db,op.salon_id,{leaveId:source.sourceId},actor,options);
  }
  const payrollResult = await payroll.reconcileLockedPayrollImpactForEmployeeDate(db,op.salon_id,{
    employeeId:op.employee_id,date:op.work_date,sourceType:source.sourceType,sourceId:source.sourceId,
    reason:op.reason || `Canonical ${source.sourceType} reconciliation (${op.id}).`,
  },actor,options);

  if (source.sourceType !== 'core_attendance') {
    return payrollResult;
  }

  const {
    reconcileCreditedWeeklyRest,
    WEEKLY_REST_CORRECTION_FROM_DATE,
  } = await import('./weekly-rest-correction.js');

  const before = JSON.parse(op.before_records || 'null');
  const after = JSON.parse(op.after_records || 'null');

  const targets = new Map();

  for (const record of [before, after]) {
    if (!record) continue;

    if (!['check_in', 'check_out'].includes(record.record_type)) {
      continue;
    }

    const employeeId = record.employee_id || op.employee_id;
    const date = record.date_key || op.work_date;

    if (!employeeId || !date) {
      throw new Error('core_attendance_weekly_rest_invalid_target');
    }

    if (date < WEEKLY_REST_CORRECTION_FROM_DATE) {
      continue;
    }

    targets.set(
      JSON.stringify([employeeId, date]),
      { employeeId, date }
    );
  }

  const weeklyRestCorrections = [];

  for (const target of targets.values()) {
    const assignment = await dbFirst(
      db,
      `SELECT id
         FROM employee_weekly_rest_work_assignments
        WHERE salon_id = ?
          AND employee_id = ?
          AND rest_date = ?
          AND status = 'completed'
        LIMIT 1`,
      [op.salon_id, target.employeeId, target.date]
    );

    if (!assignment) continue;

    // Financial evidence must include both attendance databases.
    if (!options.externalAttendanceDb) {
      throw new Error('core_attendance_weekly_rest_attendance_unavailable');
    }

    const correction = await reconcileCreditedWeeklyRest(
      db,
      op.salon_id,
      target.employeeId,
      target.date,
      options.externalAttendanceDb,
      actor,
      `core-outbox:${op.id}:${assignment.id}`
    );

    if (correction.status === 'not_applicable') {
      throw new Error('core_attendance_weekly_rest_assignment_conflict');
    }

    weeklyRestCorrections.push({
      assignmentId: assignment.id,
      employeeId: target.employeeId,
      date: target.date,
      ...correction,
    });
  }

  return {
    ...payrollResult,
    weeklyRestCorrections,
  };
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
