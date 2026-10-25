// CORE D1 ONLY — payment method correction APPLY.
// This repository is intentionally NOT exposed through an HTTP route.
// Approval authorization and all effective financial read models
// must be integrated before enabling this operation in production.

import {
  changes,
  cleanText,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  requiredId,
} from '../d1.js';

import { AppError } from '../errors.js';
import { auditInsertStatement } from './audit.js';

function appliedByProposal(db, salonId, proposalId) {
  return dbFirst(
    db,
    `SELECT * FROM payment_correction_applied_events
     WHERE salon_id = ? AND proposal_id = ? LIMIT 1`,
    [salonId, proposalId]
  );
}

export async function applyPaymentMethodCorrection(
  db,
  salonId,
  proposalId,
  actor = {}
) {
  const id = requiredId(proposalId, 'proposalId');
  const approverUid = requiredId(actor.uid, 'actorUid');

  const alreadyApplied = await appliedByProposal(db, salonId, id);

  if (alreadyApplied) {
    if (alreadyApplied.approved_by_uid !== approverUid) {
      throw new AppError(
        403,
        'core_payment_correction:approval_actor_mismatch'
      );
    }

    return { ...alreadyApplied, idempotent: true };
  }

  const proposal = await dbFirst(
    db,
    `SELECT * FROM payment_correction_proposals
     WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );

  if (!proposal) {
    throw new AppError(404, 'core_payment_correction:not_found');
  }

  if (proposal.kind !== 'method_reclassification') {
    throw new AppError(
      409,
      'core_payment_correction:amount_apply_not_implemented'
    );
  }

  if (cleanText(proposal.actor_uid) === approverUid) {
    throw new AppError(
      403,
      'core_payment_correction:independent_approval_required'
    );
  }

  const eventId = generatedId('payment_correction_applied');
  const now = nowIso();

  // Revalidate financial invariants at the D1 write boundary.
  // JavaScript preflight results are never settlement authority.

  const insertEvent = {
    sql: `INSERT INTO payment_correction_applied_events (
      id, salon_id, proposal_id, payment_id,
      invoice_id, booking_id, kind,
      original_amount_halalas,
      corrected_amount_halalas,
      amount_delta_halalas,
      original_method,
      corrected_method,
      refunded_snapshot_halalas,
      invoice_paid_before_halalas,
      invoice_paid_after_halalas,
      accounting_date,
      requested_by_uid,
      approved_by_uid,
      applied_by_uid,
      reason,
      idempotency_key,
      applied_at
    )
    SELECT
      ?, q.salon_id, q.id, p.id,
      i.id, b.id, q.kind,
      p.amount_halalas,
      q.proposed_amount_halalas,
      0,
      LOWER(TRIM(p.method)),
      q.proposed_method,
      0,
      i.paid_halalas,
      i.paid_halalas,
      SUBSTR(inc.occurred_at, 1, 10),
      q.actor_uid,
      ?, ?, q.reason, q.idempotency_key, ?
    FROM payment_correction_proposals q
    INNER JOIN payments p
      ON p.salon_id = q.salon_id
      AND p.id = q.payment_id
    INNER JOIN invoices i
      ON i.salon_id = q.salon_id
      AND i.id = q.invoice_id
    INNER JOIN bookings b
      ON b.salon_id = q.salon_id
      AND b.id = q.booking_id
    INNER JOIN income_entries inc
      ON inc.salon_id = q.salon_id
      AND inc.payment_id = p.id
    WHERE q.salon_id = ?
      AND q.id = ?
      AND q.kind = 'method_reclassification'
      AND q.status = 'proposed'
      AND q.actor_uid <> ?
      AND p.invoice_id = i.id
      AND p.booking_id = b.id
      AND i.booking_id = b.id
      AND inc.invoice_id = i.id
      AND inc.booking_id = b.id
      AND LOWER(TRIM(p.status))
        IN ('paid', 'completed', 'succeeded')
      AND NULLIF(TRIM(COALESCE(p.provider, '')), '') IS NULL
      AND NULLIF(TRIM(COALESCE(p.provider_reference, '')), '') IS NULL
      AND p.amount_halalas = q.original_amount_halalas
      AND q.original_amount_halalas = q.proposed_amount_halalas
      AND q.completed_refund_halalas = 0
      AND LOWER(TRIM(p.method)) = LOWER(TRIM(q.original_method))
      AND LOWER(TRIM(q.proposed_method))
        IN ('cash', 'card', 'transfer')
      AND LOWER(TRIM(q.original_method))
        IN ('cash', 'card', 'transfer')
      AND LOWER(TRIM(q.proposed_method))
        <> LOWER(TRIM(q.original_method))
      AND inc.amount_halalas = p.amount_halalas
      AND LOWER(TRIM(inc.method)) = LOWER(TRIM(p.method))
      AND inc.category = 'payment'
      AND inc.source = 'booking'
      AND SUBSTR(inc.occurred_at, 1, 10)
        GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND i.paid_halalas >= 0
      AND (
        SELECT COUNT(*)
        FROM income_entries x
        WHERE x.salon_id = q.salon_id
          AND x.payment_id = p.id
      ) = 1
      AND NOT EXISTS (
        SELECT 1 FROM refunds r
        WHERE r.salon_id = q.salon_id
          AND r.payment_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM day_audit_closings c
        WHERE c.salon_id = q.salon_id
          AND c.audit_date = SUBSTR(inc.occurred_at, 1, 10)
      )
      AND NOT EXISTS (
        SELECT 1 FROM payment_correction_applied_events a
        WHERE a.salon_id = q.salon_id
          AND a.payment_id = p.id
      )`,
    params: [
      eventId,
      approverUid,
      approverUid,
      now,
      salonId,
      id,
      approverUid,
    ],
  };

  const posting = (prefix, methodColumn, amountSql) => ({
    sql: `INSERT INTO payment_correction_applied_postings (
      id, salon_id, event_id, channel,
      signed_amount_halalas, accounting_date, created_at
    )
    SELECT
      ?, e.salon_id, e.id,
      ${methodColumn},
      ${amountSql},
      e.accounting_date,
      ?
    FROM payment_correction_applied_events e
    WHERE e.salon_id = ?
      AND e.id = ?`,
    params: [
      generatedId(prefix),
      now,
      salonId,
      eventId,
    ],
  });

  const audit = auditInsertStatement(
    salonId,
    {
      action: 'payment_method_correction_applied',
      entityType: 'payment_correction_applied',
      entityId: eventId,
      description: 'Payment method correction journal posted',
      source: 'core-finance',
      meta: {
        proposalId: id,
        paymentId: proposal.payment_id,
        approverUid,
      },
    },
    actor
  ).statement;

  const auditSql = audit.sql.replace(
    /VALUES\s*\([\s\S]*?\)\s*$/,
    `SELECT ${audit.params.map(() => '?').join(', ')}
     WHERE EXISTS (
       SELECT 1
       FROM payment_correction_applied_events
       WHERE salon_id = ?
         AND id = ?
     )`
  );

  if (auditSql === audit.sql) {
    throw new Error('PAYMENT_CORRECTION_APPLY_AUDIT_INVALID');
  }

  let results;

  try {
    results = await dbBatch(db, [
      insertEvent,
      posting(
        'payment_correction_debit',
        'e.original_method',
        '-e.original_amount_halalas'
      ),
      posting(
        'payment_correction_credit',
        'e.corrected_method',
        'e.corrected_amount_halalas'
      ),
      {
        sql: auditSql,
        params: [...audit.params, salonId, eventId],
      },
    ]);
  } catch (error) {
    const winner = await appliedByProposal(db, salonId, id);

    if (
      winner &&
      winner.approved_by_uid === approverUid &&
      /UNIQUE|constraint failed|SQLITE_CONSTRAINT/i.test(
        String(error?.message || '')
      )
    ) {
      return { ...winner, idempotent: true };
    }

    throw error;
  }

  if (changes(results[0]) !== 1) {
    throw new AppError(
      409,
      'core_payment_correction:apply_conflict_or_stale'
    );
  }

  return appliedByProposal(db, salonId, id);
}