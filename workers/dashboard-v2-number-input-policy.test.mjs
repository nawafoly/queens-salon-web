import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcRoot = path.join(root, "src");
const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);

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
    relative === "src/pages/AdminHrDashboard.tsx" ||
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

function attr(node, key) {
  return node.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === key
  );
}

function staticAttr(node, key) {
  const found = attr(node, key);
  if (!found || !ts.isJsxAttribute(found) || !found.initializer) return null;
  if (ts.isStringLiteral(found.initializer)) return found.initializer.text;
  if (
    ts.isJsxExpression(found.initializer) &&
    found.initializer.expression &&
    ts.isStringLiteral(found.initializer.expression)
  ) {
    return found.initializer.expression.text;
  }
  return null;
}

test("managed Dashboard V2 has no native number inputs", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    if (!/\.(tsx|jsx)$/.test(file)) continue;
    const relative = rel(file);
    if (!managed(relative)) continue;
    if (relative.endsWith("DashboardNumberInputV2.tsx")) continue;

    const source = fs.readFileSync(file, "utf8");
    const sf = parse(file, source);

    function visit(node) {
      const opening =
        ts.isJsxSelfClosingElement(node)
          ? node
          : ts.isJsxElement(node)
            ? node.openingElement
            : null;

      if (
        opening &&
        opening.tagName.getText(sf) === "input" &&
        staticAttr(opening, "type") === "number"
      ) {
        const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1;
        violations.push(`${relative}:${line}`);
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  assert.deepEqual([...new Set(violations)], []);
});

test("canonical number input is text-backed and normalizes western digits", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/dashboard-v2/DashboardNumberInputV2.tsx"),
    "utf8"
  );

  assert.match(source, /type="text"/);
  assert.match(source, /inputMode=\{inputMode \?\? "decimal"\}/);
  assert.match(source, /normalizeWesternDigits/);
  assert.match(source, /lang="en-US"/);
  assert.match(source, /dir="ltr"/);
  assert.doesNotMatch(source, /type="number"/);
});
