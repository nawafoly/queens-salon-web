import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDateEffectiveScheduleVersion,
  resolveStaffScheduleVersionForDate,
  scheduleSnapshotsEqual,
} from "../src/helpers/hr/staffScheduleHistory.ts";

const oldSchedule = {
  useCustomWorkingHours: true,
  customWorkingHours: {
    sun: { enabled: true, start: "14:00", end: "22:00" },
  },
};

const newSchedule = {
  useCustomWorkingHours: true,
  customWorkingHours: {
    sun: { enabled: true, start: "13:00", end: "21:00" },
  },
};

test("changing a schedule keeps the previous schedule for older attendance dates", () => {
  const versions = appendDateEffectiveScheduleVersion({
    effectiveFrom: "2026-07-28",
    previous: oldSchedule,
    next: newSchedule,
    changeReason: "تغيير الدوام الرسمي",
    nowIso: "2026-07-28T09:00:00.000Z",
  });

  const oldDay = resolveStaffScheduleVersionForDate(versions, "2026-07-27");
  const newDay = resolveStaffScheduleVersionForDate(versions, "2026-07-28");

  assert.equal(oldDay?.customWorkingHours.sun.start, "14:00");
  assert.equal(oldDay?.effectiveTo, "2026-07-27");
  assert.equal(newDay?.customWorkingHours.sun.start, "13:00");
  assert.equal(newDay?.effectiveTo, undefined);
});

test("a historical correction replaces only versions from its effective date onward", () => {
  let versions = appendDateEffectiveScheduleVersion({
    effectiveFrom: "2026-07-28",
    previous: oldSchedule,
    next: newSchedule,
    changeReason: "تغيير أول",
    nowIso: "2026-07-28T09:00:00.000Z",
  });

  const correctedSchedule = {
    useCustomWorkingHours: true,
    customWorkingHours: {
      sun: { enabled: true, start: "12:30", end: "20:30" },
    },
  };

  versions = appendDateEffectiveScheduleVersion({
    versions,
    effectiveFrom: "2026-07-20",
    next: correctedSchedule,
    changeReason: "تصحيح تاريخي",
    nowIso: "2026-07-28T10:00:00.000Z",
  });

  assert.equal(resolveStaffScheduleVersionForDate(versions, "2026-07-19")?.customWorkingHours.sun.start, "14:00");
  assert.equal(resolveStaffScheduleVersionForDate(versions, "2026-07-20")?.customWorkingHours.sun.start, "12:30");
  assert.equal(resolveStaffScheduleVersionForDate(versions, "2026-07-28")?.customWorkingHours.sun.start, "12:30");
});

test("schedule comparison ignores object identity", () => {
  assert.equal(scheduleSnapshotsEqual(oldSchedule, structuredClone(oldSchedule)), true);
  assert.equal(scheduleSnapshotsEqual(oldSchedule, newSchedule), false);
});
