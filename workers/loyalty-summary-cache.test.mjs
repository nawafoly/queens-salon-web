import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/services/CoreClientService.ts", "utf8");

test("loyalty summary has a bounded cache and single-flight request", () => {
  assert.match(source, /LOYALTY_SUMMARY_TTL_MS = 60_000/);
  assert.match(source, /loyaltySummaryCache/);
  assert.match(source, /loyaltySummaryRequest/);
  assert.match(source, /loyaltySummaryCache\.expiresAt > now/);
  assert.match(source, /if \(loyaltySummaryRequest\) return loyaltySummaryRequest/);
  assert.match(source, /expiresAt: Date\.now\(\) \+ LOYALTY_SUMMARY_TTL_MS/);
  assert.match(source, /finally \{[\s\S]*loyaltySummaryRequest = null/);
});

test("loyalty-affecting client writes invalidate the summary cache", () => {
  const adjust = source.slice(source.indexOf("async adjustLoyalty"), source.indexOf("async create", source.indexOf("async adjustLoyalty")));
  const create = source.slice(source.indexOf("async create"), source.indexOf("async patch", source.indexOf("async create")));
  const patch = source.slice(source.indexOf("async patch"), source.indexOf("async updateProfile", source.indexOf("async patch")));

  assert.match(adjust, /invalidateLoyaltySummary\(\)/);
  assert.match(create, /invalidateLoyaltySummary\(\)/);
  assert.match(patch, /invalidateLoyaltySummary\(\)/);
});
