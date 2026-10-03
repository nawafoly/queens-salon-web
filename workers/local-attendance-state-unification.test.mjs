import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/restore-local-d1-from-production.mjs', 'utf8');

test('local D1 restore keeps Core and Attendance in the same root Wrangler state', () => {
  assert.match(source, /core:[\s\S]*stateRoot:\s*resolve\(root, '\.wrangler\/state'\)/);
  assert.match(source, /attendance:[\s\S]*stateRoot:\s*resolve\(root, '\.wrangler\/state'\)/);
  assert.doesNotMatch(source, /stateRoot:\s*resolve\(root, 'workers\/\.wrangler\/state'\)/);
});
