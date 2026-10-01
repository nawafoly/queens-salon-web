import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = readFileSync("migrations/core/0088_internal_booking_parties.sql", "utf8");
const guestMigration = readFileSync("migrations/core/0090_internal_booking_guest_companions.sql", "utf8");
const draftMigration = readFileSync("migrations/core/0091_internal_booking_drafts.sql", "utf8");
const draftRepo = readFileSync("workers/core/repositories/internal-booking-drafts.js", "utf8");
const cashbackRepo = readFileSync("workers/core/repositories/cashback.js", "utf8");
const repo = readFileSync("workers/core/repositories/bookings.js", "utf8");
const mapper = readFileSync("src/services/coreBookingMappers.ts", "utf8");
const source = readFileSync("src/services/bookingDataSources/coreD1BookingDataSource.ts", "utf8");
const types = readFileSync("src/types/coreApi.ts", "utf8");

test("party metadata groups canonical bookings without moving client ownership to items", () => {
  assert.match(migration, /ALTER TABLE bookings ADD COLUMN party_id TEXT/);
  assert.match(migration, /party_lead_client_id/);
  assert.match(migration, /party_member_order/);
  assert.match(migration, /party_size/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_core_bookings_party_member_order_unique/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_core_bookings_party_client_unique/);
  assert.doesNotMatch(migration, /ALTER TABLE booking_items ADD COLUMN client_id/);
});

test("Core booking creation persists party metadata and validates the lead client", () => {
  assert.match(repo, /core_booking:party_lead_client_required/);
  assert.match(repo, /party_member_order_invalid/);
  assert.match(repo, /core_booking:party_member_order_conflict/);
  assert.match(repo, /core_booking:party_client_duplicate/);
  assert.match(repo, /core_booking:party_lead_mismatch/);
  assert.match(repo, /party_id, party_lead_client_id, party_member_order, party_size/);
  assert.match(repo, /query\.partyId \|\| query\.party_id/);
});

test("frontend/core contracts carry party metadata through the canonical booking path", () => {
  for (const field of ["partyId", "partyLeadClientId", "partyMemberOrder", "partySize"]) {
    assert.ok(types.includes(field), `missing type field ${field}`);
    assert.ok(mapper.includes(field), `missing mapper field ${field}`);
    assert.ok(source.includes(field), `missing data-source field ${field}`);
  }
});


test("booking-only party guests are persisted outside the canonical clients table", () => {
  assert.match(guestMigration, /CREATE TABLE IF NOT EXISTS booking_party_guests/);
  assert.match(guestMigration, /booking_id TEXT NOT NULL/);
  assert.doesNotMatch(guestMigration, /INSERT INTO clients/);
  assert.match(repo, /normalizeBookingGuestParticipant/);
  assert.match(repo, /core_booking:guest_participant_invalid/);
  assert.match(repo, /INSERT INTO booking_party_guests/);
  assert.match(repo, /guest\?\.name \|\| client\?\.name/);
  assert.match(repo, /booking_guest:\s*Boolean\(guest\)/);
  assert.match(source, /readBookingGuestParticipant/);
  assert.match(source, /guestParticipant,/);
  assert.match(types, /guestParticipant\?:\s*\{/);
});

test("booking-only guests cannot use client packages or earn client cashback", () => {
  assert.match(repo, /core_booking:guest_package_not_allowed/);
  assert.match(cashbackRepo, /SELECT id FROM booking_party_guests WHERE salon_id = \? AND booking_id = \? LIMIT 1/);
  assert.match(cashbackRepo, /skipped:\s*'booking_guest'/);
});


test("internal party rollback uses create authority and not cancel permission", () => {
  const index = readFileSync("workers/core/index.js", "utf8");
  const service = readFileSync("src/services/CoreBookingService.ts", "utf8");
  assert.match(index, /bookings:internal-rollback/);
  assert.match(index, /case "bookings:internal-rollback":[\s\S]*requirePermission\(ctx, "bookings\.create"\)/);
  assert.match(index, /rollbackInternalBookingCreation/);
  assert.match(repo, /core_booking:internal_rollback_forbidden/);
  assert.match(repo, /core_booking:internal_rollback_window_expired/);
  assert.match(repo, /core_booking:internal_rollback_payment_exists/);
  assert.match(service, /rollbackInternalCreation/);
});


test("internal booking drafts stay outside operational booking state", () => {
  const index = readFileSync("workers/core/index.js", "utf8");
  assert.match(draftMigration, /CREATE TABLE IF NOT EXISTS internal_booking_drafts/);
  assert.match(draftMigration, /draft_json TEXT NOT NULL/);
  assert.doesNotMatch(draftMigration, /booking_slot_locks|invoices|payments/);
  assert.match(draftRepo, /created_by_uid/);
  assert.match(draftRepo, /listInternalBookingDrafts/);
  assert.match(draftRepo, /saveInternalBookingDraft/);
  assert.match(index, /internal-booking-drafts/);
  assert.match(index, /requirePermission\(ctx, "bookings\.create"\)/);
});
