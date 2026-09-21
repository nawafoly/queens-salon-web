// Authenticated client self-service reads. Core D1 remains the source of truth
// for bookings, payment/refund state, loyalty, and published offers.

import {
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
} from '../d1.js';
import { AppError } from '../errors.js';
import { listBookings } from './bookings.js';
import { getClientCashbackWallet } from './cashback.js';

const HALALAS_PER_POINT = 100; // 1 point per paid SAR; change in one place only.
const LOYALTY_LEVELS = [
  { key: 'bronze', label: 'برونزي', min: 0 },
  { key: 'silver', label: 'فضي', min: 300 },
  { key: 'gold', label: 'ذهبي', min: 900 },
  { key: 'vip', label: 'VIP', min: 1800 },
];

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  try {
    const parsed = JSON.parse(cleanText(value) || '[]');
    return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function identityValues(identity = {}) {
  const claims = identity.claims || {};
  return {
    uid: cleanText(identity.uid),
    email: cleanText(claims.email).toLowerCase(),
    phone: normalizePhone(claims.phone_number || claims.phone || claims.mobile),
    name: cleanText(claims.name || claims.displayName || claims.email?.split?.('@')?.[0] || 'عميلة'),
  };
}

async function uniqueClient(db, sql, params, ambiguousCode) {
  const rows = await dbAll(db, sql, params);
  if (rows.length > 1) throw new AppError(409, ambiguousCode, 'Multiple client records match the signed-in identity');
  return rows[0] || null;
}

export async function resolveSelfClient(db, salonId, identity, { createIfMissing = true } = {}) {
  const values = identityValues(identity);
  if (!values.uid) throw new AppError(401, 'core_auth:login_required');

  let client = await uniqueClient(
    db,
    'SELECT * FROM clients WHERE salon_id = ? AND firebase_uid = ? LIMIT 2',
    [salonId, values.uid],
    'core_client:ambiguous_uid'
  );

  if (!client) {
    const alias = await dbFirst(
      db,
      'SELECT canonical_client_id FROM client_aliases WHERE salon_id = ? AND alias_id = ? LIMIT 1',
      [salonId, values.uid]
    );
    if (alias?.canonical_client_id) {
      client = await dbFirst(
        db,
        'SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1',
        [salonId, alias.canonical_client_id]
      );
    }
  }

  if (!client && values.email) {
    client = await uniqueClient(
      db,
      'SELECT * FROM clients WHERE salon_id = ? AND LOWER(COALESCE(email, \'\')) = ? LIMIT 2',
      [salonId, values.email],
      'core_client:ambiguous_email'
    );
  }

  if (!client && values.phone) {
    client = await uniqueClient(
      db,
      'SELECT * FROM clients WHERE salon_id = ? AND phone_normalized = ? LIMIT 2',
      [salonId, values.phone],
      'core_client:ambiguous_phone'
    );
  }

  const now = nowIso();
  if (!client && createIfMissing) {
    const id = generatedId('client');
    await dbRun(
      db,
      `INSERT INTO clients
        (id, salon_id, name, phone_normalized, email, firebase_uid, status, notes, vip, legacy_client_doc_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, 0, NULL, ?, ?)`,
      [id, salonId, values.name || 'عميلة', values.phone || null, values.email || null, values.uid, now, now]
    );
    client = await dbFirst(db, 'SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  }

  if (!client) throw new AppError(404, 'core_client:not_found');

  if (cleanText(client.firebase_uid) !== values.uid) {
    await dbRun(
      db,
      `UPDATE clients
          SET firebase_uid = ?,
              email = COALESCE(NULLIF(email, ''), ?),
              phone_normalized = COALESCE(NULLIF(phone_normalized, ''), ?),
              updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [values.uid, values.email || null, values.phone || null, now, salonId, client.id]
    );
  }

  await dbRun(
    db,
    `INSERT OR IGNORE INTO client_aliases
      (salon_id, alias_id, canonical_client_id, alias_type, created_at)
     VALUES (?, ?, ?, 'firebase_uid', ?)`,
    [salonId, values.uid, client.id, now]
  );

  return (await dbFirst(db, 'SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, client.id])) || client;
}

async function relinkSelfClientData(db, salonId, identity, canonicalClient) {
  const values = identityValues(identity);
  const canonicalId = cleanText(canonicalClient?.id);
  if (!canonicalId || !values.uid) return canonicalClient;

  const email = cleanText(canonicalClient?.email || values.email).toLowerCase();
  const phone = normalizePhone(canonicalClient?.phone_normalized || values.phone);
  const candidates = await dbAll(
    db,
    `SELECT * FROM clients
      WHERE salon_id = ?
        AND (
          id = ?
          OR firebase_uid = ?
          OR (? <> '' AND LOWER(COALESCE(email, '')) = ?)
          OR (? <> '' AND phone_normalized = ?)
        )`,
    [salonId, canonicalId, values.uid, email, email, phone, phone]
  );

  const linkedIds = candidates
    .filter((candidate) => {
      const id = cleanText(candidate.id);
      if (!id) return false;
      if (id === canonicalId) return true;

      const candidateUid = cleanText(candidate.firebase_uid);
      if (candidateUid && candidateUid !== values.uid) return false;

      const sameEmail = email && cleanText(candidate.email).toLowerCase() === email;
      const samePhone = phone && normalizePhone(candidate.phone_normalized) === phone;
      return Boolean(sameEmail || samePhone);
    })
    .map((candidate) => cleanText(candidate.id))
    .filter(Boolean);

  for (const legacyClientId of linkedIds) {
    if (legacyClientId === canonicalId) continue;

    // Administrative bookings created before the portal integration could be
    // attached to a duplicate phone/name client. Move every financial child to
    // the Firebase-linked canonical client so old and future bookings appear in
    // one account and are not counted twice.
    await dbRun(db, 'UPDATE bookings SET client_id = ? WHERE salon_id = ? AND client_id = ?', [canonicalId, salonId, legacyClientId]);
    await dbRun(db, 'UPDATE invoices SET client_id = ? WHERE salon_id = ? AND client_id = ?', [canonicalId, salonId, legacyClientId]);
    await dbRun(db, 'UPDATE payments SET client_id = ? WHERE salon_id = ? AND client_id = ?', [canonicalId, salonId, legacyClientId]);
    await dbRun(db, 'UPDATE refunds SET client_id = ? WHERE salon_id = ? AND client_id = ?', [canonicalId, salonId, legacyClientId]);
    await dbRun(db, 'UPDATE loyalty_point_transactions SET client_id = ? WHERE salon_id = ? AND client_id = ?', [canonicalId, salonId, legacyClientId]);
    await dbRun(
      db,
      `INSERT OR IGNORE INTO client_aliases
        (salon_id, alias_id, canonical_client_id, alias_type, created_at)
       VALUES (?, ?, ?, 'legacy_client_id', ?)`,
      [salonId, legacyClientId, canonicalId, nowIso()]
    );
  }

  return (await dbFirst(db, 'SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, canonicalId])) || canonicalClient;
}

async function resolveCanonicalSelfClient(db, salonId, identity, options = {}) {
  const client = await resolveSelfClient(db, salonId, identity, options);
  return relinkSelfClientData(db, salonId, identity, client);
}

function computedBookingStatus(booking, refundedHalalas) {
  const original = cleanText(booking.status || 'pending').toLowerCase();
  if (['cancelled', 'no_show'].includes(original)) return original;
  if (refundedHalalas > 0) {
    // A refund cannot exceed the collected amount. Comparing against paid first
    // correctly classifies a full refund when the invoice was only partially paid.
    const paid = Number(booking.paid_halalas || 0);
    const total = Number(booking.total_halalas || 0);
    const refundableBase = paid > 0 ? paid : total;
    return refundableBase > 0 && refundedHalalas >= refundableBase
      ? 'refunded'
      : 'partially_refunded';
  }
  return original;
}

export async function listSelfBookings(db, salonId, identity) {
  const client = await resolveCanonicalSelfClient(db, salonId, identity);
  const [bookings, payments, refunds] = await Promise.all([
    listBookings(db, salonId, { clientId: client.id }),
    dbAll(db, `SELECT * FROM payments WHERE salon_id = ? AND client_id = ? ORDER BY COALESCE(paid_at, created_at) DESC`, [salonId, client.id]),
    dbAll(db, `SELECT * FROM refunds WHERE salon_id = ? AND client_id = ? AND status = 'completed' ORDER BY refunded_at DESC`, [salonId, client.id]),
  ]);

  const paymentByBooking = new Map();
  for (const row of payments) {
    const bookingId = cleanText(row.booking_id);
    if (bookingId && !paymentByBooking.has(bookingId)) paymentByBooking.set(bookingId, row);
  }
  const refundsByBooking = new Map();
  for (const row of refunds) {
    const bookingId = cleanText(row.booking_id);
    if (!bookingId) continue;
    const current = refundsByBooking.get(bookingId) || { total: 0, rows: [] };
    current.total += Number(row.amount_halalas || 0);
    current.rows.push(row);
    refundsByBooking.set(bookingId, current);
  }

  return bookings.map((booking) => {
    const refundState = refundsByBooking.get(cleanText(booking.id)) || { total: 0, rows: [] };
    const payment = paymentByBooking.get(cleanText(booking.id));
    const clientBooking = { ...booking };
    delete clientBooking.admin_notes;
    delete clientBooking.adminNotes;
    return {
      ...clientBooking,
      status: computedBookingStatus(booking, refundState.total),
      original_status: booking.status,
      payment_method: payment?.method || null,
      payment_provider: payment?.provider || null,
      refunded_halalas: refundState.total,
      refunds: refundState.rows,
    };
  });
}

async function insertLoyaltyMovement(db, row) {
  await dbRun(
    db,
    `INSERT OR IGNORE INTO loyalty_point_transactions
      (id, salon_id, client_id, type, points, booking_id, refund_id, reason, idempotency_key, created_at, created_by_uid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.salonId, row.clientId, row.type, row.points, row.bookingId || null, row.refundId || null, row.reason, row.idempotencyKey, row.createdAt, row.createdByUid || null]
  );
}

export async function syncClientLoyalty(db, salonId, clientId) {
  const [completed, refunds] = await Promise.all([
    dbAll(
      db,
      `SELECT id, total_halalas, completed_at, updated_at
         FROM bookings
        WHERE salon_id = ? AND client_id = ? AND status = 'completed' AND deleted_at IS NULL`,
      [salonId, clientId]
    ),
    dbAll(
      db,
      `SELECT id, booking_id, amount_halalas, refunded_at, created_by_uid
         FROM refunds
        WHERE salon_id = ? AND client_id = ? AND status = 'completed'
        ORDER BY booking_id ASC, refunded_at ASC, id ASC`,
      [salonId, clientId]
    ),
  ]);

  // Rebuild only movements generated by booking/refund synchronization. Manual
  // adjustments and redemptions are never deleted. This also makes edits and
  // voids deterministic instead of leaving stale point amounts in the ledger.
  await dbRun(
    db,
    `DELETE FROM loyalty_point_transactions
      WHERE salon_id = ? AND client_id = ?
        AND (id LIKE 'loyalty_earn_%' OR id LIKE 'loyalty_refund_%')`,
    [salonId, clientId]
  );

  const completedById = new Map();
  for (const booking of completed) {
    const points = Math.max(0, Math.floor(Number(booking.total_halalas || 0) / HALALAS_PER_POINT));
    completedById.set(cleanText(booking.id), { ...booking, points });
    if (!points) continue;
    await insertLoyaltyMovement(db, {
      id: `loyalty_earn_${booking.id}`,
      salonId,
      clientId,
      type: 'earn',
      points,
      bookingId: booking.id,
      reason: 'حجز مكتمل',
      idempotencyKey: `booking_completed:${booking.id}`,
      createdAt: booking.completed_at || booking.updated_at || nowIso(),
    });
  }

  // Refund points are calculated cumulatively per booking. This prevents split
  // refunds from losing points because of per-refund rounding, and caps the
  // reversal at the points earned by the completed booking.
  const refundStateByBooking = new Map();
  for (const refund of refunds) {
    const bookingId = cleanText(refund.booking_id);
    const completedBooking = completedById.get(bookingId);
    if (!bookingId || !completedBooking?.points) continue;

    const state = refundStateByBooking.get(bookingId) || { refundedHalalas: 0, reversedPoints: 0 };
    state.refundedHalalas += Math.max(0, Number(refund.amount_halalas || 0));
    const targetReversal = Math.min(
      completedBooking.points,
      Math.floor(state.refundedHalalas / HALALAS_PER_POINT)
    );
    const points = Math.max(0, targetReversal - state.reversedPoints);
    state.reversedPoints = targetReversal;
    refundStateByBooking.set(bookingId, state);
    if (!points) continue;

    await insertLoyaltyMovement(db, {
      id: `loyalty_refund_${refund.id}`,
      salonId,
      clientId,
      type: 'refund',
      points: -points,
      bookingId,
      refundId: refund.id,
      reason: 'عكس نقاط استرجاع',
      idempotencyKey: `refund:${refund.id}`,
      createdAt: refund.refunded_at || nowIso(),
      createdByUid: refund.created_by_uid,
    });
  }
}

function loyaltyLevel(points) {
  let current = LOYALTY_LEVELS[0];
  for (const level of LOYALTY_LEVELS) if (points >= level.min) current = level;
  const index = LOYALTY_LEVELS.indexOf(current);
  const next = LOYALTY_LEVELS[index + 1] || null;
  const span = next ? Math.max(1, next.min - current.min) : 1;
  const progress = next ? Math.max(0, Math.min(100, Math.round(((points - current.min) / span) * 100))) : 100;
  return { current, next, progress, pointsToNext: next ? Math.max(0, next.min - points) : 0, number: index + 1 };
}

export async function getClientLoyaltyById(db, salonId, clientId) {
  const id = requiredId(clientId, 'clientId');
  const client = await dbFirst(db, 'SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!client) throw new AppError(404, 'core_client:not_found');
  await syncClientLoyalty(db, salonId, id);
  const rows = await dbAll(
    db,
    'SELECT * FROM loyalty_point_transactions WHERE salon_id = ? AND client_id = ? ORDER BY created_at DESC, id DESC LIMIT 500',
    [salonId, id]
  );
  const earned = rows.filter((row) => Number(row.points || 0) > 0).reduce((sum, row) => sum + Number(row.points || 0), 0);
  const used = Math.abs(rows.filter((row) => cleanText(row.type) === 'redeem').reduce((sum, row) => sum + Number(row.points || 0), 0));
  const reversed = Math.abs(rows.filter((row) => cleanText(row.type) === 'refund').reduce((sum, row) => sum + Number(row.points || 0), 0));
  const balance = Math.max(0, rows.reduce((sum, row) => sum + Number(row.points || 0), 0));
  const level = loyaltyLevel(balance);
  return {
    clientId: id,
    membershipId: cleanText(id).slice(-8).toUpperCase(),
    balance,
    earned,
    used,
    reversed,
    level: level.number,
    levelKey: level.current.key,
    levelLabel: level.current.label,
    progress: level.progress,
    pointsToNext: level.pointsToNext,
    nextLevelLabel: level.next?.label || null,
    conversion: { halalasPerPoint: HALALAS_PER_POINT, label: 'نقطة واحدة لكل ريال من قيمة الحجز المكتمل' },
    transactions: rows,
  };
}

export async function getSelfLoyalty(db, salonId, identity) {
  const client = await resolveCanonicalSelfClient(db, salonId, identity);
  return getClientLoyaltyById(db, salonId, client.id);
}

export async function getSelfCashback(db, salonId, identity) {
  const client = await resolveCanonicalSelfClient(db, salonId, identity);
  return getClientCashbackWallet(db, salonId, client.id);
}

function safeJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function getAdminClientOverview(db, salonId, clientId) {
  const id = requiredId(clientId, 'clientId');
  const client = await dbFirst(db, 'SELECT * FROM clients WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!client) throw new AppError(404, 'core_client:not_found');

  const [
    bookings,
    payments,
    refunds,
    loyalty,
    cashback,
    preference,
    specialistRows,
    serviceRows,
  ] = await Promise.all([
    listBookings(db, salonId, { clientId: id }),
    dbAll(db, `SELECT * FROM payments WHERE salon_id = ? AND client_id = ? ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 500`, [salonId, id]),
    dbAll(db, `SELECT * FROM refunds WHERE salon_id = ? AND client_id = ? ORDER BY refunded_at DESC LIMIT 500`, [salonId, id]),
    getClientLoyaltyById(db, salonId, id),
    getClientCashbackWallet(db, salonId, id),
    dbFirst(
      db,
      `SELECT cp.preferred_staff_id, cp.preferred_staff_source, s.name AS preferred_staff_name
         FROM client_preferences cp
         LEFT JOIN staff s
           ON s.salon_id = cp.salon_id
          AND s.id = cp.preferred_staff_id
        WHERE cp.salon_id = ?
          AND cp.client_id = ?
        LIMIT 1`,
      [salonId, id]
    ),
    dbAll(
      db,
      `SELECT
          COALESCE(bi.staff_id, b.staff_id) AS staff_id,
          s.name AS staff_name,
          COUNT(*) AS visit_count
        FROM bookings b
        JOIN booking_items bi
          ON bi.salon_id = b.salon_id
         AND bi.booking_id = b.id
        LEFT JOIN staff s
          ON s.salon_id = b.salon_id
         AND s.id = COALESCE(bi.staff_id, b.staff_id)
       WHERE b.salon_id = ?
         AND b.client_id = ?
         AND b.status = 'completed'
         AND b.deleted_at IS NULL
         AND COALESCE(bi.staff_id, b.staff_id) IS NOT NULL
       GROUP BY COALESCE(bi.staff_id, b.staff_id), s.name
       ORDER BY visit_count DESC, s.name
       LIMIT 5`,
      [salonId, id]
    ),
    dbAll(
      db,
      `SELECT
          bi.service_id,
          bi.service_name_snapshot AS service_name,
          COUNT(*) AS visit_count
        FROM bookings b
        JOIN booking_items bi
          ON bi.salon_id = b.salon_id
         AND bi.booking_id = b.id
       WHERE b.salon_id = ?
         AND b.client_id = ?
         AND b.status = 'completed'
         AND b.deleted_at IS NULL
       GROUP BY bi.service_id, bi.service_name_snapshot
       ORDER BY visit_count DESC, bi.service_name_snapshot
       LIMIT 5`,
      [salonId, id]
    ),
  ]);

  const completedRefunds = refunds.filter((row) => cleanText(row.status) === 'completed');
  const paidHalalas = payments
    .filter((row) => ['completed', 'paid', 'succeeded', 'success'].includes(cleanText(row.status).toLowerCase()))
    .reduce((sum, row) => sum + Math.max(0, Number(row.amount_halalas || 0)), 0);
  const refundedHalalas = completedRefunds.reduce((sum, row) => sum + Math.max(0, Number(row.amount_halalas || 0)), 0);
  const offersUsedMap = new Map();
  for (const booking of bookings) {
    const snapshot = safeJsonObject(booking.discount_snapshot_json);
    const offerId = cleanText(snapshot.offerId || snapshot.discountId || snapshot.id);
    const code = cleanText(snapshot.code || snapshot.couponCode);
    const key = offerId || code;
    if (!key) continue;
    if (!offersUsedMap.has(key)) {
      offersUsedMap.set(key, {
        id: offerId || null,
        code: code || null,
        title: cleanText(snapshot.name || snapshot.title || snapshot.label) || 'عرض/خصم',
        bookingId: booking.id,
        usedAt: booking.completed_at || booking.created_at,
      });
    }
  }

  const activityDates = [
    client.updated_at,
    ...bookings.flatMap((row) => [row.updated_at, row.completed_at, row.cancelled_at]),
    ...payments.flatMap((row) => [row.paid_at, row.created_at]),
    ...refunds.flatMap((row) => [row.refunded_at, row.created_at]),
    ...loyalty.transactions.map((row) => row.created_at),
    ...cashback.transactions.map((row) => row.created_at),
  ].map(cleanText).filter(Boolean).sort((a, b) => b.localeCompare(a));

  const completedBookings = bookings.filter(
    (row) => cleanText(row.status).toLowerCase() === 'completed'
  );
  const cancelledBookings = bookings.filter((row) =>
    ['cancelled', 'canceled'].includes(cleanText(row.status).toLowerCase())
  );
  const noShowBookings = bookings.filter(
    (row) => cleanText(row.status).toLowerCase() === 'no_show'
  );
  const netPaidHalalas = Math.max(0, paidHalalas - refundedHalalas);

  return {
    client,
    bookings,
    payments,
    refunds,
    loyalty,
    cashback,
    offersUsed: [...offersUsedMap.values()],
    relationship: {
      preferredSpecialist: cleanText(preference?.preferred_staff_id)
        ? {
            id: cleanText(preference.preferred_staff_id),
            name:
              cleanText(preference.preferred_staff_name) ||
              cleanText(preference.preferred_staff_id),
            source: cleanText(preference.preferred_staff_source) || null,
          }
        : null,
      mostBookedSpecialists: specialistRows.map((row) => ({
        id: cleanText(row.staff_id),
        name: cleanText(row.staff_name) || cleanText(row.staff_id),
        visits: Number(row.visit_count || 0),
      })),
      mostBookedServices: serviceRows.map((row) => ({
        id: cleanText(row.service_id),
        name: cleanText(row.service_name) || cleanText(row.service_id),
        visits: Number(row.visit_count || 0),
      })),
    },
    summary: {
      bookings: bookings.length,
      completedBookings: completedBookings.length,
      cancelledBookings: cancelledBookings.length,
      noShowBookings: noShowBookings.length,
      paidHalalas,
      refundedHalalas,
      netPaidHalalas,
      averageCompletedVisitHalalas: completedBookings.length
        ? Math.round(netPaidHalalas / completedBookings.length)
        : 0,
      lastActivityAt: activityDates[0] || client.updated_at || client.created_at || null,
    },
  };
}

export async function adjustClientLoyalty(db, salonId, clientId, data, actorUid = '') {
  const id = requiredId(clientId, 'clientId');
  const operationId = requiredId(data.operationId || data.operation_id, 'operationId');
  const reason = requiredText(data.reason, 'reason', 500);
  const points = Number(data.points);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100000) {
    throw new AppError(400, 'core_loyalty:invalid_points');
  }
  const client = await dbFirst(db, 'SELECT id FROM clients WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!client) throw new AppError(404, 'core_client:not_found');
  const now = nowIso();
  await insertLoyaltyMovement(db, {
    id: `loyalty_adjustment_${operationId}`,
    salonId,
    clientId: id,
    type: 'adjustment',
    points,
    reason,
    idempotencyKey: `admin_adjustment:${operationId}`,
    createdAt: now,
    createdByUid: actorUid,
  });
  return getClientLoyaltyById(db, salonId, id);
}

export async function listSelfOffers(db, salonId, identity) {
  const client = await resolveCanonicalSelfClient(db, salonId, identity);
  const now = nowIso();
  const rows = await dbAll(
    db,
    `SELECT * FROM discounts
      WHERE salon_id = ?
        AND deleted_at IS NULL
        AND active = 1
        AND COALESCE(published, 1) = 1
        AND COALESCE(status, 'active') NOT IN ('draft', 'disabled', 'expired')
        AND (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
        AND (ends_at IS NULL OR ends_at = '' OR ends_at >= ?)
      ORDER BY COALESCE(sort_order, 0) ASC, created_at DESC
      LIMIT 100`,
    [salonId, now, now]
  );
  return rows.filter((row) => {
    const scope = cleanText(row.target_scope || 'all').toLowerCase();
    if (!scope || scope === 'all') return true;
    const ids = parseJsonArray(row.target_client_ids_json);
    return ids.includes(client.id) || ids.includes(cleanText(identity.uid));
  });
}

export async function getSelfProfile(db, salonId, identity) {
  const client = await resolveCanonicalSelfClient(db, salonId, identity);
  const bookings = await listSelfBookings(db, salonId, identity);
  const counts = {
    total: bookings.length,
    completed: 0,
    upcoming: 0,
    cancelled: 0,
    pending: 0,
    confirmed: 0,
  };
  const now = Date.now();
  for (const booking of bookings) {
    const status = cleanText(booking.status);
    if (status === 'completed') counts.completed += 1;
    if (status === 'cancelled') counts.cancelled += 1;
    if (status === 'pending') counts.pending += 1;
    if (status === 'confirmed') counts.confirmed += 1;
    const at = Date.parse(`${booking.booking_date || ''}T${booking.start_time || '00:00'}:00`);
    if (Number.isFinite(at) && at > now && !['cancelled', 'completed', 'refunded'].includes(status)) counts.upcoming += 1;
  }
  return {
    ...client,
    city: client.city || '',
    birthdate: client.birthdate || '',
    avatarUrl: client.avatar_url || '',
    membershipId: client.membership_id || '',
    membershipPercent: Number(client.membership_percent || 0),
    counts,
  };
}

export async function patchSelfProfile(db, salonId, identity, data) {
  const client = await resolveCanonicalSelfClient(db, salonId, identity);
  const name = data.name === undefined ? client.name : requiredText(data.name, 'name');
  const phone = data.phone === undefined && data.phoneNormalized === undefined
    ? client.phone_normalized
    : normalizePhone(data.phoneNormalized || data.phone) || null;
  const email = data.email === undefined ? client.email : optionalText(data.email)?.toLowerCase() || null;
  const city = data.city === undefined ? (client.city || null) : (optionalText(data.city) || null);
  const birthdate = data.birthdate === undefined ? (client.birthdate || null) : (optionalText(data.birthdate) || null);
  const avatarUrl =
    data.avatarUrl === undefined && data.avatar_url === undefined
      ? (client.avatar_url || null)
      : (optionalText(data.avatarUrl || data.avatar_url) || null);
  const membershipId =
    data.membershipId === undefined && data.membership_id === undefined
      ? (client.membership_id || null)
      : (optionalText(data.membershipId || data.membership_id) || null);
  const membershipPercent =
    data.membershipPercent === undefined && data.membership_percent === undefined
      ? Number(client.membership_percent || 0)
      : Number(data.membershipPercent ?? data.membership_percent ?? 0);
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE clients
        SET name = ?, phone_normalized = ?, email = ?, city = ?, birthdate = ?,
            avatar_url = ?, membership_id = ?, membership_percent = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [name, phone, email, city, birthdate, avatarUrl, membershipId, membershipPercent, now, salonId, client.id]
  );
  // Keep app_users display fields in sync for the signed-in Firebase uid.
  const uid = cleanText(identity?.uid);
  if (uid) {
    await dbRun(
      db,
      `UPDATE app_users
          SET display_name = COALESCE(NULLIF(?, ''), display_name),
              phone = COALESCE(?, phone),
              photo_url = COALESCE(?, photo_url),
              email = COALESCE(NULLIF(email, ''), ?),
              updated_at = ?
        WHERE salon_id = ? AND firebase_uid = ?`,
      [name, phone, avatarUrl, email, now, salonId, uid]
    );
  }
  return getSelfProfile(db, salonId, identity);
}

export async function getClientPortalSnapshot(db, salonId, identity) {
  // Resolve/link the account once before parallel reads. Without this guard a
  // first-time account could race and attempt to create more than one client.
  await resolveCanonicalSelfClient(db, salonId, identity);
  const [profile, bookings, loyalty, cashback, offers] = await Promise.all([
    getSelfProfile(db, salonId, identity),
    listSelfBookings(db, salonId, identity),
    getSelfLoyalty(db, salonId, identity),
    getSelfCashback(db, salonId, identity),
    listSelfOffers(db, salonId, identity),
  ]);
  return { profile, bookings, loyalty, cashback, offers, generatedAt: nowIso() };
}
