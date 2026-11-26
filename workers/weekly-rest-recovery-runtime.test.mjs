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

async function hr27SeedEmployee(f, id, uid, salonId = 'main') {
  await f.core.prepare(`
    INSERT INTO employee_profiles (
      id, salon_id, firebase_uid, name,
      status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(
    id,
    salonId,
    uid,
    `Synthetic ${id}`,
    '2026-01-01',
    '2026-01-01'
  ).run();
}

async function hr27SeedPunch(f, {
  id,
  employeeId = 'test-employee',
  employeeUid = 'test-uid',
  salonId = 'main',
  date = '2026-09-01',
  type = 'check_out',
}) {
  const timestamp = `${date}T20:00:00.000Z`;

  await f.core.prepare(`
    INSERT INTO attendance_records (
      id, salon_id, employee_id, employee_uid,
      date_key, record_type, recorded_at,
      source, note, idempotency_key, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
  `).bind(
    id,
    salonId,
    employeeId,
    employeeUid,
    date,
    type,
    timestamp,
    'Synthetic HR27 test record',
    id,
    timestamp
  ).run();
}

async function hr27SeedApprovedRequest(f, id, payload) {
  const timestamp = '2026-11-25T10:00:00.000Z';

  await f.core.prepare(`
    INSERT INTO employee_requests (
      id, request_number, salon_id,
      employee_id, employee_uid,
      employee_name_snapshot,
      request_type, status, title,
      payload_json, execution_status,
      idempotency_key, version,
      submitted_at, approved_at,
      created_at, updated_at,
      created_by_uid, decided_by_uid
    )
    VALUES (
      ?, ?, 'main',
      'test-employee', 'test-uid',
      'Synthetic employee',
      'attendance_correction', 'approved',
      'Synthetic HR27 correction',
      ?, 'pending',
      ?, 1,
      ?, ?, ?, ?,
      'test-uid', 'test-admin'
    )
  `).bind(
    id,
    `HR27-${id}`,
    JSON.stringify({
      date: '2026-09-01',
      correctionType: 'delete_record',
      reason: 'Synthetic attendance authorization test',
      ...payload,
    }),
    `request-${id}`,
    timestamp,
    timestamp,
    timestamp,
    timestamp
  ).run();
}

async function hr27ExecuteRequest(f, id) {
  const { transitionEmployeeRequest } = await import(
    './core/repositories/employee-requests.js'
  );

  return transitionEmployeeRequest(
    f.core,
    'main',
    id,
    'execute',
    {
      version: 1,
      note: 'Synthetic authorized execution',
      idempotencyKey: `execute-${id}`,
    },
    {
      uid: 'test-admin',
      email: 'admin@example.test',
      name: 'Synthetic administrator',
      role: 'owner',
    },
    {
      externalAttendanceDb: f.attendance,
    }
  );
}

async function hr27Snapshot(f) {
  const attendance = await f.core.prepare(`
    SELECT *
    FROM attendance_records
    ORDER BY id
  `).all();

  const externalAttendance = await f.attendance.prepare(`
    SELECT *
    FROM attendance_records
    ORDER BY id
  `).all();

  const operations = await f.core.prepare(`
    SELECT *
    FROM hr_payroll_operations
    ORDER BY id
  `).all();

  const ledger = await f.core.prepare(`
    SELECT *
    FROM employee_comp_time_ledger
    ORDER BY id
  `).all();

  return {
    attendance: attendance.results,
    externalAttendance: externalAttendance.results,
    operations: operations.results,
    ledger: ledger.results,
    balance: await f.balance(),
  };
}

async function hr27VerifyRejectedExecution(f, id) {
  const before = await hr27Snapshot(f);

  let error = null;
  let result = null;

  try {
    result = await hr27ExecuteRequest(f, id);
  } catch (caught) {
    error = caught;
  }

  const after = await hr27Snapshot(f);

  const request = await f.core.prepare(`
    SELECT status, execution_status, execution_error
    FROM employee_requests
    WHERE salon_id = 'main' AND id = ?
  `).bind(id).first();

  console.log('HR27_REQUEST:', id);
  console.log('HR27_RESULT:', JSON.stringify(result));
  console.log('HR27_ERROR:', error?.code || error?.message || null);
  console.log('HR27_REQUEST_STATE:', JSON.stringify(request));

  console.log(
    'HR27_ATTENDANCE_CHANGED:',
    JSON.stringify(before.attendance) !==
      JSON.stringify(after.attendance)
  );

  assert.deepEqual(
    after.attendance,
    before.attendance,
    'Rejected request must not mutate Core attendance'
  );

  assert.deepEqual(
    after.externalAttendance,
    before.externalAttendance,
    'Rejected request must not mutate external attendance'
  );

  assert.deepEqual(
    after.operations,
    before.operations,
    'Rejected request must not mutate financial outbox'
  );

  assert.deepEqual(after.ledger, before.ledger);
  assert.equal(after.balance, before.balance);

  assert.notEqual(request.execution_status, 'completed');

  assert.ok(
    error || request.execution_status === 'failed',
    'Invalid attendance target must be rejected'
  );
}

test('HR27 request isolation: valid historical checkout correction succeeds', async t => {
  const f = await fixture(t);

  const { checkOut } = await hr24PrepareCoreEntitlement(f);

  const {
    recoverHrPayrollOperations,
  } = await import('./core/repositories/hr-payroll-operations.js');

  await recoverHrPayrollOperations(f.core, {
    externalAttendanceDb: f.attendance,
  });

  await hr27SeedApprovedRequest(
    f,
    'valid-checkout',
    { recordId: checkOut }
  );

  const result = await hr27ExecuteRequest(f, 'valid-checkout');

  console.log('HR27_VALID_RESULT:', JSON.stringify(result));

  const record = await f.core.prepare(`
    SELECT record_type
    FROM attendance_records
    WHERE id = ?
  `).bind(checkOut).first();

  assert.equal(record.record_type, 'voided_check_out');
  assert.equal(await f.balance(), 0);

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

  console.log('VERIFIED_HR27_VALID_REQUEST_FINANCIAL_CORRECTION');
});

for (const correctionType of ['delete_record', 'update_check_out']) {
  test(`HR27 request isolation: ${correctionType} rejects another employee`, async t => {
    const f = await fixture(t);

    await hr27SeedEmployee(
      f,
      'hr27-other-employee',
      'hr27-other-uid'
    );

    await hr27SeedPunch(f, {
      id: 'hr27-other-punch',
      employeeId: 'hr27-other-employee',
      employeeUid: 'hr27-other-uid',
    });

    const requestId = `other-employee-${correctionType}`;

    await hr27SeedApprovedRequest(f, requestId, {
      correctionType,
      recordId: 'hr27-other-punch',
      requestedTime: '21:00',
    });

    await hr27VerifyRejectedExecution(f, requestId);
  });

  test(`HR27 request isolation: ${correctionType} rejects another date`, async t => {
    const f = await fixture(t);

    await hr27SeedPunch(f, {
      id: 'hr27-other-date',
      date: '2026-09-02',
    });

    const requestId = `other-date-${correctionType}`;

    await hr27SeedApprovedRequest(f, requestId, {
      correctionType,
      recordId: 'hr27-other-date',
      requestedTime: '21:00',
    });

    await hr27VerifyRejectedExecution(f, requestId);
  });
}

test('HR27 request isolation: update cannot change a mismatched punch type', async t => {
  const f = await fixture(t);

  await hr27SeedPunch(f, {
    id: 'hr27-wrong-type',
    type: 'check_in',
  });

  await hr27SeedApprovedRequest(f, 'wrong-type', {
    correctionType: 'update_check_out',
    recordId: 'hr27-wrong-type',
    requestedTime: '21:00',
  });

  await hr27VerifyRejectedExecution(f, 'wrong-type');
});

test('HR27 request isolation: explicit invalid record ID must not fall back to matching time', async t => {
  const f = await fixture(t);

  await hr27SeedPunch(f, {
    id: 'hr27-existing-checkout',
  });

  await hr27SeedApprovedRequest(f, 'invalid-explicit-id', {
    correctionType: 'update_check_out',
    recordId: 'hr27-does-not-exist',
    currentTime: '23:00',
    requestedTime: '21:00',
  });

  await hr27VerifyRejectedExecution(
    f,
    'invalid-explicit-id'
  );
});

test('HR27 request isolation: inactive historical punch cannot be edited', async t => {
  const f = await fixture(t);

  await hr27SeedPunch(f, {
    id: 'hr27-voided-punch',
    type: 'voided_check_out',
  });

  await hr27SeedApprovedRequest(f, 'voided-punch', {
    correctionType: 'update_check_out',
    recordId: 'hr27-voided-punch',
    requestedTime: '21:00',
  });

  await hr27VerifyRejectedExecution(f, 'voided-punch');
});

async function hr28SeedExternalPunch(f, {
  id,
  employeeId = 'test-employee',
  employeeUid = 'test-uid',
  date = '2026-09-01',
  type = 'check_out',
  result = 'allowed',
}) {
  const timestamp = `${date}T20:00:00.000Z`;

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
      ?, ?, ?, ?, ?, ?,
      0, 0, 10, ?,
      1, ?, 'employee', ?, ?
    )
  `).bind(
    id,
    employeeUid,
    employeeId,
    type,
    timestamp,
    date,
    result,
    employeeUid,
    timestamp,
    timestamp
  ).run();
}

async function hr28ReadExternalOperations(f) {
  const result = await f.attendance.prepare(`
    SELECT *
    FROM attendance_operations
    ORDER BY id
  `).all();

  return result.results;
}

async function hr28VerifyRejectedRequest(f, requestId) {
  const operationsBefore = await hr28ReadExternalOperations(f);

  await hr27VerifyRejectedExecution(f, requestId);

  assert.deepEqual(
    await hr28ReadExternalOperations(f),
    operationsBefore,
    'Rejected request must not commit external attendance operations'
  );
}

test('HR28 external attendance isolation: valid checkout correction succeeds', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr28-positive');

  const checkout = await f.attendance.prepare(`
    SELECT id
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_out'
      AND result = 'allowed'
    LIMIT 1
  `).first();

  assert.ok(checkout?.id);
  assert.equal(await f.balance(), 1440);

  await hr27SeedApprovedRequest(f, 'hr28-valid-external', {
    correctionType: 'delete_record',
    recordId: `malikat:${checkout.id}`,
  });

  const result = await hr27ExecuteRequest(f, 'hr28-valid-external');

  console.log(
    'HR28_POSITIVE_RESULT:',
    JSON.stringify(result)
  );

  const record = await f.attendance.prepare(`
    SELECT result, rejection_reason
    FROM attendance_records
    WHERE id = ?
  `).bind(checkout.id).first();

  assert.equal(record.result, 'rejected');

  assert.equal(
    record.rejection_reason,
    'voided_by_employee_request'
  );

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  console.log('VERIFIED_HR28_VALID_EXTERNAL_CORRECTION');
});

test('HR28 external attendance isolation: rejected punch cannot be updated', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-rejected-punch',
    result: 'rejected',
  });

  await hr27SeedApprovedRequest(f, 'hr28-rejected-update', {
    correctionType: 'update_check_out',
    recordId: 'malikat:hr28-rejected-punch',
    requestedTime: '21:00',
  });

  await hr28VerifyRejectedRequest(f, 'hr28-rejected-update');
});

test('HR28 external attendance isolation: rejected punch cannot create another void operation', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-already-voided',
    result: 'rejected',
  });

  await hr27SeedApprovedRequest(f, 'hr28-repeated-void', {
    correctionType: 'delete_record',
    recordId: 'malikat:hr28-already-voided',
  });

  await hr28VerifyRejectedRequest(f, 'hr28-repeated-void');
});

test('HR28 external attendance isolation: another employee UID cannot be corrected', async t => {
  const f = await fixture(t);

  await hr27SeedEmployee(
    f,
    'hr28-other-employee',
    'hr28-other-uid'
  );

  await hr28SeedExternalPunch(f, {
    id: 'hr28-other-punch',
    employeeId: 'hr28-other-employee',
    employeeUid: 'hr28-other-uid',
  });

  await hr27SeedApprovedRequest(f, 'hr28-other-employee', {
    correctionType: 'update_check_out',
    recordId: 'malikat:hr28-other-punch',
    requestedTime: '21:00',
  });

  await hr28VerifyRejectedRequest(f, 'hr28-other-employee');
});

test('HR28 external attendance isolation: another work date cannot be corrected', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-other-date',
    date: '2026-09-02',
  });

  await hr27SeedApprovedRequest(f, 'hr28-date-mismatch', {
    correctionType: 'update_check_out',
    recordId: 'malikat:hr28-other-date',
    requestedTime: '21:00',
  });

  await hr28VerifyRejectedRequest(f, 'hr28-date-mismatch');
});

test('HR28 external attendance isolation: mismatched punch type cannot be updated', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-wrong-type',
    type: 'check_in',
  });

  await hr27SeedApprovedRequest(f, 'hr28-type-mismatch', {
    correctionType: 'update_check_out',
    recordId: 'malikat:hr28-wrong-type',
    requestedTime: '21:00',
  });

  await hr28VerifyRejectedRequest(f, 'hr28-type-mismatch');
});

test('HR28 external attendance isolation: invalid explicit ID cannot select another punch', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-existing-punch',
  });

  await hr27SeedApprovedRequest(f, 'hr28-invalid-id', {
    correctionType: 'update_check_out',
    recordId: 'malikat:hr28-missing-punch',
    currentTime: '23:00',
    requestedTime: '21:00',
  });

  await hr28VerifyRejectedRequest(f, 'hr28-invalid-id');
});

test('HR28 final boundary: matching UID cannot authorize a conflicting employee document ID', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-conflicting-document',
    employeeUid: 'test-uid',
    employeeId: 'another-employee',
  });

  await hr27SeedApprovedRequest(
    f,
    'hr28-document-conflict',
    {
      correctionType: 'update_check_out',
      recordId: 'malikat:hr28-conflicting-document',
      requestedTime: '21:00',
    }
  );

  await hr28VerifyRejectedRequest(
    f,
    'hr28-document-conflict'
  );

  console.log('VERIFIED_HR28_DOCUMENT_ID_ISOLATION');
});

test('HR28 final boundary: external ID cannot fall through to an identical Core ID', async t => {
  const f = await fixture(t);

  await hr27SeedPunch(f, {
    id: 'malikat:hr28-cross-database-id',
  });

  await hr27SeedApprovedRequest(
    f,
    'hr28-cross-database',
    {
      correctionType: 'update_check_out',
      recordId: 'malikat:hr28-cross-database-id',
      requestedTime: '21:00',
    }
  );

  await hr28VerifyRejectedRequest(
    f,
    'hr28-cross-database'
  );

  console.log('VERIFIED_HR28_NO_CROSS_DATABASE_FALLBACK');
});

test('HR28 final boundary: external correction fails closed when attendance binding is missing', async t => {
  const f = await fixture(t);

  await hr27SeedPunch(f, {
    id: 'malikat:hr28-missing-binding',
  });

  await hr28SeedExternalPunch(f, {
    id: 'hr28-missing-binding',
  });

  await hr27SeedApprovedRequest(
    f,
    'hr28-unavailable-database',
    {
      correctionType: 'update_check_out',
      recordId: 'malikat:hr28-missing-binding',
      requestedTime: '21:00',
    }
  );

  const before = await hr27Snapshot(f);
  const operationsBefore = await hr28ReadExternalOperations(f);

  const { transitionEmployeeRequest } = await import(
    './core/repositories/employee-requests.js'
  );

  await assert.rejects(
    transitionEmployeeRequest(
      f.core,
      'main',
      'hr28-unavailable-database',
      'execute',
      {
        version: 1,
        note: 'Synthetic missing binding test',
      },
      {
        uid: 'test-admin',
        role: 'owner',
        email: 'admin@example.test',
      },
      {}
    ),
    error =>
      error.code ===
      'core_employee_request:attendance_database_unavailable'
  );

  assert.deepEqual(await hr27Snapshot(f), before);

  assert.deepEqual(
    await hr28ReadExternalOperations(f),
    operationsBefore
  );

  console.log('VERIFIED_HR28_MISSING_BINDING_FAIL_CLOSED');
});

test('HR28 final boundary: historical record without employee document ID remains correctable by matching UID', async t => {
  const f = await fixture(t);

  await hr28SeedExternalPunch(f, {
    id: 'hr28-historical-compatible',
    employeeUid: 'test-uid',
    employeeId: '',
  });

  await hr27SeedApprovedRequest(
    f,
    'hr28-legacy-compatible',
    {
      correctionType: 'update_check_out',
      recordId: 'malikat:hr28-historical-compatible',
      requestedTime: '21:00',
    }
  );

  const result = await hr27ExecuteRequest(
    f,
    'hr28-legacy-compatible'
  );

  assert.equal(result.execution_status, 'completed');

  const updated = await f.attendance.prepare(`
    SELECT *
    FROM attendance_records
    WHERE id = ?
  `).bind('hr28-historical-compatible').first();

  assert.equal(updated.employee_uid, 'test-uid');
  assert.equal(updated.result, 'allowed');

  assert.equal(
    updated.server_time,
    '2026-09-01T18:00:00.000Z'
  );

  console.log('VERIFIED_HR28_HISTORICAL_UID_COMPATIBILITY');
});

async function hr29ReadAudit(f) {
  const result = await f.attendance.prepare(`
    SELECT *
    FROM attendance_operation_events
    ORDER BY rowid
  `).all();

  return result.results;
}

for (const correctionType of [
  'update_check_out',
  'delete_record',
]) {
  test(`HR29 atomic mutation: ${correctionType} rolls back outbox when attendance write affects zero rows`, async t => {
    const f = await fixture(t);

    const punchId = `hr29-punch-${correctionType}`;
    const requestId = `hr29-request-${correctionType}`;

    await hr28SeedExternalPunch(f, {
      id: punchId,
      type: 'check_out',
      result: 'allowed',
    });

    await hr27SeedApprovedRequest(f, requestId, {
      correctionType,
      recordId: `malikat:${punchId}`,
      requestedTime: '21:00',
    });

    // SQLite accepts the UPDATE statement but deliberately
    // performs no attendance mutation.
    f.attendance.database.exec(`
      CREATE TRIGGER hr29_ignore_attendance_mutation
      BEFORE UPDATE ON attendance_records
      WHEN OLD.id = '${punchId}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    const before = await hr27Snapshot(f);
    const operationsBefore =
      await hr28ReadExternalOperations(f);
    const auditBefore = await hr29ReadAudit(f);

    let result = null;
    let failure = null;

    try {
      result = await hr27ExecuteRequest(f, requestId);
    } catch (error) {
      failure = error;
    }

    const after = await hr27Snapshot(f);

    const operationsAfter =
      await hr28ReadExternalOperations(f);

    const auditAfter = await hr29ReadAudit(f);

    const request = await f.core.prepare(`
      SELECT status, execution_status, execution_error
      FROM employee_requests
      WHERE salon_id = 'main' AND id = ?
    `).bind(requestId).first();

    console.log('HR29_CORRECTION_TYPE:', correctionType);

    console.log(
      'HR29_REQUEST_STATE:',
      JSON.stringify(request)
    );

    console.log(
      'HR29_EXECUTION_ERROR:',
      failure?.code || failure?.message || null
    );

    console.log(
      'HR29_EXECUTION_RESULT:',
      JSON.stringify(result)
    );

    console.log(
      'HR29_OUTBOX_BEFORE:',
      operationsBefore.length
    );

    console.log(
      'HR29_OUTBOX_AFTER:',
      operationsAfter.length
    );

    console.log(
      'HR29_AUDIT_BEFORE:',
      auditBefore.length
    );

    console.log(
      'HR29_AUDIT_AFTER:',
      auditAfter.length
    );

    assert.deepEqual(
      after.externalAttendance,
      before.externalAttendance,
      'Ignored SQL mutation must preserve attendance'
    );

    assert.deepEqual(
      operationsAfter,
      operationsBefore,
      'Zero-row mutation must not commit a durable outbox'
    );

    assert.deepEqual(
      auditAfter,
      auditBefore,
      'Zero-row mutation must not commit an attendance audit'
    );

    assert.deepEqual(after, before);

    assert.notEqual(
      request.execution_status,
      'completed'
    );

    assert.ok(
      failure || request.execution_status === 'failed'
    );

    console.log(
      'VERIFIED_HR29_ATOMIC_ROLLBACK:',
      correctionType
    );
  });
}

test('HR29 final recovery: approved request adds exactly one attendance record', async t => {
  const f = await fixture(t);

  await hr27SeedApprovedRequest(
    f,
    'hr29-add-check-in',
    {
      correctionType: 'add_check_in',
      requestedTime: '15:00',
    }
  );

  const result = await hr27ExecuteRequest(
    f,
    'hr29-add-check-in'
  );

  console.log(
    'HR29_ADD_RESULT:',
    JSON.stringify(result)
  );

  assert.equal(result.execution_status, 'completed');

  const records = await f.attendance.prepare(`
    SELECT *
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_in'
      AND result = 'allowed'
  `).all();

  assert.equal(records.results.length, 1);

  assert.equal(
    records.results[0].server_time,
    '2026-09-01T12:00:00.000Z'
  );

  const operations = await f.attendance.prepare(`
    SELECT *
    FROM attendance_operations
    WHERE id = 'core-request:hr29-add-check-in'
  `).all();

  assert.equal(operations.results.length, 1);
  assert.equal(operations.results[0].status, 'completed');

  const before = JSON.parse(
    operations.results[0].before_records
  );

  const after = JSON.parse(
    operations.results[0].after_records
  );

  assert.equal(before.length, 0);
  assert.equal(after.length, 1);

  assert.equal(
    after[0].id,
    records.results[0].id
  );

  console.log('VERIFIED_HR29_SINGLE_INSERT');
});

test('HR29 final recovery: lost acknowledgement after insert does not duplicate attendance', async t => {
  const f = await fixture(t);

  await hr27SeedApprovedRequest(
    f,
    'hr29-lost-insert-ack',
    {
      correctionType: 'add_check_in',
      requestedTime: '15:00',
    }
  );

  const originalBatch =
    f.attendance.batch.bind(f.attendance);

  let injected = false;

  f.attendance.batch = async statements => {
    const result = await originalBatch(statements);

    if (!injected) {
      const saved = await f.attendance.prepare(`
        SELECT id
        FROM attendance_operations
        WHERE id = 'core-request:hr29-lost-insert-ack'
      `).first();

      if (saved) {
        injected = true;

        throw new Error(
          'HR29_SIMULATED_ACK_LOSS_AFTER_INSERT'
        );
      }
    }

    return result;
  };

  let result;

  try {
    result = await hr27ExecuteRequest(
      f,
      'hr29-lost-insert-ack'
    );
  } finally {
    f.attendance.batch = originalBatch;
  }

  assert.equal(injected, true);
  assert.equal(result.execution_status, 'completed');

  const records = await f.attendance.prepare(`
    SELECT *
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_in'
  `).all();

  assert.equal(records.results.length, 1);

  const operations = await f.attendance.prepare(`
    SELECT *
    FROM attendance_operations
    WHERE id = 'core-request:hr29-lost-insert-ack'
  `).all();

  assert.equal(operations.results.length, 1);
  assert.equal(operations.results[0].status, 'completed');

  assert.equal(
    JSON.parse(operations.results[0].after_records).length,
    1
  );

  console.log('VERIFIED_HR29_INSERT_ACK_LOSS_RECOVERED');
  console.log('VERIFIED_HR29_NO_DUPLICATE_ATTENDANCE');
});

test('HR29 final recovery: lost acknowledgement after checkout void reverses entitlement exactly once', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(
    f,
    'hr29-financial-replay'
  );

  assert.equal(await f.balance(), 1440);

  const checkout = await f.attendance.prepare(`
    SELECT id
    FROM attendance_records
    WHERE employee_uid = 'test-uid'
      AND work_date = '2026-09-01'
      AND type = 'check_out'
      AND result = 'allowed'
    LIMIT 1
  `).first();

  assert.ok(checkout?.id);

  await hr27SeedApprovedRequest(
    f,
    'hr29-lost-void-ack',
    {
      correctionType: 'delete_record',
      recordId: `malikat:${checkout.id}`,
    }
  );

  const originalBatch =
    f.attendance.batch.bind(f.attendance);

  let injected = false;

  f.attendance.batch = async statements => {
    const result = await originalBatch(statements);

    if (!injected) {
      const saved = await f.attendance.prepare(`
        SELECT id
        FROM attendance_operations
        WHERE id = 'core-request:hr29-lost-void-ack'
      `).first();

      if (saved) {
        injected = true;

        throw new Error(
          'HR29_SIMULATED_ACK_LOSS_AFTER_VOID'
        );
      }
    }

    return result;
  };

  let result;

  try {
    result = await hr27ExecuteRequest(
      f,
      'hr29-lost-void-ack'
    );
  } finally {
    f.attendance.batch = originalBatch;
  }

  assert.equal(injected, true);
  assert.equal(result.execution_status, 'completed');

  const record = await f.attendance.prepare(`
    SELECT result, rejection_reason
    FROM attendance_records
    WHERE id = ?
  `).bind(checkout.id).first();

  assert.equal(record.result, 'rejected');

  assert.equal(
    record.rejection_reason,
    'voided_by_employee_request'
  );

  assert.equal(await f.balance(), 0);

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  const operations = await f.attendance.prepare(`
    SELECT *
    FROM attendance_operations
    WHERE id = 'core-request:hr29-lost-void-ack'
  `).all();

  assert.equal(operations.results.length, 1);
  assert.equal(operations.results[0].status, 'completed');

  const {
    finishAttendanceOperation,
  } = await import('./attendance-worker.js');

  const ledgerBefore = await f.core.prepare(`
    SELECT *
    FROM employee_comp_time_ledger
    ORDER BY id
  `).all();

  const replay = await finishAttendanceOperation(
    f.attendance,
    f.core,
    'core-request:hr29-lost-void-ack'
  );

  const replayPayload = await replay.json();

  assert.equal(replayPayload.fullyCompleted, true);
  assert.equal(await f.balance(), 0);

  assert.deepEqual(
    await f.core.prepare(`
      SELECT *
      FROM employee_comp_time_ledger
      ORDER BY id
    `).all(),
    ledgerBefore
  );

  assert.equal(
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_reversal'
    ),
    1
  );

  console.log('VERIFIED_HR29_VOID_ACK_LOSS_RECOVERED');
  console.log('VERIFIED_HR29_FINANCIAL_REPLAY_IDEMPOTENT');
});

test('completed weekly rest assignment remains visible in canonical shift resolution', async t => {
  const f = await fixture(t);

  const date = '2026-09-01';
  const employeeId = 'test-employee';

  const {
    resolveEmployeeShift,
    resolveEmployeeShiftsBatch,
  } = await import('./core/repositories/shift-control.js');

  async function resolveBoth() {
    const single = await resolveEmployeeShift(
      f.core,
      'main',
      employeeId,
      date
    );

    const batch = await resolveEmployeeShiftsBatch(
      f.core,
      'main',
      {
        employeeIds: [employeeId],
        dateFrom: date,
        dateTo: date,
      }
    );

    assert.equal(batch.rows.length, 1);

    return {
      single,
      batch: batch.rows[0],
    };
  }

  function assertAssignedShift(shift, label) {
    assert.equal(
      shift.source,
      'weekly_rest_work_assignment',
      label
    );

    assert.equal(Number(shift.active), 1);
    assert.equal(shift.exception_type, 'work');
    assert.equal(shift.start_time, '15:00');
    assert.equal(shift.end_time, '23:00');

    assert.equal(
      shift.weekly_rest_work_assignment_id,
      `assignment-${date}`
    );
  }

  await f.assignment(date);

  const assigned = await resolveBoth();

  assertAssignedShift(
    assigned.single,
    'Assigned single shift'
  );

  assertAssignedShift(
    assigned.batch,
    'Assigned batch shift'
  );

  console.log('VERIFIED_ASSIGNED_SINGLE_AND_BATCH');

  const response = await adminAdjust(f, {
    date,
    checkInTime: '15:00',
    checkOutTime: '23:00',
    operationId: 'completed-shift-resolution',
  });

  assert.equal(
    response.status,
    200,
    await response.clone().text()
  );

  assert.equal(await f.balance(), 1440);

  const assignment = await f.core.prepare(`
    SELECT status
    FROM employee_weekly_rest_work_assignments
    WHERE salon_id = 'main'
      AND employee_id = ?
      AND rest_date = ?
  `).bind(employeeId, date).first();

  assert.equal(assignment.status, 'completed');

  console.log('VERIFIED_COMPLETED_ASSIGNMENT');
  console.log('VERIFIED_ENTITLEMENT_BALANCE:', await f.balance());

  const completed = await resolveBoth();

  console.log('COMPLETED_SINGLE_SOURCE:', completed.single.source);
  console.log('COMPLETED_BATCH_SOURCE:', completed.batch.source);

  assertAssignedShift(
    completed.single,
    'HR02_REGRESSION: completed assignment must remain visible in single shift'
  );

  assertAssignedShift(
    completed.batch,
    'HR02_REGRESSION: completed assignment must remain visible in batch shift'
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);
});

test('cancelled weekly rest assignment is excluded from both shift resolvers', async t => {
  const f = await fixture(t);

  const date = '2026-09-01';
  const employeeId = 'test-employee';

  const {
    resolveEmployeeShift,
    resolveEmployeeShiftsBatch,
  } = await import('./core/repositories/shift-control.js');

  const {
    cancelWeeklyRestWorkAssignment,
  } = await import('./core/repositories/leave-rest-workflows.js');

  await f.assignment(date);

  await cancelWeeklyRestWorkAssignment(
    f.core,
    'main',
    `assignment-${date}`,
    {
      reason: 'Synthetic cancellation test',
    },
    {
      uid: 'test-admin',
    }
  );

  const single = await resolveEmployeeShift(
    f.core,
    'main',
    employeeId,
    date
  );

  const batch = await resolveEmployeeShiftsBatch(
    f.core,
    'main',
    {
      employeeIds: [employeeId],
      dateFrom: date,
      dateTo: date,
    }
  );

  assert.equal(batch.rows.length, 1);

  assert.notEqual(
    single.source,
    'weekly_rest_work_assignment'
  );

  assert.notEqual(
    batch.rows[0].source,
    'weekly_rest_work_assignment'
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('VERIFIED_CANCELLED_ASSIGNMENT_EXCLUDED');
});

async function hr12AssignmentRows(f, date = '2026-09-01') {
  const result = await f.core.prepare(`
    SELECT id, status, reason, start_time, end_time
    FROM employee_weekly_rest_work_assignments
    WHERE salon_id = 'main'
      AND employee_id = 'test-employee'
      AND rest_date = ?
    ORDER BY id
  `).bind(date).all();

  return result.results;
}

async function hr12CreateAssignment(f, id, overrides = {}) {
  const {
    createWeeklyRestWorkAssignment,
  } = await import('./core/repositories/leave-rest-workflows.js');

  return createWeeklyRestWorkAssignment(
    f.core,
    'main',
    {
      id,
      employeeId: 'test-employee',
      restDate: '2026-09-01',
      startTime: '15:00',
      endTime: '23:00',
      reason: 'Synthetic assignment',
      ...overrides,
    },
    { uid: 'test-admin' }
  );
}

test('HR12 assignment integrity: assigned replay preserves original assignment', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);

  const result = await hr12CreateAssignment(
    f,
    before[0].id,
    {
      startTime: before[0].start_time,
      endTime: before[0].end_time,
      reason: before[0].reason
    }
  );

  assert.equal(result.idempotent, true);
  assert.equal(result.assignment.id, 'assignment-2026-09-01');

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('VERIFIED_ASSIGNED_REPLAY_IDEMPOTENT');
});

test('HR12 assignment integrity: completed assignment rejects duplicate creation', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr12-completed');

  const before = await hr12AssignmentRows(f);

  assert.equal(before.length, 1);
  assert.equal(before[0].status, 'completed');

  await assert.rejects(
    hr12CreateAssignment(f, 'duplicate-completed-request'),
    /completed_assignment_exists/
  );

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('VERIFIED_COMPLETED_DUPLICATE_REJECTED');
  console.log('VERIFIED_COMPLETED_BALANCE_PRESERVED');
});

test('HR12 assignment integrity: concurrent assigned replays never duplicate rows', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);

  const results = await Promise.all(
    Array.from(
      { length: 10 },
      () => hr12CreateAssignment(
        f,
        before[0].id,
        {
          startTime: before[0].start_time,
          endTime: before[0].end_time,
          reason: before[0].reason
        }
      )
    )
  );

  for (const result of results) {
    assert.equal(result.idempotent, true);
    assert.equal(result.assignment.id, 'assignment-2026-09-01');
  }

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('VERIFIED_CONCURRENT_REPLAYS_SINGLE_ASSIGNMENT');
});

test('HR12 assignment integrity: reversed completed entitlement cannot create a second assignment', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr12-reversed');

  const deleted = await adminAdjust(f, {
    clearCheckOut: true,
    operationId: 'hr12-reversed-checkout-deletion',
  });

  assert.equal(
    deleted.status,
    200,
    await deleted.clone().text()
  );

  assert.equal(await f.balance(), 0);

  const before = await hr12AssignmentRows(f);

  assert.equal(before.length, 1);
  assert.equal(before[0].status, 'completed');

  await assert.rejects(
    hr12CreateAssignment(f, 'duplicate-reversed-assignment'),
    /completed_assignment_exists/
  );

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

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
    await correctionLedgerCount(
      f,
      'weekly_rest_correction_restore'
    ),
    0
  );

  console.log('VERIFIED_REVERSED_ASSIGNMENT_DUPLICATE_REJECTED');
  console.log('VERIFIED_REVERSAL_LEDGER_PRESERVED');
});

test('HR12 assignment integrity: cancellation preserves history without creating credit', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const {
    cancelWeeklyRestWorkAssignment,
  } = await import('./core/repositories/leave-rest-workflows.js');

  await cancelWeeklyRestWorkAssignment(
    f.core,
    'main',
    'assignment-2026-09-01',
    { reason: 'Synthetic cancellation integrity test' },
    { uid: 'test-admin' }
  );

  const rows = await hr12AssignmentRows(f);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'assignment-2026-09-01');
  assert.equal(rows[0].status, 'cancelled');

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  await f.recover();

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  assert.deepEqual(
    await hr12AssignmentRows(f),
    rows
  );

  console.log('VERIFIED_CANCELLED_ASSIGNMENT_HISTORY_PRESERVED');
});

async function hr12InsertRawAssignment(f, id, status, date = '2026-09-01') {
  return f.core.prepare(`
    INSERT INTO employee_weekly_rest_work_assignments (
      id, salon_id, employee_id,
      rest_date, start_time, end_time,
      reason, schedule_source_type,
      status, created_at, updated_at
    )
    VALUES (
      ?, 'main', 'test-employee',
      ?, '15:00', '23:00',
      'Synthetic constraint test', 'weekly_schedule',
      ?, ?, ?
    )
  `).bind(
    id, date, status, date, date
  ).run();
}

test('HR12 database constraint: completed assignment rejects direct assigned insert', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr12-db-completed');

  const before = await hr12AssignmentRows(f);

  await assert.rejects(
    hr12InsertRawAssignment(
      f,
      'direct-duplicate-assigned',
      'assigned'
    ),
    /UNIQUE constraint failed/i
  );

  assert.deepEqual(await hr12AssignmentRows(f), before);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('VERIFIED_DATABASE_REJECTS_ASSIGNED_AFTER_COMPLETED');
});

test('HR12 database constraint: completed assignment rejects another completed record', async t => {
  const f = await fixture(t);

  await createCorrectionEntitlement(f, 'hr12-db-double-completed');

  const before = await hr12AssignmentRows(f);

  await assert.rejects(
    hr12InsertRawAssignment(
      f,
      'direct-duplicate-completed',
      'completed'
    ),
    /UNIQUE constraint failed/i
  );

  assert.deepEqual(await hr12AssignmentRows(f), before);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('VERIFIED_DATABASE_REJECTS_DOUBLE_COMPLETED');
});

test('HR12 database constraint: assigned record rejects a second completed record', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  await assert.rejects(
    hr12InsertRawAssignment(
      f,
      'direct-completed-conflict',
      'completed'
    ),
    /UNIQUE constraint failed/i
  );

  const rows = await hr12AssignmentRows(f);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'assigned');
  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('VERIFIED_DATABASE_REJECTS_COMPLETED_AFTER_ASSIGNED');
});

test('HR12 database constraint: cancelled history permits a new assignment', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const {
    cancelWeeklyRestWorkAssignment,
  } = await import('./core/repositories/leave-rest-workflows.js');

  await cancelWeeklyRestWorkAssignment(
    f.core,
    'main',
    'assignment-2026-09-01',
    { reason: 'Synthetic database lifecycle test' },
    { uid: 'test-admin' }
  );

  await hr12InsertRawAssignment(
    f,
    'replacement-assignment',
    'assigned'
  );

  const rows = await hr12AssignmentRows(f);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[1].status, 'assigned');

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('VERIFIED_DATABASE_PRESERVES_CANCELLED_HISTORY');
  console.log('VERIFIED_DATABASE_PERMITS_REASSIGNMENT');
});

test('HR12 database constraint: separate dates remain independent', async t => {
  const f = await fixture(t);

  await hr12InsertRawAssignment(
    f,
    'first-date-assignment',
    'assigned',
    '2026-09-01'
  );

  await hr12InsertRawAssignment(
    f,
    'second-date-assignment',
    'assigned',
    '2026-09-02'
  );

  assert.equal((await hr12AssignmentRows(f, '2026-09-01')).length, 1);
  assert.equal((await hr12AssignmentRows(f, '2026-09-02')).length, 1);

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('VERIFIED_DATABASE_PERMITS_INDEPENDENT_DATES');
});

test('HR09C assignment replay conflict rejects changed identity, reason and times', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);
  const original = before[0];

  assert.equal(before.length, 1);

  const exactPayload = {
    startTime: original.start_time,
    endTime: original.end_time,
    reason: original.reason
  };

  const cases = [
    {
      label: 'different assignment ID',
      id: 'another-assignment-id',
      overrides: {}
    },
    {
      label: 'different reason',
      id: original.id,
      overrides: { reason: 'Changed assignment reason' }
    },
    {
      label: 'different start time',
      id: original.id,
      overrides: { startTime: '14:00' }
    },
    {
      label: 'different end time',
      id: original.id,
      overrides: { endTime: '22:00' }
    }
  ];

  for (const item of cases) {
    await assert.rejects(
      hr12CreateAssignment(
        f,
        item.id,
        {
          ...exactPayload,
          ...item.overrides
        }
      ),
      error =>
        error.status === 409 &&
        error.code === 'core_weekly_rest_work:assignment_operation_conflict',
      item.label
    );

    assert.deepEqual(
      await hr12AssignmentRows(f),
      before
    );

    assert.equal(await f.balance(), 0);
    assert.equal(await f.credits(), 0);

    console.log('PASS: rejected ' + item.label);
  }

  const replay = await hr12CreateAssignment(
    f,
    original.id,
    exactPayload
  );

  assert.equal(replay.idempotent, true);
  assert.equal(replay.assignment.id, original.id);

  console.log('PASS: valid replay remains available after conflicts');
});

test('HR09C assignment replay conflict rejects concurrent mismatched requests', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);

  const attempts = await Promise.allSettled(
    Array.from(
      { length: 10 },
      (_, index) => hr12CreateAssignment(
        f,
        `conflicting-assignment-${index}`,
        {
          reason: `Conflicting reason ${index}`
        }
      )
    )
  );

  assert.equal(attempts.length, 10);

  for (const result of attempts) {
    assert.equal(result.status, 'rejected');

    assert.equal(
      result.reason.code,
      'core_weekly_rest_work:assignment_operation_conflict'
    );

    assert.equal(result.reason.status, 409);
  }

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('PASS: all conflicting concurrent requests rejected');
  console.log('PASS: original assignment and entitlement preserved');
});

test('HR09C assignment replay conflict also protects clients without explicit assignment IDs', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);

  const original = before[0];

  const replay = await hr12CreateAssignment(
    f,
    undefined,
    {
      reason: original.reason,
      startTime: original.start_time,
      endTime: original.end_time
    }
  );

  assert.equal(replay.idempotent, true);
  assert.equal(replay.assignment.id, original.id);

  await assert.rejects(
    hr12CreateAssignment(
      f,
      undefined,
      {
        reason: original.reason,
        startTime: '16:00'
      }
    ),
    /assignment_operation_conflict/
  );

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('PASS: existing client payload remains compatible');
});

test('HR09D assignment recovery preserves a pending assignment when attendance DB is unavailable', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);

  const {
    recoverNewWeeklyRestAssignment
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const assignment = await f.core.prepare(`
    SELECT *
      FROM employee_weekly_rest_work_assignments
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = '2026-09-01'
  `).first();

  assert.ok(assignment);
  assert.equal(assignment.salon_id, 'main');

  const result = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    assignment,
    null
  );

  assert.equal(result.status, 'recovery_pending');
  assert.equal(result.fullyCompleted, false);

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('PASS: unavailable attendance preserves assignment');
});

test('HR09D assignment recovery refuses foreign tenant evidence', async t => {
  const f = await fixture(t);

  await f.assignment('2026-09-01');

  const before = await hr12AssignmentRows(f);

  const {
    recoverNewWeeklyRestAssignment
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const assignment = await f.core.prepare(`
    SELECT *
      FROM employee_weekly_rest_work_assignments
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = '2026-09-01'
  `).first();

  assert.ok(assignment);
  assert.equal(assignment.salon_id, 'main');

  await assert.rejects(
    recoverNewWeeklyRestAssignment(
      f.core,
      'another-salon',
      assignment,
      null
    ),
    /weekly_rest_assignment_recovery_invalid_target/
  );

  assert.deepEqual(
    await hr12AssignmentRows(f),
    before
  );

  assert.equal(await f.balance(), 0);

  console.log('PASS: assignment recovery tenant isolation');
});

test('HR09D assignment recovery respects the approved historical cutoff', async t => {
  const f = await fixture(t);

  const {
    recoverNewWeeklyRestAssignment
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const result = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    {
      id: 'historical-review-test',
      salon_id: 'main',
      employee_id: 'test-employee',
      rest_date: '2026-08-30'
    },
    null
  );

  assert.equal(
    result.status,
    'historical_review_required'
  );

  assert.equal(result.fullyCompleted, false);
  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('PASS: historical cutoff preserved');
});

test('HR09D concurrent creation on an unused date cannot create competing assignments', async t => {
  const f = await fixture(t);

  const {
    createScheduleException,
    resolveEmployeeShift
  } = await import('./core/repositories/shift-control.js');

  await createScheduleException(
    f.core,
    'main',
    {
      id: 'hr09d-explicit-weekly-rest',
      employeeId: 'test-employee',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-01',
      exceptionType: 'off',
      enabled: 0,
      status: 'approved',
      note: '[temp_weekly_off:hr09d] Synthetic explicit weekly rest for concurrency test'
    },
    { uid: 'test-admin' }
  );

  const resolved = await resolveEmployeeShift(
    f.core,
    'main',
    'test-employee',
    '2026-09-01'
  );

  console.log(
    'HR09D_RESOLVED_REST:',
    JSON.stringify(resolved)
  );

  const {
    isExplicitWeeklyRestShift
  } = await import('./core/repositories/rest-holiday-compliance.js');

  assert.equal(resolved.source, 'exception');
  assert.equal(resolved.exception_type, 'off');
  assert.notEqual(resolved.operational, false);

  assert.equal(
    isExplicitWeeklyRestShift(resolved),
    true
  );

  assert.equal(
    isExplicitWeeklyRestShift({
      ...resolved,
      note: 'Generic day off'
    }),
    false
  );

  assert.equal(
    isExplicitWeeklyRestShift({
      source: 'none'
    }),
    false
  );

  console.log('PASS: canonical weekly rest fixture verified');

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  assert.equal(
    (await hr12AssignmentRows(f)).length,
    0
  );

  const results = await Promise.allSettled(
    Array.from(
      { length: 10 },
      (_, index) => hr12CreateAssignment(
        f,
        `hr09d-new-assignment-${index}`,
        {
          reason: `HR09D concurrent creation ${index}`
        }
      )
    )
  );

  console.log(
    'HR09D_CREATION_RESULTS:',
    JSON.stringify(results.map(result =>
      result.status === 'fulfilled'
        ? {
            status: result.status,
            assignmentId: result.value.assignment.id
          }
        : {
            status: result.status,
            code: result.reason?.code,
            httpStatus: result.reason?.status,
            message: result.reason?.message
          }
    ))
  );

  const rows = await hr12AssignmentRows(f);

  assert.equal(rows.length, 1);

  const successful = results.filter(
    result => result.status === 'fulfilled'
  );

  assert.equal(successful.length, 1);

  assert.equal(
    successful[0].value.assignment.id,
    rows[0].id
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      assert.equal(result.reason.status, 409);
    }
  }

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  console.log('PASS: concurrent new assignments preserve one winner');
});

test('HR09D1 immediate recovery credits existing complete attendance exactly once', async t => {
  const f = await fixture(t);
  const date = '2026-09-01';

  await f.punch(date, 'check_in', '12:00');
  await f.punch(date, 'check_out', '20:00');

  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  await f.assignment(date);

  const assignment = await f.core.prepare(`
    SELECT *
      FROM employee_weekly_rest_work_assignments
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
  `).bind(date).first();

  assert.ok(assignment);

  const {
    recoverNewWeeklyRestAssignment
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const options = {
    now: new Date('2026-09-02T01:00:00Z')
  };

  const beforePunches = await f.attendance.prepare(`
    SELECT *
      FROM attendance_records
     WHERE employee_uid = 'test-uid'
       AND work_date = ?
     ORDER BY id
  `).bind(date).all();

  const first = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    assignment,
    f.attendance,
    options
  );

  console.log('HR09D1_FIRST_RECOVERY:', JSON.stringify(first));

  assert.equal(first.status, 'completed');
  assert.equal(first.fullyCompleted, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const replay = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    assignment,
    f.attendance,
    options
  );

  assert.equal(replay.status, 'completed');
  assert.equal(replay.fullyCompleted, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const afterPunches = await f.attendance.prepare(`
    SELECT *
      FROM attendance_records
     WHERE employee_uid = 'test-uid'
       AND work_date = ?
     ORDER BY id
  `).bind(date).all();

  assert.deepEqual(
    afterPunches.results,
    beforePunches.results
  );

  console.log('PASS: immediate recovery credited 1440 minutes');
  console.log('PASS: replay creates no duplicate credit');
  console.log('PASS: original punches remain unchanged');
});

test('HR09D1 immediate recovery waits for complete attendance and shift end', async t => {
  const f = await fixture(t);
  const date = '2026-09-01';

  await f.assignment(date);
  await f.punch(date, 'check_in', '12:00');

  const assignment = await f.core.prepare(`
    SELECT *
      FROM employee_weekly_rest_work_assignments
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
  `).bind(date).first();

  const {
    recoverNewWeeklyRestAssignment
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const beforeEnd = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    assignment,
    f.attendance,
    {
      now: new Date('2026-09-01T18:00:00Z')
    }
  );

  assert.equal(beforeEnd.fullyCompleted, false);
  assert.equal(await f.balance(), 0);

  const incomplete = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    assignment,
    f.attendance,
    {
      now: new Date('2026-09-02T01:00:00Z')
    }
  );

  assert.equal(incomplete.fullyCompleted, false);
  assert.equal(await f.balance(), 0);
  assert.equal(await f.credits(), 0);

  await f.punch(date, 'check_out', '20:00');

  const completed = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    assignment,
    f.attendance,
    {
      now: new Date('2026-09-02T01:00:00Z')
    }
  );

  assert.equal(completed.fullyCompleted, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('PASS: no premature entitlement');
  console.log('PASS: complete attendance grants one entitlement');
});

test('HR09D5 completed replay preserves identity and entitlement', async t => {
  const f = await fixture(t);
  const date = '2026-09-01';

  const {
    createScheduleException
  } = await import('./core/repositories/shift-control.js');

  const {
    createWeeklyRestWorkAssignment
  } = await import('./core/repositories/leave-rest-workflows.js');

  const {
    recoverNewWeeklyRestAssignment
  } = await import('./core/repositories/weekly-rest-recovery.js');

  const actor = { uid: 'test-admin' };

  await createScheduleException(
    f.core,
    'main',
    {
      id: 'hr09d5-rest',
      employeeId: 'test-employee',
      dateFrom: date,
      dateTo: date,
      exceptionType: 'off',
      enabled: 0,
      status: 'approved',
      note: '[temp_weekly_off:hr09d5] Synthetic weekly rest'
    },
    actor
  );

  const payload = {
    id: 'hr09d5-operation',
    employeeId: 'test-employee',
    restDate: date,
    startTime: '12:00',
    endTime: '20:00',
    reason: 'Synthetic completed replay test'
  };

  await f.punch(date, 'check_in', '12:00');
  await f.punch(date, 'check_out', '20:00');

  const created = await createWeeklyRestWorkAssignment(
    f.core,
    'main',
    payload,
    actor
  );

  assert.equal(created.idempotent, false);
  assert.equal(created.assignment.id, payload.id);
  assert.equal(created.assignment.assigned_by_uid, actor.uid);

  const recovery = await recoverNewWeeklyRestAssignment(
    f.core,
    'main',
    created.assignment,
    f.attendance,
    {
      now: new Date('2026-09-02T01:00:00Z')
    }
  );

  assert.equal(recovery.fullyCompleted, true);
  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  const before = await f.core.prepare(`
    SELECT *
      FROM employee_weekly_rest_work_assignments
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
     ORDER BY id
  `).bind(date).all();

  assert.equal(before.results.length, 1);
  assert.equal(before.results[0].status, 'completed');

  const replays = await Promise.all(
    Array.from(
      { length: 10 },
      () => createWeeklyRestWorkAssignment(
        f.core,
        'main',
        payload,
        actor
      )
    )
  );

  for (const result of replays) {
    assert.equal(result.idempotent, true);
    assert.equal(result.assignment.id, payload.id);
    assert.equal(result.assignment.status, 'completed');
    assert.deepEqual(result.assignment, before.results[0]);
  }

  const conflicts = [
    { id: 'different-operation' },
    { id: undefined },
    { startTime: '14:00' },
    { endTime: '22:00' },
    { startTime: undefined },
    { endTime: undefined },
    { reason: 'Changed reason' }
  ];

  for (const override of conflicts) {
    await assert.rejects(
      createWeeklyRestWorkAssignment(
        f.core,
        'main',
        { ...payload, ...override },
        actor
      ),
      error => error.status === 409
    );
  }

  await assert.rejects(
    createWeeklyRestWorkAssignment(
      f.core,
      'main',
      payload,
      { uid: 'another-admin' }
    ),
    error =>
      error.status === 409 &&
      error.code === 'core_weekly_rest_work:assignment_operation_conflict'
  );

  await assert.rejects(
    createWeeklyRestWorkAssignment(
      f.core,
      'main',
      payload,
      {}
    ),
    error => error.status === 409
  );

  const after = await f.core.prepare(`
    SELECT *
      FROM employee_weekly_rest_work_assignments
     WHERE salon_id = 'main'
       AND employee_id = 'test-employee'
       AND rest_date = ?
     ORDER BY id
  `).bind(date).all();

  assert.deepEqual(after.results, before.results);

  assert.equal(await f.balance(), 1440);
  assert.equal(await f.credits(), 1);

  console.log('PASS: ten completed operation replays');
  console.log('PASS: conflicting completed operations rejected');
  console.log('PASS: completed replay actor isolation');
  console.log('PASS: original assignment preserved');
  console.log('PASS: exactly one 1440-minute entitlement');
});
