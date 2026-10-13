import type { EmployeeOnboardingRole } from "./employeeOnboardingCoordinator";

const EMPLOYEE_ONBOARDING_DRAFT_KEY = "malikat.hr.employeeOnboardingDraft";

export type EmployeeOnboardingDraft = {
  applicationId: string;
  displayName: string;
  email: string;
  phone: string;
  role: EmployeeOnboardingRole;
  bio: string;
  source: "recruitment";
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(value: unknown): EmployeeOnboardingRole {
  const role = cleanText(value).toLowerCase();
  if (role === "reception" || role === "hr" || role === "accountant" || role === "admin") {
    return role;
  }
  return "staff";
}

export function writeEmployeeOnboardingDraft(input: EmployeeOnboardingDraft) {
  if (typeof window === "undefined") return;
  const draft: EmployeeOnboardingDraft = {
    applicationId: cleanText(input.applicationId),
    displayName: cleanText(input.displayName),
    email: cleanText(input.email).toLowerCase(),
    phone: cleanText(input.phone),
    role: normalizeRole(input.role),
    bio: cleanText(input.bio),
    source: "recruitment",
  };
  window.sessionStorage.setItem(EMPLOYEE_ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
}

export function readEmployeeOnboardingDraft(expectedApplicationId = "") {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(EMPLOYEE_ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EmployeeOnboardingDraft> | null;
    if (!parsed || parsed.source !== "recruitment") return null;

    const draft: EmployeeOnboardingDraft = {
      applicationId: cleanText(parsed.applicationId),
      displayName: cleanText(parsed.displayName),
      email: cleanText(parsed.email).toLowerCase(),
      phone: cleanText(parsed.phone),
      role: normalizeRole(parsed.role),
      bio: cleanText(parsed.bio),
      source: "recruitment",
    };
    const expected = cleanText(expectedApplicationId);
    if (!draft.applicationId || (expected && draft.applicationId !== expected)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearEmployeeOnboardingDraft() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(EMPLOYEE_ONBOARDING_DRAFT_KEY);
}
