import { importX509, jwtVerify } from 'jose';
import { AppError } from './errors.js';
import { cleanText, decodeJwtPart, optionalText, salonPath } from './validation.js';

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let firebaseCertificateCache = { certificates: null, expiresAt: 0 };

export async function resolveRole(db, salonId, identity) {
  const snap = await db.getDoc(salonPath(salonId, "users", identity.uid));
  const data = snap.data || {};
  if (data.active === false) return "guest";
  const role = cleanText(data.role || identity.claims?.role).toLowerCase();
  if (["owner", "admin", "hr", "reception", "staff", "client"].includes(role)) return role;
  return "guest";
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
  return verifyFirebaseIdToken(authorization.slice("Bearer ".length).trim(), projectId, env);
}
