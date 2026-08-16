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


test("DashboardEmployees schedule editor reads its base schedule from Malikat Core", () => {
  const source =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  assert.match(
    source,
    /CoreHrService[\s\S]*\.getEmployee\(\s*employeeId\s*\)/
  );

  assert.match(
    source,
    /resolveCoreScheduleEditorRows/
  );

  assert.match(
    source,
    /coreScheduleLoadedEmployeeId/
  );

  assert.match(
    source,
    /scheduleVersionCount=\{coreScheduleVersionCount\}/
  );

  assert.doesNotMatch(
    source,
    /const currentScheduleSnapshot = resolveDateEffectiveScheduleSnapshot\(x as any, todayIso\(\)\)/
  );

  assert.doesNotMatch(
    source,
    /setModalCustomWorkingHours\(alignedInitialWorkingHours\)/
  );
});


test("DashboardEmployees base schedule save is Core-only and fail-closed", () => {
  const source =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  assert.match(
    source,
    /coreScheduleLoadedEmployeeId[\s\S]*cleanText\(editId\)/
  );

  assert.match(
    source,
    /coreScheduleEditorRowsEqual/
  );

  assert.match(
    source,
    /CoreHrService[\s\S]*\.replaceSchedules\(/
  );

  assert.match(
    source,
    /\$\{targetEmployeeId\}-\$\{day\.key\}-\$\{versionDate\}/
  );

  assert.match(
    source,
    /const refreshedCoreEmployee/
  );

  assert.doesNotMatch(
    source,
    /let workingScheduleVersions =/
  );

  assert.doesNotMatch(
    source,
    /appendDateEffectiveScheduleVersion\(/
  );

  assert.doesNotMatch(
    source,
    /weeklyOffDays:\s*normalizedExceptionalWeekdays/
  );

  assert.doesNotMatch(
    source,
    /let coreSyncWarning =/
  );

  assert.doesNotMatch(
    source,
    /Core HR sync failed after employee Firestore save:/
  );
});


test("approved off schedule exceptions participate in canonical shift resolution", () => {
  const source =
    readFileSync(
      "workers/core/repositories/shift-control.js",
      "utf8"
    );

  assert.match(
    source,
    /e\.status='approved' AND \(e\.exception_type='off' OR e\.enabled=1\) AND e\.date_from<=\?/
  );

  assert.doesNotMatch(
    source,
    /e\.status='approved' AND e\.enabled=1 AND e\.date_from<=\?/
  );

  assert.match(
    source,
    /if \(exception\)[\s\S]*return \{ source: 'exception', date, \.\.\.exception \}/
  );
});


test("DashboardEmployees dated overrides read from Core schedule exceptions", () => {
  const source =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  assert.match(
    source,
    /CoreHrService[\s\S]*\.listScheduleExceptions\(\{[\s\S]*employeeId/
  );

  assert.match(
    source,
    /projectCoreScheduleExceptionsToOverrides/
  );

  assert.match(
    source,
    /type === "custom" \|\|[\s\S]*type === "off"/
  );

  assert.match(
    source,
    /setCoreScheduleExceptionRows\([\s\S]*scheduleExceptions/
  );

  assert.match(
    source,
    /setModalCustomHourOverrides\([\s\S]*projectedOverrides/
  );

  assert.doesNotMatch(
    source,
    /Temporary compatibility only:[\s\S]*customWorkingHourOverrides/
  );
});


test("temporary weekly off is Core-only and refreshes Dashboard canonical exception state", () => {
  const service =
    readFileSync(
      "src/services/temporaryWeeklyOffService.ts",
      "utf8"
    );

  const card =
    readFileSync(
      "src/pages/dashboardEmployees/TemporaryWeeklyOffPeriodCard.tsx",
      "utf8"
    );

  const dashboard =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  assert.doesNotMatch(
    service,
    /firebase\/firestore/
  );

  assert.doesNotMatch(
    service,
    /from "\.\/firebase"/
  );

  assert.doesNotMatch(
    service,
    /saveProfileOverrides/
  );

  assert.doesNotMatch(
    service,
    /customWorkingHourOverrides/
  );

  assert.match(
    service,
    /TEMP_WEEKLY_OFF_SYNC_EVENT/
  );

  assert.match(
    service,
    /createScheduleException/
  );

  assert.match(
    service,
    /updateScheduleException/
  );

  assert.match(
    card,
    /TEMP_WEEKLY_OFF_SYNC_EVENT/
  );

  assert.match(
    dashboard,
    /window\.addEventListener\([\s\S]*TEMP_WEEKLY_OFF_SYNC_EVENT/
  );

  assert.match(
    dashboard,
    /refreshCoreExceptionsAfterTemporaryWeeklyOff/
  );

  assert.match(
    dashboard,
    /listScheduleExceptions\(\{[\s\S]*employeeId/
  );

  assert.match(
    dashboard,
    /setCoreScheduleExceptionRows\([\s\S]*canonicalRows/
  );

  assert.match(
    dashboard,
    /projectCoreScheduleExceptionsToOverrides\([\s\S]*canonicalRows/
  );
});


test("working-hour override mutations are centralized in one Malikat Core sync operation", () => {
  const repo =
    readFileSync(
      "workers/core/repositories/shift-control.js",
      "utf8"
    );

  const worker =
    readFileSync(
      "workers/core/index.js",
      "utf8"
    );

  const service =
    readFileSync(
      "src/services/CoreHrService.ts",
      "utf8"
    );

  assert.match(
    repo,
    /export async function syncWorkingHourScheduleExceptions/
  );

  assert.match(
    repo,
    /working_hour_exceptions_changed/
  );

  assert.match(
    repo,
    /working_hour_exception_shift_conflict/
  );

  assert.match(
    repo,
    /assertUnlockedOrAdjustmentAllowed/
  );

  assert.match(
    repo,
    /await dbBatch\([\s\S]*statements/
  );

  assert.match(
    repo,
    /sync_working_hour_overrides/
  );

  assert.match(
    worker,
    /route\.id === "working-hours-sync"/
  );

  assert.match(
    worker,
    /syncWorkingHourScheduleExceptions\(/
  );

  assert.match(
    service,
    /async syncWorkingHourScheduleExceptions\(/
  );

  assert.match(
    service,
    /schedule-exceptions\/working-hours-sync/
  );
});


test("DashboardEmployees working-hour override save is Core-only", () => {
  const source =
    readFileSync(
      "src/pages/DashboardEmployees.tsx",
      "utf8"
    );

  const saveStart =
    source.indexOf(
      "  const save = async () => {"
    );

  const saveEnd =
    source.indexOf(
      "\n  const remove = async",
      saveStart
    );

  assert.ok(
    saveStart >= 0 &&
    saveEnd > saveStart
  );

  const saveSource =
    source.slice(
      saveStart,
      saveEnd
    );

  assert.match(
    saveSource,
    /syncWorkingHourScheduleExceptions\(\{[\s\S]*expectedOverrides:[\s\S]*desiredOverrides:/
  );

  assert.match(
    source,
    /workingHourOverridesDirty/
  );

  assert.doesNotMatch(
    source,
    /customWorkingHourOverrides:\s*normalizedCustomHourOverrides/
  );

  assert.doesNotMatch(
    source,
    /customWorkingHourOverrides:\s*normalizeWorkingHourOverrides\(staff\.customWorkingHourOverrides\)/
  );

  assert.doesNotMatch(
    source,
    /customWorkingHourOverrides:\s*normalizeWorkingHourOverrides\(\(editingStaff as any\)\.customWorkingHourOverrides\)/
  );

  const coreSyncIndex =
    saveSource.indexOf(
      ".syncWorkingHourScheduleExceptions("
    );

  const scheduleIndex =
    saveSource.indexOf(
      ".replaceSchedules("
    );

  const firestoreIndex =
    saveSource.indexOf(
      "await setDoc(staffPublicDoc(targetEmployeeId)"
    );

  assert.ok(
    coreSyncIndex >= 0 &&
    firestoreIndex >= 0 &&
    coreSyncIndex < firestoreIndex,
    "Core exception sync must precede Firestore profile save"
  );

  assert.ok(
    scheduleIndex < 0 ||
    scheduleIndex < firestoreIndex,
    "Core weekly schedule mutation must precede Firestore profile save"
  );
});
