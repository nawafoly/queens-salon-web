import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  SA_LABOR_POLICY_VERSION,
  SA_LABOR_LIMITS,
  SA_SPECIAL_LEAVE_ENTITLEMENTS,
  calculateFixedActualWageHalalas,
  calculateMonthlyDailyWageHalalas,
  calculateStatutoryHourlyRates,
  calculateStatutoryOvertimeHalalas,
  calculateCompensatoryLeaveMinutes,
  annualLeaveMinimumDays,
  sickLeavePayBps,
  generalDeductionCapHalalas,
  employerLoanDeductionCapHalalas,
  courtOrderDefaultDeductionCapHalalas,
  weeklyRestCashSubstitutionAllowed,
  annualLeaveCashSubstitutionDuringServiceAllowed,
} from "../src/helpers/hr/saLaborPolicy.js";

test("Aida fixed actual wage is basic plus fixed allowances", () => {
  const input = {
    baseSalaryHalalas: 250000,
    housingAllowanceHalalas: 10000,
    transportationAllowanceHalalas: 10000,
  };

  assert.equal(
    calculateFixedActualWageHalalas(input),
    270000
  );

  assert.equal(
    calculateMonthlyDailyWageHalalas(input),
    9000
  );
});

test("statutory overtime uses actual hourly wage plus 50 percent of basic hourly wage", () => {
  const result = calculateStatutoryOvertimeHalalas({
    baseSalaryHalalas: 250000,
    housingAllowanceHalalas: 10000,
    transportationAllowanceHalalas: 10000,
    dailyNormalHours: 8,
    overtimeMinutes: 60,
  });

  assert.equal(result.reviewRequired, false);
  assert.equal(result.actualHourlyHalalas, 1125);
  assert.equal(result.basicHourlyHalalas, 1042);
  assert.equal(result.overtimeHourlyHalalas, 1646);
  assert.equal(result.amountHalalas, 1646);
});

test("missing daily hours fails closed for overtime", () => {
  const result = calculateStatutoryHourlyRates({
    baseSalaryHalalas: 250000,
    housingAllowanceHalalas: 10000,
  });

  assert.equal(result.reviewRequired, true);
  assert.equal(
    result.reason,
    "daily_normal_hours_required"
  );
});

test("compensatory leave never drops below one and a half hours per overtime hour", () => {
  assert.equal(
    calculateCompensatoryLeaveMinutes(60),
    90
  );

  assert.equal(
    calculateCompensatoryLeaveMinutes(60, 1),
    90
  );

  assert.equal(
    calculateCompensatoryLeaveMinutes(120, 2),
    240
  );
});

test("annual leave statutory minimum changes after five years", () => {
  assert.equal(annualLeaveMinimumDays(0), 21);
  assert.equal(annualLeaveMinimumDays(4.99), 21);
  assert.equal(annualLeaveMinimumDays(5), 30);
});

test("sick leave pay bands are 30 full, 60 at 75 percent, then 30 unpaid", () => {
  assert.equal(sickLeavePayBps(1), 10000);
  assert.equal(sickLeavePayBps(30), 10000);
  assert.equal(sickLeavePayBps(31), 7500);
  assert.equal(sickLeavePayBps(90), 7500);
  assert.equal(sickLeavePayBps(91), 0);
  assert.equal(sickLeavePayBps(120), 0);
  assert.equal(sickLeavePayBps(121), null);
});

test("general, employer-loan and default court-order deduction caps remain distinct", () => {
  assert.equal(generalDeductionCapHalalas(270000), 135000);
  assert.equal(employerLoanDeductionCapHalalas(270000), 27000);
  assert.equal(courtOrderDefaultDeductionCapHalalas(270000), 67500);
});

test("weekly rest and annual leave are not cash-substitutable during active service", () => {
  assert.equal(weeklyRestCashSubstitutionAllowed(), false);
  assert.equal(
    annualLeaveCashSubstitutionDuringServiceAllowed(),
    false
  );
});

test("current maternity and working-time policy constants are explicit", () => {
  assert.equal(SA_SPECIAL_LEAVE_ENTITLEMENTS.maternityWeeks, 12);
  assert.equal(SA_LABOR_LIMITS.standardDailyHours, 8);
  assert.equal(SA_LABOR_LIMITS.standardWeeklyHours, 48);
  assert.equal(SA_LABOR_LIMITS.weeklyRestMinimumHours, 24);
  assert.equal(
    SA_LABOR_LIMITS.compensatoryLeaveMinimumRatio,
    1.5
  );
  assert.equal(
    SA_LABOR_LIMITS.compensatoryLeaveAnnualMaxDays,
    30
  );
  assert.equal(
    SA_LABOR_POLICY_VERSION,
    "sa-labor-2025-amended-v1"
  );
});

test("migration creates separated comp-time and compliance ledgers without mutating annual balances", () => {
  const migration = readFileSync(
    new URL(
      "../migrations/core/0038_sa_labor_compliance_foundation.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /CREATE TABLE employee_comp_time_ledger/
  );
  assert.match(
    migration,
    /CREATE TABLE employee_labor_compliance_events/
  );
  assert.match(
    migration,
    /ADD COLUMN labor_policy_version/
  );
  assert.doesNotMatch(
    migration,
    /UPDATE\s+employee_employment\s+SET\s+leave_balance/i
  );
});