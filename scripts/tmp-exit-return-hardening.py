from pathlib import Path

p = Path('workers/core/repositories/employee-requests-legacy.js')
t = p.read_text(encoding='utf-8')
old = """  if (actionKey === 'record-exit') {
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
"""
new = """  if (actionKey === 'record-exit') {
    if (options.ownOnly) throw new AppError(403, 'core_employee_request:employee_action_forbidden');
    if (row.request_type !== 'exit_return' || row.status !== 'executing') throw new AppError(409, 'core_employee_request:invalid_exit_action');
    if (row.actual_exit_at) return { ...requestSummary(row), idempotent: true };
    const actualExitAt = cleanText(input.actualExitAt) || nowIso();
    const actualExitMs = Date.parse(actualExitAt);
    const nowMs = Date.now();
    if (!Number.isFinite(actualExitMs) || actualExitMs > nowMs + 5 * 60 * 1000) {
      throw new AppError(400, 'core_employee_request:invalid_actual_exit');
    }
    if (row.approved_at && actualExitMs < Date.parse(row.approved_at)) {
      throw new AppError(409, 'core_employee_request:actual_exit_before_approval');
    }
    await dbRun(db, `UPDATE employee_requests SET actual_exit_at = ?, updated_at = ?, updated_by_uid = ?, version = version + 1 WHERE salon_id = ? AND id = ?`, [new Date(actualExitMs).toISOString(), nowIso(), actor.uid || null, salonId, row.id]);
    row = await getRow(db, salonId, row.id);
    const eventId = await insertEvent(db, salonId, row, { eventType: 'actual_exit_recorded', payload: { actualExitAt: row.actual_exit_at }, idempotencyKey: input.idempotencyKey || `actual_exit:${row.version}` }, actor);
    await notifyEmployee(db, salonId, row, eventId, `تم تسجيل خروجك ${row.request_number}`, row.actual_exit_at, actor.uid);
    return requestSummary(row);
  }

  if (actionKey === 'record-return') {
    if (options.ownOnly) throw new AppError(403, 'core_employee_request:employee_action_forbidden');
    if (row.request_type !== 'exit_return' || row.status !== 'executing' || !row.actual_exit_at) throw new AppError(409, 'core_employee_request:invalid_return_action');
    if (row.actual_return_at) return { ...requestSummary(row), idempotent: true };
    const actualReturnAt = cleanText(input.actualReturnAt) || nowIso();
    const actualReturnMs = Date.parse(actualReturnAt);
    const actualExitMs = Date.parse(row.actual_exit_at);
    const nowMs = Date.now();
    if (!Number.isFinite(actualReturnMs) || actualReturnMs <= actualExitMs || actualReturnMs > nowMs + 5 * 60 * 1000) {
      throw new AppError(400, 'core_employee_request:invalid_actual_return');
    }
    const canonicalReturnAt = new Date(actualReturnMs).toISOString();
    await dbRun(db, `UPDATE employee_requests SET actual_return_at = ?, updated_at = ?, updated_by_uid = ?, version = version + 1 WHERE salon_id = ? AND id = ?`, [canonicalReturnAt, nowIso(), actor.uid || null, salonId, row.id]);
    row = await getRow(db, salonId, row.id);
    const completed = await updateStatus(db, salonId, row, 'completed', {
      eventType: 'actual_return_recorded', note: input.note,
      payload: {
        actualReturnAt: canonicalReturnAt,
        actualDurationMinutes: Math.max(0, Math.round((actualReturnMs - actualExitMs) / 60000)),
        delayMinutes: row.expected_return_at ? Math.max(0, Math.round((actualReturnMs - Date.parse(row.expected_return_at)) / 60000)) : 0,
      },
      idempotencyKey: input.idempotencyKey || `actual_return:${row.version + 1}`,
    }, actor);
    await notifyEmployee(db, salonId, completed.updated, completed.eventId, `اكتمل طلب الخروج والعودة ${completed.updated.request_number}`, 'تم تسجيل العودة الفعلية.', actor.uid);
    return requestSummary(completed.updated);
  }
"""
if t.count(old) != 1:
    raise SystemExit(f'exit return anchor mismatch: {t.count(old)}')
p.write_text(t.replace(old, new, 1), encoding='utf-8')

Path('workers/exit-return-request-hardening.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');

test('exit return actual timestamps are management-only, chronological and non-future', () => {
  assert.match(requests, /actionKey === 'record-exit'[\s\S]*options\.ownOnly/);
  assert.match(requests, /actual_exit_before_approval/);
  assert.match(requests, /actualExitMs > nowMs \+ 5 \* 60 \* 1000/);
  assert.match(requests, /actualReturnMs <= actualExitMs/);
  assert.match(requests, /actualDurationMinutes/);
});
""", encoding='utf-8')
