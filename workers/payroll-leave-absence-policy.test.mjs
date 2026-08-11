import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  filterPaidPermissionIntervals,
  fullDayPaidLeaveDates,
  mergePayrollDayUnits,
  payrollAbsenceDayUnits,
  payrollLeaveDayUnits,
  totalPayrollDayUnits,
} from "../src/helpers/hr/payrollLeaveAbsencePolicy.ts";
import { calculatePayrollSnapshot } from "../src/helpers/hr/payrollCalculations.ts";

const rangeStart = "2026-07-01";
const rangeEnd = "2026-07-31";

function leave(overrides = {}) {
  return {
    status: "approved",
    leaveType: "annual",
    startDate: "2026-07-07",
    endDate: "2026-07-07",
    daysCount: 1,
    durationKind: "full_day",
    ...overrides,
  };
}

test("half-day absence remains 0.5 payroll day", () => {
  const units = payrollAbsenceDayUnits([
    { dateKey: "2026-07-07", absenceType: "half_day" },
  ], rangeStart, rangeEnd);

  assert.equal(units.get("2026-07-07"), 0.5);
  assert.equal(totalPayrollDayUnits(units), 0.5);
});

test("paid partial leave counts fractionally but never closes the whole attendance day", () => {
  const partial = leave({
    durationKind: "partial",
    partialStartTime: "19:00",
    partialEndTime: "23:00",
    daysCount: 0.5,
  });

  const units = payrollLeaveDayUnits([partial], rangeStart, rangeEnd, "paid");
  const fullDayDates = fullDayPaidLeaveDates([partial], rangeStart, rangeEnd);

  assert.equal(units.get("2026-07-07"), 0.5);
  assert.equal(fullDayDates.has("2026-07-07"), false);
});

test("full-day paid leave still closes only its exact approved dates", () => {
  const full = leave({ startDate: "2026-07-07", endDate: "2026-07-08", daysCount: 2 });
  const dates = fullDayPaidLeaveDates([full], rangeStart, rangeEnd);

  assert.deepEqual([...dates], ["2026-07-07", "2026-07-08"]);
});

test("unpaid partial leave permission interval is excluded from paid permission coverage", () => {
  const unpaidPartial = leave({
    leaveType: "unpaid",
    durationKind: "partial",
    partialStartTime: "19:00",
    partialEndTime: "23:00",
    daysCount: 0.5,
  });
  const intervals = [
    {
      id: "leave-permission",
      startAt: "2026-07-07T16:00:00.000Z",
      endAt: "2026-07-07T20:00:00.000Z",
    },
    {
      id: "real-paid-permission",
      startAt: "2026-07-07T13:00:00.000Z",
      endAt: "2026-07-07T14:00:00.000Z",
    },
  ];

  const filtered = filterPaidPermissionIntervals(intervals, [unpaidPartial], "2026-07-07");
  assert.deepEqual(filtered.map((item) => item.id), ["real-paid-permission"]);
});

test("overlapping absence sources on one date do not exceed one payroll day", () => {
  const halfDay = payrollAbsenceDayUnits([
    { dateKey: "2026-07-07", absenceType: "half_day" },
  ], rangeStart, rangeEnd);
  const unpaid = payrollLeaveDayUnits([
    leave({ leaveType: "unpaid", daysCount: 1 }),
  ], rangeStart, rangeEnd, "unpaid");

  const merged = mergePayrollDayUnits(halfDay, unpaid);
  assert.equal(merged.get("2026-07-07"), 1);
});

test("explicit overlap hours prevent double deduction for a partial unpaid leave", () => {
  const result = calculatePayrollSnapshot({
    employeeId: "emp-1",
    employeeName: "موظفة اختبار",
    payrollMonth: "2026-07",
    baseSalaryHalalas: 300000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyScheduledHours: 8,
    attendanceSummary: {
      totalScheduledHours: 240,
      totalActualWorkedHours: 236,
      totalLateHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 4,
      totalExtraHours: 0,
      attendanceDays: 30,
      absentDays: 0,
      incompleteDays: 0,
      approvedLeaveDays: 0,
      approvedAbsenceDays: 0.5,
      absenceDeductionOverlapHours: 4,
      attendanceRecordCount: 10,
      attendanceLinkStatus: "confirmed",
      attendanceDeductionEligible: true,
    },
  });

  assert.equal(result.absenceDeductionHalalas, 5000);
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.totalDeductionsHalalas, 5000);
});

test("missing hours outside a partial unpaid leave are still deducted", () => {
  const result = calculatePayrollSnapshot({
    employeeId: "emp-1",
    employeeName: "موظفة اختبار",
    payrollMonth: "2026-07",
    baseSalaryHalalas: 300000,
    allowancesHalalas: 0,
    workDays: 30,
    monthlyHours: 240,
    dailyScheduledHours: 8,
    attendanceSummary: {
      totalScheduledHours: 240,
      totalActualWorkedHours: 232,
      totalLateHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 8,
      totalExtraHours: 0,
      attendanceDays: 30,
      absentDays: 0,
      incompleteDays: 0,
      approvedLeaveDays: 0,
      approvedAbsenceDays: 0.5,
      absenceDeductionOverlapHours: 4,
      attendanceRecordCount: 10,
      attendanceLinkStatus: "confirmed",
      attendanceDeductionEligible: true,
    },
  });

  assert.equal(result.absenceDeductionHalalas, 5000);
  assert.equal(result.missingHoursDeductionHalalas, 5000);
  assert.equal(result.totalDeductionsHalalas, 10000);
});

test("payroll payload persists the calculated absence deduction instead of zeroing it", () => {
  const source = readFileSync(new URL("../src/services/CorePayrollService.ts", import.meta.url), "utf8");
  assert.match(source, /absenceDeductionHalalas:\s*entry\.absenceDeductionHalalas/);
  assert.doesNotMatch(source, /absenceDeductionHalalas:\s*0,/);
});
