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
