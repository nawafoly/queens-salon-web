import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/pages/DashboardPayroll.tsx", "utf8");

test("dashboard payroll ignores stale month loads", () => {
  assert.match(source, /useRef/);
  assert.match(source, /loadGenerationRef/);
  assert.match(source, /const generation = \+\+loadGenerationRef\.current/);
  assert.match(source, /const requestedYear = year/);
  assert.match(source, /const requestedMonth = month/);
  assert.match(source, /generation === loadGenerationRef\.current/);
  assert.match(source, /loadPayrollMonth\(\{ year: requestedYear, month: requestedMonth \}\)/);
  assert.match(source, /generatePayrollEntries\(\{[\s\S]*year: requestedYear,[\s\S]*month: requestedMonth/);
  assert.match(source, /if \(!requestIsCurrent\(\)\) return;/);
  assert.match(source, /if \(requestIsCurrent\(\)\) setLoading\(false\)/);
});
