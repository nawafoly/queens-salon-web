// CORE D1 ONLY — do not add Firestore fallback.
// Client self-provision: Firebase Auth identity → app_users(client) + clients row.

import {
  cleanText,
  dbFirst,
  dbRun,
  generatedId,
  normalizePhone,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { verifyFirebaseIdToken } from '../../packages/auth.js';
import {
  getAccountByFirebaseUid,
  serializeAccount,
  getAccountPermissionBundle,
  getActiveEmployeeLink,
  serializeEmployeeLink,
} from './accounts.js';
import { resolveSelfClient } from './client-portal.js';

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function isInternalEmail(email) {
  return normalizeEmail(email).endsWith('@malikat.com');
}

function normalizeBirthdate(value) {
  const raw = optionalText(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    throw new AppError(400, 'core_client:invalid_birthdate', 'Birthdate must use YYYY-MM-DD.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getTime() > Date.now()
  ) {
    throw new AppError(400, 'core_client:invalid_birthdate', 'Birthdate is invalid.');
  }
  return raw;
}

async function serializeClientAccount(db, salonId, account, client) {
  const permissionBundle = await getAccountPermissionBundle(db, salonId, account);
  const link = await getActiveEmployeeLink(db, salonId, account.id);
  return {
    user: {
      ...serializeAccount(account, permissionBundle, link),
      employeeLink: serializeEmployeeLink(link),
    },
    client: client
      ? {
          id: client.id,
          name: client.name || '',
          phone: client.phone_normalized || '',
          email: client.email || '',
          city: client.city || '',
          birthdate: client.birthdate || '',
          avatarUrl: client.avatar_url || '',
          membershipId: client.membership_id || '',
          membershipPercent: Number(client.membership_percent || 0),
          vip: Number(client.vip) === 1,
          firebaseUid: client.firebase_uid || '',
        }
      : null,
  };
}

/**
 * Ensure a Firebase-authenticated caller has an active Core client account.
 * Never elevates role above client. Internal @malikat.com emails must be
 * provisioned by an admin (prevents accidental client role for staff).
 */
export async function ensureClientAccount(db, salonId, env, request, data = {}) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    throw new AppError(401, 'core_auth:login_required');
  }
  const idToken = authorization.slice('Bearer '.length).trim();
  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) throw new AppError(503, 'core_auth:project_not_configured');

  const identity = await verifyFirebaseIdToken(idToken, projectId, env);
  const uid = cleanText(identity?.uid);
  if (!uid) throw new AppError(401, 'core_auth:login_required');

  const email = normalizeEmail(data.email || identity?.email || identity?.claims?.email);
  const name =
    cleanText(data.name || data.displayName || identity?.claims?.name || identity?.claims?.displayName) ||
    (email ? email.split('@')[0] : '') ||
    'عميلة';
  const phoneInput =
    cleanText(data.phone) ||
    identity?.claims?.phone_number ||
    identity?.claims?.phone ||
    identity?.claims?.mobile ||
    '';
  const phone = normalizePhone(phoneInput) || null;
  if (cleanText(phoneInput) && !phone) {
    throw new AppError(
      400,
      'core_client:invalid_phone',
      'A valid Saudi mobile number is required.'
    );
  }
  const city = optionalText(data.city) || null;
  const birthdate = normalizeBirthdate(data.birthdate);
  const avatarUrl = optionalText(data.avatarUrl || data.avatar_url) || null;

  if (isInternalEmail(email)) {
    const existingInternal = await getAccountByFirebaseUid(db, salonId, uid);
    if (!existingInternal) {
      throw new AppError(
        403,
        'core_auth:internal_account_required',
        'Internal accounts must be provisioned by an administrator.'
      );
    }
  }

  let account = await getAccountByFirebaseUid(db, salonId, uid);
  const now = nowIso();

  if (!account) {
    // Email collision with a non-client internal account must not be overwritten.
    if (email) {
      const byEmail = await dbFirst(
        db,
        `SELECT * FROM app_users
          WHERE salon_id = ?
            AND status <> 'deleted'
            AND deleted_at IS NULL
            AND LOWER(TRIM(COALESCE(email, ''))) = ?
          LIMIT 1`,
        [salonId, email]
      );
      if (byEmail && cleanText(byEmail.primary_role) !== 'client') {
        throw new AppError(409, 'ACCOUNT_EMAIL_ROLE_CONFLICT');
      }
      if (byEmail && cleanText(byEmail.primary_role) === 'client') {
        await dbRun(
          db,
          `UPDATE app_users
              SET firebase_uid = ?, display_name = COALESCE(NULLIF(display_name, ''), ?),
                  phone = COALESCE(phone, ?), updated_at = ?
            WHERE salon_id = ? AND id = ?`,
          [uid, name, phone, now, salonId, byEmail.id]
        );
        account = await getAccountByFirebaseUid(db, salonId, uid);
      }
    }
  }

  if (!account) {
    const id = requiredId(generatedId('user'), 'accountId');
    await dbRun(
      db,
      `INSERT INTO app_users
        (id, firebase_uid, salon_id, email, phone, display_name, photo_url, primary_role, status,
         email_verified, last_login_at, created_at, updated_at, deleted_at, legacy_source, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'client', 'active', ?, NULL, ?, ?, NULL, 'client_self_register', ?)`,
      [
        id,
        uid,
        salonId,
        email || null,
        phone,
        name,
        avatarUrl,
        identity?.email_verified || identity?.claims?.email_verified ? 1 : 0,
        now,
        now,
        uid,
      ]
    );
    account = await getAccountByFirebaseUid(db, salonId, uid);
  } else if (cleanText(account.primary_role) === 'client') {
    await dbRun(
      db,
      `UPDATE app_users
          SET display_name = COALESCE(NULLIF(?, ''), display_name),
              phone = COALESCE(?, phone),
              photo_url = COALESCE(?, photo_url),
              email = COALESCE(NULLIF(email, ''), ?),
              updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [name, phone, avatarUrl, email || null, now, salonId, account.id]
    );
    account = await getAccountByFirebaseUid(db, salonId, uid);
  }

  const client = await resolveSelfClient(
    db,
    salonId,
    { uid, claims: { email, name, phone_number: phone || '' } },
    { createIfMissing: true }
  );

  if (phone) {
    const duplicatePhone = await dbFirst(
      db,
      "SELECT id FROM clients WHERE salon_id = ? AND phone_normalized = ? AND id <> ? LIMIT 1",
      [salonId, phone, client.id]
    );
    if (duplicatePhone) {
      throw new AppError(
        409,
        'core_client:phone_conflict',
        'Another client already uses this mobile number.'
      );
    }
  }

  // Membership identity/tier are system-owned. Never trust self-registration input.
  const membershipId =
    client.membership_id ||
    `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`;

  await dbRun(
    db,
    `UPDATE clients
        SET name = COALESCE(NULLIF(?, ''), name),
            phone_normalized = COALESCE(?, phone_normalized),
            email = COALESCE(NULLIF(email, ''), ?),
            city = COALESCE(?, city),
            birthdate = COALESCE(?, birthdate),
            avatar_url = COALESCE(?, avatar_url),
            membership_id = COALESCE(NULLIF(membership_id, ''), ?),
            membership_percent = COALESCE(membership_percent, 0),
            updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [
      name,
      phone,
      email || null,
      city,
      birthdate,
      avatarUrl,
      membershipId,
      now,
      salonId,
      client.id,
    ]
  );

  const refreshedClient = await dbFirst(
    db,
    `SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, client.id]
  );

  return serializeClientAccount(db, salonId, account, refreshedClient);
}
