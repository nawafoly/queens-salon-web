export type PayrollAttendanceMode = "required" | "exempt";

export type PayrollAttendanceReadinessResult = {
  ready: boolean;
  code: string;
  message: string;
  attendancePayrollMode: PayrollAttendanceMode;
  attendancePayrollExemptionReason: string;
  attendanceLinkStatus: string;
  attendanceRecordCount: number;
  incompleteDays: number;
};

export function payrollAttendanceReadiness(
  summary?: Record<string, unknown> | null
): PayrollAttendanceReadinessResult;

export type PayrollApprovalReadinessResult = {
  ready: boolean;
  code: string;
  message: string;
  stage: "setup" | "attendance" | "gosi" | "ready";
};

export function payrollApprovalReadiness(
  entry?: Record<string, unknown> | null
): PayrollApprovalReadinessResult;
