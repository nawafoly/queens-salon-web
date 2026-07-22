import test from "node:test";
import assert from "node:assert/strict";
import { calculateAttendanceDisciplineDay } from "../src/helpers/hr/attendanceDiscipline.ts";

function calculate(checkInAt, checkOutAt) {
  return calculateAttendanceDisciplineDay({
    date: "2026-07-01",
    scheduledStart: "09:00",
    scheduledEnd: "17:00",
    checkInAt,
    checkOutAt,
  });
}

test("9-5 with 10-6 fully compensates the late hour", () => {
  const day = calculate(
    "2026-07-01T10:00:00+03:00",
    "2026-07-01T18:00:00+03:00"
  );

  assert.deepEqual({
    late: day.lateHours,
    compensated: day.compensatedLateHours,
    missing: day.missingHours,
    extra: day.extraHours,
  }, {
    late: 1,
    compensated: 1,
    missing: 0,
    extra: 0,
  });
});

test("9-5 with 10-5 leaves one missing hour", () => {
  const day = calculate(
    "2026-07-01T10:00:00+03:00",
    "2026-07-01T17:00:00+03:00"
  );

  assert.deepEqual({
    late: day.lateHours,
    compensated: day.compensatedLateHours,
    missing: day.missingHours,
    extra: day.extraHours,
  }, {
    late: 1,
    compensated: 0,
    missing: 1,
    extra: 0,
  });
});

test("9-5 with 9-6 records one extra hour", () => {
  const day = calculate(
    "2026-07-01T09:00:00+03:00",
    "2026-07-01T18:00:00+03:00"
  );

  assert.deepEqual({
    late: day.lateHours,
    missing: day.missingHours,
    extra: day.extraHours,
  }, {
    late: 0,
    missing: 0,
    extra: 1,
  });
});

test("9-5 with 10-7 compensates late time and keeps one extra hour", () => {
  const day = calculate(
    "2026-07-01T10:00:00+03:00",
    "2026-07-01T19:00:00+03:00"
  );

  assert.deepEqual({
    late: day.lateHours,
    compensated: day.compensatedLateHours,
    missing: day.missingHours,
    extra: day.extraHours,
  }, {
    late: 1,
    compensated: 1,
    missing: 0,
    extra: 1,
  });
});
