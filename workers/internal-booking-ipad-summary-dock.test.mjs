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
    /\.bk2-summary-card\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[\s\S]*overflow:\s*hidden;/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-scroll\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior-y:\s*auto;/
  );
  assert.match(
    bookingTsx,
    /className="bk2-summary-title"[\s\S]*className="bk2-summary-scroll"[\s\S]*className="bk2-summary-footer"[\s\S]*className="bk2-totals"/
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


test("desktop booking summary follows page scroll and sticks only below the topbar", () => {
  assert.match(
    bookingCss,
    /\.bk2-summary-column\s*\{[\s\S]*align-self:\s*stretch;/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*calc\(10px \+ var\(--dash-topbar-height\) \+ var\(--dsv2-space-3\)\);/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*height:\s*calc\(100dvh - var\(--dash-topbar-height\) - 10px - var\(--dsv2-space-6\)\);[\s\S]*max-height:\s*calc\(100dvh - var\(--dash-topbar-height\) - 10px - var\(--dsv2-space-6\)\);/
  );
  assert.match(
    css,
    /@media \(min-width: 1120px\) and \(max-width: 1400px\)[\s\S]*\.bk2-summary-card\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*calc\(10px \+ var\(--dash-topbar-height\) \+ var\(--dsv2-space-3\)\);/
  );
});


test("summary keeps its header visible and uses native internal scrolling without wheel hijacking", () => {
  assert.doesNotMatch(bookingTsx, /summaryScrollRef|handleSummaryWheel|WheelEvent/);
  assert.match(
    bookingTsx,
    /<aside className="bk2-summary-card">[\s\S]*className="bk2-summary-title"[\s\S]*className="bk2-summary-scroll"/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-scroll\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior-y:\s*auto;/
  );
});


test("desktop summary fills the available viewport so page scrolling does not leave a blank column below it", () => {
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*height:\s*calc\(100dvh - var\(--dash-topbar-height\) - 10px - var\(--dsv2-space-6\)\);/
  );
  assert.match(
    css,
    /@media \(min-width: 744px\) and \(max-width: 1119px\)[\s\S]*\.bk2-summary-card\s*\{[\s\S]*height:\s*auto;[\s\S]*max-height:\s*none;/
  );
  assert.match(
    bookingMobileCss,
    /\.bk2-summary-card\s*\{[\s\S]*height:\s*auto;[\s\S]*max-height:\s*none;/
  );
});


test("desktop main booking area stays in normal page flow while only the summary is viewport-bounded", () => {
  assert.match(
    bookingCss,
    /\.bk2-main-card\s*\{[\s\S]*min-height:\s*635px;[\s\S]*padding:\s*var\(--dsv2-panel-padding\);/
  );
  assert.doesNotMatch(
    bookingCss,
    /@media \(min-width: 1120px\)[\s\S]*\.bk2-main-card[\s\S]*overflow-y:\s*auto;/
  );
  assert.doesNotMatch(bookingTsx, /mainScrollRef|handleMainWheel/);
  assert.match(
    bookingTsx,
    /<main className="bk2-main-card">/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*calc\(10px \+ var\(--dash-topbar-height\) \+ var\(--dsv2-space-3\)\);[\s\S]*height:\s*calc\(100dvh - var\(--dash-topbar-height\) - 10px - var\(--dsv2-space-6\)\);/
  );
});


test("summary uses a normal-flow column wrapper so sticky begins only at the topbar boundary", () => {
  assert.match(
    bookingTsx,
    /<div className="bk2-summary-column">[\s\S]*<aside className="bk2-summary-card">/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-column\s*\{[\s\S]*align-self:\s*stretch;/
  );
  assert.match(
    bookingCss,
    /\.bk2-summary-card\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*calc\(10px \+ var\(--dash-topbar-height\) \+ var\(--dsv2-space-3\)\);/
  );
  assert.match(
    css,
    /\.bk2-summary-column\s*\{[\s\S]*order:\s*1;[\s\S]*\.bk2-summary-card\s*\{[\s\S]*position:\s*static;/
  );
  assert.match(
    bookingMobileCss,
    /\.bk2-summary-column\s*\{[\s\S]*order:\s*1;[\s\S]*\.bk2-summary-card\s*\{[\s\S]*position:\s*static;/
  );
});
