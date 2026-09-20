import fs from "node:fs";
import path from "node:path";
import { translateBookingCatalogLabel } from "../src/helpers/dashboardBookingsLanguage.ts";

const ARABIC_RE = /[\u0600-\u06FF]/;

const exactCases = new Map<string, string>([
  ["قسم بديكير و منيكير", "Pedicure & manicure"],
  ["ميك اب", "Makeup"],
  ["استشوار شعر قصير جداً", "Extra-short-hair blow-dry"],
  ["تساريح اميرات سن ٨ الى ١٣", "Princess hairstyle (ages 8–13)"],
  ["تسريحة شعر طويل", "Long-hair styling"],
  ["تسريحة شعر قصير", "Short-hair styling"],
  ["تسريحة شعر متوسط", "Medium-hair styling"],
  ["قص شعر اطراف", "Hair ends trim"],
  ["قص شعر طول واحد", "One-length haircut"],
  ["قسم الصبغات والمعالجات", "Color & treatments"],
  ["صبغة لون واحد شعر طويل", "Single-color dye — long hair"],
  ["سحب لون مع صبغة شعر متوسط", "Color removal + dye — medium hair"],
  ["تركيب رموش", "Lash application"],
  ["واكس جسم كامل", "Full-body waxing"],
]);

for (const [arabic, expected] of exactCases) {
  const actual = translateBookingCatalogLabel("en", arabic, arabic.startsWith("قسم ") ? "section" : "service");
  if (actual !== expected) {
    throw new Error("catalog translation mismatch: " + arabic + " => " + actual + " (expected " + expected + ")");
  }
}

const sourcePaths = [
  "src/pages/Pricing.tsx",
  "src/helpers/servicesCatalog.ts",
  "src/helpers/serviceIcons.ts",
  "src/components/dashboard-v2/employee-workspace/EmployeeWorkspaceProfileTabsV2.tsx",
];

const candidates = new Set<string>(exactCases.keys());
for (const relative of sourcePaths) {
  const full = path.resolve(process.cwd(), relative);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, "utf8");
  for (const match of source.matchAll(/["'`]([^"'\n`]*[\u0600-\u06FF][^"'\n`]*)["'`]/g)) {
    const value = String(match[1] || "").trim();
    if (value && value.length <= 120) candidates.add(value);
  }
}

const failures: Array<{ source: string; translated: string }> = [];
for (const source of candidates) {
  const translated = translateBookingCatalogLabel("en", source, source.startsWith("قسم ") ? "section" : "service");
  if (ARABIC_RE.test(translated)) failures.push({ source, translated });
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  throw new Error("English catalog output still contains Arabic characters.");
}

console.log("booking catalog i18n coverage OK:", candidates.size, "labels checked");
