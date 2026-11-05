import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { statutorySickPayrollAdjustment } from './core/repositories/sick-payroll-adjustment.js';

function sick({ id = 'sick-1', start = '2026-10-30', rates = [10000], firstOrdinal = 30, ...rest } = {}) {
  const end = new Date(Date.parse(start + 'T12:00:00Z') + (rates.length - 1) * 86400000)
    .toISOString().slice(0, 10);
  const segments = [];
  rates.forEach((rate, index) => {
    const ordinal = firstOrdinal + index;
    const previous = segments[segments.length - 1];
    if (previous?.payRateBps === rate) {
      previous.ordinalTo = ordinal;
      previous.days += 1;
    } else {
      segments.push({ ordinalFrom: ordinal, ordinalTo: ordinal, days: 1, payRateBps: rate, reviewRequired: false });
    }
  });
  return {
    id, status: 'approved', leave_type: 'sick', duration_kind: 'full_day',
    start_date: start, end_date: end, days_count: rates.length,
    sick_day_ordinal_from: firstOrdinal,
    sick_day_ordinal_to: firstOrdinal + rates.length - 1,
    documentation_status: 'verified', pay_segments_json: JSON.stringify(segments),
    ...rest,
  };
}

test('day 30 pays 100% while day 31 pays 75%', () => {
  const leave = sick({ rates: [10000, 7500] });
  const result = statutorySickPayrollAdjustment({ leaves: [leave], periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  assert.equal(result.unpaidEquivalentDays, 0.25);
  assert.equal(result.affectedDays, 1);
});

test('day 90 pays 75% while day 91 is unpaid', () => {
  const leave = sick({ firstOrdinal: 90, rates: [7500, 0] });
  const result = statutorySickPayrollAdjustment({ leaves: [leave], periodStart: '2026-10-01', periodEnd: '2026-11-30' });
  assert.equal(result.unpaidEquivalentDays, 1.25);
  assert.equal(result.affectedDays, 2);
});

test('cross-month leave is split once by date for each payroll month', () => {
  const leave = sick({ rates: [10000, 7500, 7500], start: '2026-10-31' });
  const october = statutorySickPayrollAdjustment({ leaves: [leave], periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  const november = statutorySickPayrollAdjustment({ leaves: [leave], periodStart: '2026-11-01', periodEnd: '2026-11-30' });
  assert.equal(october.unpaidEquivalentDays, 0);
  assert.equal(november.unpaidEquivalentDays, 0.5);
});

test('approved recalled dates do not contribute wage reduction', () => {
  const leave = sick({ firstOrdinal: 91, rates: [0, 0] });
  const result = statutorySickPayrollAdjustment({
    leaves: [leave], periodStart: '2026-10-01', periodEnd: '2026-10-31',
    recalledLeaveDates: new Set(['sick-1|2026-10-30']),
  });
  assert.equal(result.unpaidEquivalentDays, 1);
});

test('missing or inconsistent sick segments fail closed rather than promise full pay', () => {
  for (const changes of [
    { pay_segments_json: null }, { documentation_status: 'pending' },
    { sick_day_ordinal_to: 99 }, { duration_kind: 'partial' },
    { pay_segments_json: 'not-json' },
  ]) {
    assert.throws(() => statutorySickPayrollAdjustment({
      leaves: [sick({ rates: [7500], firstOrdinal: 31, ...changes })],
      periodStart: '2026-10-01', periodEnd: '2026-10-31',
    }), /core_payroll:sick_leave_/);
  }
});

test('two approved sick leaves for one date are rejected to prevent double deductions', () => {
  const a = sick({ firstOrdinal: 31, rates: [7500] });
  const b = sick({ id: 'sick-2', firstOrdinal: 32, rates: [7500] });
  assert.throws(() => statutorySickPayrollAdjustment({
    leaves: [a, b], periodStart: '2026-10-01', periodEnd: '2026-10-31',
  }), /overlapping_approved_dates/);
});

test('sick leave crossing the statutory sick-year boundary requires review', () => {
  const leave = sick({
    start: '2027-04-09', rates: [7500, 7500], firstOrdinal: 31,
    sick_year_start: '2026-04-10',
  });
  assert.throws(() => statutorySickPayrollAdjustment({
    leaves: [leave], periodStart: '2027-04-01', periodEnd: '2027-04-30',
  }), /crosses_statutory_year/);
});

test('payroll canonical and locked recalculation both use sick-equivalent deduction units', () => {
  const source = readFileSync(new URL('./core/repositories/payroll.js', import.meta.url), 'utf8');
  assert.match(source, /statutorySickPayrollAdjustment\(/);
  assert.match(source, /statutorySickUnpaidEquivalentDays: sickPayrollAdjustment\.unpaidEquivalentDays/);
  assert.equal((source.match(/Number\(summary\.statutorySickUnpaidEquivalentDays \|\| 0\)/g) || []).length, 2);
});
