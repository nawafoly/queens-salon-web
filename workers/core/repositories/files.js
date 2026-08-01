// R2 ONLY — binary files must not be stored in D1 or Firestore.
// D1 stores metadata only. Firebase is allowed only for authentication token verification.

import { cleanText, dbAll, dbFirst, dbRun, generatedId, nowIso, optionalText, requiredId, requiredText } from '../d1.js';
import { AppError } from '../errors.js';

function requireBucket(env) {
  if (!env?.FILES_BUCKET) throw new AppError(503, 'files_r2:not_configured', 'R2 files bucket is not configured');
  return env.FILES_BUCKET;
}

export async function listFileMetadata(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM file_metadata WHERE salon_id = ? ORDER BY created_at DESC LIMIT 1000', [salonId]);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const category = cleanText(query.category);
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (category) rows = rows.filter((row) => row.category === category);
  return rows;
}

export async function getFileMetadata(db, salonId, idValue) {
  const id = requiredId(idValue);
  const row = await dbFirst(db, 'SELECT * FROM file_metadata WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!row) throw new AppError(404, 'files_r2:not_found');
  return row;
}

export async function createFileMetadata(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = requiredId(data.id || generatedId('file'));
  const storageKey = requiredText(data.storageKey || data.storage_key || `${salonId}/${id}/${data.fileName || data.file_name || 'file'}`, 'storageKey', 900);
  const row = {
    id,
    salon_id: salonId,
    employee_id: optionalText(data.employeeId || data.employee_id) || null,
    category: requiredText(data.category || 'general', 'category', 120),
    title: optionalText(data.title) || null,
    description: optionalText(data.description) || null,
    file_name: requiredText(data.fileName || data.file_name, 'fileName', 300),
    storage_key: storageKey,
    bucket_name: optionalText(data.bucketName || data.bucket_name) || null,
    content_type: optionalText(data.contentType || data.content_type) || null,
    size_bytes: data.sizeBytes === undefined && data.size_bytes === undefined ? null : Number(data.sizeBytes ?? data.size_bytes),
    status: cleanText(data.status || 'active'),
    visibility: cleanText(data.visibility || 'private'),
    uploaded_by_uid: optionalText(actor.uid) || null,
    replaced_by_file_id: optionalText(data.replacedByFileId || data.replaced_by_file_id) || null,
    replaces_file_id: optionalText(data.replacesFileId || data.replaces_file_id) || null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(db, `INSERT INTO file_metadata
    (id, salon_id, employee_id, category, title, description, file_name, storage_key, bucket_name,
     content_type, size_bytes, status, visibility, uploaded_by_uid, replaced_by_file_id, replaces_file_id,
     created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
  return row;
}

export async function putFileContent(db, salonId, idValue, request, env, options = {}) {
  const metadata = await getFileMetadata(db, salonId, idValue);
  const bucket = requireBucket(env);
  const contentType = request.headers.get('Content-Type') || metadata.content_type || 'application/octet-stream';
  const body = await request.arrayBuffer();
  const maxBytes = Math.max(0, Number(options.maxBytes || 0) || 0);
  if (maxBytes && body.byteLength > maxBytes) {
    throw new AppError(413, 'files_r2:file_too_large', `File exceeds the ${maxBytes} byte limit`);
  }
  await bucket.put(metadata.storage_key, body, { httpMetadata: { contentType } });
  await dbRun(db, 'UPDATE file_metadata SET content_type = ?, size_bytes = ?, updated_at = ? WHERE salon_id = ? AND id = ?', [contentType, body.byteLength, nowIso(), salonId, metadata.id]);
  return getFileMetadata(db, salonId, metadata.id);
}

export async function getFileContent(db, salonId, idValue, env) {
  const metadata = await getFileMetadata(db, salonId, idValue);
  const bucket = requireBucket(env);
  const object = await bucket.get(metadata.storage_key);
  if (!object) throw new AppError(404, 'files_r2:content_not_found');
  const headers = new Headers();
  if (object.httpMetadata?.contentType) headers.set('Content-Type', object.httpMetadata.contentType);
  if (object.httpMetadata?.contentLanguage) headers.set('Content-Language', object.httpMetadata.contentLanguage);
  headers.set('Content-Disposition', `inline; filename="${metadata.file_name.replace(/"/g, '')}"`);
  headers.set('Cache-Control', 'private, max-age=60');
  return new Response(object.body, { headers });
}
