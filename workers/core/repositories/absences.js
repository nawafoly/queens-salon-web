// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import { cleanText, dbAll, dbFirst, dbRun, generatedId, nowIso, optionalText, requiredId, validDate } from '../d1.js';
import { AppError } from '../errors.js';

async function reconcileAbsencePayroll(
  db,
  salonId,
  absence,
  actor = {},
  options = {}
) {
  const {
    reconcileLockedPayrollImpactForEmployeeDate,
  } = await import('./payroll.js');

  return reconcileLockedPayrollImpactForEmployeeDate(
    db,
    salonId,
    {
      employeeId: absence.employee_id,
      date: absence.date_key,
      sourceType: 'absence',
      sourceId: absence.id,
      reason:
        `Canonical absence correction for ${absence.date_key} (${absence.id}).`,
    },
    actor,
    options
  );
}

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
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const where = ['salon_id = ?'];
  const params = [salonId];

  if (employeeId) {
    where.push('(employee_id = ? OR employee_uid = ?)');
    params.push(employeeId, employeeId);
  }

  return dbAll(
    db,
    `SELECT * FROM employee_absences
      WHERE ${where.join(' AND ')}
      ORDER BY date_key DESC
      LIMIT 1000`,
    params
  );
}

export async function createAbsence(
  db,
  salonId,
  data,
  actor = {},
  options = {}
) {
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
  const allowPermissionConflict = data.allowPermissionConflict === true || data.allow_permission_conflict === true;
  if (!allowPermissionConflict) {
    let permissionConflict = null;
    try {
      permissionConflict = await dbFirst(
        db,
        `SELECT id, status, requested_exit_time, expected_return_time, actual_exit_time, actual_return_time
           FROM employee_permission_requests
          WHERE salon_id = ? AND employee_id = ? AND date_key = ?
            AND status IN ('approved', 'out', 'returned')
          ORDER BY created_at DESC LIMIT 1`,
        [salonId, row.employee_id, row.date_key]
      );
    } catch (error) {
      const message = cleanText(error?.message).toLowerCase();
      if (!message.includes('no such table') && !message.includes('unhandled fake d1')) throw error;
    }
    if (permissionConflict) {
      throw new AppError(409, 'core_absence:permission_conflict');
    }
  }
  const existing = await dbFirst(
    db,
    'SELECT * FROM employee_absences WHERE salon_id = ? AND employee_id = ? AND date_key = ? LIMIT 1',
    [salonId, row.employee_id, row.date_key]
  );
  if (existing) {
    const payrollReconciliation = await reconcileAbsencePayroll(
      db,
      salonId,
      existing,
      actor,
      options
    );
    return {
      ...existing,
      idempotent: true,
      payrollReconciliation,
    };
  }

  await dbRun(
    db,
    `INSERT INTO employee_absences
      (id, salon_id, employee_id, employee_uid, date_key, absence_type, note, created_by_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Object.values(row)
  );

  const payrollReconciliation = await reconcileAbsencePayroll(
    db,
    salonId,
    row,
    actor,
    options
  );

  return {
    ...row,
    payrollReconciliation,
  };
}

export async function deleteAbsence(
  db,
  salonId,
  idValue,
  actor = {},
  options = {}
) {
  const id = requiredId(idValue);
  const existing = await dbFirst(
    db,
    'SELECT * FROM employee_absences WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  if (!existing) throw new AppError(404, 'core_absence:not_found');

  const result = await dbRun(
    db,
    'DELETE FROM employee_absences WHERE salon_id = ? AND id = ?',
    [salonId, id]
  );
  if (!Number(result?.meta?.changes ?? result?.changes ?? 0)) {
    throw new AppError(409, 'core_absence:delete_conflict');
  }

  const payrollReconciliation = await reconcileAbsencePayroll(
    db,
    salonId,
    existing,
    actor,
    options
  );

  return {
    id,
    deleted: true,
    payrollReconciliation,
  };
}
