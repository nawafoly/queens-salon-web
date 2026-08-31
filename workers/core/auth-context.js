import { verifyFirebaseIdToken } from '../packages/auth.js';
import { cleanText, requireDb } from './d1.js';
import { AppError } from './errors.js';
import {
  assertAccountCanAuthenticate,
  getAccountByFirebaseUid,
  getActiveEmployeeLink,
  getEffectivePermissions,
  serializeAuthMe,
  touchAccountLogin,
} from './repositories/accounts.js';

function bearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return '';
  return authorization.slice('Bearer '.length).trim();
}

function requestMetadata(request) {
  return {
    ip:
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      '',
    userAgent: request.headers.get('User-Agent') || '',
  };
}

export async function getAuthContext(request, env, options = {}) {
  const db = requireDb(env);
  const salonId = cleanText(options.salonId || env.SALON_ID || 'main');

  // AUTH_CONTEXT_TENANT_FENCE_V1
  // Every account, permission and employee-link lookup below is scoped by this
  // resolved tenant. Do not permit an empty tenant authority.
  if (!salonId) {
    throw new AppError(
      403,
      'core_auth:tenant_context_required'
    );
  }

  const idToken = bearerToken(request);

  if (!idToken) {
    if (options.allowGuest) {
      return {
        identity: { uid: '', claims: {} },
        user: null,
        role: 'guest',
        permissions: [],
        employeeLink: null,
        employeeId: '',
        salonId,
        coreDb: db,
        guestAccess: true,
        requestMeta: requestMetadata(request),
      };
    }
    throw new AppError(401, 'core_auth:login_required');
  }

  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) throw new AppError(503, 'core_auth:project_not_configured');

  const identity = await verifyFirebaseIdToken(idToken, projectId, env);
  const account = await getAccountByFirebaseUid(db, salonId, identity.uid);

  if (!account) {
    if (options.allowPublicFallback) {
      return {
        identity,
        user: null,
        role: 'guest',
        permissions: [],
        employeeLink: null,
        employeeId: '',
        salonId,
        coreDb: db,
        guestAccess: true,
        requestMeta: requestMetadata(request),
      };
    }
    throw new AppError(403, 'ACCOUNT_NOT_PROVISIONED');
  }

  if (!options.allowBlockedAccount) assertAccountCanAuthenticate(account);

  const [permissions, employeeLink] = await Promise.all([
    getEffectivePermissions(db, salonId, account),
    getActiveEmployeeLink(db, salonId, account.id),
  ]);

  if (options.touchLogin) await touchAccountLogin(db, account.id);

  return {
    identity,
    user: account,
    role: account.primary_role,
    permissions,
    employeeLink,
    employeeId: employeeLink?.employee_id || '',
    salonId,
    coreDb: db,
    guestAccess: false,
    requestMeta: requestMetadata(request),
  };
}

export async function requireAuthenticatedUser(request, env, options = {}) {
  const ctx = await getAuthContext(request, env, options);
  if (!ctx.user) throw new AppError(401, 'core_auth:login_required');
  return ctx;
}

export async function authMe(request, env, salonId) {
  const ctx = await requireAuthenticatedUser(request, env, { salonId, touchLogin: true });
  return serializeAuthMe(ctx.coreDb, ctx.salonId, ctx.user);
}
