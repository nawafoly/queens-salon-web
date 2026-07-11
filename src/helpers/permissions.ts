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

export const PERMISSION_SCHEMA_VERSION = 3;

export type PermissionGroup =
  | "workspace"
  | "bookings"
  | "customers"
  | "finance"
  | "workforce"
  | "reports"
  | "content"
  | "system";

export type AppPermission =
  | "workspace.dashboard.view"
  | "workspace.employee_portal.view"
  | "bookings.view"
  | "bookings.create"
  | "bookings.update"
  | "bookings.cancel"
  | "bookings.delete"
  | "bookings.payment.manage"
  | "bookings.print"
  | "bookings.bulk.manage"
  | "bookings.day_audit.manage"
  | "bookings.queue_tv.view"
  | "clients.view"
  | "clients.manage"
  | "clients.packages.manage"
  | "clients.loyalty.manage"
  | "income.view"
  | "income.manage"
  | "expenses.view"
  | "expenses.manage"
  | "employees.view"
  | "employees.create"
  | "employees.update"
  | "employees.delete"
  | "employees.manage"
  | "employees.files.view"
  | "employees.files.manage"
  | "employees.schedule.manage"
  | "attendance.own.view"
  | "attendance.view"
  | "attendance.records.create"
  | "attendance.records.update"
  | "attendance.records.delete"
  | "attendance.absences.manage"
  | "attendance.leaves.manage"
  | "attendance.export"
  | "attendance.settings.manage"
  | "payroll.view"
  | "payroll.manage"
  | "recruitment.view"
  | "recruitment.manage"
  | "reports.view"
  | "reports.export"
  | "weekly_reports.manager_notes"
  | "messages.view"
  | "messages.manage"
  | "catalog.manage"
  | "offers.manage"
  | "content.manage"
  | "partners.manage"
  | "logs.view"
  | "settings.manage"
  | "settings.general.manage"
  | "settings.booking.manage"
  | "settings.content.manage"
  | "admin_accounts.view"
  | "admin_accounts.manage"
  | "permissions.manage";

export type Permission = LegacyPermission | AppPermission;

export type PermissionOverrides = {
  enabled: AppPermission[];
  disabled: AppPermission[];
};

export type PermissionMeta = {
  key: AppPermission;
  label: string;
  hint: string;
  group: PermissionGroup;
  action: "view" | "create" | "update" | "delete" | "manage" | "export" | "use";
  visible?: boolean;
  sensitive?: boolean;
};

export type PermissionGroupMeta = {
  key: PermissionGroup;
  label: string;
  hint: string;
};

export const APP_PERMISSION_GROUPS: PermissionGroupMeta[] = [
  { key: "workspace", label: "مساحات العمل", hint: "الدخول إلى اللوحات والبوابات الرئيسية." },
  { key: "bookings", label: "الحجوزات والتشغيل", hint: "الحجوزات، الفواتير، شاشة الانتظار وإغلاق اليوم." },
  { key: "customers", label: "العملاء والولاء", hint: "ملفات العملاء والباقات والولاء." },
  { key: "finance", label: "المالية", hint: "الإيرادات والمصروفات والتحكم المالي." },
  { key: "workforce", label: "الموظفات والموارد البشرية", hint: "الموظفات والحضور والرواتب والإجازات والتوظيف." },
  { key: "reports", label: "التقارير والتواصل", hint: "التقارير والتصدير والرسائل وسجل الحركات." },
  { key: "content", label: "المحتوى والتسويق", hint: "الكتالوج والعروض ومحتوى الموقع والشريكات." },
  { key: "system", label: "النظام والحسابات", hint: "الإعدادات والحسابات والأدوار والصلاحيات." },
];

export const APP_PERMISSION_CATALOG: PermissionMeta[] = [
  { key: "workspace.dashboard.view", label: "فتح لوحة التشغيل", hint: "الدخول إلى لوحة التحكم الرئيسية.", group: "workspace", action: "view" },
  { key: "workspace.employee_portal.view", label: "فتح بوابة الموظفة", hint: "الدخول إلى بوابة الموظفة والملف الشخصي.", group: "workspace", action: "view" },

  { key: "bookings.view", label: "عرض الحجوزات", hint: "عرض قائمة الحجوزات وتفاصيلها.", group: "bookings", action: "view" },
  { key: "bookings.create", label: "إنشاء حجز", hint: "إنشاء حجوزات داخلية جديدة.", group: "bookings", action: "create" },
  { key: "bookings.update", label: "تعديل الحجز", hint: "تعديل بيانات الحجز وحالته.", group: "bookings", action: "update" },
  { key: "bookings.cancel", label: "إلغاء الحجز", hint: "إلغاء حجز قائم مع تسجيل العملية.", group: "bookings", action: "manage" },
  { key: "bookings.delete", label: "حذف الحجز نهائيًا", hint: "حذف الحجوزات نهائيًا. صلاحية حساسة.", group: "bookings", action: "delete", sensitive: true },
  { key: "bookings.payment.manage", label: "إدارة دفعات الحجز", hint: "تسجيل الدفعات وتعديل طرق الدفع والمبالغ.", group: "bookings", action: "manage", sensitive: true },
  { key: "bookings.print", label: "طباعة الفاتورة", hint: "عرض وطباعة فاتورة الحجز.", group: "bookings", action: "use" },
  { key: "bookings.bulk.manage", label: "الإجراءات الجماعية", hint: "تحديث مجموعة حجوزات دفعة واحدة.", group: "bookings", action: "manage", sensitive: true },
  { key: "bookings.day_audit.manage", label: "إغلاق اليوم والشفت", hint: "مراجعة وإغلاق اليوم المالي والتشغيلي.", group: "bookings", action: "manage", sensitive: true },
  { key: "bookings.queue_tv.view", label: "عرض شاشة الحجوزات", hint: "فتح شاشة الانتظار والتشغيل التلفزيونية.", group: "bookings", action: "view" },

  { key: "clients.view", label: "عرض العملاء", hint: "عرض ملفات العملاء وسجلهم.", group: "customers", action: "view" },
  { key: "clients.manage", label: "إدارة العملاء", hint: "تعديل بيانات العملاء وربط الحسابات.", group: "customers", action: "manage" },
  { key: "clients.packages.manage", label: "إدارة باقات العملاء", hint: "إضافة الجلسات وخصمها وتعديل الأرصدة.", group: "customers", action: "manage" },
  { key: "clients.loyalty.manage", label: "إدارة الولاء", hint: "إدارة مستويات الولاء والمزايا والنقاط.", group: "customers", action: "manage" },

  { key: "income.view", label: "عرض الإيرادات", hint: "عرض الإيرادات وحركات الدخل.", group: "finance", action: "view", sensitive: true },
  { key: "income.manage", label: "إدارة الإيرادات", hint: "إنشاء وتعديل وتسوية الإيرادات.", group: "finance", action: "manage", sensitive: true },
  { key: "expenses.view", label: "عرض المصروفات", hint: "عرض المصروفات والمرفقات.", group: "finance", action: "view", sensitive: true },
  { key: "expenses.manage", label: "إدارة المصروفات", hint: "إضافة وتعديل واعتماد المصروفات.", group: "finance", action: "manage", sensitive: true },

  { key: "employees.view", label: "عرض الموظفات", hint: "مشاهدة دليل الموظفات والملفات الأساسية.", group: "workforce", action: "view" },
  { key: "employees.create", label: "إضافة موظفة", hint: "إنشاء ملف موظفة وربطه بحساب.", group: "workforce", action: "create" },
  { key: "employees.update", label: "تعديل ملف موظفة", hint: "تعديل البيانات الوظيفية والشخصية.", group: "workforce", action: "update" },
  { key: "employees.delete", label: "حذف أو تعطيل موظفة", hint: "تعطيل أو حذف ملف موظفة. صلاحية حساسة.", group: "workforce", action: "delete", sensitive: true },
  { key: "employees.files.view", label: "عرض ملفات الموظفات", hint: "عرض المستندات والملفات الوظيفية.", group: "workforce", action: "view", sensitive: true },
  { key: "employees.files.manage", label: "إدارة ملفات الموظفات", hint: "رفع وتعديل وحذف الملفات الوظيفية.", group: "workforce", action: "manage", sensitive: true },
  { key: "employees.schedule.manage", label: "إدارة جداول الدوام", hint: "تعديل جداول العمل والأيام والإجازات الأسبوعية.", group: "workforce", action: "manage" },
  { key: "attendance.own.view", label: "عرض الحضور الشخصي", hint: "عرض سجل حضور الحساب نفسه.", group: "workforce", action: "view" },
  { key: "attendance.view", label: "عرض حضور الفريق", hint: "عرض حضور وانصراف جميع الموظفات.", group: "workforce", action: "view", sensitive: true },
  { key: "attendance.records.create", label: "إضافة بصمة إدارية", hint: "إنشاء سجل حضور أو انصراف من الإدارة.", group: "workforce", action: "create", sensitive: true },
  { key: "attendance.records.update", label: "تعديل سجل حضور", hint: "تصحيح وقت أو بيانات سجل حضور.", group: "workforce", action: "update", sensitive: true },
  { key: "attendance.records.delete", label: "حذف سجل حضور", hint: "حذف بصمة حضور أو انصراف. صلاحية شديدة الحساسية.", group: "workforce", action: "delete", sensitive: true },
  { key: "attendance.absences.manage", label: "إدارة الغياب", hint: "تسجيل واعتماد وإلغاء الغياب.", group: "workforce", action: "manage" },
  { key: "attendance.leaves.manage", label: "إدارة الإجازات", hint: "مراجعة واعتماد ورفض الإجازات.", group: "workforce", action: "manage" },
  { key: "attendance.export", label: "تصدير الحضور", hint: "تصدير تقارير الحضور والانصراف.", group: "workforce", action: "export", sensitive: true },
  { key: "attendance.settings.manage", label: "إعدادات الحضور والبصمة", hint: "إدارة النطاقات والموقع وسياسات البصمة.", group: "workforce", action: "manage", sensitive: true },
  { key: "payroll.view", label: "عرض الرواتب", hint: "عرض سجلات الرواتب والاستحقاقات.", group: "workforce", action: "view", sensitive: true },
  { key: "payroll.manage", label: "إدارة الرواتب", hint: "إنشاء وتعديل واعتماد الرواتب والخصومات.", group: "workforce", action: "manage", sensitive: true },
  { key: "recruitment.view", label: "عرض طلبات التوظيف", hint: "استعراض طلبات التوظيف الواردة.", group: "workforce", action: "view" },
  { key: "recruitment.manage", label: "إدارة طلبات التوظيف", hint: "تحديث الحالات والمراجعات والقرارات.", group: "workforce", action: "manage" },

  { key: "reports.view", label: "عرض التقارير", hint: "عرض تقارير الأداء والتشغيل.", group: "reports", action: "view", sensitive: true },
  { key: "reports.export", label: "تصدير التقارير", hint: "تصدير التقارير إلى ملفات خارجية.", group: "reports", action: "export", sensitive: true },
  { key: "weekly_reports.manager_notes", label: "ملاحظات المدير الأسبوعية", hint: "كتابة ملاحظات إدارية على التقارير الأسبوعية.", group: "reports", action: "update" },
  { key: "messages.view", label: "عرض الرسائل", hint: "عرض الرسائل الداخلية المرتبطة بالعمل.", group: "reports", action: "view", sensitive: true },
  { key: "messages.manage", label: "إدارة الرسائل", hint: "إرسال وإدارة ومراجعة الرسائل الداخلية.", group: "reports", action: "manage", sensitive: true },
  { key: "logs.view", label: "عرض سجل الحركات", hint: "عرض السجل التدقيقي للعمليات الحساسة.", group: "reports", action: "view", sensitive: true },

  { key: "catalog.manage", label: "إدارة الكتالوج", hint: "إدارة الخدمات والأقسام والفئات والباقات.", group: "content", action: "manage" },
  { key: "offers.manage", label: "إدارة العروض والكوبونات", hint: "إنشاء وتعديل العروض والكوبونات.", group: "content", action: "manage" },
  { key: "content.manage", label: "إدارة محتوى الموقع", hint: "تعديل بيانات ومحتوى صفحات الموقع.", group: "content", action: "manage" },
  { key: "partners.manage", label: "إدارة الشريكات والمساحات", hint: "إدارة الشريكات والعقود والموارد المؤجرة.", group: "content", action: "manage", sensitive: true },

  { key: "settings.general.manage", label: "الإعدادات العامة", hint: "تعديل إعدادات الصالون والتشغيل العامة.", group: "system", action: "manage", sensitive: true },
  { key: "settings.booking.manage", label: "إعدادات الحجوزات", hint: "تعديل سياسات وساعات وقواعد الحجز.", group: "system", action: "manage", sensitive: true },
  { key: "settings.content.manage", label: "إعدادات المحتوى", hint: "تعديل إعدادات ظهور المحتوى العام.", group: "system", action: "manage" },
  { key: "admin_accounts.view", label: "عرض الحسابات الإدارية", hint: "عرض الحسابات والأدوار والصلاحيات.", group: "system", action: "view", sensitive: true },
  { key: "admin_accounts.manage", label: "إدارة الحسابات الإدارية", hint: "إنشاء وتعطيل وتعديل الحسابات الإدارية.", group: "system", action: "manage", sensitive: true },
  { key: "permissions.manage", label: "إدارة الصلاحيات", hint: "منح وسحب الصلاحيات التفصيلية. أعلى صلاحية إدارية.", group: "system", action: "manage", sensitive: true },

  // مفاتيح توافق مؤقتة مع أجزاء الواجهة القديمة. لا تظهر في المحرر الجديد.
  { key: "employees.manage", label: "إدارة الموظفين (توافق)", hint: "مفتاح قديم للتوافق حتى اكتمال ترحيل الواجهات.", group: "workforce", action: "manage", visible: false },
  { key: "settings.manage", label: "إدارة الإعدادات (توافق)", hint: "مفتاح قديم للتوافق حتى اكتمال ترحيل الواجهات.", group: "system", action: "manage", visible: false },
];

const APP_PERMISSION_SET = new Set<AppPermission>(APP_PERMISSION_CATALOG.map((item) => item.key));

export const VISIBLE_APP_PERMISSION_CATALOG = APP_PERMISSION_CATALOG.filter(
  (item) => item.visible !== false
);

const ALL_VISIBLE_PERMISSIONS = VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key);

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

const COMMON_INTERNAL: AppPermission[] = [
  "workspace.employee_portal.view",
  "attendance.own.view",
  "messages.view",
];

export const ROLE_APP_PERMISSIONS: Record<UserRole, AppPermission[]> = {
  owner: APP_PERMISSION_CATALOG.map((item) => item.key),
  admin: [
    "workspace.dashboard.view",
    "workspace.employee_portal.view",
    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.payment.manage",
    "bookings.print",
    "bookings.bulk.manage",
    "bookings.day_audit.manage",
    "bookings.queue_tv.view",
    "clients.view",
    "clients.manage",
    "clients.packages.manage",
    "clients.loyalty.manage",
    "income.view",
    "income.manage",
    "expenses.view",
    "expenses.manage",
    "employees.view",
    "employees.create",
    "employees.update",
    "employees.files.view",
    "employees.files.manage",
    "employees.schedule.manage",
    "employees.manage",
    "attendance.own.view",
    "attendance.view",
    "attendance.records.create",
    "attendance.records.update",
    "attendance.absences.manage",
    "attendance.leaves.manage",
    "attendance.export",
    "attendance.settings.manage",
    "payroll.view",
    "payroll.manage",
    "recruitment.view",
    "recruitment.manage",
    "reports.view",
    "reports.export",
    "weekly_reports.manager_notes",
    "messages.view",
    "messages.manage",
    "catalog.manage",
    "offers.manage",
    "content.manage",
    "partners.manage",
    "logs.view",
    "settings.manage",
    "settings.general.manage",
    "settings.booking.manage",
    "settings.content.manage",
    "admin_accounts.view",
  ],
  hr: [
    "workspace.employee_portal.view",
    "employees.view",
    "employees.create",
    "employees.update",
    "employees.files.view",
    "employees.files.manage",
    "employees.schedule.manage",
    "employees.manage",
    "attendance.own.view",
    "attendance.view",
    "attendance.records.create",
    "attendance.records.update",
    "attendance.absences.manage",
    "attendance.leaves.manage",
    "attendance.export",
    "payroll.view",
    "payroll.manage",
    "recruitment.view",
    "recruitment.manage",
    "reports.view",
    "weekly_reports.manager_notes",
    "messages.view",
    "messages.manage",
    "admin_accounts.view",
    "admin_accounts.manage",
  ],
  reception: [
    "workspace.dashboard.view",
    "workspace.employee_portal.view",
    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.payment.manage",
    "bookings.print",
    "bookings.day_audit.manage",
    "bookings.queue_tv.view",
    "clients.view",
    "clients.manage",
    "employees.view",
    "attendance.own.view",
    "attendance.view",
    "messages.view",
  ],
  staff: [...COMMON_INTERNAL],
  pending: [],
  guest: [],
};

export function getUserRole(rawRole?: string): UserRole {
  const raw = String(rawRole || "").toLowerCase().trim();

  if (raw === "pending") return "pending";
  if (raw === "owner" || raw === "owner-role" || raw === "malik" || raw === "المالك" || raw === "مالك") return "owner";
  if (raw === "admin" || raw === "administrator" || raw === "manager" || raw === "super_admin" || raw === "super-admin") return "admin";
  if (
    raw === "hr" ||
    raw === "human resources" ||
    raw === "humanresources" ||
    raw === "human_resources" ||
    raw === "human-resources" ||
    raw === "اتش ار" ||
    raw === "الموارد البشرية" ||
    raw === "موارد بشرية" ||
    raw === "مسؤول موارد بشرية" ||
    raw === "مسؤولة موارد بشرية"
  ) return "hr";
  if (raw === "reception" || raw === "receptionist" || raw === "frontdesk" || raw === "desk") return "reception";
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
  permissionVersion?: unknown;
}): AppPermission[] {
  const role = getUserRole(args.role);

  // المالك يملك كل الصلاحيات دائمًا، ولا يمكن خفضه باستثناء محلي قديم.
  if (role === "owner") return [...APP_PERMISSION_CATALOG.map((item) => item.key)];

  const base = new Set<AppPermission>(getRoleAppPermissions(role));
  const stored = normalizeAppPermissions(args.permissions);
  const overrides = normalizePermissionOverrides(args.permissionOverrides);
  const version = Number(args.permissionVersion || 0) || 0;

  // مستندات v3 تحفظ الصلاحيات الفعلية صراحةً. الإصدارات القديمة تُعامل كدور + استثناءات
  // حتى لا تفقد الحسابات صلاحيات جديدة عند توسيع السجل المركزي.
  if (
    version >= PERMISSION_SCHEMA_VERSION &&
    Array.isArray(args.permissions) &&
    !overrides.enabled.length &&
    !overrides.disabled.length
  ) {
    return APP_PERMISSION_CATALOG.map((item) => item.key).filter((permission) => stored.includes(permission));
  }

  overrides.enabled.forEach((permission) => base.add(permission));
  overrides.disabled.forEach((permission) => base.delete(permission));

  return APP_PERMISSION_CATALOG.map((item) => item.key).filter((permission) => base.has(permission));
}

export function buildPermissionOverrides(role: UserRole | string, selected: unknown): PermissionOverrides {
  const normalizedRole = getUserRole(role);
  if (normalizedRole === "owner") return { enabled: [], disabled: [] };

  const roleDefaults = new Set(getRoleAppPermissions(normalizedRole));
  const selectedSet = new Set(normalizeAppPermissions(selected));

  return {
    enabled: APP_PERMISSION_CATALOG.map((item) => item.key).filter(
      (permission) => selectedSet.has(permission) && !roleDefaults.has(permission)
    ),
    disabled: APP_PERMISSION_CATALOG.map((item) => item.key).filter(
      (permission) => roleDefaults.has(permission) && !selectedSet.has(permission)
    ),
  };
}

export function hasAppPermission(
  permission: AppPermission,
  role?: UserRole | string,
  permissions?: unknown,
  permissionOverrides?: unknown,
  permissionVersion?: unknown
): boolean {
  return getEffectiveAppPermissions({ role, permissions, permissionOverrides, permissionVersion }).includes(permission);
}

export function hasAnyAppPermission(
  required: AppPermission[],
  args: { role?: UserRole | string; permissions?: unknown; permissionOverrides?: unknown; permissionVersion?: unknown }
): boolean {
  if (!required.length) return true;
  const effective = new Set(getEffectiveAppPermissions(args));
  return required.some((permission) => effective.has(permission));
}

export function hasAllAppPermissions(
  required: AppPermission[],
  args: { role?: UserRole | string; permissions?: unknown; permissionOverrides?: unknown; permissionVersion?: unknown }
): boolean {
  if (!required.length) return true;
  const effective = new Set(getEffectiveAppPermissions(args));
  return required.every((permission) => effective.has(permission));
}

export function getPermissionGroup(permission: AppPermission): PermissionGroup | null {
  return APP_PERMISSION_CATALOG.find((item) => item.key === permission)?.group || null;
}

export function getVisiblePermissionsForGroup(group: PermissionGroup): PermissionMeta[] {
  return VISIBLE_APP_PERMISSION_CATALOG.filter((item) => item.group === group);
}

export function can(permission: Permission, role?: UserRole): boolean {
  const r = role ?? "guest";
  if (isAppPermission(permission)) return ROLE_APP_PERMISSIONS[r]?.includes(permission) ?? false;
  return ROLE_PERMISSIONS[r]?.includes(permission as LegacyPermission) ?? false;
}

export const ALL_VISIBLE_APP_PERMISSIONS = [...ALL_VISIBLE_PERMISSIONS];
