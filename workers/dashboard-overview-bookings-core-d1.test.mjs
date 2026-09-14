import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/pages/Dashboard.tsx", "utf8");

test("Dashboard overview loads operational bookings from Core D1 only", () => {
  assert.match(page, /from "\.\.\/services\/CoreBookingService"/);
  assert.match(page, /from "\.\.\/services\/coreBookingMappers"/);
  assert.match(page, /CoreBookingService\.list\(\)/);
  assert.match(page, /coreBookingToLegacy/);
  assert.match(page, /bookings:CoreBookingService\.list/);

  assert.doesNotMatch(page, /listAllBookings\s+as\s+listAllBookingsFS/);
  assert.doesNotMatch(page, /listAllBookingsFS\s*\(/);
  assert.doesNotMatch(page, /listAllBookings\s*\(/);
  assert.doesNotMatch(page, /watchAllBookings/);
  assert.doesNotMatch(page, /getDataSourceFlags/);
  assert.doesNotMatch(page, /firebase\/firestore/);
});

test("Dashboard maps Core legacy bookings into existing UI booking shape", () => {
  const refreshStart = page.indexOf('step = "bookings:CoreBookingService.list"');
  const mapStart = page.indexOf("async function mapFirestoreToUiBooking");
  assert.ok(refreshStart >= 0, "refresh step must call Core list");
  assert.ok(mapStart >= 0, "legacy UI mapper must remain");

  const refreshSlice = page.slice(refreshStart, refreshStart + 500);
  assert.match(refreshSlice, /\(await CoreBookingService\.list\(\)\)\.map\(coreBookingToLegacy\)/);
  assert.match(page, /docs\.map\(mapFirestoreToUiBooking\)/);
});
