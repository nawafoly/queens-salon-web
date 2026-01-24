// src/helpers/permissions.ts

export type UserRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "pending" // ✅ حساب بانتظار التفعيل
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

/**
 * صلاحيات كل دور
 * ⚠️ pending و guest بدون أي صلاحيات
 */
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

  pending: [], // ✅ لا صلاحيات حتى يتم التفعيل

  guest: [],
};

/**
 * قراءة الدور الحالي من localStorage
 * (يتم كتابته من Login.tsx بعد الربط مع staff_public)
 */
export function getUserRole(): UserRole {
  const raw = (localStorage.getItem("userRole") || "").toLowerCase().trim();

  // pending (بانتظار التفعيل)
  if (
    raw === "pending" ||
    raw === "معلق" ||
    raw === "بانتظار" ||
    raw === "بانتظار التفعيل"
  ) {
    return "pending";
  }

  // owner
  if (raw === "owner" || raw === "اونر" || raw === "مالك") return "owner";

  // admin
  if (raw === "admin" || raw === "ادمن" || raw === "مدير") return "admin";

  // reception
  if (
    raw === "reception" ||
    raw === "رسبشن" ||
    raw === "استقبال"
  ) {
    return "reception";
  }

  // staff
  if (raw === "staff" || raw === "ستاف" || raw === "موظفة") return "staff";

  return "guest";
}

/**
 * التحقق من صلاحية معيّنة
 */
export function can(permission: Permission, role?: UserRole): boolean {
  const r = role ?? getUserRole();
  return ROLE_PERMISSIONS[r]?.includes(permission) ?? false;
}
