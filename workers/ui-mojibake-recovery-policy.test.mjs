import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcRoot = path.join(root, "src");

const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html"]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", "coverage"].includes(entry.name)) continue;
      out.push(...walk(full));
    } else if (exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const suspicious = [
  /ط[§¥±²³µ¶·¼½¾Œœ€†‡‰‹›™­]/u,
  /ظ[§¥±²³µ¶·¼½¾Œœ€†‡‰‹›™­]/u,
  /â(?:€”|€“|€¢|œ…|€™|€œ|€|†’|†گ|œ…)/u,
  /Ã./u,
  /Â./u,
  /Ø[\u0080-\u00FF]/u,
  /Ù[\u0080-\u00FF]/u,
  /\uFFFD/u,
];

test("source has no high-confidence mojibake markers", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (suspicious.some((pattern) => pattern.test(line))) {
        violations.push(
          path.relative(root, file).replaceAll("\\", "/") +
            ":" +
            (index + 1) +
            " " +
            line.trim().slice(0, 180)
        );
      }
    });
  }

  assert.deepEqual(violations, []);
});

test("ClientPackagesPanel Arabic UI is clean", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/packages/ClientPackagesPanel.tsx"),
    "utf8"
  );

  for (const text of [
    "شراء",
    "حجز",
    "استخدام",
    "إلغاء واسترجاع",
    "الحالة:",
    "فاتورة:",
    "الباقات والجلسات",
    "لا يوجد clientId ثابت لهذا الملف",
  ]) {
    assert.ok(source.includes(text), "Missing expected clean Arabic: " + text);
  }
});
