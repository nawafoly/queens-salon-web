import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = readFileSync("migrations/core/0088_internal_booking_parties.sql", "utf8");
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
