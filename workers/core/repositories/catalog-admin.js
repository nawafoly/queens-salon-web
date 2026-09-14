// CORE D1 ONLY — do not add Firestore fallback.

import {
  activeFlag,
  dbAll,
  dbRun,
  generatedId,
  integer,
  nowIso,
  requiredId,
  requiredText,
  updateById,
} from '../d1.js';
import { AppError } from '../errors.js';

function tableFor(kind) {
  if (kind === 'sections') return 'service_sections';
  if (kind === 'categories') return 'service_categories';
  throw new Error('invalid catalog kind');
}

export async function listCatalogRows(db, salonId, kind, query = {}) {
  const table = tableFor(kind);
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (query.active !== undefined && query.active !== '') {
    where.push('active = ?');
    params.push(activeFlag(query.active));
  }
  return dbAll(
    db,
    `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, name ASC`,
    params
  );
}

export async function createCatalogRow(db, salonId, kind, data) {
  const table = tableFor(kind);
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId(kind === 'sections' ? 'section' : 'category')),
    salon_id: salonId,
    name: requiredText(data.name || data.title || data['الاسم'], 'name', 300),
    ...(kind === 'categories' ? { section_id: String(data.sectionId || data.section_id || '').trim() || null } : {}),
    active: activeFlag(data.active, 1),
    sort_order: integer(data.sortOrder ?? data.sort_order ?? data.order, 'sortOrder', { min: 0, max: 1_000_000, fallback: 0 }),
    created_at: now,
    updated_at: now,
  };
  if (kind === 'categories') {
    await dbRun(
      db,
      `INSERT INTO ${table} (id, salon_id, name, section_id, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.salon_id, row.name, row.section_id, row.active, row.sort_order, row.created_at, row.updated_at]
    );
  } else {
    await dbRun(
      db,
      `INSERT INTO ${table} (id, salon_id, name, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.salon_id, row.name, row.active, row.sort_order, row.created_at, row.updated_at]
    );
  }
  return row;
}

export async function patchCatalogRow(db, salonId, kind, id, data) {
  return updateById(db, tableFor(kind), salonId, requiredId(id), {
    name: data.name === undefined && data.title === undefined && data['الاسم'] === undefined
      ? undefined
      : requiredText(data.name || data.title || data['الاسم'], 'name', 300),
    active: data.active === undefined ? undefined : activeFlag(data.active),
    sort_order: data.sortOrder === undefined && data.sort_order === undefined && data.order === undefined
      ? undefined
      : integer(data.sortOrder ?? data.sort_order ?? data.order, 'sortOrder', { min: 0, max: 1_000_000 }),
    ...(kind === 'categories' ? {
      section_id: data.sectionId === undefined && data.section_id === undefined
        ? undefined
        : String(data.sectionId || data.section_id || '').trim() || null,
    } : {}),
  });
}

export async function deleteCatalogRow(db, salonId, kind, id) {
  let cleanId = requiredId(id);
  try { cleanId = decodeURIComponent(cleanId); } catch {}
  const result = await dbRun(db, `DELETE FROM ${tableFor(kind)} WHERE salon_id = ? AND id = ?`, [salonId, cleanId]);
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  if (!changes) {
    throw new AppError(404, 'core_not_found:catalog_row', 'Catalog row was not deleted');
  }
  return { id: cleanId, deleted: true, changes };
}
