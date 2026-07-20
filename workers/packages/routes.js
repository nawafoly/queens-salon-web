// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication and the signed-in user's own role lookup.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { AppError } from './errors.js';
import { authenticateRequest, resolveActorContext } from './auth.js';
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
  listPackageCatalogD1,
  listMyPackageCatalogD1,
  createPackageCatalogD1,
  updatePackageCatalogD1,
  deletePackageCatalogD1,
  adjustClientPackageD1,
  cancelClientPackageD1,
  restoreBookingSessionD1,
  reapplyBookingSessionD1,
  myWalletD1,
  packagesHealthD1,
  purchasePackageD1,
  redeemPackageD1,
  releasePackageD1,
  reservePackageD1,
  grantClientSessionsAdminD1,
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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
  const auth = await resolveActorContext(env, salonId, identity);
  return {
    identity,
    packagesDb: env.PACKAGES_DB,
    coreDb: env.CORE_DB,
    salonId,
    role: auth.role,
    permissions: auth.permissions,
    user: auth.user,
    employeeLink: auth.employeeLink,
    employeeId: auth.employeeId,
    unifiedCore: env.PACKAGES_UNIFIED_CORE === "true",
  };
}

async function updateClientPackageAdminD1(ctx, data) {
  if (!["owner", "admin", "hr", "reception"].includes(String(ctx.role || "").toLowerCase())) throw new AppError(403, "packages_auth:permission_denied");
  const id = requiredDocumentId(data?.clientPackageId || data?.id, "clientPackageId");
  const current = await ctx.packagesDb.prepare("SELECT * FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1").bind(ctx.salonId, id).first();
  if (!current) throw new AppError(404, "packages_d1:client_package_not_found");
  const packageName = cleanText(data?.packageName ?? current.package_name_snapshot);
  const remaining = Number(data?.remainingSessions ?? current.remaining_sessions);
  if (!packageName) throw new AppError(400, "packages_d1:package_name_required");
  if (!Number.isInteger(remaining) || remaining < 0) throw new AppError(400, "packages_d1:remaining_sessions_invalid");
  const reserved = Number(current.reserved_sessions || 0);
  const used = Number(current.used_sessions || 0);
  const total = remaining + reserved + used;
  const expiresAt = cleanText(data?.expiresAt ?? current.expires_at) || null;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new AppError(400, "packages_d1:expires_at_invalid");
  const requestedStatus = cleanText(data?.status || current.status || "active").toLowerCase();
  const status = ["active", "cancelled", "expired", "exhausted"].includes(requestedStatus) ? requestedStatus : "active";
  const now = new Date().toISOString();
  await ctx.packagesDb.prepare(`UPDATE client_packages SET package_name_snapshot = ?, total_sessions = ?, remaining_sessions = ?, expires_at = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ?`).bind(packageName, total, remaining, expiresAt, status, now, ctx.salonId, id).run();
  return { id, updated: true };
}

async function deleteClientPackageAdminD1(ctx, data) {
  if (!["owner", "admin", "hr", "reception"].includes(String(ctx.role || "").toLowerCase())) throw new AppError(403, "packages_auth:permission_denied");
  const id = requiredDocumentId(data?.clientPackageId || data?.id, "clientPackageId");
  const current = await ctx.packagesDb.prepare("SELECT reserved_sessions FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1").bind(ctx.salonId, id).first();
  if (!current) throw new AppError(404, "packages_d1:client_package_not_found");
  if (Number(current.reserved_sessions || 0) > 0) throw new AppError(409, "packages_d1:package_has_reserved_sessions", "Release reserved sessions before deleting the package");
  // client_packages.id is globally unique. Delete every ledger row pointing to
  // the package even when an older migrated transaction has an incorrect
  // salon_id, otherwise the foreign-key constraint blocks the package delete.
  try {
    await ctx.packagesDb.batch([
      ctx.packagesDb.prepare("DELETE FROM package_transactions WHERE client_package_id = ?").bind(id),
      ctx.packagesDb.prepare("DELETE FROM client_packages WHERE salon_id = ? AND id = ?").bind(ctx.salonId, id),
    ]);
  } catch (error) {
    throw new AppError(409, "packages_d1:client_package_delete_failed", error instanceof Error ? error.message : "Client package delete failed");
  }
  const stillExists = await ctx.packagesDb.prepare("SELECT id FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1").bind(ctx.salonId, id).first();
  if (stillExists) {
    throw new AppError(409, "packages_d1:client_package_delete_failed", "Client package was not deleted");
  }
  return { id, deleted: true };
}

const routes = {
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/health": { d1: packagesHealthD1, public: true },
  // Public catalog and authenticated catalog administration use the same D1 table.
  "GET /api/packages/catalog": { d1: listPackageCatalogD1, public: true },
  "GET /api/packages/my-catalog": { d1: listMyPackageCatalogD1 },
  "GET /api/packages/admin/catalog": { d1: listPackageCatalogD1 },
  "POST /api/packages/admin/catalog": { d1: createPackageCatalogD1 },
  "PATCH /api/packages/admin/catalog": { d1: updatePackageCatalogD1 },
  "DELETE /api/packages/admin/catalog": { d1: deletePackageCatalogD1 },
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
  "POST /api/packages/redemption/cancel": { d1: restoreBookingSessionD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/restore": { d1: restoreBookingSessionD1 },
  "POST /api/packages/redemption/reapply": { d1: reapplyBookingSessionD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/cancel": { d1: cancelClientPackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/adjust": { d1: adjustClientPackageD1 },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/client-wallet": { d1: clientWalletD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/admin/audit-client-identities": { d1: auditClientIdentitiesAdminD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/admin/list-client-packages": { d1: listClientPackagesAdminD1 },
  // D1 ONLY — administrative packages and session dashboard.
  "GET /api/packages/admin/session-dashboard": { d1: sessionDashboardAdminD1 },
  "POST /api/packages/admin/grant-sessions": { d1: grantClientSessionsAdminD1 },
  "PATCH /api/packages/admin/client-package": { d1: updateClientPackageAdminD1 },
  "DELETE /api/packages/admin/client-package": { d1: deleteClientPackageAdminD1 },
  // POST alias avoids browser/proxy inconsistencies with authenticated DELETE
  // requests while retaining the original endpoint for backward compatibility.
  "POST /api/packages/admin/delete-client-package": { d1: deleteClientPackageAdminD1 },
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
  const body = ["GET", "DELETE"].includes(request.method) ? Object.fromEntries(url.searchParams.entries()) : await readJson(request);
  const routeRecord = typeof route === "function" ? { d1: route } : route;
  const handler = routeRecord.d1;
  if (!handler) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  if (!env.PACKAGES_DB) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  const ctx = routeRecord.public
    ? { packagesDb: env.PACKAGES_DB, salonId: getSalonId(body || {}, env), role: "guest", identity: null, unifiedCore: env.PACKAGES_UNIFIED_CORE === "true" }
    : await withActor(request, env, body);
  const data = await handler(ctx, body);
  if (["POST", "PATCH", "DELETE"].includes(request.method) && pathname !== "/api/packages/client-wallet") {
    clearD1WalletRuntimeCaches();
  }
  return jsonResponse(request, env, 200, { ok: true, data });
}
