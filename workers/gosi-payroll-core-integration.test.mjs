import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateGosi } from "../src/helpers/hr/gosiPolicy.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const math = read("src/helpers/hr/payrollCalculations.ts");
const service = read("src/services/CorePayrollService.ts");
const repo = read("workers/core/repositories/payroll.js");
const employeeRepo = read("workers/core/repositories/hr-employees.js");

const existing = calculateGosi({
  insuranceCategory: "saudi_existing",
  payrollDate: "2026-08-28",
  basicSalaryHalalas: 350000,
  housingAllowanceHalalas: 50000,
  transportationAllowanceHalalas: 30000,
});
assert.equal(existing.contributoryWage.appliedHalalas, 400000);
assert.equal(existing.employee.deductionHalalas, 39000);
assert.equal(existing.contributoryWage.components.transportationIncluded, false);

const nonSaudi = calculateGosi({
  insuranceCategory: "non_saudi",
  payrollDate: "2026-08-28",
  basicSalaryHalalas: 250000,
});
assert.equal(nonSaudi.employee.deductionHalalas, 0);
assert.equal(nonSaudi.employer.occupationalHazardContributionHalalas, 5000);

assert.match(math, /advancesHalalas\s*\+\s*insuranceDeductionHalalas/);
assert.doesNotMatch(math, /grossSalaryHalalas\s*-\s*employerGosiContributionHalalas/);
assert.match(service, /function employeeGosiSnapshot/);
assert.match(service, /insuranceDeductionHalalas:\s*\n?\s*entry\.insuranceDeductionHalalas/);
assert.match(repo, /gosi_employee_deduction_mismatch/);
assert.match(repo, /employer_gosi_contribution_halalas/);
assert.match(employeeRepo, /social_insurance_category/);
assert.match(employeeRepo, /gosi_contributory_wage_override_halalas/);

console.log("gosi-payroll-core-integration.test.mjs: PASS");
