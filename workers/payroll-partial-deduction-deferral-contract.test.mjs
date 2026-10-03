import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('partial payroll deduction deferral is canonical, atomic, and excluded from statutory deductions', () => {
  const migration = read('migrations/core/0093_payroll_partial_deduction_deferrals.sql');
  const policy = read('src/helpers/hr/payrollObligationPolicy.js');
  const core = read('workers/core/index.js');
  const payroll = read('workers/core/repositories/payroll.js');
  const obligations = read('workers/core/repositories/payroll-obligations.js');
  const deferrals = read('workers/core/repositories/payroll-deduction-deferrals.js');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_deduction_deferrals/);
  assert.match(migration, /idx_payroll_deduction_deferrals_request/);
  assert.match(migration, /FOREIGN KEY \(obligation_id\)[\s\S]*employee_payroll_obligations/);

  assert.match(policy, /export function isDeferrableDeductionKind/);
  assert.match(policy, /NON_DEFERRABLE_KINDS/);

  assert.match(core, /\/api\/core\/hr\/payroll-deduction-deferrals\/defer/);
  assert.match(core, /payroll-deduction-deferral:defer/);
  assert.match(core, /requirePermission\(ctx, ["']payroll\.manage["']\)/);

  assert.match(obligations, /payroll_deduction_deferral/);
  assert.match(obligations, /export async function buildCanonicalPayrollObligationCreate/);

  assert.match(deferrals, /buildCanonicalPayrollObligationCreate/);
  assert.match(deferrals, /await dbBatch\(/);
  assert.match(deferrals, /partial_deduction_deferral_idempotency_conflict/);

  assert.match(payroll, /export async function deferPayrollDeductions/);
  assert.match(payroll, /getActivePayrollDeductionDeferralTotal/);
  assert.match(payroll, /canonicalDeferrableDeductionsHalalas/);
  assert.match(payroll, /canonicalDeferredDeductionsHalalas/);
  assert.match(
    payroll,
    /canonicalAdvanceHalalas\s*-\s*canonicalDeferredDeductionsHalalas/
  );
  assert.match(payroll, /partial_deduction_deferral_exceeds_available_deductions/);
});
