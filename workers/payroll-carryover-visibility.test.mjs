import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expectedPayrollNetFromDisplayedLines } from "../src/helpers/hr/payrollCarryoverReconciliation.js";

test("positive September adjustment of SAR 611 reconciles Sabah October payroll", () => {
  assert.equal(expectedPayrollNetFromDisplayedLines({
    base: 240000, allowances: 60000, signedCarryover: 61100,
    totalDeductions: 26438, carryoverDeductions: 0,
  }), 334662);
});

test("negative carryover included in total deductions is never double counted", () => {
  assert.equal(expectedPayrollNetFromDisplayedLines({
    base: 240000, signedCarryover: -61100,
    totalDeductions: 71100, carryoverDeductions: 61100,
  }), 168900);
});

test("zero carryovers and unpaid deficit reconcile as expected", () => {
  assert.equal(expectedPayrollNetFromDisplayedLines({
    base: 10000, totalDeductions: 25000,
  }), 0);
  assert.equal(expectedPayrollNetFromDisplayedLines({
    base: 240000, allowances: 60000, totalDeductions: 26438,
  }), 273562);
});

test("payroll page exposes signed carryover in summary and employee rows", () => {
  const page = readFileSync(new URL("../src/pages/DashboardPayroll.tsx", import.meta.url), "utf8");
  assert.match(page, /acc\.carryover \+= payrollEntryCarryoverNetHalalas\(entry\)/);
  assert.match(page, /carryoverDeductions: carryoverDeductionHalalas\(entry\)/);
  assert.match(page, /<th>تسويات فترات سابقة<\/th>/);
  assert.match(page, /تسويات فترات سابقة \(صافي\)/);
  assert.match(page, /netReconciliationDifference/);
  assert.match(page, /تعذر مطابقة صافي المسيرة/);
});

test("employee-level reconciliation preserves independent zero-floor", () => {
  const employees = [
    { base: 10000, totalDeductions: 25000 },
    { base: 240000, totalDeductions: 0 },
  ];

  const expectedTotal = employees.reduce(
    (sum, employee) =>
      sum + expectedPayrollNetFromDisplayedLines(employee),
    0
  );

  assert.equal(expectedTotal, 240000);

  const incorrectlyAggregated = expectedPayrollNetFromDisplayedLines({
    base: 250000,
    totalDeductions: 25000,
  });

  assert.equal(incorrectlyAggregated, 225000);
  assert.notEqual(expectedTotal, incorrectlyAggregated);

  const page = readFileSync(
    new URL("../src/pages/DashboardPayroll.tsx", import.meta.url),
    "utf8"
  );

  assert.match(
    page,
    /visibleEntries\s*\.filter\(\(entry\) => entry\.payrollSetupComplete\)/
  );
});