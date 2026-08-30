import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src", "index.css"), "utf8");

test("number inputs hide browser-native spinner controls globally", () => {
  assert.match(css, /GLOBAL_NUMBER_INPUT_SPINNER_POLICY_V1/);
  assert.match(css, /input\[type="number"\]::\-webkit-outer-spin-button/);
  assert.match(css, /input\[type="number"\]::\-webkit-inner-spin-button/);
  assert.match(css, /-webkit-appearance:\s*none/);
  assert.match(css, /input\[type="number"\][\s\S]*appearance:\s*textfield/);
});
