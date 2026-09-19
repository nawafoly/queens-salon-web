import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { listPayrollCarryoverAdjustments } from './core/repositories/payroll.js';

import {
  nextPayrollMonth,
  payrollCarryoverDelta,
  payrollCarryoverItem,
  payrollCarryoverNetHalalas,
  previousPayrollMonth,
  withoutPayrollCarryoverItems,
} from '../src/helpers/hr/payrollCarryoverPolicy.js';

test('payroll carryover uses the full-period final delta against the immutable approval snapshot', () => {
  const deduction = payrollCarryoverDelta(294700, 284700);
  assert.deepEqual(deduction, {
    approvedNetHalalas: 294700,
    recalculatedNetHalalas: 284700,
    signedDeltaHalalas: -10000,
    direction: 'deduction',
    amountHalalas: 10000,
  });

  const addition = payrollCarryoverDelta(294700, 304700);
  assert.equal(addition.signedDeltaHalalas, 10000);
  assert.equal(addition.direction, 'addition');
  assert.equal(addition.amountHalalas, 10000);

  const unchanged = payrollCarryoverDelta(294700, 294700);
  assert.equal(unchanged.direction, 'none');
  assert.equal(unchanged.amountHalalas, 0);
});

test('payroll carryover targets the adjacent payroll month deterministically', () => {
  assert.equal(nextPayrollMonth('2026-08'), '2026-09');
  assert.equal(previousPayrollMonth('2026-09'), '2026-08');
  assert.equal(nextPayrollMonth('2026-12'), '2027-01');
});

test('payroll carryover items are traceable and never mixed with ordinary manual items', () => {
  const addition = payrollCarryoverItem({
    id: 'carry-1',
    direction: 'addition',
    amountHalalas: 7500,
    sourcePayrollMonth: '2026-08',
    sourceDate: '2026-08-31',
    reason: 'تسوية نهائية لمسيرة أغسطس',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });
  const deduction = payrollCarryoverItem({
    id: 'carry-2',
    direction: 'deduction',
    amountHalalas: 10000,
    sourcePayrollMonth: '2026-08',
    sourceDate: '2026-08-31',
  });
  const ordinary = { id: 'manual-1', amountHalalas: 5000, reason: 'يدوي' };

  assert.equal(addition.sourceType, 'payroll_carryover');
  assert.equal(addition.sourceId, 'carry-1');
  assert.equal(addition.sourcePayrollMonth, '2026-08');
  assert.equal(addition.sourceDate, '2026-08-31');
  assert.equal(payrollCarryoverNetHalalas([addition], [deduction]), -2500);
  assert.deepEqual(withoutPayrollCarryoverItems([ordinary, addition]), [ordinary]);
});


test('payroll carryover D1 reads are scoped before materialization', async () => {
  const calls = [];

  const db = {
    __fakeD1: true,
    async all(sql, params) {
      calls.push({ sql, params });
      return [{ id: 'carry-query-scope-1' }];
    },
  };

  const activeRows = await listPayrollCarryoverAdjustments(
    db,
    'main',
    {
      employeeId: 'emp-1',
      targetPayrollMonth: '2026-09',
      status: 'active',
    }
  );

  assert.equal(activeRows.length, 1);
  assert.equal(calls.length, 1);

  assert.match(
    calls[0].sql,
    /WHERE salon_id = \?\s+AND target_payroll_month = \?\s+AND employee_id = \?\s+AND status IN \(\?, \?\)/s
  );

  assert.deepEqual(
    calls[0].params,
    [
      'main',
      '2026-09',
      'emp-1',
      'pending',
      'applied',
    ]
  );

  calls.length = 0;

  await listPayrollCarryoverAdjustments(
    db,
    'main',
    {
      employee_id: 'emp-2',
      target_payroll_month: '2026-10',
      source_payroll_month: '2026-08',
      status: 'pending',
    }
  );

  assert.equal(calls.length, 1);

  assert.match(
    calls[0].sql,
    /AND source_payroll_month = \?/s
  );

  assert.match(
    calls[0].sql,
    /AND status = \?/s
  );

  assert.deepEqual(
    calls[0].params,
    [
      'main',
      '2026-10',
      'emp-2',
      'pending',
      '2026-08',
    ]
  );
});

test('historical HR correction keeps carryover source, amount, direction and target under Core authority', async () => {
  const [payrollRepository, leaveRepository, corePayrollService, coreHrService] =
    await Promise.all([
      readFile(new URL('./core/repositories/payroll.js', import.meta.url), 'utf8'),
      readFile(new URL('./core/repositories/leaves.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/services/CorePayrollService.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/services/CoreHrService.ts', import.meta.url), 'utf8'),
    ]);

  assert.match(
    payrollRepository,
    /firstEligibleCarryoverTargetMonth\([\s\S]*?payroll_entries[\s\S]*?payroll_periods/
  );
  assert.match(
    payrollRepository,
    /Any caller-supplied[\s\S]*?firstEligibleCarryoverTargetMonth\(/
  );
  assert.match(
    leaveRepository,
    /reconcileLockedPayrollImpactForHrCorrection\([\s\S]*?\{ leaveId: idValue \}/
  );
  assert.match(
    corePayrollService,
    /sourcePayrollEntryId: sourceEntry\.id,\s+sourceDate:/
  );
  assert.doesNotMatch(
    corePayrollService,
    /sourcePayrollEntryId: sourceEntry\.id,\s+targetPayrollMonth:/
  );
  assert.doesNotMatch(
    coreHrService,
    /sourcePayrollEntryId: string;\s+targetPayrollMonth: string;/
  );
});


test('time-entitlement leave cannot create monetary carryover against locked payroll', async () => {
  const source = await readFile(
    new URL('./core/repositories/payroll.js', import.meta.url),
    'utf8'
  );

  const start = source.indexOf(
    'export async function reconcileLockedPayrollImpactForHrCorrection('
  );
  const end = source.indexOf(
    '\nconst PAYROLL_ENTRY_MUTATION_COLUMNS',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = source.slice(start, end);

  assert.match(fn, /weekly_rest_substitute_use/);
  assert.match(fn, /overtime_comp_time_use/);
  assert.match(fn, /non_monetary_time_entitlement_leave/);

  const guard = fn.indexOf(
    "skipReason: 'non_monetary_time_entitlement_leave'"
  );
  const lockedPayrollRead = fn.indexOf('FROM payroll_entries');

  assert.ok(guard >= 0);
  assert.ok(lockedPayrollRead > guard);
});

test('ordinary paid leave is not globally excluded from locked payroll reconciliation', async () => {
  const source = await readFile(
    new URL('./core/repositories/payroll.js', import.meta.url),
    'utf8'
  );

  const start = source.indexOf(
    'export async function reconcileLockedPayrollImpactForHrCorrection('
  );
  const end = source.indexOf(
    '\nconst PAYROLL_ENTRY_MUTATION_COLUMNS',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = source.slice(start, end);

  assert.doesNotMatch(
    fn,
    /Number\(leave\.affects_payroll \|\| 0\) !== 1/
  );
});


test('linked permission reversal completes before historical payroll reconciliation', async () => {
  const source = await readFile(
    new URL(
      './core/repositories/employee-requests-legacy.js',
      import.meta.url
    ),
    'utf8'
  );

  const start = source.indexOf(
    'async function cancelExecutedLeaveRequest('
  );
  const end = source.indexOf(
    '\nexport async function transitionEmployeeRequest',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = source.slice(start, end);

  const leaveDecision = fn.indexOf('await decideLeave(');
  const skip = fn.indexOf(
    'skipPayrollReconciliation: true',
    leaveDecision
  );
  const permissionDecision = fn.indexOf(
    'await decidePermissionRequest(',
    leaveDecision
  );
  const reconciliation = fn.indexOf(
    'await reconcileLockedPayrollImpactForHrCorrection(',
    permissionDecision
  );

  assert.ok(leaveDecision >= 0);
  assert.ok(skip > leaveDecision);
  assert.ok(permissionDecision > skip);
  assert.ok(reconciliation > permissionDecision);
});

test('historical locked payroll is the only path allowed to bypass current active employment', async () => {
  const [source, shiftControl] = await Promise.all([
    readFile(
      new URL(
        './core/repositories/payroll.js',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        './core/repositories/shift-control.js',
        import.meta.url
      ),
      'utf8'
    ),
  ]);

  assert.match(
    source,
    /canonicalEmployment\(db, salonId, employeeId, options = \{\}\)/
  );

  assert.match(
    source,
    /options\.allowInactive !== true/
  );

  const historicalStart = source.indexOf(
    'async function canonicalRecalculatedNetForLockedEntry('
  );

  assert.ok(historicalStart >= 0);

  const historicalBlock = source.slice(
    historicalStart,
    historicalStart + 3000
  );

  assert.match(
    historicalBlock,
    /canonicalEmployment\([\s\S]*?\{ allowInactive: true \}/
  );

  assert.match(
    historicalBlock,
    /buildCanonicalAttendanceSummary\([\s\S]*?allowInactiveHistoricalPayroll: true/
  );

  assert.match(
    shiftControl,
    /runtime\.allowInactiveHistoricalPayroll === true[\s\S]*?employeeHistoricallyOperationalOnDate/
  );

  assert.match(
    shiftControl,
    /return !cleanText\(row\.end_date\) \|\| date <= cleanText\(row\.end_date\)/
  );
});


test('payroll carryover reconciliation mutates pending state atomically', async () => {
  const source = await readFile(
    new URL('./core/repositories/payroll.js', import.meta.url),
    'utf8'
  );

  const start = source.indexOf(
    'async function reconcilePayrollCarryover('
  );
  const end = source.indexOf(
    '\nexport async function reconcilePayrollCarryoversBatch',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = source.slice(start, end);

  assert.match(fn, /const carryoverStatements = \[\]/);
  assert.match(fn, /carryoverStatements\.push\(/);
  assert.match(fn, /await dbBatch\(db, carryoverStatements\)/);
  assert.doesNotMatch(
    fn,
    /for \(const obsolete of pendingRows\)[\s\S]*?await dbRun\(/
  );
});


test('historical direct settlements reduce carryover without mutating locked payroll', async () => {
  const [source, migration, ui] = await Promise.all([
    readFile(
      new URL('./core/repositories/payroll.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../migrations/core/0077_payroll_historical_settlements.sql',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/pages/DashboardPayroll.tsx', import.meta.url),
      'utf8'
    ),
  ]);

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS payroll_historical_settlements/
  );
  assert.match(
    source,
    /desired\.signedDeltaHalalas - historicalSettledSigned/
  );
  assert.match(
    source,
    /export async function recordPayrollHistoricalSettlement/
  );
  assert.match(
    source,
    /prependStatements: \[insertStatement\]/
  );
  assert.match(
    source,
    /virtualSettlementSignedHalalas: signedAmount/
  );

  const start = source.indexOf(
    'export async function recordPayrollHistoricalSettlement('
  );
  const end = source.indexOf(
    '\nexport async function voidPayrollHistoricalSettlement(',
    start
  );
  assert.ok(start >= 0);
  assert.ok(end > start);
  const recordFn = source.slice(start, end);

  assert.doesNotMatch(recordFn, /UPDATE payroll_entries/);
  assert.match(
    ui,
    /تسويات بعد إقفال هذه الفترة/
  );
  assert.match(
    ui,
    /الراتب الأصلي لن يتغير/
  );
});
