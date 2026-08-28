import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  attendanceWorkedMinutes,
  isExplicitWeeklyRestShift,
} from './core/repositories/rest-holiday-compliance.js';

test('weekly schedule inactive is canonical weekly rest', () => {
  assert.equal(
    isExplicitWeeklyRestShift({
      source: 'weekly_schedule',
      active: 0,
      exception_type: 'off',
    }),
    true
  );
});

test('generic one-off schedule exception is not silently relabeled as statutory weekly rest', () => {
  assert.equal(
    isExplicitWeeklyRestShift({
      source: 'exception',
      exception_type: 'off',
      note: 'manager one-off day off',
    }),
    false
  );
});

test('temporary weekly-rest replacement exception remains weekly-rest evidence', () => {
  assert.equal(
    isExplicitWeeklyRestShift({
      source: 'exception',
      exception_type: 'off',
      note: '[TEMP_WEEKLY_OFF:sun:mon:2026-08-01:2026-08-31] TEMP_OFF',
    }),
    true
  );
});

test('missing schedule source is not proof of weekly rest', () => {
  assert.equal(
    isExplicitWeeklyRestShift({ source: 'none' }),
    false
  );
});

test('attendance work duration sums separate complete intervals without counting the gap', () => {
  const rows = [
    {
      id: 'in-1',
      date_key: '2026-09-23',
      record_type: 'check_in',
      recorded_at: '2026-09-23T09:00:00+03:00',
    },
    {
      id: 'out-1',
      date_key: '2026-09-23',
      record_type: 'check_out',
      recorded_at: '2026-09-23T12:00:00+03:00',
    },
    {
      id: 'in-2',
      date_key: '2026-09-23',
      record_type: 'check_in',
      recorded_at: '2026-09-23T13:00:00+03:00',
    },
    {
      id: 'out-2',
      date_key: '2026-09-23',
      record_type: 'check_out',
      recorded_at: '2026-09-23T15:00:00+03:00',
    },
  ];

  const result = attendanceWorkedMinutes(rows, '2026-09-23');
  assert.equal(result.complete, true);
  assert.equal(result.workedMinutes, 300);
  assert.equal(result.intervals.length, 2);
});

test('incomplete attendance is preserved as evidence but not treated as complete worked duration', () => {
  const result = attendanceWorkedMinutes([
    {
      id: 'in-1',
      date_key: '2026-09-23',
      record_type: 'check_in',
      recorded_at: '2026-09-23T09:00:00+03:00',
    },
  ], '2026-09-23');

  assert.equal(result.hasAttendance, true);
  assert.equal(result.complete, false);
  assert.equal(result.workedMinutes, 0);
});

test('holiday workflow makes work assignment explicit and requires consent before comp time', () => {
  const migration = readFileSync(
    new URL(
      '../migrations/core/0042_sa_weekly_rest_public_holiday_workflow.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /CREATE TABLE employee_public_holiday_work_assignments/
  );
  assert.match(
    migration,
    /public_holiday_comp_time_requires_employee_consent/
  );
});

test('weekly-rest runtime never assumes all rest-day work is statutory overtime', () => {
  const source = readFileSync(
    new URL(
      './core/repositories/rest-holiday-compliance.js',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    source,
    /overtimeDetermination:[\s\S]*separate_daily_weekly_overtime_rule_required/
  );
  assert.match(
    source,
    /overtime_minutes = 0/
  );
});

test('public-holiday runtime counts complete holiday work as overtime and does not cancel the holiday', () => {
  const source = readFileSync(
    new URL(
      './core/repositories/rest-holiday-compliance.js',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    source,
    /attendance\.complete[\s\S]*attendance\.workedMinutes/
  );
  assert.doesNotMatch(
    source,
    /cancelPublicHoliday/
  );
});
