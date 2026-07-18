import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUnifiedPackagesSql, resolveSpawnInvocation } from "../scripts/migrate-packages-d1-to-core.mjs";

test("package migration reuses the Core client matched by Firebase UID", () => {
  const result = buildUnifiedPackagesSql({
    generatedAt: "2026-07-17T00:00:00.000Z",
    coreClients: [{ id: "core-client", salon_id: "main", firebase_uid: "uid-1", phone_normalized: "0500000000" }],
    packageClients: [{ canonical_client_id: "legacy-client", salon_id: "main", firebase_uid: "uid-1", phone_normalized: "0500000000", legacy_ids_json: "[]" }],
    packageAliases: [],
    packageCatalog: [{ id: "catalog-1", salon_id: "main", name: "باقة", total_sessions: 10, price: 100, allowed_service_ids_json: "[]", active: 1, sale_enabled: 1, audience_scope: "all", target_client_ids_json: "[]", sort_order: 0, created_at: "x", updated_at: "x" }],
    clientPackages: [{ id: "cp-1", salon_id: "main", canonical_client_id: "legacy-client", package_catalog_id: "catalog-1", package_name_snapshot: "باقة", allowed_service_ids_json: "[]", total_sessions: 10, remaining_sessions: 8, reserved_sessions: 1, used_sessions: 1, status: "active", created_at: "x", updated_at: "x" }],
    packageTransactions: [{ id: "tx-1", salon_id: "main", client_package_id: "cp-1", canonical_client_id: "legacy-client", type: "purchase", sessions_delta: 10, remaining_before: 0, remaining_after: 10, reserved_before: 0, reserved_after: 0, used_before: 0, used_after: 0, created_at: "x" }],
  });
  assert.equal(result.report.coreClientsCreated, 0);
  assert.equal(result.report.clientMap["legacy-client"], "core-client");
  assert.match(result.sql, /'cp-1'.*'core-client'.*'catalog-1'/);
  assert.match(result.sql, /client_aliases.*'legacy-client'.*'core-client'/);
});

test("package migration creates one Core client only when no canonical match exists", () => {
  const result = buildUnifiedPackagesSql({
    generatedAt: "2026-07-17T00:00:00.000Z",
    coreClients: [],
    packageClients: [{ canonical_client_id: "package-client", salon_id: "main", name: "نواف", firebase_uid: "uid-2", legacy_ids_json: '["old-id"]' }],
  });
  assert.equal(result.report.coreClientsCreated, 1);
  assert.match(result.sql, /INSERT OR IGNORE INTO clients/);
  assert.match(result.sql, /'package-client'.*'نواف'/);
  assert.match(result.sql, /'old-id'.*'package-client'/);
});

test("package migration refuses conflicting identity matches", () => {
  assert.throws(() => buildUnifiedPackagesSql({
    coreClients: [
      { id: "by-uid", salon_id: "main", firebase_uid: "uid-x", phone_normalized: "0511111111" },
      { id: "by-phone", salon_id: "main", firebase_uid: "uid-y", phone_normalized: "0522222222" },
    ],
    packageClients: [{ canonical_client_id: "legacy", salon_id: "main", firebase_uid: "uid-x", phone_normalized: "0522222222" }],
  }), /Client identity conflict/);
});


test("package migration launches local Wrangler without invoking a Windows cmd file directly", () => {
  const invocation = resolveSpawnInvocation("npx", ["wrangler", "d1", "execute"], {
    platform: "win32",
    execPath: "C:/Program Files/nodejs/node.exe",
    npmExecPath: "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
    cwd: "Z:/path-that-does-not-contain-wrangler",
  });
  assert.equal(invocation.executable, "C:/Program Files/nodejs/node.exe");
  assert.deepEqual(invocation.args, [
    "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
    "exec",
    "--",
    "wrangler",
    "d1",
    "execute",
  ]);
  assert.equal(invocation.shell, false);
});

test("package migration Windows fallback uses a shell when npm metadata is unavailable", () => {
  const invocation = resolveSpawnInvocation("npx", ["wrangler", "--version"], {
    platform: "win32",
    npmExecPath: "",
    cwd: "Z:/path-that-does-not-contain-wrangler",
  });
  assert.equal(invocation.executable, "npx");
  assert.deepEqual(invocation.args, ["wrangler", "--version"]);
  assert.equal(invocation.shell, true);
});


test("package migration trusts an exact Firebase UID even when the phone still has a legacy duplicate", () => {
  const result = buildUnifiedPackagesSql({
    generatedAt: "2026-07-18T00:00:00.000Z",
    coreClients: [
      { id: "966547929657", salon_id: "main", firebase_uid: null, phone_normalized: "0547929657" },
      { id: "client-real", salon_id: "main", firebase_uid: "uid-real", phone_normalized: "0547929657" },
    ],
    packageClients: [
      { canonical_client_id: "package-client", salon_id: "main", firebase_uid: "uid-real", phone_normalized: "0547929657", legacy_ids_json: "[]" },
    ],
  });
  assert.equal(result.report.clientMap["package-client"], "client-real");
});
