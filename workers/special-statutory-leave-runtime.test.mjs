import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  approveSpecialStatutoryLeave,
  specialStatutoryLeaveRuntimeSupport,
} from './core/repositories/special-statutory-leave.js';
import { leaveDecisionRuntime } from './core/repositories/leaves.js';

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'special-statutory-leave-test-worker',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: { 'script-0.mjs': { type: 'esm', contents: script } },
        },
        env: { CORE_DB: { type: 'd1', id: 'special-statutory-leave-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE employee_employment (
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    start_date TEXT,
    employment_status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (salon_id, employee_id)
  )`).run();

  await db.prepare(`CREATE TABLE employee_leaves (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    leave_type TEXT NOT NULL,
    status TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days_count REAL NOT NULL,
    duration_kind TEXT NOT NULL DEFAULT 'full_day',
    employee_note TEXT,
    hr_note TEXT,
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
    statutory_validated_by_uid TEXT,
    decided_at TEXT,
    decided_by_uid TEXT,
    decided_by_email TEXT,
    decided_by_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();

  await db.prepare(`CREATE TABLE sa_public_holiday_calendar (
    id TEXT PRIMARY KEY,
    holiday_code TEXT NOT NULL,
    holiday_date TEXT NOT NULL,
    status TEXT NOT NULL
  )`).run();

  await db.prepare(`INSERT INTO employee_employment
    (salon_id, employee_id, start_date, employment_status)
    VALUES ('main','emp-1','2023-01-01','active')`).run();

  return { mf, db };
}

const actor = { uid: 'hr-1', email: 'hr@example.com', name: 'HR' };

async function insertLeave(db, row) {
  await db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, leave_type, status, start_date, end_date,
     days_count, duration_kind, created_at, updated_at)
    VALUES (?, 'main', 'emp-1', ?, 'pending', ?, ?, ?, 'full_day', ?, ?)`)
    .bind(
      row.id,
      row.type,
      row.start,
      row.end,
      row.days,
      row.createdAt || '2026-08-01T09:00:00.000Z',
      row.createdAt || '2026-08-01T09:00:00.000Z'
    )
    .run();
  return db.prepare('SELECT * FROM employee_leaves WHERE id=?').bind(row.id).first();
}

test('marriage and bereavement statutory leave approve only with event evidence and never debit annual balance', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const marriage = await insertLeave(db, {
    id: 'marriage-1',
    type: 'marriage',
    start: '2026-09-01',
    end: '2026-09-05',
    days: 5,
  });
  const approved = await approveSpecialStatutoryLeave(
    db,
    'main',
    marriage,
    {
      eventDate: '2026-09-01',
      evidenceReference: 'file:marriage-certificate-1',
    },
    actor
  );
  assert.equal(approved.status, 'approved');
  assert.equal(Number(approved.pay_rate_bps), 10000);
  assert.equal(Number(approved.deduct_from_balance), 0);
  assert.equal(approved.balance_bucket, 'special_statutory');
  assert.equal(approved.legal_basis, 'SA_LABOR_ARTICLE_113');
  assert.equal(approved.documentation_status, 'verified');
  assert.equal(approved.statutory_validation_code, 'MARRIAGE_ART113_VERIFIED');

  const badBereavement = await insertLeave(db, {
    id: 'bereavement-1',
    type: 'bereavement_sibling',
    start: '2026-09-10',
    end: '2026-09-13',
    days: 4,
  });
  await assert.rejects(
    () => approveSpecialStatutoryLeave(
      db,
      'main',
      badBereavement,
      { eventDate: '2026-09-10', evidenceReference: 'file:death-1' },
      actor
    ),
    { code: 'core_special_leave:sibling_bereavement_max_3_days' }
  );
});

test('newborn leave is capped at three days and must stay inside the seven-day statutory window', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const leave = await insertLeave(db, {
    id: 'newborn-1',
    type: 'newborn',
    start: '2026-09-08',
    end: '2026-09-10',
    days: 3,
  });
  await assert.rejects(
    () => approveSpecialStatutoryLeave(
      db,
      'main',
      leave,
      { eventDate: '2026-09-01', evidenceReference: 'file:birth-1' },
      actor
    ),
    { code: 'core_special_leave:newborn_must_be_within_7_days' }
  );
});

test('Hajj leave enforces service, one-time use, 10-15 days, prior-Hajj attestation and verified Eid evidence', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO sa_public_holiday_calendar
    (id, holiday_code, holiday_date, status)
    VALUES ('eid-1','eid_al_adha','2026-05-27','verified')`).run();

  const leave = await insertLeave(db, {
    id: 'hajj-1',
    type: 'hajj',
    start: '2026-05-23',
    end: '2026-06-01',
    days: 10,
    createdAt: '2026-04-01T09:00:00.000Z',
  });
  const approved = await approveSpecialStatutoryLeave(
    db,
    'main',
    leave,
    {
      evidenceReference: 'file:hajj-evidence-1',
      priorHajjAttestedNotPerformed: true,
    },
    actor
  );
  assert.equal(approved.status, 'approved');
  assert.equal(approved.legal_basis, 'SA_LABOR_ARTICLE_114');
  assert.equal(approved.statutory_validation_code, 'HAJJ_ART114_VERIFIED');

  const second = await insertLeave(db, {
    id: 'hajj-2',
    type: 'hajj',
    start: '2027-05-12',
    end: '2027-05-21',
    days: 10,
    createdAt: '2027-04-01T09:00:00.000Z',
  });
  await db.prepare(`INSERT INTO sa_public_holiday_calendar
    (id, holiday_code, holiday_date, status)
    VALUES ('eid-2','eid_al_adha','2027-05-16','verified')`).run();
  await assert.rejects(
    () => approveSpecialStatutoryLeave(
      db,
      'main',
      second,
      { evidenceReference: 'file:hajj-evidence-2', priorHajjAttestedNotPerformed: true },
      actor
    ),
    { code: 'core_special_leave:hajj_once_per_service' }
  );
});

test('paid exam leave requires employer-approved enrollment, actual consecutive exam dates and 15-day notice', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const leave = await insertLeave(db, {
    id: 'exam-1',
    type: 'exam',
    start: '2026-09-20',
    end: '2026-09-21',
    days: 2,
    createdAt: '2026-08-20T09:00:00.000Z',
  });
  const approved = await approveSpecialStatutoryLeave(
    db,
    'main',
    leave,
    {
      evidenceReference: 'file:exam-schedule-1',
      educationEnrollmentApproved: true,
      examYearRepeated: false,
      examDates: ['2026-09-20', '2026-09-21'],
    },
    actor
  );
  assert.equal(approved.status, 'approved');
  assert.equal(approved.legal_basis, 'SA_LABOR_ARTICLE_115');

  const noApproval = await insertLeave(db, {
    id: 'exam-2',
    type: 'exam',
    start: '2026-10-20',
    end: '2026-10-20',
    days: 1,
    createdAt: '2026-09-01T09:00:00.000Z',
  });
  await assert.rejects(
    () => approveSpecialStatutoryLeave(
      db,
      'main',
      noApproval,
      {
        evidenceReference: 'file:exam-schedule-2',
        educationEnrollmentApproved: false,
        examDates: ['2026-10-20'],
      },
      actor
    ),
    { code: 'core_special_leave:exam_requires_annual_or_unpaid_route' }
  );
});

test('complex maternity and widow cases stay fail-closed instead of inferring sensitive eligibility', () => {
  for (const type of ['maternity', 'child_medical_care', 'widow_muslim', 'widow_non_muslim']) {
    assert.equal(specialStatutoryLeaveRuntimeSupport(type), 'specialized_required');
    assert.equal(
      leaveDecisionRuntime({ leave_type: type, status: 'pending' }, 'approved'),
      'statutory_validation_block'
    );
  }
});

test('0048 adds database-level evidence guards for statutory special leave approval', () => {
  const migration = readFileSync(
    'migrations/core/0048_sa_special_statutory_leave_validation.sql',
    'utf8'
  );
  const dispatcher = readFileSync('workers/core/repositories/leaves.js', 'utf8');
  assert.match(migration, /special_statutory_leave_requires_canonical_validation/);
  assert.match(migration, /statutory_evidence_reference/);
  assert.match(dispatcher, /approveSpecialStatutoryLeave/);
  assert.match(dispatcher, /special_statutory_approve/);
});
