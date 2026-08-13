import * as XLSX from "xlsx";
import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import { exportV2FormatValue } from "./formatters";
import type { ExportV2ExtraTable, ExportV2Report, ExportV2Value } from "./types";

function safeSheetName(value: string, fallback: string) {
  const normalized = String(value || "")
    .replace(/[\\/?*\[\]:]/g, " ")
    .trim()
    .slice(0, 31);
  return normalized || fallback;
}

function configureSheet(
  sheet: XLSX.WorkSheet,
  widths: number[],
  options: { orientation?: "portrait" | "landscape"; freezeRows?: number; autoFilter?: string } = {}
) {
  sheet["!cols"] = widths.map((wch) => ({ wch: Math.max(10, Math.min(45, wch)) }));
  sheet["!pageSetup"] = {
    paperSize: 9,
    orientation: options.orientation || "landscape",
    fitToWidth: 1,
    fitToHeight: 0,
  } as never;
  sheet["!margins"] = {
    left: 0.25,
    right: 0.25,
    top: 0.45,
    bottom: 0.45,
    header: 0.18,
    footer: 0.18,
  } as never;
  sheet["!printHeader"] = ["&Lصفحة &P من &N", "&RMalikat Export V2"] as never;
  if (options.autoFilter) sheet["!autofilter"] = { ref: options.autoFilter };
  if (options.freezeRows) {
    (sheet as XLSX.WorkSheet & { "!freeze"?: { xSplit: number; ySplit: number; topLeftCell: string; activePane: string; state: string } })["!freeze"] = {
      xSplit: 0,
      ySplit: options.freezeRows,
      topLeftCell: `A${options.freezeRows + 1}`,
      activePane: "bottomLeft",
      state: "frozen",
    };
  }
}

function summaryRows<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const branding = report.branding || {};
  return [
    [report.title],
    [`${branding.salonName || "ملكات"} — ${branding.brandName || "Malikat"}`],
    ["الفترة", report.period, "رمز التقرير", report.reportCode || "—"],
    ["تاريخ التصدير", report.generatedAt, "أنشأه", report.generatedBy],
    [],
    ["الفلاتر المطبقة"],
    ...((report.filters?.length ? report.filters : [{ label: "الفلاتر", value: "بدون فلاتر إضافية" }]).map((item) => [item.label, exportV2FormatValue(item.value)])),
    [],
    ["ملخص التقرير"],
    ...report.summary.map((item) => [item.label, exportV2FormatValue(item.value, item.type)]),
    ...(report.notes?.length ? [[], ["ملاحظات"], ...report.notes.map((note) => [`• ${note}`])] : []),
  ];
}

function detailRows(
  title: string,
  period: string,
  columns: ExportV2ExtraTable["columns"],
  rows: Record<string, ExportV2Value>[],
  emptyMessage: string
) {
  const header = columns.map((column) => column.header);
  const body = rows.length
    ? rows.map((row) => columns.map((column) => exportV2FormatValue(row[column.key], column.type)))
    : [[emptyMessage]];
  return [[title], [period], [], header, ...body];
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: unknown[][], widths: number[], orientation: "portrait" | "landscape") {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  configureSheet(sheet, widths, {
    orientation,
    freezeRows: 4,
    autoFilter: rows.length > 4 && widths.length > 0
      ? `A4:${XLSX.utils.encode_col(widths.length - 1)}${rows.length}`
      : undefined,
  });
  XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(name, `Sheet${workbook.SheetNames.length + 1}`));
}

export function buildExportV2MultisheetExcelBytes<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = {
    ...(workbook.Workbook || {}),
    Views: [{ RTL: true }],
  };

  const summary = XLSX.utils.aoa_to_sheet(summaryRows(report));
  configureSheet(summary, [28, 34, 28, 34], { orientation: "portrait", freezeRows: 2 });
  XLSX.utils.book_append_sheet(workbook, summary, safeSheetName(report.summarySheetName || "الملخص", "الملخص"));

  const primaryColumns = report.columns as unknown as ExportV2ExtraTable["columns"];
  const primaryRows = report.rows as unknown as Record<string, ExportV2Value>[];
  appendSheet(
    workbook,
    report.detailsSheetName || "التفاصيل",
    detailRows(report.title, report.period, primaryColumns, primaryRows, report.emptyMessage || "لا توجد بيانات مطابقة."),
    primaryColumns.map((column) => column.width || Math.max(12, column.header.length + 6)),
    report.pdfOrientation || "landscape"
  );

  for (const table of report.extraTables || []) {
    appendSheet(
      workbook,
      table.sheetName || table.name,
      detailRows(table.name, report.period, table.columns, table.rows, table.emptyMessage || "لا توجد بيانات."),
      table.columns.map((column) => column.width || Math.max(12, column.header.length + 6)),
      report.pdfOrientation || "landscape"
    );
  }

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true }) as ArrayBuffer;
  return new Uint8Array(output);
}

export function exportReportToMultisheetExcelV2<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const bytes = buildExportV2MultisheetExcelBytes(report);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildExportV2FileName(report, "xlsx")
  );
}
