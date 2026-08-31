import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcRoot = path.join(root, "src");
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      out.push(...walk(full));
    } else if (exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function managed(relative) {
  if (/Legacy/i.test(relative)) return false;

  return (
    /^src\/pages\/Dashboard[^/]*\.(?:ts|tsx|js|jsx)$/.test(relative) ||
    relative.startsWith("src/pages/dashboardEmployees/") ||
    relative.startsWith("src/pages/payroll/") ||
    relative.startsWith("src/pages/settings/") ||
    relative.startsWith("src/pages/hr/") ||
    relative.startsWith("src/components/dashboard-v2/") ||
    relative.startsWith("src/components/hr/") ||
    relative.startsWith("src/features/internal-booking-v2/") ||
    relative.startsWith("src/features/customers/") ||
    relative === "src/components/packages/AdminPackageFlow.tsx" ||
    relative === "src/components/LeaveRequestModal.tsx"
  );
}

function parse(file, source) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") || file.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );
}

function getAttr(openingLike, key) {
  return openingLike.attributes.properties.find(
    (prop) =>
      ts.isJsxAttribute(prop) &&
      prop.name.getText() === key
  );
}

function getLiteralAttr(openingLike, key) {
  const attr = getAttr(openingLike, key);
  if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer) return null;

  if (
    ts.isStringLiteral(attr.initializer) ||
    ts.isNoSubstitutionTemplateLiteral(attr.initializer)
  ) {
    return attr.initializer.text;
  }

  return null;
}

test("Dashboard V2 managed surfaces use canonical select/date/time/month controls", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    if (!/\.(tsx|jsx)$/.test(file)) continue;

    const relative = rel(file);
    if (!managed(relative)) continue;
    if (relative.endsWith("DashboardNativeControlBridgeV2.tsx")) continue;

    const source = fs.readFileSync(file, "utf8");
    const sf = parse(file, source);

    function visit(node) {
      if (
        ts.isJsxElement(node) &&
        node.openingElement.tagName.getText(sf) === "select"
      ) {
        violations.push(relative + ": native-select");
      }

      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(sf) === "input"
      ) {
        const type = getLiteralAttr(node, "type");

        if (["date", "time", "month"].includes(String(type))) {
          violations.push(relative + ": native-" + type);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  assert.deepEqual([...new Set(violations)], []);
});

test("native numeric/date/time/month JSX inputs use English input locale", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    if (!/\.(tsx|jsx)$/.test(file)) continue;

    const relative = rel(file);
    const source = fs.readFileSync(file, "utf8");
    const sf = parse(file, source);

    function visit(node) {
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(sf) === "input"
      ) {
        const type = getLiteralAttr(node, "type");

        if (["number", "date", "time", "month"].includes(String(type))) {
          const lang = getLiteralAttr(node, "lang");
          const dir = getLiteralAttr(node, "dir");

          if (lang !== "en" || dir !== "ltr") {
            const line =
              sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

            violations.push(
              relative + ":" + line + ": " + type
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  assert.deepEqual([...new Set(violations)], []);
});

test("Arabic UI locale formatters explicitly use Latin numbering", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    const relative = rel(file);
    const source = fs.readFileSync(file, "utf8");

    const matches = [
      ...source.matchAll(
        /Intl\.(?:NumberFormat|DateTimeFormat)\(\s*["'](ar[^"']*)["']/g
      ),
      ...source.matchAll(
        /\.toLocale(?:String|DateString|TimeString)\(\s*["'](ar[^"']*)["']/g
      ),
    ];

    for (const match of matches) {
      if (!/nu-latn/i.test(match[1])) {
        violations.push(relative + ": " + match[1]);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("payroll actions popover is anchored to the trigger", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/DashboardPayroll.tsx"),
    "utf8"
  );

  assert.match(source, /placement: "above" \| "below"/);
  assert.match(
    source,
    /const top = placement === "below" \? rect\.bottom \+ gap : rect\.top - gap/
  );
  assert.match(source, /translateY\(-100%\)/);
  assert.doesNotMatch(source, /rect\.top - estimatedHeight - gap/);
});
