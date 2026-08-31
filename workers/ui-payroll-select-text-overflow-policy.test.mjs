import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const requireFromRepo = createRequire(path.join(root, "package.json"));
const postcss = requireFromRepo("postcss");

const file = path.join(root, "src/styles/AdminHrEmployeeDetail.css");
const css = fs.readFileSync(file, "utf8");
const ast = postcss.parse(css, { from: file });

const selector =
  ".emp-editor-overlay.emp-editor-overlay--hr .staff-payroll-form select";

function norm(v) {
  return String(v).trim().replace(/\s+/g, " ");
}

const matches = [];
ast.walkRules((rule) => {
  if (norm(rule.selector) === norm(selector)) matches.push(rule);
});

test("staff payroll select has a complete ellipsis contract", () => {
  assert.ok(matches.length >= 1);

  const valid = matches.some((rule) => {
    const props = new Map();
    rule.walkDecls((decl) => props.set(decl.prop, decl.value.trim()));

    return (
      props.get("text-overflow") === "ellipsis" &&
      props.get("overflow") === "hidden" &&
      props.get("white-space") === "nowrap"
    );
  });

  assert.equal(valid, true);
});
