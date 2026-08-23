import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const profilePath = resolve(root, "src/pages/hr/EmployeeProfile.tsx");
const portalPath = resolve(root, "src/pages/EmployeePortal.tsx");
const cssPath = resolve(root, "src/styles/dashboard-v2/pages/employee-portal-profile.css");
const entryPath = resolve(root, "src/styles/dashboard-v2/dashboard-v2.css");
const errors = [];

for (const [path, label] of [
  [profilePath, "EmployeeProfile.tsx"],
  [portalPath, "EmployeePortal.tsx"],
  [cssPath, "employee-portal-profile.css"],
  [entryPath, "dashboard-v2.css"],
]) {
  if (!existsSync(path)) errors.push(`Missing ${label}.`);
}

if (!errors.length) {
  const profile = readFileSync(profilePath, "utf8");
  const portal = readFileSync(portalPath, "utf8");
  const css = readFileSync(cssPath, "utf8");
  const entry = readFileSync(entryPath, "utf8");

  if (!entry.includes('@import "./pages/employee-portal-profile.css";')) {
    errors.push("Dashboard V2 entry point does not import employee-portal-profile.css.");
  }
  if (/#[0-9a-f]{3,8}\b/i.test(css)) {
    errors.push("employee-portal-profile.css contains a raw hex color.");
  }
  if (/!important\b/i.test(css)) {
    errors.push("employee-portal-profile.css contains !important.");
  }
  if (!css.includes(".dashboard-v2")) {
    errors.push("employee-portal-profile.css is not scoped under Dashboard V2.");
  }
  if (!css.includes("var(--dsv2-")) {
    errors.push("employee-portal-profile.css is not consuming Dashboard V2 tokens.");
  }

  if (!/styles\/dashboard-v2\/dashboard-v2\.css/.test(profile)) {
    errors.push("EmployeeProfile.tsx is not wired to the Dashboard V2 entry point.");
  }
  if (!/dashboard-v2 employee-profile-v2-page/.test(profile)) {
    errors.push("EmployeeProfile.tsx is missing its isolated Dashboard V2 root.");
  }
  if (/style=\{\{/i.test(profile)) {
    errors.push("EmployeeProfile.tsx still contains inline style objects.");
  }
  if (/\b(employee-workspace|employee-profile-workspace|employee-workspace-hero|employee-modern-form|employee-form-savebar|employee-primary-action)\b/.test(profile)) {
    errors.push("EmployeeProfile.tsx still contains legacy employee-profile presentation classes.");
  }

  for (const marker of [
    "CoreHrService.saveMyEmployeeProfile",
    "uploadFileToR2",
    'keyPrefix: "employee-assets/avatars"',
    "employeeProfileEnabled",
    "showOnAbout",
    "البيانات الوظيفية وإعدادات الظهور تبقى للإدارة",
    "onPortalChange",
  ]) {
    if (!profile.includes(marker)) {
      errors.push(`EmployeeProfile.tsx is missing preserved behavior marker: ${marker}`);
    }
  }

  if (/syncEmployeeRecordFromUser|services\/employeeHub|firebase\/firestore/.test(profile)) {
    errors.push("EmployeeProfile.tsx must persist self-editable profile fields through Core D1 only.");
  }
  if (/showOnBooking/.test(profile)) {
    errors.push("Employee profile self-service must not own booking visibility; it is administration-managed.");
  }

  if (!/<progress\b/.test(profile)) {
    errors.push("EmployeeProfile.tsx is missing the V2 completion progress element.");
  }
  if (!/path="profile"/.test(portal) || !/EmployeeProfilePage session=\{session\}/.test(portal)) {
    errors.push("EmployeePortal.tsx no longer exposes the employee profile route.");
  }
  if (!/PermissionRoute permission="workspace\.employee_portal\.view"/.test(portal)) {
    errors.push("Employee profile route permission guard is missing.");
  }
}

if (errors.length) {
  console.error("Employee profile Dashboard V2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Employee profile Dashboard V2 contract passed.");
