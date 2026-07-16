// CORE D1 ONLY — do not add Firestore fallback.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
  rowNotFound,
} from '../d1.js';
import { getClient } from './clients.js';

export async function listInvoices(db, salonId) {
  return dbAll(db, "SELECT * FROM invoices WHERE salon_id = ? ORDER BY issued_at DESC LIMIT 500", [salonId]);
}

export async function getInvoice(db, salonId, id) {
  const row = await dbFirst(db, "SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, requiredId(id)]);
  if (!row) rowNotFound("invoice");
  return row;
}

export async function getInvoiceByBookingId(db, salonId, bookingId) {
  const row = await dbFirst(
    db,
    "SELECT * FROM invoices WHERE salon_id = ? AND booking_id = ? ORDER BY issued_at DESC LIMIT 1",
    [salonId, requiredId(bookingId, "bookingId")]
  );
  if (!row) rowNotFound("invoice");
  return row;
}

export async function createInvoice(db, salonId, data) {
  const now = nowIso();
  const clientId = requiredId(data.clientId || data.client_id, "clientId");
  await getClient(db, salonId, clientId);
  const subtotal = integer(data.subtotalHalalas ?? data.subtotal_halalas, "subtotalHalalas", { min: 0, max: 100_000_000 });
  const discount = integer(data.discountHalalas ?? data.discount_halalas, "discountHalalas", { min: 0, max: subtotal, fallback: 0 });
  const total = integer(data.totalHalalas ?? data.total_halalas ?? subtotal - discount, "totalHalalas", { min: 0, max: 100_000_000 });
  const row = {
    id: requiredId(data.id || generatedId("invoice")),
    salon_id: salonId,
    booking_id: optionalText(data.bookingId || data.booking_id) || null,
    client_id: clientId,
    invoice_number: optionalText(data.invoiceNumber || data.invoice_number) || null,
    subtotal_halalas: subtotal,
    discount_halalas: discount,
    total_halalas: total,
    paid_halalas: integer(data.paidHalalas ?? data.paid_halalas, "paidHalalas", { min: 0, max: total, fallback: 0 }),
    status: cleanText(data.status || "unpaid"),
    issued_at: optionalText(data.issuedAt || data.issued_at) || now,
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO invoices
      (id, salon_id, booking_id, client_id, invoice_number, subtotal_halalas, discount_halalas,
       total_halalas, paid_halalas, status, issued_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.salon_id,
      row.booking_id,
      row.client_id,
      row.invoice_number,
      row.subtotal_halalas,
      row.discount_halalas,
      row.total_halalas,
      row.paid_halalas,
      row.status,
      row.issued_at,
      row.created_at,
      row.updated_at,
    ]
  );
  return row;
}
