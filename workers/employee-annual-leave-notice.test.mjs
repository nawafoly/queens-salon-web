import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertEmployeeAnnualLeaveNotice, minimumEmployeeAnnualLeaveDate, riyadhCivilDate } from './core/employee-annual-leave-notice.js';

const instant = new Date('2026-11-12T20:30:00.000Z'); // Riyadh 23:30 Nov 12
const nearMidnight = new Date('2026-11-12T22:30:00.000Z'); // Riyadh 01:30 Nov 13

test('self-service annual leave requires 3 Saudi calendar days inclusive of start boundary', () => {
  assert.equal(riyadhCivilDate(instant), '2026-11-12');
  assert.equal(minimumEmployeeAnnualLeaveDate(instant), '2026-11-15');
  for (const date of ['2026-11-12', '2026-11-13', '2026-11-14']) {
    assert.throws(() => assertEmployeeAnnualLeaveNotice('annual', date, instant), (err) =>
      err.status === 409 && err.code === 'core_employee_request:annual_leave_three_day_notice');
  }
  assert.doesNotThrow(() => assertEmployeeAnnualLeaveNotice('annual', '2026-11-15', instant));
  assert.doesNotThrow(() => assertEmployeeAnnualLeaveNotice('annual', '2026-11-16', instant));
});

test('Riyadh day rollover determines request deadline, not UTC date', () => {
  assert.equal(riyadhCivilDate(nearMidnight), '2026-11-13');
  assert.equal(minimumEmployeeAnnualLeaveDate(nearMidnight), '2026-11-16');
  assert.throws(() => assertEmployeeAnnualLeaveNotice('annual', '2026-11-15', nearMidnight));
});

test('emergency, sick, and unpaid leave do not inherit annual-only employee notice', () => {
  for (const type of ['sick', 'emergency', 'unpaid', 'other']) {
    assert.doesNotThrow(() => assertEmployeeAnnualLeaveNotice(type, '2026-11-12', instant));
  }
});

test('invalid annual dates cannot bypass the notice period', () => {
  for (const date of ['', '2026-11-31', '2026-02-29', 'November 20']) {
    assert.throws(() => assertEmployeeAnnualLeaveNotice('annual', date, instant));
  }
});

test('self-service route explicitly enables the Core guard while admin creation is exempt', async () => {
  const router = await readFile(new URL('./core/index.js', import.meta.url), 'utf8');
  const repo = await readFile(new URL('./core/repositories/employee-requests.js', import.meta.url), 'utf8');
  assert.match(router, /createEmployeeRequest\(db, ctx\.salonId, body, actorInfo, \{ employeeSelfService: true \}\)/);
  assert.match(repo, /if \(options\.employeeSelfService === true\) \{\s*assertEmployeeAnnualLeaveNotice/);
  assert.match(router, /case "employee-requests":[\s\S]*?return createEmployeeRequest\(db, ctx\.salonId, body, actorInfo\)/);
});
