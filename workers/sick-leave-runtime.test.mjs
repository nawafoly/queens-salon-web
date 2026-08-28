import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  getSickLeaveState,
} from './core/repositories/sick-leave.js';

class FakeSickD1 {
  constructor({ segments = [], states = [] } = {}) {
    this.__fakeD1 = true;
    this.segments = segments;
    this.states = states;
  }

  async all(sql) {
    if (sql.includes('FROM employee_sick_leave_segments')) {
      return this.segments.filter(row => row.status === 'active');
    }
    if (sql.includes('FROM employee_sick_leave_year_state')) {
      return [...this.states].sort((a, b) =>
        String(b.sick_year_start).localeCompare(String(a.sick_year_start))
      );
    }
    throw new Error(`unexpected all query: ${sql}`);
  }

  async first(sql) {
    throw new Error(`unexpected first query: ${sql}`);
  }

  async batch() {
    throw new Error('batch not expected in read-model tests');
  }
}

test('sick entitlement remains unstarted until the first sick leave', async () => {
  const state = await getSickLeaveState(
    new FakeSickD1(),
    'main',
    'emp-1'
  );

  assert.equal(state.sickYearStart, null);
  assert.equal(state.usedDays, 0);
  assert.equal(state.remainingStatutoryDays, 120);
});

test('sick year state reports used and remaining statutory days independently from annual leave', async () => {
  const db = new FakeSickD1({
    states: [
      {
        salon_id: 'main',
        employee_id: 'emp-1',
        sick_year_start: '2026-04-10',
        used_days: 29,
        version: 2,
      },
    ],
    segments: [
      {
        id: 'seg-1',
        sick_year_start: '2026-04-10',
        days: 20,
        ordinal_from: 1,
        ordinal_to: 20,
        status: 'active',
      },
      {
        id: 'seg-2',
        sick_year_start: '2026-04-10',
        days: 9,
        ordinal_from: 21,
        ordinal_to: 29,
        status: 'active',
      },
    ],
  });

  const state = await getSickLeaveState(
    db,
    'main',
    'emp-1',
    { asOfDate: '2026-08-28' }
  );

  assert.equal(state.sickYearStart, '2026-04-10');
  assert.equal(state.usedDays, 29);
  assert.equal(state.remainingStatutoryDays, 91);
  assert.equal(state.reviewRequired, false);
});

test('sick year counter fails closed when durable state and active segments drift', async () => {
  const db = new FakeSickD1({
    states: [
      {
        sick_year_start: '2026-04-10',
        used_days: 30,
        version: 3,
      },
    ],
    segments: [
      {
        id: 'seg-1',
        sick_year_start: '2026-04-10',
        days: 29,
        status: 'active',
      },
    ],
  });

  const state = await getSickLeaveState(
    db,
    'main',
    'emp-1',
    { asOfDate: '2026-08-28' }
  );

  assert.equal(state.reviewRequired, true);
  assert.equal(
    state.reviewReason,
    'sick_year_state_segment_mismatch'
  );
});

test('sick runtime migration preserves reversible audit history and a concurrency state row', () => {
  const migration = readFileSync(
    new URL(
      '../migrations/core/0041_sa_sick_leave_runtime_lifecycle.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /status IN \('active', 'reversed'\)/
  );
  assert.match(
    migration,
    /CREATE TABLE employee_sick_leave_year_state/
  );
  assert.match(
    migration,
    /used_days >= 0 AND used_days <= 120/
  );
});
