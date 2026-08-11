import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDateKeysInRange,
  getWeekdayKeyForDateKey,
  isWeeklyOffDateKey,
  normalizeWeeklyOffDays,
} from "../src/helpers/hr/workSchedule.ts";
import {
  appendDateEffectiveScheduleVersion,
  resolveStaffScheduleVersionForDate,
  weeklyOffDaysFromScheduleSnapshot,
} from "../src/helpers/hr/staffScheduleHistory.ts";

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

test("effective-dated schedule switches on the requested date with no overlap", () => {
  const allWorking = {
    useCustomWorkingHours: true,
    customWorkingHours: {
      sun: { enabled: true, start: "15:00", end: "23:00" },
      mon: { enabled: true, start: "15:00", end: "23:00" },
      tue: { enabled: true, start: "15:00", end: "23:00" },
      wed: { enabled: true, start: "15:00", end: "23:00" },
      thu: { enabled: true, start: "15:00", end: "23:00" },
      fri: { enabled: true, start: "15:00", end: "23:00" },
      sat: { enabled: true, start: "15:00", end: "23:00" },
    },
  };
  const mondayOff = {
    ...allWorking,
    customWorkingHours: {
      ...allWorking.customWorkingHours,
      mon: { enabled: false, start: "15:00", end: "23:00" },
    },
  };

  const versions = appendDateEffectiveScheduleVersion({
    versions: [],
    effectiveFrom: "2026-08-17",
    previous: allWorking,
    next: mondayOff,
    nowIso: "2026-08-11T12:00:00.000Z",
  });

  const before = resolveStaffScheduleVersionForDate(versions, "2026-08-16");
  const from = resolveStaffScheduleVersionForDate(versions, "2026-08-17");
  const after = resolveStaffScheduleVersionForDate(versions, "2026-08-24");

  assert.equal(before?.effectiveTo, "2026-08-16");
  assert.deepEqual(weeklyOffDaysFromScheduleSnapshot(before), []);
  assert.equal(from?.effectiveFrom, "2026-08-17");
  assert.deepEqual(weeklyOffDaysFromScheduleSnapshot(from), ["mon"]);
  assert.equal(after?.id, from?.id);
});
