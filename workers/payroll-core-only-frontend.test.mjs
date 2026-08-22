import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("employee payroll portal reads canonical Core payroll only", () => {
  const page = read("src/pages/hr/EmployeePayroll.tsx");
  const hub = read("src/services/employeeHub.ts");
  const service = read("src/services/CoreHrService.ts");
  const worker = read("workers/core/index.js");

  assert.match(page, /CoreHrService\.listMyPayrollEntries\(\)/);
  assert.doesNotMatch(page, /listPayrollRecordsByEmployee|EmployeePayrollRecord/);
  assert.doesNotMatch(hub, /createPayrollRecord/);
  assert.doesNotMatch(hub, /listPayrollRecordsByEmployee/);
  assert.doesNotMatch(hub, /employeePayrollRecordsCol/);
  assert.doesNotMatch(hub, /hr(?:Doc|Collection)\("employeePayrollRecords"/);
  assert.match(service, /listMyPayrollEntries/);
  assert.match(service, /\/api\/core\/hr\/payroll-entries\/mine/);
  assert.match(worker, /payroll-entries:mine/);
  assert.match(worker, /ctx\.employeeId/);
  assert.match(worker, /workspace\.employee_portal\.view/);
  assert.match(worker, /\["approved", "paid"\]/);
});

test("employee payroll profile is Core-owned and never mirrored to Firestore", () => {
  const page = read("src/pages/DashboardEmployees.tsx");
  assert.match(page, /Core D1 is the only payroll-profile runtime source/);
  assert.match(page, /withoutLegacyPayrollFirestoreFields/);
  assert.match(page, /baseSalaryHalalas/);
  assert.match(page, /expectedWorkHours/);
  assert.match(page, /overtimeEnabled/);
  assert.match(page, /payrollDeductionMethod/);
  assert.doesNotMatch(page, /Saving payroll compatibility fields to staff_public failed/);
  assert.doesNotMatch(page, /monthlySalary:\s*payload\.monthlySalary/);
  assert.doesNotMatch(page, /payrollMonthlyHours:\s*payload\.payrollMonthlyHours/);
  assert.doesNotMatch(page, /payrollOvertimeEnabled:\s*payload\.payrollOvertimeEnabled/);
  assert.doesNotMatch(page, /payrollOvertimeMultiplier:\s*payload\.payrollOvertimeMultiplier/);
  assert.doesNotMatch(page, /payrollDeductionMethod:\s*payload\.payrollDeductionMethod/);
});
test("admin HR payroll preview uses canonical Core payroll engine", () => {
  const admin = read("src/pages/AdminHrDashboard.tsx");
  assert.match(admin, /generatePayrollEntriesForMonths/);
  assert.match(admin, /payrollMonthBounds/);
  assert.doesNotMatch(
    admin,
    /helpers\/hr\/employeePayroll|computeEmployeePayroll|parseEmployeePayrollMonth|buildEmployeePayrollMonthInput/
  );
  assert.doesNotMatch(
    admin,
    /listAttendanceByDateRangeForEmployeeFromWorker|summarizeAttendanceForPayroll|getPermissionPayrollSummary/
  );
  assert.doesNotMatch(admin, /hr-overview-payroll-base/);
});
test("legacy Firestore payroll artifacts stay deleted", () => {
  assert.equal(existsSync("src/helpers/hr/employeePayroll.ts"), false);

  const activeSources = [
    "src/services/hrCollections.ts",
    "src/types/hrEmployee.ts",
    "src/services/employeeHub.ts",
    "src/pages/hr/EmployeePayroll.tsx",
    "src/pages/AdminHrDashboard.tsx",
  ];

  for (const path of activeSources) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /employeePayrollRecords|employee_payroll_records|EmployeePayrollRecordDoc|normalizeEmployeePayrollRecord|computeEmployeePayroll|parseEmployeePayrollMonth|buildEmployeePayrollMonthInput/
    );
  }
});
