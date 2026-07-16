import { importX509, jwtVerify } from 'jose';
import { AppError } from './errors.js';
import { cleanText, decodeJwtPart, optionalText, salonPath } from './validation.js';

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const VALID_ROLES = new Set(["owner", "admin", "hr", "reception", "staff", "client"]);
const DEFAULT_BOOTSTRAP_OWNER_EMAILS = new Set([
  "nawafaaa0@gmail.com",
  "nawafaaa6@gmail.com",
  "alolayan3@gmail.com",
]);
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const ROLE_CACHE_GUEST_TTL_MS = 30 * 1000;

let firebaseCertificateCache = { certificates: null, expiresAt: 0 };
const actorRoleCache = new Map();

function normalizeRole(value) {
  const role = cleanText(value).toLowerCase();
  if (role === "administrator" || role === "super_admin" || role === "super-admin") return "admin";
  if (role === "owner-role" || role === "malik" || role === "المالك" || role === "مالك") return "owner";
  if (role === "receptionist" || role === "frontdesk" || role === "desk") return "reception";
  if (role === "employee") return "staff";
  return VALID_ROLES.has(role) ? role : "";
}

function bootstrapOwnerEmails(env) {
  const configured = cleanText(env.PACKAGES_BOOTSTRAP_OWNER_EMAILS);
  if (!configured) return DEFAULT_BOOTSTRAP_OWNER_EMAILS;
  return new Set(
    configured
      .split(",")
      .map((email) => cleanText(email).toLowerCase())
      .filter(Boolean)
  );
}

function roleFromClaims(identity) {
  return normalizeRole(identity?.claims?.role || identity?.claims?.packagesRole);
}

function fromDocumentValue(value) {
  if (!value || typeof value !== "object") return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("nullValue" in value) return null;
  return undefined;
}

function documentData(body) {
  const out = {};
  for (const [key, value] of Object.entries(body?.fields || {})) {
    out[key] = fromDocumentValue(value);
  }
  return out;
}

function roleDocumentUrl(projectId, path) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodedPath}`;
}

async function readOwnRoleDocument(projectId, path, idToken) {
  const response = await fetch(roleDocumentUrl(projectId, path), {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (response.status === 404 || response.status === 403) return null;
  if (response.status === 401) throw new AppError(401, "packages_auth:invalid_token");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(
      503,
      "packages_auth:role_lookup_failed",
      body?.error?.message || "Unable to resolve account role"
    );
  }
  return documentData(body);
}

export function clearActorRoleCache() {
  actorRoleCache.clear();
}

/**
 * Resolve authorization from the verified Firebase identity.
 * Package balances and ledgers remain D1-only. This reads only the signed-in
 * user's own Firebase profile when the ID token does not carry a custom role.
 */
export async function resolveActorRole(env, salonId, identity) {
  const email = cleanText(identity?.email || identity?.claims?.email).toLowerCase();
  if (email && bootstrapOwnerEmails(env).has(email)) return "owner";

  const claimRole = roleFromClaims(identity);
  if (claimRole === "owner" || claimRole === "admin") return claimRole;

  const uid = cleanText(identity?.uid);
  const idToken = cleanText(identity?.idToken);
  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!uid || !idToken || !projectId) return claimRole || "client";

  const cacheKey = `${projectId}\u0000${salonId}\u0000${uid}`;
  const cached = actorRoleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  // Match the project's Firestore security model: the signed-in user may read
  // their root users/{uid} document and their root admin_users/{email} document.
  // Salon-scoped paths remain compatibility fallbacks for older data.
  const paths = [
    `users/${uid}`,
    ...(email ? [`admin_users/${email}`] : []),
    salonPath(salonId, "users", uid),
    salonPath(salonId, "admin_users", uid),
    ...(email ? [salonPath(salonId, "admin_users", email)] : []),
  ];

  for (const path of paths) {
    const data = await readOwnRoleDocument(projectId, path, idToken);
    if (!data) continue;
    if (data.active === false || data.disabled === true || data.deleted === true) {
      actorRoleCache.set(cacheKey, { role: "guest", expiresAt: Date.now() + ROLE_CACHE_GUEST_TTL_MS });
      return "guest";
    }
    const role = normalizeRole(data.role || data.roleKey || data.userRole || data.accountRole || data.type);
    if (role) {
      actorRoleCache.set(cacheKey, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
      return role;
    }
  }

  const fallbackRole = claimRole || "client";
  actorRoleCache.set(cacheKey, { role: fallbackRole, expiresAt: Date.now() + ROLE_CACHE_GUEST_TTL_MS });
  return fallbackRole;
}

// Legacy helper retained for migration-only callers.
export async function resolveRole(db, salonId, identity) {
  const snap = await db.getDoc(salonPath(salonId, "users", identity.uid));
  const data = snap.data || {};
  if (data.active === false) return "guest";
  return normalizeRole(data.role || identity.claims?.role) || "guest";
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
