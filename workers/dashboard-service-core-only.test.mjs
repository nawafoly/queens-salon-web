import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("dashboard service has no Firestore operational runtime", () => {
  const source = read("src/helpers/dashboardService.ts");

  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /services\/firebase/);
  assert.doesNotMatch(
    source,
    /\b(collection|doc|getDocs|getDoc|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|onSnapshot)\s*\(/
  );
});

test("legacy dashboard Firestore methods stay removed", () => {
  const source = read("src/helpers/dashboardService.ts");

  for (const method of [
    "getBookings",
    "getLatestBookings",
    "getStats",
    "updateBookingStatus",
    "getTodayBookingsCount",
    "finalizeClosedDate",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${method}\\s*\\(`),
      `${method} must not return to dashboardService`
    );
  }
});

test("dashboard service retains only the required compatibility surface", () => {
  const source = read("src/helpers/dashboardService.ts");

  assert.match(source, /export type BookingStatus/);
  assert.match(source, /export type Booking/);
  assert.match(source, /migrateBookingsIfNeeded\s*\(\)/);
});
