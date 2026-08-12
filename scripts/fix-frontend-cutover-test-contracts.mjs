import fs from 'node:fs';

const file = 'workers/frontend-core-migration.test.mjs';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

function replaceTest(name, replacement) {
  const doubleNeedle = `test("${name}"`;
  const singleNeedle = `test('${name}'`;
  const starts = [text.indexOf(doubleNeedle), text.indexOf(singleNeedle)].filter((index) => index >= 0);
  if (starts.length !== 1) {
    throw new Error(`[frontend-cutover-tests] expected one test named ${name}, found ${starts.length}`);
  }
  const start = starts[0];
  const next = text.indexOf('\ntest(', start + 1);
  const end = next >= 0 ? next + 1 : text.length;
  text = text.slice(0, start) + replacement.trimEnd() + '\n\n' + text.slice(end);
}

replaceTest('booking pages use one Core availability engine', `test("booking pages use one Core availability engine", () => {
  for (const file of [
    "src/pages/Booking.tsx",
    "src/features/internal-booking-v2/BookingInternalV2.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getStaffAvailability|listCoreBookableStaffForDate/);
    assert.doesNotMatch(source, /collection\\([^\\n]*["']booking_slots["']/);
    assert.doesNotMatch(source, /doc\\([^\\n]*["']availability_days["']/);
  }

  const legacyEntry = readFileSync("src/pages/BookingInternal.tsx", "utf8");
  assert.match(legacyEntry, /BookingInternalV2/);
  assert.doesNotMatch(legacyEntry, /\\bgetStaffAvailability\\s*\\(/);
  assert.doesNotMatch(legacyEntry, /from\\s+["'][^"']*(staffAvailability|firestoreAvailabilityBackfill)/);
});`);

replaceTest('backdated dates are exposed only by internal booking V2 and require confirmation', `test("backdated dates are exposed only by internal booking V2 and require confirmation", () => {
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const publicBooking = readFileSync("src/pages/Booking.tsx", "utf8");
  const coreService = readFileSync("src/services/CoreBookingService.ts", "utf8");
  const coreDataSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");

  assert.match(v2, /DashboardDatePickerV2[\\s\\S]{0,220}value=\\{bookingDate\\}/);
  assert.match(v2, /isPastBookingDate/);
  assert.match(v2, /أنت تقوم بإنشاء حجز بتاريخ سابق/);
  assert.match(v2, /تأكيد وإنشاء الحجز/);
  assert.match(v2, /submittingRef\\.current/);
  assert.match(publicBooking, /id="bookingDate"[\\s\\S]{0,220}min=\\{todayISO\\(\\)\\}/);
  assert.match(publicBooking, /const isPast = cell\\.iso < todayISO\\(\\)/);
  assert.match(coreService, /\\/api\\/core\\/internal\\/bookings/);
  assert.match(coreDataSource, /CoreBookingService\\.createInternal/);
});`);

replaceTest('Core refunds are exposed as negative revenue and excluded from expenses', `test("Core refunds are exposed as negative revenue and excluded from expenses", () => {
  const income = readFileSync("src/services/firestoreIncome.ts", "utf8");
  const expenses = readFileSync("src/services/firestoreExpenses.ts", "utf8");
  const refundsRepo = readFileSync("workers/core/repositories/refunds.js", "utf8");
  const financeRepo = readFileSync("workers/core/repositories/finance.js", "utf8");
  const cleanupMigration = readFileSync("migrations/core/0009_remove_refund_expense_shadows.sql", "utf8");

  assert.match(income, /CoreRefundService\\.list\\(\\)/);
  assert.match(income, /amount:\\s*-Math\\.abs/);
  assert.match(income, /source:\\s*"refund"/);
  assert.match(expenses, /filter\\(\\(expense\\) => !isRefundExpense\\(expense\\)\\)/);
  assert.doesNotMatch(refundsRepo, /INSERT INTO expense_entries/);
  assert.match(financeRepo, /COALESCE\\(source_kind/);
  assert.match(cleanupMigration, /DELETE FROM expense_entries/i);
});`);

replaceTest('internal booking V2 is direct Core-only and cannot read Firestore operational data', `test("internal booking V2 is direct Core-only and cannot read Firestore operational data", () => {
  const v2 = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const availabilityHelper = readFileSync("src/helpers/coreBookingAvailability.ts", "utf8");
  const envWeb = readFileSync(".env.web", "utf8");
  assert.match(v2, /resolveCoreBookingDataSource\\(\\)\\.createBookingGroup\\(\\{ parent, items: itemRows \\}\\)/);
  assert.match(v2, /listCoreBookableStaffForDate/);
  assert.match(v2, /getCoreStaffBookableStartSlots/);
  assert.match(v2, /CoreOfferService\\.list\\(\\{ active: true/);
  assert.match(v2, /CoreSettingsService\\.get<InternalBookingAppSettings>\\("app"\\)/);
  assert.match(v2, /forceFresh:\\s*true/);
  assert.match(v2, /resolveCoreBookingDataSource\\(\\)\\.updateBooking/);
  assert.match(availabilityHelper, /startTime \\+ serviceDuration \\+ buffer/i);
  assert.doesNotMatch(v2, /filterStaffSlotsByWorkingHours|isStaffAvailableForDate|isStaffWorkingAtTime|resolveStaffWorkingWindowsForDate/);
  assert.doesNotMatch(v2, /getDataSourceFlags|bookingDataSourceCompat|AppSettingsService|firestoreOffers/);
  assert.doesNotMatch(v2, /firebase\\/firestore|firebase\\/storage|services\\/firebase/);
  assert.match(v2, /firebase\\/auth/);
  assert.match(envWeb, /VITE_CORE_WORKER_URL=https:\\/\\/queens-salon-core-api\\.maedin\\.workers\\.dev/);
});`);

replaceTest('dashboard exposes standalone attendance device security center in the V2 visual language', `test("dashboard exposes standalone attendance device security center in the V2 visual language", () => {
  const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");
  const mobileNav = readFileSync("src/components/DashboardMobileNav.tsx", "utf8");
  const page = readFileSync("src/pages/DashboardAttendanceSecurity.tsx", "utf8");
  const service = readFileSync("src/services/attendanceWorkerService.ts", "utf8");
  const worker = readFileSync("workers/attendance-worker.js", "utf8");
  const migration = readFileSync("workers/attendance-migrations/0005_create_attendance_device_security.sql", "utf8");

  assert.match(dashboard, /path="attendance"/);
  assert.match(dashboard, /سجل البصمة والأجهزة/);
  assert.match(mobileNav, /\\/dashboard\\/attendance/);
  assert.match(page, /Attendance D1/);
  assert.match(page, /سجل البصمات/);
  assert.match(page, /الأجهزة/);
  assert.match(page, /التنبيهات/);
  assert.match(page, /updateAttendanceDeviceStatus/);
  assert.match(service, /\\/attendance\\/admin\\/dashboard/);
  assert.match(worker, /attendance_security_events/);
  assert.match(worker, /blocked_device_attempt/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_devices/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_device_assignments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_security_events/);
  assert.doesNotMatch(page, /firebase\\/firestore/);
});`);

replaceTest('administrative bookings attach to the selected canonical client and repair legacy duplicate links', `test("administrative bookings attach to the selected canonical client and repair legacy duplicate links", () => {
  const internalBooking = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
  const bookingSource = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");
  const portalRepo = readFileSync("workers/core/repositories/client-portal.js", "utf8");

  assert.match(internalBooking, /let canonicalClientId = ""/);
  assert.match(internalBooking, /clientId:\\s*canonicalClientId/);
  assert.match(internalBooking, /userId:\\s*null/);
  assert.match(internalBooking, /createdByUid:\\s*userId/);
  assert.match(bookingSource, /const explicitClientId = String\\(booking\\.clientId/);
  assert.match(bookingSource, /CoreClientService\\.get\\(explicitClientId\\)/);
  assert.match(portalRepo, /UPDATE bookings SET client_id = \\?/);
  assert.match(portalRepo, /UPDATE invoices SET client_id = \\?/);
  assert.match(portalRepo, /UPDATE payments SET client_id = \\?/);
  assert.match(portalRepo, /UPDATE refunds SET client_id = \\?/);
  assert.match(portalRepo, /legacy_client_id/);
});`);

replaceTest('front-end operational identity comes from Core app_users and permissions', `test("front-end operational identity comes from Core app_users and permissions", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const permissionContext = readFileSync("src/security/PermissionContext.tsx", "utf8");
  const settingsUsers = readFileSync("src/pages/settings/SettingsUsers.tsx", "utf8");
  const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");
  const dashboardSettings = readFileSync("src/pages/DashboardSettings.tsx", "utf8");
  const authAccess = readFileSync("src/services/authAccess.ts", "utf8");
  const coreAccountService = readFileSync("src/services/CoreAccountService.ts", "utf8");

  assert.match(coreAccountService, /\\/api\\/auth\\/me/);
  assert.match(coreAccountService, /\\/api\\/admin\\/accounts/);
  assert.match(app, /CoreAccountService\\.me/);
  assert.match(app, /permissions:\\s*me\\.permissions/);
  assert.match(app, /getEffectiveAppPermissions\\(permissionSource\\)/);
  assert.doesNotMatch(app, /firebase\\/firestore|getDoc\\(|onSnapshot\\(doc\\(db/);
  assert.match(permissionContext, /normalizeAppPermissions\\(permissions\\)/);
  assert.doesNotMatch(permissionContext, /getEffectiveAppPermissions/);
  assert.match(settingsUsers, /CoreAccountService/);
  assert.match(settingsUsers, /CoreAccountService\\.linkEmployee/);
  assert.doesNotMatch(settingsUsers, /firebase\\/firestore|collection\\(db|doc\\(db|getDocs\\(|setDoc\\(|deleteDoc\\(/);
  assert.match(dashboard, /readVerifiedUserAccess/);
  assert.doesNotMatch(dashboard, /createOrLoadUserProfile/);
  assert.match(dashboardSettings, /normalizeAuthRole/);
  assert.doesNotMatch(dashboardSettings, /firebase\\/firestore|onAuthStateChanged|doc\\(db|getDoc\\(/);
  assert.match(authAccess, /CoreAccountService\\.me/);
  assert.doesNotMatch(authAccess, /firebase\\/firestore|FirestoreRestClient|batchGet|runQuery/);
});`);

replaceTest('public booking staff loading is Core-only and cannot keep a stale spinner', `test("public booking staff loading is Core-only and cannot keep a stale spinner", () => {
  const source = readFileSync("src/pages/Booking.tsx", "utf8");
  assert.match(source, /listStaffForService/);
  assert.match(source, /getStaffAvailability/);
  assert.match(source, /staffRequestVersionRef/);
  assert.match(source, /Always finish the newest request/);
  assert.doesNotMatch(source, /finally\\s*\\{\\s*if \\(!cancelled\\)\\s*\\{\\s*setStaffLoadingByService/);
  assert.match(source, /setStaffDisplayById\\(next\\)/);
  assert.doesNotMatch(source, /staff_public|firebase\\/firestore/);
});`);

fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[frontend-cutover-tests] current architecture contracts installed');
