import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(
  path.join(root, "src/pages/DashboardEmployees.tsx"),
  "utf8"
);

test("employee offboarding uses canonical Dashboard V2 date picker", () => {
  assert.match(source, /DashboardDatePickerV2/);

  const dateFieldIndex = source.indexOf('id="employee-offboarding-end-date"');
  assert.ok(dateFieldIndex >= 0, "offboarding date field not found");

  const dateArea = source.slice(
    Math.max(0, dateFieldIndex - 700),
    dateFieldIndex + 1200
  );

  assert.match(dateArea, /DashboardDatePickerV2/);
  assert.doesNotMatch(dateArea, /type="date"/);
  assert.match(dateArea, /max=\{todayIso\(\)\}/);
  assert.match(dateArea, /clearable=\{false\}/);
});
