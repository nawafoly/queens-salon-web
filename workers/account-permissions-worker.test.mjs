import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare } from "miniflare";

import worker from "./core/index.js";
import { disableAccount } from "./core/repositories/accounts.js";

const MIGRATIONS = [
  "0001_core_schema.sql",
  "0004_admin_operations.sql",
  "0005_hr_settings_files.sql",
  "0014_app_users_permissions.sql",
  "0033_app_user_profile_photo.sql",
];

async function applyMigration(db, name) {
  const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), "utf8"))
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function setup(t) {
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
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("CORE_DB");
  for (const name of MIGRATIONS) await applyMigration(db, name);
  await seedAccounts(db);
  return { db, env: env(db) };
}

function env(db, extra = {}) {
  return {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    CORE_DB: db,
    ...extra,
  };
}

function req(path, { method = "GET", uid = "uid-owner-a", role = "client", body, headers = {} } = {}) {
  return new Request(`http://core.test${path}`, {
    method,
    headers: {
      Authorization: `Bearer test:${uid}:${role}`,
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
}

async function json(response) {
  return response.json();
}

async function seedAccounts(db) {
  const now = "2026-07-20T00:00:00.000Z";
  await db.prepare(`
    INSERT INTO staff
      (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, created_at, updated_at)
    VALUES
      ('staff-linked', 'main', 'uid-staff-linked', 'Linked Staff', '0500000001', 1, 'active', ?, ?)
  `).bind(now, now).run();
  const rows = [
    ["user-owner-a", "uid-owner-a", "owner-a@example.com", "Owner A", "owner", "active"],
    ["user-owner-b", "uid-owner-b", "owner-b@example.com", "Owner B", "owner", "active"],
    ["user-admin", "uid-admin", "admin@example.com", "Admin", "admin", "active"],
    ["user-hr", "uid-hr", "hr@example.com", "HR", "hr", "active"],
    ["user-staff", "uid-staff", "staff@example.com", "Staff", "staff", "active"],
    ["user-admin-target", "uid-admin-target", "admin-target@example.com", "Admin Target", "admin", "active"],
    ["user-disabled", "uid-disabled", "disabled@example.com", "Disabled", "admin", "disabled"],
    ["user-pending", "uid-pending", "pending@example.com", "Pending", "pending", "pending"],
    ["user-client", "uid-client", "client@example.com", "Client", "client", "active"],
    ["user-deleted", "uid-deleted", "deleted@example.com", "Deleted", "staff", "deleted"],
  ];
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO app_users
        (id, firebase_uid, salon_id, email, display_name, primary_role, status,
         email_verified, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'main', ?, ?, ?, ?, 1, ?, ?, CASE WHEN ? = 'deleted' THEN ? ELSE NULL END)
    `).bind(row[0], row[1], row[2], row[3], row[4], row[5], now, now, row[5], now).run();
  }
}

test("/api/auth/me is D1-authoritative and rejects non-active app_users", async (t) => {
  const { env: testEnv } = await setup(t);

  const active = await worker.fetch(req("/api/auth/me", { role: "client" }), testEnv);
  const activeBody = await json(active);
  assert.equal(active.status, 200, JSON.stringify(activeBody));
  assert.equal(activeBody.data.user.id, "user-owner-a");
  assert.equal(activeBody.data.user.role, "owner");
  assert.ok(activeBody.data.permissions.includes("accounts.delete"));

  for (const [uid, code] of [
    ["uid-missing", "ACCOUNT_NOT_PROVISIONED"],
    ["uid-disabled", "ACCOUNT_DISABLED"],
    ["uid-pending", "ACCOUNT_PENDING"],
    ["uid-deleted", "ACCOUNT_DELETED"],
  ]) {
    const response = await worker.fetch(req("/api/auth/me", { uid }), testEnv);
    const body = await json(response);
    assert.equal(response.status, 403, JSON.stringify(body));
    assert.equal(body.error, code);
  }
});

test("Core account deletion preserves Firebase UID, records deleted state, and denies subsequent Core access", async (t) => {
  const { db, env: testEnv } = await setup(t);
  const response = await worker.fetch(req("/api/admin/accounts/user-staff", {
    method: "DELETE",
    uid: "uid-owner-a",
    role: "owner",
  }), testEnv);
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "deleted");

  const row = await db.prepare(
    "SELECT firebase_uid, status, deleted_at FROM app_users WHERE salon_id = 'main' AND id = 'user-staff'"
  ).first();
  assert.equal(row.firebase_uid, "uid-staff", "A soft delete must never destroy the Firebase identity association");
  assert.equal(row.status, "deleted");
  assert.ok(row.deleted_at);

  const blocked = await worker.fetch(req("/api/auth/me", {
    uid: "uid-staff",
    role: "admin",
  }), testEnv);
  const blockedBody = await json(blocked);
  assert.equal(blocked.status, 403, JSON.stringify(blockedBody));
  assert.equal(blockedBody.error, "ACCOUNT_DELETED");
});

test("admin account deletion rejects self, unprivileged callers, and PATCH deletion bypass", async (t) => {
  const { db, env: testEnv } = await setup(t);

  const cases = [
    { path: "/api/admin/accounts/user-owner-a", method: "DELETE", uid: "uid-owner-a", expected: "ACCOUNT_SELF_DELETE_FORBIDDEN", status: 409 },
    { path: "/api/admin/accounts/user-staff", method: "DELETE", uid: "uid-admin", expected: "core_auth:missing_permission", status: 403 },
    { path: "/api/admin/accounts/user-staff", method: "PATCH", uid: "uid-admin", body: { status: "deleted" }, expected: "ACCOUNT_DELETE_ENDPOINT_REQUIRED", status: 403 },
    { path: "/api/admin/accounts/user-staff", method: "PATCH", uid: "uid-owner-a", body: { status: "deleted" }, expected: "ACCOUNT_DELETE_ENDPOINT_REQUIRED", status: 403 },
    { path: "/api/admin/accounts/user-deleted", method: "PATCH", uid: "uid-admin", body: { status: "active" }, expected: "ACCOUNT_RESTORE_ENDPOINT_REQUIRED", status: 403 },
  ];
  for (const item of cases) {
    const response = await worker.fetch(req(item.path, { method: item.method, uid: item.uid, body: item.body }), testEnv);
    const body = await json(response);
    assert.equal(response.status, item.status, JSON.stringify(body));
    assert.equal(body.error, item.expected);
  }

  const owner = await db.prepare("SELECT status, deleted_at FROM app_users WHERE id='user-owner-a'").first();
  const staff = await db.prepare("SELECT status, deleted_at FROM app_users WHERE id='user-staff'").first();
  assert.equal(owner.status, "active");
  assert.equal(staff.status, "active");
  assert.equal(owner.deleted_at, null);
  assert.equal(staff.deleted_at, null);
  const restored = await worker.fetch(req("/api/admin/accounts/user-deleted/restore", { method: "POST", uid: "uid-owner-a" }), testEnv);
  const restoredBody = await json(restored);
  assert.equal(restored.status, 200, JSON.stringify(restoredBody));
  assert.equal(restoredBody.data.status, "active");
  const restoredRow = await db.prepare("SELECT status, deleted_at FROM app_users WHERE id='user-deleted'").first();
  assert.equal(restoredRow.status, "active");
  assert.equal(restoredRow.deleted_at, null);
});

test("internal account scope excludes client identities from account management", async (t) => {
  const { env: testEnv } = await setup(t);

  let response = await worker.fetch(req("/api/admin/accounts"), testEnv);
  let body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.data.some((account) => account.id === "user-client"));

  response = await worker.fetch(
    req("/api/admin/accounts?scope=internal&includeDeleted=true"),
    testEnv
  );
  body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(!body.data.some((account) => ["client", "guest"].includes(account.role)));
  assert.ok(body.data.some((account) => account.id === "user-staff"));
  assert.ok(body.data.some((account) => account.id === "user-deleted"));
});

test("account APIs enforce owner protection, last-owner safety and permission-grant boundaries", async (t) => {
  const { db, env: testEnv } = await setup(t);

  let response = await worker.fetch(req("/api/admin/accounts", {
    method: "POST",
    body: {
      id: "user-created",
      firebaseUid: "uid-created",
      email: "created@example.com",
      displayName: "Created",
      role: "staff",
      status: "active",
    },
    headers: {
      "CF-Connecting-IP": "203.0.113.9",
      "User-Agent": "account-test",
    },
  }), testEnv);
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.id, "user-created");
  assert.equal((await db.prepare("SELECT primary_role FROM app_users WHERE id='user-created'").first()).primary_role, "staff");

  response = await worker.fetch(req("/api/admin/accounts/user-owner-b", {
    method: "PATCH",
    uid: "uid-admin",
    body: { displayName: "Blocked" },
  }), testEnv);
  body = await json(response);
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "ACCOUNT_OWNER_PROTECTED");

  response = await worker.fetch(req("/api/admin/accounts/user-staff", {
    method: "PATCH",
    uid: "uid-admin",
    body: { role: "owner" },
  }), testEnv);
  body = await json(response);
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "ACCOUNT_ROLE_ASSIGN_FORBIDDEN");

  await db.prepare("UPDATE app_users SET status='disabled' WHERE id='user-owner-b'").run();
  response = await worker.fetch(req("/api/admin/accounts/user-owner-a/disable", {
    method: "POST",
  }), testEnv);
  body = await json(response);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, "ACCOUNT_LAST_OWNER_PROTECTED");

  await db.prepare(`
    INSERT INTO user_permissions
      (id, salon_id, user_id, permission_key, effect, created_at, updated_at)
    VALUES ('perm-admin-manage', 'main', 'user-admin', 'permissions.manage', 'allow', '2026-07-20', '2026-07-20')
  `).run();
  response = await worker.fetch(req("/api/admin/accounts/user-staff/permissions", {
    method: "PUT",
    uid: "uid-admin",
    body: { permissions: ["accounts.delete"] },
  }), testEnv);
  body = await json(response);
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "ACCOUNT_PERMISSION_GRANT_FORBIDDEN");

  response = await worker.fetch(req("/api/admin/accounts/user-admin/permissions", {
    method: "PUT",
    uid: "uid-admin",
    body: { permissions: ["accounts.read"] },
  }), testEnv);
  body = await json(response);
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error, "ACCOUNT_SELF_PERMISSION_CHANGE_FORBIDDEN");

  const audit = await db.prepare(`
    SELECT action, actor_user_id, target_user_id, ip, user_agent
      FROM audit_logs
     WHERE action = 'account_created'
     LIMIT 1
  `).first();
  assert.equal(audit.actor_user_id, "user-owner-a");
  assert.equal(audit.target_user_id, "user-created");
  assert.equal(audit.ip, "203.0.113.9");
  assert.equal(audit.user_agent, "account-test");
});

test("concurrent owner removals keep at least one active owner at the SQL write boundary", async (t) => {
  const { db } = await setup(t);

  // Force both operations past the preliminary owner-count reads before either
  // UPDATE executes. This reproduces a formerly vulnerable check-then-write race.
  let queued = 0;
  let release;
  let rejectGate;
  const gate = new Promise((resolve, reject) => {
    release = resolve;
    rejectGate = reject;
  });
  const timeout = setTimeout(() => rejectGate(new Error("concurrent owner removal gate timeout")), 10_000);
  timeout.unref?.();
  t.after(() => clearTimeout(timeout));

  const racingDb = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...params) {
          const bound = statement.bind(...params);
          return {
            first: () => bound.first(),
            all: () => bound.all(),
            run: () => bound.run(),
            __bound: bound,
            __sql: sql,
          };
        },
      };
    },
    async batch(statements) {
      const racingUpdate = statements.some((statement) => /^\s*UPDATE app_users SET/.test(statement.__sql || '') && /status = \?/.test(statement.__sql || ''));
      if (racingUpdate) {
        queued += 1;
        if (queued === 2) release();
        await gate;
      }
      return db.batch(statements.map((statement) => statement.__bound ?? statement));
    },
  };
  const results = await Promise.allSettled([
    disableAccount(racingDb, "main", "user-owner-a", { role: "owner", user: { id: "user-owner-b" } }),
    disableAccount(racingDb, "main", "user-owner-b", { role: "owner", user: { id: "user-owner-a" } }),
  ]);
  assert.equal(queued, 2, `both removals must reach the write: ${JSON.stringify(results.map((item) => ({ status: item.status, message: item.reason?.message, code: item.reason?.code })))}`);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, JSON.stringify(results));
  const failed = results.find((result) => result.status === "rejected");
  assert.ok(["ACCOUNT_LAST_OWNER_PROTECTED", "ACCOUNT_CONCURRENT_MODIFICATION"].includes(failed?.reason?.code));

  const owners = await db.prepare(
    "SELECT COUNT(*) AS count FROM app_users WHERE salon_id='main' AND primary_role='owner' AND status='active' AND deleted_at IS NULL"
  ).first();
  assert.equal(Number(owners.count), 1, "at least one owner must remain active");
  const audits = await db.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE salon_id='main' AND action='account_updated'"
  ).first();
  assert.equal(Number(audits.count), 1, "failed competing removal must not create a false audit");
});

test("account creation and account update roll back if audit insertion fails", async (t) => {
  const { db, env: testEnv } = await setup(t);
  const original = await db.prepare("SELECT display_name FROM app_users WHERE id='user-staff'").first();
  await db.prepare(`
    CREATE TRIGGER fail_account_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action IN ('account_created', 'account_updated')
    BEGIN SELECT RAISE(ABORT, 'INJECTED_AUDIT_FAILURE'); END
  `).run();

  const updated = await worker.fetch(req("/api/admin/accounts/user-staff", {
    method: "PATCH",
    uid: "uid-owner-a",
    body: { displayName: "Should Roll Back" },
  }), testEnv);
  assert.ok(updated.status >= 400, "an audit failure must reject account update");
  assert.equal(
    (await db.prepare("SELECT display_name FROM app_users WHERE id='user-staff'").first()).display_name,
    original.display_name,
    "account update must be rolled back if audit is rejected"
  );

  const created = await worker.fetch(req("/api/admin/accounts", {
    method: "POST",
    uid: "uid-owner-a",
    body: { id: "audit-create-failure", firebaseUid: "audit-create-failure-uid", role: "staff", status: "active" },
  }), testEnv);
  assert.ok(created.status >= 400, "an audit failure must reject account creation");
  const row = await db.prepare("SELECT id FROM app_users WHERE id='audit-create-failure'").first();
  assert.equal(row, null, "account INSERT must be rolled back with its rejected audit");
});

test("successful account mutations preserve matching before/after audit snapshots", async (t) => {
  const { db, env: testEnv } = await setup(t);
  const response = await worker.fetch(req("/api/admin/accounts/user-staff", {
    method: "PATCH", uid: "uid-owner-a", body: { displayName: "Audited Rename" },
  }), testEnv);
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  const audit = await db.prepare(
    "SELECT before_json, after_json FROM audit_logs WHERE action='account_updated' AND entity_id='user-staff' ORDER BY created_at DESC LIMIT 1"
  ).first();
  assert.ok(audit, "account UPDATE must create a transactionally coupled audit record");
  assert.equal(JSON.parse(audit.before_json).displayName, "Staff");
  assert.equal(JSON.parse(audit.after_json).displayName, "Audited Rename");
  assert.equal((await db.prepare("SELECT display_name FROM app_users WHERE id='user-staff'").first()).display_name, "Audited Rename");
});

test("admin can reduce a lower-role account without re-granting retained legacy permissions", async (t) => {
  const { db, env: testEnv } = await setup(t);

  await db.prepare(`
    INSERT INTO user_permissions
      (id, salon_id, user_id, permission_key, effect, created_at, updated_at)
    VALUES
      ('perm-admin-manage-lower', 'main', 'user-admin', 'permissions.manage', 'allow', '2026-07-20', '2026-07-20'),
      ('perm-staff-owner-grant', 'main', 'user-staff', 'accounts.delete', 'allow', '2026-07-20', '2026-07-20')
  `).run();

  let response = await worker.fetch(req("/api/admin/accounts/user-staff/permissions", {
    method: "PUT",
    uid: "uid-admin",
    body: { permissions: ["accounts.delete"] },
  }), testEnv);
  let body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.permissions, ["accounts.delete"]);

  response = await worker.fetch(req("/api/admin/accounts/user-staff/permissions", {
    method: "PUT",
    uid: "uid-admin",
    body: { permissions: [] },
  }), testEnv);
  body = await json(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.data.permissions, []);
});

test("direct deny wins over role permissions and employee links are D1 records", async (t) => {
  const { db, env: testEnv } = await setup(t);

  let response = await worker.fetch(req("/api/admin/accounts/user-admin-target/permissions", {
    method: "PUT",
    body: { permissions: ["accounts.update"] },
  }), testEnv);
  let body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.data.permissions.includes("accounts.update"));
  assert.ok(!body.data.permissions.includes("accounts.read"));
  assert.ok(body.data.deniedPermissions.includes("accounts.read"));

  response = await worker.fetch(req("/api/admin/accounts/user-staff/employee-link", {
    method: "PUT",
    body: { employeeId: "staff-linked" },
  }), testEnv);
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.employeeId, "staff-linked");

  response = await worker.fetch(req("/api/admin/accounts/user-staff"), testEnv);
  body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.employeeLink.employeeId, "staff-linked");

  const link = await db.prepare("SELECT user_id, employee_id, link_status FROM user_employee_links WHERE user_id='user-staff'").first();
  assert.deepEqual(link, { user_id: "user-staff", employee_id: "staff-linked", link_status: "active" });
});

test("password reset remains Firebase delivery after D1 authorization", async (t) => {
  const { env: testEnv } = await setup(t);
  const response = await worker.fetch(req("/api/admin/accounts/user-staff/reset-password", {
    method: "POST",
  }), testEnv);
  const body = await json(response);
  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.error, "FIREBASE_RESET_NOT_CONFIGURED");
});
