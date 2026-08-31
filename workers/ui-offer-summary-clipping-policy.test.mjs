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

const file = path.join(root, "src/styles/DashboardOffersOfferEditorV5.css");
const css = fs.readFileSync(file, "utf8");
const ast = postcss.parse(css, { from: file });

const selector =
  ".dashboard-skin.madan-admin-shell.is-enterprise-workspace-route " +
  ".enterprise-offers-v2.enterprise-offers-v3 " +
  ".offer-editor__selected-summary strong";

function norm(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

const matches = [];
ast.walkRules((rule) => {
  if (norm(rule.selector) === norm(selector)) matches.push(rule);
});

test("offer selected summary uses a three-line clamp instead of partial clipping", () => {
  assert.equal(matches.length, 1);
  const rule = matches[0];

  const props = new Map();
  rule.walkDecls((decl) => props.set(decl.prop, decl.value.trim()));

  assert.equal(props.has("max-height"), false);
  assert.equal(props.get("display"), "-webkit-box");
  assert.equal(props.get("-webkit-box-orient"), "vertical");
  assert.equal(props.get("-webkit-line-clamp"), "3");
  assert.equal(props.get("overflow"), "hidden");
});

test("visually-hidden employee hours input remains intentional", () => {
  const profile = fs.readFileSync(
    path.join(root, "src/styles/AdminHrEmployeeProfilePage.css"),
    "utf8"
  );

  assert.match(
    profile,
    /\.employee-profile-page \.emp-hours-status input\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;[^}]*opacity:\s*0;/s
  );
});
