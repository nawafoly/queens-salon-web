import fs from "node:fs";

const file = "scripts/apply-employee-lifecycle-integrity.mjs";
let source = fs.readFileSync(file, "utf8");
const bad = '  source = source.replace(profileMappingPattern, \\`    return normalizeCoreEmployee(row);\\`);';
const good = '  source = source.replace(profileMappingPattern, "    return normalizeCoreEmployee(row);");';
if (!source.includes(bad)) throw new Error("Expected malformed profile replacement line not found");
source = source.replace(bad, good);
fs.writeFileSync(file, source);
console.log("Lifecycle applicator syntax repaired.");
