import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

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

requireText(
  ui,
  'const staffChoicesForItem = availableStaff.filter((staff: any) => {',
  'Customer booking must hide staff without a usable slot on the selected date.'
);
requireText(
  ui,
  'availability.availableForDate === false',
  'Customer booking must honor Core full-day unavailability.'
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

for (const needle of [
  "reason: 'approved_leave'",
  "reason: 'partial_leave'",
  "reason: 'absence'",
  "reason: 'weekly_or_schedule_off'",
  "exceptionType === 'rest'",
  'resolveEmployeeShift(db, salonId, employeeId, date)',
  'staffCanPerformService',
]) {
  requireText(policy, needle, `Central booking policy guard missing: ${needle}`);
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
