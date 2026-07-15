// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import { cleanText, dbAll, dbFirst, dbRun, nowIso, optionalText, requiredText } from '../d1.js';

export async function listSettings(db, salonId, query = {}) {
  const rows = await dbAll(db, 'SELECT * FROM salon_settings WHERE salon_id = ? ORDER BY setting_key', [salonId]);
  const prefix = cleanText(query.prefix);
  return prefix ? rows.filter((row) => cleanText(row.setting_key).startsWith(prefix)) : rows;
}

export async function getSetting(db, salonId, keyValue) {
  const key = requiredText(keyValue, 'settingKey', 160);
  const row = await dbFirst(db, 'SELECT * FROM salon_settings WHERE salon_id = ? AND setting_key = ? LIMIT 1', [salonId, key]);
  if (!row) return null;
  let value = null;
  try { value = JSON.parse(row.value_json); } catch { value = row.value_json; }
  return { ...row, value };
}

export async function upsertSetting(db, salonId, keyValue, data, actor = {}) {
  const key = requiredText(keyValue || data.settingKey || data.setting_key, 'settingKey', 160);
  const value = data.value === undefined ? data : data.value;
  const now = nowIso();
  await dbRun(db, `INSERT INTO salon_settings
    (salon_id, setting_key, value_json, visibility, updated_by_uid, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(salon_id, setting_key) DO UPDATE SET
      value_json = excluded.value_json, visibility = excluded.visibility,
      updated_by_uid = excluded.updated_by_uid, updated_at = excluded.updated_at`, [
    salonId,
    key,
    JSON.stringify(value ?? null),
    cleanText(data.visibility || 'private'),
    optionalText(actor.uid) || null,
    now,
  ]);
  return getSetting(db, salonId, key);
}
