import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("./core/repositories/payroll.js", import.meta.url),
  "utf8"
);

test("completed automatic check-in-lock absence is classified as a full payroll absence", () => {
  assert.match(
    source,
    /normalized === 'full_day' \|\| normalized === 'automatic_check_in_lock'\)\s*return 1/
  );
});

test("automatic absence classification remains bounded by the completed payroll period", () => {
  assert.match(
    source,
    /const completedThrough = payrollCompletedThrough\(bounds\)/
  );

  assert.match(
    source,
    /dateKey > effectiveCompletedEnd\) continue/
  );
});

test("absence overlap removes the same scheduled hours from attendance missing-hours deduction", () => {
  assert.match(
    source,
    /absenceDeductionOverlapHours \+= scheduledHours \* absenceUnit/
  );

  assert.match(
    source,
    /Number\(summary\.totalMissingHours \|\| 0\) -\s*absenceCoveredMissingHours/
  );
});

test("completed scheduled no-punch day becomes payroll absence instead of duplicate missing-hours deduction", () => {
  assert.match(
    source,
    /const uncoveredMinutes = Math\.max\(0, scheduledMinutes - cover\)/
  );

  assert.match(
    source,
    /if \(absenceUnit <= 0 && uncoveredMinutes > 0\)/
  );

  assert.match(
    source,
    /approvedAbsenceDays \+= automaticAbsenceUnit/
  );

  assert.match(
    source,
    /absenceDeductionOverlapHours \+= scheduledHours \* automaticAbsenceUnit/
  );
});