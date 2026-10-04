import fs from "node:fs";

const file = "scripts/apply-employee-lifecycle-integrity.mjs";
let source = fs.readFileSync(file, "utf8");
const label = '"CoreHrService my profile mapping"';
const labelIndex = source.indexOf(label);
if (labelIndex < 0) throw new Error("CoreHrService profile mapping label not found");
const start = source.lastIndexOf("  source = replaceRegexOnce(", labelIndex);
const closeNeedle = "\n  );";
const close = source.indexOf(closeNeedle, labelIndex);
if (start < 0 || close < 0) throw new Error("CoreHrService profile mapping applicator block boundaries not found");
const end = close + closeNeedle.length;

const replacement = String.raw`  const profileMappingPattern = /    return \{\n      \.\.\.camel<CoreHrEmployee>\(row\),\n      schedules: Array\.isArray\(row\.schedules\)\n        \? row\.schedules\.map\(\(item\) => camel<CoreHrSchedule>\(item as Record<string, unknown>\)\)\n        : \[\],\n    \};/g;
  const profileMappingMatches = [...source.matchAll(profileMappingPattern)];
  if (profileMappingMatches.length !== 2) {
    throw new Error("CoreHrService profile mappings: expected 2 matches, found " + profileMappingMatches.length);
  }
  source = source.replace(profileMappingPattern, \`    return normalizeCoreEmployee(row);\`);`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source);
console.log("Lifecycle applicator profile mapping block repaired.");
