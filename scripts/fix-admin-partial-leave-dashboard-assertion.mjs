import fs from 'node:fs';

const path = 'workers/admin-partial-leave-policy.test.mjs';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const replacement = '  assert.equal(dashboard.includes("if (!isPartialLeave)"), true);';
const lines = text.split('\n');
const indexes = lines
  .map((line, index) => line.includes('assert.match(dashboard, /if ') ? index : -1)
  .filter((index) => index >= 0);

if (!text.includes(replacement)) {
  if (indexes.length !== 1) {
    throw new Error(`[partial-leave-dashboard-assertion] expected one dashboard if assertion, found ${indexes.length}`);
  }
  lines[indexes[0]] = replacement;
  text = lines.join('\n');
}

if (!text.includes(replacement)) {
  throw new Error('[partial-leave-dashboard-assertion] literal dashboard guard assertion is missing');
}

fs.writeFileSync(path, `${text.replace(/\s+$/g, '')}\n`, 'utf8');
console.log('[partial-leave-dashboard-assertion] literal dashboard guard assertion installed');
