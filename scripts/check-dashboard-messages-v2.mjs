import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const routerPath = path.join(root, "src/pages/hr/EmployeeMessages.tsx");
const adminPath = path.join(root, "src/pages/hr/AdminMessagesV2.tsx");
const legacyPath = path.join(root, "src/pages/hr/EmployeeMessagesLegacy.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-messages.css");
const metricStylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-messages-metrics.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");
const employeeHubPath = path.join(root, "src/services/employeeHub.ts");
const workforceRepoPath = path.join(root, "workers/core/repositories/workforce-communications.js");

const router = fs.readFileSync(routerPath, "utf8");
const admin = fs.readFileSync(adminPath, "utf8");
const legacy = fs.readFileSync(legacyPath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const metricStyle = fs.readFileSync(metricStylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");
const employeeHub = fs.readFileSync(employeeHubPath, "utf8");
const workforceRepo = fs.readFileSync(workforceRepoPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(router, 'import AdminMessagesV2 from "./AdminMessagesV2"', "Messages router must import AdminMessagesV2.");
requireText(router, 'import EmployeeMessagesLegacy from "./EmployeeMessagesLegacy"', "Messages router must preserve the employee legacy view.");
requireText(router, '/^\\/dashboard(?:\\/|$)/', "Messages router must scope the V2 view to dashboard routes.");

requireText(admin, 'className={`dashboard-v2 dsv2-page admin-messages-v2-page', "Admin messages must use the Dashboard V2 page root.");
requireText(admin, "DashboardSelectV2", "Admin messages must use DashboardSelectV2 for recipients.");
requireText(admin, "DashboardFieldV2", "Admin messages must use DashboardFieldV2.");
requireText(admin, "DashboardEmptyStateV2", "Admin messages must use DashboardEmptyStateV2.");
requireText(admin, "DashboardSkeletonV2", "Admin messages must use DashboardSkeletonV2.");
rejectText(admin, "<select", "Native select remains in AdminMessagesV2.");
rejectText(admin, "hr-ops-", "Legacy HR ops classes remain in AdminMessagesV2.");
rejectText(admin, "hr-comms-", "Legacy communications classes remain in AdminMessagesV2.");

for (const guard of [
  "listEmployeeDirectory()",
  "listEmployeeMessages(500)",
  "listEmployeeNotifications",
  "markEmployeeNotificationsRead",
  "markEmployeeThreadRead",
  "createEmployeeMessage",
  'item.route === "/employee/messages"',
  "makeConversationId(session.uid, toUid)",
]) {
  requireText(admin, guard, `Admin messages business-logic guard missing: ${guard}`);
  requireText(legacy, guard, `Employee messages legacy guard missing: ${guard}`);
}

requireText(
  employeeHub,
  "CoreWorkforceService.listMessages(limitCount)",
  "Employee message listing must stay on CoreWorkforceService."
);
requireText(
  employeeHub,
  "CoreWorkforceService.createMessage({",
  "Employee message creation must stay on CoreWorkforceService."
);
requireText(
  workforceRepo,
  "route: '/employee/messages'",
  "Core workforce messaging must keep the employee messages notification route."
);
requireText(
  workforceRepo,
  "INSERT INTO employee_notifications",
  "Core workforce messaging must create the notification transactionally."
);

requireText(legacy, "onPortalChange", "Employee legacy messages must retain onPortalChange behavior.");
requireText(legacy, "hr-comms-page", "Employee legacy messages presentation must remain preserved.");

requireText(style, ".admin-messages-v2-page", "Admin messages stylesheet is missing its page scope.");
if (/!important\b/.test(style)) failures.push("admin-messages.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-messages.css contains a raw hex color.");

requireText(metricStyle, "inset-inline-start: auto;", "Admin messages KPI icon must not occupy the RTL copy side.");
requireText(metricStyle, "inset-inline-end: var(--dsv2-space-5);", "Admin messages KPI icon must stay on the opposite side of the copy.");
if (/!important\b/.test(metricStyle)) failures.push("admin-messages-metrics.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(metricStyle)) failures.push("admin-messages-metrics.css contains a raw hex color.");

requireText(entry, '@import "./pages/admin-messages.css";', "dashboard-v2.css must import admin-messages.css.");
requireText(entry, '@import "./pages/admin-messages-metrics.css";', "dashboard-v2.css must import admin-messages-metrics.css.");

if (failures.length) {
  console.error("Dashboard messages V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard messages V2 migration guard passed.");
