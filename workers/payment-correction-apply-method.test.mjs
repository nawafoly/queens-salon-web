import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { createPayment } from './core/repositories/payments.js';
import { proposePaymentCorrection } from './core/repositories/payment-correction-proposals.js';
import { createRefund } from './core/repositories/refunds.js';
import { applyPaymentMethodCorrection } from './core/repositories/payment-correction-apply.js';

async function fixture(t) {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: 'correction-apply-isolated',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'stub.mjs',
          modulesRoot: process.cwd(),
          modules: {
            'stub.mjs': {
              type: 'esm',
              contents: 'export default {fetch(){return new Response("ok")}}'
            }
          }
        },
        env: {
          CORE_DB: { type: 'd1', id: 'correction-apply-isolated' }
        },
        exports: {}
      },
      dev: { rootPath: process.cwd() }
    }]
  });

  t.after(() => mf.dispose());

  const db = await mf.getD1Database('CORE_DB');

  for (const name of [
    '0001_core_schema.sql',
    '0003_booking_availability.sql',
    '0004_admin_operations.sql',
    '0006_booking_discount_snapshots.sql',
    '0007_booking_soft_delete.sql',
    '0061_booking_admin_notes.sql',
    '0014_app_users_permissions.sql',
    '0079_client_cashback_wallet.sql',
    '0081_cashback_expiry_lot_state.sql',
    '0083_internal_booking_price_adjustments.sql',
    '0094_day_audit_closings.sql',
    '0095_payment_correction_proposals.sql',
    '0096_payment_correction_applied_ledger.sql',
    '0097_financial_day_revisions.sql'
  ]) {
    const sql = (
      await readFile(
        new URL(`../migrations/core/${name}`, import.meta.url),
        'utf8'
      )
    )
      .split(/\r?\n/)
      .filter(line => !/^\s*--/.test(line))
      .join('\n')
      .trim();

    const parts = /^009[67]/.test(name)
      ? sql.split(
          /;\s*(?=CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX|VIEW|TRIGGER)\b|$)/i
        )
      : sql.split(';');

    for (const statement of parts.map(s => s.trim()).filter(Boolean)) {
      await db.prepare(
        statement.replace(/;\s*$/, '') + ';'
      ).run();
    }
  }

  const at = '2026-10-10T08:00:00.000Z';

  await db.prepare(
    `INSERT INTO clients
     (id,salon_id,name,status,created_at,updated_at)
     VALUES ('client-a','main','Client A','active',?,?)`
  ).bind(at, at).run();

  await db.prepare(
    `INSERT INTO bookings
     (id,salon_id,client_id,booking_date,start_time,end_time,
      status,source,subtotal_halalas,discount_halalas,total_halalas,
      payment_status,package_sessions_used,created_at,updated_at)
     VALUES
     ('booking-a','main','client-a','2026-10-10','09:00','10:00',
      'booked','internal',10000,0,10000,'unpaid',0,?,?)`
  ).bind(at, at).run();

  await db.prepare(
    `INSERT INTO invoices
     (id,salon_id,booking_id,client_id,subtotal_halalas,total_halalas,
      discount_halalas,paid_halalas,status,issued_at,created_at,updated_at)
     VALUES
     ('invoice-a','main','booking-a','client-a',10000,10000,
      0,0,'unpaid',?,?,?)`
  ).bind(at, at, at).run();

  await createPayment(db, 'main', {
    id: 'payment-a',
    invoiceId: 'invoice-a',
    amountHalalas: 7000,
    method: 'card'
  });

  const proposal = await proposePaymentCorrection(
    db,
    'main',
    {
      paymentId: 'payment-a',
      kind: 'method_reclassification',
      proposedMethod: 'cash',
      reason: 'The customer paid cash, not card',
      idempotencyKey: 'method-correction-1'
    },
    { uid: 'reception-a' }
  );

  return { db, proposal };
}

const approve = (db, id, uid = 'owner-a', salon = 'main') =>
  applyPaymentMethodCorrection(db, salon, id, { uid });

async function counts(db) {
  const names = [
    'payment_correction_applied_events',
    'payment_correction_applied_postings'
  ];

  return Promise.all(
    names.map(async name =>
      (await db.prepare(
        `SELECT COUNT(*) AS n FROM ${name}`
      ).first()).n
    )
  );
}

test('APPLY posts balanced adjustments and preserves original money', async t => {
  const { db, proposal } = await fixture(t);

  const applied = await approve(db, proposal.id);

  assert.equal(applied.approved_by_uid, 'owner-a');
  assert.equal(applied.amount_delta_halalas, 0);
  assert.deepEqual(await counts(db), [1, 2]);

  const integrity = await db.prepare(
    `SELECT integrity_status, posting_count
     FROM payment_correction_applied_integrity
     WHERE event_id = ?`
  ).bind(applied.id).first();

  assert.equal(integrity.integrity_status, 'balanced');
  assert.equal(integrity.posting_count, 2);

  const payment = await db.prepare(
    "SELECT amount_halalas,method FROM payments WHERE id='payment-a'"
  ).first();

  assert.equal(payment.amount_halalas, 7000);
  assert.equal(payment.method, 'card');

  const income = await db.prepare(
    "SELECT amount_halalas,method FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  assert.equal(income.amount_halalas, 7000);
  assert.equal(income.method, 'card');

  const invoice = await db.prepare(
    "SELECT paid_halalas FROM invoices WHERE id='invoice-a'"
  ).first();

  assert.equal(invoice.paid_halalas, 7000);

  const audit = await db.prepare(
    `SELECT COUNT(*) AS n FROM audit_logs
     WHERE action='payment_method_correction_applied'`
  ).first();

  assert.equal(audit.n, 1);
});

test('identical retries are idempotent and another actor cannot take over', async t => {
  const { db, proposal } = await fixture(t);

  const first = await approve(db, proposal.id);
  const replay = await approve(db, proposal.id);

  assert.equal(replay.id, first.id);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(await counts(db), [1, 2]);

  await assert.rejects(
    approve(db, proposal.id, 'other-approver'),
    error => error?.status === 403
  );
});

test('proposal author cannot approve own correction', async t => {
  const { db, proposal } = await fixture(t);

  await assert.rejects(
    approve(db, proposal.id, 'reception-a'),
    error => error?.status === 403
  );

  assert.deepEqual(await counts(db), [0, 0]);
});

test('tenant mismatch and stale payment snapshot are rejected', async t => {
  const { db, proposal } = await fixture(t);

  await assert.rejects(
    approve(db, proposal.id, 'owner-a', 'other-tenant'),
    error => error?.status === 404
  );

  await db.prepare(
    "UPDATE payments SET method='cash' WHERE id='payment-a'"
  ).run();

  await assert.rejects(
    approve(db, proposal.id),
    error => error?.status === 409
  );

  assert.deepEqual(await counts(db), [0, 0]);
});

test('closed accounting day blocks APPLY', async t => {
  const { db, proposal } = await fixture(t);

  const when = '2026-10-10T08:00:00.000Z';

  const row = await db.prepare(
    "SELECT occurred_at FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  await db.prepare(
    `INSERT INTO day_audit_closings
     (id,salon_id,audit_date,total_halalas,cash_halalas,
      card_halalas,transfer_halalas,manual_cash_halalas,
      cash_diff_halalas,closed_at,created_at)
     VALUES ('closed-a','main',?,7000,0,7000,0,0,0,?,?)`
  ).bind(
    String(row.occurred_at).slice(0, 10),
    when,
    when
  ).run();

  await assert.rejects(
    approve(db, proposal.id),
    error => error?.status === 409
  );

  assert.deepEqual(await counts(db), [0, 0]);
});

test('refund committed after proposal blocks APPLY', async t => {
  const { db, proposal } = await fixture(t);

  await createRefund(db, 'main', {
    id: 'refund-after-proposal',
    paymentId: 'payment-a',
    amountHalalas: 1000,
    status: 'completed'
  });

  await assert.rejects(
    approve(db, proposal.id),
    error => error?.status === 409
  );

  assert.deepEqual(await counts(db), [0, 0]);
});

test('external provider payment cannot be reclassified', async t => {
  const { db, proposal } = await fixture(t);

  await db.prepare(
    "UPDATE payments SET provider='external-gateway' WHERE id='payment-a'"
  ).run();

  await assert.rejects(
    approve(db, proposal.id),
    error => error?.status === 409
  );

  assert.deepEqual(await counts(db), [0, 0]);
});

test('failed audit rolls back event and both postings atomically', async t => {
  const { db, proposal } = await fixture(t);

  await db.prepare(
    `CREATE TRIGGER apply_audit_failure
     BEFORE INSERT ON audit_logs
     WHEN NEW.action = 'payment_method_correction_applied'
     BEGIN
       SELECT RAISE(ABORT, 'INJECTED_APPLY_AUDIT_FAILURE');
     END`
  ).run();

  await assert.rejects(
    approve(db, proposal.id),
    /INJECTED_APPLY_AUDIT_FAILURE/
  );

  assert.deepEqual(await counts(db), [0, 0]);

  const audit = await db.prepare(
    `SELECT COUNT(*) AS n FROM audit_logs
     WHERE action='payment_method_correction_applied'`
  ).first();

  assert.equal(audit.n, 0);
});

test('simultaneous attempts create only one correction', async t => {
  const { db, proposal } = await fixture(t);

  const results = await Promise.allSettled([
    approve(db, proposal.id),
    approve(db, proposal.id)
  ]);

  assert.ok(results.some(x => x.status === 'fulfilled'));
  assert.deepEqual(await counts(db), [1, 2]);

  const integrity = await db.prepare(
    `SELECT integrity_status
     FROM payment_correction_applied_integrity`
  ).first();

  assert.equal(integrity.integrity_status, 'balanced');
});

test('correction day totals preserve net revenue', async t => {
  const { db, proposal } = await fixture(t);

  const { getAppliedCorrectionDayTotals } = await import(
    './core/repositories/payment-correction-read-model.js'
  );

  const income = await db.prepare(
    "SELECT occurred_at FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  const date = income.occurred_at.slice(0, 10);

  const before = await getAppliedCorrectionDayTotals(db, 'main', date);

  assert.equal(before.totalDeltaHalalas, 0);
  assert.equal(before.eventCount, 0);

  await approve(db, proposal.id);

  const after = await getAppliedCorrectionDayTotals(db, 'main', date);

  assert.equal(after.cashDeltaHalalas, 7000);
  assert.equal(after.cardDeltaHalalas, -7000);
  assert.equal(after.transferDeltaHalalas, 0);
  assert.equal(after.totalDeltaHalalas, 0);
  assert.equal(after.eventCount, 1);
  assert.equal(after.postingCount, 2);

  const otherTenant = await getAppliedCorrectionDayTotals(
    db, 'another-salon', date
  );

  assert.equal(otherTenant.eventCount, 0);

  const otherDate = await getAppliedCorrectionDayTotals(
    db, 'main', '2026-01-01'
  );

  assert.equal(otherDate.eventCount, 0);

  const originalPayment = await db.prepare(
    "SELECT amount_halalas,method FROM payments WHERE id='payment-a'"
  ).first();

  assert.equal(originalPayment.amount_halalas, 7000);
  assert.equal(originalPayment.method, 'card');

  const originalIncome = await db.prepare(
    "SELECT amount_halalas,method FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  assert.equal(originalIncome.amount_halalas, 7000);
  assert.equal(originalIncome.method, 'card');
});

test('correction read model rejects an incomplete applied journal', async t => {
  const { db, proposal } = await fixture(t);

  const { getAppliedCorrectionDayTotals } = await import(
    './core/repositories/payment-correction-read-model.js'
  );

  const applied = await approve(db, proposal.id);

  await db.prepare(
    `INSERT INTO payment_correction_applied_events (
       id, salon_id, proposal_id, payment_id,
       invoice_id, booking_id, kind,
       original_amount_halalas, corrected_amount_halalas,
       amount_delta_halalas, original_method, corrected_method,
       refunded_snapshot_halalas, invoice_paid_before_halalas,
       invoice_paid_after_halalas, accounting_date,
       requested_by_uid, approved_by_uid, applied_by_uid,
       reason, idempotency_key, applied_at
     )
     SELECT
       'incomplete-event', salon_id, 'incomplete-proposal',
       'incomplete-payment', invoice_id, booking_id, kind,
       original_amount_halalas, corrected_amount_halalas,
       amount_delta_halalas, original_method, corrected_method,
       refunded_snapshot_halalas, invoice_paid_before_halalas,
       invoice_paid_after_halalas, accounting_date,
       requested_by_uid, approved_by_uid, applied_by_uid,
       reason, 'incomplete-key', applied_at
     FROM payment_correction_applied_events
     WHERE id = ?`
  ).bind(applied.id).run();

  await assert.rejects(
    getAppliedCorrectionDayTotals(db, 'main', applied.accounting_date),
    error =>
      error?.status === 409 &&
      error?.code === 'core_payment_correction:unbalanced_ledger'
  );
});

test('day audit includes applied method corrections without increasing revenue', async t => {
  const { db, proposal } = await fixture(t);

  const { computeDayAuditSnapshot } = await import(
    './core/repositories/day-audit-closings.js'
  );

  const income = await db.prepare(
    "SELECT occurred_at FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  const date = income.occurred_at.slice(0, 10);

  const before = await computeDayAuditSnapshot(db, 'main', date);

  assert.equal(before.cardHalalas, 7000);
  assert.equal(before.cashHalalas, 0);
  assert.equal(before.totalHalalas, 7000);

  await approve(db, proposal.id);

  const after = await computeDayAuditSnapshot(db, 'main', date);

  assert.equal(after.cardHalalas, 0);
  assert.equal(after.cashHalalas, 7000);
  assert.equal(after.transferHalalas, 0);
  assert.equal(after.totalHalalas, 7000);
  assert.equal(after.unclassifiedHalalas, 0);

  assert.equal(
    after.sourceVersion,
    'day-audit-v3-riyadh-accounting-day'
  );

  const invoice = await db.prepare(
    "SELECT paid_halalas FROM invoices WHERE id='invoice-a'"
  ).first();

  assert.equal(invoice.paid_halalas, 7000);
});

test('cross-date payment belongs only to its accounting date', async t => {
  const { db, proposal } = await fixture(t);

  const { computeDayAuditSnapshot } = await import(
    './core/repositories/day-audit-closings.js'
  );

  // Booking: October 10.
  // Payment income: October 11.
  await db.prepare(
    `UPDATE income_entries
     SET occurred_at = '2026-10-11T08:00:00.000Z'
     WHERE salon_id = 'main'
       AND payment_id = 'payment-a'`
  ).run();

  const bookingDate = '2026-10-10';
  const accountingDate = '2026-10-11';

  const bookingDayBefore = await computeDayAuditSnapshot(
    db, 'main', bookingDate
  );

  assert.equal(bookingDayBefore.totalHalalas, 0);
  assert.equal(bookingDayBefore.cashHalalas, 0);
  assert.equal(bookingDayBefore.cardHalalas, 0);

  const paymentDayBefore = await computeDayAuditSnapshot(
    db, 'main', accountingDate
  );

  assert.equal(paymentDayBefore.totalHalalas, 7000);
  assert.equal(paymentDayBefore.cardHalalas, 7000);
  assert.equal(paymentDayBefore.cashHalalas, 0);

  const applied = await approve(db, proposal.id);

  assert.equal(applied.accounting_date, accountingDate);

  const bookingDayAfter = await computeDayAuditSnapshot(
    db, 'main', bookingDate
  );

  assert.equal(bookingDayAfter.totalHalalas, 0);
  assert.equal(bookingDayAfter.cardHalalas, 0);
  assert.equal(bookingDayAfter.cashHalalas, 0);

  const paymentDayAfter = await computeDayAuditSnapshot(
    db, 'main', accountingDate
  );

  assert.equal(paymentDayAfter.totalHalalas, 7000);
  assert.equal(paymentDayAfter.cardHalalas, 0);
  assert.equal(paymentDayAfter.cashHalalas, 7000);
  assert.equal(paymentDayAfter.transferHalalas, 0);

  const invoice = await db.prepare(
    "SELECT paid_halalas FROM invoices WHERE id='invoice-a'"
  ).first();

  assert.equal(invoice.paid_halalas, 7000);

  const originalPayment = await db.prepare(
    "SELECT amount_halalas,method FROM payments WHERE id='payment-a'"
  ).first();

  assert.equal(originalPayment.amount_halalas, 7000);
  assert.equal(originalPayment.method, 'card');
});

test('day close rejects a correction committed after snapshot', async t => {
  const { db, proposal } = await fixture(t);

  const { closeDayAudit, computeDayAuditSnapshot } = await import(
    './core/repositories/day-audit-closings.js'
  );

  const income = await db.prepare(
    "SELECT occurred_at FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  const date = income.occurred_at.slice(0, 10);
  let injected = false;

  const racingDb = {
    prepare(sql) {
      return {
        bind(...params) {
          const statement = db.prepare(sql).bind(...params);

          return {
            first: () => statement.first(),
            all: () => statement.all(),
            async run() {
              if (
                !injected &&
                /^\s*INSERT INTO day_audit_closings\b/i.test(sql)
              ) {
                injected = true;
                await approve(db, proposal.id);
              }

              return statement.run();
            }
          };
        }
      };
    }
  };

  await assert.rejects(
    closeDayAudit(
      racingDb,
      'main',
      { date, manualCashHalalas: 0 },
      { uid: 'owner-a' }
    ),
    error =>
      error?.status === 409 &&
      error?.code === 'core_day_audit:stale_snapshot'
  );

  assert.equal(injected, true);

  const closingCount = await db.prepare(
    `SELECT COUNT(*) AS n
     FROM day_audit_closings
     WHERE salon_id = 'main' AND audit_date = ?`
  ).bind(date).first();

  assert.equal(closingCount.n, 0);

  const refreshed = await computeDayAuditSnapshot(
    db, 'main', date
  );

  assert.equal(refreshed.cashHalalas, 7000);
  assert.equal(refreshed.cardHalalas, 0);
  assert.equal(refreshed.totalHalalas, 7000);
  assert.equal(refreshed.correctionEventCount, 1);

  const closed = await closeDayAudit(
    db,
    'main',
    { date, manualCashHalalas: 7000 },
    { uid: 'owner-a' }
  );

  assert.equal(closed.cashHalalas, 7000);
  assert.equal(closed.cardHalalas, 0);
  assert.equal(closed.totalHalalas, 7000);
});

test('day closing committed first prevents later APPLY', async t => {
  const { db, proposal } = await fixture(t);

  const { closeDayAudit } = await import(
    './core/repositories/day-audit-closings.js'
  );

  const income = await db.prepare(
    "SELECT occurred_at FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  const date = income.occurred_at.slice(0, 10);

  const closing = await closeDayAudit(
    db,
    'main',
    { date, manualCashHalalas: 0 },
    { uid: 'owner-a' }
  );

  assert.equal(closing.cashHalalas, 0);
  assert.equal(closing.cardHalalas, 7000);
  assert.equal(closing.totalHalalas, 7000);

  await assert.rejects(
    approve(db, proposal.id),
    error =>
      error?.status === 409 &&
      error?.code === 'core_payment_correction:apply_conflict_or_stale'
  );

  const eventCount = await db.prepare(
    'SELECT COUNT(*) AS n FROM payment_correction_applied_events'
  ).first();

  const postingCount = await db.prepare(
    'SELECT COUNT(*) AS n FROM payment_correction_applied_postings'
  ).first();

  assert.equal(eventCount.n, 0);
  assert.equal(postingCount.n, 0);
});

test('day audit scans more than 500 income rows without truncation', async t => {
  const { db } = await fixture(t);

  const { computeDayAuditSnapshot } = await import(
    './core/repositories/day-audit-closings.js'
  );

  const income = await db.prepare(
    "SELECT occurred_at FROM income_entries WHERE payment_id='payment-a'"
  ).first();

  const date = income.occurred_at.slice(0, 10);

  // Seed 510 additional invoice-source income rows.
  // One original payment + 510 additional entries = 511 rows.
  await db.prepare(
    `WITH RECURSIVE seq(n) AS (
       SELECT 1
       UNION ALL
       SELECT n + 1 FROM seq WHERE n < 510
     )
     INSERT INTO income_entries (
       id,
       salon_id,
       amount_halalas,
       category,
       description,
       method,
       source,
       note,
       occurred_at,
       created_at
     )
     SELECT
       'audit-page-' || n,
       'main',
       100,
       'payment',
       'Pagination regression',
       'cash',
       'invoice',
       '',
       ?,
       ?
     FROM seq`
  ).bind(
    income.occurred_at,
    income.occurred_at
  ).run();

  const snapshot = await computeDayAuditSnapshot(
    db,
    'main',
    date
  );

  assert.equal(snapshot.rowCount, 511);
  assert.equal(snapshot.cashHalalas, 51000);
  assert.equal(snapshot.cardHalalas, 7000);
  assert.equal(snapshot.transferHalalas, 0);
  assert.equal(snapshot.totalHalalas, 58000);
  assert.equal(snapshot.unclassifiedHalalas, 0);
});

test('Riyadh midnight accounting boundary is consistent across audit and APPLY', async t => {
  const { db, proposal } = await fixture(t);

  const { computeDayAuditSnapshot } = await import(
    './core/repositories/day-audit-closings.js'
  );

  // October 24 at 21:30 UTC = October 25 at 00:30 Riyadh.
  await db.prepare(
    `UPDATE income_entries
     SET occurred_at = ?
     WHERE salon_id = 'main'
       AND payment_id = 'payment-a'`
  ).bind('2026-10-24T21:30:00.000Z').run();

  const previousDay = await computeDayAuditSnapshot(
    db, 'main', '2026-10-24'
  );

  assert.equal(previousDay.totalHalalas, 0);

  const accountingDay = await computeDayAuditSnapshot(
    db, 'main', '2026-10-25'
  );

  assert.equal(accountingDay.cardHalalas, 7000);
  assert.equal(accountingDay.cashHalalas, 0);
  assert.equal(accountingDay.totalHalalas, 7000);

  await approve(db, proposal.id);

  const event = await db.prepare(
    `SELECT accounting_date
     FROM payment_correction_applied_events
     WHERE salon_id = 'main'
     LIMIT 1`
  ).first();

  assert.equal(event.accounting_date, '2026-10-25');

  const after = await computeDayAuditSnapshot(
    db, 'main', '2026-10-25'
  );

  assert.equal(after.cashHalalas, 7000);
  assert.equal(after.cardHalalas, 0);
  assert.equal(after.totalHalalas, 7000);

  const previousAfter = await computeDayAuditSnapshot(
    db, 'main', '2026-10-24'
  );

  assert.equal(previousAfter.totalHalalas, 0);
});

test('financial revision rejects income committed after snapshot', async t => {
  const { db } = await fixture(t);

  const { closeDayAudit, computeDayAuditSnapshot } = await import(
    './core/repositories/day-audit-closings.js'
  );

  const income = await db.prepare(
    `SELECT occurred_at
       FROM income_entries
      WHERE salon_id = 'main'
        AND payment_id = 'payment-a'`
  ).first();

  const dateRow = await db.prepare(
    "SELECT date(?, '+3 hours') AS audit_date"
  ).bind(income.occurred_at).first();

  const date = dateRow.audit_date;
  let injected = false;

  const racingDb = {
    prepare(sql) {
      return {
        bind(...params) {
          const statement = db.prepare(sql).bind(...params);

          return {
            first: () => statement.first(),
            all: () => statement.all(),

            async run() {
              if (
                !injected &&
                /^\s*INSERT INTO day_audit_closings\b/i.test(sql)
              ) {
                injected = true;

                await db.prepare(
                  `INSERT INTO income_entries
                   (id, salon_id, amount_halalas,
                    category, description, method, source,
                    occurred_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                  'revision-race-income',
                  'main',
                  300,
                  'payment',
                  'Financial revision race',
                  'cash',
                  'invoice',
                  income.occurred_at,
                  income.occurred_at
                ).run();
              }

              return statement.run();
            }
          };
        }
      };
    }
  };

  await assert.rejects(
    closeDayAudit(
      racingDb,
      'main',
      {
        date,
        manualCashHalalas: 0
      },
      { uid: 'owner-a' }
    ),
    error =>
      error?.status === 409 &&
      error?.code === 'core_day_audit:stale_snapshot'
  );

  assert.equal(injected, true);

  const closing = await db.prepare(
    `SELECT COUNT(*) AS n
       FROM day_audit_closings
      WHERE salon_id = 'main'
        AND audit_date = ?`
  ).bind(date).first();

  assert.equal(closing.n, 0);

  const refreshed = await computeDayAuditSnapshot(
    db,
    'main',
    date
  );

  assert.equal(refreshed.cardHalalas, 7000);
  assert.equal(refreshed.cashHalalas, 300);
  assert.equal(refreshed.totalHalalas, 7300);
});

test('successful day close records its financial revision', async t => {
  const { db } = await fixture(t);

  const { closeDayAudit } = await import(
    './core/repositories/day-audit-closings.js'
  );

  const income = await db.prepare(
    `SELECT occurred_at
       FROM income_entries
      WHERE salon_id = 'main'
        AND payment_id = 'payment-a'`
  ).first();

  const dateRow = await db.prepare(
    "SELECT date(?, '+3 hours') AS audit_date"
  ).bind(income.occurred_at).first();

  const date = dateRow.audit_date;

  const before = await db.prepare(
    `SELECT revision
       FROM financial_day_revisions
      WHERE salon_id = 'main'
        AND audit_date = ?`
  ).bind(date).first();

  assert.ok(before.revision >= 1);

  const closing = await closeDayAudit(
    db,
    'main',
    {
      date,
      manualCashHalalas: 0
    },
    { uid: 'owner-a' }
  );

  assert.equal(closing.totalHalalas, 7000);
  assert.equal(
    closing.sourceSnapshot.financialRevision,
    before.revision
  );

  const persisted = await db.prepare(
    `SELECT source_snapshot_json
       FROM day_audit_closings
      WHERE salon_id = 'main'
        AND audit_date = ?`
  ).bind(date).first();

  const snapshot = JSON.parse(persisted.source_snapshot_json);

  assert.equal(snapshot.financialRevision, before.revision);
});
