import assert from "node:assert/strict";
import {
  buildDeferredDeduction,
  buildInstallmentPlan,
} from "../src/helpers/hr/payrollObligationPolicy.js";

{
  const row = buildDeferredDeduction({
    kind: "absence",
    originalPayrollMonth: "2026-08",
    targetPayrollMonth: "2026-10",
    amountHalalas: 60000,
    reason: "Employee hardship request approved by management",
    sourceType: "attendance",
    sourceRef: "absence:2026-08",
    createdByUid: "admin-test",
    createdAt: "2026-08-23T10:00:00.000Z",
  });
  assert.equal(row.originalAmountHalalas, 60000);
  assert.equal(row.scheduledAmountHalalas, 60000);
  assert.equal(row.originalPayrollMonth, "2026-08");
  assert.equal(row.targetPayrollMonth, "2026-10");
}

{
  const plan = buildInstallmentPlan({
    kind: "advance",
    originalPayrollMonth: "2026-08",
    amountHalalas: 120000,
    reason: "Approved installment plan",
    sourceType: "advance",
    sourceRef: "advance:test",
    createdByEmail: "admin@example.com",
    createdAt: "2026-08-23T10:00:00.000Z",
    installments: [
      { targetPayrollMonth: "2026-09", amountHalalas: 40000 },
      { targetPayrollMonth: "2026-10", amountHalalas: 40000 },
      { targetPayrollMonth: "2026-11", amountHalalas: 40000 },
    ],
  });
  assert.equal(plan.scheduledTotalHalalas, 120000);
  assert.equal(plan.installments.length, 3);
}

assert.throws(
  () => buildDeferredDeduction({
    kind: "gosi",
    originalPayrollMonth: "2026-08",
    targetPayrollMonth: "2026-09",
    amountHalalas: 39000,
    reason: "Must not be allowed",
    createdByUid: "admin-test",
  }),
  /statutory_deduction_not_deferrable/
);

assert.throws(
  () => buildInstallmentPlan({
    kind: "manual_deduction",
    originalPayrollMonth: "2026-08",
    amountHalalas: 120000,
    reason: "Mismatch test",
    createdByUid: "admin-test",
    installments: [{ targetPayrollMonth: "2026-09", amountHalalas: 100000 }],
  }),
  /deduction_installment_total_mismatch/
);

console.log("payroll-obligation-policy.test.mjs: PASS");
