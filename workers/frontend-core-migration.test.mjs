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

test("Phase 5 legacy facades use explicit Core D1 branches", () => {
  const checks = [
    ["src/services/firestoreIncome.ts", /CoreFinanceService/],
    ["src/services/firestoreExpenses.ts", /CoreFinanceService/],
    ["src/services/firestoreOffers.ts", /CoreOfferService/],
    ["src/services/firestoreBookings.ts", /CoreBookingService/],
    ["src/services/logService.ts", /CoreAuditService/],
  ];
  for (const [file, servicePattern] of checks) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getDataSourceFlags\(\)\.useCoreD1/);
    assert.match(source, servicePattern);
  }
});

test("Phase 5 migration adds admin operations without forcing unique client phones", () => {
  const migration = readFileSync("migrations/core/0004_admin_operations.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_sections/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS refunds/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS audit_logs/i);
  assert.match(migration, /voided_at/i);
  assert.doesNotMatch(migration, /CREATE\s+UNIQUE\s+INDEX[^;]*clients[^;]*phone_normalized/is);
});

test("dashboard refund workflows use Core refunds in D1 mode", () => {
  for (const file of ["src/pages/DashboardBookings.tsx", "src/pages/BookingInternal.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /CoreRefundService/);
    assert.match(source, /getDataSourceFlags\(\)\.useCoreD1/);
  }
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
  assert.match(dashboard, /CoreRefundService\.create/);
  assert.match(dashboard, /CoreRefundService\.remove/);
  assert.match(dashboard, /idempotencyKey:\s*`dashboard-refund:/);
});

test("Core migration preserves explicit halala fields", () => {
  const source = readFileSync("scripts/migrate-core-firestore-to-d1.mjs", "utf8");
  assert.match(source, /function moneyHalalas/);
  assert.match(source, /amountHalalas/);
  assert.match(source, /totalHalalas/);
});

test("Core migration writes D1 SQL through a file without explicit transactions", () => {
  const source = readFileSync("scripts/migrate-core-firestore-to-d1.mjs", "utf8");
  assert.match(source, /wrangler[\s\S]*d1[\s\S]*execute[\s\S]*--file/);
  assert.match(source, /mkdtempSync/);
  assert.doesNotMatch(source, /"BEGIN TRANSACTION;"/);
  assert.doesNotMatch(source, /"COMMIT;"/);
});

test("Core and package migrations share client canonicalization policy", () => {
  const core = readFileSync("scripts/migrate-core-firestore-to-d1.mjs", "utf8");
  const packages = readFileSync("scripts/migrate-session-packages-firestore-to-d1.mjs", "utf8");
  const shared = readFileSync("scripts/migration-client-canonicalization.mjs", "utf8");
  assert.match(core, /migration-client-canonicalization\.mjs/);
  assert.match(packages, /migration-client-canonicalization\.mjs/);
  assert.match(shared, /activePackageIds/);
  assert.match(shared, /client_alias_conflict/);
});

test("dashboard bookings merges Core D1 rows with legacy Firestore rows in Core mode", () => {
  const source = readFileSync("src/services/firestoreBookings.ts", "utf8");
  assert.match(source, /function mergeBookingReadRows/);
  assert.match(source, /async function readCoreBookings/);
  assert.match(source, /async function readFirestoreBookings/);
  assert.match(source, /function watchFirestoreBookings/);
  assert.match(source, /source:\s*"core-d1"/);
  assert.match(source, /source:\s*"firestore"/);
});

test("internal booking V2 staff source merges staff_public and employees without hardcoded staff names", () => {
  const staffSource = readFileSync("src/services/firestoreStaffPublic.ts", "utf8");
  const v2Source = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  assert.match(staffSource, /readStaffRowsFromCollection\(sid,\s*"staff_public"\)/);
  assert.match(staffSource, /readStaffRowsFromCollection\(sid,\s*"employees"\)/);
  assert.match(staffSource, /function mergeStaffRows/);
  assert.match(staffSource, /employeeProfile/);
  assert.match(v2Source, /filterStaffForResolverTarget/);
  assert.match(v2Source, /isStaffOperationallyActiveForDate/);
  assert.match(v2Source, /isStaffAvailableForDate/);
  assert.doesNotMatch(v2Source, /Wessam|وسام/i);
});

test("Core invoice printing is not Firestore-only and supports success reprint rows", () => {
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
  const coreInvoice = readFileSync("src/services/CoreInvoiceService.ts", "utf8");
  const workerIndex = readFileSync("workers/core/index.js", "utf8");
  const v2Source = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");

  assert.match(coreInvoice, /getByBookingId/);
  assert.match(coreInvoice, /query:\s*\{\s*bookingId\s*\}/);
  assert.match(workerIndex, /getInvoiceByBookingId/);
  assert.match(workerIndex, /query\.bookingId\s*\|\|\s*query\.booking_id/);
  assert.match(dashboard, /enrichCoreBookingForInvoicePrint/);
  assert.match(dashboard, /CoreInvoiceService\.getByBookingId/);
  assert.match(dashboard, /CorePaymentService\.list/);
  const printBlockStart = dashboard.indexOf("const handlePrintBookingInvoice");
  const printBlockEnd = dashboard.indexOf("const renderBookingSection");
  const printBlock = dashboard.slice(printBlockStart, printBlockEnd);
  assert.match(printBlock, /getBookingById/);
  assert.doesNotMatch(printBlock, /getDoc\(/);

  assert.match(v2Source, /buildInternalV2InvoiceRows/);
  assert.match(v2Source, /localStorage\.setItem\("allBookings"/);
  assert.match(v2Source, /success-internal/);
  assert.match(v2Source, /paymentMethod === "mixed"/);
  assert.match(v2Source, /paymentType === "none"/);
  assert.doesNotMatch(v2Source, /CoreAuditService/);
});

test("internal booking V2 uses shared discount snapshot flow instead of hardcoded zero discounts", () => {
  const v2Source = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const coreDataSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");
  const helper = readFileSync("src/helpers/bookingDiscountSnapshot.ts", "utf8");
  const migration = readFileSync("migrations/core/0006_booking_discount_snapshots.sql", "utf8");

  assert.match(v2Source, /buildDiscountSnapshot/);
  assert.match(v2Source, /listOffers/);
  assert.match(v2Source, /findActiveOfferByCode/);
  assert.match(v2Source, /discountSnapshot/);
  assert.match(v2Source, /discountMode === "offer"/);
  assert.match(v2Source, /discountMode === "coupon"/);
  assert.match(v2Source, /setDiscountMode\("fixed"\)/);
  assert.match(v2Source, /setDiscountMode\("percent"\)/);
  assert.doesNotMatch(v2Source, /className="is-discount"[\s\S]{0,120}<strong>0 ر\.س<\/strong>/);
  assert.match(coreDataSource, /discountSnapshot/);
  assert.match(coreDataSource, /discountHalalasForBooking/);
  assert.match(coreDataSource, /finalHalalasForBooking/);
  assert.match(helper, /eligibleSubtotalHalalas/);
  assert.match(helper, /usageCount/);
  assert.match(migration, /discount_snapshot_json/);
  assert.match(migration, /final_total_halalas/);
});
