import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'scripts/cutover-booking-customer-core-hr-stage2.mjs');
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const start = text.indexOf('function replaceRegex(');
const endMarker = '\n\nfunction replaceBetween(';
const end = start >= 0 ? text.indexOf(endMarker, start) : -1;
if (start < 0 || end < 0) {
  throw new Error('[repair-customer-stage2] replaceRegex helper markers not found');
}

const replacement = `function replaceRegex(regex, replacement, label, expected = 1) {
  const scanRegex = regex.global
    ? regex
    : new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : \`${'${regex.flags}'}g\`);
  const matches = [...text.matchAll(scanRegex)];
  if (matches.length !== expected) {
    throw new Error(\`[customer-core-hr-stage2] ${'${label}'}: expected ${'${expected}'}, got ${'${matches.length}'}\`);
  }
  text = text.replace(regex, replacement);
}`;

const current = text.slice(start, end);
if (current.includes('const scanRegex = regex.global')) {
  console.log('[repair-customer-stage2] helper already repaired');
  process.exit(0);
}

text = text.slice(0, start) + replacement + text.slice(end);
const next = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(file, next, 'utf8');
console.log('[repair-customer-stage2] repaired non-global RegExp scanning safely');
