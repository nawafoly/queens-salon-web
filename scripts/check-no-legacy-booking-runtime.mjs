import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const failures = [];
const forbid = (file, needle, message) => {
  const text = read(file);
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

// The repository-wide audit is the primary guard. It follows runtime imports
// from every booking surface, so adding a new reachable legacy helper fails
// without having to remember to append that file to this checker.
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

const bookingUiFiles = [
  'src/pages/Booking.tsx',
  'src/pages/BookingInternal.tsx',
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
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
  requireText(file, 'getStaffAvailability', 'each booking UI must load the authoritative Core staff-day availability');
}

// Old internal booking is part of the booking runtime and must not retain a
// feature-flagged Firestore booking/availability branch.
forbid(
  'src/pages/BookingInternal.tsx',
  'firestoreAvailabilityBackfill',
  'must not run Firestore availability backfill from booking runtime'
);
forbid(
  'src/pages/BookingInternal.tsx',
  'getDataSourceFlags().useCoreD1',
  'must not keep a Core-vs-Firestore booking runtime branch'
);

// Checkout is a live public route. It may call a thin Core-only checkout
// service, but it must never import the legacy Firestore booking module.
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

// Core-only booking data source selection.
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

// The legacy Firestore implementation is allowed only for non-booking read/
// migration compatibility. Even there, no exported legacy booking validator may
// retain overtime beyond the HR shift boundary.
const legacyBookings = read('src/services/firestoreBookings.ts');
if (/\bALLOW_OVERTIME_MIN\s*=\s*(?!0\b)\d+/.test(legacyBookings)) {
  failures.push('src/services/firestoreBookings.ts: legacy booking validator must not retain non-zero overtime');
}

// No booking overtime beyond the employee HR shift end.
const constants = read('src/helpers/bookingSharedConstants.ts');
if (!/export const ALLOW_OVERTIME_MIN\s*=\s*0\s*;/.test(constants)) {
  failures.push('src/helpers/bookingSharedConstants.ts: ALLOW_OVERTIME_MIN must be 0 so duration + buffer cannot exceed the HR shift end');
}

// The shared primitive must enforce start + duration + buffer <= end when the
// authoritative Core-window helper delegates to it.
requireText(
  'src/helpers/timeSlots.ts',
  'return startMin + need <= maxEndMin;',
  'slot filtering must enforce service duration + buffer against the supplied end boundary'
);

// Backend must use the centralized dated HR booking policy and fail closed.
for (const file of [
  'workers/core/repositories/staff.js',
  'workers/core/repositories/availability.js',
  'workers/core/repositories/booking-staff-policy.js',
  'workers/core/repositories/bookings.js',
]) {
  forbid(file, 'staff_schedules', 'Core booking runtime must never fall back to legacy staff_schedules');
}

forbid(
  'workers/core/repositories/booking-staff-policy.js',
  'legacyLeaveActive',
  'booking leave truth must come from employee_leaves / HR sources only'
);
forbid(
  'workers/core/repositories/booking-staff-policy.js',
  'leave_start_date',
  'booking runtime must not use mirrored legacy leave_start_date'
);
forbid(
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

// Every operational create/reschedule/edit range assertion must validate the
// buffered end, not only the service end.
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
