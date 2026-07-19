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
import { AppError } from '../errors.js';

function normalizedClientName(value) {
  return cleanText(value).replace(/\s+/gu, ' ');
}

export async function listClients(db, salonId, query = {}) {
  const rows = await dbAll(
    db,
    "SELECT * FROM clients WHERE salon_id = ? ORDER BY updated_at DESC LIMIT 500",
    [salonId]
  );
  const search = cleanText(query.search || query.q).toLowerCase();
  if (!search) return rows;

  const phone = normalizePhone(search);
  return rows.filter((row) => {
    const fields = [
      row.id,
      row.name,
      row.email,
      row.firebase_uid,
      row.phone_normalized,
    ].map((value) => cleanText(value).toLowerCase());
    return fields.some((value) => value.includes(search)) ||
      Boolean(phone && cleanText(row.phone_normalized) === phone);
  });
}

export async function getClient(db, salonId, id) {
  const requestedId = requiredId(id);
  let row = await dbFirst(
    db,
    "SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1",
    [salonId, requestedId]
  );

  if (!row) {
    const alias = await dbFirst(
      db,
      "SELECT canonical_client_id FROM client_aliases WHERE salon_id = ? AND alias_id = ? LIMIT 1",
      [salonId, requestedId]
    );
    if (alias?.canonical_client_id) {
      row = await dbFirst(
        db,
        "SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1",
        [salonId, alias.canonical_client_id]
      );
    }
  }

  if (!row) rowNotFound("client");
  return row;
}

export async function createClient(db, salonId, data) {
  const now = nowIso();
  const phone = normalizePhone(
    data.phoneNormalized || data.phone || data.mobile
  ) || null;
  const firebaseUid =
    optionalText(data.firebaseUid || data.uid || data.authUid) || null;

  const existingRows = await listClients(db, salonId);
  const existing = existingRows.find(
    (row) =>
      (firebaseUid && cleanText(row.firebase_uid) === firebaseUid) ||
      (phone && cleanText(row.phone_normalized) === phone)
  );
  if (existing) return existing;

  const rowId = requiredId(data.id || generatedId("client"));
  const row = {
    id: rowId,
    salon_id: salonId,
    name: requiredText(data.name, "name"),
    phone_normalized: phone,
    email: optionalText(data.email) || null,
    firebase_uid: firebaseUid,
    status: cleanText(data.status || "active"),
    notes: optionalText(data.notes || data.note) || null,
    vip: activeFlag(data.vip, 0),
    legacy_client_doc_id: optionalText(data.legacyClientDocId || data.legacy_client_doc_id) || null,
    canonical_client_id: rowId,
    legacy_ids_json: JSON.stringify(
      [data.legacyClientDocId || data.legacy_client_doc_id].filter(Boolean)
    ),
    created_at: now,
    updated_at: now,
  };

  await dbRun(
    db,
    `INSERT INTO clients
      (id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, vip, legacy_client_doc_id,
       canonical_client_id, legacy_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.salon_id,
      row.name,
      row.phone_normalized,
      row.email,
      row.firebase_uid,
      row.status,
      row.notes,
      row.vip,
      row.legacy_client_doc_id,
      row.canonical_client_id,
      row.legacy_ids_json,
      row.created_at,
      row.updated_at,
    ]
  );
  return row;
}

export async function patchClient(db, salonId, id, data) {
  const current = await getClient(db, salonId, id);
  const hasPhoneUpdate =
    data.phone !== undefined || data.phoneNormalized !== undefined;
  const requestedPhone = data.phoneNormalized ?? data.phone;
  const phone = hasPhoneUpdate ? normalizePhone(requestedPhone) : undefined;

  if (hasPhoneUpdate && !phone) {
    throw new AppError(
      400,
      'core_client:invalid_phone',
      'A valid Saudi mobile number is required.'
    );
  }

  if (phone) {
    const existingRows = await listClients(db, salonId);
    const duplicate = existingRows.find(
      (row) =>
        row.id !== current.id && cleanText(row.phone_normalized) === phone
    );
    if (duplicate) {
      throw new AppError(
        409,
        'core_client:phone_conflict',
        'Another client already uses this mobile number.'
      );
    }
  }

  return updateById(db, "clients", salonId, current.id, {
    name:
      data.name === undefined
        ? undefined
        : requiredText(normalizedClientName(data.name), "name"),
    phone_normalized:
      hasPhoneUpdate ? phone : undefined,
    email:
      data.email === undefined
        ? undefined
        : optionalText(data.email) || null,
    firebase_uid:
      data.firebaseUid === undefined && data.uid === undefined
        ? undefined
        : optionalText(data.firebaseUid || data.uid) || null,
    status:
      data.status === undefined
        ? undefined
        : cleanText(data.status || "active"),
    notes:
      data.notes === undefined && data.note === undefined
        ? undefined
        : optionalText(data.notes || data.note) || null,
    vip:
      data.vip === undefined
        ? undefined
        : activeFlag(data.vip),
    legacy_client_doc_id:
      data.legacyClientDocId === undefined && data.legacy_client_doc_id === undefined
        ? undefined
        : optionalText(data.legacyClientDocId || data.legacy_client_doc_id) || null,
  });
}

export async function upsertClientAlias(
  db,
  salonId,
  aliasId,
  canonicalClientId,
  aliasType = "legacy"
) {
  const alias = cleanText(aliasId);
  if (!alias || alias === canonicalClientId) return null;
  await dbRun(
    db,
    `INSERT OR REPLACE INTO client_aliases
      (salon_id, alias_id, canonical_client_id, alias_type, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      salonId,
      alias,
      requiredId(canonicalClientId, "canonicalClientId"),
      aliasType,
      nowIso(),
    ]
  );
  return {
    salon_id: salonId,
    alias_id: alias,
    canonical_client_id: canonicalClientId,
    alias_type: aliasType,
  };
}

export async function clientActiveValue(value) {
  return activeFlag(value);
}
