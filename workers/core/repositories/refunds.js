import { atomicIdempotencyCompletionStatements } from "../idempotency.js";
// CORE D1 ONLY — do not add Firestore fallback.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertStatement } from './audit.js';
import { safeRefreshTargetsForBooking } from './employee-targets.js';
import { reconcileCashbackForBooking } from './cashback.js';

async function assertPackageRefundWorkflowAvailable(db, salonId, bookingId) {
  if (!bookingId) return;
  const covered = await dbFirst(
    db,
    `SELECT id FROM booking_items
      WHERE salon_id = ? AND booking_id = ? AND package_covered = 1 LIMIT 1`,
    [salonId, bookingId]
  );
  if (covered) {
    throw new AppError(
      409,
      'core_refund:package_booking_reversal_workflow_required',
      'Package-covered booking refunds require an atomic package reversal workflow'
    );
  }
}

async function reconcileRefundDerivedEffects(db, salonId, bookingId, actorUid) {
  if (!bookingId) return [];
  const pending = [];
  try {
    await safeRefreshTargetsForBooking(db, salonId, bookingId);
  } catch (error) {
    pending.push('employee_targets');
    console.error('core_refund_target_reconciliation_pending', {
      salonId, bookingId, message: cleanText(error?.message),
    });
  }
  try {
    await reconcileCashbackForBooking(db, salonId, bookingId, actorUid || '');
  } catch (error) {
    pending.push('cashback');
    console.error('core_refund_cashback_reconciliation_pending', {
      salonId, bookingId, message: cleanText(error?.message),
    });
  }
  return pending;
}

// Never derive a new invoice balance from a pre-batch read. Payment and
// refund batches share this row; arithmetic must use the live D1 value.
function invoiceAdjustmentStatement(
  salonId,
  invoiceId,
  delta,
  updatedAt,
  { requirePriorUpdate = false, minimumPaid = null } = {}
) {
  // Preserve legitimate overpayments. Capping at total_halalas would silently
  // erase money if a payment raced with a refund edit or void.
  const next = 'MAX(0, paid_halalas + ?)';
  return {
    sql: `UPDATE invoices SET paid_halalas = ${next},
      status = CASE WHEN ${next} <= 0 THEN 'unpaid'
                    WHEN ${next} >= total_halalas THEN 'paid'
                    ELSE 'partial' END,
      updated_at = ? WHERE salon_id = ? AND id = ?
        ${minimumPaid == null ? '' : 'AND paid_halalas >= ?'}
        ${requirePriorUpdate ? 'AND changes() = 1' : ''}`,
    params: [
      delta, delta, delta, updatedAt, salonId, invoiceId,
      ...(minimumPaid == null ? [] : [minimumPaid]),
    ],
  };
}

function refundDateScope(rawDate) {
  const date = cleanText(rawDate);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'core_refund:invalid_date');
  const startDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, 'core_refund:invalid_date');
  }
  return {
    date,
    start: startDate.toISOString(),
    end: new Date(startDate.getTime() + 86_400_000).toISOString(),
  };
}

export async function getRefund(db, salonId, id) {
  const row = await dbFirst(db, 'SELECT * FROM refunds WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, requiredId(id)]);
  if (!row) throw new AppError(404, 'core_refund:not_found');
  return row;
}

export async function listRefunds(db, salonId, query = {}) {
  const where = ['salon_id = ?'];
  const params = [salonId];
  if (optionalText(query.bookingId || query.booking_id)) {
    where.push('booking_id = ?');
    params.push(cleanText(query.bookingId || query.booking_id));
  }
  if (optionalText(query.paymentId || query.payment_id)) {
    where.push('payment_id = ?');
    params.push(cleanText(query.paymentId || query.payment_id));
  }
  const date = refundDateScope(query.date);
  if (date) {
    where.push('(refunded_at = ? OR (refunded_at >= ? AND refunded_at < ?))');
    params.push(date.date, date.start, date.end);
  }
  return dbAll(db, `SELECT * FROM refunds WHERE ${where.join(' AND ')} ORDER BY refunded_at DESC LIMIT 500`, params);
}

export async function createRefund(
  db, salonId, data, actor = {}, executionContext = null
) {
  if (executionContext) {
    if (
      executionContext.salonId !== salonId ||
      !executionContext.actorUid ||
      executionContext.actorUid !== actor?.uid
    ) {
      throw new AppError(
        409,'core_refund:execution_identity_conflict'
      );
    }

    for (const [camel,snake] of [
      ['paymentId','payment_id'],
      ['invoiceId','invoice_id'],
      ['bookingId','booking_id'],
      ['clientId','client_id'],
      ['idempotencyKey','idempotency_key'],
      ['providerReference','provider_reference'],
      ['refundedAt','refunded_at'],
      ['amountHalalas','amount_halalas'],
      ['salonId','salon_id']
    ]) {
      if (
        data[camel] != null &&
        data[snake] != null &&
        cleanText(String(data[camel])) !==
          cleanText(String(data[snake]))
      ) {
        throw new AppError(
          409,'core_refund:reference_conflict'
        );
      }
    }

    for (const tenant of [data.salonId,data.salon_id]) {
      if (tenant != null && cleanText(tenant) !== salonId) {
        throw new AppError(
          409,'core_refund:reference_conflict'
        );
      }
    }
  }
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key);
  if (idempotencyKey) {
    // Keep exact idempotent replays of legacy pending/failed refund records
    // working; a retry must never become a second debit or a new refund.
    const existing = await dbFirst(
      db,
      'SELECT * FROM refunds WHERE salon_id = ? AND idempotency_key = ? LIMIT 1',
      [salonId, idempotencyKey]
    );
    if (existing) {
      if (executionContext) {
        throw new AppError(
          409,'core_refund:existing_operation_requires_verification'
        );
      }
      await assertPackageRefundWorkflowAvailable(
        db, salonId, existing.booking_id
      );
      const pending = await reconcileRefundDerivedEffects(
        db, salonId, existing.booking_id, actor?.uid || ''
      );
      return {
        ...existing,
        idempotent: true,
        ...(pending.length ? { reconciliation_pending: pending } : {}),
      };
    }
  }
  // This write path immediately debits settled invoice revenue. Pending
  // refunds require a separate confirmation transition, not a status flag.
  const status = cleanText(data.status == null ? 'completed' : data.status).toLowerCase();
  if (status !== 'completed') {
    throw new AppError(400, 'core_refund:invalid_settlement_status');
  }

  const paymentId = optionalText(data.paymentId || data.payment_id);
  const payment = paymentId
    ? await dbFirst(db, 'SELECT * FROM payments WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, paymentId])
    : null;
  if (paymentId && !payment) throw new AppError(404, 'core_payment:not_found');

  if (executionContext) {
    if (!payment || !payment.invoice_id) {
      throw new AppError(
        409,'core_refund:verified_payment_required'
      );
    }

    if (!['paid','completed','succeeded'].includes(
      cleanText(payment.status).toLowerCase()
    )) {
      throw new AppError(
        409,'core_refund:payment_not_settled'
      );
    }

    for (const [supplied,expected] of [
      [data.invoiceId,payment.invoice_id],
      [data.invoice_id,payment.invoice_id],
      [data.bookingId,payment.booking_id],
      [data.booking_id,payment.booking_id],
      [data.clientId,payment.client_id],
      [data.client_id,payment.client_id]
    ]) {
      if (
        supplied != null &&
        cleanText(supplied) !== cleanText(expected)
      ) {
        throw new AppError(
          409,'core_refund:reference_conflict'
        );
      }
    }
  }

  const amount = integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 });
  if (payment && amount > Number(payment.amount_halalas || 0)) {
    throw new AppError(409, 'core_refund:amount_exceeds_payment');
  }
  if (payment) {
    const totals = await dbFirst(
      db,
      "SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds WHERE salon_id = ? AND payment_id = ? AND LOWER(TRIM(status)) = 'completed'",
      [salonId, paymentId]
    );
    if (Number(totals?.total || 0) + amount > Number(payment.amount_halalas || 0)) {
      throw new AppError(409, 'core_refund:amount_exceeds_remaining');
    }
  }

  const now = nowIso();
  const requestedBookingId = optionalText(data.bookingId || data.booking_id) || payment?.booking_id || null;
  await assertPackageRefundWorkflowAvailable(db, salonId, requestedBookingId);
  const requestedInvoiceId = optionalText(data.invoiceId || data.invoice_id) || payment?.invoice_id || null;
  const invoice = requestedInvoiceId
    ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, requestedInvoiceId])
    : requestedBookingId
      ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ? ORDER BY issued_at DESC LIMIT 1', [salonId, requestedBookingId])
      : null;
  const invoiceId = requestedInvoiceId || invoice?.id || null;

  if (executionContext) {
    if (
      !invoice ||
      invoice.id !== payment.invoice_id ||
      (invoice.booking_id || null) !==
        (payment.booking_id || null) ||
      (invoice.client_id || null) !==
        (payment.client_id || null)
    ) {
      throw new AppError(
        409,'core_refund:reference_conflict'
      );
    }
  }
  const row = {
    id: requiredId(data.id || generatedId('refund')),
    salon_id: salonId,
    payment_id: paymentId || null,
    invoice_id: invoiceId,
    booking_id: requestedBookingId || invoice?.booking_id || null,
    client_id: optionalText(data.clientId || data.client_id) || payment?.client_id || invoice?.client_id || null,
    amount_halalas: amount,
    method: cleanText(data.method || payment?.method || 'cash'),
    reason: optionalText(data.reason) || null,
    status,
    idempotency_key: idempotencyKey || null,
    provider_reference: optionalText(data.providerReference || data.provider_reference) || null,
    created_by_uid: optionalText(actor.uid) || null,
    refunded_at: optionalText(data.refundedAt || data.refunded_at) || now,
    voided_at: null,
    voided_by_uid: null,
    created_at: now,
  };

  const statements = [
    {
      sql: `INSERT INTO refunds
        (id, salon_id, payment_id, invoice_id, booking_id, client_id, amount_halalas,
         method, reason, status, idempotency_key, provider_reference, created_by_uid, refunded_at, voided_at, voided_by_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.salon_id, row.payment_id, row.invoice_id, row.booking_id, row.client_id,
        row.amount_halalas, row.method, row.reason, row.status, row.idempotency_key,
        row.provider_reference, row.created_by_uid, row.refunded_at, row.voided_at, row.voided_by_uid, row.created_at,
      ],
    },
  ];

  if (payment && row.status === 'completed') {
    // Re-check the aggregate budget at INSERT time inside the same D1 batch.
    // A separate preflight SUM cannot protect two different refund IDs.
    statements[0].sql = statements[0].sql.replace(
      /VALUES\s*\([\s\S]*?\)\s*$/,
      `SELECT ${Array.from({ length: 17 }, () => '?').join(', ')}
       WHERE EXISTS (SELECT 1 FROM payments AS p
         WHERE p.salon_id = ? AND p.id = ?
           AND p.amount_halalas >= ? + COALESCE((
             SELECT SUM(r.amount_halalas) FROM refunds AS r
              WHERE r.salon_id = p.salon_id AND r.payment_id = p.id
                AND LOWER(TRIM(r.status)) = 'completed'
           ), 0))`
    );
    statements[0].params.push(salonId, payment.id, amount);

    if (executionContext) {
      const liveGuard = "WHERE p.salon_id = ? AND p.id = ?";

      statements[0].sql = statements[0].sql.replace(
        liveGuard,
        liveGuard +
          " AND LOWER(TRIM(p.status)) IN ('paid','completed','succeeded')" +
          " AND p.invoice_id IS ?" +
          " AND p.booking_id IS ?" +
          " AND p.client_id IS ?" +
          " AND EXISTS (SELECT 1 FROM invoices AS i" +
          " WHERE i.salon_id=p.salon_id" +
          " AND i.id=p.invoice_id" +
          " AND i.booking_id IS p.booking_id" +
          " AND i.client_id IS p.client_id)" +
          " AND NOT EXISTS (SELECT 1 FROM booking_items AS bi" +
          " WHERE bi.salon_id=p.salon_id" +
          " AND bi.booking_id=p.booking_id" +
          " AND bi.package_covered=1)"
      );

      // Insert these bindings before the refund amount
      // parameter already used by the live budget guard.

      statements[0].params.splice(
        statements[0].params.length - 1,
        0,
        payment.invoice_id || null,
        payment.booking_id || null,
        payment.client_id || null
      );
    }
  }

  if (executionContext) {
    statements.push({
      sql: "INSERT INTO booking_lifecycle_cas_guard (id) SELECT NULL WHERE changes() <> 1",
      params: [],
    });
  }

  if (invoice) {
    statements.push(invoiceAdjustmentStatement(salonId, invoice.id, -amount, now, {
      requirePriorUpdate: !executionContext,
      minimumPaid: amount,
    }));
    statements.push({
      sql: `INSERT INTO booking_lifecycle_cas_guard (id)
            SELECT NULL WHERE changes() <> 1`,
      params: [],
    });
  }

  statements.push(
    auditInsertStatement(salonId, {
      action: 'refund_created', entityType: 'refund', entityId: row.id,
      description: 'Refund recorded in Core D1', after: row, source: 'dashboard',
    }, actor).statement
  );

  if (executionContext) {
    statements.push(
      ...atomicIdempotencyCompletionStatements({
        salonId,
        operationId: executionContext.operationId,
        fingerprint: executionContext.fingerprint,
        requestId: executionContext.requestId,
        executionToken: executionContext.executionToken,
        status: 200,
        responseBody: JSON.stringify({
          ok:true,data:row
        }),
      })
    );
  }

  // RETURNING identifies the direct mutation independently of triggers.
  statements[0].sql += ' RETURNING id';

  let results;
  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    if (/booking_lifecycle_cas_guard\.id/i.test(cleanText(error?.message))) {
      throw new AppError(409, 'core_refund:amount_exceeds_remaining');
    }
    throw error;
  }
  if (
    results[0]?.results?.length !== 1 ||
    results[0].results[0]?.id !== row.id
  ) {
    throw new AppError(409, 'core_refund:amount_exceeds_remaining');
  }
  const pending = await reconcileRefundDerivedEffects(
    db, salonId, row.booking_id, actor?.uid || ''
  );
  if (executionContext && pending.length) {
    console.error('core_refund_atomic_reconciliation_pending', {
      salonId,
      refundId: row.id,
      bookingId: row.booking_id,
      effects: pending,
    });
  }

  if (executionContext) return row;

  return pending.length
    ? { ...row, reconciliation_pending: pending }
    : row;
}



export async function patchRefund(db, salonId, id, data, actor = {}) {
  const refund = await getRefund(db, salonId, id);
  await assertPackageRefundWorkflowAvailable(db, salonId, refund.booking_id);
  if (cleanText(refund.status).toLowerCase() === 'voided') {
    throw new AppError(409, 'core_refund:voided');
  }
  // A PATCH adjusts an already settled refund amount; it cannot be used to
  // transition legacy pending rows or request a new pending status.
  if (cleanText(refund.status).toLowerCase() !== 'completed') {
    throw new AppError(409, 'core_refund:not_settled');
  }
  if (data.status !== undefined && cleanText(data.status).toLowerCase() !== 'completed') {
    throw new AppError(400, 'core_refund:invalid_settlement_status');
  }

  const payment = refund.payment_id
    ? await dbFirst(db, 'SELECT * FROM payments WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, refund.payment_id])
    : null;
  const amount = data.amountHalalas == null && data.amount_halalas == null
    ? Number(refund.amount_halalas || 0)
    : integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 });

  if (payment) {
    const totals = await dbFirst(
      db,
      "SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds WHERE salon_id = ? AND payment_id = ? AND LOWER(TRIM(status)) = 'completed' AND id <> ?",
      [salonId, refund.payment_id, refund.id]
    );
    if (Number(totals?.total || 0) + amount > Number(payment.amount_halalas || 0)) {
      throw new AppError(409, 'core_refund:amount_exceeds_remaining');
    }
  }

  const invoice = refund.invoice_id
    ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, refund.invoice_id])
    : null;
  const now = nowIso();
  const method = cleanText(data.method || refund.method || 'cash');
  const reason = data.reason === undefined ? refund.reason : optionalText(data.reason) || null;
  const refundedAt = optionalText(data.refundedAt || data.refunded_at) || refund.refunded_at || now;
  const statements = [
    {
      sql: `UPDATE refunds SET amount_halalas = ?, method = ?, reason = ?, refunded_at = ?
            WHERE salon_id = ? AND id = ? AND amount_halalas = ? AND status = ?`,
      params: [amount, method, reason, refundedAt, salonId, refund.id, refund.amount_halalas, refund.status],
    },
  ];
  if (payment && cleanText(refund.status).toLowerCase() === 'completed') {
    statements[0].sql += ` AND EXISTS (
      SELECT 1 FROM payments p WHERE p.salon_id = ? AND p.id = ?
        AND p.amount_halalas >= ? + COALESCE((
          SELECT SUM(r.amount_halalas) FROM refunds r
           WHERE r.salon_id = p.salon_id AND r.payment_id = p.id
             AND LOWER(TRIM(r.status)) = 'completed' AND r.id <> ?
        ), 0)
    )`;
    statements[0].params.push(salonId, payment.id, amount, refund.id);
  }

  statements.push({
    sql: `INSERT INTO booking_lifecycle_cas_guard (id)
          SELECT NULL WHERE changes() <> 1`,
    params: [],
  });
  if (invoice) {
    const delta = Number(refund.amount_halalas || 0) - amount;
    statements.push(invoiceAdjustmentStatement(salonId, invoice.id, delta, now));
  }
  statements.push({
    sql: "DELETE FROM expense_entries WHERE salon_id = ? AND source_kind = 'refund' AND source_ref_id = ?",
    params: [salonId, refund.id],
  });

  const expected = {
    ...refund,
    amount_halalas: amount,
    method,
    reason,
    refunded_at: refundedAt,
  };
  statements.push(
    auditInsertStatement(salonId, {
      action: 'refund_updated', entityType: 'refund', entityId: id,
      description: 'Refund updated in Core D1', before: refund, after: expected,
      source: 'dashboard',
    }, actor).statement
  );

  // RETURNING identifies the direct mutation independently of triggers.
  statements[0].sql += ' RETURNING id';

  let results;
  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    if (/booking_lifecycle_cas_guard\.id/i.test(cleanText(error?.message))) {
      throw new AppError(409, 'core_refund:concurrent_modification');
    }
    throw error;
  }
  if (
    results[0]?.results?.length !== 1 ||
    results[0].results[0]?.id !== refund.id
  ) {
    throw new AppError(409, 'core_refund:concurrent_modification');
  }
  const row = await getRefund(db, salonId, id);
  const pending = await reconcileRefundDerivedEffects(
    db, salonId, row.booking_id, actor?.uid || ''
  );
  return pending.length
    ? { ...row, reconciliation_pending: pending }
    : row;
}

export async function voidRefund(db, salonId, id, actor = {}) {
  const refund = await getRefund(db, salonId, id);
  await assertPackageRefundWorkflowAvailable(db, salonId, refund.booking_id);
  if (cleanText(refund.status).toLowerCase() === 'voided') {
    return { ...refund, idempotent: true };
  }

  const invoice = refund.invoice_id
    ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, refund.invoice_id])
    : null;
  const now = nowIso();
  const statements = [
    {
      sql: "UPDATE refunds SET status = 'voided', voided_at = ?, voided_by_uid = ? WHERE salon_id = ? AND id = ? AND status = ? AND amount_halalas = ?",
      params: [now, optionalText(actor.uid) || null, salonId, requiredId(id), refund.status, refund.amount_halalas],
    },
  ];

  statements.push({
    sql: `INSERT INTO booking_lifecycle_cas_guard (id)
          SELECT NULL WHERE changes() <> 1`,
    params: [],
  });

  if (invoice && cleanText(refund.status).toLowerCase() === 'completed') {
    statements.push(invoiceAdjustmentStatement(
      salonId, invoice.id, Number(refund.amount_halalas || 0), now
    ));
  }
  statements.push({
    sql: "DELETE FROM expense_entries WHERE salon_id = ? AND source_kind = 'refund' AND source_ref_id = ?",
    params: [salonId, id],
  });

  const expected = {
    ...refund,
    status: 'voided',
    voided_at: now,
    voided_by_uid: optionalText(actor.uid) || null,
  };
  statements.push(
    auditInsertStatement(salonId, {
      action: 'refund_voided', entityType: 'refund', entityId: id,
      description: 'Refund voided in Core D1', before: refund, after: expected,
      source: 'dashboard',
    }, actor).statement
  );

  // RETURNING identifies the direct mutation independently of triggers.
  statements[0].sql += ' RETURNING id';

  let results;
  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    if (/booking_lifecycle_cas_guard\.id/i.test(cleanText(error?.message))) {
      const current = await getRefund(db, salonId, id);
      if (cleanText(current.status).toLowerCase() === 'voided') {
        return { ...current, idempotent: true };
      }
      throw new AppError(409, 'core_refund:concurrent_modification');
    }
    throw error;
  }
  if (
    results[0]?.results?.length !== 1 ||
    results[0].results[0]?.id !== refund.id
  ) {
    const current = await getRefund(db, salonId, id);
    if (cleanText(current.status).toLowerCase() === 'voided') {
      return { ...current, idempotent: true };
    }
    throw new AppError(409, 'core_refund:concurrent_modification');
  }
  const row = await getRefund(db, salonId, id);
  const pending = await reconcileRefundDerivedEffects(
    db, salonId, row.booking_id, actor?.uid || ''
  );
  return pending.length
    ? { ...row, reconciliation_pending: pending }
    : row;
}
