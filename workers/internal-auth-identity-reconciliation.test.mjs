import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare } from "miniflare";

import { resolveAccountForVerifiedIdentity } from "./core/account-identity.js";

const MIGRATIONS = [
  "0001_core_schema.sql",
  "0004_admin_operations.sql",
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
  const mf = new Miniflare({
    workers: [
      {
        config: {
          type: "worker",
          name: "identity-reconciliation-test-worker",
          compatibilityDate: "2026-06-24",
          manifest: {
            mainModule: "script-0.mjs",
            modulesRoot: process.cwd(),
            modules: {
              "script-0.mjs": {
                type: "esm",
                contents: 'export default { fetch(){ return new Response("ok") } }',
              },
            },
          },
          env: {
            CORE_DB: { type: "d1", id: "identity-reconciliation-test" },
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
  return db;
}

async function seedAccount(db, {
  id,
  firebaseUid,
  email,
  role = "staff",
  status = "active",
  deletedAt = null,
}) {
  const now = "2026-09-01T20:00:00.000Z";
  await db.prepare(`
    INSERT INTO app_users
      (id, firebase_uid, salon_id, email, display_name, primary_role, status,
       email_verified, created_at, updated_at, deleted_at)
    VALUES (?, ?, 'main', ?, ?, ?, ?, 1, ?, ?, ?)
  `).bind(
    id,
    firebaseUid,
    email,
    id,
    role,
    status,
    now,
    now,
    deletedAt,
  ).run();
}

test("verified email repairs a stale Firebase UID without changing Core authorization", async (t) => {
  const db = await setup(t);
  await seedAccount(db, {
    id: "user-sabah",
    firebaseUid: "legacy-wrong-uid",
    email: "sabah@malikat.com",
    role: "staff",
  });

  const account = await resolveAccountForVerifiedIdentity(
    db,
    "main",
    {
      uid: "firebase-current-sabah",
      email: "SABAH@MALIKAT.COM",
      claims: { role: "owner" },
    },
    {
      ip: "203.0.113.9",
      userAgent: "identity-reconciliation-test",
    },
  );

  assert.equal(account?.id, "user-sabah");
  assert.equal(account?.firebase_uid, "firebase-current-sabah");
  assert.equal(account?.primary_role, "staff", "Firebase claims must never replace the Core role");

  const stored = await db.prepare(
    "SELECT firebase_uid, primary_role FROM app_users WHERE id = 'user-sabah'"
  ).first();
  assert.equal(stored.firebase_uid, "firebase-current-sabah");
  assert.equal(stored.primary_role, "staff");

  const audit = await db.prepare(`
    SELECT action, actor_uid, actor_email, target_user_id
      FROM audit_logs
     WHERE action = 'account_identity_reconciled'
       AND target_user_id = 'user-sabah'
     LIMIT 1
  `).first();
  assert.equal(audit?.action, "account_identity_reconciled");
  assert.equal(audit?.actor_uid, "firebase-current-sabah");
  assert.equal(audit?.actor_email, "sabah@malikat.com");
});

test("verified email can attach an unbound migrated Core account", async (t) => {
  const db = await setup(t);
  await seedAccount(db, {
    id: "user-unbound",
    firebaseUid: null,
    email: "employee@malikat.com",
  });

  const account = await resolveAccountForVerifiedIdentity(db, "main", {
    uid: "firebase-employee",
    email: "employee@malikat.com",
    claims: {},
  });

  assert.equal(account?.id, "user-unbound");
  assert.equal(account?.firebase_uid, "firebase-employee");
});

test("identity reconciliation refuses ambiguous or deleted email matches", async (t) => {
  const db = await setup(t);
  await seedAccount(db, {
    id: "user-case-a",
    firebaseUid: "uid-case-a",
    email: "Case@malikat.com",
  });
  await seedAccount(db, {
    id: "user-case-b",
    firebaseUid: "uid-case-b",
    email: "case@malikat.com",
  });
  await seedAccount(db, {
    id: "user-deleted",
    firebaseUid: "uid-deleted-old",
    email: "deleted@malikat.com",
    status: "deleted",
    deletedAt: "2026-09-01T20:00:00.000Z",
  });

  const ambiguous = await resolveAccountForVerifiedIdentity(db, "main", {
    uid: "uid-case-new",
    email: "case@malikat.com",
    claims: {},
  });
  assert.equal(ambiguous, null);

  const deleted = await resolveAccountForVerifiedIdentity(db, "main", {
    uid: "uid-deleted-new",
    email: "deleted@malikat.com",
    claims: {},
  });
  assert.equal(deleted, null);

  const rows = await db.prepare(
    "SELECT id, firebase_uid FROM app_users WHERE id IN ('user-case-a','user-case-b','user-deleted') ORDER BY id"
  ).all();
  assert.deepEqual(
    rows.results.map((row) => [row.id, row.firebase_uid]),
    [
      ["user-case-a", "uid-case-a"],
      ["user-case-b", "uid-case-b"],
      ["user-deleted", "uid-deleted-old"],
    ],
  );
});
