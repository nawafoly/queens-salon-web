import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

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
    /import\s*\{[^}]*\bresolveEmployeeShift\b[^}]*\}\s*from\s*['"]\.\/shift-control\.js['"]/,
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
    /e\.status IN \('approved','active'\) AND \(e\.exception_type='off' OR e\.enabled=1\) AND e\.date_from<=\?/
  );

  assert.doesNotMatch(
    source,
    /e\.status(?:='approved'| IN \('approved','active'\)) AND e\.enabled=1 AND e\.date_from<=\?/
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

  // Regression: today's Dashboard status must come from
  // the canonical Malikat Core resolved shift.
  assert.match(
    dashboard,
    /resolveEmployeeShiftsRange\(\{[\s\S]*dateFrom:\s*coreResolvedTodayDateKey[\s\S]*dateTo:\s*coreResolvedTodayDateKey/
  );

  assert.match(
    dashboard,
    /const canonicalOff =[\s\S]*canonicalExceptionType === "off"/
  );

  assert.match(
    dashboard,
    /const overrideToday =[\s\S]*canonicalSource === "exception"/
  );

  assert.match(
    dashboard,
    /const effectiveEnabled =\s*canonicalEmployeeEnabled/
  );

  // TEMP_WORK must override an old/base weekly-off for today.
  assert.match(
    dashboard,
    /const leaveByWeekday =\s*canonicalSource === "weekly_schedule" &&\s*canonicalOff/
  );

  assert.doesNotMatch(
    dashboard,
    /const overrideToday = overrides\.find\(\(x\) => x\.date === today\)/
  );

  assert.doesNotMatch(
    dashboard,
    /const leaveByWeekday = weekday \? exceptionalWeekdays\.includes\(weekday\) : false/
  );

  assert.match(
    dashboard,
    /weeklyOffToday:\s*canonicalOff \|\|\s*leaveByWeekday/
  );

  // The canonical schedule summary must actually render
  // when an existing employee is open.
  assert.match(
    dashboard,
    /ScheduleSummarySection[\s\S]*isVisible=\{!!editingStaff && modalTab === "basic"\}/
  );

  assert.doesNotMatch(
    dashboard,
    /ScheduleSummarySection[\s\S]*isVisible=\{!editingStaff && modalTab === "basic"\}/
  );

  // Upcoming return must use future Core resolution only.
  assert.match(
    dashboard,
    /coreResolvedFutureRows/
  );

  assert.match(
    dashboard,
    /const rangeEnd =\s*addDaysIso\([\s\S]*rangeStart,[\s\S]*119/
  );

  assert.match(
    dashboard,
    /resolveEmployeeShiftsRange\(\{[\s\S]*employeeIds:\s*\[employeeId\][\s\S]*dateFrom:\s*rangeStart[\s\S]*dateTo:\s*rangeEnd/
  );

  assert.doesNotMatch(
    dashboard,
    /firstRangeEnd|secondRangeStart|secondRangeEnd/
  );

  assert.match(
    dashboard,
    /canonicalFutureRowsForStaff/
  );

  assert.doesNotMatch(
    dashboard,
    /const resolveOperationalDay =/
  );

  assert.doesNotMatch(
    dashboard,
    /resolveOperationalDay\(cursor\)/
  );

  // Normal Core schedule saves must invalidate
  // today's and future resolved-shift snapshots.
  assert.match(
    dashboard,
    /if \(\s*scheduleChanged \|\|\s*workingHourOverridesChanged\s*\) \{[\s\S]*setCoreResolvedTodayRefreshVersion/
  );

  // Future Core state must participate in
  // staffScheduleSummary memo dependencies.
  assert.match(
    dashboard,
    /appSettings,[\s\S]*coreResolvedFutureEmployeeId,[\s\S]*coreResolvedFutureError,[\s\S]*coreResolvedFutureLoading,[\s\S]*coreResolvedFutureRows,[\s\S]*coreResolvedTodayByEmployeeId/
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
      "  const save = async"
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

  assert.ok(
    coreSyncIndex >= 0,
    "Working-hour overrides must be persisted through the Core schedule exception sync"
  );

  assert.doesNotMatch(
    saveSource,
    /\b(?:setDoc|updateDoc|writeBatch)\s*\(/,
    "DashboardEmployees save must not persist any Firestore profile mirror after the Core cutover"
  );

  assert.doesNotMatch(
    saveSource,
    /staffPublicDoc\s*\(|salons[\s\S]{0,120}employees/,
    "DashboardEmployees save must not write staff_public/employees Firestore mirrors"
  );
});
test("Dashboard schedule summary reads employee scheduling presentation from Malikat Core only", () => {
  const source = readFileSync(
    "src/pages/DashboardEmployees.tsx",
    "utf8"
  );

  const forbidden = [
    "staffScheduleHistory",
    "workingScheduleVersions",
    "resolveStaffWeeklyOffDays",
    "(staff as any).customWorkingHours",
    "(staff as any).customWorkingHourOverrides",
    "(staff as any).useCustomWorkingHours",
  ];

  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      `Dashboard schedule summary still depends on legacy staff scheduling: ${token}`
    );
  }

  assert.match(
    source,
    /resolveCoreScheduleEditorRows\(\s*coreScheduleRows,\s*today\s*\)/
  );

  assert.match(
    source,
    /projectCoreScheduleExceptionsToOverrides\(\s*coreScheduleExceptionRows\s*\)/
  );

  assert.match(
    source,
    /canonicalScheduleTarget[\s\S]*coreScheduleLoadedEmployeeId/
  );
});
test("StaffPerformance attendance discipline uses Malikat Core resolved shifts only", () => {
  const performance = readFileSync(
    "src/services/StaffPerformanceService.ts",
    "utf8"
  );

  const coreHr = readFileSync(
    "src/services/CoreHrService.ts",
    "utf8"
  );

  assert.match(
    performance,
    /CoreHrService\.resolveEmployeeShiftsRange\(\{/
  );

  assert.match(
    performance,
    /resolveAttendanceShiftForDate\(\{[\s\S]*coreResolvedShift:/
  );

  assert.match(
    performance,
    /scheduledStart:\s*shiftResolution\.startTime/
  );

  assert.match(
    performance,
    /scheduledEnd:\s*shiftResolution\.endTime/
  );

  assert.match(
    performance,
    /lateGraceMinutes:\s*shiftResolution\.lateGraceMinutes/
  );

  assert.match(
    performance,
    /isScheduledWorkDay:\s*!shiftResolution\.isOff/
  );

  const forbidden = [
    "staff.schedules",
    "customWorkingHours",
    "useCustomWorkingHours",
    "DEFAULT_SHIFT_START",
    "DEFAULT_SHIFT_END",
    "function resolveSchedule",
    "\"10:00\"",
    "\"22:00\"",
    "firestoreStaffPublic",
  ];

  for (const token of forbidden) {
    assert.equal(
      performance.includes(token),
      false,
      `StaffPerformance still owns legacy scheduling runtime: ${token}`
    );
  }

  assert.match(
    coreHr,
    /async resolveEmployeeShiftsRange\(/
  );

  assert.match(
    coreHr,
    /dateOffset \+= 62/
  );

  assert.match(
    coreHr,
    /Math\.floor\(\s*5000\s*\/\s*rangeKeys\.length\s*\)/
  );

  assert.match(
    coreHr,
    /Math\.min\(\s*100,/
  );
});
test("Core resolved shift batching policy is centralized in CoreHrService", () => {
  const coreHr = readFileSync(
    "src/services/CoreHrService.ts",
    "utf8"
  );

  const rangeConsumers = [
    "src/pages/DashboardEmployees.tsx",
    "src/services/StaffPerformanceService.ts",
  ];

  assert.match(
    coreHr,
    /async resolveEmployeeShiftsRange\(/
  );

  assert.match(
    coreHr,
    /CoreHrService\.resolveEmployeeShiftsBatch\(\{/
  );

  for (const file of rangeConsumers) {
    const source = readFileSync(
      file,
      "utf8"
    );

    assert.equal(
      source.includes(
        "resolveEmployeeShiftsBatch"
      ),
      false,
      `${file} must not own low-level Core shift batching`
    );

    assert.match(
      source,
      /resolveEmployeeShiftsRange/
    );
  }

  const payroll = readFileSync(
    "src/services/CorePayrollService.ts",
    "utf8"
  );

  assert.doesNotMatch(
    payroll,
    /resolveEmployeeShifts(?:Batch|Range)/,
    "Frontend payroll must not resolve scheduling; canonical payroll authority now lives in Core"
  );
});


test("Partner Portal operational day is a Malikat Core RPC projection only", () => {
  const portal = readFileSync(
    "src/pages/PartnerPortal.tsx",
    "utf8"
  );

  const partnerWorker = readFileSync(
    "workers/partners-worker.js",
    "utf8"
  );

  const coreProjection = readFileSync(
    "workers/core/repositories/partner-operational-days.js",
    "utf8"
  );

  const coreWorker = readFileSync(
    "workers/core/worker.js",
    "utf8"
  );

  const staffRepository = readFileSync(
    "workers/core/repositories/staff.js",
    "utf8"
  );

  const bookingPolicy = readFileSync(
    "workers/core/repositories/booking-staff-policy.js",
    "utf8"
  );

  const shiftControl = readFileSync(
    "workers/core/repositories/shift-control.js",
    "utf8"
  );

  const coreConfig = readFileSync(
    "wrangler.core.jsonc",
    "utf8"
  );

  const partnerConfig = readFileSync(
    "wrangler.partners.jsonc",
    "utf8"
  );

  const devScript = readFileSync(
    "scripts/dev-with-partners.mjs",
    "utf8"
  );

  assert.match(
    coreProjection,
    /resolveStaffBookingDaysBatch\(/
  );

  assert.match(
    coreProjection,
    /listStaffByIds\(/
  );

  assert.doesNotMatch(
    coreProjection,
    /\blistStaff\(/
  );

  assert.doesNotMatch(
    coreProjection,
    /resolveStaffBookingDay\(/
  );

  assert.doesNotMatch(
    coreProjection,
    /Promise\.all\(/
  );

  assert.match(
    staffRepository,
    /export async function listStaffByIds/
  );

  assert.match(
    staffRepository,
    /placeholders\(ids\.length\)/
  );

  assert.match(
    bookingPolicy,
    /export async function resolveStaffBookingDaysBatch/
  );

  assert.match(
    bookingPolicy,
    /resolveEmployeeShiftsBatch\(/
  );

  assert.match(
    shiftControl,
    /const \[\s*exceptions,\s*weeklySchedules,\s*assignments,\s*weeklyRestWorkAssignments,\s*employmentRows,?\s*\]\s*=\s*await Promise\.all\(/
  );

  assert.match(
    coreProjection,
    /show_on_booking/
  );

  assert.doesNotMatch(
    coreProjection,
    /customWorkingHours|customWorkingHourOverrides|exceptionalLeaveWeekdays|exceptionalLeaveDates/
  );

  assert.match(
    coreWorker,
    /export class PartnerSchedulingEntrypoint extends WorkerEntrypoint/
  );

  assert.match(
    coreWorker,
    /resolvePartnerOperationalDays\(/
  );

  assert.match(
    coreConfig,
    /"main":\s*"workers\/core\/worker\.js"/
  );

  assert.match(
    partnerConfig,
    /"binding":\s*"MALIKAT_CORE_PARTNER"[\s\S]*"service":\s*"queens-salon-core-api"[\s\S]*"entrypoint":\s*"PartnerSchedulingEntrypoint"/
  );

  assert.match(
    partnerWorker,
    /MALIKAT_CORE_PARTNER\.resolveOperationalDays\(/
  );

  assert.match(
    partnerWorker,
    /offset \+= 100/
  );

  assert.match(
    partnerWorker,
    /employeeIds\.slice\([\s\S]*offset,[\s\S]*offset \+ 100/
  );

  assert.match(
    partnerWorker,
    /resolveOperationalDays\(\{[\s\S]*employeeIds:\s*chunk/
  );

  assert.match(
    partnerWorker,
    /operational-day RPC chunk failed/
  );

  assert.doesNotMatch(
    partnerWorker,
    /env\.CORE_DB/
  );

  assert.match(
    partnerWorker,
    /todayOperationalState/
  );

  assert.match(
    portal,
    /presentTodayOperationalState\([\s\S]*member\.todayOperationalState/
  );

  assert.match(
    portal,
    /todayOperationalState\?\.reason/
  );

  assert.match(
    portal,
    /todayOperationalState[\s\S]*showOnBooking/
  );

  const forbiddenPortalRuntime = [
    "resolveTodaySchedule",
    "collectWorkingWindows",
    "DAY_KEYS",
    "customWorkingHours",
    "customWorkingHourOverrides",
    "exceptionalLeaveDates",
    "exceptionalLeaveWeekdays",
    "employmentEndDate",
    "operationalProfile?.showOnBooking",
    "profile?.showOnBooking",
    "operationalProfile?.onLeave",
    "profile.onLeave",
    "profile.leaveUntil",
  ];

  for (const token of forbiddenPortalRuntime) {
    assert.equal(
      portal.includes(token),
      false,
      `PartnerPortal still owns Legacy operational scheduling: ${token}`
    );
  }

  // DEV_LOCAL_CONFIG_CONTRACT_V2
  // npm run dev now derives ignored local-only configs from the protected
  // developer configs, then passes the generated paths through coreConfig /
  // partnersConfig. Assert the current isolation contract instead of requiring
  // the literal source config path inside each process block.
  assert.match(
    devScript,
    /source:\s*"wrangler\.core\.dev\.jsonc"[\s\S]*generated:\s*"\.wrangler\.core\.local\.generated\.jsonc"/
  );

  assert.match(
    devScript,
    /source:\s*"wrangler\.partners\.dev\.jsonc"[\s\S]*generated:\s*"\.wrangler\.partners\.local\.generated\.jsonc"/
  );

  assert.match(
    devScript,
    /const \[coreConfig, partnersConfig\] = generatedConfigs\.map\(createLocalOnlyConfig\)/
  );

  assert.match(
    devScript,
    /name:\s*"core-api"[\s\S]*"--config"[\s\S]*coreConfig/
  );

  assert.match(
    devScript,
    /name:\s*"partners-api"[\s\S]*"--config"[\s\S]*partnersConfig/
  );
});


test("Stage 2 residual scheduling legacy is removed from active runtime", () => {
  assert.equal(
    existsSync(
      "scripts/set-employee-weekly-off.mjs"
    ),
    false,
    "Dual-write weekly-off CLI must never return"
  );

  const attendanceResolver =
    read(
      "src/helpers/hr/attendanceShiftResolver.ts"
    );

  for (
    const token
    of [
      "AttendanceScheduleInput",
      "customWorkingHours",
      "customWorkingHourOverrides",
      "workingScheduleVersions",
      "exceptionalLeaveWeekdays",
      "exceptionalLeaveDates",
    ]
  ) {
    assert.equal(
      attendanceResolver.includes(
        token
      ),
      false,
      "Attendance resolver contains Legacy schedule input: " +
        token
    );
  }

  assert.doesNotMatch(
    attendanceResolver,
    /\bweeklyOffDay\s*\??\s*:/,
    "Attendance resolver must not accept a legacy weeklyOffDay input"
  );

  const attendanceCalendar =
    read(
      "src/helpers/hr/attendanceCalendarData.ts"
    );

  for (
    const pattern
    of [
      /profile\.exceptionalLeaveDates/,
      /profile\.onLeave/,
      /profile\.leaveStartDate/,
      /profile\.leaveUntil/,
      /profile_exceptional_leave_date/,
      /source:\s*"profile_leave"/,
    ]
  ) {
    assert.doesNotMatch(
      attendanceCalendar,
      pattern,
      "Attendance calendar must not create operational days from profile mirrors"
    );
  }

  const directory =
    read(
      "src/services/employeeDirectory.ts"
    );

  for (
    const token
    of [
      "customWorkingHours",
      "customWorkingHourOverrides",
      "workingScheduleVersions",
      "exceptionalLeaveWeekdays",
      "exceptionalLeaveDates",
    ]
  ) {
    assert.equal(
      directory.includes(
        token
      ),
      false,
      "Employee Directory still transports scheduling Legacy: " +
        token
    );
  }

  const builderStart =
    directory.indexOf(
      "export function buildPartnerMemberOperationalProfile"
    );

  const builderEnd =
    directory.indexOf(
      "\nexport async function listEmployeeDirectory",
      builderStart
    );

  assert.ok(
    builderStart >= 0 &&
    builderEnd > builderStart
  );

  const partnerProfileBuilder =
    directory.slice(
      builderStart,
      builderEnd
    );

  for (
    const token
    of [
      "showOnBooking",
      "onLeave",
      "leaveUntil",
      "employmentEndDate",
      "customWorkingHours",
      "exceptionalLeave",
    ]
  ) {
    assert.equal(
      partnerProfileBuilder.includes(
        token
      ),
      false,
      "Partner profile builder contains operational Legacy: " +
        token
    );
  }

  const partnerTypes =
    read(
      "src/types/partner.ts"
    );

  const profileStart =
    partnerTypes.indexOf(
      "export type PartnerMemberOperationalProfile"
    );

  const profileEnd =
    partnerTypes.indexOf(
      "\nexport type PartnerAuditFields",
      profileStart
    );

  assert.ok(
    profileStart >= 0 &&
    profileEnd > profileStart
  );

  const profileType =
    partnerTypes.slice(
      profileStart,
      profileEnd
    );

  for (
    const token
    of [
      "showOnBooking",
      "onLeave",
      "leaveUntil",
      "employmentEndDate",
      "useCustomWorkingHours",
      "customWorkingHours",
      "customWorkingHourOverrides",
      "exceptionalLeaveDates",
      "exceptionalLeaveWeekdays",
    ]
  ) {
    assert.equal(
      profileType.includes(
        token
      ),
      false,
      "Partner operational profile type contains Legacy field: " +
        token
    );
  }

  const partnerWorker =
    read(
      "workers/partners-worker.js"
    );

  const normalizeStart =
    partnerWorker.indexOf(
      "function normalizeOperationalProfile"
    );

  const normalizeEnd =
    partnerWorker.indexOf(
      "\nfunction allowedOrigins",
      normalizeStart
    );

  assert.ok(
    normalizeStart >= 0 &&
    normalizeEnd > normalizeStart
  );

  const normalizedProfile =
    partnerWorker.slice(
      normalizeStart,
      normalizeEnd
    );

  for (
    const token
    of [
      "showOnBooking: raw",
      "onLeave: raw",
      "leaveUntil:",
      "employmentEndDate:",
      "useCustomWorkingHours",
      "customWorkingHours",
      "customWorkingHourOverrides",
      "exceptionalLeaveDates",
      "exceptionalLeaveWeekdays",
    ]
  ) {
    assert.equal(
      normalizedProfile.includes(
        token
      ),
      false,
      "Partners Worker normalizer contains Legacy operational field: " +
        token
    );
  }

  const dashboard =
    read(
      "src/pages/DashboardEmployees.tsx"
    );

  const summaryStart =
    dashboard.indexOf(
      "const staffScheduleSummary = useMemo"
    );

  const summaryEnd =
    dashboard.indexOf(
      "\n  const editingStaff = useMemo",
      summaryStart
    );

  assert.ok(
    summaryStart >= 0 &&
    summaryEnd > summaryStart
  );

  const summary =
    dashboard.slice(
      summaryStart,
      summaryEnd
    );

  for (
    const token
    of [
      "exceptionalLeaveDates",
      "(staff as any).onLeave",
      "(staff as any).leaveUntil",
      "(staff as any).employmentEndDate",
      "workingScheduleVersions",
      "(staff as any).customWorkingHours",
      "(staff as any).customWorkingHourOverrides",
      "(staff as any).useCustomWorkingHours",
    ]
  ) {
    assert.equal(
      summary.includes(
        token
      ),
      false,
      "Dashboard schedule summary contains non-Core operational source: " +
        token
    );
  }

  assert.equal(
    dashboard.includes(
      "exceptionalLeaveDates:"
    ),
    false,
    "Dashboard must not preserve/write legacy exceptional leave-date mirrors"
  );

  const firestoreStaff =
    read(
      "src/services/firestoreStaffPublic.ts"
    );

  for (
    const token
    of [
      "customWorkingHours",
      "customWorkingHourOverrides",
      "exceptionalLeaveWeekdays",
      "exceptionalLeaveDates",
      "useCustomWorkingHours",
    ]
  ) {
    assert.equal(
      firestoreStaff.includes(
        token
      ),
      false,
      "Firestore staff DTO still transports schedule Legacy: " +
        token
    );
  }

  const staffRepository =
    read(
      "workers/core/repositories/staff.js"
    );

  assert.doesNotMatch(
    staffRepository,
    /export function staffIsAvailableForDate/
  );

  assert.doesNotMatch(
    staffRepository,
    /Array\.isArray\(row\?\.schedules\)/
  );

  const coreMapper =
    read(
      "src/services/coreBookingMappers.ts"
    );

  assert.doesNotMatch(
    coreMapper,
    /useCustomWorkingHours:\s*false/
  );

  const scripts =
    readdirSync(
      "scripts",
      {
        withFileTypes: true,
      }
    )
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.(?:js|mjs|cjs)$/.test(
            entry.name
          )
      )
      .map(
        (entry) =>
          entry.name
      )
      .filter(
        (name) =>
          !/^(?:migrate|audit|check)-/.test(
            name
          )
      );

  for (
    const name
    of scripts
  ) {
    const source =
      read(
        "scripts/" +
          name
      );

    const firestoreMutation =
      /firestore\.googleapis\.com|firebase\/firestore|print-access-token/.test(
        source
      );

    const scheduleMirror =
      /customWorkingHours|customWorkingHourOverrides|workingScheduleVersions|exceptionalLeaveWeekdays|exceptionalLeaveDates/.test(
        source
      );

    assert.equal(
      firestoreMutation &&
        scheduleMirror,
      false,
      "Operational CLI writes scheduling mirrors to Firestore: scripts/" +
        name
    );
  }
});


test("Stage 2 canonical leave authority never mirrors operational leave into staff", () => {
  const leaves =
    read(
      "workers/core/repositories/leaves.js"
    );

  assert.doesNotMatch(
    leaves,
    /UPDATE staff[\s\S]{0,240}?leave_start_date/
  );

  assert.doesNotMatch(
    leaves,
    /UPDATE staff[\s\S]{0,240}?leave_end_date/
  );

  const staff =
    read(
      "workers/core/repositories/staff.js"
    );

  assert.doesNotMatch(
    staff,
    /leave_start_date\s*:/
  );

  assert.doesNotMatch(
    staff,
    /leave_end_date\s*:/
  );

  const mapper =
    read(
      "src/services/coreBookingMappers.ts"
    );

  assert.doesNotMatch(
    mapper,
    /leave_start_date:\s*"leaveStartDate"/
  );

  assert.doesNotMatch(
    mapper,
    /onLeave:\s*Boolean\(staff\.leaveStartDate/
  );

  const coreHr =
    read(
      "src/services/CoreHrService.ts"
    );

  assert.doesNotMatch(
    coreHr,
    /CORE_STAFF_LEAVE_FIELDS/
  );

  const dashboard =
    read(
      "src/pages/DashboardEmployees.tsx"
    );

  const saveStart = dashboard.indexOf(
    "await CoreHrService.saveEmployee({"
  );
  const saveEnd = dashboard.indexOf(
    "if (workingHourOverridesChanged)",
    saveStart
  );

  assert.ok(
    saveStart >= 0 &&
    saveEnd > saveStart,
    "Dashboard employee master must save through CoreHrService"
  );

  const employeeMasterSave = dashboard.slice(
    saveStart,
    saveEnd
  );

  assert.match(
    employeeMasterSave,
    /\.saveEmployee\(\{/
  );

  assert.match(
    employeeMasterSave,
    /bookingStaff:\s*\{/
  );

  assert.doesNotMatch(
    employeeMasterSave,
    /leaveStartDate\s*:|leaveEndDate\s*:|leaveNote\s*:/
  );

  assert.doesNotMatch(
    employeeMasterSave,
    /CoreStaffService\s*\.\s*(?:create|update|upsert)/,
    "Booking staff synchronization must be part of the canonical Core HR save, not a second frontend write"
  );

  const coreTypes =
    read(
      "src/types/coreApi.ts"
    );

  const coreStaffStart =
    coreTypes.indexOf(
      "export type CoreStaff ="
    );

  const coreStaffEnd =
    coreTypes.indexOf(
      "\nexport type CoreBookingItem",
      coreStaffStart
    );

  assert.ok(
    coreStaffStart >= 0 &&
    coreStaffEnd > coreStaffStart
  );

  const coreStaffType =
    coreTypes.slice(
      coreStaffStart,
      coreStaffEnd
    );

  assert.doesNotMatch(
    coreStaffType,
    /leaveStartDate|leaveEndDate|leaveNote/
  );
});

test("weekly-rest work uses the one canonical effective-shift resolver", () => {
  const shiftCore = read("workers/core/repositories/shift-control.js");
  const attendanceWorker = read("workers/attendance-worker.js");
  const bookingPolicy = read("workers/core/repositories/booking-staff-policy.js");
  const restCompliance = read("workers/core/repositories/rest-holiday-compliance.js");
  const attendanceUi = read("src/pages/dashboardEmployees/AttendanceSection.tsx");
  const attendanceCalendar = read("src/helpers/hr/attendanceCalendarData.ts");
  const attendanceShiftResolver = read("src/helpers/hr/attendanceShiftResolver.ts");

  assert.match(
    shiftCore,
    /employee_weekly_rest_work_assignments/,
    "Canonical Core shift resolver must load weekly-rest work assignments"
  );
  assert.match(
    shiftCore,
    /source:\s*['"]weekly_rest_work_assignment['"]/,
    "Canonical Core shift resolver must expose the weekly-rest work overlay"
  );
  assert.match(
    restCompliance,
    /source === ['"]weekly_rest_work_assignment['"]/,
    "Weekly-rest compliance must preserve the original statutory rest fact"
  );

  assert.equal(
    attendanceWorker.includes("weeklyRestAssignmentAsShift"),
    false,
    "Attendance must not own a second weekly-rest scheduling decision"
  );
  assert.equal(
    bookingPolicy.includes("activeWeeklyRestWorkAssignment"),
    false,
    "Booking must not read weekly-rest work assignments outside the canonical resolver"
  );
  assert.equal(
    bookingPolicy.includes("weeklyRestAssignmentShift"),
    false,
    "Booking must not reconstruct a weekly-rest work shift locally"
  );

  for (const label of [
    "راحة أسبوعية",
    "راحة أسبوعية مؤقتة",
    "يوم راحة استثنائي",
    "عمل استثنائي في يوم الراحة",
  ]) {
    assert.equal(
      attendanceUi.includes(label),
      true,
      "Attendance must expose canonical label: " + label
    );
  }

  assert.equal(
    attendanceUi.includes("راحة / يوم استثنائي"),
    false,
    "Attendance must not merge weekly rest and generic exception into one label"
  );
  assert.equal(
    attendanceCalendar.includes('"weekly_rest_work"'),
    true,
    "Attendance calendar must model weekly-rest work as a distinct operational day"
  );
  assert.equal(
    attendanceShiftResolver.includes('source === "weekly_rest_work_assignment"'),
    true,
    "Attendance shift labels must understand the canonical weekly-rest work source"
  );
});
