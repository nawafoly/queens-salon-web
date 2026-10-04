import fs from "node:fs";

const file = "scripts/apply-employee-lifecycle-integrity.mjs";
let source = fs.readFileSync(file, "utf8");
const startNeedle = "  source = replaceRegexOnce(\n    source,\n    /    return \\\\{";
const labelNeedle = '    "CoreHrService my profile mapping",\n  );';
const start = source.indexOf(startNeedle);
const label = source.indexOf(labelNeedle, start);
if (start < 0 || label < 0) {
  throw new Error("Unable to locate CoreHrService profile mapping applicator block");
}
const end = label + labelNeedle.length;
const replacement = `  const profileMappingPattern = /    return \\{\\n      \\.\\.\\.camel<CoreHrEmployee>\\(row\\),\\n      schedules: Array\\.isArray\\(row\\.schedules\\)\\n        \\? row\\.schedules\\.map\\(\\(item\\) => camel<CoreHrSchedule>\\(item as Record<string, unknown>\\)\\)\\n        : \\[\\],\\n    \\};/g;\n  const profileMappingMatches = [...source.matchAll(profileMappingPattern)];\n  if (profileMappingMatches.length !== 2) {\n    throw new Error(\"CoreHrService profile mappings: expected 2 matches, found \" + profileMappingMatches.length);\n  }\n  source = source.replace(profileMappingPattern, \`    return normalizeCoreEmployee(row);\`);`;
source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source);
console.log("Lifecycle CoreHr profile applicator repaired.");
