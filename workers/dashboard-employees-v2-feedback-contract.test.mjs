import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/pages/DashboardEmployees.tsx", import.meta.url),
  "utf8",
);
const employeeStatsSource = fs.readFileSync(
  new URL("../src/pages/dashboardEmployees/EmployeeStatsSection.tsx", import.meta.url),
  "utf8",
);

const operationalTabsSource = fs.readFileSync(
  new URL("../src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx", import.meta.url),
  "utf8",
);

test("dashboard employees uses canonical V2 feedback primitives", () => {
  assert.match(source, /DashboardToastProviderV2/);
  assert.match(source, /useDashboardToastV2/);
  assert.match(source, /<DashboardConfirmV2[\s>]/);
  assert.match(source, /requestConfirmation/);

  assert.doesNotMatch(source, /\bconfirm\s*\(/);
  assert.doesNotMatch(source, /employees-v2-alert/);
  assert.doesNotMatch(source, /payrollSettingsMessage/);
  assert.doesNotMatch(employeeStatsSource, /settingsMessage/);
  assert.doesNotMatch(operationalTabsSource, /settingsMessage/);
  assert.doesNotMatch(operationalTabsSource, /title="حالة الحفظ"/);
});
