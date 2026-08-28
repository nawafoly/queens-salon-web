// CORE D1 ONLY — statutory overtime employee-request execution.
// Request approval records authorization. It never invents payroll money from
// requested hours; actual attendance + canonical payroll remain authoritative.

import {
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
  validTime,
} from '../d1.js';
import { AppError } from '../errors.js';
import { SA_LABOR_POLICY_VERSION } from '../../../src/helpers/hr/saLaborPolicy.js';

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function timeMinutes(value) {
  const [hour, minute] = validTime(value).split(':').map(Number);
  return hour * 60 + minute;
}

function durationMinutes(start, end) {
  const from = timeMinutes(start);
  const to = timeMinutes(end);
  return to > from ? to - from : to + 24 * 60 - from;
}

function intervalBounds(start, end) {
  const from = timeMinutes(start);
  let to = timeMinutes(end);
  if (to <= from) to += 24 * 60;
  return [from, to];
}

function intervalsOverlap(startA, endA, startB, endB) {
  const [a1, a2] = intervalBounds(startA, endA);
  const [b1, b2] = intervalBounds(startB, endB);
  return a1 < b2 && b1 < a2;
}

function positiveMinutes(value, fallback) {
  const minutes = Number(value ?? fallback);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 16 * 60) {
    throw new AppError(
      400,
      'core_employee_request:invalid_approved_minutes'
    );
  }
  return minutes;
}

function compensationMode(input = {}) {
  const mode = cleanText(
    input.compensationMode || input.compensation_mode
  ).toLowerCase();
  if (!mode || mode === 'cash_overtime') return 'cash_overtime';
  if (mode === 'comp_time') return 'comp_time';
  throw new AppError(
    400,
    'core_employee_request:invalid_overtime_compensation_mode'
  );
}

function requestSummary(row) {
  return {
    ...row,
    payload: parseJson(row?.payload_json),
  };
}

export function overtimeRequestFinancialAuthority() {
  return Object.freeze({
    requestApprovalCreatesPayrollAmount: false,
    actualAttendanceAuthoritative: true,
    policyVersion: SA_LABOR_POLICY_VERSION,
  });
}

export async function executeStatutoryOvertimeRequest(
  db,
  salonId,
  idValue,
  input = {},
  actor = {}
) {
  const requestId = requiredId(idValue, 'requestId');
  let row = await dbFirst(
    db,
    `SELECT *
       FROM employee_requests
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, requestId]
  );

  if (!row) {
    throw new AppError(404, 'core_employee_request:not_found');
  }
  if (cleanText(row.request_type).toLowerCase() !== 'overtime') {
    throw new AppError(
      409,
      'core_employee_request:not_overtime_request'
    );
  }

  const existing = await dbFirst(
    db,
    `SELECT *
       FROM employee_overtime_records
      WHERE salon_id = ?
        AND request_id = ?
      LIMIT 1`,
    [salonId, requestId]
  );

  if (
    existing &&
    cleanText(row.status).toLowerCase() === 'completed'
  ) {
    return {
      ...requestSummary(row),
      overtimeRecord: existing,
      idempotent: true,
    };
  }

  if (cleanText(row.status).toLowerCase() !== 'approved') {
    throw new AppError(
      409,
      'core_employee_request:execute_requires_approval'
    );
  }

  const expectedVersion = Number(input.version ?? row.version);
  if (expectedVersion !== Number(row.version)) {
    throw new AppError(
      409,
      'core_employee_request:version_conflict'
    );
  }

  const payload = parseJson(row.payload_json);
  const date = validDate(payload.date, 'date');
  const startTime = validTime(payload.startTime, 'startTime');
  const endTime = validTime(payload.endTime, 'endTime');
  const requestedMinutes = positiveMinutes(
    payload.requestedMinutes,
    durationMinutes(startTime, endTime)
  );
  const approvedMinutes = positiveMinutes(
    input.approvedMinutes || input.approved_minutes,
    requestedMinutes
  );

  const mode = compensationMode(input);
  const consentAt = cleanText(
    input.employeeConsentAt || input.employee_consent_at
  ) || null;
  const consentReference = cleanText(
    input.employeeConsentReference || input.employee_consent_reference
  ) || null;

  if (mode === 'comp_time' && (!consentAt || !consentReference)) {
    throw new AppError(
      409,
      'core_employee_request:overtime_comp_time_consent_required'
    );
  }
  if (consentAt && !Number.isFinite(Date.parse(consentAt))) {
    throw new AppError(
      400,
      'core_employee_request:invalid_employee_consent_at'
    );
  }

  const sameDay = await dbAll(
    db,
    `SELECT request_id, start_time, end_time
       FROM employee_overtime_records
      WHERE salon_id = ?
        AND employee_id = ?
        AND date_key = ?`,
    [salonId, row.employee_id, date]
  );
  if (
    sameDay.some(
      (item) =>
        cleanText(item.request_id) !== requestId &&
        intervalsOverlap(
          startTime,
          endTime,
          item.start_time,
          item.end_time
        )
    )
  ) {
    throw new AppError(
      409,
      'core_employee_request:overtime_overlap'
    );
  }

  const now = nowIso();
  const recordId = existing?.id || generatedId('overtime');
  const payrollMonth = cleanText(
    input.payrollMonth || input.payroll_month
  ) || date.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    throw new AppError(
      400,
      'core_employee_request:invalid_payroll_month'
    );
  }

  const startedEventId = generatedId('request_event');
  const completedEventId = generatedId('request_event');
  const actorUid = cleanText(actor.uid) || null;
  const actorEmail = cleanText(actor.email) || null;
  const actorName = cleanText(actor.name) || null;
  const actorRole = cleanText(actor.role) || null;
  const note = optionalText(input.note) || null;
  const startVersion = Number(row.version);
  const completedVersion = startVersion + 2;

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_requests
               SET status = 'executing',
                   executing_at = ?,
                   execution_started_at = ?,
                   execution_status = 'running',
                   execution_attempts = execution_attempts + 1,
                   updated_at = ?,
                   updated_by_uid = ?,
                   version = version + 1
             WHERE salon_id = ?
               AND id = ?
               AND status = 'approved'
               AND version = ?`,
      params: [
        now,
        now,
        now,
        actorUid,
        salonId,
        requestId,
        startVersion,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO employee_request_events (
              id, salon_id, request_id, request_number, event_type,
              from_status, to_status, actor_uid, actor_email, actor_name,
              actor_role, note, payload_json, before_json, after_json,
              request_idempotency_key, ip, user_agent, created_at
            )
            SELECT ?, ?, id, request_number, 'execution_started',
                   'approved', 'executing', ?, ?, ?, ?, ?, ?, NULL, NULL,
                   ?, ?, ?, ?
              FROM employee_requests
             WHERE salon_id = ?
               AND id = ?
               AND status = 'executing'
               AND version = ?`,
      params: [
        startedEventId,
        salonId,
        actorUid,
        actorEmail,
        actorName,
        actorRole,
        note,
        JSON.stringify({
          compensationMode: mode,
          financialAuthority: 'actual_attendance_and_canonical_payroll',
        }),
        `overtime_execution_started:${requestId}:${startVersion + 1}`,
        cleanText(actor.ip) || null,
        cleanText(actor.userAgent) || null,
        now,
        salonId,
        requestId,
        startVersion + 1,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO employee_overtime_records (
              id, salon_id, request_id, employee_id, date_key,
              start_time, end_time, requested_minutes, approved_minutes,
              payroll_month, payroll_entry_id, payout_status,
              reason, task_summary, location, approved_by_uid, approved_at,
              created_at, updated_at, compensation_mode,
              employee_consent_at, employee_consent_reference,
              policy_version, actual_worked_minutes,
              attendance_reconciled_at, financial_status
            )
            SELECT ?, ?, ?, employee_id, ?, ?, ?, ?, ?, ?, NULL,
                   'approved', ?, ?, ?, ?, COALESCE(approved_at, ?), ?, ?,
                   ?, ?, ?, ?, 0, NULL, 'pending_attendance'
              FROM employee_requests
             WHERE salon_id = ?
               AND id = ?
               AND status = 'executing'
               AND version = ?`,
      params: [
        recordId,
        salonId,
        requestId,
        date,
        startTime,
        endTime,
        requestedMinutes,
        approvedMinutes,
        payrollMonth,
        cleanText(payload.reason) || null,
        cleanText(payload.taskSummary) || null,
        cleanText(payload.location) || null,
        actorUid,
        now,
        now,
        now,
        mode,
        consentAt,
        consentReference,
        SA_LABOR_POLICY_VERSION,
        salonId,
        requestId,
        startVersion + 1,
      ],
    },
    {
      sql: `UPDATE employee_requests
               SET status = 'completed',
                   source_reference_type = 'overtime',
                   source_reference_id = ?,
                   execution_status = 'completed',
                   execution_completed_at = ?,
                   completed_at = ?,
                   updated_at = ?,
                   updated_by_uid = ?,
                   version = version + 1
             WHERE salon_id = ?
               AND id = ?
               AND status = 'executing'
               AND version = ?
               AND EXISTS (
                 SELECT 1
                   FROM employee_overtime_records overtime
                  WHERE overtime.salon_id = ?
                    AND overtime.request_id = ?
                    AND overtime.id = ?
               )`,
      params: [
        recordId,
        now,
        now,
        now,
        actorUid,
        salonId,
        requestId,
        startVersion + 1,
        salonId,
        requestId,
        recordId,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO employee_request_events (
              id, salon_id, request_id, request_number, event_type,
              from_status, to_status, actor_uid, actor_email, actor_name,
              actor_role, note, payload_json, before_json, after_json,
              request_idempotency_key, ip, user_agent, created_at
            )
            SELECT ?, ?, id, request_number, 'execution_completed',
                   'executing', 'completed', ?, ?, ?, ?, ?, ?, NULL, NULL,
                   ?, ?, ?, ?
              FROM employee_requests
             WHERE salon_id = ?
               AND id = ?
               AND status = 'completed'
               AND version = ?
               AND source_reference_id = ?`,
      params: [
        completedEventId,
        salonId,
        actorUid,
        actorEmail,
        actorName,
        actorRole,
        note,
        JSON.stringify({
          sourceType: 'overtime',
          sourceId: recordId,
          approvedMinutes,
          compensationMode: mode,
          financialStatus: 'pending_attendance',
          payrollAmountCreated: false,
        }),
        `overtime_execution_completed:${requestId}:${completedVersion}`,
        cleanText(actor.ip) || null,
        cleanText(actor.userAgent) || null,
        now,
        salonId,
        requestId,
        completedVersion,
        recordId,
      ],
    },
  ]);

  if (
    changes(results?.[0]) !== 1 ||
    changes(results?.[2]) !== 1 ||
    changes(results?.[3]) !== 1
  ) {
    throw new AppError(
      409,
      'core_employee_request:overtime_execution_concurrency_conflict'
    );
  }

  row = await dbFirst(
    db,
    `SELECT *
       FROM employee_requests
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, requestId]
  );
  const overtimeRecord = await dbFirst(
    db,
    `SELECT *
       FROM employee_overtime_records
      WHERE salon_id = ?
        AND request_id = ?
      LIMIT 1`,
    [salonId, requestId]
  );

  return {
    ...requestSummary(row),
    overtimeRecord,
    financialAuthority: overtimeRequestFinancialAuthority(),
    idempotent: false,
  };
}
