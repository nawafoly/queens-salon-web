import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedD1 } from './test-support/sqlite-d1.mjs';
import { processAttendanceOperation } from './attendance-operations.js';
import { adjustAttendanceRecords, recoverPendingAttendanceOperations, handleAttendanceRequest } from './attendance-worker.js';
import { upsertPayrollEntry, upsertPayrollPeriod, approvePayrollEntry, markPayrollEntryPaid } from './core/repositories/payroll.js';
import { saveShiftTemplate } from './core/repositories/shift-control.js';
import { replaceHrSchedules } from './core/repositories/hr-employees.js';
import { createLeave, decideLeave } from './core/repositories/leaves.js';
import { createPermissionRequest } from './core/repositories/permissions.js';
import { recoverHrPayrollOperations } from './core/repositories/hr-payroll-operations.js';
import { setAnnualLeaveOpeningBalance } from './core/repositories/annual-leave.js';

const actor = {uid:'test-admin',email:'admin@example.invalid',runtime:{isActive:true,role:'owner',permissionsAllow:[
  'attendance.records.create','attendance.records.update','attendance.records.delete',
]}};
const date = '2026-08-10';
const body = (extra={}) => ({employeeUid:'test-uid',employeeDocId:'test-employee',date,...extra});
const request = value => new Request('https://test.invalid/attendance/admin-adjustment',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),
});
const adjust = (attendance,core,value) => adjustAttendanceRecords(request(body(value)),attendance,core,'main',actor);
const due = attendance => attendance.prepare("UPDATE attendance_operations SET next_attempt_at='2000-01-01',lease_until=NULL WHERE status<>'completed'").run();

async function lockedFixture(t,status='paid') {
  const {attendance,core} = await fixture(t);
  await adjust(attendance,core,{checkInTime:'09:00',checkOutTime:'16:00',operationId:'seed'});
  const options = {externalAttendanceDb:attendance};
  const entry = await upsertPayrollEntry(core,'main',{id:'test-payroll',employeeId:'test-employee',payrollMonth:'2026-08',skipTargetBonus:true},actor,options);
  await approvePayrollEntry(core,'main',entry.id,actor,options);
  if (status === 'paid') await markPayrollEntryPaid(core,'main',entry.id,actor);
  return {attendance,core,entry:await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first()};
}

async function fixture(t,status='draft') {
  const attendance = migratedD1('../attendance-migrations/');
  const core = migratedD1('../../migrations/core/');
  t.after(() => {attendance.database.close();core.database.close();});
  await core.prepare(`INSERT INTO employee_profiles(id,salon_id,firebase_uid,name,status,created_at,updated_at)
    VALUES('test-employee','main','test-uid','Isolated employee','active','2026-01-01','2026-01-01')`).run();
  await core.prepare(`INSERT INTO employee_employment
    (salon_id,employee_id,base_salary_halalas,expected_work_days,expected_work_hours,daily_scheduled_hours,
    attendance_payroll_mode,social_insurance_category,social_insurance_effective_from,gosi_wage_mode,created_at,updated_at)
    VALUES('main','test-employee',300000,30,240,8,'required','non_saudi','2026-01-01','derived','2026-01-01','2026-01-01')`).run();
  await upsertPayrollPeriod(core,'main',{id:'period',payrollMonth:'2026-08',monthStart:'2026-08-01',monthEnd:'2026-08-31'},actor);
  await saveShiftTemplate(core,'main',{id:'test-shift',name:'Test shift',startTime:'08:00',endTime:'16:00'},actor);
  await replaceHrSchedules(core,'main','test-employee',[
    {id:'test-schedule',weekday:1,shiftTemplateId:'test-shift',active:true,effectiveFrom:date,effectiveTo:date},
  ]);
  return {attendance,core};
}

test('real migrations support durable attendance operations and canonical payroll', async t => {
  const {attendance,core} = await fixture(t);
  const response = await adjustAttendanceRecords(request(body({checkInTime:'08:00',checkOutTime:'16:00',operationId:'test-create'})),attendance,core,'main',actor);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).fullyCompleted,true);
  assert.equal((await attendance.prepare('SELECT * FROM attendance_operations').first()).status,'completed');
});

test('Core failure after the punch commit returns pending, survives retry and preserves paid payroll',async t => {
  const {attendance,core,entry} = await lockedFixture(t);
  const failedCore = {...core,prepare(sql) {
    if (sql.includes('FROM payroll_entries')) throw new Error('ISOLATED_CORE_OFFLINE');
    return core.prepare(sql);
  }};
  const response = await adjust(attendance,failedCore,{checkInTime:'08:00',operationId:'offline'});
  assert.equal(response.status,202);
  const payload = await response.json();
  assert.equal(payload.attendanceApplied,true);
  assert.equal(payload.fullyCompleted,false);
  assert.equal(payload.operation.status,'pending');
  assert.equal((await attendance.prepare("SELECT server_time FROM attendance_records WHERE type='check_in'").first()).server_time,`${date}T05:00:00.000Z`);
  assert.equal((await attendance.prepare("SELECT last_error FROM attendance_operations WHERE id='offline'").first()).last_error,'ISOLATED_CORE_OFFLINE');
  await due(attendance);
  await recoverPendingAttendanceOperations(attendance,core);
  assert.equal((await attendance.prepare("SELECT status FROM attendance_operations WHERE id='offline'").first()).status,'completed');
  assert.equal((await core.prepare("SELECT amount_halalas FROM payroll_carryover_adjustments WHERE status='pending'").first()).amount_halalas,1250);
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
});

test('lost Core batch acknowledgement retries without duplicating a financial carryover',async t => {
  const {attendance,core} = await lockedFixture(t);
  const failedCore = {...core,async batch(statements) {
    await core.batch(statements);
    throw new Error('CORE_ACK_LOST_AFTER_COMMIT');
  }};
  const response = await adjust(attendance,failedCore,{checkInTime:'08:00',operationId:'lost-core-ack'});
  assert.equal(response.status,202);
  assert.equal((await core.prepare('SELECT COUNT(*) n FROM payroll_carryover_adjustments').first()).n,1);
  await due(attendance);
  await recoverPendingAttendanceOperations(attendance,core);
  assert.equal((await attendance.prepare("SELECT status FROM attendance_operations WHERE id='lost-core-ack'").first()).status,'completed');
  assert.equal((await core.prepare("SELECT COUNT(*) n FROM payroll_carryover_adjustments WHERE status<>'void'").first()).n,1);
});

test('lost attendance batch acknowledgement reports the committed operation and replay preserves its audit',async t => {
  const {attendance,core} = await fixture(t);
  const failedAttendance = {...attendance,async batch(statements) {
    await attendance.batch(statements);
    throw new Error('ATTENDANCE_ACK_LOST_AFTER_COMMIT');
  }};
  const value = {checkInTime:'08:00',checkOutTime:'16:00',operationId:'lost-attendance-ack',note:'isolated correction'};
  const first = await adjust(failedAttendance,core,value);
  assert.equal(first.status,200);
  const replay = await adjust(attendance,core,value);
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),await first.json());
  assert.equal((await attendance.prepare('SELECT COUNT(*) n FROM attendance_records').first()).n,2);
  const op = await attendance.prepare('SELECT * FROM attendance_operations').first();
  assert.deepEqual(JSON.parse(op.before_records),[]);
  assert.equal(JSON.parse(op.after_records).length,2);
  assert.equal(op.reason,value.note);
  assert.throws(() => attendance.database.exec("UPDATE attendance_operations SET before_records='[]x'"),/audit_immutable/);
  assert.throws(() => attendance.database.exec('DELETE FROM attendance_operation_events'),/audit_immutable/);
  assert.throws(() => attendance.database.exec('DELETE FROM attendance_operations'),/audit_immutable/);
  assert.equal((await adjust(attendance,core,{...value,checkInTime:'10:00'})).status,409);
});

test('attendance write failure rolls back punches, outbox and audit together',async t => {
  const {attendance,core} = await fixture(t);
  attendance.database.exec(`CREATE TRIGGER fail_punch BEFORE INSERT ON attendance_records BEGIN SELECT RAISE(ABORT,'ISOLATED_WRITE_FAILURE'); END;`);
  const response = await adjust(attendance,core,{checkInTime:'08:00',operationId:'failed-write'});
  assert.equal(response.status,500);
  for (const table of ['attendance_records','attendance_operations','attendance_operation_events']) {
    assert.equal((await attendance.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
  }
});

test('concurrent employee edits cannot overwrite each other or run competing pending reconciliations',async t => {
  const {attendance,core} = await fixture(t);
  let arrived=0,release;
  const barrier=new Promise(resolve => {release=resolve;});
  const racing = {...attendance,prepare(sql) {
    const statement=attendance.prepare(sql);
    if (!sql.startsWith('SELECT json_group_array')) return statement;
    return {bind(...params) {return {async first() {
      const snapshot=await statement.bind(...params).first();
      if (++arrived === 2) release();
      await barrier;
      return snapshot;
    }}}};
  }};
  const responses = await Promise.all([
    adjust(racing,core,{checkInTime:'08:00',operationId:'concurrent-1'}),
    adjust(racing,core,{checkInTime:'09:00',operationId:'concurrent-2'}),
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await attendance.prepare('SELECT COUNT(*) n FROM attendance_records').first()).n,1);
  assert.equal((await attendance.prepare('SELECT COUNT(*) n FROM attendance_operations').first()).n,1);
});

test('bounded retries retain a recoverable needs_attention operation and block later edits',async t => {
  const {attendance,core} = await fixture(t);
  const offline = {...core,prepare(sql) { if (sql.includes('FROM payroll_entries')) throw new Error('OFFLINE'); return core.prepare(sql); }};
  await adjust(attendance,offline,{checkInTime:'08:00',operationId:'retry-limit'});
  for (let n=1;n<8;n++) {await due(attendance); await recoverPendingAttendanceOperations(attendance,offline);}
  const op = await attendance.prepare('SELECT * FROM attendance_operations').first();
  assert.equal(op.status,'needs_attention');
  assert.equal(op.attempts,8);
  assert.equal((await adjust(attendance,core,{checkInTime:'09:00',operationId:'blocked'})).status,409);
  await recoverPendingAttendanceOperations(attendance,core);
  assert.equal((await attendance.prepare('SELECT attempts FROM attendance_operations').first()).attempts,8);
});

test('successive paid-month edits reconcile positive, zero and negative residuals, skipping closed target months',async t => {
  const {attendance,core,entry} = await lockedFixture(t);
  await upsertPayrollPeriod(core,'main',{id:'closed-next',payrollMonth:'2026-09',monthStart:'2026-09-01',monthEnd:'2026-09-30'},actor);
  await core.prepare("UPDATE payroll_periods SET status='closed' WHERE id='closed-next'").run();
  const correction = async (time,id) => {
    const response = await adjust(attendance,core,{checkInTime:time,operationId:id});
    assert.equal(response.status,200,await response.clone().text());
    return (await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status='pending'").all()).results;
  };
  let rows = await correction('08:00','positive');
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount_halalas,1250);
  assert.equal(rows[0].target_payroll_month,'2026-10');
  rows = await correction('09:00','zero');
  assert.equal(rows.length,0);
  rows = await correction('10:00','negative');
  assert.equal(rows.length,1);
  assert.equal(rows[0].direction,'deduction');
  assert.equal(rows[0].amount_halalas,1250);
  rows = await correction('11:00','changed-negative');
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount_halalas,2500);
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
});

test('deleting only the paid-day checkout preserves check-in, is retryable, and never mutates the paid entry',async t => {
  const {attendance,core,entry} = await lockedFixture(t);
  const record = await attendance.prepare("SELECT id FROM attendance_records WHERE type='check_out'").first();
  const value = {action:'clear',recordIds:[record.id],operationId:'clear-checkout'};
  const first = await adjust(attendance,core,value);
  assert.equal(first.status,200);
  assert.equal((await first.json()).clearedRecords,1);
  assert.equal((await attendance.prepare("SELECT COUNT(*) n FROM attendance_records WHERE type='check_in'").first()).n,1);
  assert.equal((await attendance.prepare("SELECT COUNT(*) n FROM attendance_records WHERE type='check_out'").first()).n,0);
  const replay = await adjust(attendance,core,value);
  assert.equal((await replay.json()).clearedRecords,1,'replay returns original result without re-deleting');
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
});

test('canonical identity mismatch and revoked replay permission cannot write attendance or outbox',async t => {
  const {attendance,core} = await fixture(t);
  await core.prepare(`INSERT INTO employee_profiles(id,salon_id,firebase_uid,name,status,created_at,updated_at)
    VALUES('other-employee','main','some-other-uid','Other isolated employee','active','2026-01-01','2026-01-01')`).run();
  const mismatch = await adjustAttendanceRecords(request({...body({checkInTime:'08:00'}),employeeUid:'some-other-uid'}),attendance,core,'main',actor);
  assert.equal(mismatch.status,400);
  await adjust(attendance,core,{checkInTime:'08:00',operationId:'permission-replay'});
  const denied = await adjustAttendanceRecords(request(body({checkInTime:'08:00',operationId:'permission-replay'})),attendance,core,'main',{
    uid:actor.uid,runtime:{isActive:true,role:'staff',permissionsAllow:['attendance.own.view']},
  });
  assert.equal(denied.status,403);
  assert.equal((await attendance.prepare('SELECT COUNT(*) n FROM attendance_records').first()).n,1);
});

test('overnight work_date keeps both sides in the original payroll month and audit',async t => {
  const {attendance,core} = await fixture(t);
  const response = await adjust(attendance,core,{date:'2026-08-31',checkInTime:'22:00',checkOutTime:'06:00',operationId:'overnight'});
  assert.equal(response.status,200);
  const checkout = await attendance.prepare("SELECT server_time,work_date FROM attendance_records WHERE type='check_out'").first();
  assert.equal(checkout.work_date,'2026-08-31');
  assert.equal(checkout.server_time,'2026-09-01T03:00:00.000Z');
  const cleared = await adjust(attendance,core,{date:'2026-08-31',action:'clear',operationId:'clear-overnight'});
  assert.equal(cleared.status,200);
  assert.equal((await cleared.json()).clearedRecords,2);
});

test('self-service check-in and checkout use atomic recovery records, preserve shift state, and replay safely',async t => {
  const {attendance,core} = await fixture(t);
  t.mock.timers.enable({apis:['Date'],now:new Date(`${date}T05:00:00.000Z`)});
  await core.prepare(`UPDATE employee_employment SET allowed_zone_ids_json='["test-zone"]'`).run();
  await attendance.prepare(`INSERT INTO work_zones(id,name,type,center_lat,center_lng,radius_meters,active,created_at,updated_at,created_by_uid,updated_by_uid)
    VALUES('test-zone','Isolated zone','radius',24.7,46.6,1000,1,'2026-01-01','2026-01-01','test-admin','test-admin')`).run();
  const record = async (type,operationId) => {
    const req=new Request('https://test.invalid/attendance/record',{method:'POST',body:JSON.stringify({
      type,operationId,employeeId:'test-employee',location:{lat:24.7,lng:46.6,accuracy:10},deviceInfo:{},
    })});
    return handleAttendanceRequest({request:req,url:new URL(req.url),db:attendance,directoryDb:core,salonId:'main',
      resolveRequesterContext:async()=>({ok:true,uid:'test-uid',email:'staff@example.invalid',
        userData:{employeeId:'test-employee'},runtime:{isActive:true,role:'staff',permissionsAllow:['attendance.own.view']}}),
      fetchFirestoreDocument:async()=>null,queryFirestoreDocuments:async()=>[],
    });
  };
  const first=await record('check_in','self-in');
  assert.equal(first.status,200,await first.clone().text());
  assert.equal((await first.json()).result,'allowed');
  const state=await attendance.prepare('SELECT * FROM attendance_state').first();
  assert.equal(state.work_date,date);
  assert.ok(state.checkout_deadline_at,'normal recovery must preserve the shift window');
  const replay=await record('check_in','self-in');
  assert.equal((await replay.json()).result,'allowed');
  t.mock.timers.tick(8*3600000);
  const out=await record('check_out','self-out');
  assert.equal((await out.json()).result,'allowed');
  assert.equal((await attendance.prepare('SELECT COUNT(*) n FROM attendance_records').first()).n,2);
  assert.equal((await attendance.prepare("SELECT COUNT(*) n FROM attendance_operations WHERE status='completed'").first()).n,2);
});

test('retroactive paid leave survives a Core financial failure and recovers from a trigger-created outbox',async t => {
  const {attendance,core,entry} = await lockedFixture(t);
  const options={externalAttendanceDb:attendance};
  const leave=await createLeave(core,'main',{id:'retroactive-unpaid',employeeId:'test-employee',leaveType:'unpaid',startDate:date,endDate:date},actor);
  const offline={...core,prepare(sql) {if (sql.includes('FROM payroll_entries')) throw new Error('ISOLATED_PAYROLL_OFFLINE');return core.prepare(sql);}};
  const result=await decideLeave(offline,'main',leave.id,{status:'approved'},actor,options);
  assert.equal(result.status,'approved');
  assert.equal(result.payrollReconciliation.fullyCompleted,false);
  const pending=(await core.prepare("SELECT * FROM hr_payroll_operations WHERE status='pending' AND json_extract(response_json,'$.sourceType')='employee_leave'").all()).results;
  assert.equal(pending.length,1);
  assert.equal(JSON.parse(pending[0].before_records).status,'pending');
  assert.equal(JSON.parse(pending[0].after_records).status,'approved');
  await core.prepare("UPDATE hr_payroll_operations SET next_attempt_at='1970-01-01'").run();
  await recoverHrPayrollOperations(core,options);
  assert.equal((await core.prepare('SELECT status FROM hr_payroll_operations WHERE id=?').bind(pending[0].id).first()).status,'completed');
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
  const rows=(await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status='pending'").all()).results;
  assert.equal(rows.length,1);
  assert.equal(rows[0].direction,'deduction');
  const again=await decideLeave(core,'main',leave.id,{status:'approved'},actor,options);
  assert.equal(again.idempotent,true);
  assert.equal((await core.prepare("SELECT COUNT(*) n FROM payroll_carryover_adjustments WHERE status='pending'").first()).n,1);
});

test('retroactive unpaid permission remains saved with pending finance, then recovers exactly once',async t => {
  const {attendance,core,entry}=await lockedFixture(t);
  const offline={...core,prepare(sql) {if (sql.includes('FROM payroll_entries')) throw new Error('ISOLATED_PAYROLL_OFFLINE');return core.prepare(sql);}};
  const permission=await createPermissionRequest(offline,'main',{
    id:'isolated-permission',employeeId:'test-employee',source:'admin_direct',date,
    startTime:'11:00',expectedReturnTime:'12:00',reason:'Isolated retroactive permission',financialEffect:'unpaid',
  },actor,{externalAttendanceDb:attendance});
  assert.equal(permission.status,'returned');
  assert.equal(permission.payrollReconciliation.fullyCompleted,false);
  await core.prepare("UPDATE hr_payroll_operations SET next_attempt_at='1970-01-01'").run();
  await recoverHrPayrollOperations(core,{externalAttendanceDb:attendance});
  const job=await core.prepare("SELECT * FROM hr_payroll_operations WHERE json_extract(response_json,'$.sourceId')='isolated-permission'").first();
  assert.equal(job.status,'completed',job.last_error);
  assert.ok(job.reconciliation_json);
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
  const before=await core.prepare("SELECT COUNT(*) n FROM payroll_carryover_adjustments WHERE status='pending'").first();
  assert.equal(before.n,1,'an unpaid permission booking mirror must never refund existing late-time deductions');
  const adjustment=await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status='pending'").first();
  assert.equal(adjustment.direction,'deduction');
  assert.equal(adjustment.amount_halalas,1250);
  await recoverHrPayrollOperations(core,{externalAttendanceDb:attendance});
  assert.deepEqual(await core.prepare("SELECT COUNT(*) n FROM payroll_carryover_adjustments WHERE status='pending'").first(),before);
});

for (const [start,end,expected] of [['08:00','09:00',0],['08:30','09:30',625],['11:00','12:00',1250],['17:00','18:00',0]]) {
  test(`unpaid permission ${start}-${end} clips to the shift and does not charge missing attendance twice`,async t=>{
    const {attendance,core,entry}=await lockedFixture(t);
    const result=await createPermissionRequest(core,'main',{
      id:'clipped-permission',employeeId:'test-employee',source:'admin_direct',date,
      startTime:start,expectedReturnTime:end,reason:'Isolated overlap policy',financialEffect:'unpaid',
    },actor,{externalAttendanceDb:attendance});
    assert.equal(result.payrollReconciliation.fullyCompleted,true);
    const rows=(await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status='pending'").all()).results;
    assert.equal(rows.length,expected ? 1 : 0);
    if (expected) {assert.equal(rows[0].direction,'deduction');assert.equal(rows[0].amount_halalas,expected);}
    assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
  });
}

test('changing retroactive leave type through cancellation and canonical re-registration reverses the old financial effect',async t=>{
  const {attendance,core,entry}=await lockedFixture(t);
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-08-28T12:00:00.000Z')});
  const options={externalAttendanceDb:attendance};
  const unpaid=await createLeave(core,'main',{id:'type-unpaid',employeeId:'test-employee',leaveType:'unpaid',startDate:date,endDate:date},actor);
  await decideLeave(core,'main',unpaid.id,{status:'approved'},actor,options);
  let adjustment=await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status='pending'").first();
  assert.equal(adjustment.direction,'deduction');
  assert.equal(adjustment.amount_halalas,8750);
  await decideLeave(core,'main',unpaid.id,{status:'rejected'},actor,options);
  await core.prepare("UPDATE employee_employment SET start_date='2026-01-01'").run();
  await setAnnualLeaveOpeningBalance(core,'main','test-employee',{
    days:20,effectiveDate:'2026-08-01',operationId:'isolated-opening',reason:'Isolated leave type change',
  },actor);
  const annual=await createLeave(core,'main',{id:'type-annual',employeeId:'test-employee',leaveType:'annual',startDate:date,endDate:date},actor);
  const result=await decideLeave(core,'main',annual.id,{status:'approved',entitlementAsOfDate:date},actor,options);
  assert.equal(result.payrollReconciliation.fullyCompleted,true);
  adjustment=await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status='pending'").first();
  assert.equal(adjustment.direction,'addition');
  assert.equal(adjustment.amount_halalas,1250);
  assert.equal((await core.prepare("SELECT COUNT(*) n FROM payroll_carryover_adjustments WHERE status='pending'").first()).n,1);
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
});

test('historical punch correction remains reconcilable after employment ends',async t=>{
  const {attendance,core,entry}=await lockedFixture(t);
  await core.prepare("UPDATE employee_profiles SET status='inactive'").run();
  await core.prepare("UPDATE employee_employment SET employment_status='inactive',end_date='2026-08-31'").run();
  const response=await adjust(attendance,core,{checkInTime:'08:00',operationId:'former-employee'});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await core.prepare("SELECT amount_halalas FROM payroll_carryover_adjustments WHERE status='pending'").first()).amount_halalas,1250);
  assert.deepEqual(await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(entry.id).first(),entry);
});

for (const status of ['draft','approved','paid']) test(`${status}: real attendance correction preserves locked money and reconciles the canonical difference`,async t => {
  const {attendance,core} = await fixture(t);
  const options = {externalAttendanceDb:attendance};
  const seed = await adjustAttendanceRecords(request(body({checkInTime:'09:00',checkOutTime:'16:00',operationId:'seed'})),attendance,core,'main',actor);
  assert.equal(seed.status,200);
  const initial = await upsertPayrollEntry(core,'main',{
    id:'test-payroll',employeeId:'test-employee',payrollMonth:'2026-08',skipTargetBonus:true,
  },actor,options);
  if (status !== 'draft') await approvePayrollEntry(core,'main',initial.id,actor,options);
  if (status === 'paid') await markPayrollEntryPaid(core,'main',initial.id,actor,options);
  const before = await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(initial.id).first();
  const response = await adjustAttendanceRecords(request(body({checkInTime:'08:00',checkOutTime:'16:00',operationId:`op-${status}`})),attendance,core,'main',actor);
  assert.equal(response.status,200,await response.clone().text());
  const after = await core.prepare('SELECT * FROM payroll_entries WHERE id=?').bind(initial.id).first();
  const rows = (await core.prepare("SELECT * FROM payroll_carryover_adjustments WHERE status<>'void'").all()).results;
  if (status === 'draft') {
    assert.equal(rows.length,0);
    const refreshed = await upsertPayrollEntry(core,'main',{id:initial.id,employeeId:'test-employee',payrollMonth:'2026-08',skipTargetBonus:true},actor,options);
    assert.ok(refreshed.net_salary_halalas > before.net_salary_halalas,JSON.stringify({before,refreshed}));
  } else {
    assert.deepEqual(after,before,'approved / paid source entry is immutable');
    assert.equal(rows.length,1);
    assert.equal(rows[0].direction,'addition');
    assert.equal(rows[0].amount_halalas,1250);
    assert.equal(rows[0].target_payroll_month,'2026-09');
  }
});
