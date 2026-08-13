import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { upsertHrEmployee, replaceHrSchedules } from './core/repositories/hr-employees.js';
import { saveShiftTemplate, resolveEmployeeShift } from './core/repositories/shift-control.js';
import { getAttendanceState, recordAttendance } from './core/repositories/attendance.js';
import { createLeave, decideLeave } from './core/repositories/leaves.js';
import { createAbsence } from './core/repositories/absences.js';
import {
  approvePayrollEntry,
  markPayrollEntryPaid,
  upsertPayrollEntry,
  upsertPayrollPeriod,
} from './core/repositories/payroll.js';
import { getSetting, upsertSetting } from './core/repositories/settings.js';
import { createFileMetadata, getFileContent, putFileContent } from './core/repositories/files.js';
import { createBooking, rescheduleBooking } from './core/repositories/bookings.js';
import { createEmployeeRequest, getEmployeeRequestPayrollImpact, getExceptionalFinancialPaymentPreview, transitionEmployeeRequest } from './core/repositories/employee-requests.js';

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlainStatements = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) {
      statements.push(statement);
    }
  };

  // Keep CREATE TRIGGER ... BEGIN ... END; intact. A plain semicolon split
  // corrupts trigger bodies, while D1 exec treats multiline CREATE TABLE
  // scripts as separate lines in Miniflare. This splitter preserves both.
  const triggerPattern = /CREATE\s+TRIGGER\b[\s\S]*?^\s*END\s*;/gim;
  let cursor = 0;
  for (const match of sql.matchAll(triggerPattern)) {
    pushPlainStatements(sql.slice(cursor, match.index));
    statements.push(match[0].trim());
    cursor = match.index + match[0].length;
  }
  pushPlainStatements(sql.slice(cursor));
  return statements;
}

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [
      {
        config: {
          type: "worker",
          name: "core-test-worker",
          compatibilityDate: "2026-06-24",
          manifest: {
            mainModule: "script-0.mjs",
            modulesRoot: process.cwd(),
            modules: {
              "script-0.mjs": { type: "esm", contents: script },
            },
          },
          env: {
            CORE_DB: { type: "d1", id: "core-test" },
            FILES_BUCKET: { type: "r2", name: "FILES_BUCKET" },
          },
          exports: {},
        },
        dev: { rootPath: process.cwd() },
      },
    ],
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
    '0014_app_users_permissions.sql',
    '0015_employee_type.sql',
    '0016_payroll_snapshots.sql',
    '0016_employee_permissions.sql',
    '0017_shift_control.sql',
    '0018_employee_payroll_settings.sql',
    '0020_employee_requests.sql',
    '0022_shift_attendance_policy.sql',
    '0023_exceptional_financial_payment_requests.sql',
  ]) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of splitMigrationStatements(sql)) {
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
  assert.equal(employee.employment.leave_balance, 21);

  const partialUpdate = await upsertHrEmployee(db, 'main', {
    id: 'emp-1',
    name: 'Employee 1 Updated',
    employment: { employmentStatus: 'active' },
  }, actor);
  assert.equal(partialUpdate.name, 'Employee 1 Updated');
  assert.equal(partialUpdate.employment.title, 'Stylist');
  assert.equal(partialUpdate.employment.base_salary_halalas, 450000);
  assert.equal(partialUpdate.employment.leave_balance, 21);

  const shiftTemplate = await saveShiftTemplate(db, 'main', {
    id: 'shift-day',
    name: 'Day shift',
    startTime: '09:00',
    endTime: '17:00',
    lateGraceMinutes: 15,
    attendanceLockEnabled: true,
    attendanceLockAfterMinutes: 30,
  }, actor);
  const withSchedule = await replaceHrSchedules(db, 'main', 'emp-1', [
    { id: 'sched-1', weekday: 0, shiftTemplateId: shiftTemplate.id, active: true, effectiveFrom: '2026-07-01' },
  ]);
  assert.equal(withSchedule.schedules.length, 1);
  const resolved = await resolveEmployeeShift(db, 'main', 'emp-1', '2026-07-19');
  assert.equal(resolved.source, 'weekly_schedule');
  assert.equal(resolved.shift_template_id, 'shift-day');
  assert.equal(resolved.attendance_lock_enabled, 1);

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
  await assert.rejects(
    () => approvePayrollEntry(db, 'main', payroll.id, actor),
    { code: 'core_payroll:setup_incomplete' }
  );

  const readyPayroll = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-ready',
    periodId: period.id,
    employeeId: 'emp-1',
    payrollMonth: '2026-08',
    baseSalaryHalalas: 450000,
    allowancesHalalas: 50000,
    workDays: 26,
    monthlyHours: 208,
    dailyRateHalalas: 17308,
    hourlyRateHalalas: 2163,
    grossSalaryHalalas: 500000,
    finalSalaryHalalas: 500000,
    netSalaryHalalas: 500000,
    scheduleSnapshot: {
      workDays: 26,
      monthlyHours: 208,
      dailyScheduledHours: 8,
      payrollSetupComplete: true,
      payrollSetupMissing: [],
      monthlyHoursSource: 'configured_monthly_hours',
    },
  }, actor);
  await assert.rejects(
    () => markPayrollEntryPaid(db, 'main', readyPayroll.id, actor),
    { code: 'core_payroll:not_approved' }
  );
  const approvedPayroll = await approvePayrollEntry(db, 'main', readyPayroll.id, actor);
  assert.equal(approvedPayroll.status, 'approved');
  const paidPayroll = await markPayrollEntryPaid(db, 'main', readyPayroll.id, actor);
  assert.equal(paidPayroll.status, 'paid');
});


test('annual leave cash compensation preview calculates from Core salary and leave balance', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, created_at, updated_at)
    VALUES ('emp-preview','main','uid-preview','Preview Employee','0500000088',1,'active','2026-01-01','2026-01-01')`).run();

  await upsertHrEmployee(db, 'main', {
    id: 'emp-preview',
    name: 'Preview Employee',
    firebaseUid: 'uid-preview',
    phone: '0500000088',
    employment: {
      baseSalaryHalalas: 450000,
      leaveBalance: 21,
    },
  }, actor);

  const preview = await getExceptionalFinancialPaymentPreview(
    db,
    'main',
    'emp-preview',
    3
  );

  assert.equal(preview.requestedDays, 3);
  assert.equal(preview.baseSalaryHalalas, 450000);
  assert.equal(preview.dayRateHalalas, 15000);
  assert.equal(preview.calculatedAmountHalalas, 45000);
  assert.equal(preview.annualLeaveBalance, 21);
  assert.equal(preview.enoughLeaveBalance, true);
});

test('annual leave cash compensation pays daily value and deducts the same leave days', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, created_at, updated_at)
    VALUES ('emp-fin','main','uid-fin','Financial Employee','0500000099',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-fin', name: 'Financial Employee', firebaseUid: 'uid-fin', phone: '0500000099',
    employment: { title: 'Stylist', baseSalaryHalalas: 450000, leaveBalance: 21 },
  }, actor);

  const period = await upsertPayrollPeriod(db, 'main', {
    id: 'period-fin-2026-08', payrollMonth: '2026-08', monthStart: '2026-08-01', monthEnd: '2026-08-31',
  }, actor);
  await upsertPayrollEntry(db, 'main', {
    id: 'payroll-fin-1', periodId: period.id, employeeId: 'emp-fin', payrollMonth: '2026-08',
    baseSalaryHalalas: 450000, allowancesHalalas: 0, workDays: 30, monthlyHours: 240,
    dailyRateHalalas: 15000, hourlyRateHalalas: 1875,
    grossSalaryHalalas: 450000, netSalaryHalalas: 450000, finalSalaryHalalas: 450000,
    scheduleSnapshot: { workDays: 30, monthlyHours: 240, dailyScheduledHours: 8, payrollSetupComplete: true, payrollSetupMissing: [] },
  }, actor);

  const employeeActor = { uid: 'uid-fin', employeeId: 'emp-fin', email: 'fin@example.com', name: 'Financial Employee', role: 'employee' };
  let request = await createEmployeeRequest(db, 'main', {
    requestType: 'exceptional_financial_payment',
    payload: {
      requestedDays: 3,
      reason: 'احتياج مالي استثنائي',
      notes: 'اختبار تكامل',
      acknowledgement: true,
      employeeSignatureDataUrl: `data:image/png;base64,${'a'.repeat(300)}`,
    },
    idempotencyKey: 'financial-payment-test-1',
  }, employeeActor);

  assert.equal(request.payload.baseSalaryHalalas, 450000);
  assert.equal(request.payload.dayRateHalalas, 15000);
  assert.equal(request.payload.calculatedAmountHalalas, 45000);
  assert.equal(request.payload.balanceDeductionDays, 3);
  assert.equal(request.payload.leaveBalanceTreatment, 'deduct_on_execution');

  const before = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-fin'").first();
  assert.equal(before.leave_balance, 21);

  const adminActor = { ...actor, role: 'admin' };
  request = await transitionEmployeeRequest(db, 'main', request.id, 'receive', { version: request.version }, adminActor);
  request = await transitionEmployeeRequest(db, 'main', request.id, 'start-review', { version: request.version }, adminActor);
  request = await transitionEmployeeRequest(db, 'main', request.id, 'approve', {
    version: request.version,
    note: 'مع الموافقة',
    payload: { reviewerSignatureDataUrl: `data:image/png;base64,${'b'.repeat(300)}` },
  }, adminActor);
  request = await transitionEmployeeRequest(db, 'main', request.id, 'execute', {
    version: request.version,
    payrollMonth: '2026-08',
    financialReference: 'PAY-TEST-001',
  }, adminActor);

  assert.equal(request.status, 'completed');
  assert.equal(request.source_reference_type, 'employee_financial_payment');
  assert.equal(request.external_reference, 'PAY-TEST-001');

  const after = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-fin'").first();
  assert.equal(after.leave_balance, 18);

  const payment = await db.prepare("SELECT * FROM employee_financial_payments WHERE salon_id='main' AND request_id=?").bind(request.id).first();
  assert.equal(payment.amount_halalas, 45000);
  assert.equal(payment.requested_days, 3);
  assert.equal(payment.leave_balance_deducted, 3);
  assert.equal(payment.payroll_month, '2026-08');
  assert.equal(payment.financial_reference, 'PAY-TEST-001');

  const payroll = await db.prepare("SELECT * FROM payroll_entries WHERE salon_id='main' AND id='payroll-fin-1'").first();
  assert.equal(payroll.manual_additions_halalas, 45000);
  assert.equal(payroll.gross_salary_halalas, 495000);
  assert.equal(payroll.net_salary_halalas, 495000);
  assert.equal(payroll.final_salary_halalas, 495000);
  const additions = JSON.parse(payroll.additions_json || '[]');
  assert.equal(additions.filter((item) => item.requestId === request.id).length, 1);

  const impact = await getEmployeeRequestPayrollImpact(db, 'main', employeeActor);
  assert.equal(impact.financialPayments.length, 1);
  assert.equal(impact.financialPayments[0].amount_halalas, 45000);
});


test('annual leave cash compensation rejects days above available annual leave balance', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-low-balance','main','uid-low-balance','Low Balance',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-low-balance', name: 'Low Balance', firebaseUid: 'uid-low-balance',
    employment: { baseSalaryHalalas: 300000, leaveBalance: 2 },
  }, actor);
  const employeeActor = { uid: 'uid-low-balance', employeeId: 'emp-low-balance', name: 'Low Balance', role: 'employee' };
  await assert.rejects(
    () => createEmployeeRequest(db, 'main', {
      requestType: 'exceptional_financial_payment',
      payload: {
        requestedDays: 3,
        reason: 'اختبار رصيد غير كاف',
        acknowledgement: true,
        employeeSignatureDataUrl: `data:image/png;base64,${'d'.repeat(300)}`,
      },
      idempotencyKey: 'financial-payment-low-balance',
    }, employeeActor),
    { code: 'core_employee_request:insufficient_annual_leave_balance' }
  );
  const balance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-low-balance'").first();
  assert.equal(balance.leave_balance, 2);
  const payments = await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-low-balance'").first();
  assert.equal(payments.count, 0);
});

test('exceptional financial payment execution fails closed when payroll entry is missing', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-no-payroll','main','uid-no-payroll','No Payroll',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-no-payroll', name: 'No Payroll', firebaseUid: 'uid-no-payroll',
    employment: { baseSalaryHalalas: 300000, leaveBalance: 15 },
  }, actor);
  const employeeActor = { uid: 'uid-no-payroll', employeeId: 'emp-no-payroll', name: 'No Payroll', role: 'employee' };
  let request = await createEmployeeRequest(db, 'main', {
    requestType: 'exceptional_financial_payment',
    payload: {
      requestedDays: 1,
      reason: 'اختبار عدم وجود مسير',
      acknowledgement: true,
      employeeSignatureDataUrl: `data:image/png;base64,${'c'.repeat(300)}`,
    },
    idempotencyKey: 'financial-payment-test-no-payroll',
  }, employeeActor);
  const adminActor = { ...actor, role: 'admin' };
  request = await transitionEmployeeRequest(db, 'main', request.id, 'receive', { version: request.version }, adminActor);
  request = await transitionEmployeeRequest(db, 'main', request.id, 'start-review', { version: request.version }, adminActor);
  request = await transitionEmployeeRequest(db, 'main', request.id, 'approve', { version: request.version }, adminActor);
  await assert.rejects(
    () => transitionEmployeeRequest(db, 'main', request.id, 'execute', { version: request.version, payrollMonth: '2026-08', financialReference: 'PAY-MISSING' }, adminActor),
    { code: 'core_employee_request:payroll_entry_required' }
  );
  const balance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-no-payroll'").first();
  assert.equal(balance.leave_balance, 15);
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
    INSERT INTO staff_services (salon_id,staff_id,service_id,active) VALUES ('main','staff-1','svc-1',1);
  `);
  await upsertHrEmployee(db, 'main', {
    id: 'staff-1',
    name: 'Staff',
    employment: { employmentStatus: 'active' },
  }, actor);
  const bookingShift = await saveShiftTemplate(db, 'main', {
    id: 'shift-booking-test',
    name: 'Booking test shift',
    startTime: '09:00',
    endTime: '18:00',
  }, actor);
  await replaceHrSchedules(db, 'main', 'staff-1', [
    { id: 'sched-booking-test', weekday: 4, shiftTemplateId: bookingShift.id, active: true, effectiveFrom: '2026-08-01' },
  ]);
  const booking = await createBooking(db, 'main', {
    id: 'booking-1', clientId: 'client-1', staffId: 'staff-1', bookingDate: '2026-08-20', startTime: '10:00',
    slotStepMin: 5, items: [{ id: 'item-1', serviceId: 'svc-1', staffId: 'staff-1' }],
  }, 'uid-admin');
  assert.equal(booking.start_time, '10:00');
  const moved = await rescheduleBooking(db, 'main', booking.id, { bookingDate: '2026-08-20', startTime: '11:00' });
  assert.equal(moved.start_time, '11:00');
  const oldLocks = await db.prepare("SELECT COUNT(*) AS count FROM booking_slot_locks WHERE booking_id='booking-1' AND slot_time='10:00'").first();
  const newLocks = await db.prepare("SELECT COUNT(*) AS count FROM booking_slot_locks WHERE booking_id='booking-1' AND slot_time='11:00'").first();
  assert.equal(oldLocks.count, 0);
  assert.equal(newLocks.count, 1);
});
