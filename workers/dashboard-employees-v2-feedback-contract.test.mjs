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
  assert.match(source, /position="top-center"/);
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

test("salary settings button reports saving, success, validation errors and Core failures inline", () => {
  assert.match(source, /setPayrollSettingsSaving\(true\)/);
  assert.match(source, /setPayrollSettingsSaving\(false\)/);
  assert.match(source, /setPayrollSaveNotice\(\{ tone: "success"/);
  assert.match(source, /setPayrollSaveNotice\(\{ tone: "danger", text: message \}\)/);
  assert.match(source, /rejectSave\("حدد تصنيف التأمينات الاجتماعية/);
  assert.match(source, /toFirestoreErrorMessage\(error, "تعذر حفظ إعدادات الراتب\."\)/);
  assert.match(employeeStatsSource, /saveNotice=\{payroll\.saveNotice\}/);
  assert.match(operationalTabsSource, /role=\{saveNotice\.tone === "danger" \? "alert" : "status"\}/);
  assert.match(operationalTabsSource, /aria-live=/);
  assert.match(operationalTabsSource, /جاري حفظ إعدادات الراتب والتأمينات/);
});

test("canonical Core staff record is not labeled incomplete solely by its source", () => {
  const directory = fs.readFileSync(
    new URL("../src/pages/dashboardEmployees/EmployeeListPanel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(directory, /staff\.profileIncomplete === true/);
  assert.doesNotMatch(directory, /staff\.source !== "staff_public"/);
});
