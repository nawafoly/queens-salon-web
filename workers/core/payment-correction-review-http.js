// Core D1 only: disabled-by-default, read-only correction impact review.
// This route intentionally has NO proposal creation or APPLY mutation endpoint.
import { getAuthContext } from './auth-context.js';
import { cleanText } from './d1.js';
import { AppError, normalizeError } from './errors.js';
import { requirePermission } from './repositories/accounts.js';
import { previewPaymentCorrectionImpact } from './repositories/payment-correction-impact.js';

const ROOT = '/api/core/payment-corrections';
const ENABLED_VALUE = 'true';
const REQUIRED_PERMISSIONS = [
  'income.view',
  'bookings.payment.manage',
  'bookings.day_audit.manage',
];

export function isPaymentCorrectionReviewRequest(request) {
  const path = new URL(request.url).pathname;
  return path === ROOT || path.startsWith(`${ROOT}/`);
}

function corsHeaders(request, env) {
  const origin = cleanText(request.headers.get('Origin'));
  const allowed = new Set(
    cleanText(env.ALLOWED_ORIGINS)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  return {
    ...(origin && allowed.has(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, env, status, payload, requestId) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      ...corsHeaders(request, env),
    },
  });
}

/**
 * Review is OFF unless the operator explicitly sets
 * FINANCE_CORRECTION_REVIEW_ENABLED=true.
 * Dependencies are injectable for isolated route/security regression tests,
 * not controlled by HTTP callers.
 */
export async function handlePaymentCorrectionReviewRequest(
  request,
  env,
  { authContext = getAuthContext, previewImpact = previewPaymentCorrectionImpact } = {}
) {
  const requestId = cleanText(request.headers.get('X-Request-Id')) || crypto.randomUUID();

  // Fail closed before authentication/SQL when not deliberately enabled.
  if (env.FINANCE_CORRECTION_REVIEW_ENABLED !== ENABLED_VALUE) {
    return json(request, env, 404, { ok: false, error: 'core_api:not_found' }, requestId);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'X-Request-Id': requestId, ...corsHeaders(request, env) },
    });
  }

  try {
    const path = new URL(request.url).pathname;
    const match = /^\/api\/core\/payment-corrections\/proposals\/([a-zA-Z0-9._:-]{1,180})\/impact$/.exec(path);
    if (!match) {
      throw new AppError(404, 'core_api:not_found');
    }
    if (request.method !== 'GET') {
      throw new AppError(405, 'core_api:method_not_allowed');
    }

    const ctx = await authContext(request, env);
    if (!ctx.user || !ctx.identity?.uid) {
      throw new AppError(401, 'core_auth:login_required');
    }

    // The admin/owner constraint supplements, rather than replaces, D1 RBAC.
    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw new AppError(403, 'core_auth:missing_permission');
    }
    for (const permission of REQUIRED_PERMISSIONS) {
      requirePermission(ctx, permission);
    }

    // Tenant must come only from authenticated Core context, never the URL.
    const data = await previewImpact(ctx.coreDb, ctx.salonId, match[1]);

    return json(request, env, 200, { ok: true, data }, requestId);
  } catch (error) {
    const normalized = normalizeError(error);
    return json(request, env, normalized.status, {
      ok: false,
      error: normalized.code,
      message: normalized.message,
    }, requestId);
  }
}
