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
