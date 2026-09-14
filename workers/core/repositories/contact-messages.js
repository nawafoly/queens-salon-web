// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

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
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';

function mapContactMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    subject: row.subject || '',
    message: row.message || '',
    source: row.source ?? null,
    status: row.status || 'new',
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

export async function createContactMessage(db, salonId, data = {}) {
  const name = requiredText(data.name, 'name', 200);
  const message = requiredText(data.message, 'message', 5000);
  const email = cleanText(data.email || '');
  const phone = cleanText(data.phone || '');
  const subject = cleanText(data.subject || '');
  if (email.length > 320) throw new AppError(400, 'core_validation:invalid_text', 'email is invalid');
  if (phone.length > 80) throw new AppError(400, 'core_validation:invalid_text', 'phone is invalid');
  if (subject.length > 300) throw new AppError(400, 'core_validation:invalid_text', 'subject is invalid');

  const source = optionalText(data.source) || 'contact_page';
  if (source.length > 120) throw new AppError(400, 'core_validation:invalid_text', 'source is invalid');

  const id = requiredId(data.id || generatedId('contact'), 'id');
  const createdAt = nowIso();

  await dbRun(
    db,
    `INSERT INTO contact_messages
      (salon_id, id, name, email, phone, subject, message, source, status, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, NULL)`,
    [salonId, id, name, email, phone, subject, message, source, createdAt]
  );

  return mapContactMessage({
    id,
    name,
    email,
    phone,
    subject,
    message,
    source,
    status: 'new',
    created_at: createdAt,
    read_at: null,
  });
}

export async function listContactMessages(db, salonId, query = {}) {
  const limit = integer(query.limit, 'limit', { min: 1, max: 100, fallback: 20 });
  const rows = await dbAll(
    db,
    `SELECT *
       FROM contact_messages
      WHERE salon_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [salonId, limit]
  );
  return rows.map(mapContactMessage);
}

export async function markContactMessageRead(db, salonId, idValue) {
  const id = requiredId(idValue, 'id');
  const existing = await dbFirst(
    db,
    `SELECT *
       FROM contact_messages
      WHERE salon_id = ? AND id = ?
      LIMIT 1`,
    [salonId, id]
  );
  if (!existing) throw new AppError(404, 'core_contact_messages:not_found');

  const readAt = nowIso();
  await dbRun(
    db,
    `UPDATE contact_messages
        SET status = 'read', read_at = ?
      WHERE salon_id = ? AND id = ?`,
    [readAt, salonId, id]
  );

  return mapContactMessage({
    ...existing,
    status: 'read',
    read_at: readAt,
  });
}
