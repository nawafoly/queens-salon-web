import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const entryPath = join(root, "src/styles/dashboard-v2/dashboard-v2.css");
const pageDir = join(root, "src/styles/dashboard-v2/pages");
const targetPageFiles = [
  "overview.css",
  "employees.css",
  "employee-workspace.css",
  "payroll.css",
  "reports.css",
  "expenses.css",
  "income.css",
  "bookings.css",
  "clients.css",
  "loyalty.css",
  "employee-targets.css",
  "staff-performance.css",
  "attendance.css",
  "offers.css",
  "offers-refinement.css",
  "logs.css",
  "tv-queue.css",
  "day-audit.css",
  "partners.css",
  "settings.css",
];
const deletedLegacyFiles = [
  "src/styles/AdminDashboardBookings.css",
  "src/styles/AdminDashboardEmployees.css",
  "src/styles/AdminDashboardExpenses.css",
  "src/styles/AdminDashboardIncome.css",
  "src/styles/AdminDashboardPartners.css",
  "src/styles/AdminDashboardReports.css",
  "src/styles/DashboardBookingsEnterprise.css",
  "src/styles/DashboardPayroll.css",
  "src/styles/dashboard/dashboard-bookings.css",
  "src/styles/dashboard/dashboard-employees.css",
  "src/styles/dashboard/dashboard-reports.css",
  "src/styles/dashboard-v2/pages/employee-workspace-review-fixes-v2.css",
  "src/styles/dashboard-v2/pages/employee-workspace-live-v2.css",
  "src/styles/dashboard-v2/pages/employee-attendance-edit-live-v2.css",
  "src/styles/dashboard-v2/pages/employee-workspace-background-cleanup.css",
  "src/styles/dashboard-v2/pages/employee-confirm-replacement-v2.css",
  "src/styles/dashboard-v2/pages/employee-messages-live-v2.css",
];
const globalLegacyFiles = [
  "src/styles/DashboardSkin.css",
  "src/styles/MadanAdminTheme.css",
  "src/styles/AdminDashboardShell.css",
  "src/styles/DashboardEnterpriseWorkspacesV2.css",
];
const forbiddenGlobalMarkers = [
  ".reports-v2",
  ".dsv2-reports-page",
  ".bookings-v2",
  ".dsv2-bookings",
  ".dsv2-payroll-page",
  ".expenses-v2",
  ".income-v2",
  ".employees-v2",
  ".overview-v2",
];
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(entryPath)) {
  errors.push("Missing Dashboard V2 CSS entry point.");
} else {
  const entry = readFileSync(entryPath, "utf8");
  for (const file of targetPageFiles) {
    const importLine = `@import \"./pages/${file}\";`;
    if (!entry.includes(importLine)) errors.push(`Entry point is missing ${file}.`);
  }
}

for (const file of targetPageFiles) {
  const path = join(pageDir, file);
  if (!existsSync(path)) {
    errors.push(`Missing canonical page stylesheet: ${file}`);
    continue;
  }
  const css = readFileSync(path, "utf8");
  if (/#[0-9a-f]{3,8}\b/i.test(css)) errors.push(`${file} contains a raw hex color.`);
  if (/!important\b/i.test(css)) errors.push(`${file} contains !important.`);
  if (!css.includes(".dashboard-v2")) errors.push(`${file} is not scoped under .dashboard-v2.`);
}

for (const legacy of deletedLegacyFiles) {
  if (existsSync(join(root, legacy))) errors.push(`Legacy stylesheet still exists: ${legacy}`);
}

for (const file of globalLegacyFiles) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const css = readFileSync(path, "utf8");
  for (const marker of forbiddenGlobalMarkers) {
    if (css.includes(marker)) errors.push(`${file} still targets ${marker}.`);
  }
}

const sourceFiles = walk(join(root, "src")).filter((path) => /\.(ts|tsx|js|jsx)$/i.test(path));
for (const path of sourceFiles) {
  const source = readFileSync(path, "utf8");
  if (/styles\/dashboard-v2\/pages\/[^"']+\.css/i.test(source)) {
    errors.push(`${relative(root, path)} imports a page stylesheet directly.`);
  }
}

const bookingsSource = readFileSync(join(root, "src/pages/DashboardBookings.tsx"), "utf8");
if (/style=\{\{/i.test(bookingsSource)) errors.push("DashboardBookings.tsx still contains inline style objects.");
if (/#[0-9a-f]{3,8}\b/i.test(bookingsSource)) errors.push("DashboardBookings.tsx still contains raw hex colors.");

const settingsSource = readFileSync(join(root, "src/pages/DashboardSettings.tsx"), "utf8");
if (/DashboardEnterpriseWorkspaces\.css/i.test(settingsSource)) {
  errors.push("DashboardSettings.tsx still imports DashboardEnterpriseWorkspaces.css.");
}
if (!/styles\/dashboard-v2\/dashboard-v2\.css/i.test(settingsSource)) {
  errors.push("DashboardSettings.tsx is not wired to the Dashboard V2 entry point.");
}

if (errors.length) {
  console.error("Dashboard V2 style contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Dashboard V2 style contract passed for ${targetPageFiles.length} canonical stylesheets.`);