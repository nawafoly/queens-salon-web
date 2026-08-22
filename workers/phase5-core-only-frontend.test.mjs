import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Phase 5 package and booking frontend paths are Core-only", () => {
  const clientPackageService = read("src/services/ClientPackageService.ts");
  const clientPackagesPanel = read("src/components/packages/ClientPackagesPanel.tsx");
  const adminPackageFlow = read("src/components/packages/AdminPackageFlow.tsx");
  const packageOperations = read("src/services/PackageOperationsService.ts");
  const bookingSource = read("src/services/bookingDataSource.ts");
  const coreBookingSource = read(
    "src/services/bookingDataSources/coreD1BookingDataSource.ts"
  );
  const offersFacade = read("src/services/firestoreOffers.ts");
  const publicOffersPage = read("src/pages/Offers.tsx");
  const dashboardOffersPage = read("src/pages/DashboardOffers.tsx");
  const dashboardClientsPage = read("src/pages/DashboardClients.tsx");
  const dashboardBookingsPage = read("src/pages/DashboardBookings.tsx");
  const dashboardReportsPage = read("src/pages/DashboardReports.tsx");
  const publicBookingPage = read("src/pages/Booking.tsx");
  const internalBookingV2 = read(
    "src/features/internal-booking-v2/BookingInternalV2.tsx"
  );
  const packageSessionsManager = read(
    "src/features/internal-booking-v2/PackageSessionsManager.tsx"
  );
  const packageRoutes = read("workers/packages/routes.js");
  const packageD1 = read("workers/packages/d1.js");

  for (const [name, source] of [
    ["ClientPackageService", clientPackageService],
    ["ClientPackagesPanel", clientPackagesPanel],
    ["AdminPackageFlow", adminPackageFlow],
  ]) {
    assert.equal(
      source.includes("firebase/firestore"),
      false,
      `${name} must not import Firestore`
    );
  }

  assert.match(clientPackageService, /PackageOperationsService/);
  assert.match(clientPackagesPanel, /CoreBookingService/);
  assert.match(clientPackagesPanel, /CoreInvoiceService/);
  assert.match(adminPackageFlow, /resolveCoreBookingDataSource/);
  assert.match(adminPackageFlow, /CoreSettingsService/);

  assert.equal(
    packageOperations.includes("DEFAULT_PACKAGES_WORKER_URL"),
    false,
    "PackageOperationsService must not retain an old Worker fallback"
  );
  assert.equal(
    packageOperations.includes("getDataSourceFlags"),
    false,
    "PackageOperationsService must always require the unified Core Worker"
  );

  assert.match(
    bookingSource,
    /resolveBookingDataSource\(\): BookingDataSource \{\s*return resolveCoreBookingDataSource\(\);/
  );
  assert.equal(
    coreBookingSource.includes("PACKAGES_D1_REQUIRED"),
    false,
    "Core package booking must not depend on a legacy Packages flag"
  );

  assert.equal(
    offersFacade.includes("firebase/firestore"),
    false,
    "Offers compatibility facade must not import Firestore"
  );
  assert.equal(
    offersFacade.includes("getDataSourceFlags"),
    false,
    "Offers compatibility facade must always use Core D1"
  );
  assert.match(offersFacade, /CoreOfferService/);

  assert.equal(
    publicOffersPage.includes("firebase/firestore"),
    false,
    "Public offers page must not import Firestore"
  );
  assert.equal(
    publicOffersPage.includes("../services/firebase"),
    false,
    "Public offers page must not access Firebase data services"
  );
  assert.equal(
    publicOffersPage.includes("service_packages"),
    false,
    "Public offers page must not read the legacy package collection"
  );
  assert.match(publicOffersPage, /listOffers/);
  assert.match(publicOffersPage, /CoreCatalogService/);
  assert.match(publicOffersPage, /PackageService/);

  assert.equal(
    dashboardOffersPage.includes("firebase/firestore"),
    false,
    "Dashboard offers must not import Firestore"
  );
  assert.equal(
    dashboardOffersPage.includes("../services/firebase"),
    false,
    "Dashboard offers must not access Firebase data services"
  );
  assert.equal(
    dashboardOffersPage.includes("firestorePackages"),
    false,
    "Dashboard package management must not use the legacy package service"
  );
  assert.equal(
    dashboardOffersPage.includes("getDataSourceFlags"),
    false,
    "Dashboard offers must not retain a Core/Firestore branch"
  );
  assert.match(dashboardOffersPage, /PackageService/);
  assert.match(dashboardOffersPage, /CoreCatalogService/);

  assert.equal(
    dashboardClientsPage.includes("firebase/firestore"),
    false,
    "Dashboard clients must not import Firestore"
  );
  assert.equal(
    dashboardClientsPage.includes("../services/firebase"),
    false,
    "Dashboard clients must not access Firebase data services"
  );
  assert.equal(
    dashboardClientsPage.includes("getDataSourceFlags"),
    false,
    "Dashboard clients must not retain a Core/Firestore branch"
  );
  assert.equal(
    dashboardClientsPage.includes("listAllBookings"),
    false,
    "Dashboard clients must use the explicit Core booking reader"
  );
  assert.match(dashboardClientsPage, /listCoreBookings/);
  assert.match(dashboardClientsPage, /CoreClientService/);

  assert.equal(
    dashboardBookingsPage.includes("firebase/firestore"),
    false,
    "Dashboard bookings must not import Firestore"
  );
  assert.equal(
    dashboardBookingsPage.includes("getDataSourceFlags"),
    false,
    "Dashboard bookings must not retain a Core/Firestore branch"
  );
  assert.equal(
    dashboardBookingsPage.includes("../services/firestoreIncome"),
    false,
    "Dashboard bookings must not synchronize income through Firestore"
  );
  assert.equal(
    dashboardBookingsPage.includes("watchAllBookings"),
    false,
    "Dashboard bookings must poll the authoritative Core API directly"
  );
  assert.match(dashboardBookingsPage, /CoreBookingService\.list/);
  assert.match(dashboardBookingsPage, /coreD1BookingDataSource\.updateBooking/);
  assert.match(dashboardBookingsPage, /CoreClientService\.overview/);
  assert.match(dashboardBookingsPage, /CoreAuditService\.list/);
  assert.match(dashboardBookingsPage, /CoreRefundService/);

  assert.equal(
    dashboardReportsPage.includes("firebase/firestore"),
    false,
    "Dashboard reports must not import Firestore"
  );
  assert.equal(
    dashboardReportsPage.includes("../services/firebase"),
    false,
    "Dashboard reports must not access Firebase data services"
  );
  assert.equal(
    dashboardReportsPage.includes("AppSettingsService"),
    false,
    "Dashboard reports must read settings from Core D1 directly"
  );
  assert.equal(
    dashboardReportsPage.includes("FirestoreReadStats"),
    false,
    "Dashboard reports must not track Firestore reads"
  );
  assert.equal(
    dashboardReportsPage.includes("staff_public"),
    false,
    "Dashboard reports must not read legacy staff_public"
  );
  assert.match(dashboardReportsPage, /listCoreBookings\(\)/);
  assert.match(dashboardReportsPage, /listAllIncomeCore\(\)/);
  assert.match(dashboardReportsPage, /listAllExpensesCore\(\)/);
  assert.match(dashboardReportsPage, /CoreHrService\.listPayrollEntries\(\)/);
  assert.match(dashboardReportsPage, /generatePayrollEntriesForMonths/);
  assert.match(dashboardReportsPage, /projectCorePayrollEntriesToFinancialRows/);
  assert.doesNotMatch(dashboardReportsPage, /CoreHrService\.listEmployees\(\)/);
  assert.doesNotMatch(dashboardReportsPage, /CoreSettingsService/);
  assert.doesNotMatch(dashboardReportsPage, /normalizeCoreStaffPayrollRows/);

  assert.equal(
    publicBookingPage.includes("firebase/firestore"),
    false,
    "Public booking must not import Firestore"
  );
  assert.equal(
    publicBookingPage.includes("firebase/storage"),
    false,
    "Public booking must not import Firebase Storage"
  );
  assert.equal(
    publicBookingPage.includes("firestorePackages"),
    false,
    "Public booking must not use the legacy package catalog"
  );
  assert.equal(
    publicBookingPage.includes("getDataSourceFlags"),
    false,
    "Public booking must not retain a Core/Firestore branch"
  );
  assert.match(publicBookingPage, /CoreSettingsService/);
  assert.match(publicBookingPage, /ClientPortalService\.snapshot/);
  assert.match(publicBookingPage, /PackageService\.getActive/);
  assert.match(publicBookingPage, /uploadFileToR2/);
  assert.match(publicBookingPage, /listActiveSections\(SALON_ID, "core"\)/);

  for (const forbidden of [
    "firebase/firestore",
    "firebase/storage",
    "services/firebase",
    "bookingDataSourceCompat",
    "AppSettingsService",
    "firestoreOffers",
    "getDataSourceFlags",
  ]) {
    assert.equal(
      internalBookingV2.includes(forbidden),
      false,
      `Internal booking V2 must not depend on ${forbidden}`
    );
  }
  assert.match(internalBookingV2, /listCoreBookableStaffForDate/);
  assert.match(internalBookingV2, /getCoreStaffBookableStartSlots/);
  assert.match(internalBookingV2, /resolveCoreBookingDataSource\(\)\.getServiceSections\(\)/);
  assert.match(internalBookingV2, /resolveCoreBookingDataSource\(\)\.createBookingGroup/);
  assert.match(internalBookingV2, /CoreSettingsService\.get<InternalBookingAppSettings>\("app"\)/);
  assert.match(internalBookingV2, /CoreOfferService\.list/);
  assert.match(internalBookingV2, /firebase\/auth/);

  assert.match(packageSessionsManager, /إضافة جلسة لعميلة/);
  assert.match(packageSessionsManager, /CoreClientService\.create/);
  assert.match(packageSessionsManager, /grantClientSessions/);
  assert.match(packageSessionsManager, /PackageOperationsService\.adjust/);
  assert.match(packageSessionsManager, /تعديل جلسات الباقة/);
  assert.match(packageSessionsManager, /سبب التعديل/);
  assert.equal(
    packageSessionsManager.includes("window.prompt"),
    false,
    "Package session editing must use an in-app dialog instead of browser prompts"
  );
  assert.match(
    packageOperations,
    /\/api\/packages\/admin\/grant-sessions/
  );
  assert.match(
    packageRoutes,
    /POST \/api\/packages\/admin\/grant-sessions/
  );
  assert.match(packageD1, /grantClientSessionsAdminD1/);
  assert.match(packageD1, /'admin_grant'/);
});