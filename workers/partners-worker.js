import { importX509, jwtVerify } from "jose";

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const PARTNER_STATUSES = new Set(["draft", "active", "suspended", "ended"]);
const PARTNER_CATEGORIES = new Set([
  "hair",
  "makeup",
  "nails",
  "pedicure",
  "lashes",
  "skin",
  "massage",
  "retail",
  "other",
]);
const RESOURCE_TYPES = new Set([
  "hair_station",
  "makeup_station",
  "manicure_station",
  "pedicure_station",
  "lash_bed",
  "private_room",
  "retail_space",
  "custom",
]);
const RESOURCE_STATUSES = new Set([
  "available",
  "reserved",
  "rented",
  "maintenance",
  "inactive",
]);
const CONTRACT_STATUSES = new Set([
  "draft",
  "active",
  "expired",
  "terminated",
  "cancelled",
]);
const BILLING_MODELS = new Set([
  "fixed_rent",
  "revenue_share",
  "hybrid",
  "hourly",
  "daily",
]);
const REVENUE_SHARE_BASES = new Set([
  "gross_before_tax",
  "net_after_discount",
  "collected_amount",
  "net_excluding_tax",
]);
const MEMBER_TYPES = new Set(["owner", "employee", "contractor"]);
const MEMBER_STATUSES = new Set(["active", "inactive", "suspended"]);

let firebaseCertificateCache = {
  certificates: null,
  expiresAt: 0,
};

class AppError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function optionalText(value) {
  const text = cleanText(value);
  return text || null;
}

function lowerEmail(value) {
  const text = cleanText(value).toLowerCase();
  return text || null;
}

function requiredText(value, fieldName) {
  const text = cleanText(value);
  if (!text) {
    throw new AppError(400, `partner_validation:${fieldName}_required`);
  }
  return text;
}

function optionalNumber(value, minimum = 0) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(minimum, numberValue);
}

function optionalPercent(value) {
  const result = optionalNumber(value, 0);
  return result === null ? null : Math.min(100, result);
}

function booleanInt(value, defaultValue = false) {
  if (value === undefined) return defaultValue ? 1 : 0;
  return value === true ? 1 : 0;
}

function cleanStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))];
}

function cleanCategories(value) {
  return cleanStringList(value).filter((item) => PARTNER_CATEGORIES.has(item));
}

function cleanSalonId(value) {
  return cleanText(value) || "main";
}

function nowIso() {
  return new Date().toISOString();
}

function riyadhDateKey(now = new Date()) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Riyadh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(now);

  const read = (type) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value || "";

  return `${read("year")}-${read("month")}-${read("day")}`;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeOperationalProfile(value) {
  const raw = parseJsonObject(value);
  const specialties = cleanStringList(raw.specialties).slice(0, 80);
  const specialtyLabels = cleanStringList(raw.specialtyLabels).slice(0, 80);

  return {
    employeeId: optionalText(raw.employeeId) || undefined,
    department: optionalText(raw.department) || undefined,
    title: optionalText(raw.title) || undefined,
    avatarUrl: optionalText(raw.avatarUrl) || undefined,
    specialties,
    specialtyLabels: specialtyLabels.length ? specialtyLabels : specialties,
    bio: optionalText(raw.bio) || undefined,
    resourceIds: cleanStringList(raw.resourceIds).slice(0, 100),
    contractId: optionalText(raw.contractId) || undefined,
    rating: optionalNumber(raw.rating, 0) ?? undefined,
    reviewsCount: optionalNumber(raw.reviewsCount, 0) ?? undefined,
    syncedAt: optionalText(raw.syncedAt) || undefined,
  };
}

function allowedOrigins(env) {
  return new Set(
    cleanText(env.ALLOWED_ORIGINS)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return allowedOrigins(env).has(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && isOriginAllowed(request, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(request, env, status, payload, requestId) {
  return new Response(JSON.stringify({ ...payload, requestId }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...corsHeaders(request, env),
    },
  });
}

function ok(request, env, data, requestId, status = 200) {
  return jsonResponse(request, env, status, { ok: true, data }, requestId);
}

function fail(request, env, error, requestId) {
  const normalized = normalizeError(error);
  return jsonResponse(
    request,
    env,
    normalized.status,
    { ok: false, error: normalized.code, message: normalized.message },
    requestId
  );
}

function normalizeError(error) {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("UNIQUE constraint failed: partners")) {
    return new AppError(409, "partner_validation:partner_duplicate", message);
  }
  if (message.includes("UNIQUE constraint failed: rental_resources")) {
    return new AppError(409, "partner_validation:resource_code_exists", message);
  }
  if (message.includes("UNIQUE constraint failed: partner_contracts")) {
    return new AppError(409, "partner_validation:contract_number_exists", message);
  }
  if (message.includes("UNIQUE constraint failed: partner_members.user_uid")) {
    return new AppError(409, "partner_validation:account_already_linked", message);
  }
  if (message.includes("partner_validation:")) {
    const code = message.slice(message.indexOf("partner_validation:")).split("\n")[0];
    return new AppError(400, code, message);
  }
  if (message.includes("no such table")) {
    return new AppError(503, "partner_api:migrations_not_applied", message);
  }
  if (message.includes("PARTNERS_DB")) {
    return new AppError(503, "partner_api:d1_not_configured", message);
  }

  console.error("partners-worker unhandled error", error);
  return new AppError(500, "partner_api:internal", message || "Internal error");
}

async function readBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 1024 * 1024) {
    throw new AppError(413, "partner_api:body_too_large");
  }
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "partner_api:invalid_json");
  }
}

function maxAgeMilliseconds(cacheControl) {
  const match = /max-age=(\d+)/i.exec(cacheControl || "");
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

async function getFirebaseCertificates() {
  if (
    firebaseCertificateCache.certificates &&
    firebaseCertificateCache.expiresAt > Date.now() + 30_000
  ) {
    return firebaseCertificateCache.certificates;
  }

  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) {
    throw new AppError(503, "partner_auth:certificate_fetch_failed");
  }
  const certificates = await response.json();
  firebaseCertificateCache = {
    certificates,
    expiresAt:
      Date.now() + maxAgeMilliseconds(response.headers.get("Cache-Control")),
  };
  return certificates;
}

async function resolveFirebaseSigningKey(protectedHeader) {
  const kid = cleanText(protectedHeader?.kid);
  if (protectedHeader?.alg !== "RS256" || !kid) {
    throw new AppError(401, "partner_auth:invalid_token_header");
  }

  let certificates = await getFirebaseCertificates();
  let certificate = certificates[kid];
  if (!certificate) {
    firebaseCertificateCache.expiresAt = 0;
    certificates = await getFirebaseCertificates();
    certificate = certificates[kid];
  }
  if (!certificate) {
    throw new AppError(401, "partner_auth:unknown_signing_key");
  }

  try {
    return await importX509(certificate, "RS256");
  } catch {
    throw new AppError(503, "partner_auth:certificate_import_failed");
  }
}

async function verifyFirebaseIdToken(token, projectId) {
  try {
    const { payload } = await jwtVerify(token, resolveFirebaseSigningKey, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      clockTolerance: 300,
    });

    const now = Math.floor(Date.now() / 1000);
    if (!cleanText(payload.sub)) {
      throw new AppError(401, "partner_auth:missing_subject");
    }
    if (!Number.isFinite(payload.iat) || payload.iat > now + 300) {
      throw new AppError(401, "partner_auth:invalid_issued_at");
    }
    if (!Number.isFinite(payload.auth_time) || payload.auth_time > now + 300) {
      throw new AppError(401, "partner_auth:invalid_auth_time");
    }

    return {
      uid: cleanText(payload.sub),
      email: lowerEmail(payload.email),
      name: optionalText(payload.name),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = cleanText(error?.code);
    if (code === "ERR_JWT_EXPIRED") {
      throw new AppError(401, "partner_auth:token_expired");
    }
    if (
      code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
      code === "ERR_JWS_INVALID" ||
      code === "ERR_JWT_CLAIM_VALIDATION_FAILED"
    ) {
      throw new AppError(401, "partner_auth:invalid_token");
    }
    throw new AppError(401, "partner_auth:invalid_token");
  }
}

function bootstrapAdminEmails(env) {
  return new Set(
    cleanText(env.BOOTSTRAP_ADMIN_EMAILS)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function authenticateRequest(request, env) {
  if (!env.PARTNERS_DB) {
    throw new AppError(503, "partner_api:d1_not_configured");
  }

  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) {
    throw new AppError(503, "partner_auth:project_id_not_configured");
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new AppError(401, "partner_auth:login_required");
  }

  return verifyFirebaseIdToken(
    authorization.slice("Bearer ".length).trim(),
    projectId
  );
}

async function ensureAdminIdentity(env, identity) {
  const admin = await env.PARTNERS_DB.prepare(
    `SELECT uid, email, active FROM partner_admins WHERE uid = ? LIMIT 1`
  )
    .bind(identity.uid)
    .first();

  if (admin && Number(admin.active) === 1) return true;

  if (identity.email && bootstrapAdminEmails(env).has(identity.email)) {
    const timestamp = nowIso();
    await env.PARTNERS_DB.prepare(
      `INSERT INTO partner_admins (uid, email, display_name, active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         active = 1,
         updated_at = excluded.updated_at`
    )
      .bind(identity.uid, identity.email, identity.name, timestamp, timestamp)
      .run();
    return true;
  }

  return false;
}

async function requireAdmin(request, env) {
  const identity = await authenticateRequest(request, env);
  if (await ensureAdminIdentity(env, identity)) return identity;
  throw new AppError(403, "partner_auth:admin_access_required");
}

async function resolvePartnerAccess(env, identity) {
  const memberResult = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partner_members
     WHERE user_uid = ? AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 2`
  )
    .bind(identity.uid)
    .all();

  if (memberResult.results.length === 0) {
    throw new AppError(403, "partner_auth:partner_access_required");
  }
  if (memberResult.results.length > 1) {
    throw new AppError(409, "partner_auth:multiple_partner_memberships");
  }

  const memberRow = memberResult.results[0];
  const partnerRow = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partners WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(memberRow.salon_id, memberRow.partner_id)
    .first();

  if (!partnerRow) {
    throw new AppError(404, "partner_auth:partner_not_found");
  }
  if (partnerRow.status !== "active" && partnerRow.status !== "draft") {
    throw new AppError(403, "partner_auth:partner_inactive");
  }

  return {
    identity,
    memberRow,
    partnerRow,
    salonId: memberRow.salon_id,
    partnerId: memberRow.partner_id,
  };
}

function mapPartner(row) {
  return {
    id: row.id,
    salonId: row.salon_id,
    displayName: row.display_name,
    legalName: row.legal_name || undefined,
    ownerName: row.owner_name,
    ownerUid: row.owner_uid || undefined,
    email: row.email || undefined,
    phone: row.phone || undefined,
    nationalId: row.national_id || undefined,
    commercialRegistration: row.commercial_registration || undefined,
    taxNumber: row.tax_number || undefined,
    businessCategories: parseJsonArray(row.business_categories_json),
    status: row.status,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUid: row.created_by_uid || undefined,
    updatedByUid: row.updated_by_uid || undefined,
  };
}

function mapResource(row) {
  return {
    id: row.id,
    salonId: row.salon_id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    branchId: row.branch_id || undefined,
    floor: row.floor || undefined,
    zone: row.zone || undefined,
    description: row.description || undefined,
    currentPartnerId: row.current_partner_id || undefined,
    currentContractId: row.current_contract_id || undefined,
    equipmentNotes: row.equipment_notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUid: row.created_by_uid || undefined,
    updatedByUid: row.updated_by_uid || undefined,
  };
}

function mapContract(row, resourceIds = []) {
  return {
    id: row.id,
    salonId: row.salon_id,
    partnerId: row.partner_id,
    resourceIds,
    contractNumber: row.contract_number,
    status: row.status,
    billingModel: row.billing_model,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    currency: row.currency,
    fixedRentAmount: row.fixed_rent_amount ?? undefined,
    hourlyRate: row.hourly_rate ?? undefined,
    dailyRate: row.daily_rate ?? undefined,
    partnerSharePercent: row.partner_share_percent ?? undefined,
    salonSharePercent: row.salon_share_percent ?? undefined,
    revenueShareBasis: row.revenue_share_basis || undefined,
    minimumSalonShareAmount: row.minimum_salon_share_amount ?? undefined,
    depositAmount: row.deposit_amount ?? undefined,
    paymentDueDay: row.payment_due_day ?? undefined,
    timeOffMonthlyHours: row.time_off_monthly_hours ?? undefined,
    timeOffMaxHoursPerRolling14Days:
      row.time_off_max_hours_rolling_14_days ?? undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUid: row.created_by_uid || undefined,
    updatedByUid: row.updated_by_uid || undefined,
  };
}

function mapMember(row) {
  return {
    id: row.id,
    salonId: row.salon_id,
    partnerId: row.partner_id,
    memberType: row.member_type,
    status: row.status,
    displayName: row.display_name,
    userUid: row.user_uid || undefined,
    employeeId: row.employee_id || undefined,
    email: row.email || undefined,
    phone: row.phone || undefined,
    canWorkAsProvider: Number(row.can_work_as_provider) === 1,
    canManageTeam: Number(row.can_manage_team) === 1,
    canManageInventory: Number(row.can_manage_inventory) === 1,
    canViewFinancials: Number(row.can_view_financials) === 1,
    operationalProfile: normalizeOperationalProfile(row.operational_profile_json),
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUid: row.created_by_uid || undefined,
    updatedByUid: row.updated_by_uid || undefined,
  };
}

function audit(env, identity, salonId, entityType, entityId, action, payload) {
  return env.PARTNERS_DB.prepare(
    `INSERT INTO partner_audit_logs
      (id, salon_id, actor_uid, actor_email, entity_type, entity_id, action, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    createId("audit"),
    salonId,
    identity.uid,
    identity.email,
    entityType,
    entityId,
    action,
    JSON.stringify(payload ?? {}),
    nowIso()
  );
}

function normalizePartnerInput(input) {
  const status = PARTNER_STATUSES.has(input.status) ? input.status : "draft";
  return {
    displayName: requiredText(input.displayName, "displayName"),
    legalName: optionalText(input.legalName),
    ownerName: requiredText(input.ownerName, "ownerName"),
    ownerUid: optionalText(input.ownerUid),
    email: lowerEmail(input.email),
    phone: optionalText(input.phone),
    nationalId: optionalText(input.nationalId),
    commercialRegistration: optionalText(input.commercialRegistration),
    taxNumber: optionalText(input.taxNumber),
    businessCategories: cleanCategories(input.businessCategories),
    status,
    notes: optionalText(input.notes),
  };
}

function normalizeResourceInput(input) {
  return {
    code: requiredText(input.code, "code").toUpperCase(),
    name: requiredText(input.name, "name"),
    type: RESOURCE_TYPES.has(input.type) ? input.type : "custom",
    status: RESOURCE_STATUSES.has(input.status) ? input.status : "available",
    branchId: optionalText(input.branchId),
    floor: optionalText(input.floor),
    zone: optionalText(input.zone),
    description: optionalText(input.description),
    equipmentNotes: optionalText(input.equipmentNotes),
  };
}

function normalizeMemberInput(input) {
  return {
    partnerId: requiredText(input.partnerId, "partnerId"),
    memberType: MEMBER_TYPES.has(input.memberType) ? input.memberType : "employee",
    status: MEMBER_STATUSES.has(input.status) ? input.status : "active",
    displayName: requiredText(input.displayName, "displayName"),
    userUid: optionalText(input.userUid),
    employeeId: optionalText(input.employeeId),
    email: lowerEmail(input.email),
    phone: optionalText(input.phone),
    canWorkAsProvider: booleanInt(input.canWorkAsProvider, true),
    canManageTeam: booleanInt(input.canManageTeam),
    canManageInventory: booleanInt(input.canManageInventory),
    canViewFinancials: booleanInt(input.canViewFinancials),
    operationalProfile: JSON.stringify(
      normalizeOperationalProfile(input.operationalProfile)
    ),
    notes: optionalText(input.notes),
  };
}

function normalizeContractInput(input) {
  const partnerId = requiredText(input.partnerId, "partnerId");
  const resourceIds = cleanStringList(input.resourceIds);
  const contractNumber = requiredText(input.contractNumber, "contractNumber");
  const status = CONTRACT_STATUSES.has(input.status) ? input.status : "draft";
  const billingModel = BILLING_MODELS.has(input.billingModel)
    ? input.billingModel
    : "fixed_rent";
  const startDate = requiredText(input.startDate, "startDate");
  const endDate = optionalText(input.endDate);
  const fixedRentAmount = optionalNumber(input.fixedRentAmount);
  const hourlyRate = optionalNumber(input.hourlyRate);
  const dailyRate = optionalNumber(input.dailyRate);
  const partnerSharePercent = optionalPercent(input.partnerSharePercent);
  const salonSharePercent = optionalPercent(input.salonSharePercent);
  const revenueShareBasis = REVENUE_SHARE_BASES.has(input.revenueShareBasis)
    ? input.revenueShareBasis
    : null;
  const paymentDueDay = optionalNumber(input.paymentDueDay, 1);
  const timeOffMonthlyHours = optionalNumber(input.timeOffMonthlyHours);
  const timeOffMaxHoursPerRolling14Days = optionalNumber(
    input.timeOffMaxHoursPerRolling14Days
  );

  if (resourceIds.length === 0) {
    throw new AppError(400, "partner_validation:resource_required");
  }
  if (status !== "draft" && status !== "active") {
    throw new AppError(400, "partner_validation:create_contract_status_invalid");
  }
  if (endDate && endDate < startDate) {
    throw new AppError(400, "partner_validation:end_date_before_start_date");
  }
  if (paymentDueDay !== null && (paymentDueDay < 1 || paymentDueDay > 28)) {
    throw new AppError(400, "partner_validation:payment_due_day_invalid");
  }
  if (
    timeOffMonthlyHours !== null &&
    timeOffMaxHoursPerRolling14Days !== null &&
    timeOffMaxHoursPerRolling14Days > timeOffMonthlyHours
  ) {
    throw new AppError(400, "partner_validation:rolling_time_off_exceeds_monthly");
  }

  if (billingModel === "revenue_share" || billingModel === "hybrid") {
    if (partnerSharePercent === null || salonSharePercent === null) {
      throw new AppError(400, "partner_validation:revenue_shares_required");
    }
    if (Math.abs(partnerSharePercent + salonSharePercent - 100) > 0.001) {
      throw new AppError(400, "partner_validation:revenue_shares_must_equal_100");
    }
    if (!revenueShareBasis) {
      throw new AppError(400, "partner_validation:revenue_share_basis_required");
    }
  }
  if ((billingModel === "fixed_rent" || billingModel === "hybrid") && !fixedRentAmount) {
    throw new AppError(400, "partner_validation:fixed_rent_required");
  }
  if (billingModel === "hourly" && !hourlyRate) {
    throw new AppError(400, "partner_validation:hourly_rate_required");
  }
  if (billingModel === "daily" && !dailyRate) {
    throw new AppError(400, "partner_validation:daily_rate_required");
  }

  return {
    partnerId,
    resourceIds,
    contractNumber,
    status,
    billingModel,
    startDate,
    endDate,
    currency: cleanText(input.currency) || "SAR",
    fixedRentAmount,
    hourlyRate,
    dailyRate,
    partnerSharePercent,
    salonSharePercent,
    revenueShareBasis,
    minimumSalonShareAmount: optionalNumber(input.minimumSalonShareAmount),
    depositAmount: optionalNumber(input.depositAmount),
    paymentDueDay,
    timeOffMonthlyHours,
    timeOffMaxHoursPerRolling14Days,
    notes: optionalText(input.notes),
  };
}

async function listPartners(env, salonId) {
  const result = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partners WHERE salon_id = ? ORDER BY display_name COLLATE NOCASE ASC`
  )
    .bind(salonId)
    .all();
  return result.results.map(mapPartner);
}

async function getPartner(env, salonId, id) {
  const row = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partners WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(salonId, id)
    .first();
  return row ? mapPartner(row) : null;
}

async function createPartner(env, salonId, input, identity, withOwner) {
  const partner = normalizePartnerInput(input);
  const partnerId = createId("partner");
  const memberId = createId("member");
  const timestamp = nowIso();

  const statements = [
    env.PARTNERS_DB.prepare(
      `INSERT INTO partners (
        id, salon_id, display_name, legal_name, owner_name, owner_uid, email, phone,
        national_id, commercial_registration, tax_number, business_categories_json,
        status, notes, created_at, updated_at, created_by_uid, updated_by_uid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      partnerId,
      salonId,
      partner.displayName,
      partner.legalName,
      partner.ownerName,
      partner.ownerUid,
      partner.email,
      partner.phone,
      partner.nationalId,
      partner.commercialRegistration,
      partner.taxNumber,
      JSON.stringify(partner.businessCategories),
      partner.status,
      partner.notes,
      timestamp,
      timestamp,
      identity.uid,
      identity.uid
    ),
  ];

  if (withOwner) {
    statements.push(
      env.PARTNERS_DB.prepare(
        `INSERT INTO partner_members (
          id, salon_id, partner_id, member_type, status, display_name, user_uid,
          employee_id, email, phone, can_work_as_provider, can_manage_team,
          can_manage_inventory, can_view_financials, notes, created_at, updated_at,
          created_by_uid, updated_by_uid
        ) VALUES (?, ?, ?, 'owner', 'active', ?, ?, NULL, ?, ?, 1, 1, 1, 1, NULL, ?, ?, ?, ?)`
      ).bind(
        memberId,
        salonId,
        partnerId,
        partner.ownerName,
        partner.ownerUid,
        partner.email,
        partner.phone,
        timestamp,
        timestamp,
        identity.uid,
        identity.uid
      )
    );
  }

  statements.push(
    audit(env, identity, salonId, "partner", partnerId, "create", {
      withOwner,
      displayName: partner.displayName,
    })
  );
  await env.PARTNERS_DB.batch(statements);
  return partnerId;
}

async function listResources(env, salonId) {
  const result = await env.PARTNERS_DB.prepare(
    `SELECT * FROM rental_resources WHERE salon_id = ? ORDER BY code COLLATE NOCASE ASC`
  )
    .bind(salonId)
    .all();
  return result.results.map(mapResource);
}

async function createResource(env, salonId, input, identity) {
  const resource = normalizeResourceInput(input);
  const id = createId("resource");
  const timestamp = nowIso();
  await env.PARTNERS_DB.batch([
    env.PARTNERS_DB.prepare(
      `INSERT INTO rental_resources (
        id, salon_id, code, name, type, status, branch_id, floor, zone, description,
        current_partner_id, current_contract_id, equipment_notes, created_at,
        updated_at, created_by_uid, updated_by_uid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      salonId,
      resource.code,
      resource.name,
      resource.type,
      resource.status,
      resource.branchId,
      resource.floor,
      resource.zone,
      resource.description,
      resource.equipmentNotes,
      timestamp,
      timestamp,
      identity.uid,
      identity.uid
    ),
    audit(env, identity, salonId, "rental_resource", id, "create", {
      code: resource.code,
      name: resource.name,
    }),
  ]);
  return id;
}

async function listContracts(env, salonId) {
  const [contractsResult, linksResult] = await env.PARTNERS_DB.batch([
    env.PARTNERS_DB.prepare(
      `SELECT * FROM partner_contracts WHERE salon_id = ? ORDER BY start_date DESC, created_at DESC`
    ).bind(salonId),
    env.PARTNERS_DB.prepare(
      `SELECT contract_id, resource_id FROM partner_contract_resources
       WHERE salon_id = ? ORDER BY created_at ASC`
    ).bind(salonId),
  ]);

  const resourcesByContract = new Map();
  for (const row of linksResult.results) {
    const current = resourcesByContract.get(row.contract_id) || [];
    current.push(row.resource_id);
    resourcesByContract.set(row.contract_id, current);
  }
  return contractsResult.results.map((row) =>
    mapContract(row, resourcesByContract.get(row.id) || [])
  );
}

async function createContract(env, salonId, input, identity) {
  const contract = normalizeContractInput(input);
  const partner = await env.PARTNERS_DB.prepare(
    `SELECT id, status FROM partners WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(salonId, contract.partnerId)
    .first();
  if (!partner) throw new AppError(404, "partner_validation:partner_not_found");
  if (partner.status === "suspended" || partner.status === "ended") {
    throw new AppError(400, "partner_validation:partner_not_available");
  }
  if (contract.status === "active" && partner.status !== "active") {
    throw new AppError(
      400,
      "partner_validation:active_contract_requires_active_partner"
    );
  }

  const placeholders = contract.resourceIds.map(() => "?").join(",");
  const resourcesResult = await env.PARTNERS_DB.prepare(
    `SELECT id, status, current_partner_id, current_contract_id
     FROM rental_resources
     WHERE salon_id = ? AND id IN (${placeholders})`
  )
    .bind(salonId, ...contract.resourceIds)
    .all();
  if (resourcesResult.results.length !== contract.resourceIds.length) {
    throw new AppError(404, "partner_validation:resource_not_found");
  }
  for (const resource of resourcesResult.results) {
    if (resource.current_partner_id || resource.current_contract_id || resource.status === "rented") {
      throw new AppError(409, "partner_validation:resource_already_assigned");
    }
    if (resource.status === "maintenance" || resource.status === "inactive") {
      throw new AppError(400, "partner_validation:resource_not_available");
    }
  }

  const id = createId("contract");
  const timestamp = nowIso();
  const targetResourceStatus = contract.status === "active" ? "rented" : "reserved";
  const statements = [
    env.PARTNERS_DB.prepare(
      `INSERT INTO partner_contracts (
        id, salon_id, partner_id, contract_number, status, billing_model, start_date,
        end_date, currency, fixed_rent_amount, hourly_rate, daily_rate,
        partner_share_percent, salon_share_percent, revenue_share_basis,
        minimum_salon_share_amount, deposit_amount, payment_due_day,
        time_off_monthly_hours, time_off_max_hours_rolling_14_days, notes,
        created_at, updated_at, created_by_uid, updated_by_uid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      salonId,
      contract.partnerId,
      contract.contractNumber,
      contract.status,
      contract.billingModel,
      contract.startDate,
      contract.endDate,
      contract.currency,
      contract.fixedRentAmount,
      contract.hourlyRate,
      contract.dailyRate,
      contract.partnerSharePercent,
      contract.salonSharePercent,
      contract.revenueShareBasis,
      contract.minimumSalonShareAmount,
      contract.depositAmount,
      contract.paymentDueDay,
      contract.timeOffMonthlyHours,
      contract.timeOffMaxHoursPerRolling14Days,
      contract.notes,
      timestamp,
      timestamp,
      identity.uid,
      identity.uid
    ),
  ];

  for (const resourceId of contract.resourceIds) {
    statements.push(
      env.PARTNERS_DB.prepare(
        `INSERT INTO partner_contract_resources
          (contract_id, resource_id, salon_id, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind(id, resourceId, salonId, timestamp)
    );
    statements.push(
      env.PARTNERS_DB.prepare(
        `UPDATE rental_resources
         SET current_partner_id = ?, current_contract_id = ?, status = ?,
             updated_at = ?, updated_by_uid = ?
         WHERE salon_id = ? AND id = ?`
      ).bind(
        contract.partnerId,
        id,
        targetResourceStatus,
        timestamp,
        identity.uid,
        salonId,
        resourceId
      )
    );
  }
  statements.push(
    audit(env, identity, salonId, "partner_contract", id, "create", {
      contractNumber: contract.contractNumber,
      resourceIds: contract.resourceIds,
      billingModel: contract.billingModel,
    })
  );
  await env.PARTNERS_DB.batch(statements);
  return id;
}

async function listMembers(env, salonId) {
  const result = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partner_members WHERE salon_id = ? ORDER BY display_name COLLATE NOCASE ASC`
  )
    .bind(salonId)
    .all();
  return result.results.map(mapMember);
}

async function createMember(env, salonId, input, identity) {
  const member = normalizeMemberInput(input);
  const partner = await env.PARTNERS_DB.prepare(
    `SELECT id FROM partners WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(salonId, member.partnerId)
    .first();
  if (!partner) throw new AppError(404, "partner_validation:partner_not_found");

  const id = createId("member");
  const timestamp = nowIso();
  await env.PARTNERS_DB.batch([
    env.PARTNERS_DB.prepare(
      `INSERT INTO partner_members (
        id, salon_id, partner_id, member_type, status, display_name, user_uid,
        employee_id, email, phone, can_work_as_provider, can_manage_team,
        can_manage_inventory, can_view_financials, operational_profile_json,
        notes, created_at, updated_at, created_by_uid, updated_by_uid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      salonId,
      member.partnerId,
      member.memberType,
      member.status,
      member.displayName,
      member.userUid,
      member.employeeId,
      member.email,
      member.phone,
      member.canWorkAsProvider,
      member.canManageTeam,
      member.canManageInventory,
      member.canViewFinancials,
      member.operationalProfile,
      member.notes,
      timestamp,
      timestamp,
      identity.uid,
      identity.uid
    ),
    audit(env, identity, salonId, "partner_member", id, "create", {
      partnerId: member.partnerId,
      displayName: member.displayName,
    }),
  ]);
  return id;
}

function buildPatchUpdate(table, id, salonId, patch, fieldDefinitions, identity) {
  const assignments = [];
  const values = [];
  for (const [inputField, definition] of Object.entries(fieldDefinitions)) {
    if (!Object.prototype.hasOwnProperty.call(patch, inputField)) continue;
    const value = definition.transform(patch[inputField]);
    assignments.push(`${definition.column} = ?`);
    values.push(value);
  }
  if (assignments.length === 0) {
    throw new AppError(400, "partner_validation:no_changes");
  }
  assignments.push("updated_at = ?", "updated_by_uid = ?");
  values.push(nowIso(), identity.uid, salonId, id);
  return {
    statement: `${table} SET ${assignments.join(", ")} WHERE salon_id = ? AND id = ?`,
    values,
  };
}

async function updatePartner(env, salonId, id, patch, identity) {
  const update = buildPatchUpdate(
    "UPDATE partners",
    id,
    salonId,
    patch,
    {
      displayName: { column: "display_name", transform: (v) => requiredText(v, "displayName") },
      legalName: { column: "legal_name", transform: optionalText },
      ownerName: { column: "owner_name", transform: (v) => requiredText(v, "ownerName") },
      ownerUid: { column: "owner_uid", transform: optionalText },
      email: { column: "email", transform: lowerEmail },
      phone: { column: "phone", transform: optionalText },
      nationalId: { column: "national_id", transform: optionalText },
      commercialRegistration: { column: "commercial_registration", transform: optionalText },
      taxNumber: { column: "tax_number", transform: optionalText },
      businessCategories: {
        column: "business_categories_json",
        transform: (v) => JSON.stringify(cleanCategories(v)),
      },
      status: {
        column: "status",
        transform: (v) => {
          if (!PARTNER_STATUSES.has(v)) throw new AppError(400, "partner_validation:status_invalid");
          return v;
        },
      },
      notes: { column: "notes", transform: optionalText },
    },
    identity
  );
  const result = await env.PARTNERS_DB.prepare(update.statement).bind(...update.values).run();
  if (!result.meta.changes) throw new AppError(404, "partner_validation:partner_not_found");
  await audit(env, identity, salonId, "partner", id, "update", patch).run();
}

async function updateResource(env, salonId, id, patch, identity) {
  const existing = await env.PARTNERS_DB.prepare(
    `SELECT current_contract_id FROM rental_resources WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(salonId, id)
    .first();
  if (!existing) throw new AppError(404, "partner_validation:resource_not_found");
  if (existing.current_contract_id && Object.prototype.hasOwnProperty.call(patch, "status")) {
    throw new AppError(409, "partner_validation:resource_assignment_managed_by_contract");
  }

  const update = buildPatchUpdate(
    "UPDATE rental_resources",
    id,
    salonId,
    patch,
    {
      code: { column: "code", transform: (v) => requiredText(v, "code").toUpperCase() },
      name: { column: "name", transform: (v) => requiredText(v, "name") },
      type: {
        column: "type",
        transform: (v) => (RESOURCE_TYPES.has(v) ? v : "custom"),
      },
      status: {
        column: "status",
        transform: (v) => {
          if (!RESOURCE_STATUSES.has(v)) throw new AppError(400, "partner_validation:status_invalid");
          return v;
        },
      },
      branchId: { column: "branch_id", transform: optionalText },
      floor: { column: "floor", transform: optionalText },
      zone: { column: "zone", transform: optionalText },
      description: { column: "description", transform: optionalText },
      equipmentNotes: { column: "equipment_notes", transform: optionalText },
    },
    identity
  );
  await env.PARTNERS_DB.prepare(update.statement).bind(...update.values).run();
  await audit(env, identity, salonId, "rental_resource", id, "update", patch).run();
}

async function updateMember(env, salonId, id, patch, identity) {
  const update = buildPatchUpdate(
    "UPDATE partner_members",
    id,
    salonId,
    patch,
    {
      partnerId: { column: "partner_id", transform: (v) => requiredText(v, "partnerId") },
      memberType: {
        column: "member_type",
        transform: (v) => (MEMBER_TYPES.has(v) ? v : "employee"),
      },
      status: {
        column: "status",
        transform: (v) => {
          if (!MEMBER_STATUSES.has(v)) throw new AppError(400, "partner_validation:status_invalid");
          return v;
        },
      },
      displayName: { column: "display_name", transform: (v) => requiredText(v, "displayName") },
      userUid: { column: "user_uid", transform: optionalText },
      employeeId: { column: "employee_id", transform: optionalText },
      email: { column: "email", transform: lowerEmail },
      phone: { column: "phone", transform: optionalText },
      canWorkAsProvider: { column: "can_work_as_provider", transform: (v) => booleanInt(v, true) },
      canManageTeam: { column: "can_manage_team", transform: booleanInt },
      canManageInventory: { column: "can_manage_inventory", transform: booleanInt },
      canViewFinancials: { column: "can_view_financials", transform: booleanInt },
      operationalProfile: {
        column: "operational_profile_json",
        transform: (v) => JSON.stringify(normalizeOperationalProfile(v)),
      },
      notes: { column: "notes", transform: optionalText },
    },
    identity
  );
  const result = await env.PARTNERS_DB.prepare(update.statement).bind(...update.values).run();
  if (!result.meta.changes) throw new AppError(404, "partner_validation:member_not_found");
  await audit(env, identity, salonId, "partner_member", id, "update", patch).run();
}

async function updateContract(env, salonId, id, patch, identity) {
  if (
    Object.prototype.hasOwnProperty.call(patch, "resourceIds") ||
    Object.prototype.hasOwnProperty.call(patch, "partnerId")
  ) {
    throw new AppError(409, "partner_validation:contract_reassignment_not_supported");
  }
  const existing = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partner_contracts WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(salonId, id)
    .first();
  if (!existing) throw new AppError(404, "partner_validation:contract_not_found");

  const releaseStatuses = new Set(["expired", "terminated", "cancelled"]);
  if (patch.status && releaseStatuses.has(patch.status) && !releaseStatuses.has(existing.status)) {
    const timestamp = nowIso();
    await env.PARTNERS_DB.batch([
      env.PARTNERS_DB.prepare(
        `UPDATE partner_contracts SET status = ?, updated_at = ?, updated_by_uid = ?
         WHERE salon_id = ? AND id = ?`
      ).bind(patch.status, timestamp, identity.uid, salonId, id),
      env.PARTNERS_DB.prepare(
        `UPDATE rental_resources
         SET current_partner_id = NULL, current_contract_id = NULL, status = 'available',
             updated_at = ?, updated_by_uid = ?
         WHERE salon_id = ? AND current_contract_id = ?`
      ).bind(timestamp, identity.uid, salonId, id),
      audit(env, identity, salonId, "partner_contract", id, "close", {
        status: patch.status,
      }),
    ]);
    const remainingPatch = { ...patch };
    delete remainingPatch.status;
    if (Object.keys(remainingPatch).length === 0) return;
    patch = remainingPatch;
  }

  const update = buildPatchUpdate(
    "UPDATE partner_contracts",
    id,
    salonId,
    patch,
    {
      contractNumber: { column: "contract_number", transform: (v) => requiredText(v, "contractNumber") },
      status: {
        column: "status",
        transform: (v) => {
          if (!CONTRACT_STATUSES.has(v)) throw new AppError(400, "partner_validation:status_invalid");
          return v;
        },
      },
      billingModel: {
        column: "billing_model",
        transform: (v) => {
          if (!BILLING_MODELS.has(v)) throw new AppError(400, "partner_validation:billing_model_invalid");
          return v;
        },
      },
      startDate: { column: "start_date", transform: (v) => requiredText(v, "startDate") },
      endDate: { column: "end_date", transform: optionalText },
      currency: { column: "currency", transform: (v) => cleanText(v) || "SAR" },
      fixedRentAmount: { column: "fixed_rent_amount", transform: optionalNumber },
      hourlyRate: { column: "hourly_rate", transform: optionalNumber },
      dailyRate: { column: "daily_rate", transform: optionalNumber },
      partnerSharePercent: { column: "partner_share_percent", transform: optionalPercent },
      salonSharePercent: { column: "salon_share_percent", transform: optionalPercent },
      revenueShareBasis: {
        column: "revenue_share_basis",
        transform: (v) => (REVENUE_SHARE_BASES.has(v) ? v : null),
      },
      minimumSalonShareAmount: { column: "minimum_salon_share_amount", transform: optionalNumber },
      depositAmount: { column: "deposit_amount", transform: optionalNumber },
      paymentDueDay: { column: "payment_due_day", transform: (v) => optionalNumber(v, 1) },
      timeOffMonthlyHours: { column: "time_off_monthly_hours", transform: optionalNumber },
      timeOffMaxHoursPerRolling14Days: {
        column: "time_off_max_hours_rolling_14_days",
        transform: optionalNumber,
      },
      notes: { column: "notes", transform: optionalText },
    },
    identity
  );
  await env.PARTNERS_DB.prepare(update.statement).bind(...update.values).run();
  await audit(env, identity, salonId, "partner_contract", id, "update", patch).run();
}

async function linkMemberAccount(env, salonId, memberId, input, identity) {
  const userUid = requiredText(input.userUid, "userUid");
  const email = lowerEmail(input.email);
  if (!email) throw new AppError(400, "partner_validation:email_required");

  const member = await env.PARTNERS_DB.prepare(
    `SELECT * FROM partner_members WHERE salon_id = ? AND id = ? LIMIT 1`
  )
    .bind(salonId, memberId)
    .first();
  if (!member) throw new AppError(404, "partner_validation:member_not_found");
  if (member.user_uid) throw new AppError(409, "partner_validation:member_account_exists");

  const duplicate = await env.PARTNERS_DB.prepare(
    `SELECT id FROM partner_members WHERE user_uid = ? AND id <> ? LIMIT 1`
  )
    .bind(userUid, memberId)
    .first();
  if (duplicate) throw new AppError(409, "partner_validation:account_already_linked");

  const timestamp = nowIso();
  const statements = [
    env.PARTNERS_DB.prepare(
      `UPDATE partner_members
       SET user_uid = ?, email = ?, updated_at = ?, updated_by_uid = ?
       WHERE salon_id = ? AND id = ?`
    ).bind(userUid, email, timestamp, identity.uid, salonId, memberId),
    audit(env, identity, salonId, "partner_member", memberId, "link_account", {
      email,
      userUid,
    }),
  ];

  if (member.member_type === "owner") {
    statements.push(
      env.PARTNERS_DB.prepare(
        `UPDATE partners
         SET owner_uid = ?, email = COALESCE(email, ?), updated_at = ?, updated_by_uid = ?
         WHERE salon_id = ? AND id = ?`
      ).bind(userUid, email, timestamp, identity.uid, salonId, member.partner_id)
    );
  }

  await env.PARTNERS_DB.batch(statements);
  return { id: memberId, userUid, email };
}

function sanitizePortalMember(member) {
  const mapped = mapMember(member);
  const hasLogin = Boolean(mapped.userUid);
  delete mapped.userUid;
  delete mapped.createdByUid;
  delete mapped.updatedByUid;
  return { ...mapped, hasLogin };
}

function sanitizePortalContract(contract, canViewFinancials) {
  if (canViewFinancials) return contract;
  const sanitized = { ...contract };
  delete sanitized.fixedRentAmount;
  delete sanitized.hourlyRate;
  delete sanitized.dailyRate;
  delete sanitized.partnerSharePercent;
  delete sanitized.salonSharePercent;
  delete sanitized.revenueShareBasis;
  delete sanitized.minimumSalonShareAmount;
  delete sanitized.depositAmount;
  return sanitized;
}

async function getPortalSession(env, identity) {
  if (await ensureAdminIdentity(env, identity)) {
    return {
      kind: "admin",
      identity,
    };
  }

  const access = await resolvePartnerAccess(env, identity);
  return {
    kind: "partner",
    identity,
    partner: mapPartner(access.partnerRow),
    member: sanitizePortalMember(access.memberRow),
  };
}


function unavailablePartnerOperationalState(
  employeeId,
  date,
  reason = "core_unavailable"
) {
  return {
    employeeId: cleanText(employeeId),
    date,
    available: false,
    reason,
    source: "malikat_core",
    blockedRanges: [],
  };
}

function normalizePartnerOperationalState(
  row,
  fallbackDate
) {
  const blockedRanges =
    (Array.isArray(row?.blockedRanges)
      ? row.blockedRanges
      : []
    )
      .map((range) => ({
        startTime:
          cleanText(range?.startTime),
        endTime:
          cleanText(range?.endTime),
        source:
          cleanText(range?.source),
        reason:
          cleanText(range?.reason),
        leaveId:
          optionalText(range?.leaveId) ||
          undefined,
        leaveType:
          optionalText(range?.leaveType) ||
          undefined,
      }))
      .filter(
        (range) =>
          range.startTime &&
          range.endTime
      );

  return {
    employeeId:
      cleanText(row?.employeeId),
    date:
      cleanText(row?.date) ||
      fallbackDate,
    available:
      row?.available === true,
    showOnBooking:
      typeof row?.showOnBooking ===
      "boolean"
        ? row.showOnBooking
        : undefined,
    reason:
      cleanText(row?.reason),
    source:
      cleanText(row?.source) ||
      "malikat_core",
    startTime:
      optionalText(row?.startTime) ||
      undefined,
    endTime:
      optionalText(row?.endTime) ||
      undefined,
    leaveType:
      optionalText(row?.leaveType) ||
      undefined,
    absenceType:
      optionalText(row?.absenceType) ||
      undefined,
    blockedRanges,
  };
}

async function resolvePartnerOperationalStateMap(
  env,
  members,
  date
) {
  const employeeIds =
    Array.from(
      new Set(
        members
          .map(
            (member) =>
              cleanText(
                member.employeeId
              )
          )
          .filter(Boolean)
      )
    );

  if (!employeeIds.length) {
    return new Map();
  }

  const unavailableForIds = (
    ids,
    reason = "core_unavailable"
  ) =>
    new Map(
      ids.map(
        (employeeId) => [
          employeeId,
          unavailablePartnerOperationalState(
            employeeId,
            date,
            reason
          ),
        ]
      )
    );

  if (!env.MALIKAT_CORE_PARTNER) {
    return unavailableForIds(
      employeeIds
    );
  }

  const stateByEmployeeId =
    new Map();

  // Core intentionally caps this private capability at 100 employees.
  // Partner teams are not capped, so resolve them in bounded chunks.
  for (
    let offset = 0;
    offset < employeeIds.length;
    offset += 100
  ) {
    const chunk =
      employeeIds.slice(
        offset,
        offset + 100
      );

    try {
      const result =
        await env.MALIKAT_CORE_PARTNER.resolveOperationalDays({
          employeeIds: chunk,
          date,
        });

      const rows =
        Array.isArray(result?.rows)
          ? result.rows
          : [];

      for (const row of rows) {
        const normalized =
          normalizePartnerOperationalState(
            row,
            date
          );

        if (
          normalized.employeeId
        ) {
          stateByEmployeeId.set(
            normalized.employeeId,
            normalized
          );
        }
      }
    } catch (error) {
      console.warn(
        "[partners] Malikat Core operational-day RPC chunk failed",
        {
          offset,
          count: chunk.length,
          error,
        }
      );

      for (
        const [
          employeeId,
          state,
        ] of unavailableForIds(
          chunk
        )
      ) {
        stateByEmployeeId.set(
          employeeId,
          state
        );
      }
    }
  }

  return stateByEmployeeId;
}

async function getPortalOverview(env, identity) {
  const access = await resolvePartnerAccess(env, identity);
  const canViewFinancials = Number(access.memberRow.can_view_financials) === 1;

  const [contractsResult, linksResult, resourcesResult, membersResult] =
    await env.PARTNERS_DB.batch([
      env.PARTNERS_DB.prepare(
        `SELECT * FROM partner_contracts
         WHERE salon_id = ? AND partner_id = ?
         ORDER BY start_date DESC, created_at DESC`
      ).bind(access.salonId, access.partnerId),
      env.PARTNERS_DB.prepare(
        `SELECT pcr.contract_id, pcr.resource_id
         FROM partner_contract_resources pcr
         INNER JOIN partner_contracts pc ON pc.id = pcr.contract_id
         WHERE pcr.salon_id = ? AND pc.partner_id = ?`
      ).bind(access.salonId, access.partnerId),
      env.PARTNERS_DB.prepare(
        `SELECT * FROM rental_resources
         WHERE salon_id = ? AND current_partner_id = ?
         ORDER BY code COLLATE NOCASE ASC`
      ).bind(access.salonId, access.partnerId),
      env.PARTNERS_DB.prepare(
        `SELECT * FROM partner_members
         WHERE salon_id = ? AND partner_id = ?
         ORDER BY CASE member_type WHEN 'owner' THEN 0 ELSE 1 END,
                  display_name COLLATE NOCASE ASC`
      ).bind(access.salonId, access.partnerId),
    ]);

  const resourcesByContract = new Map();
  for (const row of linksResult.results) {
    const current = resourcesByContract.get(row.contract_id) || [];
    current.push(row.resource_id);
    resourcesByContract.set(row.contract_id, current);
  }

  const contracts = contractsResult.results.map((row) =>
    sanitizePortalContract(
      mapContract(row, resourcesByContract.get(row.id) || []),
      canViewFinancials
    )
  );

  const rawTeam =
    membersResult.results.map(
      sanitizePortalMember
    );

  const today =
    riyadhDateKey();

  const operationalStateByEmployeeId =
    await resolvePartnerOperationalStateMap(
      env,
      rawTeam,
      today
    );

  const team =
    rawTeam.map((member) => {
      const employeeId =
        cleanText(
          member.employeeId
        );

      const todayOperationalState =
        employeeId
          ? operationalStateByEmployeeId.get(
              employeeId
            ) ||
            unavailablePartnerOperationalState(
              employeeId,
              today,
              "employee_not_resolved"
            )
          : unavailablePartnerOperationalState(
              "",
              today,
              "employee_not_linked"
            );

      return {
        ...member,
        todayOperationalState,
      };
    });

  return {
    partner: mapPartner(access.partnerRow),
    member: sanitizePortalMember(access.memberRow),
    contracts,
    resources: resourcesResult.results.map(mapResource),
    team,
    permissions: {
      canManageTeam: Number(access.memberRow.can_manage_team) === 1,
      canManageInventory: Number(access.memberRow.can_manage_inventory) === 1,
      canViewFinancials,
      canWorkAsProvider: Number(access.memberRow.can_work_as_provider) === 1,
    },
  };
}

async function routePortalApi(request, env, identity, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "GET" && path === "/api/session") {
    return getPortalSession(env, identity);
  }
  if (method === "GET" && path === "/api/portal/overview") {
    return getPortalOverview(env, identity);
  }

  throw new AppError(404, "partner_api:not_found");
}

async function routeApi(request, env, identity, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const salonFromQuery = cleanSalonId(url.searchParams.get("salonId"));

  if (method === "GET" && path === "/api/partners") {
    return listPartners(env, salonFromQuery);
  }
  if (method === "GET" && path.startsWith("/api/partners/")) {
    const id = decodeURIComponent(path.slice("/api/partners/".length));
    return getPartner(env, salonFromQuery, id);
  }
  if (method === "POST" && path === "/api/partners") {
    const body = await readBody(request);
    const salonId = cleanSalonId(body.salonId);
    return { id: await createPartner(env, salonId, body.partner || {}, identity, false) };
  }
  if (method === "POST" && path === "/api/partners/with-owner") {
    const body = await readBody(request);
    const salonId = cleanSalonId(body.salonId);
    return { id: await createPartner(env, salonId, body.partner || {}, identity, true) };
  }
  if (method === "PATCH" && path.startsWith("/api/partners/")) {
    const body = await readBody(request);
    const id = decodeURIComponent(path.slice("/api/partners/".length));
    const salonId = cleanSalonId(body.salonId);
    await updatePartner(env, salonId, id, body.patch || {}, identity);
    return { id };
  }

  if (method === "GET" && path === "/api/resources") {
    return listResources(env, salonFromQuery);
  }
  if (method === "POST" && path === "/api/resources") {
    const body = await readBody(request);
    const salonId = cleanSalonId(body.salonId);
    return { id: await createResource(env, salonId, body.resource || {}, identity) };
  }
  if (method === "PATCH" && path.startsWith("/api/resources/")) {
    const body = await readBody(request);
    const id = decodeURIComponent(path.slice("/api/resources/".length));
    const salonId = cleanSalonId(body.salonId);
    await updateResource(env, salonId, id, body.patch || {}, identity);
    return { id };
  }

  if (method === "GET" && path === "/api/contracts") {
    return listContracts(env, salonFromQuery);
  }
  if (method === "POST" && path === "/api/contracts") {
    const body = await readBody(request);
    const salonId = cleanSalonId(body.salonId);
    return { id: await createContract(env, salonId, body.contract || {}, identity) };
  }
  if (method === "PATCH" && path.startsWith("/api/contracts/")) {
    const body = await readBody(request);
    const id = decodeURIComponent(path.slice("/api/contracts/".length));
    const salonId = cleanSalonId(body.salonId);
    await updateContract(env, salonId, id, body.patch || {}, identity);
    return { id };
  }

  if (method === "GET" && path === "/api/members") {
    return listMembers(env, salonFromQuery);
  }
  if (method === "POST" && path === "/api/members") {
    const body = await readBody(request);
    const salonId = cleanSalonId(body.salonId);
    return { id: await createMember(env, salonId, body.member || {}, identity) };
  }
  if (
    method === "POST" &&
    path.startsWith("/api/members/") &&
    path.endsWith("/link-account")
  ) {
    const body = await readBody(request);
    const encodedId = path.slice("/api/members/".length, -"/link-account".length);
    const id = decodeURIComponent(encodedId);
    const salonId = cleanSalonId(body.salonId);
    return linkMemberAccount(env, salonId, id, body.account || {}, identity);
  }
  if (method === "PATCH" && path.startsWith("/api/members/")) {
    const body = await readBody(request);
    const id = decodeURIComponent(path.slice("/api/members/".length));
    const salonId = cleanSalonId(body.salonId);
    await updateMember(env, salonId, id, body.patch || {}, identity);
    return { id };
  }

  throw new AppError(404, "partner_api:not_found");
}

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    try {
      if (!isOriginAllowed(request, env)) {
        throw new AppError(403, "partner_api:origin_not_allowed");
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        if (!env.PARTNERS_DB) {
          throw new AppError(503, "partner_api:d1_not_configured");
        }
        await env.PARTNERS_DB.prepare("SELECT 1 AS ok").first();
        return ok(
          request,
          env,
          { service: "queens-salon-partners-api", database: "ready" },
          requestId
        );
      }
      if (!url.pathname.startsWith("/api/")) {
        throw new AppError(404, "partner_api:not_found");
      }

      if (url.pathname === "/api/session" || url.pathname.startsWith("/api/portal/")) {
        const identity = await authenticateRequest(request, env);
        const data = await routePortalApi(request, env, identity, url);
        return ok(request, env, data, requestId);
      }

      const identity = await requireAdmin(request, env);
      const data = await routeApi(request, env, identity, url);
      return ok(request, env, data, requestId);
    } catch (error) {
      return fail(request, env, error, requestId);
    }
  },
};
