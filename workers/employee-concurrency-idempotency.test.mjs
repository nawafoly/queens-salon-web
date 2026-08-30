import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("employee Core write uses an updated_at optimistic precondition fence", () => {
  const repo = read("workers/core/repositories/hr-employees.js");

  assert.match(repo, /EMPLOYEE_OPTIMISTIC_CONCURRENCY_V1/);
  assert.match(repo, /expectedUpdatedAt/);
  assert.match(
    repo,
    /WHERE \? = 0 OR employee_profiles\.updated_at = \?/
  );
  assert.match(
    repo,
    /concurrency_profile\.updated_at = \?/
  );
  assert.match(repo, /core_hr:employee_changed/);
});

test("Dashboard employee save sends and rebases the canonical employee revision", () => {
  const source = read("src/pages/DashboardEmployees.tsx");

  assert.match(source, /coreEmployeeUpdatedAtBaselineRef/);
  assert.match(source, /EMPLOYEE_CANONICAL_REVISION_BASELINE_V1/);
  assert.match(source, /enforceConcurrency:\s*Boolean\(editId\)/);
  assert.match(
    source,
    /expectedUpdatedAt:[\s\S]*coreEmployeeUpdatedAtBaselineRef\.current/
  );
  assert.match(
    source,
    /refreshedCoreEmployee as any\)\?\.updatedAt/
  );
});

test("working-hour sync is replay-safe without weakening divergent concurrency", () => {
  const source = read("workers/core/repositories/shift-control.js");

  const replay = source.indexOf("WORKING_HOUR_SYNC_SEMANTIC_IDEMPOTENCY_V1");
  const desiredCheck = source.indexOf(
    "currentProjection,\n      desired".replace("\\n", "\n"),
    replay
  );
  const conflict = source.indexOf(
    "working_hour_exceptions_changed",
    replay
  );

  assert.ok(replay >= 0);
  assert.ok(desiredCheck > replay);
  assert.ok(conflict > desiredCheck);
  assert.match(source, /idempotent_replay:\s*true/);
  assert.match(source, /currentProjection,[\s\S]*expected/);
});

test("Core client exposes specific employee concurrency messages", () => {
  const source = read("src/services/coreApiClient.ts");
  assert.match(source, /core_hr:employee_changed/);
  assert.match(source, /core_hr:employee_write_precondition_required/);
});
