import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);

  return source.slice(startIndex, endIndex);
}

test("dashboard private booking notes use canonical Core D1 authority", () => {
  const page = read("src/pages/DashboardBookings.tsx");
  const service = read("src/services/CoreBookingService.ts");
  const mapper = read("src/services/coreBookingMappers.ts");
  const dataSource = read(
    "src/services/bookingDataSources/coreD1BookingDataSource.ts"
  );
  const bookingTypes = read("src/services/firestoreBookings.ts");
  const coreTypes = read("src/types/coreApi.ts");

  assert.match(
    page,
    /CoreBookingService\.patch\(id,\s*\{\s*adminNotes:\s*text \|\| null,/s
  );

  assert.match(
    page,
    /const canonical = coreBookingToLegacy\([\s\S]*?CoreBookingService\.patch/
  );

  assert.match(page, /canonical\.adminNote/);
  assert.match(page, /selectedBooking\.adminNote/);
  assert.match(page, /b\.adminNote/);

  assert.doesNotMatch(page, /dashboard_booking_notes_v1/);
  assert.doesNotMatch(page, /\bnotesMap\b/);
  assert.doesNotMatch(page, /\bloadNotesMap\b/);
  assert.doesNotMatch(page, /\bsaveNotesMap\b/);
  assert.doesNotMatch(
    page,
    /updateCoreBookingFields\(id,\s*\{\s*note:\s*text\s*\}\)/
  );

  assert.match(page, /noteSaveInFlightRef/);
  assert.match(page, /disabled=\{savingNoteId === selectedBooking\.id\}/);

  assert.match(service, /adminNotes:\s*string \| null/);
  assert.match(coreTypes, /adminNotes\?:\s*string \| null/);
  assert.match(bookingTypes, /adminNote\?:\s*string/);

  assert.match(mapper, /admin_notes:\s*"adminNotes"/);
  assert.match(mapper, /adminNote:\s*booking\.adminNotes \|\| undefined/);

  assert.match(
    dataSource,
    /adminNotes:\s*patch\.adminNote === undefined \? undefined : patch\.adminNote \|\| null/
  );
});

test("booking admin notes persist in a dedicated Core D1 column", () => {
  const repo = read("workers/core/repositories/bookings.js");
  const migration = read("migrations/core/0061_booking_admin_notes.sql");

  assert.match(
    migration,
    /ALTER TABLE bookings ADD COLUMN admin_notes TEXT;/
  );

  assert.match(
    repo,
    /admin_notes:\s*data\.adminNotes === undefined && data\.admin_notes === undefined/
  );

  assert.match(
    repo,
    /notes = \?, admin_notes = \?, subtotal_halalas = \?/
  );

  assert.match(repo, /before\.admin_notes \|\| null/);
});

test("private booking admin notes never cross public or client portal boundaries", () => {
  const bookingsRepo = read("workers/core/repositories/bookings.js");
  const clientPortalRepo = read(
    "workers/core/repositories/client-portal.js"
  );

  const publicTrack = between(
    bookingsRepo,
    "export async function getPublicBookingTrack",
    "export async function getBooking"
  );

  assert.doesNotMatch(publicTrack, /\badmin_notes\b/);
  assert.doesNotMatch(publicTrack, /\badminNotes\b/);

  const clientBookings = between(
    clientPortalRepo,
    "export async function listSelfBookings",
    "async function insertLoyaltyMovement"
  );

  assert.match(
    clientBookings,
    /delete clientBooking\.admin_notes;/
  );

  assert.match(
    clientBookings,
    /delete clientBooking\.adminNotes;/
  );

  assert.match(
    clientBookings,
    /\.\.\.clientBooking,/
  );

  assert.doesNotMatch(
    clientBookings,
    /return \{\s*\.\.\.booking,/s
  );
});