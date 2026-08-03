import { EXPORT_V2_COLORS, DEFAULT_EXPORT_V2_BRANDING } from "./branding";
import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import {
  exportV2FormatDate,
  exportV2FormatDateTime,
  exportV2FormatValue,
  exportV2NumericValue,
} from "./formatters";
import type {
  ExportV2Column,
  ExportV2Report,
  ExportV2SummaryItem,
  ExportV2Tone,
  ExportV2Value,
  ExportV2ValueType,
} from "./types";

type XmlCell = {
  ref: string;
  value?: ExportV2Value;
  type?: ExportV2ValueType;
  style?: number;
  formula?: string;
};

type XmlRow = {
  index: number;
  height?: number;
  cells: XmlCell[];
};

type WorksheetDefinition = {
  name: string;
  rows: XmlRow[];
  merges?: string[];
  widths: number[];
  frozenRows?: number;
  frozenColumns?: number;
  autoFilter?: string;
  orientation?: "portrait" | "landscape";
  tabColor?: string;
  zoomScale?: number;
  repeatRows?: string;
};

const STYLE = {
  default: 0,
  title: 1,
  subtitle: 2,
  label: 3,
  value: 4,
  section: 5,
  tableHeader: 6,
  text: 7,
  number: 8,
  currency: 9,
  date: 10,
  success: 11,
  danger: 12,
  gold: 13,
  dark: 14,
  neutral: 15,
  note: 16,
  totalLabel: 17,
  totalCurrency: 18,
  totalNumber: 19,
  textAlt: 20,
  numberAlt: 21,
  currencyAlt: 22,
  dateAlt: 23,
  statusSuccess: 24,
  statusDanger: 25,
  statusGold: 26,
  statusNeutral: 27,
  datetime: 28,
  datetimeAlt: 29,
  summarySuccessCurrency: 30,
  summaryDangerCurrency: 31,
  summaryGoldCurrency: 32,
  summaryDarkCurrency: 33,
  summaryNeutralCurrency: 34,
  summarySuccessNumber: 35,
  summaryDangerNumber: 36,
  summaryGoldNumber: 37,
  summaryDarkNumber: 38,
  summaryNeutralNumber: 39,
} as const;

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellRef(columnIndex: number, rowIndex: number) {
  return `${columnName(columnIndex)}${rowIndex}`;
}

function styleForValueType(type: ExportV2ValueType | undefined) {
  if (type === "currency") return STYLE.currency;
  if (type === "number") return STYLE.number;
  if (type === "date") return STYLE.date;
  if (type === "datetime") return STYLE.datetime;
  return STYLE.text;
}

function styleForTone(tone: ExportV2Tone | undefined) {
  if (tone === "success") return STYLE.success;
  if (tone === "danger") return STYLE.danger;
  if (tone === "gold") return STYLE.gold;
  if (tone === "dark") return STYLE.dark;
  return STYLE.neutral;
}

function styleForSummaryValue(item: ExportV2SummaryItem) {
  const tone = item.tone || "neutral";
  if (item.type === "currency") {
    if (tone === "success") return STYLE.summarySuccessCurrency;
    if (tone === "danger") return STYLE.summaryDangerCurrency;
    if (tone === "gold") return STYLE.summaryGoldCurrency;
    if (tone === "dark") return STYLE.summaryDarkCurrency;
    return STYLE.summaryNeutralCurrency;
  }
  if (item.type === "number") {
    if (tone === "success") return STYLE.summarySuccessNumber;
    if (tone === "danger") return STYLE.summaryDangerNumber;
    if (tone === "gold") return STYLE.summaryGoldNumber;
    if (tone === "dark") return STYLE.summaryDarkNumber;
    return STYLE.summaryNeutralNumber;
  }
  return styleForTone(tone);
}

function styleForDetailCell(
  type: ExportV2ValueType | undefined,
  rowIndex: number,
  value: ExportV2Value
) {
  if (type === "status") {
    const normalized = String(value || "").trim();
    if (
      normalized.includes("استرجاع") ||
      normalized.includes("مسترجع") ||
      normalized.includes("غير مدفوع") ||
      normalized.includes("ملغي") ||
      normalized.includes("مرفوض")
    ) {
      return STYLE.statusDanger;
    }
    if (normalized.includes("مراجعة") || normalized.includes("معلق") || normalized.includes("جزئي")) {
      return STYLE.statusGold;
    }
    if (normalized.includes("نشط") || normalized.includes("مكتمل") || normalized.includes("مدفوع")) {
      return STYLE.statusSuccess;
    }
    return STYLE.statusNeutral;
  }

  const alternate = rowIndex % 2 === 0;
  if (!alternate) return styleForValueType(type);
  if (type === "currency") return STYLE.currencyAlt;
  if (type === "number") return STYLE.numberAlt;
  if (type === "date") return STYLE.dateAlt;
  if (type === "datetime") return STYLE.datetimeAlt;
  return STYLE.textAlt;
}

function inlineStringCell(cell: XmlCell, text: string) {
  const style = cell.style ?? STYLE.text;
  return `<c r="${cell.ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function numericCell(cell: XmlCell, value: number) {
  const style = cell.style ?? styleForValueType(cell.type);
  const formula = cell.formula ? `<f>${xmlEscape(cell.formula)}</f>` : "";
  return `<c r="${cell.ref}" t="n" s="${style}">${formula}<v>${Number.isFinite(value) ? value : 0}</v></c>`;
}

function excelDateSerial(value: ExportV2Value, includeTime = false) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`)
    : new Date(text);
  if (!Number.isFinite(date.getTime())) return 0;
  const utc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    includeTime ? date.getHours() : 0,
    includeTime ? date.getMinutes() : 0,
    includeTime ? date.getSeconds() : 0
  );
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

function excelDateTimeText(value: ExportV2Value) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return String(value ?? "—");
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderCell(cell: XmlCell) {
  if (cell.formula) return numericCell(cell, exportV2NumericValue(cell.value));
  if (cell.type === "currency" || cell.type === "number") {
    return numericCell(cell, exportV2NumericValue(cell.value));
  }
  if (cell.type === "date") {
    return numericCell(cell, excelDateSerial(cell.value, false));
  }
  if (cell.type === "datetime") {
    return numericCell(cell, excelDateSerial(cell.value, true));
  }
  return inlineStringCell(cell, exportV2FormatValue(cell.value, cell.type));
}

function renderWorksheet(definition: WorksheetDefinition) {
  const maxRow = definition.rows.reduce((max, row) => Math.max(max, row.index), 1);
  const maxColumn = Math.max(1, definition.widths.length);
  const dimension = `A1:${cellRef(maxColumn - 1, maxRow)}`;
  const frozenRows = definition.frozenRows || 0;
  const frozenColumns = definition.frozenColumns || 0;
  const pane =
    frozenRows > 0 || frozenColumns > 0
      ? `<pane${frozenColumns > 0 ? ` xSplit="${frozenColumns}"` : ""}${frozenRows > 0 ? ` ySplit="${frozenRows}"` : ""} topLeftCell="${columnName(frozenColumns)}${frozenRows + 1}" activePane="${frozenRows > 0 && frozenColumns > 0 ? "bottomRight" : frozenRows > 0 ? "bottomLeft" : "topRight"}" state="frozen"/>`
      : "";
  const zoomScale = Math.max(70, Math.min(120, definition.zoomScale || 90));
  const widths = definition.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, width)}" customWidth="1"/>`
    )
    .join("");
  const rows = definition.rows
    .map((row) => {
      const height = row.height ? ` ht="${row.height}" customHeight="1"` : "";
      return `<row r="${row.index}"${height}>${row.cells.map(renderCell).join("")}</row>`;
    })
    .join("");
  const merges = definition.merges?.length
    ? `<mergeCells count="${definition.merges.length}">${definition.merges
        .map((merge) => `<mergeCell ref="${merge}"/>`)
        .join("")}</mergeCells>`
    : "";
  const autoFilter = definition.autoFilter ? `<autoFilter ref="${definition.autoFilter}"/>` : "";
  const orientation = definition.orientation || "landscape";
  const tabColor = definition.tabColor || EXPORT_V2_COLORS.gold;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><tabColor rgb="${tabColor}"/><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0" zoomScale="${zoomScale}" zoomScaleNormal="${zoomScale}">${pane}<selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${widths}</cols>
  <sheetData>${rows}</sheetData>
  ${autoFilter}
  ${merges}
  <printOptions horizontalCentered="1" verticalCentered="0" headings="0" gridLines="0"/>
  <pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.18" footer="0.18"/>
  <pageSetup orientation="${orientation}" fitToWidth="1" fitToHeight="0" paperSize="9" blackAndWhite="0"/>
  <headerFooter>
    <oddFooter>&amp;Lصفحة &amp;P من &amp;N&amp;RMalikat Export V2</oddFooter>
  </headerFooter>
</worksheet>`;
}
function stylesXml() {
  const c = EXPORT_V2_COLORS;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="5">
    <numFmt numFmtId="164" formatCode="#,##0.00 &quot;ر.س&quot;;[Red]-#,##0.00 &quot;ر.س&quot;;-"/>
    <numFmt numFmtId="165" formatCode="#,##0.00;[Red]-#,##0.00;-"/>
    <numFmt numFmtId="166" formatCode="#,##0;[Red]-#,##0;-"/>
    <numFmt numFmtId="167" formatCode="dd/mm/yyyy"/>
    <numFmt numFmtId="168" formatCode="dd/mm/yyyy hh:mm"/>
  </numFmts>
  <fonts count="14">
    <font><sz val="10"/><color rgb="${c.black}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="20"/><color rgb="${c.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="${c.gold}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${c.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${c.black}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${c.green}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${c.burgundy}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${c.gold}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${c.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="${c.muted}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${c.black}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${c.green}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${c.burgundy}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${c.gold}"/><name val="Tahoma"/><family val="2"/></font>
  </fonts>
  <fills count="10">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.white}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.gray}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.gold}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.black}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.paleGreen}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.paleBurgundy}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.paleGold}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${c.paleBlue}"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="${c.border}"/></left><right style="thin"><color rgb="${c.border}"/></right><top style="thin"><color rgb="${c.border}"/></top><bottom style="thin"><color rgb="${c.border}"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="${c.gold}"/></left><right style="thin"><color rgb="${c.gold}"/></right><top style="thin"><color rgb="${c.gold}"/></top><bottom style="thin"><color rgb="${c.gold}"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="40">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment readingOrder="2" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="2" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="2" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="8" borderId="2" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="4" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="167" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="0" fontId="11" fillId="6" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="12" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="13" fillId="8" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="9" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="9" fillId="8" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="8" borderId="2" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="7" fillId="8" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="10" fillId="8" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="167" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="0" fontId="11" fillId="6" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="12" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="13" fillId="8" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="9" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="168" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="168" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="164" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="6" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="7" fillId="8" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="8" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="10" fillId="9" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="6" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="7" fillId="8" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="8" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="166" fontId="10" fillId="9" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
function pairRows(
  items: Array<{ label: string; value: ExportV2Value; style?: number; type?: ExportV2ValueType }>,
  startRow: number
) {
  const rows: XmlRow[] = [];
  const merges: string[] = [];
  let rowIndex = startRow;
  for (let index = 0; index < items.length; index += 2) {
    const first = items[index];
    const second = items[index + 1];
    const cells: XmlCell[] = [
      { ref: cellRef(0, rowIndex), value: first.label, style: STYLE.label },
      {
        ref: cellRef(1, rowIndex),
        value: first.value,
        type: first.type,
        style: first.style ?? styleForValueType(first.type),
      },
    ];
    if (second) {
      cells.push(
        { ref: cellRef(2, rowIndex), value: second.label, style: STYLE.label },
        {
          ref: cellRef(3, rowIndex),
          value: second.value,
          type: second.type,
          style: second.style ?? styleForValueType(second.type),
        }
      );
    } else {
      merges.push(`B${rowIndex}:D${rowIndex}`);
    }
    rows.push({ index: rowIndex, height: 30, cells });
    rowIndex += 1;
  }
  return { rows, merges, nextRow: rowIndex };
}

function buildSummaryWorksheet<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
): WorksheetDefinition {
  const branding = { ...DEFAULT_EXPORT_V2_BRANDING, ...report.branding };
  const rows: XmlRow[] = [
    {
      index: 1,
      height: 44,
      cells: [{ ref: "A1", value: report.title, style: STYLE.title }],
    },
    {
      index: 2,
      height: 28,
      cells: [{ ref: "A2", value: `${branding.salonName} — ${branding.brandName}`, style: STYLE.subtitle }],
    },
    {
      index: 3,
      height: 24,
      cells: [
        { ref: "A3", value: "الفترة", style: STYLE.label },
        { ref: "B3", value: report.period, style: STYLE.value },
        { ref: "C3", value: "رمز التقرير", style: STYLE.label },
        { ref: "D3", value: report.reportCode || "—", style: STYLE.value },
      ],
    },
    {
      index: 4,
      cells: [
        { ref: "A4", value: "تاريخ التصدير", style: STYLE.label },
        { ref: "B4", value: report.generatedAt, type: "datetime", style: STYLE.datetime },
        { ref: "C4", value: "أنشأه", style: STYLE.label },
        { ref: "D4", value: report.generatedBy, style: STYLE.value },
      ],
    },
  ];
  const merges = ["A1:D1", "A2:D2"];
  let nextRow = 6;

  rows.push({
    index: 5,
    height: 25,
    cells: [{ ref: "A5", value: "الفلاتر المطبقة", style: STYLE.section }],
  });
  merges.push("A5:D5");

  const filterItems = (report.filters?.length ? report.filters : [{ label: "الفلاتر", value: "بدون فلاتر إضافية" }])
    .map((item) => ({ label: item.label, value: item.value, style: STYLE.value }));
  const filters = pairRows(filterItems, nextRow);
  rows.push(...filters.rows);
  merges.push(...filters.merges);
  nextRow = filters.nextRow + 1;

  rows.push({
    index: nextRow,
    height: 25,
    cells: [{ ref: cellRef(0, nextRow), value: "ملخص التقرير", style: STYLE.section }],
  });
  merges.push(`A${nextRow}:D${nextRow}`);
  nextRow += 1;

  const summaryItems = report.summary.map((item: ExportV2SummaryItem) => ({
    label: item.label,
    value: item.value,
    type: item.type,
    style: styleForSummaryValue(item),
  }));
  const summaries = pairRows(summaryItems, nextRow);
  rows.push(...summaries.rows);
  merges.push(...summaries.merges);
  nextRow = summaries.nextRow + 1;

  if (report.notes?.length) {
    rows.push({
      index: nextRow,
      height: 25,
      cells: [{ ref: cellRef(0, nextRow), value: "ملاحظات", style: STYLE.section }],
    });
    merges.push(`A${nextRow}:D${nextRow}`);
    nextRow += 1;
    report.notes.forEach((note) => {
      const noteHeight = Math.min(68, Math.max(36, 34 + Math.ceil(String(note).length / 80) * 12));
      rows.push({
        index: nextRow,
        height: noteHeight,
        cells: [{ ref: cellRef(0, nextRow), value: `• ${note}`, style: STYLE.note }],
      });
      merges.push(`A${nextRow}:D${nextRow}`);
      nextRow += 1;
    });
  }

  return {
    name: report.summarySheetName || "الملخص",
    rows,
    merges,
    widths: [24, 28, 24, 28],
    frozenRows: 2,
    orientation: "portrait",
    tabColor: EXPORT_V2_COLORS.gold,
    zoomScale: 95,
    repeatRows: "$1:$2",
  };
}

function buildDetailsWorksheet<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
): WorksheetDefinition {
  const columns = report.columns;
  const lastColumn = columnName(Math.max(0, columns.length - 1));
  const rows: XmlRow[] = [
    { index: 1, height: 42, cells: [{ ref: "A1", value: report.title, style: STYLE.title }] },
    { index: 2, height: 26, cells: [{ ref: "A2", value: report.period, style: STYLE.subtitle }] },
    {
      index: 3,
      cells: [
        { ref: "A3", value: `تاريخ التصدير: ${excelDateTimeText(report.generatedAt)}`, style: STYLE.value },
      ],
    },
    {
      index: 4,
      height: 34,
      cells: [
        {
          ref: "A4",
          value: `الفلاتر: ${(report.filters || []).map((item) => `${item.label}: ${exportV2FormatValue(item.value)}`).join(" | ") || "بدون فلاتر إضافية"}`,
          style: STYLE.note,
        },
      ],
    },
    {
      index: 6,
      height: 32,
      cells: columns.map((column, index) => ({
        ref: cellRef(index, 6),
        value: column.header,
        style: STYLE.tableHeader,
      })),
    },
  ];
  const merges = [`A1:${lastColumn}1`, `A2:${lastColumn}2`, `A3:${lastColumn}3`, `A4:${lastColumn}4`];

  let rowIndex = 7;
  if (report.rows.length) {
    for (const item of report.rows) {
      const hasLongText = columns.some((column) =>
        String(item[column.key] ?? "").trim().length > 64
      );
      rows.push({
        index: rowIndex,
        height: hasLongText ? 36 : 25,
        cells: columns.map((column, columnIndex) => ({
          ref: cellRef(columnIndex, rowIndex),
          value: item[column.key],
          type: column.type,
          style: styleForDetailCell(column.type, rowIndex, item[column.key]),
        })),
      });
      rowIndex += 1;
    }
  } else {
    rows.push({
      index: rowIndex,
      height: 30,
      cells: [{ ref: cellRef(0, rowIndex), value: report.emptyMessage || "لا توجد بيانات مطابقة.", style: STYLE.note }],
    });
    merges.push(`A${rowIndex}:${lastColumn}${rowIndex}`);
    rowIndex += 1;
  }

  if (report.rows.length && report.totals) {
    const firstTextColumn = columns.findIndex(
      (column) => column.type !== "currency" && column.type !== "number"
    );
    rows.push({
      index: rowIndex,
      height: 28,
      cells: columns.map((column, columnIndex) => {
        const total = report.totals?.[column.key];
        if (columnIndex === (firstTextColumn >= 0 ? firstTextColumn : 0)) {
          return { ref: cellRef(columnIndex, rowIndex), value: "الإجمالي", style: STYLE.totalLabel };
        }
        if (typeof total === "number") {
          const columnLetter = columnName(columnIndex);
          return {
            ref: cellRef(columnIndex, rowIndex),
            value: total,
            type: column.type,
            formula: `SUM(${columnLetter}7:${columnLetter}${rowIndex - 1})`,
            style: column.type === "currency" ? STYLE.totalCurrency : STYLE.totalNumber,
          };
        }
        return { ref: cellRef(columnIndex, rowIndex), value: "", style: STYLE.totalLabel };
      }),
    });
  }

  return {
    name: report.detailsSheetName || "التفاصيل",
    rows,
    merges,
    widths: columns.map((column) => {
      const requested = column.width || Math.max(12, Math.min(30, column.header.length + 6));
      if (column.type === "currency" || column.type === "number") return Math.max(13, Math.min(16, requested));
      if (column.type === "date" || column.type === "status") return Math.max(13, Math.min(16, requested));
      if (column.header.includes("ملاحظ")) return Math.max(26, Math.min(34, requested));
      return Math.max(12, Math.min(28, requested));
    }),
    frozenRows: 6,
    frozenColumns: Math.min(2, columns.length),
    autoFilter: report.rows.length ? `A6:${lastColumn}${Math.max(6, rowIndex - 1)}` : undefined,
    orientation: report.pdfOrientation || "landscape",
    tabColor: EXPORT_V2_COLORS.green,
    zoomScale: 82,
    repeatRows: "$1:$6",
  };
}

function contentTypesXml(sheetCount: number) {
  const worksheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${worksheetOverrides}
</Types>`;
}

function safeWorksheetName(value: string, index: number) {
  const safe = String(value || "")
    .replace(/[\\/?*\[\]:]/g, " ")
    .trim()
    .slice(0, 31);
  return safe || `Sheet ${index + 1}`;
}

function workbookXml(sheets: WorksheetDefinition[]) {
  const printTitles = sheets
    .map((sheet, index) => {
      if (!sheet.repeatRows) return "";
      const escapedSheet = sheet.name.replace(/'/g, "''");
      return `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${xmlEscape(escapedSheet)}'!${xmlEscape(sheet.repeatRows)}</definedName>`;
    })
    .filter(Boolean)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>${sheets
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("")}</sheets>
  ${printTitles ? `<definedNames>${printTitles}</definedNames>` : ""}
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
}

function workbookRelationshipsXml(sheetCount: number) {
  const sheetRelationships = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRelationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appPropertiesXml(sheetNames: string[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Malikat Export V2</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${sheetNames.map((name) => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>
  <Company>Malikat Salon</Company>
  <AppVersion>1.0</AppVersion>
</Properties>`;
}

function corePropertiesXml(reportTitle: string, generatedAt: string) {
  const timestamp = Number.isFinite(new Date(generatedAt).getTime()) ? new Date(generatedAt).toISOString() : new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(reportTitle)}</dc:title>
  <dc:creator>Malikat Export V2</dc:creator>
  <cp:lastModifiedBy>Malikat Export V2</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function zipStore(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const { dosTime, dosDate } = dosDateTime();
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, dataBytes.length);
    writeUint32(localView, 22, dataBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localChunks.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, dataBytes.length);
    writeUint32(centralView, 24, dataBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    localOffset += localHeader.length + dataBytes.length;
  }

  const localData = concatBytes(localChunks);
  const centralData = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralData.length);
  writeUint32(endView, 16, localData.length);
  writeUint16(endView, 20, 0);

  return concatBytes([localData, centralData, end]);
}

export function buildExportV2ExcelBytes<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
) {
  const worksheets = [buildSummaryWorksheet(report), buildDetailsWorksheet(report)].map((sheet, index) => ({
    ...sheet,
    name: safeWorksheetName(sheet.name, index),
  }));
  const files: Array<{ name: string; content: string }> = [
    { name: "[Content_Types].xml", content: contentTypesXml(worksheets.length) },
    { name: "_rels/.rels", content: rootRelationshipsXml() },
    { name: "docProps/app.xml", content: appPropertiesXml(worksheets.map((sheet) => sheet.name)) },
    { name: "docProps/core.xml", content: corePropertiesXml(report.title, report.generatedAt) },
    { name: "xl/workbook.xml", content: workbookXml(worksheets) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelationshipsXml(worksheets.length) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...worksheets.map((worksheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: renderWorksheet(worksheet),
    })),
  ];
  return zipStore(files);
}

export function exportReportToExcelV2<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
) {
  const bytes = buildExportV2ExcelBytes(report);
  downloadExportV2Blob(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    buildExportV2FileName(report, "xlsx")
  );
}
