import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const staged = new Map();
const file = (rel) => path.join(root, rel);

function read(rel) {
  return staged.has(rel) ? staged.get(rel) : fs.readFileSync(file(rel), "utf8");
}

function replaceOnce(rel, before, after, label) {
  const current = read(rel);
  const count = current.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match in ${rel}, found ${count}. No files were written.`);
  }
  staged.set(rel, current.replace(before, after));
}

function createNew(rel, content) {
  if (fs.existsSync(file(rel))) {
    throw new Error(`${rel} already exists. No files were written.`);
  }
  staged.set(rel, content);
}

replaceOnce(
  "src/components/InternalPortalSwitcher.tsx",
  '  "files",\n  "create-staff",\n];',
  '  "files",\n];',
  "retired internal portal classification"
);

replaceOnce(
  "src/pages/AdminHrDashboard.tsx",
  `      "create-staff": {\n        kicker: "الحسابات",\n        title: "إنشاء حساب موظفة",\n        subtitle: "إنشاء وربط حساب الموظفة مع الحفاظ على الأدوار والصلاحيات الحالية.",\n      },\n`,
  "",
  "retired HR metadata"
);

replaceOnce(
  "src/pages/hr/RecruitmentApplications.tsx",
  'import { usePermissions } from "../../security/PermissionContext";\n',
  'import { usePermissions } from "../../security/PermissionContext";\nimport { writeEmployeeOnboardingDraft, type EmployeeOnboardingDraft } from "../../services/employeeOnboardingDraft";\n',
  "recruitment onboarding import"
);
replaceOnce(
  "src/pages/hr/RecruitmentApplications.tsx",
  'const STAFF_DRAFT_STORAGE_KEY = "queens.hr.createStaffDraft";\n\n',
  "",
  "legacy recruitment draft key"
);
replaceOnce(
  "src/pages/hr/RecruitmentApplications.tsx",
  `  const openCreateAccount = () => {\n    if (!selected) return;\n    const role = ["hr", "admin", "reception"].includes(cleanText(selected.roleApplied).toLowerCase())\n      ? cleanText(selected.roleApplied).toLowerCase()\n      : "staff";\n    const draft = {\n      applicationId: selected.id,\n      displayName: selected.fullName,\n      email: selected.email,\n      phone: selected.phone || "",\n      role,\n      bio: selected.notes || selected.message || "",\n      source: "recruitment",\n    };\n    try {\n      window.sessionStorage.setItem(STAFF_DRAFT_STORAGE_KEY, JSON.stringify(draft));\n    } catch {\n      // Navigation still works; the query id is retained as a fallback.\n    }\n    navigate(\`/dashboard/create-staff?applicationId=\${encodeURIComponent(selected.id)}\`);\n  };`,
  `  const openCreateAccount = () => {\n    if (!selected) return;\n    const role: EmployeeOnboardingDraft["role"] = ["hr", "admin", "reception"].includes(\n      cleanText(selected.roleApplied).toLowerCase()\n    )\n      ? (cleanText(selected.roleApplied).toLowerCase() as EmployeeOnboardingDraft["role"])\n      : "staff";\n    const draft: EmployeeOnboardingDraft = {\n      applicationId: selected.id,\n      displayName: selected.fullName,\n      email: selected.email,\n      phone: selected.phone || "",\n      role,\n      bio: selected.notes || selected.message || "",\n      source: "recruitment",\n    };\n    writeEmployeeOnboardingDraft(draft);\n    navigate(\`/dashboard/employees?create=1&applicationId=\${encodeURIComponent(selected.id)}\`);\n  };`,
  "recruitment canonical onboarding handoff"
);

createNew(
  "src/services/employeeOnboardingDraft.ts",
  `import type { EmployeeOnboardingRole } from "./employeeOnboardingCoordinator";\n\nconst EMPLOYEE_ONBOARDING_DRAFT_KEY = "malikat.hr.employeeOnboardingDraft";\n\nexport type EmployeeOnboardingDraft = {\n  applicationId: string;\n  displayName: string;\n  email: string;\n  phone: string;\n  role: EmployeeOnboardingRole;\n  bio: string;\n  source: "recruitment";\n};\n\nfunction cleanText(value: unknown) {\n  return String(value || "").trim();\n}\n\nfunction normalizeRole(value: unknown): EmployeeOnboardingRole {\n  const role = cleanText(value).toLowerCase();\n  if (role === "reception" || role === "hr" || role === "accountant" || role === "admin") {\n    return role;\n  }\n  return "staff";\n}\n\nexport function writeEmployeeOnboardingDraft(input: EmployeeOnboardingDraft) {\n  if (typeof window === "undefined") return;\n  const draft: EmployeeOnboardingDraft = {\n    applicationId: cleanText(input.applicationId),\n    displayName: cleanText(input.displayName),\n    email: cleanText(input.email).toLowerCase(),\n    phone: cleanText(input.phone),\n    role: normalizeRole(input.role),\n    bio: cleanText(input.bio),\n    source: "recruitment",\n  };\n  window.sessionStorage.setItem(EMPLOYEE_ONBOARDING_DRAFT_KEY, JSON.stringify(draft));\n}\n\nexport function readEmployeeOnboardingDraft(expectedApplicationId = "") {\n  if (typeof window === "undefined") return null;\n  try {\n    const raw = window.sessionStorage.getItem(EMPLOYEE_ONBOARDING_DRAFT_KEY);\n    if (!raw) return null;\n    const parsed = JSON.parse(raw) as Partial<EmployeeOnboardingDraft> | null;\n    if (!parsed || parsed.source !== "recruitment") return null;\n\n    const draft: EmployeeOnboardingDraft = {\n      applicationId: cleanText(parsed.applicationId),\n      displayName: cleanText(parsed.displayName),\n      email: cleanText(parsed.email).toLowerCase(),\n      phone: cleanText(parsed.phone),\n      role: normalizeRole(parsed.role),\n      bio: cleanText(parsed.bio),\n      source: "recruitment",\n    };\n    const expected = cleanText(expectedApplicationId);\n    if (!draft.applicationId || (expected && draft.applicationId !== expected)) return null;\n    return draft;\n  } catch {\n    return null;\n  }\n}\n\nexport function clearEmployeeOnboardingDraft() {\n  if (typeof window === "undefined") return;\n  window.sessionStorage.removeItem(EMPLOYEE_ONBOARDING_DRAFT_KEY);\n}\n`
);

replaceOnce(
  "src/pages/dashboardEmployees/EmployeeListPanel.tsx",
  'import type { CSSProperties } from "react";',
  'import { useEffect, useRef, type CSSProperties } from "react";',
  "employee directory React hooks"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeListPanel.tsx",
  'import { useEmployeeLanguage } from "./employeeLanguage";\n',
  'import { useEmployeeLanguage } from "./employeeLanguage";\nimport { useLocation, useNavigate } from "react-router-dom";\nimport {\n  clearEmployeeOnboardingDraft,\n  readEmployeeOnboardingDraft,\n} from "../../services/employeeOnboardingDraft";\n',
  "employee directory recruitment handoff imports"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeListPanel.tsx",
  `}: EmployeeListPanelProps) {\n  const { language, direction, t, tr } = useEmployeeLanguage();\n  const hasActiveFilters =`,
  `}: EmployeeListPanelProps) {\n  const { language, direction, t, tr } = useEmployeeLanguage();\n  const location = useLocation();\n  const navigate = useNavigate();\n  const recruitmentHandoffRef = useRef("");\n\n  useEffect(() => {\n    const params = new URLSearchParams(location.search);\n    if (params.get("create") !== "1") return;\n\n    const applicationId = cleanText(params.get("applicationId"));\n    if (!applicationId || recruitmentHandoffRef.current === applicationId) return;\n\n    const draft = readEmployeeOnboardingDraft(applicationId);\n    if (!draft || !canManage) {\n      clearEmployeeOnboardingDraft();\n      navigate("/dashboard/employees", { replace: true });\n      return;\n    }\n\n    recruitmentHandoffRef.current = applicationId;\n    onCreateEmployee();\n  }, [canManage, location.search, navigate, onCreateEmployee]);\n\n  const hasActiveFilters =`,
  "employee directory canonical recruitment trigger"
);

replaceOnce(
  "src/pages/dashboardEmployees/BasicInfoSection.tsx",
  'import { EmployeeBasicTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";',
  'import { useEffect, useRef } from "react";\nimport { useLocation } from "react-router-dom";\nimport { readEmployeeOnboardingDraft } from "../../services/employeeOnboardingDraft";\nimport { EmployeeBasicTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";',
  "basic info recruitment imports"
);
replaceOnce(
  "src/pages/dashboardEmployees/BasicInfoSection.tsx",
  `}: BasicInfoSectionProps) {\n  if (!isVisible) return null;`,
  `}: BasicInfoSectionProps) {\n  const location = useLocation();\n  const recruitmentDraftRef = useRef("");\n\n  useEffect(() => {\n    if (!isVisible) return;\n    const params = new URLSearchParams(location.search);\n    if (params.get("create") !== "1") return;\n    const applicationId = String(params.get("applicationId") || "").trim();\n    if (!applicationId || recruitmentDraftRef.current === applicationId) return;\n    const draft = readEmployeeOnboardingDraft(applicationId);\n    if (!draft) return;\n    recruitmentDraftRef.current = applicationId;\n    onNameChange(draft.displayName);\n  }, [isVisible, location.search, onNameChange]);\n\n  if (!isVisible) return null;`,
  "basic info recruitment name prefill"
);

replaceOnce(
  "src/pages/dashboardEmployees/ProfileSection.tsx",
  'import { EmployeeProfileTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";',
  'import { useEffect, useRef } from "react";\nimport { useLocation } from "react-router-dom";\nimport { readEmployeeOnboardingDraft } from "../../services/employeeOnboardingDraft";\nimport { EmployeeProfileTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";',
  "profile recruitment imports"
);
replaceOnce(
  "src/pages/dashboardEmployees/ProfileSection.tsx",
  `}: ProfileSectionProps) {\n  if (!isVisible) return null;`,
  `}: ProfileSectionProps) {\n  const location = useLocation();\n  const recruitmentDraftRef = useRef("");\n\n  useEffect(() => {\n    if (!isVisible) return;\n    const params = new URLSearchParams(location.search);\n    if (params.get("create") !== "1") return;\n    const applicationId = String(params.get("applicationId") || "").trim();\n    if (!applicationId || recruitmentDraftRef.current === applicationId) return;\n    const draft = readEmployeeOnboardingDraft(applicationId);\n    if (!draft) return;\n    recruitmentDraftRef.current = applicationId;\n    onBioChange(draft.bio);\n  }, [isVisible, location.search, onBioChange]);\n\n  if (!isVisible) return null;`,
  "profile recruitment bio prefill"
);

replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  'import { useEffect, useMemo, useState, type ReactNode } from "react";\n',
  'import { useEffect, useMemo, useState, type ReactNode } from "react";\nimport { useLocation, useNavigate } from "react-router-dom";\n',
  "employee editor router imports"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  '} from "../../services/employeeOnboardingCoordinator";\n',
  '} from "../../services/employeeOnboardingCoordinator";\nimport {\n  clearEmployeeOnboardingDraft,\n  readEmployeeOnboardingDraft,\n} from "../../services/employeeOnboardingDraft";\n',
  "employee editor recruitment draft imports"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  `  const { t } = useEmployeeLanguage();\n  const { hasAnyPermission } = usePermissions();\n  const isCreateMode = !editId;`,
  `  const { t } = useEmployeeLanguage();\n  const { hasAnyPermission } = usePermissions();\n  const location = useLocation();\n  const navigate = useNavigate();\n  const isCreateMode = !editId;`,
  "employee editor route state"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  `  useEffect(() => {\n    if (!isOpen || !isCreateMode) return;\n    clearEmployeeOnboardingQueue();\n    setCreateLogin(canProvisionAccount);\n    setAccountEmail("");\n    setAccountPhone("");\n    setAccountRole("staff");\n    setTemporaryPassword(makeEmployeeTempPassword());\n    setAccountError("");\n  }, [canProvisionAccount, isCreateMode, isOpen]);\n\n  const tabs = useMemo(`,
  `  useEffect(() => {\n    if (!isOpen || !isCreateMode) return;\n    clearEmployeeOnboardingQueue();\n    const params = new URLSearchParams(location.search);\n    const recruitmentDraft =\n      params.get("create") === "1"\n        ? readEmployeeOnboardingDraft(String(params.get("applicationId") || "").trim())\n        : null;\n    setCreateLogin(canProvisionAccount);\n    setAccountEmail(recruitmentDraft?.email || "");\n    setAccountPhone(recruitmentDraft?.phone || "");\n    setAccountRole(recruitmentDraft?.role || "staff");\n    setTemporaryPassword(makeEmployeeTempPassword());\n    setAccountError("");\n  }, [canProvisionAccount, isCreateMode, isOpen, location.search]);\n\n  const finishRecruitmentHandoff = () => {\n    const params = new URLSearchParams(location.search);\n    if (params.get("create") !== "1") return;\n    clearEmployeeOnboardingDraft();\n    navigate("/dashboard/employees", { replace: true });\n  };\n\n  const handleClose = () => {\n    finishRecruitmentHandoff();\n    onClose();\n  };\n\n  const tabs = useMemo(`,
  "employee editor recruitment prefill"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  `    try {\n      await onSave({ createLogin });\n    } finally {`,
  `    try {\n      await onSave({ createLogin });\n      finishRecruitmentHandoff();\n    } finally {`,
  "employee editor successful handoff cleanup"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  '          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onClose} disabled={saving}>',
  '          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={handleClose} disabled={saving}>',
  "employee editor cancel handoff cleanup"
);
replaceOnce(
  "src/pages/dashboardEmployees/EmployeeEditorModal.tsx",
  '      onClose={onClose}\n',
  '      onClose={handleClose}\n',
  "employee editor modal handoff cleanup"
);

replaceOnce(
  "scripts/check-dashboard-create-staff-v2.mjs",
  'const appPath = path.join(root, "src/App.tsx");\n',
  'const appPath = path.join(root, "src/App.tsx");\nconst internalPortalPath = path.join(root, "src/components/InternalPortalSwitcher.tsx");\nconst recruitmentPath = path.join(root, "src/pages/hr/RecruitmentApplications.tsx");\n',
  "create-staff guard source paths"
);
replaceOnce(
  "scripts/check-dashboard-create-staff-v2.mjs",
  'const app = fs.readFileSync(appPath, "utf8");\n',
  'const app = fs.readFileSync(appPath, "utf8");\nconst internalPortal = fs.readFileSync(internalPortalPath, "utf8");\nconst recruitment = fs.readFileSync(recruitmentPath, "utf8");\n',
  "create-staff guard source reads"
);
replaceOnce(
  "scripts/check-dashboard-create-staff-v2.mjs",
  'rejectText(app, \'"create-staff"\', "App runtime routing must not classify the retired create-staff path.");\n',
  'rejectText(app, \'"create-staff"\', "App runtime routing must not classify the retired create-staff path.");\nrejectText(internalPortal, \'"create-staff"\', "Internal portal switcher must not classify the retired create-staff path.");\nrejectText(adminHr, \'"create-staff"\', "Admin HR metadata must not retain the retired create-staff section.");\nrejectText(recruitment, "/dashboard/create-staff", "Recruitment must not navigate to the retired create-staff route.");\n',
  "create-staff runtime residue guards"
);

replaceOnce(
  "scripts/check-dashboard-recruitment-v2.mjs",
  'const pagePath = path.join(root, "src/pages/hr/RecruitmentApplications.tsx");\n',
  'const pagePath = path.join(root, "src/pages/hr/RecruitmentApplications.tsx");\nconst employeeListPath = path.join(root, "src/pages/dashboardEmployees/EmployeeListPanel.tsx");\nconst basicInfoPath = path.join(root, "src/pages/dashboardEmployees/BasicInfoSection.tsx");\nconst profilePath = path.join(root, "src/pages/dashboardEmployees/ProfileSection.tsx");\nconst editorPath = path.join(root, "src/pages/dashboardEmployees/EmployeeEditorModal.tsx");\nconst draftPath = path.join(root, "src/services/employeeOnboardingDraft.ts");\n',
  "recruitment guard source paths"
);
replaceOnce(
  "scripts/check-dashboard-recruitment-v2.mjs",
  'const page = fs.readFileSync(pagePath, "utf8");\n',
  'const page = fs.readFileSync(pagePath, "utf8");\nconst employeeList = fs.readFileSync(employeeListPath, "utf8");\nconst basicInfo = fs.readFileSync(basicInfoPath, "utf8");\nconst profile = fs.readFileSync(profilePath, "utf8");\nconst editor = fs.readFileSync(editorPath, "utf8");\nconst draft = fs.readFileSync(draftPath, "utf8");\n',
  "recruitment guard source reads"
);
replaceOnce(
  "scripts/check-dashboard-recruitment-v2.mjs",
  '  "window.sessionStorage.setItem(STAFF_DRAFT_STORAGE_KEY, JSON.stringify(draft))",\n  "navigate(`/dashboard/create-staff?applicationId=${encodeURIComponent(selected.id)}`)",\n',
  '  "writeEmployeeOnboardingDraft(draft)",\n  "navigate(`/dashboard/employees?create=1&applicationId=${encodeURIComponent(selected.id)}`)",\n',
  "recruitment business guard cutover"
);
replaceOnce(
  "scripts/check-dashboard-recruitment-v2.mjs",
  '  requireText(page, guard, `Business-logic guard missing: ${guard}`);\n}\n\nrequireText(\n  style,',
  `  requireText(page, guard, \`Business-logic guard missing: \${guard}\`);\n}\nrejectText(page, "/dashboard/create-staff", "Recruitment must not navigate to the retired employee creation route.");\nfor (const guard of [\n  "readEmployeeOnboardingDraft(applicationId)",\n  "onCreateEmployee();",\n  'navigate("/dashboard/employees", { replace: true })',\n]) {\n  requireText(employeeList, guard, \`Canonical employee handoff guard missing: \${guard}\`);\n}\nrequireText(basicInfo, "onNameChange(draft.displayName)", "Recruitment handoff must prefill the canonical employee name field.");\nrequireText(profile, "onBioChange(draft.bio)", "Recruitment handoff must prefill the canonical employee profile notes field.");\nfor (const guard of [\n  'setAccountEmail(recruitmentDraft?.email || "")',\n  'setAccountPhone(recruitmentDraft?.phone || "")',\n  'setAccountRole(recruitmentDraft?.role || "staff")',\n  "finishRecruitmentHandoff();",\n]) {\n  requireText(editor, guard, \`Canonical employee editor handoff guard missing: \${guard}\`);\n}\nfor (const guard of [\n  'const EMPLOYEE_ONBOARDING_DRAFT_KEY = "malikat.hr.employeeOnboardingDraft"',\n  "writeEmployeeOnboardingDraft",\n  "readEmployeeOnboardingDraft",\n  "clearEmployeeOnboardingDraft",\n]) {\n  requireText(draft, guard, \`Canonical recruitment draft guard missing: \${guard}\`);\n}\n\nrequireText(\n  style,`,
  "recruitment canonical handoff guards"
);

// All validations succeeded; only now write files.
for (const [rel, content] of staged) {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), content, "utf8");
}

fs.unlinkSync(fileURLToPath(import.meta.url));
console.log(`Applied ${staged.size} validated file changes and removed the temporary patch helper.`);
