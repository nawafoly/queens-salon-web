// CORE D1 ONLY — MALIKAT store-credit cashback wallet.
// Cashback is monetary salon credit. It is not cash-withdrawable or transferable.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';

export const DEFAULT_CASHBACK_POLICY = Object.freeze({
  enabled: false,
  earnBasis: 'paid',
  earnBps: 0,
  minimumEligibleHalalas: 0,
  expiryDays: null,
  redeemScope: 'salon_only',
  cashWithdrawalAllowed: false,
  transferAllowed: false,
  excludedServiceIds: [],
  excludedPackageIds: [],
});

function finiteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (Number(value) === 1) return true;
  if (Number(value) === 0) return false;
  const normalized = cleanText(value).toLowerCase();
  if (['true', 'yes', 'on'].includes(normalized)) return true;
  if (['false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => cleanText(item)).filter(Boolean)));
  }
  const raw = cleanText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map((item) => cleanText(item)).filter(Boolean)))
      : [];
  } catch {
    return [];
  }
}

function mapPolicy(row) {
  if (!row) return { ...DEFAULT_CASHBACK_POLICY };
  return {
    enabled: Number(row.enabled) === 1,
    earnBasis: cleanText(row.earn_basis || 'paid') || 'paid',
    earnBps: Math.max(0, Math.min(10000, finiteInteger(row.earn_bps))),
    minimumEligibleHalalas: Math.max(0, finiteInteger(row.minimum_eligible_halalas)),
    expiryDays: row.expiry_days == null ? null : Math.max(1, finiteInteger(row.expiry_days, 1)),
    redeemScope: 'salon_only',
    cashWithdrawalAllowed: false,
    transferAllowed: false,
    excludedServiceIds: parseIdList(row.excluded_service_ids_json),
    excludedPackageIds: parseIdList(row.excluded_package_ids_json),
    updatedAt: cleanText(row.updated_at) || null,
  };
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function addDaysIso(iso, days) {
  if (!days) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export async function getCashbackPolicy(db, salonId) {
  const row = await dbFirst(
    db,
    'SELECT * FROM cashback_policies WHERE salon_id = ? LIMIT 1',
    [salonId]
  );
  return mapPolicy(row);
}

export async function upsertCashbackPolicy(db, salonId, input = {}, actorUid = '') {
  const currentRow = await dbFirst(
    db,
    'SELECT * FROM cashback_policies WHERE salon_id = ? LIMIT 1',
    [salonId]
  );
  const current = mapPolicy(currentRow);

  const enabled = booleanFlag(input.enabled, current.enabled);
  const earnBps = input.earnBps == null && input.earn_bps == null
    ? current.earnBps
    : finiteInteger(input.earnBps ?? input.earn_bps, -1);
  if (earnBps < 0 || earnBps > 10000) {
    throw new AppError(400, 'core_cashback:invalid_earn_bps');
  }

  const minimumEligibleHalalas =
    input.minimumEligibleHalalas == null && input.minimum_eligible_halalas == null
      ? current.minimumEligibleHalalas
      : finiteInteger(input.minimumEligibleHalalas ?? input.minimum_eligible_halalas, -1);
  if (minimumEligibleHalalas < 0) {
    throw new AppError(400, 'core_cashback:invalid_minimum_eligible');
  }

  let expiryDays = current.expiryDays;
  if (
    Object.prototype.hasOwnProperty.call(input, 'expiryDays') ||
    Object.prototype.hasOwnProperty.call(input, 'expiry_days')
  ) {
    const rawExpiry = input.expiryDays ?? input.expiry_days;
    if (rawExpiry === null || rawExpiry === '') {
      expiryDays = null;
    } else {
      expiryDays = finiteInteger(rawExpiry, 0);
      if (expiryDays <= 0 || expiryDays > 3650) {
        throw new AppError(400, 'core_cashback:invalid_expiry_days');
      }
    }
  }

  const excludedServiceIds =
    input.excludedServiceIds === undefined && input.excluded_service_ids === undefined
      ? current.excludedServiceIds
      : parseIdList(input.excludedServiceIds ?? input.excluded_service_ids);
  const excludedPackageIds =
    input.excludedPackageIds === undefined && input.excluded_package_ids === undefined
      ? current.excludedPackageIds
      : parseIdList(input.excludedPackageIds ?? input.excluded_package_ids);

  const now = nowIso();
  await dbRun(
    db,
    `INSERT INTO cashback_policies
      (salon_id, enabled, earn_basis, earn_bps, minimum_eligible_halalas, expiry_days,
       redeem_scope, cash_withdrawal_allowed, transfer_allowed,
       excluded_service_ids_json, excluded_package_ids_json, created_at, updated_at)
     VALUES (?, ?, 'paid', ?, ?, ?, 'salon_only', 0, 0, ?, ?, ?, ?)
     ON CONFLICT(salon_id) DO UPDATE SET
       enabled = excluded.enabled,
       earn_basis = 'paid',
       earn_bps = excluded.earn_bps,
       minimum_eligible_halalas = excluded.minimum_eligible_halalas,
       expiry_days = excluded.expiry_days,
       redeem_scope = 'salon_only',
       cash_withdrawal_allowed = 0,
       transfer_allowed = 0,
       excluded_service_ids_json = excluded.excluded_service_ids_json,
       excluded_package_ids_json = excluded.excluded_package_ids_json,
       updated_at = excluded.updated_at`,
    [
      salonId,
      enabled ? 1 : 0,
      earnBps,
      minimumEligibleHalalas,
      expiryDays,
      JSON.stringify(excludedServiceIds),
      JSON.stringify(excludedPackageIds),
      currentRow?.created_at || now,
      now,
    ]
  );

  return {
    ...(await getCashbackPolicy(db, salonId)),
    updatedByUid: cleanText(actorUid) || null,
  };
}

export function calculateCashbackEarnHalalas(eligibleHalalas, earnBps) {
  const basis = Math.max(0, finiteInteger(eligibleHalalas));
  const bps = Math.max(0, Math.min(10000, finiteInteger(earnBps)));
  return Math.floor((basis * bps) / 10000);
}

async function loadCashbackLedgerRows(
  db,
  salonId,
  clientId,
  options = {}
) {
  const maxRows = Math.max(
    1,
    Math.min(20000, finiteInteger(options.maxRows, 10000))
  );
  const pageSize = Math.max(
    50,
    Math.min(1000, finiteInteger(options.pageSize, 500))
  );
  const rows = [];
  let cursorCreatedAt = '';
  let cursorId = '';

  while (rows.length <= maxRows) {
    const hasCursor = Boolean(cursorCreatedAt || cursorId);
    const page = await dbAll(
      db,
      `SELECT id, type, amount_halalas, booking_id, refund_id,
              source_transaction_id, idempotency_key, expires_at,
              created_by_uid, created_at, reason
         FROM cashback_wallet_transactions
        WHERE salon_id = ?
          AND client_id = ?
          ${
            hasCursor
              ? 'AND (created_at > ? OR (created_at = ? AND id > ?))'
              : ''
          }
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      hasCursor
        ? [salonId, clientId, cursorCreatedAt, cursorCreatedAt, cursorId, pageSize]
        : [salonId, clientId, pageSize]
    );

    if (!page.length) break;
    rows.push(...page);

    if (rows.length > maxRows) {
      throw new AppError(503, 'core_cashback:ledger_too_large');
    }

    const last = page[page.length - 1];
    cursorCreatedAt = cleanText(last.created_at);
    cursorId = cleanText(last.id);
    if (page.length < pageSize) break;
  }

  return rows;
}

function projectCashbackLedger(rows) {
  const rebuilt = rebuildEarnLots(rows);
  const spendableHalalas =
    rebuilt.unexpiringHalalas +
    rebuilt.lots.reduce(
      (sum, lot) => sum + Math.max(0, finiteInteger(lot.remainingHalalas)),
      0
    );
  const ledgerBalanceHalalas = rows.reduce(
    (sum, row) => sum + finiteInteger(row.amount_halalas),
    0
  );
  const earnedHalalas = rows
    .filter((row) => cleanText(row.type).toLowerCase() === 'earn')
    .reduce(
      (sum, row) => sum + Math.max(0, finiteInteger(row.amount_halalas)),
      0
    );
  const redeemedHalalas = Math.abs(
    rows
      .filter((row) => cleanText(row.type).toLowerCase() === 'redeem')
      .reduce((sum, row) => sum + finiteInteger(row.amount_halalas), 0)
  );
  const reversedHalalas = Math.abs(
    rows
      .filter((row) =>
        ['reverse', 'expire'].includes(cleanText(row.type).toLowerCase())
      )
      .reduce((sum, row) => sum + finiteInteger(row.amount_halalas), 0)
  );

  return {
    ...rebuilt,
    spendableHalalas,
    ledgerBalanceHalalas,
    earnedHalalas,
    redeemedHalalas,
    reversedHalalas,
  };
}

async function getCashbackProjection(db, salonId, clientId, options = {}) {
  const rows = await loadCashbackLedgerRows(
    db,
    salonId,
    clientId,
    options
  );
  return {
    rows,
    ...projectCashbackLedger(rows),
  };
}

export async function recordCashbackMovement(db, salonId, input = {}, actorUid = '') {
  const clientId = requiredId(input.clientId || input.client_id, 'clientId');
  const type = cleanText(input.type).toLowerCase();
  if (!['earn', 'redeem', 'reverse', 'expire', 'adjustment'].includes(type)) {
    throw new AppError(400, 'core_cashback:invalid_type');
  }

  const amountHalalas = finiteInteger(input.amountHalalas ?? input.amount_halalas);
  if (!amountHalalas) throw new AppError(400, 'core_cashback:invalid_amount');

  if (type === 'earn' && amountHalalas < 0) {
    throw new AppError(400, 'core_cashback:earn_must_be_positive');
  }
  if (['redeem', 'reverse', 'expire'].includes(type) && amountHalalas > 0) {
    throw new AppError(400, 'core_cashback:debit_must_be_negative');
  }

  const client = await dbFirst(
    db,
    'SELECT id FROM clients WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, clientId]
  );
  if (!client) throw new AppError(404, 'core_client:not_found');

  if (type === 'redeem' || type === 'expire') {
    const projection = await getCashbackProjection(db, salonId, clientId, {
      maxRows: 10000,
    });
    if (Math.abs(amountHalalas) > projection.spendableHalalas) {
      throw new AppError(409, 'core_cashback:insufficient_balance');
    }
  }

  const idempotencyKey = requiredText(
    input.idempotencyKey || input.idempotency_key,
    'idempotencyKey',
    500
  );
  const reason = requiredText(input.reason, 'reason', 500);
  const createdAt = cleanText(input.createdAt || input.created_at) || nowIso();

  await dbRun(
    db,
    `INSERT OR IGNORE INTO cashback_wallet_transactions
      (id, salon_id, client_id, type, amount_halalas, booking_id, refund_id,
       source_transaction_id, reason, idempotency_key, expires_at, created_by_uid, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      requiredId(input.id || generatedId('cashback')),
      salonId,
      clientId,
      type,
      amountHalalas,
      cleanText(input.bookingId || input.booking_id) || null,
      cleanText(input.refundId || input.refund_id) || null,
      cleanText(input.sourceTransactionId || input.source_transaction_id) || null,
      reason,
      idempotencyKey,
      cleanText(input.expiresAt || input.expires_at) || null,
      cleanText(actorUid) || null,
      createdAt,
    ]
  );

  return getClientCashbackWallet(db, salonId, clientId);
}

export async function getClientCashbackWallet(db, salonId, clientId) {
  const id = requiredId(clientId, 'clientId');
  const client = await dbFirst(
    db,
    'SELECT id FROM clients WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  if (!client) throw new AppError(404, 'core_client:not_found');

  const [policy, projection] = await Promise.all([
    getCashbackPolicy(db, salonId),
    getCashbackProjection(db, salonId, id, { maxRows: 10000 }),
  ]);

  return {
    clientId: id,
    enabled: policy.enabled,
    balanceHalalas: projection.spendableHalalas,
    ledgerBalanceHalalas: projection.ledgerBalanceHalalas,
    pendingRecoveryHalalas: projection.recoveryHalalas,
    earnedHalalas: projection.earnedHalalas,
    redeemedHalalas: projection.redeemedHalalas,
    reversedHalalas: projection.reversedHalalas,
    currency: 'SAR',
    redeemScope: 'salon_only',
    cashWithdrawalAllowed: false,
    transferAllowed: false,
    policy,
    transactions: projection.rows.slice(-500).reverse(),
  };
}

export async function reconcileCashbackForBooking(
  db,
  salonId,
  bookingIdValue,
  actorUid = ''
) {
  const policy = await getCashbackPolicy(db, salonId);
  if (!policy.enabled || policy.earnBps <= 0) {
    return {
      enabled: false,
      changed: false,
      expectedEarnHalalas: 0,
      recordedEarnHalalas: 0,
    };
  }

  const bookingId = requiredId(bookingIdValue, 'bookingId');
  const booking = await dbFirst(
    db,
    'SELECT id, client_id, status, total_halalas, package_sessions_used, updated_at FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, bookingId]
  );
  if (!booking) throw new AppError(404, 'core_booking:not_found');
  if (!cleanText(booking.client_id)) {
    return { enabled: true, changed: false, skipped: 'client_missing' };
  }

  const [paymentRows, refundRows, itemRows, movementRows] = await Promise.all([
    dbAll(
      db,
      "SELECT id, amount_halalas, status, paid_at, created_at FROM payments WHERE salon_id = ? AND booking_id = ? ORDER BY created_at ASC, id ASC",
      [salonId, bookingId]
    ),
    dbAll(
      db,
      "SELECT id, amount_halalas, status, refunded_at, created_at FROM refunds WHERE salon_id = ? AND booking_id = ? ORDER BY created_at ASC, id ASC",
      [salonId, bookingId]
    ),
    dbAll(
      db,
      'SELECT id, service_id, final_total_halalas, total_halalas FROM booking_items WHERE salon_id = ? AND booking_id = ? ORDER BY id ASC',
      [salonId, bookingId]
    ),
    dbAll(
      db,
      "SELECT id, type, amount_halalas, idempotency_key, created_at FROM cashback_wallet_transactions WHERE salon_id = ? AND booking_id = ? AND type IN ('earn','reverse') ORDER BY created_at ASC, id ASC",
      [salonId, bookingId]
    ),
  ]);

  const paidHalalas = paymentRows
    .filter((row) =>
      ['paid', 'completed', 'succeeded'].includes(cleanText(row.status).toLowerCase())
    )
    .reduce((sum, row) => sum + Math.max(0, finiteInteger(row.amount_halalas)), 0);
  const refundedHalalas = refundRows
    .filter((row) => cleanText(row.status).toLowerCase() === 'completed')
    .reduce((sum, row) => sum + Math.max(0, finiteInteger(row.amount_halalas)), 0);
  const netPaidHalalas = Math.max(0, paidHalalas - refundedHalalas);

  const excludedServices = new Set(policy.excludedServiceIds);
  const eligibleItemCap = itemRows.length
    ? itemRows
        .filter((row) => !excludedServices.has(cleanText(row.service_id)))
        .reduce(
          (sum, row) =>
            sum +
            Math.max(
              0,
              finiteInteger(
                row.final_total_halalas == null
                  ? row.total_halalas
                  : row.final_total_halalas
              )
            ),
          0
        )
    : Math.max(0, finiteInteger(booking.total_halalas));

  const totalCap = Math.max(0, finiteInteger(booking.total_halalas));
  const eligiblePaidHalalas = Math.min(
    netPaidHalalas,
    totalCap,
    Math.max(0, eligibleItemCap)
  );

  const completed = cleanText(booking.status).toLowerCase() === 'completed';
  const meetsMinimum = eligiblePaidHalalas >= policy.minimumEligibleHalalas;
  const expectedEarnHalalas =
    completed && meetsMinimum
      ? calculateCashbackEarnHalalas(eligiblePaidHalalas, policy.earnBps)
      : 0;

  const recordedEarnHalalas = movementRows.reduce(
    (sum, row) => sum + finiteInteger(row.amount_halalas),
    0
  );
  const delta = expectedEarnHalalas - recordedEarnHalalas;

  if (!delta) {
    return {
      enabled: true,
      changed: false,
      bookingId,
      clientId: booking.client_id,
      eligiblePaidHalalas,
      expectedEarnHalalas,
      recordedEarnHalalas,
    };
  }

  const sourceFingerprint = stableHash(
    JSON.stringify({
      booking: {
        status: booking.status,
        total: booking.total_halalas,
        updatedAt: booking.updated_at,
      },
      policy: {
        earnBps: policy.earnBps,
        minimumEligibleHalalas: policy.minimumEligibleHalalas,
        excludedServiceIds: policy.excludedServiceIds,
        updatedAt: policy.updatedAt,
      },
      payments: paymentRows.map((row) => [
        row.id,
        row.amount_halalas,
        row.status,
        row.paid_at,
        row.created_at,
      ]),
      refunds: refundRows.map((row) => [
        row.id,
        row.amount_halalas,
        row.status,
        row.refunded_at,
        row.created_at,
      ]),
      items: itemRows.map((row) => [
        row.id,
        row.service_id,
        row.final_total_halalas,
        row.total_halalas,
      ]),
      recordedEarnHalalas,
      expectedEarnHalalas,
    })
  );

  const createdAt = nowIso();
  const type = delta > 0 ? 'earn' : 'reverse';
  await recordCashbackMovement(
    db,
    salonId,
    {
      clientId: booking.client_id,
      type,
      amountHalalas: delta,
      bookingId,
      reason:
        type === 'earn'
          ? 'Cashback earned from completed MALIKAT booking'
          : 'Cashback reversed after booking payment/refund reconciliation',
      idempotencyKey: `cashback:booking:${bookingId}:reconcile:${sourceFingerprint}`,
      expiresAt:
        type === 'earn' && policy.expiryDays
          ? addDaysIso(createdAt, policy.expiryDays)
          : null,
      createdAt,
    },
    actorUid
  );

  return {
    enabled: true,
    changed: true,
    bookingId,
    clientId: booking.client_id,
    eligiblePaidHalalas,
    expectedEarnHalalas,
    recordedEarnHalalas: expectedEarnHalalas,
    deltaHalalas: delta,
    movementType: type,
  };
}

function consumeLots(lots, amount, predicate = () => true) {
  let remaining = Math.max(0, finiteInteger(amount));
  if (!remaining) return 0;

  const candidates = lots
    .filter((lot) => lot.remainingHalalas > 0 && predicate(lot))
    .sort((left, right) => {
      const leftExpiry = left.expiresAt || '9999-12-31T23:59:59.999Z';
      const rightExpiry = right.expiresAt || '9999-12-31T23:59:59.999Z';
      return (
        leftExpiry.localeCompare(rightExpiry) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    });

  let consumed = 0;
  for (const lot of candidates) {
    if (!remaining) break;
    const take = Math.min(remaining, lot.remainingHalalas);
    lot.remainingHalalas -= take;
    remaining -= take;
    consumed += take;
  }
  return consumed;
}

function rebuildEarnLots(rows) {
  const lots = [];
  const byId = new Map();
  let recoveryHalalas = 0;
  let unexpiringHalalas = 0;

  for (const row of rows) {
    const type = cleanText(row.type).toLowerCase();
    const amount = finiteInteger(row.amount_halalas);

    if (amount > 0) {
      if (type === 'earn') {
        // Recovery debt is separate from already-existing unrelated lots.
        // A later earning repays recovery first; only its residual becomes a
        // spendable reward lot.
        const recoveryAppliedHalalas = Math.min(amount, recoveryHalalas);
        recoveryHalalas -= recoveryAppliedHalalas;

        const lot = {
          id: cleanText(row.id),
          bookingId: cleanText(row.booking_id),
          createdAt: cleanText(row.created_at),
          expiresAt: cleanText(row.expires_at) || null,
          originalHalalas: amount,
          recoveryAppliedHalalas,
          remainingHalalas: amount - recoveryAppliedHalalas,
        };
        lots.push(lot);
        byId.set(lot.id, lot);
      } else if (type === 'adjustment') {
        const recoveryAppliedHalalas = Math.min(amount, recoveryHalalas);
        recoveryHalalas -= recoveryAppliedHalalas;
        unexpiringHalalas += amount - recoveryAppliedHalalas;
      }
      continue;
    }

    if (amount >= 0) continue;
    const debit = Math.abs(amount);

    if (type === 'reverse' && cleanText(row.booking_id)) {
      // Reverse only the reward lot(s) produced by the refunded booking.
      // If those credits were already spent, create recovery debt instead of
      // consuming unrelated reward lots.
      const consumed = consumeLots(
        lots,
        debit,
        (lot) => lot.bookingId === cleanText(row.booking_id)
      );
      recoveryHalalas += Math.max(0, debit - consumed);
      continue;
    }

    if (type === 'expire' && cleanText(row.source_transaction_id)) {
      const sourceLot = byId.get(cleanText(row.source_transaction_id));
      if (sourceLot) {
        const take = Math.min(debit, sourceLot.remainingHalalas);
        sourceLot.remainingHalalas -= take;
      }
      continue;
    }

    if (type === 'redeem') {
      const fromLots = consumeLots(lots, debit);
      const remainder = Math.max(0, debit - fromLots);
      const fromUnexpiring = Math.min(remainder, unexpiringHalalas);
      unexpiringHalalas -= fromUnexpiring;
      recoveryHalalas += Math.max(0, remainder - fromUnexpiring);
      continue;
    }

    if (type === 'adjustment') {
      const fromLots = consumeLots(lots, debit);
      const remainder = Math.max(0, debit - fromLots);
      const fromUnexpiring = Math.min(remainder, unexpiringHalalas);
      unexpiringHalalas -= fromUnexpiring;
      recoveryHalalas += Math.max(0, remainder - fromUnexpiring);
      continue;
    }

    if (type === 'expire') {
      consumeLots(lots, debit);
    }
  }

  return {
    lots,
    byId,
    recoveryHalalas,
    unexpiringHalalas,
  };
}

async function closeExpiryLot(
  db,
  salonId,
  clientId,
  sourceTransactionId,
  status,
  expiredHalalas,
  evaluatedAt
) {
  await dbRun(
    db,
    `INSERT OR IGNORE INTO cashback_expiry_lot_state
      (salon_id, source_transaction_id, client_id, status, expired_halalas, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      salonId,
      sourceTransactionId,
      clientId,
      status,
      Math.max(0, finiteInteger(expiredHalalas)),
      evaluatedAt,
    ]
  );
}

export async function expireCashbackCredits(
  db,
  salonId,
  asOf = nowIso(),
  options = {}
) {
  const lotLimit = Math.max(
    1,
    Math.min(
      500,
      finiteInteger(options.lotLimit ?? options.clientLimit, 100)
    )
  );
  const onlyClientId = cleanText(options.clientId || options.client_id);
  const params = [salonId, asOf];
  const clientClause = onlyClientId ? 'AND t.client_id = ?' : '';
  if (onlyClientId) params.push(onlyClientId);
  params.push(lotLimit + 1);

  const dueRows = await dbAll(
    db,
    `SELECT t.id, t.client_id, t.booking_id, t.expires_at, t.created_at
       FROM cashback_wallet_transactions AS t
       LEFT JOIN cashback_expiry_lot_state AS s
         ON s.salon_id = t.salon_id
        AND s.source_transaction_id = t.id
      WHERE t.salon_id = ?
        AND t.type = 'earn'
        AND t.expires_at IS NOT NULL
        AND t.expires_at <= ?
        ${clientClause}
        AND s.source_transaction_id IS NULL
      ORDER BY t.expires_at ASC, t.id ASC
      LIMIT ?`,
    params
  );

  if (onlyClientId && dueRows.length > lotLimit) {
    throw new AppError(409, 'core_cashback:expiry_backlog_too_large');
  }

  const dueLots = dueRows.slice(0, lotLimit);
  const byClient = new Map();
  for (const row of dueLots) {
    const clientId = cleanText(row.client_id);
    const lotId = cleanText(row.id);
    if (!clientId || !lotId) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push(lotId);
  }

  let clientsProcessed = 0;
  let lotsProcessed = 0;
  let lotsConsumedBeforeExpiry = 0;
  let lotsExpired = 0;
  let expiredHalalas = 0;
  let oversizedClients = 0;

  for (const [clientId, candidateIds] of byClient) {
    let rows;
    try {
      rows = await loadCashbackLedgerRows(db, salonId, clientId, {
        maxRows: 5000,
        pageSize: 500,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'core_cashback:ledger_too_large'
      ) {
        if (onlyClientId || options.failOnLedgerOverflow === true) {
          throw new AppError(
            409,
            'core_cashback:ledger_too_large_for_expiry'
          );
        }
        oversizedClients += 1;
        continue;
      }
      throw error;
    }

    clientsProcessed += 1;
    const rebuilt = rebuildEarnLots(rows);

    for (const lotId of candidateIds) {
      lotsProcessed += 1;
      const lot = rebuilt.byId.get(lotId);

      if (!lot || lot.remainingHalalas <= 0) {
        await closeExpiryLot(
          db,
          salonId,
          clientId,
          lotId,
          'consumed',
          0,
          asOf
        );
        lotsConsumedBeforeExpiry += 1;
        continue;
      }

      const amount = lot.remainingHalalas;
      await recordCashbackMovement(
        db,
        salonId,
        {
          clientId,
          type: 'expire',
          amountHalalas: -amount,
          sourceTransactionId: lot.id,
          bookingId: lot.bookingId || null,
          reason: 'Expired MALIKAT cashback credit',
          idempotencyKey: `cashback:expire:${lot.id}`,
          createdAt: asOf,
        },
        'system'
      );

      lot.remainingHalalas = 0;
      await closeExpiryLot(
        db,
        salonId,
        clientId,
        lot.id,
        'expired',
        amount,
        asOf
      );
      lotsExpired += 1;
      expiredHalalas += amount;
    }
  }

  return {
    asOf,
    clientsProcessed,
    lotsProcessed,
    lotsConsumedBeforeExpiry,
    lotsExpired,
    movementsCreated: lotsExpired,
    expiredHalalas,
    oversizedClients,
    hasMore: dueRows.length > lotLimit,
  };
}

export async function redeemCashbackForBooking(
  db,
  salonId,
  clientIdValue,
  input = {},
  actorUid = ''
) {
  const policy = await getCashbackPolicy(db, salonId);
  if (!policy.enabled) throw new AppError(409, 'core_cashback:disabled');

  const clientId = requiredId(clientIdValue, 'clientId');
  const bookingId = requiredId(input.bookingId || input.booking_id, 'bookingId');
  const booking = await dbFirst(
    db,
    'SELECT id, client_id, status, total_halalas FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, bookingId]
  );
  if (!booking) throw new AppError(404, 'core_booking:not_found');
  if (cleanText(booking.client_id) !== clientId) {
    throw new AppError(409, 'core_cashback:booking_client_mismatch');
  }
  if (['cancelled', 'canceled'].includes(cleanText(booking.status).toLowerCase())) {
    throw new AppError(409, 'core_cashback:booking_cancelled');
  }

  const amountHalalas = finiteInteger(input.amountHalalas ?? input.amount_halalas);
  if (amountHalalas <= 0) throw new AppError(400, 'core_cashback:invalid_amount');
  if (amountHalalas > Math.max(0, finiteInteger(booking.total_halalas))) {
    throw new AppError(409, 'core_cashback:amount_exceeds_booking_total');
  }

  const operationId = requiredText(
    input.operationId || input.operation_id,
    'operationId',
    300
  );

  await expireCashbackCredits(db, salonId, nowIso(), {
    clientId,
    lotLimit: 500,
    failOnLedgerOverflow: true,
  });

  return recordCashbackMovement(
    db,
    salonId,
    {
      clientId,
      type: 'redeem',
      amountHalalas: -amountHalalas,
      bookingId,
      reason: cleanText(input.reason) || 'Cashback redeemed inside MALIKAT',
      idempotencyKey: `cashback:redeem:${operationId}`,
    },
    actorUid
  );
}
