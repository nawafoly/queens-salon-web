import test from "node:test";
import assert from "node:assert/strict";

import { calculateAttendanceMinutePolicy } from "../src/helpers/hr/attendancePolicyMath.js";
import { evaluateCheckInWindow } from "./attendance-worker.js";

test("late minutes must be compensated after the shift", () => {
  assert.deepEqual(
    calculateAttendanceMinutePolicy({
      actualLateMinutes: 11,
      afterScheduleMinutes: 11,
      earlyLeaveMinutes: 0,
    }),
    {
      actualLateMinutes: 11,
      earlyLeaveMinutes: 0,
      afterScheduleMinutes: 11,
      compensatedLateMinutes: 11,
      uncompensatedLateMinutes: 0,
      missingMinutes: 0,
      extraMinutes: 0,
    }
  );

  assert.equal(
    calculateAttendanceMinutePolicy({ actualLateMinutes: 11, afterScheduleMinutes: 5 }).missingMinutes,
    6
  );
  assert.equal(
    calculateAttendanceMinutePolicy({ actualLateMinutes: 11, afterScheduleMinutes: 0 }).missingMinutes,
    11
  );
});

test("five-minute late arrival remains five missing minutes unless compensated", () => {
  const withoutCompensation = calculateAttendanceMinutePolicy({
    actualLateMinutes: 5,
    afterScheduleMinutes: 0,
    earlyLeaveMinutes: 0,
  });
  assert.equal(withoutCompensation.actualLateMinutes, 5);
  assert.equal(withoutCompensation.uncompensatedLateMinutes, 5);
  assert.equal(withoutCompensation.missingMinutes, 5);

  const fullyCompensated = calculateAttendanceMinutePolicy({
    actualLateMinutes: 5,
    afterScheduleMinutes: 5,
    earlyLeaveMinutes: 0,
  });
  assert.equal(fullyCompensated.compensatedLateMinutes, 5);
  assert.equal(fullyCompensated.uncompensatedLateMinutes, 0);
  assert.equal(fullyCompensated.missingMinutes, 0);
});

test("there is no early-departure grace and early arrival does not compensate it", () => {
  assert.equal(
    calculateAttendanceMinutePolicy({
      actualLateMinutes: 0,
      afterScheduleMinutes: 0,
      earlyLeaveMinutes: 5,
    }).missingMinutes,
    5
  );
  assert.equal(
    calculateAttendanceMinutePolicy({
      actualLateMinutes: 11,
      afterScheduleMinutes: 0,
      earlyLeaveMinutes: 5,
    }).missingMinutes,
    16
  );
});

test("post-shift time compensates lateness before becoming overtime", () => {
  const result = calculateAttendanceMinutePolicy({
    actualLateMinutes: 11,
    afterScheduleMinutes: 20,
    earlyLeaveMinutes: 0,
  });
  assert.equal(result.compensatedLateMinutes, 11);
  assert.equal(result.missingMinutes, 0);
  assert.equal(result.extraMinutes, 9);
});

test("check-in remains open at the exact boundary and closes one minute later", () => {
  const shift = {
    source: "weekly_schedule",
    active: 1,
    template_start_time: "15:00",
    attendance_lock_enabled: 1,
    attendance_lock_after_minutes: 30,
  };

  assert.equal(
    evaluateCheckInWindow({ type: "check_in", now: "2026-08-05T12:30:00.000Z", shift }).result,
    "allowed"
  );
  assert.deepEqual(
    evaluateCheckInWindow({ type: "check_in", now: "2026-08-05T12:31:00.000Z", shift }),
    {
      result: "rejected",
      rejectionReason: "check_in_window_closed",
      dateKey: "2026-08-05",
      closesAtMinutes: 930,
      lockAfterMinutes: 30,
    }
  );
});

test("Riyadh 15:05 is inside a 15:00 shift check-in window", () => {
  const result = evaluateCheckInWindow({
    type: "check_in",
    now: "2026-08-05T12:05:00.000Z",
    shift: {
      source: "weekly_schedule",
      active: 1,
      template_start_time: "15:00",
      late_grace_minutes: 15,
      attendance_lock_enabled: 1,
      attendance_lock_after_minutes: 30,
    },
  });
  assert.equal(result.result, "allowed");
  assert.equal(result.dateKey, "2026-08-05");
  assert.equal(result.closesAtMinutes, 930);
});

test("check-out is never blocked by the late check-in window", () => {
  const result = evaluateCheckInWindow({
    type: "check_out",
    now: "2026-08-05T13:00:00.000Z",
    shift: {
      source: "weekly_schedule",
      active: 1,
      template_start_time: "15:00",
      attendance_lock_enabled: 1,
      attendance_lock_after_minutes: 30,
    },
  });
  assert.equal(result.result, "allowed");
});

test("weekly off rejects check-in even when the lock option is disabled", () => {
  const result = evaluateCheckInWindow({
    type: "check_in",
    now: "2026-08-05T12:00:00.000Z",
    shift: { source: "weekly_schedule", active: 0, exception_type: "off" },
  });
  assert.equal(result.result, "rejected");
  assert.equal(result.rejectionReason, "not_scheduled_workday");
});
