// CORE D1 ONLY. Service Promo Price is not an offer package.
import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
} from "../d1.js";
import { AppError } from "../errors.js";

function requiredIso(value, field) {
  const text = cleanText(value);
  if (!text) throw new AppError(400, "core_validation:required", field + " is required");
  if (Number.isNaN(Date.parse(text))) throw new AppError(400, "core_validation:invalid_date", field + " is invalid");
  return text;
}

export async function listPromoPrices(db, salonId, query = {}) {
  const activeOnly = ["1", "true", "yes"].includes(cleanText(query.active).toLowerCase());
  const where = ["p.salon_id = ?"];
  const params = [salonId];
  if (activeOnly) where.push("p.is_active = 1");
  const serviceId = cleanText(query.serviceId || query.service_id);
  if (serviceId) {
    where.push("p.service_id = ?");
    params.push(serviceId);
  }
  return dbAll(
    db,
    `SELECT p.*, s.name AS service_name, s.price_halalas AS service_catalog_price_halalas
       FROM service_promo_prices p
       LEFT JOIN services s ON s.id = p.service_id AND s.salon_id = p.salon_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.updated_at DESC
      LIMIT 500`,
    params
  );
}

export async function getActivePromoForService(db, salonId, serviceId, at = nowIso()) {
  const id = requiredId(serviceId, "serviceId");
  return dbFirst(
    db,
    `SELECT * FROM service_promo_prices
      WHERE salon_id = ? AND service_id = ? AND is_active = 1
        AND starts_at <= ? AND ends_at >= ?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [salonId, id, at, at]
  );
}

export async function getActivePromosMap(db, salonId, at = nowIso()) {
  const rows = await dbAll(
    db,
    `SELECT * FROM service_promo_prices
      WHERE salon_id = ? AND is_active = 1
        AND starts_at <= ? AND ends_at >= ?
      ORDER BY updated_at DESC`,
    [salonId, at, at]
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.service_id)) map.set(row.service_id, row);
  }
  return map;
}

export async function upsertPromoPrice(db, salonId, data, actor = {}) {
  const serviceId = requiredId(data.serviceId || data.service_id, "serviceId");
  const service = await dbFirst(db, "SELECT id, price_halalas FROM services WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, serviceId]);
  if (!service) throw new AppError(404, "core_not_found:service", "Service was not found");
  const promoPrice = integer(data.promoPriceHalalas ?? data.promo_price_halalas, "promoPriceHalalas", { min: 0 });
  const startsAt = requiredIso(data.startsAt || data.starts_at, "startsAt");
  const endsAt = requiredIso(data.endsAt || data.ends_at, "endsAt");
  if (Date.parse(endsAt) < Date.parse(startsAt)) {
    throw new AppError(400, "core_validation:invalid_date_range", "endsAt must be after startsAt");
  }
  const now = nowIso();
  const note = optionalText(data.note);
  await dbRun(
    db,
    `UPDATE service_promo_prices
        SET is_active = 0, updated_at = ?
      WHERE salon_id = ? AND service_id = ? AND is_active = 1`,
    [now, salonId, serviceId]
  );
  const id = generatedId("spromo");
  await dbRun(
    db,
    `INSERT INTO service_promo_prices (
        id, salon_id, service_id, catalog_price_halalas, promo_price_halalas,
        starts_at, ends_at, is_active, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, salonId, serviceId, Number(service.price_halalas || 0), promoPrice, startsAt, endsAt, note, now, now]
  );
  return dbFirst(db, "SELECT * FROM service_promo_prices WHERE id = ? LIMIT 1", [id]);
}

export async function deactivatePromoPrice(db, salonId, id) {
  const promoId = requiredId(id, "id");
  const row = await dbFirst(db, "SELECT id FROM service_promo_prices WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, promoId]);
  if (!row) throw new AppError(404, "core_not_found:service_promo", "Promo price was not found");
  await dbRun(db, "UPDATE service_promo_prices SET is_active = 0, updated_at = ? WHERE salon_id = ? AND id = ?", [nowIso(), salonId, promoId]);
  return { ok: true, id: promoId };
}
