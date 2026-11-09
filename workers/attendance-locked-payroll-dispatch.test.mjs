import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reconcileLockedPayrollImpactForEmployeeDate,
} from "./core/repositories/payroll.js";

function payrollFixture(status) {
  const reads = [];
  const writes = [];
  const entry = {
    id: "locked-payroll-2026-08",
    salon_id: "main",
    employee_id: "employee-1002",
    payroll_month: "2026-08",
    status,
  };

  const db = {
    __fakeD1: true,
    async all(sql, params) {
      reads.push({ sql, params });
      if (
        /FROM payroll_entries\b/.test(sql) &&
        /status IN \('approved', 'paid'\)/.test(sql)
      ) {
        assert.deepEqual(params, ["main", "employee-1002", "2026-08"]);
        return ["approved", "paid"].includes(status) ? [entry] : [];
      }
      if (
        /FROM payroll_entries\b/.test(sql) &&
        /payroll_month > \?/.test(sql)
      ) {
        return [];
      }
      if (/FROM payroll_periods\b/.test(sql)) {
        throw new Error("LOCKED_PAYROLL_RECONCILIATION_REACHED");
      }
      throw new Error("UNEXPECTED_PAYROLL_QUERY: " + sql);
    },
    async first(sql) {
      throw new Error("UNEXPECTED_PAYROLL_POINT_READ: " + sql);
    },
    async run(sql) {
      writes.push(sql);
      throw new Error("UNEXPECTED_PAYROLL_WRITE");
    },
    async batch(statements) {
      writes.push(...statements);
      throw new Error("UNEXPECTED_PAYROLL_BATCH");
    },
  };

  return { db, reads, writes };
}

for (const status of ["approved", "paid"]) {
  test("attendance correction routes " + status + " payroll into canonical carryover reconciliation", async () => {
    const { db, reads, writes } = payrollFixture(status);

    await assert.rejects(
      reconcileLockedPayrollImpactForEmployeeDate(
        db,
        "main",
        {
          employeeId: "employee-1002",
          date: "2026-08-16",
          sourceType: "attendance_admin_adjustment",
          sourceId: "attendance-change-1",
        },
        { uid: "hr-admin" }
      ),
      /LOCKED_PAYROLL_RECONCILIATION_REACHED/
    );

    assert.ok(
      reads.some(({ sql }) => /FROM payroll_periods\b/.test(sql)),
      "locked payroll must continue to Core's eligible carryover target selection"
    );
    assert.deepEqual(writes, [], "the dispatch must not directly mutate the locked entry");
  });
}

test("unapproved payroll does not initiate a historical carryover", async () => {
  const { db, reads, writes } = payrollFixture("draft");

  const result = await reconcileLockedPayrollImpactForEmployeeDate(
    db,
    "main",
    {
      employeeId: "employee-1002",
      date: "2026-08-16",
      sourceType: "attendance_admin_adjustment",
    },
    { uid: "hr-admin" }
  );

  assert.deepEqual(result.lockedSourcePayrollMonths, []);
  assert.deepEqual(result.results, []);
  assert.equal(reads.length, 1);
  assert.deepEqual(writes, []);
});
