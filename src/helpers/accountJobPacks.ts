import type { AppPermission } from "./permissions";
import { VISIBLE_APP_PERMISSION_CATALOG } from "./permissions";

export type AccountJobPack = {
  id: string;
  titleAr: string;
  titleEn: string;
  hintAr: string;
  hintEn: string;
  permissions: AppPermission[];
};

export const ACCOUNT_JOB_PACKS: AccountJobPack[] = [
  {
    id: "dashboard",
    titleAr: "تدخل لوحة التحكم",
    titleEn: "Open dashboard",
    hintAr: "الدخول إلى لوحة التحكم الرئيسية.",
    hintEn: "Open the main dashboard.",
    permissions: ["workspace.dashboard.view"],
  },
  {
    id: "employee-portal",
    titleAr: "تستخدم بوابة الموظفة",
    titleEn: "Use employee portal",
    hintAr: "الدخول إلى بوابة الموظفة والملف الشخصي.",
    hintEn: "Open the employee portal and profile.",
    permissions: ["workspace.employee_portal.view"],
  },
  {
    id: "catalog",
    titleAr: "تعدّل الكتالوج",
    titleEn: "Edit catalog",
    hintAr: "تعديل الخدمات والأقسام والأسعار والباقات.",
    hintEn: "Edit services, categories, prices and packages.",
    permissions: ["workspace.dashboard.view", "catalog.manage"],
  },
  {
    id: "bookings",
    titleAr: "تشغّل الحجوزات",
    titleEn: "Run bookings",
    hintAr: "عرض وإنشاء وتعديل وإلغاء الحجوزات.",
    hintEn: "View, create, update and cancel bookings.",
    permissions: ["workspace.dashboard.view", "bookings.view", "bookings.create", "bookings.update", "bookings.cancel", "bookings.print"],
  },
  {
    id: "clients",
    titleAr: "تدير العملاء",
    titleEn: "Manage clients",
    hintAr: "عرض وتعديل ملفات العميلات.",
    hintEn: "View and edit client profiles.",
    permissions: ["workspace.dashboard.view", "clients.view", "clients.manage"],
  },
  {
    id: "inventory",
    titleAr: "تشغّل المخزون",
    titleEn: "Run inventory",
    hintAr: "عرض الأرصدة وتأكيد استهلاك الخدمة.",
    hintEn: "View stock and confirm service consumption.",
    permissions: ["inventory.view", "inventory.consume.confirm"],
  },
];

export function isJobPackEnabled(current: AppPermission[], pack: AccountJobPack) {
  return pack.permissions.every((permission) => current.includes(permission));
}

export function toggleJobPackPermissions(current: AppPermission[], pack: AccountJobPack) {
  const enabled = isJobPackEnabled(current, pack);
  const next = new Set(current);
  for (const permission of pack.permissions) {
    if (enabled) next.delete(permission);
    else next.add(permission);
  }
  return VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key).filter((key) => next.has(key));
}
