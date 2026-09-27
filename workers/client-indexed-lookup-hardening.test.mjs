import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('workers/core/repositories/clients.js', 'utf8');

function functionBlock(signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start + 1);

  assert.ok(start >= 0, `${signature} start missing`);
  assert.ok(end > start, `${nextSignature} boundary missing`);

  return source.slice(start, end);
}

test('client identity resolution uses scoped identity lookups and no listClients scan', () => {
  const resolver = functionBlock(
    'async function resolveClientIdentity',
    'export async function createClient'
  );

  const create = functionBlock(
    'export async function createClient',
    'export async function patchClient'
  );

  const patch = functionBlock(
    'export async function patchClient',
    'export async function upsertClientAlias'
  );

  assert.doesNotMatch(resolver, /listClients\s*\(/);
  assert.doesNotMatch(create, /listClients\s*\(/);
  assert.doesNotMatch(patch, /listClients\s*\(/);

  assert.match(resolver, /firebase_uid\s*=\s*\?/);
  assert.match(resolver, /phone_normalized\s*=\s*\?/);
  assert.match(
    resolver,
    /LOWER\(TRIM\(COALESCE\(email, ''\)\)\)\s*=\s*\?/
  );

  assert.match(create, /resolveClientIdentity\(db, salonId/);
  assert.match(patch, /resolveClientIdentity\(db, salonId/);
});
