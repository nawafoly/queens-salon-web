import fs from "node:fs";

const file = "scripts/apply-employee-lifecycle-payroll-integrity.mjs";
let source = fs.readFileSync(file, "utf8");

const badBlock = `  source = replaceOnce(
    source,
    "  const employeeId = cleanText(query.employeeId || query.employee_id);\\n  const sourcePayrollMonth = cleanText(",
    "  const employeeId = normalizeId(query.employeeId || query.employee_id);\\n  const sourcePayrollMonth = cleanText(",
    "canonical partial deferral list employee id",
  );
`;

if (!source.includes(badBlock)) {
  throw new Error("Misplaced partial-deferral applicator block not found");
}
source = source.replace(badBlock, "");

const marker = `// Employee request identity and salary-advance execution use canonical rules.\n`;
if (!source.includes(marker)) throw new Error("Employee request marker not found");

const correctBlock = `// Generic payroll deduction deferrals use the same canonical employee identity.\n{\n  const file = "workers/core/repositories/payroll-deduction-deferrals.js";\n  let source = read(file);\n  source = replaceOnce(\n    source,\n    "  nowIso,\\n  optionalText,",\n    "  nowIso,\\n  normalizeId,\\n  optionalText,",\n    "payroll deferral normalizeId import",\n  );\n  source = replaceOnce(\n    source,\n    "  const employeeId = cleanText(query.employeeId || query.employee_id);",\n    "  const employeeId = normalizeId(query.employeeId || query.employee_id);",\n    "canonical partial deferral list employee id",\n  );\n  source = replaceOnce(\n    source,\n    "      .filter((row) => !employeeId || row.employee_id === employeeId)",\n    "      .filter((row) => !employeeId || normalizeId(row.employee_id) === employeeId)",\n    "canonical fake partial deferral filter",\n  );\n  write(file, source);\n}\n\n`;

source = source.replace(marker, correctBlock + marker);
fs.writeFileSync(file, source);
console.log("Payroll lifecycle applicator domain targeting repaired.");
