import test from "node:test";
import assert from "node:assert/strict";
import { buildAttendanceReportData } from "../src/helpers/reports/exportAttendanceReport.ts";
import {
  buildPayrollPayslipData,
  buildPayrollReportData,
} from "../src/helpers/reports/exportPayrollReport.ts";
import { buildStaffPerformanceReportData } from "../src/helpers/reports/exportStaffPerformanceReport.ts";
import {
  calculatePayrollSnapshot,
} from "../src/helpers/hr/payrollCalculations.ts";
import { calculateAttendanceDisciplineDay } from "../src/helpers/hr/attendanceDiscipline.ts";

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

function payrollEntry(overrides = {}) {
  const snapshot = calculatePayrollSnapshot({
    employeeId: "emp-1",
    employeeName: "موظفة اختبار",
    jobTitle: "أخصائية",
    payrollMonth: "2026-07",
    baseSalaryHalalas: 550000,
    workDays: 30,
    monthlyHours: 208,
    dailyScheduledHours: 8,
    attendanceSummary,
    ...overrides,
  });
  return {
    ...snapshot,
    saved: false,
    approvedAt: null,
    paidAt: null,
    auditLog: [],
  };
}

function attendanceReport() {
  const day = calculateAttendanceDisciplineDay({
    date: "2026-07-01",
    scheduledStart: "10:00",
    scheduledEnd: "18:00",
    checkInAt: "2026-07-01T07:05:00.000Z",
    checkOutAt: "2026-07-01T15:30:00.000Z",
  });
  return buildAttendanceReportData({
    rows: [
      {
        key: "emp-1:2026-07-01",
        employeeId: "emp-1",
        employeeName: "موظفة اختبار",
        date: "2026-07-01",
        shiftLabel: "10:00 - 18:00",
        scheduleNote: "دوام الموظفة",
        firstCheckInAt: "2026-07-01T07:05:00.000Z",
        lastCheckOutAt: "2026-07-01T15:30:00.000Z",
        summary: day,
      },
    ],
    summary: {
      totalScheduledHours: day.scheduledHours,
      totalActualWorkedHours: day.actualWorkedHours,
      totalLateHours: day.lateHours,
      totalCompensatedLateHours: day.compensatedLateHours,
      totalMissingHours: day.missingHours,
      totalExtraHours: day.extraHours,
      attendanceDays: 1,
      absentDays: 0,
      incompleteDays: 0,
    },
    filters: { fromDate: "2026-07-01", toDate: "2026-07-31" },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
}

function staffPerformanceResult() {
  return {
    filters: { fromDate: "2026-07-01", toDate: "2026-07-31", bookingStatus: "completed" },
    rows: [
      {
        employeeId: "emp-1",
        employeeName: "موظفة اختبار",
        active: true,
        jobTitle: "أخصائية",
        department: "العناية",
        specialties: [],
        completedBookings: 0,
        uniqueClients: 0,
        servicesPerformed: 0,
        attributedRevenueHalalas: 0,
        averageServiceValueHalalas: null,
        averageBookingValueHalalas: null,
        cancellations: 0,
        noShows: 0,
        averageRating: null,
        ratingCount: 0,
        attendance: {
          ...attendanceSummary,
          available: false,
          commitmentPercent: null,
          note: "لا توجد بيانات حضور كافية",
        },
        performanceScore: 0,
        scoreNotes: ["لا توجد تقييمات مرتبطة بالحجوزات في الفترة"],
        dataWarnings: ["التقييمات غير متوفرة"],
        topServices: [],
        bookingDetails: [],
      },
    ],
    summary: {
      totalCompletedBookings: 0,
      totalAttributedRevenueHalalas: 0,
      activeEmployees: 1,
      averagePerformanceScore: 0,
      unassignedCompletedBookings: 0,
      ratingAvailable: false,
      attendanceAvailable: false,
    },
    warnings: [],
  };
}

test("payroll report does not turn incomplete salary values into official zeroes", () => {
  const report = buildPayrollReportData({
    entries: [payrollEntry({ baseSalaryHalalas: 0 })],
    filters: { year: 2026, month: 7 },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  const row = report.table.rows[0];
  assert.equal(row.setupStatus, "غير مكتمل");
  assert.equal(row.baseSalary, "غير مكتمل");
  assert.equal(row.netSalary, "غير مكتمل");
});

test("draft payslip clearly marks the document as not approved", () => {
  const report = buildPayrollPayslipData({
    entry: payrollEntry({ status: "draft" }),
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  assert.ok(report.summary.some((item) => item.value === "مسودة غير معتمدة"));
  assert.ok(report.table.rows.some((row) => row.value === "مسودة غير معتمدة"));
});

test("attendance report contains no financial columns", () => {
  const report = attendanceReport();
  const headers = report.table.columns.map((column) => column.header).join(" ");
  assert.equal(headers.includes("راتب"), false);
  assert.equal(headers.includes("خصم"), false);
  assert.equal(headers.includes("ريال"), false);
});

test("staff performance report handles unavailable rating", () => {
  const report = buildStaffPerformanceReportData({
    result: staffPerformanceResult(),
    filters: { fromDate: "2026-07-01", toDate: "2026-07-31" },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  assert.equal(report.table.rows[0].averageRating, "غير متوفر");
  assert.equal(
    report.summary.find((item) => item.label === "عدد الموظفات بدون بيانات كافية")?.value,
    1
  );
});

test("report detail tables expose the required Arabic columns", () => {
  const payrollHeaders = buildPayrollReportData({
    entries: [payrollEntry()],
    filters: { year: 2026, month: 7 },
  }).table.columns.map((column) => column.header);
  assert.ok(payrollHeaders.includes("الموظفة"));
  assert.ok(payrollHeaders.includes("صافي الراتب"));
  assert.ok(payrollHeaders.includes("حالة إعداد الراتب"));

  const attendanceHeaders = attendanceReport().table.columns.map((column) => column.header);
  assert.ok(attendanceHeaders.includes("الدوام المعتمد"));
  assert.ok(attendanceHeaders.includes("صافي الفرق"));

  const performanceHeaders = buildStaffPerformanceReportData({
    result: staffPerformanceResult(),
    filters: { fromDate: "2026-07-01", toDate: "2026-07-31" },
  }).table.columns.map((column) => column.header);
  assert.ok(performanceHeaders.includes("الإيراد المنسوب"));
  assert.ok(performanceHeaders.includes("ملاحظات نقص البيانات"));
});

test("monthly payroll default export excludes incomplete payroll rows", () => {
  const complete = payrollEntry({ employeeName: "مكتملة" });
  const incomplete = payrollEntry({ employeeName: "ناقصة", baseSalaryHalalas: 0 });
  const report = buildPayrollReportData({
    entries: [complete, incomplete],
    filters: { year: 2026, month: 7 },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  assert.equal(report.title, "تقرير الرواتب الشهرية - المستحقات الفعلية");
  assert.equal(report.table.rows.length, 1);
  assert.equal(report.table.rows[0].employeeName, "مكتملة");
  assert.equal(report.table.rows.some((row) => row.employeeName === "ناقصة"), false);
  assert.equal(report.extraTables?.[0]?.name, "السجلات المستبعدة");
  assert.equal(report.extraTables?.[0]?.rows[0].employeeName, "ناقصة");
});

test("monthly payroll default export excludes zero net salary rows", () => {
  const zeroNet = payrollEntry({
    employeeName: "صفر",
    totalDeductionsHalalas: 550000,
  });
  const report = buildPayrollReportData({
    entries: [zeroNet],
    filters: { year: 2026, month: 7 },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  assert.equal(report.table.rows[0].employeeName, "لا توجد رواتب مكتملة قابلة للتصدير لهذه الفترة.");
  assert.ok(report.notes?.includes("لا توجد رواتب مكتملة قابلة للتصدير لهذه الفترة."));
  assert.equal(report.extraTables?.[0]?.rows[0].employeeName, "صفر");
});

test("monthly payroll totals ignore excluded incomplete rows", () => {
  const complete = payrollEntry({ employeeName: "مكتملة" });
  const incomplete = payrollEntry({
    employeeName: "ناقصة",
    baseSalaryHalalas: 0,
    totalDeductionsHalalas: 999999,
  });
  const report = buildPayrollReportData({
    entries: [complete, incomplete],
    filters: { year: 2026, month: 7 },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  const netTotal = report.summary.find((item) => item.label === "إجمالي صافي الرواتب")?.value;
  const deductionsTotal = report.summary.find((item) => item.label === "إجمالي الخصومات")?.value;
  assert.equal(netTotal, 5473.56);
  assert.equal(deductionsTotal, 26.44);
});

test("monthly payroll export can include incomplete rows explicitly", () => {
  const complete = payrollEntry({ employeeName: "مكتملة" });
  const incomplete = payrollEntry({ employeeName: "ناقصة", baseSalaryHalalas: 0 });
  const report = buildPayrollReportData({
    entries: [complete, incomplete],
    includeIncomplete: true,
    filters: { year: 2026, month: 7 },
    generatedAt: "2026-07-23T10:00:00.000Z",
  });
  assert.equal(report.table.rows.length, 2);
  assert.equal(report.table.rows.some((row) => row.employeeName === "ناقصة"), true);
  assert.equal(report.extraTables, undefined);
  assert.ok(report.period.includes("يشمل السجلات غير المكتملة"));
});
