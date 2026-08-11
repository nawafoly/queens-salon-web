import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'src/pages/Booking.tsx');
let source = fs.readFileSync(filePath, 'utf8');
const eol = source.includes('\r\n') ? '\r\n' : '\n';
const normalized = source.replace(/\r\n/g, '\n');

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`[booking-stale-staff] expected source not found: ${label}`);
  const second = content.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(`[booking-stale-staff] source matched more than once: ${label}`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

let next = normalized;
next = replaceOnce(
  next,
  `                          const selectedEmployeeAvailable = availableStaff.some(\n                            (emp) => String(emp?.id || "").trim() === String(it.employeeId || "").trim()\n                          );`,
  `                          const selectedEmployeeAvailable = staffChoicesForItem.some(\n                            (emp) => String(emp?.id || "").trim() === String(it.employeeId || "").trim()\n                          );`,
  'selected employee availability must follow Core-filtered staff choices'
);

next = replaceOnce(
  next,
  `                          const selectedStaffForTime = bookingVisibleStaff.find(\n                            (x) => String(x.id || "").trim() === String(it.employeeId || "").trim()\n                          );`,
  `                          const selectedStaffForTime = staffChoicesForItem.find(\n                            (x) => String(x.id || "").trim() === String(it.employeeId || "").trim()\n                          );`,
  'time picker must not keep a Core-unavailable stale staff selection'
);

if (next === normalized) {
  console.log('[booking-stale-staff] no changes required.');
  process.exit(0);
}

source = eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next;
fs.writeFileSync(filePath, source, 'utf8');
console.log('[booking-stale-staff] Booking.tsx updated successfully.');
