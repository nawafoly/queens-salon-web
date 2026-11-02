import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { getAccountPermissionBundle, getPermissionCatalog } from './core/repositories/accounts.js';

test('owner permission resolution uses the PRIMARY KEY covering index, without caching grants', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("CREATE TABLE permissions(permission_key TEXT PRIMARY KEY, group_key TEXT NOT NULL, label TEXT NOT NULL, description TEXT)");
    sqlite.exec("CREATE TABLE user_permissions(salon_id TEXT NOT NULL,user_id TEXT NOT NULL,permission_key TEXT NOT NULL,effect TEXT NOT NULL)");
    const insert = sqlite.prepare("INSERT INTO permissions(permission_key,group_key,label,description) VALUES (?,?,?,?)");
    for (let i = 0; i < 140; i++) {
      const permission = 'test.permission.' + String(i).padStart(3, '0');
      insert.run(permission, i % 2 === 0 ? 'group-a' : 'group-b', 'Label ' + i, 'Description ' + i);
    }

    const executedSql = [];
    const db = { __fakeD1: true, all(sql, bindings) {
      executedSql.push(sql);
      return sqlite.prepare(sql).all(...bindings);
    } };

    const owner = { id: 'owner-1', primary_role: 'owner' };
    const first = await getAccountPermissionBundle(db, 'main', owner);
    assert.equal(first.effectivePermissions.length, 140);
    assert.deepEqual(first.effectivePermissions, [...first.effectivePermissions].sort());
    assert.ok(executedSql.includes('SELECT permission_key FROM permissions ORDER BY permission_key'));
    assert.ok(!executedSql.some(sql => /SELECT \* FROM permissions/.test(sql)));

    const plan = sqlite.prepare('EXPLAIN QUERY PLAN SELECT permission_key FROM permissions ORDER BY permission_key').all();
    assert.ok(plan.some(row => /USING COVERING INDEX/i.test(row.detail)), JSON.stringify(plan));

    insert.run('test.new.permission', 'new-group', 'new label', 'new description');
    const second = await getAccountPermissionBundle(db, 'main', owner);
    assert.ok(second.effectivePermissions.includes('test.new.permission'), 'a newly inserted permission must apply immediately');
    sqlite.prepare('DELETE FROM permissions WHERE permission_key = ?').run('test.new.permission');
    const third = await getAccountPermissionBundle(db, 'main', owner);
    assert.ok(!third.effectivePermissions.includes('test.new.permission'), 'removed permission must be revoked immediately');

    const catalogue = await getPermissionCatalog(db);
    assert.equal(catalogue.length, 140);
    assert.ok(catalogue.every(row => typeof row.label === 'string' && typeof row.group_key === 'string'), 'full admin catalogue metadata remains intact');
  } finally {
    sqlite.close();
  }
});

test('role-specific permission rows retain direct allow/deny behavior', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("CREATE TABLE permissions(permission_key TEXT PRIMARY KEY, group_key TEXT NOT NULL, label TEXT NOT NULL)");
    sqlite.exec("CREATE TABLE role_permissions(salon_id TEXT NOT NULL, role_key TEXT NOT NULL, permission_key TEXT NOT NULL)");
    sqlite.exec("CREATE TABLE user_permissions(salon_id TEXT NOT NULL,user_id TEXT NOT NULL,permission_key TEXT NOT NULL,effect TEXT NOT NULL)");
    sqlite.exec("INSERT INTO role_permissions VALUES('main','reception','bookings.view')");
    sqlite.exec("INSERT INTO user_permissions VALUES('main','reception-1','bookings.view','deny')");
    sqlite.exec("INSERT INTO user_permissions VALUES('main','reception-1','clients.view','allow')");
    const db = { __fakeD1: true, all: (sql, bindings) => sqlite.prepare(sql).all(...bindings) };
    const bundle = await getAccountPermissionBundle(db, 'main', { id: 'reception-1', primary_role: 'reception' });
    assert.ok(!bundle.effectivePermissions.includes('bookings.view'));
    assert.ok(bundle.effectivePermissions.includes('clients.view'));
  } finally {
    sqlite.close();
  }
});
