import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("migration verifier exercises clean database and deployed-upgrade paths", () => {
  const source = read("scripts/verify-core-migration-safety.mjs");

  assert.match(source, /freshPersist/);
  assert.match(source, /upgradePersist/);
  assert.match(source, /files\.slice\(0, -1\)/);
  assert.match(source, /d1[\s\S]*migrations[\s\S]*apply/);
  assert.match(source, /__oi_upgrade_sentinel/);
  assert.match(source, /preserve-me/);
});

test("migration verifier enforces SQLite integrity, foreign keys, and migration ledger", () => {
  const source = read("scripts/verify-core-migration-safety.mjs");

  assert.match(source, /PRAGMA integrity_check/);
  assert.match(source, /PRAGMA foreign_key_check/);
  assert.match(source, /SELECT COUNT\(\*\) AS count FROM d1_migrations/);
  assert.match(source, /Invalid Core migration filename/);
  assert.match(source, /Core migration number moves backwards/);
  assert.match(source, /Empty Core migration/);
});

test("production Core config explicitly owns the Core migration directory", () => {
  const config = read("wrangler.core.jsonc");
  assert.match(config, /"binding":\s*"CORE_DB"/);
  assert.match(config, /"database_name":\s*"queens-salon-core"/);
  assert.match(config, /"migrations_dir":\s*"migrations\/core"/);
});


test("legacy duplicate numeric prefixes remain supported while order cannot move backwards", () => {
  const source = read("scripts/verify-core-migration-safety.mjs");

  assert.doesNotMatch(source, /Duplicate Core migration number/);
  assert.match(source, /if \(number < previous\)/);
  assert.match(source, /Core migration number moves backwards/);
});


test("Wrangler verifier is Windows-safe and spawns the local CLI through Node", () => {
  const source = read("scripts/verify-core-migration-safety.mjs");

  assert.match(source, /P5_WINDOWS_SPAWN_SAFETY_V1/);
  assert.match(source, /const wranglerCli = resolve\(root, "node_modules\/wrangler\/bin\/wrangler\.js"\)/);
  assert.match(
    source,
    /spawnSync\(\s*process\.execPath,\s*\[wranglerCli, \.\.\.args\]/
  );
  assert.doesNotMatch(source, /const\s+npx\s*=/);
  assert.doesNotMatch(source, /spawnSync\(\s*["']npx(?:\.cmd)?["']/);
});


test("local SQLite integrity inspection bypasses D1 PRAGMA authorization limits", () => {
  const source = read("scripts/verify-core-migration-safety.mjs");

  assert.match(source, /P5_LOCAL_SQLITE_INTEGRITY_V1/);
  assert.match(source, /DatabaseSync/);
  assert.match(source, /collectSqliteFiles/);
  assert.match(source, /openCoreSqlite/);
  assert.match(source, /PRAGMA integrity_check/);
  assert.match(source, /PRAGMA foreign_key_check/);
  assert.doesNotMatch(
    source,
    /executeJson\([\s\S]{0,300}pragma_integrity_check/
  );
});
