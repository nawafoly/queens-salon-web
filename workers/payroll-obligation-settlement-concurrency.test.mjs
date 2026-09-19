import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  payrollObligationPaidStatements,
  payrollObligationPaymentReversalStatements,
} from './core/repositories/payroll-obligations.js';

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlainStatements = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) {
      statements.push(statement);
    }
  };
  const triggerPattern = /CREATE\s+TRIGGER\b[\s\S]*?^\s*END\s*;/gim;
  let cursor = 0;
  for (const match of sql.matchAll(triggerPattern)) {
    pushPlainStatements(sql.slice(cursor, match.index));
    statements.push(match[0].trim());
    cursor = match.index + match[0].length;
  }
  pushPlainStatements(sql.slice(cursor));
  return statements;
}

async function setup() {
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'payroll-obligation-concurrency-test',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: {
            'script-0.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' },
          },
        },
        env: { CORE_DB: { type: 'd1', id: 'core-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');
  for (const name of [
    '0030_employee_payroll_obligations.sql',
    '0037_payroll_obligation_settlement_concurrency.sql',
  ]) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
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

async function seedObligation(db) {
  const createdAt = '2026-08-01T00:00:00.000Z';
  await db.prepare(`INSERT INTO employee_payroll_obligations
    (id, salon_id, employee_id, recurring_deduction_id, obligation_kind, source_type, source_ref,
     original_payroll_month, original_amount_halalas, remaining_amount_halalas, status, reason, note,
     created_by_uid, created_by_email, created_at, updated_at)
    VALUES ('obl-1', 'main', 'emp-1', NULL, 'attendance_missing_hours', 'manual', 'source-1',
            '2026-08', 2000, 2000, 'scheduled', 'test', NULL,
            'tester', 'tester@example.com', ?, ?)`)
    .bind(createdAt, createdAt)
    .run();
  await db.prepare(`INSERT INTO employee_payroll_obligation_installments
    (id, salon_id, obligation_id, sequence_no, target_payroll_month, amount_halalas, status,
     decision_reason, note, created_by_uid, created_by_email, created_at, updated_at)
    VALUES ('inst-1', 'main', 'obl-1', 1, '2026-08', 1000, 'scheduled',
            'test', NULL, 'tester', 'tester@example.com', ?, ?)`)
    .bind(createdAt, createdAt)
    .run();
}

function payrollEntry() {
  return {
    id: 'payroll-1',
    employee_id: 'emp-1',
    payroll_month: '2026-08',
    deductions_json: JSON.stringify([
      {
        kind: 'payroll_obligation',
        sourceType: 'payroll_obligation',
        obligationId: 'obl-1',
        installmentId: 'inst-1',
        amountHalalas: 1000,
      },
    ]),
  };
}

async function runStatements(db, statements) {
  await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)));
}

async function readState(db) {
  const obligation = await db.prepare(
    `SELECT remaining_amount_halalas, status, updated_at
       FROM employee_payroll_obligations
      WHERE salon_id = 'main' AND id = 'obl-1'`
  ).first();
  const installment = await db.prepare(
    `SELECT status, applied_payroll_entry_id, applied_at
       FROM employee_payroll_obligation_installments
      WHERE salon_id = 'main' AND id = 'inst-1'`
  ).first();
  return { obligation, installment };
}

test('losing concurrent payroll-payment batch cannot decrement obligation twice', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await seedObligation(db);

  // Both requests read the installment while it is still scheduled and build
  // their D1 batches before either request commits.
  const winner = await payrollObligationPaidStatements(
    db, 'main', payrollEntry(), '2026-08-27T08:20:00.100Z'
  );
  const loser = await payrollObligationPaidStatements(
    db, 'main', payrollEntry(), '2026-08-27T08:20:00.200Z'
  );

  await runStatements(db, winner);
  let state = await readState(db);
  assert.equal(state.installment.status, 'applied');
  assert.equal(state.obligation.remaining_amount_halalas, 1000);
  assert.equal(state.obligation.status, 'partially_settled');

  await runStatements(db, loser);
  state = await readState(db);
  assert.equal(state.installment.status, 'applied');
  assert.equal(state.installment.applied_at, '2026-08-27T08:20:00.100Z');
  assert.equal(state.obligation.remaining_amount_halalas, 1000);
  assert.equal(state.obligation.status, 'partially_settled');
  assert.equal(state.obligation.updated_at, '2026-08-27T08:20:00.100Z');
});

test('same-timestamp duplicate settlement is also idempotent', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await seedObligation(db);
  const paidAt = '2026-08-27T08:20:01.000Z';

  const first = await payrollObligationPaidStatements(db, 'main', payrollEntry(), paidAt);
  const duplicate = await payrollObligationPaidStatements(db, 'main', payrollEntry(), paidAt);
  await runStatements(db, first);
  await runStatements(db, duplicate);

  const state = await readState(db);
  assert.equal(state.obligation.remaining_amount_halalas, 1000);
  assert.equal(state.obligation.status, 'partially_settled');
  assert.equal(state.installment.status, 'applied');
});


test('losing concurrent payment reversal cannot restore obligation twice', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await seedObligation(db);

  const paidAt = '2026-08-27T08:20:02.000Z';
  const payment = await payrollObligationPaidStatements(
    db,
    'main',
    payrollEntry(),
    paidAt
  );
  await runStatements(db, payment);

  let state = await readState(db);
  assert.equal(state.obligation.remaining_amount_halalas, 1000);
  assert.equal(state.installment.status, 'applied');

  const winner = await payrollObligationPaymentReversalStatements(
    db,
    'main',
    payrollEntry(),
    '2026-08-27T08:21:00.100Z'
  );
  const loser = await payrollObligationPaymentReversalStatements(
    db,
    'main',
    payrollEntry(),
    '2026-08-27T08:21:00.200Z'
  );

  await runStatements(db, winner);
  state = await readState(db);
  assert.equal(state.obligation.remaining_amount_halalas, 2000);
  assert.equal(state.obligation.status, 'scheduled');
  assert.equal(state.installment.status, 'scheduled');

  await runStatements(db, loser);
  state = await readState(db);
  assert.equal(state.obligation.remaining_amount_halalas, 2000);
  assert.equal(state.obligation.status, 'scheduled');
  assert.equal(
    state.obligation.updated_at,
    '2026-08-27T08:21:00.100Z'
  );
  assert.equal(state.installment.status, 'scheduled');
});

test('same-timestamp duplicate payment reversal is idempotent', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await seedObligation(db);

  const payment = await payrollObligationPaidStatements(
    db,
    'main',
    payrollEntry(),
    '2026-08-27T08:22:00.000Z'
  );
  await runStatements(db, payment);

  const reversedAt = '2026-08-27T08:23:00.000Z';
  const first = await payrollObligationPaymentReversalStatements(
    db,
    'main',
    payrollEntry(),
    reversedAt
  );
  const duplicate = await payrollObligationPaymentReversalStatements(
    db,
    'main',
    payrollEntry(),
    reversedAt
  );

  await runStatements(db, first);
  await runStatements(db, duplicate);

  const state = await readState(db);
  assert.equal(state.obligation.remaining_amount_halalas, 2000);
  assert.equal(state.obligation.status, 'scheduled');
  assert.equal(state.obligation.updated_at, reversedAt);
  assert.equal(state.installment.status, 'scheduled');
});
