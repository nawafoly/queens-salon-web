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

test("dashboard bookings uses Core D1 without touching Firestore in Core mode", () => {
  const service = readFileSync("src/services/firestoreBookings.ts", "utf8");
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");

  const listStart = service.indexOf("export async function listBookings");
  const listEnd = service.indexOf("function watchFirestoreBookings", listStart);
  const listBlock = service.slice(listStart, listEnd);
  const coreListBranch = listBlock.match(
    /if \(getDataSourceFlags\(\)\.useCoreD1\) \{([\s\S]*?)\n\s*\}/
  )?.[1] || "";
  assert.match(coreListBranch, /return listCoreBookings\(scope\)/);
  assert.doesNotMatch(coreListBranch, /readFirestoreBookings/);

  const watchStart = service.indexOf("export function watchAllBookings");
  const watchEnd = service.indexOf("export async function listUserBookings", watchStart);
  const watchBlock = service.slice(watchStart, watchEnd);
  const coreWatchBranch = watchBlock.match(
    /if \(getDataSourceFlags\(\)\.useCoreD1\) \{([\s\S]*?)\n\s*\}\n\s*return watchFirestoreBookings/
  )?.[1] || "";
  assert.match(coreWatchBranch, /const rows = await listCoreBookings\(scope\)/);
  assert.match(coreWatchBranch, /setInterval\(loadCore, 8_000\)/);
  assert.doesNotMatch(coreWatchBranch, /watchFirestoreBookings/);

  assert.match(dashboard, /const scope = useCoreD1 \? undefined : \{ statuses: LIVE_ACTIVE_STATUSES \}/);
  assert.match(dashboard, /if \(useCoreD1\) setHistoryBookingsSource\(\[\]\)/);
  assert.match(dashboard, /تحديث البيانات/);
});

test("internal booking V2 staff source merges staff_public and employees without hardcoded staff names", () => {
  const staffSource = readFileSync("src/services/firestoreStaffPublic.ts", "utf8");
  const v2Source = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  assert.match(staffSource, /readStaffRowsFromCollection\(sid,\s*"staff_public"\)/);
  assert.match(staffSource, /readStaffRowsFromCollection\(sid,\s*"employees"\)/);
  assert.match(staffSource, /function mergeStaffRows/);
  assert.match(staffSource, /employeeProfile/);
  assert.match(v2Source, /filterStaffForInternalBookingTarget/);
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


test("internal booking V2 keeps internal staff visible independently from public booking visibility", () => {
  const helper = readFileSync("src/helpers/bookingAvailabilityUtils.ts", "utf8");
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  assert.match(helper, /filterStaffForInternalBookingTarget/);
  assert.match(helper, /specialties\.length === 0/);
  assert.match(v2, /requireShowOnBooking:\s*false/);
  assert.doesNotMatch(v2, /filter\(\(staff: any\) => staff\?\.showOnBooking !== false\)/);
});

test("dashboard reports read bookings and finance from explicit Core D1 sources", () => {
  const reports = readFileSync("src/pages/DashboardReports.tsx", "utf8");
  assert.match(reports, /listCoreBookings\(\)/);
  assert.match(reports, /listAllIncomeCore\(\)/);
  assert.match(reports, /listAllExpensesCore\(\)/);
  assert.match(reports, /return Number\(item\.amount \|\| 0\)/);
  assert.doesNotMatch(reports, /listAllIncomeFS\(/);
  assert.doesNotMatch(reports, /listAllExpensesFS\(/);
  assert.doesNotMatch(reports, /const bookingsQ = collection\(db, "salons", SALON_ID, "bookings"\)/);
  assert.doesNotMatch(reports, /const incomeQ = collection\(db, "salons", SALON_ID, "income"\)/);
});

test("dashboard income totals each payment row without replacing it with the full booking paid total", () => {
  const income = readFileSync("src/pages/DashboardIncome.tsx", "utf8");
  assert.match(income, /const effectiveAmount = Number\(x\.amount \|\| 0\)/);
  assert.match(income, /const rowEffectiveAmount = \(item: IncomeItem\) => Number\(item\.amount \|\| 0\)/);
  assert.doesNotMatch(income, /bm \? Number\(bm\.paidAmount \|\| 0\) : Number\(item\.amount \|\| 0\)/);
});

test("Core booking responses carry invoice paid totals and V2 retries idempotent financial posting", () => {
  const bookingsRepo = readFileSync("workers/core/repositories/bookings.js", "utf8");
  const mapper = readFileSync("src/services/coreBookingMappers.ts", "utf8");
  const paymentsRepo = readFileSync("workers/core/repositories/payments.js", "utf8");
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  assert.match(bookingsRepo, /paid_halalas:\s*Number\(invoice\?\.paid_halalas \|\| 0\)/);
  assert.match(mapper, /paidAmount = Math\.max/);
  assert.match(paymentsRepo, /payment_breakdown_json/);
  assert.match(paymentsRepo, /'booking'/);
  assert.match(v2, /recordPaymentWithRetry/);
  assert.match(v2, /لا تعيدي إنشاء الحجز/);
});


test("internal booking V2 is pinned to Core D1 and cannot read the Firestore booking counter", () => {
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const compat = readFileSync("src/services/bookingDataSourceCompat.ts", "utf8");
  const availabilityHelper = readFileSync("src/helpers/bookingAvailabilityUtils.ts", "utf8");
  const envWeb = readFileSync(".env.web", "utf8");
  assert.match(v2, /resolveCoreBookingDataSource/);
  assert.match(v2, /createBookingGroup\(\{ parent, items: itemRows \}, "core"\)/);
  assert.match(v2, /listActiveStaffAll\(SALON_ID, "core"\)/);
  assert.match(v2, /listOffers\(SALON_ID, "core"\)/);
  assert.match(v2, /getStaffAvailability\([\s\S]*?forceFresh:\s*true[\s\S]*?\}, "core"\)/);
  assert.match(v2, /isAvailabilityRangeFree/);
  assert.match(v2, /setStep\(3\)/);
  assert.match(availabilityHelper, /export function isAvailabilityRangeFree/);
  assert.match(availabilityHelper, /rangesOverlap/);
  assert.match(availabilityHelper, /lockedTimes/);
  assert.doesNotMatch(v2, /getDataSourceFlags\(\)\.useCoreD1/);
  assert.doesNotMatch(v2, /firebase\/firestore/);
  assert.match(compat, /mode === "core" \? resolveCoreBookingDataSource\(\)/);
  assert.match(envWeb, /VITE_CORE_WORKER_URL=https:\/\/queens-salon-core-api\.maedin\.workers\.dev/);
});


test("dashboard booking edit uses Core D1, owner bypasses password, and admins reauthenticate", () => {
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
  const service = readFileSync("src/services/firestoreBookings.ts", "utf8");
  const coreDataSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");
  const coreService = readFileSync("src/services/CoreBookingService.ts", "utf8");
  const repo = readFileSync("workers/core/repositories/bookings.js", "utf8");

  assert.match(dashboard, /reauthenticateWithCredential/);
  assert.match(dashboard, /EmailAuthProvider\.credential/);
  assert.match(dashboard, /if \(uiRole === "owner"\) \{\s*openEditBookingModalUnsafe\(b\)/);
  assert.match(dashboard, /sanitizeBookingNoteForEditor/);
  assert.match(dashboard, /resolveBookingDataSource\(\)\.getServiceSections/);
  assert.match(dashboard, /resolveBookingDataSource\(\)\.getActiveStaff/);
  assert.doesNotMatch(dashboard, /const BOOKING_ACTION_PIN/);

  assert.match(
    service,
    /export async function updateBookingDetails[\s\S]*?coreD1BookingDataSource\.updateBooking/
  );
  assert.doesNotMatch(service, /CORE_D1_BOOKING_RESCHEDULE_REQUIRES_PHASE6/);

  assert.match(coreDataSource, /reconcilePayment/);
  assert.match(coreDataSource, /clientName/);
  assert.match(coreDataSource, /serviceId/);
  assert.match(coreService, /paidHalalas/);
  assert.match(repo, /Booking details updated from dashboard/);
  assert.match(repo, /DELETE FROM payments WHERE salon_id = \? AND booking_id = \?/);
  assert.match(repo, /UPDATE booking_items/);
});

test("booking references are compact and dashboard delete preserves financial records", () => {
  const reference = readFileSync("src/helpers/bookingReference.ts", "utf8");
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const repo = readFileSync("workers/core/repositories/bookings.js", "utf8");
  const migration = readFileSync("migrations/core/0007_booking_soft_delete.sql", "utf8");
  const sequenceMigration = readFileSync("migrations/core/0008_booking_reference_sequence.sql", "utf8");

  assert.match(reference, /QS-/);
  assert.match(reference, /formatBookingReference/);
  assert.match(v2, /createdBookingReference/);
  assert.match(v2, /رقم الحجز/);
  assert.match(dashboard, /setBookings\(\(current\) => current\.filter/);
  assert.match(dashboard, /الاحتفاظ بالفاتورة والمدفوعات والسجل المالي/);
  assert.match(repo, /financialRecordsPreserved:\s*true/);
  assert.match(repo, /deleted_at IS NULL/);
  assert.match(migration, /ALTER TABLE bookings ADD COLUMN deleted_at TEXT/);
  assert.match(sequenceMigration, /VALUES \(\'main\', 10422/);
  assert.match(sequenceMigration, /CREATE TABLE IF NOT EXISTS booking_counters/);
  assert.match(repo, /allocateBookingPublicId/);
  assert.match(repo, /RETURNING last_number/);
  assert.match(repo, /return `MK-\$\{number\}`/);
  assert.doesNotMatch(repo, /optionalText\(data\.publicId \|\| data\.public_id\)/);
});
