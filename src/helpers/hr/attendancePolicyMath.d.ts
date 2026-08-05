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

export function calculateAttendanceMinutePolicy(
  input?: AttendanceMinutePolicyInput
): AttendanceMinutePolicyResult;
