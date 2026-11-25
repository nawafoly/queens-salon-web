import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL(
    '../migrations/core/0111_employee_target_payroll_lock.sql',
    import.meta.url
  ),
  'utf8'
);

function fixture(t) {
  const db = new DatabaseSync(':memory:');

  t.after(() => db.close());

  db.exec(`
    CREATE TABLE payroll_entries (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      payroll_month TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE payroll_approval_transaction_guards (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      payroll_entry_id TEXT NOT NULL,
      transition_matches INTEGER NOT NULL
        CHECK (transition_matches = 1)
    );

    CREATE TABLE employee_target_period_summaries (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      payroll_period_id TEXT,
      payroll_month TEXT,
      period_start TEXT,
      period_end TEXT,
      plan_id TEXT,
      plan_snapshot_json TEXT,
      total_eligible_services INTEGER DEFAULT 0,
      total_refunds INTEGER DEFAULT 0,
      net_target_amount INTEGER DEFAULT 0,
      achieved_tier_id TEXT,
      achieved_tier_snapshot_json TEXT,
      earned_bonus_amount INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      approved_at TEXT,
      approved_by_uid TEXT,
      payroll_entry_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    INSERT INTO payroll_entries VALUES (
      'payroll-1',
      'salon-1',
      'employee-1',
      '2026-11',
      'draft'
    );

    INSERT INTO employee_target_period_summaries (
      id, salon_id, employee_id, payroll_month,
      period_start, period_end, earned_bonus_amount,
      status, payroll_entry_id, created_at, updated_at
    ) VALUES (
      'target-1', 'salon-1', 'employee-1', '2026-11',
      '2026-11-01', '2026-11-30', 50000,
      'open', 'payroll-1', '2026-11-25', '2026-11-25'
    );
  `);

  db.exec(migration);

  return db;
}

function target(db) {
  return db.prepare(`
    SELECT *
      FROM employee_target_period_summaries
     WHERE id = 'target-1'
  `).get();
}

function payroll(db) {
  return db.prepare(`
    SELECT *
      FROM payroll_entries
     WHERE id = 'payroll-1'
  `).get();
}

function lockPayroll(db, status = 'approved') {
  db.prepare(`
    UPDATE payroll_entries
       SET status = ?
     WHERE id = 'payroll-1'
  `).run(status);
}

function changeBonus(db, amount) {
  db.prepare(`
    UPDATE employee_target_period_summaries
       SET earned_bonus_amount = ?
     WHERE id = 'target-1'
  `).run(amount);
}

function postTarget(db) {
  db.exec(`
    UPDATE employee_target_period_summaries
       SET status = 'posted_to_payroll',
           approved_at = '2026-11-25',
           approved_by_uid = 'owner-1'
     WHERE id = 'target-1'
  `);
}

function insertGuard(db) {
  db.exec(`
    INSERT INTO payroll_approval_transaction_guards
      (id, salon_id, payroll_entry_id, transition_matches)
    VALUES ('guard-1', 'salon-1', 'payroll-1', 1)
  `);
}

test('draft payroll allows target recalculation', t => {
  const db = fixture(t);

  changeBonus(db, 75000);

  assert.equal(target(db).earned_bonus_amount, 75000);
});

for (const status of ['approved', 'paid']) {

  test(`${status} payroll prevents bonus mutation`, t => {
    const db = fixture(t);

    lockPayroll(db, status);

    const before = target(db);

    assert.throws(
      () => changeBonus(db, 99000),
      /employee_target_locked_payroll/
    );

    assert.deepEqual(target(db), before);
  });

  test(`${status} payroll prevents target deletion`, t => {
    const db = fixture(t);

    lockPayroll(db, status);

    assert.throws(
      () => db.exec(`
        DELETE FROM employee_target_period_summaries
         WHERE id = 'target-1'
      `),
      /employee_target_locked_payroll_delete/
    );

    assert.equal(target(db).earned_bonus_amount, 50000);
  });

  test(`${status} payroll prevents new target insertion`, t => {
    const db = fixture(t);

    lockPayroll(db, status);

    assert.throws(
      () => db.exec(`
        INSERT INTO employee_target_period_summaries (
          id, salon_id, employee_id,
          payroll_month, status
        ) VALUES (
          'target-2', 'salon-1',
          'employee-1', '2026-11', 'open'
        )
      `),
      /employee_target_locked_payroll_insert/
    );
  });
}

test('locked target identity cannot be reassigned', t => {
  const db = fixture(t);

  lockPayroll(db);

  for (const [column, value] of [
    ['salon_id', 'salon-2'],
    ['employee_id', 'employee-2'],
    ['payroll_month', '2026-12'],
    ['payroll_entry_id', 'payroll-2'],
    ['period_start', '2026-11-02'],
    ['plan_id', 'plan-2']
  ]) {
    assert.throws(
      () => db.prepare(`
        UPDATE employee_target_period_summaries
           SET ${column} = ?
         WHERE id = 'target-1'
      `).run(value),
      /employee_target_locked_payroll/
    );
  }

  assert.equal(target(db).salon_id, 'salon-1');
});

test('posting without approval transaction guard is rejected', t => {
  const db = fixture(t);

  lockPayroll(db);

  assert.throws(
    () => postTarget(db),
    /employee_target_locked_payroll/
  );

  assert.equal(target(db).status, 'open');
});

test('atomic approval permits valid target posting', t => {
  const db = fixture(t);

  db.exec('BEGIN');

  try {
    lockPayroll(db);

    insertGuard(db);

    postTarget(db);

    db.exec(`
      DELETE FROM payroll_approval_transaction_guards
       WHERE id = 'guard-1'
    `);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  assert.equal(payroll(db).status, 'approved');
  assert.equal(target(db).status, 'posted_to_payroll');
  assert.equal(target(db).earned_bonus_amount, 50000);
  assert.equal(target(db).approved_by_uid, 'owner-1');
});

test('failed target mutation rolls back payroll approval', t => {
  const db = fixture(t);

  const before = target(db);

  assert.throws(() => {

    db.exec('BEGIN');

    try {
      lockPayroll(db);

      insertGuard(db);

      postTarget(db);

      changeBonus(db, 100000);

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

  }, /employee_target_locked_payroll/);

  assert.equal(payroll(db).status, 'draft');
  assert.deepEqual(target(db), before);
});

test('guard belonging to another salon cannot authorize posting', t => {
  const db = fixture(t);

  lockPayroll(db);

  db.exec(`
    INSERT INTO payroll_approval_transaction_guards
    VALUES ('wrong-guard', 'salon-2', 'payroll-1', 1)
  `);

  assert.throws(
    () => postTarget(db),
    /employee_target_locked_payroll/
  );
});

test('another salon remains independent', t => {
  const db = fixture(t);

  lockPayroll(db);

  db.exec(`
    INSERT INTO employee_target_period_summaries (
      id, salon_id, employee_id,
      payroll_month, status, earned_bonus_amount
    ) VALUES (
      'other-target', 'salon-2', 'employee-1',
      '2026-11', 'open', 25000
    )
  `);

  assert.equal(
    db.prepare(`
      SELECT earned_bonus_amount
        FROM employee_target_period_summaries
       WHERE id = 'other-target'
    `).get().earned_bonus_amount,
    25000
  );
});

test('historical target without payroll link is protected by month', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_target_period_summaries
       SET payroll_entry_id = NULL
     WHERE id = 'target-1'
  `);

  lockPayroll(db);

  assert.throws(
    () => changeBonus(db, 90000),
    /employee_target_locked_payroll/
  );
});

test('reopened payroll permits draft target recalculation', t => {
  const db = fixture(t);

  lockPayroll(db);

  assert.throws(
    () => changeBonus(db, 70000),
    /employee_target_locked_payroll/
  );

  lockPayroll(db, 'draft');

  changeBonus(db, 70000);

  assert.equal(target(db).earned_bonus_amount, 70000);
});
