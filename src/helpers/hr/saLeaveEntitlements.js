import {
  SA_LABOR_POLICY_VERSION,
  SA_SPECIAL_LEAVE_ENTITLEMENTS,
  sickLeavePayBps,
} from './saLaborPolicy.js';

export const SA_LEAVE_TYPES = Object.freeze({
  annual: 'annual',
  sick: 'sick',
  emergency: 'emergency',
  unpaid: 'unpaid',
  marriage: 'marriage',
  bereavementSpouseAscendantDescendant: 'bereavement_spouse_ascendant_descendant',
  bereavementSibling: 'bereavement_sibling',
  newborn: 'newborn',
  hajj: 'hajj',
  exam: 'exam',
  maternity: 'maternity',
  childMedicalCare: 'child_medical_care',
  widowMuslim: 'widow_muslim',
  widowNonMuslim: 'widow_non_muslim',
  overtimeCompTimeUse: 'overtime_comp_time_use',
  weeklyRestSubstituteUse: 'weekly_rest_substitute_use',
  otherHrReview: 'other_hr_review',
});

const KNOWN_LEAVE_TYPES = new Set(Object.values(SA_LEAVE_TYPES));

function cleanText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function dateKey(value, field) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`${field}_invalid`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${field}_invalid`);
  }
  return text;
}

function dateParts(value, field) {
  const normalized = dateKey(value, field);
  const [year, month, day] = normalized.split('-').map(Number);
  return { normalized, year, month, day };
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function anniversaryForYear(startDate, year) {
  const start = dateParts(startDate, 'startDate');
  if (start.month === 2 && start.day === 29 && !isLeapYear(year)) {
    return formatDate(year, 2, 28);
  }
  return formatDate(year, start.month, start.day);
}

function daysBetween(from, to) {
  const fromParts = dateParts(from, 'fromDate');
  const toParts = dateParts(to, 'toDate');
  const start = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day, 12);
  const end = Date.UTC(toParts.year, toParts.month - 1, toParts.day, 12);
  return Math.round((end - start) / 86400000);
}

function addDays(value, amount) {
  const parts = dateParts(value, 'date');
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount, 12));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function roundDays(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function requiredInstant(value, field) {
  const text = String(value ?? '').trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error(`${field}_timezone_required`);
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`${field}_invalid`);
  }
  return instant;
}

function riyadhDateFromInstant(instant) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function riyadhMidnightEpoch(value) {
  const normalized = dateKey(value, 'date');
  return Date.parse(`${normalized}T00:00:00+03:00`);
}

function roundPreciseDays(value) {
  return Math.round((Number(value) || 0) * 100000000) / 100000000;
}

function contractAnnualDays(value) {
  return Math.max(0, Number(value || 0) || 0);
}

function annualEntitlementForServiceYear(serviceYear, contractualDays) {
  const statutoryEntitlementDays =
    serviceYear.completedServiceYearsAtStart >= 5 ? 30 : 21;
  return {
    statutoryEntitlementDays,
    contractualEntitlementDays: contractualDays || null,
    annualEntitlementDays: Math.max(statutoryEntitlementDays, contractualDays),
  };
}

export function normalizeSaLeaveType(value) {
  const type = cleanText(value);
  if (KNOWN_LEAVE_TYPES.has(type)) return type;
  if (type === 'other' || type === 'general' || !type) {
    return SA_LEAVE_TYPES.otherHrReview;
  }
  return SA_LEAVE_TYPES.otherHrReview;
}

export function getSaLeaveTypePolicy(value) {
  const rawType = cleanText(value);
  const leaveType = normalizeSaLeaveType(rawType);
  const reviewRequired = leaveType === SA_LEAVE_TYPES.otherHrReview;

  const base = {
    leaveType,
    policyVersion: SA_LABOR_POLICY_VERSION,
    reviewRequired,
    deductAnnualBalance:
      leaveType === SA_LEAVE_TYPES.annual ||
      leaveType === SA_LEAVE_TYPES.emergency,
    affectsPayroll: leaveType === SA_LEAVE_TYPES.unpaid,
    entitlementBucket: null,
    documentationRequired: false,
    statutoryPaid: true,
  };

  switch (leaveType) {
    case SA_LEAVE_TYPES.annual:
      return { ...base, entitlementBucket: 'annual' };
    case SA_LEAVE_TYPES.emergency:
      return { ...base, entitlementBucket: 'annual' };
    case SA_LEAVE_TYPES.sick:
      return { ...base, entitlementBucket: 'sick_year', documentationRequired: true };
    case SA_LEAVE_TYPES.unpaid:
      return { ...base, statutoryPaid: false };
    case SA_LEAVE_TYPES.marriage:
      return { ...base, documentationRequired: true, maxStatutoryDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.marriageDays };
    case SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant:
      return { ...base, documentationRequired: true, maxStatutoryDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.spouseAscendantDescendantDeathDays };
    case SA_LEAVE_TYPES.bereavementSibling:
      return { ...base, documentationRequired: true, maxStatutoryDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.siblingDeathDays };
    case SA_LEAVE_TYPES.newborn:
      return {
        ...base,
        documentationRequired: true,
        maxStatutoryDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.newbornDays,
        useWithinDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.newbornUseWithinDays,
      };
    case SA_LEAVE_TYPES.hajj:
      return {
        ...base,
        documentationRequired: true,
        minStatutoryDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.hajjMinimumDays,
        maxStatutoryDays: SA_SPECIAL_LEAVE_ENTITLEMENTS.hajjMaximumDays,
        minimumServiceYears: SA_SPECIAL_LEAVE_ENTITLEMENTS.hajjMinimumServiceYears,
      };
    case SA_LEAVE_TYPES.exam:
      return { ...base, documentationRequired: true, reviewRequired: true };
    case SA_LEAVE_TYPES.maternity:
      return { ...base, documentationRequired: true };
    case SA_LEAVE_TYPES.childMedicalCare:
      return { ...base, documentationRequired: true };
    case SA_LEAVE_TYPES.widowMuslim:
    case SA_LEAVE_TYPES.widowNonMuslim:
      return { ...base, documentationRequired: true };
    case SA_LEAVE_TYPES.overtimeCompTimeUse:
      return { ...base, entitlementBucket: 'overtime_comp', documentationRequired: true };
    case SA_LEAVE_TYPES.weeklyRestSubstituteUse:
      return { ...base, entitlementBucket: 'weekly_rest_due', documentationRequired: true };
    default:
      return { ...base, statutoryPaid: false, reviewRequired: true };
  }
}

export function completedServiceYears(startDateValue, asOfDateValue) {
  const start = dateParts(startDateValue, 'startDate');
  const asOf = dateParts(asOfDateValue, 'asOfDate');
  if (asOf.normalized < start.normalized) return 0;

  let years = asOf.year - start.year;
  const anniversary = anniversaryForYear(start.normalized, asOf.year);
  if (asOf.normalized < anniversary) years -= 1;
  return Math.max(0, years);
}

export function annualLeaveStatutoryMinimumDays(startDateValue, asOfDateValue) {
  return completedServiceYears(startDateValue, asOfDateValue) >= 5 ? 30 : 21;
}

export function annualLeaveServiceYear(startDateValue, asOfDateValue) {
  const start = dateParts(startDateValue, 'startDate');
  const asOf = dateParts(asOfDateValue, 'asOfDate');
  if (asOf.normalized < start.normalized) {
    throw new Error('asOfDate_before_startDate');
  }

  let startYear = asOf.year;
  let serviceYearStart = anniversaryForYear(start.normalized, startYear);
  if (serviceYearStart > asOf.normalized) {
    startYear -= 1;
    serviceYearStart = anniversaryForYear(start.normalized, startYear);
  }

  if (serviceYearStart < start.normalized) serviceYearStart = start.normalized;
  const serviceYearEnd = anniversaryForYear(start.normalized, startYear + 1);

  return {
    serviceYearStart,
    serviceYearEnd,
    completedServiceYearsAtStart: completedServiceYears(start.normalized, serviceYearStart),
  };
}

export function calculateAnnualLeaveAccrual(input = {}) {
  const startDate = dateKey(input.startDate, 'startDate');
  const asOfDate = dateKey(input.asOfDate, 'asOfDate');
  const serviceYear = annualLeaveServiceYear(startDate, asOfDate);
  const contractualDays = contractAnnualDays(input.contractAnnualDays);
  const entitlement = annualEntitlementForServiceYear(serviceYear, contractualDays);
  const periodDays = daysBetween(serviceYear.serviceYearStart, serviceYear.serviceYearEnd);
  const asOfExclusive = addDays(asOfDate, 1);
  const accrualEndExclusive = asOfExclusive < serviceYear.serviceYearEnd
    ? asOfExclusive
    : serviceYear.serviceYearEnd;
  const elapsedDays = Math.max(
    0,
    Math.min(periodDays, daysBetween(serviceYear.serviceYearStart, accrualEndExclusive))
  );
  const accruedDays = periodDays > 0
    ? roundDays(entitlement.annualEntitlementDays * elapsedDays / periodDays)
    : 0;

  return {
    policyVersion: SA_LABOR_POLICY_VERSION,
    startDate,
    asOfDate,
    serviceYearStart: serviceYear.serviceYearStart,
    serviceYearEnd: serviceYear.serviceYearEnd,
    completedServiceYearsAtStart: serviceYear.completedServiceYearsAtStart,
    ...entitlement,
    periodDays,
    elapsedDays,
    accruedDays,
  };
}

export function calculateAnnualLeaveLiveAccrual(input = {}) {
  const startDate = dateKey(input.startDate, 'startDate');
  const asOfInstant = requiredInstant(input.asOfDateTime, 'asOfDateTime');
  const asOfDate = riyadhDateFromInstant(asOfInstant);

  if (asOfDate < startDate) {
    throw new Error('asOfDateTime_before_startDate');
  }

  const serviceYear = annualLeaveServiceYear(startDate, asOfDate);
  const contractualDays = contractAnnualDays(input.contractAnnualDays);
  const entitlement = annualEntitlementForServiceYear(
    serviceYear,
    contractualDays
  );

  const periodStartEpoch = riyadhMidnightEpoch(
    serviceYear.serviceYearStart
  );
  const periodEndEpoch = riyadhMidnightEpoch(
    serviceYear.serviceYearEnd
  );
  const periodMilliseconds = periodEndEpoch - periodStartEpoch;
  const accrualEndEpoch = Math.min(
    periodEndEpoch,
    Math.max(periodStartEpoch, asOfInstant.getTime())
  );
  const elapsedMilliseconds = Math.max(
    0,
    accrualEndEpoch - periodStartEpoch
  );

  const accruedDays = periodMilliseconds > 0
    ? roundPreciseDays(
        entitlement.annualEntitlementDays *
          elapsedMilliseconds /
          periodMilliseconds
      )
    : 0;

  return {
    policyVersion: SA_LABOR_POLICY_VERSION,
    startDate,
    asOfDate,
    asOfDateTime: asOfInstant.toISOString(),
    serviceYearStart: serviceYear.serviceYearStart,
    serviceYearEnd: serviceYear.serviceYearEnd,
    completedServiceYearsAtStart:
      serviceYear.completedServiceYearsAtStart,
    ...entitlement,
    periodDays: daysBetween(
      serviceYear.serviceYearStart,
      serviceYear.serviceYearEnd
    ),
    elapsedMinutes: Math.floor(elapsedMilliseconds / 60000),
    accruedDays,
  };
}

export function calculateAnnualLeaveLiveAccrualRange(input = {}) {
  const startDate = dateKey(input.startDate, 'startDate');
  const asOfInstant = requiredInstant(input.asOfDateTime, 'asOfDateTime');
  const asOfDate = riyadhDateFromInstant(asOfInstant);
  const contractualDays = contractAnnualDays(input.contractAnnualDays);

  if (asOfDate < startDate) {
    throw new Error('asOfDateTime_before_startDate');
  }

  let fromExclusiveDate = null;
  let cursorDate = startDate;

  if (
    input.fromExclusiveDate !== undefined &&
    input.fromExclusiveDate !== null &&
    String(input.fromExclusiveDate).trim() !== ''
  ) {
    fromExclusiveDate = dateKey(
      input.fromExclusiveDate,
      'fromExclusiveDate'
    );

    if (fromExclusiveDate >= startDate) {
      cursorDate = addDays(fromExclusiveDate, 1);
    }
  }

  let cursorEpoch = riyadhMidnightEpoch(cursorDate);
  const asOfEpoch = asOfInstant.getTime();

  if (cursorEpoch >= asOfEpoch) {
    return {
      policyVersion: SA_LABOR_POLICY_VERSION,
      startDate,
      fromExclusiveDate,
      asOfDate,
      asOfDateTime: asOfInstant.toISOString(),
      accruedDays: 0,
      elapsedMinutes: 0,
      segments: [],
    };
  }

  const segments = [];
  let total = 0;
  let totalElapsedMilliseconds = 0;
  let guard = 0;

  while (cursorEpoch < asOfEpoch) {
    guard += 1;
    if (guard > 200) {
      throw new Error('annual_live_accrual_range_too_large');
    }

    const cursorBusinessDate = riyadhDateFromInstant(
      new Date(cursorEpoch)
    );
    const serviceYear = annualLeaveServiceYear(
      startDate,
      cursorBusinessDate
    );
    const entitlement = annualEntitlementForServiceYear(
      serviceYear,
      contractualDays
    );

    const serviceYearEndEpoch = riyadhMidnightEpoch(
      serviceYear.serviceYearEnd
    );
    const segmentEndEpoch = Math.min(
      serviceYearEndEpoch,
      asOfEpoch
    );
    const elapsedMilliseconds = Math.max(
      0,
      segmentEndEpoch - cursorEpoch
    );
    const periodMilliseconds =
      serviceYearEndEpoch -
      riyadhMidnightEpoch(serviceYear.serviceYearStart);

    const accruedDays = periodMilliseconds > 0
      ? entitlement.annualEntitlementDays *
        elapsedMilliseconds /
        periodMilliseconds
      : 0;

    segments.push({
      serviceYearStart: serviceYear.serviceYearStart,
      serviceYearEnd: serviceYear.serviceYearEnd,
      fromDateTime: new Date(cursorEpoch).toISOString(),
      toDateTimeExclusive: new Date(
        segmentEndEpoch
      ).toISOString(),
      completedServiceYearsAtStart:
        serviceYear.completedServiceYearsAtStart,
      ...entitlement,
      elapsedMinutes: Math.floor(
        elapsedMilliseconds / 60000
      ),
      accruedDays: roundPreciseDays(accruedDays),
    });

    total += accruedDays;
    totalElapsedMilliseconds += elapsedMilliseconds;
    cursorEpoch = segmentEndEpoch;
  }

  return {
    policyVersion: SA_LABOR_POLICY_VERSION,
    startDate,
    fromExclusiveDate,
    asOfDate,
    asOfDateTime: asOfInstant.toISOString(),
    accruedDays: roundPreciseDays(total),
    elapsedMinutes: Math.floor(
      totalElapsedMilliseconds / 60000
    ),
    segments,
  };
}

export function calculateAnnualLeaveAccrualRange(input = {}) {
  const startDate = dateKey(input.startDate, 'startDate');
  const asOfDate = dateKey(input.asOfDate, 'asOfDate');
  const contractualDays = contractAnnualDays(input.contractAnnualDays);

  if (asOfDate < startDate) {
    throw new Error('asOfDate_before_startDate');
  }

  let cursor = startDate;
  let fromExclusiveDate = null;

  if (
    input.fromExclusiveDate !== undefined &&
    input.fromExclusiveDate !== null &&
    String(input.fromExclusiveDate).trim() !== ''
  ) {
    fromExclusiveDate = dateKey(input.fromExclusiveDate, 'fromExclusiveDate');
    if (fromExclusiveDate >= startDate) {
      cursor = addDays(fromExclusiveDate, 1);
    }
  }

  if (cursor > asOfDate) {
    return {
      policyVersion: SA_LABOR_POLICY_VERSION,
      startDate,
      fromExclusiveDate,
      asOfDate,
      accruedDays: 0,
      segments: [],
    };
  }

  const asOfExclusive = addDays(asOfDate, 1);
  const segments = [];
  let total = 0;
  let guard = 0;

  while (cursor < asOfExclusive) {
    guard += 1;
    if (guard > 200) throw new Error('annual_accrual_range_too_large');

    const serviceYear = annualLeaveServiceYear(startDate, cursor);
    const entitlement = annualEntitlementForServiceYear(serviceYear, contractualDays);
    const periodDays = daysBetween(serviceYear.serviceYearStart, serviceYear.serviceYearEnd);
    const segmentEndExclusive =
      serviceYear.serviceYearEnd < asOfExclusive
        ? serviceYear.serviceYearEnd
        : asOfExclusive;
    const elapsedDays = Math.max(0, daysBetween(cursor, segmentEndExclusive));
    const accruedDays = periodDays > 0
      ? entitlement.annualEntitlementDays * elapsedDays / periodDays
      : 0;

    segments.push({
      serviceYearStart: serviceYear.serviceYearStart,
      serviceYearEnd: serviceYear.serviceYearEnd,
      fromDate: cursor,
      toDateExclusive: segmentEndExclusive,
      completedServiceYearsAtStart: serviceYear.completedServiceYearsAtStart,
      ...entitlement,
      periodDays,
      elapsedDays,
      accruedDays: roundDays(accruedDays),
    });

    total += accruedDays;
    cursor = segmentEndExclusive;
  }

  return {
    policyVersion: SA_LABOR_POLICY_VERSION,
    startDate,
    fromExclusiveDate,
    asOfDate,
    accruedDays: roundDays(total),
    segments,
  };
}

export function calculateAnnualLeaveAvailable(input = {}) {
  const startDate = dateKey(input.startDate, 'startDate');
  const asOfDate = dateKey(input.asOfDate, 'asOfDate');
  const contractualDays = contractAnnualDays(input.contractAnnualDays);
  const openingBalanceDays = Number(input.openingBalanceDays || 0) || 0;
  const postOpeningNetDays = Number(
    input.postOpeningNetDays ?? input.persistedNetDays ?? 0
  ) || 0;

  let openingBalanceEffectiveDate = null;
  if (
    input.openingBalanceEffectiveDate !== undefined &&
    input.openingBalanceEffectiveDate !== null &&
    String(input.openingBalanceEffectiveDate).trim() !== ''
  ) {
    openingBalanceEffectiveDate = dateKey(
      input.openingBalanceEffectiveDate,
      'openingBalanceEffectiveDate'
    );
    if (openingBalanceEffectiveDate < startDate) {
      throw new Error('openingBalanceEffectiveDate_before_startDate');
    }
  }

  const openingApplied =
    Boolean(openingBalanceEffectiveDate) &&
    openingBalanceEffectiveDate <= asOfDate;

  const liveAccrual = calculateAnnualLeaveAccrualRange({
    startDate,
    asOfDate,
    contractAnnualDays: contractualDays,
    fromExclusiveDate: openingApplied
      ? openingBalanceEffectiveDate
      : null,
  });

  const effectiveOpeningBalanceDays = openingApplied
    ? openingBalanceDays
    : 0;
  const effectivePostOpeningNetDays = openingApplied || !openingBalanceEffectiveDate
    ? postOpeningNetDays
    : 0;
  const availableDays = roundDays(
    effectiveOpeningBalanceDays +
      liveAccrual.accruedDays +
      effectivePostOpeningNetDays
  );

  return {
    policyVersion: SA_LABOR_POLICY_VERSION,
    startDate,
    asOfDate,
    openingBalanceEffectiveDate,
    openingApplied,
    openingBalanceDays: roundDays(effectiveOpeningBalanceDays),
    accruedSinceAnchorDays: liveAccrual.accruedDays,
    postOpeningNetDays: roundDays(effectivePostOpeningNetDays),
    availableDays,
    accrualSegments: liveAccrual.segments,
  };
}

export function calculateSickLeaveSegments(input = {}) {
  const usedDaysBefore = Math.max(0, Number(input.usedDaysBefore || 0) || 0);
  const requestedDays = Math.max(0, Number(input.requestedDays || 0) || 0);
  if (requestedDays <= 0) return [];

  const segments = [];
  let remaining = requestedDays;
  let ordinal = Math.floor(usedDaysBefore) + 1;

  while (remaining > 0.000001) {
    const payRateBps = sickLeavePayBps(ordinal);
    if (payRateBps === null) {
      segments.push({
        ordinalFrom: ordinal,
        ordinalTo: ordinal + Math.ceil(remaining) - 1,
        days: roundDays(remaining),
        payRateBps: 0,
        reviewRequired: true,
      });
      break;
    }

    const bandEnd = ordinal <= 30 ? 30 : ordinal <= 90 ? 90 : 120;
    const capacity = bandEnd - ordinal + 1;
    const days = Math.min(remaining, capacity);
    segments.push({
      ordinalFrom: ordinal,
      ordinalTo: ordinal + Math.ceil(days) - 1,
      days: roundDays(days),
      payRateBps,
      reviewRequired: false,
    });
    remaining = roundDays(remaining - days);
    ordinal += Math.ceil(days);
  }

  return segments;
}
