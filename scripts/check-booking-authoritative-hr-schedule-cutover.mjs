import fs from 'node:fs';

const files = {
  booking: 'src/pages/Booking.tsx',
  mapper: 'src/services/coreBookingMappers.ts',
  staffRepo: 'workers/core/repositories/staff.js',
  policy: 'workers/core/repositories/booking-staff-policy.js',
  availability: 'workers/core/repositories/availability.js',
};

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const booking = read(files.booking);
const mapper = read(files.mapper);
const staffRepo = read(files.staffRepo);
const policy = read(files.policy);
const availability = read(files.availability);

const failures = [];
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) failures.push(`missing: ${label}`);
};
const forbidText = (text, needle, label) => {
  if (text.includes(needle)) failures.push(`forbidden: ${label}`);
};

requireText(booking, 'coreStaffAvailabilityRef', 'Booking caches Core staff-day availability');
requireText(booking, 'getCoreStaffAvailabilityForDate', 'Booking reads authoritative Core staff-day availability');
requireText(booking, 'cacheCoreStaffAvailability', 'Booking caches authoritative Core availability by date/staff');
requireText(booking, 'getStaffAvailability', 'Booking fetches authoritative Core staff-day availability');
requireText(booking, 'getCoreStaffBookableStartSlots', 'Booking derives starts only from Core availability scheduleWindows');
requireText(booking, 'staffFullDayResolvedKeyByItem', 'Booking no-flash availability context');
requireText(booking, 'const coreAvailabilityLoading =', 'Booking waits for Core before rendering staff cards');
forbidText(booking, 'resolveStaffWorkingWindowsForDate(', 'Booking runtime must not resolve static legacy working windows');
forbidText(booking, 'filterStaffSlotsByWorkingHours(', 'Booking runtime must not filter slots from legacy staff working hours');

forbidText(mapper, 'customWorkingHours,', 'Core mapper must not emit legacy customWorkingHours');
forbidText(mapper, 'useCustomWorkingHours: true', 'Core mapper must not re-enable legacy schedule projection');

forbidText(staffRepo, 'schedulesForStaff(', 'Core staff API must not load staff_schedules');
forbidText(staffRepo, 'schedules: await schedulesForStaff', 'Core staff API must not attach legacy schedules');

forbidText(policy, 'legacyScheduleAvailability(', 'Booking policy must not use staff_schedules fallback');
forbidText(policy, "source: 'staff_schedules'", 'Booking policy must not report staff_schedules source');
requireText(policy, 'no_hr_schedule', 'Booking policy fails closed without HR schedule truth');

forbidText(availability, 'scheduleRows(', 'Availability API must not query staff_schedules');
forbidText(availability, 'legacySchedules', 'Availability API must not use legacy schedules');
requireText(availability, 'scheduleWindows', 'Availability API exposes authoritative HR schedule windows');

if (failures.length) {
  console.error('Booking authoritative HR schedule cutover guard FAILED:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Booking authoritative HR schedule cutover guard passed.');
