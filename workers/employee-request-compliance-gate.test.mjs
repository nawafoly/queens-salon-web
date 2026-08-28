import assert from 'node:assert/strict';
import test from 'node:test';

import {
  employeeRequestComplianceGate,
} from './core/repositories/employee-requests.js';

test('new active-service annual leave cash substitution requests are blocked', () => {
  for (const action of ['', 'approve', 'execute']) {
    const gate = employeeRequestComplianceGate(
      'exceptional_financial_payment',
      action
    );
    assert.equal(gate.allowed, false);
    assert.equal(
      gate.code,
      'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed'
    );
  }
});

test('historical exceptional financial payment cancellation and rejection remain auditable paths', () => {
  assert.equal(
    employeeRequestComplianceGate(
      'exceptional_financial_payment',
      'cancel'
    ).allowed,
    true
  );
  assert.equal(
    employeeRequestComplianceGate(
      'exceptional_financial_payment',
      'reject'
    ).allowed,
    true
  );
});

test('overtime execution is allowed because the wrapper owns a statutory runtime', () => {
  assert.equal(
    employeeRequestComplianceGate('overtime', 'execute').allowed,
    true
  );
});

test('ordinary employee request actions remain available', () => {
  for (const requestType of [
    'leave',
    'permission',
    'salary_advance',
    'resignation',
    'exit_return',
  ]) {
    assert.equal(
      employeeRequestComplianceGate(requestType, 'execute').allowed,
      true
    );
  }
});
