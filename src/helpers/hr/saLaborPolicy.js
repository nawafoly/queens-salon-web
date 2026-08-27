export const SA_LABOR_POLICY_VERSION = "sa-labor-2025-amended-v1";

export const SA_LABOR_LIMITS = Object.freeze({
  standardDailyHours: 8,
  standardWeeklyHours: 48,
  ramadanReducedDailyHours: 6,
  ramadanReducedWeeklyHours: 36,
  maxContinuousWorkHours: 5,
  minimumBreakMinutes: 30,
  maxWorkplacePresenceHours: 12,
  weeklyRestMinimumHours: 24,
  overtimeAnnualHoursWithoutAdditionalConsent: 720,
  compensatoryLeaveMinimumRatio: 1.5,
  compensatoryLeaveDefaultUseWithinDays: 60,
  compensatoryLeaveAnnualMaxDays: 30,
  generalDeductionCapBps: 5000,
  employerLoanDeductionCapBps: 1000,
  courtOrderDefaultDeductionCapBps: 2500,
});

export const SA_PUBLIC_HOLIDAY_ENTITLEMENTS = Object.freeze({
  eidAlFitrDays: 4,
  eidAlAdhaDays: 4,
  nationalDayDays: 1,
  foundingDayDays: 1,
});

export const SA_SPECIAL_LEAVE_ENTITLEMENTS = Object.freeze({
  marriageDays: 5,
  spouseAscendantDescendantDeathDays: 5,
  siblingDeathDays: 3,
  newbornDays: 3,
  newbornUseWithinDays: 7,
  hajjMinimumDays: 10,
  hajjMaximumDays: 15,
  hajjMinimumServiceYears: 2,
  maternityWeeks: 12,
  maternityMandatoryPostBirthWeeks: 6,
  maternityUnpaidExtensionDays: 30,
  childMedicalCarePaidDays: 30,
  childMedicalCareUnpaidExtensionDays: 30,
  nonMuslimWidowDays: 15,
});

function nonNegativeMoney(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}

function positiveNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function calculateFixedActualWageHalalas(input = {}) {
  const override = nonNegativeMoney(input.actualWageOverrideHalalas);
  if (override > 0) return override;

  const hasAggregateAllowances =
    input.allowancesHalalas !== undefined &&
    input.allowancesHalalas !== null &&
    input.allowancesHalalas !== "";

  const fixedAllowancesHalalas = hasAggregateAllowances
    ? nonNegativeMoney(input.allowancesHalalas)
    : nonNegativeMoney(input.housingAllowanceHalalas) +
      nonNegativeMoney(input.transportationAllowanceHalalas) +
      nonNegativeMoney(input.otherAllowancesHalalas);

  return (
    nonNegativeMoney(input.baseSalaryHalalas) +
    fixedAllowancesHalalas +
    nonNegativeMoney(input.additionalActualWageHalalas)
  );
}

export function calculateMonthlyDailyWageHalalas(input = {}) {
  return Math.max(
    0,
    Math.round(calculateFixedActualWageHalalas(input) / 30)
  );
}

export function calculateStatutoryHourlyRates(input = {}) {
  const dailyNormalHours = positiveNumber(input.dailyNormalHours);
  if (dailyNormalHours <= 0) {
    return {
      reviewRequired: true,
      reason: "daily_normal_hours_required",
      actualHourlyHalalas: 0,
      basicHourlyHalalas: 0,
    };
  }

  const actualWageHalalas = calculateFixedActualWageHalalas(input);
  const basicSalaryHalalas = nonNegativeMoney(input.baseSalaryHalalas);

  return {
    reviewRequired: false,
    reason: null,
    actualHourlyHalalas: Math.round(
      actualWageHalalas / 30 / dailyNormalHours
    ),
    basicHourlyHalalas: Math.round(
      basicSalaryHalalas / 30 / dailyNormalHours
    ),
  };
}

export function calculateStatutoryOvertimeHalalas(input = {}) {
  const overtimeMinutes = positiveNumber(input.overtimeMinutes);
  const rates = calculateStatutoryHourlyRates(input);

  if (rates.reviewRequired || overtimeMinutes <= 0) {
    return {
      reviewRequired: rates.reviewRequired,
      reason: rates.reason,
      overtimeMinutes,
      actualHourlyHalalas: rates.actualHourlyHalalas,
      basicHourlyHalalas: rates.basicHourlyHalalas,
      premiumBps: 5000,
      amountHalalas: 0,
    };
  }

  const configuredPremiumBps = Math.max(
    5000,
    Math.round(Number(input.basicPremiumBps ?? 5000) || 5000)
  );

  const overtimeHourlyHalalas =
    rates.actualHourlyHalalas +
    Math.round(
      rates.basicHourlyHalalas *
        configuredPremiumBps /
        10000
    );

  return {
    reviewRequired: false,
    reason: null,
    overtimeMinutes,
    actualHourlyHalalas: rates.actualHourlyHalalas,
    basicHourlyHalalas: rates.basicHourlyHalalas,
    premiumBps: configuredPremiumBps,
    overtimeHourlyHalalas,
    amountHalalas: Math.round(
      overtimeHourlyHalalas *
        overtimeMinutes /
        60
    ),
  };
}

export function calculateCompensatoryLeaveMinutes(
  overtimeMinutes,
  ratio = SA_LABOR_LIMITS.compensatoryLeaveMinimumRatio
) {
  const minutes = positiveNumber(overtimeMinutes);
  const normalizedRatio = Math.max(
    SA_LABOR_LIMITS.compensatoryLeaveMinimumRatio,
    Number(ratio) ||
      SA_LABOR_LIMITS.compensatoryLeaveMinimumRatio
  );

  return Math.round(minutes * normalizedRatio);
}

export function annualLeaveMinimumDays(serviceYears) {
  const years = Math.max(0, Number(serviceYears || 0) || 0);
  return years >= 5 ? 30 : 21;
}

export function sickLeavePayBps(dayOrdinal) {
  const day = Math.floor(Number(dayOrdinal || 0));

  if (day < 1) return null;
  if (day <= 30) return 10000;
  if (day <= 90) return 7500;
  if (day <= 120) return 0;

  return null;
}

export function generalDeductionCapHalalas(wageHalalas) {
  return Math.max(
    0,
    Math.floor(
      nonNegativeMoney(wageHalalas) *
        SA_LABOR_LIMITS.generalDeductionCapBps /
        10000
    )
  );
}

export function employerLoanDeductionCapHalalas(wageHalalas) {
  return Math.max(
    0,
    Math.floor(
      nonNegativeMoney(wageHalalas) *
        SA_LABOR_LIMITS.employerLoanDeductionCapBps /
        10000
    )
  );
}

export function courtOrderDefaultDeductionCapHalalas(wageHalalas) {
  return Math.max(
    0,
    Math.floor(
      nonNegativeMoney(wageHalalas) *
        SA_LABOR_LIMITS.courtOrderDefaultDeductionCapBps /
        10000
    )
  );
}

export function weeklyRestCashSubstitutionAllowed() {
  return false;
}

export function annualLeaveCashSubstitutionDuringServiceAllowed() {
  return false;
}