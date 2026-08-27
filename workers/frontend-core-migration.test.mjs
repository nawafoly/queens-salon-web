import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
    assert.match(source, /getStaffAvailability|listCoreBookableStaffForDate/);
    assert.doesNotMatch(source, /collection\([^\n]*["']booking_slots["']/);
    assert.doesNotMatch(source, /doc\([^\n]*["']availability_days["']/);
  }

  assert.equal(existsSync("src/pages/BookingInternal.tsx"), false, "historical BookingInternal wrapper must stay deleted");
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

test("checkout never increments legacy Firestore package usage after Core booking", () => {
  const checkout = readFileSync("src/pages/Checkout.tsx", "utf8");
  assert.doesNotMatch(checkout, /firestorePackages|incrementPackageUsage/);
  assert.match(checkout, /checkoutCoreBookingService/);
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
  const financeChecks = [
    ["src/services/CoreIncomeService.ts", /CoreFinanceService/],
    ["src/services/CoreExpenseService.ts", /CoreFinanceService/],
  ];

  for (const [file, servicePattern] of financeChecks) {
    const source = readFileSync(file, "utf8");
    assert.match(source, servicePattern);
    assert.doesNotMatch(source, /firebase\/firestore/);
    assert.doesNotMatch(source, /getDataSourceFlags/);
  }

  const coreOnlyChecks = [
    ["src/services/firestoreBookings.ts", /CoreBookingService/],
    ["src/services/logService.ts", /CoreAuditService/],
  ];

  for (const [file, servicePattern] of coreOnlyChecks) {
    const source = readFileSync(file, "utf8");
    assert.match(source, servicePattern);
    assert.doesNotMatch(source, /getDataSourceFlags|useCoreD1|useBookingsD1/);
  }

  const offers = readFileSync("src/services/firestoreOffers.ts", "utf8");
  assert.match(offers, /CoreOfferService/);
  assert.doesNotMatch(offers, /firebase\/firestore/);
  assert.doesNotMatch(offers, /getDataSourceFlags/);
});

test("Phase 5 migration adds admin operations without forcing unique client phones", () => {
  const migration = readFileSync("migrations/core/0004_admin_operations.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_sections/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS refunds/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS audit_logs/i);
  assert.match(migration, /voided_at/i);
  assert.doesNotMatch(migration, /CREATE\s+UNIQUE\s+INDEX[^;]*clients[^;]*phone_normalized/is);
});

test("dashboard refund workflows use Core refunds without a Firestore branch", () => {
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
  const internalV2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");

  assert.match(dashboard, /CoreRefundService/);
  assert.doesNotMatch(dashboard, /getDataSourceFlags\(\)\.useCoreD1/);
  assert.doesNotMatch(dashboard, /firebase\/firestore/);
  assert.match(dashboard, /CoreRefundService\.create/);
  assert.match(dashboard, /CoreRefundService\.remove/);
  assert.match(dashboard, /idempotencyKey:\s*`dashboard-refund:/);

  assert.equal(existsSync("src/pages/BookingInternal.tsx"), false, "legacy internal booking entrypoint must stay deleted");
  assert.doesNotMatch(internalV2, /CoreRefundService|getDataSourceFlags/);
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

test("dashboard bookings uses Core D1 without an operational Firestore switch", () => {
  const service = readFileSync("src/services/firestoreBookings.ts", "utf8");
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");

  const listStart = service.indexOf("export async function listBookings");
  const listEnd = service.indexOf("export function watchAllBookings", listStart);
  const listBlock = service.slice(listStart, listEnd);
  assert.match(listBlock, /return listCoreBookings\(scope\)/);
  assert.doesNotMatch(listBlock, /getDataSourceFlags|readFirestoreBookings/);

  const watchStart = service.indexOf("export function watchAllBookings");
  const watchEnd = service.indexOf("export async function listUserBookings", watchStart);
  const watchBlock = service.slice(watchStart, watchEnd);
  assert.match(watchBlock, /const rows = await listCoreBookings\(scope\)/);
  assert.match(watchBlock, /setInterval\(loadCore,\s*8_000\)/);
  assert.doesNotMatch(watchBlock, /getDataSourceFlags|watchFirestoreBookings/);

  assert.match(dashboard, /CoreBookingService\.list\(\)/);
  assert.match(dashboard, /setInterval\(\(\) => void loadCoreBookings\(\), 8_000\)/);
  assert.doesNotMatch(dashboard, /watchAllBookings|getDataSourceFlags|firebase\/firestore/);
  assert.match(dashboard, /تحديث البيانات/);
});

test("internal booking V2 uses dated Core HR staff and scheduleWindows", () => {
  const v2Source = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  assert.match(v2Source, /listCoreBookableStaffForDate/);
  assert.match(v2Source, /getCoreStaffBookableStartSlots/);
  assert.match(v2Source, /getStaffAvailability/);
  assert.doesNotMatch(v2Source, /filterStaffForInternalBookingTarget|filterStaffSlotsByWorkingHours|isStaffAvailableForDate|isStaffOperationallyActiveForDate/);
  assert.doesNotMatch(v2Source, /firestoreStaffPublic|staff_public|bookingDataSourceCompat/);
  assert.doesNotMatch(v2Source, /Wessam|وسام/i);
});

test("backdated dates are exposed only by internal booking V2 and require confirmation", () => {
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const publicBooking = readFileSync("src/pages/Booking.tsx", "utf8");
  const coreService = readFileSync("src/services/CoreBookingService.ts", "utf8");
  const coreDataSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");

  assert.match(v2, /DashboardDatePickerV2[\s\S]{0,220}value=\{bookingDate\}/);
  assert.match(v2, /isPastBookingDate/);
  assert.match(v2, /أنت تقوم بإنشاء حجز بتاريخ سابق/);
  assert.match(v2, /تأكيد وإنشاء الحجز/);
  assert.match(v2, /submittingRef\.current/);
  assert.match(publicBooking, /id="bookingDate"[\s\S]{0,220}min=\{todayISO\(\)\}/);
  assert.match(publicBooking, /const isPast = cell\.iso < todayISO\(\)/);
  assert.match(coreService, /\/api\/core\/internal\/bookings/);
  assert.match(coreDataSource, /CoreBookingService\.createInternal/);
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
  assert.match(printBlock, /getCoreBookingById/);
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
  assert.match(v2Source, /CoreOfferService\.list/);
  assert.match(v2Source, /isCoreOfferActiveNow/);
  assert.match(v2Source, /CoreSettingsService\.get<InternalBookingAppSettings>\("app"\)/);
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

test("Core refunds are exposed as negative revenue and excluded from expenses", () => {
  const income = readFileSync("src/services/CoreIncomeService.ts", "utf8");
  const expenses = readFileSync("src/services/CoreExpenseService.ts", "utf8");
  const refundsRepo = readFileSync("workers/core/repositories/refunds.js", "utf8");
  const financeRepo = readFileSync("workers/core/repositories/finance.js", "utf8");
  const cleanupMigration = readFileSync("migrations/core/0009_remove_refund_expense_shadows.sql", "utf8");

  assert.match(income, /CoreRefundService\.list\(\)/);
  assert.match(income, /amount:\s*-Math\.abs/);
  assert.match(income, /source:\s*"refund"/);
  assert.match(expenses, /filter\(\(expense\) => !isRefundExpense\(expense\)\)/);
  assert.doesNotMatch(refundsRepo, /INSERT INTO expense_entries/);
  assert.match(financeRepo, /COALESCE\(source_kind/);
  assert.match(cleanupMigration, /DELETE FROM expense_entries/i);
});

test("dashboard reports read finance and payroll from explicit Malikat Core sources", () => {
  const reports = readFileSync("src/pages/DashboardReports.tsx", "utf8");
  assert.match(reports, /listCoreBookings\(\)/);
  assert.match(reports, /listAllIncomeCore\(\)/);
  assert.match(reports, /listAllExpensesCore\(\)/);
  assert.match(reports, /CoreHrService\.listPayrollEntries\(\)/);
  assert.match(reports, /generatePayrollEntriesForMonths/);
  assert.match(reports, /projectCorePayrollEntriesToFinancialRows/);

  assert.doesNotMatch(reports, /CoreHrService\.listEmployees\(\)/);
  assert.doesNotMatch(reports, /CoreSettingsService/);
  assert.doesNotMatch(reports, /normalizeCoreStaffPayrollRows/);
  assert.doesNotMatch(reports, /helpers\/staffPayroll/);
  assert.match(reports, /return Number\(item\.amount \|\| 0\)/);
  assert.doesNotMatch(reports, /firebase\/firestore/);
  assert.doesNotMatch(reports, /services\/firebase/);
  assert.doesNotMatch(reports, /AppSettingsService/);
  assert.doesNotMatch(reports, /FirestoreReadStats/);
  assert.doesNotMatch(reports, /staff_public/);
  assert.doesNotMatch(reports, /listAllIncomeFS\(/);
  assert.doesNotMatch(reports, /listAllExpensesFS\(/);
  assert.doesNotMatch(reports, /collection\(db/);
  assert.doesNotMatch(reports, /getDocs\(/);
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


test("internal booking V2 is direct Core-only and cannot read Firestore operational data", () => {
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const availabilityHelper = readFileSync("src/helpers/coreBookingAvailability.ts", "utf8");
  const envWeb = readFileSync(".env.web", "utf8");
  assert.match(v2, /resolveCoreBookingDataSource\(\)\.createBookingGroup\(\{ parent, items: itemRows \}\)/);
  assert.match(v2, /listCoreBookableStaffForDate/);
  assert.match(v2, /getCoreStaffBookableStartSlots/);
  assert.match(v2, /CoreOfferService\.list\(\{ active: true/);
  assert.match(v2, /CoreSettingsService\.get<InternalBookingAppSettings>\("app"\)/);
  assert.match(v2, /forceFresh:\s*true/);
  assert.match(v2, /resolveCoreBookingDataSource\(\)\.updateBooking/);
  assert.match(availabilityHelper, /start \+ service duration \+ buffer/i);
  assert.doesNotMatch(v2, /filterStaffSlotsByWorkingHours|isStaffAvailableForDate|isStaffWorkingAtTime|resolveStaffWorkingWindowsForDate/);
  assert.doesNotMatch(v2, /getDataSourceFlags|bookingDataSourceCompat|AppSettingsService|firestoreOffers/);
  assert.doesNotMatch(v2, /firebase\/firestore|firebase\/storage|services\/firebase/);
  assert.match(v2, /firebase\/auth/);
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

test("internal booking exposes packages and sessions management from Packages D1", () => {
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const panel = readFileSync("src/features/internal-booking-v2/PackageSessionsManager.tsx", "utf8");
  const service = readFileSync("src/services/PackageOperationsService.ts", "utf8");
  const routes = readFileSync("workers/packages/routes.js", "utf8");
  const d1 = readFileSync("workers/packages/d1.js", "utf8");

  assert.match(v2, /PackageSessionsManager/);
  assert.match(v2, /الباقات والجلسات/);
  assert.doesNotMatch(v2, /إدارة الحجوزات ستكون في مساحة مستقلة/);
  assert.match(panel, /العميلات المشتركات/);
  assert.match(panel, /سجل الجلسات/);
  assert.match(panel, /تحتاج متابعة/);
  assert.match(panel, /PackageOperationsService\.sessionDashboard/);
  assert.match(panel, /PackageOperationsService\.adjust/);
  assert.match(panel, /تعديل جلسات الباقة/);
  assert.match(panel, /الرصيد بعد التعديل/);
  assert.doesNotMatch(panel, /window\.prompt/);
  assert.match(service, /\/api\/packages\/admin\/session-dashboard/);
  assert.match(service, /normalizePackagesWorkerBaseUrl/);
  assert.match(service, /indexOf\("\/api\/packages"\)/);
  assert.match(routes, /sessionDashboardAdminD1/);
  assert.match(routes, /const pathname = url\.pathname/);
  assert.match(routes, /url\.pathname\.replace/);
  assert.match(d1, /package_transactions/);
  assert.match(d1, /subscribedClients/);
  assert.doesNotMatch(panel, /firebase\/firestore/);
});

test("dashboard exposes standalone attendance device security center in the V2 visual language", () => {
  const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");
  const mobileNav = readFileSync("src/components/DashboardMobileNav.tsx", "utf8");
  const page = readFileSync("src/pages/DashboardAttendanceSecurity.tsx", "utf8");
  const service = readFileSync("src/services/attendanceWorkerService.ts", "utf8");
  const worker = readFileSync("workers/attendance-worker.js", "utf8");
  const migration = readFileSync("workers/attendance-migrations/0005_create_attendance_device_security.sql", "utf8");

  assert.match(dashboard, /path="attendance"/);
  assert.match(dashboard, /سجل البصمة والأجهزة/);
  assert.match(mobileNav, /\/dashboard\/attendance/);
  assert.match(page, /Attendance D1/);
  assert.match(page, /سجل البصمات/);
  assert.match(page, /الأجهزة/);
  assert.match(page, /التنبيهات/);
  assert.match(page, /updateAttendanceDeviceStatus/);
  assert.match(service, /\/attendance\/admin\/dashboard/);
  assert.match(worker, /attendance_security_events/);
  assert.match(worker, /blocked_device_attempt/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_devices/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_device_assignments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_security_events/);
  assert.doesNotMatch(page, /firebase\/firestore/);
});

test("client portal uses authenticated Core D1 snapshot instead of fixed profile counters", () => {
  const profile = readFileSync("src/pages/Profile.tsx", "utf8");
  const service = readFileSync("src/services/ClientPortalService.ts", "utf8");
  const worker = readFileSync("workers/core/index.js", "utf8");

  assert.match(profile, /ClientPortalService\.snapshot\(\)/);
  assert.match(profile, /const kpis = useMemo/);
  assert.match(profile, /const total = bookings\.length/);
  assert.match(profile, /setLoyaltyData\(snapshot\.loyalty\)/);
  assert.doesNotMatch(profile, /points\s*:\s*300/);
  assert.doesNotMatch(profile, /completed\s*:\s*6/);
  assert.match(service, /\/api\/core\/client\/portal/);
  assert.match(service, /\/api\/core\/client\/me/);
  assert.match(worker, /client\/bookings/);
  assert.match(worker, /client\/loyalty/);
  assert.match(worker, /client\/offers/);
  assert.match(worker, /getClientPortalSnapshot/);
  assert.match(worker, /listSelfBookings/);
  assert.match(worker, /getSelfLoyalty/);
  assert.match(worker, /listSelfOffers/);
});

test("public booking repairs stale service IDs before creating a Core booking", () => {
  const booking = readFileSync("src/pages/Booking.tsx", "utf8");
  const serviceRepo = readFileSync(
    "workers/core/repositories/services.js",
    "utf8"
  );

  assert.match(booking, /function serviceNamesEquivalent/);
  assert.match(booking, /Repair an old local booking draft/);
  assert.match(booking, /let canonicalId = resolveCanonicalServiceId/);
  assert.match(booking, /allCoreServicesForSubmit/);
  assert.match(booking, /coreServiceByIdForSubmit/);
  assert.match(booking, /await ensureServiceByIdForOffer\(canonicalId\)/);
  assert.match(booking, /serviceId:\s*canonicalId/);
  assert.match(booking, /const unresolvedService = items\.find/);
  assert.match(booking, /localStorage\.removeItem\("bookingDraft"\)/);
  assert.match(serviceRepo, /normalizedServiceNameTokens/);
  assert.match(serviceRepo, /shared\.length >= 2/);
  assert.match(serviceRepo, /normalizedMatches\.length === 1/);
});

test("administrative bookings attach to the selected canonical client and repair legacy duplicate links", () => {
  const internalBooking = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const bookingSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");
  const portalRepo = readFileSync("workers/core/repositories/client-portal.js", "utf8");

  assert.match(internalBooking, /let canonicalClientId = ""/);
  assert.match(internalBooking, /clientId:\s*canonicalClientId/);
  assert.match(internalBooking, /userId:\s*null/);
  assert.match(internalBooking, /createdByUid:\s*userId/);
  assert.match(bookingSource, /const explicitClientId = String\(booking\.clientId/);
  assert.match(bookingSource, /CoreClientService\.get\(explicitClientId\)/);
  assert.match(portalRepo, /UPDATE bookings SET client_id = \?/);
  assert.match(portalRepo, /UPDATE invoices SET client_id = \?/);
  assert.match(portalRepo, /UPDATE payments SET client_id = \?/);
  assert.match(portalRepo, /UPDATE refunds SET client_id = \?/);
  assert.match(portalRepo, /legacy_client_id/);
});

test("client mobile routes and bottom navigation expose packages instead of Instagram", () => {
  const profile = readFileSync("src/pages/Profile.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const css = readFileSync("src/index.css", "utf8");

  for (const route of [
    "/client",
    "/client/bookings",
    "/client/packages",
    "/client/offers",
    "/client/profile",
  ]) {
    assert.match(profile + app, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(profile, /client-bottom-navigation/);
  assert.match(profile, /باقاتي/);
  assert.doesNotMatch(profile, /Instagram|انستغرام|إنستغرام/i);
  assert.match(app, /path="\/client\/\*"/);
  assert.match(css, /\.client-app-shell\s*\{[\s\S]*?max-width:\s*480px/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /^main\s*\{[\s\S]*?max-width:\s*480px/m);
});

test("client package wallet and catalog remain Packages D1-only", () => {
  const panel = readFileSync("src/components/packages/MyPackagesPanel.tsx", "utf8");
  const operations = readFileSync("src/services/PackageOperationsService.ts", "utf8");
  const catalog = readFileSync("src/services/PackageService.ts", "utf8");
  const settings = readFileSync("src/pages/settings/SettingsCatalog.tsx", "utf8");
  const routes = readFileSync("workers/packages/routes.js", "utf8");

  assert.match(panel, /PackageOperationsService\.myWallet/);
  assert.match(panel, /PackageOperationsService\.myCatalog/);
  assert.match(panel, /لا توجد لديك باقات نشطة حاليًا/);
  assert.doesNotMatch(panel, /firebase\/firestore/);
  assert.match(operations, /\/api\/packages\/my-wallet/);
  assert.match(operations, /\/api\/packages\/my-catalog/);
  assert.match(catalog, /PackageOperationsService\.listCatalog/);
  assert.match(settings, /PackageService/);
  assert.match(routes, /GET \/api\/packages\/my-catalog/);
  assert.match(routes, /GET \/api\/packages\/admin\/catalog/);
});

test("package session state changes are booking-idempotent across completion cancellation and refunds", () => {
  const packageRepo = readFileSync("workers/packages/d1.js", "utf8");
  const packageRoutes = readFileSync("workers/packages/routes.js", "utf8");
  const packageService = readFileSync("src/services/PackageOperationsService.ts", "utf8");
  const bookingSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");
  const dashboard = readFileSync("src/pages/DashboardBookings.tsx", "utf8");

  assert.match(packageRepo, /async function bookingSessionLedger/);
  assert.match(packageRepo, /for \(const source of ledger\.sources\)/);
  assert.match(packageRepo, /reapplyBookingSessionD1/);
  assert.match(packageRoutes, /POST \/api\/packages\/redemption\/reapply/);
  assert.match(packageService, /reapplyBookingSession/);
  assert.match(bookingSource, /PackageOperationsService\.consumeReserved/);
  assert.match(bookingSource, /PackageOperationsService\.restoreReserved/);
  assert.match(dashboard, /PackageOperationsService\.restoreConsumed/);
  assert.match(dashboard, /PackageOperationsService\.reapplyBookingSession/);
  const restoreStart = packageService.indexOf("restoreConsumed(bookingId");
  const restoreEnd = packageService.indexOf("reapplyBookingSession", restoreStart);
  assert.doesNotMatch(packageService.slice(restoreStart, restoreEnd), /operationId|Math\.random/);
});

test("loyalty ledger earns only from completed bookings and reverses cumulative refunds deterministically", () => {
  const portalRepo = readFileSync("workers/core/repositories/client-portal.js", "utf8");
  const migration = readFileSync("migrations/core/0010_client_portal_loyalty_offers.sql", "utf8");

  assert.match(portalRepo, /status = 'completed' AND deleted_at IS NULL/);
  assert.match(portalRepo, /DELETE FROM loyalty_point_transactions/);
  assert.match(portalRepo, /loyalty_earn_/);
  assert.match(portalRepo, /loyalty_refund_/);
  assert.match(portalRepo, /refundedHalalas/);
  assert.match(portalRepo, /targetReversal/);
  assert.match(portalRepo, /Math\.min\(\s*completedBooking\.points/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS loyalty_point_transactions/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_core_loyalty_idempotency/);
});

test("client offers require publication, active dates, and matching target identity", () => {
  const portalRepo = readFileSync("workers/core/repositories/client-portal.js", "utf8");
  const offersPage = readFileSync("src/pages/DashboardOffers.tsx", "utf8");
  const offerService = readFileSync("src/services/CoreOfferService.ts", "utf8");

  assert.match(portalRepo, /COALESCE\(published, 1\) = 1/);
  assert.match(portalRepo, /starts_at IS NULL[\s\S]*starts_at <= \?/);
  assert.match(portalRepo, /ends_at IS NULL[\s\S]*ends_at >= \?/);
  assert.match(portalRepo, /target_scope/);
  assert.match(portalRepo, /target_client_ids_json/);
  assert.match(offersPage, /draft/);
  assert.match(offersPage, /scheduled/);
  assert.match(offersPage, /expired/);
  assert.match(offersPage, /targetScope/);
  assert.match(offerService, /published/);
  assert.match(offerService, /targetClientIds/);
});

test("admin client overview is Core D1-backed, role-protected, and supports idempotent loyalty adjustments", () => {
  const worker = readFileSync("workers/core/index.js", "utf8");
  const repo = readFileSync("workers/core/repositories/client-portal.js", "utf8");
  const service = readFileSync("src/services/CoreClientService.ts", "utf8");
  const page = readFileSync("src/pages/DashboardClients.tsx", "utf8");

  assert.match(worker, /clientOverview = \/\^\\\/api\\\/core\\\/clients/);
  assert.match(worker, /client:admin-overview/);
  assert.match(worker, /client:loyalty-adjustment/);
  assert.match(worker, /requireRole\(ctx\.role, ADMIN_ROLES\)/);
  assert.match(worker, /const isClientSelfRoute = new Set/);
  assert.doesNotMatch(worker, /startsWith\("client:"\)/);
  assert.match(repo, /getAdminClientOverview/);
  assert.match(repo, /adjustClientLoyalty/);
  assert.match(repo, /loyalty_adjustment_\$\{operationId\}/);
  assert.match(repo, /INSERT OR IGNORE INTO loyalty_point_transactions/);
  assert.match(service, /\/overview/);
  assert.match(service, /\/loyalty-adjustments/);
  assert.match(page, /CoreClientService\.overview/);
  assert.match(page, /CoreClientService\.adjustLoyalty/);
  assert.match(page, /السجل الموحد للعميلة/);
  assert.match(page, /الدفعات والاسترجاعات/);
  assert.match(page, /العروض المستخدمة/);
});

test("client offer CTA preselects the offer through the booking page supported query contract", () => {
  const profile = readFileSync("src/pages/Profile.tsx", "utf8");
  const booking = readFileSync("src/pages/Booking.tsx", "utf8");

  assert.match(profile, /scope=offers&pick=/);
  assert.match(profile, /offer:\$\{offer\.id\}/);
  assert.match(booking, /params\.get\("scope"\)/);
  assert.match(booking, /pickRaw/);
  assert.match(booking, /offer:/);
});

test("public and client booking never query the administrative client list", () => {
  const source = readFileSync(
    "src/services/bookingDataSources/coreD1BookingDataSource.ts",
    "utf8"
  );
  const start = source.indexOf("async function resolveClientId");
  const end = source.indexOf("function generatedBookingId", start);
  const block = source.slice(start, end);
  assert.match(block, /CoreClientService\.create/);
  assert.doesNotMatch(block, /CoreClientService\.list/);
  assert.match(block, /booking\.channel === "client"/);
});

test("client audit calls are not sent to the administrative Core audit endpoint", () => {
  const source = readFileSync("src/services/logService.ts", "utf8");
  assert.match(source, /\["client", "guest"\]/);
  assert.match(source, /return null/);
});

test("Core worker binds authenticated bookings to the verified client identity", () => {
  const source = readFileSync("workers/core/index.js", "utf8");
  const authContext = readFileSync("workers/core/auth-context.js", "utf8");
  assert.match(source, /getAuthContext/);
  assert.match(authContext, /getAccountByFirebaseUid/);
  assert.match(source, /resolveSelfClient/);
  assert.match(source, /clientId:\s*selfClient\.id/);
  assert.match(source, /source:\s*"client"/);
});

test("front-end operational identity comes from Core app_users and permissions", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const permissionContext = readFileSync("src/security/PermissionContext.tsx", "utf8");
  const settingsUsers = readFileSync("src/pages/settings/SettingsUsers.tsx", "utf8");
  const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");
  const dashboardSettings = readFileSync("src/pages/DashboardSettings.tsx", "utf8");
  const authAccess = readFileSync("src/services/authAccess.ts", "utf8");
  const coreAccountService = readFileSync("src/services/CoreAccountService.ts", "utf8");

  assert.match(coreAccountService, /\/api\/auth\/me/);
  assert.match(coreAccountService, /\/api\/admin\/accounts/);
  assert.match(app, /CoreAccountService\.me/);
  assert.match(app, /permissions:\s*me\.permissions/);
  assert.match(app, /getEffectiveAppPermissions\(permissionSource\)/);
  assert.doesNotMatch(app, /firebase\/firestore|getDoc\(|onSnapshot\(doc\(db/);
  assert.match(permissionContext, /getEffectiveAppPermissions/);
  assert.doesNotMatch(permissionContext, /normalizeAppPermissions\(permissions\)/);
  assert.match(settingsUsers, /CoreAccountService/);
  assert.match(settingsUsers, /CoreAccountService\.linkEmployee/);
  assert.doesNotMatch(settingsUsers, /firebase\/firestore|collection\(db|doc\(db|getDocs\(|setDoc\(|deleteDoc\(/);
  assert.match(dashboard, /readVerifiedUserAccess/);
  assert.doesNotMatch(dashboard, /createOrLoadUserProfile/);
  assert.match(dashboardSettings, /normalizeAuthRole/);
  assert.doesNotMatch(dashboardSettings, /firebase\/firestore|onAuthStateChanged|doc\(db|getDoc\(/);
  assert.match(authAccess, /CoreAccountService\.me/);
  assert.doesNotMatch(authAccess, /firebase\/firestore|FirestoreRestClient|batchGet|runQuery/);
});

test("Core auth path does not read Firestore role profiles", () => {
  const coreAuth = readFileSync("workers/core/auth-context.js", "utf8");
  const packageAuth = readFileSync("workers/packages/auth.js", "utf8");
  const accountRepo = readFileSync("workers/core/repositories/accounts.js", "utf8");

  assert.match(coreAuth, /getAccountByFirebaseUid/);
  assert.match(coreAuth, /assertAccountCanAuthenticate/);
  assert.match(accountRepo, /SELECT \* FROM app_users WHERE salon_id = \? AND firebase_uid = \?/);
  assert.doesNotMatch(packageAuth, /documents\/users|documents\/admin_users|firestore\.googleapis/);
  assert.doesNotMatch(packageAuth, /readOwnRoleDocument|documentData|roleDocumentUrl/);
});
test("public catalog surfaces never require Firestore authentication", () => {
  const booking = readFileSync("src/pages/Booking.tsx", "utf8");
  assert.match(booking, /listActiveSections\(SALON_ID, "core"\)/);
  assert.match(booking, /PackageService\.getActive\(\)/);
  assert.match(booking, /loadSectionCatalogFromCore/);
  assert.doesNotMatch(booking, /firebase\/firestore|firebase\/storage/);
  assert.doesNotMatch(booking, /getDoc\(|getDocs\(|collection\(db|firestorePackages/);

  for (const file of [
    "src/pages/Services.tsx",
    "src/pages/Pricing.tsx",
    "src/components/HomeServices.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /CoreCatalogService/);
    assert.doesNotMatch(source, /firebase\/firestore/);
  }

  const settings = readFileSync("src/services/AppSettingsService.ts", "utf8");
  assert.match(settings, /CoreSettingsService\.get/);
  assert.match(settings, /CoreSettingsService\.save/);
  assert.doesNotMatch(settings, /firebase\/firestore|getDataSourceFlags|useSettingsD1|useCoreD1/);
});
test("public booking staff loading is Core-only and cannot keep a stale spinner", () => {
  const source = readFileSync("src/pages/Booking.tsx", "utf8");
  assert.match(source, /listStaffForService/);
  assert.match(source, /getStaffAvailability/);
  assert.match(source, /staffRequestVersionRef/);
  assert.match(source, /Always finish the newest request/);
  assert.doesNotMatch(source, /finally\s*\{\s*if \(!cancelled\)\s*\{\s*setStaffLoadingByService/);
  assert.match(source, /setStaffDisplayById\(next\)/);
  assert.doesNotMatch(source, /staff_public|firebase\/firestore/);
});
