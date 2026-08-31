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
  assert.match(panel, /label="المكتسب حتى اليوم"/);
  assert.match(panel, /label="الرصيد الافتتاحي"/);
  assert.match(panel, /label="المستخدم"/);
  assert.match(panel, /label="المعاد\/المسترجع"/);
  assert.match(panel, /label="الرصيد المتاح"/);
  assert.match(panel, /label="بداية سنة الخدمة"/);
  assert.match(panel, /label="نهاية سنة الخدمة"/);
});

test("reviewRequired annual balance shows Arabic reason instead of misleading balance", () => {
  const panel = source("../src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx");

  assert.match(panel, /function annualReviewReasonLabel/);
  assert.match(panel, /service_start_date_required[\s\S]*تاريخ بداية الخدمة غير محدد/);
  assert.match(panel, /service_start_date_invalid[\s\S]*تاريخ بداية الخدمة غير صالح/);
  assert.match(panel, /opening_balance_required[\s\S]*يحتاج رصيدًا افتتاحيًا قبل اعتماده/);
  assert.match(panel, /as_of_before_service_start[\s\S]*تاريخ الحساب قبل بداية الخدمة/);
  assert.match(panel, /annualBalanceValue[\s\S]*if \(reviewRequired\) return "يحتاج مراجعة"/);
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
