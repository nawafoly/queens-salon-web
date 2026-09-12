import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/pages/hr/EmployeeRequests.tsx', 'utf8');
const portal = readFileSync('src/pages/EmployeePortal.tsx', 'utf8');
const core = readFileSync('workers/core/repositories/employee-requests.js', 'utf8');

test('employee request catalog hides leave cash substitution that Core rejects', () => {
  assert.match(ui, /const REQUEST_TYPES: EmployeeRequestType\[\]/);
  assert.match(ui, /filter\(\(type\) => type !== "exceptional_financial_payment"\)/);
  assert.doesNotMatch(portal, /\/employee\/requests\?new=exceptional_financial_payment/);
  assert.match(core, /annual_leave_cash_substitution_during_service_not_allowed/);
});
