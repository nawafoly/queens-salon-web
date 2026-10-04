import fs from "node:fs";

const file = "scripts/apply-employee-lifecycle-integrity.mjs";
let source = fs.readFileSync(file, "utf8");
const startMarker = "// 9) Permanent regression gate: Arabic/canonical identity is mandatory across the employee lifecycle.";
const endMarker = "\nconsole.log(\"Employee lifecycle integrity source transformation applied.\");";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  throw new Error("Unable to locate temporary generated-guard block in lifecycle applicator");
}
source = source.slice(0, start) + source.slice(end + 1);
fs.writeFileSync(file, source);
console.log("Lifecycle applicator repaired.");
