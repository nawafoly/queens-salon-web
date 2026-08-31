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

function normSelector(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function getRule(file, selector) {
  const full = path.join(root, file);
  const css = fs.readFileSync(full, "utf8");
  const ast = postcss.parse(css, { from: full });
  const matches = [];
  ast.walkRules((rule) => {
    if (normSelector(rule.selector) === normSelector(selector)) matches.push(rule);
  });
  assert.equal(matches.length, 1, file + ": " + selector);
  return matches[0];
}

function getDecl(rule, prop) {
  const hits = [];
  rule.walkDecls(prop, (decl) => hits.push(decl));
  assert.equal(hits.length, 1, rule.selector + ": " + prop);
  return hits[0];
}

function rgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function luminance(hex) {
  const weights = [0.2126, 0.7152, 0.0722];
  return rgb(hex)
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, i) => sum + value * weights[i], 0);
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const cases = [
  ["src/index.css", ".flag.pending", "color", "#b54708"],
  ["src/index.css", ".booking-page .booking-cart-item-locked__badge", "background", "#15803d"],
  ["src/styles/DashboardSkin.css", ".employee-attendance-side em", "color", "#475569"],
  ["src/styles/DashboardSkin.css", ".offers-modal .dash-pill.dash-pill-primary", "color", "#ffffff"],
  ["src/styles/DashboardSkin.css", ".offers-modal .dash-pill.dash-pill-primary svg", "color", "#ffffff"],
  ["src/styles/DashboardSkin.css", ".loyalty-page .dash-table .points-badge", "color", "#9a3412"],
  ["src/styles/EmployeePortalMobileNav.css", ".employee-portal.madan-employee-portal .employee-notifications-page .employee-muted", "color", "#475569"],
  ["src/styles/MadanAdminTheme.css", ":is(.hr-shell.madan-admin-shell, .employee-portal) .hr-ops-search input", "color", "#334155"],
  ["src/styles/MadanAdminTheme.css", ".dashboard-skin.madan-admin-shell .accounts-page--settings .account-editor-v4__tabs button.is-active span", "color", "#101828"],
  ["src/styles/PartnerPortal.css", ".partner-portal-card--permissions li", "color", "#5f6b7a"],
];

test("confirmed P1 selectors use their corrected values", () => {
  for (const [file, selector, prop, expected] of cases) {
    const rule = getRule(file, selector);
    const decl = getDecl(rule, prop);
    assert.equal(decl.value.toLowerCase(), expected.toLowerCase());
  }
});

test("confirmed text-bearing contrast pairs meet 4.5:1", () => {
  const pairs = [
    ["#b54708", "#fff3e0"],
    ["#ffffff", "#15803d"],
    ["#ffffff", "#40010D"],
    ["#475569", "#ffffff"],
    ["#9a3412", "#fff8e1"],
    ["#5f6b7a", "#f3f5f7"],
    ["#101828", "#c79223"],
    ["#334155", "#ffffff"],
  ];

  for (const [fg, bg] of pairs) {
    assert.ok(
      contrast(fg, bg) >= 4.5,
      fg + " on " + bg + " failed contrast"
    );
  }
});

test("booking locked badge keeps forced white text", () => {
  const rule = getRule(
    "src/index.css",
    ".booking-page .booking-cart-item-locked__badge"
  );

  const color = getDecl(rule, "color");
  const fill = getDecl(rule, "-webkit-text-fill-color");

  assert.equal(color.value.toLowerCase(), "#ffffff");
  assert.equal(color.important, true);
  assert.equal(fill.value.toLowerCase(), "#ffffff");
  assert.equal(fill.important, true);
});
