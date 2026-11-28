import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldUseIdempotency } from "./core/idempotency.js";

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

test("booking creation uses live authorization and domain replay instead of a strandable HTTP pending key", () => {
  const request = new Request("https://worker.test/api/core/bookings", {
    method: "POST",
    body: JSON.stringify({ id: "booking-replay" }),
  });
  assert.equal(shouldUseIdempotency(request, "booking-replay"), false);
  assert.equal(
    shouldUseIdempotency(
      new Request("https://worker.test/api/core/bookings/booking-replay", { method: "PATCH" }),
      "booking-patch"
    ),
    true
  );
});

test("operational integrity workflow is a blocking release-quality gate", () => {
  const workflow = read(".github/workflows/operational-integrity-hardening.yml");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /run:\s*npm audit --audit-level=low/);
  assert.match(workflow, /npm run verify:operational-integrity/);
  assert.match(workflow, /git diff --check/);
});

test("B04 internal booking creation bypasses the strandable generic pending ledger", () => {
  for (const path of [
    "/api/core/bookings",
    "/api/core/bookings/",
    "/api/core/internal/bookings",
    "/api/core/internal/bookings/"
  ]) {
    const request = new Request(`https://worker.test${path}`, {
      method: "POST",
      body: JSON.stringify({ id: "booking-stable-id" }),
    });

    assert.equal(
      shouldUseIdempotency(request, "booking-stable-id"),
      false,
      path
    );
  }
});

test("B04 non-creation booking mutations retain their HTTP idempotency protection", () => {
  for (const path of [
    "/api/core/bookings/booking-a/cancel",
    "/api/core/bookings/booking-a/complete",
    "/api/core/bookings/booking-a/reschedule",
    "/api/core/internal/bookings/booking-a/rollback",
    "/api/core/bookings/booking-a/staff-status"
  ]) {
    const request = new Request(`https://worker.test${path}`, {
      method: "POST",
      body: "{}",
    });

    assert.equal(
      shouldUseIdempotency(request, "mutation-stable-id"),
      true,
      path
    );
  }
});

test("B04 booking transport uses the supplied booking identity for both creation channels", () => {
  const source = read("src/services/CoreBookingService.ts");

  for (const method of ["create", "createInternal"]) {
    const start = source.indexOf(`async ${method}(`);
    assert.notEqual(start, -1);

    const end = source.indexOf("\n  },", start);
    assert.notEqual(end, -1);

    const block = source.slice(start, end);

    assert.match(
      block,
      /operationId:\s*String\(input\.id\s*\|\|\s*""\)\.trim\(\)/
    );
  }
});

test("B04 booking creation transport rejects missing or malformed stable identities", () => {
  const source = read("src/services/CoreBookingService.ts");

  const start = source.indexOf("function requireStableBookingIdentity(");
  assert.notEqual(start, -1);

  const end = source.indexOf("export const CoreBookingService", start);
  assert.notEqual(end, -1);

  const declaration = source.slice(start, end)
    .replace("input: CoreCreateBookingInput", "input")
    .replace("): string {", ") {");

  const validate = new Function(
    declaration + "\nreturn requireStableBookingIdentity;"
  )();

  for (const value of [
    undefined,
    null,
    "",
    "   ",
    "contains spaces",
    "contains/slash",
    "x".repeat(129)
  ]) {
    assert.throws(
      () => validate({ id: value }),
      /core_booking:stable_creation_identity_required/
    );
  }

  assert.equal(
    validate({ id: "booking-a_123" }),
    "booking-a_123"
  );

  assert.equal(
    validate({ id: "67157dc1-d063-4ea1-a9b7-a97324351a46" }),
    "67157dc1-d063-4ea1-a9b7-a97324351a46"
  );

  for (const method of ["create", "createInternal"]) {
    const offset = source.indexOf(`async ${method}(`);
    assert.notEqual(offset, -1);

    const methodEnd = source.indexOf("\n  },", offset);
    assert.notEqual(methodEnd, -1);

    const block = source.slice(offset, methodEnd);

    assert.ok(
      block.indexOf("requireStableBookingIdentity(input)") <
      block.indexOf("await coreApiRequest")
    );

    assert.match(block, /requireStableBookingIdentity\(input\)/);
  }
});
