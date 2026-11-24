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
