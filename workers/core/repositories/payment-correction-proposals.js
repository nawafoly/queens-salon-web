// CORE D1 ONLY — financial correction PROPOSALS are not financial settlements.
// This repository intentionally exposes no approve/apply/patch/delete operation.
// A separate reviewed correction engine must own all balance, income, refund,
// cashback, closeout and reporting projections before proposals can be applied.

import {
  changes,
  cleanText,
  dbBatch,
  dbFirst,
  generatedId,
  integer,
  nowIso,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertStatement } from './audit.js';

const KINDS = new Set(['amount_correction', 'method_reclassification']);
const NEW_METHODS = new Set(['cash', 'card', 'transfer']);

// The idempotency fingerprint deliberately includes the authenticated actor.
// An unrelated caller cannot take over another caller's request key.
function fingerprint({ paymentId, kind, amount, method, reason, actorUid }) {
  return JSON.stringify([paymentId, kind, amount, method, reason, actorUid]);
}

function sameRequest(existing, intent) {
  return existing?.intent_fingerprint === intent;
}

export async function proposePaymentCorrection(db, salonId, data = {}, actor = {}) {
  const paymentId = requiredId(data.paymentId ?? data.payment_id, 'paymentId');
  const kind = requiredText(data.kind, 'kind', 40);
  if (!KINDS.has(kind)) {
    throw new AppError(400, 'core_payment_correction:invalid_kind');
  }
  const actorUid = requiredId(actor?.uid, 'actorUid');
  const idempotencyKey = requiredText(
    data.idempotencyKey ?? data.idempotency_key, 'idempotencyKey', 180
  );
  const reason = requiredText(data.reason, 'reason', 500);
  if (reason.length < 8) {
    throw new AppError(400, 'core_payment_correction:reason_required');
  }

  // Proposals require an actual settled payment with an invoice + booking.
  // No wallet, manual-income, or unlinked payment may be silently rewritten.
  const payment = await dbFirst(
    db, 'SELECT * FROM payments WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, paymentId]
  );
  if (!payment) throw new AppError(404, 'core_payment:not_found');
  if (!['paid', 'completed', 'succeeded'].includes(cleanText(payment.status).toLowerCase())
    || !payment.invoice_id || !payment.booking_id) {
    throw new AppError(409, 'core_payment_correction:payment_not_eligible');
  }

  const currentAmount = Number(payment.amount_halalas);
  const currentMethod = cleanText(payment.method).toLowerCase();
  const proposalAmount = kind === 'amount_correction'
    ? integer(data.proposedAmountHalalas ?? data.proposed_amount_halalas,
      'proposedAmountHalalas', { min: 1, max: 100_000_000 })
    : currentAmount;
  const proposalMethod = kind === 'method_reclassification'
    ? cleanText(data.proposedMethod ?? data.proposed_method).toLowerCase()
    : currentMethod;

  if (kind === 'method_reclassification' && !NEW_METHODS.has(proposalMethod)) {
    throw new AppError(400, 'core_payment_correction:invalid_method');
  }
  if (proposalAmount === currentAmount && proposalMethod === currentMethod) {
    throw new AppError(400, 'core_payment_correction:no_change');
  }

  const intent = fingerprint({
    paymentId, kind, amount: proposalAmount, method: proposalMethod,
    reason, actorUid,
  });
  const originalRequest = await dbFirst(
    db,
    'SELECT * FROM payment_correction_proposals WHERE salon_id = ? AND idempotency_key = ? LIMIT 1',
    [salonId, idempotencyKey]
  );
  if (originalRequest) {
    if (!sameRequest(originalRequest, intent)) {
      throw new AppError(409, 'core_payment_correction:idempotency_conflict');
    }
    return { ...originalRequest, idempotent: true };
  }

  const id = generatedId('payment_correction_proposal');
  const now = nowIso();
  const refundSum = `COALESCE((SELECT SUM(r.amount_halalas) FROM refunds r
    WHERE r.salon_id = p.salon_id AND r.payment_id = p.id
      AND LOWER(TRIM(r.status)) = 'completed'), 0)`;

  // INSERT ... SELECT takes the live payment, invoice, booking and refund rows
  // at D1 write time; preflight reads cannot authorize an obsolete amount.
  const statement = {
    sql: `INSERT INTO payment_correction_proposals (
      id, salon_id, booking_id, invoice_id, payment_id, kind,
      original_amount_halalas, proposed_amount_halalas,
      original_method, proposed_method, completed_refund_halalas,
      reason, idempotency_key, intent_fingerprint, actor_uid, created_at, status)
      SELECT ?, p.salon_id, p.booking_id, p.invoice_id, p.id, ?,
        p.amount_halalas, ?, p.method, ?, ${refundSum},
        ?, ?, ?, ?, ?, 'proposed'
      FROM payments p
      INNER JOIN invoices i ON i.salon_id = p.salon_id AND i.id = p.invoice_id
      INNER JOIN bookings b ON b.salon_id = p.salon_id AND b.id = p.booking_id
        AND i.booking_id = b.id
      WHERE p.salon_id = ? AND p.id = ?
        AND LOWER(TRIM(p.status)) IN ('paid','completed','succeeded')
        AND p.amount_halalas = ? AND LOWER(TRIM(p.method)) = ?
        AND ? >= ${refundSum}`,
    params: [
      id, kind, proposalAmount, proposalMethod,
      reason, idempotencyKey, intent, actorUid, now,
      salonId, paymentId, currentAmount, currentMethod, proposalAmount,
    ],
  };

  const audit = auditInsertStatement(salonId, {
    action: 'payment_correction_proposed',
    entityType: 'payment_correction_proposal',
    entityId: id,
    description: 'A payment correction was proposed; no money or income was moved',
    source: 'core-finance',
    before: {
      paymentId, amountHalalas: currentAmount, method: currentMethod,
    },
    after: {
      proposedAmountHalalas: proposalAmount, proposedMethod: proposalMethod,
      kind, status: 'proposed',
    },
    meta: { invoiceId: payment.invoice_id, bookingId: payment.booking_id, reason, idempotencyKey },
  }, actor).statement;
  // Only insert an audit row if the proposal INSERT actually wrote its row.
  // Both statements execute within the same D1 transaction.
  const auditSql = audit.sql.replace(
    /VALUES\s*\([\s\S]*?\)\s*$/,
    `SELECT ${audit.params.map(() => '?').join(', ')}
      WHERE EXISTS (SELECT 1 FROM payment_correction_proposals
        WHERE salon_id = ? AND id = ?)`
  );
  if (auditSql === audit.sql) throw new Error('PAYMENT_CORRECTION_AUDIT_INVALID');

  let results;
  try {
    results = await dbBatch(db, [
      statement,
      { sql: auditSql, params: [...audit.params, salonId, id] },
    ]);
  } catch (error) {
    if (/UNIQUE|constraint failed|SQLITE_CONSTRAINT/i.test(String(error?.message || ''))) {
      const winner = await dbFirst(
        db,
        'SELECT * FROM payment_correction_proposals WHERE salon_id = ? AND idempotency_key = ? LIMIT 1',
        [salonId, idempotencyKey]
      );
      if (winner) {
        if (!sameRequest(winner, intent)) {
          throw new AppError(409, 'core_payment_correction:idempotency_conflict');
        }
        return { ...winner, idempotent: true };
      }
    }
    throw error;
  }
  if (changes(results[0]) !== 1) {
    throw new AppError(409, 'core_payment_correction:stale_payment_snapshot');
  }
  return dbFirst(
    db, 'SELECT * FROM payment_correction_proposals WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
}

export async function listPaymentCorrectionProposals(db, salonId, paymentId) {
  const id = requiredId(paymentId, 'paymentId');
  return (await db.prepare(
    'SELECT * FROM payment_correction_proposals WHERE salon_id = ? AND payment_id = ? ORDER BY created_at DESC, id DESC LIMIT 50'
  ).bind(salonId, id).all()).results;
}
