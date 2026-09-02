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
const leaveRequestModalSource = readFileSync(
  new URL("../src/components/LeaveRequestModal.tsx", import.meta.url),
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

test("leave modal resets stale leave type to the requested default every time it opens", () => {
  assert.match(
    leaveRequestModalSource,
    /if \(!open\) return;[\s\S]*?setType\(defaultType\);[\s\S]*?setFromDate\(initialDate \|\| ""\);/
  );
  assert.match(
    leaveRequestModalSource,
    /\}, \[defaultType, initialDate, open\]\);/
  );
});

test("submitting the leave modal approves through the canonical leave decision and verifies Core state", () => {
  assert.match(
    dashboardEmployeesSource,
    /await decideCanonicalEmployeeLeaveRequest\([\s\S]*?requestForCanonical,[\s\S]*?"approved",[\s\S]*?reviewerUid: authUser\.uid[\s\S]*?\);/
  );

  assert.match(
    dashboardEmployeesSource,
    /const canonicalResult\s*=\s*await decideCanonicalEmployeeLeaveRequest\([\s\S]*?requestForCanonical,[\s\S]*?"approved"[\s\S]*?\);/
  );

  assert.match(
    dashboardEmployeesSource,
    /requestForCanonical\s*=\s*canonicalResult\.request;[\s\S]*?coreLeaveId\s*=\s*canonicalResult\.coreLeave\.id;[\s\S]*?canonicalApprovalCommitted\s*=\s*true;/
  );

  assert.doesNotMatch(
    dashboardEmployeesSource,
    /\bapproveEmployeeLeaveRequest\s*\(/
  );

  assert.match(
    dashboardEmployeesSource,
    /description: "تسجيل إجازة معتمدة وربطها بالحضور والراتب"/
  );
});


test("leave retry reuses an active Core request and rollback refreshes its version", () => {
  assert.match(
    dashboardEmployeesSource,
    /\["pending", "approved"\]\.includes\([\s\S]*?cleanText\(request\.status\)\.toLowerCase\(\)/
  );

  assert.match(
    dashboardEmployeesSource,
    /await refreshCanonicalEmployeeLeaveRequest\([\s\S]*?requestForCanonical[\s\S]*?\);[\s\S]*?await decideCanonicalEmployeeLeaveRequest\([\s\S]*?rollbackRequest,[\s\S]*?"cancelled"/
  );
});


test("post-commit UI refresh cannot roll back an approved canonical leave", () => {
  assert.match(
    dashboardEmployeesSource,
    /canonicalApprovalCommitted\s*=\s*true;[\s\S]*?canonical leave post-commit refresh failed/
  );

  assert.match(
    dashboardEmployeesSource,
    /if \(\s*!canonicalApprovalCommitted\s*&&\s*createdRequestId\s*&&\s*requestForCanonical\s*\)/
  );

  assert.doesNotMatch(
    dashboardEmployeesSource,
    /Fail closed: after canonical approval the linked Core[\s\S]*?CoreHrService\.listLeaves/
  );
});
