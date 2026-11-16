import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const employee = readFileSync(
  new URL("../src/pages/hr/EmployeeOverview.tsx", import.meta.url),
  "utf8"
);
const messages = readFileSync(
  new URL("../src/services/attendanceWorkerService.ts", import.meta.url),
  "utf8"
);
const worker = readFileSync(
  new URL("./attendance-worker.js", import.meta.url),
  "utf8"
);

test("outside-zone retry requests a new browser GPS fix, not a cached reading", () => {
  assert.match(employee, /forceFreshPositionOnRetry = useRef\(false\)/);
  assert.match(employee, /maximumAge: forceFreshPositionOnRetry\.current \? 0 : 8000/);
  assert.match(employee, /acceptFirstUsableReading: !forceFreshPositionOnRetry\.current/);
  assert.match(employee, /freshCacheMaxAgeMs: forceFreshPositionOnRetry\.current \? 0 : 8000/);
  assert.match(employee, /forceFreshPositionOnRetry\.current = response\.rejectionReason === "outside_zone"/);
  assert.match(employee, /forceFreshPositionOnRetry\.current = false;\s*await loadAttendance\(\)/);
});

test("outside-zone feedback provides server-measured distance and explicit retry instructions", () => {
  const blockStart = messages.indexOf('if (response.rejectionReason === "outside_zone")');
  const blockEnd = messages.indexOf('if (response.rejectionReason === "zone_not_assigned")', blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  const block = messages.slice(blockStart, blockEnd);
  assert.match(block, /response\.distanceMeters/);
  assert.match(block, /response\.allowedRadiusMeters/);
  assert.match(block, /إعادة قياس GPS/);
  assert.match(block, /لن تُقبل البصمة/);
});

test("server remains the authority on zone radius and GPS quality", () => {
  assert.match(worker, /item => item\.distanceMeters <= item\.zone\.radiusMeters/);
  assert.match(worker, /rejectionReason: "outside_zone"/);
  assert.match(worker, /rejectionReason: "poor_accuracy"/);
});
