// CORE D1 ONLY — do not add Firestore fallback.

import {
  cleanText,
  dbAll,
  dbRun,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
  updateById,
} from '../d1.js';

export async function listIncome(db, salonId) {
  return dbAll(db, "SELECT * FROM income_entries WHERE salon_id = ? ORDER BY occurred_at DESC LIMIT 500", [salonId]);
}

export async function createIncome(db, salonId, data) {
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId("income")),
    salon_id: salonId,
    booking_id: optionalText(data.bookingId || data.booking_id) || null,
    invoice_id: optionalText(data.invoiceId || data.invoice_id) || null,
    payment_id: optionalText(data.paymentId || data.payment_id) || null,
    amount_halalas: integer(data.amountHalalas ?? data.amount_halalas, "amountHalalas", { min: 1, max: 100_000_000 }),
    category: optionalText(data.category) || null,
    description: optionalText(data.description) || null,
    occurred_at: optionalText(data.occurredAt || data.occurred_at) || now,
    created_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO income_entries
      (id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.salon_id, row.booking_id, row.invoice_id, row.payment_id, row.amount_halalas, row.category, row.description, row.occurred_at, row.created_at]
  );
  return row;
}

export async function listExpenses(db, salonId) {
  return dbAll(db, "SELECT * FROM expense_entries WHERE salon_id = ? ORDER BY occurred_at DESC LIMIT 500", [salonId]);
}

export async function createExpense(db, salonId, data, actorUid = "") {
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId("expense")),
    salon_id: salonId,
    amount_halalas: integer(data.amountHalalas ?? data.amount_halalas, "amountHalalas", { min: 1, max: 100_000_000 }),
    category: optionalText(data.category) || null,
    description: optionalText(data.description) || null,
    payment_method: cleanText(data.paymentMethod || data.payment_method || "cash"),
    occurred_at: optionalText(data.occurredAt || data.occurred_at) || now,
    created_by_uid: actorUid || null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO expense_entries
      (id, salon_id, amount_halalas, category, description, payment_method, occurred_at, created_by_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.salon_id,
      row.amount_halalas,
      row.category,
      row.description,
      row.payment_method,
      row.occurred_at,
      row.created_by_uid,
      row.created_at,
      row.updated_at,
    ]
  );
  return row;
}

export async function patchExpense(db, salonId, id, data) {
  return updateById(db, "expense_entries", salonId, requiredId(id), {
    amount_halalas: data.amountHalalas === undefined && data.amount_halalas === undefined
      ? undefined
      : integer(data.amountHalalas ?? data.amount_halalas, "amountHalalas", { min: 1, max: 100_000_000 }),
    category: data.category === undefined ? undefined : (optionalText(data.category) || null),
    description: data.description === undefined ? undefined : (optionalText(data.description) || null),
    payment_method: data.paymentMethod === undefined && data.payment_method === undefined
      ? undefined
      : cleanText(data.paymentMethod || data.payment_method || "cash"),
    occurred_at: data.occurredAt === undefined && data.occurred_at === undefined
      ? undefined
      : cleanText(data.occurredAt || data.occurred_at),
  });
}
