import assert from "node:assert/strict";
import {
  calculateBasisPointAmount,
  calculateGosi,
  resolveGosiContributoryWage,
} from "../src/helpers/hr/gosiPolicy.js";

const sar = (value) => value * 100;

{
  const result = calculateGosi({
    insuranceCategory: "saudi_existing",
    payrollMonth: "2026-08",
    basicSalaryHalalas: sar(4000),
  });
  assert.equal(result.employee.totalRateBps, 975);
  assert.equal(result.employee.deductionHalalas, sar(390));
  assert.equal(result.employer.totalRateBps, 1175);
  assert.equal(result.employer.contributionHalalas, sar(470));
}

{
  const result = calculateGosi({
    insuranceCategory: "saudi_existing",
    payrollMonth: "2026-08",
    basicSalaryHalalas: sar(4400),
  });
  assert.equal(result.employee.deductionHalalas, sar(429));
}

{
  const result = calculateGosi({
    insuranceCategory: "saudi_new",
    payrollMonth: "2026-08",
    basicSalaryHalalas: sar(4000),
  });
  assert.equal(result.employee.pensionRateBps, 1000);
  assert.equal(result.employee.sanedRateBps, 75);
  assert.equal(result.employee.totalRateBps, 1075);
  assert.equal(result.employee.deductionHalalas, sar(430));
}

{
  const result = calculateGosi({
    insuranceCategory: "non_saudi",
    payrollMonth: "2026-08",
    basicSalaryHalalas: sar(2500),
  });
  assert.equal(result.employee.deductionHalalas, 0);
  assert.equal(result.employer.occupationalHazardRateBps, 200);
  assert.equal(result.employer.contributionHalalas, sar(50));
}

{
  const result = calculateGosi({
    insuranceCategory: "non_saudi",
    payrollMonth: "2026-08",
    basicSalaryHalalas: sar(2400),
  });
  assert.equal(result.employee.deductionHalalas, 0);
  assert.equal(result.employer.contributionHalalas, sar(48));
}

{
  const wage = resolveGosiContributoryWage({
    insuranceCategory: "saudi_existing",
    payrollMonth: "2026-08",
    basicSalaryHalalas: sar(3500),
    housingAllowanceHalalas: sar(500),
    transportationAllowanceHalalas: sar(300),
    otherAllowancesHalalas: sar(200),
  });
  assert.equal(wage.rawHalalas, sar(4000));
  assert.equal(wage.appliedHalalas, sar(4000));
  assert.equal(wage.components.transportationIncluded, false);
  assert.equal(wage.components.otherAllowancesIncluded, false);
}

{
  const wage = resolveGosiContributoryWage({
    insuranceCategory: "saudi_existing",
    basicSalaryHalalas: sar(1000),
  });
  assert.equal(wage.appliedHalalas, sar(1500));
  assert.equal(wage.wasFloored, true);
}

{
  const wage = resolveGosiContributoryWage({
    insuranceCategory: "non_saudi",
    basicSalaryHalalas: sar(300),
  });
  assert.equal(wage.appliedHalalas, sar(400));
}

{
  const wage = resolveGosiContributoryWage({
    insuranceCategory: "saudi_existing",
    basicSalaryHalalas: sar(50000),
  });
  assert.equal(wage.appliedHalalas, sar(45000));
  assert.equal(wage.wasCapped, true);
}

{
  const wage = resolveGosiContributoryWage({
    insuranceCategory: "saudi_existing",
    wageMode: "override",
    contributoryWageOverrideHalalas: sar(4100),
    overrideReason: "Verified against GOSI registered wage",
    basicSalaryHalalas: sar(3500),
    housingAllowanceHalalas: sar(500),
  });
  assert.equal(wage.appliedHalalas, sar(4100));
  assert.equal(wage.source, "verified_override");
}

assert.throws(
  () => calculateGosi({ insuranceCategory: "gcc", payrollMonth: "2026-08", basicSalaryHalalas: sar(4000) }),
  /gosi_gcc_extension_policy_required/
);

assert.equal(calculateBasisPointAmount(101, 975), 10);
assert.equal(calculateBasisPointAmount(33333, 75), 250);

console.log("gosi-policy.test.mjs: PASS");
