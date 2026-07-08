import { handleAttendanceRequest } from "./attendance-worker.js";

const DEFAULT_FIREBASE_PROJECT_ID = "waves-hotel-dashboard";
const DEFAULT_SALON_ID = "main";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "capacitor://localhost",
]);

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

const ROLE_PRIORITY = {
  guest: 0,
  client: 1,
  staff: 2,
  reception: 3,
  hr: 4,
  accountant: 5,
  admin: 6,
  owner: 7,
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
  "false",
  "0",
  "no",
  "blocked",
]);

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

    const response = await handleAttendanceRequest({
      request,
      url,
      db: env.ATTENDANCE_DB,
      directoryDb: null,
      resolveRequesterContext: currentRequest =>
        resolveRequesterContext(currentRequest, env),
      fetchFirestoreDocument: args =>
        fetchFirestoreDocument({
          ...args,
          env,
        }),
    });

    return withCors(response, request, env);
  },
};

async function resolveRequesterContext(request, env) {
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

  const tokenPayload = decodeJwtPayload(idToken);
  const projectId = cleanText(tokenPayload?.aud);
  const uid = cleanText(tokenPayload?.user_id || tokenPayload?.sub);
  const email = cleanText(tokenPayload?.email).toLowerCase();
  const issuer = cleanText(tokenPayload?.iss);
  const expiresAt = Number(tokenPayload?.exp || 0);
  const expectedProjectId = getExpectedProjectId(env);

  if (
    !projectId ||
    !uid ||
    projectId !== expectedProjectId ||
    issuer !== `https://securetoken.google.com/${expectedProjectId}` ||
    !Number.isFinite(expiresAt) ||
    expiresAt * 1000 <= Date.now()
  ) {
    return {
      ok: false,
      response: json(401, {
        ok: false,
        message: "invalid_firebase_id_token",
      }),
    };
  }

  const salonId = getSalonId(env);

  const userResult = await fetchFirestoreDocument({
    projectId,
    idToken,
    documentPath: `salons/${salonId}/users/${uid}`,
    env,
  });

  if (!userResult.ok) {
    return {
      ok: false,
      response: json(userResult.status || 403, {
        ok: false,
        message: "firebase_user_lookup_failed",
        detail: userResult.error || null,
      }),
    };
  }

  const adminResult = await fetchFirestoreDocument({
    projectId,
    idToken,
    documentPath: `salons/${salonId}/admin_users/${uid}`,
    env,
  });

  const userData =
    userResult.ok && userResult.found
      ? userResult.data?.data || {}
      : null;

  const adminData =
    adminResult.ok && adminResult.found
      ? adminResult.data?.data || {}
      : null;

  const identityData = {
    ...(adminData || {}),
    ...(userData || {}),
  };

  identityData.linkedEmployeeId = firstText(
    userData?.linkedEmployeeId,
    userData?.linkedEmployeeDocId,
    userData?.employeeId,
    adminData?.linkedEmployeeId,
    adminData?.linkedEmployeeDocId,
    adminData?.employeeId,
    uid
  );

  const runtime = resolveEffectiveRuntime(userData, adminData);

  return {
    ok: true,
    idToken,
    projectId,
    uid,
    email,
    runtime,
    userData: identityData,
    adminUserData: adminData,
  };
}

async function fetchFirestoreDocument({
  projectId,
  idToken,
  documentPath,
  env,
}) {
  const expectedProjectId = getExpectedProjectId(env);

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
    return {
      ok: false,
      status: response.status === 401 ? 401 : 403,
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

function resolveEffectiveRuntime(userData, adminData) {
  const userRuntime = createRuntime(userData);
  const adminRuntime = createRuntime(adminData);
  const runtimes = [userRuntime, adminRuntime];

  const activeRuntimes = runtimes.filter(item => item.isActive);
  const roleCandidates = activeRuntimes.length
    ? activeRuntimes
    : runtimes;

  let role = "guest";
  let priority = ROLE_PRIORITY.guest;

  for (const runtime of roleCandidates) {
    const currentPriority =
      ROLE_PRIORITY[runtime.role] ?? ROLE_PRIORITY.guest;

    if (currentPriority > priority) {
      role = runtime.role;
      priority = currentPriority;
    }
  }

  return {
    role,
    isActive: runtimes.some(item => item.isActive),
    permissionsAllow: uniqueStrings(
      ...(runtimes.flatMap(item => item.permissionsAllow))
    ),
    permissionsDeny: uniqueStrings(
      ...(runtimes.flatMap(item => item.permissionsDeny))
    ),
    sources: {
      user: userRuntime,
      admin: adminRuntime,
    },
  };
}

function createRuntime(data) {
  if (!data || typeof data !== "object") {
    return {
      role: "guest",
      isActive: false,
      permissionsAllow: [],
      permissionsDeny: [],
    };
  }

  return {
    role: normalizeRole(data.role || data.roleKey),
    isActive: resolveActive(data),
    permissionsAllow: normalizeStringArray(
      data.permissionsAllow
    ),
    permissionsDeny: normalizeStringArray(
      data.permissionsDeny
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

function resolveActive(data) {
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

  return getAllowedOrigins(env).has(origin)
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
    "Content-Type,Authorization"
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
