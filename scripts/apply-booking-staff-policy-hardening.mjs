import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bookingUiPath = path.join(root, 'src/pages/Booking.tsx');
const bookingRepoPath = path.join(root, 'workers/core/repositories/bookings.js');

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`[booking-hardening] expected source not found: ${label}`);
  const second = content.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(`[booking-hardening] source matched more than once: ${label}`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

function writeIfChanged(filePath, next) {
  const current = fs.readFileSync(filePath, 'utf8');
  if (current === next) return false;
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

let bookingUi = fs.readFileSync(bookingUiPath, 'utf8');
bookingUi = replaceOnce(
  bookingUi,
  'const staffChoicesForItem = activeVisibleStaff;',
  'const staffChoicesForItem = availableStaff;',
  'customer booking must display only date-available staff'
);

let bookingRepo = fs.readFileSync(bookingRepoPath, 'utf8');
bookingRepo = replaceOnce(
  bookingRepo,
  `import {\n  getStaff,\n  staffIsActive,\n  staffIsAvailableForDate,\n} from './staff.js';`,
  `import {\n  getStaff,\n  staffIsActive,\n} from './staff.js';\nimport {\n  resolveStaffBookingDay,\n  staffCanPerformService,\n} from './booking-staff-policy.js';`,
  'bookings repository staff-policy imports'
);

bookingRepo = replaceOnce(
  bookingRepo,
  `  if (!staffIsAvailableForDate(staff, bookingDate, startTime, endTime)) {\n    const error = new Error("staff_unavailable");\n    error.code = "core_booking:staff_unavailable";\n    throw error;\n  }`,
  `  const bookingDay = await resolveStaffBookingDay(\n    db,\n    salonId,\n    staff,\n    bookingDate,\n    startTime,\n    endTime\n  );\n  if (!bookingDay.available) {\n    const error = new Error("staff_unavailable");\n    error.code = "core_booking:staff_unavailable";\n    error.reason = bookingDay.reason || "unavailable";\n    throw error;\n  }`,
  'backend booking must use HR booking-day truth'
);

bookingRepo = replaceOnce(
  bookingRepo,
  `    const staffId = optionalText(item.staffId || item.staff_id) || parentStaffId;\n    await assertStaffRangeAvailable(`,
  `    const staffId = optionalText(item.staffId || item.staff_id) || parentStaffId;\n    if (staffId && !(await staffCanPerformService(db, salonId, staffId, service.id))) {\n      const error = new Error("staff_service_not_assigned");\n      error.code = "core_booking:staff_service_not_assigned";\n      throw error;\n    }\n    await assertStaffRangeAvailable(`,
  'backend create booking staff-service assignment guard'
);

bookingRepo = replaceOnce(
  bookingRepo,
  `    const staffId = patch.staffId === null || patch.staff_id === null\n      ? null\n      : optionalText(patch.staffId || patch.staff_id) || defaultStaff || current.staff_id || booking.staff_id || null;\n    await assertStaffRangeAvailable(`,
  `    const staffId = patch.staffId === null || patch.staff_id === null\n      ? null\n      : optionalText(patch.staffId || patch.staff_id) || defaultStaff || current.staff_id || booking.staff_id || null;\n    if (staffId && !(await staffCanPerformService(db, salonId, staffId, service.id))) {\n      throw new AppError(409, "core_booking:staff_service_not_assigned");\n    }\n    await assertStaffRangeAvailable(`,
  'backend reschedule staff-service assignment guard'
);

bookingRepo = replaceOnce(
  bookingRepo,
  `  if (shouldHoldSlots) {\n    if (timeToMinutes(startTime) % slotStepMin !== 0) {\n      throw new AppError(400, "core_booking:invalid_slot_alignment");\n    }\n    await assertStaffRangeAvailable(`,
  `  if (shouldHoldSlots) {\n    if (timeToMinutes(startTime) % slotStepMin !== 0) {\n      throw new AppError(400, "core_booking:invalid_slot_alignment");\n    }\n    if (staffId && !(await staffCanPerformService(db, salonId, staffId, service.id))) {\n      throw new AppError(409, "core_booking:staff_service_not_assigned");\n    }\n    await assertStaffRangeAvailable(`,
  'backend booking edit staff-service assignment guard'
);

const uiChanged = writeIfChanged(bookingUiPath, bookingUi);
const repoChanged = writeIfChanged(bookingRepoPath, bookingRepo);

console.log(`[booking-hardening] Booking.tsx: ${uiChanged ? 'updated' : 'unchanged'}`);
console.log(`[booking-hardening] bookings.js: ${repoChanged ? 'updated' : 'unchanged'}`);
console.log('[booking-hardening] guarded patch applied successfully.');
