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

function norm(v) {
  return String(v).trim().replace(/\s+/g, " ");
}

function rules(file, selector) {
  const full = path.join(root, file);
  const css = fs.readFileSync(full, "utf8");
  const ast = postcss.parse(css, { from: full });
  const out = [];
  ast.walkRules((rule) => {
    if (norm(rule.selector) === norm(selector)) out.push(rule);
  });
  return out;
}

function val(rule, prop) {
  const hits = [];
  rule.walkDecls(prop, (decl) => hits.push(decl));
  if (hits.length !== 1) return null;
  return hits[0].value.trim().toLowerCase();
}

function has(rule, expected) {
  return Object.entries(expected).every(
    ([prop, value]) => val(rule, prop) === String(value).toLowerCase()
  );
}

test("mobile employee KPI typography no longer uses 8px", () => {
  const selectors = [
    ".hr-shell.madan-admin-shell.hr-shell--employees .employees-page .emp-staff-kpi span, " +
      ".hr-shell.madan-admin-shell.hr-shell--employees .employees-page .emp-staff-kpi b",
    ".hr-shell--employees .emp-page-wrapper .emp-staff-kpi span, " +
      ".hr-shell--employees .emp-page-wrapper .emp-staff-kpi b",
  ];

  for (const selector of selectors) {
    const found = rules("src/styles/AdminHrEmployees.css", selector);
    assert.ok(found.some((rule) => has(rule, { "font-size": "10px", "line-height": "1.2" })));
    assert.equal(found.some((rule) => has(rule, { "font-size": "8px", "line-height": "1" })), false);
  }
});

test("mobile employee metadata readable override uses 10px", () => {
  const selector =
    ".hr-shell--employees .emp-page-wrapper :where(.emp-staff-meta-row span, .emp-staff-meta-row small)";
  const found = rules("src/styles/AdminHrEmployees.css", selector);
  assert.ok(found.some((rule) => has(rule, { "font-size": "10px" })));
  assert.equal(found.some((rule) => has(rule, { "font-size": "8px" })), false);
});

test("attendance weekday risky 0.55rem override is replaced without assuming selector uniqueness", () => {
  const selector =
    ".emp-editor-overlay.emp-editor-overlay--hr .employee-attendance-admin .attendance-month__weekdays span";
  const found = rules("src/styles/AdminHrEmployeeDetail.css", selector);

  assert.ok(
    found.some((rule) =>
      has(rule, {
        "font-size": "0.625rem",
        "line-height": "1.2",
        "color": "#8b97aa",
      })
    )
  );

  assert.equal(
    found.some((rule) =>
      has(rule, {
        "font-size": "0.55rem",
        "line-height": "1",
        "color": "#8b97aa",
      })
    ),
    false
  );
});

test("employee portal attendance labels use the readable floor", () => {
  const selectors = [
    ".dashboard-v2.employee-portal .employee-overview-v2-page.employee-attendance-month-page " +
      ".attendance-month--employee-portal-v2 .attendance-month__primary-status-label",
    ".dashboard-v2.employee-portal .employee-overview-v2-page.employee-attendance-month-page " +
      ".attendance-month--employee-portal-v2 .attendance-month__exception-label",
  ];

  for (const selector of selectors) {
    const found = rules(
      "src/styles/dashboard-v2/components/employee-attendance-month-status.css",
      selector
    );
    assert.ok(
      found.some((rule) =>
        has(rule, {
          "min-height": "18px",
          "font-size": "0.625rem",
          "line-height": "1.1",
        })
      )
    );
  }
});

test("intentional today micro-label remains unchanged", () => {
  const selector =
    ".emp-editor-overlay.emp-editor-overlay--hr .employee-attendance-admin .attendance-month__today-label";
  const found = rules("src/styles/AdminHrEmployeeDetail.css", selector);
  assert.ok(found.some((rule) => has(rule, { "font-size": "0.43rem" })));
});
