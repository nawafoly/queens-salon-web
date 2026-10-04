import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const dashboardFiles = [
  ...fs.readdirSync(path.join(root, "src/pages"))
    .filter((name) => /^Dashboard.*\.(ts|tsx)$/.test(name))
    .map((name) => `src/pages/${name}`),
  ...walk("src/pages/dashboardEmployees"),
  ...walk("src/pages/hr"),
  ...walk("src/pages/settings"),
  ...walk("src/components/dashboard-v2"),
  ...walk("src/features/internal-booking-v2"),
  "src/components/packages/ClientPackagesPanel.tsx",
].filter((file) => /\.(ts|tsx)$/.test(file) && fs.existsSync(path.join(root, file)));

for (const file of [...new Set(dashboardFiles)]) {
  const source = executableSource(read(file));
  if (/\b(?:window\.)?alert\s*\(/.test(source)) {
    failures.push(`${file}: native alert() is forbidden in dashboard workflows; use contextual feedback.`);
  }
}

const coreApi = read("src/services/coreApiClient.ts");
for (const code of [
  "core_payroll:employer_loan_deduction_cap_exceeded",
  "core_payroll:aggregate_deduction_cap_exceeded",
  "core_payroll:judicial_deduction_cap_exceeded",
]) {
  if (!coreApi.includes(`\"${code}\"`)) failures.push(`coreApiClient is missing a user-facing mapping for ${code}.`);
}
const safeFallbackIndex = coreApi.indexOf("const safeFallback = String(fallback || \"\").trim();");
const conflictFallbackIndex = coreApi.indexOf("if (status === 409)");
if (safeFallbackIndex < 0 || conflictFallbackIndex < 0 || safeFallbackIndex > conflictFallbackIndex) {
  failures.push("coreApiClient must preserve a safe domain fallback before the generic 409 message.");
}

const payroll = read("src/pages/DashboardPayroll.tsx");
for (const guard of [
  "setPayrollRowFeedback",
  "setApprovalConfirmationError",
  "قسط أو استقطاع سلفة جهة العمل يتجاوز الحد النظامي البالغ 10%",
  'title={payrollRowFeedback.title}',
]) {
  if (!payroll.includes(guard)) failures.push(`DashboardPayroll contextual feedback guard missing: ${guard}`);
}
if (/catch \(actionError: any\) \{\s*setError\(payrollActionErrorMessage\(actionError, \"تعذر اعتماد الراتب\./m.test(payroll)) {
  failures.push("Standard payroll approval must not send approval failures to the page-global error state.");
}

const employees = read("src/pages/DashboardEmployees.tsx");
if (!employees.includes("if (!errorMsg || isOpen) return;")) failures.push("Employee editor failures must not be consumed by the top-level toast while the editor is open.");
if (!employees.includes('actionError={isOpen ? errorMsg : ""}')) failures.push("DashboardEmployees must pass the active save error into the employee editor context.");

const editor = read("src/pages/dashboardEmployees/EmployeeEditorModal.tsx");
if (!editor.includes("DashboardActionFeedbackV2") || !editor.includes("actionError")) {
  failures.push("EmployeeEditorModal must render contextual action failure feedback near the save workflow.");
}

const bookings = read("src/pages/DashboardBookings.tsx");
if (!bookings.includes("DashboardActionFeedbackV2") || !bookings.includes("bookingActionFeedback")) {
  failures.push("DashboardBookings must keep booking action results next to the affected booking.");
}

const requests = read("src/pages/hr/EmployeeRequests.tsx");
if (!requests.includes("successWarning") || !requests.includes("creationWarning")) {
  failures.push("EmployeeRequests must surface attachment partial-success reasons in-app.");
}

const workspace = read("src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceCoreTabsLiveV2.tsx");
if (!workspace.includes("bookingVisibilityError") || !workspace.includes("DashboardActionFeedbackV2")) {
  failures.push("Employee workspace booking visibility denial must be contextual.");
}

if (failures.length) {
  console.error("Dashboard action feedback guard failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Dashboard action feedback guard passed across ${new Set(dashboardFiles).size} dashboard source files.`);
