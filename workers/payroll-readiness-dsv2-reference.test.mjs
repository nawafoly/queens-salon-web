import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(
  path.join(root, "src/styles/dashboard-v2/pages/payroll.css"),
  "utf8"
);

test("payroll readiness follows the Dashboard V2 visual reference", () => {
  assert.match(source, /PAYROLL_READINESS_DSV2_REFERENCE_V2/);
  assert.match(
    source,
    /\.payroll-readiness-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/
  );
  assert.match(
    source,
    /\.payroll-readiness-card\s*\{[\s\S]*?border:\s*1px solid var\(--dsv2-border\)/
  );
  assert.match(
    source,
    /\.payroll-readiness-card\s*\{[\s\S]*?border-radius:\s*var\(--dsv2-radius-lg\)/
  );
  assert.match(
    source,
    /\.payroll-readiness-grid\s*\{[\s\S]*?gap:\s*var\(--dsv2-grid-gap, var\(--dsv2-space-4\)\)/
  );
});

test("payroll readiness remains responsive", () => {
  assert.match(source, /@media \(max-width: 1399\.98px\)/);
  assert.match(
    source,
    /@media \(max-width: 1399\.98px\)[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/
  );
  assert.match(
    source,
    /@media \(max-width: 767\.98px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    source,
    /@media \(max-width: 479\.98px\)[\s\S]*?grid-template-columns:\s*1fr/
  );
});
