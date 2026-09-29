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

function normalizedClientBirthdate(value) {
  const raw = optionalText(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    throw new AppError(400, 'core_client:invalid_birthdate', 'Birthdate must use YYYY-MM-DD.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getTime() > Date.now()
  ) {
    throw new AppError(400, 'core_client:invalid_birthdate', 'Birthdate is invalid.');
  }
  return raw;
}

function wantsLoyaltySummary(query = {}) {
  const raw = cleanText(
    query.includeLoyalty ?? query.include_loyalty ?? query.loyalty
  ).toLowerCase();
  return ['1', 'true', 'yes'].includes(raw);
}

function wantsClientMetrics(query = {}) {
  const raw = cleanText(
    query.includeMetrics ?? query.include_metrics ?? query.metrics
  ).toLowerCase();
  return ['1', 'true', 'yes'].includes(raw);
}

function clientListLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function clientListOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed)));
}


function clientListSegment(value) {
  const normalized = cleanText(value).toLowerCase();
  return ["vip", "with-bookings", "without-bookings", "active-packages"].includes(normalized)
    ? normalized
    : "all";
}

function clientListLastVisit(value) {
  const normalized = cleanText(value).toLowerCase();
  return ["30-days", "90-days", "never"].includes(normalized)
    ? normalized
    : "all";
}

function clientListSort(value) {
  const normalized = cleanText(value).toLowerCase();
  return ["latest", "most", "newest"].includes(normalized)
    ? normalized
    : "latest";
}


function clientDirectoryFilters(query = {}) {
  const search = cleanText(query.search || query.q).toLowerCase();
  const phone = normalizePhone(search);
  const segment = clientListSegment(query.segment);
  const lastVisit = clientListLastVisit(query.lastVisit);
  const source = cleanText(query.source).toLowerCase();
  const filterNow = nowIso();

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
    ? [search, search, search, search, search, phone || '', phone || '']
    : [];

  const segmentClause =
    segment === "vip"
      ? " AND COALESCE(c.vip, 0) = 1"
      : segment === "with-bookings"
        ? " AND EXISTS (SELECT 1 FROM bookings fb WHERE fb.salon_id = c.salon_id AND fb.client_id = c.id AND fb.deleted_at IS NULL)"
        : segment === "without-bookings"
          ? " AND NOT EXISTS (SELECT 1 FROM bookings fb WHERE fb.salon_id = c.salon_id AND fb.client_id = c.id AND fb.deleted_at IS NULL)"
          : segment === "active-packages"
            ? " AND EXISTS (SELECT 1 FROM client_packages fp WHERE fp.salon_id = c.salon_id AND fp.canonical_client_id = c.canonical_client_id AND fp.status = 'active' AND (fp.expires_at IS NULL OR fp.expires_at >= ?) AND (fp.remaining_sessions > 0 OR fp.reserved_sessions > 0))"
            : "";

  const segmentParams =
    segment === "active-packages" ? [filterNow] : [];

  const lastVisitClause =
    lastVisit === "never"
      ? " AND NOT EXISTS (SELECT 1 FROM bookings fv WHERE fv.salon_id = c.salon_id AND fv.client_id = c.id AND fv.status = 'completed' AND fv.deleted_at IS NULL)"
      : lastVisit === "30-days"
        ? " AND EXISTS (SELECT 1 FROM bookings fv WHERE fv.salon_id = c.salon_id AND fv.client_id = c.id AND fv.status = 'completed' AND fv.deleted_at IS NULL AND fv.booking_date >= date(?, '-30 days'))"
        : lastVisit === "90-days"
          ? " AND EXISTS (SELECT 1 FROM bookings fv WHERE fv.salon_id = c.salon_id AND fv.client_id = c.id AND fv.status = 'completed' AND fv.deleted_at IS NULL AND fv.booking_date >= date(?, '-90 days'))"
          : "";

  const lastVisitParams =
    lastVisit === "30-days" || lastVisit === "90-days"
      ? [filterNow]
      : [];

  const sourceClause =
    source === "combined"
      ? " AND EXISTS (SELECT 1 FROM bookings fs WHERE fs.salon_id = c.salon_id AND fs.client_id = c.id AND fs.deleted_at IS NULL)"
      : source === "client-record"
        ? " AND NOT EXISTS (SELECT 1 FROM bookings fs WHERE fs.salon_id = c.salon_id AND fs.client_id = c.id AND fs.deleted_at IS NULL)"
        : "";

  return {
    clause: `${searchClause}${segmentClause}${lastVisitClause}${sourceClause}`,
    params: [...searchParams, ...segmentParams, ...lastVisitParams],
    search,
    searchParams,
  };
}

export async function listClients(db, salonId, query = {}) {
  const includeLoyalty = wantsLoyaltySummary(query);
  const includeMetrics = wantsClientMetrics(query);
  const limit = clientListLimit(query.limit);
  const offset = clientListOffset(query.offset);
  const sort = clientListSort(query.sort);
  const filters = clientDirectoryFilters(query);

  const searchClause = filters.clause;
  const searchParams = filters.params;
  const selectedOrder =
    sort === "most"
      ? "(SELECT COUNT(*) FROM bookings sb WHERE sb.salon_id = c.salon_id AND sb.client_id = c.id AND sb.deleted_at IS NULL) DESC, c.id DESC"
      : sort === "latest"
        ? "COALESCE((SELECT MAX(sv.booking_date || ' ' || sv.start_time) FROM bookings sv WHERE sv.salon_id = c.salon_id AND sv.client_id = c.id AND sv.status = 'completed' AND sv.deleted_at IS NULL), '') DESC, c.id DESC"
        : "c.created_at DESC, c.id DESC";

  const metricsOrder =
    sort === "most"
      ? "COALESCE(bm.bookings_count, 0) DESC, sc.id DESC"
      : sort === "latest"
        ? "COALESCE(lc.last_visit_date || ' ' || lc.last_visit_time, '') DESC, sc.id DESC"
        : "sc.created_at DESC, sc.id DESC";


  if (includeMetrics) {
    const now = nowIso();
    return dbAll(
      db,
      `WITH selected_clients AS (
         SELECT c.*
           FROM clients c
          WHERE c.salon_id = ?${searchClause}
          ORDER BY ${selectedOrder}
          LIMIT ? OFFSET ?
       ),
       booking_metrics AS (
         SELECT
           b.client_id,
           COUNT(*) AS bookings_count,
           SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed_bookings_count,
           SUM(CASE WHEN b.status IN ('cancelled', 'canceled') THEN 1 ELSE 0 END) AS cancelled_bookings_count,
           SUM(CASE WHEN b.status = 'no_show' THEN 1 ELSE 0 END) AS no_show_bookings_count
         FROM bookings b
         INNER JOIN selected_clients sc
           ON sc.id = b.client_id
         WHERE b.salon_id = ?
           AND b.deleted_at IS NULL
         GROUP BY b.client_id
       ),
       latest_completed_ranked AS (
         SELECT
           b.client_id,
           b.booking_date,
           b.start_time,
           COALESCE(b.completed_at, b.updated_at, b.created_at) AS completed_at,
           ROW_NUMBER() OVER (
             PARTITION BY b.client_id
             ORDER BY b.booking_date DESC, b.start_time DESC, b.created_at DESC
           ) AS rn
         FROM bookings b
         INNER JOIN selected_clients sc
           ON sc.id = b.client_id
         WHERE b.salon_id = ?
           AND b.status = 'completed'
           AND b.deleted_at IS NULL
       ),
       latest_completed AS (
         SELECT
           client_id,
           booking_date AS last_visit_date,
           start_time AS last_visit_time,
           completed_at AS last_completed_at
         FROM latest_completed_ranked
         WHERE rn = 1
       ),
       package_metrics AS (
         SELECT
           cp.canonical_client_id AS client_id,
           COUNT(*) AS active_packages_count,
           COALESCE(SUM(cp.remaining_sessions), 0) AS remaining_package_sessions
         FROM client_packages cp
         INNER JOIN selected_clients sc
           ON sc.canonical_client_id = cp.canonical_client_id
         WHERE cp.salon_id = ?
           AND cp.status = 'active'
           AND (cp.expires_at IS NULL OR cp.expires_at >= ?)
           AND (cp.remaining_sessions > 0 OR cp.reserved_sessions > 0)
         GROUP BY cp.canonical_client_id
       )
       SELECT
         sc.*,
         COALESCE(bm.bookings_count, 0) AS bookings_count,
         COALESCE(bm.completed_bookings_count, 0) AS completed_bookings_count,
         COALESCE(bm.cancelled_bookings_count, 0) AS cancelled_bookings_count,
         COALESCE(bm.no_show_bookings_count, 0) AS no_show_bookings_count,
         lc.last_visit_date,
         lc.last_visit_time,
         lc.last_completed_at,
         COALESCE(pm.active_packages_count, 0) AS active_packages_count,
         COALESCE(pm.remaining_package_sessions, 0) AS remaining_package_sessions
       FROM selected_clients sc
       LEFT JOIN booking_metrics bm
         ON bm.client_id = sc.id
       LEFT JOIN latest_completed lc
         ON lc.client_id = sc.id
       LEFT JOIN package_metrics pm
         ON pm.client_id = sc.canonical_client_id
       ORDER BY ${metricsOrder}`,
      [
        salonId,
        ...searchParams,
        limit,
        offset,
        salonId,
        salonId,
        salonId,
        now,
      ]
    );
  }

  if (includeLoyalty) {
    return dbAll(
      db,
      `WITH selected_clients AS (
         SELECT c.*
           FROM clients c
          WHERE c.salon_id = ?${searchClause}
          ORDER BY c.updated_at DESC, c.id DESC
          LIMIT ? OFFSET ?
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
       ORDER BY sc.updated_at DESC, sc.id DESC`,
      [salonId, ...filters.searchParams, limit, offset, salonId, salonId, salonId]
    );
  }

  const plainSearchClause = filters.search
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
     ORDER BY updated_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [salonId, ...filters.searchParams, limit, offset]
  );
}


export async function getClientDirectorySummary(db, salonId, query = {}) {
  const filters = clientDirectoryFilters(query);

  const row = await dbFirst(
    db,
    `WITH filtered_clients AS (
       SELECT c.id, c.vip, c.status, c.created_at
       FROM clients c
       WHERE c.salon_id = ?${filters.clause}
     ),
     booking_metrics AS (
       SELECT
         b.client_id,
         COUNT(*) AS bookings_count
       FROM bookings b
       INNER JOIN filtered_clients fc
         ON fc.id = b.client_id
       WHERE b.salon_id = ?
         AND b.deleted_at IS NULL
       GROUP BY b.client_id
     )
     SELECT
       COUNT(*) AS total_clients,
       COALESCE(SUM(CASE WHEN COALESCE(fc.vip, 0) = 1 THEN 1 ELSE 0 END), 0) AS vip_clients,
       COALESCE(SUM(
         CASE
           WHEN TRIM(LOWER(COALESCE(fc.status, ''))) IN ('', 'active') THEN 1
           ELSE 0
         END
       ), 0) AS active_clients,
       COALESCE(SUM(
         CASE
           WHEN date(fc.created_at) >= date('now', 'start of month') THEN 1
           ELSE 0
         END
       ), 0) AS new_this_month,
       COALESCE(SUM(COALESCE(bm.bookings_count, 0)), 0) AS total_bookings
     FROM filtered_clients fc
     LEFT JOIN booking_metrics bm
       ON bm.client_id = fc.id`,
    [salonId, ...filters.params, salonId]
  );

  const totalClients = Number(row?.total_clients || 0);
  const totalBookings = Number(row?.total_bookings || 0);

  return {
    totalClients,
    totalBookings,
    activeClients: Number(row?.active_clients || 0),
    newThisMonth: Number(row?.new_this_month || 0),
    vipClients: Number(row?.vip_clients || 0),
    averageBookings: totalClients > 0 ? totalBookings / totalClients : 0,
  };
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

function normalizedClientEmail(value) {
  return cleanText(value).toLowerCase();
}

async function resolveClientIdentity(db, salonId, {
  phone = null,
  email = null,
  firebaseUid = null,
  excludeClientId = null,
} = {}) {
  const matches = [];

  const lookupIdentity = async (kind, sql, bindings) => {
    const rows = await dbAll(db, sql, bindings);

    if (rows.length > 1) {
      throw new AppError(
        409,
        'core_client:identity_ambiguous',
        `Client ${kind} resolves to multiple client records.`
      );
    }

    if (rows.length === 1) {
      matches.push({ kind, row: rows[0] });
    }
  };

  if (firebaseUid) {
    await lookupIdentity(
      'firebase_uid',
      `SELECT * FROM clients
       WHERE salon_id = ?
         AND firebase_uid = ?
         ${excludeClientId ? 'AND id <> ?' : ''}
       LIMIT 2`,
      excludeClientId
        ? [salonId, firebaseUid, excludeClientId]
        : [salonId, firebaseUid]
    );
  }

  if (phone) {
    await lookupIdentity(
      'phone',
      `SELECT * FROM clients
       WHERE salon_id = ?
         AND phone_normalized = ?
         ${excludeClientId ? 'AND id <> ?' : ''}
       LIMIT 2`,
      excludeClientId
        ? [salonId, phone, excludeClientId]
        : [salonId, phone]
    );
  }

  if (email) {
    await lookupIdentity(
      'email',
      `SELECT * FROM clients
       WHERE salon_id = ?
         AND LOWER(TRIM(COALESCE(email, ''))) = ?
         ${excludeClientId ? 'AND id <> ?' : ''}
       LIMIT 2`,
      excludeClientId
        ? [salonId, email, excludeClientId]
        : [salonId, email]
    );
  }

  const clientIds = [...new Set(matches.map(({ row }) => row.id))];

  if (clientIds.length > 1) {
    throw new AppError(
      409,
      'core_client:identity_conflict',
      'Client identity fields resolve to different client records.'
    );
  }

  return {
    client: matches[0]?.row || null,
    matches,
  };
}

export async function createClient(db, salonId, data) {
  const now = nowIso();

  const phone =
    normalizePhone(data.phoneNormalized || data.phone || data.mobile) || null;

  const email =
    normalizedClientEmail(data.email) || null;

  const firebaseUid =
    optionalText(data.firebaseUid || data.uid || data.authUid) || null;

  const identity = await resolveClientIdentity(db, salonId, {
    phone,
    email,
    firebaseUid,
  });

  if (identity.client) {
    return identity.client;
  }

  const rowId = requiredId(data.id || generatedId("client"));

  const row = {
    id: rowId,
    salon_id: salonId,
    name: requiredText(data.name, "name"),
    phone_normalized: phone,
    email,
    firebase_uid: firebaseUid,
    status: cleanText(data.status || "active"),
    notes: optionalText(data.notes || data.note) || null,
    vip: activeFlag(data.vip, 0),
    legacy_client_doc_id:
      optionalText(data.legacyClientDocId || data.legacy_client_doc_id) || null,
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
      (id, salon_id, name, phone_normalized, email, firebase_uid, status,
       notes, vip, legacy_client_doc_id, canonical_client_id, legacy_ids_json,
       created_at, updated_at)
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

export async function upsertImportedClient(db, salonId, data) {
  const phone =
    normalizePhone(data.phoneNormalized || data.phone || data.mobile) || null;

  if (!phone) {
    throw new AppError(
      400,
      'core_client:invalid_phone',
      'A valid Saudi mobile number is required.'
    );
  }

  const email =
    data.email === undefined
      ? null
      : normalizedClientEmail(data.email) || null;

  const firebaseUid =
    optionalText(data.firebaseUid || data.uid || data.authUid) || null;

  const identity = await resolveClientIdentity(db, salonId, {
    phone,
    email,
    firebaseUid,
  });

  const importedData = {
    name: data.name,
    phone,
    ...(data.email !== undefined ? { email } : {}),
    ...(data.firebaseUid !== undefined ||
    data.uid !== undefined ||
    data.authUid !== undefined
      ? { firebaseUid }
      : {}),
    ...(data.vip !== undefined ? { vip: data.vip } : {}),
    ...(data.notes !== undefined || data.note !== undefined
      ? { notes: data.notes ?? data.note }
      : {}),
  };

  if (identity.client) {
    return patchClient(
      db,
      salonId,
      identity.client.id,
      importedData
    );
  }

  return createClient(db, salonId, {
    ...importedData,
    id: data.id || generatedId("client"),
  });
}

export async function patchClient(db, salonId, id, data) {
  const current = await getClient(db, salonId, id);

  const hasPhoneUpdate =
    data.phone !== undefined || data.phoneNormalized !== undefined;

  const requestedPhone = data.phoneNormalized ?? data.phone;

  const phone =
    hasPhoneUpdate ? normalizePhone(requestedPhone) : undefined;

  if (hasPhoneUpdate && !phone) {
    throw new AppError(
      400,
      'core_client:invalid_phone',
      'A valid Saudi mobile number is required.'
    );
  }

  const hasEmailUpdate = data.email !== undefined;
  const email = hasEmailUpdate
    ? normalizedClientEmail(data.email) || null
    : undefined;

  const hasFirebaseUidUpdate =
    data.firebaseUid !== undefined ||
    data.uid !== undefined ||
    data.authUid !== undefined;

  const firebaseUid = hasFirebaseUidUpdate
    ? optionalText(data.firebaseUid || data.uid || data.authUid) || null
    : undefined;

  if (phone) {
    const conflict = await resolveClientIdentity(db, salonId, {
      phone,
      excludeClientId: current.id,
    });

    if (conflict.client) {
      throw new AppError(
        409,
        'core_client:phone_conflict',
        'Another client already uses this mobile number.'
      );
    }
  }

  if (email) {
    const conflict = await resolveClientIdentity(db, salonId, {
      email,
      excludeClientId: current.id,
    });

    if (conflict.client) {
      throw new AppError(
        409,
        'core_client:email_conflict',
        'Another client already uses this email address.'
      );
    }
  }

  if (firebaseUid) {
    const conflict = await resolveClientIdentity(db, salonId, {
      firebaseUid,
      excludeClientId: current.id,
    });

    if (conflict.client) {
      throw new AppError(
        409,
        'core_client:firebase_uid_conflict',
        'Another client already uses this Firebase identity.'
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
      hasEmailUpdate ? email : undefined,

    city:
      data.city === undefined
        ? undefined
        : optionalText(data.city) || null,

    birthdate:
      data.birthdate === undefined
        ? undefined
        : normalizedClientBirthdate(data.birthdate),

    avatar_url:
      data.avatarUrl === undefined && data.avatar_url === undefined
        ? undefined
        : optionalText(data.avatarUrl || data.avatar_url) || null,

    firebase_uid:
      hasFirebaseUidUpdate ? firebaseUid : undefined,

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
      data.legacyClientDocId === undefined &&
      data.legacy_client_doc_id === undefined
        ? undefined
        : optionalText(
            data.legacyClientDocId || data.legacy_client_doc_id
          ) || null,
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
