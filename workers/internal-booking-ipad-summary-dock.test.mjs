import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(
  new URL("../src/styles/dashboard-v2/pages/booking-internal-ipad.css", import.meta.url),
  "utf8"
);

test("compact iPad party summary stays horizontal instead of growing over the workspace", () => {
  assert.match(css, /\.bk2-summary-party-groups\s*\{[\s\S]*display:\s*flex;/);
  assert.match(css, /\.bk2-summary-party-groups\s*\{[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.bk2-summary-party-group\s*\{[\s\S]*flex:\s*0\s+0\s+min\(300px,\s*78vw\)/);
  assert.match(css, /\.bk2-summary-party-group \.bk2-summary-services\s*\{[\s\S]*display:\s*flex;/);
  assert.match(css, /\.bk2-summary-party-group \.bk2-summary-services\s*\{[\s\S]*overflow-x:\s*auto;/);
});


const bookingTsx = fs.readFileSync(
  new URL("../src/features/internal-booking-v2/BookingInternalV2.tsx", import.meta.url),
  "utf8"
);

test("draft scheduling rechecks same-staff and same-client overlap against live state", () => {
  assert.match(
    bookingTsx,
    /getCartScheduleConflict = useCallback\(\([\s\S]*scheduleState: Record<string, ScheduleSelection> = scheduleByService/
  );
  assert.match(bookingTsx, /const selected = scheduleState\[otherKey\]/);
  assert.match(bookingTsx, /bookingLineClientKey\(other\) === currentClientKey/);
  assert.match(bookingTsx, /if \(selected\.staffId === staffKey\)/);
  assert.match(
    bookingTsx,
    /setScheduleByService\(\(current\) => \{[\s\S]*getCartScheduleConflict\(key, liveStaffId, time, current\)[\s\S]*return current;/
  );
  assert.match(
    bookingTsx,
    /const liveDraftConflict = cart\.find[\s\S]*getCartScheduleConflict\(key, selected\.staffId, selected\.time, scheduleByService\)/
  );
});
