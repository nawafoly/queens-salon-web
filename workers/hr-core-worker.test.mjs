import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { upsertHrEmployee, replaceHrSchedules } from './core/repositories/hr-employees.js';
import {
  resolveEmployeeShift,
  resolveEmployeeShiftsBatch,
  saveShiftTemplate,
} from './core/repositories/shift-control.js';
import { getAttendanceState, recordAttendance } from './core/repositories/attendance.js';
import { createLeave, decideLeave } from './core/repositories/leaves.js';
import {
  adjustLeaveBalance,
  getLeaveBalanceState,
  reverseLeaveBalanceAdjustment,
} from './core/repositories/leave-balance.js';
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
    '0024_employee_leave_balance_ledger.sql',
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
    employment: {
      employmentStatus: 'active',
      leaveBalance: 999,
    },
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



test('canonical leave balance ledger is atomic and idempotent', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`
    INSERT INTO staff
      (
        id,
        salon_id,
        firebase_uid,
        name,
        phone_normalized,
        active,
        employment_status,
        created_at,
        updated_at
      )
    VALUES
      (
        'emp-leave-ledger',
        'main',
        'uid-leave-ledger',
        'Leave Ledger Employee',
        '0500000099',
        1,
        'active',
        '2026-01-01',
        '2026-01-01'
      )
  `).run();

  await upsertHrEmployee(
    db,
    'main',
    {
      id: 'emp-leave-ledger',
      name: 'Leave Ledger Employee',
      firebaseUid: 'uid-leave-ledger',
      phone: '0500000099',
      employment: {
        baseSalaryHalalas: 450000,
        leaveBalance: 5,
      },
    },
    actor
  );

  // 5 + 2 = 7
  const added = await adjustLeaveBalance(
    db,
    'main',
    'emp-leave-ledger',
    {
      id: 'ledger-add-1',
      actionType: 'add',
      days: 2,
      operationDate: '2026-08-14',
      note: 'Test add',
      sourceType: 'manual_adjustment',
      sourceId: 'test-add-source-1',
    },
    actor
  );

  assert.equal(added.previousBalance, 5);
  assert.equal(added.leaveBalanceDays, 7);
  assert.equal(added.createdEntry.balanceBefore, 5);
  assert.equal(added.createdEntry.balanceAfter, 7);
  assert.equal(added.createdEntry.changeAmount, 2);
  assert.equal(added.idempotent, false);

  // Repeating the same source must not change balance twice.
  const repeatedAdd = await adjustLeaveBalance(
    db,
    'main',
    'emp-leave-ledger',
    {
      actionType: 'add',
      days: 2,
      operationDate: '2026-08-14',
      sourceType: 'manual_adjustment',
      sourceId: 'test-add-source-1',
    },
    actor
  );

  assert.equal(repeatedAdd.idempotent, true);
  assert.equal(repeatedAdd.leaveBalanceDays, 7);
  assert.equal(repeatedAdd.createdEntry.id, 'ledger-add-1');

  // 7 - 1.5 = 5.5
  const deducted = await adjustLeaveBalance(
    db,
    'main',
    'emp-leave-ledger',
    {
      id: 'ledger-deduct-1',
      actionType: 'deduct',
      days: 1.5,
      operationDate: '2026-08-14',
      note: 'Test deduct',
      sourceType: 'manual_adjustment',
      sourceId: 'test-deduct-source-1',
    },
    actor
  );

  assert.equal(deducted.previousBalance, 7);
  assert.equal(deducted.leaveBalanceDays, 5.5);
  assert.equal(deducted.createdEntry.balanceBefore, 7);
  assert.equal(deducted.createdEntry.balanceAfter, 5.5);
  assert.equal(deducted.createdEntry.changeAmount, -1.5);

  // Reverse the deduction: 5.5 + 1.5 = 7.
  const reversed = await reverseLeaveBalanceAdjustment(
    db,
    'main',
    deducted.createdEntry.id,
    {
      operationDate: '2026-08-14',
      reason: 'Test reversal',
    },
    actor,
    {
      allowedSourceTypes: ['manual_adjustment'],
      expectedEmployeeId: 'emp-leave-ledger',
    }
  );

  assert.equal(reversed.idempotent, false);
  assert.equal(reversed.previousBalance, 5.5);
  assert.equal(reversed.leaveBalanceDays, 7);
  assert.equal(reversed.reversedChangeAmount, 1.5);
  assert.equal(reversed.reversalEntry.changeAmount, 1.5);
  assert.equal(reversed.deletedEntry.deleted, true);

  // Reversing again is idempotent and must not add another 1.5.
  const repeatedReverse =
    await reverseLeaveBalanceAdjustment(
      db,
      'main',
      deducted.createdEntry.id,
      {
        operationDate: '2026-08-14',
        reason: 'Repeated test reversal',
      },
      actor,
      {
        allowedSourceTypes: ['manual_adjustment'],
        expectedEmployeeId: 'emp-leave-ledger',
      }
    );

  assert.equal(repeatedReverse.idempotent, true);
  assert.equal(repeatedReverse.leaveBalanceDays, 7);

  const state = await getLeaveBalanceState(
    db,
    'main',
    'emp-leave-ledger',
    {
      includeDeleted: true,
      includeReversals: true,
      limit: 50,
    }
  );

  assert.equal(state.leaveBalance, 7);

  const ledgerRows = await db.prepare(`
    SELECT *
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND employee_id = 'emp-leave-ledger'
     ORDER BY created_at, id
  `).all();

  assert.equal(ledgerRows.results.length, 3);

  const originalDeduct = ledgerRows.results.find(
    (row) => row.id === 'ledger-deduct-1'
  );

  const reversal = ledgerRows.results.find(
    (row) =>
      row.source_type === 'reversal' &&
      row.source_id === 'ledger-deduct-1'
  );

  assert.ok(originalDeduct.deleted_at);
  assert.ok(reversal);
  assert.equal(Number(reversal.change_amount), 1.5);

  const employment = await db.prepare(`
    SELECT
      leave_balance,
      leave_balance_last_entry_id
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'emp-leave-ledger'
    LIMIT 1
  `).first();

  assert.equal(Number(employment.leave_balance), 7);
  assert.equal(
    employment.leave_balance_last_entry_id,
    reversal.id
  );

  // Insufficient balance must not create a ledger row
  // and must not mutate the employee balance.
  await assert.rejects(
    () =>
      adjustLeaveBalance(
        db,
        'main',
        'emp-leave-ledger',
        {
          id: 'ledger-too-large',
          actionType: 'deduct',
          days: 100,
          operationDate: '2026-08-14',
          sourceType: 'manual_adjustment',
          sourceId: 'test-too-large-source',
        },
        actor
      ),
    {
      code: 'core_leave_balance:insufficient_balance',
    }
  );

  const afterFailure = await db.prepare(`
    SELECT leave_balance
      FROM employee_employment
     WHERE salon_id = 'main'
       AND employee_id = 'emp-leave-ledger'
     LIMIT 1
  `).first();

  const failedLedger = await db.prepare(`
    SELECT id
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND id = 'ledger-too-large'
     LIMIT 1
  `).first();

  assert.equal(Number(afterFailure.leave_balance), 7);
  assert.equal(failedLedger, null);
});

test('approved Core leave deducts and restores canonical balance exactly once', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`
    INSERT INTO staff (
      id,
      salon_id,
      firebase_uid,
      name,
      active,
      employment_status,
      created_at,
      updated_at
    )
    VALUES (
      'emp-leave-flow',
      'main',
      'uid-leave-flow',
      'Leave Flow Employee',
      1,
      'active',
      '2026-01-01',
      '2026-01-01'
    )
  `).run();

  await upsertHrEmployee(
    db,
    'main',
    {
      id: 'emp-leave-flow',
      name: 'Leave Flow Employee',
      firebaseUid: 'uid-leave-flow',
      employment: {
        baseSalaryHalalas: 450000,
        leaveBalance: 5,
      },
    },
    actor
  );

  const leave = await createLeave(
    db,
    'main',
    {
      id: 'leave-flow-1',
      employeeId: 'emp-leave-flow',
      employeeUid: 'uid-leave-flow',
      leaveType: 'annual',
      startDate: '2026-08-20',
      endDate: '2026-08-21',
      daysCount: 2,
      deductFromBalance: true,
      affectsPayroll: false,
      employeeNote: 'Annual leave test',
    },
    actor
  );

  assert.equal(leave.status, 'pending');
  assert.equal(leave.deduct_from_balance, 1);

  const before = await db.prepare(`
    SELECT leave_balance
      FROM employee_employment
     WHERE salon_id = 'main'
       AND employee_id = 'emp-leave-flow'
  `).first();

  assert.equal(Number(before.leave_balance), 5);

  const approved = await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'approved',
      hrNote: 'Approved with deduction',
    },
    actor
  );

  assert.equal(approved.status, 'approved');
  assert.ok(approved.balance_adjustment_id);

  const afterApproval = await db.prepare(`
    SELECT
      leave_balance,
      leave_balance_last_entry_id
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'emp-leave-flow'
  `).first();

  assert.equal(
    Number(afterApproval.leave_balance),
    3
  );

  assert.equal(
    afterApproval.leave_balance_last_entry_id,
    approved.balance_adjustment_id
  );

  const originalLedger = await db.prepare(`
    SELECT *
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND source_type = 'leave_request'
       AND source_id = 'leave-flow-1'
     LIMIT 1
  `).first();

  assert.ok(originalLedger);
  assert.equal(
    Number(originalLedger.change_amount),
    -2
  );
  assert.equal(
    Number(originalLedger.balance_before),
    5
  );
  assert.equal(
    Number(originalLedger.balance_after),
    3
  );

  // Double approval cannot double-deduct.
  const approvedAgain = await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'approved',
      hrNote: 'Repeated approval',
    },
    actor
  );

  assert.equal(
    approvedAgain.idempotent,
    true
  );

  const afterRepeatedApproval =
    await db.prepare(`
      SELECT leave_balance
        FROM employee_employment
       WHERE salon_id = 'main'
         AND employee_id = 'emp-leave-flow'
    `).first();

  assert.equal(
    Number(
      afterRepeatedApproval.leave_balance
    ),
    3
  );

  // Rejecting an approved leave is cancellation.
  // It must restore exactly the same 2 days.
  const rejected = await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'rejected',
      hrNote: 'Cancelled after approval',
    },
    actor
  );

  assert.equal(
    rejected.status,
    'rejected'
  );

  const afterCancellation =
    await db.prepare(`
      SELECT
        leave_balance,
        leave_balance_last_entry_id
      FROM employee_employment
      WHERE salon_id = 'main'
        AND employee_id = 'emp-leave-flow'
    `).first();

  assert.equal(
    Number(afterCancellation.leave_balance),
    5
  );

  const reversal = await db.prepare(`
    SELECT *
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND source_type = 'reversal'
       AND source_id = ?
     LIMIT 1
  `).bind(
    originalLedger.id
  ).first();

  assert.ok(reversal);
  assert.equal(
    Number(reversal.change_amount),
    2
  );

  const originalAfterCancellation =
    await db.prepare(`
      SELECT *
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND id = ?
    `).bind(
      originalLedger.id
    ).first();

  assert.ok(
    originalAfterCancellation.deleted_at
  );

  // Double cancellation cannot restore twice.
  const rejectedAgain = await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'rejected',
      hrNote: 'Repeated cancellation',
    },
    actor
  );

  assert.equal(
    rejectedAgain.idempotent,
    true
  );

  const finalEmployment =
    await db.prepare(`
      SELECT leave_balance
        FROM employee_employment
       WHERE salon_id = 'main'
         AND employee_id = 'emp-leave-flow'
    `).first();

  assert.equal(
    Number(finalEmployment.leave_balance),
    5
  );

  const ledgerCount =
    await db.prepare(`
      SELECT COUNT(*) AS count
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND employee_id = 'emp-leave-flow'
    `).first();

  assert.equal(
    Number(ledgerCount.count),
    2
  );
});


test('Core leave approval fails closed when canonical leave balance is insufficient', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`
    INSERT INTO staff (
      id,
      salon_id,
      firebase_uid,
      name,
      active,
      employment_status,
      created_at,
      updated_at
    )
    VALUES (
      'emp-leave-low',
      'main',
      'uid-leave-low',
      'Low Leave Balance',
      1,
      'active',
      '2026-01-01',
      '2026-01-01'
    )
  `).run();

  await upsertHrEmployee(
    db,
    'main',
    {
      id: 'emp-leave-low',
      name: 'Low Leave Balance',
      firebaseUid: 'uid-leave-low',
      employment: {
        leaveBalance: 1,
      },
    },
    actor
  );

  const leave = await createLeave(
    db,
    'main',
    {
      id: 'leave-low-1',
      employeeId: 'emp-leave-low',
      employeeUid: 'uid-leave-low',
      leaveType: 'annual',
      startDate: '2026-08-25',
      endDate: '2026-08-26',
      daysCount: 2,
      deductFromBalance: true,
    },
    actor
  );

  await assert.rejects(
    () =>
      decideLeave(
        db,
        'main',
        leave.id,
        {
          status: 'approved',
          hrNote: 'Should fail',
        },
        actor
      ),
    {
      code:
        'core_leave:insufficient_balance',
    }
  );

  const latestLeave =
    await db.prepare(`
      SELECT *
        FROM employee_leaves
       WHERE salon_id = 'main'
         AND id = 'leave-low-1'
    `).first();

  assert.equal(
    latestLeave.status,
    'pending'
  );

  assert.equal(
    latestLeave.balance_adjustment_id,
    null
  );

  const employment =
    await db.prepare(`
      SELECT leave_balance
        FROM employee_employment
       WHERE salon_id = 'main'
         AND employee_id = 'emp-leave-low'
    `).first();

  assert.equal(
    Number(employment.leave_balance),
    1
  );

  const ledger =
    await db.prepare(`
      SELECT COUNT(*) AS count
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND source_type = 'leave_request'
         AND source_id = 'leave-low-1'
    `).first();

  assert.equal(
    Number(ledger.count),
    0
  );
});

test('Core employee leave request execution uses canonical leave ledger', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`
    INSERT INTO staff (
      id,
      salon_id,
      firebase_uid,
      name,
      active,
      employment_status,
      created_at,
      updated_at
    )
    VALUES (
      'emp-request-leave',
      'main',
      'uid-request-leave',
      'Request Leave Employee',
      1,
      'active',
      '2026-01-01',
      '2026-01-01'
    )
  `).run();

  await upsertHrEmployee(
    db,
    'main',
    {
      id: 'emp-request-leave',
      name: 'Request Leave Employee',
      firebaseUid: 'uid-request-leave',
      employment: {
        baseSalaryHalalas: 450000,
        leaveBalance: 5,
      },
    },
    actor
  );

  const employeeActor = {
    uid: 'uid-request-leave',
    employeeId: 'emp-request-leave',
    email: 'leave-request@example.com',
    name: 'Request Leave Employee',
    role: 'employee',
  };

  const adminActor = {
    ...actor,
    role: 'admin',
  };

  let request =
    await createEmployeeRequest(
      db,
      'main',
      {
        requestType: 'leave',
        payload: {
          leaveType: 'annual',
          startDate: '2026-09-10',
          endDate: '2026-09-11',
          durationKind: 'full_day',
          reason: 'Canonical employee request leave test',
        },
        idempotencyKey:
          'canonical-request-leave-1',
      },
      employeeActor
    );

  request =
    await transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'receive',
      {
        version: request.version,
      },
      adminActor
    );

  request =
    await transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'start-review',
      {
        version: request.version,
      },
      adminActor
    );

  request =
    await transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'approve',
      {
        version: request.version,
        note: 'Approved',
      },
      adminActor
    );

  request =
    await transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'execute',
      {
        version: request.version,
      },
      adminActor
    );

  assert.equal(
    request.status,
    'completed'
  );

  assert.equal(
    request.source_reference_type,
    'employee_leave'
  );

  const leave =
    await db.prepare(`
      SELECT *
        FROM employee_leaves
       WHERE salon_id = 'main'
         AND request_id = ?
       LIMIT 1
    `)
      .bind(request.id)
      .first();

  assert.ok(leave);

  assert.equal(
    leave.status,
    'approved'
  );

  assert.equal(
    Number(
      leave.deduct_from_balance
    ),
    1
  );

  assert.equal(
    Number(
      leave.affects_payroll
    ),
    0
  );

  assert.ok(
    leave.balance_adjustment_id
  );

  const employment =
    await db.prepare(`
      SELECT
        leave_balance,
        leave_balance_last_entry_id
      FROM employee_employment
      WHERE salon_id = 'main'
        AND employee_id =
              'emp-request-leave'
    `).first();

  assert.equal(
    Number(
      employment.leave_balance
    ),
    3
  );

  assert.equal(
    employment.leave_balance_last_entry_id,
    leave.balance_adjustment_id
  );

  const ledger =
    await db.prepare(`
      SELECT *
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND source_type = 'leave_request'
         AND source_id = ?
       LIMIT 1
    `)
      .bind(leave.id)
      .first();

  assert.ok(ledger);

  assert.equal(
    Number(
      ledger.change_amount
    ),
    -2
  );

  assert.equal(
    Number(
      ledger.balance_before
    ),
    5
  );

  assert.equal(
    Number(
      ledger.balance_after
    ),
    3
  );

  const count =
    await db.prepare(`
      SELECT COUNT(*) AS count
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND source_type = 'leave_request'
         AND source_id = ?
    `)
      .bind(leave.id)
      .first();

  assert.equal(
    Number(count.count),
    1
  );
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
  const compensationLedger = await db.prepare(`
    SELECT *
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND source_type =
             'exceptional_financial_payment'
       AND source_id = ?
     LIMIT 1
  `)
    .bind(request.id)
    .first();

  assert.ok(compensationLedger);

  assert.equal(
    Number(compensationLedger.days),
    3
  );

  assert.equal(
    Number(compensationLedger.change_amount),
    -3
  );

  assert.equal(
    Number(compensationLedger.balance_before),
    21
  );

  assert.equal(
    Number(compensationLedger.balance_after),
    18
  );

  const compensationEmployment = await db.prepare(`
    SELECT
      leave_balance,
      leave_balance_last_entry_id
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'emp-fin'
    LIMIT 1
  `).first();

  assert.equal(
    Number(compensationEmployment.leave_balance),
    18
  );

  assert.equal(
    compensationEmployment.leave_balance_last_entry_id,
    compensationLedger.id
  );

  const compensationLedgerCount = await db.prepare(`
    SELECT COUNT(*) AS count
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND source_type =
             'exceptional_financial_payment'
       AND source_id = ?
  `)
    .bind(request.id)
    .first();

  assert.equal(
    Number(compensationLedgerCount.count),
    1
  );

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

test('Core leave API separates manager routes from employee self scope', async () => {
  const source = await readFile(
    new URL(
      './core/index.js',
      import.meta.url
    ),
    'utf8'
  );

  const genericStart =
    source.indexOf(
      '    case "leaves":'
    );

  const genericEnd =
    source.indexOf(
      '    case "leave:approve":',
      genericStart
    );

  assert.ok(
    genericStart >= 0 &&
      genericEnd > genericStart
  );

  const genericBlock =
    source.slice(
      genericStart,
      genericEnd
    );

  assert.match(
    genericBlock,
    /requireAnyPermission\(ctx,[\s\S]*"attendance\.view"[\s\S]*"attendance\.leaves\.manage"[\s\S]*"payroll\.view"[\s\S]*"payroll\.manage"/
  );

  assert.match(
    genericBlock,
    /requirePermission\([\s\S]*ctx,[\s\S]*"attendance\.leaves\.manage"[\s\S]*\)/
  );


  const selfStart =
    source.indexOf(
      '    case "employee-portal:leaves":'
    );

  const selfEnd =
    source.indexOf(
      '    case "hr-employee:leave-balance":',
      selfStart
    );

  assert.ok(
    selfStart >= 0 &&
      selfEnd > selfStart
  );

  const selfBlock =
    source.slice(
      selfStart,
      selfEnd
    );

  assert.match(
    selfBlock,
    /employeeId:\s*ctx\.employeeId/
  );

  assert.doesNotMatch(
    selfBlock,
    /query\.employeeId/
  );

  assert.doesNotMatch(
    selfBlock,
    /body\.employeeId/
  );

  assert.match(
    source,
    /\/api\/core\/hr\/employee-portal\/leaves/
  );
});


test(
  'real D1 batch shift resolution matches single canonical resolution',
  async (t) => {
    const { mf, db } =
      await setup();

    t.after(
      () => mf.dispose()
    );

    const employeeId =
      'emp-shift-batch-parity';

    const noScheduleEmployeeId =
      'emp-shift-batch-none';

    const createdAt =
      '2026-08-01T00:00:00.000Z';

    await db.prepare(`
      INSERT INTO hr_shift_templates (
        id,
        salon_id,
        name,
        code,
        start_time,
        end_time,
        crosses_midnight,
        break_minutes,
        break_paid,
        late_grace_minutes,
        early_leave_grace_minutes,
        attendance_lock_enabled,
        attendance_lock_after_minutes,
        overtime_after_minutes,
        active,
        created_at,
        updated_at
      )
      VALUES (
        'shift-parity-base',
        'main',
        'Parity Base',
        'PARITY_BASE',
        '09:00',
        '17:00',
        0,
        45,
        0,
        7,
        0,
        1,
        35,
        60,
        1,
        ?,
        ?
      )
    `)
      .bind(
        createdAt,
        createdAt
      )
      .run();

    await db.prepare(`
      INSERT INTO hr_shift_templates (
        id,
        salon_id,
        name,
        code,
        start_time,
        end_time,
        crosses_midnight,
        break_minutes,
        break_paid,
        late_grace_minutes,
        early_leave_grace_minutes,
        attendance_lock_enabled,
        attendance_lock_after_minutes,
        overtime_after_minutes,
        active,
        created_at,
        updated_at
      )
      VALUES (
        'shift-parity-weekly',
        'main',
        'Parity Weekly',
        'PARITY_WEEKLY',
        '10:00',
        '18:00',
        0,
        30,
        0,
        5,
        0,
        1,
        40,
        30,
        1,
        ?,
        ?
      )
    `)
      .bind(
        createdAt,
        createdAt
      )
      .run();

    // Assignment fallback for the whole test window.
    await db.prepare(`
      INSERT INTO hr_shift_assignments (
        id,
        salon_id,
        employee_id,
        shift_template_id,
        effective_from,
        effective_to,
        assignment_type,
        status,
        reason,
        snapshot_json,
        created_by_uid,
        created_at,
        updated_at
      )
      VALUES (
        'assignment-parity',
        'main',
        ?,
        'shift-parity-base',
        '2026-08-01',
        '2026-08-31',
        'permanent',
        'published',
        'batch parity',
        '{}',
        'uid-test',
        ?,
        ?
      )
    `)
      .bind(
        employeeId,
        createdAt,
        createdAt
      )
      .run();

    // Sunday: active weekly schedule must beat assignment.
    await db.prepare(`
      INSERT INTO hr_work_schedules (
        id,
        salon_id,
        employee_id,
        weekday,
        start_time,
        end_time,
        active,
        effective_from,
        effective_to,
        created_at,
        updated_at,
        shift_template_id,
        schedule_source
      )
      VALUES (
        'weekly-parity-active',
        'main',
        ?,
        0,
        '10:00',
        '18:00',
        1,
        '2026-08-01',
        NULL,
        ?,
        ?,
        'shift-parity-weekly',
        'shift_template'
      )
    `)
      .bind(
        employeeId,
        createdAt,
        createdAt
      )
      .run();

    // Monday: inactive weekly row must become weekly off and beat assignment.
    await db.prepare(`
      INSERT INTO hr_work_schedules (
        id,
        salon_id,
        employee_id,
        weekday,
        start_time,
        end_time,
        active,
        effective_from,
        effective_to,
        created_at,
        updated_at,
        shift_template_id,
        schedule_source
      )
      VALUES (
        'weekly-parity-off',
        'main',
        ?,
        1,
        NULL,
        NULL,
        0,
        '2026-08-01',
        NULL,
        ?,
        ?,
        NULL,
        'weekly_off'
      )
    `)
      .bind(
        employeeId,
        createdAt,
        createdAt
      )
      .run();

    // Tuesday: approved off exception wins even with enabled=0.
    await db.prepare(`
      INSERT INTO hr_schedule_exceptions (
        id,
        salon_id,
        employee_id,
        date_from,
        date_to,
        exception_type,
        shift_template_id,
        enabled,
        start_time,
        end_time,
        note,
        status,
        approved_by_uid,
        created_by_uid,
        created_at,
        updated_at
      )
      VALUES (
        'exception-parity-off',
        'main',
        ?,
        '2026-08-18',
        '2026-08-18',
        'off',
        NULL,
        0,
        NULL,
        NULL,
        'off parity',
        'approved',
        'uid-test',
        'uid-test',
        ?,
        ?
      )
    `)
      .bind(
        employeeId,
        createdAt,
        createdAt
      )
      .run();

    // Wednesday: custom exception without template must inherit policy
    // from the assignment while preserving its custom hours.
    await db.prepare(`
      INSERT INTO hr_schedule_exceptions (
        id,
        salon_id,
        employee_id,
        date_from,
        date_to,
        exception_type,
        shift_template_id,
        enabled,
        start_time,
        end_time,
        note,
        status,
        approved_by_uid,
        created_by_uid,
        created_at,
        updated_at
      )
      VALUES (
        'exception-parity-custom',
        'main',
        ?,
        '2026-08-19',
        '2026-08-19',
        'custom',
        NULL,
        1,
        '12:00',
        '20:00',
        'custom parity',
        'approved',
        'uid-test',
        'uid-test',
        ?,
        ?
      )
    `)
      .bind(
        employeeId,
        createdAt,
        createdAt
      )
      .run();

    const employeeIds = [
      employeeId,
      noScheduleEmployeeId,
    ];

    const batch =
      await resolveEmployeeShiftsBatch(
        db,
        'main',
        {
          employeeIds,
          dateFrom:
            '2026-08-16',
          dateTo:
            '2026-08-21',
        }
      );

    assert.equal(
      batch.employees_count,
      2
    );

    assert.equal(
      batch.days_count,
      6
    );

    assert.equal(
      batch.rows.length,
      12
    );

    const cases = [
      {
        label:
          'active weekly schedule',
        employeeId,
        date:
          '2026-08-16',
        expectedSource:
          'weekly_schedule',
      },
      {
        label:
          'weekly off',
        employeeId,
        date:
          '2026-08-17',
        expectedSource:
          'weekly_schedule',
        expectedExceptionType:
          'off',
      },
      {
        label:
          'approved off exception',
        employeeId,
        date:
          '2026-08-18',
        expectedSource:
          'exception',
        expectedExceptionType:
          'off',
      },
      {
        label:
          'custom exception without template',
        employeeId,
        date:
          '2026-08-19',
        expectedSource:
          'exception',
        expectedExceptionType:
          'custom',
      },
      {
        label:
          'assignment fallback',
        employeeId,
        date:
          '2026-08-20',
        expectedSource:
          'assignment',
      },
      {
        label:
          'no schedule',
        employeeId:
          noScheduleEmployeeId,
        date:
          '2026-08-21',
        expectedSource:
          'none',
      },
    ];

    for (
      const testCase
      of cases
    ) {
      const single =
        await resolveEmployeeShift(
          db,
          'main',
          testCase.employeeId,
          testCase.date
        );

      const batched =
        batch.rows.find(
          (row) =>
            row.employee_id ===
              testCase.employeeId &&
            row.date ===
              testCase.date
        );

      assert.ok(
        batched,
        `missing batch row: ${testCase.label}`
      );

      assert.deepEqual(
        batched,
        single,
        `single/batch mismatch: ${testCase.label}`
      );

      assert.equal(
        batched.source,
        testCase.expectedSource,
        `wrong source: ${testCase.label}`
      );

      if (
        testCase.expectedExceptionType
      ) {
        assert.equal(
          batched.exception_type,
          testCase.expectedExceptionType,
          `wrong exception type: ${testCase.label}`
        );
      }
    }

    const custom =
      batch.rows.find(
        (row) =>
          row.employee_id ===
            employeeId &&
          row.date ===
            '2026-08-19'
      );

    assert.equal(
      custom.start_time,
      '12:00'
    );

    assert.equal(
      custom.end_time,
      '20:00'
    );

    assert.equal(
      custom.late_grace_minutes,
      7
    );

    assert.equal(
      custom.attendance_lock_enabled,
      1
    );

    assert.equal(
      custom.attendance_lock_after_minutes,
      35
    );

    assert.equal(
      custom.break_minutes,
      45
    );

    assert.equal(
      custom.overtime_after_minutes,
      60
    );
  }
);
