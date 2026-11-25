import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL(
    '../migrations/core/0110_payroll_approval_atomic_transition.sql',
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
      status TEXT NOT NULL,
      net_salary_halalas INTEGER NOT NULL,
      attendance_summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE payroll_approval_snapshots (
      id TEXT PRIMARY KEY,
      payroll_entry_id TEXT NOT NULL,
      approved_net_halalas INTEGER NOT NULL
    );

    CREATE TABLE payroll_carryover_adjustments (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    INSERT INTO payroll_entries VALUES (
      'payroll-1',
      'main',
      'draft',
      400000,
      '{"attendancePolicyRevision":0}',
      'revision-1'
    );

    INSERT INTO payroll_carryover_adjustments
    VALUES ('carryover-1', 'pending');
  `);

  db.exec(migration);

  return db;
}

function evidence(db) {
  return {
    payroll: db.prepare(`
      SELECT * FROM payroll_entries ORDER BY id
    `).all(),

    snapshots: db.prepare(`
      SELECT * FROM payroll_approval_snapshots
      ORDER BY id
    `).all(),

    carryovers: db.prepare(`
      SELECT * FROM payroll_carryover_adjustments
      ORDER BY id
    `).all(),

    guards: db.prepare(`
      SELECT * FROM payroll_approval_transaction_guards
    `).all(),
  };
}

function atomicApprove(db, expected, options = {}) {
  db.exec('BEGIN');

  try {
    db.prepare(`
      UPDATE payroll_entries
      SET status = 'approved',
          updated_at = 'approved-revision'
      WHERE salon_id = ?
        AND id = ?
        AND status = ?
        AND updated_at = ?
        AND net_salary_halalas = ?
        AND attendance_summary_json = ?
    `).run(
      options.salonId ?? expected.salon_id,
      expected.id,
      expected.status,
      expected.updated_at,
      expected.net_salary_halalas,
      expected.attendance_summary_json
    );

    db.exec(`
      INSERT INTO payroll_approval_transaction_guards (
        id,
        salon_id,
        payroll_entry_id,
        transition_matches
      ) VALUES (
        'guard-1',
        'main',
        'payroll-1',
        CASE WHEN changes() = 1 THEN 1 ELSE 0 END
      );
    `);

    db.prepare(`
      INSERT INTO payroll_approval_snapshots
      VALUES (?, ?, ?)
    `).run(
      'snapshot-1',
      expected.id,
      expected.net_salary_halalas
    );

    db.exec(`
      UPDATE payroll_carryover_adjustments
      SET status = 'applied'
      WHERE id = 'carryover-1'
        AND status = 'pending';
    `);

    if (options.failAfterCarryover) {
      throw new Error('SYNTHETIC_FINANCIAL_FAILURE');
    }

    db.exec(`
      DELETE FROM payroll_approval_transaction_guards
      WHERE id = 'guard-1';

      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

test('HR05D3B3B: successful transition commits all financial records', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  atomicApprove(db, expected);

  const result = evidence(db);

  assert.equal(result.payroll[0].status, 'approved');
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.snapshots[0].approved_net_halalas, 400000);
  assert.equal(result.carryovers[0].status, 'applied');
  assert.deepEqual(result.guards, []);
});

test('HR05D3B3B: changed payroll amount rejects stale approval', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  db.exec(`
    UPDATE payroll_entries
    SET net_salary_halalas = 390000
    WHERE id = 'payroll-1';
  `);

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected),
    /transition_matches/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: changed attendance evidence rejects stale approval', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  db.exec(`
    UPDATE payroll_entries
    SET attendance_summary_json =
      '{"attendancePolicyRevision":1}'
    WHERE id = 'payroll-1';
  `);

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected),
    /transition_matches/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: changed payroll timestamp rejects stale approval', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  db.exec(`
    UPDATE payroll_entries
    SET updated_at = 'revision-2'
    WHERE id = 'payroll-1';
  `);

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected),
    /transition_matches/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: stale status cannot create another approval snapshot', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  atomicApprove(db, expected);

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected),
    /transition_matches/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: wrong salon cannot apply financial records', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected, {
      salonId: 'other',
    }),
    /transition_matches/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: snapshot write failure rolls back approved status', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  db.exec(`
    CREATE TRIGGER synthetic_snapshot_failure
    BEFORE INSERT ON payroll_approval_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'SYNTHETIC_SNAPSHOT_FAILURE');
    END;
  `);

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected),
    /SYNTHETIC_SNAPSHOT_FAILURE/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: carryover write failure rolls back approval and snapshot', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  db.exec(`
    CREATE TRIGGER synthetic_carryover_failure
    BEFORE UPDATE ON payroll_carryover_adjustments
    BEGIN
      SELECT RAISE(ABORT, 'SYNTHETIC_CARRYOVER_FAILURE');
    END;
  `);

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected),
    /SYNTHETIC_CARRYOVER_FAILURE/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: failure after carryover application rolls back entire transaction', t => {
  const db = fixture(t);

  const expected = evidence(db).payroll[0];

  const before = evidence(db);

  assert.throws(
    () => atomicApprove(db, expected, {
      failAfterCarryover: true,
    }),
    /SYNTHETIC_FINANCIAL_FAILURE/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B3B: corrected draft can be approved after stale rejection', t => {
  const db = fixture(t);

  const stale = evidence(db).payroll[0];

  db.exec(`
    UPDATE payroll_entries
    SET net_salary_halalas = 410000,
        updated_at = 'revision-2'
    WHERE id = 'payroll-1';
  `);

  assert.throws(
    () => atomicApprove(db, stale),
    /transition_matches/
  );

  const refreshed = evidence(db).payroll[0];

  atomicApprove(db, refreshed);

  const result = evidence(db);

  assert.equal(result.payroll[0].status, 'approved');
  assert.equal(result.snapshots.length, 1);

  assert.equal(
    result.snapshots[0].approved_net_halalas,
    410000
  );

  assert.deepEqual(result.guards, []);
});
