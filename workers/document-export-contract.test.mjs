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

test("leave request document has a shared watermark behind content", () => {
  const component = read("src/components/hr/LeaveRequestDocument.tsx");
  const leaveCss = read("src/styles/LeaveRequestDocument.css");
  const exportService = read("src/services/leaveRequestExport.ts");

  assert.match(component, /leave-doc-watermark/);
  assert.match(leaveCss, /opacity:\s*0\.055/);
  assert.match(leaveCss, /z-index:\s*0/);
  assert.match(exportService, /watermarkWidth/);
  assert.match(exportService, /globalAlpha\s*=\s*0\.055/);
});
