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

test("booking resolver is pinned to Core D1 without Firestore fallback", () => {
  const source = readFileSync(
    "src/services/bookingDataSource.ts",
    "utf8"
  );
  assert.match(
    source,
    /resolveBookingDataSource\(\): BookingDataSource \{\s*return resolveCoreBookingDataSource\(\);/
  );
  assert.doesNotMatch(source, /firestoreBookingDataSource/);
  assert.doesNotMatch(source, /if \(flags\.useCoreD1\)/);
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

test("booking pages use one Core availability engine", () => {
  for (const file of [
    "src/pages/Booking.tsx",
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getStaffAvailability/);
    assert.doesNotMatch(source, /collection\([^\n]*["']booking_slots["']/);
    assert.doesNotMatch(source, /doc\([^\n]*["']availability_days["']/);
  }

  const legacyEntry = readFileSync("src/pages/BookingInternal.tsx", "utf8");
  assert.match(legacyEntry, /BookingInternalV2/);
  assert.doesNotMatch(
    legacyEntry,
    /getStaffAvailability|staffAvailability|firestoreAvailabilityBackfill/
  );
});

test("public booking loads catalog, packages, settings and files from Core-only services", () => {
  const source = readFileSync("src/pages/Booking.tsx", "utf8");
  assert.match(source, /listActiveCategoriesBySection\(sectionId, SALON_ID, "core"\)/);
  assert.match(source, /listActiveServices\(\{ sectionId \}, SALON_ID, "core"\)/);
  assert.match(source, /listActiveSections\(SALON_ID, "core"\)/);
  assert.match(source, /PackageService\.getActive\(\)/);
  assert.match(source, /CoreSettingsService\.get<any>\("app"\)/);
  assert.match(source, /ClientPortalService\.snapshot\(\)/);
  assert.match(source, /uploadFileToR2/);
  assert.doesNotMatch(source, /firebase\/firestore|firebase\/storage/);
  assert.doesNotMatch(source, /firestorePackages|createOrLoadUserProfile|getDataSourceFlags/);
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

test("Phase 5 facades use the correct Core source strategy", () => {
  const branchChecks = [
    ["src/services/firestoreIncome.ts", /CoreFinanceService/],
    ["src/services/firestoreExpenses.ts", /CoreFinanceService/],
    ["src/services/firestoreBookings.ts", /CoreBookingService/],
    ["src/services/logService.ts", /CoreAuditService/],
  ];

  for (const [file, servicePattern] of branchChecks) {
    const source = readFileSync(file, "utf8");
    assert.match(source, servicePattern);
  }
});

test("Phase 5 removes fallback branches from Core-only facade files", () => {
  const coreOnlyFiles = [
    "src/services/firestoreIncome.ts",
    "src/services/firestoreExpenses.ts",
    "src/services/firestoreBookings.ts",
    "src/services/logService.ts",
  ];

  for (const file of coreOnlyFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /getDataSourceFlags\(\)\.useCoreD1/);
  }
});

test("booking refund flow remains on Core operations services", () => {
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
  const internal = readFileSync("src/pages/BookingInternal.tsx", "utf8");
  assert.match(dashboard, /CoreRefundService/);
  assert.match(dashboard, /CoreAuditService/);
  assert.match(internal, /BookingInternalV2/);
  assert.doesNotMatch(internal, /CoreRefundService|getDataSourceFlags/);
});

test("internal booking V2 uses dated Core HR staff and scheduleWindows", () => {
  const v2Source = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );
  assert.match(v2Source, /listCoreBookableStaffForDate/);
  assert.match(v2Source, /getCoreStaffBookableStartSlots/);
  assert.match(v2Source, /getStaffAvailability/);
  assert.doesNotMatch(
    v2Source,
    /filterStaffForInternalBookingTarget|filterStaffSlotsByWorkingHours|isStaffAvailableForDate|isStaffOperationallyActiveForDate/
  );
  assert.doesNotMatch(
    v2Source,
    /firestoreStaffPublic|staff_public|bookingDataSourceCompat/
  );
  assert.doesNotMatch(v2Source, /Wessam|وسام/i);
});

test("booking metadata still carries Core traceability fields", () => {
  const customerBooking = readFileSync("src/pages/Booking.tsx", "utf8");
  const internalBooking = readFileSync(
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
    "utf8"
  );
  assert.match(customerBooking, /source:/);
  assert.match(internalBooking, /source:/);
});

test("Core booking mapper keeps server booking IDs", () => {
  const source = readFileSync("src/services/coreBookingMappers.ts", "utf8");
  assert.match(source, /serverBookingId/);
  assert.match(source, /id:/);
});

test("Core D1 booking source is the only resolved booking data source", () => {
  const source = readFileSync("src/services/bookingDataSource.ts", "utf8");
  assert.match(source, /resolveCoreBookingDataSource/);
  assert.doesNotMatch(source, /resolveFirestoreBookingDataSource/);
});
