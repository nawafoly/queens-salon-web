import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx",
  "utf8"
);

const calendarStyleSource = readFileSync(
  "src/styles/dashboard-v2/pages/employee-workspace.css",
  "utf8"
);

const attendanceSectionSource = readFileSync(
  "src/pages/dashboardEmployees/AttendanceSection.tsx",
  "utf8"
);

test("attendance calendar uses semantic no-punch labels", () => {
  assert.match(source, /function attendanceCalendarTimeLabel/);
  assert.match(source, /\u0631\u0627\u062d\u0629 \u0623\u0633\u0628\u0648\u0639\u064a\u0629/);
  assert.match(source, /\u0644\u0627 \u062a\u062a\u0637\u0644\u0628 \u0628\u0635\u0645\u0629/);
  assert.match(source, /\u0644\u0645 \u062a\u0633\u062c\u0644 \u0628\u0635\u0645\u0629 \u062f\u062e\u0648\u0644 \u0623\u0648 \u062e\u0631\u0648\u062c/);

  assert.doesNotMatch(
    source,
    /rowStatus\s*\|\|\s*"\?"/
  );

  assert.doesNotMatch(
    source,
    /\.join\(" \? "\)/
  );
});

test("attendance calendar exposes canonical leave presentation types", () => {
  assert.match(source, /function attendanceCalendarLeaveType/);
  assert.match(source, /type === "weekly_rest_substitute_use"[\s\S]*return "compensatory"/);
  assert.match(source, /type === "annual"[\s\S]*return "annual"/);
  assert.match(source, /type === "unpaid"[\s\S]*return "exceptional"/);
  assert.match(source, /kind === "weekly_off"[\s\S]*return "weekly_rest"/);
  assert.match(source, /data-leave-type=\{attendanceCalendarLeaveType\(day\)\}/);
  assert.match(source, /className="dsv2-ew-calendar-legend"/);
  assert.match(source, /data-leave-type="weekly_rest"/);
  assert.match(source, /data-leave-type="compensatory"/);
  assert.match(source, /data-leave-type="annual"/);
  assert.match(source, /data-leave-type="exceptional"/);

  assert.match(calendarStyleSource, /\[data-leave-type="weekly_rest"\]/);
  assert.match(calendarStyleSource, /\[data-leave-type="compensatory"\]/);
  assert.match(calendarStyleSource, /\[data-leave-type="annual"\]/);
  assert.match(calendarStyleSource, /\[data-leave-type="exceptional"\]/);
  assert.doesNotMatch(
    calendarStyleSource,
    /data-special="weekly_off"[\s\S]{0,220}var\(--dsv2-gold\)/
  );
});

test("past resolved Core workdays without punches are inferred as absence", () => {
  assert.match(attendanceSectionSource, /const scheduledWorkDateKeys/);
  assert.match(attendanceSectionSource, /resolveAttendanceShiftForDate\(\{/);
  assert.match(attendanceSectionSource, /resolved\.source !==[\s\S]*"core_resolved_shift"/);
  assert.match(attendanceSectionSource, /resolved\.isOff/);
  assert.match(attendanceSectionSource, /scheduledWorkDateKeys=\{scheduledWorkDateKeys\}/);

  assert.match(source, /scheduledWorkDateKeys\?: string\[\]/);
  assert.match(source, /const canInferScheduledAbsence/);
  assert.match(source, /!loading[\s\S]*!cleanText\(error\)/);
  assert.match(source, /canInferScheduledAbsence[\s\S]*scheduledWorkDateKeys\.filter/);
  assert.match(source, /const isPastScheduledNoPunch/);
  assert.match(
    source,
    /!specialDay \|\|[\s\S]*"weekly_rest_work" \|\|[\s\S]*"partial_leave"/
  );
  assert.match(
    source,
    /specialDay\?\.kind === "weekly_rest_work" \|\|[\s\S]*specialDay\?\.kind === "partial_leave"[\s\S]*\? reliableRowStatus/
  );
  assert.match(source, /hasScheduledWork/);
  assert.match(source, /date < todayKey/);
  assert.match(source, /!hasPunch/);
  assert.match(source, /!hasLeave/);
  assert.match(source, /!hasAbsence/);
  assert.match(source, /isPastScheduledNoPunch[\s\S]*\\u063a\\u064a\\u0627\\u0628/);
});
