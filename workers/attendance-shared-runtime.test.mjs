import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  computeResolvedAttendanceDay,
} from "../src/helpers/hr/attendanceShiftResolver.ts";

const todayDateKey = "2026-08-13";

function punchRow(dateKey = "2026-06-21") {
  return {
    id: dateKey,
    date: dateKey,
    checkInAtClient: `${dateKey}T11:00:00.000Z`,
    checkOutAtClient: `${dateKey}T19:00:00.000Z`,
  };
}

function coreShift(dateKey = "2026-06-21") {
  return {
    source: "assignment",
    date: dateKey,
    shiftName: "2 to 10",
    startTime: "14:00",
    endTime: "22:00",
    lateGraceMinutes: 0,
    active: 1,
  };
}

function assertOnTimeResult(result) {
  assert.equal(result.status, "present");
  assert.equal(result.shiftResolution.startTime, "14:00");
  assert.equal(result.shiftResolution.endTime, "22:00");
  assert.equal(result.computation.expectedHours, 8);
  assert.equal(result.computation.actualHours, 8);
  assert.equal(result.computation.lateHours, 0);
  assert.equal(result.computation.missingHours, 0);
}

test("dashboard and employee portal use the same resolved shift for an on-time 14:00-22:00 day", () => {
  const dateKey = "2026-06-21";
  const currentProfileFallback = { startTime: "09:00", endTime: "17:00" };

  const dashboard = computeResolvedAttendanceDay({
    dateKey,
    row: {
      ...punchRow(dateKey),
      resolvedShift: coreShift(dateKey),
    },
    schedule: currentProfileFallback,
    todayDateKey,
  });
  const employee = computeResolvedAttendanceDay({
    dateKey,
    row: punchRow(dateKey),
    schedule: currentProfileFallback,
    coreResolvedShift: coreShift(dateKey),
    todayDateKey,
  });

  assertOnTimeResult(dashboard);
  assertOnTimeResult(employee);
  assert.equal(dashboard.status, employee.status);
  assert.equal(dashboard.computation.lateHours, employee.computation.lateHours);
  assert.equal(dashboard.computation.missingHours, employee.computation.missingHours);
  assert.equal(dashboard.shiftResolution.source, "attendance_resolved_shift");
  assert.equal(employee.shiftResolution.source, "core_resolved_shift");
});

test("historical employee schedules beat the current profile fallback for old attendance days", () => {
  const dateKey = "2026-06-21";
  const schedule = {
    startTime: "09:00",
    endTime: "17:00",
    useCustomWorkingHours: false,
    workingScheduleVersions: [
      {
        id: "historical-2-to-10",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-06-30",
        useCustomWorkingHours: true,
        customWorkingHours: {
          sun: {
            enabled: true,
            shiftName: "2 to 10",
            start: "14:00",
            end: "22:00",
          },
        },
      },
    ],
  };

  const dashboard = computeResolvedAttendanceDay({
    dateKey,
    row: punchRow(dateKey),
    schedule,
    todayDateKey,
  });
  const employee = computeResolvedAttendanceDay({
    dateKey,
    row: punchRow(dateKey),
    schedule,
    todayDateKey,
  });

  assertOnTimeResult(dashboard);
  assertOnTimeResult(employee);
  assert.equal(dashboard.shiftResolution.source, "historical_schedule");
  assert.equal(employee.shiftResolution.source, "historical_schedule");
  assert.equal(dashboard.shiftResolution.sourceDoc, "historical-2-to-10");
  assert.equal(employee.shiftResolution.sourceDoc, "historical-2-to-10");
});

test("employee attendance view is wired to the shared attendance runtime and month Core shifts", () => {
  const overview = readFileSync("src/pages/hr/EmployeeOverview.tsx", "utf8");
  const monthView = readFileSync("src/components/AttendanceMonthView.tsx", "utf8");
  const dashboardAttendance = readFileSync("src/pages/dashboardEmployees/AttendanceSection.tsx", "utf8");

  assert.match(overview, /attendanceMonthDateKeys/);
  assert.match(overview, /setAttendanceMonthResolvedShifts/);
  assert.match(overview, /coreResolvedShifts=\{attendanceMonthResolvedShifts\}/);
  assert.match(monthView, /computeResolvedAttendanceDay/);
  assert.match(monthView, /attendance-month__shift-debug/);
  assert.match(dashboardAttendance, /computeResolvedAttendanceDay/);
  assert.match(dashboardAttendance, /recordsFromAttendanceRow/);
});
