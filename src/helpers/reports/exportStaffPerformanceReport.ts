import type { StaffPerformanceResult, StaffPerformanceRow } from "../hr/staffPerformance.ts";
import {
  currentGeneratedAt,
  exportReportToExcel,
  exportReportToPdf,
  formatCurrency,
  formatPeriod,
  halalasToRiyalsNumber,
  normalizeGeneratedBy,
  safeText,
  type ExportReport,
  type ReportColumn,
  type ReportTable,
} from "./common.ts";
import { formatAttendanceHours } from "../hr/attendanceDiscipline.ts";

type StaffPerformanceReportRow = {
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

type StaffBookingReportRow = {
  employeeName: string;
  bookingId: string;
  date: string;
  clientName: string;
  services: string;
  serviceCount: number;
  revenue: number;
};

type StaffServiceReportRow = {
  employeeName: string;
  serviceName: string;
  count: number;
  revenue: number;
};

export type StaffPerformanceReportFilters = {
  fromDate?: string;
  toDate?: string;
  employeeName?: string;
  bookingStatusLabel?: string;
};

const PERFORMANCE_COLUMNS: ReportColumn<StaffPerformanceReportRow>[] = [
  { key: "employeeName", header: "الموظفة", width: 24 },
  { key: "jobOrDepartment", header: "الوظيفة/القسم", width: 22 },
  { key: "completedBookings", header: "الحجوزات المكتملة", width: 18 },
  { key: "uniqueClients", header: "العميلات المخدومات", width: 18 },
  { key: "servicesPerformed", header: "الخدمات المنفذة", width: 18 },
  { key: "attributedRevenue", header: "الإيراد المنسوب", width: 18 },
  { key: "averageServiceValue", header: "متوسط قيمة الخدمة", width: 20 },
  { key: "averageBookingValue", header: "متوسط قيمة الحجز", width: 20 },
  { key: "cancellationsNoShows", header: "الإلغاءات/no-show", width: 18 },
  { key: "averageRating", header: "متوسط التقييم", width: 18 },
  { key: "attendanceCommitment", header: "الالتزام بالحضور", width: 18 },
  { key: "performanceScore", header: "درجة الأداء", width: 14 },
  { key: "dataNotes", header: "ملاحظات نقص البيانات", width: 30 },
];

const BOOKING_COLUMNS: ReportColumn<StaffBookingReportRow>[] = [
  { key: "employeeName", header: "الموظفة", width: 24 },
  { key: "bookingId", header: "رقم الحجز", width: 18 },
  { key: "date", header: "التاريخ", width: 16 },
  { key: "clientName", header: "العميلة", width: 22 },
  { key: "services", header: "الخدمات", width: 34 },
  { key: "serviceCount", header: "عدد الخدمات", width: 14 },
  { key: "revenue", header: "الإيراد", width: 16 },
];

const SERVICE_COLUMNS: ReportColumn<StaffServiceReportRow>[] = [
  { key: "employeeName", header: "الموظفة", width: 24 },
  { key: "serviceName", header: "الخدمة", width: 30 },
  { key: "count", header: "عدد التنفيذ", width: 14 },
  { key: "revenue", header: "الإيراد", width: 16 },
];

function ratingLabel(row: StaffPerformanceRow) {
  if (row.averageRating == null) return "غير متوفر";
  return `${row.averageRating} (${row.ratingCount})`;
}

function commitmentLabel(row: StaffPerformanceRow) {
  if (row.attendance.commitmentPercent == null) return "غير متوفر";
  return `${Math.round(row.attendance.commitmentPercent)}%`;
}

function optionalMoney(value: number | null) {
  return value == null ? "غير متوفر" : halalasToRiyalsNumber(value);
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
  return Array.from(new Set([...row.dataWarnings, ...row.scoreNotes]))
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" | ");
}

function performanceRows(rows: StaffPerformanceRow[]): StaffPerformanceReportRow[] {
  return rows.map((row) => ({
    employeeName: safeText(row.employeeName),
    jobOrDepartment: safeText(row.department || row.jobTitle, "غير متوفر"),
    completedBookings: row.completedBookings,
    uniqueClients: row.uniqueClients,
    servicesPerformed: row.servicesPerformed,
    attributedRevenue: halalasToRiyalsNumber(row.attributedRevenueHalalas),
    averageServiceValue: optionalMoney(row.averageServiceValueHalalas),
    averageBookingValue: optionalMoney(row.averageBookingValueHalalas),
    cancellationsNoShows: `${row.cancellations} / ${row.noShows}`,
    averageRating: ratingLabel(row),
    attendanceCommitment: commitmentLabel(row),
    performanceScore: row.performanceScore,
    dataNotes: dataNotes(row) || "لا توجد ملاحظات",
  }));
}

function bookingRows(rows: StaffPerformanceRow[]): StaffBookingReportRow[] {
  return rows.flatMap((row) =>
    row.bookingDetails.map((booking) => ({
      employeeName: safeText(row.employeeName),
      bookingId: safeText(booking.publicId || booking.id),
      date: safeText(booking.date),
      clientName: safeText(booking.clientName),
      services: booking.services.join("، "),
      serviceCount: booking.serviceCount,
      revenue: halalasToRiyalsNumber(booking.revenueHalalas),
    }))
  );
}

function serviceRows(rows: StaffPerformanceRow[]): StaffServiceReportRow[] {
  return rows.flatMap((row) =>
    row.topServices.map((service) => ({
      employeeName: safeText(row.employeeName),
      serviceName: safeText(service.serviceName),
      count: service.count,
      revenue: halalasToRiyalsNumber(service.revenueHalalas),
    }))
  );
}

function extraTables(rows: StaffPerformanceRow[]): ReportTable[] {
  const bookings = bookingRows(rows);
  const services = serviceRows(rows);
  return [
    bookings.length
      ? {
          name: "الحجوزات المنسوبة",
          columns: BOOKING_COLUMNS,
          rows: bookings,
        }
      : null,
    services.length
      ? {
          name: "أكثر الخدمات تنفيذًا",
          columns: SERVICE_COLUMNS,
          rows: services,
        }
      : null,
  ].filter(Boolean) as ReportTable[];
}

export function buildStaffPerformanceReportData(input: {
  result: StaffPerformanceResult;
  filters: StaffPerformanceReportFilters;
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
}): ExportReport<StaffPerformanceReportRow> {
  const period = formatPeriod(input.filters.fromDate, input.filters.toDate);
  const employee = safeText(input.filters.employeeName, "كل الموظفات");
  const status = safeText(input.filters.bookingStatusLabel, "الحجوزات المكتملة");
  const rows = input.result.rows;
  return {
    title: "تقرير أداء الموظفات",
    period: `${period} - ${employee} - ${status}`,
    generatedAt: input.generatedAt || currentGeneratedAt(),
    generatedBy: normalizeGeneratedBy(input.generatedBy),
    salonName: input.salonName,
    summary: [
      { label: "الفترة", value: period },
      { label: "عدد الموظفات", value: rows.length },
      { label: "إجمالي الحجوزات المكتملة", value: input.result.summary.totalCompletedBookings },
      {
        label: "إجمالي الإيراد المنسوب",
        value: halalasToRiyalsNumber(input.result.summary.totalAttributedRevenueHalalas),
      },
      { label: "متوسط درجة الأداء", value: input.result.summary.averagePerformanceScore },
      { label: "عدد الموظفات بدون بيانات كافية", value: missingDataCount(rows) },
    ],
    table: {
      name: "البيانات التفصيلية",
      columns: PERFORMANCE_COLUMNS,
      rows: performanceRows(rows),
    },
    extraTables: extraTables(rows),
    notes: [
      ...input.result.warnings,
      ...(!input.result.summary.ratingAvailable ? ["التقييمات غير متوفرة في بيانات الحجوزات الحالية."] : []),
      ...(!input.result.summary.attendanceAvailable ? ["بيانات الحضور غير متوفرة لبعض أو كل الموظفات."] : []),
    ],
  };
}

export function exportStaffPerformanceReportPdf(input: Parameters<typeof buildStaffPerformanceReportData>[0]) {
  exportReportToPdf(buildStaffPerformanceReportData(input), "staff-performance-report.pdf");
}

export function exportStaffPerformanceReportExcel(input: Parameters<typeof buildStaffPerformanceReportData>[0]) {
  exportReportToExcel(buildStaffPerformanceReportData(input), "staff-performance-report.xlsx");
}

export { formatCurrency, formatAttendanceHours };
