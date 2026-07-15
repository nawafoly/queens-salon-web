// CORE D1 ONLY — do not add Firestore fallback.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  normalizePhone,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
  rowNotFound,
  updateById,
} from '../d1.js';

export async function listClients(db, salonId) {
  return dbAll(db, "SELECT * FROM clients WHERE salon_id = ? ORDER BY updated_at DESC LIMIT 500", [salonId]);
}

export async function getClient(db, salonId, id) {
  const row = await dbFirst(db, "SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, requiredId(id)]);
  if (!row) rowNotFound("client");
  return row;
}

export async function createClient(db, salonId, data) {
  const now = nowIso();
  const id = requiredId(data.id || generatedId("client"));
  const row = {
    id,
    salon_id: salonId,
    name: requiredText(data.name, "name"),
    phone_normalized: normalizePhone(data.phoneNormalized || data.phone || data.mobile) || null,
    email: optionalText(data.email) || null,
    firebase_uid: optionalText(data.firebaseUid || data.uid || data.authUid) || null,
    status: cleanText(data.status || "active"),
    notes: optionalText(data.notes) || null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO clients
      (id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.salon_id, row.name, row.phone_normalized, row.email, row.firebase_uid, row.status, row.notes, row.created_at, row.updated_at]
  );
  return row;
}

export async function patchClient(db, salonId, id, data) {
  return updateById(db, "clients", salonId, requiredId(id), {
    name: data.name === undefined ? undefined : requiredText(data.name, "name"),
    phone_normalized: data.phone === undefined && data.phoneNormalized === undefined ? undefined : normalizePhone(data.phoneNormalized || data.phone),
    email: data.email === undefined ? undefined : (optionalText(data.email) || null),
    firebase_uid: data.firebaseUid === undefined && data.uid === undefined ? undefined : (optionalText(data.firebaseUid || data.uid) || null),
    status: data.status === undefined ? undefined : cleanText(data.status || "active"),
    notes: data.notes === undefined ? undefined : (optionalText(data.notes) || null),
  });
}

export async function upsertClientAlias(db, salonId, aliasId, canonicalClientId, aliasType = "legacy") {
  const alias = cleanText(aliasId);
  if (!alias || alias === canonicalClientId) return null;
  await dbRun(
    db,
    `INSERT OR REPLACE INTO client_aliases
      (salon_id, alias_id, canonical_client_id, alias_type, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [salonId, alias, requiredId(canonicalClientId, "canonicalClientId"), aliasType, nowIso()]
  );
  return { salon_id: salonId, alias_id: alias, canonical_client_id: canonicalClientId, alias_type: aliasType };
}

export async function clientActiveValue(value) {
  return activeFlag(value);
}
