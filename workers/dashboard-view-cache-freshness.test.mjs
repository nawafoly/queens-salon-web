import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/pages/Dashboard.tsx", "utf8");

test("dashboard view cache has a bounded freshness contract", () => {
  assert.match(
    page,
    /const DASHBOARD_VIEW_CACHE_TTL_MS = 5 \* 60 \* 1000/
  );

  assert.match(
    page,
    /function isDashboardViewCacheFresh/
  );

  assert.match(
    page,
    /ageMs < 0 \|\| ageMs > DASHBOARD_VIEW_CACHE_TTL_MS/
  );

  assert.match(
    page,
    /dashboardLocalDateKey\(savedAt\) === dashboardLocalDateKey\(now\)/
  );
});

test("expired dashboard snapshots are rejected from memory and localStorage", () => {
  const readerStart = page.indexOf("function readDashboardViewCache");
  const writerStart = page.indexOf("function writeDashboardViewCache");

  assert.ok(readerStart >= 0);
  assert.ok(writerStart > readerStart);

  const reader = page.slice(readerStart, writerStart);

  assert.match(
    reader,
    /isDashboardViewCacheFresh\(dashboardViewMemoryCache\)/
  );

  assert.match(
    reader,
    /isDashboardViewCacheFresh\(parsed\)/
  );

  assert.match(
    reader,
    /clearDashboardViewCache\(\)/
  );

  assert.doesNotMatch(
    reader,
    /if \(dashboardViewMemoryCache\) return dashboardViewMemoryCache/
  );
});

test("cached dashboard data never silently suppresses refresh failure", () => {
  assert.match(
    page,
    /const \[refreshWarning, setRefreshWarning\] = useState<string>\(""\)/
  );

  assert.match(
    page,
    /if \(hasDashboardDataRef\.current\) \{\s*setRefreshWarning/
  );

  assert.match(
    page,
    /آخر نسخة محلية صالحة/
  );

  assert.match(
    page,
    /role="status"/
  );

  assert.match(
    page,
    /aria-live="polite"/
  );
});

test("successful dashboard refresh clears stale-data warning", () => {
  const successPos = page.indexOf(
    "hasDashboardDataRef.current = true;"
  );
  const warningClearPos = page.indexOf(
    'setRefreshWarning("");',
    successPos
  );
  const cacheWritePos = page.indexOf(
    "writeDashboardViewCache({",
    successPos
  );

  assert.ok(successPos >= 0);
  assert.ok(warningClearPos > successPos);
  assert.ok(cacheWritePos > warningClearPos);
});

test("silent focus refresh may suppress alert but not stale-data warning", () => {
  assert.match(
    page,
    /refreshDashboard\(role, \{ silent: true \}\)/
  );

  const catchStart = page.indexOf(
    "if (hasDashboardDataRef.current) {"
  );
  const alertStart = page.indexOf(
    "if (!options?.silent && !hasDashboardDataRef.current)",
    catchStart
  );

  assert.ok(catchStart >= 0);
  assert.ok(alertStart > catchStart);
});
