import { CoreAccountService } from "./CoreAccountService";
import { CoreApiError } from "./coreApiClient";
import type { UiRole } from "./userProfile";
import { PERMISSION_SCHEMA_VERSION } from "../helpers/permissions";

export const INTERNAL_AUTH_ROLES = [
  "owner",
  "admin",
  "hr",
  "accountant",
  "reception",
  "staff",
  "pending",
] as const;

export type InternalAuthRole = (typeof INTERNAL_AUTH_ROLES)[number];

export function normalizeAuthRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();

  if (role === "administrator" || role === "super_admin" || role === "super-admin") return "admin";
  if (role === "employee") return "staff";
  if (role === "finance" || role === "accounting") return "accountant";
  if (role === "owner-role" || role === "malik" || role === "owner" || role === "المالك" || role === "مالك") {
    return "owner";
  }
  if (
    role === "hr" ||
    role === "human resources" ||
    role === "humanresources" ||
    role === "human_resources" ||
    role === "human-resources" ||
    role === "اتش ار" ||
    role === "الموارد البشرية" ||
    role === "موارد بشرية" ||
    role === "مسؤول موارد بشرية" ||
    role === "مسؤولة موارد بشرية"
  ) {
    return "hr";
  }
  if (role === "receptionist" || role === "frontdesk" || role === "desk") {
    return "reception";
  }

  if (
    role === "owner" ||
    role === "admin" ||
    role === "hr" ||
    role === "accountant" ||
    role === "reception" ||
    role === "staff" ||
    role === "client" ||
    role === "pending" ||
    role === "guest"
  ) {
    return role;
  }

  return "guest";
}

export function isInternalAuthRole(role: unknown): role is InternalAuthRole {
  const normalized = normalizeAuthRole(role);
  return INTERNAL_AUTH_ROLES.includes(normalized as InternalAuthRole);
}

export function isHrManagementRole(role: unknown) {
  const normalized = normalizeAuthRole(role);
  return normalized === "owner" || normalized === "admin" || normalized === "hr";
}

export type VerifiedUserAccess = {
  exists: boolean;
  uid: string;
  role: UiRole;
  active: boolean;
  email: string;
  displayName: string;
  phone: string;
  profile: Record<string, unknown> | null;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export async function readVerifiedUserAccess(uid: string): Promise<VerifiedUserAccess> {
  const normalizedUid = cleanText(uid);
  if (!normalizedUid) {
    return {
      exists: false,
      uid: "",
      role: "guest",
      active: false,
      email: "",
      displayName: "",
      phone: "",
      profile: null,
    };
  }

  try {
    const me = await CoreAccountService.me();
    const account = me.user;
    if (cleanText(account.firebaseUid || account.uid) !== normalizedUid) {
      return {
        exists: false,
        uid: normalizedUid,
        role: "guest",
        active: false,
        email: "",
        displayName: "",
        phone: "",
        profile: null,
      };
    }
    const role = normalizeAuthRole(account.role || account.primaryRole);
    const profile = {
      ...account,
      uid: account.firebaseUid || account.uid,
      role,
      permissions: me.permissions,
      permissionVersion: PERMISSION_SCHEMA_VERSION,
      employeeLink: me.employeeLink,
    } as Record<string, unknown>;
    return {
      exists: true,
      uid: account.firebaseUid || account.uid,
      role,
      active: account.active,
      email: account.email,
      displayName: account.displayName,
      phone: account.phone,
      profile,
    };
  } catch (error) {
    if (error instanceof CoreApiError) {
      return {
        exists: false,
        uid: normalizedUid,
        role: error.code === "ACCOUNT_PENDING" ? "pending" : "guest",
        active: false,
        email: "",
        displayName: "",
        phone: "",
        profile: { coreError: error.code, status: error.status },
      };
    }
    throw error;
  }
}
