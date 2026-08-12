import fs from 'node:fs';

const file = 'workers/frontend-core-migration.test.mjs';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const oldBlock = `  assert.match(permissionContext, /normalizeAppPermissions\\(permissions\\)/);
  assert.doesNotMatch(permissionContext, /getEffectiveAppPermissions/);`;
const newBlock = `  assert.match(permissionContext, /getEffectiveAppPermissions/);
  assert.doesNotMatch(permissionContext, /normalizeAppPermissions\\(permissions\\)/);`;

if (!text.includes(newBlock)) {
  const count = text.split(oldBlock).length - 1;
  if (count !== 1) throw new Error(`[frontend-permission-test] expected one stale permission assertion block, found ${count}`);
  text = text.replace(oldBlock, newBlock);
}

if (!text.includes(newBlock)) throw new Error('[frontend-permission-test] current permission assertion is missing');

// Keep git diff --check clean: exactly one newline at EOF.
text = text.replace(/\n+$/, '') + '\n';
fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[frontend-permission-test] effective permission contract installed');
