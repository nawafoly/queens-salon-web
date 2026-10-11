import { getAuthContext } from './auth-context.js';
import { cleanText } from './d1.js';
import { normalizeError } from './errors.js';
import { requirePermission } from './repositories/accounts.js';
import {
  closeDayAudit,
  computeDayAuditSnapshot,
  getDayAuditClosing,
  importLegacyDayAuditClosings,
  listDayAuditClosings,
} from './repositories/day-audit-closings.js';

const DAY_AUDIT_ROOT = '/api/core/day-audit';
const DAY_AUDIT_PERMISSION = 'bookings.day_audit.manage';

export function isDayAuditRequest(request) {
  const path = new URL(request.url).pathname;
  return path === DAY_AUDIT_ROOT || path.startsWith(`${DAY_AUDIT_ROOT}/`);
}

function allowedOrigins(env) {
  return new Set(
    cleanText(env.ALLOWED_ORIGINS)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function corsHeaders(request, env) {
  const origin = cleanText(request.headers.get('Origin'));
  const allowed = allowedOrigins(env);
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Request-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
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

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function actorInfo(ctx) {
  return {
    uid: ctx.identity?.uid || '',
    email: ctx.identity?.claims?.email || ctx.user?.email || '',
    name: ctx.user?.display_name || ctx.identity?.claims?.name || '',
  };
}

export async function handleDayAuditRequest(request, env) {
  const requestId = cleanText(request.headers.get('X-Request-Id')) || crypto.randomUUID();
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'X-Request-Id': requestId, ...corsHeaders(request, env) } });
  }

  try {
    const ctx = await getAuthContext(request, env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = String(request.method || 'GET').toUpperCase();

    if (path === DAY_AUDIT_ROOT && method === 'GET') {
      requirePermission(ctx, DAY_AUDIT_PERMISSION);
      const date = url.searchParams.get('date') || '';
      const [snapshot, closing] = await Promise.all([
        computeDayAuditSnapshot(ctx.coreDb, ctx.salonId, date),
        getDayAuditClosing(ctx.coreDb, ctx.salonId, date),
      ]);
      return json(request, env, 200, { ok: true, data: { snapshot, closing } }, requestId);
    }

    if (path === `${DAY_AUDIT_ROOT}/closings` && method === 'GET') {
      requirePermission(ctx, DAY_AUDIT_PERMISSION);
      const closings = await listDayAuditClosings(ctx.coreDb, ctx.salonId, {
        limit: url.searchParams.get('limit') || 30,
        offset: url.searchParams.get('offset') || 0,
      });
      return json(request, env, 200, { ok: true, data: closings }, requestId);
    }

    if (path === `${DAY_AUDIT_ROOT}/close` && method === 'POST') {
      requirePermission(ctx, DAY_AUDIT_PERMISSION);
      const body = await readBody(request);
      const closing = await closeDayAudit(ctx.coreDb, ctx.salonId, body, actorInfo(ctx));
      return json(request, env, 200, { ok: true, data: closing }, requestId);
    }

    if (path === `${DAY_AUDIT_ROOT}/import-legacy` && method === 'POST') {
      requirePermission(ctx, DAY_AUDIT_PERMISSION);
      const body = await readBody(request);
      const result = await importLegacyDayAuditClosings(ctx.coreDb, ctx.salonId, body, actorInfo(ctx));
      return json(request, env, 200, { ok: true, data: result }, requestId);
    }

    return json(
      request,
      env,
      405,
      { ok: false, error: 'core_api:method_not_allowed', message: 'Method not allowed' },
      requestId
    );
  } catch (error) {
    const normalized = normalizeError(error);
    return json(
      request,
      env,
      normalized.status,
      {
        ok: false,
        error: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      },
      requestId
    );
  }
}
