// CORE D1 ONLY — salary certificate requests are sourced from canonical HR data.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';

const REQUEST_TYPE = 'salary_certificate';
const REQUEST_TITLE = 'طلب تعريف بالراتب';
const REQUEST_PREFIX = 'SALCERT';

function json(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizePriority(value) {
  const priority = cleanText(value).toLowerCase();
  return ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
}

function requiredLongText(value, field, max = 1500) {
  const text = cleanText(value);
  if (!text || text.length > max) throw new AppError(400, `core_employee_request:${field}_required`);
  return text;
}

async function resolveEmployee(db, salonId, actor, data = {}) {
  const requestedEmployeeId = cleanText(data.employeeId || data.employee_id || actor.employeeId);
  const requestedUid = cleanText(data.employeeUid || data.employee_uid || actor.uid);
  const row = await dbFirst(
    db,
    `SELECT id, firebase_uid, name, email
       FROM employee_profiles
      WHERE salon_id = ?
        AND (id = ? OR firebase_uid = ? OR firebase_uid = ?)
      LIMIT 1`,
    [salonId, requestedEmployeeId, requestedEmployeeId, requestedUid]
  );
  const employeeId = cleanText(row?.id || requestedEmployeeId);
  if (!employeeId) throw new AppError(409, 'core_employee_request:employee_link_required');
  return {
    employeeId: requiredId(employeeId, 'employeeId'),
    employeeUid: cleanText(row?.firebase_uid || requestedUid) || null,
    employeeName: cleanText(row?.name || data.employeeName || actor.name) || null,
    employeeEmail: cleanText(row?.email || data.employeeEmail || actor.email) || null,
  };
}

async function allocateRequestNumber(db, salonId) {
  const year = Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
  }).format(new Date()));
  const row = await dbFirst(
    db,
    `INSERT INTO employee_request_counters
       (salon_id, request_year, request_type, last_number, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(salon_id, request_year, request_type) DO UPDATE SET
       last_number = employee_request_counters.last_number + 1,
       updated_at = excluded.updated_at
     RETURNING last_number`,
    [salonId, year, REQUEST_TYPE, nowIso()]
  );
  const sequence = Number(row?.last_number || 0);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new AppError(500, 'core_employee_request:number_allocation_failed');
  }
  return `${REQUEST_PREFIX}-${year}-${String(sequence).padStart(6, '0')}`;
}

function requestSummary(row) {
  return {
    ...row,
    payload: parseJson(row?.payload_json, {}),
  };
}

async function insertSubmittedEvent(db, salonId, row, actor, idempotencyKey) {
  const eventId = generatedId('request_event');
  const now = nowIso();
  await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_request_events
      (id, salon_id, request_id, request_number, event_type, from_status, to_status,
       actor_uid, actor_email, actor_name, actor_role, note, payload_json, before_json,
       after_json, request_idempotency_key, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, 'submitted', NULL, 'submitted', ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      eventId,
      salonId,
      row.id,
      row.request_number,
      cleanText(actor.uid) || null,
      cleanText(actor.email) || null,
      cleanText(actor.name) || null,
      cleanText(actor.role) || null,
      json({ requestType: REQUEST_TYPE }),
      `submitted:${idempotencyKey}`,
      cleanText(actor.ip) || null,
      cleanText(actor.userAgent) || null,
      now,
    ]
  );
  return eventId;
}

async function notifyManagement(db, salonId, row, eventId, actorUid) {
  const managers = await dbAll(
    db,
    `SELECT DISTINCT firebase_uid
       FROM app_users
      WHERE salon_id = ?
        AND status = 'active'
        AND primary_role IN ('owner', 'admin', 'hr', 'accountant')
        AND firebase_uid IS NOT NULL`,
    [salonId]
  );
  const now = nowIso();
  for (const manager of managers) {
    const uid = cleanText(manager.firebase_uid);
    if (!uid || uid === cleanText(actorUid)) continue;
    const notificationId = `request_notification_${eventId}_${uid}`.replace(/[^A-Za-z0-9_-]/g, '_');
    await dbRun(
      db,
      `INSERT OR IGNORE INTO notification_records
        (id, salon_id, target_uid, title, body, notification_type, related_type,
         related_id, is_read, read_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'employee_request', 'employee_request', ?, 0, NULL, ?, ?)`,
      [
        notificationId,
        salonId,
        uid,
        `طلب موظفة جديد ${row.request_number}`,
        `${row.employee_name_snapshot || row.employee_id} • ${REQUEST_TITLE}`,
        row.id,
        now,
        now,
      ]
    );
  }
}

export async function createSalaryCertificateRequest(db, salonId, data = {}, actor = {}) {
  const identity = await resolveEmployee(db, salonId, actor, data);
  const rawPayload = parseJson(data.payload ?? data.payload_json ?? data, {});
  const addressee = requiredLongText(rawPayload.addressee, 'salary_certificate_addressee', 250);
  const reason = requiredLongText(rawPayload.reason, 'reason');
  const notes = cleanText(rawPayload.notes);

  const employment = await dbFirst(
    db,
    `SELECT title, job_title, department, start_date, employment_status,
            base_salary_halalas, housing_allowance_halalas,
            transportation_allowance_halalas, other_allowances_halalas
       FROM employee_employment
      WHERE salon_id = ? AND employee_id = ?
      LIMIT 1`,
    [salonId, identity.employeeId]
  );
  if (!employment) throw new AppError(409, 'core_employee_request:employee_employment_required');

  const baseSalaryHalalas = Math.max(0, Math.round(Number(employment.base_salary_halalas || 0)));
  if (baseSalaryHalalas <= 0) throw new AppError(409, 'core_employee_request:employee_salary_required');
  const housingAllowanceHalalas = Math.max(0, Math.round(Number(employment.housing_allowance_halalas || 0)));
  const transportationAllowanceHalalas = Math.max(0, Math.round(Number(employment.transportation_allowance_halalas || 0)));
  const otherAllowancesHalalas = Math.max(0, Math.round(Number(employment.other_allowances_halalas || 0)));
  const allowancesHalalas = housingAllowanceHalalas + transportationAllowanceHalalas + otherAllowancesHalalas;
  const totalSalaryHalalas = baseSalaryHalalas + allowancesHalalas;

  const payload = {
    addressee,
    reason,
    notes,
    employeeNameSnapshot: identity.employeeName,
    jobTitleSnapshot: cleanText(employment.job_title || employment.title) || '—',
    departmentSnapshot: cleanText(employment.department) || '—',
    employmentStartDateSnapshot: cleanText(employment.start_date) || null,
    baseSalaryHalalas,
    housingAllowanceHalalas,
    transportationAllowanceHalalas,
    otherAllowancesHalalas,
    allowancesHalalas,
    totalSalaryHalalas,
    salarySnapshotCapturedAt: nowIso(),
  };

  const idempotencyKey = requiredText(
    data.idempotencyKey || data.idempotency_key,
    'idempotencyKey',
    160
  );
  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_requests
      WHERE salon_id = ? AND idempotency_key = ? LIMIT 1`,
    [salonId, idempotencyKey]
  );
  if (existing) return { ...requestSummary(existing), idempotent: true };

  const requestNumber = await allocateRequestNumber(db, salonId);
  const now = nowIso();
  const row = {
    id: generatedId('employee_request'),
    request_number: requestNumber,
    salon_id: salonId,
    employee_id: identity.employeeId,
    employee_uid: identity.employeeUid,
    employee_name_snapshot: identity.employeeName,
    request_type: REQUEST_TYPE,
    status: 'submitted',
    priority: normalizePriority(data.priority),
    title: cleanText(data.title) || REQUEST_TITLE,
    payload_json: json(payload),
    decision_note: null,
    rejection_reason: null,
    assigned_to_uid: null,
    assigned_to_name: null,
    source_reference_type: null,
    source_reference_id: null,
    execution_status: 'not_started',
    execution_attempts: 0,
    execution_started_at: null,
    execution_completed_at: null,
    execution_error: null,
    external_reference: null,
    idempotency_key: idempotencyKey,
    version: 1,
    submitted_at: now,
    received_at: null,
    reviewed_at: null,
    approved_at: null,
    rejected_at: null,
    executing_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
    created_by_uid: cleanText(actor.uid) || null,
    updated_by_uid: cleanText(actor.uid) || null,
    received_by_uid: null,
    reviewed_by_uid: null,
    decided_by_uid: null,
    cancelled_by_uid: null,
    actual_exit_at: null,
    actual_return_at: null,
    expected_return_at: null,
    final_working_day: null,
  };

  await dbRun(
    db,
    `INSERT INTO employee_requests
      (id, request_number, salon_id, employee_id, employee_uid, employee_name_snapshot,
       request_type, status, priority, title, payload_json, decision_note, rejection_reason,
       assigned_to_uid, assigned_to_name, source_reference_type, source_reference_id,
       execution_status, execution_attempts, execution_started_at, execution_completed_at,
       execution_error, external_reference, idempotency_key, version, submitted_at,
       received_at, reviewed_at, approved_at, rejected_at, executing_at, completed_at,
       cancelled_at, created_at, updated_at, created_by_uid, updated_by_uid, received_by_uid,
       reviewed_by_uid, decided_by_uid, cancelled_by_uid, actual_exit_at, actual_return_at,
       expected_return_at, final_working_day)
     VALUES (${Array.from({ length: 45 }, () => '?').join(', ')})`,
    Object.values(row)
  );

  const eventId = await insertSubmittedEvent(db, salonId, row, actor, idempotencyKey);
  await notifyManagement(db, salonId, row, eventId, actor.uid);
  return requestSummary(row);
}
