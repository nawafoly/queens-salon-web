import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  approveTimeEntitlementLeave,
  cancelTimeEntitlementLeave,
} from './core/repositories/leave-time-entitlements.js';
import { leaveDecisionRuntime } from './core/repositories/leaves.js';

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'leave-time-entitlement-test-worker',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: { 'script-0.mjs': { type: 'esm', contents: script } },
        },
        env: { CORE_DB: { type: 'd1', id: 'leave-time-entitlement-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');

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
  await db.prepare(`CREATE UNIQUE INDEX idx_test_leave_time_source
    ON employee_comp_time_ledger(salon_id, entitlement_type, source_type, source_id, entry_kind)
    WHERE source_id IS NOT NULL`).run();

  await db.prepare(`CREATE TABLE employee_leaves (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    leave_type TEXT NOT NULL,
    status TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    employee_note TEXT,
    hr_note TEXT,
    balance_bucket TEXT,
    documentation_status TEXT NOT NULL DEFAULT 'required',
    statutory_review_required INTEGER NOT NULL DEFAULT 0,
    deduct_from_balance INTEGER NOT NULL DEFAULT 0,
    affects_payroll INTEGER NOT NULL DEFAULT 0,
    entitlement_source_type TEXT,
    entitlement_source_id TEXT,
    entitlement_minutes_requested INTEGER NOT NULL DEFAULT 0,
    entitlement_minutes_applied INTEGER NOT NULL DEFAULT 0,
    entitlement_ledger_entry_id TEXT,
    decided_at TEXT,
    decided_by_uid TEXT,
    decided_by_email TEXT,
    decided_by_name TEXT,
    updated_at TEXT NOT NULL
  )`).run();

  return { mf, db };
}

const actor = {
  uid: 'hr-1',
  email: 'hr@example.com',
  name: 'HR',
};

async function balance(db, type) {
  return db.prepare(`SELECT * FROM employee_comp_time_balances
    WHERE salon_id='main' AND employee_id='emp-1' AND entitlement_type=?`)
    .bind(type)
    .first();
}

test('overtime comp leave debits its own ledger atomically and cancellation restores it', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_comp_time_balances
    (salon_id, employee_id, entitlement_type, balance_minutes, last_entry_id, version, updated_at)
    VALUES ('main','emp-1','overtime_comp',180,NULL,0,'2026-08-28T00:00:00Z')`).run();
  await db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, leave_type, status, start_date, end_date,
     balance_bucket, entitlement_minutes_requested, updated_at)
    VALUES ('leave-ot','main','emp-1','overtime_comp_time_use','pending',
            '2026-08-30','2026-08-30','overtime_comp',120,'2026-08-28T00:00:00Z')`).run();

  const pending = await db.prepare(`SELECT * FROM employee_leaves WHERE id='leave-ot'`).first();
  const approved = await approveTimeEntitlementLeave(
    db,
    'main',
    pending,
    { hrNote: 'approved comp use' },
    actor
  );
  assert.equal(approved.leave.status, 'approved');
  assert.equal(Number(approved.leave.entitlement_minutes_applied), 120);
  assert.ok(approved.leave.entitlement_ledger_entry_id);
  assert.equal(Number((await balance(db, 'overtime_comp')).balance_minutes), 60);

  const debit = await db.prepare(`SELECT * FROM employee_comp_time_ledger
    WHERE source_type='leave_request' AND source_id='leave-ot' AND entry_kind='debit'`).first();
  assert.equal(Number(debit.minutes), 120);

  const cancelled = await cancelTimeEntitlementLeave(
    db,
    'main',
    approved.leave,
    { hrNote: 'cancelled after approval' },
    actor
  );
  assert.equal(cancelled.leave.status, 'rejected');
  assert.equal(Number((await balance(db, 'overtime_comp')).balance_minutes), 180);
  assert.equal(cancelled.reversalLedgerEntry.entry_kind, 'reversal');
  assert.equal(cancelled.reversalLedgerEntry.source_id, debit.id);
});

test('weekly-rest substitute consumes exactly one separate 24-hour block', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_comp_time_balances
    (salon_id, employee_id, entitlement_type, balance_minutes, last_entry_id, version, updated_at)
    VALUES ('main','emp-1','weekly_rest_due',1440,NULL,0,'2026-08-28T00:00:00Z')`).run();
  await db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, leave_type, status, start_date, end_date,
     balance_bucket, entitlement_minutes_requested, updated_at)
    VALUES ('leave-rest','main','emp-1','weekly_rest_substitute_use','pending',
            '2026-08-31','2026-08-31','weekly_rest_due',1440,'2026-08-28T00:00:00Z')`).run();

  const pending = await db.prepare(`SELECT * FROM employee_leaves WHERE id='leave-rest'`).first();
  const approved = await approveTimeEntitlementLeave(db, 'main', pending, {}, actor);
  assert.equal(approved.leave.status, 'approved');
  assert.equal(Number(approved.leave.entitlement_minutes_applied), 1440);
  assert.equal(Number((await balance(db, 'weekly_rest_due')).balance_minutes), 0);
});

test('dispatcher routes entitlement approval and approved cancellation through canonical runtime', () => {
  assert.equal(
    leaveDecisionRuntime({ leave_type: 'overtime_comp_time_use', status: 'pending' }, 'approved'),
    'time_entitlement_approve'
  );
  assert.equal(
    leaveDecisionRuntime({ leave_type: 'weekly_rest_substitute_use', status: 'pending' }, 'approved'),
    'time_entitlement_approve'
  );
  assert.equal(
    leaveDecisionRuntime({ leave_type: 'overtime_comp_time_use', status: 'approved' }, 'rejected'),
    'time_entitlement_cancel'
  );
});

test('0047 keeps annual leave isolated and requires ledger evidence for entitlement leave approval', () => {
  const migration = readFileSync(
    'migrations/core/0047_leave_time_entitlement_consumption.sql',
    'utf8'
  );
  const dispatcher = readFileSync('workers/core/repositories/leaves.js', 'utf8');
  assert.match(migration, /entitlement_minutes_requested/);
  assert.match(migration, /overtime_comp_leave_requires_entitlement_ledger/);
  assert.match(migration, /weekly_rest_leave_requires_24h_entitlement_ledger/);
  assert.match(dispatcher, /approveTimeEntitlementLeave/);
  assert.match(dispatcher, /cancelTimeEntitlementLeave/);
  assert.doesNotMatch(dispatcher, /entitlement_consumption_block/);
});
