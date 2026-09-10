import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/hr/EmployeeLeave.tsx', 'utf8');

test('employee leave page creates requests through Core managed workflow', () => {
  assert.match(page, /createManagedLeaveRequest/);
  assert.doesNotMatch(page, /\bcreateLeaveRequest\s*\(/);
});
