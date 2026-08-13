import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("leave request print stays true A4 without preview scale leakage", () => {
  const coreCss = read("src/documents/core/documentPrint.css");
  const leaveCss = read("src/styles/LeaveRequestDocument.css");
  const printAdapter = read("src/documents/leave/leaveRequestPrint.ts");
  assert.match(coreCss, /width:\s*210mm/);
  assert.match(coreCss, /min-height:\s*297mm/);
  assert.match(coreCss, /@page\s*{\s*size:\s*A4 portrait;\s*margin:\s*0;/);
  assert.match(printAdapter, /width:\s*210mm/);
  assert.match(printAdapter, /min-height:\s*297mm/);
  assert.match(printAdapter, /transform:\s*none/);
  assert.doesNotMatch(`${coreCss}\n${leaveCss}\n${printAdapter}`, /zoom\s*:/);
});

test("leave request uses one view model and one document structure across adapters", () => {
  const entry = read("src/services/leaveRequestExport.ts");
  const facade = read("src/services/leaveRequestExportFacade.ts");
  const model = read("src/documents/leave/leaveRequestModel.ts");
  const spec = read("src/documents/leave/leaveRequestDocumentSpec.ts");
  assert.match(entry, /leaveRequestExportFacade/);
  assert.match(model, /export type LeaveRequestDocumentData/);
  assert.match(spec, /leaveRequestLetterText/);
  assert.match(spec, /leaveRequestStructuredRows/);
  assert.match(facade, /buildLeaveRequestDocumentData/);
  assert.match(facade, /buildLeaveRequestPdfBytes/);
  assert.match(facade, /buildLeaveRequestDocxBytes/);
  assert.match(facade, /exportReportToExcelV2/);
  assert.doesNotMatch(facade, /application\/msword|\.doc`|\.doc"/);
});

test("light document branding uses a preloaded black logo and shared watermark", () => {
  const component = read("src/components/hr/LeaveRequestDocument.tsx");
  const corePage = read("src/documents/core/DocumentPage.tsx");
  const coreCss = read("src/documents/core/documentPrint.css");
  const branding = read("src/documents/core/documentBranding.ts");
  const assets = read("src/documents/core/documentExportAssets.ts");
  const pdf = read("src/documents/leave/leaveRequestPdf.ts");
  assert.match(corePage, /export function DocumentWatermark/);
  assert.match(component, /DocumentWatermark/);
  assert.match(coreCss, /filter:\s*brightness\(0\)\s*contrast\(100%\)/);
  assert.match(branding, /watermarkOpacity/);
  assert.match(assets, /fetch\(source/);
  assert.match(assets, /globalCompositeOperation\s*=\s*"source-in"/);
  assert.match(assets, /fillStyle\s*=\s*"#000"/);
  assert.match(pdf, /documentImageCanvas\(logoSource, true\)/);
  assert.match(pdf, /globalAlpha\s*=\s*DOCUMENT_BRANDING\.watermarkOpacity/);
});

test("DOCX package contains A4 RTL defaults, black logo media, watermark header and signatures", () => {
  const facade = read("src/services/leaveRequestExportFacade.ts");
  const packageBuilder = read("src/documents/leave/leaveRequestDocxPackage.ts");
  const layout = read("src/documents/leave/leaveRequestDocxLayout.ts");
  const primitives = read("src/documents/core/documentDocxPrimitives.ts");
  const watermark = read("src/documents/core/documentDocxWatermark.ts");
  assert.match(facade, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(packageBuilder, /buildDocumentExportPng\(DOCUMENT_BRANDING\.printLogoSource, \{ black: true \}\)/);
  assert.match(packageBuilder, /word\/document\.xml/);
  assert.match(packageBuilder, /word\/styles\.xml/);
  assert.match(packageBuilder, /word\/settings\.xml/);
  assert.match(packageBuilder, /word\/header1\.xml/);
  assert.match(packageBuilder, /word\/_rels\/header1\.xml\.rels/);
  assert.match(packageBuilder, /word\/media\/\$\{image\.fileName\}/);
  assert.match(packageBuilder, /rIdLogo/);
  assert.match(packageBuilder, /rIdEmployeeSignature/);
  assert.match(packageBuilder, /rIdManagerSignature/);
  assert.match(packageBuilder, /w:pgSz/);
  assert.match(layout, /rIdEmployeeSignature/);
  assert.match(layout, /rIdManagerSignature/);
  assert.match(primitives, /Tahoma/);
  assert.match(primitives, /ar-SA/);
  assert.match(primitives, /w:rtl/);
  assert.match(primitives, /w:bidi/);
  assert.match(watermark, /rIdWatermark/);
  assert.match(watermark, /behindDoc="1"/);
});

test("leave PDF is one A4 page with preloaded black logo and watermark", () => {
  const pdf = read("src/documents/leave/leaveRequestPdf.ts");
  const drawing = read("src/documents/leave/leaveRequestPdfDrawing.ts");
  assert.match(drawing, /595\.28/);
  assert.match(drawing, /841\.89/);
  assert.match(pdf, /buildPdfFromJpegPages/);
  assert.match(pdf, /documentImageCanvas\(logoSource, true\)/);
  assert.match(pdf, /DOCUMENT_BRANDING\.watermarkOpacity/);
  assert.doesNotMatch(pdf, /window\.print|zoom\s*:|transform:\s*scale/);
});

test("active attendance and staff performance reports use Export V2", () => {
  const attendance = read("src/helpers/reports/exportAttendanceReport.ts");
  const performance = read("src/helpers/reports/exportStaffPerformanceReport.ts");
  assert.match(attendance, /exportReportToPdfV2/);
  assert.match(attendance, /exportReportToExcelV2/);
  assert.doesNotMatch(attendance, /common\.ts|window\.print|exportHtmlDocumentToPdf/);
  assert.match(performance, /exportReportToMultitablePdfV2/);
  assert.match(performance, /exportReportToMultisheetExcelV2/);
  assert.doesNotMatch(performance, /common\.ts|window\.print|exportHtmlDocumentToPdf/);
});

test("legacy report runtimes stay retired", () => {
  const common = read("src/helpers/reports/common.ts");
  const payrollLegacySurface = read("src/helpers/reports/exportPayrollReport.ts");
  assert.match(common, /Legacy report export runtime was removed/);
  assert.doesNotMatch(common, /window\.print|exportReportToPdf|exportReportToExcel|XLSX/);
  assert.match(payrollLegacySurface, /isPayrollExportEligible/);
  assert.match(payrollLegacySurface, /payrollExportExclusionReason/);
  assert.doesNotMatch(payrollLegacySurface, /exportPayrollReportPdf|exportPayrollReportExcel|window\.print/);
});
