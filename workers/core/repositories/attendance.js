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
} from '../d1.js';
import { AppError } from '../errors.js';

function recordType(value) {
  const normalized = cleanText(value).toLowerCase();
  if (!['check_in', 'check_out'].includes(normalized)) {
    throw new AppError(400, 'core_attendance:invalid_type');
  }
  return normalized;
}

export async function getAttendanceState(db, salonId, employeeIdValue) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  return (
    (await dbFirst(
      db,
      'SELECT * FROM attendance_state WHERE salon_id = ? AND employee_id = ? LIMIT 1',
      [salonId, employeeId]
    )) || { salon_id: salonId, employee_id: employeeId, last_type: null }
  );
}

export async function listAttendance(db, salonId, query = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const date = cleanText(query.date || query.dateKey || query.date_key);
  let rows = await dbAll(
    db,
    'SELECT * FROM attendance_records WHERE salon_id = ? ORDER BY recorded_at DESC LIMIT 2000',
    [salonId]
  );
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (date) rows = rows.filter((row) => row.date_key === date);
  return rows;
}

export async function recordAttendance(db, salonId, data, actor = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const type = recordType(data.type || data.recordType || data.record_type);
  const recordedAt = optionalText(data.recordedAt || data.recorded_at) || nowIso();
  const dateKey = validDate(data.date || data.dateKey || data.date_key || recordedAt.slice(0, 10), 'date');
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key) || null;

  if (idempotencyKey) {
    const existing = await dbFirst(
      db,
      'SELECT * FROM attendance_records WHERE salon_id = ? AND idempotency_key = ? LIMIT 1',
      [salonId, idempotencyKey]
    );
    if (existing) return { ...existing, idempotent: true };
  }

  const state = await getAttendanceState(db, salonId, employeeId);
  if (state.last_type === type) {
    throw new AppError(409, 'core_attendance:duplicate_transition');
  }
  if (type === 'check_out' && state.last_type !== 'check_in') {
    throw new AppError(409, 'core_attendance:check_in_required');
  }

  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId('attendance')),
    salon_id: salonId,
    employee_id: employeeId,
    employee_uid: optionalText(data.employeeUid || data.employee_uid || actor.uid) || null,
    date_key: dateKey,
    record_type: type,
    recorded_at: recordedAt,
    latitude: data.latitude === undefined ? null : Number(data.latitude),
    longitude: data.longitude === undefined ? null : Number(data.longitude),
    accuracy_meters: data.accuracyMeters === undefined && data.accuracy_meters === undefined ? null : Number(data.accuracyMeters ?? data.accuracy_meters),
    zone_id: optionalText(data.zoneId || data.zone_id) || null,
    device_id: optionalText(data.deviceId || data.device_id) || null,
    source: optionalText(data.source) || 'app',
    note: optionalText(data.note) || null,
    idempotency_key: idempotencyKey,
    created_at: now,
  };

  await dbBatch(db, [
    {
      sql: `INSERT INTO attendance_records
        (id, salon_id, employee_id, employee_uid, date_key, record_type, recorded_at, latitude, longitude,
         accuracy_meters, zone_id, device_id, source, note, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: Object.values(row),
    },
    {
      sql: `INSERT INTO attendance_state
        (salon_id, employee_id, last_type, last_record_id, last_time, last_latitude, last_longitude,
         last_accuracy_meters, last_zone_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(salon_id, employee_id) DO UPDATE SET
        last_type = excluded.last_type, last_record_id = excluded.last_record_id, last_time = excluded.last_time,
        last_latitude = excluded.last_latitude, last_longitude = excluded.last_longitude,
        last_accuracy_meters = excluded.last_accuracy_meters, last_zone_id = excluded.last_zone_id,
        updated_at = excluded.updated_at`,
      params: [salonId, employeeId, type, row.id, recordedAt, row.latitude, row.longitude, row.accuracy_meters, row.zone_id, now],
    },
  ]);
  return row;
}
