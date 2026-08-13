import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("leave request print uses canonical A4 page without compact zoom fallback", () => {
  const coreCss = read("src/documents/core/documentPrint.css");
  const leaveCss = read("src/styles/LeaveRequestDocument.css");
  const exportService = read("src/services/leaveRequestExport.ts");
  const component = read("src/components/hr/LeaveRequestDocument.tsx");

  assert.match(coreCss, /width:\s*210mm/);
  assert.match(coreCss, /min-height:\s*297mm/);
  assert.match(coreCss, /@page\s*{\s*size:\s*A4 portrait;\s*margin:\s*0;/);
  assert.doesNotMatch(`${coreCss}\n${leaveCss}\n${exportService}`, /zoom\s*:/);
  assert.doesNotMatch(exportService, /renderedHeight|a4ContentHeightPx|ISOLATED_PRINT_CSS|WORD_DOCUMENT_CSS/);
  assert.doesNotMatch(component, /LeaveRequestPrintCompact|leave-doc-word-export/);
});

test("leave request exports use real format adapters from one view model", () => {
  const model = read("src/documents/leave/leaveRequestModel.ts");
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(model, /export type LeaveRequestDocumentData/);
  assert.match(exportService, /buildLeaveRequestDocumentData\(request\)/);
  assert.match(exportService, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(exportService, /application\/pdf/);
  assert.match(exportService, /exportReportToExcelV2/);
  assert.doesNotMatch(exportService, /application\/msword|\.doc`|\.doc"/);
});

test("document branding forces a black logo on light paper and a shared watermark", () => {
  const branding = read("src/documents/core/documentBranding.ts");
  const core = read("src/documents/core/DocumentPage.tsx");
  const coreCss = read("src/documents/core/documentPrint.css");
  const component = read("src/components/hr/LeaveRequestDocument.tsx");
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(branding, /printLogoColor:\s*"#111111"/);
  assert.match(branding, /watermarkOpacity:\s*0\.055/);
  assert.match(core, /document-page-watermark/);
  assert.match(core, /DocumentBrandLogo/);
  assert.match(coreCss, /document-brand-logo/);
  assert.match(coreCss, /brightness\(0\) contrast\(100%\)/);
  assert.match(component, /watermarkSrc=\{DOCUMENT_BRANDING\.logoUrl\}/);
  assert.match(component, /DocumentBrandLogo/);
  assert.match(exportService, /drawTintedImage/);
  assert.match(exportService, /DOCUMENT_BRANDING\.printLogoColor/);
  assert.doesNotMatch(`${coreCss}\n${exportService}`, /grayscale\(100%\)/);
});

test("DOCX carries RTL Arabic, black brand logo, watermark and signatures", () => {
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(exportService, /w:bidi/);
  assert.match(exportService, /w:rtl/);
  assert.match(exportService, /w:lang w:val="ar-SA" w:bidi="ar-SA"/);
  assert.match(exportService, /rIdBrandLogo/);
  assert.match(exportService, /rIdWatermark/);
  assert.match(exportService, /word\/header1\.xml/);
  assert.match(exportService, /word\/_rels\/header1\.xml\.rels/);
  assert.match(exportService, /rIdEmployeeSignature/);
  assert.match(exportService, /rIdManagerSignature/);
  assert.match(exportService, /\.docx`/);
});

test("Excel export remains RTL A4 fit-to-page with two structured sheets", () => {
  const excel = read("src/services/exports-v2/excel.ts");
  const leaveExport = read("src/services/leaveRequestExport.ts");

  assert.match(excel, /rightToLeft="1"/);
  assert.match(excel, /paperSize="9"/);
  assert.match(excel, /fitToWidth="1"/);
  assert.match(excel, /buildSummaryWorksheet/);
  assert.match(excel, /buildDetailsWorksheet/);
  assert.match(leaveExport, /summarySheetName:\s*"نموذج الإجازة"/);
  assert.match(leaveExport, /detailsSheetName:\s*"بيانات الطلب"/);
  assert.match(leaveExport, /DOCUMENT_BRANDING\.logoUrl/);
});
