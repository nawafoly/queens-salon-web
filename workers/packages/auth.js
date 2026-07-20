import { importX509, jwtVerify } from 'jose';
import { AppError } from './errors.js';
import { cleanText, decodeJwtPart, optionalText } from './validation.js';

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const VALID_ROLES = new Set(["owner", "admin", "hr", "accountant", "reception", "staff", "client"]);

let firebaseCertificateCache = { certificates: null, expiresAt: 0 };
const actorContextCache = new Map();

function normalizeRole(value) {
  const role = cleanText(value).toLowerCase();
  if (role === "administrator" || role === "super_admin" || role === "super-admin") return "admin";
  if (role === "owner-role" || role === "malik" || role === "المالك" || role === "مالك") return "owner";
  if (role === "receptionist" || role === "frontdesk" || role === "desk") return "reception";
  if (role === "employee") return "staff";
  return VALID_ROLES.has(role) ? role : "";
}

function requireCoreDb(env) {
  if (!env.CORE_DB) {
    throw new AppError(503, "packages_auth:core_db_not_configured", "Core D1 database is not configured");
  }
  return env.CORE_DB;
}

async function dbFirst(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

async function dbAll(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || result || [];
}

function assertAccountCanAuthenticate(account) {
  if (!account) throw new AppError(403, "ACCOUNT_NOT_PROVISIONED");
  if (account.status === "disabled") throw new AppError(403, "ACCOUNT_DISABLED");
  if (account.status === "pending") throw new AppError(403, "ACCOUNT_PENDING");
  if (account.status === "deleted" || account.deleted_at) throw new AppError(403, "ACCOUNT_DELETED");
}

async function loadEffectivePermissions(db, salonId, account) {
  if (normalizeRole(account.primary_role) === "owner") {
    const rows = await dbAll(db, "SELECT permission_key FROM permissions ORDER BY permission_key");
    return rows.map((row) => cleanText(row.permission_key)).filter(Boolean);
  }
  const [roleRows, directRows] = await Promise.all([
    dbAll(db, "SELECT permission_key FROM role_permissions WHERE salon_id = ? AND role_key = ?", [salonId, account.primary_role]),
    dbAll(db, "SELECT permission_key, effect FROM user_permissions WHERE salon_id = ? AND user_id = ?", [salonId, account.id]),
  ]);
  const effective = new Set(roleRows.map((row) => cleanText(row.permission_key)).filter(Boolean));
  for (const row of directRows) {
    const permission = cleanText(row.permission_key);
    if (!permission) continue;
    if (row.effect === "deny") effective.delete(permission);
    else if (row.effect === "allow") effective.add(permission);
  }
  return [...effective].sort();
}

export function clearActorRoleCache() {
  actorContextCache.clear();
}

/**
 * Resolve package authorization from the unified Core D1 account registry.
 * Firebase is used only to verify identity. Roles, status, permissions, and
 * employee linkage are sourced exclusively from Core D1 in production.
 */
export async function resolveActorContext(env, salonId, identity) {
  const uid = cleanText(identity?.uid);
  if (!uid) throw new AppError(401, "packages_auth:login_required");

  // Test tokens are isolated to the worker test environment. Production never
  // trusts custom claims or email allow-lists for authorization.
  if (env.PACKAGES_AUTH_TEST_MODE === "true" && identity?.testMode) {
    const role = normalizeRole(identity?.claims?.role) || "client";
    return {
      user: { id: uid, firebase_uid: uid, primary_role: role, status: "active" },
      role,
      permissions: [],
      employeeLink: null,
      employeeId: "",
    };
  }

  const cacheKey = `${salonId}\u0000${uid}`;
  const cached = actorContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  const db = requireCoreDb(env);
  const account = await dbFirst(
    db,
    "SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ? LIMIT 1",
    [salonId, uid]
  );
  assertAccountCanAuthenticate(account);

  const [permissions, employeeLink] = await Promise.all([
    loadEffectivePermissions(db, salonId, account),
    dbFirst(
      db,
      "SELECT * FROM user_employee_links WHERE salon_id = ? AND user_id = ? AND link_status = 'active' LIMIT 1",
      [salonId, account.id]
    ),
  ]);

  const context = {
    user: account,
    role: normalizeRole(account.primary_role) || "client",
    permissions,
    employeeLink: employeeLink || null,
    employeeId: cleanText(employeeLink?.employee_id),
  };
  actorContextCache.set(cacheKey, { context, expiresAt: Date.now() + 30_000 });
  return context;
}

export async function resolveActorRole(env, salonId, identity) {
  return (await resolveActorContext(env, salonId, identity)).role;
}

export function maxAgeMilliseconds(cacheControl) {
  const match = /max-age=(\d+)/i.exec(cacheControl || "");
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

export async function getFirebaseCertificates() {
  if (firebaseCertificateCache.certificates && firebaseCertificateCache.expiresAt > Date.now() + 30_000) {
    return firebaseCertificateCache.certificates;
  }
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw new AppError(503, "packages_auth:certificate_fetch_failed");
  const certificates = await response.json();
  firebaseCertificateCache = {
    certificates,
    expiresAt: Date.now() + maxAgeMilliseconds(response.headers.get("Cache-Control")),
  };
  return certificates;
}

export async function resolveFirebaseSigningKey(protectedHeader) {
  const kid = cleanText(protectedHeader?.kid);
  if (protectedHeader?.alg !== "RS256" || !kid) throw new AppError(401, "packages_auth:invalid_token_header");
  let certificates = await getFirebaseCertificates();
  let certificate = certificates[kid];
  if (!certificate) {
    firebaseCertificateCache.expiresAt = 0;
    certificates = await getFirebaseCertificates();
    certificate = certificates[kid];
  }
  if (!certificate) throw new AppError(401, "packages_auth:unknown_signing_key");
  return importX509(certificate, "RS256");
}

export async function verifyFirebaseIdToken(token, projectId, env) {
  if (env.PACKAGES_AUTH_TEST_MODE === "true" && token.startsWith("test:")) {
    const [, uid, role = "client", clientId = ""] = token.split(":");
    return { uid, email: `${uid}@test.local`, claims: { role, clientId }, testMode: true };
  }
  if (env.FIREBASE_AUTH_EMULATOR_HOST) {
    try {
      const [, payloadPart] = token.split(".");
      const payload = decodeJwtPart(payloadPart);
      const now = Math.floor(Date.now() / 1000);
      if (payload.aud !== projectId) throw new AppError(401, "packages_auth:invalid_audience");
      if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
        throw new AppError(401, "packages_auth:invalid_issuer");
      }
      if (!cleanText(payload.sub)) throw new AppError(401, "packages_auth:missing_subject");
      if (Number.isFinite(payload.exp) && payload.exp <= now) throw new AppError(401, "packages_auth:token_expired");
      return {
        uid: cleanText(payload.sub),
        email: optionalText(payload.email),
        claims: payload,
        authEmulator: true,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "packages_auth:invalid_emulator_token");
    }
  }
  try {
    const { payload } = await jwtVerify(token, resolveFirebaseSigningKey, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      clockTolerance: 300,
    });
    const now = Math.floor(Date.now() / 1000);
    if (!cleanText(payload.sub)) throw new AppError(401, "packages_auth:invalid_token");
    if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new AppError(401, "packages_auth:invalid_token");
    if (!Number.isFinite(payload.iat) || payload.iat > now + 300) {
      throw new AppError(401, "packages_auth:invalid_token");
    }
    if (!Number.isFinite(payload.auth_time) || payload.auth_time > now + 300) {
      throw new AppError(401, "packages_auth:invalid_token");
    }
    return {
      uid: cleanText(payload.sub),
      email: optionalText(payload.email),
      claims: payload,
    };
  } catch (error) {
    if (error instanceof AppError && error.status >= 500) throw error;
    throw new AppError(401, "packages_auth:invalid_token");
  }
}

export async function authenticateRequest(request, env) {
  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) throw new AppError(503, "packages_auth:project_not_configured");
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new AppError(401, "packages_auth:login_required");
  const idToken = authorization.slice("Bearer ".length).trim();
  const identity = await verifyFirebaseIdToken(idToken, projectId, env);
  return { ...identity, idToken };
}
