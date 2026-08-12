import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const routerPath = path.join(root, "src/pages/hr/EmployeeFiles.tsx");
const adminPath = path.join(root, "src/pages/hr/AdminFilesV2.tsx");
const legacyPath = path.join(root, "src/pages/hr/EmployeeFilesLegacy.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-files.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const router = fs.readFileSync(routerPath, "utf8");
const admin = fs.readFileSync(adminPath, "utf8");
const legacy = fs.readFileSync(legacyPath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(router, 'import AdminFilesV2 from "./AdminFilesV2"', "Files router must import AdminFilesV2.");
requireText(router, 'import EmployeeFilesLegacy from "./EmployeeFilesLegacy"', "Files router must preserve the employee legacy view.");
requireText(router, '/^\\/dashboard(?:\\/|$)/', "Files router must scope V2 to dashboard routes.");

requireText(admin, 'className="dashboard-v2 dsv2-page admin-files-v2-page"', "Admin files must use the Dashboard V2 page root.");
requireText(admin, "DashboardSelectV2", "Admin files must use DashboardSelectV2.");
requireText(admin, "DashboardFieldV2", "Admin files must use DashboardFieldV2.");
requireText(admin, "DashboardEmptyStateV2", "Admin files must use DashboardEmptyStateV2.");
requireText(admin, "DashboardSkeletonV2", "Admin files must use DashboardSkeletonV2.");
rejectText(admin, "<select", "Native select remains in AdminFilesV2.");
rejectText(admin, "hr-ops-", "Legacy HR ops classes remain in AdminFilesV2.");
rejectText(admin, "hr-file-", "Legacy HR file classes remain in AdminFilesV2.");

for (const guard of [
  "listEmployeeFiles(240)",
  "listEmployeeDirectory()",
  "uploadFileToR2",
  "createEmployeeFileRecord",
  "createEmployeeNotification",
  'route: "/employee/files"',
  'keyPrefix: "employee-files"',
]) {
  requireText(admin, guard, `Admin files business-logic guard missing: ${guard}`);
  requireText(legacy, guard, `Employee files legacy guard missing: ${guard}`);
}

requireText(admin, 'item.direction !== "inbound" && !employeeHasRead(item)', "Admin unread metric must track employee read state for outbound files.");
requireText(admin, "employee?.linkedUid", "Admin file read-state must resolve employee identity aliases.");
requireText(legacy, "onPortalChange", "Employee legacy files must retain onPortalChange behavior.");
requireText(legacy, "hr-ops-page", "Employee legacy files presentation must remain preserved.");

requireText(style, ".admin-files-v2-page", "Admin files stylesheet is missing its page scope.");
requireText(style, "@media (max-width: 820px)", "Admin files stylesheet must define tablet/mobile behavior.");
requireText(style, "@media (max-width: 560px)", "Admin files stylesheet must define compact mobile behavior.");
if (/!important\b/.test(style)) failures.push("admin-files.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-files.css contains a raw hex color.");

requireText(entry, '@import "./pages/admin-files.css";', "dashboard-v2.css must import admin-files.css.");

if (failures.length) {
  console.error("Dashboard files V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard files V2 migration guard passed.");
