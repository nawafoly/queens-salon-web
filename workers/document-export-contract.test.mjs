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

test("leave request exports use real format adapters from one canonical view model", () => {
  const model = read("src/documents/leave/leaveRequestModel.ts");
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(model, /export type LeaveRequestDocumentData/);
  assert.match(exportService, /buildLeaveRequestDocumentData\(request\)/);
  assert.match(exportService, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(exportService, /application\/pdf/);
  assert.match(exportService, /exportReportToExcelV2/);
  assert.doesNotMatch(exportService, /application\/msword|\.doc`|\.doc"/);
});

test("shared document watermark and light-surface branding are print safe", () => {
  const component = read("src/components/hr/LeaveRequestDocument.tsx");
  const corePage = read("src/documents/core/DocumentPage.tsx");
  const coreCss = read("src/documents/core/documentPrint.css");
  const branding = read("src/documents/core/documentBranding.ts");
  const leaveCss = read("src/styles/LeaveRequestDocument.css");
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(corePage, /export function DocumentWatermark/);
  assert.match(component, /DocumentWatermark/);
  assert.match(component, /DOCUMENT_BRANDING\.watermarkSource/);
  assert.match(coreCss, /\.document-watermark/);
  assert.match(coreCss, /opacity:\s*0\.055/);
  assert.match(coreCss, /filter:\s*brightness\(0\)\s*contrast\(100%\)/);
  assert.match(branding, /printLogoSource/);
  assert.match(branding, /watermarkSource/);
  assert.match(exportService, /blackLogoCanvas/);
  assert.match(exportService, /DOCUMENT_BRANDING\.watermarkOpacity/);
  assert.doesNotMatch(leaveCss, /leave-doc-watermark/);
});

test("DOCX exporter contains native Open XML RTL, logo, watermark and signature relationships", () => {
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(exportService, /word\/document\.xml/);
  assert.match(exportService, /word\/styles\.xml/);
  assert.match(exportService, /word\/settings\.xml/);
  assert.match(exportService, /word\/header1\.xml/);
  assert.match(exportService, /rIdWatermark/);
  assert.match(exportService, /rIdLogo/);
  assert.match(exportService, /rIdEmployeeSignature/);
  assert.match(exportService, /rIdManagerSignature/);
  assert.match(exportService, /w:rtl/);
  assert.match(exportService, /w:bidi/);
  assert.match(exportService, /Tahoma/);
  assert.match(exportService, /ar-SA/);
  assert.match(exportService, /\.docx`/);
  assert.doesNotMatch(exportService, /application\/msword|WORD_DOCUMENT_CSS/);
});

test("PDF exporter converts the light-document logo to black before header and watermark drawing", () => {
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(exportService, /globalCompositeOperation\s*=\s*"source-in"/);
  assert.match(exportService, /fillStyle\s*=\s*"#000"/);
  assert.match(exportService, /blackLogoCanvas\(logoSource\)/);
  assert.match(exportService, /globalAlpha\s*=\s*DOCUMENT_BRANDING\.watermarkOpacity/);
  assert.doesNotMatch(exportService, /filter\s*=\s*"grayscale\(100%\)"/);
});
