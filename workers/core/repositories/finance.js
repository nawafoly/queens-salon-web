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
  updateById,
} from '../d1.js';
import { AppError } from '../errors.js';
import { recordAudit } from './audit.js';

function isRefundExpenseSource(value) {
  return cleanText(value).toLowerCase() === 'refund';
}

function rejectRefundExpense(data) {
  if (isRefundExpenseSource(data?.sourceKind || data?.source_kind) || isRefundExpenseSource(data?.sourceType || data?.source_type)) {
    throw new AppError(422, 'core_expense:refund_not_allowed');
  }
}

function jsonObject(value) {
  if (!value) return '{}';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      return '{}';
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function dateScope(rawDate) {
  const date = cleanText(rawDate);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'core_finance:invalid_date');
  const startDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, 'core_finance:invalid_date');
  }
  const endDate = new Date(startDate.getTime() + 86_400_000);
  return { date, start: startDate.toISOString(), end: endDate.toISOString() };
}

export async function listIncome(db, salonId, query = {}) {
  const scope = dateScope(query.date);
  if (!scope) {
    return dbAll(db, 'SELECT * FROM income_entries WHERE salon_id = ? ORDER BY occurred_at DESC LIMIT 500', [salonId]);
  }

  const occurredRows = await dbAll(
    db,
    `SELECT * FROM income_entries
      WHERE salon_id = ? AND (occurred_at = ? OR (occurred_at >= ? AND occurred_at < ?))
      ORDER BY occurred_at DESC LIMIT 500`,
    [salonId, scope.date, scope.start, scope.end]
  );
  const bookingRows = await dbAll(
    db,
    `SELECT i.*
       FROM bookings b
       JOIN income_entries i
         ON i.salon_id = b.salon_id AND i.booking_id = b.id
      WHERE b.salon_id = ? AND b.booking_date = ? AND b.deleted_at IS NULL
      ORDER BY i.occurred_at DESC LIMIT 500`,
    [salonId, scope.date]
  );

  const byId = new Map();
  for (const row of [...occurredRows, ...bookingRows]) byId.set(cleanText(row?.id), row);
  return [...byId.values()]
    .sort((a, b) => cleanText(b?.occurred_at).localeCompare(cleanText(a?.occurred_at)))
    .slice(0, 500);
}

export async function getIncome(db, salonId, id) {
  const row = await dbFirst(db, 'SELECT * FROM income_entries WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, requiredId(id)]);
  if (!row) rowNotFound('income');
  return row;
}

export async function createIncome(db, salonId, data, actor = {}) {
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId('income')),
    salon_id: salonId,
    booking_id: optionalText(data.bookingId || data.booking_id) || null,
    invoice_id: optionalText(data.invoiceId || data.invoice_id) || null,
    payment_id: optionalText(data.paymentId || data.payment_id) || null,
    amount_halalas: integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 }),
    category: optionalText(data.category) || null,
    description: optionalText(data.description) || null,
    method: optionalText(data.method) || null,
    payment_breakdown_json: jsonObject(data.paymentBreakdown || data.payment_breakdown_json),
    source: optionalText(data.source) || null,
    note: optionalText(data.note) || null,
    client_name: optionalText(data.clientName || data.client_name) || null,
    client_phone: optionalText(data.clientPhone || data.client_phone) || null,
    occurred_at: optionalText(data.occurredAt || data.occurred_at) || now,
    created_at: optionalText(data.createdAt || data.created_at) || now,
  };
  await dbRun(
    db,
    `INSERT INTO income_entries
      (id, salon_id, booking_id, invoice_id, payment_id, amount_halalas, category, description,
       method, payment_breakdown_json, source, note, client_name, client_phone, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.salon_id, row.booking_id, row.invoice_id, row.payment_id,
      row.amount_halalas, row.category, row.description, row.method,
      row.payment_breakdown_json, row.source, row.note, row.client_name,
      row.client_phone, row.occurred_at, row.created_at,
    ]
  );
  await recordAudit(db, salonId, {
    action: 'income_created', entityType: 'income', entityId: row.id,
    description: 'Income created in Core D1', after: row, source: 'dashboard',
  }, actor);
  return row;
}

export async function patchIncome(db, salonId, id, data, actor = {}) {
  const before = await getIncome(db, salonId, id);
  const row = await updateById(db, 'income_entries', salonId, requiredId(id), {
    booking_id: data.bookingId === undefined && data.booking_id === undefined ? undefined : optionalText(data.bookingId || data.booking_id) || null,
    invoice_id: data.invoiceId === undefined && data.invoice_id === undefined ? undefined : optionalText(data.invoiceId || data.invoice_id) || null,
    payment_id: data.paymentId === undefined && data.payment_id === undefined ? undefined : optionalText(data.paymentId || data.payment_id) || null,
    amount_halalas: data.amountHalalas === undefined && data.amount_halalas === undefined ? undefined : integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 }),
    category: data.category === undefined ? undefined : optionalText(data.category) || null,
    description: data.description === undefined ? undefined : optionalText(data.description) || null,
    method: data.method === undefined ? undefined : optionalText(data.method) || null,
    payment_breakdown_json: data.paymentBreakdown === undefined && data.payment_breakdown_json === undefined ? undefined : jsonObject(data.paymentBreakdown || data.payment_breakdown_json),
    source: data.source === undefined ? undefined : optionalText(data.source) || null,
    note: data.note === undefined ? undefined : optionalText(data.note) || null,
    client_name: data.clientName === undefined && data.client_name === undefined ? undefined : optionalText(data.clientName || data.client_name) || null,
    client_phone: data.clientPhone === undefined && data.client_phone === undefined ? undefined : optionalText(data.clientPhone || data.client_phone) || null,
    occurred_at: data.occurredAt === undefined && data.occurred_at === undefined ? undefined : cleanText(data.occurredAt || data.occurred_at),
  });
  await recordAudit(db, salonId, {
    action: 'income_updated', entityType: 'income', entityId: row.id,
    description: 'Income updated in Core D1', before, after: row, source: 'dashboard',
  }, actor);
  return row;
}

export async function deleteIncome(db, salonId, id, actor = {}) {
  const before = await getIncome(db, salonId, id);
  await dbRun(db, 'DELETE FROM income_entries WHERE salon_id = ? AND id = ?', [salonId, requiredId(id)]);
  await recordAudit(db, salonId, {
    action: 'income_deleted', entityType: 'income', entityId: id,
    description: 'Income deleted from Core D1', before, after: null, source: 'dashboard',
  }, actor);
  return { id, deleted: true };
}

export async function listExpenses(db, salonId) {
  return dbAll(
    db,
    "SELECT * FROM expense_entries WHERE salon_id = ? AND LOWER(COALESCE(source_kind, '')) <> 'refund' AND LOWER(COALESCE(source_type, '')) <> 'refund' ORDER BY occurred_at DESC LIMIT 500",
    [salonId]
  );
}

export async function getExpense(db, salonId, id) {
  const row = await dbFirst(db, 'SELECT * FROM expense_entries WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, requiredId(id)]);
  if (!row) rowNotFound('expense');
  return row;
}

export async function createExpense(db, salonId, data, actorUid = '', actor = {}) {
  rejectRefundExpense(data);
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId('expense')),
    salon_id: salonId,
    amount_halalas: integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 }),
    category: optionalText(data.category) || null,
    description: optionalText(data.description) || null,
    payment_method: cleanText(data.paymentMethod || data.payment_method || 'cash'),
    occurred_at: optionalText(data.occurredAt || data.occurred_at) || now,
    created_by_uid: actorUid || null,
    created_at: optionalText(data.createdAt || data.created_at) || now,
    updated_at: now,
    title: optionalText(data.title) || null,
    note: optionalText(data.note) || null,
    added_by: optionalText(data.addedBy || data.added_by || actor.name || actor.email || actor.uid) || null,
    source_kind: optionalText(data.sourceKind || data.source_kind) || null,
    source_ref_id: optionalText(data.sourceRefId || data.source_ref_id) || null,
    source_type: optionalText(data.sourceType || data.source_type) || null,
    staff_id: optionalText(data.staffId || data.staff_id) || null,
    staff_name: optionalText(data.staffName || data.staff_name) || null,
    month_key: optionalText(data.monthKey || data.month_key) || null,
    payroll_kind: optionalText(data.payrollKind || data.payroll_kind) || null,
  };
  await dbRun(
    db,
    `INSERT INTO expense_entries
      (id, salon_id, amount_halalas, category, description, payment_method, occurred_at,
       created_by_uid, created_at, updated_at, title, note, added_by, source_kind,
       source_ref_id, source_type, staff_id, staff_name, month_key, payroll_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.salon_id, row.amount_halalas, row.category, row.description,
      row.payment_method, row.occurred_at, row.created_by_uid, row.created_at,
      row.updated_at, row.title, row.note, row.added_by, row.source_kind,
      row.source_ref_id, row.source_type, row.staff_id, row.staff_name,
      row.month_key, row.payroll_kind,
    ]
  );
  await recordAudit(db, salonId, {
    action: 'expense_created', entityType: 'expense', entityId: row.id,
    description: 'Expense created in Core D1', after: row, source: 'dashboard',
  }, actor);
  return row;
}

export async function patchExpense(db, salonId, id, data, actor = {}) {
  rejectRefundExpense(data);
  const before = await getExpense(db, salonId, id);
  const row = await updateById(db, 'expense_entries', salonId, requiredId(id), {
    amount_halalas: data.amountHalalas === undefined && data.amount_halalas === undefined
      ? undefined
      : integer(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { min: 1, max: 100_000_000 }),
    category: data.category === undefined ? undefined : (optionalText(data.category) || null),
    description: data.description === undefined ? undefined : (optionalText(data.description) || null),
    payment_method: data.paymentMethod === undefined && data.payment_method === undefined
      ? undefined
      : cleanText(data.paymentMethod || data.payment_method || 'cash'),
    occurred_at: data.occurredAt === undefined && data.occurred_at === undefined
      ? undefined
      : cleanText(data.occurredAt || data.occurred_at),
    title: data.title === undefined ? undefined : optionalText(data.title) || null,
    note: data.note === undefined ? undefined : optionalText(data.note) || null,
    added_by: data.addedBy === undefined && data.added_by === undefined ? undefined : optionalText(data.addedBy || data.added_by) || null,
    source_kind: data.sourceKind === undefined && data.source_kind === undefined ? undefined : optionalText(data.sourceKind || data.source_kind) || null,
    source_ref_id: data.sourceRefId === undefined && data.source_ref_id === undefined ? undefined : optionalText(data.sourceRefId || data.source_ref_id) || null,
    source_type: data.sourceType === undefined && data.source_type === undefined ? undefined : optionalText(data.sourceType || data.source_type) || null,
    staff_id: data.staffId === undefined && data.staff_id === undefined ? undefined : optionalText(data.staffId || data.staff_id) || null,
    staff_name: data.staffName === undefined && data.staff_name === undefined ? undefined : optionalText(data.staffName || data.staff_name) || null,
    month_key: data.monthKey === undefined && data.month_key === undefined ? undefined : optionalText(data.monthKey || data.month_key) || null,
    payroll_kind: data.payrollKind === undefined && data.payroll_kind === undefined ? undefined : optionalText(data.payrollKind || data.payroll_kind) || null,
  });
  await recordAudit(db, salonId, {
    action: 'expense_updated', entityType: 'expense', entityId: row.id,
    description: 'Expense updated in Core D1', before, after: row, source: 'dashboard',
  }, actor);
  return row;
}

export async function deleteExpense(db, salonId, id, actor = {}) {
  const before = await getExpense(db, salonId, id);
  await dbRun(db, 'DELETE FROM expense_entries WHERE salon_id = ? AND id = ?', [salonId, requiredId(id)]);
  await recordAudit(db, salonId, {
    action: 'expense_deleted', entityType: 'expense', entityId: id,
    description: 'Expense deleted from Core D1', before, after: null, source: 'dashboard',
  }, actor);
  return { id, deleted: true };
}
