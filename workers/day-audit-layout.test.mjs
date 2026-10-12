import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  "src/styles/dashboard-v2/pages/day-audit.css",
  "utf8"
);

test("day audit desktop metrics render all five cards in one row", () => {
  const block =
    css.match(
      /\.dashboard-v2 \.day-audit-v2-metrics\s*\{[\s\S]*?\}/
    )?.[0] || "";

  assert.match(
    block,
    /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/
  );
});

test("day audit keeps responsive layouts below desktop", () => {
  assert.match(
    css,
    /@media \(max-width: 1199\.98px\)[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );

  assert.match(
    css,
    /@media \(max-width: 639\.98px\)[\s\S]*?grid-template-columns:\s*1fr/
  );
});