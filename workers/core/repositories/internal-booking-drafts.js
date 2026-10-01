// CORE D1 ONLY — internal booking drafts are working state, not operational bookings.

import { AppError } from '../errors.js';
import {
  changes,
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  requiredId,
} from '../d1.js';

function requireActorUid(actor = {}) {
  const uid = cleanText(actor?.uid);
  if (!uid) throw new AppError(401, 'core_auth:login_required');
  return uid;
}

function normalizeStep(value) {
  const step = Number(value || 1);
  return Number.isInteger(step) && step >= 1 && step <= 4 ? step : 1;
}

function normalizePayload(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const json = JSON.stringify(payload);
  if (json.length > 750_000) {
    throw new AppError(413, 'core_booking_draft:payload_too_large');
  }
  return json;
}

function mapDraft(row) {
  if (!row) return null;
  let draft = {};
  try {
    draft = JSON.parse(cleanText(row.draft_json) || '{}');
  } catch {
    draft = {};
  }
  return {
    ...row,
    current_step: normalizeStep(row.current_step),
    draft,
  };
}

export async function listInternalBookingDrafts(db, salonId, actor = {}) {
  const uid = requireActorUid(actor);
  const rows = await dbAll(
    db,
    `SELECT *
       FROM internal_booking_drafts
      WHERE salon_id = ?
        AND created_by_uid = ?
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 20`,
    [salonId, uid]
  );
  return rows.map(mapDraft);
}

export async function getInternalBookingDraft(db, salonId, idValue, actor = {}) {
  const uid = requireActorUid(actor);
  const id = requiredId(idValue, 'draftId');
  const row = await dbFirst(
    db,
    `SELECT *
       FROM internal_booking_drafts
      WHERE salon_id = ?
        AND id = ?
        AND created_by_uid = ?
        AND deleted_at IS NULL
      LIMIT 1`,
    [salonId, id, uid]
  );
  if (!row) throw new AppError(404, 'core_booking_draft:not_found');
  return mapDraft(row);
}

export async function saveInternalBookingDraft(db, salonId, data = {}, actor = {}) {
  const uid = requireActorUid(actor);
  const requestedId = cleanText(data.id || data.draftId || data.draft_id);
  const id = requestedId ? requiredId(requestedId, 'draftId') : generatedId('booking_draft');
  const title = cleanText(data.title).slice(0, 200) || null;
  const currentStep = normalizeStep(data.currentStep ?? data.current_step);
  const json = normalizePayload(data.draft ?? data.payload ?? {});
  const now = nowIso();

  const existing = await dbFirst(
    db,
    'SELECT id, created_by_uid FROM internal_booking_drafts WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );

  if (existing && cleanText(existing.created_by_uid) !== uid) {
    throw new AppError(403, 'core_booking_draft:forbidden');
  }

  if (existing) {
    await dbRun(
      db,
      `UPDATE internal_booking_drafts
          SET title = ?, current_step = ?, draft_json = ?, updated_at = ?, deleted_at = NULL
        WHERE salon_id = ? AND id = ? AND created_by_uid = ?`,
      [title, currentStep, json, now, salonId, id, uid]
    );
  } else {
    await dbRun(
      db,
      `INSERT INTO internal_booking_drafts
        (id, salon_id, created_by_uid, title, current_step, draft_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [id, salonId, uid, title, currentStep, json, now, now]
    );
  }

  return getInternalBookingDraft(db, salonId, id, actor);
}

export async function deleteInternalBookingDraft(db, salonId, idValue, actor = {}) {
  const uid = requireActorUid(actor);
  const id = requiredId(idValue, 'draftId');
  const now = nowIso();
  const result = await dbRun(
    db,
    `UPDATE internal_booking_drafts
        SET deleted_at = ?, updated_at = ?
      WHERE salon_id = ?
        AND id = ?
        AND created_by_uid = ?
        AND deleted_at IS NULL`,
    [now, now, salonId, id, uid]
  );
  if (changes(result) < 1) throw new AppError(404, 'core_booking_draft:not_found');
  return { id, deleted: true };
}
