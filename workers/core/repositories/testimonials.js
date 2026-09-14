// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

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
} from '../d1.js';
import { AppError } from '../errors.js';

function mapTestimonial(row) {
  if (!row) return null;
  return {
    id: row.id,
    uid: row.uid ?? null,
    name: row.name || '',
    role: row.role_label || 'عميلة',
    image: row.image_url || '',
    content: row.content || '',
    rating: Number(row.rating || 5),
    vip: Number(row.vip) === 1,
    approved: Number(row.approved) === 1,
    hidden: Number(row.hidden) === 1,
    adminReply: row.admin_reply || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTestimonials(db, salonId, query = {}, { includeHidden = false } = {}) {
  const limit = integer(query.limit, 'limit', { min: 1, max: 100, fallback: 50 });
  let sql = `SELECT * FROM testimonials WHERE salon_id = ?`;
  const params = [salonId];
  if (!includeHidden) {
    sql += ` AND approved = 1 AND hidden = 0`;
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = await dbAll(db, sql, params);
  return rows.map(mapTestimonial);
}

export async function createTestimonial(db, salonId, data = {}, actor = {}) {
  const content = requiredText(data.content, 'content', 2000);
  const name = cleanText(data.name || actor.name || 'عميلة') || 'عميلة';
  const roleLabel = cleanText(data.role || data.roleLabel || data.role_label || 'عميلة') || 'عميلة';
  const imageUrl = cleanText(data.image || data.imageUrl || data.image_url || '');
  const rating = integer(data.rating, 'rating', { min: 1, max: 5, fallback: 5 });
  const vip = activeFlag(data.vip, 0);
  const uid = optionalText(data.uid || actor.uid) || null;
  const id = requiredId(data.id || generatedId('testimonial'), 'id');
  const now = nowIso();

  await dbRun(
    db,
    `INSERT INTO testimonials
      (salon_id, id, uid, name, role_label, image_url, content, rating, vip,
       approved, hidden, admin_reply, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '', ?, ?)`,
    [salonId, id, uid, name, roleLabel, imageUrl, content, rating, vip, now, now]
  );

  return mapTestimonial({
    id,
    uid,
    name,
    role_label: roleLabel,
    image_url: imageUrl,
    content,
    rating,
    vip,
    approved: 1,
    hidden: 0,
    admin_reply: '',
    created_at: now,
    updated_at: now,
  });
}

export async function getTestimonial(db, salonId, idValue) {
  const id = requiredId(idValue, 'id');
  const row = await dbFirst(
    db,
    `SELECT * FROM testimonials WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_testimonials:not_found');
  return row;
}

export async function patchTestimonial(db, salonId, idValue, data = {}) {
  const existing = await getTestimonial(db, salonId, idValue);
  const now = nowIso();
  const hidden =
    data.hidden === undefined ? Number(existing.hidden) : activeFlag(data.hidden, 0);
  const approved =
    data.approved === undefined ? Number(existing.approved) : activeFlag(data.approved, 1);
  const adminReply =
    data.adminReply === undefined && data.admin_reply === undefined
      ? existing.admin_reply || ''
      : cleanText(data.adminReply ?? data.admin_reply ?? '');

  await dbRun(
    db,
    `UPDATE testimonials
        SET hidden = ?, approved = ?, admin_reply = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [hidden, approved, adminReply, now, salonId, existing.id]
  );

  return mapTestimonial({
    ...existing,
    hidden,
    approved,
    admin_reply: adminReply,
    updated_at: now,
  });
}

export async function deleteTestimonial(db, salonId, idValue) {
  const existing = await getTestimonial(db, salonId, idValue);
  await dbRun(db, `DELETE FROM testimonials WHERE salon_id = ? AND id = ?`, [
    salonId,
    existing.id,
  ]);
  return { id: existing.id, deleted: true };
}
