import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  approveSensitiveFamilyLeave,
  reconcileMaternityBirth,
  sensitiveFamilyLeaveRuntimeSupport,
} from './core/repositories/sensitive-family-leave.js';

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlain = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) {
      const executableSql = statement.replace(/^\s*--.*$/gm, '').trim();
      if (executableSql) statements.push(statement);
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

async function applyMigration(db, path) {
  const sql = readFileSync(path, 'utf8');
  for (const statement of splitMigrationStatements(sql)) {
    await db.prepare(statement).run();
  }
}

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'sensitive-family-leave-test-worker',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: { 'script-0.mjs': { type: 'esm', contents: script } },
        },
        env: { CORE_DB: { type: 'd1', id: 'sensitive-family-leave-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE employee_leaves (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    employee_uid TEXT,
    employee_name TEXT,
    employee_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    leave_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days_count REAL NOT NULL DEFAULT 0,
    duration_kind TEXT NOT NULL DEFAULT 'full_day',
    employee_note TEXT,
    hr_note TEXT,
    decided_at TEXT,
    decided_by_uid TEXT,
    decided_by_email TEXT,
    decided_by_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deduct_from_balance INTEGER NOT NULL DEFAULT 0,
    affects_payroll INTEGER NOT NULL DEFAULT 0,
    policy_version TEXT,
    pay_rate_bps INTEGER,
    balance_bucket TEXT,
    legal_basis TEXT,
    documentation_status TEXT NOT NULL DEFAULT 'required',
    statutory_review_required INTEGER NOT NULL DEFAULT 0,
    statutory_event_date TEXT,
    statutory_evidence_reference TEXT,
    statutory_evidence_json TEXT NOT NULL DEFAULT '{}',
    statutory_validation_code TEXT,
    statutory_validated_at TEXT,
    statutory_validated_by_uid TEXT
  )`).run();

  await db.prepare(`CREATE TABLE payroll_entries (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    payroll_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
  )`).run();

  await applyMigration(
    db,
    'migrations/core/0050_sa_sensitive_family_leave_runtime.sql'
  );

  return { mf, db };
}

const actor = { uid: 'hr-1', email: 'hr@example.com', name: 'HR' };

async function insertLeave(db, row) {
  await db.prepare(`INSERT INTO employee_leaves (
    id, salon_id, employee_id, employee_uid, employee_name, employee_email,
    status, leave_type, start_date, end_date, days_count, duration_kind,
    created_at, updated_at
  ) VALUES (?, 'main', 'emp-1', 'uid-1', 'Employee', 'employee@example.com',
            'pending', ?, ?, ?, ?, 'full_day', ?, ?)`)
    .bind(
      row.id,
      row.type,
      row.start,
      row.end,
      row.days,
      row.createdAt || '2026-08-20T09:00:00.000Z',
      row.createdAt || '2026-08-20T09:00:00.000Z'
    )
    .run();
  return db.prepare('SELECT * FROM employee_leaves WHERE id=?').bind(row.id).first();
}

async function maternityPending(db, id = 'mat-1') {
  const leave = await insertLeave(db, {
    id,
    type: 'maternity',
    start: '2026-09-01',
    end: '2026-11-23',
    days: 84,
  });
  return approveSensitiveFamilyLeave(
    db,
    'main',
    leave,
    {
      expectedBirthDate: '2026-09-29',
      expectedDateEvidenceReference: `medical:${id}`,
    },
    actor
  );
}

test('maternity is a 12-week paid episode and payroll waits for birth reconciliation', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const approved = await maternityPending(db);
  assert.equal(approved.status, 'approved');
  assert.equal(Number(approved.days_count), 84);
  assert.equal(Number(approved.pay_rate_bps), 10000);
  assert.equal(Number(approved.deduct_from_balance), 0);
  assert.equal(approved.legal_basis, 'SA_LABOR_ARTICLE_151');
  assert.equal(approved.maternityEpisode.birth_reconciliation_status, 'pending');

  await db.prepare(`INSERT INTO payroll_entries
    (id, salon_id, employee_id, payroll_month, status)
    VALUES ('pay-1','main','emp-1','2026-09','draft')`).run();

  await assert.rejects(
    () => db.prepare(`UPDATE payroll_entries SET status='approved' WHERE id='pay-1'`).run(),
    /maternity_birth_reconciliation_required_before_payroll_approval/
  );

  const reconciled = await reconcileMaternityBirth(
    db,
    'main',
    approved.id,
    {
      actualBirthDate: '2026-09-29',
      birthEvidenceReference: 'birth:mat-1',
    },
    actor
  );
  assert.equal(reconciled.maternityEpisode.birth_reconciliation_status, 'reconciled');
  assert.equal(reconciled.leave.statutory_event_date, '2026-09-29');
  assert.equal(reconciled.unpaidCompletion, null);

  await db.prepare(`UPDATE payroll_entries SET status='approved' WHERE id='pay-1'`).run();
  const payroll = await db.prepare(`SELECT status FROM payroll_entries WHERE id='pay-1'`).first();
  assert.equal(payroll.status, 'approved');
});

test('delayed childbirth creates only the mandatory unpaid completion after the 84 paid days', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const leave = await insertLeave(db, {
    id: 'mat-delay',
    type: 'maternity',
    start: '2026-09-01',
    end: '2026-11-23',
    days: 84,
  });
  const approved = await approveSensitiveFamilyLeave(
    db,
    'main',
    leave,
    {
      expectedBirthDate: '2026-09-29',
      expectedDateEvidenceReference: 'medical:mat-delay',
      actualBirthDate: '2026-10-20',
      birthEvidenceReference: 'birth:mat-delay',
    },
    actor
  );

  assert.equal(approved.maternityEpisode.birth_reconciliation_status, 'reconciled');
  assert.ok(approved.unpaidCompletion);
  assert.equal(approved.unpaidCompletion.start_date, '2026-11-24');
  assert.equal(approved.unpaidCompletion.end_date, '2026-11-30');
  assert.equal(Number(approved.unpaidCompletion.days_count), 7);
  assert.equal(Number(approved.unpaidCompletion.affects_payroll), 1);
  assert.equal(Number(approved.unpaidCompletion.pay_rate_bps), 0);
  assert.equal(approved.unpaidCompletion.statutory_linked_leave_id, 'mat-delay');
});

test('child medical care requires a reconciled maternity episode and continuous-companion evidence', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const maternity = await maternityPending(db, 'mat-care');
  await reconcileMaternityBirth(
    db,
    'main',
    maternity.id,
    {
      actualBirthDate: '2026-09-29',
      birthEvidenceReference: 'birth:mat-care',
    },
    actor
  );

  const care = await insertLeave(db, {
    id: 'care-1',
    type: 'child_medical_care',
    start: '2026-11-24',
    end: '2026-12-23',
    days: 30,
  });
  const approved = await approveSensitiveFamilyLeave(
    db,
    'main',
    care,
    {
      maternityLeaveId: 'mat-care',
      continuousCompanionRequired: true,
      evidenceReference: 'medical:child-care-1',
    },
    actor
  );
  assert.equal(approved.status, 'approved');
  assert.equal(approved.statutory_linked_leave_id, 'mat-care');
  assert.equal(approved.statutory_validation_code, 'CHILD_MEDICAL_CARE_ART151_VERIFIED');
  assert.equal(Number(approved.pay_rate_bps), 10000);

  const noEvidence = await insertLeave(db, {
    id: 'care-2',
    type: 'child_medical_care',
    start: '2026-11-24',
    end: '2026-11-25',
    days: 2,
  });
  await assert.rejects(
    () => approveSensitiveFamilyLeave(
      db,
      'main',
      noEvidence,
      {
        maternityLeaveId: 'mat-care',
        evidenceReference: 'medical:child-care-2',
      },
      actor
    ),
    { code: 'core_family_leave:continuous_companion_evidence_required' }
  );
});

test('widow routes are explicit evidence choices and never infer religion from employee data', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const nonMuslim = await insertLeave(db, {
    id: 'widow-non-muslim',
    type: 'widow_non_muslim',
    start: '2026-10-01',
    end: '2026-10-15',
    days: 15,
  });
  const approvedNonMuslim = await approveSensitiveFamilyLeave(
    db,
    'main',
    nonMuslim,
    {
      deathDate: '2026-10-01',
      evidenceReference: 'death:spouse-1',
    },
    actor
  );
  assert.equal(approvedNonMuslim.status, 'approved');
  assert.equal(approvedNonMuslim.statutory_validation_code, 'WIDOW_NON_MUSLIM_ART160_VERIFIED');
  assert.equal(JSON.parse(approvedNonMuslim.statutory_evidence_json).religionInferred, false);

  const muslim = await insertLeave(db, {
    id: 'widow-muslim',
    type: 'widow_muslim',
    start: '2026-10-01',
    end: '2026-10-10',
    days: 10,
  });
  const approvedMuslim = await approveSensitiveFamilyLeave(
    db,
    'main',
    muslim,
    {
      deathDate: '2026-10-01',
      verifiedStatutoryEndDate: '2027-02-10',
      evidenceReference: 'death:spouse-2',
      calendarCalculationReference: 'verified-iddah-calendar:case-2',
    },
    actor
  );
  assert.equal(approvedMuslim.status, 'approved');
  assert.equal(approvedMuslim.end_date, '2027-02-10');
  assert.equal(approvedMuslim.statutory_end_date, '2027-02-10');
  const evidence = JSON.parse(approvedMuslim.statutory_evidence_json);
  assert.equal(evidence.religionInferred, false);
  assert.equal(evidence.calendarCalculationReference, 'verified-iddah-calendar:case-2');
});

test('0050 adds family-evidence guards without storing inferred sensitive profile fields', () => {
  const migration = readFileSync(
    'migrations/core/0050_sa_sensitive_family_leave_runtime.sql',
    'utf8'
  );
  const runtime = readFileSync(
    'workers/core/repositories/sensitive-family-leave.js',
    'utf8'
  );
  assert.match(migration, /employee_maternity_leave_episodes/);
  assert.match(migration, /maternity_birth_reconciliation_required_before_payroll_approval/);
  assert.match(migration, /child_medical_care_requires_reconciled_maternity_link/);
  assert.doesNotMatch(migration, /ADD COLUMN religion/i);
  assert.doesNotMatch(migration, /ADD COLUMN pregnancy/i);
  assert.match(runtime, /religionInferred: false/);
  assert.equal(sensitiveFamilyLeaveRuntimeSupport('maternity'), 'deterministic_evidence');
  assert.equal(sensitiveFamilyLeaveRuntimeSupport('widow_muslim'), 'deterministic_evidence');
});
