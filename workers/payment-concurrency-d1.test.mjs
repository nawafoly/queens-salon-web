import { readFileSync, readdirSync } from "node:fs";
import { beginIdempotentOperation } from "./core/idempotency.js";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { createPayment } from './core/repositories/payments.js';
import { proposePaymentCorrection, listPaymentCorrectionProposals } from './core/repositories/payment-correction-proposals.js';
import { previewPaymentCorrectionImpact } from './core/repositories/payment-correction-impact.js';
import { patchBooking } from './core/repositories/bookings.js';
import { createRefund, patchRefund, voidRefund } from './core/repositories/refunds.js';

async function setup(t) {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'payments-d1-race', compatibilityDate: '2026-06-24',
    manifest: { mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
      modules: { 'script-0.mjs': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' } } },
    env: { CORE_DB: { type: 'd1', id: 'payments-d1-race' } }, exports: {},
  }, dev: { rootPath: process.cwd() } }] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('CORE_DB');
  for (const name of [
    '0001_core_schema.sql', '0003_booking_availability.sql',
    '0004_admin_operations.sql', '0006_booking_discount_snapshots.sql',
    '0007_booking_soft_delete.sql', '0061_booking_admin_notes.sql',
    '0014_app_users_permissions.sql',
    '0079_client_cashback_wallet.sql', '0081_cashback_expiry_lot_state.sql',
    '0083_internal_booking_price_adjustments.sql',
    '0094_day_audit_closings.sql',
    '0095_payment_correction_proposals.sql',
  ]) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
      .replace(/\r/g, '').split('\n').filter((x) => !x.trim().startsWith('--')).join('\n');
    for (const statement of sql.split(';').map((x) => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  await db.prepare(`ALTER TABLE bookings
    ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0`).run();
  await db.prepare(`CREATE TABLE booking_lifecycle_cas_guard (
    id TEXT NOT NULL
  )`).run();
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare("INSERT INTO clients (id,salon_id,name,status,created_at,updated_at) VALUES ('test-client','main','Test Client','active',?,?)").bind(now,now).run();
  await db.prepare(`INSERT INTO bookings
    (id,salon_id,client_id,booking_date,start_time,end_time,status,source,subtotal_halalas,discount_halalas,total_halalas,payment_status,package_sessions_used,created_at,updated_at)
    VALUES ('test-booking','main','test-client','2026-10-10','09:00','10:00','booked','internal',10000,0,10000,'unpaid',0,?,?)`).bind(now,now).run();
  await db.prepare(`INSERT INTO invoices
    (id,salon_id,booking_id,client_id,subtotal_halalas,total_halalas,discount_halalas,paid_halalas,status,issued_at,created_at,updated_at)
    VALUES ('test-invoice','main','test-booking','test-client',10000,10000,0,0,'unpaid',?,?,?)`).bind(now,now,now).run();
  return db;
}

function gateBothInvoiceReads(db) {
  let reads = 0, open;
  const release = new Promise((resolve) => { open = resolve; });
  return {
    get reads() { return reads; },
    prepare(sql) {
      return { bind(...params) {
        const bound = db.prepare(sql).bind(...params);
        return {
          bound,
          async first() {
            const row = await bound.first();
            if (/^SELECT \* FROM invoices WHERE salon_id = \? AND id = \?/.test(sql)) {
              reads += 1;
              if (reads === 2) open();
              await release;
            }
            return row;
          },
          all: () => bound.all(), run: () => bound.run(),
        };
      }};
    },
    batch(statements) { return db.batch(statements.map((item) => item.bound)); },
  };
}

function gateBothRefundReads(db) {
  let reads = 0, open;
  const release = new Promise((resolve) => { open = resolve; });
  return {
    get reads() { return reads; },
    prepare(sql) {
      return { bind(...params) {
        const bound = db.prepare(sql).bind(...params);
        return {
          bound,
          async first() {
            const row = await bound.first();
            if (/^SELECT \* FROM refunds WHERE salon_id = \? AND id = \? LIMIT 1/.test(sql) && reads < 2) {
              reads += 1;
              if (reads === 2) open();
              await release;
            }
            return row;
          },
          all: () => bound.all(), run: () => bound.run(),
        };
      }};
    },
    batch(statements) { return db.batch(statements.map((item) => item.bound)); },
  };
}

async function table(db, query) { return (await db.prepare(query).all()).results; }

test('pending and failed payments cannot post income, invoice balance, cashback or audit', async (t) => {
  const db = await setup(t);
  for (const status of ['pending', 'failed', 'cancelled', 'unrecognized', '']) {
    await assert.rejects(
      createPayment(db, 'main', {
        invoiceId: 'test-invoice', amountHalalas: 4000,
        status, idempotencyKey: `invalid-payment-${status}`,
      }),
      (error) => error?.status === 400 && error?.code === 'core_payment:invalid_settlement_status',
      status,
    );
  }
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 0);
  assert.equal((await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first()).payment_status, 'unpaid');
  for (const name of ['payments', 'income_entries', 'audit_logs', 'cashback_wallet_transactions']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n, 0, name);
  }
});

test('legacy pending payment idempotent replay returns same record without new ledger effect', async (t) => {
  const db = await setup(t);
  const when = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO payments
    (id,salon_id,invoice_id,booking_id,client_id,method,amount_halalas,status,idempotency_key,paid_at,created_at)
    VALUES ('legacy-pending-payment','main','test-invoice','test-booking','test-client',
      'card',2000,'pending','legacy-pending-pay-key',?,?)`).bind(when,when).run();

  const replay = await createPayment(db, 'main', {
    invoiceId: 'test-invoice', amountHalalas: 2000,
    status: 'pending', idempotencyKey: 'legacy-pending-pay-key',
  });
  assert.equal(replay.id, 'legacy-pending-payment');
  assert.equal(replay.idempotent, true);
  assert.equal((await table(db, 'SELECT id FROM payments')).length, 1);
  assert.equal((await table(db, 'SELECT id FROM income_entries')).length, 0);
  assert.equal((await table(db, 'SELECT id FROM audit_logs')).length, 0);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 0);
  await assert.rejects(
    createPayment(db, 'main', {
      invoiceId: 'test-invoice', amountHalalas: 2000,
      status: 'pending', idempotencyKey: 'fresh-pending-pay-key',
    }),
    (error) => error?.code === 'core_payment:invalid_settlement_status',
  );
});

test('legacy pending refund idempotent replay returns same record without a second debit', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const when = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO refunds
    (id,salon_id,payment_id,invoice_id,client_id,amount_halalas,method,status,idempotency_key,refunded_at,created_at)
    VALUES ('legacy-pending-refund','main','seed-payment','refund-invoice','test-client',
      1000,'cash','pending','legacy-pending-refund-key',?,?)`).bind(when,when).run();
  const replay = await createRefund(db, 'main', {
    paymentId: 'seed-payment', amountHalalas: 1000,
    status: 'pending', idempotencyKey: 'legacy-pending-refund-key',
  });
  assert.equal(replay.id, 'legacy-pending-refund');
  assert.equal(replay.idempotent, true);
  assert.equal((await table(db, 'SELECT id FROM refunds')).length, 1);
  assert.equal((await table(db, 'SELECT id FROM audit_logs')).length, 0);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 5000);
  await assert.rejects(
    createRefund(db, 'main', {
      paymentId: 'seed-payment', amountHalalas: 1000,
      status: 'pending', idempotencyKey: 'fresh-pending-refund-key',
    }),
    (error) => error?.code === 'core_refund:invalid_settlement_status',
  );
});

test('existing accepted settled payment aliases remain compatible and normalize casing', async (t) => {
  const db = await setup(t);
  for (const status of ['Paid', 'Completed', 'SUCCEEDED']) {
    const payment = await createPayment(db, 'main', {
      invoiceId: 'test-invoice', amountHalalas: 1000, status,
    });
    assert.equal(payment.status, status.toLowerCase());
  }
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 3000);
  assert.equal((await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first()).payment_status, 'partial');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM income_entries').first()).n, 3);
});

test('non-settled refunds cannot debit invoice, enter ledger, or consume refund budget', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  for (const status of ['pending', 'failed', 'cancelled', 'unrecognized', '']) {
    await assert.rejects(
      createRefund(db, 'main', {
        paymentId: 'seed-payment', amountHalalas: 1000,
        status, idempotencyKey: `invalid-refund-${status}`,
      }),
      (error) => error?.status === 400 && error?.code === 'core_refund:invalid_settlement_status',
      status,
    );
  }
  const invoice = await db.prepare("SELECT paid_halalas, status FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, 5000);
  assert.equal(invoice.status, 'partial');
  for (const name of ['refunds', 'audit_logs', 'cashback_wallet_transactions']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n, 0, name);
  }
});

test('refund edits cannot turn a settled refund into pending or mutate a historic pending refund', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await createRefund(db, 'main', {
    id: 'settled-refund', paymentId: 'seed-payment', amountHalalas: 1000,
    status: 'Completed',
  });
  const paidAfterSettled = (await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas;
  assert.equal(paidAfterSettled, 4000);
  await assert.rejects(
    patchRefund(db, 'main', 'settled-refund', { amountHalalas: 2000, status: 'pending' }),
    (error) => error?.code === 'core_refund:invalid_settlement_status',
  );
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO refunds
    (id,salon_id,payment_id,invoice_id,client_id,amount_halalas,method,status,refunded_at,created_at)
    VALUES ('historic-pending','main','seed-payment','refund-invoice','test-client',500,'cash','pending',?,?)`)
    .bind(now,now).run();
  await assert.rejects(
    patchRefund(db, 'main', 'historic-pending', { amountHalalas: 800 }),
    (error) => error?.code === 'core_refund:not_settled',
  );
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, paidAfterSettled);
  assert.equal((await db.prepare("SELECT amount_halalas FROM refunds WHERE id='settled-refund'").first()).amount_halalas, 1000);
  assert.equal((await db.prepare("SELECT amount_halalas FROM refunds WHERE id='historic-pending'").first()).amount_halalas, 500);
  const voided = await voidRefund(db, 'main', 'historic-pending');
  assert.equal(voided.status, 'voided');
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, paidAfterSettled);
});

test('different concurrent payments are summed and audited from the live invoice row', async (t) => {
  const db = await setup(t), gate = gateBothInvoiceReads(db);
  const result = await Promise.all([4000, 6000].map((amount, i) =>
    createPayment(gate, 'main', {
      id: `payment-${i}`, invoiceId: 'test-invoice',
      amountHalalas: amount, method: i ? 'card' : 'cash', idempotencyKey: `key-${i}`,
    })
  ));
  assert.equal(gate.reads, 2);
  assert.equal(result.length, 2);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 10000);
  assert.equal((await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first()).payment_status, 'paid');
  const payments = await table(db, "SELECT * FROM payments WHERE invoice_id='test-invoice'");
  const incomes = await table(db, "SELECT * FROM income_entries WHERE invoice_id='test-invoice'");
  assert.equal(payments.length, 2);
  assert.equal(incomes.length, 2);
  assert.equal(payments.reduce((n, p) => n + p.amount_halalas, 0), 10000);
  const audits = (await table(db, "SELECT before_json,after_json FROM audit_logs WHERE action='invoice_payment_updated'")).map(a => ({
    before: JSON.parse(a.before_json), after: JSON.parse(a.after_json),
  })).sort((a,b) => a.before.paidHalalas - b.before.paidHalalas);
  assert.equal(audits.length, 2);
  assert.equal(audits[0].before.paidHalalas, 0);
  assert.equal(audits[0].after.paidHalalas, audits[1].before.paidHalalas);
  assert.equal(audits[1].after.paidHalalas, 10000);
  assert.equal(audits[1].after.status, 'paid');
});

test('simultaneous same idempotency key returns one committed payment and no duplicate income', async (t) => {
  const db = await setup(t), gate = gateBothInvoiceReads(db);
  const results = await Promise.all(['retry-a','retry-b'].map(id =>
    createPayment(gate, 'main', { id, invoiceId: 'test-invoice',
      amountHalalas: 4000, idempotencyKey: 'same-key' })
  ));
  assert.equal(gate.reads, 2);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results.filter(p => p.idempotent).length, 1);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 4000);
  assert.equal((await table(db, "SELECT id FROM payments WHERE idempotency_key='same-key'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE invoice_id='test-invoice'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='invoice_payment_updated'")).length, 1);
});

async function setupRefundInvoice(db) {
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO invoices
    (id,salon_id,booking_id,client_id,subtotal_halalas,total_halalas,discount_halalas,paid_halalas,status,issued_at,created_at,updated_at)
    VALUES ('refund-invoice','main',NULL,'test-client',20000,20000,0,5000,'partial',?,?,?)`)
    .bind(now, now, now).run();
  await db.prepare(`INSERT INTO payments
    (id,salon_id,invoice_id,client_id,method,amount_halalas,status,paid_at,created_at)
    VALUES ('seed-payment','main','refund-invoice','test-client','cash',5000,'paid',?,?)`)
    .bind(now, now).run();
}

test('a refund and a payment raced from the same invoice snapshot preserve both deltas', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const gate = gateBothInvoiceReads(db);
  const result = await Promise.all([
    createPayment(gate, 'main', {
      id: 'refund-race-payment', invoiceId: 'refund-invoice',
      amountHalalas: 4000, idempotencyKey: 'refund-race-payment',
    }),
    createRefund(gate, 'main', {
      id: 'refund-race-refund', paymentId: 'seed-payment',
      amountHalalas: 1000, idempotencyKey: 'refund-race-refund',
    }),
  ]);
  assert.equal(gate.reads, 2);
  assert.equal(result.length, 2);
  const invoice = await db.prepare("SELECT paid_halalas,status FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, 8000, '5,000 + 4,000 - 1,000 must not lose the payment');
  assert.equal(invoice.status, 'partial');
  assert.equal((await table(db, "SELECT id FROM payments WHERE invoice_id='refund-invoice'")).length, 2);
  assert.equal((await table(db, "SELECT id FROM refunds WHERE invoice_id='refund-invoice'")).length, 1);
  const invoiceAudit = (await table(db, "SELECT before_json,after_json FROM audit_logs WHERE action='invoice_payment_updated' AND entity_id='refund-invoice'"))[0];
  assert.ok(invoiceAudit, 'payment keeps its own accurate transaction-time audit');
  const before = JSON.parse(invoiceAudit.before_json).paidHalalas;
  const after = JSON.parse(invoiceAudit.after_json).paidHalalas;
  assert.equal(after - before, 4000);
});

test('refund amount edits and void restore only their delta against the live invoice row', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const original = await createRefund(db, 'main', {
    id: 'refund-edit', paymentId: 'seed-payment', amountHalalas: 1000,
  });
  assert.equal(original.amount_halalas, 1000);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 4000);
  const patched = await patchRefund(db, 'main', 'refund-edit', { amountHalalas: 1500 });
  assert.equal(patched.amount_halalas, 1500);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 3500);
  const voided = await voidRefund(db, 'main', 'refund-edit');
  assert.equal(voided.status, 'voided');
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 5000);
});

test('two simultaneous voids of one refund credit the invoice only once', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await createRefund(db, 'main', { id: 'void-race', paymentId: 'seed-payment', amountHalalas: 1000 });
  const gate = gateBothRefundReads(db);
  const results = await Promise.all([
    voidRefund(gate, 'main', 'void-race'), voidRefund(gate, 'main', 'void-race'),
  ]);
  assert.equal(gate.reads, 2);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 5000);
  assert.equal(results.filter(p => p.idempotent).length, 1);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='refund_voided' AND entity_id='void-race'")).length, 1);
});

test('raced edits to one refund reject a stale update without double subtracting', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await createRefund(db, 'main', { id: 'edit-race', paymentId: 'seed-payment', amountHalalas: 1000 });
  const gate = gateBothRefundReads(db);
  const result = await Promise.allSettled([
    patchRefund(gate, 'main', 'edit-race', { amountHalalas: 1500 }),
    patchRefund(gate, 'main', 'edit-race', { amountHalalas: 2000 }),
  ]);
  assert.equal(gate.reads, 2);
  const accepted = result.filter(p => p.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  const rejected = result.find(p => p.status === 'rejected');
  assert.equal(rejected.reason.code, 'core_refund:concurrent_modification');
  const refund = await db.prepare("SELECT amount_halalas FROM refunds WHERE id='edit-race'").first();
  const invoice = await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, 5000 - refund.amount_halalas);
});

test('concurrent distinct refunds cannot exceed the original payment budget', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  let checks = 0, open;
  const release = new Promise((resolve) => { open = resolve; });
  const racing = {
    prepare(sql) {
      return { bind(...params) {
        const bound = db.prepare(sql).bind(...params);
        return {
          bound,
          async first() {
            const row = await bound.first();
            if (sql.startsWith("SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds") && checks < 2) {
              checks += 1;
              if (checks === 2) open();
              await release;
            }
            return row;
          },
          all: () => bound.all(), run: () => bound.run(),
        };
      }};
    },
    batch(statements) { return db.batch(statements.map((statement) => statement.bound)); },
  };
  const results = await Promise.allSettled(['refund-cap-a','refund-cap-b'].map(id =>
    createRefund(racing, 'main', {
      id, paymentId: 'seed-payment', amountHalalas: 3000, idempotencyKey: id,
    })
  ));
  assert.equal(checks, 2, 'both requests must pass their stale preflight refund sum');
  assert.equal(results.filter(p => p.status === 'fulfilled').length, 1);
  const denied = results.find(p => p.status === 'rejected');
  assert.equal(denied.reason.code, 'core_refund:amount_exceeds_remaining');
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 2000);
  const refunds = await table(db, "SELECT * FROM refunds WHERE payment_id='seed-payment' AND status='completed'");
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amount_halalas, 3000);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='refund_created'")).length, 1);
});

test('payment versus void retains legitimate overpayment even above invoice total', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await db.prepare("UPDATE invoices SET total_halalas = 5000 WHERE id='refund-invoice'").run();
  await createRefund(db, 'main', { id: 'overpaid-refund', paymentId: 'seed-payment', amountHalalas: 1000 });
  const gate = gateBothInvoiceReads(db);
  await Promise.all([
    createPayment(gate, 'main', {
      id: 'overpay-payment', invoiceId: 'refund-invoice', amountHalalas: 2000,
    }),
    voidRefund(gate, 'main', 'overpaid-refund'),
  ]);
  assert.equal(gate.reads, 2);
  const invoice = await db.prepare("SELECT paid_halalas, total_halalas, status FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.total_halalas, 5000);
  assert.equal(invoice.paid_halalas, 7000, 'refunding a refund must not erase excess collected payment');
  assert.equal(invoice.status, 'paid');
});

test('a patch racing a void applies exactly one version of a refund amount', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await createRefund(db, 'main', { id: 'void-edit-race', paymentId: 'seed-payment', amountHalalas: 1000 });
  const gate = gateBothRefundReads(db);
  const result = await Promise.allSettled([
    patchRefund(gate, 'main', 'void-edit-race', { amountHalalas: 1500 }),
    voidRefund(gate, 'main', 'void-edit-race'),
  ]);
  assert.equal(gate.reads, 2);
  assert.equal(result.filter(p => p.status === 'fulfilled').length, 1);
  const rejected = result.find(p => p.status === 'rejected');
  assert.equal(rejected.reason.code, 'core_refund:concurrent_modification');
  const refund = await db.prepare("SELECT status,amount_halalas FROM refunds WHERE id='void-edit-race'").first();
  const invoice = await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, refund.status === 'voided'
    ? 5000 : 5000 - refund.amount_halalas);
});

test('case-variant completed refund still consumes the exact live payment budget', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const result = await createRefund(db, 'main', {
    id: 'case-refund', paymentId: 'seed-payment', amountHalalas: 3000,
    status: 'Completed',
  });
  assert.equal(result.status, 'completed');
  await assert.rejects(
    createRefund(db, 'main', {
      id: 'case-over-refund', paymentId: 'seed-payment', amountHalalas: 3000,
      status: 'completed',
    }),
    (error) => error?.code === 'core_refund:amount_exceeds_remaining'
  );
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 2000);
  assert.equal((await table(db, "SELECT id FROM refunds WHERE payment_id='seed-payment'")).length, 1);
});

test('legacy mixed-case completed refund is counted against new refund budget', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO refunds
    (id,salon_id,payment_id,invoice_id,booking_id,client_id,
     amount_halalas,method,status,refunded_at,created_at)
    VALUES ('legacy-mixed-case','main','seed-payment','refund-invoice',
      NULL,'test-client',3000,'cash','Completed',?,?)`).bind(now,now).run();
  await assert.rejects(
    createRefund(db, 'main', {
      id: 'legacy-over-budget', paymentId: 'seed-payment',
      amountHalalas: 3000, idempotencyKey: 'legacy-over-budget',
    }),
    (error) => error?.code === 'core_refund:amount_exceeds_remaining'
  );
  assert.equal((await table(db, "SELECT id FROM refunds WHERE payment_id='seed-payment'")).length, 1);
  const invoice = await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, 5000);
});

function forceStaleRefundCas(db, refundId) {
  let didChange = false;
  return {
    prepare(sql) {
      return { bind(...values) {
        const bound = db.prepare(sql).bind(...values);
        return {
          bound,
          first: () => bound.first(),
          all: () => bound.all(),
          run: () => bound.run(),
        };
      }};
    },
    async batch(statements) {
      if (!didChange) {
        didChange = true;
        // Simulate a competing successful update after our refund snapshot
        // but before this caller's optimistic UPDATE executes.
        await db.prepare("UPDATE refunds SET amount_halalas = 1200 WHERE salon_id = 'main' AND id = ?")
          .bind(refundId).run();
      }
      return db.batch(statements.map((statement) => statement.bound));
    },
  };
}

for (const operation of ['patch', 'void']) {
  test(`failed refund ${operation} CAS does not erase its linked expense`, async (t) => {
    const db = await setup(t);
    await setupRefundInvoice(db);
    const id = `stale-cleanup-${operation}`;
    await createRefund(db, 'main', {
      id, paymentId: 'seed-payment', amountHalalas: 1000,
    });
    const when = '2026-10-10T08:00:00.000Z';
    await db.prepare(`INSERT INTO expense_entries
      (id,salon_id,amount_halalas,category,occurred_at,created_at,updated_at,source_kind,source_ref_id)
      VALUES (?, 'main', 1000, 'refund', ?, ?, ?, 'refund', ?)`)
      .bind(`expense-${operation}`, when, when, when, id).run();
    const stale = forceStaleRefundCas(db, id);
    await assert.rejects(
      operation === 'patch'
        ? patchRefund(stale, 'main', id, { amountHalalas: 1500 })
        : voidRefund(stale, 'main', id),
      (error) => error?.code === 'core_refund:concurrent_modification',
    );
    const row = await db.prepare('SELECT id FROM expense_entries WHERE source_kind = ? AND source_ref_id = ?')
      .bind('refund', id).first();
    assert.ok(row, 'failed compare-and-swap must retain expense entry');
    const invoice = await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first();
    assert.equal(invoice.paid_halalas, 4000, 'failed CAS must not change invoice balance');
  });
}

test('invoice lookups do not cross salon boundaries', async (t) => {
  const db = await setup(t);
  await assert.rejects(
    createPayment(db, 'other-salon', { id: 'cross-salon', invoiceId: 'test-invoice', amountHalalas: 100 }),
    (error) => error?.code === 'core_invoice:not_found'
  );
  assert.equal((await table(db, 'SELECT id FROM payments')).length, 0);
});

test('concurrent settled payment survives operational booking PATCH with consistent invoice and booking status', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('test-service','main','Service',60,10000,1,?,?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('test-item','test-booking','main','test-service','Service',
     NULL,1,10000,10000,60,'2026-10-10','09:00','10:00',?)`).bind(now).run();

  // The booking PATCH completes all preflight reads with paid=0. Inject a
  // separate real-D1 payment commit immediately before its own D1 batch.
  // Neither FakeD1 nor sequential payment-only tests reproduce this race.
  let injected = false;
  const racingDb = {
    prepare: (...args) => db.prepare(...args),
    async batch(statements) {
      if (!injected) {
        injected = true;
        await createPayment(db, 'main', {
          id: 'racing-booking-payment',
          invoiceId: 'test-invoice',
          amountHalalas: 4000,
          status: 'paid',
        });
      }
      return db.batch(statements);
    },
  };
  const booking = await patchBooking(racingDb, 'main', 'test-booking', {
    clientName: 'New Client Name',
  });
  assert.equal(injected, true, 'the payment must commit after booking preflight');
  const invoice = await db.prepare("SELECT total_halalas, paid_halalas, status FROM invoices WHERE id='test-invoice'").first();
  const persisted = await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first();
  assert.equal(invoice.total_halalas, 10000);
  assert.equal(invoice.paid_halalas, 4000, 'booking operational edit must not overwrite paid money');
  assert.equal(invoice.status, 'partial');
  assert.equal(persisted.payment_status, 'partial');
  assert.equal(booking.payment_status, 'partial');
  assert.equal(booking.paid_halalas, 4000);
  assert.equal((await table(db, "SELECT id FROM payments WHERE booking_id='test-booking'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE booking_id='test-booking'")).length, 1);
});

test('price reduction races with newly committed payment: reject atomically without losing either ledger', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('price-floor-service','main','Service',60,10000,1,?,?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('price-floor-item','test-booking','main','price-floor-service','Service',
     NULL,1,10000,10000,60,'2026-10-10','09:00','10:00',?)`).bind(now).run();
  let injected = false;
  const racingDb = {
    prepare: (...args) => db.prepare(...args),
    async batch(statements) {
      if (!injected) {
        injected = true;
        await createPayment(db, 'main', {
          id: 'price-floor-racing-payment',
          invoiceId: 'test-invoice',
          amountHalalas: 9000,
          status: 'paid',
        });
      }
      return db.batch(statements);
    },
  };
  await assert.rejects(
    patchBooking(racingDb, 'main', 'test-booking', {
      bookingItemId: 'price-floor-item',
      bookingItemPriceHalalas: 8000,
      priceAdjustmentReason: 'management_approved',
    }, { uid: 'test-admin' }, { allowPriceAdjustment: true }),
    (error) => error?.status === 409 || error?.statusCode === 409 || error?.code === 'core_booking:price_below_paid_amount',
  );
  assert.equal(injected, true);
  const invoice = await db.prepare("SELECT total_halalas, paid_halalas, status FROM invoices WHERE id = 'test-invoice'").first();
  assert.equal(invoice.total_halalas, 10000, 'rejected edit cannot modify the invoice total');
  assert.equal(invoice.paid_halalas, 9000, 'committed payment remains in invoice');
  assert.equal(invoice.status, 'partial');
  const booking = await db.prepare("SELECT total_halalas, payment_status FROM bookings WHERE id = 'test-booking'").first();
  assert.equal(booking.total_halalas, 10000, 'rejected edit cannot change booking total');
  assert.equal(booking.payment_status, 'partial');
  const item = await db.prepare("SELECT unit_price_halalas FROM booking_items WHERE id='price-floor-item'").first();
  assert.equal(item.unit_price_halalas, 10000, 'rejected price edit must roll back item mutation');
  assert.equal((await table(db, "SELECT id FROM payments WHERE id='price-floor-racing-payment'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE payment_id='price-floor-racing-payment'")).length, 1);
});

test('payment correction must preserve original provider payment and completed-refund identity (immutable ledger guard)', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('correction-service','main','Service',60,10000,1,?,?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('correction-item','test-booking','main','correction-service','Service',
     NULL,1,10000,10000,60,'2026-10-10','09:00','10:00',?)`).bind(now).run();

  await createPayment(db, 'main', {
    id: 'provider-payment-must-survive',
    invoiceId: 'test-invoice',
    amountHalalas: 7000,
    method: 'card',
    provider: 'external-provider',
    providerReference: 'provider-reference-123',
    idempotencyKey: 'provider-payment-idempotency-123',
  });
  await createRefund(db, 'main', {
    id: 'completed-refund-must-survive',
    paymentId: 'provider-payment-must-survive',
    amountHalalas: 1000,
    status: 'completed',
    method: 'card',
  });

  // Existing booking edit attempts to replace a prior settled payment
  // despite a completed refund already pointing at that payment ID.
  // Until a non-destructive correction design exists, rejection with 409
  // and no mutations is safer than deleting immutable financial history.
  await assert.rejects(
    patchBooking(db, 'main', 'test-booking', {
      paidHalalas: 5000, paymentMethod: 'card', reconcilePayment: true,
    }),
    (error) => error?.status === 409 && error?.code === 'core_booking:payment_history_immutable',
  );

  const originalPayment = await db.prepare(
    "SELECT id, provider, provider_reference, idempotency_key, amount_halalas FROM payments WHERE salon_id='main' AND id='provider-payment-must-survive'"
  ).first();
  const linkedRefund = await db.prepare(
    "SELECT id, payment_id, amount_halalas, status FROM refunds WHERE salon_id='main' AND id='completed-refund-must-survive'"
  ).first();
  assert.ok(originalPayment, 'payment correction cannot delete the external settled payment');
  assert.equal(originalPayment.provider_reference, 'provider-reference-123');
  assert.equal(originalPayment.idempotency_key, 'provider-payment-idempotency-123');
  assert.equal(linkedRefund?.payment_id, originalPayment.id);
  assert.equal(linkedRefund?.status, 'completed');
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 6000);
  assert.equal((await table(db, "SELECT id FROM payments WHERE booking_id='test-booking'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE booking_id='test-booking'")).length, 1);
  const replay = await createPayment(db, 'main', {
    invoiceId: 'test-invoice',
    amountHalalas: 7000,
    method: 'card',
    idempotencyKey: 'provider-payment-idempotency-123',
  });
  assert.equal(replay.id, 'provider-payment-must-survive');
  assert.equal(replay.idempotent, true);
});

test('first booking payment reconciliation is allowed only before any settled money exists', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('first-payment-service','main','Service',60,10000,1,?,?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('first-payment-item','test-booking','main','first-payment-service','Service',
     NULL,1,10000,10000,60,'2026-10-10','09:00','10:00',?)`).bind(now).run();
  const created = await patchBooking(db, 'main', 'test-booking', {
    paidHalalas: 3000, paymentMethod: 'cash', reconcilePayment: true,
  });
  assert.equal(created.paid_halalas, 3000);
  assert.equal(created.payment_status, 'partial');
  assert.equal((await table(db, "SELECT id FROM payments WHERE booking_id='test-booking'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE booking_id='test-booking'")).length, 1);
  await assert.rejects(
    patchBooking(db, 'main', 'test-booking', {
      paidHalalas: 4000, paymentMethod: 'card', reconcilePayment: true,
    }),
    (error) => error?.status === 409 && error?.code === 'core_booking:payment_history_immutable',
  );
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 3000);
  assert.equal((await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first()).payment_status, 'partial');
  assert.equal((await table(db, "SELECT id FROM payments WHERE booking_id='test-booking'")).length, 1);
});

test('concurrent settled payment aborts legacy replacement before any booking mutation', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('correction-race-service','main','Service',60,10000,1,?,?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('correction-race-item','test-booking','main','correction-race-service','Service',
     NULL,1,10000,10000,60,'2026-10-10','09:00','10:00',?)`).bind(now).run();
  let injected = false;
  const racingDb = {
    prepare: (...args) => db.prepare(...args),
    async batch(statements) {
      if (!injected) {
        injected = true;
        await createPayment(db, 'main', {
          id: 'concurrent-settled-payment',
          invoiceId: 'test-invoice',
          amountHalalas: 4000,
          method: 'card',
          idempotencyKey: 'concurrent-settled-payment-key',
        });
      }
      return db.batch(statements);
    },
  };
  await assert.rejects(
    patchBooking(racingDb, 'main', 'test-booking', {
      paidHalalas: 2500, paymentMethod: 'cash', reconcilePayment: true,
      clientName: 'Stale client edit cannot partially commit',
    }),
    (error) => error?.status === 409 && error?.code === 'core_booking:payment_history_immutable',
  );
  assert.equal(injected, true);
  const invoice = await db.prepare("SELECT paid_halalas, status FROM invoices WHERE id='test-invoice'").first();
  assert.equal(invoice.paid_halalas, 4000);
  assert.equal(invoice.status, 'partial');
  assert.equal((await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first()).payment_status, 'partial');
  assert.equal((await db.prepare("SELECT name FROM clients WHERE id='test-client'").first()).name, 'Test Client');
  assert.equal((await table(db, "SELECT id FROM payments WHERE booking_id='test-booking'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE booking_id='test-booking'")).length, 1);
});

test('legacy booking income without payment id is immutable on financial PATCH', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('legacy-income-service','main','Service',60,10000,1,?,?)`).bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('legacy-income-item','test-booking','main','legacy-income-service','Service',
     NULL,1,10000,10000,60,'2026-10-10','09:00','10:00',?)`).bind(now).run();
  await db.prepare(`INSERT INTO income_entries
    (id,salon_id,booking_id,invoice_id,amount_halalas,category,description,occurred_at,created_at)
    VALUES ('legacy-income-protected','main','test-booking','test-invoice',3000,'payment','Legacy income',?,?)`).bind(now, now).run();
  await assert.rejects(
    patchBooking(db, 'main', 'test-booking', {
      paidHalalas: 3000, paymentMethod: 'cash', reconcilePayment: true,
    }),
    (error) => error?.status === 409 && error?.code === 'core_booking:payment_history_immutable',
  );
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 0);
  assert.equal((await table(db, "SELECT id FROM payments WHERE booking_id='test-booking'")).length, 0);
  const incomes = await table(db, "SELECT id, amount_halalas FROM income_entries WHERE booking_id='test-booking'");
  assert.deepEqual(incomes, [{ id: 'legacy-income-protected', amount_halalas: 3000 }]);
});


test('financial correction proposal is append-only intent, not money: reason, audit, replay, tenant fence', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'settled-proposal-payment', invoiceId: 'test-invoice',
    amountHalalas: 7000, method: 'card', idempotencyKey: 'settlement-proposal-key',
  });
  const snapshot = {
    invoice: await db.prepare("SELECT paid_halalas, status FROM invoices WHERE id='test-invoice'").first(),
    booking: await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first(),
    payment: await db.prepare("SELECT * FROM payments WHERE id='settled-proposal-payment'").first(),
    incomes: await table(db, "SELECT * FROM income_entries WHERE booking_id='test-booking'"),
  };
  const data = {
    paymentId: 'settled-proposal-payment',
    kind: 'amount_correction', proposedAmountHalalas: 5000,
    reason: 'Cashier entered incorrect collected amount',
    idempotencyKey: 'proposal-amount-key',
  };
  const actor = { uid: 'manager-a' };
  const proposal = await proposePaymentCorrection(db, 'main', data, actor);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.original_amount_halalas, 7000);
  assert.equal(proposal.proposed_amount_halalas, 5000);
  assert.equal(proposal.original_method, 'card');
  assert.equal(proposal.proposed_method, 'card');
  assert.equal(proposal.actor_uid, actor.uid);
  assert.equal(proposal.completed_refund_halalas, 0);
  assert.equal(proposal.booking_id, 'test-booking');
  const replay = await proposePaymentCorrection(db, 'main', data, actor);
  assert.equal(replay.id, proposal.id);
  assert.equal(replay.idempotent, true);
  await assert.rejects(
    proposePaymentCorrection(db, 'main', { ...data, proposedAmountHalalas: 4000 }, actor),
    (error) => error?.status === 409 && error?.code === 'core_payment_correction:idempotency_conflict',
  );
  await assert.rejects(
    proposePaymentCorrection(db, 'other-salon', data, actor),
    (error) => error?.status === 404 && error?.code === 'core_payment:not_found',
  );
  assert.deepEqual((await table(db, "SELECT id FROM payment_correction_proposals")).length, 1);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='payment_correction_proposed'")).length, 1);
  assert.deepEqual(await db.prepare("SELECT paid_halalas, status FROM invoices WHERE id='test-invoice'").first(), snapshot.invoice);
  assert.deepEqual(await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first(), snapshot.booking);
  assert.deepEqual(await db.prepare("SELECT * FROM payments WHERE id='settled-proposal-payment'").first(), snapshot.payment);
  assert.deepEqual(await table(db, "SELECT * FROM income_entries WHERE booking_id='test-booking'"), snapshot.incomes);
  assert.equal((await listPaymentCorrectionProposals(db, 'main', 'settled-proposal-payment')).length, 1);
  assert.equal((await listPaymentCorrectionProposals(db, 'other-salon', 'settled-proposal-payment')).length, 0);
});

test('method correction proposal preserves provider identity, settles nothing and validates changes', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'provider-method-payment', invoiceId: 'test-invoice',
    amountHalalas: 4000, method: 'card',
    provider: 'gateway', providerReference: 'transaction-original',
  });
  const actor = { uid: 'finance-manager' };
  const payload = {
    paymentId: 'provider-method-payment', kind: 'method_reclassification',
    proposedMethod: 'cash', reason: 'Payment mode was entered incorrectly',
    idempotencyKey: 'proposal-method-key',
  };
  const proposed = await proposePaymentCorrection(db, 'main', payload, actor);
  assert.equal(proposed.original_method, 'card');
  assert.equal(proposed.proposed_method, 'cash');
  assert.equal(proposed.proposed_amount_halalas, 4000);
  const payment = await db.prepare("SELECT method, provider, provider_reference FROM payments WHERE id='provider-method-payment'").first();
  assert.equal(payment.method, 'card');
  assert.equal(payment.provider, 'gateway');
  assert.equal(payment.provider_reference, 'transaction-original');
  const income = await db.prepare("SELECT method, amount_halalas FROM income_entries WHERE payment_id='provider-method-payment'").first();
  assert.equal(income.method, 'card');
  assert.equal(income.amount_halalas, 4000);
  await assert.rejects(
    proposePaymentCorrection(db, 'main', { ...payload, proposedMethod: 'card', idempotencyKey: 'no-op-method' }, actor),
    (error) => error?.code === 'core_payment_correction:no_change',
  );
  await assert.rejects(
    proposePaymentCorrection(db, 'main', { ...payload, proposedMethod: 'cryptocurrency', idempotencyKey: 'wrong-method' }, actor),
    (error) => error?.code === 'core_payment_correction:invalid_method',
  );
  await assert.rejects(
    proposePaymentCorrection(db, 'main', { ...payload, reason: 'short', idempotencyKey: 'short-reason' }, actor),
    (error) => error?.code === 'core_payment_correction:reason_required',
  );
});

test('refund-linked payment proposal snapshots refunded budget; cannot propose below completed refund', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'refund-proposal-payment', invoiceId: 'test-invoice', amountHalalas: 7000,
  });
  await createRefund(db, 'main', {
    id: 'linked-completed-refund', paymentId: 'refund-proposal-payment',
    amountHalalas: 3000, status: 'completed',
  });
  const actor = { uid: 'finance-manager' };
  const data = {
    paymentId: 'refund-proposal-payment', kind: 'amount_correction',
    reason: 'Correcting a cashier bookkeeping error', proposedAmountHalalas: 2000,
    idempotencyKey: 'below-refund-budget',
  };
  await assert.rejects(
    proposePaymentCorrection(db, 'main', data, actor),
    (error) => error?.status === 409 && error?.code === 'core_payment_correction:stale_payment_snapshot',
  );
  assert.equal((await table(db, "SELECT id FROM payment_correction_proposals")).length, 0);
  const safe = await proposePaymentCorrection(
    db, 'main', { ...data, proposedAmountHalalas: 4000, idempotencyKey: 'above-refund-budget' }, actor
  );
  assert.equal(safe.completed_refund_halalas, 3000);
  assert.equal(safe.proposed_amount_halalas, 4000);
  const persistedRefund = await db.prepare("SELECT payment_id,status,amount_halalas FROM refunds WHERE id='linked-completed-refund'").first();
  assert.equal(persistedRefund.payment_id, 'refund-proposal-payment');
  assert.equal(persistedRefund.status, 'completed');
  assert.equal(persistedRefund.amount_halalas, 3000);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 4000);
});

test('refund committed after proposal preflight is enforced by live D1 INSERT and leaves no audit', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'proposal-race-payment', invoiceId: 'test-invoice', amountHalalas: 7000,
  });
  let injected = false;
  const racingDb = {
    prepare: (...args) => db.prepare(...args),
    async batch(statements) {
      if (!injected) {
        injected = true;
        await createRefund(db, 'main', {
          id: 'refund-concurrent-proposal', paymentId: 'proposal-race-payment',
          amountHalalas: 5000, status: 'completed',
        });
      }
      return db.batch(statements);
    },
  };
  await assert.rejects(
    proposePaymentCorrection(racingDb, 'main', {
      paymentId: 'proposal-race-payment', kind: 'amount_correction',
      proposedAmountHalalas: 4000, reason: 'Correct refund snapshot must be enforced',
      idempotencyKey: 'concurrent-proposal-key',
    }, { uid: 'manager-a' }),
    (error) => error?.status === 409 && error?.code === 'core_payment_correction:stale_payment_snapshot',
  );
  assert.equal(injected, true);
  assert.equal((await table(db, 'SELECT id FROM payment_correction_proposals')).length, 0);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='payment_correction_proposed'")).length, 0);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 2000);
});

test('proposal audit failure rolls back proposal atomically', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'proposal-audit-payment', invoiceId: 'test-invoice',
    amountHalalas: 4000, method: 'cash',
  });
  await db.prepare(`CREATE TRIGGER proposal_audit_abort
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'payment_correction_proposed'
    BEGIN SELECT RAISE(ABORT, 'INJECTED_PROPOSAL_AUDIT_FAILURE'); END`).run();
  await assert.rejects(
    proposePaymentCorrection(db, 'main', {
      paymentId: 'proposal-audit-payment', kind: 'amount_correction',
      proposedAmountHalalas: 3000, reason: 'This audit must be atomic',
      idempotencyKey: 'audit-rollback-proposal-key',
    }, { uid: 'manager-a' }),
    /INJECTED_PROPOSAL_AUDIT_FAILURE/,
  );
  assert.equal((await table(db, 'SELECT id FROM payment_correction_proposals')).length, 0);
});

test('correction preflight projects amount delta without posting or modifying any financial record', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'impact-amount-payment', invoiceId: 'test-invoice',
    amountHalalas: 7000, method: 'cash',
  });
  const proposal = await proposePaymentCorrection(db, 'main', {
    paymentId: 'impact-amount-payment', kind: 'amount_correction',
    proposedAmountHalalas: 5000, reason: 'Correct cashier amount entry',
    idempotencyKey: 'impact-amount-idempotency',
  }, { uid: 'manager-a' });
  const before = {
    invoice: await db.prepare("SELECT * FROM invoices WHERE id='test-invoice'").first(),
    payment: await db.prepare("SELECT * FROM payments WHERE id='impact-amount-payment'").first(),
    incomes: await table(db, "SELECT * FROM income_entries WHERE booking_id='test-booking'"),
    audits: await table(db, "SELECT * FROM audit_logs"),
  };

  const preview = await previewPaymentCorrectionImpact(db, 'main', proposal.id);
  assert.equal(preview.eligibleForFurtherReview, true);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.amountDeltaHalalas, -2000);
  assert.equal(preview.invoiceBeforeHalalas, 7000);
  assert.equal(preview.projectedInvoiceAfterHalalas, 5000);
  assert.deepEqual(preview.paymentChannelDeltasHalalas, { cash: -2000, card: 0, transfer: 0 });
  assert.equal(preview.isReadOnly, true);
  assert.equal(preview.requiresAtomicWriteTimeRevalidation, true);
  assert.equal(preview.requiresAccountingPostingPolicy, true);
  assert.deepEqual(await db.prepare("SELECT * FROM invoices WHERE id='test-invoice'").first(), before.invoice);
  assert.deepEqual(await db.prepare("SELECT * FROM payments WHERE id='impact-amount-payment'").first(), before.payment);
  assert.deepEqual(await table(db, "SELECT * FROM income_entries WHERE booking_id='test-booking'"), before.incomes);
  assert.deepEqual(await table(db, "SELECT * FROM audit_logs"), before.audits);
});

test('method-only correction impact reallocates payment channel without changing net money', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'impact-method-payment', invoiceId: 'test-invoice',
    amountHalalas: 4000, method: 'card',
  });
  const proposal = await proposePaymentCorrection(db, 'main', {
    paymentId: 'impact-method-payment', kind: 'method_reclassification',
    proposedMethod: 'cash', reason: 'Wrong collection channel was selected',
    idempotencyKey: 'impact-method-idempotency',
  }, { uid: 'manager-a' });
  const impact = await previewPaymentCorrectionImpact(db, 'main', proposal.id);
  assert.equal(impact.eligibleForFurtherReview, true);
  assert.equal(impact.amountDeltaHalalas, 0);
  assert.equal(impact.projectedInvoiceAfterHalalas, 4000);
  assert.deepEqual(impact.paymentChannelDeltasHalalas, { cash: 4000, card: -4000, transfer: 0 });
  assert.equal((await db.prepare("SELECT method FROM payments WHERE id='impact-method-payment'").first()).method, 'card');
  assert.equal((await db.prepare("SELECT method FROM income_entries WHERE payment_id='impact-method-payment'").first()).method, 'card');
});

test('financial correction preflight flags new refunds and closed accounting days', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'impact-refund-payment', invoiceId: 'test-invoice',
    paidAt: '2026-11-27T22:00:00.000Z',
    amountHalalas: 7000, method: 'cash',
  });
  const proposal = await proposePaymentCorrection(db, 'main', {
    paymentId: 'impact-refund-payment', kind: 'amount_correction',
    proposedAmountHalalas: 4000, reason: 'Original amount was entered too high',
    idempotencyKey: 'impact-refund-idempotency',
  }, { uid: 'manager-a' });

  await createRefund(db, 'main', {
    id: 'impact-late-refund', paymentId: 'impact-refund-payment',
    amountHalalas: 5000, status: 'completed',
  });
  const income = await db.prepare("SELECT occurred_at FROM income_entries WHERE salon_id='main' AND payment_id='impact-refund-payment'").first();
  assert.ok(income, 'Committed income row must exist');

  function riyadhAccountingDate(value) {
    const date = new Date(value);

    assert.ok(
      Number.isFinite(date.getTime()),
      'Income timestamp must be valid'
    );

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date).map(
        part => [part.type, part.value]
      )
    );

    return parts.year + '-' +
      parts.month + '-' + parts.day;
  }

  assert.equal(
    riyadhAccountingDate('2026-11-27T20:59:59.000Z'),
    '2026-11-27'
  );

  assert.equal(
    riyadhAccountingDate('2026-11-27T21:00:00.000Z'),
    '2026-11-28'
  );

  assert.equal(
    new Date(income.occurred_at).toISOString(),
    '2026-11-27T22:00:00.000Z'
  );

  const auditDate = riyadhAccountingDate(
    income.occurred_at
  );

  assert.equal(auditDate,'2026-11-28');
  const ts = new Date().toISOString();
  await db.prepare(`INSERT INTO day_audit_closings
    (id, salon_id, audit_date, total_halalas, cash_halalas, card_halalas,
     transfer_halalas, manual_cash_halalas, cash_diff_halalas, closed_at, created_at)
    VALUES ('impact-day-closure', 'main', ?, 7000, 7000, 0, 0, 7000, 0, ?, ?)`)
    .bind(auditDate, ts, ts).run();

  const impact = await previewPaymentCorrectionImpact(db, 'main', proposal.id);
  assert.equal(impact.eligibleForFurtherReview, false);
  assert.ok(impact.blockers.includes('refund_snapshot_changed'));
  assert.ok(impact.blockers.includes('correction_below_completed_refunds'));
  assert.ok(impact.blockers.includes('accounting_day_already_closed'));
  assert.equal(impact.completedRefundHalalas, 5000);
  assert.equal(impact.invoiceBeforeHalalas, 2000);
  assert.equal(impact.projectedInvoiceAfterHalalas, -1000);
  assert.ok(impact.blockers.includes('invoice_balance_conflict'));
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 2000);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM payment_correction_proposals").first()).n, 1);
});

test('financial impact preview rejects external provider and source-income mismatch, and isolates tenants', async (t) => {
  const db = await setup(t);
  await createPayment(db, 'main', {
    id: 'impact-provider-payment', invoiceId: 'test-invoice', amountHalalas: 6000,
    method: 'card', provider: 'external-gateway', providerReference: 'original-provider-ref',
  });
  const proposal = await proposePaymentCorrection(db, 'main', {
    paymentId: 'impact-provider-payment', kind: 'method_reclassification',
    proposedMethod: 'cash', reason: 'External payment channel needs investigation',
    idempotencyKey: 'impact-provider-idempotency',
  }, { uid: 'manager-a' });
  await db.prepare("UPDATE income_entries SET method = 'cash' WHERE payment_id = 'impact-provider-payment'").run();

  const impact = await previewPaymentCorrectionImpact(db, 'main', proposal.id);
  assert.equal(impact.eligibleForFurtherReview, false);
  assert.ok(impact.blockers.includes('external_provider_requires_reconciliation'));
  assert.ok(impact.blockers.includes('income_ledger_mismatch'));
  await assert.rejects(
    previewPaymentCorrectionImpact(db, 'another-salon', proposal.id),
    (error) => error?.status === 404 && error?.code === 'core_payment_correction:not_found',
  );
});


test('completed booking staff reassignment leaves settled ledger unchanged', async (t) => {
  const db = await setup(t);
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO services
    (id,salon_id,name,duration_minutes,price_halalas,active,created_at,updated_at)
    VALUES ('eyeliner-service','main','Eyeliner',60,10000,1,?,?)`)
    .bind(now, now).run();
  await db.prepare(`INSERT INTO booking_items
    (id,booking_id,salon_id,service_id,service_name_snapshot,
     staff_id,quantity,unit_price_halalas,total_halalas,duration_minutes,
     booking_date,start_time,end_time,created_at)
    VALUES ('eyeliner-item','test-booking','main','eyeliner-service','Eyeliner',
     'employee-old',1,10000,10000,60,'2026-10-10','09:00','10:00',?)`)
    .bind(now).run();
  await createPayment(db, 'main', {
    id: 'eyeliner-settlement',
    invoiceId: 'test-invoice',
    amountHalalas: 10000,
    method: 'transfer',
    status: 'paid',
  });
  await db.prepare("UPDATE bookings SET status = 'completed' WHERE salon_id = 'main' AND id = 'test-booking'").run();

  const paymentsBefore = await table(db, "SELECT id, amount_halalas, method FROM payments WHERE booking_id = 'test-booking'");
  const incomeBefore = await table(db, "SELECT id, amount_halalas, method FROM income_entries WHERE booking_id = 'test-booking'");
  const invoiceBefore = await db.prepare("SELECT paid_halalas, status FROM invoices WHERE id = 'test-invoice'").first();

  await patchBooking(db, 'main', 'test-booking', {
    staffId: 'employee-new',
    serviceId: 'eyeliner-service',
  }, { uid: 'admin' });

  const item = await db.prepare("SELECT staff_id FROM booking_items WHERE id = 'eyeliner-item'").first();
  assert.equal(item.staff_id, 'employee-new');
  const paymentAfter = await table(db, "SELECT id, amount_halalas, method FROM payments WHERE booking_id = 'test-booking'");
  const incomeAfter = await table(db, "SELECT id, amount_halalas, method FROM income_entries WHERE booking_id = 'test-booking'");
  const invoiceAfter = await db.prepare("SELECT paid_halalas, status FROM invoices WHERE id = 'test-invoice'").first();
  assert.deepEqual(paymentAfter, paymentsBefore);
  assert.deepEqual(incomeAfter, incomeBefore);
  assert.deepEqual(invoiceAfter, invoiceBefore);
  const booking = await db.prepare("SELECT status, payment_status FROM bookings WHERE id = 'test-booking'").first();
  assert.equal(booking.status, 'completed');
  assert.equal(booking.payment_status, 'paid');
});

async function f41Setup(t) {
  const db = await setup(t);

  const base = await readFile(
    new URL(
      "../migrations/core/0056_core_request_idempotency.sql",
      import.meta.url
    ),
    "utf8"
  );

  for (const statement of base
    .split(";")
    .map(value => value.trim())
    .filter(Boolean)) {
    await db.prepare(statement).run();
  }

  const ownership = await readFile(
    new URL(
      "../migrations/core/0122_idempotency_execution_ownership.sql",
      import.meta.url
    ),
    "utf8"
  );

  const sql = ownership
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith("--"))
    .join("\n")
    .trim();

  const alterEnd = sql.indexOf(";");

  assert.ok(alterEnd > 0);

  await db.prepare(
    sql.slice(0, alterEnd)
  ).run();

  await db.prepare(
    sql.slice(alterEnd + 1).trim()
  ).run();

  const executionContext = {
    salonId: "main",
    operationId: "f41-http-operation",
    fingerprint: "f41-request-fingerprint",
    requestId: "f41-request",
    executionToken: "f41-owner",
    actorUid: "f41-actor",
  };

  const actor = {
    uid: "f41-actor",
    role: "owner",
  };

  const input = {
    id: "f41-payment",
    invoiceId: "test-invoice",
    amountHalalas: 7500,
    method: "cash",
    status: "paid",
    idempotencyKey: "f41-domain-payment",
    paidAt: "2026-11-27T15:00:00.000Z",
  };

  const gate = await beginIdempotentOperation(
    db,
    executionContext.salonId,
    executionContext.operationId,
    executionContext.fingerprint,
    executionContext.requestId,
    executionContext.executionToken
  );

  assert.equal(gate.action, "proceed");

  return {
    db,
    executionContext,
    actor,
    input,
  };
}

async function f41Snapshot(db) {
  const result = {};

  for (const tableName of [
    "payments",
    "income_entries",
    "invoices",
    "bookings",
    "audit_logs",
    "cashback_wallet_transactions",
    "core_idempotency_operations",
  ]) {
    const rows = await db.prepare(
      "SELECT * FROM " + tableName
    ).all();

    result[tableName] = rows.results
      .map(row => JSON.stringify(row))
      .sort();
  }

  return result;
}

async function f41Replay(f) {
  return beginIdempotentOperation(
    f.db,
    f.executionContext.salonId,
    f.executionContext.operationId,
    f.executionContext.fingerprint,
    "f41-retry",
    "f41-new-owner"
  );
}

test("B04 F41 real D1 payment commits exact completion evidence", async t => {
  const f = await f41Setup(t);

  const result = await createPayment(
    f.db,
    "main",
    f.input,
    f.actor,
    f.executionContext
  );

  const gate = await f41Replay(f);

  assert.equal(gate.action, "replay");
  assert.equal(gate.status, 200);

  assert.deepEqual(
    JSON.parse(gate.responseBody),
    {ok:true,data:result}
  );

  assert.equal(result.amount_halalas,7500);
  assert.equal(result.id,"f41-payment");

  assert.equal(
    (await f.db.prepare(
      "SELECT paid_halalas FROM invoices WHERE id='test-invoice'"
    ).first()).paid_halalas,
    7500
  );

  for (const name of [
    "payments",
    "income_entries",
  ]) {
    assert.equal(
      (await f.db.prepare(
        "SELECT COUNT(*) AS n FROM " + name
      ).first()).n,
      1
    );
  }
});

test("B04 F41 stale execution owner rolls back actual money and audit", async t => {
  const f = await f41Setup(t);
  const before = await f41Snapshot(f.db);

  await assert.rejects(
    createPayment(
      f.db,
      "main",
      f.input,
      f.actor,
      {
        ...f.executionContext,
        executionToken:"stale-owner"
      }
    ),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(
    await f41Snapshot(f.db),
    before
  );
});

test("B04 F41 wrong fingerprint rolls back actual money and audit", async t => {
  const f = await f41Setup(t);
  const before = await f41Snapshot(f.db);

  await assert.rejects(
    createPayment(
      f.db,
      "main",
      f.input,
      f.actor,
      {
        ...f.executionContext,
        fingerprint:"wrong-fingerprint"
      }
    ),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(
    await f41Snapshot(f.db),
    before
  );
});

for (const [label, overrides] of [
  ["tenant",{salonId:"another-salon"}],
  ["actor",{actorUid:"another-actor"}],
]) {
  test("B04 F41 execution identity rejects " + label, async t => {
    const f = await f41Setup(t);
    const before = await f41Snapshot(f.db);

    await assert.rejects(
      createPayment(
        f.db,
        "main",
        f.input,
        f.actor,
        {
          ...f.executionContext,
          ...overrides
        }
      ),
      error =>
        error?.code ===
        "core_payment:execution_identity_conflict"
    );

    assert.deepEqual(
      await f41Snapshot(f.db),
      before
    );
  });
}

test("B04 F41 failed evidence write rolls back real payment transaction", async t => {
  const f = await f41Setup(t);

  await f.db.prepare(
    "CREATE TRIGGER f41_fail_completion " +
    "BEFORE UPDATE OF state ON core_idempotency_operations " +
    "WHEN NEW.state='completed' BEGIN " +
    "SELECT RAISE(ABORT,'f41_completion_fault'); END;"
  ).run();

  const before = await f41Snapshot(f.db);

  await assert.rejects(
    createPayment(
      f.db,
      "main",
      f.input,
      f.actor,
      f.executionContext
    ),
    /f41_completion_fault/
  );

  assert.deepEqual(
    await f41Snapshot(f.db),
    before
  );
});

test("B04 F41 failed income write leaves HTTP operation pending", async t => {
  const f = await f41Setup(t);

  await f.db.prepare(
    "CREATE TRIGGER f41_fail_income " +
    "BEFORE INSERT ON income_entries BEGIN " +
    "SELECT RAISE(ABORT,'f41_income_fault'); END;"
  ).run();

  const before = await f41Snapshot(f.db);

  await assert.rejects(
    createPayment(
      f.db,
      "main",
      f.input,
      f.actor,
      f.executionContext
    ),
    /f41_income_fault/
  );

  assert.deepEqual(
    await f41Snapshot(f.db),
    before
  );

  assert.equal(
    (await f41Replay(f)).action,
    "in_progress"
  );
});

test("B04 F41 historical payment cannot impersonate a new HTTP commit", async t => {
  const f = await f41Setup(t);

  await createPayment(
    f.db,
    "main",
    f.input,
    f.actor
  );

  const before = await f41Snapshot(f.db);

  await assert.rejects(
    createPayment(
      f.db,
      "main",
      f.input,
      f.actor,
      f.executionContext
    ),
    error =>
      error?.code ===
      "core_payment:existing_operation_requires_verification"
  );

  assert.deepEqual(
    await f41Snapshot(f.db),
    before
  );
});

test("B04 F41 lost response cannot produce a second financial effect", async t => {
  const f = await f41Setup(t);

  await createPayment(
    f.db,
    "main",
    f.input,
    f.actor,
    f.executionContext
  );

  const gate = await f41Replay(f);

  assert.equal(gate.action,"replay");

  const before = await f41Snapshot(f.db);

  await assert.rejects(
    createPayment(
      f.db,
      "main",
      {
        ...f.input,
        id:"second-payment",
        idempotencyKey:"second-domain-key",
      },
      f.actor,
      f.executionContext
    ),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(
    await f41Snapshot(f.db),
    before
  );
});


const directory = "migrations/core";

const migrations = readdirSync(directory)
  .filter(name => /^\d+.*\.sql$/.test(name))
  .sort();

async function f431FullSchema(t) {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'package-sale-test', compatibilityDate: '2026-06-24',
    manifest: {
      mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
      modules: { 'script-0.mjs': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' } },
    },
    env: { CORE_DB: { type: 'd1', id: 'package-sale-test' } }, exports: {},
  }, dev: { rootPath: process.cwd() } }] });

  t.after(async () => {
    await mf.dispose();
  });

  const db = await mf.getD1Database("CORE_DB");

  const sqlite = await import("node:sqlite");
  const parser = new sqlite.DatabaseSync(":memory:");

  try {
    for (const name of migrations) {
      const sql = readFileSync(
        `${directory}/${name}`,
        "utf8"
      );

      // SQLite executes full migration files, including triggers.
      // Miniflare receives the resulting local schema below.
      try {
        parser.exec(sql);
      } catch (error) {
        throw new Error(
          `Migration ${name}: ${error.message}`
        );
      }
    }

    const schema = parser.prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE sql IS NOT NULL
        AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type
        WHEN 'table' THEN 1
        WHEN 'index' THEN 2
        WHEN 'view' THEN 3
        WHEN 'trigger' THEN 4
        ELSE 5
      END, rowid
    `).all();

    for (const row of schema) {
      try {
        await db.prepare(row.sql).run();
      } catch (error) {
        throw new Error(
          `Miniflare schema ${row.name}: ${error.message}`
        );
      }
    }

    for (const table of [
      "roles",
      "permissions",
      "role_permissions"
    ]) {
      const records = parser.prepare(
        "SELECT * FROM " + table
      ).all();

      for (const row of records) {
        const fields = Object.keys(row);

        await db.prepare(
          "INSERT INTO " + table +
          " (" + fields.join(",") + ") VALUES (" +
          fields.map(() => "?").join(",") + ")"
        ).bind(
          ...fields.map(field => row[field])
        ).run();
      }
    }

  } finally {
    parser.close();
  }

  return db;
}

async function f43Setup(t) {
  const db = await f431FullSchema(t);

  const seedTime = "2026-10-10T08:00:00.000Z";

  await db.prepare(
    "INSERT INTO clients " +
    "(id,salon_id,name,status,created_at,updated_at) " +
    "VALUES ('test-client','main','Test Client','active',?,?)"
  ).bind(seedTime,seedTime).run();

  await db.prepare(`
    INSERT INTO bookings
      (id,salon_id,client_id,booking_date,start_time,
       end_time,status,source,subtotal_halalas,
       discount_halalas,total_halalas,payment_status,
       package_sessions_used,created_at,updated_at)
    VALUES
      ('test-booking','main','test-client',
       '2026-10-10','09:00','10:00',
       'booked','internal',10000,0,10000,
       'unpaid',0,?,?)
  `).bind(seedTime,seedTime).run();

  await db.prepare(`
    INSERT INTO invoices
      (id,salon_id,booking_id,client_id,
       subtotal_halalas,total_halalas,discount_halalas,
       paid_halalas,status,issued_at,created_at,updated_at)
    VALUES
      ('test-invoice','main','test-booking','test-client',
       10000,10000,0,0,'unpaid',?,?,?)
  `).bind(seedTime,seedTime,seedTime).run();

  const f = {
    db,
    input: {
      id:"f41-payment",
      invoiceId:"test-invoice",
      amountHalalas:7500,
      method:"cash",
      status:"paid",
      idempotencyKey:"f41-domain-payment",
      paidAt:"2026-11-27T15:00:00.000Z"
    }
  };

  for (const table of [
    "employee_profiles",
    "app_users",
    "user_employee_links",
    "roles",
    "permissions",
    "role_permissions",
    "user_permissions",
    "core_idempotency_operations"
  ]) {
    const row = await db.prepare(
      "SELECT name FROM sqlite_master " +
      "WHERE type='table' AND name=?"
    ).bind(table).first();

    assert.ok(row,"Missing canonical schema: "+table);
  }


  const now = "2026-11-27T12:00:00.000Z";

  for (const [id,uid,role] of [
    ["f43-owner-account","f43-owner","owner"],
    ["f43-admin-account","f43-admin","admin"],
    ["f43-client-account","f43-client","client"],
  ]) {
    await f.db.prepare(`
      INSERT INTO app_users (
        id, salon_id, firebase_uid, email,
        display_name, primary_role, status,
        email_verified, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,'active',1,?,?)
    `).bind(
      id,
      "main",
      uid,
      uid+"@example.test",
      uid,
      role,
      now,
      now
    ).run();
  }

  return f;
}

async function f43Request(
  f,
  {
    token = "test:f43-owner:owner",
    key = "f43-http-key",
    input = f.input,
    db = f.db,
    tenant = "main",
  } = {}
) {
  const {default: worker} =
    await import("./core/index.js");

  const headers = {
    "Content-Type":"application/json",
    "Idempotency-Key":key,
  };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await worker.fetch(
    new Request("https://worker.test/api/core/payments",{
      method:"POST",
      headers,
      body:JSON.stringify(input),
    }),
    {
      CORE_DB:db,
      SALON_ID:tenant,
      FIREBASE_PROJECT_ID:"payment-runtime-test",
      PACKAGES_AUTH_TEST_MODE:"true",
    }
  );

  return {
    status:response.status,
    body:await response.json(),
  };
}

async function f43Money(db) {
  const all = await f41Snapshot(db);

  delete all.core_idempotency_operations;

  return all;
}

async function f43Operation(f) {
  return f.db.prepare(
    "SELECT * FROM core_idempotency_operations " +
    "WHERE salon_id=? AND operation_id=?"
  ).bind(
    "main","f43-http-key"
  ).first();
}

test("B04 F43 actual HTTP payment commits and replays exact result", async t => {
  const f = await f43Setup(t);

  const first = await f43Request(f);

  assert.equal(
    first.status,200,JSON.stringify(first.body)
  );

  assert.equal(first.body.data.id,"f41-payment");
  assert.equal(first.body.data.amount_halalas,7500);

  const before = await f43Money(f.db);

  const replay = await f43Request(f);

  assert.deepEqual(replay,first);
  assert.deepEqual(await f43Money(f.db),before);

  const operation = await f43Operation(f);

  assert.equal(operation.state,"completed");

  assert.deepEqual(
    JSON.parse(operation.response_body),
    first.body
  );
});

test("B04 F43 changed HTTP payload cannot reuse payment key", async t => {
  const f = await f43Setup(t);

  assert.equal((await f43Request(f)).status,200);

  const before = await f43Money(f.db);

  const changed = await f43Request(f,{
    input:{...f.input,amountHalalas:7600}
  });

  assert.equal(changed.status,409);
  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 another authorized actor cannot replay payment", async t => {
  const f = await f43Setup(t);

  assert.equal((await f43Request(f)).status,200);

  const before = await f43Money(f.db);

  const changed = await f43Request(f,{
    token:"test:f43-admin:admin"
  });

  assert.equal(changed.status,409);
  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 unauthenticated replay is denied", async t => {
  const f = await f43Setup(t);

  assert.equal((await f43Request(f)).status,200);

  const before = await f43Money(f.db);

  assert.equal(
    (await f43Request(f,{token:null})).status,
    401
  );

  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 client cannot read committed payment replay", async t => {
  const f = await f43Setup(t);

  assert.equal((await f43Request(f)).status,200);

  const before = await f43Money(f.db);

  assert.equal(
    (await f43Request(f,{
      token:"test:f43-client:client"
    })).status,
    403
  );

  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 replay observes live account role changes", async t => {
  const f = await f43Setup(t);

  assert.equal((await f43Request(f)).status,200);

  await f.db.prepare(
    "UPDATE app_users SET primary_role='client' " +
    "WHERE salon_id='main' AND id='f43-owner-account'"
  ).run();

  const before = await f43Money(f.db);

  assert.equal(
    (await f43Request(f)).status,
    403
  );

  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 conflicting tenant aliases cannot reach payment batch", async t => {
  const f = await f43Setup(t);

  const before = await f43Money(f.db);

  const result = await f43Request(f,{
    input:{
      ...f.input,
      salonId:"main",
      salon_id:"another-tenant"
    }
  });

  assert.ok(
    [400,403,409].includes(result.status),
    JSON.stringify(result)
  );

  assert.equal(await f43Operation(f),null);
  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 malformed HTTP operation IDs fail without financial writes", async t => {
  const f = await f43Setup(t);

  const before = await f43Money(f.db);

  for (const key of ["","bad operation","x".repeat(129)]) {

    const response = await f43Request(f,{key});

    assert.equal(
      response.status,400,JSON.stringify(response)
    );
  }

  assert.deepEqual(await f43Money(f.db),before);
});

test("B04 F43 concurrent identical HTTP payments commit money once", async t => {
  const f = await f43Setup(t);

  const results = await Promise.all(
    Array.from({length:6},()=>f43Request(f))
  );

  assert.ok(results.some(item=>item.status===200));

  assert.ok(
    results.every(item=>[200,409].includes(item.status)),
    JSON.stringify(results)
  );

  const replay = await f43Request(f);

  assert.equal(replay.status,200);

  for (const table of ["payments","income_entries"]) {
    assert.equal(
      (await f.db.prepare(
        "SELECT COUNT(*) AS n FROM "+table
      ).first()).n,
      1
    );
  }

  assert.equal(
    (await f.db.prepare(
      "SELECT paid_halalas FROM invoices WHERE id='test-invoice'"
    ).first()).paid_halalas,
    7500
  );
});

test("B04 F43 failed atomic evidence leaves HTTP payment pending without money", async t => {
  const f = await f43Setup(t);

  await f.db.prepare(
    "CREATE TRIGGER f43_completion_fault " +
    "BEFORE UPDATE OF state ON core_idempotency_operations " +
    "WHEN NEW.state='completed' BEGIN " +
    "SELECT RAISE(ABORT,'f43_completion_fault'); END;"
  ).run();

  const before = await f43Money(f.db);

  const failed = await f43Request(f);

  assert.equal(failed.status,500);

  assert.equal((await f43Operation(f)).state,"pending");
  assert.deepEqual(await f43Money(f.db),before);

  const retry = await f43Request(f);

  assert.equal(retry.status,409);
  assert.deepEqual(await f43Money(f.db),before);
});


async function f44Setup(t) {
  const f = await f43Setup(t);

  const payment = await createPayment(
    f.db,"main",f.input,{uid:"f44-owner",role:"owner"}
  );

  const actor = {uid:"f44-owner",role:"owner"};

  const context = {
    salonId:"main",
    operationId:"f44-operation",
    fingerprint:"f44-fingerprint",
    requestId:"f44-request",
    executionToken:"f44-execution-owner",
    actorUid:actor.uid
  };

  const gate = await beginIdempotentOperation(
    f.db,"main",context.operationId,
    context.fingerprint,context.requestId,
    context.executionToken
  );

  assert.equal(gate.action,"proceed");

  return {
    ...f,payment,actor,context,
    refundInput:{
      id:"f44-refund",
      paymentId:payment.id,
      amountHalalas:2500,
      method:"cash",
      reason:"Local atomic refund test",
      status:"completed",
      idempotencyKey:"f44-domain-key",
      refundedAt:"2026-11-27T16:00:00.000Z"
    }
  };
}

async function f44Snapshot(db) {
  const result = await f41Snapshot(db);
  for(const table of ["refunds","expense_entries"]) {
    const rows = await db.prepare(
      "SELECT * FROM "+table
    ).all();
    result[table] = rows.results.map(
      row=>JSON.stringify(row)
    ).sort();
  }
  return result;
}

async function f44Refund(f,input={},context={}) {
  return createRefund(
    f.db,"main",
    {...f.refundInput,...input},
    f.actor,
    {...f.context,...context}
  );
}

test("B04 F44 atomic refund records exact completion evidence",async t=>{
  const f = await f44Setup(t);

  const result = await f44Refund(f);

  assert.equal(result.amount_halalas,2500);

  const operation = await f.db.prepare(
    "SELECT * FROM core_idempotency_operations WHERE salon_id=? AND operation_id=?"
  ).bind("main",f.context.operationId).first();

  assert.equal(operation.state,"completed");

  assert.deepEqual(
    JSON.parse(operation.response_body),
    {ok:true,data:result}
  );

  const invoice = await f.db.prepare(
    "SELECT paid_halalas FROM invoices WHERE salon_id='main' AND id='test-invoice'"
  ).first();

  assert.equal(invoice.paid_halalas,5000);

  assert.equal(
    (await f.db.prepare(
      "SELECT COUNT(*) AS n FROM refunds"
    ).first()).n,
    1
  );
});

for (const [label,input] of [
  ["foreign invoice",{invoiceId:"foreign"}],
  ["foreign client",{clientId:"foreign"}],
  ["foreign booking",{bookingId:"foreign"}],
  ["conflicting payment alias",{payment_id:"foreign"}],
  ["conflicting amount",{amount_halalas:2600}],
  ["foreign tenant",{salonId:"foreign"}]
]) {
  test("B04 F44 rejects "+label+" without mutation",async t=>{
    const f = await f44Setup(t);
    const before = await f44Snapshot(f.db);

    await assert.rejects(
      f44Refund(f,input),
      error=>error?.code==="core_refund:reference_conflict"
    );

    assert.deepEqual(await f44Snapshot(f.db),before);
  });
}

test("B04 F44 wrong execution owner rolls back all money",async t=>{
  const f = await f44Setup(t);
  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f,{},{
      executionToken:"wrong-owner"
    }),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(await f44Snapshot(f.db),before);
});

test("B04 F44 completion fault rolls back all money",async t=>{
  const f = await f44Setup(t);

  await f.db.prepare(
    "CREATE TRIGGER f44_fault "+
    "BEFORE UPDATE OF state ON core_idempotency_operations "+
    "WHEN NEW.state='completed' BEGIN "+
    "SELECT RAISE(ABORT,'f44_completion_fault'); END;"
  ).run();

  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f),
    /f44_completion_fault/
  );

  assert.deepEqual(await f44Snapshot(f.db),before);
});

test("B04 F44 completed execution cannot refund twice",async t=>{
  const f = await f44Setup(t);
  await f44Refund(f);

  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f,{
      id:"f44-second",
      idempotencyKey:"f44-second-domain"
    }),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(await f44Snapshot(f.db),before);
});


for (const status of ["pending","failed","cancelled"]) {
  test("B04 F451 rejects unsettled payment "+status,async t=>{
    const f = await f44Setup(t);

    await f.db.prepare(
      "UPDATE payments SET status=? WHERE salon_id=? AND id=?"
    ).bind(status,"main",f.payment.id).run();

    const before = await f44Snapshot(f.db);

    await assert.rejects(
      f44Refund(f),
      error=>error?.code==="core_refund:payment_not_settled"
    );

    assert.deepEqual(
      await f44Snapshot(f.db),
      before
    );
  });
}

test("B04 F451 rejects refund above original payment",async t=>{
  const f = await f44Setup(t);
  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f,{amountHalalas:7501}),
    error=>error?.code==="core_refund:amount_exceeds_payment"
  );

  assert.deepEqual(
    await f44Snapshot(f.db),
    before
  );
});

test("B04 F451 rejects refund exceeding remaining payment budget",async t=>{
  const f = await f44Setup(t);

  await createRefund(
    f.db,
    "main",
    {
      ...f.refundInput,
      id:"f451-prior-refund",
      idempotencyKey:"f451-prior-domain",
      amountHalalas:6000
    },
    f.actor
  );

  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f),
    error=>error?.code==="core_refund:amount_exceeds_remaining"
  );

  assert.deepEqual(
    await f44Snapshot(f.db),
    before
  );
});

test("B04 F451 historical refund is not new atomic evidence",async t=>{
  const f = await f44Setup(t);

  await createRefund(
    f.db,
    "main",
    f.refundInput,
    f.actor
  );

  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f),
    error=>error?.code===
      "core_refund:existing_operation_requires_verification"
  );

  assert.deepEqual(
    await f44Snapshot(f.db),
    before
  );
});

test("B04 F451 rejects execution actor mismatch",async t=>{
  const f = await f44Setup(t);
  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f,{},{
      actorUid:"foreign-actor"
    }),
    error=>error?.code==="core_refund:execution_identity_conflict"
  );

  assert.deepEqual(
    await f44Snapshot(f.db),
    before
  );
});

test("B04 F451 rejects execution tenant mismatch",async t=>{
  const f = await f44Setup(t);
  const before = await f44Snapshot(f.db);

  await assert.rejects(
    f44Refund(f,{},{
      salonId:"foreign-tenant"
    }),
    error=>error?.code==="core_refund:execution_identity_conflict"
  );

  assert.deepEqual(
    await f44Snapshot(f.db),
    before
  );
});

test("B04 F451 live settlement status guard aborts stale preflight",async t=>{
  const f = await f44Setup(t);

  const realDb = f.db;

  let intercepted = false;

  const db = {
    prepare: realDb.prepare.bind(realDb),
    async batch(statements) {
      if (!intercepted) {
        intercepted = true;

        await realDb.prepare(
          "UPDATE payments SET status='failed' "+
          "WHERE salon_id=? AND id=?"
        ).bind("main",f.payment.id).run();
      }

      return realDb.batch(statements);
    }
  };

  const before = await f44Snapshot(realDb);

  await assert.rejects(
    createRefund(
      db,
      "main",
      f.refundInput,
      f.actor,
      f.context
    ),
    error=>error?.code==="core_refund:amount_exceeds_remaining"
  );

  assert.equal(intercepted,true);

  const after = await f44Snapshot(realDb);

  // The intentional external status transition is the
  // only allowed change.

  delete before.payments;
  delete after.payments;

  assert.deepEqual(after,before);

  assert.equal(
    (await realDb.prepare(
      "SELECT COUNT(*) AS n FROM refunds"
    ).first()).n,
    0
  );
});

test("B04 F451 atomic concurrent refunds preserve the live budget",async t=>{
  const f = await f44Setup(t);

  const second = {
    ...f.context,
    operationId:"f451-second-operation",
    fingerprint:"f451-second-fingerprint",
    requestId:"f451-second-request",
    executionToken:"f451-second-owner"
  };

  const gate = await beginIdempotentOperation(
    f.db,
    "main",
    second.operationId,
    second.fingerprint,
    second.requestId,
    second.executionToken
  );

  assert.equal(gate.action,"proceed");

  const results = await Promise.allSettled([
    f44Refund(f,{amountHalalas:5000}),
    createRefund(
      f.db,
      "main",
      {
        ...f.refundInput,
        id:"f451-second-refund",
        idempotencyKey:"f451-second-domain",
        amountHalalas:5000
      },
      f.actor,
      second
    )
  ]);

  assert.equal(
    results.filter(r=>r.status==="fulfilled").length,
    1
  );

  assert.equal(
    results.filter(r=>r.status==="rejected").length,
    1
  );

  const refunds = await f.db.prepare(
    "SELECT COUNT(*) AS n,SUM(amount_halalas) AS total "+
    "FROM refunds WHERE salon_id='main'"
  ).first();

  assert.equal(refunds.n,1);
  assert.equal(refunds.total,5000);

  const invoice = await f.db.prepare(
    "SELECT paid_halalas FROM invoices "+
    "WHERE salon_id='main' AND id='test-invoice'"
  ).first();

  assert.equal(invoice.paid_halalas,2500);

  const completed = await f.db.prepare(
    "SELECT COUNT(*) AS n "+
    "FROM core_idempotency_operations "+
    "WHERE salon_id='main' AND state='completed'"
  ).first();

  assert.equal(completed.n,1);
});


async function f452Setup(t) {
  const f = await f44Setup(t);
  return f;
}

async function f452Request(f,{
  token="test:f43-owner:owner",
  key="f452-http",
  input=f.refundInput
}={}) {
  const headers = {
    "Content-Type":"application/json"
  };

  if (token != null) {
    headers.Authorization = "Bearer "+token;
  }

  if (key != null) {
    headers["Idempotency-Key"] = key;
  }

  const request = new Request(
    "https://local.test/api/core/refunds",
    {
      method:"POST",
      headers,
      body:JSON.stringify(input)
    }
  );

  const {default: worker} = await import("./core/index.js");
  const response = await worker.fetch(request,{
    CORE_DB:f.db,
    SALON_ID:"main",
    FIREBASE_PROJECT_ID:"payment-runtime-test",
    PACKAGES_AUTH_TEST_MODE:"true"
  });

  return {
    status:response.status,
    body:await response.json()
  };
}

async function f452Money(db) {
  const state = await f44Snapshot(db);
  delete state.core_idempotency_operations;
  return state;
}

test("B04 F452 actual refund HTTP commits and replays exact response",async t=>{
  const f = await f452Setup(t);

  const first = await f452Request(f);
  assert.equal(first.status,200,JSON.stringify(first.body));

  const retry = await f452Request(f);
  assert.equal(retry.status,200,JSON.stringify(retry.body));
  assert.deepEqual(retry.body,first.body);
  const evidence = await f.db.prepare("SELECT state,response_body FROM core_idempotency_operations WHERE salon_id=? AND operation_id=?").bind("main","f452-http").first();
  assert.equal(evidence.state,"completed");
  assert.deepEqual(JSON.parse(evidence.response_body),first.body);

  const refunds = await f.db.prepare(
    "SELECT COUNT(*) AS n,SUM(amount_halalas) AS total FROM refunds"
  ).first();

  assert.equal(refunds.n,1);
  assert.equal(refunds.total,2500);

  const invoice = await f.db.prepare(
    "SELECT paid_halalas FROM invoices WHERE id='test-invoice'"
  ).first();

  assert.equal(invoice.paid_halalas,5000);
});

test("B04 F452 changed amount rejects reuse",async t=>{
  const f = await f452Setup(t);

  assert.equal((await f452Request(f)).status,200);

  const before = await f452Money(f.db);

  const retry = await f452Request(f,{
    input:{...f.refundInput,amountHalalas:3000}
  });

  assert.equal(retry.status,409);
  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 another authorized actor cannot replay",async t=>{
  const f = await f452Setup(t);
  const now = "2026-11-27T12:00:00.000Z";
  await f.db.prepare(
    "INSERT INTO app_users (id,salon_id,firebase_uid,email,display_name,primary_role,status,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)"
  ).bind("f452-other-owner-account","main","f452-other-owner",
    "f452-other-owner@example.test","Second test owner","owner",now,now).run();

  assert.equal((await f452Request(f)).status,200);
  const before = await f452Money(f.db);
  const token = "test:f452-other-owner:owner";
  const retry = await f452Request(f,{token});
  assert.equal(retry.status,409,JSON.stringify(retry.body));
  assert.deepEqual(await f452Money(f.db),before);

  // Positive control: the second actor is genuinely authorized.
  const own = await f452Request(f,{
    token,key:"f452-other-owner-operation",
    input:{...f.refundInput,id:"f452-other-owner-refund",
      idempotencyKey:"f452-other-owner-domain",amountHalalas:100}
  });
  assert.equal(own.status,200,JSON.stringify(own.body));
  assert.equal(own.body.data.created_by_uid,"f452-other-owner");
  const totals = await f.db.prepare(
    "SELECT COUNT(*) AS n,SUM(amount_halalas) AS total FROM refunds WHERE salon_id='main'"
  ).first();
  assert.equal(totals.n,2);
  assert.equal(totals.total,2600);
});

test("B04 F452 actor without finance permission cannot replay or create",async t=>{
  const f = await f452Setup(t);
  assert.equal((await f452Request(f)).status,200);
  const before = await f452Money(f.db);
  const token = "test:f43-admin:admin";
  const replay = await f452Request(f,{token});
  assert.equal(replay.status,403,JSON.stringify(replay.body));
  const fresh = await f452Request(f,{
    token,key:"f452-admin-denied",
    input:{...f.refundInput,id:"f452-admin-refund",idempotencyKey:"f452-admin-domain"}
  });
  assert.equal(fresh.status,403,JSON.stringify(fresh.body));
  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 anonymous actor cannot replay",async t=>{
  const f = await f452Setup(t);

  assert.equal((await f452Request(f)).status,200);

  const before = await f452Money(f.db);

  assert.equal(
    (await f452Request(f,{token:null})).status,
    401
  );

  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 client cannot replay financial evidence",async t=>{
  const f = await f452Setup(t);

  assert.equal((await f452Request(f)).status,200);

  const before = await f452Money(f.db);

  assert.equal(
    (await f452Request(f,{
      token:"test:f43-client:client"
    })).status,
    403
  );

  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 invalid keys cannot debit money",async t=>{
  const f = await f452Setup(t);
  const before = await f452Money(f.db);

  for (const key of ["","   ","a".repeat(129)]) {
    assert.equal(
      (await f452Request(f,{key})).status,
      400
    );
  }

  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 conflicting tenant cannot create refund",async t=>{
  const f = await f452Setup(t);
  const before = await f452Money(f.db);

  const result = await f452Request(f,{
    input:{...f.refundInput,salon_id:"foreign"}
  });

  assert.ok(
    [400,403,409].includes(result.status),
    JSON.stringify(result.body)
  );

  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 identical concurrent HTTP refunds debit once",async t=>{
  const f = await f452Setup(t);

  const results = await Promise.all(
    Array.from({length:6},()=>f452Request(f))
  );

  assert.ok(results.some(r=>r.status===200));
  assert.ok(results.every(r=>[200,409].includes(r.status)));

  const retry = await f452Request(f);
  assert.equal(retry.status,200);

  const refunds = await f.db.prepare(
    "SELECT COUNT(*) AS n,SUM(amount_halalas) AS total FROM refunds"
  ).first();

  assert.equal(refunds.n,1);
  assert.equal(refunds.total,2500);
});

test("B04 F452 evidence failure rolls back money",async t=>{
  const f = await f452Setup(t);

  await f.db.prepare(
    "CREATE TRIGGER f452_completion_fault "+
    "BEFORE UPDATE OF state ON core_idempotency_operations "+
    "WHEN NEW.state='completed' BEGIN "+
    "SELECT RAISE(ABORT,'f452_completion_fault'); END;"
  ).run();

  const before = await f452Money(f.db);

  assert.equal((await f452Request(f)).status,500);

  assert.deepEqual(await f452Money(f.db),before);

  const operation = await f.db.prepare(
    "SELECT state FROM core_idempotency_operations "+
    "WHERE salon_id='main' AND operation_id='f452-http'"
  ).first();

  assert.equal(operation.state,"pending");

  assert.equal((await f452Request(f)).status,409);
});

test("B04 F452 changed live refund rejects stale success evidence",async t=>{
  const f = await f452Setup(t);

  const first = await f452Request(f);
  assert.equal(first.status,200);

  await f.db.prepare(
    "UPDATE refunds SET reason='changed' WHERE salon_id=? AND id=?"
  ).bind("main",f.refundInput.id).run();

  const before = await f452Money(f.db);

  assert.equal((await f452Request(f)).status,409);
  assert.deepEqual(await f452Money(f.db),before);
});

test("B04 F452 live role revocation blocks refund replay",async t=>{
  const f = await f452Setup(t);
  assert.equal((await f452Request(f)).status,200);
  await f.db.prepare("UPDATE app_users SET primary_role='client' WHERE salon_id='main' AND id='f43-owner-account'").run();
  const before = await f452Money(f.db);
  assert.equal((await f452Request(f)).status,403);
  assert.deepEqual(await f452Money(f.db),before);
});
