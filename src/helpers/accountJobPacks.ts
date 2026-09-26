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

function keysMatching(matchers: string[], except: string[] = []): AppPermission[] {
  return VISIBLE_APP_PERMISSION_CATALOG
    .filter((item) => {
      if (except.some((rule) => item.key === rule || item.key.startsWith(`${rule}.`))) return false;
      return matchers.some((matcher) => item.key === matcher || item.key.startsWith(`${matcher}.`));
    })
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
  {
    id: "finance",
    titleAr: "المالية",
    titleEn: "Finance",
    hintAr: "الإيرادات والمصروفات.",
    hintEn: "Income and expenses.",
    permissions: keysMatching(["income", "expenses"]),
  },
  {
    id: "team",
    titleAr: "ملفات الموظفات",
    titleEn: "Staff files",
    hintAr: "دليل الموظفات والملفات والجداول.",
    hintEn: "Staff directory, files and schedules.",
    permissions: keysMatching(["employees"]),
  },
  {
    id: "attendance-admin",
    titleAr: "حضور الفريق",
    titleEn: "Team attendance",
    hintAr: "حضور الفريق والإجازات وإعدادات البصمة.",
    hintEn: "Team attendance, leaves and fingerprint settings.",
    permissions: keysMatching(["attendance"], ["attendance.own"]),
  },
  {
    id: "requests-admin",
    titleAr: "مركز الطلبات",
    titleEn: "Request center",
    hintAr: "طلبات الموظفات من جهة الإدارة.",
    hintEn: "Admin handling of staff requests.",
    permissions: keysMatching(["employee_requests"], ["employee_requests.own"]),
  },
  {
    id: "payroll-targets",
    titleAr: "الرواتب والتارقت",
    titleEn: "Payroll and targets",
    hintAr: "الرواتب والتارقت والبونص.",
    hintEn: "Payroll, targets and bonus.",
    permissions: keysMatching(["payroll", "targets"], ["targets.view_own"]),
  },
  {
    id: "performance",
    titleAr: "الأداء والتوظيف",
    titleEn: "Performance and hiring",
    hintAr: "أداء الموظفات وطلبات التوظيف.",
    hintEn: "Staff performance and recruitment.",
    permissions: keysMatching(["staffPerformance", "recruitment"]),
  },
  {
    id: "messages",
    titleAr: "الرسائل",
    titleEn: "Messages",
    hintAr: "الرسائل الداخلية.",
    hintEn: "Internal messages.",
    permissions: keysMatching(["messages"]),
  },
  {
    id: "reports",
    titleAr: "التقارير والسجلات",
    titleEn: "Reports and logs",
    hintAr: "التقارير والتدقيق وسجل الحركات.",
    hintEn: "Reports, audit and activity logs.",
    permissions: keysMatching(["reports", "weekly_reports", "logs", "audit"]),
  },
  {
    id: "partners",
    titleAr: "الشريكات",
    titleEn: "Partners",
    hintAr: "الشريكات والمساحات.",
    hintEn: "Partners and rented spaces.",
    permissions: keysMatching(["partners"]),
  },
  {
    id: "settings",
    titleAr: "إعدادات الصالون",
    titleEn: "Salon settings",
    hintAr: "الإعدادات العامة وإعدادات الحجز.",
    hintEn: "General and booking settings.",
    permissions: keysMatching(["settings"], ["settings.content"]),
  },
  {
    id: "system",
    titleAr: "الحسابات والصلاحيات",
    titleEn: "Accounts and access",
    hintAr: "الحسابات والأدوار وربط الموظفات.",
    hintEn: "Accounts, roles and employee links.",
    permissions: keysMatching(["admin_accounts", "accounts", "roles", "permissions", "employee_links"]),
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
