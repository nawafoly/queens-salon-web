import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("Malikat scheduling runtime has one canonical shift resolver", () => {
  const shiftCore = read("workers/core/repositories/shift-control.js");
  const bookingPolicy = read("workers/core/repositories/booking-staff-policy.js");
  const availability = read("workers/core/repositories/availability.js");
  const attendanceWorker = read("workers/attendance-worker.js");

  assert.match(
    shiftCore,
    /export async function resolveEmployeeShift/,
    "Scheduling Core must expose resolveEmployeeShift"
  );

  assert.match(
    bookingPolicy,
    /import\s*\{\s*resolveEmployeeShift\s*\}\s*from\s*['"]\.\/shift-control\.js['"]/,
    "Booking policy must consume the canonical shift resolver"
  );

  assert.match(
    availability,
    /resolveStaffBookingDay/,
    "Availability must flow through booking-day resolution"
  );

  assert.match(
    attendanceWorker,
    /resolveEmployeeShift/,
    "Attendance must consume the canonical shift resolver"
  );
});

test("Payroll must not own a second scheduling runtime", () => {
  const payroll = read("src/services/CorePayrollService.ts");

  const forbidden = [
    "fallbackEmploymentSchedule",
    "coreAssignmentScheduleForDate",
    'source: "employment_fallback"',
    'source: "core_assignment_legacy"',
    'source: "weekly_schedule_legacy"',
  ];

  for (const token of forbidden) {
    assert.equal(
      payroll.includes(token),
      false,
      `Payroll contains duplicated scheduling runtime: ${token}`
    );
  }
});


test("Attendance discipline must not reconstruct scheduling outside Malikat Core", () => {
  const source = read("src/pages/DashboardAttendanceSecurity.tsx");

  assert.match(
    source,
    /CoreHrService\.resolveEmployeeShift/,
    "Attendance discipline must consume the canonical shift resolver"
  );

  const forbidden = [
    "resolveApprovedScheduleForDate",
    "DEFAULT_ATTENDANCE_SHIFT_START",
    "DEFAULT_ATTENDANCE_SHIFT_END",
    "fallbackSchedule",
  ];

  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      `Attendance discipline contains local scheduling fallback: ${token}`
    );
  }
});


test("DashboardReports payroll expenses use Malikat Core only", () => {
  const source =
    readFileSync(
      "src/pages/DashboardReports.tsx",
      "utf8"
    );

  const forbidden = [
    "buildPayrollExpenseRowsForMonths",
    "normalizeCoreStaffPayrollRows",
    "normalizeBookingPayrollRows",
    "WEEKDAY_KEY_BY_NUMBER",
    "employee?.schedules",
    "customWorkingHours",
    "customWorkingHourOverrides",
    "staffRows",
    "CoreSettingsService",
    "appSettings",
    "effectiveAutoPayrollExpenses",
    "autoPayrollExpenses",
  ];

  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      "DashboardReports must not contain legacy payroll runtime: " + token
    );
  }

  assert.equal(
    source.includes(
      "generatePayrollEntriesForMonths"
    ),
    true,
    "DashboardReports must calculate payroll through CorePayrollService"
  );

  assert.equal(
    source.includes(
      "calculatedPayrollExpenses"
    ),
    true
  );

  assert.equal(
    source.includes(
      "recordedPayrollExpenses"
    ),
    true
  );
});


test("Reports and Expenses share Malikat Core payroll financial projection", () => {
  const reports =
    readFileSync(
      "src/pages/DashboardReports.tsx",
      "utf8"
    );

  const expenses =
    readFileSync(
      "src/pages/DashboardExpenses.tsx",
      "utf8"
    );

  const projection =
    readFileSync(
      "src/helpers/corePayrollFinancialRows.ts",
      "utf8"
    );

  const expensesForbidden = [
    "buildPayrollExpenseRowsForMonths",
    "normalizeStaffPayrollRows",
    "normalizeBookingPayrollRows",
    "staff_public",
    "AppSettingsService",
    "listAllBookings",
    "customWorkingHours",
    "customWorkingHourOverrides",
    "StaffPayrollSource",
    "BookingPayrollSource",
    "staffSnap",
    "allBookings",
    "appSettings",
  ];

  for (const token of expensesForbidden) {
    assert.equal(
      expenses.includes(token),
      false,
      "DashboardExpenses must not own legacy payroll runtime: " + token
    );
  }

  assert.equal(
    expenses.includes(
      "generatePayrollEntriesForMonths"
    ),
    true
  );

  assert.equal(
    reports.includes(
      "projectCorePayrollEntriesToFinancialRows"
    ),
    true
  );

  assert.equal(
    expenses.includes(
      "projectCorePayrollEntriesToFinancialRows"
    ),
    true
  );

  assert.equal(
    projection.includes(
      "projectCorePayrollEntriesToFinancialRows"
    ),
    true
  );

  assert.equal(
    projection.includes(
      "resolveStaffScheduleVersionForDate"
    ),
    false
  );

  assert.equal(
    projection.includes(
      "customWorkingHours"
    ),
    false
  );
});


test("DashboardEmployees payroll preview uses Malikat Core only", () => {
  const employees =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  const stats =
    readFileSync(
      "src/pages/dashboardEmployees/EmployeeStatsSection.tsx",
      "utf8"
    );

  assert.equal(
    employees.includes(
      "computeStaffPayrollForMonth"
    ),
    false,
    "DashboardEmployees must not calculate payroll through staffPayroll"
  );

  assert.equal(
    employees.includes(
      "generatePayrollEntriesForMonths"
    ),
    true,
    "DashboardEmployees payroll preview must come from CorePayrollService"
  );

  assert.equal(
    employees.includes(
      "employeeId,"
    ),
    true,
    "Employee payroll preview should scope Core generation to one employee"
  );

  assert.equal(
    employees.includes(
      "Malikat Core employee payroll preview load error:"
    ),
    true
  );

  assert.equal(
    stats.includes(
      'helpers/staffPayroll'
    ),
    false,
    "EmployeeStatsSection must not depend on legacy payroll types"
  );

  assert.equal(
    stats.includes(
      "scheduledHours?:"
    ),
    false,
    "Employee payroll UI must not require legacy schedule summary"
  );

  assert.equal(
    stats.includes(
      "totalAmount?: number"
    ),
    true
  );

  assert.equal(
    stats.includes(
      "invoiceRevenue?: number"
    ),
    true
  );
});


test("Legacy staffPayroll runtime is removed", () => {
  assert.equal(
    existsSync(
      "src/helpers/staffPayroll.ts"
    ),
    false,
    "Legacy staffPayroll runtime file must not exist"
  );

  const profileConfig =
    readFileSync(
      "src/helpers/hr/payrollProfileConfig.ts",
      "utf8"
    );

  const payrollCycle =
    readFileSync(
      "src/helpers/hr/payrollCycle.ts",
      "utf8"
    );

  const employees =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  const expenses =
    readFileSync(
      "src/pages/DashboardExpenses.tsx",
      "utf8"
    );

  const reports =
    readFileSync(
      "src/pages/DashboardReports.tsx",
      "utf8"
    );

  const shared =
    readFileSync(
      "src/pages/dashboardEmployees/shared.ts",
      "utf8"
    );

  for (
    const forbidden of [
      "resolveStaffScheduleVersionForDate",
      "computeScheduledHoursSummaryForMonth",
      "computeStaffPayrollForMonth",
      "buildPayrollExpenseRowsForMonths",
      "customWorkingHours",
      "customWorkingHourOverrides",
      "workingScheduleVersions",
    ]
  ) {
    assert.equal(
      profileConfig.includes(
        forbidden
      ),
      false,
      "Payroll profile config must not contain Legacy runtime: " +
        forbidden
    );

    assert.equal(
      payrollCycle.includes(
        forbidden
      ),
      false,
      "Payroll cycle helper must not contain Legacy runtime: " +
        forbidden
    );
  }

  for (
    const source of [
      employees,
      expenses,
      reports,
      shared,
    ]
  ) {
    assert.equal(
      source.includes(
        "helpers/staffPayroll"
      ),
      false,
      "No active consumer may import staffPayroll"
    );
  }

  assert.equal(
    profileConfig.includes(
      "normalizePayrollConfig"
    ),
    true
  );

  assert.equal(
    payrollCycle.includes(
      "payrollCycleKeyFromDate"
    ),
    true
  );

  assert.equal(
    payrollCycle.includes(
      "payrollCycleRangeForMonthKey"
    ),
    true
  );
});
