import fs from 'node:fs';

const path = 'workers/admin-partial-leave-policy.test.mjs';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const dashboardReplacement = '  assert.equal(dashboard.includes("if (!isPartialLeave)"), true);';
const hubReplacement = '  assert.equal(hub.includes(\'durationKind: cleanText(input.durationKind).toLowerCase() === "partial" ? "partial" : "full_day",\'), true);';

const lines = text.split('\n');

function replaceAssertion(needle, replacement, label) {
  if (lines.includes(replacement)) return;
  const indexes = lines
    .map((line, index) => line.includes(needle) ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length !== 1) {
    throw new Error(`[partial-leave-static-assertion] expected one ${label} assertion, found ${indexes.length}`);
  }
  lines[indexes[0]] = replacement;
}

replaceAssertion('assert.match(dashboard, /if ', dashboardReplacement, 'dashboard guard');
replaceAssertion('assert.match(hub, /durationKind:', hubReplacement, 'employeeHub durationKind');

text = lines.join('\n');
if (!text.includes(dashboardReplacement)) {
  throw new Error('[partial-leave-static-assertion] literal dashboard guard assertion is missing');
}
if (!text.includes(hubReplacement)) {
  throw new Error('[partial-leave-static-assertion] literal employeeHub durationKind assertion is missing');
}

fs.writeFileSync(path, `${text.replace(/\s+$/g, '')}\n`, 'utf8');
console.log('[partial-leave-static-assertion] literal dashboard and employeeHub assertions installed');
