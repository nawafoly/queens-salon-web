import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcRoot = path.join(root, "src");

const extensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".html",
]);

const forbidden = [
  "طŒ",
  "ØŒ",
  "ط›",
  "Ø›",
  "طں",
  "ØŸ",
];

function walk(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      out.push(...walk(full));
      continue;
    }

    if (extensions.has(path.extname(entry.name))) {
      out.push(full);
    }
  }

  return out;
}

test("UI source contains no mojibake Arabic punctuation", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    const source = fs.readFileSync(file, "utf8");

    for (const token of forbidden) {
      if (source.includes(token)) {
        violations.push(
          path.relative(root, file).replaceAll("\\", "/") +
            ": " +
            token
        );
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("weekly-off UI no longer contains corrupted Arabic separators", () => {
  const file = path.join(
    root,
    "src/pages/dashboardEmployees/ShiftControlSection.tsx"
  );

  const source = fs.readFileSync(file, "utf8");

  assert.doesNotMatch(source, /طŒ|ØŒ|ط›|Ø›|طں|ØŸ/);
});
