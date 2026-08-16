import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("Malikat scheduling runtime has one canonical shift resolver", () => {
  const shiftCore = read("workers/core/repositories/shift-control.js");
  const bookingPolicy = read("workers/core/repositories/booking-staff-policy.js");
  const availability = read("workers/core/repositories/availability.js");
  const attendanceWorker = read("workers/attendance-worker.js");

  assert.match(
    shiftCore,
    /export async function resolveEmployeeShift/,
    "Scheduling Core must expose resolveEmployeeShift"
  );

  assert.match(
    bookingPolicy,
    /import\s*\{\s*resolveEmployeeShift\s*\}\s*from\s*['"]\.\/shift-control\.js['"]/,
    "Booking policy must consume the canonical shift resolver"
  );

  assert.match(
    availability,
    /resolveStaffBookingDay/,
    "Availability must flow through booking-day resolution"
  );

  assert.match(
    attendanceWorker,
    /resolveEmployeeShift/,
    "Attendance must consume the canonical shift resolver"
  );
});

test("Payroll must not own a second scheduling runtime", () => {
  const payroll = read("src/services/CorePayrollService.ts");

  const forbidden = [
    "fallbackEmploymentSchedule",
    "coreAssignmentScheduleForDate",
    'source: "employment_fallback"',
    'source: "core_assignment_legacy"',
    'source: "weekly_schedule_legacy"',
  ];

  for (const token of forbidden) {
    assert.equal(
      payroll.includes(token),
      false,
      `Payroll contains duplicated scheduling runtime: ${token}`
    );
  }
});


test("Attendance discipline must not reconstruct scheduling outside Malikat Core", () => {
  const source = read("src/pages/DashboardAttendanceSecurity.tsx");

  assert.match(
    source,
    /CoreHrService\.resolveEmployeeShift/,
    "Attendance discipline must consume the canonical shift resolver"
  );

  const forbidden = [
    "resolveApprovedScheduleForDate",
    "DEFAULT_ATTENDANCE_SHIFT_START",
    "DEFAULT_ATTENDANCE_SHIFT_END",
    "fallbackSchedule",
  ];

  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      `Attendance discipline contains local scheduling fallback: ${token}`
    );
  }
});
