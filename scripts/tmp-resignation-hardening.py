from pathlib import Path

p = Path('workers/core/repositories/employee-requests-legacy.js')
t = p.read_text(encoding='utf-8')
old = """async function executeResignation(db, salonId, row, payload, actor, input) {
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
"""
new = """async function executeResignation(db, salonId, row, payload, actor, input) {
  const finalDay = validDate(input.finalWorkingDay || row.final_working_day || payload.proposedLastWorkingDay, 'finalWorkingDay');
  if (finalDay > riyadhDateKey()) throw new AppError(409, 'core_employee_request:resignation_day_not_reached');
  if (input.confirmClearance !== true || input.confirmTerminate !== true) throw new AppError(400, 'core_employee_request:resignation_confirmation_required');

  const employment = await dbFirst(
    db,
    `SELECT start_date, end_date, employment_status
       FROM employee_employment
      WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
    [salonId, row.employee_id]
  );
  if (!employment) throw new AppError(409, 'core_employee_request:employment_record_required');
  if (cleanText(employment.start_date) && finalDay < cleanText(employment.start_date)) {
    throw new AppError(409, 'core_employee_request:resignation_before_employment_start');
  }
  const employmentStatus = cleanText(employment.employment_status).toLowerCase();
  if (!['active', 'on_leave', 'probation', 'notice'].includes(employmentStatus)) {
    throw new AppError(409, 'core_employee_request:employment_not_terminable');
  }

  const now = nowIso();
  const linked = await dbFirst(db, `SELECT user_id FROM user_employee_links WHERE salon_id = ? AND employee_id = ? AND link_status = 'active' LIMIT 1`, [salonId, row.employee_id]);
  const statements = [
    { sql: `UPDATE employee_requests SET final_working_day = ?, updated_at = ? WHERE salon_id = ? AND id = ?`, params: [finalDay, now, salonId, row.id] },
    { sql: `UPDATE employee_employment
               SET employment_status = 'terminated', end_date = ?, updated_by_uid = ?, updated_by_email = ?, updated_at = ?
             WHERE salon_id = ? AND employee_id = ?`,
      params: [finalDay, cleanText(actor.uid) || null, cleanText(actor.email) || null, now, salonId, row.employee_id] },
    { sql: `UPDATE employee_profiles SET status = 'terminated', updated_at = ? WHERE salon_id = ? AND id = ?`, params: [now, salonId, row.employee_id] },
    { sql: `UPDATE staff SET employment_status = 'terminated', active = 0, updated_at = ? WHERE salon_id = ? AND id = ?`, params: [now, salonId, row.employee_id] },
  ];
  if (linked?.user_id) {
    statements.push({ sql: `UPDATE app_users SET status = 'disabled', updated_at = ? WHERE salon_id = ? AND id = ?`, params: [now, salonId, linked.user_id] });
    statements.push({ sql: `UPDATE user_employee_links SET link_status = 'inactive', updated_at = ? WHERE salon_id = ? AND employee_id = ? AND user_id = ? AND link_status = 'active'`, params: [now, salonId, row.employee_id, linked.user_id] });
  }
  await dbBatch(db, statements);

  const afterEmployment = await dbFirst(
    db,
    `SELECT end_date, employment_status FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
    [salonId, row.employee_id]
  );
  if (cleanText(afterEmployment?.employment_status).toLowerCase() !== 'terminated' || cleanText(afterEmployment?.end_date) !== finalDay) {
    throw new AppError(500, 'core_employee_request:resignation_employment_sync_failed');
  }
  return {
    sourceType: 'resignation',
    sourceId: row.id,
    before: { employmentStatus, employmentEndDate: employment.end_date || null },
    after: { finalWorkingDay: finalDay, employmentStatus: 'terminated', accountDisabled: Boolean(linked?.user_id) },
  };
}
"""
if t.count(old) != 1:
    raise SystemExit(f'resignation anchor mismatch: {t.count(old)}')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

Path('workers/resignation-request-hardening.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');

test('resignation execution terminates canonical employment and preserves end date', () => {
  assert.match(requests, /employment_status = 'terminated', end_date = \?/);
  assert.match(requests, /resignation_employment_sync_failed/);
  assert.match(requests, /UPDATE user_employee_links SET link_status = 'inactive'/);
  assert.match(requests, /employment_record_required/);
});
""", encoding='utf-8')
