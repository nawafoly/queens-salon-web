// CORE D1 ONLY — day audit closings are immutable financial snapshots.

import {
  changes,
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
import { getAppliedCorrectionDayTotals } from './payment-correction-read-model.js';

export const DAY_AUDIT_SOURCE_VERSION = 'day-audit-v3-riyadh-accounting-day';

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

function signedHalalas(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || Math.abs(number) > 100_000_000) {
    throw new AppError(400, `core_day_audit:${field}_invalid`);
  }
  return number;
}

function validLegacyClosedAt(value) {
  const raw = cleanText(value);
  const parsed = Date.parse(raw);
  if (!raw || !Number.isFinite(parsed) || parsed > Date.now() + 300_000) {
    throw new AppError(400, 'core_day_audit:legacy_closed_at_invalid');
  }
  return new Date(parsed).toISOString();
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

const DAY_AUDIT_PAGE_SIZE = 250;

// Financial reconciliation must never inherit dashboard list limits.
// Keyset pagination bounds each D1 response, not the accounting total.
async function readDayAuditRows(db, salonId, date, kind) {
  const income = kind === 'income';
  const table = income ? 'income_entries' : 'refunds';
  const alias = income ? 'i' : 'r';
  const timestamp = income ? 'occurred_at' : 'refunded_at';

  const accountingDateSql = income
    ? "date(i.occurred_at, '+3 hours')"
    : "date(COALESCE(NULLIF(TRIM(r.refunded_at), ''), r.created_at), '+3 hours')";

  const projection = income
    ? 'i.*, b.booking_date AS booking_date'
    : 'r.*';

  // Preserve the booking date metadata previously provided by
  // finance.listIncome, including legacy booking-linked income.
  const bookingJoin = income
    ? `LEFT JOIN bookings b
         ON b.salon_id = i.salon_id
        AND b.id = CASE
          WHEN COALESCE(TRIM(i.booking_id), '') <> ''
            THEN i.booking_id
          WHEN LOWER(COALESCE(TRIM(i.source), ''))
            IN ('booking', 'invoice', 'حجز', 'فاتورة')
            THEN i.id
          ELSE NULL
        END`
    : '';

  const results = [];
  let cursor = null;

  while (true) {
    const params = [salonId, date];

    const cursorClause = cursor
      ? `AND (
           ${alias}.${timestamp} < ?
           OR (
             ${alias}.${timestamp} = ?
             AND ${alias}.id < ?
           )
         )`
      : '';

    if (cursor) {
      params.push(
        cursor.timestamp,
        cursor.timestamp,
        cursor.id
      );
    }

    const page = await dbAll(
      db,
      `SELECT ${projection}
         FROM ${table} ${alias}
         ${bookingJoin}
        WHERE ${alias}.salon_id = ?
          AND ${accountingDateSql} = ?
          ${cursorClause}
        ORDER BY
          ${alias}.${timestamp} DESC,
          ${alias}.id DESC
        LIMIT ${DAY_AUDIT_PAGE_SIZE}`,
      params
    );

    if (!page.length) break;

    results.push(...page);

    if (page.length < DAY_AUDIT_PAGE_SIZE) break;

    const last = page[page.length - 1];

    if (!last?.id || !last?.[timestamp]) {
      throw new AppError(
        409,
        'core_day_audit:invalid_pagination_cursor'
      );
    }

    cursor = {
      timestamp: last[timestamp],
      id: last.id,
    };
  }

  return results;
}
export async function computeDayAuditSnapshot(db, salonId, rawDate) {
  const date = requireAuditDate(rawDate);
  const [incomeRows, refundRows, correction] = await Promise.all([
    readDayAuditRows(db, salonId, date, 'income'),
    readDayAuditRows(db, salonId, date, 'refund'),
    getAppliedCorrectionDayTotals(db, salonId, date),
  ]);

  // Keep every distinct financial row. A single booking may legitimately have
  // several cash/card/transfer payments, and each must contribute to the audit.
  // listIncome already removes SQL-union duplicates by row ID. Refund rows are
  // added only when the same refund ID was not already materialized as income.
  const mergedById = new Map();
  for (const raw of incomeRows || []) {
    const row = normalizeIncomeRow(raw);
    if (!row.id || isVoidedStatus(row.status)) continue;

    // A booking date is not a payment accounting date.
    // listIncome may include rows because their booking belongs to
    // the requested day. Do not post them into that day's cash audit
    // unless the income itself occurred on the requested date.
    // Accounting date has already been validated in the SQL query.

    mergedById.set(row.id, row);
  }
  for (const raw of refundRows || []) {
    if (isVoidedStatus(raw?.status) || sourceText(raw?.status) !== 'completed') continue;
    const row = normalizeRefundRow(raw);
    if (!row.id || mergedById.has(row.id)) continue;
    mergedById.set(row.id, row);
  }

  let cashHalalas = 0;
  let cardHalalas = 0;
  let transferHalalas = 0;
  let unclassifiedHalalas = 0;
  let rowCount = 0;
  const unclassifiedRows = [];

  for (const row of mergedById.values()) {
    const amountHalalas = Number(row.amount_halalas || 0);
    if (!Number.isSafeInteger(amountHalalas) || amountHalalas === 0) continue;
    if (!isBookingSource(row.source) && !isRefundLike(row, amountHalalas) && !cleanText(row.booking_id)) continue;

    rowCount += 1;
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

  const originalTotalHalalas =
    cashHalalas + cardHalalas + transferHalalas + unclassifiedHalalas;

  cashHalalas += correction.cashDeltaHalalas;
  cardHalalas += correction.cardDeltaHalalas;
  transferHalalas += correction.transferDeltaHalalas;

  const totalHalalas =
    cashHalalas + cardHalalas + transferHalalas + unclassifiedHalalas;

  if (
    ![
      originalTotalHalalas,
      cashHalalas,
      cardHalalas,
      transferHalalas,
      unclassifiedHalalas,
      totalHalalas,
    ].every(Number.isSafeInteger) ||
    totalHalalas !== originalTotalHalalas + correction.totalDeltaHalalas
  ) {
    throw new AppError(
      409,
      'core_day_audit:correction_projection_conflict'
    );
  }
  return {
    date,
    totalHalalas,
    cashHalalas,
    cardHalalas,
    transferHalalas,
    unclassifiedHalalas,
    unclassifiedRows,
    rowCount,
    correctionEventCount: correction.eventCount,
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
    origin: cleanText(row.origin) || 'core',
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

async function getFinancialDayRevision(db, salonId, date) {
  const row = await dbFirst(
    db,
    `SELECT revision
       FROM financial_day_revisions
      WHERE salon_id = ?
        AND audit_date = ?
      LIMIT 1`,
    [salonId, date]
  );

  const revision = Number(row?.revision ?? 0);

  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new AppError(
      409,
      'core_day_audit:invalid_financial_revision'
    );
  }

  return revision;
}

async function insertClosingRow(
  db,
  row,
  expectedCorrectionEventCount = null,
  expectedFinancialRevision = null
) {
  const result = await dbRun(
    db,
    `INSERT INTO day_audit_closings
      (id, salon_id, audit_date, total_halalas, cash_halalas, card_halalas,
       transfer_halalas, unclassified_halalas, manual_cash_halalas, cash_diff_halalas,
       closed_at, closed_by_uid, closed_by_name, origin, source_snapshot_json, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (
       ? IS NULL
       OR (
         SELECT COUNT(*)
         FROM payment_correction_applied_events e
         WHERE e.salon_id = ?
           AND e.accounting_date = ?
       ) = ?
     )
      AND (
        ? IS NULL
        OR COALESCE((
          SELECT revision
          FROM financial_day_revisions r
          WHERE r.salon_id = ?
            AND r.audit_date = ?
        ), 0) = ?
      )`,
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
      row.origin,
      row.source_snapshot_json,
      row.created_at,
      expectedCorrectionEventCount,
      row.salon_id,
      row.audit_date,
      expectedCorrectionEventCount,
      expectedFinancialRevision,
      row.salon_id,
      row.audit_date,
      expectedFinancialRevision,
    ]
  );

  return changes(result);
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

  const financialRevision = await getFinancialDayRevision(
    db,
    salonId,
    date
  );

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
    origin: 'core',
    source_snapshot_json: JSON.stringify({
      sourceVersion: snapshot.sourceVersion,
      rowCount: snapshot.rowCount,
      financialRevision,
      capturedAt: now,
    }),
    created_at: now,
  };

  try {
    const inserted = await insertClosingRow(
      db,
      row,
      snapshot.correctionEventCount,
      financialRevision
    );

    if (inserted !== 1) {
      throw new AppError(
        409,
        'core_day_audit:stale_snapshot'
      );
    }
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

export async function importLegacyDayAuditClosings(db, salonId, data = {}, actor = {}) {
  const rows = Array.isArray(data.closings) ? data.closings : [];
  if (!rows.length || rows.length > 100) {
    throw new AppError(400, 'core_day_audit:legacy_import_invalid');
  }

  const imported = [];
  const skipped = [];
  for (const item of rows) {
    const date = requireAuditDate(item?.date || item?.auditDate || item?.audit_date);
    const existing = await getDayAuditClosing(db, salonId, date);
    if (existing) {
      skipped.push({ date, reason: 'already_exists' });
      continue;
    }

    const totalHalalas = signedHalalas(item?.totalHalalas, 'legacy_total');
    const cashHalalas = signedHalalas(item?.cashHalalas, 'legacy_cash');
    const cardHalalas = signedHalalas(item?.cardHalalas, 'legacy_card');
    const transferHalalas = signedHalalas(item?.transferHalalas, 'legacy_transfer');
    const manualCashHalalas = integer(item?.manualCashHalalas, 'manualCashHalalas', {
      min: 0,
      max: 100_000_000,
    });
    const cashDiffHalalas = signedHalalas(item?.cashDiffHalalas, 'legacy_cash_diff');
    if (cashDiffHalalas !== manualCashHalalas - cashHalalas) {
      throw new AppError(400, 'core_day_audit:legacy_cash_diff_mismatch', 'Legacy cash difference does not match', { date });
    }

    const now = nowIso();
    const closedAt = validLegacyClosedAt(item?.closedAt);
    const row = {
      id: generatedId('day_audit_legacy'),
      salon_id: salonId,
      audit_date: date,
      total_halalas: totalHalalas,
      cash_halalas: cashHalalas,
      card_halalas: cardHalalas,
      transfer_halalas: transferHalalas,
      unclassified_halalas: 0,
      manual_cash_halalas: manualCashHalalas,
      cash_diff_halalas: cashDiffHalalas,
      closed_at: closedAt,
      closed_by_uid: cleanText(actor.uid) || null,
      closed_by_name: actorName(actor),
      origin: 'legacy_local_import',
      source_snapshot_json: JSON.stringify({
        sourceVersion: 'legacy-localStorage-v1',
        importedAt: now,
        importedByUid: cleanText(actor.uid) || null,
      }),
      created_at: now,
    };

    try {
      await insertClosingRow(db, row);
    } catch (error) {
      if (/UNIQUE|constraint/i.test(cleanText(error?.message))) {
        skipped.push({ date, reason: 'already_exists' });
        continue;
      }
      throw error;
    }

    const created = mapClosing(row);
    imported.push(created);
    await recordAudit(
      db,
      salonId,
      {
        action: 'day_audit_legacy_imported',
        entityType: 'day_audit_closing',
        entityId: row.id,
        description: 'Legacy local day-audit closing imported into Core D1',
        after: created,
        source: 'dashboard',
      },
      actor
    );
  }

  return { imported, skipped };
}
