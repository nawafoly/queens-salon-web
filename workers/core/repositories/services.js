// CORE D1 ONLY — do not add Firestore fallback.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
  rowNotFound,
  updateById,
} from '../d1.js';

export async function listServices(db, salonId) {
  return dbAll(db, "SELECT * FROM services WHERE salon_id = ? ORDER BY sort_order, name LIMIT 1000", [salonId]);
}

export async function getService(db, salonId, id) {
  const row = await dbFirst(db, "SELECT * FROM services WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, requiredId(id)]);
  if (!row) rowNotFound("service");
  return row;
}

export async function createService(db, salonId, data) {
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId("service")),
    salon_id: salonId,
    name: requiredText(data.name, "name"),
    category_id: optionalText(data.categoryId || data.category_id) || null,
    description: optionalText(data.description) || null,
    duration_minutes: integer(data.durationMinutes ?? data.duration_minutes, "durationMinutes", { min: 1, max: 720 }),
    price_halalas: integer(data.priceHalalas ?? data.price_halalas, "priceHalalas", { min: 0, max: 10_000_000 }),
    active: activeFlag(data.active, 1),
    image_url: optionalText(data.imageUrl || data.image_url) || null,
    sort_order: integer(data.sortOrder ?? data.sort_order, "sortOrder", { min: 0, max: 1_000_000, fallback: 0 }),
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO services
      (id, salon_id, name, category_id, description, duration_minutes, price_halalas, active, image_url, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.salon_id,
      row.name,
      row.category_id,
      row.description,
      row.duration_minutes,
      row.price_halalas,
      row.active,
      row.image_url,
      row.sort_order,
      row.created_at,
      row.updated_at,
    ]
  );
  return row;
}

export async function patchService(db, salonId, id, data) {
  return updateById(db, "services", salonId, requiredId(id), {
    name: data.name === undefined ? undefined : requiredText(data.name, "name"),
    category_id: data.categoryId === undefined && data.category_id === undefined ? undefined : (optionalText(data.categoryId || data.category_id) || null),
    description: data.description === undefined ? undefined : (optionalText(data.description) || null),
    duration_minutes: data.durationMinutes === undefined && data.duration_minutes === undefined
      ? undefined
      : integer(data.durationMinutes ?? data.duration_minutes, "durationMinutes", { min: 1, max: 720 }),
    price_halalas: data.priceHalalas === undefined && data.price_halalas === undefined
      ? undefined
      : integer(data.priceHalalas ?? data.price_halalas, "priceHalalas", { min: 0, max: 10_000_000 }),
    active: data.active === undefined ? undefined : activeFlag(data.active),
    image_url: data.imageUrl === undefined && data.image_url === undefined ? undefined : (optionalText(data.imageUrl || data.image_url) || null),
    sort_order: data.sortOrder === undefined && data.sort_order === undefined
      ? undefined
      : integer(data.sortOrder ?? data.sort_order, "sortOrder", { min: 0, max: 1_000_000, fallback: 0 }),
  });
}

export function serviceIsActive(row) {
  return Number(row?.active) === 1 && cleanText(row?.name);
}
