/**
 * Core attendance minute policy.
 *
 * Late grace controls check-in classification only. It never grants paid
 * minutes. Late minutes are financially cleared only by time worked after the
 * scheduled end. Early departure remains a separate shortage.
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

/**
 * Presentation policy for an open shift.
 *
 * A late arrival inside lateGraceMinutes is shown as "pending compensation"
 * while the employee is still inside the active shift. Once checkout exists
 * (or the shift closes without checkout), the real uncompensated lateness is
 * exposed. The payroll math remains the same in both cases.
 */
export function calculateAttendanceLatePresentation(input = {}) {
  const policy = calculateAttendanceMinutePolicy(input);
  const lateGraceMinutes = nonNegativeMinutes(input.lateGraceMinutes);
  const compensationWindowOpen = input.compensationWindowOpen === true;
  const hasCheckOut = input.hasCheckOut === true;

  const pendingCompensationMinutes =
    compensationWindowOpen &&
    !hasCheckOut &&
    lateGraceMinutes > 0 &&
    policy.actualLateMinutes > 0 &&
    policy.actualLateMinutes <= lateGraceMinutes
      ? policy.actualLateMinutes
      : 0;

  return {
    ...policy,
    lateGraceMinutes,
    pendingCompensationMinutes,
    displayLateMinutes:
      pendingCompensationMinutes > 0
        ? 0
        : policy.uncompensatedLateMinutes,
  };
}

function nonNegativeMinutes(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}
