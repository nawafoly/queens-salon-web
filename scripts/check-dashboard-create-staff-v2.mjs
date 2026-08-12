import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const routerPath = path.join(root, "src/pages/hr/CreateStaffAccount.tsx");
const adminPath = path.join(root, "src/pages/hr/CreateStaffAccountV2.tsx");
const legacyPath = path.join(root, "src/pages/hr/CreateStaffAccountLegacy.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-create-staff.css");
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

requireText(router, 'import CreateStaffAccountV2 from "./CreateStaffAccountV2"', "Create staff router must import V2.");
requireText(router, 'import CreateStaffAccountLegacy from "./CreateStaffAccountLegacy"', "Create staff router must preserve legacy.");
requireText(router, '/^\\/dashboard(?:\\/|$)/', "Create staff V2 must be scoped to dashboard routes.");

requireText(admin, 'className="dashboard-v2 dsv2-page admin-create-staff-v2-page"', "Create staff V2 must use Dashboard V2 root.");
requireText(admin, "DashboardFieldV2", "Create staff V2 must use DashboardFieldV2.");
requireText(admin, "DashboardSelectV2", "Create staff V2 must use DashboardSelectV2.");
rejectText(admin, "<select", "Native select remains in create staff V2.");
rejectText(admin, "hr-field", "Legacy field classes remain in create staff V2.");
rejectText(admin, "hr-card", "Legacy card classes remain in create staff V2.");

for (const guard of [
  "getSecondaryAuth()",
  "createUserWithEmailAndPassword(secondary, email, password)",
  "updateProfile(cred.user, { displayName })",
  "syncEmployeeRecordFromUser",
  "createEmployeeNotification",
  "if (secondary) await signOut(secondary).catch(() => {})",
  'route: "/employee/overview"',
  'showOnBooking: role === "staff"',
  'showOnBooking: promoteForm.role === "staff"',
]) {
  requireText(admin, guard, `Create staff V2 business-logic guard missing: ${guard}`);
  requireText(legacy, guard, `Create staff legacy guard missing: ${guard}`);
}

requireText(legacy, "hr-page", "Create staff legacy presentation must remain preserved.");
requireText(style, ".admin-create-staff-v2-page", "Create staff stylesheet is missing page scope.");
requireText(style, "@media (max-width: 820px)", "Create staff stylesheet must define tablet behavior.");
requireText(style, "@media (max-width: 560px)", "Create staff stylesheet must define mobile behavior.");
if (/!important\b/.test(style)) failures.push("admin-create-staff.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-create-staff.css contains a raw hex color.");
requireText(entry, '@import "./pages/admin-create-staff.css";', "dashboard-v2.css must import admin-create-staff.css.");

if (failures.length) {
  console.error("Dashboard create staff V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard create staff V2 migration guard passed.");
