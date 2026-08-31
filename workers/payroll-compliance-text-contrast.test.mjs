import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(
  path.join(
    root,
    "src/styles/dashboard-v2/pages/payroll-compliance-workspace.css"
  ),
  "utf8"
);

test("payroll compliance secondary copy uses Dashboard V2 contrast tokens", () => {
  assert.match(source, /PAYROLL_COMPLIANCE_TEXT_CONTRAST_V1/);
  assert.match(
    source,
    /\.payroll-compliance-head p\s*\{[\s\S]*?color:\s*var\(--dsv2-text-soft\);[\s\S]*?opacity:\s*1;/
  );
  assert.match(
    source,
    /\.payroll-compliance-kpi small[\s\S]*?color:\s*var\(--dsv2-muted\);[\s\S]*?opacity:\s*1;/
  );
  assert.match(
    source,
    /\.payroll-period-lock-state span[\s\S]*?color:\s*var\(--dsv2-muted\);[\s\S]*?opacity:\s*1;/
  );
});
