import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import type { ExportV2Column, ExportV2Report, ExportV2Value } from "./types";

type Cell = {
  ref: string;
  value?: ExportV2Value;
  style: number;
  formula?: string;
};

type Row = { index: number; height?: number; cells: Cell[] };
type Sheet = {
  name: string;
  rows: Row[];
  merges: string[];
  widths: number[];
  hiddenColumns?: number[];
  freezeRows?: number;
  freezeColumns?: number;
  autoFilter?: string;
  repeatRows?: string;
  printArea?: string;
  orientation?: "portrait" | "landscape";
  tabColor?: string;
  zoom?: number;
};

const C = {
  navy: "0B1F33",
  navy2: "123A55",
  ink: "172033",
  white: "FFFFFF",
  gold: "C7A14A",
  goldText: "9B741C",
  paleGold: "FBF6E8",
  green: "2F855A",
  paleGreen: "EDF7F1",
  red: "B54747",
  paleRed: "FAEFF0",
  blue: "507FA8",
  paleBlue: "EFF5FA",
  orange: "C97A20",
  paleOrange: "FFF4E8",
  border: "D8DFE8",
  meta: "EEF3F8",
  soft: "F7F9FC",
  soft2: "FBFCFE",
  muted: "667085",
};

const S = {
  plain: 0,
  brand: 1,
  title: 2,
  subtitle: 3,
  section: 4,
  metaLabel: 5,
  metaValue: 6,
  dateValue: 7,
  kpiGoldLabel: 8,
  kpiGoldValue: 9,
  kpiGreenLabel: 10,
  kpiGreenValue: 11,
  kpiRedLabel: 12,
  kpiRedValue: 13,
  kpiBlueLabel: 14,
  kpiBlueValue: 15,
  header: 16,
  text: 17,
  textAlt: 18,
  currency: 19,
  currencyAlt: 20,
  currencyGreen: 21,
  currencyRed: 22,
  totalLabel: 23,
  totalCurrency: 24,
  statusGood: 25,
  statusDraft: 26,
  statusBad: 27,
  statusExempt: 28,
  note: 29,
  footer: 30,
  kpiNumber: 31,
  hours: 32,
  hoursAlt: 33,
  number: 34,
  numberAlt: 35,
  reviewStatusBad: 36,
} as const;

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function col(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function ref(column: number, row: number) {
  return `${col(column)}${row}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localizedNumber(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternDigits = "۰۱۲۳۴۵۶۷۸۹";
  let normalized = raw
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternDigits.indexOf(digit)))
    .replace(/٬/g, "")
    .replace(/٫/g, ".")
    .replace(/\s+/g, "");

  const commaCount = (normalized.match(/,/g) || []).length;
  if (!normalized.includes(".") && commaCount === 1 && /,\d{1,3}(?:\D|$)/.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHourColumn(key: unknown) {
  return ["scheduledHours", "actualWorkedHours", "missingHours"].includes(String(key));
}

function isTotalableDetailColumn(
  column: ExportV2Column<Record<string, ExportV2Value>>
) {
  return (
    column.type === "number" ||
    column.type === "currency" ||
    isHourColumn(column.key)
  );
}

function clean(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeSheetName(value: string, fallback: string) {
  return String(value || fallback).replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || fallback;
}

function excelSerial(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed / 86400000 + 25569 : 0;
}

function filterValue(report: ExportV2Report<Record<string, ExportV2Value>>, labelPart: string, fallback = "—") {
  return clean(report.filters?.find((item) => item.label.includes(labelPart))?.value, fallback);
}

function monthYearLabel(report: ExportV2Report<Record<string, ExportV2Value>>) {
  const source = report.dateRange?.from || report.dateRange?.to;
  if (!source) return report.period;
  const date = new Date(`${source}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return report.period;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function netLabel(report: ExportV2Report<Record<string, ExportV2Value>>) {
  const statuses = report.rows.map((row) => clean(row.status, ""));
  const locked = statuses.length > 0 && statuses.every((status) => status.includes("معتمد") || status.includes("مدفوع"));
  return locked ? "الصافي المعتمد" : "الصافي المتوقع";
}

function statusStyle(value: unknown) {
  const text = clean(value, "");
  if (text.includes("غير") || text.includes("مستبعد") || text.includes("ناقص") || text.includes("مرفوض")) return S.statusBad;
  if (text.includes("معفى")) return S.statusExempt;
  if (text.includes("مكتمل") || text.includes("مؤكد") || text.includes("معتمد") || text.includes("مدفوع")) return S.statusGood;
  if (text.includes("مسودة")) return S.statusDraft;
  return S.text;
}

function reviewStatusStyle(value: unknown) {
  const text = clean(value, "");
  if (text.includes("مستبعد") || text.includes("غير مكتمل") || text.includes("مرفوض")) return S.reviewStatusBad;
  return statusStyle(value);
}

function cellXml(cell: Cell) {
  if (cell.formula) {
    return `<c r="${cell.ref}" t="n" s="${cell.style}"><f>${xmlEscape(cell.formula)}</f><v>${numberValue(cell.value)}</v></c>`;
  }
  if (typeof cell.value === "number") {
    return `<c r="${cell.ref}" t="n" s="${cell.style}"><v>${numberValue(cell.value)}</v></c>`;
  }
  return `<c r="${cell.ref}" t="inlineStr" s="${cell.style}"><is><t xml:space="preserve">${xmlEscape(clean(cell.value, ""))}</t></is></c>`;
}

function mergedCells(row: number, startCol: number, endCol: number, value: ExportV2Value, style: number, formula?: string) {
  const cells: Cell[] = [];
  for (let index = startCol; index <= endCol; index += 1) {
    cells.push({
      ref: ref(index, row),
      value: index === startCol ? value : "",
      style,
      formula: index === startCol ? formula : undefined,
    });
  }
  return cells;
}

function renderSheet(sheet: Sheet) {
  const maxRow = Math.max(1, ...sheet.rows.map((row) => row.index));
  const maxCol = Math.max(1, sheet.widths.length);
  const pane = sheet.freezeRows || sheet.freezeColumns
    ? `<pane${sheet.freezeColumns ? ` xSplit="${sheet.freezeColumns}"` : ""}${sheet.freezeRows ? ` ySplit="${sheet.freezeRows}"` : ""} topLeftCell="${col(sheet.freezeColumns || 0)}${(sheet.freezeRows || 0) + 1}" activePane="${sheet.freezeRows && sheet.freezeColumns ? "bottomRight" : sheet.freezeRows ? "bottomLeft" : "topRight"}" state="frozen"/>`
    : "";
  const rows = sheet.rows.map((row) => `<row r="${row.index}"${row.height ? ` ht="${row.height}" customHeight="1"` : ""}>${row.cells.map(cellXml).join("")}</row>`).join("");
  const merges = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((item) => `<mergeCell ref="${item}"/>`).join("")}</mergeCells>`
    : "";
  const hidden = new Set(sheet.hiddenColumns || []);
  const widths = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(2, width)}" customWidth="1"${hidden.has(index) ? ` hidden="1"` : ""}/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><tabColor rgb="${sheet.tabColor || C.green}"/><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${ref(maxCol - 1, maxRow)}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0" zoomScale="${sheet.zoom || 82}" zoomScaleNormal="${sheet.zoom || 82}">${pane}<selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${widths}</cols>
  <sheetData>${rows}</sheetData>
  ${sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : ""}
  ${merges}
  <printOptions horizontalCentered="1" verticalCentered="0" headings="0" gridLines="0"/>
  <pageMargins left="0.2" right="0.2" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>
  <pageSetup orientation="${sheet.orientation || "landscape"}" fitToWidth="1" fitToHeight="0" paperSize="9"/>
  <headerFooter><oddFooter>&amp;Lصفحة &amp;P من &amp;N&amp;Rمَلِكات — مسيرة رواتب رسمية</oddFooter></headerFooter>
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="5">
    <numFmt numFmtId="164" formatCode="#\,##0.00 &quot;ر.س&quot;;[Red]-#\,##0.00 &quot;ر.س&quot;;0.00 &quot;ر.س&quot;"/>
    <numFmt numFmtId="165" formatCode="#\,##0.##;[Red]-#\,##0.##;0"/>
    <numFmt numFmtId="166" formatCode="yyyy/mm/dd"/>
    <numFmt numFmtId="167" formatCode="yyyy/mm/dd hh:mm"/>
    <numFmt numFmtId="168" formatCode="0.## &quot;ساعة&quot;"/>
  </numFmts>
  <fonts count="13">
    <font><sz val="10"/><color rgb="${C.ink}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${C.gold}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="22"/><color rgb="${C.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="DCE6F1"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="${C.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${C.ink}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.goldText}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.green}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.red}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.navy}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${C.muted}"/><name val="Tahoma"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="${C.muted}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${C.red}"/><name val="Tahoma"/><family val="2"/></font>
  </fonts>
  <fills count="12">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.white}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.navy}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.navy2}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.meta}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.soft}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.paleGold}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.paleGreen}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.paleRed}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.paleBlue}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${C.paleOrange}"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="${C.border}"/></left><right style="thin"><color rgb="${C.border}"/></right><top style="thin"><color rgb="${C.border}"/></top><bottom style="thin"><color rgb="${C.border}"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="${C.gold}"/></left><right style="thin"><color rgb="${C.gold}"/></right><top style="thin"><color rgb="${C.gold}"/></top><bottom style="thin"><color rgb="${C.gold}"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs>
  <cellXfs count="37">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment readingOrder="2" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="5" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="6" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="8" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="7" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="9" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="8" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="10" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="9" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="5" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="5" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="7" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="8" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="2" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="9" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="8" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="11" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="9" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="10" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="11" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="165" fontId="9" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="168" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="168" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="12" fillId="9" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1" shrinkToFit="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function visibleDetailColumns(report: ExportV2Report<Record<string, ExportV2Value>>) {
  const hasCarryover = report.rows.some((row) => Math.abs(numberValue(row.previousPeriodAdjustment)) > 0.00001);
  return report.columns.filter((column) => column.key !== "previousPeriodAdjustment" || hasCarryover);
}

function detailWidth(column: ExportV2Column<Record<string, ExportV2Value>>) {
  const map: Record<string, number> = {
    employeeName: 26,
    jobTitle: 22,
    setupStatus: 22,
    attendanceStatus: 24,

    baseSalary: 24,
    contractualAllowances: 24,

    attendanceDays: 12,
    absentDays: 12,
    incompleteDays: 14,
    scheduledHours: 18,
    actualWorkedHours: 18,
    missingHours: 18,

    absenceDeduction: 22,
    missingHoursDeduction: 24,
    deferredAttendanceDeduction: 28,
    deferredAttendanceTargetMonth: 20,

    overtimeStatus: 18,
    overtimeValue: 22,

    additions: 24,
    leaveCompensation: 24,

    employeeGosiRate: 18,
    insuranceDeduction: 24,
    employerGosiRate: 20,
    employerGosiContribution: 26,

    carriedAttendanceDeduction: 30,
    otherScheduledDeductions: 26,
    advanceDeductions: 22,
    manualDeductions: 24,
    unclassifiedDeductions: 26,

    deductions: 26,
    previousPeriodAdjustment: 26,
    expectedNet: 28,

    status: 18,
    notes: 48,
  };

  const explicit = map[String(column.key)];
  if (explicit) return explicit;

  const configured = Number(column.width || 14);

  if (column.type === "currency") {
    return Math.max(24, Math.min(32, configured));
  }

  if (column.type === "number") {
    return Math.max(16, Math.min(24, configured));
  }

  if (column.type === "status") {
    return Math.max(18, Math.min(28, configured));
  }

  return Math.max(14, Math.min(32, configured));
}

function detailStyle(column: ExportV2Column<Record<string, ExportV2Value>>, value: ExportV2Value, row: number) {
  if (isHourColumn(column.key) && localizedNumber(value) != null) {
    return row % 2 ? S.hours : S.hoursAlt;
  }
  if (column.type === "number") {
    return row % 2 ? S.number : S.numberAlt;
  }
  if (column.type === "currency") {
    if (column.key === "deductions" || String(column.key).includes("Deduction") || String(column.key).includes("deduction")) return S.currencyRed;
    if (column.key === "expectedNet") return S.currencyGreen;
    if (column.key === "previousPeriodAdjustment") return numberValue(value) < 0 ? S.currencyRed : numberValue(value) > 0 ? S.currencyGreen : (row % 2 ? S.currency : S.currencyAlt);
    if (column.key === "additions") return numberValue(value) > 0 ? S.currencyGreen : (row % 2 ? S.currency : S.currencyAlt);
    if (column.key === "leaveCompensation") return numberValue(value) > 0 ? S.currencyGreen : (row % 2 ? S.currency : S.currencyAlt);
    return row % 2 ? S.currency : S.currencyAlt;
  }
  if (column.type === "status" || column.key === "setupStatus" || column.key === "attendanceStatus" || column.key === "status") return statusStyle(value);
  if (column.key === "notes") return S.note;
  return row % 2 ? S.text : S.textAlt;
}

function buildUnifiedPayrollSheet(report: ExportV2Report<Record<string, ExportV2Value>>): Sheet {
  const detailColumns = visibleDetailColumns(report);
  const visibleColumnCount = Math.max(21, detailColumns.length);
  const visibleLast = col(visibleColumnCount - 1);
  const hasCarryover = detailColumns.some((column) => column.key === "previousPeriodAdjustment");
  const helperColIndex = visibleColumnCount;
  const helperCol = col(helperColIndex);
  const rows: Row[] = [];
  const merges: string[] = [];

  const addMerged = (row: number, start: number, end: number, value: ExportV2Value, style: number, formula?: string, height?: number) => {
    rows.push({ index: row, height, cells: mergedCells(row, start, end, value, style, formula) });
    if (start !== end) merges.push(`${ref(start, row)}:${ref(end, row)}`);
  };
  const addMergedToExistingRow = (target: Row, row: number, start: number, end: number, value: ExportV2Value, style: number, formula?: string) => {
    target.cells.push(...mergedCells(row, start, end, value, style, formula));
    if (start !== end) merges.push(`${ref(start, row)}:${ref(end, row)}`);
  };

  const monthLabel = monthYearLabel(report);
  addMerged(1, 0, visibleColumnCount - 1, `${report.branding?.salonName || "مَلِكات"}  |  MALIKAT`, S.brand, undefined, 34);
  addMerged(2, 0, visibleColumnCount - 1, "مسيرة الرواتب الشهرية", S.title, undefined, 42);
  addMerged(3, 0, visibleColumnCount - 1, `تقرير تنفيذي وتشغيلي موحّد — ${monthLabel}`, S.subtitle, undefined, 26);
  rows.push({ index: 4, height: 5, cells: mergedCells(4, 0, visibleColumnCount - 1, "", S.plain) });

  const metaRows = [5, 6, 7];
  const metadata = [
    ["الفترة من", report.dateRange?.from || "", "إلى", report.dateRange?.to || "", "تاريخ الإنشاء", report.generatedAt],
    ["رمز التقرير", report.reportCode || "HR-PAYROLL", "تاريخ الصرف المتوقع", filterValue(report, "تاريخ الصرف", "غير محدد"), "أنشأه", report.generatedBy || "إدارة الرواتب"],
    ["فلتر الموظفة", filterValue(report, "الموظفة", "كل الموظفات"), "حالة الراتب", filterValue(report, "حالة الراتب", "كل الحالات"), "نطاق التصدير", filterValue(report, "نطاق التصدير", "السجلات المكتملة فقط")],
  ];
  metadata.forEach((items, idx) => {
    const rowNumber = metaRows[idx];
    const row: Row = { index: rowNumber, height: 26, cells: [] };
    const groups = [
      { ls: 0, le: 2, vs: 3, ve: 5 },
      { ls: 6, le: 8, vs: 9, ve: 11 },
      { ls: 12, le: 14, vs: 15, ve: visibleColumnCount - 1 },
    ];
    groups.forEach((group, groupIndex) => {
      const label = items[groupIndex * 2];
      const value = items[groupIndex * 2 + 1];
      addMergedToExistingRow(row, rowNumber, group.ls, group.le, label, S.metaLabel);
      const isGeneratedAt = rowNumber === 5 && groupIndex === 2;
      const isDate = (rowNumber === 5 && groupIndex < 2) || (rowNumber === 6 && groupIndex === 1 && /^\d{4}-\d{2}-\d{2}$/.test(String(value)));
      const generatedText = isGeneratedAt && Number.isFinite(new Date(String(value)).getTime())
        ? new Date(String(value)).toLocaleString("ar-SA-u-ca-gregory")
        : value;
      const numericValue = isDate ? excelSerial(value) : generatedText;
      addMergedToExistingRow(row, rowNumber, group.vs, group.ve, numericValue, isDate ? S.dateValue : S.metaValue);
    });
    rows.push(row);
  });
  rows.push({ index: 8, height: 22, cells: mergedCells(8, 0, visibleColumnCount - 1, "", S.plain) });

  addMerged(9, 0, visibleColumnCount - 1, "المؤشرات المالية", S.section, undefined, 28);

  const officialStart = 20;
  const officialEnd = Math.max(officialStart, officialStart + report.rows.length - 1);
  const reviewRows = report.extraTables?.[0]?.rows || [];
  const kpiTop = [
    { start: 0, end: 6, label: "الرواتب الأساسية", formula: report.rows.length ? `SUM(I${officialStart}:I${officialEnd})` : "0", labelStyle: S.kpiGoldLabel, valueStyle: S.kpiGoldValue },
    { start: 7, end: 13, label: "إجمالي الإضافات", formula: report.rows.length ? `SUM(K${officialStart}:K${officialEnd})` : "0", labelStyle: S.kpiGreenLabel, valueStyle: S.kpiGreenValue },
    { start: 14, end: visibleColumnCount - 1, label: "إجمالي الخصومات", formula: report.rows.length ? `SUM(O${officialStart}:O${officialEnd})` : "0", labelStyle: S.kpiRedLabel, valueStyle: S.kpiRedValue },
  ];
  const row10: Row = { index: 10, height: 25, cells: [] };
  const row11: Row = { index: 11, height: 28, cells: [] };
  kpiTop.forEach((card) => {
    addMergedToExistingRow(row10, 10, card.start, card.end, card.label, card.labelStyle);
    addMergedToExistingRow(row11, 11, card.start, card.end, 0, card.valueStyle, card.formula);
  });
  rows.push(row10, row11);
  rows.push({ index: 12, height: 8, cells: mergedCells(12, 0, visibleColumnCount - 1, "", S.plain) });

  const netFormula = report.rows.length ? `SUM(Q${officialStart}:Q${officialEnd})` : "0";
  const row13: Row = { index: 13, height: 25, cells: [] };
  const row14: Row = { index: 14, height: 28, cells: [] };
  const kpiBottom = [
    { start: 0, end: 6, label: `${netLabel(report)} صرفه`, formula: netFormula, labelStyle: S.kpiBlueLabel, valueStyle: S.kpiBlueValue },
    { start: 7, end: 13, label: "الموظفات الداخلات في الصرف", formula: report.rows.length ? `COUNTA(A${officialStart}:A${officialEnd})` : "0", labelStyle: S.kpiBlueLabel, valueStyle: S.kpiNumber },
    { start: 14, end: visibleColumnCount - 1, label: "السجلات المستبعدة", formula: String(reviewRows.length), labelStyle: S.kpiBlueLabel, valueStyle: S.kpiNumber },
  ];
  kpiBottom.forEach((card) => {
    addMergedToExistingRow(row13, 13, card.start, card.end, card.label, card.labelStyle);
    addMergedToExistingRow(row14, 14, card.start, card.end, 0, card.valueStyle, card.formula);
  });
  rows.push(row13, row14);

  rows.push({ index: 15, height: 8, cells: mergedCells(15, 0, visibleColumnCount - 1, "", S.plain) });
  if (hasCarryover) {
    const totalCarry = report.rows.reduce((sum, row) => sum + numberValue(row.previousPeriodAdjustment), 0);
    addMerged(16, 0, visibleColumnCount - 1, `تسويات فترات سابقة: ${totalCarry.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س — تظهر تفاصيلها لكل موظفة في الجدول التشغيلي.`, S.note, undefined, 24);
  } else {
    rows.push({ index: 16, height: 8, cells: mergedCells(16, 0, visibleColumnCount - 1, "", S.plain) });
  }
  rows.push({ index: 17, height: 8, cells: mergedCells(17, 0, visibleColumnCount - 1, "", S.plain) });

  addMerged(18, 0, visibleColumnCount - 1, "المسيرة الرسمية المختصرة", S.section, undefined, 28);

  const officialBlocks = [
    { start: 0, end: 1, label: "الموظفة", key: "employeeName", kind: "text" },
    { start: 2, end: 3, label: "المسمى الوظيفي", key: "jobTitle", kind: "text" },
    { start: 4, end: 5, label: "إعداد الراتب", key: "setupStatus", kind: "status" },
    { start: 6, end: 7, label: "ربط الحضور", key: "attendanceStatus", kind: "status" },
    { start: 8, end: 9, label: "الراتب الأساسي", key: "baseSalary", kind: "currency" },
    { start: 10, end: 11, label: "الإضافات والمكافآت", key: "additions", kind: "currencyGreen" },
    { start: 12, end: 13, label: "تعويض رصيد الإجازات", key: "leaveCompensation", kind: "currencyBlue" },
    { start: 14, end: 15, label: "الخصومات", key: "deductions", kind: "currencyRed" },
    { start: 16, end: 18, label: netLabel(report), key: "expectedNet", kind: "net" },
    { start: 19, end: visibleColumnCount - 1, label: "الحالة", key: "status", kind: "status" },
  ];

  const header19: Row = { index: 19, height: 34, cells: [] };
  officialBlocks.forEach((block) => addMergedToExistingRow(header19, 19, block.start, block.end, block.label, S.header));
  rows.push(header19);

  report.rows.forEach((item, index) => {
    const rowNumber = officialStart + index;
    const row: Row = { index: rowNumber, height: 30, cells: [] };
    officialBlocks.forEach((block) => {
      const value = item[block.key];
      let style: number = rowNumber % 2 ? S.text : S.textAlt;
      let formula: string | undefined;
      if (block.kind === "status") style = statusStyle(value);
      if (block.kind === "currency") style = rowNumber % 2 ? S.currency : S.currencyAlt;
      if (block.kind === "currencyGreen") style = numberValue(value) > 0 ? S.currencyGreen : (rowNumber % 2 ? S.currency : S.currencyAlt);
      if (block.kind === "currencyBlue") style = numberValue(value) > 0 ? S.currencyGreen : (rowNumber % 2 ? S.currency : S.currencyAlt);
      if (block.kind === "currencyRed") style = numberValue(value) > 0 ? S.currencyRed : (rowNumber % 2 ? S.currency : S.currencyAlt);
      if (block.kind === "net") {
        style = S.currencyGreen;
        const carry = numberValue(item.previousPeriodAdjustment);
        if (Math.abs(carry) > 0.00001) {
          formula = `I${rowNumber}+K${rowNumber}+M${rowNumber}-O${rowNumber}+${helperCol}${rowNumber}`;
        } else {
          formula = `I${rowNumber}+K${rowNumber}+M${rowNumber}-O${rowNumber}`;
        }
      }
      addMergedToExistingRow(row, rowNumber, block.start, block.end, value, style, formula);
    });
    if (hasCarryover) row.cells.push({ ref: `${helperCol}${rowNumber}`, value: numberValue(item.previousPeriodAdjustment), style: S.currency });
    rows.push(row);
  });

  const officialTotalRow = officialStart + Math.max(1, report.rows.length);
  const totalRow: Row = { index: officialTotalRow, height: 32, cells: [] };
  officialBlocks.forEach((block) => {
    let value: ExportV2Value = "";
    let style: number = S.totalLabel;
    let formula: string | undefined;
    if (block.start === 0) value = "الإجمالي";
    if ([8, 10, 12, 14, 16].includes(block.start) && report.rows.length) {
      const letter = col(block.start);
      value = report.rows.reduce((sum, row) => sum + numberValue(row[block.key]), 0);
      style = S.totalCurrency;
      formula = `SUM(${letter}${officialStart}:${letter}${officialStart + report.rows.length - 1})`;
    }
    addMergedToExistingRow(totalRow, officialTotalRow, block.start, block.end, value, style, formula);
  });
  rows.push(totalRow);

  const detailSectionRow = officialTotalRow + 2;
  addMerged(detailSectionRow, 0, visibleColumnCount - 1, "التفاصيل المالية والتشغيلية الكاملة", S.section, undefined, 28);
  const detailHeaderRow = detailSectionRow + 1;
  rows.push({
    index: detailHeaderRow,
    height: 42,
    cells: detailColumns.map((column, index) => ({ ref: ref(index, detailHeaderRow), value: column.header, style: S.header })),
  });

  const detailStart = detailHeaderRow + 1;
  report.rows.forEach((item, index) => {
    const rowNumber = detailStart + index;
    const longText = detailColumns.some((column) => String(item[column.key] ?? "").length > 80);
    const rowCells = detailColumns.map((column, columnIndex) => {
      let formula: string | undefined;
      let value = item[column.key];
      if (isHourColumn(column.key)) {
        const parsedHours = localizedNumber(value);
        if (parsedHours != null) value = parsedHours;
      }
      if (column.key === "expectedNet") {
        const byKey = new Map(detailColumns.map((candidate, idx) => [String(candidate.key), idx]));
        const base = byKey.get("baseSalary");
        const adds = byKey.get("additions");
        const leave = byKey.get("leaveCompensation");
        const deductions = byKey.get("deductions");
        const carry = byKey.get("previousPeriodAdjustment");
        if (base != null && adds != null && leave != null && deductions != null) {
          formula = `${col(base)}${rowNumber}+${col(adds)}${rowNumber}+${col(leave)}${rowNumber}-${col(deductions)}${rowNumber}${carry != null ? `+${col(carry)}${rowNumber}` : ""}`;
        }
      }
      return { ref: ref(columnIndex, rowNumber), value, style: detailStyle(column, value, rowNumber), formula };
    });
    rows.push({ index: rowNumber, height: longText ? 58 : 34, cells: rowCells });
  });

  const detailTotalRow = detailStart + Math.max(1, report.rows.length);
  const detailTotals: Row = { index: detailTotalRow, height: 32, cells: [] };
  detailColumns.forEach((column, index) => {
    const key = String(column.key);
    const shouldTotal = isTotalableDetailColumn(column);
    const totalStyle = isHourColumn(column.key)
      ? S.hours
      : column.type === "number"
        ? S.number
        : S.totalCurrency;
    if (index === 0) {
      detailTotals.cells.push({ ref: ref(index, detailTotalRow), value: "الإجمالي", style: S.totalLabel });
    } else if (shouldTotal && report.rows.length) {
      const cachedTotal = report.rows.reduce((sum, row) => {
        const raw = row[column.key];
        const parsed = isHourColumn(column.key) ? localizedNumber(raw) : numberValue(raw);
        return sum + (parsed ?? 0);
      }, 0);
      detailTotals.cells.push({
        ref: ref(index, detailTotalRow),
        value: cachedTotal,
        style: totalStyle,
        formula: `SUM(${col(index)}${detailStart}:${col(index)}${detailStart + report.rows.length - 1})`,
      });
    } else {
      detailTotals.cells.push({ ref: ref(index, detailTotalRow), value: "", style: S.totalLabel });
    }
  });
  rows.push(detailTotals);

  const reviewSectionRow = detailTotalRow + 2;
  addMerged(reviewSectionRow, 0, visibleColumnCount - 1, "مراجعات ما قبل الإقفال والسجلات المستبعدة", S.section, undefined, 28);
  const reviewHeaderRow = reviewSectionRow + 1;
  const reviewHeader: Row = { index: reviewHeaderRow, height: 26, cells: [] };
  addMergedToExistingRow(reviewHeader, reviewHeaderRow, 0, 5, "الموظف", S.metaLabel);
  addMergedToExistingRow(reviewHeader, reviewHeaderRow, 6, 13, "الحالة", S.metaLabel);
  addMergedToExistingRow(reviewHeader, reviewHeaderRow, 14, visibleColumnCount - 1, "المطلوب / سبب الاستبعاد", S.metaLabel);
  rows.push(reviewHeader);

  const reviewStart = reviewHeaderRow + 1;
  if (reviewRows.length) {
    reviewRows.forEach((review, index) => {
      const rowNumber = reviewStart + index;
      const row: Row = { index: rowNumber, height: 34, cells: [] };
      addMergedToExistingRow(row, rowNumber, 0, 5, review.employeeName, S.text);
      addMergedToExistingRow(row, rowNumber, 6, 13, review.readiness, reviewStatusStyle(review.readiness));
      addMergedToExistingRow(row, rowNumber, 14, visibleColumnCount - 1, review.reason, S.note);
      rows.push(row);
    });
  } else {
    addMerged(reviewStart, 0, visibleColumnCount - 1, "لا توجد سجلات مستبعدة أو تحتاج مراجعة قبل الإقفال.", S.statusGood, undefined, 28);
  }

  const reviewEnd = reviewStart + Math.max(1, reviewRows.length) - 1;
  const noteSectionRow = reviewEnd + 2;
  addMerged(noteSectionRow, 0, visibleColumnCount - 1, "الملاحظة المحاسبية النهائية", S.section, undefined, 28);
  const accountingNotes = [
    "• تعويض رصيد الإجازات بند مالي مستقل، ولا يدخل ضمن الإضافات أو المكافآت. يظهر في عمود مستقل ويُضاف فقط إلى الصافي عند وجود مبلغ معتمد له.",
    `• ${netLabel(report)} = الراتب الأساسي + الإضافات والمكافآت + تعويض رصيد الإجازات − إجمالي الخصومات${hasCarryover ? " ± تسويات الفترات السابقة" : ""}.`,
    "• خصم الحضور المؤجل بند إفصاح فقط ولا يخصم من صافي الفترة الحالية؛ يظهر مبلغ الخصم وشهر التحصيل المستهدف في عمودين مستقلين.",
    "• للموظفة غير السعودية يكون خصم GOSI على الموظفة صفراً، بينما تظهر مساهمة المخاطر المهنية على المنشأة ضمن عمود مساهمة المنشأة GOSI.",
    "• التقرير الرسمي يعتمد صافي الفترة المتوقع/المعتمد، مع ترحيل فروقات ما بعد الاعتماد كتسويات للفترة التالية.",
  ];
  accountingNotes.forEach((note, index) => addMerged(noteSectionRow + 1 + index, 0, visibleColumnCount - 1, note, S.note, undefined, 24));
  const footerRow = noteSectionRow + accountingNotes.length + 2;
  addMerged(footerRow, 0, visibleColumnCount - 1, `مَلِكات — تقرير رواتب رسمي موحّد | ${monthLabel}`, S.footer, undefined, 24);

  const widths = detailColumns.map(detailWidth);
  while (widths.length < visibleColumnCount) widths.push(12);
  if (hasCarryover) widths.push(2);

  return {
    name: "مسيرة الرواتب",
    rows,
    merges,
    widths,
    hiddenColumns: hasCarryover ? [helperColIndex] : [],
    freezeRows: 3,
    autoFilter: undefined,
    repeatRows: "$1:$3",
    printArea: `$A$1:$${visibleLast}$${footerRow}`,
    orientation: "landscape",
    tabColor: C.green,
    zoom: 82,
  };
}

function buildMobilePayrollSheet(report: ExportV2Report<Record<string, ExportV2Value>>): Sheet {
  const rows: Row[] = [];
  const merges: string[] = [];
  const widthCount = 4;
  const lastCol = col(widthCount - 1);

  const addMerged = (
    row: number,
    start: number,
    end: number,
    value: ExportV2Value,
    style: number,
    formula?: string,
    height?: number
  ) => {
    rows.push({ index: row, height, cells: mergedCells(row, start, end, value, style, formula) });
    if (start !== end) merges.push(`${ref(start, row)}:${ref(end, row)}`);
  };

  const addPairRow = (
    rowNumber: number,
    leftLabel: string,
    leftValue: ExportV2Value,
    rightLabel: string,
    rightValue: ExportV2Value,
    leftStyle: number = S.metaValue,
    rightStyle: number = S.metaValue
  ) => {
    rows.push({
      index: rowNumber,
      height: 30,
      cells: [
        { ref: `A${rowNumber}`, value: leftLabel, style: S.metaLabel },
        { ref: `B${rowNumber}`, value: leftValue, style: leftStyle },
        { ref: `C${rowNumber}`, value: rightLabel, style: S.metaLabel },
        { ref: `D${rowNumber}`, value: rightValue, style: rightStyle },
      ],
    });
  };

  const monthLabel = monthYearLabel(report);
  const reviewRows = report.extraTables?.[0]?.rows || [];
  const totalBase = report.rows.reduce((sum, row) => sum + numberValue(row.baseSalary), 0);
  const totalAdditions = report.rows.reduce((sum, row) => sum + numberValue(row.additions), 0);
  const totalLeave = report.rows.reduce((sum, row) => sum + numberValue(row.leaveCompensation), 0);
  const totalDeductions = report.rows.reduce((sum, row) => sum + numberValue(row.deductions), 0);
  const totalCarry = report.rows.reduce((sum, row) => sum + numberValue(row.previousPeriodAdjustment), 0);
  const totalNet = report.rows.reduce((sum, row) => sum + numberValue(row.expectedNet), 0);

  addMerged(1, 0, 3, `${report.branding?.salonName || "مَلِكات"}  |  MALIKAT`, S.brand, undefined, 34);
  addMerged(2, 0, 3, "مسيرة الرواتب — نسخة الجوال", S.title, undefined, 40);
  addMerged(3, 0, 3, `${monthLabel} · عرض رأسي بدون تمرير أفقي`, S.subtitle, undefined, 26);
  addMerged(4, 0, 3, "", S.plain, undefined, 6);

  addMerged(5, 0, 3, "بيانات التقرير", S.section, undefined, 28);
  addPairRow(6, "الفترة من", report.dateRange?.from || "—", "إلى", report.dateRange?.to || "—");
  addPairRow(
    7,
    "تاريخ الإنشاء",
    Number.isFinite(new Date(String(report.generatedAt)).getTime())
      ? new Date(String(report.generatedAt)).toLocaleDateString("ar-SA-u-ca-gregory")
      : report.generatedAt,
    "السجلات",
    report.rows.length,
    S.metaValue,
    S.kpiNumber
  );
  addPairRow(8, "الموظفة", filterValue(report, "الموظفة", "كل الموظفات"), "الحالة", filterValue(report, "حالة الراتب", "كل الحالات"));

  addMerged(9, 0, 3, "الملخص المالي", S.section, undefined, 28);
  addPairRow(10, "الرواتب الأساسية", totalBase, "الإضافات والمكافآت", totalAdditions, S.currency, S.currencyGreen);
  addPairRow(11, "تعويض رصيد الإجازات", totalLeave, "الخصومات", totalDeductions, totalLeave > 0 ? S.currencyGreen : S.currency, totalDeductions > 0 ? S.currencyRed : S.currency);
  addPairRow(12, "تسويات فترات سابقة", totalCarry, netLabel(report), totalNet, totalCarry < 0 ? S.currencyRed : totalCarry > 0 ? S.currencyGreen : S.currency, S.currencyGreen);

  let cursor = 14;
  report.rows.forEach((item, index) => {
    const employeeName = clean(item.employeeName, `موظفة ${index + 1}`);
    const employeeStatus = clean(item.status, "—");
    addMerged(cursor, 0, 3, `${employeeName}  ·  ${employeeStatus}`, S.section, undefined, 30);
    cursor += 1;

    addPairRow(cursor, "المسمى الوظيفي", clean(item.jobTitle), "إعداد الراتب", clean(item.setupStatus), S.metaValue, statusStyle(item.setupStatus));
    cursor += 1;
    addPairRow(cursor, "ربط الحضور", clean(item.attendanceStatus), "الراتب الأساسي", numberValue(item.baseSalary), statusStyle(item.attendanceStatus), S.currency);
    cursor += 1;
    addPairRow(cursor, "الإضافات والمكافآت", numberValue(item.additions), "تعويض الإجازات", numberValue(item.leaveCompensation), numberValue(item.additions) > 0 ? S.currencyGreen : S.currency, numberValue(item.leaveCompensation) > 0 ? S.currencyGreen : S.currency);
    cursor += 1;
    addPairRow(cursor, "الخصومات", numberValue(item.deductions), "تسوية سابقة", numberValue(item.previousPeriodAdjustment), numberValue(item.deductions) > 0 ? S.currencyRed : S.currency, numberValue(item.previousPeriodAdjustment) < 0 ? S.currencyRed : numberValue(item.previousPeriodAdjustment) > 0 ? S.currencyGreen : S.currency);
    cursor += 1;
    addPairRow(cursor, "خصم الغياب", numberValue(item.absenceDeduction), "خصم نقص الساعات", numberValue(item.missingHoursDeduction), numberValue(item.absenceDeduction) > 0 ? S.currencyRed : S.currency, numberValue(item.missingHoursDeduction) > 0 ? S.currencyRed : S.currency);
    cursor += 1;
    addPairRow(cursor, "خصم GOSI", numberValue(item.insuranceDeduction), "أقساط السلف", numberValue(item.advanceDeductions), numberValue(item.insuranceDeduction) > 0 ? S.currencyRed : S.currency, numberValue(item.advanceDeductions) > 0 ? S.currencyRed : S.currency);
    cursor += 1;
    addPairRow(cursor, "التزامات والأقساط", numberValue(item.obligationDeductions), "يدوي / غير مصنف", numberValue(item.manualDeductions) + numberValue(item.unclassifiedDeductions), numberValue(item.obligationDeductions) > 0 ? S.currencyRed : S.currency, numberValue(item.manualDeductions) + numberValue(item.unclassifiedDeductions) > 0 ? S.currencyRed : S.currency);
    cursor += 1;
    const deferredAttendanceDeduction = numberValue(
      item.deferredAttendanceDeduction
    );
    if (deferredAttendanceDeduction > 0) {
      addPairRow(
        cursor,
        "خصم حضور مؤجل",
        deferredAttendanceDeduction,
        "التحصيل المستهدف",
        clean(item.deferredAttendanceTargetMonth, "غير محدد"),
        S.currencyRed,
        S.metaValue
      );
      cursor += 1;
    }
    const netRow: Row = { index: cursor, height: 32, cells: [] };
    netRow.cells.push(...mergedCells(cursor, 0, 1, netLabel(report), S.totalLabel));
    netRow.cells.push(...mergedCells(cursor, 2, 3, numberValue(item.expectedNet), S.totalCurrency));
    merges.push(`A${cursor}:B${cursor}`, `C${cursor}:D${cursor}`);
    rows.push(netRow);
    cursor += 1;

    const note = clean(item.notes, "");
    if (note) {
      addMerged(cursor, 0, 3, `ملاحظات: ${note}`, S.note, undefined, note.length > 90 ? 58 : 38);
      cursor += 1;
    }
    addMerged(cursor, 0, 3, "", S.plain, undefined, 8);
    cursor += 1;
  });

  addMerged(cursor, 0, 3, "مراجعات ما قبل الإقفال", S.section, undefined, 28);
  cursor += 1;
  if (reviewRows.length) {
    reviewRows.forEach((review) => {
      addPairRow(cursor, "الموظف", clean(review.employeeName), "الحالة", clean(review.readiness), S.metaValue, reviewStatusStyle(review.readiness));
      cursor += 1;
      addMerged(cursor, 0, 3, clean(review.reason, "يحتاج مراجعة"), S.note, undefined, 38);
      cursor += 1;
    });
  } else {
    addMerged(cursor, 0, 3, "لا توجد سجلات مستبعدة أو تحتاج مراجعة قبل الإقفال.", S.statusGood, undefined, 30);
    cursor += 1;
  }

  addMerged(cursor + 1, 0, 3, "ملاحظة محاسبية", S.section, undefined, 28);
  addMerged(
    cursor + 2,
    0,
    3,
    `تعويض رصيد الإجازات بند مستقل. ${netLabel(report)} = الراتب الأساسي + الإضافات والمكافآت + تعويض الإجازات − الخصومات ± تسويات الفترات السابقة.`,
    S.note,
    undefined,
    48
  );
  addMerged(cursor + 3, 0, 3, `مَلِكات — نسخة جوال لمسيرة الرواتب | ${monthLabel}`, S.footer, undefined, 24);

  return {
    name: "رواتب الجوال",
    rows,
    merges,
    widths: [20, 24, 20, 24],
    freezeRows: 3,
    repeatRows: "$1:$3",
    printArea: `$A$1:$${lastCol}$${cursor + 3}`,
    orientation: "portrait",
    tabColor: C.gold,
    zoom: 110,
  };
}

function buildWorkbookBytes(
  report: ExportV2Report<Record<string, ExportV2Value>>,
  sheets: Sheet[]
) {
  const safeSheets = sheets.map((sheet, index) => ({
    ...sheet,
    name: safeSheetName(sheet.name, `Sheet ${index + 1}`),
  }));
  const files: Array<{ name: string; content: string }> = [
    { name: "[Content_Types].xml", content: contentTypesXml(safeSheets.length) },
    { name: "_rels/.rels", content: rootRelsXml() },
    { name: "docProps/app.xml", content: appXml(safeSheets) },
    { name: "docProps/core.xml", content: coreXml(report) },
    { name: "xl/workbook.xml", content: workbookXml(safeSheets) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(safeSheets.length) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...safeSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: renderSheet(sheet),
    })),
  ];
  return zipStore(files);
}

function contentTypesXml(sheetCount: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookXml(sheets: Sheet[]) {
  const names = sheets.flatMap((sheet, index) => {
    const escaped = xmlEscape(sheet.name.replace(/'/g, "''"));
    return [
      sheet.repeatRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${escaped}'!${xmlEscape(sheet.repeatRows)}</definedName>` : "",
      sheet.printArea ? `<definedName name="_xlnm.Print_Area" localSheetId="${index}">'${escaped}'!${xmlEscape(sheet.printArea)}</definedName>` : "",
    ].filter(Boolean);
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
  ${names ? `<definedNames>${names}</definedNames>` : ""}
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
}

function workbookRelsXml(count: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function appXml(sheets: Sheet[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Malikat Payroll Executive Export</Application>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${xmlEscape(sheet.name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>
  <Company>Malikat Salon</Company>
</Properties>`;
}

function coreXml(report: ExportV2Report<Record<string, ExportV2Value>>) {
  const timestamp = Number.isFinite(new Date(report.generatedAt).getTime()) ? new Date(report.generatedAt).toISOString() : new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(report.title)}</dc:title><dc:creator>Malikat Payroll</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function zipStore(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const year = Math.max(1980, now.getFullYear());
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const u16 = (view: DataView, pos: number, value: number) => view.setUint16(pos, value & 0xffff, true);
  const u32 = (view: DataView, pos: number, value: number) => view.setUint32(pos, value >>> 0, true);
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length); const lv = new DataView(lh.buffer);
    u32(lv,0,0x04034b50); u16(lv,4,20); u16(lv,6,0x0800); u16(lv,8,0); u16(lv,10,dosTime); u16(lv,12,dosDate); u32(lv,14,crc); u32(lv,18,data.length); u32(lv,22,data.length); u16(lv,26,name.length); u16(lv,28,0); lh.set(name,30);
    local.push(lh,data);
    const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
    u32(cv,0,0x02014b50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0x0800); u16(cv,10,0); u16(cv,12,dosTime); u16(cv,14,dosDate); u32(cv,16,crc); u32(cv,20,data.length); u32(cv,24,data.length); u16(cv,28,name.length); u16(cv,30,0); u16(cv,32,0); u16(cv,34,0); u16(cv,36,0); u32(cv,38,0); u32(cv,42,offset); ch.set(name,46);
    central.push(ch); offset += lh.length + data.length;
  }
  const localBytes = concatBytes(local); const centralBytes = concatBytes(central);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  u32(ev,0,0x06054b50); u16(ev,4,0); u16(ev,6,0); u16(ev,8,files.length); u16(ev,10,files.length); u32(ev,12,centralBytes.length); u32(ev,16,localBytes.length); u16(ev,20,0);
  return concatBytes([localBytes, centralBytes, end]);
}

export function buildPayrollExecutiveExcelBytes<Row extends Record<string, ExportV2Value>>(reportInput: ExportV2Report<Row>) {
  const report = reportInput as unknown as ExportV2Report<Record<string, ExportV2Value>>;
  const sheets = [buildUnifiedPayrollSheet(report)];
  return buildWorkbookBytes(report, sheets);
}

export function buildPayrollMobileExcelBytes<Row extends Record<string, ExportV2Value>>(reportInput: ExportV2Report<Row>) {
  const report = reportInput as unknown as ExportV2Report<Record<string, ExportV2Value>>;
  return buildWorkbookBytes(report, [buildMobilePayrollSheet(report)]);
}

export function exportPayrollExecutiveExcel<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const bytes = buildPayrollExecutiveExcelBytes(report);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildExportV2FileName(report, "xlsx")
  );
}

export function exportPayrollMobileExcel<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const bytes = buildPayrollMobileExcelBytes(report);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildExportV2FileName({ ...report, slug: `${report.slug}-mobile` }, "xlsx")
  );
}
