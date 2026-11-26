import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedD1 } from './test-support/sqlite-d1.mjs';

function fixture(t) {
  const migrated = migratedD1('../../migrations/core/');
  const db = migrated.database;

  t.after(() => db.close());

  const table = 'employee_weekly_rest_rescheduling';

  function insert(overrides = {}) {
    const row = {
      id: 'operation-1',
      salon_id: 'main',
      employee_id: 'employee-1',
      original_rest_date: '2026-11-22',
      replacement_rest_date: '2026-11-23',
      work_start_time: '12:00',
      work_end_time: '20:00',
      original_rest_snapshot_json: '{"source":"weekly_schedule","active":0}',
      replacement_work_snapshot_json: '{"source":"weekly_schedule","active":1}',
      work_exception_id: 'work-exception-1',
      rest_exception_id: 'rest-exception-1',
      reason: 'Synthetic weekly rest rescheduling',
      status: 'active',
      created_by_uid: 'admin-1',
      created_at: '2026-11-26T12:00:00Z',
      updated_at: '2026-11-26T12:00:00Z',
      ...overrides
    };

    const keys = Object.keys(row);

    db.prepare(
      `INSERT INTO ${table}
       (${keys.join(',')})
       VALUES (${keys.map(() => '?').join(',')})`
    ).run(...Object.values(row));

    return row;
  }

  function rows() {
    return db.prepare(
      `SELECT * FROM ${table} ORDER BY id`
    ).all();
  }

  function cancel(id = 'operation-1') {
    db.prepare(`
      UPDATE ${table}
         SET status = 'cancelled',
             cancelled_by_uid = 'admin-1',
             cancelled_at = '2026-11-26T13:00:00Z',
             cancellation_reason = 'Synthetic restoration',
             updated_at = '2026-11-26T13:00:00Z'
       WHERE id = ?
    `).run(id);
  }

  return { db, insert, rows, cancel, table };
}

test('HR09E stores an explicit work/rest date pair', t => {
  const f = fixture(t);

  f.insert();

  const rows = f.rows();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].original_rest_date, '2026-11-22');
  assert.equal(rows[0].replacement_rest_date, '2026-11-23');

  console.log('PASS: explicit rest replacement registry');
});

test('HR09E rejects identical work and replacement dates', t => {
  const f = fixture(t);

  assert.throws(() => f.insert({
    replacement_rest_date: '2026-11-22'
  }));

  assert.equal(f.rows().length, 0);
});

test('HR09E rejects missing reason and administrator identity', t => {
  const f = fixture(t);

  assert.throws(() => f.insert({ reason: ' ' }));
  assert.throws(() => f.insert({ created_by_uid: ' ' }));

  assert.equal(f.rows().length, 0);
});

test('HR09E prevents overlapping rescheduling in either direction', t => {
  const f = fixture(t);

  f.insert();

  for (const pair of [
    ['2026-11-22', '2026-11-24'],
    ['2026-11-24', '2026-11-23'],
    ['2026-11-23', '2026-11-24'],
    ['2026-11-24', '2026-11-22']
  ]) {
    assert.throws(() => f.insert({
      id: 'operation-2',
      work_exception_id: 'work-exception-2',
      rest_exception_id: 'rest-exception-2',
      original_rest_date: pair[0],
      replacement_rest_date: pair[1]
    }), /weekly_rest_rescheduling_overlap/);
  }

  assert.equal(f.rows().length, 1);

  console.log('PASS: cross-date overlap protection');
});

test('HR09E preserves employee and tenant isolation', t => {
  const f = fixture(t);

  f.insert();

  f.insert({
    id: 'operation-2',
    employee_id: 'employee-2',
    work_exception_id: 'work-exception-2',
    rest_exception_id: 'rest-exception-2'
  });

  f.insert({
    id: 'operation-3',
    salon_id: 'another-salon',
    work_exception_id: 'work-exception-3',
    rest_exception_id: 'rest-exception-3'
  });

  assert.equal(f.rows().length, 3);
});

test('HR09E prevents modification of original operation evidence', t => {
  const f = fixture(t);

  f.insert();

  const before = f.rows();

  for (const field of [
    'salon_id',
    'employee_id',
    'original_rest_date',
    'replacement_rest_date',
    'work_start_time',
    'work_end_time',
    'work_exception_id',
    'rest_exception_id',
    'original_rest_snapshot_json',
    'replacement_work_snapshot_json',
    'reason',
    'created_by_uid',
    'created_at'
  ]) {
    assert.throws(() => {
      f.db.prepare(`
        UPDATE ${f.table}
           SET ${field} = ?
         WHERE id = 'operation-1'
      `).run('changed');
    }, /weekly_rest_rescheduling_identity_immutable/);
  }

  assert.deepEqual(f.rows(), before);

  console.log('PASS: immutable operation evidence');
});

test('HR09E cancellation rejects incomplete audit and financial evidence', t => {
  const f = fixture(t);

  f.insert();

  const before = f.rows();

  assert.throws(() => {
    f.db.exec(`
      UPDATE ${f.table}
         SET status = 'cancelled'
       WHERE id = 'operation-1'
    `);
  });

  assert.throws(
    () => f.cancel(),
    /weekly_rest_rescheduling_finance_pending/
  );

  assert.deepEqual(f.rows(), before);
});

test('HR09E active operation cannot contain forged cancellation evidence', t => {
  const f = fixture(t);

  for (const overrides of [
    { cancelled_by_uid: 'forged-admin' },
    { cancelled_at: '2026-11-26T13:00:00Z' },
    { cancellation_reason: 'Forged cancellation' }
  ]) {
    assert.throws(
      () => f.insert(overrides),
      /weekly_rest_rescheduling_invalid_cancellation_evidence/
    );
  }

  assert.equal(f.rows().length, 0);

  f.insert();

  const before = f.rows();

  for (const column of [
    'cancelled_by_uid',
    'cancelled_at',
    'cancellation_reason'
  ]) {
    assert.throws(
      () => f.db.prepare(`
        UPDATE ${f.table}
           SET ${column} = ?
         WHERE id = 'operation-1'
      `).run('forged'),
      /weekly_rest_rescheduling_invalid_cancellation_evidence/
    );
  }

  assert.deepEqual(f.rows(), before);
});

test('HR09E registry without linked exceptions cannot be restored', t => {
  const f = fixture(t);

  f.insert();

  const before = f.rows();

  // Synthetic schema-only rows must not become cancelled
  // operations through a partial lifecycle.

  assert.throws(
    () => f.cancel(),
    /weekly_rest_rescheduling_finance_pending/
  );

  assert.deepEqual(f.rows(), before);

  assert.throws(
    () => f.db.exec(`DELETE FROM ${f.table}`),
    /weekly_rest_rescheduling_history_immutable/
  );
});

test('HR09E rejects forged cancelled initial state', t => {
  const f = fixture(t);

  assert.throws(() => f.insert({
    status: 'cancelled',
    cancelled_by_uid: 'admin-1',
    cancelled_at: '2026-11-26T13:00:00Z',
    cancellation_reason: 'Forged state'
  }), /weekly_rest_rescheduling_invalid_initial_state/);

  assert.equal(f.rows().length, 0);
});
