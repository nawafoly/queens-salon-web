import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src/pages/Booking.tsx');
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const pattern = /\n\s*const leave = getStaffLeaveMetaForDate\(st as any, dateISO\);\n\s*const workingSlots = filterSlotsToCoreWindows\(baseSlotsForDate, getCoreStaffWindows\(dateISO, String\(\(st as any\)\?\.id \|\| ""\)\.trim\(\)\)\);\n\n\s*if \(leave\.isOnLeave \|\| !workingSlots\.length\) \{\n\s*nextState\[itemId\]\[empId\] = false;\n\s*return;\n\s*\}\n/;

const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
if (matches.length !== 1) {
  throw new Error(`[core-availability-precheck-race] expected exactly 1 legacy pre-check, found ${matches.length}`);
}

text = text.replace(
  pattern,
  `\n              // Core availability below is authoritative for dated staff visibility.\n              // Do not pre-decide availability from the schedule-window cache before\n              // the request has populated it; this avoids showing off/leave staff.\n`
);

if (text.includes('const workingSlots = filterSlotsToCoreWindows(baseSlotsForDate, getCoreStaffWindows(dateISO')) {
  throw new Error('[core-availability-precheck-race] legacy pre-check still present after replacement');
}

const output = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(file, output.endsWith(eol) ? output : `${output}${eol}`, 'utf8');
console.log('[core-availability-precheck-race] fixed Booking Core availability pre-check race.');
