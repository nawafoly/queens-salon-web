import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import {
  attendancePolicyDate,
  resolveAttendancePolicyForDate,
  attendanceAbsenceApplies,
} from './core/repositories/attendance-policy.js';

const required = {
  attendance_payroll_mode: 'required',
};

const legacyExempt = {
  attendance_payroll_mode: 'exempt',
  attendance_payroll_exemption_reason: 'Administrative exemption',
};

const period = {
  id: 'exemption-1',
  policy_mode: 'exempt',
  effective_from: '2026-11-15',
  effective_to: '2026-11-25',
  reason: 'Administrative exemption',
  status: 'active',
  version: 1,
};

const migration = readFileSync(
  new URL(
    '../migrations/core/0106_employee_attendance_policy_periods.sql',
    import.meta.url
  ),
  'utf8'
);

test('HR05A: exemption applies only within inclusive dates', () => {
  for (const [date, mode] of [
    ['2026-11-14', 'required'],
    ['2026-11-15', 'exempt'],
    ['2026-11-20', 'exempt'],
    ['2026-11-25', 'exempt'],
    ['2026-11-26', 'required'],
  ]) {
    assert.equal(
      resolveAttendancePolicyForDate(required, [period], date).mode,
      mode
    );
  }
});

test('HR05A: open-ended exemption remains active', () => {
  const active = { ...period, effective_to: null };

  assert.equal(
    resolveAttendancePolicyForDate(
      required, [active], '2027-01-01'
    ).mode,
    'exempt'
  );
});

test('HR05A: cancelled exemption restores required baseline', () => {
  assert.equal(
    resolveAttendancePolicyForDate(
      required,
      [{ ...period, status: 'cancelled' }],
      '2026-11-20'
    ).mode,
    'required'
  );
});

test('HR05A: existing exemption has no invented effective date', () => {
  const result = resolveAttendancePolicyForDate(
    legacyExempt, [], '2026-11-01'
  );

  assert.equal(result.mode, 'exempt');
  assert.equal(result.source, 'legacy_employment_baseline');
  assert.equal(result.effectiveFrom, null);
});

test('HR05A: explicit required period overrides legacy exemption', () => {
  const result = resolveAttendancePolicyForDate(
    legacyExempt,
    [{ ...period, policy_mode: 'required' }],
    '2026-11-20'
  );

  assert.equal(result.mode, 'required');
});

test('HR05A: overlapping policy evidence fails closed', () => {
  assert.throws(
    () => resolveAttendancePolicyForDate(
      required,
      [period, { ...period, id: 'duplicate' }],
      '2026-11-20'
    ),
    error => error.code ===
      'core_attendance_policy:overlapping_periods'
  );
});

test('HR05A: invalid calendar date is rejected', () => {
  for (const date of [
    '2026-02-30',
    '2026-13-01',
    '2026-11-00',
    'not-a-date',
  ]) {
    assert.throws(() => attendancePolicyDate(date));
  }

  assert.equal(
    attendancePolicyDate('2028-02-29'),
    '2028-02-29'
  );
});

test('HR05A: automatic absence suppressed without mutating evidence', () => {
  const absence = {
    id: 'absence-1',
    absence_type: 'automatic_check_in_lock',
    date_key: '2026-11-20',
  };

  const original = structuredClone(absence);

  assert.equal(
    attendanceAbsenceApplies(absence, { mode: 'exempt' }),
    false
  );

  assert.equal(
    attendanceAbsenceApplies(absence, { mode: 'required' }),
    true
  );

  assert.deepEqual(absence, original);
});

test('HR05A: administrative absence remains effective', () => {
  for (const absence_type of ['full_day', 'half_day']) {
    assert.equal(
      attendanceAbsenceApplies(
        { absence_type },
        { mode: 'exempt' }
      ),
      true
    );
  }
});

function fixture(t) {
  const db = new DatabaseSync(':memory:');

  t.after(() => db.close());

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE employee_employment (
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      attendance_payroll_mode TEXT DEFAULT 'required',
      attendance_payroll_exemption_reason TEXT,
      PRIMARY KEY(salon_id, employee_id)
    );

    INSERT INTO employee_employment (
      salon_id, employee_id
    ) VALUES
      ('main', 'employee-1'),
      ('main', 'employee-2'),
      ('other', 'employee-1');
  `);

  db.exec(migration);

  return db;
}

function insertPolicy(db, overrides = {}) {
  const row = {
    id: 'p1',
    salon: 'main',
    employee: 'employee-1',
    mode: 'exempt',
    from: '2026-11-15',
    to: '2026-11-25',
    reason: 'Synthetic administrative exemption',
    ...overrides,
  };

  db.prepare(`
    INSERT INTO employee_attendance_policy_periods (
      id, salon_id, employee_id, policy_mode,
      effective_from, effective_to, reason,
      created_by_uid, created_at,
      updated_at, updated_by_uid
    ) VALUES (
      ?,?,?,?,?,?,?,
      'admin','2026-11-25T12:00:00Z',
      '2026-11-25T12:00:00Z','admin'
    )
  `).run(...Object.values(row));
}

test('HR05A SQL: migration does not invent historical periods', t => {
  const db = fixture(t);

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_attendance_policy_periods
    `).get().count,
    0
  );
});

test('HR05A SQL: overlapping periods are rejected', t => {
  const db = fixture(t);

  insertPolicy(db);

  assert.throws(
    () => insertPolicy(db, {
      id: 'p2',
      from: '2026-11-25',
      to: null,
    }),
    /attendance_policy_period_overlap/
  );

  insertPolicy(db, {
    id: 'p3',
    from: '2026-11-26',
    to: null,
  });

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_attendance_policy_periods
    `).get().count,
    2
  );
});

test('HR05A SQL: employee and salon periods remain isolated', t => {
  const db = fixture(t);

  insertPolicy(db);

  insertPolicy(db, {
    id: 'p2',
    employee: 'employee-2',
  });

  insertPolicy(db, {
    id: 'p3',
    salon: 'other',
  });

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_attendance_policy_periods
    `).get().count,
    3
  );
});

test('HR05A SQL: missing employee is rejected', t => {
  const db = fixture(t);

  assert.throws(
    () => insertPolicy(db, {
      employee: 'missing-employee',
    }),
    /attendance_policy_employee_not_found/
  );
});

test('HR05A SQL: invalid date and blank reason are rejected', t => {
  const db = fixture(t);

  assert.throws(() => insertPolicy(db, {
    from: '2026-02-30',
  }));

  assert.throws(() => insertPolicy(db, {
    reason: ' ',
  }));

  assert.throws(() => insertPolicy(db, {
    from: '2026-11-26',
    to: '2026-11-25',
  }));
});

test('HR05A SQL: ending exemption preserves original audit', t => {
  const db = fixture(t);

  insertPolicy(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET effective_to = '2026-11-20',
        updated_at = '2026-11-26T12:00:00Z',
        updated_by_uid = 'admin-2',
        version = version + 1
    WHERE id = 'p1';
  `);

  const events = db.prepare(`
    SELECT *
    FROM employee_attendance_policy_events
    WHERE policy_id = 'p1'
    ORDER BY version
  `).all();

  assert.equal(events.length, 2);
  assert.equal(events[0].event_type, 'created');
  assert.equal(events[1].event_type, 'updated');

  assert.equal(
    JSON.parse(events[1].before_json).to,
    '2026-11-25'
  );

  assert.equal(
    JSON.parse(events[1].after_json).to,
    '2026-11-20'
  );
});

test('HR05A SQL: cancellation preserves policy and audit history', t => {
  const db = fixture(t);

  insertPolicy(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET status = 'cancelled',
        cancelled_at = '2026-11-26T12:00:00Z',
        cancelled_by_uid = 'admin-2',
        cancellation_reason = 'Retroactive cancellation',
        updated_at = '2026-11-26T12:00:00Z',
        updated_by_uid = 'admin-2',
        version = version + 1
    WHERE id = 'p1';
  `);

  const saved = db.prepare(`
    SELECT *
    FROM employee_attendance_policy_periods
    WHERE id = 'p1'
  `).get();

  assert.equal(saved.status, 'cancelled');
  assert.equal(saved.version, 2);

  assert.throws(
    () => db.exec(`
      DELETE FROM employee_attendance_policy_periods
      WHERE id = 'p1'
    `),
    /attendance_policy_delete_forbidden/
  );

  assert.throws(
    () => db.exec(`
      UPDATE employee_attendance_policy_periods
      SET version = 3
      WHERE id = 'p1'
    `),
    /attendance_policy_cancelled_immutable/
  );

  const event = db.prepare(`
    SELECT *
    FROM employee_attendance_policy_events
    WHERE policy_id = 'p1' AND version = 2
  `).get();

  assert.equal(event.event_type, 'cancelled');

  assert.equal(
    JSON.parse(event.after_json).cancellationReason,
    'Retroactive cancellation'
  );
});

test('HR05A SQL: identity and revision protections are enforced', t => {
  const db = fixture(t);

  insertPolicy(db);

  assert.throws(
    () => db.exec(`
      UPDATE employee_attendance_policy_periods
      SET employee_id = 'employee-2',
          version = version + 1
      WHERE id = 'p1'
    `),
    /attendance_policy_identity_immutable/
  );

  assert.throws(
    () => db.exec(`
      UPDATE employee_attendance_policy_periods
      SET reason = 'Invalid update'
      WHERE id = 'p1'
    `),
    /attendance_policy_revision_invalid/
  );
});

test('HR05A SQL: audit history cannot be updated or deleted', t => {
  const db = fixture(t);

  insertPolicy(db);

  assert.throws(
    () => db.exec(`
      UPDATE employee_attendance_policy_events
      SET actor_uid = 'forged'
    `),
    /attendance_policy_audit_immutable/
  );

  assert.throws(
    () => db.exec(`
      DELETE FROM employee_attendance_policy_events
    `),
    /attendance_policy_audit_immutable/
  );
});

test('HR05A SQL: overlapping updates roll back without audit changes', t => {
  const db = fixture(t);

  insertPolicy(db);

  insertPolicy(db, {
    id: 'p2',
    from: '2026-11-26',
    to: null,
  });

  assert.throws(
    () => db.exec(`
      UPDATE employee_attendance_policy_periods
      SET effective_to = '2026-11-26',
          version = version + 1
      WHERE id = 'p1'
    `),
    /attendance_policy_period_overlap/
  );

  assert.equal(
    db.prepare(`
      SELECT version
      FROM employee_attendance_policy_periods
      WHERE id = 'p1'
    `).get().version,
    1
  );

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_attendance_policy_events
    `).get().count,
    2
  );
});

test('HR05B: managed policy never falls back to legacy exemption', () => {
  const employment = {
    ...legacyExempt,
    attendance_policy_authority: 'effective_dated',
  };

  assert.equal(
    resolveAttendancePolicyForDate(
      employment,
      [period],
      '2026-11-14'
    ).mode,
    'required'
  );

  assert.equal(
    resolveAttendancePolicyForDate(
      employment,
      [period],
      '2026-11-20'
    ).mode,
    'exempt'
  );

  assert.equal(
    resolveAttendancePolicyForDate(
      employment,
      [period],
      '2026-11-26'
    ).mode,
    'required'
  );
});

test('HR05B: cancelling managed exemption restores required attendance', () => {
  const employment = {
    ...legacyExempt,
    attendance_policy_authority: 'effective_dated',
  };

  const result = resolveAttendancePolicyForDate(
    employment,
    [{ ...period, status: 'cancelled' }],
    '2026-11-20'
  );

  assert.equal(result.mode, 'required');
  assert.equal(result.source, 'effective_dated_default');
});

test('HR05B: legacy employee without managed periods remains compatible', () => {
  const employment = {
    ...legacyExempt,
    attendance_policy_authority: 'legacy',
  };

  assert.equal(
    resolveAttendancePolicyForDate(
      employment, [], '2026-11-20'
    ).mode,
    'exempt'
  );
});

test('HR05B: changing legacy employment fields cannot override managed policy', () => {
  for (const baseline of ['required', 'exempt']) {
    const employment = {
      attendance_payroll_mode: baseline,
      attendance_payroll_exemption_reason: 'Legacy value',
      attendance_policy_authority: 'effective_dated',
    };

    assert.equal(
      resolveAttendancePolicyForDate(
        employment, [], '2026-11-20'
      ).mode,
      'required'
    );
  }
});

test('HR05B: invalid policy authority fails closed', () => {
  assert.throws(
    () => resolveAttendancePolicyForDate(
      {
        ...legacyExempt,
        attendance_policy_authority: 'invalid',
      },
      [],
      '2026-11-20'
    ),
    error => error.code ===
      'core_attendance_policy:invalid_authority'
  );
});

test('HR05B SQL: existing employees remain legacy by default', t => {
  const db = fixture(t);

  const rows = db.prepare(`
    SELECT attendance_policy_authority
    FROM employee_employment
  `).all();

  assert.equal(rows.length, 3);

  for (const row of rows) {
    assert.equal(
      row.attendance_policy_authority,
      'legacy'
    );
  }
});

test('HR05B SQL: invalid authority is rejected', t => {
  const db = fixture(t);

  assert.throws(() => db.exec(`
    UPDATE employee_employment
    SET attendance_policy_authority = 'invalid'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `));
});

test('HR05B SQL: managed ownership cannot be downgraded', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_authority = 'effective_dated'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  assert.throws(
    () => db.exec(`
      UPDATE employee_employment
      SET attendance_policy_authority = 'legacy'
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
    `),
    /attendance_policy_authority_downgrade_forbidden/
  );

  const row = db.prepare(`
    SELECT attendance_policy_authority
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).get();

  assert.equal(
    row.attendance_policy_authority,
    'effective_dated'
  );
});

test('HR05B SQL: ownership transition remains employee-scoped', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_authority = 'effective_dated'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  const rows = db.prepare(`
    SELECT salon_id,
           employee_id,
           attendance_policy_authority
    FROM employee_employment
    ORDER BY salon_id, employee_id
  `).all();

  assert.deepEqual(
    rows.map(row => [
      row.salon_id,
      row.employee_id,
      row.attendance_policy_authority,
    ]),
    [
      ['main', 'employee-1', 'effective_dated'],
      ['main', 'employee-2', 'legacy'],
      ['other', 'employee-1', 'legacy'],
    ]
  );
});

test('HR05B legacy guard: managed employee rejects legacy mode changes', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_authority = 'effective_dated'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  assert.throws(
    () => db.exec(`
      UPDATE employee_employment
      SET attendance_payroll_mode = 'exempt'
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
    `),
    /attendance_policy_legacy_write_forbidden/
  );

  const row = db.prepare(`
    SELECT attendance_payroll_mode
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).get();

  assert.equal(row.attendance_payroll_mode, 'required');
});

test('HR05B legacy guard: unchanged legacy field remains compatible', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_authority = 'effective_dated'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  db.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = 'required'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  assert.equal(
    db.prepare(`
      SELECT attendance_payroll_mode
      FROM employee_employment
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
    `).get().attendance_payroll_mode,
    'required'
  );
});

test('HR05B legacy guard: unmanaged employee remains compatible', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = 'exempt'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-2'
  `);

  assert.equal(
    db.prepare(`
      SELECT attendance_payroll_mode
      FROM employee_employment
      WHERE salon_id = 'main'
        AND employee_id = 'employee-2'
    `).get().attendance_payroll_mode,
    'exempt'
  );
});

test('HR05B legacy guard: managed employee rejects legacy reason changes', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_policy_authority = 'effective_dated'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  assert.throws(
    () => db.exec(`
      UPDATE employee_employment
      SET attendance_payroll_exemption_reason = 'Unexpected legacy change'
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
    `),
    /attendance_policy_legacy_write_forbidden/
  );
});

test('HR05B adoption: creating a period transfers ownership', t => {
  const db = fixture(t);

  insertPolicy(db);

  const row = db.prepare(`
    SELECT attendance_policy_authority
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).get();

  assert.equal(
    row.attendance_policy_authority,
    'effective_dated'
  );
});

test('HR05B adoption: unrelated employees remain legacy', t => {
  const db = fixture(t);

  insertPolicy(db);

  const rows = db.prepare(`
    SELECT salon_id,
           employee_id,
           attendance_policy_authority
    FROM employee_employment
    ORDER BY salon_id, employee_id
  `).all();

  assert.deepEqual(
    rows.map(row => [
      row.salon_id,
      row.employee_id,
      row.attendance_policy_authority,
    ]),
    [
      ['main', 'employee-1', 'effective_dated'],
      ['main', 'employee-2', 'legacy'],
      ['other', 'employee-1', 'legacy'],
    ]
  );
});

test('HR05B adoption: failed insertion leaves legacy ownership intact', t => {
  const db = fixture(t);

  assert.throws(() => insertPolicy(db, {
    from: '2026-02-30',
  }));

  const row = db.prepare(`
    SELECT attendance_policy_authority
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).get();

  assert.equal(row.attendance_policy_authority, 'legacy');

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_attendance_policy_events
    `).get().count,
    0
  );
});

test('HR05B adoption: audit failure rolls back policy and ownership', t => {
  const db = fixture(t);

  db.exec(`
    CREATE TRIGGER simulate_policy_audit_failure
    BEFORE INSERT ON employee_attendance_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'simulated_policy_audit_failure');
    END;
  `);

  assert.throws(
    () => insertPolicy(db),
    /simulated_policy_audit_failure/
  );

  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_attendance_policy_periods
    `).get().count,
    0
  );

  assert.equal(
    db.prepare(`
      SELECT attendance_policy_authority
      FROM employee_employment
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
    `).get().attendance_policy_authority,
    'legacy'
  );
});

test('HR05B adoption: cancellation never restores legacy exemption', t => {
  const db = fixture(t);

  db.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = 'exempt'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  insertPolicy(db);

  db.exec(`
    UPDATE employee_attendance_policy_periods
    SET status = 'cancelled',
        cancelled_at = '2026-11-26T12:00:00Z',
        cancelled_by_uid = 'admin',
        cancellation_reason = 'Retroactive cancellation',
        updated_at = '2026-11-26T12:00:00Z',
        updated_by_uid = 'admin',
        version = version + 1
    WHERE id = 'p1';
  `);

  const employment = db.prepare(`
    SELECT *
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).get();

  const periods = db.prepare(`
    SELECT *
    FROM employee_attendance_policy_periods
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).all();

  assert.equal(
    employment.attendance_policy_authority,
    'effective_dated'
  );

  assert.equal(
    employment.attendance_payroll_mode,
    'exempt'
  );

  assert.equal(
    resolveAttendancePolicyForDate(
      employment,
      periods,
      '2026-11-20'
    ).mode,
    'required'
  );
});

import {
  createAttendancePolicyPeriod,
  updateAttendancePolicyPeriod,
  cancelAttendancePolicyPeriod,
  resolveEmployeeAttendancePolicy,
  loadAttendancePolicyPeriods,
} from './core/repositories/attendance-policy.js';

function hr05CommandDb(database) {
  return {
    prepare(sql) {
      function statement(params = []) {
        return {
          bind(...values) {
            return statement(values);
          },

          async first(column) {
            const row = database.prepare(sql).get(...params);
            if (!row) return null;
            return column ? row[column] : row;
          },

          async all() {
            return {
              success: true,
              results: database.prepare(sql).all(...params),
              meta: {},
            };
          },

          async run() {
            const result = database.prepare(sql).run(...params);

            return {
              success: true,
              meta: {
                changes: Number(result.changes),
              },
            };
          },

          async raw() {
            const prepared = database.prepare(sql);
            prepared.setReturnArrays(true);
            return prepared.all(...params);
          },
        };
      }

      return statement();
    },
  };
}

const hr05Admin = {
  uid: 'synthetic-admin',
  role: 'owner',
};

const hr05Input = {
  mode: 'exempt',
  effectiveFrom: '2026-11-15',
  effectiveTo: '2026-11-25',
  reason: 'Synthetic administrative exemption',
};

function hr05CommandSnapshot(database) {
  return {
    employment: database.prepare(`
      SELECT *
      FROM employee_employment
      ORDER BY salon_id, employee_id
    `).all(),

    periods: database.prepare(`
      SELECT *
      FROM employee_attendance_policy_periods
      ORDER BY id
    `).all(),

    events: database.prepare(`
      SELECT *
      FROM employee_attendance_policy_events
      ORDER BY policy_id, version
    `).all(),
  };
}

test('HR05B commands: complete exemption lifecycle', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input,
    hr05Admin
  );

  assert.equal(created.status, 'active');
  assert.equal(created.version, 1);
  assert.equal(created.created_by_uid, hr05Admin.uid);

  for (const [date, mode] of [
    ['2026-11-14', 'required'],
    ['2026-11-15', 'exempt'],
    ['2026-11-25', 'exempt'],
    ['2026-11-26', 'required'],
  ]) {
    const policy = await resolveEmployeeAttendancePolicy(
      db, 'main', 'employee-1', date
    );

    assert.equal(policy.mode, mode);
  }

  const updated = await updateAttendancePolicyPeriod(
    db, 'main', 'employee-1', created.id,
    {
      version: 1,
      effectiveTo: '2026-11-20',
    },
    hr05Admin
  );

  assert.equal(updated.version, 2);
  assert.equal(updated.effective_to, '2026-11-20');

  assert.equal(
    (await resolveEmployeeAttendancePolicy(
      db, 'main', 'employee-1', '2026-11-21'
    )).mode,
    'required'
  );

  const cancelled = await cancelAttendancePolicyPeriod(
    db, 'main', 'employee-1', created.id,
    {
      version: 2,
      reason: 'Synthetic retroactive cancellation',
    },
    hr05Admin
  );

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.version, 3);

  assert.equal(
    (await resolveEmployeeAttendancePolicy(
      db, 'main', 'employee-1', '2026-11-16'
    )).mode,
    'required'
  );

  const history = await loadAttendancePolicyPeriods(
    db, 'main', 'employee-1'
  );

  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'cancelled');

  const events = database.prepare(`
    SELECT event_type, version
    FROM employee_attendance_policy_events
    WHERE policy_id = ?
    ORDER BY version
  `).all(created.id);

  assert.deepEqual(
    events.map(row => [row.event_type, row.version]),
    [
      ['created', 1],
      ['updated', 2],
      ['cancelled', 3],
    ]
  );
});

test('HR05B commands: stale version cannot mutate policy', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1', hr05Input, hr05Admin
  );

  await updateAttendancePolicyPeriod(
    db, 'main', 'employee-1', created.id,
    { version: 1, effectiveTo: '2026-11-20' },
    hr05Admin
  );

  const before = hr05CommandSnapshot(database);

  await assert.rejects(
    () => updateAttendancePolicyPeriod(
      db, 'main', 'employee-1', created.id,
      { version: 1, effectiveTo: '2026-11-19' },
      hr05Admin
    ),
    error => error.code ===
      'core_attendance_policy:version_conflict'
  );

  await assert.rejects(
    () => cancelAttendancePolicyPeriod(
      db, 'main', 'employee-1', created.id,
      { version: 1, reason: 'Stale cancellation' },
      hr05Admin
    ),
    error => error.code ===
      'core_attendance_policy:version_conflict'
  );

  assert.deepEqual(hr05CommandSnapshot(database), before);
});

test('HR05B commands: employee and salon isolation', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1', hr05Input, hr05Admin
  );

  const before = hr05CommandSnapshot(database);

  for (const [salon, employee] of [
    ['main', 'employee-2'],
    ['other', 'employee-1'],
  ]) {
    await assert.rejects(
      () => updateAttendancePolicyPeriod(
        db, salon, employee, created.id,
        { version: 1, reason: 'Unauthorized target' },
        hr05Admin
      ),
      error => error.code ===
        'core_attendance_policy:period_not_found'
    );

    await assert.rejects(
      () => cancelAttendancePolicyPeriod(
        db, salon, employee, created.id,
        { version: 1, reason: 'Unauthorized target' },
        hr05Admin
      ),
      error => error.code ===
        'core_attendance_policy:period_not_found'
    );

    assert.deepEqual(
      await loadAttendancePolicyPeriods(
        db, salon, employee
      ),
      []
    );
  }

  assert.deepEqual(hr05CommandSnapshot(database), before);
});

test('HR05B commands: legacy exemption requires explicit adoption', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  database.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = 'exempt',
        attendance_payroll_exemption_reason = 'Legacy exemption'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  const before = hr05CommandSnapshot(database);

  await assert.rejects(
    () => createAttendancePolicyPeriod(
      db, 'main', 'employee-1',
      hr05Input,
      hr05Admin
    ),
    error => error.code ===
      'core_attendance_policy:legacy_adoption_confirmation_required'
  );

  assert.deepEqual(hr05CommandSnapshot(database), before);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    {
      ...hr05Input,
      confirmLegacyAdoption: true,
    },
    hr05Admin
  );

  assert.equal(created.status, 'active');

  assert.equal(
    (await resolveEmployeeAttendancePolicy(
      db, 'main', 'employee-1', '2026-11-14'
    )).mode,
    'required'
  );
});

test('HR05B commands: invalid input leaves all evidence unchanged', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  const before = hr05CommandSnapshot(database);

  for (const input of [
    { ...hr05Input, effectiveFrom: '2026-02-30' },
    { ...hr05Input, effectiveTo: '2026-11-14' },
    { ...hr05Input, reason: ' ' },
    { ...hr05Input, mode: 'invalid' },
  ]) {
    await assert.rejects(
      () => createAttendancePolicyPeriod(
        db, 'main', 'employee-1',
        input, hr05Admin
      )
    );
  }

  await assert.rejects(
    () => createAttendancePolicyPeriod(
      db, 'main', 'missing-employee',
      hr05Input, hr05Admin
    )
  );

  await assert.rejects(
    () => createAttendancePolicyPeriod(
      db, 'main', 'employee-1',
      hr05Input, { uid: '' }
    )
  );

  assert.deepEqual(hr05CommandSnapshot(database), before);
});

test('HR05B commands: overlapping creation leaves history unchanged', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  const before = hr05CommandSnapshot(database);

  await assert.rejects(
    () => createAttendancePolicyPeriod(
      db, 'main', 'employee-1',
      {
        ...hr05Input,
        effectiveFrom: '2026-11-20',
        effectiveTo: null,
      },
      hr05Admin
    ),
    /attendance_policy_period_overlap/
  );

  assert.deepEqual(hr05CommandSnapshot(database), before);
});

test('HR05B commands: concurrent updates allow one revision only', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  const results = await Promise.allSettled([
    updateAttendancePolicyPeriod(
      db, 'main', 'employee-1', created.id,
      { version: 1, effectiveTo: '2026-11-20' },
      hr05Admin
    ),

    updateAttendancePolicyPeriod(
      db, 'main', 'employee-1', created.id,
      { version: 1, effectiveTo: '2026-11-21' },
      hr05Admin
    ),
  ]);

  assert.equal(
    results.filter(result =>
      result.status === 'fulfilled'
    ).length,
    1
  );

  assert.equal(
    results.filter(result =>
      result.status === 'rejected'
    ).length,
    1
  );

  const snapshot = hr05CommandSnapshot(database);

  assert.equal(snapshot.periods.length, 1);
  assert.equal(snapshot.periods[0].version, 2);
  assert.equal(snapshot.events.length, 2);
});

test('HR05B commands: cancelled period cannot be changed or cancelled again', async t => {
  const database = fixture(t);
  const db = hr05CommandDb(database);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  await cancelAttendancePolicyPeriod(
    db, 'main', 'employee-1', created.id,
    { version: 1, reason: 'Cancelled once' },
    hr05Admin
  );

  const before = hr05CommandSnapshot(database);

  await assert.rejects(
    () => updateAttendancePolicyPeriod(
      db, 'main', 'employee-1', created.id,
      { version: 2, reason: 'Forbidden update' },
      hr05Admin
    ),
    error => error.code ===
      'core_attendance_policy:period_not_active'
  );

  await assert.rejects(
    () => cancelAttendancePolicyPeriod(
      db, 'main', 'employee-1', created.id,
      { version: 2, reason: 'Duplicate cancellation' },
      hr05Admin
    ),
    error => error.code ===
      'core_attendance_policy:period_not_active'
  );

  assert.deepEqual(hr05CommandSnapshot(database), before);
});

import {
  recordAutomaticAttendanceAbsence,
} from './core/repositories/attendance-policy.js';

function hr05AbsenceFixture(t) {
  const database = fixture(t);

  database.exec(`
    CREATE TABLE employee_absences (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      employee_uid TEXT,
      date_key TEXT NOT NULL,
      absence_type TEXT NOT NULL,
      note TEXT,
      created_by_uid TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  return {
    database,
    db: hr05CommandDb(database),
  };
}

function hr05RecordAbsence(
  db,
  date,
  employeeId = 'employee-1',
  salonId = 'main'
) {
  return recordAutomaticAttendanceAbsence(
    db,
    salonId,
    employeeId,
    'synthetic-uid',
    date,
    '2026-11-25T12:00:00Z'
  );
}

function hr05AbsenceRows(database) {
  return database.prepare(`
    SELECT *
    FROM employee_absences
    ORDER BY id
  `).all();
}

test('HR05C: required attendance still records automatic absence', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  const first = await hr05RecordAbsence(db, '2026-11-20');
  const replay = await hr05RecordAbsence(db, '2026-11-20');

  assert.equal(first.created, 1);
  assert.equal(replay.created, 0);

  const rows = hr05AbsenceRows(database);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].absence_type, 'automatic_check_in_lock');
  assert.equal(rows[0].created_by_uid, 'system');
});

test('HR05C: legacy exempt employee receives no automatic absence', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  database.exec(`
    UPDATE employee_employment
    SET attendance_payroll_mode = 'exempt'
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `);

  const result = await hr05RecordAbsence(db, '2026-11-20');

  assert.equal(result.created, 0);
  assert.deepEqual(hr05AbsenceRows(database), []);
});

test('HR05C: dated exemption applies only within its boundaries', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  for (const [date, expected] of [
    ['2026-11-14', 1],
    ['2026-11-15', 0],
    ['2026-11-20', 0],
    ['2026-11-25', 0],
    ['2026-11-26', 1],
  ]) {
    const result = await hr05RecordAbsence(db, date);

    assert.equal(result.created, expected, date);
  }

  assert.deepEqual(
    hr05AbsenceRows(database).map(row => row.date_key),
    ['2026-11-14', '2026-11-26']
  );
});

test('HR05C: retroactive exemption preserves existing absence evidence', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  await hr05RecordAbsence(db, '2026-11-20');

  const original = hr05AbsenceRows(database);

  await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  const result = await hr05RecordAbsence(db, '2026-11-20');

  assert.equal(result.created, 0);
  assert.deepEqual(hr05AbsenceRows(database), original);

  const policy = await resolveEmployeeAttendancePolicy(
    db, 'main', 'employee-1', '2026-11-20'
  );

  assert.equal(
    attendanceAbsenceApplies(original[0], policy),
    false
  );
});

test('HR05C: cancelled exemption allows absence classification again', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  const created = await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  assert.equal(
    (await hr05RecordAbsence(db, '2026-11-20')).created,
    0
  );

  await cancelAttendancePolicyPeriod(
    db, 'main', 'employee-1', created.id,
    {
      version: 1,
      reason: 'Synthetic exemption cancellation',
    },
    hr05Admin
  );

  assert.equal(
    (await hr05RecordAbsence(db, '2026-11-20')).created,
    1
  );

  assert.equal(hr05AbsenceRows(database).length, 1);
});

test('HR05C: exemption does not affect other employees or salons', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  await createAttendancePolicyPeriod(
    db, 'main', 'employee-1',
    hr05Input, hr05Admin
  );

  assert.equal(
    (await hr05RecordAbsence(db, '2026-11-20')).created,
    0
  );

  assert.equal(
    (await hr05RecordAbsence(
      db, '2026-11-20', 'employee-2'
    )).created,
    1
  );

  assert.equal(
    (await hr05RecordAbsence(
      db, '2026-11-20', 'employee-1', 'other'
    )).created,
    1
  );

  assert.equal(hr05AbsenceRows(database).length, 2);
});

test('HR05C: administrative absence is not replaced by automatic absence', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  database.exec(`
    INSERT INTO employee_absences (
      id, salon_id, employee_id,
      date_key, absence_type, created_by_uid
    ) VALUES (
      'manual-absence',
      'main',
      'employee-1',
      '2026-11-20',
      'full_day',
      'admin'
    );
  `);

  const before = hr05AbsenceRows(database);

  const result = await hr05RecordAbsence(db, '2026-11-20');

  assert.equal(result.created, 0);

  assert.deepEqual(hr05AbsenceRows(database), before);
});

test('HR05C: missing employment evidence does not create absence', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  const result = await hr05RecordAbsence(
    db, '2026-11-20', 'unknown-employee'
  );

  assert.equal(result.created, 0);

  assert.deepEqual(hr05AbsenceRows(database), []);
});

test('HR05C: policy lookup failure cannot create an absence', async t => {
  const { database, db } = hr05AbsenceFixture(t);

  database.exec(`
    DROP TABLE employee_attendance_policy_periods;
  `);

  await assert.rejects(
    () => hr05RecordAbsence(db, '2026-11-20')
  );

  assert.deepEqual(hr05AbsenceRows(database), []);
});
