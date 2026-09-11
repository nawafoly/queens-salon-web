import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

const componentSource = await fs.readFile(
  new URL('../src/components/hr/SalaryCertificateDocument.tsx', import.meta.url),
  'utf8'
);
const cssSource = await fs.readFile(
  new URL('../src/styles/LeaveRequestDocument.css', import.meta.url),
  'utf8'
);
const exportSource = await fs.readFile(
  new URL('../src/services/salaryCertificateExport.ts', import.meta.url),
  'utf8'
);

test('salary certificate exposes print/save PDF from employee self-service', () => {
  assert.match(componentSource, /printSalaryCertificateDocument/);
  assert.match(componentSource, /salary-certificate-export-toolbar/);
  assert.match(componentSource, /طباعة \/ حفظ PDF/);
  assert.match(componentSource, /salary-certificate-print-root/);
});

test('admin keeps one salary certificate toolbar while employee toolbar stays visible elsewhere', () => {
  assert.match(
    cssSource,
    /\.admin-leave-request-document-shell\s+\.salary-certificate-export-toolbar\s*\{[\s\S]*?display:\s*none;/
  );
});

test('salary certificate print flow excludes UI chrome from exported document', () => {
  assert.match(exportSource, /\.salary-certificate-print-root/);
  assert.match(exportSource, /\.leave-request-export-toolbar/);
  assert.match(exportSource, /printWindow\.print\(\)/);
});
