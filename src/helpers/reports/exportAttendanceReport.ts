import {
  currentGeneratedAt,
  exportReportToExcel,
  exportReportToPdf,
  formatDate,
  formatPeriod,
  formatTime,
  normalizeGeneratedBy,
  safeText,
  type ExportReport,
  type ReportColumn,
} from "./common.ts";
import {
  formatAttendanceHours,
  formatSignedAttendanceHours,
  type AttendanceDisciplineDaySummary,
  type AttendanceDisciplineMonthSummary,
} from "../hr/attendanceDiscipline.ts";

export type AttendanceReportRowInput = {
  key: string;
  employeeName: string;
  employeeId: string;
  date: string;
  shiftLabel: string;
  scheduleNote?: string;
  firstCheckInAt?: string;
  lastCheckOutAt?: string;
  summary: AttendanceDisciplineDaySummary;
};

export type AttendanceReportFilters = {
  fromDate?: string;
  toDate?: string;
  search?: string;
};

type AttendanceReportRow = {
  employeeName: string;
  date: string;
  shiftLabel: string;
  firstCheckInAt: string;
  lastCheckOutAt: string;
  actualWorkedHours: string;
  lateHours: string;
  compensatedLateHours: string;
  permissionCoveredHours: string;
  missingHours: string;
  extraHours: string;
  netHourDifference: string;
  statusLabel: string;
  systemNotes: string;
};

const ATTENDANCE_COLUMNS: ReportColumn<AttendanceReportRow>[] = [
  { key: "employeeName", header: "الموظفة", width: 24 },
  { key: "date", header: "التاريخ", width: 16 },
  { key: "shiftLabel", header: "الدوام المعتمد", width: 18 },
  { key: "firstCheckInAt", header: "أول حضور", width: 16 },
  { key: "lastCheckOutAt", header: "آخر انصراف", width: 16 },
  { key: "actualWorkedHours", header: "مدة العمل", width: 14 },
  { key: "lateHours", header: "التأخير", width: 14 },
  { key: "compensatedLateHours", header: "التعويض بعد الدوام", width: 18 },
  { key: "permissionCoveredHours", header: "الاستئذان المحتسب", width: 18 },
  { key: "missingHours", header: "نقص الساعات", width: 15 },
  { key: "extraHours", header: "ساعات زائدة", width: 15 },
  { key: "netHourDifference", header: "صافي الفرق", width: 15 },
  { key: "statusLabel", header: "الحالة الإدارية", width: 20 },
  { key: "systemNotes", header: "ملاحظات النظام", width: 24 },
];

export function buildAttendanceReportData(input: {
  rows: AttendanceReportRowInput[];
  summary: AttendanceDisciplineMonthSummary;
  filters: AttendanceReportFilters;
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
}): ExportReport<AttendanceReportRow> {
  const period = formatPeriod(input.filters.fromDate, input.filters.toDate);
  const employeeCount = new Set(input.rows.map((row) => row.employeeId || row.employeeName).filter(Boolean)).size;
  const rows = input.rows.map<AttendanceReportRow>((row) => ({
    employeeName: safeText(row.employeeName),
    date: formatDate(row.date),
    shiftLabel: [safeText(row.shiftLabel), row.scheduleNote].filter(Boolean).join(" - "),
    firstCheckInAt: formatTime(row.firstCheckInAt),
    lastCheckOutAt: formatTime(row.lastCheckOutAt),
    actualWorkedHours: formatAttendanceHours(row.summary.actualWorkedHours),
    lateHours: formatAttendanceHours(row.summary.lateHours),
    compensatedLateHours: formatAttendanceHours(row.summary.compensatedLateHours),
    permissionCoveredHours: formatAttendanceHours(row.summary.permissionCoveredHours || 0),
    missingHours: formatAttendanceHours(row.summary.missingHours),
    extraHours: formatAttendanceHours(row.summary.extraHours),
    netHourDifference: formatSignedAttendanceHours(row.summary.netHourDifference),
    statusLabel: safeText(row.summary.statusLabel),
    systemNotes: safeText(row.scheduleNote, ""),
  }));

  return {
    title: "تقرير الحضور والانضباط",
    period,
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    salonName: input.salonName,
    summary: [
      { label: "عدد الموظفات في التقرير", value: employeeCount },
      { label: "عدد أيام الحضور", value: input.summary.attendanceDays },
      { label: "إجمالي ساعات العمل الفعلية", value: formatAttendanceHours(input.summary.totalActualWorkedHours) },
      { label: "إجمالي التأخير", value: formatAttendanceHours(input.summary.totalLateHours) },
      { label: "إجمالي الاستئذان المحتسب", value: formatAttendanceHours(input.summary.totalPermissionCoveredHours || 0) },
      { label: "إجمالي نقص الساعات", value: formatAttendanceHours(input.summary.totalMissingHours) },
      { label: "إجمالي الساعات الزائدة المكتشفة", value: formatAttendanceHours(input.summary.totalExtraHours) },
      { label: "الفترة", value: period },
    ],
    table: {
      name: "البيانات التفصيلية",
      columns: ATTENDANCE_COLUMNS,
      rows,
    },
  };
}

export function exportAttendanceReportPdf(input: Parameters<typeof buildAttendanceReportData>[0]) {
  exportReportToPdf(buildAttendanceReportData(input), "attendance-discipline-report.pdf");
}

export function exportAttendanceReportExcel(input: Parameters<typeof buildAttendanceReportData>[0]) {
  exportReportToExcel(buildAttendanceReportData(input), "attendance-discipline-report.xlsx");
}
