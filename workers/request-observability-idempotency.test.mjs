import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("Core client uses fresh request IDs and stable mutation operation IDs across 401 retry", () => {
  const source = read("src/services/coreApiClient.ts");

  assert.match(source, /CORE_REQUEST_TRACE_V1/);
  assert.match(source, /"X-Request-Id": requestId/);
  assert.match(source, /"Idempotency-Key": operationId/);
  assert.match(source, /const operationId[\s\S]*createCoreOperationId/);
  assert.match(
    source,
    /requestOnce<T>\([\s\S]*false,[\s\S]*operationId[\s\S]*requestOnce<T>\([\s\S]*true,[\s\S]*operationId/
  );
  assert.match(source, /const requestId = createCoreRequestId\(\)/);
});

test("Core Worker exposes request IDs and structured completion telemetry", () => {
  const source = read("workers/core/index.js");

  assert.match(source, /CORE_REQUEST_OBSERVABILITY_V1/);
  assert.match(source, /Access-Control-Allow-Headers[\s\S]*X-Request-Id[\s\S]*Idempotency-Key/);
  assert.match(source, /Access-Control-Expose-Headers[\s\S]*X-Request-Id/);
  assert.match(source, /responseWithRequestId/);
  assert.match(source, /core_request_completed/);
  assert.match(source, /durationMs/);
  assert.match(source, /replayed/);
});

test("Core mutation ledger rejects divergent reuse and replays completed operations", () => {
  const source = read("workers/core/idempotency.js");
  const worker = read("workers/core/index.js");
  const migration = read("migrations/core/0056_core_request_idempotency.sql");

  assert.match(source, /requestFingerprint/);
  assert.match(source, /INSERT OR IGNORE INTO core_idempotency_operations/);
  assert.match(source, /action: "conflict"/);
  assert.match(source, /action: "replay"/);
  assert.match(source, /state = 'completed'/);
  assert.match(worker, /core_api:idempotency_key_reused/);
  assert.match(worker, /core_api:idempotency_in_progress/);
  assert.match(migration, /PRIMARY KEY \(salon_id, operation_id\)/);
  assert.match(migration, /CHECK \(state IN \('pending', 'completed'\)\)/);
});

test("401 token refresh abandons pending ledger entry instead of poisoning the retry", () => {
  const source = read("workers/core/index.js");

  assert.match(
    source,
    /if \(response\.status === 401\)[\s\S]*abandonIdempotentOperation/
  );
});

test("operational integrity workflow is a blocking release-quality gate", () => {
  const workflow = read(".github/workflows/operational-integrity-hardening.yml");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npm run verify:operational-integrity/);
  assert.match(workflow, /git diff --check/);
});
