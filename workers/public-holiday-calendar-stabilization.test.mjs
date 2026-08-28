import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { saudiEidHolidayDates, verifySaudiEidHolidayPeriod } from './core/repositories/holiday-calendar-compliance.js';

test('Saudi Eid periods always expand to four consecutive verified calendar dates', () => {
  assert.deepEqual(saudiEidHolidayDates('eid_al_fitr', '2030-01-10'), [
    '2030-01-10',
    '2030-01-11',
    '2030-01-12',
    '2030-01-13',
  ]);
  assert.deepEqual(saudiEidHolidayDates('eid_al_adha', '2030-06-01'), [
    '2030-06-01',
    '2030-06-02',
    '2030-06-03',
    '2030-06-04',
  ]);
});

test('Eid period verification fails closed without an official source reference', async () => {
  await assert.rejects(
    verifySaudiEidHolidayPeriod({}, { holidayCode: 'eid_al_fitr', holidayStartDate: '2030-01-10' }),
    (error) => error && error.code === 'core_public_holiday:verification_source_required'
  );
});

test('Core API exposes canonical holiday calendar, assignment and reconciliation routes', () => {
  const source = readFileSync(new URL('./core/index.js', import.meta.url), 'utf8');
  for (const token of [
    'verifySaudiEidHolidayPeriod',
    '/api/core/hr/public-holidays/eid-periods',
    '/api/core/hr/public-holiday-work-assignments',
    '/api/core/hr/public-holiday-work/reconcile',
    '/api/core/hr/weekly-rest/reconcile',
  ]) assert.ok(source.includes(token), 'missing holiday Core API contract: ' + token);
});

test('frontend has typed canonical access to holiday compliance routes', () => {
  const source = readFileSync(new URL('../src/services/CoreHolidayComplianceService.ts', import.meta.url), 'utf8');
  for (const token of [
    'ensureFixedSaudiPublicHolidays',
    'verifySaudiEidHolidayPeriod',
    'createPublicHolidayWorkAssignment',
    'reconcilePublicHolidayWork',
    'reconcileWeeklyRest',
  ]) assert.ok(source.includes(token), 'missing frontend holiday contract: ' + token);
});
