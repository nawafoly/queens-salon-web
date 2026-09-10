import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');

test('exit return actual timestamps are management-only, chronological and non-future', () => {
  assert.match(requests, /actionKey === 'record-exit'[\s\S]*options\.ownOnly/);
  assert.match(requests, /actual_exit_before_approval/);
  assert.match(requests, /actualExitMs > nowMs \+ 5 \* 60 \* 1000/);
  assert.match(requests, /actualReturnMs <= actualExitMs/);
  assert.match(requests, /actualDurationMinutes/);
});
