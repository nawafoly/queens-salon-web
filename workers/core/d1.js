// CORE D1 ONLY — do not add Firestore fallback.

import { AppError } from './errors.js';

export const ADMIN_ROLES = new Set(["owner", "admin"]);
export const OPERATIONS_ROLES = new Set(["owner", "admin", "hr", "accountant", "reception", "staff"]);

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function optionalText(value) {
  const text = cleanText(value);
  return text || undefined;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizePhone(value) {
  const raw = cleanText(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

// Dynamic route parameters arrive from URL.pathname still percent-encoded in
// the Worker runtime. Employee ids can legitimately contain Arabic text, so a
// raw id such as "سميرة_دينار" reaches the route matcher as "%D8%B3...".
// Older UI flows could then pass that encoded value back through
// encodeURIComponent, producing "%25D8...". Normalize only URI-looking ids,
// up to two layers, before validation/storage/lookup. Encoded path separators
// are deliberately not decoded by this detector, preserving the id boundary.
export function normalizeId(value) {
  let id = cleanText(value);
  if (!id) return "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!/%(?:25|[C-Fc-f][0-9A-Fa-f])/.test(id)) break;

    let decoded = id;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      break;
    }

    decoded = cleanText(decoded);
    if (!decoded || decoded === id) break;
    id = decoded;
  }

  return id;
}

export function canonicalIdCandidates(value) {
  const canonical = normalizeId(value);
  if (!canonical) return [];
  const once = encodeURIComponent(canonical);
  const twice = encodeURIComponent(once);
  return Array.from(new Set([canonical, once, twice].filter(Boolean)));
}

export function canonicalizeEmployeeProfileRows(rows) {
  const grouped = new Map();

  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const rawId = cleanText(rawRow?.id);
    const canonicalId = normalizeId(rawId);
    if (!canonicalId) continue;

    const candidate = {
      ...rawRow,
      id: canonicalId,
    };
    const current = grouped.get(canonicalId);

    if (!current) {
      grouped.set(canonicalId, {
        row: candidate,
        rawId,
        canonical: rawId === canonicalId,
      });
      continue;
    }

    // Prefer the physically canonical row over an older encoded alias. If both
    // are legacy aliases, keep the one closest to the canonical form.
    const candidateCanonical = rawId === canonicalId;
    const candidateScore = candidateCanonical ? 0 : rawId.length;
    const currentScore = current.canonical ? 0 : current.rawId.length;
    if (candidateScore < currentScore) {
      grouped.set(canonicalId, {
        row: candidate,
        rawId,
        canonical: candidateCanonical,
      });
    }
  }

  return Array.from(grouped.values()).map((item) => item.row);
}

function payrollEntryStatusRank(value) {
  const status = cleanText(value).toLowerCase();
  if (status === 'paid') return 4;
  if (status === 'approved') return 3;
  if (status === 'reviewed') return 2;
  if (status === 'draft') return 1;
  return 0;
}

function payrollAliasCandidate(row, rawEmployeeId) {
  return {
    row,
    rawEmployeeId: cleanText(rawEmployeeId || row?.employee_id),
  };
}

function payrollAliasWinner(current, candidate, canonicalEmployeeId) {
  if (!current) return candidate;

  const currentRank = payrollEntryStatusRank(current.row?.status);
  const candidateRank = payrollEntryStatusRank(candidate.row?.status);
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current;
  }

  const currentCanonical = current.rawEmployeeId === canonicalEmployeeId;
  const candidateCanonical = candidate.rawEmployeeId === canonicalEmployeeId;
  if (candidateCanonical !== currentCanonical) {
    return candidateCanonical ? candidate : current;
  }

  const currentUpdated = cleanText(current.row?.updated_at || current.row?.created_at);
  const candidateUpdated = cleanText(candidate.row?.updated_at || candidate.row?.created_at);
  if (candidateUpdated !== currentUpdated) {
    return candidateUpdated > currentUpdated ? candidate : current;
  }

  return cleanText(candidate.row?.id) < cleanText(current.row?.id)
    ? candidate
    : current;
}

// Historical releases could persist a payroll row under a percent-encoded
// employee id and later create another row under the decoded id. Financial
// finality wins first (paid > approved > reviewed > draft); for equal states,
// the physically canonical id wins. This hides legacy aliases without deleting
// financial history and prevents the same payroll month from being processed
// twice through list-based workflows.
export function canonicalizePayrollEntryRows(rows) {
  const grouped = new Map();

  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const canonicalEmployeeId = normalizeId(rawRow?.employee_id);
    const payrollMonth = cleanText(rawRow?.payroll_month);
    if (!canonicalEmployeeId || !payrollMonth) continue;

    const key = `${canonicalEmployeeId}|${payrollMonth}`;
    const candidate = payrollAliasCandidate(rawRow, rawRow?.employee_id);
    grouped.set(
      key,
      payrollAliasWinner(grouped.get(key), candidate, canonicalEmployeeId)
    );
  }

  return Array.from(grouped.values()).map(({ row }) => ({
    ...row,
    employee_id: normalizeId(row.employee_id),
  }));
}

function isEmployeeProfileListQuery(sql) {
  return /SELECT\s+\*\s+FROM\s+employee_profiles\s+WHERE\s+salon_id\s*=\s*\?\s+ORDER\s+BY\s+status,\s*name\s+LIMIT\s+1000/i.test(
    String(sql || "")
  );
}

function isPayrollEntryListQuery(sql) {
  return /SELECT\s+\*\s+FROM\s+payroll_entries\s+WHERE\s+salon_id\s*=\s*\?\s+ORDER\s+BY\s+payroll_month\s+DESC,\s*employee_id\s+LIMIT\s+2000/i.test(
    String(sql || "")
  );
}

function isCanonicalEmployeePointLookup(sql) {
  const text = String(sql || "");
  return (
    /FROM\s+employee_profiles\b/i.test(text) ||
    /FROM\s+employee_employment\b/i.test(text)
  ) && /\b(?:id|employee_id)\s*=\s*\?/i.test(text);
}

function isCanonicalPayrollEntryPointLookup(sql) {
  const text = String(sql || "");
  return (
    /FROM\s+payroll_entries\b/i.test(text) &&
    /\bemployee_id\s*=\s*\?/i.test(text) &&
    /\bpayroll_month\s*=\s*\?/i.test(text) &&
    /\bLIMIT\s+1\b/i.test(text)
  );
}

function placeholderIndexBefore(sql, offset) {
  return (String(sql || '').slice(0, offset).match(/\?/g) || []).length;
}

function payrollEmployeeParamIndex(sql) {
  const match = /\bemployee_id\s*=\s*\?/i.exec(String(sql || ''));
  return match ? placeholderIndexBefore(sql, match.index) : -1;
}

async function runFirst(db, sql, params) {
  if (db.__fakeD1) return db.first(sql, params);
  return db.prepare(sql).bind(...params).first();
}

async function runAllRaw(db, sql, params) {
  if (db.__fakeD1) return db.all(sql, params);
  return (await db.prepare(sql).bind(...params).all())?.results || [];
}

async function canonicalPayrollPointLookup(db, sql, params) {
  const employeeParamIndex = payrollEmployeeParamIndex(sql);
  if (employeeParamIndex < 0 || employeeParamIndex >= params.length) {
    return runFirst(db, sql, params);
  }

  const requestedEmployeeId = normalizeId(params[employeeParamIndex]);
  let winner = null;

  for (const candidateId of canonicalIdCandidates(requestedEmployeeId)) {
    const nextParams = [...params];
    nextParams[employeeParamIndex] = candidateId;
    const row = await runFirst(db, sql, nextParams);
    if (!row) continue;
    winner = payrollAliasWinner(
      winner,
      payrollAliasCandidate(row, candidateId),
      requestedEmployeeId
    );
  }

  return winner?.row || null;
}

function payrollMutationColumnIndexes(sql) {
  const text = String(sql || '');
  if (!/^\s*INSERT\s+INTO\s+payroll_entries\b/i.test(text)) return null;
  const match = /INSERT\s+INTO\s+payroll_entries\s*\(([\s\S]*?)\)\s*VALUES\s*\(/i.exec(text);
  if (!match) return null;
  const columns = match[1].split(',').map((item) => cleanText(item).toLowerCase());
  const indexOf = (name) => columns.indexOf(name);
  const indexes = {
    id: indexOf('id'),
    salonId: indexOf('salon_id'),
    employeeId: indexOf('employee_id'),
    payrollMonth: indexOf('payroll_month'),
  };
  return Object.values(indexes).every((value) => value >= 0) ? indexes : null;
}

async function existingPayrollAliasForMutation(db, salonId, employeeIdValue, payrollMonth) {
  const employeeId = normalizeId(employeeIdValue);
  let winner = null;
  for (const candidateId of canonicalIdCandidates(employeeId)) {
    const row = await runFirst(
      db,
      `SELECT * FROM payroll_entries
        WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1`,
      [salonId, candidateId, payrollMonth]
    );
    if (!row) continue;
    winner = payrollAliasWinner(
      winner,
      payrollAliasCandidate(row, candidateId),
      employeeId
    );
  }
  return winner?.row || null;
}

async function canonicalPayrollMutationParams(db, sql, params) {
  const indexes = payrollMutationColumnIndexes(sql);
  if (!indexes || params.length <= Math.max(...Object.values(indexes))) return params;

  const nextParams = [...params];
  const salonId = cleanText(nextParams[indexes.salonId]);
  const employeeId = normalizeId(nextParams[indexes.employeeId]);
  const payrollMonth = cleanText(nextParams[indexes.payrollMonth]);
  if (!salonId || !employeeId || !payrollMonth) return params;

  const existing = await existingPayrollAliasForMutation(
    db,
    salonId,
    employeeId,
    payrollMonth
  );
  if (!existing?.id) return params;

  // Reuse the physical historical row rather than creating a second composite
  // identity. The public/read side still exposes the canonical employee id.
  nextParams[indexes.id] = existing.id;
  nextParams[indexes.employeeId] = cleanText(existing.employee_id) || employeeId;
  return nextParams;
}

export function requiredId(value, field = "id") {
  const id = normalizeId(value);
  if (!id || id.length > 128 || id.includes("/") || id === "." || id === "..") {
    throw new AppError(400, "core_validation:invalid_id", `${field} is invalid`);
  }
  return id;
}

export function requiredText(value, field, max = 300) {
  const text = cleanText(value);
  if (!text || text.length > max) throw new AppError(400, "core_validation:invalid_text", `${field} is invalid`);
  return text;
}

export function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const raw = value === undefined || value === null || value === "" ? fallback : value;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AppError(400, "core_validation:invalid_integer", `${field} is invalid`);
  }
  return number;
}

export function activeFlag(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

export function generatedId(prefix) {
  const random = crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function requireDb(envOrCtx) {
  const db = envOrCtx?.CORE_DB || envOrCtx?.coreDb;
  if (!db) throw new AppError(503, "core_d1:not_configured", "Core D1 database is not configured");
  return db;
}

export function requireRole(role, allowed = OPERATIONS_ROLES) {
  if (!allowed.has(role)) throw new AppError(403, "core_auth:insufficient_permissions");
}

export function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function dbFirst(db, sql, params = []) {
  if (isCanonicalPayrollEntryPointLookup(sql)) {
    return canonicalPayrollPointLookup(db, sql, params);
  }

  let row = await runFirst(db, sql, params);
  if (row || !isCanonicalEmployeePointLookup(sql) || params.length < 2) return row;

  const idIndex = params.length - 1;
  const originalId = cleanText(params[idIndex]);
  for (const candidate of canonicalIdCandidates(originalId)) {
    if (!candidate || candidate === originalId) continue;
    const nextParams = [...params];
    nextParams[idIndex] = candidate;
    row = await runFirst(db, sql, nextParams);
    if (row) {
      const canonicalId = normalizeId(originalId || candidate);
      if (Object.prototype.hasOwnProperty.call(row, "id")) {
        row = { ...row, id: canonicalId };
      }
      if (Object.prototype.hasOwnProperty.call(row, "employee_id")) {
        row = { ...row, employee_id: canonicalId };
      }
      return row;
    }
  }

  return null;
}

export async function dbAll(db, sql, params = []) {
  const rows = await runAllRaw(db, sql, params);

  if (isEmployeeProfileListQuery(sql)) {
    return canonicalizeEmployeeProfileRows(rows);
  }
  if (isPayrollEntryListQuery(sql)) {
    return canonicalizePayrollEntryRows(rows);
  }
  return rows;
}

export async function dbRun(db, sql, params = []) {
  const nextParams = await canonicalPayrollMutationParams(db, sql, params);
  if (db.__fakeD1) return db.run(sql, nextParams);
  return db.prepare(sql).bind(...nextParams).run();
}

export async function dbBatch(db, statements) {
  const normalized = [];
  for (const { sql, params = [] } of statements) {
    normalized.push({
      sql,
      params: await canonicalPayrollMutationParams(db, sql, params),
    });
  }
  if (db.__fakeD1) return db.batch(normalized);
  return db.batch(normalized.map(({ sql, params }) => db.prepare(sql).bind(...params)));
}

export function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export function validDate(value, field = "date") {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new AppError(400, "core_validation:invalid_date", `${field} is invalid`);
  return text;
}

export function validTime(value, field = "time") {
  const text = cleanText(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new AppError(400, "core_validation:invalid_time", `${field} is invalid`);
  return text;
}

export function addMinutes(timeHHMM, minutes) {
  const [hours, mins] = validTime(timeHHMM).split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  const wrapped = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export function rowNotFound(entity) {
  throw new AppError(404, `core_${entity}:not_found`, `${entity} was not found`);
}

export function pickDefined(object, fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function updateById(db, table, salonId, id, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return dbFirst(db, `SELECT * FROM ${table} WHERE salon_id = ? AND id = ? LIMIT 1`, [salonId, id]);
  const setSql = entries.map(([key]) => `${key} = ?`).join(", ");
  const result = await dbRun(db, `UPDATE ${table} SET ${setSql}, updated_at = ? WHERE salon_id = ? AND id = ?`, [
    ...entries.map(([, value]) => value),
    nowIso(),
    salonId,
    id,
  ]);
  if (changes(result) < 1) rowNotFound(table);
  return dbFirst(db, `SELECT * FROM ${table} WHERE salon_id = ? AND id = ? LIMIT 1`, [salonId, id]);
}
