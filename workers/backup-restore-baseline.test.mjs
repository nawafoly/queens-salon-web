import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("backup baseline exports application data while canonical schema stays migration-owned", () => {
  const source = read("scripts/verify-core-backup-restore.mjs");

  assert.match(source, /P6_BACKUP_RESTORE_DRILL_V2/);
  assert.match(source, /"d1",[\s\S]*"export"/);
  assert.match(source, /"--no-schema"/);
  assert.match(source, /exportArgs\.push\("--table", table\)/);
  assert.match(source, /cpSync\([\s\S]*restoreRoot[\s\S]*"migrations\/core"/);
  assert.match(source, /"migrations",[\s\S]*"apply"/);
  assert.doesNotMatch(
    source,
    /INSERT\s+INTO\s+\[["']\?d1_migrations/
  );
});

test("restore drill bypasses the known full-dump ordering hazard without bypassing verification", () => {
  const source = read("scripts/verify-core-backup-restore.mjs");

  assert.match(source, /P6_LOCAL_DATA_RESTORE_V1/);
  assert.match(source, /DatabaseSync/);
  assert.match(source, /prepareRestoreDataTarget/);
  assert.match(source, /restoredDb\.exec\(backupSql\)/);
  assert.match(source, /restoreTriggers/);
});

test("restore drill verifies checksum schema row counts sentinel integrity and foreign keys", () => {
  const source = read("scripts/verify-core-backup-restore.mjs");

  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /restore-me-exactly/);
  assert.match(source, /applicationTables/);
  assert.match(source, /rowCounts/);
  assert.match(source, /PRAGMA integrity_check/);
  assert.match(source, /PRAGMA foreign_key_check/);
  assert.match(source, /Restored table row counts do not match backup source/);
});

test("restore drill is local-only and cleans isolated workspaces", () => {
  const source = read("scripts/verify-core-backup-restore.mjs");

  assert.match(source, /"--local"/);
  assert.doesNotMatch(source, /"--remote"/);
  assert.match(source, /rmSync\(tempRoot, \{ recursive: true, force: true \}\)/);
});
