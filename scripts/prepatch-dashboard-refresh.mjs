import { readFileSync, writeFileSync } from "node:fs";

const path = "src/pages/Dashboard.tsx";
let source = readFileSync(path, "utf8");
const replacement = `      // refreshWarning above is the contextual user-facing failure.\n      // Do not duplicate it with a native browser alert.`;

if (!source.includes(replacement)) {
  const pattern = /\n\s*if \(!options\?\.silent && !hasDashboardDataRef\.current\) \{\s*alert\(`❌ Dashboard Refresh Failed[\s\S]*?`\);\s*\}/;
  if (!pattern.test(source)) {
    throw new Error("Dashboard refresh native alert block was not found.");
  }
  source = source.replace(pattern, `\n${replacement}`);
  writeFileSync(path, source, "utf8");
}

console.log("Removed duplicate dashboard native refresh alert.");
