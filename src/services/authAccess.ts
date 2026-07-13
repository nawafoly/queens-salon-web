import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { UiRole } from "./userProfile";

export const INTERNAL_AUTH_ROLES = [
  "owner",
  "admin",
  "hr",
  "reception",
  "staff",
  "pending",
] as const;

export type InternalAuthRole = (typeof INTERNAL_AUTH_ROLES)[number];

export function normalizeAuthRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();

  if (role === "administrator" || role === "super_admin" || role === "super-admin") return "admin";
  if (role === "employee") return "staff";
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

  const snapshot = await getDoc(doc(db, "salons", "main", "users", normalizedUid));
  if (!snapshot.exists()) {
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

  const profile = snapshot.data() as Record<string, unknown>;
  const storedRole = normalizeAuthRole(profile?.role);
  const active = profile?.active !== false && profile?.isActive !== false;
  const role = storedRole;

  return {
    exists: true,
    uid: normalizedUid,
    role,
    active,
    email: cleanText(profile?.email),
    displayName: cleanText(profile?.displayName || profile?.name),
    phone: cleanText(profile?.phone),
    profile,
  };
}
