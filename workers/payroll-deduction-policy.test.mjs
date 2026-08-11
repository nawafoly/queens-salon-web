import assert from "node:assert/strict";
import { test } from "node:test";

import { calculatePayrollSnapshot } from "../src/helpers/hr/payrollCalculations.ts";

function baseAttendance(overrides = {}) {
  return {
    totalScheduledHours: 240,
    totalActualWorkedHours: 232,
    totalLateHours: 0,
    totalCompensatedLateHours: 0,
    totalMissingHours: 8,
    totalExtraHours: 0,
    attendanceDays: 29,
    absentDays: 1,
    incompleteDays: 0,
    approvedLeaveDays: 0,
    approvedAbsenceDays: 1,
    attendanceRecordCount: 10,
    attendanceLinkStatus: "confirmed",
    attendanceDeductionEligible: true,
    ...overrides,
  };
}

function snapshot(attendanceSummary) {
  return calculatePayrollSnapshot({
    employeeId: "emp-1",
    employeeName: "موظفة اختبار",
    payrollMonth: "2026-08",
    baseSalaryHalalas: 300000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyScheduledHours: 8,
    attendanceSummary,
  });
}

test("a full-day approved absence is deducted once, not again as missing hours", () => {
  const result = snapshot(baseAttendance());

  assert.equal(result.dailyRateHalalas, 10000);
  assert.equal(result.hourlyRateHalalas, 1250);
  assert.equal(result.absenceDeductionHalalas, 10000);
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.totalDeductionsHalalas, 10000);
});

test("missing hours beyond a full-day absence are still deducted by the hour", () => {
  const result = snapshot(baseAttendance({ totalMissingHours: 10 }));

  assert.equal(result.absenceDeductionHalalas, 10000);
  assert.equal(result.missingHoursDeductionHalalas, 2500);
  assert.equal(result.totalDeductionsHalalas, 12500);
});

test("a half-day approved absence excludes only half a scheduled day from hourly deduction", () => {
  const result = snapshot(baseAttendance({
    totalMissingHours: 5,
    approvedAbsenceDays: 0.5,
  }));

  assert.equal(result.absenceDeductionHalalas, 5000);
  assert.equal(result.missingHoursDeductionHalalas, 1250);
  assert.equal(result.totalDeductionsHalalas, 6250);
});

test("paid leave does not create an absence deduction", () => {
  const result = snapshot(baseAttendance({
    totalActualWorkedHours: 232,
    totalMissingHours: 0,
    absentDays: 0,
    approvedLeaveDays: 1,
    approvedAbsenceDays: 0,
  }));

  assert.equal(result.absenceDeductionHalalas, 0);
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.totalDeductionsHalalas, 0);
});
