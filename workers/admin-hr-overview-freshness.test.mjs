import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/pages/AdminHrDashboard.tsx", "utf8");

test("HR overview reloads from Core when returning to the overview route", () => {
  const effectStart = source.indexOf(
    "useEffect(() => {",
    source.indexOf("const overviewLoadedRef")
  );
  const effectEnd = source.indexOf(
    "}, [isOverviewRoute, loadData]);",
    effectStart
  );

  assert.ok(effectStart >= 0);
  assert.ok(effectEnd > effectStart);

  const effect = source.slice(effectStart, effectEnd);

  assert.match(
    effect,
    /void loadData\(true\)/
  );
});

test("HR overview refreshes canonical data when the page becomes active", () => {
  assert.match(
    source,
    /const refreshOverviewWhenActive/
  );

  assert.match(
    source,
    /window\.addEventListener\("focus", refreshOverviewWhenActive\)/
  );

  assert.match(
    source,
    /window\.addEventListener\("online", refreshOverviewWhenActive\)/
  );

  assert.match(
    source,
    /document\.addEventListener\("visibilitychange", refreshOverviewWhenActive\)/
  );

  assert.match(
    source,
    /if \(isOverviewRoute && document\.visibilityState === "visible"\)/
  );

  assert.match(
    source,
    /void loadData\(true\)/
  );
});

test("overview refresh keeps the existing late-response request guard", () => {
  assert.match(
    source,
    /const requestId = \+\+loadRequestRef\.current/
  );

  assert.match(
    source,
    /if \(requestId !== loadRequestRef\.current\) return/
  );
});