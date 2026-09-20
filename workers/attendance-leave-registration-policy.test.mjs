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

test("weekly-rest substitute is selectable and stays on the canonical entitlement path", () => {
  assert.match(
    leaveRequestModalSource,
    /weekly_rest_substitute_use: "راحة أسبوعية تعويضية"/
  );
  assert.match(
    leaveRequestModalSource,
    /weekly_rest_substitute_use: \{ deductFromBalance: false, affectsPayroll: false \}/
  );
  assert.match(
    leaveRequestModalSource,
    /isWeeklyRestSubstituteUse[\s\S]*?days !== 1[\s\S]*?الراحة الأسبوعية التعويضية تُسجل ليوم واحد فقط/
  );
  assert.match(
    leaveRequestModalSource,
    /سيُخصم يوم واحد من رصيد الراحة الأسبوعية التعويضية في Core، ولن يُخصم من الرصيد السنوي أو الراتب/
  );
  assert.match(
    dashboardEmployeesSource,
    /"weekly_rest_substitute_use"/
  );

  const employeeHubSource = readFileSync(
    new URL("../src/services/employeeHub.ts", import.meta.url),
    "utf8"
  );
  const attendanceCalendarSource = readFileSync(
    new URL("../src/helpers/hr/attendanceCalendarData.ts", import.meta.url),
    "utf8"
  );
  const employeeStatsSource = readFileSync(
    new URL("../src/pages/dashboardEmployees/EmployeeStatsSection.tsx", import.meta.url),
    "utf8"
  );

  assert.match(employeeHubSource, /"weekly_rest_substitute_use"/);
  assert.match(
    attendanceCalendarSource,
    /weekly_rest_substitute_use: \{ kind: "leave", deductFromBalance: false, affectsPayroll: false, visibleInAttendance: true \}/
  );
  assert.match(
    employeeStatsSource,
    /weekly_rest_substitute_use"\) return "راحة أسبوعية تعويضية"/
  );
});


test("Core leave conflicts expose specific causes instead of a generic 409 message", () => {
  const coreApiClientSource = readFileSync(
    new URL("../src/services/coreApiClient.ts", import.meta.url),
    "utf8"
  );

  for (const code of [
    "core_employee_request:version_conflict",
    "core_employee_request:invalid_transition",
    "core_employee_request:insufficient_leave_balance",
    "core_employee_request:insufficient_annual_leave_balance",
    "core_leave:hr_review_resolution_required",
    "core_leave:statutory_validation_required",
    "core_leave:entitlement_consumption_runtime_required",
  ]) {
    assert.ok(coreApiClientSource.includes(code), "missing conflict mapping: " + code);
  }

  assert.match(
    coreApiClientSource,
    /console\.warn\("\[core-api-error\]"[\s\S]*?requestId[\s\S]*?status: response\.status[\s\S]*?code/
  );
});


test("other leave uses an explicit manager-authorized manual policy path", () => {
  const canonicalServiceSource = readFileSync(
    new URL("../src/services/canonicalEmployeeLeaveRequests.ts", import.meta.url),
    "utf8"
  );
  const coreIndexSource = readFileSync(
    new URL("../workers/core/index.js", import.meta.url),
    "utf8"
  );
  const employeeRequestsSource = readFileSync(
    new URL("../workers/core/repositories/employee-requests-legacy.js", import.meta.url),
    "utf8"
  );
  const employeeRequestGuardSource = readFileSync(
    new URL("../workers/core/repositories/employee-requests.js", import.meta.url),
    "utf8"
  );
  const leavesSource = readFileSync(
    new URL("../workers/core/repositories/leaves.js", import.meta.url),
    "utf8"
  );

  assert.match(
    dashboardEmployeesSource,
    /leaveType === "other"[\s\S]*?deductFromBalance: payload\.deductFromBalance === true[\s\S]*?affectsPayroll: payload\.affectsPayroll === true/
  );
  assert.match(
    dashboardEmployeesSource,
    /manualLeavePolicy:[\s\S]*?deductFromBalance: policy\.deductFromBalance[\s\S]*?affectsPayroll: policy\.affectsPayroll/
  );
  assert.match(
    canonicalServiceSource,
    /act\(current, "approve"[\s\S]*?manualLeavePolicy:[\s\S]*?act\(current, "execute"[\s\S]*?manualLeavePolicy:/
  );
  assert.match(
    coreIndexSource,
    /manualLeavePolicyAuthorized: leaveManager/
  );
  assert.match(
    employeeRequestGuardSource,
    /function normalizeManualLeavePolicy[\s\S]*?manual_leave_policy[\s\S]*?typeof deductFromBalance !== 'boolean'[\s\S]*?runtime === 'hr_review_block'[\s\S]*?manualLeavePolicyAuthorized === true[\s\S]*?manualPolicy !== null[\s\S]*?return;/
  );
  assert.match(
    employeeRequestsSource,
    /manualLeavePolicyAuthorized !== true[\s\S]*?core_leave:manual_policy_forbidden/
  );
  assert.match(
    employeeRequestsSource,
    /\['other', 'other_hr_review'\][\s\S]*?legal_basis = 'HR_MANUAL_POLICY'[\s\S]*?manualHrReviewResolved:[\s\S]*?manualPolicy !== null/
  );
  assert.match(
    leavesSource,
    /options\.manualHrReviewResolved === true[\s\S]*?cleanText\(leave\.legal_basis\) === 'HR_MANUAL_POLICY'[\s\S]*?legacyDecideLeave/
  );
});
