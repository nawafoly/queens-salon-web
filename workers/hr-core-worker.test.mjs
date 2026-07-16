import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { upsertHrEmployee, replaceHrSchedules } from './core/repositories/hr-employees.js';
import { getAttendanceState, recordAttendance } from './core/repositories/attendance.js';
import { createLeave, decideLeave } from './core/repositories/leaves.js';
import { createAbsence } from './core/repositories/absences.js';
import { upsertPayrollEntry, upsertPayrollPeriod } from './core/repositories/payroll.js';
import { getSetting, upsertSetting } from './core/repositories/settings.js';
import { createFileMetadata, getFileContent, putFileContent } from './core/repositories/files.js';
import { createBooking, rescheduleBooking } from './core/repositories/bookings.js';

async function setup() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch(){ return new Response("ok") } }',
    compatibilityDate: '2026-06-24',
    d1Databases: { CORE_DB: 'core-test' },
    r2Buckets: ['FILES_BUCKET'],
  });
  const db = await mf.getD1Database('CORE_DB');
  for (const name of [
    '0001_core_schema.sql',
    '0002_frontend_cutover.sql',
    '0003_booking_availability.sql',
    '0004_admin_operations.sql',
    '0005_hr_settings_files.sql',
    '0006_booking_discount_snapshots.sql',
    '0007_booking_soft_delete.sql',
    '0008_booking_reference_sequence.sql',
  ]) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  return { mf, db, bucket: await mf.getR2Bucket('FILES_BUCKET') };
}

const actor = { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };

test('Phase 6 HR employee, attendance, leave, absence and payroll use Core D1', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, created_at, updated_at)
    VALUES ('emp-1','main','uid-1','Employee 1','0500000001',1,'active','2026-01-01','2026-01-01')`).run();

  const employee = await upsertHrEmployee(db, 'main', {
    id: 'emp-1', name: 'Employee 1', firebaseUid: 'uid-1', phone: '0500000001',
    employment: { title: 'Stylist', baseSalaryHalalas: 450000, leaveBalance: 21 },
  }, actor);
  assert.equal(employee.employment.title, 'Stylist');
  assert.equal(employee.employment.base_salary_halalas, 450000);

  const withSchedule = await replaceHrSchedules(db, 'main', 'emp-1', [
    { id: 'sched-1', weekday: 0, startTime: '09:00', endTime: '17:00', active: true },
  ]);
  assert.equal(withSchedule.schedules.length, 1);

  const checkIn = await recordAttendance(db, 'main', {
    employeeId: 'emp-1', employeeUid: 'uid-1', type: 'check_in', date: '2026-07-16',
    recordedAt: '2026-07-16T09:00:00.000Z', idempotencyKey: 'emp-1-2026-07-16-in',
  }, actor);
  const repeated = await recordAttendance(db, 'main', {
    employeeId: 'emp-1', employeeUid: 'uid-1', type: 'check_in', date: '2026-07-16',
    recordedAt: '2026-07-16T09:00:00.000Z', idempotencyKey: 'emp-1-2026-07-16-in',
  }, actor);
  assert.equal(checkIn.record_type, 'check_in');
  assert.equal(repeated.idempotent, true);
  await recordAttendance(db, 'main', {
    employeeId: 'emp-1', employeeUid: 'uid-1', type: 'check_out', date: '2026-07-16',
    recordedAt: '2026-07-16T17:00:00.000Z', idempotencyKey: 'emp-1-2026-07-16-out',
  }, actor);
  assert.equal((await getAttendanceState(db, 'main', 'emp-1')).last_type, 'check_out');

  const leave = await createLeave(db, 'main', {
    id: 'leave-1', employeeId: 'emp-1', employeeUid: 'uid-1', leaveType: 'annual',
    startDate: '2026-08-01', endDate: '2026-08-02', employeeNote: 'Vacation',
  }, actor);
  const approved = await decideLeave(db, 'main', leave.id, { status: 'approved', hrNote: 'Approved' }, actor);
  assert.equal(approved.status, 'approved');
  const staff = await db.prepare("SELECT leave_start_date, leave_end_date FROM staff WHERE id='emp-1'").first();
  assert.equal(staff.leave_start_date, '2026-08-01');

  const absence = await createAbsence(db, 'main', { id: 'absence-1', employeeId: 'emp-1', date: '2026-07-15', type: 'half_day' }, actor);
  assert.equal(absence.absence_type, 'half_day');

  const period = await upsertPayrollPeriod(db, 'main', {
    id: 'period-2026-07', payrollMonth: '2026-07', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  }, actor);
  const payroll = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-1', periodId: period.id, employeeId: 'emp-1', payrollMonth: '2026-07',
    baseSalaryHalalas: 450000, allowancesHalalas: 50000, finalSalaryHalalas: 480000,
  }, actor);
  assert.equal(payroll.final_salary_halalas, 480000);
});

test('Phase 6 settings and protected R2 file flow work without Firestore', async (t) => {
  const { mf, db, bucket } = await setup();
  t.after(() => mf.dispose());
  await upsertSetting(db, 'main', 'app', { value: { salonName: 'MALIKAT', booking: { slotStepMin: 5 } }, visibility: 'public' }, actor);
  const setting = await getSetting(db, 'main', 'app');
  assert.equal(setting.value.booking.slotStepMin, 5);

  const metadata = await createFileMetadata(db, 'main', {
    id: 'file-1', employeeId: 'emp-1', category: 'contract', fileName: 'contract.txt',
    storageKey: 'main/emp-1/contract.txt', contentType: 'text/plain',
  }, actor);
  const uploaded = await putFileContent(db, 'main', metadata.id, new Request('http://local', {
    method: 'PUT', body: 'contract-body', headers: { 'Content-Type': 'text/plain' },
  }), { FILES_BUCKET: bucket });
  assert.equal(uploaded.size_bytes, 13);
  const response = await getFileContent(db, 'main', metadata.id, { FILES_BUCKET: bucket });
  assert.equal(await response.text(), 'contract-body');
});

test('booking reschedule atomically replaces slot locks', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.exec(`
    INSERT INTO clients (id,salon_id,name,status,created_at,updated_at) VALUES ('client-1','main','Client','active','2026-01-01','2026-01-01');
    INSERT INTO services (id,salon_id,name,duration_minutes,price_halalas,active,sort_order,created_at,updated_at) VALUES ('svc-1','main','Service',30,5000,1,0,'2026-01-01','2026-01-01');
    INSERT INTO staff (id,salon_id,name,active,employment_status,created_at,updated_at) VALUES ('staff-1','main','Staff',1,'active','2026-01-01','2026-01-01');
  `);
  const booking = await createBooking(db, 'main', {
    id: 'booking-1', clientId: 'client-1', staffId: 'staff-1', bookingDate: '2026-07-20', startTime: '10:00',
    slotStepMin: 5, items: [{ id: 'item-1', serviceId: 'svc-1', staffId: 'staff-1' }],
  }, 'uid-admin');
  assert.equal(booking.start_time, '10:00');
  const moved = await rescheduleBooking(db, 'main', booking.id, { bookingDate: '2026-07-20', startTime: '11:00' });
  assert.equal(moved.start_time, '11:00');
  const oldLocks = await db.prepare("SELECT COUNT(*) AS count FROM booking_slot_locks WHERE booking_id='booking-1' AND slot_time='10:00'").first();
  const newLocks = await db.prepare("SELECT COUNT(*) AS count FROM booking_slot_locks WHERE booking_id='booking-1' AND slot_time='11:00'").first();
  assert.equal(oldLocks.count, 0);
  assert.equal(newLocks.count, 1);
});
