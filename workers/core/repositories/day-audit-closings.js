// CORE D1 ONLY — day audit closings are immutable financial snapshots.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
} from '../d1.js';
import { AppError } from '../errors.js';
import { recordAudit } from './audit.js';
import { listIncome } from './finance.js';
import { listRefunds } from './refunds.js';

export const DAY_AUDIT_SOURCE_VERSION = 'day-audit-v1';

function salonTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function requireAuditDate(value) {
  const date = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'core_day_audit:invalid_date');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, 'core_day_audit:invalid_date');
  }
  if (date > salonTodayISO()) {
    throw new AppError(400, 'core_day_audit:future_date_not_allowed');
  }
  return date;
}

export function normalizeDayAuditPaymentMethod(rawMethod, rawNote) {
  const method = cleanText(rawMethod).toLowerCase();

  if (method === 'cash' || method === 'نقد' || method === 'كاش') return 'cash';

  if (
    method === 'card' ||
    method === 'pos_card' ||
    method === 'mada_online' ||
    method === 'network' ||
    method === 'mada' ||
    method === 'visa' ||
    method === 'mastercard' ||
    method === 'master_card' ||
    method === 'credit_card' ||
    method === 'debit_card' ||
    method === 'apple_pay' ||
    method === 'applepay' ||
    method === 'tap' ||
    method === 'شبكة' ||
    method === 'مدى'
  ) {
    return 'card';
  }
  if (/(card|network|mada|visa|master|pos|apple|credit|debit)/.test(method)) return 'card';

  if (
    method === 'transfer' ||
    method === 'bank_transfer' ||
    method === 'تحويل' ||
    method === 'بنكي'
  ) {
    return 'transfer';
  }

  const note = cleanText(rawNote).toLowerCase();
  if (note.includes('payment_method:cash') || note.includes('invoice_from_reception:cash')) return 'cash';
  if (note.includes('payment_method:card') || note.includes('invoice_from_reception:card')) return 'card';
  if (note.includes('payment_method:transfer') || note.includes('invoice_from_reception:transfer')) return 'transfer';
  if (/(network|mada|visa|mastercard|master|credit|debit|pos|apple ?pay|card|شبكة|مدى|بطاقة)/.test(note)) return 'card';
  if (/(cash|نقد|كاش)/.test(note)) return 'cash';
  if (/(transfer|bank|تحويل|بنكي)/.test(note)) return 'transfer';

  return 'unclassified';
}

function sourceText(value) {
  return cleanText(value).toLowerCase();
}

function isBookingSource(value) {
  const source = sourceText(value);
  return source === 'booking' || source === 'invoice' || source === 'حجز' || source === 'فاتورة';
}

function isRefundLike(row, amountHalalas) {
  const source = sourceText(row?.source);
  return (
    source === 'refund' ||
    source === 'استرجاع' ||
    cleanText(row?.id).startsWith('refund_') ||
    amountHalalas < 0
  );
}

function rowIdentity(row, amountHalalas) {
  const bookingId = cleanText(row?.booking_id || row?.bookingId);
  if (bookingId) return `${isRefundLike(row, amountHalalas) ? 'refund' : 'booking'}:${bookingId}`;
  return `doc:${cleanText(row?.id) || 'unknown'}`;
}

function rowSortMs(row) {
  const candidates = [row?.updated_at, row?.updatedAt, row?.refunded_at, row?.refundedAt, row?.occurred_at, row?.occurredAt, row?.created_at, row?.createdAt];
  let best = 0;
  for (const value of candidates) {
    const parsed = Date.parse(cleanText(value));
    if (Number.isFinite(parsed)) best = Math.max(best, parsed);
  }
  return best;
}

function isVoidedStatus(value) {
  const status = cleanText(value).toLowerCase();
  return status === 'voided' || status === 'void' || status === 'cancelled' || status === 'canceled';
}

function normalizeIncomeRow(row) {
  return {
    ...row,
    id: cleanText(row?.id),
    booking_id: cleanText(row?.booking_id) || null,
    booking_date: cleanText(row?.booking_date) || null,
    amount_halalas: Number(row?.amount_halalas || 0),
    method: cleanText(row?.method),
    source: cleanText(row?.source),
    note: cleanText(row?.note),
    occurred_at: cleanText(row?.occurred_at),
    created_at: cleanText(row?.created_at),
  };
}

function normalizeRefundRow(row) {
  return {
    id: cleanText(row?.id),
    booking_id: cleanText(row?.booking_id) || null,
    booking_date: null,
    amount_halalas: -Math.abs(Number(row?.amount_halalas || 0)),
    method: cleanText(row?.method),
    source: 'refund',
    note: cleanText(row?.reason),
    status: cleanText(row?.status),
    occurred_at: cleanText(row?.refunded_at || row?.created_at),
    created_at: cleanText(row?.created_at),
  };
}

export async function computeDayAuditSnapshot(db, salonId, rawDate) {
  const date = requireAuditDate(rawDate);
  const [incomeRows, refundRows] = await Promise.all([
    listIncome(db, salonId, { date }),
    listRefunds(db, salonId, { date }),
  ]);

  const mergedById = new Map();
  for (const raw of incomeRows || []) {
    const row = normalizeIncomeRow(raw);
    if (!row.id || isVoidedStatus(row.status)) continue;
    mergedById.set(row.id, row);
  }
  for (const raw of refundRows || []) {
    if (isVoidedStatus(raw?.status) || sourceText(raw?.status) !== 'completed') continue;
    const row = normalizeRefundRow(raw);
    if (!row.id || mergedById.has(row.id)) continue;
    mergedById.set(row.id, row);
  }

  const dedupRows = new Map();
  for (const row of mergedById.values()) {
    const amountHalalas = Number(row.amount_halalas || 0);
    if (!Number.isSafeInteger(amountHalalas) || amountHalalas === 0) continue;
    if (!isBookingSource(row.source) && !isRefundLike(row, amountHalalas) && !cleanText(row.booking_id)) continue;
    const identity = rowIdentity(row, amountHalalas);
    const sortMs = rowSortMs(row);
    const previous = dedupRows.get(identity);
    if (!previous || sortMs >= previous.sortMs) {
      dedupRows.set(identity, { row, amountHalalas, sortMs });
    }
  }

  let cashHalalas = 0;
  let cardHalalas = 0;
  let transferHalalas = 0;
  let unclassifiedHalalas = 0;
  const unclassifiedRows = [];

  for (const { row, amountHalalas } of dedupRows.values()) {
    const channel = normalizeDayAuditPaymentMethod(row.method, row.note);
    if (channel === 'cash') cashHalalas += amountHalalas;
    else if (channel === 'card') cardHalalas += amountHalalas;
    else if (channel === 'transfer') transferHalalas += amountHalalas;
    else {
      unclassifiedHalalas += amountHalalas;
      unclassifiedRows.push({
        id: row.id,
        bookingId: cleanText(row.booking_id) || null,
        bookingDate: cleanText(row.booking_date) || null,
        amountHalalas,
        method: cleanText(row.method) || null,
        source: cleanText(row.source) || null,
        note: cleanText(row.note) || null,
        occurredAt: cleanText(row.occurred_at) || null,
      });
    }
  }

  const totalHalalas = cashHalalas + cardHalalas + transferHalalas + unclassifiedHalalas;
  return {
    date,
    totalHalalas,
    cashHalalas,
    cardHalalas,
    transferHalalas,
    unclassifiedHalalas,
    unclassifiedRows,
    rowCount: dedupRows.size,
    sourceVersion: DAY_AUDIT_SOURCE_VERSION,
  };
}

function mapClosing(row) {
  if (!row) return null;
  let sourceSnapshot = {};
  try {
    sourceSnapshot = JSON.parse(cleanText(row.source_snapshot_json) || '{}');
  } catch {
    sourceSnapshot = {};
  }
  return {
    id: cleanText(row.id),
    auditDate: cleanText(row.audit_date),
    totalHalalas: Number(row.total_halalas || 0),
    cashHalalas: Number(row.cash_halalas || 0),
    cardHalalas: Number(row.card_halalas || 0),
    transferHalalas: Number(row.transfer_halalas || 0),
    unclassifiedHalalas: Number(row.unclassified_halalas || 0),
    manualCashHalalas: Number(row.manual_cash_halalas || 0),
    cashDiffHalalas: Number(row.cash_diff_halalas || 0),
    closedAt: cleanText(row.closed_at),
    closedByUid: cleanText(row.closed_by_uid) || null,
    closedByName: cleanText(row.closed_by_name) || null,
    sourceSnapshot,
    createdAt: cleanText(row.created_at),
  };
}

export async function getDayAuditClosing(db, salonId, rawDate) {
  const date = requireAuditDate(rawDate);
  const row = await dbFirst(
    db,
    'SELECT * FROM day_audit_closings WHERE salon_id = ? AND audit_date = ? LIMIT 1',
    [salonId, date]
  );
  return mapClosing(row);
}

export async function listDayAuditClosings(db, salonId, query = {}) {
  const rawLimit = Number(query.limit || 30);
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 30;
  const rawOffset = Number(query.offset || 0);
  const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  const rows = await dbAll(
    db,
    `SELECT * FROM day_audit_closings
      WHERE salon_id = ?
      ORDER BY audit_date DESC, closed_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [salonId, limit, offset]
  );
  return rows.map(mapClosing);
}

function actorName(actor = {}) {
  return cleanText(
    actor.displayName || actor.display_name || actor.name || actor.email || actor.uid
  ) || null;
}

export async function closeDayAudit(db, salonId, data = {}, actor = {}) {
  const date = requireAuditDate(data.date || data.auditDate || data.audit_date);
  const manualCashHalalas = integer(
    data.manualCashHalalas ?? data.manual_cash_halalas,
    'manualCashHalalas',
    { min: 0, max: 100_000_000 }
  );

  const existing = await getDayAuditClosing(db, salonId, date);
  if (existing) {
    if (existing.manualCashHalalas === manualCashHalalas) return { ...existing, idempotent: true };
    throw new AppError(409, 'core_day_audit:already_closed', 'The selected day is already closed');
  }

  const snapshot = await computeDayAuditSnapshot(db, salonId, date);
  if (snapshot.unclassifiedHalalas !== 0 || snapshot.unclassifiedRows.length > 0) {
    throw new AppError(
      422,
      'core_day_audit:unclassified_payments',
      'Unclassified payments must be resolved before closing the day',
      {
        unclassifiedHalalas: snapshot.unclassifiedHalalas,
        rows: snapshot.unclassifiedRows,
      }
    );
  }

  const now = nowIso();
  const row = {
    id: generatedId('day_audit'),
    salon_id: salonId,
    audit_date: date,
    total_halalas: snapshot.totalHalalas,
    cash_halalas: snapshot.cashHalalas,
    card_halalas: snapshot.cardHalalas,
    transfer_halalas: snapshot.transferHalalas,
    unclassified_halalas: 0,
    manual_cash_halalas: manualCashHalalas,
    cash_diff_halalas: manualCashHalalas - snapshot.cashHalalas,
    closed_at: now,
    closed_by_uid: cleanText(actor.uid) || null,
    closed_by_name: actorName(actor),
    source_snapshot_json: JSON.stringify({
      sourceVersion: snapshot.sourceVersion,
      rowCount: snapshot.rowCount,
      capturedAt: now,
    }),
    created_at: now,
  };

  try {
    await dbRun(
      db,
      `INSERT INTO day_audit_closings
        (id, salon_id, audit_date, total_halalas, cash_halalas, card_halalas,
         transfer_halalas, unclassified_halalas, manual_cash_halalas, cash_diff_halalas,
         closed_at, closed_by_uid, closed_by_name, source_snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.salon_id,
        row.audit_date,
        row.total_halalas,
        row.cash_halalas,
        row.card_halalas,
        row.transfer_halalas,
        row.unclassified_halalas,
        row.manual_cash_halalas,
        row.cash_diff_halalas,
        row.closed_at,
        row.closed_by_uid,
        row.closed_by_name,
        row.source_snapshot_json,
        row.created_at,
      ]
    );
  } catch (error) {
    if (/UNIQUE|constraint/i.test(cleanText(error?.message))) {
      const raced = await getDayAuditClosing(db, salonId, date);
      if (raced && raced.manualCashHalalas === manualCashHalalas) return { ...raced, idempotent: true };
      if (raced) throw new AppError(409, 'core_day_audit:already_closed');
    }
    throw error;
  }

  const created = mapClosing(row);
  await recordAudit(
    db,
    salonId,
    {
      action: 'day_audit_closed',
      entityType: 'day_audit_closing',
      entityId: row.id,
      description: 'Daily financial audit closed in Core D1',
      after: created,
      source: 'dashboard',
    },
    actor
  );
  return created;
}
