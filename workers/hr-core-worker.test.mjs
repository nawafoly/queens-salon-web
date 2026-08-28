import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { normalizeError } from './core/errors.js';
import { upsertHrEmployee, replaceHrSchedules } from './core/repositories/hr-employees.js';
import {
  createScheduleException,
  resolveEmployeeShift,
  resolveEmployeeShiftsBatch,
  saveShiftTemplate,
  updateScheduleException,
} from './core/repositories/shift-control.js';
import { getAttendanceState, recordAttendance } from './core/repositories/attendance.js';
import { setAnnualLeaveOpeningBalance } from './core/repositories/annual-leave.js';
import { createLeave, decideLeave } from './core/repositories/leaves.js';
import {
  adjustLeaveBalance,
  getLeaveBalanceState,
  reverseLeaveBalanceAdjustment,
} from './core/repositories/leave-balance.js';
import { createAbsence } from './core/repositories/absences.js';
import {
  approvePayrollEntry,
  deferAttendanceDeduction,
  listPayrollCarryoverAdjustments,
  markPayrollEntryPaid,
  reconcilePayrollCarryoversBatch,
  upsertPayrollEntry,
  upsertPayrollPeriod,
} from './core/repositories/payroll.js';
import {
  createPayrollObligation,
  deferPayrollObligationInstallment,
  listPayrollObligationDeductions,
  listPayrollObligations,
  listPayrollRecurringDeductions,
  savePayrollRecurringDeduction,
} from './core/repositories/payroll-obligations.js';
import {
  classifyPayrollObligationDeduction,
  classifyRecurringPayrollDeduction,
} from './core/repositories/payroll-deduction-compliance.js';
import { deferSalaryAdvanceInstallment } from './core/repositories/salary-advance-deferrals.js';
import { calculateGosi } from '../src/helpers/hr/gosiPolicy.js';
import { getSetting, upsertSetting } from './core/repositories/settings.js';
import { createFileMetadata, getFileContent, patchFileMetadata, putFileContent } from './core/repositories/files.js';
import { createBooking, getPublicBookingTrack, rescheduleBooking } from './core/repositories/bookings.js';
import { createEmployeeRequest, getEmployeeRequestPayrollImpact, getExceptionalFinancialPaymentPreview, transitionEmployeeRequest } from './core/repositories/employee-requests.js';
import {
  createEmployeeMessage,
  createEmployeeNotification,
  createRecruitmentApplication,
  listEmployeeMessages,
  listEmployeeNotifications,
  listRecruitmentApplications,
  markEmployeeNotificationRead,
  markEmployeeThreadRead,
  patchRecruitmentApplication,
} from './core/repositories/workforce-communications.js';

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
    '0025_employee_request_reference_integrity.sql',
    '0026_employee_master_profile_fields.sql',
    '0027_employee_attendance_payroll_mode.sql',
    '0028_payroll_approval_snapshots_carryovers.sql',
    '0029_payroll_social_insurance_snapshots.sql',
    '0030_employee_payroll_obligations.sql',
    '0031_workforce_communications_recruitment.sql',
    '0032_service_season_price.sql',
    '0033_app_user_profile_photo.sql',
    '0034_employee_offboarding_invariants.sql',
    '0035_salary_advance_installment_deferrals.sql',
    '0036_attendance_deduction_deferral_integrity.sql',
    '0037_payroll_obligation_settlement_concurrency.sql',
    '0038_sa_labor_compliance_foundation.sql',
    '0039_sa_leave_rest_holiday_runtime.sql',
    '0040_sa_annual_leave_opening_anchor.sql',
    '0041_sa_sick_leave_runtime_lifecycle.sql',
    '0042_sa_weekly_rest_public_holiday_workflow.sql',
    '0043_sa_overtime_request_runtime.sql',
    '0044_sa_overtime_reconciliation_comp_time.sql',
    '0045_payroll_reconciled_overtime_authority.sql',
    '0046_payroll_reconciled_overtime_approval_guards.sql',
    '0047_leave_time_entitlement_consumption.sql',
    '0048_sa_special_statutory_leave_validation.sql',
    '0049_public_holiday_leave_overlap.sql',
    '0050_sa_sensitive_family_leave_runtime.sql',
    '0051_sa_payroll_deduction_compliance.sql',
    '0052_sa_payroll_deduction_classification_audit.sql',
    '0053_sa_disciplinary_fine_runtime.sql',
    '0054_sa_disciplinary_fine_fund_custody.sql',
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
const TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE = '2026-08-28';

async function seedAnnualLeaveOpeningBalance(
  db,
  employeeId,
  days,
  operationId = `opening-${employeeId}`
) {
  return setAnnualLeaveOpeningBalance(
    db,
    'main',
    employeeId,
    {
      days,
      effectiveDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
      operationId,
      reason: 'Regression fixture opening balance anchor',
    },
    actor
  );
}

async function withFixedRiyadhDate(testContext, callback) {
  if (typeof testContext === 'function') {
    callback = testContext;
    testContext = null;
  }
  const RealDate = globalThis.Date;
  const fixedIso = `${TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE}T12:00:00.000Z`;
  if (testContext?.mock?.timers) {
    testContext.mock.timers.enable({
      apis: ['Date'],
      now: new RealDate(fixedIso),
    });
    try {
      return await callback();
    } finally {
      testContext.mock.timers.reset();
    }
  }

  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedIso]));
    }

    static now() {
      return new RealDate(fixedIso).getTime();
    }
  }
  FixedDate.UTC = RealDate.UTC;
  FixedDate.parse = RealDate.parse;
  globalThis.Date = FixedDate;
  try {
    return await callback();
  } finally {
    globalThis.Date = RealDate;
  }
}

function nonSaudiGosiPayrollFields({
  payrollDate,
  basicSalaryHalalas,
  housingAllowanceHalalas = 0,
}) {
  const snapshot = calculateGosi({
    insuranceCategory: 'non_saudi',
    payrollDate,
    basicSalaryHalalas,
    housingAllowanceHalalas,
    transportationAllowanceHalalas: 0,
    otherAllowancesHalalas: 0,
    wageMode: 'derived',
  });
  return {
    insuranceDeductionHalalas: snapshot.employee.deductionHalalas,
    employerGosiContributionHalalas: snapshot.employer.contributionHalalas,
    gosiSnapshot: snapshot,
  };
}

async function seedNonSaudiPayrollEmployment(db, employeeId, baseSalaryHalalas) {
  const now = '2026-01-01T00:00:00.000Z';
  await db.prepare(`INSERT INTO employee_profiles
    (id, salon_id, name, status, created_at, updated_at)
    VALUES (?, 'main', ?, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'active',
      updated_at = excluded.updated_at`)
    .bind(employeeId, `Payroll ${employeeId}`, now, now)
    .run();
  await db.prepare(`INSERT INTO employee_employment
    (salon_id, employee_id, base_salary_halalas, expected_work_days, expected_work_hours,
     daily_scheduled_hours, attendance_payroll_mode, attendance_payroll_exemption_reason,
     social_insurance_category, social_insurance_effective_from, gosi_wage_mode, created_at, updated_at)
    VALUES ('main', ?, ?, 30, 240, 8, 'exempt', 'Payroll settlement fixture isolates non-attendance behavior',
            'non_saudi', '2026-01-01', 'derived', ?, ?)
    ON CONFLICT(salon_id, employee_id) DO UPDATE SET
      base_salary_halalas = excluded.base_salary_halalas,
      expected_work_days = excluded.expected_work_days,
      expected_work_hours = excluded.expected_work_hours,
      daily_scheduled_hours = excluded.daily_scheduled_hours,
      attendance_payroll_mode = excluded.attendance_payroll_mode,
      attendance_payroll_exemption_reason = excluded.attendance_payroll_exemption_reason,
      social_insurance_category = excluded.social_insurance_category,
      social_insurance_effective_from = excluded.social_insurance_effective_from,
      gosi_wage_mode = excluded.gosi_wage_mode,
      employment_status = 'active',
      updated_at = excluded.updated_at`)
    .bind(employeeId, baseSalaryHalalas, now, now)
    .run();
}

test('Phase 6 HR employee, attendance, leave, absence and payroll use Core D1', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, created_at, updated_at)
    VALUES ('emp-1','main','uid-1','Employee 1','0500000001',1,'active','2026-01-01','2026-01-01')`).run();

  const employee = await upsertHrEmployee(db, 'main', {
    id: 'emp-1', name: 'Employee 1', firebaseUid: 'uid-1', phone: '0500000001',
    employment: {
      title: 'Stylist',
      startDate: '2025-01-01',
      baseSalaryHalalas: 450000,
      housingAllowanceHalalas: 50000,
      leaveBalance: 21,
      socialInsuranceCategory: 'non_saudi',
      socialInsuranceEffectiveFrom: '2026-01-01',
      socialInsuranceClassificationNote: 'Test non-Saudi payroll classification',
      gosiWageMode: 'derived',
    },
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

  await seedAnnualLeaveOpeningBalance(db, 'emp-1', 21);

  const leave = await createLeave(db, 'main', {
    id: 'leave-1', employeeId: 'emp-1', employeeUid: 'uid-1', leaveType: 'annual',
    startDate: '2026-08-01', endDate: '2026-08-02', employeeNote: 'Vacation',
  }, actor);
  const approved = await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'approved',
      hrNote: 'Approved',
      entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
    },
    actor
  );
  assert.equal(approved.status, 'approved');
  const canonicalLeave = await db
    .prepare("SELECT status, start_date, end_date FROM employee_leaves WHERE id='leave-1'")
    .first();

  assert.equal(canonicalLeave.status, 'approved');
  assert.equal(canonicalLeave.start_date, '2026-08-01');
  assert.equal(canonicalLeave.end_date, '2026-08-02');

  const staffLeaveMirror = await db
    .prepare("SELECT leave_start_date, leave_end_date FROM staff WHERE id='emp-1'")
    .first();

  assert.equal(staffLeaveMirror.leave_start_date, null);
  assert.equal(staffLeaveMirror.leave_end_date, null);

  const absence = await createAbsence(db, 'main', { id: 'absence-1', employeeId: 'emp-1', date: '2026-07-15', type: 'half_day' }, actor);
  assert.equal(absence.absence_type, 'half_day');

  const period = await upsertPayrollPeriod(db, 'main', {
    id: 'period-2026-07', payrollMonth: '2026-07', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  }, actor);
  const payroll = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-1', periodId: period.id, employeeId: 'emp-1', payrollMonth: '2026-07',
    baseSalaryHalalas: 450000, allowancesHalalas: 50000, grossSalaryHalalas: 500000,
    totalDeductionsHalalas: 0, finalSalaryHalalas: 500000,
    ...nonSaudiGosiPayrollFields({ payrollDate: '2026-07-28', basicSalaryHalalas: 450000 }),
  }, actor);
  assert.equal(payroll.final_salary_halalas, 500000);
  await assert.rejects(
    () => approvePayrollEntry(db, 'main', payroll.id, actor),
    { code: 'core_payroll:setup_incomplete' }
  );

  await upsertHrEmployee(db, 'main', {
    id: 'emp-1',
    name: 'Employee 1 Updated',
    employment: {
      expectedWorkDays: 26,
      expectedWorkHours: 208,
      dailyScheduledHours: 8,
    },
  }, actor);
  for (const date of ['2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30']) {
    await recordAttendance(db, 'main', {
      employeeId: 'emp-1', employeeUid: 'uid-1', type: 'check_in', date,
      recordedAt: `${date}T09:00:00.000Z`, idempotencyKey: `emp-1-${date}-in`,
    }, actor);
    await recordAttendance(db, 'main', {
      employeeId: 'emp-1', employeeUid: 'uid-1', type: 'check_out', date,
      recordedAt: `${date}T17:00:00.000Z`, idempotencyKey: `emp-1-${date}-out`,
    }, actor);
  }

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
    ...nonSaudiGosiPayrollFields({ payrollDate: '2026-08-28', basicSalaryHalalas: 450000 }),
    attendanceSummary: {
      totalScheduledHours: 8,
      totalActualWorkedHours: 8,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 1,
      absentDays: 0,
      incompleteDays: 0,
      attendanceRecordCount: 2,
      attendanceLinkStatus: 'confirmed',
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
      attendanceNotes: [],
    },
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

  const approvalSnapshot = await db.prepare(
    `SELECT approved_net_halalas, approval_version
       FROM payroll_approval_snapshots
      WHERE salon_id = 'main' AND payroll_entry_id = ?
      ORDER BY approval_version DESC LIMIT 1`
  ).bind(readyPayroll.id).first();
  assert.equal(Number(approvalSnapshot.approved_net_halalas), 500000);
  assert.equal(Number(approvalSnapshot.approval_version), 1);

  await createAbsence(db, 'main', {
    id: 'absence-after-approval',
    employeeId: 'emp-1',
    date: '2026-08-10',
    type: 'full_day',
  }, actor);
  const expectedCarryoverDeductionHalalas = Number(approvedPayroll.daily_rate_halalas);

  const reconciled = await reconcilePayrollCarryoversBatch(db, 'main', {
    items: [{
      sourcePayrollEntryId: readyPayroll.id,
      targetPayrollMonth: '2026-09',
      recalculatedNetHalalas: 490000,
      sourceDate: '2026-08-31',
      reason: 'غياب ظهر بعد الاعتماد المبكر',
    }],
  }, actor);
  assert.equal(reconciled.results.length, 1);
  assert.equal(
    reconciled.results[0].recalculatedNetHalalas,
    500000 - expectedCarryoverDeductionHalalas
  );
  assert.equal(
    reconciled.results[0].residualSignedHalalas,
    -expectedCarryoverDeductionHalalas
  );
  assert.equal(reconciled.results[0].adjustment.direction, 'deduction');
  assert.equal(
    Number(reconciled.results[0].adjustment.amount_halalas),
    expectedCarryoverDeductionHalalas
  );

  const reconciledAgain = await reconcilePayrollCarryoversBatch(db, 'main', {
    items: [{
      sourcePayrollEntryId: readyPayroll.id,
      targetPayrollMonth: '2026-09',
      recalculatedNetHalalas: 490000,
      sourceDate: '2026-08-31',
    }],
  }, actor);
  assert.equal(reconciledAgain.results[0].adjustment.id, reconciled.results[0].adjustment.id);
  const carryovers = await listPayrollCarryoverAdjustments(db, 'main', {
    employeeId: 'emp-1',
    targetPayrollMonth: '2026-09',
    status: 'pending',
  });
  assert.equal(carryovers.length, 1);
  assert.equal(
    Number(carryovers[0].amount_halalas),
    expectedCarryoverDeductionHalalas
  );

  const paidPayroll = await markPayrollEntryPaid(db, 'main', readyPayroll.id, actor);
  assert.equal(paidPayroll.status, 'paid');
});

test('payroll obligations API contract is canonical, traceable and settlement-safe', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-obligation','main','uid-obligation','Obligation Employee',1,'active','2026-01-01','2026-01-01')`).run();

  await upsertHrEmployee(db, 'main', {
    id: 'emp-obligation',
    name: 'Obligation Employee',
    firebaseUid: 'uid-obligation',
    employment: {
      baseSalaryHalalas: 500000,
      expectedWorkDays: 30,
      expectedWorkHours: 240,
      dailyScheduledHours: 8,
      attendancePayrollMode: 'exempt',
      attendancePayrollExemptionReason: 'Obligation test isolates deduction snapshot behavior',
      socialInsuranceCategory: 'non_saudi',
      socialInsuranceEffectiveFrom: '2026-01-01',
      socialInsuranceClassificationNote: 'Stage 5.1 test classification',
      gosiWageMode: 'derived',
    },
  }, actor);

  await assert.rejects(
    () => savePayrollRecurringDeduction(db, 'main', {
      employeeId: 'emp-obligation',
      title: 'Missing actor deduction',
      deductionKind: 'loan',
      amountHalalas: 10000,
      startPayrollMonth: '2026-09',
      reason: 'Must be audited',
    }, {}),
    { code: 'core_payroll:deduction_actor_required' }
  );

  const recurring = await savePayrollRecurringDeduction(db, 'main', {
    employeeId: 'emp-obligation',
    title: 'Fixed monthly deduction',
    deductionKind: 'loan',
    amountHalalas: 60000,
    startPayrollMonth: '2026-09',
    reason: 'Approved fixed monthly obligation',
    sourceType: 'manual',
  }, actor);
  assert.equal(recurring.amountHalalas, 60000);
  await classifyRecurringPayrollDeduction(db, 'main', recurring.id, {
    laborDeductionClass: 'other_with_written_consent',
    writtenConsentReference: 'consent-recurring-obligation',
    reason: 'Regression fixture written consent for recurring deduction',
  }, actor);
  assert.equal((await listPayrollRecurringDeductions(db, 'main', {
    employeeId: 'emp-obligation',
  })).length, 1);

  let septemberDeductions = await listPayrollObligationDeductions(db, 'main', {
    employeeId: 'emp-obligation',
    payrollMonth: '2026-09',
  });
  assert.equal(septemberDeductions.length, 1);
  assert.equal(septemberDeductions[0].synthetic, true);
  assert.equal(septemberDeductions[0].amountHalalas, 60000);

  const installmentPlan = await createPayrollObligation(db, 'main', {
    employeeId: 'emp-obligation',
    kind: 'loan',
    originalPayrollMonth: '2026-08',
    amountHalalas: 120000,
    reason: 'Three-month installment plan',
    sourceType: 'manual',
    installments: [
      { targetPayrollMonth: '2026-09', amountHalalas: 40000 },
      { targetPayrollMonth: '2026-10', amountHalalas: 40000 },
      { targetPayrollMonth: '2026-11', amountHalalas: 40000 },
    ],
  }, actor);
  assert.deepEqual(
    installmentPlan.installments.map((item) => item.amountHalalas),
    [40000, 40000, 40000]
  );
  await classifyPayrollObligationDeduction(db, 'main', installmentPlan.id, {
    laborDeductionClass: 'other_with_written_consent',
    writtenConsentReference: 'consent-installment-obligation',
    reason: 'Regression fixture written consent for installment deduction',
  }, actor);

  const septemberInstallment = installmentPlan.installments.find(
    (item) => item.targetPayrollMonth === '2026-09'
  );
  const deferredPlan = await deferPayrollObligationInstallment(
    db,
    'main',
    septemberInstallment.id,
    { targetPayrollMonth: '2026-12', reason: 'Employee-approved deferral' },
    actor
  );
  assert.equal(
    deferredPlan.installments.find((item) => item.id === septemberInstallment.id).status,
    'deferred'
  );
  const replacement = deferredPlan.installments.find(
    (item) => item.deferredFromInstallmentId === septemberInstallment.id
  );
  assert.equal(replacement.targetPayrollMonth, '2026-12');
  assert.equal(replacement.amountHalalas, 40000);

  await assert.rejects(
    () => deferPayrollObligationInstallment(
      db,
      'main',
      replacement.id,
      { targetPayrollMonth: '2026-11', reason: 'Invalid backward move' },
      actor
    ),
    { code: 'core_payroll:deferred_deduction_target_must_be_later' }
  );

  const octoberInstallment = installmentPlan.installments.find(
    (item) => item.targetPayrollMonth === '2026-10'
  );
  const octoberPeriod = await upsertPayrollPeriod(db, 'main', {
    id: 'period-obligation-2026-10',
    payrollMonth: '2026-10',
    monthStart: '2026-10-01',
    monthEnd: '2026-10-31',
  }, actor);
  const octoberDraft = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-obligation-2026-10',
    periodId: octoberPeriod.id,
    employeeId: 'emp-obligation',
    employeeName: 'Obligation Employee',
    payrollMonth: '2026-10',
    baseSalaryHalalas: 500000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyRateHalalas: 16667,
    hourlyRateHalalas: 2083,
    grossSalaryHalalas: 500000,
    netSalaryHalalas: 460000,
    finalSalaryHalalas: 460000,
    attendanceSummary: {
      totalScheduledHours: 8,
      totalActualWorkedHours: 8,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 1,
      absentDays: 0,
      incompleteDays: 0,
      attendanceRecordCount: 2,
      attendanceLinkStatus: 'confirmed',
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
      attendanceNotes: [],
    },
    scheduleSnapshot: {
      workDays: 30,
      monthlyHours: 240,
      dailyScheduledHours: 8,
      payrollSetupComplete: true,
      payrollSetupMissing: [],
      monthlyHoursSource: 'configured_monthly_hours',
    },
    ...nonSaudiGosiPayrollFields({ payrollDate: '2026-10-28', basicSalaryHalalas: 500000 }),
    skipTargetBonus: true,
  }, actor);
  assert.equal(Number(octoberDraft.manual_deductions_halalas), 100000);

  await deferPayrollObligationInstallment(
    db,
    'main',
    octoberInstallment.id,
    { targetPayrollMonth: '2027-01', reason: 'Schedule changed before approval' },
    actor
  );
  const octoberApproved = await approvePayrollEntry(db, 'main', octoberDraft.id, actor);
  assert.equal(octoberApproved.status, 'approved');
  assert.equal(Number(octoberApproved.manual_deductions_halalas), 60000);
  assert.equal(
    JSON.parse(String(octoberApproved.deductions_json || '[]'))
      .filter((item) => String(item?.sourceType || item?.source_type || '') === 'payroll_obligation')
      .reduce((sum, item) => sum + Number(item?.amountHalalas ?? item?.amount_halalas ?? item?.amount ?? 0), 0),
    60000
  );

  await assert.rejects(
    () => createPayrollObligation(db, 'main', {
      employeeId: 'emp-obligation',
      kind: 'gosi',
      originalPayrollMonth: '2026-09',
      amountHalalas: 10000,
      reason: 'GOSI must stay statutory',
    }, actor),
    (error) => {
      const normalized = normalizeError(error);
      assert.equal(normalized.status, 400);
      assert.equal(normalized.code, 'core_payroll:statutory_deduction_not_deferrable');
      return true;
    }
  );

  await assert.rejects(
    () => createPayrollObligation(db, 'main', {
      employeeId: 'emp-obligation',
      kind: 'loan',
      originalPayrollMonth: '2026-13',
      amountHalalas: 10000,
      reason: 'Invalid month must be a client error',
    }, actor),
    (error) => {
      const normalized = normalizeError(error);
      assert.equal(normalized.status, 400);
      assert.equal(normalized.code, 'core_payroll:payroll_month_invalid');
      return true;
    }
  );

  const idempotent = await createPayrollObligation(db, 'main', {
    employeeId: 'emp-obligation',
    kind: 'loan',
    originalPayrollMonth: '2026-09',
    amountHalalas: 50000,
    reason: 'One-time request deduction',
    sourceType: 'employee_request',
    sourceRef: 'request-obligation-1',
  }, actor);
  const idempotentRetry = await createPayrollObligation(db, 'main', {
    employeeId: 'emp-obligation',
    kind: 'loan',
    originalPayrollMonth: '2026-09',
    amountHalalas: 50000,
    reason: 'One-time request deduction',
    sourceType: 'employee_request',
    sourceRef: 'request-obligation-1',
  }, actor);
  assert.equal(idempotentRetry.id, idempotent.id);
  await classifyPayrollObligationDeduction(db, 'main', idempotent.id, {
    laborDeductionClass: 'other_with_written_consent',
    writtenConsentReference: 'consent-idempotent-obligation',
    reason: 'Regression fixture written consent for idempotent deduction',
  }, actor);
  await assert.rejects(
    () => createPayrollObligation(db, 'main', {
      employeeId: 'emp-obligation',
      kind: 'loan',
      originalPayrollMonth: '2026-09',
      amountHalalas: 70000,
      reason: 'One-time request deduction',
      sourceType: 'employee_request',
      sourceRef: 'request-obligation-1',
    }, actor),
    { code: 'core_payroll:obligation_idempotency_conflict' }
  );

  septemberDeductions = await listPayrollObligationDeductions(db, 'main', {
    employeeId: 'emp-obligation',
    payrollMonth: '2026-09',
  });
  assert.equal(
    septemberDeductions.reduce((sum, item) => sum + Number(item.amountHalalas || 0), 0),
    110000
  );

  const period = await upsertPayrollPeriod(db, 'main', {
    id: 'period-obligation-2026-09',
    payrollMonth: '2026-09',
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  }, actor);
  const payroll = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-obligation-2026-09',
    periodId: period.id,
    employeeId: 'emp-obligation',
    employeeName: 'Obligation Employee',
    payrollMonth: '2026-09',
    baseSalaryHalalas: 500000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyRateHalalas: 16667,
    hourlyRateHalalas: 2083,
    grossSalaryHalalas: 500000,
    netSalaryHalalas: 390000,
    finalSalaryHalalas: 390000,
    attendanceSummary: {
      totalScheduledHours: 8,
      totalActualWorkedHours: 8,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 1,
      absentDays: 0,
      incompleteDays: 0,
      attendanceRecordCount: 2,
      attendanceLinkStatus: 'confirmed',
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
      attendanceNotes: [],
    },
    scheduleSnapshot: {
      workDays: 30,
      monthlyHours: 240,
      dailyScheduledHours: 8,
      payrollSetupComplete: true,
      payrollSetupMissing: [],
      monthlyHoursSource: 'configured_monthly_hours',
    },
    ...nonSaudiGosiPayrollFields({ payrollDate: '2026-09-28', basicSalaryHalalas: 500000 }),
    skipTargetBonus: true,
  }, actor);
  assert.equal(Number(payroll.manual_deductions_halalas), 110000);
  assert.equal(Number(payroll.total_deductions_halalas), 110000);
  assert.equal(Number(payroll.net_salary_halalas), 390000);

  const approved = await approvePayrollEntry(db, 'main', payroll.id, actor);
  assert.equal(approved.status, 'approved');

  await assert.rejects(
    () => deferPayrollObligationInstallment(
      db,
      'main',
      idempotent.installments[0].id,
      { targetPayrollMonth: '2026-10', reason: 'Cannot edit approved payroll' },
      actor
    ),
    { code: 'core_payroll:obligation_target_payroll_locked' }
  );

  const paid = await markPayrollEntryPaid(db, 'main', payroll.id, actor);
  assert.equal(paid.status, 'paid');
  let obligations = await listPayrollObligations(db, 'main', {
    employeeId: 'emp-obligation',
  });
  const settledOneTime = obligations.find((item) => item.id === idempotent.id);
  assert.equal(settledOneTime.status, 'settled');
  assert.equal(settledOneTime.remainingAmountHalalas, 0);
  assert.equal(settledOneTime.installments[0].status, 'applied');
  const recurringSeptember = obligations.find(
    (item) => item.recurringDeductionId === recurring.id && item.originalPayrollMonth === '2026-09'
  );
  assert.equal(recurringSeptember.status, 'settled');
  assert.equal(recurringSeptember.remainingAmountHalalas, 0);

  await markPayrollEntryPaid(db, 'main', payroll.id, actor);
  obligations = await listPayrollObligations(db, 'main', {
    employeeId: 'emp-obligation',
  });
  assert.equal(
    obligations.find((item) => item.id === idempotent.id).remainingAmountHalalas,
    0
  );

  const coreIndexSource = await readFile(new URL('./core/index.js', import.meta.url), 'utf8');
  assert.match(
    coreIndexSource,
    /case "payroll-obligations":[\s\S]*?requireAnyPermission\(ctx, \["payroll\.view", "payroll\.manage"\]\)[\s\S]*?requirePermission\(ctx, "payroll\.manage"\)/
  );
  assert.match(
    coreIndexSource,
    /case "payroll-obligation-installment:defer":[\s\S]*?requirePermission\(ctx, "payroll\.manage"\)/
  );
  assert.match(
    coreIndexSource,
    /case "payroll-obligation-deductions":[\s\S]*?requireAnyPermission\(ctx, \["payroll\.view", "payroll\.manage"\]\)/
  );
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
        startDate: '2025-01-01',
        baseSalaryHalalas: 450000,
        leaveBalance: 5,
      },
    },
    actor
  );

  await seedAnnualLeaveOpeningBalance(db, 'emp-leave-flow', 5);

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
      entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
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
      entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
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
      entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
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
       AND source_type = 'leave_reversal'
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
    originalAfterCancellation
  );
  assert.equal(
    originalAfterCancellation.deleted_at,
    null
  );

  // Double cancellation cannot restore twice.
  const rejectedAgain = await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'rejected',
      hrNote: 'Repeated cancellation',
      entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
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
    3
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
        startDate: '2025-01-01',
        leaveBalance: 1,
      },
    },
    actor
  );

  await seedAnnualLeaveOpeningBalance(db, 'emp-leave-low', 1);

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
          entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
        },
        actor
      ),
    {
      code:
        'core_annual_leave:insufficient_available_entitlement',
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
        startDate: '2025-01-01',
        baseSalaryHalalas: 450000,
        leaveBalance: 5,
      },
    },
    actor
  );

  await seedAnnualLeaveOpeningBalance(db, 'emp-request-leave', 5);

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
    await withFixedRiyadhDate(t, () => transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'approve',
      {
        version: request.version,
        note: 'Approved',
        entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
      },
      adminActor
    ));

  request =
    await withFixedRiyadhDate(t, () => transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'execute',
      {
        version: request.version,
      },
      adminActor
    ));

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

  await decideLeave(
    db,
    'main',
    leave.id,
    {
      status: 'rejected',
      hrNote: 'Cancel completed leave and restore balance',
      entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
    },
    adminActor
  );

  request =
    await transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'cancel',
      {
        version: request.version,
        note: 'Cancel completed leave and restore balance',
        entitlementAsOfDate: TEST_ANNUAL_LEAVE_ENTITLEMENT_AS_OF_DATE,
      },
      adminActor
    );

  assert.equal(request.status, 'cancelled');
  assert.equal(request.execution_status, 'cancelled');

  const cancelledLeave =
    await db.prepare(`
      SELECT *
        FROM employee_leaves
       WHERE salon_id = 'main'
         AND request_id = ?
       LIMIT 1
    `)
      .bind(request.id)
      .first();

  assert.equal(cancelledLeave.status, 'rejected');

  const requestReversal =
    await db.prepare(`
      SELECT *
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND source_type = 'leave_reversal'
         AND source_id = ?
       LIMIT 1
    `)
      .bind(leave.balance_adjustment_id)
      .first();

  assert.ok(requestReversal);
  assert.equal(Number(requestReversal.change_amount), 2);

  const restoredEmployment =
    await db.prepare(`
      SELECT leave_balance
        FROM employee_employment
       WHERE salon_id = 'main'
         AND employee_id = 'emp-request-leave'
    `).first();

  assert.equal(
    Number(restoredEmployment.leave_balance),
    Number(requestReversal.balance_after)
  );

  const reversalCount =
    await db.prepare(`
      SELECT COUNT(*) AS count
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND source_type = 'leave_reversal'
         AND source_id = ?
    `)
      .bind(leave.balance_adjustment_id)
      .first();

  assert.equal(Number(reversalCount.count), 1);

  const repeatedCancel =
    await transitionEmployeeRequest(
      db,
      'main',
      request.id,
      'cancel',
      { version: request.version },
      adminActor
    );

  assert.equal(repeatedCancel.status, 'cancelled');

  const repeatedReversalCount =
    await db.prepare(`
      SELECT COUNT(*) AS count
        FROM employee_leave_balance_ledger
       WHERE salon_id = 'main'
         AND source_type = 'leave_reversal'
         AND source_id = ?
    `)
      .bind(leave.balance_adjustment_id)
      .first();

  assert.equal(Number(repeatedReversalCount.count), 1);
});

test('annual leave cash compensation preview is blocked during active service', async (t) => {
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
      startDate: '2025-01-01',
      baseSalaryHalalas: 450000,
      leaveBalance: 21,
    },
  }, actor);

  await assert.rejects(
    () => getExceptionalFinancialPaymentPreview(
      db,
      'main',
      'emp-preview',
      3
    ),
    {
      code:
        'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
    }
  );

  const balance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-preview'").first();
  assert.equal(Number(balance.leave_balance), 21);
  const payments = await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-preview'").first();
  assert.equal(Number(payments.count), 0);
});

test('annual leave cash compensation create is blocked and leaves payroll untouched', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, created_at, updated_at)
    VALUES ('emp-fin','main','uid-fin','Financial Employee','0500000099',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-fin', name: 'Financial Employee', firebaseUid: 'uid-fin', phone: '0500000099',
    employment: {
      startDate: '2025-01-01',
      title: 'Stylist',
      baseSalaryHalalas: 450000,
      leaveBalance: 21,
      socialInsuranceCategory: 'non_saudi',
      socialInsuranceEffectiveFrom: '2026-01-01',
      socialInsuranceClassificationNote: 'Financial compensation test classification',
      gosiWageMode: 'derived',
    },
  }, actor);
  await seedAnnualLeaveOpeningBalance(db, 'emp-fin', 21);

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
  await assert.rejects(
    () => createEmployeeRequest(db, 'main', {
    requestType: 'exceptional_financial_payment',
    payload: {
      requestedDays: 3,
      reason: 'احتياج مالي استثنائي',
      notes: 'اختبار تكامل',
      acknowledgement: true,
      employeeSignatureDataUrl: `data:image/png;base64,${'a'.repeat(300)}`,
    },
      idempotencyKey: 'financial-payment-test-1',
    }, employeeActor),
    {
      code:
        'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
    }
  );

  const blockedBalance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-fin'").first();
  assert.equal(Number(blockedBalance.leave_balance), 21);
  const blockedLedger = await db.prepare(`
    SELECT COUNT(*) AS count
      FROM employee_leave_balance_ledger
     WHERE salon_id = 'main'
       AND source_type =
             'exceptional_financial_payment'
  `).first();
  assert.equal(Number(blockedLedger.count), 0);
  const blockedPayments = await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-fin'").first();
  assert.equal(Number(blockedPayments.count), 0);
  const blockedPayroll = await db.prepare("SELECT * FROM payroll_entries WHERE salon_id='main' AND id='payroll-fin-1'").first();
  assert.equal(Number(blockedPayroll.manual_additions_halalas), 0);
  assert.equal(Number(blockedPayroll.gross_salary_halalas), 450000);
  assert.equal(Number(blockedPayroll.net_salary_halalas), 450000);
  assert.equal(Number(blockedPayroll.final_salary_halalas), 450000);
  const blockedImpact = await getEmployeeRequestPayrollImpact(db, 'main', employeeActor);
  assert.equal(blockedImpact.financialPayments.length, 0);
});


test('annual leave cash compensation creation is blocked before balance checks', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-low-balance','main','uid-low-balance','Low Balance',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-low-balance', name: 'Low Balance', firebaseUid: 'uid-low-balance',
    employment: { startDate: '2025-01-01', baseSalaryHalalas: 300000, leaveBalance: 2 },
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
    {
      code:
        'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
    }
  );
  const balance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-low-balance'").first();
  assert.equal(balance.leave_balance, 2);
  const payments = await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-low-balance'").first();
  assert.equal(payments.count, 0);
});

test('legacy exceptional financial payment rows cannot be approved or executed', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-no-payroll','main','uid-no-payroll','No Payroll',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id: 'emp-no-payroll', name: 'No Payroll', firebaseUid: 'uid-no-payroll',
    employment: { startDate: '2025-01-01', baseSalaryHalalas: 300000, leaveBalance: 15 },
  }, actor);
  await db.prepare(`
    INSERT INTO employee_requests (
      id, request_number, salon_id, employee_id, employee_uid,
      employee_name_snapshot, request_type, status, priority, title,
      payload_json, execution_status, execution_attempts,
      idempotency_key, version, submitted_at, created_at, updated_at,
      created_by_uid, updated_by_uid
    )
    VALUES (
      'legacy-efp-blocked', 'REQ-LEGACY-EFP-1', 'main',
      'emp-no-payroll', 'uid-no-payroll', 'No Payroll',
      'exceptional_financial_payment', 'under_review', 'normal',
      'Legacy exceptional financial payment',
      '{"requestedDays":1}', 'not_started', 0,
      'legacy-efp-blocked', 1,
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      'uid-no-payroll', 'uid-no-payroll'
    )
  `).run();
  const blockedAdminActor = { ...actor, role: 'admin' };
  await assert.rejects(
    () => transitionEmployeeRequest(db, 'main', 'legacy-efp-blocked', 'approve', { version: 1 }, blockedAdminActor),
    {
      code:
        'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
    }
  );
  await assert.rejects(
    () => transitionEmployeeRequest(db, 'main', 'legacy-efp-blocked', 'execute', { version: 1, payrollMonth: '2026-08', financialReference: 'PAY-MISSING' }, blockedAdminActor),
    {
      code:
        'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
    }
  );
  const legacyRequest = await db.prepare("SELECT status, execution_status FROM employee_requests WHERE salon_id='main' AND id='legacy-efp-blocked'").first();
  assert.equal(legacyRequest.status, 'under_review');
  assert.equal(legacyRequest.execution_status, 'not_started');
  const blockedBalance = await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-no-payroll'").first();
  assert.equal(Number(blockedBalance.leave_balance), 15);
  const payments = await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-no-payroll'").first();
  assert.equal(Number(payments.count), 0);
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
  const readMetadata = await patchFileMetadata(db, 'main', metadata.id, { status: 'read' });
  assert.equal(readMetadata.status, 'read');
});

test('Core employee file metadata uses manager-write and self-read-only policy', async () => {
  const source = await readFile(new URL('./core/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('    case "files": {');
  const end = source.indexOf('    default:', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /const canViewFiles = hasAnyPermissionKey/);
  assert.match(block, /const canManageFiles = hasAnyPermissionKey/);
  assert.match(block, /if \(method === "POST"\)[\s\S]*if \(canManageFiles\)/);
  assert.match(block, /if \(method === "PATCH" && route\.id\)/);
  assert.match(block, /employee_internal_outbound/);
  assert.match(block, /files_r2:self_update_read_only/);
  assert.match(block, /status: "read"/);
});

test('Core payroll ignores forged browser financial and attendance authority and approval recalculates canonical employment', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await upsertHrEmployee(db, 'main', {
    id: 'emp-forged-payroll',
    name: 'Canonical Payroll Employee',
    status: 'active',
    employment: {
      employmentStatus: 'active',
      baseSalaryHalalas: 400000,
      housingAllowanceHalalas: 100000,
      expectedWorkDays: 30,
      expectedWorkHours: 240,
      dailyScheduledHours: 8,
      attendancePayrollMode: 'exempt',
      attendancePayrollExemptionReason: 'Canonical payroll authority test',
      socialInsuranceCategory: 'non_saudi',
      socialInsuranceEffectiveFrom: '2026-01-01',
      socialInsuranceClassificationNote: 'Canonical test classification',
      gosiWageMode: 'derived',
      overtimeEnabled: true,
      overtimeMultiplier: 1.5,
    },
  }, actor);

  const period = await upsertPayrollPeriod(db, 'main', {
    id: 'period-forged-2026-08',
    payrollMonth: '2026-08',
    monthStart: '2026-08-01',
    monthEnd: '2026-08-31',
  }, actor);

  const forged = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-forged-client',
    periodId: period.id,
    employeeId: 'emp-forged-payroll',
    payrollMonth: '2026-08',
    baseSalaryHalalas: 1,
    allowancesHalalas: 1,
    workDays: 1,
    monthlyHours: 1,
    dailyRateHalalas: 1,
    hourlyRateHalalas: 1,
    grossSalaryHalalas: 1,
    finalSalaryHalalas: 1,
    netSalaryHalalas: 1,
    insuranceDeductionHalalas: 999999,
    employerGosiContributionHalalas: 999999,
    gosiSnapshot: {
      policyVersion: 'forged-browser-policy',
      insuranceCategory: 'saudi_existing',
      employee: { deductionHalalas: 999999 },
      employer: { contributionHalalas: 999999 },
    },
    attendanceSummary: {
      attendancePayrollMode: 'required',
      totalScheduledHours: 999,
      totalActualWorkedHours: 0,
      totalMissingHours: 999,
      totalExtraHours: 999,
      attendanceDays: 0,
      absentDays: 31,
      incompleteDays: 0,
      attendanceRecordCount: 0,
      attendanceLinkStatus: 'not_ready',
      attendanceDeductionEligible: true,
    },
    overtimeEnabled: false,
    overtimeMultiplier: 99,
    overtimeValueHalalas: 999999,
  }, actor);

  const expectedGosi = calculateGosi({
    insuranceCategory: 'non_saudi',
    payrollDate: '2026-08-28',
    basicSalaryHalalas: 400000,
    housingAllowanceHalalas: 100000,
    transportationAllowanceHalalas: 0,
    otherAllowancesHalalas: 0,
    wageMode: 'derived',
  });
  const forgedAttendance = JSON.parse(forged.attendance_summary_json);
  assert.equal(Number(forged.base_salary_halalas), 400000);
  assert.equal(Number(forged.allowances_halalas), 100000);
  assert.equal(forgedAttendance.attendancePayrollMode, 'exempt');
  assert.equal(Number(forgedAttendance.totalMissingHours || 0), 0);
  assert.equal(Number(forged.insurance_deduction_halalas), expectedGosi.employee.deductionHalalas);
  assert.equal(Number(forged.employer_gosi_contribution_halalas), expectedGosi.employer.contributionHalalas);
  assert.notEqual(forged.gosi_policy_version, 'forged-browser-policy');
  assert.equal(Number(forged.gross_salary_halalas), 500000);
  assert.equal(Number(forged.final_salary_halalas), 500000 - expectedGosi.employee.deductionHalalas);

  await upsertHrEmployee(db, 'main', {
    id: 'emp-forged-payroll',
    name: 'Canonical Payroll Employee',
    employment: { baseSalaryHalalas: 600000 },
  }, actor);

  const approved = await approvePayrollEntry(db, 'main', forged.id, actor);
  const updatedExpectedGosi = calculateGosi({
    insuranceCategory: 'non_saudi',
    payrollDate: '2026-08-28',
    basicSalaryHalalas: 600000,
    housingAllowanceHalalas: 100000,
    transportationAllowanceHalalas: 0,
    otherAllowancesHalalas: 0,
    wageMode: 'derived',
  });
  assert.equal(approved.status, 'approved');
  assert.equal(Number(approved.base_salary_halalas), 600000);
  assert.equal(Number(approved.gross_salary_halalas), 700000);
  assert.equal(Number(approved.final_salary_halalas), 700000 - updatedExpectedGosi.employee.deductionHalalas);
  const audit = JSON.parse(approved.audit_log_json || '[]');
  assert.ok(audit.some((entry) => entry.action === 'canonical_recalculation_before_approval'));
});

test('HR employee save atomically creates canonical booking staff row without Firestore mirror', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await upsertHrEmployee(db, 'main', {
    id: 'emp-atomic-staff',
    firebaseUid: 'uid-atomic-staff',
    name: 'Atomic Staff',
    email: 'atomic@example.com',
    phone: '0500000099',
    status: 'active',
    employment: {
      employmentStatus: 'active',
      baseSalaryHalalas: 350000,
    },
    bookingStaff: {
      firebaseUid: 'uid-atomic-staff',
      name: 'Atomic Staff',
      phone: '0500000099',
      active: true,
      employmentStatus: 'active',
      showOnBooking: true,
      specialties: ['svc-a'],
    },
  }, actor);

  const profile = await db.prepare("SELECT id, firebase_uid, name, status FROM employee_profiles WHERE salon_id='main' AND id='emp-atomic-staff'").first();
  const staff = await db.prepare("SELECT id, firebase_uid, name, active, employment_status, show_on_booking FROM staff WHERE salon_id='main' AND id='emp-atomic-staff'").first();
  assert.equal(profile.firebase_uid, 'uid-atomic-staff');
  assert.equal(profile.status, 'active');
  assert.equal(staff.firebase_uid, 'uid-atomic-staff');
  assert.equal(staff.name, 'Atomic Staff');
  assert.equal(Number(staff.active), 1);
  assert.equal(staff.employment_status, 'active');
  assert.equal(Number(staff.show_on_booking), 1);
});

test('public booking tracking returns sanitized Core data without client PII', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  for (const statement of [
    `INSERT INTO clients (id,salon_id,name,phone_normalized,email,status,created_at,updated_at)
     VALUES ('client-public-track','main','Secret Client','0501234567','secret@example.com','active','2026-01-01','2026-01-01')`,
    `INSERT INTO service_sections (id,salon_id,name,active,sort_order,created_at,updated_at)
     VALUES ('section-track','main','Hair',1,0,'2026-01-01','2026-01-01')`,
    `INSERT INTO service_categories (id,salon_id,section_id,name,active,sort_order,created_at,updated_at)
     VALUES ('category-track','main','section-track','Color',1,0,'2026-01-01','2026-01-01')`,
    `INSERT INTO services (id,salon_id,section_id,category_id,name,duration_minutes,price_halalas,active,sort_order,created_at,updated_at)
     VALUES ('svc-track','main','section-track','category-track','Track Service',30,5000,1,0,'2026-01-01','2026-01-01')`,
    `INSERT INTO staff (id,salon_id,name,active,employment_status,created_at,updated_at)
     VALUES ('staff-track','main','Track Staff',1,'active','2026-01-01','2026-01-01')`,
    `INSERT INTO staff_services (salon_id,staff_id,service_id,active)
     VALUES ('main','staff-track','svc-track',1)`,
  ]) {
    await db.prepare(statement).run();
  }
  await upsertHrEmployee(db, 'main', {
    id: 'staff-track',
    name: 'Track Staff',
    employment: { employmentStatus: 'active' },
  }, actor);
  const shift = await saveShiftTemplate(db, 'main', {
    id: 'shift-public-track', name: 'Public track shift', startTime: '09:00', endTime: '18:00',
  }, actor);
  await replaceHrSchedules(db, 'main', 'staff-track', [
    { id: 'sched-public-track', weekday: 4, shiftTemplateId: shift.id, active: true, effectiveFrom: '2026-08-01' },
  ]);
  const booking = await createBooking(db, 'main', {
    id: 'booking-public-track',
    clientId: 'client-public-track',
    clientName: 'Secret Client',
    clientPhone: '0501234567',
    staffId: 'staff-track',
    bookingDate: '2026-08-20',
    startTime: '12:00',
    items: [{ id: 'item-public-track', serviceId: 'svc-track', staffId: 'staff-track' }],
  }, 'uid-admin', { allowPastDates: true });
  assert.match(String(booking.public_id || ''), /^MK-\d{3,}$/);

  const publicTrack = await getPublicBookingTrack(db, 'main', booking.public_id);
  assert.equal(publicTrack.public_id, booking.public_id);
  assert.equal(publicTrack.client_name, undefined);
  assert.equal(publicTrack.client_phone, undefined);
  assert.equal(publicTrack.email, undefined);
  assert.equal(publicTrack.total_halalas, undefined);
  assert.equal(publicTrack.items.length, 1);
  assert.equal(publicTrack.items[0].service_name_snapshot, 'Track Service');
  assert.equal(publicTrack.items[0].staff_name, 'Track Staff');
  assert.equal(publicTrack.items[0].section_name, 'Hair');
  assert.equal(publicTrack.items[0].category_name, 'Color');
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
  }, 'uid-admin', { allowPastDates: true });
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
      '    case "employee-portal:absences":',
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

  assert.match(
    selfBlock,
    /requestedEmployeeId[\s\S]*query\.employeeId/
  );

  assert.match(
    selfBlock,
    /requestedEmployeeId !==[\s\S]*ctx\.employeeId/
  );

  assert.match(
    selfBlock,
    /403[\s\S]*core_employee_portal:cross_employee_forbidden/
  );

  assert.doesNotMatch(
    selfBlock,
    /employeeId:\s*requestedEmployeeId/
  );

  assert.doesNotMatch(
    selfBlock,
    /employeeId:\s*query\./
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


test('employee self profile route is Core-bound and profile-only', async () => {
  const source = await readFile(
    new URL('./core/index.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /\/api\/core\/hr\/employee-profile\/mine/
  );

  const start = source.indexOf(
    '    case "employee-profile:mine":'
  );
  const end = source.indexOf(
    '    case "hr-employees":',
    start
  );
  assert.ok(start >= 0 && end > start);

  const block = source.slice(start, end);
  assert.match(block, /requirePermission\(ctx, "workspace\.employee_portal\.view"\)/);
  assert.match(block, /id:\s*ctx\.employeeId/);
  assert.match(block, /name:\s*has\("name"\)\s*\?\s*body\.name/);
  assert.match(block, /phone:\s*has\("phone"\)\s*\?\s*body\.phone/);
  assert.match(block, /avatarUrl:\s*has\("avatarUrl"\)\s*\?\s*body\.avatarUrl/);
  assert.match(block, /bio:\s*has\("bio"\)\s*\?\s*body\.bio/);

  assert.doesNotMatch(block, /\.\.\.body/);
  assert.doesNotMatch(block, /body\.(?:employment|baseSalary|salary|socialInsurance|gosi|status|showOnAbout|includeInEmployeeManagement)/);
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

test('salary advance scheduled before payroll creation is canonically deducted and settled once', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await seedNonSaudiPayrollEmployment(db, 'emp-late', 500000);

  await db.prepare(`INSERT INTO salary_advances
    (id, salon_id, request_id, employee_id, employee_uid, requested_halalas, approved_halalas,
     repayment_method, installment_count, first_deduction_month, remaining_halalas, paid_halalas,
     payment_status, financial_reference, approved_by_uid, approved_at, paid_at, created_at, updated_at)
    VALUES ('advance-late','main','request-late','emp-late','uid-late',50000,50000,
            'single',1,'2026-09',50000,0,'paid','ADV-LATE-001','uid-admin',
            '2026-08-20T10:00:00.000Z','2026-08-20T10:00:00.000Z',
            '2026-08-20T10:00:00.000Z','2026-08-20T10:00:00.000Z')`).run();

  await db.prepare(`INSERT INTO salary_advance_installments
    (id, salon_id, advance_id, installment_number, payroll_month, amount_halalas,
     status, payroll_entry_id, deducted_at, created_at, updated_at)
    VALUES ('advance-late-1','main','advance-late',1,'2026-09',50000,
            'scheduled',NULL,NULL,'2026-08-20T10:00:00.000Z','2026-08-20T10:00:00.000Z')`).run();

  const saved = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-late-1',
    employeeId: 'emp-late',
    employeeName: 'Late Advance Employee',
    payrollMonth: '2026-09',
    baseSalaryHalalas: 500000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyRateHalalas: 16667,
    hourlyRateHalalas: 2083,
    absenceDeductionHalalas: 0,
    missingHoursDeductionHalalas: 0,
    manualDeductionsHalalas: 0,
    advancesHalalas: 0,
    totalDeductionsHalalas: 0,
    grossSalaryHalalas: 500000,
    netSalaryHalalas: 500000,
    finalSalaryHalalas: 500000,
    ...nonSaudiGosiPayrollFields({ payrollDate: '2026-09-28', basicSalaryHalalas: 500000 }),
    attendanceSummary: {
      totalScheduledHours: 8,
      totalActualWorkedHours: 8,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 1,
      absentDays: 0,
      incompleteDays: 0,
      attendanceRecordCount: 2,
      attendanceLinkStatus: 'confirmed',
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
      attendanceNotes: [],
    },
    scheduleSnapshot: {
      workDays: 30,
      monthlyHours: 240,
      dailyScheduledHours: 8,
      payrollSetupComplete: true,
      payrollSetupMissing: [],
    },
    skipTargetBonus: true,
  }, actor);

  assert.equal(saved.advances_halalas, 50000);
  assert.equal(saved.total_deductions_halalas, 50000);
  assert.equal(saved.net_salary_halalas, 450000);
  assert.equal(saved.final_salary_halalas, 450000);

  let installment = await db.prepare(
    "SELECT * FROM salary_advance_installments WHERE id='advance-late-1'"
  ).first();
  assert.equal(installment.status, 'scheduled');
  assert.equal(installment.payroll_entry_id, saved.id);

  await approvePayrollEntry(db, 'main', saved.id, actor);
  const paid = await markPayrollEntryPaid(db, 'main', saved.id, actor);
  assert.equal(paid.status, 'paid');

  installment = await db.prepare(
    "SELECT * FROM salary_advance_installments WHERE id='advance-late-1'"
  ).first();
  assert.equal(installment.status, 'deducted');
  assert.equal(installment.payroll_entry_id, saved.id);
  assert.ok(installment.deducted_at);

  let advance = await db.prepare(
    "SELECT * FROM salary_advances WHERE id='advance-late'"
  ).first();
  assert.equal(advance.paid_halalas, 50000);
  assert.equal(advance.remaining_halalas, 0);
  assert.equal(advance.payment_status, 'repaid');

  await markPayrollEntryPaid(db, 'main', saved.id, actor);
  advance = await db.prepare(
    "SELECT * FROM salary_advances WHERE id='advance-late'"
  ).first();
  assert.equal(advance.paid_halalas, 50000);
  assert.equal(advance.remaining_halalas, 0);
});

test('salary advance settlement rolls back payroll paid state when installment settlement fails', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await seedNonSaudiPayrollEmployment(db, 'emp-atomic', 400000);

  await db.prepare(`INSERT INTO salary_advances
    (id, salon_id, request_id, employee_id, employee_uid, requested_halalas, approved_halalas,
     repayment_method, installment_count, first_deduction_month, remaining_halalas, paid_halalas,
     payment_status, financial_reference, approved_by_uid, approved_at, paid_at, created_at, updated_at)
    VALUES ('advance-atomic','main','request-atomic','emp-atomic','uid-atomic',40000,40000,
            'single',1,'2026-10',40000,0,'paid','ADV-ATOMIC-001','uid-admin',
            '2026-09-20T10:00:00.000Z','2026-09-20T10:00:00.000Z',
            '2026-09-20T10:00:00.000Z','2026-09-20T10:00:00.000Z')`).run();

  await db.prepare(`INSERT INTO salary_advance_installments
    (id, salon_id, advance_id, installment_number, payroll_month, amount_halalas,
     status, payroll_entry_id, deducted_at, created_at, updated_at)
    VALUES ('advance-atomic-1','main','advance-atomic',1,'2026-10',40000,
            'scheduled',NULL,NULL,'2026-09-20T10:00:00.000Z','2026-09-20T10:00:00.000Z')`).run();

  const saved = await upsertPayrollEntry(db, 'main', {
    id: 'payroll-atomic-1',
    employeeId: 'emp-atomic',
    employeeName: 'Atomic Advance Employee',
    payrollMonth: '2026-10',
    baseSalaryHalalas: 400000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyRateHalalas: 13333,
    hourlyRateHalalas: 1667,
    advancesHalalas: 0,
    totalDeductionsHalalas: 0,
    grossSalaryHalalas: 400000,
    netSalaryHalalas: 400000,
    finalSalaryHalalas: 400000,
    ...nonSaudiGosiPayrollFields({ payrollDate: '2026-10-28', basicSalaryHalalas: 400000 }),
    attendanceSummary: {
      totalScheduledHours: 8,
      totalActualWorkedHours: 8,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 1,
      absentDays: 0,
      incompleteDays: 0,
      attendanceRecordCount: 2,
      attendanceLinkStatus: 'confirmed',
      attendanceDeductionEligible: true,
      attendanceDeductionNote: null,
      attendanceNotes: [],
    },
    scheduleSnapshot: {
      workDays: 30,
      monthlyHours: 240,
      dailyScheduledHours: 8,
      payrollSetupComplete: true,
      payrollSetupMissing: [],
    },
    skipTargetBonus: true,
  }, actor);

  await approvePayrollEntry(db, 'main', saved.id, actor);
  await db.prepare(`CREATE TRIGGER fail_salary_advance_settlement
    BEFORE UPDATE OF status ON salary_advance_installments
    WHEN NEW.status = 'deducted'
    BEGIN
      SELECT RAISE(ABORT, 'forced_advance_settlement_failure');
    END;`).run();

  await assert.rejects(
    () => markPayrollEntryPaid(db, 'main', saved.id, actor)
  );

  const payrollAfter = await db.prepare(
    "SELECT * FROM payroll_entries WHERE id='payroll-atomic-1'"
  ).first();
  const installmentAfter = await db.prepare(
    "SELECT * FROM salary_advance_installments WHERE id='advance-atomic-1'"
  ).first();
  const advanceAfter = await db.prepare(
    "SELECT * FROM salary_advances WHERE id='advance-atomic'"
  ).first();

  assert.equal(payrollAfter.status, 'approved');
  assert.equal(payrollAfter.paid_at, null);
  assert.equal(installmentAfter.status, 'scheduled');
  assert.equal(installmentAfter.deducted_at, null);
  assert.equal(advanceAfter.paid_halalas, 0);
  assert.equal(advanceAfter.remaining_halalas, 40000);
  assert.equal(advanceAfter.payment_status, 'paid');
});

test('employee request needs-info can resume review without creating a replacement request', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-needs-info','main','uid-needs-info','Needs Info Employee',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db, 'main', {
    id:'emp-needs-info', name:'Needs Info Employee', firebaseUid:'uid-needs-info',
    employment:{ baseSalaryHalalas:400000, leaveBalance:10 },
  }, actor);
  const employeeActor={uid:'uid-needs-info',employeeId:'emp-needs-info',name:'Needs Info Employee',role:'employee'};
  const adminActor={...actor,role:'admin'};
  let request=await createEmployeeRequest(db,'main',{
    requestType:'salary_advance',
    payload:{amount:500,neededDate:'2026-09-15',repaymentMethod:'single',installmentCount:1,reason:'اختبار دورة مطلوب معلومات',acknowledgement:true},
    idempotencyKey:'needs-info-cycle-1',
  },employeeActor);
  request=await transitionEmployeeRequest(db,'main',request.id,'receive',{version:request.version},adminActor);
  request=await transitionEmployeeRequest(db,'main',request.id,'start-review',{version:request.version},adminActor);
  request=await transitionEmployeeRequest(db,'main',request.id,'request-info',{version:request.version,note:'أرسل التوضيح المطلوب.'},adminActor);
  assert.equal(request.status,'needs_info');
  request=await transitionEmployeeRequest(db,'main',request.id,'answer-info',{version:request.version,note:'تم إرسال التوضيح.'},employeeActor,{ownOnly:true});
  assert.equal(request.status,'under_review');
  request=await transitionEmployeeRequest(db,'main',request.id,'request-info',{version:request.version,note:'توضيح إضافي.'},adminActor);
  assert.equal(request.status,'needs_info');
  request=await transitionEmployeeRequest(db,'main',request.id,'start-review',{version:request.version,note:'استئناف المراجعة إداريًا.'},adminActor);
  assert.equal(request.status,'under_review');
  const count=await db.prepare("SELECT COUNT(*) AS count FROM employee_requests WHERE salon_id='main' AND employee_id='emp-needs-info'").first();
  assert.equal(Number(count.count),1);
});

test('exceptional financial payment retry path stays blocked during active service', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-efp-retry','main','uid-efp-retry','EFP Retry Employee',1,'active','2026-01-01','2026-01-01')`).run();
  await upsertHrEmployee(db,'main',{
    id:'emp-efp-retry',name:'EFP Retry Employee',firebaseUid:'uid-efp-retry',
    employment:{
      startDate:'2025-01-01',
      baseSalaryHalalas:450000,
      leaveBalance:5,
      socialInsuranceCategory:'non_saudi',
      socialInsuranceEffectiveFrom:'2026-01-01',
      socialInsuranceClassificationNote:'Exceptional payment retry test classification',
      gosiWageMode:'derived',
    },
  },actor);
  const period=await upsertPayrollPeriod(db,'main',{
    id:'period-efp-retry-2026-08',payrollMonth:'2026-08',monthStart:'2026-08-01',monthEnd:'2026-08-31',
  },actor);
  await upsertPayrollEntry(db,'main',{
    id:'payroll-efp-retry-1',periodId:period.id,employeeId:'emp-efp-retry',payrollMonth:'2026-08',
    baseSalaryHalalas:450000,allowancesHalalas:0,workDays:30,monthlyHours:240,dailyRateHalalas:15000,hourlyRateHalalas:1875,
    grossSalaryHalalas:450000,netSalaryHalalas:450000,finalSalaryHalalas:450000,
    scheduleSnapshot:{workDays:30,monthlyHours:240,dailyScheduledHours:8,payrollSetupComplete:true,payrollSetupMissing:[]},
  },actor);
  const employeeActor={uid:'uid-efp-retry',employeeId:'emp-efp-retry',name:'EFP Retry Employee',role:'employee'};
  const adminActor={...actor,role:'admin'};
  await assert.rejects(
    () => createEmployeeRequest(db,'main',{
      requestType:'exceptional_financial_payment',
      payload:{requestedDays:3,reason:'Active-service annual leave cash substitution is not allowed',acknowledgement:true,employeeSignatureDataUrl:`data:image/png;base64,${'r'.repeat(300)}`},
      idempotencyKey:'efp-retry-after-balance-topup',
    },employeeActor),
    {
      code:
        'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
    }
  );
  await db.prepare("UPDATE employee_employment SET leave_balance=2 WHERE salon_id='main' AND employee_id='emp-efp-retry'").run();
  await db.prepare("UPDATE employee_employment SET leave_balance=5 WHERE salon_id='main' AND employee_id='emp-efp-retry'").run();
  const balanceBlocked=await db.prepare("SELECT leave_balance FROM employee_employment WHERE salon_id='main' AND employee_id='emp-efp-retry'").first();
  assert.equal(Number(balanceBlocked.leave_balance),5);
  const paymentBlocked=await db.prepare("SELECT COUNT(*) AS count FROM employee_financial_payments WHERE salon_id='main' AND employee_id='emp-efp-retry'").first();
  assert.equal(Number(paymentBlocked.count),0);
  const ledgerBlocked=await db.prepare("SELECT COUNT(*) AS count FROM employee_leave_balance_ledger WHERE salon_id='main' AND source_type='exceptional_financial_payment'").first();
  assert.equal(Number(ledgerBlocked.count),0);
  const payrollBlocked=await db.prepare("SELECT * FROM payroll_entries WHERE salon_id='main' AND id='payroll-efp-retry-1'").first();
  assert.equal(Number(payrollBlocked.manual_additions_halalas),0);
  assert.equal(Number(payrollBlocked.final_salary_halalas),450000);
});

test('employee master profile fields round-trip through canonical Core D1', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const created = await upsertHrEmployee(db, 'main', {
    id: 'emp-stage4a1-profile',
    name: 'Stage 4A1 Employee',
    firebaseUid: 'uid-stage4a1-profile',
    email: 'stage4a1@example.com',
    phone: '0501234567',
    avatarUrl: 'https://example.com/avatar.jpg',
    bio: 'Canonical employee biography',
    cvUrl: 'https://example.com/cv.pdf',
    showOnAbout: true,
    includeInEmployeeManagement: true,
    rating: 4.75,
    reviewsCount: 19,
    employment: {
      title: 'Senior Stylist',
      department: 'Salon',
      employmentEndDate: '2027-12-31',
      employmentStatus: 'active',
    },
  }, actor);

  assert.equal(created.avatar_url, 'https://example.com/avatar.jpg');
  assert.equal(created.bio, 'Canonical employee biography');
  assert.equal(created.cv_url, 'https://example.com/cv.pdf');
  assert.equal(Number(created.show_on_about), 1);
  assert.equal(Number(created.include_in_employee_management), 1);
  assert.equal(Number(created.rating), 4.75);
  assert.equal(Number(created.reviews_count), 19);
  assert.equal(created.employment.end_date, '2027-12-31');

  const updated = await upsertHrEmployee(db, 'main', {
    id: 'emp-stage4a1-profile',
    name: 'Stage 4A1 Employee Updated',
    bio: 'Updated canonical biography',
    showOnAbout: false,
  }, actor);

  assert.equal(updated.name, 'Stage 4A1 Employee Updated');
  assert.equal(updated.bio, 'Updated canonical biography');
  assert.equal(Number(updated.show_on_about), 0);
  assert.equal(updated.avatar_url, 'https://example.com/avatar.jpg');
  assert.equal(updated.cv_url, 'https://example.com/cv.pdf');
  assert.equal(Number(updated.include_in_employee_management), 1);
  assert.equal(Number(updated.rating), 4.75);
  assert.equal(Number(updated.reviews_count), 19);
  assert.equal(updated.employment.end_date, '2027-12-31');
});

test('attendance payroll exemption is canonical, needs no schedule or punches, and approves monthly salary', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO staff
    (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
    VALUES ('emp-admin-exempt','main','uid-admin-exempt','Admin Exempt',1,'active','2026-01-01','2026-01-01')`).run();

  const employee = await upsertHrEmployee(
    db,
    'main',
    {
      id: 'emp-admin-exempt',
      name: 'Admin Exempt',
      firebaseUid: 'uid-admin-exempt',
      employment: {
        baseSalaryHalalas: 400000,
        expectedWorkDays: 30,
        attendancePayrollMode: 'exempt',
        attendancePayrollExemptionReason: 'موظف إداري / إدارة',
        socialInsuranceCategory: 'non_saudi',
        socialInsuranceEffectiveFrom: '2026-01-01',
        socialInsuranceClassificationNote: 'Test non-Saudi payroll classification',
        gosiWageMode: 'derived',
      },
    },
    actor
  );

  assert.equal(
    employee.employment.attendance_payroll_mode,
    'exempt'
  );
  assert.equal(
    employee.employment.attendance_payroll_exemption_reason,
    'موظف إداري / إدارة'
  );

  const schedules = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM hr_work_schedules
      WHERE salon_id='main'
        AND employee_id='emp-admin-exempt'`
  ).first();
  assert.equal(Number(schedules.count || 0), 0);

  const period = await upsertPayrollPeriod(
    db,
    'main',
    {
      id: 'period-admin-exempt-2026-08',
      payrollMonth: '2026-08',
      monthStart: '2026-08-01',
      monthEnd: '2026-08-31',
    },
    actor
  );

  const payroll = await upsertPayrollEntry(
    db,
    'main',
    {
      id: 'payroll-admin-exempt',
      periodId: period.id,
      employeeId: employee.id,
      employeeName: employee.name,
      payrollMonth: '2026-08',
      baseSalaryHalalas: 400000,
      workDays: 30,
      monthlyHours: 0,
      dailyRateHalalas: 13333,
      hourlyRateHalalas: 0,
      grossSalaryHalalas: 400000,
      netSalaryHalalas: 400000,
      finalSalaryHalalas: 400000,
      ...nonSaudiGosiPayrollFields({ payrollDate: '2026-08-28', basicSalaryHalalas: 400000 }),
      attendanceSummary: {
        totalScheduledHours: 0,
        totalActualWorkedHours: 0,
        totalLateHours: 0,
        totalCompensatedLateHours: 0,
        totalMissingHours: 0,
        totalExtraHours: 0,
        attendanceDays: 0,
        absentDays: 0,
        incompleteDays: 0,
        attendanceRecordCount: 0,
        attendanceLinkStatus: 'exempt',
        attendancePayrollMode: 'exempt',
        attendancePayrollExemptionReason: 'موظف إداري / إدارة',
        attendanceDeductionEligible: false,
      },
      scheduleSnapshot: {
        workDays: 30,
        monthlyHours: 0,
        dailyScheduledHours: 0,
        payrollSetupComplete: true,
        payrollSetupMissing: [],
        monthlyHoursSource: 'not_required_attendance_exempt',
        attendancePayrollMode: 'exempt',
        attendancePayrollExemptionReason: 'موظف إداري / إدارة',
      },
      skipTargetBonus: true,
    },
    actor
  );

  const approved = await approvePayrollEntry(
    db,
    'main',
    payroll.id,
    actor
  );

  assert.equal(approved.status, 'approved');
  assert.equal(Number(approved.monthly_hours || 0), 0);
  assert.equal(Number(approved.hourly_rate_halalas || 0), 0);
  assert.equal(
    JSON.parse(approved.attendance_summary_json)
      .attendancePayrollMode,
    'exempt'
  );
});

test('schedule exception update enforces one operational overlapping exception per employee', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const insertStaff = async (id) => {
    await db.prepare(`INSERT INTO staff
      (id, salon_id, firebase_uid, name, active, employment_status, created_at, updated_at)
      VALUES (?,'main',?,?,1,'active','2026-01-01','2026-01-01')`)
      .bind(id, `uid-${id}`, `Employee ${id}`)
      .run();
  };

  await insertStaff('emp-update-conflict');
  await createScheduleException(db, 'main', {
    id: 'exc-update-approved-a',
    employeeId: 'emp-update-conflict',
    exceptionType: 'custom',
    dateFrom: '2026-08-23',
    dateTo: '2026-08-23',
    enabled: true,
    startTime: '10:00',
    endTime: '18:00',
    status: 'approved',
  }, actor);
  await createScheduleException(db, 'main', {
    id: 'exc-update-cancelled-b',
    employeeId: 'emp-update-conflict',
    exceptionType: 'custom',
    dateFrom: '2026-08-23',
    dateTo: '2026-08-23',
    enabled: false,
    startTime: '15:00',
    endTime: '23:00',
    status: 'cancelled',
  }, actor);

  await assert.rejects(
    () => updateScheduleException(db, 'main', 'exc-update-cancelled-b', {
      status: 'approved',
      enabled: true,
      note: 'reactivate cancelled history',
    }, actor),
    (error) => {
      const normalized = normalizeError(error);
      assert.equal(normalized.status, 409);
      assert.equal(normalized.code, 'core_hr:schedule_exception_conflict');
      return true;
    }
  );

  const noteOnly = await updateScheduleException(db, 'main', 'exc-update-approved-a', {
    note: 'note-only update remains allowed',
  }, actor);
  assert.equal(noteOnly.status, 'approved');
  assert.equal(noteOnly.note, 'note-only update remains allowed');

  const cancelled = await updateScheduleException(db, 'main', 'exc-update-approved-a', {
    status: 'cancelled',
    enabled: false,
    note: 'cancel operational exception',
  }, actor);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(Number(cancelled.enabled), 0);

  await insertStaff('emp-cancelled-history');
  const cancelledHistoryA = await createScheduleException(db, 'main', {
    id: 'exc-history-cancelled-a',
    employeeId: 'emp-cancelled-history',
    exceptionType: 'custom',
    dateFrom: '2026-08-23',
    dateTo: '2026-08-23',
    enabled: false,
    startTime: '10:00',
    endTime: '18:00',
    status: 'cancelled',
  }, actor);
  const cancelledHistoryB = await createScheduleException(db, 'main', {
    id: 'exc-history-cancelled-b',
    employeeId: 'emp-cancelled-history',
    exceptionType: 'custom',
    dateFrom: '2026-08-23',
    dateTo: '2026-08-23',
    enabled: false,
    startTime: '15:00',
    endTime: '23:00',
    status: 'cancelled',
  }, actor);
  assert.equal(cancelledHistoryA.status, 'cancelled');
  assert.equal(cancelledHistoryB.status, 'cancelled');

  await insertStaff('emp-active-conflict');
  await createScheduleException(db, 'main', {
    id: 'exc-active-a',
    employeeId: 'emp-active-conflict',
    exceptionType: 'custom',
    dateFrom: '2026-08-23',
    dateTo: '2026-08-23',
    enabled: true,
    startTime: '10:00',
    endTime: '18:00',
    status: 'active',
  }, actor);
  await createScheduleException(db, 'main', {
    id: 'exc-active-cancelled-b',
    employeeId: 'emp-active-conflict',
    exceptionType: 'custom',
    dateFrom: '2026-08-23',
    dateTo: '2026-08-23',
    enabled: false,
    startTime: '15:00',
    endTime: '23:00',
    status: 'cancelled',
  }, actor);

  await assert.rejects(
    () => updateScheduleException(db, 'main', 'exc-active-cancelled-b', {
      status: 'active',
      enabled: true,
    }, actor),
    (error) => {
      const normalized = normalizeError(error);
      assert.equal(normalized.status, 409);
      assert.equal(normalized.code, 'core_hr:schedule_exception_conflict');
      return true;
    }
  );
});


test('Core workforce communications, notifications and recruitment are D1-owned', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO app_users
    (id, firebase_uid, salon_id, email, display_name, primary_role, status, email_verified, created_at, updated_at)
    VALUES
      ('user-admin','uid-admin','main','admin@example.com','Admin','admin','active',1,'2026-01-01','2026-01-01'),
      ('user-staff','uid-staff','main','staff@example.com','Staff','staff','active',1,'2026-01-01','2026-01-01')`).run();
  await db.prepare(`INSERT INTO employee_profiles
    (id, salon_id, firebase_uid, name, email, status, created_at, updated_at)
    VALUES ('emp-staff','main','uid-staff','Staff','staff@example.com','active','2026-01-01','2026-01-01')`).run();
  await db.prepare(`INSERT INTO user_employee_links
    (id, salon_id, user_id, employee_id, link_status, linked_at, updated_at)
    VALUES ('link-staff','main','user-staff','emp-staff','active','2026-01-01','2026-01-01')`).run();

  const adminActor = { uid: 'uid-admin', name: 'Admin', role: 'admin' };
  const staffActor = { uid: 'uid-staff', name: 'Staff', role: 'staff', employeeId: 'emp-staff' };

  const message = await createEmployeeMessage(db, 'main', {
    recipientUid: 'uid-staff',
    recipientName: 'Staff',
    body: 'Canonical message',
    kind: 'hr_to_employee',
  }, adminActor, { managementSender: true });
  assert.equal(message.sender_uid, 'uid-admin');
  assert.equal(message.recipient_uid, 'uid-staff');
  assert.equal(message.conversation_id, 'uid-admin__uid-staff');
  assert.equal(message.thread_id, 'uid-admin__uid-staff');

  const staffMessages = await listEmployeeMessages(db, 'main', {}, staffActor, { manageAll: false });
  assert.equal(staffMessages.length, 1);
  assert.deepEqual(staffMessages[0].read_by, ['uid-admin']);

  await markEmployeeThreadRead(db, 'main', message.conversation_id, staffActor);
  const afterRead = await listEmployeeMessages(db, 'main', {}, staffActor, { manageAll: false });
  assert.deepEqual(new Set(afterRead[0].read_by), new Set(['uid-admin', 'uid-staff']));

  const notifications = await listEmployeeNotifications(db, 'main', {}, staffActor);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'message');
  assert.equal(notifications[0].read_at, null);
  await markEmployeeNotificationRead(db, 'main', notifications[0].id, staffActor);
  const notificationsAfterRead = await listEmployeeNotifications(db, 'main', {}, staffActor);
  assert.ok(notificationsAfterRead[0].read_at);

  await createEmployeeNotification(db, 'main', {
    targetEmployeeId: 'emp-staff',
    type: 'system',
    title: 'Profile updated',
  }, adminActor);
  assert.equal((await listEmployeeNotifications(db, 'main', {}, staffActor)).length, 2);

  const staffReply = await createEmployeeMessage(db, 'main', {
    recipientUid: 'uid-admin',
    conversationId: 'spoofed-thread',
    threadId: 'spoofed-thread',
    body: 'Staff reply',
    kind: 'hr_to_employee',
  }, staffActor, { managementSender: false, createNotification: false });
  assert.equal(staffReply.conversation_id, 'uid-admin__uid-staff');
  assert.equal(staffReply.thread_id, 'uid-admin__uid-staff');
  assert.equal(staffReply.kind, 'employee_to_employee');

  const application = await createRecruitmentApplication(db, 'main', {
    fullName: 'Candidate One',
    email: 'candidate@example.com',
    roleApplied: 'staff',
    status: 'hired',
    reviewedByUid: 'spoofed-reviewer',
  }, adminActor);
  assert.equal(application.status, 'new');
  assert.equal(application.reviewed_by_uid, null);
  const reviewed = await patchRecruitmentApplication(db, 'main', application.id, {
    status: 'reviewing',
    reviewedByUid: 'spoofed-reviewer',
  }, adminActor);
  assert.equal(reviewed.status, 'reviewing');
  assert.equal(reviewed.reviewed_by_uid, 'uid-admin');
  assert.equal((await listRecruitmentApplications(db, 'main')).length, 1);
});
async function seedSalaryAdvanceDeferralFixture(
  db,
  {
    prefix,
    installmentStatus = 'scheduled',
    sourceStatus = 'draft',
    targetStatus = 'draft',
  } = {}
) {
  if (!prefix) throw new Error('fixture_prefix_required');

  const now = '2026-08-25T21:30:00.000Z';
  const employeeId = `${prefix}-employee`;
  const advanceId = `${prefix}-advance`;
  const installmentId = `${prefix}-installment`;
  const sourcePayrollId = `${prefix}-source-payroll`;
  const targetPayrollId = `${prefix}-target-payroll`;

  await seedNonSaudiPayrollEmployment(
    db,
    employeeId,
    400000
  );

  await db.prepare(`
    INSERT INTO salary_advances
      (id, salon_id, request_id, employee_id,
       requested_halalas, approved_halalas,
       repayment_method, installment_count,
       first_deduction_month, remaining_halalas,
       payment_status, approved_by_uid,
       approved_at, created_at, updated_at)
    VALUES (?, 'main', ?, ?,
            15000, 15000,
            'single', 1,
            '2026-08', 15000,
            'paid', 'uid-admin',
            ?, ?, ?)
  `).bind(
    advanceId,
    `${prefix}-request`,
    employeeId,
    now,
    now,
    now
  ).run();

  await db.prepare(`
    INSERT INTO salary_advance_installments
      (id, salon_id, advance_id, installment_number,
       payroll_month, amount_halalas, status,
       payroll_entry_id, deducted_at,
       created_at, updated_at)
    VALUES (?, 'main', ?, 1,
            '2026-08', 15000, 'scheduled',
            NULL, NULL, ?, ?)
  `).bind(
    installmentId,
    advanceId,
    now,
    now
  ).run();

  const sourcePayroll = await upsertPayrollEntry(
    db,
    'main',
    {
      id: sourcePayrollId,
      employeeId,
      payrollMonth: '2026-08',
      status: 'draft',
      baseSalaryHalalas: 400000,
      allowancesHalalas: 0,
      workDays: 30,
      monthlyHours: 240,
      dailyRateHalalas: 13333,
      hourlyRateHalalas: 1667,
      grossSalaryHalalas: 400000,
      netSalaryHalalas: 400000,
      finalSalaryHalalas: 400000,
      additions: [],
      deductions: [],
      scheduleSnapshot: {
        workDays: 30,
        monthlyHours: 240,
        dailyScheduledHours: 8,
        payrollSetupComplete: true,
        payrollSetupMissing: [],
      },
      skipTargetBonus: true,
    },
    actor
  );

  const targetPayroll = await upsertPayrollEntry(
    db,
    'main',
    {
      id: targetPayrollId,
      employeeId,
      payrollMonth: '2026-09',
      status: 'draft',
      baseSalaryHalalas: 400000,
      allowancesHalalas: 0,
      workDays: 30,
      monthlyHours: 240,
      dailyRateHalalas: 13333,
      hourlyRateHalalas: 1667,
      grossSalaryHalalas: 400000,
      netSalaryHalalas: 400000,
      finalSalaryHalalas: 400000,
      additions: [],
      deductions: [],
      scheduleSnapshot: {
        workDays: 30,
        monthlyHours: 240,
        dailyScheduledHours: 8,
        payrollSetupComplete: true,
        payrollSetupMissing: [],
      },
      skipTargetBonus: true,
    },
    actor
  );

  if (sourceStatus !== 'draft') {
    await db.prepare(`
      UPDATE payroll_entries
         SET status = ?
       WHERE id = ?
    `).bind(
      sourceStatus,
      sourcePayroll.id
    ).run();
  }

  if (targetStatus !== 'draft') {
    await db.prepare(`
      UPDATE payroll_entries
         SET status = ?
       WHERE id = ?
    `).bind(
      targetStatus,
      targetPayroll.id
    ).run();
  }

  if (installmentStatus !== 'scheduled') {
    await db.prepare(`
      UPDATE salary_advance_installments
         SET status = ?
       WHERE id = ?
    `).bind(
      installmentStatus,
      installmentId
    ).run();
  }

  return {
    employeeId,
    advanceId,
    installmentId,
    sourcePayrollId,
    targetPayrollId,
  };
}

test(
  'salary advance installment deferral atomically moves one canonical installment and replays without rewriting payroll',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const fixture = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-success' }
    );

    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    const payload = {
      targetPayrollMonth: '2026-09',
      reason: 'Approved business deferral',
      note: 'Move August deduction to September',
      idempotencyKey: 'salary-advance-deferral-success-1',
    };

    let source = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    let target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();

    assert.equal(Number(source.advances_halalas), 15000);
    assert.equal(Number(target.advances_halalas), 0);

    const result = await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      payload,
      deferralActor
    );

    assert.equal(result.idempotent, false);
    assert.deepEqual(
      result.payrollRefresh.map((item) => item.status),
      ['refreshed', 'refreshed']
    );
    assert.equal(result.installment.payrollMonth, '2026-09');
    assert.equal(result.installment.amountHalalas, 15000);
    assert.equal(result.installment.status, 'scheduled');
    assert.equal(result.installment.payrollEntryId, fixture.targetPayrollId);

    assert.equal(result.deferral.originalPayrollMonth, '2026-08');
    assert.equal(result.deferral.fromPayrollMonth, '2026-08');
    assert.equal(result.deferral.toPayrollMonth, '2026-09');
    assert.equal(result.deferral.amountHalalas, 15000);
    assert.equal(result.deferral.reason, payload.reason);
    assert.equal(result.deferral.note, payload.note);
    assert.equal(result.deferral.createdByUid, deferralActor.uid);
    assert.equal(result.deferral.createdByEmail, deferralActor.email);
    assert.deepEqual(result.deferral.deferredBy, {
      uid: deferralActor.uid,
      email: deferralActor.email,
    });
    assert.equal(result.deferral.deferredAt, result.deferral.createdAt);
    assert.equal(result.deferral.source, 'core_api');
    assert.equal(result.deferral.fromPayrollEntryId, fixture.sourcePayrollId);
    assert.equal(result.deferral.toPayrollEntryId, fixture.targetPayrollId);

    const advance = await db.prepare(`
      SELECT first_deduction_month, remaining_halalas, paid_halalas
        FROM salary_advances
       WHERE salon_id = 'main' AND id = ?
    `).bind(fixture.advanceId).first();
    assert.equal(advance.first_deduction_month, '2026-08');
    assert.equal(Number(advance.remaining_halalas), 15000);
    assert.equal(Number(advance.paid_halalas || 0), 0);

    source = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();

    assert.equal(Number(source.advances_halalas), 0);
    assert.equal(Number(target.advances_halalas), 15000);

    const sourceUpdatedAt = source.updated_at;
    const targetUpdatedAt = target.updated_at;

    const retry = await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      payload,
      deferralActor
    );

    assert.equal(retry.idempotent, true);
    assert.equal(retry.deferral.id, result.deferral.id);
    assert.deepEqual(
      retry.payrollRefresh.map((item) => item.status),
      ['already_applied', 'already_applied']
    );

    const eventCount = await db.prepare(`
      SELECT COUNT(*) AS count
        FROM salary_advance_installment_deferrals
       WHERE salon_id = 'main' AND installment_id = ?
    `).bind(fixture.installmentId).first();
    assert.equal(Number(eventCount.count), 1);

    const installmentCount = await db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount_halalas), 0) AS amount
        FROM salary_advance_installments
       WHERE salon_id = 'main' AND advance_id = ?
    `).bind(fixture.advanceId).first();
    assert.equal(Number(installmentCount.count), 1);
    assert.equal(Number(installmentCount.amount), 15000);

    source = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();
    assert.equal(source.updated_at, sourceUpdatedAt);
    assert.equal(target.updated_at, targetUpdatedAt);
    assert.equal(Number(source.advances_halalas), 0);
    assert.equal(Number(target.advances_halalas), 15000);

    await assert.rejects(() =>
      db.prepare(`
        UPDATE salary_advance_installments
           SET payroll_month = '2026-10',
               updated_at = '2026-08-25T22:00:00.000Z'
         WHERE id = ?
      `).bind(fixture.installmentId).run()
    );

    await assert.rejects(() =>
      db.prepare(`
        UPDATE salary_advance_installment_deferrals
           SET reason = 'tampered'
         WHERE id = ?
      `).bind(result.deferral.id).run()
    );

    await assert.rejects(() =>
      db.prepare(`
        DELETE FROM salary_advance_installment_deferrals WHERE id = ?
      `).bind(result.deferral.id).run()
    );
  }
);

test(
  'salary advance installment deferral preserves original month across repeated moves and relinks reviewed target payroll',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const fixture = await seedSalaryAdvanceDeferralFixture(
      db,
      {
        prefix: 'deferral-original-chain',
        targetStatus: 'reviewed',
      }
    );
    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    const first = await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      {
        targetPayrollMonth: '2026-09',
        reason: 'First canonical move',
        idempotencyKey: 'deferral-original-chain-1',
      },
      deferralActor
    );

    assert.equal(first.deferral.originalPayrollMonth, '2026-08');
    assert.equal(first.deferral.fromPayrollMonth, '2026-08');
    assert.equal(first.deferral.toPayrollMonth, '2026-09');
    assert.equal(first.installment.payrollEntryId, fixture.targetPayrollId);

    let reviewedTarget = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();
    assert.equal(reviewedTarget.status, 'reviewed');
    assert.equal(Number(reviewedTarget.advances_halalas), 15000);

    const second = await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      {
        targetPayrollMonth: '2026-10',
        reason: 'Second canonical move',
        idempotencyKey: 'deferral-original-chain-2',
      },
      deferralActor
    );

    assert.equal(second.deferral.originalPayrollMonth, '2026-08');
    assert.equal(second.deferral.fromPayrollMonth, '2026-09');
    assert.equal(second.deferral.toPayrollMonth, '2026-10');
    assert.equal(second.installment.payrollMonth, '2026-10');
    assert.equal(second.installment.payrollEntryId, null);

    reviewedTarget = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();
    assert.equal(reviewedTarget.status, 'reviewed');
    assert.equal(Number(reviewedTarget.advances_halalas), 0);

    const events = await db.prepare(`
      SELECT original_payroll_month, from_payroll_month, to_payroll_month, source
        FROM salary_advance_installment_deferrals
       WHERE salon_id = 'main' AND installment_id = ?
       ORDER BY created_at, id
    `).bind(fixture.installmentId).all();

    assert.deepEqual(
      events.results.map((row) => ({
        original: row.original_payroll_month,
        from: row.from_payroll_month,
        to: row.to_payroll_month,
        source: row.source,
      })),
      [
        { original: '2026-08', from: '2026-08', to: '2026-09', source: 'core_api' },
        { original: '2026-08', from: '2026-09', to: '2026-10', source: 'core_api' },
      ]
    );
  }
);

test(
  'salary advance installment deferral validates month reason idempotency actor scope and advance state',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    const scheduled = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-validation' }
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        scheduled.installmentId,
        {
          targetPayrollMonth: '2026-08',
          reason: 'Same month',
          idempotencyKey: 'deferral-same-month',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_target_must_be_later' }
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        scheduled.installmentId,
        {
          targetPayrollMonth: '2026-07',
          reason: 'Backward month',
          idempotencyKey: 'deferral-backward-month',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_target_must_be_later' }
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        scheduled.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: '   ',
          idempotencyKey: 'deferral-missing-reason',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_reason_required' }
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        scheduled.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Missing key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_idempotency_required' }
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        scheduled.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Missing actor',
          idempotencyKey: 'deferral-missing-actor',
        },
        {}
      ),
      { code: 'core_payroll:salary_advance_deferral_actor_required' }
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'other-salon',
        scheduled.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Wrong scope',
          idempotencyKey: 'deferral-wrong-scope',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_installment_not_found' }
    );

    const deducted = await seedSalaryAdvanceDeferralFixture(
      db,
      {
        prefix: 'deferral-deducted',
        installmentStatus: 'deducted',
      }
    );
    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        deducted.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Cannot defer deducted installment',
          idempotencyKey: 'deferral-deducted-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_installment_not_scheduled' }
    );

    for (const paymentStatus of ['cancelled', 'repaid']) {
      const fixture = await seedSalaryAdvanceDeferralFixture(
        db,
        { prefix: `deferral-${paymentStatus}` }
      );
      await db.prepare(`
        UPDATE salary_advances SET payment_status = ? WHERE id = ?
      `).bind(paymentStatus, fixture.advanceId).run();

      await assert.rejects(
        () => deferSalaryAdvanceInstallment(
          db,
          'main',
          fixture.installmentId,
          {
            targetPayrollMonth: '2026-09',
            reason: `Cannot defer ${paymentStatus} advance`,
            idempotencyKey: `deferral-${paymentStatus}-key`,
          },
          deferralActor
        ),
        { code: 'core_payroll:salary_advance_not_open' }
      );
    }
  }
);

test(
  'salary advance installment deferral fails closed for payroll locks period locks and stale source linkage',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    const sourceLocked = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-source-locked', sourceStatus: 'approved' }
    );
    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        sourceLocked.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Locked source',
          idempotencyKey: 'deferral-source-locked-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_source_payroll_locked' }
    );

    const targetLocked = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-target-locked', targetStatus: 'approved' }
    );
    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        targetLocked.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Locked target',
          idempotencyKey: 'deferral-target-locked-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_target_payroll_locked' }
    );

    const staleLink = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-stale-link' }
    );
    await db.prepare(`
      UPDATE salary_advance_installments
         SET payroll_entry_id = ?
       WHERE id = ?
    `).bind(staleLink.targetPayrollId, staleLink.installmentId).run();
    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        staleLink.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Stale source link',
          idempotencyKey: 'deferral-stale-link-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_source_payroll_link_mismatch' }
    );

    const periodLocked = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-period-locked' }
    );

    await upsertPayrollPeriod(db, 'main', {
      id: 'deferral-period-source',
      payrollMonth: '2026-08',
      monthStart: '2026-08-01',
      monthEnd: '2026-08-31',
      status: 'closed',
    }, actor);

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        periodLocked.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Closed source period',
          idempotencyKey: 'deferral-source-period-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_source_period_locked' }
    );

    await upsertPayrollPeriod(db, 'main', {
      id: 'deferral-period-source',
      payrollMonth: '2026-08',
      monthStart: '2026-08-01',
      monthEnd: '2026-08-31',
      status: 'open',
    }, actor);
    await upsertPayrollPeriod(db, 'main', {
      id: 'deferral-period-target',
      payrollMonth: '2026-09',
      monthStart: '2026-09-01',
      monthEnd: '2026-09-30',
      status: 'locked',
    }, actor);

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        periodLocked.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Locked target period',
          idempotencyKey: 'deferral-target-period-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_target_period_locked' }
    );
  }
);

test(
  'salary advance installment deferral rolls back event schedule and both payroll projections when target mutation fails',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const fixture = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-atomic-rollback' }
    );

    const beforeSource = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    const beforeTarget = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();

    await db.prepare(`
      CREATE TRIGGER fail_salary_advance_deferral_target_atomic_write
      BEFORE UPDATE ON payroll_entries
      WHEN OLD.id = 'deferral-atomic-rollback-target-payroll'
      BEGIN
        SELECT RAISE(ABORT, 'forced_salary_advance_deferral_atomic_failure');
      END;
    `).run();

    const payload = {
      targetPayrollMonth: '2026-09',
      reason: 'Atomic rollback test',
      idempotencyKey: 'deferral-atomic-rollback-key',
    };
    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        fixture.installmentId,
        payload,
        deferralActor
      ),
      /forced_salary_advance_deferral_atomic_failure/
    );

    const eventCount = await db.prepare(`
      SELECT COUNT(*) AS count
        FROM salary_advance_installment_deferrals
       WHERE installment_id = ?
    `).bind(fixture.installmentId).first();
    assert.equal(Number(eventCount.count), 0);

    let installment = await db.prepare(`
      SELECT * FROM salary_advance_installments WHERE id = ?
    `).bind(fixture.installmentId).first();
    assert.equal(installment.payroll_month, '2026-08');
    assert.equal(installment.payroll_entry_id, fixture.sourcePayrollId);

    let source = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    let target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();
    assert.equal(Number(source.advances_halalas), 15000);
    assert.equal(Number(target.advances_halalas), 0);
    assert.equal(source.updated_at, beforeSource.updated_at);
    assert.equal(target.updated_at, beforeTarget.updated_at);

    await db.prepare(`
      DROP TRIGGER fail_salary_advance_deferral_target_atomic_write
    `).run();

    const retry = await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      payload,
      deferralActor
    );
    assert.equal(retry.idempotent, false);

    installment = await db.prepare(`
      SELECT * FROM salary_advance_installments WHERE id = ?
    `).bind(fixture.installmentId).first();
    source = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();

    assert.equal(installment.payroll_month, '2026-09');
    assert.equal(installment.payroll_entry_id, fixture.targetPayrollId);
    assert.equal(Number(source.advances_halalas), 0);
    assert.equal(Number(target.advances_halalas), 15000);
  }
);

test(
  'salary advance installment deferral rejects stale concurrent payroll and installment state with structured conflicts',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    const projectionFixture = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-race-projection' }
    );

    let projectionRaceApplied = false;
    const projectionRaceDb = {
      prepare: (...args) => db.prepare(...args),
      batch: async (statements) => {
        if (!projectionRaceApplied) {
          projectionRaceApplied = true;
          await db.prepare(`
            UPDATE payroll_entries
               SET notes = 'concurrent payroll edit',
                   updated_at = '2026-08-25T23:10:00.000Z'
             WHERE id = ?
          `).bind(projectionFixture.sourcePayrollId).run();
        }
        return db.batch(statements);
      },
    };

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        projectionRaceDb,
        'main',
        projectionFixture.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Projection race',
          idempotencyKey: 'deferral-projection-race-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_source_projection_stale' }
    );

    let eventCount = await db.prepare(`
      SELECT COUNT(*) AS count
        FROM salary_advance_installment_deferrals
       WHERE installment_id = ?
    `).bind(projectionFixture.installmentId).first();
    assert.equal(Number(eventCount.count), 0);

    let installment = await db.prepare(`
      SELECT * FROM salary_advance_installments WHERE id = ?
    `).bind(projectionFixture.installmentId).first();
    assert.equal(installment.payroll_month, '2026-08');

    const installmentFixture = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-race-installment' }
    );

    let installmentRaceApplied = false;
    const installmentRaceDb = {
      prepare: (...args) => db.prepare(...args),
      batch: async (statements) => {
        if (!installmentRaceApplied) {
          installmentRaceApplied = true;
          await db.prepare(`
            UPDATE salary_advance_installments
               SET status = 'deducted',
                   updated_at = '2026-08-25T23:20:00.000Z'
             WHERE id = ?
          `).bind(installmentFixture.installmentId).run();
        }
        return db.batch(statements);
      },
    };

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        installmentRaceDb,
        'main',
        installmentFixture.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Installment race',
          idempotencyKey: 'deferral-installment-race-key',
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_source_conflict' }
    );

    eventCount = await db.prepare(`
      SELECT COUNT(*) AS count
        FROM salary_advance_installment_deferrals
       WHERE installment_id = ?
    `).bind(installmentFixture.installmentId).first();
    assert.equal(Number(eventCount.count), 0);
  }
);

test(
  'salary advance installment deferral rejects conflicting idempotency reuse',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const fixture = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-idempotency-conflict' }
    );
    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };
    const key = 'deferral-idempotency-conflict-key';

    await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      {
        targetPayrollMonth: '2026-09',
        reason: 'First request',
        idempotencyKey: key,
      },
      deferralActor
    );

    await assert.rejects(
      () => deferSalaryAdvanceInstallment(
        db,
        'main',
        fixture.installmentId,
        {
          targetPayrollMonth: '2026-09',
          reason: 'Different request body',
          idempotencyKey: key,
        },
        deferralActor
      ),
      { code: 'core_payroll:salary_advance_deferral_idempotency_conflict' }
    );

    const eventCount = await db.prepare(`
      SELECT COUNT(*) AS count
        FROM salary_advance_installment_deferrals
       WHERE installment_id = ?
    `).bind(fixture.installmentId).first();
    assert.equal(Number(eventCount.count), 1);
  }
);

test(
  'deferred salary advance settles exactly once in target payroll while immutable deferral history remains',
  async (t) => {
    const { mf, db } = await setup();
    t.after(() => mf.dispose());

    const fixture = await seedSalaryAdvanceDeferralFixture(
      db,
      { prefix: 'deferral-settlement' }
    );
    const deferralActor = {
      uid: 'uid-admin',
      email: 'admin@example.com',
    };

    const result = await deferSalaryAdvanceInstallment(
      db,
      'main',
      fixture.installmentId,
      {
        targetPayrollMonth: '2026-09',
        reason: 'Settle in September',
        idempotencyKey: 'deferral-settlement-key',
      },
      deferralActor
    );

    let target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();
    assert.equal(Number(target.advances_halalas), 15000);

    await approvePayrollEntry(db, 'main', fixture.targetPayrollId, actor);
    const paid = await markPayrollEntryPaid(
      db,
      'main',
      fixture.targetPayrollId,
      actor
    );
    assert.equal(paid.status, 'paid');

    let installment = await db.prepare(`
      SELECT * FROM salary_advance_installments WHERE id = ?
    `).bind(fixture.installmentId).first();
    assert.equal(installment.payroll_month, '2026-09');
    assert.equal(installment.status, 'deducted');
    assert.equal(installment.payroll_entry_id, fixture.targetPayrollId);
    assert.ok(installment.deducted_at);

    let advance = await db.prepare(`
      SELECT * FROM salary_advances WHERE id = ?
    `).bind(fixture.advanceId).first();
    assert.equal(advance.first_deduction_month, '2026-08');
    assert.equal(Number(advance.paid_halalas), 15000);
    assert.equal(Number(advance.remaining_halalas), 0);
    assert.equal(advance.payment_status, 'repaid');

    await markPayrollEntryPaid(db, 'main', fixture.targetPayrollId, actor);
    advance = await db.prepare(`
      SELECT * FROM salary_advances WHERE id = ?
    `).bind(fixture.advanceId).first();
    assert.equal(Number(advance.paid_halalas), 15000);
    assert.equal(Number(advance.remaining_halalas), 0);

    const event = await db.prepare(`
      SELECT * FROM salary_advance_installment_deferrals WHERE id = ?
    `).bind(result.deferral.id).first();
    assert.ok(event);
    assert.equal(event.from_payroll_month, '2026-08');
    assert.equal(event.to_payroll_month, '2026-09');
    assert.equal(Number(event.amount_halalas), 15000);

    const source = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.sourcePayrollId).first();
    target = await db.prepare(`
      SELECT * FROM payroll_entries WHERE id = ?
    `).bind(fixture.targetPayrollId).first();
    assert.equal(Number(source.advances_halalas), 0);
    assert.equal(Number(target.advances_halalas), 15000);
  }
);


test('Stage 11 attendance deduction deferral preserves origin and collects once in target month', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`
    INSERT INTO staff
      (
        id, salon_id, firebase_uid, name,
        active, employment_status,
        created_at, updated_at
      )
    VALUES
      (
        'emp-att-deferral',
        'main',
        'uid-att-deferral',
        'Attendance Deferral Employee',
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
      id: 'emp-att-deferral',
      name: 'Attendance Deferral Employee',
      firebaseUid: 'uid-att-deferral',
      employment: {
        title: 'Stylist',
        baseSalaryHalalas: 300000,
        expectedWorkDays: 30,
        expectedWorkHours: 240,
        dailyScheduledHours: 8,
        attendancePayrollMode: 'required',
        socialInsuranceCategory: 'non_saudi',
        socialInsuranceEffectiveFrom: '2026-01-01',
        socialInsuranceClassificationNote:
          'Stage 11 attendance deferral test',
        gosiWageMode: 'derived',
      },
    },
    actor
  );

  const shift = await saveShiftTemplate(
    db,
    'main',
    {
      id: 'shift-att-deferral',
      name: 'Attendance Deferral Shift',
      startTime: '09:00',
      endTime: '17:00',
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      attendanceLockEnabled: true,
      attendanceLockAfterMinutes: 30,
    },
    actor
  );

  await replaceHrSchedules(
    db,
    'main',
    'emp-att-deferral',
    [{
      id: 'sched-att-deferral',
      weekday: 0,
      shiftTemplateId: shift.id,
      active: true,
      effectiveFrom: '2026-08-01',
    }]
  );

  for (const date of [
    '2026-08-02',
    '2026-08-09',
    '2026-08-16',
    '2026-08-23',
  ]) {
    await recordAttendance(
      db,
      'main',
      {
        employeeId: 'emp-att-deferral',
        employeeUid: 'uid-att-deferral',
        type: 'check_in',
        date,
        recordedAt: `${date}T09:00:00.000Z`,
        idempotencyKey: `att-deferral-${date}-in`,
      },
      actor
    );

    await recordAttendance(
      db,
      'main',
      {
        employeeId: 'emp-att-deferral',
        employeeUid: 'uid-att-deferral',
        type: 'check_out',
        date,
        recordedAt:
          date === '2026-08-23'
            ? `${date}T16:00:00.000Z`
            : `${date}T17:00:00.000Z`,
        idempotencyKey: `att-deferral-${date}-out`,
      },
      actor
    );
  }

  const augustBefore = await upsertPayrollEntry(
    db,
    'main',
    {
      employeeId: 'emp-att-deferral',
      payrollMonth: '2026-08',
    },
    actor
  );

  const originalDeduction = Number(
    augustBefore.missing_hours_deduction_halalas || 0
  );

  assert.ok(originalDeduction > 0);
  assert.equal(augustBefore.status, 'draft');

  await assert.rejects(
    () =>
      createPayrollObligation(
        db,
        'main',
        {
          employeeId: 'emp-att-deferral',
          kind: 'attendance_missing_hours',
          originalPayrollMonth: '2026-08',
          targetPayrollMonth: '2026-09',
          amountHalalas: originalDeduction,
          reason: 'Forged attendance authority',
          sourceType: 'attendance',
          sourceRef: 'forged',
        },
        actor
      ),
    {
      code:
        'core_payroll:attendance_obligation_requires_canonical_path',
    }
  );

  const deferred = await deferAttendanceDeduction(
    db,
    'main',
    {
      employeeId: 'emp-att-deferral',
      originalPayrollMonth: '2026-08',
      targetPayrollMonth: '2026-09',
      reason:
        'Collect August attendance deduction in September',
      note:
        'Stage 11 canonical attendance deferral',
    },
    actor
  );

  assert.equal(deferred.amountHalalas, originalDeduction);
  assert.equal(deferred.originalPayrollMonth, '2026-08');
  assert.equal(deferred.targetPayrollMonth, '2026-09');
  assert.equal(deferred.sourceType, 'attendance');

  const retry = await deferAttendanceDeduction(
    db,
    'main',
    {
      employeeId: 'emp-att-deferral',
      originalPayrollMonth: '2026-08',
      targetPayrollMonth: '2026-09',
      reason:
        'Collect August attendance deduction in September',
      note:
        'Stage 11 canonical attendance deferral',
    },
    actor
  );

  assert.equal(
    retry.obligation.id,
    deferred.obligation.id
  );

  const augustAfter = await upsertPayrollEntry(
    db,
    'main',
    {
      employeeId: 'emp-att-deferral',
      payrollMonth: '2026-08',
    },
    actor
  );

  assert.equal(
    Number(
      augustAfter.missing_hours_deduction_halalas || 0
    ),
    0
  );

  const summary = JSON.parse(
    String(augustAfter.attendance_summary_json || '{}')
  );

  assert.equal(
    Number(
      summary.attendanceDerivedMissingHoursDeductionHalalas || 0
    ),
    originalDeduction
  );

  assert.equal(
    Number(
      summary.attendanceDeferredMissingHoursDeductionHalalas || 0
    ),
    originalDeduction
  );

  assert.equal(
    Number(
      summary.attendanceCollectedMissingHoursDeductionHalalas || 0
    ),
    0
  );

  assert.equal(
    summary.attendanceDeductionDeferral.originalPayrollMonth,
    '2026-08'
  );

  assert.equal(
    summary.attendanceDeductionDeferral.targetPayrollMonth,
    '2026-09'
  );

  const obligations = await listPayrollObligations(
    db,
    'main',
    { employeeId: 'emp-att-deferral' }
  );

  const attendanceObligations = obligations.filter(
    (item) =>
      item.sourceType === 'attendance' &&
      item.originalPayrollMonth === '2026-08'
  );

  assert.equal(attendanceObligations.length, 1);

  assert.equal(
    attendanceObligations[0].originalAmountHalalas,
    originalDeduction
  );

  const septemberItems =
    await listPayrollObligationDeductions(
      db,
      'main',
      {
        employeeId: 'emp-att-deferral',
        payrollMonth: '2026-09',
      }
    );

  const attendanceSeptember =
    septemberItems.filter(
      (item) =>
        item.trace?.sourceType === 'attendance' &&
        item.originalPayrollMonth === '2026-08'
    );

  assert.equal(attendanceSeptember.length, 1);

  assert.equal(
    attendanceSeptember[0].amountHalalas,
    originalDeduction
  );

  assert.equal(
    attendanceSeptember[0].targetPayrollMonth,
    '2026-09'
  );

  const septemberPayroll = await upsertPayrollEntry(
    db,
    'main',
    {
      employeeId: 'emp-att-deferral',
      payrollMonth: '2026-09',
    },
    actor
  );

  assert.equal(septemberPayroll.status, 'draft');

  assert.equal(
    Number(
      septemberPayroll.manual_deductions_halalas || 0
    ),
    originalDeduction
  );

  const final = await db.prepare(`
    SELECT
      payroll_month,
      status,
      approved_at,
      paid_at,
      missing_hours_deduction_halalas,
      manual_deductions_halalas
    FROM payroll_entries
    WHERE salon_id = 'main'
      AND employee_id = 'emp-att-deferral'
      AND payroll_month IN ('2026-08', '2026-09')
    ORDER BY payroll_month
  `).all();

  assert.equal(final.results.length, 2);

  assert.deepEqual(
    final.results.map((row) => row.status),
    ['draft', 'draft']
  );

  assert.equal(
    final.results.filter((row) => row.approved_at).length,
    0
  );

  assert.equal(
    final.results.filter((row) => row.paid_at).length,
    0
  );
});
