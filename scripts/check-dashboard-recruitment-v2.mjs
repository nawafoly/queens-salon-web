import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const pagePath = path.join(root, "src/pages/hr/RecruitmentApplications.tsx");
const employeeListPath = path.join(root, "src/pages/dashboardEmployees/EmployeeListPanel.tsx");
const basicInfoPath = path.join(root, "src/pages/dashboardEmployees/BasicInfoSection.tsx");
const profilePath = path.join(root, "src/pages/dashboardEmployees/ProfileSection.tsx");
const editorPath = path.join(root, "src/pages/dashboardEmployees/EmployeeEditorModal.tsx");
const draftPath = path.join(root, "src/services/employeeOnboardingDraft.ts");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/recruitment-applications.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const page = fs.readFileSync(pagePath, "utf8");
const employeeList = fs.readFileSync(employeeListPath, "utf8");
const basicInfo = fs.readFileSync(basicInfoPath, "utf8");
const profile = fs.readFileSync(profilePath, "utf8");
const editor = fs.readFileSync(editorPath, "utf8");
const draft = fs.readFileSync(draftPath, "utf8");
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
  'className="dashboard-v2 dsv2-page recruitment-applications-v2-page"',
  "Recruitment applications must use the Dashboard V2 page root."
);
requireText(page, "DashboardModalV2", "Recruitment applications must use DashboardModalV2.");
requireText(page, "DashboardSelectV2", "Recruitment applications must use DashboardSelectV2.");
requireText(page, "DashboardFieldV2", "Recruitment applications must use DashboardFieldV2.");
requireText(page, "DashboardEmptyStateV2", "Recruitment applications must use DashboardEmptyStateV2.");
requireText(page, "DashboardSkeletonV2", "Recruitment applications must use DashboardSkeletonV2.");
rejectText(page, "hr-ops-", "Legacy hr-ops classes remain in RecruitmentApplications.tsx.");
rejectText(page, "hr-recruitment-", "Legacy hr-recruitment classes remain in RecruitmentApplications.tsx.");
rejectText(page, "<select", "Native select remains in RecruitmentApplications.tsx.");

for (const guard of [
  "listRecruitmentApplications(240)",
  "createRecruitmentApplication",
  "updateRecruitmentApplication",
  'status: "new"',
  'source: "manual"',
  "reviewedByUid: session.uid",
  "reviewedAt: new Date().toISOString()",
  "writeEmployeeOnboardingDraft(draft)",
  "navigate(`/dashboard/employees?create=1&applicationId=${encodeURIComponent(selected.id)}`)",
]) {
  requireText(page, guard, `Business-logic guard missing: ${guard}`);
}
rejectText(page, "/dashboard/create-staff", "Recruitment must not navigate to the retired employee creation route.");
for (const guard of [
  "readEmployeeOnboardingDraft(applicationId)",
  "onCreateEmployee();",
  'navigate("/dashboard/employees", { replace: true })',
]) {
  requireText(employeeList, guard, `Canonical employee handoff guard missing: ${guard}`);
}
requireText(basicInfo, "onNameChange(draft.displayName)", "Recruitment handoff must prefill the canonical employee name field.");
requireText(profile, "onBioChange(draft.bio)", "Recruitment handoff must prefill the canonical employee profile notes field.");
for (const guard of [
  'setAccountEmail(recruitmentDraft?.email || "")',
  'setAccountPhone(recruitmentDraft?.phone || "")',
  'setAccountRole(recruitmentDraft?.role || "staff")',
  "finishRecruitmentHandoff();",
]) {
  requireText(editor, guard, `Canonical employee editor handoff guard missing: ${guard}`);
}
for (const guard of [
  'const EMPLOYEE_ONBOARDING_DRAFT_KEY = "malikat.hr.employeeOnboardingDraft"',
  "writeEmployeeOnboardingDraft",
  "readEmployeeOnboardingDraft",
  "clearEmployeeOnboardingDraft",
]) {
  requireText(draft, guard, `Canonical recruitment draft guard missing: ${guard}`);
}

requireText(
  style,
  ".recruitment-applications-v2-page",
  "Recruitment V2 stylesheet is missing its page scope."
);
if (/!important\b/.test(style)) failures.push("recruitment-applications.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("recruitment-applications.css contains a raw hex color.");
requireText(
  entry,
  '@import "./pages/recruitment-applications.css";',
  "dashboard-v2.css must import recruitment-applications.css."
);

if (failures.length) {
  console.error("Dashboard recruitment V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard recruitment V2 migration guard passed.");
