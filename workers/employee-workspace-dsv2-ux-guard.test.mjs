import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("successful save rehydrates canonical schedule editor baseline", () => {
  const source = read("src/pages/DashboardEmployees.tsx");
  assert.match(source, /EMPLOYEE_SAVE_DIRTY_BASELINE_FIX_V1/);
  assert.match(
    source,
    /setModalCustomWorkingHours\(\s*resolveCoreScheduleEditorRows\(\s*refreshedCoreSchedules,\s*todayIso\(\)/
  );
});

test("savebar is not rendered when the employee form is clean", () => {
  const source = read("src/pages/dashboardEmployees/EmployeeProfilePageLayout.tsx");
  assert.match(source, /const savebar = showSavebar \? \(/);
  assert.match(source, /!savebar \|\| typeof document === "undefined"/);
});

test("employee offboarding is independent from save actions", () => {
  const profile = read("src/pages/dashboardEmployees/EmployeeProfilePageLayout.tsx");
  const editor = read("src/pages/dashboardEmployees/EmployeeEditorModal.tsx");

  assert.doesNotMatch(profile, /أرشفة الموظفة/);
  assert.doesNotMatch(editor, />\s*أرشفة\s*</);
  assert.match(profile, /إنهاء الخدمة/);
  assert.match(editor, /إنهاء الخدمة/);

  const savebarStart = profile.indexOf("employees-v2-profile-savebar");
  const savebarEnd = profile.indexOf("const savebarPortal", savebarStart);
  assert.ok(savebarStart >= 0 && savebarEnd > savebarStart);
  assert.doesNotMatch(profile.slice(savebarStart, savebarEnd), /إنهاء الخدمة/);
});

test("Dashboard V2 secondary copy uses shared readable semantic tokens", () => {
  const foundation = read("src/styles/dashboard-v2/foundation.css");
  const forms = read("src/styles/dashboard-v2/forms.css");
  const modals = read("src/styles/dashboard-v2/modals.css");
  const states = read("src/styles/dashboard-v2/states.css");
  const employeeWorkspace = read("src/styles/dashboard-v2/pages/employee-workspace.css");

  assert.match(foundation, /\.dsv2-page-subtitle[\s\S]*?color: var\(--dsv2-text-soft\)/);
  assert.match(foundation, /\.dsv2-section-caption[\s\S]*?color: var\(--dsv2-text-soft\)/);
  assert.match(forms, /\.dsv2-field__hint[\s\S]*?color: var\(--dsv2-text-soft\)/);
  assert.match(modals, /\.dsv2-dialog__description[\s\S]*?color: var\(--dsv2-text-soft\)/);
  assert.match(modals, /DSV2_MODAL_READABILITY_FLOOR_V1/);
  assert.match(states, /\.dsv2-state__description[\s\S]*?color: var\(--dsv2-text-soft\)/);
  assert.match(employeeWorkspace, /--dsv2-ew-muted: var\(--dsv2-text-soft\)/);
});
