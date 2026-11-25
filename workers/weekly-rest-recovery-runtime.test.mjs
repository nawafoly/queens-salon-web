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


test('weekly rest reversal preserves entitlement after a valid time correction', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const created = await adminAdjust(f, {
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: 'rest-reversal-valid-create',
  });

  assert.equal(created.status, 200, await created.clone().text());
  assert.equal(await f.balance(), 1440);

  const edited = await adminAdjust(f, {
    checkOutTime: '23:15',
    operationId: 'rest-reversal-valid-edit',
  });

  assert.equal(edited.status, 200, await edited.clone().text());
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('weekly rest reversal removes unused entitlement after checkout deletion', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const created = await adminAdjust(f, {
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: 'rest-reversal-delete-create',
  });

  assert.equal(created.status, 200, await created.clone().text());
  assert.equal(await f.balance(), 1440);

  const input = {
    clearCheckOut: true,
    operationId: 'rest-reversal-delete-checkout',
  };

  const deleted = await adminAdjust(f, input);

  assert.equal(deleted.status, 200, await deleted.clone().text());

  const replay = await adminAdjust(f, input);

  assert.equal(replay.status, 200);

  assert.equal(
    await f.balance(),
    0,
    'Unused weekly rest entitlement must be reversed'
  );

  assert.equal(await f.credits(), 1);
});

test('weekly rest reversal restores entitlement exactly once after checkout restoration', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const created = await adminAdjust(f, {
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: 'rest-reversal-restore-create',
  });

  assert.equal(created.status, 200, await created.clone().text());
  assert.equal(await f.balance(), 1440);

  const deleted = await adminAdjust(f, {
    clearCheckOut: true,
    operationId: 'rest-reversal-restore-delete',
  });

  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal(await f.balance(), 0);

  const input = {
    checkOutTime: '23:00',
    operationId: 'rest-reversal-restore-checkout',
  };

  const restored = await adminAdjust(f, input);

  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal(await f.balance(), 1440);

  const replay = await adminAdjust(f, input);

  assert.equal(replay.status, 200);

  await f.recover();

  assert.equal(await f.balance(), 1440);
});

import {
  debitCompTime,
} from './core/repositories/comp-time.js';

async function createCorrectionEntitlement(f, prefix) {
  await f.assignment('2026-09-01');

  const response = await adminAdjust(f, {
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: prefix + '-create',
  });

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await f.balance(), 1440);
}

async function correctionReviewCount(f) {
  const row = await f.core.prepare(`
    SELECT COUNT(*) AS count
    FROM employee_labor_compliance_events
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND rule_code = 'weekly_rest_attendance_correction'
      AND status = 'open'
  `).first();

  return Number(row.count);
}

async function correctionLedgerCount(f, sourceType) {
  const row = await f.core.prepare(`
    SELECT COUNT(*) AS count
    FROM employee_comp_time_ledger
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
      AND source_type = ?
  `).bind(sourceType).first();

  return Number(row.count);
}

test('weekly rest reversal protects consumed entitlement', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'consumed-rest');

  await debitCompTime(
    f.core,
    'main',
    {
      employeeId: 'test-employee',
      entitlementType: 'weekly_rest_due',
      minutes: 1440,
      sourceType: 'leave_request',
      sourceId: 'synthetic-consumed-rest',
      sourceDate: '2026-09-02',
      note: 'Synthetic consumed entitlement',
    },
    { uid: 'test-hr' }
  );

  assert.equal(await f.balance(), 0);

  const input = {
    clearCheckOut: true,
    operationId: 'consumed-rest-delete',
  };

  const response = await adminAdjust(f, input);

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await f.balance(), 0);
  assert.equal(await correctionReviewCount(f), 1);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    0
  );

  const replay = await adminAdjust(f, input);

  assert.equal(replay.status, 200);
  assert.equal(await correctionReviewCount(f), 1);
  assert.equal(await f.balance(), 0);
});

test('weekly rest reversal protects unrelated balance movements', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'unrelated-rest');

  await creditCompTime(
    f.core,
    'main',
    {
      employeeId: 'test-employee',
      entitlementType: 'weekly_rest_due',
      minutes: 1440,
      sourceType: 'manual_adjustment',
      sourceId: 'synthetic-unrelated-credit',
      sourceDate: '2026-09-03',
      note: 'Unrelated manual entitlement',
    },
    { uid: 'test-hr' }
  );

  assert.equal(await f.balance(), 2880);

  const response = await adminAdjust(f, {
    clearCheckOut: true,
    operationId: 'unrelated-rest-delete',
  });

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await f.balance(), 2880);
  assert.equal(await correctionReviewCount(f), 1);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    0
  );
});

test('weekly rest reversal supports repeated delete and restore cycles', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'repeated-rest');

  for (let cycle = 1; cycle <= 3; cycle++) {
    const deletion = {
      clearCheckOut: true,
      operationId: `repeated-rest-delete-${cycle}`,
    };

    const deleted = await adminAdjust(f, deletion);

    assert.equal(deleted.status, 200, await deleted.clone().text());
    assert.equal(await f.balance(), 0);

    await adminAdjust(f, deletion);

    assert.equal(await f.balance(), 0);

    const restoration = {
      checkOutTime: '23:00',
      operationId: `repeated-rest-restore-${cycle}`,
    };

    const restored = await adminAdjust(f, restoration);

    assert.equal(restored.status, 200, await restored.clone().text());
    assert.equal(await f.balance(), 1440);

    await adminAdjust(f, restoration);
    await f.recover();

    assert.equal(await f.balance(), 1440);
  }

  assert.equal(await f.credits(), 4);
  assert.equal(await correctionReviewCount(f), 0);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    3
  );

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_restore'),
    3
  );

  const ledger = await f.core.prepare(`
    SELECT SUM(
      balance_after_minutes - balance_before_minutes
    ) AS net_minutes
    FROM employee_comp_time_ledger
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
  `).first();

  assert.equal(Number(ledger.net_minutes), await f.balance());

  const state = await f.core.prepare(`
    SELECT version, last_entry_id
    FROM employee_comp_time_balances
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
  `).first();

  assert.equal(Number(state.version), 7);

  const event = await f.core.prepare(`
    SELECT entitlement_ledger_entry_id,
           restoration_status,
           substitute_rest_minutes
    FROM employee_weekly_rest_events
  `).first();

  assert.equal(event.entitlement_ledger_entry_id, state.last_entry_id);
  assert.equal(event.restoration_status, 'owed');
  assert.equal(Number(event.substitute_rest_minutes), 1440);
});

test('weekly rest reversal handles concurrent attendance deletion during scheduled credit', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');
  await f.punch('2026-09-01', 'check_in', '12:00');
  await f.punch('2026-09-01', 'check_out', '20:00');

  const originalBatch = f.core.batch.bind(f.core);

  let injected = false;

  f.core.batch = async statements => {
    if (!injected) {
      const event = await f.core.prepare(`
        SELECT id
        FROM employee_weekly_rest_events
        WHERE salon_id = 'main'
          AND employee_id = 'test-employee'
          AND rest_date = '2026-09-01'
      `).first();

      if (event) {
        injected = true;

        const deleted = await adminAdjust(f, {
          clearCheckOut: true,
          operationId: 'concurrent-rest-checkout-deletion',
        });

        assert.equal(
          deleted.status,
          200,
          await deleted.clone().text()
        );
      }
    }

    return originalBatch(statements);
  };

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-11-24T21:00:00Z'),
  };

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(injected, true);

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  const checkout = await f.attendance.prepare(`
    SELECT COUNT(*) AS count
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_out'
      AND result = 'allowed'
  `).first();

  assert.equal(Number(checkout.count), 0);

  assert.equal(
    await f.balance(),
    0,
    'Concurrent attendance deletion must not leave an invalid entitlement'
  );
});

test('weekly rest reversal recovers interrupted post-credit correction', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');
  await f.punch('2026-09-01', 'check_in', '12:00');
  await f.punch('2026-09-01', 'check_out', '20:00');

  const originalBatch = f.core.batch.bind(f.core);
  const originalPrepare = f.core.prepare.bind(f.core);

  let deleted = false;
  let creditCommitted = false;
  let interrupted = false;

  f.core.batch = async statements => {
    if (!deleted) {
      const event = await originalPrepare(`
        SELECT id
        FROM employee_weekly_rest_events
        WHERE salon_id = 'main'
          AND employee_id = 'test-employee'
          AND rest_date = '2026-09-01'
      `).first();

      if (event) {
        deleted = true;

        const response = await adminAdjust(f, {
          clearCheckOut: true,
          operationId: 'interrupted-rest-delete',
        });

        assert.equal(
          response.status,
          200,
          await response.clone().text()
        );

        const result = await originalBatch(statements);

        creditCommitted = (await f.balance()) === 1440;

        return result;
      }
    }

    return originalBatch(statements);
  };

  f.core.prepare = sql => {
    if (
      creditCommitted &&
      !interrupted &&
      /SELECT id FROM employee_weekly_rest_work_assignments/i.test(sql) &&
      /status\s*=\s*'completed'/i.test(sql)
    ) {
      interrupted = true;
      throw new Error('SIMULATED_POST_CREDIT_INTERRUPTION');
    }

    return originalPrepare(sql);
  };

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-11-24T21:00:00Z'),
  };

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  f.core.prepare = originalPrepare;
  f.core.batch = originalBatch;

  assert.equal(deleted, true);
  assert.equal(creditCommitted, true);
  assert.equal(interrupted, true);

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const assignment = await f.core.prepare(`
    SELECT status, correction_pending
    FROM employee_weekly_rest_work_assignments
    WHERE rest_date = '2026-09-01'
  `).first();

  assert.equal(assignment.status, 'completed');
  assert.equal(Number(assignment.correction_pending), 1);

  console.log('VERIFIED_INTERRUPTED_CREDIT_BALANCE: 1440');

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(
    await f.balance(),
    0,
    'Scheduled recovery must finish an interrupted correction'
  );

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 1);

  const recovered = await f.core.prepare(`
    SELECT correction_pending
    FROM employee_weekly_rest_work_assignments
    WHERE rest_date = '2026-09-01'
  `).first();

  assert.equal(Number(recovered.correction_pending), 0);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    1
  );
});

test('weekly rest reversal recovers confirmed but unfinished assignment', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'unfinished-confirmation');

  await f.core.prepare(`
    UPDATE employee_weekly_rest_work_assignments
       SET status = 'assigned',
           correction_pending = 0,
           completed_at = NULL
     WHERE salon_id = 'main'
       AND rest_date = '2026-09-01'
  `).run();

  const originalPrepare = f.core.prepare.bind(f.core);

  let recoveryBlocked = false;

  f.core.prepare = sql => {
    if (
      /FROM employee_weekly_rest_work_assignments a/i.test(sql) &&
      /a\.status/i.test(sql)
    ) {
      recoveryBlocked = true;
      throw new Error('SIMULATED_RECOVERY_UNAVAILABLE');
    }

    return originalPrepare(sql);
  };

  let deleted;

  try {
    deleted = await adminAdjust(f, {
      clearCheckOut: true,
      operationId: 'unfinished-confirmation-delete',
    });
  } finally {
    f.core.prepare = originalPrepare;
  }

  assert.equal(
    deleted.status,
    200,
    await deleted.clone().text()
  );

  assert.equal(recoveryBlocked, true);

  const checkout = await f.attendance.prepare(`
    SELECT COUNT(*) AS count
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_out'
      AND result = 'allowed'
  `).first();

  assert.equal(Number(checkout.count), 0);

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-11-24T21:00:00Z'),
  };

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(await f.balance(), 0);

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 1);
  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    1
  );
});

import {
  reconcileCreditedWeeklyRest,
} from './core/repositories/weekly-rest-correction.js';

test('weekly rest reversal refuses dates before approved cutoff', async () => {
  const result = await reconcileCreditedWeeklyRest(
    null,
    'main',
    'test-employee',
    '2026-08-30',
    null,
    { uid: 'test-admin' },
    'historical-protection'
  );

  assert.equal(result.status, 'not_applicable');
});

test('weekly rest reversal recovers unlinked committed ledger credit', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');
  await f.punch('2026-09-01', 'check_in', '12:00');
  await f.punch('2026-09-01', 'check_out', '20:00');

  const originalPrepare = f.core.prepare.bind(f.core);
  let interrupted = false;

  f.core.prepare = sql => {
    if (
      !interrupted &&
      /UPDATE employee_weekly_rest_events/i.test(sql) &&
      /entitlement_ledger_entry_id\s*=\s*\?/i.test(sql) &&
      /entitlement_ledger_entry_id IS NULL/i.test(sql)
    ) {
      interrupted = true;
      throw new Error('SIMULATED_LEDGER_LINK_INTERRUPTION');
    }

    return originalPrepare(sql);
  };

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-11-24T21:00:00Z'),
  };

  try {
    await recoverAssignedWeeklyRestWork(
      f.core, 'main', f.attendance, options
    );
  } finally {
    f.core.prepare = originalPrepare;
  }

  assert.equal(interrupted, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const event = await f.core.prepare(`
    SELECT entitlement_ledger_entry_id
    FROM employee_weekly_rest_events
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND rest_date = '2026-09-01'
  `).first();

  assert.ok(event);
  assert.equal(event.entitlement_ledger_entry_id, null);

  console.log('VERIFIED_UNLINKED_LEDGER_CREDIT: 1440');

  f.core.prepare = sql => {
    if (
      /FROM employee_weekly_rest_work_assignments a/i.test(sql) &&
      /a\.status/i.test(sql)
    ) {
      throw new Error('SIMULATED_RECOVERY_UNAVAILABLE');
    }

    return originalPrepare(sql);
  };

  let deleted;

  try {
    deleted = await adminAdjust(f, {
      clearCheckOut: true,
      operationId: 'unlinked-credit-delete',
    });
  } finally {
    f.core.prepare = originalPrepare;
  }

  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal(await f.balance(), 1440);

  const checkout = await f.attendance.prepare(`
    SELECT COUNT(*) AS count
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_out'
      AND result = 'allowed'
  `).first();

  assert.equal(Number(checkout.count), 0);

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(
    await f.balance(),
    0,
    'An unlinked committed credit must be reconciled after attendance deletion'
  );

  await recoverAssignedWeeklyRestWork(
    f.core, 'main', f.attendance, options
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 1);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    1
  );
});


test('ordinary employee checkout restores reversed weekly rest entitlement', async t => {
  const f = await fixture(t);

  const date = '2026-09-01';

  await createCorrectionEntitlement(
    f,
    'ordinary-punch-restoration'
  );

  assert.equal(await f.balance(), 1440);

  const deleted = await adminAdjust(f, {
    clearCheckOut: true,
    operationId: 'ordinary-punch-delete-checkout',
  });

  assert.equal(
    deleted.status,
    200,
    await deleted.clone().text()
  );

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  const assignment = await f.core.prepare(`
    SELECT status, correction_pending
    FROM employee_weekly_rest_work_assignments
    WHERE rest_date = ?
  `).bind(date).first();

  assert.equal(assignment.status, 'completed');
  assert.equal(Number(assignment.correction_pending), 0);

  await f.core.prepare(`
    UPDATE employee_employment
    SET allowed_zone_ids_json = '["test-zone"]'
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
  `).run();

  await f.attendance.prepare(`
    INSERT INTO work_zones (
      id, name, type, center_lat, center_lng,
      radius_meters, active, created_at, updated_at,
      created_by_uid, updated_by_uid
    )
    VALUES (
      'test-zone', 'Isolated zone', 'radius',
      24.7, 46.6, 1000, 1,
      '2026-01-01', '2026-01-01',
      'test-admin', 'test-admin'
    )
  `).run();

  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date(`${date}T20:15:00.000Z`),
  });

  const {
    handleAttendanceRequest,
  } = await import('./attendance-worker.js');

  async function employeeCheckout() {
    const request = new Request(
      'https://test.invalid/attendance/record',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'check_out',
          operationId: 'ordinary-rest-checkout',
          employeeId: 'test-employee',
          location: {
            lat: 24.7,
            lng: 46.6,
            accuracy: 10,
          },
          deviceInfo: {},
        }),
      }
    );

    return handleAttendanceRequest({
      request,
      url: new URL(request.url),
      db: f.attendance,
      directoryDb: f.core,
      salonId: 'main',

      resolveRequesterContext: async () => ({
        ok: true,
        uid: 'test-uid',
        email: 'staff@example.invalid',
        userData: {
          employeeId: 'test-employee',
        },
        runtime: {
          isActive: true,
          role: 'staff',
          permissionsAllow: [
            'attendance.own.view',
          ],
        },
      }),

      fetchFirestoreDocument: async () => null,
      queryFirestoreDocuments: async () => [],
    });
  }

  const response = await employeeCheckout();

  assert.equal(
    response.status,
    200,
    await response.clone().text()
  );

  const payload = await response.json();

  assert.equal(
    payload.result,
    'allowed',
    JSON.stringify(payload)
  );

  const checkout = await f.attendance.prepare(`
    SELECT id, result, work_date
    FROM attendance_records
    WHERE id = 'ordinary-rest-checkout'
  `).first();

  assert.ok(checkout);
  assert.equal(checkout.result, 'allowed');
  assert.equal(checkout.work_date, date);

  const operation = await f.attendance.prepare(`
    SELECT origin, status
    FROM attendance_operations
    WHERE id = 'punch:ordinary-rest-checkout'
  `).first();

  assert.ok(operation);
  assert.equal(operation.origin, 'punch');
  assert.equal(operation.status, 'completed');

  console.log('VERIFIED_REAL_EMPLOYEE_CHECKOUT_ALLOWED');
  console.log('VERIFIED_ORDINARY_PUNCH_OUTBOX_COMPLETED');
  console.log('BALANCE_AFTER_ORDINARY_CHECKOUT:', await f.balance());

  assert.equal(
    await f.balance(),
    1440,
    'P2_REGRESSION: ordinary checkout must restore reversed entitlement'
  );

  const replay = await employeeCheckout();

  assert.equal(
    replay.status,
    200,
    await replay.clone().text()
  );

  assert.equal(await f.balance(), 1440);

  await recoverAssignedWeeklyRestWork(
    f.core,
    'main',
    f.attendance,
    {
      fromDate: '2026-08-31',
      now: new Date('2026-09-02T01:00:00Z'),
      employeeId: 'test-employee',
      restDate: date,
    }
  );

  assert.equal(await f.balance(), 1440);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_restore'
    ),
    1
  );

  const checkoutCount = await f.attendance.prepare(`
    SELECT COUNT(*) AS count
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = ?
      AND type = 'check_out'
      AND result = 'allowed'
  `).bind(date).first();

  assert.equal(Number(checkoutCount.count), 1);
});

test('explicit historical weekly rest reconciliation completes without correction pending', async t => {
  const f = await fixture(t);

  const date = '2026-08-30';

  const {
    reconcileAssignedWeeklyRestWork,
  } = await import('./core/repositories/leave-rest-workflows.js');

  await f.assignment(date);

  await f.punch(date, 'check_in', '12:00');
  await f.punch(date, 'check_out', '20:00');

  assert.equal(await f.balance(), 0);

  async function reconcile() {
    return reconcileAssignedWeeklyRestWork(
      f.core,
      'main',
      'test-employee',
      date,
      {
        uid: 'test-admin',
      },
      f.attendance
    );
  }

  async function readAssignment() {
    return f.core.prepare(`
      SELECT status, correction_pending
      FROM employee_weekly_rest_work_assignments
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND rest_date = ?
    `).bind(date).first();
  }

  let result;
  let failure;

  try {
    result = await reconcile();
  } catch (error) {
    failure = error;
  }

  const assignment = await readAssignment();
  const balance = await f.balance();

  console.log('HISTORICAL_RECONCILIATION_ERROR:', failure?.message || 'none');
  console.log('HISTORICAL_ENTITLEMENT_BALANCE:', balance);
  console.log('HISTORICAL_ASSIGNMENT_STATUS:', assignment?.status);
  console.log('HISTORICAL_CORRECTION_PENDING:', assignment?.correction_pending);

  assert.equal(balance, 1440);
  assert.equal(assignment.status, 'completed');

  assert.equal(
    failure,
    undefined,
    'HR14_REGRESSION: historical explicit reconciliation must not fail after committing entitlement'
  );

  assert.ok(result?.entitlement);

  assert.equal(
    Number(assignment.correction_pending),
    0,
    'Historical assignment must not retain an unsupported pending correction'
  );

  assert.equal(await f.credits(), 1);

  await reconcile();

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const replayed = await readAssignment();

  assert.equal(replayed.status, 'completed');
  assert.equal(Number(replayed.correction_pending), 0);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    0
  );

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_restore'
    ),
    0
  );

  console.log('VERIFIED_HISTORICAL_RECONCILIATION_IDEMPOTENT');
});

test('scheduled weekly rest correction converges after concurrent admin checkout restoration', async t => {
  const f = await fixture(t);

  const date = '2026-09-01';

  await createCorrectionEntitlement(
    f,
    'scheduled-stale-evidence'
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  // Temporarily represent the previously credited assignment as
  // unfinished so the administrative deletion does not reverse it.
  await f.core.prepare(`
    UPDATE employee_weekly_rest_work_assignments
       SET status = 'assigned',
           correction_pending = 0,
           completed_at = NULL
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
       AND status = 'completed'
  `).bind(date).run();

  const setupPrepare = f.core.prepare.bind(f.core);

  let recoveryInterrupted = false;
  let deletion;

  f.core.prepare = sql => {
    if (
      /FROM employee_weekly_rest_work_assignments a/i.test(sql) &&
      /a\.status/i.test(sql)
    ) {
      recoveryInterrupted = true;
      throw new Error('SIMULATED_HR13_RECOVERY_UNAVAILABLE');
    }

    return setupPrepare(sql);
  };

  try {
    deletion = await adminAdjust(f, {
      date,
      clearCheckOut: true,
      operationId: 'hr13-initial-checkout-deletion',
    });
  } finally {
    f.core.prepare = setupPrepare;
  }

  assert.equal(deletion.status, 200, await deletion.clone().text());
  assert.equal(recoveryInterrupted, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  // Simulate the durable completed assignment awaiting correction.
  await f.core.prepare(`
    UPDATE employee_weekly_rest_work_assignments
       SET status = 'completed',
           correction_pending = 1,
           completed_at = ?
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
       AND status = 'assigned'
  `).bind('2026-09-01T20:00:00Z', date).run();

  console.log('VERIFIED_ADMIN_DELETION_WITH_INTERRUPTED_RECOVERY');

  await f.core.prepare(`
    UPDATE employee_weekly_rest_work_assignments
       SET correction_pending = 1
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
       AND status = 'completed'
  `).bind(date).run();

  async function readAssignment() {
    return f.core.prepare(`
      SELECT status, correction_pending
      FROM employee_weekly_rest_work_assignments
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND rest_date = ?
    `).bind(date).first();
  }

  async function checkoutCount() {
    const row = await f.attendance.prepare(`
      SELECT COUNT(*) AS count
      FROM attendance_records
      WHERE employee_uid = 'test-uid'
        AND work_date = ?
        AND type = 'check_out'
        AND result = 'allowed'
    `).bind(date).first();

    return Number(row.count);
  }

  assert.equal(await checkoutCount(), 0);
  assert.equal(await f.balance(), 1440);
  assert.equal(
    Number((await readAssignment()).correction_pending),
    1
  );

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-09-02T01:00:00Z'),
    employeeId: 'test-employee',
    restDate: date,
  };

  const originalBatch = f.core.batch.bind(f.core);

  let injected = false;
  let restored = false;
  let adminError;

  f.core.batch = async statements => {
    if (!injected) {
      injected = true;

      try {
        const response = await adminAdjust(f, {
          date,
          checkOutTime: '23:00',
          operationId: 'concurrent-admin-checkout-restoration',
        });

        assert.equal(
          response.status,
          200,
          await response.clone().text()
        );

        assert.equal(await checkoutCount(), 1);
        assert.equal(await f.balance(), 1440);

        restored = true;

        console.log('VERIFIED_CONCURRENT_ADMIN_RESTORATION');
        console.log('BALANCE_BEFORE_STALE_BATCH:', await f.balance());
      } catch (error) {
        adminError = error;
        throw error;
      }
    }

    return originalBatch(statements);
  };

  let firstRecovery;

  try {
    firstRecovery = await recoverAssignedWeeklyRestWork(
      f.core,
      'main',
      f.attendance,
      options
    );
  } finally {
    f.core.batch = originalBatch;
  }

  assert.equal(adminError, undefined);
  assert.equal(injected, true);
  assert.equal(restored, true);
  assert.equal(await checkoutCount(), 1);

  const firstAssignment = await readAssignment();

  console.log(
    'BALANCE_AFTER_CONCURRENT_RECOVERY:',
    await f.balance()
  );

  console.log(
    'PENDING_AFTER_CONCURRENT_RECOVERY:',
    firstAssignment.correction_pending
  );

  console.log(
    'FIRST_RECOVERY_RESULT:',
    JSON.stringify(firstRecovery)
  );

  const retry = await recoverAssignedWeeklyRestWork(
    f.core,
    'main',
    f.attendance,
    options
  );

  const finalAssignment = await readAssignment();

  console.log(
    'BALANCE_AFTER_RECOVERY_RETRY:',
    await f.balance()
  );

  console.log(
    'FINAL_CORRECTION_PENDING:',
    finalAssignment.correction_pending
  );

  assert.equal(await checkoutCount(), 1);

  assert.equal(
    await f.balance(),
    1440,
    'HR13_REGRESSION: complete attendance must retain the weekly rest entitlement after concurrent reconciliation'
  );

  assert.equal(finalAssignment.status, 'completed');

  assert.equal(
    Number(finalAssignment.correction_pending),
    0
  );

  assert.equal(await f.credits(), 1);
  assert.equal(retry.failed, 0);

  const ledger = await f.core.prepare(`
    SELECT SUM(
      balance_after_minutes - balance_before_minutes
    ) AS net_minutes
    FROM employee_comp_time_ledger
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
  `).first();

  assert.equal(
    Number(ledger.net_minutes),
    await f.balance()
  );

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    0,
    'Superseded correction must not create a reversal ledger entry'
  );

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_restore'),
    0,
    'Superseded correction must not require a compensating restore'
  );

  console.log('VERIFIED_STALE_CORRECTION_CREATED_NO_LEDGER_MOVEMENT');
  console.log('VERIFIED_CONCURRENT_CORRECTION_CONVERGENCE');
});

test('weekly rest correction survives interruption after committed reversal', async t => {
  const f = await fixture(t);
  const date = '2026-09-01';

  await createCorrectionEntitlement(
    f,
    'revision-interruption'
  );

  assert.equal(await f.balance(), 1440);

  const originalPrepare = f.core.prepare.bind(f.core);

  let interrupted = false;
  let response;

  f.core.prepare = sql => {
    if (
      !interrupted &&
      /UPDATE employee_weekly_rest_work_assignments/i.test(sql) &&
      /SET correction_pending\s*=\s*0/i.test(sql) &&
      /correction_revision\s*=\s*\?/i.test(sql)
    ) {
      interrupted = true;
      throw new Error('SIMULATED_CORRECTION_COMPLETION_INTERRUPTION');
    }

    return originalPrepare(sql);
  };

  try {
    response = await adminAdjust(f, {
      date,
      clearCheckOut: true,
      operationId: 'revision-interruption-delete',
    });
  } finally {
    f.core.prepare = originalPrepare;
  }

  assert.equal(interrupted, true);
  assert.ok([200, 202].includes(response.status));

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    1
  );

  async function readAssignment() {
    return f.core.prepare(`
      SELECT status, correction_pending, correction_revision
      FROM employee_weekly_rest_work_assignments
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND rest_date = ?
    `).bind(date).first();
  }

  const interruptedState = await readAssignment();

  assert.equal(interruptedState.status, 'completed');
  assert.equal(Number(interruptedState.correction_pending), 1);

  console.log('VERIFIED_COMMITTED_REVERSAL_BALANCE:', await f.balance());
  console.log('VERIFIED_INTERRUPTED_CORRECTION_PENDING:', interruptedState.correction_pending);

  const options = {
    fromDate: '2026-08-31',
    now: new Date('2026-09-02T01:00:00Z'),
    employeeId: 'test-employee',
    restDate: date,
  };

  const recovery = await recoverAssignedWeeklyRestWork(
    f.core,
    'main',
    f.attendance,
    options
  );

  assert.equal(recovery.failed, 0);

  const recovered = await readAssignment();

  assert.equal(Number(recovered.correction_pending), 0);

  assert.ok(
    Number(recovered.correction_revision) >
      Number(interruptedState.correction_revision)
  );

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    1
  );

  await recoverAssignedWeeklyRestWork(
    f.core,
    'main',
    f.attendance,
    options
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 1);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    1
  );

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_restore'),
    0
  );

  const ledger = await f.core.prepare(`
    SELECT SUM(
      balance_after_minutes - balance_before_minutes
    ) AS net_minutes
    FROM employee_comp_time_ledger
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND entitlement_type = 'weekly_rest_due'
  `).first();

  assert.equal(Number(ledger.net_minutes), await f.balance());

  console.log('VERIFIED_INTERRUPTED_CORRECTION_RECOVERED');
  console.log('VERIFIED_NO_DUPLICATE_REVERSAL');
  console.log('VERIFIED_LEDGER_BALANCE_INTEGRITY');
});

test('superseded weekly rest correction cannot create a stale compliance alert', async t => {
  const f = await fixture(t);
  const date = '2026-09-01';

  await createCorrectionEntitlement(
    f,
    'stale-alert-protection'
  );

  assert.equal(await f.balance(), 1440);

  await debitCompTime(
    f.core,
    'main',
    {
      employeeId: 'test-employee',
      entitlementType: 'weekly_rest_due',
      minutes: 1440,
      sourceType: 'leave_request',
      sourceId: 'synthetic-stale-alert-consumption',
      sourceDate: '2026-09-02',
      note: 'Synthetic consumed entitlement',
    },
    { uid: 'test-hr' }
  );

  assert.equal(await f.balance(), 0);

  const deleted = await adminAdjust(f, {
    date,
    clearCheckOut: true,
    operationId: 'stale-alert-initial-deletion',
  });

  assert.equal(
    deleted.status,
    200,
    await deleted.clone().text()
  );

  const initialAlerts = await correctionReviewCount(f);

  assert.equal(initialAlerts, 1);

  const originalPrepare = f.core.prepare.bind(f.core);

  let intercepted = false;
  let newerCorrectionCompleted = false;

  f.core.prepare = sql => {
    const statement = originalPrepare(sql);

    if (
      !intercepted &&
      /INSERT OR IGNORE INTO employee_labor_compliance_events/i.test(sql) &&
      /weekly_rest_attendance_correction/i.test(sql)
    ) {
      intercepted = true;

      return {
        bind(...params) {
          const bound = statement.bind(...params);

          return {
            async run() {
              f.core.prepare = originalPrepare;

              const restored = await adminAdjust(f, {
                date,
                checkOutTime: '23:00',
                operationId: 'stale-alert-newer-restoration',
              });

              assert.equal(
                restored.status,
                200,
                await restored.clone().text()
              );

              const checkout = await f.attendance.prepare(`
                SELECT COUNT(*) AS count
                FROM attendance_records
                WHERE employee_uid = 'test-uid'
                  AND work_date = ?
                  AND type = 'check_out'
                  AND result = 'allowed'
              `).bind(date).first();

              assert.equal(Number(checkout.count), 1);

              newerCorrectionCompleted = true;

              console.log(
                'VERIFIED_NEWER_CORRECTION_COMPLETED_BEFORE_ALERT'
              );

              return bound.run();
            },
          };
        },
      };
    }

    return statement;
  };

  try {
    await assert.rejects(
      reconcileCreditedWeeklyRest(
        f.core,
        'main',
        'test-employee',
        date,
        f.attendance,
        { uid: 'test-hr' },
        'stale-alert-superseded-operation'
      ),
      /weekly_rest_correction_revision_conflict/
    );
  } finally {
    f.core.prepare = originalPrepare;
  }

  assert.equal(intercepted, true);
  assert.equal(newerCorrectionCompleted, true);

  assert.equal(
    await correctionReviewCount(f),
    initialAlerts,
    'Superseded correction must not create another compliance alert'
  );

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
    0
  );

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_correction_restore'),
    0
  );

  const assignment = await f.core.prepare(`
    SELECT status, correction_pending, correction_revision
    FROM employee_weekly_rest_work_assignments
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND rest_date = ?
  `).bind(date).first();

  assert.equal(assignment.status, 'completed');
  assert.equal(Number(assignment.correction_pending), 0);

  console.log('VERIFIED_STALE_ALERT_REJECTED');
  console.log('VERIFIED_CONSUMED_ENTITLEMENT_PRESERVED');
  console.log('VERIFIED_FINAL_CORRECTION_PENDING:', assignment.correction_pending);
});

for (const scenario of [
  {
    name: 'missing event',
    error: 'weekly_rest_correction_event_missing',
  },
  {
    name: 'missing ledger link',
    error: 'weekly_rest_correction_ledger_link_missing',
  },
  {
    name: 'non-open event',
    error: 'weekly_rest_correction_event_not_open',
  },
]) {
  test(`completed weekly rest correction preserves invalid financial evidence: ${scenario.name}`, async t => {
    const f = await fixture(t);
    const date = '2026-09-01';

    await createCorrectionEntitlement(
      f,
      `invalid-event-${scenario.name.replaceAll(' ', '-')}`
    );

    assert.equal(await f.balance(), 1440);
    assert.equal(await f.credits(), 1);

    const originalPrepare = f.core.prepare.bind(f.core);

    let intercepted = false;

    // Simulate the invalid event lookup without deleting records
    // or modifying the real fixture's ledger relationships.
    f.core.prepare = sql => {
      const statement = originalPrepare(sql);

      if (
        /SELECT \* FROM employee_weekly_rest_events/i.test(sql) &&
        /rest_date\s*=\s*\?/i.test(sql)
      ) {
        return {
          bind(...params) {
            const bound = statement.bind(...params);

            return {
              async first(...args) {
                const row = await bound.first(...args);

                assert.ok(row);
                intercepted = true;

                if (scenario.name === 'missing event') {
                  return null;
                }

                if (scenario.name === 'missing ledger link') {
                  return {
                    ...row,
                    entitlement_ledger_entry_id: null,
                  };
                }

                return {
                  ...row,
                  status: 'closed',
                };
              },
            };
          },
        };
      }

      return statement;
    };

    const readEscalations = async () => {
      const result = await originalPrepare(`
        SELECT id, salon_id, employee_id,
               rule_code, severity, status,
               source_type, source_id, details_json,
               policy_version
        FROM employee_labor_compliance_events
        WHERE salon_id = 'main'
          AND employee_id = 'test-employee'
          AND rule_code = 'weekly_rest_correction_invalid_evidence'
          AND source_type = 'weekly_rest_work_assignment'
          AND source_id = 'assignment-2026-09-01'
        ORDER BY id
      `).all();

      return result.results;
    };

    let escalationId;

    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await assert.rejects(
          reconcileCreditedWeeklyRest(
            f.core,
            'main',
            'test-employee',
            date,
            f.attendance,
            { uid: 'test-hr' },
            `invalid-financial-event:${scenario.name}:${attempt}`
          ),
          new RegExp(scenario.error)
        );

        const alerts = await readEscalations();

        console.log(
          'HR25_PERSISTENT_ESCALATION:',
          scenario.name,
          attempt,
          JSON.stringify(alerts)
        );

        assert.equal(
          alerts.length,
          1,
          'Invalid financial evidence must create exactly one persistent escalation'
        );

        const alert = alerts[0];

        assert.equal(alert.status, 'open');
        assert.equal(alert.severity, 'warning');
        assert.equal(alert.employee_id, 'test-employee');
        assert.equal(alert.source_id, 'assignment-2026-09-01');

        assert.ok(alert.policy_version);

        const details = JSON.parse(alert.details_json);

        assert.equal(details.reason, scenario.error);
        assert.equal(details.restDate, date);
        assert.equal(
          details.assignmentId,
          'assignment-2026-09-01'
        );

        if (attempt === 1) {
          escalationId = alert.id;
        } else {
          assert.equal(alert.id, escalationId);
        }

        assert.equal(await f.balance(), 1440);
        assert.equal(await f.credits(), 1);

        assert.equal(
          await correctionLedgerCount(
            f,
            'weekly_rest_correction_reversal'
          ),
          0
        );

        const state = await originalPrepare(`
          SELECT correction_pending
          FROM employee_weekly_rest_work_assignments
          WHERE salon_id = 'main'
            AND employee_id = 'test-employee'
            AND rest_date = ?
        `).bind(date).first();

        assert.equal(
          Number(state.correction_pending),
          1
        );
      }

      // Scheduled recovery must preserve the same escalation
      // when the financial evidence is still unavailable.
      const failedRecovery =
        await recoverAssignedWeeklyRestWork(
          f.core,
          'main',
          f.attendance,
          {
            fromDate: '2026-08-31',
            now: new Date('2026-09-02T01:00:00Z'),
            employeeId: 'test-employee',
            restDate: date,
          }
        );

      assert.equal(failedRecovery.failed, 1);

      const alertsAfterRecovery = await readEscalations();

      assert.equal(alertsAfterRecovery.length, 1);
      assert.equal(alertsAfterRecovery[0].id, escalationId);
      assert.equal(alertsAfterRecovery[0].status, 'open');

      assert.equal(await f.balance(), 1440);

      console.log(
        'VERIFIED_HR25_ESCALATION_DEDUPLICATION:',
        scenario.name
      );
    } finally {
      f.core.prepare = originalPrepare;
    }

    assert.equal(intercepted, true);

    const pending = await f.core.prepare(`
      SELECT status, correction_pending
      FROM employee_weekly_rest_work_assignments
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND rest_date = ?
    `).bind(date).first();

    assert.equal(pending.status, 'completed');
    assert.equal(Number(pending.correction_pending), 1);

    assert.equal(await f.balance(), 1440);
    assert.equal(await f.credits(), 1);

    assert.equal(
      await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
      0
    );

    assert.equal(
      await correctionLedgerCount(f, 'weekly_rest_correction_restore'),
      0
    );

    console.log(
      'VERIFIED_INVALID_FINANCIAL_EVIDENCE_PRESERVED:',
      scenario.name
    );

    // Once valid financial evidence is available again,
    // scheduled recovery must safely complete the operation.
    const recovery = await recoverAssignedWeeklyRestWork(
      f.core,
      'main',
      f.attendance,
      {
        fromDate: '2026-08-31',
        now: new Date('2026-09-02T01:00:00Z'),
        employeeId: 'test-employee',
        restDate: date,
      }
    );

    assert.equal(recovery.failed, 0);

    const recovered = await f.core.prepare(`
      SELECT correction_pending
      FROM employee_weekly_rest_work_assignments
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND rest_date = ?
    `).bind(date).first();

    assert.equal(Number(recovered.correction_pending), 0);
    assert.equal(await f.balance(), 1440);
    assert.equal(await f.credits(), 1);

    const resolvedAlerts = await readEscalations();

    assert.equal(resolvedAlerts.length, 1);
    assert.equal(resolvedAlerts[0].id, escalationId);
    assert.equal(resolvedAlerts[0].status, 'resolved');

    await recoverAssignedWeeklyRestWork(
      f.core,
      'main',
      f.attendance,
      {
        fromDate: '2026-08-31',
        now: new Date('2026-09-02T01:00:00Z'),
        employeeId: 'test-employee',
        restDate: date,
      }
    );

    assert.deepEqual(
      await readEscalations(),
      resolvedAlerts
    );

    console.log(
      'VERIFIED_HR25_ESCALATION_RESOLVED:',
      scenario.name
    );

    assert.equal(
      await correctionLedgerCount(f, 'weekly_rest_correction_reversal'),
      0
    );

    assert.equal(
      await correctionLedgerCount(f, 'weekly_rest_correction_restore'),
      0
    );

    console.log(
      'VERIFIED_FINANCIAL_EVENT_RECOVERY:',
      scenario.name
    );
  });
}

async function hr24InsertCorePunch(f, type) {
  const date = '2026-09-01';
  const id = `hr24-core-${type}`;
  const time = type === 'check_in'
    ? '2026-09-01T12:00:00.000Z'
    : '2026-09-01T20:00:00.000Z';

  await f.core.prepare(`
    INSERT INTO attendance_records (
      id, salon_id, employee_id, employee_uid,
      date_key, record_type, recorded_at,
      source, note, idempotency_key, created_at
    )
    VALUES (
      ?, 'main', 'test-employee', 'test-uid',
      ?, ?, ?, 'manual', 'Synthetic HR24 test', ?, ?
    )
  `).bind(
    id, date, type, time, id, time
  ).run();

  return id;
}

async function hr24CoreOperations(f, id) {
  const result = await f.core.prepare(`
    SELECT id, status, response_json, before_records, after_records
    FROM hr_payroll_operations
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND json_extract(response_json, '$.sourceType') = 'core_attendance'
      AND json_extract(response_json, '$.sourceId') = ?
  `).bind(id).all();

  return result.results;
}

for (const type of ['check_in', 'check_out']) {
  test(`HR24 core attendance outbox: voiding ${type} persists recovery work`, async t => {
    const f = await fixture(t);

    const id = await hr24InsertCorePunch(f, type);

    const before = await hr24CoreOperations(f, id);

    assert.equal(before.length, 1);

    const result = await f.core.prepare(`
      UPDATE attendance_records
      SET record_type = ?,
          source = 'employee_request_void',
          note = 'Synthetic HR24 administrative correction'
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND id = ?
        AND record_type = ?
    `).bind(
      `voided_${type}`, id, type
    ).run();

    assert.equal(result.meta.changes, 1);

    const after = await hr24CoreOperations(f, id);

    console.log(`HR24_RECORD_TYPE: ${type}`);
    console.log(`HR24_OUTBOX_BEFORE_VOID: ${before.length}`);
    console.log(`HR24_OUTBOX_AFTER_VOID: ${after.length}`);

    assert.equal(
      after.length,
      before.length + 1,
      'Voiding an active Core punch must persist a new recovery operation'
    );

    const originalIds = new Set(before.map(row => row.id));
    const added = after.filter(row => !originalIds.has(row.id));

    assert.equal(added.length, 1);

    assert.equal(
      JSON.parse(added[0].before_records).record_type,
      type
    );

    assert.equal(
      JSON.parse(added[0].after_records).record_type,
      `voided_${type}`
    );

    assert.equal(added[0].status, 'pending');
  });
}

async function hr26AssignmentState(f) {
  return f.core.prepare(`
    SELECT status, correction_pending, correction_revision
    FROM employee_weekly_rest_work_assignments
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND rest_date = '2026-09-01'
  `).first();
}

for (const mutation of ['insert', 'void', 'restore', 'delete', 'time_update']) {
  test(`HR26 weekly rest invalidation: ${mutation} marks completed assignment pending`, async t => {
    const f = await fixture(t);

    await createCorrectionEntitlement(f, `hr26-${mutation}`);

    let id;

    if (mutation !== 'insert') {
      id = await hr24InsertCorePunch(f, 'check_out');
    }

    if (mutation === 'restore') {
      await f.core.prepare(`
        UPDATE attendance_records
        SET record_type = 'voided_check_out'
        WHERE id = ?
      `).bind(id).run();
    }

    // Establish an already reconciled checkpoint before testing
    // the next isolated Core mutation.
    await f.core.prepare(`
      UPDATE employee_weekly_rest_work_assignments
      SET correction_pending = 0
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND rest_date = '2026-09-01'
    `).run();

    const before = await hr26AssignmentState(f);

    assert.equal(before.status, 'completed');
    assert.equal(before.correction_pending, 0);

    if (mutation === 'insert') {
      await hr24InsertCorePunch(f, 'check_out');
    }

    if (mutation === 'void') {
      await f.core.prepare(`
        UPDATE attendance_records
        SET record_type = 'voided_check_out'
        WHERE id = ?
      `).bind(id).run();
    }

    if (mutation === 'restore') {
      await f.core.prepare(`
        UPDATE attendance_records
        SET record_type = 'check_out'
        WHERE id = ?
      `).bind(id).run();
    }

    if (mutation === 'delete') {
      await f.core.prepare(`
        DELETE FROM attendance_records
        WHERE id = ?
      `).bind(id).run();
    }

    if (mutation === 'time_update') {
      await f.core.prepare(`
        UPDATE attendance_records
        SET recorded_at = '2026-09-01T19:00:00.000Z'
        WHERE id = ?
      `).bind(id).run();
    }

    const after = await hr26AssignmentState(f);

    assert.equal(after.status, 'completed');
    assert.equal(after.correction_pending, 1);
    assert.equal(
      after.correction_revision,
      before.correction_revision + 1
    );

    // Trigger invalidates the snapshot but does not mutate money.
    assert.equal(await f.balance(), 1440);
    assert.equal(await f.credits(), 1);

    console.log(`VERIFIED_HR26_INVALIDATION: ${mutation}`);
  });
}

test('HR26 weekly rest invalidation: metadata-only update does not invalidate entitlement', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr26-metadata');

  const id = await hr24InsertCorePunch(f, 'check_out');

  const before = await hr26AssignmentState(f);
  const operationsBefore = await hr24CoreOperations(f, id);

  await f.core.prepare(`
    UPDATE attendance_records
    SET note = 'Metadata-only update'
    WHERE id = ?
  `).bind(id).run();

  assert.deepEqual(await hr26AssignmentState(f), before);

  assert.equal(
    (await hr24CoreOperations(f, id)).length,
    operationsBefore.length
  );

  assert.equal(await f.balance(), 1440);

  console.log('VERIFIED_HR26_METADATA_UPDATE_IGNORED');
});

async function hr24PrepareCoreEntitlement(f) {
  await f.assignment('2026-09-01');

  const checkIn = await hr24InsertCorePunch(f, 'check_in');
  const checkOut = await hr24InsertCorePunch(f, 'check_out');

  const { recoverAssignedWeeklyRestWork } = await import(
    './core/repositories/weekly-rest-recovery.js'
  );

  const initialRecovery = await recoverAssignedWeeklyRestWork(
    f.core,
    'main',
    f.attendance,
    {
      fromDate: '2026-08-31',
      now: new Date('2026-09-02T12:00:00.000Z'),
      employeeId: 'test-employee',
      restDate: '2026-09-01',
    }
  );

  console.log(
    'HR24_INITIAL_RECOVERY:',
    JSON.stringify(initialRecovery)
  );

  assert.equal(initialRecovery.candidates, 1);
  assert.equal(initialRecovery.credited, 1);

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const state = await hr26AssignmentState(f);

  assert.equal(state.status, 'completed');
  assert.equal(state.correction_pending, 0);

  return { checkIn, checkOut };
}

async function hr24VoidCoreCheckout(f, id) {
  const result = await f.core.prepare(`
    UPDATE attendance_records
    SET record_type = 'voided_check_out',
        source = 'employee_request_void',
        note = 'Synthetic HR24 financial correction'
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND id = ?
      AND record_type = 'check_out'
  `).bind(id).run();

  assert.equal(result.meta.changes, 1);

  const record = await f.core.prepare(`
    SELECT record_type
    FROM attendance_records
    WHERE id = ?
  `).bind(id).first();

  assert.equal(record.record_type, 'voided_check_out');

  const state = await hr26AssignmentState(f);

  assert.equal(state.correction_pending, 1);
}

test('HR24 financial recovery: immediate Core outbox reconciliation reverses unused entitlement', async t => {
  const f = await fixture(t);

  const { checkOut } = await hr24PrepareCoreEntitlement(f);

  const {
    reconcileHrPayrollSource,
    recoverHrPayrollOperations,
  } = await import('./core/repositories/hr-payroll-operations.js');

  // Finish pre-existing insertion operations before the void.
  // The next operation must independently reconcile the correction.
  await recoverHrPayrollOperations(f.core, {
    externalAttendanceDb: f.attendance,
  });

  await hr24VoidCoreCheckout(f, checkOut);

  assert.equal(await f.balance(), 1440);

  const result = await reconcileHrPayrollSource(
    f.core,
    'main',
    'core_attendance',
    checkOut,
    { externalAttendanceDb: f.attendance },
    () => {
      throw new Error('HR24_UNEXPECTED_FALLBACK');
    }
  );

  console.log('HR24_IMMEDIATE_RESULT:', JSON.stringify(result));
  console.log('HR24_IMMEDIATE_BALANCE:', await f.balance());
  console.log(
    'HR24_IMMEDIATE_PENDING:',
    (await hr26AssignmentState(f)).correction_pending
  );

  assert.equal(result.fullyCompleted, true);
  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 1);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );
});

test('HR24 financial recovery: durable Core outbox recovers void and restore exactly once', async t => {
  const f = await fixture(t);

  const { checkOut } = await hr24PrepareCoreEntitlement(f);

  const {
    recoverHrPayrollOperations,
  } = await import('./core/repositories/hr-payroll-operations.js');

  const options = {
    externalAttendanceDb: f.attendance,
  };

  await recoverHrPayrollOperations(f.core, options);

  // Simulate interruption after committing the Core mutation:
  // no immediate application-level reconciliation is invoked.
  await hr24VoidCoreCheckout(f, checkOut);

  assert.equal(await f.balance(), 1440);

  await recoverHrPayrollOperations(f.core, options);

  console.log('HR24_RECOVERY_BALANCE:', await f.balance());
  console.log(
    'HR24_RECOVERY_PENDING:',
    (await hr26AssignmentState(f)).correction_pending
  );

  assert.equal(await f.balance(), 0);
  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );

  await recoverHrPayrollOperations(f.core, options);

  assert.equal(await f.balance(), 0);
  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  // Restore the historical punch without replacing its identity.
  await f.core.prepare(`
    UPDATE attendance_records
    SET record_type = 'check_out',
        source = 'employee_request_correction'
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND id = ?
      AND record_type = 'voided_check_out'
  `).bind(checkOut).run();

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    1
  );

  await recoverHrPayrollOperations(f.core, options);

  assert.equal(await f.balance(), 1440);

  // Original entitlement and restoration are separate credit entries.
  assert.equal(await f.credits(), 2);

  assert.equal(
    await correctionLedgerCount(f, 'weekly_rest_event'),
    1
  );

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  const readLedger = async () => {
    const result = await f.core.prepare(`
      SELECT id, entry_kind, minutes, source_type,
             source_id, balance_before_minutes,
             balance_after_minutes
      FROM employee_comp_time_ledger
      WHERE salon_id = 'main'
        AND employee_id = 'test-employee'
        AND entitlement_type = 'weekly_rest_due'
      ORDER BY id
    `).all();

    return result.results;
  };

  const ledgerBeforeReplay = await readLedger();

  assert.equal(ledgerBeforeReplay.length, 3);

  const original = ledgerBeforeReplay.find(
    row => row.source_type === 'weekly_rest_event'
  );

  const reversal = ledgerBeforeReplay.find(
    row => row.source_type === 'weekly_rest_correction_reversal'
  );

  const restoration = ledgerBeforeReplay.find(
    row => row.source_type === 'weekly_rest_correction_restore'
  );

  assert.ok(original);
  assert.ok(reversal);
  assert.ok(restoration);

  assert.equal(original.entry_kind, 'credit');
  assert.equal(original.minutes, 1440);
  assert.equal(original.balance_before_minutes, 0);
  assert.equal(original.balance_after_minutes, 1440);

  assert.equal(reversal.entry_kind, 'debit');
  assert.equal(reversal.minutes, 1440);
  assert.equal(reversal.source_id, original.id);
  assert.equal(reversal.balance_before_minutes, 1440);
  assert.equal(reversal.balance_after_minutes, 0);

  assert.equal(restoration.entry_kind, 'credit');
  assert.equal(restoration.minutes, 1440);
  assert.equal(restoration.source_id, reversal.id);
  assert.equal(restoration.balance_before_minutes, 0);
  assert.equal(restoration.balance_after_minutes, 1440);

  console.log('VERIFIED_HR24_EXACT_LEDGER_CHAIN');

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_restore'
    ),
    1
  );

  await recoverHrPayrollOperations(f.core, options);

  assert.equal(await f.balance(), 1440);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_restore'
    ),
    1
  );

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );

  assert.deepEqual(
    await readLedger(),
    ledgerBeforeReplay
  );

  assert.equal(await f.credits(), 2);

  console.log('VERIFIED_HR24_LEDGER_UNCHANGED_AFTER_REPLAY');

  console.log('VERIFIED_HR24_DURABLE_REVERSAL');
  console.log('VERIFIED_HR24_DURABLE_RESTORATION');
  console.log('VERIFIED_HR24_NO_DUPLICATE_LEDGER_MOVEMENT');
});

test('HR24 financial recovery: missing attendance binding preserves pending work and balance', async t => {
  const f = await fixture(t);

  const { checkOut } = await hr24PrepareCoreEntitlement(f);

  const {
    reconcileHrPayrollSource,
    recoverHrPayrollOperations,
  } = await import('./core/repositories/hr-payroll-operations.js');

  await recoverHrPayrollOperations(f.core, {
    externalAttendanceDb: f.attendance,
  });

  await hr24VoidCoreCheckout(f, checkOut);

  const result = await reconcileHrPayrollSource(
    f.core,
    'main',
    'core_attendance',
    checkOut,
    {},
    () => {
      throw new Error('HR24_UNEXPECTED_FALLBACK');
    }
  );

  assert.equal(result.fullyCompleted, false);
  assert.equal(result.status, 'pending');

  assert.equal(await f.balance(), 1440);

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    1
  );

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    0
  );

  const operation = await f.core.prepare(`
    SELECT status, last_error
    FROM hr_payroll_operations
    WHERE id = ?
  `).bind(result.operationId).first();

  assert.equal(operation.status, 'pending');

  assert.match(
    operation.last_error,
    /core_attendance_weekly_rest_attendance_unavailable/
  );

  await f.core.prepare(`
    UPDATE hr_payroll_operations
    SET next_attempt_at = '1970-01-01T00:00:00.000Z'
    WHERE id = ?
  `).bind(result.operationId).run();

  await recoverHrPayrollOperations(f.core, {
    externalAttendanceDb: f.attendance,
  });

  assert.equal(await f.balance(), 0);

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  const recovered = await f.core.prepare(`
    SELECT status, last_error
    FROM hr_payroll_operations
    WHERE id = ?
  `).bind(result.operationId).first();

  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.last_error, null);

  await recoverHrPayrollOperations(f.core, {
    externalAttendanceDb: f.attendance,
  });

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  console.log('VERIFIED_HR24_MISSING_ATTENDANCE_BINDING_FAIL_CLOSED');
  console.log('VERIFIED_HR24_PENDING_OPERATION_RECOVERED');
});

async function hr25ReadAlerts(f) {
  const result = await f.core.prepare(`
    SELECT *
    FROM employee_labor_compliance_events
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND rule_code = 'weekly_rest_correction_invalid_evidence'
      AND source_type = 'weekly_rest_work_assignment'
      AND source_id = 'assignment-2026-09-01'
    ORDER BY id
  `).all();

  return result.results;
}

async function hr25Reconcile(f, operationId) {
  return reconcileCreditedWeeklyRest(
    f.core,
    'main',
    'test-employee',
    '2026-09-01',
    f.attendance,
    { uid: 'test-hr' },
    operationId
  );
}

function hr25SimulateMissingEvent(f) {
  const originalPrepare = f.core.prepare.bind(f.core);

  f.core.prepare = sql => {
    const statement = originalPrepare(sql);

    if (
      /SELECT \* FROM employee_weekly_rest_events/i.test(sql) &&
      /rest_date\s*=\s*\?/i.test(sql)
    ) {
      return {
        bind() {
          return {
            async first() {
              return null;
            },
          };
        },
      };
    }

    return statement;
  };

  return () => {
    f.core.prepare = originalPrepare;
  };
}

test('HR25 escalation lifecycle: resolved alert reopens without duplicate rows', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr25-reopen');

  let restore = hr25SimulateMissingEvent(f);

  try {
    await assert.rejects(
      hr25Reconcile(f, 'hr25-first-failure'),
      /weekly_rest_correction_event_missing/
    );
  } finally {
    restore();
  }

  const firstAlerts = await hr25ReadAlerts(f);

  assert.equal(firstAlerts.length, 1);
  assert.equal(firstAlerts[0].status, 'open');

  const firstId = firstAlerts[0].id;
  const firstCreatedAt = firstAlerts[0].created_at;

  await hr25Reconcile(f, 'hr25-first-resolution');

  const resolved = await hr25ReadAlerts(f);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, firstId);
  assert.equal(resolved[0].status, 'resolved');
  assert.ok(resolved[0].resolved_at);
  assert.equal(resolved[0].resolved_by_uid, 'test-hr');

  restore = hr25SimulateMissingEvent(f);

  try {
    await assert.rejects(
      hr25Reconcile(f, 'hr25-second-failure'),
      /weekly_rest_correction_event_missing/
    );
  } finally {
    restore();
  }

  const reopened = await hr25ReadAlerts(f);

  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].id, firstId);
  assert.equal(reopened[0].status, 'open');
  assert.equal(reopened[0].created_at, firstCreatedAt);
  assert.equal(reopened[0].resolved_at, null);

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    1
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  await hr25Reconcile(f, 'hr25-second-resolution');

  const finalAlerts = await hr25ReadAlerts(f);

  assert.equal(finalAlerts.length, 1);
  assert.equal(finalAlerts[0].id, firstId);
  assert.equal(finalAlerts[0].status, 'resolved');

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('VERIFIED_HR25_ALERT_REOPENED_WITH_SAME_ID');
  console.log('VERIFIED_HR25_SECOND_RESOLUTION');
});

test('HR25 escalation lifecycle: superseded evidence failure cannot create stale alert', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr25-concurrent');

  const originalPrepare = f.core.prepare.bind(f.core);

  let injected = false;
  let newerResult;

  f.core.prepare = sql => {
    const statement = originalPrepare(sql);

    if (
      !injected &&
      /SELECT \* FROM employee_weekly_rest_events/i.test(sql) &&
      /rest_date\s*=\s*\?/i.test(sql)
    ) {
      return {
        bind() {
          return {
            async first() {
              injected = true;

              f.core.prepare = originalPrepare;

              newerResult = await hr25Reconcile(
                f,
                'hr25-newer-success'
              );

              return null;
            },
          };
        },
      };
    }

    return statement;
  };

  try {
    await assert.rejects(
      hr25Reconcile(f, 'hr25-stale-failure'),
      /weekly_rest_correction_revision_conflict/
    );
  } finally {
    f.core.prepare = originalPrepare;
  }

  assert.equal(injected, true);
  assert.equal(newerResult.status, 'unchanged');

  assert.equal((await hr25ReadAlerts(f)).length, 0);

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('VERIFIED_HR25_NEWER_REVISION_PROTECTED');
  console.log('VERIFIED_HR25_STALE_ESCALATION_REJECTED');
});

test('HR25 escalation lifecycle: failed alert write retains recoverable financial state', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr25-write-failure');

  const originalPrepare = f.core.prepare.bind(f.core);

  let injected = false;

  const restore = hr25SimulateMissingEvent(f);

  const missingEventPrepare = f.core.prepare.bind(f.core);

  f.core.prepare = sql => {
    if (
      /INSERT INTO employee_labor_compliance_events/i.test(sql) &&
      /weekly_rest_correction_invalid_evidence/i.test(sql)
    ) {
      injected = true;
      throw new Error('HR25_SIMULATED_ALERT_WRITE_FAILURE');
    }

    return missingEventPrepare(sql);
  };

  try {
    await assert.rejects(
      hr25Reconcile(f, 'hr25-failed-alert-write'),
      /HR25_SIMULATED_ALERT_WRITE_FAILURE/
    );
  } finally {
    restore();
    f.core.prepare = originalPrepare;
  }

  assert.equal(injected, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
  assert.equal((await hr25ReadAlerts(f)).length, 0);

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    1
  );

  const restoreAgain = hr25SimulateMissingEvent(f);

  try {
    await assert.rejects(
      hr25Reconcile(f, 'hr25-alert-write-retry'),
      /weekly_rest_correction_event_missing/
    );
  } finally {
    restoreAgain();
  }

  const alerts = await hr25ReadAlerts(f);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'open');

  await hr25Reconcile(f, 'hr25-successful-recovery');

  assert.equal((await hr25ReadAlerts(f))[0].status, 'resolved');

  assert.equal(
    (await hr26AssignmentState(f)).correction_pending,
    0
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('VERIFIED_HR25_FAILED_WRITE_PRESERVES_PENDING');
  console.log('VERIFIED_HR25_FAILED_WRITE_RECOVERED');
});
