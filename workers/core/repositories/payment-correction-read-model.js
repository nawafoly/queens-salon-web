// CORE D1 ONLY.
// Read-only projection of applied payment correction postings.
// No mutation of original payments, income or invoices.

import { dbAll, requiredId } from '../d1.js';
import { AppError } from '../errors.js';

function validAccountingDate(value) {
  const date = String(value ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'core_payment_correction:invalid_date');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new AppError(400, 'core_payment_correction:invalid_date');
  }

  return date;
}

function safeMoney(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function integrityConflict() {
  return new AppError(
    409,
    'core_payment_correction:unbalanced_ledger'
  );
}

export async function getAppliedCorrectionDayTotals(
  db,
  salonId,
  accountingDate
) {
  const salon = requiredId(salonId, 'salonId');
  const date = validAccountingDate(accountingDate);

  const rows = await dbAll(
    db,
    `SELECT
       e.id AS event_id,
       e.amount_delta_halalas AS expected_delta_halalas,
       v.integrity_status,
       COUNT(p.id) AS posting_count,
       COALESCE(SUM(
         CASE WHEN p.channel = 'cash'
           THEN p.signed_amount_halalas ELSE 0 END
       ), 0) AS cash_delta_halalas,
       COALESCE(SUM(
         CASE WHEN p.channel = 'card'
           THEN p.signed_amount_halalas ELSE 0 END
       ), 0) AS card_delta_halalas,
       COALESCE(SUM(
         CASE WHEN p.channel = 'transfer'
           THEN p.signed_amount_halalas ELSE 0 END
       ), 0) AS transfer_delta_halalas
     FROM payment_correction_applied_events e
     LEFT JOIN payment_correction_applied_integrity v
       ON v.salon_id = e.salon_id
      AND v.event_id = e.id
     LEFT JOIN payment_correction_applied_postings p
       ON p.salon_id = e.salon_id
      AND p.event_id = e.id
     WHERE e.salon_id = ?
       AND e.accounting_date = ?
     GROUP BY
       e.salon_id,
       e.id,
       e.amount_delta_halalas,
       v.integrity_status
     ORDER BY e.id`,
    [salon, date]
  );

  const result = {
    date,
    cashDeltaHalalas: 0,
    cardDeltaHalalas: 0,
    transferDeltaHalalas: 0,
    totalDeltaHalalas: 0,
    eventCount: 0,
    postingCount: 0,
  };

  for (const row of rows) {
    const cash = safeMoney(row.cash_delta_halalas);
    const card = safeMoney(row.card_delta_halalas);
    const transfer = safeMoney(row.transfer_delta_halalas);
    const expected = safeMoney(row.expected_delta_halalas);
    const count = safeMoney(row.posting_count);

    if (
      row.integrity_status !== 'balanced' ||
      cash === null ||
      card === null ||
      transfer === null ||
      expected === null ||
      count === null ||
      count < 1 ||
      cash + card + transfer !== expected
    ) {
      throw integrityConflict();
    }

    result.cashDeltaHalalas += cash;
    result.cardDeltaHalalas += card;
    result.transferDeltaHalalas += transfer;
    result.totalDeltaHalalas += expected;
    result.eventCount += 1;
    result.postingCount += count;
  }

  if (
    ![
      result.cashDeltaHalalas,
      result.cardDeltaHalalas,
      result.transferDeltaHalalas,
      result.totalDeltaHalalas,
    ].every(Number.isSafeInteger) ||
    result.cashDeltaHalalas +
      result.cardDeltaHalalas +
      result.transferDeltaHalalas !==
      result.totalDeltaHalalas
  ) {
    throw integrityConflict();
  }

  return result;
}