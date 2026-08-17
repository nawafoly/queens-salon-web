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
      resolvedShift: {
        source: "attendance_record",
        date: dateKey,
        shiftName: "stale 9 to 5 snapshot",
        startTime: "09:00",
        endTime: "17:00",
      },
    },
    schedule: currentProfileFallback,
    coreResolvedShift: coreShift(dateKey),
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
  assert.equal(
    dashboard.shiftResolution.source,
    "core_resolved_shift"
  );
  assert.equal(
    employee.shiftResolution.source,
    "core_resolved_shift"
  );

  assert.equal(
    dashboard.shiftResolution.fallbackUsed,
    false
  );
  assert.equal(
    employee.shiftResolution.fallbackUsed,
    false
  );

  assert.equal(
    dashboard.shiftResolution.recordResolvedShiftPresent,
    true
  );
});

test("legacy schedules and attendance snapshots cannot replace a missing Core shift", () => {
  const dateKey =
    "2026-06-21";

  const legacySchedule = {
    startTime: "09:00",
    endTime: "17:00",
    useCustomWorkingHours: true,
    workingScheduleVersions: [
      {
        id:
          "historical-2-to-10",
        effectiveFrom:
          "2026-06-01",
        effectiveTo:
          "2026-06-30",
        useCustomWorkingHours:
          true,
        customWorkingHours: {
          sun: {
            enabled: true,
            start: "14:00",
            end: "22:00",
          },
        },
      },
    ],
  };

  const result =
    computeResolvedAttendanceDay({
      dateKey,
      row: {
        ...punchRow(dateKey),
        resolvedShift: {
          source:
            "attendance_record",
          shiftName:
            "stale record snapshot",
          startTime:
            "09:00",
          endTime:
            "17:00",
        },
      },
      schedule:
        legacySchedule,
      coreResolvedShift:
        null,
      todayDateKey,
    });

  assert.equal(
    result.shiftResolution.source,
    "core_unavailable"
  );

  assert.equal(
    result.status,
    "schedule_unavailable"
  );

  assert.equal(
    result.shiftResolution.fallbackUsed,
    false
  );

  assert.equal(
    result.shiftResolution.recordResolvedShiftPresent,
    true
  );

  assert.equal(
    result.schedule.startTime,
    ""
  );

  assert.equal(
    result.schedule.endTime,
    ""
  );

  assert.equal(
    result.computation.lateHours,
    0
  );

  assert.equal(
    result.computation.missingHours,
    0
  );
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


test("shared attendance resolver has no legacy operational scheduler", () => {
  const source =
    readFileSync(
      "src/helpers/hr/attendanceShiftResolver.ts",
      "utf8"
    );

  const forbidden = [
    "fallbackScheduleResolution",
    "historical_schedule",
    "profile_schedule",
    "default_fallback",
    "attendance_resolved_shift",
    "resolveStaffScheduleVersionForDate",
    "weeklyOffDaysFromScheduleSnapshot",
    "isAttendanceDateSpecificOff",
  ];

  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      `legacy shared attendance token remains: ${token}`
    );
  }
});


test("dashboard attendance section contains no local scheduling fallback", () => {
  const source =
    readFileSync(
      "src/pages/dashboardEmployees/AttendanceSection.tsx",
      "utf8"
    );

  const forbidden = [
    "resolveAttendanceSchedule",
    "resolveRecordShiftSchedule",
    "resolveEffectiveAttendanceSchedule",
    "resolveSalonSchedule",
    "fallbackShiftInfo",
    "recordShiftInfo",
    "employeeScheduleSourceLabel",
    "isProfileOnLeave",
    "getDayOverride",
    "resolveStaffScheduleVersionForDate",
    "weeklyOffDaysFromScheduleSnapshot",
  ];

  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      `dashboard attendance legacy scheduler remains: ${token}`
    );
  }
});


test("approved leave remains canonical when Core scheduling is unavailable", () => {
  const dateKey =
    "2026-06-21";

  const result =
    computeResolvedAttendanceDay({
      dateKey,
      coreResolvedShift:
        null,
      approvedLeaveDateKeys:
        new Set([dateKey]),
      todayDateKey,
    });

  assert.equal(
    result.shiftResolution.source,
    "core_unavailable"
  );

  assert.equal(
    result.status,
    "leave"
  );

  assert.equal(
    result.shiftResolution.fallbackUsed,
    false
  );
});


test("explicit absence remains canonical when Core scheduling is unavailable", () => {
  const dateKey =
    "2026-06-22";

  const result =
    computeResolvedAttendanceDay({
      dateKey,
      coreResolvedShift:
        null,
      absenceDateKeys:
        new Set([dateKey]),
      todayDateKey,
    });

  assert.equal(
    result.shiftResolution.source,
    "core_unavailable"
  );

  assert.equal(
    result.status,
    "absent"
  );

  assert.equal(
    result.shiftResolution.fallbackUsed,
    false
  );
});


test("attendance month view contains no local scheduling runtime", () => {
  const monthSource =
    readFileSync(
      "src/components/AttendanceMonthView.tsx",
      "utf8"
    );

  const overviewSource =
    readFileSync(
      "src/pages/hr/EmployeeOverview.tsx",
      "utf8"
    );

  const forbidden = [
    "AttendanceScheduleInput",
    "resolveStaffScheduleVersionForDate",
    "weeklyOffDaysFromScheduleSnapshot",
    "scheduleForDate",
    "resolvedShiftWindow",
    "getDayOverride",
    "isDateSpecificOff",
    'startTime || "09:00"',
    'endTime || "17:00"',
  ];

  for (const token of forbidden) {
    assert.equal(
      monthSource.includes(token),
      false,
      `AttendanceMonthView legacy scheduler remains: ${token}`
    );
  }

  assert.equal(
    overviewSource.includes(
      "schedule={profile}"
    ),
    false
  );

  assert.equal(
    monthSource.includes(
      "schedule_unavailable"
    ),
    true
  );
});


test("dashboard attendance special days come only from Malikat Core", () => {
  const sectionSource =
    readFileSync(
      "src/pages/dashboardEmployees/AttendanceSection.tsx",
      "utf8"
    );

  const parentSource =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  const forbiddenSection = [
    "rowSpecialDays",
    "attendance_row_core_exception_off",
    "temporaryWeeklyOffSync",
    "temporaryOffSpecialDays",
    "temporaryWorkDateKeys",
    "temporary_weekly_off_live_sync",
    "effectiveSchedule",
    "salonBusinessHours?:",
    "specialDays?: AttendanceSpecialDay[]",
    "schedule?: Record<string, unknown> | null",
  ];

  for (const token of forbiddenSection) {
    assert.equal(
      sectionSource.includes(token),
      false,
      `AttendanceSection non-Core special-day source remains: ${token}`
    );
  }

  assert.equal(
    sectionSource.includes(
      "CoreHrService.listLeaves"
    ),
    true
  );

  assert.equal(
    sectionSource.includes(
      "core_employee_leave"
    ),
    true
  );

  assert.equal(
    sectionSource.includes(
      "core_exception_off"
    ),
    true
  );

  assert.equal(
    parentSource.includes(
      "buildAttendanceSpecialDayMap({"
    ),
    false
  );

  assert.equal(
    parentSource.includes(
      "specialDays={selectedEmployeeSpecialDays}"
    ),
    false
  );

  assert.equal(
    parentSource.includes(
      "schedule={editingStaff}"
    ),
    false
  );
});


test("dashboard attendance uses Core absences and never infers absence from a past empty day", () => {
  const sectionSource =
    readFileSync(
      "src/pages/dashboardEmployees/AttendanceSection.tsx",
      "utf8"
    );

  const liveSource =
    readFileSync(
      "src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx",
      "utf8"
    );

  assert.equal(
    sectionSource.includes(
      "CoreHrService.listAbsences"
    ),
    true
  );

  assert.equal(
    sectionSource.includes(
      "coreAbsenceDateKeys"
    ),
    true
  );

  assert.equal(
    sectionSource.includes(
      "absenceDateKeys,"
    ),
    true
  );

  assert.equal(
    sectionSource.includes(
      "record.absentFullDay ==="
    ),
    false,
    "attendance row snapshot must not create operational absence"
  );

  assert.equal(
    liveSource.includes(
      "absenceDateKeys?: string[]"
    ),
    true
  );

  assert.equal(
    liveSource.includes(
      "const hasAbsence"
    ),
    true
  );

  assert.equal(
    liveSource.includes(
      "date < todayKey"
    ),
    false,
    "past dates must not automatically become absent"
  );

  assert.equal(
    liveSource.includes(
      'rawStatus === "not_started"'
    ),
    false,
    "legacy not_started must not imply absence"
  );
});


test("employee attendance uses the same Core absence facts as dashboard attendance", () => {
  const overviewSource =
    readFileSync(
      "src/pages/hr/EmployeeOverview.tsx",
      "utf8"
    );

  const monthSource =
    readFileSync(
      "src/components/AttendanceMonthView.tsx",
      "utf8"
    );

  assert.equal(
    overviewSource.includes(
      "CoreHrService.listAbsences"
    ),
    true
  );

  assert.equal(
    overviewSource.includes(
      "attendanceAbsenceDateKeys"
    ),
    true
  );

  assert.equal(
    overviewSource.includes(
      "absenceDateKeys={attendanceAbsenceDateKeys}"
    ),
    true
  );

  assert.equal(
    monthSource.includes(
      "absenceDateKeys?: Iterable<string>"
    ),
    true
  );

  assert.equal(
    monthSource.includes(
      "absenceDateKeySet"
    ),
    true
  );

  const resolverAbsenceUses =
    (
      monthSource.match(
        /absenceDateKeys:\s*absenceDateKeySet/g
      ) || []
    ).length;

  assert.equal(
    resolverAbsenceUses,
    2,
    "selected day and calendar days must both use canonical absences"
  );

  assert.equal(
    monthSource.includes(
      "absentFullDay"
    ),
    false,
    "employee month view must not use attendance-row absence snapshots"
  );
});
test("dashboard attendance edit and delete mutations use the canonical employee profile identity", () => {
  const source = readFileSync(
    "src/pages/DashboardEmployees.tsx",
    "utf8"
  );

  const editStart = source.indexOf(
    "const saveAttendancePunchEditor"
  );
  const deleteStart = source.indexOf(
    "const deleteAttendancePunch"
  );

  assert.ok(
    editStart >= 0,
    "saveAttendancePunchEditor must exist"
  );
  assert.ok(
    deleteStart > editStart,
    "deleteAttendancePunch must exist after saveAttendancePunchEditor"
  );

  const editBlock = source.slice(
    editStart,
    deleteStart
  );

  const deleteEnd = source.indexOf(
    "const createEmergencyLeaveForAttendanceDay",
    deleteStart
  );

  assert.ok(
    deleteEnd > deleteStart,
    "createEmergencyLeaveForAttendanceDay must exist after deleteAttendancePunch"
  );

  const deleteBlock = source.slice(
    deleteStart,
    deleteEnd
  );

  const canonicalIdentityPattern =
    /resolveEmployeeAttendanceIdentity\(\s*employeeProfile,\s*selectedEmployeeId\s*\)/;

  const brokenIdentityPattern =
    /resolveEmployeeAttendanceIdentity\(\s*null,\s*selectedEmployeeId\s*\)/;

  assert.match(
    editBlock,
    canonicalIdentityPattern,
    "attendance edit must resolve identity from the selected employee profile"
  );

  assert.match(
    deleteBlock,
    canonicalIdentityPattern,
    "attendance delete must resolve identity from the selected employee profile"
  );

  assert.doesNotMatch(
    editBlock,
    brokenIdentityPattern,
    "attendance edit must never fall back to selectedEmployeeId as employeeUid"
  );

  assert.doesNotMatch(
    deleteBlock,
    brokenIdentityPattern,
    "attendance delete must never fall back to selectedEmployeeId as employeeUid"
  );
});
