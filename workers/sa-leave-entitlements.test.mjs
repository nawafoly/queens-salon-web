import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SA_LEAVE_TYPES,
  annualLeaveStatutoryMinimumDays,
  calculateAnnualLeaveAccrual,
  calculateAnnualLeaveAccrualRange,
  calculateAnnualLeaveAvailable,
  calculateSickLeaveSegments,
  completedServiceYears,
  getSaLeaveTypePolicy,
  normalizeSaLeaveType,
} from '../src/helpers/hr/saLeaveEntitlements.js';

test('annual statutory entitlement changes on exact five-year anniversary', () => {
  assert.equal(completedServiceYears('2021-08-28', '2026-08-27'), 4);
  assert.equal(completedServiceYears('2021-08-28', '2026-08-28'), 5);
  assert.equal(annualLeaveStatutoryMinimumDays('2021-08-28', '2026-08-27'), 21);
  assert.equal(annualLeaveStatutoryMinimumDays('2021-08-28', '2026-08-28'), 30);
});

test('annual accrual uses service anniversary year and actual period days', () => {
  const result = calculateAnnualLeaveAccrual({
    startDate: '2024-02-29',
    asOfDate: '2024-08-28',
  });
  assert.equal(result.serviceYearStart, '2024-02-29');
  assert.equal(result.serviceYearEnd, '2025-02-28');
  assert.equal(result.periodDays, 365);
  assert.equal(result.annualEntitlementDays, 21);
  assert.ok(result.accruedDays > 10);
  assert.ok(result.accruedDays < 11);
});

test('contractual annual entitlement may exceed statutory minimum but never reduce it', () => {
  assert.equal(calculateAnnualLeaveAccrual({
    startDate: '2026-01-01',
    asOfDate: '2026-06-30',
    contractAnnualDays: 25,
  }).annualEntitlementDays, 25);

  assert.equal(calculateAnnualLeaveAccrual({
    startDate: '2020-01-01',
    asOfDate: '2026-06-30',
    contractAnnualDays: 25,
  }).annualEntitlementDays, 30);
});

test('opening balance is an as-of anchor and does not double-count prior accrual', () => {
  const onAnchor = calculateAnnualLeaveAvailable({
    startDate: '2026-01-01',
    asOfDate: '2026-08-28',
    openingBalanceEffectiveDate: '2026-08-28',
    openingBalanceDays: 7,
  });
  assert.equal(onAnchor.availableDays, 7);
  assert.equal(onAnchor.accruedSinceAnchorDays, 0);

  const nextDay = calculateAnnualLeaveAvailable({
    startDate: '2026-01-01',
    asOfDate: '2026-08-29',
    openingBalanceEffectiveDate: '2026-08-28',
    openingBalanceDays: 7,
  });
  assert.ok(nextDay.availableDays > 7);
  assert.ok(nextDay.availableDays < 7.1);
});

test('accrual range splits at exact five-year anniversary', () => {
  const result = calculateAnnualLeaveAccrualRange({
    startDate: '2021-08-28',
    fromExclusiveDate: '2026-08-26',
    asOfDate: '2026-08-29',
  });
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].annualEntitlementDays, 21);
  assert.equal(result.segments[0].elapsedDays, 1);
  assert.equal(result.segments[1].annualEntitlementDays, 30);
  assert.equal(result.segments[1].elapsedDays, 2);
});

test('only annual leave debits annual balance', () => {
  assert.equal(getSaLeaveTypePolicy('annual').deductAnnualBalance, true);
  assert.equal(getSaLeaveTypePolicy('sick').deductAnnualBalance, false);
  assert.equal(getSaLeaveTypePolicy('unpaid').deductAnnualBalance, false);
  assert.equal(getSaLeaveTypePolicy('weekly_rest_substitute_use').deductAnnualBalance, false);
});

test('legacy emergency and unknown leave route to HR review instead of a statutory bucket', () => {
  assert.equal(normalizeSaLeaveType('emergency'), SA_LEAVE_TYPES.otherHrReview);
  assert.equal(getSaLeaveTypePolicy('emergency').reviewRequired, true);
  assert.equal(getSaLeaveTypePolicy('something_new').reviewRequired, true);
  assert.equal(getSaLeaveTypePolicy('emergency').deductAnnualBalance, false);
});

test('weekly rest substitute and overtime comp remain independent entitlement buckets', () => {
  assert.equal(getSaLeaveTypePolicy('weekly_rest_substitute_use').entitlementBucket, 'weekly_rest_due');
  assert.equal(getSaLeaveTypePolicy('overtime_comp_time_use').entitlementBucket, 'overtime_comp');
});

test('sick leave segments cross statutory pay bands without touching annual balance', () => {
  const segments = calculateSickLeaveSegments({ usedDaysBefore: 29, requestedDays: 3 });
  assert.deepEqual(segments, [
    { ordinalFrom: 30, ordinalTo: 30, days: 1, payRateBps: 10000, reviewRequired: false },
    { ordinalFrom: 31, ordinalTo: 32, days: 2, payRateBps: 7500, reviewRequired: false },
  ]);
});

test('sick leave beyond statutory 120-day band fails closed to review', () => {
  const segments = calculateSickLeaveSegments({ usedDaysBefore: 119, requestedDays: 3 });
  assert.equal(segments[0].ordinalFrom, 120);
  assert.equal(segments[0].payRateBps, 0);
  assert.equal(segments[0].reviewRequired, false);
  assert.equal(segments[1].ordinalFrom, 121);
  assert.equal(segments[1].reviewRequired, true);
});

test('opening balance migration supports a zero audited anchor and one active anchor per employee', () => {
  const migration = readFileSync(
    new URL('../migrations/core/0040_sa_annual_leave_opening_anchor.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /entry_code = 'OPENING_BALANCE' AND days = 0/);
  assert.match(migration, /idx_employee_leave_opening_balance_active/);
  assert.match(migration, /entry_code = 'OPENING_BALANCE'/);
});
