// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication and the signed-in user's own role lookup.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { AppError } from './errors.js';
import { authenticateRequest, resolveActorRole } from './auth.js';
import {
  DEFAULT_ALLOWED_ORIGINS,
  cleanText,
  requiredDocumentId,
} from './validation.js';
import {
  auditClientIdentitiesAdminD1,
  clearD1WalletRuntimeCaches,
  clientWalletD1,
  consumeReservedD1,
  listClientPackagesAdminD1,
  myWalletD1,
  packagesHealthD1,
  purchasePackageD1,
  redeemPackageD1,
  releasePackageD1,
  reservePackageD1,
  sessionDashboardAdminD1,
} from './d1.js';

export function allowedOrigins(env) {
  const configured = cleanText(env.ALLOWED_ORIGINS);
  return new Set((configured ? configured.split(",") : DEFAULT_ALLOWED_ORIGINS).map((item) => item.trim()).filter(Boolean));
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins(env).has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function jsonResponse(request, env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

export async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 1024 * 1024) throw new AppError(413, "packages_api:body_too_large");
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "packages_api:invalid_json");
  }
}

export function getSalonId(data, env) {
  return requiredDocumentId(data?.salonId ?? env.SALON_ID ?? "main", "salonId");
}

export async function withActor(request, env, body) {
  const identity = await authenticateRequest(request, env);
  const salonId = getSalonId(body || {}, env);
  if (!env.PACKAGES_DB) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  const role = await resolveActorRole(env, salonId, identity);
  return { identity, packagesDb: env.PACKAGES_DB, salonId, role };
}

function endpointNotMigratedToD1() {
  throw new AppError(501, "packages_d1:endpoint_not_migrated", "This package endpoint has no D1 implementation yet");
}

const routes = {
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/health": { d1: packagesHealthD1, public: true },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/purchase": { d1: purchasePackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redeem": { d1: redeemPackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/reserve": { d1: reservePackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/release": { d1: releasePackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/create": { d1: reservePackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/consume": { d1: consumeReservedD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/cancel": { d1: endpointNotMigratedToD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/restore": { d1: releasePackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/cancel": { d1: endpointNotMigratedToD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/adjust": { d1: endpointNotMigratedToD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/client-wallet": { d1: clientWalletD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/admin/audit-client-identities": { d1: auditClientIdentitiesAdminD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/admin/list-client-packages": { d1: listClientPackagesAdminD1 },
  // D1 ONLY — administrative packages and session dashboard.
  "GET /api/packages/admin/session-dashboard": { d1: sessionDashboardAdminD1 },
  // Backward-compatible alias for older dashboard builds.
  "GET /api/packages/session-dashboard": { d1: sessionDashboardAdminD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/my-wallet": { d1: myWalletD1 },
};

export async function handleRequest(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const key = `${request.method} ${pathname}`;
  const route = routes[key];
  if (!route) throw new AppError(404, "packages_api:not_found");
  const body = request.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readJson(request);
  const routeRecord = typeof route === "function" ? { d1: route } : route;
  const handler = routeRecord.d1;
  if (!handler) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  if (!env.PACKAGES_DB) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  const ctx = routeRecord.public
    ? { packagesDb: env.PACKAGES_DB, salonId: getSalonId(body || {}, env), role: "guest", identity: null }
    : await withActor(request, env, body);
  const data = await handler(ctx, body);
  if (request.method === "POST" && pathname !== "/api/packages/client-wallet") {
    clearD1WalletRuntimeCaches();
  }
  return jsonResponse(request, env, 200, { ok: true, data });
}
