import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { calculatePayrollSnapshot } from "../src/helpers/hr/payrollCalculations.ts";
import { SA_LABOR_POLICY_VERSION } from "../src/helpers/hr/saLaborPolicy.js";
import {
  SA_LEAVE_TYPES,
  getSaLeaveTypePolicy,
  normalizeSaLeaveType,
} from "../src/helpers/hr/saLeaveEntitlements.js";

test("Aida payroll uses 2700 actual fixed wage for attendance and statutory overtime", () => {
  const result = calculatePayrollSnapshot({
    employeeId: "aida",
    employeeName: "عايدة",
    payrollMonth: "2026-08",
    baseSalaryHalalas: 250000,
    allowancesHalalas: 20000,
    workDays: 30,
    monthlyHours: 240,
    dailyScheduledHours: 8,
    overtimeEnabled: true,
    overtimeMultiplier: 1.5,
    attendanceSummary: {
      totalScheduledHours: 240,
      totalActualWorkedHours: 233,
      totalLateHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 8,
      totalExtraHours: 1,
      attendanceDays: 29,
      absentDays: 1,
      incompleteDays: 0,
      approvedLeaveDays: 0,
      approvedAbsenceDays: 1,
      absenceDeductionOverlapHours: 8,
      attendanceRecordCount: 20,
      attendanceLinkStatus: "confirmed",
      attendanceDeductionEligible: true,
    },
  });

  assert.equal(result.laborPolicyVersion, SA_LABOR_POLICY_VERSION);
  assert.equal(result.fixedActualWageHalalas, 270000);
  assert.equal(result.dailyRateHalalas, 9000);
  assert.equal(result.hourlyRateHalalas, 1125);
  assert.equal(result.absenceDeductionHalalas, 9000);
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.overtimeActualHourlyHalalas, 1125);
  assert.equal(result.overtimeBasicHourlyHalalas, 1042);
  assert.equal(result.overtimeValueHalalas, 1646);
  assert.equal(result.grossSalaryHalalas, 271646);
  assert.equal(result.netSalaryHalalas, 262646);
});

test("Core payroll persists labor policy evidence, rejects stale wages and uses reconciled overtime authority", () => {
  const source = readFileSync(
    new URL("../workers/core/repositories/payroll.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /SA_LABOR_POLICY_VERSION/);
  assert.match(source, /fixed_actual_wage_halalas/);
  assert.match(source, /wage_source_updated_at/);
  assert.match(source, /overtime_actual_hourly_halalas/);
  assert.match(source, /overtime_basic_hourly_halalas/);
  assert.match(source, /core_payroll:wage_snapshot_stale/);
  assert.match(
    source,
    /actual_hourly_plus_50pct_basic_hourly/
  );
  assert.match(
    source,
    /listReconciledCashOvertimeForPayroll/
  );
  assert.match(
    source,
    /reconciled_cash_overtime_only/
  );
  assert.match(
    source,
    /Approved\/paid payroll is an immutable overtime financial snapshot/
  );
  assert.match(
    source,
    /sourceEntry\.overtime_value_halalas/
  );
  assert.doesNotMatch(
    source,
    /financialOvertimeHours \* hourlyRateHalalas \* overtimeMultiplier/
  );
});

test("legacy annual balance is never consumed by sick or emergency leave", () => {
  const frontend = readFileSync(
    new URL("../src/helpers/hr/employeeLeave.ts", import.meta.url),
    "utf8"
  );
  const core = readFileSync(
    new URL("../workers/core/repositories/leaves.js", import.meta.url),
    "utf8"
  );

  assert.match(
    frontend,
    /deductFromBalance: type === "annual"/
  );
  assert.doesNotMatch(
    frontend,
    /type === "sick" \|\|/
  );

  assert.equal(getSaLeaveTypePolicy("annual").deductAnnualBalance, true);
  assert.equal(getSaLeaveTypePolicy("sick").deductAnnualBalance, false);
  assert.equal(getSaLeaveTypePolicy("emergency").deductAnnualBalance, false);
  assert.equal(normalizeSaLeaveType("emergency"), SA_LEAVE_TYPES.otherHrReview);

  assert.match(core, /resolved\.policy\.deductAnnualBalance \? 1 : 0/);
  assert.match(core, /SA_LEAVE_TYPES\.sick/);
  assert.match(core, /SA_LEAVE_TYPES\.otherHrReview/);
});
