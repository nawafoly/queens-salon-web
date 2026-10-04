import fs from "node:fs";

const file = "scripts/apply-employee-lifecycle-integrity.mjs";
let source = fs.readFileSync(file, "utf8");
const label = '"core staff id"';
const labelIndex = source.indexOf(label);
if (labelIndex < 0) throw new Error("core staff id applicator label not found");
const start = source.lastIndexOf("  source = replaceOnce(", labelIndex);
const closeNeedle = "\n  );";
const close = source.indexOf(closeNeedle, labelIndex);
if (start < 0 || close < 0) throw new Error("core staff id applicator block boundaries not found");
const end = close + closeNeedle.length;

const replacement = `  const mapCoreStaffIndex = source.indexOf("export function mapCoreStaff");\n  if (mapCoreStaffIndex < 0) throw new Error("mapCoreStaff function not found");\n  const staffReturnAnchor = \`  return {\\n    ...mapped,\\n    active: Number(row.active) === 1,\\n\`;\n  const staffReturnIndex = source.indexOf(staffReturnAnchor, mapCoreStaffIndex);\n  if (staffReturnIndex < 0) throw new Error("mapCoreStaff return anchor not found");\n  source =\n    source.slice(0, staffReturnIndex) +\n    \`  return {\\n    ...mapped,\\n    id: normalizeEmployeeIdentityId(mapped.id),\\n    active: Number(row.active) === 1,\\n\` +\n    source.slice(staffReturnIndex + staffReturnAnchor.length);`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source);
console.log("Lifecycle staff mapper applicator scoped.");
