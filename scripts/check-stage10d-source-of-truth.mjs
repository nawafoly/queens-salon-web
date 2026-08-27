#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const read = (file) => {
  if (!existsSync(file)) throw new Error(`stage10d:missing_file:${file}`);
  return readFileSync(file, "utf8");
};
const failures = [];
const requirePatterns = (file, patterns) => {
  const source = read(file);
  for (const pattern of patterns) if (!pattern.test(source)) failures.push(`${file}: missing ${pattern}`);
};
const forbidPatterns = (file, patterns) => {
  const source = read(file);
  for (const pattern of patterns) if (pattern.test(source)) failures.push(`${file}: forbidden ${pattern}`);
};
const block = (file, startPattern, endPattern) => {
  const source = read(file);
  const start = source.search(startPattern);
  if (start < 0) throw new Error(`stage10d:block_start_missing:${file}:${startPattern}`);
  const tail = source.slice(start);
  const endMatch = tail.slice(1).search(endPattern);
  return endMatch < 0 ? tail : tail.slice(0, endMatch + 1);
};

// Employee master: Core accounts + HR + staff + catalog only.
requirePatterns("src/pages/DashboardEmployees.tsx", [
  /CoreAccountService\.list/,
  /CoreHrService\.listEmployees/,
  /CoreStaffService\.list/,
  /CoreCatalogService\.listServices/,
  /bookingStaff/,
]);
forbidPatterns("src/pages/DashboardEmployees.tsx", [
  /firebase\/firestore/,
  /\bsetDoc\s*\(/,
  /\bgetDoc(?:s|FromServer)?\s*\(/,
  /\bwriteBatch\s*\(/,
  /collection\(db/,
]);

// HR save and booking staff row must be one D1 batch-owned operation.
requirePatterns("workers/core/repositories/hr-employees.js", [
  /INSERT INTO staff\s*\(/,
  /bookingStaffInput/,
  /await dbBatch\(/,
]);

// Attendance settings/work zones: no Firestore operational source.
requirePatterns("src/pages/settings/SettingsAttendance.tsx", [/attendanceSettingsService/]);
requirePatterns("src/services/attendanceSettingsService.ts", [/CoreAttendanceWorkZoneService/]);
forbidPatterns("src/pages/settings/SettingsAttendance.tsx", [
  /firebase\/firestore/,
  /collection\(db/,
  /\bgetDocs\s*\(/,
  /\bsetDoc\s*\(/,
]);
requirePatterns("src/pages/DashboardAttendanceSecurity.tsx", [/CoreStaffService\.list/]);
forbidPatterns("src/pages/DashboardAttendanceSecurity.tsx", [/listActiveStaffAll/, /firestoreStaffPublic/]);

// App settings are Core-only and fail closed.
requirePatterns("src/services/AppSettingsService.ts", [/CoreSettingsService\.get/, /CoreSettingsService\.save/]);
forbidPatterns("src/services/AppSettingsService.ts", [/firebase\/firestore/, /getDataSourceFlags/, /useSettingsD1/, /useCoreD1/]);

// Active booking facade exports are Core-only. Historical backfill functions may remain below them.
const bookingFacade = read("src/services/firestoreBookings.ts");
for (const name of [
  "getBookingById", "markBookingViewed", "listAllBookings", "listBookings", "watchAllBookings",
  "listUserBookings", "listEmployeeBookings", "watchEmployeeBookings", "updateBookingDetails",
  "getTrackById", "getTrackByPublicId", "deleteBooking",
]) {
  const match = new RegExp(`export (?:async )?function ${name}\\b`);
  if (!match.test(bookingFacade)) failures.push(`src/services/firestoreBookings.ts: active export missing ${name}`);
}
requirePatterns("src/services/firestoreBookings.ts", [/CoreBookingService\.trackPublic/, /CoreBookingService\.remove/, /CoreAuditService\.record/]);

// Success/Track booking state must come from Core. Track may still read public contact settings.
requirePatterns("src/pages/Success.tsx", [/CoreBookingService\.trackPublic/, /ClientPortalService\.snapshot/]);
forbidPatterns("src/pages/Success.tsx", [/firebase\/firestore/, /collection\(db/, /\bgetDocs\s*\(/, /\bgetDoc\s*\(/, /getBookingById/, /getTrackById/]);
requirePatterns("src/pages/Track.tsx", [/getTrackByPublicId/]);

// Checkout must never mutate legacy Firestore offer/package usage after a Core booking.
// Package/session state is owned by Core package_catalog/client_packages/package_transactions.
forbidPatterns("src/pages/Checkout.tsx", [
  /firestorePackages/,
  /incrementPackageUsage\s*\(/,
]);

// Active booking/settings/audit facades cannot switch source-of-truth by feature flag.
forbidPatterns("src/services/firestoreBookings.ts", [/getDataSourceFlags/, /useCoreD1/, /useBookingsD1/]);

// Public tracking is code-scoped and sanitized: no client PII or finance totals returned.
const publicTrackBlock = block("workers/core/repositories/bookings.js", /export async function getPublicBookingTrack/, /export async function getBooking/);
for (const pattern of [/client_name\s*:/, /client_phone\s*:/, /email\s*:/, /total_halalas\s*:/, /paid_halalas\s*:/]) {
  if (pattern.test(publicTrackBlock)) failures.push(`workers/core/repositories/bookings.js public-track: forbidden ${pattern}`);
}
for (const pattern of [/public_id:/, /service_name_snapshot:/, /staff_name:/, /section_name:/, /category_name:/]) {
  if (!pattern.test(publicTrackBlock)) failures.push(`workers/core/repositories/bookings.js public-track: missing ${pattern}`);
}
requirePatterns("workers/core/index.js", [
  /\/api\/core\/public\/booking-track/,
  /\["audit\.read", "logs\.view"\]/,
]);

// Dashboard operational summaries/logs are Core-owned.
requirePatterns("src/pages/Dashboard.tsx", [/CoreStaffService/, /CoreAuditService/]);
requirePatterns("src/pages/DashboardDayAudit.tsx", [/CoreBookingService/, /CoreIncomeService/]);
requirePatterns("src/pages/DashboardLogs.tsx", [/CoreAuditService/]);
for (const file of ["src/pages/DashboardDayAudit.tsx", "src/pages/DashboardLogs.tsx"]) {
  forbidPatterns(file, [/firebase\/firestore/, /collection\(db/, /\bgetDocs\s*\(/, /onSnapshot\s*\(/]);
}

// Internal accounts/profile: Firebase identity is allowed, operational status/profile is Core.
requirePatterns("src/pages/DashboardPending.tsx", [/CoreAccountService\.me/]);
requirePatterns("src/pages/DashboardAdminProfile.tsx", [/CoreAccountService\.me/, /CoreAccountService\.update/]);
forbidPatterns("src/pages/DashboardPending.tsx", [/firebase\/firestore/, /\bgetDoc\s*\(/]);
forbidPatterns("src/pages/DashboardAdminProfile.tsx", [/firebase\/firestore/, /\bsetDoc\s*\(/, /\bgetDoc\s*\(/]);

// Partner -> HR sync must be Core-owned even though Firebase creates the identity.
const employeeHubCoreSync = block("src/services/employeeHub.ts", /async function ensureCoreEmployeeAccount/, /export async function listEmployeeMessages/);
for (const pattern of [/\bgetDoc\s*\(/, /\bgetDocs\s*\(/, /\bsetDoc\s*\(/, /\bupdateDoc\s*\(/, /serverTimestamp\s*\(/, /hrDoc\s*\(/]) {
  if (pattern.test(employeeHubCoreSync)) failures.push(`src/services/employeeHub.ts active Core sync: forbidden ${pattern}`);
}
for (const pattern of [/CoreHrService\.saveEmployee/, /CoreAccountService\.linkEmployee/]) {
  if (!pattern.test(employeeHubCoreSync)) failures.push(`src/services/employeeHub.ts active Core sync: missing ${pattern}`);
}

// Audit facade is Core-only.
requirePatterns("src/services/logService.ts", [/CoreAuditService\.record/]);
forbidPatterns("src/services/logService.ts", [/firebase\/firestore/, /getDataSourceFlags/, /collection\(db/, /addDoc\s*\(/]);

// Payroll/GOSI: browser sends mutable inputs only; all financial authority is in Core.
requirePatterns("src/services/CorePayrollService.ts", [
  /Only mutable\/manual payroll inputs cross the browser -> Core boundary/,
  /CoreHrService\.previewPayrollEntry/,
]);
forbidPatterns("src/services/CorePayrollService.ts", [/calculateGosi\s*\(/, /calculatePayrollSnapshot\s*\(/, /export async function togglePayrollOvertime/]);
const payloadBlock = block("src/services/CorePayrollService.ts", /export function payrollEntryPayload/, /export async function previewPayrollEntrySnapshot/);
for (const pattern of [
  /baseSalaryHalalas\s*:/, /attendanceSummary\s*:/, /gosiSnapshot\s*:/, /grossSalaryHalalas\s*:/,
  /netSalaryHalalas\s*:/, /finalSalaryHalalas\s*:/, /overtimeValueHalalas\s*:/,
]) if (pattern.test(payloadBlock)) failures.push(`CorePayrollService payrollEntryPayload: forbidden ${pattern}`);

requirePatterns("workers/core/repositories/payroll.js", [
  /async function canonicalEmployment/,
  /function canonicalGosiFromEmployment/,
  /async function buildCanonicalAttendanceSummary/,
  /async function buildCanonicalPayrollAuthority/,
  /canonical_recalculation_before_approval/,
  /core_payroll:overtime_policy_managed_on_employment/,
]);
const approveBlock = block("workers/core/repositories/payroll.js", /export async function approvePayrollEntry/, /export async function markPayrollEntryPaid/);
if (!/upsertPayrollEntry\(/.test(approveBlock)) failures.push("payroll approval: canonical recalculation missing");

// Canonical schema gaps discovered by Stage 10D are source-only until Stage 10E.
requirePatterns("migrations/core/0032_service_season_price.sql", [/season_price_halalas/]);
requirePatterns("migrations/core/0033_app_user_profile_photo.sql", [/photo_url/]);
requirePatterns("src/pages/settings/SettingsCatalogV2.tsx", [/CoreCatalogService/]);
forbidPatterns("src/pages/settings/SettingsCatalogV2.tsx", [/firebase\/firestore/, /collection\(db/, /setDoc\s*\(/]);

if (failures.length) {
  console.error("STAGE 10D SOURCE-OF-TRUTH GUARD FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("STAGE 10D SOURCE-OF-TRUTH GUARD PASS");
console.log("- HR employee master and partner sync are Core-owned");
console.log("- attendance work zones and app settings are Core-owned");
console.log("- booking runtime, public tracking and Checkout package usage are Core-owned and sanitized");
console.log("- dashboard/audit/internal-account operational paths are Core-owned");
console.log("- browser payroll payload contains no salary/attendance/GOSI/net authority");
console.log("- Core recalculates attendance, payroll and GOSI before approval");
console.log("- migrations 0031/0032/0033 remain source-only pending Stage 10E remote readiness");
