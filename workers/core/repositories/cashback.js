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
});

function finiteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
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
  };
}

export async function getCashbackPolicy(db, salonId) {
  const row = await dbFirst(
    db,
    'SELECT * FROM cashback_policies WHERE salon_id = ? LIMIT 1',
    [salonId]
  );
  return mapPolicy(row);
}

export function calculateCashbackEarnHalalas(eligibleHalalas, earnBps) {
  const basis = Math.max(0, finiteInteger(eligibleHalalas));
  const bps = Math.max(0, Math.min(10000, finiteInteger(earnBps)));
  return Math.floor((basis * bps) / 10000);
}

export async function recordCashbackMovement(db, salonId, input = {}, actorUid = '') {
  const clientId = requiredId(input.clientId || input.client_id, 'clientId');
  const type = cleanText(input.type).toLowerCase();
  if (!['earn', 'redeem', 'reverse', 'expire', 'adjustment'].includes(type)) {
    throw new AppError(400, 'core_cashback:invalid_type');
  }

  const amountHalalas = finiteInteger(input.amountHalalas ?? input.amount_halalas);
  if (!amountHalalas) throw new AppError(400, 'core_cashback:invalid_amount');

  if (type === 'earn' && amountHalalas < 0) throw new AppError(400, 'core_cashback:earn_must_be_positive');
  if (['redeem', 'reverse', 'expire'].includes(type) && amountHalalas > 0) {
    throw new AppError(400, 'core_cashback:debit_must_be_negative');
  }

  const client = await dbFirst(
    db,
    'SELECT id FROM clients WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, clientId]
  );
  if (!client) throw new AppError(404, 'core_client:not_found');

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

  const [policy, rows] = await Promise.all([
    getCashbackPolicy(db, salonId),
    dbAll(
      db,
      `SELECT * FROM cashback_wallet_transactions
        WHERE salon_id = ? AND client_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 500`,
      [salonId, id]
    ),
  ]);

  const balanceHalalas = Math.max(
    0,
    rows.reduce((sum, row) => sum + finiteInteger(row.amount_halalas), 0)
  );
  const earnedHalalas = rows
    .filter((row) => cleanText(row.type) === 'earn')
    .reduce((sum, row) => sum + Math.max(0, finiteInteger(row.amount_halalas)), 0);
  const redeemedHalalas = Math.abs(
    rows
      .filter((row) => cleanText(row.type) === 'redeem')
      .reduce((sum, row) => sum + finiteInteger(row.amount_halalas), 0)
  );
  const reversedHalalas = Math.abs(
    rows
      .filter((row) => ['reverse', 'expire'].includes(cleanText(row.type)))
      .reduce((sum, row) => sum + finiteInteger(row.amount_halalas), 0)
  );

  return {
    clientId: id,
    enabled: policy.enabled,
    balanceHalalas,
    earnedHalalas,
    redeemedHalalas,
    reversedHalalas,
    currency: 'SAR',
    redeemScope: 'salon_only',
    cashWithdrawalAllowed: false,
    transferAllowed: false,
    policy,
    transactions: rows,
  };
}
