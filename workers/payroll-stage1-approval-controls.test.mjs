import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payrollCarryoverDelta } from "../src/helpers/hr/payrollCarryoverPolicy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("late payroll approval is explicit, audited and Core-authoritative", () => {
  const repo = read("workers/core/repositories/payroll.js");
  const worker = read("workers/core/index.js");
  const coreHr = read("src/services/CoreHrService.ts");
  const payrollService = read("src/services/CorePayrollService.ts");
  const page = read("src/pages/DashboardPayroll.tsx");

  assert.match(repo, /export async function recordLatePayrollApproval/);
  assert.match(repo, /late_approval_recorded/);
  assert.match(repo, /effectiveApprovalDate/);
  assert.match(repo, /approvedNetHalalas/);
  assert.match(repo, /createdAt: now/);
  assert.match(repo, /late_approval_date_must_be_past/);
  assert.match(repo, /late_approval_date_outside_period/);

  assert.match(worker, /late-approve/);
  assert.match(worker, /case "payroll-entry:late-approve"/);
  assert.match(worker, /requirePermission\(ctx, "payroll\.manage"\)/);
  assert.match(worker, /requireRole\(ctx\.role, HR_MANAGEMENT_ROLES\)/);

  assert.match(coreHr, /recordLatePayrollApproval/);
  assert.match(payrollService, /recordLatePayrollApproval/);
  assert.match(page, /تسجيل اعتماد متأخر/);
  assert.match(page, /DashboardDatePickerV2/);
  assert.match(page, /DashboardSelectV2/);
  assert.match(page, /payroll-late-approval-modal/);
  assert.match(page, /المبلغ المعتمد فعليًا/);
  assert.match(page, /تاريخ إدخال السجل في النظام يبقى وقت اليوم الحقيقي/);
  assert.doesNotMatch(
    repo.match(/export async function recordLatePayrollApproval[\s\S]*?export async function reopenPayrollEntry/)?.[0] || "",
    /paid_at\s*=/
  );
});

test("full-month early approval remains the carryover baseline", () => {
  const result = payrollCarryoverDelta(361000, 348000);
  assert.equal(result.approvedNetHalalas, 361000);
  assert.equal(result.recalculatedNetHalalas, 348000);
  assert.equal(result.direction, "deduction");
  assert.equal(result.amountHalalas, 13000);
});

test("Stage 1 UI distinguishes monthly approval from schedule protection", () => {
  const page = read("src/pages/DashboardPayroll.tsx");
  const workspace = read("src/pages/payroll/PayrollComplianceWorkspace.tsx");

  assert.match(page, /راتب .* الكامل المتوقع/);
  assert.match(page, /وليس راتب الأيام المنقضية فقط/);
  assert.match(page, /المستحق المكتسب حتى/);
  assert.match(workspace, /حماية جداول الدوام للفترة/);
  assert.match(workspace, /لا يؤثر هذا القفل على تسجيل الحضور والبصمة/);
  assert.match(workspace, /dir="ltr"/);
});


test("floating layer stays above payroll modal", () => {
  const floating = read("src/styles/dashboard-v2/floating.css");
  const payrollCss = read("src/styles/dashboard-v2/pages/payroll.css");

  const floatingZ = Number(
    floating.match(/z-index:\s*(\d+)/)?.[1] || 0
  );
  const modalZ = Number(
    payrollCss.match(
      /body > \.dashboard-v2\.payroll-modal-backdrop\s*\{[\s\S]*?z-index:\s*(\d+)/
    )?.[1] || 0
  );

  assert.ok(floatingZ > modalZ, `floating z-index ${floatingZ} must be above modal ${modalZ}`);
});
