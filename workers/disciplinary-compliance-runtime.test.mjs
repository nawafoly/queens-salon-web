import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  cancelDisciplinaryCase,
  createDisciplinaryCase,
} from './core/repositories/disciplinary-compliance.js';

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
    workers: [{ config: {
      type: 'worker', name: 'disciplinary-compliance-test', compatibilityDate: '2026-06-24',
      manifest: {
        mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
        modules: { 'script-0.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } },
      },
      env: { CORE_DB: { type: 'd1', id: 'disciplinary-compliance-test' } }, exports: {},
    }, dev: { rootPath: process.cwd() } }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE employee_recurring_deductions (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    deduction_kind TEXT NOT NULL, updated_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE employee_payroll_obligations (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    recurring_deduction_id TEXT, obligation_kind TEXT NOT NULL, source_type TEXT NOT NULL,
    source_ref TEXT, original_payroll_month TEXT NOT NULL,
    original_amount_halalas INTEGER NOT NULL, remaining_amount_halalas INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', reason TEXT, note TEXT,
    created_by_uid TEXT, created_by_email TEXT, cancelled_by_uid TEXT,
    cancelled_by_email TEXT, cancelled_at TEXT, cancellation_reason TEXT,
    created_at TEXT, updated_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE employee_payroll_obligation_installments (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, obligation_id TEXT NOT NULL,
    sequence_no INTEGER NOT NULL, target_payroll_month TEXT NOT NULL,
    amount_halalas INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
    decision_reason TEXT, note TEXT, created_by_uid TEXT, created_by_email TEXT,
    created_at TEXT, updated_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE payroll_entries (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    payroll_month TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    gross_salary_halalas INTEGER NOT NULL DEFAULT 0,
    absence_deduction_halalas INTEGER NOT NULL DEFAULT 0,
    missing_hours_deduction_halalas INTEGER NOT NULL DEFAULT 0,
    insurance_deduction_halalas INTEGER NOT NULL DEFAULT 0,
    manual_deductions_halalas INTEGER NOT NULL DEFAULT 0,
    advances_halalas INTEGER NOT NULL DEFAULT 0,
    deductions_json TEXT NOT NULL DEFAULT '[]'
  )`).run();
  await db.prepare(`CREATE TABLE employee_employment (
    salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    employment_status TEXT NOT NULL,
    base_salary_halalas INTEGER NOT NULL,
    housing_allowance_halalas INTEGER NOT NULL DEFAULT 0,
    transportation_allowance_halalas INTEGER NOT NULL DEFAULT 0,
    other_allowances_halalas INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (salon_id, employee_id)
  )`).run();
  await db.prepare("INSERT INTO employee_employment VALUES ('main','emp-1','active',250000,0,0,20000)").run();

  for (const name of [
    '0051_sa_payroll_deduction_compliance.sql',
    '0052_sa_payroll_deduction_classification_audit.sql',
    '0053_sa_disciplinary_fine_runtime.sql',
  ]) {
    const raw = await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8');
    const sql = raw.replace(/\r/g, '').split('\n')
      .filter((line) => !line.trim().startsWith('--')).join('\n');
    for (const statement of splitMigrationStatements(sql)) await db.prepare(statement).run();
  }
  return { mf, db };
}

const actor = { uid: 'hr-1', email: 'hr@example.com' };
const base = {
  employeeId: 'emp-1',
  discoveredDate: '2026-08-01',
  allegationNotifiedAt: '2026-08-05T09:00:00+03:00',
  investigationCompletedAt: '2026-08-10T12:00:00+03:00',
  defenseMinutesReference: 'minutes-1',
  decisionAt: '2026-08-12T10:00:00+03:00',
  employeeNotificationReference: 'notice-1',
  decisionReason: 'substantiated violation after documented investigation',
};

test('disciplinary fine creates one classified payroll obligation from actual-wage daily rate', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const row = await createDisciplinaryCase(db, 'main', {
    ...base,
    violationReference: 'violation-1',
    penaltyType: 'fine',
    fineHalalas: 9000,
    targetPayrollMonth: '2026-08',
  }, actor);
  assert.equal(row.penalty_type, 'fine');
  assert.equal(Number(row.daily_wage_snapshot_halalas), 9000);
  assert.ok(row.payroll_obligation_id);

  const obligation = await db.prepare(
    'SELECT * FROM employee_payroll_obligations WHERE id = ?'
  ).bind(row.payroll_obligation_id).first();
  assert.equal(obligation.labor_deduction_class, 'disciplinary_fine');
  assert.equal(obligation.evidence_reference, row.id);
  assert.equal(Number(obligation.original_amount_halalas), 9000);
});

test('single disciplinary fine cannot exceed five days actual wage', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await assert.rejects(
    () => createDisciplinaryCase(db, 'main', {
      ...base,
      violationReference: 'violation-too-large',
      penaltyType: 'fine',
      fineHalalas: 45001,
      targetPayrollMonth: '2026-08',
    }, actor),
    { code: 'core_discipline:single_violation_fine_limit_exceeded' }
  );
});

test('monthly disciplinary fine collection cannot exceed five days wage', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await createDisciplinaryCase(db, 'main', {
    ...base,
    violationReference: 'violation-a',
    penaltyType: 'fine',
    fineHalalas: 40000,
    targetPayrollMonth: '2026-08',
  }, actor);

  await assert.rejects(
    () => createDisciplinaryCase(db, 'main', {
      ...base,
      violationReference: 'violation-b',
      defenseMinutesReference: 'minutes-2',
      employeeNotificationReference: 'notice-2',
      penaltyType: 'fine',
      fineHalalas: 5001,
      targetPayrollMonth: '2026-08',
    }, actor),
    { code: 'core_discipline:monthly_fine_limit_exceeded' }
  );
});

test('disciplinary statutory timelines fail closed', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await assert.rejects(
    () => createDisciplinaryCase(db, 'main', {
      ...base,
      violationReference: 'late-accusation',
      allegationNotifiedAt: '2026-09-05T09:00:00+03:00',
      investigationCompletedAt: '2026-09-06T09:00:00+03:00',
      decisionAt: '2026-09-07T09:00:00+03:00',
      penaltyType: 'warning',
    }, actor),
    /disciplinary_case_statutory_timeline_invalid/
  );
});

test('same violation is idempotent and never receives a second penalty', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const first = await createDisciplinaryCase(db, 'main', {
    ...base,
    violationReference: 'same-violation',
    penaltyType: 'warning',
  }, actor);
  const second = await createDisciplinaryCase(db, 'main', {
    ...base,
    violationReference: 'same-violation',
    penaltyType: 'fine',
    fineHalalas: 5000,
    targetPayrollMonth: '2026-08',
  }, actor);
  assert.equal(second.id, first.id);
  assert.equal(second.penalty_type, 'warning');
  assert.equal(second.idempotent, true);
});

test('unlocked disciplinary fine can be cancelled with its obligation but locked payroll requires correction flow', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const row = await createDisciplinaryCase(db, 'main', {
    ...base,
    violationReference: 'cancel-1',
    penaltyType: 'fine',
    fineHalalas: 5000,
    targetPayrollMonth: '2026-08',
  }, actor);
  const cancelled = await cancelDisciplinaryCase(db, 'main', row.id, {
    reason: 'decision revoked before payroll lock',
  }, actor);
  assert.equal(cancelled.status, 'cancelled');
  const obligation = await db.prepare('SELECT status FROM employee_payroll_obligations WHERE id=?')
    .bind(row.payroll_obligation_id).first();
  assert.equal(obligation.status, 'cancelled');

  const lockedCase = await createDisciplinaryCase(db, 'main', {
    ...base,
    violationReference: 'cancel-locked',
    penaltyType: 'fine',
    fineHalalas: 5000,
    targetPayrollMonth: '2026-09',
  }, actor);
  await db.prepare("INSERT INTO payroll_entries (id,salon_id,employee_id,payroll_month,status) VALUES ('pay-locked','main','emp-1','2026-09','approved')").run();
  await assert.rejects(
    () => cancelDisciplinaryCase(db, 'main', lockedCase.id, { reason: 'late cancellation' }, actor),
    { code: 'core_discipline:locked_payroll_requires_carryover_correction' }
  );
});
