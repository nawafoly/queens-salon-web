import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAccountDisplayName,
  serializeAccount
} from './core/repositories/accounts.js';

const account = Object.freeze({
  id: 'account-1',
  salon_id: 'main',
  firebase_uid: 'firebase-1',
  display_name: 'Old account name',
  email: 'employee@example.test',
  phone: '0500000000',
  primary_role: 'admin',
  status: 'active',
  email_verified: 1
});

const link = Object.freeze({
  id: 'link-1',
  salon_id: 'main',
  user_id: 'account-1',
  employee_id: 'employee-1',
  employee_name: 'Updated employee name',
  link_status: 'active'
});

test('linked account uses the canonical employee name', () => {
  assert.equal(
    serializeAccount(account, null, link).displayName,
    'Updated employee name'
  );
});

test('employee rename is reflected without account mutation', () => {
  const renamed = {
    ...link,
    employee_name: 'New employee name'
  };

  assert.equal(
    serializeAccount(account, null, renamed).displayName,
    'New employee name'
  );

  assert.equal(account.display_name, 'Old account name');
});

test('unlinked account preserves its independent name', () => {
  assert.equal(
    serializeAccount(account).displayName,
    'Old account name'
  );

  assert.equal(
    resolveAccountDisplayName(account, {
      ...link,
      link_status: 'unlinked'
    }),
    'Old account name'
  );
});

test('blank linked employee name preserves account name', () => {
  for (const name of ['', '  ', null, undefined]) {
    assert.equal(
      resolveAccountDisplayName(account, {
        ...link,
        employee_name: name
      }),
      'Old account name'
    );
  }
});

test('foreign tenant cannot supply an account display name', () => {
  assert.equal(
    resolveAccountDisplayName(account, {
      ...link,
      salon_id: 'another-salon'
    }),
    'Old account name'
  );
});

test('foreign account link cannot supply a display name', () => {
  assert.equal(
    resolveAccountDisplayName(account, {
      ...link,
      user_id: 'another-account'
    }),
    'Old account name'
  );
});

test('invalid employee link cannot override account identity', () => {
  assert.equal(
    resolveAccountDisplayName(account, {
      ...link,
      employee_id: ''
    }),
    'Old account name'
  );
});

test('canonical display name preserves account security fields', () => {
  const permissions = {
    rolePermissions: ['employees.view'],
    allowedPermissions: ['attendance.view'],
    deniedPermissions: ['payroll.manage'],
    effectivePermissions: [
      'employees.view',
      'attendance.view'
    ]
  };

  const before = serializeAccount(account, permissions, null);
  const after = serializeAccount(account, permissions, link);

  for (const key of [
    'id',
    'uid',
    'firebaseUid',
    'salonId',
    'email',
    'phone',
    'role',
    'primaryRole',
    'status',
    'active',
    'permissions',
    'effectivePermissions',
    'allowedPermissions',
    'deniedPermissions'
  ]) {
    assert.deepEqual(after[key], before[key], key);
  }

  assert.equal(after.employeeLink.employeeId, 'employee-1');
  assert.equal(after.displayName, 'Updated employee name');
});

test('Arabic employee names remain intact', () => {
  const name = '\u0646\u0648\u0641\u0644 \u0623\u062D\u0645\u062F';

  assert.equal(
    serializeAccount(account, null, {
      ...link,
      employee_name: name
    }).displayName,
    name
  );
});

test('HR08C real D1: rename propagates to account list, detail and auth session', async t => {
  const { Miniflare } = await import('miniflare');
  const { readFile } = await import('node:fs/promises');

  const {
    getAccountById,
    getAccountDetail,
    listAccounts,
    serializeAuthMe,
    replaceEmployeeLink,
    deleteEmployeeLink
  } = await import('./core/repositories/accounts.js');

  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "core-test-worker",
          compatibilityDate: "2026-06-24",
          manifest: {
            mainModule: "script-0.mjs",
            modulesRoot: process.cwd(),
            modules: {
              "script-0.mjs": { type: "esm", contents: script },
            },
          },
          env: {
            CORE_DB: { type: "d1", id: "core-test" },
          },
          exports: {},
        },
        dev: { rootPath: process.cwd() },
      },
    ],
  });

  t.after(async () => {
    await mf.dispose();
  });

  const db = await mf.getD1Database('CORE_DB');

  for (const migration of [
    '0001_core_schema.sql',
    '0004_admin_operations.sql',
    '0005_hr_settings_files.sql',
    '0014_app_users_permissions.sql',
    '0033_app_user_profile_photo.sql',
    '0101_single_final_approval_authority.sql'
  ]) {
    const sql = (
      await readFile(
        new URL(`../migrations/core/${migration}`, import.meta.url),
        'utf8'
      )
    )
      .replace(/\r/g, '')
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    for (const statement of sql.split(';').map(v => v.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }

  const now = new Date().toISOString();

  async function seedAccount(id, uid, name, role) {
    await db.prepare(`
      INSERT INTO app_users (
        id, firebase_uid, salon_id, email, display_name,
        primary_role, status, email_verified, created_at, updated_at
      ) VALUES (?, ?, 'main', ?, ?, ?, 'active', 1, ?, ?)
    `).bind(
      id, uid, `${id}@example.test`, name, role, now, now
    ).run();
  }

  await seedAccount(
    'hr08-owner', 'hr08-owner-uid', 'Owner', 'owner'
  );

  await seedAccount(
    'hr08-account', 'hr08-account-uid', 'Independent account name', 'owner'
  );

  await db.prepare(`
    INSERT INTO employee_profiles (
      id, salon_id, name, status, created_at, updated_at
    ) VALUES (?, 'main', ?, 'active', ?, ?)
  `).bind(
    'hr08-employee', 'Original employee name', now, now
  ).run();

  const actor = {
    role: 'owner',
    uid: 'hr08-owner-uid',
    user: {
      id: 'hr08-owner',
      primary_role: 'owner'
    }
  };

  const before = await getAccountById(
    db, 'main', 'hr08-account'
  );

  await replaceEmployeeLink(
    db,
    'main',
    'hr08-account',
    { employeeId: 'hr08-employee' },
    actor
  );

  const linkedDetail = await getAccountDetail(
    db, 'main', 'hr08-account'
  );

  assert.equal(linkedDetail.displayName, 'Original employee name');

  const {
    getApprovalAuthority,
    requireFinalLeaveAuthority,
    FINAL_LEAVE_APPROVAL_KEY
  } = await import('./core/repositories/approval-authorities.js');

  await db.prepare(`
    INSERT INTO approval_authorities (
      salon_id,
      authority_key,
      approver_user_id,
      assigned_by_user_id,
      assigned_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    'main',
    FINAL_LEAVE_APPROVAL_KEY,
    'hr08-account',
    'hr08-owner',
    now,
    now
  ).run();

  const authorityBefore = await getApprovalAuthority(db, 'main');

  assert.equal(
    authorityBefore.approver_name,
    'Original employee name'
  );

  const authorityActor = {
    uid: 'hr08-account-uid',
    userId: 'hr08-account',
    role: 'owner',
    employeeId: 'hr08-employee'
  };

  await assert.doesNotReject(
    requireFinalLeaveAuthority(
      db, 'main', authorityActor, 'another-employee'
    )
  );

  await assert.rejects(
    requireFinalLeaveAuthority(
      db, 'main', authorityActor, 'hr08-employee'
    ),
    error => error.status === 403
  );

  const newName = '\u0646\u0648\u0641\u0644 \u0623\u062D\u0645\u062F';

  await db.prepare(`
    UPDATE employee_profiles
       SET name = ?, updated_at = ?
     WHERE salon_id = ? AND id = ?
  `).bind(
    newName, new Date().toISOString(), 'main', 'hr08-employee'
  ).run();

  const detail = await getAccountDetail(
    db, 'main', 'hr08-account'
  );

  const rows = await listAccounts(
    db, 'main', { scope: 'internal' }
  );

  const listRow = rows.find(row => row.id === 'hr08-account');

  const rawAccount = await getAccountById(
    db, 'main', 'hr08-account'
  );

  const session = await serializeAuthMe(
    db, 'main', rawAccount
  );

  assert.equal(detail.displayName, newName);
  assert.equal(listRow.displayName, newName);
  assert.equal(session.user.displayName, newName);

  const authorityAfter = await getApprovalAuthority(db, 'main');

  assert.equal(authorityAfter.approver_name, newName);

  for (const key of [
    'salon_id',
    'authority_key',
    'approver_user_id',
    'assigned_by_user_id',
    'assigned_at',
    'updated_at',
    'approver_email',
    'approver_uid',
    'approver_status',
    'approver_role'
  ]) {
    assert.deepEqual(
      authorityAfter[key],
      authorityBefore[key],
      key
    );
  }

  await assert.rejects(
    requireFinalLeaveAuthority(
      db, 'main', {
        role: 'owner',
        userId: 'hr08-owner'
      },
      'another-employee'
    ),
    error =>
      error.status === 403 &&
      error.code === 'core_approval_authority:final_approver_required'
  );

  console.log('PASS: approver rename preserves exclusive authority');

  assert.deepEqual(rawAccount, before);

  assert.deepEqual(
    detail.effectivePermissions,
    linkedDetail.effectivePermissions
  );

  assert.equal(
    detail.employeeLink.employeeId,
    'hr08-employee'
  );

  console.log('PASS: canonical name propagated without account writes');

  await deleteEmployeeLink(
    db, 'main', 'hr08-account', actor
  );

  const unlinked = await getAccountDetail(
    db, 'main', 'hr08-account'
  );

  assert.equal(
    unlinked.displayName,
    'Independent account name'
  );

  assert.equal(unlinked.employeeLink, null);

  const authorityUnlinked = await getApprovalAuthority(db, 'main');

  assert.equal(
    authorityUnlinked.approver_name,
    'Independent account name'
  );

  assert.equal(
    authorityUnlinked.approver_user_id,
    'hr08-account'
  );

  console.log('PASS: approver unlink preserves assigned account');

  console.log('PASS: unlink preserves independent account name');
});
