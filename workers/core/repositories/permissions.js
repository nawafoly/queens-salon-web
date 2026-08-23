// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import {
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

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'out', 'returned', 'cancelled']);
const VALID_SOURCES = new Set(['employee_request', 'admin_direct']);
const VALID_FINANCIAL_EFFECTS = new Set(['none', 'paid', 'unpaid']);

function normalizedChoice(value, allowed, fallback) {
  const normalized = cleanText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function minutesOf(value) {
  const [hours, minutes] = validTime(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function durationMinutes(startTime, endTime) {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  return end >= start ? end - start : end + 24 * 60 - start;
}

function eventRecordedAt(dateKey, timeValue) {
  return new Date(`${dateKey}T${validTime(timeValue)}:00+03:00`).toISOString();
}

async function resolveEmployeeIdentity(db, salonId, data, actor, source) {
  const actorUid = optionalText(actor.uid) || null;
  const requestedEmployeeId = cleanText(data.employeeId || data.employee_id || actor.employeeId);
  const requestedEmployeeUid = optionalText(data.employeeUid || data.employee_uid || actorUid) || null;

  let profile = null;
  if (requestedEmployeeId || requestedEmployeeUid) {
    profile = await dbFirst(
      db,
      `SELECT id, firebase_uid, name
         FROM employee_profiles
        WHERE salon_id = ?
          AND (id = ? OR firebase_uid = ? OR firebase_uid = ?)
        LIMIT 1`,
      [salonId, requestedEmployeeId || '', requestedEmployeeId || '', requestedEmployeeUid || '']
    );
  }

  if (source === 'employee_request' && !profile) {
    throw new AppError(409, 'core_permission:employee_link_required');
  }

  const employeeId = cleanText(profile?.id || requestedEmployeeId);
  if (!employeeId) throw new AppError(400, 'core_permission:employee_required');

  return {
    employee_id: requiredId(employeeId, 'employeeId'),
    employee_uid: optionalText(profile?.firebase_uid || requestedEmployeeUid) || null,
    employee_name: optionalText(profile?.name || data.employeeName || data.employee_name) || null,
  };
}

async function getPermission(db, salonId, idValue) {
  const id = requiredId(idValue, 'permissionId');
  const row = await dbFirst(
    db,
    'SELECT * FROM employee_permission_requests WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_permission:not_found');
  return row;
}

async function insertEvent(db, salonId, permissionId, eventType, actor = {}, data = {}) {
  await dbRun(
    db,
    `INSERT INTO employee_permission_events
      (id, salon_id, permission_id, event_type, actor_uid, actor_name, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generatedId('permission_event'),
      salonId,
      permissionId,
      eventType,
      optionalText(actor.uid) || null,
      optionalText(actor.name) || null,
      JSON.stringify(data || {}),
      nowIso(),
    ]
  );
}

async function insertNotification(db, salonId, targetUid, title, body, relatedId) {
  const uid = optionalText(targetUid);
  if (!uid) return;
  const now = nowIso();
  await dbRun(
    db,
    `INSERT INTO notification_records
      (id, salon_id, target_uid, title, body, notification_type, related_type, related_id,
       is_read, read_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'permission', 'employee_permission_request', ?, 0, NULL, ?, ?)`,
    [generatedId('notification'), salonId, uid, title, body || null, relatedId, now, now]
  );
}

async function notifyManagement(db, salonId, row) {
  const targets = await dbAll(
    db,
    `SELECT DISTINCT firebase_uid
       FROM role_assignments
      WHERE salon_id = ? AND active = 1 AND role IN ('owner', 'admin', 'hr')`,
    [salonId]
  );
  const body = `${row.employee_name || row.employee_id} • ${row.date_key} • ${row.requested_exit_time}`;
  for (const target of targets) {
    if (cleanText(target.firebase_uid) === cleanText(row.employee_uid)) continue;
    await insertNotification(db, salonId, target.firebase_uid, 'طلب استئذان جديد', body, row.id);
  }
}

async function notifyEmployee(db, salonId, row, title, body) {
  await insertNotification(
    db,
    salonId,
    row.employee_uid,
    title,
    body || `${row.date_key} • ${row.requested_exit_time}`,
    row.id
  );
}

async function insertAttendanceEvent(db, salonId, row, type, timeValue, actor = {}) {
  const idempotencyKey = `permission:${row.id}:${type}`;
  await dbRun(
    db,
    `INSERT OR IGNORE INTO attendance_records
      (id, salon_id, employee_id, employee_uid, date_key, record_type, recorded_at,
       latitude, longitude, accuracy_meters, zone_id, device_id, source, note,
       idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'permission', ?, ?, ?)`,
    [
      generatedId('attendance'),
      salonId,
      row.employee_id,
      row.employee_uid || null,
      row.date_key,
      type,
      eventRecordedAt(row.date_key, timeValue),
      `${row.reason || 'استئذان'} • ${row.id}`,
      idempotencyKey,
      nowIso(),
    ]
  );
  await insertEvent(db, salonId, row.id, type, actor, { time: timeValue, idempotencyKey });
}

function permissionBookingLeaveId(permissionId) {
  return "permission_leave_" + cleanText(permissionId).replace(/[^A-Za-z0-9_-]/g, "_");
}

async function syncPermissionBookingBlock(db, salonId, row, actor = {}) {
  const permissionId = requiredId(row.id, "permissionId");
  const dateKey = validDate(row.date_key, "date");
  const startTime = validTime(row.requested_exit_time, "startTime");
  const endTime = validTime(row.expected_return_time, "expectedReturnTime");
  const leaveId = permissionBookingLeaveId(permissionId);
  const now = nowIso();
  const existing = await dbFirst(
    db,
    "SELECT id FROM employee_leaves WHERE salon_id = ? AND (id = ? OR request_id = ?) LIMIT 1",
    [salonId, leaveId, permissionId]
  );
  const hrNote = "استئذان معتمد — يحجب فترة الحجز المحددة فقط";

  if (existing?.id) {
    await dbRun(
      db,
      `UPDATE employee_leaves
          SET employee_id = ?, employee_uid = ?, employee_name = ?, status = 'approved',
              leave_type = 'permission', start_date = ?, end_date = ?, days_count = 0,
              employee_note = ?, hr_note = ?, decided_at = ?, decided_by_uid = ?,
              decided_by_name = ?, updated_at = ?, duration_kind = 'partial',
              partial_start_time = ?, partial_end_time = ?, request_id = ?
        WHERE salon_id = ? AND id = ?`,
      [
        row.employee_id, row.employee_uid || null, row.employee_name || null, dateKey, dateKey,
        row.reason || "استئذان", hrNote, now, optionalText(actor.uid) || null,
        optionalText(actor.name) || null, now, startTime, endTime, permissionId, salonId, existing.id,
      ]
    );
    return existing.id;
  }

  await dbRun(
    db,
    `INSERT INTO employee_leaves
      (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status,
       leave_type, start_date, end_date, days_count, employee_note, hr_note, decided_at,
       decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at,
       duration_kind, partial_start_time, partial_end_time, request_id)
     VALUES (?, ?, ?, ?, ?, NULL, 'approved', 'permission', ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, 'partial', ?, ?, ?)`,
    [
      leaveId, salonId, row.employee_id, row.employee_uid || null, row.employee_name || null,
      dateKey, dateKey, row.reason || "استئذان", hrNote, now, optionalText(actor.uid) || null,
      optionalText(actor.name) || null, now, now, startTime, endTime, permissionId,
    ]
  );
  return leaveId;
}

async function cancelPermissionBookingBlock(db, salonId, permissionIdValue, actor = {}, reason = "") {
  const permissionId = requiredId(permissionIdValue, "permissionId");
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE employee_leaves
        SET status = 'rejected', hr_note = ?, decided_at = ?, decided_by_uid = ?,
            decided_by_name = ?, updated_at = ?
      WHERE salon_id = ? AND request_id = ? AND leave_type = 'permission'`,
    [
      cleanText(reason) || "تم إلغاء الاستئذان", now, optionalText(actor.uid) || null,
      optionalText(actor.name) || null, now, salonId, permissionId,
    ]
  );
}

export async function permissionPayrollSummary(db, salonId, query = {}) {
  const employeeId = requiredId(query.employeeId || query.employee_id, 'employeeId');
  const fromDate = validDate(query.from || query.fromDate || query.from_date, 'from');
  const toDate = validDate(query.to || query.toDate || query.to_date, 'to');
  const rows = await dbAll(
    db,
    `SELECT * FROM employee_permission_requests
      WHERE salon_id = ? AND employee_id = ? AND status = 'returned'
        AND date_key BETWEEN ? AND ?
      ORDER BY date_key, COALESCE(actual_exit_time, requested_exit_time), created_at`,
    [salonId, employeeId, fromDate, toDate]
  );
  return {
    employeeId,
    fromDate,
    toDate,
    permissionMinutes: rows.reduce((sum, row) => sum + Math.max(0, Number(row.duration_minutes || 0)), 0),
    unpaidPermissionMinutes: rows.reduce((sum, row) => sum + Math.max(0, Number(row.unpaid_minutes || 0)), 0),
    entries: rows,
  };
}

async function refreshPayrollEntries(db, salonId, employeeId, dateKey) {
  const entries = await dbAll(
    db,
    `SELECT pe.id, pe.payroll_month,
       COALESCE(
         (SELECT pp.month_start FROM payroll_periods pp
           WHERE pp.salon_id = pe.salon_id
             AND (pp.id = pe.period_id OR pp.payroll_month = pe.payroll_month)
           ORDER BY CASE WHEN pp.id = pe.period_id THEN 0 ELSE 1 END LIMIT 1),
         pe.payroll_month || '-01'
       ) AS period_start,
       COALESCE(
         (SELECT pp.month_end FROM payroll_periods pp
           WHERE pp.salon_id = pe.salon_id
             AND (pp.id = pe.period_id OR pp.payroll_month = pe.payroll_month)
           ORDER BY CASE WHEN pp.id = pe.period_id THEN 0 ELSE 1 END LIMIT 1),
         date(pe.payroll_month || '-01', '+1 month', '-1 day')
       ) AS period_end
     FROM payroll_entries pe
     WHERE pe.salon_id = ? AND pe.employee_id = ?
       AND COALESCE(pe.status, 'draft') NOT IN ('approved', 'paid')`,
    [salonId, employeeId]
  );

  for (const entry of entries) {
    if (dateKey < entry.period_start || dateKey > entry.period_end) continue;
    const summary = await permissionPayrollSummary(db, salonId, {
      employeeId,
      from: entry.period_start,
      to: entry.period_end,
    });
    await dbRun(
      db,
      `UPDATE payroll_entries
          SET permission_minutes = ?, unpaid_permission_minutes = ?, permission_entries_json = ?, updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [
        summary.permissionMinutes,
        summary.unpaidPermissionMinutes,
        JSON.stringify(summary.entries),
        nowIso(),
        salonId,
        entry.id,
      ]
    );
  }
}

export async function listPermissionRequests(db, salonId, query = {}) {
  const clauses = ['salon_id = ?'];
  const params = [salonId];
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const employeeUid = cleanText(query.employeeUid || query.employee_uid);
  const status = cleanText(query.status).toLowerCase();
  const fromDate = cleanText(query.from || query.fromDate || query.from_date);
  const toDate = cleanText(query.to || query.toDate || query.to_date);

  if (employeeId || employeeUid) {
    clauses.push('(employee_id = ? OR employee_uid = ?)');
    params.push(employeeId || employeeUid, employeeUid || employeeId);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (fromDate) {
    clauses.push('date_key >= ?');
    params.push(validDate(fromDate, 'from'));
  }
  if (toDate) {
    clauses.push('date_key <= ?');
    params.push(validDate(toDate, 'to'));
  }

  const limit = Math.min(1000, Math.max(1, Number(query.limit || 300) || 300));
  return dbAll(
    db,
    `SELECT * FROM employee_permission_requests
      WHERE ${clauses.join(' AND ')}
      ORDER BY date_key DESC, created_at DESC
      LIMIT ${limit}`,
    params
  );
}

export async function createPermissionRequest(db, salonId, data, actor = {}) {
  const source = normalizedChoice(data.source, VALID_SOURCES, 'employee_request');
  const identity = await resolveEmployeeIdentity(db, salonId, data, actor, source);
  const dateKey = validDate(data.date || data.dateKey || data.date_key, 'date');
  const requestedExitTime = validTime(data.startTime || data.requestedExitTime || data.requested_exit_time, 'startTime');
  const expectedReturnRaw = cleanText(data.expectedReturnTime || data.expected_return_time);
  const expectedReturnTime = expectedReturnRaw ? validTime(expectedReturnRaw, 'expectedReturnTime') : null;
  const reason = cleanText(data.reason);
  if (!reason || reason.length > 500) throw new AppError(400, 'core_permission:reason_required');
  const financialEffect = normalizedChoice(
    data.financialEffect || data.financial_effect,
    VALID_FINANCIAL_EFFECTS,
    'none'
  );
  if (source === 'admin_direct' && !expectedReturnTime) {
    throw new AppError(400, 'core_permission:return_time_required');
  }
  const now = nowIso();
  const autoApproved = source === 'admin_direct';
  const approvedMinutes = autoApproved
    ? durationMinutes(requestedExitTime, expectedReturnTime)
    : 0;
  const status = autoApproved ? 'returned' : 'pending';
  const row = {
    id: requiredId(data.id || generatedId('permission')),
    salon_id: salonId,
    employee_id: identity.employee_id,
    employee_uid: identity.employee_uid,
    employee_name: identity.employee_name,
    date_key: dateKey,
    requested_exit_time: requestedExitTime,
    expected_return_time: expectedReturnTime,
    actual_exit_time: autoApproved ? requestedExitTime : null,
    actual_return_time: autoApproved ? expectedReturnTime : null,
    reason,
    note: optionalText(data.note) || null,
    source,
    status,
    financial_effect: financialEffect,
    duration_minutes: approvedMinutes,
    unpaid_minutes: autoApproved && financialEffect === 'unpaid' ? approvedMinutes : 0,
    created_by_uid: optionalText(actor.uid) || null,
    created_by_name: optionalText(actor.name) || null,
    reviewer_uid: source === 'admin_direct' ? optionalText(actor.uid) || null : null,
    reviewer_name: source === 'admin_direct' ? optionalText(actor.name) || null : null,
    returned_by_uid: autoApproved ? optionalText(actor.uid) || null : null,
    returned_by_name: autoApproved ? optionalText(actor.name) || null : null,
    reviewed_at: autoApproved ? now : null,
    exited_at: autoApproved ? now : null,
    returned_at: autoApproved ? now : null,
    created_at: now,
    updated_at: now,
  };

  await dbBatch(db, [
    {
      sql: `INSERT INTO employee_permission_requests
        (id, salon_id, employee_id, employee_uid, employee_name, date_key,
         requested_exit_time, expected_return_time, actual_exit_time, actual_return_time,
         reason, note, source, status, financial_effect, duration_minutes, unpaid_minutes,
         created_by_uid, created_by_name, reviewer_uid, reviewer_name,
         returned_by_uid, returned_by_name, reviewed_at, exited_at, returned_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: Object.values(row),
    },
  ]);
  await insertEvent(db, salonId, row.id, 'created', actor, { source, status, financialEffect });

  if (source === 'employee_request') {
    await notifyManagement(db, salonId, row);
  } else {
    await insertAttendanceEvent(db, salonId, row, 'permission_out', requestedExitTime, actor);
    await insertAttendanceEvent(db, salonId, row, 'permission_return', expectedReturnTime, actor);
    await syncPermissionBookingBlock(db, salonId, row, actor);
    await refreshPayrollEntries(db, salonId, row.employee_id, row.date_key);
    await notifyEmployee(
      db,
      salonId,
      row,
      'تم اعتماد استئذان من الإدارة',
      `${dateKey} • من ${requestedExitTime} إلى ${expectedReturnTime} • المدة ${approvedMinutes} دقيقة`
    );
  }
  return row;
}

export async function decidePermissionRequest(db, salonId, idValue, decision, actor = {}) {
  const row = await getPermission(db, salonId, idValue);
  const status = normalizedChoice(decision.status, VALID_STATUSES, '');
  if (!['approved', 'rejected', 'cancelled'].includes(status)) {
    throw new AppError(400, 'core_permission:invalid_decision');
  }
  if (row.status === status || (status === 'approved' && row.status === 'returned')) {
    return { ...row, idempotent: true };
  }
  if (row.status !== 'pending' && status !== 'cancelled') {
    throw new AppError(409, 'core_permission:invalid_transition');
  }
  const financialEffect = normalizedChoice(
    decision.financialEffect || decision.financial_effect || row.financial_effect,
    VALID_FINANCIAL_EFFECTS,
    row.financial_effect || 'none'
  );
  const now = nowIso();

  if (status === 'approved') {
    const exitTime = validTime(row.requested_exit_time, 'requestedExitTime');
    const returnTime = cleanText(row.expected_return_time);
    if (!returnTime) throw new AppError(409, 'core_permission:return_time_required');
    const approvedReturnTime = validTime(returnTime, 'expectedReturnTime');
    const minutes = durationMinutes(exitTime, approvedReturnTime);
    const unpaidMinutes = financialEffect === 'unpaid' ? minutes : 0;

    await dbRun(
      db,
      `UPDATE employee_permission_requests
          SET status = 'returned', financial_effect = ?, actual_exit_time = ?,
              actual_return_time = ?, duration_minutes = ?, unpaid_minutes = ?,
              reviewer_uid = ?, reviewer_name = ?, returned_by_uid = ?, returned_by_name = ?,
              reviewed_at = ?, exited_at = ?, returned_at = ?, updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [
        financialEffect,
        exitTime,
        approvedReturnTime,
        minutes,
        unpaidMinutes,
        optionalText(actor.uid) || null,
        optionalText(actor.name) || null,
        optionalText(actor.uid) || null,
        optionalText(actor.name) || null,
        now,
        now,
        now,
        now,
        salonId,
        row.id,
      ]
    );
    await insertEvent(db, salonId, row.id, 'approved', actor, {
      financialEffect,
      autoFinalized: true,
      exitTime,
      returnTime: approvedReturnTime,
      durationMinutes: minutes,
    });
    const updated = await getPermission(db, salonId, row.id);
    await syncPermissionBookingBlock(db, salonId, updated, actor);
    await insertAttendanceEvent(db, salonId, updated, 'permission_out', exitTime, actor);
    await insertAttendanceEvent(db, salonId, updated, 'permission_return', approvedReturnTime, actor);
    await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);
    await notifyEmployee(
      db,
      salonId,
      updated,
      'تمت الموافقة واعتماد وقت الاستئذان',
      `${updated.date_key} • من ${exitTime} إلى ${approvedReturnTime} • المدة ${minutes} دقيقة`
    );
    return updated;
  }

  await dbRun(
    db,
    `UPDATE employee_permission_requests
        SET status = ?, financial_effect = ?, reviewer_uid = ?, reviewer_name = ?,
            reviewed_at = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [
      status,
      financialEffect,
      optionalText(actor.uid) || null,
      optionalText(actor.name) || null,
      now,
      now,
      salonId,
      row.id,
    ]
  );
  await insertEvent(db, salonId, row.id, status, actor, { financialEffect });
  const updated = await getPermission(db, salonId, row.id);
  if (status === 'rejected' || status === 'cancelled') {
    await cancelPermissionBookingBlock(db, salonId, row.id, actor, status === 'cancelled' ? 'تم إلغاء الاستئذان' : 'تم رفض الاستئذان');
    await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);
  }
  const title = status === 'rejected'
    ? 'تم رفض طلب الاستئذان'
    : 'تم إلغاء طلب الاستئذان';
  await notifyEmployee(db, salonId, updated, title);
  return updated;
}

export async function markPermissionOut(db, salonId, idValue, data, actor = {}) {
  const row = await getPermission(db, salonId, idValue);
  if (row.status === 'out') return { ...row, idempotent: true };
  if (!['pending', 'approved'].includes(row.status)) {
    throw new AppError(409, 'core_permission:invalid_transition');
  }
  const actualExitTime = validTime(data.actualExitTime || data.actual_exit_time || row.requested_exit_time, 'actualExitTime');
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE employee_permission_requests
        SET status = 'out', actual_exit_time = ?, reviewer_uid = COALESCE(reviewer_uid, ?),
            reviewer_name = COALESCE(reviewer_name, ?), reviewed_at = COALESCE(reviewed_at, ?),
            exited_at = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [
      actualExitTime,
      optionalText(actor.uid) || null,
      optionalText(actor.name) || null,
      now,
      now,
      now,
      salonId,
      row.id,
    ]
  );
  const updated = await getPermission(db, salonId, row.id);
  if (cleanText(updated.expected_return_time)) await syncPermissionBookingBlock(db, salonId, updated, actor);
  await insertAttendanceEvent(db, salonId, updated, 'permission_out', actualExitTime, actor);
  await notifyEmployee(db, salonId, updated, 'تم تسجيل خروجك للاستئذان', `${updated.date_key} • ${actualExitTime}`);
  return updated;
}

export async function markPermissionReturned(db, salonId, idValue, data, actor = {}) {
  const row = await getPermission(db, salonId, idValue);
  if (row.status === 'returned') return { ...row, idempotent: true };
  if (row.status !== 'out') throw new AppError(409, 'core_permission:not_out');
  const actualReturnTime = validTime(data.actualReturnTime || data.actual_return_time, 'actualReturnTime');
  const exitTime = validTime(row.actual_exit_time || row.requested_exit_time, 'actualExitTime');
  const minutes = durationMinutes(exitTime, actualReturnTime);
  const unpaidMinutes = row.financial_effect === 'unpaid' ? minutes : 0;
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE employee_permission_requests
        SET status = 'returned', actual_return_time = ?, duration_minutes = ?, unpaid_minutes = ?,
            returned_by_uid = ?, returned_by_name = ?, returned_at = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [
      actualReturnTime,
      minutes,
      unpaidMinutes,
      optionalText(actor.uid) || null,
      optionalText(actor.name) || null,
      now,
      now,
      salonId,
      row.id,
    ]
  );
  const updated = await getPermission(db, salonId, row.id);
  await syncPermissionBookingBlock(db, salonId, updated, actor);
  await insertAttendanceEvent(db, salonId, updated, 'permission_return', actualReturnTime, actor);
  await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);
  await notifyEmployee(
    db,
    salonId,
    updated,
    'تم تسجيل العودة من الاستئذان',
    `${updated.date_key} • عودة ${actualReturnTime} • المدة ${minutes} دقيقة`
  );
  return updated;
}
