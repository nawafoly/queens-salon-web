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

function keysMatching(matchers: string[]): AppPermission[] {
  return VISIBLE_APP_PERMISSION_CATALOG
    .filter((item) => matchers.some((matcher) => item.key === matcher || item.key.startsWith(`${matcher}.`)))
    .map((item) => item.key);
}

export const ACCOUNT_JOB_PACKS: AccountJobPack[] = [
  {
    id: "dashboard",
    titleAr: "تدخل لوحة التحكم",
    titleEn: "Open dashboard",
    hintAr: "الدخول إلى لوحة التحكم الرئيسية.",
    hintEn: "Open the main dashboard.",
    permissions: keysMatching(["workspace.dashboard.view"]),
  },
  {
    id: "employee-portal",
    titleAr: "تستخدم بوابة الموظفة",
    titleEn: "Use employee portal",
    hintAr: "بوابة الموظفة وطلباتها وحضورها الشخصي.",
    hintEn: "Employee portal, own requests and own attendance.",
    permissions: keysMatching([
      "workspace.employee_portal.view",
      "attendance.own",
      "employee_requests.own",
      "targets.view_own",
    ]),
  },
  {
    id: "catalog",
    titleAr: "تعدّل الكتالوج",
    titleEn: "Edit catalog",
    hintAr: "الخدمات والأقسام والأسعار والعروض.",
    hintEn: "Services, categories, prices and offers.",
    permissions: keysMatching(["catalog", "offers", "content", "settings.content"]),
  },
  {
    id: "bookings",
    titleAr: "تشغّل الحجوزات",
    titleEn: "Run bookings",
    hintAr: "الحجوزات والطابور واليوم التشغيلي.",
    hintEn: "Bookings, queue and day operations.",
    permissions: keysMatching(["bookings"]),
  },
  {
    id: "clients",
    titleAr: "تدير العملاء",
    titleEn: "Manage clients",
    hintAr: "ملفات العميلات والباقات والولاء.",
    hintEn: "Client files, packages and loyalty.",
    permissions: keysMatching(["clients"]),
  },
  {
    id: "inventory",
    titleAr: "تشغّل المخزون",
    titleEn: "Run inventory",
    hintAr: "المواد والاستهلاك والحركات.",
    hintEn: "Items, consumption and movements.",
    permissions: keysMatching(["inventory"]),
  },
];

export function isJobPackEnabled(current: AppPermission[], pack: AccountJobPack) {
  return pack.permissions.length > 0 && pack.permissions.every((permission) => current.includes(permission));
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

export function toggleSinglePermission(current: AppPermission[], permission: AppPermission) {
  const next = new Set(current);
  if (next.has(permission)) next.delete(permission);
  else next.add(permission);
  return VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key).filter((key) => next.has(key));
}

export function leftoverPermissions(currentPacks = ACCOUNT_JOB_PACKS) {
  const used = new Set(currentPacks.flatMap((pack) => pack.permissions));
  return VISIBLE_APP_PERMISSION_CATALOG.filter((item) => !used.has(item.key));
}
