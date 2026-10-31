import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync('src/features/bookings/BookingItemStaffAttributionEditor.tsx','utf8');
const page = readFileSync('src/pages/DashboardBookings.tsx','utf8');
const service = readFileSync('src/services/CoreBookingService.ts','utf8');
const core = readFileSync('workers/core/repositories/booking-item-attribution.js','utf8');
const api = readFileSync('workers/core/index.js','utf8');
const booking = readFileSync('workers/core/repositories/bookings.js','utf8');
const offboarding = readFileSync('workers/core/repositories/employee-offboarding.js','utf8');
const styles = readFileSync('src/styles/dashboard-v2/pages/bookings.css','utf8');
const bookingClient = readFileSync('src/services/CoreBookingService.ts','utf8');

test('booking editor displays all Core service items with explicit staff and item id', () => {
  assert.match(page, /BookingItemStaffAttributionEditor/);
  assert.match(ui, /CoreBookingService.get\(bookingId\)/);
  assert.match(ui, /booking\?\.items/);
  assert.match(ui, /item\.serviceNameSnapshot/);
  assert.match(ui, /item\.staffId/);
  assert.match(booking, /st\.name AS staff_name/);
});

test('historical correction is an explicit item-only action with reason and CAS', () => {
  assert.match(service, /correctCompletedItemStaff/);
  assert.match(ui, /expectedStaffId: item.staffId/);
  assert.match(ui, /reason: reason.trim/);
  assert.match(core, /COALESCE\(staff_id, ''\) = \?/);
  assert.match(core, /auditInsertWhenPreviousUpdateChanged/);
  assert.doesNotMatch(core, /UPDATE (?:payments|income_entries|invoices|refunds)/i);
});

test('Core restricts correction to authenticated admin, booking and HR permission', () => {
  assert.match(api, /case "booking:item-staff-correction"/);
  assert.match(api, /ctx.role !== "owner" && ctx.role !== "admin"/);
  assert.match(api, /requirePermission\(ctx, "bookings.update"\)/);
  assert.match(api, /requirePermission\(ctx, "employees.manage"\)/);
});

test('offboarding conflict explains exactly which booked service remains assigned', () => {
  assert.match(offboarding, /bi\.id AS booking_item_id/);
  assert.match(offboarding, /bi\.service_name_snapshot AS service_name/);
  assert.match(offboarding, /conflicts: rows\.map/);
  assert.match(offboarding, /bookingIds: \[\.\.\.new Set/);
});

test('historical staff picker uses Core eligibility, V2 search UI, and no native popup', () => {
  assert.match(service, /listItemStaffCorrectionCandidates/);
  assert.match(bookingClient, /staff-correction\/candidates/);
  assert.match(ui, /DashboardSelectV2/);
  // Booking dialogs are portalled outside the Dashboard V2 shell. Without
  // this ancestor the shared select CSS is skipped and the chevron expands.
  assert.match(ui, /<div className="dashboard-v2 bk-attribution__picker-scope">\s*<DashboardSelectV2/);
  assert.match(ui, /type="search"/);
  assert.doesNotMatch(ui, /<select\b|<option\b/);
  assert.doesNotMatch(ui, /\/api\/core\/staff/);
  assert.match(api, /case "booking:item-staff-candidates"/);
  assert.match(core, /listBookingItemStaffCorrectionCandidates/);
  assert.match(core, /employee_employment e/);
  assert.match(core, /requiredId\(id, 'staffId'\) !== id/);
});

test('booking edit modal is wider and service cards use the Dashboard V2 surface tokens', () => {
  assert.match(styles, /\.bookings-v2-modal-panel\.bk-edit-modal\.qs-modal-panel--lg\s*\{[\s\S]*?1220px/);
  assert.match(styles, /\.bk-attribution__item\s*\{[\s\S]*?var\(--dsv2-border\)/);
  assert.match(styles, /\.bk-attribution__fields\s*\{[\s\S]*?grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.bk-attribution__item,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});
