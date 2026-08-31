import { DOCUMENT_BRANDING } from "../../documents/core/documentBranding";
import {
  exportReportToMultisheetExcelV2,
  exportReportToMultitablePdfV2,
  exportV2FormatCurrency,
  exportV2FormatPeriod,
  exportV2SafeText,
  type ExportV2ExtraTable,
  type ExportV2Report,
  type ExportV2Value,
} from "../../services/exports-v2";
import type { StaffPerformanceResult, StaffPerformanceRow } from "../hr/staffPerformance.ts";
import { formatAttendanceHours } from "../hr/attendanceDiscipline.ts";

export type StaffPerformanceReportFilters = {
  fromDate?: string;
  toDate?: string;
  employeeName?: string;
  bookingStatusLabel?: string;
};

type StaffPerformanceReportInput = {
  result: StaffPerformanceResult;
  filters: StaffPerformanceReportFilters;
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
};

type StaffPerformanceReportRow = Record<string, ExportV2Value> & {
  employeeName: string;
  jobOrDepartment: string;
  completedBookings: number;
  uniqueClients: number;
  servicesPerformed: number;
  attributedRevenue: number;
  averageServiceValue: string | number;
  averageBookingValue: string | number;
  cancellationsNoShows: string;
  averageRating: string;
  attendanceCommitment: string;
  performanceScore: number;
  dataNotes: string;
};

type StaffBookingReportRow = Record<string, ExportV2Value> & {
  employeeName: string;
  bookingId: string;
  date: string;
  clientName: string;
  services: string;
  serviceCount: number;
  revenue: number;
};

type StaffServiceReportRow = Record<string, ExportV2Value> & {
  employeeName: string;
  serviceName: string;
  count: number;
  revenue: number;
};

function halalasToRiyals(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) / 100 : 0;
}

function ratingLabel(row: StaffPerformanceRow) {
  if (row.averageRating == null) return "غير متوفر";
  return `${row.averageRating.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 2 })} (${row.ratingCount.toLocaleString("ar-SA-u-nu-latn")})`;
}

function commitmentLabel(row: StaffPerformanceRow) {
  if (row.attendance.commitmentPercent == null) return "غير متوفر";
  return `${Math.round(row.attendance.commitmentPercent).toLocaleString("ar-SA-u-nu-latn")}%`;
}

function optionalMoney(value: number | null) {
  return value == null ? "غير متوفر" : halalasToRiyals(value);
}

function missingDataCount(rows: StaffPerformanceRow[]) {
  return rows.filter(
    (row) =>
      row.dataWarnings.length > 0 ||
      row.scoreNotes.length > 0 ||
      row.averageRating == null ||
      !row.attendance.available
  ).length;
}

function dataNotes(row: StaffPerformanceRow) {
  return Array.from(new Set([
    ...row.dataWarnings,
    ...row.scoreNotes,
    ...(!row.attendance.available && row.attendance.note ? [row.attendance.note] : []),
  ]))
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" | ");
}

function performanceRows(rows: StaffPerformanceRow[]): StaffPerformanceReportRow[] {
  return rows.map((row) => ({
    employeeName: exportV2SafeText(row.employeeName),
    jobOrDepartment: exportV2SafeText(row.department || row.jobTitle, "غير متوفر"),
    completedBookings: row.completedBookings,
    uniqueClients: row.uniqueClients,
    servicesPerformed: row.servicesPerformed,
    attributedRevenue: halalasToRiyals(row.attributedRevenueHalalas),
    averageServiceValue: optionalMoney(row.averageServiceValueHalalas),
    averageBookingValue: optionalMoney(row.averageBookingValueHalalas),
    cancellationsNoShows: `${row.cancellations.toLocaleString("ar-SA-u-nu-latn")} / ${row.noShows.toLocaleString("ar-SA-u-nu-latn")}`,
    averageRating: ratingLabel(row),
    attendanceCommitment: commitmentLabel(row),
    performanceScore: row.performanceScore,
    dataNotes: dataNotes(row) || "لا توجد ملاحظات",
  }));
}

function bookingRows(rows: StaffPerformanceRow[]): StaffBookingReportRow[] {
  return rows.flatMap((row) =>
    row.bookingDetails.map((booking) => ({
      employeeName: exportV2SafeText(row.employeeName),
      bookingId: exportV2SafeText(booking.publicId || booking.id),
      date: exportV2SafeText(booking.date),
      clientName: exportV2SafeText(booking.clientName),
      services: booking.services.join("، ") || "غير متوفر",
      serviceCount: booking.serviceCount,
      revenue: halalasToRiyals(booking.revenueHalalas),
    }))
  );
}

function serviceRows(rows: StaffPerformanceRow[]): StaffServiceReportRow[] {
  return rows.flatMap((row) =>
    row.topServices.map((service) => ({
      employeeName: exportV2SafeText(row.employeeName),
      serviceName: exportV2SafeText(service.serviceName),
      count: service.count,
      revenue: halalasToRiyals(service.revenueHalalas),
    }))
  );
}

function asExtraTable<Row extends Record<string, ExportV2Value>>(
  table: Omit<ExportV2ExtraTable, "columns" | "rows"> & {
    columns: Array<{ key: keyof Row & string; header: string; type?: "text" | "number" | "currency" | "date" | "datetime" | "status"; width?: number }>;
    rows: Row[];
  }
): ExportV2ExtraTable {
  return table as unknown as ExportV2ExtraTable;
}

export function buildStaffPerformanceReportData(input: StaffPerformanceReportInput): ExportV2Report<StaffPerformanceReportRow> {
  const rows = input.result.rows;
  const period = exportV2FormatPeriod(input.filters.fromDate, input.filters.toDate);
  const employee = exportV2SafeText(input.filters.employeeName, "كل الموظفات");
  const bookingStatus = exportV2SafeText(input.filters.bookingStatusLabel, "الحجوزات المكتملة");
  const bookings = bookingRows(rows);
  const services = serviceRows(rows);

  const extraTables: ExportV2ExtraTable[] = [
    asExtraTable<StaffBookingReportRow>({
      name: "تفاصيل العميلات والحجوزات",
      sheetName: "الحجوزات المنسوبة",
      columns: [
        { key: "employeeName", header: "الموظفة", width: 22 },
        { key: "bookingId", header: "رقم الحجز", width: 18 },
        { key: "date", header: "التاريخ", width: 15 },
        { key: "clientName", header: "العميلة", width: 22 },
        { key: "services", header: "الخدمات", width: 34 },
        { key: "serviceCount", header: "عدد الخدمات", type: "number", width: 14 },
        { key: "revenue", header: "الإيراد", type: "currency", width: 16 },
      ],
      rows: bookings,
      emptyMessage: "لا توجد حجوزات منسوبة في الفترة المحددة.",
    }),
    asExtraTable<StaffServiceReportRow>({
      name: "الخدمات المنفذة",
      sheetName: "الخدمات المنفذة",
      columns: [
        { key: "employeeName", header: "الموظفة", width: 22 },
        { key: "serviceName", header: "الخدمة", width: 30 },
        { key: "count", header: "عدد التنفيذ", type: "number", width: 14 },
        { key: "revenue", header: "الإيراد", type: "currency", width: 16 },
      ],
      rows: services,
      emptyMessage: "لا توجد خدمات منفذة في الفترة المحددة.",
    }),
  ];

  return {
    slug: "staff-performance-report",
    reportCode: "STAFF-PERFORMANCE",
    title: "تقرير أداء الموظفات",
    subtitle: `${employee} — ${bookingStatus}`,
    summarySheetName: "ملخص الأداء",
    detailsSheetName: "أداء الموظفات",
    period,
    dateRange: {
      from: input.filters.fromDate || null,
      to: input.filters.toDate || null,
    },
    generatedAt: input.generatedAt || new Date().toISOString(),
    generatedBy: exportV2SafeText(input.generatedBy, "النظام"),
    branding: {
      salonName: input.salonName || DOCUMENT_BRANDING.salonName,
      brandName: DOCUMENT_BRANDING.brandName,
      logoUrl: DOCUMENT_BRANDING.printLogoSource,
    },
    filters: [
      { label: "الموظفة", value: employee },
      { label: "حالة الحجز", value: bookingStatus },
      { label: "الفترة", value: period },
    ],
    summary: [
      { label: "عدد الموظفات", value: rows.length, type: "number", tone: "dark" },
      { label: "الموظفات النشطات", value: input.result.summary.activeEmployees, type: "number", tone: "success" },
      { label: "الحجوزات المكتملة", value: input.result.summary.totalCompletedBookings, type: "number", tone: "gold" },
      { label: "الإيراد المنسوب", value: halalasToRiyals(input.result.summary.totalAttributedRevenueHalalas), type: "currency", tone: "success" },
      { label: "متوسط درجة الأداء", value: input.result.summary.averagePerformanceScore, type: "number", tone: "dark" },
      { label: "حجوزات غير منسوبة", value: input.result.summary.unassignedCompletedBookings, type: "number", tone: "danger" },
      { label: "موظفات ببيانات ناقصة", value: missingDataCount(rows), type: "number", tone: "gold" },
      { label: "عدد الخدمات المنفذة", value: rows.reduce((sum, row) => sum + row.servicesPerformed, 0), type: "number", tone: "neutral" },
    ],
    columns: [
      { key: "employeeName", header: "الموظفة", width: 22 },
      { key: "jobOrDepartment", header: "الوظيفة/القسم", width: 20 },
      { key: "completedBookings", header: "الحجوزات المكتملة", type: "number", width: 15 },
      { key: "uniqueClients", header: "العميلات المخدومات", type: "number", width: 15 },
      { key: "servicesPerformed", header: "الخدمات المنفذة", type: "number", width: 15 },
      { key: "attributedRevenue", header: "الإيراد المنسوب", type: "currency", width: 17 },
      { key: "averageServiceValue", header: "متوسط قيمة الخدمة", width: 18 },
      { key: "averageBookingValue", header: "متوسط قيمة الحجز", width: 18 },
      { key: "cancellationsNoShows", header: "الإلغاءات/عدم الحضور", width: 17 },
      { key: "averageRating", header: "متوسط التقييم", width: 16 },
      { key: "attendanceCommitment", header: "الالتزام بالحضور", width: 16 },
      { key: "performanceScore", header: "درجة الأداء", type: "number", width: 14 },
      { key: "dataNotes", header: "ملاحظات البيانات", width: 28 },
    ],
    rows: performanceRows(rows),
    extraTables,
    emptyMessage: "لا توجد بيانات أداء مطابقة للفلاتر الحالية.",
    notes: [
      ...input.result.warnings,
      ...(!input.result.summary.ratingAvailable ? ["التقييمات غير متوفرة في بيانات الحجوزات الحالية."] : []),
      ...(!input.result.summary.attendanceAvailable ? ["بيانات الحضور غير متوفرة لبعض أو كل الموظفات."] : []),
      "PDF وExcel يستخدمان نموذج بيانات موحدًا، وتشمل النسخ تفاصيل الحجوزات والخدمات المنفذة.",
    ],
    pdfOrientation: "landscape",
  };
}

export function exportStaffPerformanceReportPdf(input: StaffPerformanceReportInput) {
  return exportReportToMultitablePdfV2(buildStaffPerformanceReportData(input));
}

export function exportStaffPerformanceReportExcel(input: StaffPerformanceReportInput) {
  exportReportToMultisheetExcelV2(buildStaffPerformanceReportData(input));
}

export function formatCurrency(value: unknown) {
  return exportV2FormatCurrency(value);
}

export { formatAttendanceHours };
