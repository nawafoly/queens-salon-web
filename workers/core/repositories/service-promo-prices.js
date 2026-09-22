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

function fakePromoRows(db) {
  if (!db?.__fakeD1 || typeof db.rows !== "function") return null;
  try {
    return db.rows("service_promo_prices");
  } catch {
    return [];
  }
}

function ensureFakePromoTable(db) {
  if (!db?.__fakeD1) return;
  if (db.tables && !db.tables.service_promo_prices) {
    db.tables.service_promo_prices = new Map();
  }
}

function saveFakePromoRow(db, row) {
  ensureFakePromoTable(db);
  if (db?.tables?.service_promo_prices) {
    db.tables.service_promo_prices.set(row.id, { ...row });
  }
}

export async function listPromoPrices(db, salonId, query = {}) {
  const activeOnly = ["1", "true", "yes"].includes(cleanText(query.active).toLowerCase());
  const where = ["p.salon_id = ?"];
  const params = [salonId];
  if (activeOnly) where.push("p.is_active = 1");
  const serviceId = cleanText(query.serviceId || query.service_id);
  const fakeRows = fakePromoRows(db);
  if (fakeRows) {
    let rows = fakeRows.filter((row) => row.salon_id === salonId);
    if (activeOnly) rows = rows.filter((row) => Number(row.is_active) === 1);
    if (serviceId) rows = rows.filter((row) => row.service_id === serviceId);
    const services = typeof db.rows === "function" ? db.rows("services") : [];
    return rows
      .map((row) => {
        const service = services.find((item) => item.salon_id === row.salon_id && item.id === row.service_id) || {};
        return {
          ...row,
          service_name: service.name || null,
          service_catalog_price_halalas: service.price_halalas ?? null,
        };
      })
      .sort((a, b) => cleanText(b.updated_at).localeCompare(cleanText(a.updated_at)))
      .slice(0, 500);
  }
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
  const fakeRows = fakePromoRows(db);
  if (fakeRows) {
    return fakeRows
      .filter((row) =>
        row.salon_id === salonId &&
        row.service_id === id &&
        Number(row.is_active) === 1 &&
        cleanText(row.starts_at) <= at &&
        cleanText(row.ends_at) >= at
      )
      .sort((a, b) => cleanText(b.updated_at).localeCompare(cleanText(a.updated_at)))[0] || null;
  }
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
  const fakeRows = fakePromoRows(db);
  if (fakeRows) {
    const map = new Map();
    const rows = fakeRows
      .filter((row) =>
        row.salon_id === salonId &&
        Number(row.is_active) === 1 &&
        cleanText(row.starts_at) <= at &&
        cleanText(row.ends_at) >= at
      )
      .sort((a, b) => cleanText(b.updated_at).localeCompare(cleanText(a.updated_at)));
    for (const row of rows) {
      if (!map.has(row.service_id)) map.set(row.service_id, row);
    }
    return map;
  }
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
  const requestedId = cleanText(data.id);
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
  const actorUid = cleanText(actor?.uid || actor?.firebase_uid || actor?.email);
  const note = optionalText(data.note);
  if (db.__fakeD1) {
    ensureFakePromoTable(db);
    const rows = fakePromoRows(db) || [];
    for (const row of rows) {
      if (
        row.salon_id === salonId &&
        row.service_id === serviceId &&
        Number(row.is_active) === 1 &&
        (!requestedId || row.id !== requestedId)
      ) {
        saveFakePromoRow(db, {
          ...row,
          is_active: 0,
          updated_at: now,
          updated_by: actorUid || row.updated_by || null,
        });
      }
    }
    const id = requestedId || generatedId("spromo");
    const existing = rows.find((row) => row.salon_id === salonId && row.id === id);
    const next = {
      ...(existing || {}),
      id,
      salon_id: salonId,
      service_id: serviceId,
      catalog_price_halalas: Number(service.price_halalas || 0),
      promo_price_halalas: promoPrice,
      starts_at: startsAt,
      ends_at: endsAt,
      is_active: 1,
      note,
      created_at: existing?.created_at || now,
      updated_at: now,
      created_by: existing?.created_by || actorUid || null,
      updated_by: actorUid || existing?.updated_by || null,
    };
    saveFakePromoRow(db, next);
    return next;
  }
  await dbRun(
    db,
    `UPDATE service_promo_prices
        SET is_active = 0, updated_at = ?, updated_by = COALESCE(?, updated_by)
      WHERE salon_id = ? AND service_id = ? AND is_active = 1
        AND (? = '' OR id != ?)`,
    [now, actorUid || null, salonId, serviceId, requestedId, requestedId]
  );
  const id = requestedId || generatedId("spromo");
  const existing = requestedId
    ? await dbFirst(db, "SELECT id FROM service_promo_prices WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, requestedId])
    : null;
  if (existing) {
    await dbRun(
      db,
      `UPDATE service_promo_prices
          SET service_id = ?, catalog_price_halalas = ?, promo_price_halalas = ?,
              starts_at = ?, ends_at = ?, is_active = 1, note = ?,
              updated_at = ?, updated_by = COALESCE(?, updated_by)
        WHERE salon_id = ? AND id = ?`,
      [serviceId, Number(service.price_halalas || 0), promoPrice, startsAt, endsAt, note, now, actorUid || null, salonId, id]
    );
    return dbFirst(db, "SELECT * FROM service_promo_prices WHERE id = ? LIMIT 1", [id]);
  }
  await dbRun(
    db,
    `INSERT INTO service_promo_prices (
        id, salon_id, service_id, catalog_price_halalas, promo_price_halalas,
        starts_at, ends_at, is_active, note, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [id, salonId, serviceId, Number(service.price_halalas || 0), promoPrice, startsAt, endsAt, note, now, now, actorUid || null, actorUid || null]
  );
  return dbFirst(db, "SELECT * FROM service_promo_prices WHERE id = ? LIMIT 1", [id]);
}

export async function deactivatePromoPrice(db, salonId, id, actor = {}) {
  const promoId = requiredId(id, "id");
  if (db.__fakeD1) {
    const rows = fakePromoRows(db) || [];
    const row = rows.find((item) => item.salon_id === salonId && item.id === promoId);
    if (!row) throw new AppError(404, "core_not_found:service_promo", "Promo price was not found");
    const actorUid = cleanText(actor?.uid || actor?.firebase_uid || actor?.email);
    saveFakePromoRow(db, {
      ...row,
      is_active: 0,
      updated_at: nowIso(),
      updated_by: actorUid || row.updated_by || null,
    });
    return { ok: true, id: promoId };
  }
  const row = await dbFirst(db, "SELECT id FROM service_promo_prices WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, promoId]);
  if (!row) throw new AppError(404, "core_not_found:service_promo", "Promo price was not found");
  const actorUid = cleanText(actor?.uid || actor?.firebase_uid || actor?.email);
  await dbRun(db, "UPDATE service_promo_prices SET is_active = 0, updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE salon_id = ? AND id = ?", [nowIso(), actorUid || null, salonId, promoId]);
  return { ok: true, id: promoId };
}
