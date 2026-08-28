import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  cancelPayrollDeductionCourtOverride,
  classifyPayrollObligationDeduction,
  classifyRecurringPayrollDeduction,
  listPayrollDeductionClassificationEvents,
  savePayrollDeductionCourtOverride,
} from './core/repositories/payroll-deduction-compliance.js';

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
      type: 'worker',
      name: 'deduction-classification-runtime-test',
      compatibilityDate: '2026-06-24',
      manifest: {
        mainModule: 'script-0.mjs',
        modulesRoot: process.cwd(),
        modules: { 'script-0.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } },
      },
      env: { CORE_DB: { type: 'd1', id: 'deduction-classification-runtime-test' } },
      exports: {},
    }, dev: { rootPath: process.cwd() } }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE employee_recurring_deductions (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    deduction_kind TEXT NOT NULL, updated_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE employee_payroll_obligations (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, employee_id TEXT NOT NULL,
    recurring_deduction_id TEXT, obligation_kind TEXT NOT NULL,
    source_type TEXT NOT NULL, source_ref TEXT, original_payroll_month TEXT NOT NULL,
    original_amount_halalas INTEGER NOT NULL, remaining_amount_halalas INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', updated_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE employee_payroll_obligation_installments (
    id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, obligation_id TEXT NOT NULL,
    target_payroll_month TEXT NOT NULL, amount_halalas INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
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

  for (const name of [
    '0051_sa_payroll_deduction_compliance.sql',
    '0052_sa_payroll_deduction_classification_audit.sql',
  ]) {
    const raw = await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8');
    const sql = raw.replace(/\r/g, '').split('\n')
      .filter((line) => !line.trim().startsWith('--')).join('\n');
    for (const statement of splitMigrationStatements(sql)) {
      await db.prepare(statement).run();
    }
  }
  return { mf, db };
}

const actor = { uid: 'hr-1', email: 'hr@example.com' };

test('obligation classification requires evidence and writes immutable audit history', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_payroll_obligations (
    id, salon_id, employee_id, recurring_deduction_id, obligation_kind,
    source_type, source_ref, original_payroll_month,
    original_amount_halalas, remaining_amount_halalas, status, updated_at
  ) VALUES ('ob-1','main','emp-1',NULL,'loan','manual','loan-1','2026-08',10000,10000,'scheduled','2026-08-01')`).run();

  await assert.rejects(
    () => classifyPayrollObligationDeduction(db, 'main', 'ob-1', {
      laborDeductionClass: 'employer_loan',
      reason: 'classification',
    }, actor),
    { code: 'core_payroll:deduction_evidence_reference_required' }
  );

  const classified = await classifyPayrollObligationDeduction(db, 'main', 'ob-1', {
    laborDeductionClass: 'employer_loan',
    evidenceReference: 'loan-contract-1',
    reason: 'HR verified employer loan contract',
  }, actor);
  assert.equal(classified.labor_deduction_class, 'employer_loan');
  assert.equal(classified.evidence_reference, 'loan-contract-1');

  const events = await listPayrollDeductionClassificationEvents(db, 'main', { entityId: 'ob-1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].next_class, 'employer_loan');
  assert.equal(events[0].actor_uid, 'hr-1');
});

test('recurring classification propagates only to open linked obligations', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare("INSERT INTO employee_recurring_deductions (id,salon_id,employee_id,deduction_kind,updated_at) VALUES ('rec-1','main','emp-1','private','2026-08-01')").run();
  await db.prepare(`INSERT INTO employee_payroll_obligations (
    id,salon_id,employee_id,recurring_deduction_id,obligation_kind,source_type,source_ref,
    original_payroll_month,original_amount_halalas,remaining_amount_halalas,status,updated_at
  ) VALUES ('ob-rec','main','emp-1','rec-1','private','recurring_deduction','rec-1','2026-08',5000,5000,'scheduled','2026-08-01')`).run();

  const recurring = await classifyRecurringPayrollDeduction(db, 'main', 'rec-1', {
    laborDeductionClass: 'other_with_written_consent',
    writtenConsentReference: 'consent-2026-1',
    reason: 'employee signed monthly deduction consent',
  }, actor);
  assert.equal(recurring.labor_deduction_class, 'other_with_written_consent');

  const obligation = await db.prepare("SELECT * FROM employee_payroll_obligations WHERE id='ob-rec'").first();
  assert.equal(obligation.labor_deduction_class, 'other_with_written_consent');
  assert.equal(obligation.written_consent_reference, 'consent-2026-1');
});

test('canonical attendance wage-adjustment classification cannot be relabeled as discipline', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_payroll_obligations (
    id,salon_id,employee_id,recurring_deduction_id,obligation_kind,source_type,source_ref,
    original_payroll_month,original_amount_halalas,remaining_amount_halalas,status,updated_at
  ) VALUES ('ob-att','main','emp-1',NULL,'attendance_missing_hours','attendance','att-ref','2026-07',5000,5000,'scheduled','2026-08-01')`).run();

  await assert.rejects(
    () => classifyPayrollObligationDeduction(db, 'main', 'ob-att', {
      laborDeductionClass: 'disciplinary_fine',
      evidenceReference: 'fake-fine',
      reason: 'wrong reclassification',
    }, actor),
    { code: 'core_payroll:canonical_attendance_classification_immutable' }
  );
});

test('court override is explicit, idempotent, cancelable and locked after payroll approval', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const created = await savePayrollDeductionCourtOverride(db, 'main', {
    employeeId: 'emp-1',
    payrollMonth: '2026-08',
    maxTotalDeductionBps: 6000,
    laborCourtReference: 'court-order-88',
    reason: 'labor court authorized increased deduction',
  }, actor);
  assert.equal(Number(created.max_total_deduction_bps), 6000);

  const repeated = await savePayrollDeductionCourtOverride(db, 'main', {
    employeeId: 'emp-1',
    payrollMonth: '2026-08',
    maxTotalDeductionBps: 6000,
    laborCourtReference: 'court-order-88',
    reason: 'labor court authorized increased deduction',
  }, actor);
  assert.equal(repeated.idempotent, true);

  const cancelled = await cancelPayrollDeductionCourtOverride(db, 'main', created.id, {
    reason: 'court authorization withdrawn before payroll approval',
  }, actor);
  assert.equal(cancelled.status, 'cancelled');

  await db.prepare("INSERT INTO payroll_entries (id,salon_id,employee_id,payroll_month,status) VALUES ('pay-locked','main','emp-1','2026-09','approved')").run();
  await assert.rejects(
    () => savePayrollDeductionCourtOverride(db, 'main', {
      employeeId: 'emp-1',
      payrollMonth: '2026-09',
      maxTotalDeductionBps: 6000,
      laborCourtReference: 'court-order-99',
      reason: 'too late',
    }, actor),
    { code: 'core_payroll:deduction_override_payroll_locked' }
  );
});
