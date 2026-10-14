import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Core migration owns package catalog, wallets, and transaction ledger", () => {
  const sql = readFileSync("migrations/core/0011_unify_packages_into_core.sql", "utf8");
  assert.match(sql, /ALTER TABLE clients ADD COLUMN canonical_client_id/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS package_catalog/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_packages/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS package_transactions/i);
  assert.match(sql, /REFERENCES clients\(salon_id, canonical_client_id\)/i);
  assert.match(sql, /CREATE VIEW IF NOT EXISTS client_identity_aliases/i);
  assert.match(sql, /INSTEAD OF INSERT ON client_identity_aliases/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS clients/i);
});

test("Core Worker serves package routes and expires package balances", () => {
  const source = readFileSync("workers/core/index.js", "utf8");
  assert.match(source, /handleUnifiedPackagesRequest/);
  assert.match(source, /\/api\/core\/packages/);
  assert.match(source, /PACKAGES_DB:\s*env\.CORE_DB/);
  assert.match(source, /PACKAGES_UNIFIED_CORE:\s*"true"/);
  assert.match(source, /expireClientPackagesD1/);
  assert.match(source, /async scheduled/);
});

test("Package repository supports Core clients without a second client table", () => {
  const source = readFileSync("workers/packages/d1.js", "utf8");
  assert.match(source, /const db = ctx\.coreDb \|\| ctx\.packagesDb/);
  assert.match(source, /usesUnifiedCoreClients/);
  assert.match(source, /\(id, canonical_client_id, salon_id, name/);
  assert.match(source, /canonicalClientId: cleanText\(row\.canonical_client_id \|\| row\.id\)/);
});

test("Frontend sends all package operations to unified Core routes", () => {
  const service = readFileSync("src/services/PackageOperationsService.ts", "utf8");
  const env = readFileSync(".env.web", "utf8");
  const staffEnv = readFileSync(".env.staff", "utf8");
  const dev = readFileSync("scripts/dev-with-partners.mjs", "utf8");
  const flags = readFileSync("src/config/dataSourceFlags.ts", "utf8");

  assert.match(service, /requireCoreWorkerUrl/);
  assert.doesNotMatch(service, /requirePackagesWorkerUrl/);
  assert.match(service, /path\.replace\(\/\^\\\/api\\\/packages\//);
  assert.match(service, /"\/api\/core\/packages"/);

  for (const activeConfig of [env, staffEnv, dev]) {
    assert.doesNotMatch(activeConfig, /VITE_PACKAGES_WORKER_URL/);
    assert.doesNotMatch(activeConfig, /VITE_USE_PACKAGES_D1/);
  }
  assert.doesNotMatch(
    flags,
    /packagesWorkerUrl|usePackagesD1|VITE_PACKAGES_WORKER_URL|VITE_USE_PACKAGES_D1/
  );
  assert.doesNotMatch(
    flags,
    /export\s+function\s+requirePackagesWorkerUrl/
  );
  assert.match(flags, /requireCoreWorkerUrl/);
  assert.match(env, /VITE_CORE_WORKER_URL=https:\/\/queens-salon-core-api/);
});

test("Core deployment owns the hourly package expiry cron", () => {
  const config = readFileSync("wrangler.core.jsonc", "utf8");
  assert.match(config, /"crons"/);
  assert.match(config, /"0 \* \* \* \*"/);
});
