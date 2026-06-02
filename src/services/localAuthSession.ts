import type { UiRole } from "./userProfile";

export type StoredAuthSession = {
  uid: string;
  email: string;
  role: UiRole;
  displayName: string;
  phone?: string;
  temp?: boolean;
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

function normalizeRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();
  if (role === "administrator") return "admin";
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
    return role as UiRole;
  }
  return "guest";
}

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

export function readStoredAuthSession(): StoredAuthSession | null {
  try {
    const authUser = parseJson<any>(localStorage.getItem(AUTH_USER_KEY));
    const profile = parseJson<any>(localStorage.getItem(USER_PROFILE_KEY));

    const uid = safeString(
      authUser?.uid || profile?.uid || localStorage.getItem(USER_UID_KEY)
    );
    const email = safeString(
      authUser?.email || profile?.email || localStorage.getItem(USER_EMAIL_KEY)
    );
    const role = normalizeRole(
      authUser?.role || profile?.role || localStorage.getItem(USER_ROLE_KEY)
    );
    const displayName = safeString(
      authUser?.displayName ||
        profile?.displayName ||
        profile?.name ||
        localStorage.getItem(USER_NAME_KEY)
    );
    const phone = safeString(profile?.phone || localStorage.getItem(USER_PHONE_KEY));

    if (!uid && !email && !displayName) return null;

    return {
      uid,
      email,
      role,
      displayName,
      phone: phone || undefined,
      temp: Boolean(authUser?.temp || profile?.temp),
    };
  } catch {
    return null;
  }
}

export function writeStoredAuthSession(session: StoredAuthSession) {
  const payload = {
    uid: session.uid,
    email: session.email,
    role: session.role,
    displayName: session.displayName,
    temp: Boolean(session.temp),
  };

  localStorage.removeItem("currentUser");
  localStorage.removeItem("userAvatar");
  localStorage.removeItem("userCity");
  localStorage.removeItem("userBirthdate");
  localStorage.setItem(AUTH_TOKEN_KEY, session.temp ? "local-temp" : "firebase");
  localStorage.setItem(USER_UID_KEY, session.uid);
  localStorage.setItem(USER_ROLE_KEY, session.role);
  if (session.displayName) localStorage.setItem(USER_NAME_KEY, session.displayName);
  else localStorage.removeItem(USER_NAME_KEY);
  if (session.email) localStorage.setItem(USER_EMAIL_KEY, session.email);
  else localStorage.removeItem(USER_EMAIL_KEY);
  if (session.phone) localStorage.setItem(USER_PHONE_KEY, session.phone);
  else localStorage.removeItem(USER_PHONE_KEY);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload));
  localStorage.setItem(
    USER_PROFILE_KEY,
    JSON.stringify({
      uid: session.uid,
      email: session.email,
      name: session.displayName,
      displayName: session.displayName,
      phone: session.phone || "",
      role: session.role,
      temp: Boolean(session.temp),
      active: true,
    })
  );
  localStorage.setItem(SHOW_WELCOME_KEY, "true");
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
