export const GOSI_POLICY_VERSION = "saudi-social-insurance-2024-v1";

export const GOSI_INSURANCE_CATEGORIES = Object.freeze({
  SAUDI_EXISTING: "saudi_existing",
  SAUDI_NEW: "saudi_new",
  GCC: "gcc",
  NON_SAUDI: "non_saudi",
});

export const GOSI_WAGE_MODES = Object.freeze({
  DERIVED: "derived",
  OVERRIDE: "override",
});

const PENSION_MIN_WAGE_HALALAS = 1500 * 100;
const HAZARDS_MIN_WAGE_HALALAS = 400 * 100;
const MAX_WAGE_HALALAS = 45000 * 100;
const SANED_RATE_BPS = 75;
const OCCUPATIONAL_HAZARD_RATE_BPS = 200;
const EXISTING_PENSION_RATE_BPS = 900;

const NEW_SYSTEM_PENSION_SCHEDULE = Object.freeze([
  Object.freeze({ effectiveFrom: "2024-07-03", rateBps: 900 }),
  Object.freeze({ effectiveFrom: "2025-07-01", rateBps: 950 }),
  Object.freeze({ effectiveFrom: "2026-07-01", rateBps: 1000 }),
  Object.freeze({ effectiveFrom: "2027-07-01", rateBps: 1050 }),
  Object.freeze({ effectiveFrom: "2028-07-01", rateBps: 1100 }),
]);

function intMoney(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  throw new Error("gosi_payroll_date_required");
}

function assertCategory(category) {
  const normalized = String(category || "").trim();
  if (!Object.values(GOSI_INSURANCE_CATEGORIES).includes(normalized)) {
    throw new Error("gosi_insurance_category_required");
  }
  return normalized;
}

function assertBasisPoints(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10000) {
    throw new Error("gosi_invalid_basis_points");
  }
  return number;
}

export function calculateBasisPointAmount(amountHalalas, rateBasisPoints) {
  const amount = intMoney(amountHalalas);
  const rate = assertBasisPoints(rateBasisPoints);
  if (amount === 0 || rate === 0) return 0;
  const rounded = (BigInt(amount) * BigInt(rate) + 5000n) / 10000n;
  return Number(rounded);
}

export function resolveSaudiNewPensionRate(payrollDate) {
  const date = normalizeDate(payrollDate);
  let matched = null;
  for (const item of NEW_SYSTEM_PENSION_SCHEDULE) {
    if (date >= item.effectiveFrom) matched = item;
  }
  if (!matched) throw new Error("gosi_new_system_not_effective");
  return { ...matched };
}

export function resolveGosiContributoryWage(input) {
  const category = assertCategory(input?.insuranceCategory);
  if (category === GOSI_INSURANCE_CATEGORIES.GCC) {
    throw new Error("gosi_gcc_extension_policy_required");
  }

  const basicSalaryHalalas = intMoney(input?.basicSalaryHalalas);
  const housingAllowanceHalalas = intMoney(input?.housingAllowanceHalalas);
  const transportationAllowanceHalalas = intMoney(input?.transportationAllowanceHalalas);
  const otherAllowancesHalalas = intMoney(input?.otherAllowancesHalalas);
  const wageMode = String(input?.wageMode || GOSI_WAGE_MODES.DERIVED).trim();

  if (!Object.values(GOSI_WAGE_MODES).includes(wageMode)) {
    throw new Error("gosi_invalid_wage_mode");
  }

  const derivedHalalas = basicSalaryHalalas + housingAllowanceHalalas;
  const overrideHalalas = intMoney(input?.contributoryWageOverrideHalalas);
  const rawHalalas = wageMode === GOSI_WAGE_MODES.OVERRIDE ? overrideHalalas : derivedHalalas;

  if (rawHalalas <= 0) {
    throw new Error("gosi_contributory_wage_required");
  }
  if (wageMode === GOSI_WAGE_MODES.OVERRIDE && !String(input?.overrideReason || "").trim()) {
    throw new Error("gosi_contributory_wage_override_reason_required");
  }

  const minimumHalalas =
    category === GOSI_INSURANCE_CATEGORIES.NON_SAUDI
      ? HAZARDS_MIN_WAGE_HALALAS
      : PENSION_MIN_WAGE_HALALAS;
  const appliedHalalas = Math.min(MAX_WAGE_HALALAS, Math.max(minimumHalalas, rawHalalas));

  return {
    mode: wageMode,
    source: wageMode === GOSI_WAGE_MODES.OVERRIDE ? "verified_override" : "basic_plus_housing",
    rawHalalas,
    appliedHalalas,
    minimumHalalas,
    maximumHalalas: MAX_WAGE_HALALAS,
    wasFloored: appliedHalalas > rawHalalas,
    wasCapped: appliedHalalas < rawHalalas,
    overrideReason:
      wageMode === GOSI_WAGE_MODES.OVERRIDE ? String(input?.overrideReason || "").trim() : null,
    components: {
      basicSalaryHalalas,
      housingAllowanceHalalas,
      transportationAllowanceHalalas,
      otherAllowancesHalalas,
      transportationIncluded: false,
      otherAllowancesIncluded: false,
    },
  };
}

function branchAmount(wageHalalas, rateBps) {
  return calculateBasisPointAmount(wageHalalas, rateBps);
}

export function calculateGosi(input) {
  const insuranceCategory = assertCategory(input?.insuranceCategory);
  const payrollDate = normalizeDate(input?.payrollDate || input?.payrollMonth);

  if (insuranceCategory === GOSI_INSURANCE_CATEGORIES.GCC) {
    throw new Error("gosi_gcc_extension_policy_required");
  }

  const contributoryWage = resolveGosiContributoryWage({ ...input, insuranceCategory });
  const wageHalalas = contributoryWage.appliedHalalas;

  let scheme;
  let pensionRateBps = 0;
  let pensionEffectiveFrom = null;
  let sanedRateBps = 0;
  let occupationalHazardRateBps = OCCUPATIONAL_HAZARD_RATE_BPS;

  if (insuranceCategory === GOSI_INSURANCE_CATEGORIES.SAUDI_EXISTING) {
    scheme = "saudi_existing_system";
    pensionRateBps = EXISTING_PENSION_RATE_BPS;
    sanedRateBps = SANED_RATE_BPS;
  } else if (insuranceCategory === GOSI_INSURANCE_CATEGORIES.SAUDI_NEW) {
    scheme = "saudi_new_system";
    const pensionPolicy = resolveSaudiNewPensionRate(payrollDate);
    pensionRateBps = pensionPolicy.rateBps;
    pensionEffectiveFrom = pensionPolicy.effectiveFrom;
    sanedRateBps = SANED_RATE_BPS;
  } else {
    scheme = "non_saudi_occupational_hazards";
    occupationalHazardRateBps = OCCUPATIONAL_HAZARD_RATE_BPS;
  }

  const employeePensionHalalas = branchAmount(wageHalalas, pensionRateBps);
  const employeeSanedHalalas = branchAmount(wageHalalas, sanedRateBps);
  const employeeDeductionHalalas = employeePensionHalalas + employeeSanedHalalas;

  const employerPensionHalalas = branchAmount(wageHalalas, pensionRateBps);
  const employerSanedHalalas = branchAmount(wageHalalas, sanedRateBps);
  const employerOccupationalHazardHalalas = branchAmount(wageHalalas, occupationalHazardRateBps);
  const employerContributionHalalas =
    employerPensionHalalas + employerSanedHalalas + employerOccupationalHazardHalalas;

  return {
    policyVersion: GOSI_POLICY_VERSION,
    policyEffectiveDate: pensionEffectiveFrom,
    payrollDate,
    insuranceCategory,
    scheme,
    roundingMode: "nearest_halalah_half_up_per_branch",
    contributoryWage,
    employee: {
      pensionRateBps,
      sanedRateBps,
      totalRateBps: pensionRateBps + sanedRateBps,
      pensionContributionHalalas: employeePensionHalalas,
      sanedContributionHalalas: employeeSanedHalalas,
      deductionHalalas: employeeDeductionHalalas,
    },
    employer: {
      pensionRateBps,
      sanedRateBps,
      occupationalHazardRateBps,
      totalRateBps: pensionRateBps + sanedRateBps + occupationalHazardRateBps,
      pensionContributionHalalas: employerPensionHalalas,
      sanedContributionHalalas: employerSanedHalalas,
      occupationalHazardContributionHalalas: employerOccupationalHazardHalalas,
      contributionHalalas: employerContributionHalalas,
    },
  };
}
