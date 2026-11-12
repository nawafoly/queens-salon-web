import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const client = await readFile(new URL('../src/services/coreApiClient.ts', import.meta.url), 'utf8');
const permissions = await readFile(new URL('./core/repositories/permissions.js', import.meta.url), 'utf8');

test('Core permission interval conflict has a user-facing Arabic explanation', () => {
  assert.match(permissions, /new AppError\(409, 'core_permission:interval_conflict'/);
  assert.match(client, /"core_permission:interval_conflict": "[^"]*استئذان[^"]*إجازة[^"]*"/);
});

test('cross-midnight permission validation has actionable Arabic explanation', () => {
  assert.match(permissions, /core_permission:cross_midnight_requires_review/);
  assert.match(client, /"core_permission:cross_midnight_requires_review": "[^"]*منتصف الليل[^"]*"/);
});
