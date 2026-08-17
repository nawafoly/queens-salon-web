import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDateKeysInRange,
  getWeekdayKeyForDateKey,
  isWeeklyOffDateKey,
  normalizeWeeklyOffDays,
} from "../src/helpers/hr/workSchedule.ts";


test("August 2026 weekday mapping stays aligned with UTC-noon date keys", () => {
  assert.equal(getWeekdayKeyForDateKey("2026-08-01"), "saturday");
  assert.equal(getWeekdayKeyForDateKey("2026-08-02"), "sunday");
  assert.equal(getWeekdayKeyForDateKey("2026-08-03"), "monday");
  assert.equal(getWeekdayKeyForDateKey("2026-08-04"), "tuesday");
  assert.equal(getWeekdayKeyForDateKey("2026-08-10"), "monday");
  assert.equal(getWeekdayKeyForDateKey("2026-08-11"), "tuesday");
});

test("weekday aliases normalize to the same canonical schedule keys", () => {
  assert.deepEqual(normalizeWeeklyOffDays(["mon", "monday", "الاثنين", "1"]), ["monday"]);
  assert.deepEqual(normalizeWeeklyOffDays(["tue", "tuesday", "الثلاثاء", "2"]), ["tuesday"]);
  assert.equal(isWeeklyOffDateKey("2026-08-17", ["mon"]), true);
  assert.equal(isWeeklyOffDateKey("2026-08-18", ["mon"]), false);
});

test("date ranges keep exact calendar dates without timezone day shifts", () => {
  assert.deepEqual(buildDateKeysInRange("2026-08-09", "2026-08-11"), [
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
  ]);
});
