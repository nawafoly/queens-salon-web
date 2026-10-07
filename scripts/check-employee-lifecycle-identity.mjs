import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireText = (file, text, message) => {
  if (!read(file).includes(text)) failures.push(message);
};
const reject = (file, regex, message) => {
  if (regex.test(read(file))) failures.push(message);
};

const helper = read("src/helpers/employeeIdentityId.ts");
for (const symbol of [
  "normalizeEmployeeIdentityId",
  "isCanonicalEmployeeIdentityId",
  "employeeIdentityEquals",
  "normalizeEmployeeIdentityIds",
]) {
  if (!helper.includes("export function " + symbol)) {
    failures.push("Missing canonical employee identity primitive: " + symbol);
  }
}

for (const file of [
  "src/pages/dashboardEmployees/AttendanceSection.tsx",
  "src/pages/dashboardEmployees/ShiftControlSection.tsx",
  "src/pages/DashboardAttendanceSecurity.tsx",
]) {
  reject(file, /\^\[A-Za-z0-9_-\]\+\$/, file + ": ASCII-only employee id validation is forbidden.");
  requireText(file, "isCanonicalEmployeeIdentityId", file + ": canonical employee id validator is required.");
}

for (const file of [
  "src/services/CoreHrService.ts",
  "src/services/CoreStaffService.ts",
  "src/services/CoreAccountService.ts",
  "src/services/employeeDirectory.ts",
  "src/pages/DashboardEmployees.tsx",
]) {
  requireText(file, "normalizeEmployeeIdentityId", file + ": employee identity must be normalized at this lifecycle boundary.");
}

requireText(
  "src/pages/DashboardEmployees.tsx",
  "const employeeId = normalizeEmployeeIdentityId(canonicalEmployeeId);",
  "DashboardEmployees must collapse Core HR/Core staff aliases before list dedupe."
);
requireText(
  "src/services/CoreStaffService.ts",
  "mergeCanonicalStaffRows",
  "Core staff projection must dedupe canonical employee aliases globally."
);
requireText(
  "workers/core/d1.js",
  "canonicalizeEmployeeProfileRows",
  "Core D1 employee list must collapse legacy encoded profile aliases."
);

if (failures.length) {
  console.error("Employee lifecycle identity guard failed:\n");
  failures.forEach((failure) => console.error("- " + failure));
  process.exit(1);
}

console.log("Employee lifecycle identity guard passed.");
