import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/pages/DashboardExpenses.tsx",
  "utf8"
);

test("expenses payroll generation is bounded to the selected month", () => {
  assert.match(
    source,
    /monthKeys:\s*\[\s*selectedMonthKey\s*\]/
  );

  assert.doesNotMatch(
    source,
    /CoreHrService\.listPayrollEntries/
  );

  assert.doesNotMatch(
    source,
    /expandedMonthKeys/
  );
});

test("expenses page does not block auth readiness on payroll generation", () => {
  assert.match(
    source,
    /setAuthReady\(true\)/
  );

  assert.match(
    source,
    /if \(!authReady \|\| !authenticated \|\| !allowed\) return;/
  );

  assert.match(
    source,
    /\[authReady,\s*authenticated,\s*allowed,\s*selectedMonthKey\]/
  );
});

test("stale expense loads cannot overwrite a newer month", () => {
  assert.match(
    source,
    /const loadRequestRef = useRef\(0\)/
  );

  assert.match(
    source,
    /requestId !== loadRequestRef\.current/
  );
});