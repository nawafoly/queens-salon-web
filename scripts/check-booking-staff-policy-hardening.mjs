import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const ui = read('src/pages/Booking.tsx');
const bookings = read('workers/core/repositories/bookings.js');
const policy = read('workers/core/repositories/booking-staff-policy.js');
const availability = read('workers/core/repositories/availability.js');

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};
const requireMatch = (content, pattern, message) => {
  if (!pattern.test(content)) failures.push(message);
};

// Customer booking must wait for the authoritative Core date/service/staff context,
// then render only staff that still have a usable slot on that date.
requireText(
  ui,
  'const coreAvailabilityLoading =',
  'Customer booking must wait for Core availability before rendering staff.'
);
requireMatch(
  ui,
  /const staffChoicesForItem\s*=\s*coreAvailabilityLoading[\s\S]{0,500}?bookingVisibleStaff\.filter\(\(staff:\s*any\)\s*=>\s*\{/,
  'Customer booking must wait for Core availability and filter the Core-visible staff set.'
);
requireMatch(
  ui,
  /return\s+!id\s*\|\|\s*!coreUnavailableForItem\[id\];/,
  'Customer booking must honor Core full-day unavailability.'
);
requireMatch(
  ui,
  /listCoreBookableStaffForDate\s*\(/,
  'Customer booking must derive date-specific staff from Core bookable-staff service.'
);
rejectText(
  ui,
  'const staffChoicesForItem = activeVisibleStaff;',
  'Customer booking still renders active staff instead of date-available staff.'
);

requireText(
  bookings,
  "resolveStaffBookingDay,\n  staffCanPerformService,",
  'Booking repository must import the central staff booking policy.'
);
requireText(
  bookings,
  'const bookingDay = await resolveStaffBookingDay(',
  'Booking create/edit protection must use the HR booking-day truth.'
);
requireText(
  bookings,
  'core_booking:staff_service_not_assigned',
  'Booking repository must reject staff/service mismatches.'
);
rejectText(
  bookings,
  'staffIsAvailableForDate(staff, bookingDate, startTime, endTime)',
  'Booking repository still relies on the legacy staff availability check.'
);

const policyRequirements = [
  [/reason:\s*["']approved_leave["']/, "approved leave"],
  [/reason:\s*["']partial_leave["']/, "partial leave"],
  [/reason:\s*["']absence["']/, "absence"],
  [/weekly_or_schedule_off/, "weekly/schedule off"],
  [/exceptionType\s*===\s*["']rest["']/, "rest exception"],
  [/resolveEmployeeShift\s*\(/, "single canonical shift resolver"],
  [/resolveEmployeeShiftsBatch\s*\(/, "batched canonical shift resolver"],
  [/staffCanPerformService/, "staff/service assignment guard"],
];

for (const [pattern, label] of policyRequirements) {
  requireMatch(
    policy,
    pattern,
    "Central booking policy guard missing: " + label
  );
}

requireText(
  availability,
  'const blockedRanges = Array.isArray(bookingDay.blockedRanges)',
  'Core availability must expose and block partial leave ranges.'
);
requireText(
  availability,
  'availableForDate: Boolean(bookingDay.available && showOnBooking)',
  'Core availability must use central booking-day availability.'
);

if (failures.length) {
  console.error('Booking staff policy hardening guard failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Booking staff policy hardening guard passed.');
