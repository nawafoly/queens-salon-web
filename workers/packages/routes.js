import {
  beginIdempotentOperation,
  normalizeOperationId,
  requestFingerprint,
} from '../core/idempotency.js';
import { packageSaleResult } from './sales.js';
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
  ADMIN_ROLES,
  SALES_ROLES,
  cleanText,
  requireCatalogManage,
  requiredDocumentId,
  requireRole,
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
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

const requireSales = (ctx) => requireRole(ctx.role, SALES_ROLES);
const requireAdmin = (ctx) => requireRole(ctx.role, ADMIN_ROLES);
const PACKAGE_EDIT_ROLES = new Set(["owner", "admin", "hr", "reception"]);
function requirePackageEdit(ctx) {
  if (!PACKAGE_EDIT_ROLES.has(ctx.role)) throw new AppError(403, "packages_auth:permission_denied");
}

async function updateClientPackageAdminD1(ctx, data) {
  const id = requiredDocumentId(data?.clientPackageId || data?.id, "clientPackageId");
  const current = await ctx.packagesDb.prepare("SELECT * FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1").bind(ctx.salonId, id).first();
  if (!current) throw new AppError(404, "packages_d1:client_package_not_found");
  const packageName = cleanText(data?.packageName ?? current.package_name_snapshot);
  const remaining = Number(data?.remainingSessions ?? current.remaining_sessions);
  if (!packageName) throw new AppError(400, "packages_d1:package_name_required");
  if (!Number.isInteger(remaining) || remaining < 0) throw new AppError(400, "packages_d1:remaining_sessions_invalid");
  if (remaining !== Number(current.remaining_sessions || 0)) {
    throw new AppError(
      409,
      "packages_d1:balance_adjustment_required",
      "Use the authorized package adjustment operation so the balance change is recorded in the ledger"
    );
  }
  const expiresAt = cleanText(data?.expiresAt ?? current.expires_at) || null;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new AppError(400, "packages_d1:expires_at_invalid");
  const requestedStatus = cleanText(data?.status || current.status || "active").toLowerCase();
  if (requestedStatus !== cleanText(current.status).toLowerCase()) {
    throw new AppError(
      409,
      "packages_d1:status_operation_required",
      "Use the package cancellation or expiry operation so the status change is auditable"
    );
  }
  const now = new Date().toISOString();
  // Metadata edits must never write stale balance or lifecycle fields.
  const result = await ctx.packagesDb.prepare(`UPDATE client_packages
    SET package_name_snapshot = ?, expires_at = ?, updated_at = ?
    WHERE salon_id = ? AND id = ? AND canonical_client_id = ?
      AND total_sessions = ? AND remaining_sessions = ? AND reserved_sessions = ? AND used_sessions = ?
      AND status = ? AND updated_at = ?
      AND package_name_snapshot = ? AND expires_at IS ?`).bind(
    packageName, expiresAt, now, ctx.salonId, id, current.canonical_client_id,
    current.total_sessions, current.remaining_sessions, current.reserved_sessions, current.used_sessions,
    current.status, current.updated_at, current.package_name_snapshot, current.expires_at ?? null
  ).run();
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
    throw new AppError(409, "packages_d1:concurrent_change", "Package changed; refresh and retry");
  }
  return { id, updated: true };
}

async function deleteClientPackageAdminD1(ctx, data) {
  const id = requiredDocumentId(data?.clientPackageId || data?.id, "clientPackageId");
  const current = await ctx.packagesDb.prepare("SELECT * FROM client_packages WHERE salon_id = ? AND id = ? LIMIT 1").bind(ctx.salonId, id).first();
  if (!current) throw new AppError(404, "packages_d1:client_package_not_found");
  if (Number(current.reserved_sessions || 0) > 0) throw new AppError(409, "packages_d1:package_has_reserved_sessions", "Release reserved sessions before deleting the package");
  const ledger = await ctx.packagesDb.prepare(
    "SELECT COUNT(*) AS count FROM package_transactions WHERE client_package_id = ?"
  ).bind(id).first();
  if (
    Number(ledger?.count || 0) > 0 ||
    cleanText(current.invoice_id) ||
    Number(current.used_sessions || 0) > 0
  ) {
    throw new AppError(
      409,
      "packages_d1:package_history_protected",
      "Package history is immutable; cancel the package instead of deleting it"
    );
  }
  try {
    await ctx.packagesDb.prepare(
      "DELETE FROM client_packages WHERE salon_id = ? AND id = ?"
    ).bind(ctx.salonId, id).run();
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
  "POST /api/packages/admin/catalog": { d1: createPackageCatalogD1, authorize: requireCatalogManage },
  "PATCH /api/packages/admin/catalog": { d1: updatePackageCatalogD1, authorize: requireCatalogManage },
  "DELETE /api/packages/admin/catalog": { d1: deletePackageCatalogD1, authorize: requireCatalogManage },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/purchase": { d1: purchasePackageD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redeem": { d1: redeemPackageD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/reserve": { d1: reservePackageD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/release": { d1: releasePackageD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/create": { d1: reservePackageD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/consume": { d1: consumeReservedD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/cancel": { d1: restoreBookingSessionD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/redemption/restore": { d1: restoreBookingSessionD1, authorize: requireSales },
  "POST /api/packages/redemption/reapply": { d1: reapplyBookingSessionD1, authorize: requireSales },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/cancel": { d1: cancelClientPackageD1, authorize: requireAdmin },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/adjust": { d1: adjustClientPackageD1, authorize: requireAdmin },
  // D1 ONLY — do not add Firestore fallback.
  "POST /api/packages/client-wallet": { d1: clientWalletD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/admin/audit-client-identities": { d1: auditClientIdentitiesAdminD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/admin/list-client-packages": { d1: listClientPackagesAdminD1 },
  // D1 ONLY — administrative packages and session dashboard.
  "GET /api/packages/admin/session-dashboard": { d1: sessionDashboardAdminD1 },
  "POST /api/packages/admin/grant-sessions": { d1: grantClientSessionsAdminD1, authorize: requireSales },
  "PATCH /api/packages/admin/client-package": { d1: updateClientPackageAdminD1, authorize: requirePackageEdit },
  "DELETE /api/packages/admin/client-package": { d1: deleteClientPackageAdminD1, authorize: requirePackageEdit },
  // POST alias avoids browser/proxy inconsistencies with authenticated DELETE
  // requests while retaining the original endpoint for backward compatibility.
  "POST /api/packages/admin/delete-client-package": { d1: deleteClientPackageAdminD1, authorize: requirePackageEdit },
  // Backward-compatible alias for older dashboard builds.
  "GET /api/packages/session-dashboard": { d1: sessionDashboardAdminD1 },
  // D1 ONLY — do not add Firestore fallback.
  "GET /api/packages/my-wallet": { d1: myWalletD1 },
};

async function prepareRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api\/core\/packages(?=\/|$)/, "/api/packages").replace(/\/+$/, "");
  const key = `${request.method} ${pathname}`;
  const route = routes[key];
  if (!route) throw new AppError(404, "packages_api:not_found");
  const body = ["GET", "DELETE"].includes(request.method) ? Object.fromEntries(url.searchParams.entries()) : await readJson(request);
  const handler = route.d1;
  if (!handler) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  if (!env.PACKAGES_DB) throw new AppError(503, "packages_d1:not_configured", "Packages D1 database is not configured");
  const ctx = route.public
    ? { packagesDb: env.PACKAGES_DB, salonId: getSalonId(body || {}, env), role: "guest", identity: null, unifiedCore: env.PACKAGES_UNIFIED_CORE === "true" }
    : await withActor(request, env, body);
  route.authorize?.(ctx);
  return { route, handler, ctx, body, pathname };
}

export async function authorizePackageReplay(request, env) {
  if (!/^\/api\/(?:core\/)?packages(?:\/|$)/.test(new URL(request.url).pathname)) return null;
  const { route, ctx, pathname } = await prepareRequest(request.clone(), {
    ...env, PACKAGES_DB: env.CORE_DB, PACKAGES_UNIFIED_CORE: "true",
  });
  if (!route.authorize || !ctx.identity?.uid || !ctx.user?.id) {
    throw new AppError(403, "packages_auth:permission_denied");
  }
  return {
    salonId: ctx.salonId,
    accountId: ctx.user.id,
    uid: ctx.identity.uid,
    ...(pathname === '/api/packages/purchase' ? { settlementVersion: 1 } : {}),
  };
}


async function verifiedPurchaseEvidence(ctx, gate) {
  const reject = () => {
    throw new AppError(
      409, "packages_purchase:unverified_commit"
    );
  };

  let evidence;

  try {
    evidence = JSON.parse(gate.responseBody);
  } catch {
    reject();
  }

  const stored = evidence?.data;

  if (
    gate.status !== 200 ||
    evidence?.ok !== true ||
    stored?.ok !== true ||
    stored.idempotent !== false ||
    stored.settlementStatus !== "paid" ||
    !cleanText(stored.saleReference) ||
    !cleanText(stored.clientPackageId) ||
    !cleanText(stored.invoiceId) ||
    !cleanText(stored.paymentId) ||
    !cleanText(stored.incomeId) ||
    !Number.isSafeInteger(stored.totalHalalas) ||
    stored.totalHalalas <= 0
  ) {
    reject();
  }

  const db = ctx.coreDb;
  const tenant = ctx.salonId;

  const sale = await db.prepare(
    "SELECT * FROM package_sales "+
    "WHERE salon_id=? AND sale_reference=?"
  ).bind(tenant,stored.saleReference).first();

  if (!sale) reject();

  const canonical = packageSaleResult(sale,false);

  if (
    Object.keys(stored).length !== Object.keys(canonical).length ||
    Object.keys(canonical).some(
      key => !Object.is(stored[key],canonical[key])
    )
  ) {
    reject();
  }

  const pkg = await db.prepare(
    "SELECT * FROM client_packages WHERE salon_id=? AND id=?"
  ).bind(tenant,sale.client_package_id).first();

  const movement = await db.prepare(
    "SELECT * FROM package_transactions WHERE salon_id=? AND id=?"
  ).bind(tenant,sale.purchase_transaction_id).first();

  const payment = await db.prepare(
    "SELECT * FROM payments WHERE salon_id=? AND id=?"
  ).bind(tenant,sale.payment_id).first();

  const invoice = await db.prepare(
    "SELECT * FROM invoices WHERE salon_id=? AND id=?"
  ).bind(tenant,sale.invoice_id).first();

  const income = await db.prepare(
    "SELECT * FROM income_entries WHERE salon_id=? AND id=?"
  ).bind(tenant,sale.income_id).first();

  if (
    !pkg ||
    pkg.canonical_client_id !== sale.canonical_client_id ||
    pkg.package_catalog_id !== sale.package_catalog_id ||
    pkg.invoice_id !== sale.invoice_id ||

    !movement ||
    movement.type !== "purchase" ||
    movement.client_package_id !== sale.client_package_id ||
    movement.canonical_client_id !== sale.canonical_client_id ||
    movement.invoice_id !== sale.invoice_id ||
    movement.created_by_uid !== ctx.identity.uid ||
    movement.sessions_delta !== sale.total_sessions ||

    !payment ||
    payment.invoice_id !== sale.invoice_id ||
    payment.idempotency_key !== sale.purchase_transaction_id ||
    payment.amount_halalas !== sale.total_halalas ||
    payment.method !== sale.payment_method ||
    payment.status !== "paid" ||

    !invoice ||
    invoice.invoice_number !== sale.invoice_number ||
    invoice.total_halalas !== sale.total_halalas ||
    invoice.client_id !== payment.client_id ||

    !income ||
    income.payment_id !== sale.payment_id ||
    income.invoice_id !== sale.invoice_id ||
    income.amount_halalas !== sale.total_halalas ||
    income.method !== sale.payment_method ||
    income.source !== "package_purchase"
  ) {
    reject();
  }

  return evidence;
}

async function handleAtomicPackagePurchase(
  request, fingerprintRequest, env, ctx, body
) {
  requireSales(ctx);

  const salonId = ctx.salonId;
  const actorUid = cleanText(ctx.identity?.uid);
  const accountId = cleanText(ctx.user?.id);

  if (!ctx.coreDb || !ctx.unifiedCore) {
    throw new AppError(503,"packages_d1:not_configured");
  }

  if (!salonId || !actorUid || !accountId) {
    throw new AppError(403,"packages_auth:permission_denied");
  }

  for (const tenant of [
    env.SALON_ID, body?.salonId, body?.salon_id
  ]) {
    if (tenant != null && cleanText(tenant) !== salonId) {
      throw new AppError(403,"packages_auth:tenant_conflict");
    }
  }

  const operationId = normalizeOperationId(
    request.headers.get("Idempotency-Key")
  );

  if (!operationId) {
    throw new AppError(400,"core_api:invalid_idempotency_key");
  }

  const fingerprint = await requestFingerprint(
    fingerprintRequest,
    JSON.stringify({
      version:"atomic-package-purchase-v2",
      salonId,
      actorUid,
      accountId
    })
  );

  const requestId = crypto.randomUUID();
  const executionToken = crypto.randomUUID();

  const gate = await beginIdempotentOperation(
    ctx.coreDb,
    salonId,
    operationId,
    fingerprint,
    requestId,
    executionToken
  );

  if (gate.action === "conflict") {
    throw new AppError(409,"core_api:idempotency_key_reused");
  }

  if (gate.action === "in_progress") {
    throw new AppError(409,"core_api:idempotency_in_progress");
  }

  if (gate.action === "replay") {
    const evidence = await verifiedPurchaseEvidence(ctx,gate);
    return jsonResponse(request,env,200,evidence);
  }

  if (gate.action !== "proceed") {
    throw new AppError(409,"packages_purchase:unverified_execution");
  }

  const result = await purchasePackageD1(
    ctx,
    body,
    Object.freeze({
      salonId,
      actorUid,
      accountId,
      operationId,
      fingerprint,
      requestId,
      executionToken
    })
  );

  clearD1WalletRuntimeCaches();

  return jsonResponse(
    request,env,200,{ok:true,data:result}
  );
}

export async function handleRequest(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const fingerprintRequest =
    request.method === "POST" &&
    request.headers.has("Idempotency-Key")
      ? request.clone()
      : null;

  const { handler, ctx, body, pathname } = await prepareRequest(request, env);

  if (
    request.method === "POST" &&
    pathname === "/api/packages/purchase" &&
    fingerprintRequest
  ) {
    return handleAtomicPackagePurchase(
      request,fingerprintRequest,env,ctx,body
    );
  }

  const data = await handler(ctx, body);
  if (["POST", "PATCH", "DELETE"].includes(request.method) && pathname !== "/api/packages/client-wallet") {
    clearD1WalletRuntimeCaches();
  }
  return jsonResponse(request, env, 200, { ok: true, data });
}
