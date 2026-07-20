// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication token verification.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { normalizeError, AppError } from './errors.js';
import { clearActorRoleCache, resolveActorRole, verifyFirebaseIdToken } from './auth.js';
import { handleRequest, jsonResponse } from './routes.js';
import { __testD1, expireClientPackagesD1 } from './d1.js';

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
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(expireClientPackagesD1(env));
  },
};

export const __test = {
  AppError,
  verifyFirebaseIdToken,
  resolveActorRole,
  clearActorRoleCache,
  handleRequest,
  __testD1,
};
