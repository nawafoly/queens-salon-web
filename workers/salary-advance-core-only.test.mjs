import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("salary advance deductions come only from canonical Core installments", () => {
  const payroll = read("workers/core/repositories/payroll.js");
  const employeeRequests = read("workers/core/repositories/employee-requests.js");
  const worker = read("workers/core/index.js");
  const service = read("src/services/CoreHrService.ts");
  const generator = read("src/services/CorePayrollService.ts");
  const calculations = read("src/helpers/hr/payrollCalculations.ts");
  const dashboard = read("src/pages/DashboardPayroll.tsx");

  assert.match(payroll, /listPayrollAdvanceDeductions/);
  assert.match(payroll, /core_payroll:manual_advance_not_allowed/);
  assert.match(payroll, /core_payroll:advance_deduction_mismatch/);
  assert.match(payroll, /salary_advance_installments/);
  assert.match(employeeRequests, /core_employee_request:salary_advance_payroll_locked/);
  assert.match(worker, /payroll-advance-deductions/);
  assert.match(service, /listPayrollAdvanceDeductions/);
  assert.match(generator, /CoreHrService.listPayrollAdvanceDeductions/);
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
