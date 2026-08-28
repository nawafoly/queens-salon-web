import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./core/index.js', import.meta.url), 'utf8');

test('Saudi compliance runtimes are reachable through Core API', () => {
  for (const token of [
    'classifyPayrollObligationDeduction',
    'classifyRecurringPayrollDeduction',
    'savePayrollDeductionCourtOverride',
    'cancelPayrollDeductionCourtOverride',
    'createDisciplinaryCase',
    'cancelDisciplinaryCase',
    '/api/core/hr/payroll-deduction-classification-events',
    '/api/core/hr/payroll-deduction-overrides',
    '/api/core/hr/disciplinary-cases',
  ]) assert.ok(source.includes(token), 'missing Core API contract: ' + token);
});
