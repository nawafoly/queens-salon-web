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

  assert.doesNotMatch(
    overview,
    /listEmployeeBookings\(/
  );

  assert.doesNotMatch(
    overview,
    /CoreBookingService\.list\(\s*\{\s*staffId/
  );

  assert.match(
    overview,
    /if \(!session\.uid\)[\s\S]*?CoreBookingService\.mine\(\)[\s\S]*?\}, \[session\.uid\]\);/
  );

  assert.match(
    service,
    /async mine\(\s*query:\s*Omit<CoreBookingSearch,\s*"staffId">\s*=\s*\{\}/s
  );

  assert.match(
    service,
    /"\/api\/core\/bookings\/mine"/
  );
});

test("Core derives employee booking ownership from verified employee context", () => {
  const core = read("workers/core/index.js");

  const mineDispatch = between(
    core,
    'case "bookings:mine":',
    'case "bookings":'
  );

  assert.match(
    mineDispatch,
    /requirePermission\(ctx,\s*"workspace\.employee_portal\.view"\)/
  );

  assert.match(
    mineDispatch,
    /if \(!ctx\.employeeId\)/
  );

  assert.match(
    mineDispatch,
    /staffId:\s*ctx\.employeeId/
  );

  assert.doesNotMatch(
    mineDispatch,
    /staffId:\s*query\./
  );

  assert.doesNotMatch(
    mineDispatch,
    /staffId:\s*body\./
  );
});

test("employee booking read path contains no acknowledgement contract", () => {
  const core = read("workers/core/index.js");
  const repo = read("workers/core/repositories/bookings.js");

  assert.doesNotMatch(core, /booking:acknowledge/);
  assert.doesNotMatch(core, /\backnowledgeBooking\b/);
  assert.doesNotMatch(repo, /\backnowledgeBooking\b/);
  assert.doesNotMatch(repo, /booking_staff_acknowledgements/);
  assert.doesNotMatch(repo, /staff_acknowledged_/);
});