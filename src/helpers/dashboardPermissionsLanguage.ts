import type { AppPermission, PermissionMeta } from "./permissions";

const LABELS: Partial<Record<AppPermission, string>> = {
  "workspace.dashboard.view": "Dashboard access",
  "workspace.employee_portal.view": "Employee portal access",
  "bookings.view": "View bookings",
  "bookings.create": "Create bookings",
  "bookings.update": "Edit bookings",
  "bookings.cancel": "Cancel bookings",
  "bookings.delete": "Permanently delete bookings",
  "bookings.payment.manage": "Manage booking payments",
  "bookings.print": "Print booking invoices",
  "bookings.bulk.manage": "Bulk booking actions",
  "bookings.day_audit.manage": "Day and shift close",
  "bookings.queue_tv.view": "View booking queue screen",
  "clients.view": "View clients",
  "clients.manage": "Manage clients",
  "clients.packages.manage": "Manage client packages",
  "clients.loyalty.manage": "Manage loyalty",
  "income.view": "View income",
  "income.manage": "Manage income",
  "expenses.view": "View expenses",
  "expenses.manage": "Manage expenses",
  "inventory.view": "View inventory",
  "inventory.items.manage": "Manage inventory items",
  "inventory.recipes.manage": "Manage consumption recipes",
  "inventory.consume.confirm": "Confirm service consumption",
  "inventory.movements.view": "View stock movements",
  "inventory.adjust": "Adjust inventory",
  "inventory.waste.record": "Record waste",
  "employees.view": "View staff",
  "employees.create": "Create staff profiles",
  "employees.update": "Edit staff profiles",
  "employees.delete": "Delete or disable staff",
  "employees.manage": "Manage staff",
  "employees.files.view": "View staff files",
  "employees.files.manage": "Manage staff files",
  "employees.schedule.manage": "Manage staff schedules",
  "attendance.own.view": "View own attendance",
  "attendance.view": "View team attendance",
  "attendance.records.create": "Create attendance record",
  "attendance.records.update": "Edit attendance record",
  "attendance.records.delete": "Delete attendance record",
  "attendance.absences.manage": "Manage absences",
  "attendance.leaves.manage": "Manage leave",
  "attendance.export": "Export attendance",
  "attendance.settings.manage": "Manage attendance settings",
  "payroll.view": "View payroll",
  "payroll.manage": "Manage payroll",
  "targets.view": "View staff targets",
  "targets.manage": "Manage staff targets",
  "targets.approve": "Approve target bonus",
  "targets.adjust": "Adjust target records",
  "targets.view_all": "View all targets",
  "targets.view_own": "View own target",
  "staffPerformance.view": "View staff performance",
  "staffPerformance.manage": "Manage staff performance",
  "recruitment.view": "View recruitment applications",
  "recruitment.manage": "Manage recruitment applications",
  "employee_requests.own.view": "View own requests",
  "employee_requests.own.create": "Create own request",
  "employee_requests.own.comment": "Comment on own requests",
  "employee_requests.own.cancel": "Cancel own requests",
  "employee_requests.view": "View request center",
  "employee_requests.manage": "Manage employee requests",
  "employee_requests.receive": "Receive employee requests",
  "employee_requests.assign": "Assign request owner",
  "employee_requests.request_info": "Request additional information",
  "employee_requests.approve": "Approve requests",
  "employee_requests.reject": "Reject requests",
  "employee_requests.execute": "Execute requests",
  "employee_requests.complete": "Complete requests",
  "employee_requests.internal_notes": "Internal request notes",
  "employee_requests.resignation.execute": "Execute resignation completion",
  "employee_requests.salary_advance.approve": "Approve salary advance",
  "employee_requests.attendance_correction.execute": "Execute attendance correction",
  "employee_requests.reopen": "Reopen requests",
  "reports.view": "View reports",
  "reports.export": "Export reports",
  "weekly_reports.manager_notes": "Weekly manager notes",
  "messages.view": "View messages",
  "messages.manage": "Manage messages",
  "logs.view": "View activity log",
  "audit.read": "Read audit log",
  "catalog.manage": "Manage catalog",
  "offers.manage": "Manage offers and coupons",
  "content.manage": "Manage website content",
  "partners.manage": "Manage partners and spaces",
  "settings.general.manage": "Manage general settings",
  "settings.booking.manage": "Manage booking settings",
  "settings.content.manage": "Manage content settings",
  "admin_accounts.view": "View administrative accounts",
  "admin_accounts.manage": "Manage administrative accounts",
  "accounts.read": "Read accounts",
  "accounts.create": "Create account",
  "accounts.update": "Edit account",
  "accounts.disable": "Disable account",
  "accounts.restore": "Restore account",
  "accounts.delete": "Delete account",
  "accounts.reset_password": "Send password reset link",
  "roles.read": "Read roles",
  "roles.assign": "Assign roles",
  "roles.manage": "Manage roles",
  "permissions.read": "Read permissions",
  "permissions.manage": "Manage permissions",
  "employee_links.read": "Read staff links",
  "employee_links.manage": "Manage staff links"
};

function humanize(key: string) {
  return key
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function permissionEnglishLabel(permission: string): string {
  return LABELS[permission as AppPermission] || humanize(permission);
}

export function permissionEnglishHint(permission: string, meta?: Pick<PermissionMeta, "action">): string {
  const label = permissionEnglishLabel(permission);
  const action = meta?.action;
  if (action === "view") return `Allows viewing: ${label}.`;
  if (action === "create") return `Allows creating records for: ${label}.`;
  if (action === "update") return `Allows updating records for: ${label}.`;
  if (action === "delete") return `Allows deletion actions for: ${label}.`;
  if (action === "manage") return `Allows management actions for: ${label}.`;
  if (action === "export") return `Allows exporting data for: ${label}.`;
  if (action === "use") return `Allows using: ${label}.`;
  return `Controls access to: ${label}.`;
}
