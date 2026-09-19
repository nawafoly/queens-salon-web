// CORE D1 ONLY — annual-leave recall + weekly-rest work authorization.
// Keep original leave/rest facts immutable; exceptions are separate audited facts.

import {
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
  validTime,
} from '../d1.js';
import { AppError } from '../errors.js';
import { SA_LABOR_POLICY_VERSION } from '../../../src/helpers/hr/saLaborPolicy.js';
import { annualLeaveServiceYear } from '../../../src/helpers/hr/saLeaveEntitlements.js';
import { getAnnualLeaveState } from './annual-leave.js';
import { getCompTimeBalanceState } from './comp-time.js';
import { resolveEmployeeShift } from './shift-control.js';
import {
  isExplicitWeeklyRestShift,
  reconcileWeeklyRestDate,
} from './rest-holiday-compliance.js';
import {
  confirmWeeklyRestDue,
  WEEKLY_REST_MINUTES,
} from './weekly-rest-entitlements.js';

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}
function roundDays(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}
function riyadhDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function requiredReason(value, code) {
  const reason = cleanText(value);
  if (!reason || reason.length > 1500) throw new AppError(400, code);
  return reason;
}
function shiftSourceId(shift) {
  return cleanText(
    shift?.id || shift?.source_id || shift?.sourceId ||
    shift?.assignment_id || shift?.assignmentId
  ) || null;
}
function shiftSnapshot(shift) {
  return {
    source: cleanText(shift?.source) || null,
    id: shiftSourceId(shift),
    exceptionType: cleanText(shift?.exception_type || shift?.exceptionType) || null,
    active: shift?.active ?? null,
    weekday: shift?.weekday ?? null,
    shiftTemplateId: cleanText(shift?.shift_template_id || shift?.shiftTemplateId) || null,
    startTime: cleanText(shift?.template_start_time || shift?.start_time || shift?.startTime) || null,
    endTime: cleanText(shift?.template_end_time || shift?.end_time || shift?.endTime) || null,
  };
}
function assignmentWindow(shift, data = {}) {
  const startTime = validTime(
    data.startTime || data.start_time ||
    shift?.template_start_time || shift?.start_time || shift?.startTime,
    'startTime'
  );
  const endTime = validTime(
    data.endTime || data.end_time ||
    shift?.template_end_time || shift?.end_time || shift?.endTime,
    'endTime'
  );
  if (startTime >= endTime) {
    throw new AppError(400, 'core_weekly_rest_work:invalid_work_window');
  }
  return { startTime, endTime };
}

async function approvedFullDayLeaveForDate(db, salonId, employeeId, date) {
  return dbFirst(
    db,
    `SELECT leave.*
       FROM employee_leaves leave
      WHERE leave.salon_id = ?
        AND leave.employee_id = ?
        AND LOWER(leave.status) = 'approved'
        AND (leave.duration_kind IS NULL OR LOWER(leave.duration_kind) <> 'partial')
        AND leave.start_date <= ?
        AND leave.end_date >= ?
        AND NOT EXISTS (
          SELECT 1 FROM employee_leave_recalls recall
           WHERE recall.salon_id = leave.salon_id
             AND recall.leave_id = leave.id
             AND recall.recall_date = ?
             AND recall.status = 'active'
        )
      ORDER BY leave.start_date DESC
      LIMIT 1`,
    [salonId, employeeId, date, date, date]
  );
}

export async function activeWeeklyRestWorkAssignment(db, salonId, employeeIdValue, dateValue) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const restDate = validDate(dateValue, 'restDate');
  return dbFirst(
    db,
    `SELECT * FROM employee_weekly_rest_work_assignments
      WHERE salon_id = ? AND employee_id = ? AND rest_date = ?
        AND status = 'assigned'
      ORDER BY created_at DESC LIMIT 1`,
    [salonId, employeeId, restDate]
  );
}

export async function resolveAttendanceWorkAuthorization(db, salonId, employeeIdValue, dateValue) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const date = validDate(dateValue, 'date');
  const [approvedLeave, weeklyRestAssignment] = await Promise.all([
    approvedFullDayLeaveForDate(db, salonId, employeeId, date),
    activeWeeklyRestWorkAssignment(db, salonId, employeeId, date),
  ]);
  return { employeeId, date, approvedLeave, weeklyRestAssignment };
}

export async function listAnnualLeaveRecalls(db, salonId, query = {}) {
  const leaveId = cleanText(query.leaveId || query.leave_id);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const clauses = ['salon_id = ?'];
  const params = [salonId];
  if (leaveId) { clauses.push('leave_id = ?'); params.push(leaveId); }
  if (employeeId) { clauses.push('employee_id = ?'); params.push(employeeId); }
  return dbAll(
    db,
    `SELECT * FROM employee_leave_recalls
      WHERE ${clauses.join(' AND ')}
      ORDER BY recall_date DESC, created_at DESC LIMIT 500`,
    params
  );
}

export async function createAnnualLeaveRecall(
  db,
  salonId,
  leaveIdValue,
  data = {},
  actor = {},
  options = {}
) {
  const leaveId = requiredId(leaveIdValue, 'leaveId');
  const leave = await dbFirst(
    db,
    'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, leaveId]
  );
  if (!leave) throw new AppError(404, 'core_annual_leave:leave_not_found');
  if (
    cleanText(leave.leave_type).toLowerCase() !== 'annual' ||
    cleanText(leave.status).toLowerCase() !== 'approved'
  ) {
    throw new AppError(409, 'core_annual_leave:recall_requires_approved_annual_leave');
  }
  if (cleanText(leave.duration_kind).toLowerCase() === 'partial') {
    throw new AppError(409, 'core_annual_leave:partial_recall_not_supported');
  }

  const recallDate = validDate(data.recallDate || data.recall_date, 'recallDate');
  if (recallDate < cleanText(leave.start_date) || recallDate > cleanText(leave.end_date)) {
    throw new AppError(409, 'core_annual_leave:recall_date_outside_leave');
  }
  const today = riyadhDateKey();
  if (recallDate > today) {
    throw new AppError(409, 'core_annual_leave:future_recall_not_supported');
  }
  const reason = requiredReason(data.reason || data.note, 'core_annual_leave:recall_reason_required');

  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_leave_recalls
      WHERE salon_id = ? AND leave_id = ? AND recall_date = ? AND status = 'active'
      LIMIT 1`,
    [salonId, leaveId, recallDate]
  );
  if (existing) {
    const {
      reconcileLockedPayrollImpactForEmployeeDate,
    } = await import('./payroll.js');
    const payrollReconciliation =
      await reconcileLockedPayrollImpactForEmployeeDate(
        db,
        salonId,
        {
          employeeId: leave.employee_id,
          date: recallDate,
          sourceType: 'annual_leave_recall',
          sourceId: existing.id,
          reason:
            `Annual leave recall replay for ${recallDate} (${existing.id}).`,
        },
        actor,
        options
      );
    return {
      recall: existing,
      state: await getAnnualLeaveState(
        db,
        salonId,
        leave.employee_id,
        { asOfDate: today }
      ),
      payrollReconciliation,
      idempotent: true,
    };
  }

  const state = await getAnnualLeaveState(db, salonId, leave.employee_id, { asOfDate: today });
  if (state.reviewRequired || !Number.isFinite(Number(state.availableDays))) {
    throw new AppError(409, `core_annual_leave:${state.reviewReason || 'state_review_required'}`);
  }
  const employment = await dbFirst(
    db,
    `SELECT leave_balance_last_entry_id FROM employee_employment
      WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
    [salonId, leave.employee_id]
  );
  if (!employment) throw new AppError(404, 'core_annual_leave:employee_employment_not_found');

  const recallId = requiredId(data.id || generatedId('annual_leave_recall'), 'recallId');
  const ledgerId = requiredId(generatedId('annual_leave_recall_balance'), 'ledgerId');
  const before = roundDays(state.availableDays);
  const after = roundDays(before + 1);
  const expectedLastEntryId = cleanText(employment.leave_balance_last_entry_id) || null;
  const serviceYear = annualLeaveServiceYear(state.startDate, recallDate);
  const now = nowIso();
  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName = actorField(actor, 'name') || actorField(actor, 'displayName');
  const metadata = JSON.stringify({ leaveId, recallId, recallDate, workflow: 'annual_leave_recall' });

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_employment
              SET leave_balance = ?, leave_balance_last_entry_id = ?,
                  annual_leave_legacy_projection_updated_at = ?,
                  updated_by_uid = ?, updated_by_email = ?, updated_at = ?
            WHERE salon_id = ? AND employee_id = ?
              AND ((? IS NULL AND leave_balance_last_entry_id IS NULL) OR leave_balance_last_entry_id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM employee_leave_recalls existing
                 WHERE existing.salon_id = ? AND existing.leave_id = ?
                   AND existing.recall_date = ? AND existing.status = 'active'
              )`,
      params: [
        after, ledgerId, now, actorUid, actorEmail, now,
        salonId, leave.employee_id, expectedLastEntryId, expectedLastEntryId,
        salonId, leaveId, recallDate,
      ],
    },
    {
      sql: `INSERT INTO employee_leave_recalls (
              id, salon_id, leave_id, employee_id, recall_date, recalled_days,
              reason, status, balance_ledger_entry_id,
              created_by_uid, created_by_email, created_by_name, created_at, updated_at
            )
            SELECT ?, ?, ?, ?, ?, 1, ?, 'active', ?, ?, ?, ?, ?, ?
            FROM employee_employment employment
            WHERE employment.salon_id = ? AND employment.employee_id = ?
              AND employment.leave_balance_last_entry_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM employee_leave_recalls existing
                 WHERE existing.salon_id = ? AND existing.leave_id = ?
                   AND existing.recall_date = ? AND existing.status = 'active'
              )`,
      params: [
        recallId, salonId, leaveId, leave.employee_id, recallDate, reason, ledgerId,
        actorUid, actorEmail, actorName, now, now,
        salonId, leave.employee_id, ledgerId, salonId, leaveId, recallDate,
      ],
    },
    {
      sql: `INSERT INTO employee_leave_balance_ledger (
              id, salon_id, employee_id, action_type, days, change_amount,
              balance_before, balance_after, operation_date, note,
              source_type, source_id, created_by_uid, created_by_email,
              created_by_name, created_at, entry_code, effective_date,
              service_year_start, service_year_end, policy_version, metadata_json
            )
            SELECT ?, ?, recall.employee_id, 'add', 1, 1, ?, ?, ?, ?,
                   'leave_recall', recall.id, ?, ?, ?, ?, 'MANUAL_CORRECTION', ?, ?, ?, ?, ?
            FROM employee_leave_recalls recall
            WHERE recall.salon_id = ? AND recall.id = ? AND recall.status = 'active'`,
      params: [
        ledgerId, salonId, before, after, today, reason,
        actorUid, actorEmail, actorName, now, recallDate,
        serviceYear.serviceYearStart, serviceYear.serviceYearEnd,
        SA_LABOR_POLICY_VERSION, metadata, salonId, recallId,
      ],
    },
  ]);

  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1 || changes(results?.[2]) !== 1) {
    const raced = await dbFirst(
      db,
      `SELECT * FROM employee_leave_recalls
        WHERE salon_id = ? AND leave_id = ? AND recall_date = ? AND status = 'active' LIMIT 1`,
      [salonId, leaveId, recallDate]
    );
    if (raced) {
      return {
        recall: raced,
        state: await getAnnualLeaveState(db, salonId, leave.employee_id, { asOfDate: today }),
        idempotent: true,
      };
    }
    throw new AppError(409, 'core_annual_leave:recall_concurrency_conflict');
  }

  const recall = await dbFirst(
    db,
    'SELECT * FROM employee_leave_recalls WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, recallId]
  );
  const {
    reconcileLockedPayrollImpactForEmployeeDate,
  } = await import('./payroll.js');
  const payrollReconciliation =
    await reconcileLockedPayrollImpactForEmployeeDate(
      db,
      salonId,
      {
        employeeId: leave.employee_id,
        date: recallDate,
        sourceType: 'annual_leave_recall',
        sourceId: recallId,
        reason:
          `Annual leave recalled on ${recallDate} (${recallId}).`,
      },
      actor,
      options
    );

  return {
    recall,
    state: await getAnnualLeaveState(
      db,
      salonId,
      leave.employee_id,
      { asOfDate: today }
    ),
    payrollReconciliation,
    idempotent: false,
  };
}

export async function cancelAnnualLeaveRecall(
  db,
  salonId,
  leaveIdValue,
  recallIdValue,
  data = {},
  actor = {},
  options = {}
) {
  const leaveId = requiredId(leaveIdValue, 'leaveId');
  const recallId = requiredId(recallIdValue, 'recallId');
  const recall = await dbFirst(
    db,
    'SELECT * FROM employee_leave_recalls WHERE salon_id = ? AND leave_id = ? AND id = ? LIMIT 1',
    [salonId, leaveId, recallId]
  );
  if (!recall) throw new AppError(404, 'core_annual_leave:recall_not_found');
  const today = riyadhDateKey();
  if (cleanText(recall.status).toLowerCase() === 'cancelled') {
    const {
      reconcileLockedPayrollImpactForEmployeeDate,
    } = await import('./payroll.js');
    const payrollReconciliation =
      await reconcileLockedPayrollImpactForEmployeeDate(
        db,
        salonId,
        {
          employeeId: recall.employee_id,
          date: recall.recall_date,
          sourceType: 'annual_leave_recall_cancel',
          sourceId: recall.id,
          reason:
            `Annual leave recall cancellation replay for ${recall.recall_date} (${recall.id}).`,
        },
        actor,
        options
      );
    return {
      recall,
      state: await getAnnualLeaveState(
        db,
        salonId,
        recall.employee_id,
        { asOfDate: today }
      ),
      payrollReconciliation,
      idempotent: true,
    };
  }
  const reason = requiredReason(
    data.reason || data.cancelReason || data.cancel_reason,
    'core_annual_leave:recall_cancel_reason_required'
  );
  const state = await getAnnualLeaveState(db, salonId, recall.employee_id, { asOfDate: today });
  if (state.reviewRequired || !Number.isFinite(Number(state.availableDays))) {
    throw new AppError(409, `core_annual_leave:${state.reviewReason || 'state_review_required'}`);
  }
  if (Number(state.availableDays) < 1) {
    throw new AppError(409, 'core_annual_leave:recall_cancel_insufficient_balance');
  }
  const employment = await dbFirst(
    db,
    'SELECT leave_balance_last_entry_id FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1',
    [salonId, recall.employee_id]
  );
  if (!employment) throw new AppError(404, 'core_annual_leave:employee_employment_not_found');

  const ledgerId = requiredId(generatedId('annual_leave_recall_reversal'), 'ledgerId');
  const before = roundDays(state.availableDays);
  const after = roundDays(before - 1);
  const expectedLastEntryId = cleanText(employment.leave_balance_last_entry_id) || null;
  const serviceYear = annualLeaveServiceYear(state.startDate, recall.recall_date);
  const now = nowIso();
  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName = actorField(actor, 'name') || actorField(actor, 'displayName');
  const metadata = JSON.stringify({ leaveId, recallId, recallDate: recall.recall_date, workflow: 'annual_leave_recall_cancel' });

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_employment
              SET leave_balance = ?, leave_balance_last_entry_id = ?,
                  annual_leave_legacy_projection_updated_at = ?,
                  updated_by_uid = ?, updated_by_email = ?, updated_at = ?
            WHERE salon_id = ? AND employee_id = ?
              AND ((? IS NULL AND leave_balance_last_entry_id IS NULL) OR leave_balance_last_entry_id = ?)
              AND EXISTS (
                SELECT 1 FROM employee_leave_recalls active
                 WHERE active.salon_id = ? AND active.id = ? AND active.leave_id = ?
                   AND active.status = 'active'
              )`,
      params: [
        after, ledgerId, now, actorUid, actorEmail, now,
        salonId, recall.employee_id, expectedLastEntryId, expectedLastEntryId,
        salonId, recallId, leaveId,
      ],
    },
    {
      sql: `INSERT INTO employee_leave_balance_ledger (
              id, salon_id, employee_id, action_type, days, change_amount,
              balance_before, balance_after, operation_date, note,
              source_type, source_id, created_by_uid, created_by_email,
              created_by_name, created_at, entry_code, effective_date,
              service_year_start, service_year_end, policy_version, metadata_json
            )
            SELECT ?, ?, active.employee_id, 'deduct', 1, -1, ?, ?, ?, ?,
                   'leave_recall_reversal', active.id, ?, ?, ?, ?,
                   'MANUAL_CORRECTION', ?, ?, ?, ?, ?
            FROM employee_leave_recalls active
            WHERE active.salon_id = ? AND active.id = ? AND active.leave_id = ?
              AND active.status = 'active'`,
      params: [
        ledgerId, salonId, before, after, today, reason,
        actorUid, actorEmail, actorName, now, recall.recall_date,
        serviceYear.serviceYearStart, serviceYear.serviceYearEnd,
        SA_LABOR_POLICY_VERSION, metadata, salonId, recallId, leaveId,
      ],
    },
    {
      sql: `UPDATE employee_leave_recalls
              SET status = 'cancelled', reversal_ledger_entry_id = ?,
                  cancelled_by_uid = ?, cancelled_by_email = ?, cancelled_by_name = ?,
                  cancelled_at = ?, cancel_reason = ?, updated_at = ?
            WHERE salon_id = ? AND id = ? AND leave_id = ? AND status = 'active'
              AND EXISTS (
                SELECT 1 FROM employee_leave_balance_ledger ledger
                 WHERE ledger.salon_id = ? AND ledger.id = ?
                   AND ledger.source_type = 'leave_recall_reversal'
              )`,
      params: [
        ledgerId, actorUid, actorEmail, actorName, now, reason, now,
        salonId, recallId, leaveId, salonId, ledgerId,
      ],
    },
  ]);

  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1 || changes(results?.[2]) !== 1) {
    throw new AppError(409, 'core_annual_leave:recall_cancellation_concurrency_conflict');
  }
  const cancelledRecall = await dbFirst(
    db,
    'SELECT * FROM employee_leave_recalls WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, recallId]
  );
  const {
    reconcileLockedPayrollImpactForEmployeeDate,
  } = await import('./payroll.js');
  const payrollReconciliation =
    await reconcileLockedPayrollImpactForEmployeeDate(
      db,
      salonId,
      {
        employeeId: recall.employee_id,
        date: recall.recall_date,
        sourceType: 'annual_leave_recall_cancel',
        sourceId: recallId,
        reason:
          `Annual leave recall cancelled for ${recall.recall_date} (${recallId}).`,
      },
      actor,
      options
    );

  return {
    recall: cancelledRecall,
    state: await getAnnualLeaveState(
      db,
      salonId,
      recall.employee_id,
      { asOfDate: today }
    ),
    payrollReconciliation,
    idempotent: false,
  };
}

export async function listWeeklyRestWorkAssignments(db, salonId, query = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const status = cleanText(query.status).toLowerCase();
  const clauses = ['salon_id = ?'];
  const params = [salonId];
  if (employeeId) { clauses.push('employee_id = ?'); params.push(employeeId); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  return dbAll(
    db,
    `SELECT * FROM employee_weekly_rest_work_assignments
      WHERE ${clauses.join(' AND ')}
      ORDER BY rest_date DESC, created_at DESC LIMIT 500`,
    params
  );
}

export async function createWeeklyRestWorkAssignment(db, salonId, data = {}, actor = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const restDate = validDate(data.restDate || data.rest_date, 'restDate');
  const reason = requiredReason(data.reason || data.note, 'core_weekly_rest_work:reason_required');

  const existing = await activeWeeklyRestWorkAssignment(db, salonId, employeeId, restDate);
  if (existing) return { assignment: existing, idempotent: true };

  const leaveConflict = await approvedFullDayLeaveForDate(db, salonId, employeeId, restDate);
  if (leaveConflict) throw new AppError(409, 'core_weekly_rest_work:approved_leave_conflict');

  const shift = await resolveEmployeeShift(db, salonId, employeeId, restDate);
  if (!isExplicitWeeklyRestShift(shift)) {
    throw new AppError(409, 'core_weekly_rest_work:not_weekly_rest_day');
  }
  const { startTime, endTime } = assignmentWindow(shift, data);
  const id = requiredId(data.id || generatedId('weekly_rest_work'), 'id');
  const now = nowIso();
  const lockEnabled = Number(
    shift?.attendance_lock_enabled ?? shift?.attendanceLockEnabled ?? 0
  ) === 1 ? 1 : 0;
  const lockAfter = Math.max(0, Number(
    shift?.attendance_lock_after_minutes ?? shift?.attendanceLockAfterMinutes ?? 0
  ) || 0);

  const result = await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_weekly_rest_work_assignments (
       id, salon_id, employee_id, rest_date, start_time, end_time,
       attendance_lock_enabled, attendance_lock_after_minutes,
       reason, schedule_source_type, schedule_source_id, schedule_snapshot_json,
       status, assigned_by_uid, assigned_by_email, assigned_by_name, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned', ?, ?, ?, ?, ?)`,
    [
      id, salonId, employeeId, restDate, startTime, endTime,
      lockEnabled, lockAfter, reason,
      cleanText(shift?.source) || 'weekly_schedule', shiftSourceId(shift),
      JSON.stringify(shiftSnapshot(shift)),
      actorField(actor, 'uid'), actorField(actor, 'email'),
      actorField(actor, 'name') || actorField(actor, 'displayName'), now, now,
    ]
  );
  const assignment = await activeWeeklyRestWorkAssignment(db, salonId, employeeId, restDate);
  if (!assignment) throw new AppError(409, 'core_weekly_rest_work:assignment_concurrency_conflict');
  return { assignment, idempotent: changes(result) !== 1 };
}

export async function cancelWeeklyRestWorkAssignment(db, salonId, idValue, data = {}, actor = {}) {
  const id = requiredId(idValue, 'assignmentId');
  const assignment = await dbFirst(
    db,
    'SELECT * FROM employee_weekly_rest_work_assignments WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  if (!assignment) throw new AppError(404, 'core_weekly_rest_work:assignment_not_found');
  if (cleanText(assignment.status) === 'cancelled') return { assignment, idempotent: true };
  if (cleanText(assignment.status) !== 'assigned') {
    throw new AppError(409, 'core_weekly_rest_work:completed_assignment_cannot_cancel');
  }
  const reason = requiredReason(
    data.reason || data.cancelReason || data.cancel_reason,
    'core_weekly_rest_work:cancel_reason_required'
  );
  const now = nowIso();
  const result = await dbRun(
    db,
    `UPDATE employee_weekly_rest_work_assignments
        SET status = 'cancelled', cancelled_by_uid = ?, cancelled_by_email = ?,
            cancelled_by_name = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ?
      WHERE salon_id = ? AND id = ? AND status = 'assigned'`,
    [
      actorField(actor, 'uid'), actorField(actor, 'email'),
      actorField(actor, 'name') || actorField(actor, 'displayName'),
      now, reason, now, salonId, id,
    ]
  );
  if (changes(result) !== 1) throw new AppError(409, 'core_weekly_rest_work:cancellation_concurrency_conflict');
  return {
    assignment: await dbFirst(db, 'SELECT * FROM employee_weekly_rest_work_assignments WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]),
    idempotent: false,
  };
}

export function weeklyRestAssignmentAsShift(assignment) {
  if (!assignment) return null;
  return {
    source: 'weekly_rest_work_assignment',
    active: 1,
    exception_type: 'work',
    start_time: assignment.start_time,
    end_time: assignment.end_time,
    template_start_time: assignment.start_time,
    template_end_time: assignment.end_time,
    attendance_lock_enabled: Number(assignment.attendance_lock_enabled || 0),
    attendance_lock_after_minutes: Number(assignment.attendance_lock_after_minutes || 0),
  };
}

export async function reconcileAssignedWeeklyRestWork(
  db,
  salonId,
  employeeIdValue,
  restDateValue,
  actor = {},
  externalAttendanceDb = null
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const restDate = validDate(restDateValue, 'restDate');
  const assignment = await activeWeeklyRestWorkAssignment(db, salonId, employeeId, restDate);
  const result = await reconcileWeeklyRestDate(
    db, salonId, employeeId, restDate, actor, externalAttendanceDb
  );
  let entitlement = null;
  if (assignment && result?.worked && result?.attendance?.complete && result?.event?.id) {
    entitlement = await confirmWeeklyRestDue(
      db,
      salonId,
      result.event.id,
      actor,
      { note: 'استحقاق راحة بديلة بعد العمل الفعلي في يوم الراحة الأسبوعية' }
    );
    const now = nowIso();
    await dbRun(
      db,
      `UPDATE employee_weekly_rest_work_assignments
          SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE salon_id = ? AND id = ? AND status = 'assigned'`,
      [now, now, salonId, assignment.id]
    );
  }
  return { ...result, assignment, entitlement };
}

export async function getLeaveRestOverview(db, salonId, employeeIdValue) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const [annualLeave, weeklyRestDue, recalls, assignments, weeklyRestEvents] = await Promise.all([
    getAnnualLeaveState(db, salonId, employeeId, {
      liveAccrual: true,
    }),
    getCompTimeBalanceState(db, salonId, employeeId, 'weekly_rest_due'),
    listAnnualLeaveRecalls(db, salonId, { employeeId }),
    listWeeklyRestWorkAssignments(db, salonId, { employeeId }),
    dbAll(
      db,
      `SELECT * FROM employee_weekly_rest_events
        WHERE salon_id = ? AND employee_id = ?
        ORDER BY rest_date DESC LIMIT 200`,
      [salonId, employeeId]
    ),
  ]);

  const historicalOpening = await dbFirst(
    db,
    `SELECT id, minutes, source_date, source_id, note,
            created_by_uid, created_by_email, created_at
       FROM employee_comp_time_ledger
      WHERE salon_id = ?
        AND employee_id = ?
        AND entitlement_type = 'weekly_rest_due'
        AND entry_kind = 'credit'
        AND source_type = 'historical_opening_balance'
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [salonId, employeeId]
  );

  return {
    employeeId,
    annualLeave,
    annualLeaveRecalls: recalls,
    weeklyRest: {
      dueMinutes: Number(weeklyRestDue.balanceMinutes || 0),
      dueDays: Number(weeklyRestDue.balanceMinutes || 0) / WEEKLY_REST_MINUTES,
      historicalOpening: historicalOpening
        ? {
            id: historicalOpening.id,
            minutes: Number(
              historicalOpening.minutes || 0
            ),
            days:
              Number(
                historicalOpening.minutes || 0
              ) / WEEKLY_REST_MINUTES,
            effectiveDate:
              cleanText(
                historicalOpening.source_date
              ) || null,
            sourceReference:
              cleanText(
                historicalOpening.source_id
              ).startsWith(`${employeeId}:`)
                ? cleanText(
                    historicalOpening.source_id
                  ).slice(
                    employeeId.length + 1
                  )
                : cleanText(
                    historicalOpening.source_id
                  ) || null,
            reason:
              cleanText(
                historicalOpening.note
              ) || null,
            createdAt:
              historicalOpening.created_at ||
              null,
          }
        : null,
      assignments,
      events: weeklyRestEvents,
    },
  };
}
