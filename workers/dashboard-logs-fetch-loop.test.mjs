import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/pages/DashboardLogs.tsx", "utf8");

test("DashboardLogs initial load does not depend on rows.length", () => {
  assert.match(
    source,
    /const currentRowsCountRef = useRef\(0\);/,
    "DashboardLogs should keep pagination count outside render dependencies"
  );

  assert.match(
    source,
    /\[canManage,\s*parseRow\]/,
    "loadPage should have stable dependencies"
  );

  assert.doesNotMatch(
    source,
    /\[canManage,\s*parseRow,\s*rows\.length\]/,
    "rows.length must not recreate loadPage and retrigger the initial-load effect"
  );

  assert.match(
    source,
    /currentRowsCountRef\.current \+ PAGE_SIZE/,
    "load-more pagination should use the stable row-count ref"
  );
});