import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePayrollSnapshot,
  evaluatePayrollSetup,
  preserveLockedPayrollSnapshot,
  payrollMonthBounds,
} from "../src/helpers/hr/payrollCalculations.ts";
import { buildPayrollAttendanceSummaryForEmployee } from "../src/services/CorePayrollService.ts";

const payrollAttendanceFixtures = {
  fullCycle: {
    workDays: 30,
    monthlyHours: 240,
    dailyHours: 8,
    weeklyOffDays: [],
  },
  oneWeeklyOffDay: {
    workDays: 26,
    monthlyHours: 208,
    dailyHours: 8,
    weeklyOffDays: ["fri"],
  },
  twoWeeklyOffDays: {
    workDays: 22,
    monthlyHours: 176,
    dailyHours: 8,
    weeklyOffDays: ["fri", "sat"],
  },
  variableDailyHoursSundayOnly: {
    workDays: 5,
    monthlyHours: 35,
    dailyHours: 7,
    scheduleWeekday: 0,
  },
};

const attendanceSummary = {
  totalScheduledHours: 208,
  totalActualWorkedHours: 207,
  totalLateHours: 1,
  totalCompensatedLateHours: 0,
  totalMissingHours: 1,
  totalExtraHours: 2,
  attendanceDays: 25,
  absentDays: 0,
  incompleteDays: 0,
};

function snapshot(overrides = {}) {
  return calculatePayrollSnapshot({
    employeeId: "emp-1",
    employeeName: "Employee 1",
    payrollMonth: "2026-07",
    baseSalaryHalalas: 550000,
    workDays: 30,
    monthlyHours: 208,
    dailyScheduledHours: 8,
    attendanceSummary,
    ...overrides,
  });
}

function employeeFixture(id, fixture, overrides = {}) {
  const weeklyOffDays = fixture.weeklyOffDays || [];
  const schedules =
    fixture.scheduleWeekday == null
      ? []
      : [
          {
            id: `${id}-schedule`,
            salonId: "salon-test",
            employeeId: id,
            weekday: fixture.scheduleWeekday,
            startTime: "10:00",
            endTime: null,
            active: true,
          },
        ];
  return {
    id,
    salonId: "salon-test",
    name: `Employee ${id}`,
    status: "active",
    employment: {
      base_salary_halalas: 310000,
      expected_work_days: fixture.workDays,
      expected_work_hours: fixture.monthlyHours,
      daily_scheduled_hours: fixture.dailyHours,
      weekly_off_days_json: JSON.stringify(weeklyOffDays),
    },
    schedules,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function attendanceRecord(id, employeeId, dateKey, recordType, recordedAt) {
  return {
    id,
    salonId: "salon-test",
    employeeId,
    employeeUid: null,
    dateKey,
    recordType,
    recordedAt,
  };
}

function completePunchesForDate(employeeId, dateKey) {
  return [
    attendanceRecord(`${employeeId}-${dateKey}-in`, employeeId, dateKey, "check_in", `${dateKey}T07:00:00.000Z`),
    attendanceRecord(`${employeeId}-${dateKey}-out`, employeeId, dateKey, "check_out", `${dateKey}T15:00:00.000Z`),
  ];
}

function payrollAttendanceSummary(employee, records = []) {
  return buildPayrollAttendanceSummaryForEmployee({
    employee,
    records,
    leaves: [],
    absences: [],
    year: 2026,
    month: 7,
  }).summary;
}

test("daily rate respects the entered workDays value", () => {
  const result = snapshot();
  assert.equal(result.dailyRateHalalas, 18333);
  assert.ok(Math.abs(result.dailyRateHalalas / 100 - 183.333) < 0.01);
});

test("hourly rate uses monthlyHours when present", () => {
  const result = snapshot();
  assert.equal(result.hourlyRateHalalas, 2644);
  assert.ok(Math.abs(result.hourlyRateHalalas / 100 - 26.442) < 0.01);
});

test("salary setup can use work days times daily hours as monthly hours", () => {
  const result = snapshot({
    baseSalaryHalalas: 300000,
    workDays: 30,
    monthlyHours: undefined,
    dailyScheduledHours: 8,
  });
  assert.equal(result.monthlyHours, 240);
  assert.equal(result.dailyRateHalalas, 10000);
  assert.equal(result.hourlyRateHalalas, 1250);
  assert.equal(result.payrollSetupComplete, true);
  assert.equal(result.monthlyHoursSource, "configured_daily_hours");
});

test("one missing hour deducts one hourly rate", () => {
  const result = snapshot();
  assert.equal(result.missingHoursDeductionHalalas, result.hourlyRateHalalas);
});

test("payroll month 07/2026 uses the 21-to-20 accounting period", () => {
  const bounds = payrollMonthBounds(2026, 7);
  assert.equal(bounds.payrollMonth, "2026-07");
  assert.equal(bounds.monthStart, "2026-06-21");
  assert.equal(bounds.monthEnd, "2026-07-20");
  assert.equal(bounds.payDate, "2026-07-28");
});

test("payroll month 08/2026 uses the 21-to-20 accounting period", () => {
  const bounds = payrollMonthBounds(2026, 8);
  assert.equal(bounds.payrollMonth, "2026-08");
  assert.equal(bounds.monthStart, "2026-07-21");
  assert.equal(bounds.monthEnd, "2026-08-20");
  assert.equal(bounds.payDate, "2026-08-28");
});

test("complete payroll setup with no attendance punches is counted as full absence", () => {
  const fixture = payrollAttendanceFixtures.fullCycle;
  const summary = payrollAttendanceSummary(employeeFixture("emp-no-punches", fixture));

  assert.equal(summary.attendanceRecordCount, 0);
  assert.equal(summary.attendanceLinkStatus, "confirmed");
  assert.equal(summary.attendanceDeductionEligible, true);
  assert.equal(summary.attendanceDays, 0);
  assert.equal(summary.absentDays, fixture.workDays);
  assert.equal(summary.totalActualWorkedHours, 0);
  assert.equal(summary.totalScheduledHours, fixture.monthlyHours);
  assert.equal(summary.totalMissingHours, fixture.monthlyHours);
});

test("partial attendance punches count remaining scheduled work days as absence", () => {
  const fixture = payrollAttendanceFixtures.fullCycle;
  const employee = employeeFixture("emp-partial-punches", fixture);
  const presentDates = ["2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"];
  const summary = payrollAttendanceSummary(employee, presentDates.flatMap((date) => completePunchesForDate(employee.id, date)));
  const absentDays = fixture.workDays - presentDates.length;

  assert.equal(summary.attendanceDays, presentDates.length);
  assert.equal(summary.absentDays, absentDays);
  assert.equal(summary.totalActualWorkedHours, presentDates.length * fixture.dailyHours);
  assert.equal(summary.totalScheduledHours, fixture.monthlyHours);
  assert.equal(summary.totalMissingHours, absentDays * fixture.dailyHours);
});

test("attendance absence calculation follows employee weekly schedule for non-full-cycle work days", () => {
  const fixture = payrollAttendanceFixtures.oneWeeklyOffDay;
  const summary = payrollAttendanceSummary(employeeFixture("emp-one-off-day", fixture));

  assert.equal(summary.attendanceDays, 0);
  assert.equal(summary.absentDays, fixture.workDays);
  assert.equal(summary.totalScheduledHours, fixture.monthlyHours);
  assert.equal(summary.totalMissingHours, fixture.monthlyHours);
});

test("incomplete payroll setup stays not ready even when attendance can be inspected", () => {
  const fixture = payrollAttendanceFixtures.twoWeeklyOffDays;
  const employee = employeeFixture("emp-incomplete-setup", fixture, {
    employment: {
      expected_work_days: fixture.workDays,
      expected_work_hours: fixture.monthlyHours,
      daily_scheduled_hours: fixture.dailyHours,
      weekly_off_days_json: JSON.stringify(fixture.weeklyOffDays),
    },
  });
  const summary = payrollAttendanceSummary(employee);
  const result = snapshot({
    employeeId: employee.id,
    baseSalaryHalalas: 0,
    workDays: fixture.workDays,
    monthlyHours: fixture.monthlyHours,
    dailyScheduledHours: fixture.dailyHours,
    attendanceSummary: summary,
  });

  assert.equal(summary.attendanceLinkStatus, "not_ready");
  assert.equal(summary.attendanceDeductionEligible, false);
  assert.equal(result.payrollSetupComplete, false);
  assert.ok(result.payrollSetupMissing.includes("baseSalary"));
});

test("unknown employee identity keeps attendance not ready and blocks deductions", () => {
  const fixture = payrollAttendanceFixtures.fullCycle;
  const summary = payrollAttendanceSummary(employeeFixture("", fixture));
  const result = snapshot({
    employeeId: "",
    workDays: fixture.workDays,
    monthlyHours: fixture.monthlyHours,
    dailyScheduledHours: fixture.dailyHours,
    attendanceSummary: summary,
  });

  assert.equal(summary.attendanceLinkStatus, "not_ready");
  assert.equal(summary.attendanceDeductionEligible, false);
  assert.equal(result.missingHoursDeductionHalalas, 0);
});

test("single missing punch increments incomplete days without counting full attendance", () => {
  const fixture = payrollAttendanceFixtures.variableDailyHoursSundayOnly;
  const employee = employeeFixture("emp-incomplete-punch", fixture);
  const summary = payrollAttendanceSummary(employee, [
    attendanceRecord("emp-incomplete-punch-in", employee.id, "2026-06-21", "check_in", "2026-06-21T07:00:00.000Z"),
  ]);

  assert.equal(summary.incompleteDays, 1);
  assert.equal(summary.attendanceDays, 0);
  assert.equal(summary.absentDays, fixture.workDays - summary.incompleteDays);
  assert.equal(summary.totalActualWorkedHours, 0);
  assert.equal(summary.totalScheduledHours, fixture.monthlyHours);
  assert.equal(summary.totalMissingHours, (fixture.workDays - summary.incompleteDays) * fixture.dailyHours);
});

test("attendance missing-hour deduction is blocked when attendance linkage is unconfirmed", () => {
  const result = snapshot({
    attendanceSummary: {
      ...attendanceSummary,
      totalActualWorkedHours: 0,
      totalMissingHours: 248,
      attendanceDays: 0,
      attendanceRecordCount: 0,
      attendanceLinkStatus: "unlinked",
      attendanceDeductionEligible: false,
    },
  });
  assert.equal(result.attendanceSummary.totalMissingHours, 208);
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.attendanceSummary.attendanceDeductionEligible, false);
  assert.match(result.attendanceSummary.attendanceDeductionNote, /ربط البصمات/);
});

test("manual deductions still apply when attendance deduction is blocked", () => {
  const result = snapshot({
    attendanceSummary: {
      ...attendanceSummary,
      totalMissingHours: 20,
      attendanceRecordCount: 0,
      attendanceDeductionEligible: false,
    },
    deductions: [
      {
        id: "manual-deduction-1",
        direction: "deduction",
        kind: "manual_deduction",
        amountHalalas: 10000,
        reason: "خصم إداري",
        addedAt: "2026-07-23T10:00:00.000Z",
      },
    ],
  });
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.manualDeductionsHalalas, 10000);
  assert.equal(result.totalDeductionsHalalas, 10000);
});

test("approved admin absences are tracked separately from manual deductions", () => {
  const result = snapshot({
    attendanceSummary: {
      ...attendanceSummary,
      totalActualWorkedHours: 0,
      totalMissingHours: 20,
      attendanceDays: 0,
      absentDays: 0,
      approvedAbsenceDays: 1,
      attendanceRecordCount: 0,
      attendanceLinkStatus: "not_ready",
      attendanceDeductionEligible: false,
    },
  });
  assert.equal(result.attendanceSummary.approvedAbsenceDays, 1);
  assert.equal(result.attendanceSummary.absentDays, 0);
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.manualDeductionsHalalas, 0);
});

test("manual additions still apply when attendance deduction is blocked", () => {
  const result = snapshot({
    attendanceSummary: {
      ...attendanceSummary,
      totalMissingHours: 20,
      attendanceRecordCount: 0,
      attendanceDeductionEligible: false,
    },
    additions: [
      {
        id: "manual-addition-1",
        direction: "addition",
        kind: "bonus",
        amountHalalas: 15000,
        reason: "مكافأة",
        addedAt: "2026-07-23T10:00:00.000Z",
      },
    ],
  });
  assert.equal(result.missingHoursDeductionHalalas, 0);
  assert.equal(result.manualAdditionsHalalas, 15000);
  assert.equal(result.totalAdditionsHalalas, 15000);
});

test("detected extra hours do not become financial overtime by default", () => {
  const result = snapshot({ overtimeEnabled: false });
  assert.equal(result.detectedExtraHours, 2);
  assert.equal(result.financialOvertimeHours, 0);
  assert.equal(result.overtimeValueHalalas, 0);
  assert.equal(result.payrollSetupComplete, true);
});

test("enabled overtime uses detected net extra hours and multiplier", () => {
  const result = snapshot({ overtimeEnabled: true, overtimeMultiplier: 1.5 });
  assert.equal(result.financialOvertimeHours, 2);
  assert.equal(result.overtimeValueHalalas, Math.round(2 * result.hourlyRateHalalas * 1.5));
});

test("enabled overtime falls back to multiplier 1.5 when not configured", () => {
  const result = snapshot({ overtimeEnabled: true, overtimeMultiplier: undefined });
  assert.equal(result.overtimeMultiplier, 1.5);
  assert.equal(result.overtimeValueHalalas, Math.round(2 * result.hourlyRateHalalas * 1.5));
});

test("approved payroll keeps its snapshot after a later base salary change", () => {
  const approved = { ...snapshot(), status: "approved" };
  const recalculated = snapshot({ baseSalaryHalalas: 650000 });
  const selected = preserveLockedPayrollSnapshot(approved, recalculated);
  assert.equal(selected.baseSalaryHalalas, 550000);
  assert.equal(selected.dailyRateHalalas, 18333);
});

test("missing base salary marks payroll setup incomplete", () => {
  const result = snapshot({ baseSalaryHalalas: undefined });
  assert.equal(result.payrollSetupComplete, false);
  assert.ok(result.payrollSetupMissing.includes("baseSalary"));
});

test("monthly hours are not inferred from attendance summary", () => {
  const result = snapshot({ monthlyHours: undefined, dailyScheduledHours: undefined });
  assert.equal(result.monthlyHours, 0);
  assert.equal(result.hourlyRateHalalas, 0);
  assert.equal(result.payrollSetupComplete, false);
  assert.ok(result.payrollSetupMissing.includes("monthlyHours"));
});

test("configured daily hours can complete setup without monthlyHours", () => {
  const result = snapshot({ monthlyHours: undefined, dailyScheduledHours: 8 });
  assert.equal(result.monthlyHours, 240);
  assert.equal(result.payrollSetupComplete, true);
  assert.equal(result.monthlyHoursSource, "configured_daily_hours");
  assert.equal(result.hourlyRateHalalas, Math.round(result.baseSalaryHalalas / 240));
});

test("enabled overtime is ignored when payroll setup is incomplete", () => {
  const result = snapshot({
    baseSalaryHalalas: 0,
    overtimeEnabled: true,
    overtimeMultiplier: 1.5,
  });
  assert.equal(result.payrollSetupComplete, false);
  assert.equal(result.overtimeEnabled, false);
  assert.equal(result.financialOvertimeHours, 0);
  assert.equal(result.overtimeValueHalalas, 0);
});

test("setup evaluator reports core missing salary settings", () => {
  const setup = evaluatePayrollSetup({
    employeeId: "emp-1",
    baseSalaryHalalas: 0,
    workDays: 0,
    monthlyHours: 0,
    overtimeMultiplier: 1.5,
  });
  assert.deepEqual(setup.missing, ["baseSalary", "workDays", "monthlyHours"]);
  assert.equal(setup.complete, false);
});

test("setup evaluator does not require overtime multiplier when salary setup is complete", () => {
  const setup = evaluatePayrollSetup({
    employeeId: "emp-1",
    baseSalaryHalalas: 300000,
    workDays: 30,
    monthlyHours: 240,
    overtimeMultiplier: undefined,
  });
  assert.deepEqual(setup.missing, []);
  assert.equal(setup.complete, true);
});

