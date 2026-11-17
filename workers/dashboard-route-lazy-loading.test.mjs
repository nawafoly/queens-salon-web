import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");

for (const [component, importPath, permission] of [
  ["DashboardInventory", "./DashboardInventory", 'anyOf={["inventory.view", "inventory.items.manage"]}'],
  ["DashboardReports", "./DashboardReports", 'permission="reports.view"'],
  ["DashboardPayroll", "../pages/DashboardPayroll", 'permission="payroll.view"'],
  ["DashboardAttendanceSecurity", "../pages/DashboardAttendanceSecurity", 'permission="attendance.view"'],
]) {
  test(`${component} remains permission guarded and loads on demand`, () => {
    assert.ok(source.includes(`const ${component} = React.lazy(() => import("${importPath}"));`));
    assert.ok(source.includes(permission));
    assert.match(source, new RegExp(`<React\\.Suspense[^>]*><${component}\\b`));
  });
}
