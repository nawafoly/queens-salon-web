import { DOCUMENT_BRANDING } from "../../documents/core/documentBranding";
import {
  exportReportToExcelV2,
  exportReportToPdfV2,
  exportV2FormatDate,
  exportV2FormatPeriod,
  exportV2SafeText,
  type ExportV2Column,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";
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

type AttendanceReportRow = Record<string, ExportV2Value> & {
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

const ATTENDANCE_COLUMNS: ExportV2Column<AttendanceReportRow>[] = [
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
  { key: "statusLabel", header: "الحالة الإدارية", width: 20, type: "status" },
  { key: "systemNotes", header: "ملاحظات النظام", width: 24 },
];

function formatTime(value?: string) {
  const text = String(value || "").trim();
  if (!text) return "غير متوفر";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizedGeneratedBy(value?: string) {
  return String(value || "").trim() || "النظام";
}

export function buildAttendanceReportData(input: {
  rows: AttendanceReportRowInput[];
  summary: AttendanceDisciplineMonthSummary;
  filters: AttendanceReportFilters;
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
}): ExportV2Report<AttendanceReportRow> {
  const period = exportV2FormatPeriod(input.filters.fromDate, input.filters.toDate);
  const employeeCount = new Set(input.rows.map((row) => row.employeeId || row.employeeName).filter(Boolean)).size;
  const rows = input.rows.map<AttendanceReportRow>((row) => ({
    employeeName: exportV2SafeText(row.employeeName),
    date: exportV2FormatDate(row.date),
    shiftLabel: [exportV2SafeText(row.shiftLabel), row.scheduleNote].filter(Boolean).join(" - "),
    firstCheckInAt: formatTime(row.firstCheckInAt),
    lastCheckOutAt: formatTime(row.lastCheckOutAt),
    actualWorkedHours: formatAttendanceHours(row.summary.actualWorkedHours),
    lateHours: formatAttendanceHours(row.summary.lateHours),
    compensatedLateHours: formatAttendanceHours(row.summary.compensatedLateHours),
    permissionCoveredHours: formatAttendanceHours(row.summary.permissionCoveredHours || 0),
    missingHours: formatAttendanceHours(row.summary.missingHours),
    extraHours: formatAttendanceHours(row.summary.extraHours),
    netHourDifference: formatSignedAttendanceHours(row.summary.netHourDifference),
    statusLabel: exportV2SafeText(row.summary.statusLabel),
    systemNotes: exportV2SafeText(row.scheduleNote, ""),
  }));

  return {
    slug: "attendance-discipline-report",
    reportCode: "ATTENDANCE-DISCIPLINE",
    title: "تقرير الحضور والانضباط",
    subtitle: "تقرير تشغيلي من بيانات الحضور والانضباط المعتمدة",
    summarySheetName: "ملخص الحضور",
    detailsSheetName: "بيانات الحضور",
    period,
    dateRange: {
      from: input.filters.fromDate || null,
      to: input.filters.toDate || null,
    },
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: normalizedGeneratedBy(input.generatedBy),
    branding: {
      salonName: input.salonName || DOCUMENT_BRANDING.salonName,
      brandName: DOCUMENT_BRANDING.brandName,
      logoUrl: DOCUMENT_BRANDING.printLogoSource,
    },
    filters: [
      { label: "من تاريخ", value: input.filters.fromDate ? exportV2FormatDate(input.filters.fromDate) : "كل التواريخ" },
      { label: "إلى تاريخ", value: input.filters.toDate ? exportV2FormatDate(input.filters.toDate) : "كل التواريخ" },
      { label: "البحث", value: input.filters.search || "بدون بحث" },
    ],
    summary: [
      { label: "عدد الموظفات في التقرير", value: employeeCount, type: "number", tone: "dark" },
      { label: "عدد أيام الحضور", value: input.summary.attendanceDays, type: "number", tone: "success" },
      { label: "إجمالي ساعات العمل الفعلية", value: formatAttendanceHours(input.summary.totalActualWorkedHours), tone: "neutral" },
      { label: "إجمالي التأخير", value: formatAttendanceHours(input.summary.totalLateHours), tone: "gold" },
      { label: "إجمالي الاستئذان المحتسب", value: formatAttendanceHours(input.summary.totalPermissionCoveredHours || 0), tone: "neutral" },
      { label: "إجمالي نقص الساعات", value: formatAttendanceHours(input.summary.totalMissingHours), tone: "danger" },
      { label: "إجمالي الساعات الزائدة المكتشفة", value: formatAttendanceHours(input.summary.totalExtraHours), tone: "success" },
      { label: "الفترة", value: period, tone: "neutral" },
    ],
    columns: ATTENDANCE_COLUMNS,
    rows,
    emptyMessage: "لا توجد بيانات حضور مطابقة للفلاتر الحالية.",
    notes: [
      "تم إنشاء التقرير من بيانات الحضور والانضباط الحالية دون تعديل أي سجل.",
      "ملف PDF وملف Excel يستخدمان نفس نموذج البيانات التشغيلي.",
    ],
    pdfOrientation: "landscape",
  };
}

export function exportAttendanceReportPdf(input: Parameters<typeof buildAttendanceReportData>[0]) {
  return exportReportToPdfV2(buildAttendanceReportData(input));
}

export function exportAttendanceReportExcel(input: Parameters<typeof buildAttendanceReportData>[0]) {
  exportReportToExcelV2(buildAttendanceReportData(input));
}
