// CORE D1 ONLY — reconcile authorized overtime against observed attendance.
// Payroll must consume only reconciled cash-overtime minutes. Comp-time creates a
// separate entitlement credit and must never also become payroll overtime.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LABOR_LIMITS,
  SA_LABOR_POLICY_VERSION,
  calculateCompensatoryLeaveMinutes,
} from '../../../src/helpers/hr/saLaborPolicy.js';
import { listAttendance } from './attendance.js';
import { attendanceWorkedMinutes } from './rest-holiday-compliance.js';
import { creditCompTime } from './comp-time.js';

function localWindow(dateKey, startTime, endTime) {
  const start = Date.parse(`${dateKey}T${startTime}:00+03:00`);
  let end = Date.parse(`${dateKey}T${endTime}:00+03:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new AppError(409, 'core_overtime:invalid_authorized_window');
  }
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

export function overtimeAttendanceOverlapMinutes(
  attendance,
  dateKey,
  startTime,
  endTime,
  approvedMinutesValue
) {
  const approvedMinutes = Math.max(0, Math.round(Number(approvedMinutesValue || 0)));
  if (!attendance?.complete || approvedMinutes <= 0) return 0;
  const window = localWindow(dateKey, startTime, endTime);
  let overlap = 0;

  for (const interval of attendance.intervals || []) {
    const intervalStart = Date.parse(cleanText(interval.checkInAt));
    const intervalEnd = Date.parse(cleanText(interval.checkOutAt));
    if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd) || intervalEnd <= intervalStart) {
      continue;
    }
    const from = Math.max(window.start, intervalStart);
    const to = Math.min(window.end, intervalEnd);
    if (to > from) overlap += Math.round((to - from) / 60000);
  }

  return Math.max(0, Math.min(approvedMinutes, overlap));
}

function addDaysIso(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

async function overtimeRecordByIdOrRequest(db, salonId, value) {
  const id = requiredId(value, 'overtimeRecordId');
  return dbFirst(
    db,
    `SELECT * FROM employee_overtime_records
      WHERE salon_id = ? AND (id = ? OR request_id = ?)
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1`,
    [salonId, id, id, id]
  );
}

export async function reconcileOvertimeAttendance(
  db,
  salonId,
  idValue,
  actor = {},
  externalAttendanceDb = null
) {
  const record = await overtimeRecordByIdOrRequest(db, salonId, idValue);
  if (!record) throw new AppError(404, 'core_overtime:not_found');

  const financialStatus = cleanText(record.financial_status).toLowerCase();
  if (
    financialStatus === 'included' ||
    financialStatus === 'comp_time_credited' ||
    cleanText(record.payroll_entry_id)
  ) {
    return { record, locked: true, idempotent: true };
  }

  const attendanceRows = await listAttendance(
    db,
    salonId,
    { employeeId: record.employee_id, date: record.date_key },
    externalAttendanceDb
  );
  const attendance = attendanceWorkedMinutes(attendanceRows, record.date_key);
  const actualWorkedMinutes = overtimeAttendanceOverlapMinutes(
    attendance,
    record.date_key,
    record.start_time,
    record.end_time,
    record.approved_minutes
  );

  const evidence = {
    attendanceComplete: attendance.complete,
    observedWorkedMinutes: attendance.workedMinutes,
    authorizedWindowWorkedMinutes: actualWorkedMinutes,
    approvedMinutes: Number(record.approved_minutes || 0),
    intervals: attendance.intervals || [],
    recordIds: attendance.recordIds || [],
    policyVersion: SA_LABOR_POLICY_VERSION,
  };
  const now = nowIso();
  const actorUid = cleanText(actor.uid) || null;

  if (!attendance.complete) {
    await dbRun(
      db,
      `UPDATE employee_overtime_records
          SET actual_worked_minutes = 0,
              attendance_evidence_json = ?,
              reconciliation_note = ?,
              reconciled_by_uid = ?,
              attendance_reconciled_at = NULL,
              financial_status = 'pending_attendance',
              updated_at = ?
        WHERE salon_id = ? AND id = ?
          AND financial_status = 'pending_attendance'`,
      [
        JSON.stringify(evidence),
        'Attendance is incomplete; compensation remains pending.',
        actorUid,
        now,
        salonId,
        record.id,
      ]
    );
    return {
      record: await overtimeRecordByIdOrRequest(db, salonId, record.id),
      attendance,
      actualWorkedMinutes: 0,
      pendingAttendance: true,
      idempotent: false,
    };
  }

  const mode = cleanText(record.compensation_mode).toLowerCase() || 'cash_overtime';

  if (actualWorkedMinutes <= 0) {
    await dbRun(
      db,
      `UPDATE employee_overtime_records
          SET actual_worked_minutes = 0,
              attendance_evidence_json = ?,
              reconciliation_note = ?,
              reconciled_by_uid = ?,
              attendance_reconciled_at = ?,
              financial_status = 'cancelled',
              payout_status = 'cancelled',
              updated_at = ?
        WHERE salon_id = ? AND id = ?
          AND financial_status NOT IN ('included','comp_time_credited')`,
      [
        JSON.stringify(evidence),
        'Complete attendance contains no worked minutes inside the authorized overtime window.',
        actorUid,
        now,
        now,
        salonId,
        record.id,
      ]
    );
    return {
      record: await overtimeRecordByIdOrRequest(db, salonId, record.id),
      attendance,
      actualWorkedMinutes: 0,
      noCompensationDue: true,
      idempotent: false,
    };
  }

  if (mode === 'comp_time') {
    const consentAt = cleanText(record.employee_consent_at);
    const consentReference = cleanText(record.employee_consent_reference);
    if (!consentAt || !consentReference) {
      throw new AppError(409, 'core_overtime:comp_time_consent_required');
    }

    const creditedMinutes = calculateCompensatoryLeaveMinutes(actualWorkedMinutes);
    const credit = await creditCompTime(
      db,
      salonId,
      {
        employeeId: record.employee_id,
        entitlementType: 'overtime_comp',
        minutes: creditedMinutes,
        sourceMinutes: actualWorkedMinutes,
        conversionRatioMilli: Math.round(
          SA_LABOR_LIMITS.compensatoryLeaveMinimumRatio * 1000
        ),
        sourceDate: record.date_key,
        sourceType: 'overtime_record',
        sourceId: record.id,
        employeeConsentAt: consentAt,
        employeeConsentReference: consentReference,
        expiresAt: addDaysIso(
          record.date_key,
          SA_LABOR_LIMITS.compensatoryLeaveDefaultUseWithinDays
        ),
        note: optionalText(record.reason) || 'تعويض وقت عن ساعات إضافية مثبتة بالحضور',
      },
      actor
    );

    await dbRun(
      db,
      `UPDATE employee_overtime_records
          SET actual_worked_minutes = ?,
              attendance_evidence_json = ?,
              reconciliation_note = ?,
              reconciled_by_uid = ?,
              attendance_reconciled_at = ?,
              comp_time_ledger_entry_id = ?,
              financial_status = 'comp_time_credited',
              updated_at = ?
        WHERE salon_id = ? AND id = ?
          AND financial_status NOT IN ('included','comp_time_credited')`,
      [
        actualWorkedMinutes,
        JSON.stringify(evidence),
        `Comp-time credited: ${creditedMinutes} minutes from ${actualWorkedMinutes} reconciled overtime minutes.`,
        actorUid,
        now,
        credit.entry.id,
        now,
        salonId,
        record.id,
      ]
    );

    return {
      record: await overtimeRecordByIdOrRequest(db, salonId, record.id),
      attendance,
      actualWorkedMinutes,
      compensationMode: mode,
      creditedMinutes,
      compTime: credit,
      idempotent: credit.idempotent,
    };
  }

  if (mode !== 'cash_overtime') {
    throw new AppError(409, 'core_overtime:invalid_compensation_mode');
  }

  await dbRun(
    db,
    `UPDATE employee_overtime_records
        SET actual_worked_minutes = ?,
            attendance_evidence_json = ?,
            reconciliation_note = ?,
            reconciled_by_uid = ?,
            attendance_reconciled_at = ?,
            financial_status = 'ready_for_payroll',
            updated_at = ?
      WHERE salon_id = ? AND id = ?
        AND financial_status NOT IN ('included','comp_time_credited')`,
    [
      actualWorkedMinutes,
      JSON.stringify(evidence),
      'Cash overtime is ready for canonical payroll calculation from reconciled minutes.',
      actorUid,
      now,
      now,
      salonId,
      record.id,
    ]
  );

  return {
    record: await overtimeRecordByIdOrRequest(db, salonId, record.id),
    attendance,
    actualWorkedMinutes,
    compensationMode: mode,
    readyForPayroll: true,
    idempotent: false,
  };
}

export async function listReconciledCashOvertimeForPayroll(
  db,
  salonId,
  employeeIdValue,
  payrollMonthValue
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const payrollMonth = cleanText(payrollMonthValue);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    throw new AppError(400, 'core_overtime:invalid_payroll_month');
  }
  return dbAll(
    db,
    `SELECT * FROM employee_overtime_records
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
        AND compensation_mode = 'cash_overtime'
        AND financial_status IN ('ready_for_payroll','included')
        AND actual_worked_minutes > 0
      ORDER BY date_key, start_time, id`,
    [salonId, employeeId, payrollMonth]
  );
}
