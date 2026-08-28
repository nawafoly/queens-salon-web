import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  overtimeRequestFinancialAuthority,
} from './core/repositories/employee-request-overtime.js';

test('overtime request approval never creates payroll money from requested minutes', () => {
  const authority = overtimeRequestFinancialAuthority();
  assert.equal(authority.requestApprovalCreatesPayrollAmount, false);
  assert.equal(authority.actualAttendanceAuthoritative, true);
  assert.match(authority.policyVersion, /^sa-labor-/);
});

test('overtime request migration stores compensation and attendance reconciliation state', () => {
  const source = readFileSync(
    new URL('../migrations/core/0043_sa_overtime_request_runtime.sql', import.meta.url),
    'utf8'
  );
  assert.match(source, /compensation_mode/);
  assert.match(source, /employee_consent_at/);
  assert.match(source, /actual_worked_minutes/);
  assert.match(source, /financial_status/);
  assert.match(source, /pending_attendance/);
});

test('statutory overtime request runtime does not mutate payroll entries directly', () => {
  const source = readFileSync(
    new URL('./core/repositories/employee-request-overtime.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /UPDATE\s+payroll_entries/i);
  assert.doesNotMatch(source, /hourly_rate_halalas\s*\*/i);
  assert.match(source, /actual_attendance_and_canonical_payroll/);
});
