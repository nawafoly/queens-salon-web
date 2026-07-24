// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import { cleanText, dbAll, dbFirst, dbRun, generatedId, nowIso, optionalText, requiredId, validDate } from '../d1.js';
import { AppError } from '../errors.js';

async function resolveAbsenceEmployeeIdentity(db, salonId, data) {
  const employeeIdInput = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const employeeUidInput = optionalText(data.employeeUid || data.employee_uid) || null;
  const profile = await dbFirst(
    db,
    `SELECT id, firebase_uid FROM employee_profiles
     WHERE salon_id = ? AND (id = ? OR firebase_uid = ? OR firebase_uid = ?)
     LIMIT 1`,
    [salonId, employeeIdInput, employeeIdInput, employeeUidInput || '']
  );
  return {
    employee_id: cleanText(profile?.id) || employeeIdInput,
    employee_uid: optionalText(employeeUidInput || profile?.firebase_uid) || null,
  };
}

export async function listAbsences(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM employee_absences WHERE salon_id = ? ORDER BY date_key DESC LIMIT 1000', [salonId]);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  if (employeeId) {
    rows = rows.filter((row) => cleanText(row.employee_id) === employeeId || cleanText(row.employee_uid) === employeeId);
  }
  return rows;
}

export async function createAbsence(db, salonId, data, actor = {}) {
  const now = nowIso();
  const identity = await resolveAbsenceEmployeeIdentity(db, salonId, data);
  const row = {
    id: requiredId(data.id || generatedId('absence')),
    salon_id: salonId,
    employee_id: identity.employee_id,
    employee_uid: identity.employee_uid,
    date_key: validDate(data.date || data.dateKey || data.date_key, 'date'),
    absence_type: cleanText(data.type || data.absenceType || data.absence_type || 'full_day'),
    note: optionalText(data.note) || null,
    created_by_uid: optionalText(data.createdByUid || data.created_by_uid || actor.uid) || null,
    created_at: now,
    updated_at: now,
  };
  const existing = await dbFirst(db, 'SELECT * FROM employee_absences WHERE salon_id = ? AND employee_id = ? AND date_key = ? LIMIT 1', [salonId, row.employee_id, row.date_key]);
  if (existing) return { ...existing, idempotent: true };
  await dbRun(db, `INSERT INTO employee_absences
    (id, salon_id, employee_id, employee_uid, date_key, absence_type, note, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
  return row;
}

export async function deleteAbsence(db, salonId, idValue) {
  const id = requiredId(idValue);
  const result = await dbRun(db, 'DELETE FROM employee_absences WHERE salon_id = ? AND id = ?', [salonId, id]);
  if (!Number(result?.meta?.changes ?? result?.changes ?? 0)) throw new AppError(404, 'core_absence:not_found');
  return { id, deleted: true };
}
