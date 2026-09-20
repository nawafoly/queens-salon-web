import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const adminDashboardPath = path.join(root, "src/pages/AdminHrDashboard.tsx");
const employeePortalPath = path.join(root, "src/pages/EmployeePortal.tsx");
const adminPath = path.join(root, "src/pages/hr/AdminFilesV2.tsx");
const employeePath = path.join(root, "src/pages/hr/EmployeeFiles.tsx");
const coreServicePath = path.join(root, "src/services/employeeFilesCore.ts");
const workerPath = path.join(root, "workers/core/index.js");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-files.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const adminDashboard = fs.readFileSync(adminDashboardPath, "utf8");
const employeePortal = fs.readFileSync(employeePortalPath, "utf8");
const admin = fs.readFileSync(adminPath, "utf8");
const employee = fs.readFileSync(employeePath, "utf8");
const coreService = fs.readFileSync(coreServicePath, "utf8");
const worker = fs.readFileSync(workerPath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

// Route ownership: dashboard/admin uses the management workspace while the
// employee portal uses the self-service Core view. EmployeeFiles.tsx is no
// longer a route switch and must never fall back to the legacy implementation.
requireText(
  adminDashboard,
  'import AdminFilesV2 from "./hr/AdminFilesV2"',
  "Admin dashboard must import AdminFilesV2."
);
requireText(
  adminDashboard,
  '<AdminFilesV2 session={session} />',
  "Dashboard files route must render AdminFilesV2."
);
requireText(
  employeePortal,
  'import EmployeeFilesPage from "./hr/EmployeeFiles"',
  "Employee portal must import the Core EmployeeFiles page."
);
requireText(
  employeePortal,
  '<EmployeeFilesPage session={session} onPortalChange={loadNotifications} />',
  "Employee portal files route must preserve notification refresh behavior."
);

// Admin V2 presentation and Core-only business logic.
requireText(admin, 'className="dashboard-v2 dsv2-page admin-files-v2-page"', "Admin files must use the Dashboard V2 page root.");
requireText(admin, "DashboardSelectV2", "Admin files must use DashboardSelectV2.");
requireText(admin, "DashboardFieldV2", "Admin files must use DashboardFieldV2.");
requireText(admin, "DashboardEmptyStateV2", "Admin files must use DashboardEmptyStateV2.");
requireText(admin, "DashboardSkeletonV2", "Admin files must use DashboardSkeletonV2.");
for (const guard of [
  "listCoreEmployeeFiles(240)",
  "listEmployeeDirectory()",
  "createCoreEmployeeFile({",
  "openCoreEmployeeFile(",
  "downloadCoreEmployeeFile(",
  "employee?.employeeId || employeeUid",
]) {
  requireText(admin, guard, `Admin files Core guard missing: ${guard}`);
}
requireText(
  admin,
  'item.direction !== "inbound" && !employeeHasRead(item)',
  "Admin unread metric must use canonical Core read state."
);
requireText(
  admin,
  "[item.employeeKey, item.linkedUid, item.employeeId]",
  "Admin files must resolve employee directory aliases."
);
for (const legacy of [
  "createEmployeeFileRecord",
  "createEmployeeNotification",
  "listEmployeeFiles(",
  "uploadFileToR2",
  "firebase/firestore",
  "EmployeeFilesLegacy",
  "storageUrl",
]) {
  rejectText(admin, legacy, `Admin files must not use legacy path: ${legacy}`);
}
rejectText(admin, "<select", "Native select remains in AdminFilesV2.");
rejectText(admin, "hr-ops-", "Legacy HR ops classes remain in AdminFilesV2.");
rejectText(admin, "hr-file-", "Legacy HR file classes remain in AdminFilesV2.");

// Employee self-service must be Core-scoped and read-only except for marking
// its own outbound file as read.
for (const guard of [
  "listMyCoreEmployeeFiles(120)",
  "markCoreEmployeeFileRead(item.id)",
  "openCoreEmployeeFile(item.id",
  "downloadCoreEmployeeFile(item.id",
  "await onPortalChange?.()",
]) {
  requireText(employee, guard, `Employee files Core guard missing: ${guard}`);
}
for (const legacy of [
  "EmployeeFilesLegacy",
  "services/employeeHub",
  "firebase/firestore",
  "uploadFileToR2",
  "createEmployeeFileRecord",
  "storageUrl",
]) {
  rejectText(employee, legacy, `Employee files must not use legacy path: ${legacy}`);
}

// Shared Core service owns file metadata/R2 operations and category scoping.
for (const guard of [
  'import { CoreFilesService } from "./CoreFilesService"',
  'CORE_EMPLOYEE_FILE_OUTBOUND_CATEGORY = "employee_internal_outbound"',
  'CORE_EMPLOYEE_FILE_INBOUND_CATEGORY = "employee_internal_inbound"',
  "CoreFilesService.list(",
  "CoreFilesService.createMetadata({",
  "CoreFilesService.upload(metadata.id, input.file)",
  'CoreFilesService.updateMetadata(id, { status: "read" })',
]) {
  requireText(coreService, guard, `Core employee-file service guard missing: ${guard}`);
}
for (const legacy of ["firebase/firestore", "uploadFileToR2", "employeeFilesCol("]) {
  rejectText(coreService, legacy, `Core employee-file service must not use legacy dependency: ${legacy}`);
}

// Worker enforces manager-write/self-read boundaries; the browser cannot
// choose another employee identity for self-service.
for (const guard of [
  'case "files": {',
  '"employees.files.manage"',
  'return listFileMetadata(db, ctx.salonId, { ...query, employeeId: ctx.employeeId });',
  'category: "employee_request"',
  'cleanText(metadata.category) !== "employee_internal_outbound"',
  'cleanText(body.status).toLowerCase() !== "read"',
  'return patchFileMetadata(db, ctx.salonId, route.id, { status: "read" });',
]) {
  requireText(worker, guard, `Worker file authorization guard missing: ${guard}`);
}

// Dashboard V2 stylesheet contract.
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
