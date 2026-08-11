import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const failures = [];
const forbid = (file, needle, message) => {
  const text = read(file);
  if (text.includes(needle)) failures.push(`${file}: ${message} [${needle}]`);
};
const requireText = (file, needle, message) => {
  const text = read(file);
  if (!text.includes(needle)) failures.push(`${file}: ${message} [missing ${needle}]`);
};

const bookingUiFiles = [
  'src/pages/Booking.tsx',
  'src/pages/BookingInternal.tsx',
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
];

for (const file of bookingUiFiles) {
  forbid(file, 'resolveStaffWorkingWindowsForDate', 'must not derive dated staff windows from legacy/static staff fields');
  forbid(file, 'filterStaffSlotsByWorkingHours', 'must not filter booking slots from legacy/static staff working hours');
  forbid(file, 'isStaffWorkingAtTime', 'must not make booking decisions from legacy/static staff working hours');
  forbid(file, 'staff_schedules', 'must not read legacy staff_schedules in booking UI runtime');
}

forbid(
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
  'sat: { enabled: true, start: "12:00", end: "22:00" }',
  'must not keep hardcoded employee/business booking window defaults that can override Core HR truth'
);
forbid(
  'src/features/internal-booking-v2/BookingInternalV2.tsx',
  'sun: { enabled: true, start: "12:00", end: "22:00" }',
  'must not keep hardcoded employee/business booking window defaults that can override Core HR truth'
);

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

// No booking overtime beyond the employee HR shift end.
const constants = read('src/helpers/bookingSharedConstants.ts');
if (!/export const ALLOW_OVERTIME_MIN\s*=\s*0\s*;/.test(constants)) {
  failures.push('src/helpers/bookingSharedConstants.ts: ALLOW_OVERTIME_MIN must be 0 so duration + buffer cannot exceed the HR shift end');
}

// The shared slot helper must enforce start + duration + buffer <= close/end when overtime is zero.
requireText(
  'src/helpers/timeSlots.ts',
  'return startMin + need <= maxEndMin;',
  'slot filtering must enforce service duration + buffer against the closing boundary'
);

// Backend must use the centralized dated HR booking policy.
requireText(
  'workers/core/repositories/availability.js',
  'resolveStaffBookingDay',
  'availability endpoint must use central Core HR booking-day truth'
);
requireText(
  'workers/core/repositories/bookings.js',
  'resolveStaffBookingDay',
  'booking create/edit must use central Core HR booking-day truth'
);
requireText(
  'workers/core/repositories/booking-staff-policy.js',
  'resolveEmployeeShift',
  'central booking policy must resolve the dated HR shift'
);

if (failures.length) {
  console.error(`No-legacy booking runtime guard FAILED (${failures.length}):\n`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('No-legacy booking runtime guard passed. Core HR is the sole booking schedule/leave authority.');
