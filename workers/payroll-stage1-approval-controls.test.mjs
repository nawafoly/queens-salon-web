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

test("payroll compliance ignores stale employee/month loads before replacing state", () => {
  const workspace = read("src/pages/payroll/PayrollComplianceWorkspace.tsx");

  assert.match(workspace, /const loadGenerationRef = useRef\(0\)/);
  assert.match(workspace, /const activeSelectionRef = useRef\(\{ employeeId, payrollMonth \}\)/);
  assert.match(workspace, /const generation = \+\+loadGenerationRef\.current/);
  assert.match(workspace, /employeeId: requestedEmployeeId/);
  assert.match(workspace, /payrollMonth: requestedPayrollMonth/);
  assert.match(workspace, /generation === loadGenerationRef\.current/);
  assert.match(workspace, /activeSelectionRef\.current\.employeeId === requestedEmployeeId/);
  assert.match(workspace, /activeSelectionRef\.current\.payrollMonth === requestedPayrollMonth/);

  const applyGuard = workspace.indexOf("if (!selectionIsCurrent()) return;");
  const obligationsWrite = workspace.indexOf("setObligations(obligationRows as any[])");
  assert.ok(
    applyGuard >= 0 && obligationsWrite > applyGuard,
    "stale-load guard must run before compliance arrays are replaced"
  );
});


test("reopening approved payroll restores inbound carryovers and blocks consumed downstream carryovers", () => {
  const repo = read("workers/core/repositories/payroll.js");
  const start = repo.indexOf("export async function reopenPayrollEntry");
  const end = repo.indexOf("\nexport async function markPayrollEntryPaid", start);

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = repo.slice(start, end);

  assert.match(
    fn,
    /source_payroll_entry_id = \?[\s\S]*status = 'applied'[\s\S]*reopen_has_applied_downstream_carryover/
  );
  assert.match(
    fn,
    /SET status = 'pending',[\s\S]*target_payroll_entry_id = NULL,[\s\S]*applied_at = NULL/
  );
  assert.match(
    fn,
    /source_payroll_entry_id = \?[\s\S]*status = 'pending'/
  );
  assert.match(
    fn,
    /SET status = 'void',[\s\S]*amount_halalas = 0/
  );
  assert.match(fn, /await dbBatch\(db, statements\)/);
  assert.match(fn, /reopen_concurrent_mutation/);
});


test("payroll payment and reversal are coupled to their authoritative states", () => {
  const repo = read("workers/core/repositories/payroll.js");
  const obligations = read(
    "workers/core/repositories/payroll-obligations.js"
  );

  const paidStart = repo.indexOf(
    "export async function markPayrollEntryPaid"
  );
  const reverseStart = repo.indexOf(
    "export async function reversePayrollEntryPayment",
    paidStart
  );
  assert.ok(paidStart >= 0);
  assert.ok(reverseStart > paidStart);

  const paidFn = repo.slice(paidStart, reverseStart);
  const reverseFn = repo.slice(reverseStart);

  assert.match(paidFn, /requirePayrollPaid: true/);
  assert.match(
    paidFn,
    /pe\.status = 'paid'/
  );
  assert.match(
    paidFn,
    /payment_concurrent_mutation/
  );
  assert.match(
    paidFn,
    /payment_advance_settlement_incomplete/
  );

  assert.match(reverseFn, /requirePayrollApproved: true/);
  assert.match(
    reverseFn,
    /sai\.status = 'deducted'/
  );
  assert.match(
    reverseFn,
    /pe\.status = 'approved'/
  );
  assert.match(
    reverseFn,
    /payment_reversal_concurrent_mutation/
  );
  assert.match(
    reverseFn,
    /payment_reversal_advance_incomplete/
  );
  assert.match(
    reverseFn,
    /payment_reversal_obligation_incomplete/
  );

  assert.match(obligations, /requirePayrollPaid/);
  assert.match(obligations, /requirePayrollApproved/);
  assert.match(
    obligations,
    /COALESCE\(updated_at, ''\) <> \?/
  );
});

test("payroll approval only locks mutable rows and verifies the winner", () => {
  const repo = read("workers/core/repositories/payroll.js");
  const start = repo.indexOf(
    "export async function approvePayrollEntry"
  );
  const end = repo.indexOf(
    "\nexport async function recordLatePayrollApproval",
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = repo.slice(start, end);
  assert.match(
    fn,
    /AND status IN \('draft', 'reviewed'\)/
  );
  assert.match(
    fn,
    /cleanText\(current\.status\) === 'approved'/
  );
  assert.match(fn, /approval_concurrent_mutation/);
});


test("late approval snapshot is bound to the winning historical transition", () => {
  const repo = read("workers/core/repositories/payroll.js");
  const start = repo.indexOf(
    "export async function recordLatePayrollApproval"
  );
  const end = repo.indexOf(
    "\nexport async function reopenPayrollEntry",
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const fn = repo.slice(start, end);
  assert.match(fn, /transitionGuard/);
  assert.match(fn, /lateApprovalAuditLog/);
  assert.match(
    fn,
    /cleanText\(current\.approved_at\) === approvalDate/
  );
  assert.match(
    fn,
    /latestSnapshot\?\.approved_net_halalas/
  );
  assert.match(
    fn,
    /late_approval_concurrent_mutation/
  );
});
