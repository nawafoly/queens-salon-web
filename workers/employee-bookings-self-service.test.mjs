import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);

  return source.slice(startIndex, endIndex);
}

test("employee bookings use canonical self-service without browser-supplied staff identity", () => {
  const overview = read("src/pages/hr/EmployeeOverview.tsx");
  const service = read("src/services/CoreBookingService.ts");

  assert.match(overview, /CoreBookingService\.mine\(\)/);
  assert.doesNotMatch(overview, /listEmployeeBookings\(/);
  assert.doesNotMatch(overview, /CoreBookingService\.list\(\s*\{\s*staffId/);
  assert.match(
    overview,
    /if \(!session\.uid\)[\s\S]*?CoreBookingService\.mine\(\)[\s\S]*?\}, \[session\.uid\]\);/
  );
  assert.match(
    service,
    /async mine\(\s*query:\s*Omit<CoreBookingSearch,\s*"staffId">\s*=\s*\{\}/s
  );
  assert.match(service, /"\/api\/core\/bookings\/mine"/);
});

test("Core derives employee booking ownership from verified employee context", () => {
  const core = read("workers/core/index.js");
  const mineDispatch = between(core, 'case "bookings:mine":', 'case "bookings":');

  assert.match(
    mineDispatch,
    /requirePermission\(ctx,\s*"workspace\.employee_portal\.view"\)/
  );
  assert.match(mineDispatch, /if \(!ctx\.employeeId\)/);
  assert.match(
    mineDispatch,
    /listOwnStaffBookings\([\s\S]*ctx\.employeeId[\s\S]*query/
  );
  assert.doesNotMatch(mineDispatch, /staffId:\s*query\./);
  assert.doesNotMatch(mineDispatch, /staffId:\s*body\./);
});

test("employee booking acknowledgement and staff status are Core-owned and identity-bound", () => {
  const core = read("workers/core/index.js");
  const repo = read("workers/core/repositories/booking-staff-portal.js");
  const migration = read("migrations/core/0063_booking_staff_acknowledgement.sql");

  assert.match(core, /booking:acknowledge/);
  assert.match(core, /booking:staff-status/);
  assert.match(core, /acknowledgeOwnBooking\([\s\S]*ctx\.employeeId/);
  assert.match(core, /updateOwnBookingStatus\([\s\S]*ctx\.employeeId/);

  assert.match(repo, /assignedBooking/);
  assert.match(repo, /allowStaffChangeStatus === true/);
  assert.match(repo, /booking_staff_acknowledged/);
  assert.match(repo, /booking_staff_status_updated/);
  assert.match(repo, /projectOwnBooking/);
  assert.match(repo, /\.filter\(\(item\) =>/);
  assert.doesNotMatch(repo, /subtotal_halalas|discount_halalas|paid_halalas|invoice_number|admin_notes/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS booking_staff_acknowledgements/);
  assert.match(migration, /PRIMARY KEY \(salon_id, booking_id, employee_id\)/);
  assert.match(repo, /INSERT OR IGNORE INTO booking_staff_acknowledgements/);
  assert.match(repo, /employee_id = \?/);
  assert.match(repo, /assertExclusiveStatusControl/);
  assert.match(repo, /staff_status_requires_exclusive_assignment/);
  assert.doesNotMatch(migration, /ALTER TABLE bookings ADD COLUMN staff_ack/);
});


test("employee completion only requires material confirmation when recipe lines are configured", () => {
  const repo = read("workers/core/repositories/booking-staff-portal.js");

  assert.match(repo, /assertBookingCompletionReady/);
  assert.match(repo, /core_booking:service_not_started/);
  assert.match(repo, /core_booking:materials_confirmation_required/);
  assert.match(repo, /service_consumption_recipes/);
  assert.match(repo, /service_consumption_recipe_lines/);
  assert.match(
    repo,
    /JOIN service_consumption_recipe_lines rl[\s\S]*THEN 1[\s\S]*ELSE 0[\s\S]*requires_material_confirmation/
  );
  assert.match(
    repo,
    /Number\(row\.requires_material_confirmation\) === 1[\s\S]*Number\(row\.materials_confirmed\) !== 1/
  );
  assert.match(repo, /service_consumptions/);
  assert.match(repo, /status = 'confirmed'/);
  assert.match(
    repo,
    /if \(toStatus === 'completed'\)[\s\S]*assertBookingCompletionReady/
  );
});


test("staff completion workflow accepts canonical booked status", () => {
  const repo = read("workers/core/repositories/booking-staff-portal.js");
  assert.match(
    repo,
    /\['booked', new Set\(\['completed', 'cancelled'\]\)\]/
  );
});


test("employee booking workspace follows receive-confirm-materials-complete sequence", () => {
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");
  const portal = read("src/pages/EmployeePortal.tsx");

  assert.match(ui, /CoreBookingService\.mine\(\)/);
  assert.match(ui, /CoreBookingService\.acknowledgeMine/);
  assert.match(ui, /CoreBookingService\.updateMineStatus/);
  assert.match(ui, /updateBookingStatus\("confirmed"\)/);
  assert.match(ui, /updateBookingStatus\("completed"\)/);
  assert.match(ui, /selectedBookingPending\.length === 0/);
  assert.match(ui, /bookingExecutionReady/);
  assert.match(ui, /employee-booking-steps/);
  assert.match(ui, /employee-booking-services/);
  assert.match(ui, /employee-booking-materials/);

  assert.match(portal, /to: "\/employee\/bookings"/);
  assert.match(portal, /path="bookings"/);
  assert.match(
    portal,
    /path="consumption"[\s\S]*Navigate to="\/employee\/bookings"/
  );
});
