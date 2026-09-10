import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const track = readFileSync("src/pages/Track.tsx", "utf8");
const bookingService = readFileSync("src/services/CoreBookingService.ts", "utf8");
const core = readFileSync("workers/core/index.js", "utf8");

test("public tracking page reads booking and public settings from Core", () => {
  assert.match(track, /CoreBookingService\.trackPublic\(normalizedParam\)/);
  assert.match(track, /coreApiRequest<CorePublicSettingRow>\("\/api\/core\/settings\/public"\)/);

  assert.doesNotMatch(track, /firestoreBookings/);
  assert.doesNotMatch(track, /firebase\/firestore/);
  assert.doesNotMatch(track, /services\/firebase/);
  assert.doesNotMatch(track, /onSnapshot\(/);
  assert.doesNotMatch(track, /getTrackByPublicId/);
});

test("Core booking service exposes canonical public tracking route", () => {
  assert.match(bookingService, /async trackPublic\(publicId: string\)/);
  assert.match(bookingService, /"\/api\/core\/public\/booking-track"/);
  assert.match(core, /path === "\/api\/core\/public\/booking-track"/);
  assert.match(core, /case "booking:public-track":/);
});
