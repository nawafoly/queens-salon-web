import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

function migration(name) {
  return readFileSync(
    new URL(`../migrations/core/${name}`, import.meta.url),
    'utf8'
  );
}

function fixture(t) {
  const db = new DatabaseSync(':memory:');

  t.after(() => db.close());

  db.exec(`
    CREATE TABLE employee_employment (
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      attendance_payroll_mode TEXT DEFAULT 'required',
      attendance_payroll_exemption_reason TEXT,
      base_salary_halalas INTEGER DEFAULT 400000,
      PRIMARY KEY (salon_id, employee_id)
    );

    CREATE TABLE payroll_entries (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      payroll_month TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE hr_payroll_period_locks (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO employee_employment (
      salon_id, employee_id
    ) VALUES
      ('main', 'employee-1'),
      ('main', 'employee-2'),
      ('other', 'employee-1');
  `);

  for (const name of [
    '0106_employee_attendance_policy_periods.sql',
    '0107_attendance_policy_payroll_lock_guards.sql',
    '0108_attendance_policy_revision.sql',
  ]) {
    db.exec(migration(name));
  }

  return db;
}

function revision(
  db,
  employeeId = 'employee-1',
  salonId = 'main'
) {
  return db.prepare(`
    SELECT attendance_policy_revision AS revision
    FROM employee_employment
    WHERE salon_id = ?
      AND employee_id = ?
  `).get(salonId, employeeId).revision;
}

function insertPolicy(db, input = {}) {
  db.prepare(`
    INSERT INTO employee_attendance_policy_periods (
      id, salon_id, employee_id,
      policy_mode, effective_from,
      effective_to, reason,
      created_by_uid, created_at,
      updated_at, updated_by_uid
    ) VALUES (?, ?, ?, 'exempt', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id ?? 'policy-1',
    input.salonId ?? 'main',
    input.employeeId ?? 'employee-1',
    input.from ?? '2026-11-01',
    input.to ?? null,
    'Synthetic administrative exemption',
    'synthetic-admin',
    '2026-11-25T12:00:00Z',
    '2026-11-25T12:00:00Z',
    'synthetic-admin'
  );
}

function evidence(db) {
  return {
    employment: db.prepare(`
      SELECT *
      FROM employee_employment
      ORDER BY salon_id, employee_id
    `).all(),

    policies: db.prepare(`
      SELECT *
      FROM employee_attendance_policy_periods
      ORDER BY id
    `).all(),

    events: db.prepare(`
      SELECT *
      FROM employee_attendance_policy_events
      ORDER BY id
    `).all(),

    payroll: db.prepare(`
      SELECT *
      FROM payroll_entries
      ORDER BY id
    `).all(),
  };
}

test('HR05D3B2A: migration initializes revisions without creating policies', t => {
  const db = fixture(t);

  assert.equal(revision(db), 0);
  assert.equal(revision(db, 'employee-2'), 0);
  assert.equal(revision(db, 'employee-1', 'other'), 0);

  assert.deepEqual(evidence(db).policies, []);
  assert.deepEqual(evidence(db).events, []);
});

test('HR05D3B2A: first policy creation invalidates the initial revision', t => {
  const db = fixture(t);

  const before = revision(db);

  insertPolicy(db);

  assert.ok(revision(db) > before);

  assert.equal(
    evidence(db).policies.length,
    1
  );

  assert.equal(
    evidence(db).events.length,
    1
  );
});

test('HR05D3B2A: policy updates increment the revision', t => {
  const db = fixture(t);

  insertPolicy(db);

  const before = revision(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_to = '2026-11-25',
        version = version + 1
    WHERE id = 'policy-1';
  `);

  assert.equal(revision(db), before + 1);
});

test('HR05D3B2A: cancellation increments the revision', t => {
  const db = fixture(t);

  insertPolicy(db);

  const before = revision(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET status = 'cancelled',
        cancelled_at = '2026-11-25T12:00:00Z',
        cancelled_by_uid = 'synthetic-admin',
        cancellation_reason = 'Synthetic cancellation',
        version = version + 1
    WHERE id = 'policy-1';
  `);

  assert.equal(revision(db), before + 1);

  assert.equal(evidence(db).events.length, 2);
});

test('HR05D3B2A: policy revision remains isolated by employee and salon', t => {
  const db = fixture(t);

  insertPolicy(db);

  assert.ok(revision(db) > 0);
  assert.equal(revision(db, 'employee-2'), 0);
  assert.equal(revision(db, 'employee-1', 'other'), 0);
});

test('HR05D3B2A: legacy exemption changes invalidate previous policy evidence', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = 'exempt',
        attendance_payroll_exemption_reason = 'Administrative'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1';
  `);

  assert.equal(revision(db), 1);

  db.exec(`
    UPDATE employee_employment
    SET attendance_payroll_exemption_reason = 'Updated reason'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1';
  `);

  assert.equal(revision(db), 2);
});

test('HR05D3B2A: unchanged compatibility writes do not increment revision', t => {
  const db = fixture(t);

  const before = revision(db);

  db.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = attendance_payroll_mode,
        attendance_payroll_exemption_reason =
          attendance_payroll_exemption_reason
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1';
  `);

  assert.equal(revision(db), before);
});

test('HR05D3B2A: unrelated employment changes do not increment revision', t => {
  const db = fixture(t);

  insertPolicy(db);

  const before = revision(db);

  db.exec(`
    UPDATE employee_employment
    SET base_salary_halalas = 450000
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1';
  `);

  assert.equal(revision(db), before);
});

test('HR05D3B2A: overlapping insert cannot increment revision', t => {
  const db = fixture(t);

  insertPolicy(db);

  const before = evidence(db);

  assert.throws(
    () => insertPolicy(db, {
      id: 'policy-2',
      from: '2026-11-15',
    }),
    /attendance_policy_period_overlap/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B2A: locked payroll rejection preserves revision and audit', t => {
  const db = fixture(t);

  insertPolicy(db);

  db.exec(`
    INSERT INTO payroll_entries VALUES (
      'payroll-1',
      'main',
      'employee-1',
      '2026-11',
      'approved'
    );
  `);

  const before = evidence(db);

  assert.throws(
    () => db.exec(`
      UPDATE employee_attendance_policy_periods
      SET effective_to = '2026-11-15',
          version = version + 1
      WHERE id = 'policy-1';
    `),
    /attendance_policy_payroll_period_locked/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B2A: audit write failure rolls back policy and revision', t => {
  const db = fixture(t);

  const before = evidence(db);

  db.exec(`
    CREATE TRIGGER synthetic_audit_failure
    BEFORE INSERT ON employee_attendance_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'SYNTHETIC_AUDIT_FAILURE');
    END;
  `);

  assert.throws(
    () => insertPolicy(db),
    /SYNTHETIC_AUDIT_FAILURE/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B2A: revision cannot be reset or skip values', t => {
  const db = fixture(t);

  insertPolicy(db);

  const before = evidence(db);

  for (const value of [
    0,
    revision(db) + 2,
    -1,
  ]) {
    assert.throws(
      () => db.prepare(`
        UPDATE employee_employment
        SET attendance_policy_revision = ?
        WHERE salon_id = 'main'
          AND employee_id = 'employee-1'
      `).run(value)
    );

    assert.deepEqual(evidence(db), before);
  }
});

test('HR05D3B2A: managed employee legacy writes cannot bypass revision authority', t => {
  const db = fixture(t);

  insertPolicy(db);

  const before = evidence(db);

  assert.throws(
    () => db.exec(`
      UPDATE employee_employment
      SET attendance_payroll_mode = 'exempt'
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1';
    `),
    /attendance_policy_legacy_write_forbidden/
  );

  assert.deepEqual(evidence(db), before);
});

test('HR05D3B2A: future ending advances revision without mutating approved payroll', t => {
  const db = fixture(t);

  insertPolicy(db);

  db.exec(`
    INSERT INTO payroll_entries VALUES (
      'payroll-1',
      'main',
      'employee-1',
      '2026-11',
      'approved'
    );
  `);

  const before = evidence(db);
  const beforeRevision = revision(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_to = '2026-12-15',
        version = version + 1
    WHERE id = 'policy-1';
  `);

  assert.equal(revision(db), beforeRevision + 1);

  assert.deepEqual(
    evidence(db).payroll,
    before.payroll
  );
});

test('HR05D3B2A: repeated policy changes never reuse a previous revision', t => {
  const db = fixture(t);

  insertPolicy(db);

  const observed = new Set([revision(db)]);

  for (const end of [
    '2026-11-15',
    '2026-11-20',
    '2026-11-25',
    null,
  ]) {
    db.prepare(`
      UPDATE employee_attendance_policy_periods
      SET effective_to = ?,
          version = version + 1
      WHERE id = 'policy-1'
    `).run(end);

    const current = revision(db);

    assert.equal(observed.has(current), false);

    observed.add(current);
  }

  assert.equal(observed.size, 5);
});
