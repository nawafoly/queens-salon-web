import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const routerPath = path.join(root, "src/pages/hr/CreateStaffAccount.tsx");
const retiredRoutePath = path.join(root, "src/pages/hr/CreateStaffAccountV2.tsx");
const editorPath = path.join(root, "src/pages/dashboardEmployees/EmployeeEditorModal.tsx");
const coordinatorPath = path.join(root, "src/services/employeeOnboardingCoordinator.ts");
const settingsPath = path.join(root, "src/pages/settings/SettingsUsersV2.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-create-staff.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const router = fs.readFileSync(routerPath, "utf8");
const retiredRoute = fs.readFileSync(retiredRoutePath, "utf8");
const editor = fs.readFileSync(editorPath, "utf8");
const coordinator = fs.readFileSync(coordinatorPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(router, 'import CreateStaffAccountV2 from "./CreateStaffAccountV2"', "Create staff compatibility router must keep the V2 boundary.");
rejectText(router, "CreateStaffAccountLegacy", "Legacy create-staff runtime must not remain reachable.");
requireText(router, "return <CreateStaffAccountV2", "Create staff compatibility router must render the retired-route redirect.");

requireText(retiredRoute, 'import { Navigate } from "react-router-dom"', "Retired create-staff route must use a router redirect.");
requireText(retiredRoute, 'to="/dashboard/employees"', "Retired create-staff route must redirect to employee management.");
rejectText(retiredRoute, "createUserWithEmailAndPassword", "Retired create-staff route must not retain account provisioning logic.");
rejectText(retiredRoute, "CoreAccountService", "Retired create-staff route must not write accounts.");
rejectText(retiredRoute, "CoreHrService", "Retired create-staff route must not write employees.");

for (const guard of [
  "queueEmployeeOnboarding",
  "clearEmployeeOnboardingQueue",
  "makeEmployeeTempPassword",
  "حساب الدخول",
  "إنشاء وتفعيل حساب دخول",
  "إنشاء الموظفة وحساب الدخول",
  "DashboardSelectV2",
  "accounts.create",
  "admin_accounts.manage",
]) {
  requireText(editor, guard, `Unified employee editor guard missing: ${guard}`);
}
rejectText(editor, "Firebase UID", "Employee creation UI must not expose Firebase UID.");

for (const guard of [
  "createUserWithEmailAndPassword",
  "deleteUser(firebaseUser)",
  "waitForPrimaryFirebaseSession",
  "CoreAccountService.create",
  "CoreAccountService.linkEmployee",
  "CoreWorkforceService.createNotification",
  "CoreHrService.saveEmployee = async",
  "pendingEmployeeOnboarding",
]) {
  requireText(coordinator, guard, `Canonical onboarding coordinator guard missing: ${guard}`);
}
rejectText(coordinator, "firebase/firestore", "Canonical onboarding coordinator must remain authentication-only for Firebase.");
rejectText(coordinator, "staff_public", "Canonical onboarding coordinator must not restore legacy staff_public writes.");

requireText(settings, "الحسابات والصلاحيات", "Account settings must be labelled as management-only.");
requireText(settings, 'navigate("/dashboard/employees")', "Account settings must direct employee creation to the canonical employee page.");
rejectText(settings, "Firebase UID", "Account settings wrapper must not teach manual UID provisioning.");

requireText(style, ".admin-create-staff-v2-page", "Create staff stylesheet must keep legacy scope for compatibility.");
requireText(style, 'a[href="/dashboard/create-staff"]', "Duplicate create-staff navigation entry must be hidden.");
requireText(style, ".employee-onboarding-account", "Unified onboarding account panel styles are missing.");
requireText(style, ".settings-users-v2-route", "Management-only account settings styles are missing.");
requireText(style, "@media (max-width: 820px)", "Onboarding stylesheet must define tablet behavior.");
requireText(style, "@media (max-width: 560px)", "Onboarding stylesheet must define mobile behavior.");
if (/!important\b/.test(style)) failures.push("admin-create-staff.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-create-staff.css contains a raw hex color.");
requireText(entry, '@import "./pages/admin-create-staff.css";', "dashboard-v2.css must import admin-create-staff.css.");

if (failures.length) {
  console.error("Unified employee onboarding cutover guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Unified employee onboarding cutover guard passed.");
