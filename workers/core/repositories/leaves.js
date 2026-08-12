// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import {
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

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1) throw new AppError(400, 'core_leave:invalid_range');
  return days;
}

export async function listLeaves(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM employee_leaves WHERE salon_id = ? ORDER BY start_date DESC LIMIT 1000', [salonId]);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const status = cleanText(query.status).toLowerCase();
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (status) rows = rows.filter((row) => cleanText(row.status).toLowerCase() === status);
  return rows;
}

export async function createLeave(db, salonId, data, actor = {}) {
  const startDate = validDate(data.startDate || data.start_date, 'startDate');
  const endDate = validDate(data.endDate || data.end_date, 'endDate');
  const durationKind = cleanText(data.durationKind || data.duration_kind).toLowerCase() === 'partial' ? 'partial' : 'full_day';
  if (durationKind === 'partial' && startDate !== endDate) throw new AppError(400, 'core_leave:partial_single_day');
  const partialStartTime = durationKind === 'partial' ? validTime(data.partialStartTime || data.partial_start_time, 'partialStartTime') : null;
  const partialEndTime = durationKind === 'partial' ? validTime(data.partialEndTime || data.partial_end_time, 'partialEndTime') : null;
  if (durationKind === 'partial' && partialStartTime >= partialEndTime) throw new AppError(400, 'core_leave:invalid_partial_range');
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId('leave')),
    salon_id: salonId,
    employee_id: requiredId(data.employeeId || data.employee_id, 'employeeId'),
    employee_uid: optionalText(data.employeeUid || data.employee_uid || actor.uid) || null,
    employee_name: optionalText(data.employeeName || data.employee_name) || null,
    employee_email: optionalText(data.employeeEmail || data.employee_email) || null,
    status: cleanText(data.status || 'pending'),
    leave_type: cleanText(data.leaveType || data.leave_type || 'annual'),
    start_date: startDate,
    end_date: endDate,
    days_count: Number(data.daysCount ?? data.days_count ?? daysBetween(startDate, endDate)),
    duration_kind: durationKind,
    partial_start_time: partialStartTime,
    partial_end_time: partialEndTime,
    request_id: optionalText(data.requestId || data.request_id) || null,
    employee_note: optionalText(data.employeeNote || data.employee_note) || null,
    hr_note: optionalText(data.hrNote || data.hr_note) || null,
    decided_at: null,
    decided_by_uid: null,
    decided_by_email: null,
    decided_by_name: null,
    created_at: now,
    updated_at: now,
  };
  await dbBatch(db, [{
    sql: `INSERT INTO employee_leaves
      (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status, leave_type,
       start_date, end_date, days_count, duration_kind, partial_start_time, partial_end_time, request_id,
       employee_note, hr_note, decided_at, decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.id,
      row.salon_id,
      row.employee_id,
      row.employee_uid,
      row.employee_name,
      row.employee_email,
      row.status,
      row.leave_type,
      row.start_date,
      row.end_date,
      row.days_count,
      row.duration_kind,
      row.partial_start_time,
      row.partial_end_time,
      row.request_id,
      row.employee_note,
      row.hr_note,
      row.decided_at,
      row.decided_by_uid,
      row.decided_by_email,
      row.decided_by_name,
      row.created_at,
      row.updated_at,
    ],
  }]);
  return row;
}

export async function decideLeave(db, salonId, idValue, decision, actor = {}) {
  const id = requiredId(idValue);
  const status = cleanText(decision.status).toLowerCase();
  if (!['approved', 'rejected'].includes(status)) throw new AppError(400, 'core_leave:invalid_decision');
  const leave = await dbFirst(db, 'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!leave) throw new AppError(404, 'core_leave:not_found');
  if (leave.status !== 'pending' && leave.status === status) return { ...leave, idempotent: true };
  const now = nowIso();
  const statements = [{
    sql: `UPDATE employee_leaves SET status = ?, hr_note = ?, decided_at = ?, decided_by_uid = ?,
      decided_by_email = ?, decided_by_name = ?, updated_at = ? WHERE salon_id = ? AND id = ?`,
    params: [status, optionalText(decision.hrNote || decision.hr_note) || leave.hr_note || null, now,
      optionalText(actor.uid) || null, optionalText(actor.email) || null, optionalText(actor.name) || null,
      now, salonId, id],
  }];
  if (status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial') {
    statements.push({
      sql: `UPDATE staff SET leave_start_date = ?, leave_end_date = ?, leave_note = ?, updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [leave.start_date, leave.end_date, optionalText(decision.hrNote || decision.hr_note || leave.employee_note) || null, now, salonId, leave.employee_id],
    });
  } else if (leave.status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial') {
    // Rejecting/cancelling an already-approved leave must release the employee
    // from the Core availability window. Restrict the clear to the same range
    // so a newer approved leave is not removed accidentally.
    statements.push({
      sql: `UPDATE staff SET leave_start_date = NULL, leave_end_date = NULL, leave_note = NULL, updated_at = ?
             WHERE salon_id = ? AND id = ? AND leave_start_date = ? AND leave_end_date = ?`,
      params: [now, salonId, leave.employee_id, leave.start_date, leave.end_date],
    });
  }
  await dbBatch(db, statements);
  return dbFirst(db, 'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
}
