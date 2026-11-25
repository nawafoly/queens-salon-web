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
      attendance_policy_revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (salon_id, employee_id)
    );

    CREATE TABLE payroll_entries (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      payroll_month TEXT NOT NULL,
      status TEXT NOT NULL,
      attendance_summary_json TEXT,
      net_salary_halalas INTEGER DEFAULT 400000
    );

    CREATE TABLE financial_audit (
      id TEXT PRIMARY KEY,
      payroll_id TEXT NOT NULL
    );

    CREATE TABLE synthetic_carryovers (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    INSERT INTO employee_employment VALUES
      ('main', 'employee-1', 0),
      ('main', 'employee-2', 0),
      ('other', 'employee-1', 0);

    INSERT INTO synthetic_carryovers
    VALUES ('carryover-1', 'pending');
  `);

  db.exec(migration(
    '0109_payroll_attendance_policy_approval_guard.sql'
  ));

  return db;
}

function policyEvidence(revision = 0) {
  return JSON.stringify({
    attendancePayrollMode: 'required',
    attendancePolicyRevision: revision,
    attendancePolicySnapshot: {
      schemaVersion: 1,
      authority: 'effective_dated',
      from: '2026-11-01',
      to: '2026-11-30',
    },
  });
}

function insertPayroll(db, input = {}) {
  db.prepare(`
    INSERT INTO payroll_entries (
      id, salon_id, employee_id,
      payroll_month, status,
      attendance_summary_json
    ) VALUES (?, ?, ?, '2026-11', ?, ?)
  `).run(
    input.id ?? 'payroll-1',
    input.salonId ?? 'main',
    input.employeeId ?? 'employee-1',
    input.status ?? 'draft',
    Object.hasOwn(input, 'summary')
      ? input.summary
      : policyEvidence()
  );
}

function payroll(db) {
  return db.prepare(`
    SELECT * FROM payroll_entries
    WHERE id = 'payroll-1'
  `).get();
}

function approve(db) {
  db.exec(`
    UPDATE payroll_entries
    SET status = 'approved'
    WHERE id = 'payroll-1';
  `);
}

function changeRevision(db) {
  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_revision =
        attendance_policy_revision + 1
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1';
  `);
}

test('HR05D3B3A: matching revision permits approval', t => {
  const db = fixture(t);

  insertPayroll(db);
  approve(db);

  assert.equal(payroll(db).status, 'approved');
});

test('HR05D3B3A: revision zero is valid evidence', t => {
  const db = fixture(t);

  insertPayroll(db, {
    status: 'approved',
    summary: policyEvidence(0),
  });

  assert.equal(payroll(db).status, 'approved');
});

test('HR05D3B3A: stale revision blocks approval', t => {
  const db = fixture(t);

  insertPayroll(db);
  changeRevision(db);

  const before = payroll(db);

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_revision_mismatch/
  );

  assert.deepEqual(payroll(db), before);
});

test('HR05D3B3A: stale revision blocks direct approved insert', t => {
  const db = fixture(t);

  changeRevision(db);

  assert.throws(
    () => insertPayroll(db, {
      status: 'approved',
    }),
    /payroll_attendance_policy_revision_mismatch/
  );

  assert.equal(payroll(db), undefined);
});

test('HR05D3B3A: stale revision blocks direct paid insert', t => {
  const db = fixture(t);

  changeRevision(db);

  assert.throws(
    () => insertPayroll(db, {
      status: 'paid',
    }),
    /payroll_attendance_policy_revision_mismatch/
  );

  assert.equal(payroll(db), undefined);
});

test('HR05D3B3A: malformed evidence blocks approval', t => {
  const db = fixture(t);

  insertPayroll(db, {
    summary: '{invalid-json',
  });

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_snapshot_invalid/
  );
});

test('HR05D3B3A: missing revision blocks approval', t => {
  const db = fixture(t);

  insertPayroll(db, {
    summary: '{}',
  });

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_revision_required/
  );
});

test('HR05D3B3A: null revision cannot substitute zero', t => {
  const db = fixture(t);

  insertPayroll(db, {
    summary: policyEvidence(null),
  });

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_revision_required/
  );
});

test('HR05D3B3A: string revision cannot substitute integer', t => {
  const db = fixture(t);

  insertPayroll(db, {
    summary: policyEvidence('0'),
  });

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_revision_required/
  );
});

test('HR05D3B3A: missing policy snapshot blocks approval', t => {
  const db = fixture(t);

  insertPayroll(db, {
    summary: JSON.stringify({
      attendancePolicyRevision: 0,
    }),
  });

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_snapshot_required/
  );
});

test('HR05D3B3A: unrelated employee revision does not block approval', t => {
  const db = fixture(t);

  insertPayroll(db);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_revision = 5
    WHERE employee_id = 'employee-2';
  `);

  approve(db);

  assert.equal(payroll(db).status, 'approved');
});

test('HR05D3B3A: unrelated salon revision does not block approval', t => {
  const db = fixture(t);

  insertPayroll(db);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_revision = 5
    WHERE salon_id = 'other';
  `);

  approve(db);

  assert.equal(payroll(db).status, 'approved');
});

test('HR05D3B3A: missing employee evidence blocks approval', t => {
  const db = fixture(t);

  insertPayroll(db, {
    employeeId: 'unknown',
  });

  assert.throws(
    () => approve(db),
    /payroll_attendance_policy_revision_mismatch/
  );
});

test('HR05D3B3A: future policy change does not block paying approved payroll', t => {
  const db = fixture(t);

  insertPayroll(db);
  approve(db);

  const originalEvidence =
    payroll(db).attendance_summary_json;

  changeRevision(db);

  db.exec(`
    UPDATE payroll_entries
    SET status = 'paid'
    WHERE id = 'payroll-1';
  `);

  assert.equal(payroll(db).status, 'paid');

  assert.equal(
    payroll(db).attendance_summary_json,
    originalEvidence
  );
});

test('HR05D3B3A: approved payroll evidence cannot be replaced', t => {
  const db = fixture(t);

  insertPayroll(db);
  approve(db);

  const before = payroll(db);

  assert.throws(
    () => db.exec(`
      UPDATE payroll_entries
      SET attendance_summary_json = '{}'
      WHERE id = 'payroll-1';
    `),
    /payroll_attendance_policy_locked_evidence/
  );

  assert.deepEqual(payroll(db), before);
});

test('HR05D3B3A: paid payroll evidence cannot be replaced', t => {
  const db = fixture(t);

  insertPayroll(db, {
    status: 'paid',
  });

  const before = payroll(db);

  assert.throws(
    () => db.exec(`
      UPDATE payroll_entries
      SET attendance_summary_json = '{}'
      WHERE id = 'payroll-1';
    `),
    /payroll_attendance_policy_locked_evidence/
  );

  assert.deepEqual(payroll(db), before);
});

test('HR05D3B3A: rejected approval rolls back enclosing financial transaction', t => {
  const db = fixture(t);

  insertPayroll(db);
  changeRevision(db);

  const before = payroll(db);

  db.exec('BEGIN');

  try {
    db.exec(`
      INSERT INTO financial_audit
      VALUES ('audit-1', 'payroll-1');

      UPDATE synthetic_carryovers
      SET status = 'applied'
      WHERE id = 'carryover-1';
    `);

    assert.throws(
      () => approve(db),
      /payroll_attendance_policy_revision_mismatch/
    );
  } finally {
    db.exec('ROLLBACK');
  }

  assert.deepEqual(payroll(db), before);

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count FROM financial_audit
    `).get().count,
    0
  );

  assert.equal(
    db.prepare(`
      SELECT status FROM synthetic_carryovers
      WHERE id = 'carryover-1'
    `).get().status,
    'pending'
  );
});

test('HR05D3B3A: refreshed draft revision permits approval', t => {
  const db = fixture(t);

  insertPayroll(db);
  changeRevision(db);

  db.prepare(`
    UPDATE payroll_entries
    SET attendance_summary_json = ?
    WHERE id = 'payroll-1'
  `).run(policyEvidence(1));

  approve(db);

  assert.equal(payroll(db).status, 'approved');
});

test('HR05D3B3A: upsert cannot bypass stale revision guard', t => {
  const db = fixture(t);

  insertPayroll(db);
  changeRevision(db);

  const before = payroll(db);

  assert.throws(
    () => db.prepare(`
      INSERT INTO payroll_entries (
        id, salon_id, employee_id,
        payroll_month, status,
        attendance_summary_json
      ) VALUES (
        'payroll-1', 'main', 'employee-1',
        '2026-11', 'approved', ?
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        attendance_summary_json =
          excluded.attendance_summary_json
    `).run(policyEvidence(0)),
    /payroll_attendance_policy_revision_mismatch/
  );

  assert.deepEqual(payroll(db), before);
});
