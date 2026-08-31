import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("leave/rest UI has one Dashboard V2 management reference", () => {
  const stats = source("../src/pages/dashboardEmployees/EmployeeStatsSection.tsx");
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(stats, /title="الإجازات والراحة"/);
  assert.match(stats, /<LeaveRestManagementPanel/);
  assert.match(panel, /label="الإجازة السنوية"/);
  assert.match(panel, /label="الراحة الأسبوعية"/);
  assert.match(panel, /label="الراحة التعويضية"/);
  assert.doesNotMatch(
    stats,
    /title="الراحة الأسبوعية لا تُخصم من رصيد الإجازات"/
  );
});

test("leave/rest actions use canonical date/time controls", () => {
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(panel, /DashboardDatePickerV2/);
  assert.match(panel, /DashboardTimePickerV2/);
  assert.doesNotMatch(panel, /type="date"/);
  assert.doesNotMatch(panel, /type="time"/);
  assert.doesNotMatch(panel, /type="number"/);
});

test("frontend calls Core leave/rest contracts without duplicating business rules", () => {
  const service = source("../src/services/CoreHrService.ts");
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(service, /leave-rest-overview/);
  assert.match(service, /\/recalls/);
  assert.match(service, /weekly-rest\/work-assignments/);
  assert.match(panel, /CoreHrService\.createAnnualLeaveRecall/);
  assert.match(panel, /CoreHrService\.createWeeklyRestWorkAssignment/);
  assert.doesNotMatch(panel, /leave_balance\s*[+\-]=/);
  assert.doesNotMatch(panel, /createScheduleException/);
});
