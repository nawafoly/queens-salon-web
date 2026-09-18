import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare } from "miniflare";

import worker from "./core/index.js";

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
          type: "worker",
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
