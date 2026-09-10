from pathlib import Path

p = Path('workers/core/repositories/employee-requests-legacy.js')
t = p.read_text(encoding='utf-8')
s = t.index('async function createPermissionEffect(')
e = t.index('\nfunction employeeRequestLeavePolicy', s)
block = t[s:e]
block = block.replace("'employee_request', 'returned', 'none', ?, 0,", "'employee_request', 'approved', 'none', 0, 0,")
block = block.replace('payload.startTime, payload.endTime,\n        payload.reason, optionalText(payload.notes) || null, minutes,', 'NULL, NULL,\n        payload.reason, optionalText(payload.notes) || null,')
block = block.replace('cleanText(actor.name) || null, cleanText(actor.uid) || null, cleanText(actor.name) || null,\n        now, now, now, now, now, row.id,', 'cleanText(actor.name) || null, NULL, NULL,\n        now, NULL, NULL, now, now, row.id,')
first = block.find("    {\n      sql: `INSERT OR IGNORE INTO attendance_records")
if first < 0:
    raise SystemExit('permission attendance insert start missing')
leave_insert = block.find("    {\n      sql: `INSERT OR IGNORE INTO employee_leaves", first)
if leave_insert < 0:
    raise SystemExit('permission leave insert start missing')
block = block[:first] + block[leave_insert:]
block = block.replace('  await refreshPermissionPayrollEntries(db, salonId, row.employee_id, payload.date);\n', '')
t = t[:s] + block + t[e:]
old = "return { sourceType: 'employee_permission_request', sourceId: id, before: null, after: { status: 'returned' } };"
if t.count(old) != 1:
    raise SystemExit('permission effect status anchor mismatch')
t = t.replace(old, "return { sourceType: 'employee_permission_request', sourceId: id, before: null, after: { status: 'approved' } };", 1)
p.write_text(t, encoding='utf-8')

p = Path('workers/core/repositories/permissions.js')
t = p.read_text(encoding='utf-8')
start = t.index("  if (status === 'approved') {")
end = t.index("\n  await dbRun(\n    db,\n    `UPDATE employee_permission_requests\n        SET status = ?", start)
new = """  if (status === 'approved') {
    const exitTime = validTime(row.requested_exit_time, 'requestedExitTime');
    const returnTime = cleanText(row.expected_return_time);
    if (!returnTime) throw new AppError(409, 'core_permission:return_time_required');
    const approvedReturnTime = validTime(returnTime, 'expectedReturnTime');
    const requestedMinutes = durationMinutes(exitTime, approvedReturnTime);
    await dbRun(
      db,
      `UPDATE employee_permission_requests
          SET status = 'approved', financial_effect = ?, actual_exit_time = NULL,
              actual_return_time = NULL, duration_minutes = 0, unpaid_minutes = 0,
              reviewer_uid = ?, reviewer_name = ?, returned_by_uid = NULL, returned_by_name = NULL,
              reviewed_at = ?, exited_at = NULL, returned_at = NULL, updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [financialEffect, optionalText(actor.uid) || null, optionalText(actor.name) || null, now, now, salonId, row.id]
    );
    await insertEvent(db, salonId, row.id, 'approved', actor, {
      financialEffect,
      autoFinalized: false,
      exitTime,
      returnTime: approvedReturnTime,
      requestedMinutes,
    });
    const updated = await getPermission(db, salonId, row.id);
    await syncPermissionBookingBlock(db, salonId, updated, actor);
    await notifyEmployee(
      db,
      salonId,
      updated,
      'تمت الموافقة على طلب الاستئذان',
      `${updated.date_key} • من ${exitTime} إلى ${approvedReturnTime}`
    );
    return updated;
  }
"""
p.write_text(t[:start] + new + t[end:], encoding='utf-8')

Path('workers/permission-lifecycle-hardening.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('approved permission preserves actual out and return lifecycle', () => {
  const permissions = readFileSync('workers/core/repositories/permissions.js','utf8');
  const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js','utf8');
  assert.match(permissions, /SET status = 'approved'/);
  assert.match(permissions, /autoFinalized: false/);
  assert.doesNotMatch(permissions, /autoFinalized: true/);
  const s = requests.indexOf('async function createPermissionEffect');
  const e = requests.indexOf('function employeeRequestLeavePolicy', s);
  const block = requests.slice(s, e);
  assert.match(block, /'employee_request', 'approved'/);
  assert.doesNotMatch(block, /permission_out/);
  assert.doesNotMatch(block, /permission_return/);
  assert.match(requests, /after: \{ status: 'approved' \}/);
});
""", encoding='utf-8')
