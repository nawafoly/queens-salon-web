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


const bookingCss = fs.readFileSync(
  new URL("../src/styles/dashboard-v2/pages/booking-internal.css", import.meta.url),
  "utf8"
);
const bookingMobileCss = fs.readFileSync(
  new URL("../src/styles/dashboard-v2/pages/booking-internal-mobile.css", import.meta.url),
  "utf8"
);

test("booking summary scrolls independently while checkout controls stay outside the scroller", () => {
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto;[\s\S]*overflow:\s*hidden;/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-scroll\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior-y:\s*contain;/
  );
  assert.match(
    bookingTsx,
    /className="bk2-summary-scroll"[\s\S]*className="bk2-summary-footer"[\s\S]*className="bk2-totals"/
  );
  assert.match(
    bookingMobileCss,
    /\.bk2-summary-card\s*\{[\s\S]*position:\s*static;[\s\S]*max-height:\s*none;[\s\S]*overflow:\s*visible;/
  );
});


test("internal booking uses the full dashboard workspace width", () => {
  assert.match(
    bookingCss,
    /\.bk2-page > \*\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*none;[\s\S]*margin-inline:\s*0;/
  );
  assert.doesNotMatch(bookingCss, /\.bk2-page > \*\s*\{[\s\S]{0,160}max-width:\s*1680px;/);
});


test("booking summary moves with the page instead of sticking to the viewport", () => {
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*auto;/
  );
  assert.doesNotMatch(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]{0,160}position:\s*sticky;/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*max-height:\s*calc\(100dvh - 96px\);/
  );
});


test("wheel input over the booking sidebar scrolls the sidebar before the page", () => {
  assert.match(bookingTsx, /const summaryScrollRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(
    bookingTsx,
    /handleSummaryWheel = useCallback\(\(event: WheelEvent<HTMLElement>\)[\s\S]*scroller\.scrollTop = Math\.max/
  );
  assert.match(
    bookingTsx,
    /<aside className="bk2-summary-card" onWheel=\{handleSummaryWheel\}>[\s\S]*ref=\{summaryScrollRef\} className="bk2-summary-scroll"/
  );
});
