import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  evaluateSaPayrollDeductionCompliance,
  SA_PAYROLL_DEDUCTION_CLASSES,
} from '../src/helpers/hr/saPayrollDeductionPolicy.js';

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
        name: 'payroll-deduction-compliance-test',
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
        env: { CORE_DB: { type: 'd1', id: 'payroll-deduction-compliance-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE employee_recurring_deductions (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    deduction_kind TEXT NOT NULL
  )`).run();

  await db.prepare(`CREATE TABLE employee_payroll_obligations (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    recurring_deduction_id TEXT,
    obligation_kind TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT,
    original_payroll_month TEXT NOT NULL,
    original_amount_halalas INTEGER NOT NULL,
    remaining_amount_halalas INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
  )`).run();

  await db.prepare(`CREATE TABLE employee_payroll_obligation_installments (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    obligation_id TEXT NOT NULL,
    target_payroll_month TEXT NOT NULL,
    amount_halalas INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
  )`).run();

  await db.prepare(`CREATE TABLE payroll_entries (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    payroll_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    gross_salary_halalas INTEGER NOT NULL DEFAULT 0,
    absence_deduction_halalas INTEGER NOT NULL DEFAULT 0,
    missing_hours_deduction_halalas INTEGER NOT NULL DEFAULT 0,
    insurance_deduction_halalas INTEGER NOT NULL DEFAULT 0,
    manual_deductions_halalas INTEGER NOT NULL DEFAULT 0,
    advances_halalas INTEGER NOT NULL DEFAULT 0,
    deductions_json TEXT NOT NULL DEFAULT '[]'
  )`).run();

  const raw = await readFile(
    new URL('../migrations/core/0051_sa_payroll_deduction_compliance.sql', import.meta.url),
    'utf8'
  );
  const sql = raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  for (const statement of splitMigrationStatements(sql)) {
    await db.prepare(statement).run();
  }

  return { mf, db };
}

async function insertPayroll(db, data = {}) {
  const row = {
    id: data.id || 'pay-1',
    gross: data.gross ?? 100000,
    absence: data.absence ?? 0,
    missing: data.missing ?? 0,
    insurance: data.insurance ?? 0,
    manual: data.manual ?? 0,
    advances: data.advances ?? 0,
    deductions: data.deductions ?? [],
  };
  await db.prepare(`INSERT INTO payroll_entries (
    id, salon_id, employee_id, payroll_month, status,
    gross_salary_halalas, absence_deduction_halalas,
    missing_hours_deduction_halalas, insurance_deduction_halalas,
    manual_deductions_halalas, advances_halalas, deductions_json
  ) VALUES (?, 'main', 'emp-1', '2026-08', 'draft', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      row.id,
      row.gross,
      row.absence,
      row.missing,
      row.insurance,
      row.manual,
      row.advances,
      JSON.stringify(row.deductions)
    )
    .run();
  return row.id;
}

async function approve(db, id = 'pay-1') {
  return db.prepare("UPDATE payroll_entries SET status='approved' WHERE id=?")
    .bind(id)
    .run();
}

test('pure policy separates time-not-worked from protected deductions and enforces 10/25/50 caps', () => {
  const compliant = evaluateSaPayrollDeductionCompliance({
    capBaseHalalas: 100000,
    insuranceDeductionHalalas: 5000,
    salaryAdvanceDeductionHalalas: 10000,
    items: [
      {
        id: 'consent-1',
        amountHalalas: 30000,
        laborDeductionClass: SA_PAYROLL_DEDUCTION_CLASSES.otherWithWrittenConsent,
        writtenConsentReference: 'consent-file-1',
      },
      {
        id: 'attendance-old-month',
        amountHalalas: 5000,
        laborDeductionClass: SA_PAYROLL_DEDUCTION_CLASSES.deferredTimeNotWorkedAdjustment,
        sourceRef: 'attendance:2026-07',
        trusted: true,
      },
    ],
  });
  assert.equal(compliant.compliant, true);
  assert.equal(compliant.employerLoanHalalas, 10000);
  assert.equal(compliant.totalProtectedHalalas, 50000);

  const loanViolation = evaluateSaPayrollDeductionCompliance({
    capBaseHalalas: 100000,
    salaryAdvanceDeductionHalalas: 10001,
  });
  assert.match(
    loanViolation.issues.map((item) => item.code).join(','),
    /employer_loan_deduction_cap_exceeded/
  );

  const judicialViolation = evaluateSaPayrollDeductionCompliance({
    capBaseHalalas: 100000,
    items: [{
      id: 'court-1',
      amountHalalas: 25001,
      laborDeductionClass: SA_PAYROLL_DEDUCTION_CLASSES.judicialDebt,
      courtOrderReference: 'judgment-1',
    }],
  });
  assert.match(
    judicialViolation.issues.map((item) => item.code).join(','),
    /judicial_deduction_cap_exceeded/
  );
});

test('D1 blocks employer-loan recovery above ten percent of wage due', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertPayroll(db, { advances: 10001 });
  await assert.rejects(() => approve(db), /payroll_employer_loan_deduction_cap_exceeded/);
});

test('D1 blocks judicial debt above quarter wage without a judgment-specific higher cap', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertPayroll(db, {
    manual: 25001,
    deductions: [{
      id: 'court-1',
      amountHalalas: 25001,
      laborDeductionClass: 'judicial_debt',
      courtOrderReference: 'judgment-1',
    }],
  });
  await assert.rejects(() => approve(db), /payroll_judicial_deduction_cap_exceeded/);
});

test('D1 blocks aggregate protected deductions above half of wage due', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertPayroll(db, {
    insurance: 10000,
    advances: 10000,
    manual: 30001,
    deductions: [{
      id: 'consent-1',
      amountHalalas: 30001,
      laborDeductionClass: 'other_with_written_consent',
      writtenConsentReference: 'consent-1',
    }],
  });
  await assert.rejects(() => approve(db), /payroll_aggregate_deduction_cap_exceeded/);
});

test('D1 blocks unclassified and unsupported manual deductions at approval', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertPayroll(db, {
    manual: 1000,
    deductions: [{ id: 'mystery', amountHalalas: 1000 }],
  });
  await assert.rejects(() => approve(db), /payroll_deduction_legal_class_required/);
});

test('D1 requires written consent reference for private-right deductions outside statutory exceptions', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await insertPayroll(db, {
    manual: 1000,
    deductions: [{
      id: 'private-1',
      amountHalalas: 1000,
      laborDeductionClass: 'other_with_written_consent',
    }],
  });
  await assert.rejects(() => approve(db), /payroll_written_consent_reference_required/);
});

test('canonical attendance deferral is classified as time-not-worked adjustment, not a disciplinary fine', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_payroll_obligations (
    id, salon_id, employee_id, recurring_deduction_id, obligation_kind,
    source_type, source_ref, original_payroll_month,
    original_amount_halalas, remaining_amount_halalas, status
  ) VALUES (
    'ob-att','main','emp-1',NULL,'attendance_missing_hours',
    'attendance','attendance_missing_hours:emp-1:2026-07','2026-07',
    5000,5000,'scheduled'
  )`).run();

  const obligation = await db.prepare(
    "SELECT labor_deduction_class, evidence_reference FROM employee_payroll_obligations WHERE id='ob-att'"
  ).first();
  assert.equal(obligation.labor_deduction_class, 'deferred_time_not_worked_adjustment');
  assert.match(obligation.evidence_reference, /attendance_missing_hours/);
});

test('labor-court aggregate override is auditable and only one active override exists per month', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_payroll_deduction_overrides (
    id, salon_id, employee_id, payroll_month, max_total_deduction_bps,
    labor_court_reference, reason, status, created_at
  ) VALUES ('override-1','main','emp-1','2026-08',6000,'court-1','court order','active','2026-08-28T00:00:00Z')`).run();

  await assert.rejects(
    () => db.prepare(`INSERT INTO employee_payroll_deduction_overrides (
      id, salon_id, employee_id, payroll_month, max_total_deduction_bps,
      labor_court_reference, reason, status, created_at
    ) VALUES ('override-2','main','emp-1','2026-08',7000,'court-2','second','active','2026-08-28T01:00:00Z')`).run()
  );

  await db.prepare("UPDATE employee_payroll_deduction_overrides SET status='cancelled' WHERE id='override-1'").run();
  await db.prepare(`INSERT INTO employee_payroll_deduction_overrides (
    id, salon_id, employee_id, payroll_month, max_total_deduction_bps,
    labor_court_reference, reason, status, created_at
  ) VALUES ('override-2','main','emp-1','2026-08',7000,'court-2','replacement','active','2026-08-28T01:00:00Z')`).run();

  const active = await db.prepare(
    "SELECT COUNT(*) AS count FROM employee_payroll_deduction_overrides WHERE status='active'"
  ).first();
  assert.equal(Number(active.count), 1);
});
