import test from 'node:test';
import assert from 'node:assert/strict';

import {
  migratedD1
} from './test-support/sqlite-d1.mjs';

import {
  createWeeklyRestRescheduling
} from './core/repositories/weekly-rest-rescheduling.js';

import {
  resolveEmployeeShift,
  resolveEmployeeShiftsBatch,
  createScheduleException
} from './core/repositories/shift-control.js';

import {
  isExplicitWeeklyRestShift
} from './core/repositories/rest-holiday-compliance.js';

const salonId = 'main';
const employeeId = 'test-employee';

const originalDate = '2026-11-22';
const replacementDate = '2026-11-23';

const actor = {
  uid: 'test-admin'
};

const payload = {
  id: 'reschedule-operation-1',
  employeeId,
  originalRestDate: originalDate,
  replacementRestDate: replacementDate,
  startTime: '12:00',
  endTime: '20:00',
  reason: 'Synthetic weekly rest rescheduling'
};

async function fixture(t) {
  const core = migratedD1('../../migrations/core/');
  const attendance = migratedD1('../attendance-migrations/');

  t.after(() => {
    core.database.close();
    attendance.database.close();
  });

  await core.prepare(`
    INSERT INTO employee_profiles (
      id, salon_id, firebase_uid, name,
      status, created_at, updated_at
    )
    VALUES (
      'test-employee', 'main', 'test-uid',
      'Synthetic employee', 'active',
      '2026-01-01', '2026-01-01'
    )
  `).run();

  await core.prepare(`
    INSERT INTO employee_employment (
      salon_id, employee_id,
      base_salary_halalas,
      expected_work_days,
      expected_work_hours,
      daily_scheduled_hours,
      attendance_payroll_mode,
      social_insurance_category,
      social_insurance_effective_from,
      gosi_wage_mode,
      created_at, updated_at
    )
    VALUES (
      'main', 'test-employee',
      300000, 30, 240, 8,
      'required', 'non_saudi',
      '2026-01-01', 'derived',
      '2026-01-01', '2026-01-01'
    )
  `).run();

  for (let weekday = 0; weekday < 7; weekday++) {
    const active = weekday === 0 ? 0 : 1;

    await core.prepare(`
      INSERT INTO hr_work_schedules (
        id, salon_id, employee_id,
        weekday, start_time, end_time,
        active, effective_from,
        schedule_source,
        created_at, updated_at
      )
      VALUES (
        ?, 'main', 'test-employee',
        ?, ?, ?, ?, '2026-01-01',
        ?, '2026-01-01', '2026-01-01'
      )
    `).bind(
      `weekly-${weekday}`,
      weekday,
      active ? '12:00' : null,
      active ? '20:00' : null,
      active,
      active ? 'legacy' : 'weekly_off'
    ).run();
  }

  async function rows(table) {
    const allowed = new Set([
      'hr_work_schedules',
      'hr_schedule_exceptions',
      'hr_shift_audit_log',
      'employee_weekly_rest_rescheduling',
      'employee_comp_time_ledger',
      'employee_weekly_rest_work_assignments',
      'employee_weekly_rest_events',
      'employee_absences',
      'payroll_entries'
    ]);

    if (!allowed.has(table)) {
      throw new Error('Unexpected test table');
    }

    return (
      await core.prepare(`
        SELECT *
          FROM ${table}
         ORDER BY id
      `).all()
    ).results;
  }

  async function create(overrides = {}, actorOverride = actor) {
    return createWeeklyRestRescheduling(
      core,
      salonId,
      {
        ...payload,
        ...overrides
      },
      actorOverride,
      attendance
    );
  }

  async function shift(date) {
    return resolveEmployeeShift(
      core,
      salonId,
      employeeId,
      date
    );
  }

  async function snapshot() {
    return {
      schedules: await rows('hr_work_schedules'),
      exceptions: await rows('hr_schedule_exceptions'),
      audit: await rows('hr_shift_audit_log'),
      operations: await rows('employee_weekly_rest_rescheduling'),
      ledger: await rows('employee_comp_time_ledger'),
      payroll: await rows('payroll_entries')
    };
  }

  return {
    core,
    attendance,
    rows,
    create,
    shift,
    snapshot
  };
}

test('HR09E4 creates a complete atomic work/rest swap', async t => {
  const f = await fixture(t);

  const originalShift = await f.shift(originalDate);
  const replacementShift = await f.shift(replacementDate);

  assert.equal(isExplicitWeeklyRestShift(originalShift), true);
  assert.equal(isExplicitWeeklyRestShift(replacementShift), false);

  const before = await f.snapshot();

  const result = await f.create();

  assert.equal(result.idempotent, false);
  assert.equal(result.operation.status, 'active');

  const after = await f.snapshot();

  assert.equal(after.operations.length, 1);
  assert.equal(after.exceptions.length, 2);
  assert.equal(after.audit.length, 2);

  assert.deepEqual(after.schedules, before.schedules);
  assert.deepEqual(after.ledger, before.ledger);
  assert.deepEqual(after.payroll, before.payroll);

  const work = await f.shift(originalDate);
  const rest = await f.shift(replacementDate);

  assert.equal(work.source, 'exception');
  assert.equal(work.exception_type, 'custom');
  assert.equal(work.enabled, 1);
  assert.equal(work.start_time, payload.startTime);
  assert.equal(work.end_time, payload.endTime);

  assert.equal(isExplicitWeeklyRestShift(work), false);

  assert.equal(rest.source, 'exception');
  assert.equal(rest.exception_type, 'off');
  assert.equal(isExplicitWeeklyRestShift(rest), true);

  assert.equal(
    work.id,
    result.operation.work_exception_id
  );

  assert.equal(
    rest.id,
    result.operation.rest_exception_id
  );

  assert.deepEqual(
    JSON.parse(result.operation.original_rest_snapshot_json),
    originalShift
  );

  assert.deepEqual(
    JSON.parse(result.operation.replacement_work_snapshot_json),
    replacementShift
  );

  console.log('PASS: atomic work/rest swap');
  console.log('PASS: permanent schedule preserved');
  console.log('PASS: no additional entitlement credit');
  console.log('PASS: original schedule evidence preserved');
});

test('HR09E4 batch and individual shift resolution agree', async t => {
  const f = await fixture(t);

  await f.create();

  const result = await resolveEmployeeShiftsBatch(
    f.core,
    salonId,
    {
      employeeIds: [employeeId],
      dateFrom: originalDate,
      dateTo: replacementDate
    }
  );

  assert.equal(result.rows.length, 2);

  for (const row of result.rows) {
    const individual = await f.shift(row.date);

    assert.equal(row.id, individual.id);
    assert.equal(row.source, individual.source);
    assert.equal(row.exception_type, individual.exception_type);
    assert.equal(row.start_time, individual.start_time);
    assert.equal(row.end_time, individual.end_time);

    assert.equal(
      isExplicitWeeklyRestShift(row),
      isExplicitWeeklyRestShift(individual)
    );
  }

  console.log('PASS: shared single/batch schedule resolution');
});

test('HR09E4 exact replay cannot duplicate schedule changes', async t => {
  const f = await fixture(t);

  const first = await f.create();
  const before = await f.snapshot();

  const results = await Promise.all(
    Array.from(
      { length: 10 },
      () => f.create()
    )
  );

  for (const result of results) {
    assert.equal(result.idempotent, true);
    assert.deepEqual(result.operation, first.operation);
  }

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: ten idempotent replays');
});

test('HR09E4 rejects modified operation evidence', async t => {
  const f = await fixture(t);

  await f.create();

  const before = await f.snapshot();

  for (const overrides of [
    { reason: 'Changed reason' },
    { startTime: '13:00' },
    { endTime: '21:00' },
    { replacementRestDate: '2026-11-24' },
    { originalRestDate: '2026-11-29' }
  ]) {
    await assert.rejects(
      f.create(overrides),
      error =>
        error.status === 409 &&
        error.code ===
          'core_weekly_rest_rescheduling:operation_conflict'
    );
  }

  await assert.rejects(
    f.create({}, { uid: 'another-admin' }),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:operation_conflict'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E4 rejects a non-rest original date', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  await assert.rejects(
    f.create({
      originalRestDate: '2026-11-24'
    }),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:original_date_not_weekly_rest'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E4 rejects replacement dates that are already weekly rest', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  await assert.rejects(
    f.create({
      replacementRestDate: '2026-11-29'
    }),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:replacement_date_not_working_day'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E4 rejects existing operational schedule exceptions', async t => {
  const f = await fixture(t);

  await createScheduleException(
    f.core,
    salonId,
    {
      id: 'existing-custom-shift',
      employeeId,
      dateFrom: replacementDate,
      dateTo: replacementDate,
      exceptionType: 'custom',
      enabled: 1,
      startTime: '13:00',
      endTime: '21:00',
      status: 'approved',
      note: 'Existing approved shift'
    },
    actor
  );

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:schedule_exception_conflict'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E4 rejects an existing compensated assignment', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    INSERT INTO employee_weekly_rest_work_assignments (
      id, salon_id, employee_id,
      rest_date, start_time, end_time,
      reason, schedule_source_type,
      status, created_at, updated_at
    )
    VALUES (
      'existing-compensated-work',
      'main', 'test-employee',
      ?, '12:00', '20:00',
      'Existing compensated assignment',
      'weekly_schedule',
      'assigned', '2026-11-20', '2026-11-20'
    )
  `).bind(originalDate).run();

  const before = await f.snapshot();

  const assignments = await f.rows(
    'employee_weekly_rest_work_assignments'
  );

  await assert.rejects(
    f.create(),
    error => error.status === 409
  );

  assert.deepEqual(await f.snapshot(), before);

  assert.deepEqual(
    await f.rows('employee_weekly_rest_work_assignments'),
    assignments
  );
});

test('HR09E4 rejects overlapping approved leave', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    INSERT INTO employee_leaves (
      id, salon_id, employee_id,
      status, leave_type,
      start_date, end_date, days_count,
      created_at, updated_at
    )
    VALUES (
      'existing-leave',
      'main', 'test-employee',
      'approved', 'annual',
      ?, ?, 1,
      '2026-11-20', '2026-11-20'
    )
  `).bind(
    replacementDate,
    replacementDate
  ).run();

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:leave_conflict'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E4 rejects a locked payroll period', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    INSERT INTO hr_payroll_period_locks (
      id, salon_id,
      period_start, period_end,
      status, locked_at, created_at, updated_at
    )
    VALUES (
      'payroll-lock-1',
      'main',
      '2026-11-01', '2026-11-30',
      'locked',
      '2026-11-26', '2026-11-26', '2026-11-26'
    )
  `).run();

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:payroll_period_locked'
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: locked payroll preserved');
});

test('HR09E4 a failed second exception rolls back all changes', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  f.core.database.exec(`
    CREATE TRIGGER synthetic_fail_rest_exception
    BEFORE INSERT ON hr_schedule_exceptions
    WHEN NEW.exception_type = 'off'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic_rest_exception_failure');
    END;
  `);

  await assert.rejects(
    f.create(),
    /synthetic_rest_exception_failure/
  );

  assert.deepEqual(await f.snapshot(), before);

  f.core.database.exec(`
    DROP TRIGGER synthetic_fail_rest_exception;
  `);

  const retry = await f.create();

  assert.equal(retry.idempotent, false);

  assert.equal(
    (await f.rows('hr_schedule_exceptions')).length,
    2
  );

  assert.equal(
    (await f.rows('employee_weekly_rest_rescheduling')).length,
    1
  );

  console.log('PASS: atomic rollback');
  console.log('PASS: retry after rollback');
});

test('HR09E4 rejects a foreign tenant employee', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  await assert.rejects(
    createWeeklyRestRescheduling(
      f.core,
      'another-salon',
      payload,
      actor
    ),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:employee_not_active'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E4 refuses missing actor evidence', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  await assert.rejects(
    f.create({}, {}),
    error =>
      error.status === 403 &&
      error.code ===
        'core_weekly_rest_rescheduling:actor_required'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E5 rejects invalid calendar dates', async t => {
  const f = await fixture(t);
  const before = await f.snapshot();

  for (const overrides of [
    { originalRestDate: '2026-02-30' },
    { replacementRestDate: '2026-11-31' },
    { originalRestDate: '2026-13-01' }
  ]) {
    await assert.rejects(
      f.create(overrides),
      error =>
        error.status === 400 &&
        error.code ===
          'core_weekly_rest_rescheduling:invalid_calendar_date'
    );
  }

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E5 rejects compensated assignments after a successful rest swap', async t => {
  const f = await fixture(t);

  await f.create();

  const before = await f.snapshot();

  for (const date of [
    originalDate,
    replacementDate
  ]) {
    await assert.rejects(
      f.core.prepare(`
        INSERT INTO employee_weekly_rest_work_assignments (
          id, salon_id, employee_id,
          rest_date, start_time, end_time,
          reason, schedule_source_type,
          status, created_at, updated_at
        )
        VALUES (
          ?, 'main', 'test-employee',
          ?, '12:00', '20:00',
          'Synthetic conflicting assignment',
          'weekly_schedule',
          'assigned', '2026-11-20', '2026-11-20'
        )
      `).bind(
        `conflict-${date}`,
        date
      ).run(),
      /weekly_rest_rescheduling_assignment_conflict/
    );
  }

  assert.deepEqual(await f.snapshot(), before);

  assert.equal(
    (await f.rows('employee_weekly_rest_work_assignments')).length,
    0
  );

  console.log('PASS: mutually exclusive ownership of work/rest dates');
});

test('HR09E5 concurrent conflicting swaps produce only one winner', async t => {
  const f = await fixture(t);

  const results = await Promise.allSettled(
    Array.from(
      { length: 10 },
      (_, index) => f.create({
        id: `competing-swap-${index}`,
        reason: `Competing operation ${index}`
      })
    )
  );

  const successful = results.filter(
    result => result.status === 'fulfilled'
  );

  assert.equal(successful.length, 1);

  for (const result of results) {
    if (result.status === 'rejected') {
      assert.equal(result.reason.status, 409);
    }
  }

  assert.equal(
    (await f.rows('employee_weekly_rest_rescheduling')).length,
    1
  );

  assert.equal(
    (await f.rows('hr_schedule_exceptions')).length,
    2
  );

  assert.equal(
    (await f.rows('hr_shift_audit_log')).length,
    2
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: one swap, two exceptions, zero duplicate entitlements');
});

test('HR09E5 database guard rejects a payroll lock introduced immediately before commit', async t => {
  const f = await fixture(t);

  const originalBatch = f.core.batch.bind(f.core);

  let injected = false;

  f.core.batch = async statements => {
    if (!injected) {
      injected = true;

      await f.core.prepare(`
        INSERT INTO hr_payroll_period_locks (
          id, salon_id,
          period_start, period_end,
          status, locked_at,
          created_at, updated_at
        )
        VALUES (
          'concurrent-lock',
          'main',
          '2026-11-01', '2026-11-30',
          'locked', '2026-11-26',
          '2026-11-26', '2026-11-26'
        )
      `).run();
    }

    return originalBatch(statements);
  };

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:payroll_period_locked'
  );

  assert.equal(injected, true);

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: payroll lock race rejected before mutation');
});

test('HR09E6 refuses rescheduling when external attendance is unavailable', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  await assert.rejects(
    createWeeklyRestRescheduling(
      f.core,
      salonId,
      payload,
      actor,
      null
    ),
    error =>
      error.status === 503 &&
      error.code ===
        'core_weekly_rest_rescheduling:attendance_unavailable'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E6 rejects an external attendance database read failure', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  const unavailable = {
    prepare() {
      throw new Error('Synthetic attendance outage');
    }
  };

  await assert.rejects(
    createWeeklyRestRescheduling(
      f.core,
      salonId,
      payload,
      actor,
      unavailable
    ),
    error =>
      error.status === 503 &&
      error.code ===
        'core_weekly_rest_rescheduling:attendance_unavailable'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E6 replacement rest cannot contain Core attendance', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    INSERT INTO attendance_records (
      id, salon_id, employee_id,
      employee_uid, date_key, record_type,
      recorded_at, created_at
    )
    VALUES (
      'replacement-core-punch',
      'main', 'test-employee',
      'test-uid', ?, 'check_in',
      '2026-11-23T09:00:00Z',
      '2026-11-23T09:00:00Z'
    )
  `).bind(replacementDate).run();

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:replacement_date_has_attendance'
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: Core attendance preserved');
});

test('HR09E6 replacement rest cannot contain external attendance', async t => {
  const f = await fixture(t);

  await f.attendance.prepare(`
    INSERT INTO attendance_records (
      id, employee_uid, employee_doc_id,
      type, server_time, work_date,
      location_lat, location_lng,
      location_accuracy, result,
      accuracy_accepted, created_by_uid,
      created_by_role, created_at, updated_at
    )
    VALUES (
      'replacement-external-punch',
      'test-uid', 'test-employee',
      'check_in', '2026-11-23T09:00:00Z', ?,
      0, 0, 10, 'allowed',
      1, 'test-uid', 'employee',
      '2026-11-23T09:00:00Z',
      '2026-11-23T09:00:00Z'
    )
  `).bind(replacementDate).run();

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:replacement_date_has_attendance'
  );

  assert.deepEqual(await f.snapshot(), before);

  const punch = await f.attendance.prepare(`
    SELECT *
      FROM attendance_records
     WHERE id = 'replacement-external-punch'
  `).first();

  assert.ok(punch);

  console.log('PASS: external attendance preserved');
});

test('HR09E6 original rest attendance remains intact during conversion', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    INSERT INTO attendance_records (
      id, salon_id, employee_id,
      employee_uid, date_key, record_type,
      recorded_at, created_at
    )
    VALUES (
      'original-rest-punch',
      'main', 'test-employee',
      'test-uid', ?, 'check_in',
      '2026-11-22T09:00:00Z',
      '2026-11-22T09:00:00Z'
    )
  `).bind(originalDate).run();

  const before = await f.core.prepare(`
    SELECT *
      FROM attendance_records
     WHERE id = 'original-rest-punch'
  `).first();

  await f.create();

  const after = await f.core.prepare(`
    SELECT *
      FROM attendance_records
     WHERE id = 'original-rest-punch'
  `).first();

  assert.deepEqual(after, before);

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: original attendance unchanged');
});

test('HR09E6 linked exceptions cannot be independently altered', async t => {
  const f = await fixture(t);

  const result = await f.create();

  const before = await f.snapshot();

  for (const id of [
    result.operation.work_exception_id,
    result.operation.rest_exception_id
  ]) {
    await assert.rejects(
      f.core.prepare(`
        UPDATE hr_schedule_exceptions
           SET status = 'cancelled'
         WHERE id = ?
      `).bind(id).run(),
      /weekly_rest_rescheduling_exception_protected/
    );

    await assert.rejects(
      f.core.prepare(`
        UPDATE hr_schedule_exceptions
           SET note = 'Changed classification'
         WHERE id = ?
      `).bind(id).run(),
      /weekly_rest_rescheduling_exception_protected/
    );

    await assert.rejects(
      f.core.prepare(`
        DELETE FROM hr_schedule_exceptions
         WHERE id = ?
      `).bind(id).run(),
      /weekly_rest_rescheduling_exception_protected/
    );
  }

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: linked exception ownership preserved');
});

test('HR09E6 competing exceptions cannot override protected dates', async t => {
  const f = await fixture(t);

  await f.create();

  const before = await f.snapshot();

  for (const date of [originalDate, replacementDate]) {
    await assert.rejects(
      f.core.prepare(`
        INSERT INTO hr_schedule_exceptions (
          id, salon_id, employee_id,
          date_from, date_to, exception_type,
          enabled, status,
          created_at, updated_at
        )
        VALUES (
          ?, 'main', 'test-employee',
          ?, ?, 'off',
          0, 'approved',
          '2026-11-26', '2026-11-26'
        )
      `).bind(
        `competing-exception-${date}`,
        date,
        date
      ).run(),
      /weekly_rest_rescheduling_exception_protected/
    );
  }

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: competing exceptions rejected');
});

test('HR09E6 Core attendance introduced before commit aborts the swap', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  const originalBatch = f.core.batch.bind(f.core);

  let injected = false;

  f.core.batch = async statements => {
    if (!injected) {
      injected = true;

      await f.core.prepare(`
        INSERT INTO attendance_records (
          id, salon_id, employee_id,
          employee_uid, date_key, record_type,
          recorded_at, created_at
        )
        VALUES (
          'concurrent-replacement-punch',
          'main', 'test-employee',
          'test-uid', ?, 'check_in',
          '2026-11-23T09:00:00Z',
          '2026-11-23T09:00:00Z'
        )
      `).bind(replacementDate).run();
    }

    return originalBatch(statements);
  };

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:replacement_date_has_attendance'
  );

  assert.equal(injected, true);

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: Core attendance commit race rejected');
});

test('HR09E7 rejects replacement rest in a different schedule week', async t => {
  const f = await fixture(t);
  const before = await f.snapshot();

  await assert.rejects(
    f.create({
      replacementRestDate: '2026-11-30'
    }),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:replacement_rest_outside_schedule_week'
  );

  assert.deepEqual(await f.snapshot(), before);
});

test('HR09E7 ordinary work/rest swap provides a sufficient scheduled rest window', async t => {
  const f = await fixture(t);

  const result = await f.create();

  assert.equal(result.operation.status, 'active');

  const work = await f.shift(originalDate);
  const rest = await f.shift(replacementDate);

  assert.equal(work.start_time, '12:00');
  assert.equal(work.end_time, '20:00');
  assert.equal(isExplicitWeeklyRestShift(rest), true);

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );
});

test('HR09E7 overnight work cannot reduce the replacement rest below 24 hours', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    UPDATE hr_work_schedules
       SET start_time = '23:00',
           end_time = '08:00'
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND weekday = 1
  `).run();

  await f.core.prepare(`
    UPDATE hr_work_schedules
       SET start_time = '04:00',
           end_time = '12:00'
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND weekday = 3
  `).run();

  const before = await f.snapshot();

  await assert.rejects(
    f.create({
      replacementRestDate: '2026-11-24'
    }),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:replacement_rest_window_insufficient'
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: overnight rest window protected');
});

test('HR09E7 adjacent overnight shift is allowed when sufficient rest remains', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    UPDATE hr_work_schedules
       SET start_time = '23:00',
           end_time = '04:00'
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND weekday = 1
  `).run();

  await f.core.prepare(`
    UPDATE hr_work_schedules
       SET start_time = '12:00',
           end_time = '20:00'
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND weekday = 3
  `).run();

  const result = await f.create({
    replacementRestDate: '2026-11-24'
  });

  assert.equal(result.operation.status, 'active');

  console.log('PASS: valid overnight schedule preserved');
});

test('HR09E7 rejects an unknown adjacent schedule', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    DELETE FROM hr_work_schedules
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND weekday = 2
  `).run();

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:rest_window_schedule_unknown'
  );

  assert.deepEqual(await f.snapshot(), before);
});

async function restSwapPayrollJobs(core) {
  return (
    await core.prepare(`
      SELECT *
        FROM hr_payroll_operations
       WHERE salon_id = 'main'
         AND json_extract(
           response_json,
           '$.sourceType'
         ) = 'weekly_rest_rescheduling'
       ORDER BY work_date, id
    `).all()
  ).results;
}

test('HR09E8 persists two financial operations for a successful rest swap', async t => {
  const f = await fixture(t);

  const result = await f.create();

  const jobs = await restSwapPayrollJobs(f.core);

  assert.equal(jobs.length, 2);

  assert.deepEqual(
    jobs.map(job => job.work_date),
    [originalDate, replacementDate]
  );

  for (const job of jobs) {
    assert.equal(job.salon_id, salonId);
    assert.equal(job.employee_id, employeeId);
    assert.equal(job.employee_uid, 'test-uid');
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 0);
    assert.equal(job.snapshot_matches, 1);

    assert.equal(
      JSON.parse(job.actor_json).uid,
      actor.uid
    );

    const response = JSON.parse(job.response_json);

    assert.equal(
      response.sourceId,
      result.operation.id
    );

    assert.equal(
      response.date,
      job.work_date
    );

    assert.equal(
      response.action,
      'create'
    );

    assert.ok(JSON.parse(job.before_records));
    assert.ok(JSON.parse(job.after_records));
  }

  assert.equal(
    JSON.parse(jobs[0].response_json).classification,
    'work'
  );

  assert.equal(
    JSON.parse(jobs[1].response_json).classification,
    'weekly_rest'
  );

  console.log('PASS: two durable financial operations');
  console.log('PASS: employee and actor evidence preserved');
});

test('HR09E8 exact replay never duplicates financial operations', async t => {
  const f = await fixture(t);

  await f.create();

  const before = await restSwapPayrollJobs(f.core);

  await Promise.all(
    Array.from({ length: 10 }, () => f.create())
  );

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    before
  );

  assert.equal(before.length, 2);

  console.log('PASS: financial outbox replay idempotent');
});

test('HR09E8 financial outbox failure rolls back the entire swap', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  f.core.database.exec(`
    CREATE TRIGGER synthetic_rest_swap_outbox_failure
    BEFORE INSERT ON hr_payroll_operations
    WHEN json_extract(
      NEW.response_json,
      '$.sourceType'
    ) = 'weekly_rest_rescheduling'
    AND json_extract(
      NEW.response_json,
      '$.classification'
    ) = 'weekly_rest'
    BEGIN
      SELECT RAISE(
        ABORT,
        'synthetic_rest_swap_financial_failure'
      );
    END;
  `);

  await assert.rejects(
    f.create(),
    /synthetic_rest_swap_financial_failure/
  );

  assert.deepEqual(
    await f.snapshot(),
    before
  );

  assert.equal(
    (await restSwapPayrollJobs(f.core)).length,
    0
  );

  f.core.database.exec(`
    DROP TRIGGER synthetic_rest_swap_outbox_failure;
  `);

  await f.create();

  assert.equal(
    (await restSwapPayrollJobs(f.core)).length,
    2
  );

  console.log('PASS: financial failure atomic rollback');
  console.log('PASS: successful retry after rollback');
});

test('HR09E8 schedule exception failure cannot leave orphan financial operations', async t => {
  const f = await fixture(t);

  const before = await f.snapshot();

  f.core.database.exec(`
    CREATE TRIGGER synthetic_rest_swap_exception_failure
    BEFORE INSERT ON hr_schedule_exceptions
    WHEN NEW.exception_type = 'off'
    BEGIN
      SELECT RAISE(
        ABORT,
        'synthetic_rest_swap_exception_failure'
      );
    END;
  `);

  await assert.rejects(
    f.create(),
    /synthetic_rest_swap_exception_failure/
  );

  assert.deepEqual(
    await f.snapshot(),
    before
  );

  assert.equal(
    (await restSwapPayrollJobs(f.core)).length,
    0
  );

  console.log('PASS: no orphan financial operations');
});

test('HR09E8 financial operations retain immutable audit history', async t => {
  const f = await fixture(t);

  await f.create();

  const jobs = await restSwapPayrollJobs(f.core);

  assert.equal(jobs.length, 2);

  for (const job of jobs) {
    const events = (
      await f.core.prepare(`
        SELECT *
          FROM hr_payroll_operation_events
         WHERE operation_id = ?
         ORDER BY sequence
      `).bind(job.id).all()
    ).results;

    assert.equal(events.length, 1);
    assert.equal(events[0].status, 'pending');

    await assert.rejects(
      f.core.prepare(`
        UPDATE hr_payroll_operations
           SET employee_id = 'another-employee'
         WHERE id = ?
      `).bind(job.id).run(),
      /hr_payroll_operation_audit_immutable/
    );

    await assert.rejects(
      f.core.prepare(`
        DELETE FROM hr_payroll_operations
         WHERE id = ?
      `).bind(job.id).run(),
      /hr_payroll_operation_audit_immutable/
    );
  }

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    jobs
  );

  console.log('PASS: immutable financial history');
});

test('HR09E82 durable reconciliation processes both rest swap dates', async t => {
  const f = await fixture(t);

  const {
    recoverHrPayrollOperations
  } = await import(
    './core/repositories/hr-payroll-operations.js'
  );

  await f.create();

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  const jobs = await restSwapPayrollJobs(f.core);

  assert.equal(jobs.length, 2);

  for (const job of jobs) {
    assert.equal(
      job.status,
      'completed',
      job.last_error || 'Expected completed reconciliation'
    );

    const result = JSON.parse(
      job.reconciliation_json
    );

    assert.equal(
      result.reconciliationMode,
      'canonical_draft_refresh'
    );

    assert.equal(result.operationStatus, 'active');
    assert.equal(result.employeeId, employeeId);
    assert.equal(result.correctionDate, job.work_date);

    assert.deepEqual(
      result.payrollPreviews,
      []
    );

    assert.equal(
      result.draftRefreshRequired,
      false
    );
  }

  const before = await restSwapPayrollJobs(f.core);

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    before
  );

  console.log('PASS: both financial operations recovered');
  console.log('PASS: completed recovery does not repeat');
});

test('HR09E82 missing attendance preserves recoverable finance', async t => {
  const f = await fixture(t);

  const {
    recoverHrPayrollOperations
  } = await import(
    './core/repositories/hr-payroll-operations.js'
  );

  await f.create();

  await recoverHrPayrollOperations(
    f.core,
    {}
  );

  let jobs = await restSwapPayrollJobs(f.core);

  assert.equal(jobs.length, 2);

  for (const job of jobs) {
    assert.equal(job.status, 'pending');

    assert.match(
      job.last_error,
      /weekly_rest_rescheduling_attendance_unavailable/
    );
  }

  await f.core.prepare(`
    UPDATE hr_payroll_operations
       SET next_attempt_at = '1970-01-01T00:00:00.000Z'
     WHERE json_extract(
         response_json,
         '$.sourceType'
     ) = 'weekly_rest_rescheduling'
  `).run();

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  jobs = await restSwapPayrollJobs(f.core);

  for (const job of jobs) {
    assert.equal(
      job.status,
      'completed',
      job.last_error || ''
    );
  }

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: missing attendance fails closed');
  console.log('PASS: deferred finance recovers safely');
});

test('HR09E82 pending rest swap blocks locked payroll insertion', async t => {
  const f = await fixture(t);

  await f.create();

  await assert.rejects(
    f.core.prepare(`
      INSERT INTO payroll_entries (
        id, salon_id, employee_id,
        payroll_month, status,
        created_at, updated_at
      )
      VALUES (
        'blocked-payroll',
        'main',
        'test-employee',
        '2026-11',
        'approved',
        '2026-11-26',
        '2026-11-26'
      )
    `).run(),
    /weekly_rest_rescheduling_payroll_pending/
  );

  assert.equal(
    (await f.rows('payroll_entries')).length,
    0
  );

  console.log('PASS: pending finance blocks payroll locking');
});

test('HR09E82 pending finance blocks existing draft approval', async t => {
  const f = await fixture(t);

  await f.core.prepare(`
    INSERT INTO payroll_entries (
      id, salon_id, employee_id,
      payroll_month, status,
      created_at, updated_at
    )
    VALUES (
      'existing-draft',
      'main',
      'test-employee',
      '2026-11',
      'draft',
      '2026-11-26',
      '2026-11-26'
    )
  `).run();

  await f.create();

  const before = await f.rows('payroll_entries');

  await assert.rejects(
    f.core.prepare(`
      UPDATE payroll_entries
         SET status = 'approved'
       WHERE id = 'existing-draft'
    `).run(),
    /weekly_rest_rescheduling_payroll_pending/
  );

  assert.deepEqual(
    await f.rows('payroll_entries'),
    before
  );

  console.log('PASS: stale draft cannot be approved while finance is pending');
});

async function hr09e83Preview(f) {
  const { previewPayrollEntry } = await import(
    './core/repositories/payroll.js'
  );

  return previewPayrollEntry(
    f.core,
    salonId,
    {
      employeeId,
      payrollMonth: '2026-11',
      status: 'draft',
      additions: [],
      deductions: []
    },
    actor,
    { externalAttendanceDb: f.attendance }
  );
}

async function hr09e83Absence(f, id, source) {
  await f.core.prepare(`
    INSERT INTO employee_absences (
      id, salon_id, employee_id, employee_uid,
      date_key, absence_type,
      note, created_by_uid,
      created_at, updated_at
    )
    VALUES (
      ?, 'main', 'test-employee', 'test-uid',
      ?, ?,
      'Synthetic financial projection',
      'test-admin',
      '2026-11-23T12:00:00Z',
      '2026-11-23T12:00:00Z'
    )
  `).bind(
    id,
    replacementDate,
    source
  ).run();
}

test('HR09E83 automatic absence on replacement rest does not reduce salary', async t => {
  const f = await fixture(t);

  await f.create();

  const baseline = await hr09e83Preview(f);

  await hr09e83Absence(
    f,
    'replacement-auto-absence',
    'automatic_check_in_lock'
  );

  const before = await f.rows('employee_absences');

  assert.equal(before.length, 1);
  assert.equal(before[0].date_key, replacementDate);

  assert.ok([
    'automatic_check_in_lock',
    'full_day'
  ].includes(before[0].absence_type));

  const after = await hr09e83Preview(f);

  assert.equal(
    after.absence_deduction_halalas,
    baseline.absence_deduction_halalas
  );

  assert.equal(
    after.net_salary_halalas,
    baseline.net_salary_halalas
  );

  assert.equal(
    after.absence_days,
    baseline.absence_days
  );

  assert.deepEqual(
    await f.rows('employee_absences'),
    before
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  assert.equal(before[0].absence_type, 'automatic_check_in_lock');

  console.log(
    'PASS: automatic absence excluded without deleting evidence'
  );

  console.log(
    'HR09E83_AUTOMATIC_ABSENCE_FINANCE:',
    JSON.stringify({
      baselineNet: baseline.net_salary_halalas,
      resultingNet: after.net_salary_halalas,
      baselineDeduction: baseline.absence_deduction_halalas,
      resultingDeduction: after.absence_deduction_halalas
    })
  );
});

test('HR09E83 manual absence remains financially authoritative', async t => {
  const f = await fixture(t);

  await f.create();

  const baseline = await hr09e83Preview(f);

  await hr09e83Absence(
    f,
    'replacement-manual-absence',
    'full_day'
  );

  const before = await f.rows('employee_absences');

  assert.equal(before.length, 1);
  assert.equal(before[0].date_key, replacementDate);

  assert.ok([
    'automatic_check_in_lock',
    'full_day'
  ].includes(before[0].absence_type));

  const after = await hr09e83Preview(f);

  assert.equal(
    after.absence_days,
    baseline.absence_days + 1
  );

  assert.equal(before[0].absence_type, 'full_day');

  assert.ok(
    after.absence_deduction_halalas >
    baseline.absence_deduction_halalas
  );

  assert.deepEqual(
    await f.rows('employee_absences'),
    before
  );

  console.log(
    'PASS: manual absence retained'
  );

  console.log(
    'HR09E83_MANUAL_ABSENCE_FINANCE:',
    JSON.stringify({
      baselineDeduction: baseline.absence_deduction_halalas,
      resultingDeduction: after.absence_deduction_halalas,
      difference:
        after.absence_deduction_halalas -
        baseline.absence_deduction_halalas
    })
  );
});

test('HR09E83 payroll preview does not create a payroll entry or entitlement', async t => {
  const f = await fixture(t);

  await f.create();

  const before = {
    payroll: await f.rows('payroll_entries'),
    ledger: await f.rows('employee_comp_time_ledger'),
    absences: await f.rows('employee_absences')
  };

  await hr09e83Preview(f);
  await hr09e83Preview(f);

  assert.deepEqual(
    await f.rows('payroll_entries'),
    before.payroll
  );

  assert.deepEqual(
    await f.rows('employee_comp_time_ledger'),
    before.ledger
  );

  assert.deepEqual(
    await f.rows('employee_absences'),
    before.absences
  );

  console.log('PASS: financial preview preserves source records');
});

test('HR09E83A1 automatic absence remains effective on an ordinary working date', async t => {
  const f = await fixture(t);

  await f.create();

  const baseline = await hr09e83Preview(f);

  await f.core.prepare(`
    INSERT INTO employee_absences (
      id, salon_id, employee_id, employee_uid,
      date_key, absence_type, note,
      created_by_uid, created_at, updated_at
    )
    VALUES (
      'ordinary-work-automatic-absence',
      'main', 'test-employee', 'test-uid',
      ?, 'automatic_check_in_lock',
      'Synthetic ordinary working date',
      'system', '2026-11-22T12:00:00Z',
      '2026-11-22T12:00:00Z'
    )
  `).bind(originalDate).run();

  const rows = await f.rows('employee_absences');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date_key, originalDate);
  assert.equal(
    rows[0].absence_type,
    'automatic_check_in_lock'
  );

  const after = await hr09e83Preview(f);

  // The ordinary working date may already carry an inferred
  // absence. Persisting its evidence must not charge it twice.
  assert.equal(
    after.absence_deduction_halalas,
    baseline.absence_deduction_halalas
  );

  assert.equal(
    after.absence_days,
    baseline.absence_days
  );

  assert.deepEqual(
    await f.rows('employee_absences'),
    rows
  );

  console.log(
    'PASS: ordinary work absence preserved without duplicate charge'
  );
});

async function hr09e83bCreateDraft(f) {
  const { upsertPayrollEntry } = await import(
    './core/repositories/payroll.js'
  );

  return upsertPayrollEntry(
    f.core,
    salonId,
    {
      employeeId,
      payrollMonth: '2026-11',
      status: 'draft',
      additions: [],
      deductions: [],
      notes: 'Synthetic preserved payroll note'
    },
    actor,
    { externalAttendanceDb: f.attendance }
  );
}

async function hr09e83bPunchOriginalRest(f) {
  for (const [type, timestamp] of [
    ['check_in', '2026-11-22T09:00:00Z'],
    ['check_out', '2026-11-22T17:00:00Z']
  ]) {
    await f.core.prepare(`
      INSERT INTO attendance_records (
        id, salon_id, employee_id,
        employee_uid, date_key, record_type,
        recorded_at, created_at
      )
      VALUES (
        ?, 'main', 'test-employee',
        'test-uid', ?, ?, ?, ?
      )
    `).bind(
      `rest-swap-payroll-${type}`,
      originalDate,
      type,
      timestamp,
      timestamp
    ).run();
  }
}

test('HR09E83B rest swap recovery refreshes an existing saved payroll draft', async t => {
  const f = await fixture(t);

  const {
    recoverHrPayrollOperations
  } = await import(
    './core/repositories/hr-payroll-operations.js'
  );

  await hr09e83bPunchOriginalRest(f);

  const before = await hr09e83bCreateDraft(f);

  await f.create();

  const expected = await hr09e83Preview(f);

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  const jobs = await restSwapPayrollJobs(f.core);

  for (const job of jobs) {
    assert.equal(
      job.status,
      'completed',
      job.last_error || ''
    );
  }

  const rows = await f.rows('payroll_entries');

  assert.equal(rows.length, 1);

  const saved = rows[0];

  assert.equal(saved.id, before.id);
  assert.equal(saved.status, 'draft');

  assert.equal(
    saved.net_salary_halalas,
    expected.net_salary_halalas
  );

  assert.equal(
    saved.absence_deduction_halalas,
    expected.absence_deduction_halalas
  );

  assert.equal(
    saved.net_salary_halalas -
      before.net_salary_halalas,
    10000
  );

  for (const column of [
    'additions_json',
    'deductions_json',
    'advances_halalas',
    'manual_additions_halalas',
    'manual_deductions_halalas',
    'created_at',
    'created_by_uid',
    'notes'
  ]) {
    assert.equal(saved[column], before[column]);
  }

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log(
    'HR09E83B_SAVED_PAYROLL:',
    JSON.stringify({
      previousNet: before.net_salary_halalas,
      resultingNet: saved.net_salary_halalas,
      difference:
        saved.net_salary_halalas -
        before.net_salary_halalas
    })
  );

  const finalRows = await f.rows('payroll_entries');

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  assert.deepEqual(
    await f.rows('payroll_entries'),
    finalRows
  );

  console.log('PASS: saved draft refreshed without duplicate writes');
});

test('HR09E83B recovery never creates a missing payroll draft', async t => {
  const f = await fixture(t);

  const {
    recoverHrPayrollOperations
  } = await import(
    './core/repositories/hr-payroll-operations.js'
  );

  await f.create();

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  assert.equal(
    (await f.rows('payroll_entries')).length,
    0
  );

  const jobs = await restSwapPayrollJobs(f.core);

  assert.ok(
    jobs.every(job => job.status === 'completed')
  );
});

test('HR09E83B stale draft evidence cannot overwrite a concurrent administrator edit', async t => {
  const f = await fixture(t);

  const {
    refreshPayrollDraftForRestRescheduling
  } = await import(
    './core/repositories/payroll.js'
  );

  await hr09e83bPunchOriginalRest(f);

  const stale = await hr09e83bCreateDraft(f);

  await f.create();

  await f.core.prepare(`
    UPDATE payroll_entries
       SET notes = 'Concurrent administrator edit'
     WHERE id = ?
  `).bind(stale.id).run();

  const before = await f.rows('payroll_entries');

  await assert.rejects(
    refreshPayrollDraftForRestRescheduling(
      f.core,
      salonId,
      stale,
      actor,
      { externalAttendanceDb: f.attendance }
    ),
    error => error.status === 409
  );

  assert.deepEqual(
    await f.rows('payroll_entries'),
    before
  );

  console.log('PASS: concurrent administrator edit preserved');
});

test('HR09E83B independent financial adjustments remain protected', async t => {
  const f = await fixture(t);

  const {
    refreshPayrollDraftForRestRescheduling
  } = await import(
    './core/repositories/payroll.js'
  );

  await hr09e83bPunchOriginalRest(f);

  const draft = await hr09e83bCreateDraft(f);

  await f.create();

  await f.core.prepare(`
    UPDATE payroll_entries
       SET manual_additions_halalas = 5000
     WHERE id = ?
  `).bind(draft.id).run();

  const before = await f.rows('payroll_entries');

  await assert.rejects(
    refreshPayrollDraftForRestRescheduling(
      f.core,
      salonId,
      before[0],
      actor,
      { externalAttendanceDb: f.attendance }
    ),
    error =>
      error.status === 409 &&
      error.code ===
        'core_payroll:rest_rescheduling_adjustment_conflict'
  );

  assert.deepEqual(
    await f.rows('payroll_entries'),
    before
  );

  console.log('PASS: independent financial adjustments protected');
});

test('HR09E83B1 direct draft refresh persists canonical financial values', async t => {
  const f = await fixture(t);

  const {
    refreshPayrollDraftForRestRescheduling
  } = await import(
    './core/repositories/payroll.js'
  );

  await hr09e83bPunchOriginalRest(f);

  const before = await hr09e83bCreateDraft(f);

  await f.create();

  const expected = await hr09e83Preview(f);

  const refreshed =
    await refreshPayrollDraftForRestRescheduling(
      f.core,
      salonId,
      before,
      actor,
      { externalAttendanceDb: f.attendance }
    );

  assert.equal(refreshed.changed, true);

  assert.equal(
    refreshed.entry.net_salary_halalas,
    expected.net_salary_halalas
  );

  assert.equal(
    refreshed.entry.id,
    before.id
  );

  assert.equal(
    refreshed.entry.status,
    'draft'
  );

  const saved = (
    await f.rows('payroll_entries')
  )[0];

  assert.deepEqual(
    saved,
    refreshed.entry
  );

  console.log(
    'HR09E83B1_DIRECT_WRITE:',
    JSON.stringify({
      previousNet: before.net_salary_halalas,
      expectedNet: expected.net_salary_halalas,
      savedNet: saved.net_salary_halalas
    })
  );

  console.log(
    'PASS: direct canonical draft mutation verified'
  );
});

test('HR09E83B1 identical current snapshot never rewrites draft audit', async t => {
  const f = await fixture(t);

  const {
    refreshPayrollDraftForRestRescheduling
  } = await import(
    './core/repositories/payroll.js'
  );

  await hr09e83bPunchOriginalRest(f);

  const initial = await hr09e83bCreateDraft(f);

  await f.create();

  const first =
    await refreshPayrollDraftForRestRescheduling(
      f.core,
      salonId,
      initial,
      actor,
      { externalAttendanceDb: f.attendance }
    );

  const before = await f.rows('payroll_entries');

  const second =
    await refreshPayrollDraftForRestRescheduling(
      f.core,
      salonId,
      first.entry,
      actor,
      { externalAttendanceDb: f.attendance }
    );

  assert.equal(second.changed, false);

  assert.deepEqual(
    await f.rows('payroll_entries'),
    before
  );

  console.log('PASS: identical snapshot does not rewrite audit');
});

async function hr09f1CancelRegistry(f, operationId) {
  return f.core.prepare(`
    UPDATE employee_weekly_rest_rescheduling
       SET status = 'cancelled',
           cancelled_by_uid = 'test-admin',
           cancelled_at = '2026-11-26T15:00:00.000Z',
           cancellation_reason = 'Synthetic restoration',
           updated_at = '2026-11-26T15:00:00.000Z'
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND id = ?
       AND status = 'active'
  `).bind(operationId).run();
}

test('HR09F1 cancellation cannot bypass pending creation finance', async t => {
  const f = await fixture(t);

  const result = await f.create();

  const before = await f.snapshot();
  const jobsBefore = await restSwapPayrollJobs(f.core);

  await assert.rejects(
    hr09f1CancelRegistry(f, result.operation.id),
    /weekly_rest_rescheduling_finance_pending/
  );

  assert.deepEqual(
    await f.snapshot(),
    before
  );

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    jobsBefore
  );

  console.log('PASS: pending creation finance protects cancellation');
});

test('HR09F1 cancellation cannot modify a locked payroll period', async t => {
  const f = await fixture(t);

  const {
    recoverHrPayrollOperations
  } = await import(
    './core/repositories/hr-payroll-operations.js'
  );

  const result = await f.create();

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  const jobs = await restSwapPayrollJobs(f.core);

  assert.ok(
    jobs.every(job => job.status === 'completed')
  );

  // Exercise the canonical payroll lock table instead of forging
  // an approved payroll row without its required policy snapshot.
  const columns = f.core.database.prepare(
    'PRAGMA table_info(hr_payroll_period_locks)'
  ).all();

  const available = new Set(
    columns.map(row => row.name)
  );

  const values = {
    id: 'restoration-period-lock',
    salon_id: salonId,
    period_start: '2026-11-01',
    period_end: '2026-11-30',
    status: 'locked',
    payroll_month: '2026-11',
    reason: 'Synthetic restoration lock',
    locked_by_uid: actor.uid,
    created_by_uid: actor.uid,
    updated_by_uid: actor.uid,
    locked_at: '2026-11-26T15:00:00Z',
    created_at: '2026-11-26T15:00:00Z',
    updated_at: '2026-11-26T15:00:00Z'
  };

  const fields = Object.keys(values).filter(
    key => available.has(key)
  );

  await f.core.prepare(`
    INSERT INTO hr_payroll_period_locks (
      ${fields.join(', ')}
    ) VALUES (
      ${fields.map(() => '?').join(', ')}
    )
  `).bind(
    ...fields.map(key => values[key])
  ).run();

  const before = await f.snapshot();
  const payrollBefore = await f.rows('payroll_entries');

  await assert.rejects(
    hr09f1CancelRegistry(f, result.operation.id),
    /weekly_rest_rescheduling_payroll_locked/
  );

  assert.deepEqual(
    await f.snapshot(),
    before
  );

  assert.deepEqual(
    await f.rows('payroll_entries'),
    payrollBefore
  );

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    jobs
  );

  console.log('PASS: restoration cannot change locked payroll');
});

async function hr09f2Restore(f, id, overrides = {}) {
  const {
    cancelWeeklyRestRescheduling
  } = await import(
    './core/repositories/weekly-rest-rescheduling.js'
  );

  return cancelWeeklyRestRescheduling(
    f.core,
    salonId,
    id,
    {
      employeeId,
      reason: 'Synthetic restoration',
      ...overrides
    },
    actor,
    f.attendance
  );
}

async function hr09f2Recover(f) {
  const {
    recoverHrPayrollOperations
  } = await import(
    './core/repositories/hr-payroll-operations.js'
  );

  await recoverHrPayrollOperations(
    f.core,
    { externalAttendanceDb: f.attendance }
  );

  const jobs = await restSwapPayrollJobs(f.core);

  assert.ok(jobs.length >= 2);

  for (const job of jobs) {
    assert.equal(
      job.status,
      'completed',
      job.last_error || ''
    );
  }
}

test('HR09F2 restores both dates and retains all operation history', async t => {
  const f = await fixture(t);

  const originalBefore = await f.shift(originalDate);
  const replacementBefore = await f.shift(replacementDate);

  await hr09e83bPunchOriginalRest(f);

  const punchesBefore = (
    await f.core.prepare(`
      SELECT * FROM attendance_records ORDER BY id
    `).all()
  ).results;

  const created = await f.create();

  await hr09f2Recover(f);

  const restored = await hr09f2Restore(
    f,
    created.operation.id
  );

  assert.equal(restored.operation.status, 'cancelled');
  assert.equal(restored.idempotent, false);
  assert.equal(restored.operation.cancelled_by_uid, actor.uid);

  assert.deepEqual(
    await f.shift(originalDate),
    originalBefore
  );

  assert.deepEqual(
    await f.shift(replacementDate),
    replacementBefore
  );

  const exceptions = await f.rows('hr_schedule_exceptions');

  assert.equal(exceptions.length, 2);

  for (const exception of exceptions) {
    assert.equal(exception.status, 'cancelled');
    assert.equal(exception.enabled, 0);
  }

  assert.deepEqual(
    (
      await f.core.prepare(`
        SELECT * FROM attendance_records ORDER BY id
      `).all()
    ).results,
    punchesBefore
  );

  const jobs = await restSwapPayrollJobs(f.core);

  assert.equal(jobs.length, 4);

  assert.equal(
    jobs.filter(
      row => JSON.parse(row.response_json).action === 'cancel'
    ).length,
    2
  );

  const audit = await f.rows('hr_shift_audit_log');

  assert.equal(audit.length, 4);

  console.log('PASS: atomic restoration of both dates');
  console.log('PASS: punches and historical exceptions preserved');
  console.log('PASS: two independent cancellation finance jobs');
});

test('HR09F2 restoration reverses the saved payroll projection', async t => {
  const f = await fixture(t);

  await hr09e83bPunchOriginalRest(f);

  const initial = await hr09e83bCreateDraft(f);

  const created = await f.create();

  await hr09f2Recover(f);

  const converted = (
    await f.rows('payroll_entries')
  )[0];

  assert.equal(
    converted.net_salary_halalas -
    initial.net_salary_halalas,
    10000
  );

  await hr09f2Restore(f, created.operation.id);

  await hr09f2Recover(f);

  const restored = (
    await f.rows('payroll_entries')
  )[0];

  assert.equal(restored.id, initial.id);

  assert.equal(
    restored.net_salary_halalas,
    initial.net_salary_halalas
  );

  console.log(
    'HR09F2_PAYROLL_RESTORATION:',
    JSON.stringify({
      original: initial.net_salary_halalas,
      converted: converted.net_salary_halalas,
      restored: restored.net_salary_halalas
    })
  );
});

test('HR09F2 cancellation replay cannot duplicate audit or financial work', async t => {
  const f = await fixture(t);

  const created = await f.create();

  await hr09f2Recover(f);

  await hr09f2Restore(f, created.operation.id);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  const results = await Promise.all(
    Array.from(
      { length: 10 },
      () => hr09f2Restore(f, created.operation.id)
    )
  );

  assert.ok(
    results.every(
      result => result.idempotent === true
    )
  );

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  await assert.rejects(
    hr09f2Restore(f, created.operation.id, {
      reason: 'Conflicting restoration reason'
    }),
    error => error.status === 409
  );

  console.log('PASS: ten exact restoration replays');
});

test('HR09F2 second exception failure rolls back the entire restoration', async t => {
  const f = await fixture(t);

  const created = await f.create();

  await hr09f2Recover(f);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  f.core.database.exec(`
    CREATE TRIGGER synthetic_restore_failure
    BEFORE UPDATE ON hr_schedule_exceptions
    WHEN OLD.exception_type = 'off'
      AND NEW.status = 'cancelled'
    BEGIN
      SELECT RAISE(
        ABORT,
        'synthetic_restore_failure'
      );
    END;
  `);

  await assert.rejects(
    hr09f2Restore(f, created.operation.id),
    /synthetic_restore_failure/
  );

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  f.core.database.exec(
    'DROP TRIGGER synthetic_restore_failure'
  );

  await hr09f2Restore(f, created.operation.id);

  console.log('PASS: complete restoration rollback and retry');
});

test('HR09F2 cancellation requires a reason and preserves immutable history', async t => {
  const f = await fixture(t);

  const created = await f.create();

  await hr09f2Recover(f);

  const before = await f.snapshot();

  await assert.rejects(
    hr09f2Restore(f, created.operation.id, {
      reason: ''
    }),
    error => error.status === 400
  );

  assert.deepEqual(await f.snapshot(), before);

  await hr09f2Restore(f, created.operation.id);

  for (const id of [
    created.operation.work_exception_id,
    created.operation.rest_exception_id
  ]) {
    await assert.rejects(
      f.core.prepare(`
        UPDATE hr_schedule_exceptions
           SET status = 'approved'
         WHERE id = ?
      `).bind(id).run(),
      /weekly_rest_rescheduling_exception_history_immutable/
    );

    await assert.rejects(
      f.core.prepare(`
        DELETE FROM hr_schedule_exceptions WHERE id = ?
      `).bind(id).run(),
      /weekly_rest_rescheduling_exception_history_immutable/
    );
  }

  await assert.rejects(
    f.core.prepare(`
      UPDATE employee_weekly_rest_rescheduling
         SET status = 'active'
       WHERE id = ?
    `).bind(created.operation.id).run(),
    /weekly_rest_rescheduling_cancelled_immutable/
  );

  await assert.rejects(
    f.core.prepare(`
      DELETE FROM employee_weekly_rest_rescheduling
       WHERE id = ?
    `).bind(created.operation.id).run(),
    /weekly_rest_rescheduling_history_immutable/
  );

  console.log('PASS: cancellation evidence and history protected');
});

test('HR09F2 restored dates permit a new independent operation after finance completes', async t => {
  const f = await fixture(t);

  const first = await f.create();

  await hr09f2Recover(f);

  await hr09f2Restore(f, first.operation.id);

  await hr09f2Recover(f);

  const second = await f.create({
    id: 'hr09f2-independent-operation'
  });

  assert.notEqual(second.operation.id, first.operation.id);
  assert.equal(second.operation.status, 'active');

  const exceptions = await f.rows('hr_schedule_exceptions');

  assert.equal(exceptions.length, 4);

  assert.equal(
    exceptions.filter(
      row => row.status === 'cancelled'
    ).length,
    2
  );

  console.log('PASS: independent operation after restoration');
});

test('HR09F3 pending cancellation finance blocks another overlapping swap', async t => {
  const f = await fixture(t);

  const first = await f.create();

  await hr09f2Recover(f);

  await hr09f2Restore(
    f,
    first.operation.id
  );

  const before = await f.snapshot();
  const jobsBefore = await restSwapPayrollJobs(f.core);

  assert.equal(jobsBefore.length, 4);

  assert.equal(
    jobsBefore.filter(
      job => job.status === 'pending'
    ).length,
    2
  );

  await assert.rejects(
    f.create({
      id: 'pending-cancellation-conflict'
    }),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:finance_pending'
  );

  assert.deepEqual(await f.snapshot(), before);

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    jobsBefore
  );

  await hr09f2Recover(f);

  const second = await f.create({
    id: 'pending-cancellation-resolved'
  });

  assert.equal(second.operation.status, 'active');
  assert.equal(second.idempotent, false);

  console.log('PASS: pending restoration cannot overlap a new swap');
});

test('HR09F3 concurrent restoration requests produce exactly one mutation', async t => {
  const f = await fixture(t);

  const created = await f.create();

  await hr09f2Recover(f);

  const results = await Promise.all(
    Array.from(
      { length: 10 },
      () => hr09f2Restore(
        f,
        created.operation.id
      )
    )
  );

  assert.equal(
    results.filter(
      result => result.idempotent === false
    ).length,
    1
  );

  assert.equal(
    results.filter(
      result => result.idempotent === true
    ).length,
    9
  );

  assert.ok(
    results.every(
      result => result.operation.status === 'cancelled'
    )
  );

  assert.equal(
    (await f.rows('hr_shift_audit_log')).length,
    4
  );

  assert.equal(
    (await restSwapPayrollJobs(f.core)).length,
    4
  );

  console.log('PASS: one cancellation mutation and nine safe replays');
});

test('HR09F3 restoration rejects different employee and tenant identities', async t => {
  const f = await fixture(t);

  const {
    cancelWeeklyRestRescheduling
  } = await import(
    './core/repositories/weekly-rest-rescheduling.js'
  );

  const created = await f.create();

  await hr09f2Recover(f);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  await assert.rejects(
    hr09f2Restore(
      f,
      created.operation.id,
      { employeeId: 'foreign-employee' }
    ),
    error => error.status === 404
  );

  await assert.rejects(
    cancelWeeklyRestRescheduling(
      f.core,
      'foreign-salon',
      created.operation.id,
      {
        employeeId,
        reason: 'Synthetic restoration'
      },
      actor,
      f.attendance
    ),
    error => error.status === 404
  );

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  console.log('PASS: restoration employee and tenant isolation');
});

test('HR09F3 cancellation payroll outbox failure rolls back restoration', async t => {
  const f = await fixture(t);

  const created = await f.create();

  await hr09f2Recover(f);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  f.core.database.exec(`
    CREATE TRIGGER synthetic_cancel_finance_failure
    BEFORE INSERT ON hr_payroll_operations
    WHEN json_extract(
      NEW.response_json,
      '$.sourceType'
    ) = 'weekly_rest_rescheduling'
    AND json_extract(
      NEW.response_json,
      '$.action'
    ) = 'cancel'
    BEGIN
      SELECT RAISE(
        ABORT,
        'synthetic_cancel_finance_failure'
      );
    END;
  `);

  await assert.rejects(
    hr09f2Restore(
      f,
      created.operation.id
    ),
    /synthetic_cancel_finance_failure/
  );

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  f.core.database.exec(
    'DROP TRIGGER synthetic_cancel_finance_failure'
  );

  const result = await hr09f2Restore(
    f,
    created.operation.id
  );

  assert.equal(result.operation.status, 'cancelled');

  console.log('PASS: financial failure rolls back complete restoration');
});

test('HR09F3 cancellation replay is bound to its original administrator', async t => {
  const f = await fixture(t);

  const {
    cancelWeeklyRestRescheduling
  } = await import(
    './core/repositories/weekly-rest-rescheduling.js'
  );

  const created = await f.create();

  await hr09f2Recover(f);
  await hr09f2Restore(f, created.operation.id);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  await assert.rejects(
    cancelWeeklyRestRescheduling(
      f.core,
      salonId,
      created.operation.id,
      {
        employeeId,
        reason: 'Synthetic restoration'
      },
      { uid: 'another-admin' },
      f.attendance
    ),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:cancellation_operation_conflict'
  );

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  console.log('PASS: cancellation administrator evidence preserved');
});

async function hr09g2HttpFixture(t) {
  const f = await fixture(t);

  const { default: worker } = await import(
    './core/index.js'
  );

  const now = '2026-01-01T00:00:00.000Z';

  for (const [id, uid, role, salon] of [
    ['hr09g-owner', 'hr09g-owner-uid', 'owner', 'main'],
    ['hr09g-staff', 'hr09g-staff-uid', 'staff', 'main'],
    ['hr09g-foreign', 'hr09g-foreign-uid', 'owner', 'foreign-salon']
  ]) {
    await f.core.prepare(`
      INSERT INTO app_users (
        id, firebase_uid, salon_id, email,
        display_name, primary_role, status,
        email_verified, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
    `).bind(
      id,
      uid,
      salon,
      `${id}@example.test`,
      id,
      role,
      now,
      now
    ).run();
  }

  const endpoint =
    '/api/core/hr/weekly-rest/rescheduling';

  const env = {
    FIREBASE_PROJECT_ID: 'waves-hotel-dashboard',
    PACKAGES_AUTH_TEST_MODE: 'true',
    SALON_ID: 'main',
    CORE_DB: f.core,
    ATTENDANCE_DB: f.attendance
  };

  const input = {
    id: 'hr09g2-http-operation',
    employeeId,
    originalRestDate: originalDate,
    replacementRestDate: replacementDate,
    startTime: '12:00',
    endTime: '20:00',
    reason: 'Synthetic HTTP rest swap'
  };

  async function call(
    path = endpoint,
    {
      method = 'GET',
      body,
      uid = 'hr09g-owner-uid',
      role = 'owner',
      expected = 200,
      authenticated = true,
      environment = env
    } = {}
  ) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (authenticated) {
      headers.Authorization =
        `Bearer test:${uid}:${role}`;
    }

    const response = await worker.fetch(
      new Request(`http://core.test${path}`, {
        method,
        headers,
        ...(body !== undefined
          ? { body: JSON.stringify(body) }
          : {})
      }),
      environment
    );

    const result = await response.json();

    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${JSON.stringify(result)}`
    );

    return result.data;
  }

  const list = (query = '') =>
    call(
      `${endpoint}?employeeId=${employeeId}${query}`
    );

  const create = (overrides = {}, options = {}) =>
    call(endpoint, {
      method: 'POST',
      body: { ...input, ...overrides },
      ...options
    });

  const restore = (overrides = {}, options = {}) =>
    call(`${endpoint}/${input.id}/cancel`, {
      method: 'POST',
      body: {
        employeeId,
        reason: 'Synthetic HTTP restoration',
        ...overrides
      },
      ...options
    });

  return {
    ...f,
    endpoint,
    env,
    input,
    call,
    list,
    create,
    restore
  };
}

test('HR09G2 HTTP create list reconcile restore lifecycle', async t => {
  const f = await hr09g2HttpFixture(t);

  assert.deepEqual(await f.list(), []);

  const created = await f.create();

  assert.equal(created.operation.id, f.input.id);
  assert.equal(created.operation.employee_id, employeeId);
  assert.equal(created.operation.status, 'active');

  assert.equal(
    created.operation.created_by_uid,
    'hr09g-owner-uid'
  );

  assert.equal(created.operationStateFresh, true);

  assert.equal(
    created.reconciliation.status,
    'recovery_pending'
  );

  assert.equal(
    created.reconciliation.financeCompleted,
    false
  );

  assert.equal(created.reconciliation.operationCount, 2);

  const pending = await f.list('&status=active');

  assert.equal(pending.length, 1);
  assert.equal(pending[0].finance_operation_count, 2);
  assert.equal(pending[0].finance_completed_count, 0);

  await f.restore({}, { expected: 409 });

  await hr09f2Recover(f);

  const replay = await f.create();

  assert.equal(replay.idempotent, true);
  assert.equal(replay.operationStateFresh, true);
  assert.equal(replay.reconciliation.financeCompleted, true);

  const completed = await f.list();

  assert.equal(completed[0].finance_completed_count, 2);

  const restored = await f.restore();

  assert.equal(restored.operation.status, 'cancelled');
  assert.equal(restored.operationStateFresh, true);
  assert.equal(restored.reconciliation.financeCompleted, false);
  assert.equal(restored.reconciliation.operationCount, 4);

  await hr09f2Recover(f);

  const cancelledReplay = await f.restore();

  assert.equal(cancelledReplay.idempotent, true);
  assert.equal(cancelledReplay.reconciliation.financeCompleted, true);

  const history = await f.list('&status=cancelled');

  assert.equal(history.length, 1);
  assert.equal(history[0].finance_operation_count, 4);
  assert.equal(history[0].finance_completed_count, 4);

  assert.deepEqual(await f.list('&status=active'), []);

  assert.equal(
    (await f.rows('hr_schedule_exceptions')).length,
    2
  );

  assert.equal(
    (await f.rows('hr_shift_audit_log')).length,
    4
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: complete authenticated HTTP lifecycle');
});

test('HR09G2 HTTP unauthenticated and staff requests cannot mutate schedules', async t => {
  const f = await hr09g2HttpFixture(t);

  const before = await f.snapshot();

  await f.call(
    `${f.endpoint}?employeeId=${employeeId}`,
    {
      authenticated: false,
      expected: 401
    }
  );

  const denied = {
    uid: 'hr09g-staff-uid',
    role: 'staff',
    expected: 403
  };

  await f.call(
    `${f.endpoint}?employeeId=${employeeId}`,
    denied
  );

  await f.create({}, denied);

  await f.restore({}, denied);

  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await restSwapPayrollJobs(f.core)).length, 0);

  console.log('PASS: unauthorized HTTP requests cannot write');
});

test('HR09G2 HTTP reads and restoration remain employee scoped', async t => {
  const f = await hr09g2HttpFixture(t);

  await f.create();

  await hr09f2Recover(f);

  const before = await f.snapshot();

  const foreignRows = await f.call(
    `${f.endpoint}?employeeId=foreign-employee`
  );

  assert.deepEqual(foreignRows, []);

  await f.restore(
    { employeeId: 'foreign-employee' },
    { expected: 404 }
  );

  await f.create(
    { employeeId: 'foreign-employee' },
    { expected: 409 }
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: employee scoped HTTP lifecycle');
});

test('HR09G2 HTTP rejects invalid filters and malformed dates', async t => {
  const f = await hr09g2HttpFixture(t);

  const before = await f.snapshot();

  for (const query of [
    '',
    `?employeeId=${employeeId}&status=unknown`,
    `?employeeId=${employeeId}&from=2026-11-01`,
    `?employeeId=${employeeId}&from=2026-02-30&to=2026-03-01`,
    `?employeeId=${employeeId}&from=2026-11-30&to=2026-11-01`,
    `?employeeId=${employeeId}&from=2025-01-01&to=2026-12-31`
  ]) {
    await f.call(f.endpoint + query, {
      expected: 400
    });
  }

  await f.create(
    { originalRestDate: '2026-02-30' },
    { expected: 400 }
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: invalid API filters and dates rejected');
});

test('HR09G2 HTTP filters include both original and replacement dates', async t => {
  const f = await hr09g2HttpFixture(t);

  await f.create();

  const original = await f.list(
    `&from=${originalDate}&to=${originalDate}`
  );

  const replacement = await f.list(
    `&from=${replacementDate}&to=${replacementDate}`
  );

  assert.equal(original.length, 1);
  assert.equal(replacement.length, 1);
  assert.equal(original[0].id, replacement[0].id);

  assert.deepEqual(
    await f.list('&from=2026-10-01&to=2026-10-31'),
    []
  );

  console.log('PASS: both affected dates visible through HTTP');
});

test('HR09G2 HTTP refuses creation without attendance binding', async t => {
  const f = await hr09g2HttpFixture(t);

  const before = await f.snapshot();

  await f.create({}, {
    environment: {
      ...f.env,
      ATTENDANCE_DB: undefined
    },
    expected: 503
  });

  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await restSwapPayrollJobs(f.core)).length, 0);

  console.log('PASS: missing attendance binding fails closed');
});

test('HR09G2 HTTP rejects conflicting replay without additional mutations', async t => {
  const f = await hr09g2HttpFixture(t);

  await f.create();

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  const replay = await f.create();

  assert.equal(replay.idempotent, true);

  await f.create(
    { reason: 'Conflicting operation' },
    { expected: 409 }
  );

  await f.create(
    { id: 'overlapping-http-operation' },
    { expected: 409 }
  );

  assert.deepEqual(await f.snapshot(), before);

  assert.deepEqual(
    await restSwapPayrollJobs(f.core),
    jobs
  );

  console.log('PASS: HTTP replay preserves canonical evidence');
});

test('HR09G2 repository financial state remains tenant isolated', async t => {
  const f = await hr09g2HttpFixture(t);

  const {
    listWeeklyRestRescheduling,
    getWeeklyRestReschedulingState
  } = await import(
    './core/repositories/weekly-rest-rescheduling.js'
  );

  await f.create();

  assert.deepEqual(
    await listWeeklyRestRescheduling(
      f.core,
      'foreign-salon',
      { employeeId }
    ),
    []
  );

  await assert.rejects(
    getWeeklyRestReschedulingState(
      f.core,
      'foreign-salon',
      employeeId,
      f.input.id
    ),
    error => error.status === 404
  );

  console.log('PASS: canonical read model tenant isolation');
});

test('HR09G3 foreign owner cannot read or cancel another tenant operation', async t => {
  const f = await hr09g2HttpFixture(t);

  await f.create();
  await hr09f2Recover(f);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  const foreign = {
    uid: 'hr09g-foreign-uid',
    role: 'owner',
    expected: 403
  };

  await f.call(
    `${f.endpoint}?employeeId=${employeeId}`,
    foreign
  );

  await f.restore({}, foreign);

  await f.create({}, foreign);

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  console.log('PASS: foreign owner denied across HTTP boundary');
});

test('HR09G3 disabled account cannot replay a previously authorized operation', async t => {
  const f = await hr09g2HttpFixture(t);

  await f.create();

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  await f.core.prepare(`
    UPDATE app_users
       SET status = 'disabled'
     WHERE id = 'hr09g-owner'
       AND salon_id = 'main'
  `).run();

  await f.create({}, {
    expected: 403
  });

  await f.call(
    `${f.endpoint}?employeeId=${employeeId}`,
    {
      expected: 403
    }
  );

  await f.restore({}, {
    expected: 403
  });

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  console.log('PASS: account revocation prevents operation replay');
});

async function hr09g4cRequest(f, path, body, key, uid) {
  const { default: worker } = await import('./core/index.js');

  return worker.fetch(
    new Request(`http://core.test${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer test:${uid}:owner`,
        'Idempotency-Key': key
      },
      body: JSON.stringify(body)
    }),
    f.env
  );
}

test('HR09G4C cached creation cannot bypass revoked account authorization', async t => {
  const f = await hr09g2HttpFixture(t);

  const key = 'hr09g4c-create-replay';

  const first = await hr09g4cRequest(
    f,
    f.endpoint,
    f.input,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(first.status, 200);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  await f.core.prepare(`
    UPDATE app_users
       SET status = 'disabled'
     WHERE id = 'hr09g-owner'
       AND salon_id = 'main'
  `).run();

  const replay = await hr09g4cRequest(
    f,
    f.endpoint,
    f.input,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(replay.status, 403);

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  console.log('PASS: header replay cannot bypass revoked authorization');
});

test('HR09G4C same idempotency header cannot expose another tenant operation', async t => {
  const f = await hr09g2HttpFixture(t);

  const key = 'hr09g4c-cross-tenant';

  const first = await hr09g4cRequest(
    f,
    f.endpoint,
    f.input,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(first.status, 200);

  const before = await f.snapshot();

  const replay = await hr09g4cRequest(
    f,
    f.endpoint,
    f.input,
    key,
    'hr09g-foreign-uid'
  );

  assert.equal(replay.status, 403);
  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: header replay cannot expose foreign tenant data');
});

test('HR09G4C exact domain replay returns current financial state', async t => {
  const f = await hr09g2HttpFixture(t);

  const key = 'hr09g4c-fresh-state';

  const first = await hr09g4cRequest(
    f,
    f.endpoint,
    f.input,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(first.status, 200);

  const initial = (await first.json()).data;

  assert.equal(initial.reconciliation.financeCompleted, false);

  await hr09f2Recover(f);

  const replay = await hr09g4cRequest(
    f,
    f.endpoint,
    f.input,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(replay.status, 200);

  const current = (await replay.json()).data;

  assert.equal(current.idempotent, true);
  assert.equal(current.operationStateFresh, true);
  assert.equal(current.reconciliation.financeCompleted, true);

  assert.equal((await restSwapPayrollJobs(f.core)).length, 2);

  console.log('PASS: authorized replay returns fresh financial state');
});

test('HR09G4C cancellation header replay requires current authorization', async t => {
  const f = await hr09g2HttpFixture(t);

  await f.create();
  await hr09f2Recover(f);

  const path = `${f.endpoint}/${f.input.id}/cancel`;

  const body = {
    employeeId,
    reason: 'Synthetic protected restoration'
  };

  const key = 'hr09g4c-cancel-replay';

  const first = await hr09g4cRequest(
    f,
    path,
    body,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(first.status, 200);

  const before = await f.snapshot();
  const jobs = await restSwapPayrollJobs(f.core);

  await f.core.prepare(`
    UPDATE app_users
       SET status = 'disabled'
     WHERE id = 'hr09g-owner'
       AND salon_id = 'main'
  `).run();

  const replay = await hr09g4cRequest(
    f,
    path,
    body,
    key,
    'hr09g-owner-uid'
  );

  assert.equal(replay.status, 403);

  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await restSwapPayrollJobs(f.core), jobs);

  console.log('PASS: cancellation replay rechecks current authorization');
});

async function hr09g4d2TemporaryRest(f, overrides = {}) {
  return createScheduleException(
    f.core,
    salonId,
    {
      id: 'original-temporary-rest',
      employeeId,
      dateFrom: originalDate,
      dateTo: originalDate,
      exceptionType: 'off',
      enabled: 1,
      note: '[temp_weekly_off:synthetic] Temporary weekly rest',
      ...overrides
    },
    actor
  );
}

test('HR09G4D2 temporary weekly rest is preserved during swap and restoration', async t => {
  const f = await fixture(t);

  const source = await hr09g4d2TemporaryRest(f);
  const before = await f.shift(originalDate);

  assert.equal(before.id, source.id);
  assert.equal(isExplicitWeeklyRestShift(before), true);

  const result = await f.create();

  assert.equal(result.idempotent, false);
  assert.equal(
    result.operation.original_rest_exception_id,
    source.id
  );

  const work = await f.shift(originalDate);
  const rest = await f.shift(replacementDate);

  assert.equal(work.id, result.operation.work_exception_id);
  assert.equal(work.exception_type, 'custom');
  assert.equal(isExplicitWeeklyRestShift(work), false);
  assert.equal(isExplicitWeeklyRestShift(rest), true);

  const sourceDuring = (
    await f.rows('hr_schedule_exceptions')
  ).find(row => row.id === source.id);

  assert.deepEqual(sourceDuring, source);

  const batch = await resolveEmployeeShiftsBatch(
    f.core,
    salonId,
    {
      employeeIds: [employeeId],
      dateFrom: originalDate,
      dateTo: replacementDate
    }
  );

  for (const row of batch.rows) {
    const single = await f.shift(row.date);
    assert.equal(row.id, single.id);
    assert.equal(row.exception_type, single.exception_type);
  }

  await hr09f2Recover(f);

  await hr09f2Restore(f, result.operation.id);

  await hr09f2Recover(f);

  assert.deepEqual(
    await f.shift(originalDate),
    before
  );

  const restored = (
    await f.rows('hr_schedule_exceptions')
  ).find(row => row.id === source.id);

  assert.deepEqual(restored, source);

  assert.equal(
    (await restSwapPayrollJobs(f.core)).length,
    4
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: temporary rest restored without rewriting original evidence');
});

test('HR09G4D2 temporary rest cannot be modified during active rescheduling', async t => {
  const f = await fixture(t);

  const source = await hr09g4d2TemporaryRest(f);

  await f.create();

  const before = await f.snapshot();

  await assert.rejects(
    f.core.prepare(`
      UPDATE hr_schedule_exceptions
         SET note = 'Changed evidence'
       WHERE id = ?
    `).bind(source.id).run(),
    /weekly_rest_rescheduling_exception_protected/
  );

  await assert.rejects(
    f.core.prepare(`
      DELETE FROM hr_schedule_exceptions WHERE id = ?
    `).bind(source.id).run(),
    /weekly_rest_rescheduling_exception_protected/
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: active temporary rest evidence protected');
});

test('HR09G4D2 ordinary off exception cannot be treated as weekly rest', async t => {
  const f = await fixture(t);

  await hr09g4d2TemporaryRest(f, {
    note: 'Ordinary non-weekly off day'
  });

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:original_date_not_weekly_rest'
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: ordinary off exception remains distinct');
});

test('HR09G4D2 multi-day temporary exception cannot be partially suppressed', async t => {
  const f = await fixture(t);

  await hr09g4d2TemporaryRest(f, {
    dateFrom: '2026-11-21',
    dateTo: originalDate
  });

  const before = await f.snapshot();

  await assert.rejects(
    f.create(),
    error =>
      error.status === 409 &&
      error.code ===
        'core_weekly_rest_rescheduling:schedule_exception_conflict'
  );

  assert.deepEqual(await f.snapshot(), before);

  console.log('PASS: multi-day exception protected from partial mutation');
});

test('HR09G4D2 temporary rest swap rolls back if replacement exception fails', async t => {
  const f = await fixture(t);

  await hr09g4d2TemporaryRest(f);

  const before = await f.snapshot();
  const original = await f.shift(originalDate);

  f.core.database.exec(`
    CREATE TRIGGER synthetic_temp_rest_failure
    BEFORE INSERT ON hr_schedule_exceptions
    WHEN NEW.exception_type = 'off'
      AND NEW.date_from = '${replacementDate}'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic_temp_rest_failure');
    END;
  `);

  await assert.rejects(
    f.create(),
    /synthetic_temp_rest_failure/
  );

  assert.deepEqual(await f.snapshot(), before);

  assert.deepEqual(
    await f.shift(originalDate),
    original
  );

  assert.equal(
    (await restSwapPayrollJobs(f.core)).length,
    0
  );

  console.log('PASS: temporary rest preserved after failed transaction');
});

test('HR09G51 restoration with complete attendance creates one review event without automatic credit', async t => {
  const f = await fixture(t);

  await hr09e83bPunchOriginalRest(f);

  const punchesBefore = (
    await f.core.prepare(`
      SELECT * FROM attendance_records ORDER BY id
    `).all()
  ).results;

  const created = await f.create();

  await hr09f2Recover(f);

  assert.equal(
    (await f.rows('employee_weekly_rest_events')).length,
    0
  );

  await hr09f2Restore(f, created.operation.id);

  await hr09f2Recover(f);

  const events = await f.rows(
    'employee_weekly_rest_events'
  );

  assert.equal(events.length, 1);

  const event = events[0];

  assert.equal(event.salon_id, salonId);
  assert.equal(event.employee_id, employeeId);
  assert.equal(event.rest_date, originalDate);
  assert.equal(event.restoration_status, 'pending_review');
  assert.equal(event.status, 'open');
  assert.equal(event.worked_minutes, 480);
  assert.equal(event.substitute_rest_minutes, 0);

  const jobs = await restSwapPayrollJobs(f.core);

  const originalRestJob = jobs.find(job =>
    job.work_date === originalDate &&
    JSON.parse(job.response_json).action === 'cancel'
  );

  assert.ok(originalRestJob);
  assert.equal(originalRestJob.status, 'completed');

  const reconciliation = JSON.parse(
    originalRestJob.reconciliation_json
  );

  assert.equal(
    reconciliation.weeklyRestReview.eventId,
    event.id
  );

  assert.equal(
    reconciliation.weeklyRestReview.requiresReview,
    true
  );

  assert.equal(
    reconciliation.weeklyRestReview.attendanceComplete,
    true
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  assert.deepEqual(
    (
      await f.core.prepare(`
        SELECT * FROM attendance_records ORDER BY id
      `).all()
    ).results,
    punchesBefore
  );

  console.log('PASS: restored weekly rest creates pending entitlement review');
  console.log('PASS: 480 worked minutes preserved');
  console.log('PASS: no automatic compensation credit');

  for (let i = 0; i < 10; i++) {
    const replay = await hr09f2Restore(
      f,
      created.operation.id
    );

    assert.equal(replay.idempotent, true);
  }

  await hr09f2Recover(f);

  assert.deepEqual(
    await f.rows('employee_weekly_rest_events'),
    events
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: ten restoration replays preserve exactly one review event');
});

test('HR09G51 restoration without attendance creates no entitlement event', async t => {
  const f = await fixture(t);

  const created = await f.create();

  await hr09f2Recover(f);
  await hr09f2Restore(f, created.operation.id);
  await hr09f2Recover(f);

  assert.equal(
    (await f.rows('employee_weekly_rest_events')).length,
    0
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  const jobs = await restSwapPayrollJobs(f.core);

  const job = jobs.find(row =>
    row.work_date === originalDate &&
    JSON.parse(row.response_json).action === 'cancel'
  );

  assert.ok(job);

  const result = JSON.parse(job.reconciliation_json);

  assert.equal(result.weeklyRestReview.worked, false);
  assert.equal(result.weeklyRestReview.requiresReview, false);
  assert.equal(result.weeklyRestReview.eventId, null);

  console.log('PASS: ordinary restoration creates no false entitlement');
});

test('HR09G51 restoration of temporary rest preserves attendance review and original exception', async t => {
  const f = await fixture(t);

  const originalException = await hr09g4d2TemporaryRest(f);

  await hr09e83bPunchOriginalRest(f);

  const created = await f.create();

  await hr09f2Recover(f);
  await hr09f2Restore(f, created.operation.id);
  await hr09f2Recover(f);

  const events = await f.rows(
    'employee_weekly_rest_events'
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].rest_date, originalDate);
  assert.equal(events[0].restoration_status, 'pending_review');
  assert.equal(events[0].schedule_source_id, originalException.id);

  const restoredException = (
    await f.rows('hr_schedule_exceptions')
  ).find(row => row.id === originalException.id);

  assert.deepEqual(
    restoredException,
    originalException
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: temporary weekly rest review uses original schedule evidence');
});


test('HR09G8B3 canonical entitlement remains independent from completed finance', async t => {
  const f = await fixture(t);

  const {
    getWeeklyRestReschedulingState,
    listWeeklyRestRescheduling
  } = await import(
    './core/repositories/weekly-rest-rescheduling.js'
  );

  await hr09e83bPunchOriginalRest(f);

  const created = await f.create();

  await hr09f2Recover(f);

  const active = await getWeeklyRestReschedulingState(
    f.core,
    salonId,
    employeeId,
    created.operation.id
  );

  assert.equal(active.operation.status, 'active');
  assert.equal(active.operation.rest_review_checked, 0);
  assert.equal(active.operation.rest_review_event_id, null);

  await hr09f2Restore(f, created.operation.id);

  await hr09f2Recover(f);

  const events = await f.rows('employee_weekly_rest_events');

  assert.equal(events.length, 1);

  const event = events[0];

  const current = await getWeeklyRestReschedulingState(
    f.core,
    salonId,
    employeeId,
    created.operation.id
  );

  assert.equal(current.operationStateFresh, true);
  assert.equal(current.operation.status, 'cancelled');
  assert.equal(current.reconciliation.status, 'completed');
  assert.equal(current.reconciliation.financeCompleted, true);

  assert.equal(current.operation.rest_review_checked, 1);
  assert.equal(current.operation.rest_review_event_id, event.id);
  assert.equal(current.operation.rest_review_status, 'pending_review');
  assert.equal(current.operation.rest_review_event_status, 'open');
  assert.equal(current.operation.rest_review_worked_minutes, 480);
  assert.equal(current.operation.rest_review_substitute_minutes, 0);

  const listed = await listWeeklyRestRescheduling(
    f.core,
    salonId,
    { employeeId }
  );

  const listedOperation = listed.find(
    row => row.id === created.operation.id
  );

  assert.ok(listedOperation);

  for (const key of [
    'rest_review_checked',
    'rest_review_event_id',
    'rest_review_status',
    'rest_review_event_status',
    'rest_review_worked_minutes',
    'rest_review_substitute_minutes'
  ]) {
    assert.equal(
      listedOperation[key],
      current.operation[key],
      `Read model mismatch: ${key}`
    );
  }

  const replay = await hr09f2Restore(
    f,
    created.operation.id
  );

  assert.equal(replay.idempotent, true);

  const afterReplay = await getWeeklyRestReschedulingState(
    f.core,
    salonId,
    employeeId,
    created.operation.id
  );

  assert.deepEqual(afterReplay.operation, current.operation);

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  assert.equal(
    (await f.rows('employee_weekly_rest_events')).length,
    1
  );

  console.log('PASS: finance completed independently from pending entitlement review');
  console.log('PASS: list and canonical state return identical entitlement evidence');
  console.log('PASS: replay preserves current entitlement without automatic credit');
});

test('HR09G8B3 canonical entitlement without attendance returns explicit null evidence', async t => {
  const f = await fixture(t);

  const {
    getWeeklyRestReschedulingState
  } = await import(
    './core/repositories/weekly-rest-rescheduling.js'
  );

  const created = await f.create();

  await hr09f2Recover(f);

  await hr09f2Restore(f, created.operation.id);

  await hr09f2Recover(f);

  const current = await getWeeklyRestReschedulingState(
    f.core,
    salonId,
    employeeId,
    created.operation.id
  );

  assert.equal(current.operationStateFresh, true);
  assert.equal(current.operation.status, 'cancelled');
  assert.equal(current.reconciliation.financeCompleted, true);
  assert.equal(current.operation.rest_review_checked, 1);

  for (const key of [
    'rest_review_event_id',
    'rest_review_status',
    'rest_review_event_status',
    'rest_review_worked_minutes',
    'rest_review_substitute_minutes'
  ]) {
    assert.equal(current.operation[key], null, key);
  }

  assert.equal(
    (await f.rows('employee_weekly_rest_events')).length,
    0
  );

  assert.equal(
    (await f.rows('employee_comp_time_ledger')).length,
    0
  );

  console.log('PASS: explicit no-event state without false entitlement');
});
