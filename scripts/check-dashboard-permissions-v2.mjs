import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const pagePath = path.join(root, "src/pages/hr/AdminPermissionRequests.tsx");
const employeePagePath = path.join(root, "src/pages/hr/EmployeePermissionRequests.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-permission-requests.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const page = fs.readFileSync(pagePath, "utf8");
const employeePage = fs.readFileSync(employeePagePath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(
  page,
  'className="dashboard-v2 dsv2-page admin-permission-v2-page"',
  "Admin permissions page must use the Dashboard V2 page root."
);
requireText(page, "DashboardModalV2", "Admin permissions must use DashboardModalV2.");
requireText(page, "DashboardSelectV2", "Admin permissions must use DashboardSelectV2.");
requireText(page, "DashboardDatePickerV2", "Admin permissions must use DashboardDatePickerV2.");
requireText(page, "DashboardFieldV2", "Admin permissions must use DashboardFieldV2.");
requireText(page, "DashboardEmptyStateV2", "Admin permissions must use DashboardEmptyStateV2.");
requireText(page, "DashboardSkeletonV2", "Admin permissions must use DashboardSkeletonV2.");
rejectText(
  page,
  'import "../../styles/EmployeePermissionRequests.css"',
  "Admin permissions must not import the employee-facing legacy stylesheet."
);
rejectText(page, "<select", "Native select remains in the admin permissions page.");
rejectText(page, 'type="date"', "Native date input remains in the admin permissions page.");
rejectText(
  page,
  "window.setInterval(() => void load(), 15_000)",
  "Admin permissions must not restore fixed-interval polling."
);

for (const guard of [
  "listEmployeeDirectory",
  "listEmployeePermissionRequests(300)",
  "createPermissionRequest",
  "reviewPermissionRequest",
  'window.addEventListener("focus", refreshWhenActive)',
  'window.addEventListener("online", refreshWhenActive)',
  'document.addEventListener("visibilitychange", refreshWhenActive)',
  "expected <= start",
  'source: "admin_direct"',
  'status: "out"',
]) {
  requireText(page, guard, `Business-logic guard missing: ${guard}`);
}

requireText(
  employeePage,
  'import "../../styles/EmployeePermissionRequests.css"',
  "Employee permission page must retain its legacy stylesheet during the admin migration."
);
requireText(style, ".admin-permission-v2-page", "Permissions V2 stylesheet is missing its page scope.");
if (/!important\b/.test(style)) failures.push("admin-permission-requests.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-permission-requests.css contains a raw hex color.");
requireText(
  entry,
  '@import "./pages/admin-permission-requests.css";',
  "dashboard-v2.css must import admin-permission-requests.css."
);

if (failures.length) {
  console.error("Dashboard permissions V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard permissions V2 migration guard passed.");
