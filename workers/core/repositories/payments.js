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
import { getInvoice } from './invoices.js';
import { auditInsertStatement } from './audit.js';
import { reconcileCashbackForBooking } from './cashback.js';

function paymentStatusForInvoice(total, paid) {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
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

export async function createPayment(db, salonId, data, actor = {}) {
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key);
  if (idempotencyKey) {
    const existing = await dbFirst(db, "SELECT * FROM payments WHERE salon_id = ? AND idempotency_key = ? LIMIT 1", [salonId, idempotencyKey]);
    if (existing) return { ...existing, idempotent: true };
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
    status: cleanText(data.status || "paid"),
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
  let paidAfter = null;
  let invoiceStatus = null;
  if (invoice) {
    paidAfter = Number(invoice.paid_halalas || 0) + amount;
    invoiceStatus = paymentStatusForInvoice(Number(invoice.total_halalas || 0), paidAfter);
    statements.push({
      sql: "UPDATE invoices SET paid_halalas = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ?",
      params: [paidAfter, invoiceStatus, now, salonId, invoice.id],
    });
    if (payment.booking_id) {
      statements.push({
        sql: "UPDATE bookings SET payment_status = ?, updated_at = ? WHERE salon_id = ? AND id = ?",
        params: [invoiceStatus, now, salonId, payment.booking_id],
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
  if (invoice) {
    statements.push(auditInsertStatement(salonId, {
      action: "invoice_payment_updated",
      entityType: "invoice",
      entityId: invoice.id,
      description: "Invoice payment totals updated",
      source: "core-payment",
      before: {
        paidHalalas: Number(invoice.paid_halalas || 0),
        status: invoice.status,
      },
      after: {
        paidHalalas: paidAfter,
        status: invoiceStatus,
      },
      meta: { paymentId: payment.id, bookingId: payment.booking_id },
    }, actor).statement);
    if (payment.booking_id) {
      statements.push(auditInsertStatement(salonId, {
        action: "booking_payment_status_updated",
        entityType: "booking",
        entityId: payment.booking_id,
        description: "Booking payment status updated",
        source: "core-payment",
        after: {
          paymentStatus: invoiceStatus,
          invoiceId: invoice.id,
          paidHalalas: paidAfter,
        },
        meta: { paymentId: payment.id },
      }, actor).statement);
    }
  }
  await dbBatch(db, statements);
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
