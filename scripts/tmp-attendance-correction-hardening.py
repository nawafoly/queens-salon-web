from pathlib import Path

path = Path('workers/core/repositories/employee-requests-legacy.js')
text = path.read_text(encoding='utf-8')

old_external = """  if (payload.correctionType === 'delete_record') {
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
"""
new_external = """  const sourceJson = JSON.stringify({
    source: 'employee_request_correction',
    requestId: row.id,
    requestNumber: row.request_number,
    reason: payload.reason,
  });

  if (payload.correctionType === 'delete_record') {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    const now = nowIso();
    await dbRun(
      externalDb,
      `UPDATE attendance_records
          SET result = 'rejected',
              rejection_reason = 'voided_by_employee_request',
              source = ?,
              updated_at = ?,
              created_by_uid = ?,
              created_by_email = ?,
              created_by_role = ?
        WHERE id = ? AND result = 'allowed'`,
      [sourceJson, now, cleanText(actor.uid) || 'system', optionalText(actor.email) || null,
        cleanText(actor.role) || 'hr', before.id]
    );
    const after = await dbFirst(externalDb, 'SELECT * FROM attendance_records WHERE id = ? LIMIT 1', [before.id]);
    if (!after || cleanText(after.result).toLowerCase() !== 'rejected') {
      throw new AppError(409, 'core_employee_request:attendance_void_failed');
    }
    await refreshExternalAttendanceState(externalDb, row, payload.date);
    return { sourceType: 'malikat_attendance_record', sourceId: before.id, before, after };
  }

  const recordedAt = new Date(`${payload.date}T${payload.requestedTime}:00+03:00`).toISOString();
"""
if text.count(old_external) != 1:
    raise SystemExit(f'external delete block mismatch: {text.count(old_external)}')
text = text.replace(old_external, new_external, 1)

old_duplicate_source = """    source: 'employee_request_correction',
    requestId: row.id,
    requestNumber: row.request_number,
    reason: payload.reason,
  });
  if (payload.correctionType.startsWith('update_')) {
"""
if text.count(old_duplicate_source) != 1:
    raise SystemExit(f'duplicate source block mismatch: {text.count(old_duplicate_source)}')
text = text.replace(old_duplicate_source, """  if (payload.correctionType.startsWith('update_')) {
""", 1)

old_core = """  if (payload.correctionType === 'delete_record') {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    await dbRun(db, 'DELETE FROM attendance_records WHERE salon_id = ? AND id = ?', [salonId, before.id]);
    return { sourceType: 'attendance_record', sourceId: before.id, before, after: null };
  }
"""
new_core = """  if (payload.correctionType === 'delete_record') {
    if (!before) throw new AppError(404, 'core_employee_request:attendance_record_not_found');
    const originalType = cleanText(before.record_type).toLowerCase();
    if (!['check_in', 'check_out'].includes(originalType)) {
      throw new AppError(409, 'core_employee_request:attendance_record_not_active');
    }
    await dbRun(
      db,
      `UPDATE attendance_records
          SET record_type = ?,
              source = 'employee_request_void',
              note = ?
        WHERE salon_id = ? AND id = ? AND record_type = ?`,
      [
        `voided_${originalType}`,
        `${payload.reason} • ${row.request_number} • original:${originalType}`,
        salonId,
        before.id,
        originalType,
      ]
    );
    const after = await dbFirst(db, 'SELECT * FROM attendance_records WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, before.id]);
    if (!after || cleanText(after.record_type).toLowerCase() !== `voided_${originalType}`) {
      throw new AppError(409, 'core_employee_request:attendance_void_failed');
    }
    return { sourceType: 'attendance_record', sourceId: before.id, before, after };
  }
"""
if text.count(old_core) != 1:
    raise SystemExit(f'core delete block mismatch: {text.count(old_core)}')
text = text.replace(old_core, new_core, 1)

path.write_text(text, encoding='utf-8')

Path('workers/attendance-correction-request-hardening.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');

test('attendance correction voids records instead of physically deleting them', () => {
  assert.doesNotMatch(source, /DELETE FROM attendance_records WHERE id = \?/);
  assert.doesNotMatch(source, /DELETE FROM attendance_records WHERE salon_id = \? AND id = \?/);
  assert.match(source, /result = 'rejected'/);
  assert.match(source, /rejection_reason = 'voided_by_employee_request'/);
  assert.match(source, /record_type = \?/);
  assert.match(source, /employee_request_void/);
  assert.match(source, /attendance_void_failed/);
});
""", encoding='utf-8')
