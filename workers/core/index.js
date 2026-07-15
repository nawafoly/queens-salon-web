// CORE D1 ONLY — do not add Firestore fallback.

import { verifyFirebaseIdToken } from '../packages/auth.js';
import { cleanText, requireDb, requireRole, requiredId } from './d1.js';
import { AppError, normalizeError } from './errors.js';
import { createClient, getClient, listClients, patchClient } from './repositories/clients.js';
import { createService, listServices, patchService } from './repositories/services.js';
import { getStaff, listStaff, patchStaff } from './repositories/staff.js';
import {
  cancelBooking,
  completeBooking,
  createBooking,
  getBooking,
  listBookings,
  patchBooking,
} from './repositories/bookings.js';
import { createInvoice, getInvoice, listInvoices } from './repositories/invoices.js';
import { createPayment, listPayments } from './repositories/payments.js';
import { createExpense, createIncome, listExpenses, listIncome, patchExpense } from './repositories/finance.js';

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "https://queens-salon-web.vercel.app",
  "https://queens-salon-web-gnxk.vercel.app",
]);

function allowedOrigins(env) {
  const configured = cleanText(env.ALLOWED_ORIGINS);
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return new Set(configured.split(",").map((item) => item.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins(env).has(origin)) headers["Access-Control-Allow-Origin"] = origin;
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
  return requiredId(data?.salonId || env.SALON_ID || "main", "salonId");
}

async function actor(request, env, data) {
  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) throw new AppError(503, "core_auth:project_not_configured");
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new AppError(401, "core_auth:login_required");
  const identity = await verifyFirebaseIdToken(authorization.slice("Bearer ".length).trim(), projectId, env);
  const role = cleanText(identity.claims?.role || identity.claims?.coreRole || "guest").toLowerCase();
  return {
    identity,
    role: ["owner", "admin", "reception", "staff", "client"].includes(role) ? role : "guest",
    salonId: salonId(data || {}, env),
    coreDb: requireDb(env),
  };
}

function match(url, method) {
  const path = url.pathname;
  const one = (prefix) => {
    if (!path.startsWith(`${prefix}/`)) return "";
    const rest = path.slice(prefix.length + 1);
    return rest && !rest.includes("/") ? rest : "";
  };
  const bookingAction = /^\/api\/core\/bookings\/([^/]+)\/(complete|cancel)$/.exec(path);
  if (bookingAction && method === "POST") return { name: `booking:${bookingAction[2]}`, id: bookingAction[1] };
  for (const [name, prefix] of [
    ["clients", "/api/core/clients"],
    ["services", "/api/core/services"],
    ["staff", "/api/core/staff"],
    ["bookings", "/api/core/bookings"],
    ["invoices", "/api/core/invoices"],
    ["expenses", "/api/core/expenses"],
  ]) {
    const id = one(prefix);
    if (id) return { name, id };
    if (path === prefix) return { name };
  }
  if (path === "/api/core/payments") return { name: "payments" };
  if (path === "/api/core/income") return { name: "income" };
  return null;
}

async function dispatch(ctx, route, method, body, query) {
  const db = ctx.coreDb;
  requireRole(ctx.role);
  switch (route.name) {
    case "clients":
      if (method === "GET" && route.id) return getClient(db, ctx.salonId, route.id);
      if (method === "GET") return listClients(db, ctx.salonId);
      if (method === "POST") return createClient(db, ctx.salonId, body);
      if (method === "PATCH" && route.id) return patchClient(db, ctx.salonId, route.id, body);
      break;
    case "services":
      if (method === "GET") return listServices(db, ctx.salonId);
      if (method === "POST") return createService(db, ctx.salonId, body);
      if (method === "PATCH" && route.id) return patchService(db, ctx.salonId, route.id, body);
      break;
    case "staff":
      if (method === "GET" && route.id) return getStaff(db, ctx.salonId, route.id);
      if (method === "GET") return listStaff(db, ctx.salonId);
      if (method === "PATCH" && route.id) return patchStaff(db, ctx.salonId, route.id, body);
      break;
    case "bookings":
      if (method === "GET" && route.id) return getBooking(db, ctx.salonId, route.id);
      if (method === "GET") return listBookings(db, ctx.salonId, query);
      if (method === "POST") return createBooking(db, ctx.salonId, body, ctx.identity.uid);
      if (method === "PATCH" && route.id) return patchBooking(db, ctx.salonId, route.id, body);
      break;
    case "booking:complete":
      return completeBooking(db, ctx.salonId, route.id);
    case "booking:cancel":
      return cancelBooking(db, ctx.salonId, route.id, body.reason);
    case "invoices":
      if (method === "GET" && route.id) return getInvoice(db, ctx.salonId, route.id);
      if (method === "GET") return listInvoices(db, ctx.salonId);
      if (method === "POST") return createInvoice(db, ctx.salonId, body);
      break;
    case "payments":
      if (method === "GET") return listPayments(db, ctx.salonId);
      if (method === "POST") return createPayment(db, ctx.salonId, body);
      break;
    case "income":
      if (method === "GET") return listIncome(db, ctx.salonId);
      if (method === "POST") return createIncome(db, ctx.salonId, body);
      break;
    case "expenses":
      if (method === "GET") return listExpenses(db, ctx.salonId);
      if (method === "POST") return createExpense(db, ctx.salonId, body, ctx.identity.uid);
      if (method === "PATCH" && route.id) return patchExpense(db, ctx.salonId, route.id, body);
      break;
    default:
      break;
  }
  throw new AppError(405, "core_api:method_not_allowed");
}

export async function handleRequest(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  const route = match(url, request.method);
  if (!route) throw new AppError(404, "core_api:not_found");
  const body = request.method === "GET" ? {} : await readJson(request);
  const ctx = await actor(request, env, body);
  const data = await dispatch(ctx, route, request.method, body, Object.fromEntries(url.searchParams.entries()));
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
