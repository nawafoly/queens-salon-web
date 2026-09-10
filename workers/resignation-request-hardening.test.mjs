import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');

test('resignation execution terminates canonical employment and preserves end date', () => {
  assert.match(requests, /employment_status = 'terminated', end_date = \?/);
  assert.match(requests, /resignation_employment_sync_failed/);
  assert.match(requests, /UPDATE user_employee_links SET link_status = 'inactive'/);
  assert.match(requests, /employment_record_required/);
});
