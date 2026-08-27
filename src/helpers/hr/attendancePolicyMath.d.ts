export type AttendanceMinutePolicyInput = {
  actualLateMinutes?: number | null;
  earlyLeaveMinutes?: number | null;
  afterScheduleMinutes?: number | null;
};

export type AttendanceMinutePolicyResult = {
  actualLateMinutes: number;
  earlyLeaveMinutes: number;
  afterScheduleMinutes: number;
  compensatedLateMinutes: number;
  uncompensatedLateMinutes: number;
  missingMinutes: number;
  extraMinutes: number;
};

export type AttendanceLatePresentationInput = AttendanceMinutePolicyInput & {
  lateGraceMinutes?: number | null;
  compensationWindowOpen?: boolean | null;
  hasCheckOut?: boolean | null;
};

export type AttendanceLatePresentationResult = AttendanceMinutePolicyResult & {
  lateGraceMinutes: number;
  pendingCompensationMinutes: number;
  displayLateMinutes: number;
};

export function calculateAttendanceMinutePolicy(
  input?: AttendanceMinutePolicyInput
): AttendanceMinutePolicyResult;

export function calculateAttendanceLatePresentation(
  input?: AttendanceLatePresentationInput
): AttendanceLatePresentationResult;
