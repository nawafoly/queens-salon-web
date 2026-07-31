import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("permission payroll summary normalizes raw D1 entries", () => {
  const source = read("src/services/employeePermissionRequests.ts");
  assert.match(source, /permissionSummary\.entries\.map\(normalizePermissionRequest\)/);
});

test("employee attendance screen receives normalized permission entries", () => {
  const section = read("src/pages/dashboardEmployees/AttendanceSection.tsx");
  const month = read("src/components/AttendanceMonthView.tsx");
  assert.match(section, /permissionEntries=\{permissionEntries\}/);
  assert.match(month, /permissionIntervalsFromRequests\(permissionEntries, safeSelectedDate\)/);
});

test("discipline dashboard uses Core resolved shifts and approved permissions", () => {
  const source = read("src/pages/DashboardAttendanceSecurity.tsx");
  assert.match(source, /CoreHrService\.resolveEmployeeShift\(employeeId, date\)/);
  assert.match(source, /getPermissionPayrollSummary\(\{/);
  assert.match(source, /resolveCoreAttendanceSchedule\(/);
  assert.match(source, /permissionIntervalsFromRequests\(/);
  assert.match(source, /permissionIntervals,/);
});

test("discipline dashboard and exports display permission coverage", () => {
  const dashboard = read("src/pages/DashboardAttendanceSecurity.tsx");
  const report = read("src/helpers/reports/exportAttendanceReport.ts");
  assert.match(dashboard, /الاستئذان المحتسب/);
  assert.match(dashboard, /permissionCoveredHours/);
  assert.match(report, /permissionCoveredHours/);
  assert.match(report, /إجمالي الاستئذان المحتسب/);
});
