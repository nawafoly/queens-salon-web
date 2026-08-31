import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "src/pages/DashboardEmployees.tsx"), "utf8");
const modal = fs.readFileSync(path.join(root, "src/pages/dashboardEmployees/EmployeeEditorModal.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles/dashboard-v2/pages/employees.css"), "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

requireText(modal, "EmployeeSaveOptions", "Create dialog must pass create-login intent to the canonical save flow.");
requireText(modal, "await onSave({ createLogin })", "Create dialog must pass account-creation intent on save.");
requireText(modal, "employees-v2-editor--create", "Create dialog must have a scoped V2 create layout.");
requireText(modal, "employees-v2-editor__create-intro", "Create dialog must expose the unified onboarding intro.");
requireText(modal, 'isCreateMode && modalTab === "basic"', "Login account form must stay scoped to the basic create step.");
rejectText(modal, "Firebase UID", "Create UI must not expose Firebase UID.");

requireText(page, "isCreatingEmployee", "Employee save must distinguish create from edit mode.");
requireText(page, "createdLogin", "Employee save must know whether a login was provisioned.");
requireText(page, 'setIsOpen(false)', "Successful employee creation must close the editor.");
requireText(page, 'navigate("/dashboard/employees", { replace: true })', "Successful employee creation must return to the employee directory.");
requireText(page, "تم إنشاء الموظفة وحساب الدخول وربطهما بنجاح.", "Successful account provisioning must have a clear Arabic success message.");
requireText(page, "تم إنشاء الموظفة بنجاح.", "Employee-only creation must have a clear Arabic success message.");
requireText(page, "employees-v2-alert__title", "Success feedback must use the V2 success alert hierarchy.");

requireText(styles, ".employees-v2-editor__create-intro", "Create dialog V2 layout styles are missing.");
requireText(styles, ".employees-v2-editor__tab-index", "Create step index styles are missing.");
requireText(styles, ".employees-v2-alert__title", "Success alert hierarchy styles are missing.");
requireText(styles, ".employees-v2-editor--create .employee-onboarding-account", "Login account card must be scoped to the unified create dialog.");

if (failures.length) {
  console.error("Employee create success UX guard failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Employee create success UX guard passed.");
