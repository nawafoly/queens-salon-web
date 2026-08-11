import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const explicitFiles = [
  'src/pages/Booking.tsx',
  'src/pages/BookingInternal.tsx',
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
  'src/services/bookingDataSource.ts',
  'src/services/bookingDataSourceCompat.ts',
  'src/services/bookingDataSources/coreD1BookingDataSource.ts',
  'src/services/bookingDataSources/firestoreBookingDataSource.ts',
  'src/helpers/staffAvailability.ts',
  'src/helpers/timeSlots.ts',
  'src/helpers/bookingSharedConstants.ts',
  'workers/core/repositories/availability.js',
  'workers/core/repositories/booking-staff-policy.js',
  'workers/core/repositories/bookings.js',
  'workers/core/repositories/staff.js',
];

const rules = [
  ['staff_schedules', /\bstaff_schedules\b/g],
  ['customWorkingHours', /\bcustomWorkingHours\b/g],
  ['resolveStaffWorkingWindowsForDate', /\bresolveStaffWorkingWindowsForDate\b/g],
  ['filterStaffSlotsByWorkingHours', /\bfilterStaffSlotsByWorkingHours\b/g],
  ['isStaffWorkingAtTime', /\bisStaffWorkingAtTime\b/g],
  ['isStaffAvailableForDate', /\bisStaffAvailableForDate\b/g],
  ['legacy leave_start_date', /\bleave_start_date\b/g],
  ['legacy leave_end_date', /\bleave_end_date\b/g],
  ['Firestore booking datasource', /firestoreBookingDataSource/g],
  ['Firestore booking import', /from\s+["'][^"']*firestore(?:Bookings|StaffPublic|Catalog|Availability)[^"']*["']/gi],
  ['Firebase Firestore runtime', /from\s+["']firebase\/firestore["']/g],
  ['ALLOW_OVERTIME_MIN', /\bALLOW_OVERTIME_MIN\b/g],
  ['hardcoded 12:00', /["']12:00["']/g],
  ['hardcoded 22:00', /["']22:00["']/g],
  ['hardcoded 14:00', /["']14:00["']/g],
  ['hardcoded 23:00', /["']23:00["']/g],
  ['fallback 10:00-22:00', /(?:10:00.{0,100}22:00|22:00.{0,100}10:00)/g],
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
}

function lineForIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

const findings = [];
for (const file of explicitFiles) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) continue;
  const text = read(file);
  const lines = text.split('\n');
  for (const [label, regex] of rules) {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    for (const match of text.matchAll(re)) {
      const line = lineForIndex(text, match.index ?? 0);
      const from = Math.max(1, line - 1);
      const to = Math.min(lines.length, line + 1);
      findings.push({ file, line, label, context: lines.slice(from - 1, to).join(' | ').trim() });
    }
  }
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.label.localeCompare(b.label));

console.log('=== LEGACY BOOKING RUNTIME AUDIT ===');
console.log(`files scanned: ${explicitFiles.length}`);
console.log(`findings: ${findings.length}`);
console.log('');

let current = '';
for (const item of findings) {
  if (item.file !== current) {
    current = item.file;
    console.log(`\n## ${current}`);
  }
  console.log(`[${item.line}] ${item.label}`);
  console.log(`  ${item.context}`);
}

const highRiskLabels = new Set([
  'staff_schedules',
  'customWorkingHours',
  'resolveStaffWorkingWindowsForDate',
  'filterStaffSlotsByWorkingHours',
  'isStaffWorkingAtTime',
  'legacy leave_start_date',
  'legacy leave_end_date',
  'Firestore booking datasource',
]);
const highRisk = findings.filter((x) => highRiskLabels.has(x.label));

console.log('\n=== SUMMARY ===');
const counts = new Map();
for (const item of findings) counts.set(item.label, (counts.get(item.label) || 0) + 1);
for (const [label, count] of [...counts.entries()].sort()) console.log(`${label}: ${count}`);
console.log(`HIGH_RISK_TOTAL: ${highRisk.length}`);

if (process.argv.includes('--fail-on-high-risk') && highRisk.length) process.exitCode = 1;
