from pathlib import Path

p = Path('workers/core/repositories/clients.js')
t = p.read_text(encoding='utf-8')
old_create = '''  const existingRows = await listClients(db, salonId);\n  const existing = existingRows.find(\n    (row) =>\n      (firebaseUid && cleanText(row.firebase_uid) === firebaseUid) ||\n      (phone && cleanText(row.phone_normalized) === phone)\n  );\n  if (existing) return existing;\n'''
new_create = '''  let existing = null;\n  if (firebaseUid) {\n    existing = await dbFirst(\n      db,\n      "SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ? LIMIT 1",\n      [salonId, firebaseUid]\n    );\n  }\n  if (!existing && phone) {\n    existing = await dbFirst(\n      db,\n      "SELECT * FROM clients WHERE salon_id = ? AND phone_normalized = ? LIMIT 1",\n      [salonId, phone]\n    );\n  }\n  if (existing) return existing;\n'''
if t.count(old_create) != 1:
    raise SystemExit(f'create client anchor mismatch: {t.count(old_create)}')
t = t.replace(old_create, new_create, 1)
old_patch = '''  if (phone) {\n    const existingRows = await listClients(db, salonId);\n    const duplicate = existingRows.find(\n      (row) =>\n        row.id !== current.id && cleanText(row.phone_normalized) === phone\n    );\n    if (duplicate) {\n      throw new AppError(\n        409,\n        'core_client:phone_conflict',\n        'Another client already uses this mobile number.'\n      );\n    }\n  }\n'''
new_patch = '''  if (phone) {\n    const duplicate = await dbFirst(\n      db,\n      "SELECT id FROM clients WHERE salon_id = ? AND phone_normalized = ? AND id <> ? LIMIT 1",\n      [salonId, phone, current.id]\n    );\n    if (duplicate) {\n      throw new AppError(\n        409,\n        'core_client:phone_conflict',\n        'Another client already uses this mobile number.'\n      );\n    }\n  }\n'''
if t.count(old_patch) != 1:
    raise SystemExit(f'patch client anchor mismatch: {t.count(old_patch)}')
t = t.replace(old_patch, new_patch, 1)
p.write_text(t, encoding='utf-8')

Path('workers/client-indexed-lookup-hardening.test.mjs').write_text("""import test from 'node:test';
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
""", encoding='utf-8')
