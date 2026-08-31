import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Stage 1 payroll compliance capabilities are exposed in Dashboard Payroll", () => {
  const dashboard = read("src/pages/DashboardPayroll.tsx");
  const workspace = read("src/pages/payroll/PayrollComplianceWorkspace.tsx");
  const compliance = read("src/services/CoreComplianceService.ts");
  const core = read("workers/core/index.js");
  const repo = read("workers/core/repositories/payroll-deduction-compliance.js");

  for (const token of [
    "PayrollComplianceWorkspace",
    "listPayrollDeductionCourtOverrides",
    "listPayrollDeductionClassificationEvents",
    "classifyPayrollObligation",
    "classifyRecurringPayrollDeduction",
    "listSalaryAdvanceInstallments",
    "deferSalaryAdvanceInstallment",
    "listPayrollCarryovers",
    "listShiftPayrollPeriodLocks",
    "saveShiftPayrollPeriodLock",
  ]) {
    assert.ok(
      dashboard.includes(token) ||
        workspace.includes(token) ||
        compliance.includes(token),
      "missing frontend Stage 1 token: " + token
    );
  }

  assert.ok(repo.includes("export async function listPayrollDeductionCourtOverrides"));
  assert.ok(core.includes('name: "payroll-deduction-overrides"'));
  assert.ok(core.includes("listPayrollDeductionCourtOverrides(db, ctx.salonId, query)"));
});

test("Stage 1 workspace does not reimplement payroll formulas", () => {
  const workspace = read("src/pages/payroll/PayrollComplianceWorkspace.tsx");
  assert.ok(workspace.includes("CoreComplianceService"));
  assert.ok(workspace.includes("CoreHrService"));
  assert.ok(!workspace.includes("calculateGosi("));
  assert.ok(!workspace.includes("evaluateSaPayrollDeductionCompliance("));
  assert.ok(!workspace.includes("totalDeductionsHalalas ="));
  assert.ok(!workspace.includes('type="month"'));
  assert.ok(!workspace.includes("(CoreHrService as any)"));
  assert.ok(workspace.includes("DashboardSelectV2"));
});
