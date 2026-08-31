import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Final cutover guard: employee onboarding has one active entry point only.
const root = process.cwd();
const adminHrPath = path.join(root, "src/pages/AdminHrDashboard.tsx");
const dashboardPath = path.join(root, "src/pages/Dashboard.tsx");
const legacyRouterPath = path.join(root, "src/pages/hr/CreateStaffAccount.tsx");
const legacyRoutePath = path.join(root, "src/pages/hr/CreateStaffAccountV2.tsx");
const editorPath = path.join(root, "src/pages/dashboardEmployees/EmployeeEditorModal.tsx");
const coordinatorPath = path.join(root, "src/services/employeeOnboardingCoordinator.ts");
const settingsPath = path.join(root, "src/pages/settings/SettingsUsersV2.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/admin-create-staff.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const adminHr = fs.readFileSync(adminHrPath, "utf8");
const dashboard = fs.readFileSync(dashboardPath, "utf8");
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

rejectText(adminHr, "CreateStaffAccountPage", "Admin HR must not import the retired create-staff page.");
rejectText(adminHr, 'path="create-staff"', "Admin HR must not register a create-staff route.");
rejectText(adminHr, 'onNavigate("/dashboard/create-staff")', "HR overview must not expose the retired create-staff entry.");
rejectText(dashboard, '"create-staff"', "Dashboard workspace metadata must not retain the retired create-staff route.");
if (fs.existsSync(legacyRouterPath)) failures.push("CreateStaffAccount.tsx must be removed after the unified cutover.");
if (fs.existsSync(legacyRoutePath)) failures.push("CreateStaffAccountV2.tsx must be removed after the unified cutover.");

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

requireText(style, ".employee-onboarding-account", "Unified onboarding account panel styles are missing.");
requireText(style, ".settings-users-v2-route", "Management-only account settings styles are missing.");
requireText(style, "@media (max-width: 820px)", "Onboarding stylesheet must define tablet behavior.");
requireText(style, "@media (max-width: 560px)", "Onboarding stylesheet must define mobile behavior.");
if (/!important\b/.test(style)) failures.push("admin-create-staff.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("admin-create-staff.css contains a raw hex color.");
requireText(entry, '@import "./pages/admin-create-staff.css";', "dashboard-v2.css must import onboarding styles.");

if (failures.length) {
  console.error("Unified employee onboarding cutover guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Unified employee onboarding cutover guard passed.");
