import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import type { ExportV2Report, ExportV2Value } from "./types";

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
  border: "D8DFE8",
  meta: "EEF3F8",
  soft: "F7F9FC",
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
  header: 7,
  text: 8,
  textAlt: 9,
  currency: 10,
  currencyAlt: 11,
  currencyGreen: 12,
  currencyRed: 13,
  currencyGold: 14,
  totalLabel: 15,
  totalCurrency: 16,
  note: 17,
  statusGood: 18,
  statusDraft: 19,
  mobileLabel: 20,
  mobileValue: 21,
  mobileNote: 22,
} as const;

type Cell = { ref: string; value?: ExportV2Value; style: number };
type Row = { index: number; height?: number; cells: Cell[] };

type AnyReport = ExportV2Report<Record<string, ExportV2Value>>;

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
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

function summaryValue(report: AnyReport, token: string) {
  return (report.summary || []).find((item) => clean(item.label, "").includes(token))?.value ?? 0;
}

function filterValue(report: AnyReport, token: string, fallback = "—") {
  return clean(report.filters?.find((item) => item.label.includes(token))?.value, fallback);
}

function rowValue(report: AnyReport, token: string) {
  const row = report.rows.find((item) => clean(item.item, "").includes(token));
  return num(row?.value);
}

function employeeName(report: AnyReport) {
  return clean(summaryValue(report, "الموظفة"), report.subtitle || "موظفة");
}

function netLabel(report: AnyReport) {
  const summaryItem = (report.summary || []).find((item) => clean(item.label, "").includes("الصافي"));
  return clean(summaryItem?.label, "الصافي المتوقع للصرف");
}

function statusStyle(value: unknown) {
  const text = clean(value, "");
  if (text.includes("معتمد") || text.includes("مدفوع") || text.includes("مكتمل")) return S.statusGood;
  return S.statusDraft;
}

function cellXml(cell: Cell) {
  if (typeof cell.value === "number") {
    return `<c r="${cell.ref}" t="n" s="${cell.style}"><v>${num(cell.value)}</v></c>`;
  }
  return `<c r="${cell.ref}" t="inlineStr" s="${cell.style}"><is><t xml:space="preserve">${esc(clean(cell.value, ""))}</t></is></c>`;
}

function renderRows(rows: Row[]) {
  return rows
    .map((row) => `<row r="${row.index}"${row.height ? ` ht="${row.height}" customHeight="1"` : ""}>${row.cells.map(cellXml).join("")}</row>`)
    .join("");
}

function mergedCells(row: number, startCol: number, endCol: number, value: ExportV2Value, style: number) {
  const cells: Cell[] = [];
  for (let index = startCol; index <= endCol; index += 1) {
    cells.push({ ref: ref(index, row), value: index === startCol ? value : "", style });
  }
  return cells;
}

function addMerged(rows: Row[], merges: string[], rowNumber: number, startCol: number, endCol: number, value: ExportV2Value, style: number, height = 24) {
  rows.push({ index: rowNumber, height, cells: mergedCells(rowNumber, startCol, endCol, value, style) });
  if (endCol > startCol) merges.push(`${ref(startCol, rowNumber)}:${ref(endCol, rowNumber)}`);
}

function addMergedToRow(row: Row, merges: string[], startCol: number, endCol: number, value: ExportV2Value, style: number) {
  row.cells.push(...mergedCells(row.index, startCol, endCol, value, style));
  if (endCol > startCol) merges.push(`${ref(startCol, row.index)}:${ref(endCol, row.index)}`);
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#\\,##0.00 &quot;ر.س&quot;;[Red]-#\\,##0.00 &quot;ر.س&quot;;-"/></numFmts>
  <fonts count="12">
    <font><sz val="10"/><color rgb="${C.ink}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="${C.gold}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="22"/><color rgb="${C.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="DCE6F1"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="${C.white}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="${C.ink}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.green}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.red}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.goldText}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="${C.navy}"/><name val="Tahoma"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="${C.muted}"/><name val="Tahoma"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="${C.navy}"/><name val="Tahoma"/><family val="2"/></font>
  </fonts>
  <fills count="11">
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
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="${C.border}"/></left><right style="thin"><color rgb="${C.border}"/></right><top style="thin"><color rgb="${C.border}"/></top><bottom style="thin"><color rgb="${C.border}"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="${C.gold}"/></left><right style="thin"><color rgb="${C.gold}"/></right><top style="thin"><color rgb="${C.gold}"/></top><bottom style="thin"><color rgb="${C.gold}"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs>
  <cellXfs count="23">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment readingOrder="2" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="10" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="5" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="5" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="6" fillId="8" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="7" fillId="9" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="164" fontId="8" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="2" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="9" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="10" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="8" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="8" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="11" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="9" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="10" fillId="6" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildWorkbookFiles(sheetName: string, sheetXml: string, lastRow: number) {
  return [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${esc(sheetName)}'!$A$1:$L$${lastRow}</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: stylesXml() },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ];
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function zip(files: Array<{ name: string; content: string }>) {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const date = new Date();
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const u16 = (view: DataView, pos: number, value: number) => view.setUint16(pos, value & 0xffff, true);
  const u32 = (view: DataView, pos: number, value: number) => view.setUint32(pos, value >>> 0, true);

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.content);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800); u16(view, 8, 0); u16(view, 10, dosTime); u16(view, 12, dosDate);
    u32(view, 14, crc); u32(view, 18, data.length); u32(view, 22, data.length); u16(view, 26, name.length); header.set(name, 30);
    local.push(header, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    u32(centralView, 0, 0x02014b50); u16(centralView, 4, 20); u16(centralView, 6, 20); u16(centralView, 8, 0x0800); u16(centralView, 10, 0);
    u16(centralView, 12, dosTime); u16(centralView, 14, dosDate); u32(centralView, 16, crc); u32(centralView, 20, data.length); u32(centralView, 24, data.length);
    u16(centralView, 28, name.length); u32(centralView, 42, offset); centralHeader.set(name, 46); central.push(centralHeader);
    offset += header.length + data.length;
  }

  const a = concat(local);
  const b = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50); u16(endView, 8, files.length); u16(endView, 10, files.length); u32(endView, 12, b.length); u32(endView, 16, a.length);
  return concat([a, b, end]);
}

function buildDesktopSheet(report: AnyReport) {
  const rows: Row[] = [];
  const merges: string[] = [];
  const employee = employeeName(report);
  const base = num(summaryValue(report, "الراتب الأساسي"));
  const additions = num(summaryValue(report, "إجمالي الإضافات"));
  const leaveComp = num(summaryValue(report, "تعويض رصيد الإجازات"));
  const prior = rowValue(report, "تسويات فترات سابقة");
  const deductions = num(summaryValue(report, "إجمالي الخصومات"));
  const net = num(summaryValue(report, "الصافي"));

  addMerged(rows, merges, 1, 0, 11, "مَلِكات | MALIKAT", S.brand, 30);
  addMerged(rows, merges, 2, 0, 11, "كشف الراتب الشهري", S.title, 40);
  addMerged(rows, merges, 3, 0, 11, `${employee} — ${clean(report.subtitle?.split("—")[1], "موظفة")}`, S.subtitle, 24);

  const meta1: Row = { index: 5, height: 24, cells: [] };
  addMergedToRow(meta1, merges, 0, 1, "الفترة", S.metaLabel);
  addMergedToRow(meta1, merges, 2, 3, clean(report.period), S.metaValue);
  addMergedToRow(meta1, merges, 4, 5, "حالة الراتب", S.metaLabel);
  addMergedToRow(meta1, merges, 6, 7, filterValue(report, "حالة الراتب"), statusStyle(filterValue(report, "حالة الراتب")));
  addMergedToRow(meta1, merges, 8, 9, "تاريخ الصرف", S.metaLabel);
  addMergedToRow(meta1, merges, 10, 11, filterValue(report, "تاريخ الصرف"), S.metaValue);
  rows.push(meta1);

  const meta2: Row = { index: 6, height: 24, cells: [] };
  addMergedToRow(meta2, merges, 0, 1, "رمز التقرير", S.metaLabel);
  addMergedToRow(meta2, merges, 2, 3, clean(report.reportCode, "HR-PAYSLIP"), S.metaValue);
  addMergedToRow(meta2, merges, 4, 5, "تاريخ الإنشاء", S.metaLabel);
  addMergedToRow(meta2, merges, 6, 7, clean(String(report.generatedAt || "").slice(0, 19).replace("T", " ")), S.metaValue);
  addMergedToRow(meta2, merges, 8, 9, "الجهة", S.metaLabel);
  addMergedToRow(meta2, merges, 10, 11, "مَلِكات — إدارة الرواتب", S.metaValue);
  rows.push(meta2);

  addMerged(rows, merges, 8, 0, 11, "الملخص المالي", S.section, 28);
  const kpiLabels: Row = { index: 9, height: 28, cells: [] };
  const kpiValues: Row = { index: 10, height: 40, cells: [] };
  const cards = [
    ["الراتب الأساسي", base, S.currencyGold],
    ["الإضافات والمكافآت", additions, S.currencyGreen],
    ["تعويض رصيد الإجازات", leaveComp, S.currencyGold],
    ["تسويات فترات سابقة", prior, prior < 0 ? S.currencyRed : S.currencyGreen],
    ["الخصومات", deductions, S.currencyRed],
    [netLabel(report), net, S.totalCurrency],
  ] as const;
  cards.forEach(([label, value, style], index) => {
    const start = index * 2;
    addMergedToRow(kpiLabels, merges, start, start + 1, label, S.metaLabel);
    addMergedToRow(kpiValues, merges, start, start + 1, value, style);
  });
  rows.push(kpiLabels, kpiValues);

  addMerged(rows, merges, 12, 0, 11, "تفاصيل الاستحقاقات والخصومات", S.section, 28);
  const header: Row = { index: 13, height: 28, cells: [] };
  addMergedToRow(header, merges, 0, 3, "البند", S.header);
  addMergedToRow(header, merges, 4, 6, "القيمة", S.header);
  addMergedToRow(header, merges, 7, 11, "الملاحظة", S.header);
  rows.push(header);

  let cursor = 14;
  report.rows.forEach((item, index) => {
    const label = clean(item.item);
    const value = num(item.value);
    const note = clean(item.note);
    let moneyStyle: number = index % 2 ? S.currencyAlt : S.currency;
    if (label.includes("خصم") || label.includes("الخصومات") || value < 0) moneyStyle = S.currencyRed;
    else if (label.includes("تعويض رصيد") || label.includes("الصافي")) moneyStyle = S.currencyGold;
    else if (label.includes("إضاف") || label.includes("مكاف") || label.includes("أوفر") || label.includes("تسويات")) moneyStyle = value < 0 ? S.currencyRed : S.currencyGreen;

    const body: Row = { index: cursor, height: note.length > 52 ? 38 : 30, cells: [] };
    addMergedToRow(body, merges, 0, 3, label, index % 2 ? S.textAlt : S.text);
    addMergedToRow(body, merges, 4, 6, value, moneyStyle);
    addMergedToRow(body, merges, 7, 11, note, index % 2 ? S.textAlt : S.text);
    rows.push(body);
    cursor += 1;
  });

  cursor += 1;
  addMerged(rows, merges, cursor, 0, 11, "الملاحظات التشغيلية والمحاسبية", S.section, 28);
  cursor += 1;
  const accountingNote = "تعويض رصيد الإجازات بند مستقل عن الإضافات والمكافآت. بعد اعتماد الراتب يثبت مبلغ الصرف، وأي فرق لاحق يرحّل كتسوية موثقة للفترة التالية.";
  addMerged(rows, merges, cursor, 0, 11, accountingNote, S.note, 42);
  cursor += 1;
  (report.notes || []).forEach((note) => {
    addMerged(rows, merges, cursor, 0, 11, clean(note), S.note, clean(note).length > 90 ? 42 : 30);
    cursor += 1;
  });

  const lastRow = Math.max(1, cursor - 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><tabColor rgb="${C.gold}"/><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:L${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0" zoomScale="90"><pane ySplit="13" topLeftCell="A14" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${Array.from({ length: 12 }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index < 4 ? 12.5 : index < 7 ? 13.5 : 14.5}" customWidth="1"/>`).join("")}</cols>
  <sheetData>${renderRows(rows)}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((item) => `<mergeCell ref="${item}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1" verticalCentered="0" headings="0" gridLines="0"/>
  <pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/>
  <pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0" paperSize="9"/>
  <headerFooter><oddFooter>&amp;Lصفحة &amp;P من &amp;N&amp;Rمَلِكات — كشف راتب سري</oddFooter></headerFooter>
</worksheet>`;

  return { sheet, lastRow };
}

function buildMobileSheet(report: AnyReport) {
  const rows: Row[] = [];
  const merges: string[] = [];
  const employee = employeeName(report);
  const base = num(summaryValue(report, "الراتب الأساسي"));
  const additions = num(summaryValue(report, "إجمالي الإضافات"));
  const leaveComp = num(summaryValue(report, "تعويض رصيد الإجازات"));
  const prior = rowValue(report, "تسويات فترات سابقة");
  const deductions = num(summaryValue(report, "إجمالي الخصومات"));
  const net = num(summaryValue(report, "الصافي"));

  addMerged(rows, merges, 1, 0, 3, "مَلِكات | MALIKAT", S.brand, 26);
  // Mobile hierarchy: employee name is the primary visual title.
  addMerged(rows, merges, 2, 0, 3, employee, S.title, 38);
  addMerged(rows, merges, 3, 0, 3, "كشف راتب — نسخة الجوال", S.subtitle, 24);

  const metaRows = [
    ["الفترة", clean(report.period)],
    ["الحالة", filterValue(report, "حالة الراتب")],
    ["تاريخ الصرف", filterValue(report, "تاريخ الصرف")],
  ];
  let cursor = 5;
  metaRows.forEach(([label, value]) => {
    const row: Row = { index: cursor, height: 26, cells: [] };
    addMergedToRow(row, merges, 0, 1, label, S.mobileLabel);
    addMergedToRow(row, merges, 2, 3, value, label === "الحالة" ? statusStyle(value) : S.mobileValue);
    rows.push(row);
    cursor += 1;
  });

  cursor += 1;
  addMerged(rows, merges, cursor, 0, 3, "الملخص المالي", S.section, 28);
  cursor += 1;
  const cards = [
    ["الراتب الأساسي", base, S.currencyGold],
    ["الإضافات والمكافآت", additions, S.currencyGreen],
    ["تعويض رصيد الإجازات", leaveComp, S.currencyGold],
    ["تسويات فترات سابقة", prior, prior < 0 ? S.currencyRed : S.currencyGreen],
    ["الخصومات", deductions, S.currencyRed],
    [netLabel(report), net, S.totalCurrency],
  ] as const;
  cards.forEach(([label, value, valueStyle]) => {
    const row: Row = { index: cursor, height: 32, cells: [] };
    addMergedToRow(row, merges, 0, 1, label, S.mobileLabel);
    addMergedToRow(row, merges, 2, 3, value, valueStyle);
    rows.push(row);
    cursor += 1;
  });

  cursor += 1;
  addMerged(rows, merges, cursor, 0, 3, "تفاصيل البنود", S.section, 28);
  cursor += 1;
  report.rows.forEach((item) => {
    const label = clean(item.item);
    const value = num(item.value);
    let valueStyle: number = S.mobileValue;
    if (label.includes("خصم") || label.includes("الخصومات") || value < 0) valueStyle = S.currencyRed;
    else if (label.includes("تعويض رصيد") || label.includes("الصافي")) valueStyle = S.currencyGold;
    else if (label.includes("إضاف") || label.includes("مكاف") || label.includes("أوفر") || label.includes("تسويات")) valueStyle = value < 0 ? S.currencyRed : S.currencyGreen;

    const itemRow: Row = { index: cursor, height: 32, cells: [] };
    addMergedToRow(itemRow, merges, 0, 1, label, S.mobileLabel);
    addMergedToRow(itemRow, merges, 2, 3, value, valueStyle);
    rows.push(itemRow);
    cursor += 1;
    const note = clean(item.note, "");
    if (note) {
      addMerged(rows, merges, cursor, 0, 3, note, S.mobileNote, note.length > 75 ? 42 : 30);
      cursor += 1;
    }
  });

  cursor += 1;
  addMerged(rows, merges, cursor, 0, 3, "ملاحظات", S.section, 28);
  cursor += 1;
  addMerged(rows, merges, cursor, 0, 3, "تعويض رصيد الإجازات مستقل عن الإضافات والمكافآت، وأي فرق بعد الاعتماد يرحّل كتسوية للفترة التالية.", S.mobileNote, 46);
  cursor += 1;
  (report.notes || []).forEach((note) => {
    addMerged(rows, merges, cursor, 0, 3, clean(note), S.mobileNote, clean(note).length > 75 ? 42 : 30);
    cursor += 1;
  });

  const lastRow = Math.max(1, cursor - 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><tabColor rgb="${C.gold}"/><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:D${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0" zoomScale="100"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="22"/>
  <cols><col min="1" max="2" width="20" customWidth="1"/><col min="3" max="4" width="18" customWidth="1"/></cols>
  <sheetData>${renderRows(rows)}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((item) => `<mergeCell ref="${item}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1" verticalCentered="0" headings="0" gridLines="0"/>
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.1" footer="0.1"/>
  <pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0" paperSize="9"/>
  <headerFooter><oddFooter>&amp;L&amp;P/&amp;N&amp;Rمَلِكات — كشف راتب جوال</oddFooter></headerFooter>
</worksheet>`;
  return { sheet, lastRow };
}

export function buildPayrollPayslipExecutiveExcelBytes<RowType extends Record<string, ExportV2Value>>(input: ExportV2Report<RowType>) {
  const report = input as unknown as AnyReport;
  const built = buildDesktopSheet(report);
  return zip(buildWorkbookFiles("كشف الراتب", built.sheet, built.lastRow));
}

export function buildPayrollPayslipMobileExcelBytes<RowType extends Record<string, ExportV2Value>>(input: ExportV2Report<RowType>) {
  const report = input as unknown as AnyReport;
  const built = buildMobileSheet(report);
  const files = buildWorkbookFiles("كشف الجوال", built.sheet, built.lastRow).map((file) =>
    file.name === "xl/workbook.xml"
      ? { ...file, content: file.content.replace(/\$L\$/g, "$D$") }
      : file
  );
  return zip(files);
}

export function exportPayrollPayslipExecutiveExcel<RowType extends Record<string, ExportV2Value>>(report: ExportV2Report<RowType>) {
  const bytes = buildPayrollPayslipExecutiveExcelBytes(report);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildExportV2FileName(report, "xlsx")
  );
}

export function exportPayrollPayslipMobileExcel<RowType extends Record<string, ExportV2Value>>(report: ExportV2Report<RowType>) {
  const bytes = buildPayrollPayslipMobileExcelBytes(report);
  const mobileReport = { ...report, slug: `${report.slug}-mobile` };
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildExportV2FileName(mobileReport, "xlsx")
  );
}
