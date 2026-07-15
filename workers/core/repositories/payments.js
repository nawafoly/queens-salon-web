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

function paymentStatusForInvoice(total, paid) {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

export async function listPayments(db, salonId) {
  return dbAll(db, "SELECT * FROM payments WHERE salon_id = ? ORDER BY created_at DESC LIMIT 500", [salonId]);
}

export async function createPayment(db, salonId, data) {
  const idempotencyKey = optionalText(data.idempotencyKey || data.idempotency_key);
  if (idempotencyKey) {
    const existing = await dbFirst(db, "SELECT * FROM payments WHERE salon_id = ? AND idempotency_key = ? LIMIT 1", [salonId, idempotencyKey]);
    if (existing) return { ...existing, idempotent: true };
  }
  const invoiceId = optionalText(data.invoiceId || data.invoice_id);
  const invoice = invoiceId ? await getInvoice(db, salonId, invoiceId) : null;
  const amount = integer(data.amountHalalas ?? data.amount_halalas, "amountHalalas", { min: 1, max: 100_000_000 });
  const now = nowIso();
  const payment = {
    id: requiredId(data.id || generatedId("payment")),
    salon_id: salonId,
    invoice_id: invoiceId || null,
    booking_id: optionalText(data.bookingId || data.booking_id) || invoice?.booking_id || null,
    client_id: optionalText(data.clientId || data.client_id) || invoice?.client_id || null,
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
        (id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?, ?)`,
      params: [
        generatedId("income"),
        salonId,
        payment.booking_id,
        payment.invoice_id,
        payment.id,
        payment.amount_halalas,
        `Payment ${payment.method}`,
        payment.paid_at,
        now,
      ],
    },
  ];
  if (invoice) {
    const paidAfter = Number(invoice.paid_halalas || 0) + amount;
    statements.push({
      sql: "UPDATE invoices SET paid_halalas = ?, status = ?, updated_at = ? WHERE salon_id = ? AND id = ?",
      params: [paidAfter, paymentStatusForInvoice(Number(invoice.total_halalas || 0), paidAfter), now, salonId, invoice.id],
    });
  }
  await dbBatch(db, statements);
  return payment;
}
