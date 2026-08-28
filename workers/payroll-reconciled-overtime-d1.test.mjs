import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlain = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) {
      statements.push(statement);
    }
  };
  const triggerPattern = /CREATE\s+TRIGGER\b[\s\S]*?^\s*END\s*;/gim;
  let cursor = 0;
  for (const match of sql.matchAll(triggerPattern)) {
    pushPlain(sql.slice(cursor, match.index));
    statements.push(match[0].trim());
    cursor = match.index + match[0].length;
  }
  pushPlain(sql.slice(cursor));
  return statements;
}

async function setup() {
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'payroll-overtime-authority-test',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: {
            'script-0.mjs': {
              type: 'esm',
              contents: 'export default { fetch(){ return new Response("ok") } }',
            },
          },
        },
        env: { CORE_DB: { type: 'd1', id: 'payroll-overtime-authority-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE payroll_entries (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    payroll_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    overtime_enabled INTEGER NOT NULL DEFAULT 0,
    financial_overtime_hours REAL NOT NULL DEFAULT 0,
    overtime_multiplier REAL NOT NULL DEFAULT 1.5,
    overtime_actual_hourly_halalas INTEGER NOT NULL DEFAULT 1125,
    overtime_basic_hourly_halalas INTEGER NOT NULL DEFAULT 1042,
    overtime_value_halalas INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`).run();

  await db.prepare(`CREATE TABLE employee_overtime_records (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    date_key TEXT NOT NULL,
    payroll_month TEXT,
    payroll_entry_id TEXT,
    payout_status TEXT NOT NULL DEFAULT 'approved',
    updated_at TEXT NOT NULL,
    compensation_mode TEXT NOT NULL DEFAULT 'cash_overtime',
    policy_version TEXT,
    actual_worked_minutes INTEGER NOT NULL DEFAULT 0,
    attendance_reconciled_at TEXT,
    financial_status TEXT NOT NULL DEFAULT 'pending_attendance',
    attendance_evidence_json TEXT NOT NULL DEFAULT '{}',
    reconciliation_note TEXT,
    reconciled_by_uid TEXT,
    comp_time_ledger_entry_id TEXT
  )`).run();

  for (const name of [
    '0045_payroll_reconciled_overtime_authority.sql',
    '0046_payroll_reconciled_overtime_approval_guards.sql',
  ]) {
    const raw = await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8');
    const sql = raw
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of splitMigrationStatements(sql)) {
      await db.prepare(statement).run();
    }
  }

  return { mf, db };
}

async function insertCashOvertime(db, id = 'ot-1', minutes = 120) {
  await db.prepare(`INSERT INTO employee_overtime_records (
      id, salon_id, request_id, employee_id, date_key, payroll_month,
      payroll_entry_id, payout_status, updated_at, compensation_mode,
      policy_version, actual_worked_minutes, attendance_reconciled_at,
      financial_status, attendance_evidence_json
    ) VALUES (?, 'main', ?, 'emp-1', '2026-08-20', '2026-08',
      NULL, 'approved', '2026-08-20T20:00:00Z', 'cash_overtime',
      'sa-labor-2025-amended-v1', ?, '2026-08-20T20:00:00Z',
      'ready_for_payroll', '{}')`)
    .bind(id, `req-${id}`, minutes)
    .run();
}

test('payroll approval atomically includes reconciled cash overtime and reopen releases it', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertCashOvertime(db);

  await db.prepare(`INSERT INTO payroll_entries (
      id, salon_id, employee_id, payroll_month, status,
      overtime_enabled, financial_overtime_hours,
      overtime_multiplier, overtime_actual_hourly_halalas,
      overtime_basic_hourly_halalas, overtime_value_halalas, updated_at
    ) VALUES ('pay-1','main','emp-1','2026-08','draft',1,2,1.5,1125,1042,3292,'2026-08-28T00:00:00Z')`)
    .run();

  const draft = await db.prepare("SELECT * FROM payroll_entries WHERE id='pay-1'").first();
  assert.equal(Number(draft.reconciled_overtime_minutes), 120);
  assert.match(String(draft.overtime_source_snapshot_json), /ot-1/);

  await db.prepare("UPDATE payroll_entries SET status='approved', updated_at='2026-08-28T01:00:00Z' WHERE id='pay-1'").run();
  const included = await db.prepare("SELECT financial_status, payroll_entry_id FROM employee_overtime_records WHERE id='ot-1'").first();
  assert.equal(included.financial_status, 'included');
  assert.equal(included.payroll_entry_id, 'pay-1');

  await db.prepare("UPDATE payroll_entries SET status='draft', updated_at='2026-08-28T02:00:00Z' WHERE id='pay-1'").run();
  const released = await db.prepare("SELECT financial_status, payroll_entry_id FROM employee_overtime_records WHERE id='ot-1'").first();
  assert.equal(released.financial_status, 'ready_for_payroll');
  assert.equal(released.payroll_entry_id, null);
});

test('proven reconciled overtime is not extinguished by an internal overtime-enabled toggle', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertCashOvertime(db, 'ot-toggle-off', 120);

  await db.prepare(`INSERT INTO payroll_entries (
      id, salon_id, employee_id, payroll_month, status,
      overtime_enabled, financial_overtime_hours,
      overtime_multiplier, overtime_actual_hourly_halalas,
      overtime_basic_hourly_halalas, overtime_value_halalas, updated_at
    ) VALUES ('pay-toggle-off','main','emp-1','2026-08','draft',0,2,1.5,1125,1042,3292,'2026-08-28T00:00:00Z')`)
    .run();

  await db.prepare("UPDATE payroll_entries SET status='approved' WHERE id='pay-toggle-off'").run();
  const included = await db.prepare("SELECT financial_status, payroll_entry_id FROM employee_overtime_records WHERE id='ot-toggle-off'").first();
  assert.equal(included.financial_status, 'included');
  assert.equal(included.payroll_entry_id, 'pay-toggle-off');
});

test('approval fails when financial hours do not match reconciled minutes', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertCashOvertime(db, 'ot-mismatch', 120);
  await db.prepare(`INSERT INTO payroll_entries (
      id, salon_id, employee_id, payroll_month, status,
      overtime_enabled, financial_overtime_hours,
      overtime_multiplier, overtime_actual_hourly_halalas,
      overtime_basic_hourly_halalas, overtime_value_halalas, updated_at
    ) VALUES ('pay-mismatch','main','emp-1','2026-08','draft',1,1,1.5,1125,1042,3292,'2026-08-28T00:00:00Z')`)
    .run();
  await assert.rejects(
    () => db.prepare("UPDATE payroll_entries SET status='approved' WHERE id='pay-mismatch'").run(),
    /payroll_reconciled_overtime_hours_mismatch/
  );
});

test('approval fails when statutory overtime value does not match reconciled minutes and wage evidence', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertCashOvertime(db, 'ot-value-mismatch', 120);
  await db.prepare(`INSERT INTO payroll_entries (
      id, salon_id, employee_id, payroll_month, status,
      overtime_enabled, financial_overtime_hours,
      overtime_multiplier, overtime_actual_hourly_halalas,
      overtime_basic_hourly_halalas, overtime_value_halalas, updated_at
    ) VALUES ('pay-value-mismatch','main','emp-1','2026-08','draft',1,2,1.5,1125,1042,3000,'2026-08-28T00:00:00Z')`)
    .run();
  await assert.rejects(
    () => db.prepare("UPDATE payroll_entries SET status='approved' WHERE id='pay-value-mismatch'").run(),
    /payroll_reconciled_overtime_value_formula_mismatch/
  );
});

test('comp-time can never be linked to payroll or marked included', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await assert.rejects(
    () => db.prepare(`INSERT INTO employee_overtime_records (
        id, salon_id, request_id, employee_id, date_key, payroll_month,
        payroll_entry_id, payout_status, updated_at, compensation_mode,
        policy_version, actual_worked_minutes, attendance_reconciled_at,
        financial_status, attendance_evidence_json, comp_time_ledger_entry_id
      ) VALUES ('ot-comp','main','req-comp','emp-1','2026-08-20','2026-08',
        'pay-1','approved','2026-08-20T20:00:00Z','comp_time',
        'sa-labor-2025-amended-v1',120,'2026-08-20T20:00:00Z',
        'included','{}','ledger-1')`).run()
  );

  const forbidden = await db.prepare(
    "SELECT COUNT(*) AS count FROM employee_overtime_records WHERE id='ot-comp'"
  ).first();
  assert.equal(Number(forbidden.count), 0);
});
