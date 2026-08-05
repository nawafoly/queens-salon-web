import { createRemoteJWKSet, jwtVerify } from "jose";
import { handleAttendanceRequest } from "./attendance-worker.js";

const DEFAULT_FIREBASE_PROJECT_ID = "waves-hotel-dashboard";
const DEFAULT_SALON_ID = "main";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

const FIRESTORE_PROFILE_BACKOFF_MS = 5 * 60 * 1000;
let firestoreProfileBackoffUntil = 0;

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://queens-salon-web.vercel.app",
  "capacitor://localhost",
  "ionic://localhost",
  "https://queens-salon-web-gnxk.vercel.app",
]);

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/queens-salon-web(?:-[a-z0-9-]+)?\.vercel\.app$/i,
];

const KNOWN_ROLES = new Set([
  "owner",
  "admin",
  "hr",
  "reception",
  "accountant",
  "staff",
  "client",
  "guest",
]);

const ROLE_ALIASES = {
  user: "client",
  employee: "staff",
  receptionist: "reception",
  human_resources: "hr",
  "human-resources": "hr",
  "human resources": "hr",
  administrator: "admin",
  super_admin: "admin",
  "super-admin": "admin",
};


const ACTIVE_TRUE_VALUES = new Set([
  "active",
  "enabled",
  "true",
  "1",
  "yes",
]);

const ACTIVE_FALSE_VALUES = new Set([
  "inactive",
  "disabled",
  "archived",
  "deleted",
  "pending",
  "false",
  "0",
  "no",
  "blocked",
]);

const PRIVILEGED_STATUS_FALLBACK_ROLES = new Set(["owner", "admin"]);

const PERMISSION_SCHEMA_VERSION = 3;
const PERMISSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const ATTENDANCE_PERMISSION_KEYS = new Set([
  "attendance.own.view",
  "attendance.view",
  "attendance.records.create",
  "attendance.records.update",
  "attendance.records.delete",
  "attendance.absences.manage",
  "attendance.leaves.manage",
  "attendance.export",
  "attendance.settings.manage",
]);

const ROLE_ATTENDANCE_PERMISSIONS = {
  owner: [...ATTENDANCE_PERMISSION_KEYS],
  admin: [
    "attendance.own.view",
    "attendance.view",
    "attendance.records.create",
    "attendance.records.update",
    "attendance.absences.manage",
    "attendance.leaves.manage",
    "attendance.export",
    "attendance.settings.manage",
  ],
  hr: [
    "attendance.own.view",
    "attendance.view",
    "attendance.records.create",
    "attendance.records.update",
    "attendance.absences.manage",
    "attendance.leaves.manage",
    "attendance.export",
  ],
  reception: ["attendance.own.view", "attendance.view"],
  accountant: ["attendance.view", "attendance.export"],
  staff: ["attendance.own.view"],
  client: [],
  guest: [],
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return withCors(
        json(200, {
          ok: true,
          service: "malikat-attendance",
          firebaseProjectId: getExpectedProjectId(env),
          salonId: getSalonId(env),
          databaseReady: Boolean(env?.ATTENDANCE_DB),
          coreDatabaseReady: Boolean(env?.CORE_DB),
        }),
        request,
        env
      );
    }

    if (!url.pathname.startsWith("/attendance/")) {
      return withCors(
        json(404, {
          ok: false,
          message: "not_found",
        }),
        request,
        env
      );
    }

    if (!env?.ATTENDANCE_DB) {
      return withCors(
        json(500, {
          ok: false,
          message: "missing_attendance_d1_binding",
        }),
        request,
        env
      );
    }

    try {
      const response = await handleAttendanceRequest({
        request,
        url,
        db: env.ATTENDANCE_DB,
        directoryDb: env.CORE_DB || null,
        salonId: getSalonId(env),
        resolveRequesterContext: currentRequest =>
          resolveRequesterContext(currentRequest, env, env.ATTENDANCE_DB),
        fetchFirestoreDocument: args =>
          fetchFirestoreDocument({
            ...args,
            env,
          }),
        queryFirestoreDocuments: args =>
          queryFirestoreDocuments({
            ...args,
            env,
          }),
      });

      return withCors(response, request, env);
    } catch (error) {
      console.error("[attendance] unhandled worker error", error);
      return withCors(
        json(500, {
          ok: false,
          message: "attendance_worker_unhandled_error",
        }),
        request,
        env
      );
    }
  },
};

async function resolveRequesterContext(request, env, db) {
  const idToken = readBearerToken(request);

  if (!idToken) {
    return {
      ok: false,
      response: json(401, {
        ok: false,
        message: "missing_firebase_id_token",
      }),
    };
  }

  const verifiedToken = await verifyFirebaseIdToken(idToken, env);

  if (!verifiedToken.ok) {
    return {
      ok: false,
      response: json(401, {
        ok: false,
        message: "invalid_firebase_id_token",
        detail: verifiedToken.error || null,
      }),
    };
  }

  const tokenPayload = verifiedToken.payload;
  const projectId = verifiedToken.projectId;
  const uid = verifiedToken.uid;
  const email = verifiedToken.email;
  const salonId = getSalonId(env);
  const [d1Identity, cachedPermissionProfile] = await Promise.all([
    loadRequesterAttendanceIdentity(db, uid),
    loadPermissionCache(db, uid),
  ]);

  const [userResult, adminResult] = await Promise.all([
    fetchFirestoreDocument({
      projectId,
      idToken,
      documentPath: `salons/${salonId}/users/${uid}`,
      env,
    }),
    fetchFirestoreDocument({
      projectId,
      idToken,
      documentPath: `salons/${salonId}/admin_users/${uid}`,
      env,
    }),
  ]);

  const userData =
    userResult.ok && userResult.found
      ? userResult.data?.data || {}
      : null;

  const adminData =
    adminResult.ok && adminResult.found
      ? adminResult.data?.data || {}
      : null;

  const firestoreLookupDegraded = !userResult.ok || !adminResult.ok;
  const selectedProfile = selectAuthoritativePermissionProfile({
    userData,
    adminData,
  });
  const authoritativeProfile = selectedProfile?.data || null;
  const tokenRole = normalizeRole(
    tokenPayload?.role || tokenPayload?.roleKey
  );
  const fallbackRole =
    tokenRole !== "guest"
      ? tokenRole
      : d1Identity.employeeDocId
        ? "staff"
        : "guest";

  let runtime;
  let authSource;

  const authoritativeRuntime = authoritativeProfile
    ? createRuntime(authoritativeProfile)
    : null;
  const manualOwnerBootstrap = Boolean(
    cachedPermissionProfile?.isActive &&
      cachedPermissionProfile?.role === "owner" &&
      cachedPermissionProfile?.sources?.cacheSource === "manual-bootstrap"
  );

  if (
    authoritativeRuntime?.isActive &&
    authoritativeRuntime.role === "owner" &&
    !firestoreLookupDegraded
  ) {
    runtime = authoritativeRuntime;
    authSource = "firebase_jwt+firestore_permissions";
    await savePermissionCache(db, {
      uid,
      email,
      runtime,
      source: selectedProfile.source,
    });
  } else if (manualOwnerBootstrap) {
    // Emergency owner cache is UID-bound, short-lived, and created only through D1 CLI.
    // Rebuild the owner runtime instead of trusting serialized permission arrays.
    // Owner always has the complete attendance permission set.
    runtime = {
      ...createVerifiedTokenRuntime("owner"),
      permissionVersion: Math.max(
        PERMISSION_SCHEMA_VERSION,
        Number(cachedPermissionProfile?.permissionVersion || 0) || 0
      ),
      cachedAt: cachedPermissionProfile?.cachedAt || null,
      expiresAt: cachedPermissionProfile?.expiresAt || null,
      sources: {
        permissionCache: true,
        cacheSource: "manual-bootstrap",
      },
    };
    authSource = "firebase_jwt+d1_manual_owner_bootstrap";
  } else if (authoritativeProfile && !firestoreLookupDegraded) {
    runtime = authoritativeRuntime;
    authSource = "firebase_jwt+firestore_permissions";
    await savePermissionCache(db, {
      uid,
      email,
      runtime,
      source: selectedProfile.source,
    });
  } else if (firestoreLookupDegraded && cachedPermissionProfile) {
    runtime = cachedPermissionProfile;
    authSource = "firebase_jwt+d1_permission_cache";
  } else if (authoritativeProfile) {
    runtime = createRuntime(authoritativeProfile);
    authSource = "firebase_jwt+partial_firestore_permissions";
  } else {
    runtime = createVerifiedTokenRuntime(fallbackRole);
    authSource = "firebase_jwt+employee_fallback";

    if (!firestoreLookupDegraded) {
      await deletePermissionCache(db, uid);
    }
  }

  const identityData = {
    ...(userData || {}),
    ...(adminData || {}),
    ...(authoritativeProfile || {}),
  };

  identityData.uid = firstText(identityData.uid, uid);
  identityData.email = firstText(identityData.email, email);
  identityData.role = firstText(identityData.role, runtime.role, fallbackRole);
  identityData.active =
    identityData.active === undefined ? runtime.isActive : identityData.active;
  identityData.employeeProfileEnabled =
    identityData.employeeProfileEnabled === undefined
      ? Boolean(d1Identity.employeeDocId) ||
        ATTENDANCE_FALLBACK_EMPLOYEE_ROLES.has(runtime.role)
      : identityData.employeeProfileEnabled;
  identityData.linkedEmployeeId = firstText(
    userData?.linkedEmployeeId,
    userData?.linkedEmployeeDocId,
    userData?.employeeId,
    adminData?.linkedEmployeeId,
    adminData?.linkedEmployeeDocId,
    adminData?.employeeId,
    d1Identity.employeeDocId,
    uid
  );

  if (
    !normalizeStringArray(identityData.allowedZoneIds).length &&
    d1Identity.lastZoneId
  ) {
    identityData.allowedZoneIds = [d1Identity.lastZoneId];
    identityData.attendanceZoneId = firstText(
      identityData.attendanceZoneId,
      d1Identity.lastZoneId
    );
  }

  return {
    ok: true,
    idToken,
    projectId,
    uid,
    email,
    runtime,
    userData: identityData,
    adminUserData: adminData,
    authSource,
    permissionCache: cachedPermissionProfile
      ? { hit: true, expiresAt: cachedPermissionProfile.expiresAt || null }
      : { hit: false, expiresAt: null },
    firestoreProfileStatus: {
      user: userResult.ok ? (userResult.found ? "found" : "missing") : userResult.error,
      admin: adminResult.ok ? (adminResult.found ? "found" : "missing") : adminResult.error,
    },
  };
}

const ATTENDANCE_FALLBACK_EMPLOYEE_ROLES = new Set([
  "owner",
  "admin",
  "hr",
  "reception",
  "accountant",
  "staff",
]);

function createVerifiedTokenRuntime(role) {
  const normalizedRole = normalizeRole(role);
  const effectivePermissions = resolveAttendancePermissions({
    role: normalizedRole,
    permissions: [],
    permissionOverrides: null,
    permissionVersion: 0,
  });

  return {
    role: normalizedRole,
    isActive: true,
    permissionVersion: 0,
    permissions: effectivePermissions,
    permissionsAllow: effectivePermissions,
    permissionsDeny: [],
    sources: {
      token: true,
    },
  };
}

async function verifyFirebaseIdToken(idToken, env) {
  const expectedProjectId = getExpectedProjectId(env);

  try {
    const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
      algorithms: ["RS256"],
      audience: expectedProjectId,
      issuer: `https://securetoken.google.com/${expectedProjectId}`,
    });

    const uid = cleanText(payload?.user_id || payload?.sub);
    const email = cleanText(payload?.email).toLowerCase();
    const issuedAt = Number(payload?.iat || 0);
    const authTime = Number(payload?.auth_time || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (
      !uid ||
      uid.length > 128 ||
      !Number.isFinite(issuedAt) ||
      issuedAt > nowSeconds + 60 ||
      (authTime && (!Number.isFinite(authTime) || authTime > nowSeconds + 60))
    ) {
      return {
        ok: false,
        error: "invalid_firebase_token_claims",
      };
    }

    return {
      ok: true,
      payload,
      projectId: expectedProjectId,
      uid,
      email,
    };
  } catch (error) {
    return {
      ok: false,
      error: cleanText(error?.code || error?.message) || "firebase_token_verification_failed",
    };
  }
}

async function loadRequesterAttendanceIdentity(db, uid) {
  const cleanUid = cleanText(uid);

  if (!db || !cleanUid) {
    return {
      employeeDocId: "",
      lastZoneId: "",
    };
  }

  try {
    const state = await db
      .prepare(
        `
        SELECT employee_doc_id, last_zone_id
        FROM attendance_state
        WHERE employee_uid = ?
        LIMIT 1
      `
      )
      .bind(cleanUid)
      .first();

    const latestRecord = await db
      .prepare(
        `
        SELECT employee_doc_id, zone_id
        FROM attendance_records
        WHERE employee_uid = ?
        ORDER BY server_time DESC, id DESC
        LIMIT 1
      `
      )
      .bind(cleanUid)
      .first();

    return {
      employeeDocId: firstText(
        state?.employee_doc_id,
        latestRecord?.employee_doc_id
      ),
      lastZoneId: firstText(
        state?.last_zone_id,
        latestRecord?.zone_id
      ),
    };
  } catch (error) {
    console.warn("[attendance] D1 requester identity lookup failed", error);
    return {
      employeeDocId: "",
      lastZoneId: "",
    };
  }
}

async function loadPermissionCache(db, uid) {
  const cleanUid = cleanText(uid);
  if (!db || !cleanUid) return null;

  try {
    const row = await db
      .prepare(
        `
        SELECT uid, email, role, active, permission_version,
               permissions_json, overrides_enabled_json,
               overrides_disabled_json, effective_permissions_json,
               source, cached_at, expires_at
        FROM attendance_permission_cache
        WHERE uid = ?
        LIMIT 1
      `
      )
      .bind(cleanUid)
      .first();

    if (!row) return null;

    const expiresAt = cleanText(row.expires_at);
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
      await deletePermissionCache(db, cleanUid);
      return null;
    }

    const role = normalizeRole(row.role);
    const cachedEffectivePermissions = normalizeAttendancePermissions(
      safeJsonArray(row.effective_permissions_json)
    );
    const permissions =
      role === "owner" || !cachedEffectivePermissions.length
        ? resolveAttendancePermissions({
            role,
            permissions: safeJsonArray(row.permissions_json),
            permissionOverrides: {
              enabled: safeJsonArray(row.overrides_enabled_json),
              disabled: safeJsonArray(row.overrides_disabled_json),
            },
            permissionVersion: Number(row.permission_version || 0) || 0,
          })
        : cachedEffectivePermissions;

    return {
      role,
      isActive:
        Number(row.active) === 1 ||
        PRIVILEGED_STATUS_FALLBACK_ROLES.has(role),
      permissionVersion: Number(row.permission_version || 0) || 0,
      permissions,
      permissionsAllow: permissions,
      permissionsDeny: normalizeAttendancePermissions(
        safeJsonArray(row.overrides_disabled_json)
      ),
      cachedAt: cleanText(row.cached_at) || null,
      expiresAt,
      sources: {
        permissionCache: true,
        cacheSource: cleanText(row.source) || "firestore",
      },
    };
  } catch (error) {
    console.warn("[attendance] permission cache lookup failed", error);
    return null;
  }
}

async function savePermissionCache(db, { uid, email, runtime, source }) {
  const cleanUid = cleanText(uid);
  if (!db || !cleanUid || !runtime) return;

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + PERMISSION_CACHE_TTL_MS
  ).toISOString();

  try {
    await db
      .prepare(
        `
        INSERT INTO attendance_permission_cache (
          uid, email, role, active, permission_version, permissions_json,
          overrides_enabled_json, overrides_disabled_json,
          effective_permissions_json, source, cached_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET
          email = excluded.email,
          role = excluded.role,
          active = excluded.active,
          permission_version = excluded.permission_version,
          permissions_json = excluded.permissions_json,
          overrides_enabled_json = excluded.overrides_enabled_json,
          overrides_disabled_json = excluded.overrides_disabled_json,
          effective_permissions_json = excluded.effective_permissions_json,
          source = excluded.source,
          cached_at = excluded.cached_at,
          expires_at = excluded.expires_at
      `
      )
      .bind(
        cleanUid,
        cleanText(email) || null,
        normalizeRole(runtime.role),
        runtime.isActive ? 1 : 0,
        Number(runtime.permissionVersion || 0) || 0,
        JSON.stringify(normalizeAttendancePermissions(runtime.permissions)),
        "[]",
        JSON.stringify(
          normalizeAttendancePermissions(runtime.permissionsDeny)
        ),
        JSON.stringify(
          normalizeAttendancePermissions(runtime.permissionsAllow)
        ),
        cleanText(source) || "firestore",
        now.toISOString(),
        expiresAt
      )
      .run();
  } catch (error) {
    console.warn("[attendance] permission cache write failed", error);
  }
}

async function deletePermissionCache(db, uid) {
  const cleanUid = cleanText(uid);
  if (!db || !cleanUid) return;

  try {
    await db
      .prepare("DELETE FROM attendance_permission_cache WHERE uid = ?")
      .bind(cleanUid)
      .run();
  } catch (error) {
    console.warn("[attendance] permission cache delete failed", error);
  }
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(cleanText(value) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchFirestoreDocument({
  projectId,
  idToken,
  documentPath,
  env,
}) {
  const expectedProjectId = getExpectedProjectId(env);

  if (Date.now() < firestoreProfileBackoffUntil) {
    return {
      ok: false,
      status: 429,
      error: "firestore_profile_lookup_backoff",
    };
  }

  if (cleanText(projectId) !== expectedProjectId) {
    return {
      ok: false,
      status: 401,
      error: "firebase_project_mismatch",
    };
  }

  const normalizedPath = normalizeFirestoreDocumentPath(
    documentPath,
    env
  );

  const encodedPath = normalizedPath
    .split("/")
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");

  const url =
    `https://firestore.googleapis.com/v1/projects/` +
    `${encodeURIComponent(expectedProjectId)}/databases/(default)/documents/` +
    encodedPath;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${idToken}`,
    },
  });

  const payload = await safeReadJson(response);

  if (response.status === 404) {
    return {
      ok: true,
      found: false,
      data: null,
    };
  }

  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      firestoreProfileBackoffUntil =
        Date.now() + FIRESTORE_PROFILE_BACKOFF_MS;
    }

    return {
      ok: false,
      status: response.status,
      error:
        cleanText(payload?.error?.message) ||
        `firestore_request_failed_${response.status}`,
    };
  }

  return {
    ok: true,
    found: true,
    data: parseFirestoreDocument(payload),
  };
}

async function queryFirestoreDocuments({
  projectId,
  idToken,
  collectionPath,
  filters,
  limit = 5,
  env,
}) {
  const expectedProjectId = getExpectedProjectId(env);

  if (Date.now() < firestoreProfileBackoffUntil) {
    return {
      ok: false,
      status: 429,
      error: "firestore_profile_lookup_backoff",
      documents: [],
    };
  }

  if (cleanText(projectId) !== expectedProjectId) {
    return {
      ok: false,
      status: 401,
      error: "firebase_project_mismatch",
      documents: [],
    };
  }

  const normalizedPath = normalizeFirestoreCollectionPath(
    collectionPath,
    env
  );
  const segments = normalizedPath.split("/").filter(Boolean);
  const collectionId = segments.pop() || "";
  const parentPath = segments
    .map(segment => encodeURIComponent(segment))
    .join("/");
  const queryFilters = Array.isArray(filters) ? filters : [];

  if (!collectionId || !queryFilters.length) {
    return {
      ok: false,
      status: 400,
      error: "invalid_firestore_query",
      documents: [],
    };
  }

  const where =
    queryFilters.length === 1
      ? buildFirestoreFieldFilter(queryFilters[0])
      : {
          compositeFilter: {
            op: "AND",
            filters: queryFilters.map(buildFirestoreFieldFilter),
          },
        };

  const url =
    `https://firestore.googleapis.com/v1/projects/` +
    `${encodeURIComponent(expectedProjectId)}/databases/(default)/documents` +
    `${parentPath ? `/${parentPath}` : ""}:runQuery`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where,
        limit: Math.min(20, Math.max(1, Number(limit || 5))),
      },
    }),
  });

  const payload = await safeReadJson(response);

  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      firestoreProfileBackoffUntil =
        Date.now() + FIRESTORE_PROFILE_BACKOFF_MS;
    }

    return {
      ok: false,
      status: response.status,
      error:
        cleanText(payload?.error?.message) ||
        `firestore_query_failed_${response.status}`,
      documents: [],
    };
  }

  const rows = Array.isArray(payload) ? payload : [];

  return {
    ok: true,
    status: 200,
    documents: rows
      .map(row => row?.document)
      .filter(Boolean)
      .map(parseFirestoreDocument),
  };
}

function buildFirestoreFieldFilter(filter) {
  return {
    fieldFilter: {
      field: { fieldPath: cleanText(filter?.fieldPath) },
      op: cleanText(filter?.op || "EQUAL") || "EQUAL",
      value: toFirestoreQueryValue(filter?.value),
    },
  };
}

function toFirestoreQueryValue(value) {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: cleanText(value) };
}

function normalizeFirestoreDocumentPath(documentPath, env) {
  const cleanPath = cleanText(documentPath)
    .replace(/^\/+|\/+$/g, "");

  if (cleanPath.startsWith("salons/")) {
    return cleanPath;
  }

  const nestedCollections = [
    "users/",
    "admin_users/",
    "employees/",
    "staff_public/",
    "work_zones/",
  ];

  if (
    nestedCollections.some(prefix => cleanPath.startsWith(prefix))
  ) {
    return `salons/${getSalonId(env)}/${cleanPath}`;
  }

  return cleanPath;
}

function normalizeFirestoreCollectionPath(collectionPath, env) {
  const cleanPath = cleanText(collectionPath)
    .replace(/^\/+|\/+$/g, "");

  if (cleanPath.startsWith("salons/")) {
    return cleanPath;
  }

  const nestedCollections = new Set([
    "users",
    "admin_users",
    "employees",
    "staff_public",
    "work_zones",
  ]);

  if (nestedCollections.has(cleanPath)) {
    return `salons/${getSalonId(env)}/${cleanPath}`;
  }

  return cleanPath;
}

const AUTHORITY_ROLE_WEIGHT = {
  owner: 700,
  admin: 600,
  hr: 500,
  reception: 400,
  accountant: 350,
  staff: 300,
  client: 200,
  guest: 100,
};

function selectAuthoritativePermissionProfile({ userData, adminData }) {
  const candidates = [
    userData ? { data: userData, source: "users" } : null,
    adminData ? { data: adminData, source: "admin_users" } : null,
  ].filter(Boolean);

  if (!candidates.length) return null;

  return candidates.sort((left, right) => {
    const leftRole = normalizeRole(left.data?.role || left.data?.roleKey);
    const rightRole = normalizeRole(right.data?.role || right.data?.roleKey);
    const roleDiff =
      (AUTHORITY_ROLE_WEIGHT[rightRole] || 0) -
      (AUTHORITY_ROLE_WEIGHT[leftRole] || 0);

    if (roleDiff !== 0) return roleDiff;

    const versionDiff =
      (Number(right.data?.permissionVersion || 0) || 0) -
      (Number(left.data?.permissionVersion || 0) || 0);

    if (versionDiff !== 0) return versionDiff;

    // admin_users is the transitional authority for privileged internal accounts.
    return right.source === "admin_users" ? 1 : -1;
  })[0];
}

function createRuntime(data) {
  if (!data || typeof data !== "object") {
    return {
      role: "guest",
      isActive: false,
      permissionVersion: 0,
      permissions: [],
      permissionsAllow: [],
      permissionsDeny: [],
      sources: { profile: false },
    };
  }

  const role = normalizeRole(data.role || data.roleKey);
  const permissionVersion = Number(data.permissionVersion || 0) || 0;
  const permissionOverrides = normalizePermissionOverridesObject(
    data.permissionOverrides
  );
  const permissions = resolveAttendancePermissions({
    role,
    permissions: data.permissions,
    permissionOverrides,
    permissionVersion,
    legacyAllow: data.permissionsAllow,
    legacyDeny: data.permissionsDeny,
  });

  return {
    role,
    isActive: resolveActive(data, role),
    permissionVersion,
    permissions,
    permissionsAllow: permissions,
    permissionsDeny: uniqueStrings(
      ...permissionOverrides.disabled,
      ...normalizeStringArray(data.permissionsDeny)
    ),
    sources: { profile: true },
  };
}

function resolveAttendancePermissions({
  role,
  permissions,
  permissionOverrides,
  permissionVersion,
  legacyAllow,
  legacyDeny,
}) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "owner") {
    return [...ATTENDANCE_PERMISSION_KEYS];
  }

  const base = new Set(
    ROLE_ATTENDANCE_PERMISSIONS[normalizedRole] || []
  );
  const stored = normalizeAttendancePermissions(permissions);
  const overrides = normalizePermissionOverridesObject(permissionOverrides);
  const version = Number(permissionVersion || 0) || 0;

  if (
    normalizedRole !== "admin" &&
    version >= PERMISSION_SCHEMA_VERSION &&
    Array.isArray(permissions) &&
    !overrides.enabled.length &&
    !overrides.disabled.length
  ) {
    base.clear();
    stored.forEach(permission => base.add(permission));
  } else {
    overrides.enabled.forEach(permission => base.add(permission));
    overrides.disabled.forEach(permission => base.delete(permission));
  }

  normalizeAttendancePermissions(legacyAllow).forEach(permission =>
    base.add(permission)
  );
  normalizeAttendancePermissions(legacyDeny).forEach(permission =>
    base.delete(permission)
  );

  return [...ATTENDANCE_PERMISSION_KEYS].filter(permission =>
    base.has(permission)
  );
}

function normalizeAttendancePermissions(input) {
  return normalizeStringArray(input).filter(permission =>
    ATTENDANCE_PERMISSION_KEYS.has(permission)
  );
}

function normalizePermissionOverridesObject(input) {
  const value = input && typeof input === "object" ? input : {};
  return {
    enabled: normalizeAttendancePermissions(
      value.enabled || value.added || value.add
    ),
    disabled: normalizeAttendancePermissions(
      value.disabled || value.removed || value.remove
    ),
  };
}

function normalizeRole(value) {
  const role = cleanText(value).toLowerCase();

  if (KNOWN_ROLES.has(role)) {
    return role;
  }

  return ROLE_ALIASES[role] || "guest";
}

function hasExplicitInactiveStatus(data) {
  const status = cleanText(data?.status || data?.accountStatus).toLowerCase();

  return (
    status === "disabled" ||
    status === "archived" ||
    status === "deleted" ||
    status === "pending" ||
    status === "blocked" ||
    data?.disabled === true ||
    data?.archived === true ||
    data?.deleted === true ||
    Boolean(data?.deletedAt) ||
    Boolean(data?.deleted_at)
  );
}

function resolveActive(data, role = "guest") {
  const normalizedRole = normalizeRole(role);
  const status = cleanText(data?.status || data?.accountStatus).toLowerCase();

  if (hasExplicitInactiveStatus(data)) {
    return false;
  }

  if (
    PRIVILEGED_STATUS_FALLBACK_ROLES.has(normalizedRole) &&
    !status
  ) {
    return true;
  }

  for (const value of [
    data?.active,
    data?.isActive,
    data?.status,
  ]) {
    const parsed = parseActiveValue(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return true;
}

function parseActiveValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = cleanText(value).toLowerCase();

  if (!normalized) return null;
  if (ACTIVE_TRUE_VALUES.has(normalized)) return true;
  if (ACTIVE_FALSE_VALUES.has(normalized)) return false;

  return null;
}

function parseFirestoreDocument(document) {
  const name = cleanText(document?.name);
  const segments = name.split("/").filter(Boolean);

  return {
    documentId: segments.at(-1) || "",
    name,
    data: parseFirestoreFields(document?.fields),
  };
}

function parseFirestoreFields(fields) {
  if (!fields || typeof fields !== "object") {
    return {};
  }

  const output = {};

  for (const [key, value] of Object.entries(fields)) {
    output[key] = parseFirestoreValue(value);
  }

  return output;
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return String(value.stringValue || "");
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("timestampValue" in value) return String(value.timestampValue || "");
  if ("nullValue" in value) return null;

  if ("mapValue" in value) {
    return parseFirestoreFields(value.mapValue?.fields);
  }

  if ("arrayValue" in value) {
    const values = Array.isArray(value.arrayValue?.values)
      ? value.arrayValue.values
      : [];

    return values.map(parseFirestoreValue);
  }

  return null;
}

function readBearerToken(request) {
  const header = cleanText(
    request.headers.get("Authorization")
  );

  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

function decodeJwtPayload(token) {
  try {
    const encodedPayload =
      String(token || "").split(".")[1] || "";

    const normalized = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padding =
      normalized.length % 4 === 0
        ? ""
        : "=".repeat(4 - (normalized.length % 4));

    return JSON.parse(atob(normalized + padding));
  } catch {
    return null;
  }
}

function getExpectedProjectId(env) {
  return (
    cleanText(env?.FIREBASE_PROJECT_ID) ||
    DEFAULT_FIREBASE_PROJECT_ID
  );
}

function getSalonId(env) {
  return cleanText(env?.SALON_ID) || DEFAULT_SALON_ID;
}

function getAllowedOrigins(env) {
  const configured = cleanText(env?.CORS_ALLOWED_ORIGINS)
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...configured,
  ]);
}

function resolveCorsOrigin(request, env) {
  const origin = cleanText(request.headers.get("Origin"));

  if (!origin) return "";

  if (getAllowedOrigins(env).has(origin)) {
    return origin;
  }

  return DEFAULT_ALLOWED_ORIGIN_PATTERNS.some(pattern =>
    pattern.test(origin)
  )
    ? origin
    : "";
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = resolveCorsOrigin(request, env);

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }

  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,Accept"
  );

  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean)
    : [];
}

function uniqueStrings(...values) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean))
  );
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);

    if (text) return text;
  }

  return "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
