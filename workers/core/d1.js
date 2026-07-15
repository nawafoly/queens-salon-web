// CORE D1 ONLY — do not add Firestore fallback.

import { AppError } from './errors.js';

export const ADMIN_ROLES = new Set(["owner", "admin"]);
export const OPERATIONS_ROLES = new Set(["owner", "admin", "reception", "staff"]);

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

export function requiredId(value, field = "id") {
  const id = cleanText(value);
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
  if (db.__fakeD1) return db.first(sql, params);
  return db.prepare(sql).bind(...params).first();
}

export async function dbAll(db, sql, params = []) {
  if (db.__fakeD1) return db.all(sql, params);
  const result = await db.prepare(sql).bind(...params).all();
  return result?.results || [];
}

export async function dbRun(db, sql, params = []) {
  if (db.__fakeD1) return db.run(sql, params);
  return db.prepare(sql).bind(...params).run();
}

export async function dbBatch(db, statements) {
  if (db.__fakeD1) return db.batch(statements);
  return db.batch(statements.map(({ sql, params = [] }) => db.prepare(sql).bind(...params)));
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
