import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('approved permission preserves actual out and return lifecycle', () => {
  const permissions = readFileSync('workers/core/repositories/permissions.js','utf8');
  const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js','utf8');
  assert.match(permissions, /SET status = 'approved'/);
  assert.match(permissions, /autoFinalized: false/);
  assert.doesNotMatch(permissions, /autoFinalized: true/);
  const s = requests.indexOf('async function createPermissionEffect');
  const e = requests.indexOf('function employeeRequestLeavePolicy', s);
  const block = requests.slice(s, e);
  assert.match(block, /'employee_request', 'approved'/);
  assert.doesNotMatch(block, /permission_out/);
  assert.doesNotMatch(block, /permission_return/);
  assert.match(requests, /after: \{ status: 'approved' \}/);
});
