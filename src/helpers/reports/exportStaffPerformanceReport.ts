import type { StaffPerformanceResult, StaffPerformanceRow } from "../hr/staffPerformance.ts";
import {
  currentGeneratedAt,
  exportHtmlDocumentToPdf,
  exportReportToExcel,
  formatCurrency,
  formatDate,
  formatDateTime,
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

type StaffPerformanceReportInput = {
  result: StaffPerformanceResult;
  filters: StaffPerformanceReportFilters;
  generatedAt?: string;
  generatedBy?: string;
  salonName?: string;
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
  { key: "cancellationsNoShows", header: "الإلغاءات/عدم الحضور", width: 18 },
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

function escapePerformanceHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function moneyValue(value: unknown) {
  return formatCurrency(halalasToRiyalsNumber(value));
}

function optionalMoneyValue(value: number | null) {
  return value == null ? "غير متوفر" : moneyValue(value);
}

function numberText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return safeText(value);
  return number.toLocaleString("ar-SA");
}

function generatedByLabel(value?: string | null) {
  const normalized = normalizeGeneratedBy(value);
  return normalized.toLowerCase() === "system" ? "النظام" : normalized;
}

function metricCard(label: string, value: unknown, tone = "") {
  return `<div class="qs-card ${tone}"><span>${escapePerformanceHtml(label)}</span><strong>${escapePerformanceHtml(value)}</strong></div>`;
}

function detailField(label: string, value: unknown) {
  return `<div class="qs-field"><span>${escapePerformanceHtml(label)}</span><strong>${escapePerformanceHtml(value)}</strong></div>`;
}

function verticalSection(title: string, rows: Array<[string, unknown]>) {
  return `
    <section class="qs-section">
      <h2>${escapePerformanceHtml(title)}</h2>
      <div class="qs-fields">
        ${rows.map(([label, value]) => detailField(label, value)).join("")}
      </div>
    </section>
  `;
}

function rowNotes(row: StaffPerformanceRow) {
  return dataNotes(row) || row.attendance.note || "لا توجد ملاحظات";
}

function employeeSections(rows: StaffPerformanceRow[]) {
  const visibleRows = rows.slice(0, rows.length > 1 ? 6 : 1);
  const sections = visibleRows.map((row) => `
    <article class="qs-employee">
      <div class="qs-employee-head">
        <div>
          <span>الموظفة</span>
          <strong>${escapePerformanceHtml(safeText(row.employeeName))}</strong>
        </div>
        <div class="qs-grade-small">
          <span>درجة الأداء</span>
          <strong>${escapePerformanceHtml(numberText(row.performanceScore))}</strong>
        </div>
      </div>
      <div class="qs-section-grid">
        ${verticalSection("مؤشرات الأداء", [
          ["درجة الأداء", numberText(row.performanceScore)],
          ["متوسط التقييم", ratingLabel(row)],
          ["عدد التقييمات", numberText(row.ratingCount)],
          ["حالة البيانات", row.dataWarnings.length ? "تحتاج مراجعة" : "مكتملة"],
        ])}
        ${verticalSection("الإنتاجية", [
          ["الحجوزات المكتملة", numberText(row.completedBookings)],
          ["العميلات المخدومات", numberText(row.uniqueClients)],
          ["الخدمات المنفذة", numberText(row.servicesPerformed)],
          ["متوسط قيمة الخدمة", optionalMoneyValue(row.averageServiceValueHalalas)],
          ["متوسط قيمة الحجز", optionalMoneyValue(row.averageBookingValueHalalas)],
        ])}
        ${verticalSection("الحضور والانضباط", [
          ["الالتزام بالحضور", commitmentLabel(row)],
          ["أيام الحضور", numberText(row.attendance.attendanceDays)],
          ["أيام الغياب", numberText(row.attendance.absentDays)],
          ["أيام البصمة الناقصة", numberText(row.attendance.incompleteDays)],
          ["ساعات التأخير", formatAttendanceHours(row.attendance.totalLateHours)],
          ["ساعات النقص", formatAttendanceHours(row.attendance.totalMissingHours)],
        ])}
        ${verticalSection("الإيراد المنسوب", [
          ["إجمالي الإيراد المنسوب", moneyValue(row.attributedRevenueHalalas)],
          ["إلغاءات", numberText(row.cancellations)],
          ["عدم حضور", numberText(row.noShows)],
          ["القسم/الدور", safeText(row.department || row.jobTitle, "غير متوفر")],
        ])}
      </div>
      <section class="qs-section qs-note">
        <h2>الملاحظات</h2>
        <p>${escapePerformanceHtml(rowNotes(row))}</p>
      </section>
    </article>
  `).join("");

  const hiddenCount = rows.length - visibleRows.length;
  return `${sections}${hiddenCount > 0 ? `<p class="qs-muted">تم عرض أبرز ${visibleRows.length.toLocaleString("ar-SA")} موظفات فقط، والتفاصيل الكاملة متاحة من لوحة التحكم وملف إكسل.</p>` : ""}`;
}

function bookingCards(rows: StaffPerformanceRow[]) {
  const bookings = rows
    .flatMap((row) => row.bookingDetails.map((booking) => ({ ...booking, employeeName: row.employeeName })))
    .sort((left, right) => right.date.localeCompare(left.date));
  const visibleBookings = bookings.length > 20 ? bookings.slice(0, 20) : bookings;
  if (!visibleBookings.length) {
    return `<p class="qs-empty">لا توجد حجوزات مكتملة لهذه الفترة.</p>`;
  }
  return `
    <div class="qs-list">
      ${visibleBookings.map((booking) => `
        <article class="qs-list-card">
          <div class="qs-booking-focus">
            <div>
              <span>اسم العميلة</span>
              <strong>${escapePerformanceHtml(safeText(booking.clientName))}</strong>
            </div>
            <div>
              <span>الخدمة</span>
              <strong>${escapePerformanceHtml(safeText(booking.services.join("، ")))}</strong>
            </div>
          </div>
          <div class="qs-list-head">
            <strong>${escapePerformanceHtml(safeText(booking.publicId || booking.id))}</strong>
            <span>${escapePerformanceHtml(formatDate(booking.date))}</span>
          </div>
          <div class="qs-list-body">
            ${detailField("رقم الحجز", safeText(booking.publicId || booking.id))}
            ${detailField("التاريخ", formatDate(booking.date))}
            ${detailField("الإيراد", moneyValue(booking.revenueHalalas))}
            ${detailField("الموظفة", safeText(booking.employeeName))}
          </div>
        </article>
      `).join("")}
    </div>
    ${bookings.length > visibleBookings.length ? `<p class="qs-muted">تم عرض أول 20 حجزًا، والتفاصيل الكاملة متاحة في ملف Excel أو لوحة التحكم.</p>` : ""}
  `;
}

function serviceCards(rows: StaffPerformanceRow[]) {
  const services = serviceRows(rows).sort((left, right) => Number(right.count) - Number(left.count)).slice(0, 12);
  if (!services.length) {
    return `<p class="qs-empty">لا توجد خدمات منفذة في الفترة.</p>`;
  }
  return `
    <div class="qs-services">
      ${services.map((service) => `
        <article>
          <strong>${escapePerformanceHtml(safeText(service.serviceName))}</strong>
          <span>${escapePerformanceHtml(numberText(service.count))} تنفيذ</span>
          <b>${escapePerformanceHtml(moneyValue(Number(service.revenue) * 100))}</b>
        </article>
      `).join("")}
    </div>
  `;
}

function reportWarnings(input: StaffPerformanceReportInput) {
  return [
    ...input.result.warnings,
    ...(!input.result.summary.ratingAvailable ? ["التقييمات غير متوفرة في بيانات الحجوزات الحالية."] : []),
    ...(!input.result.summary.attendanceAvailable ? ["بيانات الحضور غير متوفرة لبعض أو كل الموظفات."] : []),
  ].map((item) => String(item || "").trim()).filter(Boolean);
}

export function createStaffPerformancePdfDocument(input: StaffPerformanceReportInput) {
  const rows = input.result.rows;
  const salonName = input.salonName || "Queens Salon";
  const generatedAt = input.generatedAt || currentGeneratedAt();
  const generatedBy = generatedByLabel(input.generatedBy);
  const employee = safeText(input.filters.employeeName || (rows.length === 1 ? rows[0]?.employeeName : ""), "كل الموظفات");
  const fromDate = formatDate(input.filters.fromDate);
  const toDate = formatDate(input.filters.toDate);
  const averageScore = input.result.summary.averagePerformanceScore;
  const totalServices = rows.reduce((sum, row) => sum + row.servicesPerformed, 0);
  const warnings = reportWarnings(input);
  const title = "تقرير أداء الموظفة";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapePerformanceHtml(title)} - ${escapePerformanceHtml(employee)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      direction: rtl;
      color: #202635;
      background: #fff;
      font-family: Tahoma, Arial, "Segoe UI", sans-serif;
      font-size: 10.5px;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .qs-page {
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
    }
    .qs-header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: stretch;
      padding: 10px 12px;
      border: 1px solid #ead8df;
      border-radius: 8px;
      background: #fff7fa;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qs-brand {
      color: #8f294f;
      font-size: 17px;
      font-weight: 900;
      line-height: 1.2;
    }
    h1 {
      margin: 4px 0 6px;
      color: #202635;
      font-size: 19px;
      line-height: 1.25;
    }
    .qs-subtitle {
      display: grid;
      gap: 2px;
      color: #596274;
      font-weight: 800;
    }
    .qs-grade {
      min-width: 42mm;
      padding: 9px 10px;
      border-radius: 8px;
      background: #8f294f;
      color: #fff;
      text-align: center;
    }
    .qs-grade span,
    .qs-card span,
    .qs-field span,
    .qs-employee-head span {
      display: block;
      color: #687185;
      font-size: 9px;
      font-weight: 800;
    }
    .qs-grade span { color: #ffe7f0; }
    .qs-grade strong {
      display: block;
      margin-top: 3px;
      font-size: 25px;
      line-height: 1;
    }
    .qs-meta,
    .qs-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin: 8px 0;
    }
    .qs-card,
    .qs-field {
      min-width: 0;
      padding: 6px 7px;
      border: 1px solid #e3e7ee;
      border-radius: 7px;
      background: #f8f9fb;
      overflow-wrap: anywhere;
    }
    .qs-card strong,
    .qs-field strong,
    .qs-employee-head strong {
      display: block;
      margin-top: 2px;
      color: #202635;
      font-size: 10.5px;
      font-weight: 900;
    }
    .qs-card.is-money {
      border-color: #ead8df;
      background: #fff9fb;
    }
    .qs-employee {
      margin-top: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qs-employee-head {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 8px;
      border: 1px solid #e3e7ee;
      border-radius: 8px 8px 0 0;
      background: #ffffff;
    }
    .qs-grade-small {
      min-width: 25mm;
      text-align: center;
    }
    .qs-grade-small strong {
      color: #8f294f;
      font-size: 16px;
    }
    .qs-section-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
      padding-top: 7px;
    }
    .qs-section {
      padding: 8px;
      border: 1px solid #e3e7ee;
      border-radius: 8px;
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qs-section h2 {
      margin: 0 0 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #edf0f5;
      color: #8f294f;
      font-size: 12px;
      line-height: 1.3;
    }
    .qs-fields,
    .qs-list-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .qs-note {
      margin-top: 7px;
    }
    .qs-note p,
    .qs-empty,
    .qs-muted {
      margin: 0;
      color: #596274;
      font-weight: 700;
    }
    .qs-list-section {
      margin-top: 8px;
      break-inside: auto;
    }
    .qs-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .qs-list-card {
      padding: 8px;
      border: 1px solid #e3e7ee;
      border-radius: 8px;
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qs-booking-focus {
      display: grid;
      gap: 5px;
      margin-bottom: 6px;
    }
    .qs-booking-focus div {
      padding: 7px 8px;
      border: 1px solid #ead8df;
      border-radius: 7px;
      background: #fff7fa;
    }
    .qs-booking-focus span {
      display: block;
      color: #8f294f;
      font-size: 9px;
      font-weight: 900;
    }
    .qs-booking-focus strong {
      display: block;
      margin-top: 2px;
      color: #202635;
      font-size: 12px;
      font-weight: 900;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .qs-list-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 5px;
      color: #8f294f;
      font-weight: 900;
    }
    .qs-services {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .qs-services article {
      padding: 7px;
      border: 1px solid #e3e7ee;
      border-radius: 8px;
      background: #f8f9fb;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qs-services strong,
    .qs-services span,
    .qs-services b {
      display: block;
    }
    .qs-services strong {
      color: #202635;
      font-size: 10.5px;
    }
    .qs-services span {
      margin-top: 3px;
      color: #687185;
      font-weight: 800;
    }
    .qs-services b {
      margin-top: 2px;
      color: #8f294f;
      font-size: 11px;
    }
    .qs-warnings {
      margin-top: 8px;
      padding: 8px 18px;
      border: 1px solid #f0d9a8;
      border-radius: 8px;
      background: #fff9eb;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qs-footer {
      margin-top: 7px;
      color: #7a8291;
      font-size: 9px;
      text-align: center;
    }
    @media print {
      body { width: auto; }
      .qs-page { max-width: none; }
    }
  </style>
</head>
<body>
  <main class="qs-page">
    <header class="qs-header">
      <div>
        <div class="qs-brand">${escapePerformanceHtml(salonName)}</div>
        <h1>${escapePerformanceHtml(title)}</h1>
        <div class="qs-subtitle">
          <span>اسم الموظفة: ${escapePerformanceHtml(employee)}</span>
          <span>الفترة من ${escapePerformanceHtml(fromDate)} إلى ${escapePerformanceHtml(toDate)}</span>
          <span>تاريخ التصدير: ${escapePerformanceHtml(formatDateTime(generatedAt))} | المصدر: ${escapePerformanceHtml(generatedBy)}</span>
        </div>
      </div>
      <div class="qs-grade">
        <span>التقييم العام</span>
        <strong>${escapePerformanceHtml(numberText(averageScore))}</strong>
      </div>
    </header>

    <section class="qs-summary" aria-label="ملخص سريع">
      ${metricCard("إجمالي الإيراد المنسوب", moneyValue(input.result.summary.totalAttributedRevenueHalalas), "is-money")}
      ${metricCard("عدد الخدمات المكتملة", numberText(totalServices))}
      ${metricCard("الحجوزات المكتملة", numberText(input.result.summary.totalCompletedBookings))}
      ${metricCard("عدد المواعيد بدون بيانات كافية", numberText(missingDataCount(rows)))}
      ${metricCard("عدد الموظفات حسب التقرير", numberText(rows.length))}
      ${metricCard("الموظفات النشطات", numberText(input.result.summary.activeEmployees))}
      ${metricCard("متوسط درجة الأداء", numberText(averageScore))}
      ${metricCard("حجوزات غير منسوبة", numberText(input.result.summary.unassignedCompletedBookings))}
    </section>

    ${employeeSections(rows)}

    <section class="qs-section qs-list-section">
      <h2>تفاصيل العميلات والخدمات المنفذة</h2>
      ${bookingCards(rows)}
    </section>

    <section class="qs-section qs-list-section">
      <h2>آخر الخدمات تنفيذًا</h2>
      ${serviceCards(rows)}
    </section>

    ${
      warnings.length
        ? `<ul class="qs-warnings">${warnings.map((warning) => `<li>${escapePerformanceHtml(warning)}</li>`).join("")}</ul>`
        : ""
    }

    <p class="qs-footer">تم إنشاء تقرير الأداء من بيانات النظام الحالية دون تعديل أي سجلات.</p>
  </main>
  <script>
    window.addEventListener("load", () => {
      window.focus();
      window.setTimeout(() => window.print(), 200);
    });
  </script>
</body>
</html>`;
}

export function buildStaffPerformanceReportData(input: StaffPerformanceReportInput): ExportReport<StaffPerformanceReportRow> {
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

export function exportStaffPerformanceReportPdf(input: StaffPerformanceReportInput) {
  exportHtmlDocumentToPdf(createStaffPerformancePdfDocument(input), "staff-performance-report.pdf");
}

export function exportStaffPerformanceReportExcel(input: StaffPerformanceReportInput) {
  exportReportToExcel(buildStaffPerformanceReportData(input), "staff-performance-report.xlsx");
}

export { formatCurrency, formatAttendanceHours };
