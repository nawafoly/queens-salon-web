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
import { getInvoice } from './invoices.js';
import { auditInsertStatement } from './audit.js';
import { reconcileCashbackForBooking } from './cashback.js';

// Render invoice audit values from the row inside the same D1 transaction.
// A pre-batch JS invoice snapshot is not safe if two payments run concurrently.
function invoiceAuditFromLiveRow(salonId, invoiceId, payment, amount, actor) {
  const template = auditInsertStatement(salonId, {
    action: 'invoice_payment_updated',
    entityType: 'invoice',
    entityId: invoiceId,
    description: 'Invoice payment totals updated',
    source: 'core-payment',
    before: null,
    after: null,
    meta: { paymentId: payment.id, bookingId: payment.booking_id },
  }, actor).statement;
  const projections = template.params.map((_, index) => {
    if (index === 14) return "json_object('paidHalalas', i.paid_halalas, 'status', i.status)";
    if (index === 15) return `json_object('paidHalalas', i.paid_halalas + ?,
      'status', CASE WHEN i.paid_halalas + ? <= 0 THEN 'unpaid'
                     WHEN i.paid_halalas + ? >= i.total_halalas THEN 'paid'
                     ELSE 'partial' END)`;
    return '?';
  });
  const sql = template.sql.replace(
    /VALUES\s*\([\s\S]*?\)\s*$/,
    `SELECT ${projections.join(', ')}
       FROM invoices AS i WHERE i.salon_id = ? AND i.id = ? /* PAYMENT_INVOICE_AUDIT */`
  );
  if (sql === template.sql) throw new Error('PAYMENT_INVOICE_AUDIT_INVALID');
  return {
    sql,
    params: [
      ...template.params.flatMap((value, i) => i === 14 ? [] : i === 15 ? [amount, amount, amount] : [value]),
      salonId, invoiceId,
    ],
  };
}

function bookingPaymentAuditFromLiveInvoice(salonId, invoiceId, payment, actor) {
  const template = auditInsertStatement(salonId, {
    action: 'booking_payment_status_updated',
    entityType: 'booking',
    entityId: payment.booking_id,
    description: 'Booking payment status updated',
    source: 'core-payment',
    after: null,
    meta: { paymentId: payment.id },
  }, actor).statement;
  const fields = template.params.map((_, i) => i === 15
    ? "json_object('paymentStatus', i.status, 'invoiceId', i.id, 'paidHalalas', i.paid_halalas)"
    : '?');
  const sql = template.sql.replace(
    /VALUES\s*\([\s\S]*?\)\s*$/,
    `SELECT ${fields.join(', ')}
       FROM invoices AS i WHERE i.salon_id = ? AND i.id = ? /* PAYMENT_BOOKING_AUDIT */`
  );
  if (sql === template.sql) throw new Error('PAYMENT_BOOKING_AUDIT_INVALID');
  return {
    sql,
    params: [...template.params.filter((_, i) => i !== 15), salonId, invoiceId],
  };
}

export async function listPayments(db, salonId) {
  return dbAll(db, "SELECT * FROM payments WHERE salon_id = ? ORDER BY created_at DESC LIMIT 500", [salonId]);
}

async function resolveInvoice(db, salonId, invoiceId, bookingId) {
  if (invoiceId) return getInvoice(db, salonId, invoiceId);
  if (!bookingId) return null;
  return dbFirst(
    db,
    "SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ? ORDER BY issued_at DESC LIMIT 1",
    [salonId, bookingId]
  );
}

// Core payment creation records *settled* income only. Pending/failed states
// require a separate settlement transition design and must never post money.
const SETTLED_PAYMENT_STATUSES = new Set(['paid', 'completed', 'succeeded']);

export async function createPayment(db, salonId, data, actor = {}) {
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key);
  if (idempotencyKey) {
    // Preserve exact retries of committed legacy records, including
    // non-settled statuses recorded before this policy was introduced.
    const existing = await dbFirst(db, "SELECT * FROM payments WHERE salon_id = ? AND idempotency_key = ? LIMIT 1", [salonId, idempotencyKey]);
    if (existing) return { ...existing, idempotent: true };
  }
  const status = cleanText(data.status == null ? 'paid' : data.status).toLowerCase();
  if (!SETTLED_PAYMENT_STATUSES.has(status)) {
    throw new AppError(400, 'core_payment:invalid_settlement_status');
  }
  const invoiceId = optionalText(data.invoiceId || data.invoice_id);
  const inputBookingId = optionalText(data.bookingId || data.booking_id);
  const invoice = await resolveInvoice(db, salonId, invoiceId, inputBookingId);
  const amount = integer(data.amountHalalas ?? data.amount_halalas, "amountHalalas", { min: 1, max: 100_000_000 });
  const now = nowIso();
  const payment = {
    id: requiredId(data.id || generatedId("payment")),
    salon_id: salonId,
    invoice_id: invoice?.id || invoiceId || null,
    booking_id: invoice?.booking_id || inputBookingId || null,
    client_id: invoice?.client_id || optionalText(data.clientId || data.client_id) || null,
    method: cleanText(data.method || "cash"),
    amount_halalas: amount,
    status,
    provider: optionalText(data.provider) || null,
    provider_reference: optionalText(data.providerReference || data.provider_reference) || null,
    idempotency_key: idempotencyKey || null,
    paid_at: optionalText(data.paidAt || data.paid_at) || now,
    created_at: now,
  };
  const statements = [
    {
      sql: `INSERT INTO payments
        (id, salon_id, invoice_id, booking_id, client_id, method, amount_halalas, status,
         provider, provider_reference, idempotency_key, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        payment.id,
        payment.salon_id,
        payment.invoice_id,
        payment.booking_id,
        payment.client_id,
        payment.method,
        payment.amount_halalas,
        payment.status,
        payment.provider,
        payment.provider_reference,
        payment.idempotency_key,
        payment.paid_at,
        payment.created_at,
      ],
    },
    {
      sql: `INSERT INTO income_entries
        (id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description,
         method, payment_breakdown_json, source, note, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?, ?, 'booking', ?, ?, ?)`,
      params: [
        generatedId("income"),
        salonId,
        payment.booking_id,
        payment.invoice_id,
        payment.id,
        payment.amount_halalas,
        `Payment ${payment.method}`,
        payment.method,
        JSON.stringify({ [payment.method]: payment.amount_halalas / 100 }),
        `booking_payment:${payment.method}`,
        payment.paid_at,
        now,
      ],
    },
  ];
  if (invoice) {
    // All invoice-related statements share one D1 batch (transaction).
    // The audit reads the actual previous row at write time, not a stale
    // pre-transaction snapshot, and the UPDATE increments it atomically.
    statements.push(invoiceAuditFromLiveRow(salonId, invoice.id, payment, amount, actor));
    statements.push({
      sql: `UPDATE invoices SET paid_halalas = paid_halalas + ?,
        status = CASE WHEN paid_halalas + ? <= 0 THEN 'unpaid'
                      WHEN paid_halalas + ? >= total_halalas THEN 'paid'
                      ELSE 'partial' END,
        updated_at = ? WHERE salon_id = ? AND id = ?`,
      params: [amount, amount, amount, now, salonId, invoice.id],
    });
    if (payment.booking_id) {
      statements.push({
        sql: `UPDATE bookings SET payment_status = (
          SELECT status FROM invoices WHERE salon_id = ? AND id = ?
        ), updated_at = ? WHERE salon_id = ? AND id = ?`,
        params: [salonId, invoice.id, now, salonId, payment.booking_id],
      });
    }
  }
  const incomeId = statements[1].params[0];
  statements.push(
    auditInsertStatement(salonId, {
      action: "payment_recorded",
      entityType: "payment",
      entityId: payment.id,
      description: "Payment recorded",
      source: "core-payment",
      after: payment,
      meta: {
        invoiceId: payment.invoice_id,
        bookingId: payment.booking_id,
        amountHalalas: payment.amount_halalas,
        method: payment.method,
        idempotencyKey: payment.idempotency_key,
      },
    }, actor).statement,
    auditInsertStatement(salonId, {
      action: "income_created",
      entityType: "income_entry",
      entityId: incomeId,
      description: `Payment ${payment.method}`,
      source: "core-payment",
      after: {
        id: incomeId,
        bookingId: payment.booking_id,
        invoiceId: payment.invoice_id,
        paymentId: payment.id,
        amountHalalas: payment.amount_halalas,
        category: "payment",
        occurredAt: payment.paid_at,
      },
      meta: { paymentId: payment.id },
    }, actor).statement
  );
  if (invoice && payment.booking_id) {
    statements.push(bookingPaymentAuditFromLiveInvoice(salonId, invoice.id, payment, actor));
  }
  try {
    await dbBatch(db, statements);
  } catch (error) {
    // The unique (salon_id, idempotency_key) constraint is the final arbiter
    // if two callers raced past the initial lookup. Return the winner without
    // recording another payment, income entry, or audit event.
    if (idempotencyKey && /UNIQUE|constraint failed|SQLITE_CONSTRAINT/i.test(String(error?.message || ''))) {
      const winner = await dbFirst(db,
        'SELECT * FROM payments WHERE salon_id = ? AND idempotency_key = ? LIMIT 1',
        [salonId, idempotencyKey]);
      if (winner) return { ...winner, idempotent: true };
    }
    throw error;
  }
  if (payment.booking_id) {
    await reconcileCashbackForBooking(
      db,
      salonId,
      payment.booking_id,
      actor?.uid || ""
    );
  }
  return payment;
}
