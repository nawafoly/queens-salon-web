import assert from 'node:assert/strict';
import test from 'node:test';

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
