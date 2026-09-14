// CORE D1 ONLY for profile read/write — do not add Firestore fallback.
// Firebase Auth remains for identity tokens only.
import type { User } from "firebase/auth";
import { getAuth } from "firebase/auth";
import { CoreAccountService, type CoreAuthMe } from "./CoreAccountService";
import { coreApiRequest, CoreApiError } from "./coreApiClient";
import { writeAuditLog } from "./logService";
import { normalizeAuthRole } from "./authAccess";
import { writeStoredAuthSession } from "./localAuthSession";
import {
  PERMISSION_SCHEMA_VERSION,
  normalizePermissionOverrides,
  type AppPermission,
  type PermissionOverrides,
} from "../helpers/permissions";

export type UiRole =
  | "owner"
  | "admin"
  | "hr"
  | "accountant"
  | "reception"
  | "staff"
  | "client"
  | "pending"
  | "guest";

export type UserProfile = {
  uid: string;
  email: string;
  name: string;
  phone: string;
  city: string;
  birthdate: string;
  avatarUrl?: string;
  clientId?: string;

  role: UiRole;

  membershipId?: string;
  membershipPercent?: number;

  active?: boolean;
  permissions?: AppPermission[];
  permissionOverrides?: PermissionOverrides;
  permissionVersion?: number;

  createdAt?: string;
  updatedAt?: string;
};

const SALON_ID = "main";

function safeStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function normalizeRole(roleRaw: unknown): UiRole {
  return normalizeAuthRole(roleRaw);
}

function buildDefaultName(role: UiRole) {
  if (role === "hr") return "Human Resources";
  if (role === "owner" || role === "admin") return "مدير الصالون";
  if (role === "reception" || role === "staff") return "موظفة";
  if (role === "client") return "عميلة";
  if (role === "pending") return "حساب إداري (بانتظار التفعيل)";
  return "مستخدم";
}

function buildPersistedDefaultName(role: UiRole) {
  if (role === "client") return "";
  return buildDefaultName(role);
}

function isPlaceholderName(name: string, role: UiRole) {
  const n = String(name || "").trim();
  if (!n) return true;
  const defaults = new Set<string>([
    "مستخدم",
    "عميلة",
    "موظفة",
    "مدير الصالون",
    "حساب إداري (بانتظار التفعيل)",
    buildDefaultName(role),
  ]);
  return defaults.has(n);
}

function isInternalEmail(email: string) {
  return safeStr(email).trim().toLowerCase().endsWith("@malikat.com");
}

function writeLocalCache(profile: UserProfile) {
  writeStoredAuthSession({
    uid: profile.uid,
    email: safeStr(profile.email),
    role: normalizeRole(profile.role),
    displayName: safeStr(profile.name),
    phone: safeStr(profile.phone),
    active: typeof profile.active === "boolean" ? profile.active : undefined,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : undefined,
    permissionOverrides: normalizePermissionOverrides(profile.permissionOverrides),
    permissionVersion: Number(profile.permissionVersion || 0) || undefined,
    profile,
  });
}

type ClientMeRow = {
  id?: string;
  name?: string;
  phone_normalized?: string;
  phone?: string;
  email?: string;
  city?: string;
  birthdate?: string;
  avatarUrl?: string;
  avatar_url?: string;
  membershipId?: string;
  membership_id?: string;
  membershipPercent?: number;
  membership_percent?: number;
  firebase_uid?: string;
};

async function ensureClientAccount(input: {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  birthdate?: string;
  avatarUrl?: string;
  membershipId?: string;
}) {
  return coreApiRequest<{
    user?: Record<string, unknown>;
    client?: ClientMeRow | null;
  }>("/api/core/auth/ensure-client", {
    method: "POST",
    body: { ...input },
  });
}

async function loadClientMe(): Promise<ClientMeRow | null> {
  try {
    return await coreApiRequest<ClientMeRow>("/api/core/client/me");
  } catch (error) {
    if (error instanceof CoreApiError && (error.status === 403 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

function mapFromAuthMe(
  me: CoreAuthMe,
  client: ClientMeRow | null,
  authUser: User
): UserProfile {
  const role = normalizeRole(me.user?.primaryRole || me.user?.role || "client");
  const authEmail = safeStr(authUser.email).trim();
  const authDisplayName = safeStr(authUser.displayName).trim();
  const storedName = safeStr(me.user?.displayName || client?.name).trim();
  let name =
    storedName ||
    authDisplayName ||
    buildPersistedDefaultName(role);
  if (authDisplayName && isPlaceholderName(storedName, role)) {
    name = authDisplayName;
  }
  if (role === "client" && !authDisplayName && isPlaceholderName(name, role)) {
    name = "";
  }
  if ((role === "owner" || role === "admin") && (!name || name === "مستخدم")) {
    name = "مدير الصالون";
  }

  const permissions = (me.permissions || me.user?.permissions || []) as AppPermission[];
  const active = me.user?.active !== false && me.user?.status !== "disabled";

  return {
    uid: safeStr(me.user?.firebaseUid || me.user?.uid || authUser.uid),
    email: safeStr(me.user?.email) || authEmail,
    name,
    phone: safeStr(client?.phone_normalized || client?.phone || me.user?.phone),
    city: safeStr(client?.city),
    birthdate: safeStr(client?.birthdate),
    avatarUrl: safeStr(client?.avatarUrl || client?.avatar_url || me.user?.photoUrl) || undefined,
    clientId: safeStr(client?.id) || undefined,
    role,
    active,
    permissions,
    permissionOverrides: normalizePermissionOverrides(undefined),
    permissionVersion: PERMISSION_SCHEMA_VERSION,
    membershipId: safeStr(client?.membershipId || client?.membership_id) || undefined,
    membershipPercent: Number(client?.membershipPercent ?? client?.membership_percent ?? 0) || 0,
    createdAt: me.user?.createdAt,
    updatedAt: me.user?.updatedAt,
  };
}

/**
 * createOrLoadUserProfile — Core D1 owns operational identity/profile.
 * Firebase Auth is used only for the signed-in uid/email/displayName.
 */
export async function createOrLoadUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;
  const authEmail = safeStr(user.email).trim();
  const authDisplayName = safeStr(user.displayName).trim();

  let me: CoreAuthMe | null = null;
  try {
    me = await CoreAccountService.me();
  } catch (error) {
    const missing =
      error instanceof CoreApiError &&
      (error.status === 403 ||
        error.code === "ACCOUNT_NOT_PROVISIONED" ||
        String(error.message || "").includes("ACCOUNT_NOT_PROVISIONED"));
    if (!missing) throw error;

    if (isInternalEmail(authEmail)) {
      throw new Error(
        "هذا الحساب الداخلي غير مفعّل في النظام. تواصل مع الإدارة لتفعيله."
      );
    }

    await ensureClientAccount({
      name: authDisplayName,
      email: authEmail,
      membershipId: `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`,
    });
    me = await CoreAccountService.me();
  }

  const role = normalizeRole(me.user?.primaryRole || me.user?.role || "client");
  let client: ClientMeRow | null = null;
  if (role === "client" || role === "guest" || role === "pending") {
    client = await loadClientMe();
    if (!client && role === "client") {
      await ensureClientAccount({
        name: authDisplayName || safeStr(me.user?.displayName),
        email: authEmail || safeStr(me.user?.email),
        phone: safeStr(me.user?.phone),
      });
      client = await loadClientMe();
    }
  }

  const profile = mapFromAuthMe(me, client, user);
  writeLocalCache(profile);
  return profile;
}

/**
 * updateUserProfile — patches Core client self profile (and mirrors display fields).
 * role/active/createdAt cannot be changed here.
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  const cleaned: Record<string, unknown> = {};
  Object.entries(updates).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") {
      // Allow clearing city/birthdate/avatar with empty string.
      if (k === "city" || k === "birthdate" || k === "avatarUrl") {
        cleaned[k] = "";
      }
      return;
    }
    if (k === "role" || k === "active" || k === "createdAt") return;
    cleaned[k] = v;
  });

  const body: Record<string, unknown> = {};
  if (typeof cleaned.name === "string") body.name = cleaned.name;
  if (typeof cleaned.phone === "string") body.phone = cleaned.phone;
  if (typeof cleaned.email === "string") body.email = cleaned.email;
  if (typeof cleaned.city === "string") body.city = cleaned.city;
  if (typeof cleaned.birthdate === "string") body.birthdate = cleaned.birthdate;
  if (typeof cleaned.avatarUrl === "string") body.avatarUrl = cleaned.avatarUrl;
  if (typeof cleaned.membershipId === "string") body.membershipId = cleaned.membershipId;
  if (typeof cleaned.membershipPercent === "number") {
    body.membershipPercent = cleaned.membershipPercent;
  }

  const before = await loadClientMe();
  await coreApiRequest("/api/core/client/me", { method: "PATCH", body });

  try {
    await writeAuditLog({
      salonId: SALON_ID,
      action: "client_updated",
      entityType: "client",
      entityId: uid,
      description: "تم تعديل بروفايل العميلة",
      source: "client_app",
      before,
      after: body,
      meta: {
        fields: Object.keys(body),
      },
    });
  } catch {
    // ignore
  }

  try {
    const current = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const merged = { ...(current || {}), ...updates, uid };
    if (current?.role) merged.role = current.role;
    if (typeof current?.active === "boolean") merged.active = current.active;
    if (current?.createdAt) merged.createdAt = current.createdAt;

    writeStoredAuthSession({
      uid,
      email: safeStr(merged?.email),
      role: normalizeRole(merged?.role),
      displayName: safeStr(merged?.name || merged?.displayName),
      phone: safeStr(merged?.phone),
      active: typeof merged?.active === "boolean" ? merged.active : undefined,
      permissions: Array.isArray(merged?.permissions) ? merged.permissions : undefined,
      permissionOverrides: normalizePermissionOverrides(merged?.permissionOverrides),
      permissionVersion: Number(merged?.permissionVersion || 0) || undefined,
      profile: merged,
    });
  } catch {
    // ignore
  }
}

export function canAccessDashboard(role: UiRole): boolean {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "hr" ||
    role === "accountant" ||
    role === "reception" ||
    role === "staff"
  );
}

export async function debugWhoAmI() {
  try {
    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) {
      console.log("❌ No auth user (currentUser is null)");
      return null;
    }
    const me = await CoreAccountService.me();
    const client = await loadClientMe();
    console.log("✅ AUTH:", { uid: u.uid, email: u.email });
    console.log("✅ Core auth/me:", me);
    console.log("✅ Core client/me:", client);
    console.log("✅ normalized role:", normalizeRole(me.user?.primaryRole || me.user?.role));
    return { uid: u.uid, email: u.email, me, client, role: normalizeRole(me.user?.primaryRole || me.user?.role) };
  } catch (e) {
    console.error("❌ debugWhoAmI failed:", e);
    return null;
  }
}
