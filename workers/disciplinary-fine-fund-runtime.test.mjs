import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  createDisciplinaryFineFundDisbursement,
  getDisciplinaryFineFundBalance,
  listDisciplinaryFineFundLedger,
} from './core/repositories/disciplinary-fine-fund.js';

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlain = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) statements.push(statement);
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
    workers: [{ config: {
      type: 'worker', name: 'disciplinary-fine-fund-test', compatibilityDate: '2026-06-24',
      manifest: {
        mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
        modules: { 'script-0.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } },
      },
      env: { CORE_DB: { type: 'd1', id: 'disciplinary-fine-fund-test' } }, exports: {},
    }, dev: { rootPath: process.cwd() } }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE employee_disciplinary_cases (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    violation_reference TEXT NOT NULL, daily_wage_snapshot_halalas INTEGER NOT NULL,
    fine_halalas INTEGER NOT NULL, decision_reason TEXT NOT NULL, decision_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE employee_payroll_obligations (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    source_type TEXT NOT NULL, source_ref TEXT, labor_deduction_class TEXT
  )`).run();
  await db.prepare(`CREATE TABLE employee_payroll_obligation_installments (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, obligation_id TEXT NOT NULL,
    amount_halalas INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
    applied_payroll_entry_id TEXT, applied_at TEXT
  )`).run();

  const raw = await readFile(
    new URL('../migrations/core/0054_sa_disciplinary_fine_fund_custody.sql', import.meta.url),
    'utf8'
  );
  const sql = raw.replace(/\r/g, '').split('\n')
    .filter((line) => !line.trim().startsWith('--')).join('\n');
  for (const statement of splitMigrationStatements(sql)) await db.prepare(statement).run();

  await db.prepare(`INSERT INTO employee_disciplinary_cases (
    id,salon_id,employee_id,violation_reference,daily_wage_snapshot_halalas,
    fine_halalas,decision_reason,decision_at
  ) VALUES ('case-1','main','emp-1','violation-1',9000,5000,'documented fine','2026-08-20T10:00:00+03:00')`).run();
  await db.prepare(`INSERT INTO employee_payroll_obligations (
    id,salon_id,employee_id,source_type,source_ref,labor_deduction_class
  ) VALUES ('ob-1','main','emp-1','disciplinary_case','case-1','disciplinary_fine')`).run();
  await db.prepare(`INSERT INTO employee_payroll_obligation_installments (
    id,salon_id,obligation_id,amount_halalas,status
  ) VALUES ('inst-1','main','ob-1',5000,'scheduled')`).run();
  return { mf, db };
}

const actor = { uid: 'admin-1', email: 'admin@example.com' };

test('paid disciplinary fine is automatically collected into the restricted worker-benefit fund once', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`UPDATE employee_payroll_obligation_installments
    SET status='applied', applied_payroll_entry_id='pay-1', applied_at='2026-08-28T12:00:00Z'
    WHERE id='inst-1'`).run();

  let state = await getDisciplinaryFineFundBalance(db, 'main');
  assert.equal(state.balanceHalalas, 5000);
  let ledger = await listDisciplinaryFineFundLedger(db, 'main');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].entry_kind, 'collection');
  assert.equal(ledger[0].disciplinary_case_id, 'case-1');
  assert.equal(ledger[0].payroll_entry_id, 'pay-1');

  await db.prepare(`UPDATE employee_payroll_obligation_installments
    SET status='applied' WHERE id='inst-1'`).run();
  state = await getDisciplinaryFineFundBalance(db, 'main');
  ledger = await listDisciplinaryFineFundLedger(db, 'main');
  assert.equal(state.balanceHalalas, 5000);
  assert.equal(ledger.length, 1);
});

test('fine-fund disbursement requires worker-benefit purpose and statutory approval authority', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await db.prepare(`UPDATE employee_payroll_obligation_installments
    SET status='applied', applied_payroll_entry_id='pay-1', applied_at='2026-08-28T12:00:00Z'
    WHERE id='inst-1'`).run();

  await assert.rejects(
    () => createDisciplinaryFineFundDisbursement(db, 'main', {
      operationId: 'benefit-1', amountHalalas: 2000,
      benefitPurpose: 'employee welfare activity',
      beneficiaryDescription: 'all salon employees',
      approvalAuthority: 'owner', approvalReference: 'internal-approval',
    }, actor),
    { code: 'core_discipline:fine_fund_approval_authority_invalid' }
  );

  const result = await createDisciplinaryFineFundDisbursement(db, 'main', {
    operationId: 'benefit-1', amountHalalas: 2000,
    benefitPurpose: 'employee welfare activity',
    beneficiaryDescription: 'all salon employees',
    approvalAuthority: 'ministry', approvalReference: 'ministry-approval-1',
  }, actor);
  assert.equal(result.state.balanceHalalas, 3000);
  assert.equal(result.entry.approval_authority, 'ministry');

  const repeated = await createDisciplinaryFineFundDisbursement(db, 'main', {
    operationId: 'benefit-1', amountHalalas: 2000,
    benefitPurpose: 'employee welfare activity',
    beneficiaryDescription: 'all salon employees',
    approvalAuthority: 'ministry', approvalReference: 'ministry-approval-1',
  }, actor);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.state.balanceHalalas, 3000);

  await assert.rejects(
    () => createDisciplinaryFineFundDisbursement(db, 'main', {
      operationId: 'benefit-overdraw', amountHalalas: 3001,
      benefitPurpose: 'employee welfare activity',
      beneficiaryDescription: 'all salon employees',
      approvalAuthority: 'ministry', approvalReference: 'ministry-approval-2',
    }, actor),
    { code: 'core_discipline:fine_fund_insufficient_balance' }
  );
});
