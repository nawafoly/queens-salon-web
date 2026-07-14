import { normalizeError, AppError } from './errors.js';
import { FirestoreRestClient, fromFirestoreFields, toFirestoreFields } from './firestore-rest.js';
import { verifyFirebaseIdToken } from './auth.js';
import { expireClientPackages } from './cron.js';
import { handleRequest, jsonResponse } from './routes.js';
import {
  adjustRemainingBalance,
  balancesFromDoc,
  buildPurchasedPackageSnapshot,
  cancelPackageBalance,
  consumeOneReservedSession,
  reserveOneSession,
  restoreOneReservedSession,
  transactionId,
} from './validation.js';

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
    ctx.waitUntil(expireClientPackages(env));
  },
};

export const __test = {
  AppError,
  FirestoreRestClient,
  balancesFromDoc,
  reserveOneSession,
  consumeOneReservedSession,
  restoreOneReservedSession,
  adjustRemainingBalance,
  cancelPackageBalance,
  buildPurchasedPackageSnapshot,
  transactionId,
  verifyFirebaseIdToken,
  handleRequest,
  expireClientPackages,
  toFirestoreFields,
  fromFirestoreFields,
};
