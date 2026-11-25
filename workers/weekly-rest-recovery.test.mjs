import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  recoverAssignedWeeklyRestWork,
} from './core/repositories/weekly-rest-recovery.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());

  sqlite.exec(`
    CREATE TABLE employee_weekly_rest_work_assignments (
      id TEXT PRIMARY KEY,
      salon_id TEXT,
      employee_id TEXT,
      rest_date TEXT,
      start_time TEXT,
      end_time TEXT,
      status TEXT,
      correction_pending INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE employee_comp_time_ledger (
      salon_id TEXT,
      employee_id TEXT,
      entitlement_type TEXT,
      entry_kind TEXT,
      source_date TEXT,
      source_type TEXT
    );
  `);

  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              return {
                results: sqlite.prepare(sql).all(...params),
              };
            },
          };
        },
      };
    },
  };

  function assignment(
    id,
    date,
    {
      salon = 'main',
      status = 'assigned',
      start = '15:00',
      end = '23:00',
    } = {}
  ) {
    sqlite.prepare(`
      INSERT INTO employee_weekly_rest_work_assignments (id, salon_id, employee_id, rest_date, start_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, salon, id, date, start, end, status);
  }

  function credit(employee, date, type) {
    sqlite.prepare(`
      INSERT INTO employee_comp_time_ledger
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'main',
      employee,
      'weekly_rest_due',
      'credit',
      date,
      type
    );
  }

  return { db, assignment, credit, sqlite };
}

test('recovery is disabled without an approved start date', async () => {
  const result = await recoverAssignedWeeklyRestWork(
    null, 'main', null
  );

  assert.equal(result.enabled, false);
  assert.equal(result.processed, 0);
});

test('recovery refuses to run without attendance database', async () => {
  await assert.rejects(
    recoverAssignedWeeklyRestWork(
      null, 'main', null,
      { fromDate: '2026-11-01' }
    ),
    /weekly_rest_recovery_attendance_unavailable/
  );
});

test('recovery selects only eligible ended assignments', async (t) => {
  const { db, assignment, credit } = fixture(t);

  assignment('eligible', '2026-11-23');
  assignment('ongoing', '2026-11-24');
  assignment('future', '2026-11-25');
  assignment('cancelled', '2026-11-23', {
    status: 'cancelled',
  });
  assignment('completed', '2026-11-23', {
    status: 'completed',
  });
  assignment('other-salon', '2026-11-23', {
    salon: 'other',
  });
  assignment('before-cutoff', '2026-10-31');

  assignment('manual-credit', '2026-11-23');
  credit('manual-credit', '2026-11-23', 'manual_adjustment');

  assignment('opening-covered', '2026-11-20');
  credit(
    'opening-covered',
    '2026-11-22',
    'historical_opening_balance'
  );

  assignment('after-opening', '2026-11-23');
  credit(
    'after-opening',
    '2026-11-22',
    'historical_opening_balance'
  );

  const seen = [];

  const result = await recoverAssignedWeeklyRestWork(
    db,
    'main',
    {},
    {
      fromDate: '2026-11-01',
      now: new Date('2026-11-24T15:00:00Z'),
      reconcile: async (_db, _salon, employee) => {
        seen.push(employee);
        return { entitlement: { id: employee } };
      },
    }
  );

  assert.deepEqual(
    seen.sort(),
    ['after-opening', 'eligible']
  );
  assert.equal(result.credited, 2);
});

test('overnight assignment waits until next-day end time', async (t) => {
  const { db, assignment } = fixture(t);

  assignment('overnight', '2026-11-24', {
    start: '22:00',
    end: '06:00',
  });

  const options = {
    fromDate: '2026-11-01',
    reconcile: async () => ({
      entitlement: { id: 'credit' },
    }),
  };

  const before = await recoverAssignedWeeklyRestWork(
    db, 'main', {},
    {
      ...options,
      now: new Date('2026-11-25T02:59:00Z'),
    }
  );

  assert.equal(before.processed, 0);

  const after = await recoverAssignedWeeklyRestWork(
    db, 'main', {},
    {
      ...options,
      now: new Date('2026-11-25T03:00:00Z'),
    }
  );

  assert.equal(after.credited, 1);
});

test('one failed assignment does not stop other assignments', async (t) => {
  const { db, assignment } = fixture(t);

  assignment('a-failed', '2026-11-23');
  assignment('b-pending', '2026-11-23');
  assignment('c-success', '2026-11-23');

  const result = await recoverAssignedWeeklyRestWork(
    db, 'main', {},
    {
      fromDate: '2026-11-01',
      now: new Date('2026-11-24T15:00:00Z'),
      reconcile: async (_db, _salon, employee) => {
        if (employee === 'a-failed') {
          throw new Error('synthetic failure');
        }

        if (employee === 'b-pending') {
          return { entitlement: null };
        }

        return { entitlement: { id: 'credit' } };
      },
    }
  );

  assert.equal(result.processed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.credited, 1);
});

test('pending assignments cannot permanently block the next batch', async t => {
  const { db, assignment } = fixture(t);

  for (let i = 0; i < 45; i += 1) {
    assignment(
      `employee-${String(i).padStart(3, '0')}`,
      '2026-11-23'
    );
  }

  const seen = new Set();
  const start = Date.parse('2026-11-24T15:00:00Z');

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const result = await recoverAssignedWeeklyRestWork(
      db,
      'main',
      {},
      {
        fromDate: '2026-11-01',
        now: new Date(start + cycle * 300000),
        reconcile: async (_db, _salon, employee) => {
          seen.add(employee);
          return { entitlement: null };
        },
      }
    );

    assert.ok(result.processed <= 20);
    assert.equal(result.credited, 0);
    assert.equal(result.failed, 0);
  }

  assert.equal(seen.size, 45);
});
