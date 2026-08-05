/**
 * Core attendance minute policy.
 *
 * Late grace controls whether a check-in is accepted, but never grants paid
 * minutes. Only time worked after the scheduled end compensates a late arrival.
 * Arriving early never offsets leaving early.
 */
export function calculateAttendanceMinutePolicy(input = {}) {
  const actualLateMinutes = nonNegativeMinutes(input.actualLateMinutes);
  const earlyLeaveMinutes = nonNegativeMinutes(input.earlyLeaveMinutes);
  const afterScheduleMinutes = nonNegativeMinutes(input.afterScheduleMinutes);

  const compensatedLateMinutes = Math.min(actualLateMinutes, afterScheduleMinutes);
  const uncompensatedLateMinutes = Math.max(0, actualLateMinutes - afterScheduleMinutes);
  const missingMinutes = uncompensatedLateMinutes + earlyLeaveMinutes;
  const extraMinutes = Math.max(0, afterScheduleMinutes - actualLateMinutes);

  return {
    actualLateMinutes,
    earlyLeaveMinutes,
    afterScheduleMinutes,
    compensatedLateMinutes,
    uncompensatedLateMinutes,
    missingMinutes,
    extraMinutes,
  };
}

function nonNegativeMinutes(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}
