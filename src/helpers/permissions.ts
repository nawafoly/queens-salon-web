export type UserRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "pending"
  | "guest";

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
  hr: ["BOOKINGS_VIEW", "EMPLOYEES_MANAGE", "REPORTS_VIEW", "USERS_MANAGE"],
  reception: ["BOOKINGS_VIEW", "BOOKINGS_UPDATE_STATUS", "BOOKINGS_ADD_NOTES"],
  staff: ["BOOKINGS_VIEW"],
  pending: [],
  guest: [],
};

export function getUserRole(rawRole?: string): UserRole {
  const raw = String(rawRole || "").toLowerCase().trim();

  if (raw === "pending") return "pending";
  if (raw === "owner" || raw === "owner-role" || raw === "malik") return "owner";
  if (raw === "admin" || raw === "administrator" || raw === "manager") return "admin";
  if (raw === "hr" || raw === "human resources" || raw === "humanresources") return "hr";
  if (raw === "reception" || raw === "receptionist" || raw === "frontdesk" || raw === "desk") {
    return "reception";
  }
  if (raw === "staff") return "staff";

  return "guest";
}

export function can(permission: Permission, role?: UserRole): boolean {
  const r = role ?? "guest";
  return ROLE_PERMISSIONS[r]?.includes(permission) ?? false;
}
