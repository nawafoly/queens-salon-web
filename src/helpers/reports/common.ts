import * as XLSX from "xlsx";

export type ReportCellValue = string | number | Date | null | undefined;

export type ReportColumn<Row extends Record<string, ReportCellValue> = Record<string, ReportCellValue>> = {
  key: string;
  header: string;
  width?: number;
};

export type ReportTable<Row extends Record<string, ReportCellValue> = Record<string, ReportCellValue>> = {
  name: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
  emptyMessage?: string;
  hideInPdf?: boolean;
};

export type ReportSummaryItem = {
  label: string;
  value: ReportCellValue;
};

export type ExportReport<Row extends Record<string, ReportCellValue> = Record<string, ReportCellValue>> = {
  title: string;
  period: string;
  generatedAt: string;
  generatedBy: string;
  salonName?: string;
  summary: ReportSummaryItem[];
  summarySheetName?: string;
  table: ReportTable<Row>;
  extraTables?: ReportTable[];
  notes?: string[];
};

const ARABIC_LOCALE = "ar-SA-u-ca-gregory-nu-latn";
const DEFAULT_SALON_NAME = "Queens Salon";

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function halalasToRiyalsNumber(value: unknown) {
  return Math.round((finiteNumber(value) / 100) * 100) / 100;
}

export function formatCurrency(value: unknown) {
  if (value == null || value === "") return "غير متوفر";
  return new Intl.NumberFormat(ARABIC_LOCALE, {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 2,
  }).format(finiteNumber(value));
}

export function formatNumber(value: unknown, options?: Intl.NumberFormatOptions) {
  if (value == null || value === "") return "غير متوفر";
  return new Intl.NumberFormat(ARABIC_LOCALE, options).format(finiteNumber(value));
}

export function formatDate(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "غير متوفر";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00+03:00`)
    : new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(ARABIC_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "غير متوفر";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(ARABIC_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "غير متوفر";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(ARABIC_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatPeriod(fromDate?: string | null, toDate?: string | null) {
  const from = String(fromDate || "").trim();
  const to = String(toDate || "").trim();
  if (from && to) return `${formatDate(from)} - ${formatDate(to)}`;
  if (from) return `من ${formatDate(from)}`;
  if (to) return `إلى ${formatDate(to)}`;
  return "غير محدد";
}

export function formatMonthPeriod(year: number, month: number) {
  return `${String(month).padStart(2, "0")}/${year}`;
}

export function currentGeneratedAt() {
  return new Date().toISOString();
}

export function normalizeGeneratedBy(value?: string | null) {
  return String(value || "").trim() || "النظام";
}

export function safeText(value: unknown, fallback = "غير متوفر") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createExcelWorkbook() {
  const workbook = XLSX.utils.book_new();
  (workbook as XLSX.WorkBook & { Workbook?: { Views?: Array<{ RTL?: boolean }> } }).Workbook = {
    Views: [{ RTL: true }],
  };
  return workbook;
}

function normalizeExcelValue(value: ReportCellValue) {
  if (value == null) return "";
  if (value instanceof Date) return formatDateTime(value.toISOString());
  return value;
}

function safeSheetName(value: string) {
  return safeText(value, "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function setWorksheetLayout(
  worksheet: XLSX.WorkSheet,
  widths: number[],
  options: { autoFilterHeaderRow?: number; freezeRows?: number } = {}
) {
  const sheet = worksheet as XLSX.WorkSheet & {
    "!cols"?: XLSX.ColInfo[];
    "!freeze"?: unknown;
    "!rtl"?: boolean;
    "!autofilter"?: { ref: string };
  };
  sheet["!cols"] = widths.map((width) => ({ wch: width }));
  sheet["!rtl"] = true;
  if (options.freezeRows) {
    sheet["!freeze"] = { xSplit: 0, ySplit: options.freezeRows };
  }
  if (worksheet["!ref"] && options.autoFilterHeaderRow != null) {
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    range.s.r = options.autoFilterHeaderRow;
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range(range) };
  }
}

function summaryRows<Row extends Record<string, ReportCellValue>>(report: ExportReport<Row>) {
  return [
    { label: "اسم الصالون", value: report.salonName || DEFAULT_SALON_NAME },
    { label: "عنوان التقرير", value: report.title },
    { label: "الفترة", value: report.period },
    { label: "تاريخ التصدير", value: formatDateTime(report.generatedAt) },
    { label: "المصدر", value: report.generatedBy },
    ...report.summary,
  ];
}

function worksheetFromSummary<Row extends Record<string, ReportCellValue>>(report: ExportReport<Row>) {
  const rows = [
    [report.salonName || DEFAULT_SALON_NAME],
    [report.title],
    [report.period],
    [],
    ["البند", "القيمة"],
    ...summaryRows(report).map((item) => [item.label, normalizeExcelValue(item.value)]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  setWorksheetLayout(worksheet, [34, 42], { autoFilterHeaderRow: 4, freezeRows: 5 });
  return worksheet;
}

function tableBodyRows<Row extends Record<string, ReportCellValue>>(table: ReportTable<Row>) {
  if (table.rows.length) {
    return table.rows.map((row) =>
      table.columns.map((column) => normalizeExcelValue(row[column.key]))
    );
  }
  if (!table.emptyMessage) return [];
  const empty = Array.from({ length: table.columns.length }, () => "");
  empty[0] = table.emptyMessage;
  return [empty];
}

function worksheetFromTable<Row extends Record<string, ReportCellValue>>(
  report: ExportReport<Row>,
  table: ReportTable<Row>
) {
  const introRows = [
    [report.salonName || DEFAULT_SALON_NAME],
    [report.title],
    [report.period],
    ["تاريخ التصدير", formatDateTime(report.generatedAt), "المصدر", report.generatedBy],
    [],
    [table.name],
  ];
  const headerRow = introRows.length;
  const rows = [
    ...introRows,
    table.columns.map((column) => column.header),
    ...tableBodyRows(table),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const widths = table.columns.map((column) =>
    column.width || Math.max(12, Math.min(34, column.header.length + 6))
  );
  setWorksheetLayout(worksheet, widths, { autoFilterHeaderRow: headerRow, freezeRows: headerRow + 1 });
  return worksheet;
}

export function buildReportExcelWorkbook<Row extends Record<string, ReportCellValue>>(
  report: ExportReport<Row>
) {
  const workbook = createExcelWorkbook();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheetFromSummary(report),
    safeSheetName(report.summarySheetName || "الملخص")
  );
  XLSX.utils.book_append_sheet(
    workbook,
    worksheetFromTable(report, report.table),
    safeSheetName(report.table.name || "التفاصيل")
  );
  for (const table of report.extraTables || []) {
    XLSX.utils.book_append_sheet(
      workbook,
      worksheetFromTable(report, table),
      safeSheetName(table.name)
    );
  }
  return workbook;
}

export function exportReportToExcel<Row extends Record<string, ReportCellValue>>(
  report: ExportReport<Row>,
  filename: string
) {
  const workbook = buildReportExcelWorkbook(report);
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename.replace(/\.xls$/i, ".xlsx")
  );
}

function escapeHtml(value: ReportCellValue) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function printableCellValue(value: ReportCellValue) {
  if (value == null || value === "") return "غير متوفر";
  if (value instanceof Date) return formatDateTime(value.toISOString());
  if (typeof value === "number") return formatNumber(value, { maximumFractionDigits: 2 });
  return String(value);
}

function renderTable<Row extends Record<string, ReportCellValue>>(table: ReportTable<Row>) {
  const rows = table.rows.length
    ? table.rows
        .map(
          (row) =>
            `<tr>${table.columns
              .map((column) => `<td>${escapeHtml(printableCellValue(row[column.key]))}</td>`)
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${table.columns.length}">${escapeHtml(table.emptyMessage || "لا توجد بيانات مطابقة للفلاتر الحالية.")}</td></tr>`;

  return `
    <section class="report-section">
      <h2>${escapeHtml(table.name)}</h2>
      <table>
        <thead>
          <tr>${table.columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

export function createPdfDocument<Row extends Record<string, ReportCellValue>>(report: ExportReport<Row>) {
  const salonName = report.salonName || DEFAULT_SALON_NAME;
  const notes = report.notes?.length
    ? `<ul class="notes">${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    @page { size: A4 landscape; margin: 11mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #202635;
      direction: rtl;
      font-family: Tahoma, "Arial", "Segoe UI", sans-serif;
      font-size: 10px;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    header {
      display: grid;
      gap: 10px;
      padding-bottom: 12px;
      border-bottom: 2px solid #8f294f;
      margin-bottom: 12px;
    }
    .brand {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .brand strong {
      display: block;
      color: #8f294f;
      font-size: 16px;
      font-weight: 900;
    }
    h1 {
      margin: 4px 0 0;
      font-size: 20px;
      line-height: 1.35;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }
    .meta span,
    .summary li {
      display: grid;
      gap: 2px;
      min-height: 39px;
      padding: 7px 8px;
      border: 1px solid #e3e7ee;
      border-radius: 6px;
      background: #f7f8fb;
    }
    em {
      color: #687185;
      font-style: normal;
      font-weight: 700;
    }
    b {
      color: #202635;
      font-weight: 900;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 7px;
      padding: 0;
      margin: 0 0 12px;
      list-style: none;
    }
    .report-section {
      margin-top: 12px;
      break-inside: auto;
    }
    h2 {
      margin: 0 0 7px;
      color: #8f294f;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      page-break-inside: auto;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th,
    td {
      padding: 5px 5px;
      border: 1px solid #dfe4ec;
      text-align: right;
      vertical-align: top;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    th {
      background: #8f294f;
      color: #fff;
      font-size: 8.5px;
      font-weight: 900;
    }
    td {
      font-size: 8.5px;
    }
    .notes {
      margin: 10px 0 0;
      padding: 8px 18px;
      border: 1px solid #e3e7ee;
      border-radius: 6px;
      background: #fff9eb;
    }
    footer {
      margin-top: 16px;
      padding-top: 9px;
      border-top: 1px solid #e3e7ee;
      color: #687185;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div>
        <strong>${escapeHtml(salonName)}</strong>
        <h1>${escapeHtml(report.title)}</h1>
      </div>
      <b>${escapeHtml(report.period)}</b>
    </div>
    <div class="meta">
      <span><em>الفترة</em><b>${escapeHtml(report.period)}</b></span>
      <span><em>تاريخ التصدير</em><b>${escapeHtml(formatDateTime(report.generatedAt))}</b></span>
      <span><em>المصدر</em><b>${escapeHtml(report.generatedBy)}</b></span>
    </div>
  </header>
  <ul class="summary">
    ${report.summary
      .map(
        (item) =>
          `<li><em>${escapeHtml(item.label)}</em><b>${escapeHtml(printableCellValue(item.value))}</b></li>`
      )
      .join("")}
  </ul>
  ${renderTable(report.table)}
  ${(report.extraTables || []).filter((table) => !table.hideInPdf).map(renderTable).join("")}
  ${notes}
  <footer>
    <span>تم إنشاء التقرير من بيانات النظام الحالية بدون تعديل أي سجلات.</span>
    <span>${escapeHtml(salonName)}</span>
  </footer>
  <script>
    window.addEventListener("load", () => {
      window.focus();
      window.setTimeout(() => window.print(), 200);
    });
  </script>
</body>
</html>`;
}

export function exportHtmlDocumentToPdf(html: string, filename: string) {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    return;
  }
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), filename.replace(/\.pdf$/i, ".html"));
}

export function exportReportToPdf<Row extends Record<string, ReportCellValue>>(
  report: ExportReport<Row>,
  filename: string
) {
  exportHtmlDocumentToPdf(createPdfDocument(report), filename);
}
