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

test("weekly rest assignment time is 12-hour for users and canonical for Core", () => {
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");
  const timePicker = source("../src/components/dashboard-v2/DashboardTimePickerV2.tsx");

  assert.equal((panel.match(/clock="12h"/g) || []).length, 2);
  assert.match(panel, /formatTime12Hour\(assignment\.startTime\)/);
  assert.match(panel, /formatTime12Hour\(assignment\.endTime\)/);
  assert.match(timePicker, /clock\?: "24h" \| "12h"/);
  assert.match(timePicker, /function to24HourTime/);
  assert.match(timePicker, /period === "pm"/);
  assert.match(timePicker, /<option value="am">ص<\/option>/);
  assert.match(timePicker, /<option value="pm">م<\/option>/);
  assert.match(timePicker, /editing12Ref\.current/);
  assert.match(timePicker, /normalizeTimeTyping\(nextDraft, "12h"\)/);
  assert.match(timePicker, /digits\.length === 3/);
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

test("annual leave balance UI renders canonical Core balance components", () => {
  const service = source("../src/services/CoreHrService.ts");
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  for (const field of [
    "annualEntitlementDays",
    "earnedCurrentServiceYearDays",
    "openingBalanceDays",
    "usedDays",
    "reversedDays",
    "availableDays",
    "serviceYearStart",
    "serviceYearEnd",
  ]) {
    assert.match(service, new RegExp(`${field}\\?`));
    assert.match(panel, new RegExp(`annualLeave\\.${field}`));
  }

  assert.match(panel, /label="الاستحقاق السنوي"/);
  assert.match(panel, /const annualAccruedLabel/);
  assert.match(panel, /function annualDurationLabel/);
  assert.match(panel, /Math\.floor\(Math\.abs\(number\) \* 24\)/);
  assert.match(panel, /label=\{annualAccruedLabel\}/);
  assert.match(panel, /annualBalanceValue\([\s\S]*earnedCurrentServiceYearDays/);
  assert.match(panel, /annualBalanceValue[\s\S]*annualDurationLabel/);
  assert.match(panel, /label="الرصيد الافتتاحي"/);
  assert.match(panel, /label="المستخدم"/);
  assert.match(panel, /label="المعاد\/المسترجع"/);
  assert.match(panel, /label="الرصيد المتاح"/);
  assert.match(panel, /label="تاريخ مباشرة العمل"/);
  assert.match(panel, /label="سنة الخدمة الحالية"/);
  assert.match(panel, /previousIsoDate\(annualLeave\.serviceYearEnd\)/);
  assert.match(panel, /label="تاريخ إكمال سنة خدمة"/);
  assert.doesNotMatch(panel, /label="نهاية سنة الخدمة"/);
});

test("reviewRequired annual balance shows Arabic reason instead of misleading balance", () => {
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(panel, /function annualReviewReasonLabel/);
  assert.match(panel, /service_start_date_required[\s\S]*تاريخ بداية الخدمة غير محدد/);
  assert.match(panel, /service_start_date_invalid[\s\S]*تاريخ بداية الخدمة غير صالح/);
  assert.match(panel, /opening_balance_required[\s\S]*يحتاج رصيدًا افتتاحيًا قبل اعتماده/);
  assert.match(panel, /as_of_before_service_start[\s\S]*تاريخ الحساب قبل بداية الخدمة/);
  assert.match(panel, /function annualBalanceValue/);
  assert.match(panel, /annualBalanceValue[\s\S]*if \(reviewRequired\)/);
  assert.match(panel, /annualBalanceValue[\s\S]*annualDurationLabel\(value\)/);
  assert.match(panel, /title="الرصيد يحتاج مراجعة"/);
  assert.doesNotMatch(panel, /reviewRequired[\s\S]{0,120}numberLabel\(\s*annualLeave\.availableDays/);
});

test("annual recall UI is blocked without an approved annual leave covering the date", () => {
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(panel, /function leaveCoversDate/);
  assert.match(panel, /clean\(leave\.status\)\.toLowerCase\(\) === "approved"/);
  assert.match(panel, /clean\(leave\.leaveType\)\.toLowerCase\(\) === "annual"/);
  assert.match(panel, /clean\(leave\.durationKind\)\.toLowerCase\(\) !== "partial"/);
  assert.match(panel, /clean\(leave\.startDate\) <= date/);
  assert.match(panel, /clean\(leave\.endDate\) >= date/);
  assert.match(panel, /!\s*recallLeave[\s\S]*setMessage/);
  assert.match(panel, /disabled=\{[\s\S]*!\s*recallLeave[\s\S]*\}/);
  assert.match(panel, /CoreHrService\.createAnnualLeaveRecall\(\s*recallLeave\.id/);
});

test("Core annual recall remains blocked outside the approved leave range", () => {
  const workflow = source("../workers/core/repositories/leave-rest-workflows.js");

  assert.match(workflow, /cleanText\(leave\.leave_type\)\.toLowerCase\(\) !== 'annual'/);
  assert.match(workflow, /cleanText\(leave\.status\)\.toLowerCase\(\) !== 'approved'/);
  assert.match(workflow, /cleanText\(leave\.duration_kind\)\.toLowerCase\(\) === 'partial'/);
  assert.match(workflow, /recallDate < cleanText\(leave\.start_date\) \|\| recallDate > cleanText\(leave\.end_date\)/);
  assert.match(workflow, /future_recall_not_supported/);
});
test("annual leave service start keeps Core as the single source of truth", () => {
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(
    panel,
    /employment\.start_date\s*\?\?\s*employment\.startDate/
  );

  assert.match(
    panel,
    /employment\.social_insurance_effective_from\s*\?\?\s*employment\.socialInsuranceEffectiveFrom/
  );

  assert.match(
    panel,
    /persistedStartDate\s*\|\|\s*insuranceDate/
  );

  assert.match(
    panel,
    /CoreHrService\.saveEmployee\(\{[\s\S]*employment:\s*\{[\s\S]*startDate:\s*serviceStartDate/
  );

  assert.match(
    panel,
    /مقترح من تاريخ سريان التصنيف — غير محفوظ/
  );

  assert.match(
    panel,
    /مطابق لتاريخ سريان التصنيف/
  );

  assert.doesNotMatch(
    panel,
    /calculateAnnualLeaveAccrual/
  );

  assert.doesNotMatch(
    panel,
    /\b21\s*(?:يوم|days?)\b|\b30\s*(?:يوم|days?)\b/
  );
});

test("annual leave opening balance uses the canonical audited Core path", () => {
  const service = source("../src/services/CoreHrService.ts");
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");
  const core = source("../workers/core/index.js");

  assert.match(
    service,
    /leave-balance\/opening-balance/
  );

  assert.match(
    core,
    /hr-employee:annual-leave-opening-balance/
  );

  assert.match(
    core,
    /setAnnualLeaveOpeningBalance/
  );

  assert.match(
    core,
    /attendance\.leaves\.manage/
  );

  assert.match(
    panel,
    /CoreHrService[\s\S]*\.setAnnualLeaveOpeningBalance/
  );

  assert.match(
    panel,
    /Boolean\(\s*annualLeave\.openingBalance\s*\)/
  );

  assert.match(
    panel,
    /openingBalanceOperationIdRef/
  );

  assert.match(
    panel,
    /crypto\.randomUUID\(\)/
  );

  assert.doesNotMatch(
    panel,
    /Date\.now\(\)/
  );

  assert.match(
    panel,
    /label="الرصيد المتبقي المعتمد"/
  );

  assert.match(
    panel,
    /إذا كان السجل السابق غير مكتمل فلا تخمّن الرصيد/
  );

  assert.match(
    panel,
    /إذا لم تعرف ما تم استخدامه سابقًا فلا تدخل رقمًا تقديريًا/
  );

  assert.match(
    panel,
    /اعتماد الرصيد المتبقي/
  );
});

test("historical weekly-rest opening balance has a dedicated guarded Core path", () => {
  const core = source("../workers/core/index.js");
  const workflow = source(
    "../workers/core/repositories/weekly-rest-entitlements.js"
  );

  assert.ok(
    core.includes("weekly-rest\\/opening-balance")
  );

  assert.ok(
    core.includes('name: "weekly-rest:opening-balance"')
  );

  const caseStart = core.indexOf(
    'case "weekly-rest:opening-balance":'
  );

  assert.notEqual(caseStart, -1);

  const nextCase = core.indexOf(
    '\n    case "',
    caseStart + 10
  );

  const block = core.slice(
    caseStart,
    nextCase === -1 ? undefined : nextCase
  );

  assert.match(
    block,
    /requireRole\(ctx\.role, HR_MANAGEMENT_ROLES\)/
  );

  assert.match(
    block,
    /attendance\.leaves\.manage/
  );

  assert.match(
    block,
    /setHistoricalWeeklyRestOpeningBalance/
  );

  assert.match(
    workflow,
    /HISTORICAL_OPENING_SOURCE_TYPE = 'historical_opening_balance'/
  );

  assert.match(
    workflow,
    /entitlementType: 'weekly_rest_due'/
  );

  assert.match(
    workflow,
    /historical-weekly-rest-opening/
  );

  assert.doesNotMatch(
    workflow,
    /data\.sourceReference|data\.source_reference|data\.migrationReference|data\.migration_reference/
  );

  assert.doesNotMatch(
    workflow,
    /entitlementType:\s*['"]annual/
  );
});


test("historical weekly-rest opening projection is exposed through CoreHrService", () => {
  const service = source(
    "../src/services/CoreHrService.ts"
  );
  const workflow = source(
    "../workers/core/repositories/leave-rest-workflows.js"
  );

  assert.match(
    workflow,
    /historicalOpening/
  );

  assert.match(
    workflow,
    /source_type = 'historical_opening_balance'/
  );

  assert.match(
    service,
    /historicalOpeningRaw/
  );

  assert.match(
    service,
    /setHistoricalWeeklyRestOpeningBalance/
  );

  assert.match(
    service,
    /weekly-rest\/opening-balance/
  );
});


test("historical weekly-rest opening UI uses the canonical Core contract", () => {
  const panel = source(
    "../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx"
  );

  assert.match(
    panel,
    /weeklyRest\.historicalOpening/
  );

  assert.match(
    panel,
    /submitHistoricalWeeklyRestOpening/
  );

  assert.match(
    panel,
    /setHistoricalWeeklyRestOpeningBalance/
  );

  assert.doesNotMatch(
    panel,
    /weeklyRestOpeningSourceReference/
  );

  assert.doesNotMatch(
    panel,
    /label="مرجع الرصيد"/
  );

  assert.doesNotMatch(
    panel,
    /coreApiRequest/
  );

  assert.doesNotMatch(
    panel,
    /firebase|firestore|collection\(|doc\(/
  );
});
test("annual leave manual adjustment stays behind the canonical Core contract", () => {
  const service = source("../src/services/CoreHrService.ts");
  const core = source("../workers/core/index.js");
  const annual = source(
    "../workers/core/repositories/annual-leave.js"
  );

  assert.match(
    service,
    /async adjustAnnualLeaveBalance/
  );

  assert.match(
    service,
    /annual-leave\/adjustments/
  );

  assert.match(
    core,
    /name: "hr-employee:annual-leave-adjustment"/
  );

  assert.match(
    core,
    /case "hr-employee:annual-leave-adjustment"[\s\S]*requirePermission\([\s\S]*"attendance\.leaves\.manage"/
  );

  assert.match(
    core,
    /case "hr-employee:annual-leave-adjustment"[\s\S]*adjustAnnualLeaveBalance\(/
  );

  assert.match(
    annual,
    /export async function adjustAnnualLeaveBalance/
  );

  assert.match(
    annual,
    /entry_code = 'MANUAL_CORRECTION'/
  );

  assert.match(
    annual,
    /source_type = 'manual_adjustment'/
  );

  const adjustmentMethod = service.match(
    /async adjustAnnualLeaveBalance\([\s\S]*?\n  \},/
  );

  assert.ok(
    adjustmentMethod,
    "adjustAnnualLeaveBalance service method must exist"
  );

  assert.doesNotMatch(
    adjustmentMethod[0],
    /leave-balance\/adjustments/
  );
});
test("weekly-rest manual adjustment stays behind the canonical Core contract", () => {
  const service = source("../src/services/CoreHrService.ts");
  const core = source("../workers/core/index.js");
  const entitlement = source("../workers/core/repositories/weekly-rest-entitlements.js");

  assert.match(
    service,
    /weekly-rest\/adjustments/
  );

  assert.match(
    service,
    /async adjustWeeklyRestBalance/
  );

  assert.match(
    core,
    /name: "weekly-rest:adjustment"/
  );

  assert.match(
    core,
    /case "weekly-rest:adjustment"[\s\S]*requirePermission\([\s\S]*"attendance\.leaves\.manage"/
  );

  assert.match(
    core,
    /case "weekly-rest:adjustment"[\s\S]*adjustWeeklyRestDue\(/
  );

  assert.match(
    entitlement,
    /export async function adjustWeeklyRestDue/
  );

  assert.match(
    entitlement,
    /entitlementType: 'weekly_rest_due'/
  );

  assert.match(
    entitlement,
    /sourceType: 'manual_adjustment'/
  );

  assert.match(
    entitlement,
    /minutes: days \* WEEKLY_REST_MINUTES/
  );

  assert.doesNotMatch(
    service,
    /weekly-rest\/opening-balance[\s\S]{0,120}adjustWeeklyRestBalance/
  );
});
test("weekly-rest adjustment UI is wired to the canonical service", () => {
  const panel = source(
    "../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx"
  );

  assert.match(
    panel,
    /const submitWeeklyRestAdjustment =/
  );

  assert.match(
    panel,
    /adjustWeeklyRestBalance\(/
  );

  assert.match(
    panel,
    /weeklyRestAdjustmentAction/
  );

  assert.match(
    panel,
    /weeklyRestAdjustmentDays/
  );

  assert.match(
    panel,
    /weeklyRestAdjustmentEffectiveDate/
  );

  assert.match(
    panel,
    /weeklyRestAdjustmentReason/
  );

  assert.match(
    panel,
    /employee-live-v2-weekly-rest-adjustment-action/
  );

  assert.match(
    panel,
    /employee-live-v2-weekly-rest-adjustment-days/
  );

  assert.doesNotMatch(
    panel,
    /submitWeeklyRestAdjustment[\s\S]{0,1800}setHistoricalWeeklyRestOpeningBalance/
  );

  assert.doesNotMatch(
    panel,
    /submitWeeklyRestAdjustment[\s\S]{0,1800}firebase|submitWeeklyRestAdjustment[\s\S]{0,1800}firestore/
  );
});
test("annual leave adjustment UI is wired to the canonical service", () => {
  const panel = source(
    "../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx"
  );

  assert.match(
    panel,
    /const submitAnnualLeaveAdjustment =/
  );

  assert.match(
    panel,
    /adjustAnnualLeaveBalance\(/
  );

  assert.match(
    panel,
    /annualAdjustmentAction/
  );

  assert.match(
    panel,
    /annualAdjustmentDays/
  );

  assert.match(
    panel,
    /annualAdjustmentEffectiveDate/
  );

  assert.match(
    panel,
    /annualAdjustmentReason/
  );

  assert.match(
    panel,
    /Math\.round\(days \* 2\) !== days \* 2/
  );

  assert.match(
    panel,
    /if \(annualReviewRequired\)/
  );

  assert.match(
    panel,
    /employee-live-v2-annual-adjustment-action/
  );

  assert.match(
    panel,
    /employee-live-v2-annual-adjustment-days/
  );

  assert.doesNotMatch(
    panel,
    /submitAnnualLeaveAdjustment[\s\S]{0,2200}adjustLeaveBalance\(/
  );

  const annualAdjustmentIndex = panel.indexOf(
    'employee-live-v2-annual-adjustment-action'
  );
  const openingBalanceIndex = panel.indexOf(
    'employee-live-v2-opening-balance-days'
  );
  const weeklyRestAdjustmentIndex = panel.indexOf(
    'employee-live-v2-weekly-rest-adjustment-action'
  );

  assert.ok(annualAdjustmentIndex >= 0);
  assert.ok(openingBalanceIndex >= 0);
  assert.ok(weeklyRestAdjustmentIndex >= 0);

  assert.ok(
    annualAdjustmentIndex < openingBalanceIndex
  );

  assert.ok(
    annualAdjustmentIndex < weeklyRestAdjustmentIndex
  );
});
