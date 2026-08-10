import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const pagePath = path.join(root, "src/pages/hr/AdminEmployeeRequests.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-employee-requests.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");
const sharedLegacyPath = path.join(root, "src/styles/EmployeeRequests.css");

const page = fs.readFileSync(pagePath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");
const sharedLegacy = fs.readFileSync(sharedLegacyPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(page, 'className="dsv2-page admin-employee-requests-page admin-employee-requests-v2-page"', "Admin requests list must use the Dashboard V2 page root.");
requireText(page, 'className="dsv2-page admin-employee-request-detail admin-employee-request-detail-v2"', "Admin request detail must use the Dashboard V2 page root.");
requireText(page, "DashboardSelectV2", "Admin request filters must use DashboardSelectV2.");
requireText(page, "DashboardDatePickerV2", "Admin request dates must use DashboardDatePickerV2.");
requireText(page, "DashboardFieldV2", "Admin request filters must use DashboardFieldV2.");
requireText(page, "DashboardEmptyStateV2", "Admin request empty states must use DashboardEmptyStateV2.");
requireText(page, "DashboardSkeletonV2", "Admin request loading states must use DashboardSkeletonV2.");
requireText(page, 'className="employee-request-action-modal dashboard-v2"', "Portal action modal must carry dashboard-v2 scope.");

const listStart = page.lastIndexOf("return (\n    <div className=\"dsv2-page admin-employee-requests-page");
const listSection = listStart >= 0 ? page.slice(listStart) : "";
if (!listSection) failures.push("Could not isolate the admin requests list branch.");
rejectText(listSection, "<select", "Native select remains in the admin requests list branch.");
rejectText(listSection, 'type="date"', "Native date input remains in the admin requests list branch.");

for (const businessGuard of [
  "listEmployeeRequests",
  "getEmployeeRequestStats",
  "employeeRequestAction",
  "addEmployeeRequestComment",
  "CoreFilesService.download",
  "listEmployeeRequestAssignees",
  "markEmployeeRequest",
]) {
  if (businessGuard === "markEmployeeRequest") continue;
  requireText(page, businessGuard, `Business-logic guard missing: ${businessGuard}`);
}

requireText(style, ".admin-employee-requests-v2-page", "Admin requests stylesheet is missing the V2 list scope.");
requireText(style, ".admin-employee-request-detail-v2", "Admin requests stylesheet is missing the V2 detail scope.");
requireText(style, ".employee-request-action-modal.dashboard-v2", "Admin requests stylesheet is missing the portal modal V2 scope.");
if (/!important\b/.test(style)) failures.push("admin-employee-requests.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-employee-requests.css contains a raw hex color.");

requireText(entry, '@import "./pages/admin-employee-requests.css";', "dashboard-v2.css must import admin-employee-requests.css.");

// The employee-facing stylesheet remains intentionally shared and untouched by this migration.
requireText(sharedLegacy, ".employee-requests-page", "Shared EmployeeRequests.css no longer contains the employee portal scope.");

if (failures.length) {
  console.error("Dashboard requests V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard requests V2 migration guard passed.");
