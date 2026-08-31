import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const globalCss = fs.readFileSync(
  path.join(root, "src/index.css"),
  "utf8"
);

const dashboardCss = fs.readFileSync(
  path.join(root, "src/styles/dashboard-v2/control-bridges.css"),
  "utf8"
);

test("site-wide placeholders use one readable contrast policy", () => {
  assert.match(globalCss, /GLOBAL_PLACEHOLDER_CONTRAST_POLICY_V1/);
  assert.match(
    globalCss,
    /input::placeholder,[\s\S]*?textarea::placeholder[\s\S]*?color:\s*var\(--ui-placeholder-color\) !important;/
  );
  assert.match(
    globalCss,
    /input::placeholder,[\s\S]*?opacity:\s*1 !important;/
  );
  assert.match(
    globalCss,
    /-webkit-text-fill-color:\s*var\(--ui-placeholder-color\) !important;/
  );
});

test("Dashboard V2 placeholders inherit the canonical muted text token", () => {
  assert.match(dashboardCss, /DASHBOARD_V2_PLACEHOLDER_CONTRAST_V1/);
  assert.match(
    dashboardCss,
    /\.dsv2-input::placeholder[\s\S]*?var\(--dsv2-muted, var\(--ui-placeholder-color\)\) !important/
  );
  assert.match(
    dashboardCss,
    /\[data-placeholder="true"\][\s\S]*?opacity:\s*1 !important;/
  );
});
