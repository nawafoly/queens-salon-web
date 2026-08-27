import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const routerPath = path.join(root, "src/pages/hr/CreateStaffAccount.tsx");
const adminPath = path.join(root, "src/pages/hr/CreateStaffAccountV2.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-create-staff.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const router = fs.readFileSync(routerPath, "utf8");
const admin = fs.readFileSync(adminPath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(router, 'import CreateStaffAccountV2 from "./CreateStaffAccountV2"', "Create staff router must import V2.");
rejectText(router, "CreateStaffAccountLegacy", "Legacy create-staff runtime must not remain reachable.");
requireText(router, "return <CreateStaffAccountV2", "Create staff router must always render the Core-owned V2 workflow.");

requireText(admin, 'className="dashboard-v2 dsv2-page admin-create-staff-v2-page"', "Create staff V2 must use Dashboard V2 root.");
requireText(admin, "DashboardFieldV2", "Create staff V2 must use DashboardFieldV2.");
requireText(admin, "DashboardSelectV2", "Create staff V2 must use DashboardSelectV2.");
rejectText(admin, "<select", "Native select remains in create staff V2.");
rejectText(admin, "syncEmployeeRecordFromUser", "Create staff V2 still writes employee identity through the legacy Firestore helper.");
rejectText(admin, 'services/employeeHub', "Create staff V2 must not depend on employeeHub for account/employee provisioning.");

for (const guard of [
  "getSecondaryAuth()",
  "createUserWithEmailAndPassword(secondary, email, password)",
  "deleteUser(createdUser)",
  "CoreAccountService.create",
  "CoreAccountService.update",
  "CoreAccountService.linkEmployee",
  "CoreHrService.saveEmployee",
  "CoreWorkforceService.createNotification",
  "persistCoreStaffIdentity",
  'route: "/employee/overview"',
  "if (secondary) await signOut(secondary).catch(() => {})",
]) {
  requireText(admin, guard, `Create staff Core business-logic guard missing: ${guard}`);
}

requireText(style, ".admin-create-staff-v2-page", "Create staff stylesheet is missing page scope.");
requireText(style, "@media (max-width: 820px)", "Create staff stylesheet must define tablet behavior.");
requireText(style, "@media (max-width: 560px)", "Create staff stylesheet must define mobile behavior.");
if (/!important\b/.test(style)) failures.push("admin-create-staff.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-create-staff.css contains a raw hex color.");
requireText(entry, '@import "./pages/admin-create-staff.css";', "dashboard-v2.css must import admin-create-staff.css.");

if (failures.length) {
  console.error("Dashboard create staff Core cutover guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard create staff Core cutover guard passed.");
