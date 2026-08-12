import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const readCode = (file) => read(file)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const failures = [];
const forbid = (file, needle, message) => {
  const text = read(file);
  if (text.includes(needle)) failures.push(`${file}: ${message} [${needle}]`);
};
const forbidCode = (file, needle, message) => {
  const text = readCode(file);
  if (text.includes(needle)) failures.push(`${file}: ${message} [${needle}]`);
};
const forbidRegex = (file, regex, message) => {
  const text = read(file);
  if (regex.test(text)) failures.push(`${file}: ${message} [${regex}]`);
};
const requireText = (file, needle, message) => {
  const text = read(file);
  if (!text.includes(needle)) failures.push(`${file}: ${message} [missing ${needle}]`);
};
const requireRegex = (file, regex, message) => {
  const text = read(file);
  if (!regex.test(text)) failures.push(`${file}: ${message} [missing ${regex}]`);
};

const audit = spawnSync(
  process.execPath,
  ['scripts/audit-legacy-booking-runtime.mjs', '--fail-on-high-risk'],
  { cwd: root, encoding: 'utf8' }
);
if (audit.status !== 0) {
  const output = `${audit.stdout || ''}\n${audit.stderr || ''}`;
  const total = output.match(/HIGH_RISK_TOTAL:\s*(\d+)/)?.[1] || 'unknown';
  failures.push(`repo-wide booking runtime audit still has high-risk findings (HIGH_RISK_TOTAL=${total})`);
}

// Customer and V2 own actual scheduling decisions. The historical internal
// route is intentionally a thin compatibility delegate to V2 so it cannot
// maintain a second booking policy engine.
const decisionUiFiles = [
  'src/pages/Booking.tsx',
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
];
const bookingUiFiles = [
  ...decisionUiFiles,
  'src/pages/BookingInternal.tsx',
];

for (const file of bookingUiFiles) {
  forbid(file, 'resolveStaffWorkingWindowsForDate', 'must not derive dated staff windows from legacy/static staff fields');
  forbid(file, 'filterStaffSlotsByWorkingHours', 'must not filter booking slots from legacy/static staff working hours');
  forbid(file, 'isStaffWorkingAtTime', 'must not make booking decisions from legacy/static staff working hours');
  forbid(file, 'isStaffAvailableForDate', 'must not decide dated staff availability locally; use Core availability');
  forbid(file, 'getStaffLeaveMetaForDate', 'must not derive booking leave/off state from mirrored staff fields');
  forbid(file, 'staff_schedules', 'must not read legacy staff_schedules in booking UI runtime');
  forbid(file, 'customWorkingHours', 'must not use legacy customWorkingHours for booking decisions');
  forbid(file, 'filterSlotsByServiceEnd', 'must not cap employee starts with a local/salon closing window; use Core scheduleWindows helper');
}
for (const file of decisionUiFiles) {
  requireText(file, 'getStaffAvailability', 'booking decision UI must load the authoritative Core staff-day availability');
}
requireText(
  'src/pages/BookingInternal.tsx',
  'BookingInternalV2',
  'legacy internal route must delegate to the Core-HR-authoritative V2 runtime'
);
forbid(
  'src/pages/BookingInternal.tsx',
  'firestoreAvailabilityBackfill',
  'legacy internal compatibility route must not run Firestore availability backfill'
);
forbid(
  'src/pages/BookingInternal.tsx',
  'getDataSourceFlags().useCoreD1',
  'legacy internal compatibility route must not keep a Core-vs-Firestore booking branch'
);

forbidRegex(
  'src/pages/Checkout.tsx',
  /from\s+["'][^"']*firestoreBookings["']/,
  'live Checkout must not import the legacy Firestore booking module'
);
requireRegex(
  'src/pages/Checkout.tsx',
  /(?:checkoutCoreBookingService|resolveBookingDataSource)/,
  'live Checkout must submit through a Core-only booking facade'
);
requireText(
  'src/services/checkoutCoreBookingService.ts',
  'resolveBookingDataSource',
  'checkout facade must resolve the Core-only booking datasource'
);
requireText(
  'src/services/checkoutCoreBookingService.ts',
  'CoreSettingsService',
  'checkout facade must re-read authoritative slot step and buffer settings'
);
requireText(
  'src/services/checkoutCoreBookingService.ts',
  'serviceId',
  'checkout facade must normalize the service to an authoritative Core catalog id'
);

requireText(
  'src/services/bookingDataSource.ts',
  'return resolveCoreBookingDataSource();',
  'booking data source must resolve to Core D1'
);
forbid(
  'src/services/bookingDataSource.ts',
  'firestoreBookingDataSource',
  'booking data source selector must not import or choose Firestore'
);

const legacyBookings = read('src/services/firestoreBookings.ts');
if (/\bALLOW_OVERTIME_MIN\s*=\s*(?!0\b)\d+/.test(legacyBookings)) {
  failures.push('src/services/firestoreBookings.ts: legacy booking validator must not retain non-zero overtime');
}

const constants = read('src/helpers/bookingSharedConstants.ts');
if (!/export const ALLOW_OVERTIME_MIN\s*=\s*0\s*;/.test(constants)) {
  failures.push('src/helpers/bookingSharedConstants.ts: ALLOW_OVERTIME_MIN must be 0 so duration + buffer cannot exceed the HR shift end');
}
requireText(
  'src/helpers/timeSlots.ts',
  'return startMin + need <= maxEndMin;',
  'slot filtering must enforce service duration + buffer against the supplied end boundary'
);

// Backend guards inspect executable code, not comments. A historical comment
// naming an old field must not create a false positive, while any executable
// reference still fails immediately.
for (const file of [
  'workers/core/repositories/staff.js',
  'workers/core/repositories/availability.js',
  'workers/core/repositories/booking-staff-policy.js',
  'workers/core/repositories/bookings.js',
]) {
  forbidCode(file, 'staff_schedules', 'Core booking runtime must never fall back to legacy staff_schedules');
}

forbidCode(
  'workers/core/repositories/booking-staff-policy.js',
  'legacyLeaveActive',
  'booking leave truth must come from employee_leaves / HR sources only'
);
forbidCode(
  'workers/core/repositories/booking-staff-policy.js',
  'leave_start_date',
  'booking runtime must not use mirrored legacy leave_start_date'
);
forbidCode(
  'workers/core/repositories/booking-staff-policy.js',
  'leave_end_date',
  'booking runtime must not use mirrored legacy leave_end_date'
);

for (const table of ['hr_work_schedules', 'hr_schedule_exceptions', 'hr_shift_assignments']) {
  requireText(
    'workers/core/repositories/shift-control.js',
    table,
    `resolveEmployeeShift authority must include ${table}`
  );
}
requireText(
  'workers/core/repositories/booking-staff-policy.js',
  'resolveEmployeeShift',
  'central booking policy must resolve the dated HR shift'
);
requireText(
  'workers/core/repositories/booking-staff-policy.js',
  'employee_leaves',
  'central booking policy must use employee_leaves'
);
requireText(
  'workers/core/repositories/booking-staff-policy.js',
  'employee_absences',
  'central booking policy must use employee_absences'
);
requireRegex(
  'workers/core/repositories/booking-staff-policy.js',
  /reason:\s*["']no_hr_schedule["']/,
  'booking policy must fail closed when no dated HR schedule resolves'
);
requireText(
  'workers/core/repositories/booking-staff-policy.js',
  'staff_services',
  'service-to-staff authority must come from staff_services'
);
requireText(
  'workers/core/repositories/availability.js',
  'resolveStaffBookingDay',
  'availability endpoint must use central Core HR booking-day truth'
);
requireText(
  'workers/core/repositories/availability.js',
  'scheduleWindows',
  'availability endpoint must expose dated Core HR scheduleWindows'
);
requireText(
  'workers/core/repositories/bookings.js',
  'resolveStaffBookingDay',
  'booking create/edit must use central Core HR booking-day truth'
);

const bookings = read('workers/core/repositories/bookings.js');
const rangeCalls = [...bookings.matchAll(/await\s+assertStaffRangeAvailable\s*\(/g)].length;
const bufferedRangeCalls = [...bookings.matchAll(/await\s+assertStaffRangeAvailable\s*\([\s\S]{0,320}?addMinutes\(endTime,\s*bufferMin\)/g)].length;
if (!rangeCalls || bufferedRangeCalls !== rangeCalls) {
  failures.push(`workers/core/repositories/bookings.js: every assertStaffRangeAvailable call must pass endTime + bufferMin (${bufferedRangeCalls}/${rangeCalls})`);
}

if (failures.length) {
  console.error(`No-legacy booking runtime guard FAILED (${failures.length}):\n`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('No-legacy booking runtime guard passed. Core HR is the sole booking schedule/leave authority.');
