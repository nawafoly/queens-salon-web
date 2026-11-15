import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireFinalLeaveAuthority, assignApprovalAuthority, FINAL_LEAVE_APPROVAL_KEY } from './core/repositories/approval-authorities.js';

function dbFor(record) {
  return {
    __fakeD1: true,
    first: async (sql, params) => {
      assert.match(sql, /FROM approval_authorities a/);
      assert.deepEqual(params, ['main', FINAL_LEAVE_APPROVAL_KEY]);
      return record;
    },
  };
}

const assigned = {
  approver_user_id: 'ahmed-account-id',
  approver_uid: 'ahmed-firebase-uid',
  approver_role: 'owner',
  approver_status: 'active',
};
test('only explicitly designated owner may finalize leave; other Owners are reviewers', async () => {
  const db = dbFor(assigned);
  await assert.rejects(
    requireFinalLeaveAuthority(db, 'main', { userId: 'nawaf-account-id', role: 'owner' }),
    (err) => err.status === 403 && err.code === 'core_approval_authority:final_approver_required'
  );
  await assert.rejects(
    requireFinalLeaveAuthority(db, 'main', { userId: 'ghada-account-id', role: 'owner' }),
    (err) => err.status === 403 && err.code === 'core_approval_authority:final_approver_required'
  );
  await assert.doesNotReject(requireFinalLeaveAuthority(db, 'main', { userId: 'ahmed-account-id', role: 'owner' }));
});

test('final leave approver cannot approve their own leave', async () => {
  await assert.rejects(
    requireFinalLeaveAuthority(dbFor(assigned), 'main', { userId: 'ahmed-account-id', employeeId: 'EMP-A' }, 'EMP-A'),
    (err) => err.status === 403 && err.code === 'core_approval_authority:self_approval_forbidden'
  );
});

test('unconfigured or disabled final authority fails closed', async () => {
  await assert.rejects(
    requireFinalLeaveAuthority(dbFor(null), 'main', { userId: 'any' }),
    (err) => err.status === 409 && err.code === 'core_approval_authority:not_configured'
  );
  await assert.rejects(
    requireFinalLeaveAuthority(dbFor({ ...assigned, approver_status: 'disabled' }), 'main', { userId: 'ahmed-account-id' }),
    (err) => err.status === 403
  );
});

test('leave finalization guards exist on direct leave and request workflows', async () => {
  const source = await readFile(new URL('./core/index.js', import.meta.url), 'utf8');
  for (const route of ['leave:approve', 'leave:reject', 'employee-request:action']) {
    assert.ok(source.includes('case "' + route + '"'));
  }
  assert.match(source, /requestRow\.request_type === "leave" && \([\s\S]*?\["approve", "reject", "execute"\]/);
  const guardPosition = source.indexOf('if (requestRow.request_type === "leave" && (');
  const selfActionPosition = source.indexOf('const employeeActions = new Set(["answer-info", "cancel"])');
  assert.ok(guardPosition > 0 && selfActionPosition > guardPosition,
    'approved leave cancellation authority check must precede early self-service return');
  assert.match(source, /case "leave:approve":[\s\S]*?await requireFinalLeaveAuthority/);
  assert.match(source, /case "leave:reject":[\s\S]*?await requireFinalLeaveAuthority/);
});

test('new authority table has exactly one approver per workflow and no implicit owner grant', async () => {
  const migration = await readFile(new URL('../migrations/core/0101_single_final_approval_authority.sql', import.meta.url), 'utf8');
  assert.match(migration, /PRIMARY KEY \(salon_id, authority_key\)/);
  assert.doesNotMatch(migration, /INSERT INTO approval_authorities/i);
});

test('custom leave approval persists policy and execution is pinned to the approved event', async () => {
  const core = await readFile(new URL('./core/repositories/employee-requests-legacy.js', import.meta.url), 'utf8');
  assert.match(core, /actionKey === 'approve' && row\.request_type === 'leave'[\s\S]*?manualLeavePolicy: manualPolicy/);
  assert.match(core, /SELECT payload_json FROM employee_request_events[\s\S]*?to_status = 'approved'/);
  assert.match(core, /if \(!approvedPolicy\) throw new AppError\(409, 'core_leave:hr_review_resolution_required'\)/);
  assert.match(core, /core_leave:approved_policy_mismatch/);
  assert.match(core, /input = \{ \.\.\.input, manualLeavePolicy: approvedPolicy \}/);
  const ui = await readFile(new URL('../src/pages/hr/AdminEmployeeRequests.tsx', import.meta.url), 'utf8');
  assert.match(ui, /kind === "execute" \? confirmed\.manualLeavePolicy : proposed/);
  assert.match(ui, /السياسة المالية المعتمدة نهائيًا \(للقراءة فقط\)/);
});

test('custom leave execution resolves approved policy before the Core compliance guard', async () => {
  const { transitionEmployeeRequest } = await import('./core/repositories/employee-requests.js');
  const row = {
    request_type: 'leave',
    status: 'approved',
    source_reference_id: null,
    payload_json: JSON.stringify({ leaveType: 'other_hr_review' }),
    employee_id: 'employee-1',
  };
  const policy = { deductFromBalance: true, affectsPayroll: false };
  const approval = { payload_json: JSON.stringify({ manualLeavePolicy: policy }) };
  function fakeDb(event) {
    return {
      __fakeD1: true,
      first: async (sql) => {
        if (sql.includes('SELECT request_type, status')) return row;
        if (sql.includes('FROM employee_request_events')) return event;
        // A missing legacy row proves the request passed the wrapper's
        // compliance gate; no data mutations are made in this test.
        return null;
      },
    };
  }
  const opts = { manualLeavePolicyAuthorized: true };
  const args = ['main', 'request-1', 'execute'];
  await assert.rejects(
    transitionEmployeeRequest(fakeDb(null), ...args, {}, {}, opts),
    (err) => err.status === 409 && err.code === 'core_leave:hr_review_resolution_required'
  );
  await assert.rejects(
    transitionEmployeeRequest(fakeDb(approval), ...args, {
      manualLeavePolicy: { deductFromBalance: false, affectsPayroll: false },
    }, {}, opts),
    (err) => err.status === 409 && err.code === 'core_leave:approved_policy_mismatch'
  );
  await assert.rejects(
    transitionEmployeeRequest(fakeDb(approval), ...args, {}, {}, opts),
    (err) => err.status === 404 && err.code === 'core_employee_request:not_found'
  );
  await assert.rejects(
    transitionEmployeeRequest(fakeDb(approval), ...args, { manualLeavePolicy: policy }, {}, opts),
    (err) => err.status === 404 && err.code === 'core_employee_request:not_found'
  );
  await assert.rejects(
    transitionEmployeeRequest(fakeDb(approval), ...args, {}, {}, {}),
    (err) => err.status === 409 && err.code === 'core_leave:hr_review_resolution_required'
  );
});

test('concurrent loser cannot insert a phantom approved-policy event', async () => {
  const source = await readFile(new URL('./core/repositories/employee-requests-legacy.js', import.meta.url), 'utf8');
  const update = source.indexOf('async function updateStatus(');
  const end = source.indexOf('async function refreshPermissionPayrollEntries(', update);
  const transition = source.slice(update, end);
  assert.match(transition, /WHERE salon_id = \? AND id = \? AND version = \?/);
  assert.match(transition, /INSERT OR IGNORE INTO employee_request_events[\s\S]*?WHERE changes\(\) = 1/);
  assert.match(transition, /changes\(results\?\.\[0\]\) !== 1/);
  const code = transition.slice(transition.indexOf('const results = await dbBatch'));
  assert.ok(code.indexOf('UPDATE employee_requests') < code.indexOf('INSERT OR IGNORE INTO employee_request_events'));
});

test('staging final-approver rollout uses isolated D1, attendance, R2 and salon', async () => {
  const staging = JSON.parse(await readFile(new URL('../wrangler.core.staging.jsonc', import.meta.url), 'utf8'));
  const productionText = await readFile(new URL('../wrangler.core.jsonc', import.meta.url), 'utf8');
  const production = JSON.parse(productionText.replace(/^\uFEFF/, ''));
  assert.equal(staging.vars.SALON_ID, 'staging');
  assert.notEqual(staging.name, production.name);
  for (const binding of ['CORE_DB', 'ATTENDANCE_DB']) {
    const stage = staging.d1_databases.find((item) => item.binding === binding);
    const prod = production.d1_databases.find((item) => item.binding === binding);
    assert.ok(stage && prod, binding + ' must exist in both environments');
    assert.notEqual(stage.database_id, prod.database_id, binding + ' must use independent databases');
    assert.notEqual(stage.database_name, prod.database_name, binding + ' must use independent names');
  }
  assert.notEqual(staging.r2_buckets[0].bucket_name, production.r2_buckets[0].bucket_name);
  assert.notEqual(staging.vars.FIREBASE_PROJECT_ID, production.vars.FIREBASE_PROJECT_ID);
});


test('final leave approver is managed only from administrative D1 account settings', async () => {
  const settings = await readFile(new URL('../src/pages/settings/SettingsUsers.tsx', import.meta.url), 'utf8');
  const requests = await readFile(new URL('../src/pages/hr/AdminEmployeeRequests.tsx', import.meta.url), 'utf8');
  assert.match(settings, /صلاحيات الاعتماد الحصرية/);
  assert.match(settings, /LeaveFinalApprovalService\.assign\(targetApproverUserId\)/);
  assert.match(settings, /assignedLeaveApproverId === me\?\.id/);
  assert.match(settings, /leaveAuthorityLoadFailed/);
  assert.match(settings, /!!assignedLeaveApproverId/);
  assert.match(settings, /account\.primaryRole === "owner" && account\.status === "active"/);
  assert.match(settings, /account\.id !== me\?\.id/);
  assert.match(requests, /المعتمد الحالي:/);
  assert.doesNotMatch(requests, /LeaveFinalApprovalService\.assign\(/);
  assert.doesNotMatch(requests, /تعيين المعتمد النهائي/);
});


test('former assigning Owner cannot change final approver after appointment', async () => {
  let attemptedWrite = false;
  const db = {
    __fakeD1: true,
    first: async (sql) => {
      if (sql.includes('FROM app_users')) {
        return { id: 'other-owner-id', primary_role: 'owner', status: 'active' };
      }
      if (sql.includes('FROM approval_authorities')) {
        return { approver_user_id: 'current-approver-id' };
      }
      throw new Error('Unexpected query in authority transfer check');
    },
    batch: async () => {
      attemptedWrite = true;
      throw new Error('Unauthorized transfer reached mutation');
    },
  };
  await assert.rejects(
    assignApprovalAuthority(db, 'staging', FINAL_LEAVE_APPROVAL_KEY,
      'other-owner-id', { userId: 'initial-assigning-owner-id', role: 'owner' }),
    (error) => error.status === 403 &&
      error.code === 'core_approval_authority:delegation_requires_incumbent'
  );
  assert.equal(attemptedWrite, false, 'forbidden transfer must not mutate D1');
});
