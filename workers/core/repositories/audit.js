// CORE D1 ONLY — do not add Firestore fallback.

import {
  cleanText,
  dbAll,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';

function safeJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function actorField(actor, field) {
  if (typeof actor === 'string') return field === 'uid' ? actor : '';
  return actor?.[field] || '';
}

export function auditInsertStatement(salonId, data = {}, actor = {}) {
  const row = {
    id: requiredId(data.id || generatedId('audit')),
    salon_id: salonId,
    action: cleanText(data.action || 'unknown'),
    entity_type: cleanText(data.entityType || data.entity_type || 'unknown'),
    entity_id: optionalText(data.entityId || data.entity_id) || null,
    description: optionalText(data.description) || null,
    source: optionalText(data.source) || 'core-worker',
    actor_uid: optionalText(data.actorUid || data.actor_uid || actorField(actor, 'uid')) || null,
    actor_email: optionalText(data.actorEmail || data.actor_email || actorField(actor, 'email')) || null,
    actor_name: optionalText(data.actorName || data.actor_name || actorField(actor, 'name')) || null,
    before_json: safeJson(data.before),
    after_json: safeJson(data.after),
    meta_json: safeJson(data.meta),
    created_at: optionalText(data.createdAt || data.created_at) || nowIso(),
  };

  return {
    row,
    statement: {
      sql: `INSERT INTO audit_logs
      (id, salon_id, action, entity_type, entity_id, description, source,
       actor_uid, actor_email, actor_name, before_json, after_json, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id,
        row.salon_id,
        row.action,
        row.entity_type,
        row.entity_id,
        row.description,
        row.source,
        row.actor_uid,
        row.actor_email,
        row.actor_name,
        row.before_json,
        row.after_json,
        row.meta_json,
        row.created_at,
      ],
    },
  };
}

export async function recordAudit(db, salonId, data = {}, actor = {}) {
  const { row, statement } = auditInsertStatement(salonId, data, actor);
  await dbRun(db, statement.sql, statement.params);
  return row;
}

export async function listAudit(db, salonId, query = {}) {
  const entityType = optionalText(query.entityType || query.entity_type);
  const entityId = optionalText(query.entityId || query.entity_id);
  const action = optionalText(query.action);
  const limit = Math.max(1, Math.min(500, Number(query.limit || 200) || 200));

  const where = ['salon_id = ?'];
  const params = [salonId];
  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    where.push('entity_id = ?');
    params.push(entityId);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  params.push(limit);
  return dbAll(
    db,
    `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    params
  );
}
