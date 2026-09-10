import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('workers/core/repositories/clients.js', 'utf8');

function block(name, next) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${next}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} block missing`);
  return source.slice(start, end);
}

test('client create and phone conflict checks use indexed point lookups', () => {
  const create = block('createClient', 'patchClient');
  const patch = block('patchClient', 'upsertClientAlias');
  assert.doesNotMatch(create, /listClients\s*\(/);
  assert.doesNotMatch(patch, /listClients\s*\(/);
  assert.match(create, /salon_id = \? AND firebase_uid = \? LIMIT 1/);
  assert.match(create, /salon_id = \? AND phone_normalized = \? LIMIT 1/);
  assert.match(patch, /salon_id = \? AND phone_normalized = \? AND id <> \? LIMIT 1/);
});
