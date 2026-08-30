import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("UI formatting uses one Saudi Arabic locale with western digits", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const source = fs.readFileSync(file, "utf8");

    const forbidden = [
      /Intl\.(?:NumberFormat|DateTimeFormat)\(\s*["'](?:ar|ar-SA)["']/g,
      /\.toLocale(?:String|DateString|TimeString)\(\s*["'](?:ar|ar-SA)["']/g,
      /\.toLocale(?:String|DateString|TimeString)\(\s*\)/g,
      /Intl\.(?:NumberFormat|DateTimeFormat)\(\s*\)/g,
    ];

    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(rel);
        break;
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `found locale formatting outside the canonical western-digit policy: ${violations.join(", ")}`
  );

  const sample = new Intl.NumberFormat("ar-SA-u-nu-latn", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(4000);

  assert.match(sample, /4,000\.00/);
  assert.doesNotMatch(sample, /[٠-٩۰-۹]/);

  const payrollSource = fs.readFileSync(
    path.join(root, "src/helpers/hr/payrollCalculations.ts"),
    "utf8"
  );
  assert.match(payrollSource, /ar-SA-u-nu-latn/);

  const policySource = fs.readFileSync(
    path.join(root, "src/helpers/displayLocalePolicy.ts"),
    "utf8"
  );
  assert.match(policySource, /DISPLAY_LOCALE = "ar-SA-u-nu-latn"/);
});
