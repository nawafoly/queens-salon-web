import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("salary advance deductions come only from canonical Core installments", () => {
  const payroll = read("workers/core/repositories/payroll.js");
  const employeeRequests = read("workers/core/repositories/employee-requests-legacy.js");
  const activeRequests = read("workers/core/repositories/employee-requests.js");
  const worker = read("workers/core/index.js");
  const service = read("src/services/CoreHrService.ts");
  const generator = read("src/services/CorePayrollService.ts");
  const calculations = read("src/helpers/hr/payrollCalculations.ts");
  const dashboard = read("src/pages/DashboardPayroll.tsx");

  assert.match(payroll, /listPayrollAdvanceDeductions/);
  assert.match(payroll, /core_payroll:manual_advance_not_allowed/);
  assert.match(payroll, /core_payroll:advance_deduction_mismatch/);
  assert.match(payroll, /salary_advance_installments/);
  assert.match(activeRequests, /employee-requests-legacy\.js/);
  assert.match(employeeRequests, /core_employee_request:salary_advance_payroll_locked/);
  assert.match(worker, /payroll-advance-deductions/);
  assert.match(service, /listPayrollAdvanceDeductions/);
  assert.match(generator, /CoreHrService.previewPayrollEntry/);
  assert.match(calculations, /const advancesHalalas = money\(input\.advancesHalalas\)/);
  assert.match(calculations, /\.filter\(\(item\) => item\.kind !== "advance"\)/);
  assert.doesNotMatch(
    dashboard,
    /{s*value:s*"advance"s*,s*label:s*"سلفة"s*}/
  );
});

test("payroll payment and salary advance settlement stay in one atomic D1 batch", () => {
  const payroll = read("workers/core/repositories/payroll.js");
  const start = payroll.indexOf("export async function markPayrollEntryPaid");
  assert.notEqual(start, -1);
  const block = payroll.slice(start);
  assert.match(block, /await dbBatch\(db, statements\)/);
  assert.match(block, /salary_advance_installments/);
  assert.match(block, /salary_advances/);
  assert.match(block, /existing.employee_id/);
  assert.match(block, /existing.payroll_month/);
  assert.match(block, /status = 'approved'/);
  assert.doesNotMatch(block, /await dbRun\(/);
});

test("salary advance installment deferral is canonical, atomic, scoped and permission-gated", () => {
  const payroll = read("workers/core/repositories/payroll.js");
  const deferrals = read("workers/core/repositories/salary-advance-deferrals.js");
  const migration = read("migrations/core/0035_salary_advance_installment_deferrals.sql");
  const worker = read("workers/core/index.js");
  const service = read("src/services/CoreHrService.ts");

  assert.match(payroll, /export function buildPayrollEntryMutationStatement/);
  assert.match(payroll, /internalCanonicalAdvanceHalalas/);
  assert.match(payroll, /internal_advance_override_requires_preview/);

  assert.match(deferrals, /buildPayrollEntryMutationStatement/);
  assert.match(deferrals, /listPayrollAdvanceDeductions/);
  assert.match(deferrals, /previewOnly:\s*true/);
  assert.match(deferrals, /internalCanonicalAdvanceHalalas/);
  assert.match(deferrals, /originalPayrollMonth/);
  assert.match(deferrals, /deferredBy/);
  assert.match(deferrals, /source:\s*row\.source/);
  assert.match(deferrals, /await dbBatch\(db, statements\)/);
  assert.doesNotMatch(deferrals, /refreshAffectedPayrolls/);
  assert.doesNotMatch(deferrals, /await dbRun\(/);

  assert.match(migration, /salary_advance_installment_deferrals/);
  assert.match(migration, /original_payroll_month/);
  assert.match(migration, /from_installment_updated_at/);
  assert.match(migration, /trg_salary_advance_deferral_validate_original_month/);
  assert.match(migration, /IN \('draft', 'reviewed'\)/);
  assert.match(migration, /trg_salary_advance_deferral_source_period_lock/);
  assert.match(migration, /trg_salary_advance_deferral_target_period_lock/);
  assert.match(migration, /trg_salary_advance_deferral_source_projection_snapshot/);
  assert.match(migration, /trg_salary_advance_deferral_target_projection_snapshot/);
  assert.match(migration, /salary_advance_installment_deferrals_immutable/);
  assert.doesNotMatch(
    migration,
    /SET\s+(?:gross_salary_halalas|total_deductions_halalas|net_salary_halalas|final_salary_halalas)\s*=/i
  );

  assert.match(worker, /deferSalaryAdvanceInstallment/);
  assert.match(worker, /salary-advance-installments\\\/\(\[\^\/\]\+\)\\\/defer/);
  const handlerStart = worker.indexOf('    case "salary-advance-installment:defer":');
  assert.notEqual(handlerStart, -1);
  const handler = worker.slice(handlerStart, handlerStart + 500);
  assert.match(handler, /requirePermission\(ctx, "payroll\.manage"\)/);
  assert.match(handler, /deferSalaryAdvanceInstallment\(/);
  assert.match(handler, /ctx\.salonId/);
  assert.match(handler, /actorInfo/);

  assert.match(service, /async deferSalaryAdvanceInstallment\(/);
  assert.match(service, /idempotencyKey:\s*string/);
  assert.match(service, /\/api\/core\/hr\/salary-advance-installments\/\$\{encodeURIComponent\(id\)\}\/defer/);
});

test("salary advance installments expose a scoped administrative read path", () => {
  const deferrals = read("workers/core/repositories/salary-advance-deferrals.js");
  const worker = read("workers/core/index.js");
  const service = read("src/services/CoreHrService.ts");

  assert.ok(deferrals.includes("export async function listSalaryAdvanceInstallments"));
  assert.ok(deferrals.includes("JOIN salary_advances sa"));
  assert.ok(deferrals.includes("sa.employee_id = ?"));
  assert.ok(deferrals.includes("sai.payroll_month = ?"));
  assert.ok(deferrals.includes("employeeId: row.employee_id"));

  assert.ok(worker.includes('path === "/api/core/hr/salary-advance-installments"'));
  assert.ok(worker.includes('case "salary-advance-installments":'));
  assert.ok(worker.includes('requireAnyPermission(ctx, ["payroll.view", "payroll.manage"])'));
  assert.ok(worker.includes("listSalaryAdvanceInstallments(db, ctx.salonId, query)"));

  assert.ok(service.includes("async listSalaryAdvanceInstallments("));
  assert.ok(service.includes("employeeId: string"));
  assert.ok(service.includes("payrollMonth?: string"));
  assert.ok(service.includes('"/api/core/hr/salary-advance-installments"'));
});