import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import coreWorker from './core/index.js';
import { requestFingerprint } from './core/idempotency.js';
import { listIncome } from './core/repositories/finance.js';
import packagesWorker from './packages-worker.js';
import { clearD1WalletRuntimeCaches, expireClientPackagesD1 } from './packages/d1.js';
import { applyCoreTestMigrations } from './test-support/miniflare-core-migrations.mjs';
import { sqliteD1 } from './test-support/sqlite-d1.mjs';

const project = 'packages-test';
const now = '2026-01-01T00:00:00.000Z';
const future = '2100-01-01T00:00:00.000Z';
const productionOrigins = [
  'https://queens-salon-web.vercel.app',
  'https://queens-salon-web-gnxk.vercel.app',
];
const migrations = [
  '0001_core_schema.sql', '0003_booking_availability.sql', '0004_admin_operations.sql',
  '0005_hr_settings_files.sql', '0007_booking_soft_delete.sql', '0011_unify_packages_into_core.sql',
  '0014_app_users_permissions.sql', '0056_core_request_idempotency.sql',
  '0094_day_audit_closings.sql', '0095_payment_correction_proposals.sql',
  '0096_payment_correction_applied_ledger.sql', '0097_financial_day_revisions.sql',
  '0098_closed_financial_day_write_guards.sql', '0114_package_sale_settlement.sql',
];

function setup(t) {
  clearD1WalletRuntimeCaches();
  const db = sqliteD1();
  t.after(() => db.database.close());
  db.database.exec('PRAGMA foreign_keys = ON');
  for (const name of migrations) {
    db.database.exec(readFileSync(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'));
  }
  for (const [uid, salon, role] of [
    ['owner', 'main', 'owner'], ['admin', 'main', 'admin'], ['reception', 'main', 'reception'],
    ['a-user', 'main', 'client'], ['b-user', 'main', 'client'], ['empty-user', 'main', 'client'],
    ['other-owner', 'other', 'owner'],
  ]) {
    db.database.prepare(`
      INSERT INTO app_users (id, firebase_uid, salon_id, primary_role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(uid, uid, salon, role, now, now);
  }
  for (const [id, salon, uid] of [
    ['client-a', 'main', 'a-user'], ['client-b', 'main', 'b-user'],
    ['legacy-a', 'main', null], ['client-other', 'other', null],
  ]) {
    db.database.prepare(`
      INSERT INTO clients (id, canonical_client_id, salon_id, name, firebase_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, id, salon, id, uid, now, now);
  }
  db.database.exec("UPDATE clients SET legacy_ids_json = '[\"legacy-a\"]' WHERE id = 'client-a'");
  db.database.prepare("INSERT INTO client_aliases VALUES ('main', 'old-a', 'client-a', 'migration', ?)").run(now);
  for (const [id, salon] of [['catalog-main', 'main'], ['catalog-other', 'other']]) {
    db.database.prepare(`
      INSERT INTO package_catalog
        (id, salon_id, name, total_sessions, price, allowed_service_ids_json, created_at, updated_at)
      VALUES (?, ?, 'Test package', 3, 120, '["service-a","service-b"]', ?, ?)`).run(id, salon, now, now);
  }
  const env = { CORE_DB: db, SALON_ID: 'main', FIREBASE_PROJECT_ID: project, FIREBASE_AUTH_EMULATOR_HOST: 'local-test' };
  return { db, env, call: (path, options) => send(env, path, options) };
}

function tokenFor(uid, claims) {
  const payload = { aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid, ...claims };
  return `local.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test`;
}

async function send(env, path, { uid = 'owner', claims, token = tokenFor(uid, claims), body, idempotencyKey } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await coreWorker.fetch(new Request(`https://worker.test/api/core/packages/${path}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: response.status, ...(await response.json()) };
}

function seedPackage(db, id, { salon = 'main', client = 'client-a', sessions = 3, expires = future } = {}) {
  const catalog = `catalog-${salon}`;
  db.database.prepare(`
    INSERT INTO client_packages
      (id, salon_id, canonical_client_id, package_catalog_id, package_name_snapshot, allowed_service_ids_json,
       total_sessions, remaining_sessions, purchased_at, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Test package', '["service-a","service-b"]', ?, ?, ?, ?, ?, ?)`
  ).run(id, salon, client, catalog, sessions, sessions, now, expires, now, now);
}

function snapshot(db) {
  return Object.fromEntries(
    ['clients', 'client_aliases', 'package_catalog', 'client_packages', 'package_transactions', 'package_sales',
      'invoices', 'payments', 'income_entries', 'audit_logs', 'financial_day_revisions',
      'day_audit_closings', 'core_idempotency_operations']
      .map((table) => [table, db.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
}

function balance(db, id) {
  const row = db.database.prepare(`
    SELECT total_sessions, remaining_sessions, reserved_sessions, used_sessions FROM client_packages WHERE id = ?
  `).get(id);
  const { total_sessions: total, remaining_sessions: remaining, reserved_sessions: reserved, used_sessions: used } = row;
  assert.ok([remaining, reserved, used].every((n) => Number.isInteger(n) && n >= 0));
  assert.equal(total, remaining + reserved + used);
  return [remaining, reserved, used];
}

function assertStatus(result, status) {
  assert.equal(result.status, status, JSON.stringify(result));
}

const purchase = { clientId: 'client-a', packageCatalogId: 'catalog-main', invoiceId: 'invoice-reference', paymentMethod: 'cash' };
const redeem = { clientId: 'client-a', clientPackageId: 'package-a', serviceId: 'service-a', bookingId: 'booking-a', cartItemId: 'item-a', operationId: 'movement-a' };

test('Core packages rejects missing and invalid authentication without writes', async (t) => {
  const { db, call } = setup(t);
  const before = snapshot(db);
  for (const token of [null, 'invalid', tokenFor('owner', { exp: 1 })]) {
    const result = await call('purchase', { body: purchase, token });
    assertStatus(result, 401);
  }
  assert.deepEqual(snapshot(db), before);
});

test('Package HTTP replay is durable, actor-bound and rechecks live authorization', async (t) => {
  const { db, call } = setup(t);
  const options = { body: purchase, idempotencyKey: 'purchase-http-key' };
  const first = await call('purchase', options);
  assertStatus(first, 200);
  assert.deepEqual(await call('purchase', options), first);
  const state = snapshot(db);
  assert.equal(state.core_idempotency_operations.length, 1);
  assertStatus(await call('purchase', { ...options, uid: 'admin' }), 409);
  assertStatus(await call('purchase', { ...options, uid: 'a-user' }), 403);
  assertStatus(await call('purchase', { ...options, uid: 'a-user', idempotencyKey: 'unused-client-key' }), 403);
  assertStatus(await call('purchase', { ...options, token: null }), 401);
  db.database.exec("UPDATE app_users SET status = 'disabled' WHERE id = 'owner'");
  assertStatus(await call('purchase', options), 403);
  const after = snapshot(db);
  assert.deepEqual(after, state);
});

test('Package catalog creation keeps durable HTTP replay and enforces live catalog permissions', async (t) => {
  const { db, call } = setup(t);
  const options = {
    body: { name: 'New package', sessionsCount: 3, price: 120, allowedServiceIds: ['service-a'] },
    idempotencyKey: 'create-catalog',
  };
  const first = await call('admin/catalog', options);
  assertStatus(first, 200);
  assert.deepEqual(await call('admin/catalog', options), first);
  const state = snapshot(db);
  assertStatus(await call('admin/catalog', { ...options, uid: 'reception' }), 403);
  assertStatus(await call('admin/catalog', { ...options, body: { ...options.body, price: 121 } }), 409);
  assert.deepEqual(snapshot(db), state);
});

test('Rejected package mutations abandon their pending HTTP replay record', async (t) => {
  const { db, call } = setup(t);
  const before = snapshot(db);
  assertStatus(await call('redeem', { body: redeem, idempotencyKey: 'rejected-redeem' }), 404);
  assert.deepEqual(snapshot(db), before);
});

const corsSurfaces = [
  [coreWorker, '/api/core/packages', 'wrangler.core.jsonc'],
  [packagesWorker, '/api/packages', 'wrangler.packages.jsonc'],
];

async function corsResponse(worker, path, config, origin) {
  const { vars } = JSON.parse(readFileSync(new URL(`../${config}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  return worker.fetch(new Request(`https://worker.test${path}/purchase`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key' },
  }), { ALLOWED_ORIGINS: vars.ALLOWED_ORIGINS });
}

test('Core and Packages CORS permit both configured production dashboard origins', async () => {
  for (const surface of corsSurfaces) {
    for (const origin of productionOrigins) {
      const response = await corsResponse(...surface, origin);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
      assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
      assert.match(response.headers.get('Access-Control-Allow-Headers'), /Idempotency-Key/i);
      assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
      assert.match(response.headers.get('Vary'), /Origin/i);
    }
  }
});

test('Core and Packages CORS reject unrelated and deceptive origins', async () => {
  for (const surface of corsSurfaces) {
    for (const origin of ['https://untrusted.example', `${productionOrigins[0]}.example`, 'null']) {
      const response = await corsResponse(...surface, origin);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    }
  }
});

test('Core packages denies client purchase and redemption despite administrative claims', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  const before = snapshot(db);
  for (const [path, body] of [['purchase', purchase], ['redeem', redeem], ['reserve', redeem], ['redemption/consume', redeem]]) {
    assertStatus(await call(path, { uid: 'a-user', claims: { role: 'owner' }, body }), 403);
  }
  assert.deepEqual(snapshot(db), before);
});

test('Core packages lists safe fields only for owner and admin and observes role revocation', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  const path = 'admin/list-client-packages';
  const before = snapshot(db);
  for (const uid of ['owner', 'admin']) {
    const result = await call(path, { uid });
    assertStatus(result, 200);
    assert.deepEqual(Object.keys(result.data[0]).sort(), [
      'canonicalClientId', 'clientName', 'expiresAt', 'packageName', 'phone', 'remainingSessions',
      'reservedSessions', 'status', 'totalSessions', 'usedSessions',
    ]);
  }
  for (const uid of ['a-user', 'reception']) assertStatus(await call(path, { uid }), 403);
  assert.deepEqual(snapshot(db), before);
  db.database.exec("UPDATE app_users SET primary_role = 'client' WHERE id = 'admin'");
  assertStatus(await call(path, { uid: 'admin', claims: { role: 'admin' } }), 403);
  db.database.exec("UPDATE app_users SET status = 'disabled' WHERE id = 'admin'");
  assert.equal((await call(path, { uid: 'admin' })).error, 'ACCOUNT_DISABLED');
  assert.deepEqual(snapshot(db), before);
});

test('Core package endpoints fail closed when the binding or the tenant account is unavailable', async (t) => {
  const { db, env, call } = setup(t);
  const before = snapshot(db);
  assertStatus(await send({ ...env, CORE_DB: undefined }, 'purchase', { body: purchase }), 503);
  assertStatus(await call('purchase', { uid: 'unknown', body: purchase }), 403);
  assertStatus(await call('purchase', { body: { ...purchase, salonId: 'other' } }), 403);
  assert.deepEqual(snapshot(db), before);
});

test('Core wallet derives identity from Firebase UID and retains migrated package ownership', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { client: 'legacy-a' });
  seedPackage(db, 'package-b', { client: 'client-b' });
  seedPackage(db, 'package-other', { client: 'client-other', salon: 'other' });
  const before = snapshot(db);
  const result = await call('my-wallet?clientId=client-b&phone=0500000002', {
    uid: 'a-user', claims: { clientId: 'client-b' },
  });
  assertStatus(result, 200);
  assert.equal(result.data.canonicalClientId, 'client-a');
  assert.deepEqual(result.data.packages.map(({ id }) => id), ['package-a']);
  assertStatus(await call('my-wallet?salonId=other', { uid: 'a-user' }), 403);
  assertStatus(await call('client-wallet', { uid: 'a-user', body: { clientId: 'client-b' } }), 403);
  assert.deepEqual(snapshot(db), before);
});

test('Core wallet fails closed when a UID-shaped record belongs to a different client', async (t) => {
  const { db, call } = setup(t);
  db.database.prepare(`
    INSERT INTO clients (id, canonical_client_id, salon_id, name, firebase_uid, created_at, updated_at)
    VALUES ('empty-user', 'empty-user', 'main', 'Other person', 'different-user', ?, ?)
  `).run(now, now);
  seedPackage(db, 'unrelated-package', { client: 'empty-user' });
  const before = snapshot(db);
  const result = await call('my-wallet', { uid: 'empty-user' });
  if (result.status === 200) assert.deepEqual(result.data.packages, []);
  else assertStatus(result, 409);
  assert.deepEqual(snapshot(db), before);
});

test('Wallet excludes legacy IDs owned by another linked client and ignores lookup-only aliases', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { client: 'legacy-a' });
  seedPackage(db, 'package-b', { client: 'client-b' });
  db.database.exec("UPDATE clients SET legacy_ids_json = '[\"legacy-a\",\"client-b\"]' WHERE id = 'client-a'");
  db.database.prepare("INSERT INTO client_aliases VALUES ('main', 'unverified', 'client-a', 'lookup', ?)").run(now);
  const before = snapshot(db);
  const wallet = await call('my-wallet', { uid: 'a-user' });
  assertStatus(wallet, 200);
  assert.deepEqual(wallet.data.packages.map(({ id }) => id), ['package-a']);
  assertStatus(await call('client-wallet', { body: { clientId: 'unverified' } }), 404);
  assert.deepEqual(snapshot(db), before);
});

test('Core wallet returns an empty wallet for a valid client without packages', async (t) => {
  const { call } = setup(t);
  const result = await call('my-wallet', { uid: 'empty-user' });
  assertStatus(result, 200);
  assert.deepEqual(result.data.packages, []);
  assert.deepEqual(result.data.transactions, []);
  assert.equal(result.data.totalRemainingSessions, 0);
});

test('Core wallet resolves direct ID, Firebase UID and legacy alias without using phone as an ID', async (t) => {
  const { db, call } = setup(t);
  db.database.exec("UPDATE clients SET phone_normalized = '0500000001' WHERE id IN ('client-a', 'client-b')");
  const before = snapshot(db);
  for (const body of [
    { clientId: 'client-a', clientLookup: { phone: '0500000001' } },
    { clientLookup: { firebaseUid: 'a-user' } },
    { clientId: 'client-a', clientLookup: { uid: 'a-user' } },
    { clientId: 'old-a' },
  ]) {
    const result = await call('client-wallet', { body });
    assertStatus(result, 200);
    assert.equal(result.data.canonicalClientId, 'client-a');
  }
  assertStatus(await call('client-wallet', { body: { clientLookup: { phone: 'client-a' } } }), 400);
  assert.deepEqual(snapshot(db), before);
});

test('Core wallet rejects conflicting identity evidence and ambiguous phone or UID without relinking', async (t) => {
  const { db, call } = setup(t);
  db.database.exec("UPDATE clients SET phone_normalized = '0500000001' WHERE id IN ('client-a', 'client-b')");
  const before = snapshot(db);
  for (const body of [
    { clientLookup: { phone: '0500000001' } },
    { clientId: 'client-b', clientLookup: { id: 'old-a' } },
    { clientId: 'client-b', clientLookup: { firebaseUid: 'a-user' } },
  ]) {
    const result = await call('client-wallet', { body });
    assertStatus(result, 409);
    assert.equal(result.error, 'packages_client:ambiguous_identity');
  }
  assert.deepEqual(snapshot(db), before);
  db.database.exec("UPDATE clients SET firebase_uid = 'a-user' WHERE id = 'client-b'");
  const duplicated = snapshot(db);
  assertStatus(await call('my-wallet', { uid: 'a-user' }), 409);
  assert.deepEqual(snapshot(db), duplicated);
});

test('Admin wallet phone lookup returns migrated ownership and a zero balance for an empty client', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { client: 'legacy-a' });
  db.database.exec(`
    UPDATE clients SET phone_normalized = '0500000001' WHERE id = 'client-a';
    UPDATE clients SET phone_normalized = '0500000002' WHERE id = 'client-b';
  `);
  const before = snapshot(db);
  const [withPackage, empty] = await Promise.all(['0500000001', '0500000002'].map(
    (phone) => call('client-wallet', { body: { clientId: '', clientLookup: { phone } } }),
  ));
  assertStatus(withPackage, 200);
  assert.equal(withPackage.data.canonicalClientId, 'client-a');
  assert.deepEqual(withPackage.data.packages.map(({ id }) => id), ['package-a']);
  assertStatus(empty, 200);
  assert.equal(empty.data.canonicalClientId, 'client-b');
  assert.deepEqual(empty.data.packages, []);
  assert.equal(empty.data.totalRemainingSessions, 0);
  assert.deepEqual(snapshot(db), before);
});

test('Core package identity audit is read-only and owner restricted', async (t) => {
  const { db, call } = setup(t);
  const before = snapshot(db);
  const path = 'admin/audit-client-identities';
  const result = await call(path);
  assertStatus(result, 200);
  const row = result.data.identityGroups.find(({ canonicalSuggested }) => canonicalSuggested === 'client-a');
  assert.ok(row.aliases.includes('old-a'));
  assert.ok(row.aliases.includes('legacy-a'));
  assert.ok(!result.data.identityGroups.some(({ canonicalSuggested }) => canonicalSuggested === 'client-other'));
  assertStatus(await call(path, { uid: 'a-user' }), 403);
  assert.deepEqual(snapshot(db), before);
});

test('Core package operations reject another client or tenant package without writes', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  seedPackage(db, 'package-b', { client: 'client-b' });
  seedPackage(db, 'package-other', { client: 'client-other', salon: 'other' });
  db.database.exec("UPDATE clients SET phone_normalized = '0500000001' WHERE id = 'client-a'");
  const before = snapshot(db);
  for (const clientPackageId of ['package-b', 'package-other']) {
    assertStatus(await call('redeem', { body: { ...redeem, clientPackageId } }), 404);
  }
  assertStatus(await call('redeem', { body: { ...redeem, clientId: 'unverified-id', clientLookup: { firebaseUid: 'a-user' }, clientPackageId: 'package-b' } }), 404);
  assertStatus(await call('redeem', { body: { ...redeem, clientId: '', clientLookup: { phone: '0500000001' } } }), 404);
  assert.deepEqual(snapshot(db), before);
});

test('Legacy package redemption preserves verified ownership without relinking identity records', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { client: 'legacy-a' });
  const before = snapshot(db);
  const result = await call('redeem', { body: { ...redeem, clientId: 'old-a' } });
  assertStatus(result, 200);
  assert.equal(result.data.canonicalClientId, 'client-a');
  assert.equal(result.data.clientPackageId, 'package-a');
  const after = snapshot(db);
  assert.deepEqual(after.clients, before.clients);
  assert.deepEqual(after.client_aliases, before.client_aliases);
  assert.equal(after.client_packages[0].canonical_client_id, 'legacy-a');
  assert.equal(after.package_transactions[0].canonical_client_id, 'legacy-a');
  assert.deepEqual(balance(db, 'package-a'), [2, 0, 1]);
});

test('Core purchase replay and conflicting invoice references preserve a single package and purchase ledger row', async (t) => {
  const { db, call } = setup(t);
  const first = await call('purchase', { body: purchase });
  assertStatus(first, 200);
  const before = snapshot(db);
  const replay = await call('purchase', { body: purchase });
  assertStatus(replay, 200);
  assert.equal(replay.data.idempotent, true);
  assert.equal(replay.data.clientPackageId, first.data.clientPackageId);
  for (const payload of [
    { ...purchase, clientId: 'client-b' },
    { ...purchase, packageCatalogId: 'catalog-other' },
    { ...purchase, paymentMethod: 'card' },
    { ...purchase, expectedTotalHalalas: 10 },
    { ...purchase, expectedTaxHalalas: 1 },
  ]) {
    assertStatus(await call('purchase', { body: payload }), 409);
  }
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(balance(db, first.data.clientPackageId), [3, 0, 0]);
  assert.equal(before.client_packages.length, 1);
  assert.equal(before.package_transactions.length, 1);
  const entry = before.package_transactions[0];
  assert.deepEqual([entry.salon_id, entry.client_package_id, entry.canonical_client_id, entry.type,
    entry.sessions_delta, entry.remaining_before, entry.remaining_after, entry.invoice_id],
    ['main', first.data.clientPackageId, 'client-a', 'purchase', 3, 0, 3, first.data.invoiceId]);
});

test('Concurrent identical Core purchases and duplicate tenant references keep one ledger row per sale', async (t) => {
  const { db, call } = setup(t);
  const [first, replay] = await Promise.all([call('purchase', { body: purchase }), call('purchase', { body: purchase })]);
  assertStatus(first, 200);
  assertStatus(replay, 200);
  assert.equal(first.data.clientPackageId, replay.data.clientPackageId);
  assert.equal(first.data.invoiceId, replay.data.invoiceId);
  assert.equal(first.data.paymentId, replay.data.paymentId);
  assert.equal(first.data.incomeId, replay.data.incomeId);
  assert.ok(first.data.idempotent || replay.data.idempotent);
  const other = await call('purchase', { uid: 'other-owner', body: {
    ...purchase, salonId: 'other', clientId: 'client-other', packageCatalogId: 'catalog-other',
  } });
  assertStatus(other, 200);
  assert.notEqual(other.data.clientPackageId, first.data.clientPackageId);
  const state = snapshot(db);
  assert.equal(state.client_packages.length, 2);
  assert.equal(state.package_transactions.length, 2);
  for (const table of ['package_sales', 'invoices', 'payments', 'income_entries']) {
    assert.equal(state[table].length, 2);
    assert.deepEqual(state[table].map(({ salon_id }) => salon_id), ['main', 'other']);
  }
});

test('Core purchase rejects ambiguous preexisting invoice references without choosing a package', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  seedPackage(db, 'package-a2');
  db.database.prepare('UPDATE client_packages SET invoice_id = ?').run(purchase.invoiceId);
  const before = snapshot(db);
  assertStatus(await call('purchase', { body: purchase }), 409);
  assert.deepEqual(snapshot(db), before);
});

test('Core purchase can attach a package to an existing Core client without a canonical column value', async (t) => {
  const { db, call } = setup(t);
  db.database.exec("UPDATE clients SET canonical_client_id = NULL WHERE id = 'client-a'");
  const result = await call('purchase', { body: purchase });
  assertStatus(result, 200);
  assert.equal(result.data.canonicalClientId, 'client-a');
  assert.equal(snapshot(db).clients.filter(({ id }) => id === 'client-a').length, 1);
  assert.deepEqual(balance(db, result.data.clientPackageId), [3, 0, 0]);
});

test('Core purchase rolls back package, ledger and new identity when the ledger insert fails', async (t) => {
  const { db, call } = setup(t);
  db.database.exec(`
    CREATE TRIGGER reject_purchase BEFORE INSERT ON package_transactions
    WHEN NEW.type = 'purchase' BEGIN SELECT RAISE(ABORT, 'local rollback test'); END;
  `);
  const before = snapshot(db);
  assertStatus(await call('purchase', { body: { ...purchase, clientId: 'new-client' } }), 500);
  assert.deepEqual(snapshot(db), before);
});

test('Core redemption accepts exact replay and rejects changed service, booking, cart item or invoice', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { sessions: 1 });
  const body = { ...redeem, invoiceId: 'invoice-a' };
  const first = await call('redeem', { body });
  assertStatus(first, 200);
  const before = snapshot(db);
  const retry = await call('redeem', { body });
  assertStatus(retry, 200);
  assert.equal(retry.data.idempotent, true);
  assert.equal(retry.data.packageTransactionId, first.data.packageTransactionId);
  for (const changed of [{ serviceId: 'service-b' }, { bookingId: 'changed' }, { cartItemId: 'changed' }, { invoiceId: 'changed' }]) {
    const result = await call('redeem', { body: { ...body, ...changed } });
    assertStatus(result, 409);
    assert.ok(!('data' in result));
  }
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(balance(db, 'package-a'), [0, 0, 1]);
});

test('Core redemption operation IDs cannot return another package, client or tenant ledger', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  seedPackage(db, 'package-a2');
  seedPackage(db, 'package-b', { client: 'client-b' });
  seedPackage(db, 'package-other', { salon: 'other', client: 'client-other' });
  assertStatus(await call('redeem', { body: redeem }), 200);
  const before = snapshot(db);
  for (const [uid, body] of [
    ['owner', { ...redeem, clientPackageId: 'package-a2' }],
    ['owner', { ...redeem, clientId: 'client-b', clientPackageId: 'package-b' }],
    ['other-owner', { ...redeem, salonId: 'other', clientId: 'client-other', clientPackageId: 'package-other' }],
  ]) {
    const result = await call('redeem', { uid, body });
    assertStatus(result, 409);
    assert.ok(!('data' in result));
  }
  assert.deepEqual(snapshot(db), before);
});

test('Concurrent different redemptions cannot overspend or post an orphan ledger movement', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { sessions: 1 });
  const results = await Promise.all([
    call('redeem', { body: redeem }),
    call('redeem', { body: { ...redeem, bookingId: 'booking-b', operationId: 'movement-b' } }),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.deepEqual(balance(db, 'package-a'), [0, 0, 1]);
  const before = snapshot(db);
  assert.equal(before.package_transactions.length, 1);
  assertStatus(await call('redeem', { body: { ...redeem, operationId: 'new-movement' } }), 409);
  assert.deepEqual(snapshot(db), before);
});

test('Concurrent booking consumes preserve the movement ledger when a balance compare-and-set loses', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  assertStatus(await call('reserve', { body: redeem }), 200);
  assertStatus(await call('reserve', { body: { ...redeem, bookingId: 'booking-b', operationId: 'movement-b' } }), 200);
  const batch = db.batch;
  const { promise, resolve } = Promise.withResolvers();
  let arrivals = 0;
  db.batch = async (statements) => {
    arrivals += 1;
    if (arrivals === 2) resolve();
    await promise;
    return batch(statements);
  };
  const results = await Promise.all([
    call('redemption/consume', { body: { bookingId: 'booking-a' } }),
    call('redemption/consume', { body: { bookingId: 'booking-b' } }),
  ]);
  const completed = results.filter(({ status }) => status === 200).length;
  assert.equal(completed, 1);
  for (const failure of results.filter(({ status }) => status !== 200)) assertStatus(failure, 409);
  assert.deepEqual(balance(db, 'package-a'), [1, 2 - completed, completed]);
  assert.equal(snapshot(db).package_transactions.filter(({ type }) => type === 'consume').length, completed);
  for (const bookingId of ['booking-a', 'booking-b']) {
    assertStatus(await call('redemption/consume', { body: { bookingId } }), 200);
  }
  assert.deepEqual(balance(db, 'package-a'), [1, 0, 2]);
  assert.equal(snapshot(db).package_transactions.filter(({ type }) => type === 'consume').length, 2);
});

test('Core booking package lifecycle reserves, consumes, cancels, restores and reapplies without duplicate movements', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  const booking = { bookingId: redeem.bookingId };
  assertStatus(await call('reserve', { body: redeem }), 200);
  assert.deepEqual(balance(db, 'package-a'), [2, 1, 0]);
  assertStatus(await call('redemption/consume', { body: booking }), 200);
  assert.deepEqual(balance(db, 'package-a'), [2, 0, 1]);
  assertStatus(await call('redemption/cancel', { body: booking }), 200);
  assert.deepEqual(balance(db, 'package-a'), [3, 0, 0]);
  const replay = await call('redemption/restore', { body: booking });
  assertStatus(replay, 200);
  assert.equal(replay.data.idempotent, true);
  assertStatus(await call('redemption/reapply', { body: { ...booking, targetState: 'used' } }), 200);
  assert.deepEqual(balance(db, 'package-a'), [2, 0, 1]);
  const state = snapshot(db);
  assert.deepEqual(state.package_transactions.map(({ type }) => type), ['reserve', 'consume', 'restore', 'reapply_used']);
  const repeat = await call('redemption/reapply', { body: { ...booking, targetState: 'used' } });
  assertStatus(repeat, 200);
  assert.equal(repeat.data.idempotent, true);
  assert.deepEqual(snapshot(db), state);
});

test('A Core booking cart item cannot bind to two package reservations', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  seedPackage(db, 'package-b', { client: 'client-b' });
  const results = await Promise.all([
    call('reserve', { body: redeem }),
    call('reserve', { body: { ...redeem, clientId: 'client-b', clientPackageId: 'package-b', operationId: 'different-operation' } }),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(snapshot(db).package_transactions.length, 1);
  assert.equal(balance(db, 'package-a')[1] + balance(db, 'package-b')[1], 1);
});

test('Core releases only the targeted reserved booking item and keeps other reservations usable', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  assertStatus(await call('reserve', { body: redeem }), 200);
  assertStatus(await call('reserve', { body: { ...redeem, cartItemId: 'item-b', operationId: 'second-reservation' } }), 200);
  const release = { bookingId: redeem.bookingId, clientPackageId: 'package-a', cartItemId: 'item-a', operationId: 'release-a' };
  const before = snapshot(db);
  assertStatus(await call('release', { body: { ...release, bookingId: 'other-booking' } }), 404);
  assert.deepEqual(snapshot(db), before);
  assertStatus(await call('release', { body: release }), 200);
  assert.deepEqual(balance(db, 'package-a'), [2, 1, 0]);
  const after = snapshot(db);
  const retry = await call('release', { body: release });
  assertStatus(retry, 200);
  assert.equal(retry.data.idempotent, true);
  assertStatus(await call('release', { body: { ...release, cartItemId: 'item-b' } }), 409);
  assert.deepEqual(snapshot(db), after);
  assertStatus(await call('redemption/consume', { body: { bookingId: redeem.bookingId } }), 200);
  assert.deepEqual(balance(db, 'package-a'), [2, 0, 1]);
  const movements = snapshot(db).package_transactions;
  assert.equal(movements.find(({ type }) => type === 'release').cart_item_id, 'item-a');
  assert.equal(movements.find(({ type }) => type === 'consume').cart_item_id, 'item-b');
});

test('Admin adjustment and cancellation cannot replay a different package or operation payload', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  seedPackage(db, 'package-b', { client: 'client-b' });
  const adjustment = { clientPackageId: 'package-a', sessionsDelta: 1, reason: 'approved', operationId: 'adjustment' };
  assertStatus(await call('adjust', { body: adjustment }), 200);
  const cancellation = { clientPackageId: 'package-a', reason: 'approved', operationId: 'cancellation' };
  assertStatus(await call('cancel', { body: cancellation }), 200);
  const state = snapshot(db);
  for (const [path, body] of [
    ['adjust', { ...adjustment, sessionsDelta: 2 }],
    ['adjust', { ...adjustment, clientPackageId: 'package-b' }],
    ['cancel', { ...cancellation, clientPackageId: 'package-b' }],
    ['cancel', { ...cancellation, reason: 'different' }],
  ]) {
    const result = await call(path, { body });
    assertStatus(result, 409);
    assert.ok(!('data' in result));
  }
  assert.deepEqual(snapshot(db), state);
});

test('Core redemption rolls back a balance change when the transaction insert fails', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  db.database.exec(`
    CREATE TRIGGER reject_redeem BEFORE INSERT ON package_transactions
    WHEN NEW.type = 'redeem' BEGIN SELECT RAISE(ABORT, 'local rollback test'); END;
  `);
  const before = snapshot(db);
  assertStatus(await call('redeem', { body: redeem }), 500);
  assert.deepEqual(snapshot(db), before);
});

test('D1 expiry only changes expired active packages in the scheduled tenant', async (t) => {
  const { db, env } = setup(t);
  seedPackage(db, 'expired', { expires: now });
  seedPackage(db, 'future');
  seedPackage(db, 'other-expired', { salon: 'other', client: 'client-other', expires: now });
  const before = snapshot(db);
  assert.equal((await expireClientPackagesD1(env)).expired, 1);
  const after = snapshot(db);
  assert.deepEqual(after.client_packages.slice(1), before.client_packages.slice(1));
  assert.equal(after.client_packages[0].status, 'expired');
  assert.deepEqual(after.package_transactions, before.package_transactions);
});

test('Concurrent admin wallets deduplicate reads and refresh after a mutation', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  let reads = 0;
  const prepare = db.prepare;
  db.prepare = (sql) => {
    if (sql.includes('ORDER BY purchased_at DESC, created_at DESC')) reads += 1;
    return prepare(sql);
  };
  const body = { clientId: 'client-a' };
  const [a, b] = await Promise.all([call('client-wallet', { body }), call('client-wallet', { body })]);
  assertStatus(a, 200);
  assert.deepEqual(a.data, b.data);
  assert.equal(a.data.totalRemainingSessions, 3);
  assert.equal(reads, 1);
  assert.equal((await call('client-wallet', { body })).data.totalRemainingSessions, 3);
  assert.equal(reads, 1);
  assertStatus(await call('redeem', { body: redeem }), 200);
  assert.equal((await call('client-wallet', { body })).data.totalRemainingSessions, 2);
  assert.equal(reads, 2);
});

test('A superseded wallet read cannot restore stale balances after invalidation', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a');
  const captured = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let holdFirstRead = true;
  const prepare = db.prepare;
  db.prepare = (sql) => {
    const command = prepare(sql);
    if (!sql.includes('ORDER BY purchased_at DESC, created_at DESC') || !holdFirstRead) return command;
    holdFirstRead = false;
    return {
      bind(...params) {
        const bound = command.bind(...params);
        return {
          async all() {
            const oldRows = await bound.all();
            captured.resolve();
            await resume.promise;
            return oldRows;
          },
        };
      },
    };
  };
  const wallet = { body: { clientId: 'client-a' }, idempotencyKey: 'wallet-read' };
  const pending = call('client-wallet', wallet);
  await captured.promise;
  try {
    assertStatus(await call('redeem', { body: redeem }), 200);
    assert.equal((await call('client-wallet', wallet)).data.totalRemainingSessions, 2);
  } finally {
    resume.resolve();
    await pending;
  }
  assert.equal((await call('client-wallet', wallet)).data.totalRemainingSessions, 2);
  assert.deepEqual(snapshot(db).core_idempotency_operations, []);
});

test('A cached wallet cannot include a legacy package after that owner is linked to another account', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'package-a', { client: 'legacy-a' });
  const body = { clientId: 'client-a' };
  const initial = await call('client-wallet', { body });
  assertStatus(initial, 200);
  assert.deepEqual(initial.data.packages.map(({ id }) => id), ['package-a']);
  db.database.exec("UPDATE clients SET firebase_uid = 'legacy-user' WHERE id = 'legacy-a'");
  const updated = await call('client-wallet', { body });
  assertStatus(updated, 200);
  assert.deepEqual(updated.data.packages, []);
});

test('Core sale atomically settles the catalog amount and exposes canonical financial IDs', async (t) => {
  const { db, call } = setup(t);
  db.database.exec("UPDATE package_catalog SET price = 115.01 WHERE id = 'catalog-main'");
  db.database.prepare("INSERT INTO salon_settings (salon_id, setting_key, value_json, updated_at) VALUES ('main', 'finance', ?, ?)").run('{"vatRate":15}', now);
  const walletBefore = await call('client-wallet', { body: { clientId: 'client-a' } });
  assert.equal(walletBefore.data.totalRemainingSessions, 0);
  const result = await call('purchase', { body: {
    ...purchase, paymentMethod: 'transfer', expectedTotalHalalas: 11_501, expectedTaxHalalas: 1_500,
  } });
  assertStatus(result, 200);
  const data = result.data;
  assert.equal(data.settlementStatus, 'paid');
  assert.equal(data.saleReference, purchase.invoiceId);
  assert.notEqual(data.invoiceId, purchase.invoiceId);
  assert.equal(data.invoiceDocumentId, data.invoiceId);
  assert.equal(data.totalHalalas, 11_501);
  assert.equal(data.taxHalalas, 1_500);
  assert.equal(data.taxRate, 15);
  assert.equal(data.paymentMethod, 'transfer');
  const state = snapshot(db);
  const [invoice] = state.invoices;
  const [payment] = state.payments;
  const [income] = state.income_entries;
  const [sale] = state.package_sales;
  assert.deepEqual([invoice.id, invoice.invoice_number, invoice.salon_id, invoice.client_id, invoice.booking_id,
    invoice.total_halalas, invoice.subtotal_halalas, invoice.discount_halalas, invoice.paid_halalas, invoice.status],
  [data.invoiceId, data.invoiceNumber, 'main', 'client-a', null, 11_501, 11_501, 0, 11_501, 'paid']);
  assert.deepEqual([payment.id, payment.invoice_id, payment.salon_id, payment.client_id, payment.method, payment.amount_halalas,
    payment.status, payment.provider_reference], [data.paymentId, invoice.id, 'main', 'client-a', 'transfer', 11_501, 'paid', null]);
  assert.deepEqual([income.id, income.invoice_id, income.payment_id, income.salon_id, income.amount_halalas,
    income.source, income.category], [data.incomeId, invoice.id, payment.id, 'main', 11_501, 'package_purchase', 'payment']);
  assert.deepEqual([sale.client_package_id, sale.purchase_transaction_id, sale.tax_halalas],
    [data.clientPackageId, state.package_transactions[0].id, 1_500]);
  assert.equal(state.client_packages[0].invoice_id, invoice.id);
  assert.equal(state.package_transactions[0].invoice_id, invoice.id);
  assert.deepEqual(state.audit_logs.map(({ action }) => action), ['invoice_payment_updated', 'payment_recorded', 'income_created']);
  assert.ok(state.audit_logs.every(({ actor_uid }) => actor_uid === 'owner'));
  const [reportRow] = await listIncome(db, 'main');
  assert.equal(reportRow.id, income.id);
  assert.deepEqual(balance(db, data.clientPackageId), [3, 0, 0]);
  const wallet = await call('client-wallet', { body: { clientId: 'client-a' } });
  assert.equal(wallet.data.totalRemainingSessions, 3);
});

test('Core purchase resolves a historical invoice reference without regenerating its existing package ID', async (t) => {
  const { db, call } = setup(t);
  seedPackage(db, 'historical-package');
  db.database.prepare('UPDATE client_packages SET invoice_id = ?').run(purchase.invoiceId);
  const before = snapshot(db);
  const result = await call('purchase', { body: purchase });
  assertStatus(result, 200);
  assert.equal(result.data.idempotent, true);
  assert.equal(result.data.clientPackageId, 'historical-package');
  assert.equal(result.data.settlementStatus, 'unverified');
  assert.equal(result.data.saleReference, purchase.invoiceId);
  assert.equal(result.data.invoiceId, null);
  assert.deepEqual(snapshot(db), before);
});

test('New sales cannot attach an invoice from another client or tenant', async (t) => {
  const { db, call } = setup(t);
  const statement = db.database.prepare(`INSERT INTO invoices
    (id, salon_id, client_id, invoice_number, subtotal_halalas, total_halalas, status, issued_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1000, 1000, 'unpaid', ?, ?, ?)`);
  statement.run('client-b-invoice', 'main', 'client-b', 'B-001', now, now, now);
  statement.run('other-invoice', 'other', 'client-other', 'O-001', now, now, now);
  const before = snapshot(db);
  for (const invoiceId of ['client-b-invoice', 'B-001', 'other-invoice']) {
    const result = await call('purchase', { body: { ...purchase, invoiceId } });
    assertStatus(result, 409);
    assert.equal(result.error, 'packages_purchase:invoice_reference_conflict');
    assert.ok(!('data' in result));
  }
  assert.deepEqual(snapshot(db), before);
});

test('Invalid quotes, unsupported payment state, forged dates and missing catalog fail closed', async (t) => {
  const { db, call } = setup(t);
  const before = snapshot(db);
  for (const [overrides, expected] of [
    [{ expectedTotalHalalas: 1 }, 409],
    [{ expectedTaxHalalas: 1 }, 409],
    [{ totalHalalas: 1, discountHalalas: 11_999 }, 400],
    [{ status: 'pending' }, 400],
    [{ paymentMethod: null }, 400],
    [{ currency: 'USD' }, 400],
    [{ providerReference: 'unverified-provider-ref' }, 400],
    [{ accountingDate: 'not-a-date' }, 400],
    [{ purchasedAt: '2026-01-02T00:00:00Z' }, 400],
    [{ expiresAt: '2100-01-01T00:00:00Z' }, 400],
    [{ packageCatalogId: 'missing-catalog' }, 404],
  ]) {
    assertStatus(await call('purchase', { body: { ...purchase, ...overrides } }), expected);
  }
  assert.deepEqual(snapshot(db), before);
});

test('A catalog changed between checkout validation and the batch leaves no financial or package rows', async (t) => {
  const { db, call } = setup(t);
  const before = snapshot(db);
  const batch = db.batch;
  db.batch = async (statements) => {
    db.database.exec("UPDATE package_catalog SET price = 200 WHERE id = 'catalog-main'");
    return batch(statements);
  };
  const result = await call('purchase', { body: { ...purchase, expectedTotalHalalas: 12_000 } });
  assertStatus(result, 409);
  assert.equal(result.error, 'packages_purchase:quote_changed');
  const after = snapshot(db);
  assert.equal(after.package_catalog[0].price, 200);
  assert.deepEqual({ ...after, package_catalog: before.package_catalog }, before);
});

test('A committed sale replays its original settled amounts after a catalog price or tax change', async (t) => {
  const { db, call } = setup(t);
  const body = { ...purchase, expectedTotalHalalas: 12_000, expectedTaxHalalas: 0 };
  const first = await call('purchase', { body });
  assertStatus(first, 200);
  db.database.exec("UPDATE package_catalog SET price = 200 WHERE id = 'catalog-main'");
  db.database.prepare("INSERT INTO salon_settings (salon_id, setting_key, value_json, updated_at) VALUES ('main', 'finance', ?, ?)").run('{"taxRate":15}', now);
  const afterReprice = snapshot(db);
  const replay = await call('purchase', { body });
  assertStatus(replay, 200);
  assert.deepEqual(replay.data, { ...first.data, idempotent: true });
  assert.deepEqual(snapshot(db), afterReprice);
});

for (const table of ['invoices', 'payments', 'income_entries', 'client_packages', 'audit_logs', 'package_sales']) {
  test(`A failed ${table} insert rolls back every sale record and leaves the wallet unchanged`, async (t) => {
    const { db, call } = setup(t);
    db.database.exec(`CREATE TRIGGER reject_sale_write BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'local sale rollback test'); END;`);
    const body = { clientId: 'client-a' };
    const wallet = await call('client-wallet', { body });
    const before = snapshot(db);
    assertStatus(await call('purchase', { body: purchase }), 500);
    assertStatus(await call('purchase', { body: { ...purchase, clientId: 'new-client' } }), 500);
    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(await call('client-wallet', { body }), wallet);
  });
}

const closeDaySql = `INSERT INTO day_audit_closings
  (id, salon_id, audit_date, total_halalas, cash_halalas, card_halalas, transfer_halalas,
   manual_cash_halalas, cash_diff_halalas, closed_at, created_at)
  VALUES ('closing-main', 'main', ?, 0, 0, 0, 0, 0, 0, ?, ?)`;

test('The Riyadh closing barrier rejects fresh sales atomically and allows safe replay and open tenants', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T21:30:00.000Z') });
  const { db, call } = setup(t);
  const paid = await call('purchase', { body: purchase });
  assertStatus(paid, 200);
  db.database.prepare(closeDaySql).run('2026-10-25', now, now);
  const before = snapshot(db);
  const rejected = await call('purchase', { body: { ...purchase, invoiceId: 'closed-day-sale', clientId: 'new-client' } });
  assertStatus(rejected, 409);
  assert.equal(rejected.error, 'core_finance:financial_day_closed');
  assert.deepEqual(snapshot(db), before);
  const replay = await call('purchase', { body: purchase });
  assertStatus(replay, 200);
  assert.equal(replay.data.invoiceId, paid.data.invoiceId);
  assert.deepEqual(snapshot(db), before);
  assertStatus(await call('purchase', { uid: 'other-owner', body: {
    ...purchase, salonId: 'other', clientId: 'client-other', packageCatalogId: 'catalog-other',
  } }), 200);
  t.mock.timers.setTime(Date.parse('2026-10-25T21:30:00.000Z'));
  assertStatus(await call('purchase', { body: { ...purchase, invoiceId: 'following-open-day' } }), 200);
  assert.deepEqual(snapshot(db).day_audit_closings, before.day_audit_closings);
});

test('Pre-settlement HTTP replay records cannot be served as proof of a paid package sale', async (t) => {
  const { db, call } = setup(t);
  const key = 'legacy-generic-key';
  const request = new Request('https://worker.test/api/core/packages/purchase', {
    method: 'POST', body: JSON.stringify(purchase),
  });
  const sql = `INSERT INTO core_idempotency_operations (salon_id, operation_id, request_fingerprint,
    state, response_status, response_body, first_request_id, last_request_id, created_at, updated_at)
    VALUES ('main', ?, ?, 'completed', 200, '{"ok":true,"data":{"invoiceId":"unverified"}}', 'old', 'old', ?, ?)`;
  const oldScopes = [undefined, JSON.stringify({ salonId: 'main', accountId: 'owner', uid: 'owner' })];
  for (const [n, scope] of oldScopes.entries()) {
    db.database.prepare(sql).run(`${key}-${n}`, await requestFingerprint(request, scope), now, now);
  }
  const before = snapshot(db);
  for (const n of oldScopes.keys()) {
    const options = { idempotencyKey: `${key}-${n}`, body: purchase };
    const result = await call('purchase', options);
    assertStatus(result, 409);
    assert.ok(!('data' in result));
    assertStatus(await call('purchase', { ...options, uid: 'a-user' }), 403);
  }
  assert.deepEqual(snapshot(db), before);
});

test('Local Miniflare D1 commits one financial sale and rolls back a closed-day sale', async (t) => {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'package-sale-test', compatibilityDate: '2026-06-24',
    manifest: {
      mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
      modules: { 'script-0.mjs': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' } },
    },
    env: { CORE_DB: { type: 'd1', id: 'package-sale-test' } }, exports: {},
  }, dev: { rootPath: process.cwd() } }] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('CORE_DB');
  await applyCoreTestMigrations(db);
  const env = { CORE_DB: db, SALON_ID: 'main', FIREBASE_PROJECT_ID: project, PACKAGES_AUTH_TEST_MODE: 'true' };
  await db.prepare(`INSERT INTO clients (id, canonical_client_id, salon_id, name, created_at, updated_at)
    VALUES ('client-a', 'client-a', 'main', 'Test client', ?, ?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO package_catalog
    (id, salon_id, name, total_sessions, price, allowed_service_ids_json, created_at, updated_at)
    VALUES ('catalog-main', 'main', 'Test package', 3, 120, '["service-a"]', ?, ?)`).bind(now, now).run();
  const auth = { token: 'test:owner:owner' };
  const first = await send(env, 'purchase', { ...auth, body: purchase });
  assertStatus(first, 200);
  assert.equal(first.data.settlementStatus, 'paid');
  const replay = await packagesWorker.fetch(new Request('https://worker.test/api/packages/purchase', {
    method: 'POST', headers: { Authorization: 'Bearer test:owner:owner' }, body: JSON.stringify(purchase),
  }), { ...env, PACKAGES_DB: db });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.paymentId, first.data.paymentId);
  const timestamp = new Date().toISOString();
  const businessDay = await db.prepare("SELECT date(?, '+3 hours') AS business_date").bind(timestamp).first();
  await db.prepare(closeDaySql).bind(businessDay.business_date, timestamp, timestamp).run();
  const denied = await send(env, 'purchase', { ...auth, body: { ...purchase, invoiceId: 'closed-sale', clientId: 'new-client' } });
  assertStatus(denied, 409);
  assert.equal(denied.error, 'core_finance:financial_day_closed');
  for (const table of ['clients', 'client_packages', 'package_transactions', 'invoices', 'payments', 'income_entries', 'package_sales']) {
    const { count } = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
    assert.equal(count, 1, table);
  }
});
