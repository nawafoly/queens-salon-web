// CORE D1 ONLY — Firebase is authentication only.

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
  requiredText,
  validDate,
  validTime,
} from '../d1.js';
import { AppError } from '../errors.js';
import { decidePermissionRequest, permissionPayrollSummary } from './permissions.js';
import { createLeave, decideLeave } from './leaves.js';

export const EMPLOYEE_REQUEST_TYPES = new Set([
  'attendance_correction',
  'permission',
  'overtime',
  'salary_advance',
  'exceptional_financial_payment',
  'leave',
  'exit_return',
  'resignation',
]);

const STATUS_TRANSITIONS = {
  submitted: new Set(['received', 'cancelled']),
  received: new Set(['under_review', 'needs_info', 'rejected', 'cancelled']),
  under_review: new Set(['needs_info', 'approved', 'rejected', 'cancelled']),
  needs_info: new Set(['under_review', 'rejected', 'cancelled']),
  approved: new Set(['executing', 'cancelled']),
  executing: new Set(['completed', 'cancelled']),
  completed: new Set(['cancelled']),
  rejected: new Set(['under_review']),
  cancelled: new Set(['under_review']),
};

const TYPE_PREFIX = {
  attendance_correction: 'ATT',
  permission: 'PER',
  overtime: 'OT',
  salary_advance: 'ADV',
  exceptional_financial_payment: 'EFP',
  leave: 'LEV',
  exit_return: 'EXIT',
  resignation: 'RES',
};

const TYPE_TITLE = {
  attendance_correction: 'طلب تصحيح حضور',
  permission: 'طلب استئذان',
  overtime: 'طلب أوفرتايم',
  salary_advance: 'طلب سلفة',
  exceptional_financial_payment: 'طلب تعويض مالي بدل إجازة',
  leave: 'طلب إجازة',
  exit_return: 'طلب خروج وعودة',
  resignation: 'طلب استقالة',
};

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function actorSnapshot(actor = {}) {
  return {
    uid: cleanText(actor.uid),
    email: cleanText(actor.email),
    name: cleanText(actor.name),
    role: cleanText(actor.role),
    ip: cleanText(actor.ip),
    userAgent: cleanText(actor.userAgent),
  };
}

function numberInRange(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AppError(400, `core_employee_request:invalid_${field}`);
  }
  return number;
}

function positiveInteger(value, field, max = 1000000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new AppError(400, `core_employee_request:invalid_${field}`);
  }
  return number;
}

function requiredReason(value, field = 'reason') {
  const reason = cleanText(value);
  if (!reason || reason.length > 1500) throw new AppError(400, `core_employee_request:${field}_required`);
  return reason;
}

function normalizePriority(value) {
  const priority = cleanText(value).toLowerCase();
  return ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
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

function riyadhEventIso(dateKey, timeValue, nextDay = false) {
  const base = new Date(`${dateKey}T${validTime(timeValue)}:00+03:00`);
  if (nextDay) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString();
}

function addMonths(monthKey, offset) {
  const match = /^(\d{4})-(\d{2})$/.exec(cleanText(monthKey));
  if (!match) throw new AppError(400, 'core_employee_request:invalid_payroll_month');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function riyadhDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function normalizeRiyadhDateTime(value, field) {
  const raw = cleanText(value);
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(raw);
  const parsed = Date.parse(local ? `${local[1]}T${local[2]}:00+03:00` : raw);
  if (!Number.isFinite(parsed)) throw new AppError(400, `core_employee_request:invalid_${field}`);
  return new Date(parsed).toISOString();
}

function validatePayload(type, rawPayload) {
  const payload = parseJson(rawPayload, {});
  switch (type) {
    case 'attendance_correction': {
      const correctionType = cleanText(payload.correctionType);
      if (!['add_check_in', 'add_check_out', 'update_check_in', 'update_check_out', 'delete_record'].includes(correctionType)) {
        throw new AppError(400, 'core_employee_request:invalid_correction_type');
      }
      const date = validDate(payload.date, 'date');
      const requestedTime = correctionType === 'delete_record' ? null : validTime(payload.requestedTime, 'requestedTime');
      return {
        ...payload,
        date,
        correctionType,
        currentTime: cleanText(payload.currentTime) ? validTime(payload.currentTime, 'currentTime') : '',
        requestedTime,
        reason: requiredReason(payload.reason),
        recordId: cleanText(payload.recordId),
        notes: cleanText(payload.notes),
      };
    }
    case 'permission': {
      const date = validDate(payload.date, 'date');
      const startTime = validTime(payload.startTime, 'startTime');
      const endTime = validTime(payload.endTime, 'endTime');
      if (durationMinutes(startTime, endTime) <= 0) throw new AppError(400, 'core_employee_request:invalid_permission_duration');
      return { ...payload, date, startTime, endTime, reason: requiredReason(payload.reason), notes: cleanText(payload.notes) };
    }
    case 'overtime': {
      const date = validDate(payload.date, 'date');
      const startTime = validTime(payload.startTime, 'startTime');
      const endTime = validTime(payload.endTime, 'endTime');
      const requestedMinutes = durationMinutes(startTime, endTime);
      if (requestedMinutes < 15 || requestedMinutes > 16 * 60) throw new AppError(400, 'core_employee_request:invalid_overtime_duration');
      return {
        ...payload, date, startTime, endTime, requestedMinutes,
        reason: requiredReason(payload.reason),
        taskSummary: requiredReason(payload.taskSummary, 'task_summary'),
        location: cleanText(payload.location),
        requestedByManager: cleanText(payload.requestedByManager),
      };
    }
    case 'salary_advance': {
      const amountHalalas = positiveInteger(payload.amountHalalas ?? Math.round(Number(payload.amount || 0) * 100), 'amount', 10_000_000);
      const repaymentMethod = cleanText(payload.repaymentMethod) === 'installments' ? 'installments' : 'single';
      const installmentCount = repaymentMethod === 'installments' ? positiveInteger(payload.installmentCount, 'installment_count', 24) : 1;
      const neededDate = validDate(payload.neededDate, 'neededDate');
      return {
        ...payload, amountHalalas, repaymentMethod, installmentCount, neededDate,
        reason: requiredReason(payload.reason), acknowledgement: payload.acknowledgement === true,
      };
    }
    case 'exceptional_financial_payment': {
    const requestedDays = numberInRange(payload.requestedDays, 'requested_days', 0.5, 60);
    if (Math.round(requestedDays * 2) !== requestedDays * 2) {
      throw new AppError(400, 'core_employee_request:invalid_requested_days');
    }
    if (payload.acknowledgement !== true) {
      throw new AppError(400, 'core_employee_request:financial_payment_acknowledgement_required');
    }
    const signature = cleanText(payload.employeeSignatureDataUrl);
    if (!signature.startsWith('data:image/') || !signature.includes(';base64,') || signature.length < 200) {
      throw new AppError(400, 'core_employee_request:financial_payment_signature_required');
    }
    return {
      ...payload,
      requestedDays,
      reason: requiredReason(payload.reason),
      notes: cleanText(payload.notes),
      acknowledgement: true,
      employeeSignatureDataUrl: signature,
      balanceType: 'annual_leave',
      deductAnnualLeave: true,
    };
  }
    case 'leave': {
      const startDate = validDate(payload.startDate, 'startDate');
      const endDate = validDate(payload.endDate, 'endDate');
      if (endDate < startDate) throw new AppError(400, 'core_employee_request:invalid_leave_range');
      const durationKind = cleanText(payload.durationKind) === 'partial' ? 'partial' : 'full_day';
      const partialStartTime = durationKind === 'partial' ? validTime(payload.partialStartTime, 'partialStartTime') : null;
      const partialEndTime = durationKind === 'partial' ? validTime(payload.partialEndTime, 'partialEndTime') : null;
      if (durationKind === 'partial' && startDate !== endDate) throw new AppError(400, 'core_employee_request:partial_leave_single_day');
      if (durationKind === 'partial' && durationMinutes(partialStartTime, partialEndTime) > 8 * 60) throw new AppError(400, 'core_employee_request:partial_leave_too_long');
      return {
        ...payload, startDate, endDate,
        leaveType: cleanText(payload.leaveType) || 'annual',
        durationKind, partialStartTime, partialEndTime,
        reason: requiredReason(payload.reason),
        contactDuringLeave: cleanText(payload.contactDuringLeave),
      };
    }
    case 'exit_return': {
      const expectedExitAt = normalizeRiyadhDateTime(payload.expectedExitAt, 'expected_exit_at');
      const expectedReturnAt = normalizeRiyadhDateTime(payload.expectedReturnAt, 'expected_return_at');
      if (Date.parse(expectedReturnAt) <= Date.parse(expectedExitAt)) {
        throw new AppError(400, 'core_employee_request:invalid_exit_return_range');
      }
      return {
        ...payload, expectedExitAt, expectedReturnAt,
        reason: requiredReason(payload.reason), destination: requiredReason(payload.destination, 'destination'),
        contactMethod: requiredReason(payload.contactMethod, 'contact_method'), notes: cleanText(payload.notes),
      };
    }
    case 'resignation': {
      const submissionDate = validDate(payload.submissionDate || riyadhDateKey(), 'submissionDate');
      const proposedLastWorkingDay = validDate(payload.proposedLastWorkingDay, 'proposedLastWorkingDay');
      if (proposedLastWorkingDay < submissionDate) throw new AppError(400, 'core_employee_request:invalid_last_working_day');
      return {
        ...payload, submissionDate, proposedLastWorkingDay,
        noticeDays: Number.isFinite(Number(payload.noticeDays)) ? Math.max(0, Math.min(365, Number(payload.noticeDays))) : 0,
        reason: requiredReason(payload.reason), hasAssetsToReturn: payload.hasAssetsToReturn === true,
        acknowledgement: payload.acknowledgement === true, notes: cleanText(payload.notes),
      };
    }
    default:
      throw new AppError(400, 'core_employee_request:invalid_type');
  }
}

async function resolveEmployee(db, salonId, actor, data = {}) {
  const requestedEmployeeId = cleanText(data.employeeId || data.employee_id || actor.employeeId);
  const requestedUid = cleanText(data.employeeUid || data.employee_uid || actor.uid);
  const row = await dbFirst(
    db,
    `SELECT id, firebase_uid, name, email FROM employee_profiles
      WHERE salon_id = ? AND (id = ? OR firebase_uid = ? OR firebase_uid = ?) LIMIT 1`,
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

async function allocateRequestNumber(db, salonId, type) {
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Riyadh', year: 'numeric' }).format(new Date()));
  const row = await dbFirst(
    db,
    `INSERT INTO employee_request_counters (salon_id, request_year, request_type, last_number, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(salon_id, request_year, request_type) DO UPDATE SET
       last_number = employee_request_counters.last_number + 1,
       updated_at = excluded.updated_at
     RETURNING last_number`,
    [salonId, year, type, nowIso()]
  );
  const sequence = Number(row?.last_number || 0);
  if (!Number.isInteger(sequence) || sequence < 1) throw new AppError(500, 'core_employee_request:number_allocation_failed');
  return `${TYPE_PREFIX[type]}-${year}-${String(sequence).padStart(6, '0')}`;
}

async function getRow(db, salonId, idValue) {
  const id = requiredId(idValue, 'requestId');
  const row = await dbFirst(db, 'SELECT * FROM employee_requests WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!row) throw new AppError(404, 'core_employee_request:not_found');
  return row;
}

function assertOwner(row, actor) {
  const sameUid = cleanText(row.employee_uid) && cleanText(row.employee_uid) === cleanText(actor.uid);
  const sameEmployee = cleanText(row.employee_id) && cleanText(row.employee_id) === cleanText(actor.employeeId);
  if (!sameUid && !sameEmployee) throw new AppError(403, 'core_employee_request:not_owner');
}

async function insertEvent(db, salonId, row, input, actor = {}) {
  const snapshot = actorSnapshot(actor);
  const eventId = generatedId('request_event');
  const eventKey = cleanText(input.idempotencyKey) || `${input.eventType}:${row.version}:${snapshot.uid || 'system'}`;
  await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_request_events
      (id, salon_id, request_id, request_number, event_type, from_status, to_status,
       actor_uid, actor_email, actor_name, actor_role, note, payload_json, before_json,
       after_json, request_idempotency_key, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId, salonId, row.id, row.request_number, input.eventType,
      input.fromStatus || null, input.toStatus || null,
      snapshot.uid || null, snapshot.email || null, snapshot.name || null, snapshot.role || null,
      optionalText(input.note) || null, json(input.payload || {}),
      input.before === undefined ? null : json(input.before),
      input.after === undefined ? null : json(input.after),
      eventKey, snapshot.ip || null, snapshot.userAgent || null, nowIso(),
    ]
  );
  const stored = await dbFirst(
    db,
    `SELECT id FROM employee_request_events
      WHERE salon_id = ? AND request_id = ? AND request_idempotency_key = ? LIMIT 1`,
    [salonId, row.id, eventKey]
  );
  return cleanText(stored?.id) || eventId;
}

async function insertNotification(db, salonId, targetUid, input) {
  const uid = cleanText(targetUid);
  if (!uid || uid === cleanText(input.actorUid)) return;
  const id = `request_notification_${cleanText(input.eventId)}_${uid}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const now = nowIso();
  await dbRun(
    db,
    `INSERT OR IGNORE INTO notification_records
      (id, salon_id, target_uid, title, body, notification_type, related_type,
       related_id, is_read, read_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'employee_request', 'employee_request', ?, 0, NULL, ?, ?)`,
    [id, salonId, uid, input.title, optionalText(input.body) || null, input.requestId, now, now]
  );
}

async function managementUids(db, salonId) {
  const rows = await dbAll(
    db,
    `SELECT DISTINCT au.firebase_uid
       FROM app_users au
      WHERE au.salon_id = ? AND au.status = 'active'
        AND au.primary_role IN ('owner', 'admin', 'hr', 'accountant')
        AND au.firebase_uid IS NOT NULL`,
    [salonId]
  );
  return rows.map((row) => cleanText(row.firebase_uid)).filter(Boolean);
}

async function notifyManagement(db, salonId, row, eventId, title, body, actorUid) {
  for (const uid of await managementUids(db, salonId)) {
    await insertNotification(db, salonId, uid, { eventId, title, body, requestId: row.id, actorUid });
  }
}

async function notifyEmployee(db, salonId, row, eventId, title, body, actorUid) {
  await insertNotification(db, salonId, row.employee_uid, { eventId, title, body, requestId: row.id, actorUid });
}

async function insertConversationMessage(db, salonId, row, bodyValue, visibility, actor = {}, idempotencyKeyValue) {
  const body = requiredReason(bodyValue, 'comment');
  const idempotencyKey = requiredText(idempotencyKeyValue, 'idempotencyKey', 300);
  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_request_comments
      WHERE salon_id = ? AND request_id = ? AND idempotency_key = ? LIMIT 1`,
    [salonId, row.id, idempotencyKey]
  );
  if (existing) return existing;
  const now = nowIso();
  const comment = {
    id: generatedId('request_comment'), salon_id: salonId, request_id: row.id,
    author_uid: cleanText(actor.uid) || null, author_name: cleanText(actor.name) || null,
    author_role: cleanText(actor.role) || null, visibility, body, idempotency_key: idempotencyKey,
    created_at: now, updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO employee_request_comments
      (id, salon_id, request_id, author_uid, author_name, author_role, visibility, body,
       idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Object.values(comment)
  );
  return comment;
}

function requestSummary(row) {
  return {
    ...row,
    payload: parseJson(row.payload_json, {}),
  };
}

export async function listEmployeeRequests(db, salonId, query = {}, actor = {}, options = {}) {
  const clauses = ['salon_id = ?'];
  const params = [salonId];
  if (options.ownOnly) {
    const employeeId = cleanText(actor.employeeId);
    const uid = cleanText(actor.uid);
    if (!employeeId && !uid) return [];
    clauses.push('(employee_id = ? OR employee_uid = ?)');
    params.push(employeeId, uid);
  } else {
    const employeeId = cleanText(query.employeeId || query.employee_id);
    if (employeeId) { clauses.push('employee_id = ?'); params.push(employeeId); }
    const assignee = cleanText(query.assignedToUid || query.assigned_to_uid);
    if (assignee) { clauses.push('assigned_to_uid = ?'); params.push(assignee); }
  }
  const type = cleanText(query.type || query.requestType || query.request_type);
  const status = cleanText(query.status);
  const branch = cleanText(query.branch);
  const overdue = ['1', 'true', 'yes'].includes(cleanText(query.overdue).toLowerCase());
  const fromDate = cleanText(query.from || query.fromDate);
  const toDate = cleanText(query.to || query.toDate);
  if (type) { clauses.push('request_type = ?'); params.push(type); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (branch) { clauses.push("COALESCE(json_extract(payload_json, '$.location'), json_extract(payload_json, '$.branch'), '') = ?"); params.push(branch); }
  if (overdue) { clauses.push("status NOT IN ('completed', 'rejected', 'cancelled') AND updated_at < datetime('now', '-2 days')"); }
  if (fromDate) { clauses.push('created_at >= ?'); params.push(`${validDate(fromDate)}T00:00:00.000Z`); }
  if (toDate) { clauses.push('created_at <= ?'); params.push(`${validDate(toDate)}T23:59:59.999Z`); }
  const limit = Math.min(500, Math.max(1, Number(query.limit || 100) || 100));
  const rows = await dbAll(
    db,
    `SELECT * FROM employee_requests WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit}`,
    params
  );
  return rows.map(requestSummary);
}

export async function getEmployeeRequest(db, salonId, idValue, actor = {}, options = {}) {
  const row = await getRow(db, salonId, idValue);
  if (options.ownOnly) assertOwner(row, actor);
  const [events, comments, attachments] = await Promise.all([
    dbAll(db, 'SELECT * FROM employee_request_events WHERE salon_id = ? AND request_id = ? ORDER BY created_at', [salonId, row.id]),
    dbAll(
      db,
      `SELECT * FROM employee_request_comments WHERE salon_id = ? AND request_id = ?
       ${options.ownOnly ? "AND visibility = 'employee'" : ''} ORDER BY created_at`,
      [salonId, row.id]
    ),
    dbAll(db, 'SELECT * FROM employee_request_attachments WHERE salon_id = ? AND request_id = ? ORDER BY created_at', [salonId, row.id]),
  ]);
  return { ...requestSummary(row), events, comments, attachments };
}

export async function getExceptionalFinancialPaymentPreview(
  db,
  salonId,
  employeeId,
  requestedDaysInput
) {
  const requestedDays = numberInRange(
    requestedDaysInput,
    'requested_days',
    0.5,
    60
  );

  if (Math.round(requestedDays * 2) !== requestedDays * 2) {
    throw new AppError(
      400,
      'core_employee_request:invalid_requested_days'
    );
  }

  const employment = await dbFirst(
    db,
    `SELECT base_salary_halalas, leave_balance
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );

  const baseSalaryHalalas = Number(
    employment?.base_salary_halalas || 0
  );

  if (
    !Number.isFinite(baseSalaryHalalas) ||
    baseSalaryHalalas <= 0
  ) {
    throw new AppError(
      409,
      'core_employee_request:employee_salary_required'
    );
  }

  const annualLeaveBalance = Math.max(
    0,
    Number(employment?.leave_balance || 0)
  );

  const dayRateHalalas = Math.round(
    baseSalaryHalalas / 30
  );

  const calculatedAmountHalalas = Math.round(
    (baseSalaryHalalas * requestedDays) / 30
  );

  return {
    requestedDays,
    baseSalaryHalalas,
    dayRateHalalas,
    calculatedAmountHalalas,
    annualLeaveBalance,
    enoughLeaveBalance:
      annualLeaveBalance >= requestedDays,
  };
}

export async function createEmployeeRequest(db, salonId, data, actor = {}) {
  const type = cleanText(data.requestType || data.request_type).toLowerCase();
  if (!EMPLOYEE_REQUEST_TYPES.has(type)) throw new AppError(400, 'core_employee_request:invalid_type');
  const identity = await resolveEmployee(db, salonId, actor, data);
  let payload = validatePayload(type, data.payload || data.payload_json || data);
  if (type === 'exceptional_financial_payment') {
    const employment = await dbFirst(
      db,
      `SELECT base_salary_halalas, leave_balance, employment_status FROM employee_employment
        WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
      [salonId, identity.employeeId]
    );
    const baseSalaryHalalas = Math.max(0, Math.round(Number(employment?.base_salary_halalas || 0)));
    if (!employment || baseSalaryHalalas <= 0) {
      throw new AppError(409, 'core_employee_request:employee_salary_required');
    }
    const dayRateHalalas = Math.max(1, Math.round(baseSalaryHalalas / 30));
    const calculatedAmountHalalas = Math.max(1, Math.round((baseSalaryHalalas * Number(payload.requestedDays)) / 30));
    const annualLeaveBalanceSnapshot = Math.max(0, Number(employment.leave_balance || 0));
    if (annualLeaveBalanceSnapshot < Number(payload.requestedDays)) {
      throw new AppError(409, 'core_employee_request:insufficient_annual_leave_balance');
    }
    payload = {
      ...payload,
      baseSalaryHalalas,
      dayRateHalalas,
      calculatedAmountHalalas,
      annualLeaveBalanceSnapshot,
      balanceDeductionDays: Number(payload.requestedDays),
      calculationBasis: 'base_salary_divided_by_30',
      payrollTreatment: 'manual_addition',
      leaveBalanceTreatment: 'deduct_on_execution',
    };
  }
  const idempotencyKey = cleanText(data.idempotencyKey || data.idempotency_key);
  if (!idempotencyKey || idempotencyKey.length > 160) throw new AppError(400, 'core_employee_request:idempotency_required');
  const existing = await dbFirst(db, 'SELECT * FROM employee_requests WHERE salon_id = ? AND idempotency_key = ? LIMIT 1', [salonId, idempotencyKey]);
  if (existing) return { ...requestSummary(existing), idempotent: true };
  const requestNumber = await allocateRequestNumber(db, salonId, type);
  const now = nowIso();
  const row = {
    id: generatedId('employee_request'), request_number: requestNumber, salon_id: salonId,
    employee_id: identity.employeeId, employee_uid: identity.employeeUid,
    employee_name_snapshot: identity.employeeName, request_type: type, status: 'submitted',
    priority: normalizePriority(data.priority), title: cleanText(data.title) || TYPE_TITLE[type],
    payload_json: json(payload), decision_note: null, rejection_reason: null,
    assigned_to_uid: null, assigned_to_name: null, source_reference_type: null, source_reference_id: null,
    execution_status: 'not_started', execution_attempts: 0, execution_started_at: null,
    execution_completed_at: null, execution_error: null, external_reference: null,
    idempotency_key: idempotencyKey, version: 1, submitted_at: now, received_at: null,
    reviewed_at: null, approved_at: null, rejected_at: null, executing_at: null,
    completed_at: null, cancelled_at: null, created_at: now, updated_at: now,
    created_by_uid: cleanText(actor.uid) || null, updated_by_uid: cleanText(actor.uid) || null,
    received_by_uid: null, reviewed_by_uid: null, decided_by_uid: null, cancelled_by_uid: null,
    actual_exit_at: null, actual_return_at: null,
    expected_return_at: type === 'exit_return' ? payload.expectedReturnAt : null,
    final_working_day: type === 'resignation' ? payload.proposedLastWorkingDay : null,
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
  const eventId = await insertEvent(db, salonId, row, {
    eventType: 'submitted', toStatus: 'submitted', note: cleanText(data.note),
    payload: { requestType: type }, idempotencyKey: `submitted:${idempotencyKey}`,
  }, actor);
  await notifyManagement(
    db, salonId, row, eventId, `طلب موظفة جديد ${requestNumber}`,
    `${identity.employeeName || identity.employeeId} • ${TYPE_TITLE[type]}`, cleanText(actor.uid)
  );
  return requestSummary(row);
}

function assertTransition(fromStatus, toStatus) {
  const allowed = STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) throw new AppError(409, 'core_employee_request:invalid_transition');
}

async function updateStatus(db, salonId, row, toStatus, input, actor) {
  assertTransition(row.status, toStatus);
  const now = nowIso();
  const version = Number(input.version ?? row.version);
  if (version !== Number(row.version)) throw new AppError(409, 'core_employee_request:version_conflict');
  const columns = {
    status: toStatus, updated_at: now, updated_by_uid: cleanText(actor.uid) || null,
    version: Number(row.version) + 1,
  };
  if (toStatus === 'received') Object.assign(columns, { received_at: now, received_by_uid: cleanText(actor.uid) || null });
  if (toStatus === 'under_review') Object.assign(columns, { reviewed_at: now, reviewed_by_uid: cleanText(actor.uid) || null });
  if (toStatus === 'approved') Object.assign(columns, { approved_at: now, decided_by_uid: cleanText(actor.uid) || null, decision_note: optionalText(input.note) || null });
  if (toStatus === 'rejected') Object.assign(columns, { rejected_at: now, decided_by_uid: cleanText(actor.uid) || null, rejection_reason: requiredReason(input.reason || input.note, 'rejection_reason') });
  if (toStatus === 'executing') Object.assign(columns, { executing_at: now, execution_started_at: now, execution_status: 'running', execution_attempts: Number(row.execution_attempts || 0) + 1 });
  if (toStatus === 'completed') Object.assign(columns, { completed_at: now, execution_completed_at: now, execution_status: 'completed', execution_error: null });
  if (toStatus === 'cancelled') Object.assign(columns, { cancelled_at: now, cancelled_by_uid: cleanText(actor.uid) || null, execution_status: ['executing', 'completed'].includes(row.status) || row.execution_status === 'running' ? 'cancelled' : row.execution_status });
  const entries = Object.entries(columns);
  const updatedSnapshot = { ...row, ...columns };
  const snapshot = actorSnapshot(actor);
  const eventId = generatedId('request_event');
  const eventKey = cleanText(input.idempotencyKey) || `${toStatus}:${updatedSnapshot.version}`;
  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_requests SET ${entries.map(([key]) => `${key} = ?`).join(', ')}
        WHERE salon_id = ? AND id = ? AND version = ?`,
      params: [...entries.map(([, value]) => value), salonId, row.id, row.version],
    },
    {
      sql: `INSERT OR IGNORE INTO employee_request_events
        (id, salon_id, request_id, request_number, event_type, from_status, to_status,
         actor_uid, actor_email, actor_name, actor_role, note, payload_json, before_json,
         after_json, request_idempotency_key, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        eventId, salonId, row.id, row.request_number, input.eventType || toStatus,
        row.status, toStatus, snapshot.uid || null, snapshot.email || null,
        snapshot.name || null, snapshot.role || null,
        optionalText(input.note || input.reason) || null, json(input.payload || {}),
        json(requestSummary(row)), json(requestSummary(updatedSnapshot)), eventKey,
        snapshot.ip || null, snapshot.userAgent || null, now,
      ],
    },
  ]);
  if (changes(results?.[0]) !== 1) throw new AppError(409, 'core_employee_request:version_conflict');
  const updated = await getRow(db, salonId, row.id);
  return { updated, eventId };
}

async function refreshPermissionPayrollEntries(db, salonId, employeeId, dateKey) {
  const entries = await dbAll(
    db,
    `SELECT pe.id, pe.payroll_month,
       COALESCE(pp.month_start, pe.payroll_month || '-01') AS period_start,
       COALESCE(pp.month_end, date(pe.payroll_month || '-01', '+1 month', '-1 day')) AS period_end
       FROM payroll_entries pe
       LEFT JOIN payroll_periods pp ON pp.salon_id = pe.salon_id
        AND (pp.id = pe.period_id OR pp.payroll_month = pe.payroll_month)
      WHERE pe.salon_id = ? AND pe.employee_id = ?
        AND COALESCE(pe.status, 'draft') NOT IN ('approved', 'paid')`,
    [salonId, employeeId]
  );
  for (const entry of entries) {
    if (dateKey < entry.period_start || dateKey > entry.period_end) continue;
    const summary = await permissionPayrollSummary(db, salonId, {
      employeeId, from: entry.period_start, to: entry.period_end,
    });
    await dbRun(
      db,
      `UPDATE payroll_entries SET permission_minutes = ?, unpaid_permission_minutes = ?,
       permission_entries_json = ?, updated_at = ? WHERE salon_id = ? AND id = ?`,
      [summary.permissionMinutes, summary.unpaidPermissionMinutes, json(summary.entries), nowIso(), salonId, entry.id]
    );
  }
}

async function createPermissionEffect(db, salonId, row, payload, actor) {
  const existing = await dbFirst(db,
    'SELECT * FROM employee_permission_requests WHERE salon_id = ? AND (id = ? OR employee_request_id = ?) LIMIT 1',
    [salonId, row.source_reference_id || '', row.id]
  );
  if (existing) return existing.id;
  const permissionRows = await dbAll(
    db,
    `SELECT id, requested_exit_time, expected_return_time FROM employee_permission_requests
      WHERE salon_id = ? AND employee_id = ? AND date_key = ?
        AND status IN ('approved', 'out', 'returned')`,
    [salonId, row.employee_id, payload.date]
  );
  if (permissionRows.some((item) => item.expected_return_time && intervalsOverlap(payload.startTime, payload.endTime, item.requested_exit_time, item.expected_return_time))) {
    throw new AppError(409, 'core_employee_request:permission_overlap');
  }
  const id = generatedId('permission');
  const bookingLeaveId = "permission_leave_" + id.replace(/[^A-Za-z0-9_-]/g, "_");
  const now = nowIso();
  const minutes = durationMinutes(payload.startTime, payload.endTime);
  await dbBatch(db, [
    {
      sql: `INSERT INTO employee_permission_requests
        (id, salon_id, employee_id, employee_uid, employee_name, date_key,
         requested_exit_time, expected_return_time, actual_exit_time, actual_return_time,
         reason, note, source, status, financial_effect, duration_minutes, unpaid_minutes,
         created_by_uid, created_by_name, reviewer_uid, reviewer_name, returned_by_uid,
         returned_by_name, reviewed_at, exited_at, returned_at, created_at, updated_at, employee_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee_request', 'approved', 'none', 0, 0,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, salonId, row.employee_id, row.employee_uid, row.employee_name_snapshot, payload.date,
        payload.startTime, payload.endTime, NULL, NULL,
        payload.reason, optionalText(payload.notes) || null,
        row.created_by_uid, row.employee_name_snapshot, cleanText(actor.uid) || null,
        cleanText(actor.name) || null, NULL, NULL,
        now, NULL, NULL, now, now, row.id,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO employee_leaves
        (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status,
         leave_type, start_date, end_date, days_count, employee_note, hr_note, decided_at,
         decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at,
         duration_kind, partial_start_time, partial_end_time, request_id)
       VALUES (?, ?, ?, ?, ?, NULL, 'approved', 'permission', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?, ?)`,
      params: [
        bookingLeaveId, salonId, row.employee_id, row.employee_uid, row.employee_name_snapshot,
        payload.date, payload.date, payload.reason, 'استئذان معتمد — يحجب فترة الحجز المحددة فقط',
        now, cleanText(actor.uid) || null, cleanText(actor.email) || null, cleanText(actor.name) || null,
        now, now, payload.startTime, payload.endTime, id,
      ],
    },
  ]);
  return id;
}

function employeeRequestLeavePolicy(payload) {
  const leaveType = cleanText(
    payload.leaveType
  ).toLowerCase();

  const partial =
    cleanText(
      payload.durationKind
    ).toLowerCase() === 'partial';

  return {
    deductFromBalance:
      !partial &&
      (
        leaveType === 'annual' ||
        leaveType === 'sick' ||
        leaveType === 'emergency'
      ),

    affectsPayroll:
      !partial &&
      leaveType === 'unpaid',
  };
}


async function createLeaveEffect(
  db,
  salonId,
  row,
  payload,
  actor,
  options = {}
) {
  let leave = await dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND request_id = ?
      LIMIT 1`,
    [salonId, row.id]
  );

  const existingLeaveStatus = cleanText(
    leave?.status
  ).toLowerCase();

  if (
    leave &&
    !['pending', 'approved'].includes(
      existingLeaveStatus
    )
  ) {
    throw new AppError(
      409,
      'core_employee_request:leave_effect_invalid_status'
    );
  }

  // A retry may arrive after the canonical leave was already
  // approved but before a partial-leave permission effect was
  // created. Do not return early: finish the missing idempotent
  // permission effect below. For a fresh/pending leave, still
  // enforce overlap before approval.
  if (existingLeaveStatus !== 'approved') {
    const overlap = await dbFirst(
      db,
      `SELECT id
         FROM employee_leaves
        WHERE salon_id = ?
          AND employee_id = ?
          AND status = 'approved'
          AND NOT (
            end_date < ?
            OR start_date > ?
          )
        LIMIT 1`,
      [
        salonId,
        row.employee_id,
        payload.startDate,
        payload.endDate,
      ]
    );

    if (overlap) {
      throw new AppError(
        409,
        'core_employee_request:leave_overlap'
      );
    }
  }


  const startDate = new Date(
    `${payload.startDate}T12:00:00Z`
  );

  const endDate = new Date(
    `${payload.endDate}T12:00:00Z`
  );

  const fullDays =
    Math.floor(
      (
        endDate.getTime() -
        startDate.getTime()
      ) / 86400000
    ) + 1;

  const partial =
    cleanText(
      payload.durationKind
    ).toLowerCase() === 'partial';

  const partialMinutes =
    partial
      ? durationMinutes(
          payload.partialStartTime,
          payload.partialEndTime
        )
      : 0;

  const days =
    partial
      ? Math.max(
          0.125,
          Math.round(
            (
              partialMinutes /
              (8 * 60)
            ) * 1000
          ) / 1000
        )
      : fullDays;

  const policy =
    employeeRequestLeavePolicy(
      payload
    );

  let createdHere = false;

  if (!leave) {
    leave = await createLeave(
      db,
      salonId,
      {
        id: generatedId('leave'),

        employeeId:
          row.employee_id,

        employeeUid:
          row.employee_uid,

        employeeName:
          row.employee_name_snapshot,

        status: 'pending',

        leaveType:
          cleanText(
            payload.leaveType
          ) || 'annual',

        startDate:
          payload.startDate,

        endDate:
          payload.endDate,

        daysCount: days,

        durationKind:
          partial
            ? 'partial'
            : 'full_day',

        partialStartTime:
          partial
            ? payload.partialStartTime
            : null,

        partialEndTime:
          partial
            ? payload.partialEndTime
            : null,

        requestId:
          row.id,

        deductFromBalance:
          policy.deductFromBalance,

        affectsPayroll:
          policy.affectsPayroll,

        employeeNote:
          payload.reason,

        hrNote:
          optionalText(
            payload.hrNote
          ) || null,
      },
      actor
    );

    createdHere = true;
  }


  try {
    if (
      ['pending', 'approved'].includes(
        cleanText(leave.status).toLowerCase()
      )
    ) {
      const decisionResult = await decideLeave(
        db,
        salonId,
        leave.id,
        {
          status: 'approved',
          hrNote:
            optionalText(
              payload.hrNote
            ) ||
            'اعتماد طلب الإجازة من نظام الطلبات',
          ...(options.leaveDecision || {}),
        },
        actor,
        options
      );

      leave = decisionResult?.leave || decisionResult;
    }
  } catch (error) {
    // If this execution created the pending row and
    // canonical approval failed (for example insufficient
    // balance), remove only that untouched pending row.
    //
    // decideLeave owns balance atomicity, so no balance
    // mutation exists when approval fails.
    if (createdHere) {
      await dbRun(
        db,
        `DELETE FROM employee_leaves
          WHERE salon_id = ?
            AND id = ?
            AND request_id = ?
            AND status = 'pending'
            AND balance_adjustment_id IS NULL`,
        [
          salonId,
          leave.id,
          row.id,
        ]
      );
    }

    throw error;
  }


  let permissionId = null;

  if (partial) {
    permissionId =
      await createPermissionEffect(
        db,
        salonId,
        row,
        {
          date:
            payload.startDate,

          startTime:
            payload.partialStartTime,

          endTime:
            payload.partialEndTime,

          reason:
            `إجازة جزئية: ${payload.reason}`,

          notes:
            payload.notes || '',
        },
        actor
      );
  }


  return {
    leaveId: leave.id,
    permissionId,
    days,
  };
}

function externalAttendanceRecordId(value) {
  return cleanText(value).replace(/^malikat:/, '');
}

async function findExternalAttendanceRecord(externalDb, row, payload, recordType) {
  if (!externalDb) return null;
  const recordId = externalAttendanceRecordId(payload.recordId);
  if (recordId) {
    const found = await dbFirst(
      externalDb,
      `SELECT * FROM attendance_records
        WHERE id = ? AND (employee_doc_id = ? OR employee_uid = ?) LIMIT 1`,
      [recordId, row.employee_id, row.employee_uid || '']
    );
    if (found) return found;
  }
  if (!payload.currentTime) return null;
  const target = new Date(`${payload.date}T${payload.currentTime}:00+03:00`).toISOString();
  return dbFirst(
    externalDb,
    `SELECT * FROM attendance_records
      WHERE result = 'allowed' AND type = ?
        AND (employee_doc_id = ? OR employee_uid = ?)
        AND date(server_time, '+3 hours') = ?
      ORDER BY ABS(strftime('%s', server_time) - strftime('%s', ?))
      LIMIT 1`,
    [recordType, row.employee_id, row.employee_uid || '', payload.date, target]
  );
}

async function refreshExternalAttendanceState(externalDb, row, dateKey) {
  if (!externalDb || !cleanText(row.employee_uid)) return;
  const latest = await dbFirst(
    externalDb,
    `SELECT * FROM attendance_records
      WHERE employee_uid = ? AND result = 'allowed' AND type IN ('check_in', 'check_out')
      ORDER BY server_time DESC, id DESC LIMIT 1`,
    [row.employee_uid]
  );
  if (latest) {
    await dbRun(
      externalDb,
      `INSERT INTO attendance_state
        (employee_uid, employee_doc_id, status, last_type, last_record_id, last_server_time,
         last_location_lat, last_location_lng, last_location_accuracy, last_zone_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_uid) DO UPDATE SET
        employee_doc_id = excluded.employee_doc_id, status = excluded.status,
        last_type = excluded.last_type, last_record_id = excluded.last_record_id,
        last_server_time = excluded.last_server_time, last_location_lat = excluded.last_location_lat,
        last_location_lng = excluded.last_location_lng,
        last_location_accuracy = excluded.last_location_accuracy,
        last_zone_id = excluded.last_zone_id, updated_at = excluded.updated_at`,
      [
        row.employee_uid,
        row.employee_id,
        latest.type === 'check_in' ? 'checked_in' : 'checked_out',
        latest.type,
        latest.id,
        latest.server_time,
        latest.location_lat,
        latest.location_lng,
        latest.location_accuracy,
        latest.zone_id || null,
        nowIso(),
      ]
    );
  } else {
    await dbRun(externalDb, 'DELETE FROM attendance_state WHERE employee_uid = ?', [row.employee_uid]);
  }
  await dbRun(
    externalDb,
    `DELETE FROM attendance_monthly_summaries
      WHERE (employee_uid = ? OR employee_doc_id = ?) AND year_month = ?`,
    [row.employee_uid, row.employee_id, cleanText(dateKey).slice(0, 7)]
  );
}

async function executeExternalAttendanceCorrection(externalDb, row, payload, actor) {
  const recordType = payload.correctionType.includes('check_in') ? 'check_in' : 'check_out';
  const before = await findExternalAttendanceRecord(externalDb, row, payload, recordType);
  if (payload.correctionType === 'delete_record') {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    await dbRun(
      externalDb,
      'DELETE FROM attendance_state WHERE employee_uid = ? AND last_record_id = ?',
      [row.employee_uid || before.employee_uid, before.id]
    );
    await dbRun(externalDb, 'DELETE FROM attendance_records WHERE id = ?', [before.id]);
    await refreshExternalAttendanceState(externalDb, row, payload.date);
    return { sourceType: 'malikat_attendance_record', sourceId: before.id, before, after: null };
  }

  const recordedAt = new Date(`${payload.date}T${payload.requestedTime}:00+03:00`).toISOString();
  const sourceJson = JSON.stringify({
    source: 'employee_request_correction',
    requestId: row.id,
    requestNumber: row.request_number,
    reason: payload.reason,
  });
  if (payload.correctionType.startsWith('update_')) {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    await dbRun(
      externalDb,
      `UPDATE attendance_records
          SET server_time = ?, client_time = ?, source = ?, updated_at = ?,
              created_by_uid = ?, created_by_email = ?, created_by_role = ?
        WHERE id = ?`,
      [recordedAt, recordedAt, sourceJson, nowIso(), cleanText(actor.uid) || 'system',
        optionalText(actor.email) || null, cleanText(actor.role) || 'hr', before.id]
    );
    const after = await dbFirst(externalDb, 'SELECT * FROM attendance_records WHERE id = ? LIMIT 1', [before.id]);
    await refreshExternalAttendanceState(externalDb, row, payload.date);
    return { sourceType: 'malikat_attendance_record', sourceId: before.id, before, after };
  }

  const employeeUid = requiredId(row.employee_uid, 'employeeUid');
  const id = `request_correction_${row.id}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const now = nowIso();
  await dbRun(
    externalDb,
    `INSERT OR IGNORE INTO attendance_records
      (id, employee_uid, employee_doc_id, type, server_time, client_time,
       location_lat, location_lng, location_accuracy, zone_id, zone_name, zone_type,
       allowed_zone_ids, distance_meters, result, rejection_reason, accuracy_accepted,
       device_info, source, created_by_uid, created_by_email, created_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, 'تصحيح إداري', 'manual',
       '[]', NULL, 'allowed', NULL, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      employeeUid,
      row.employee_id,
      recordType,
      recordedAt,
      recordedAt,
      JSON.stringify({ source: 'employee_request', requestId: row.id }),
      sourceJson,
      cleanText(actor.uid) || 'system',
      optionalText(actor.email) || null,
      cleanText(actor.role) || 'hr',
      now,
      now,
    ]
  );
  const after = await dbFirst(externalDb, 'SELECT * FROM attendance_records WHERE id = ? LIMIT 1', [id]);
  await refreshExternalAttendanceState(externalDb, row, payload.date);
  return { sourceType: 'malikat_attendance_record', sourceId: id, before: null, after };
}

async function executeAttendanceCorrection(db, salonId, row, payload, actor, input, options = {}) {
  const externalDb = options.externalAttendanceDb || null;
  if (externalDb) {
    const recordType = payload.correctionType.includes('check_in') ? 'check_in' : 'check_out';
    const externalTarget = await findExternalAttendanceRecord(externalDb, row, payload, recordType);
    const shouldUseExternal = payload.correctionType.startsWith('add_') || Boolean(externalTarget);
    if (shouldUseExternal) return executeExternalAttendanceCorrection(externalDb, row, payload, actor);
  }

  const recordType = payload.correctionType.includes('check_in') ? 'check_in' : 'check_out';
  let before = null;
  if (payload.recordId) before = await dbFirst(db, 'SELECT * FROM attendance_records WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, payload.recordId]);
  if (!before && payload.currentTime) {
    before = await dbFirst(
      db,
      `SELECT * FROM attendance_records WHERE salon_id = ? AND employee_id = ? AND date_key = ? AND record_type = ?
       ORDER BY ABS(strftime('%s', recorded_at) - strftime('%s', ?)) LIMIT 1`,
      [salonId, row.employee_id, payload.date, recordType, new Date(`${payload.date}T${payload.currentTime}:00+03:00`).toISOString()]
    );
  }
  if (payload.correctionType === 'delete_record') {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    await dbRun(db, 'DELETE FROM attendance_records WHERE salon_id = ? AND id = ?', [salonId, before.id]);
    return { sourceType: 'attendance_record', sourceId: before.id, before, after: null };
  }
  const recordedAt = new Date(`${payload.date}T${payload.requestedTime}:00+03:00`).toISOString();
  if (payload.correctionType.startsWith('update_')) {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    await dbRun(
      db,
      `UPDATE attendance_records SET recorded_at = ?, source = 'employee_request_correction', note = ?
       WHERE salon_id = ? AND id = ?`,
      [recordedAt, `${payload.reason} • ${row.request_number}`, salonId, before.id]
    );
    const after = await dbFirst(db, 'SELECT * FROM attendance_records WHERE salon_id = ? AND id = ?', [salonId, before.id]);
    return { sourceType: 'attendance_record', sourceId: before.id, before, after };
  }
  const id = generatedId('attendance');
  await dbRun(
    db,
    `INSERT OR IGNORE INTO attendance_records
      (id, salon_id, employee_id, employee_uid, date_key, record_type, recorded_at,
       source, note, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'employee_request_correction', ?, ?, ?)`,
    [id, salonId, row.employee_id, row.employee_uid, payload.date, recordType, recordedAt,
      `${payload.reason} • ${row.request_number}`, `employee-request:${row.id}:attendance`, nowIso()]
  );
  const after = await dbFirst(db, 'SELECT * FROM attendance_records WHERE salon_id = ? AND idempotency_key = ? LIMIT 1', [salonId, `employee-request:${row.id}:attendance`]);
  return { sourceType: 'attendance_record', sourceId: after?.id || id, before: null, after };
}

async function refreshPayrollFinancials(db, salonId, employeeId, payrollMonth) {
  const entry = await dbFirst(
    db,
    `SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
       AND COALESCE(status, 'draft') NOT IN ('approved', 'paid') LIMIT 1`,
    [salonId, employeeId, payrollMonth]
  );
  if (!entry) return null;
  const overtime = await dbFirst(
    db,
    `SELECT COALESCE(SUM(approved_minutes), 0) AS minutes FROM employee_overtime_records
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? AND payout_status IN ('approved', 'scheduled', 'included')`,
    [salonId, employeeId, payrollMonth]
  );
  const advances = await dbFirst(
    db,
    `SELECT COALESCE(SUM(sai.amount_halalas), 0) AS halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa ON sa.salon_id = sai.salon_id AND sa.id = sai.advance_id
      WHERE sai.salon_id = ? AND sa.employee_id = ? AND sai.payroll_month = ?
        AND sai.status IN ('scheduled', 'deducted')`,
    [salonId, employeeId, payrollMonth]
  );
  const overtimeHours = Number(overtime?.minutes || 0) / 60;
  const financialHours = Number(entry.overtime_enabled || 0) === 1 ? overtimeHours : 0;
  const overtimeValue = Math.max(0, Math.round(financialHours * Number(entry.hourly_rate_halalas || 0) * Number(entry.overtime_multiplier || 1.5)));
  const advanceHalalas = Math.max(0, Number(advances?.halalas || 0));
  const gross = Math.max(0,
    Number(entry.base_salary_halalas || 0) + Number(entry.allowances_halalas || 0) +
    Number(entry.manual_additions_halalas || 0) + overtimeValue
  );
  const deductions = Math.max(0,
    Number(entry.absence_deduction_halalas || 0) + Number(entry.delay_deduction_halalas || 0) +
    Number(entry.insurance_deduction_halalas || 0) + Number(entry.other_deductions_halalas || 0) +
    Number(entry.missing_hours_deduction_halalas || 0) + Number(entry.manual_deductions_halalas || 0) +
    advanceHalalas
  );
  const net = Math.max(0, gross - deductions);
  await dbRun(
    db,
    `UPDATE payroll_entries SET overtime_hours = ?, detected_extra_hours = ?, financial_overtime_hours = ?,
       overtime_value_halalas = ?, overtime_bonus_halalas = ?, advances_halalas = ?,
       gross_salary_halalas = ?, total_deductions_halalas = ?, net_salary_halalas = ?,
       final_salary_halalas = ?, updated_at = ? WHERE salon_id = ? AND id = ?`,
    [overtimeHours, overtimeHours, financialHours, overtimeValue, overtimeValue, advanceHalalas,
      gross, deductions, net, net, nowIso(), salonId, entry.id]
  );
  await dbRun(
    db,
    `UPDATE employee_overtime_records SET payroll_entry_id = ?, payout_status = 'included', updated_at = ?
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?`,
    [entry.id, nowIso(), salonId, employeeId, payrollMonth]
  );
  await dbRun(
    db,
    `UPDATE salary_advance_installments SET payroll_entry_id = ?, updated_at = ?
      WHERE salon_id = ? AND payroll_month = ? AND advance_id IN
        (SELECT id FROM salary_advances WHERE salon_id = ? AND employee_id = ?)`,
    [entry.id, nowIso(), salonId, payrollMonth, salonId, employeeId]
  );
  return entry.id;
}

async function executeOvertime(db, salonId, row, payload, actor, input) {
  const existing = await dbFirst(db, `SELECT * FROM employee_overtime_records WHERE salon_id = ? AND request_id = ? LIMIT 1`, [salonId, row.id]);
  if (existing) return { sourceType: 'overtime', sourceId: existing.id, before: null, after: existing };
  const sameDay = await dbAll(db, `SELECT start_time, end_time FROM employee_overtime_records WHERE salon_id = ? AND employee_id = ? AND date_key = ?`, [salonId, row.employee_id, payload.date]);
  if (sameDay.some((item) => intervalsOverlap(payload.startTime, payload.endTime, item.start_time, item.end_time))) {
    throw new AppError(409, 'core_employee_request:overtime_overlap');
  }
  const approvedMinutes = positiveInteger(input.approvedMinutes || payload.requestedMinutes, 'approved_minutes', 16 * 60);
  const id = generatedId('overtime');
  const now = nowIso();
  await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_overtime_records
      (id, salon_id, request_id, employee_id, date_key, start_time, end_time,
       requested_minutes, approved_minutes, payroll_month, payroll_entry_id, payout_status,
       reason, task_summary, location, approved_by_uid, approved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'approved', ?, ?, ?, ?, ?, ?, ?)`,
    [id, salonId, row.id, row.employee_id, payload.date, payload.startTime, payload.endTime,
      payload.requestedMinutes, approvedMinutes, cleanText(input.payrollMonth) || payload.date.slice(0, 7),
      payload.reason, payload.taskSummary, payload.location || null, cleanText(actor.uid) || null,
      now, now, now]
  );
  const payrollMonth = cleanText(input.payrollMonth) || payload.date.slice(0, 7);
  const payrollEntryId = await refreshPayrollFinancials(db, salonId, row.employee_id, payrollMonth);
  return { sourceType: 'overtime', sourceId: id, before: null, after: { approvedMinutes, payrollMonth, payrollEntryId } };
}


async function executeExceptionalFinancialPayment(
  db,
  salonId,
  row,
  payload,
  actor,
  input
) {
  const payrollMonth =
    cleanText(input.payrollMonth) ||
    riyadhDateKey().slice(0, 7);

  addMonths(payrollMonth, 0);


  // =====================================================
  // Idempotent existing execution
  // =====================================================

  const existing = await dbFirst(
    db,
    `SELECT *
       FROM employee_financial_payments
      WHERE salon_id = ?
        AND request_id = ?
      LIMIT 1`,
    [
      salonId,
      row.id,
    ]
  );

  if (existing) {
    const existingLedger =
      await dbFirst(
        db,
        `SELECT *
           FROM employee_leave_balance_ledger
          WHERE salon_id = ?
            AND source_type =
                  'exceptional_financial_payment'
            AND source_id = ?
          LIMIT 1`,
        [
          salonId,
          row.id,
        ]
      );

    // New canonical runtime must never accept a financial
    // payment that deducted leave without its ledger row.
    if (
      Number(
        existing.leave_balance_deducted || 0
      ) > 0 &&
      !existingLedger
    ) {
      throw new AppError(
        409,
        'core_employee_request:financial_payment_balance_ledger_missing'
      );
    }

    await refreshPayrollFinancials(
      db,
      salonId,
      row.employee_id,
      existing.payroll_month
    );

    const currentEmployment =
      await dbFirst(
        db,
        `SELECT leave_balance
           FROM employee_employment
          WHERE salon_id = ?
            AND employee_id = ?
          LIMIT 1`,
        [
          salonId,
          row.employee_id,
        ]
      );

    return {
      sourceType:
        'employee_financial_payment',

      sourceId:
        existing.id,

      before:
        existingLedger
          ? {
              leaveBalance:
                Number(
                  existingLedger.balance_before
                ),
            }
          : null,

      after: {
        ...existing,

        leaveBalanceAfter:
          Number(
            currentEmployment?.leave_balance ||
              0
          ),

        leaveBalanceDeducted:
          Number(
            existing.leave_balance_deducted ||
              0
          ),
      },
    };
  }


  // =====================================================
  // Payroll must exist and still be editable
  // =====================================================

  const payrollEntry =
    await dbFirst(
      db,
      `SELECT *
         FROM payroll_entries
        WHERE salon_id = ?
          AND employee_id = ?
          AND payroll_month = ?
          AND COALESCE(status, 'draft')
                NOT IN ('approved', 'paid')
        LIMIT 1`,
      [
        salonId,
        row.employee_id,
        payrollMonth,
      ]
    );

  if (!payrollEntry) {
    throw new AppError(
      409,
      'core_employee_request:payroll_entry_required'
    );
  }


  // =====================================================
  // Validate compensation
  // =====================================================

  const requestedDays =
    numberInRange(
      payload.requestedDays,
      'requested_days',
      0.5,
      60
    );

  if (
    Math.round(requestedDays * 2) !==
    requestedDays * 2
  ) {
    throw new AppError(
      400,
      'core_employee_request:invalid_requested_days'
    );
  }

  const baseSalaryHalalas =
    positiveInteger(
      payload.baseSalaryHalalas,
      'base_salary',
      100_000_000
    );

  const dayRateHalalas =
    positiveInteger(
      payload.dayRateHalalas,
      'day_rate',
      10_000_000
    );

  const amountHalalas =
    positiveInteger(
      payload.calculatedAmountHalalas,
      'calculated_amount',
      100_000_000
    );

  const financialReference =
    cleanText(input.financialReference) ||
    `EFP-${row.request_number}`;


  // =====================================================
  // Pre-check canonical balance
  // Batch below checks it again atomically.
  // =====================================================

  const employment =
    await dbFirst(
      db,
      `SELECT leave_balance
         FROM employee_employment
        WHERE salon_id = ?
          AND employee_id = ?
        LIMIT 1`,
      [
        salonId,
        row.employee_id,
      ]
    );

  const currentBalance =
    Number(
      employment?.leave_balance
    );

  if (
    !employment ||
    !Number.isFinite(currentBalance) ||
    currentBalance < requestedDays
  ) {
    throw new AppError(
      409,
      'core_employee_request:insufficient_annual_leave_balance'
    );
  }


  // =====================================================
  // Payroll addition snapshot
  // =====================================================

  const parsedAdditions =
    parseJson(
      payrollEntry.additions_json,
      []
    );

  const additions =
    Array.isArray(parsedAdditions)
      ? parsedAdditions
      : [];

  const alreadyIncluded =
    additions.some(
      (item) =>
        cleanText(
          item?.requestId ||
            item?.request_id
        ) === cleanText(row.id)
    );

  const nextAdditions =
    alreadyIncluded
      ? additions
      : [
          ...additions,
          {
            id:
              `employee_financial_payment:${row.id}`,

            type:
              'exceptional_financial_payment',

            label:
              'تعويض مالي بدل إجازة',

            requestId:
              row.id,

            requestNumber:
              row.request_number,

            amountHalalas,
            requestedDays,
            financialReference,
          },
        ];

  const nextManualAdditions =
    Number(
      payrollEntry.manual_additions_halalas ||
        0
    ) +
    (
      alreadyIncluded
        ? 0
        : amountHalalas
    );


  // =====================================================
  // Canonical IDs
  // =====================================================

  const now = nowIso();

  const paymentId =
    generatedId(
      'financial_payment'
    );

  const ledgerId =
    `leave_balance_efp_${row.id}`;


  // =====================================================
  // ONE D1 BATCH:
  //
  // payment
  //   +
  // payroll addition
  //   +
  // employee balance
  //   +
  // leave balance ledger
  //
  // There is NO separate compensation balance mutation.
  // =====================================================

  await dbBatch(
    db,
    [
      // -------------------------------------------------
      // A) Create financial payment once
      // -------------------------------------------------
      {
        sql: `
          INSERT OR IGNORE INTO
            employee_financial_payments (
              id,
              salon_id,
              request_id,
              request_number,
              employee_id,
              employee_uid,
              requested_days,
              base_salary_halalas,
              day_rate_halalas,
              amount_halalas,
              payroll_month,
              payroll_entry_id,
              financial_reference,
              payment_status,
              leave_balance_deducted,
              approved_by_uid,
              approved_at,
              executed_by_uid,
              executed_at,
              created_at,
              updated_at
            )
          SELECT
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'included',
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          FROM employee_employment employment
          WHERE employment.salon_id = ?
            AND employment.employee_id = ?
            AND employment.leave_balance >= ?
            AND EXISTS (
              SELECT 1
                FROM payroll_entries open_payroll
               WHERE open_payroll.salon_id = ?
                 AND open_payroll.id = ?
                 AND COALESCE(
                       open_payroll.status,
                       'draft'
                     )
                     NOT IN (
                       'approved',
                       'paid'
                     )
            )
        `,
        params: [
          paymentId,
          salonId,
          row.id,
          row.request_number,
          row.employee_id,
          row.employee_uid,
          requestedDays,
          baseSalaryHalalas,
          dayRateHalalas,
          amountHalalas,
          payrollMonth,
          payrollEntry.id,
          financialReference,
          requestedDays,
          cleanText(
            row.decided_by_uid
          ) || null,
          row.approved_at || now,
          cleanText(actor.uid) || null,
          now,
          now,
          now,

          salonId,
          row.employee_id,
          requestedDays,

          salonId,
          payrollEntry.id,
        ],
      },


      // -------------------------------------------------
      // B) Include amount in payroll exactly once
      // -------------------------------------------------
      {
        sql: `
          UPDATE payroll_entries
             SET manual_additions_halalas = ?,
                 additions_json = ?,
                 updated_at = ?
           WHERE salon_id = ?
             AND id = ?
             AND COALESCE(
                   status,
                   'draft'
                 )
                 NOT IN (
                   'approved',
                   'paid'
                 )
             AND EXISTS (
               SELECT 1
                 FROM employee_financial_payments payment
                WHERE payment.salon_id = ?
                  AND payment.request_id = ?
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM employee_leave_balance_ledger ledger
                WHERE ledger.salon_id = ?
                  AND ledger.source_type =
                        'exceptional_financial_payment'
                  AND ledger.source_id = ?
             )
        `,
        params: [
          nextManualAdditions,
          json(nextAdditions),
          now,

          salonId,
          payrollEntry.id,

          salonId,
          row.id,

          salonId,
          row.id,
        ],
      },


      // -------------------------------------------------
      // C) Deduct annual leave and write operation marker
      // -------------------------------------------------
      {
        sql: `
          UPDATE employee_employment
             SET leave_balance =
                   leave_balance - ?,

                 leave_balance_last_entry_id = ?,

                 updated_by_uid = ?,
                 updated_by_email = ?,
                 updated_at = ?

           WHERE salon_id = ?
             AND employee_id = ?
             AND leave_balance >= ?

             AND EXISTS (
               SELECT 1
                 FROM employee_financial_payments payment
                WHERE payment.salon_id = ?
                  AND payment.request_id = ?
             )

             AND EXISTS (
               SELECT 1
                 FROM payroll_entries open_payroll
                WHERE open_payroll.salon_id = ?
                  AND open_payroll.id = ?
                  AND COALESCE(
                        open_payroll.status,
                        'draft'
                      )
                      NOT IN (
                        'approved',
                        'paid'
                      )
             )

             AND NOT EXISTS (
               SELECT 1
                 FROM employee_leave_balance_ledger ledger
                WHERE ledger.salon_id = ?
                  AND ledger.source_type =
                        'exceptional_financial_payment'
                  AND ledger.source_id = ?
             )
        `,
        params: [
          requestedDays,
          ledgerId,

          cleanText(actor.uid) || null,
          cleanText(actor.email) || null,
          now,

          salonId,
          row.employee_id,
          requestedDays,

          salonId,
          row.id,

          salonId,
          payrollEntry.id,

          salonId,
          row.id,
        ],
      },


      // -------------------------------------------------
      // D) Ledger row is tied to exact operation marker
      // -------------------------------------------------
      {
        sql: `
          INSERT INTO employee_leave_balance_ledger (
            id,
            salon_id,
            employee_id,
            action_type,
            days,
            change_amount,
            balance_before,
            balance_after,
            operation_date,
            note,
            source_type,
            source_id,
            created_by_uid,
            created_by_email,
            created_by_name,
            created_at
          )
          SELECT
            ?,
            ?,
            ?,
            'deduct',
            ?,
            ?,
            employment.leave_balance + ?,
            employment.leave_balance,
            ?,
            ?,
            'exceptional_financial_payment',
            ?,
            ?,
            ?,
            ?,
            ?
          FROM employee_employment employment
          WHERE employment.salon_id = ?
            AND employment.employee_id = ?
            AND employment.leave_balance_last_entry_id = ?

            AND EXISTS (
              SELECT 1
                FROM employee_financial_payments payment
               WHERE payment.salon_id = ?
                 AND payment.request_id = ?
            )

            AND NOT EXISTS (
              SELECT 1
                FROM employee_leave_balance_ledger existing_ledger
               WHERE existing_ledger.salon_id = ?
                 AND existing_ledger.source_type =
                       'exceptional_financial_payment'
                 AND existing_ledger.source_id = ?
            )
        `,
        params: [
          ledgerId,
          salonId,
          row.employee_id,

          requestedDays,
          -requestedDays,
          requestedDays,

          now.slice(0, 10),

          'تعويض مالي بدل إجازة',

          row.id,

          cleanText(actor.uid) || null,
          cleanText(actor.email) || null,
          cleanText(actor.name) || null,
          now,

          salonId,
          row.employee_id,
          ledgerId,

          salonId,
          row.id,

          salonId,
          row.id,
        ],
      },
    ]
  );


  // =====================================================
  // Fail-closed verification
  // =====================================================

  const stored =
    await dbFirst(
      db,
      `SELECT *
         FROM employee_financial_payments
        WHERE salon_id = ?
          AND request_id = ?
        LIMIT 1`,
      [
        salonId,
        row.id,
      ]
    );

  if (!stored) {
    const currentPayroll =
      await dbFirst(
        db,
        `SELECT id
           FROM payroll_entries
          WHERE salon_id = ?
            AND id = ?
            AND COALESCE(
                  status,
                  'draft'
                )
                NOT IN (
                  'approved',
                  'paid'
                )
          LIMIT 1`,
        [
          salonId,
          payrollEntry.id,
        ]
      );

    if (!currentPayroll) {
      throw new AppError(
        409,
        'core_employee_request:payroll_entry_required'
      );
    }

    const latestEmployment =
      await dbFirst(
        db,
        `SELECT leave_balance
           FROM employee_employment
          WHERE salon_id = ?
            AND employee_id = ?
          LIMIT 1`,
        [
          salonId,
          row.employee_id,
        ]
      );

    if (
      !latestEmployment ||
      Number(
        latestEmployment.leave_balance ||
          0
      ) < requestedDays
    ) {
      throw new AppError(
        409,
        'core_employee_request:insufficient_annual_leave_balance'
      );
    }

    throw new AppError(
      409,
      'core_employee_request:financial_payment_not_applied'
    );
  }


  const ledger =
    await dbFirst(
      db,
      `SELECT *
         FROM employee_leave_balance_ledger
        WHERE salon_id = ?
          AND source_type =
                'exceptional_financial_payment'
          AND source_id = ?
        LIMIT 1`,
      [
        salonId,
        row.id,
      ]
    );

  if (!ledger) {
    throw new AppError(
      500,
      'core_employee_request:financial_payment_balance_ledger_missing'
    );
  }


  const employmentAfter =
    await dbFirst(
      db,
      `SELECT
         leave_balance,
         leave_balance_last_entry_id
       FROM employee_employment
       WHERE salon_id = ?
         AND employee_id = ?
       LIMIT 1`,
      [
        salonId,
        row.employee_id,
      ]
    );

  const leaveBalanceAfter =
    Number(
      employmentAfter?.leave_balance
    );

  if (
    !Number.isFinite(
      leaveBalanceAfter
    ) ||
    Math.abs(
      leaveBalanceAfter -
      Number(ledger.balance_after)
    ) > 0.000001
  ) {
    throw new AppError(
      500,
      'core_employee_request:leave_balance_deduction_failed'
    );
  }

  if (
    cleanText(
      employmentAfter?.leave_balance_last_entry_id
    ) !== cleanText(ledger.id)
  ) {
    throw new AppError(
      500,
      'core_employee_request:leave_balance_marker_mismatch'
    );
  }


  const payrollEntryId =
    await refreshPayrollFinancials(
      db,
      salonId,
      row.employee_id,
      payrollMonth
    );

  if (!payrollEntryId) {
    throw new AppError(
      409,
      'core_employee_request:payroll_entry_required'
    );
  }


  return {
    sourceType:
      'employee_financial_payment',

    sourceId:
      stored.id,

    before: {
      leaveBalance:
        Number(
          ledger.balance_before
        ),
    },

    after: {
      ...stored,

      payrollEntryId,

      leaveBalanceBefore:
        Number(
          ledger.balance_before
        ),

      leaveBalanceAfter:
        Number(
          ledger.balance_after
        ),

      leaveBalanceDeducted:
        requestedDays,

      leaveBalanceLedgerId:
        ledger.id,
    },
  };
}

async function executeSalaryAdvance(db, salonId, row, payload, actor, input) {
  const existing = await dbFirst(db, `SELECT * FROM salary_advances WHERE salon_id = ? AND request_id = ? LIMIT 1`, [salonId, row.id]);
  if (existing) return { sourceType: 'salary_advance', sourceId: existing.id, before: null, after: existing };
  const approvedHalalasRaw = input.approvedHalalas ?? (Math.round(Number(input.approvedAmount || 0) * 100) || payload.amountHalalas);
  const approvedHalalas = positiveInteger(approvedHalalasRaw, 'approved_amount', 10_000_000);
  const firstMonth = cleanText(input.firstDeductionMonth) || new Date().toISOString().slice(0, 7);
  const count = payload.repaymentMethod === 'installments' ? payload.installmentCount : 1;
  const deductionMonths = Array.from(
    { length: count },
    (_, index) => addMonths(firstMonth, index)
  );
  for (const payrollMonth of deductionMonths) {
    const lockedPayroll = await dbFirst(
      db,
      `SELECT id, status
         FROM payroll_entries
        WHERE salon_id = ?
          AND employee_id = ?
          AND payroll_month = ?
          AND status IN ('approved', 'paid')
        LIMIT 1`,
      [salonId, row.employee_id, payrollMonth]
    );
    if (lockedPayroll) {
      throw new AppError(409, 'core_employee_request:salary_advance_payroll_locked');
    }
  }
  const id = generatedId('salary_advance');
  const now = nowIso();
  const statements = [{
    sql: `INSERT OR IGNORE INTO salary_advances
      (id, salon_id, request_id, employee_id, employee_uid, requested_halalas,
       approved_halalas, repayment_method, installment_count, first_deduction_month,
       remaining_halalas, paid_halalas, payment_status, financial_reference,
       approved_by_uid, approved_at, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'paid', ?, ?, ?, ?, ?, ?)`,
    params: [id, salonId, row.id, row.employee_id, row.employee_uid, payload.amountHalalas,
      approvedHalalas, payload.repaymentMethod, count, firstMonth, approvedHalalas,
      requiredReason(input.financialReference, 'financial_reference'), cleanText(actor.uid) || null,
      row.approved_at || now, now, now, now],
  }];
  const base = Math.floor(approvedHalalas / count);
  let remainder = approvedHalalas - base * count;
  for (let index = 0; index < count; index += 1) {
    const amount = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    statements.push({
      sql: `INSERT OR IGNORE INTO salary_advance_installments
        (id, salon_id, advance_id, installment_number, payroll_month, amount_halalas,
         status, payroll_entry_id, deducted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL, ?, ?)`,
      params: [generatedId('advance_installment'), salonId, id, index + 1, deductionMonths[index], amount, now, now],
    });
  }
  await dbBatch(db, statements);
  const payrollEntryIds = [];
  for (let index = 0; index < count; index += 1) {
    const entryId = await refreshPayrollFinancials(db, salonId, row.employee_id, deductionMonths[index]);
    if (entryId) payrollEntryIds.push(entryId);
  }
  return { sourceType: 'salary_advance', sourceId: id, before: null, after: { approvedHalalas, installmentCount: count, payrollEntryIds } };
}

async function executeResignation(db, salonId, row, payload, actor, input) {
  const finalDay = validDate(input.finalWorkingDay || row.final_working_day || payload.proposedLastWorkingDay, 'finalWorkingDay');
  if (finalDay > riyadhDateKey()) throw new AppError(409, 'core_employee_request:resignation_day_not_reached');
  if (input.confirmClearance !== true || input.confirmTerminate !== true) throw new AppError(400, 'core_employee_request:resignation_confirmation_required');
  const now = nowIso();
  await dbRun(db, `UPDATE employee_requests SET final_working_day = ?, updated_at = ? WHERE salon_id = ? AND id = ?`, [finalDay, now, salonId, row.id]);
  const linked = await dbFirst(db, `SELECT user_id FROM user_employee_links WHERE salon_id = ? AND employee_id = ? AND link_status = 'active' LIMIT 1`, [salonId, row.employee_id]);
  const statements = [
    { sql: `UPDATE employee_profiles SET status = 'terminated', updated_at = ? WHERE salon_id = ? AND id = ?`, params: [now, salonId, row.employee_id] },
    { sql: `UPDATE staff SET employment_status = 'terminated', active = 0, updated_at = ? WHERE salon_id = ? AND id = ?`, params: [now, salonId, row.employee_id] },
  ];
  if (linked?.user_id) {
    statements.push({ sql: `UPDATE app_users SET status = 'disabled', updated_at = ? WHERE salon_id = ? AND id = ?`, params: [now, salonId, linked.user_id] });
  }
  await dbBatch(db, statements);
  return { sourceType: 'resignation', sourceId: row.id, before: null, after: { finalWorkingDay: finalDay, accountDisabled: Boolean(linked?.user_id) } };
}

async function executeEffects(db, salonId, row, actor, input, options = {}) {
  const payload = parseJson(row.payload_json, {});
  switch (row.request_type) {
    case 'attendance_correction': return executeAttendanceCorrection(db, salonId, row, payload, actor, input, options);
    case 'permission': {
      const id = await createPermissionEffect(db, salonId, row, payload, actor);
      return { sourceType: 'employee_permission_request', sourceId: id, before: null, after: { status: 'approved' } };
    }
    case 'leave': {
      const effect = await createLeaveEffect(db, salonId, row, payload, actor, options);
      return { sourceType: 'employee_leave', sourceId: effect.leaveId, before: null, after: { status: 'approved', days: effect.days, permissionId: effect.permissionId } };
    }
    case 'overtime': return executeOvertime(db, salonId, row, payload, actor, input);
    case 'salary_advance': return executeSalaryAdvance(db, salonId, row, payload, actor, input);
    case 'exceptional_financial_payment': return executeExceptionalFinancialPayment(db, salonId, row, payload, actor, input);
    case 'resignation': return executeResignation(db, salonId, row, payload, actor, input);
    case 'exit_return': return { sourceType: 'exit_return', sourceId: row.id, before: null, after: { status: 'awaiting_exit' }, deferCompletion: true };
    default: throw new AppError(400, 'core_employee_request:unsupported_execution');
  }
}


async function cancelExecutedLeaveRequest(db, salonId, row, input, actor, options = {}) {
  const leave = await dbFirst(
    db,
    `SELECT * FROM employee_leaves
      WHERE salon_id = ?
        AND (
          id = ?
          OR request_id = ?
        )
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    [salonId, cleanText(row.source_reference_id), row.id, cleanText(row.source_reference_id)]
  );

  if (!leave) {
    if (row.status === 'completed') {
      throw new AppError(409, 'core_employee_request:leave_effect_missing');
    }
    if (cleanText(row.execution_status) !== 'failed') {
      throw new AppError(409, 'core_employee_request:leave_effect_missing');
    }
  } else {
    await decideLeave(
      db,
      salonId,
      leave.id,
      {
        status: 'rejected',
        hrNote: optionalText(input.note || input.reason) || 'إلغاء طلب إجازة منفذ واسترجاع أثره التشغيلي',
      },
      actor,
      {
        ...options,
        skipPayrollReconciliation: true,
      }
    );
  }

  const permission = await dbFirst(
    db,
    `SELECT * FROM employee_permission_requests
      WHERE salon_id = ?
        AND employee_request_id = ?
      LIMIT 1`,
    [salonId, row.id]
  );

  if (permission && !['cancelled', 'rejected'].includes(cleanText(permission.status).toLowerCase())) {
    await decidePermissionRequest(
      db,
      salonId,
      permission.id,
      {
        status: 'cancelled',
        financialEffect: permission.financial_effect,
      },
      actor
    );
  }


  // Reconcile only after all linked HR effects are reversed.
  // At this point both the leave and the linked permission reflect
  // the final canonical operational truth.
  if (leave?.id) {
    const {
      reconcileLockedPayrollImpactForHrCorrection,
    } = await import('./payroll.js');

    await reconcileLockedPayrollImpactForHrCorrection(
      db,
      salonId,
      { leaveId: leave.id },
      actor,
      options
    );
  }

  const result = await updateStatus(
    db,
    salonId,
    row,
    'cancelled',
    {
      ...input,
      eventType: 'execution_reversed',
      note: optionalText(input.note || input.reason) || 'تم إلغاء الإجازة بعد التنفيذ واسترجاع أثرها',
      before: { sourceType: row.source_reference_type, sourceId: row.source_reference_id },
      after: { reversed: true, leaveId: leave?.id || null, permissionId: permission?.id || null },
      idempotencyKey: input.idempotencyKey || `execution_reversed:${row.version + 1}`,
    },
    actor
  );

  await notifyEmployee(
    db,
    salonId,
    result.updated,
    result.eventId,
    `تم إلغاء الإجازة ${result.updated.request_number}`,
    optionalText(input.note || input.reason) || 'تم استرجاع أثر الإجازة التشغيلي والمالي المرتبط بها.',
    actor.uid
  );

  return requestSummary(result.updated);
}

export async function transitionEmployeeRequest(db, salonId, idValue, action, input = {}, actor = {}, options = {}) {
  let row = await getRow(db, salonId, idValue);
  if (options.ownOnly) assertOwner(row, actor);
  const actionKey = cleanText(action).toLowerCase();

  if (actionKey === 'assign') {
    const uid = requiredId(input.assignedToUid || input.assigned_to_uid, 'assignedToUid');
    const now = nowIso();
    const version = Number(input.version ?? row.version);
    if (version !== Number(row.version)) throw new AppError(409, 'core_employee_request:version_conflict');
    const result = await dbRun(
      db,
      `UPDATE employee_requests SET assigned_to_uid = ?, assigned_to_name = ?, updated_at = ?, updated_by_uid = ?, version = version + 1
       WHERE salon_id = ? AND id = ? AND version = ?`,
      [uid, optionalText(input.assignedToName) || null, now, cleanText(actor.uid) || null, salonId, row.id, row.version]
    );
    if (changes(result) !== 1) throw new AppError(409, 'core_employee_request:version_conflict');
    row = await getRow(db, salonId, row.id);
    const eventId = await insertEvent(db, salonId, row, { eventType: 'assigned', note: input.note, payload: { assignedToUid: uid }, idempotencyKey: input.idempotencyKey || `assigned:${row.version}` }, actor);
    const assigneeName = optionalText(input.assignedToName) || 'مسؤول إداري';
    await insertNotification(db, salonId, uid, {
      eventId,
      title: `تم تعيين طلب لك ${row.request_number}`,
      body: `${row.title} • ${row.employee_name_snapshot || row.employee_id}${optionalText(input.note) ? ` • ${input.note}` : ''}`,
      requestId: row.id,
      actorUid: actor.uid,
    });
    await notifyEmployee(db, salonId, row, eventId, `تم تعيين مسؤول للطلب ${row.request_number}`, `${assigneeName} سيتولى متابعة الطلب.`, actor.uid);
    return requestSummary(row);
  }

  if (actionKey === 'cancel' && row.status === 'cancelled') {
    return requestSummary(row);
  }

  if (
    actionKey === 'cancel' &&
    row.request_type === 'leave' &&
    ['executing', 'completed'].includes(row.status)
  ) {
    return cancelExecutedLeaveRequest(db, salonId, row, input, actor, options);
  }

  const actionStatus = {
    receive: 'received', 'start-review': 'under_review', request_info: 'needs_info', 'request-info': 'needs_info',
    answer_info: 'under_review', 'answer-info': 'under_review', approve: 'approved', reject: 'rejected',
    cancel: 'cancelled', complete: 'completed', reopen: 'under_review',
  }[actionKey];

  if (actionStatus) {
    if (actionKey === 'complete') {
      if (row.status !== 'executing' || !cleanText(row.source_reference_id)) throw new AppError(409, 'core_employee_request:execution_not_ready');
      if (row.request_type === 'exit_return' && !row.actual_return_at) throw new AppError(409, 'core_employee_request:return_not_recorded');
    }
    if (options.ownOnly && !['answer-info', 'answer_info', 'cancel'].includes(actionKey)) throw new AppError(403, 'core_employee_request:employee_action_forbidden');
    if (actionStatus === 'cancelled' && ['executing', 'completed'].includes(row.status)) throw new AppError(409, 'core_employee_request:cannot_cancel_executed');
    const result = await updateStatus(db, salonId, row, actionStatus, {
      ...input, eventType: actionKey.replace(/-/g, '_'),
      idempotencyKey: input.idempotencyKey || `${actionKey}:${row.version + 1}`,
    }, actor);
    const updated = result.updated;
    if (actionStatus === 'approved' && updated.request_type === 'permission') {
      return transitionEmployeeRequest(
        db,
        salonId,
        updated.id,
        'execute',
        {
          ...input,
          version: updated.version,
          idempotencyKey: input.idempotencyKey
            ? input.idempotencyKey + ":permission_auto_execute"
            : "permission_auto_execute:" + updated.version,
        },
        actor,
        options
      );
    }
    if (['request-info', 'request_info'].includes(actionKey) && cleanText(input.note)) {
      await insertConversationMessage(
        db,
        salonId,
        updated,
        input.note,
        'employee',
        actor,
        `request_info_message:${result.eventId}`
      );
    }
    const labels = {
      received: 'تم استلام طلبك', under_review: 'طلبك قيد المراجعة', needs_info: 'مطلوب معلومات إضافية',
      approved: 'تمت الموافقة على طلبك', rejected: 'تم رفض طلبك', cancelled: 'تم إلغاء الطلب', completed: 'اكتمل تنفيذ طلبك',
    };
    await notifyEmployee(db, salonId, updated, result.eventId, `${labels[actionStatus]} ${updated.request_number}`, input.reason || input.note || '', actor.uid);
    if (actionKey === 'answer-info' || actionKey === 'answer_info') {
      await notifyManagement(db, salonId, updated, result.eventId, `تم استكمال معلومات ${updated.request_number}`, input.note || 'أضافت الموظفة المعلومات المطلوبة.', actor.uid);
    }
    return requestSummary(updated);
  }

  if (actionKey === 'execute') {
    if (row.status === 'approved') {
      const started = await updateStatus(db, salonId, row, 'executing', { ...input, eventType: 'execution_started', idempotencyKey: input.idempotencyKey || `execute:${row.version + 1}` }, actor);
      row = started.updated;
    } else if (row.status === 'executing' && row.execution_status === 'failed') {
      const version = Number(input.version ?? row.version);
      if (version !== Number(row.version)) throw new AppError(409, 'core_employee_request:version_conflict');
      const now = nowIso();
      const result = await dbRun(db, `UPDATE employee_requests SET execution_status = 'running', execution_error = NULL, execution_attempts = execution_attempts + 1, execution_started_at = ?, updated_at = ?, updated_by_uid = ?, version = version + 1 WHERE salon_id = ? AND id = ? AND version = ?`, [now, now, cleanText(actor.uid) || null, salonId, row.id, row.version]);
      if (changes(result) !== 1) throw new AppError(409, 'core_employee_request:version_conflict');
      row = await getRow(db, salonId, row.id);
      await insertEvent(db, salonId, row, { eventType: 'execution_retried', note: input.note, idempotencyKey: input.idempotencyKey || `execution_retried:${row.version}` }, actor);
    } else {
      throw new AppError(409, 'core_employee_request:execute_requires_approval');
    }
    try {
      const effect = await executeEffects(db, salonId, row, actor, input, options);
      const sourceType = cleanText(effect?.sourceType);
      const sourceId = cleanText(effect?.sourceId);
      if (!sourceType || !sourceId) throw new AppError(500, 'core_employee_request:execution_reference_missing');
      await dbRun(
        db,
        `UPDATE employee_requests SET source_reference_type = ?, source_reference_id = ?, external_reference = ?, updated_at = ? WHERE salon_id = ? AND id = ?`,
        [sourceType, sourceId, optionalText(input.externalReference || input.financialReference) || null, nowIso(), salonId, row.id]
      );
      if (effect.deferCompletion) {
        const current = await getRow(db, salonId, row.id);
        const eventId = await insertEvent(db, salonId, current, { eventType: 'execution_waiting', note: input.note, after: effect.after, idempotencyKey: `execution_waiting:${current.version}` }, actor);
        await notifyEmployee(db, salonId, current, eventId, `بدأ تنفيذ طلبك ${current.request_number}`, 'تمت الموافقة ويجري الآن تنفيذ الطلب.', actor.uid);
        return requestSummary(current);
      }
      const current = await getRow(db, salonId, row.id);
      const completed = await updateStatus(db, salonId, current, 'completed', {
        ...input, version: current.version, eventType: 'execution_completed', before: effect.before, after: effect.after,
        payload: { sourceType, sourceId },
        idempotencyKey: `execution_completed:${current.version + 1}`,
      }, actor);
      await notifyEmployee(db, salonId, completed.updated, completed.eventId, `اكتمل تنفيذ طلبك ${completed.updated.request_number}`, 'تم تنفيذ الطلب وتسجيل أثره التشغيلي.', actor.uid);
      return requestSummary(completed.updated);
    } catch (error) {
      await dbRun(
        db,
        `UPDATE employee_requests SET execution_status = 'failed', execution_error = ?, updated_at = ? WHERE salon_id = ? AND id = ?`,
        [cleanText(error?.message || error?.code || 'execution_failed'), nowIso(), salonId, row.id]
      );
      const failed = await getRow(db, salonId, row.id);
      const eventId = await insertEvent(db, salonId, failed, { eventType: 'execution_failed', note: cleanText(error?.message || error?.code), idempotencyKey: `execution_failed:${failed.version}:${failed.execution_attempts}` }, actor);
      await notifyManagement(db, salonId, failed, eventId, `فشل تنفيذ ${failed.request_number}`, cleanText(error?.message || error?.code), actor.uid);
      throw error;
    }
  }

  if (actionKey === 'record-exit') {
    if (row.request_type !== 'exit_return' || row.status !== 'executing') throw new AppError(409, 'core_employee_request:invalid_exit_action');
    if (row.actual_exit_at) return { ...requestSummary(row), idempotent: true };
    const actualExitAt = cleanText(input.actualExitAt) || nowIso();
    if (!Number.isFinite(Date.parse(actualExitAt))) throw new AppError(400, 'core_employee_request:invalid_actual_exit');
    await dbRun(db, `UPDATE employee_requests SET actual_exit_at = ?, updated_at = ?, updated_by_uid = ?, version = version + 1 WHERE salon_id = ? AND id = ?`, [actualExitAt, nowIso(), actor.uid || null, salonId, row.id]);
    row = await getRow(db, salonId, row.id);
    const eventId = await insertEvent(db, salonId, row, { eventType: 'actual_exit_recorded', payload: { actualExitAt }, idempotencyKey: input.idempotencyKey || `actual_exit:${row.version}` }, actor);
    await notifyEmployee(db, salonId, row, eventId, `تم تسجيل خروجك ${row.request_number}`, actualExitAt, actor.uid);
    return requestSummary(row);
  }

  if (actionKey === 'record-return') {
    if (row.request_type !== 'exit_return' || row.status !== 'executing' || !row.actual_exit_at) throw new AppError(409, 'core_employee_request:invalid_return_action');
    if (row.actual_return_at) return { ...requestSummary(row), idempotent: true };
    const actualReturnAt = cleanText(input.actualReturnAt) || nowIso();
    if (!Number.isFinite(Date.parse(actualReturnAt)) || Date.parse(actualReturnAt) <= Date.parse(row.actual_exit_at)) throw new AppError(400, 'core_employee_request:invalid_actual_return');
    await dbRun(db, `UPDATE employee_requests SET actual_return_at = ?, updated_at = ?, updated_by_uid = ?, version = version + 1 WHERE salon_id = ? AND id = ?`, [actualReturnAt, nowIso(), actor.uid || null, salonId, row.id]);
    row = await getRow(db, salonId, row.id);
    const completed = await updateStatus(db, salonId, row, 'completed', {
      eventType: 'actual_return_recorded', note: input.note,
      payload: { actualReturnAt, delayMinutes: row.expected_return_at ? Math.max(0, Math.round((Date.parse(actualReturnAt) - Date.parse(row.expected_return_at)) / 60000)) : 0 },
      idempotencyKey: input.idempotencyKey || `actual_return:${row.version + 1}`,
    }, actor);
    await notifyEmployee(db, salonId, completed.updated, completed.eventId, `اكتمل طلب الخروج والعودة ${completed.updated.request_number}`, 'تم تسجيل العودة الفعلية.', actor.uid);
    return requestSummary(completed.updated);
  }

  throw new AppError(400, 'core_employee_request:unknown_action');
}

export async function addEmployeeRequestComment(db, salonId, idValue, data, actor = {}, options = {}) {
  const row = await getRow(db, salonId, idValue);
  if (options.ownOnly) assertOwner(row, actor);
  const visibility = options.ownOnly ? 'employee' : (cleanText(data.visibility) === 'internal' ? 'internal' : 'employee');
  const body = requiredReason(data.body || data.comment, 'comment');
  const idempotencyKey = requiredText(data.idempotencyKey || data.idempotency_key, 'idempotencyKey', 300);
  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_request_comments
      WHERE salon_id = ? AND request_id = ? AND idempotency_key = ? LIMIT 1`,
    [salonId, row.id, idempotencyKey]
  );
  if (existing) return { ...existing, idempotent: true };
  const now = nowIso();
  const comment = {
    id: generatedId('request_comment'), salon_id: salonId, request_id: row.id,
    author_uid: cleanText(actor.uid) || null, author_name: cleanText(actor.name) || null,
    author_role: cleanText(actor.role) || null, visibility, body, idempotency_key: idempotencyKey,
    created_at: now, updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO employee_request_comments
      (id, salon_id, request_id, author_uid, author_name, author_role, visibility, body,
       idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Object.values(comment)
  );
  const eventId = await insertEvent(db, salonId, row, { eventType: visibility === 'internal' ? 'internal_note_added' : 'comment_added', note: body, payload: { commentId: comment.id }, idempotencyKey: `comment:${idempotencyKey}` }, actor);
  if (options.ownOnly) await notifyManagement(db, salonId, row, eventId, `رد جديد على ${row.request_number}`, body, actor.uid);
  else if (visibility === 'employee') await notifyEmployee(db, salonId, row, eventId, `تعليق جديد على ${row.request_number}`, body, actor.uid);
  return comment;
}

export async function addEmployeeRequestAttachment(db, salonId, idValue, data, actor = {}, options = {}) {
  const row = await getRow(db, salonId, idValue);
  if (options.ownOnly) assertOwner(row, actor);
  const storageKey = requiredText(data.storageKey || data.storage_key, 'storageKey', 900);
  const fileMetadataId = requiredId(data.fileMetadataId || data.file_metadata_id, 'fileMetadataId');
  const idempotencyKey = requiredText(data.idempotencyKey || data.idempotency_key, 'idempotencyKey', 300);
  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_request_attachments
      WHERE salon_id = ? AND request_id = ? AND idempotency_key = ? LIMIT 1`,
    [salonId, row.id, idempotencyKey]
  );
  if (existing) return { ...existing, idempotent: true };
  const metadata = await dbFirst(db, `SELECT * FROM file_metadata WHERE salon_id = ? AND id = ? LIMIT 1`, [salonId, fileMetadataId]);
  if (!metadata) throw new AppError(404, 'core_employee_request:file_metadata_not_found');
  if (cleanText(metadata.employee_id) !== cleanText(row.employee_id)) throw new AppError(403, 'core_employee_request:file_employee_mismatch');
  if (cleanText(metadata.category) !== 'employee_request') throw new AppError(409, 'core_employee_request:file_category_invalid');
  if (cleanText(metadata.status || 'active') !== 'active') throw new AppError(409, 'core_employee_request:file_inactive');
  if (cleanText(metadata.storage_key) !== storageKey) throw new AppError(409, 'core_employee_request:file_storage_mismatch');
  const attachment = {
    id: generatedId('request_attachment'), salon_id: salonId, request_id: row.id,
    file_name: requiredReason(metadata.file_name, 'file_name'),
    file_type: optionalText(metadata.content_type) || null,
    file_size: Math.max(0, Number(metadata.size_bytes || 0) || 0),
    file_metadata_id: fileMetadataId,
    storage_key: storageKey, uploaded_by_uid: cleanText(actor.uid) || null,
    idempotency_key: idempotencyKey, created_at: nowIso(),
  };
  await dbRun(
    db,
    `INSERT INTO employee_request_attachments
      (id, salon_id, request_id, file_name, file_type, file_size, file_metadata_id, storage_key,
       uploaded_by_uid, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Object.values(attachment)
  );
  await insertEvent(db, salonId, row, { eventType: 'attachment_added', payload: { attachmentId: attachment.id, fileName: attachment.file_name }, idempotencyKey: `attachment:${idempotencyKey}` }, actor);
  return attachment;
}

export async function notifyOverdueEmployeeRequests(db, salonId = 'main') {
  if (!db) return { lateReturns: 0, resignations: 0 };
  const now = nowIso();
  const dateKey = riyadhDateKey();
  let lateReturns = 0;
  let resignations = 0;
  const lateRows = await dbAll(
    db,
    `SELECT * FROM employee_requests WHERE salon_id = ? AND request_type = 'exit_return'
      AND status = 'executing' AND actual_exit_at IS NOT NULL AND actual_return_at IS NULL
      AND expected_return_at IS NOT NULL AND expected_return_at < ?`,
    [salonId, now]
  );
  for (const row of lateRows) {
    const eventKey = `late_return:${row.id}:${dateKey}`;
    const exists = await dbFirst(db, `SELECT id FROM employee_request_events WHERE salon_id = ? AND request_id = ? AND request_idempotency_key = ? LIMIT 1`, [salonId, row.id, eventKey]);
    if (exists) continue;
    const eventId = await insertEvent(db, salonId, row, { eventType: 'late_return_alert', note: 'تجاوزت العودة الوقت المتوقع.', payload: { expectedReturnAt: row.expected_return_at, checkedAt: now }, idempotencyKey: eventKey }, { role: 'system', name: 'النظام' });
    await notifyManagement(db, salonId, row, eventId, `تأخر عودة ${row.request_number}`, `${row.employee_name_snapshot || row.employee_id} تجاوزت وقت العودة المتوقع.`, 'system');
    await notifyEmployee(db, salonId, row, eventId, `تنبيه عودة ${row.request_number}`, 'تجاوز وقت العودة المتوقع. يرجى التواصل مع الإدارة.', 'system');
    lateReturns += 1;
  }
  const resignationRows = await dbAll(
    db,
    `SELECT * FROM employee_requests WHERE salon_id = ? AND request_type = 'resignation'
      AND status IN ('approved', 'executing')
      AND COALESCE(final_working_day, json_extract(payload_json, '$.proposedLastWorkingDay'))
          BETWEEN ? AND date(?, '+3 day')`,
    [salonId, dateKey, dateKey]
  );
  for (const row of resignationRows) {
    const finalDay = cleanText(row.final_working_day || parseJson(row.payload_json, {}).proposedLastWorkingDay);
    const eventKey = `resignation_due:${row.id}:${dateKey}`;
    const exists = await dbFirst(db, `SELECT id FROM employee_request_events WHERE salon_id = ? AND request_id = ? AND request_idempotency_key = ? LIMIT 1`, [salonId, row.id, eventKey]);
    if (exists) continue;
    const eventId = await insertEvent(db, salonId, row, { eventType: 'resignation_final_day_alert', note: `آخر يوم عمل: ${finalDay}`, payload: { finalWorkingDay: finalDay }, idempotencyKey: eventKey }, { role: 'system', name: 'النظام' });
    await notifyManagement(db, salonId, row, eventId, `اقتراب آخر يوم عمل ${row.request_number}`, `${row.employee_name_snapshot || row.employee_id} • ${finalDay}`, 'system');
    await notifyEmployee(db, salonId, row, eventId, `تذكير بآخر يوم عمل ${row.request_number}`, finalDay, 'system');
    resignations += 1;
  }
  return { lateReturns, resignations };
}

export async function listEmployeeRequestAssignees(db, salonId, query = {}) {
  const search = cleanText(query.search).toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50) || 50));
  const clauses = [
    'u.salon_id = ?',
    "u.status = 'active'",
    "u.primary_role IN ('owner', 'admin', 'hr', 'accountant')",
    "u.firebase_uid IS NOT NULL",
    "TRIM(u.firebase_uid) <> ''",
  ];
  const params = [salonId];
  if (search) {
    clauses.push(`(LOWER(COALESCE(u.display_name, '')) LIKE ? OR LOWER(COALESCE(u.email, '')) LIKE ? OR LOWER(COALESCE(u.primary_role, '')) LIKE ?)`);
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }
  const rows = await dbAll(
    db,
    `SELECT u.id, u.firebase_uid AS uid, COALESCE(u.email, '') AS email,
            COALESCE(NULLIF(TRIM(u.display_name), ''), u.email, u.firebase_uid) AS display_name,
            u.primary_role AS role
       FROM app_users u
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE u.primary_role
        WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'hr' THEN 3 ELSE 4 END,
        LOWER(COALESCE(u.display_name, u.email, u.firebase_uid))
      LIMIT ${limit}`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    uid: row.uid,
    email: row.email || '',
    displayName: row.display_name || row.email || row.uid,
    role: row.role,
  }));
}

export async function employeeRequestStats(db, salonId, query = {}) {
  const clauses = ['salon_id = ?'];
  const params = [salonId];
  if (cleanText(query.fromDate)) { clauses.push('created_at >= ?'); params.push(`${validDate(query.fromDate)}T00:00:00.000Z`); }
  const rows = await dbAll(db, `SELECT status, COUNT(*) AS count FROM employee_requests WHERE ${clauses.join(' AND ')} GROUP BY status`, params);
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.count || 0)]));
  const overdue = await dbFirst(
    db,
    `SELECT COUNT(*) AS count FROM employee_requests WHERE salon_id = ?
      AND status NOT IN ('completed', 'rejected', 'cancelled')
      AND updated_at < datetime('now', '-2 days')`,
    [salonId]
  );
  return { counts, overdue: Number(overdue?.count || 0) };
}

export async function listEmployeeRequestNotifications(db, salonId, actor = {}, query = {}) {
  const uid = requiredId(actor.uid, 'targetUid');
  const limit = Math.min(300, Math.max(1, Number(query.limit || 100) || 100));
  return dbAll(
    db,
    `SELECT id, target_uid, title, body, notification_type, related_type, related_id,
            is_read, read_at, created_at, updated_at
       FROM notification_records
      WHERE salon_id = ? AND target_uid = ? AND notification_type = 'employee_request'
      ORDER BY created_at DESC LIMIT ${limit}`,
    [salonId, uid]
  );
}

export async function markEmployeeRequestNotificationRead(db, salonId, idValue, actor = {}) {
  const id = requiredId(idValue, 'notificationId');
  const uid = requiredId(actor.uid, 'targetUid');
  const now = nowIso();
  const result = await dbRun(
    db,
    `UPDATE notification_records SET is_read = 1, read_at = COALESCE(read_at, ?), updated_at = ?
      WHERE salon_id = ? AND id = ? AND target_uid = ? AND notification_type = 'employee_request'`,
    [now, now, salonId, id, uid]
  );
  if (changes(result) !== 1) throw new AppError(404, 'core_employee_request_notification:not_found');
  return { id, isRead: true, readAt: now };
}

export async function markAllEmployeeRequestNotificationsRead(db, salonId, actor = {}) {
  const uid = requiredId(actor.uid, 'targetUid');
  const now = nowIso();
  const result = await dbRun(
    db,
    `UPDATE notification_records SET is_read = 1, read_at = COALESCE(read_at, ?), updated_at = ?
      WHERE salon_id = ? AND target_uid = ? AND notification_type = 'employee_request' AND is_read = 0`,
    [now, now, salonId, uid]
  );
  return { updated: Number(result?.meta?.changes ?? result?.changes ?? 0) };
}

export async function getEmployeeRequestPayrollImpact(db, salonId, actor = {}) {
  const employeeId = requiredId(actor.employeeId, 'employeeId');
  const [overtime, advances, installments, financialPayments] = await Promise.all([
    dbAll(
      db,
      `SELECT * FROM employee_overtime_records
        WHERE salon_id = ? AND employee_id = ?
        ORDER BY date_key DESC, created_at DESC LIMIT 100`,
      [salonId, employeeId]
    ),
    dbAll(
      db,
      `SELECT * FROM salary_advances
        WHERE salon_id = ? AND employee_id = ?
        ORDER BY created_at DESC LIMIT 50`,
      [salonId, employeeId]
    ),
    dbAll(
      db,
      `SELECT sai.* FROM salary_advance_installments sai
        JOIN salary_advances sa ON sa.salon_id = sai.salon_id AND sa.id = sai.advance_id
       WHERE sai.salon_id = ? AND sa.employee_id = ?
       ORDER BY sai.payroll_month, sai.installment_number`,
      [salonId, employeeId]
    ),
    dbAll(
      db,
      `SELECT * FROM employee_financial_payments
        WHERE salon_id = ? AND employee_id = ?
        ORDER BY executed_at DESC, created_at DESC LIMIT 100`,
      [salonId, employeeId]
    ),
  ]);
  return { overtime, advances, installments, financialPayments };
}
