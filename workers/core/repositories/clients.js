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

function wantsLoyaltySummary(query = {}) {
  const raw = cleanText(
    query.includeLoyalty ?? query.include_loyalty ?? query.loyalty
  ).toLowerCase();
  return ['1', 'true', 'yes'].includes(raw);
}

export async function listClients(db, salonId, query = {}) {
  const includeLoyalty = wantsLoyaltySummary(query);
  const search = cleanText(query.search || query.q).toLowerCase();
  const phone = normalizePhone(search);

  const searchClause = search
    ? ` AND (
         INSTR(LOWER(COALESCE(c.id, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(c.name, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(c.email, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(c.firebase_uid, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(c.phone_normalized, '')), ?) > 0
         OR (? <> '' AND c.phone_normalized = ?)
       )`
    : '';

  const searchParams = search
    ? [
        search,
        search,
        search,
        search,
        search,
        phone || '',
        phone || '',
      ]
    : [];

  if (includeLoyalty) {
    return dbAll(
      db,
      `WITH selected_clients AS (
         SELECT c.*
           FROM clients c
          WHERE c.salon_id = ?${searchClause}
          ORDER BY c.updated_at DESC
          LIMIT 500
       ),
       completed_bookings AS (
         SELECT
           b.id,
           b.client_id,
           CAST(COALESCE(b.total_halalas, 0) / 100 AS INTEGER) AS earned_points,
           COALESCE(b.completed_at, b.updated_at, b.created_at) AS completed_at
         FROM bookings b
         INNER JOIN selected_clients sc
           ON sc.id = b.client_id
         WHERE b.salon_id = ?
           AND b.status = 'completed'
           AND b.deleted_at IS NULL
       ),
       refund_by_booking AS (
         SELECT
           cb.id AS booking_id,
           cb.client_id,
           MIN(
             cb.earned_points,
             CAST(
               COALESCE(
                 SUM(
                   CASE
                     WHEN r.amount_halalas > 0 THEN r.amount_halalas
                     ELSE 0
                   END
                 ),
                 0
               ) / 100
               AS INTEGER
             )
           ) AS reversed_points
         FROM completed_bookings cb
         LEFT JOIN refunds r
           ON r.salon_id = ?
          AND r.booking_id = cb.id
          AND r.status = 'completed'
         GROUP BY cb.id, cb.client_id, cb.earned_points
       ),
       booking_loyalty AS (
         SELECT
           cb.client_id,
           SUM(cb.earned_points) AS loyalty_earned,
           SUM(COALESCE(rb.reversed_points, 0)) AS loyalty_reversed,
           MAX(cb.completed_at) AS last_completed_at
         FROM completed_bookings cb
         LEFT JOIN refund_by_booking rb
           ON rb.booking_id = cb.id
         GROUP BY cb.client_id
       ),
       manual_loyalty AS (
         SELECT
           l.client_id,
           SUM(CASE WHEN l.type = 'redeem' THEN l.points ELSE 0 END) AS redeem_delta,
           SUM(CASE WHEN l.type = 'adjustment' THEN l.points ELSE 0 END) AS adjustment_delta,
           ABS(SUM(CASE WHEN l.type = 'redeem' THEN l.points ELSE 0 END)) AS loyalty_used
         FROM loyalty_point_transactions l
         INNER JOIN selected_clients sc
           ON sc.id = l.client_id
         WHERE l.salon_id = ?
           AND l.type IN ('redeem', 'adjustment')
         GROUP BY l.client_id
       )
       SELECT
         sc.*,
         (
           COALESCE(bl.loyalty_earned, 0)
           - COALESCE(bl.loyalty_reversed, 0)
           + COALESCE(ml.redeem_delta, 0)
           + COALESCE(ml.adjustment_delta, 0)
         ) AS loyalty_balance,
         COALESCE(bl.loyalty_earned, 0) AS loyalty_earned,
         COALESCE(ml.loyalty_used, 0) AS loyalty_used,
         COALESCE(bl.loyalty_reversed, 0) AS loyalty_reversed,
         bl.last_completed_at
       FROM selected_clients sc
       LEFT JOIN booking_loyalty bl
         ON bl.client_id = sc.id
       LEFT JOIN manual_loyalty ml
         ON ml.client_id = sc.id
       ORDER BY sc.updated_at DESC`,
      [salonId, ...searchParams, salonId, salonId, salonId]
    );
  }

  const plainSearchClause = search
    ? ` AND (
         INSTR(LOWER(COALESCE(id, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(name, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(email, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(firebase_uid, '')), ?) > 0
         OR INSTR(LOWER(COALESCE(phone_normalized, '')), ?) > 0
         OR (? <> '' AND phone_normalized = ?)
       )`
    : '';

  return dbAll(
    db,
    `SELECT *
     FROM clients
     WHERE salon_id = ?${plainSearchClause}
     ORDER BY updated_at DESC
     LIMIT 500`,
    [salonId, ...searchParams]
  );
}

export async function getClientLoyaltySummary(db, salonId) {
  const row = await dbFirst(
    db,
    `WITH completed_bookings AS (
       SELECT
         id,
         client_id,
         CAST(COALESCE(total_halalas, 0) / 100 AS INTEGER) AS earned_points
       FROM bookings
       WHERE salon_id = ?
         AND status = 'completed'
         AND deleted_at IS NULL
         AND client_id IS NOT NULL
     ),
     refund_by_booking AS (
       SELECT
         cb.id AS booking_id,
         cb.client_id,
         MIN(
           cb.earned_points,
           CAST(
             COALESCE(
               SUM(
                 CASE
                   WHEN r.amount_halalas > 0 THEN r.amount_halalas
                   ELSE 0
                 END
               ),
               0
             ) / 100
             AS INTEGER
           )
         ) AS reversed_points
       FROM completed_bookings cb
       LEFT JOIN refunds r
         ON r.salon_id = ?
        AND r.booking_id = cb.id
        AND r.status = 'completed'
       GROUP BY cb.id, cb.client_id, cb.earned_points
     ),
     booking_loyalty AS (
       SELECT
         cb.client_id,
         SUM(cb.earned_points) AS loyalty_earned,
         SUM(COALESCE(rb.reversed_points, 0)) AS loyalty_reversed
       FROM completed_bookings cb
       LEFT JOIN refund_by_booking rb
         ON rb.booking_id = cb.id
       GROUP BY cb.client_id
     ),
     manual_loyalty AS (
       SELECT
         client_id,
         SUM(CASE WHEN type = 'redeem' THEN points ELSE 0 END) AS redeem_delta,
         SUM(CASE WHEN type = 'adjustment' THEN points ELSE 0 END) AS adjustment_delta
       FROM loyalty_point_transactions
       WHERE salon_id = ?
         AND type IN ('redeem', 'adjustment')
       GROUP BY client_id
     ),
     client_balances AS (
       SELECT
         c.id,
         c.vip,
         (
           COALESCE(bl.loyalty_earned, 0)
           - COALESCE(bl.loyalty_reversed, 0)
           + COALESCE(ml.redeem_delta, 0)
           + COALESCE(ml.adjustment_delta, 0)
         ) AS loyalty_balance
       FROM clients c
       LEFT JOIN booking_loyalty bl
         ON bl.client_id = c.id
       LEFT JOIN manual_loyalty ml
         ON ml.client_id = c.id
       WHERE c.salon_id = ?
     )
     SELECT
       COUNT(*) AS total_clients,
       COALESCE(SUM(CASE WHEN vip = 1 THEN 1 ELSE 0 END), 0) AS vip_count,
       COALESCE(SUM(CASE WHEN loyalty_balance > 0 THEN 1 ELSE 0 END), 0) AS active_loyalty_count,
       COALESCE(SUM(loyalty_balance), 0) AS total_points
     FROM client_balances`,
    [salonId, salonId, salonId, salonId]
  );

  return {
    totalClients: Number(row?.total_clients || 0),
    vipCount: Number(row?.vip_count || 0),
    activeLoyaltyCount: Number(row?.active_loyalty_count || 0),
    totalPoints: Number(row?.total_points || 0),
  };
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

  let existing = null;
  if (firebaseUid) {
    existing = await dbFirst(
      db,
      "SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ? LIMIT 1",
      [salonId, firebaseUid]
    );
  }
  if (!existing && phone) {
    existing = await dbFirst(
      db,
      "SELECT * FROM clients WHERE salon_id = ? AND phone_normalized = ? LIMIT 1",
      [salonId, phone]
    );
  }
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
    const duplicate = await dbFirst(
      db,
      "SELECT id FROM clients WHERE salon_id = ? AND phone_normalized = ? AND id <> ? LIMIT 1",
      [salonId, phone, current.id]
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
