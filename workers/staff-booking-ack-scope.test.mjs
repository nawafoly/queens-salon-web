import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrations/core/0063_booking_staff_acknowledgement.sql", "utf8");
const repo = readFileSync("workers/core/repositories/booking-staff-portal.js", "utf8");

test("staff acknowledgement is employee scoped and whole-booking status requires exclusive assignment", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS booking_staff_acknowledgements/);
  assert.match(migration, /PRIMARY KEY \(salon_id, booking_id, employee_id\)/);
  assert.doesNotMatch(migration, /ALTER TABLE bookings ADD COLUMN staff_ack/);

  assert.match(repo, /INSERT OR IGNORE INTO booking_staff_acknowledgements/);
  assert.match(repo, /employee_id = \?/);
  assert.match(repo, /assertExclusiveStatusControl/);
  assert.match(repo, /staff_status_requires_exclusive_assignment/);
  assert.match(repo, /hasForeignAssignedItem/);
});
