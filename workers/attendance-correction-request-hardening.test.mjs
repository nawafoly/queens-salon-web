import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');

test('attendance correction voids records instead of physically deleting them', () => {
  assert.doesNotMatch(source, /DELETE FROM attendance_records WHERE id = \?/);
  assert.doesNotMatch(source, /DELETE FROM attendance_records WHERE salon_id = \? AND id = \?/);
  assert.match(source, /result = 'rejected'/);
  assert.match(source, /rejection_reason = 'voided_by_employee_request'/);
  assert.match(source, /record_type = \?/);
  assert.match(source, /employee_request_void/);
  assert.match(source, /attendance_void_failed/);
});
