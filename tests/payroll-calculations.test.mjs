import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePayrollSnapshot,
  preserveLockedPayrollSnapshot,
} from "../src/helpers/hr/payrollCalculations.ts";

const attendanceSummary = {
  totalScheduledHours: 208,
  totalActualWorkedHours: 207,
  totalLateHours: 1,
  totalCompensatedLateHours: 0,
  totalMissingHours: 1,
  totalExtraHours: 2,
  attendanceDays: 25,
  absentDays: 0,
  incompleteDays: 0,
};

function snapshot(overrides = {}) {
  return calculatePayrollSnapshot({
    employeeId: "emp-1",
    employeeName: "Employee 1",
    payrollMonth: "2026-07",
    baseSalaryHalalas: 550000,
    workDays: 30,
    monthlyHours: 208,
    dailyScheduledHours: 8,
    attendanceSummary,
    ...overrides,
  });
}

test("daily rate respects the entered workDays value", () => {
  const result = snapshot();
  assert.equal(result.dailyRateHalalas, 18333);
  assert.ok(Math.abs(result.dailyRateHalalas / 100 - 183.333) < 0.01);
});

test("hourly rate uses monthlyHours when present", () => {
  const result = snapshot();
  assert.equal(result.hourlyRateHalalas, 2644);
  assert.ok(Math.abs(result.hourlyRateHalalas / 100 - 26.442) < 0.01);
});

test("one missing hour deducts one hourly rate", () => {
  const result = snapshot();
  assert.equal(result.missingHoursDeductionHalalas, result.hourlyRateHalalas);
});

test("detected extra hours do not become financial overtime by default", () => {
  const result = snapshot({ overtimeEnabled: false });
  assert.equal(result.detectedExtraHours, 2);
  assert.equal(result.financialOvertimeHours, 0);
  assert.equal(result.overtimeValueHalalas, 0);
});

test("enabled overtime uses detected net extra hours and multiplier", () => {
  const result = snapshot({ overtimeEnabled: true, overtimeMultiplier: 1.5 });
  assert.equal(result.financialOvertimeHours, 2);
  assert.equal(result.overtimeValueHalalas, Math.round(2 * result.hourlyRateHalalas * 1.5));
});

test("approved payroll keeps its snapshot after a later base salary change", () => {
  const approved = { ...snapshot(), status: "approved" };
  const recalculated = snapshot({ baseSalaryHalalas: 650000 });
  const selected = preserveLockedPayrollSnapshot(approved, recalculated);
  assert.equal(selected.baseSalaryHalalas, 550000);
  assert.equal(selected.dailyRateHalalas, 18333);
});
