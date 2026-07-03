export type UserRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "pending"
  | "guest";

export type LegacyPermission =
  | "BOOKINGS_VIEW"
  | "BOOKINGS_UPDATE_STATUS"
  | "BOOKINGS_ADD_NOTES"
  | "EMPLOYEES_MANAGE"
  | "SERVICES_MANAGE"
  | "OFFERS_MANAGE"
  | "REPORTS_VIEW"
  | "SETTINGS_MANAGE"
  | "USERS_MANAGE";

export type AppPermission =
  | "employees.view"
  | "employees.manage"
  | "recruitment.view"
  | "recruitment.manage"
  | "attendance.view"
  | "weekly_reports.manager_notes"
  | "settings.manage"
  | "admin_accounts.manage";

export type Permission = LegacyPermission | AppPermission;

export type PermissionOverrides = {
  enabled: AppPermission[];
  disabled: AppPermission[];
};

export type PermissionMeta = {
  key: AppPermission;
  label: string;
  hint: string;
  group: "staff" | "operations" | "system";
};

export const APP_PERMISSION_CATALOG: PermissionMeta[] = [
  {
    key: "employees.view",
    label: "عرض الموظفين",
    hint: "مشاهدة دليل الموظفات والملفات بدون تعديل.",
    group: "staff",
  },
  {
    key: "employees.manage",
    label: "إدارة الموظفين",
    hint: "إنشاء وتعديل ملفات الموظفات وربط إعدادات العمل.",
    group: "staff",
  },
  {
    key: "recruitment.view",
    label: "عرض طلبات التوظيف",
    hint: "استعراض طلبات التوظيف الواردة وحالاتها.",
    group: "staff",
  },
  {
    key: "recruitment.manage",
    label: "إدارة طلبات التوظيف",
    hint: "تحديث حالات طلبات التوظيف وإضافة المراجعات.",
    group: "staff",
  },
  {
    key: "attendance.view",
    label: "عرض الحضور والانصراف",
    hint: "الوصول إلى سجلات الحضور والانصراف والتقارير المرتبطة.",
    group: "operations",
  },
  {
    key: "weekly_reports.manager_notes",
    label: "كتابة ملاحظات المدير في التقارير",
    hint: "إضافة ملاحظات إدارية على التقارير الأسبوعية.",
    group: "operations",
  },
  {
    key: "settings.manage",
    label: "إدارة الإعدادات",
    hint: "تعديل إعدادات النظام والتشغيل.",
    group: "system",
  },
  {
    key: "admin_accounts.manage",
    label: "إدارة حسابات الإدارة",
    hint: "إدارة حسابات المنصة الداخلية والأدوار والصلاحيات.",
    group: "system",
  },
];

const APP_PERMISSION_SET = new Set<AppPermission>(
  APP_PERMISSION_CATALOG.map((item) => item.key)
);

const ROLE_PERMISSIONS: Record<UserRole, LegacyPermission[]> = {
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

export const ROLE_APP_PERMISSIONS: Record<UserRole, AppPermission[]> = {
  owner: APP_PERMISSION_CATALOG.map((item) => item.key),
  admin: [
    "employees.view",
    "employees.manage",
    "recruitment.view",
    "recruitment.manage",
    "attendance.view",
    "weekly_reports.manager_notes",
    "settings.manage",
  ],
  hr: [
    "employees.view",
    "employees.manage",
    "recruitment.view",
    "recruitment.manage",
    "attendance.view",
    "weekly_reports.manager_notes",
    "admin_accounts.manage",
  ],
  reception: ["employees.view", "attendance.view"],
  staff: ["attendance.view"],
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

export function isAppPermission(value: unknown): value is AppPermission {
  return APP_PERMISSION_SET.has(String(value || "").trim() as AppPermission);
}

export function normalizeAppPermissions(input: unknown): AppPermission[] {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set<AppPermission>();
  const out: AppPermission[] = [];

  values.forEach((value) => {
    const key = String(value || "").trim();
    if (!isAppPermission(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });

  return out;
}

export function normalizePermissionOverrides(input: unknown): PermissionOverrides {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    enabled: normalizeAppPermissions(raw.enabled || raw.added || raw.add),
    disabled: normalizeAppPermissions(raw.disabled || raw.removed || raw.remove),
  };
}

export function getRoleAppPermissions(role?: UserRole | string): AppPermission[] {
  return [...(ROLE_APP_PERMISSIONS[getUserRole(role)] || [])];
}

export function getEffectiveAppPermissions(args: {
  role?: UserRole | string;
  permissions?: unknown;
  permissionOverrides?: unknown;
}): AppPermission[] {
  const role = getUserRole(args.role);
  const base = new Set<AppPermission>(getRoleAppPermissions(role));
  const stored = normalizeAppPermissions(args.permissions);
  const overrides = normalizePermissionOverrides(args.permissionOverrides);

  if (stored.length && !overrides.enabled.length && !overrides.disabled.length) {
    return stored;
  }

  overrides.enabled.forEach((permission) => base.add(permission));
  overrides.disabled.forEach((permission) => base.delete(permission));
  return APP_PERMISSION_CATALOG
    .map((item) => item.key)
    .filter((permission) => base.has(permission));
}

export function buildPermissionOverrides(role: UserRole | string, selected: unknown): PermissionOverrides {
  const roleDefaults = new Set(getRoleAppPermissions(role));
  const selectedSet = new Set(normalizeAppPermissions(selected));

  return {
    enabled: APP_PERMISSION_CATALOG
      .map((item) => item.key)
      .filter((permission) => selectedSet.has(permission) && !roleDefaults.has(permission)),
    disabled: APP_PERMISSION_CATALOG
      .map((item) => item.key)
      .filter((permission) => roleDefaults.has(permission) && !selectedSet.has(permission)),
  };
}

export function hasAppPermission(
  permission: AppPermission,
  role?: UserRole | string,
  permissions?: unknown,
  permissionOverrides?: unknown
): boolean {
  return getEffectiveAppPermissions({ role, permissions, permissionOverrides }).includes(permission);
}

export function can(permission: Permission, role?: UserRole): boolean {
  const r = role ?? "guest";
  if (isAppPermission(permission)) {
    return ROLE_APP_PERMISSIONS[r]?.includes(permission) ?? false;
  }
  return ROLE_PERMISSIONS[r]?.includes(permission as LegacyPermission) ?? false;
}
