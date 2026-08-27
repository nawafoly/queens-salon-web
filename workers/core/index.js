// CORE D1 ONLY â€” do not add Firestore fallback.

import { handleRequest as handleUnifiedPackagesRequest } from '../packages/routes.js';
import { expireClientPackagesD1 } from '../packages/d1.js';
import {
  ADMIN_ROLES,
  OPERATIONS_ROLES,
  cleanText,
  requireDb,
  requireRole,
  requiredId,
} from './d1.js';
import { AppError, normalizeError } from './errors.js';
import { getAuthContext } from './auth-context.js';
import {
  createClient,
  getClient,
  listClients,
  patchClient,
} from './repositories/clients.js';
import {
  createService,
  listServices,
  patchService,
} from './repositories/services.js';
import {
  getStaff,
  listStaff,
  patchStaff,
  staffIsPubliclyBookable,
} from './repositories/staff.js';
import {
  cancelBooking,
  completeBooking,
  createBooking,
  deleteBooking,
  getBooking,
  getPublicBookingTrack,
  listBookings,
  patchBooking,
  rescheduleBooking,
} from './repositories/bookings.js';
import {
  createInvoice,
  getInvoiceByBookingId,
  getInvoice,
  listInvoices,
} from './repositories/invoices.js';
import {
  createPayment,
  listPayments,
} from './repositories/payments.js';
import {
  createExpense,
  createIncome,
  deleteExpense,
  deleteIncome,
  listExpenses,
  listIncome,
  patchExpense,
  patchIncome,
} from './repositories/finance.js';
import { getStaffAvailability } from './repositories/availability.js';
import {
  createDiscount,
  deleteDiscount,
  incrementDiscountUsage,
  listDiscounts,
  patchDiscount,
} from './repositories/discounts.js';
import {
  createCatalogRow,
  deleteCatalogRow,
  listCatalogRows,
  patchCatalogRow,
} from './repositories/catalog-admin.js';
import { createRefund, listRefunds, patchRefund, voidRefund } from './repositories/refunds.js';
import { listAudit, recordAudit } from './repositories/audit.js';
import {
  adjustClientLoyalty,
  getAdminClientOverview,
  getClientPortalSnapshot,
  getSelfLoyalty,
  getSelfProfile,
  listSelfBookings,
  listSelfOffers,
  patchSelfProfile,
  resolveSelfClient,
} from './repositories/client-portal.js';

import {
  getHrEmployee,
  listHrEmployees,
  replaceHrSchedules,
  upsertHrEmployee,
} from './repositories/hr-employees.js';
import { offboardHrEmployee } from './repositories/employee-offboarding.js';
import {
  getAttendanceState,
  listAttendance,
  recordAttendance,
} from './repositories/attendance.js';
import { createLeave, decideLeave, listLeaves } from './repositories/leaves.js';
import {
  adjustLeaveBalance,
  getLeaveBalanceState,
  reverseLeaveBalanceAdjustment,
  setLeaveEntitlementDate,
} from './repositories/leave-balance.js';
import {
  createPermissionRequest,
  decidePermissionRequest,
  listPermissionRequests,
  markPermissionOut,
  markPermissionReturned,
  permissionPayrollSummary,
} from './repositories/permissions.js';
import { createAbsence, deleteAbsence, listAbsences } from './repositories/absences.js';
import {
  approvePayrollEntry,
  deferAttendanceDeduction,
  getPayrollEntry,
  listPayrollEntries,
  listPayrollAdvanceDeductions,
  listPayrollPeriods,
  listPayrollCarryoverAdjustments,
  reconcilePayrollCarryoversBatch,
  markPayrollEntryPaid,
  previewPayrollEntry,
  reopenPayrollEntry,
  togglePayrollOvertime,
  updatePayrollEntryAdjustments,
  upsertPayrollEntry,
  upsertPayrollPeriod,
} from './repositories/payroll.js';
import {
  cancelPayrollObligation,
  createPayrollObligation,
  deferPayrollObligationInstallment,
  listPayrollObligationDeductions,
  listPayrollObligations,
  listPayrollRecurringDeductions,
  savePayrollRecurringDeduction,
} from './repositories/payroll-obligations.js';
import {
  deferSalaryAdvanceInstallment,
} from './repositories/salary-advance-deferrals.js';
import {
  createTargetAdjustment,
  getEmployeeTargetDetails,
  listEmployeeTargetDashboard,
  listTargetPlans,
  rebuildEmployeeTargetLedgerForPeriod,
  saveTargetPlan,
} from './repositories/employee-targets.js';
import { getSetting, listSettings, upsertSetting } from './repositories/settings.js';
import {
  cancelShiftAssignment,
  createScheduleException,
  createShiftAssignment,
  listScheduleExceptions,
  listShiftAssignments,
  listShiftPayrollAdjustments,
  listShiftPayrollPeriodLocks,
  listShiftTemplates,
  markClosedCheckInWindowsAbsent,
  previewShiftChange,
  resolveEmployeeShift,
  resolveEmployeeShiftsBatch,
  saveShiftPayrollPeriodLock,
  saveShiftTemplate,
  syncWorkingHourScheduleExceptions,
  updateScheduleException,
  updateShiftAssignment,
} from './repositories/shift-control.js';
import {
  deleteAdminProfile,
  listAdminProfiles,
  upsertAdminProfile,
} from './repositories/admin-profiles.js';
import {
  createAccount,
  deleteAccount,
  deleteEmployeeLink,
  getAccountDetail,
  getPermissionCatalog,
  getRoleCatalog,
  listAccounts,
  replaceAccountPermissions,
  replaceEmployeeLink,
  requireAnyPermission,
  requirePermission,
  restoreAccount,
  sendPasswordReset,
  serializeAuthMe,
  touchAccountLogin,
  updateAccount,
  disableAccount,
} from './repositories/accounts.js';
import {
  createFileMetadata,
  getFileContent,
  getFileMetadata,
  listFileMetadata,
  patchFileMetadata,
  putFileContent,
} from './repositories/files.js';
import {
  createEmployeeNotification,
  createEmployeeMessage,
  createRecruitmentApplication,
  listEmployeeMessages,
  listEmployeeNotifications,
  listRecruitmentApplications,
  markAllEmployeeNotificationsRead,
  markEmployeeNotificationRead,
  markEmployeeThreadRead,
  patchRecruitmentApplication,
} from './repositories/workforce-communications.js';
import {
  addEmployeeRequestAttachment,
  addEmployeeRequestComment,
  createEmployeeRequest,
  employeeRequestStats,
  getEmployeeRequest,
  getEmployeeRequestPayrollImpact,
  getExceptionalFinancialPaymentPreview,
  listEmployeeRequests,
  listEmployeeRequestNotifications,
  listEmployeeRequestAssignees,
  markAllEmployeeRequestNotificationsRead,
  markEmployeeRequestNotificationRead,
  notifyOverdueEmployeeRequests,
  transitionEmployeeRequest,
} from './repositories/employee-requests.js';

const HR_MANAGEMENT_ROLES = new Set(["owner", "admin", "hr"]);
const PAYROLL_MANAGEMENT_ROLES = new Set(["owner", "admin", "hr", "accountant"]);

function hasAnyPermissionKey(ctx, keys) {
  return keys.some((key) => Array.isArray(ctx.permissions) && ctx.permissions.includes(key));
}

async function assertFileAccess(ctx, fileId, write = false) {
  const metadata = await getFileMetadata(ctx.coreDb, ctx.salonId, fileId);
  const ownFile = cleanText(ctx.employeeId) && cleanText(metadata.employee_id) === cleanText(ctx.employeeId);
  const ownRequestFile = ownFile && cleanText(metadata.category) === "employee_request";
  if (ownFile && (!write || ownRequestFile)) return metadata;
  const required = write
    ? ["employees.files.manage", "employee_requests.manage"]
    : ["employees.files.view", "employees.files.manage", "employee_requests.view"];
  requireAnyPermission(ctx, required);
  return metadata;
}

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "https://queens-salon-web.vercel.app",
  "https://queens-salon-web-gnxk.vercel.app",
]);

function allowedOrigins(env) {
  const configured = cleanText(env.ALLOWED_ORIGINS);
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return new Set(
    configured
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins(env).has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(request, env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "core_api:invalid_json");
  }
}

function salonId(data, env) {
  return requiredId(
    data?.salonId || env.SALON_ID || "main",
    "salonId"
  );
}

function isPublicRoute(route, method) {
  return (
    (method === "GET" &&
      ["services", "staff", "availability", "discounts", "sections", "categories", "settings", "health", "booking:public-track"].includes(route.name)) ||
    (method === "POST" &&
      ["clients", "bookings", "discount:use"].includes(route.name))
  );
}

async function actor(request, env, data, allowGuest, options = {}) {
  const sid = salonId(data || {}, env);
  const authorization =
    request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    if (allowGuest) {
      return {
        identity: { uid: "", claims: {} },
        role: "guest",
        salonId: sid,
        coreDb: requireDb(env),
        guestAccess: true,
        permissions: [],
        employeeLink: null,
        employeeId: "",
      };
    }
    throw new AppError(401, "core_auth:login_required");
  }

  return getAuthContext(request, env, {
    salonId: sid,
    allowPublicFallback: Boolean(allowGuest),
    touchLogin: options.touchLogin === true,
  });
}

function match(url, method) {
  const path = url.pathname;
  const one = (prefix) => {
    if (!path.startsWith(`${prefix}/`)) return "";
    const rest = path.slice(prefix.length + 1);
    return rest && !rest.includes("/") ? rest : "";
  };

  if ((path === "/api/auth/me" || path === "/api/core/auth/me") && method === "GET") {
    return { name: "auth:me" };
  }

  const accountAction = /^\/api\/(?:core\/)?admin\/accounts\/([^/]+)\/(disable|restore|permissions|employee-link|reset-password)$/.exec(path);
  if (accountAction) {
    return { name: `admin:account:${accountAction[2]}`, id: accountAction[1] };
  }
  const accountDetail = /^\/api\/(?:core\/)?admin\/accounts\/([^/]+)$/.exec(path);
  if (accountDetail) {
    return { name: "admin:account", id: accountDetail[1] };
  }
  if (path === "/api/admin/accounts" || path === "/api/core/admin/accounts") {
    return { name: "admin:accounts" };
  }
  if (path === "/api/admin/roles" || path === "/api/core/admin/roles") {
    return { name: "admin:roles" };
  }
  if (path === "/api/admin/permissions" || path === "/api/core/admin/permissions") {
    return { name: "admin:permissions" };
  }

  const clientPortalRoutes = new Map([
    ["/api/core/client/portal", "client:portal"],
    ["/api/core/client/me", "client:me"],
    ["/api/core/client/bookings", "client:bookings"],
    ["/api/core/client/loyalty", "client:loyalty"],
    ["/api/core/client/offers", "client:offers"],
  ]);
  if (clientPortalRoutes.has(path)) {
    return { name: clientPortalRoutes.get(path) };
  }

  const clientOverview = /^\/api\/core\/clients\/([^/]+)\/overview$/.exec(path);
  if (clientOverview && method === "GET") {
    return { name: "client:admin-overview", id: clientOverview[1] };
  }
  const loyaltyAdjustment = /^\/api\/core\/clients\/([^/]+)\/loyalty-adjustments$/.exec(path);
  if (loyaltyAdjustment && method === "POST") {
    return { name: "client:loyalty-adjustment", id: loyaltyAdjustment[1] };
  }

  if (path === "/api/core/public/booking-track" && method === "GET") {
    return { name: "booking:public-track" };
  }

  if (path === "/api/core/internal/bookings" && method === "POST") {
    return { name: "bookings:internal" };
  }

  const bookingAction =
    /^\/api\/core\/bookings\/([^/]+)\/(complete|cancel|reschedule)$/.exec(
      path
    );
  if (bookingAction && method === "POST") {
    return {
      name: `booking:${bookingAction[2]}`,
      id: bookingAction[1],
    };
  }


  if (path === "/api/core/hr/messages" && ["GET", "POST"].includes(method)) return { name: "employee-messages" };
  const employeeMessageThreadRead = /^\/api\/core\/hr\/messages\/thread\/([^/]+)\/read$/.exec(path);
  if (employeeMessageThreadRead && method === "POST") return { name: "employee-message-thread:read", id: employeeMessageThreadRead[1] };
  if (path === "/api/core/hr/notifications/read-all" && method === "POST") return { name: "employee-notifications:read-all" };
  const employeeNotificationRead = /^\/api\/core\/hr\/notifications\/([^/]+)\/read$/.exec(path);
  if (employeeNotificationRead && method === "POST") return { name: "employee-notification:read", id: employeeNotificationRead[1] };
  if (path === "/api/core/hr/notifications" && ["GET", "POST"].includes(method)) return { name: "employee-notifications" };
  const recruitmentDetail = /^\/api\/core\/hr\/recruitment\/([^/]+)$/.exec(path);
  if (recruitmentDetail && method === "PATCH") return { name: "recruitment:detail", id: recruitmentDetail[1] };
  if (path === "/api/core/hr/recruitment" && ["GET", "POST"].includes(method)) return { name: "recruitment" };

  if (path === "/api/core/hr/employee-profile/mine" && ["GET", "PATCH"].includes(method)) {
    return { name: "employee-profile:mine" };
  }
  const employeeOffboard = /^\/api\/core\/hr\/employees\/([^/]+)\/offboard$/.exec(path);
  if (employeeOffboard && method === "POST") {
    return { name: "hr-employee:offboard", id: employeeOffboard[1] };
  }

  if (path === "/api/core/hr/employee-request-payroll-impact/mine" && method === "GET") return { name: "employee-request:payroll-impact-mine" };
  if (path === "/api/core/hr/employee-request-notifications/read-all" && method === "POST") return { name: "employee-request-notification:read-all" };
  const employeeRequestNotificationRead = /^\/api\/core\/hr\/employee-request-notifications\/([^/]+)\/read$/.exec(path);
  if (employeeRequestNotificationRead && method === "POST") return { name: "employee-request-notification:read", id: employeeRequestNotificationRead[1] };
  if (path === "/api/core/hr/employee-request-notifications" && method === "GET") return { name: "employee-request-notifications" };
  if (path === "/api/core/hr/employee-request-assignees" && method === "GET") return { name: "employee-request-assignees" };
  if (path === "/api/core/hr/employee-requests/mine") return { name: "employee-request:mine" };
  if (path === "/api/core/hr/employee-requests/stats") return { name: "employee-request:stats" };

  if (
    path === "/api/core/hr/employee-requests/exceptional-financial-payment-preview" &&
    method === "GET"
  ) {
    return {
      name: "employee-request:exceptional-financial-payment-preview",
    };
  }
  const employeeRequestSubresource = /^\/api\/core\/hr\/employee-requests\/([^/]+)\/(comments|attachments)$/.exec(path);
  if (employeeRequestSubresource) {
    return { name: `employee-request:${employeeRequestSubresource[2]}`, id: employeeRequestSubresource[1] };
  }
  const employeeRequestAction = /^\/api\/core\/hr\/employee-requests\/([^/]+)\/(receive|assign|start-review|request-info|answer-info|approve|reject|execute|complete|cancel|record-exit|record-return|reopen)$/.exec(path);
  if (employeeRequestAction && method === "POST") {
    return { name: "employee-request:action", id: employeeRequestAction[1], action: employeeRequestAction[2] };
  }
  const employeeRequestDetail = /^\/api\/core\/hr\/employee-requests\/([^/]+)$/.exec(path);
  if (employeeRequestDetail) return { name: "employee-request:detail", id: employeeRequestDetail[1] };
  if (path === "/api/core/hr/employee-requests") return { name: "employee-requests" };

  const attendanceState = /^\/api\/core\/hr\/attendance\/state\/([^/]+)$/.exec(path);
  if (attendanceState && method === "GET") return { name: "attendance:state", id: attendanceState[1] };
  if (path === "/api/core/hr/attendance/check-in" && method === "POST") return { name: "attendance:check-in" };
  if (path === "/api/core/hr/attendance/check-out" && method === "POST") return { name: "attendance:check-out" };
  if (path === "/api/core/hr/permissions/payroll-summary" && method === "GET") {
    return { name: "permission:payroll-summary" };
  }
  const permissionAction = /^\/api\/core\/hr\/permissions\/([^/]+)\/(approve|reject|cancel|out|return)$/.exec(path);
  if (permissionAction && method === "POST") {
    return { name: `permission:${permissionAction[2]}`, id: permissionAction[1] };
  }
  const leaveDecision = /^\/api\/core\/hr\/leaves\/([^/]+)\/(approve|reject)$/.exec(path);
  if (leaveDecision && method === "POST") return { name: `leave:${leaveDecision[2]}`, id: leaveDecision[1] };
  const leaveBalanceEntry = /^\/api\/core\/hr\/employees\/([^/]+)\/leave-balance\/entries\/([^/]+)$/.exec(path);
  if (leaveBalanceEntry && method === "DELETE") {
    return {
      name: "hr-employee:leave-balance-entry",
      id: leaveBalanceEntry[1],
      entryId: leaveBalanceEntry[2],
    };
  }

  const leaveBalanceAdjustment = /^\/api\/core\/hr\/employees\/([^/]+)\/leave-balance\/adjustments$/.exec(path);
  if (leaveBalanceAdjustment && method === "POST") {
    return {
      name: "hr-employee:leave-balance-adjustment",
      id: leaveBalanceAdjustment[1],
    };
  }

  const leaveEntitlementDate = /^\/api\/core\/hr\/employees\/([^/]+)\/leave-balance\/entitlement-date$/.exec(path);
  if (leaveEntitlementDate && method === "PATCH") {
    return {
      name: "hr-employee:leave-entitlement-date",
      id: leaveEntitlementDate[1],
    };
  }

  if (
    path === "/api/core/hr/employee-portal/leave-balance" &&
    method === "GET"
  ) {
    return {
      name: "employee-portal:leave-balance",
    };
  }
  if (
    path === "/api/core/hr/employee-portal/leaves" &&
    method === "GET"
  ) {
    return {
      name: "employee-portal:leaves",
    };
  }
  if (
    path === "/api/core/hr/employee-portal/absences" &&
    method === "GET"
  ) {
    return {
      name: "employee-portal:absences",
    };
  }
  if (
    path === "/api/core/hr/employee-portal/resolved-shifts" &&
    method === "GET"
  ) {
    return {
      name: "employee-portal:resolved-shifts",
    };
  }
  const leaveBalanceState = /^\/api\/core\/hr\/employees\/([^/]+)\/leave-balance$/.exec(path);
  if (leaveBalanceState && method === "GET") {
    return {
      name: "hr-employee:leave-balance",
      id: leaveBalanceState[1],
    };
  }

  const employeeSchedules = /^\/api\/core\/hr\/employees\/([^/]+)\/schedules$/.exec(path);
  if (employeeSchedules && method === "PUT") return { name: "hr-employee:schedules", id: employeeSchedules[1] };
  if (
    path === "/api/core/hr/resolved-shifts/batch" &&
    method === "POST"
  ) {
    return { name: "hr-shift:resolve-batch" };
  }

  const resolveShift = /^\/api\/core\/hr\/employees\/([^/]+)\/resolved-shift$/.exec(path);
  if (resolveShift && method === "GET") return { name: "hr-shift:resolve", id: resolveShift[1] };
  if (path === "/api/core/hr/shift-change-preview" && method === "POST") return { name: "shift-change-preview" };
  if (path === "/api/core/hr/payroll-entries/mine" && method === "GET") return { name: "payroll-entries:mine" };
  if (path === "/api/core/hr/payroll-preview" && method === "POST") return { name: "payroll-preview" };
  if (
    path === "/api/core/hr/payroll-attendance-deductions/defer" &&
    method === "POST"
  ) {
    return { name: "payroll-attendance-deduction:defer" };
  }
  if (
    path === "/api/core/hr/payroll-advance-deductions" &&
    method === "GET"
  ) {
    return { name: "payroll-advance-deductions" };
  }
  if (path === "/api/core/hr/payroll-obligations/deductions" && method === "GET") {
    return { name: "payroll-obligation-deductions" };
  }
  const payrollRecurringDeduction = /^\/api\/core\/hr\/payroll-recurring-deductions\/([^/]+)$/.exec(path);
  if (payrollRecurringDeduction) {
    return { name: "payroll-recurring-deduction", id: payrollRecurringDeduction[1] };
  }
  if (path === "/api/core/hr/payroll-recurring-deductions") {
    return { name: "payroll-recurring-deductions" };
  }
  const payrollObligationCancel = /^\/api\/core\/hr\/payroll-obligations\/([^/]+)\/cancel$/.exec(path);
  if (payrollObligationCancel && method === "POST") {
    return { name: "payroll-obligation:cancel", id: payrollObligationCancel[1] };
  }
  if (path === "/api/core/hr/payroll-obligations") {
    return { name: "payroll-obligations" };
  }
  const payrollObligationInstallmentDefer = /^\/api\/core\/hr\/payroll-obligation-installments\/([^/]+)\/defer$/.exec(path);
  if (payrollObligationInstallmentDefer && method === "POST") {
    return { name: "payroll-obligation-installment:defer", id: payrollObligationInstallmentDefer[1] };
  }
  const salaryAdvanceInstallmentDefer = /^\/api\/core\/hr\/salary-advance-installments\/([^/]+)\/defer$/.exec(path);
  if (salaryAdvanceInstallmentDefer && method === "POST") {
    return { name: "salary-advance-installment:defer", id: salaryAdvanceInstallmentDefer[1] };
  }
  if (path === "/api/core/hr/payroll-carryovers" && method === "GET") return { name: "payroll-carryovers" };
  if (path === "/api/core/hr/payroll-reconciliations/batch" && method === "POST") return { name: "payroll-reconciliations:batch" };
  const payrollEntryAction = /^\/api\/core\/hr\/payroll-entries\/([^/]+)\/(adjustments|overtime|approve|paid|reopen)$/.exec(path);
  if (payrollEntryAction) return { name: `payroll-entry:${payrollEntryAction[2]}`, id: payrollEntryAction[1] };
  if (path === "/api/core/hr/employee-targets/mine" && method === "GET") return { name: "employee-targets:mine" };
  if (path === "/api/core/hr/employee-targets/rebuild" && method === "POST") return { name: "employee-targets:rebuild" };
  if (path === "/api/core/hr/employee-targets/adjustments" && method === "POST") return { name: "employee-targets:adjustments" };
  const targetPlanDetail = /^\/api\/core\/hr\/employee-targets\/plans\/([^/]+)$/.exec(path);
  if (targetPlanDetail) return { name: "employee-targets:plan", id: targetPlanDetail[1] };
  if (path === "/api/core/hr/employee-targets/plans") return { name: "employee-targets:plans" };
  const targetEmployeeDetail = /^\/api\/core\/hr\/employee-targets\/([^/]+)$/.exec(path);
  if (targetEmployeeDetail && method === "GET") return { name: "employee-targets:detail", id: targetEmployeeDetail[1] };
  const fileContent = /^\/api\/core\/files\/([^/]+)\/content$/.exec(path);
  if (fileContent && ["GET", "PUT"].includes(method)) return { name: "file:content", id: fileContent[1] };

  for (const [name, prefix] of [
    ["clients", "/api/core/clients"],
    ["services", "/api/core/services"],
    ["staff", "/api/core/staff"],
    ["bookings", "/api/core/bookings"],
    ["invoices", "/api/core/invoices"],
    ["income", "/api/core/income"],
    ["expenses", "/api/core/expenses"],
    ["discounts", "/api/core/discounts"],
    ["sections", "/api/core/sections"],
    ["categories", "/api/core/categories"],
    ["refunds", "/api/core/refunds"],
    ["audit", "/api/core/audit"],
    ["hr-employees", "/api/core/hr/employees"],
    ["shift-templates", "/api/core/hr/shift-templates"],
    ["shift-assignments", "/api/core/hr/shift-assignments"],
    ["schedule-exceptions", "/api/core/hr/schedule-exceptions"],
    ["shift-payroll-adjustments", "/api/core/hr/shift-payroll-adjustments"],
    ["shift-payroll-period-locks", "/api/core/hr/shift-payroll-period-locks"],
    ["attendance", "/api/core/hr/attendance"],
    ["leaves", "/api/core/hr/leaves"],
    ["permissions", "/api/core/hr/permissions"],
    ["absences", "/api/core/hr/absences"],
    ["payroll-periods", "/api/core/hr/payroll-periods"],
    ["payroll-entries", "/api/core/hr/payroll-entries"],
    ["employee-targets", "/api/core/hr/employee-targets"],
    ["settings", "/api/core/settings"],
    ["admin-profiles", "/api/core/admin-profiles"],
    ["files", "/api/core/files"],
  ]) {
    const id = one(prefix);
    if (id) return { name, id };
    if (path === prefix) return { name };
  }

  const discountUse = /^\/api\/core\/discounts\/([^/]+)\/use$/.exec(path);
  if (discountUse && method === "POST") return { name: "discount:use", id: discountUse[1] };

  if (path === "/api/core/availability") return { name: "availability" };
  if (path === "/api/core/payments") return { name: "payments" };
  if (path === "/api/core/income") return { name: "income" };
  if (path === "/api/core/health") return { name: "health" };
  return null;
}

function publicBookingQuery(routeName, query = {}) {
  const safe = { ...query };
  if (["services", "staff", "sections", "categories"].includes(routeName)) {
    safe.active = "true";
  }
  if (routeName === "discounts") {
    safe.active = "true";
    safe.includeDeleted = "false";
  }
  return safe;
}

function publicDiscountIsVisible(row, nowMs = Date.now()) {
  if (Number(row?.active) !== 1 || Number(row?.published ?? 1) !== 1 || row?.deleted_at) return false;
  const status = cleanText(row?.status || "active").toLowerCase();
  if (["draft", "disabled", "expired"].includes(status)) return false;
  const startsAt = Date.parse(cleanText(row?.starts_at));
  const endsAt = Date.parse(cleanText(row?.ends_at));
  if (Number.isFinite(startsAt) && startsAt > nowMs) return false;
  if (Number.isFinite(endsAt) && endsAt < nowMs) return false;
  return true;
}

function publicStaffIsVisible(row) {
  return staffIsPubliclyBookable(row);
}

async function dispatch(ctx, route, method, body, query, env) {
  const db = ctx.coreDb;
  const isClientSelfRoute = new Set([
    "client:portal",
    "client:me",
    "client:bookings",
    "client:loyalty",
    "client:offers",
  ]).has(route.name);
  const isAuthSelfRoute = route.name === "auth:me";
  const publicRoute = isPublicRoute(route, method);
  const publicConsumer = publicRoute && (ctx.guestAccess || !OPERATIONS_ROLES.has(ctx.role));
  if (!ctx.guestAccess && !isAuthSelfRoute && !isClientSelfRoute && !publicRoute) requireRole(ctx.role);
  const readQuery = publicConsumer ? publicBookingQuery(route.name, query) : query;
  const actorInfo = {
    uid: ctx.identity?.uid || "",
    email: ctx.identity?.claims?.email || ctx.user?.email || "",
    name: ctx.user?.display_name || ctx.identity?.claims?.name || "",
    role: ctx.role,
    userId: ctx.user?.id || "",
    ip: ctx.requestMeta?.ip || "",
    userAgent: ctx.requestMeta?.userAgent || "",
    employeeId: ctx.employeeId || "",
  };

  switch (route.name) {
    case "health":
      return { worker: "ok", d1: Boolean(db) };

    case "auth:me":
      await touchAccountLogin(db, ctx.user.id);
      return serializeAuthMe(db, ctx.salonId, ctx.user);

    case "admin:accounts":
      if (method === "GET") {
        requireAnyPermission(ctx, ["accounts.read", "admin_accounts.view"]);
        return listAccounts(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requireAnyPermission(ctx, ["accounts.create", "admin_accounts.manage"]);
        return createAccount(db, ctx.salonId, body, ctx);
      }
      break;

    case "admin:account":
      if (method === "GET") {
        requireAnyPermission(ctx, ["accounts.read", "admin_accounts.view"]);
        return getAccountDetail(db, ctx.salonId, route.id);
      }
      if (method === "PATCH") {
        requireAnyPermission(ctx, ["accounts.update", "admin_accounts.manage"]);
        return updateAccount(db, ctx.salonId, route.id, body, ctx);
      }
      if (method === "DELETE") {
        requirePermission(ctx, "accounts.delete");
        return deleteAccount(db, ctx.salonId, route.id, ctx);
      }
      break;

    case "admin:account:disable":
      requireAnyPermission(ctx, ["accounts.disable", "admin_accounts.manage"]);
      if (method === "POST") return disableAccount(db, ctx.salonId, route.id, ctx);
      break;

    case "admin:account:restore":
      requireAnyPermission(ctx, ["accounts.restore", "admin_accounts.manage"]);
      if (method === "POST") return restoreAccount(db, ctx.salonId, route.id, ctx);
      break;

    case "admin:account:permissions":
      if (method === "GET") {
        requirePermission(ctx, "permissions.read");
        return getAccountDetail(db, ctx.salonId, route.id);
      }
      if (method === "PUT") {
        requirePermission(ctx, "permissions.manage");
        return replaceAccountPermissions(db, ctx.salonId, route.id, body, ctx);
      }
      break;

    case "admin:account:employee-link":
      if (method === "GET") {
        requirePermission(ctx, "employee_links.read");
        return (await getAccountDetail(db, ctx.salonId, route.id)).employeeLink;
      }
      if (method === "PUT") {
        requirePermission(ctx, "employee_links.manage");
        return replaceEmployeeLink(db, ctx.salonId, route.id, body, ctx);
      }
      if (method === "DELETE") {
        requirePermission(ctx, "employee_links.manage");
        return deleteEmployeeLink(db, ctx.salonId, route.id, ctx);
      }
      break;

    case "admin:account:reset-password":
      requireAnyPermission(ctx, ["accounts.reset_password", "admin_accounts.manage"]);
      if (method === "POST") return sendPasswordReset(db, ctx.salonId, route.id, env, ctx);
      break;

    case "admin:roles":
      requirePermission(ctx, "roles.read");
      if (method === "GET") return getRoleCatalog(db, ctx.salonId);
      break;

    case "admin:permissions":
      requirePermission(ctx, "permissions.read");
      if (method === "GET") return getPermissionCatalog(db);
      break;

    case "client:portal":
      if (method === "GET") return getClientPortalSnapshot(db, ctx.salonId, ctx.identity);
      break;

    case "client:me":
      if (method === "GET") return getSelfProfile(db, ctx.salonId, ctx.identity);
      if (method === "PATCH") return patchSelfProfile(db, ctx.salonId, ctx.identity, body);
      break;

    case "client:bookings":
      if (method === "GET") return listSelfBookings(db, ctx.salonId, ctx.identity);
      break;

    case "client:loyalty":
      if (method === "GET") return getSelfLoyalty(db, ctx.salonId, ctx.identity);
      break;

    case "client:offers":
      if (method === "GET") return listSelfOffers(db, ctx.salonId, ctx.identity);
      break;

    case "client:admin-overview":
      requireRole(ctx.role, OPERATIONS_ROLES);
      if (method === "GET") return getAdminClientOverview(db, ctx.salonId, route.id);
      break;

    case "client:loyalty-adjustment": {
      requireRole(ctx.role, ADMIN_ROLES);
      const loyalty = await adjustClientLoyalty(
        db,
        ctx.salonId,
        route.id,
        body,
        ctx.identity?.uid || ""
      );
      await recordAudit(db, ctx.salonId, {
        action: "client_loyalty_adjustment",
        entityType: "client",
        entityId: route.id,
        description: body.reason,
        after: {
          points: Number(body.points),
          balance: loyalty.balance,
          operationId: body.operationId || body.operation_id,
        },
      }, actorInfo);
      return loyalty;
    }

    case "clients":
      if (method === "GET" && route.id) {
        return getClient(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        return listClients(db, ctx.salonId, query);
      }
      if (method === "POST") {
        if (ctx.role === "client") {
          return resolveSelfClient(db, ctx.salonId, ctx.identity, {
            createIfMissing: true,
          });
        }
        if (ctx.guestAccess) {
          const { firebaseUid, uid, authUid, ...safeBody } = body || {};
          return createClient(db, ctx.salonId, safeBody);
        }
        return createClient(db, ctx.salonId, body);
      }
      if (method === "PATCH" && route.id) {
        const updatesIdentity = ["name", "phone", "phoneNormalized"].some(
          (field) => Object.prototype.hasOwnProperty.call(body || {}, field)
        );
        if (updatesIdentity) requireRole(ctx.role, ADMIN_ROLES);
        const before = await getClient(db, ctx.salonId, route.id);
        const updated = await patchClient(db, ctx.salonId, route.id, body);
        await recordAudit(db, ctx.salonId, {
          action: "client_profile_updated",
          entityType: "client",
          entityId: updated.id,
          description: "Client record updated through the authenticated Core API.",
          before: {
            name: before.name,
            phone: before.phone_normalized,
          },
          after: {
            name: updated.name,
            phone: updated.phone_normalized,
          },
        }, actorInfo);
        return updated;
      }
      break;

    case "services":
      if (method === "GET") {
        return listServices(db, ctx.salonId, readQuery);
      }
      if (method === "POST") {
        return createService(db, ctx.salonId, body);
      }
      if (method === "PATCH" && route.id) {
        return patchService(db, ctx.salonId, route.id, body);
      }
      break;

    case "staff":
      if (method === "GET" && route.id) {
        const row = await getStaff(db, ctx.salonId, route.id);
        if (publicConsumer && !publicStaffIsVisible(row)) throw new AppError(404, "core_staff:not_found");
        return row;
      }
      if (method === "GET") {
        const rows = await listStaff(db, ctx.salonId, readQuery);
        return publicConsumer ? rows.filter(publicStaffIsVisible) : rows;
      }
      if (method === "PATCH" && route.id) {
        return patchStaff(db, ctx.salonId, route.id, body);
      }
      break;

    case "availability":
      if (method === "GET") {
        return getStaffAvailability(db, ctx.salonId, query);
      }
      break;

    case "booking:public-track":
      if (method === "GET") return getPublicBookingTrack(db, ctx.salonId, query.publicId || query.public_id || query.code);
      break;

    case "bookings":
      if (method === "GET" && route.id) {
        return getBooking(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        return listBookings(db, ctx.salonId, query);
      }
      if (method === "POST") {
        let bookingBody = body;
        if (ctx.role === "client") {
          const selfClient = await resolveSelfClient(
            db,
            ctx.salonId,
            ctx.identity,
            { createIfMissing: true }
          );
          bookingBody = {
            ...body,
            clientId: selfClient.id,
            client_id: selfClient.id,
            source: "client",
          };
        }
        return createBooking(
          db,
          ctx.salonId,
          bookingBody,
          actorInfo
        );
      }
      if (method === "PATCH" && route.id) {
        return patchBooking(db, ctx.salonId, route.id, body, actorInfo);
      }
      if (method === "DELETE" && route.id) {
        return deleteBooking(db, ctx.salonId, route.id, actorInfo);
      }
      break;

    case "bookings:internal":
      return createBooking(
        db,
        ctx.salonId,
        { ...body, source: "internal", channel: "internal" },
        actorInfo,
        { allowPastDates: true }
      );

    case "booking:complete":
      return completeBooking(db, ctx.salonId, route.id);

    case "booking:cancel":
      return cancelBooking(
        db,
        ctx.salonId,
        route.id,
        body.reason
      );

    case "booking:reschedule":
      return rescheduleBooking(db, ctx.salonId, route.id, body);

    case "invoices":
      if (method === "GET" && route.id) {
        return getInvoice(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        if (query.bookingId || query.booking_id) {
          return getInvoiceByBookingId(db, ctx.salonId, query.bookingId || query.booking_id);
        }
        return listInvoices(db, ctx.salonId);
      }
      if (method === "POST") {
        return createInvoice(db, ctx.salonId, body);
      }
      break;

    case "payments":
      if (method === "GET") {
        return listPayments(db, ctx.salonId);
      }
      if (method === "POST") {
        return createPayment(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "income":
      if (method === "GET") {
        return listIncome(db, ctx.salonId);
      }
      if (method === "POST") {
        return createIncome(db, ctx.salonId, body, actorInfo);
      }
      if (method === "PATCH" && route.id) {
        return patchIncome(db, ctx.salonId, route.id, body, actorInfo);
      }
      if (method === "DELETE" && route.id) {
        return deleteIncome(db, ctx.salonId, route.id, actorInfo);
      }
      break;

    case "expenses":
      if (method === "GET") {
        return listExpenses(db, ctx.salonId);
      }
      if (method === "POST") {
        return createExpense(
          db,
          ctx.salonId,
          body,
          ctx.identity.uid,
          actorInfo
        );
      }
      if (method === "PATCH" && route.id) {
        return patchExpense(db, ctx.salonId, route.id, body, actorInfo);
      }
      if (method === "DELETE" && route.id) {
        return deleteExpense(db, ctx.salonId, route.id, actorInfo);
      }
      break;

    case "discounts":
      if (method === "GET") {
        const rows = await listDiscounts(db, ctx.salonId, readQuery);
        return publicConsumer ? rows.filter((row) => publicDiscountIsVisible(row)) : rows;
      }
      if (method === "POST") return createDiscount(db, ctx.salonId, body, actorInfo);
      if (method === "PATCH" && route.id) return patchDiscount(db, ctx.salonId, route.id, body, actorInfo);
      if (method === "DELETE" && route.id) return deleteDiscount(db, ctx.salonId, route.id, actorInfo);
      break;

    case "discount:use":
      return incrementDiscountUsage(db, ctx.salonId, route.id, actorInfo);

    case "sections":
    case "categories": {
      const kind = route.name;
      if (method === "GET") return listCatalogRows(db, ctx.salonId, kind, readQuery);
      if (method === "POST") return createCatalogRow(db, ctx.salonId, kind, body);
      if (method === "PATCH" && route.id) return patchCatalogRow(db, ctx.salonId, kind, route.id, body);
      if (method === "DELETE" && route.id) return deleteCatalogRow(db, ctx.salonId, kind, route.id);
      break;
    }

    case "refunds":
      if (method === "GET") return listRefunds(db, ctx.salonId, query);
      if (method === "POST") return createRefund(db, ctx.salonId, body, actorInfo);
      if (method === "PATCH" && route.id) return patchRefund(db, ctx.salonId, route.id, body, actorInfo);
      if (method === "DELETE" && route.id) return voidRefund(db, ctx.salonId, route.id, actorInfo);
      break;

    case "audit":
      requireAnyPermission(ctx, ["audit.read", "logs.view"]);
      if (method === "GET") return listAudit(db, ctx.salonId, query);
      if (method === "POST") return recordAudit(db, ctx.salonId, body, actorInfo);
      break;

    case "employee-messages": {
      requireAnyPermission(ctx, ["messages.view", "messages.manage"]);
      if (method === "GET") {
        return listEmployeeMessages(db, ctx.salonId, query, actorInfo, {
          manageAll: ctx.permissions.includes("messages.manage"),
        });
      }
      if (method === "POST") {
        return createEmployeeMessage(db, ctx.salonId, body, actorInfo, {
          managementSender: ctx.permissions.includes("messages.manage"),
        });
      }
      break;
    }

    case "employee-message-thread:read":
      requireAnyPermission(ctx, ["messages.view", "messages.manage"]);
      return markEmployeeThreadRead(db, ctx.salonId, route.id, actorInfo);

    case "employee-notifications": {
      requireAnyPermission(ctx, [
        "workspace.employee_portal.view",
        "messages.view",
        "messages.manage",
        "employees.view",
        "employees.update",
        "employees.create",
        "payroll.view",
      ]);
      if (method === "GET") return listEmployeeNotifications(db, ctx.salonId, query, actorInfo);
      if (method === "POST") {
        requireAnyPermission(ctx, [
          "messages.manage",
          "employees.update",
          "employees.create",
          "employees.manage",
          "attendance.leaves.manage",
          "payroll.manage",
          "admin_accounts.manage",
        ]);
        return createEmployeeNotification(db, ctx.salonId, body, actorInfo);
      }
      break;
    }

    case "employee-notification:read":
      requireAnyPermission(ctx, [
        "workspace.employee_portal.view",
        "messages.view",
        "messages.manage",
        "employees.view",
        "payroll.view",
      ]);
      return markEmployeeNotificationRead(db, ctx.salonId, route.id, actorInfo);

    case "employee-notifications:read-all":
      requireAnyPermission(ctx, [
        "workspace.employee_portal.view",
        "messages.view",
        "messages.manage",
        "employees.view",
        "payroll.view",
      ]);
      return markAllEmployeeNotificationsRead(db, ctx.salonId, actorInfo);

    case "recruitment":
      if (method === "GET") {
        requirePermission(ctx, "recruitment.view");
        return listRecruitmentApplications(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requirePermission(ctx, "recruitment.manage");
        return createRecruitmentApplication(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "recruitment:detail":
      requirePermission(ctx, "recruitment.manage");
      return patchRecruitmentApplication(db, ctx.salonId, route.id, body, actorInfo);

    case "employee-request:payroll-impact-mine":
      requireAnyPermission(ctx, ["employee_requests.own.view", "payroll.view"]);
      return getEmployeeRequestPayrollImpact(db, ctx.salonId, actorInfo);

    case "employee-request-notifications":
      requireAnyPermission(ctx, ["employee_requests.own.view", "employee_requests.view"]);
      return listEmployeeRequestNotifications(db, ctx.salonId, actorInfo, query);

    case "employee-request-assignees":
      requirePermission(ctx, "employee_requests.assign");
      return listEmployeeRequestAssignees(db, ctx.salonId, query);

    case "employee-request-notification:read":
      requireAnyPermission(ctx, ["employee_requests.own.view", "employee_requests.view"]);
      return markEmployeeRequestNotificationRead(db, ctx.salonId, route.id, actorInfo);

    case "employee-request-notification:read-all":
      requireAnyPermission(ctx, ["employee_requests.own.view", "employee_requests.view"]);
      return markAllEmployeeRequestNotificationsRead(db, ctx.salonId, actorInfo);

    case "employee-request:exceptional-financial-payment-preview":
      requireAnyPermission(ctx, [
        "employee_requests.own.view",
        "workspace.employee_portal.view",
      ]);

      if (!ctx.employeeId) {
        throw new AppError(
          409,
          "core_employee_request:employee_link_required"
        );
      }

      return getExceptionalFinancialPaymentPreview(
        db,
        ctx.salonId,
        ctx.employeeId,
        query.requestedDays
      );

    case "employee-request:mine":
      requireAnyPermission(ctx, ["employee_requests.own.view", "workspace.employee_portal.view"]);
      if (method === "GET") return listEmployeeRequests(db, ctx.salonId, query, actorInfo, { ownOnly: true });
      if (method === "POST") {
        requirePermission(ctx, "employee_requests.own.create");
        return createEmployeeRequest(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "employee-requests": {
      const leaveScoped = cleanText(method === "POST"
        ? body.requestType || body.request_type
        : query.type || query.requestType || query.request_type
      ).toLowerCase() === "leave";
      const canManageLeaves = ctx.permissions.includes("attendance.leaves.manage");
      if (method === "GET") {
        if (!leaveScoped || !canManageLeaves) requirePermission(ctx, "employee_requests.view");
        return listEmployeeRequests(db, ctx.salonId, query, actorInfo);
      }
      if (method === "POST") {
        if (!leaveScoped || !canManageLeaves) requirePermission(ctx, "employee_requests.manage");
        return createEmployeeRequest(db, ctx.salonId, body, actorInfo);
      }
      break;
    }

    case "employee-request:stats":
      requirePermission(ctx, "employee_requests.view");
      if (method === "GET") return employeeRequestStats(db, ctx.salonId, query);
      break;

    case "employee-request:detail": {
      if (method !== "GET") break;
      const ownAccess = ctx.permissions.includes("employee_requests.own.view") && !ctx.permissions.includes("employee_requests.view");
      if (ownAccess) return getEmployeeRequest(db, ctx.salonId, route.id, actorInfo, { ownOnly: true });
      requireAnyPermission(ctx, ["employee_requests.view", "employee_requests.own.view"]);
      try {
        return await getEmployeeRequest(db, ctx.salonId, route.id, actorInfo, { ownOnly: false });
      } catch (error) {
        if (!ctx.permissions.includes("employee_requests.view")) throw error;
        throw error;
      }
    }

    case "employee-request:comments": {
      if (method !== "POST") break;
      const canManage = ctx.permissions.includes("employee_requests.manage");
      if (canManage) {
        if (cleanText(body.visibility) === "internal") requirePermission(ctx, "employee_requests.internal_notes");
        return addEmployeeRequestComment(db, ctx.salonId, route.id, body, actorInfo);
      }
      requirePermission(ctx, "employee_requests.own.comment");
      return addEmployeeRequestComment(db, ctx.salonId, route.id, body, actorInfo, { ownOnly: true });
    }

    case "employee-request:attachments": {
      if (method !== "POST") break;
      const canManage = ctx.permissions.includes("employee_requests.manage");
      if (canManage) return addEmployeeRequestAttachment(db, ctx.salonId, route.id, body, actorInfo);
      requirePermission(ctx, "employee_requests.own.comment");
      return addEmployeeRequestAttachment(db, ctx.salonId, route.id, body, actorInfo, { ownOnly: true });
    }

    case "employee-request:action": {
      const requestRow = await getEmployeeRequest(db, ctx.salonId, route.id, actorInfo);
      const leaveManager =
        requestRow.request_type === "leave" &&
        ctx.permissions.includes("attendance.leaves.manage");
      const employeeActions = new Set(["answer-info", "cancel"]);
      if (employeeActions.has(route.action) && !ctx.permissions.includes("employee_requests.manage") && !leaveManager) {
        requirePermission(ctx, route.action === "cancel" ? "employee_requests.own.cancel" : "employee_requests.own.comment");
        return transitionEmployeeRequest(db, ctx.salonId, route.id, route.action, body, actorInfo, { ownOnly: true, externalAttendanceDb: env.ATTENDANCE_DB || null });
      }
      const actionPermission = {
        receive: "employee_requests.receive", assign: "employee_requests.assign",
        "start-review": "employee_requests.manage", "request-info": "employee_requests.request_info",
        approve: "employee_requests.approve", reject: "employee_requests.reject",
        execute: "employee_requests.execute", complete: "employee_requests.complete",
        cancel: "employee_requests.manage", reopen: "employee_requests.reopen", "record-exit": "employee_requests.execute",
        "record-return": "employee_requests.complete",
      }[route.action] || "employee_requests.manage";
      if (!leaveManager) requirePermission(ctx, actionPermission);
      if (["approve", "execute"].includes(route.action)) {
        if (requestRow.request_type === "salary_advance" && route.action === "approve") {
          requirePermission(ctx, "employee_requests.salary_advance.approve");
        }
        if (requestRow.request_type === "attendance_correction" && route.action === "execute") {
          requirePermission(ctx, "employee_requests.attendance_correction.execute");
        }
        if (requestRow.request_type === "resignation" && route.action === "execute") {
          requirePermission(ctx, "employee_requests.resignation.execute");
        }
      }
      return transitionEmployeeRequest(db, ctx.salonId, route.id, route.action, body, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });
    }

    case "employee-profile:mine": {
      requirePermission(ctx, "workspace.employee_portal.view");
      if (!ctx.employeeId) {
        throw new AppError(409, "core_hr:employee_link_required");
      }

      const current = await getHrEmployee(db, ctx.salonId, ctx.employeeId);
      if (method === "GET") return current;

      // Employee self-service is deliberately profile-only. Never accept
      // employment, salary, attendance, GOSI, status or visibility fields
      // from the browser. Those remain administration-owned Core data.
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      const safeProfile = {
        id: ctx.employeeId,
        name: has("name") ? body.name : current.name,
        phone: has("phone") ? body.phone : current.phone_normalized,
        avatarUrl: has("avatarUrl") ? body.avatarUrl : current.avatar_url,
        bio: has("bio") ? body.bio : current.bio,
      };

      return upsertHrEmployee(
        db,
        ctx.salonId,
        safeProfile,
        actorInfo
      );
    }

    case "hr-employee:offboard":
      requirePermission(ctx, "employees.delete");
      return offboardHrEmployee(db, ctx.salonId, route.id, body, actorInfo);

    case "hr-employees":
      if (method === "GET") {
        requireAnyPermission(ctx, [
          "employees.view",
          "employees.update",
          "employees.manage",
          "payroll.view",
          "payroll.manage",
          "attendance.view",
          "attendance.leaves.manage",
        ]);
        if (route.id) return getHrEmployee(db, ctx.salonId, route.id);
        return listHrEmployees(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requireAnyPermission(ctx, ["employees.create", "employees.manage"]);
        return upsertHrEmployee(db, ctx.salonId, body, actorInfo);
      }
      if (method === "PATCH" && route.id) {
        requireAnyPermission(ctx, [
          "employees.update",
          "employees.manage",
          "payroll.manage",
          "attendance.leaves.manage",
        ]);
        return upsertHrEmployee(db, ctx.salonId, { ...body, id: route.id }, actorInfo);
      }
      break;

    case "employee-portal:leave-balance": {
      requireAnyPermission(ctx, [
        "employee_requests.own.view",
        "workspace.employee_portal.view",
      ]);

      if (!ctx.employeeId) {
        throw new AppError(
          409,
          "core_leave_balance:employee_link_required"
        );
      }

      // Employee portal receives only its own balance summary.
      // Do not expose ledger entries, actors, notes or audit metadata.
      const state = await getLeaveBalanceState(
        db,
        ctx.salonId,
        ctx.employeeId,
        {
          limit: 1,
          includeDeleted: false,
          includeReversals: false,
        }
      );

      return {
        employeeId: state.employeeId,
        leaveBalance: state.leaveBalance,
        leaveEntitlementDate:
          state.leaveEntitlementDate ?? null,
      };
    }
    case "employee-portal:leaves": {
      requireAnyPermission(ctx, [
        "employee_requests.own.view",
        "workspace.employee_portal.view",
      ]);

      if (!ctx.employeeId) {
        throw new AppError(
          409,
          "core_leave:employee_link_required"
        );
      }

      // Self endpoint is identity-bound.
      // The browser never chooses the employee identity.
      const requestedEmployeeId =
        cleanText(
          query.employeeId ||
          query.employee_id
        );

      const requestedEmployeeUid =
        cleanText(
          query.employeeUid ||
          query.employee_uid
        );

      if (
        (requestedEmployeeId &&
          requestedEmployeeId !==
            cleanText(ctx.employeeId)) ||
        (requestedEmployeeUid &&
          requestedEmployeeUid !==
            cleanText(ctx.identity?.uid))
      ) {
        throw new AppError(
          403,
          "core_employee_portal:cross_employee_forbidden"
        );
      }

      const selfQuery = {
        employeeId: ctx.employeeId,
      };

      const requestedStatus =
        cleanText(query.status);

      if (requestedStatus) {
        selfQuery.status =
          requestedStatus;
      }

      return listLeaves(
        db,
        ctx.salonId,
        selfQuery
      );
    }

    case "employee-portal:absences": {
      requirePermission(
        ctx,
        "attendance.own.view"
      );

      const ownEmployeeId =
        cleanText(ctx.employeeId);

      if (!ownEmployeeId) {
        throw new AppError(
          403,
          "core_attendance:employee_link_required"
        );
      }

      const requestedEmployeeId =
        cleanText(
          query.employeeId ||
          query.employee_id
        );

      if (
        requestedEmployeeId &&
        requestedEmployeeId !== ownEmployeeId
      ) {
        throw new AppError(
          403,
          "core_attendance:cross_employee_forbidden"
        );
      }

      return listAbsences(
        db,
        ctx.salonId,
        {
          employeeId: ownEmployeeId,
        }
      );
    }

    case "employee-portal:resolved-shifts": {
      requirePermission(
        ctx,
        "attendance.own.view"
      );

      const ownEmployeeId =
        cleanText(ctx.employeeId);

      if (!ownEmployeeId) {
        throw new AppError(
          403,
          "core_attendance:employee_link_required"
        );
      }

      const requestedEmployeeId =
        cleanText(
          query.employeeId ||
          query.employee_id
        );

      if (
        requestedEmployeeId &&
        requestedEmployeeId !== ownEmployeeId
      ) {
        throw new AppError(
          403,
          "core_attendance:cross_employee_forbidden"
        );
      }

      const dateFrom =
        cleanText(
          query.dateFrom ||
          query.date_from
        );

      const dateTo =
        cleanText(
          query.dateTo ||
          query.date_to ||
          dateFrom
        );

      return resolveEmployeeShiftsBatch(
        db,
        ctx.salonId,
        {
          employeeIds: [
            ownEmployeeId,
          ],
          dateFrom,
          dateTo,
        }
      );
    }

    case "hr-employee:leave-balance":
      requireAnyPermission(ctx, [
        "employees.view",
        "employees.update",
        "employees.manage",
        "attendance.view",
        "attendance.leaves.manage",
        "payroll.view",
        "payroll.manage",
      ]);
      return getLeaveBalanceState(
        db,
        ctx.salonId,
        route.id,
        query
      );

    case "hr-employee:leave-balance-adjustment": {
      requirePermission(
        ctx,
        "attendance.leaves.manage"
      );

      const operationId = requiredId(
        body.operationId ??
          body.operation_id,
        "operationId"
      );

      return adjustLeaveBalance(
        db,
        ctx.salonId,
        route.id,
        {
          ...body,

          // Server-controlled canonical source.
          sourceType:
            "manual_adjustment",

          // Same logical submit/retry = same ledger source.
          sourceId:
            operationId,
        },
        actorInfo
      );
    }
    case "hr-employee:leave-balance-entry":
      requirePermission(ctx, "attendance.leaves.manage");
      return reverseLeaveBalanceAdjustment(
        db,
        ctx.salonId,
        route.entryId,
        {
          reason:
            "حذف حركة رصيد الإجازة من إدارة الموظفات",
        },
        actorInfo,
        {
          allowedSourceTypes: [
            "manual_adjustment",
          ],
          expectedEmployeeId: route.id,
        }
      );

    case "hr-employee:leave-entitlement-date":
      requirePermission(ctx, "attendance.leaves.manage");
      return setLeaveEntitlementDate(
        db,
        ctx.salonId,
        route.id,
        body.leaveEntitlementDate ??
          body.leave_entitlement_date ??
          body.date ??
          "",
        actorInfo
      );

    case "hr-employee:schedules":
      requirePermission(ctx, "employees.schedule.manage");
      return replaceHrSchedules(db, ctx.salonId, route.id, body.schedules || []);

    case "shift-templates":
      requireAnyPermission(ctx, ["employees.schedule.manage", "attendance.settings.manage"]);
      if (method === "GET") return listShiftTemplates(db, ctx.salonId, query);
      if (["POST", "PATCH"].includes(method)) return saveShiftTemplate(db, ctx.salonId, { ...body, ...(route.id ? { id: route.id } : {}) }, actorInfo);
      break;

    case "shift-assignments":
      requirePermission(ctx, "employees.schedule.manage");
      if (method === "GET") return listShiftAssignments(db, ctx.salonId, query);
      if (method === "POST") return createShiftAssignment(db, ctx.salonId, body, actorInfo);
      if (method === "PATCH" && route.id) return updateShiftAssignment(db, ctx.salonId, route.id, body, actorInfo);
      if (method === "DELETE" && route.id) return cancelShiftAssignment(db, ctx.salonId, route.id, body, actorInfo);
      break;

    case "schedule-exceptions":
      requirePermission(ctx, "employees.schedule.manage");

      if (
        method === "PUT" &&
        route.id === "working-hours-sync"
      ) {
        return syncWorkingHourScheduleExceptions(
          db,
          ctx.salonId,
          body,
          actorInfo
        );
      }

      if (method === "GET") return listScheduleExceptions(db, ctx.salonId, query);
      if (method === "POST") return createScheduleException(db, ctx.salonId, body, actorInfo);
      if (method === "PATCH" && route.id) return updateScheduleException(db, ctx.salonId, route.id, body, actorInfo);
      break;

    case "shift-change-preview":
      requirePermission(ctx, "employees.schedule.manage");
      if (method === "POST") return previewShiftChange(db, ctx.salonId, body);
      break;

    case "shift-payroll-adjustments":
      requireAnyPermission(ctx, ["employees.schedule.manage", "payroll.view", "payroll.manage"]);
      if (method === "GET") return listShiftPayrollAdjustments(db, ctx.salonId, query);
      break;

    case "shift-payroll-period-locks":
      if (method === "GET") {
        requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
        return listShiftPayrollPeriodLocks(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requirePermission(ctx, "payroll.manage");
        return saveShiftPayrollPeriodLock(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "hr-shift:resolve-batch": {
      requireAnyPermission(ctx, [
        "employees.schedule.manage",
        "attendance.view",
        "payroll.view",
        "payroll.manage",
      ]);

      return resolveEmployeeShiftsBatch(
        db,
        ctx.salonId,
        body
      );
    }

    case "hr-shift:resolve": {
      const actorEmployeeId = cleanText(ctx.employeeId);
      const requestedEmployeeId = cleanText(route.id);
      const isOwnEmployee =
        Boolean(actorEmployeeId) &&
        actorEmployeeId === requestedEmployeeId;

      if (!isOwnEmployee) {
        requireAnyPermission(ctx, [
          "employees.schedule.manage",
          "attendance.view",
          "payroll.view",
          "payroll.manage",
        ]);
      }

      return resolveEmployeeShift(
        db,
        ctx.salonId,
        requestedEmployeeId,
        query.date
      );
    }

    case "attendance":
      requirePermission(ctx, "attendance.view");
      if (method === "GET") return listAttendance(db, ctx.salonId, query, env.ATTENDANCE_DB || null);
      break;

    case "attendance:state":
      return getAttendanceState(db, ctx.salonId, route.id);

    case "attendance:check-in":
      return recordAttendance(db, ctx.salonId, { ...body, type: "check_in" }, actorInfo);

    case "attendance:check-out":
      return recordAttendance(db, ctx.salonId, { ...body, type: "check_out" }, actorInfo);

    case "leaves":
      if (method === "GET") {
        requireAnyPermission(ctx, [
          "attendance.view",
          "attendance.leaves.manage",
          "payroll.view",
          "payroll.manage",
        ]);

        return listLeaves(
          db,
          ctx.salonId,
          query
        );
      }

      if (method === "POST") {
        requirePermission(
          ctx,
          "attendance.leaves.manage"
        );

        return createLeave(
          db,
          ctx.salonId,
          body,
          actorInfo
        );
      }

      break;
    case "leave:approve":
      requirePermission(ctx, "attendance.leaves.manage");
      return decideLeave(db, ctx.salonId, route.id, { ...body, status: "approved" }, actorInfo);

    case "leave:reject":
      requirePermission(ctx, "attendance.leaves.manage");
      return decideLeave(db, ctx.salonId, route.id, { ...body, status: "rejected" }, actorInfo);

    case "permissions": {
      const permissionActor = { ...actorInfo, employeeId: ctx.employeeId || "" };
      const isManager = HR_MANAGEMENT_ROLES.has(ctx.role);
      if (method === "GET") {
        return listPermissionRequests(
          db,
          ctx.salonId,
          isManager
            ? query
            : {
                ...query,
                employeeId: ctx.employeeId || "",
                employeeUid: ctx.identity?.uid || "",
              }
        );
      }
      if (method === "POST") {
        const source = cleanText(body.source).toLowerCase() === "admin_direct"
          ? "admin_direct"
          : "employee_request";
        if (source === "admin_direct") requireRole(ctx.role, HR_MANAGEMENT_ROLES);
        return createPermissionRequest(
          db,
          ctx.salonId,
          source === "admin_direct"
            ? { ...body, source }
            : {
                ...body,
                source,
                employeeId: ctx.employeeId || "",
                employeeUid: ctx.identity?.uid || "",
              },
          permissionActor
        );
      }
      break;
    }

    case "permission:approve":
      requireRole(ctx.role, HR_MANAGEMENT_ROLES);
      return decidePermissionRequest(db, ctx.salonId, route.id, { ...body, status: "approved" }, { ...actorInfo, employeeId: ctx.employeeId || "" });

    case "permission:reject":
      requireRole(ctx.role, HR_MANAGEMENT_ROLES);
      return decidePermissionRequest(db, ctx.salonId, route.id, { ...body, status: "rejected" }, { ...actorInfo, employeeId: ctx.employeeId || "" });

    case "permission:cancel":
      requireRole(ctx.role, HR_MANAGEMENT_ROLES);
      return decidePermissionRequest(db, ctx.salonId, route.id, { ...body, status: "cancelled" }, { ...actorInfo, employeeId: ctx.employeeId || "" });

    case "permission:out":
      requireRole(ctx.role, HR_MANAGEMENT_ROLES);
      return markPermissionOut(db, ctx.salonId, route.id, body, { ...actorInfo, employeeId: ctx.employeeId || "" });

    case "permission:return":
      requireRole(ctx.role, HR_MANAGEMENT_ROLES);
      return markPermissionReturned(db, ctx.salonId, route.id, body, { ...actorInfo, employeeId: ctx.employeeId || "" });

    case "permission:payroll-summary":
      requireRole(ctx.role, PAYROLL_MANAGEMENT_ROLES);
      return permissionPayrollSummary(db, ctx.salonId, query);

    case "absences":
      requirePermission(ctx, "attendance.absences.manage");
      if (method === "GET") return listAbsences(db, ctx.salonId, query);
      if (method === "POST") return createAbsence(db, ctx.salonId, body, actorInfo);
      if (method === "DELETE" && route.id) return deleteAbsence(db, ctx.salonId, route.id);
      break;

    case "payroll-carryovers":
      requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
      if (method === "GET") return listPayrollCarryoverAdjustments(db, ctx.salonId, query);
      break;

    case "payroll-reconciliations:batch":
      requirePermission(ctx, "payroll.manage");
      if (method === "POST") return reconcilePayrollCarryoversBatch(db, ctx.salonId, body, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });
      break;

    case "payroll-preview":
      requirePermission(ctx, "payroll.manage");
      return previewPayrollEntry(db, ctx.salonId, body, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });

    case "payroll-attendance-deduction:defer":
      requirePermission(ctx, "payroll.manage");
      return deferAttendanceDeduction(
        db,
        ctx.salonId,
        body,
        actorInfo,
        { externalAttendanceDb: env.ATTENDANCE_DB || null }
      );

    case "payroll-entries:mine":
      requirePermission(ctx, "workspace.employee_portal.view");
      if (!ctx.employeeId) throw new AppError(403, "core_payroll:employee_link_required");
      return (await listPayrollEntries(db, ctx.salonId, { employeeId: ctx.employeeId }))
        .filter((row) => ["approved", "paid"].includes(cleanText(row.status || "").toLowerCase()));

    case "payroll-advance-deductions":
      requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
      return listPayrollAdvanceDeductions(db, ctx.salonId, query);

    case "payroll-recurring-deductions":
      if (method === "GET") {
        requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
        return listPayrollRecurringDeductions(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requirePermission(ctx, "payroll.manage");
        return savePayrollRecurringDeduction(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "payroll-recurring-deduction":
      requirePermission(ctx, "payroll.manage");
      if (method === "PATCH" || method === "POST") {
        return savePayrollRecurringDeduction(db, ctx.salonId, body, actorInfo, route.id);
      }
      break;

    case "payroll-obligations":
      if (method === "GET") {
        requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
        return listPayrollObligations(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requirePermission(ctx, "payroll.manage");
        return createPayrollObligation(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "payroll-obligation-deductions":
      requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
      return listPayrollObligationDeductions(db, ctx.salonId, query);

    case "payroll-obligation:cancel":
      requirePermission(ctx, "payroll.manage");
      return cancelPayrollObligation(db, ctx.salonId, route.id, body, actorInfo);

    case "payroll-obligation-installment:defer":
      requirePermission(ctx, "payroll.manage");
      return deferPayrollObligationInstallment(db, ctx.salonId, route.id, body, actorInfo);

    case "salary-advance-installment:defer":
      requirePermission(ctx, "payroll.manage");
      return deferSalaryAdvanceInstallment(
        db,
        ctx.salonId,
        route.id,
        body,
        actorInfo,
        { externalAttendanceDb: env.ATTENDANCE_DB || null }
      );

    case "payroll-periods":
      if (method === "GET") {
        requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
        return listPayrollPeriods(db, ctx.salonId);
      }
      if (method === "POST") {
        requirePermission(ctx, "payroll.manage");
        return upsertPayrollPeriod(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "payroll-entries":
      if (method === "GET" && route.id) {
        requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
        return getPayrollEntry(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        requireAnyPermission(ctx, ["payroll.view", "payroll.manage"]);
        return listPayrollEntries(db, ctx.salonId, query);
      }
      if (method === "POST") {
        requirePermission(ctx, "payroll.manage");
        return upsertPayrollEntry(db, ctx.salonId, body, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });
      }
      break;

    case "payroll-entry:adjustments":
      requirePermission(ctx, "payroll.manage");
      if (method === "PATCH" || method === "POST") return updatePayrollEntryAdjustments(db, ctx.salonId, route.id, body, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });
      break;

    case "payroll-entry:overtime":
      requirePermission(ctx, "payroll.manage");
      if (method === "PATCH" || method === "POST") return togglePayrollOvertime(db, ctx.salonId, route.id, body, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });
      break;

    case "payroll-entry:approve":
      requirePermission(ctx, "payroll.manage");
      if (method === "POST") return approvePayrollEntry(db, ctx.salonId, route.id, actorInfo, { externalAttendanceDb: env.ATTENDANCE_DB || null });
      break;

    case "payroll-entry:reopen":
      requirePermission(ctx, "payroll.manage");
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "POST") return reopenPayrollEntry(db, ctx.salonId, route.id, body, actorInfo);
      break;

    case "payroll-entry:paid":
      requirePermission(ctx, "payroll.manage");
      if (method === "POST") return markPayrollEntryPaid(db, ctx.salonId, route.id, actorInfo);
      break;

    case "employee-targets":
      if (method === "GET") {
        requireAnyPermission(ctx, ["targets.view", "targets.view_all", "payroll.view"]);
        return listEmployeeTargetDashboard(db, ctx.salonId, query);
      }
      break;

    case "employee-targets:detail":
      requireAnyPermission(ctx, ["targets.view", "targets.view_all", "payroll.view"]);
      return getEmployeeTargetDetails(db, ctx.salonId, route.id, query);

    case "employee-targets:mine":
      requirePermission(ctx, "targets.view_own");
      if (!ctx.employeeId) throw new AppError(403, "employee_targets:employee_link_required");
      return getEmployeeTargetDetails(db, ctx.salonId, ctx.employeeId, { ...query, ownOnly: true });

    case "employee-targets:plans":
      if (method === "GET") {
        requireAnyPermission(ctx, ["targets.view", "targets.manage", "payroll.view"]);
        return listTargetPlans(db, ctx.salonId);
      }
      if (method === "POST") {
        requirePermission(ctx, "targets.manage");
        return saveTargetPlan(db, ctx.salonId, body, actorInfo);
      }
      break;

    case "employee-targets:plan":
      requirePermission(ctx, "targets.manage");
      if (method === "PATCH" || method === "POST") return saveTargetPlan(db, ctx.salonId, { ...body, id: route.id }, actorInfo);
      break;

    case "employee-targets:rebuild":
      requirePermission(ctx, "targets.manage");
      if (method === "POST") return rebuildEmployeeTargetLedgerForPeriod(db, ctx.salonId, body);
      break;

    case "employee-targets:adjustments":
      requirePermission(ctx, "targets.adjust");
      if (method === "POST") return createTargetAdjustment(db, ctx.salonId, body, actorInfo);
      break;

    case "settings": {
      if (method === "GET" && route.id) {
        const setting = await getSetting(db, ctx.salonId, route.id);
        if (publicConsumer && setting && setting.visibility !== "public") throw new AppError(404, "core_settings:not_found");
        return setting;
      }
      if (method === "GET") {
        const settings = await listSettings(db, ctx.salonId, readQuery);
        return publicConsumer ? settings.filter((row) => row.visibility === "public") : settings;
      }
      requireRole(ctx.role, ADMIN_ROLES);
      if (["POST", "PATCH"].includes(method)) return upsertSetting(db, ctx.salonId, route.id || body.settingKey || body.setting_key, body, actorInfo);
      break;
    }

    case "admin-profiles":
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "GET") return listAdminProfiles(db, ctx.salonId);
      if (["POST", "PATCH"].includes(method)) return upsertAdminProfile(db, ctx.salonId, route.id ? { ...body, firebaseUid: route.id } : body, actorInfo);
      if (method === "DELETE" && route.id) return deleteAdminProfile(db, ctx.salonId, route.id, actorInfo);
      break;

    case "files": {
      const canViewFiles = hasAnyPermissionKey(ctx, [
        "employees.files.view",
        "employees.files.manage",
        "employee_requests.view",
      ]);
      const canManageFiles = hasAnyPermissionKey(ctx, [
        "employees.files.manage",
        "employee_requests.manage",
      ]);
      if (method === "GET" && route.id) {
        await assertFileAccess(ctx, route.id, false);
        return getFileMetadata(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        if (canViewFiles) return listFileMetadata(db, ctx.salonId, query);
        if (!ctx.employeeId) throw new AppError(403, "files_r2:employee_link_required");
        return listFileMetadata(db, ctx.salonId, { ...query, employeeId: ctx.employeeId });
      }
      if (method === "POST") {
        if (canManageFiles) return createFileMetadata(db, ctx.salonId, body, actorInfo);
        if (!ctx.employeeId) throw new AppError(403, "files_r2:employee_link_required");
        const employeeFile = {
          ...body,
          employeeId: ctx.employeeId,
          category: "employee_request",
          visibility: "private",
        };
        delete employeeFile.storageKey;
        delete employeeFile.storage_key;
        return createFileMetadata(db, ctx.salonId, employeeFile, actorInfo);
      }
      if (method === "PATCH" && route.id) {
        const metadata = await assertFileAccess(ctx, route.id, false);
        if (canManageFiles) {
          return patchFileMetadata(db, ctx.salonId, route.id, body);
        }
        if (!ctx.employeeId || cleanText(metadata.employee_id) !== cleanText(ctx.employeeId)) {
          throw new AppError(403, "files_r2:forbidden");
        }
        if (cleanText(metadata.category) !== "employee_internal_outbound") {
          throw new AppError(403, "files_r2:self_update_read_only");
        }
        const keys = Object.keys(body || {}).filter((key) => body[key] !== undefined);
        if (keys.some((key) => key !== "status") || cleanText(body.status).toLowerCase() !== "read") {
          throw new AppError(403, "files_r2:self_update_read_only");
        }
        return patchFileMetadata(db, ctx.salonId, route.id, { status: "read" });
      }
      break;
    }

    default:
      break;
  }

  throw new AppError(405, "core_api:method_not_allowed");
}

export async function handleRequest(request, env) {
  const incomingUrl = new URL(request.url);
  if (
    incomingUrl.pathname === "/api/core/packages" ||
    incomingUrl.pathname.startsWith("/api/core/packages/") ||
    incomingUrl.pathname === "/api/packages" ||
    incomingUrl.pathname.startsWith("/api/packages/")
  ) {
    const rewrittenUrl = new URL(incomingUrl);
    if (rewrittenUrl.pathname.startsWith("/api/core/packages")) {
      rewrittenUrl.pathname = rewrittenUrl.pathname.replace(/^\/api\/core\/packages/, "/api/packages");
    }
    const forwarded = new Request(rewrittenUrl.toString(), request);
    return handleUnifiedPackagesRequest(forwarded, {
      ...env,
      PACKAGES_DB: env.CORE_DB,
      PACKAGES_UNIFIED_CORE: "true",
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    });
  }

  const url = new URL(request.url);
  const route = match(url, request.method);
  if (!route) throw new AppError(404, "core_api:not_found");

  const rawContentRoute = route.name === "file:content";
  const body =
    request.method === "GET" || request.method === "DELETE" || rawContentRoute ? {} : await readJson(request);
  const allowGuest = isPublicRoute(route, request.method);
  const ctx = await actor(request, env, body, allowGuest, {
    touchLogin: route.name === "auth:me",
    allowBlockedAccount: route.name === "auth:me",
  });
  if (rawContentRoute) {
    const fileMetadata = await assertFileAccess(ctx, route.id, request.method === "PUT");
    const response = request.method === "PUT"
      ? await putFileContent(ctx.coreDb, ctx.salonId, route.id, request, env, {
          maxBytes: cleanText(fileMetadata.category) === "employee_request" ? 10 * 1024 * 1024 : 0,
        })
      : await getFileContent(ctx.coreDb, ctx.salonId, route.id, env);
    if (response instanceof Response) {
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    }
    return jsonResponse(request, env, 200, { ok: true, data: response });
  }
  const data = await dispatch(
    ctx,
    route,
    request.method,
    body,
    Object.fromEntries(url.searchParams.entries()),
    env
  );

  return jsonResponse(request, env, 200, { ok: true, data });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const normalized = normalizeError(error);
      return jsonResponse(request, env, normalized.status, {
        ok: false,
        error: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      });
    }
  },
  async scheduled(event, env, ctx) {
    const salonId = cleanText(env.SALON_ID) || "main";
    if (event?.cron === "*/5 * * * *") {
      ctx.waitUntil(
        markClosedCheckInWindowsAbsent(env.CORE_DB, env.ATTENDANCE_DB, salonId)
      );
      return;
    }
    ctx.waitUntil(Promise.all([
      expireClientPackagesD1({ ...env, PACKAGES_DB: env.CORE_DB }),
      notifyOverdueEmployeeRequests(env.CORE_DB, salonId),
    ]));
  },
};
