import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireText = (file, text, message) => {
  if (!read(file).includes(text)) failures.push(message);
};
const rejectText = (file, text, message) => {
  if (read(file).includes(text)) failures.push(message);
};

requireText(
  "workers/core/d1.js",
  "export function canonicalIdCandidates",
  "Core must expose one canonical alias-candidate primitive."
);

for (const guard of [
  "const employeeId = normalizeId(query.employeeId || query.employee_id);",
  "const canonicalEmployeeId = normalizeId(row.employee_id);",
  "assertCanonicalSalaryAdvanceCap(row);",
  "employerLoanDeductionCapHalalas(capBaseHalalas)",
]) {
  requireText("workers/core/repositories/payroll.js", guard, `Payroll canonical guard missing: ${guard}`);
}
requireText(
  "workers/core/repositories/payroll.js",
  "Salary-advance installments own their own immutable rescheduling ledger.",
  "Generic payroll deferrals must explicitly exclude salary-advance ledger ownership."
);
rejectText(
  "workers/core/repositories/payroll.js",
  "canonicalDeferrableManualDeductionsHalalas +\n    canonicalAdvanceHalalas;",
  "Generic partial payroll deferral must not silently defer salary advances."
);

for (const guard of [
  "canonicalIdCandidates(employeeId)",
  "sa.employee_id IN (${placeholders(employeeIds.length)})",
  "employeeId: normalizeId(row.employee_id)",
]) {
  requireText("workers/core/repositories/salary-advance-deferrals.js", guard, `Salary-advance alias guard missing: ${guard}`);
}

for (const guard of [
  "async function assertSalaryAdvanceSchedulePossible",
  "employerLoanDeductionCapHalalas(fixedActualWageHalalas)",
  "core_employee_request:salary_advance_installment_cap_exceeded",
  "minimumInstallmentCount",
]) {
  requireText("workers/core/repositories/employee-requests.js", guard, `Salary-advance creation guard missing: ${guard}`);
}

for (const guard of [
  "const requestedEmployeeId = normalizeId(data.employeeId || data.employee_id || actor.employeeId);",
  "normalizeId(row.employee_id) === normalizeId(actor.employeeId)",
]) {
  requireText("workers/core/repositories/employee-requests-legacy.js", guard, `Employee request canonical identity guard missing: ${guard}`);
}

for (const guard of [
  "employeeId: normalizeEmployeeIdentityId(query.employeeId)",
]) {
  requireText("src/services/CoreHrService.ts", guard, `CoreHrService payroll identity guard missing: ${guard}`);
}

requireText(
  "src/services/coreApiClient.ts",
  '"core_payroll:employer_loan_deduction_cap_exceeded"',
  "Payroll employer-loan cap must have a specific user-facing reason."
);
requireText(
  "src/services/coreApiClient.ts",
  '"core_employee_request:salary_advance_installment_cap_exceeded"',
  "Salary-advance schedule cap must have a specific user-facing reason."
);

if (failures.length) {
  console.error("Employee lifecycle payroll integrity guard failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Employee lifecycle payroll integrity guard passed.");
