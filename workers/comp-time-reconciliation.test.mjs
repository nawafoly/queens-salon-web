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
