export type AttendanceBiometricResult = {
  verified: boolean;
  method: "attendance-button";
  verifiedAtClient: string;
};

export async function isPlatformBiometricAvailable() {
  return typeof window !== "undefined";
}

export async function requestAttendanceBiometric(args: {
  employeeId: string;
  displayName: string;
  action: "check_in" | "check_out";
}): Promise<AttendanceBiometricResult> {
  const employeeId = String(args.employeeId || "").trim();
  if (!employeeId) {
    throw new Error("تعذر قراءة بيانات الموظفة.");
  }

  return {
    verified: true,
    method: "attendance-button",
    verifiedAtClient: new Date().toISOString(),
  };
}
