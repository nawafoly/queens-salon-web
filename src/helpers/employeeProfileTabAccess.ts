import type { AppPermission } from "./permissions";

export type EmployeeProfileTabAccessKey =
  | "basic"
  | "profile"
  | "services"
  | "booking"
  | "attendance"
  | "payroll"
  | "requests"
  | "leave"
  | "messages";

export type EmployeeProfileTabAccessItem = {
  key: EmployeeProfileTabAccessKey;
  permission: AppPermission;
  labelAr: string;
  labelEn: string;
  hintAr: string;
  hintEn: string;
};

export const EMPLOYEE_PROFILE_TAB_ACCESS: EmployeeProfileTabAccessItem[] = [
  {
    key: "basic",
    permission: "employees.tabs.basic.view",
    labelAr: "البيانات الأساسية",
    labelEn: "Basic information",
    hintAr: "الاسم والحالة والظهور والبيانات الأساسية للموظفة.",
    hintEn: "Name, status, visibility, and basic staff information.",
  },
  {
    key: "profile",
    permission: "employees.tabs.profile.view",
    labelAr: "الملفات والصور",
    labelEn: "Files & photos",
    hintAr: "الصورة والملف العام والمستندات الوظيفية.",
    hintEn: "Profile photo, public profile, and staff documents.",
  },
  {
    key: "services",
    permission: "employees.tabs.services.view",
    labelAr: "الخدمات",
    labelEn: "Services",
    hintAr: "الخدمات المسندة للموظفة وإدارتها.",
    hintEn: "Assigned staff services and service management.",
  },
  {
    key: "booking",
    permission: "employees.tabs.schedule.view",
    labelAr: "الدوام والشفتات",
    labelEn: "Schedule & shifts",
    hintAr: "الجدول الأسبوعي والشفتات والاستثناءات.",
    hintEn: "Weekly schedule, shifts, and exceptions.",
  },
  {
    key: "attendance",
    permission: "employees.tabs.attendance.view",
    labelAr: "الحضور",
    labelEn: "Attendance",
    hintAr: "سجل الحضور والانصراف اليومي.",
    hintEn: "Daily check-in and check-out records.",
  },
  {
    key: "payroll",
    permission: "employees.tabs.payroll.view",
    labelAr: "سجل الرواتب",
    labelEn: "Payroll record",
    hintAr: "الراتب والخصومات والالتزامات المالية.",
    hintEn: "Payroll, deductions, and financial obligations.",
  },
  {
    key: "requests",
    permission: "employees.tabs.requests.view",
    labelAr: "الطلبات",
    labelEn: "Requests",
    hintAr: "طلبات الموظفة وإجراءاتها.",
    hintEn: "Staff requests and their workflow.",
  },
  {
    key: "leave",
    permission: "employees.tabs.leave.view",
    labelAr: "رصيد الإجازات",
    labelEn: "Leave balance",
    hintAr: "الإجازات والراحة والرصيد والسجل.",
    hintEn: "Leave, rest, balance, and leave history.",
  },
  {
    key: "messages",
    permission: "employees.tabs.messages.view",
    labelAr: "الرسائل",
    labelEn: "Messages",
    hintAr: "المحادثة الداخلية مع الموظفة.",
    hintEn: "Internal conversation with the staff member.",
  },
];

export const EMPLOYEE_PROFILE_TAB_PERMISSION_KEYS: AppPermission[] =
  EMPLOYEE_PROFILE_TAB_ACCESS.map((item) => item.permission);

const EMPLOYEE_PROFILE_TAB_PERMISSION_BY_KEY = new Map(
  EMPLOYEE_PROFILE_TAB_ACCESS.map((item) => [item.key, item.permission] as const)
);

export function hasEmployeeProfileTabPolicy(
  permissions: readonly AppPermission[]
): boolean {
  const permissionSet = new Set(permissions);
  return EMPLOYEE_PROFILE_TAB_PERMISSION_KEYS.some((permission) =>
    permissionSet.has(permission)
  );
}

export function isEmployeeProfileTabAllowed(
  permissions: readonly AppPermission[],
  tab: string
): boolean {
  const normalized =
    tab === "shifts" ? "booking" : tab === "files" ? "profile" : tab;
  const permission = EMPLOYEE_PROFILE_TAB_PERMISSION_BY_KEY.get(
    normalized as EmployeeProfileTabAccessKey
  );

  if (!permission) return false;

  // Compatibility before the Core permission migration is applied:
  // existing accounts keep their current tab behavior until at least one
  // employee-tab permission is present in the effective permission set.
  if (!hasEmployeeProfileTabPolicy(permissions)) return true;

  return permissions.includes(permission);
}
