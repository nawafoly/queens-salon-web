import type { UiRole } from "./userProfile";
import { normalizeAuthRole } from "./authAccess";

export type StoredAuthSession = {
  uid: string;
  email: string;
  role: UiRole;
  displayName: string;
  phone?: string;
  authToken?: string;
  active?: boolean;
  permissions?: unknown[];
  permissionOverrides?: Record<string, unknown>;
  permissionVersion?: number;
};

export type StoredAuthSessionInput = StoredAuthSession & {
  profile?: Record<string, unknown> | null;
  showWelcome?: boolean;
};

const AUTH_TOKEN_KEY = "authToken";
const AUTH_USER_KEY = "auth_user";
const USER_PROFILE_KEY = "user_profile_v1";
const USER_ROLE_KEY = "userRole";
const USER_NAME_KEY = "userName";
const USER_UID_KEY = "userUid";
const USER_EMAIL_KEY = "userEmail";
const USER_PHONE_KEY = "userPhone";
const SHOW_WELCOME_KEY = "showWelcome";

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasRecognizedAuthToken(authToken: string) {
  return authToken === "firebase" || authToken.startsWith("client-token-");
}

export function isLegacyClientSession(session: StoredAuthSession | null | undefined) {
  return Boolean(
    session &&
      session.role === "client" &&
      String(session.authToken || "").startsWith("client-token-")
  );
}

export function readStoredAuthSession(): StoredAuthSession | null {
  try {
    const authUser = parseJson<Record<string, unknown>>(localStorage.getItem(AUTH_USER_KEY));
    const profile = parseJson<Record<string, unknown>>(localStorage.getItem(USER_PROFILE_KEY));
    const authToken = safeString(localStorage.getItem(AUTH_TOKEN_KEY));

    const uid = safeString(
      authUser?.uid || profile?.uid || localStorage.getItem(USER_UID_KEY)
    );
    const email = safeString(
      authUser?.email || profile?.email || localStorage.getItem(USER_EMAIL_KEY)
    );
    const role = normalizeAuthRole(
      authUser?.role || profile?.role || localStorage.getItem(USER_ROLE_KEY)
    );
    const displayName = safeString(
      authUser?.displayName ||
        profile?.displayName ||
        profile?.name ||
        localStorage.getItem(USER_NAME_KEY)
    );
    const phone = safeString(profile?.phone || localStorage.getItem(USER_PHONE_KEY));
    const active =
      typeof profile?.active === "boolean"
        ? profile.active
        : typeof authUser?.active === "boolean"
          ? authUser.active
          : undefined;
    const isTempSession =
      authToken === "local-temp" ||
      uid.startsWith("temp:") ||
      Boolean(authUser?.temp || profile?.temp);

    if (!uid && !email && !displayName) return null;
    if (isTempSession) {
      clearStoredAuthSession();
      return null;
    }
    if (!hasRecognizedAuthToken(authToken)) {
      clearStoredAuthSession();
      return null;
    }

    return {
      uid,
      email,
      role,
      displayName,
      phone: phone || undefined,
      authToken,
      active,
      permissions: Array.isArray(authUser?.permissions)
        ? authUser.permissions
        : Array.isArray(profile?.permissions)
          ? profile.permissions
          : undefined,
      permissionOverrides:
        authUser?.permissionOverrides && typeof authUser.permissionOverrides === "object"
          ? (authUser.permissionOverrides as Record<string, unknown>)
          : profile?.permissionOverrides && typeof profile.permissionOverrides === "object"
            ? (profile.permissionOverrides as Record<string, unknown>)
            : undefined,
      permissionVersion:
        Number(authUser?.permissionVersion || profile?.permissionVersion || 0) || undefined,
    };
  } catch {
    return null;
  }
}

export function writeStoredAuthSession(session: StoredAuthSessionInput) {
  clearStoredAuthSession();

  const sourceProfile =
    session.profile && typeof session.profile === "object" ? session.profile : {};
  const role = normalizeAuthRole(session.role);
  const displayName =
    safeString(session.displayName) ||
    safeString(sourceProfile.displayName) ||
    safeString(sourceProfile.name);
  const email = safeString(session.email || sourceProfile.email);
  const phone = safeString(session.phone || sourceProfile.phone);
  const city = safeString(sourceProfile.city);
  const birthdate = safeString(sourceProfile.birthdate);
  const avatarUrl = safeString(sourceProfile.avatarUrl);
  const active =
    typeof session.active === "boolean"
      ? session.active
      : typeof sourceProfile.active === "boolean"
        ? sourceProfile.active
        : undefined;
  const permissions = Array.isArray(session.permissions)
    ? session.permissions
    : Array.isArray(sourceProfile.permissions)
      ? sourceProfile.permissions
      : [];
  const permissionOverrides =
    session.permissionOverrides && typeof session.permissionOverrides === "object"
      ? session.permissionOverrides
      : sourceProfile.permissionOverrides && typeof sourceProfile.permissionOverrides === "object"
        ? sourceProfile.permissionOverrides
        : undefined;
  const permissionVersion =
    Number(session.permissionVersion || sourceProfile.permissionVersion || 0) || undefined;
  const authToken = safeString(session.authToken) || "firebase";

  const authPayload = {
    uid: session.uid,
    email,
    role,
    displayName,
    active,
    permissions,
    permissionOverrides,
    permissionVersion,
  };

  const profilePayload = {
    ...sourceProfile,
    uid: session.uid,
    email,
    name: displayName,
    displayName,
    phone,
    role,
    ...(typeof active === "boolean" ? { active } : {}),
    permissions,
    ...(permissionOverrides ? { permissionOverrides } : {}),
    ...(permissionVersion ? { permissionVersion } : {}),
  };

  localStorage.removeItem("currentUser");
  localStorage.removeItem("userAvatar");
  localStorage.removeItem("userCity");
  localStorage.removeItem("userBirthdate");
  localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  localStorage.setItem(USER_UID_KEY, session.uid);
  localStorage.setItem(USER_ROLE_KEY, role);
  if (displayName) localStorage.setItem(USER_NAME_KEY, displayName);
  if (email) localStorage.setItem(USER_EMAIL_KEY, email);
  if (phone) localStorage.setItem(USER_PHONE_KEY, phone);
  if (city) localStorage.setItem("userCity", city);
  if (birthdate) localStorage.setItem("userBirthdate", birthdate);
  if (avatarUrl) localStorage.setItem("userAvatar", avatarUrl);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(authPayload));
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profilePayload));
  if (session.showWelcome === true) {
    localStorage.setItem(SHOW_WELCOME_KEY, "true");
  }
  window.dispatchEvent(new Event("authChanged"));
}

export function clearStoredAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(USER_ROLE_KEY);
  localStorage.removeItem(USER_NAME_KEY);
  localStorage.removeItem(USER_UID_KEY);
  localStorage.removeItem(USER_EMAIL_KEY);
  localStorage.removeItem(USER_PHONE_KEY);
  localStorage.removeItem("userCity");
  localStorage.removeItem("userBirthdate");
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(USER_PROFILE_KEY);
  localStorage.removeItem(SHOW_WELCOME_KEY);
  localStorage.removeItem("userAvatar");
  localStorage.removeItem("currentUser");
}
