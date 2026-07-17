// CORE D1 ONLY — do not add Firestore fallback.

import { verifyFirebaseIdToken } from '../packages/auth.js';
import {
  ADMIN_ROLES,
  cleanText,
  requireDb,
  requireRole,
  requiredId,
} from './d1.js';
import { AppError, normalizeError } from './errors.js';
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
} from './repositories/staff.js';
import {
  cancelBooking,
  completeBooking,
  createBooking,
  deleteBooking,
  getBooking,
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
  getHrEmployee,
  listHrEmployees,
  replaceHrSchedules,
  upsertHrEmployee,
} from './repositories/hr-employees.js';
import {
  getAttendanceState,
  listAttendance,
  recordAttendance,
} from './repositories/attendance.js';
import { createLeave, decideLeave, listLeaves } from './repositories/leaves.js';
import { createAbsence, deleteAbsence, listAbsences } from './repositories/absences.js';
import {
  listPayrollEntries,
  listPayrollPeriods,
  upsertPayrollEntry,
  upsertPayrollPeriod,
} from './repositories/payroll.js';
import { getSetting, listSettings, upsertSetting } from './repositories/settings.js';
import {
  deleteAdminProfile,
  listAdminProfiles,
  resolveAssignedRole,
  upsertAdminProfile,
} from './repositories/admin-profiles.js';
import {
  createFileMetadata,
  getFileContent,
  getFileMetadata,
  listFileMetadata,
  putFileContent,
} from './repositories/files.js';

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
      ["services", "staff", "availability", "discounts", "sections", "categories", "settings", "health"].includes(route.name)) ||
    (method === "POST" &&
      ["clients", "bookings", "discount:use"].includes(route.name))
  );
}

async function actor(request, env, data, allowGuest) {
  const db = requireDb(env);
  const sid = salonId(data || {}, env);
  const authorization =
    request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    if (allowGuest) {
      return {
        identity: { uid: "", claims: {} },
        role: "guest",
        salonId: sid,
        coreDb: db,
        guestAccess: true,
      };
    }
    throw new AppError(401, "core_auth:login_required");
  }

  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) {
    throw new AppError(503, "core_auth:project_not_configured");
  }

  const identity = await verifyFirebaseIdToken(
    authorization.slice("Bearer ".length).trim(),
    projectId,
    env
  );
  const requestedRole = cleanText(
    identity.claims?.role ||
      identity.claims?.coreRole ||
      "guest"
  ).toLowerCase();
  const claimRole = [
    "owner",
    "admin",
    "reception",
    "staff",
    "client",
  ].includes(requestedRole)
    ? requestedRole
    : "guest";
  const role = await resolveAssignedRole(db, sid, identity.uid, claimRole);

  return {
    identity,
    role,
    salonId: sid,
    coreDb: db,
    guestAccess: false,
  };
}

function match(url, method) {
  const path = url.pathname;
  const one = (prefix) => {
    if (!path.startsWith(`${prefix}/`)) return "";
    const rest = path.slice(prefix.length + 1);
    return rest && !rest.includes("/") ? rest : "";
  };

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


  const attendanceState = /^\/api\/core\/hr\/attendance\/state\/([^/]+)$/.exec(path);
  if (attendanceState && method === "GET") return { name: "attendance:state", id: attendanceState[1] };
  if (path === "/api/core/hr/attendance/check-in" && method === "POST") return { name: "attendance:check-in" };
  if (path === "/api/core/hr/attendance/check-out" && method === "POST") return { name: "attendance:check-out" };
  const leaveDecision = /^\/api\/core\/hr\/leaves\/([^/]+)\/(approve|reject)$/.exec(path);
  if (leaveDecision && method === "POST") return { name: `leave:${leaveDecision[2]}`, id: leaveDecision[1] };
  const employeeSchedules = /^\/api\/core\/hr\/employees\/([^/]+)\/schedules$/.exec(path);
  if (employeeSchedules && method === "PUT") return { name: "hr-employee:schedules", id: employeeSchedules[1] };
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
    ["attendance", "/api/core/hr/attendance"],
    ["leaves", "/api/core/hr/leaves"],
    ["absences", "/api/core/hr/absences"],
    ["payroll-periods", "/api/core/hr/payroll-periods"],
    ["payroll-entries", "/api/core/hr/payroll-entries"],
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

async function dispatch(ctx, route, method, body, query) {
  const db = ctx.coreDb;
  if (!ctx.guestAccess) requireRole(ctx.role);
  const actorInfo = {
    uid: ctx.identity?.uid || "",
    email: ctx.identity?.claims?.email || "",
    name: ctx.identity?.claims?.name || "",
    role: ctx.role,
  };

  switch (route.name) {
    case "health":
      return { worker: "ok", d1: Boolean(db) };

    case "clients":
      if (method === "GET" && route.id) {
        return getClient(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        return listClients(db, ctx.salonId, query);
      }
      if (method === "POST") {
        return createClient(db, ctx.salonId, body);
      }
      if (method === "PATCH" && route.id) {
        return patchClient(db, ctx.salonId, route.id, body);
      }
      break;

    case "services":
      if (method === "GET") {
        return listServices(db, ctx.salonId, query);
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
        return getStaff(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        return listStaff(db, ctx.salonId, query);
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

    case "bookings":
      if (method === "GET" && route.id) {
        return getBooking(db, ctx.salonId, route.id);
      }
      if (method === "GET") {
        return listBookings(db, ctx.salonId, query);
      }
      if (method === "POST") {
        return createBooking(
          db,
          ctx.salonId,
          body,
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
      if (method === "GET") return listDiscounts(db, ctx.salonId, query);
      if (method === "POST") return createDiscount(db, ctx.salonId, body, actorInfo);
      if (method === "PATCH" && route.id) return patchDiscount(db, ctx.salonId, route.id, body, actorInfo);
      if (method === "DELETE" && route.id) return deleteDiscount(db, ctx.salonId, route.id, actorInfo);
      break;

    case "discount:use":
      return incrementDiscountUsage(db, ctx.salonId, route.id, actorInfo);

    case "sections":
    case "categories": {
      const kind = route.name;
      if (method === "GET") return listCatalogRows(db, ctx.salonId, kind, query);
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
      if (method === "GET") return listAudit(db, ctx.salonId, query);
      if (method === "POST") return recordAudit(db, ctx.salonId, body, actorInfo);
      break;

    case "hr-employees":
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "GET" && route.id) return getHrEmployee(db, ctx.salonId, route.id);
      if (method === "GET") return listHrEmployees(db, ctx.salonId, query);
      if (method === "POST") return upsertHrEmployee(db, ctx.salonId, body, actorInfo);
      if (method === "PATCH" && route.id) return upsertHrEmployee(db, ctx.salonId, { ...body, id: route.id }, actorInfo);
      break;

    case "hr-employee:schedules":
      requireRole(ctx.role, ADMIN_ROLES);
      return replaceHrSchedules(db, ctx.salonId, route.id, body.schedules || []);

    case "attendance":
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "GET") return listAttendance(db, ctx.salonId, query);
      break;

    case "attendance:state":
      return getAttendanceState(db, ctx.salonId, route.id);

    case "attendance:check-in":
      return recordAttendance(db, ctx.salonId, { ...body, type: "check_in" }, actorInfo);

    case "attendance:check-out":
      return recordAttendance(db, ctx.salonId, { ...body, type: "check_out" }, actorInfo);

    case "leaves":
      if (method === "GET") return listLeaves(db, ctx.salonId, query);
      if (method === "POST") return createLeave(db, ctx.salonId, body, actorInfo);
      break;

    case "leave:approve":
      requireRole(ctx.role, ADMIN_ROLES);
      return decideLeave(db, ctx.salonId, route.id, { ...body, status: "approved" }, actorInfo);

    case "leave:reject":
      requireRole(ctx.role, ADMIN_ROLES);
      return decideLeave(db, ctx.salonId, route.id, { ...body, status: "rejected" }, actorInfo);

    case "absences":
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "GET") return listAbsences(db, ctx.salonId, query);
      if (method === "POST") return createAbsence(db, ctx.salonId, body, actorInfo);
      if (method === "DELETE" && route.id) return deleteAbsence(db, ctx.salonId, route.id);
      break;

    case "payroll-periods":
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "GET") return listPayrollPeriods(db, ctx.salonId);
      if (method === "POST") return upsertPayrollPeriod(db, ctx.salonId, body, actorInfo);
      break;

    case "payroll-entries":
      requireRole(ctx.role, ADMIN_ROLES);
      if (method === "GET") return listPayrollEntries(db, ctx.salonId, query);
      if (method === "POST") return upsertPayrollEntry(db, ctx.salonId, body, actorInfo);
      break;

    case "settings": {
      if (method === "GET" && route.id) {
        const setting = await getSetting(db, ctx.salonId, route.id);
        if (ctx.guestAccess && setting && setting.visibility !== "public") throw new AppError(404, "core_settings:not_found");
        return setting;
      }
      if (method === "GET") {
        const settings = await listSettings(db, ctx.salonId, query);
        return ctx.guestAccess ? settings.filter((row) => row.visibility === "public") : settings;
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

    case "files":
      if (method === "GET" && route.id) return getFileMetadata(db, ctx.salonId, route.id);
      if (method === "GET") return listFileMetadata(db, ctx.salonId, query);
      if (method === "POST") return createFileMetadata(db, ctx.salonId, body, actorInfo);
      break;

    default:
      break;
  }

  throw new AppError(405, "core_api:method_not_allowed");
}

export async function handleRequest(request, env) {
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
  const ctx = await actor(request, env, body, allowGuest);
  if (rawContentRoute) {
    const response = request.method === "PUT"
      ? await putFileContent(ctx.coreDb, ctx.salonId, route.id, request, env)
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
    Object.fromEntries(url.searchParams.entries())
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
      });
    }
  },
};
