// src/helpers/permissions.ts
export type UserRole = "owner" | "admin" | "reception" | "staff" | "guest";

export type Permission =
  | "BOOKINGS_VIEW"
  | "BOOKINGS_UPDATE_STATUS"
  | "BOOKINGS_ADD_NOTES"
  | "EMPLOYEES_MANAGE"
  | "SERVICES_MANAGE"
  | "OFFERS_MANAGE"
  | "REPORTS_VIEW"
  | "SETTINGS_MANAGE"
  | "USERS_MANAGE";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    "BOOKINGS_VIEW",
    "BOOKINGS_UPDATE_STATUS",
    "BOOKINGS_ADD_NOTES",
    "EMPLOYEES_MANAGE",
    "SERVICES_MANAGE",
    "OFFERS_MANAGE",
    "REPORTS_VIEW",
    "SETTINGS_MANAGE",
    "USERS_MANAGE",
  ],
  admin: [
    "BOOKINGS_VIEW",
    "BOOKINGS_UPDATE_STATUS",
    "BOOKINGS_ADD_NOTES",
    "EMPLOYEES_MANAGE",
    "SERVICES_MANAGE",
    "OFFERS_MANAGE",
    "REPORTS_VIEW",
  ],
  reception: [
    "BOOKINGS_VIEW",
    "BOOKINGS_UPDATE_STATUS",
    "BOOKINGS_ADD_NOTES",
  ],
  staff: ["BOOKINGS_VIEW"],
  guest: [],
};

export function getUserRole(): UserRole {
  const raw = (localStorage.getItem("userRole") || "").toLowerCase().trim();

  // دعم عربي/إنجليزي لو موجود عندك
  if (raw === "owner" || raw === "اونر" || raw === "مالك") return "owner";
  if (raw === "admin" || raw === "ادمن" || raw === "مدير") return "admin";
  if (raw === "reception" || raw === "رسبشن" || raw === "استقبال") return "reception";
  if (raw === "staff" || raw === "ستاف" || raw === "موظفة") return "staff";

  return "guest";
}

export function can(permission: Permission, role?: UserRole): boolean {
  const r = role ?? getUserRole();
  return ROLE_PERMISSIONS[r]?.includes(permission) ?? false;
}
