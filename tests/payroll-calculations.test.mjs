import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePayrollSnapshot,
  evaluatePayrollSetup,
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

test("salary setup can use work days times daily hours as monthly hours", () => {
  const result = snapshot({
    baseSalaryHalalas: 300000,
    workDays: 30,
    monthlyHours: undefined,
    dailyScheduledHours: 8,
  });
  assert.equal(result.monthlyHours, 240);
  assert.equal(result.dailyRateHalalas, 10000);
  assert.equal(result.hourlyRateHalalas, 1250);
  assert.equal(result.payrollSetupComplete, true);
  assert.equal(result.monthlyHoursSource, "configured_daily_hours");
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
  assert.equal(result.payrollSetupComplete, true);
});

test("enabled overtime uses detected net extra hours and multiplier", () => {
  const result = snapshot({ overtimeEnabled: true, overtimeMultiplier: 1.5 });
  assert.equal(result.financialOvertimeHours, 2);
  assert.equal(result.overtimeValueHalalas, Math.round(2 * result.hourlyRateHalalas * 1.5));
});

test("enabled overtime falls back to multiplier 1.5 when not configured", () => {
  const result = snapshot({ overtimeEnabled: true, overtimeMultiplier: undefined });
  assert.equal(result.overtimeMultiplier, 1.5);
  assert.equal(result.overtimeValueHalalas, Math.round(2 * result.hourlyRateHalalas * 1.5));
});

test("approved payroll keeps its snapshot after a later base salary change", () => {
  const approved = { ...snapshot(), status: "approved" };
  const recalculated = snapshot({ baseSalaryHalalas: 650000 });
  const selected = preserveLockedPayrollSnapshot(approved, recalculated);
  assert.equal(selected.baseSalaryHalalas, 550000);
  assert.equal(selected.dailyRateHalalas, 18333);
});

test("missing base salary marks payroll setup incomplete", () => {
  const result = snapshot({ baseSalaryHalalas: undefined });
  assert.equal(result.payrollSetupComplete, false);
  assert.ok(result.payrollSetupMissing.includes("baseSalary"));
});

test("monthly hours are not inferred from attendance summary", () => {
  const result = snapshot({ monthlyHours: undefined, dailyScheduledHours: undefined });
  assert.equal(result.monthlyHours, 0);
  assert.equal(result.hourlyRateHalalas, 0);
  assert.equal(result.payrollSetupComplete, false);
  assert.ok(result.payrollSetupMissing.includes("monthlyHours"));
});

test("configured daily hours can complete setup without monthlyHours", () => {
  const result = snapshot({ monthlyHours: undefined, dailyScheduledHours: 8 });
  assert.equal(result.monthlyHours, 240);
  assert.equal(result.payrollSetupComplete, true);
  assert.equal(result.monthlyHoursSource, "configured_daily_hours");
  assert.equal(result.hourlyRateHalalas, Math.round(result.baseSalaryHalalas / 240));
});

test("enabled overtime is ignored when payroll setup is incomplete", () => {
  const result = snapshot({
    baseSalaryHalalas: 0,
    overtimeEnabled: true,
    overtimeMultiplier: 1.5,
  });
  assert.equal(result.payrollSetupComplete, false);
  assert.equal(result.overtimeEnabled, false);
  assert.equal(result.financialOvertimeHours, 0);
  assert.equal(result.overtimeValueHalalas, 0);
});

test("setup evaluator reports core missing salary settings", () => {
  const setup = evaluatePayrollSetup({
    employeeId: "emp-1",
    baseSalaryHalalas: 0,
    workDays: 0,
    monthlyHours: 0,
    overtimeMultiplier: 1.5,
  });
  assert.deepEqual(setup.missing, ["baseSalary", "workDays", "monthlyHours"]);
  assert.equal(setup.complete, false);
});

test("setup evaluator does not require overtime multiplier when salary setup is complete", () => {
  const setup = evaluatePayrollSetup({
    employeeId: "emp-1",
    baseSalaryHalalas: 300000,
    workDays: 30,
    monthlyHours: 240,
    overtimeMultiplier: undefined,
  });
  assert.deepEqual(setup.missing, []);
  assert.equal(setup.complete, true);
});
