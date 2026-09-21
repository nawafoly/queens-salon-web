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

function riyadhDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function normalizeMalikatAttendance(row) {
  const recordedAt = cleanText(row.server_time);
  return {
    id: `malikat:${cleanText(row.id)}`,
    salon_id: null,
    employee_id: cleanText(row.employee_doc_id),
    employee_uid: cleanText(row.employee_uid) || null,
    date_key: cleanText(row.work_date) || riyadhDateKey(recordedAt),
    record_type: cleanText(row.type).toLowerCase(),
    recorded_at: recordedAt,
    latitude: row.location_lat === undefined || row.location_lat === null ? null : Number(row.location_lat),
    longitude: row.location_lng === undefined || row.location_lng === null ? null : Number(row.location_lng),
    accuracy_meters: row.location_accuracy === undefined || row.location_accuracy === null ? null : Number(row.location_accuracy),
    zone_id: cleanText(row.zone_id) || null,
    device_id: null,
    source: 'malikat-attendance',
    note: cleanText(row.rejection_reason) || null,
    idempotency_key: null,
    created_at: cleanText(row.created_at) || null,
  };
}

function filterAttendanceRows(rows, employeeId, date) {
  return rows.filter((row) => {
    if (employeeId && cleanText(row.employee_id) !== employeeId && cleanText(row.employee_uid) !== employeeId) return false;
    if (date && cleanText(row.date_key) !== date) return false;
    return true;
  });
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

export async function listAttendance(db, salonId, query = {}, externalAttendanceDb = null) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const date = cleanText(query.date || query.dateKey || query.date_key);
  const coreRows = await dbAll(
    db,
    'SELECT * FROM attendance_records WHERE salon_id = ? ORDER BY recorded_at DESC LIMIT 5000',
    [salonId]
  );
  let rows = filterAttendanceRows(coreRows, employeeId, date);

  if (externalAttendanceDb) {
    const malikatRows = await dbAll(
      externalAttendanceDb,
      `SELECT id, employee_uid, employee_doc_id, type, server_time, client_time, work_date, location_lat,
        location_lng, location_accuracy, zone_id, zone_name, result, rejection_reason, created_at
       FROM attendance_records
       WHERE result = ? AND type IN (?, ?)
       ORDER BY server_time DESC
       LIMIT 5000`,
      ['allowed', 'check_in', 'check_out']
    );
    rows = rows.concat(
      filterAttendanceRows(malikatRows.map(normalizeMalikatAttendance), employeeId, date)
    );
  }

  return rows
    .sort((a, b) => cleanText(b.recorded_at).localeCompare(cleanText(a.recorded_at)))
    .slice(0, 5000);
}

export async function recordAttendance(db, salonId, data, actor = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const type = recordType(data.type || data.recordType || data.record_type);
  const recordedAt = optionalText(data.recordedAt || data.recorded_at) || nowIso();
  const dateKey = validDate(data.date || data.dateKey || data.date_key || recordedAt.slice(0, 10), 'date');
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key) || null;

  const employment = await dbFirst(
    db,
    `SELECT p.status AS profile_status, e.employment_status, e.start_date, e.end_date
       FROM employee_profiles p
       LEFT JOIN employee_employment e
         ON e.salon_id = p.salon_id AND e.employee_id = p.id
      WHERE p.salon_id = ? AND p.id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );
  if (
    !employment ||
    cleanText(employment.profile_status).toLowerCase() !== 'active' ||
    cleanText(employment.employment_status).toLowerCase() !== 'active' ||
    (cleanText(employment.start_date) && dateKey < cleanText(employment.start_date)) ||
    (cleanText(employment.end_date) && dateKey > cleanText(employment.end_date))
  ) {
    throw new AppError(409, 'core_attendance:employee_not_active');
  }

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
