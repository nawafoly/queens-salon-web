function cleanText(value) {
  return String(value ?? "").trim();
}

function nonNegativeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function trueFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function attendancePayrollMode(summary = {}) {
  return cleanText(
    summary.attendancePayrollMode ??
      summary.attendance_payroll_mode
  ).toLowerCase() === "exempt"
    ? "exempt"
    : "required";
}

/**
 * One shared payroll/attendance approval gate used by frontend and Core.
 *
 * required:
 *   - canonical attendance identity must be confirmed
 *   - at least one punch must be linked when the period has attendance
 *   - no incomplete punch days may remain
 *
 * exempt:
 *   - schedule and punches are not required
 *   - a documented exemption reason is mandatory
 *   - approved unpaid leave / recorded absence can still affect payroll
 */
export function payrollAttendanceReadiness(summary = {}) {
  const source = summary && typeof summary === "object" ? summary : {};
  const mode = attendancePayrollMode(source);
  const exemptionReason = cleanText(
    source.attendancePayrollExemptionReason ??
      source.attendance_payroll_exemption_reason
  );
  const attendanceLinkStatus = cleanText(
    source.attendanceLinkStatus ?? source.attendance_link_status
  ).toLowerCase();
  const attendanceDeductionEligible = trueFlag(
    source.attendanceDeductionEligible ?? source.attendance_deduction_eligible
  );
  const attendanceRecordCount = Math.round(
    nonNegativeNumber(
      source.attendanceRecordCount ?? source.attendance_record_count
    )
  );
  const incompleteDays = Math.round(
    nonNegativeNumber(source.incompleteDays ?? source.incomplete_days)
  );

  if (mode === "exempt") {
    if (!exemptionReason) {
      return {
        ready: false,
        code: "payroll_attendance_exemption_reason_required",
        message:
          "لا يمكن اعتماد راتب موظف معفى من البصمة بدون سبب إعفاء موثق.",
        attendancePayrollMode: "exempt",
        attendancePayrollExemptionReason: "",
        attendanceLinkStatus: "exempt",
        attendanceRecordCount,
        incompleteDays: 0,
      };
    }

    return {
      ready: true,
      code: "",
      message: "",
      attendancePayrollMode: "exempt",
      attendancePayrollExemptionReason: exemptionReason,
      attendanceLinkStatus: "exempt",
      attendanceRecordCount,
      incompleteDays: 0,
    };
  }

  if (
    !attendanceDeductionEligible ||
    attendanceLinkStatus !== "confirmed" ||
    attendanceRecordCount <= 0
  ) {
    return {
      ready: false,
      code: "payroll_attendance_unconfirmed",
      message:
        "لا يمكن اعتماد أو تصدير الراتب رسميًا قبل تأكيد ربط الحضور بالموظفة.",
      attendancePayrollMode: "required",
      attendancePayrollExemptionReason: "",
      attendanceLinkStatus: attendanceLinkStatus || "unconfirmed",
      attendanceRecordCount,
      incompleteDays,
    };
  }

  if (incompleteDays > 0) {
    return {
      ready: false,
      code: "payroll_attendance_incomplete",
      message: `لا يمكن اعتماد أو تصدير الراتب رسميًا: توجد ${incompleteDays} يوم/أيام ببصمة ناقصة وتحتاج مراجعة.`,
      attendancePayrollMode: "required",
      attendancePayrollExemptionReason: "",
      attendanceLinkStatus,
      attendanceRecordCount,
      incompleteDays,
    };
  }

  return {
    ready: true,
    code: "",
    message: "",
    attendancePayrollMode: "required",
    attendancePayrollExemptionReason: "",
    attendanceLinkStatus,
    attendanceRecordCount,
    incompleteDays: 0,
  };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Shared frontend readiness gate for payroll approval / official export.
 * Backend approval still revalidates canonical employment + GOSI policy in D1.
 */
export function payrollApprovalReadiness(entry = {}) {
  const source = objectValue(entry);
  const setupComplete = trueFlag(
    source.payrollSetupComplete ?? source.payroll_setup_complete
  );

  if (!setupComplete) {
    return {
      ready: false,
      code: "payroll_setup_incomplete",
      message: "لا يمكن اعتماد أو تصدير الراتب رسميًا قبل إكمال إعداد الراتب.",
      stage: "setup",
    };
  }

  const attendance = payrollAttendanceReadiness(
    objectValue(source.attendanceSummary ?? source.attendance_summary)
  );

  if (!attendance.ready) {
    return {
      ready: false,
      code: attendance.code,
      message: attendance.message,
      stage: "attendance",
    };
  }

  const gosiSnapshot = objectValue(
    source.gosiSnapshot ?? source.gosi_snapshot
  );
  const policyVersion = cleanText(
    gosiSnapshot.policyVersion ?? gosiSnapshot.policy_version
  );
  const insuranceCategory = cleanText(
    gosiSnapshot.insuranceCategory ?? gosiSnapshot.insurance_category
  ).toLowerCase();

  if (!policyVersion || !insuranceCategory) {
    return {
      ready: false,
      code: "payroll_gosi_unconfigured",
      message:
        "إعداد التأمينات غير مكتمل أو غير ساري على فترة المسير. أكمل تصنيف GOSI وتاريخ السريان ثم أعد حساب المسيرة.",
      stage: "gosi",
    };
  }

  return {
    ready: true,
    code: "",
    message: "",
    stage: "ready",
  };
}
