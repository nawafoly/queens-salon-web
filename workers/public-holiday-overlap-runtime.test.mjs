import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  annualLeavePublicHolidayExtension,
} from './core/repositories/public-holiday-overlap.js';

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [{
      config: {
        type: 'worker',
        name: 'public-holiday-overlap-test-worker',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'script-0.mjs',
          modulesRoot: process.cwd(),
          modules: { 'script-0.mjs': { type: 'esm', contents: script } },
        },
        env: { CORE_DB: { type: 'd1', id: 'public-holiday-overlap-test' } },
        exports: {},
      },
      dev: { rootPath: process.cwd() },
    }],
  });
  const db = await mf.getD1Database('CORE_DB');

  await db.prepare(`CREATE TABLE sa_public_holiday_calendar (
    id TEXT PRIMARY KEY,
    holiday_code TEXT NOT NULL,
    holiday_date TEXT NOT NULL,
    holiday_name_ar TEXT NOT NULL,
    holiday_name_en TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    calendar_year INTEGER NOT NULL,
    verified_at TEXT,
    status TEXT NOT NULL DEFAULT 'verified',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (holiday_date, holiday_code)
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
    annual_original_end_date TEXT,
    public_holiday_overlap_days INTEGER NOT NULL DEFAULT 0,
    public_holiday_overlap_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  )`).run();

  return { mf, db };
}

test('verified National Day extends annual leave without consuming another annual entitlement day', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, leave_type, status, start_date, end_date,
     days_count, duration_kind, updated_at)
    VALUES ('annual-1','main','emp-1','annual','pending','2026-09-21','2026-09-25',
            5,'full_day','2026-08-28T00:00:00Z')`).run();

  const leave = await db.prepare(`SELECT * FROM employee_leaves WHERE id='annual-1'`).first();
  const result = await annualLeavePublicHolidayExtension(db, 'main', leave);

  assert.equal(result.originalEndDate, '2026-09-25');
  assert.equal(result.effectiveEndDate, '2026-09-26');
  assert.equal(result.overlapDays, 1);
  assert.equal(result.holidays.some((row) => row.code === 'national_day'), true);
  assert.equal(result.leave.end_date, '2026-09-26');
  assert.equal(result.leave.annual_original_end_date, '2026-09-25');
  assert.equal(Number(result.leave.days_count), 5);
  assert.equal(Number(result.leave.public_holiday_overlap_days), 1);

  const repeated = await annualLeavePublicHolidayExtension(db, 'main', result.leave);
  assert.equal(repeated.effectiveEndDate, '2026-09-26');
  assert.equal(repeated.overlapDays, 1);
  assert.equal(repeated.idempotent, true);
});

test('multiple official holiday codes on one date count as one calendar-day extension', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO sa_public_holiday_calendar
    (id, holiday_code, holiday_date, holiday_name_ar, holiday_name_en,
     source_type, source_reference, calendar_year, verified_at, status, created_at, updated_at)
    VALUES
    ('eid-x','eid_al_fitr','2026-02-22','عيد الفطر','Eid al-Fitr','official','test',2026,'2026-01-01','verified','2026-01-01','2026-01-01')`).run();

  await db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, leave_type, status, start_date, end_date,
     days_count, duration_kind, updated_at)
    VALUES ('annual-2','main','emp-1','annual','pending','2026-02-21','2026-02-22',
            2,'full_day','2026-01-01T00:00:00Z')`).run();

  const leave = await db.prepare(`SELECT * FROM employee_leaves WHERE id='annual-2'`).first();
  const result = await annualLeavePublicHolidayExtension(db, 'main', leave);

  // Founding Day is inserted by the fixed calendar helper and Eid shares the
  // same date in this synthetic collision. The date extends once, not twice.
  assert.equal(result.overlapDays, 1);
  assert.equal(result.effectiveEndDate, '2026-02-23');
});

test('partial annual leave cannot be consumed on a verified public holiday', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  await db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, leave_type, status, start_date, end_date,
     days_count, duration_kind, updated_at)
    VALUES ('annual-partial','main','emp-1','annual','pending','2026-09-23','2026-09-23',
            0.5,'partial','2026-08-01T00:00:00Z')`).run();
  const leave = await db.prepare(`SELECT * FROM employee_leaves WHERE id='annual-partial'`).first();

  await assert.rejects(
    () => annualLeavePublicHolidayExtension(db, 'main', leave),
    { code: 'core_annual_leave:partial_leave_on_public_holiday_not_allowed' }
  );
});

test('0049 stores annual overlap evidence and weekly-rest overlap credits one day-level entitlement', () => {
  const migration = readFileSync(
    'migrations/core/0049_public_holiday_leave_overlap.sql',
    'utf8'
  );
  const runtime = readFileSync(
    'workers/core/repositories/public-holiday-overlap.js',
    'utf8'
  );
  const dispatcher = readFileSync('workers/core/repositories/leaves.js', 'utf8');
  assert.match(migration, /public_holiday_overlap_days/);
  assert.match(migration, /public_holiday_weekly_rest_overlap_credit/);
  assert.match(runtime, /public_holiday_overlap_due/);
  assert.match(runtime, /sourceId: `\$\{employeeId\}:\$\{date\}`/);
  assert.match(runtime, /WEEKLY_REST_MINUTES/);
  assert.match(dispatcher, /annualLeavePublicHolidayExtension/);
});
