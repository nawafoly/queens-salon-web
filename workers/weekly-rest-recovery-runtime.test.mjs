import test from 'node:test';
import assert from 'node:assert/strict';

import { migratedD1 } from './test-support/sqlite-d1.mjs';

import {
  recoverAssignedWeeklyRestWork,
} from './core/repositories/weekly-rest-recovery.js';

async function fixture(t) {
  const attendance = migratedD1('../attendance-migrations/');
  const core = migratedD1('../../migrations/core/');

  t.after(() => {
    attendance.database.close();
    core.database.close();
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

  async function assignment(date) {
    await core.prepare(`
      INSERT INTO employee_weekly_rest_work_assignments (
        id, salon_id, employee_id,
        rest_date, start_time, end_time,
        reason, schedule_source_type,
        status, created_at, updated_at
      )
      VALUES (
        ?, 'main', 'test-employee',
        ?, '15:00', '23:00',
        'Synthetic assignment', 'weekly_schedule',
        'assigned', ?, ?
      )
    `).bind(
      `assignment-${date}`,
      date,
      date,
      date
    ).run();
  }

  async function punch(date, type, time) {
    const timestamp = `${date}T${time}:00.000Z`;

    await attendance.prepare(`
      INSERT INTO attendance_records (
        id, employee_uid, employee_doc_id,
        type, server_time, work_date,
        location_lat, location_lng,
        location_accuracy, result,
        accuracy_accepted, created_by_uid,
        created_by_role, created_at, updated_at
      )
      VALUES (
        ?, 'test-uid', 'test-employee',
        ?, ?, ?,
        0, 0, 10, 'allowed',
        1, 'test-uid', 'employee', ?, ?
      )
    `).bind(
      `${date}-${type}`,
      type,
      timestamp,
      date,
      timestamp,
      timestamp
    ).run();
  }

  const options = {
    fromDate: '2026-11-01',
    now: new Date('2026-11-24T21:00:00Z'),
  };

  async function recover() {
    return recoverAssignedWeeklyRestWork(
      core,
      'main',
      attendance,
      options
    );
  }

  async function balance() {
    const row = await core.prepare(`
      SELECT balance_minutes
      FROM employee_comp_time_balances
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND entitlement_type = 'weekly_rest_due'
    `).first();

    return Number(row?.balance_minutes || 0);
  }

  async function credits() {
    const row = await core.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_comp_time_ledger
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND entitlement_type = 'weekly_rest_due'
        AND entry_kind = 'credit'
    `).first();

    return Number(row.count);
  }

  return {
    core,
    attendance,
    assignment,
    punch,
    recover,
    balance,
    credits,
  };
}

test('external attendance produces a real 24-hour entitlement exactly once', async t => {
  const f = await fixture(t);

  await f.assignment('2026-11-23');

  await f.punch('2026-11-23', 'check_in', '12:00');
  await f.punch('2026-11-23', 'check_out', '20:02');

  assert.equal(await f.balance(), 0);

  const first = await f.recover();

  assert.equal(first.failed, 0);
  assert.equal(first.credited, 1);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const assignment = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
  `).first();

  assert.equal(assignment.status, 'completed');

  const event = await f.core.prepare(`
    SELECT entitlement_ledger_entry_id, worked_minutes
    FROM employee_weekly_rest_events
  `).first();

  assert.ok(event.entitlement_ledger_entry_id);
  assert.equal(event.worked_minutes, 482);

  await f.recover();

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('incomplete attendance stays pending without creating credit', async t => {
  const f = await fixture(t);

  await f.assignment('2026-11-23');
  await f.punch('2026-11-23', 'check_in', '12:00');

  const result = await f.recover();

  assert.equal(result.failed, 0);
  assert.equal(result.credited, 0);
  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  const assignment = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
  `).first();

  assert.equal(assignment.status, 'assigned');

  await f.punch('2026-11-23', 'check_out', '20:00');

  const retry = await f.recover();

  assert.equal(retry.failed, 0);
  assert.equal(retry.credited, 1);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('two completed rest-day assignments produce two independent days', async t => {
  const f = await fixture(t);

  for (const date of ['2026-11-22', '2026-11-23']) {
    await f.assignment(date);
    await f.punch(date, 'check_in', '12:00');
    await f.punch(date, 'check_out', '20:00');
  }

  const result = await f.recover();

  assert.equal(result.failed, 0);
  assert.equal(result.credited, 2);
  assert.equal(await f.balance(), 2880);
  assert.equal(await f.credits(), 2);

  await f.recover();

  assert.equal(await f.balance(), 2880);
  assert.equal(await f.credits(), 2);
});

test('concurrent recovery never duplicates the same entitlement', async t => {
  const f = await fixture(t);

  await f.assignment('2026-11-23');
  await f.punch('2026-11-23', 'check_in', '12:00');
  await f.punch('2026-11-23', 'check_out', '20:00');

  await Promise.all([
    f.recover(),
    f.recover(),
    f.recover(),
  ]);

  await f.recover();

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const assignment = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
  `).first();

  assert.equal(assignment.status, 'completed');

  const events = await f.core.prepare(`
    SELECT COUNT(*) AS count
    FROM employee_weekly_rest_events
    WHERE entitlement_ledger_entry_id IS NOT NULL
  `).first();

  assert.equal(Number(events.count), 1);
});


import {
  creditCompTime,
} from './core/repositories/comp-time.js';

import {
  reconcileAssignedWeeklyRestWork,
} from './core/repositories/leave-rest-workflows.js';

async function prepareRaceFixture(t) {
  const f = await fixture(t);

  await f.assignment('2026-11-23');
  await f.punch('2026-11-23', 'check_in', '12:00');
  await f.punch('2026-11-23', 'check_out', '20:00');

  return f;
}

async function recoverWithSettlement(f, sourceType, sourceDate) {
  let injected = false;

  const result = await recoverAssignedWeeklyRestWork(
    f.core,
    'main',
    f.attendance,
    {
      fromDate: '2026-11-01',
      now: new Date('2026-11-24T21:00:00Z'),

      reconcile: async (...args) => {
        assert.equal(injected, false);
        injected = true;

        await creditCompTime(
          f.core,
          'main',
          {
            employeeId: 'test-employee',
            entitlementType: 'weekly_rest_due',
            minutes: 1440,
            sourceType,
            sourceId: `synthetic-${sourceType}`,
            sourceDate,
            note: 'Synthetic concurrent settlement',
          },
          { uid: 'test-hr' }
        );

        return reconcileAssignedWeeklyRestWork(...args);
      },
    }
  );

  assert.equal(injected, true);
  assert.equal(result.candidates, 1);

  return result;
}

async function eventCreditCount(f) {
  const row = await f.core.prepare(`
    SELECT COUNT(*) AS count
    FROM employee_comp_time_ledger
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
      AND source_type = 'weekly_rest_event'
      AND entry_kind = 'credit'
  `).first();

  return Number(row.count);
}

test('settlement posted after candidate selection cannot duplicate weekly rest credit', async t => {
  const f = await prepareRaceFixture(t);

  const result = await recoverWithSettlement(
    f,
    'manual_adjustment',
    '2026-11-23'
  );

  assert.equal(result.credited, 0);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
  assert.equal(await eventCreditCount(f), 0);

  await f.recover();

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('historical opening posted after selection blocks covered recovery credit', async t => {
  const f = await prepareRaceFixture(t);

  const result = await recoverWithSettlement(
    f,
    'historical_opening_balance',
    '2026-11-24'
  );

  assert.equal(result.credited, 0);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
  assert.equal(await eventCreditCount(f), 0);

  await f.recover();

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('older historical opening does not suppress a later earned entitlement', async t => {
  const f = await prepareRaceFixture(t);

  const result = await recoverWithSettlement(
    f,
    'historical_opening_balance',
    '2026-11-22'
  );

  assert.equal(result.failed, 0);
  assert.equal(result.credited, 1);
  assert.equal(await f.balance(), 2880);
  assert.equal(await f.credits(), 2);
  assert.equal(await eventCreditCount(f), 1);

  await f.recover();

  assert.equal(await f.balance(), 2880);
  assert.equal(await f.credits(), 2);
});

test('assignment cancelled immediately before ledger batch cannot receive credit', async t => {
  const f = await prepareRaceFixture(t);

  const originalBatch = f.core.batch.bind(f.core);

  let injected = false;

  f.core.batch = async statements => {
    if (!injected) {
      const event = await f.core.prepare(`
        SELECT id
        FROM employee_weekly_rest_events
        WHERE salon_id = 'main'
          AND employee_id = 'test-employee'
          AND rest_date = '2026-11-23'
      `).first();

      assert.ok(event);

      injected = true;

      await f.core.prepare(`
        UPDATE employee_weekly_rest_work_assignments
        SET status = 'cancelled'
        WHERE id = 'assignment-2026-11-23'
      `).run();
    }

    return originalBatch(statements);
  };

  const result = await f.recover();

  assert.equal(injected, true);
  assert.equal(result.credited, 0);
  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);
  assert.equal(await eventCreditCount(f), 0);

  const assignment = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
    WHERE id = 'assignment-2026-11-23'
  `).first();

  assert.equal(assignment.status, 'cancelled');

  await f.recover();

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);
});


test('targeted attendance recovery credits only the edited day', async t => {
  const f = await fixture(t);

  for (const date of ['2026-11-22', '2026-11-23']) {
    await f.assignment(date);
    await f.punch(date, 'check_in', '12:00');
    await f.punch(date, 'check_out', '20:00');
  }

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-11-24T21:00:00Z'),
    employeeId: 'test-employee',
    restDate: '2026-11-23',
  };

  const result = await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(result.failed, 0);
  assert.equal(result.candidates, 1);
  assert.equal(result.credited, 1);
  assert.equal(await f.balance(), 1440);

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const other = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
    WHERE rest_date = '2026-11-22'
  `).first();

  assert.equal(other.status, 'assigned');

  await f.recover();

  assert.equal(await f.balance(), 2880);
  assert.equal(await f.credits(), 2);
});

test('targeted recovery rejects incomplete target parameters', async t => {
  const f = await fixture(t);

  await assert.rejects(
    recoverAssignedWeeklyRestWork(
      f.core, 'main', f.attendance,
      {
        fromDate: '2026-08-31',
        employeeId: 'test-employee',
      }
    ),
    /weekly_rest_recovery_invalid_target/
  );

  assert.equal(await f.balance(), 0);
});

test('targeted recovery does not credit a shift before its scheduled end', async t => {
  const f = await fixture(t);

  await f.assignment('2026-11-24');
  await f.punch('2026-11-24', 'check_in', '12:00');
  await f.punch('2026-11-24', 'check_out', '20:00');

  const result = await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance,
    {
      fromDate: '2026-08-31',
      now: new Date('2026-11-24T19:00:00Z'),
      employeeId: 'test-employee',
      restDate: '2026-11-24',
    }
  );

  assert.equal(result.candidates, 0);
  assert.equal(await f.balance(), 0);
});


import {
  adjustAttendanceRecords,
} from './attendance-worker.js';

const attendanceAdmin = {
  uid: 'test-admin',
  email: 'admin@example.invalid',
  runtime: {
    isActive: true,
    role: 'owner',
    permissionsAllow: [
      'attendance.records.create',
      'attendance.records.update',
      'attendance.records.delete',
    ],
  },
};

async function adminAdjust(f, input) {
  const request = new Request(
    'https://test.invalid/attendance/admin-adjustment',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        employeeUid: 'test-uid',
        employeeDocId: 'test-employee',
        date: '2026-09-01',
        ...input,
      }),
    }
  );

  return adjustAttendanceRecords(
    request,
    f.attendance,
    f.core,
    'main',
    attendanceAdmin
  );
}

test('admin attendance correction immediately credits completed weekly rest work', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  assert.equal(await f.balance(), 0);

  const input = {
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: 'weekly-rest-admin-create',
  };

  const response = await adminAdjust(f, input);

  assert.equal(
    response.status,
    200,
    await response.clone().text()
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const assignment = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
    WHERE rest_date = '2026-09-01'
  `).first();

  assert.equal(assignment.status, 'completed');

  const replay = await adminAdjust(f, input);

  assert.equal(replay.status, 200);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('admin attendance correction grants nothing until both punches exist', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const first = await adminAdjust(f, {
    checkInTime: '15:00',
    operationId: 'weekly-rest-admin-in',
  });

  assert.equal(
    first.status,
    200,
    await first.clone().text()
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  const second = await adminAdjust(f, {
    checkOutTime: '23:00',
    operationId: 'weekly-rest-admin-out',
  });

  assert.equal(
    second.status,
    200,
    await second.clone().text()
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('ordinary admin attendance does not create a weekly rest entitlement', async t => {
  const f = await fixture(t);

  const response = await adminAdjust(f, {
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: 'ordinary-admin-attendance',
  });

  assert.equal(
    response.status,
    200,
    await response.clone().text()
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);
});


test('attendance and Core use the same approved recovery cutoff', async () => {
  const { readFileSync } = await import('node:fs');

  const {
    APPROVED_WEEKLY_REST_RECOVERY_FROM_DATE,
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const config = JSON.parse(
    readFileSync(
      new URL('../wrangler.core.jsonc', import.meta.url),
      'utf8'
    )
  );

  assert.equal(
    APPROVED_WEEKLY_REST_RECOVERY_FROM_DATE,
    config.vars.WEEKLY_REST_RECOVERY_FROM_DATE
  );

  assert.equal(
    APPROVED_WEEKLY_REST_RECOVERY_FROM_DATE,
    '2026-08-31'
  );
});


test('concurrent source replay cannot increment balance without a ledger entry', async t => {
  const f = await fixture(t);

  const data = {
    employeeId: 'test-employee',
    entitlementType: 'weekly_rest_due',
    minutes: 1440,
    sourceType: 'manual_adjustment',
    sourceId: 'synthetic-concurrent-credit',
    sourceDate: '2026-11-23',
    note: 'Synthetic concurrency test',
  };

  const actor = { uid: 'test-admin' };
  let injected = false;

  const racingCore = {
    ...f.core,

    prepare(sql) {
      const statement = f.core.prepare(sql);

      if (
        !sql.includes('SELECT * FROM employee_comp_time_ledger') ||
        !sql.includes('source_type = ? AND source_id = ?')
      ) {
        return statement;
      }

      return {
        ...statement,

        bind(...params) {
          const bound = statement.bind(...params);

          return {
            ...bound,

            async first() {
              const snapshot = await bound.first();

              if (!snapshot && !injected) {
                injected = true;

                await creditCompTime(
                  f.core,
                  'main',
                  data,
                  actor
                );
              }

              return snapshot;
            },
          };
        },
      };
    },
  };

  const result = await creditCompTime(
    racingCore,
    'main',
    data,
    actor
  );

  assert.equal(injected, true);
  assert.equal(result.idempotent, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const projection = await f.core.prepare(`
    SELECT balance_minutes, last_entry_id, version
    FROM employee_comp_time_balances
    WHERE employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
  `).first();

  const ledger = await f.core.prepare(`
    SELECT id, balance_after_minutes
    FROM employee_comp_time_ledger
    WHERE source_id = 'synthetic-concurrent-credit'
  `).first();

  assert.equal(projection.balance_minutes, ledger.balance_after_minutes);
  assert.equal(projection.last_entry_id, ledger.id);
  assert.equal(projection.version, 1);
});
