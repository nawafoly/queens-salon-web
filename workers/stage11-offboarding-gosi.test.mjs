import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import worker from './core/index.js';
import { normalizeError } from './core/errors.js';
import { offboardHrEmployee } from './core/repositories/employee-offboarding.js';
import { upsertHrEmployee } from './core/repositories/hr-employees.js';
import { recordAttendance } from './core/repositories/attendance.js';
import { resolveEmployeeShift } from './core/repositories/shift-control.js';
import { getStaff, staffIsPubliclyBookable } from './core/repositories/staff.js';
import { previewPayrollEntry } from './core/repositories/payroll.js';
import {
  classifyStage11PayrollReadiness,
  payrollApprovalReadiness,
  payrollAttendanceReadiness,
} from '../src/helpers/hr/payrollReadiness.js';

const TEST_NOW = '2026-08-25T12:00:00.000Z';
const TEST_BUSINESS_DATE = '2026-08-25';
const OFFBOARD_OPTIONS = { now: TEST_NOW };

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlain = (chunk) => chunk.split(';').map((v) => v.trim()).filter(Boolean).forEach((v) => statements.push(v));
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

const MIGRATIONS = [
  '0001_core_schema.sql','0002_frontend_cutover.sql','0003_booking_availability.sql','0004_admin_operations.sql','0005_hr_settings_files.sql',
  '0006_booking_discount_snapshots.sql','0007_booking_soft_delete.sql','0008_booking_reference_sequence.sql','0014_app_users_permissions.sql','0015_employee_type.sql',
  '0016_payroll_snapshots.sql','0016_employee_permissions.sql','0017_shift_control.sql','0018_employee_payroll_settings.sql','0020_employee_requests.sql',
  '0022_shift_attendance_policy.sql','0023_exceptional_financial_payment_requests.sql','0024_employee_leave_balance_ledger.sql','0025_employee_request_reference_integrity.sql',
  '0026_employee_master_profile_fields.sql','0027_employee_attendance_payroll_mode.sql','0028_payroll_approval_snapshots_carryovers.sql','0029_payroll_social_insurance_snapshots.sql',
  '0030_employee_payroll_obligations.sql','0031_workforce_communications_recruitment.sql','0032_service_season_price.sql','0033_app_user_profile_photo.sql',
  '0034_employee_offboarding_invariants.sql',
];

async function setup() {
  const mf = new Miniflare({
    workers: [{ config: { type: 'worker', name: 'stage11-test', compatibilityDate: '2026-06-24', manifest: {
      mainModule: 'script-0.mjs', modulesRoot: process.cwd(), modules: { 'script-0.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } },
    }, env: { CORE_DB: { type: 'd1', id: 'stage11-core-test' } }, exports: {} }, dev: { rootPath: process.cwd() } }],
  });
  const db = await mf.getD1Database('CORE_DB');
  for (const name of MIGRATIONS) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of splitMigrationStatements(sql)) await db.prepare(statement).run();
  }
  return {
    mf,
    db,
    env: {
      CORE_DB: db,
      SALON_ID: 'main',
      FIREBASE_PROJECT_ID: 'waves-hotel-dashboard',
      PACKAGES_AUTH_TEST_MODE: 'true',
    },
  };
}

const actor = { uid: 'actor-1', email: 'hr@example.com', name: 'HR', userId: 'app-hr' };

function riyadhToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function req(path, { method = 'GET', uid = 'uid-stage11-admin', role = 'admin', body } = {}) {
  return new Request(`http://core.test${path}`, {
    method,
    headers: {
      Authorization: `Bearer test:${uid}:${role}`,
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
}

async function responseJson(response) {
  return response.json();
}

async function seedEmployee(db, id = 'emp-1', overrides = {}) {
  const now = '2026-01-01T00:00:00.000Z';
  const profileStatus = overrides.profileStatus || 'active';
  const employmentStatus = overrides.employmentStatus || 'active';
  const staffActive = overrides.staffActive === undefined ? 1 : Number(Boolean(overrides.staffActive));
  const showOnBooking = overrides.showOnBooking === undefined ? 1 : Number(Boolean(overrides.showOnBooking));
  const staffEmploymentStatus = overrides.staffEmploymentStatus || employmentStatus;
  await db.prepare(`INSERT INTO employee_profiles
    (id,salon_id,firebase_uid,name,status,created_at,updated_at)
    VALUES (?,'main',?,?,?, ?, ?)`)
    .bind(id, overrides.firebaseUid || `firebase-${id}`, `Employee ${id}`, profileStatus, now, now).run();
  await db.prepare(`INSERT INTO employee_employment
    (salon_id,employee_id,start_date,end_date,base_salary_halalas,expected_work_days,expected_work_hours,daily_scheduled_hours,employment_status,
     attendance_payroll_mode,attendance_payroll_exemption_reason,social_insurance_category,social_insurance_effective_from,gosi_wage_mode,created_at,updated_at)
     VALUES ('main',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      id,
      overrides.startDate === undefined ? '2026-01-01' : overrides.startDate,
      overrides.endDate ?? null,
      overrides.baseSalary ?? 300000,
      overrides.workDays ?? 30,
      overrides.workHours ?? 240,
      overrides.dailyHours ?? 8,
      employmentStatus,
      overrides.attendanceMode || 'exempt',
      overrides.exemptionReason === undefined ? 'Documented test exemption' : overrides.exemptionReason,
      overrides.category === undefined ? 'non_saudi' : overrides.category,
      overrides.effectiveFrom === undefined ? '2026-01-01' : overrides.effectiveFrom,
      'derived',
      now,
      now
    ).run();
  await db.prepare(`INSERT INTO staff
    (id,salon_id,firebase_uid,name,active,employment_status,show_on_booking,created_at,updated_at)
    VALUES (?,'main',?,?,?,?,?,?,?)`)
    .bind(id, overrides.staffFirebaseUid || overrides.firebaseUid || `firebase-${id}`, `Employee ${id}`, staffActive, staffEmploymentStatus, showOnBooking, now, now).run();
  return id;
}

async function seedAccount(db, employeeId = 'emp-1', options = {}) {
  const now = '2026-01-01T00:00:00.000Z';
  const userId = options.userId || `user-${employeeId}`;
  const uid = options.firebaseUid || `firebase-${employeeId}`;
  const role = options.role || 'staff';
  const accountStatus = options.accountStatus || 'active';
  const linkStatus = options.linkStatus || 'active';
  await db.prepare(`INSERT INTO app_users
    (id,firebase_uid,salon_id,email,display_name,primary_role,status,created_at,updated_at)
    VALUES (?,?, 'main', ?, ?, ?, ?, ?, ?)`)
    .bind(userId, uid, `${userId}@example.com`, `User ${userId}`, role, accountStatus, now, now).run();
  if (options.withLink !== false) {
    await db.prepare(`INSERT INTO user_employee_links
      (id,salon_id,user_id,employee_id,link_status,linked_at,updated_at,unlinked_at)
      VALUES (?,'main',?,?, ?, ?, ?, ?)`)
      .bind(
        options.linkId || `link-${employeeId}-${userId}`,
        userId,
        employeeId,
        linkStatus,
        now,
        now,
        linkStatus === 'unlinked' ? now : null
      ).run();
  }
  return { userId, uid };
}

async function seedActorAccount(db, { uid = 'uid-stage11-admin', role = 'admin', permissions = [] } = {}) {
  const now = '2026-01-01T00:00:00.000Z';
  const userId = `user-${uid}`;
  await db.prepare(`INSERT INTO app_users
    (id,firebase_uid,salon_id,email,display_name,primary_role,status,created_at,updated_at)
    VALUES (?,?, 'main', ?, ?, ?, 'active', ?, ?)`)
    .bind(userId, uid, `${uid}@example.com`, `Actor ${uid}`, role, now, now).run();
  for (const permission of permissions) {
    await db.prepare(`INSERT INTO user_permissions
      (id,salon_id,user_id,permission_key,effect,created_at,updated_at)
      VALUES (?,'main',?,?, 'allow', ?, ?)`)
      .bind(`perm-${uid}-${permission.replace(/[^a-z0-9]+/gi, '-')}`, userId, permission, now, now).run();
  }
  return userId;
}

async function seedSchedules(db, id = 'emp-1') {
  const now = '2026-01-01T00:00:00.000Z';
  await db.prepare(`INSERT INTO hr_work_schedules
    (id,salon_id,employee_id,weekday,start_time,end_time,active,effective_from,effective_to,created_at,updated_at)
    VALUES
      (?,'main',?,1,'09:00','17:00',1,'2026-01-01','2026-06-30',?,?),
      (?,'main',?,1,'09:00','17:00',1,'2026-07-01',NULL,?,?),
      (?,'main',?,1,'09:00','17:00',1,'2026-09-01',NULL,?,?)`)
    .bind(`sched-history-${id}`,id,now,now,`sched-current-${id}`,id,now,now,`sched-future-${id}`,id,now,now).run();
  await db.prepare(`INSERT INTO hr_shift_assignments
    (id,salon_id,employee_id,shift_template_id,effective_from,effective_to,assignment_type,status,reason,snapshot_json,created_at,updated_at)
    VALUES
      (?,'main',?,NULL,'2026-07-01',NULL,'permanent','published',NULL,'{}',?,?),
      (?,'main',?,NULL,'2026-09-01',NULL,'permanent','published',NULL,'{}',?,?)`)
    .bind(`assign-current-${id}`,id,now,now,`assign-future-${id}`,id,now,now).run();
}

async function seedScheduleExceptions(db, id = 'emp-1') {
  const now = '2026-01-01T00:00:00.000Z';
  await db.prepare(`INSERT INTO hr_schedule_exceptions
    (id,salon_id,employee_id,date_from,date_to,exception_type,enabled,status,created_at,updated_at)
    VALUES
      (?,'main',?,'2026-07-01','2026-07-02','custom',1,'approved',?,?),
      (?,'main',?,'2026-08-19','2026-08-30','custom',1,'approved',?,?),
      (?,'main',?,'2026-09-01','2026-09-02','custom',1,'approved',?,?)`)
    .bind(`exc-history-${id}`,id,now,now,`exc-current-${id}`,id,now,now,`exc-future-${id}`,id,now,now).run();
}

async function seedBooking(db, {
  id = 'booking-1',
  employeeId = 'emp-1',
  bookingDate = '2026-08-26',
  status = 'booked',
  completedAt = null,
  parentStaff = true,
  itemStaff = false,
} = {}) {
  const now = '2026-01-01T00:00:00.000Z';
  await db.prepare(`INSERT INTO bookings
    (id,salon_id,client_id,staff_id,booking_date,start_time,end_time,status,source,
     subtotal_halalas,discount_halalas,total_halalas,payment_status,package_sessions_used,
     created_at,updated_at,completed_at)
    VALUES (?,'main','client-test',? ,?,'10:00','11:00',?,'test',0,0,0,'unpaid',0,?,?,?)`)
    .bind(id, parentStaff ? employeeId : null, bookingDate, status, now, now, completedAt).run();
  if (itemStaff) {
    await db.prepare(`INSERT INTO booking_items
      (id,booking_id,salon_id,service_id,service_name_snapshot,staff_id,quantity,unit_price_halalas,total_halalas,
       package_covered,duration_minutes,created_at,booking_date,start_time,end_time)
      VALUES (?,?,'main','svc-test','Service',?,1,0,0,0,60,?,?,'10:00','11:00')`)
      .bind(`item-${id}`, id, employeeId, now, bookingDate).run();
  }
}

async function lifecycleSnapshot(db, employeeId) {
  const [profile, employment, staff, links, fence, auditCount] = await Promise.all([
    db.prepare('SELECT status, firebase_uid, updated_at FROM employee_profiles WHERE salon_id=? AND id=?').bind('main', employeeId).first(),
    db.prepare('SELECT employment_status,end_date,updated_at FROM employee_employment WHERE salon_id=? AND employee_id=?').bind('main', employeeId).first(),
    db.prepare('SELECT active,show_on_booking,employment_status,firebase_uid,updated_at FROM staff WHERE salon_id=? AND id=?').bind('main', employeeId).first(),
    db.prepare("SELECT id,user_id,link_status,unlinked_at,updated_at FROM user_employee_links WHERE salon_id=? AND employee_id=? ORDER BY id").bind('main', employeeId).all(),
    db.prepare('SELECT * FROM employee_offboarding_fences WHERE salon_id=? AND employee_id=?').bind('main', employeeId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE salon_id=? AND entity_id=? AND action='employee_offboarded'").bind('main', employeeId).first(),
  ]);
  return JSON.parse(JSON.stringify({ profile, employment, staff, links: links.results || [], fence, auditCount }));
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

async function expectRawCode(promise, code) {
  await assert.rejects(promise, (error) => String(error?.message || error).includes(code));
}

// Existing Stage 11 coverage, retained where valid.
test('offboarding requires endDate', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await expectCode(offboardHrEmployee(db,'main','emp-1',{reason:'left'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_end_date_required');
});

test('offboarding requires reason', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await expectCode(offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_reason_required');
});

test('offboarding is idempotent only after every lifecycle projection is converged', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedAccount(db); await seedSchedules(db); await seedScheduleExceptions(db);
  const first = await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'contract ended'},actor,OFFBOARD_OPTIONS);
  assert.equal(first.idempotent,false);
  const second = await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'contract ended'},actor,OFFBOARD_OPTIONS);
  assert.equal(second.idempotent,true);
  const staff = await db.prepare("SELECT active,show_on_booking,employment_status,firebase_uid FROM staff WHERE id='emp-1'").first();
  assert.deepEqual([staff.active,staff.show_on_booking,staff.employment_status,staff.firebase_uid],[0,0,'inactive','firebase-emp-1']);
  const account = await db.prepare("SELECT status,firebase_uid FROM app_users WHERE id='user-emp-1'").first();
  assert.deepEqual([account.status,account.firebase_uid],['disabled','firebase-emp-1']);
  const link = await db.prepare("SELECT link_status FROM user_employee_links WHERE employee_id='emp-1'").first();
  assert.equal(link.link_status,'unlinked');
  const fence = await db.prepare("SELECT status,end_date FROM employee_offboarding_fences WHERE employee_id='emp-1'").first();
  assert.deepEqual([fence.status,fence.end_date],['offboarded','2026-08-20']);
});

test('offboarding closes current schedules/assignments, disables future ones and preserves history', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedSchedules(db);
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const history = await db.prepare("SELECT active,effective_to FROM hr_work_schedules WHERE id='sched-history-emp-1'").first(); assert.deepEqual([history.active,history.effective_to],[1,'2026-06-30']);
  const current = await db.prepare("SELECT effective_to FROM hr_work_schedules WHERE id='sched-current-emp-1'").first(); assert.equal(current.effective_to,'2026-08-20');
  const future = await db.prepare("SELECT active FROM hr_work_schedules WHERE id='sched-future-emp-1'").first(); assert.equal(future.active,0);
  const aCurrent = await db.prepare("SELECT effective_to,status FROM hr_shift_assignments WHERE id='assign-current-emp-1'").first(); assert.deepEqual([aCurrent.effective_to,aCurrent.status],['2026-08-20','published']);
  const aFuture = await db.prepare("SELECT status FROM hr_shift_assignments WHERE id='assign-future-emp-1'").first(); assert.equal(aFuture.status,'cancelled');
});

test('offboarding preserves historical booking/payroll/attendance and writes complete audit record', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedAccount(db);
  await db.prepare(`INSERT INTO attendance_records (id,salon_id,employee_id,date_key,record_type,recorded_at,created_at) VALUES ('att-h','main','emp-1','2026-07-01','check_in','2026-07-01T09:00:00Z','2026-07-01')`).run();
  await seedBooking(db,{id:'book-h',employeeId:'emp-1',bookingDate:'2026-07-01',status:'completed',completedAt:'2026-07-01T11:00:00Z'});
  await db.prepare(`INSERT INTO payroll_entries (id,salon_id,employee_id,payroll_month,created_at,updated_at) VALUES ('pay-h','main','emp-1','2026-07','2026-07-31','2026-07-31')`).run();
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  for (const [table,id] of [['attendance_records','att-h'],['bookings','book-h'],['payroll_entries','pay-h']]) {
    const row = await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first(); assert.equal(row.id,id);
  }
  const audit = await db.prepare("SELECT action,before_json,after_json,meta_json,actor_uid FROM audit_logs WHERE entity_id='emp-1' AND action='employee_offboarded' ORDER BY created_at DESC LIMIT 1").first();
  assert.equal(audit.actor_uid,'actor-1'); assert.match(audit.before_json,/profileStatus/); assert.match(audit.after_json,/endDate/); assert.match(audit.meta_json,/futureBookingCheck/); assert.match(audit.meta_json,/employeeLinks/); assert.match(audit.meta_json,/scheduleEffects/);
});

test('inactive employee cannot create attendance and cannot resolve an operational shift', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedSchedules(db);
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectCode(recordAttendance(db,'main',{employeeId:'emp-1',type:'check_in',date:'2026-08-21'},actor),'core_attendance:employee_not_active');
  const shift = await resolveEmployeeShift(db,'main','emp-1','2026-08-21'); assert.equal(shift.source,'none'); assert.equal(shift.blocked_reason,'employee_not_active');
  const staff = await getStaff(db,'main','emp-1'); assert.equal(staffIsPubliclyBookable(staff),false);
});

test('shift-control fails closed for partial HR projections and keeps staff-only resources operational', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  const date = '2026-08-24';
  const seedShiftCase = async (id, options = {}) => {
    await seedEmployee(db,id,{
      profileStatus: options.profileStatus || 'active',
      employmentStatus: options.employmentStatus || 'active',
      endDate: options.endDate ?? null,
    });
    await seedSchedules(db,id);
    if (options.profile === false) await db.prepare('DELETE FROM employee_profiles WHERE salon_id=? AND id=?').bind('main',id).run();
    if (options.employment === false) await db.prepare('DELETE FROM employee_employment WHERE salon_id=? AND employee_id=?').bind('main',id).run();
  };

  for (const [id, options, allowed] of [
    ['v6-shift-staff-only',{profile:false,employment:false},true],
    ['v6-shift-both-active',{},true],
    ['v6-shift-profile-only',{employment:false},false],
    ['v6-shift-employment-only',{profile:false},false],
    ['v6-shift-inactive-profile',{profileStatus:'inactive'},false],
    ['v6-shift-inactive-employment',{employmentStatus:'inactive'},false],
    ['v6-shift-post-end',{endDate:'2026-08-20'},false],
  ]) {
    await seedShiftCase(id, options);
    const shift = await resolveEmployeeShift(db,'main',id,date);
    if (allowed) {
      assert.equal(shift.source,'weekly_schedule',id);
      assert.notEqual(shift.blocked_reason,'employee_not_active',id);
    } else {
      assert.equal(shift.source,'none',id);
      assert.equal(shift.blocked_reason,'employee_not_active',id);
    }
  }
});

test('HR employee save rejects active classification without canonical effective date', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await assert.rejects(upsertHrEmployee(db,'main',{id:'hr-gosi',name:'HR GOSI',employment:{baseSalaryHalalas:300000,expectedWorkDays:30,attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'documented',socialInsuranceCategory:'non_saudi'}},actor),(error)=>error?.code==='core_hr:gosi_effective_date_required');
});

test('GOSI category missing -> classification_required', async (t) => { const {mf,db}=await setup();t.after(()=>mf.dispose());await seedEmployee(db,'g1',{category:null,effectiveFrom:null});await expectCode(previewPayrollEntry(db,'main',{employeeId:'g1',payrollMonth:'2026-08'},actor),'core_payroll:gosi_classification_required'); });
test('GOSI category with missing effective date -> effective_date_required', async (t) => { const {mf,db}=await setup();t.after(()=>mf.dispose());await seedEmployee(db,'g2',{category:'non_saudi',effectiveFrom:null});await expectCode(previewPayrollEntry(db,'main',{employeeId:'g2',payrollMonth:'2026-08'},actor),'core_payroll:gosi_effective_date_required'); });
test('GOSI effective date after policy date -> not_effective_for_payroll_period', async (t) => { const {mf,db}=await setup();t.after(()=>mf.dispose());await seedEmployee(db,'g3',{category:'non_saudi',effectiveFrom:'2026-08-29'});await expectCode(previewPayrollEntry(db,'main',{employeeId:'g3',payrollMonth:'2026-08'},actor),'core_payroll:gosi_not_effective_for_payroll_period'); });
test('valid GOSI category and effective date allows canonical calculation', async (t) => { const {mf,db}=await setup();t.after(()=>mf.dispose());await seedEmployee(db,'g4',{category:'non_saudi',effectiveFrom:'2026-08-01'});const p=await previewPayrollEntry(db,'main',{employeeId:'g4',payrollMonth:'2026-08'},actor);assert.equal(p.gosi_insurance_category,'non_saudi');assert.ok(p.gosi_policy_version); });
test('GCC remains extension-policy blocked', async (t) => { const {mf,db}=await setup();t.after(()=>mf.dispose());await seedEmployee(db,'g5',{category:'gcc',effectiveFrom:null});await expectCode(previewPayrollEntry(db,'main',{employeeId:'g5',payrollMonth:'2026-08'},actor),'core_payroll:gosi_gcc_extension_policy_required'); });
test('readiness INACTIVE precedence suppresses payroll/GOSI noise', () => { const r=classifyStage11PayrollReadiness({profileStatus:'inactive',employment:{employmentStatus:'inactive',baseSalaryHalalas:0,socialInsuranceCategory:null}});assert.equal(r.classification,'INACTIVE');assert.equal(r.blockers.length,1); });
test('attendance exempt with documented reason passes attendance gate only', () => { const a=payrollAttendanceReadiness({attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'documented'});assert.equal(a.ready,true);const r=classifyStage11PayrollReadiness({payrollMonth:'2026-08',employment:{employmentStatus:'active',baseSalaryHalalas:300000,expectedWorkDays:30,attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'documented',socialInsuranceCategory:'non_saudi',socialInsuranceEffectiveFrom:'2026-08-01'}});assert.equal(r.classification,'EXEMPT'); });
test('attendance exempt without reason blocks readiness', () => { const r=classifyStage11PayrollReadiness({payrollMonth:'2026-08',employment:{employmentStatus:'active',baseSalaryHalalas:300000,expectedWorkDays:30,attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'',socialInsuranceCategory:'non_saudi',socialInsuranceEffectiveFrom:'2026-08-01'}});assert.equal(r.classification,'BLOCKED');assert.ok(r.blockers.some((b)=>b.code==='core_payroll:payroll_attendance_exemption_reason_required')); });
test('base salary <= 0 blocks payroll readiness', () => { const r=classifyStage11PayrollReadiness({payrollMonth:'2026-08',employment:{employmentStatus:'active',baseSalaryHalalas:0,expectedWorkDays:30,attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'ok',socialInsuranceCategory:'non_saudi',socialInsuranceEffectiveFrom:'2026-08-01'}});assert.ok(r.blockers.some((b)=>b.code==='core_payroll:employee_not_payroll_eligible')); });
test('required attendance unconfirmed blocks readiness', () => { const r=classifyStage11PayrollReadiness({payrollMonth:'2026-08',employment:{employmentStatus:'active',baseSalaryHalalas:300000,expectedWorkDays:30,expectedWorkHours:240,dailyScheduledHours:8,attendancePayrollMode:'required',socialInsuranceCategory:'non_saudi',socialInsuranceEffectiveFrom:'2026-08-01'},attendanceSummary:{attendancePayrollMode:'required',attendanceLinkStatus:'unconfirmed',attendanceDeductionEligible:false,attendanceRecordCount:0}});assert.ok(r.blockers.some((b)=>b.code==='core_payroll:payroll_attendance_unconfirmed')); });
test('GOSI incomplete blocks official readiness and GCC gets dedicated classification', () => { const missing=classifyStage11PayrollReadiness({employment:{employmentStatus:'active',baseSalaryHalalas:300000,expectedWorkDays:30,attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'ok'}});assert.equal(missing.classification,'BLOCKED');assert.ok(missing.blockers.some((b)=>b.code==='core_payroll:gosi_classification_required'));const gcc=classifyStage11PayrollReadiness({employment:{employmentStatus:'active',baseSalaryHalalas:300000,expectedWorkDays:30,attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'ok',socialInsuranceCategory:'gcc'}});assert.equal(gcc.classification,'GCC_POLICY_BLOCKED'); });
test('official approval/export readiness blocks missing GOSI snapshot', () => { const r=payrollApprovalReadiness({payrollSetupComplete:true,attendanceSummary:{attendancePayrollMode:'exempt',attendancePayrollExemptionReason:'documented'},gosiSnapshot:{}});assert.equal(r.ready,false);assert.equal(r.code,'payroll_gosi_unconfigured');assert.equal(r.stage,'gosi'); });
test('browser does not own GOSI monetary authority', async () => { const source=await readFile(new URL('../src/services/CorePayrollService.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/calculateGosi/);assert.doesNotMatch(source,/gosiContributoryWageHalalas\s*:/); });

// Principal Review blocker regressions.
test('partial drift: inactive projections plus unlinked historical link still converge an active staff account', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'emp-1',{profileStatus:'inactive',employmentStatus:'inactive',endDate:'2026-08-20',staffActive:false,showOnBooking:false,staffEmploymentStatus:'inactive'});
  await seedAccount(db,'emp-1',{linkStatus:'unlinked',accountStatus:'active'});
  const result = await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'converge drift'},actor,OFFBOARD_OPTIONS);
  assert.equal(result.idempotent,false);
  assert.equal((await db.prepare("SELECT status FROM app_users WHERE id='user-emp-1'").first()).status,'disabled');
  assert.equal((await db.prepare("SELECT firebase_uid FROM app_users WHERE id='user-emp-1'").first()).firebase_uid,'firebase-emp-1');
  const second = await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'converge drift'},actor,OFFBOARD_OPTIONS);
  assert.equal(second.idempotent,true);
});

test('partial drift: future schedule and published assignment are converged before idempotent true', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'emp-1',{profileStatus:'inactive',employmentStatus:'inactive',endDate:'2026-08-20',staffActive:false,showOnBooking:false,staffEmploymentStatus:'inactive'});
  await seedSchedules(db,'emp-1');
  const result = await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'converge schedule'},actor,OFFBOARD_OPTIONS);
  assert.equal(result.idempotent,false);
  assert.equal((await db.prepare("SELECT active FROM hr_work_schedules WHERE id='sched-future-emp-1'").first()).active,0);
  assert.equal((await db.prepare("SELECT status FROM hr_shift_assignments WHERE id='assign-future-emp-1'").first()).status,'cancelled');
});

test('pending employee link is revoked and pending employee account is disabled', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await seedAccount(db,'emp-1',{role:'pending',accountStatus:'pending',linkStatus:'pending'});
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  assert.equal((await db.prepare("SELECT status FROM app_users WHERE id='user-emp-1'").first()).status,'disabled');
  assert.equal((await db.prepare("SELECT link_status FROM user_employee_links WHERE employee_id='emp-1'").first()).link_status,'unlinked');
});

test('schedule exceptions are temporally closed or cancelled without deleting history', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedScheduleExceptions(db);
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const history = await db.prepare("SELECT status,enabled,date_to FROM hr_schedule_exceptions WHERE id='exc-history-emp-1'").first();
  assert.deepEqual([history.status,history.enabled,history.date_to],['approved',1,'2026-07-02']);
  const current = await db.prepare("SELECT status,enabled,date_to FROM hr_schedule_exceptions WHERE id='exc-current-emp-1'").first();
  assert.deepEqual([current.status,current.enabled,current.date_to],['approved',1,'2026-08-20']);
  const future = await db.prepare("SELECT status,enabled,date_to FROM hr_schedule_exceptions WHERE id='exc-future-emp-1'").first();
  assert.deepEqual([future.status,future.enabled,future.date_to],['cancelled',0,'2026-09-02']);
});

test('privileged non-owner linked account fails closed with no lifecycle mutation', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedAccount(db,'emp-1',{role:'admin'});
  const before = await lifecycleSnapshot(db,'emp-1');
  await expectCode(offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_privileged_account_requires_manual_review');
  assert.deepEqual(await lifecycleSnapshot(db,'emp-1'),before);
  assert.equal((await db.prepare("SELECT status FROM app_users WHERE id='user-emp-1'").first()).status,'active');
});

test('owner linked account remains protected and fails closed with no mutation', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db); await seedAccount(db,'emp-1',{role:'owner'});
  const before = await lifecycleSnapshot(db,'emp-1');
  await expectCode(offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_privileged_account_requires_manual_review');
  assert.deepEqual(await lifecycleSnapshot(db,'emp-1'),before);
});

test('repurposed account identity fails closed instead of disabling an unrelated employee account', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'emp-1'); await seedEmployee(db,'emp-2',{firebaseUid:'firebase-emp-2'});
  const shared = await seedAccount(db,'emp-1',{userId:'user-shared',firebaseUid:'firebase-emp-1',linkStatus:'unlinked'});
  await db.prepare(`INSERT INTO user_employee_links
    (id,salon_id,user_id,employee_id,link_status,linked_at,updated_at)
    VALUES ('link-shared-current','main',?,'emp-2','active','2026-08-01','2026-08-01')`).bind(shared.userId).run();
  const before = await lifecycleSnapshot(db,'emp-1');
  await expectCode(offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_account_identity_conflict');
  assert.deepEqual(await lifecycleSnapshot(db,'emp-1'),before);
  assert.equal((await db.prepare("SELECT status FROM app_users WHERE id='user-shared'").first()).status,'active');
});

test('immediate offboarding accepts endDate equal to canonical Riyadh business date', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db,'today-emp');
  const result = await offboardHrEmployee(db,'main','today-emp',{endDate:TEST_BUSINESS_DATE,reason:'today'},actor,OFFBOARD_OPTIONS);
  assert.equal(result.end_date,TEST_BUSINESS_DATE); assert.equal(result.idempotent,false);
});

test('immediate offboarding accepts a past endDate', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db,'past-emp');
  const result = await offboardHrEmployee(db,'main','past-emp',{endDate:'2026-08-20',reason:'past'},actor,OFFBOARD_OPTIONS);
  assert.equal(result.end_date,'2026-08-20');
});

test('future endDate is rejected by backend authority and mutates nothing', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db,'future-emp'); await seedSchedules(db,'future-emp');
  const before = await lifecycleSnapshot(db,'future-emp');
  await expectCode(offboardHrEmployee(db,'main','future-emp',{endDate:'2026-08-26',reason:'future'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_future_end_date_not_supported');
  assert.deepEqual(await lifecycleSnapshot(db,'future-emp'),before);
});

test('completed post-end-date booking is an integrity conflict, not a future reassignment blocker', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await seedBooking(db,{id:'booking-completed-post-end',employeeId:'emp-1',bookingDate:'2026-08-21',status:'completed',completedAt:'2026-08-21T11:00:00Z'});
  const before = await lifecycleSnapshot(db,'emp-1');
  await expectCode(offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS),'core_hr:offboarding_post_end_date_activity_conflict');
  assert.deepEqual(await lifecycleSnapshot(db,'emp-1'),before);
});

test('upcoming operational booking requires reassignment and mutates nothing', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await seedBooking(db,{id:'booking-upcoming',employeeId:'emp-1',bookingDate:'2026-08-26',status:'booked'});
  const before = await lifecycleSnapshot(db,'emp-1');
  await assert.rejects(
    offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS),
    (error) => error?.code === 'core_hr:offboarding_future_bookings_require_reassignment' && error?.details?.count === 1 && error?.details?.bookingIds?.includes('booking-upcoming')
  );
  assert.deepEqual(await lifecycleSnapshot(db,'emp-1'),before);
});

test('SQLite fence aborts offboarding when a conflicting booking wins the write race', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await seedBooking(db,{id:'race-booking-first',employeeId:'emp-1',bookingDate:'2026-08-26',status:'booked'});
  await expectRawCode(
    db.prepare(`INSERT INTO employee_offboarding_fences
      (salon_id,employee_id,end_date,business_date,status,created_at,updated_at)
      VALUES ('main','emp-1','2026-08-20','2026-08-25','offboarded','2026-08-25','2026-08-25')`).run(),
    'core_hr:offboarding_future_bookings_require_reassignment'
  );
  assert.equal(await db.prepare("SELECT employee_id FROM employee_offboarding_fences WHERE employee_id='emp-1'").first(),null);
  assert.equal((await db.prepare("SELECT employment_status FROM employee_employment WHERE employee_id='emp-1'").first()).employment_status,'active');
});

test('SQLite fence blocks a new booking after offboarding wins the write race', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db);
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(seedBooking(db,{id:'race-offboard-first',employeeId:'emp-1',bookingDate:'2026-08-26',status:'booked'}),'core_booking:employee_not_active');
  assert.equal(await db.prepare("SELECT id FROM bookings WHERE id='race-offboard-first'").first(),null);
});

test('SQLite fence blocks booking-item reassignment/reschedule to an offboarded employee', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db,'emp-1'); await seedEmployee(db,'emp-2');
  await seedBooking(db,{id:'booking-other',employeeId:'emp-2',bookingDate:'2026-08-26',status:'booked',parentStaff:false,itemStaff:true});
  await offboardHrEmployee(db,'main','emp-1',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE booking_items SET staff_id='emp-1', booking_date='2026-08-26' WHERE id='item-booking-other'").run(),
    'core_booking:employee_not_active'
  );
  assert.equal((await db.prepare("SELECT staff_id FROM booking_items WHERE id='item-booking-other'").first()).staff_id,'emp-2');
});

test('offboarding endpoint authorizes employees.delete only; employees.manage alone is insufficient', async (t) => {
  const { mf, db, env } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db,'auth-target',{startDate:null});
  await seedActorAccount(db,{uid:'uid-stage11-admin',role:'admin'});
  const before = await lifecycleSnapshot(db,'auth-target');
  let response = await worker.fetch(req('/api/core/hr/employees/auth-target/offboard',{method:'POST',uid:'uid-stage11-admin',role:'admin',body:{endDate:'2000-01-01',reason:'auth test'}}),env);
  let body = await responseJson(response);
  assert.equal(response.status,403,JSON.stringify(body));
  assert.equal(body.error,'core_auth:missing_permission');
  assert.deepEqual(await lifecycleSnapshot(db,'auth-target'),before);

  await db.prepare(`INSERT INTO user_permissions
    (id,salon_id,user_id,permission_key,effect,created_at,updated_at)
    VALUES ('perm-stage11-delete','main','user-uid-stage11-admin','employees.delete','allow','2026-01-01','2026-01-01')`).run();
  response = await worker.fetch(req('/api/core/hr/employees/auth-target/offboard',{method:'POST',uid:'uid-stage11-admin',role:'admin',body:{endDate:'2000-01-01',reason:'auth test'}}),env);
  body = await responseJson(response);
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.data.status,'inactive');
});

test('Core API returns structured future-booking blocker details and leaves lifecycle untouched', async (t) => {
  const { mf, db, env } = await setup(); t.after(() => mf.dispose());
  const today = riyadhToday(); const tomorrow = addDays(today,1); const endDate = addDays(today,-1);
  await seedEmployee(db,'api-target',{startDate:null}); await seedActorAccount(db,{uid:'uid-stage11-delete',role:'staff',permissions:['employees.delete']});
  await seedBooking(db,{id:'api-future-booking',employeeId:'api-target',bookingDate:tomorrow,status:'booked'});
  const before = await lifecycleSnapshot(db,'api-target');
  const response = await worker.fetch(req('/api/core/hr/employees/api-target/offboard',{method:'POST',uid:'uid-stage11-delete',role:'staff',body:{endDate,reason:'api blocker'}}),env);
  const body = await responseJson(response);
  assert.equal(response.status,409,JSON.stringify(body));
  assert.equal(body.error,'core_hr:offboarding_future_bookings_require_reassignment');
  assert.equal(body.details.count,1);
  assert.ok(body.details.bookingIds.includes('api-future-booking'));
  assert.deepEqual(await lifecycleSnapshot(db,'api-target'),before);
});

test('disabled Core employee account cannot authenticate while Firebase UID remains stored', async (t) => {
  const { mf, db, env } = await setup(); t.after(() => mf.dispose()); await seedEmployee(db,'auth-emp');
  const account = await seedAccount(db,'auth-emp');
  await offboardHrEmployee(db,'main','auth-emp',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  assert.equal((await db.prepare('SELECT firebase_uid FROM app_users WHERE id=?').bind(account.userId).first()).firebase_uid,account.uid);
  const response = await worker.fetch(req('/api/auth/me',{uid:account.uid,role:'staff'}),env);
  const body = await responseJson(response);
  assert.equal(response.status,403,JSON.stringify(body));
  assert.equal(body.error,'ACCOUNT_DISABLED');
});

test('backend rejects future endDate through Core API with structured business-date details and no mutation', async (t) => {
  const { mf, db, env } = await setup(); t.after(() => mf.dispose());
  const today = riyadhToday(); const tomorrow = addDays(today,1);
  await seedEmployee(db,'api-future-end',{startDate:null}); await seedActorAccount(db,{uid:'uid-stage11-future',role:'staff',permissions:['employees.delete']});
  const before = await lifecycleSnapshot(db,'api-future-end');
  const response = await worker.fetch(req('/api/core/hr/employees/api-future-end/offboard',{method:'POST',uid:'uid-stage11-future',role:'staff',body:{endDate:tomorrow,reason:'future'}}),env);
  const body = await responseJson(response);
  assert.equal(response.status,409,JSON.stringify(body));
  assert.equal(body.error,'core_hr:offboarding_future_end_date_not_supported');
  assert.equal(body.details.businessDate,today);
  assert.deepEqual(await lifecycleSnapshot(db,'api-future-end'),before);
});

// Principal Review v3 regressions: booking reactivation/parent-item invariants + rehire fence.
test('v3 invariant: cancelled parent booking cannot be reactivated for an offboarded employee', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v3-status');
  await seedBooking(db,{id:'v3-status-booking',employeeId:'v3-status',bookingDate:'2026-08-26',status:'cancelled'});
  await offboardHrEmployee(db,'main','v3-status',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET status='confirmed' WHERE id='v3-status-booking'").run(),
    'core_booking:employee_not_active'
  );
  const booking = await db.prepare("SELECT status FROM bookings WHERE id='v3-status-booking'").first();
  const employment = await db.prepare("SELECT employment_status FROM employee_employment WHERE employee_id='v3-status'").first();
  const fence = await db.prepare("SELECT status FROM employee_offboarding_fences WHERE employee_id='v3-status'").first();
  assert.equal(booking.status,'cancelled');
  assert.equal(employment.employment_status,'inactive');
  assert.equal(fence.status,'offboarded');
});

test('v3 invariant: parent date move checks offboarded employee assigned only through booking_items', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v3-item-date');
  await seedBooking(db,{id:'v3-item-date-booking',employeeId:'v3-item-date',bookingDate:'2026-08-19',status:'booked',parentStaff:false,itemStaff:true});
  await offboardHrEmployee(db,'main','v3-item-date',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET booking_date='2026-08-26' WHERE id='v3-item-date-booking'").run(),
    'core_booking:employee_not_active'
  );
  assert.equal((await db.prepare("SELECT booking_date FROM bookings WHERE id='v3-item-date-booking'").first()).booking_date,'2026-08-19');
});

test('v3 invariant: cancelled parent cannot restore operational status when only booking_item references offboarded employee', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v3-item-status');
  await seedBooking(db,{id:'v3-item-status-booking',employeeId:'v3-item-status',bookingDate:'2026-08-19',status:'cancelled',parentStaff:false,itemStaff:true});
  await offboardHrEmployee(db,'main','v3-item-status',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET status='pending' WHERE id='v3-item-status-booking'").run(),
    'core_booking:employee_not_active'
  );
  assert.equal((await db.prepare("SELECT status FROM bookings WHERE id='v3-item-status-booking'").first()).status,'cancelled');
});

test('v3 invariant: multi-item parent transition fails when any one item references offboarded employee', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v3-multi-off'); await seedEmployee(db,'v3-multi-active');
  await seedBooking(db,{id:'v3-multi-booking',employeeId:'v3-multi-active',bookingDate:'2026-08-19',status:'cancelled',parentStaff:false,itemStaff:true});
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,staff_id,quantity,unit_price_halalas,total_halalas,
     package_covered,duration_minutes,created_at,booking_date,start_time,end_time)
    VALUES ('item-v3-multi-off','v3-multi-booking','main','svc-test','Service','v3-multi-off',1,0,0,0,60,'2026-01-01','2026-08-19','11:00','12:00')`).run();
  await offboardHrEmployee(db,'main','v3-multi-off',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET status='confirmed' WHERE id='v3-multi-booking'").run(),
    'core_booking:employee_not_active'
  );
  assert.equal((await db.prepare("SELECT status FROM bookings WHERE id='v3-multi-booking'").first()).status,'cancelled');
});

test('v3 rehire guard: generic HR reactivation is rejected and every offboarding projection stays closed', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v3-rehire'); await seedAccount(db,'v3-rehire'); await seedSchedules(db,'v3-rehire');
  await offboardHrEmployee(db,'main','v3-rehire',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const before = await lifecycleSnapshot(db,'v3-rehire');
  const accountBefore = await db.prepare("SELECT status,firebase_uid FROM app_users WHERE id='user-v3-rehire'").first();
  await expectCode(
    upsertHrEmployee(db,'main',{id:'v3-rehire',status:'active',employment:{employmentStatus:'active'}},actor),
    'core_hr:employee_rehire_requires_lifecycle_operation'
  );
  assert.deepEqual(await lifecycleSnapshot(db,'v3-rehire'),before);
  const accountAfter = await db.prepare("SELECT status,firebase_uid FROM app_users WHERE id='user-v3-rehire'").first();
  assert.deepEqual(accountAfter,accountBefore);
  assert.equal(accountAfter.status,'disabled');
  assert.equal((await db.prepare("SELECT link_status FROM user_employee_links WHERE employee_id='v3-rehire'").first()).link_status,'unlinked');
  assert.equal((await db.prepare("SELECT status FROM employee_offboarding_fences WHERE employee_id='v3-rehire'").first()).status,'offboarded');
});

test('v3 rehire guard: ordinary update to inactive offboarded history remains allowed without reactivation', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v3-history'); await seedAccount(db,'v3-history');
  await offboardHrEmployee(db,'main','v3-history',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const updated = await upsertHrEmployee(db,'main',{id:'v3-history',name:'Historical record renamed'},actor);
  assert.equal(updated.name,'Historical record renamed');
  assert.equal(updated.status,'inactive');
  assert.equal(updated.employment.employment_status,'inactive');
  const staff = await db.prepare("SELECT active,show_on_booking,employment_status FROM staff WHERE id='v3-history'").first();
  assert.deepEqual([staff.active,staff.show_on_booking,staff.employment_status],[0,0,'inactive']);
  assert.equal((await db.prepare("SELECT status FROM app_users WHERE id='user-v3-history'").first()).status,'disabled');
  assert.equal((await db.prepare("SELECT link_status FROM user_employee_links WHERE employee_id='v3-history'").first()).link_status,'unlinked');
  assert.equal((await db.prepare("SELECT status FROM employee_offboarding_fences WHERE employee_id='v3-history'").first()).status,'offboarded');
});

// Principal Review v4 hardening: close remaining cross-projection bypasses.
test('v4 invariant: booking_item cannot be reparented unchanged from finalized history into an operational parent after offboarding', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v4-reparent'); await seedEmployee(db,'v4-other');
  await seedBooking(db,{id:'v4-old-parent',employeeId:'v4-reparent',bookingDate:'2026-08-19',status:'cancelled',parentStaff:false,itemStaff:true});
  await seedBooking(db,{id:'v4-live-parent',employeeId:'v4-other',bookingDate:'2026-08-26',status:'booked',parentStaff:false,itemStaff:false});
  await offboardHrEmployee(db,'main','v4-reparent',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE booking_items SET booking_id='v4-live-parent' WHERE id='item-v4-old-parent'").run(),
    'core_booking:employee_not_active'
  );
  const item = await db.prepare("SELECT booking_id,staff_id FROM booking_items WHERE id='item-v4-old-parent'").first();
  assert.deepEqual([item.booking_id,item.staff_id],['v4-old-parent','v4-reparent']);
});

test('v4 invariant: parent identity cannot detach a fenced booking_item before later status restoration', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v4-parent-id');
  await seedBooking(db,{id:'v4-parent-id-booking',employeeId:'v4-parent-id',bookingDate:'2026-08-19',status:'cancelled',parentStaff:false,itemStaff:true});
  await offboardHrEmployee(db,'main','v4-parent-id',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET id='v4-parent-id-detached' WHERE id='v4-parent-id-booking'").run(),
    'core_booking:employee_not_active'
  );
  assert.ok(await db.prepare("SELECT id FROM bookings WHERE id='v4-parent-id-booking'").first());
  assert.equal(await db.prepare("SELECT id FROM bookings WHERE id='v4-parent-id-detached'").first(),null);
});

test('v4 rehire guard: generic HR save cannot reopen only the staff booking projection', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v4-staff-projection'); await seedAccount(db,'v4-staff-projection');
  await offboardHrEmployee(db,'main','v4-staff-projection',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const before = await lifecycleSnapshot(db,'v4-staff-projection');
  await expectCode(
    upsertHrEmployee(db,'main',{id:'v4-staff-projection',bookingStaff:{active:true,showOnBooking:true,employmentStatus:'active'}},actor),
    'core_hr:employee_rehire_requires_lifecycle_operation'
  );
  assert.deepEqual(await lifecycleSnapshot(db,'v4-staff-projection'),before);
  const account = await db.prepare("SELECT status FROM app_users WHERE id='user-v4-staff-projection'").first();
  assert.equal(account.status,'disabled');
});

test('v4 rehire guard: generic inactive historical save cannot rewrite offboarding lifecycle dates', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v4-dates'); await seedAccount(db,'v4-dates');
  await offboardHrEmployee(db,'main','v4-dates',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const before = await lifecycleSnapshot(db,'v4-dates');
  await expectCode(
    upsertHrEmployee(db,'main',{id:'v4-dates',employment:{startDate:'2026-02-01',employmentStatus:'inactive'}},actor),
    'core_hr:offboarding_lifecycle_fields_locked'
  );
  assert.deepEqual(await lifecycleSnapshot(db,'v4-dates'),before);
  await expectCode(
    upsertHrEmployee(db,'main',{id:'v4-dates',employment:{endDate:'2026-08-19',employmentStatus:'inactive'}},actor),
    'core_hr:offboarding_lifecycle_fields_locked'
  );
  assert.deepEqual(await lifecycleSnapshot(db,'v4-dates'),before);
});

test('v4 invariant: durable offboarding fence cannot be deleted, re-keyed, or have end_date rewritten', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v4-fence');
  await offboardHrEmployee(db,'main','v4-fence',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  for (const sql of [
    "DELETE FROM employee_offboarding_fences WHERE employee_id='v4-fence'",
    "UPDATE employee_offboarding_fences SET employee_id='v4-fence-moved' WHERE employee_id='v4-fence'",
    "UPDATE employee_offboarding_fences SET end_date='2026-08-19' WHERE employee_id='v4-fence'",
  ]) {
    await expectRawCode(db.prepare(sql).run(),'core_hr:offboarding_fence_history_immutable');
  }
  const fence = await db.prepare("SELECT employee_id,end_date,status FROM employee_offboarding_fences WHERE employee_id='v4-fence'").first();
  assert.deepEqual([fence.employee_id,fence.end_date,fence.status],['v4-fence','2026-08-20','offboarded']);
});

// Principal Review v6 hardening: D1 protects all HR operational projections after the fence exists.
test('v6 invariant: canonical offboarding transaction passes HR projection triggers', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v6-canonical');
  const result = await offboardHrEmployee(db,'main','v6-canonical',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  assert.equal(result.idempotent,false);
  const snapshot = await lifecycleSnapshot(db,'v6-canonical');
  assert.equal(snapshot.fence.status,'offboarded');
  assert.deepEqual(
    [snapshot.profile.status,snapshot.employment.employment_status,snapshot.employment.end_date,snapshot.staff.active,snapshot.staff.show_on_booking,snapshot.staff.employment_status],
    ['inactive','inactive','2026-08-20',0,0,'inactive']
  );
});

test('v6 invariant: D1 rejects stale HR operational projection writes after offboarding commits', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v6-sqlite-hr');
  await offboardHrEmployee(db,'main','v6-sqlite-hr',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  const before = await lifecycleSnapshot(db,'v6-sqlite-hr');

  await expectRawCode(
    db.batch([
      db.prepare("UPDATE employee_profiles SET status='active' WHERE salon_id='main' AND id='v6-sqlite-hr'"),
      db.prepare("UPDATE employee_employment SET employment_status='active', end_date=NULL WHERE salon_id='main' AND employee_id='v6-sqlite-hr'"),
      db.prepare("UPDATE staff SET active=1, show_on_booking=1, employment_status='active' WHERE salon_id='main' AND id='v6-sqlite-hr'"),
    ]),
    'core_hr:employee_rehire_requires_lifecycle_operation'
  );
  assert.deepEqual(await lifecycleSnapshot(db,'v6-sqlite-hr'),before);

  for (const sql of [
    "UPDATE employee_profiles SET status='active' WHERE salon_id='main' AND id='v6-sqlite-hr'",
    "UPDATE employee_employment SET employment_status='active' WHERE salon_id='main' AND employee_id='v6-sqlite-hr'",
    "UPDATE employee_employment SET end_date=NULL WHERE salon_id='main' AND employee_id='v6-sqlite-hr'",
    "UPDATE employee_employment SET end_date='2026-08-19' WHERE salon_id='main' AND employee_id='v6-sqlite-hr'",
    "UPDATE staff SET active=1 WHERE salon_id='main' AND id='v6-sqlite-hr'",
    "UPDATE staff SET show_on_booking=1 WHERE salon_id='main' AND id='v6-sqlite-hr'",
    "UPDATE staff SET employment_status='active' WHERE salon_id='main' AND id='v6-sqlite-hr'",
  ]) {
    await expectRawCode(db.prepare(sql).run(),'core_hr:employee_rehire_requires_lifecycle_operation');
  }

  await db.prepare("UPDATE employee_profiles SET name='Historical Employee', status='inactive' WHERE salon_id='main' AND id='v6-sqlite-hr'").run();
  await db.prepare("UPDATE employee_employment SET admin_notes='history edit', employment_status='inactive', end_date='2026-08-20' WHERE salon_id='main' AND employee_id='v6-sqlite-hr'").run();
  await db.prepare("UPDATE staff SET name='Historical Employee', active=0, show_on_booking=0, employment_status='inactive' WHERE salon_id='main' AND id='v6-sqlite-hr'").run();
  const after = await lifecycleSnapshot(db,'v6-sqlite-hr');
  assert.deepEqual(
    [after.profile.status,after.profile.updated_at,after.employment.employment_status,after.employment.end_date,after.staff.active,after.staff.show_on_booking,after.staff.employment_status],
    ['inactive',before.profile.updated_at,'inactive','2026-08-20',0,0,'inactive']
  );
});

test('v6 invariant: D1 rehire trigger errors normalize to structured 409', () => {
  const normalized = normalizeError(
    new Error('D1_ERROR: constraint failed: core_hr:employee_rehire_requires_lifecycle_operation')
  );
  assert.equal(normalized.status,409);
  assert.equal(normalized.code,'core_hr:employee_rehire_requires_lifecycle_operation');
});

// Principal Review v5 regressions: canonical STATUS must not be masked by stale completed_at metadata.
test('v5 invariant: completed with completed_at non-NULL cannot restore any operational status after offboarding', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v5-completed-confirmed');
  await seedBooking(db,{
    id:'v5-completed-confirmed-booking',
    employeeId:'v5-completed-confirmed',
    bookingDate:'2026-08-19',
    status:'completed',
    completedAt:'2026-08-19T11:00:00.000Z',
  });
  await offboardHrEmployee(db,'main','v5-completed-confirmed',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  for (const targetStatus of ['confirmed','pending','booked']) {
    await expectRawCode(
      db.prepare(`UPDATE bookings SET status='${targetStatus}' WHERE id='v5-completed-confirmed-booking'`).run(),
      'core_booking:employee_not_active'
    );
  }
  const row = await db.prepare("SELECT status,completed_at FROM bookings WHERE id='v5-completed-confirmed-booking'").first();
  assert.equal(row.status,'completed');
  assert.equal(row.completed_at,'2026-08-19T11:00:00.000Z');
});

test('v5 invariant: item-only offboarded assignment cannot restore completed parent to operational status', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v5-item-only');
  await seedBooking(db,{
    id:'v5-item-only-booking',
    employeeId:'v5-item-only',
    bookingDate:'2026-08-19',
    status:'completed',
    completedAt:'2026-08-19T11:00:00.000Z',
    parentStaff:false,
    itemStaff:true,
  });
  await offboardHrEmployee(db,'main','v5-item-only',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET status='confirmed' WHERE id='v5-item-only-booking'").run(),
    'core_booking:employee_not_active'
  );
  assert.equal((await db.prepare("SELECT status FROM bookings WHERE id='v5-item-only-booking'").first()).status,'completed');
});

test('v5 invariant: completed booking may receive harmless finalized metadata correction', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v5-history');
  await seedBooking(db,{
    id:'v5-history-booking',
    employeeId:'v5-history',
    bookingDate:'2026-08-19',
    status:'completed',
    completedAt:'2026-08-19T11:00:00.000Z',
  });
  await offboardHrEmployee(db,'main','v5-history',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await db.prepare(
    "UPDATE bookings SET completed_at='2026-08-19T11:05:00.000Z' WHERE id='v5-history-booking'"
  ).run();
  const row = await db.prepare("SELECT status,completed_at FROM bookings WHERE id='v5-history-booking'").first();
  assert.equal(row.status,'completed');
  assert.equal(row.completed_at,'2026-08-19T11:05:00.000Z');
});

test('v5 invariant: completed to confirmed is rejected while completed_at remains unchanged', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v5-stale-ts');
  await seedBooking(db,{
    id:'v5-stale-ts-booking',
    employeeId:'v5-stale-ts',
    bookingDate:'2026-08-19',
    status:'completed',
    completedAt:'2026-08-19T11:00:00.000Z',
  });
  await offboardHrEmployee(db,'main','v5-stale-ts',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET status='confirmed' WHERE id='v5-stale-ts-booking'").run(),
    'core_booking:employee_not_active'
  );
  const row = await db.prepare("SELECT status,completed_at FROM bookings WHERE id='v5-stale-ts-booking'").first();
  assert.deepEqual([row.status,row.completed_at],['completed','2026-08-19T11:00:00.000Z']);
});

test('v5 invariant: completed to confirmed is rejected when completed_at is cleared in same update', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  await seedEmployee(db,'v5-clear-ts');
  await seedBooking(db,{
    id:'v5-clear-ts-booking',
    employeeId:'v5-clear-ts',
    bookingDate:'2026-08-19',
    status:'completed',
    completedAt:'2026-08-19T11:00:00.000Z',
  });
  await offboardHrEmployee(db,'main','v5-clear-ts',{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
  await expectRawCode(
    db.prepare("UPDATE bookings SET status='confirmed', completed_at=NULL WHERE id='v5-clear-ts-booking'").run(),
    'core_booking:employee_not_active'
  );
  const row = await db.prepare("SELECT status,completed_at FROM bookings WHERE id='v5-clear-ts-booking'").first();
  assert.deepEqual([row.status,row.completed_at],['completed','2026-08-19T11:00:00.000Z']);
});

test('v5 invariant: cancelled and rejected status restoration protections remain enforced', async (t) => {
  const { mf, db } = await setup(); t.after(() => mf.dispose());
  for (const [suffix,status,target] of [
    ['cancelled','cancelled','pending'],
    ['rejected','rejected','booked'],
  ]) {
    const employeeId = `v5-${suffix}`;
    const bookingId = `v5-${suffix}-booking`;
    await seedEmployee(db,employeeId);
    await seedBooking(db,{id:bookingId,employeeId,bookingDate:'2026-08-19',status});
    await offboardHrEmployee(db,'main',employeeId,{endDate:'2026-08-20',reason:'left'},actor,OFFBOARD_OPTIONS);
    await expectRawCode(
      db.prepare(`UPDATE bookings SET status='${target}' WHERE id='${bookingId}'`).run(),
      'core_booking:employee_not_active'
    );
    assert.equal((await db.prepare('SELECT status FROM bookings WHERE id=?').bind(bookingId).first()).status,status);
  }
});
