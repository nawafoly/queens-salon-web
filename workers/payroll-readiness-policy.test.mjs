import test from "node:test";
import assert from "node:assert/strict";

import { payrollAttendanceReadiness } from "../src/helpers/hr/payrollReadiness.js";

test("required attendance is ready only when link is confirmed and punches are complete", () => {
  const result = payrollAttendanceReadiness({
    attendancePayrollMode: "required",
    attendanceLinkStatus: "confirmed",
    attendanceDeductionEligible: true,
    attendanceRecordCount: 42,
    incompleteDays: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.attendancePayrollMode, "required");
});

test("unconfirmed required attendance blocks payroll approval/export", () => {
  const result = payrollAttendanceReadiness({
    attendancePayrollMode: "required",
    attendanceLinkStatus: "unlinked",
    attendanceDeductionEligible: false,
    attendanceRecordCount: 0,
    incompleteDays: 0,
  });
  assert.equal(result.ready, false);
  assert.equal(result.code, "payroll_attendance_unconfirmed");
});

test("an incomplete required punch blocks payroll approval/export", () => {
  const result = payrollAttendanceReadiness({
    attendancePayrollMode: "required",
    attendanceLinkStatus: "confirmed",
    attendanceDeductionEligible: true,
    attendanceRecordCount: 20,
    incompleteDays: 1,
  });
  assert.equal(result.ready, false);
  assert.equal(result.code, "payroll_attendance_incomplete");
});

test("exempt payroll attendance does not require schedule or punches but requires a documented reason", () => {
  const ready = payrollAttendanceReadiness({
    attendancePayrollMode: "exempt",
    attendancePayrollExemptionReason: "موظف إداري / إدارة",
    attendanceLinkStatus: "exempt",
    attendanceDeductionEligible: false,
    attendanceRecordCount: 0,
    incompleteDays: 0,
    totalScheduledHours: 0,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.attendanceLinkStatus, "exempt");

  const missingReason = payrollAttendanceReadiness({
    attendancePayrollMode: "exempt",
    attendanceLinkStatus: "exempt",
    attendanceDeductionEligible: false,
    attendanceRecordCount: 0,
  });
  assert.equal(missingReason.ready, false);
  assert.equal(
    missingReason.code,
    "payroll_attendance_exemption_reason_required"
  );
});
