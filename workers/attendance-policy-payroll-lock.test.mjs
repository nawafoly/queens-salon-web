import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const policyMigration = readFileSync(
  new URL(
    '../migrations/core/0106_employee_attendance_policy_periods.sql',
    import.meta.url
  ),
  'utf8'
);

const lockMigration = readFileSync(
  new URL(
    '../migrations/core/0107_attendance_policy_payroll_lock_guards.sql',
    import.meta.url
  ),
  'utf8'
);

function fixture(t) {
  const db = new DatabaseSync(':memory:');

  t.after(() => db.close());

  db.exec(`
    CREATE TABLE employee_employment (
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      attendance_payroll_mode TEXT DEFAULT 'required',
      attendance_payroll_exemption_reason TEXT,
      PRIMARY KEY (salon_id, employee_id)
    );

    CREATE TABLE payroll_entries (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      payroll_month TEXT NOT NULL,
      status TEXT NOT NULL,
      net_salary_halalas INTEGER NOT NULL DEFAULT 400000
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

  db.exec(policyMigration);
  db.exec(lockMigration);

  return db;
}

function insertPolicy(db, input = {}) {
  db.prepare(`
    INSERT INTO employee_attendance_policy_periods (
      id,
      salon_id,
      employee_id,
      policy_mode,
      effective_from,
      effective_to,
      reason,
      created_by_uid,
      created_at,
      updated_at,
      updated_by_uid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id ?? 'policy-1',
    input.salonId ?? 'main',
    input.employeeId ?? 'employee-1',
    input.mode ?? 'exempt',
    input.from ?? '2026-11-01',
    input.to ?? null,
    'Administrative exemption',
    'synthetic-admin',
    '2026-11-25T12:00:00Z',
    '2026-11-25T12:00:00Z',
    'synthetic-admin'
  );
}

function lockPayroll(
  db,
  status = 'approved',
  employeeId = 'employee-1',
  salonId = 'main'
) {
  db.prepare(`
    INSERT INTO payroll_entries (
      id, salon_id, employee_id, payroll_month, status
    ) VALUES (?, ?, ?, '2026-11', ?)
  `).run(
    `payroll-${salonId}-${employeeId}`,
    salonId,
    employeeId,
    status
  );
}

function snapshot(db) {
  return {
    employment: db.prepare(`
      SELECT * FROM employee_employment
      ORDER BY salon_id, employee_id
    `).all(),

    policies: db.prepare(`
      SELECT * FROM employee_attendance_policy_periods
      ORDER BY id
    `).all(),

    events: db.prepare(`
      SELECT * FROM employee_attendance_policy_events
      ORDER BY id
    `).all(),

    payroll: db.prepare(`
      SELECT * FROM payroll_entries
      ORDER BY id
    `).all(),
  };
}

function assertLocked(db, mutation) {
  const before = snapshot(db);

  assert.throws(
    mutation,
    /attendance_policy_payroll_period_locked/
  );

  assert.deepEqual(snapshot(db), before);
}

test('HR05D3B: approved payroll blocks overlapping exemption creation', t => {
  const db = fixture(t);

  lockPayroll(db, 'approved');

  assertLocked(db, () => insertPolicy(db));
});

test('HR05D3B: paid payroll blocks overlapping exemption creation', t => {
  const db = fixture(t);

  lockPayroll(db, 'paid');

  assertLocked(db, () => insertPolicy(db));
});

test('HR05D3B: draft payroll permits policy creation', t => {
  const db = fixture(t);

  lockPayroll(db, 'draft');

  insertPolicy(db);

  assert.equal(
    snapshot(db).policies.length,
    1
  );
});

test('HR05D3B: another employee payroll does not block creation', t => {
  const db = fixture(t);

  lockPayroll(db, 'approved', 'employee-2');

  insertPolicy(db);

  assert.equal(snapshot(db).policies.length, 1);
});

test('HR05D3B: another salon payroll does not block creation', t => {
  const db = fixture(t);

  lockPayroll(
    db, 'approved', 'employee-1', 'other'
  );

  insertPolicy(db);

  assert.equal(snapshot(db).policies.length, 1);
});

test('HR05D3B: future exemption does not overlap approved month', t => {
  const db = fixture(t);

  lockPayroll(db);

  insertPolicy(db, {
    from: '2026-12-01',
  });

  assert.equal(snapshot(db).policies.length, 1);
});

test('HR05D3B: locked period rejects retroactive date changes', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  assertLocked(db, () => db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_from = '2026-11-15',
        version = version + 1
    WHERE id = 'policy-1';
  `));
});

test('HR05D3B: locked period rejects cancellation', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  assertLocked(db, () => db.exec(`
    UPDATE employee_attendance_policy_periods
    SET status = 'cancelled',
        cancelled_at = '2026-11-25T12:00:00Z',
        cancelled_by_uid = 'synthetic-admin',
        cancellation_reason = 'Cancellation test',
        version = version + 1
    WHERE id = 'policy-1';
  `));
});

test('HR05D3B: locked period rejects policy mode changes', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  assertLocked(db, () => db.exec(`
    UPDATE employee_attendance_policy_periods
    SET policy_mode = 'required',
        version = version + 1
    WHERE id = 'policy-1';
  `));
});

test('HR05D3B: locked period rejects reason changes', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  assertLocked(db, () => db.exec(`
    UPDATE employee_attendance_policy_periods
    SET reason = 'Changed reason',
        version = version + 1
    WHERE id = 'policy-1';
  `));
});

test('HR05D3B: future ending preserves all locked dates', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  const before = snapshot(db).payroll;

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_to = '2026-12-15',
        version = version + 1
    WHERE id = 'policy-1';
  `);

  assert.equal(
    snapshot(db).policies[0].effective_to,
    '2026-12-15'
  );

  assert.deepEqual(
    snapshot(db).payroll,
    before
  );

  assert.equal(snapshot(db).events.length, 2);
});

test('HR05D3B: ending on the final locked day is permissible', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_to = '2026-11-30',
        version = version + 1
    WHERE id = 'policy-1';
  `);

  assert.equal(
    snapshot(db).policies[0].effective_to,
    '2026-11-30'
  );
});

test('HR05D3B: ending one day before lock boundary is prohibited', t => {
  const db = fixture(t);

  insertPolicy(db);
  lockPayroll(db);

  assertLocked(db, () => db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_to = '2026-11-29',
        version = version + 1
    WHERE id = 'policy-1';
  `));
});

test('HR05D3B: salon-wide attendance lock blocks creation', t => {
  const db = fixture(t);

  db.exec(`
    INSERT INTO hr_payroll_period_locks VALUES (
      'lock-1',
      'main',
      '2026-11-01',
      '2026-11-30',
      'locked'
    );
  `);

  assertLocked(db, () => insertPolicy(db, {
    employeeId: 'employee-2',
  }));
});

test('HR05D3B: unlocked attendance period permits creation', t => {
  const db = fixture(t);

  db.exec(`
    INSERT INTO hr_payroll_period_locks VALUES (
      'lock-1',
      'main',
      '2026-11-01',
      '2026-11-30',
      'unlocked'
    );
  `);

  insertPolicy(db);

  assert.equal(snapshot(db).policies.length, 1);
});

test('HR05D3B: policy cannot move from open dates into locked dates', t => {
  const db = fixture(t);

  insertPolicy(db, {
    from: '2026-12-01',
  });

  lockPayroll(db);

  assertLocked(db, () => db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_from = '2026-11-30',
        version = version + 1
    WHERE id = 'policy-1';
  `));
});
