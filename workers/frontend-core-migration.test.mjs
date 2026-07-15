import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("frontend migration guard passes", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-frontend-core-migration.mjs"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("feature flags default to explicit false checks", () => {
  const source = readFileSync(
    "src/config/dataSourceFlags.ts",
    "utf8"
  );
  assert.match(source, /toLowerCase\(\) === "true"/);
  assert.match(source, /requireCoreWorkerUrl/);
  assert.match(source, /requirePackagesWorkerUrl/);
});

test("D1 resolver has no automatic failure fallback", () => {
  const source = readFileSync(
    "src/services/bookingDataSource.ts",
    "utf8"
  );
  assert.match(source, /if \(flags\.useCoreD1\)/);
  assert.match(source, /return coreD1BookingDataSource/);
  assert.doesNotMatch(source, /catch[\s\S]{0,100}firestoreBookingDataSource/);
});

test("core API client sends a bearer token without logging it", () => {
  const source = readFileSync(
    "src/services/coreApiClient.ts",
    "utf8"
  );
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(source, /console\.(log|debug|info)\([^)]*token/);
});

test("package saga uses deterministic operation keys and release compensation", () => {
  const source = readFileSync(
    "src/services/packageBookingSaga.ts",
    "utf8"
  );
  assert.match(source, /packageSagaOperationId/);
  assert.match(source, /PackageOperationsService\.reserve/);
  assert.match(source, /PackageOperationsService\.release/);
  assert.match(source, /Promise\.allSettled/);
});

test("booking pages route slot availability through the selected data source", () => {
  for (const file of ["src/pages/Booking.tsx", "src/pages/BookingInternal.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getStaffAvailability/);
    assert.doesNotMatch(source, /collection\([^\n]*["']booking_slots["']/);
    assert.doesNotMatch(source, /doc\([^\n]*["']availability_days["']/);
  }
});

test("Core availability service caches per staff day and supports invalidation", () => {
  const source = readFileSync(
    "src/services/CoreAvailabilityService.ts",
    "utf8"
  );
  assert.match(source, /\/api\/core\/availability/);
  assert.match(source, /CACHE_TTL_MS/);
  assert.match(source, /invalidate\(/);
});

test("mixed package booking stores reservation references on Core booking items", () => {
  const saga = readFileSync(
    "src/services/packageBookingSaga.ts",
    "utf8"
  );
  const source = readFileSync(
    "src/services/bookingDataSources/coreD1BookingDataSource.ts",
    "utf8"
  );
  assert.match(saga, /PackageSagaReservation/);
  assert.match(source, /packageReservationId/);
  assert.match(source, /packageTransactionId/);
  assert.match(source, /bookingDate:/);
  assert.match(source, /startTime:/);
});
