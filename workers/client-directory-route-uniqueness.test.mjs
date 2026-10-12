import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./core/index.js", import.meta.url),
  "utf8"
);

test("client directory summary route is declared exactly once", () => {
  assert.equal(
    (source.match(/path === "\/api\/core\/clients\/directory-summary"/g) || []).length,
    1
  );
});

test("client directory summary switch case is declared exactly once and forwards query", () => {
  assert.equal(
    (source.match(/case "client:directory-summary":/g) || []).length,
    1
  );

  assert.match(
    source,
    /case "client:directory-summary":[\s\S]*?getClientDirectorySummary\(\s*db,\s*ctx\.salonId,\s*query\s*\)/
  );
});
