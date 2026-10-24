// CORE D1 ONLY — read-only accounting impact estimate for a proposed correction.
// NEVER authorize posting from this preview. The future APPLY path must re-check
// every invariant atomically at its D1 write boundary, including day closures.
import { cleanText, dbAll, dbFirst, requiredId } from '../d1.js';
import { AppError } from '../errors.js';

const SETTLED = new Set(['paid', 'completed', 'succeeded']);
const CHANNELS = new Set(['cash', 'card', 'transfer']);

function money(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : NaN;
}

function day(value) {
  const date = cleanText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function addBlocker(blockers, code) {
  if (!blockers.includes(code)) blockers.push(code);
}

function channelDeltas(originalMethod, proposedMethod, oldAmount, newAmount) {
  const channels = { cash: 0, card: 0, transfer: 0 };
  if (CHANNELS.has(originalMethod)) channels[originalMethod] -= oldAmount;
  if (CHANNELS.has(proposedMethod)) channels[proposedMethod] += newAmount;
  return channels;
}

/**
 * Advisory, tenant-scoped preflight. Does not change money, audit, or ledger.
 * The independent reads are NOT an atomic snapshot: no caller may treat
 * `eligible` as permission to apply a correction without an atomic CAS.
 */
export async function previewPaymentCorrectionImpact(db, salonId, proposalId) {
  const id = requiredId(proposalId, 'proposalId');
  const proposal = await dbFirst(db,
    'SELECT * FROM payment_correction_proposals WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]);
  if (!proposal) throw new AppError(404, 'core_payment_correction:not_found');

  const [payment, invoice, booking, incomes, refunds] = await Promise.all([
    dbFirst(db, 'SELECT * FROM payments WHERE salon_id = ? AND id = ? LIMIT 1',
      [salonId, proposal.payment_id]),
    dbFirst(db, 'SELECT * FROM invoices WHERE salon_id = ? AND id = ? LIMIT 1',
      [salonId, proposal.invoice_id]),
    dbFirst(db, 'SELECT * FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1',
      [salonId, proposal.booking_id]),
    dbAll(db, 'SELECT * FROM income_entries WHERE salon_id = ? AND payment_id = ? ORDER BY created_at, id',
      [salonId, proposal.payment_id]),
    dbAll(db, 'SELECT amount_halalas, status, method FROM refunds WHERE salon_id = ? AND payment_id = ?',
      [salonId, proposal.payment_id]),
  ]);

  const blockers = [];
  if (
    !payment || !invoice || !booking ||
    cleanText(payment?.invoice_id) !== cleanText(proposal.invoice_id) ||
    cleanText(payment?.booking_id) !== cleanText(proposal.booking_id) ||
    cleanText(invoice?.booking_id) !== cleanText(proposal.booking_id)
  ) addBlocker(blockers, 'missing_or_mismatched_financial_links');
  if (payment && !SETTLED.has(cleanText(payment.status).toLowerCase())) {
    addBlocker(blockers, 'payment_not_settled');
  }

  const originalAmount = money(proposal.original_amount_halalas);
  const proposedAmount = money(proposal.proposed_amount_halalas);
  const originalMethod = cleanText(proposal.original_method).toLowerCase();
  const proposedMethod = cleanText(proposal.proposed_method).toLowerCase();

  if (
    !Number.isSafeInteger(originalAmount) || !Number.isSafeInteger(proposedAmount) ||
    originalAmount <= 0 || proposedAmount <= 0
  ) addBlocker(blockers, 'invalid_money_snapshot');
  if (
    payment && (money(payment.amount_halalas) !== originalAmount ||
      cleanText(payment.method).toLowerCase() !== originalMethod)
  ) addBlocker(blockers, 'stale_payment_snapshot');
  if (!CHANNELS.has(originalMethod) || !CHANNELS.has(proposedMethod)) {
    // Do not classify legacy payment aliases using guessed rules.
    // Method normalization must be centrally versioned before APPLY.
    addBlocker(blockers, 'unsupported_payment_channel');
  }
  if (payment && (cleanText(payment.provider) || cleanText(payment.provider_reference))) {
    addBlocker(blockers, 'external_provider_requires_reconciliation');
  }

  if (incomes.length !== 1) {
    addBlocker(blockers, 'income_ledger_not_single_entry');
  } else if (
    money(incomes[0].amount_halalas) !== originalAmount ||
    cleanText(incomes[0].method).toLowerCase() !== originalMethod
  ) {
    addBlocker(blockers, 'income_ledger_mismatch');
  }

  const completedRefunds = refunds.filter(row => cleanText(row.status).toLowerCase() === 'completed');
  const refunded = completedRefunds.reduce((sum, row) => sum + money(row.amount_halalas), 0);
  if (!Number.isSafeInteger(refunded) || refunded < 0) addBlocker(blockers, 'invalid_refund_ledger');
  if (refunded !== money(proposal.completed_refund_halalas)) {
    addBlocker(blockers, 'refund_snapshot_changed');
  }
  if (proposedAmount < refunded) addBlocker(blockers, 'correction_below_completed_refunds');
  if (proposal.kind === 'method_reclassification' && completedRefunds.length > 0) {
    addBlocker(blockers, 'refund_method_allocation_needed');
  }
  if (proposal.kind === 'amount_correction' &&
      (proposedMethod !== originalMethod || proposedAmount === originalAmount)) {
    addBlocker(blockers, 'invalid_amount_correction_intent');
  }
  if (proposal.kind === 'method_reclassification' &&
      (proposedAmount !== originalAmount || proposedMethod === originalMethod)) {
    addBlocker(blockers, 'invalid_method_correction_intent');
  }

  const delta = proposedAmount - originalAmount;
  const invoicePaid = money(invoice?.paid_halalas);
  if (!Number.isSafeInteger(invoicePaid) || invoicePaid + delta < 0 ||
      !Number.isSafeInteger(invoicePaid + delta)) {
    addBlocker(blockers, 'invoice_balance_conflict');
  }

  const sourceDates = [...new Set(incomes.map(row => day(row.occurred_at)).filter(Boolean))];
  if (incomes.some(row => !day(row.occurred_at)) || sourceDates.length !== 1) {
    addBlocker(blockers, 'income_accounting_date_ambiguous');
  }
  let dayClosed = false;
  for (const date of sourceDates) {
    const closing = await dbFirst(db,
      'SELECT id FROM day_audit_closings WHERE salon_id = ? AND audit_date = ? LIMIT 1',
      [salonId, date]);
    if (closing) dayClosed = true;
  }
  if (dayClosed) addBlocker(blockers, 'accounting_day_already_closed');

  return {
    proposalId: proposal.id,
    paymentId: proposal.payment_id,
    invoiceId: proposal.invoice_id,
    bookingId: proposal.booking_id,
    kind: proposal.kind,
    status: cleanText(proposal.status),
    eligibleForFurtherReview: blockers.length === 0,
    blockers,
    accountingDates: sourceDates,
    original: { amountHalalas: originalAmount, method: originalMethod },
    proposed: { amountHalalas: proposedAmount, method: proposedMethod },
    completedRefundHalalas: refunded,
    invoiceBeforeHalalas: invoicePaid,
    projectedInvoiceAfterHalalas: invoicePaid + delta,
    amountDeltaHalalas: delta,
    paymentChannelDeltasHalalas: channelDeltas(
      originalMethod, proposedMethod, originalAmount, proposedAmount
    ),
    // There is intentionally no apply or approval token.
    isReadOnly: true,
    requiresAtomicWriteTimeRevalidation: true,
    requiresAccountingPostingPolicy: true,
  };
}
