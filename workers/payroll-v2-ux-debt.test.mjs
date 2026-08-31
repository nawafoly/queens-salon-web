import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/pages/DashboardPayroll.tsx", "utf8");

test("Payroll V2 uses in-app workflows instead of native browser dialogs", () => {
  assert.ok(!source.includes("window.confirm("));
  assert.ok(!source.includes("window.prompt("));
  assert.ok(!source.includes('type="month"'));
  assert.ok(source.includes("approvalConfirmation"));
  assert.ok(source.includes("submitApprovalConfirmation"));
  assert.ok(source.includes("reopenDraft"));
  assert.ok(source.includes("submitReopen"));
  assert.ok(source.includes("futurePayrollMonthOptions"));
  assert.ok(source.includes("DashboardSelectV2"));
});
