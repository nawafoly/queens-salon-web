import { AppError } from './errors.js';
import { authenticateRequest, resolveRole } from './auth.js';
import { FirestoreRestClient } from './firestore-rest.js';
import {
  DEFAULT_ALLOWED_ORIGINS,
  cleanText,
  requiredDocumentId,
} from './validation.js';
import {
  adjustClientPackage,
  clientWallet,
  cancelClientPackage,
  cancelRedemption,
  consumeReserved,
  createRedemptionBooking,
  myWallet,
  purchasePackage,
  restoreRedemption,
} from './transactions.js';

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
  const db = new FirestoreRestClient(env, cleanText(env.FIREBASE_PROJECT_ID));
  const salonId = getSalonId(body || {}, env);
  const role = await resolveRole(db, salonId, identity);
  return { identity, db, salonId, role };
}

const routes = {
  "POST /api/packages/purchase": purchasePackage,
  "POST /api/packages/redemption/create": createRedemptionBooking,
  "POST /api/packages/redemption/consume": consumeReserved,
  "POST /api/packages/redemption/cancel": cancelRedemption,
  "POST /api/packages/redemption/restore": restoreRedemption,
  "POST /api/packages/cancel": cancelClientPackage,
  "POST /api/packages/adjust": adjustClientPackage,
  "POST /api/packages/client-wallet": clientWallet,
  "GET /api/packages/my-wallet": myWallet,
};

export async function handleRequest(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  const handler = routes[key];
  if (!handler) throw new AppError(404, "packages_api:not_found");
  const body = request.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readJson(request);
  const ctx = await withActor(request, env, body);
  const data = await handler(ctx, body);
  return jsonResponse(request, env, 200, { ok: true, data });
}
