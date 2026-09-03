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
import { recordAudit } from './audit.js';
import { safeRefreshTargetsForBooking } from './employee-targets.js';

function invoiceStatus(total, paid) {
  if (paid <= 0) return 'unpaid';
  if (paid >= total) return 'paid';
  return 'partial';
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

export async function createRefund(db, salonId, data, actor = {}) {
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key);
  if (idempotencyKey) {
    const existing = await dbFirst(
      db,
      'SELECT * FROM refunds WHERE salon_id = ? AND idempotency_key = ? LIMIT 1',
      [salonId, idempotencyKey]
    );
    if (existing) return { ...existing, idempotent: true };
  }

  const paymentId = optionalText(data.paymentId || data.payment_id);
  const payment = paymentId
    ? await dbFirst(db, 'SELECT * FROM payments WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, paymentId])
    : null;
  if (paymentId && !payment) throw new AppError(404, 'core_payment:not_found');

  const amount = integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 });
  if (payment && amount > Number(payment.amount_halalas || 0)) {
    throw new AppError(409, 'core_refund:amount_exceeds_payment');
  }
  if (payment) {
    const totals = await dbFirst(
      db,
      "SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds WHERE salon_id = ? AND payment_id = ? AND status = 'completed'",
      [salonId, paymentId]
    );
    if (Number(totals?.total || 0) + amount > Number(payment.amount_halalas || 0)) {
      throw new AppError(409, 'core_refund:amount_exceeds_remaining');
    }
  }

  const now = nowIso();
  const requestedBookingId = optionalText(data.bookingId || data.booking_id) || payment?.booking_id || null;
  const requestedInvoiceId = optionalText(data.invoiceId || data.invoice_id) || payment?.invoice_id || null;
  const invoice = requestedInvoiceId
    ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, requestedInvoiceId])
    : requestedBookingId
      ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ? ORDER BY issued_at DESC LIMIT 1', [salonId, requestedBookingId])
      : null;
  const invoiceId = requestedInvoiceId || invoice?.id || null;
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
    status: cleanText(data.status || 'completed'),
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

  if (invoice) {
    const paidAfter = Math.max(0, Number(invoice.paid_halalas || 0) - amount);
    statements.push({
      sql: 'UPDATE invoices SET paid_halalas = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ?',
      params: [paidAfter, invoiceStatus(Number(invoice.total_halalas || 0), paidAfter), now, salonId, invoice.id],
    });
  }

  await dbBatch(db, statements);
  await recordAudit(db, salonId, {
    action: 'refund_created', entityType: 'refund', entityId: row.id,
    description: 'Refund recorded in Core D1', after: row, source: 'dashboard',
  }, actor);
  if (row.booking_id) await safeRefreshTargetsForBooking(db, salonId, row.booking_id);
  return row;
}



export async function patchRefund(db, salonId, id, data, actor = {}) {
  const refund = await getRefund(db, salonId, id);
  if (cleanText(refund.status).toLowerCase() === 'voided') {
    throw new AppError(409, 'core_refund:voided');
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
      "SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds WHERE salon_id = ? AND payment_id = ? AND status = 'completed' AND id <> ?",
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
            WHERE salon_id = ? AND id = ?`,
      params: [amount, method, reason, refundedAt, salonId, refund.id],
    },
    {
      sql: "DELETE FROM expense_entries WHERE salon_id = ? AND source_kind = 'refund' AND source_ref_id = ?",
      params: [salonId, refund.id],
    },
  ];

  if (invoice) {
    const paidAfter = Math.max(
      0,
      Math.min(
        Number(invoice.total_halalas || 0),
        Number(invoice.paid_halalas || 0) + Number(refund.amount_halalas || 0) - amount
      )
    );
    statements.push({
      sql: 'UPDATE invoices SET paid_halalas = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ?',
      params: [paidAfter, invoiceStatus(Number(invoice.total_halalas || 0), paidAfter), now, salonId, invoice.id],
    });
  }

  await dbBatch(db, statements);
  const row = await getRefund(db, salonId, id);
  await recordAudit(db, salonId, {
    action: 'refund_updated', entityType: 'refund', entityId: id,
    description: 'Refund updated in Core D1', before: refund, after: row, source: 'dashboard',
  }, actor);
  if (row.booking_id) await safeRefreshTargetsForBooking(db, salonId, row.booking_id);
  return row;
}

export async function voidRefund(db, salonId, id, actor = {}) {
  const refund = await getRefund(db, salonId, id);
  if (cleanText(refund.status).toLowerCase() === 'voided') {
    return { ...refund, idempotent: true };
  }

  const invoice = refund.invoice_id
    ? await dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, refund.invoice_id])
    : null;
  const now = nowIso();
  const statements = [
    {
      sql: "UPDATE refunds SET status = 'voided', voided_at = ?, voided_by_uid = ? WHERE salon_id = ? AND id = ?",
      params: [now, optionalText(actor.uid) || null, salonId, requiredId(id)],
    },
    {
      sql: "DELETE FROM expense_entries WHERE salon_id = ? AND source_kind = 'refund' AND source_ref_id = ?",
      params: [salonId, id],
    },
  ];

  if (invoice && cleanText(refund.status).toLowerCase() === 'completed') {
    const paidAfter = Math.min(
      Number(invoice.total_halalas || 0),
      Number(invoice.paid_halalas || 0) + Number(refund.amount_halalas || 0)
    );
    statements.push({
      sql: 'UPDATE invoices SET paid_halalas = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ?',
      params: [paidAfter, invoiceStatus(Number(invoice.total_halalas || 0), paidAfter), now, salonId, invoice.id],
    });
  }

  await dbBatch(db, statements);
  const row = await getRefund(db, salonId, id);
  await recordAudit(db, salonId, {
    action: 'refund_voided', entityType: 'refund', entityId: id,
    description: 'Refund voided in Core D1', before: refund, after: row, source: 'dashboard',
  }, actor);
  if (row.booking_id) await safeRefreshTargetsForBooking(db, salonId, row.booking_id);
  return row;
}
