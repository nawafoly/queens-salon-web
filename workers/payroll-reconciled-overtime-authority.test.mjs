import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const payroll = readFileSync('workers/core/repositories/payroll.js', 'utf8');
const migration = readFileSync('migrations/core/0045_payroll_reconciled_overtime_authority.sql', 'utf8');
const approvalGuards = readFileSync('migrations/core/0046_payroll_reconciled_overtime_approval_guards.sql', 'utf8');

test('draft payroll financial overtime comes only from reconciled cash overtime', () => {
  assert.match(
    payroll,
    /import\s*\{\s*listReconciledCashOvertimeForPayroll\s*\}\s*from\s*['"]\.\/overtime-reconciliation\.js['"]/
  );
  assert.match(payroll, /const reconciledCashOvertimeRows\s*=\s*await listReconciledCashOvertimeForPayroll/);
  assert.match(payroll, /const reconciledOvertimeMinutes\s*=\s*reconciledCashOvertimeRows\.reduce/);
  assert.match(payroll, /const financialOvertimeHours\s*=\s*payrollRoundHours\(reconciledOvertimeMinutes \/ 60\)/);
  assert.match(payroll, /overtimeMinutes:\s*reconciledOvertimeMinutes/);
  assert.doesNotMatch(
    payroll,
    /const financialOvertimeHours\s*=\s*[\s\S]{0,120}\?\s*detectedExtraHours\s*:\s*0/
  );
});

test('locked payroll carryover preserves approved overtime instead of inventing money from raw extra time', () => {
  assert.match(
    payroll,
    /Approved\/paid payroll is an immutable overtime financial snapshot/
  );
  assert.match(
    payroll,
    /const overtimeValueHalalas\s*=\s*intMoney\(\s*sourceEntry\.overtime_value_halalas\s*\)/
  );
});

test('raw detected extra time stays informational and reconciled evidence is exposed in attendance snapshot', () => {
  assert.match(payroll, /summary\.rawDetectedExtraHours\s*=\s*detectedExtraHours/);
  assert.match(payroll, /summary\.reconciledCashOvertimeMinutes\s*=\s*reconciledOvertimeMinutes/);
  assert.match(payroll, /summary\.overtimeFinancialAuthority\s*=\s*'reconciled_cash_overtime_only'/);
});

test('database prevents comp-time and cash-payroll double compensation', () => {
  assert.match(migration, /comp_time_cannot_be_included_in_payroll/);
  assert.match(migration, /included_overtime_requires_reconciled_cash_evidence/);
  assert.match(migration, /comp_time_credit_requires_reconciled_nonpayroll_evidence/);
  assert.match(migration, /overtime_payroll_month_locked/);
  assert.match(migration, /payroll_reconciled_overtime_snapshot_stale/);
  assert.match(migration, /trg_payroll_approval_include_reconciled_overtime/);
  assert.match(migration, /trg_payroll_reopen_release_reconciled_overtime/);
  assert.match(approvalGuards, /payroll_reconciled_overtime_hours_mismatch/);
  assert.match(approvalGuards, /payroll_reconciled_overtime_value_formula_mismatch/);
});
