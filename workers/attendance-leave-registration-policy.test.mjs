import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const liveAttendanceSource = readFileSync(
  new URL(
    "../src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx",
    import.meta.url
  ),
  "utf8"
);

const dashboardEmployeesSource = readFileSync(
  new URL("../src/pages/DashboardEmployees.tsx", import.meta.url),
  "utf8"
);

test("an absent day without punches is not blocked from leave registration", () => {
  assert.match(
    liveAttendanceSource,
    /const selectedHasPunch = Boolean\(selectedRow\?\.checkInAtClient \|\| selectedRow\?\.checkOutAtClient\);/
  );

  const leaveButton = liveAttendanceSource.match(
    /<button[^>]+disabled=\{readOnly \|\| !canCreateEmergencyLeave \|\| !activeSelectedDate \|\| selectedHasPunch\}[^>]*>[\s\S]*?تسجيل إجازة[\s\S]*?<\/button>/
  );
  assert.ok(leaveButton, "leave button must be blocked only by permissions/date/punch state");
  assert.doesNotMatch(leaveButton[0], /selectedStatus|غياب/);
});

test("the attendance-day handler blocks real punches but opens the leave modal otherwise", () => {
  assert.match(
    dashboardEmployeesSource,
    /const hasAttendanceRecord = employeeAttendanceRows\.some\([\s\S]*?row\.date === date[\s\S]*?Boolean\(row\.checkInAtClient \|\| row\.checkOutAtClient\)[\s\S]*?\);/
  );
  assert.match(
    dashboardEmployeesSource,
    /if \(hasAttendanceRecord\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(dashboardEmployeesSource, /setLeaveModalDate\(date\);/);
  assert.match(dashboardEmployeesSource, /setLeaveModalDefaultType\("emergency"\);/);
  assert.match(dashboardEmployeesSource, /setLeaveModalOpen\(true\);/);
});

test("submitting the leave modal directly approves both Firestore and Core leave records", () => {
  assert.match(
    dashboardEmployeesSource,
    /await approveEmployeeLeaveRequest\(\{[\s\S]*?requestId,[\s\S]*?reviewerUid: authUser\.uid[\s\S]*?\}\);/
  );
  assert.match(
    dashboardEmployeesSource,
    /await CoreHrService\.decideLeave\([\s\S]*?coreLeaveId,[\s\S]*?"approved"[\s\S]*?\);/
  );
  assert.match(
    dashboardEmployeesSource,
    /description: "تسجيل إجازة معتمدة وربطها بالحضور والراتب"/
  );
});
