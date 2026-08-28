import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('./core/index.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/CoreComplianceService.ts', import.meta.url), 'utf8');
const typeSource = readFileSync(new URL('../src/types/complianceCoreApi.ts', import.meta.url), 'utf8');

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
  ]) assert.ok(coreSource.includes(token), 'missing Core API contract: ' + token);
});

test('frontend has typed canonical access to compliance Core routes', () => {
  for (const token of [
    'classifyPayrollObligation',
    'classifyRecurringPayrollDeduction',
    'listPayrollDeductionClassificationEvents',
    'createPayrollDeductionCourtOverride',
    'cancelPayrollDeductionCourtOverride',
    'listDisciplinaryCases',
    'createDisciplinaryCase',
    'cancelDisciplinaryCase',
    '/api/core/hr/payroll-deduction-classification-events',
    '/api/core/hr/payroll-deduction-overrides',
    '/api/core/hr/disciplinary-cases',
  ]) assert.ok(serviceSource.includes(token), 'missing frontend compliance contract: ' + token);

  for (const token of [
    'CorePayrollDeductionClassificationInput',
    'CorePayrollDeductionClassificationEvent',
    'CorePayrollDeductionCourtOverride',
    'CoreDisciplinaryCase',
  ]) assert.ok(typeSource.includes(token), 'missing frontend compliance type: ' + token);
});
