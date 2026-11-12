import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireFinalLeaveAuthority, FINAL_LEAVE_APPROVAL_KEY } from './core/repositories/approval-authorities.js';

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
  assert.match(source, /case "leave:approve":[\s\S]*?await requireFinalLeaveAuthority/);
  assert.match(source, /case "leave:reject":[\s\S]*?await requireFinalLeaveAuthority/);
});

test('new authority table has exactly one approver per workflow and no implicit owner grant', async () => {
  const migration = await readFile(new URL('../migrations/core/0100_single_final_approval_authority.sql', import.meta.url), 'utf8');
  assert.match(migration, /PRIMARY KEY \(salon_id, authority_key\)/);
  assert.doesNotMatch(migration, /INSERT INTO approval_authorities/i);
});
