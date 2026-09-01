import { changes, cleanText, dbAll, dbRun, nowIso } from './d1.js';
import { getAccountByFirebaseUid } from './repositories/accounts.js';
import { recordAudit } from './repositories/audit.js';

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function verifiedIdentityEmail(identity) {
  return normalizeEmail(identity?.email || identity?.claims?.email);
}

/**
 * Resolve a Core account from a cryptographically verified Firebase identity.
 *
 * Firebase UID remains the primary lookup key. The email fallback is used only
 * after a UID miss and only when exactly one non-deleted Core account has the
 * same normalized email. This repairs legacy/manual UID drift without using
 * Firebase role claims, email domains, Firestore, or browser session data as
 * authorization sources. Core D1 continues to own role/status/permissions.
 */
export async function resolveAccountForVerifiedIdentity(
  db,
  salonId,
  identity,
  requestMeta = {}
) {
  const uid = cleanText(identity?.uid);
  if (!uid) return null;

  const direct = await getAccountByFirebaseUid(db, salonId, uid);
  if (direct) return direct;

  const email = verifiedIdentityEmail(identity);
  if (!email) return null;

  const candidates = await dbAll(
    db,
    `SELECT * FROM app_users
       WHERE salon_id = ?
         AND status <> 'deleted'
         AND deleted_at IS NULL
         AND LOWER(TRIM(COALESCE(email, ''))) = ?
       LIMIT 2`,
    [salonId, email]
  );

  // Never guess when historical data contains more than one normalized match.
  if (candidates.length !== 1) return null;

  const candidate = candidates[0];
  const previousUid = cleanText(candidate.firebase_uid);
  const now = nowIso();

  // Compare-and-swap prevents two concurrent identity repairs from blindly
  // overwriting each other. If another request already repaired to this UID,
  // the read below returns that canonical row.
  let result;
  try {
    result = await dbRun(
      db,
      `UPDATE app_users
          SET firebase_uid = ?, updated_at = ?
        WHERE salon_id = ?
          AND id = ?
          AND COALESCE(firebase_uid, '') = ?`,
      [uid, now, salonId, candidate.id, previousUid]
    );
  } catch (error) {
    // Identity self-healing is a best-effort write. A verified, unique email
    // match is already sufficient to resolve the canonical Core account for
    // this request, so a D1 write failure must not turn authentication into a
    // platform-wide 500. Keep the stale UID visible for a later repair and log
    // the operational failure without exposing token data.
    console.warn('[core-auth] identity reconciliation write failed; using verified email match', {
      salonId,
      accountId: candidate.id,
      message: cleanText(error?.message || error),
    });
    return candidate;
  }

  const repaired = await getAccountByFirebaseUid(db, salonId, uid);
  if (!repaired) return null;

  if (changes(result) > 0) {
    try {
      await recordAudit(
        db,
        salonId,
        {
          action: 'account_identity_reconciled',
          entityType: 'app_user',
          entityId: candidate.id,
          targetUserId: candidate.id,
          description: 'Reconciled Firebase UID from verified identity email after UID lookup miss.',
          source: 'core-auth',
          before: {
            firebaseUid: previousUid,
            email: candidate.email || '',
          },
          after: {
            firebaseUid: uid,
            email: repaired.email || candidate.email || '',
          },
          meta: {
            reason: 'verified_email_uid_reconciliation',
          },
        },
        {
          uid,
          email,
          ip: cleanText(requestMeta?.ip),
          userAgent: cleanText(requestMeta?.userAgent),
        }
      );
    } catch (error) {
      // The canonical identity repair has already succeeded. Do not lock the
      // employee out again solely because audit persistence had a transient
      // failure; surface it to worker logs for operations follow-up.
      console.warn('[core-auth] identity reconciliation audit failed', error);
    }
  }

  return repaired;
}