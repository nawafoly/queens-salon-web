import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  creditCompTime,
  debitCompTime,
  getCompTimeBalanceState,
} from './core/repositories/comp-time.js';
import {
  overtimeAttendanceOverlapMinutes,
} from './core/repositories/overtime-reconciliation.js';
import {
  confirmWeeklyRestDue,
  consumeWeeklyRestDue,
  setHistoricalWeeklyRestOpeningBalance,
  WEEKLY_REST_MINUTES,
} from './core/repositories/weekly-rest-entitlements.js';

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'comp-time-test-worker',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: { 'script-0.mjs': { type: 'esm', contents: script } },
        },
        env: { CORE_DB: { type: 'd1', id: 'comp-time-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');
  await db.prepare(`CREATE TABLE employee_comp_time_ledger (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    entitlement_type TEXT NOT NULL,
    entry_kind TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    source_minutes INTEGER NOT NULL DEFAULT 0,
    balance_before_minutes INTEGER NOT NULL,
    balance_after_minutes INTEGER NOT NULL,
    conversion_ratio_milli INTEGER,
    source_date TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT,
    employee_consent_at TEXT,
    employee_consent_reference TEXT,
    expires_at TEXT,
    policy_version TEXT NOT NULL,
    note TEXT,
    created_by_uid TEXT,
    created_by_email TEXT,
    created_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE UNIQUE INDEX idx_test_comp_source
    ON employee_comp_time_ledger(salon_id, entitlement_type, source_type, source_id, entry_kind)
    WHERE source_id IS NOT NULL`).run();
  await db.prepare(`CREATE UNIQUE INDEX idx_test_historical_weekly_rest_opening_once
    ON employee_comp_time_ledger(
      salon_id,
      employee_id,
      entitlement_type,
      source_type,
      entry_kind
    )
    WHERE entitlement_type = 'weekly_rest_due'
      AND source_type = 'historical_opening_balance'
      AND entry_kind = 'credit'`).run();
  await db.prepare(`CREATE TABLE employee_comp_time_balances (
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    entitlement_type TEXT NOT NULL,
    balance_minutes INTEGER NOT NULL DEFAULT 0,
    last_entry_id TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (salon_id, employee_id, entitlement_type)
  )`).run();
  await db.prepare(`CREATE TABLE employee_employment (
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    start_date TEXT,
    PRIMARY KEY (salon_id, employee_id)
  )`).run();
  await db.prepare(`INSERT INTO employee_employment
    (salon_id, employee_id, start_date)
    VALUES ('main', 'emp-1', '2025-01-01')`).run();

  await db.prepare(`CREATE TABLE employee_weekly_rest_events (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    rest_date TEXT NOT NULL,
    attendance_evidence_json TEXT NOT NULL DEFAULT '{}',
    worked_minutes INTEGER NOT NULL DEFAULT 0,
    restoration_status TEXT NOT NULL DEFAULT 'pending_review',
    substitute_rest_minutes INTEGER NOT NULL DEFAULT 0,
    entitlement_ledger_entry_id TEXT,
    restoration_confirmed_at TEXT,
    restoration_confirmed_by_uid TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    updated_at TEXT NOT NULL
  )`).run();
  return { mf, db };
}

const actor = { uid: 'hr-1', email: 'hr@example.com' };

test('comp-time ledger is bucketed, idempotent and refuses overdraft', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const credit = await creditCompTime(db, 'main', {
    employeeId: 'emp-1',
    entitlementType: 'overtime_comp',
    minutes: 180,
    sourceMinutes: 120,
    conversionRatioMilli: 1500,
    sourceType: 'overtime_record',
    sourceId: 'ot-1',
  }, actor);
  assert.equal(credit.state.balanceMinutes, 180);
  assert.equal(credit.idempotent, false);

  const repeated = await creditCompTime(db, 'main', {
    employeeId: 'emp-1',
    entitlementType: 'overtime_comp',
    minutes: 180,
    sourceMinutes: 120,
    conversionRatioMilli: 1500,
    sourceType: 'overtime_record',
    sourceId: 'ot-1',
  }, actor);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.state.balanceMinutes, 180);

  const debit = await debitCompTime(db, 'main', {
    employeeId: 'emp-1',
    entitlementType: 'overtime_comp',
    minutes: 60,
    sourceType: 'leave_request',
    sourceId: 'leave-1',
  }, actor);
  assert.equal(debit.state.balanceMinutes, 120);

  await assert.rejects(
    () => debitCompTime(db, 'main', {
      employeeId: 'emp-1',
      entitlementType: 'overtime_comp',
      minutes: 121,
      sourceType: 'leave_request',
      sourceId: 'leave-2',
    }, actor),
    { code: 'core_comp_time:insufficient_balance' }
  );
});

test('weekly-rest due creates and consumes a separate 24-hour entitlement block', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_weekly_rest_events
    (id, salon_id, employee_id, rest_date, attendance_evidence_json,
     worked_minutes, restoration_status, substitute_rest_minutes,
     entitlement_ledger_entry_id, status, updated_at)
    VALUES ('rest-1','main','emp-1','2026-08-21',?,480,'pending_review',0,NULL,'open','2026-08-21T20:00:00Z')`)
    .bind(JSON.stringify({ complete: true, workedMinutes: 480 }))
    .run();

  const confirmed = await confirmWeeklyRestDue(db, 'main', 'rest-1', actor);
  assert.equal(confirmed.state.balanceMinutes, WEEKLY_REST_MINUTES);
  assert.equal(confirmed.event.restoration_status, 'owed');
  assert.equal(Number(confirmed.event.substitute_rest_minutes), 1440);

  const consumed = await consumeWeeklyRestDue(db, 'main', {
    employeeId: 'emp-1',
    sourceType: 'weekly_rest_substitute_use',
    sourceId: 'leave-rest-1',
  }, actor);
  assert.equal(consumed.state.balanceMinutes, 0);

  await assert.rejects(
    () => consumeWeeklyRestDue(db, 'main', {
      employeeId: 'emp-1',
      sourceType: 'weekly_rest_substitute_use',
      sourceId: 'leave-rest-2',
      minutes: 480,
    }, actor),
    { code: 'core_weekly_rest:must_consume_24_consecutive_hours' }
  );
});

test('historical weekly-rest opening balance is audited, idempotent and consumable', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const opening =
    await setHistoricalWeeklyRestOpeningBalance(
      db,
      'main',
      'emp-1',
      {
        days: 3,
        effectiveDate: '2026-08-30',
        sourceReference: 'legacy-weekly-rest-emp-1',
        reason: 'confirmed legacy weekly-rest balance before Core',
      },
      actor
    );

  assert.equal(opening.idempotent, false);
  assert.equal(opening.state.balanceMinutes, 4320);
  assert.equal(opening.entry.entry_kind, 'credit');
  assert.equal(
    opening.entry.entitlement_type,
    'weekly_rest_due'
  );
  assert.equal(
    opening.entry.source_type,
    'historical_opening_balance'
  );
  assert.equal(
    opening.entry.source_date,
    '2026-08-30'
  );
  assert.equal(opening.entry.created_by_uid, actor.uid);
  assert.equal(
    opening.entry.created_by_email,
    actor.email
  );

  const repeated =
    await setHistoricalWeeklyRestOpeningBalance(
      db,
      'main',
      'emp-1',
      {
        days: 3,
        effectiveDate: '2026-08-30',
        sourceReference: 'legacy-weekly-rest-emp-1',
        reason: 'confirmed legacy weekly-rest balance before Core',
      },
      actor
    );

  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.state.balanceMinutes, 4320);

  await assert.rejects(
    () =>
      setHistoricalWeeklyRestOpeningBalance(
        db,
        'main',
        'emp-1',
        {
          days: 3,
          effectiveDate: '2026-08-30',
          sourceReference: 'second-opening',
          reason: 'second historical opening attempt',
        },
        actor
      ),
    {
      code:
        'core_weekly_rest:historical_opening_balance_already_exists',
    }
  );

  const consumed = await consumeWeeklyRestDue(
    db,
    'main',
    {
      employeeId: 'emp-1',
      sourceDate: '2026-08-31',
      sourceType: 'weekly_rest_substitute_use',
      sourceId: 'leave-rest-2026-08-31',
    },
    actor
  );

  assert.equal(consumed.state.balanceMinutes, 2880);

  const rows = await db.prepare(
    `SELECT *
       FROM employee_comp_time_ledger
      WHERE salon_id = 'main'
        AND employee_id = 'emp-1'
        AND entitlement_type = 'weekly_rest_due'
      ORDER BY created_at ASC, id ASC`
  ).all();

  assert.equal(rows.results.length, 2);
  assert.equal(rows.results[0].balance_before_minutes, 0);
  assert.equal(rows.results[0].balance_after_minutes, 4320);
  assert.equal(rows.results[1].balance_before_minutes, 4320);
  assert.equal(rows.results[1].balance_after_minutes, 2880);
});

test('overtime attendance counts only actual work inside the authorized window and caps at approval', () => {
  const attendance = {
    complete: true,
    intervals: [
      {
        checkInAt: '2026-08-20T14:45:00.000Z',
        checkOutAt: '2026-08-20T17:15:00.000Z',
      },
    ],
  };
  assert.equal(
    overtimeAttendanceOverlapMinutes(attendance, '2026-08-20', '18:00', '20:00', 120),
    120
  );
  assert.equal(
    overtimeAttendanceOverlapMinutes(attendance, '2026-08-20', '18:00', '20:00', 90),
    90
  );
  assert.equal(
    overtimeAttendanceOverlapMinutes({ ...attendance, complete: false }, '2026-08-20', '18:00', '20:00', 120),
    0
  );
});

test('0044 stores attendance evidence and a concurrency-safe entitlement projection', () => {
  const migration = readFileSync('migrations/core/0044_sa_overtime_reconciliation_comp_time.sql', 'utf8');
  const runtime = readFileSync('workers/core/repositories/overtime-reconciliation.js', 'utf8');
  assert.match(migration, /employee_comp_time_balances/);
  assert.match(migration, /attendance_evidence_json/);
  assert.match(runtime, /financial_status = 'ready_for_payroll'/);
  assert.match(runtime, /financial_status = 'comp_time_credited'/);
  assert.match(runtime, /calculateCompensatoryLeaveMinutes/);
  assert.match(runtime, /compensation_mode = 'cash_overtime'/);
});


test('0060 enforces one historical weekly-rest opening credit per employee', () => {
  const migration = readFileSync(
    'migrations/core/0060_weekly_rest_historical_opening_guard.sql',
    'utf8'
  );

  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS/
  );

  assert.match(
    migration,
    /salon_id[\s\S]*employee_id[\s\S]*entitlement_type[\s\S]*source_type[\s\S]*entry_kind/
  );

  assert.match(
    migration,
    /entitlement_type = 'weekly_rest_due'/
  );

  assert.match(
    migration,
    /source_type = 'historical_opening_balance'/
  );

  assert.match(
    migration,
    /entry_kind = 'credit'/
  );
});
