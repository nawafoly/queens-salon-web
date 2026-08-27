export type GosiInsuranceCategory = "saudi_existing" | "saudi_new" | "gcc" | "non_saudi";
export type GosiWageMode = "derived" | "override";

export const GOSI_POLICY_VERSION: string;
export const GOSI_INSURANCE_CATEGORIES: Readonly<{
  SAUDI_EXISTING: "saudi_existing";
  SAUDI_NEW: "saudi_new";
  GCC: "gcc";
  NON_SAUDI: "non_saudi";
}>;
export const GOSI_WAGE_MODES: Readonly<{ DERIVED: "derived"; OVERRIDE: "override" }>;

export type GosiCalculationInput = {
  insuranceCategory: GosiInsuranceCategory;
  payrollDate?: string;
  payrollMonth?: string;
  basicSalaryHalalas: number;
  housingAllowanceHalalas?: number;
  transportationAllowanceHalalas?: number;
  otherAllowancesHalalas?: number;
  wageMode?: GosiWageMode;
  contributoryWageOverrideHalalas?: number | null;
  overrideReason?: string | null;
};

export type GosiContributoryWageSnapshot = {
  mode: GosiWageMode;
  source: "basic_plus_housing" | "verified_override";
  rawHalalas: number;
  appliedHalalas: number;
  minimumHalalas: number;
  maximumHalalas: number;
  wasFloored: boolean;
  wasCapped: boolean;
  overrideReason: string | null;
  components: {
    basicSalaryHalalas: number;
    housingAllowanceHalalas: number;
    transportationAllowanceHalalas: number;
    otherAllowancesHalalas: number;
    transportationIncluded: false;
    otherAllowancesIncluded: false;
  };
};

export type GosiSnapshot = {
  policyVersion: string;
  policyEffectiveDate: string | null;
  payrollDate: string;
  insuranceCategory: GosiInsuranceCategory;
  scheme: "saudi_existing_system" | "saudi_new_system" | "non_saudi_occupational_hazards";
  roundingMode: "nearest_halalah_half_up_per_branch";
  contributoryWage: GosiContributoryWageSnapshot;
  employee: {
    pensionRateBps: number;
    sanedRateBps: number;
    totalRateBps: number;
    pensionContributionHalalas: number;
    sanedContributionHalalas: number;
    deductionHalalas: number;
  };
  employer: {
    pensionRateBps: number;
    sanedRateBps: number;
    occupationalHazardRateBps: number;
    totalRateBps: number;
    pensionContributionHalalas: number;
    sanedContributionHalalas: number;
    occupationalHazardContributionHalalas: number;
    contributionHalalas: number;
  };
};

export function calculateBasisPointAmount(amountHalalas: number, rateBasisPoints: number): number;
export function resolveSaudiNewPensionRate(payrollDate: string): { effectiveFrom: string; rateBps: number };
export function resolveGosiContributoryWage(input: GosiCalculationInput): GosiContributoryWageSnapshot;
export function calculateGosi(input: GosiCalculationInput): GosiSnapshot;
