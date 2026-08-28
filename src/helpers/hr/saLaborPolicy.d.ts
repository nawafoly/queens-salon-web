export const SA_LABOR_POLICY_VERSION: string;

export const SA_LABOR_LIMITS: Readonly<{
  standardDailyHours: number;
  standardWeeklyHours: number;
  ramadanReducedDailyHours: number;
  ramadanReducedWeeklyHours: number;
  maxContinuousWorkHours: number;
  minimumBreakMinutes: number;
  maxWorkplacePresenceHours: number;
  weeklyRestMinimumHours: number;
  overtimeAnnualHoursWithoutAdditionalConsent: number;
  compensatoryLeaveMinimumRatio: number;
  compensatoryLeaveDefaultUseWithinDays: number;
  compensatoryLeaveAnnualMaxDays: number;
  generalDeductionCapBps: number;
  employerLoanDeductionCapBps: number;
  courtOrderDefaultDeductionCapBps: number;
}>;

export const SA_PUBLIC_HOLIDAY_ENTITLEMENTS: Readonly<{
  eidAlFitrDays: number;
  eidAlAdhaDays: number;
  nationalDayDays: number;
  foundingDayDays: number;
}>;

export const SA_SPECIAL_LEAVE_ENTITLEMENTS: Readonly<{
  marriageDays: number;
  spouseAscendantDescendantDeathDays: number;
  siblingDeathDays: number;
  newbornDays: number;
  newbornUseWithinDays: number;
  hajjMinimumDays: number;
  hajjMaximumDays: number;
  hajjMinimumServiceYears: number;
  maternityWeeks: number;
  maternityMandatoryPostBirthWeeks: number;
  maternityUnpaidExtensionDays: number;
  childMedicalCarePaidDays: number;
  childMedicalCareUnpaidExtensionDays: number;
  nonMuslimWidowDays: number;
}>;

export type SaLaborWageInput = {
  baseSalaryHalalas?: number | null;
  allowancesHalalas?: number | null;
  housingAllowanceHalalas?: number | null;
  transportationAllowanceHalalas?: number | null;
  otherAllowancesHalalas?: number | null;
  additionalActualWageHalalas?: number | null;
  actualWageOverrideHalalas?: number | null;
  dailyNormalHours?: number | null;
  overtimeMinutes?: number | null;
  basicPremiumBps?: number | null;
};

export type SaLaborHourlyRates = {
  reviewRequired: boolean;
  reason: string | null;
  actualHourlyHalalas: number;
  basicHourlyHalalas: number;
};

export type SaLaborOvertimeResult = SaLaborHourlyRates & {
  overtimeMinutes: number;
  premiumBps?: number;
  overtimeHourlyHalalas?: number;
  amountHalalas: number;
};

export function calculateFixedActualWageHalalas(
  input?: SaLaborWageInput
): number;

export function calculateMonthlyDailyWageHalalas(
  input?: SaLaborWageInput
): number;

export function calculateStatutoryHourlyRates(
  input?: SaLaborWageInput
): SaLaborHourlyRates;

export function calculateStatutoryOvertimeHalalas(
  input?: SaLaborWageInput
): SaLaborOvertimeResult;

export function calculateCompensatoryLeaveMinutes(
  overtimeMinutes: number,
  ratio?: number
): number;

export function annualLeaveMinimumDays(
  serviceYears: number
): number;

export function sickLeavePayBps(
  dayOrdinal: number
): number | null;

export function generalDeductionCapHalalas(
  wageHalalas: number
): number;

export function employerLoanDeductionCapHalalas(
  wageHalalas: number
): number;

export function courtOrderDefaultDeductionCapHalalas(
  wageHalalas: number
): number;

export function weeklyRestCashSubstitutionAllowed(): false;

export function annualLeaveCashSubstitutionDuringServiceAllowed(): false;